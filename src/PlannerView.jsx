import React, { useState, useMemo, useEffect, useRef, useContext } from 'react';
import { CalendarDays, ChevronRight, ChevronDown, ChevronUp, Play, RefreshCw, Trash2, Target, Flag, TrendingUp, Check, X, Sun } from 'lucide-react';
import {
  GOALS, PHASE, PURPOSE_LABEL, WORKOUT_PURPOSE,
  generatePlan, validatePlan, swapOptionsForPurpose, swapDayWorkout, applyCheckin,
  estimateWorkoutTss, estimateOutdoorTss, currentPlanWeek, isPlanComplete, changePlanDaysPerWeek,
  planContinuationHint,
  WEEKDAY_LABELS, WEEKDAY_LABELS_FULL, defaultWeekdayPattern, setWeekdayPattern,
} from './planner';
import { ColorblindContext } from './colorblindContext';

// Shared style tokens (mirror App.jsx so the planner blends in seamlessly).
const INK = '#14171A';
const BG = 'var(--bg)';
const PANEL = 'var(--panel)';
const PANEL2 = 'var(--panel2)';
const LINE = 'var(--line)';
const TEXT = 'var(--text)';
const SUB = 'var(--sub)';
const FONT_HEAD = "'Big Shoulders Display', sans-serif";
const FONT_BODY = "'Manrope', sans-serif";
const FONT_NUM = "'Space Grotesk', sans-serif";

function fmtLong(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

// Training age and actual age only ever shape plan generation on this
// device — they're never sent to Supabase. Same treatment as Mini Games'
// personal bests: local to the device, gone on reinstall, never synced.
const RIDER_PROFILE_KEY = 'trbo_rider_profile_v1';
function loadRiderProfile() {
  try { return JSON.parse(localStorage.getItem(RIDER_PROFILE_KEY)) || {}; } catch (e) { return {}; }
}
function saveRiderProfile(patch) {
  try {
    const current = loadRiderProfile();
    localStorage.setItem(RIDER_PROFILE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch (e) { /* ignore — localStorage unavailable */ }
}

// A small colour per phase so the week list reads at a glance. The
// colourblind set keeps the same low-to-high intensity ordering (taper is
// the easiest phase, peak the hardest) using the same Okabe-Ito-derived
// hues as the zone colours in App.jsx.
const PHASE_COLOR = {
  base: '#4FB8A6', build: '#C9F031', peak: '#FF9F40', taper: '#4A6FA5',
};
const PHASE_COLOR_CVD = {
  base: '#56B4E9', build: '#E69F00', peak: '#D55E00', taper: '#0072B2',
};

// ---------------------------------------------------------------------------
// Onboarding: the short question flow described in the plan. Deliberately only
// 3-4 visible questions — FTP and starting fitness come from the rider's own
// history, passed in as props, not asked here.
// ---------------------------------------------------------------------------
function PlannerSetup({ ftp, recentWeeklyTss, archivedPlans, onGenerate }) {
  const [goalKey, setGoalKey] = useState('general-fitness');
  const [weeks, setWeeks] = useState(8);
  const [days, setDays] = useState(4);
  const [hours, setHours] = useState(6);
  const [multiSport, setMultiSport] = useState(false);
  const [weightDay, setWeightDay] = useState(false);
  const [weightedDayIndex, setWeightedDayIndex] = useState(days - 1); // defaults to the last session of the week
  // Loaded once from this device's local storage — never sent to Supabase.
  const [riderProfile] = useState(loadRiderProfile);
  const [trainingAge, setTrainingAge] = useState(riderProfile.trainingAge || null);
  const [riderAgeBand, setRiderAgeBand] = useState(riderProfile.riderAgeBand || null);
  const [continuesAfter, setContinuesAfter] = useState(null);

  const continuationHint = useMemo(() => planContinuationHint(archivedPlans), [archivedPlans]);

  // If the day count changes while the weighted-day picker is showing a now
  // out-of-range session number, pull it back in range rather than pointing
  // at a session that no longer exists.
  useEffect(() => { setWeightedDayIndex(i => Math.min(i, days - 1)); }, [days]);

  const goal = GOALS[goalKey];

  const chip = (active) => ({
    fontFamily: FONT_BODY, padding: '9px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13.5,
    border: `1px solid ${active ? 'var(--accent)' : LINE}`,
    background: active ? 'var(--accent)' : PANEL,
    color: active ? INK : TEXT, fontWeight: active ? 700 : 500,
  });
  const sectionLabel = { fontFamily: FONT_BODY, fontSize: 11, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 };

  return (
    <div style={{ padding: '16px 16px 90px', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, textTransform: 'uppercase', fontSize: 26, color: TEXT, letterSpacing: -0.3, marginBottom: 2 }}>Training planner</div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: SUB, marginBottom: 24 }}>A structured, periodized plan built around your goal, your time, and where your fitness is right now.</div>

      {/* Goal */}
      <div style={sectionLabel}>What are you training for?</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
        {Object.entries(GOALS).map(([key, g]) => (
          <button key={key} onClick={() => setGoalKey(key)} style={{ ...chip(goalKey === key), textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
            <span style={{ fontWeight: 700 }}>{g.label}</span>
            <span style={{ fontSize: 11.5, color: goalKey === key ? 'rgba(20,23,26,0.7)' : SUB }}>{g.blurb}</span>
          </button>
        ))}
      </div>

      {/* Length */}
      <div style={sectionLabel}>{goal.hasEvent ? 'How long until your event?' : 'How long a block?'}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
        {[4, 6, 8, 12, 16].map(w => (
          <button key={w} onClick={() => setWeeks(w)} style={chip(weeks === w)}>{w} weeks</button>
        ))}
      </div>

      {/* After-block chaining: asked for every plan now, not just ones with
          a defined event — even a general block can be followed by a race
          the rider already knows about. Asked directly rather than inferred,
          so a plan never silently assumes a break (or a continuation, or an
          upcoming event) that wasn't real. Feeds planContinuationHint on the
          *next* plan: race/block both ramp on smoothly, break eases the
          restart — and knowing "race" specifically (vs. just "another
          block") is what a future goal-preselect step would key off. */}
      <div style={sectionLabel}>After this block, what's next?</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
        <button onClick={() => setContinuesAfter('race')} style={chip(continuesAfter === 'race')}>Race time</button>
        <button onClick={() => setContinuesAfter('block')} style={chip(continuesAfter === 'block')}>Another training block</button>
        <button onClick={() => setContinuesAfter('break')} style={chip(continuesAfter === 'break')}>Taking a break</button>
      </div>

      {/* Training age: a skill-level bucket, not a number of years — shapes
          how conservatively the weekly load ramps. Kept on this device only. */}
      <div style={sectionLabel}>How long have you been training with structure?</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
        {[
          { key: 'new', label: 'New to it' },
          { key: 'developing', label: '1–3 years' },
          { key: 'established', label: '3+ years' },
        ].map(o => (
          <button key={o.key} onClick={() => { setTrainingAge(o.key); saveRiderProfile({ trainingAge: o.key }); }} style={chip(trainingAge === o.key)}>{o.label}</button>
        ))}
      </div>

      {/* Actual age: optional, only nudges recovery-day spacing. Not stored
          server-side — age isn't health data, but there's no reason to hold
          it anywhere beyond what shapes this plan on this device. */}
      <div style={sectionLabel}>Your age band <span style={{ textTransform: 'none', fontWeight: 500 }}>(optional — only affects recovery spacing, kept on this device)</span></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
        {[
          { key: null, label: 'Prefer not to say' },
          { key: 'under40', label: 'Under 40' },
          { key: '40to55', label: '40–55' },
          { key: '55plus', label: '55+' },
        ].map(o => (
          <button key={String(o.key)} onClick={() => { setRiderAgeBand(o.key); saveRiderProfile({ riderAgeBand: o.key }); }} style={chip(riderAgeBand === o.key)}>{o.label}</button>
        ))}
      </div>

      {/* Days per week */}
      <div style={sectionLabel}>How many days a week can you ride?</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
        {[2, 3, 4, 5, 6].map(d => (
          <button key={d} onClick={() => setDays(d)} style={chip(days === d)}>{d} days</button>
        ))}
      </div>

      {/* Weighted day: one session bigger than the rest, e.g. a big Saturday ride */}
      <div style={sectionLabel}>Want one session bigger than the rest?</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: weightDay ? 10 : 22, flexWrap: 'wrap' }}>
        <button onClick={() => setWeightDay(false)} style={chip(!weightDay)}>Even sessions</button>
        <button onClick={() => setWeightDay(true)} style={chip(weightDay)}>One big session</button>
      </div>
      {weightDay && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB, marginBottom: 10, lineHeight: 1.5 }}>
            Which session should be the big one? It'll be a longer endurance ride, with the rest of the week trimmed a bit to balance it out — your total weekly hours stay the same.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Array.from({ length: days }, (_, i) => i).map(i => (
              <button key={i} onClick={() => setWeightedDayIndex(i)} style={chip(weightedDayIndex === i)}>Session {i + 1}</button>
            ))}
          </div>
        </div>
      )}

      {/* Weekly hours */}
      <div style={sectionLabel}>Roughly how many hours a week?</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
        {[3, 4, 6, 8, 10, 12].map(h => (
          <button key={h} onClick={() => setHours(h)} style={chip(hours === h)}>{h}h</button>
        ))}
      </div>

      {/* Multi-sport flag */}
      <div style={sectionLabel}>Are you also doing other structured training?</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setMultiSport(false)} style={chip(!multiSport)}>Cycling only</button>
        <button onClick={() => setMultiSport(true)} style={chip(multiSport)}>Also running / swim / gym</button>
      </div>
      {multiSport && (
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB, marginBottom: 18, lineHeight: 1.5 }}>
          Good to know — this plan manages your cycling load only, and it'll go a bit easier to leave room for your other training. Keep an eye on how your total week feels; it's not a substitute for a combined multi-sport plan.
        </div>
      )}

      {/* What we already know */}
      <div style={{ fontFamily: FONT_BODY, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 10, padding: 12, margin: '14px 0 22px', fontSize: 12.5, color: SUB, lineHeight: 1.5 }}>
        Building from your FTP of <span style={{ fontFamily: FONT_NUM, color: TEXT, fontWeight: 600 }}>{ftp}W</span>
        {recentWeeklyTss > 0
          ? <> and your recent training load (about <span style={{ fontFamily: FONT_NUM, color: TEXT, fontWeight: 600 }}>{Math.round(recentWeeklyTss)} TSS/week</span>).</>
          : <>. Once you've logged a few rides, plans will also tune to your recent training load.</>}
        {continuationHint && continuationHint.isDirectContinuation && (
          <> Picking up from your last plan — this one ramps on from roughly where that block left off.</>
        )}
        {continuationHint && continuationHint.suggestEasedStart && (
          <> {continuationHint.weeksSince <= 3 ? "You just came off a peak/taper, so" : `It's been about ${continuationHint.weeksSince} weeks since your last plan, so`} this one starts a bit easier and ramps back up from there.</>
        )}
      </div>

      <button onClick={() => onGenerate({ goalKey, weeks, days, hours, multiSport, weightedDayIndex: weightDay ? weightedDayIndex : null, trainingAge, riderAgeBand, continuesAfter, continuationHint })}
        style={{ fontFamily: FONT_BODY, width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <CalendarDays size={18} /> Build my plan
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A single day row inside a week. Tapping the body opens the workout (same
// detail sheet as everywhere else). Tapping "Swap" opens the same-purpose
// picker.
// ---------------------------------------------------------------------------
function DayRow({ day, weekday, library, onOpen, onSwap, onLogOutdoor }) {
  const [swapping, setSwapping] = useState(false);
  const [loggingOutdoor, setLoggingOutdoor] = useState(false);
  const [outdoorLogged, setOutdoorLogged] = useState(false);
  const [outdoorMinutes, setOutdoorMinutes] = useState(Math.round((day.plannedSeconds || 1800) / 60));
  const [outdoorRpe, setOutdoorRpe] = useState(5);
  const options = useMemo(() => swapOptionsForPurpose(day.purpose, library), [day.purpose, library]);
  const workout = library.find(w => w.id === day.workoutId);
  const canSwap = options.length > 1;

  function submitOutdoor() {
    if (!onLogOutdoor) return;
    onLogOutdoor({
      workoutId: day.workoutId, name: day.name, category: workout ? workout.category : 'Outdoor',
      durationSeconds: Math.max(60, Math.round(outdoorMinutes * 60)), rpe: outdoorRpe,
    });
    setLoggingOutdoor(false);
    setOutdoorLogged(true);
  }

  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {weekday && (
          <div title={WEEKDAY_LABELS_FULL[weekday.index]} style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 8, background: PANEL2, border: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: 0.3, color: SUB, textTransform: 'uppercase' }}>
            {weekday.label}
          </div>
        )}
        <div onClick={() => workout && onOpen(workout, day.plannedSeconds)} style={{ flex: 1, minWidth: 0, cursor: workout ? 'pointer' : 'default' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 10, color: SUB, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{PURPOSE_LABEL[day.purpose] || day.purpose}</span>
            {day.isWeightedDay && <span style={{ fontFamily: FONT_BODY, fontSize: 9.5, color: INK, background: 'var(--accent)', borderRadius: 5, padding: '1px 6px', fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>Big day</span>}
            {outdoorLogged && <span style={{ fontFamily: FONT_BODY, fontSize: 9.5, color: TEXT, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 5, padding: '1px 6px', fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>Logged outdoors</span>}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: TEXT, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{day.name}</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB, marginTop: 2 }}>{fmtLong(day.plannedSeconds)} · ~{day.plannedTss} TSS</div>
        </div>
        {workout && (
          <button onClick={() => onOpen(workout, day.plannedSeconds)} title="Open" style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <Play size={15} fill={INK} color={INK} />
          </button>
        )}
        {onLogOutdoor && (
          <button onClick={() => { setLoggingOutdoor(s => !s); setSwapping(false); }} title="Log as done outdoors" style={{ background: loggingOutdoor ? 'var(--accent)' : PANEL2, border: `1px solid ${loggingOutdoor ? 'var(--accent)' : LINE}`, borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <Sun size={14} color={loggingOutdoor ? INK : SUB} />
          </button>
        )}
        {canSwap && (
          <button onClick={() => { setSwapping(s => !s); setLoggingOutdoor(false); }} title="Swap" style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <RefreshCw size={14} color={SUB} />
          </button>
        )}
      </div>
      {loggingOutdoor && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: SUB, marginBottom: 8, lineHeight: 1.5 }}>Rode this outdoors instead? No power data to go on, so give a duration and how hard it felt — that's enough to estimate the load and count it toward this week.</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB, width: 60, flexShrink: 0 }}>Duration</span>
            <input type="number" min={5} max={600} value={outdoorMinutes}
              onChange={e => setOutdoorMinutes(Math.max(5, Math.min(600, Number(e.target.value) || 0)))}
              style={{ fontFamily: FONT_NUM, width: 70, padding: '6px 8px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 13 }} />
            <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB }}>min</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB, width: 60, flexShrink: 0 }}>RPE</span>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <button key={n} onClick={() => setOutdoorRpe(n)}
                style={{ fontFamily: FONT_NUM, width: 26, height: 26, borderRadius: 6, border: `1px solid ${outdoorRpe === n ? 'var(--accent)' : LINE}`, background: outdoorRpe === n ? 'var(--accent)' : PANEL2, color: outdoorRpe === n ? INK : TEXT, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{n}</button>
            ))}
          </div>
          <button onClick={submitOutdoor} style={{ fontFamily: FONT_BODY, width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Log outdoor ride</button>
        </div>
      )}
      {swapping && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: SUB, marginBottom: 6 }}>Swap for another {(PURPOSE_LABEL[day.purpose] || day.purpose).toLowerCase()} session:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {options.map(o => {
              const active = o.id === day.workoutId;
              return (
                <button key={o.id} disabled={active}
                  onClick={() => { onSwap(o.id); setSwapping(false); }}
                  style={{ textAlign: 'left', background: active ? PANEL2 : 'transparent', border: `1px solid ${active ? 'var(--accent)' : LINE}`, borderRadius: 8, padding: '7px 10px', cursor: active ? 'default' : 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                  {active ? <Check size={13} color="var(--accent)" style={{ flexShrink: 0 }} /> : <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: SUB, flexShrink: 0 }}>~{estimateWorkoutTss(o.intervals)} TSS</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One week: header (phase, load, recovery badge) + the day rows. Collapsible.
// ---------------------------------------------------------------------------
function WeekCard({ week, library, weekdayPattern, defaultOpen, isCurrent, cardRef, onOpen, onSwap, onCheckin, onLogOutdoor }) {
  const [open, setOpen] = useState(defaultOpen);
  const cvd = useContext(ColorblindContext);
  const phaseInfo = PHASE[week.phase];
  const phaseColor = (cvd ? PHASE_COLOR_CVD : PHASE_COLOR)[week.phase] || SUB;

  return (
    <div ref={cardRef} style={{ background: PANEL, border: `1px solid ${isCurrent ? 'var(--accent)' : LINE}`, borderRadius: 14, marginBottom: 12, overflow: 'hidden', scrollMarginTop: 12 }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', background: 'none', border: 'none', padding: 14, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: phaseColor, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontFamily: FONT_HEAD, fontSize: 16, fontWeight: 700, color: TEXT }}>Week {week.weekNumber}</span>
            <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: phaseColor, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{phaseInfo.label}</span>
            {isCurrent && <span style={{ fontFamily: FONT_BODY, fontSize: 10, color: INK, background: 'var(--accent)', borderRadius: 5, padding: '1px 6px', fontWeight: 700 }}>This week</span>}
            {week.isRecovery && <span style={{ fontFamily: FONT_BODY, fontSize: 10, color: '#4A6FA5', border: '1px solid #4A6FA5', borderRadius: 5, padding: '1px 6px' }}>Recovery</span>}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB }}>{week.days.length} sessions · {fmtLong(week.plannedSeconds)} · ~{week.plannedTss} TSS</div>
        </div>
        {open ? <ChevronUp size={18} color={SUB} /> : <ChevronDown size={18} color={SUB} />}
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB, marginBottom: 12, lineHeight: 1.5, fontStyle: 'italic' }}>{phaseInfo.blurb}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {week.days.map((d, i) => {
              const dayIdx = weekdayPattern && weekdayPattern.length ? weekdayPattern[i % weekdayPattern.length] : null;
              const weekday = dayIdx != null ? { index: dayIdx, label: WEEKDAY_LABELS[dayIdx] } : null;
              return (
                <DayRow key={i} day={d} weekday={weekday} library={library} onOpen={onOpen} onSwap={(newId) => onSwap(week.weekNumber, i, newId)} onLogOutdoor={onLogOutdoor} />
              );
            })}
          </div>
          {/* Weekly check-in */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: SUB, marginBottom: 8 }}>Finished this week? Tell the plan how it felt and it'll tune the weeks ahead:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['too-easy', 'Too easy'], ['about-right', 'About right'], ['too-hard', 'Too hard'], ['missed-a-lot', 'Missed a lot']].map(([key, label]) => (
                <button key={key} onClick={() => onCheckin(week.weekNumber, key)}
                  style={{ fontFamily: FONT_BODY, fontSize: 12, padding: '6px 11px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, cursor: 'pointer' }}>{label}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The main view. Holds the active plan; delegates onboarding to PlannerSetup.
// ---------------------------------------------------------------------------
export default function PlannerView({ plan, ftp, recentWeeklyTss, library, onSavePlan, onOpenPlanWorkout, archivedPlans = [], onArchivePlan, onDeleteArchivedPlan, onLogOutdoor }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dayEditor, setDayEditor] = useState(false);
  const [weekdayEditor, setWeekdayEditor] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const currentWeekRef = useRef(null);

  // Which week is "now" for the active plan (feature: auto-route to the
  // current week when a plan is opened). Recomputed each render so it stays
  // correct as days pass. Falls back to 1 when there's no plan.
  const currentWeek = plan ? currentPlanWeek(plan) : 1;
  const planComplete = plan ? isPlanComplete(plan) : false;
  // Older plans (saved before this feature shipped) won't have a pattern yet
  // — fall back to a sensible default rather than showing blank badges.
  const weekdayPattern = plan
    ? (plan.weekdayPattern && plan.weekdayPattern.length === plan.daysPerWeek ? plan.weekdayPattern : defaultWeekdayPattern(plan.daysPerWeek))
    : null;

  // On opening an active plan, bring the current week into view. Runs when the
  // plan or the current week changes (e.g. a new plan, or a day rolls over).
  useEffect(() => {
    if (plan && currentWeekRef.current) {
      currentWeekRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan && plan.createdAt, currentWeek]);

  function handleGenerate({ goalKey, weeks, days, hours, multiSport, weightedDayIndex, trainingAge, riderAgeBand, continuesAfter, continuationHint }) {
    const p = generatePlan({
      goalKey, totalWeeks: weeks, daysPerWeek: days, weeklyHours: hours,
      currentFtp: ftp, recentWeeklyTss, multiSport, library, weightedDayIndex,
      trainingAge, riderAgeBand, continuesAfter, continuationHint,
    });
    onSavePlan(p);
  }

  function handleSwap(weekNumber, dayIndex, newWorkoutId) {
    onSavePlan(swapDayWorkout(plan, weekNumber, dayIndex, newWorkoutId, library));
  }
  // Assign one session slot (applies across every week) to a day of the week.
  function handleSetWeekday(sessionIndex, dayIdx) {
    const pattern = (weekdayPattern || []).slice();
    pattern[sessionIndex] = dayIdx;
    onSavePlan(setWeekdayPattern(plan, pattern));
  }
  function handleCheckin(weekNumber, feedback) {
    onSavePlan(applyCheckin(plan, weekNumber, feedback, library));
  }
  // Change training days from the current week onward. Past weeks are frozen.
  function handleChangeDays(newDays) {
    onSavePlan(changePlanDaysPerWeek(plan, newDays, currentWeek, library));
    setDayEditor(false);
  }

  if (!plan) {
    return (
      <div>
        <PlannerSetup ftp={ftp} recentWeeklyTss={recentWeeklyTss} archivedPlans={archivedPlans} onGenerate={handleGenerate} />
        <ArchiveList plans={archivedPlans} onDelete={onDeleteArchivedPlan} />
      </div>
    );
  }

  const goal = GOALS[plan.goalKey] || GOALS['general-fitness'];
  const totalTss = plan.weeks.reduce((a, w) => a + w.plannedTss, 0);
  const peakWeek = plan.weeks.reduce((a, w) => (w.plannedTss > a.plannedTss ? w : a), plan.weeks[0]);
  const reducedDays = plan.requestedDays && plan.daysPerWeek < plan.requestedDays;

  return (
    <div style={{ padding: '16px 16px 90px', maxWidth: 520, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, textTransform: 'uppercase', fontSize: 26, color: TEXT, letterSpacing: -0.3 }}>{plan.goalLabel}</div>
        <button onClick={() => setConfirmDelete(true)} style={{ fontFamily: FONT_BODY, background: 'none', border: 'none', color: SUB, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '4px 0', flexShrink: 0 }}>
          <Trash2 size={13} /> New plan
        </button>
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: SUB, marginBottom: 16 }}>{goal.blurb}</div>

      {planComplete && (
        <div style={{ background: PANEL2, border: '1px solid var(--accent)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: TEXT, fontWeight: 600, marginBottom: 4 }}>Plan complete — nice work.</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: SUB, marginBottom: 12, lineHeight: 1.5 }}>You've reached the end of this {plan.totalWeeks}-week block. Archive it to keep it in your history, then start your next one.</div>
          <button onClick={() => onArchivePlan(plan, 'completed')}
            style={{ fontFamily: FONT_BODY, background: 'var(--accent)', border: 'none', borderRadius: 10, padding: '10px 16px', color: INK, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
            Finish &amp; archive
          </button>
        </div>
      )}

      {/* summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
        {[
          { icon: CalendarDays, label: 'Length', value: `${plan.totalWeeks} wks` },
          { icon: TrendingUp, label: 'Total load', value: `${Math.round(totalTss)}` },
          { icon: Flag, label: 'Peak week', value: `W${peakWeek.weekNumber}` },
        ].map((s, i) => (
          <div key={i} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontFamily: FONT_BODY, display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: SUB, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 5 }}>
              <s.icon size={11} /> {s.label}
            </div>
            <div style={{ fontFamily: FONT_NUM, fontSize: 16, fontWeight: 700, color: TEXT }}>{s.value}</div>
          </div>
        ))}
      </div>

      {reducedDays && (
        <div style={{ fontFamily: FONT_BODY, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 10, padding: 11, marginBottom: 16, fontSize: 12, color: SUB, lineHeight: 1.5 }}>
          Fit to your time: {plan.weeklyHours}h a week comfortably holds {plan.daysPerWeek} quality sessions, so the plan uses that rather than {plan.requestedDays}. More hours would let you add days.
        </div>
      )}

      {/* Change training days mid-block */}
      <div style={{ marginBottom: 16 }}>
        {!dayEditor ? (
          <button onClick={() => setDayEditor(true)}
            style={{ fontFamily: FONT_BODY, display: 'flex', alignItems: 'center', gap: 7, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', cursor: 'pointer', color: TEXT, fontSize: 12.5, width: '100%', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <CalendarDays size={14} color={SUB} /> Training <b style={{ fontWeight: 700 }}>{plan.daysPerWeek} days</b> a week
            </span>
            <span style={{ color: SUB, fontSize: 12 }}>Change ›</span>
          </button>
        ) : (
          <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: TEXT, fontWeight: 600, marginBottom: 4 }}>Change training days</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB, marginBottom: 12, lineHeight: 1.5 }}>
              Life changed? Pick a new number of days a week. Weeks you've already done stay as they are — only week {currentWeek} onward is rebuilt.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {[2, 3, 4, 5, 6].map(d => {
                const active = d === plan.daysPerWeek;
                return (
                  <button key={d} onClick={() => handleChangeDays(d)} disabled={active}
                    style={{ fontFamily: FONT_BODY, padding: '9px 14px', borderRadius: 10, cursor: active ? 'default' : 'pointer', fontSize: 13.5,
                      border: `1px solid ${active ? 'var(--accent)' : LINE}`, background: active ? 'var(--accent)' : PANEL2,
                      color: active ? INK : TEXT, fontWeight: active ? 700 : 500 }}>{d} days</button>
                );
              })}
            </div>
            <button onClick={() => setDayEditor(false)}
              style={{ fontFamily: FONT_BODY, background: 'none', border: 'none', color: SUB, fontSize: 12, cursor: 'pointer', padding: 0 }}>Cancel</button>
          </div>
        )}
      </div>

      {/* Assign each session to a day of the week */}
      <div style={{ marginBottom: 16 }}>
        {!weekdayEditor ? (
          <button onClick={() => setWeekdayEditor(true)}
            style={{ fontFamily: FONT_BODY, display: 'flex', alignItems: 'center', gap: 7, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', cursor: 'pointer', color: TEXT, fontSize: 12.5, width: '100%', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <CalendarDays size={14} color={SUB} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Scheduled <b style={{ fontWeight: 700 }}>{weekdayPattern.map(d => WEEKDAY_LABELS[d]).join(', ')}</b>
              </span>
            </span>
            <span style={{ color: SUB, fontSize: 12, flexShrink: 0 }}>Change ›</span>
          </button>
        ) : (
          <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: TEXT, fontWeight: 600, marginBottom: 4 }}>Assign days of the week</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB, marginBottom: 12, lineHeight: 1.5 }}>
              Pick which day each session lands on — this applies to every week in the plan.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
              {Array.from({ length: plan.daysPerWeek }, (_, i) => i).map(i => (
                <div key={i}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB, marginBottom: 6 }}>Session {i + 1}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {WEEKDAY_LABELS.map((lbl, d) => {
                      const active = weekdayPattern[i] === d;
                      return (
                        <button key={d} onClick={() => handleSetWeekday(i, d)} disabled={active}
                          style={{ fontFamily: FONT_BODY, padding: '7px 10px', borderRadius: 8, cursor: active ? 'default' : 'pointer', fontSize: 12.5,
                            border: `1px solid ${active ? 'var(--accent)' : LINE}`, background: active ? 'var(--accent)' : PANEL2,
                            color: active ? INK : TEXT, fontWeight: active ? 700 : 500 }}>{lbl}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setWeekdayEditor(false)}
              style={{ fontFamily: FONT_BODY, background: 'none', border: 'none', color: SUB, fontSize: 12, cursor: 'pointer', padding: 0 }}>Done</button>
          </div>
        )}
      </div>

      {/* load bar chart across the plan */}
      <PlanLoadChart weeks={plan.weeks} />

      {/* weeks */}
      <div style={{ marginTop: 20 }}>
        {plan.weeks.map((w) => (
          <WeekCard key={w.weekNumber} week={w} library={library} weekdayPattern={weekdayPattern}
            defaultOpen={w.weekNumber === currentWeek}
            isCurrent={w.weekNumber === currentWeek}
            cardRef={w.weekNumber === currentWeek ? currentWeekRef : null}
            onOpen={onOpenPlanWorkout} onSwap={handleSwap} onCheckin={handleCheckin} onLogOutdoor={onLogOutdoor} />
        ))}
      </div>

      {/* Past plans (archive) on the active-plan screen too */}
      <ArchiveList plans={archivedPlans} onDelete={onDeleteArchivedPlan} />

      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setConfirmDelete(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: BG, border: `1px solid ${LINE}`, borderRadius: 16, padding: 20, maxWidth: 360, width: '100%' }}>
            <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 18, color: TEXT, marginBottom: 8 }}>Start a new plan?</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: SUB, marginBottom: 18, lineHeight: 1.5 }}>You can keep this plan in your history and start fresh, or discard it completely. Either way your ride history and FTP are kept.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => { onArchivePlan(plan, 'retired'); setConfirmDelete(false); }} style={{ fontFamily: FONT_BODY, padding: '11px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Archive it &amp; start new</button>
              <button onClick={() => { onSavePlan(null); setConfirmDelete(false); }} style={{ fontFamily: FONT_BODY, padding: '11px 0', borderRadius: 10, border: `1px solid ${LINE}`, background: PANEL, color: TEXT, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Discard without saving</button>
              <button onClick={() => setConfirmDelete(false)} style={{ fontFamily: FONT_BODY, padding: '8px 0', borderRadius: 10, border: 'none', background: 'none', color: SUB, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// A collapsible list of finished/retired plans, shown on both the setup
// screen and beneath the active plan.
function ArchiveList({ plans, onDelete }) {
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  if (!plans || !plans.length) return null;

  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return ''; }
  };

  return (
    <div style={{ maxWidth: 520, margin: '8px auto 0', padding: '0 16px 90px' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', background: 'none', border: 'none', padding: '10px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: SUB }}>
        <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>Past plans ({plans.length})</span>
        {open ? <ChevronUp size={16} color={SUB} /> : <ChevronDown size={16} color={SUB} />}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {plans.map(a => (
            <div key={a.id} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: TEXT, fontWeight: 600 }}>{a.goalLabel || 'Training plan'}</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB, marginTop: 2 }}>
                  {a.totalWeeks}-week block · {a.status === 'retired' ? 'retired early' : 'completed'} · archived {fmtDate(a.archivedAt)}
                </div>
              </div>
              {confirmId === a.id ? (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => { onDelete(a.id); setConfirmId(null); }} style={{ fontFamily: FONT_BODY, fontSize: 11.5, padding: '6px 10px', borderRadius: 8, border: 'none', background: '#C0392B', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Delete</button>
                  <button onClick={() => setConfirmId(null)} style={{ fontFamily: FONT_BODY, fontSize: 11.5, padding: '6px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, cursor: 'pointer' }}>Keep</button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(a.id)} title="Delete" style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                  <Trash2 size={13} color={SUB} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Little bar chart of weekly load across the whole plan — makes the
// periodization (ramps, deloads, taper) visible at a glance.
function PlanLoadChart({ weeks }) {
  const cvd = useContext(ColorblindContext);
  const colors = cvd ? PHASE_COLOR_CVD : PHASE_COLOR;
  const max = Math.max(1, ...weeks.map(w => w.plannedTss));
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: SUB, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Weekly load</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 64 }}>
        {weeks.map(w => (
          <div key={w.weekNumber} title={`Week ${w.weekNumber}: ~${w.plannedTss} TSS`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            <div style={{ width: '100%', maxWidth: 20, height: `${Math.max(4, (w.plannedTss / max) * 100)}%`, borderRadius: 3, background: colors[w.phase] || SUB, opacity: w.isRecovery ? 0.45 : 1 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        {Object.entries(PHASE).map(([key, p]) => (
          <div key={key} style={{ fontFamily: FONT_BODY, display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: SUB }}>
            <div style={{ width: 9, height: 9, borderRadius: 2, background: colors[key] }} /> {p.label}
          </div>
        ))}
      </div>
    </div>
  );
}
