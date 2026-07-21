// ============================================================================
// Planner validation harness (Stage 0.1)
// ============================================================================
// Generates plans across the FULL user-selectable input space and asserts a
// fixed set of safety invariants on every generated week. Run before every
// planner push:
//
//   node scripts/planner-sweep.js
//
// Exit code 0 + "PASS" line = safe to push. Any violation prints the exact
// input combination that produced it, so it can be reproduced directly.
//
// The invariants deliberately re-derive expectations from the INPUTS (e.g.
// the ramp cap a 'new' rider should get) rather than trusting the plan's own
// bookkeeping, and additionally require validatePlan() itself to pass — so
// both the generator and the validator are exercised on every combination.
// ============================================================================
import {
  generatePlan, validatePlan, isHighStress, WORKOUT_PURPOSE,
  workoutDifficulty, progressionLevels,
  planProposals, applyPlanProposal, planHealth, planWeekWindow, applyCheckin,
} from '../src/planner.js';
import { loadLibrary } from './extract-library.js';

const LIBRARY = loadLibrary();
const byId = new Map(LIBRARY.map(w => [w.id, w]));

// --- The user-selectable input space (mirrors PlannerView's option chips) ---
const GOAL_KEYS = ['general-fitness', 'ftp-builder', 'century', 'hill-climb', 'road-race', 'time-trial', 'triathlon-bike'];
const WEEKS = [4, 6, 8, 12, 16];
const DAYS = [2, 3, 4, 5, 6];
const HOURS = [3, 4, 6, 8, 10, 12];
const MULTI = [false, true];
// trainingAge only changes behaviour when 'new'; ageBand only when '55plus'.
// Sweep the behaviour-changing value plus the default for each.
const TRAINING_AGE = [null, 'new'];
const AGE_BAND = [null, '55plus'];
const RECENT_TSS = [0, 300]; // no history vs. real recent load

const failures = [];
let plansChecked = 0;
let weeksChecked = 0;

// Rotation bookkeeping across ALL plans is meaningless (memory is per-plan),
// so rotation is asserted per plan, per purpose.
function checkPlan(input) {
  const plan = generatePlan({ ...input, library: LIBRARY, currentFtp: 200 });
  assertPlan(plan, input);
  return plan;
}

// Assert every invariant on an existing plan (freshly generated OR modified
// by a check-in / repair proposal). `input` supplies the ramp-cap and
// cadence expectations; `tag` marks scenario runs in failure output.
function assertPlan(plan, input, tag) {
  plansChecked++;
  const label = (tag ? tag + ' ' : '') + JSON.stringify({
    goal: input.goalKey, weeks: input.totalWeeks, days: input.daysPerWeek,
    hours: input.weeklyHours, multi: input.multiSport, age: input.trainingAge,
    band: input.riderAgeBand, recentTss: input.recentWeeklyTss,
    weightedDay: input.weightedDayIndex ?? null,
    prog: input.progressionLevels ? 'on' : 'off',
  });
  const fail = msg => failures.push(`${msg}\n    at ${label}`);

  // --- Structural sanity ---
  if (!plan.weeks || plan.weeks.length !== Math.max(4, input.totalWeeks)) {
    fail(`Plan has ${plan.weeks ? plan.weeks.length : 0} weeks, expected ${input.totalWeeks}`);
    return;
  }
  if (plan.daysPerWeek > input.daysPerWeek) fail(`Effective days ${plan.daysPerWeek} exceeds requested ${input.daysPerWeek}`);
  if (plan.daysPerWeek < 1) fail('Effective days < 1');

  // --- Expected ramp cap, derived from inputs (not from the plan) ---
  let cap = input.multiSport ? 0.05 : 0.08;
  if (input.trainingAge === 'new') cap = Math.min(cap, 0.05);

  // --- Expected recovery cadence, derived from inputs ---
  let cadence = input.multiSport ? 3 : 4;
  if (input.riderAgeBand === '55plus') cadence = Math.max(2, cadence - 1);

  const budget = input.weeklyHours * 3600;
  let lastLoading = null;
  let sinceRecovery = 0;
  const pickCounts = {}; // purpose -> Map(workoutId -> count)

  plan.weeks.forEach(w => {
    weeksChecked++;
    const wk = `Week ${w.weekNumber}`;
    const loading = !w.isRecovery && w.phase !== 'taper';

    // Invariant 1: ramp between consecutive loading weeks never exceeds cap.
    if (loading) {
      if (lastLoading != null && lastLoading > 0) {
        const ramp = (w.targetTss - lastLoading) / lastLoading;
        if (ramp > cap + 0.021) fail(`${wk}: ramp ${(ramp * 100).toFixed(1)}% exceeds ${(cap * 100).toFixed(0)}% cap`);
      }
      lastLoading = w.targetTss;
    }

    // Invariant 2: taper weeks genuinely taper.
    if (w.phase === 'taper' && lastLoading != null && w.targetTss >= lastLoading) {
      fail(`${wk}: taper target ${w.targetTss} not below last loading week ${lastLoading}`);
    }

    // Invariant 3: recovery weeks land within the cadence.
    if (w.phase === 'taper' || w.isRecovery) sinceRecovery = 0;
    else {
      sinceRecovery++;
      if (sinceRecovery > cadence) fail(`${wk}: ${sinceRecovery} loading weeks without recovery (cadence ${cadence})`);
    }

    // Invariant 4: every slot is filled with a real, plannable workout.
    const expectedDays = plan.daysPerWeek;
    if (w.isRecovery) {
      if (w.days.length < 1 || w.days.length > expectedDays) fail(`${wk}: recovery week has ${w.days.length} sessions (expected 1..${expectedDays})`);
    } else if (w.days.length !== expectedDays) {
      fail(`${wk}: ${w.days.length} sessions, expected ${expectedDays}`);
    }

    w.days.forEach((d, di) => {
      const workout = byId.get(d.workoutId);
      if (!workout) { fail(`${wk} day ${di + 1}: workout id '${d.workoutId}' not in library`); return; }
      // Invariant 5: purpose-tagged, never a test, never a pain workout.
      const purpose = WORKOUT_PURPOSE[d.workoutId];
      if (!purpose) fail(`${wk} day ${di + 1}: '${d.workoutId}' has no WORKOUT_PURPOSE entry`);
      if (purpose === 'test') fail(`${wk} day ${di + 1}: FTP test scheduled as training`);
      if (workout.pain) fail(`${wk} day ${di + 1}: pain workout '${d.workoutId}' selected`);
      if (!(d.plannedSeconds > 0)) fail(`${wk} day ${di + 1}: plannedSeconds ${d.plannedSeconds}`);
      // Rotation bookkeeping.
      const m = pickCounts[d.purpose] || (pickCounts[d.purpose] = new Map());
      m.set(d.workoutId, (m.get(d.workoutId) || 0) + 1);
    });

    // Invariant 6: no two adjacent high-stress sessions within a week.
    for (let i = 1; i < w.days.length; i++) {
      if (isHighStress(w.days[i].purpose) && isHighStress(w.days[i - 1].purpose)) {
        fail(`${wk}: back-to-back high-stress sessions (${w.days[i - 1].purpose} → ${w.days[i].purpose})`);
      }
    }

    // Invariant 7: weekly planned time never exceeds the stated budget.
    if (w.plannedSeconds > budget + 300) {
      fail(`${wk}: ${(w.plannedSeconds / 3600).toFixed(1)}h planned exceeds ${input.weeklyHours}h budget`);
    }
  });

  // Invariant 8: rotation actually rotates. Within one plan, for any purpose
  // with a real pool (3+ candidates) and enough picks to judge (6+), no single
  // workout may take more than 60% of that purpose's selections.
  for (const [purpose, m] of Object.entries(pickCounts)) {
    const picks = [...m.values()].reduce((a, b) => a + b, 0);
    const pool = LIBRARY.filter(w => WORKOUT_PURPOSE[w.id] === purpose && !w.pain).length;
    if (picks >= 6 && pool >= 3) {
      for (const [id, count] of m) {
        if (count / picks > 0.6) fail(`Rotation: '${id}' took ${count}/${picks} of '${purpose}' picks (pool ${pool})`);
      }
    }
  }

  // Invariant 9: the planner's own validator agrees.
  const v = validatePlan(plan);
  if (!v.ok) fail(`validatePlan failed: ${v.errors.join(' | ')}`);
}

// --- Library-level guard: every non-pain workout must be purpose-tagged ---
// (a missing WORKOUT_PURPOSE silently excludes a workout from all planning).
const untagged = LIBRARY.filter(w => !w.pain && !WORKOUT_PURPOSE[w.id]);
untagged.forEach(w => failures.push(`Library: '${w.id}' (${w.name}) has no WORKOUT_PURPOSE — silently excluded from planning`));
const paintagged = LIBRARY.filter(w => w.pain && WORKOUT_PURPOSE[w.id]);
paintagged.forEach(w => failures.push(`Library: pain workout '${w.id}' HAS a WORKOUT_PURPOSE — it would enter plans`));

// --- Core sweep ---
for (const goalKey of GOAL_KEYS)
  for (const totalWeeks of WEEKS)
    for (const daysPerWeek of DAYS)
      for (const weeklyHours of HOURS)
        for (const multiSport of MULTI)
          for (const trainingAge of TRAINING_AGE)
            for (const riderAgeBand of AGE_BAND)
              for (const recentWeeklyTss of RECENT_TSS)
                checkPlan({ goalKey, totalWeeks, daysPerWeek, weeklyHours, multiSport, trainingAge, riderAgeBand, recentWeeklyTss });

// --- Weighted "big day" sweep (every session index, representative combos) ---
for (const goalKey of GOAL_KEYS)
  for (const daysPerWeek of DAYS)
    for (let weightedDayIndex = 0; weightedDayIndex < daysPerWeek; weightedDayIndex++)
      for (const weeklyHours of [3, 8, 12])
        checkPlan({ goalKey, totalWeeks: 8, daysPerWeek, weeklyHours, multiSport: false, trainingAge: null, riderAgeBand: null, recentWeeklyTss: 0, weightedDayIndex });

// --- Progression-levels sweep (Stage 1.3 scoring factor active) ---
// Build three synthetic riders: one at the bottom of every purpose's
// difficulty range, one mid, one at the top — plus the real defaults each
// training age produces with no history — and assert every invariant still
// holds with the difficulty-fit factor switched on. The rotation invariant
// is the important one here: it's what catches this factor ever starting to
// dominate selection the way duration-fit once did.
const diffPools = {};
for (const w of LIBRARY) {
  const p = WORKOUT_PURPOSE[w.id];
  if (!p || p === 'test' || w.pain) continue;
  (diffPools[p] || (diffPools[p] = [])).push(workoutDifficulty(w));
}
const syntheticLevelSets = [0, 0.5, 1].map(frac => {
  const levels = {};
  for (const [p, ds] of Object.entries(diffPools)) {
    const lo = Math.min(...ds), hi = Math.max(...ds);
    levels[p] = Math.round((lo + (hi - lo) * frac) * 10) / 10;
  }
  return levels;
});
for (const age of ['new', 'developing', 'established']) {
  syntheticLevelSets.push(progressionLevels([], LIBRARY, age));
}
for (const levels of syntheticLevelSets)
  for (const goalKey of GOAL_KEYS)
    for (const daysPerWeek of [3, 4, 6])
      for (const weeklyHours of [3, 6, 12])
        for (const totalWeeks of [8, 16])
          checkPlan({ goalKey, totalWeeks, daysPerWeek, weeklyHours, multiSport: false, trainingAge: null, riderAgeBand: null, recentWeeklyTss: 0, progressionLevels: levels });


// ============================================================================
// Stage 2 scenario suite: check-ins and repair proposals
// ============================================================================
// For representative plans, synthesise realistic histories (missed weeks,
// missed key sessions, overshooting load, easy-rated hard sessions with a
// stale FTP), collect the proposals the engine produces, APPLY each one, and
// assert every invariant still holds on the resulting plan. Also asserts the
// proposals themselves behave: they fire when they should, cap at 3, and
// stay dismissed once dismissed.

function historyFor(plan, weekNumbers, { share = 1, effortRating = null, tssScale = 1 } = {}) {
  // Synthesise completed sessions for the given plan weeks: `share` of each
  // week's days ridden, TSS scaled by tssScale, dated inside the week window.
  const out = [];
  let n = 0;
  for (const wn of weekNumbers) {
    const w = plan.weeks.find(x => x.weekNumber === wn);
    if (!w) continue;
    const { start } = planWeekWindow(plan, wn);
    const count = Math.round(w.days.length * share);
    w.days.slice(0, count).forEach((d, i) => {
      out.push({
        id: 'syn' + (n++), workoutId: d.workoutId, date: new Date(start.getTime() + (i + 0.5) * 86400000).toISOString(),
        completed: true, tss: Math.round((d.plannedTss || 0) * tssScale), effortRating, outdoor: false,
      });
    });
  }
  return out;
}

function agedPlan(plan, weeksElapsed) {
  // Re-date the plan so `weeksElapsed` full weeks sit in the past.
  return { ...plan, createdAt: new Date(Date.now() - weeksElapsed * 7 * 86400000 - 3600000).toISOString() };
}

let scenarioCount = 0;
const scenarioCombos = [];
for (const goalKey of ['general-fitness', 'road-race', 'century', 'triathlon-bike'])
  for (const [daysPerWeek, weeklyHours] of [[3, 4], [4, 8], [6, 12]])
    for (const multiSport of [false, goalKey === 'triathlon-bike'])
      scenarioCombos.push({ goalKey, totalWeeks: 8, daysPerWeek, weeklyHours, multiSport, trainingAge: null, riderAgeBand: null, recentWeeklyTss: 0 });

for (const input of scenarioCombos) {
  const base = generatePlan({ ...input, library: LIBRARY, currentFtp: 200 });

  // --- Scenario A: week mostly missed → reentry proposal, applied ---
  {
    const plan = agedPlan(base, 3); // weeks 1-3 in the past, week 4 current
    const hist = [
      ...historyFor(plan, [1, 2], { share: 1 }),
      ...historyFor(plan, [3], { share: 0 }), // week 3 fully missed
    ];
    const props = planProposals({ plan, workoutHistory: hist, ftpHistory: [], library: LIBRARY });
    const reentry = props.find(p => p.kind === 'reentry');
    if (!reentry) failures.push(`Scenario A: no reentry proposal after fully-missed week\n    at ${JSON.stringify(input)}`);
    else {
      const applied = applyPlanProposal(plan, reentry, LIBRARY);
      assertPlan(applied, input, '[scenario A reentry]');
      // The REMAINING plan's total load must drop. (The re-entry week itself
      // can legitimately rise when it replaces a now-pointless deload week —
      // it's the block as a whole that has to ease off.)
      const sumFrom = p => p.weeks.filter(w => w.weekNumber >= reentry.params.fromWeek).reduce((a, w) => a + w.targetTss, 0);
      if (sumFrom(applied) >= sumFrom(plan)) failures.push(`Scenario A: remaining load ${sumFrom(applied)} not below original ${sumFrom(plan)}\n    at ${JSON.stringify(input)}`);
      scenarioCount++;
    }
  }

  // --- Scenario B: overshooting load → pull-recovery proposal, applied ---
  {
    const plan = agedPlan(base, 2);
    const hist = historyFor(plan, [1, 2], { share: 1, tssScale: 1.3 });
    const props = planProposals({ plan, workoutHistory: hist, ftpHistory: [], library: LIBRARY });
    const pull = props.find(p => p.kind === 'pull-recovery');
    if (pull) {
      const applied = applyPlanProposal(plan, pull, LIBRARY);
      assertPlan(applied, input, '[scenario B pull-recovery]');
      const w = applied.weeks.find(x => x.weekNumber === pull.params.weekNumber);
      if (!w.isRecovery) failures.push(`Scenario B: pulled week not marked recovery\n    at ${JSON.stringify(input)}`);
      scenarioCount++;
    }
    const health = planHealth(plan, hist);
    if (health.status !== 'running-hot') failures.push(`Scenario B: 130% actuals not flagged running-hot (got ${health.status})\n    at ${JSON.stringify(input)}`);
  }

  // --- Scenario C: on-track rider → NO noisy proposals ---
  {
    const plan = agedPlan(base, 2);
    const hist = historyFor(plan, [1, 2], { share: 1, effortRating: 3 });
    const props = planProposals({ plan, workoutHistory: hist, ftpHistory: [{ date: new Date().toISOString(), ftp: 250 }], library: LIBRARY });
    const loud = props.filter(p => p.kind !== 'note');
    if (loud.length) failures.push(`Scenario C: on-track rider got proposals: ${loud.map(p => p.kind).join(',')}\n    at ${JSON.stringify(input)}`);
    const health = planHealth(plan, hist);
    if (health.status !== 'on-track') failures.push(`Scenario C: full compliance not on-track (got ${health.status})\n    at ${JSON.stringify(input)}`);
  }

  // --- Scenario D: stale FTP + hard sessions rated easy → retest, applied ---
  {
    const plan = agedPlan(base, 2);
    const hist = historyFor(plan, [1, 2], { share: 1, effortRating: 2 });
    const staleFtp = [{ date: new Date(Date.now() - 70 * 86400000).toISOString(), ftp: 250 }];
    const props = planProposals({ plan, workoutHistory: hist, ftpHistory: staleFtp, library: LIBRARY });
    const retest = props.find(p => p.kind === 'ftp-retest');
    if (retest) {
      const applied = applyPlanProposal(plan, retest, LIBRARY);
      const day = applied.weeks.find(w => w.weekNumber === retest.params.weekNumber).days[retest.params.dayIndex];
      if (day.workoutId !== 'ramp-ftp-test') failures.push(`Scenario D: test day not scheduled\n    at ${JSON.stringify(input)}`);
      // A test day is deliberate; invariant 5 forbids tests only for normal
      // slots, so validate the rest of the plan via validatePlan instead.
      const v = validatePlan(applied);
      if (!v.ok) failures.push(`Scenario D: validatePlan failed after retest: ${v.errors.join('|')}\n    at ${JSON.stringify(input)}`);
      scenarioCount++;
    }
  }

  // --- Scenario E: dismissal is remembered ---
  {
    const plan = agedPlan(base, 3);
    const hist = historyFor(plan, [1, 2], { share: 1 });
    const props = planProposals({ plan, workoutHistory: hist, ftpHistory: [], library: LIBRARY });
    if (props.length) {
      const dismissedPlan = { ...plan, dismissedProposals: props.map(p => p.id) };
      const again = planProposals({ plan: dismissedPlan, workoutHistory: hist, ftpHistory: [], library: LIBRARY });
      const repeats = again.filter(p => props.some(q => q.id === p.id));
      if (repeats.length) failures.push(`Scenario E: dismissed proposals returned: ${repeats.map(p => p.id).join(',')}\n    at ${JSON.stringify(input)}`);
    }
  }

  // --- Scenario F: every check-in answer produces a valid plan ---
  for (const feedback of ['too-easy', 'about-right', 'too-hard', 'missed-a-lot']) {
    const adjusted = applyCheckin(base, 2, feedback, LIBRARY, feedback === 'missed-a-lot' ? 'fatigue' : null);
    assertPlan(adjusted, input, `[scenario F checkin:${feedback}]`);
    scenarioCount++;
  }
}
console.log(`Stage 2 scenarios exercised: ${scenarioCount} applied adjustments across ${scenarioCombos.length} plan shapes.`);

// --- Report ---
if (failures.length) {
  // De-duplicate identical failure messages so a systemic bug prints once
  // with a count instead of thousands of times.
  const seen = new Map();
  for (const f of failures) {
    const key = f.split('\n')[0];
    if (!seen.has(key)) seen.set(key, { count: 0, example: f });
    seen.get(key).count++;
  }
  console.log(`FAIL — ${failures.length} violation(s) across ${plansChecked} plans / ${weeksChecked} weeks (${seen.size} distinct):\n`);
  for (const { count, example } of seen.values()) {
    console.log(`[x${count}] ${example}\n`);
  }
  process.exit(1);
} else {
  console.log(`PASS — ${plansChecked} plans / ${weeksChecked} weeks checked, all invariants hold.`);
}
