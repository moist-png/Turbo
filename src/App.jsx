import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play, Pause, SkipForward, SkipBack, RotateCcw, X, Plus, Trash2, ChevronUp, ChevronDown, ChevronRight,
  Search, Library, Wrench, Gauge, Save, Edit3, Copy, Settings as SettingsIcon, Bluetooth,
  BluetoothOff, Volume2, Sun, Moon, RefreshCw, Check, Zap, ChevronDown as ChevDown, Bike, Dumbbell, Home,
  Trophy, HeartPulse, Upload, Flame, Link as LinkIcon, CalendarDays, BarChart3, Locate,
} from 'lucide-react';
import { supabase } from './supabaseClient';

// ---------- palette ----------
// TEXT/SUB/PANEL/PANEL2/LINE/RED/BG/MUTED resolve through CSS custom
// properties (set on the app's root wrapper from THEMES below) so every
// component that already references these constants repaints automatically
// when the person switches between dark and light mode. INK is the one
// exception: it's the fixed dark foreground used for icons/text sitting on
// top of the (always-bright) accent color, so it stays constant in both themes.
const INK = '#14171A';
const BG = 'var(--bg)';
const PANEL = 'var(--panel)';
const PANEL2 = 'var(--panel2)';
const LINE = 'var(--line)';
const TEXT = 'var(--text)';
const SUB = 'var(--sub)';
const RED = 'var(--red)';
const MUTED = 'var(--muted)';
const NAVBG = 'var(--navbg)';
const THEMES = {
  dark: {
    bg: '#14171A', panel: '#1D2126', panel2: '#242930', line: '#31373F',
    text: '#E9ECEF', sub: '#8B929B', red: '#FF4D4D', muted: '#4a4f56',
    navbg: 'rgba(20,23,26,0.96)',
    // NEW: category hero surfaces + streak flame
    hero1: 'repeating-linear-gradient(135deg,#20252b,#20252b 10px,#1a1e23 10px,#1a1e23 20px)',
    hero1ink: 'var(--accent)', hero1chip: 'rgba(20,23,26,0.72)',
    hero2: 'repeating-linear-gradient(135deg,#20252b,#20252b 10px,#1a1e23 10px,#1a1e23 20px)',
    hero2ink: 'var(--accent)', hero2chip: 'rgba(20,23,26,0.72)',
    flame: 'var(--accent)',
  },
  light: {
    bg: '#F3F4F6', panel: '#FFFFFF', panel2: '#ECEEF1', line: '#DDE1E6',
    text: '#14171A', sub: '#6B7280', red: '#D9333F', muted: '#C7CBD1',
    navbg: 'rgba(255,255,255,0.96)',
    hero1: 'repeating-linear-gradient(135deg,#EEF1F3,#EEF1F3 10px,#E7EBEE 10px,#E7EBEE 20px)',
    hero1ink: 'var(--accent)', hero1chip: '#F0FBDD',
    hero2: 'repeating-linear-gradient(135deg,#EEF1F3,#EEF1F3 10px,#E7EBEE 10px,#E7EBEE 20px)',
    hero2ink: 'var(--accent)', hero2chip: '#F0FBDD',
    flame: 'var(--accent)',
  },
  // NEW THEME
  palette: {
    bg: '#F3EDE3', panel: '#FFFFFF', panel2: '#E9E0D0', line: '#EAE1D2',
    text: '#2A2A2A', sub: '#9A9184', red: '#C0392B', muted: '#CFC5B4',
    navbg: 'rgba(250,246,239,0.96)',
    hero1: '#C0F5ED', hero1ink: '#1F6F63', hero1chip: 'rgba(255,255,255,0.72)',
    hero2: '#E6CBA8', hero2ink: '#8A5A22', hero2chip: 'rgba(255,255,255,0.72)',
    flame: '#D79A4E',
    // Default theme always shows teal trim, regardless of the accent colour picked in Settings
    accent: '#2FC5AE',
  },
};
const DEFAULT_SETTINGS = {
  theme: 'dark', // 'dark' | 'light'
  accentColor: '#C9F031',
  soundIntervalBeep: true,
  soundCountdown: true,
  soundCompletion: true,
  soundVolume: 0.7,
  soundZoneTones: true,
  soundHalfwayFinal: true,
  soundRichFanfare: true,
  soundOffTargetNudge: false,
  targetDisplay: 'both',
  showNextPreview: true,
  compactLabels: false,
  keepAwake: true,
  autoPauseOnDisconnect: false,
  ergMode: false,
  preferredOrientation: 'landscape', // 'landscape' | 'portrait'
  visualZoneWash: true,
  visualProgressRing: true,
  visualPowerGauge: true,
  visualCelebration: true,
};

// ---------- account / trial / billing ----------
// Accounts, sessions, and password resets are handled for real by Supabase
// Auth (see src/supabaseClient.js). Payments are still a placeholder \u2014 the
// "Subscribe" button flips a flag in the database rather than charging a
// real card. To take real payments you'd add Stripe (or Apple/Google
// in-app purchase if you distribute through their app stores).
const TRIAL_DAYS = 7;
const MONTHLY_PRICE_LABEL = '$7.99 / month'; // placeholder \u2014 set your real price
const ANNUAL_PRICE_LABEL = '$79.99 / year'; // keep in sync with ANNUAL_PRICE_CENTS in api/create-checkout-session.js
// Strava's Client ID (not secret -- safe to have in front-end code, unlike
// the Client Secret which only ever lives server-side as a Vercel env var).
// Get this from https://www.strava.com/settings/api after creating an API
// application, then paste it in here. Until it's set, the Strava section
// in Settings stays hidden instead of showing a broken "Connect" button.
const STRAVA_CLIENT_ID = '';
function daysLeftInTrial(trialStart) {
  if (!trialStart) return 0;
  const start = new Date(trialStart).getTime();
  const elapsedDays = (Date.now() - start) / 86400000;
  return Math.max(0, Math.ceil(TRIAL_DAYS - elapsedDays));
}
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

const ZONE_FREE = { color: '#4B5563', name: 'Free' };
function zoneFor(interval) {
  if (interval.type === 'free') return { ...ZONE_FREE, intensity: 0.16 };
  if (interval.type === 'power') {
    const p = interval.target;
    let z;
    if (p <= 55) z = { color: '#4A6FA5', name: 'Recovery' };
    else if (p <= 75) z = { color: '#4FB8A6', name: 'Endurance' };
    else if (p <= 90) z = { color: '#8FC93A', name: 'Tempo' };
    else if (p <= 105) z = { color: '#C9F031', name: 'Threshold' };
    else if (p <= 120) z = { color: '#FF9F40', name: 'VO2 Max' };
    else z = { color: '#FF4D4D', name: 'Anaerobic' };
    return { ...z, intensity: Math.min(1.3, p / 150) };
  }
  const r = interval.target;
  let z;
  if (r <= 2) z = { color: '#4A6FA5', name: 'Recovery' };
  else if (r <= 4) z = { color: '#4FB8A6', name: 'Endurance' };
  else if (r <= 6) z = { color: '#8FC93A', name: 'Tempo' };
  else if (r === 7) z = { color: '#C9F031', name: 'Threshold' };
  else if (r <= 9) z = { color: '#FF9F40', name: 'VO2 Max' };
  else z = { color: '#FF4D4D', name: 'Anaerobic' };
  return { ...z, intensity: r / 10 };
}

// A distinct musical note per zone so a rider can hear what's coming next
// without looking at the screen \u2014 low and mellow for recovery, sharp and
// high for anaerobic efforts.
const ZONE_TONE_FREQ = { Recovery: 520, Endurance: 660, Tempo: 760, Threshold: 880, 'VO2 Max': 1020, Anaerobic: 1180, Free: 700 };
// Confetti palette for the finish-line celebration \u2014 reuses the same
// bright, high-contrast colors as the zone system so it feels on-brand.
const CONFETTI_COLORS = ['#C9F031', '#FF9F40', '#4FB8A6', '#FF6B4A', '#5AA9E6', '#FF4D4D'];
function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
function fmtLong(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}
function formatTarget(it, ftp, mode) {
  if (it.type === 'free') return 'Free / rest';
  if (it.type === 'rpe') return `RPE ${it.target} / 10`;
  const watts = Math.round((ftp * it.target) / 100);
  if (mode === 'watts') return `${watts}W`;
  if (mode === 'percent') return `${it.target}% FTP`;
  return `${it.target}% FTP \u00b7 ${watts}W`;
}
let idCounter = 1;
function newId() { return 'iv' + (idCounter++) + '_' + Math.random().toString(36).slice(2, 7); }
function iv(label, duration, type, target) {
  return { id: newId(), label, duration, type, target };
}
function repeatIv(count, factory) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(...factory(i));
  return out;
}
function totalDuration(intervals) { return intervals.reduce((a, b) => a + b.duration, 0); }

// ---------- smart interval scaling ----------
// Classifies each interval so we know how it's allowed to change when the
// workout length is adjusted: warmup/cooldown, short hard "anchor" efforts,
// short easy "rest" blocks, or flexible steady-state "base" blocks.
function classifyIv(it, idx, arr) {
  const label = it.label || '';
  if (idx === 0 && /warm/i.test(label)) return 'warmup';
  if (idx === arr.length - 1 && /cool/i.test(label)) return 'cooldown';
  const hardShort = it.duration <= 300 && (
    (it.type === 'power' && it.target >= 95) ||
    (it.type === 'rpe' && it.target >= 7)
  );
  if (hardShort) return 'anchor';
  const easyShort = it.duration <= 240 && (
    it.type === 'free' ||
    (it.type === 'power' && it.target !== null && it.target <= 60) ||
    (it.type === 'rpe' && it.target !== null && it.target <= 3)
  );
  if (easyShort) return 'rest';
  return 'base';
}

// How far a single interval of a given class is allowed to stretch/shrink
// before we stop touching it and use a different lever instead (more reps,
// or an extra filler block).
function ivBounds(cls, dur) {
  switch (cls) {
    case 'warmup':
    case 'cooldown':
      return { min: Math.max(60, Math.round(dur * 0.6)), max: Math.max(dur, 900) };
    case 'anchor':
      return { min: Math.max(5, Math.round(dur * 0.8)), max: Math.round(dur * 1.2) };
    case 'rest':
      return { min: Math.max(5, Math.round(dur * 0.6)), max: Math.round(dur * 1.6) };
    default:
      return { min: Math.max(60, Math.round(dur * 0.5)), max: Math.round(dur * 2.2) };
  }
}

function ivSignature(it) { return `${it.type}|${it.target}|${it.duration}`; }

// Picks out the "signature" effort of a workout so long stretches can add
// more of it, rather than only growing one block or piling on plain
// endurance. If the workout has a repeating set (tabata, VO2 reps, etc.)
// that whole set is the signature. Otherwise the most intense sustained
// block (sweet spot, threshold, etc.) is used as a template.
// This is the ORIGINAL, default scaling behaviour \u2014 used for every
// workout except the ones explicitly opted into "whole core" scaling below.
function findSignatureModule(originalIntervals, classes, groups) {
  if (groups.length > 0) {
    let best = null;
    for (const g of groups) {
      const dur = totalDuration(g.items) * g.origReps;
      if (!best || dur > best.duration) best = { duration: dur, group: g };
    }
    return {
      duration: best.duration,
      build: () => {
        const out = [];
        for (let r = 0; r < best.group.origReps; r++) {
          for (const it of best.group.items) out.push({ ...it, id: newId() });
        }
        return out;
      },
    };
  }
  const candidates = originalIntervals
    .map((it, idx) => ({ it, cls: classes[idx] }))
    .filter(x => x.cls === 'base' && x.it.duration >= 180 &&
      ((x.it.type === 'power' && x.it.target >= 80) || (x.it.type === 'rpe' && x.it.target >= 6)));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.it.target || 0) - (a.it.target || 0));
  const template = candidates[0].it;
  return { duration: template.duration, build: () => [{ ...template, id: newId() }] };
}

// Fills the time a workout still needs once reps/stretching are maxed out.
// For modest amounts it's just an Endurance block. For much bigger
// stretches, extra copies of the workout's signature set are sprinkled in
// (roughly one more per additional hour, capped at 4) with Endurance
// riding filling the gaps around them.
function buildLongExtension(diff, targetSeconds, origTotal, module) {
  const blockCap = 25 * 60;
  const items = [];
  let remaining = diff;
  const extraModules = [];
  if (module && module.duration > 0) {
    const spacing = 60 * 60;
    const desiredExtra = Math.min(4, Math.floor(Math.max(0, targetSeconds - origTotal) / spacing));
    while (extraModules.length < desiredExtra && remaining > module.duration * 0.9) {
      extraModules.push(module.build());
      remaining -= module.duration;
    }
  }
  if (extraModules.length === 0) {
    while (remaining > 60) {
      const d = Math.min(blockCap, remaining);
      items.push(iv('Endurance', Math.round(d), 'power', 68));
      remaining -= d;
    }
    return items;
  }
  const gaps = extraModules.length + 1;
  const perGap = remaining / gaps;
  for (let g = 0; g < gaps; g++) {
    let gapRemaining = perGap;
    while (gapRemaining > 60) {
      const d = Math.min(blockCap, gapRemaining);
      items.push(iv('Endurance', Math.round(d), 'power', 68));
      gapRemaining -= d;
    }
    if (g < extraModules.length) items.push(...extraModules[g]);
  }
  return items;
}

// OPT-IN ONLY (workout.repeatWholeCore === true, currently just Rolling
// endurance): everything between the warm up and cool down, so a rolling
// wave of effort can be repeated as a WHOLE extra lap rather than one
// block being stretched thin. Only ever adds a lap when there's a FULL
// lap's worth of extra time available, so it can never overshoot the
// target length \u2014 the normal stretch/filler system above still handles
// every workout that hasn't opted in, and handles any leftover time here.
function findCoreModule(originalIntervals, classes) {
  const n = originalIntervals.length;
  if (n === 0) return null;
  let start = 0, end = n;
  if (classes[0] === 'warmup') start = 1;
  if (classes[n - 1] === 'cooldown') end = n - 1;
  if (start >= end) return null;
  const coreItems = originalIntervals.slice(start, end);
  const duration = totalDuration(coreItems);
  if (duration <= 0) return null;
  return { duration, build: () => coreItems.map(it => ({ ...it, id: newId() })) };
}


// Finds back-to-back repeating blocks, e.g. 5x[VO2, Recovery], so extra
// time can be filled by adding whole reps instead of stretching each one.
function findRepeatGroups(intervals) {
  const n = intervals.length;
  const groups = [];
  let i = 0;
  while (i < n) {
    let bestLen = 0, bestUnit = 0, bestReps = 0;
    const maxUnit = Math.min(3, Math.floor((n - i) / 2));
    for (let unit = 1; unit <= maxUnit; unit++) {
      const sig = intervals.slice(i, i + unit).map(ivSignature).join(',');
      let reps = 1;
      while (i + (reps + 1) * unit <= n) {
        const nextSig = intervals.slice(i + reps * unit, i + (reps + 1) * unit).map(ivSignature).join(',');
        if (nextSig === sig) reps++; else break;
      }
      if (reps >= 2 && reps * unit > bestLen) { bestLen = reps * unit; bestUnit = unit; bestReps = reps; }
    }
    if (bestUnit > 0) {
      groups.push({ start: i, unit: bestUnit, origReps: bestReps, reps: bestReps, items: intervals.slice(i, i + bestUnit) });
      i += bestLen;
    } else {
      i += 1;
    }
  }
  return groups;
}

// Rebuilds the final interval list: expands/contracts each repeat group to
// its (possibly adjusted) rep count, keeps standalone intervals at their
// (possibly adjusted) duration, and drops in any filler blocks before a
// trailing cooldown.
function assembleScaled(originalIntervals, classes, groups, inGroup, durations, fillers) {
  const n = originalIntervals.length;
  const result = [];
  let i = 0;
  while (i < n) {
    const gi = inGroup[i];
    if (gi >= 0 && groups[gi].start === i) {
      const g = groups[gi];
      for (let r = 0; r < g.reps; r++) {
        for (let u = 0; u < g.unit; u++) {
          const srcIdx = g.start + u;
          result.push({ ...originalIntervals[srcIdx], id: newId(), duration: Math.max(5, Math.round(durations[srcIdx])) });
        }
      }
      i += g.unit * g.origReps;
    } else {
      result.push({ ...originalIntervals[i], duration: Math.max(5, Math.round(durations[i])) });
      i += 1;
    }
  }
  if (fillers.length > 0) {
    const lastIsCooldown = classes[n - 1] === 'cooldown';
    if (lastIsCooldown && result.length > 0) {
      const tail = result.pop();
      result.push(...fillers, tail);
    } else {
      result.push(...fillers);
    }
  }
  return result;
}

// Scales a workout to a target duration without just stretching every
// interval by the same factor. Order of preference when growing:
//  1. Add or remove whole reps of any literal repeating block (keeps each
//     rep's length close to the original, just does more/fewer of them).
//  2. For workouts that opt in (repeatWholeCore, currently just Rolling
//     endurance) with no literal repeating block: add whole extra laps of
//     the workout's "core" \u2014 everything between warm up and cool down \u2014
//     but only when there's a FULL lap's worth of extra time, so this can
//     never overshoot the target length.
//  3. Stretch or shrink flexible steady-state blocks (warmup, cooldown,
//     endurance/tempo/sweet-spot blocks) within a sane range to fine-tune.
//  4. If more time is still needed, sprinkle in the workout's signature
//     effort (or Endurance riding) rather than stretching anything
//     unreasonably far. This is the original system and is what every
//     workout other than Rolling endurance still uses.
//  5. If less time is still needed, fall back to trimming short hard/easy
//     blocks that aren't part of a repeating group.
function smartScaleWorkout(originalIntervals, targetSeconds, repeatWholeCore) {
  const n = originalIntervals.length;
  const origTotal = totalDuration(originalIntervals);
  if (n === 0 || Math.abs(targetSeconds - origTotal) < 5) {
    return originalIntervals.map(it => ({ ...it }));
  }

  const classes = originalIntervals.map((it, idx) => classifyIv(it, idx, originalIntervals));
  const groups = findRepeatGroups(originalIntervals);
  const inGroup = new Array(n).fill(-1);
  groups.forEach((g, gi) => { for (let k = g.start; k < g.start + g.unit * g.origReps; k++) inGroup[k] = gi; });

  const durations = originalIntervals.map(it => it.duration);
  let diff = targetSeconds - origTotal;

  function flexibleIndices(clsList) {
    return originalIntervals.map((_, idx) => idx)
      .filter(idx => inGroup[idx] === -1 && clsList.includes(classes[idx]));
  }

  if (diff > 0) {
    // 1) add whole reps to existing repeat groups
    for (const g of groups) {
      const unitDur = totalDuration(g.items);
      if (unitDur <= 0) continue;
      const maxReps = Math.min(Math.ceil(g.origReps * 1.5), g.origReps + 3);
      while (diff > unitDur * 0.5 && g.reps < maxReps) {
        g.reps += 1;
        diff -= unitDur;
      }
    }
    // 1b) opt-in only: add whole extra laps of the core pattern, but only
    //     when a full lap's worth of time is available, so it can't overshoot
    let addedModules = [];
    if (repeatWholeCore && groups.length === 0) {
      const module = findCoreModule(originalIntervals, classes);
      if (module && module.duration > 0) {
        const maxAdd = 4;
        while (diff >= module.duration && addedModules.length < maxAdd) {
          addedModules.push(module.build());
          diff -= module.duration;
        }
      }
    }
    // 2) stretch flexible standalone blocks up to their caps
    let flexIdx = flexibleIndices(['base', 'warmup', 'cooldown']);
    if (diff > 0 && flexIdx.length > 0) {
      const room = flexIdx.map(idx => ivBounds(classes[idx], durations[idx]).max - durations[idx]);
      const totalRoom = room.reduce((a, b) => a + b, 0);
      if (totalRoom > 0) {
        const use = Math.min(diff, totalRoom);
        flexIdx.forEach((idx, k) => { durations[idx] += (room[k] / totalRoom) * use; });
        diff -= use;
      }
    }
    // 3) still need more time: sprinkle in the signature set (if the
    //    stretch is big enough to warrant it) plus Endurance riding \u2014 the
    //    original system, unchanged, plus any laps added in step 1b
    const fillers = addedModules.reduce((acc, m) => acc.concat(m), []);
    if (diff > 60) {
      const module = findSignatureModule(originalIntervals, classes, groups);
      fillers.push(...buildLongExtension(diff, targetSeconds, origTotal, module));
    }
    if (fillers.length > 0) {
      return assembleScaled(originalIntervals, classes, groups, inGroup, durations, fillers);
    }
  } else if (diff < 0) {
    let need = -diff;
    // 1) remove whole reps from the biggest repeat groups first, floor at 1 rep
    let safety = 0;
    while (need > 0 && safety < 500) {
      safety++;
      const candidates = groups.filter(g => g.reps > 1);
      if (candidates.length === 0) break;
      candidates.sort((a, b) => b.reps - a.reps);
      const g = candidates[0];
      const unitDur = totalDuration(g.items);
      if (unitDur <= 0) break;
      g.reps -= 1;
      need -= unitDur;
    }
    // 2) shrink flexible standalone blocks down to their floors
    let flexIdx = flexibleIndices(['base', 'warmup', 'cooldown']);
    if (need > 0 && flexIdx.length > 0) {
      const room = flexIdx.map(idx => Math.max(0, durations[idx] - ivBounds(classes[idx], durations[idx]).min));
      const totalRoom = room.reduce((a, b) => a + b, 0);
      if (totalRoom > 0) {
        const use = Math.min(need, totalRoom);
        flexIdx.forEach((idx, k) => { durations[idx] -= (room[k] / totalRoom) * use; });
        need -= use;
      }
    }
    // 3) last resort: trim standalone hard/easy blocks that aren't in a group
    let otherIdx = flexibleIndices(['anchor', 'rest']);
    if (need > 0 && otherIdx.length > 0) {
      const room = otherIdx.map(idx => Math.max(0, durations[idx] - ivBounds(classes[idx], durations[idx]).min));
      const totalRoom = room.reduce((a, b) => a + b, 0);
      if (totalRoom > 0) {
        const use = Math.min(need, totalRoom);
        otherIdx.forEach((idx, k) => { durations[idx] -= (room[k] / totalRoom) * use; });
        need -= use;
      }
    }
  }

  return assembleScaled(originalIntervals, classes, groups, inGroup, durations, []);
}

// ---------- preloaded library ----------
const LIBRARY = [
  {
    id: 'ramp-ftp-test', name: 'Ramp FTP test', category: 'Basics',
    description: 'Power climbs a little every minute until you can\u2019t hold it \u2014 no long steady effort needed.',
    notes: 'Ride until you can no longer hold the target power. If a trainer is connected, the app will notice when you fall off the pace and end the test for you automatically, then estimate your FTP. Without a trainer connected, stop yourself, find the last full minute you completed, take its power, and multiply by 0.75 \u2014 that\u2019s your new FTP, update it in Settings.',
    autoStopTest: true,
    ftpMultiplier: 0.75,
    fixedLength: true,
    intervals: [
      iv('Warm up', 600, 'power', 55),
      ...Array.from({ length: 21 }, (_, i) => iv(i === 20 ? 'Max effort' : 'Ramp step', 60, 'power', 50 + i * 5)),
      iv('Cool down', 300, 'power', 50),
    ],
  },
  {
    id: 'ftp-test-20', name: '20 minute FTP test', category: 'Basics',
    description: 'The standard test protocol for finding your current FTP.',
    notes: 'After the 20 minute effort, take your average power for that block and multiply by 0.95. That number is your new FTP \u2014 update it in Settings.',
    fixedLength: true,
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Opener', 60, 'rpe', 8), iv('Easy', 60, 'power', 50),
      iv('Opener', 60, 'rpe', 8), iv('Easy', 60, 'power', 50),
      iv('Opener', 60, 'rpe', 8), iv('Easy', 60, 'power', 50),
      iv('Easy spin', 300, 'power', 50),
      iv('Primer effort', 300, 'rpe', 9),
      iv('Recovery', 600, 'power', 50),
      iv('20 minute test', 1200, 'rpe', 10),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'endurance-hour', name: 'Steady endurance hour', category: 'Basics',
    description: 'Long steady aerobic ride to build your base.',
    intervals: [iv('Warm up', 300, 'power', 55), iv('Endurance', 2400, 'power', 68), iv('Cool down', 300, 'power', 50)],
  },
  {
    id: 'rolling-endurance', name: 'Rolling endurance', category: 'Basics',
    description: 'Steady aerobic ride that rolls gently up and down like rolling terrain, 55\u201375% FTP.',
    repeatWholeCore: true,
    intervals: [
      iv('Warm up', 300, 'power', 55),
      iv('Roll up', 600, 'power', 62),
      iv('Roll up', 600, 'power', 70),
      iv('Rolling peak', 600, 'power', 75),
      iv('Roll down', 600, 'power', 66),
      iv('Roll down', 600, 'power', 58),
      iv('Roll up', 600, 'power', 68),
      iv('Cool down', 300, 'power', 50),
    ],
  },
  {
    id: 'sweet-spot-builder', name: 'Sweet spot builder', category: 'Basics',
    description: 'Two sweet spot blocks either side of a short recovery.',
    intervals: [iv('Warm up', 480, 'power', 60), iv('Sweet spot', 720, 'power', 90), iv('Recovery', 300, 'power', 55), iv('Sweet spot', 720, 'power', 92), iv('Cool down', 360, 'power', 50)],
  },
  {
    id: 'threshold-2x20', name: 'Threshold 2\u00d720', category: 'Basics',
    description: 'Classic two 20 minute blocks at threshold power.',
    intervals: [iv('Warm up', 600, 'power', 60), iv('Threshold', 1200, 'power', 98), iv('Recovery', 480, 'power', 55), iv('Threshold', 1200, 'power', 100), iv('Cool down', 480, 'power', 50)],
  },
  {
    id: 'vo2-5x3', name: 'VO2 max 5\u00d73', category: 'Basics',
    description: 'Five 3 minute VO2 efforts with equal recovery.',
    intervals: [iv('Warm up', 600, 'power', 60), ...repeatIv(5, () => [iv('VO2 max', 180, 'power', 115), iv('Recovery', 180, 'power', 55)]), iv('Cool down', 480, 'power', 50)],
  },
  {
    id: 'tabata-torch', name: 'Tabata torch', category: 'Basics',
    description: 'Eight all-out 20 second bursts with short rests.',
    intervals: [iv('Warm up', 480, 'power', 60), ...repeatIv(8, () => [iv('Sprint', 20, 'rpe', 10), iv('Rest', 10, 'power', 40)]), iv('Cool down', 480, 'power', 50)],
  },
  {
    id: 'over-unders', name: 'Over-unders 4\u00d74', category: 'Basics',
    description: 'Alternating above and below threshold to teach pacing.',
    intervals: [iv('Warm up', 600, 'power', 60), ...repeatIv(4, () => [iv('Over', 120, 'power', 105), iv('Under', 120, 'power', 90)]), iv('Cool down', 480, 'power', 50)],
  },
  {
    id: 'rpe-fartlek', name: 'RPE fartlek', category: 'Basics',
    description: 'No power meter needed \u2014 ride by feel.',
    intervals: [iv('Easy spin', 300, 'rpe', 3), iv('Build', 180, 'rpe', 6), iv('Push', 120, 'rpe', 8), iv('Recover', 120, 'rpe', 2), iv('Hard', 240, 'rpe', 7), iv('Sprint', 60, 'rpe', 9), iv('Easy', 300, 'rpe', 3), iv('Cool down', 300, 'rpe', 2)],
  },
  {
    id: 'recovery-spin', name: 'Recovery spin', category: 'Basics',
    description: 'Light and easy \u2014 flush the legs, nothing more.',
    intervals: [iv('Keep it light', 1800, 'power', 50)],
  },
  {
    id: 'pyramid-power', name: 'Pyramid power', category: 'Basics',
    description: 'Step up through the zones, then step back down.',
    intervals: [iv('Warm up', 300, 'power', 55), iv('Step 1', 180, 'power', 60), iv('Step 2', 180, 'power', 70), iv('Step 3', 180, 'power', 80), iv('Step 4', 180, 'power', 90), iv('Peak', 180, 'power', 100), iv('Step 4', 180, 'power', 90), iv('Step 3', 180, 'power', 80), iv('Step 2', 180, 'power', 70), iv('Step 1', 180, 'power', 60), iv('Cool down', 300, 'power', 50)],
  },
  {
    id: 'mixed-metric', name: 'Mixed metric session', category: 'Basics',
    description: 'Power and RPE targets combined in one workout \u2014 always something to push against.',
    intervals: [iv('Warm up', 480, 'power', 60), iv('Sweet spot', 600, 'power', 90), iv('Ride how you feel', 300, 'rpe', 4), iv('Hard effort', 240, 'rpe', 8), iv('Sprint', 30, 'rpe', 10), iv('Recovery', 90, 'power', 50), iv('Endurance', 600, 'power', 70), iv('Cool down', 360, 'power', 50)],
  },
  {
    id: 'vo2-40-20-double', name: 'VO2 max 40/20 \u00d7 13 (2 sets)', category: 'Basics',
    description: 'Two sets of thirteen short, sharp 40-second VO2 max efforts with 20 seconds off, separated by a proper recovery block.',
    notes: 'A hard, focused VO2 max session. The 40-second efforts should feel like you couldn\u2019t hold them much past a minute \u2014 the 20 seconds off is just enough to keep the legs turning before the next one.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      ...repeatIv(13, () => [iv('On', 40, 'power', 120), iv('Off', 20, 'power', 50)]),
      iv('Between sets recovery', 300, 'power', 55),
      ...repeatIv(13, () => [iv('On', 40, 'power', 120), iv('Off', 20, 'power', 50)]),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  // ---------- Rides: long, mixed-terrain, real-world-feel sessions (90 min\u20135 hr) ----------
  {
    id: 'ride-sunday-club', name: 'Sunday Club Run', category: 'Rides',
    description: 'A social group ride with regroups, a village climb, a coffee stop and a cheeky sprint for the sign.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Neutral rollout', 600, 'power', 60),
      ...repeatIv(5, () => [iv('Regroup', 300, 'power', 60), iv('Surge', 120, 'power', 95)]),
      iv('Village climb', 480, 'power', 85),
      iv('Descent', 240, 'power', 50),
      iv('Coffee stop', 300, 'power', 45),
      ...repeatIv(4, () => [iv('Chaingang pull', 120, 'power', 88), iv('Drift back', 90, 'power', 65)]),
      iv('Sprint for the sign', 45, 'rpe', 10),
      iv('Easy spin', 300, 'power', 58),
      iv('Cool down', 480, 'power', 50),
    ],
  },
  {
    id: 'ride-chaingang', name: 'Chaingang Special', category: 'Rides',
    description: 'Fast, tight rotating pacelines with no let-up \u2014 take your turn on the front and hang on in the line.',
    intervals: [
      iv('Warm up', 480, 'power', 55),
      iv('Build', 300, 'power', 70),
      ...repeatIv(8, () => [iv('On the front', 90, 'power', 105), iv('Recover in line', 60, 'power', 65)]),
      iv('Attack surge', 60, 'rpe', 9),
      iv('Regroup', 120, 'power', 58),
      ...repeatIv(6, () => [iv('On the front', 75, 'power', 108), iv('Recover in line', 60, 'power', 65)]),
      ...repeatIv(6, () => [iv('On the front', 90, 'power', 106), iv('Recover in line', 60, 'power', 65)]),
      iv('Group tempo', 360, 'power', 80),
      iv('Reform', 180, 'power', 75),
      iv('Hard final lap', 300, 'power', 100),
      iv('Sprint', 30, 'rpe', 10),
      iv('Cool down', 660, 'power', 50),
    ],
  },
  {
    id: 'ride-century-sim', name: 'Century Simulation', category: 'Rides',
    description: 'The full arc of a 100-mile day \u2014 long steady miles, two rest stops, a headwind slog and a final climb before home.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Settle in', 2400, 'power', 68),
      iv('Rest stop', 480, 'power', 45),
      ...repeatIv(6, () => [iv('Roll up', 240, 'power', 78), iv('Roll down', 180, 'power', 62)]),
      iv('Endurance cruise', 2100, 'power', 70),
      iv('Rest stop', 480, 'power', 45),
      iv('Headwind grind', 1200, 'power', 75),
      iv('Tailwind recovery', 600, 'power', 58),
      iv('Steady tempo', 1500, 'power', 80),
      iv('Final climb', 720, 'power', 88),
      iv('Descent', 360, 'power', 50),
      iv('Sprint for the town sign', 30, 'rpe', 9),
      iv('Home stretch', 1200, 'power', 68),
      iv('Cool down', 750, 'power', 50),
    ],
  },
  {
    id: 'ride-coastal-rollers', name: 'Coastal Rollers', category: 'Rides',
    description: 'A rolling coast road, a stiff headwind stretch, a sprint into a beach town, and a cliff climb to finish.',
    intervals: [
      iv('Warm up', 600, 'power', 56),
      ...repeatIv(8, () => [iv('Roll up', 210, 'power', 82), iv('Roll down', 150, 'power', 60)]),
      iv('Headwind coastal stretch', 900, 'power', 78),
      iv('Tailwind push', 480, 'power', 62),
      iv('Beach town sprint', 30, 'rpe', 9),
      iv('Easy coastal cruise', 1200, 'power', 65),
      ...repeatIv(6, () => [iv('Roll up', 180, 'power', 85), iv('Roll down', 120, 'power', 58)]),
      iv('Cliff climb', 600, 'power', 90),
      iv('Descent', 360, 'power', 50),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-alpine-ascent', name: 'Alpine Ascent', category: 'Rides',
    description: 'One long mountain up-and-over \u2014 valley approach, switchback surges, a sweet spot mid-section, hairpin kicks and a summit push.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1800, 'power', 68),
      iv('Lower slopes', 1200, 'power', 80),
      ...repeatIv(6, () => [iv('Switchback surge', 120, 'power', 100), iv('Steady climb', 180, 'power', 85)]),
      iv('Mid climb sweet spot', 1200, 'power', 90),
      ...repeatIv(4, () => [iv('Hairpin surge', 90, 'power', 105), iv('Recover', 120, 'power', 75)]),
      iv('Summit push', 600, 'power', 98),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Descent', 1500, 'power', 50),
      iv('Valley cool cruise', 1200, 'power', 65),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-gravel-grinder', name: 'Gravel Grinder', category: 'Rides',
    description: 'Fire roads, punchy climbs, a sandy sector, doubletrack rollers and a long grind to the finish gate.',
    intervals: [
      iv('Warm up', 600, 'power', 56),
      iv('Fire road endurance', 1800, 'power', 68),
      ...repeatIv(5, () => [iv('Punchy climb', 120, 'power', 95), iv('Recover', 120, 'power', 62)]),
      iv('Sandy sector', 480, 'power', 62),
      iv('Gravel grind tempo', 1500, 'power', 82),
      iv('Creek crossing', 180, 'power', 55),
      ...repeatIv(6, () => [iv('Doubletrack up', 180, 'power', 85), iv('Doubletrack down', 120, 'power', 60)]),
      iv('Long grind sweet spot', 1500, 'power', 90),
      iv('Singletrack', 900, 'rpe', 6),
      iv('Recovery spin', 900, 'power', 62),
      iv('Final gravel climb', 600, 'power', 95),
      iv('Descent', 480, 'power', 50),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-crosswind-echelon', name: 'Crosswind Echelon', category: 'Rides',
    description: 'A gusty exposed road \u2014 rotate through the echelon, hold the wheel, and don\u2019t get gapped when it splits.',
    intervals: [
      iv('Warm up', 600, 'power', 56),
      iv('Build', 480, 'power', 70),
      ...repeatIv(8, () => [iv('Front in the wind', 90, 'power', 100), iv('Sheltered', 90, 'power', 68)]),
      iv('Regroup', 300, 'power', 58),
      ...repeatIv(6, () => [iv('Front in the wind', 90, 'power', 103), iv('Sheltered', 90, 'power', 68)]),
      iv('Crosswind straight', 900, 'power', 85),
      iv('Gap chase', 180, 'power', 105),
      iv('Recover', 240, 'power', 65),
      ...repeatIv(5, () => [iv('Front in the wind', 75, 'power', 100), iv('Sheltered', 75, 'power', 68)]),
      iv('Sprint', 30, 'rpe', 10),
      iv('Cool down', 540, 'power', 50),
    ],
  },
  {
    id: 'ride-breakaway-glory', name: 'Breakaway to Glory', category: 'Rides',
    description: 'You go off the front and try to make it stick \u2014 the drama of an escape, a chase, a counter, and a photo finish.',
    intervals: [
      iv('Warm up', 600, 'power', 56),
      iv('Group tempo', 900, 'power', 78),
      iv('The attack goes', 120, 'power', 110),
      iv('Solo effort', 900, 'power', 92),
      ...repeatIv(4, () => [iv('Chase pressure surge', 90, 'power', 105), iv('Steady', 120, 'power', 88)]),
      iv('Solo grind', 900, 'power', 98),
      iv('Dig deep', 300, 'power', 112),
      iv('Caught \u2014 recover', 360, 'power', 60),
      iv('Regroup tempo', 600, 'power', 78),
      iv('Counter attack', 90, 'power', 115),
      iv('Solo again', 900, 'power', 95),
      iv('Final sprint for the line', 30, 'rpe', 10),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-audax-200', name: 'Audax 200 Pace', category: 'Rides',
    description: 'Ultra-distance brevet pacing \u2014 patient, metronomic, with two control-point stops. Nothing flashy, just steady miles.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Long steady endurance', 4200, 'power', 65),
      iv('Control point', 600, 'power', 45),
      iv('Steady endurance', 3300, 'power', 66),
      ...repeatIv(8, () => [iv('Roll up', 240, 'power', 75), iv('Roll down', 180, 'power', 60)]),
      iv('Control point', 600, 'power', 45),
      iv('Steady endurance', 2400, 'power', 65),
      iv('Headwind grind', 1200, 'power', 72),
      iv('Final steady push', 1200, 'power', 68),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-crit-sim', name: 'Criterium Simulation', category: 'Rides',
    description: 'Short, sharp, and relentless \u2014 hard accelerations out of every corner with barely a moment to recover.',
    intervals: [
      iv('Warm up', 600, 'power', 60),
      iv('Neutral lap', 180, 'power', 65),
      iv('Race start surge', 60, 'power', 110),
      ...repeatIv(10, () => [iv('Accel out of the corner', 30, 'power', 115), iv('Straight recover', 60, 'power', 72)]),
      iv('Race pace tempo', 1200, 'power', 85),
      iv('Mid-race attack', 60, 'power', 112),
      iv('Chase', 180, 'power', 95),
      ...repeatIv(8, () => [iv('Accel out of the corner', 30, 'power', 116), iv('Straight recover', 60, 'power', 72)]),
      ...repeatIv(8, () => [iv('Accel out of the corner', 30, 'power', 118), iv('Straight recover', 60, 'power', 72)]),
      iv('Bell lap surge', 120, 'power', 105),
      iv('Sprint finish', 30, 'rpe', 10),
      iv('Cool down', 630, 'power', 50),
    ],
  },
  {
    id: 'ride-cafe-ride', name: 'Café Ride', category: 'Rides',
    description: 'Easy chat pace, a proper coffee stop, one climb to keep everyone honest, and a fun sprint for the town sign.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Chatty pace', 1200, 'power', 58),
      iv('Easy endurance', 1500, 'power', 62),
      iv('Regroup climb', 300, 'power', 78),
      iv('Café stop', 900, 'power', 45),
      iv('Easy spin home', 1200, 'power', 60),
      iv('Playful sprint for fun', 30, 'rpe', 9),
      ...repeatIv(4, () => [iv('Roll up', 120, 'power', 75), iv('Roll down', 120, 'power', 58)]),
      iv('Cool down', 480, 'power', 50),
    ],
  },
  {
    id: 'ride-cobbled-classics', name: 'Cobbled Classics', category: 'Rides',
    description: 'A brutal spring-classics profile \u2014 three escalating pav\u00e9 sectors, a cobbled climb, and a solo dash to the velodrome.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Approach tempo', 1200, 'power', 78),
      ...repeatIv(6, () => [iv('Pav\u00e9 push', 90, 'power', 100), iv('Smooth recover', 60, 'power', 70)]),
      iv('Regroup', 300, 'power', 58),
      ...repeatIv(8, () => [iv('Pav\u00e9 push', 120, 'power', 102), iv('Smooth recover', 90, 'power', 70)]),
      iv('Cobbled climb', 360, 'power', 95),
      iv('Descent', 480, 'power', 50),
      ...repeatIv(10, () => [iv('Pav\u00e9 push', 60, 'power', 105), iv('Smooth recover', 60, 'power', 68)]),
      iv('Chase group tempo', 1200, 'power', 85),
      ...repeatIv(6, () => [iv('Pav\u00e9 push', 90, 'power', 103), iv('Smooth recover', 60, 'power', 70)]),
      iv('Solo finish', 600, 'power', 98),
      iv('Sprint at the velodrome', 30, 'rpe', 10),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-group-surges', name: 'Group Ride Surges', category: 'Rides',
    description: 'Someone in the group keeps attacking for fun \u2014 repeated surges you have to cover, then settle, then cover again.',
    intervals: [
      iv('Warm up', 600, 'power', 56),
      iv('Neutral', 600, 'power', 62),
      ...repeatIv(6, () => [iv('Surge from the group', 120, 'power', 100), iv('Settle back', 180, 'power', 70)]),
      iv('Regroup climb', 360, 'power', 85),
      iv('Descent', 300, 'power', 50),
      ...repeatIv(5, () => [iv('Surge from the group', 120, 'power', 102), iv('Settle back', 180, 'power', 70)]),
      iv('Sprint for the county line', 30, 'rpe', 10),
      iv('Easy spin', 480, 'power', 60),
      iv('Cool down', 330, 'power', 50),
    ],
  },
  {
    id: 'ride-hilly-fondo', name: 'Hilly Gran Fondo', category: 'Rides',
    description: 'Three categorized climbs of increasing size, with rolling valley roads and feed zones stitched between them.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Approach endurance', 1800, 'power', 68),
      iv('Climb 1 \u2014 Cat 3', 900, 'power', 90),
      iv('Summit surge', 60, 'power', 105),
      iv('Descent', 600, 'power', 50),
      ...repeatIv(6, () => [iv('Roll up', 180, 'power', 78), iv('Roll down', 120, 'power', 60)]),
      ...repeatIv(4, () => [iv('Climb 2 surge', 60, 'power', 108), iv('Climb 2 steady', 180, 'power', 88)]),
      iv('Descent', 720, 'power', 50),
      iv('Feed zone', 480, 'power', 45),
      iv('Endurance cruise', 1500, 'power', 68),
      iv('Climb 3 \u2014 the big one', 1500, 'power', 88),
      iv('Summit push', 180, 'power', 102),
      iv('Descent', 900, 'power', 50),
      ...repeatIv(5, () => [iv('Roll up', 120, 'power', 80), iv('Roll down', 120, 'power', 62)]),
      iv('Sprint for the line', 30, 'rpe', 10),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-tt-tuneup', name: 'Flat TT Tune-Up', category: 'Rides',
    description: 'A long ride built around three time-trial efforts, with generous recovery spins between each one.',
    intervals: [
      iv('Warm up', 600, 'power', 58),
      iv('Endurance', 1200, 'power', 68),
      iv('TT effort 1', 600, 'power', 100),
      iv('Recovery spin', 480, 'power', 62),
      iv('TT effort 2', 600, 'power', 102),
      iv('Recovery spin', 480, 'power', 62),
      iv('TT effort 3', 300, 'power', 106),
      iv('Recovery', 600, 'power', 65),
      iv('Endurance cruise', 1800, 'power', 70),
      iv('Group tempo', 900, 'power', 82),
      iv('Sprint', 30, 'rpe', 10),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-rainy-survival', name: 'Rainy Day Survival', category: 'Rides',
    description: 'Grim conditions, careful pacing, occasional puddle-dodging surges, and a hard push in the final stretch to get home and dry.',
    intervals: [
      iv('Warm up', 480, 'power', 55),
      iv('Steady grind', 1800, 'power', 70),
      ...repeatIv(4, () => [iv('Puddle dodge surge', 60, 'power', 92), iv('Steady', 120, 'power', 68)]),
      iv('Steady endurance', 1200, 'power', 68),
      iv('Push to get home', 600, 'power', 85),
      iv('Sprint to shelter', 30, 'rpe', 9),
      iv('Cool down', 570, 'power', 50),
    ],
  },
  {
    id: 'ride-night-steady', name: 'Night Ride Steady', category: 'Rides',
    description: 'Smooth, consistent effort under headlights \u2014 a careful climb, a cautious descent, and a small group keeping each other honest.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Smooth steady endurance', 2400, 'power', 68),
      iv('Careful climb', 900, 'power', 78),
      iv('Descent', 600, 'power', 50),
      iv('Steady cruise', 1800, 'power', 68),
      ...repeatIv(4, () => [iv('Small group surge', 90, 'power', 92), iv('Steady', 120, 'power', 68)]),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-everesting-lite', name: 'Everesting Lite', category: 'Rides',
    description: 'Same hill, again and again \u2014 twelve reps of climb-and-descend with a feed stop halfway through.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      ...repeatIv(8, () => [iv('Climb the hill', 480, 'power', 92), iv('Descend and recover', 240, 'power', 60)]),
      iv('Feed stop', 600, 'power', 45),
      ...repeatIv(4, () => [iv('Climb the hill', 480, 'power', 95), iv('Descend and recover', 240, 'power', 60)]),
      iv('Endurance cruise', 1200, 'power', 68),
      iv('Final climb push', 600, 'power', 100),
      iv('Descent', 480, 'power', 50),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-breakaway-stage', name: 'Breakaway Stage Day', category: 'Rides',
    description: 'A full stage-race narrative \u2014 an early move that holds most of the day, a crosswind scare, and a bunch gallop at the line.',
    intervals: [
      iv('Warm up', 720, 'power', 56),
      iv('Neutral rollout', 480, 'power', 62),
      iv('Settle endurance', 1500, 'power', 68),
      iv('The attack goes', 120, 'power', 112),
      iv('Solo effort', 1500, 'power', 90),
      iv('Gap holds', 1800, 'power', 85),
      ...repeatIv(5, () => [iv('Chase pressure surge', 90, 'power', 105), iv('Steady', 150, 'power', 88)]),
      iv('Solo threshold grind', 1200, 'power', 98),
      iv('Crosswind chaos', 600, 'power', 68),
      iv('Caught by the peloton', 480, 'power', 70),
      iv('Bunch endurance', 900, 'power', 70),
      iv('Lead-out tempo', 600, 'power', 88),
      iv('Final sprint', 30, 'rpe', 10),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-monument-classics', name: 'Spring Classics Monument', category: 'Rides',
    description: 'The hardest one-day race on the calendar \u2014 three escalating pav\u00e9 sectors, a run of steep bergs, and a selection made in the final hour.',
    intervals: [
      iv('Warm up', 900, 'power', 55),
      iv('Approach endurance', 2400, 'power', 68),
      iv('Early break tempo', 1200, 'power', 80),
      ...repeatIv(6, () => [iv('Pav\u00e9 push', 90, 'power', 100), iv('Recover', 60, 'power', 70)]),
      ...repeatIv(6, () => [iv('Roll up', 180, 'power', 80), iv('Roll down', 120, 'power', 60)]),
      iv('Feed zone', 480, 'power', 45),
      ...repeatIv(8, () => [iv('Pav\u00e9 push', 120, 'power', 103), iv('Recover', 90, 'power', 70)]),
      ...repeatIv(5, () => [iv('Berg climb', 90, 'power', 108), iv('Descend', 60, 'power', 62)]),
      iv('Endurance regroup', 1500, 'power', 68),
      ...repeatIv(8, () => [iv('Pav\u00e9 push', 120, 'power', 105), iv('Recover', 90, 'power', 70)]),
      iv('Selection made \u2014 threshold grind', 1200, 'power', 98),
      iv('Chase group tempo', 900, 'power', 85),
      iv('Final berg climb', 300, 'power', 105),
      iv('Sprint finish', 30, 'rpe', 10),
      iv('Cool down', 900, 'power', 50),
    ],
  },
  {
    id: 'ride-bikepacking-haul', name: 'Bikepacking Long Haul', category: 'Rides',
    description: 'A loaded, all-day ultra-distance ride \u2014 lower power to account for the gear, gravel sections, and two proper rest stops.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Loaded steady endurance', 3600, 'power', 62),
      iv('Gravel section endurance', 2400, 'power', 65),
      iv('Climb with gear', 900, 'power', 78),
      iv('Descent \u2014 careful', 600, 'power', 48),
      iv('Rest stop', 900, 'power', 45),
      iv('Steady endurance', 3000, 'power', 63),
      iv('Headwind grind', 1500, 'power', 70),
      iv('Rest stop', 600, 'power', 45),
      iv('Steady endurance', 2400, 'power', 64),
      iv('Final push \u2014 tired legs', 900, 'power', 72),
      iv('Cool down', 780, 'power', 50),
    ],
  },
  {
    id: 'ride-mountain-double', name: 'Mountain Pass Double', category: 'Rides',
    description: 'Two big climbs in one day, with a valley recovery between them and a long cruise home after the second descent.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 2100, 'power', 68),
      iv('Climb 1', 1500, 'power', 90),
      iv('Summit 1 surge', 60, 'power', 105),
      iv('Descent 1', 900, 'power', 50),
      iv('Valley recovery', 900, 'power', 65),
      iv('Climb 2', 1800, 'power', 91),
      ...repeatIv(4, () => [iv('Steep pitch surge', 90, 'power', 108), iv('Steady', 150, 'power', 86)]),
      iv('Summit 2 push', 300, 'power', 100),
      iv('Descent 2', 1200, 'power', 50),
      iv('Valley cruise home', 2100, 'power', 68),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-urban-commute', name: 'Urban Commute Intervals', category: 'Rides',
    description: 'Stop-and-go city riding \u2014 sprints away from every light, a bridge climb, and a park path to catch your breath.',
    intervals: [
      iv('Warm up', 480, 'power', 58),
      ...repeatIv(10, () => [iv('Sprint from the light', 30, 'power', 110), iv('Coast to the next light', 60, 'power', 48)]),
      iv('Bike lane tempo', 600, 'power', 82),
      ...repeatIv(10, () => [iv('Sprint from the light', 30, 'power', 112), iv('Coast to the next light', 60, 'power', 48)]),
      iv('Park path endurance', 900, 'power', 68),
      iv('Steep bridge climb', 180, 'power', 95),
      iv('Descent', 180, 'power', 50),
      ...repeatIv(8, () => [iv('Sprint from the light', 30, 'power', 115), iv('Coast to the next light', 60, 'power', 48)]),
      iv('Home stretch tempo', 480, 'power', 85),
      iv('Cool down', 510, 'power', 50),
    ],
  },
  {
    id: 'ride-recovery-cruise', name: 'Recovery Century Cruise', category: 'Rides',
    description: 'A very long day at a very easy pace \u2014 all endurance, one café stop, and nothing that will trouble your legs.',
    intervals: [
      iv('Warm up', 600, 'power', 52),
      iv('All easy endurance', 3600, 'power', 62),
      iv('Café stop', 900, 'power', 45),
      iv('Easy endurance', 3600, 'power', 62),
      ...repeatIv(4, () => [iv('Gentle roll up', 120, 'power', 68), iv('Gentle roll down', 120, 'power', 58)]),
      iv('Easy spin home', 900, 'power', 60),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-leadout-day', name: 'Sprinter\u2019s Lead-Out Day', category: 'Rides',
    description: 'Mostly easy miles broken up by repeated lead-out-and-sprint efforts \u2014 practice for the final 200 meters.',
    intervals: [
      iv('Warm up', 600, 'power', 58),
      iv('Endurance', 1500, 'power', 68),
      ...repeatIv(6, () => [iv('Lead-out effort', 60, 'power', 105), iv('Full sprint', 20, 'rpe', 10), iv('Recover', 150, 'power', 62)]),
      iv('Endurance cruise', 1800, 'power', 68),
      ...repeatIv(5, () => [iv('Lead-out effort', 60, 'power', 108), iv('Full sprint', 20, 'rpe', 10), iv('Recover', 150, 'power', 62)]),
      iv('Group tempo', 1200, 'power', 82),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-ridge-traverse', name: 'Ridge Traverse', category: 'Rides',
    description: 'A high, exposed ridge road \u2014 rolling punchy climbs, buffeting crosswind straights, and views for miles the whole way along.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Approach climb to the ridge', 1200, 'power', 82),
      iv('Ridge crosswind straight', 900, 'power', 78),
      ...repeatIv(6, () => [iv('Punchy ridge climb', 180, 'power', 98), iv('Short descent', 120, 'power', 62)]),
      iv('Exposed gap surge', 180, 'power', 105),
      iv('Steady ridge cruise', 1200, 'power', 72),
      ...repeatIv(5, () => [iv('Punchy ridge climb', 150, 'power', 100), iv('Short descent', 120, 'power', 62)]),
      iv('Final ridge push', 600, 'power', 90),
      iv('Long descent off the ridge', 900, 'power', 55),
      iv('Valley cruise home', 900, 'power', 65),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-volcano-rim', name: 'Volcano Rim Loop', category: 'Rides',
    description: 'Climb to the caldera rim, cruise the crater in thin air, punch over the final lip, then unwind down a long switchback descent.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Lower slopes', 2400, 'power', 70),
      iv('Climb to the rim', 1800, 'power', 90),
      ...repeatIv(4, () => [iv('Rim surge', 90, 'power', 105), iv('Rim steady', 180, 'power', 85)]),
      iv('Rim cruise', 1200, 'power', 75),
      iv('Crater lip push', 480, 'power', 98),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Long switchback descent', 1200, 'power', 55),
      iv('Foothills cruise', 2400, 'power', 66),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-desert-crossing', name: 'Desert Crossing', category: 'Rides',
    description: 'Flat, hot and relentless \u2014 long steady grinding across open desert with a stiff headwind fight and a race to town before dark.',
    intervals: [
      iv('Warm up', 600, 'power', 56),
      iv('Early steady tempo', 2400, 'power', 78),
      iv('Heat building endurance', 1800, 'power', 68),
      iv('Headwind grind', 1500, 'power', 76),
      iv('Shade break easy spin', 600, 'power', 52),
      iv('Long steady grind', 2400, 'power', 75),
      ...repeatIv(6, () => [iv('Mirage roller up', 120, 'power', 85), iv('Mirage roller down', 120, 'power', 62)]),
      iv('Race the sunset', 1200, 'power', 82),
      iv('Final push into town', 600, 'power', 90),
      iv('Sprint for the town limit', 30, 'rpe', 9),
      iv('Cool down', 630, 'power', 50),
    ],
  },
  {
    id: 'ride-fjord-switchbacks', name: 'Fjord Switchbacks', category: 'Rides',
    description: 'Relentless steep drops into fjords and brutal switchback climbs back out, again and again \u2014 the answer to a flat ride.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Approach', 900, 'power', 68),
      ...repeatIv(6, () => [iv('Steep drop into the fjord', 180, 'power', 60), iv('Switchback climb out', 360, 'power', 92)]),
      iv('Fjord-side flat cruise', 900, 'power', 70),
      ...repeatIv(4, () => [iv('Steep drop into the fjord', 180, 'power', 58), iv('Switchback climb out', 420, 'power', 95)]),
      iv('Final climb out surge', 180, 'power', 105),
      iv('Summit ridge cruise', 900, 'power', 72),
      iv('Long descent home', 720, 'power', 55),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-highland-loop', name: 'Highland Loop', category: 'Rides',
    description: 'Rolling glens, a driving crosswind along the loch, a squall to punch through, and one huge climb to close the loop.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      ...repeatIv(6, () => [iv('Glen roll up', 180, 'power', 78), iv('Glen roll down', 120, 'power', 62)]),
      iv('Loch crosswind straight', 1200, 'power', 80),
      ...repeatIv(4, () => [iv('Squall surge', 90, 'power', 100), iv('Steady through the rain', 150, 'power', 75)]),
      iv('Steady glen cruise', 1500, 'power', 68),
      iv('Approach the big climb', 900, 'power', 75),
      iv('Big climb \u2014 the pass', 1500, 'power', 90),
      iv('Summit surge', 60, 'power', 108),
      iv('Long descent', 1080, 'power', 55),
      iv('Loch road home', 1200, 'power', 68),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-dolomites-double', name: 'Dolomites Double', category: 'Rides',
    description: 'Two legendary mountain passes back to back \u2014 hairpins, steep ramps and thin air, twice over.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1500, 'power', 68),
      iv('Pass 1 lower slopes', 900, 'power', 80),
      ...repeatIv(5, () => [iv('Pass 1 hairpin surge', 90, 'power', 105), iv('Pass 1 steady', 180, 'power', 88)]),
      iv('Pass 1 summit push', 480, 'power', 98),
      iv('Summit 1 sprint', 30, 'rpe', 10),
      iv('Descent 1', 1200, 'power', 55),
      iv('Valley recovery', 900, 'power', 65),
      iv('Pass 2 lower slopes', 1200, 'power', 82),
      ...repeatIv(6, () => [iv('Pass 2 hairpin surge', 90, 'power', 107), iv('Pass 2 steady', 180, 'power', 89)]),
      iv('Pass 2 summit push', 600, 'power', 100),
      iv('Summit 2 sprint', 30, 'rpe', 10),
      iv('Descent 2', 1320, 'power', 55),
      iv('Valley cruise home', 1500, 'power', 68),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-wine-country', name: 'Wine Country Rollers', category: 'Rides',
    description: 'Gentle-looking vineyard rollers that never actually let up, strung between small hilltop villages.',
    intervals: [
      iv('Warm up', 600, 'power', 56),
      ...repeatIv(10, () => [iv('Vineyard roll up', 150, 'power', 80), iv('Vineyard roll down', 120, 'power', 62)]),
      iv('Hilltop village push', 240, 'power', 85),
      iv('Steady lane cruise', 1200, 'power', 68),
      ...repeatIv(6, () => [iv('Vineyard roll up', 120, 'power', 82), iv('Vineyard roll down', 90, 'power', 62)]),
      iv('Second steady cruise', 600, 'power', 70),
      iv('Final village climb', 360, 'power', 90),
      iv('Sprint for the piazza', 30, 'rpe', 9),
      iv('Easy lane spin', 900, 'power', 60),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-moorland-crossing', name: 'Moorland Crossing', category: 'Rides',
    description: 'Exposed, boggy and utterly alone \u2014 a driving headwind across open moorland with rough gravel sections underfoot.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Moor road endurance', 1500, 'power', 68),
      iv('Headwind grind', 1200, 'power', 78),
      iv('Boggy gravel sector', 900, 'power', 72),
      iv('Steady push', 1200, 'power', 75),
      ...repeatIv(5, () => [iv('Gust surge', 90, 'power', 100), iv('Steady into the wind', 150, 'power', 72)]),
      iv('Rough track climb', 480, 'power', 85),
      iv('Descent off the moor', 600, 'power', 55),
      iv('Steady road cruise', 1200, 'power', 68),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-canyon-rim', name: 'Canyon Rim Ride', category: 'Rides',
    description: 'Technical rim-road riding \u2014 sudden drops into side canyons and sharp climbs back out, over and over, with sheer exposure throughout.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Rim approach', 1200, 'power', 70),
      ...repeatIv(6, () => [iv('Drop into the canyon', 120, 'power', 58), iv('Climb back out', 240, 'power', 95)]),
      iv('Rim cruise', 1200, 'power', 75),
      ...repeatIv(5, () => [iv('Drop into the canyon', 120, 'power', 58), iv('Climb back out', 300, 'power', 97)]),
      iv('Overlook push', 480, 'power', 100),
      iv('Overlook sprint', 30, 'rpe', 10),
      iv('Long rim descent', 900, 'power', 55),
      iv('Trailhead cruise', 1200, 'power', 68),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-alpine-col-chain', name: 'Alpine Col Chain', category: 'Rides',
    description: 'Four cols in one day \u2014 none of them huge alone, but the fatigue stacks fast by the fourth.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Approach', 1800, 'power', 68),
      iv('Col 1 climb', 900, 'power', 88),
      iv('Col 1 descent', 600, 'power', 55),
      iv('Col 2 climb', 1080, 'power', 89),
      iv('Col 2 descent', 720, 'power', 55),
      iv('Valley connector', 900, 'power', 68),
      iv('Col 3 climb', 1200, 'power', 90),
      iv('Col 3 descent', 780, 'power', 55),
      iv('Col 4 climb \u2014 legs are gone', 1320, 'power', 86),
      iv('Col 4 summit surge', 60, 'power', 102),
      iv('Final descent', 1080, 'power', 55),
      iv('Valley cruise home', 1800, 'power', 68),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-anti-gravity', name: 'Anti-Gravity Day', category: 'Rides',
    description: 'The mountain owes you nothing \u2014 every fast, easy drop has to be paid back with a harder climb straight after. The debt keeps compounding.',
    notes: 'A playful inversion of a hill-repeat session: descents are quick and light, but each one is followed by a "debt climb" that\u2019s a notch harder than a normal repeat would be. By the end your legs will disagree that gravity was ever on your side.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      ...repeatIv(12, () => [iv('Fast controlled descent', 180, 'power', 58), iv('Debt climb', 360, 'power', 94)]),
      iv('Halfway ledger check', 480, 'power', 60),
      ...repeatIv(6, () => [iv('Fast controlled descent', 180, 'power', 60), iv('Debt climb', 360, 'power', 96)]),
      iv('Final settlement climb', 600, 'power', 100),
      iv('Victory sprint', 30, 'rpe', 10),
      iv('Long cruise down the mountain', 1200, 'power', 58),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-storm-chase', name: 'Storm Chase', category: 'Rides',
    description: 'A front is building on the horizon and you\u2019re racing it home \u2014 escalating gusts, a mid-ride lightning-strike sprint, and a full-gas dash for shelter.',
    intervals: [
      iv('Warm up', 480, 'power', 56),
      iv('Calm before the storm', 900, 'power', 75),
      iv('Distant thunder', 120, 'power', 95),
      iv('Building tempo \u2014 skies darkening', 900, 'power', 82),
      ...repeatIv(5, () => [iv('Wind gust surge', 90, 'power', 105), iv('Brace and hold', 120, 'power', 80)]),
      iv('Storm closing in', 720, 'power', 90),
      iv('Lightning strike sprint', 30, 'rpe', 10),
      ...repeatIv(4, () => [iv('Squall surge', 60, 'power', 110), iv('Push through', 120, 'power', 85)]),
      iv('Full gas race to shelter', 300, 'power', 105),
      iv('Sprint for the door', 30, 'rpe', 10),
      iv('Sheltered \u2014 catching breath', 480, 'power', 55),
      iv('Cool down', 480, 'power', 50),
    ],
  },
  {
    id: 'ride-tt-through-time', name: 'Time Trial Through Time', category: 'Rides',
    description: 'A ride through the eras of cycling \u2014 heavy steel-bike tempo, smooth aero-bar threshold blocks, and precise modern power-meter intervals.',
    notes: 'Three "eras," three different feels: Era 1 is steady, heavy and mechanical; Era 2 is long and smooth, built for holding an aero position; Era 3 is short, sharp and exactly on target the way a power meter demands.',
    intervals: [
      iv('Warm up', 600, 'power', 58),
      iv('Era 1: the steel age', 2100, 'power', 75),
      ...repeatIv(5, () => [iv('Cobbled test track push', 60, 'power', 98), iv('Recover', 60, 'power', 70)]),
      iv('Transition', 480, 'power', 60),
      iv('Era 2: the aero age \u2014 block 1', 1200, 'power', 98),
      iv('Era 2: the aero age \u2014 block 2', 1200, 'power', 100),
      iv('Transition', 480, 'power', 60),
      ...repeatIv(6, () => [iv('Era 3: on the power meter', 120, 'power', 105), iv('Era 3: recover to target', 60, 'power', 65)]),
      iv('Era 3 finale \u2014 perfectly paced', 600, 'power', 102),
      iv('Modern day sprint', 30, 'rpe', 10),
      iv('Cool down', 630, 'power', 50),
    ],
  },
  {
    id: 'ride-the-gauntlet', name: 'The Gauntlet', category: 'Rides',
    description: 'Five boss climbs, each tougher than the last, a secret boss thrown in for good measure, and one Final Boss standing between you and the victory lap.',
    notes: 'Treat each "boss" like a level \u2014 the checkpoints between them are recovery, not the end of the fight. Save something for the Final Boss.',
    intervals: [
      iv('Warm up', 600, 'power', 56),
      iv('Level 1 boss', 480, 'power', 82),
      iv('Checkpoint', 300, 'power', 60),
      iv('Level 2 boss', 480, 'power', 86),
      iv('Checkpoint', 300, 'power', 62),
      iv('Level 3 boss', 480, 'power', 90),
      iv('Checkpoint', 300, 'power', 62),
      iv('Secret boss', 480, 'power', 88),
      iv('Checkpoint', 300, 'power', 62),
      ...repeatIv(4, () => [iv('Level 4 boss \u2014 attack pattern', 60, 'power', 100), iv('Level 4 boss \u2014 dodge', 90, 'power', 75)]),
      iv('Checkpoint', 360, 'power', 62),
      ...repeatIv(6, () => [iv('Bonus stage surge', 60, 'power', 95), iv('Bonus stage recover', 90, 'power', 65)]),
      ...repeatIv(4, () => [iv('Level 5 boss \u2014 attack pattern', 60, 'power', 106), iv('Level 5 boss \u2014 dodge', 90, 'power', 75)]),
      iv('Checkpoint', 360, 'power', 62),
      iv('FINAL BOSS', 300, 'power', 110),
      iv('Boss defeated sprint', 30, 'rpe', 10),
      iv('Victory lap', 1500, 'power', 62),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-migration-flock', name: 'Migration Ride: Follow the Flock', category: 'Rides',
    description: 'A long ride shaped like a migration \u2014 rising on thermals, rotating through the flock in a crosswind formation, and one long steady wingspan haul before landing.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Rising with the flock', 900, 'power', 82),
      iv('Thermal soaring cruise', 1200, 'power', 70),
      ...repeatIv(6, () => [iv('Flock surge', 120, 'power', 98), iv('Glide and reform', 120, 'power', 66)]),
      iv('Crosswind formation flying', 1200, 'power', 80),
      iv('Long wingspan haul', 2700, 'power', 68),
      iv('Storm front \u2014 push through', 900, 'power', 85),
      ...repeatIv(5, () => [iv('Flock surge', 120, 'power', 100), iv('Glide and reform', 150, 'power', 66)]),
      iv('Descending to roost', 900, 'power', 55),
      iv('Final approach push', 480, 'power', 88),
      iv('Landing sprint', 30, 'rpe', 9),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-ironman-nice', name: 'Ironman Nice', category: 'Rides',
    description: 'The Ironman Nice bike leg \u2014 a flat coastal rollout along the Promenade before the road tips up into the Alpes-Maritimes hinterland, over the Col de Vence, and back down to the sea.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Coastal rollout \u2014 Promenade des Anglais', 1500, 'power', 62),
      iv('Approach into the hills', 1200, 'power', 74),
      iv('Col de Vence lower slopes', 900, 'power', 85),
      ...repeatIv(5, () => [iv('Col de Vence switchback surge', 90, 'power', 104), iv('Steady grind', 150, 'power', 88)]),
      iv('Col de Vence summit push', 300, 'power', 97),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Descent', 900, 'power', 55),
      ...repeatIv(6, () => [iv('Plateau roll up', 150, 'power', 82), iv('Plateau roll down', 120, 'power', 62)]),
      iv('Second climb \u2014 Coursegoules ramp', 720, 'power', 90),
      iv('Summit push 2', 300, 'power', 100),
      iv('Summit sprint 2', 30, 'rpe', 10),
      iv('Long descent back to the coast', 1500, 'power', 55),
      iv('Coastal headwind grind home', 1800, 'power', 78),
      iv('Promenade finish cruise', 900, 'power', 65),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-ironman-kona', name: 'Ironman Kona', category: 'Rides',
    description: 'The Ironman World Championship bike course \u2014 flat lava-field highway out to Hawi, a stiff climb into the crosswind, and a long grinding return with the trade winds full in your face.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Ali\u2019i Drive rollout', 900, 'power', 62),
      iv('Onto the Queen K \u2014 lava field flat', 1500, 'power', 72),
      ...repeatIv(6, () => [iv('Crosswind gust surge', 90, 'power', 98), iv('Steady into the wind', 120, 'power', 72)]),
      iv('Kawaihae flat grind', 1200, 'power', 75),
      iv('Climb to Hawi', 1200, 'power', 88),
      iv('Hawi summit push', 300, 'power', 98),
      iv('Hawi turnaround sprint', 30, 'rpe', 10),
      iv('Fast descent from Hawi', 900, 'power', 55),
      iv('Queen K return \u2014 headwind grind', 2400, 'power', 80),
      ...repeatIv(5, () => [iv('Trade wind gust', 90, 'power', 100), iv('Steady grind', 120, 'power', 75)]),
      iv('Energy Lab out-and-back', 900, 'power', 90),
      iv('Final Queen K push', 1200, 'power', 82),
      iv('Airport road finish cruise', 600, 'power', 65),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-ironman-lanzarote', name: 'Ironman Lanzarote', category: 'Rides',
    description: 'One of triathlon\u2019s hardest bike courses \u2014 volcanic terrain, relentless crosswinds, and the brutal switchback climb up to Fem\u00e9s.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Volcanic flat rollout', 900, 'power', 65),
      ...repeatIv(6, () => [iv('Crosswind gust', 90, 'power', 100), iv('Steady grind into the wind', 120, 'power', 74)]),
      iv('Lava field tempo', 1500, 'power', 80),
      iv('Fem\u00e9s lower slopes', 600, 'power', 85),
      ...repeatIv(5, () => [iv('Fem\u00e9s switchback surge', 90, 'power', 106), iv('Steady climb', 150, 'power', 90)]),
      iv('Fem\u00e9s summit push', 300, 'power', 98),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Exposed plateau descent', 900, 'power', 58),
      ...repeatIv(4, () => [iv('Crosswind gust', 90, 'power', 98), iv('Steady', 120, 'power', 72)]),
      iv('Second climb \u2014 Fire Mountains approach', 900, 'power', 88),
      iv('Long descent to the coast', 1200, 'power', 55),
      iv('Coastal headwind grind home', 1800, 'power', 78),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-pyrenees-circle-of-death', name: 'Pyrenees: Circle of Death', category: 'Rides',
    description: 'The Pyrenees\u2019 legendary trio \u2014 the Tourmalet, the Aspin and the Peyresourde back to back, the combination that gave this stage its nickname.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1200, 'power', 68),
      iv('Tourmalet lower slopes', 900, 'power', 82),
      ...repeatIv(6, () => [iv('Tourmalet hairpin surge', 90, 'power', 106), iv('Steady climb', 180, 'power', 89)]),
      iv('Tourmalet summit push', 480, 'power', 99),
      iv('Summit 1 sprint', 30, 'rpe', 10),
      iv('Descent 1', 900, 'power', 55),
      iv('Valley connector', 720, 'power', 68),
      iv('Aspin climb', 900, 'power', 87),
      iv('Aspin summit surge', 60, 'power', 102),
      iv('Descent 2', 600, 'power', 55),
      iv('Valley connector', 600, 'power', 68),
      iv('Peyresourde lower slopes', 600, 'power', 85),
      ...repeatIv(4, () => [iv('Peyresourde hairpin surge', 90, 'power', 105), iv('Steady climb', 150, 'power', 88)]),
      iv('Peyresourde summit push', 300, 'power', 98),
      iv('Summit 3 sprint', 30, 'rpe', 10),
      iv('Final descent', 900, 'power', 55),
      iv('Valley cruise home', 1200, 'power', 65),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-giro-stelvio', name: 'Giro: Passo dello Stelvio', category: 'Rides',
    description: '48 hairpins to the highest paved pass the Giro visits \u2014 a long, relentless grind above the clouds.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1500, 'power', 68),
      iv('Stelvio lower slopes', 1200, 'power', 80),
      ...repeatIv(8, () => [iv('Hairpin surge', 90, 'power', 102), iv('Steady grind', 180, 'power', 87)]),
      iv('Thinning air \u2014 mid climb', 900, 'power', 88),
      ...repeatIv(6, () => [iv('Hairpin surge', 90, 'power', 104), iv('Steady grind', 180, 'power', 88)]),
      iv('Final ramps to the Cima Coppi', 480, 'power', 97),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Long descent', 1500, 'power', 55),
      iv('Valley cruise home', 1200, 'power', 65),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-giro-zoncolan', name: 'Giro: Monte Zoncolan', category: 'Rides',
    description: 'The Kaiser \u2014 short in distance but savagely steep, with ramps that never let you find a rhythm.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1200, 'power', 68),
      ...repeatIv(5, () => [iv('Foothill roll up', 150, 'power', 78), iv('Foothill roll down', 120, 'power', 60)]),
      iv('Zoncolan lower ramps', 600, 'power', 88),
      ...repeatIv(8, () => [iv('Brutal ramp', 60, 'power', 112), iv('Steady grind', 90, 'power', 92)]),
      iv('Mid-climb false flat', 300, 'power', 85),
      ...repeatIv(6, () => [iv('Brutal ramp', 60, 'power', 115), iv('Steady grind', 90, 'power', 94)]),
      iv('Final wall to the summit', 300, 'power', 105),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Long careful descent', 1200, 'power', 55),
      iv('Valley cruise home', 900, 'power', 65),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-giro-finestre', name: 'Giro: Colle delle Finestre', category: 'Rides',
    description: 'Tarmac gives way to gravel switchbacks near the top of this Giro d\u2019Italia climb \u2014 one of the hardest summit finishes in the sport.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1500, 'power', 68),
      iv('Finestre lower slopes \u2014 tarmac', 1200, 'power', 82),
      ...repeatIv(6, () => [iv('Hairpin surge', 90, 'power', 103), iv('Steady grind', 150, 'power', 87)]),
      iv('Gravel switchbacks begin', 600, 'power', 90),
      ...repeatIv(8, () => [iv('Gravel ramp', 60, 'power', 108), iv('Steady grind', 90, 'power', 88)]),
      iv('Final gravel push to the summit', 300, 'power', 100),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Technical gravel descent', 900, 'power', 58),
      iv('Long tarmac descent', 900, 'power', 55),
      iv('Valley cruise home', 900, 'power', 65),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-tour-ventoux', name: 'Tour: Mont Ventoux', category: 'Rides',
    description: 'The Giant of Provence \u2014 forest switchbacks give way to the exposed, windswept moonscape on the run to the summit.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Approach through B\u00e9doin', 1200, 'power', 68),
      iv('Forest lower slopes', 900, 'power', 85),
      ...repeatIv(6, () => [iv('Forest ramp surge', 90, 'power', 102), iv('Steady grind', 150, 'power', 89)]),
      iv('Chalet Reynard \u2014 treeline', 480, 'power', 90),
      iv('Exposed moonscape', 900, 'power', 96),
      ...repeatIv(4, () => [iv('Wind gust surge', 60, 'power', 108), iv('Steady into the wind', 90, 'power', 92)]),
      iv('Final push to the summit', 300, 'power', 100),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Long descent', 1500, 'power', 55),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-tour-alpe-dhuez', name: 'Tour: Alpe d\u2019Huez', category: 'Rides',
    description: 'Twenty-one hairpin bends, a wall of noise at Dutch Corner, and one of the most famous finishes in cycling.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1200, 'power', 68),
      iv('Lower slopes \u2014 steepest ramps', 600, 'power', 92),
      ...repeatIv(7, () => [iv('Hairpin bend surge', 90, 'power', 106), iv('Steady grind', 150, 'power', 90)]),
      iv('Dutch Corner', 300, 'power', 95),
      ...repeatIv(5, () => [iv('Hairpin bend surge', 90, 'power', 104), iv('Steady grind', 150, 'power', 89)]),
      iv('Final ramp into town', 300, 'power', 100),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Long descent', 1200, 'power', 55),
      iv('Valley cruise home', 900, 'power', 65),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-tour-galibier', name: 'Tour: Col du Galibier', category: 'Rides',
    description: 'The Col du T\u00e9l\u00e9graphe into a short valley breather, then the long, thin-air grind over the Galibier \u2014 one of the highest points the Tour ever visits.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1200, 'power', 68),
      iv('T\u00e9l\u00e9graphe climb', 900, 'power', 86),
      ...repeatIv(4, () => [iv('T\u00e9l\u00e9graphe surge', 90, 'power', 102), iv('Steady climb', 150, 'power', 88)]),
      iv('T\u00e9l\u00e9graphe summit', 60, 'power', 96),
      iv('Descent to Valloire', 480, 'power', 58),
      iv('Valley connector \u2014 feed zone', 480, 'power', 60),
      iv('Galibier lower slopes', 1200, 'power', 84),
      ...repeatIv(6, () => [iv('Galibier surge', 90, 'power', 103), iv('Steady grind', 180, 'power', 87)]),
      iv('Thin air \u2014 final ramps', 600, 'power', 92),
      iv('Summit push', 300, 'power', 99),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Long descent', 1800, 'power', 55),
      iv('Valley cruise home', 1200, 'power', 65),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-paris-roubaix', name: 'Paris\u2013Roubaix: Hell of the North', category: 'Rides',
    description: 'The Arenberg Forest, Mons-en-P\u00e9v\u00e8le and the Carrefour de l\u2019Arbre \u2014 punishing cobbles all the way to the velodrome.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Long approach \u2014 neutral zone tempo', 1800, 'power', 74),
      ...repeatIv(5, () => [iv('Early pav\u00e9 sector', 90, 'power', 96), iv('Smooth recover', 90, 'power', 68)]),
      iv('Group tempo', 900, 'power', 78),
      iv('Trou\u00e9e d\u2019Arenberg', 300, 'power', 102),
      iv('Smooth recover', 300, 'power', 68),
      ...repeatIv(6, () => [iv('Pav\u00e9 sector', 90, 'power', 100), iv('Smooth recover', 90, 'power', 70)]),
      iv('Regroup', 480, 'power', 60),
      iv('Mons-en-P\u00e9v\u00e8le', 480, 'power', 102),
      ...repeatIv(8, () => [iv('Pav\u00e9 sector', 90, 'power', 102), iv('Smooth recover', 90, 'power', 70)]),
      iv('Feed zone', 480, 'power', 45),
      iv('Carrefour de l\u2019Arbre', 480, 'power', 104),
      ...repeatIv(6, () => [iv('Pav\u00e9 sector', 90, 'power', 105), iv('Smooth recover', 90, 'power', 70)]),
      iv('Chase to the velodrome', 1200, 'power', 92),
      iv('Velodrome sprint', 30, 'rpe', 10),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-tour-of-flanders', name: 'Tour of Flanders: Kwaremont & Paterberg', category: 'Rides',
    description: 'The Ronde\u2019s finale on repeat \u2014 the Oude Kwaremont and the brutally steep Paterberg, back to back, again and again.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Long approach \u2014 flat sectors', 2100, 'power', 70),
      ...repeatIv(6, () => [iv('Kasseien roller', 90, 'power', 90), iv('Smooth recover', 90, 'power', 66)]),
      iv('Taaienberg', 180, 'power', 100),
      iv('Steady', 300, 'power', 72),
      iv('Oude Kwaremont 1', 300, 'power', 96),
      iv('Paterberg 1', 120, 'power', 106),
      iv('Steady', 480, 'power', 70),
      iv('Group tempo', 900, 'power', 78),
      iv('Koppenberg', 240, 'power', 106),
      iv('Steady', 480, 'power', 68),
      iv('Oude Kwaremont 2', 300, 'power', 98),
      iv('Paterberg 2', 120, 'power', 108),
      iv('Steady', 480, 'power', 70),
      iv('Valley regroup', 900, 'power', 68),
      iv('Oude Kwaremont 3', 300, 'power', 100),
      iv('Paterberg 3', 120, 'power', 110),
      iv('Steady', 480, 'power', 70),
      iv('Oude Kwaremont 4 \u2014 final time up', 300, 'power', 103),
      iv('Paterberg 4 \u2014 final time up', 120, 'power', 113),
      iv('Sprint to the line in Oudenaarde', 30, 'rpe', 10),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-liege-bastogne-liege', name: 'Li\u00e8ge\u2013Bastogne\u2013Li\u00e8ge', category: 'Rides',
    description: 'La Doyenne \u2014 the oldest and hilliest of the Classics, a long rolling grind through the Ardennes to the uphill finish in Li\u00e8ge.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Long rolling approach', 2400, 'power', 70),
      ...repeatIv(6, () => [iv('Ardennes roller', 150, 'power', 88), iv('Steady', 120, 'power', 66)]),
      iv('C\u00f4te de Wanne', 300, 'power', 92),
      iv('Steady', 600, 'power', 70),
      iv('C\u00f4te de Stockeu', 240, 'power', 100),
      iv('Descent', 480, 'power', 55),
      iv('Rolling valley', 1200, 'power', 68),
      iv('C\u00f4te de la Redoute', 480, 'power', 98),
      iv('Steady', 600, 'power', 70),
      iv('C\u00f4te des Forges', 300, 'power', 92),
      iv('Steady', 480, 'power', 68),
      iv('C\u00f4te de la Roche-aux-Faucons', 420, 'power', 100),
      iv('Chase group tempo', 900, 'power', 82),
      iv('Final uphill drag to the finish', 480, 'power', 96),
      iv('Sprint finish', 30, 'rpe', 10),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-milan-san-remo', name: 'Milan\u2013San Remo: La Classicissima', category: 'Rides',
    description: 'The longest race on the calendar \u2014 hours of flat, controlled tempo before the Cipressa and the Poggio decide it in the final half hour.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Neutral rollout', 600, 'power', 60),
      iv('Long flat cruise', 3600, 'power', 65),
      iv('Long flat cruise', 3600, 'power', 66),
      iv('Coastal tempo picks up', 1800, 'power', 75),
      iv('Cipressa climb', 480, 'power', 92),
      iv('Cipressa descent', 480, 'power', 58),
      iv('Regroup tempo', 900, 'power', 78),
      iv('Poggio climb', 360, 'power', 98),
      iv('Poggio summit attack', 60, 'power', 110),
      iv('Poggio descent \u2014 technical', 300, 'power', 60),
      iv('Sprint into San Remo', 30, 'rpe', 10),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-vuelta-angliru', name: 'Vuelta: Alto de l\u2019Angliru', category: 'Rides',
    description: 'The Vuelta\u2019s most savage climb \u2014 relentless double-digit gradients that spike past 20% near the top, at Cue\u00f1a les Cabres.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1500, 'power', 68),
      iv('Angliru lower slopes', 900, 'power', 85),
      ...repeatIv(6, () => [iv('Steep ramp surge', 90, 'power', 105), iv('Steady grind', 150, 'power', 90)]),
      iv('Mid-climb breather \u2014 false flat', 240, 'power', 82),
      iv('Cue\u00f1a les Cabres \u2014 the wall', 300, 'power', 112),
      ...repeatIv(4, () => [iv('Brutal ramp', 60, 'power', 116), iv('Steady grind', 90, 'power', 95)]),
      iv('Final ramps to the summit', 300, 'power', 105),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Long careful descent', 1500, 'power', 55),
      iv('Valley cruise home', 900, 'power', 65),
      iv('Cool down', 720, 'power', 50),
    ],
  },
];
const CATEGORIES = ['All', 'Rides', 'Basics', 'Recovery', 'Endurance', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Max', 'Anaerobic', 'FTP Test', 'Mixed'];

// ---------- audio ----------
function useBeeper() {
  const ctxRef = useRef(null);
  function ensure() {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctxRef.current = new AC();
    }
    if (ctxRef.current && ctxRef.current.state === 'suspended') ctxRef.current.resume();
    return ctxRef.current;
  }
  function beep(freq, duration, gainVal) {
    const ctx = ensure();
    if (!ctx || gainVal <= 0) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.value = gainVal;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }
  // Plays a short sequence of notes, each with its own delay (ms) from now
  // \u2014 used for the richer finish fanfare and the halfway/final chimes.
  function chime(notes, gainVal) {
    notes.forEach(n => setTimeout(() => beep(n.freq, n.duration, gainVal), n.delay));
  }
  return { beep, chime };
}

// ---------- trainer connectivity (Web Bluetooth FTMS) ----------
function useTrainer() {
  const [status, setStatus] = useState('disconnected');
  const [deviceName, setDeviceName] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [power, setPower] = useState(null);
  const [cadence, setCadence] = useState(null);
  const [hasControl, setHasControl] = useState(false);
  const deviceRef = useRef(null);
  const controlRef = useRef(null);
  const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

  function handleBikeData(event) {
    try {
      const dv = event.target.value;
      const flags = dv.getUint16(0, true);
      let offset = 2;
      let cad = null, pow = null;
      if ((flags & 0x0001) === 0) offset += 2;
      if (flags & 0x0002) offset += 2;
      if (flags & 0x0004) { cad = dv.getUint16(offset, true) / 2; offset += 2; }
      if (flags & 0x0008) offset += 2;
      if (flags & 0x0010) offset += 3;
      if (flags & 0x0020) offset += 2;
      if (flags & 0x0040) { pow = dv.getInt16(offset, true); offset += 2; }
      if (cad !== null) setCadence(Math.round(cad));
      if (pow !== null) setPower(pow);
    } catch (e) {}
  }
  function handleDisconnected() {
    setStatus('disconnected');
    setPower(null);
    setCadence(null);
    setHasControl(false);
  }
  async function connect() {
    if (!supported) { setErrorMsg('Bluetooth is not available in this browser or environment.'); setStatus('error'); return; }
    setStatus('connecting'); setErrorMsg(null);
    try {
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x1826] }], optionalServices: [0x1826] });
      device.addEventListener('gattserverdisconnected', handleDisconnected);
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(0x1826);
      try {
        const bikeChar = await service.getCharacteristic(0x2ad2);
        await bikeChar.startNotifications();
        bikeChar.addEventListener('characteristicvaluechanged', handleBikeData);
      } catch (e) {}
      try {
        const controlChar = await service.getCharacteristic(0x2ad9);
        await controlChar.writeValue(new Uint8Array([0x00]));
        controlRef.current = controlChar;
        setHasControl(true);
      } catch (e) { controlRef.current = null; setHasControl(false); }
      deviceRef.current = device;
      setDeviceName(device.name || 'Trainer');
      setStatus('connected');
    } catch (e) {
      setErrorMsg((e && e.message) ? e.message : 'Could not connect to a trainer.');
      setStatus('error');
    }
  }
  function disconnect() {
    try { deviceRef.current && deviceRef.current.gatt && deviceRef.current.gatt.disconnect(); } catch (e) {}
    setStatus('disconnected'); setDeviceName(null); setPower(null); setCadence(null); setHasControl(false);
  }
  async function setErgTarget(watts) {
    if (!controlRef.current) return;
    try {
      const buf = new ArrayBuffer(3);
      const dv = new DataView(buf);
      dv.setUint8(0, 0x05);
      dv.setInt16(1, Math.round(watts), true);
      await controlRef.current.writeValue(buf);
    } catch (e) {}
  }
  return { supported, status, deviceName, errorMsg, power, cadence, hasControl, connect, disconnect, setErgTarget };
}

// Standard Bluetooth Heart Rate Service (0x180D) / Heart Rate Measurement
// characteristic (0x2A37) \u2014 supported by essentially every BLE chest strap
// and armband (Polar, Wahoo, Garmin, etc.), independent of the trainer.
function useHeartRate() {
  const [status, setStatus] = useState('disconnected');
  const [deviceName, setDeviceName] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [bpm, setBpm] = useState(null);
  const deviceRef = useRef(null);
  const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

  function handleHrData(event) {
    try {
      const dv = event.target.value;
      const flags = dv.getUint8(0);
      const value = (flags & 0x01) ? dv.getUint16(1, true) : dv.getUint8(1);
      setBpm(value);
    } catch (e) {}
  }
  function handleDisconnected() {
    setStatus('disconnected');
    setBpm(null);
  }
  async function connect() {
    if (!supported) { setErrorMsg('Bluetooth is not available in this browser or environment.'); setStatus('error'); return; }
    setStatus('connecting'); setErrorMsg(null);
    try {
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x180d] }], optionalServices: [0x180d] });
      device.addEventListener('gattserverdisconnected', handleDisconnected);
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(0x180d);
      const hrChar = await service.getCharacteristic(0x2a37);
      await hrChar.startNotifications();
      hrChar.addEventListener('characteristicvaluechanged', handleHrData);
      deviceRef.current = device;
      setDeviceName(device.name || 'Heart rate monitor');
      setStatus('connected');
    } catch (e) {
      setErrorMsg((e && e.message) ? e.message : 'Could not connect to a heart rate monitor.');
      setStatus('error');
    }
  }
  function disconnect() {
    try { deviceRef.current && deviceRef.current.gatt && deviceRef.current.gatt.disconnect(); } catch (e) {}
    setStatus('disconnected'); setDeviceName(null); setBpm(null);
  }
  return { supported, status, deviceName, errorMsg, bpm, connect, disconnect };
}

// ---------- profile chart ----------
function ProfileChart({ intervals, height = 84, progress = null }) {
  const total = totalDuration(intervals) || 1;
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', height, width: '100%', background: PANEL2, borderRadius: 8, overflow: 'hidden', border: `1px solid ${LINE}` }}>
      {intervals.map((it) => {
        const z = zoneFor(it);
        const w = (it.duration / total) * 100;
        const h = Math.max(14, Math.min(100, z.intensity * 78));
        const isFree = it.type === 'free';
        return (
          <div key={it.id} style={{ width: `${w}%`, height: '100%', display: 'flex', alignItems: 'flex-end', borderRight: `1px solid ${PANEL2}` }}>
            <div style={{ width: '100%', height: `${h}%`, background: isFree ? `repeating-linear-gradient(135deg, ${z.color}, ${z.color} 4px, ${LINE} 4px, ${LINE} 8px)` : z.color }} />
          </div>
        );
      })}
      {progress !== null && (
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${progress * 100}%`, background: 'rgba(255,255,255,0.14)', borderRight: `2px solid ${TEXT}`, pointerEvents: 'none' }} />
      )}
    </div>
  );
}

// A zoomed-in, time-accurate strip of the workout used by the in-ride
// progress bar. Unlike ProfileChart (which squeezes the whole ride into
// one fixed-width bar), each interval here is sized by its real duration,
// so the strip is wider than the screen and scrolls. It auto-follows the
// current elapsed time, keeping "now" a little left of center so upcoming
// work is visible \u2014 but a touch-drag pauses the auto-follow so the rider
// can look ahead, and it quietly resumes a couple seconds after they let go.
const TIMELINE_PX_PER_SEC = 1.2;    // zoom level: bigger = more zoomed in
const TIMELINE_FOLLOW_RATIO = 0.24; // keeps "now" ~a quarter of the way across the visible window
const TIMELINE_RESUME_MS = 10000;   // delay after a manual scroll before auto-follow kicks back in

function LiveTimeline({ intervals, elapsed, total }) {
  const scrollRef = useRef(null);
  const resumeTimerRef = useRef(null);
  const [following, setFollowing] = useState(true);
  const totalWidth = Math.max(1, total) * TIMELINE_PX_PER_SEC;
  const nowX = Math.max(0, Math.min(total, elapsed)) * TIMELINE_PX_PER_SEC;

  // Re-center on "now" every time elapsed ticks forward, as long as the
  // rider hasn't grabbed the strip to look around.
  useEffect(() => {
    if (!following) return;
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, totalWidth - el.clientWidth);
    const target = Math.max(0, Math.min(maxScroll, nowX - el.clientWidth * TIMELINE_FOLLOW_RATIO));
    el.scrollLeft = target;
  }, [nowX, following, totalWidth]);

  useEffect(() => () => { if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current); }, []);

  function pauseFollow() {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    setFollowing(false);
  }
  function scheduleResume() {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => setFollowing(true), TIMELINE_RESUME_MS);
  }
  function jumpToNow() {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    setFollowing(true);
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={scrollRef}
        onTouchStart={pauseFollow}
        onTouchEnd={scheduleResume}
        onMouseDown={pauseFollow}
        onMouseUp={scheduleResume}
        style={{ overflowX: 'auto', overflowY: 'hidden', touchAction: 'pan-x', WebkitOverflowScrolling: 'touch', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2 }}
      >
        <div style={{ position: 'relative', width: totalWidth, height: 48, display: 'flex', alignItems: 'flex-end' }}>
          {intervals.map((it) => {
            const z = zoneFor(it);
            const w = it.duration * TIMELINE_PX_PER_SEC;
            const h = Math.max(14, Math.min(100, z.intensity * 78));
            const isFree = it.type === 'free';
            return (
              <div key={it.id} style={{ width: w, minWidth: w, flexShrink: 0, height: '100%', display: 'flex', alignItems: 'flex-end', borderRight: `1px solid ${PANEL2}` }}>
                <div style={{ width: '100%', height: `${h}%`, background: isFree ? `repeating-linear-gradient(135deg, ${z.color}, ${z.color} 4px, ${LINE} 4px, ${LINE} 8px)` : z.color }} />
              </div>
            );
          })}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: nowX, background: 'rgba(255,255,255,0.14)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: nowX, width: 2, background: TEXT, pointerEvents: 'none' }} />
        </div>
      </div>
      {!following && (
        <button onClick={jumpToNow} style={{ position: 'absolute', top: 6, right: 6, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 999, border: `1px solid ${LINE}`, background: PANEL, color: TEXT, cursor: 'pointer' }}>
          <Locate size={12} /> Now
        </button>
      )}
    </div>
  );
}

// A ring that traces around the interval timer and fills clockwise as the
// current interval counts down, so progress reads at a glance without
// having to parse the numbers. Fills whatever box its parent gives it.
function ProgressRing({ progress, color, size = 190 }) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ position: 'absolute', inset: 0, zIndex: -1, transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={LINE} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset 0.4s linear, stroke 0.6s ease' }} />
    </svg>
  );
}

// A compact semicircular gauge comparing live power against the current
// interval's target \u2014 green near target, blue under, red over.
function PowerGauge({ power, targetWatts }) {
  const w = 148, h = 82, r = 64, stroke = 11;
  const path = `M ${w / 2 - r} ${h} A ${r} ${r} 0 0 1 ${w / 2 + r} ${h}`;
  const ratio = targetWatts > 0 ? power / targetWatts : 0;
  const fillPct = Math.max(0, Math.min(100, (power / (targetWatts * 1.4 || 1)) * 100));
  const color = targetWatts <= 0 ? 'var(--accent)' : ratio < 0.85 ? '#4A6FA5' : ratio > 1.15 ? '#FF4D4D' : '#8FC93A';
  return (
    <div style={{ position: 'relative', width: w, height: h + 4 }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <path d={path} fill="none" stroke={LINE} strokeWidth={stroke} strokeLinecap="round" />
        <path d={path} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          pathLength="100" strokeDasharray="100" strokeDashoffset={100 - fillPct}
          style={{ transition: 'stroke-dashoffset 0.35s ease, stroke 0.35s ease' }} />
      </svg>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center', fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>Power</div>
    </div>
  );
}

// Confetti burst shown briefly when a workout finishes.
function Confetti({ pieces }) {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 5 }}>
      {pieces.map(p => (
        <div key={p.id} style={{
          position: 'absolute', top: -20, left: `${p.left}%`, width: p.size, height: p.size * 0.4,
          background: p.color, borderRadius: 2, transform: `rotate(${p.rotate}deg)`,
          animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s 1 forwards`,
        }} />
      ))}
    </div>
  );
}

// ---------- small ui atoms ----------
function Chip({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 999, fontSize: 13, whiteSpace: 'nowrap',
      border: `1px solid ${active ? 'var(--accent)' : LINE}`, background: active ? 'var(--accent)' : 'transparent',
      color: active ? INK : SUB, fontWeight: active ? 700 : 500, cursor: 'pointer', flexShrink: 0,
    }}>{children}</button>
  );
}
function IconBtn({ onClick, children, disabled, danger }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: 34, height: 34, borderRadius: 8, border: `1px solid ${LINE}`,
      background: PANEL2, color: disabled ? MUTED : (danger ? RED : TEXT),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, flexShrink: 0,
    }}>{children}</button>
  );
}
function Switch({ checked, onChange, disabled }) {
  return (
    <button onClick={() => !disabled && onChange(!checked)} disabled={disabled} style={{
      width: 44, height: 26, borderRadius: 13, border: `1px solid ${LINE}`,
      background: checked ? 'var(--accent)' : PANEL2, position: 'relative', cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1, flexShrink: 0, padding: 0,
    }}>
      <div style={{ position: 'absolute', top: 2, left: checked ? 20 : 2, width: 20, height: 20, borderRadius: '50%', background: checked ? INK : SUB, transition: 'left .15s' }} />
    </button>
  );
}
function SettingRow({ label, sub, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: `1px solid ${LINE}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, color: TEXT }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: SUB, marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}
function SectionHeader({ icon, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 26, marginBottom: 4 }}>
      {icon}
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 16, fontWeight: 600, color: TEXT, letterSpacing: 0.3 }}>{title}</div>
    </div>
  );
}
// A section header that also acts as a toggle, hiding its contents behind a
// tap so a long options screen can start out short and uncluttered.
function CollapsibleSection({ icon, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 26 }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', padding: 0, marginBottom: open ? 4 : 0, cursor: 'pointer', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon}
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 16, fontWeight: 600, color: TEXT, letterSpacing: 0.3 }}>{title}</div>
        </div>
        {open ? <ChevronUp size={18} color={SUB} /> : <ChevronDown size={18} color={SUB} />}
      </button>
      {open && children}
    </div>
  );
}

// A quick yes/no dialog for interrupting a destructive action \u2014 distinct
// from the bigger bottom sheets (WorkoutDetail, PaywallView) which are for
// browsing content rather than confirming a single choice.
function ConfirmModal({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, danger }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: BG, border: `1px solid ${LINE}`, borderRadius: 16, padding: 22, width: '100%', maxWidth: 340, textAlign: 'center' }}>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 19, fontWeight: 600, color: TEXT, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.6, marginBottom: 20 }}>{message}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{cancelLabel}</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', background: danger ? RED : 'var(--accent)', color: danger ? '#fff' : INK, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- workout detail sheet ----------
function WorkoutDetail({ workout, ftp, setFtp, settings, onStart, onClose, onEdit, isCustom, onDelete, onSaveScaled }) {
  const originalTotal = totalDuration(workout.intervals);
  const scalable = !workout.fixedLength;
  const [targetMinutes, setTargetMinutes] = useState(Math.max(10, Math.round(originalTotal / 60)));
  useEffect(() => { setTargetMinutes(Math.max(10, Math.round(originalTotal / 60))); }, [workout.id]);

  const scaledIntervals = useMemo(
    () => (scalable ? smartScaleWorkout(workout.intervals, targetMinutes * 60, workout.repeatWholeCore) : workout.intervals),
    [workout, targetMinutes, scalable]
  );
  const actualTotal = totalDuration(scaledIntervals);
  const isScaled = scalable && Math.abs(actualTotal - originalTotal) > 20;
  const needsFtp = scaledIntervals.some(i => i.type === 'power');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: BG, width: '100%', maxWidth: 520, borderRadius: '18px 18px 0 0', border: `1px solid ${LINE}`, borderBottom: 'none', padding: 20, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: 600, color: TEXT, letterSpacing: 0.3 }}>{workout.name}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: SUB, cursor: 'pointer' }}><X size={22} /></button>
        </div>
        <div style={{ fontSize: 13, color: SUB, marginBottom: 14 }}>{workout.description}</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, fontSize: 12, color: SUB, flexWrap: 'wrap' }}>
          <span style={{ border: `1px solid ${LINE}`, borderRadius: 6, padding: '3px 8px' }}>{workout.category}</span>
          <span style={{ border: `1px solid ${LINE}`, borderRadius: 6, padding: '3px 8px' }}>{fmtLong(actualTotal)}</span>
          <span style={{ border: `1px solid ${LINE}`, borderRadius: 6, padding: '3px 8px' }}>{scaledIntervals.length} intervals</span>
        </div>

        <ProfileChart intervals={scaledIntervals} />

        {scalable && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: SUB, marginBottom: 6 }}>
              <span>Adjust length</span>
              <span style={{ color: TEXT }}>{targetMinutes} min{isScaled ? ` \u2192 ${fmtLong(actualTotal)} actual` : ''}</span>
            </div>
            <input type="range" min={10} max={360} step={5} value={targetMinutes}
              onChange={e => setTargetMinutes(Number(e.target.value))}
              style={{ width: '100%', accentColor: settings.accentColor }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: SUB, marginTop: 2 }}>
              <span>10 min</span><span>6 hours</span>
            </div>
            {isScaled && (
              <button onClick={() => setTargetMinutes(Math.max(10, Math.round(originalTotal / 60)))}
                style={{ marginTop: 6, background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', padding: 0 }}>
                Reset to original length
              </button>
            )}
          </div>
        )}

        <button onClick={() => onStart({ ...workout, intervals: scaledIntervals })}
          style={{ width: '100%', marginTop: 16, padding: '12px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}>
          <Play size={18} fill={INK} /> Start workout
        </button>

        {needsFtp && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <Gauge size={18} color="var(--accent)" />
            <span style={{ fontSize: 13, color: SUB }}>Your FTP</span>
            <input type="number" value={ftp} onChange={e => setFtp(Math.max(50, Number(e.target.value) || 0))}
              style={{ width: 80, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '6px 8px', fontSize: 14 }} />
            <span style={{ fontSize: 13, color: SUB }}>watts</span>
          </div>
        )}

        {workout.notes && (
          <div style={{ marginTop: 16, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 12, fontSize: 12.5, color: SUB, lineHeight: 1.5 }}>
            {workout.notes}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
          {scaledIntervals.map((it) => {
            const z = zoneFor(it);
            return (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 8px', background: PANEL, borderRadius: 6 }}>
                <div style={{ width: 4, height: 24, background: z.color, borderRadius: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, color: TEXT }}>{it.label}</div>
                <div style={{ color: SUB }}>{formatTarget(it, ftp, settings.targetDisplay)}</div>
                <div style={{ color: SUB, width: 44, textAlign: 'right' }}>{fmt(it.duration)}</div>
              </div>
            );
          })}
        </div>

        {(isCustom || isScaled) && (
          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            {isCustom && (
              <>
                <button onClick={onEdit} style={{ flex: '1 1 100px', padding: '12px 0', borderRadius: 10, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}><Edit3 size={16} /> Edit</button>
                <button onClick={onDelete} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${LINE}`, background: PANEL2, color: RED, cursor: 'pointer' }}><Trash2 size={16} /></button>
              </>
            )}
            {isScaled && (
              <button onClick={() => onSaveScaled({ ...workout, id: 'custom-' + newId(), name: `${workout.name} (${targetMinutes}m)`, intervals: scaledIntervals })}
                style={{ flex: '1 1 140px', padding: '12px 0', borderRadius: 10, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}>
                <Save size={16} /> Save as new
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- home / welcome screen ----------
const HOME_TILES = [
  { key: 'basics', label: 'Workouts', caption: 'Structured sessions', icon: Dumbbell },
  { key: 'rides', label: 'Rides', caption: 'Long, mixed-terrain', icon: Bike },
  { key: 'builder', label: 'Builder', caption: 'Build your own', icon: Wrench },
  { key: 'ftp', label: 'FTP', caption: 'Test & track', icon: Gauge },
];

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}
function mostRecentEntry(list, predicate) {
  const matches = predicate ? list.filter(predicate) : list;
  if (!matches || matches.length === 0) return null;
  return matches.reduce((a, b) => (new Date(a.date) > new Date(b.date) ? a : b));
}
// Picks the single most useful nudge to show on the home screen, checking
// progressively less-urgent signals and stopping at the first one that fires.
function buildNextUpSuggestion(ftpHistory, workoutHistory) {
  if (!ftpHistory || ftpHistory.length === 0) {
    return { text: 'You haven\u2019t tested your FTP yet \u2014 run a quick test so your power targets are accurate.', action: 'ftp', cta: 'Test FTP' };
  }
  const lastFtp = ftpHistory[ftpHistory.length - 1];
  const daysSinceFtp = daysSince(lastFtp.date);
  if (daysSinceFtp >= 42) {
    return { text: `It's been ${daysSinceFtp} days since your last FTP test \u2014 worth retesting to keep your targets sharp.`, action: 'ftp' };
  }
  if (!workoutHistory || workoutHistory.length === 0) {
    return { text: 'Ready for your first session? Workouts and Rides both have plenty to choose from.', action: 'basics' };
  }
  const lastVO2 = mostRecentEntry(workoutHistory, w => /vo2/i.test(w.name));
  const daysSinceVO2 = lastVO2 ? daysSince(lastVO2.date) : null;
  if (daysSinceVO2 === null || daysSinceVO2 >= 14) {
    return {
      text: daysSinceVO2 == null ? 'You haven\u2019t logged a VO2 max session yet \u2014 worth adding one for a fitness boost.' : `You haven't done a VO2 max session in ${daysSinceVO2} days.`,
      action: 'basics',
    };
  }
  const lastRide = mostRecentEntry(workoutHistory, w => w.category === 'Rides');
  const daysSinceRide = lastRide ? daysSince(lastRide.date) : null;
  if (daysSinceRide === null || daysSinceRide >= 10) {
    return {
      text: daysSinceRide == null ? 'You haven\u2019t done a long ride yet \u2014 the Rides library has plenty to choose from.' : `It's been ${daysSinceRide} days since your last ride.`,
      action: 'rides',
    };
  }
  const lastAny = mostRecentEntry(workoutHistory);
  const daysSinceAny = lastAny ? daysSince(lastAny.date) : null;
  const lastRecovery = mostRecentEntry(workoutHistory, w => /recovery/i.test(w.name));
  const daysSinceRecovery = lastRecovery ? daysSince(lastRecovery.date) : null;
  if (daysSinceAny !== null && daysSinceAny >= 5 && (daysSinceRecovery == null || daysSinceRecovery >= 10)) {
    return { text: 'It\u2019s been a few days since your last session \u2014 maybe ease back in with a recovery spin.', action: 'basics' };
  }
  return { text: 'You\u2019re riding consistently \u2014 keep it up.', action: null };
}

// ---------- personal records ----------
// Monday-start week bucket, used to find the person's single best training week.
function startOfWeek(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay(); // 0 = Sun ... 6 = Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
// Derives longest ride, best power numbers, streaks and totals purely from
// completed session history \u2014 returns null until there's at least one
// logged ride. avgPower/maxPower/avgHr/maxHr are only present on sessions
// ridden with a trainer/heart rate monitor connected, so those particular
// records simply don't appear until the person has ridden with one.
function computePersonalRecords(workoutHistory) {
  const completed = (workoutHistory || []).filter(w => w.completed);
  if (completed.length === 0) return null;

  const longest = completed.reduce((a, b) => (!a || b.duration > a.duration ? b : a), null);
  const withPower = completed.filter(w => w.avgPower != null);
  const bestAvgPower = withPower.length ? withPower.reduce((a, b) => (b.avgPower > a.avgPower ? b : a)) : null;
  const withPeak = completed.filter(w => w.maxPower != null);
  const bestPeakPower = withPeak.length ? withPeak.reduce((a, b) => (b.maxPower > a.maxPower ? b : a)) : null;

  const totalRides = completed.length;
  const totalSeconds = completed.reduce((a, w) => a + w.duration, 0);

  // Unique calendar days ridden, sorted, for streak math.
  const dayTimes = Array.from(new Set(completed.map(w => new Date(w.date).toDateString())))
    .map(s => new Date(s).getTime())
    .sort((a, b) => a - b);
  let longestStreak = 1, run = 1;
  for (let i = 1; i < dayTimes.length; i++) {
    const gap = Math.round((dayTimes[i] - dayTimes[i - 1]) / 86400000);
    run = gap === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }
  let currentStreak = 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const gapFromToday = Math.round((today.getTime() - dayTimes[dayTimes.length - 1]) / 86400000);
  if (gapFromToday <= 1) {
    currentStreak = 1;
    for (let i = dayTimes.length - 1; i > 0; i--) {
      if (Math.round((dayTimes[i] - dayTimes[i - 1]) / 86400000) === 1) currentStreak += 1;
      else break;
    }
  }

  const weekCounts = {};
  completed.forEach(w => { const wk = startOfWeek(w.date); weekCounts[wk] = (weekCounts[wk] || 0) + 1; });
  const bestWeekCount = Object.values(weekCounts).reduce((a, b) => Math.max(a, b), 0);

  return { longest, bestAvgPower, bestPeakPower, totalRides, totalSeconds, longestStreak, currentStreak, bestWeekCount };
}

function Sparkline({ values, height = 28, color }) {
  if (!values || values.length < 2) return null;
  const width = 200;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const toY = v => height - 4 - ((v - min) / range) * (height - 8);
  const points = values.map((v, i) => `${i * stepX},${toY(v)}`).join(' ');
  const lastX = (values.length - 1) * stepX;
  const lastY = toY(values[values.length - 1]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: 'block', marginTop: 4 }}>
      <polyline points={points} fill="none" stroke={color || 'var(--accent)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="3.5" fill={color || 'var(--accent)'} />
    </svg>
  );
}

function HistoryRow({ entry }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: TEXT, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</div>
        <div style={{ fontSize: 11.5, color: SUB }}>{new Date(entry.date).toLocaleDateString()} · {fmtLong(entry.duration)}</div>
      </div>
      {!entry.completed && <div style={{ fontSize: 10, color: SUB, border: `1px solid ${LINE}`, borderRadius: 999, padding: '2px 8px', flexShrink: 0 }}>Partial</div>}
    </div>
  );
}

function HomeView({ account, ftpHistory, workoutHistory, onNavigate }) {
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Late one' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = (account && account.name ? account.name.split(' ')[0] : '') || 'Rider';
  const initial = firstName.charAt(0).toUpperCase();

  const weekAgo = Date.now() - 7 * 86400000;
  const thisWeek = (workoutHistory || []).filter(w => new Date(w.date).getTime() >= weekAgo);
  const weekSeconds = thisWeek.reduce((a, w) => a + w.duration, 0);

  const ftpValues = (ftpHistory || []).slice(-8).map(h => h.ftp);
  const currentFtpVal = ftpValues.length ? ftpValues[ftpValues.length - 1] : null;
  const prevFtpVal = ftpValues.length > 1 ? ftpValues[ftpValues.length - 2] : null;
  const ftpDelta = currentFtpVal != null && prevFtpVal != null ? currentFtpVal - prevFtpVal : null;

  const pr = computePersonalRecords(workoutHistory);
  const streak = pr ? pr.currentStreak : 0;
  const bestStreak = pr ? pr.longestStreak : 0;

  const workoutCount = LIBRARY.filter(w => w.category === 'Basics').length;
  const rideCount = LIBRARY.filter(w => w.category === 'Rides').length;

  const heroes = [
    { key: 'basics', label: 'Workouts', caption: `${workoutCount} structured sessions · intervals, sweet spot, VO2`, icon: Dumbbell, photo: '/images/home-workouts.jpg', photoPos: 'center 45%', ink: 'var(--hero1-ink)', chip: 'var(--hero1-chip)' },
    { key: 'rides', label: 'Rides', caption: `${rideCount} long routes · mixed-terrain, real-world feel`, icon: Bike, photo: '/images/home-rides.jpg', photoPos: 'center 74%', ink: 'var(--hero2-ink)', chip: 'var(--hero2-chip)' },
  ];
  const slim = [
    { key: 'builder', label: 'Builder', icon: Wrench },
    { key: 'ftp', label: 'FTP test', icon: Gauge },
  ];

  const cardBase = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 12, minWidth: 0 };
  const kick = { fontSize: 9.5, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 };
  const monoVal = { fontFamily: 'Space Mono, monospace', fontSize: 17, color: TEXT };

  return (
    <div style={{ padding: '22px 20px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: PANEL2, border: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 18, color: 'var(--accent)' }}>{initial}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{greeting}</div>
            <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: 600, color: TEXT, lineHeight: 1.1 }}>{firstName}</div>
          </div>
          {streak > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 999, padding: '6px 12px' }}>
              <Flame size={15} color="var(--flame)" fill="var(--flame)" />
              <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 13, color: TEXT }}>{streak}</span>
            </div>
          )}
        </div>

        {/* 3-up stat strip */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 22 }}>
          <div style={cardBase}>
            <div style={kick}>This week</div>
            <div style={monoVal}>{weekSeconds > 0 ? fmtLong(weekSeconds) : '0 min'}</div>
            <div style={{ fontSize: 10.5, color: SUB, marginTop: 2 }}>{thisWeek.length} session{thisWeek.length === 1 ? '' : 's'}</div>
          </div>
          <div style={cardBase}>
            <div style={kick}>FTP</div>
            {currentFtpVal != null ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <div style={monoVal}>{currentFtpVal}</div>
                  {ftpDelta != null && ftpDelta !== 0 && <div style={{ fontSize: 10.5, color: ftpDelta > 0 ? 'var(--accent)' : SUB }}>{ftpDelta > 0 ? '+' : ''}{ftpDelta}</div>}
                </div>
                {ftpValues.length >= 2 ? <Sparkline values={ftpValues} height={16} /> : <div style={{ fontSize: 10.5, color: SUB, marginTop: 2 }}>—</div>}
              </>
            ) : <div style={{ fontSize: 10.5, color: SUB, marginTop: 2 }}>No tests</div>}
          </div>
          <div style={cardBase}>
            <div style={kick}>Streak</div>
            <div style={monoVal}>{streak}d</div>
            <div style={{ fontSize: 10.5, color: SUB, marginTop: 2 }}>Best: {bestStreak}</div>
          </div>
        </div>

        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 20, fontWeight: 600, color: TEXT, marginBottom: 14 }}>What are we riding?</div>

        {/* hero cards */}
        {heroes.map(h => (
          <button key={h.key} onClick={() => onNavigate(h.key)} style={{ width: '100%', padding: 0, border: `1px solid ${LINE}`, borderRadius: 20, overflow: 'hidden', cursor: 'pointer', background: PANEL, marginBottom: 14, display: 'block', textAlign: 'left' }}>
            <div style={{ position: 'relative', height: 132, backgroundImage: `url(${h.photo})`, backgroundSize: 'cover', backgroundPosition: h.photoPos, display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: h.chip, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 0 14px 14px' }}>
                <h.icon size={21} color={h.ink} />
              </div>
            </div>
            <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 18, fontWeight: 600, color: TEXT }}>{h.label}</div>
                <div style={{ fontSize: 11.5, color: SUB, marginTop: 2 }}>{h.caption}</div>
              </div>
              <ChevronRight size={18} color={SUB} style={{ flexShrink: 0 }} />
            </div>
          </button>
        ))}

        {/* slim row */}
        <div style={{ display: 'flex', gap: 12 }}>
          {slim.map(s => (
            <button key={s.key} onClick={() => onNavigate(s.key)} style={{ flex: 1, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 14, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left' }}>
              <s.icon size={18} color="var(--accent)" />
              <span style={{ fontSize: 13, color: TEXT, fontWeight: 500 }}>{s.label}</span>
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}

// ---------- full workout history ----------
function PersonalRecordsPanel({ workoutHistory }) {
  const pr = computePersonalRecords(workoutHistory);
  if (!pr) return null;
  const cards = [
    { label: 'Longest ride', value: fmtLong(pr.longest.duration), sub: pr.longest.name, icon: Bike },
    pr.bestAvgPower && { label: 'Best average power', value: `${pr.bestAvgPower.avgPower}W`, sub: pr.bestAvgPower.name, icon: Zap },
    pr.bestPeakPower && { label: 'Peak power', value: `${pr.bestPeakPower.maxPower}W`, sub: pr.bestPeakPower.name, icon: Zap },
    { label: 'Current streak', value: `${pr.currentStreak} day${pr.currentStreak === 1 ? '' : 's'}`, sub: pr.longestStreak > pr.currentStreak ? `Best: ${pr.longestStreak} days` : pr.currentStreak > 0 ? 'Personal best' : `Best: ${pr.longestStreak} days`, icon: Flame },
    { label: 'Best week', value: `${pr.bestWeekCount} session${pr.bestWeekCount === 1 ? '' : 's'}`, sub: null, icon: CalendarDays },
    { label: 'All-time', value: fmtLong(pr.totalSeconds), sub: `${pr.totalRides} ride${pr.totalRides === 1 ? '' : 's'}`, icon: Trophy },
  ].filter(Boolean);

  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Trophy size={15} color="var(--accent)" />
        <div style={{ fontSize: 12, color: SUB, textTransform: 'uppercase', letterSpacing: 0.6 }}>Personal records</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {cards.map((c, i) => (
          <div key={i} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 5 }}>
              <c.icon size={11} /> {c.label}
            </div>
            <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 17, fontWeight: 700, color: TEXT }}>{c.value}</div>
            {c.sub && <div style={{ fontSize: 11, color: SUB, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryView({ workoutHistory, onClear }) {
  const all = (workoutHistory || []).slice().reverse();
  return (
    <div style={{ padding: '16px 16px 80px' }}>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 26, fontWeight: 600, color: TEXT, letterSpacing: 0.3, marginBottom: 2 }}>History</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: SUB }}>{all.length} session{all.length === 1 ? '' : 's'} logged</div>
        {all.length > 0 && (
          <button onClick={onClear} style={{ background: 'none', border: 'none', color: SUB, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>
      <PersonalRecordsPanel workoutHistory={workoutHistory} />
      {all.length === 0 ? (
        <div style={{ color: SUB, fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No workouts logged yet — finish a session and it'll show up here.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {all.map(entry => <HistoryRow key={entry.id} entry={entry} />)}
        </div>
      )}
    </div>
  );
}

// ---------- FTP: run a test, see your history ----------
function FtpView({ ftp, setFtp, ftpHistory, onClearFtpHistory, onOpenWorkout }) {
  const tests = [LIBRARY.find(w => w.id === 'ramp-ftp-test'), LIBRARY.find(w => w.id === 'ftp-test-20')].filter(Boolean);
  const history = (ftpHistory || []).slice().reverse().slice(0, 10);

  return (
    <div style={{ padding: '16px 16px 80px' }}>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 26, fontWeight: 600, color: TEXT, letterSpacing: 0.3, marginBottom: 2 }}>FTP</div>
      <div style={{ fontSize: 13, color: SUB, marginBottom: 18 }}>Test your threshold power and keep an eye on it over time.</div>

      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 18, marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, color: SUB, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>Current FTP</div>
          <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 32, fontWeight: 700, color: TEXT }}>{ftp}W</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="number" value={ftp} onChange={e => setFtp(Math.max(50, Number(e.target.value) || 0))}
            style={{ width: 72, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, padding: '8px 10px', fontSize: 14, textAlign: 'center' }} />
          <span style={{ fontSize: 12.5, color: SUB }}>W</span>
        </div>
      </div>

      <div style={{ fontSize: 12, color: SUB, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>Test protocols</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 26 }}>
        {tests.map(w => {
          const total = totalDuration(w.intervals);
          return (
            <div key={w.id} onClick={() => onOpenWorkout(w)} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: TEXT }}>{w.name}</div>
                <div style={{ fontSize: 12, color: 'var(--accent)' }}>{fmtLong(total)}</div>
              </div>
              <div style={{ fontSize: 12.5, color: SUB, marginBottom: 10 }}>{w.description}</div>
              <ProfileChart intervals={w.intervals} height={36} />
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: SUB, textTransform: 'uppercase', letterSpacing: 0.6 }}>Test history</div>
        {history.length > 0 && (
          <button onClick={onClearFtpHistory} style={{ background: 'none', border: 'none', color: SUB, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>
      {history.length === 0 ? (
        <div style={{ color: SUB, fontSize: 13, textAlign: 'center', padding: '24px 0', border: `1px dashed ${LINE}`, borderRadius: 10 }}>
          No FTP tests logged yet — run one of the protocols above to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {history.map(entry => (
            <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: PANEL, borderRadius: 8, padding: '8px 10px' }}>
              <div>
                <div style={{ fontSize: 13.5, color: TEXT, fontWeight: 600 }}>{entry.ftp}W</div>
                <div style={{ fontSize: 11.5, color: SUB }}>{entry.source}</div>
              </div>
              <div style={{ fontSize: 11.5, color: SUB }}>{new Date(entry.date).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- library view ----------
function LibraryView({ customWorkouts, onOpen, lockedCategory, title, subtitle }) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState(lockedCategory || 'All');
  const all = useMemo(() => {
    const withFlag = LIBRARY.map(w => ({ ...w, custom: false })).concat(customWorkouts.map(w => ({ ...w, custom: true })));
    const activeCat = lockedCategory || cat;
    return withFlag.filter(w => (activeCat === 'All' || activeCat === 'Custom' ? true : w.category === activeCat) && (activeCat !== 'Custom' || w.custom))
      .filter(w => w.name.toLowerCase().includes(query.toLowerCase()));
  }, [query, cat, customWorkouts, lockedCategory]);

  return (
    <div style={{ padding: '16px 16px 80px' }}>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 26, fontWeight: 600, color: TEXT, letterSpacing: 0.3, marginBottom: 2 }}>{title || 'Workout library'}</div>
      <div style={{ fontSize: 13, color: SUB, marginBottom: 14 }}>{subtitle || `${all.length} workout${all.length === 1 ? '' : 's'} \u00b7 pick one and go`}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 12px', marginBottom: 12 }}>
        <Search size={16} color={SUB} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search workouts"
          style={{ background: 'none', border: 'none', outline: 'none', color: TEXT, fontSize: 14, flex: 1 }} />
      </div>
      {!lockedCategory && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 14 }}>
          {CATEGORIES.concat('Custom').map(c => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{c}</Chip>)}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {all.map(w => {
          const total = totalDuration(w.intervals);
          return (
            <div key={w.id} onClick={() => onOpen(w)} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: TEXT }}>{w.name}</div>
                <div style={{ fontSize: 12, color: 'var(--accent)' }}>{fmtLong(total)}</div>
              </div>
              <div style={{ fontSize: 12.5, color: SUB, marginBottom: 10 }}>{w.description}</div>
              <ProfileChart intervals={w.intervals} height={40} />
            </div>
          );
        })}
        {all.length === 0 && <div style={{ color: SUB, fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No workouts match. Try the builder tab to make your own.</div>}
      </div>
    </div>
  );
}

// ---------- builder view ----------
const QUICK_BLOCKS = [
  { label: 'Warm up', duration: 300, type: 'power', target: 55 },
  { label: 'Cool down', duration: 300, type: 'power', target: 50 },
  { label: 'Recovery', duration: 120, type: 'power', target: 55 },
  { label: 'Sweet spot', duration: 480, type: 'power', target: 90 },
  { label: 'Threshold', duration: 300, type: 'power', target: 100 },
  { label: 'VO2 max', duration: 180, type: 'power', target: 115 },
  { label: 'Sprint', duration: 30, type: 'rpe', target: 10 },
  { label: 'Free ride', duration: 300, type: 'free', target: null },
];

function IntervalRow({ interval, onChange, onDelete, onMoveUp, onMoveDown, onDuplicate, first, last }) {
  const z = zoneFor(interval);
  const mins = Math.floor(interval.duration / 60);
  const secs = interval.duration % 60;
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <div style={{ width: 4, alignSelf: 'stretch', background: z.color, borderRadius: 2 }} />
        <input value={interval.label} onChange={e => onChange({ ...interval, label: e.target.value })}
          placeholder="Label" style={{ flex: 1, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '6px 8px', fontSize: 13 }} />
        <IconBtn onClick={onMoveUp} disabled={first}><ChevronUp size={16} /></IconBtn>
        <IconBtn onClick={onMoveDown} disabled={last}><ChevronDown size={16} /></IconBtn>
        <IconBtn onClick={onDuplicate}><Copy size={15} /></IconBtn>
        <IconBtn onClick={onDelete} danger><Trash2 size={15} /></IconBtn>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: SUB }}>Duration</label>
        <input type="number" min="0" value={mins} onChange={e => onChange({ ...interval, duration: Math.max(0, Number(e.target.value) || 0) * 60 + secs })}
          style={{ width: 48, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '5px 6px', fontSize: 13 }} />
        <span style={{ color: SUB, fontSize: 12 }}>m</span>
        <input type="number" min="0" max="59" value={secs} onChange={e => onChange({ ...interval, duration: mins * 60 + Math.min(59, Math.max(0, Number(e.target.value) || 0)) })}
          style={{ width: 48, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '5px 6px', fontSize: 13 }} />
        <span style={{ color: SUB, fontSize: 12 }}>s</span>
        <select value={interval.type} onChange={e => {
          const t = e.target.value;
          const target = t === 'power' ? 70 : t === 'rpe' ? 5 : null;
          onChange({ ...interval, type: t, target });
        }} style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '5px 6px', fontSize: 13 }}>
          <option value="power">Power</option>
          <option value="rpe">RPE</option>
          <option value="free">Free</option>
        </select>
        {interval.type !== 'free' && (
          <>
            <input type="number" value={interval.target ?? ''} onChange={e => onChange({ ...interval, target: Number(e.target.value) || 0 })}
              style={{ width: 52, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '5px 6px', fontSize: 13 }} />
            <span style={{ color: SUB, fontSize: 12 }}>{interval.type === 'power' ? '% FTP' : '/ 10'}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- build a workout from an uploaded GPX route ----------
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
// Maps a road gradient to a realistic indoor power target and an assumed
// outdoor speed for that gradient \u2014 the speed is only used to convert the
// route's real-world distance into a believable interval duration.
function gradeToEffort(gradePct) {
  if (gradePct <= -6) return { target: 45, speedKmh: 45 };
  if (gradePct <= -2) return { target: 55, speedKmh: 36 };
  if (gradePct <= 1) return { target: 65, speedKmh: 27 };
  if (gradePct <= 3) return { target: 76, speedKmh: 20 };
  if (gradePct <= 5) return { target: 86, speedKmh: 15 };
  if (gradePct <= 8) return { target: 96, speedKmh: 11 };
  if (gradePct <= 11) return { target: 105, speedKmh: 8 };
  return { target: 114, speedKmh: 6 };
}
function labelForTarget(target) {
  if (target <= 55) return 'Descent';
  if (target <= 65) return 'Flat / rolling';
  if (target <= 76) return 'Gentle climb';
  if (target <= 86) return 'Climb';
  if (target <= 96) return 'Steep climb';
  if (target <= 105) return 'Very steep';
  return 'Wall';
}
// Turns raw GPX XML text into a custom workout: buckets the route into
// ~150m chunks to smooth out GPS noise, works out the gradient of each
// chunk, converts gradient -> power target + realistic duration, then
// merges neighbouring chunks that land in the same effort zone so the
// result is a manageable number of intervals rather than hundreds of
// one-second ones.
function parseGpxToWorkout(xmlText, fileName) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('That file doesn\u2019t look like a valid GPX file.');
  const trkpts = Array.from(doc.getElementsByTagName('trkpt'));
  if (trkpts.length < 2) throw new Error('No track points were found in this file.');
  const points = trkpts.map(pt => {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    const eleNode = pt.getElementsByTagName('ele')[0];
    const ele = eleNode ? parseFloat(eleNode.textContent) : null;
    return { lat, lon, ele };
  }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.ele));
  if (points.length < 2) throw new Error('This GPX file doesn\u2019t include elevation data, so a profile can\u2019t be built from it.');

  const bucketMeters = 150;
  const buckets = [];
  let bucketDist = 0, bucketStartEle = points[0].ele, prev = points[0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const d = haversineMeters(prev.lat, prev.lon, p.lat, p.lon);
    if (d > 0 && d < 2000) { // ignore GPS teleport glitches
      bucketDist += d;
      if (bucketDist >= bucketMeters) {
        buckets.push({ distance: bucketDist, gradePct: ((p.ele - bucketStartEle) / bucketDist) * 100 });
        bucketDist = 0;
        bucketStartEle = p.ele;
      }
    }
    prev = p;
  }
  if (bucketDist > 20) buckets.push({ distance: bucketDist, gradePct: ((prev.ele - bucketStartEle) / bucketDist) * 100 });
  if (buckets.length === 0) throw new Error('This route is too short to build a workout from.');
  buckets.forEach(b => { b.gradePct = Math.max(-20, Math.min(20, b.gradePct)); }); // clamp GPS/elevation noise

  const raw = buckets.map(b => {
    const { target, speedKmh } = gradeToEffort(b.gradePct);
    return { target, duration: Math.round(b.distance / ((speedKmh * 1000) / 3600)) };
  });

  const merged = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.target === seg.target) last.duration += seg.duration;
    else merged.push({ ...seg });
  }
  const cleaned = [];
  for (const seg of merged) {
    if (seg.duration < 10 && cleaned.length > 0) cleaned[cleaned.length - 1].duration += seg.duration;
    else cleaned.push(seg);
  }

  const MAX_SEGMENTS = 80;
  let finalSegs = cleaned;
  while (finalSegs.length > MAX_SEGMENTS) {
    const next = [];
    for (let i = 0; i < finalSegs.length; i += 2) {
      if (i + 1 < finalSegs.length) {
        const a = finalSegs[i], b = finalSegs[i + 1];
        const totalDur = a.duration + b.duration;
        next.push({ target: Math.round((a.target * a.duration + b.target * b.duration) / totalDur), duration: totalDur });
      } else next.push(finalSegs[i]);
    }
    finalSegs = next;
  }

  const intervals = [
    iv('Warm up', 600, 'power', 55),
    ...finalSegs.map(s => iv(labelForTarget(s.target), Math.max(15, s.duration), 'power', s.target)),
    iv('Cool down', 480, 'power', 50),
  ];

  const nameNode = doc.getElementsByTagName('name')[0];
  const routeName = (nameNode && nameNode.textContent.trim()) || (fileName ? fileName.replace(/\.gpx$/i, '') : 'My route');
  const totalDist = buckets.reduce((a, b) => a + b.distance, 0);
  const totalElevGain = points.reduce((acc, p, i) => (i === 0 ? acc : acc + Math.max(0, p.ele - points[i - 1].ele)), 0);

  return {
    id: 'custom-' + newId(),
    name: routeName,
    category: 'Rides',
    description: `Built from your uploaded route \u2014 ${(totalDist / 1000).toFixed(1)}km with ${Math.round(totalElevGain)}m of climbing, converted into an indoor power profile.`,
    intervals,
  };
}

function BuilderView({ customWorkouts, saveCustomWorkout, deleteCustomWorkout, editingWorkout, clearEditing }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Mixed');
  const [description, setDescription] = useState('');
  const [intervals, setIntervals] = useState([]);
  const [gpxError, setGpxError] = useState(null);
  const [gpxBusy, setGpxBusy] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (editingWorkout) {
      setName(editingWorkout.name);
      setCategory(editingWorkout.category);
      setDescription(editingWorkout.description || '');
      setIntervals(editingWorkout.intervals.map(i => ({ ...i })));
    }
  }, [editingWorkout]);

  function handleGpxFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file again later
    if (!file) return;
    setGpxError(null);
    setGpxBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workout = parseGpxToWorkout(reader.result, file.name);
        setName(workout.name);
        setCategory(workout.category);
        setDescription(workout.description);
        setIntervals(workout.intervals);
      } catch (err) {
        setGpxError((err && err.message) || 'Could not read that file.');
      }
      setGpxBusy(false);
    };
    reader.onerror = () => { setGpxError('Could not read that file.'); setGpxBusy(false); };
    reader.readAsText(file);
  }

  function addBlock(block) { setIntervals(list => [...list, iv(block.label, block.duration, block.type, block.target)]); }
  function updateAt(idx, next) { setIntervals(list => list.map((it, i) => (i === idx ? next : it))); }
  function removeAt(idx) { setIntervals(list => list.filter((_, i) => i !== idx)); }
  function duplicateAt(idx) {
    setIntervals(list => {
      const copy = { ...list[idx], id: newId() };
      const out = [...list];
      out.splice(idx + 1, 0, copy);
      return out;
    });
  }
  function move(idx, dir) {
    setIntervals(list => {
      const out = [...list];
      const j = idx + dir;
      if (j < 0 || j >= out.length) return out;
      [out[idx], out[j]] = [out[j], out[idx]];
      return out;
    });
  }
  function reset() { setName(''); setCategory('Mixed'); setDescription(''); setIntervals([]); setGpxError(null); clearEditing(); }
  function save() {
    if (!name.trim() || intervals.length === 0) return;
    saveCustomWorkout({ id: editingWorkout ? editingWorkout.id : 'custom-' + newId(), name: name.trim(), category, description: description.trim() || 'Custom workout.', intervals });
    reset();
  }

  const total = totalDuration(intervals);

  return (
    <div style={{ padding: '16px 16px 80px' }}>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 26, fontWeight: 600, color: TEXT, letterSpacing: 0.3, marginBottom: 2 }}>{editingWorkout ? 'Edit workout' : 'Build a workout'}</div>
      <div style={{ fontSize: 13, color: SUB, marginBottom: 16 }}>Stack intervals, mix power, RPE and free riding \u2014 or start from a real route.</div>

      <input ref={fileInputRef} type="file" accept=".gpx" onChange={handleGpxFile} style={{ display: 'none' }} />
      <button onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={gpxBusy}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 0', borderRadius: 10, border: `1px dashed ${LINE}`, background: PANEL, color: TEXT, fontSize: 13.5, fontWeight: 600, cursor: gpxBusy ? 'default' : 'pointer', marginBottom: 8, boxSizing: 'border-box' }}>
        <Upload size={15} /> {gpxBusy ? 'Reading route\u2026' : 'Import a route (GPX file)'}
      </button>
      {gpxError && <div style={{ fontSize: 12, color: RED, marginBottom: 8 }}>{gpxError}</div>}
      <div style={{ fontSize: 11.5, color: SUB, marginBottom: 14, lineHeight: 1.5 }}>
        Turns a real ride's elevation profile into an indoor power workout \u2014 climbs get harder targets, descents get easier ones, timed to roughly match real-world pace. Review it below before saving.
      </div>

      <input value={name} onChange={e => setName(e.target.value)} placeholder="Workout name"
        style={{ width: '100%', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, padding: '10px 12px', fontSize: 15, marginBottom: 8, boxSizing: 'border-box' }} />
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description"
        style={{ width: '100%', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, padding: '10px 12px', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
      <select value={category} onChange={e => setCategory(e.target.value)}
        style={{ width: '100%', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, padding: '10px 12px', fontSize: 13, marginBottom: 14, boxSizing: 'border-box' }}>
        {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      {intervals.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <ProfileChart intervals={intervals} />
          <div style={{ fontSize: 12, color: SUB, marginTop: 6 }}>{fmtLong(total)} total · {intervals.length} intervals</div>
        </div>
      )}

      <div style={{ fontSize: 12, color: SUB, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>Quick add</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {QUICK_BLOCKS.map((b, i) => (
          <button key={i} onClick={() => addBlock(b)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL, color: TEXT, fontSize: 12.5, cursor: 'pointer' }}>
            <Plus size={13} /> {b.label}
          </button>
        ))}
      </div>

      {intervals.map((it, idx) => (
        <IntervalRow key={it.id} interval={it}
          onChange={next => updateAt(idx, next)} onDelete={() => removeAt(idx)}
          onMoveUp={() => move(idx, -1)} onMoveDown={() => move(idx, 1)} onDuplicate={() => duplicateAt(idx)}
          first={idx === 0} last={idx === intervals.length - 1} />
      ))}
      {intervals.length === 0 && <div style={{ color: SUB, fontSize: 13, textAlign: 'center', padding: '20px 0', border: `1px dashed ${LINE}`, borderRadius: 10, marginBottom: 16 }}>No intervals yet \u2014 tap a quick add block above to start.</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        {editingWorkout && <button onClick={reset} style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: `1px solid ${LINE}`, background: PANEL2, color: SUB, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>}
        <button onClick={save} disabled={!name.trim() || intervals.length === 0}
          style={{ flex: 2, padding: '12px 0', borderRadius: 10, border: 'none', background: (!name.trim() || intervals.length === 0) ? MUTED : 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: (!name.trim() || intervals.length === 0) ? 'default' : 'pointer' }}>
          <Save size={17} /> {editingWorkout ? 'Save changes' : 'Save workout'}
        </button>
      </div>

      {customWorkouts.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>Your saved workouts</div>
          {customWorkouts.map(w => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: TEXT, fontWeight: 600 }}>{w.name}</div>
                <div style={{ fontSize: 12, color: SUB }}>{fmtLong(totalDuration(w.intervals))} · {w.category}</div>
              </div>
              <IconBtn onClick={() => { setName(w.name); setCategory(w.category); setDescription(w.description); setIntervals(w.intervals.map(i => ({ ...i }))); }}><Edit3 size={15} /></IconBtn>
              <IconBtn onClick={() => deleteCustomWorkout(w.id)} danger><Trash2 size={15} /></IconBtn>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// A rider is judged to have "stalled" on a ramp test once their power sits
// below this fraction of the current step's target for this many seconds
// in a row. Tune these two numbers to make the auto-stop more or less
// forgiving.
const RAMP_FAIL_WATT_RATIO = 0.8;
const RAMP_FAIL_SECONDS = 15;

function avgOf(samples) {
  if (!samples || samples.length === 0) return null;
  return Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
}

// ---------- player ----------
function PlayerView({ workout, ftp, settings, trainer, heartRate, onExit, onSaveFtpResult, onApplyFtp, onSessionEnd }) {
  const intervals = workout.intervals;
  const isRampTest = !!workout.autoStopTest;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(intervals[0].duration);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ftp, auto } once a ramp test ends
  const [ftpApplied, setFtpApplied] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // null | 'exit' | 'restart' \u2014 set while a confirm dialog is up
  const beepedRef = useRef(new Set());
  const wakeLockRef = useRef(null);
  const prevBleStatus = useRef(trainer.status);
  const trainerPowerRef = useRef(trainer.power);
  const heartRateRef = useRef(heartRate ? heartRate.bpm : null);
  const stepSamplesRef = useRef([]); // watt readings collected during the current ramp step
  const sessionPowerRef = useRef([]); // every watt reading for the whole session, for personal records
  const sessionHrRef = useRef([]); // every bpm reading for the whole session, for personal records
  const lastStepAvgRef = useRef(null); // average watts of the last fully-completed ramp step
  const underPowerStreakRef = useRef(0); // consecutive seconds under the fail threshold
  const triggerAutoStopRef = useRef(() => {});
  const loggedRef = useRef(false); // guards against logging the same session twice
  const halfwayPlayedRef = useRef(false); // guards the halfway chime from repeating
  const offTargetStreakRef = useRef(0); // consecutive seconds off-target, for the nudge tone
  const confettiRef = useRef([]); // randomized confetti pieces, generated once per celebration
  const [celebrate, setCelebrate] = useState(false);
  const { beep, chime } = useBeeper();

  // Elapsed time in seconds up to a given point in the workout \u2014 used both
  // for the on-screen progress bar and for what gets logged to history.
  function computeElapsedSeconds(atIndex = currentIndex, atTimeLeft = timeLeft) {
    const before = totalDuration(intervals.slice(0, atIndex));
    const cur = intervals[atIndex];
    return before + (cur.duration - Math.max(0, atTimeLeft));
  }
  function logSession(completed, durationOverride) {
    if (loggedRef.current) return;
    loggedRef.current = true;
    const powerSamples = sessionPowerRef.current;
    const hrSamples = sessionHrRef.current;
    if (onSessionEnd) {
      onSessionEnd({
        workoutId: workout.id || null,
        name: workout.name,
        category: workout.category || 'Custom',
        duration: durationOverride != null ? durationOverride : computeElapsedSeconds(),
        completed,
        avgPower: powerSamples.length ? avgOf(powerSamples) : null,
        maxPower: powerSamples.length ? Math.max(...powerSamples) : null,
        avgHr: hrSamples.length ? avgOf(hrSamples) : null,
        maxHr: hrSamples.length ? Math.max(...hrSamples) : null,
      });
    }
  }

  useEffect(() => { trainerPowerRef.current = trainer.power; }, [trainer.power]);
  useEffect(() => { heartRateRef.current = heartRate ? heartRate.bpm : null; }, [heartRate && heartRate.bpm]);

  // Always keep this pointed at a fresh version of the auto-stop logic so
  // the ticking interval below can call it without needing to restart
  // itself every time state/props it depends on change.
  triggerAutoStopRef.current = () => {
    const estimateFrom = lastStepAvgRef.current;
    setIsPlaying(false);
    setIsDone(true);
    logSession(true, computeElapsedSeconds());
    if (estimateFrom == null) return; // failed before completing a single tracked step \u2014 not enough data to guess FTP
    const mult = workout.ftpMultiplier || 0.75;
    const estimate = Math.round(estimateFrom * mult);
    setTestResult({ ftp: estimate, auto: true });
    if (onSaveFtpResult) onSaveFtpResult(estimate, workout.name);
  };

  useEffect(() => {
    if (!isPlaying || isDone) return;
    const t = setInterval(() => {
      setTimeLeft(prev => {
        const next = prev - 1;
        if (settings.soundCountdown && next > 0 && next <= 3 && !beepedRef.current.has(currentIndex + '_' + next)) {
          beepedRef.current.add(currentIndex + '_' + next);
          beep(660, 0.08, 0.08 * settings.soundVolume);
        }
        // Halfway-through-the-ride chime \u2014 fires once, whenever elapsed
        // time first crosses the midpoint of the whole workout.
        if (settings.soundHalfwayFinal && !halfwayPlayedRef.current) {
          const elapsedNow = computeElapsedSeconds(currentIndex, next);
          if (elapsedNow >= totalDuration(intervals) / 2) {
            halfwayPlayedRef.current = true;
            chime([{ freq: 740, duration: 0.14, delay: 0 }, { freq: 988, duration: 0.22, delay: 130 }], 0.16 * settings.soundVolume);
          }
        }
        return next;
      });
      // Collect every second's readings for the whole ride \u2014 used at the
      // end to work out this session's average/peak power and heart rate
      // for personal records. Independent of the ramp-test step tracking below.
      if (typeof trainerPowerRef.current === 'number') sessionPowerRef.current.push(trainerPowerRef.current);
      if (typeof heartRateRef.current === 'number') sessionHrRef.current.push(heartRateRef.current);
      // Off-target power nudge \u2014 a soft tick if power drifts well away
      // from the current interval's target for a sustained few seconds.
      // Opt-in and off by default since it can feel naggy.
      if (settings.soundOffTargetNudge && !isRampTest) {
        const curInterval = intervals[currentIndex];
        const power = trainerPowerRef.current;
        if (curInterval.type === 'power' && typeof power === 'number') {
          const targetWatts = Math.round((ftp * curInterval.target) / 100);
          const dev = targetWatts > 0 ? Math.abs(power - targetWatts) / targetWatts : 0;
          if (dev > 0.15) {
            offTargetStreakRef.current += 1;
            if (offTargetStreakRef.current >= 6) {
              beep(320, 0.06, 0.12 * settings.soundVolume);
              offTargetStreakRef.current = 0;
            }
          } else {
            offTargetStreakRef.current = 0;
          }
        }
      }
      // Ramp test: log the rider's actual watts each second and watch for
      // a sustained drop below the step's target, which means they've
      // stalled and the test should end for them.
      if (isRampTest) {
        const cur = intervals[currentIndex];
        const isRampStep = cur.label !== 'Warm up' && cur.label !== 'Cool down';
        const power = trainerPowerRef.current;
        if (isRampStep && typeof power === 'number') {
          stepSamplesRef.current.push(power);
          if (cur.type === 'power') {
            const targetWatts = Math.round((ftp * cur.target) / 100);
            const failThreshold = targetWatts * RAMP_FAIL_WATT_RATIO;
            underPowerStreakRef.current = power < failThreshold ? underPowerStreakRef.current + 1 : 0;
            if (underPowerStreakRef.current >= RAMP_FAIL_SECONDS) triggerAutoStopRef.current();
          }
        } else if (!isRampStep) {
          underPowerStreakRef.current = 0;
        }
      }
    }, 1000);
    return () => clearInterval(t);
  }, [isPlaying, isDone, currentIndex, settings.soundCountdown, settings.soundVolume, settings.soundHalfwayFinal, settings.soundOffTargetNudge, isRampTest, ftp]);

  useEffect(() => {
    if (timeLeft >= 0) return;
    if (currentIndex < intervals.length - 1) {
      if (settings.soundIntervalBeep) {
        const upcomingZone = zoneFor(intervals[currentIndex + 1]);
        const freq = settings.soundZoneTones ? (ZONE_TONE_FREQ[upcomingZone.name] || 880) : 880;
        beep(freq, 0.2, 0.2 * settings.soundVolume);
      }
      if (isRampTest) {
        const finishedStep = intervals[currentIndex];
        if (finishedStep.label !== 'Warm up' && finishedStep.label !== 'Cool down') {
          const avg = avgOf(stepSamplesRef.current);
          if (avg != null) lastStepAvgRef.current = avg;
        }
        stepSamplesRef.current = [];
        underPowerStreakRef.current = 0;
      }
      const next = currentIndex + 1;
      setCurrentIndex(next);
      setTimeLeft(intervals[next].duration);
    } else {
      if (settings.soundCompletion) {
        if (settings.soundRichFanfare) {
          chime([
            { freq: 784, duration: 0.16, delay: 0 },
            { freq: 988, duration: 0.16, delay: 140 },
            { freq: 1175, duration: 0.16, delay: 280 },
            { freq: 1568, duration: 0.5, delay: 420 },
          ], 0.2 * settings.soundVolume);
        } else {
          beep(1046, 0.45, 0.25 * settings.soundVolume);
        }
      }
      if (settings.visualCelebration) {
        confettiRef.current = Array.from({ length: 28 }).map((_, i) => ({
          id: i, left: Math.random() * 100, delay: Math.random() * 0.4, duration: 1.8 + Math.random() * 1.2,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], rotate: Math.random() * 360, size: 6 + Math.random() * 5,
        }));
        setCelebrate(true);
        setTimeout(() => setCelebrate(false), 2600);
      }
      setIsPlaying(false);
      setIsDone(true);
      logSession(true, totalDuration(intervals));
      if (isRampTest) {
        const finishedStep = intervals[currentIndex];
        const avg = finishedStep.label !== 'Warm up' && finishedStep.label !== 'Cool down' ? avgOf(stepSamplesRef.current) : null;
        if (avg != null) {
          const mult = workout.ftpMultiplier || 0.75;
          const estimate = Math.round(avg * mult);
          setTestResult({ ftp: estimate, auto: false });
          if (onSaveFtpResult) onSaveFtpResult(estimate, workout.name);
        }
      }
    }
  }, [timeLeft]);

  // Final-interval heads-up chime \u2014 fires whenever the ride enters its
  // last interval, whether by natural progression or a manual skip.
  useEffect(() => {
    if (settings.soundHalfwayFinal && intervals.length > 1 && currentIndex === intervals.length - 1) {
      chime([{ freq: 988, duration: 0.12, delay: 0 }, { freq: 1244, duration: 0.12, delay: 110 }, { freq: 1568, duration: 0.22, delay: 220 }], 0.16 * settings.soundVolume);
    }
  }, [currentIndex]);

  // ERG mode: push power target to trainer on interval change
  useEffect(() => {
    if (!settings.ergMode || trainer.status !== 'connected' || !trainer.hasControl) return;
    const current = intervals[currentIndex];
    if (current.type === 'power') trainer.setErgTarget(Math.round((ftp * current.target) / 100));
  }, [currentIndex, settings.ergMode, trainer.status, trainer.hasControl]);

  // auto-pause if trainer disconnects mid-ride
  useEffect(() => {
    if (prevBleStatus.current === 'connected' && trainer.status !== 'connected' && settings.autoPauseOnDisconnect && isPlaying) {
      setIsPlaying(false);
    }
    prevBleStatus.current = trainer.status;
  }, [trainer.status]);

  // keep screen awake while riding
  useEffect(() => {
    async function lock() {
      try {
        if (settings.keepAwake && isPlaying && navigator.wakeLock) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        }
      } catch (e) {}
    }
    if (isPlaying) lock();
    else if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
    return () => { if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; } };
  }, [isPlaying, settings.keepAwake]);

  function togglePlay() { setIsPlaying(p => !p); }
  function skip(dir) {
    const next = Math.min(intervals.length - 1, Math.max(0, currentIndex + dir));
    setCurrentIndex(next);
    setTimeLeft(intervals[next].duration);
    setIsDone(false);
    setTestResult(null);
    setFtpApplied(false);
    stepSamplesRef.current = [];
    underPowerStreakRef.current = 0;
    offTargetStreakRef.current = 0;
  }
  function restart() {
    setCurrentIndex(0); setTimeLeft(intervals[0].duration); setIsPlaying(false); setIsDone(false);
    beepedRef.current = new Set();
    setTestResult(null);
    setFtpApplied(false);
    stepSamplesRef.current = [];
    lastStepAvgRef.current = null;
    underPowerStreakRef.current = 0;
    offTargetStreakRef.current = 0;
    halfwayPlayedRef.current = false;
    setCelebrate(false);
    sessionPowerRef.current = [];
    sessionHrRef.current = [];
  }
  // Exit and restart both throw away an in-progress effort, so while the
  // workout is actively running we interrupt with a confirmation dialog
  // first. If it's paused (or already finished) there's nothing to lose by
  // stopping, so the action just happens right away.
  function requestAction(action) {
    if (isPlaying) {
      setIsPlaying(false); // pause while they decide \u2014 don't let the clock run out behind the dialog
      setPendingAction(action);
    } else {
      performAction(action);
    }
  }
  function performAction(action) {
    setPendingAction(null);
    if (action === 'exit') {
      if (!isDone) logSession(false);
      onExit();
    } else if (action === 'restart') {
      if (!isDone) logSession(false);
      restart();
      loggedRef.current = false; // the next attempt is a fresh session, allow it to be logged too
    }
  }
  function cancelPendingAction() {
    setPendingAction(null);
    setIsPlaying(true); // "keep riding" resumes right where they left off
  }

  const current = intervals[currentIndex];
  const next = intervals[currentIndex + 1];
  const z = zoneFor(current);
  const total = totalDuration(intervals);
  const elapsedBefore = totalDuration(intervals.slice(0, currentIndex));
  const elapsed = elapsedBefore + (current.duration - Math.max(0, timeLeft));
  const progress = Math.min(1, elapsed / total);
  const targetTxt = formatTarget(current, ftp, settings.targetDisplay);
  const currentPowerTxt = trainer.power !== null ? `${trainer.power}W` : '\u2013 W';

  const ringProgress = isDone ? 1 : Math.min(1, (current.duration - Math.max(0, timeLeft)) / current.duration);
  const targetWattsForGauge = current.type === 'power' ? Math.round((ftp * current.target) / 100) : 0;

  return (
    <div className="player-screen" style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', isolation: 'isolate' }}>
      {settings.visualZoneWash && (
        <div style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none', transition: 'background 1s ease', background: `radial-gradient(ellipse 80% 55% at 50% 15%, ${hexToRgba(z.color, isDone ? 0.08 : 0.22)} 0%, transparent 70%)` }} />
      )}
      {celebrate && <Confetti pieces={confettiRef.current} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexShrink: 0 }}>
        <button onClick={() => requestAction('exit')} style={{ background: 'none', border: 'none', color: SUB, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}><X size={18} /> Exit</button>
        <div style={{ fontSize: 13, color: SUB }}>{workout.name}</div>
      </div>

      <div className="player-main" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
        <div className="player-stats" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: z.color, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>
            {isDone ? (testResult ? (testResult.auto ? 'Test ended \u2014 that\u2019s your limit' : 'Ramp test complete') : 'Workout complete') : (current.label || z.name)}
          </div>
          {!isDone ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 14px', minWidth: 80 }}>
                <div style={{ fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}>Target</div>
                <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 18, fontWeight: 700, color: TEXT, marginTop: 2 }}>{targetTxt}</div>
              </div>

              <div className="ring-box" style={{ position: 'relative', width: settings.compactLabels ? 140 : 190, height: settings.compactLabels ? 140 : 190, display: 'flex', alignItems: 'center', justifyContent: 'center', isolation: 'isolate', flexShrink: 0 }}>
                {settings.visualProgressRing && (
                  <ProgressRing progress={ringProgress} color={z.color} size={settings.compactLabels ? 140 : 190} />
                )}
                <div className="player-timer" style={{ fontFamily: 'Space Mono, monospace', fontSize: settings.compactLabels ? 36 : 50, fontWeight: 700, color: TEXT, lineHeight: 1 }}>
                  {fmt(Math.max(0, timeLeft))}
                </div>
              </div>

              <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 14px', minWidth: 80 }}>
                <div style={{ fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}>Current</div>
                <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 18, fontWeight: 700, color: trainer.status === 'connected' ? 'var(--accent)' : TEXT, marginTop: 2 }}>{currentPowerTxt}</div>
              </div>
            </div>
          ) : (
            <div className="ring-box" style={{ position: 'relative', width: settings.compactLabels ? 150 : 200, height: settings.compactLabels ? 150 : 200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', isolation: 'isolate' }}>
              {settings.visualProgressRing && (
                <ProgressRing progress={1} color={z.color} size={settings.compactLabels ? 150 : 200} />
              )}
              <div className="player-timer" style={{ fontFamily: 'Space Mono, monospace', fontSize: settings.compactLabels ? 40 : 56, fontWeight: 700, color: TEXT, lineHeight: 1 }}>
                {testResult ? `${testResult.ftp}W` : fmtLong(total)}
              </div>
            </div>
          )}

          {!isDone && settings.visualPowerGauge && trainer.status === 'connected' && current.type === 'power' && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
              <PowerGauge power={trainer.power || 0} targetWatts={targetWattsForGauge} />
            </div>
          )}

          {!isDone && (trainer.status === 'connected' && trainer.cadence !== null || heartRate && heartRate.status === 'connected' && heartRate.bpm !== null) && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, fontSize: 12, color: SUB, marginTop: 8 }}>
              {trainer.status === 'connected' && trainer.cadence !== null && <span>{trainer.cadence} rpm</span>}
              {heartRate && heartRate.status === 'connected' && heartRate.bpm !== null && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><HeartPulse size={12} /> {heartRate.bpm} bpm</span>
              )}
            </div>
          )}

          {isDone && (
            <div style={{ fontSize: 16, color: SUB, marginTop: 6 }}>
              {testResult ? 'Estimated FTP \u2014 saved to your FTP history' : 'Nice work \u2014 log it and recover well.'}
            </div>
          )}

          {isDone && testResult && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <button
                onClick={() => { if (onApplyFtp) onApplyFtp(testResult.ftp); setFtpApplied(true); }}
                disabled={ftpApplied}
                style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: ftpApplied ? PANEL2 : 'var(--accent)', color: ftpApplied ? SUB : INK, fontWeight: 700, fontSize: 14, cursor: ftpApplied ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                {ftpApplied ? <Check size={16} /> : <Zap size={16} />} {ftpApplied ? 'FTP updated' : `Update my FTP to ${testResult.ftp}W`}
              </button>
            </div>
          )}

          {!isDone && next && settings.showNextPreview && (
            <div style={{ marginTop: 14, fontSize: 12.5, color: SUB }}>
              Up next: <span style={{ color: TEXT }}>{next.label}</span> · {fmt(next.duration)}
            </div>
          )}
        </div>

        <div className="player-controls">
          <div className="player-controls-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 }}>
            <IconBtn onClick={() => skip(-1)} disabled={currentIndex === 0}><SkipBack size={18} /></IconBtn>
            <button onClick={isDone ? () => requestAction('restart') : togglePlay} style={{ width: 58, height: 58, borderRadius: '50%', border: 'none', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              {isDone ? <RotateCcw size={24} color={INK} /> : isPlaying ? <Pause size={24} color={INK} fill={INK} /> : <Play size={24} color={INK} fill={INK} style={{ marginLeft: 3 }} />}
            </button>
            <IconBtn onClick={() => skip(1)} disabled={currentIndex === intervals.length - 1}><SkipForward size={18} /></IconBtn>
          </div>

          {!isDone && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
              <button onClick={() => requestAction('restart')} style={{ background: 'none', border: 'none', color: SUB, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 10px' }}>
                <RotateCcw size={13} /> Restart
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ flexShrink: 0, marginTop: 14 }}>
        <LiveTimeline intervals={intervals} elapsed={elapsed} total={total} />
      </div>

      {pendingAction && (
        <ConfirmModal
          title={pendingAction === 'exit' ? 'Exit workout?' : 'Restart workout?'}
          message="Your ride is still running \u2014 are you sure you want to continue?"
          cancelLabel="Keep riding"
          confirmLabel={pendingAction === 'exit' ? 'Exit' : 'Restart'}
          danger
          onCancel={cancelPendingAction}
          onConfirm={() => performAction(pendingAction)}
        />
      )}
    </div>
  );
}

// ---------- settings view ----------
function SettingsView({ settings, updateSetting, ftp, setFtp, trainer, heartRate, customWorkouts, onResetCustom, ftpHistory, onClearFtpHistory, onClose, account, daysLeft, subscribed, onLogout, onShowPaywall, ownerStats, stravaConnected, onConnectStrava, onDisconnectStrava }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const statusColor = trainer.status === 'connected' ? '#8FC93A' : trainer.status === 'connecting' ? '#FF9F40' : trainer.status === 'error' ? RED : SUB;
  const statusLabel = trainer.status === 'connected' ? `Connected \u00b7 ${trainer.deviceName}` : trainer.status === 'connecting' ? 'Connecting\u2026' : trainer.status === 'error' ? 'Connection failed' : 'Not connected';
  const hrStatusColor = heartRate.status === 'connected' ? '#8FC93A' : heartRate.status === 'connecting' ? '#FF9F40' : heartRate.status === 'error' ? RED : SUB;
  const hrStatusLabel = heartRate.status === 'connected' ? `Connected \u00b7 ${heartRate.deviceName}` : heartRate.status === 'connecting' ? 'Connecting\u2026' : heartRate.status === 'error' ? 'Connection failed' : 'Not connected';

  return (
    <div style={{ padding: '16px 16px 80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 26, fontWeight: 600, color: TEXT, letterSpacing: 0.3, marginBottom: 2 }}>Settings</div>
        {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', color: SUB, cursor: 'pointer', padding: 4 }}><X size={22} /></button>}
      </div>
      <div style={{ fontSize: 13, color: SUB, marginBottom: 4 }}>Trainer, sounds and how the app looks.</div>

      <SectionHeader icon={<Bluetooth size={16} color="var(--accent)" />} title="Trainer connectivity" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: 14, color: TEXT }}>{statusLabel}</div>
        {trainer.status === 'connected' ? (
          <button onClick={trainer.disconnect} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 13, cursor: 'pointer' }}>Disconnect</button>
        ) : (
          <button onClick={trainer.connect} disabled={trainer.status === 'connecting'} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Connect</button>
        )}
      </div>
      {!trainer.supported && (
        <div style={{ fontSize: 12, color: SUB, marginBottom: 6, lineHeight: 1.5 }}>
          Bluetooth isn't available here. This works in Chrome on desktop or Android with a trainer that supports the FTMS standard \u2014 not in Safari or iOS.
        </div>
      )}
      {trainer.errorMsg && <div style={{ fontSize: 12, color: RED, marginBottom: 6 }}>{trainer.errorMsg}</div>}
      <SettingRow label="ERG mode" sub="Trainer auto-sets resistance to match each interval's power target">
        <Switch checked={settings.ergMode} onChange={v => updateSetting('ergMode', v)} disabled={trainer.status !== 'connected' || !trainer.hasControl} />
      </SettingRow>
      <SettingRow label="Auto-pause on disconnect" sub="Pause the timer if the trainer connection drops mid-ride">
        <Switch checked={settings.autoPauseOnDisconnect} onChange={v => updateSetting('autoPauseOnDisconnect', v)} />
      </SettingRow>

      <SectionHeader icon={<HeartPulse size={16} color="var(--accent)" />} title="Heart rate monitor" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: hrStatusColor, flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: 14, color: TEXT }}>{hrStatusLabel}</div>
        {heartRate.status === 'connected' ? (
          <button onClick={heartRate.disconnect} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 13, cursor: 'pointer' }}>Disconnect</button>
        ) : (
          <button onClick={heartRate.connect} disabled={heartRate.status === 'connecting'} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Connect</button>
        )}
      </div>
      {!heartRate.supported && (
        <div style={{ fontSize: 12, color: SUB, marginBottom: 6, lineHeight: 1.5 }}>
          Bluetooth isn't available here. Works with any standard BLE chest strap or armband \u2014 Polar, Wahoo, Garmin and most others.
        </div>
      )}
      {heartRate.errorMsg && <div style={{ fontSize: 12, color: RED, marginBottom: 6 }}>{heartRate.errorMsg}</div>}
      <div style={{ fontSize: 12, color: SUB, marginBottom: 6, lineHeight: 1.5 }}>
        Separate from your trainer \u2014 pair it here once and it'll show up alongside power during every ride.
      </div>

      {STRAVA_CLIENT_ID ? (
        <>
          <SectionHeader icon={<LinkIcon size={16} color="var(--accent)" />} title="Strava" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: stravaConnected ? '#8FC93A' : SUB, flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 14, color: TEXT }}>{stravaConnected ? 'Connected' : 'Not connected'}</div>
            {stravaConnected ? (
              <button onClick={onDisconnectStrava} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 13, cursor: 'pointer' }}>Disconnect</button>
            ) : (
              <button onClick={onConnectStrava} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Connect</button>
            )}
          </div>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 6, lineHeight: 1.5 }}>
            Completed rides are pushed to your Strava account automatically once connected.
          </div>
        </>
      ) : null}

      <CollapsibleSection icon={<Volume2 size={16} color="var(--accent)" />} title="Sounds">
      <SettingRow label="Interval transition beep"><Switch checked={settings.soundIntervalBeep} onChange={v => updateSetting('soundIntervalBeep', v)} /></SettingRow>
      <SettingRow label="3-2-1 countdown beep"><Switch checked={settings.soundCountdown} onChange={v => updateSetting('soundCountdown', v)} /></SettingRow>
      <SettingRow label="Completion sound"><Switch checked={settings.soundCompletion} onChange={v => updateSetting('soundCompletion', v)} /></SettingRow>
      <div style={{ padding: '10px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: TEXT, marginBottom: 6 }}>
          <span>Volume</span><span style={{ color: SUB }}>{Math.round(settings.soundVolume * 100)}%</span>
        </div>
        <input type="range" min={0} max={1} step={0.05} value={settings.soundVolume}
          onChange={e => updateSetting('soundVolume', Number(e.target.value))}
          style={{ width: '100%', accentColor: settings.accentColor }} />
      </div>
      <div style={{ fontSize: 12.5, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 14, marginBottom: 2 }}>Ride cues</div>
      <SettingRow label="Distinct tone per zone" sub="Interval-change beep pitch matches the upcoming effort \u2014 low for recovery, sharp for anaerobic">
        <Switch checked={settings.soundZoneTones} onChange={v => updateSetting('soundZoneTones', v)} />
      </SettingRow>
      <SettingRow label="Halfway & final-interval chimes" sub="A soft chime at the workout's midpoint and again entering the last interval">
        <Switch checked={settings.soundHalfwayFinal} onChange={v => updateSetting('soundHalfwayFinal', v)} />
      </SettingRow>
      <SettingRow label="Richer finish fanfare" sub="A short rising jingle instead of a single beep when you finish">
        <Switch checked={settings.soundRichFanfare} onChange={v => updateSetting('soundRichFanfare', v)} />
      </SettingRow>
      <SettingRow label="Off-target power nudge" sub="A subtle tick if your power drifts well off target for a few seconds">
        <Switch checked={settings.soundOffTargetNudge} onChange={v => updateSetting('soundOffTargetNudge', v)} />
      </SettingRow>
      </CollapsibleSection>

      <CollapsibleSection icon={<Sun size={16} color="var(--accent)" />} title="Visuals">
      <div style={{ padding: '10px 0', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 14, color: TEXT, marginBottom: 8 }}>Appearance</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip active={settings.theme === 'palette'} onClick={() => updateSetting('theme', 'palette')}>Default</Chip>
          <Chip active={settings.theme === 'dark'} onClick={() => updateSetting('theme', 'dark')}><Moon size={12} style={{ marginRight: 5, verticalAlign: -2 }} />Dark</Chip>
          <Chip active={settings.theme === 'light'} onClick={() => updateSetting('theme', 'light')}><Sun size={12} style={{ marginRight: 5, verticalAlign: -2 }} />Light</Chip>
        </div>
      </div>
      <div style={{ padding: '10px 0', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 14, color: TEXT, marginBottom: 8 }}>Interval targets show as</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Chip active={settings.targetDisplay === 'both'} onClick={() => updateSetting('targetDisplay', 'both')}>Watts + % FTP</Chip>
          <Chip active={settings.targetDisplay === 'watts'} onClick={() => updateSetting('targetDisplay', 'watts')}>Watts only</Chip>
          <Chip active={settings.targetDisplay === 'percent'} onClick={() => updateSetting('targetDisplay', 'percent')}>% FTP only</Chip>
        </div>
      </div>
      <div style={{ padding: '10px 0', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 14, color: TEXT, marginBottom: 2 }}>Default orientation</div>
        <div style={{ fontSize: 12, color: SUB, marginBottom: 8, lineHeight: 1.5 }}>
          Landscape is recommended \u2014 it's designed for a device mounted on your bars. Portrait works but some screens will feel cramped or stretched.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Chip active={settings.preferredOrientation === 'landscape'} onClick={() => updateSetting('preferredOrientation', 'landscape')}>Landscape (recommended)</Chip>
          <Chip active={settings.preferredOrientation === 'portrait'} onClick={() => updateSetting('preferredOrientation', 'portrait')}>Portrait</Chip>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 14, marginBottom: 2 }}>Ride cues</div>
      <SettingRow label="Zone-colored background wash" sub="A subtle screen tint that shifts with the current effort zone">
        <Switch checked={settings.visualZoneWash} onChange={v => updateSetting('visualZoneWash', v)} />
      </SettingRow>
      <SettingRow label="Radial progress ring on timer" sub="A ring around the countdown that fills as the interval progresses">
        <Switch checked={settings.visualProgressRing} onChange={v => updateSetting('visualProgressRing', v)} />
      </SettingRow>
      <SettingRow label="Live power gauge dial" sub="A dial next to your stats showing power relative to target (needs a connected trainer)">
        <Switch checked={settings.visualPowerGauge} onChange={v => updateSetting('visualPowerGauge', v)} />
      </SettingRow>
      <SettingRow label="Finish-line celebration" sub="A brief confetti animation when you complete a workout">
        <Switch checked={settings.visualCelebration} onChange={v => updateSetting('visualCelebration', v)} />
      </SettingRow>
      <SettingRow label="Show next interval preview"><Switch checked={settings.showNextPreview} onChange={v => updateSetting('showNextPreview', v)} /></SettingRow>
      <SettingRow label="Compact timer" sub="Smaller countdown digits during a workout"><Switch checked={settings.compactLabels} onChange={v => updateSetting('compactLabels', v)} /></SettingRow>
      <SettingRow label="Keep screen awake" sub="Prevent the screen from sleeping while riding"><Switch checked={settings.keepAwake} onChange={v => updateSetting('keepAwake', v)} /></SettingRow>
      </CollapsibleSection>

      {account && (
        <>
          <SectionHeader icon={<Zap size={16} color="var(--accent)" />} title="Account & subscription" />
          <SettingRow label={account.name} sub={account.email}>
            <button onClick={onLogout} style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 12.5, cursor: 'pointer' }}>Log out</button>
          </SettingRow>
          <SettingRow label={subscribed ? 'Subscription \u2014 active' : `Free trial \u2014 ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`} sub={subscribed ? 'Manage billing or cancel from your Stripe receipt email' : 'No charge yet in this demo'}>
            {!subscribed && (
              <button onClick={onShowPaywall} style={{ padding: '7px 12px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Upgrade now</button>
            )}
          </SettingRow>
        </>
      )}

      <SectionHeader icon={<Gauge size={16} color="var(--accent)" />} title="General" />
      <SettingRow label="FTP" sub="Used to calculate watt targets from % FTP">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="number" value={ftp} onChange={e => setFtp(Math.max(50, Number(e.target.value) || 0))}
            style={{ width: 70, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '6px 8px', fontSize: 14 }} />
          <span style={{ fontSize: 13, color: SUB }}>W</span>
        </div>
      </SettingRow>
      {ftpHistory && ftpHistory.length > 0 && (
        <div style={{ padding: '10px 0', borderBottom: `1px solid ${LINE}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 14, color: TEXT }}>FTP test history</div>
            <button onClick={onClearFtpHistory} style={{ background: 'none', border: 'none', color: SUB, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Trash2 size={12} /> Clear
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ftpHistory.slice().reverse().slice(0, 10).map(entry => (
              <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: PANEL, borderRadius: 8, padding: '8px 10px' }}>
                <div>
                  <div style={{ fontSize: 13.5, color: TEXT, fontWeight: 600 }}>{entry.ftp}W</div>
                  <div style={{ fontSize: 11.5, color: SUB }}>{entry.source}</div>
                </div>
                <div style={{ fontSize: 11.5, color: SUB }}>{new Date(entry.date).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <SettingRow label="Custom workouts saved" sub={`${customWorkouts.length} workout${customWorkouts.length === 1 ? '' : 's'}`}>
        {!confirmReset ? (
          <button onClick={() => setConfirmReset(true)} disabled={customWorkouts.length === 0}
            style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: customWorkouts.length === 0 ? MUTED : RED, fontSize: 12.5, cursor: customWorkouts.length === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} /> Clear all
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { onResetCustom(); setConfirmReset(false); }} style={{ padding: '7px 10px', borderRadius: 8, border: 'none', background: RED, color: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Confirm</button>
            <button onClick={() => setConfirmReset(false)} style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
          </div>
        )}
      </SettingRow>

      {ownerStats && (
        <>
          <SectionHeader icon={<BarChart3 size={16} color="var(--accent)" />} title="Your dashboard (only visible to you)" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            {[
              { label: 'Total signups', value: ownerStats.total_users },
              { label: 'Active subscribers', value: ownerStats.subscribed_users },
              { label: 'On free trial', value: ownerStats.trial_users },
              { label: 'Trial expired, unpaid', value: ownerStats.expired_trial_users },
              { label: 'Signups, last 7 days', value: ownerStats.signups_last_7_days },
              { label: 'Signups, last 30 days', value: ownerStats.signups_last_30_days },
              { label: 'Rides, last 24h', value: ownerStats.rides_last_24h },
              { label: 'Rides, last 7 days', value: ownerStats.rides_last_7_days },
            ].map((c, i) => (
              <div key={i} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 10, color: SUB, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 18, fontWeight: 700, color: TEXT }}>{c.value ?? '\u2013'}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: SUB, marginBottom: 6 }}>{ownerStats.total_rides_logged} rides logged in total, across everyone.</div>
        </>
      )}
    </div>
  );
}

// ---------- auth screens ----------
function AuthShell({ children, footer }) {
  return (
    <div style={{ minHeight: '100%', background: BG, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '40px 20px', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ maxWidth: 380, width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 28 }}>
          <Zap size={22} color="var(--accent)" />
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: 600, color: TEXT, letterSpacing: 0.4 }}>Turbo Trainer</div>
        </div>
        {children}
        {footer && <div style={{ marginTop: 18, textAlign: 'center' }}>{footer}</div>}
      </div>
    </div>
  );
}
function AuthField({ label, ...props }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12.5, color: SUB, marginBottom: 5 }}>{label}</label>
      <input {...props} style={{ width: '100%', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, padding: '11px 12px', fontSize: 14.5, boxSizing: 'border-box' }} />
    </div>
  );
}
function AuthError({ children }) {
  if (!children) return null;
  return <div style={{ background: 'rgba(255,77,77,0.1)', border: `1px solid ${RED}`, color: RED, borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>{children}</div>;
}
function AuthNote({ children }) {
  return <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 12px', fontSize: 12, color: SUB, marginBottom: 12, lineHeight: 1.5 }}>{children}</div>;
}
function SocialAuthButtons({ onError }) {
  async function handleProvider(provider, label) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    // On success the browser is redirected away immediately, so there's
    // nothing further to do here. This only runs if something went wrong
    // before that redirect could happen (e.g. the provider isn't turned on
    // yet in the Supabase dashboard).
    if (error) onError(`${label} sign-in isn't available yet (${error.message}). Use email + password below instead.`);
  }
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      <button onClick={() => handleProvider('google', 'Google')} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Continue with Google</button>
      <button onClick={() => handleProvider('apple', 'Apple')} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Continue with Apple</button>
    </div>
  );
}

function LoginView({ onLogin, goSignup, goForgot }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [socialMsg, setSocialMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!isValidEmail(email)) { setError('Enter a valid email address.'); return; }
    if (!password) { setError('Enter your password.'); return; }
    setSubmitting(true);
    const result = await onLogin(email.trim().toLowerCase(), password);
    setSubmitting(false);
    if (result && result.error) setError(result.error);
  }

  return (
    <AuthShell footer={
      <div style={{ fontSize: 13, color: SUB }}>
        New here? <button onClick={goSignup} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 13 }}>Start your free trial</button>
      </div>
    }>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 19, color: TEXT, marginBottom: 16, textAlign: 'center' }}>Log in</div>
      <AuthError>{error}</AuthError>
      {socialMsg && <AuthNote>{socialMsg}</AuthNote>}
      <SocialAuthButtons onError={setSocialMsg} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 16px', color: SUB, fontSize: 11.5 }}>
        <div style={{ flex: 1, height: 1, background: LINE }} /> OR <div style={{ flex: 1, height: 1, background: LINE }} />
      </div>
      <form onSubmit={submit}>
        <AuthField label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        <AuthField label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autoComplete="current-password" />
        <div style={{ textAlign: 'right', marginBottom: 16 }}>
          <button type="button" onClick={goForgot} style={{ background: 'none', border: 'none', color: SUB, fontSize: 12.5, cursor: 'pointer', padding: 0 }}>Forgot password?</button>
        </div>
        <button type="submit" disabled={submitting} style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>{submitting ? 'Logging in\u2026' : 'Log in'}</button>
      </form>
    </AuthShell>
  );
}

function SignupView({ onSignup, goLogin }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [socialMsg, setSocialMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Enter your name.'); return; }
    if (!isValidEmail(email)) { setError('Enter a valid email address.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords don\u2019t match.'); return; }
    setSubmitting(true);
    const result = await onSignup(name.trim(), email.trim().toLowerCase(), password);
    setSubmitting(false);
    if (result && result.error) { setError(result.error); return; }
    if (result && result.needsConfirmation) { setConfirmSent(true); return; }
  }

  if (confirmSent) {
    return (
      <AuthShell footer={
        <button onClick={goLogin} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 13 }}>Back to log in</button>
      }>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 19, color: TEXT, marginBottom: 8, textAlign: 'center' }}>Check your email</div>
        <AuthNote>We've sent a confirmation link to {email}. Click it, then come back here and log in to start your {TRIAL_DAYS}-day free trial.</AuthNote>
      </AuthShell>
    );
  }

  return (
    <AuthShell footer={
      <div style={{ fontSize: 13, color: SUB }}>
        Already have an account? <button onClick={goLogin} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 13 }}>Log in</button>
      </div>
    }>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 19, color: TEXT, marginBottom: 4, textAlign: 'center' }}>Start your free trial</div>
      <div style={{ fontSize: 12.5, color: SUB, textAlign: 'center', marginBottom: 16 }}>{TRIAL_DAYS} days free, then {MONTHLY_PRICE_LABEL}. Cancel anytime.</div>
      <AuthError>{error}</AuthError>
      {socialMsg && <AuthNote>{socialMsg}</AuthNote>}
      <SocialAuthButtons onError={setSocialMsg} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 16px', color: SUB, fontSize: 11.5 }}>
        <div style={{ flex: 1, height: 1, background: LINE }} /> OR <div style={{ flex: 1, height: 1, background: LINE }} />
      </div>
      <form onSubmit={submit}>
        <AuthField label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
        <AuthField label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        <AuthField label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
        <AuthField label="Confirm password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Re-enter password" autoComplete="new-password" />
        <button type="submit" disabled={submitting} style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, cursor: submitting ? 'default' : 'pointer', marginTop: 4, opacity: submitting ? 0.7 : 1 }}>{submitting ? 'Creating account\u2026' : 'Start free trial'}</button>
        <div style={{ fontSize: 11, color: SUB, textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>No payment required today. We'll ask for card details only when your trial ends.</div>
      </form>
    </AuthShell>
  );
}

function ForgotPasswordView({ onReset, goLogin }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!isValidEmail(email)) { setError('Enter a valid email address.'); return; }
    setSubmitting(true);
    await onReset(email.trim().toLowerCase());
    setSubmitting(false);
    setSent(true);
  }

  return (
    <AuthShell footer={
      <button onClick={goLogin} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 13 }}>Back to log in</button>
    }>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 19, color: TEXT, marginBottom: 8, textAlign: 'center' }}>Reset your password</div>
      {sent ? (
        <AuthNote>If an account exists for that email, we've just sent a real password reset link to it. Click the link in that email to set a new password.</AuthNote>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: SUB, textAlign: 'center', marginBottom: 16 }}>Enter your email and we'll send you a link to reset your password.</div>
          <AuthError>{error}</AuthError>
          <form onSubmit={submit}>
            <AuthField label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            <button type="submit" disabled={submitting} style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>{submitting ? 'Sending\u2026' : 'Send reset link'}</button>
          </form>
        </>
      )}
    </AuthShell>
  );
}

function UpdatePasswordView({ onUpdate }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords don\u2019t match.'); return; }
    setSubmitting(true);
    const result = await onUpdate(password);
    setSubmitting(false);
    if (result && result.error) setError(result.error);
  }

  return (
    <AuthShell>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 19, color: TEXT, marginBottom: 4, textAlign: 'center' }}>Set a new password</div>
      <div style={{ fontSize: 12.5, color: SUB, textAlign: 'center', marginBottom: 16 }}>You followed a password reset link. Choose a new password below.</div>
      <AuthError>{error}</AuthError>
      <form onSubmit={submit}>
        <AuthField label="New password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
        <AuthField label="Confirm new password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Re-enter password" autoComplete="new-password" />
        <button type="submit" disabled={submitting} style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>{submitting ? 'Saving\u2026' : 'Save new password'}</button>
      </form>
    </AuthShell>
  );
}

// ---------- trial banner + paywall ----------
function TrialBanner({ daysLeft, onUpgrade }) {
  return (
    <div style={{ background: PANEL, borderBottom: `1px solid ${LINE}`, padding: '9px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
      <span style={{ color: SUB }}>
        <span style={{ color: TEXT, fontWeight: 600 }}>{daysLeft} day{daysLeft === 1 ? '' : 's'}</span> left in your free trial
      </span>
      <button onClick={onUpgrade} style={{ background: 'none', border: `1px solid var(--accent)`, color: 'var(--accent)', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Upgrade</button>
    </div>
  );
}

function PaywallView({ blocking, trialExpired, onClose, onLogout, userId, email }) {
  const [error, setError] = useState('');
  const [redirecting, setRedirecting] = useState(false);
  const [plan, setPlan] = useState('monthly');

  async function startCheckout() {
    setError('');
    setRedirecting(true);
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, email, plan }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start checkout.');
      window.location.href = data.url; // send them to Stripe's hosted checkout page
    } catch (err) {
      setError(err.message || 'Something went wrong starting checkout. Please try again.');
      setRedirecting(false);
    }
  }

  const priceLabel = plan === 'annual' ? ANNUAL_PRICE_LABEL : MONTHLY_PRICE_LABEL;

  const body = (
    <div style={{ maxWidth: 420, width: '100%', margin: '0 auto', padding: '20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 18 }}>
        <Zap size={20} color="var(--accent)" />
        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 19, color: TEXT }}>{trialExpired ? 'Your free trial has ended' : 'Upgrade to keep riding'}</div>
      </div>
      <div style={{ fontSize: 13, color: SUB, textAlign: 'center', marginBottom: 20 }}>
        {trialExpired ? 'Subscribe to keep access to your workouts and the trainer connection.' : 'Lock in your subscription now so there\u2019s no interruption when your trial ends.'}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={() => setPlan('monthly')} style={{ flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${plan === 'monthly' ? 'var(--accent)' : LINE}`, background: plan === 'monthly' ? PANEL2 : 'transparent', cursor: 'pointer' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Monthly</div>
          <div style={{ fontSize: 12, color: SUB }}>{MONTHLY_PRICE_LABEL}</div>
        </button>
        <button onClick={() => setPlan('annual')} style={{ flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${plan === 'annual' ? 'var(--accent)' : LINE}`, background: plan === 'annual' ? PANEL2 : 'transparent', cursor: 'pointer', position: 'relative' }}>
          <div style={{ position: 'absolute', top: -9, right: 10, fontSize: 9.5, fontWeight: 700, color: INK, background: 'var(--accent)', borderRadius: 999, padding: '2px 7px' }}>2 MONTHS FREE</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Annual</div>
          <div style={{ fontSize: 12, color: SUB }}>{ANNUAL_PRICE_LABEL}</div>
        </button>
      </div>

      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>Turbo Trainer \u2014 {plan === 'annual' ? 'Annual' : 'Monthly'}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{priceLabel}</div>
        </div>
        <div style={{ fontSize: 12, color: SUB, lineHeight: 1.6 }}>
          Full workout library · Custom workout builder · Trainer &amp; sensor connectivity · FTP testing &amp; history
        </div>
      </div>

      <AuthNote>You'll be taken to Stripe's secure checkout page to enter your card details. Your card number never touches this app or its database. Have a promo code? There's a field for it on that page.</AuthNote>
      <AuthError>{error}</AuthError>

      <button onClick={startCheckout} disabled={redirecting} style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, cursor: redirecting ? 'default' : 'pointer', marginTop: 6, opacity: redirecting ? 0.7 : 1 }}>
        {redirecting ? 'Redirecting to checkout\u2026' : `Subscribe \u2014 ${priceLabel}`}
      </button>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 16 }}>
        {!blocking && <button onClick={onClose} style={{ background: 'none', border: 'none', color: SUB, fontSize: 12.5, cursor: 'pointer' }}>Not now</button>}
        <button onClick={onLogout} style={{ background: 'none', border: 'none', color: SUB, fontSize: 12.5, cursor: 'pointer' }}>Log out</button>
      </div>
    </div>
  );

  if (!blocking) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} style={{ background: BG, width: '100%', maxWidth: 520, borderRadius: '18px 18px 0 0', border: `1px solid ${LINE}`, borderBottom: 'none', padding: '10px 20px 24px', maxHeight: '90vh', overflowY: 'auto' }}>
          {body}
        </div>
      </div>
    );
  }
  return <div style={{ minHeight: '100%', background: BG, padding: '20px 20px 40px', fontFamily: 'Inter, sans-serif' }}>{body}</div>;
}

// ---------- orientation gate ----------
function useOrientation() {
  const [isPortrait, setIsPortrait] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(orientation: portrait)').matches : false));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(orientation: portrait)');
    const handler = e => setIsPortrait(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', handler); else mq.addListener(handler);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', handler); else mq.removeListener(handler); };
  }, []);
  return isPortrait;
}

function OrientationGate({ preferredOrientation, children }) {
  const isPortrait = useOrientation();
  const [dismissed, setDismissed] = useState(false);

  // Best-effort real lock: only works in some installed/fullscreen Android
  // Chrome contexts. iOS Safari does not support the Orientation Lock API
  // at all, so this is a courtesy overlay + toggle, not a hard guarantee.
  useEffect(() => {
    try {
      if (preferredOrientation === 'landscape' && screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (e) {}
  }, [preferredOrientation]);

  const showPrompt = preferredOrientation === 'landscape' && isPortrait && !dismissed;

  return (
    <>
      {children}
      {showPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: BG, zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 42, marginBottom: 14, transform: 'rotate(90deg)' }}>\ud83d\udcf1</div>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 19, color: TEXT, marginBottom: 8 }}>Rotate your device</div>
          <div style={{ fontSize: 13.5, color: SUB, maxWidth: 320, lineHeight: 1.6, marginBottom: 22 }}>
            This app is designed for landscape \u2014 it's easier to read your timer and chart when your device is mounted on the bars. Turn your device sideways for the best experience.
          </div>
          <button onClick={() => setDismissed(true)} style={{ padding: '11px 20px', borderRadius: 10, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 13.5, cursor: 'pointer' }}>
            Continue in portrait anyway
          </button>
          <div style={{ fontSize: 11.5, color: SUB, marginTop: 10, maxWidth: 280 }}>Some screens may look cramped or stretched in portrait. You can change your default under Settings \u2192 Visuals.</div>
        </div>
      )}
    </>
  );
}

// ---------- app ----------
export default function App() {
  const [view, setView] = useState('home');
  const [ftp, setFtpState] = useState(200);
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [customWorkouts, setCustomWorkouts] = useState([]);
  const [ftpHistory, setFtpHistory] = useState([]);
  const [workoutHistory, setWorkoutHistory] = useState([]);
  const [detailWorkout, setDetailWorkout] = useState(null);
  const [editingWorkout, setEditingWorkout] = useState(null);
  const [activeWorkout, setActiveWorkout] = useState(null);
  const trainer = useTrainer();
  const heartRate = useHeartRate();

  // Keep the browser/OS chrome (e.g. the address bar tint on mobile) in
  // sync with whichever theme is active, not just the in-page colors.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', (THEMES[settings.theme] || THEMES.dark).bg);
  }, [settings.theme]);

  // ---- account / trial / subscription, backed by Supabase ----
  const [user, setUser] = useState(null); // Supabase auth user (id, email, ...)
  const [profile, setProfile] = useState(null); // row from public.profiles for this user
  const [authLoading, setAuthLoading] = useState(true); // checking for an existing session
  const [profileLoading, setProfileLoading] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false); // arrived via a "reset password" email link
  const [authScreen, setAuthScreen] = useState('login'); // 'login' | 'signup' | 'forgot'
  const [showPaywallModal, setShowPaywallModal] = useState(false);

  // Watch for an existing/changing Supabase session (login, logout, token
  // refresh, or arriving here from a "reset your password" email link).
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setUser(session ? session.user : null);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      setUser(session ? session.user : null);
      setAuthLoading(false);
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  // Once we know who's logged in, load their profile + saved data from the database.
  const [ownerStats, setOwnerStats] = useState(null); // non-null only when logged in as the app owner
  useEffect(() => {
    if (!user) { setProfile(null); setCustomWorkouts([]); setFtpHistory([]); setWorkoutHistory([]); setOwnerStats(null); return; }
    let mounted = true;
    (async () => {
      setProfileLoading(true);
      let { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (!prof) {
        // Fallback in case the sign-up trigger hasn't caught up yet.
        const { data: created } = await supabase.from('profiles')
          .insert({ id: user.id, name: user.user_metadata?.name || '', trial_start: new Date().toISOString() })
          .select().maybeSingle();
        prof = created;
      }
      if (!mounted) return;
      if (prof) {
        setProfile(prof);
        setFtpState(prof.ftp || 200);
        setSettingsState({ ...DEFAULT_SETTINGS, ...(prof.settings || {}) });
      }
      const { data: workouts } = await supabase.from('custom_workouts').select('*').eq('user_id', user.id).order('created_at', { ascending: true });
      if (mounted && workouts) setCustomWorkouts(workouts.map(w => w.workout));
      const { data: history } = await supabase.from('ftp_history').select('*').eq('user_id', user.id).order('date', { ascending: true });
      if (mounted && history) setFtpHistory(history.map(h => ({ id: h.id, date: h.date, ftp: h.ftp, source: h.source })));
      const { data: sessions } = await supabase.from('workout_history').select('*').eq('user_id', user.id).order('date', { ascending: true });
      if (mounted && sessions) setWorkoutHistory(sessions.map(s => ({ id: s.id, date: s.date, workoutId: s.workout_id, name: s.name, category: s.category, duration: s.duration, completed: s.completed, avgPower: s.avg_power, maxPower: s.max_power, avgHr: s.avg_hr, maxHr: s.max_hr })));
      // Returns real numbers only when logged in as the app owner (checked
      // server-side by email) -- everyone else gets null back, silently.
      const { data: stats } = await supabase.rpc('admin_dashboard_stats');
      if (mounted) setOwnerStats(stats || null);
      if (mounted) setProfileLoading(false);
    })();
    return () => { mounted = false; };
  }, [user]);

  // ftp/settings are kept as simple local state (so the rest of the app is
  // unchanged) but every update is also pushed to the person's profile row.
  function setFtp(value) {
    setFtpState(value);
    if (user) supabase.from('profiles').update({ ftp: value }).eq('id', user.id).then(() => {});
  }
  function updateSetting(key, value) {
    setSettingsState(s => {
      const next = { ...s, [key]: value };
      if (user) supabase.from('profiles').update({ settings: next }).eq('id', user.id).then(() => {});
      return next;
    });
  }

  async function handleSignup(name, email, password) {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { name }, emailRedirectTo: window.location.origin },
    });
    if (error) return { error: error.message };
    if (!data.session) return { needsConfirmation: true }; // this Supabase project requires email confirmation
    return {};
  }
  async function handleLogin(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  }
  function handleLogout() {
    supabase.auth.signOut();
    setShowPaywallModal(false);
    setAuthScreen('login');
  }
  async function handleForgotPassword(email) {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  }
  async function handleUpdatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    setRecoveryMode(false);
    return {};
  }
  // After a successful Stripe Checkout, the browser is sent back here with
  // ?checkout=success in the URL. Stripe's webhook (see /api/stripe-webhook.js)
  // updates the "subscribed" flag in the database independently and slightly
  // ahead of or behind this redirect, so we poll the profile a few times to
  // pick up that change without requiring a manual page reload.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'success') return;
    window.history.replaceState({}, '', window.location.pathname);
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts += 1;
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (prof?.subscribed) {
        setProfile(prof);
        setShowPaywallModal(false);
        clearInterval(poll);
      } else if (attempts >= 8) {
        clearInterval(poll); // give up after ~16s; webhook may just be slow
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [user]);

  // Strava sends people back here with ?code=... after they approve the
  // connection. The sessionStorage flag (set right before we redirect them
  // to Strava) is how we tell that apart from any other use of ?code= on
  // this page, e.g. a Google/Apple login in progress.
  useEffect(() => {
    if (!user || !STRAVA_CLIENT_ID) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code || sessionStorage.getItem('stravaOAuthPending') !== '1') return;
    sessionStorage.removeItem('stravaOAuthPending');
    window.history.replaceState({}, '', window.location.pathname);
    (async () => {
      try {
        const res = await fetch('/api/strava-connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, code }),
        });
        if (res.ok) {
          const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
          if (prof) setProfile(prof);
        }
      } catch (e) {}
    })();
  }, [user]);

  function connectStrava() {
    if (!STRAVA_CLIENT_ID) return;
    sessionStorage.setItem('stravaOAuthPending', '1');
    const redirectUri = window.location.origin + window.location.pathname;
    const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=auto&scope=activity:write`;
    window.location.href = url;
  }
  async function disconnectStrava() {
    if (!user) return;
    await fetch('/api/strava-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, disconnect: true }),
    });
    setProfile(p => (p ? { ...p, strava_athlete_id: null } : p));
  }

  // Called by the player whenever an FTP test finishes (either the rider
  // stalled and the app ended it automatically, or they rode it to the end).
  function recordFtpResult(value, source) {
    const entry = { id: newId(), date: new Date().toISOString(), ftp: value, source };
    setFtpHistory(list => [...list, entry]);
    if (user) supabase.from('ftp_history').insert({ id: entry.id, user_id: user.id, ftp: value, source, date: entry.date }).then(() => {});
  }
  function clearFtpHistory() {
    setFtpHistory([]);
    if (user) supabase.from('ftp_history').delete().eq('user_id', user.id).then(() => {});
  }
  // Called once per session by the player, either when a workout finishes
  // naturally or when the rider confirms exiting/restarting partway through.
  function recordWorkoutSession({ workoutId, name, category, duration, completed, avgPower, maxPower, avgHr, maxHr }) {
    const entry = { id: newId(), date: new Date().toISOString(), workoutId, name, category, duration, completed, avgPower, maxPower, avgHr, maxHr };
    setWorkoutHistory(list => [...list, entry]);
    if (user) supabase.from('workout_history').insert({
      id: entry.id, user_id: user.id, workout_id: workoutId, name, category, duration, completed, date: entry.date,
      avg_power: avgPower ?? null, max_power: maxPower ?? null, avg_hr: avgHr ?? null, max_hr: maxHr ?? null,
    }).then(() => {});
    // Only push genuinely finished rides of real length to Strava \u2014 not
    // aborted attempts \u2014 and only for people who've connected their account.
    if (user && completed && duration >= 60 && profile && profile.strava_athlete_id) {
      fetch('/api/strava-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, name, durationSeconds: duration, date: entry.date, avgPower, maxPower, avgHr, maxHr }),
      }).catch(() => {});
    }
  }
  function clearWorkoutHistory() {
    setWorkoutHistory([]);
    if (user) supabase.from('workout_history').delete().eq('user_id', user.id).then(() => {});
  }

  function saveCustomWorkout(workout) {
    setCustomWorkouts(list => {
      const exists = list.some(w => w.id === workout.id);
      const next = exists ? list.map(w => (w.id === workout.id ? workout : w)) : [...list, workout];
      return next;
    });
    if (user) supabase.from('custom_workouts').upsert({ id: workout.id, user_id: user.id, workout }).then(() => {});
    setView('library');
  }
  function deleteCustomWorkout(id) {
    setCustomWorkouts(list => list.filter(w => w.id !== id));
    if (user) supabase.from('custom_workouts').delete().eq('id', id).eq('user_id', user.id).then(() => {});
    setDetailWorkout(null);
  }
  function resetCustomWorkouts() {
    setCustomWorkouts([]);
    if (user) supabase.from('custom_workouts').delete().eq('user_id', user.id).then(() => {});
  }

  const theme = THEMES[settings.theme] || THEMES.dark;
  const themeVars = {
    '--bg': theme.bg, '--panel': theme.panel, '--panel2': theme.panel2, '--line': theme.line,
    '--text': theme.text, '--sub': theme.sub, '--red': theme.red, '--muted': theme.muted, '--navbg': theme.navbg,
    // NEW
    '--hero1': theme.hero1, '--hero1-ink': theme.hero1ink, '--hero1-chip': theme.hero1chip,
    '--hero2': theme.hero2, '--hero2-ink': theme.hero2ink, '--hero2-chip': theme.hero2chip,
    '--flame': theme.flame,
  };
  const themeCss = Object.entries(themeVars).map(([k, v]) => `${k}:${v};`).join('');
  const globalStyle = "@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Space+Mono:wght@700&family=Inter:wght@400;500;600&display=swap');"
    + " :root { " + themeCss + " }"
    + " html, body, #root { height: 100%; }"
    + " input:focus, select:focus { outline: 1px solid var(--accent); }"
    + " ::-webkit-scrollbar { width: 4px; height: 4px; } ::-webkit-scrollbar-thumb { background: " + LINE + "; border-radius: 4px; }"
    // bottom tab bar: keep clear of notches / home-indicator gestures in
    // both orientations, and compact itself on short landscape screens
    + " .tabbar { padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); padding-bottom: env(safe-area-inset-bottom); }"
    + " .tabbar-btn { padding: 8px 0; } .tabbar-btn span { white-space: nowrap; }"
    + " @media (orientation: landscape) and (max-height: 480px) { .tabbar-btn { padding: 4px 0; } .tabbar-btn svg { width: 15px; height: 15px; } .tabbar-btn span { font-size: 9px; } }"
    // in-workout screen: fill the real viewport height so nothing needs to
    // scroll to be seen, and lay stats/controls out side-by-side once the
    // phone is rotated to landscape (mounted on the bars) instead of stacked
    + " .player-screen { height: 100vh; height: 100dvh; box-sizing: border-box; }"
    + " .player-main { flex: 1; min-height: 0; overflow: auto; }"
    + " @media (orientation: landscape) { .player-main { flex-direction: row !important; align-items: center; justify-content: center; gap: 20px; } .player-stats { flex: 1 1 auto; max-width: 560px; } .player-controls { flex: 0 0 auto; } }"
    + " @media (orientation: landscape) and (max-height: 420px) { .player-timer { font-size: 38px !important; } .ring-box { width: 120px !important; height: 120px !important; } .ring-box svg { width: 120px !important; height: 120px !important; } .player-controls-row { margin-top: 6px !important; } }"
    // finish-line celebration confetti
    + " @keyframes confetti-fall { 0% { transform: translateY(-20px) rotate(0deg); opacity: 1; } 100% { transform: translateY(420px) rotate(600deg); opacity: 0; } }";
  const wrapStyle = { '--accent': theme.accent || settings.accentColor, ...themeVars, background: BG, minHeight: '100%', fontFamily: 'Inter, sans-serif' };

  if (authLoading) {
    return <div style={wrapStyle}><style>{globalStyle}</style></div>;
  }

  // ---- arrived via a "reset your password" email link ----
  if (recoveryMode) {
    return (
      <div style={wrapStyle}>
        <style>{globalStyle}</style>
        <UpdatePasswordView onUpdate={handleUpdatePassword} />
      </div>
    );
  }

  // ---- gate 1: not logged in \u2192 auth flow ----
  if (!user) {
    return (
      <div style={wrapStyle}>
        <style>{globalStyle}</style>
        {authScreen === 'login' && <LoginView onLogin={handleLogin} goSignup={() => setAuthScreen('signup')} goForgot={() => setAuthScreen('forgot')} />}
        {authScreen === 'signup' && <SignupView onSignup={handleSignup} goLogin={() => setAuthScreen('login')} />}
        {authScreen === 'forgot' && <ForgotPasswordView onReset={handleForgotPassword} goLogin={() => setAuthScreen('login')} />}
      </div>
    );
  }

  if (profileLoading || !profile) {
    return <div style={wrapStyle}><style>{globalStyle}</style></div>;
  }

  const account = { name: profile.name || user.user_metadata?.name || 'Rider', email: user.email };
  const subscribed = !!profile.subscribed;
  const daysLeft = daysLeftInTrial(profile.trial_start);
  const trialExpired = daysLeft <= 0;

  // ---- gate 2: trial over and never subscribed \u2192 blocking paywall ----
  if (trialExpired && !subscribed) {
    return (
      <div style={wrapStyle}>
        <style>{globalStyle}</style>
        <PaywallView blocking trialExpired onLogout={handleLogout} userId={user.id} email={user.email} />
      </div>
    );
  }

  if (activeWorkout) {
    return (
      <div style={wrapStyle}>
        <style>{globalStyle}</style>
        <OrientationGate preferredOrientation={settings.preferredOrientation}>
          <PlayerView workout={activeWorkout} ftp={ftp} settings={settings} trainer={trainer} heartRate={heartRate} onExit={() => setActiveWorkout(null)} onSaveFtpResult={recordFtpResult} onApplyFtp={setFtp} onSessionEnd={recordWorkoutSession} />
        </OrientationGate>
      </div>
    );
  }

  return (
    <div style={{ ...wrapStyle, position: 'relative', paddingBottom: 'calc(54px + env(safe-area-inset-bottom))' }}>
      <style>{globalStyle}</style>
      <OrientationGate preferredOrientation={settings.preferredOrientation}>
        {!subscribed && <TrialBanner daysLeft={daysLeft} onUpgrade={() => setShowPaywallModal(true)} />}

        {view === 'home' && <HomeView account={account} ftpHistory={ftpHistory} workoutHistory={workoutHistory} onNavigate={setView} />}
        {view === 'library' && <LibraryView customWorkouts={customWorkouts} onOpen={setDetailWorkout} />}
        {view === 'basics' && <LibraryView customWorkouts={customWorkouts} onOpen={setDetailWorkout} lockedCategory="Basics" title="Basics" />}
        {view === 'rides' && <LibraryView customWorkouts={customWorkouts} onOpen={setDetailWorkout} lockedCategory="Rides" title="Rides" />}
        {view === 'builder' && <BuilderView customWorkouts={customWorkouts} saveCustomWorkout={saveCustomWorkout} deleteCustomWorkout={deleteCustomWorkout} editingWorkout={editingWorkout} clearEditing={() => setEditingWorkout(null)} />}
        {view === 'ftp' && <FtpView ftp={ftp} setFtp={setFtp} ftpHistory={ftpHistory} onClearFtpHistory={clearFtpHistory} onOpenWorkout={setDetailWorkout} />}
        {view === 'history' && <HistoryView workoutHistory={workoutHistory} onClear={clearWorkoutHistory} />}
        {view === 'settings' && (
          <SettingsView
            settings={settings} updateSetting={updateSetting} ftp={ftp} setFtp={setFtp} trainer={trainer} heartRate={heartRate}
            customWorkouts={customWorkouts} onResetCustom={resetCustomWorkouts} ftpHistory={ftpHistory} onClearFtpHistory={clearFtpHistory}
            account={account} daysLeft={daysLeft} subscribed={subscribed} onLogout={handleLogout} onShowPaywall={() => setShowPaywallModal(true)}
            ownerStats={ownerStats}
            stravaConnected={!!(profile && profile.strava_athlete_id)} onConnectStrava={connectStrava} onDisconnectStrava={disconnectStrava}
          />
        )}

        {detailWorkout && (
          <WorkoutDetail
            workout={detailWorkout} ftp={ftp} setFtp={setFtp} settings={settings}
            isCustom={customWorkouts.some(w => w.id === detailWorkout.id)}
            onClose={() => setDetailWorkout(null)}
            onStart={(w) => { setActiveWorkout(w); setDetailWorkout(null); }}
            onEdit={() => { setEditingWorkout(detailWorkout); setDetailWorkout(null); setView('builder'); }}
            onDelete={() => deleteCustomWorkout(detailWorkout.id)}
            onSaveScaled={(w) => { saveCustomWorkout(w); setDetailWorkout(null); }}
          />
        )}

        {showPaywallModal && (
          <PaywallView onClose={() => setShowPaywallModal(false)} onLogout={handleLogout} userId={user.id} email={user.email} />
        )}

        <div className="tabbar" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: NAVBG, borderTop: `1px solid ${LINE}`, display: 'flex', maxWidth: 520, margin: '0 auto' }}>
          <button onClick={() => setView('home')} className="tabbar-btn" style={{ flex: 1, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: view === 'home' ? 'var(--accent)' : SUB, cursor: 'pointer' }}>
            <Home size={18} /><span style={{ fontSize: 10, fontWeight: 600 }}>Home</span>
          </button>
          <button onClick={() => setView('library')} className="tabbar-btn" style={{ flex: 1, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: view === 'library' ? 'var(--accent)' : SUB, cursor: 'pointer' }}>
            <Library size={18} /><span style={{ fontSize: 10, fontWeight: 600 }}>Library</span>
          </button>
          <button onClick={() => setView('basics')} className="tabbar-btn" style={{ flex: 1, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: view === 'basics' ? 'var(--accent)' : SUB, cursor: 'pointer' }}>
            <Dumbbell size={18} /><span style={{ fontSize: 10, fontWeight: 600 }}>Basics</span>
          </button>
          <button onClick={() => setView('rides')} className="tabbar-btn" style={{ flex: 1, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: view === 'rides' ? 'var(--accent)' : SUB, cursor: 'pointer' }}>
            <Bike size={18} /><span style={{ fontSize: 10, fontWeight: 600 }}>Rides</span>
          </button>
          <button onClick={() => { setEditingWorkout(null); setView('builder'); }} className="tabbar-btn" style={{ flex: 1, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: view === 'builder' ? 'var(--accent)' : SUB, cursor: 'pointer' }}>
            <Wrench size={18} /><span style={{ fontSize: 10, fontWeight: 600 }}>Builder</span>
          </button>
          <button onClick={() => setView('settings')} className="tabbar-btn" style={{ flex: 1, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: view === 'settings' ? 'var(--accent)' : SUB, cursor: 'pointer' }}>
            <SettingsIcon size={18} /><span style={{ fontSize: 10, fontWeight: 600 }}>Settings</span>
          </button>
        </div>
      </OrientationGate>
    </div>
  );
}
