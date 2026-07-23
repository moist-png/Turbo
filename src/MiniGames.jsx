import React, { useState, useEffect, useRef } from 'react';
import {
  Gamepad2, Play, X, Flame, Car, Zap, Timer, Trophy, Bluetooth, BluetoothOff,
  HeartPulse, ChevronRight, RotateCcw, Minus, Plus, Gauge, Users, Mountain,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Mini Games: a standalone, replayable game library kept fully separate from
// the workout library. Each game is a small self-contained "engine" (init /
// tick / Render) registered in MINI_GAMES below, so adding future games means
// adding one entry here without touching the rest of the app.
// ---------------------------------------------------------------------------

// Shared style tokens (mirror App.jsx so games blend in seamlessly).
const INK = '#14171A';
const BG = 'var(--bg)';
const PANEL = 'var(--panel)';
const PANEL2 = 'var(--panel2)';
const LINE = 'var(--line)';
const TEXT = 'var(--text)';
const SUB = 'var(--sub)';

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Rider speed from watts: simple flat-road aero model (CdA ≈ 0.32, sea-level
// air). 200W ≈ 36 km/h, 300W ≈ 41 km/h. Only relative speeds matter in the
// chase games, so precision isn't critical; it just has to *feel* right.
function speedFromWatts(w) {
  return Math.cbrt(Math.max(0, w) / 0.196); // metres per second
}

// ---------- personal bests (per browser, zero-setup) ----------
const PB_KEY = 'trbo_minigame_pbs_v1';
function loadPBs() {
  try { return JSON.parse(localStorage.getItem(PB_KEY)) || {}; } catch (e) { return {}; }
}
function savePB(key, entry) {
  try {
    const all = loadPBs();
    all[key] = entry;
    localStorage.setItem(PB_KEY, JSON.stringify(all));
  } catch (e) {}
}

// ---------- tiny beeper (kept local so the module stays self-contained) ----------
function useGameBeeper() {
  const ctxRef = useRef(null);
  function beep(freq, duration = 0.09, gainVal = 0.1) {
    try {
      if (!ctxRef.current) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ctxRef.current = new AC();
      }
      const ctx = ctxRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.value = gainVal;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }
  return beep;
}

// ---------- shared little UI pieces ----------
function StatChip({ label, value, color }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: '7px 12px', minWidth: 74, textAlign: 'center' }}>
      <div style={{ fontSize: 9.5, color: SUB, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 17, color: color || TEXT, marginTop: 1 }}>{value}</div>
    </div>
  );
}

function MeterBar({ pct, color, height = 14, label }) {
  return (
    <div>
      {label && <div style={{ fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>}
      <div style={{ height, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${clamp(pct, 0, 100)}%`, background: color, borderRadius: 999, transition: 'width 0.25s linear' }} />
      </div>
    </div>
  );
}

// =============================================================================
// GAME 1: The Floor is Lava
// Stay above a rising minimum power. Drop below and your health burns away.
// =============================================================================
const lavaGame = {
  id: 'lava',
  active: false, // deactivated — kept in code, hidden from UI until it gets its own animated visuals
  title: 'The Floor is Lava',
  tagline: 'The floor keeps rising. Don\u2019t touch it.',
  durationLabel: '3\u201315 min',
  difficulty: 'Progressive',
  icon: Flame,
  color: '#FF6B4A',
  scoreUnit: 'time survived',
  howTo: [
    'A minimum power line, the lava, starts easy and rises relentlessly.',
    'Ride above the line and your health slowly recovers.',
    'Dip below it and you burn: the deeper you sink, the faster you lose health.',
    'Survive as long as you can. The game ends when your health hits zero (or after 15 minutes, if you\u2019re superhuman).',
  ],
  init(ftp) {
    return { floor: Math.round(ftp * 0.5), health: 100, elapsed: 0, finished: false, win: false, score: 0, warned: false };
  },
  tick(s, power, dt, api) {
    s.elapsed += dt;
    // lava rises ~5.5% of FTP per minute: everyone drowns eventually
    s.floor += api.ftp * 0.00092 * dt;
    if (s.elapsed > 10) { // 10s spin-up grace before damage starts
      if (power < s.floor) {
        const deficit = (s.floor - power) / api.ftp;
        s.health -= (8 + 70 * deficit) * dt;
        if (!s.warned) { api.beep(240, 0.12, 0.12); s.warned = true; }
      } else {
        s.health = Math.min(100, s.health + 2.5 * dt);
        s.warned = false;
      }
    }
    if (s.health <= 0) { s.health = 0; s.finished = true; s.win = false; s.score = Math.round(s.elapsed); }
    if (s.elapsed >= 900) { s.finished = true; s.win = true; s.score = Math.round(s.elapsed); }
    return s;
  },
  betterScore(a, b) { return a > b; },
  formatScore(v) { return fmtTime(v); },
  Render({ state, power }) {
    const floorW = Math.round(state.floor);
    const above = power >= floorW;
    const maxScale = Math.max(floorW * 1.6, power * 1.15, 200);
    const lavaPct = (floorW / maxScale) * 100;
    const youPct = clamp((power / maxScale) * 100, 0, 100);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <StatChip label="Lava line" value={`${floorW}W`} color="#FF6B4A" />
          <StatChip label="You" value={`${power}W`} color={above ? 'var(--accent)' : '#FF6B4A'} />
        </div>
        <div style={{ position: 'relative', width: 130, height: 240, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 14, overflow: 'hidden' }}>
          {/* lava fill */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${lavaPct}%`, background: 'linear-gradient(180deg,#FF8A5C,#E3402A)', transition: 'height 0.3s linear' }} />
          {/* your marker */}
          <div style={{ position: 'absolute', left: 6, right: 6, bottom: `calc(${youPct}% - 2px)`, height: 4, borderRadius: 2, background: above ? 'var(--accent)' : '#fff', boxShadow: '0 0 8px rgba(0,0,0,0.4)', transition: 'bottom 0.25s linear' }} />
        </div>
        <div style={{ width: '100%', maxWidth: 340 }}>
          <MeterBar pct={state.health} color={state.health > 40 ? 'var(--accent)' : '#FF6B4A'} label={`Health · ${Math.round(state.health)}%`} />
        </div>
        <div style={{ fontSize: 12.5, color: above ? SUB : '#FF6B4A', fontWeight: above ? 400 : 700 }}>
          {state.elapsed <= 10 ? 'Spin up: lava arms in a moment' : above ? 'Clear of the lava. It\u2019s still rising\u2026' : 'YOU\u2019RE IN THE LAVA: PUSH!'}
        </div>
      </div>
    );
  },
};

// =============================================================================
// GAME 2: Chase Car
// A pursuit vehicle starts behind you and keeps accelerating. Outrun it.
// =============================================================================
const chaseGame = {
  id: 'chase',
  active: false, // deactivated — kept in code, hidden from UI until it gets its own animated visuals
  title: 'Chase Car',
  tagline: 'It starts slow. It doesn\u2019t stay slow.',
  durationLabel: '3\u201315 min',
  difficulty: 'Progressive',
  icon: Car,
  color: '#4A6FA5',
  scoreUnit: 'time ahead of the car',
  howTo: [
    'A chase car starts 150 m behind you at a gentle 30 km/h.',
    'Every 10 seconds it speeds up a little. It never stops speeding up.',
    'Your speed comes from your power: the harder you push, the faster you ride.',
    'Survive as long as you can before it catches you.',
  ],
  init() {
    return { gap: 150, carKph: 30, elapsed: 0, finished: false, win: false, score: 0, closeWarn: false };
  },
  tick(s, power, dt, api) {
    s.elapsed += dt;
    if (s.elapsed > 5) s.carKph = 30 + Math.floor((s.elapsed - 5) / 10) * 0.7; // +0.7 km/h every 10s
    const vYou = speedFromWatts(power);
    const vCar = s.elapsed > 5 ? s.carKph / 3.6 : 0;
    s.gap += (vYou - vCar) * dt;
    s.gap = Math.min(s.gap, 600); // stop the gap running away to silly numbers
    if (s.gap < 40 && !s.closeWarn) { api.beep(300, 0.14, 0.12); s.closeWarn = true; }
    if (s.gap >= 60) s.closeWarn = false;
    if (s.gap <= 0) { s.gap = 0; s.finished = true; s.win = false; s.score = Math.round(s.elapsed); }
    if (s.elapsed >= 900) { s.finished = true; s.win = true; s.score = Math.round(s.elapsed); }
    return s;
  },
  betterScore(a, b) { return a > b; },
  formatScore(v) { return fmtTime(v); },
  Render({ state, power }) {
    const kph = (speedFromWatts(power) * 3.6).toFixed(0);
    const roadPct = clamp((state.gap / 300) * 100, 2, 96);
    const danger = state.gap < 40;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', width: '100%' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <StatChip label="Gap" value={`${Math.round(state.gap)}m`} color={danger ? '#FF6B4A' : 'var(--accent)'} />
          <StatChip label="Your speed" value={`${kph} km/h`} />
          <StatChip label="Car speed" value={`${state.carKph.toFixed(1)} km/h`} color="#FF9F40" />
        </div>
        {/* road */}
        <div style={{ position: 'relative', width: '100%', maxWidth: 420, height: 74, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 2, background: `repeating-linear-gradient(90deg, ${LINE}, ${LINE} 14px, transparent 14px, transparent 28px)` }} />
          <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: '2%', transition: 'left 0.3s linear' }}>
            <Car size={30} color={danger ? '#FF6B4A' : '#FF9F40'} />
          </div>
          <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: `${roadPct}%`, transition: 'left 0.3s linear' }}>
            <Zap size={26} color="var(--accent)" />
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: danger ? '#FF6B4A' : SUB, fontWeight: danger ? 700 : 400 }}>
          {state.elapsed <= 5 ? 'Rolling start: the car launches in a moment' : danger ? 'IT\u2019S RIGHT BEHIND YOU!' : 'Keep the gap. It\u2019s accelerating\u2026'}
        </div>
      </div>
    );
  },
};

// =============================================================================
// GAME 3: Bridge the Gap
// A rider is up the road. Close the gap before they escape for good.
// =============================================================================
const bridgeGame = {
  id: 'bridge',
  active: false, // deactivated — kept in code, hidden from UI until it gets its own animated visuals
  title: 'Bridge the Gap',
  tagline: 'They\u2019re 15 seconds up the road. Go get them.',
  durationLabel: '2\u20138 min',
  difficulty: 'Hard',
  icon: Timer,
  color: '#C9F031',
  scoreUnit: 'fastest catch',
  howTo: [
    'A breakaway rider is 15 seconds ahead, riding hard at 95% of your FTP pace.',
    'Ride harder than them and the gap shrinks. Ride softer and it grows.',
    'Catch them and you win: your time is your score.',
    'If the gap stretches past 30 seconds, or 8 minutes pass, they\u2019re gone.',
  ],
  init(ftp) {
    const vEsc = speedFromWatts(ftp * 0.95);
    return { dist: vEsc * 15, vEsc, elapsed: 0, finished: false, win: false, score: 0 };
  },
  tick(s, power, dt) {
    s.elapsed += dt;
    const vYou = speedFromWatts(power);
    s.dist += (s.vEsc - vYou) * dt;
    const gapSec = s.dist / s.vEsc;
    if (s.dist <= 0) { s.dist = 0; s.finished = true; s.win = true; s.score = Math.round(s.elapsed); }
    else if (gapSec >= 30 || s.elapsed >= 480) { s.finished = true; s.win = false; s.score = 0; }
    return s;
  },
  betterScore(a, b) { return a > 0 && (b === 0 || a < b); }, // lower catch time is better; 0 = never caught
  formatScore(v) { return v > 0 ? fmtTime(v) : '\u2014'; },
  Render({ state, power, ftp }) {
    const gapSec = state.dist / state.vEsc;
    const closing = speedFromWatts(power) > state.vEsc;
    const pct = clamp((1 - gapSec / 30) * 100, 2, 98);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', width: '100%' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <StatChip label="Gap" value={`${gapSec.toFixed(1)}s`} color={closing ? 'var(--accent)' : '#FF9F40'} />
          <StatChip label="You" value={`${power}W`} />
          <StatChip label={'They\u2019re holding'} value={`${Math.round(ftp * 0.95)}W`} color="#FF9F40" />
        </div>
        <div style={{ position: 'relative', width: '100%', maxWidth: 420, height: 74, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 2, background: `repeating-linear-gradient(90deg, ${LINE}, ${LINE} 14px, transparent 14px, transparent 28px)` }} />
          <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: '2%' }}>
            <Zap size={26} color="#FF9F40" />
          </div>
          <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: `${pct}%`, transition: 'left 0.3s linear' }}>
            <Zap size={26} color="var(--accent)" />
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: closing ? SUB : '#FF9F40', fontWeight: closing ? 400 : 700 }}>
          {closing ? 'You\u2019re closing. Keep it steady\u2026' : 'The gap is growing. Dig deeper!'}
        </div>
      </div>
    );
  },
};

// =============================================================================
// GAME 4: Pro Attack
// Sit in the bunch, then react instantly when the attack goes.
// =============================================================================
const attackGame = {
  id: 'attack',
  active: false, // deactivated — kept in code, hidden from UI until it gets its own animated visuals
  title: 'Pro Attack',
  tagline: 'Sit in. Stay alert. When it goes, it GOES.',
  durationLabel: '~7 min',
  difficulty: 'Very hard',
  icon: Users,
  color: '#FF9F40',
  scoreUnit: 'attacks survived',
  howTo: [
    'Ride in the bunch at an easy endurance pace.',
    'Without much warning, an attack goes: a hard target flashes up and you must hold it to keep the wheel.',
    'Fall below the target and your grip on the wheel drains. Hit zero and you\u2019re dropped.',
    'Three attacks, each harder and longer than the last. Survive all three to win.',
  ],
  init(ftp) {
    // scripted timeline with slight randomness so replays feel fresh
    const attacks = [
      { at: 45 + Math.random() * 30, len: 30, mult: 1.15 },
      { at: 165 + Math.random() * 30, len: 35, mult: 1.2 },
      { at: 290 + Math.random() * 30, len: 40, mult: 1.25 },
    ];
    return { attacks, idx: 0, phase: 'bunch', phaseEnd: 0, wheel: 100, held: 0, elapsed: 0, finished: false, win: false, score: 0, ftp };
  },
  tick(s, power, dt, api) {
    s.elapsed += dt;
    const atk = s.attacks[s.idx];
    if (s.phase === 'bunch') {
      if (atk && s.elapsed >= atk.at) {
        s.phase = 'attack';
        s.phaseEnd = s.elapsed + atk.len;
        s.wheel = 100;
        api.beep(880, 0.15, 0.16);
        setTimeout(() => api.beep(880, 0.15, 0.16), 180);
      }
    } else if (s.phase === 'attack') {
      const target = s.ftp * atk.mult;
      if (power < target) {
        const deficit = (target - power) / s.ftp;
        s.wheel -= (18 + 130 * deficit) * dt;
      } else {
        s.wheel = Math.min(100, s.wheel + 10 * dt);
      }
      if (s.wheel <= 0) {
        s.finished = true; s.win = false;
        s.score = s.idx; // attacks fully survived before being dropped
        return s;
      }
      if (s.elapsed >= s.phaseEnd) {
        s.idx += 1;
        s.held += 1;
        s.phase = 'bunch';
        api.beep(660, 0.12, 0.12);
        if (s.idx >= s.attacks.length) {
          // short cooldown then finish
          s.phase = 'done-cruise';
          s.phaseEnd = s.elapsed + 20;
        }
      }
    } else if (s.phase === 'done-cruise') {
      if (s.elapsed >= s.phaseEnd) { s.finished = true; s.win = true; s.score = 3; }
    }
    return s;
  },
  betterScore(a, b) { return a > b; },
  formatScore(v) { return `${v}/3 attacks`; },
  Render({ state, power, ftp }) {
    const atk = state.attacks[state.idx];
    const inAttack = state.phase === 'attack';
    const target = inAttack ? Math.round(ftp * atk.mult) : Math.round(ftp * 0.6);
    const timeToGo = inAttack ? state.phaseEnd - state.elapsed : null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', width: '100%' }}>
        <div style={{
          padding: '10px 22px', borderRadius: 12, fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: 700, letterSpacing: 1,
          background: inAttack ? '#FF9F40' : PANEL, color: inAttack ? INK : TEXT, border: `1px solid ${inAttack ? '#FF9F40' : LINE}`,
        }}>
          {state.phase === 'bunch' && (state.idx < state.attacks.length ? 'IN THE BUNCH' : 'ALL CLEAR')}
          {inAttack && `ATTACK! HOLD ${target}W`}
          {state.phase === 'done-cruise' && 'YOU HELD EVERY WHEEL'}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <StatChip label="You" value={`${power}W`} color={inAttack && power < target ? '#FF6B4A' : 'var(--accent)'} />
          <StatChip label={inAttack ? 'Hold for' : 'Cruise at'} value={inAttack ? fmtTime(timeToGo) : `~${target}W`} />
          <StatChip label="Attacks" value={`${Math.min(state.idx, 3)}/3`} color="#FF9F40" />
        </div>
        {inAttack && (
          <div style={{ width: '100%', maxWidth: 340 }}>
            <MeterBar pct={state.wheel} color={state.wheel > 40 ? '#FF9F40' : '#FF6B4A'} label={`Wheel contact · ${Math.round(state.wheel)}%`} />
          </div>
        )}
        <div style={{ fontSize: 12.5, color: SUB }}>
          {state.phase === 'bunch' && state.idx < state.attacks.length && 'Spin easy and recover. The next one could go any second\u2026'}
          {inAttack && 'Match the surge or lose the wheel!'}
          {state.phase === 'done-cruise' && 'Roll it home: nobody could drop you today.'}
        </div>
      </div>
    );
  },
};

// =============================================================================
// GAME 5: Beat the Pros
// Real, unscaled professional power numbers. No FTP scaling, no mercy —
// you experience the literal demands of elite racing. Every effort opens
// with a rolling start (easy spin, then a ramp) so the flywheel is already
// moving before the hard part: no picking the anvil up off the floor.
// =============================================================================
const PRO_LEAD_IN = 15;   // seconds spinning easy before the ramp
const PRO_RAMP = 15;      // seconds ramping from the easy start up to target
const PRO_START_W = 150;  // gentle rolling-start wattage

const prosGame = {
  id: 'pros',
  active: true,
  title: 'Beat the Pros',
  tagline: 'Real pro watts. Not scaled to you. Good luck.',
  durationLabel: '17 s \u2013 10 min',
  difficulty: 'Elite',
  icon: Mountain,
  color: '#2FC5AE',
  scoreUnit: 'time held at pro power',
  usesErg: true,
  ergStartWatts: PRO_START_W,
  variants: [
    { id: 'sprint', name: 'Finish-line Sprint', watts: 1070, seconds: 17, note: 'Sam Bennett averaged 1,070W over 17 seconds to win a stage at the 2018 Giro d\u2019Italia, peaking above 1,480W.' },
    { id: 'tt', name: 'Time Trial Tempo', watts: 520, seconds: 150, note: 'Filippo Ganna averaged 520W over the final 2.5km (2:28) to win the 2022 Tirreno-Adriatico opening time trial.' },
    { id: 'climb', name: 'GC King Pace', watts: 445, seconds: 300, note: 'Tadej Poga\u010dar\u2019s Stage 15 win at the 2024 Tour de France: an estimated 442\u2013445W for the full 39:50 climb to Plateau de Beille. Here\u2019s a 5-minute taste.' },
    { id: 'attack', name: 'Summit Attack', watts: 414, seconds: 420, note: 'Team Sky released Chris Froome\u2019s data from Stage 10 of the 2015 Tour de France: 414W average for the full 41:30 climb to La Pierre-Saint-Martin, launched with an attack 6.4km from the line. Here\u2019s a 7-minute taste.' },
    { id: 'hour', name: 'Hour Record Pace', watts: 355, seconds: 600, note: 'Dan Bigham held ~355W for the full hour to set the UCI Hour Record (55.548km) in 2022. Here\u2019s a 10-minute taste.' },
  ],
  howTo: [
    'Pick a real professional benchmark effort. The wattage is literal: exactly what the pros put out, not scaled to your FTP.',
    'Every effort opens with a rolling start: 15 seconds spinning easy at 150W, then a smooth 15-second ramp up to the target, so the flywheel is already moving before the hard part.',
    'Once you\u2019re at pro power, hold it: your rolling average must stay above 92% of the target.',
    'Slip below for 8 straight seconds and the effort is over. Your score is how long you held pro power; last the full duration to actually beat the pros.',
  ],
  init(ftp, variant) {
    return { variant, elapsed: 0, holdElapsed: 0, below: 0, samples: [], phase: 'lead', curTarget: PRO_START_W, ergTarget: PRO_START_W, finished: false, win: false, score: 0, avg: 0 };
  },
  tick(s, power, dt, api) {
    s.elapsed += dt;
    const target = s.variant.watts;
    // rolling-start curve: easy spin → linear ramp → hold at target
    let cur;
    if (s.elapsed < PRO_LEAD_IN) {
      cur = PRO_START_W; s.phase = 'lead';
    } else if (s.elapsed < PRO_LEAD_IN + PRO_RAMP) {
      const f = (s.elapsed - PRO_LEAD_IN) / PRO_RAMP;
      cur = PRO_START_W + (target - PRO_START_W) * f; s.phase = 'ramp';
    } else {
      cur = target;
      if (s.phase !== 'hold') { s.phase = 'hold'; s.samples = []; s.below = 0; api.beep(880, 0.16, 0.14); }
    }
    s.curTarget = cur;
    s.ergTarget = cur;

    if (s.phase === 'hold') {
      s.holdElapsed += dt;
      s.samples.push(power);
      if (s.samples.length > 20) s.samples.shift(); // rolling ~5s at 4Hz
      const rolling = s.samples.reduce((a, b) => a + b, 0) / s.samples.length;
      s.avg = rolling;
      if (s.holdElapsed > 3 && rolling < target * 0.92) {
        if (s.below === 0) api.beep(300, 0.12, 0.12);
        s.below += dt;
      } else {
        s.below = 0;
      }
      if (s.below >= 8) { s.finished = true; s.win = false; s.score = Math.round(s.holdElapsed); }
      if (s.holdElapsed >= s.variant.seconds) { s.finished = true; s.win = true; s.score = s.variant.seconds; }
    } else {
      s.avg = power; // during spin-up just mirror current power
    }
    return s;
  },
  betterScore(a, b) { return a > b; },
  formatScore(v) { return fmtTime(v); },
  Render({ state, power, cvd }) {
    const target = state.variant.watts;
    const cur = Math.round(state.curTarget);
    const inHold = state.phase === 'hold';
    const maxScale = Math.max(target * 1.3, power * 1.1);
    const youPct = clamp((power / maxScale) * 100, 0, 100);
    const targetPct = (cur / maxScale) * 100; // marker rides the ramp so you can chase it
    const rolling = Math.round(state.avg);
    const onPace = inHold ? rolling >= target * 0.92 : true;
    const remaining = state.variant.seconds - state.holdElapsed;
    const paceColor = cvd ? '#009E73' : '#C9F031';
    const dangerColor = cvd ? '#D55E00' : '#FF6B4A';

    let banner, sub, bannerBg, bannerInk;
    if (state.phase === 'lead') {
      banner = `ROLLING START \u00b7 ${PRO_START_W}W`;
      sub = 'Spin easy: getting the flywheel moving.';
      bannerBg = PANEL; bannerInk = TEXT;
    } else if (state.phase === 'ramp') {
      banner = `RAMPING UP \u00b7 ${cur}W`;
      sub = 'Wind it up smoothly toward pro power\u2026';
      bannerBg = cvd ? '#E69F00' : '#FF9F40'; bannerInk = INK;
    } else {
      banner = `HOLD ${target}W`;
      sub = onPace
        ? 'On pro pace. This is what they feel like the whole race.'
        : (state.below > 0 ? `Below pro pace: ${Math.ceil(8 - state.below)}s before you blow!` : 'Lift it back to pro power!');
      bannerBg = onPace ? paceColor : dangerColor; bannerInk = INK;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', width: '100%' }}>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 18, fontWeight: 600, color: TEXT }}>{state.variant.name}</div>
        <div style={{ padding: '9px 20px', borderRadius: 12, fontFamily: 'Oswald, sans-serif', fontSize: 20, fontWeight: 700, letterSpacing: 0.8, background: bannerBg, color: bannerInk, border: `1px solid ${bannerBg === PANEL ? LINE : bannerBg}` }}>
          {banner}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <StatChip label={inHold ? 'Pro target' : 'Follow'} value={`${inHold ? target : cur}W`} color={paceColor} />
          <StatChip label={inHold ? 'You (5s avg)' : 'You'} value={`${inHold ? rolling : power}W`} color={onPace ? 'var(--accent)' : dangerColor} />
          <StatChip label={inHold ? 'To go' : 'Effort'} value={inHold ? fmtTime(remaining) : fmtTime(state.variant.seconds)} />
        </div>
        <div style={{ position: 'relative', width: '100%', maxWidth: 380, height: 44, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${youPct}%`, background: onPace ? 'var(--accent)' : '#FF6B4A', opacity: 0.85, transition: 'width 0.25s linear' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${targetPct}%`, width: 3, background: TEXT, transition: 'left 0.25s linear' }} />
        </div>
        <div style={{ fontSize: 12.5, color: onPace ? SUB : '#FF6B4A', fontWeight: onPace ? 400 : 700 }}>{sub}</div>
      </div>
    );
  },
};

export const MINI_GAMES = [lavaGame, chaseGame, bridgeGame, attackGame, prosGame];

// Beat the Pros is the only game currently exposed in the UI: the rest stay
// registered above (fully working) so they can be switched back on later by
// flipping `active` to true, once each has its own animated visuals.
export const BEAT_THE_PROS = prosGame;

// =============================================================================
// Landing page: the Mini Games library
// =============================================================================
export function MiniGamesView({ onPlay }) {
  const pbs = loadPBs();
  return (
    <div style={{ padding: '22px 20px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Gamepad2 size={22} color="var(--accent)" />
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 24, fontWeight: 600, color: TEXT }}>Mini Games</div>
        </div>
        <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.55, marginBottom: 18 }}>
          Short, replayable power games: proper training in disguise. Jump on, pick one, and see how long you last.
        </div>
        {MINI_GAMES.filter(g => g.active !== false).map(g => {
          // for variant games, surface the best PB across variants
          let pbLine = null;
          if (g.variants) {
            const held = g.variants.map(v => pbs[`${g.id}:${v.id}`]).filter(Boolean);
            if (held.length) pbLine = `${held.length}/${g.variants.length} challenges attempted`;
          } else if (pbs[g.id]) {
            pbLine = `PB: ${g.formatScore(pbs[g.id].score)}`;
          }
          return (
            <button key={g.id} onClick={() => onPlay(g)} style={{ width: '100%', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 16, padding: 14, marginBottom: 12, cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 13, alignItems: 'center' }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: PANEL2, border: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <g.icon size={22} color={g.color} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 16.5, fontWeight: 600, color: TEXT }}>{g.title}</div>
                <div style={{ fontSize: 11.5, color: SUB, marginTop: 1 }}>{g.tagline}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: SUB, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, padding: '2px 7px' }}>{g.durationLabel}</span>
                  <span style={{ fontSize: 10, color: SUB, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, padding: '2px 7px' }}>{g.difficulty}</span>
                  {pbLine && (
                    <span style={{ fontSize: 10, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Trophy size={10} /> {pbLine}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={17} color={SUB} style={{ flexShrink: 0 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Game player: full-screen host that runs whichever game is selected
// =============================================================================
export function MiniGamePlayer({ game, ftp, trainer, heartRate, onExit, cvd }) {
  const [phase, setPhase] = useState('intro'); // intro | countdown | playing | done
  const [variant, setVariant] = useState(game.variants ? game.variants[0] : null);
  const [countdown, setCountdown] = useState(3);
  const [simMode, setSimMode] = useState(false);
  const [simPower, setSimPower] = useState(Math.round(ftp * 0.7));
  const [, forceRender] = useState(0);
  const [result, setResult] = useState(null); // { win, score, isPB, prevPB }
  const stateRef = useRef(null);
  const lastTickRef = useRef(null);
  const powerRef = useRef(0);
  const simPowerRef = useRef(simPower);
  const wakeLockRef = useRef(null);
  const lastErgRef = useRef(null); // last ERG target written, to avoid redundant BLE writes
  const lastErgWriteAtRef = useRef(0); // when we last wrote a target, for periodic re-assert
  const beep = useGameBeeper();

  useEffect(() => { simPowerRef.current = simPower; }, [simPower]);
  useEffect(() => { powerRef.current = trainer.power !== null ? trainer.power : (simMode ? simPowerRef.current : 0); }, [trainer.power, simMode, simPower]);

  // Skill games (chase, lava, etc.) need the rider to freely vary their own
  // power, so make sure the trainer isn't left in ERG from a previous game.
  useEffect(() => {
    if (!game.usesErg && trainer.hasControl && trainer.endErg) trainer.endErg();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pbKey = variant ? `${game.id}:${variant.id}` : game.id;

  function start() {
    setPhase('countdown');
    setCountdown(3);
  }

  // countdown 3-2-1
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      stateRef.current = game.init(ftp, variant);
      lastTickRef.current = performance.now();
      // Prime the trainer at the gentle rolling-start wattage so the flywheel
      // is light the instant the game starts: no lifting the anvil.
      if (game.usesErg && trainer.hasControl) {
        const startW = game.ergStartWatts || 150;
        trainer.setErgTarget(startW);
        lastErgRef.current = startW;
        lastErgWriteAtRef.current = performance.now();
      }
      beep(880, 0.18, 0.14);
      setPhase('playing');
      try { navigator.wakeLock && navigator.wakeLock.request('screen').then(l => { wakeLockRef.current = l; }).catch(() => {}); } catch (e) {}
      return;
    }
    beep(660, 0.1, 0.1);
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // main game loop: 4 Hz with real measured dt so throttled tabs stay honest
  useEffect(() => {
    if (phase !== 'playing') return;
    const iv = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1.5, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;
      const power = trainer.power !== null ? trainer.power : (simMode ? simPowerRef.current : 0);
      const s = game.tick(stateRef.current, power, dt, { ftp, beep });
      stateRef.current = s;
      // Drive the trainer along the game's target curve (rolling start → ramp
      // → hold) so ERG resistance eases in instead of slamming to full watts.
      //
      // Two things matter here, both learned from the "Beat the Pros ERG never
      // brought the resistance up, so I spun madly and couldn't catch the pro"
      // report on a wheel-on trainer (KICKR SNAP):
      //   1. RE-ASSERT the target at least once a second even when it hasn't
      //      changed. Previously, once the hold phase started, the pro wattage
      //      was written exactly ONCE (at the end of the ramp) and never again,
      //      because the target stops changing. A wheel-on trainer that dropped
      //      or lagged that single write then sat at low resistance for the
      //      whole effort with nothing to correct it. A steady ~1 Hz refresh is
      //      normal ERG behaviour and guarantees the trainer reaches pro watts.
      //   2. THROTTLE the ramp to >=5 W steps. The old code sent a fresh target
      //      every 250 ms tick during the 15 s ramp (~60 rapid writes); some
      //      trainers can't chase a target that keeps moving that fast and never
      //      settle. Bigger, less frequent steps are easier to follow.
      if (game.usesErg && trainer.hasControl && s.ergTarget != null) {
        const w = Math.round(s.ergTarget);
        const movedEnough = Math.abs(w - (lastErgRef.current == null ? -9999 : lastErgRef.current)) >= 5;
        const dueForRefresh = (now - lastErgWriteAtRef.current) >= 1000;
        if (movedEnough || dueForRefresh) {
          trainer.setErgTarget(w);
          lastErgRef.current = w;
          lastErgWriteAtRef.current = now;
        }
      }
      if (s.finished) {
        if (game.usesErg && trainer.hasControl && trainer.endErg) trainer.endErg();
        const pbs = loadPBs();
        const prev = pbs[pbKey];
        const isPB = s.score > 0 && (!prev || game.betterScore(s.score, prev.score));
        if (isPB) savePB(pbKey, { score: s.score, date: new Date().toISOString() });
        setResult({ win: s.win, score: s.score, isPB, prevPB: prev ? prev.score : null });
        beep(s.win ? 988 : 220, 0.25, 0.15);
        setPhase('done');
        try { wakeLockRef.current && wakeLockRef.current.release(); } catch (e) {}
      } else {
        forceRender(n => n + 1);
      }
    }, 250);
    return () => clearInterval(iv);
  }, [phase, simMode]);

  useEffect(() => () => {
    try { wakeLockRef.current && wakeLockRef.current.release(); } catch (e) {}
    if (game.usesErg && trainer.hasControl && trainer.endErg) trainer.endErg();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const power = trainer.power !== null ? trainer.power : (simMode ? simPower : 0);
  const noSource = trainer.status !== 'connected' && !simMode;

  const btn = { padding: '12px 18px', borderRadius: 12, border: `1px solid ${LINE}`, background: PANEL, color: TEXT, fontSize: 14, cursor: 'pointer', fontWeight: 600 };
  const primaryBtn = { ...btn, background: 'var(--accent)', color: INK, border: '1px solid var(--accent)' };

  // ---------- intro ----------
  if (phase === 'intro') {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'calc(20px + env(safe-area-inset-top)) 20px 40px', overflow: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 460 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <game.icon size={22} color={game.color} />
              <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: 600, color: TEXT }}>{game.title}</div>
            </div>
            <button onClick={onExit} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }}><X size={20} color={SUB} /></button>
          </div>

          <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }}>How to play</div>
            {game.howTo.map((line, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 7 }}>
                <div style={{ color: 'var(--accent)', fontSize: 12, lineHeight: '19px' }}>{'\u25B8'}</div>
                <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.5 }}>{line}</div>
              </div>
            ))}
          </div>

          {game.variants && (
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 10 }}>Pick your pro challenge</div>
              {game.variants.map(v => {
                const sel = variant && variant.id === v.id;
                const pb = loadPBs()[`${game.id}:${v.id}`];
                return (
                  <button key={v.id} onClick={() => setVariant(v)} style={{ width: '100%', textAlign: 'left', background: sel ? PANEL2 : 'transparent', border: `1px solid ${sel ? 'var(--accent)' : LINE}`, borderRadius: 10, padding: '10px 12px', marginBottom: 8, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{v.name}</div>
                      <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 13, color: 'var(--accent)' }}>{v.watts}W · {fmtTime(v.seconds)}</div>
                    </div>
                    <div style={{ fontSize: 11.5, color: SUB, marginTop: 3, lineHeight: 1.45 }}>{v.note}</div>
                    {pb && <div style={{ fontSize: 10.5, color: 'var(--accent)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><Trophy size={11} /> PB: {game.formatScore(pb.score)}</div>}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, marginBottom: 18 }}>
            <div style={{ fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 10 }}>Power source</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              {trainer.status === 'connected' ? <Bluetooth size={17} color="var(--accent)" /> : <BluetoothOff size={17} color={SUB} />}
              <div style={{ fontSize: 13, color: TEXT, flex: 1 }}>
                {trainer.status === 'connected' ? (trainer.deviceName || 'Trainer connected') : 'No trainer connected'}
              </div>
              {trainer.status !== 'connected' && (
                <button onClick={trainer.connect} style={{ ...btn, padding: '8px 14px', fontSize: 12.5 }}>Connect</button>
              )}
            </div>
            {trainer.status !== 'connected' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                <input type="checkbox" checked={simMode} onChange={e => setSimMode(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: 12.5, color: SUB }}>Practice without a trainer (control power with a slider)</span>
              </label>
            )}
            {/* For an ERG game (Beat the Pros), spell out whether the trainer
                will actually set the resistance — the difference between the
                trainer winding up to the pro's watts on its own vs. the rider
                having to chase a number by spinning, which reads as "the erg
                didn't bring the resistance up." */}
            {trainer.status === 'connected' && game.usesErg && (
              trainer.hasControl ? (
                <div style={{ fontSize: 11.5, color: SUB, lineHeight: 1.45 }}>
                  ERG ready: the trainer sets its own resistance to the pro's exact wattage. Don't spin frantically to catch them; hold a steady cadence and let the resistance do the work. If a target is higher than your trainer can physically produce (some cap around 1,000–2,000W), it'll hold at its own ceiling.
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: cvd ? '#E69F00' : '#FF9F40', lineHeight: 1.45 }}>
                  Heads up: this trainer is connected for power readings only; the app can't drive its resistance, so it won't wind up to the pro's wattage on its own. You'll have to reach the target yourself (harder gear, ride harder). Automatic resistance needs a trainer that supports FTMS or Wahoo ERG control.
                </div>
              )
            )}
          </div>

          <button onClick={start} disabled={noSource} style={{ ...primaryBtn, width: '100%', padding: 15, fontSize: 15.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: noSource ? 0.45 : 1, cursor: noSource ? 'default' : 'pointer' }}>
            <Play size={17} /> {noSource ? 'Connect a trainer or enable practice mode' : 'Start'}
          </button>
        </div>
      </div>
    );
  }

  // ---------- countdown ----------
  if (phase === 'countdown') {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 18, color: SUB }}>{game.title}</div>
        <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 84, color: 'var(--accent)', fontWeight: 700 }}>{countdown}</div>
        <div style={{ fontSize: 13, color: SUB }}>{'Get up to speed\u2026'}</div>
      </div>
    );
  }

  // ---------- done ----------
  if (phase === 'done' && result) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
          <div style={{ fontSize: 46, marginBottom: 8 }}>{result.win ? '\uD83C\uDFC6' : '\uD83D\uDCA5'}</div>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 26, fontWeight: 700, color: TEXT, marginBottom: 4 }}>
            {result.win ? 'You did it!' : 'Game over'}
          </div>
          <div style={{ fontSize: 13, color: SUB, marginBottom: 20 }}>
            {game.title}{variant ? ` · ${variant.name}` : ''}
          </div>
          <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 18, marginBottom: 10 }}>
            <div style={{ fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase' }}>{game.scoreUnit}</div>
            <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 34, color: 'var(--accent)', marginTop: 4 }}>{game.formatScore(result.score)}</div>
            {result.isPB && (
              <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent)', color: INK, fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '4px 12px' }}>
                <Trophy size={12} /> NEW PERSONAL BEST
              </div>
            )}
            {!result.isPB && result.prevPB != null && (
              <div style={{ fontSize: 11.5, color: SUB, marginTop: 8 }}>PB: {game.formatScore(result.prevPB)}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button onClick={() => { setResult(null); setPhase('intro'); }} style={{ ...primaryBtn, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              <RotateCcw size={15} /> Play again
            </button>
            <button onClick={onExit} style={{ ...btn, flex: 1 }}>Back to games</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- playing ----------
  const s = stateRef.current;
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: 'calc(14px + env(safe-area-inset-top)) 16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: 520, margin: '0 auto 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <game.icon size={17} color={game.color} />
          <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: 15, fontWeight: 600, color: TEXT }}>{game.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 14, color: SUB }}>{s ? fmtTime(s.elapsed) : '0:00'}</span>
          {heartRate && heartRate.bpm !== null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'Space Mono, monospace', fontSize: 13, color: TEXT }}>
              <HeartPulse size={14} color="#FF6B4A" /> {heartRate.bpm}
            </span>
          )}
          <button onClick={onExit} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={19} color={SUB} /></button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '100%', maxWidth: 520, margin: '0 auto' }}>
        {s && <game.Render state={s} power={Math.round(power)} ftp={ftp} cvd={cvd} />}
      </div>

      {simMode && trainer.status !== 'connected' && (
        <div style={{ width: '100%', maxWidth: 420, margin: '0 auto', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Gauge size={15} color={SUB} />
          <button onClick={() => setSimPower(p => Math.max(0, p - 25))} style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex' }}><Minus size={14} color={TEXT} /></button>
          <input type="range" min={0} max={1200} step={5} value={simPower} onChange={e => setSimPower(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
          <button onClick={() => setSimPower(p => Math.min(1200, p + 25))} style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex' }}><Plus size={14} color={TEXT} /></button>
          <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 13, color: TEXT, minWidth: 52, textAlign: 'right' }}>{simPower}W</span>
        </div>
      )}
    </div>
  );
}
