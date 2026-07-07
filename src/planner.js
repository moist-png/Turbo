// ============================================================================
// Training plan engine
// ============================================================================
// Generates a periodized, goal-specific training programme from the existing
// workout library. This file holds ONLY the sports-science logic and pure
// data helpers — no React, no UI — so it can be unit-tested on its own and
// reasoned about in isolation.
//
// The design deliberately keeps this a RULES-BASED generator rather than a
// free-form one: every plan it produces is checked against a fixed set of
// safety rules (validatePlan, below) so we can be confident it periodizes
// correctly instead of just looking plausible. The rules are grounded in the
// standard published frameworks (Friel's periodization model; the Coggan/Allen
// power-based training / TSS model), not invented thresholds.
//
// Key concepts used throughout:
//   - TSS (Training Stress Score): a single number for how hard a session is,
//     combining intensity and duration. ~100 = one hour at threshold.
//   - Weekly TSS: the sum of a week's sessions. This is the "load" we ramp.
//   - Ramp rate: how much weekly TSS is allowed to grow week-over-week. Ramping
//     too fast is the classic route to overtraining/injury, so it's capped.
//   - Phases (Base → Build → Peak → Taper): each has a distinct purpose and a
//     distinct blend of workout types. Specificity to the goal increases as
//     the event approaches.
//   - Recovery ("deload") weeks: every 3rd or 4th week, load drops sharply so
//     the body absorbs the training. These are structural, never optional.
// ============================================================================

// ---------------------------------------------------------------------------
// 1. Workout purpose tags
// ---------------------------------------------------------------------------
// The plan is built from "slots" that ask for a training PURPOSE (e.g. a VO2
// max stimulus), not a specific named workout. This map tags each library
// workout with its purpose so the generator — and the swap feature — can pull
// the right kind of session into each slot. It's also what stops a swap from
// silently breaking a week (you can only swap a workout for another with the
// same purpose).
//
// Purposes:
//   recovery   — very easy, flush the legs, no real stress
//   endurance  — long steady aerobic (Zone 2), builds the base
//   tempo      — sustained moderate (sweet spot lives here too)
//   threshold  — sustained efforts around FTP
//   vo2max     — short hard intervals well above threshold
//   anaerobic  — very short maximal / sprint work
//   climbing   — long sustained climbing efforts (goal-specific for hills)
//   race       — race-simulation / surges / mixed hard efforts
//   test       — FTP tests (never scheduled as normal training)
// ---------------------------------------------------------------------------
export const WORKOUT_PURPOSE = {
  // --- Basics ---
  'ramp-ftp-test': 'test',
  'ftp-test-20': 'test',
  'endurance-hour': 'endurance',
  'rolling-endurance': 'endurance',
  'sweet-spot-builder': 'tempo',
  'threshold-2x20': 'threshold',
  'vo2-5x3': 'vo2max',
  'tabata-torch': 'anaerobic',
  'over-unders': 'threshold',
  'rpe-fartlek': 'tempo',
  'recovery-spin': 'recovery',
  'pyramid-power': 'tempo',
  'mixed-metric': 'tempo',
  'vo2-40-20-double': 'vo2max',
  // --- Rides (long, real-world-feel) ---
  'ride-sunday-club': 'endurance',
  'ride-chaingang': 'threshold',
  'ride-century-sim': 'endurance',
  'ride-coastal-rollers': 'endurance',
  'ride-alpine-ascent': 'climbing',
  'ride-gravel-grinder': 'endurance',
  'ride-crosswind-echelon': 'race',
  'ride-breakaway-glory': 'race',
  'ride-audax-200': 'endurance',
  'ride-crit-sim': 'race',
  'ride-cafe-ride': 'recovery',
  'ride-cobbled-classics': 'race',
  'ride-group-surges': 'race',
  'ride-hilly-fondo': 'climbing',
  'ride-tt-tuneup': 'threshold',
  'ride-rainy-survival': 'endurance',
  'ride-night-steady': 'endurance',
  'ride-everesting-lite': 'climbing',
  'ride-breakaway-stage': 'race',
  'ride-monument-classics': 'race',
  'ride-bikepacking-haul': 'endurance',
  'ride-mountain-double': 'climbing',
  'ride-urban-commute': 'vo2max',
  'ride-recovery-cruise': 'endurance',
  'ride-leadout-day': 'anaerobic',
  'ride-ridge-traverse': 'climbing',
  'ride-volcano-rim': 'climbing',
  'ride-desert-crossing': 'endurance',
  'ride-fjord-switchbacks': 'climbing',
  'ride-highland-loop': 'endurance',
  'ride-dolomites-double': 'climbing',
  'ride-wine-country': 'endurance',
  'ride-moorland-crossing': 'endurance',
  'ride-canyon-rim': 'climbing',
  'ride-alpine-col-chain': 'climbing',
  'ride-anti-gravity': 'climbing',
  'ride-storm-chase': 'race',
  'ride-tt-through-time': 'threshold',
  'ride-the-gauntlet': 'race',
  'ride-migration-flock': 'endurance',
  'ride-ironman-nice': 'endurance',
  'ride-ironman-kona': 'endurance',
  'ride-ironman-lanzarote': 'endurance',
  'ride-pyrenees-circle-of-death': 'climbing',
  'ride-giro-stelvio': 'climbing',
  'ride-giro-zoncolan': 'climbing',
  'ride-giro-finestre': 'climbing',
  'ride-tour-ventoux': 'climbing',
  'ride-tour-alpe-dhuez': 'climbing',
  'ride-tour-galibier': 'climbing',
  'ride-paris-roubaix': 'race',
  'ride-tour-of-flanders': 'race',
  'ride-liege-bastogne-liege': 'climbing',
  'ride-milan-san-remo': 'endurance',
  'ride-vuelta-angliru': 'climbing',
};

// Human-readable labels for each purpose (used in the UI on day rows).
export const PURPOSE_LABEL = {
  recovery: 'Recovery',
  endurance: 'Endurance',
  tempo: 'Tempo / sweet spot',
  threshold: 'Threshold',
  vo2max: 'VO2 max',
  anaerobic: 'Anaerobic / sprint',
  climbing: 'Climbing',
  race: 'Race simulation',
  test: 'FTP test',
};

// Which purposes count as "high stress" for the hard/easy spacing rule.
const HIGH_STRESS = new Set(['threshold', 'vo2max', 'anaerobic', 'race']);
export function isHighStress(purpose) { return HIGH_STRESS.has(purpose); }

// ---------------------------------------------------------------------------
// 2. Estimated TSS from a workout's planned intervals
// ---------------------------------------------------------------------------
// The app's existing computeTss() works from a RIDDEN ride's normalized power.
// For planning we need the *expected* stress of a workout before it's ridden,
// derived from its target intervals. We approximate each interval's intensity
// factor (fraction of FTP) and sum the stress.
//
//   TSS for an interval ≈ (seconds / 3600) * IF^2 * 100
//
// where IF is intensity factor (power as a fraction of FTP). RPE targets are
// mapped to an approximate IF so RPE-based and free intervals still contribute
// a sensible amount. This mirrors the standard TSS definition closely enough
// for planning; the real ridden TSS is still what gets logged to history.
// ---------------------------------------------------------------------------
function rpeToIntensityFactor(rpe) {
  // Rough RPE (1-10) → fraction-of-FTP mapping, matching the zone bands the
  // app already uses for RPE elsewhere.
  const table = { 1: 0.45, 2: 0.5, 3: 0.6, 4: 0.68, 5: 0.75, 6: 0.83, 7: 0.95, 8: 1.03, 9: 1.12, 10: 1.25 };
  return table[Math.round(rpe)] || 0.6;
}

export function estimateWorkoutTss(intervals) {
  if (!intervals || !intervals.length) return 0;
  let tss = 0;
  for (const it of intervals) {
    let ifactor;
    if (it.type === 'power') ifactor = it.target / 100;
    else if (it.type === 'rpe') ifactor = rpeToIntensityFactor(it.target);
    else ifactor = 0.4; // free / rest — soft-pedalling
    tss += (it.duration / 3600) * ifactor * ifactor * 100;
  }
  return Math.round(tss);
}

// ---------------------------------------------------------------------------
// 3. Goal definitions
// ---------------------------------------------------------------------------
// Each goal type describes what a plan for it should emphasise, especially as
// the event approaches (the "specific" purposes get weighted up in Build/Peak).
// `hasEvent: false` means it's an open-ended fitness builder with no taper.
// ---------------------------------------------------------------------------
export const GOALS = {
  'general-fitness': {
    label: 'General fitness',
    blurb: 'Build all-round cycling fitness with no fixed event date.',
    hasEvent: false,
    // Balanced blend; nothing dominates.
    emphasis: { endurance: 3, tempo: 2, threshold: 2, vo2max: 1 },
  },
  'ftp-builder': {
    label: 'FTP builder',
    blurb: 'Raise your threshold power over a block of focused training.',
    hasEvent: false,
    emphasis: { threshold: 3, tempo: 3, endurance: 2, vo2max: 1 },
  },
  'century': {
    label: 'Century / gran fondo',
    blurb: 'Prepare for a long endurance day in the saddle.',
    hasEvent: true,
    emphasis: { endurance: 4, tempo: 2, threshold: 1 },
  },
  'hill-climb': {
    label: 'Hill climb / mountains',
    blurb: 'Sustained climbing power for a hilly event or big cols.',
    hasEvent: true,
    emphasis: { climbing: 3, threshold: 3, endurance: 2, vo2max: 1 },
  },
  'road-race': {
    label: 'Road race / crit',
    blurb: 'Sharp, punchy fitness for racing with surges and sprints.',
    hasEvent: true,
    emphasis: { race: 3, vo2max: 3, threshold: 2, endurance: 1, anaerobic: 1 },
  },
  'time-trial': {
    label: 'Time trial',
    blurb: 'Sustainable threshold power for a flat-out effort against the clock.',
    hasEvent: true,
    emphasis: { threshold: 4, tempo: 2, endurance: 1, vo2max: 1 },
  },
  'triathlon-bike': {
    label: 'Triathlon (bike leg)',
    blurb: 'Bike-specific block that leaves room for your run and swim training.',
    hasEvent: true,
    // Endurance-led and deliberately gentler on top-end (see multi-sport
    // conservatism applied in generatePlan) so it doesn't wreck run days.
    emphasis: { endurance: 4, tempo: 2, threshold: 2 },
  },
};

// ---------------------------------------------------------------------------
// 4. Phase model
// ---------------------------------------------------------------------------
// Given a total number of weeks, split them into phases. Longer plans get a
// longer base; every plan with an event ends in a taper. The proportions
// follow the standard base > build > peak shrink, with taper fixed at 1-2 wks.
// ---------------------------------------------------------------------------
export const PHASE = {
  base: { key: 'base', label: 'Base', blurb: 'Aerobic volume and efficiency. Mostly steady riding to build the engine.' },
  build: { key: 'build', label: 'Build', blurb: 'Intensity rises and gets more specific to your goal. Volume holds steady.' },
  peak: { key: 'peak', label: 'Peak', blurb: 'Sharpest, most goal-specific work. Volume eases so the hard sessions land.' },
  taper: { key: 'taper', label: 'Taper', blurb: 'Volume drops but intensity stays, so you arrive fresh and still sharp.' },
};

export function planPhases(totalWeeks, hasEvent) {
  // Returns an array of phase keys, one per week, length === totalWeeks.
  const weeks = Math.max(4, Math.round(totalWeeks));
  if (!hasEvent) {
    // Open-ended: alternate base/build focus with no peak/taper. Roughly the
    // first third base-led, the rest build-led.
    const baseLen = Math.max(2, Math.round(weeks * 0.4));
    const out = [];
    for (let i = 0; i < weeks; i++) out.push(i < baseLen ? 'base' : 'build');
    return out;
  }
  // Event plan: taper is 1 week for short plans, 2 for 8+ weeks.
  const taperLen = weeks >= 8 ? 2 : 1;
  const peakLen = weeks >= 10 ? 2 : 1;
  const remaining = weeks - taperLen - peakLen;
  // Split the remaining weeks ~55% base / 45% build.
  const baseLen = Math.max(1, Math.round(remaining * 0.55));
  const buildLen = Math.max(1, remaining - baseLen);
  const out = [];
  for (let i = 0; i < baseLen; i++) out.push('base');
  for (let i = 0; i < buildLen; i++) out.push('build');
  for (let i = 0; i < peakLen; i++) out.push('peak');
  for (let i = 0; i < taperLen; i++) out.push('taper');
  // Guard: floating-point/rounding could drift the length by one; fix it.
  while (out.length < weeks) out.splice(baseLen, 0, 'base');
  while (out.length > weeks) out.shift();
  return out;
}

// Which weeks are recovery/deload weeks. Every `cadence`-th week is a deload,
// but never the taper weeks (those are already low-volume) and never week 1.
export function recoveryWeekFlags(phaseByWeek, cadence) {
  return phaseByWeek.map((phase, i) => {
    if (phase === 'taper') return false;
    if (i === 0) return false;
    // week number is i+1; deload on multiples of cadence
    return (i + 1) % cadence === 0;
  });
}

// ---------------------------------------------------------------------------
// 5. Weekly load ramp
// ---------------------------------------------------------------------------
// Start from an estimate of the rider's current sustainable weekly TSS, then
// ramp within safe bounds. Recovery weeks cut load; taper weeks cut it hard.
// The ramp rate cap is the single most important safety rule here.
// ---------------------------------------------------------------------------
const RAMP = {
  // Max fractional increase in weekly TSS from one loading week to the next.
  // ~8% sits at the upper end of the widely-cited safe range; multi-sport
  // riders get the gentler 5%.
  maxRampSolo: 0.08,
  maxRampMulti: 0.05,
  recoveryMultiplier: 0.55, // deload week = ~55% of the week before
  taperMultiplier: 0.5,     // taper weeks shed volume
  peakMultiplier: 0.85,     // peak eases volume vs late build
};

// `lockedTargets` (optional): an array the same length as phaseByWeek where a
// non-null entry means "this week's target is fixed" (used when re-planning
// after a check-in — the weeks already ridden stay put, and the ramp continues
// smoothly from the last locked loading week).
export function weeklyLoadTargets({ startWeeklyTss, phaseByWeek, recoveryFlags, multiSport, lockedTargets }) {
  const maxRamp = multiSport ? RAMP.maxRampMulti : RAMP.maxRampSolo;
  const targets = [];
  let lastLoadingLoad = startWeeklyTss; // the last non-recovery, non-taper load
  phaseByWeek.forEach((phase, i) => {
    // If this week is locked, honour its fixed target and, if it's a loading
    // week, use it as the new ramp baseline so future weeks stay continuous.
    if (lockedTargets && lockedTargets[i] != null) {
      targets.push(lockedTargets[i]);
      if (!recoveryFlags[i] && phase !== 'taper') lastLoadingLoad = lockedTargets[i];
      return;
    }
    let target;
    if (phase === 'taper') {
      // Progressive taper: each taper week sheds more volume.
      const taperIndexFromEnd = phaseByWeek.slice(i).filter(p => p === 'taper').length; // 2,1
      target = lastLoadingLoad * Math.pow(RAMP.taperMultiplier, (3 - taperIndexFromEnd));
    } else if (recoveryFlags[i]) {
      target = lastLoadingLoad * RAMP.recoveryMultiplier;
    } else if (phase === 'peak') {
      // Peak ramps intensity but eases volume relative to the last loading week.
      const ramped = lastLoadingLoad * (1 + maxRamp);
      target = ramped * RAMP.peakMultiplier;
      lastLoadingLoad = ramped;
    } else {
      // Base / build loading week: ramp up from the last loading week.
      target = lastLoadingLoad * (1 + maxRamp);
      lastLoadingLoad = target;
    }
    targets.push(Math.round(target));
  });
  return targets;
}

// ---------------------------------------------------------------------------
// 6. Choosing workouts to fill a week
// ---------------------------------------------------------------------------
// For each week we know: the phase, the target weekly TSS, how many days the
// rider trains, and the goal's emphasis. We build a list of purpose "slots"
// for the week, then assign real library workouts to them, scaling duration to
// hit the weekly TSS target without exceeding the rider's available time.
// ---------------------------------------------------------------------------

// Build the ordered list of purposes for a week's training days.
//
// `library` and `weeklySecondsBudget` are optional but should be passed
// whenever available: they let this function keep fixed-length purposes
// (climbing, threshold, vo2max, race, anaerobic — sessions we won't trim)
// from over-committing the week's time budget before a single workout is
// even picked. Without them the function still works, it just can't apply
// the time-budget check.
export function weekPurposeSlots({ phase, daysPerWeek, goal, isRecovery, multiSport, library, weeklySecondsBudget }) {
  if (isRecovery) {
    // Deload: mostly recovery + easy endurance, at most one light quality day.
    const slots = [];
    for (let i = 0; i < daysPerWeek; i++) {
      slots.push(i === 0 && daysPerWeek >= 3 ? 'endurance' : 'recovery');
    }
    return slots;
  }

  const emphasis = { ...goal.emphasis };
  // Phase shaping: base leans aerobic; build/peak lean into the goal's
  // specific high-end purposes.
  if (phase === 'base') {
    emphasis.endurance = (emphasis.endurance || 0) + 3;
    emphasis.tempo = (emphasis.tempo || 0) + 1;
    // Trim the very top end during base.
    delete emphasis.anaerobic;
  } else if (phase === 'build') {
    // keep as-is; goal emphasis already tilts to specificity
  } else if (phase === 'peak') {
    // Peak: double down on the most goal-specific purposes.
    for (const k of Object.keys(emphasis)) {
      if (HIGH_STRESS.has(k) || k === 'climbing') emphasis[k] += 2;
    }
  }

  const purposes = Object.keys(emphasis);
  // Smooth weighted round-robin (the algorithm nginx etc. use to spread
  // weighted picks evenly): every "round" every purpose's counter climbs by
  // its weight, then we take whichever purpose has climbed highest and drop
  // it back by the total weight. This spreads picks proportionally across
  // the whole week instead of the old approach (a flat pool like
  // [endurance,endurance,endurance,endurance,tempo,tempo,threshold]) which
  // walked the list in order — so any week short enough (which is most of
  // them) never got past the heaviest-weighted purpose at all. That's what
  // was producing all-endurance weeks.
  const current = {};
  purposes.forEach(p => { current[p] = 0; });
  const totalWeight = purposes.reduce((a, p) => a + emphasis[p], 0) || 1;

  // Purposes whose length we can freely scale down; everything else (an
  // interval session or a long narrative "Ride") keeps its native length, so
  // it has to be accounted for against the time budget up front rather than
  // squeezed in after the fact.
  const FLEXIBLE = new Set(['endurance', 'recovery', 'tempo']);
  const MIN_FLEX_RESERVE = 2700; // keep the flexible anchor ride at least ~45 min
  const avgDurationCache = {};
  function avgNativeDuration(purpose) {
    if (avgDurationCache[purpose] != null) return avgDurationCache[purpose];
    if (!library) return (avgDurationCache[purpose] = 3600);
    const cands = library.filter(w => WORKOUT_PURPOSE[w.id] === purpose && WORKOUT_PURPOSE[w.id] !== 'test');
    const dur = cands.length
      ? cands.reduce((a, w) => a + w.intervals.reduce((x, y) => x + y.duration, 0), 0) / cands.length
      : 3600;
    return (avgDurationCache[purpose] = dur);
  }

  const days = Math.max(1, daysPerWeek);
  // Multi-sport riders get one fewer hard day (extra recovery headroom).
  const maxHardDays = Math.max(1, Math.floor(days * (multiSport ? 0.35 : 0.5)));
  const availableForFixed = weeklySecondsBudget ? Math.max(0, weeklySecondsBudget - MIN_FLEX_RESERVE) : Infinity;

  const slots = [];
  let hardCount = 0;
  let fixedSecondsCommitted = 0;

  // Always guarantee at least one endurance ride if training 3+ days (skipped
  // for very short 1-2 day weeks).
  if (days >= 3) slots.push('endurance');

  function pickNext(prev) {
    purposes.forEach(p => { current[p] += emphasis[p]; });
    const ranked = [...purposes].sort((a, b) => current[b] - current[a]);
    for (const candidate of ranked) {
      const isFixedLength = !FLEXIBLE.has(candidate);
      const wouldBeBackToBack = isHighStress(candidate) && isHighStress(prev);
      const overHardBudget = isHighStress(candidate) && hardCount >= maxHardDays;
      const overTimeBudget = isFixedLength && (fixedSecondsCommitted + avgNativeDuration(candidate) > availableForFixed);
      if (wouldBeBackToBack || overHardBudget || overTimeBudget) continue;
      current[candidate] -= totalWeight;
      return candidate;
    }
    // Nothing cleared every constraint this round (a very tight week) —
    // endurance is always safe: never high-stress, always time-flexible.
    return 'endurance';
  }

  while (slots.length < days) {
    const prev = slots[slots.length - 1];
    const candidate = pickNext(prev);
    slots.push(candidate);
    if (isHighStress(candidate)) hardCount++;
    if (!FLEXIBLE.has(candidate)) fixedSecondsCommitted += avgNativeDuration(candidate);
  }
  return slots;
}

// Pick a concrete library workout for a purpose. `library` is the app's
// LIBRARY array. Prefers workouts of the right purpose; falls back sensibly.
export function pickWorkoutForPurpose(purpose, library, usedIdsThisWeek) {
  const candidates = library.filter(w => WORKOUT_PURPOSE[w.id] === purpose && WORKOUT_PURPOSE[w.id] !== 'test');
  if (!candidates.length) {
    // Fallback chain so a slot is never empty.
    const fallbackOrder = {
      recovery: ['endurance'], tempo: ['endurance', 'threshold'],
      threshold: ['tempo', 'vo2max'], vo2max: ['threshold', 'race'],
      anaerobic: ['vo2max', 'race'], climbing: ['threshold', 'endurance'],
      race: ['vo2max', 'threshold'], endurance: ['tempo'],
    };
    for (const alt of (fallbackOrder[purpose] || [])) {
      const altCands = library.filter(w => WORKOUT_PURPOSE[w.id] === alt);
      if (altCands.length) return altCands[0];
    }
    return library.find(w => WORKOUT_PURPOSE[w.id] === 'endurance') || library[0];
  }
  // Prefer one not already used this week, for variety.
  const unused = candidates.filter(w => !usedIdsThisWeek.has(w.id));
  return (unused.length ? unused : candidates)[0];
}

// List all valid swap options for a slot: same-purpose workouts from the
// library (this is what the swap UI shows). Excludes tests.
export function swapOptionsForPurpose(purpose, library) {
  return library.filter(w => WORKOUT_PURPOSE[w.id] === purpose && WORKOUT_PURPOSE[w.id] !== 'test');
}

// Mutates `days` in place so their total planned time fits `budgetSeconds`.
// Strategy: first trim the length-flexible aerobic rides down toward a floor;
// if that still isn't enough (a week packed with fixed interval sessions),
// compress every ride proportionally as a last resort. This guarantees the
// time budget is never exceeded, which is one of the hard validation rules.
function enforceTimeBudget(days, budgetSeconds) {
  const MIN = 1500; // ~25 min minimum per ride
  const isFlex = d => !d.fixedLength && (d.purpose === 'endurance' || d.purpose === 'recovery' || d.purpose === 'tempo');
  const recompute = d => { d.plannedTss = Math.round(d.nativeTss * (d.plannedSeconds / d.nativeSeconds)); };

  let total = days.reduce((a, d) => a + d.plannedSeconds, 0);
  if (total <= budgetSeconds) return;

  // Pass 1: trim flexible rides proportionally toward the floor.
  const flexible = days.filter(isFlex);
  const fixedSeconds = days.filter(d => !isFlex(d)).reduce((a, d) => a + d.plannedSeconds, 0);
  const flexBudget = Math.max(0, budgetSeconds - fixedSeconds);
  const flexTotal = flexible.reduce((a, d) => a + d.plannedSeconds, 0) || 1;
  if (flexible.length) {
    const trim = flexBudget / flexTotal;
    flexible.forEach(d => { d.plannedSeconds = Math.max(MIN, Math.round(d.plannedSeconds * trim)); recompute(d); });
  }

  // Pass 2: if fixed sessions alone still bust the budget, compress everything
  // proportionally (down to the floor). This only bites in extreme "many hard
  // days, very little time" cases the feasibility guard couldn't fully absorb.
  total = days.reduce((a, d) => a + d.plannedSeconds, 0);
  if (total > budgetSeconds) {
    const scale = budgetSeconds / total;
    days.forEach(d => { d.plannedSeconds = Math.max(MIN, Math.round(d.plannedSeconds * scale)); recompute(d); });
    // Final safety: if flooring pushed us back over, shave the longest rides.
    let over = days.reduce((a, d) => a + d.plannedSeconds, 0) - budgetSeconds;
    const sorted = [...days].sort((a, b) => b.plannedSeconds - a.plannedSeconds);
    for (const d of sorted) {
      if (over <= 0) break;
      const canShave = Math.max(0, d.plannedSeconds - MIN);
      const shave = Math.min(canShave, over);
      d.plannedSeconds -= shave; recompute(d); over -= shave;
    }
  }
}

// ---------------------------------------------------------------------------
// 7. The generator
// ---------------------------------------------------------------------------
export function generatePlan({
  goalKey, totalWeeks, daysPerWeek, weeklyHours,
  currentFtp, recentWeeklyTss, multiSport, library,
}) {
  const goal = GOALS[goalKey] || GOALS['general-fitness'];
  const hasEvent = goal.hasEvent;

  // Estimate the rider's current sustainable weekly TSS to start the ramp
  // from. If we have real recent history, use it (this is the "inferred
  // experience level" — see the plan). Otherwise fall back to a conservative
  // estimate from their stated available hours (~50 TSS per hour of mixed
  // riding is a reasonable planning average).
  const hoursBasedTss = Math.round((weeklyHours || 4) * 50);
  let startWeeklyTss = recentWeeklyTss && recentWeeklyTss > 0
    ? Math.round(recentWeeklyTss)
    : hoursBasedTss;
  // Never start wildly above what their available time can hold.
  startWeeklyTss = Math.min(startWeeklyTss, Math.round(hoursBasedTss * 1.15));
  startWeeklyTss = Math.max(120, startWeeklyTss);

  const phaseByWeek = planPhases(totalWeeks, hasEvent);
  // Multi-sport riders deload every 3 weeks; solo riders every 4.
  const cadence = multiSport ? 3 : 4;
  const recoveryFlags = recoveryWeekFlags(phaseByWeek, cadence);
  const loadTargets = weeklyLoadTargets({ startWeeklyTss, phaseByWeek, recoveryFlags, multiSport });

  const weeklySecondsBudget = (weeklyHours || 4) * 3600;

  // Feasibility guard: a rider can ask for more training days than their time
  // budget can actually hold (e.g. 6 days in 4 hours). Interval sessions have
  // a fixed length we can't trim, and every ride needs a sane minimum (~25
  // min). If the requested day count can't fit, quietly reduce it so we never
  // emit an over-budget plan. ~25 min/ride minimum is a reasonable floor.
  const MIN_RIDE_SECONDS = 1500;
  const feasibleDays = Math.max(1, Math.min(daysPerWeek, Math.floor(weeklySecondsBudget / MIN_RIDE_SECONDS)));
  const effectiveDays = feasibleDays;

  const weeks = phaseByWeek.map((phase, wi) => {
    const isRecovery = recoveryFlags[wi];
    const purposeSlots = weekPurposeSlots({ phase, daysPerWeek: effectiveDays, goal, isRecovery, multiSport, library, weeklySecondsBudget });
    const usedIds = new Set();
    const targetTss = loadTargets[wi];

    // First pass: pick a workout per slot at its native length.
    const rawDays = purposeSlots.map(purpose => {
      const w = pickWorkoutForPurpose(purpose, library, usedIds);
      usedIds.add(w.id);
      const nativeSeconds = w.intervals.reduce((a, b) => a + b.duration, 0);
      const nativeTss = estimateWorkoutTss(w.intervals);
      return { purpose, workoutId: w.id, name: w.name, nativeSeconds, nativeTss, fixedLength: !!w.fixedLength };
    });

    // Second pass: scale durations so the week's total TSS approaches the
    // target, without exceeding the time budget. We scale endurance/recovery
    // rides (which are length-flexible) rather than fixed interval sessions.
    const currentTss = rawDays.reduce((a, d) => a + d.nativeTss, 0) || 1;
    const scaleFactor = targetTss / currentTss;

    const days = rawDays.map(d => {
      let plannedSeconds = d.nativeSeconds;
      // Only scale flexible aerobic rides; keep interval structure intact.
      if (!d.fixedLength && (d.purpose === 'endurance' || d.purpose === 'recovery' || d.purpose === 'tempo')) {
        plannedSeconds = Math.round(d.nativeSeconds * scaleFactor);
        // Clamp to sane per-ride bounds (20 min .. 5 h).
        plannedSeconds = Math.max(1200, Math.min(18000, plannedSeconds));
      }
      const ratio = plannedSeconds / d.nativeSeconds;
      const plannedTss = Math.round(d.nativeTss * ratio);
      return { ...d, plannedSeconds, plannedTss };
    });

    // Enforce the weekly time budget.
    enforceTimeBudget(days, weeklySecondsBudget);

    const weekTss = days.reduce((a, d) => a + d.plannedTss, 0);
    const weekSeconds = days.reduce((a, d) => a + d.plannedSeconds, 0);

    return {
      weekNumber: wi + 1,
      phase,
      isRecovery,
      targetTss,
      plannedTss: weekTss,
      plannedSeconds: weekSeconds,
      days,
    };
  });

  return {
    goalKey,
    goalLabel: goal.label,
    hasEvent,
    totalWeeks: phaseByWeek.length,
    daysPerWeek: effectiveDays,
    requestedDays: daysPerWeek,
    weeklyHours,
    currentFtp,
    multiSport,
    createdAt: new Date().toISOString(),
    startWeeklyTss,
    weeks,
  };
}

// ---------------------------------------------------------------------------
// 8. Plan validation
// ---------------------------------------------------------------------------
// The safety checklist. A plan that fails any hard rule should never be shown
// as a finished programme. Returns { ok, errors, warnings }.
// ---------------------------------------------------------------------------
export function validatePlan(plan) {
  const errors = [];
  const warnings = [];
  if (!plan || !plan.weeks || !plan.weeks.length) {
    return { ok: false, errors: ['Plan has no weeks.'], warnings };
  }

  const maxRamp = plan.multiSport ? RAMP.maxRampMulti : RAMP.maxRampSolo;

  // Rule 1: weekly load ramp between consecutive LOADING weeks never exceeds
  // the cap (with a small tolerance for rounding).
  let lastLoading = null;
  plan.weeks.forEach(w => {
    const loading = !w.isRecovery && w.phase !== 'taper';
    if (loading) {
      if (lastLoading != null && lastLoading > 0) {
        const ramp = (w.targetTss - lastLoading) / lastLoading;
        if (ramp > maxRamp + 0.02) {
          errors.push(`Week ${w.weekNumber}: load ramp ${(ramp * 100).toFixed(0)}% exceeds the ${(maxRamp * 100).toFixed(0)}% cap.`);
        }
      }
      lastLoading = w.targetTss;
    }
  });

  // Rule 2: a recovery week appears at least every 4 weeks (3 for multi-sport)
  // outside of taper.
  const cadence = plan.multiSport ? 3 : 4;
  let sinceRecovery = 0;
  plan.weeks.forEach(w => {
    if (w.phase === 'taper') { sinceRecovery = 0; return; }
    if (w.isRecovery) { sinceRecovery = 0; return; }
    sinceRecovery++;
    if (sinceRecovery > cadence) {
      errors.push(`Week ${w.weekNumber}: ${sinceRecovery} weeks without a recovery week (max ${cadence}).`);
    }
  });

  // Rule 3: no more than 2 consecutive high-stress days within a week.
  plan.weeks.forEach(w => {
    let streak = 0;
    w.days.forEach(d => {
      if (isHighStress(d.purpose)) { streak++; if (streak > 2) errors.push(`Week ${w.weekNumber}: 3+ hard days back-to-back.`); }
      else streak = 0;
    });
  });

  // Rule 4: weekly planned time never exceeds the rider's stated budget.
  const budget = (plan.weeklyHours || 4) * 3600;
  plan.weeks.forEach(w => {
    if (w.plannedSeconds > budget + 300) {
      errors.push(`Week ${w.weekNumber}: planned time ${Math.round(w.plannedSeconds / 3600 * 10) / 10}h exceeds the ${plan.weeklyHours}h budget.`);
    }
  });

  // Rule 5 (event plans): last week is a taper, and taper volume is below the
  // preceding loading weeks but not zero.
  if (plan.hasEvent) {
    const last = plan.weeks[plan.weeks.length - 1];
    if (last.phase !== 'taper') errors.push('Event plan does not end in a taper.');
    const peakLoad = Math.max(...plan.weeks.map(w => w.targetTss));
    if (last.targetTss >= peakLoad) errors.push('Taper week is not lighter than peak load.');
    if (last.targetTss <= 0) errors.push('Taper week has no training at all.');
  }

  // Rule 6 (soft): every non-recovery week of a 3+ day plan has at least one
  // endurance ride. Warning only.
  plan.weeks.forEach(w => {
    if (!w.isRecovery && plan.daysPerWeek >= 3 && !w.days.some(d => d.purpose === 'endurance')) {
      warnings.push(`Week ${w.weekNumber}: no endurance ride.`);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// 9. Post-generation adjustments (weekly check-in + swaps)
// ---------------------------------------------------------------------------
// These keep a live plan honest as the rider progresses. Both re-run the same
// TSS bookkeeping so the plan's numbers stay accurate.
// ---------------------------------------------------------------------------

// Adjust the remaining plan based on how the rider reported feeling. Rather
// than nudging individual weeks (which could create an illegal ramp between
// weeks), we shift the *baseline load* the rest of the plan ramps from and
// recompute every future week's target. This keeps the ramp-rate and recovery
// rules valid by construction. Returns a new plan.
export function applyCheckin(plan, weekNumber, feedback, library) {
  // feedback: 'too-easy' | 'about-right' | 'too-hard' | 'missed-a-lot'
  const factor = { 'too-easy': 1.08, 'about-right': 1.0, 'too-hard': 0.85, 'missed-a-lot': 0.7 }[feedback] || 1.0;

  // Optionally convert the very next week into an unplanned recovery week.
  let recoveryFlags = plan.weeks.map(w => w.isRecovery);
  if (feedback === 'too-hard' || feedback === 'missed-a-lot') {
    const idx = plan.weeks.findIndex(w => w.weekNumber === weekNumber + 1);
    if (idx >= 0 && plan.weeks[idx].phase !== 'taper') recoveryFlags[idx] = true;
  }

  const phaseByWeek = plan.weeks.map(w => w.phase);

  // Lock every week up to and including the check-in week to its current
  // target. The feedback factor shifts the baseline the *future* ramps from:
  // the last locked loading week's target is nudged by `factor`, then future
  // weeks ramp continuously from there so no single step can break the cap.
  const lockedTargets = plan.weeks.map(w => (w.weekNumber <= weekNumber ? w.targetTss : null));

  // Find the last locked loading week to derive the adjusted future baseline.
  let baseTss = plan.startWeeklyTss;
  for (let i = 0; i < plan.weeks.length; i++) {
    const w = plan.weeks[i];
    if (w.weekNumber <= weekNumber && !recoveryFlags[i] && w.phase !== 'taper') baseTss = w.targetTss;
  }
  // The first future loading week should land at baseTss * factor. Since
  // weeklyLoadTargets ramps the baseline up by (1+maxRamp) for the first
  // loading week, divide that step out here so the boundary ramp stays legal.
  const maxRamp = plan.multiSport ? RAMP.maxRampMulti : RAMP.maxRampSolo;
  const adjustedBaseline = Math.max(80, Math.round((baseTss * factor) / (1 + maxRamp)));

  const targets = weeklyLoadTargets({
    startWeeklyTss: adjustedBaseline,
    phaseByWeek,
    recoveryFlags,
    multiSport: plan.multiSport,
    lockedTargets,
  });

  const weeks = plan.weeks.map((w, i) => {
    if (w.weekNumber <= weekNumber) return { ...w, isRecovery: recoveryFlags[i] };
    return { ...w, targetTss: targets[i], isRecovery: recoveryFlags[i], insertedRecovery: recoveryFlags[i] && !plan.weeks[i].isRecovery };
  });

  const adjusted = { ...plan, weeks };
  return rebuildWeekWorkouts(adjusted, library, weekNumber + 1);
}

// Re-pick/re-scale workouts for weeks from `fromWeek` onward to match their
// (possibly adjusted) target TSS. Keeps earlier weeks untouched.
export function rebuildWeekWorkouts(plan, library, fromWeek) {
  const weeklySecondsBudget = (plan.weeklyHours || 4) * 3600;
  const goal = GOALS[plan.goalKey] || GOALS['general-fitness'];

  const weeks = plan.weeks.map(w => {
    if (w.weekNumber < fromWeek) return w;
    const purposeSlots = weekPurposeSlots({ phase: w.phase, daysPerWeek: plan.daysPerWeek, goal, isRecovery: w.isRecovery, multiSport: plan.multiSport, library, weeklySecondsBudget });
    const usedIds = new Set();
    const rawDays = purposeSlots.map(purpose => {
      const wk = pickWorkoutForPurpose(purpose, library, usedIds);
      usedIds.add(wk.id);
      const nativeSeconds = wk.intervals.reduce((a, b) => a + b.duration, 0);
      const nativeTss = estimateWorkoutTss(wk.intervals);
      return { purpose, workoutId: wk.id, name: wk.name, nativeSeconds, nativeTss, fixedLength: !!wk.fixedLength };
    });
    const currentTss = rawDays.reduce((a, d) => a + d.nativeTss, 0) || 1;
    const scaleFactor = w.targetTss / currentTss;
    const days = rawDays.map(d => {
      let plannedSeconds = d.nativeSeconds;
      if (!d.fixedLength && (d.purpose === 'endurance' || d.purpose === 'recovery' || d.purpose === 'tempo')) {
        plannedSeconds = Math.max(1200, Math.min(18000, Math.round(d.nativeSeconds * scaleFactor)));
      }
      const ratio = plannedSeconds / d.nativeSeconds;
      return { ...d, plannedSeconds, plannedTss: Math.round(d.nativeTss * ratio) };
    });
    enforceTimeBudget(days, weeklySecondsBudget);
    return {
      ...w,
      plannedTss: days.reduce((a, d) => a + d.plannedTss, 0),
      plannedSeconds: days.reduce((a, d) => a + d.plannedSeconds, 0),
      days,
    };
  });
  return { ...plan, weeks };
}

// Swap one day's workout for another of the SAME purpose. Recomputes that
// day's and week's TSS/time. Returns a new plan.
export function swapDayWorkout(plan, weekNumber, dayIndex, newWorkoutId, library) {
  const w = library.find(x => x.id === newWorkoutId);
  if (!w) return plan;
  const nativeSeconds = w.intervals.reduce((a, b) => a + b.duration, 0);
  const nativeTss = estimateWorkoutTss(w.intervals);
  const weeks = plan.weeks.map(week => {
    if (week.weekNumber !== weekNumber) return week;
    const days = week.days.map((d, i) => {
      if (i !== dayIndex) return d;
      return {
        ...d, workoutId: w.id, name: w.name,
        nativeSeconds, nativeTss, fixedLength: !!w.fixedLength,
        plannedSeconds: nativeSeconds, plannedTss: nativeTss,
      };
    });
    return {
      ...week,
      plannedTss: days.reduce((a, d) => a + d.plannedTss, 0),
      plannedSeconds: days.reduce((a, d) => a + d.plannedSeconds, 0),
      days,
    };
  });
  return { ...plan, weeks };
}
