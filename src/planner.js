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
//   tempo      — sustained moderate, controlled-hard pace
//   sweetspot  — structured blocks just under threshold (~88-94% FTP) —
//                harder and more targeted than tempo, a notch below
//                threshold work itself
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
  'sweet-spot-builder': 'sweetspot',
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
  // --- New: short climbing rides (unlock climbing for normal time budgets) ---
  'ride-lunch-climb': 'climbing',
  'ride-hill-repeats': 'climbing',
  'ride-punchy-climb-express': 'climbing',
  // --- New: real-world tempo ride (tempo previously had no Rides option) ---
  'ride-valley-sweetspot': 'sweetspot',
  // --- New: recovery ride, and a longer VO2 grinder ---
  'ride-country-recovery': 'recovery',
  'ride-vo2-furnace': 'vo2max',
  // --- New: round-number batch (1 Basics + 4 Rides) ---
  'sprint-ladder': 'anaerobic',
  'ride-strade-bianche': 'race',
  'ride-team-time-trial': 'threshold',
  'ride-bridge-to-break': 'vo2max',
  'ride-mallorca-312': 'endurance',
  // --- 30 new rides: tempo/sweetspot deepened from 0 real Rides, plus
  // gap-filling across anaerobic/race/threshold/vo2max/recovery/endurance ---
  'ride-harbor-circuit': 'tempo',
  'ride-canal-towpath': 'tempo',
  'ride-border-run': 'tempo',
  'ride-orchard-backroads': 'tempo',
  'ride-reservoir-ring': 'tempo',
  'ride-delta-causeway': 'tempo',
  'ride-quarry-climb-ladder': 'sweetspot',
  'ride-meadowline-rollers': 'sweetspot',
  'ride-timber-road-sweetspot': 'sweetspot',
  'ride-twin-peaks-sweep': 'sweetspot',
  // --- 5 new endurance + 2 new sweet spot: fill duration gaps (endurance
  // 55-100min was thin; sweet spot was thin at 45-60min and 95-125min) ---
  'ride-rolling-reserve': 'endurance',
  'ride-race-legs': 'endurance',
  'ride-foothills': 'endurance',
  'ride-ziggurat': 'endurance',
  'ride-rising-tide': 'endurance',
  'ride-hollow-road-sweetspot': 'sweetspot',
  'ride-tableland-traverse': 'sweetspot',
  'ride-velodrome-nights': 'anaerobic',
  'ride-alleycat-dash': 'anaerobic',
  'ride-match-play': 'anaerobic',
  'ride-closing-speed-repeats': 'anaerobic',
  'ride-twilight-crit': 'race',
  'ride-crossroads-sprint-circuit': 'race',
  'ride-puncheurs-ambush': 'race',
  'ride-points-race-series': 'race',
  'ride-the-straight-line': 'threshold',
  'ride-spine-road-threshold': 'threshold',
  'ride-alone-at-the-front': 'threshold',
  'ride-city-skyline-intervals': 'vo2max',
  'ride-watchtower-repeats': 'vo2max',
  'ride-the-long-escape': 'vo2max',
  'ride-garden-path-spin': 'recovery',
  'ride-quiet-streets-loop': 'recovery',
  'ride-watermill-loop': 'endurance',
  // --- 25 new rides: fill three under-served duration bands (20-30min,
  // 30-50min, 51-75min). Zero climbing added on purpose (already over-
  // represented); the four crit/race rides are the library's first sub-75min
  // race simulations. ---
  'ride-loose-legs-spin': 'recovery',
  'ride-flush-lap': 'recovery',
  'ride-short-fuse': 'vo2max',
  'ride-three-minute-warning': 'vo2max',
  'ride-matchstick': 'anaerobic',
  'ride-commuter-miles': 'endurance',
  'ride-fireroad-amble': 'endurance',
  'ride-towpath-ramble': 'endurance',
  'ride-downtown-crit': 'race',
  'ride-alley-sprint-series': 'race',
  'ride-chase-group': 'race',
  'ride-redline-ledge': 'threshold',
  'ride-steady-burn': 'threshold',
  'ride-corridor-run': 'sweetspot',
  'ride-ridge-line': 'sweetspot',
  'ride-long-straightaway': 'tempo',
  'ride-steady-state-special': 'tempo',
  'ride-cruise-control': 'tempo',
  'ride-wide-open-road': 'tempo',
  'ride-overpass-circuit': 'sweetspot',
  'ride-backbone-ridge': 'sweetspot',
  'ride-causeway-crossing': 'sweetspot',
  'ride-anvil-work': 'threshold',
  'ride-the-grind': 'threshold',
  'ride-midweek-crit': 'race',
};

// Human-readable labels for each purpose (used in the UI on day rows).
export const PURPOSE_LABEL = {
  recovery: 'Recovery',
  endurance: 'Endurance',
  tempo: 'Tempo',
  sweetspot: 'Sweet Spot',
  threshold: 'Threshold',
  vo2max: 'VO2 max',
  anaerobic: 'Anaerobic / sprint',
  climbing: 'Climbing',
  race: 'Race simulation',
  test: 'FTP test',
};

// ---------------------------------------------------------------------------
// 1b. Terrain / character tags (a SECOND, independent axis)
// ---------------------------------------------------------------------------
// WORKOUT_PURPOSE (above) answers "how hard does this stress me?" and is
// load-bearing: the safety rules, the swap system and the slot picker all key
// off it. This map answers a *different* question — "what does this ride feel
// like?" — and is deliberately kept separate so it can't disturb any of that.
//
// It exists so two same-purpose workouts stop being interchangeable to the
// generator. "Steady endurance hour" and "Coastal Rollers" are both
// 'endurance' by purpose, but one is a flat indoor grind and the other is a
// rolling seaside ride with a sprint and a climb — the terrain axis lets the
// picker prefer variety across a week and lean on the richer real-world Rides
// once a rider is past base phase, instead of always defaulting to the
// plainest option.
//
// Each workout carries one or more terrain tags (most-defining first).
// Vocabulary (kept small on purpose):
//   flat        — steady, little elevation change
//   rolling     — gentle repeated ups and downs, no single big climb
//   sustained-climb — one or more long, steady climbs
//   steep       — short savage gradients / wall climbs
//   punchy      — repeated short sharp accelerations or surges
//   cobbles     — pavé / rough classics terrain
//   gravel      — unpaved / mixed-surface sectors
//   windy       — crosswinds, echelons, headwind fights
//   mixed       — a varied narrative route touching several of the above
//   scenic      — easy-going / social character (café pace, recovery)
//   hairpins    — switchback climbing: repeated surge-out-of-the-corner efforts
//   multi-climb — several distinct climbs linked by descents (not one long ascent)
//   urban       — stop-start city/street riding (traffic lights, tight blocks)
//   criterium   — tight, technical, repeated-lap closed-circuit racing
//   paceline    — organized group/rotating-paceline dynamic, not a solo effort
//
// NOTE: 'hairpins' and 'multi-climb' were added purely to give the freshness
// picker a way to tell the big climbing rides apart (previously ~13 of them
// shared the exact same tag set and were interchangeable to the generator).
// 'urban', 'criterium' and 'paceline' were added the same way, for the same
// reason, in a smaller VO2max/anaerobic/race pool: several candidates shared
// nothing but a single generic tag (e.g. 'punchy' alone). All five are
// ADDITIVE: existing tags on every workout are left in place, these are only
// appended where they genuinely apply — and only backdated onto existing
// workouts whose own description already describes that exact scenario.
// ---------------------------------------------------------------------------
export const WORKOUT_TERRAIN = {
  // --- Basics (indoor structure; terrain is abstract but still varies) ---
  'ramp-ftp-test': ['flat'],
  'ftp-test-20': ['flat'],
  'endurance-hour': ['flat'],
  'rolling-endurance': ['rolling'],
  'sweet-spot-builder': ['sustained-climb'],
  'threshold-2x20': ['sustained-climb'],
  'vo2-5x3': ['punchy'],
  'tabata-torch': ['punchy'],
  'over-unders': ['sustained-climb'],
  'rpe-fartlek': ['mixed'],
  'recovery-spin': ['scenic'],
  'pyramid-power': ['mixed'],
  'mixed-metric': ['mixed'],
  'vo2-40-20-double': ['punchy'],
  // --- Rides (real-world feel) ---
  'ride-sunday-club': ['rolling', 'scenic', 'punchy', 'paceline'],
  'ride-chaingang': ['flat', 'windy', 'paceline'],
  'ride-century-sim': ['mixed', 'flat', 'sustained-climb'],
  'ride-coastal-rollers': ['rolling', 'windy', 'punchy'],
  'ride-alpine-ascent': ['sustained-climb', 'hairpins'],
  'ride-gravel-grinder': ['gravel', 'punchy', 'rolling'],
  'ride-crosswind-echelon': ['windy', 'flat'],
  'ride-breakaway-glory': ['mixed', 'punchy'],
  'ride-audax-200': ['flat', 'scenic'],
  'ride-crit-sim': ['punchy', 'criterium'],
  'ride-cafe-ride': ['scenic', 'rolling'],
  'ride-cobbled-classics': ['cobbles', 'steep'],
  'ride-group-surges': ['punchy', 'rolling', 'paceline'],
  'ride-hilly-fondo': ['sustained-climb', 'rolling'],
  'ride-tt-tuneup': ['flat'],
  'ride-rainy-survival': ['mixed', 'flat'],
  'ride-night-steady': ['rolling', 'scenic'],
  'ride-everesting-lite': ['sustained-climb', 'steep'],
  'ride-breakaway-stage': ['mixed', 'windy', 'punchy'],
  'ride-monument-classics': ['cobbles', 'steep'],
  'ride-bikepacking-haul': ['gravel', 'flat', 'scenic'],
  'ride-mountain-double': ['sustained-climb', 'multi-climb'],
  'ride-urban-commute': ['punchy', 'flat', 'urban'],
  'ride-recovery-cruise': ['scenic', 'flat'],
  'ride-leadout-day': ['punchy', 'flat'],
  'ride-ridge-traverse': ['rolling', 'windy', 'punchy'],
  'ride-volcano-rim': ['sustained-climb', 'steep'],
  'ride-desert-crossing': ['flat', 'windy'],
  'ride-fjord-switchbacks': ['steep', 'sustained-climb', 'hairpins'],
  'ride-highland-loop': ['rolling', 'windy', 'sustained-climb'],
  'ride-dolomites-double': ['sustained-climb', 'steep', 'multi-climb'],
  'ride-wine-country': ['rolling'],
  'ride-moorland-crossing': ['windy', 'gravel', 'flat'],
  'ride-canyon-rim': ['steep', 'punchy'],
  'ride-alpine-col-chain': ['sustained-climb', 'multi-climb'],
  'ride-anti-gravity': ['sustained-climb', 'steep'],
  'ride-storm-chase': ['windy', 'punchy'],
  'ride-tt-through-time': ['flat', 'sustained-climb'],
  'ride-the-gauntlet': ['steep', 'sustained-climb'],
  'ride-migration-flock': ['windy', 'flat', 'rolling'],
  'ride-ironman-nice': ['flat', 'sustained-climb'],
  'ride-ironman-kona': ['flat', 'windy'],
  'ride-ironman-lanzarote': ['windy', 'steep', 'sustained-climb'],
  'ride-pyrenees-circle-of-death': ['sustained-climb', 'multi-climb'],
  'ride-giro-stelvio': ['sustained-climb', 'hairpins'],
  'ride-giro-zoncolan': ['steep'],
  'ride-giro-finestre': ['sustained-climb', 'gravel', 'steep'],
  'ride-tour-ventoux': ['sustained-climb', 'windy'],
  'ride-tour-alpe-dhuez': ['sustained-climb', 'hairpins'],
  'ride-tour-galibier': ['sustained-climb'],
  'ride-paris-roubaix': ['cobbles', 'flat'],
  'ride-tour-of-flanders': ['cobbles', 'steep'],
  'ride-liege-bastogne-liege': ['rolling', 'sustained-climb'],
  'ride-milan-san-remo': ['flat', 'punchy'],
  'ride-vuelta-angliru': ['steep', 'sustained-climb'],
  // --- New short climbing rides ---
  'ride-lunch-climb': ['sustained-climb'],
  'ride-hill-repeats': ['steep', 'hairpins'],
  'ride-punchy-climb-express': ['rolling', 'sustained-climb'],
  // --- New tempo / recovery / VO2 rides ---
  'ride-valley-sweetspot': ['rolling', 'scenic'],
  'ride-country-recovery': ['scenic', 'flat'],
  'ride-vo2-furnace': ['punchy'],
  // --- New round-number batch ---
  'sprint-ladder': ['punchy'],
  'ride-strade-bianche': ['gravel', 'steep', 'punchy'],
  'ride-team-time-trial': ['flat', 'windy', 'paceline'],
  'ride-bridge-to-break': ['rolling', 'punchy'],
  'ride-mallorca-312': ['rolling', 'sustained-climb', 'windy', 'scenic'],
  // --- 30 new rides ---
  'ride-harbor-circuit': ['rolling', 'punchy'],
  'ride-canal-towpath': ['flat', 'punchy'],
  'ride-border-run': ['flat', 'windy'],
  'ride-orchard-backroads': ['rolling', 'scenic'],
  'ride-reservoir-ring': ['rolling'],
  'ride-delta-causeway': ['flat', 'windy', 'punchy'],
  'ride-quarry-climb-ladder': ['sustained-climb'],
  'ride-meadowline-rollers': ['rolling'],
  'ride-timber-road-sweetspot': ['sustained-climb', 'windy'],
  'ride-twin-peaks-sweep': ['sustained-climb', 'rolling'],
  'ride-rolling-reserve': ['rolling'],
  'ride-race-legs': ['punchy', 'criterium'],
  'ride-foothills': ['rolling', 'steep', 'punchy'],
  'ride-ziggurat': ['mixed'],
  'ride-rising-tide': ['flat'],
  'ride-hollow-road-sweetspot': ['flat', 'scenic'],
  'ride-tableland-traverse': ['flat', 'windy'],
  'ride-velodrome-nights': ['punchy'],
  'ride-alleycat-dash': ['punchy', 'urban'],
  'ride-match-play': ['punchy', 'mixed'],
  'ride-closing-speed-repeats': ['punchy', 'criterium'],
  'ride-twilight-crit': ['punchy', 'criterium'],
  'ride-crossroads-sprint-circuit': ['rolling', 'punchy', 'paceline'],
  'ride-puncheurs-ambush': ['steep', 'punchy'],
  'ride-points-race-series': ['punchy', 'mixed'],
  'ride-the-straight-line': ['flat'],
  'ride-spine-road-threshold': ['rolling'],
  'ride-alone-at-the-front': ['mixed'],
  'ride-city-skyline-intervals': ['punchy', 'urban'],
  'ride-watchtower-repeats': ['rolling', 'punchy'],
  'ride-the-long-escape': ['mixed', 'windy'],
  'ride-garden-path-spin': ['scenic', 'flat'],
  'ride-quiet-streets-loop': ['scenic', 'rolling'],
  'ride-watermill-loop': ['flat', 'scenic'],
  // --- 25 new rides (duration-gap fill) ---
  'ride-loose-legs-spin': ['scenic'],
  'ride-flush-lap': ['scenic'],
  'ride-short-fuse': ['punchy'],
  'ride-three-minute-warning': ['punchy'],
  'ride-matchstick': ['punchy', 'urban'],
  'ride-commuter-miles': ['flat', 'urban'],
  'ride-fireroad-amble': ['rolling', 'gravel'],
  'ride-towpath-ramble': ['flat', 'scenic'],
  'ride-downtown-crit': ['criterium', 'urban'],
  'ride-alley-sprint-series': ['criterium', 'punchy'],
  'ride-chase-group': ['paceline', 'punchy'],
  'ride-redline-ledge': ['sustained-climb'],
  'ride-steady-burn': ['mixed'],
  'ride-corridor-run': ['flat', 'scenic'],
  'ride-ridge-line': ['rolling'],
  'ride-long-straightaway': ['flat', 'windy'],
  'ride-steady-state-special': ['flat'],
  'ride-cruise-control': ['flat', 'scenic'],
  'ride-wide-open-road': ['flat', 'windy'],
  'ride-overpass-circuit': ['flat', 'urban'],
  'ride-backbone-ridge': ['rolling', 'sustained-climb'],
  'ride-causeway-crossing': ['flat', 'windy'],
  'ride-anvil-work': ['mixed'],
  'ride-the-grind': ['mixed'],
  'ride-midweek-crit': ['criterium', 'paceline'],
};

// Human-readable labels for each terrain tag (for any UI that surfaces them).
export const TERRAIN_LABEL = {
  flat: 'Flat', rolling: 'Rolling', 'sustained-climb': 'Sustained climb',
  steep: 'Steep', punchy: 'Punchy', cobbles: 'Cobbles', gravel: 'Gravel',
  windy: 'Windy', mixed: 'Mixed', scenic: 'Scenic',
  hairpins: 'Hairpins', 'multi-climb': 'Multi-climb',
  urban: 'Urban', criterium: 'Criterium', paceline: 'Paceline',
};

// Which purposes count as "high stress" for the hard/easy spacing rule.
// Sweet spot (~88-94% FTP structured blocks) is meaningfully more fatiguing
// than tempo and belongs in the same tier as threshold, not with the
// easy/moderate purposes below.
const HIGH_STRESS = new Set(['threshold', 'vo2max', 'anaerobic', 'race', 'sweetspot']);
export function isHighStress(purpose) { return HIGH_STRESS.has(purpose); }

// Purposes whose duration we freely scale after picking (see enforceTimeBudget
// and the scaling pass in the generator). Because these get resized to fit the
// week anyway, the picker's duration-fit term (rule 5) should NOT apply to them
// — only to the fixed-length quality sessions we keep at native length.
// Sweet spot stays OUT of this set deliberately: like threshold, it's
// structured block work that shouldn't be arbitrarily trimmed the way a
// flowing tempo or endurance ride can be.
const FIXED_LENGTH_EXEMPT = new Set(['endurance', 'recovery', 'tempo']);

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

// Fallback TSS estimate for a ride with no power data at all — e.g. a
// confirmed outdoor ride logged after the fact. Uses the same RPE→intensity
// table and TSS formula as estimateWorkoutTss above, just applied as one flat
// intensity across the whole duration rather than per-interval, so an
// outdoor ride's estimated load sits on the same scale as everything else
// feeding the planner's ramp instead of a second, inconsistent formula.
export function estimateOutdoorTss(durationSeconds, rpe) {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  const ifactor = rpeToIntensityFactor(rpe);
  return Math.round((durationSeconds / 3600) * ifactor * ifactor * 100);
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
    emphasis: { endurance: 3, tempo: 1, sweetspot: 1, threshold: 2, vo2max: 1 },
  },
  'ftp-builder': {
    label: 'FTP builder',
    blurb: 'Raise your threshold power over a block of focused training.',
    hasEvent: false,
    // Sweet spot is the classic FTP-raising tool, so it gets the larger
    // share of what was one combined 'tempo' weight.
    emphasis: { threshold: 3, tempo: 1, sweetspot: 2, endurance: 2, vo2max: 1 },
  },
  'century': {
    label: 'Century / gran fondo',
    blurb: 'Prepare for a long endurance day in the saddle.',
    hasEvent: true,
    emphasis: { endurance: 4, tempo: 1, sweetspot: 1, threshold: 1 },
    // A 100-mile route usually has some real elevation. This doesn't compete
    // with the weighted mix above (which already guarantees the tempo/
    // threshold day every week) — it's an occasional extra, swapped in on
    // top of that roughly once every few weeks. See maybeInjectPeriodicPurpose.
    periodicPurpose: { purpose: 'climbing', loadingWeeksPerCycle: 3 },
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
    emphasis: { threshold: 4, tempo: 1, sweetspot: 1, endurance: 1, vo2max: 1 },
  },
  'triathlon-bike': {
    label: 'Triathlon (bike leg)',
    blurb: 'Bike-specific block that leaves room for your run and swim training.',
    hasEvent: true,
    // Endurance-led and deliberately gentler on top-end (see multi-sport
    // conservatism applied in generatePlan) so it doesn't wreck run days.
    // Sweet spot deliberately excluded here (not just left at a low weight)
    // — it's a genuinely harder stimulus than tempo, which cuts against the
    // "gentler" intent of this goal.
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
  // Riders new to structured training ramp load more conservatively too —
  // not because they can't handle volume, but because connective tissue and
  // movement economy lag behind early cardiovascular gains. Takes whichever
  // cap is lower rather than stacking with the multi-sport discount.
  maxRampNewRider: 0.05,
  recoveryMultiplier: 0.55, // deload week = ~55% of the week before
  taperMultiplier: 0.5,     // taper weeks shed volume
  peakMultiplier: 0.85,     // peak eases volume vs late build
};

// `trainingAge` (optional): 'new' | 'developing' | 'established' — a coarse,
// self-reported bucket rather than exact years, so it reads as a skill level
// and not a number worth storing. Only 'new' changes anything right now.
// `lockedTargets` (optional): an array the same length as phaseByWeek where a
// non-null entry means "this week's target is fixed" (used when re-planning
// after a check-in — the weeks already ridden stay put, and the ramp continues
// smoothly from the last locked loading week).
export function weeklyLoadTargets({ startWeeklyTss, phaseByWeek, recoveryFlags, multiSport, trainingAge, lockedTargets }) {
  let maxRamp = multiSport ? RAMP.maxRampMulti : RAMP.maxRampSolo;
  if (trainingAge === 'new') maxRamp = Math.min(maxRamp, RAMP.maxRampNewRider);
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
export function weekPurposeSlots({ phase, daysPerWeek, goal, isRecovery, multiSport, riderAgeBand, library, weeklySecondsBudget, targetTss }) {
  if (isRecovery) {
    // Deload: mostly recovery + easy endurance, at most one light quality day.
    //
    // Cap the session count to what this week's (much lower) TSS target can
    // actually support at a worthwhile length. Without this, every flexible
    // ride below just gets scaled down by the same factor and clamped to the
    // 20-minute floor -- so a deep deload (e.g. stacked with a "missed a lot"
    // check-in) turns into several near-useless token rides instead of one
    // or two real ones. ~20 TSS is roughly a 35-40 minute ride at recovery
    // pace, a reasonable line for "worth getting on the bike for."
    const MIN_MEANINGFUL_RECOVERY_TSS = 28;
    const n = targetTss != null
      ? Math.min(daysPerWeek, Math.max(1, Math.floor(targetTss / MIN_MEANINGFUL_RECOVERY_TSS)))
      : daysPerWeek;
    const slots = [];
    for (let i = 0; i < n; i++) {
      slots.push(i === 0 && n >= 3 ? 'endurance' : 'recovery');
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
  const days = Math.max(1, daysPerWeek);
  // The time a single session realistically has. The picker treats 1.5x this as
  // the "comfortable" ceiling (easy days shrink to free up room for a quality
  // day), so we size feasibility the same way here.
  const comfortableSession = weeklySecondsBudget ? (weeklySecondsBudget / days) * 1.5 : Infinity;
  const durCache = {};
  // The duration the picker will most likely commit for this purpose given the
  // rider's session budget: the LONGEST workout that still fits comfortably, or
  // — if none fit — the SHORTEST available (so a purpose with only long options,
  // like climbing before the short rides existed, is judged by its shortest ride
  // rather than its average, and a short climb can still earn a slot on a tight
  // week instead of the whole purpose being dropped).
  function representativeDuration(purpose) {
    if (durCache[purpose] != null) return durCache[purpose];
    if (!library) return (durCache[purpose] = 3600);
    const durs = library
      .filter(w => WORKOUT_PURPOSE[w.id] === purpose && WORKOUT_PURPOSE[w.id] !== 'test')
      .map(w => w.intervals.reduce((x, y) => x + y.duration, 0));
    if (!durs.length) return (durCache[purpose] = 3600);
    const fitting = durs.filter(d => d <= comfortableSession);
    const val = fitting.length ? Math.max(...fitting) : Math.min(...durs);
    return (durCache[purpose] = val);
  }


  // Multi-sport riders get one fewer hard day (extra recovery headroom).
  // 55+ gets a modest further trim too — recovery capacity is the one thing
  // that reliably tracks with age even though individual variation is huge,
  // so this is a light nudge, not a hard rule.
  const ageHardDayFactor = riderAgeBand === '55plus' ? 0.85 : 1;
  const maxHardDays = Math.max(1, Math.floor(days * (multiSport ? 0.35 : 0.5) * ageHardDayFactor));
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
      const overTimeBudget = isFixedLength && (fixedSecondsCommitted + representativeDuration(candidate) > availableForFixed);
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
    if (!FLEXIBLE.has(candidate)) fixedSecondsCommitted += representativeDuration(candidate);
  }
  return slots;
}

// Pick a concrete library workout for a purpose. `library` is the app's
// LIBRARY array. Prefers workouts of the right purpose; falls back sensibly.

// ---------------------------------------------------------------------------
// 6b. Occasional goal-specific sessions (e.g. a climbing day for a century)
// ---------------------------------------------------------------------------
// Some goals want a purpose to show up occasionally without it competing in
// the main weighted mix above (which would either make it appear every week
// or never, since that mix is a deterministic pick each week, not a random
// draw). `goal.periodicPurpose = { purpose, loadingWeeksPerCycle }` instead
// swaps it in on a fixed cadence measured in LOADING weeks (recovery/taper
// weeks don't count, so "every 3 loading weeks" lines up with "once per
// 4-week block" for a normal solo rider's recovery cadence).
// ---------------------------------------------------------------------------

// 1-based count of loading (non-recovery, non-taper) weeks up to and
// including weekIndex (0-based index into phaseByWeek/recoveryFlags).
function loadingWeekOrdinal(phaseByWeek, recoveryFlags, weekIndex) {
  let count = 0;
  for (let i = 0; i <= weekIndex; i++) {
    if (phaseByWeek[i] !== 'taper' && !recoveryFlags[i]) count++;
  }
  return count;
}

// Returns a possibly-modified copy of `purposeSlots` for this week. Only
// ever replaces a spare endurance slot (never the guaranteed anchor at index
// 0, and never a tempo/threshold slot) so it's strictly additive to the
// mix the rest of the system already guarantees.
export function maybeInjectPeriodicPurpose(purposeSlots, goal, phaseByWeek, recoveryFlags, weekIndex) {
  const spec = goal.periodicPurpose;
  if (!spec) return purposeSlots;
  if (phaseByWeek[weekIndex] === 'taper' || recoveryFlags[weekIndex]) return purposeSlots;
  const ordinal = loadingWeekOrdinal(phaseByWeek, recoveryFlags, weekIndex);
  if (ordinal % spec.loadingWeeksPerCycle !== 0) return purposeSlots;

  // Find a spare endurance slot (not the index-0 anchor) to swap.
  let swapIndex = -1;
  for (let i = purposeSlots.length - 1; i >= 1; i--) {
    if (purposeSlots[i] === 'endurance') { swapIndex = i; break; }
  }
  if (swapIndex === -1) return purposeSlots; // no spare slot; skip this cycle rather than bump tempo/threshold

  const next = [...purposeSlots];
  next[swapIndex] = spec.purpose;
  return next;
}

// Pick a concrete library workout for a `purpose`. Beyond just filling the
// slot, this now shapes *which* workout of that purpose gets chosen so weeks
// feel varied and the richer library actually gets used. Preferences, in
// priority order:
//   1. Never repeat a workout already used this week (existing behaviour).
//   2. Prefer terrain the week hasn't seen yet (so two 'endurance' days
//      aren't both flat grinds — one might be coastal rollers instead).
//   3. Once past base phase, prefer the real-world "Rides" over the plainer
//      "Basics" where both share the purpose, so named routes (Alpe d'Huez,
//      Roubaix, etc.) come into play as the plan gets specific.
//   4. Rotate across WEEKS. Previously ties (very common inside the big
//      climbing/endurance pools, where many rides share a purpose AND terrain)
//      broke by library order every single week — so the same one workout got
//      picked over and over and 18 of 20 rides never appeared. `recentByPurpose`
//      is a small sliding window of recently-used ids per purpose; the more
//      recently a workout was used, the larger its penalty, so the picker walks
//      through the whole pool before coming back round.
//   5. Fit the rider's session length. For fixed-length quality sessions
//      (climbing, race, etc. — the ones we DON'T scale afterwards), prefer a
//      workout that actually fits the time a session realistically has, rather
//      than picking a 2.5h mountain epic and then crushing it down to fit. This
//      is what lets the new short climbs get chosen for a rider training in ~1h
//      sessions, while riders with big time budgets still get the full epics.
// `usedTerrainThisWeek` (a Set), `phase`, `recentByPurpose`, and
// `sessionSecondsHint` (the rough seconds a single session has) are all
// optional; when omitted the function still works and falls back to prior
// behaviour.
export function pickWorkoutForPurpose(purpose, library, usedIdsThisWeek, usedTerrainThisWeek, phase, recentByPurpose, sessionSecondsHint, recoveryMode) {
  let candidates = library.filter(w => WORKOUT_PURPOSE[w.id] === purpose && WORKOUT_PURPOSE[w.id] !== 'test');
  if (!candidates.length) {
    // Fallback chain so a slot is never empty.
    const fallbackOrder = {
      recovery: ['endurance'], tempo: ['sweetspot', 'endurance', 'threshold'],
      sweetspot: ['tempo', 'threshold'], threshold: ['sweetspot', 'tempo', 'vo2max'],
      vo2max: ['threshold', 'race'], anaerobic: ['vo2max', 'race'],
      climbing: ['threshold', 'endurance'], race: ['vo2max', 'threshold'],
      endurance: ['tempo'],
    };
    for (const alt of (fallbackOrder[purpose] || [])) {
      const altCands = library.filter(w => WORKOUT_PURPOSE[w.id] === alt);
      if (altCands.length) { candidates = altCands; break; }
    }
    if (!candidates.length) {
      return library.find(w => WORKOUT_PURPOSE[w.id] === 'endurance') || library[0];
    }
  }

  // Score every candidate; higher is better. Ties fall back to library order,
  // which keeps output stable and deterministic.
  const usedTerrain = usedTerrainThisWeek || new Set();
  const pastBase = phase && phase !== 'base';
  const recent = (recentByPurpose && recentByPurpose[purpose]) || [];
  // A single quality session can fairly run a bit longer than the flat weekly
  // average, because the flexible easy days shrink to make room. 1.5x the
  // average slot is the "comfortable" ceiling before a workout would have to be
  // compressed to fit. Only applied to purposes we keep at native length.
  // Endurance/recovery/tempo are normally exempt here because they get
  // rescaled to fit after picking, so native length doesn't matter for a
  // normal week. That assumption breaks in a recovery week: everything
  // flexible shares one scale factor, so one "epic" multi-hour native ride
  // picked alongside short recovery spins soaks up the week's whole time
  // budget while the others get scaled down to nothing. In recovery mode we
  // apply the same duration-fit penalty to flexible purposes too, using a
  // recovery-scaled hint, so a long native ride can't win a deload slot.
  const durationAware = sessionSecondsHint && (recoveryMode || !FIXED_LENGTH_EXEMPT.has(purpose));
  const comfortableSeconds = durationAware ? sessionSecondsHint * 1.5 : 0;
  function score(w) {
    let s = 0;
    // (1) Strongly avoid repeating an exact workout this week.
    if (usedIdsThisWeek && usedIdsThisWeek.has(w.id)) s -= 100;
    // (2) Reward terrain the week hasn't used yet — one point per fresh tag.
    const terrain = WORKOUT_TERRAIN[w.id] || [];
    const freshTags = terrain.filter(t => !usedTerrain.has(t)).length;
    s += freshTags * 10;
    // (3) Past base phase, nudge toward the real-world Rides over Basics.
    if (pastBase && w.category === 'Rides') s += 3;
    // (4) Cross-week rotation: penalise recently-used workouts, most-recent
    // hardest, decaying to nothing for older picks. Sized so the most recent
    // pick (penalty ~14) can overcome a single fresh-terrain tag (+10) — that's
    // what lets a small pool actually rotate instead of the one richest-tagged
    // workout winning every week forever (e.g. anaerobic, where Sprint Ladder
    // was otherwise unreachable behind Lead-Out Day). It stays below TWO fresh
    // tags (+20), so genuine within-week terrain variety still wins.
    const recIdx = recent.indexOf(w.id);
    if (recIdx >= 0) {
      const recency = recent.length - recIdx; // 1 = most recently used
      s -= Math.max(0, 14 - (recency - 1) * 3);
    }
    // (5) Duration fit for fixed-length quality sessions. Penalise workouts that
    // run past the comfortable session length (they'd be compressed) — half a
    // point per minute over, capped so it can override terrain/rotation and pull
    // in a genuinely short climb, but never so hard it breaks the pool for a
    // rider whose whole library of that purpose is long.
    if (durationAware) {
      const native = w.intervals.reduce((a, b) => a + b.duration, 0);
      const overMinutes = (native - comfortableSeconds) / 60;
      if (overMinutes > 0) s -= Math.min(45, overMinutes * 0.5);
    }
    return s;
  }

  let best = candidates[0];
  let bestScore = score(best);
  for (const w of candidates) {
    const sc = score(w);
    if (sc > bestScore) { best = w; bestScore = sc; }
  }
  return best;
}

// Record the terrain tags of a chosen workout into the week's used-terrain
// set (small helper so both the generator and the rebuild path stay in sync).
export function markTerrainUsed(usedTerrainThisWeek, workoutId) {
  (WORKOUT_TERRAIN[workoutId] || []).forEach(t => usedTerrainThisWeek.add(t));
}

// Record a chosen workout into the cross-week rotation memory for its purpose.
// `recentByPurpose` maps purpose -> array of recently used ids, OLDEST FIRST.
// We keep a sliding window (last WINDOW picks) so the penalty in the scorer
// always leaves at least a few options unpenalised even in small pools.
const ROTATION_WINDOW = 8;
export function markRecentlyUsed(recentByPurpose, purpose, workoutId) {
  if (!recentByPurpose) return;
  const list = recentByPurpose[purpose] || (recentByPurpose[purpose] = []);
  // If it was already in the window, drop the old entry so it moves to newest.
  const existing = list.indexOf(workoutId);
  if (existing >= 0) list.splice(existing, 1);
  list.push(workoutId);
  while (list.length > ROTATION_WINDOW) list.shift();
}

// List all valid swap options for a slot: same-purpose workouts from the
// library (this is what the swap UI shows). Excludes tests.
export function swapOptionsForPurpose(purpose, library) {
  return library.filter(w => WORKOUT_PURPOSE[w.id] === purpose && WORKOUT_PURPOSE[w.id] !== 'test');
}

// A rider can ask for one session a week to be the big one (e.g. "8 hours a
// week, but 4 of those in one big Saturday session"). This redistributes
// time WITHIN the week's already-flexible (length-adjustable) days --
// giving the chosen day a bigger share of that pool and shrinking the other
// flexible days to compensate -- rather than adding extra time on top, so
// the week's total planned time (and therefore its TSS target) is
// unaffected. Fixed-length interval sessions are never touched, since their
// structure can't be resized. Mutates nothing; returns a new `days` array.
const WEIGHTED_DAY_SHARE = 0.65; // the big day's target share of the flexible time pool
function applyWeightedDay(days, weightedDayIndex) {
  if (weightedDayIndex == null || weightedDayIndex < 0 || weightedDayIndex >= days.length) return days;
  const isFlex = d => !d.fixedLength && (d.purpose === 'endurance' || d.purpose === 'recovery' || d.purpose === 'tempo');
  const flexIndices = days.map((d, i) => (isFlex(d) ? i : -1)).filter(i => i >= 0);
  // Need the target day itself, plus at least one other flexible day to
  // shrink -- otherwise there's nothing to redistribute from/to.
  if (!flexIndices.includes(weightedDayIndex) || flexIndices.length < 2) return days;

  const flexTotal = flexIndices.reduce((sum, i) => sum + days[i].plannedSeconds, 0);
  const bigSeconds = Math.max(1200, Math.min(18000, Math.round(flexTotal * WEIGHTED_DAY_SHARE)));
  const remainingSeconds = Math.max(0, flexTotal - bigSeconds);
  const otherIndices = flexIndices.filter(i => i !== weightedDayIndex);
  const otherOriginalTotal = otherIndices.reduce((sum, i) => sum + days[i].plannedSeconds, 0) || 1;

  const next = days.slice();
  otherIndices.forEach(i => {
    const proportion = days[i].plannedSeconds / otherOriginalTotal;
    const newSeconds = Math.max(1200, Math.round(remainingSeconds * proportion));
    const ratio = newSeconds / days[i].plannedSeconds;
    next[i] = { ...days[i], plannedSeconds: newSeconds, plannedTss: Math.round(days[i].plannedTss * ratio) };
  });
  const bigRatio = bigSeconds / days[weightedDayIndex].plannedSeconds;
  next[weightedDayIndex] = { ...days[weightedDayIndex], plannedSeconds: bigSeconds, plannedTss: Math.round(days[weightedDayIndex].plannedTss * bigRatio) };
  return next;
}

// applyWeightedDay only reshuffles time within the length-flexible days, so
// a fixed-length interval session elsewhere in the week (a climbing or
// threshold day, say) can still end up longer in real minutes than the day
// we designated as "big" -- those never get resized, and their native
// length can outrun whatever the redistributed flex day was given. Rather
// than trust the designation, tag whichever day actually has the most
// planned time once everything (including budget enforcement) has settled,
// so the "Big day" badge always matches reality instead of defaulting to
// whichever session index was picked at generation time.
function tagActualBigDay(days, weightedDayIndex) {
  days.forEach(d => { delete d.isWeightedDay; });
  if (weightedDayIndex == null || weightedDayIndex < 0 || weightedDayIndex >= days.length) return;
  let maxIdx = 0;
  for (let i = 1; i < days.length; i++) {
    if (days[i].plannedSeconds > days[maxIdx].plannedSeconds) maxIdx = i;
  }
  days[maxIdx].isWeightedDay = true;
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
// 7. Weekday scheduling
// ---------------------------------------------------------------------------
// Sessions are generated as an ordered list per week ("Session 1", "Session
// 2", ...) with no link to the calendar. This maps each session slot onto an
// actual day of the week (Monday-start, matching the rest of the app's week
// bucketing — see the Monday-start helper in App.jsx) so the rider can see
// "Tuesday: Threshold" instead of just an unordered list. It's a labelling
// layer only: it doesn't change what gets picked or how the plan is built.
// ---------------------------------------------------------------------------
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAY_LABELS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Even spread across the 7-day week as a sensible starting point — e.g. 3
// sessions -> Mon/Wed/Sat, 4 -> Mon/Wed/Fri/Sat. Riders customise from here.
export function defaultWeekdayPattern(daysPerWeek) {
  const n = Math.max(1, Math.min(7, Math.round(daysPerWeek) || 1));
  if (n >= 7) return [0, 1, 2, 3, 4, 5, 6];
  const step = 7 / n;
  const seen = new Set();
  const pattern = [];
  for (let i = 0; i < n; i++) {
    let day = Math.round(i * step) % 7;
    while (seen.has(day)) day = (day + 1) % 7; // keep the default spread on distinct days
    seen.add(day);
    pattern.push(day);
  }
  return pattern;
}

// Keeps a weekday pattern in sync with a (possibly changed) session count,
// preserving as many of the rider's existing picks as possible: trims from
// the end if there are now fewer sessions, and pads with unused weekdays
// (falling back to the default spread) if there are more.
export function normalizeWeekdayPattern(pattern, daysPerWeek) {
  const n = Math.max(1, Math.min(7, Math.round(daysPerWeek) || 1));
  const base = Array.isArray(pattern) ? pattern.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  if (base.length >= n) return base.slice(0, n);
  const used = new Set(base);
  const fill = defaultWeekdayPattern(n).filter(d => !used.has(d));
  const next = base.slice();
  while (next.length < n && fill.length) next.push(fill.shift());
  while (next.length < n) next.push(defaultWeekdayPattern(n)[next.length % n]); // last-resort fallback
  return next;
}

// Rider-driven edit: assign a specific session slot to a specific weekday.
export function setWeekdayPattern(plan, pattern) {
  if (!plan) return plan;
  return { ...plan, weekdayPattern: normalizeWeekdayPattern(pattern, plan.daysPerWeek) };
}

// ---------------------------------------------------------------------------
// 8. Macrocycle chaining
// ---------------------------------------------------------------------------
// Every finished plan gets archived with its full week-by-week shape intact
// (see archivePlan in App.jsx), so a new plan doesn't have to start from a
// flat guess every time. This reads the most recent archived plan and works
// out (a) what load it was actually holding by the end, and (b) whether it's
// safe to treat the new plan as a direct continuation of the same macrocycle
// or whether a gap/off-season should be assumed instead — using whether the
// rider said, when that plan was created, that they were going straight into
// another block afterward (see `continuesAfter` on the plan) plus how long
// it's actually been since it was archived, rather than guessing from the
// phase alone.
// ---------------------------------------------------------------------------
export function planContinuationHint(archivedPlans) {
  if (!archivedPlans || !archivedPlans.length) return null;
  const last = archivedPlans[0]; // caller keeps these sorted newest-first
  const plan = last && last.plan;
  if (!plan || !plan.weeks || !plan.weeks.length) return null;

  const loadingWeeks = plan.weeks.filter(w => w.phase !== 'taper' && !w.isRecovery);
  const lastLoadingTss = loadingWeeks.length
    ? loadingWeeks[loadingWeeks.length - 1].plannedTss
    : plan.startWeeklyTss;
  const lastPhase = plan.weeks[plan.weeks.length - 1].phase;

  const archivedAt = last.archivedAt ? new Date(last.archivedAt) : null;
  const weeksSince = archivedAt ? Math.max(0, (Date.now() - archivedAt.getTime()) / (7 * 24 * 3600 * 1000)) : 99;

  // Told us explicitly they're carrying straight on (either into another
  // block, or that a race is coming right up), and it's recent enough for
  // that to actually be true — trust it and chain the ramp smoothly.
  // continuesAfter used to be a plain boolean (true = continuing); archived
  // plans from before the 3-way "race / block / break" question still carry
  // that shape, so both are accepted here.
  const noBreak = plan.continuesAfter === 'race' || plan.continuesAfter === 'block' || plan.continuesAfter === true;
  const isDirectContinuation = noBreak && weeksSince <= 3;

  // Just came off a peak/taper (i.e. an event) without saying they're
  // continuing straight on, or it's been long enough that fitness has likely
  // faded either way — default to a gentler restart rather than assuming
  // they held form through the gap.
  const suggestEasedStart = !isDirectContinuation && (lastPhase === 'taper' || lastPhase === 'peak' || weeksSince > 3);

  // Specifically flagged a race right after this block — a future "start a
  // new plan" step could use this to preselect an event-style goal instead
  // of making the rider pick it again from scratch.
  const raceNext = plan.continuesAfter === 'race' && weeksSince <= 3;

  return { lastLoadingTss, lastPhase, weeksSince: Math.round(weeksSince), isDirectContinuation, suggestEasedStart, raceNext };
}

// ---------------------------------------------------------------------------
// 9. The generator
// ---------------------------------------------------------------------------
export function generatePlan({
  goalKey, totalWeeks, daysPerWeek, weeklyHours,
  currentFtp, recentWeeklyTss, multiSport, library, weightedDayIndex = null,
  trainingAge = null, riderAgeBand = null, continuesAfter = null, continuationHint = null,
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

  // Macrocycle chaining: if the last plan's shape tells us this is a genuine
  // continuation (they said so, and it's recent), let the ramp pick up close
  // to where that plan left off instead of restarting from a flat guess. If
  // it looks like a real gap or they just came off a taper/peak without
  // saying they're carrying straight on, ease the start down instead of
  // assuming fitness held through the break.
  if (continuationHint && continuationHint.lastLoadingTss) {
    if (continuationHint.isDirectContinuation) {
      startWeeklyTss = Math.max(startWeeklyTss, Math.round(continuationHint.lastLoadingTss * 0.9));
    } else if (continuationHint.suggestEasedStart) {
      startWeeklyTss = Math.round(Math.min(startWeeklyTss, continuationHint.lastLoadingTss) * 0.8);
    }
  }

  const phaseByWeek = planPhases(totalWeeks, hasEvent);
  // Multi-sport riders deload every 3 weeks; solo riders every 4. 55+ gets
  // one week knocked off whatever cadence applies — same light-touch nudge
  // as the hard-day trim above, not a hard rule.
  let cadence = multiSport ? 3 : 4;
  if (riderAgeBand === '55plus') cadence = Math.max(2, cadence - 1);
  const recoveryFlags = recoveryWeekFlags(phaseByWeek, cadence);
  const loadTargets = weeklyLoadTargets({ startWeeklyTss, phaseByWeek, recoveryFlags, multiSport, trainingAge });

  const weeklySecondsBudget = (weeklyHours || 4) * 3600;

  // Feasibility guard: a rider can ask for more training days than their time
  // budget can actually hold (e.g. 6 days in 4 hours). Interval sessions have
  // a fixed length we can't trim, and every ride needs a sane minimum (~25
  // min). If the requested day count can't fit, quietly reduce it so we never
  // emit an over-budget plan. ~25 min/ride minimum is a reasonable floor.
  const MIN_RIDE_SECONDS = 1500;
  const feasibleDays = Math.max(1, Math.min(daysPerWeek, Math.floor(weeklySecondsBudget / MIN_RIDE_SECONDS)));
  const effectiveDays = feasibleDays;

  // Cross-week rotation memory: persists across the whole plan so the picker
  // walks through each purpose's pool instead of repeating week 1's choice.
  const recentByPurpose = {};
  // Rough time a single session has, so the picker can prefer workouts that fit
  // rather than long ones that get compressed.
  const sessionSecondsHint = weeklySecondsBudget / Math.max(1, effectiveDays);

  const weeks = phaseByWeek.map((phase, wi) => {
    const isRecovery = recoveryFlags[wi];
    let purposeSlots = weekPurposeSlots({ phase, daysPerWeek: effectiveDays, goal, isRecovery, multiSport, riderAgeBand, library, weeklySecondsBudget, targetTss: loadTargets[wi] });
    purposeSlots = maybeInjectPeriodicPurpose(purposeSlots, goal, phaseByWeek, recoveryFlags, wi);
    // The weighted "big day" is always an endurance session -- the one
    // purpose type that's both length-flexible and safe to scale up without
    // piling extra fatigue onto a high-intensity day.
    if (weightedDayIndex != null && weightedDayIndex >= 0 && weightedDayIndex < purposeSlots.length) {
      purposeSlots = purposeSlots.slice();
      purposeSlots[weightedDayIndex] = 'endurance';
    }
    const usedIds = new Set();
    const usedTerrain = new Set();
    const targetTss = loadTargets[wi];
    // Recovery weeks get their own, much smaller session hint derived from
    // this week's actual TSS target (~30 TSS/hour at recovery pace) rather
    // than the plan-wide average, so the picker favours short native rides
    // instead of a long "epic" one that would dominate the week once scaled.
    const pickHint = isRecovery ? (targetTss / Math.max(1, purposeSlots.length)) * 120 : sessionSecondsHint;

    // First pass: pick a workout per slot at its native length.
    const rawDays = purposeSlots.map(purpose => {
      const w = pickWorkoutForPurpose(purpose, library, usedIds, usedTerrain, phase, recentByPurpose, pickHint, isRecovery);
      usedIds.add(w.id);
      markTerrainUsed(usedTerrain, w.id);
      markRecentlyUsed(recentByPurpose, purpose, w.id);
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

    // Give the designated big day (if any) a bigger share of the week's
    // flexible time, shrinking the other flexible days to compensate so
    // the week's total time -- and therefore its TSS target -- is unchanged.
    const weightedDays = applyWeightedDay(days, weightedDayIndex);

    // Enforce the weekly time budget.
    enforceTimeBudget(weightedDays, weeklySecondsBudget);
    tagActualBigDay(weightedDays, weightedDayIndex);

    const weekTss = weightedDays.reduce((a, d) => a + d.plannedTss, 0);
    const weekSeconds = weightedDays.reduce((a, d) => a + d.plannedSeconds, 0);

    return {
      weekNumber: wi + 1,
      phase,
      isRecovery,
      targetTss,
      plannedTss: weekTss,
      plannedSeconds: weekSeconds,
      days: weightedDays,
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
    weightedDayIndex,
    weekdayPattern: defaultWeekdayPattern(effectiveDays),
    createdAt: new Date().toISOString(),
    startWeeklyTss,
    // Only stored so a *future* plan can read it back via
    // planContinuationHint — this plan's own generation doesn't use it.
    continuesAfter,
    weeks,
  };
}

// ---------------------------------------------------------------------------
// 10. Plan validation
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
// 11. Post-generation adjustments (weekly check-in + swaps)
// ---------------------------------------------------------------------------
// These keep a live plan honest as the rider progresses. Both re-run the same
// TSS bookkeeping so the plan's numbers stay accurate.
// ---------------------------------------------------------------------------

// Adjust the remaining plan based on how the rider reported feeling. Rather
// than nudging individual weeks (which could create an illegal ramp between
// weeks), we shift the *baseline load* the rest of the plan ramps from and
// recompute every future week's target. This keeps the ramp-rate and recovery
// rules valid by construction. Returns a new plan.
export function applyCheckin(plan, weekNumber, feedback, library, reason) {
  // If this week already has an answer, the rider is correcting a misclick
  // rather than answering fresh. Undo that previous answer's one lasting
  // side effect -- forcing the next week into an unplanned recovery week --
  // before recomputing below, so a correction starts from a clean slate
  // instead of stacking a second adjustment on top of the wrong one. (Past
  // weeks' own already-locked targets never move, so this is safe even if
  // later weeks have since been checked in too.)
  let basePlan = plan;
  const existing = plan.weeks.find(w => w.weekNumber === weekNumber);
  if (existing && existing.checkin) {
    const nextIdx = plan.weeks.findIndex(w => w.weekNumber === weekNumber + 1);
    if (nextIdx >= 0 && plan.weeks[nextIdx].insertedRecovery) {
      basePlan = { ...plan, weeks: plan.weeks.map((w, i) => (i === nextIdx ? { ...w, isRecovery: false, insertedRecovery: false } : w)) };
    }
  }

  // feedback: 'too-easy' | 'about-right' | 'too-hard' | 'missed-a-lot'
  // reason (only meaningful for 'missed-a-lot'): 'fatigue' | 'schedule'.
  // A schedule-driven miss isn't a sign the rider was overreaching, so it
  // eases the baseline back gently (same factor as 'too-hard') rather than
  // the sharper fatigue cut, and doesn't force the next week into a
  // recovery week -- there's no accumulated fatigue to actually recover
  // from, just missed training stimulus.
  const missedScheduleOnly = feedback === 'missed-a-lot' && reason === 'schedule';
  const factor = missedScheduleOnly ? 0.85
    : { 'too-easy': 1.08, 'about-right': 1.0, 'too-hard': 0.85, 'missed-a-lot': 0.7 }[feedback] || 1.0;

  // Optionally convert the very next week into an unplanned recovery week.
  let recoveryFlags = basePlan.weeks.map(w => w.isRecovery);
  if (feedback === 'too-hard' || (feedback === 'missed-a-lot' && !missedScheduleOnly)) {
    const idx = basePlan.weeks.findIndex(w => w.weekNumber === weekNumber + 1);
    if (idx >= 0 && basePlan.weeks[idx].phase !== 'taper') recoveryFlags[idx] = true;
  }

  const phaseByWeek = basePlan.weeks.map(w => w.phase);

  // Lock every week up to and including the check-in week to its current
  // target. The feedback factor shifts the baseline the *future* ramps from:
  // the last locked loading week's target is nudged by `factor`, then future
  // weeks ramp continuously from there so no single step can break the cap.
  const lockedTargets = basePlan.weeks.map(w => (w.weekNumber <= weekNumber ? w.targetTss : null));

  // Find the last locked loading week to derive the adjusted future baseline.
  let baseTss = basePlan.startWeeklyTss;
  for (let i = 0; i < basePlan.weeks.length; i++) {
    const w = basePlan.weeks[i];
    if (w.weekNumber <= weekNumber && !recoveryFlags[i] && w.phase !== 'taper') baseTss = w.targetTss;
  }
  // The first future loading week should land at baseTss * factor. Since
  // weeklyLoadTargets ramps the baseline up by (1+maxRamp) for the first
  // loading week, divide that step out here so the boundary ramp stays legal.
  const maxRamp = basePlan.multiSport ? RAMP.maxRampMulti : RAMP.maxRampSolo;
  const adjustedBaseline = Math.max(80, Math.round((baseTss * factor) / (1 + maxRamp)));

  const targets = weeklyLoadTargets({
    startWeeklyTss: adjustedBaseline,
    phaseByWeek,
    recoveryFlags,
    multiSport: basePlan.multiSport,
    lockedTargets,
  });

  const weeks = basePlan.weeks.map((w, i) => {
    if (w.weekNumber === weekNumber) return { ...w, isRecovery: recoveryFlags[i], checkin: feedback, checkinReason: feedback === 'missed-a-lot' ? (reason || null) : null };
    if (w.weekNumber < weekNumber) return { ...w, isRecovery: recoveryFlags[i] };
    return { ...w, targetTss: targets[i], isRecovery: recoveryFlags[i], insertedRecovery: recoveryFlags[i] && !basePlan.weeks[i].isRecovery };
  });

  const adjusted = { ...plan, weeks };
  return rebuildWeekWorkouts(adjusted, library, weekNumber + 1);
}

// Re-pick/re-scale workouts for weeks from `fromWeek` onward to match their
// (possibly adjusted) target TSS. Keeps earlier weeks untouched.
export function rebuildWeekWorkouts(plan, library, fromWeek) {
  const weeklySecondsBudget = (plan.weeklyHours || 4) * 3600;
  const goal = GOALS[plan.goalKey] || GOALS['general-fitness'];
  // Same source of truth the periodic-injection cadence used at original
  // generation time, so a rebuild (e.g. after a check-in) lands on the same
  // cadence rather than drifting.
  const phaseByWeek = plan.weeks.map(w => w.phase);
  const recoveryFlags = plan.weeks.map(w => w.isRecovery);

  // Rebuild only re-picks weeks from `fromWeek` on. Seed the rotation memory by
  // walking the untouched earlier weeks first, so the rebuilt weeks continue the
  // rotation rather than resetting it to week 1's choices.
  const recentByPurpose = {};
  const sessionSecondsHint = weeklySecondsBudget / Math.max(1, plan.daysPerWeek);

  const weeks = plan.weeks.map((w, wi) => {
    if (w.weekNumber < fromWeek) {
      (w.days || []).forEach(d => { if (d.purpose && d.workoutId) markRecentlyUsed(recentByPurpose, d.purpose, d.workoutId); });
      return w;
    }
    let purposeSlots = weekPurposeSlots({ phase: w.phase, daysPerWeek: plan.daysPerWeek, goal, isRecovery: w.isRecovery, multiSport: plan.multiSport, library, weeklySecondsBudget, targetTss: w.targetTss });
    purposeSlots = maybeInjectPeriodicPurpose(purposeSlots, goal, phaseByWeek, recoveryFlags, wi);
    if (plan.weightedDayIndex != null && plan.weightedDayIndex >= 0 && plan.weightedDayIndex < purposeSlots.length) {
      purposeSlots = purposeSlots.slice();
      purposeSlots[plan.weightedDayIndex] = 'endurance';
    }
    const usedIds = new Set();
    const usedTerrain = new Set();
    // See generatePlan: recovery weeks pick against a hint derived from
    // their own (much lower) TSS target, not the plan-wide average.
    const pickHint = w.isRecovery ? (w.targetTss / Math.max(1, purposeSlots.length)) * 120 : sessionSecondsHint;
    const rawDays = purposeSlots.map(purpose => {
      const wk = pickWorkoutForPurpose(purpose, library, usedIds, usedTerrain, w.phase, recentByPurpose, pickHint, w.isRecovery);
      usedIds.add(wk.id);
      markTerrainUsed(usedTerrain, wk.id);
      markRecentlyUsed(recentByPurpose, purpose, wk.id);
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
    const weightedDays = applyWeightedDay(days, plan.weightedDayIndex);
    enforceTimeBudget(weightedDays, weeklySecondsBudget);
    tagActualBigDay(weightedDays, plan.weightedDayIndex);
    return {
      ...w,
      plannedTss: weightedDays.reduce((a, d) => a + d.plannedTss, 0),
      plannedSeconds: weightedDays.reduce((a, d) => a + d.plannedSeconds, 0),
      days: weightedDays,
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

// ---------------------------------------------------------------------------
// 12. Plan progress & mid-block adjustments
// ---------------------------------------------------------------------------

// Which week is "now", based on when the plan was created. Week 1 covers the
// first 7 days after createdAt, week 2 the next 7, and so on. Clamped to the
// plan's real range so an over-running plan still points at its final week
// rather than off the end. Returns a 1-based week number.
export function currentPlanWeek(plan, now = new Date()) {
  if (!plan || !plan.createdAt || !plan.weeks || !plan.weeks.length) return 1;
  const start = new Date(plan.createdAt);
  if (isNaN(start.getTime())) return 1;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const elapsedWeeks = Math.floor((now - start) / msPerWeek);
  const wk = elapsedWeeks + 1; // during the first 7 days, elapsed = 0 -> week 1
  return Math.min(Math.max(wk, 1), plan.weeks.length);
}

// True once the plan's final week has fully elapsed (i.e. it's finished and a
// candidate for archiving). Uses the same week arithmetic as currentPlanWeek.
export function isPlanComplete(plan, now = new Date()) {
  if (!plan || !plan.createdAt || !plan.weeks || !plan.weeks.length) return false;
  const start = new Date(plan.createdAt);
  if (isNaN(start.getTime())) return false;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const elapsedWeeks = Math.floor((now - start) / msPerWeek);
  return elapsedWeeks >= plan.weeks.length;
}

// Change how many days per week the plan uses, from `fromWeek` onward, without
// disturbing weeks the rider has already been through. This is for when life
// changes mid-block (a new job, an injury easing off, more free time). Past
// weeks are frozen exactly as they were; the plan's own daysPerWeek is updated
// and future weeks are rebuilt around the new number while keeping their
// existing phase, recovery flag and target load.
//
// The new day count is clamped to a sane range, and — like the generator —
// respects the same time-budget feasibility gate, so we never promise more
// quality days than the weekly hours can actually hold.
export function changePlanDaysPerWeek(plan, newDays, fromWeek, library) {
  if (!plan || !plan.weeks || !plan.weeks.length) return plan;
  const clamped = Math.min(Math.max(Math.round(newDays), 1), 7);

  // Feasibility gate (mirrors the generator): how many quality days do the
  // weekly hours realistically hold? ~45 min is the floor for a useful
  // session, so hours*3600 / that floor is a soft ceiling on days.
  const weeklySecondsBudget = (plan.weeklyHours || 4) * 3600;
  const maxFeasibleDays = Math.max(1, Math.floor(weeklySecondsBudget / 2700));
  const effectiveDays = Math.min(clamped, maxFeasibleDays);

  // Rebuild uses plan.daysPerWeek internally, so set it first, then rebuild
  // only the weeks from fromWeek onward. Earlier weeks are returned untouched
  // by rebuildWeekWorkouts (it early-returns for w.weekNumber < fromWeek).
  const adjusted = { ...plan, daysPerWeek: effectiveDays };
  const rebuilt = rebuildWeekWorkouts(adjusted, library, fromWeek);

  // Record the change so the UI can explain what happened and, if the request
  // was trimmed for feasibility, why.
  return {
    ...rebuilt,
    daysPerWeek: effectiveDays,
    requestedDays: clamped,
    weekdayPattern: normalizeWeekdayPattern(plan.weekdayPattern, effectiveDays),
    dayChange: { fromWeek, requested: clamped, applied: effectiveDays, at: new Date().toISOString() },
  };
}
