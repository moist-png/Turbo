import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useContext, Suspense, lazy } from 'react';
import {
  Play, Pause, SkipForward, SkipBack, RotateCcw, X, Plus, Trash2, ChevronUp, ChevronDown, ChevronRight,
  Search, Library, Wrench, Gauge, Save, Edit3, Copy, Settings as SettingsIcon, Bluetooth,
  BluetoothOff, Volume2, Sun, Moon, RefreshCw, Check, Zap, ChevronDown as ChevDown, Bike, Dumbbell, Home,
  Trophy, HeartPulse, Upload, Flame, Link as LinkIcon, CalendarDays, BarChart3, Locate, Download,
  Target, Flag, TrendingUp, Gamepad2, Mountain, Smartphone, LogOut, Star, ListOrdered, MessageSquare, GripVertical, Skull, Info,
  MoreHorizontal,
} from 'lucide-react';
import { supabase } from './supabaseClient';
// planner.js (the logic module) stays an ordinary import -- WORKOUT_PURPOSE
// etc. are needed the moment the library renders. Only the *screens* below
// are loaded on demand: each becomes its own file that the browser fetches
// the first time that screen is opened, instead of everyone paying for all
// of them up front. MiniGames and Feedback use named exports, so each lazy
// wrapper picks its component out of the loaded module.
import { currentPlanWeek, PHASE, WORKOUT_PURPOSE, estimateOutdoorTss } from './planner';
import { TrboMark } from './PublicPages';
import {
  isNative, isNativeBle, nativeRequestAndConnect, nativeScanForDevices, nativeConnectDevice, nativeStartNotifications, nativeWrite, nativeDisconnect, uuid16,
  nativeOpenAuthUrl, nativeCloseAuthUrl, nativeOnAuthCallback,
} from './nativeBle';
import { ColorblindContext } from './colorblindContext';

const PlannerView = lazy(() => import('./PlannerView'));
const MiniGamesView = lazy(() => import('./MiniGames').then(m => ({ default: m.MiniGamesView })));
const MiniGamePlayer = lazy(() => import('./MiniGames').then(m => ({ default: m.MiniGamePlayer })));
const FeedbackView = lazy(() => import('./Feedback'));
const FeedbackHeroCard = lazy(() => import('./Feedback').then(m => ({ default: m.FeedbackHeroCard })));

// Minimal centered spinner shown for the moment a lazy screen's file is
// still being fetched. In the native apps the chunks are local files, so
// this is rarely visible for more than a frame.
function LazyFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
      <style>{'@keyframes trboSpin { to { transform: rotate(360deg); } }'}</style>
      <div style={{ width: 28, height: 28, border: '3px solid rgba(47,197,174,0.25)', borderTopColor: '#2FC5AE', borderRadius: '50%', animation: 'trboSpin 0.8s linear infinite' }} aria-label="Loading" />
    </div>
  );
}

// Calls one of our own /api/... functions the same way fetch() does, but
// first attaches the current sign-in token (if there is one) as a standard
// Authorization header. Those functions use that token to confirm who's
// really asking -- so this is what lets checkout, and connecting/uploading
// to Strava, work at all now that they no longer just take our word for
// which account is calling.
async function apiFetch(url, options = {}) {
  const { data: { session } = {} } = await supabase.auth.getSession();
  const headers = { ...(options.headers || {}) };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return fetch(url, { ...options, headers });
}

// Every column the app's UI actually reads off a profile row. Deliberately
// leaves out strava_access_token, strava_refresh_token, and
// strava_token_expires_at -- those are live Strava credentials that only
// ever need to be read or written server-side (api/strava-connect.js,
// api/strava-upload.js, using the service-role key), never by the browser.
// Also leaves out stripe_customer_id/stripe_subscription_id and
// created_at, which the UI never reads either. Row Level Security limits
// *which row* someone can read, not which columns in it, so naming exactly
// the columns wanted here is what keeps those tokens out of the browser.
const PROFILE_COLUMNS = 'id, name, ftp, trial_start, subscribed, settings, strava_athlete_id, training_plan, comp_access, comp_expires_at, subscription_paused, subscription_paid_through';

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
    hero3: 'repeating-linear-gradient(135deg,#20252b,#20252b 10px,#1a1e23 10px,#1a1e23 20px)',
    hero3ink: 'var(--accent)', hero3chip: 'rgba(20,23,26,0.72)',
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
    hero3: 'repeating-linear-gradient(135deg,#EEF1F3,#EEF1F3 10px,#E7EBEE 10px,#E7EBEE 20px)',
    hero3ink: 'var(--accent)', hero3chip: '#F0FBDD',
    flame: 'var(--accent)',
  },
  // NEW THEME
  palette: {
    bg: '#F3EDE3', panel: '#FFFFFF', panel2: '#E9E0D0', line: '#E3D9C8',
    text: '#2A2A2A', sub: '#9A9184', red: '#C0392B', muted: '#CFC5B4',
    navbg: 'rgba(250,246,239,0.96)',
    hero1: '#C0F5ED', hero1ink: '#1F6F63', hero1chip: 'rgba(255,255,255,0.72)',
    hero2: '#E6CBA8', hero2ink: '#8A5A22', hero2chip: 'rgba(255,255,255,0.72)',
    hero3: '#C8DBC0', hero3ink: '#4A6B44', hero3chip: 'rgba(255,255,255,0.72)',
    flame: '#D79A4E',
    // Default theme always shows teal trim, regardless of the accent colour picked in Settings
    accent: '#2FC5AE',
  },
};
const DEFAULT_SETTINGS = {
  theme: 'dark', // 'dark' | 'light'
  accentColor: '#2FC5AE', // brand teal ("mint") — was '#C9F031' (the old lime), left over from before the rebrand
  soundPack: 'bright',
  soundIntervalBeep: true,
  soundCountdown: true,
  soundCompletion: true,
  soundVolume: 0.7,
  soundZoneTones: true,
  soundHalfwayFinal: true,
  soundRichFanfare: true,
  soundOffTargetNudge: false,
  soundPersonalBest: true,
  targetDisplay: 'both',
  showNextPreview: true,
  compactLabels: false,
  workoutTextScale: 1, // 1 / 1.25 / 1.5 / 2 — scales the big numbers shown mid-workout (ring timer, target/current chips). 2x is sized for tablets mounted further from the rider.
  keepAwake: true,
  autoPauseOnDisconnect: false,
  ergMode: false,
  preferredOrientation: 'landscape', // 'landscape' | 'portrait'
  visualZoneWash: true,
  visualProgressRing: true,
  visualPowerGauge: true,
  visualCelebration: true,
  colorblindMode: false,
};

// ---------- account / trial / billing ----------
// Accounts, sessions, and password resets are handled for real by Supabase
// Auth (see src/supabaseClient.js). Payments are still a placeholder — the
// "Subscribe" button flips a flag in the database rather than charging a
// real card. To take real payments you'd add Stripe (or Apple/Google
// in-app purchase if you distribute through their app stores).
const TRIAL_DAYS = 7;
const MONTHLY_PRICE_LABEL = '$8.99 / month';
const ANNUAL_PRICE_LABEL = '$89.99 / year'; // keep in sync with the STRIPE_PRICE_ANNUAL price in the Stripe Dashboard
// New account creation is paused app-wide until Trbo formally relaunches (marketing
// funnel, native testing, and the EU/UK Article 27 representative decision all need
// to land together — see /pricing page and TRBO_MINIMAL_PAGE_HANDOVER.md). Existing
// accounts are completely unaffected by this flag; it only blocks new signups.
const SIGNUPS_PAUSED = true;
// How many devices one account can be actively signed in on at once. Backed
// by the register_device/check_device functions in supabase-setup.sql —
// change this number any time without touching the database.
const MAX_ACTIVE_DEVICES = 2;
// Strava's Client ID (not secret -- safe to have in front-end code, unlike
// the Client Secret which only ever lives server-side as a Vercel env var).
// Get this from https://www.strava.com/settings/api after creating an API
// application, then paste it in here. Until it's set, the Strava section
// in Settings stays hidden instead of showing a broken "Connect" button.
const STRAVA_CLIENT_ID = '265504';
function daysLeftInTrial(trialStart) {
  if (!trialStart) return 0;
  const start = new Date(trialStart).getTime();
  const elapsedDays = (Date.now() - start) / 86400000;
  return Math.max(0, Math.ceil(TRIAL_DAYS - elapsedDays));
}
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

// Zone colour palettes for the six training zones (see ZONE_COLORS below).
// The ColorblindContext itself lives in colorblindContext.js so it can be
// shared with PlannerView.jsx without a circular import. The default set climbs
// blue -> teal -> green -> yellow-green -> orange -> red, which is a
// beautiful gradient with normal vision but collapses into a near-identical
// yellow/brown smear for red-green colour blindness (the most common form,
// affecting roughly 1 in 12 men) — Tempo, Threshold, VO2 Max and Anaerobic
// become very hard to tell apart at a glance. The "colorblind" set swaps in
// an Okabe-Ito-derived palette chosen so every zone stays distinguishable
// under protanopia, deuteranopia, and (reasonably) tritanopia, while keeping
// the same low-to-high intensity ordering.
const ZONE_COLORS = {
  standard: {
    Recovery: '#4A6FA5', Endurance: '#4FB8A6', Tempo: '#8FC93A',
    Threshold: '#C9F031', 'VO2 Max': '#FF9F40', Anaerobic: '#FF4D4D', Free: '#4B5563',
    'Sweet Spot': '#B8D93A', 'FTP Test': '#2FC5AE',
  },
  colorblind: {
    Recovery: '#0072B2', Endurance: '#56B4E9', Tempo: '#009E73',
    Threshold: '#E69F00', 'VO2 Max': '#D55E00', Anaerobic: '#CC79A7', Free: '#4B5563',
    'Sweet Spot': '#F0E442', 'FTP Test': '#2FC5AE',
  },
};
function zoneFor(interval, cvd) {
  const palette = cvd ? ZONE_COLORS.colorblind : ZONE_COLORS.standard;
  if (interval.type === 'free') return { color: palette.Free, name: 'Free', intensity: 0.16 };
  if (interval.type === 'power') {
    const p = interval.target;
    let name;
    if (p <= 55) name = 'Recovery';
    else if (p <= 75) name = 'Endurance';
    else if (p <= 90) name = 'Tempo';
    else if (p <= 105) name = 'Threshold';
    else if (p <= 120) name = 'VO2 Max';
    else name = 'Anaerobic';
    return { color: palette[name], name, intensity: Math.min(1.3, p / 150) };
  }
  const r = interval.target;
  let name;
  if (r <= 2) name = 'Recovery';
  else if (r <= 4) name = 'Endurance';
  else if (r <= 6) name = 'Tempo';
  else if (r === 7) name = 'Threshold';
  else if (r <= 9) name = 'VO2 Max';
  else name = 'Anaerobic';
  return { color: palette[name], name, intensity: r / 10 };
}

// A distinct musical note per zone so a rider can hear what's coming next
// without looking at the screen — low and mellow for recovery, sharp and
// high for anaerobic efforts.
const ZONE_TONE_FREQ = { Recovery: 520, Endurance: 660, Tempo: 760, Threshold: 880, 'VO2 Max': 1020, Anaerobic: 1180, Free: 700 };
// Synthesized workout cues, tuned by ear in the Trbo Sound Lab sandbox so
// every alert in the app shares one consistent sonic identity rather than
// a grab-bag of arbitrary beeps. Each cue is a waveform + base pitch + a
// short pattern of notes (ratio of the base pitch, offset in ms from the
// trigger, and a duration multiplier of the base length). Two packs are
// offered — Bright (melodic, multi-note) and Soft (single mellow tones) —
// selected via settings.soundPack.
const SOUND_CUE_PACKS = {
  bright: {
    intervalStart: { wave: 'triangle', freq: 380, dur: 160, pattern: [{ ratio: 1, offset: 0, mult: 0.6 }, { ratio: 1.333, offset: 90, mult: 0.7 }] },
    countdownTick: { wave: 'sine', freq: 820, dur: 100, pattern: [{ ratio: 1, offset: 0, mult: 1 }] },
    restStart: { wave: 'sine', freq: 550, dur: 780, pattern: [{ ratio: 1, offset: 0, mult: 0.5 }, { ratio: 0.75, offset: 180, mult: 0.6 }] },
    workoutComplete: { wave: 'sine', freq: 490, dur: 810, pattern: [{ ratio: 1, offset: 0, mult: 0.35 }, { ratio: 1.25, offset: 150, mult: 0.35 }, { ratio: 1.5, offset: 300, mult: 0.6 }] },
    offTargetAlarm: { wave: 'sine', freq: 335, dur: 500, pattern: [{ ratio: 1, offset: 0, mult: 0.3 }, { ratio: 1, offset: 180, mult: 0.3 }, { ratio: 1, offset: 360, mult: 0.3 }] },
    personalBest: { wave: 'sine', freq: 350, dur: 500, pattern: [{ ratio: 1, offset: 0, mult: 0.25 }, { ratio: 1.25, offset: 80, mult: 0.25 }, { ratio: 1.5, offset: 160, mult: 0.25 }, { ratio: 2, offset: 240, mult: 0.5 }] },
  },
  soft: {
    intervalStart: { wave: 'sine', freq: 385, dur: 180, pattern: [{ ratio: 1, offset: 0, mult: 1 }] },
    countdownTick: { wave: 'sine', freq: 465, dur: 230, pattern: [{ ratio: 1, offset: 0, mult: 1 }] },
    restStart: { wave: 'sine', freq: 520, dur: 170, pattern: [{ ratio: 1, offset: 0, mult: 1 }] },
    workoutComplete: { wave: 'sine', freq: 350, dur: 270, pattern: [{ ratio: 1, offset: 0, mult: 1 }] },
    offTargetAlarm: { wave: 'sine', freq: 335, dur: 230, pattern: [{ ratio: 1, offset: 0, mult: 1 }] },
    personalBest: { wave: 'sine', freq: 440, dur: 500, pattern: [{ ratio: 1, offset: 0, mult: 1 }] },
  },
};
// Confetti palette for the finish-line celebration — reuses the same
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
// A single 0-ish..1.3 number for "how hard is the stimulus?", used only to sort
// the library from recovery-easy up to sprint-savage. It's a duration-weighted
// blend that leans on the harder intervals (the 4th-power weighting is the same
// idea normalized power uses) so a workout with a few brutal efforts ranks above
// a longer steady one, which matches how a rider would rank them by feel.
function rpeToPct(rpe) {
  const map = { 1: 40, 2: 48, 3: 55, 4: 62, 5: 70, 6: 78, 7: 88, 8: 96, 9: 108, 10: 130 };
  return map[Math.round(rpe)] ?? 70;
}
function workoutIntensity(w) {
  let dur = 0, np4 = 0;
  for (const it of (w.intervals || [])) {
    const pct = it.type === 'power' ? it.target : it.type === 'rpe' ? rpeToPct(it.target) : 60;
    dur += it.duration;
    np4 += Math.pow(pct / 100, 4) * it.duration;
  }
  if (!dur) return 0;
  return Math.pow(np4 / dur, 0.25); // ~normalized intensity as a fraction of FTP
}
function formatTarget(it, ftp, mode) {
  if (it.type === 'free') return 'Free / rest';
  if (it.type === 'rpe') {
    const pct = rpeToPct(it.target);
    const watts = Math.round((ftp * pct) / 100);
    if (mode === 'watts') return `RPE ${it.target}/10 · ${watts}W`;
    if (mode === 'percent') return `RPE ${it.target}/10 · ~${pct}% FTP`;
    return `RPE ${it.target}/10 · ~${pct}% FTP · ${watts}W`;
  }
  const watts = Math.round((ftp * it.target) / 100);
  if (mode === 'watts') return `${watts}W`;
  if (mode === 'percent') return `${it.target}% FTP`;
  return `${it.target}% FTP · ${watts}W`;
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

// ---------- admin: workout export (builder -> library format) ----------
// Turns a workout built in BuilderView into plain text the owner can copy
// and hand to Claude: a human-readable interval list plus ready-to-paste
// iv(...) code lines matching the exact shape the LIBRARY array uses below.
// Gated to the owner in the UI (see BuilderView) -- this is a content
// pipeline helper, not a user-facing feature.
function jsStringLiteral(s) {
  return "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}
function intervalTargetLabel(it) {
  if (it.type === 'power') return `${it.target}% FTP`;
  if (it.type === 'rpe') return `RPE ${it.target}/10`;
  return 'Free / rest';
}
function intervalCodeLine(it) {
  const t = (it.type === 'free' || it.target === null || it.target === undefined) ? 'null' : it.target;
  return `  iv(${jsStringLiteral(it.label)}, ${it.duration}, ${jsStringLiteral(it.type)}, ${t}),`;
}
function buildWorkoutExportText(w) {
  const intervals = w.intervals || [];
  const total = totalDuration(intervals);
  const listLines = intervals.map((it, i) => `${i + 1}. ${it.label} — ${fmt(it.duration)} — ${intervalTargetLabel(it)}`);
  const codeLines = intervals.map(intervalCodeLine);
  return [
    '=== TRBO WORKOUT EXPORT ===',
    `Name: ${w.name || '(untitled)'}`,
    `Category: ${w.category || ''}`,
    `Description: ${w.description || '(none)'}`,
    `Total duration: ${fmtLong(total)}`,
    `Intervals: ${intervals.length}`,
    '',
    ...listLines,
    '',
    '--- Code for library ---',
    ...codeLines,
  ].join('\n');
}

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
// This is the ORIGINAL, default scaling behaviour — used for every
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
// target length — the normal stretch/filler system above still handles
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
    // Capped at 6 rather than 3 — some workouts (e.g. Match Play's "close
    // the gap / recover / win the sprint / easy" cycle) repeat a 4-interval
    // unit, which a cap of 3 could never detect, so extending the workout
    // fell back to generic filler instead of adding another whole block.
    const maxUnit = Math.min(6, Math.floor((n - i) / 2));
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
//     the workout's "core" — everything between warm up and cool down —
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
    //     when there's room for a full lap AND a real recovery gap ahead of
    //     it — stacking another max-effort pass straight onto the last one
    //     with no rest in between isn't sound training, so each extra pass
    //     costs its own ~12min easy-riding buffer before it starts.
    let addedModules = [];
    if (repeatWholeCore && groups.length === 0) {
      const module = findCoreModule(originalIntervals, classes);
      if (module && module.duration > 0) {
        const maxAdd = 4;
        const gapSeconds = 12 * 60;
        const perPass = module.duration + gapSeconds;
        while (diff >= perPass && addedModules.length < maxAdd) {
          addedModules.push([iv('Endurance', gapSeconds, 'power', 65), ...module.build()]);
          diff -= perPass;
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
    //    stretch is big enough to warrant it) plus Endurance riding — the
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
    // 1) remove whole reps from repeat groups. Rather than trimming every
    //    group evenly (which leaves several thinned-out blocks), drain the
    //    smaller group(s) toward zero — dropping them out of the ride
    //    entirely if there's enough to shed — before touching the biggest
    //    group at all. The biggest group is treated as the workout's
    //    signature set and always keeps at least 1 rep, so shortening a
    //    ride collapses the minor blocks first and leaves one solid set
    //    of work rather than two weak ones.
    if (groups.length > 0) {
      const order = groups
        .map((g, gi) => ({ g, gi, origDur: totalDuration(g.items) * g.origReps }))
        .sort((a, b) => a.origDur - b.origDur);
      const primaryGi = order[order.length - 1].gi;
      for (const { g, gi } of order) {
        if (need <= 0) break;
        const unitDur = totalDuration(g.items);
        if (unitDur <= 0) continue;
        const floorReps = gi === primaryGi ? 1 : 0;
        while (need > 0 && g.reps > floorReps) {
          g.reps -= 1;
          need -= unitDur;
        }
      }
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

// ---------- public demo ride ----------
// Shown to signed-out visitors only (reached via a "Try a demo ride" link
// that appends ?demo=ride to the URL — see the demoMode check in App()).
// Deliberately NOT part of LIBRARY, so it can never appear in a logged-in
// user's workout library. Runs on a fixed 200W assumed FTP since there's no
// account to read a real one from. Built to sell the app in ~10 minutes: a
// smooth ERG ramp up (so the resistance change feels like real terrain),
// then two short hard/easy snaps (so the trainer's responsiveness is
// obvious), then an easy cool down.
const DEMO_FTP = 200;
const DEMO_WORKOUT = {
  id: 'demo-ride', name: 'Demo ride', category: 'Demo',
  description: 'A quick taste of Trbo — connect your trainer and feel it respond in real time.',
  intervals: [
    iv('Easy spin', 90, 'power', 55),
    iv('Roll up', 60, 'power', 65),
    iv('Roll up', 60, 'power', 75),
    iv('Roll up', 60, 'power', 85),
    iv('Roll up', 60, 'power', 95),
    iv('Hard', 30, 'power', 125),
    iv('Easy', 30, 'power', 50),
    iv('Hard', 30, 'power', 125),
    iv('Easy', 30, 'power', 50),
    iv('Cool down', 150, 'power', 50),
  ],
};

// ---------- preloaded library ----------
const LIBRARY = [
  {
    id: 'ramp-ftp-test', name: 'Ramp FTP test', category: 'Basics',
    description: 'Power climbs a little every minute until you can’t hold it — no long steady effort needed.',
    notes: 'Ride until you can no longer hold the target power. If a trainer is connected, the app will notice when you fall off the pace and end the test for you automatically, then estimate your FTP. Without a trainer connected, stop yourself, find the last full minute you completed, take its power, and multiply by 0.75 — that’s your new FTP, update it in Settings.',
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
    notes: 'If a trainer or power meter is connected, the app will average your power for the 20 minute effort and work out your new FTP for you automatically as soon as it ends. Without one connected, take your average power for that block yourself and multiply by 0.95 — that’s your new FTP, update it in Settings.',
    fixedLength: true,
    ftpTestLabel: '20 minute test',
    ftpMultiplier: 0.95,
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
    intervals: [iv('Warm up', 300, 'power', 55), iv('Endurance', 3000, 'power', 68), iv('Cool down', 300, 'power', 50)],
  },
  {
    id: 'rolling-endurance', name: 'Rolling endurance', category: 'Basics',
    description: 'Steady aerobic ride that rolls gently up and down like rolling terrain, 55–75% FTP.',
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
    id: 'threshold-2x20', name: 'Threshold 2×20', category: 'Basics',
    description: 'Classic two 20 minute blocks at threshold power.',
    intervals: [iv('Warm up', 600, 'power', 60), iv('Threshold', 1200, 'power', 98), iv('Recovery', 480, 'power', 55), iv('Threshold', 1200, 'power', 100), iv('Cool down', 480, 'power', 50)],
  },
  {
    id: 'vo2-5x3', name: 'VO2 max 5×3', category: 'Basics',
    description: 'Five 3 minute VO2 efforts with equal recovery.',
    intervals: [iv('Warm up', 600, 'power', 60), ...repeatIv(5, () => [iv('VO2 max', 180, 'power', 115), iv('Recovery', 180, 'power', 55)]), iv('Cool down', 480, 'power', 50)],
  },
  {
    id: 'tabata-torch', name: 'Tabata torch', category: 'Basics',
    description: 'Eight all-out 20 second bursts with short rests.',
    intervals: [iv('Warm up', 480, 'power', 60), ...repeatIv(8, () => [iv('Sprint', 20, 'rpe', 10), iv('Rest', 10, 'power', 40)]), iv('Cool down', 480, 'power', 50)],
  },
  {
    id: 'over-unders', name: 'Over-unders 4×4', category: 'Basics',
    description: 'Alternating above and below threshold to teach pacing.',
    intervals: [iv('Warm up', 600, 'power', 60), ...repeatIv(4, () => [iv('Over', 120, 'power', 105), iv('Under', 120, 'power', 90)]), iv('Cool down', 480, 'power', 50)],
  },
  {
    id: 'rpe-fartlek', name: 'Fartlek surges', category: 'Basics',
    description: 'Short surges and easy settles, back to back — the trainer holds the effort, you just ride.',
    intervals: [
      iv('Easy spin', 300, 'rpe', 3), iv('Build', 180, 'rpe', 6),
      ...repeatIv(2, (i) => [
        iv('Push', 120, 'rpe', 8), iv('Recover', 120, 'rpe', 2), iv('Hard', 240, 'rpe', 7), iv('Sprint', 20, 'rpe', 10),
        ...(i === 0 ? [iv('Recover', 100, 'rpe', 2)] : []),
      ]),
      iv('Easy', 300, 'rpe', 3), iv('Cool down', 300, 'rpe', 2),
    ],
  },
  {
    id: 'recovery-spin', name: 'Recovery spin', category: 'Basics',
    description: 'Light and easy — flush the legs, nothing more.',
    intervals: [iv('Keep it light', 1800, 'power', 50)],
  },
  {
    id: 'pyramid-power', name: 'Pyramid power', category: 'Basics',
    description: 'Step up through the zones, then step back down.',
    intervals: [iv('Warm up', 300, 'power', 55), iv('Step 1', 180, 'power', 60), iv('Step 2', 180, 'power', 70), iv('Step 3', 180, 'power', 80), iv('Step 4', 180, 'power', 90), iv('Peak', 180, 'power', 100), iv('Step 4', 180, 'power', 90), iv('Step 3', 180, 'power', 80), iv('Step 2', 180, 'power', 70), iv('Step 1', 180, 'power', 60), iv('Cool down', 300, 'power', 50)],
  },
  {
    id: 'mixed-metric', name: 'Mixed metric session', category: 'Basics',
    description: 'Structured power intervals mixed with effort-based surges — always something to push against.',
    intervals: [iv('Warm up', 480, 'power', 60), iv('Sweet spot', 600, 'power', 90), iv('Recovery', 300, 'power', 50), iv('Hard effort', 240, 'rpe', 8), iv('Sprint', 30, 'rpe', 10), iv('Recovery', 90, 'power', 50), iv('Endurance', 600, 'power', 70), iv('Cool down', 360, 'power', 50)],
  },
  {
    id: 'vo2-40-20-double', name: 'VO2 max 40/20 × 13 (2 sets)', category: 'Basics',
    description: 'Two sets of thirteen short, sharp 40-second VO2 max efforts with 20 seconds off, separated by a proper recovery block.',
    notes: 'A hard, focused VO2 max session. The 40-second efforts should feel like you couldn’t hold them much past a minute — the 20 seconds off is just enough to keep the legs turning before the next one.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      ...repeatIv(13, () => [iv('On', 40, 'power', 120), iv('Off', 20, 'power', 50)]),
      iv('Between sets recovery', 300, 'power', 55),
      ...repeatIv(13, () => [iv('On', 40, 'power', 120), iv('Off', 20, 'power', 50)]),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  // ---------- Rides: long, mixed-terrain, real-world-feel sessions (90 min–5 hr) ----------
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
    description: 'Fast, tight rotating pacelines with no let-up — take your turn on the front and hang on in the line.',
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
    description: 'The full arc of a 100-mile day — long steady miles, two rest stops, a headwind slog and a final climb before home.',
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
    description: 'One long mountain up-and-over — valley approach, switchback surges, a sweet spot mid-section, hairpin kicks and a summit push.',
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
    description: 'A gusty exposed road — rotate through the echelon, hold the wheel, and don’t get gapped when it splits.',
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
    description: 'You go off the front and try to make it stick — the drama of an escape, a chase, a counter, and a photo finish.',
    intervals: [
      iv('Warm up', 600, 'power', 56),
      iv('Group tempo', 900, 'power', 78),
      iv('The attack goes', 120, 'power', 110),
      iv('Solo effort', 900, 'power', 92),
      ...repeatIv(4, () => [iv('Chase pressure surge', 90, 'power', 105), iv('Steady', 120, 'power', 88)]),
      iv('Solo grind', 900, 'power', 98),
      iv('Dig deep', 300, 'power', 112),
      iv('Caught — recover', 360, 'power', 60),
      iv('Regroup tempo', 600, 'power', 78),
      iv('Counter attack', 90, 'power', 115),
      iv('Solo again', 900, 'power', 95),
      iv('Final sprint for the line', 30, 'rpe', 10),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-audax-200', name: 'Audax 200 Pace', category: 'Rides',
    description: 'Ultra-distance brevet pacing — patient, metronomic, with two control-point stops. Nothing flashy, just steady miles.',
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
    description: 'Short, sharp, and relentless — hard accelerations out of every corner with barely a moment to recover.',
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
    description: 'A brutal spring-classics profile — three escalating pavé sectors, a cobbled climb, and a solo dash to the velodrome.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Approach tempo', 1200, 'power', 78),
      ...repeatIv(6, () => [iv('Pavé push', 90, 'power', 100), iv('Smooth recover', 60, 'power', 70)]),
      iv('Regroup', 300, 'power', 58),
      ...repeatIv(8, () => [iv('Pavé push', 120, 'power', 102), iv('Smooth recover', 90, 'power', 70)]),
      iv('Cobbled climb', 360, 'power', 95),
      iv('Descent', 480, 'power', 50),
      ...repeatIv(10, () => [iv('Pavé push', 60, 'power', 105), iv('Smooth recover', 60, 'power', 68)]),
      iv('Chase group tempo', 1200, 'power', 85),
      ...repeatIv(6, () => [iv('Pavé push', 90, 'power', 103), iv('Smooth recover', 60, 'power', 70)]),
      iv('Solo finish', 600, 'power', 98),
      iv('Sprint at the velodrome', 30, 'rpe', 10),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-group-surges', name: 'Group Ride Surges', category: 'Rides',
    description: 'Someone in the group keeps attacking for fun — repeated surges you have to cover, then settle, then cover again.',
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
      iv('Climb 1 — Cat 3', 900, 'power', 90),
      iv('Summit surge', 60, 'power', 105),
      iv('Descent', 600, 'power', 50),
      ...repeatIv(6, () => [iv('Roll up', 180, 'power', 78), iv('Roll down', 120, 'power', 60)]),
      ...repeatIv(4, () => [iv('Climb 2 surge', 60, 'power', 108), iv('Climb 2 steady', 180, 'power', 88)]),
      iv('Descent', 720, 'power', 50),
      iv('Feed zone', 480, 'power', 45),
      iv('Endurance cruise', 1500, 'power', 68),
      iv('Climb 3 — the big one', 1500, 'power', 88),
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
    description: 'Smooth, consistent effort under headlights — a careful climb, a cautious descent, and a small group keeping each other honest.',
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
    description: 'Same hill, again and again — twelve reps of climb-and-descend with a feed stop halfway through.',
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
    description: 'A full stage-race narrative — an early move that holds most of the day, a crosswind scare, and a bunch gallop at the line.',
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
    description: 'The hardest one-day race on the calendar — three escalating pavé sectors, a run of steep bergs, and a selection made in the final hour.',
    intervals: [
      iv('Warm up', 900, 'power', 55),
      iv('Approach endurance', 2400, 'power', 68),
      iv('Early break tempo', 1200, 'power', 80),
      ...repeatIv(6, () => [iv('Pavé push', 90, 'power', 100), iv('Recover', 60, 'power', 70)]),
      ...repeatIv(6, () => [iv('Roll up', 180, 'power', 80), iv('Roll down', 120, 'power', 60)]),
      iv('Feed zone', 480, 'power', 45),
      ...repeatIv(8, () => [iv('Pavé push', 120, 'power', 103), iv('Recover', 90, 'power', 70)]),
      ...repeatIv(5, () => [iv('Berg climb', 90, 'power', 108), iv('Descend', 60, 'power', 62)]),
      iv('Endurance regroup', 1500, 'power', 68),
      ...repeatIv(8, () => [iv('Pavé push', 120, 'power', 105), iv('Recover', 90, 'power', 70)]),
      iv('Selection made — threshold grind', 1200, 'power', 98),
      iv('Chase group tempo', 900, 'power', 85),
      iv('Final berg climb', 300, 'power', 105),
      iv('Sprint finish', 30, 'rpe', 10),
      iv('Cool down', 900, 'power', 50),
    ],
  },
  {
    id: 'ride-bikepacking-haul', name: 'Bikepacking Long Haul', category: 'Rides',
    description: 'A loaded, all-day ultra-distance ride — lower power to account for the gear, gravel sections, and two proper rest stops.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Loaded steady endurance', 3600, 'power', 62),
      iv('Gravel section endurance', 2400, 'power', 65),
      iv('Climb with gear', 900, 'power', 78),
      iv('Descent — careful', 600, 'power', 48),
      iv('Rest stop', 900, 'power', 45),
      iv('Steady endurance', 3000, 'power', 63),
      iv('Headwind grind', 1500, 'power', 70),
      iv('Rest stop', 600, 'power', 45),
      iv('Steady endurance', 2400, 'power', 64),
      iv('Final push — tired legs', 900, 'power', 72),
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
    description: 'Stop-and-go city riding — sprints away from every light, a bridge climb, and a park path to catch your breath.',
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
    id: 'ride-city-skyline-intervals', name: 'City Skyline Intervals', category: 'Rides',
    description: 'Short, sharp efforts with a view — a compact session for a tight morning.',
    intervals: [
      iv('Warm up', 900, 'power', 60),
      ...repeatIv(6, () => [iv('VO2 effort', 120, 'power', 118), iv('Recover', 180, 'power', 55)]),
      iv('Cool down', 900, 'power', 50),
    ],
  },
  {
    id: 'ride-recovery-cruise', name: 'Recovery Century Cruise', category: 'Rides',
    description: 'A very long day at a very easy pace — all endurance, one café stop, and nothing that will trouble your legs.',
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
    id: 'ride-leadout-day', name: 'Sprinter’s Lead-Out Day', category: 'Rides',
    description: 'Mostly easy miles broken up by repeated lead-out-and-sprint efforts — practice for the final 200 meters.',
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
    description: 'A high, exposed ridge road — rolling punchy climbs, buffeting crosswind straights, and views for miles the whole way along.',
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
    description: 'Flat, hot and relentless — long steady grinding across open desert with a stiff headwind fight and a race to town before dark.',
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
    description: 'Relentless steep drops into fjords and brutal switchback climbs back out, again and again — the answer to a flat ride.',
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
      iv('Big climb — the pass', 1500, 'power', 90),
      iv('Summit surge', 60, 'power', 108),
      iv('Long descent', 1080, 'power', 55),
      iv('Loch road home', 1200, 'power', 68),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-dolomites-double', name: 'Dolomites Double', category: 'Rides',
    description: 'Two legendary mountain passes back to back — hairpins, steep ramps and thin air, twice over.',
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
    description: 'Exposed, boggy and utterly alone — a driving headwind across open moorland with rough gravel sections underfoot.',
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
    description: 'Technical rim-road riding — sudden drops into side canyons and sharp climbs back out, over and over, with sheer exposure throughout.',
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
    description: 'Four cols in one day — none of them huge alone, but the fatigue stacks fast by the fourth.',
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
      iv('Col 4 climb — legs are gone', 1320, 'power', 86),
      iv('Col 4 summit surge', 60, 'power', 102),
      iv('Final descent', 1080, 'power', 55),
      iv('Valley cruise home', 1800, 'power', 68),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-anti-gravity', name: 'Anti-Gravity Day', category: 'Rides',
    description: 'The mountain owes you nothing — every fast, easy drop has to be paid back with a harder climb straight after. The debt keeps compounding.',
    notes: 'A playful inversion of a hill-repeat session: descents are quick and light, but each one is followed by a "debt climb" that’s a notch harder than a normal repeat would be. By the end your legs will disagree that gravity was ever on your side.',
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
    description: 'A front is building on the horizon and you’re racing it home — escalating gusts, a mid-ride lightning-strike sprint, and a full-gas dash for shelter.',
    intervals: [
      iv('Warm up', 480, 'power', 56),
      iv('Calm before the storm', 900, 'power', 75),
      iv('Distant thunder', 120, 'power', 95),
      iv('Building tempo — skies darkening', 900, 'power', 82),
      ...repeatIv(5, () => [iv('Wind gust surge', 90, 'power', 105), iv('Brace and hold', 120, 'power', 80)]),
      iv('Storm closing in', 720, 'power', 90),
      iv('Lightning strike sprint', 30, 'rpe', 10),
      ...repeatIv(4, () => [iv('Squall surge', 60, 'power', 110), iv('Push through', 120, 'power', 85)]),
      iv('Full gas race to shelter', 300, 'power', 105),
      iv('Sprint for the door', 30, 'rpe', 10),
      iv('Sheltered — catching breath', 480, 'power', 55),
      iv('Cool down', 480, 'power', 50),
    ],
  },
  {
    id: 'ride-tt-through-time', name: 'Time Trial Through Time', category: 'Rides',
    description: 'A ride through the eras of cycling — heavy steel-bike tempo, smooth aero-bar threshold blocks, and precise modern power-meter intervals.',
    notes: 'Three "eras," three different feels: Era 1 is steady, heavy and mechanical; Era 2 is long and smooth, built for holding an aero position; Era 3 is short, sharp and exactly on target the way a power meter demands.',
    intervals: [
      iv('Warm up', 600, 'power', 58),
      iv('Era 1: the steel age', 2100, 'power', 75),
      ...repeatIv(5, () => [iv('Cobbled test track push', 60, 'power', 98), iv('Recover', 60, 'power', 70)]),
      iv('Transition', 480, 'power', 60),
      iv('Era 2: the aero age — block 1', 1200, 'power', 98),
      iv('Era 2: the aero age — block 2', 1200, 'power', 100),
      iv('Transition', 480, 'power', 60),
      ...repeatIv(6, () => [iv('Era 3: on the power meter', 120, 'power', 105), iv('Era 3: recover to target', 60, 'power', 65)]),
      iv('Era 3 finale — perfectly paced', 600, 'power', 102),
      iv('Modern day sprint', 30, 'rpe', 10),
      iv('Cool down', 630, 'power', 50),
    ],
  },
  {
    id: 'ride-the-gauntlet', name: 'The Gauntlet', category: 'Rides',
    description: 'Five boss climbs, each tougher than the last, a secret boss thrown in for good measure, and one Final Boss standing between you and the victory lap.',
    notes: 'Treat each "boss" like a level — the checkpoints between them are recovery, not the end of the fight. Save something for the Final Boss.',
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
      ...repeatIv(4, () => [iv('Level 4 boss — attack pattern', 60, 'power', 100), iv('Level 4 boss — dodge', 90, 'power', 75)]),
      iv('Checkpoint', 360, 'power', 62),
      ...repeatIv(6, () => [iv('Bonus stage surge', 60, 'power', 95), iv('Bonus stage recover', 90, 'power', 65)]),
      ...repeatIv(4, () => [iv('Level 5 boss — attack pattern', 60, 'power', 106), iv('Level 5 boss — dodge', 90, 'power', 75)]),
      iv('Checkpoint', 360, 'power', 62),
      iv('FINAL BOSS', 300, 'power', 110),
      iv('Boss defeated sprint', 30, 'rpe', 10),
      iv('Victory lap', 1500, 'power', 62),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-migration-flock', name: 'Migration Ride: Follow the Flock', category: 'Rides',
    description: 'A long ride shaped like a migration — rising on thermals, rotating through the flock in a crosswind formation, and one long steady wingspan haul before landing.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Rising with the flock', 900, 'power', 82),
      iv('Thermal soaring cruise', 1200, 'power', 70),
      ...repeatIv(6, () => [iv('Flock surge', 120, 'power', 98), iv('Glide and reform', 120, 'power', 66)]),
      iv('Crosswind formation flying', 1200, 'power', 80),
      iv('Long wingspan haul', 2700, 'power', 68),
      iv('Storm front — push through', 900, 'power', 85),
      ...repeatIv(5, () => [iv('Flock surge', 120, 'power', 100), iv('Glide and reform', 150, 'power', 66)]),
      iv('Descending to roost', 900, 'power', 55),
      iv('Final approach push', 480, 'power', 88),
      iv('Landing sprint', 30, 'rpe', 9),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-ironman-nice', name: 'Riviera Coastal Climb', category: 'Rides',
    description: 'A French Riviera long-course bike leg — a flat coastal rollout along the Promenade before the road tips up into the Alpes-Maritimes hinterland, over the Col de Vence, and back down to the sea.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Coastal rollout — Promenade des Anglais', 1500, 'power', 62),
      iv('Approach into the hills', 1200, 'power', 74),
      iv('Col de Vence lower slopes', 900, 'power', 85),
      ...repeatIv(5, () => [iv('Col de Vence switchback surge', 90, 'power', 104), iv('Steady grind', 150, 'power', 88)]),
      iv('Col de Vence summit push', 300, 'power', 97),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Descent', 900, 'power', 55),
      ...repeatIv(6, () => [iv('Plateau roll up', 150, 'power', 82), iv('Plateau roll down', 120, 'power', 62)]),
      iv('Second climb — Coursegoules ramp', 720, 'power', 90),
      iv('Summit push 2', 300, 'power', 100),
      iv('Summit sprint 2', 30, 'rpe', 10),
      iv('Long descent back to the coast', 1500, 'power', 55),
      iv('Coastal headwind grind home', 1800, 'power', 78),
      iv('Promenade finish cruise', 900, 'power', 65),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-ironman-kona', name: 'Kona Lava Highway', category: 'Rides',
    description: 'The Big Island\u2019s toughest long-course bike route — flat lava-field highway out to Hawi, a stiff climb into the crosswind, and a long grinding return with the trade winds full in your face.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Ali’i Drive rollout', 900, 'power', 62),
      iv('Onto the Queen K — lava field flat', 1500, 'power', 72),
      ...repeatIv(6, () => [iv('Crosswind gust surge', 90, 'power', 98), iv('Steady into the wind', 120, 'power', 72)]),
      iv('Kawaihae flat grind', 1200, 'power', 75),
      iv('Climb to Hawi', 1200, 'power', 88),
      iv('Hawi summit push', 300, 'power', 98),
      iv('Hawi turnaround sprint', 30, 'rpe', 10),
      iv('Fast descent from Hawi', 900, 'power', 55),
      iv('Queen K return — headwind grind', 2400, 'power', 80),
      ...repeatIv(5, () => [iv('Trade wind gust', 90, 'power', 100), iv('Steady grind', 120, 'power', 75)]),
      iv('Energy Lab out-and-back', 900, 'power', 90),
      iv('Final Queen K push', 1200, 'power', 82),
      iv('Airport road finish cruise', 600, 'power', 65),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-ironman-lanzarote', name: 'Lanzarote Fire Mountains', category: 'Rides',
    description: 'One of triathlon’s hardest bike courses — volcanic terrain, relentless crosswinds, and the brutal switchback climb up to Femés.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Volcanic flat rollout', 900, 'power', 65),
      ...repeatIv(6, () => [iv('Crosswind gust', 90, 'power', 100), iv('Steady grind into the wind', 120, 'power', 74)]),
      iv('Lava field tempo', 1500, 'power', 80),
      iv('Femés lower slopes', 600, 'power', 85),
      ...repeatIv(5, () => [iv('Femés switchback surge', 90, 'power', 106), iv('Steady climb', 150, 'power', 90)]),
      iv('Femés summit push', 300, 'power', 98),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Exposed plateau descent', 900, 'power', 58),
      ...repeatIv(4, () => [iv('Crosswind gust', 90, 'power', 98), iv('Steady', 120, 'power', 72)]),
      iv('Second climb — Fire Mountains approach', 900, 'power', 88),
      iv('Long descent to the coast', 1200, 'power', 55),
      iv('Coastal headwind grind home', 1800, 'power', 78),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-pyrenees-circle-of-death', name: 'Pyrenees: Circle of Death', category: 'Rides',
    description: 'The Pyrenees’ legendary trio — the Tourmalet, the Aspin and the Peyresourde back to back, the combination that gave this stage its nickname.',
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
    description: '48 hairpins to the highest paved pass the Giro visits — a long, relentless grind above the clouds.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1500, 'power', 68),
      iv('Stelvio lower slopes', 1200, 'power', 80),
      ...repeatIv(8, () => [iv('Hairpin surge', 90, 'power', 102), iv('Steady grind', 180, 'power', 87)]),
      iv('Thinning air — mid climb', 900, 'power', 88),
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
    description: 'The Kaiser — short in distance but savagely steep, with ramps that never let you find a rhythm.',
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
    description: 'Tarmac gives way to gravel switchbacks near the top of this Giro d’Italia climb — one of the hardest summit finishes in the sport.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1500, 'power', 68),
      iv('Finestre lower slopes — tarmac', 1200, 'power', 82),
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
    description: 'The Giant of Provence — forest switchbacks give way to the exposed, windswept moonscape on the run to the summit.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Approach through Bédoin', 1200, 'power', 68),
      iv('Forest lower slopes', 900, 'power', 85),
      ...repeatIv(6, () => [iv('Forest ramp surge', 90, 'power', 102), iv('Steady grind', 150, 'power', 89)]),
      iv('Chalet Reynard — treeline', 480, 'power', 90),
      iv('Exposed moonscape', 900, 'power', 96),
      ...repeatIv(4, () => [iv('Wind gust surge', 60, 'power', 108), iv('Steady into the wind', 90, 'power', 92)]),
      iv('Final push to the summit', 300, 'power', 100),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Long descent', 1500, 'power', 55),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-tour-alpe-dhuez', name: 'Tour: Alpe d’Huez', category: 'Rides',
    description: 'Twenty-one hairpin bends, a wall of noise at Dutch Corner, and one of the most famous finishes in cycling.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1200, 'power', 68),
      iv('Lower slopes — steepest ramps', 600, 'power', 92),
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
    description: 'The Col du Télégraphe into a short valley breather, then the long, thin-air grind over the Galibier — one of the highest points the Tour ever visits.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1200, 'power', 68),
      iv('Télégraphe climb', 900, 'power', 86),
      ...repeatIv(4, () => [iv('Télégraphe surge', 90, 'power', 102), iv('Steady climb', 150, 'power', 88)]),
      iv('Télégraphe summit', 60, 'power', 96),
      iv('Descent to Valloire', 480, 'power', 58),
      iv('Valley connector — feed zone', 480, 'power', 60),
      iv('Galibier lower slopes', 1200, 'power', 84),
      ...repeatIv(6, () => [iv('Galibier surge', 90, 'power', 103), iv('Steady grind', 180, 'power', 87)]),
      iv('Thin air — final ramps', 600, 'power', 92),
      iv('Summit push', 300, 'power', 99),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Long descent', 1800, 'power', 55),
      iv('Valley cruise home', 1200, 'power', 65),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-paris-roubaix', name: 'Paris–Roubaix: Hell of the North', category: 'Rides',
    description: 'The Arenberg Forest, Mons-en-Pévèle and the Carrefour de l’Arbre — punishing cobbles all the way to the velodrome.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Long approach — neutral zone tempo', 1800, 'power', 74),
      ...repeatIv(5, () => [iv('Early pavé sector', 90, 'power', 96), iv('Smooth recover', 90, 'power', 68)]),
      iv('Group tempo', 900, 'power', 78),
      iv('Trouée d’Arenberg', 300, 'power', 102),
      iv('Smooth recover', 300, 'power', 68),
      ...repeatIv(6, () => [iv('Pavé sector', 90, 'power', 100), iv('Smooth recover', 90, 'power', 70)]),
      iv('Regroup', 480, 'power', 60),
      iv('Mons-en-Pévèle', 480, 'power', 102),
      ...repeatIv(8, () => [iv('Pavé sector', 90, 'power', 102), iv('Smooth recover', 90, 'power', 70)]),
      iv('Feed zone', 480, 'power', 45),
      iv('Carrefour de l’Arbre', 480, 'power', 104),
      ...repeatIv(6, () => [iv('Pavé sector', 90, 'power', 105), iv('Smooth recover', 90, 'power', 70)]),
      iv('Chase to the velodrome', 1200, 'power', 92),
      iv('Velodrome sprint', 30, 'rpe', 10),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-tour-of-flanders', name: 'Tour of Flanders: Kwaremont & Paterberg', category: 'Rides',
    description: 'The Ronde’s finale on repeat — the Oude Kwaremont and the brutally steep Paterberg, back to back, again and again.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Long approach — flat sectors', 2100, 'power', 70),
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
      iv('Oude Kwaremont 4 — final time up', 300, 'power', 103),
      iv('Paterberg 4 — final time up', 120, 'power', 113),
      iv('Sprint to the line in Oudenaarde', 30, 'rpe', 10),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-liege-bastogne-liege', name: 'Liège–Bastogne–Liège', category: 'Rides',
    description: 'La Doyenne — the oldest and hilliest of the Classics, a long rolling grind through the Ardennes to the uphill finish in Liège.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Long rolling approach', 2400, 'power', 70),
      ...repeatIv(6, () => [iv('Ardennes roller', 150, 'power', 88), iv('Steady', 120, 'power', 66)]),
      iv('Côte de Wanne', 300, 'power', 92),
      iv('Steady', 600, 'power', 70),
      iv('Côte de Stockeu', 240, 'power', 100),
      iv('Descent', 480, 'power', 55),
      iv('Rolling valley', 1200, 'power', 68),
      iv('Côte de la Redoute', 480, 'power', 98),
      iv('Steady', 600, 'power', 70),
      iv('Côte des Forges', 300, 'power', 92),
      iv('Steady', 480, 'power', 68),
      iv('Côte de la Roche-aux-Faucons', 420, 'power', 100),
      iv('Chase group tempo', 900, 'power', 82),
      iv('Final uphill drag to the finish', 480, 'power', 96),
      iv('Sprint finish', 30, 'rpe', 10),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-milan-san-remo', name: 'Milan–San Remo: La Classicissima', category: 'Rides',
    description: 'The longest race on the calendar — hours of flat, controlled tempo before the Cipressa and the Poggio decide it in the final half hour.',
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
      iv('Poggio descent — technical', 300, 'power', 60),
      iv('Sprint into San Remo', 30, 'rpe', 10),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-vuelta-angliru', name: 'Vuelta: Alto de l’Angliru', category: 'Rides',
    description: 'The Vuelta’s most savage climb — relentless double-digit gradients that spike past 20% near the top, at Cueña les Cabres.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Valley approach', 1500, 'power', 68),
      iv('Angliru lower slopes', 900, 'power', 85),
      ...repeatIv(6, () => [iv('Steep ramp surge', 90, 'power', 105), iv('Steady grind', 150, 'power', 90)]),
      iv('Mid-climb breather — false flat', 240, 'power', 82),
      iv('Cueña les Cabres — the wall', 300, 'power', 112),
      ...repeatIv(4, () => [iv('Brutal ramp', 60, 'power', 116), iv('Steady grind', 90, 'power', 95)]),
      iv('Final ramps to the summit', 300, 'power', 105),
      iv('Summit sprint', 30, 'rpe', 10),
      iv('Long careful descent', 1500, 'power', 55),
      iv('Valley cruise home', 900, 'power', 65),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  // ------------------------------------------------------------------------
  // Short climbing rides — added so the plan builder can schedule a climbing
  // day inside a normal 40–60 min session. Every other climbing ride is 2.5h+,
  // which the time-budget check was rejecting for most riders.
  // ------------------------------------------------------------------------
  {
    id: 'ride-lunch-climb', name: 'Lunchtime Climb', category: 'Basics',
    description: 'One clean climb done over lunch — a short valley run-in, then a steady sustained effort to the top and straight back down.',
    intervals: [
      iv('Warm up', 300, 'power', 55),
      iv('Valley approach', 240, 'power', 68),
      iv('Lower slopes', 300, 'power', 80),
      iv('Steady climb', 600, 'power', 88),
      iv('Gradient steepens', 300, 'power', 93),
      iv('Final push to the top', 180, 'power', 98),
      iv('Descent', 240, 'power', 55),
      iv('Cool down', 180, 'power', 50),
    ],
  },
  {
    id: 'ride-hill-repeats', name: 'Hill Repeats', category: 'Basics',
    description: 'The same short, steep pitch five times over — punch up out of every hairpin, roll back down, go again.',
    repeatWholeCore: true,
    intervals: [
      iv('Warm up', 360, 'power', 55),
      iv('Spin to the base', 180, 'power', 65),
      ...repeatIv(5, () => [iv('Steep repeat', 240, 'power', 95), iv('Roll back down', 120, 'power', 55)]),
      iv('Cool down', 300, 'power', 50),
    ],
  },
  {
    id: 'ride-punchy-climb-express', name: 'Rolling Climb Express', category: 'Basics',
    description: 'Three climbs linked by quick descents in under an hour — sustained climbing legs without the all-day epic.',
    intervals: [
      iv('Warm up', 360, 'power', 55),
      iv('Rolling approach', 300, 'power', 70),
      iv('Climb one', 480, 'power', 88),
      iv('Roll down', 180, 'power', 60),
      iv('Climb two', 480, 'power', 90),
      iv('Roll down', 180, 'power', 60),
      iv('Final climb', 420, 'power', 92),
      iv('Summit surge', 60, 'power', 105),
      iv('Descent', 240, 'power', 55),
      iv('Cool down', 240, 'power', 50),
    ],
  },
  // ------------------------------------------------------------------------
  // Real-world tempo ride — the tempo purpose previously had no "Ride", so a
  // plan could never graduate its sweet-spot day from the plain Basics into a
  // narrative route the way build/peak phases intend.
  // ------------------------------------------------------------------------
  {
    id: 'ride-valley-sweetspot', name: 'Sweet spot 10+10+8', category: 'Basics',
    description: 'Rolling valley roads with three sweet spot blocks stitched between the scenic cruising — the workhorse tempo session with a view.',
    intervals: [
      iv('Warm up', 420, 'power', 58),
      iv('Rolling spin', 300, 'power', 68),
      iv('Sweet spot block', 600, 'power', 88),
      iv('Valley recover', 240, 'power', 65),
      iv('Sweet spot block', 600, 'power', 90),
      iv('Scenic roll', 300, 'power', 70),
      iv('Sweet spot block', 480, 'power', 89),
      iv('Cruise home', 420, 'power', 66),
      iv('Cool down', 300, 'power', 50),
    ],
  },
  // ------------------------------------------------------------------------
  // Recovery ride — rounds out a thin corner (only two recovery options).
  // ------------------------------------------------------------------------
  {
    id: 'ride-country-recovery', name: 'Country Lanes Recovery', category: 'Basics',
    description: 'A soft-pedal spin down quiet country lanes — nothing but easy gears to flush the legs the day after something hard.',
    intervals: [
      iv('Easy spin', 300, 'power', 50),
      iv('Gentle lanes', 600, 'power', 58),
      iv('Soft pedal', 300, 'power', 54),
      iv('Gentle lanes', 480, 'power', 60),
      iv('Easy spin home', 300, 'power', 52),
    ],
  },
  // ------------------------------------------------------------------------
  // The 40/20 Furnace — the 40/20 × 13 × 2 core (as in the Basics double) but
  // expanded into a full VO2 session: a threshold block to pre-fatigue the
  // legs before the first set, and a sustained VO2 finisher to empty the tank
  // after the second. Gives the vo2max purpose a longer, Ride-flavoured option.
  // ------------------------------------------------------------------------
  {
    id: 'ride-vo2-furnace', name: 'The 40/20 Furnace', category: 'Rides',
    description: 'Two full sets of 40/20s with a threshold block softening you up beforehand and a sustained VO2 finisher waiting on the far side. Bring a towel.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      ...repeatIv(3, () => [iv('Opener', 30, 'power', 110), iv('Easy', 60, 'power', 50)]),
      iv('Threshold pre-load', 480, 'power', 98),
      iv('Recovery', 180, 'power', 55),
      ...repeatIv(13, () => [iv('On', 40, 'power', 120), iv('Off', 20, 'power', 50)]),
      iv('Between sets recovery', 300, 'power', 55),
      ...repeatIv(13, () => [iv('On', 40, 'power', 120), iv('Off', 20, 'power', 50)]),
      iv('Recovery', 180, 'power', 55),
      iv('Sustained VO2 finisher — empty the tank', 300, 'power', 115),
      iv('Last gasp sprint', 30, 'rpe', 10),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-watchtower-repeats', name: 'Watchtower Repeats', category: 'Rides',
    description: 'Short, punchy kicks up onto a watchtower hill, fast descents back down for the recovery.',
    intervals: [
      iv('Warm up', 720, 'power', 60),
      ...repeatIv(12, () => [iv('Watchtower kick', 150, 'power', 115), iv('Descent recovery', 150, 'power', 55)]),
      iv('Cool down', 900, 'power', 50),
    ],
  },
  // ------------------------------------------------------------------------
  // Sprint Ladder (Basics) — neuromuscular sprint work. Anaerobic was the
  // thinnest purpose in the library; this adds a structured all-out ladder
  // with long full recoveries so every rep is genuinely maximal.
  // ------------------------------------------------------------------------
  {
    id: 'sprint-ladder', name: 'Sprint Ladder', category: 'Basics',
    description: 'Maximal sprints climbing then dropping in length — 5 up to 20 seconds and back — with long full recoveries so every one is flat out.',
    repeatWholeCore: true,
    intervals: [
      iv('Warm up', 480, 'power', 60),
      iv('Primer sprint', 8, 'power', 120), iv('Easy spin', 172, 'power', 55),
      iv('Sprint — 5s', 7, 'power', 170), iv('Full recovery', 235, 'power', 50),
      iv('Sprint — 10s', 12, 'power', 160), iv('Full recovery', 230, 'power', 50),
      iv('Sprint — 15s', 15, 'power', 150), iv('Full recovery', 225, 'power', 50),
      iv('Sprint — 20s', 20, 'power', 140), iv('Full recovery', 240, 'power', 50),
      iv('Sprint — 15s', 15, 'power', 150), iv('Full recovery', 225, 'power', 50),
      iv('Sprint — 10s', 12, 'power', 160), iv('Full recovery', 230, 'power', 50),
      iv('Sprint — 5s', 7, 'power', 170), iv('Full recovery', 235, 'power', 50),
      iv('Cool down', 420, 'power', 50),
    ],
  },
  // ------------------------------------------------------------------------
  // Strade Bianche (Rides · race) — the Tuscan gravel monument. Deepens the
  // thin gravel terrain and adds a distinct steep-gravel-ramp character,
  // finishing on the savage wall into Siena's Piazza del Campo.
  // ------------------------------------------------------------------------
  {
    id: 'ride-strade-bianche', name: 'Strade Bianche — The White Roads', category: 'Rides',
    description: 'Tuscany’s gravel monument — rolling tempo between brutal white-gravel sectors, saving just enough for the savage ramp up to the Piazza del Campo in Siena.',
    intervals: [
      iv('Warm up', 720, 'power', 55),
      iv('Rolling Tuscan roads', 900, 'power', 68),
      iv('Gravel sector 1 — settling in', 300, 'power', 88),
      iv('Recover on tarmac', 300, 'power', 65),
      iv('Rolling tempo', 600, 'power', 75),
      ...repeatIv(3, () => [iv('White-road gravel sector', 240, 'power', 92), iv('Steep gravel ramp', 45, 'power', 112), iv('Tarmac recovery', 360, 'power', 66)]),
      iv('Attrition tempo — legs filling up', 900, 'power', 78),
      iv('Gravel sector — Monte Sante Marie', 480, 'power', 90),
      iv('Punchy gravel rise', 60, 'power', 110),
      iv('Regroup and chase', 420, 'power', 82),
      iv('Le Tolfe — steep white ramp', 90, 'power', 115),
      iv('Run-in to Siena', 300, 'power', 88),
      iv('Via Santa Caterina — the wall', 45, 'rpe', 10),
      iv('Piazza del Campo sprint', 20, 'rpe', 10),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  // ------------------------------------------------------------------------
  // Team Time Trial 4-Up (Rides · threshold) — a new interval SHAPE: pull hard
  // just over threshold, then recover in the draft, repeated. TTT is a real
  // discipline the library didn't represent.
  // ------------------------------------------------------------------------
  {
    id: 'ride-team-time-trial', name: 'Team Time Trial — 4-Up', category: 'Rides',
    description: 'The rotating paceline — a hard turn on the front just over threshold, then tuck in and recover in the draft, over and over, holding a relentless collective pace.',
    repeatWholeCore: true,
    intervals: [
      iv('Warm up', 600, 'power', 60),
      iv('Openers', 60, 'power', 105), iv('Settle', 120, 'power', 70),
      iv('Roll out — build to pace', 180, 'power', 90),
      ...repeatIv(10, () => [iv('On the front — pull', 45, 'power', 106), iv('In the draft — recover', 90, 'power', 78)]),
      iv('Regroup at the turnaround', 240, 'power', 70),
      ...repeatIv(10, () => [iv('On the front — pull', 45, 'power', 108), iv('In the draft — recover', 90, 'power', 80)]),
      iv('Final flying kilometre', 120, 'power', 100),
      iv('Line sprint', 20, 'rpe', 10),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  // ------------------------------------------------------------------------
  // Bridge to the Break (Rides · vo2max) — a race narrative around repeated
  // VO2 bridging efforts. Gives VO2 max a real-world race story rather than
  // another clinical interval set.
  // ------------------------------------------------------------------------
  {
    id: 'ride-bridge-to-break', name: 'Bridge to the Break', category: 'Rides',
    description: 'The break keeps going up the road — each time you dig into the red to bridge across, sit in to catch your breath, then chase the next move that goes.',
    intervals: [
      iv('Warm up', 600, 'power', 58),
      iv('Nervous bunch tempo', 480, 'power', 78),
      iv('First attack goes — cover it', 120, 'power', 113),
      iv('Sit in the group', 300, 'power', 72),
      ...repeatIv(4, () => [iv('Bridge to the break', 180, 'power', 115), iv('Ease in the wheels', 240, 'power', 75)]),
      iv('Break is caught — regroup', 360, 'power', 70),
      iv('Counter-attack — dig deep', 150, 'power', 118),
      iv('Chase group tempo', 420, 'power', 84),
      ...repeatIv(3, () => [iv('Surge to hold the wheel', 120, 'power', 116), iv('Recover in the line', 180, 'power', 76)]),
      iv('Final selection forms', 240, 'power', 95),
      iv('Sprint for the line', 20, 'rpe', 10),
      iv('Cool down', 540, 'power', 50),
    ],
  },
  {
    id: 'ride-the-long-escape', name: 'The Long Escape', category: 'Rides',
    description: "Hours off the front — mostly about holding position, but every time they threaten to close the gap, you have to find another gear.",
    intervals: [
      iv('Warm up', 900, 'power', 60),
      ...repeatIv(6, () => [iv('Holding the wheel', 694, 'power', 68), iv('Surge to cover the move', 90, 'power', 115)]),
      iv('Final stretch', 696, 'power', 68),
      iv('Cool down', 1500, 'power', 50),
    ],
  },
  // ------------------------------------------------------------------------
  // Mallorca 312 (Rides · endurance) — a marquee bucket-list sportive. Long
  // scenic coastal endurance, the iconic Sa Calobra switchbacks, then a long
  // headwind drag home. Lots of variety inside one aspirational ride.
  // ------------------------------------------------------------------------
  {
    id: 'ride-mallorca-312', name: 'Mallorca 312 — Sa Calobra & the Coast', category: 'Rides',
    description: 'The legendary Mediterranean sportive — long scenic coastal miles, the iconic Sa Calobra switchback climb and descent, then a long flat drag home into the sea breeze.',
    intervals: [
      iv('Warm up', 600, 'power', 55),
      iv('Dawn rollout along the bay', 1200, 'power', 66),
      iv('Coastal endurance', 1800, 'power', 70),
      iv('Rolling headland', 900, 'power', 74),
      iv('Sa Calobra — into the switchbacks', 600, 'power', 82),
      ...repeatIv(4, () => [iv('Hairpin ramp', 90, 'power', 98), iv('Steady switchback', 210, 'power', 88)]),
      iv('Sa Calobra upper slopes', 480, 'power', 90),
      iv('Coll dels Reis — over the top', 60, 'power', 104),
      iv('Long technical descent', 900, 'power', 55),
      iv('Regroup — feed zone spin', 600, 'power', 64),
      iv('Rolling inland tempo', 1200, 'power', 72),
      iv('The long flat drag home — headwind', 1500, 'power', 76),
      iv('Grinding into the breeze', 600, 'power', 74),
      iv('Final run to the line', 300, 'power', 80),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  // ==========================================================================
  // 30 new Rides — added to deepen thin purpose pools (tempo/sweet spot had
  // zero real Rides; anaerobic/race/vo2max/threshold/recovery had gaps).
  // See planner.js WORKOUT_PURPOSE / WORKOUT_TERRAIN for tagging.
  // ==========================================================================
  {
    id: 'ride-harbor-circuit', name: 'Tempo 6×10 with surges', category: 'Basics',
    description: 'A looping harbor-town road with headland corners that keep kicking the pace up before it settles again.',
    intervals: [
      iv('Warm up', 720, 'power', 60),
      ...repeatIv(6, () => [iv('Tempo', 570, 'power', 78), iv('Headland surge', 30, 'power', 90), iv('Recover', 120, 'power', 60)]),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-canal-towpath', name: 'Tempo 9×7 with ramps', category: 'Basics',
    description: 'A flat towpath grind broken every few minutes by a short punchy ramp up onto a lock gate.',
    intervals: [
      iv('Warm up', 600, 'power', 58),
      ...repeatIv(9, () => [iv('Towpath tempo', 400, 'power', 78), iv('Lock gate ramp', 20, 'power', 100)]),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-border-run', name: 'Tempo 2×60, building', category: 'Basics',
    description: 'A long flat road along a borderland — calm outbound, then a building headwind for the way home.',
    intervals: [
      iv('Warm up', 720, 'power', 60),
      iv('Tailwind tempo', 3600, 'power', 75),
      iv('Headwind tempo', 3600, 'power', 80),
      iv('Cool down', 1080, 'power', 50),
    ],
  },
  {
    id: 'ride-orchard-backroads', name: 'Rolling tempo 9×5', category: 'Basics',
    description: 'Quiet backroads through orchard country, a steady rhythm with just enough undulation to keep it honest.',
    intervals: [
      iv('Warm up', 600, 'power', 58),
      ...repeatIv(9, () => [iv('Rolling tempo', 300, 'power', 76), iv('Rise', 300, 'power', 82)]),
      iv('Cool down', 1200, 'power', 50),
    ],
  },
  {
    id: 'ride-reservoir-ring', name: 'Progressive tempo 3×28', category: 'Basics',
    description: 'Three laps of a reservoir road, each one a notch harder than the last.',
    intervals: [
      iv('Warm up', 600, 'power', 60),
      iv('Lap 1', 1680, 'power', 72),
      iv('Lap 2', 1680, 'power', 76),
      iv('Lap 3', 1680, 'power', 80),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-delta-causeway', name: 'Tempo 8×7 with kicks', category: 'Basics',
    description: 'A chain of low bridges over marsh country — tempo pace with a hard kick over every crossing.',
    intervals: [
      iv('Warm up', 600, 'power', 60),
      ...repeatIv(8, () => [iv('Causeway tempo', 420, 'power', 78), iv('Bridge ramp', 60, 'power', 95), iv('Recover', 90, 'power', 58)]),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-quarry-climb-ladder', name: 'Sweet spot ladder 12/18/22', category: 'Basics',
    description: 'A long steady drag up an old quarry road, tackled in ever-longer sweet spot rungs.',
    intervals: [
      iv('Warm up', 720, 'power', 60),
      iv('Rung 1', 720, 'power', 88),
      iv('Recover', 240, 'power', 60),
      iv('Rung 2', 1080, 'power', 90),
      iv('Recover', 240, 'power', 60),
      iv('Rung 3', 1320, 'power', 92),
      iv('Cool down', 900, 'power', 50),
    ],
  },
  {
    id: 'ride-meadowline-rollers', name: 'Sweet spot rollers 15×5', category: 'Basics',
    description: 'Low meadow country, one climb blurring into the next — the effort never really settles.',
    intervals: [
      iv('Warm up', 720, 'power', 60),
      ...repeatIv(15, () => [iv('Roller', 150, 'power', 89), iv('Crest', 150, 'power', 93)]),
      iv('Cool down', 1080, 'power', 50),
    ],
  },
  {
    id: 'ride-timber-road-sweetspot', name: 'Sweet spot 40+35', category: 'Basics',
    description: 'A long forest logging-road climb, sheltered until the exposed clearing at the top.',
    intervals: [
      iv('Warm up', 1200, 'power', 58),
      iv('Sheltered climb', 2400, 'power', 88),
      iv('Recover', 480, 'power', 62),
      iv('Exposed clearing', 2100, 'power', 92),
      iv('Cool down', 1500, 'power', 50),
    ],
  },
  {
    id: 'ride-twin-peaks-sweep', name: 'Sweet spot 2×27', category: 'Basics',
    description: 'Two short sustained climbs linked by a valley sweep — a taste of a proper climbing day without the full epic length.',
    intervals: [
      iv('Warm up', 720, 'power', 58),
      iv('Climb one', 1650, 'power', 90),
      iv('Valley sweep', 600, 'power', 65),
      iv('Climb two', 1650, 'power', 92),
      iv('Cool down', 900, 'power', 50),
    ],
  },
  {
    id: 'ride-velodrome-nights', name: 'Velodrome Nights', category: 'Rides',
    description: 'Flying-lap sprints under the lights, full recovery between each one — quality over quantity.',
    intervals: [
      iv('Warm up', 720, 'power', 58),
      ...repeatIv(3, () => [iv('Opener', 15, 'power', 110), iv('Easy', 45, 'power', 55)]),
      ...repeatIv(8, () => [iv('Flying sprint', 15, 'power', 170), iv('Full recovery', 240, 'power', 50)]),
      iv('Cool down', 900, 'power', 50),
    ],
  },
  {
    id: 'ride-alleycat-dash', name: 'Alleycat Dash', category: 'Rides',
    description: 'Unpredictable, intersection-to-intersection sprints — you never quite know when the next one is coming.',
    intervals: [
      iv('Warm up', 900, 'power', 58),
      iv('Sprint', 12, 'power', 105), iv('Gap', 150, 'power', 60),
      iv('Sprint', 18, 'power', 110), iv('Gap', 90, 'power', 60),
      iv('Sprint', 10, 'power', 120), iv('Gap', 240, 'power', 60),
      iv('Sprint', 15, 'power', 108), iv('Gap', 120, 'power', 60),
      iv('Sprint', 20, 'power', 100), iv('Gap', 180, 'power', 60),
      iv('Sprint', 10, 'power', 115), iv('Gap', 90, 'power', 60),
      iv('Sprint', 15, 'power', 105), iv('Gap', 210, 'power', 60),
      iv('Sprint', 20, 'power', 110), iv('Gap', 150, 'power', 60),
      iv('Sprint', 12, 'power', 120), iv('Gap', 180, 'power', 60),
      iv('Sprint', 15, 'power', 110), iv('Gap', 240, 'power', 60),
      iv('Cool down', 600, 'power', 50),
    ],
  },
  {
    id: 'ride-match-play', name: 'Match Play', category: 'Rides',
    description: 'Paired efforts that mimic real racing — close the gap, then find one more gear to win the sprint.',
    intervals: [
      iv('Warm up', 900, 'power', 60),
      ...repeatIv(10, () => [iv('Close the gap', 30, 'power', 115), iv('Recover', 10, 'power', 50), iv('Win the sprint', 12, 'power', 170), iv('Easy', 240, 'power', 55)]),
      iv('Cool down', 900, 'power', 50),
    ],
  },
  {
    id: 'ride-closing-speed-repeats', name: 'Closing Speed Repeats', category: 'Rides',
    description: 'A short circuit, ridden lap after lap, each one ending in an all-out sprint for the line as the legs get heavier.',
    intervals: [
      iv('Warm up', 720, 'power', 60),
      ...repeatIv(6, () => [iv('Lap', 585, 'power', 70), iv('Sprint for the line', 15, 'power', 175)]),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-twilight-crit', name: 'Twilight Crit', category: 'Rides',
    description: 'A short, sharp criterium under lights — tight corners, no let-up.',
    intervals: [
      iv('Warm up', 900, 'power', 60),
      ...repeatIv(22, () => [iv('Corner acceleration', 45, 'power', 105), iv('Straight recover', 75, 'power', 65)]),
      iv('Cool down', 900, 'power', 50),
    ],
  },
  {
    id: 'ride-crossroads-sprint-circuit', name: 'Crossroads Sprint Circuit', category: 'Rides',
    description: 'A loop through a string of small crossroads towns, taking turns on the front between each intermediate sprint.',
    intervals: [
      iv('Warm up', 720, 'power', 60),
      ...repeatIv(5, () => [iv('Rotating pulls', 580, 'power', 75), iv('Village sprint', 20, 'power', 100), iv('Easy', 180, 'power', 55)]),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-puncheurs-ambush', name: "Puncheur's Ambush", category: 'Rides',
    description: 'A day built for the puncheur — no long climbs, just one steep kick after another.',
    intervals: [
      iv('Warm up', 900, 'power', 60),
      ...repeatIv(18, () => [iv('Steep kick', 90, 'power', 115), iv('Recover', 180, 'power', 65)]),
      iv('Cool down', 900, 'power', 50),
    ],
  },
  {
    id: 'ride-points-race-series', name: 'Points Race Series', category: 'Rides',
    description: 'A points-race format — a string of intermediate sprints where the stakes, and the effort, climb every time.',
    intervals: [
      iv('Warm up', 900, 'power', 60),
      iv('Intermediate sprint 1', 20, 'power', 85), iv('Easy', 950, 'power', 55),
      iv('Intermediate sprint 2', 20, 'power', 90), iv('Easy', 950, 'power', 55),
      iv('Intermediate sprint 3', 20, 'power', 95), iv('Easy', 950, 'power', 55),
      iv('Intermediate sprint 4', 20, 'power', 100), iv('Easy', 950, 'power', 55),
      iv('Intermediate sprint 5', 20, 'power', 105), iv('Easy', 950, 'power', 55),
      iv('Intermediate sprint 6 — winner takes it', 20, 'power', 110), iv('Easy', 950, 'power', 55),
      iv('Cool down', 900, 'power', 50),
    ],
  },
  {
    id: 'ride-the-straight-line', name: 'The Straight Line', category: 'Rides',
    description: 'A long flat road, calm out, then a building crosswind for the effort home.',
    intervals: [
      iv('Warm up', 720, 'power', 60),
      iv('Calm threshold', 1800, 'power', 97),
      iv('Recover', 360, 'power', 55),
      iv('Windier threshold', 1800, 'power', 101),
      iv('Cool down', 900, 'power', 50),
    ],
  },
  {
    id: 'ride-spine-road-threshold', name: 'Spine Road Threshold', category: 'Rides',
    description: 'A long ridge-top road, threshold held through a string of small rises that never quite let you settle.',
    intervals: [
      iv('Warm up', 1080, 'power', 58),
      ...repeatIv(14, () => [iv('Rise', 150, 'power', 95), iv('Crest', 150, 'power', 102)]),
      iv('Cool down', 1080, 'power', 50),
    ],
  },
  {
    id: 'ride-alone-at-the-front', name: 'Alone at the Front', category: 'Rides',
    description: "You've gone clear and it's just you and the road — hold it as long as you can.",
    intervals: [
      iv('Warm up', 1080, 'power', 58),
      ...Array.from({ length: 11 }, (_, i) => iv('Holding the gap', 300, 'power', Math.round(103 - i * 0.7))),
      iv('Cool down', 1500, 'power', 50),
    ],
  },
  {
    id: 'ride-garden-path-spin', name: 'Garden Path Spin', category: 'Rides',
    description: 'A light, easy spin through parkland — nothing to prove, just moving.',
    intervals: [
      iv('Easy spin', 3000, 'power', 52),
    ],
  },
  {
    id: 'ride-quiet-streets-loop', name: 'Quiet Streets Loop', category: 'Rides',
    description: 'Empty neighborhood streets before the day gets going — gently rolling but never pushed.',
    intervals: [
      ...repeatIv(6, () => [iv('Quiet streets', 780, 'power', 54), iv('Gentle rise', 120, 'power', 62)]),
    ],
  },
  {
    id: 'ride-watermill-loop', name: 'Watermill Loop', category: 'Rides',
    description: 'A steady loop following an old millstream, calm and unhurried.',
    intervals: [
      iv('Warm up', 600, 'power', 58),
      iv('Endurance', 3600, 'power', 70),
      iv('Cool down', 600, 'power', 50),
    ],
  },

  // ---------- 5 new endurance rides + 2 new sweet spot rides ----------
  // Added to fill duration gaps identified against the real library spread:
  // endurance was thin in the 55-100min band, sweet spot was thin at the
  // 45-60min and 95-125min bands (see WORKOUT_PURPOSE notes in planner.js
  // for the sweet spot duration story). All seven were checked against
  // smartScaleWorkout (the duration slider engine, above) across 30min-6hr
  // targets before shipping, to confirm each keeps a genuine high-intensity
  // signature block that duplicates as the ride is stretched, rather than
  // degrading into plain Endurance filler.
  {
    id: 'ride-rolling-reserve', name: 'Rolling Reserve', category: 'Rides',
    description: 'Steady rolling endurance with two sweet spot surges, mirrored front and back half.',
    intervals: [
      iv('Warm up', 300, 'power', 55),
      iv('Endurance', 120, 'power', 75), iv('Endurance', 120, 'power', 85),
      iv('Endurance', 120, 'power', 75), iv('Endurance', 120, 'power', 85),
      iv('Endurance', 120, 'power', 75), iv('Endurance', 120, 'power', 85),
      iv('Endurance', 120, 'power', 75),
      iv('Sweet spot', 180, 'power', 90), iv('Endurance', 60, 'power', 75),
      iv('Sweet spot', 300, 'power', 90), iv('Endurance', 60, 'power', 75),
      iv('Sweet spot', 180, 'power', 90), iv('Endurance', 60, 'power', 75),
      iv('Sweet spot', 300, 'power', 90),
      iv('Endurance', 120, 'power', 75), iv('Endurance', 120, 'power', 85),
      iv('Endurance', 120, 'power', 75), iv('Endurance', 120, 'power', 85),
      iv('Endurance', 120, 'power', 75), iv('Endurance', 120, 'power', 85),
      iv('Endurance', 120, 'power', 75),
      iv('Sweet spot', 180, 'power', 90), iv('Endurance', 60, 'power', 75),
      iv('Sweet spot', 300, 'power', 90), iv('Endurance', 60, 'power', 75),
      iv('Sweet spot', 180, 'power', 90), iv('Endurance', 60, 'power', 75),
      iv('Sweet spot', 300, 'power', 90),
      iv('Cool down', 300, 'power', 55),
    ],
  },
  {
    id: 'ride-race-legs', name: 'Race Legs', category: 'Rides',
    description: "Race tactics condensed into an hour — sharp openers, a threshold rally, two sprints, then a string of threshold snaps to close it out.",
    intervals: [
      iv('Warm up', 300, 'power', 55),
      iv('Endurance', 60, 'power', 80), iv('Sweet spot', 45, 'power', 90),
      iv('Endurance', 120, 'power', 75), iv('Sweet spot', 45, 'power', 90),
      iv('Threshold', 90, 'power', 100), iv('Threshold', 90, 'power', 105),
      iv('VO2 max', 60, 'power', 110), iv('Recovery', 60, 'power', 80),
      iv('Sprint', 20, 'power', 115), iv('Endurance', 90, 'power', 70),
      iv('Sprint', 20, 'power', 115), iv('Endurance', 480, 'power', 80),
      iv('Endurance', 90, 'power', 75), iv('Endurance', 90, 'power', 85),
      iv('Endurance', 90, 'power', 75), iv('Endurance', 90, 'power', 85),
      iv('Endurance', 90, 'power', 75), iv('Endurance', 90, 'power', 85),
      iv('Endurance', 90, 'power', 75), iv('Endurance', 90, 'power', 85),
      iv('Endurance', 90, 'power', 75),
      iv('Threshold', 45, 'power', 90), iv('Threshold', 45, 'power', 95),
      iv('Threshold', 45, 'power', 90), iv('Threshold', 45, 'power', 95),
      iv('Threshold', 45, 'power', 90), iv('Threshold', 45, 'power', 95),
      iv('Threshold', 45, 'power', 90), iv('Threshold', 45, 'power', 95),
      iv('Threshold', 45, 'power', 90),
      iv('Endurance', 360, 'power', 80),
      iv('Cool down', 240, 'power', 50),
    ],
  },
  {
    id: 'ride-foothills', name: 'Foothills', category: 'Rides',
    // Whole-core repeat opted in: the terrain narrative below is built from
    // short punchy climbs (mostly classified as short "anchor" efforts by
    // the scaler, not stretchable "base" blocks), so without this flag a
    // long duration-slider stretch would have nothing eligible to duplicate
    // and would fall back to plain Endurance filler past ~150min. With it,
    // stretching this ride re-runs the whole foothills route as an extra
    // lap instead, keeping the climbing character intact at any length.
    repeatWholeCore: true,
    description: 'A rolling foothills route that never settles — short punchy climbs and gentle drags, cresting a genuine Wall near the end before the run home.',
    intervals: [
      iv('Warm up', 300, 'power', 55),
      iv('Flat / rolling', 20, 'power', 65), iv('Climb', 15, 'power', 86),
      iv('Flat / rolling', 60, 'power', 65), iv('Gentle climb', 15, 'power', 76),
      iv('Flat / rolling', 15, 'power', 65), iv('Gentle climb', 75, 'power', 76),
      iv('Flat / rolling', 50, 'power', 65), iv('Flat / rolling', 55, 'power', 65),
      iv('Climb', 50, 'power', 86), iv('Flat / rolling', 15, 'power', 65),
      iv('Climb', 20, 'power', 86), iv('Flat / rolling', 20, 'power', 65),
      iv('Gentle climb', 30, 'power', 76), iv('Climb', 55, 'power', 86),
      iv('Gentle climb', 120, 'power', 76), iv('Flat / rolling', 75, 'power', 65),
      iv('Steep climb', 70, 'power', 96), iv('Climb', 55, 'power', 86),
      iv('Flat / rolling', 75, 'power', 65), iv('Gentle climb', 55, 'power', 76),
      iv('Flat / rolling', 15, 'power', 65), iv('Gentle climb', 45, 'power', 76),
      iv('Flat / rolling', 240, 'power', 65), iv('Gentle climb', 15, 'power', 76),
      iv('Flat / rolling', 15, 'power', 65), iv('Gentle climb', 75, 'power', 76),
      iv('Flat / rolling', 120, 'power', 65), iv('Gentle climb', 65, 'power', 76),
      iv('Climb', 50, 'power', 86), iv('Flat / rolling', 15, 'power', 65),
      iv('Climb', 20, 'power', 86), iv('Flat / rolling', 20, 'power', 65),
      iv('Gentle climb', 25, 'power', 76), iv('Climb', 60, 'power', 86),
      iv('Flat / rolling', 25, 'power', 65), iv('Climb', 75, 'power', 86),
      iv('Gentle climb', 20, 'power', 76), iv('Flat / rolling', 75, 'power', 65),
      iv('Steep climb', 70, 'power', 96), iv('Climb', 50, 'power', 86),
      iv('Flat / rolling', 80, 'power', 65), iv('Gentle climb', 40, 'power', 76),
      iv('Flat / rolling', 15, 'power', 65), iv('Gentle climb', 45, 'power', 76),
      iv('Flat / rolling', 220, 'power', 65), iv('Steep climb', 15, 'power', 96),
      iv('Gentle climb', 30, 'power', 76), iv('Very steep', 40, 'power', 105),
      iv('Climb', 25, 'power', 86), iv('Steep climb', 15, 'power', 96),
      iv('Gentle climb', 15, 'power', 76), iv('Steep climb', 30, 'power', 96),
      iv('Descent', 20, 'power', 55), iv('Flat / rolling', 15, 'power', 65),
      iv('Steep climb', 45, 'power', 96), iv('Flat / rolling', 150, 'power', 65),
      iv('Gentle climb', 70, 'power', 76), iv('Flat / rolling', 150, 'power', 65),
      iv('Gentle climb', 15, 'power', 76), iv('Flat / rolling', 15, 'power', 65),
      iv('Steep climb', 42, 'power', 96), iv('Flat / rolling', 40, 'power', 65),
      iv('Wall', 50, 'power', 114), iv('Steep climb', 45, 'power', 96),
      iv('Flat / rolling', 35, 'power', 65),
      iv('Cool down', 300, 'power', 50),
    ],
  },
  {
    id: 'ride-ziggurat', name: 'Ziggurat', category: 'Rides',
    description: 'A mirrored step pyramid — sweet spot and endurance blocks shrink to a single minute, spike through VO2 max and threshold, then rebuild all the way back out.',
    intervals: [
      iv('Warm up', 300, 'power', 55),
      iv('Endurance', 360, 'power', 70),
      iv('Sweet spot', 180, 'power', 90), iv('Sweet spot', 180, 'power', 80),
      iv('Endurance', 180, 'power', 70),
      iv('Sweet spot', 120, 'power', 90), iv('Sweet spot', 120, 'power', 80),
      iv('Endurance', 120, 'power', 70),
      iv('Sweet spot', 60, 'power', 90), iv('Sweet spot', 60, 'power', 80),
      iv('Endurance', 60, 'power', 70),
      iv('VO2 max', 120, 'power', 110), iv('Threshold', 120, 'power', 100),
      iv('Sweet spot', 120, 'power', 90),
      iv('Endurance', 600, 'power', 70), iv('Endurance', 600, 'power', 80), iv('Endurance', 600, 'power', 70),
      iv('Sweet spot', 120, 'power', 90), iv('Threshold', 120, 'power', 100), iv('VO2 max', 120, 'power', 110),
      iv('Endurance', 60, 'power', 70),
      iv('Sweet spot', 60, 'power', 80), iv('Sweet spot', 60, 'power', 90),
      iv('Endurance', 120, 'power', 70),
      iv('Sweet spot', 120, 'power', 80), iv('Sweet spot', 120, 'power', 90),
      iv('Endurance', 180, 'power', 70),
      iv('Sweet spot', 180, 'power', 80), iv('Sweet spot', 180, 'power', 90),
      iv('Endurance', 360, 'power', 70),
      iv('Cool down', 300, 'power', 50),
    ],
  },
  {
    id: 'ride-rising-tide', name: 'Rising Tide', category: 'Rides',
    description: 'Three rolling endurance waves, each one followed by a sharper finish than the last — a VO2 opener, a threshold rally, then a trio of escalating VO2 sprints.',
    intervals: [
      iv('Warm up', 300, 'power', 55),
      iv('Endurance', 240, 'power', 70), iv('Endurance', 240, 'power', 80),
      iv('Sweet spot', 240, 'power', 90),
      iv('Endurance', 240, 'power', 80), iv('Endurance', 240, 'power', 70),
      iv('VO2 max', 60, 'power', 110), iv('Endurance', 60, 'power', 70), iv('VO2 max', 60, 'power', 120),
      iv('Endurance', 240, 'power', 70), iv('Endurance', 240, 'power', 80),
      iv('Sweet spot', 240, 'power', 90),
      iv('Endurance', 240, 'power', 80), iv('Endurance', 240, 'power', 70),
      iv('Threshold', 240, 'power', 100),
      iv('Endurance', 240, 'power', 70), iv('Endurance', 240, 'power', 80),
      iv('Sweet spot', 240, 'power', 90),
      iv('Endurance', 240, 'power', 80), iv('Endurance', 240, 'power', 70),
      iv('VO2 max', 20, 'power', 120), iv('Endurance', 60, 'power', 70),
      iv('VO2 max', 20, 'power', 130), iv('Endurance', 60, 'power', 70),
      iv('VO2 max', 20, 'power', 140),
      iv('Endurance', 360, 'power', 70),
      iv('Cool down', 300, 'power', 50),
    ],
  },
  {
    id: 'ride-hollow-road-sweetspot', name: 'Sweet spot rolling 3-phase (short)', category: 'Basics',
    // v2: same 50min / ~54 TSS as the original 7-interval version, restructured
    // into three rolling phases (each its own repeatIv group, so the duration
    // slider can grow/shrink them independently) plus a final kick, instead of
    // two flat blocks -- built for a visibly busier, wavier profile chart.
    description: "A short, sheltered out-and-back for the lunch-break days — three rolling sweet spot phases building in intensity, with a punchy final kick before the descent home.",
    intervals: [
      iv('Warm up', 360, 'power', 58),
      ...repeatIv(4, () => [iv('Rise', 70, 'power', 90), iv('Ease', 50, 'power', 85)]),
      iv('Recover', 90, 'power', 60),
      ...repeatIv(5, () => [iv('Rise', 80, 'power', 92), iv('Ease', 60, 'power', 87)]),
      iv('Recover', 60, 'power', 60),
      ...repeatIv(4, () => [iv('Rise', 60, 'power', 92), iv('Ease', 40, 'power', 87)]),
      iv('Recover', 110, 'power', 60),
      iv('Final kick', 500, 'power', 89),
      iv('Cool down', 300, 'power', 50),
    ],
  },
  {
    id: 'ride-tableland-traverse', name: 'Sweet spot rolling 4-phase (long)', category: 'Basics',
    // v2: same 103min / ~114 TSS as the original 9-interval version. Each of
    // the four plateaus is now its own rolling repeatIv group instead of one
    // flat block, so the ride reads as genuine terrain texture rather than
    // four held power targets, while scaling exactly the same way.
    description: "A long, wide-open traverse across four rolling plateaus of sweet spot effort — the wind picks up through the second before the longest, steadiest stretch of the ride.",
    intervals: [
      iv('Warm up', 600, 'power', 58),
      ...repeatIv(3, () => [iv('Rise', 200, 'power', 90), iv('Ease', 100, 'power', 85)]),
      iv('Recover', 240, 'power', 60),
      ...repeatIv(6, () => [iv('Gust', 120, 'power', 93), iv('Lull', 60, 'power', 85)]),
      iv('Recover', 240, 'power', 60),
      ...repeatIv(5, () => [iv('Rise', 180, 'power', 93), iv('Ease', 120, 'power', 87)]),
      iv('Recover', 240, 'power', 60),
      ...repeatIv(3, () => [iv('Rise', 180, 'power', 92), iv('Ease', 120, 'power', 84)]),
      iv('Cool down', 480, 'power', 50),
    ],
  },

  // ---------- 25 new rides: duration-gap fill (20-30 / 30-50 / 51-75min) ----------
  // A duration audit found three under-served bands: 20-30min (only 1 ride),
  // 30-50min (no endurance, no race), and 51-75min (no tempo). These 25 fill
  // them, weighted toward the purposes most conspicuously absent in each band
  // and deliberately adding zero climbing content (already the most
  // over-represented purpose). Every one is built from repeatIv() oscillating
  // phases rather than flat blocks, matching the Hollow Road / Tableland v2
  // style directly above. The four crit/race rides (Downtown Crit, Alley
  // Sprint Series, Chase Group, Midweek Crit) are the library's first sub-75min
  // race simulations -- genuinely variable attack/settle/surge structures, not
  // single-target blocks wearing a race tag.

  // --- 20-30min bucket (2 recovery, 2 vo2max, 1 anaerobic) ---
  {
    id: 'ride-loose-legs-spin', name: 'Loose Legs Spin', category: 'Rides',
    description: "An easy, unhurried spin with a gentle float through the back half — legs-only recovery, nothing to chase.",
    intervals: [
      iv('Warm up', 120, 'power', 55),
      ...repeatIv(4, () => [iv('Ease', 90, 'power', 57), iv('Loose', 90, 'power', 52)]),
      ...repeatIv(3, () => [iv('Float', 80, 'power', 59), iv('Settle', 60, 'power', 54)]),
      iv('Cool down', 60, 'power', 50),
    ],
  },
  {
    id: 'ride-flush-lap', name: 'Flush Lap', category: 'Rides',
    description: "A flush ride for the day after something hard — drifts even easier through the second half.",
    intervals: [
      iv('Warm up', 150, 'power', 56),
      ...repeatIv(5, () => [iv('Turn', 80, 'power', 58), iv('Ease', 70, 'power', 53)]),
      ...repeatIv(4, () => [iv('Float', 60, 'power', 60), iv('Drift', 45, 'power', 52)]),
      iv('Cool down', 180, 'power', 48),
    ],
  },
  {
    id: 'ride-short-fuse', name: 'Short Fuse', category: 'Rides',
    description: "30-on/30-off VO2 max intervals in two waves with a short breather between — quick, sharp, done before lunch.",
    intervals: [
      iv('Warm up', 240, 'power', 58),
      iv('Opener', 60, 'power', 85),
      ...repeatIv(10, () => [iv('On', 30, 'power', 118), iv('Off', 30, 'power', 55)]),
      iv('Recover', 120, 'power', 55),
      ...repeatIv(4, () => [iv('On', 30, 'power', 122), iv('Off', 30, 'power', 55)]),
      iv('Cool down', 180, 'power', 50),
    ],
  },
  {
    id: 'ride-three-minute-warning', name: 'Three Minute Warning', category: 'Rides',
    description: "Three-minute VO2 efforts that build in two steps rather than holding flat — fewer reps, more sustained bite.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      iv('Opener', 60, 'power', 88),
      ...repeatIv(3, () => [iv('Build', 90, 'power', 110), iv('Push', 90, 'power', 116), iv('Off', 180, 'power', 58)]),
      iv('Cool down', 180, 'power', 50),
    ],
  },
  {
    id: 'ride-matchstick', name: 'Matchstick', category: 'Rides',
    description: "A sprint ladder that climbs in intensity then eases back down — ten short, sharp efforts of varying length.",
    intervals: [
      iv('Warm up', 240, 'power', 58),
      iv('Opener', 20, 'power', 92),
      iv('Settle', 100, 'power', 56),
      iv('Rung 1', 8, 'power', 150), iv('Recover', 52, 'power', 56),
      iv('Rung 2', 12, 'power', 145), iv('Recover', 58, 'power', 56),
      iv('Rung 3', 15, 'power', 140), iv('Recover', 65, 'power', 56),
      iv('Rung 4', 18, 'power', 138), iv('Recover', 62, 'power', 56),
      iv('Rung 5', 10, 'power', 155), iv('Recover', 60, 'power', 56),
      iv('Rung 6', 20, 'power', 135), iv('Recover', 70, 'power', 56),
      iv('Rung 7', 20, 'power', 130), iv('Recover', 70, 'power', 56),
      iv('Rung 8', 15, 'power', 140), iv('Recover', 65, 'power', 56),
      iv('Rung 9', 12, 'power', 145), iv('Recover', 58, 'power', 56),
      iv('Rung 10', 8, 'power', 150), iv('Recover', 52, 'power', 56),
      iv('Cool down', 210, 'power', 50),
    ],
  },

  // --- 30-50min bucket (3 endurance, 3 race, 2 threshold, 2 sweetspot) ---
  {
    id: 'ride-commuter-miles', name: 'Commuter Miles', category: 'Rides',
    description: "A simple rolling endurance spin, done in half an hour or so.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      ...repeatIv(7, () => [iv('Roll', 120, 'power', 70), iv('Ease', 90, 'power', 63)]),
      iv('Cool down', 240, 'power', 52),
    ],
  },
  {
    id: 'ride-fireroad-amble', name: 'Fireroad Amble', category: 'Rides',
    description: "Rolling endurance with a punchier back half — two wave patterns instead of one held pace.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      ...repeatIv(5, () => [iv('Roll', 150, 'power', 72), iv('Ease', 100, 'power', 63)]),
      ...repeatIv(3, () => [iv('Rise', 90, 'power', 78), iv('Settle', 90, 'power', 65)]),
      iv('Cool down', 240, 'power', 52),
    ],
  },
  {
    id: 'ride-towpath-ramble', name: 'Towpath Ramble', category: 'Rides',
    description: "Long, flat, and steady — a genuine easy cruise from start to finish.",
    intervals: [
      iv('Warm up', 360, 'power', 58),
      ...repeatIv(9, () => [iv('Steady', 140, 'power', 69), iv('Ease', 100, 'power', 62)]),
      iv('Cool down', 300, 'power', 52),
    ],
  },
  {
    id: 'ride-downtown-crit', name: 'Downtown Crit', category: 'Rides',
    description: "Attack, get chased down, settle, repeat — a bridge effort and a field sprint close it out.",
    intervals: [
      iv('Warm up', 360, 'power', 58),
      iv('Opener', 15, 'power', 100),
      ...repeatIv(6, () => [iv('Attack', 25, 'power', 112), iv('Chase', 40, 'power', 90), iv('Settle', 100, 'power', 65)]),
      iv('Bridge effort', 45, 'power', 105),
      iv('Recover', 120, 'power', 62),
      ...repeatIv(4, () => [iv('Counter', 20, 'power', 115), iv('Recover', 60, 'power', 66)]),
      iv('Sprint for the line', 15, 'power', 130),
      iv('Cool down', 240, 'power', 52),
    ],
  },
  {
    id: 'ride-alley-sprint-series', name: 'Alley Sprint Series', category: 'Rides',
    description: "A sprint-heavy crit simulation — eight jumps out of the corners, a late attack, and a closing sprint.",
    intervals: [
      iv('Warm up', 360, 'power', 58),
      iv('Opener', 15, 'power', 98),
      ...repeatIv(8, () => [iv('Jump', 15, 'power', 128), iv('Roll it out', 45, 'power', 88), iv('Settle', 100, 'power', 64)]),
      iv('Late attack', 30, 'power', 115),
      iv('Recover', 90, 'power', 62),
      ...repeatIv(3, () => [iv('Jump', 15, 'power', 130), iv('Roll it out', 45, 'power', 86)]),
      iv('Sprint for the line', 15, 'power', 132),
      iv('Cool down', 240, 'power', 52),
    ],
  },
  {
    id: 'ride-chase-group', name: 'Chase Group', category: 'Rides',
    description: "Off the front, sit up, a bridge attempt, counters in the group, a late attack, and a sprint for the line.",
    intervals: [
      iv('Warm up', 360, 'power', 58),
      iv('Opener', 20, 'power', 100),
      ...repeatIv(5, () => [iv('Off the front', 60, 'power', 108), iv('Sit up', 120, 'power', 70)]),
      iv('Bridge attempt', 50, 'power', 118),
      iv('Recover in the group', 180, 'power', 68),
      ...repeatIv(6, () => [iv('Counter', 30, 'power', 120), iv('Recover', 70, 'power', 66)]),
      iv('Late attack', 40, 'power', 116),
      iv('Recover', 100, 'power', 66),
      iv('Sprint for the line', 15, 'power', 132),
      iv('Cool down', 270, 'power', 52),
    ],
  },
  {
    id: 'ride-redline-ledge', name: 'Redline Ledge', category: 'Rides',
    description: "2×12 threshold, each interval built from alternating hold/push micro-blocks instead of one flat target.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      iv('Opener', 60, 'power', 88),
      ...repeatIv(2, () => [
        ...repeatIv(4, () => [iv('Hold', 90, 'power', 98), iv('Push', 90, 'power', 103)]),
        iv('Recover', 240, 'power', 62),
      ]),
      iv('Cool down', 240, 'power', 52),
    ],
  },
  {
    id: 'ride-steady-burn', name: 'Steady Burn', category: 'Rides',
    description: "3×10 threshold, alternating hold/push blocks spread across three sets.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      iv('Opener', 60, 'power', 88),
      ...repeatIv(3, () => [
        ...repeatIv(5, () => [iv('Hold', 60, 'power', 97), iv('Push', 60, 'power', 102)]),
        iv('Recover', 180, 'power', 62),
      ]),
      iv('Cool down', 240, 'power', 52),
    ],
  },
  {
    id: 'ride-corridor-run', name: 'Sweet spot rolling 5+4 (short)', category: 'Basics',
    description: "A compact sweet spot ride — two rolling, undulating phases with a short recovery between.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      ...repeatIv(5, () => [iv('Rise', 90, 'power', 91), iv('Ease', 60, 'power', 85)]),
      iv('Recover', 180, 'power', 60),
      ...repeatIv(4, () => [iv('Rise', 80, 'power', 92), iv('Ease', 60, 'power', 86)]),
      iv('Cool down', 240, 'power', 52),
    ],
  },
  {
    id: 'ride-ridge-line', name: 'Sweet spot rolling 6+5', category: 'Basics',
    description: "A longer rolling sweet spot ride — more reps per phase, undulating rather than flat.",
    intervals: [
      iv('Warm up', 360, 'power', 58),
      ...repeatIv(6, () => [iv('Rise', 100, 'power', 90), iv('Ease', 70, 'power', 84)]),
      iv('Recover', 210, 'power', 60),
      ...repeatIv(5, () => [iv('Rise', 90, 'power', 92), iv('Ease', 60, 'power', 86)]),
      iv('Cool down', 270, 'power', 52),
    ],
  },

  // --- 51-75min bucket (4 tempo, 3 sweetspot, 2 threshold, 1 race) ---
  {
    id: 'ride-long-straightaway', name: 'Rolling tempo 13×2', category: 'Basics',
    description: "Straightforward rolling tempo, one wave pattern held for the whole ride.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      ...repeatIv(13, () => [iv('Push', 125, 'power', 79), iv('Ease', 85, 'power', 72)]),
      iv('Cool down', 300, 'power', 52),
    ],
  },
  {
    id: 'ride-steady-state-special', name: 'Tempo blocks 7+4', category: 'Basics',
    description: "Tempo in two blocks with a breather between — the second block runs slightly harder than the first.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      ...repeatIv(7, () => [iv('Push', 150, 'power', 80), iv('Ease', 90, 'power', 73)]),
      iv('Recover', 180, 'power', 62),
      ...repeatIv(4, () => [iv('Push', 120, 'power', 81), iv('Ease', 80, 'power', 74)]),
      iv('Cool down', 300, 'power', 52),
    ],
  },
  {
    id: 'ride-cruise-control', name: 'Rolling tempo 11×2', category: 'Basics',
    description: "A gentle tempo ride — long, evenly paced rolling waves start to finish.",
    intervals: [
      iv('Warm up', 360, 'power', 58),
      ...repeatIv(11, () => [iv('Push', 130, 'power', 79), iv('Ease', 90, 'power', 72)]),
      iv('Cool down', 300, 'power', 52),
    ],
  },
  {
    id: 'ride-wide-open-road', name: 'Tempo blocks 8+5', category: 'Basics',
    description: "Rolling tempo in two blocks either side of a recovery, building slightly into the second.",
    intervals: [
      iv('Warm up', 360, 'power', 58),
      ...repeatIv(8, () => [iv('Push', 160, 'power', 80), iv('Ease', 100, 'power', 73)]),
      iv('Recover', 210, 'power', 62),
      ...repeatIv(5, () => [iv('Push', 140, 'power', 81), iv('Ease', 90, 'power', 74)]),
      iv('Cool down', 330, 'power', 52),
    ],
  },
  {
    id: 'ride-overpass-circuit', name: 'Sweet spot rolling 6+6', category: 'Basics',
    description: "Two rolling sweet spot phases with a proper recovery between them.",
    intervals: [
      iv('Warm up', 360, 'power', 58),
      ...repeatIv(6, () => [iv('Rise', 110, 'power', 90), iv('Ease', 80, 'power', 84)]),
      iv('Recover', 240, 'power', 60),
      ...repeatIv(6, () => [iv('Rise', 100, 'power', 92), iv('Ease', 70, 'power', 85)]),
      iv('Cool down', 300, 'power', 52),
    ],
  },
  {
    id: 'ride-backbone-ridge', name: 'Sweet spot rolling 7+6', category: 'Basics',
    description: "A full hour of rolling sweet spot effort, with a longer warm-up to match.",
    intervals: [
      iv('Warm up', 420, 'power', 58),
      ...repeatIv(7, () => [iv('Rise', 120, 'power', 90), iv('Ease', 90, 'power', 84)]),
      iv('Recover', 240, 'power', 60),
      ...repeatIv(6, () => [iv('Rise', 110, 'power', 92), iv('Ease', 80, 'power', 85)]),
      iv('Cool down', 330, 'power', 52),
    ],
  },
  {
    id: 'ride-causeway-crossing', name: 'Sweet spot rolling 8+7', category: 'Basics',
    description: "Two long rolling sweet spot phases separated by a short recovery, building through repeated surges.",
    intervals: [
      iv('Warm up', 420, 'power', 58),
      ...repeatIv(8, () => [iv('Rise', 130, 'power', 90), iv('Ease', 90, 'power', 84)]),
      iv('Recover', 270, 'power', 60),
      ...repeatIv(7, () => [iv('Rise', 110, 'power', 92), iv('Ease', 80, 'power', 85)]),
      iv('Cool down', 360, 'power', 52),
    ],
  },
  {
    id: 'ride-anvil-work', name: 'Anvil Work', category: 'Rides',
    description: "3×12 threshold across a full hour, alternating hold/push blocks throughout.",
    intervals: [
      iv('Warm up', 360, 'power', 58),
      iv('Opener', 60, 'power', 88),
      ...repeatIv(3, () => [
        ...repeatIv(6, () => [iv('Hold', 60, 'power', 98), iv('Push', 60, 'power', 103)]),
        iv('Recover', 240, 'power', 62),
      ]),
      iv('Cool down', 300, 'power', 52),
    ],
  },
  {
    id: 'ride-the-grind', name: 'The Grind', category: 'Rides',
    description: "2×20 threshold, the classic long-block protocol — hold/push texture running through each 20.",
    intervals: [
      iv('Warm up', 420, 'power', 58),
      iv('Opener', 60, 'power', 88),
      ...repeatIv(2, () => [
        ...repeatIv(10, () => [iv('Hold', 60, 'power', 97), iv('Push', 60, 'power', 102)]),
        iv('Recover', 300, 'power', 62),
      ]),
      iv('Cool down', 300, 'power', 52),
    ],
  },
  {
    id: 'ride-midweek-crit', name: 'Midweek Crit', category: 'Rides',
    description: "A longer race simulation — attacks, chases, counters, a bridge, and a sprint to close it out.",
    intervals: [
      iv('Warm up', 390, 'power', 58),
      iv('Opener', 20, 'power', 100),
      ...repeatIv(9, () => [iv('Attack', 25, 'power', 112), iv('Chase', 40, 'power', 90), iv('Settle', 110, 'power', 65)]),
      iv('Bridge effort', 50, 'power', 106),
      iv('Recover', 150, 'power', 64),
      ...repeatIv(8, () => [iv('Counter', 20, 'power', 116), iv('Recover', 65, 'power', 66)]),
      iv('Late attack', 40, 'power', 116),
      iv('Recover', 90, 'power', 66),
      iv('Sprint for the line', 15, 'power', 132),
      iv('Cool down', 300, 'power', 52),
    ],
  },

  // ------------------------------------------------------------------------
  // Coverage batch: short quality sessions. The Stage 0 audit flagged four
  // purposes with only 2 options inside a ~45min session ceiling (threshold,
  // vo2max, anaerobic, climbing), and climbing had nothing at all between
  // the three short climbs (~40-50min) and the 2.5h mountain epics. Three
  // rides per purpose: two short ones each, plus two mid-length climbs.
  // ------------------------------------------------------------------------
  {
    id: 'ride-castle-hill', name: 'Castle Hill Dash', category: 'Rides',
    description: "One steep old-town climb taken twice — cobble-flavoured ramps, a kick through the gate, and a fast roll back down between.",
    intervals: [
      iv('Warm up', 300, 'power', 55),
      iv('Through the streets', 240, 'power', 68),
      iv('Lower ramps', 480, 'power', 88),
      iv('Gradient bites', 240, 'power', 94),
      iv('Kick through the gate', 60, 'power', 104),
      iv('Roll back down', 120, 'power', 55),
      iv('Second ascent', 360, 'power', 92),
      iv('Final to the walls', 120, 'power', 100),
      iv('Descent', 180, 'power', 55),
      iv('Cool down', 180, 'power', 50),
    ],
  },
  {
    id: 'ride-two-cols-loop', name: 'Two Cols Loop', category: 'Rides',
    description: "A pair of honest mid-size cols joined by a valley road — the classic morning loop, done properly.",
    intervals: [
      iv('Warm up', 360, 'power', 55),
      iv('Valley run-in', 480, 'power', 68),
      iv('Col one — lower slopes', 600, 'power', 85),
      iv('Col one — steady grind', 360, 'power', 90),
      iv('Col one — final bend', 120, 'power', 96),
      iv('Descent', 300, 'power', 55),
      iv('Between the valleys', 360, 'power', 70),
      iv('Col two — settle in', 480, 'power', 88),
      iv('Col two — steepens', 360, 'power', 92),
      iv('Col two — last kilometre', 180, 'power', 98),
      iv('Summit surge', 45, 'power', 106),
      iv('Descent', 300, 'power', 55),
      iv('Cool down', 240, 'power', 50),
    ],
  },
  {
    id: 'ride-monastery-road', name: 'Monastery Road', category: 'Rides',
    description: "One long mountain to a clifftop monastery — hairpins through the forest, a false flat to breathe on, and a final ramp to the gates.",
    intervals: [
      iv('Warm up', 420, 'power', 55),
      iv('Rolling approach', 600, 'power', 68),
      iv('Foothills', 480, 'power', 78),
      iv('Lower slopes', 720, 'power', 84),
      iv('Forest hairpins', 600, 'power', 87),
      iv('Hairpins tighten', 480, 'power', 90),
      iv('False flat', 240, 'power', 80),
      iv('Upper mountain', 600, 'power', 89),
      iv('Gradient bites', 300, 'power', 94),
      iv('Ramp to the gates', 180, 'power', 99),
      iv('Summit', 60, 'power', 104),
      iv('Long descent', 600, 'power', 55),
      iv('Valley home', 420, 'power', 65),
      iv('Cool down', 300, 'power', 50),
    ],
  },
  {
    id: 'ride-quayside-tt', name: 'Quayside TT', category: 'Rides',
    description: "A half-hour harbour time trial — three building stages along the water, a breather at the turn, and one last drive home.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      iv('Opener', 60, 'power', 88),
      iv('Stage one', 300, 'power', 96),
      iv('Stage two', 300, 'power', 99),
      iv('Stage three', 240, 'power', 102),
      iv('Turn at the pier', 120, 'power', 60),
      iv('Drive for home', 240, 'power', 100),
      iv('Cool down', 240, 'power', 52),
    ],
  },
  {
    id: 'ride-lighthouse-run', name: 'Lighthouse Run', category: 'Rides',
    description: "Threshold out to the lighthouse and back — headwind surges on the way out, a steady tailwind drive home with a late kick.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      iv('Opener', 60, 'power', 88),
      iv('Coast road approach', 180, 'power', 68),
      ...repeatIv(4, () => [iv('Hold the pace', 120, 'power', 97), iv('Into the wind', 60, 'power', 102)]),
      iv('Turn at the lighthouse', 90, 'power', 62),
      iv('Tailwind drive', 480, 'power', 98),
      iv('Last kilometre', 120, 'power', 103),
      iv('Cool down', 240, 'power', 52),
    ],
  },
  {
    id: 'ride-viaduct-repeats', name: 'Viaduct Repeats', category: 'Rides',
    description: "3×8 threshold over the old viaduct circuit — hold/push halves each lap, and a surge over the top to finish.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      iv('Opener', 60, 'power', 88),
      ...repeatIv(2, () => [
        ...repeatIv(4, () => [iv('Hold', 60, 'power', 96), iv('Push', 60, 'power', 101)]),
        iv('Recover', 180, 'power', 62),
      ]),
      ...repeatIv(4, () => [iv('Hold', 60, 'power', 96), iv('Push', 60, 'power', 101)]),
      iv('Surge over the top', 30, 'power', 110),
      iv('Cool down', 270, 'power', 52),
    ],
  },
  {
    id: 'ride-rooftop-repeats', name: 'Rooftop Repeats', category: 'Rides',
    description: "40/20s up on the parking-garage circuit — three shrinking waves, each one a little harder than the last.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      iv('Opener', 60, 'power', 85),
      ...repeatIv(8, () => [iv('On', 40, 'power', 117), iv('Off', 20, 'power', 55)]),
      iv('Recover', 180, 'power', 58),
      ...repeatIv(5, () => [iv('On', 40, 'power', 120), iv('Off', 20, 'power', 55)]),
      iv('Recover', 120, 'power', 58),
      ...repeatIv(4, () => [iv('On', 40, 'power', 123), iv('Off', 20, 'power', 55)]),
      iv('Cool down', 240, 'power', 52),
    ],
  },
  {
    id: 'ride-seawall-surges', name: 'Seawall Surges', category: 'Rides',
    description: "Two-minute VO2 surges along the seawall with rolling recoveries — and one extra, harder, when you think you're done.",
    intervals: [
      iv('Warm up', 300, 'power', 58),
      iv('Opener', 60, 'power', 88),
      iv('Roll to the seawall', 240, 'power', 66),
      ...repeatIv(5, () => [iv('Surge', 120, 'power', 114), iv('Roll', 150, 'power', 60)]),
      iv('One more', 90, 'power', 118),
      iv('Cool down', 270, 'power', 52),
    ],
  },
  {
    id: 'ride-gorge-attacks', name: 'Gorge Attacks', category: 'Rides',
    description: "Three waves of attacks through the gorge — long ones first, short and sharp in the middle, one last dig at the end.",
    intervals: [
      iv('Warm up', 330, 'power', 58),
      iv('Opener', 60, 'power', 88),
      iv('Into the gorge', 240, 'power', 68),
      ...repeatIv(3, () => [iv('Attack', 90, 'power', 112), iv('Ease', 120, 'power', 58)]),
      iv('Regroup', 180, 'power', 60),
      ...repeatIv(3, () => [iv('Attack', 60, 'power', 118), iv('Ease', 90, 'power', 58)]),
      iv('Regroup', 180, 'power', 60),
      iv('Last dig', 120, 'power', 110),
      iv('Ease', 120, 'power', 58),
      iv('Cool down', 270, 'power', 52),
    ],
  },
  {
    id: 'ride-station-sprints', name: 'Station Sprints', category: 'Rides',
    description: "Standing starts from the station forecourt, then flying sprints once the legs are lit — short, maximal, and done in half an hour.",
    intervals: [
      iv('Warm up', 300, 'power', 56),
      iv('Opener', 20, 'power', 95),
      iv('Settle', 100, 'power', 56),
      ...repeatIv(6, () => [iv('Standing start', 15, 'power', 150), iv('Spin out', 105, 'power', 56)]),
      iv('Recover', 120, 'power', 58),
      ...repeatIv(4, () => [iv('Flying sprint', 10, 'power', 160), iv('Spin out', 110, 'power', 56)]),
      iv('Cool down', 240, 'power', 50),
    ],
  },
  {
    id: 'ride-green-lights', name: 'Green Lights', category: 'Rides',
    description: "Crosstown sprint work — jump every green light, cruise between them, then a handful of longer beat-the-light efforts to finish.",
    intervals: [
      iv('Warm up', 300, 'power', 56),
      ...repeatIv(10, () => [iv('Green light', 12, 'power', 145), iv('Cruise', 108, 'power', 58)]),
      iv('Recover', 150, 'power', 58),
      ...repeatIv(4, () => [iv('Beat the light', 20, 'power', 135), iv('Cruise', 100, 'power', 58)]),
      iv('Cool down', 240, 'power', 50),
    ],
  },
  {
    id: 'ride-final-two-hundred', name: 'Final Two Hundred', category: 'Rides',
    description: "Leadout-and-sprint practice — wind it up, launch for the line, sit up, go again. The last one is full gas.",
    intervals: [
      iv('Warm up', 330, 'power', 56),
      iv('Opener', 20, 'power', 95),
      iv('Settle', 130, 'power', 58),
      ...repeatIv(4, () => [iv('Leadout', 45, 'power', 110), iv('Sprint', 12, 'power', 155), iv('Sit up', 123, 'power', 56)]),
      iv('Roll', 240, 'power', 62),
      ...repeatIv(3, () => [iv('Leadout', 30, 'power', 115), iv('Sprint', 15, 'power', 150), iv('Sit up', 135, 'power', 56)]),
      iv('Full gas leadout', 60, 'power', 108),
      iv('Sprint for the line', 15, 'power', 160),
      iv('Cool down', 270, 'power', 50),
    ],
  },

  // ==========================================================================
  // 12 high-texture replacement Rides (6 tempo, 6 sweet spot) — built to the
  // "recipe vs place" standard: each is a named real-world road with a profile
  // that only reads in one direction. They replace the demoted road-word
  // tempo/sweet-spot rides. Purpose + terrain tags live in planner.js.
  // ==========================================================================
  {
    id: 'ride-snaefell-circuit', name: 'Snaefell Circuit', category: 'Rides',
    description: "A lap of the island's mountain road circuit — village drags, the long climb over the shoulder, and a fast run back down to the promenade.",
    intervals: [
      iv('Warm up', 420, 'power', 57),
      iv('Promenade rollout', 300, 'power', 66),
      iv('Union Mills drag', 240, 'power', 76),
      iv('Ballacraine bends', 180, 'power', 82),
      iv('Kirk Michael straight', 300, 'power', 74),
      iv('Barregarrow dip', 120, 'power', 86),
      iv('Ramsey hairpin', 90, 'power', 70),
      iv('The Mountain Mile', 600, 'power', 80),
      iv('Gust at the Bungalow', 120, 'power', 88),
      iv('Brandywell', 240, 'power', 78),
      iv('Creg-ny-Baa descent', 300, 'power', 55),
      iv('Hillberry run-in', 240, 'power', 77),
      iv('Sprint to the grandstand', 60, 'rpe', 9),
      iv('Cool down', 420, 'power', 50),
    ],
  },
  {
    id: 'ride-otago-rail-trail', name: 'Otago Rail Trail', category: 'Rides',
    description: 'An old goods line turned gravel path — a gradient so consistent it never lets you settle, through two tunnels and a schist gorge.',
    intervals: [
      iv('Warm up', 480, 'power', 57),
      iv('Middlemarch flats', 300, 'power', 68),
      iv('The grade begins', 480, 'power', 76),
      iv('Prices Creek viaduct', 180, 'power', 72),
      iv('Schist cutting', 630, 'power', 78),
      iv('Poolburn tunnel', 240, 'power', 82),
      iv('Between tunnels', 120, 'power', 70),
      iv('Second tunnel', 210, 'power', 83),
      iv('Gorge headwind', 360, 'power', 79),
      iv('Auripo straight', 360, 'power', 77),
      iv('Summit at Wedderburn', 180, 'power', 66),
      iv('Long freewheel', 300, 'power', 55),
      iv('Ranfurly run-in', 240, 'power', 74),
      iv('Cool down', 420, 'power', 50),
    ],
  },
  {
    id: 'ride-bonneville-speed-week', name: 'Bonneville Speed Week', category: 'Rides',
    description: 'Rotating turns across the salt with two others. Nobody says it, but the turns keep getting shorter.',
    intervals: [
      iv('Warm up', 540, 'power', 57),
      iv('Roll out to the flats', 360, 'power', 68),
      iv('Turn on the front', 300, 'power', 84),
      iv('In the wheels', 210, 'power', 72),
      iv('Turn on the front', 270, 'power', 85),
      iv('In the wheels', 210, 'power', 71),
      iv('Gust across the salt', 60, 'power', 89),
      iv('Turn on the front', 240, 'power', 85),
      iv('In the wheels', 180, 'power', 72),
      iv('Heat haze', 300, 'power', 76),
      iv('Turn on the front', 180, 'power', 86),
      iv('In the wheels', 180, 'power', 71),
      iv('Turn on the front', 150, 'power', 87),
      iv('In the wheels', 150, 'power', 72),
      iv('Turn on the front', 120, 'power', 88),
      iv('In the wheels', 120, 'power', 73),
      iv('Mirage section', 360, 'power', 74),
      iv('Salt crust drag', 240, 'power', 79),
      iv('Alone to the marker', 480, 'power', 78),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-camino-frances', name: 'Camino Francés', category: 'Rides',
    description: 'The pilgrim road across the meseta. Hours of wheat and sky, and then a hill town appears with its church on top of it.',
    intervals: [
      iv('Warm up', 660, 'power', 57),
      iv('Meseta rollout', 900, 'power', 70),
      iv('Cruz de Ferro drag', 300, 'power', 78),
      iv('Descent to the valley', 240, 'power', 58),
      iv('Hill town: Castrojeriz', 360, 'power', 86),
      iv('Wheat plains', 720, 'power', 72),
      iv('Hill town: Villafranca', 420, 'power', 88),
      iv('River crossing', 300, 'power', 66),
      iv('Open meseta', 780, 'power', 74),
      iv('Hill town: O Cebreiro', 480, 'power', 89),
      iv('Ridge road to Sarria', 720, 'power', 76),
      iv('Cool down', 720, 'power', 50),
    ],
  },
  {
    id: 'ride-island-hopper', name: 'Island Hopper', category: 'Rides',
    description: 'Three islands, two ferries. Chase the sailing, sit on the deck watching your legs go cold, then start again on the other side.',
    intervals: [
      iv('Warm up', 660, 'power', 56),
      iv('Machair coast road', 1020, 'power', 72),
      iv('Chasing the sailing', 780, 'power', 82),
      iv('Slipway queue', 240, 'power', 42),
      iv('The crossing', 480, 'power', 38),
      iv('Ramp off, cold legs', 300, 'power', 66),
      iv('Causeway crosswind', 600, 'power', 78),
      iv('Moor road', 900, 'power', 74),
      iv('Second slipway', 180, 'power', 44),
      iv('Short crossing', 300, 'power', 38),
      iv('Final island, headwind', 1140, 'power', 79),
      iv('Last village drag', 360, 'power', 85),
      iv('Cool down', 660, 'power', 50),
    ],
  },
  {
    id: 'ride-zeeland-delta', name: 'Zeeland Delta', category: 'Rides',
    description: 'Dyke roads and storm barriers with nothing between you and the North Sea. The echelon forms, and then it breaks.',
    intervals: [
      iv('Warm up', 780, 'power', 56),
      iv('Polder rollout', 900, 'power', 68),
      iv('Dyke road, tailwind', 720, 'power', 72),
      iv('Turn into the wind', 600, 'power', 80),
      iv('Echelon forms', 420, 'power', 84),
      iv('Sheltered village', 300, 'power', 66),
      iv('Storm barrier bridge', 480, 'power', 82),
      iv('Exposed span', 240, 'power', 88),
      iv('Descent off the bridge', 180, 'power', 58),
      iv('Second polder', 900, 'power', 74),
      iv('Crosswind sector', 600, 'power', 81),
      iv('Gap in the echelon', 120, 'power', 90),
      iv('Regroup', 360, 'power', 70),
      iv('Long dyke drag', 900, 'power', 77),
      iv('Harbour approach', 600, 'power', 75),
      iv('Final bridge', 300, 'power', 84),
      iv('Cool down', 780, 'power', 50),
    ],
  },
  {
    id: 'ride-cheddar-gorge', name: 'Cheddar Gorge', category: 'Rides',
    description: "Straight out of the village into the limestone. The hairpin at the bottom is the hardest thing you'll do all day, and it's in the first two minutes.",
    intervals: [
      iv('Warm up', 600, 'power', 58),
      iv('Through the village', 240, 'power', 70),
      iv('The hairpin', 120, 'power', 93),
      iv('First cliffs', 360, 'power', 90),
      iv('Steeper pinch', 180, 'power', 94),
      iv('Between the crags', 240, 'power', 89),
      iv('Horseshoe bend', 150, 'power', 93),
      iv('Easing to the plateau', 300, 'power', 88),
      iv('Top road', 180, 'power', 78),
      iv('Cool down', 360, 'power', 50),
    ],
  },
  {
    id: 'ride-sa-calobra', name: 'Sa Calobra', category: 'Rides',
    description: 'Up from the cove through twenty-six bends. Each hairpin pitches, each straight lets you off — barely.',
    intervals: [
      iv('Warm up', 540, 'power', 58),
      iv('Sea-level cove', 300, 'power', 68),
      iv('Ramp out of the cove', 180, 'power', 88),
      iv('Bend', 90, 'power', 92),
      iv('Straight', 90, 'power', 84),
      iv('Bend', 90, 'power', 93),
      iv('Straight', 120, 'power', 85),
      iv('Bend', 120, 'power', 94),
      iv('Straight', 120, 'power', 86),
      iv('The knot bridge', 60, 'power', 90),
      iv('Bend', 90, 'power', 93),
      iv('Straight', 120, 'power', 85),
      iv('Bend', 90, 'power', 94),
      iv('Open drag', 180, 'power', 89),
      iv('Bend', 90, 'power', 93),
      iv('Final ramps', 180, 'power', 92),
      iv('Tunnels', 120, 'power', 87),
      iv('Summit', 60, 'power', 65),
      iv('Descent', 600, 'power', 48),
      iv('Cool down', 360, 'power', 50),
    ],
  },
  {
    id: 'ride-atacama-haul-road', name: 'Atacama Haul Road', category: 'Rides',
    description: "A copper mine's spiral haul road, wide enough for trucks. Three ramps out of the pit, and the terraces between them get shorter every time.",
    intervals: [
      iv('Warm up', 720, 'power', 58),
      iv('Pit floor approach', 300, 'power', 70),
      iv('Ramp one', 720, 'power', 89),
      iv('Loading terrace', 240, 'power', 65),
      iv('Switchback', 120, 'power', 93),
      iv('Ramp two', 660, 'power', 91),
      iv('Terrace two', 180, 'power', 65),
      iv('Switchback', 120, 'power', 94),
      iv('Ramp three', 600, 'power', 92),
      iv('Dust section', 180, 'power', 87),
      iv('Rim road', 240, 'power', 70),
      iv('Cool down', 420, 'power', 50),
    ],
  },
  {
    id: 'ride-blue-ridge-parkway', name: 'Blue Ridge Parkway', category: 'Rides',
    description: 'Long exposed ridge blocks with brief tree cover between them. The wind finds you every time the canopy opens.',
    intervals: [
      iv('Warm up', 720, 'power', 58),
      iv('Valley approach', 360, 'power', 70),
      iv('First ridge block', 900, 'power', 88),
      iv('Tree cover', 240, 'power', 68),
      iv('Overlook pinch', 120, 'power', 93),
      iv('Exposed section', 1080, 'power', 91),
      iv('Gap saddle', 300, 'power', 66),
      iv('Wind on the ridge', 180, 'power', 92),
      iv('Long final ridge', 900, 'power', 90),
      iv('Tunnel', 120, 'power', 85),
      iv('Descent', 240, 'power', 55),
      iv('Cool down', 360, 'power', 50),
    ],
  },
  {
    id: 'ride-mount-lemmon', name: 'Mount Lemmon', category: 'Rides',
    description: 'Desert floor to pine forest at a gradient that barely varies for forty kilometres. The most metronomic climb there is.',
    intervals: [
      iv('Warm up', 720, 'power', 57),
      iv('Desert floor', 420, 'power', 70),
      iv('Milepost one to five', 1200, 'power', 89),
      iv('Windy Point pull-out', 300, 'power', 66),
      iv('Milepost six to twelve', 1020, 'power', 90),
      iv('Cactus flat', 240, 'power', 78),
      iv('Milepost thirteen to eighteen', 900, 'power', 91),
      iv('Switchback', 180, 'power', 93),
      iv('Final pines', 720, 'power', 92),
      iv('Ski village', 180, 'power', 70),
      iv('Cool down', 540, 'power', 50),
    ],
  },
  {
    id: 'ride-carter-bar', name: 'Carter Bar', category: 'Rides',
    description: 'Two moorland passes on the old border road, with a full descent to the border post in between. No shelter on either one.',
    intervals: [
      iv('Warm up', 840, 'power', 57),
      iv('Redesdale valley', 600, 'power', 70),
      iv('First moor climb, lower', 900, 'power', 89),
      iv('Cattle grid pinch', 120, 'power', 93),
      iv('First moor climb, upper', 780, 'power', 90),
      iv('Border post summit', 240, 'power', 66),
      iv('Descent into Scotland', 480, 'power', 55),
      iv('Valley link', 480, 'power', 74),
      iv('Second climb, lower', 900, 'power', 89),
      iv('Exposed shoulder', 300, 'power', 92),
      iv('Second climb, upper', 720, 'power', 91),
      iv('Wind gap', 120, 'power', 94),
      iv('Ridge run', 420, 'power', 70),
      iv('Cool down', 600, 'power', 50),
    ],
  },

  // ---------- "pain" workouts ----------
  // Deliberately, wildly over-tough sessions -- built to be close to
  // impossible on a pure FTP-percentage basis. They're marked `pain: true`
  // so the Library can badge/filter them, but they carry NO entry in
  // WORKOUT_PURPOSE (planner.js) -- that's what keeps them out of the
  // training plan generator. This is intentional, not an oversight: do not
  // "fix" these by adding a purpose tag. If a workout belongs in this
  // section, leave WORKOUT_PURPOSE alone for its id.
  {
    id: 'ride-hack-saw', name: 'Hacksaw', category: 'Rides', pain: true,
    description: 'Careful.',
    intervals: [
      iv('Warm up', 300, 'power', 55),
      ...repeatIv(12, () => [
        iv('Sweet spot', 60, 'power', 90),
        iv('Threshold', 60, 'power', 120),
        iv('VO2 max', 60, 'power', 140),
        iv('Sprint', 60, 'power', 160),
        iv('Recovery', 60, 'power', 55),
      ]),
    ],
  },
  {
    id: 'ride-darth-maul', name: 'Darth Maul', category: 'Rides', pain: true,
    description: 'Pain.',
    intervals: [
      iv('Warm up', 900, 'power', 55),
      iv('Sprint', 30, 'power', 150),
      iv('VO2 max', 60, 'power', 130),
      iv('VO2 max', 60, 'power', 120),
      iv('Threshold', 120, 'power', 110),
      iv('Threshold', 120, 'power', 100),
      iv('Sweet spot', 180, 'power', 90),
      iv('Sweet spot', 180, 'power', 80),
      iv('Recovery', 300, 'power', 55),
      iv('Sprint', 30, 'power', 150),
      iv('VO2 max', 60, 'power', 130),
      iv('VO2 max', 60, 'power', 120),
      iv('Threshold', 120, 'power', 110),
      iv('Threshold', 120, 'power', 100),
      iv('Sweet spot', 180, 'power', 90),
      iv('Sweet spot', 180, 'power', 80),
      iv('Recovery', 300, 'power', 55),
      iv('Sweet spot', 300, 'power', 90),
      iv('Threshold', 300, 'power', 100),
      iv('Threshold', 180, 'power', 110),
      iv('VO2 max', 120, 'power', 120),
      iv('VO2 max', 20, 'power', 140),
      iv('VO2 max', 30, 'power', 170),
      iv('VO2 max', 20, 'power', 140),
      iv('VO2 max', 120, 'power', 120),
      iv('Threshold', 180, 'power', 110),
      iv('Sweet spot', 300, 'power', 100),
      iv('Sweet spot', 300, 'power', 90),
      iv('Recovery', 300, 'power', 55),
      iv('Sweet spot', 180, 'power', 80),
      iv('Sweet spot', 180, 'power', 90),
      iv('Threshold', 120, 'power', 100),
      iv('Threshold', 120, 'power', 110),
      iv('VO2 max', 60, 'power', 120),
      iv('VO2 max', 60, 'power', 130),
      iv('Sprint', 30, 'power', 150),
      iv('Recovery', 300, 'power', 55),
      iv('Sweet spot', 180, 'power', 80),
      iv('Sweet spot', 180, 'power', 90),
      iv('Threshold', 120, 'power', 100),
      iv('Threshold', 120, 'power', 110),
      iv('VO2 max', 60, 'power', 120),
      iv('VO2 max', 60, 'power', 130),
      iv('Sprint', 30, 'power', 150),
      iv('Cool down', 900, 'power', 55),
    ],
  },
  {
    id: 'ride-quad-homicide', name: 'Quad homicide', category: 'Rides', pain: true,
    description: 'Or is it lung homicide?',
    intervals: [
      iv('Warm up', 300, 'power', 55),
      iv('Threshold', 180, 'power', 100),
      iv('Sweet spot', 300, 'power', 90),
      iv('Sprint', 30, 'power', 200),
      iv('VO2 max', 120, 'power', 120),
      iv('Sprint', 30, 'power', 130),
      iv('VO2 max', 120, 'power', 110),
      iv('Sprint', 30, 'power', 130),
      iv('VO2 max', 120, 'power', 120),
      iv('Sprint', 30, 'power', 200),
      iv('Warm up', 300, 'power', 55),
      iv('Threshold', 180, 'power', 100),
      iv('Sweet spot', 300, 'power', 90),
      iv('Sprint', 30, 'power', 130),
      iv('VO2 max', 120, 'power', 110),
      iv('Sprint', 30, 'power', 200),
      iv('VO2 max', 120, 'power', 120),
      iv('Sprint', 30, 'power', 200),
      iv('VO2 max', 120, 'power', 110),
      iv('Sprint', 30, 'power', 130),
      iv('Warm up', 300, 'power', 55),
      iv('Sprint', 30, 'power', 130),
      iv('VO2 max', 120, 'power', 110),
      iv('Sprint', 30, 'power', 200),
      iv('VO2 max', 120, 'power', 120),
      iv('Sprint', 30, 'power', 200),
      iv('VO2 max', 120, 'power', 110),
      iv('Sprint', 30, 'power', 130),
      iv('Sweet spot', 300, 'power', 90),
      iv('Threshold', 180, 'power', 100),
      iv('Warm up', 300, 'power', 55),
      iv('Sprint', 30, 'power', 200),
      iv('VO2 max', 120, 'power', 120),
      iv('Sprint', 30, 'power', 130),
      iv('VO2 max', 120, 'power', 110),
      iv('Sprint', 30, 'power', 130),
      iv('VO2 max', 120, 'power', 120),
      iv('Sprint', 30, 'power', 200),
      iv('Sweet spot', 300, 'power', 90),
      iv('Threshold', 180, 'power', 100),
      iv('Cool down', 300, 'power', 50),
    ],
  },
  {
    id: 'ride-no-thanks', name: 'No thanks', category: 'Rides', pain: true,
    description: 'Unless??',
    intervals: [
      iv('Warm up', 300, 'power', 55),
      ...repeatIv(15, i => (i < 14
        ? [iv('VO2 max', 120, 'power', 130), iv('Threshold', 60, 'power', 90)]
        : [iv('VO2 max', 120, 'power', 130)])),
      iv('Cool down', 300, 'power', 50),
    ],
  },
];
const CATEGORIES = ['All', 'Rides', 'Basics', 'Recovery', 'Endurance', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Max', 'FTP Test'];

// Training-type filter chips (Recovery/Endurance/Tempo/.../FTP Test) need to
// match a workout's real training purpose, not its top-level category --
// every built-in library workout is tagged 'Rides' or 'Basics' at that top
// level, with the actual training type living in WORKOUT_PURPOSE (planner.js)
// instead.
const CATEGORY_TO_PURPOSE = {
  'Recovery': 'recovery',
  'Endurance': 'endurance',
  'Tempo': 'tempo',
  'Sweet Spot': 'sweetspot',
  'Threshold': 'threshold',
  'VO2 Max': 'vo2max',
  'FTP Test': 'test',
};

// Anaerobic is only 3 workouts — too thin to justify its own chip, which
// would look near-empty most of the time. Folded into VO2 Max instead, so
// picking VO2 Max surfaces both under one "high intensity" chip.
//
// Climbing and Race are dropped as standalone chips too (display only —
// planner.js's WORKOUT_PURPOSE tagging, which the plan generator actually
// keys off, is untouched). Climbing workouts are long sustained blocks in
// the 80-98% FTP range, the same character as Threshold's sustained
// near-FTP efforts, just longer-form. Race workouts are repeated short,
// sharp accelerations well above threshold, the same character as VO2
// Max's short hard intervals.
const PURPOSE_CHIP_ALIASES = {
  'anaerobic': 'vo2max',
  'climbing': 'threshold',
  'race': 'vo2max',
};

// Maps a purpose key (planner.js's WORKOUT_PURPOSE values, after aliasing)
// to the display label used both by the filter chips above and by the small
// per-card type chip in the library list.
const PURPOSE_TO_LABEL = {
  recovery: 'Recovery', endurance: 'Endurance', tempo: 'Tempo',
  sweetspot: 'Sweet Spot', threshold: 'Threshold', vo2max: 'VO2 Max', test: 'FTP Test',
};

// The small type chip shown on each library card. Pain rides always show
// just "Pain" — they intentionally carry no WORKOUT_PURPOSE tag (see the
// "pain" workouts section below), and even for the few that do get scored
// against a zone, their long recovery segments between spikes would drag a
// naive average down to something misleading like "Endurance". A workout
// designed to be nearly impossible should never read as an easy day.
function workoutTypeChip(w, cvd) {
  const palette = cvd ? ZONE_COLORS.colorblind : ZONE_COLORS.standard;
  if (w.pain) return { label: 'Pain', color: RED };
  const purpose = WORKOUT_PURPOSE[w.id];
  if (!purpose) return null;
  const resolved = PURPOSE_CHIP_ALIASES[purpose] || purpose;
  const label = PURPOSE_TO_LABEL[resolved];
  if (!label) return null;
  return { label, color: palette[label] || SUB };
}

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
  function beep(freq, duration, gainVal, wave = 'sine') {
    const ctx = ensure();
    if (!ctx || gainVal <= 0) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = wave;
    gain.gain.value = gainVal;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }
  // Plays a short sequence of notes, each with its own delay (ms) from now
  // — used for the richer finish fanfare and the halfway/final chimes.
  function chime(notes, gainVal) {
    notes.forEach(n => setTimeout(() => beep(n.freq, n.duration, gainVal, n.wave), n.delay));
  }
  // Plays one of the designed workout cues (see SOUND_CUE_PACKS) — a waveform,
  // base pitch, and a short pattern of notes expressed as a ratio of that
  // pitch, an offset in ms, and a duration multiplier. Tuned in the Trbo
  // Sound Lab sandbox so every alert in the app shares one sonic identity.
  function playCue(def, gainVal) {
    if (!def || gainVal <= 0) return;
    def.pattern.forEach(note => {
      setTimeout(() => beep(def.freq * note.ratio, (def.dur / 1000) * note.mult, gainVal, def.wave), note.offset);
    });
  }
  return { beep, chime, playCue };
}

// ---------- trainer connectivity (Web Bluetooth FTMS) ----------
// Wahoo's proprietary trainer-control characteristic. It isn't a separate
// BLE service — it lives inside the standard Cycling Power Service (0x1818)
// alongside the normal power-measurement characteristic, which is why the
// CPS fallback path below can reach it once FTMS (0x1826) isn't found.
// Opcodes reverse-engineered and documented by the GoldenCheetah and
// SwiftySensorsTrainers open-source projects (same approach Zwift and
// TrainerRoad use for Wahoo ERG support — no Wahoo API agreement involved).
const WAHOO_CONTROL_UUID = 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b';
const WAHOO_OP = { unlock: 0x20, setErgMode: 0x42, setSimGrade: 0x46 };

function useTrainer() {
  const [status, setStatus] = useState('disconnected');
  const [deviceName, setDeviceName] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [power, setPower] = useState(null);
  const [cadence, setCadence] = useState(null);
  const [hasControl, setHasControl] = useState(false);
  const [devices, setDevices] = useState([]);   // native scan results (picker)
  const [scanning, setScanning] = useState(false);
  const deviceRef = useRef(null);
  const controlRef = useRef(null);
  const nativeIdRef = useRef(null);
  const writeQueueRef = useRef(Promise.resolve());
  const cpsCrankRef = useRef({ revs: null, time: null });
  const supported = isNativeBle || (typeof navigator !== 'undefined' && !!navigator.bluetooth);

  function handleBikeData(dv) {
    try {
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
  // Standard Bluetooth Cycling Power Measurement characteristic (0x2A63),
  // part of the Cycling Power Service (0x1818). Fallback for trainers —
  // like some Wahoo KICKR SNAP units — that never learned the newer Fitness
  // Machine Service (0x1826) Trbo normally looks for, but still broadcast
  // this older, universally-supported power service. It's read-only: there's
  // no target-power/ERG control characteristic here, so hasControl is left
  // false and the app's own ERG toggle stays correctly disabled for trainers
  // connected this way.
  function handleCyclingPower(dv) {
    try {
      const flags = dv.getUint16(0, true);
      let offset = 2;
      const pow = dv.getInt16(offset, true); offset += 2;
      if (flags & 0x0001) offset += 1; // pedal power balance
      if (flags & 0x0004) offset += 2; // accumulated torque
      if (flags & 0x0010) offset += 6; // wheel revolution data
      if (flags & 0x0020) {
        // Crank revolution data: cumulative crank revolutions + last crank
        // event time (1/1024s units). Cadence isn't sent directly — it has
        // to be derived from how much these two values changed between
        // consecutive notifications, with rollover handled at 65536.
        const crankRevs = dv.getUint16(offset, true); offset += 2;
        const crankTime = dv.getUint16(offset, true); offset += 2;
        const prev = cpsCrankRef.current;
        if (prev.revs !== null) {
          let deltaRevs = crankRevs - prev.revs;
          if (deltaRevs < 0) deltaRevs += 65536;
          let deltaTime = crankTime - prev.time;
          if (deltaTime < 0) deltaTime += 65536;
          if (deltaTime > 0) setCadence(Math.round((deltaRevs / (deltaTime / 1024)) * 60));
        }
        cpsCrankRef.current = { revs: crankRevs, time: crankTime };
      }
      setPower(pow);
    } catch (e) {}
  }
  function handleDisconnected() {
    setStatus('disconnected');
    setPower(null);
    setCadence(null);
    setHasControl(false);
    cpsCrankRef.current = { revs: null, time: null };
  }
  // Everything after a native trainer is connected: subscribe to power/cadence
  // and set up ERG control. Shared by the auto-connect path (connect) and the
  // pick-from-a-list path (connectTo).
  async function setupNativeTrainer(deviceId, name) {
    nativeIdRef.current = deviceId;
    const ftmsSvc = uuid16(0x1826);
    const cpsSvc = uuid16(0x1818);
    let usedFtms = true;
    try {
      await nativeStartNotifications(deviceId, ftmsSvc, uuid16(0x2ad2), handleBikeData);
    } catch (e) {
      // Trainer doesn't have the FTMS bike-data characteristic — fall back to
      // the older Cycling Power service for power/cadence.
      usedFtms = false;
      try { await nativeStartNotifications(deviceId, cpsSvc, uuid16(0x2a63), handleCyclingPower); } catch (e2) {}
    }
    if (usedFtms) {
      try {
        await nativeWrite(deviceId, ftmsSvc, uuid16(0x2ad9), new Uint8Array([0x00]));
        controlRef.current = { protocol: 'ftms', native: true, characteristic: null };
        // FTMS "Start or Resume" (0x07). Some trainers' firmware expects this
        // right after "Request Control" before it will honour later
        // mode-change commands — including the "release back to free ride"
        // call sent when a mini game like Beat the Pros ends. Missing this
        // step is a likely reason some trainers stay locked in ERG mode.
        await writeControl(new Uint8Array([0x07]));
        setHasControl(true);
      } catch (e) { controlRef.current = null; setHasControl(false); }
    } else {
      // No FTMS control point, but some trainers — including this AC59 KICKR
      // SNAP — layer a proprietary control characteristic on top of the
      // Cycling Power Service instead. Try it before giving up on ERG.
      try {
        await nativeStartNotifications(deviceId, cpsSvc, WAHOO_CONTROL_UUID, () => {}).catch(() => {});
        await nativeWrite(deviceId, cpsSvc, WAHOO_CONTROL_UUID, new Uint8Array([WAHOO_OP.unlock, 0xee, 0xfc]));
        controlRef.current = { protocol: 'wahoo', native: true, characteristic: null };
        setHasControl(true);
      } catch (e) { controlRef.current = null; setHasControl(false); }
    }
    setDeviceName(name || 'Trainer');
    setStatus('connected');
  }
  // Native only: scan and return the list of trainers in range so the UI can
  // show a picker. On web the browser's own requestDevice chooser handles
  // this, so scan() just falls through to connect().
  async function scan() {
    if (!supported) { setErrorMsg('Bluetooth is not available in this browser or environment.'); setStatus('error'); return []; }
    if (!isNativeBle) { await connect(); return []; }
    setErrorMsg(null); setDevices([]); setScanning(true);
    try {
      const found = await nativeScanForDevices([uuid16(0x1826), uuid16(0x1818)], { durationMs: 6000, onUpdate: setDevices });
      setDevices(found);
      if (!found.length) setErrorMsg('No trainer found nearby. Make sure it’s powered on, woken up (give the pedals a turn), and not already connected in another app.');
      return found;
    } catch (e) {
      setErrorMsg((e && e.message) ? e.message : 'Could not scan for trainers.');
      return [];
    } finally {
      setScanning(false);
    }
  }
  // Native only: connect to a specific device the rider chose from the scan.
  async function connectTo(deviceId, name) {
    setStatus('connecting'); setErrorMsg(null);
    cpsCrankRef.current = { revs: null, time: null };
    try {
      await nativeConnectDevice(deviceId, handleDisconnected);
      await setupNativeTrainer(deviceId, name);
    } catch (e) {
      setErrorMsg((e && e.message) ? e.message : 'Could not connect to that trainer.');
      setStatus('error');
    }
  }
  async function connect() {
    if (!supported) { setErrorMsg('Bluetooth is not available in this browser or environment.'); setStatus('error'); return; }
    setStatus('connecting'); setErrorMsg(null);
    cpsCrankRef.current = { revs: null, time: null };
    if (isNativeBle) {
      try {
        const ftmsSvc = uuid16(0x1826);
        const cpsSvc = uuid16(0x1818);
        const { deviceId, name } = await nativeRequestAndConnect([ftmsSvc, cpsSvc], handleDisconnected);
        await setupNativeTrainer(deviceId, name);
      } catch (e) {
        setErrorMsg((e && e.message) ? e.message : 'Could not connect to a trainer.');
        setStatus('error');
      }
      return;
    }
    try {
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x1826] }, { services: [0x1818] }], optionalServices: [0x1826, 0x1818] });
      device.addEventListener('gattserverdisconnected', handleDisconnected);
      const server = await device.gatt.connect();
      let service, usedFtms = true;
      try {
        service = await server.getPrimaryService(0x1826);
      } catch (e) {
        // No FTMS on this trainer — fall back to the Cycling Power service.
        usedFtms = false;
        service = await server.getPrimaryService(0x1818);
      }
      if (usedFtms) {
        try {
          const bikeChar = await service.getCharacteristic(0x2ad2);
          await bikeChar.startNotifications();
          bikeChar.addEventListener('characteristicvaluechanged', (event) => handleBikeData(event.target.value));
        } catch (e) {}
        try {
          const controlChar = await service.getCharacteristic(0x2ad9);
          await controlChar.writeValue(new Uint8Array([0x00]));
          controlRef.current = { protocol: 'ftms', native: false, characteristic: controlChar };
          // See the matching comment in the native connect path above.
          await writeControl(new Uint8Array([0x07]));
          setHasControl(true);
        } catch (e) { controlRef.current = null; setHasControl(false); }
      } else {
        try {
          const powerChar = await service.getCharacteristic(0x2a63);
          await powerChar.startNotifications();
          powerChar.addEventListener('characteristicvaluechanged', (event) => handleCyclingPower(event.target.value));
        } catch (e) {}
        controlRef.current = null;
        setHasControl(false);
        // No FTMS control point, but some trainers — including this AC59
        // KICKR SNAP — layer a proprietary control characteristic on top
        // of the same Cycling Power Service instead. Try it before giving
        // up on ERG control entirely.
        try {
          const wahooChar = await service.getCharacteristic(WAHOO_CONTROL_UUID);
          await wahooChar.startNotifications().catch(() => {});
          await wahooChar.writeValue(new Uint8Array([WAHOO_OP.unlock, 0xee, 0xfc]));
          controlRef.current = { protocol: 'wahoo', native: false, characteristic: wahooChar };
          setHasControl(true);
        } catch (e) { controlRef.current = null; setHasControl(false); }
      }
      deviceRef.current = device;
      setDeviceName(device.name || 'Trainer');
      setStatus('connected');
    } catch (e) {
      setErrorMsg((e && e.message) ? e.message : 'Could not connect to a trainer.');
      setStatus('error');
    }
  }
  function disconnect() {
    if (isNativeBle) {
      nativeDisconnect(nativeIdRef.current);
      nativeIdRef.current = null;
    } else {
      try { deviceRef.current && deviceRef.current.gatt && deviceRef.current.gatt.disconnect(); } catch (e) {}
    }
    setStatus('disconnected'); setDeviceName(null); setPower(null); setCadence(null); setHasControl(false);
    cpsCrankRef.current = { revs: null, time: null };
  }
  async function writeControl(buf) {
    if (!controlRef.current) return;
    // Every write to the control characteristic is chained through this one
    // queue, so a rapid-fire power-target update (ERG mode writes roughly
    // 4x/sec) can never overlap with a mode-change command like "release
    // the trainer" fired at almost the same moment. Bluetooth doesn't
    // guarantee two back-to-back writes land in the order they were sent
    // unless the app explicitly waits for each one to finish first.
    // Routes to the right service/characteristic for whichever control
    // protocol this trainer connected with — FTMS's dedicated control point,
    // or Wahoo's proprietary characteristic nested inside the Cycling Power
    // Service — since the two need entirely different opcodes/byte layouts.
    const { protocol, native, characteristic } = controlRef.current;
    const svcUuid = protocol === 'wahoo' ? uuid16(0x1818) : uuid16(0x1826);
    const charUuid = protocol === 'wahoo' ? WAHOO_CONTROL_UUID : uuid16(0x2ad9);
    const run = () => (native
      ? nativeWrite(nativeIdRef.current, svcUuid, charUuid, buf)
      : characteristic.writeValue(buf));
    const next = writeQueueRef.current.then(run, run);
    writeQueueRef.current = next.catch(() => {});
    return next;
  }
  async function setErgTarget(watts) {
    try {
      const w = Math.max(0, Math.round(watts));
      if (controlRef.current && controlRef.current.protocol === 'wahoo') {
        // Wahoo Set ERG Mode (opcode 0x42): uint16, little-endian, watts.
        await writeControl(new Uint8Array([WAHOO_OP.setErgMode, w & 0xff, (w >> 8) & 0xff]));
        return;
      }
      const buf = new ArrayBuffer(3);
      const dv = new DataView(buf);
      dv.setUint8(0, 0x05);
      dv.setInt16(1, w, true);
      await writeControl(buf);
    } catch (e) {}
  }
  // Leave ERG/target-power mode and hand power control back to the rider by
  // switching the trainer into flat "simulation" mode (0% grade, no wind).
  // Used by the mini games so that after a fixed-power game like Beat the
  // Pros the trainer isn't left holding a target the rider can't vary.
  async function endErg() {
    try {
      if (controlRef.current && controlRef.current.protocol === 'wahoo') {
        // Wahoo has no single "zero out simulation" write like FTMS does.
        // Sending Set Simulation Grade (0x46) at 0% takes the trainer out
        // of its ERG hold and into grade-based resistance instead, which is
        // the closest equivalent "free ride" state. Grade is normalized
        // across the full uint16 range, where the midpoint (0x7FFF) is 0%.
        await writeControl(new Uint8Array([WAHOO_OP.setSimGrade, 0xff, 0x7f]));
        return;
      }
      // FTMS Set Indoor Bike Simulation Parameters (0x11), all values zero.
      await writeControl(new Uint8Array([0x11, 0, 0, 0, 0, 0, 0]));
    } catch (e) {}
  }
  return { supported, status, deviceName, errorMsg, power, cadence, hasControl, devices, scanning, isNative: isNativeBle, scan, connectTo, connect, disconnect, setErgTarget, endErg };
}

// Standard Bluetooth Heart Rate Service (0x180D) / Heart Rate Measurement
// characteristic (0x2A37) — supported by essentially every BLE chest strap
// and armband (Polar, Wahoo, Garmin, etc.), independent of the trainer.
function useHeartRate() {
  const [status, setStatus] = useState('disconnected');
  const [deviceName, setDeviceName] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [bpm, setBpm] = useState(null);
  const [devices, setDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const deviceRef = useRef(null);
  const nativeIdRef = useRef(null);
  const supported = isNativeBle || (typeof navigator !== 'undefined' && !!navigator.bluetooth);

  function handleHrData(dv) {
    try {
      const flags = dv.getUint8(0);
      const value = (flags & 0x01) ? dv.getUint16(1, true) : dv.getUint8(1);
      setBpm(value);
    } catch (e) {}
  }
  function handleDisconnected() {
    setStatus('disconnected');
    setBpm(null);
  }
  async function setupNativeHr(deviceId, name) {
    nativeIdRef.current = deviceId;
    await nativeStartNotifications(deviceId, uuid16(0x180d), uuid16(0x2a37), handleHrData);
    setDeviceName(name || 'Heart rate monitor');
    setStatus('connected');
  }
  // Native only: scan and return heart-rate monitors in range for a picker.
  // Many watches (e.g. Coros, Garmin) only broadcast heart rate after you
  // start an activity or turn on "broadcast HR" — call that out so people
  // aren't left wondering why the watch never appears.
  async function scan() {
    if (!supported) { setErrorMsg('Bluetooth is not available in this browser or environment.'); setStatus('error'); return []; }
    if (!isNativeBle) { await connect(); return []; }
    setErrorMsg(null); setDevices([]); setScanning(true);
    try {
      const found = await nativeScanForDevices(uuid16(0x180d), { durationMs: 6000, onUpdate: setDevices });
      setDevices(found);
      if (!found.length) setErrorMsg('No heart rate monitor found. Chest straps need to be worn (the sensor wakes on skin contact). A watch like a Coros or Garmin only shows up once you turn on “Broadcast Heart Rate” on the watch itself.');
      return found;
    } catch (e) {
      setErrorMsg((e && e.message) ? e.message : 'Could not scan for heart rate monitors.');
      return [];
    } finally {
      setScanning(false);
    }
  }
  async function connectTo(deviceId, name) {
    setStatus('connecting'); setErrorMsg(null);
    try {
      await nativeConnectDevice(deviceId, handleDisconnected);
      await setupNativeHr(deviceId, name);
    } catch (e) {
      setErrorMsg((e && e.message) ? e.message : 'Could not connect to that heart rate monitor.');
      setStatus('error');
    }
  }
  async function connect() {
    if (!supported) { setErrorMsg('Bluetooth is not available in this browser or environment.'); setStatus('error'); return; }
    setStatus('connecting'); setErrorMsg(null);
    if (isNativeBle) {
      try {
        const svc = uuid16(0x180d);
        const { deviceId, name } = await nativeRequestAndConnect(svc, handleDisconnected);
        await setupNativeHr(deviceId, name);
      } catch (e) {
        setErrorMsg((e && e.message) ? e.message : 'Could not connect to a heart rate monitor.');
        setStatus('error');
      }
      return;
    }
    try {
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x180d] }], optionalServices: [0x180d] });
      device.addEventListener('gattserverdisconnected', handleDisconnected);
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(0x180d);
      const hrChar = await service.getCharacteristic(0x2a37);
      await hrChar.startNotifications();
      hrChar.addEventListener('characteristicvaluechanged', (event) => handleHrData(event.target.value));
      deviceRef.current = device;
      setDeviceName(device.name || 'Heart rate monitor');
      setStatus('connected');
    } catch (e) {
      setErrorMsg((e && e.message) ? e.message : 'Could not connect to a heart rate monitor.');
      setStatus('error');
    }
  }
  function disconnect() {
    if (isNativeBle) {
      nativeDisconnect(nativeIdRef.current);
      nativeIdRef.current = null;
    } else {
      try { deviceRef.current && deviceRef.current.gatt && deviceRef.current.gatt.disconnect(); } catch (e) {}
    }
    setStatus('disconnected'); setDeviceName(null); setBpm(null);
  }
  return { supported, status, deviceName, errorMsg, bpm, devices, scanning, isNative: isNativeBle, scan, connectTo, connect, disconnect };
}

// ---------- profile chart ----------
// Renders just the coloured interval bars (no outer frame). Percentage
// widths are relative to whatever container it's placed in, so it composes
// correctly whether that container is a full-width chart (ProfileChart) or
// one workout's slice of a larger multi-workout strip (QueueProfileStrip).
function SegmentBars({ intervals, onSegmentClick }) {
  const cvd = useContext(ColorblindContext);
  const total = totalDuration(intervals) || 1;
  return (
    <>
      {intervals.map((it) => {
        const z = zoneFor(it, cvd);
        const w = (it.duration / total) * 100;
        const h = Math.max(14, Math.min(100, z.intensity * 78));
        const isFree = it.type === 'free';
        return (
          <div key={it.id} onClick={onSegmentClick ? () => onSegmentClick(it.id) : undefined}
            style={{ width: `${w}%`, height: '100%', display: 'flex', alignItems: 'flex-end', borderRight: `1px solid ${PANEL2}`, cursor: onSegmentClick ? 'pointer' : 'default' }}>
            <div style={{ width: '100%', height: `${h}%`, background: isFree ? `repeating-linear-gradient(135deg, ${z.color}, ${z.color} 4px, ${LINE} 4px, ${LINE} 8px)` : z.color }} />
          </div>
        );
      })}
    </>
  );
}

function ProfileChart({ intervals, height = 84, progress = null, onSegmentClick }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', height, width: '100%', background: PANEL2, borderRadius: 8, overflow: 'hidden', border: `1px solid ${LINE}` }}>
      <SegmentBars intervals={intervals} onSegmentClick={onSegmentClick} />
      {progress !== null && (
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${progress * 100}%`, background: 'rgba(255,255,255,0.14)', borderRight: `2px solid ${TEXT}`, pointerEvents: 'none' }} />
      )}
    </div>
  );
}

// Lays every queued workout's segment bars out end to end in one strip, so
// the whole session's shape (recovery, hard, recovery, hard...) is visible
// before pressing start. Each workout gets a share of the strip's width
// proportional to its own duration, with a divider line between workouts.
function QueueProfileStrip({ resolved }) {
  const total = resolved.reduce((sum, w) => sum + totalDuration(w.intervals), 0) || 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', height: 64, width: '100%', background: PANEL2, borderRadius: 8, overflow: 'hidden', border: `1px solid ${LINE}`, marginBottom: 16 }}>
      {resolved.map((w, i) => {
        const dur = totalDuration(w.intervals) || 1;
        const widthPct = (dur / total) * 100;
        return (
          <div key={w.id + '_' + i} style={{ width: `${widthPct}%`, height: '100%', display: 'flex', alignItems: 'flex-end', borderRight: i < resolved.length - 1 ? `2px solid ${TEXT}` : 'none' }}>
            <SegmentBars intervals={w.intervals} />
          </div>
        );
      })}
    </div>
  );
}

// A zoomed-in, time-accurate strip of the workout used by the in-ride
// progress bar. Unlike ProfileChart (which squeezes the whole ride into
// one fixed-width bar), each interval here is sized by its real duration,
// so the strip is wider than the screen and scrolls. It auto-follows the
// current elapsed time, keeping "now" a little left of center so upcoming
// work is visible — but a touch-drag pauses the auto-follow so the rider
// can look ahead, and it quietly resumes a couple seconds after they let go.
const TIMELINE_PX_PER_SEC = 1.2;    // zoom level: bigger = more zoomed in
const TIMELINE_FOLLOW_RATIO = 0.24; // keeps "now" ~a quarter of the way across the visible window
const TIMELINE_RESUME_MS = 10000;   // delay after a manual scroll before auto-follow kicks back in
const TIMELINE_GAP_PX = 1;          // matches each segment's marginRight divider below

// Each rendered segment carries a 1px divider (marginRight) after it, which
// a plain elapsed*pxPerSec formula doesn't know about. On a workout with a
// lot of segments those missed pixels add up and the "you are here" marker
// drifts from the segment blocks — most visible after skipping through
// several segments quickly. This walks the real segments cumulatively,
// counting a gap for every segment fully passed, so the marker always
// lines up with the actual rendered blocks regardless of how elapsed time
// got there (skip, normal playback, or restart).
function timelineElapsedToPx(intervals, elapsedSeconds, pxPerSec, gapPx) {
  let x = 0;
  let remaining = Math.max(0, elapsedSeconds);
  for (const it of intervals) {
    if (remaining >= it.duration) {
      x += it.duration * pxPerSec + gapPx;
      remaining -= it.duration;
    } else {
      x += remaining * pxPerSec;
      remaining = 0;
      break;
    }
  }
  return x;
}
function timelineTotalPx(intervals, pxPerSec, gapPx) {
  return intervals.reduce((acc, it) => acc + it.duration * pxPerSec + gapPx, 0);
}

function LiveTimeline({ intervals, elapsed, total, cvd }) {
  const scrollRef = useRef(null);
  const resumeTimerRef = useRef(null);
  const [following, setFollowing] = useState(true);
  const totalWidth = Math.max(1, timelineTotalPx(intervals, TIMELINE_PX_PER_SEC, TIMELINE_GAP_PX));
  const nowX = timelineElapsedToPx(intervals, Math.max(0, Math.min(total, elapsed)), TIMELINE_PX_PER_SEC, TIMELINE_GAP_PX);

  // Re-center on "now" every time elapsed ticks forward, as long as the
  // rider hasn't grabbed the strip to look around. Runs before paint
  // (useLayoutEffect, not useEffect) so the strip never flashes at the old
  // scroll position first — and skips while the container hasn't been
  // measured yet (clientWidth 0, e.g. the very first frame it mounts),
  // since scrolling against an unmeasured width would land in the wrong spot.
  useLayoutEffect(() => {
    if (!following) return;
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
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
            const z = zoneFor(it, cvd);
            const w = it.duration * TIMELINE_PX_PER_SEC;
            const h = Math.max(14, Math.min(100, z.intensity * 78));
            const isFree = it.type === 'free';
            return (
              <div key={it.id} style={{ width: w, minWidth: w, flexShrink: 0, height: '100%', display: 'flex', alignItems: 'flex-end', marginRight: TIMELINE_GAP_PX }}>
                <div style={{ width: '100%', height: `${h}%`, borderRadius: 4, background: isFree ? `repeating-linear-gradient(135deg, ${z.color}, ${z.color} 4px, ${LINE} 4px, ${LINE} 8px)` : z.color }} />
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
// interval's target — a "good" colour near target, blue under, a distinct
// "hot" colour over. The two non-blue colours are swapped for a colourblind
// -safe pair (bluish-green / vermillion) when cvd is true, since the default
// green/red pairing is the hardest one to tell apart under red-green colour
// blindness — exactly the two states (on target vs. overshooting) a rider
// most needs to distinguish at a glance mid-effort.
function PowerGauge({ power, targetWatts, width, height, radius, stroke: strokeProp, cvd }) {
  const w = width || 148, h = height || 82, r = radius || 64, stroke = strokeProp || 11;
  const path = `M ${w / 2 - r} ${h} A ${r} ${r} 0 0 1 ${w / 2 + r} ${h}`;
  const ratio = targetWatts > 0 ? power / targetWatts : 0;
  const fillPct = Math.max(0, Math.min(100, (power / (targetWatts * 1.4 || 1)) * 100));
  const underColor = cvd ? '#0072B2' : '#4A6FA5';
  const onTargetColor = cvd ? '#009E73' : '#8FC93A';
  const overColor = cvd ? '#D55E00' : '#FF4D4D';
  const color = targetWatts <= 0 ? 'var(--accent)' : ratio < 0.85 ? underColor : ratio > 1.15 ? overColor : onTargetColor;
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
// A small "i" icon that shows a short explanation on tap. Tap-to-toggle
// rather than hover, since most of this app is used on a touchscreen.
function InfoDot({ text, icon, openDown }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle', flexShrink: 0 }}>
      <button type="button" onClick={e => { e.stopPropagation(); setOpen(o => !o); }} onBlur={() => setOpen(false)}
        aria-label="More info" style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', display: 'flex', color: SUB, flexShrink: 0 }}>
        {icon || <Info size={14} />}
      </button>
      {open && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'absolute', [openDown ? 'top' : 'bottom']: '100%', left: 0,
          [openDown ? 'marginTop' : 'marginBottom']: 6, width: 230, zIndex: 50,
          background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, padding: 10,
          fontFamily: "'Manrope', sans-serif", fontSize: 11.5, fontWeight: 500, textTransform: 'none', letterSpacing: 'normal',
          color: TEXT, lineHeight: 1.45, boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        }}>{text}</div>
      )}
    </span>
  );
}
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
// In-workout screen "Outline" control treatment: transparent circles instead
// of filled squares/circles, so the skip/play controls read lighter against
// the zone-tint wash. Skip buttons use a hairline ring + muted icon; the
// play/pause button uses a thicker accent-color ring + accent icon.
function ControlSkipBtn({ onClick, disabled, children }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: 34, height: 34, borderRadius: '50%', border: `1px solid ${LINE}`, background: 'transparent',
      color: disabled ? MUTED : SUB, display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, flexShrink: 0,
    }}>{children}</button>
  );
}
function ControlPlayBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{
      width: 72, height: 72, borderRadius: '50%', border: '2px solid var(--accent)', background: 'transparent',
      color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', flexShrink: 0,
    }}>{children}</button>
  );
}
function Switch({ checked, onChange, disabled }) {
  return (
    <button onClick={() => !disabled && onChange(!checked)} disabled={disabled} style={{
      width: 40, height: 24, borderRadius: 999, border: `1px solid ${LINE}`,
      background: checked ? 'var(--accent)' : PANEL2, position: 'relative', cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1, flexShrink: 0, padding: 0,
    }}>
      <div style={{ position: 'absolute', top: 3, left: checked ? 19 : 3, width: 18, height: 18, borderRadius: '50%', background: '#FFFFFF', transition: 'left .15s' }} />
    </button>
  );
}
function SettingRow({ label, sub, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderBottom: `1px solid ${LINE}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14, color: TEXT }}>{label}</div>
        {sub && <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: SUB, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}
// The recurring section-label pattern used across the restyled app pages: a
// small accent-colored icon + an uppercase, letter-spaced, muted-color label.
function SectionHeader({ icon, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 8 }}>
      {icon}
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, fontWeight: 700, color: SUB, letterSpacing: 0.6, textTransform: 'uppercase' }}>{title}</div>
    </div>
  );
}
// A section header that also acts as a toggle, hiding its contents behind a
// tap so a long options screen can start out short and uncluttered.
function CollapsibleSection({ icon, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 20 }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${LINE}`, padding: 0, paddingBottom: 12, marginBottom: open ? 8 : 0, cursor: 'pointer', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon}
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, fontWeight: 700, color: SUB, letterSpacing: 0.6, textTransform: 'uppercase' }}>{title}</div>
        </div>
        {open ? <ChevronUp size={18} color={SUB} /> : <ChevronDown size={18} color={SUB} />}
      </button>
      {open && children}
    </div>
  );
}

// A quick yes/no dialog for interrupting a destructive action — distinct
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
// `presetMinutes` (optional): when opened from the training planner, the sheet
// starts pre-scaled to the plan's target length for that day instead of the
// workout's native length.
// A number field for FTP that you can actually clear. The trouble with
// binding an <input> straight to a clamped number is that the moment the box
// is empty it reads as 0, snaps up to the minimum, and refills — so you can
// never wipe it to type a fresh value. This keeps a local text "draft" so the
// field can sit empty while you type, and only commits a clamped whole number
// when you click away or press Enter. Left empty, it simply keeps your
// previous FTP rather than jumping to the minimum.
function FtpInput({ ftp, setFtp, style }) {
  const [draft, setDraft] = useState(String(ftp));
  const [focused, setFocused] = useState(false);
  // Reflect external changes (e.g. applying an FTP test result) unless the
  // person is mid-edit in this very field.
  useEffect(() => { if (!focused) setDraft(String(ftp)); }, [ftp, focused]);
  function commit() {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n) || draft.trim() === '') { setDraft(String(ftp)); return; } // left blank → keep current
    const clamped = Math.min(600, Math.max(50, n));
    setFtp(clamped);
    setDraft(String(clamped));
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={style}
    />
  );
}

function WorkoutDetail({ workout, ftp, setFtp, settings, onStart, onClose, onEdit, isCustom, onDelete, onSaveScaled, presetMinutes, starred, onToggleStar, inQueue, onToggleQueue }) {
  const originalTotal = totalDuration(workout.intervals);
  const scalable = !workout.fixedLength;
  // The floor this specific workout can actually reach — long, multi-climb
  // epics especially run out of room to compress well above the slider's
  // nominal 10-minute minimum. Scaling toward a near-zero target finds
  // exactly how far the engine can shrink it, so the slider can stop there
  // instead of letting the person drag past the point where "actual" stops
  // changing.
  const floorSeconds = useMemo(
    () => (scalable ? totalDuration(smartScaleWorkout(workout.intervals, 1, workout.repeatWholeCore)) : originalTotal),
    [workout, scalable]
  );
  const floorMinutes = Math.max(10, Math.ceil(floorSeconds / 60));
  const initialMinutes = scalable && presetMinutes ? Math.max(floorMinutes, Math.round(presetMinutes)) : Math.max(floorMinutes, Math.round(originalTotal / 60));
  const [targetMinutes, setTargetMinutes] = useState(initialMinutes);
  useEffect(() => { setTargetMinutes(initialMinutes); }, [workout.id, presetMinutes]);

  const scaledIntervals = useMemo(
    () => (scalable ? smartScaleWorkout(workout.intervals, targetMinutes * 60, workout.repeatWholeCore) : workout.intervals),
    [workout, targetMinutes, scalable]
  );
  const actualTotal = totalDuration(scaledIntervals);
  const isScaled = scalable && Math.abs(actualTotal - originalTotal) > 20;
  const needsFtp = scaledIntervals.some(i => i.type === 'power');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', boxSizing: 'border-box' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: BG, width: '100%', maxWidth: 520, borderRadius: 18, border: `1px solid ${LINE}`, padding: 20, maxHeight: 'min(85vh, calc(100dvh - 48px))', overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {workout.pain && <Skull size={18} color={RED} style={{ flexShrink: 0 }} />}
            {workout.pain && <InfoDot openDown text="These rides are designed to be nearly impossible at your true FTP. You can always dial down the FTP for a taste test." />}
            <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: 600, color: TEXT, letterSpacing: 0.3 }}>{workout.name}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            <button onClick={() => onToggleStar(workout.id)} title={starred ? 'Unstar' : 'Star'} style={{ background: 'none', border: 'none', color: SUB, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0 }}>
              <Star size={20} color={starred ? 'var(--accent)' : SUB} fill={starred ? 'var(--accent)' : 'none'} />
            </button>
            <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', color: SUB, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0 }}>
              <X size={20} />
            </button>
          </div>
        </div>
        <div style={{ fontSize: 13, color: SUB, marginBottom: 14 }}>{workout.description}</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, fontSize: 12, color: SUB, flexWrap: 'wrap' }}>
          {workout.pain && <span style={{ border: `1px solid ${RED}`, borderRadius: 6, padding: '3px 8px', color: RED, fontWeight: 600 }}>Pain</span>}
          <span style={{ border: `1px solid ${LINE}`, borderRadius: 6, padding: '3px 8px' }}>{workout.category}</span>
          <span style={{ border: `1px solid ${LINE}`, borderRadius: 6, padding: '3px 8px' }}>{fmtLong(actualTotal)}</span>
          <span style={{ border: `1px solid ${LINE}`, borderRadius: 6, padding: '3px 8px' }}>{scaledIntervals.length} intervals</span>
        </div>

        <ProfileChart intervals={scaledIntervals} />

        {scalable && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: SUB, marginBottom: 6 }}>
              <span>Adjust length</span>
              <span style={{ color: TEXT }}>{targetMinutes} min{isScaled ? ` → ${fmtLong(actualTotal)} actual` : ''}</span>
            </div>
            <input type="range" min={floorMinutes} max={360} step={5} value={targetMinutes}
              onChange={e => setTargetMinutes(Number(e.target.value))}
              style={{ width: '100%', accentColor: settings.accentColor }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: SUB, marginTop: 2 }}>
              <span>{floorMinutes > 10 ? fmtLong(floorMinutes * 60) : '10 min'}</span><span>6 hours</span>
            </div>
            {isScaled && (
              <button onClick={() => setTargetMinutes(Math.max(floorMinutes, Math.round(originalTotal / 60)))}
                style={{ marginTop: 6, background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', padding: 0 }}>
                Reset to original length
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => onStart({ ...workout, intervals: scaledIntervals })}
            style={{ flex: 2, padding: '12px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}>
            <Play size={18} fill={INK} /> Start workout
          </button>
          <button onClick={() => onToggleQueue(workout.id)} title={inQueue ? 'Remove from queue' : 'Add to queue'}
            style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: `1px solid ${inQueue ? 'var(--accent)' : LINE}`, background: inQueue ? 'var(--accent)' : PANEL2, color: inQueue ? INK : TEXT, fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}>
            <ListOrdered size={16} /> {inQueue ? 'Queued' : 'Queue'}
          </button>
        </div>

        {needsFtp && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <Gauge size={18} color="var(--accent)" />
            <span style={{ fontSize: 13, color: SUB }}>Your FTP</span>
            <FtpInput ftp={ftp} setFtp={setFtp}
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
            const z = zoneFor(it, settings.colorblindMode);
            // Sprints of 10s or less get a hidden 2s ramp baked into their
            // actual duration (letting the trainer's flywheel spin up before
            // the sprint really bites), so the label's advertised length and
            // the timer's actual length differ slightly — flag it so that
            // isn't confusing.
            const isPaddedSprint = it.type === 'power' && it.target >= 140 && it.duration <= 12 && /sprint/i.test(it.label);
            return (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 8px', background: PANEL, borderRadius: 6 }}>
                <div style={{ width: 4, height: 24, background: z.color, borderRadius: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, color: TEXT, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                  {isPaddedSprint && <InfoDot text="Includes a hidden 2-second ramp so your trainer's flywheel can spin up to full resistance — you'll get the full sprint effort for the length shown." />}
                </div>
                <div style={{ color: SUB }}>{formatTarget(it, ftp, settings.targetDisplay)}</div>
                <div style={{ color: SUB, width: 44, textAlign: 'right' }}>{fmt(it.duration)}</div>
              </div>
            );
          })}
        </div>

        {/* Always mounted (unlike a conditional render) so this row's height
            animates smoothly instead of the modal abruptly jumping as
            isScaled flips on/off while dragging the length slider above. */}
        <div style={{
          display: 'grid',
          gridTemplateRows: (isCustom || isScaled) ? '1fr' : '0fr',
          marginTop: (isCustom || isScaled) ? 18 : 0,
          transition: 'grid-template-rows 200ms ease, margin-top 200ms ease',
        }}>
          <div style={{ overflow: 'hidden', minHeight: 0 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
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
          </div>
        </div>
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
    return { text: 'You haven’t tested your FTP yet — run a quick test so your power targets are accurate.', action: 'ftp', cta: 'Test FTP' };
  }
  const lastFtp = ftpHistory[ftpHistory.length - 1];
  const daysSinceFtp = daysSince(lastFtp.date);
  if (daysSinceFtp >= 42) {
    return { text: `It's been ${daysSinceFtp} days since your last FTP test — worth retesting to keep your targets sharp.`, action: 'ftp' };
  }
  if (!workoutHistory || workoutHistory.length === 0) {
    return { text: 'Ready for your first session? Workouts and Rides both have plenty to choose from.', action: 'basics' };
  }
  const lastVO2 = mostRecentEntry(workoutHistory, w => /vo2/i.test(w.name));
  const daysSinceVO2 = lastVO2 ? daysSince(lastVO2.date) : null;
  if (daysSinceVO2 === null || daysSinceVO2 >= 14) {
    return {
      text: daysSinceVO2 == null ? 'You haven’t logged a VO2 max session yet — worth adding one for a fitness boost.' : `You haven't done a VO2 max session in ${daysSinceVO2} days.`,
      action: 'basics',
    };
  }
  const lastRide = mostRecentEntry(workoutHistory, w => w.category === 'Rides');
  const daysSinceRide = lastRide ? daysSince(lastRide.date) : null;
  if (daysSinceRide === null || daysSinceRide >= 10) {
    return {
      text: daysSinceRide == null ? 'You haven’t done a long ride yet — the Rides library has plenty to choose from.' : `It's been ${daysSinceRide} days since your last ride.`,
      action: 'rides',
    };
  }
  const lastAny = mostRecentEntry(workoutHistory);
  const daysSinceAny = lastAny ? daysSince(lastAny.date) : null;
  const lastRecovery = mostRecentEntry(workoutHistory, w => /recovery/i.test(w.name));
  const daysSinceRecovery = lastRecovery ? daysSince(lastRecovery.date) : null;
  if (daysSinceAny !== null && daysSinceAny >= 5 && (daysSinceRecovery == null || daysSinceRecovery >= 10)) {
    return { text: 'It’s been a few days since your last session — maybe ease back in with a recovery spin.', action: 'basics' };
  }
  return { text: 'You’re riding consistently — keep it up.', action: null };
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
// completed session history — returns null until there's at least one
// logged ride. avgPower/maxPower are only present on sessions ridden with a
// trainer connected, so those particular records simply don't appear until
// the person has ridden with one. Heart rate is never stored, so it never
// contributes to personal records.
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

  // Weekly streak: consecutive Monday-start weeks with at least one ride.
  // Replaces the old daily streak — nobody rides every day, so a rest day
  // shouldn't break a run. A week "counts" the moment you ride once in it.
  const WEEK_MS = 604800000;
  const weekTimes = Array.from(new Set(completed.map(w => startOfWeek(w.date)))).sort((a, b) => a - b);
  let longestWeekStreak = weekTimes.length ? 1 : 0, wrun = weekTimes.length ? 1 : 0;
  for (let i = 1; i < weekTimes.length; i++) {
    const gap = Math.round((weekTimes[i] - weekTimes[i - 1]) / WEEK_MS);
    wrun = gap === 1 ? wrun + 1 : 1;
    if (wrun > longestWeekStreak) longestWeekStreak = wrun;
  }
  let currentWeekStreak = 0;
  if (weekTimes.length) {
    const thisWeek = startOfWeek(new Date());
    const gapWeeks = Math.round((thisWeek - weekTimes[weekTimes.length - 1]) / WEEK_MS);
    // The streak is live if the most recent ride was this week or last week
    // (this week may just not have happened yet).
    if (gapWeeks <= 1) {
      currentWeekStreak = 1;
      for (let i = weekTimes.length - 1; i > 0; i--) {
        if (Math.round((weekTimes[i] - weekTimes[i - 1]) / WEEK_MS) === 1) currentWeekStreak += 1;
        else break;
      }
    }
  }

  const weekCounts = {};
  completed.forEach(w => { const wk = startOfWeek(w.date); weekCounts[wk] = (weekCounts[wk] || 0) + 1; });
  const bestWeekCount = Object.values(weekCounts).reduce((a, b) => Math.max(a, b), 0);

  return { longest, bestAvgPower, bestPeakPower, totalRides, totalSeconds, currentWeekStreak, longestWeekStreak, bestWeekCount };
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
  const stats = [
    entry.avgPower != null && `${entry.avgPower}W avg`,
    entry.maxPower != null && `${entry.maxPower}W max`,
    entry.tss != null && `TSS ${Math.round(entry.tss)}`,
    entry.calories != null && `${entry.calories} kcal`,
  ].filter(Boolean);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13.5, color: TEXT, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</div>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: SUB }}>{new Date(entry.date).toLocaleDateString()} · {fmtLong(entry.duration)}</div>
        {stats.length > 0 && <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, marginTop: 3 }}>{stats.join(' · ')}</div>}
      </div>
      {!entry.completed && <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 10, color: SUB, border: `1px solid ${LINE}`, borderRadius: 999, padding: '2px 8px', flexShrink: 0 }}>Partial</div>}
    </div>
  );
}

function HomeView({ account, ftpHistory, workoutHistory, trainingPlan, onNavigate, onPlayGame }) {
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Late one' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = (account && account.name ? account.name.split(' ')[0] : '') || 'Rider';

  const weekAgo = Date.now() - 7 * 86400000;
  const thisWeek = (workoutHistory || []).filter(w => new Date(w.date).getTime() >= weekAgo);
  const weekSeconds = thisWeek.reduce((a, w) => a + w.duration, 0);

  const ftpValues = (ftpHistory || []).slice(-8).map(h => h.ftp);
  const currentFtpVal = ftpValues.length ? ftpValues[ftpValues.length - 1] : null;
  const prevFtpVal = ftpValues.length > 1 ? ftpValues[ftpValues.length - 2] : null;
  const ftpDelta = currentFtpVal != null && prevFtpVal != null ? currentFtpVal - prevFtpVal : null;

  const pr = computePersonalRecords(workoutHistory);
  const streak = pr ? pr.currentWeekStreak : 0;
  const bestStreak = pr ? pr.longestWeekStreak : 0;

  const workoutCount = LIBRARY.filter(w => w.category === 'Basics').length;
  const rideCount = LIBRARY.filter(w => w.category === 'Rides').length;

  // Approximate "sessions done this week" from logged history within the
  // current plan week's date range — the plan itself doesn't track
  // per-day completion, so this is a best-effort read rather than a
  // stored fact.
  const planWeekNum = trainingPlan ? currentPlanWeek(trainingPlan) : null;
  const planWeekData = trainingPlan && trainingPlan.weeks ? trainingPlan.weeks[planWeekNum - 1] : null;
  const planPhase = planWeekData ? PHASE[planWeekData.phase] : null;
  let planSessionsDone = 0;
  if (trainingPlan && trainingPlan.createdAt && planWeekData) {
    const start = new Date(trainingPlan.createdAt).getTime() + (planWeekNum - 1) * 7 * 86400000;
    const end = start + 7 * 86400000;
    planSessionsDone = Math.min(
      (workoutHistory || []).filter(w => w.completed && new Date(w.date).getTime() >= start && new Date(w.date).getTime() < end).length,
      planWeekData.days.length
    );
  }
  const planPct = planWeekData && planWeekData.days.length ? Math.round((planSessionsDone / planWeekData.days.length) * 100) : 0;

  const plannerCaption = trainingPlan
    ? `Week ${planWeekNum} of ${trainingPlan.totalWeeks}`
    : 'Build a plan';

  const heroes = [
    { key: 'basics', label: 'Workouts', caption: `${workoutCount} sessions`, icon: Dumbbell, photo: '/images/home-workouts.jpg', photoPos: 'center 45%', ink: 'var(--hero1-ink)', chip: 'var(--hero1-chip)' },
    { key: 'rides', label: 'Rides', caption: `${rideCount} routes`, icon: Bike, photo: '/images/home-rides.jpg', photoPos: 'center 74%', ink: 'var(--hero2-ink)', chip: 'var(--hero2-chip)' },
    { key: 'planner', label: 'Planner', caption: plannerCaption, icon: CalendarDays, photo: '/images/home-planner.jpg', surface: 'var(--hero3)', photoPos: 'center 45%', ink: 'var(--hero3-ink)', chip: 'var(--hero3-chip)' },
    { key: 'games', label: 'Race the Pros', caption: '5 pro efforts', icon: Mountain, photo: '/images/home-games.jpg', photoPos: 'center 58%', surface: 'var(--hero3)', ink: 'var(--hero3-ink)', chip: 'var(--hero3-chip)' },
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
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{greeting}</div>
            <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: 600, color: TEXT, lineHeight: 1.1 }}>{firstName}</div>
          </div>
          {streak > 0 && (
            <div title={`${streak} week${streak === 1 ? '' : 's'} in a row with a ride`} style={{ display: 'flex', alignItems: 'center', gap: 6, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 999, padding: '6px 12px' }}>
              <Flame size={15} color="var(--flame)" fill="var(--flame)" />
              <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 13, color: TEXT }}>{streak}w</span>
            </div>
          )}
        </div>

        {/* plan progress */}
        {trainingPlan && planWeekData && (
          <div style={{ ...cardBase, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={kick}>Plan · week {planWeekNum} of {trainingPlan.totalWeeks}</div>
              {planPhase && <div style={{ fontSize: 10.5, color: 'var(--accent)', fontWeight: 700 }}>{planPhase.label} phase</div>}
            </div>
            <div style={{ height: 5, background: LINE, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ width: `${planPct}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
            <div style={{ fontSize: 10.5, color: SUB }}>{planSessionsDone} of {planWeekData.days.length} sessions done this week</div>
          </div>
        )}

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
            <div style={kick}>Weekly streak</div>
            <div style={monoVal}>{streak}w</div>
            <div style={{ fontSize: 10.5, color: SUB, marginTop: 2 }}>Best: {bestStreak}w</div>
          </div>
        </div>

        <TrainingLoadPanel workoutHistory={workoutHistory} includePower={false} />
        <PersonalRecordsPanel workoutHistory={workoutHistory} />

        <Suspense fallback={null}><FeedbackHeroCard onNavigate={onNavigate} /></Suspense>

        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 20, fontWeight: 600, color: TEXT, marginBottom: 14 }}>What are we riding?</div>

        {/* hero cards — 2-column grid, since primary navigation already lives in the sidebar/tab bar */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          {heroes.map(h => (
            <button key={h.key} onClick={() => h.key === 'games' ? import('./MiniGames').then(m => onPlayGame(m.BEAT_THE_PROS)) : onNavigate(h.key)} style={{ padding: 0, border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden', cursor: 'pointer', background: PANEL, display: 'block', textAlign: 'left', minWidth: 0 }}>
              <div style={{ position: 'relative', height: 84, ...(h.photo ? { backgroundImage: `url(${h.photo})`, backgroundSize: 'cover', backgroundPosition: h.photoPos } : { background: h.surface }), display: 'flex', alignItems: 'flex-end' }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: h.chip, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 0 10px 10px' }}>
                  <h.icon size={16} color={h.ink} />
                </div>
                {h.key === 'planner' && trainingPlan && (
                  <div style={{ position: 'absolute', top: 8, right: 8, background: 'var(--accent)', color: INK, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', borderRadius: 5, padding: '2px 6px' }}>Active</div>
                )}
              </div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 14.5, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.label}</div>
                <div style={{ fontSize: 10.5, color: SUB, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.caption}</div>
              </div>
            </button>
          ))}
        </div>

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
  const navLayout = useNavLayout();
  const pr = computePersonalRecords(workoutHistory);
  if (!pr) return null;
  const cards = [
    { label: 'Longest ride', value: fmtLong(pr.longest.duration), sub: pr.longest.name, icon: Bike },
    pr.bestAvgPower && { label: 'Best average power', value: `${pr.bestAvgPower.avgPower}W`, sub: pr.bestAvgPower.name, icon: Zap },
    pr.bestPeakPower && { label: 'Peak power', value: `${pr.bestPeakPower.maxPower}W`, sub: pr.bestPeakPower.name, icon: Zap },
    { label: 'Weekly streak', value: `${pr.currentWeekStreak} week${pr.currentWeekStreak === 1 ? '' : 's'}`, sub: pr.longestWeekStreak > pr.currentWeekStreak ? `Best: ${pr.longestWeekStreak} weeks` : pr.currentWeekStreak > 0 ? 'Personal best' : `Best: ${pr.longestWeekStreak} weeks`, icon: Flame },
    { label: 'Best week', value: `${pr.bestWeekCount} session${pr.bestWeekCount === 1 ? '' : 's'}`, sub: null, icon: CalendarDays },
    { label: 'All-time', value: fmtLong(pr.totalSeconds), sub: `${pr.totalRides} ride${pr.totalRides === 1 ? '' : 's'}`, icon: Trophy },
  ].filter(Boolean);

  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Trophy size={15} color="var(--accent)" />
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>Personal records</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: navLayout.mode === 'sidebar' ? '1fr 1fr 1fr' : '1fr 1fr', gap: 10 }}>
        {cards.map((c, i) => (
          <div key={i} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, minWidth: 0 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 5 }}>
              <c.icon size={11} /> {c.label}
            </div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 700, color: TEXT }}>{c.value}</div>
            {c.sub && <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Weekly training load (summed TSS) over the last 8 weeks, plus an average
// power trend across recent rides — gives a sense of whether load is
// trending up, flat, or dropping, alongside the single-ride personal
// records above. Rides logged before TSS existed simply contribute 0.
function TrainingLoadPanel({ workoutHistory, includePower = true }) {
  const completed = (workoutHistory || []).filter(w => w.completed);
  if (completed.length === 0) return null;

  const thisWeekStart = startOfWeek(new Date().toISOString());
  const weeks = [];
  for (let i = 7; i >= 0; i--) weeks.push(thisWeekStart - i * 7 * 86400000);
  const tssByWeek = {};
  completed.forEach(w => {
    const wk = startOfWeek(w.date);
    tssByWeek[wk] = (tssByWeek[wk] || 0) + (w.tss || 0);
  });
  const values = weeks.map(wk => Math.round(tssByWeek[wk] || 0));
  const maxVal = Math.max(1, ...values);
  const hasAnyLoad = values.some(v => v > 0);

  const withPower = includePower ? completed.filter(w => w.avgPower != null).slice(-10) : [];
  const powerValues = withPower.map(w => w.avgPower);

  if (!hasAnyLoad && powerValues.length < 2) return null;

  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <BarChart3 size={15} color="var(--accent)" />
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>Training load</div>
      </div>
      {hasAnyLoad && (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, marginBottom: powerValues.length >= 2 ? 10 : 0 }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, marginBottom: 8 }}>Weekly TSS · last 8 weeks</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 60 }}>
            {values.map((v, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', height: '100%' }}>
                <div title={`${v} TSS`} style={{ width: '100%', maxWidth: 22, height: `${Math.max(3, (v / maxVal) * 100)}%`, borderRadius: 4, background: i === values.length - 1 ? 'var(--accent)' : PANEL, border: `1px solid ${LINE}` }} />
              </div>
            ))}
          </div>
        </div>
      )}
      {powerValues.length >= 2 && (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, marginBottom: 2 }}>Average power · last {powerValues.length} rides</div>
          <Sparkline values={powerValues} height={30} />
        </div>
      )}
    </div>
  );
}

function HistoryView({ workoutHistory, onClear }) {
  const all = (workoutHistory || []).slice().reverse();
  return (
    <div style={{ padding: '16px 16px 80px' }}>
      <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 800, textTransform: 'uppercase', fontSize: 26, color: TEXT, letterSpacing: -0.3, marginBottom: 2 }}>History</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13, color: SUB }}>{all.length} session{all.length === 1 ? '' : 's'} logged</div>
        {all.length > 0 && (
          <button onClick={onClear} style={{ fontFamily: "'Manrope', sans-serif", background: 'none', border: 'none', color: SUB, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>
      <PersonalRecordsPanel workoutHistory={workoutHistory} />
      <TrainingLoadPanel workoutHistory={workoutHistory} />
      {all.length === 0 ? (
        <div style={{ fontFamily: "'Manrope', sans-serif", color: SUB, fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No workouts logged yet — finish a session and it'll show up here.</div>
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
      <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 800, textTransform: 'uppercase', fontSize: 26, color: TEXT, letterSpacing: -0.3, marginBottom: 2 }}>FTP</div>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13, color: SUB, marginBottom: 18 }}>Test your threshold power and keep an eye on it over time.</div>

      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 18, marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>Current FTP</div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 32, fontWeight: 700, color: TEXT }}>{ftp}W</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FtpInput ftp={ftp} setFtp={setFtp}
            style={{ width: 72, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, padding: '8px 10px', fontSize: 14, textAlign: 'center', fontFamily: "'Space Grotesk', sans-serif" }} />
          <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12.5, color: SUB }}>W</span>
        </div>
      </div>

      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>Test protocols</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 26 }}>
        {tests.map(w => {
          const total = totalDuration(w.intervals);
          return (
            <div key={w.id} onClick={() => onOpenWorkout(w)} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 700, fontSize: 17, color: TEXT }}>{w.name}</div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtLong(total)}</div>
              </div>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12.5, color: SUB, marginBottom: 10 }}>{w.description}</div>
              <ProfileChart intervals={w.intervals} height={40} />
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>Test history</div>
        {history.length > 0 && (
          <button onClick={onClearFtpHistory} style={{ fontFamily: "'Manrope', sans-serif", background: 'none', border: 'none', color: SUB, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>
      {history.length === 0 ? (
        <div style={{ fontFamily: "'Manrope', sans-serif", color: SUB, fontSize: 13, textAlign: 'center', padding: '24px 0', border: `1px dashed ${LINE}`, borderRadius: 10 }}>
          No FTP tests logged yet — run one of the protocols above to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {history.map(entry => (
            <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 11px' }}>
              <div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13.5, color: TEXT, fontWeight: 600 }}>{entry.ftp}W</div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: SUB }}>{entry.source}</div>
              </div>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: SUB }}>{new Date(entry.date).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- library view ----------
const LIBRARY_SORTS = [
  { key: 'default', label: 'Default' },
  { key: 'short', label: 'Shortest' },
  { key: 'long', label: 'Longest' },
  { key: 'easy', label: 'Easiest' },
  { key: 'hard', label: 'Hardest' },
  { key: 'starred', label: 'Starred' },
];
function LibraryView({ customWorkouts, onOpen, lockedCategory, title, subtitle, category, onCategoryChange, starredIds, onToggleStar }) {
  const [query, setQuery] = useState('');
  const [localCat, setLocalCat] = useState(lockedCategory || 'All');
  const cvd = useContext(ColorblindContext);
  // Category can be driven externally (the sidebar's category list on wide
  // viewports) or kept local (the chip row shown on portrait phone) — both
  // read/write the same value so the two stay in sync.
  const cat = category !== undefined ? category : localCat;
  const setCat = onCategoryChange || setLocalCat;
  const navLayout = useNavLayout();
  const cardBarHeight = navLayout.mode === 'sidebar' ? (navLayout.width >= 200 ? 56 : navLayout.width >= 168 ? 48 : 40) : 40;
  const [sort, setSort] = useState('default');
  const all = useMemo(() => {
    const withFlag = LIBRARY.map(w => ({ ...w, custom: false })).concat(customWorkouts.map(w => ({ ...w, custom: true })));
    const activeCat = lockedCategory || cat;
    const purpose = CATEGORY_TO_PURPOSE[activeCat];
    const list = withFlag.filter(w => {
      if (activeCat === 'All') return true;
      if (activeCat === 'Custom') return w.custom;
      if (activeCat === 'Pain') return !!w.pain;
      if (purpose) {
        // Built-ins: match their real tagged purpose. Custom workouts have
        // no entry in WORKOUT_PURPOSE (it's keyed by fixed library ids), so
        // fall back to whatever category the builder saved on them directly.
        const wPurpose = WORKOUT_PURPOSE[w.id];
        const resolvedPurpose = wPurpose ? (PURPOSE_CHIP_ALIASES[wPurpose] || wPurpose) : null;
        return resolvedPurpose ? resolvedPurpose === purpose : w.category === activeCat;
      }
      return w.category === activeCat; // Rides / Basics
    }).filter(w => w.name.toLowerCase().includes(query.toLowerCase()));
    if (sort === 'default') return list;
    const withMeta = list.map(w => ({ w, dur: totalDuration(w.intervals), intensity: workoutIntensity(w), starred: starredIds.has(w.id) ? 1 : 0 }));
    const cmp = {
      short: (a, b) => a.dur - b.dur,
      long: (a, b) => b.dur - a.dur,
      easy: (a, b) => a.intensity - b.intensity,
      hard: (a, b) => b.intensity - a.intensity,
      starred: (a, b) => b.starred - a.starred,
    }[sort];
    return withMeta.sort(cmp).map(m => m.w);
  }, [query, cat, customWorkouts, lockedCategory, sort, starredIds]);

  return (
    <div style={{ padding: '16px 16px 80px' }}>
      <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 800, textTransform: 'uppercase', fontSize: 26, color: TEXT, letterSpacing: -0.3, marginBottom: 2 }}>{title || 'Workout library'}</div>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13, color: SUB, marginBottom: 14 }}>{subtitle || `${all.length} workout${all.length === 1 ? '' : 's'} · pick one and go`}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 12px', marginBottom: 12 }}>
        <Search size={16} color={SUB} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search workouts"
          style={{ background: 'none', border: 'none', outline: 'none', color: TEXT, fontSize: 14, flex: 1 }} />
      </div>
      {!lockedCategory && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
          {CATEGORIES.filter(c => c !== 'Rides' && c !== 'Basics').concat('Custom', 'Pain').map(c => <Chip key={c} active={cat === c} onClick={() => setCat(cat === c ? 'All' : c)}>{c}</Chip>)}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 0 }}>Sort</span>
        {LIBRARY_SORTS.map(s => <Chip key={s.key} active={sort === s.key} onClick={() => setSort(s.key)}>{s.label}</Chip>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {all.map(w => {
          const total = totalDuration(w.intervals);
          const starred = starredIds.has(w.id);
          return (
            <div key={w.id} onClick={() => onOpen(w)} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                {w.pain && <InfoDot openDown icon={<Skull size={15} color={RED} />} text="These rides are designed to be nearly impossible at your true FTP. You can always dial down the FTP for a taste test." />}
                <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 700, fontSize: 17, color: TEXT, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</div>
                <button onClick={e => { e.stopPropagation(); onToggleStar(w.id); }} title={starred ? 'Unstar' : 'Star'}
                  style={{ background: 'none', border: 'none', padding: 2, margin: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <Star size={16} color={starred ? 'var(--accent)' : SUB} fill={starred ? 'var(--accent)' : 'none'} />
                </button>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 12, color: 'var(--accent)', flexShrink: 0 }}>{fmtLong(total)}</div>
              </div>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12.5, color: SUB, marginTop: 6, marginBottom: 10 }}>{w.description}</div>
              <ProfileChart intervals={w.intervals} height={cardBarHeight} />
            </div>
          );
        })}
        {all.length === 0 && <div style={{ color: SUB, fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No workouts match. Try the builder tab to make your own.</div>}
      </div>
    </div>
  );
}

// ---------- queue view ----------
const QUEUE_DRAG_HOLD_MS = 320;       // how long a press has to hold still before it's treated as "lift to drag" rather than a tap or a scroll
const QUEUE_DRAG_MOVE_CANCEL_PX = 8;  // movement past this before the hold timer fires cancels it, treating the gesture as a scroll instead

// Press-and-hold drag reordering for the Queue tab. A quick tap on a row
// still opens its workout details (same as before) — only a sustained
// press-and-hold lifts the row so it can be dragged to a new position,
// which is far more touch-friendly than the old up/down arrow buttons.
function QueueRowList({ resolved, onOpen, onRemove, onReorder }) {
  const [order, setOrder] = useState(() => resolved.map(w => w.id));
  useEffect(() => { setOrder(resolved.map(w => w.id)); }, [resolved]);
  const byId = useMemo(() => {
    const m = {};
    resolved.forEach(w => { m[w.id] = w; });
    return m;
  }, [resolved]);
  const ordered = order.map(id => byId[id]).filter(Boolean);

  const rowRefs = useRef({});
  // { id, pointerId, holdTimer, startY, holding, order0, draggedIndex0, slotHeight }
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  function clearHoldTimer() {
    if (dragRef.current && dragRef.current.holdTimer) clearTimeout(dragRef.current.holdTimer);
  }
  function handlePointerDown(e, id) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const startY = e.clientY;
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    const timer = setTimeout(() => {
      if (!dragRef.current || dragRef.current.pointerId !== pointerId) return;
      // Snapshot the whole row order and each row's position right now,
      // before the dragged row gets its lift transform. Everything the
      // gesture does from here is measured against this fixed frame,
      // rather than re-reading the dragged row's own (already-transformed)
      // position each move -- which is what made the target position drift
      // depending on drag direction.
      const order0 = order;
      const tops = {};
      order0.forEach(rid => {
        const rowEl = rowRefs.current[rid];
        if (rowEl) tops[rid] = rowEl.getBoundingClientRect().top;
      });
      const draggedIndex0 = order0.indexOf(id);
      let slotHeight = 68; // sane fallback (row height + gap) for a single-row queue
      if (order0.length > 1) {
        const neighborIdx = draggedIndex0 === 0 ? 1 : draggedIndex0 - 1;
        const span = Math.abs(tops[order0[neighborIdx]] - tops[order0[draggedIndex0]]);
        if (span > 0) slotHeight = span / Math.abs(neighborIdx - draggedIndex0);
      }
      dragRef.current = { ...dragRef.current, holding: true, order0, draggedIndex0, slotHeight };
      setDraggingId(id);
      try { el.setPointerCapture(pointerId); } catch (err) {}
    }, QUEUE_DRAG_HOLD_MS);
    dragRef.current = { id, pointerId, holdTimer: timer, startY, holding: false };
  }
  function handlePointerMove(e) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.holding) {
      if (Math.abs(dy) > QUEUE_DRAG_MOVE_CANCEL_PX) { clearHoldTimer(); dragRef.current = null; }
      return;
    }
    // How many rows' worth of distance the pointer has covered since the
    // drag began, measured once against the start-of-drag snapshot so it
    // can't compound over a long drag or differ by direction.
    const rawShift = Math.round(dy / d.slotHeight);
    const targetIndex = Math.max(0, Math.min(d.order0.length - 1, d.draggedIndex0 + rawShift));
    const appliedShift = targetIndex - d.draggedIndex0;
    // The flow position (from reordering) covers whole slots; the transform
    // only needs to carry the leftover sub-slot distance so the row still
    // tracks the finger exactly, without double-counting the slot move.
    setDragOffsetY(dy - appliedShift * d.slotHeight);
    setOrder(prev => {
      const currentIndex = prev.indexOf(d.id);
      if (targetIndex === currentIndex) return prev;
      const next = d.order0.slice();
      next.splice(next.indexOf(d.id), 1);
      next.splice(targetIndex, 0, d.id);
      return next;
    });
  }
  function handlePointerUp() {
    const d = dragRef.current;
    clearHoldTimer();
    if (d && d.holding) {
      suppressClickRef.current = true;
      onReorder(order);
    }
    dragRef.current = null;
    setDraggingId(null);
    setDragOffsetY(0);
  }
  function handleRowClick(e, w) {
    if (suppressClickRef.current) { suppressClickRef.current = false; e.preventDefault(); e.stopPropagation(); return; }
    onOpen(w);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ordered.map((w, i) => {
        const isDragging = draggingId === w.id;
        return (
          <div key={w.id}
            ref={el => { rowRefs.current[w.id] = el; }}
            onPointerDown={e => handlePointerDown(e, w.id)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12,
              touchAction: isDragging ? 'none' : 'pan-y',
              WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none',
              transform: isDragging ? `translateY(${dragOffsetY}px) scale(1.02)` : 'none',
              boxShadow: isDragging ? '0 8px 20px rgba(0,0,0,0.25)' : 'none',
              position: 'relative', zIndex: isDragging ? 2 : 1, cursor: 'grab',
            }}>
            <div onClick={e => handleRowClick(e, w)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 10, color: SUB, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3 }}>#{i + 1}</div>
              <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 700, fontSize: 15.5, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: SUB, marginTop: 2 }}>{fmtLong(totalDuration(w.intervals))} · {w.category}</div>
            </div>
            <div style={{ color: SUB, display: 'flex', alignItems: 'center', padding: '4px 2px' }}><GripVertical size={18} /></div>
            <IconBtn onClick={() => onRemove(w.id)} danger><Trash2 size={15} /></IconBtn>
          </div>
        );
      })}
    </div>
  );
}

// Inline "name it and save" control for turning the current queue into a
// reloadable preset. Surfaces the specific reason a save was rejected
// (name limit, workout-count limit, saved-queue limit) rather than failing
// silently.
function SaveQueueControl({ queueLength, savedCount, maxSaved, maxWorkouts, onSave }) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  if (queueLength === 0) return null;

  function submit() {
    const result = onSave(name);
    if (!result || !result.ok) {
      if (result?.reason === 'limit') setError(`You've reached the ${maxSaved}-saved-queue limit — delete one first.`);
      else if (result?.reason === 'too-long') setError(`Saved queues are capped at ${maxWorkouts} workouts — trim your queue first.`);
      else if (result?.reason === 'name') setError('Give it a name first.');
      else setError('Could not save — try again.');
      return;
    }
    setSaving(false);
    setName('');
    setError('');
  }

  if (!saving) {
    return (
      <button onClick={() => setSaving(true)}
        style={{ fontFamily: "'Manrope', sans-serif", padding: '9px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 12.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Save size={13} /> Save this queue
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={name} onChange={e => { setName(e.target.value); setError(''); }} placeholder="e.g. Monday plan" autoFocus
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setSaving(false); setError(''); } }}
          style={{ fontFamily: "'Manrope', sans-serif", flex: 1, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, padding: '8px 10px', fontSize: 13 }} />
        <button onClick={submit} style={{ fontFamily: "'Manrope', sans-serif", padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Save</button>
        <button onClick={() => { setSaving(false); setError(''); }} style={{ fontFamily: "'Manrope', sans-serif", padding: '8px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
      </div>
      {error && <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: RED }}>{error}</div>}
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB }}>{savedCount}/{maxSaved} saved queues used</div>
    </div>
  );
}

// Named queue presets a rider can reload. Shown whenever any exist, even if
// the active queue is currently empty -- loading a saved queue is very
// likely exactly why someone opened this tab with nothing queued.
function SavedQueuesList({ savedQueues, customWorkouts, onLoad, onDelete }) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  if (!savedQueues.length) return null;
  const all = LIBRARY.concat(customWorkouts);
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>Saved queues</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {savedQueues.map(sq => {
          const resolvedWorkouts = sq.workoutIds.map(id => all.find(w => w.id === id)).filter(Boolean);
          const totalSecs = resolvedWorkouts.reduce((sum, w) => sum + totalDuration(w.intervals), 0);
          return (
            <div key={sq.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 700, fontSize: 15, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sq.name}</div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: SUB, marginTop: 2 }}>{resolvedWorkouts.length} workout{resolvedWorkouts.length === 1 ? '' : 's'} · {fmtLong(totalSecs)}</div>
              </div>
              <button onClick={() => onLoad(sq.id)} title="Load into queue"
                style={{ fontFamily: "'Manrope', sans-serif", background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontWeight: 700, fontSize: 12, color: INK, flexShrink: 0 }}>
                <Play size={13} fill={INK} /> Load
              </button>
              {confirmDeleteId === sq.id ? (
                <IconBtn onClick={() => { onDelete(sq.id); setConfirmDeleteId(null); }} danger><Check size={15} /></IconBtn>
              ) : (
                <IconBtn onClick={() => setConfirmDeleteId(sq.id)} danger><Trash2 size={15} /></IconBtn>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QueueView({ queue, customWorkouts, onOpen, onRemove, onReorder, onClear, onStartQueue, savedQueues = [], maxSavedQueues = 8, maxSavedQueueWorkouts = 8, onSaveQueue, onLoadSavedQueue, onDeleteSavedQueue, lastRemovedQueueItem, onUndoRemove }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const resolved = useMemo(() => {
    const all = LIBRARY.concat(customWorkouts);
    return queue.map(id => all.find(w => w.id === id)).filter(Boolean);
  }, [queue, customWorkouts]);
  const totalSeconds = resolved.reduce((sum, w) => sum + totalDuration(w.intervals), 0);
  const removedWorkout = useMemo(() => {
    if (!lastRemovedQueueItem) return null;
    return LIBRARY.concat(customWorkouts).find(w => w.id === lastRemovedQueueItem.id) || null;
  }, [lastRemovedQueueItem, customWorkouts]);

  return (
    <div style={{ padding: '16px 16px 80px' }}>
      <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 800, textTransform: 'uppercase', fontSize: 26, color: TEXT, letterSpacing: -0.3, marginBottom: 2 }}>Queue</div>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13, color: SUB, marginBottom: 16 }}>
        {resolved.length === 0 ? 'Nothing queued yet.' : `${resolved.length} workout${resolved.length === 1 ? '' : 's'} · ${fmtLong(totalSeconds)} back-to-back`}
      </div>

      {removedWorkout && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 10px 8px 12px', marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0, fontFamily: "'Manrope', sans-serif", fontSize: 12.5, color: SUB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Removed <span style={{ color: TEXT, fontWeight: 600 }}>{removedWorkout.name}</span>
          </div>
          <button onClick={onUndoRemove}
            style={{ fontFamily: "'Manrope', sans-serif", flexShrink: 0, background: 'none', border: `1px solid ${LINE}`, borderRadius: 7, padding: '5px 11px', color: 'var(--accent)', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <RotateCcw size={12} /> Undo
          </button>
        </div>
      )}

      <SavedQueuesList savedQueues={savedQueues} customWorkouts={customWorkouts} onLoad={onLoadSavedQueue} onDelete={onDeleteSavedQueue} />

      {resolved.length === 0 ? (
        <div style={{ fontFamily: "'Manrope', sans-serif", color: SUB, fontSize: 13, textAlign: 'center', padding: '30px 20px', border: `1px dashed ${LINE}`, borderRadius: 10, lineHeight: 1.6 }}>
          Add workouts or rides from Library, Basics or Rides — look for the <b style={{ color: TEXT }}>Queue</b> button next to Start workout. Queue two or more and they'll roll straight into each other, back to back.
        </div>
      ) : (
        <>
          <QueueProfileStrip resolved={resolved} />

          <button onClick={() => onStartQueue(resolved)}
            style={{ fontFamily: "'Manrope', sans-serif", width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', marginBottom: 16 }}>
            <Play size={18} fill={INK} /> Start queue
          </button>

          <QueueRowList resolved={resolved} onOpen={onOpen} onRemove={onRemove} onReorder={onReorder} />

          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SaveQueueControl queueLength={resolved.length} savedCount={savedQueues.length} maxSaved={maxSavedQueues} maxWorkouts={maxSavedQueueWorkouts} onSave={onSaveQueue} />
            {!confirmClear ? (
              <button onClick={() => setConfirmClear(true)}
                style={{ fontFamily: "'Manrope', sans-serif", padding: '9px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: RED, fontSize: 12.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
                <RefreshCw size={13} /> Clear queue
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { onClear(); setConfirmClear(false); }}
                  style={{ fontFamily: "'Manrope', sans-serif", padding: '9px 14px', borderRadius: 8, border: 'none', background: RED, color: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Confirm</button>
                <button onClick={() => setConfirmClear(false)}
                  style={{ fontFamily: "'Manrope', sans-serif", padding: '9px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- builder view ----------
const QUICK_BLOCKS = [
  { label: 'Warm up', duration: 300, type: 'power', target: 55 },
  { label: 'Cool down', duration: 300, type: 'power', target: 50 },
  { label: 'Recovery', duration: 120, type: 'power', target: 55 },
  { label: 'Endurance', duration: 600, type: 'power', target: 70 },
  { label: 'Sweet spot', duration: 480, type: 'power', target: 90 },
  { label: 'Threshold', duration: 300, type: 'power', target: 100 },
  { label: 'VO2 max', duration: 180, type: 'power', target: 115 },
  { label: 'Sprint', duration: 30, type: 'power', target: 160 },
];

function IntervalRow({ interval, onChange, onDelete, onMoveUp, onMoveDown, onDuplicate, first, last, selected, onToggleSelect, touched, rowRef }) {
  const cvd = useContext(ColorblindContext);
  const z = zoneFor(interval, cvd);
  const mins = Math.floor(interval.duration / 60);
  const secs = interval.duration % 60;

  // The minutes/seconds fields need their own "what's currently typed"
  // state, separate from the derived mins/secs above. As a plain controlled
  // number, clearing the field becomes 0 immediately (Number('') || 0) and
  // it re-fills with "0" before you can type a new value -- you can never
  // get an empty field. Same fix already used for FtpInput: keep a draft
  // string while focused, only reconcile with the real duration on blur.
  const [minsDraft, setMinsDraft] = useState(String(mins));
  const [minsFocused, setMinsFocused] = useState(false);
  useEffect(() => { if (!minsFocused) setMinsDraft(String(mins)); }, [mins, minsFocused]);
  const [secsDraft, setSecsDraft] = useState(String(secs));
  const [secsFocused, setSecsFocused] = useState(false);
  useEffect(() => { if (!secsFocused) setSecsDraft(String(secs)); }, [secs, secsFocused]);

  function commitMins() {
    const n = parseInt(minsDraft, 10);
    const clamped = Number.isFinite(n) ? Math.max(0, n) : 0;
    onChange({ ...interval, duration: clamped * 60 + secs });
    setMinsDraft(String(clamped));
  }
  function commitSecs() {
    const n = parseInt(secsDraft, 10);
    const clamped = Number.isFinite(n) ? Math.min(59, Math.max(0, n)) : 0;
    onChange({ ...interval, duration: mins * 60 + clamped });
    setSecsDraft(String(clamped));
  }

  const [targetDraft, setTargetDraft] = useState(String(interval.target ?? ''));
  const [targetFocused, setTargetFocused] = useState(false);
  useEffect(() => { if (!targetFocused) setTargetDraft(String(interval.target ?? '')); }, [interval.target, targetFocused]);
  function commitTarget() {
    const n = parseInt(targetDraft, 10);
    if (!Number.isFinite(n) || targetDraft.trim() === '') { setTargetDraft(String(interval.target ?? '')); return; } // left blank -> keep current
    const clamped = interval.type === 'rpe' ? Math.min(10, Math.max(0, n)) : Math.min(250, Math.max(0, n));
    onChange({ ...interval, target: clamped });
    setTargetDraft(String(clamped));
  }

  return (
    <div ref={rowRef} style={{
      background: PANEL,
      border: touched ? `2px solid var(--accent)` : selected ? `1px solid var(--accent)` : `1px solid ${LINE}`,
      boxShadow: touched ? '0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent)' : 'none',
      borderRadius: 10, padding: touched ? 9 : 10, marginBottom: 8,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <div style={{ width: 4, alignSelf: 'stretch', background: z.color, borderRadius: 2, flexShrink: 0 }} />
        <button onClick={onToggleSelect} title={selected ? 'Deselect' : 'Select'} style={{
          width: 22, height: 22, borderRadius: 5, border: `1px solid ${selected ? 'var(--accent)' : LINE}`,
          background: selected ? 'var(--accent)' : PANEL2, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0, padding: 0,
        }}>
          {selected && <Check size={14} color={INK} />}
        </button>
        <input value={interval.label} onChange={e => onChange({ ...interval, label: e.target.value })}
          placeholder="Label" style={{ fontFamily: "'Manrope', sans-serif", flex: 1, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '6px 8px', fontSize: 13 }} />
        <IconBtn onClick={onMoveUp} disabled={first}><ChevronUp size={16} /></IconBtn>
        <IconBtn onClick={onMoveDown} disabled={last}><ChevronDown size={16} /></IconBtn>
        <IconBtn onClick={onDuplicate}><Copy size={15} /></IconBtn>
        <IconBtn onClick={onDelete} danger><Trash2 size={15} /></IconBtn>
      </div>
      <div style={{ fontFamily: "'Manrope', sans-serif", display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: SUB }}>Duration</label>
        <input type="text" inputMode="numeric" value={minsDraft}
          onFocus={() => setMinsFocused(true)}
          onChange={e => setMinsDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
          onBlur={() => { setMinsFocused(false); commitMins(); }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          style={{ fontFamily: "'Space Grotesk', sans-serif", width: 48, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '5px 6px', fontSize: 13 }} />
        <span style={{ color: SUB, fontSize: 12 }}>m</span>
        <input type="text" inputMode="numeric" value={secsDraft}
          onFocus={() => setSecsFocused(true)}
          onChange={e => setSecsDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
          onBlur={() => { setSecsFocused(false); commitSecs(); }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          style={{ fontFamily: "'Space Grotesk', sans-serif", width: 48, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '5px 6px', fontSize: 13 }} />
        <span style={{ color: SUB, fontSize: 12 }}>s</span>
        <select value={interval.type} onChange={e => {
          const t = e.target.value;
          const target = t === 'power' ? 70 : t === 'rpe' ? 5 : null;
          onChange({ ...interval, type: t, target });
        }} style={{ fontFamily: "'Manrope', sans-serif", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '5px 6px', fontSize: 13 }}>
          <option value="power">Power</option>
          <option value="rpe">RPE</option>
          <option value="free">Free</option>
        </select>
        {interval.type !== 'free' && (
          <>
            <input type="text" inputMode="numeric" value={targetDraft}
              onFocus={() => setTargetFocused(true)}
              onChange={e => setTargetDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
              onBlur={() => { setTargetFocused(false); commitTarget(); }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              style={{ fontFamily: "'Space Grotesk', sans-serif", width: 52, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '5px 6px', fontSize: 13 }} />
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
// Maps a road gradient to a realistic indoor power target and a *baseline*
// outdoor speed for that gradient. The speed is only ever used in relative
// terms — to work out how much longer a climb takes than a flat section of
// the same length — because the final duration of every bucket gets scaled
// to whatever total ride time the person chooses at import time. These
// baseline speeds are calibrated to a fit rider's race effort (a solid
// TT-bike endurance pace on the flat, easing off on climbs), not a cautious
// recreational pace, so the *shape* of the pacing is realistic even before
// scaling is applied.
function gradeToEffort(gradePct) {
  if (gradePct <= -6) return { target: 45, speedKmh: 55 };
  if (gradePct <= -2) return { target: 55, speedKmh: 42 };
  if (gradePct <= 1) return { target: 65, speedKmh: 33 };
  if (gradePct <= 3) return { target: 76, speedKmh: 24 };
  if (gradePct <= 5) return { target: 86, speedKmh: 18 };
  if (gradePct <= 8) return { target: 96, speedKmh: 13 };
  if (gradePct <= 11) return { target: 105, speedKmh: 9.5 };
  return { target: 114, speedKmh: 7 };
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
// ---- Phase 1: read the GPX file and work out its shape (no pacing choice yet) ----
// Buckets the route into ~150m chunks to smooth out GPS noise and works out
// the gradient of each chunk. Returns the raw buckets plus a "raw" duration
// estimate (using the baseline race-pace speeds above) — that raw estimate
// becomes the default the person sees before they lock in their own target
// time or average speed in phase 2.
function parseGpxRoute(xmlText, fileName) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('That file doesn’t look like a valid GPX file.');
  const trkpts = Array.from(doc.getElementsByTagName('trkpt'));
  if (trkpts.length < 2) throw new Error('No track points were found in this file.');
  const points = trkpts.map(pt => {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    const eleNode = pt.getElementsByTagName('ele')[0];
    const ele = eleNode ? parseFloat(eleNode.textContent) : null;
    return { lat, lon, ele };
  }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.ele));
  if (points.length < 2) throw new Error('This GPX file doesn’t include elevation data, so a profile can’t be built from it.');

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

  const rawDurationSec = buckets.reduce((acc, b) => {
    const { speedKmh } = gradeToEffort(b.gradePct);
    return acc + b.distance / ((speedKmh * 1000) / 3600);
  }, 0);

  const nameNode = doc.getElementsByTagName('name')[0];
  const routeName = (nameNode && nameNode.textContent.trim()) || (fileName ? fileName.replace(/\.gpx$/i, '') : 'My route');
  const totalDist = buckets.reduce((a, b) => a + b.distance, 0);
  const totalElevGain = points.reduce((acc, p, i) => (i === 0 ? acc : acc + Math.max(0, p.ele - points[i - 1].ele)), 0);

  return { routeName, buckets, totalDist, totalElevGain, rawDurationSec };
}

// Reduces a segment list down to maxSegments by repeatedly merging adjacent
// pairs, but tries to lose as little of the route's *shape* as possible:
// - segments at or above protectThreshold (the steep/spike efforts) are left
//   alone as long as any other pair is available to merge instead
// - among the remaining eligible pairs, the pair with the smallest combined
//   duration is merged first, so short, minor segments get absorbed before
//   any longer, more meaningful one does
function reduceSegments(segs, maxSegments, protectThreshold) {
  const list = segs.map(s => ({ ...s }));
  while (list.length > maxSegments) {
    let bestIdx = -1, bestCombinedDur = Infinity;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if (a.target >= protectThreshold || b.target >= protectThreshold) continue;
      const combinedDur = a.duration + b.duration;
      if (combinedDur < bestCombinedDur) { bestCombinedDur = combinedDur; bestIdx = i; }
    }
    if (bestIdx === -1) {
      // Every remaining pair touches a protected steep segment (a very spiky
      // route) -- merge whichever adjacent pair has the closest targets, so
      // the blend loses the least.
      let smallestDiff = Infinity;
      for (let i = 0; i < list.length - 1; i++) {
        const diff = Math.abs(list[i].target - list[i + 1].target);
        if (diff < smallestDiff) { smallestDiff = diff; bestIdx = i; }
      }
    }
    const a = list[bestIdx], b = list[bestIdx + 1];
    const totalDur = a.duration + b.duration;
    const mergedSeg = { target: Math.round((a.target * a.duration + b.target * b.duration) / totalDur), duration: totalDur };
    list.splice(bestIdx, 2, mergedSeg);
  }
  return list;
}

// ---- Phase 2: turn the analysed route into an actual workout, once the
// person has confirmed (or accepted the default) total ride time ----
function buildWorkoutFromRoute(route, targetDurationSec) {
  const scale = route.rawDurationSec > 0 ? targetDurationSec / route.rawDurationSec : 1;

  const raw = route.buckets.map(b => {
    const { target, speedKmh } = gradeToEffort(b.gradePct);
    const baseDuration = b.distance / ((speedKmh * 1000) / 3600);
    return { target, duration: Math.round(baseDuration * scale) };
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

  // 110 intervals plus warm up/cool down is still a manageable list, and
  // protecting target >= 96 (Steep climb and above) keeps the short, hard
  // pinches that make a route worth riding from being smoothed away.
  const finalSegs = reduceSegments(cleaned, 110, 96);

  // Rounding each bucket's duration to the nearest second can drift the
  // total away from the chosen target by a handful of seconds (more on
  // routes with lots of repeated gradients) -- fold that drift into the
  // single longest segment so the ride's actual length matches what was
  // asked for.
  if (finalSegs.length > 0) {
    const routeDurationSum = finalSegs.reduce((a, s) => a + s.duration, 0);
    const drift = Math.round(targetDurationSec) - routeDurationSum;
    let longestIdx = 0;
    for (let i = 1; i < finalSegs.length; i++) {
      if (finalSegs[i].duration > finalSegs[longestIdx].duration) longestIdx = i;
    }
    finalSegs[longestIdx].duration = Math.max(15, finalSegs[longestIdx].duration + drift);
  }

  const intervals = [
    iv('Warm up', 600, 'power', 55),
    ...finalSegs.map(s => iv(labelForTarget(s.target), Math.max(15, s.duration), 'power', s.target)),
    iv('Cool down', 480, 'power', 50),
  ];

  return {
    id: 'custom-' + newId(),
    name: route.routeName,
    category: 'Rides',
    description: `Built from your uploaded route — ${(route.totalDist / 1000).toFixed(1)}km with ${Math.round(route.totalElevGain)}m of climbing, converted into an indoor power profile.`,
    intervals,
  };
}

// A themed replacement for a native <select>. iOS Safari always renders a
// native <select>'s open state as its own OS wheel picker no matter how the
// closed button is styled, so anywhere the dropdown itself needs to stay in
// the Trbo theme (colors, font, rounded panel) has to be built from scratch
// like this instead.
function ThemedSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onOutside(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [open]);
  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={{
        fontFamily: "'Manrope', sans-serif", width: '100%', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8,
        color: TEXT, padding: '10px 12px', fontSize: 13, boxSizing: 'border-box', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left',
      }}>
        <span>{value}</span>
        <ChevDown size={15} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease', flexShrink: 0, marginLeft: 8, color: SUB }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: PANEL, border: `1px solid ${LINE}`,
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', zIndex: 30, maxHeight: 260, overflowY: 'auto',
          WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', padding: 4,
        }}>
          {options.map(opt => (
            <button key={opt} type="button" onClick={() => { onChange(opt); setOpen(false); }} style={{
              width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 6, background: opt === value ? PANEL2 : 'transparent',
              border: 'none', color: TEXT, fontFamily: "'Manrope', sans-serif", fontSize: 13, fontWeight: opt === value ? 700 : 500, cursor: 'pointer',
            }}>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BuilderView({ customWorkouts, saveCustomWorkout, deleteCustomWorkout, editingWorkout, clearEditing, ownerStats }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Endurance');
  const [description, setDescription] = useState('');
  const [intervals, setIntervals] = useState([]);
  const [gpxError, setGpxError] = useState(null);
  const [gpxBusy, setGpxBusy] = useState(false);
  // Set once a GPX file has been read and analysed, cleared once the person
  // confirms a target pace (or cancels). While this is set, the route
  // hasn't been turned into intervals yet -- that only happens on confirm,
  // using whatever target time/speed they've settled on below.
  const [pendingRoute, setPendingRoute] = useState(null);
  const [targetSeconds, setTargetSeconds] = useState(null);
  // Each pace field keeps its own raw typed text rather than being derived
  // fresh from targetSeconds on every render -- deriving it live meant an
  // emptied field snapped straight back to a formatted number the instant
  // its onChange ran (since a blank value never updates targetSeconds), so
  // it was impossible to actually clear a field before typing a new value.
  const [speedText, setSpeedText] = useState('');
  const [hoursText, setHoursText] = useState('');
  const [minutesText, setMinutesText] = useState('');
  const fileInputRef = useRef(null);
  // Which segment(s) were most recently moved or duplicated — bordered in
  // the list below so a long stack of intervals doesn't lose you after an
  // up/down tap. Separate from selectedIds (the multi-select checkboxes
  // used for "duplicate/move as a group").
  const [lastTouchedIds, setLastTouchedIds] = useState(() => new Set());
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // DOM nodes for each interval card, keyed by interval id, so a tap on the
  // chart above can scroll the matching card into view -- populated via
  // IntervalRow's rowRef callback below.
  const rowRefsMap = useRef({});
  function selectSegment(id) {
    setLastTouchedIds(new Set([id]));
    const el = rowRefsMap.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  // Admin-only: copies a plain-text export of a workout (human-readable list
  // + ready-to-paste library code) to the clipboard. Falls back to a
  // manually-selectable textarea if the clipboard API is unavailable or
  // blocked, which can happen inside the iOS/Android app webview.
  const [exportCopiedId, setExportCopiedId] = useState(null);
  const [exportFallback, setExportFallback] = useState(null);
  async function exportWorkout(w, key) {
    const text = buildWorkoutExportText(w);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setExportCopiedId(key);
        setTimeout(() => setExportCopiedId(prev => (prev === key ? null : prev)), 2000);
        return;
      } catch (err) { /* clipboard blocked -- fall through to manual copy */ }
    }
    setExportFallback(text);
  }

  useEffect(() => {
    if (editingWorkout) {
      setName(editingWorkout.name);
      setCategory(editingWorkout.category);
      setDescription(editingWorkout.description || '');
      setIntervals(editingWorkout.intervals.map(i => ({ ...i })));
      setSelectedIds(new Set());
      setLastTouchedIds(new Set());
    }
  }, [editingWorkout]);

  function handleGpxFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file again later
    if (!file) return;
    setGpxError(null);
    setGpxBusy(true);
    setPendingRoute(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const route = parseGpxRoute(reader.result, file.name);
        setPendingRoute(route);
        const secs = Math.round(route.rawDurationSec);
        const distKm = route.totalDist / 1000;
        setTargetSeconds(secs);
        setSpeedText((Math.round((distKm / (secs / 3600)) * 10) / 10).toString());
        setHoursText(String(Math.floor(secs / 3600)));
        setMinutesText(String(Math.round((secs % 3600) / 60)));
      } catch (err) {
        setGpxError((err && err.message) || 'Could not read that file.');
      }
      setGpxBusy(false);
    };
    reader.onerror = () => { setGpxError('Could not read that file.'); setGpxBusy(false); };
    reader.readAsText(file);
  }
  // Speed and time drive each other (distance is fixed), but only the field
  // NOT currently being typed into gets reformatted -- the one the person is
  // actively editing keeps exactly what they typed, blank included, until it
  // parses to a usable number.
  function onSpeedTextChange(raw) {
    setSpeedText(raw);
    if (!pendingRoute) return;
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    const distKm = pendingRoute.totalDist / 1000;
    const secs = Math.round((distKm / v) * 3600);
    setTargetSeconds(secs);
    setHoursText(String(Math.floor(secs / 3600)));
    setMinutesText(String(Math.round((secs % 3600) / 60)));
  }
  function onHoursTextChange(raw) {
    setHoursText(raw);
    if (!pendingRoute) return;
    const h = parseFloat(raw);
    const m = parseFloat(minutesText);
    const secs = Math.round((Number.isFinite(h) ? h : 0) * 3600 + (Number.isFinite(m) ? m : 0) * 60);
    if (secs <= 0) return;
    setTargetSeconds(secs);
    const distKm = pendingRoute.totalDist / 1000;
    setSpeedText((Math.round((distKm / (secs / 3600)) * 10) / 10).toString());
  }
  function onMinutesTextChange(raw) {
    setMinutesText(raw);
    if (!pendingRoute) return;
    const m = parseFloat(raw);
    const h = parseFloat(hoursText);
    const secs = Math.round((Number.isFinite(h) ? h : 0) * 3600 + (Number.isFinite(m) ? m : 0) * 60);
    if (secs <= 0) return;
    setTargetSeconds(secs);
    const distKm = pendingRoute.totalDist / 1000;
    setSpeedText((Math.round((distKm / (secs / 3600)) * 10) / 10).toString());
  }
  function confirmPendingRoute() {
    if (!pendingRoute) return;
    const workout = buildWorkoutFromRoute(pendingRoute, Math.max(60, targetSeconds || pendingRoute.rawDurationSec));
    setName(workout.name);
    setCategory(workout.category);
    setDescription(workout.description);
    setIntervals(workout.intervals);
    setSelectedIds(new Set());
    setLastTouchedIds(new Set());
    setPendingRoute(null);
  }

  function addBlock(block) { setIntervals(list => [...list, iv(block.label, block.duration, block.type, block.target)]); }
  function updateAt(idx, next) { setIntervals(list => list.map((it, i) => (i === idx ? next : it))); }
  function purgeId(id) {
    setSelectedIds(prev => (prev.has(id) ? (() => { const n = new Set(prev); n.delete(id); return n; })() : prev));
    setLastTouchedIds(prev => (prev.has(id) ? (() => { const n = new Set(prev); n.delete(id); return n; })() : prev));
  }
  function removeAt(idx) {
    const removedId = intervals[idx] && intervals[idx].id;
    setIntervals(list => list.filter((_, i) => i !== idx));
    if (removedId) purgeId(removedId);
  }
  function duplicateAt(idx) {
    const copy = { ...intervals[idx], id: newId() };
    setIntervals(list => {
      const out = [...list];
      out.splice(idx + 1, 0, copy);
      return out;
    });
    setLastTouchedIds(new Set([copy.id]));
  }
  function move(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= intervals.length) return;
    const movedId = intervals[idx].id;
    setIntervals(list => {
      const out = [...list];
      [out[idx], out[j]] = [out[j], out[idx]];
      return out;
    });
    setLastTouchedIds(new Set([movedId]));
  }
  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }
  // Shifts every selected segment up (or down) by one slot, moving the
  // whole selection as a unit past its nearest non-selected neighbour —
  // same one-step-at-a-time feel as the per-row arrows, just applied to
  // however many segments are checked, contiguous or scattered.
  function moveSelectedUp() {
    if (selectedIds.size === 0) return;
    setIntervals(list => {
      const out = [...list];
      for (let i = 1; i < out.length; i++) {
        if (selectedIds.has(out[i].id) && !selectedIds.has(out[i - 1].id)) {
          [out[i - 1], out[i]] = [out[i], out[i - 1]];
        }
      }
      return out;
    });
    setLastTouchedIds(new Set(selectedIds));
  }
  function moveSelectedDown() {
    if (selectedIds.size === 0) return;
    setIntervals(list => {
      const out = [...list];
      for (let i = out.length - 2; i >= 0; i--) {
        if (selectedIds.has(out[i].id) && !selectedIds.has(out[i + 1].id)) {
          [out[i], out[i + 1]] = [out[i + 1], out[i]];
        }
      }
      return out;
    });
    setLastTouchedIds(new Set(selectedIds));
  }
  // Duplicates the whole selected set as one block, inserted right after
  // the last selected segment — the copies become the new selection so a
  // group you just duplicated can be moved elsewhere immediately.
  function duplicateSelected() {
    if (selectedIds.size === 0) return;
    const selectedItems = intervals.filter(it => selectedIds.has(it.id));
    if (selectedItems.length === 0) return;
    const copies = selectedItems.map(it => ({ ...it, id: newId() }));
    const lastIdx = intervals.reduce((acc, it, i) => (selectedIds.has(it.id) ? i : acc), -1);
    setIntervals(list => {
      const out = [...list];
      out.splice(lastIdx + 1, 0, ...copies);
      return out;
    });
    const newIds = new Set(copies.map(c => c.id));
    setSelectedIds(newIds);
    setLastTouchedIds(newIds);
  }
  function reset() { setName(''); setCategory('Endurance'); setDescription(''); setIntervals([]); setGpxError(null); setSelectedIds(new Set()); setLastTouchedIds(new Set()); clearEditing(); }
  function save() {
    if (!name.trim() || intervals.length === 0) return;
    saveCustomWorkout({ id: editingWorkout ? editingWorkout.id : 'custom-' + newId(), name: name.trim(), category, description: description.trim() || 'Custom workout.', intervals });
    reset();
  }

  const total = totalDuration(intervals);

  return (
    <div style={{ padding: '16px 16px 80px' }}>
      <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 800, textTransform: 'uppercase', fontSize: 26, color: TEXT, letterSpacing: -0.3, marginBottom: 2 }}>{editingWorkout ? 'Edit workout' : 'Build a workout'}</div>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13, color: SUB, marginBottom: 16 }}>Stack intervals, mix power, RPE and free riding — or start from a real route.</div>

      <input ref={fileInputRef} type="file" accept=".gpx" onChange={handleGpxFile} style={{ display: 'none' }} />
      <button onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={gpxBusy}
        style={{ fontFamily: "'Manrope', sans-serif", width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 0', borderRadius: 10, border: `1px dashed #C9BEA9`, background: PANEL, color: TEXT, fontSize: 13.5, fontWeight: 600, cursor: gpxBusy ? 'default' : 'pointer', marginBottom: 8, boxSizing: 'border-box' }}>
        <Upload size={15} /> {gpxBusy ? 'Reading route…' : 'Import a route (GPX file)'}
      </button>
      {gpxError && <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: RED, marginBottom: 8 }}>{gpxError}</div>}

      {pendingRoute && (() => {
        const distKm = pendingRoute.totalDist / 1000;
        const inputStyle = { fontFamily: "'Space Grotesk', sans-serif", width: 64, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '6px 8px', fontSize: 14, textAlign: 'center' };
        return (
          <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 2 }}>{pendingRoute.routeName}</div>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB, marginBottom: 12 }}>
              {distKm.toFixed(1)}km · {Math.round(pendingRoute.totalElevGain)}m climbing
            </div>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB, marginBottom: 6 }}>Target pace for this ride</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" step="0.1" value={speedText}
                  onChange={e => onSpeedTextChange(e.target.value)}
                  style={inputStyle} />
                <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB }}>km/h avg</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" value={hoursText}
                  onChange={e => onHoursTextChange(e.target.value)}
                  style={inputStyle} />
                <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB }}>hrs</span>
                <input type="number" value={minutesText}
                  onChange={e => onMinutesTextChange(e.target.value)}
                  style={inputStyle} />
                <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB }}>min</span>
              </div>
            </div>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, marginBottom: 12, lineHeight: 1.5 }}>
              Defaults to a race-pace estimate for this route's climbing. Adjust either field to match a real bike split — climbs will still take proportionally longer than flats.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmPendingRoute} style={{ fontFamily: "'Manrope', sans-serif", flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>Build intervals</button>
              <button onClick={() => { setPendingRoute(null); setGpxError(null); }} style={{ fontFamily: "'Manrope', sans-serif", padding: '10px 16px', borderRadius: 8, border: `1px solid ${LINE}`, background: 'transparent', color: SUB, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {!pendingRoute && (
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: SUB, marginBottom: 14, lineHeight: 1.5 }}>
          Turns a real ride's elevation profile into an indoor power workout — climbs get harder targets, descents get easier ones. You'll set a target pace before it builds intervals.
        </div>
      )}

      <input value={name} onChange={e => setName(e.target.value)} placeholder="Workout name"
        style={{ fontFamily: "'Manrope', sans-serif", width: '100%', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, padding: '10px 12px', fontSize: 15, marginBottom: 8, boxSizing: 'border-box' }} />
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description"
        style={{ fontFamily: "'Manrope', sans-serif", width: '100%', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, padding: '10px 12px', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
      <div style={{ marginBottom: 14 }}>
        <ThemedSelect value={category} onChange={setCategory} options={CATEGORIES.filter(c => c !== 'All' && c !== 'FTP Test')} />
      </div>

      {intervals.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <ProfileChart intervals={intervals} onSegmentClick={selectSegment} />
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB, marginTop: 6 }}>{fmtLong(total)} total · {intervals.length} intervals</div>
        </div>
      )}

      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>Quick add</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {QUICK_BLOCKS.map((b, i) => (
          <button key={i} onClick={() => addBlock(b)} style={{ fontFamily: "'Manrope', sans-serif", display: 'flex', alignItems: 'center', gap: 4, padding: '6px 11px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL, color: TEXT, fontSize: 12.5, cursor: 'pointer' }}>
            <Plus size={13} /> {b.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>Intervals</div>
        {intervals.length > 1 && (
          <button onClick={() => (selectedIds.size > 0 ? clearSelection() : setSelectedIds(new Set(intervals.map(it => it.id))))}
            style={{ fontFamily: "'Manrope', sans-serif", background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
            {selectedIds.size > 0 ? 'Deselect all' : 'Select all'}
          </button>
        )}
      </div>
      {selectedIds.size > 0 && (
        <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, background: PANEL2, border: `1px solid var(--accent)`, borderRadius: 10, padding: '8px 10px', marginBottom: 10 }}>
          <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12.5, color: TEXT, fontWeight: 600, flex: 1 }}>{selectedIds.size} selected</span>
          <IconBtn onClick={moveSelectedUp}><ChevronUp size={16} /></IconBtn>
          <IconBtn onClick={moveSelectedDown}><ChevronDown size={16} /></IconBtn>
          <IconBtn onClick={duplicateSelected}><Copy size={15} /></IconBtn>
        </div>
      )}
      {intervals.map((it, idx) => (
        <IntervalRow key={it.id} interval={it}
          onChange={next => updateAt(idx, next)} onDelete={() => removeAt(idx)}
          onMoveUp={() => move(idx, -1)} onMoveDown={() => move(idx, 1)} onDuplicate={() => duplicateAt(idx)}
          selected={selectedIds.has(it.id)} onToggleSelect={() => toggleSelect(it.id)} touched={lastTouchedIds.has(it.id)}
          rowRef={el => { if (el) rowRefsMap.current[it.id] = el; else delete rowRefsMap.current[it.id]; }}
          first={idx === 0} last={idx === intervals.length - 1} />
      ))}
      {intervals.length === 0 && <div style={{ fontFamily: "'Manrope', sans-serif", color: SUB, fontSize: 13, textAlign: 'center', padding: '20px 0', border: `1px dashed ${LINE}`, borderRadius: 10, marginBottom: 16 }}>No intervals yet — tap a quick add block above to start.</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        {editingWorkout && <button onClick={reset} style={{ fontFamily: "'Manrope', sans-serif", flex: 1, padding: '12px 0', borderRadius: 10, border: `1px solid ${LINE}`, background: PANEL2, color: SUB, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>}
        <button onClick={save} disabled={!name.trim() || intervals.length === 0}
          style={{ fontFamily: "'Manrope', sans-serif", flex: 2, padding: '13px 0', borderRadius: 10, border: 'none', background: (!name.trim() || intervals.length === 0) ? MUTED : 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: (!name.trim() || intervals.length === 0) ? 'default' : 'pointer' }}>
          <Save size={17} /> {editingWorkout ? 'Save changes' : 'Save workout'}
        </button>
      </div>

      {ownerStats && (
        <button onClick={() => exportWorkout({ name, category, description, intervals }, 'draft')}
          disabled={!name.trim() || intervals.length === 0}
          style={{ fontFamily: "'Manrope', sans-serif", width: '100%', marginTop: 8, padding: '10px 0', borderRadius: 10, border: `1px dashed ${LINE}`, background: 'none', color: (!name.trim() || intervals.length === 0) ? MUTED : SUB, fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: (!name.trim() || intervals.length === 0) ? 'default' : 'pointer', boxSizing: 'border-box' }}>
          {exportCopiedId === 'draft' ? <Check size={14} /> : <Download size={14} />}
          {exportCopiedId === 'draft' ? 'Copied to clipboard' : 'Export for library (admin)'}
        </button>
      )}

      {exportFallback && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: SUB, marginBottom: 6 }}>
            Couldn't copy automatically — tap the box, select all, and copy manually.
          </div>
          <textarea readOnly value={exportFallback} onFocus={e => e.target.select()}
            style={{ fontFamily: 'monospace', width: '100%', height: 160, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, padding: 10, fontSize: 11.5, boxSizing: 'border-box', resize: 'vertical' }} />
          <button onClick={() => setExportFallback(null)}
            style={{ fontFamily: "'Manrope', sans-serif", marginTop: 6, padding: '6px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: SUB, fontSize: 12, cursor: 'pointer' }}>
            Done
          </button>
        </div>
      )}

      {customWorkouts.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>Your saved workouts</div>
          {customWorkouts.map(w => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14, color: TEXT, fontWeight: 600 }}>{w.name}</div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB }}>{fmtLong(totalDuration(w.intervals))} · {w.category}</div>
              </div>
              {ownerStats && (
                <IconBtn onClick={() => exportWorkout(w, w.id)}>
                  {exportCopiedId === w.id ? <Check size={15} /> : <Download size={15} />}
                </IconBtn>
              )}
              <IconBtn onClick={() => { setName(w.name); setCategory(w.category); setDescription(w.description); setIntervals(w.intervals.map(i => ({ ...i }))); setSelectedIds(new Set()); setLastTouchedIds(new Set()); }}><Edit3 size={15} /></IconBtn>
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
// Normalized Power — smooths out surges and coasting better than a plain
// average by rolling a 30-second average of the raw watts, raising each
// to the 4th power, averaging those, then taking the 4th root. Falls back
// to the plain average for short efforts where a 30s window doesn't fit.
function normalizedPower(samples) {
  if (!samples || samples.length === 0) return null;
  if (samples.length < 30) return avgOf(samples);
  const rolling = [];
  let windowSum = 0;
  for (let i = 0; i < samples.length; i++) {
    windowSum += samples[i];
    if (i >= 30) windowSum -= samples[i - 30];
    if (i >= 29) rolling.push(windowSum / 30);
  }
  const meanFourth = rolling.reduce((a, b) => a + Math.pow(b, 4), 0) / rolling.length;
  return Math.round(Math.pow(meanFourth, 0.25));
}
// Training Stress Score — the standard way to size up how hard and how
// long a ride was relative to threshold, using Normalized Power divided
// by FTP as the intensity factor.
function computeTss(np, ftpVal, durationSeconds) {
  if (!np || !ftpVal || !durationSeconds) return null;
  const intensityFactor = np / ftpVal;
  return Math.round(((durationSeconds * np * intensityFactor) / (ftpVal * 3600)) * 100);
}
// Rough calorie estimate — mechanical work in kilojoules (avg watts x
// seconds / 1000) is the standard stand-in cycling computers use for kcal
// burned, since it roughly cancels out once you factor in pedaling
// efficiency. Labeled as an estimate everywhere it's shown.
function estimateCalories(avgPower, durationSeconds) {
  if (!avgPower || !durationSeconds) return null;
  return Math.round((avgPower * durationSeconds) / 1000);
}

// ---------- exporting a finished ride as .tcx / .fit ----------
function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function downloadBytes(filename, data, mime) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportFilename(name, date, ext) {
  const slug = (name || 'turbo-ride').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
  const d = date instanceof Date ? date : new Date(date);
  const stamp = d.toISOString().slice(0, 10);
  return `${slug || 'turbo-ride'}-${stamp}.${ext}`;
}
// Builds a standard Garmin TCX file (widely accepted by Strava, Garmin
// Connect, TrainingPeaks and most others) from this session's per-second
// samples. Watts go in the standard TPX extension; heart rate and cadence
// use their normal TCX fields. Fields with no data at all across the ride
// are left out entirely rather than written as zeroes.
function buildTcx({ startedAt, series, name, calories }) {
  const start = startedAt || new Date();
  const hasPower = series.some(p => typeof p.power === 'number');
  const hasHr = series.some(p => typeof p.hr === 'number');
  const hasCadence = series.some(p => typeof p.cadence === 'number');
  const trackpoints = series.map((p, i) => {
    const t = new Date(start.getTime() + i * 1000).toISOString();
    let xml = `      <Trackpoint>\n        <Time>${t}</Time>\n`;
    if (hasHr && typeof p.hr === 'number') xml += `        <HeartRateBpm><Value>${Math.round(p.hr)}</Value></HeartRateBpm>\n`;
    if (hasCadence && typeof p.cadence === 'number') xml += `        <Cadence>${Math.round(p.cadence)}</Cadence>\n`;
    if (hasPower && typeof p.power === 'number') xml += `        <Extensions><TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Watts>${Math.round(p.power)}</Watts></TPX></Extensions>\n`;
    xml += `      </Trackpoint>`;
    return xml;
  }).join('\n');
  const isoStart = start.toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">\n  <Activities>\n    <Activity Sport="Biking">\n      <Id>${isoStart}</Id>\n      <Lap StartTime="${isoStart}">\n        <TotalTimeSeconds>${series.length}</TotalTimeSeconds>\n        <DistanceMeters>0</DistanceMeters>\n        <Calories>${calories || 0}</Calories>\n        <Intensity>Active</Intensity>\n        <TriggerMethod>Manual</TriggerMethod>\n        <Track>\n${trackpoints}\n        </Track>\n      </Lap>\n      <Notes>${xmlEscape(name || 'Trbo workout')}</Notes>\n      <Creator xsi:type="Device_t">\n        <Name>Trbo</Name>\n      </Creator>\n    </Activity>\n  </Activities>\n</TrainingCenterDatabase>\n`;
}

// Minimal but spec-correct FIT encoder — writes file_id, timer events, one
// record message per second, a lap, a session and an activity message.
// Verified by round-tripping through an independent FIT parser before
// shipping, so the byte layout, CRC and field numbers are all confirmed
// correct rather than just "looks right."
const FIT_EPOCH_S = Date.UTC(1989, 11, 31, 0, 0, 0) / 1000;
function fitTimestamp(date) { return Math.floor(date.getTime() / 1000) - FIT_EPOCH_S; }
const FIT_CRC_TABLE = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];
function fitCrc16(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    let tmp = FIT_CRC_TABLE[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[byte & 0xF];
    tmp = FIT_CRC_TABLE[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[(byte >> 4) & 0xF];
  }
  return crc;
}
class FitByteWriter {
  constructor() { this.chunks = []; }
  pushU8(v) { this.chunks.push(new Uint8Array([v & 0xFF])); }
  pushU16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); this.chunks.push(b); }
  pushU32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.chunks.push(b); }
  toUint8Array() {
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) { out.set(c, off); off += c.length; }
    return out;
  }
}
const FIT_BASE_TYPE = { enum: 0x00, uint8: 0x02, uint16: 0x84, uint32: 0x86 };
const FIT_SIZE = { enum: 1, uint8: 1, uint16: 2, uint32: 4 };
function fitDefMsg(w, localNum, globalNum, fields) {
  w.pushU8(0x40 | localNum);
  w.pushU8(0); w.pushU8(0); // reserved, architecture (0 = little endian)
  w.pushU16(globalNum);
  w.pushU8(fields.length);
  for (const f of fields) { w.pushU8(f.num); w.pushU8(FIT_SIZE[f.type]); w.pushU8(FIT_BASE_TYPE[f.type]); }
}
function buildFit({ startedAt, series, sport = 2 }) {
  const w = new FitByteWriter();
  const startTs = fitTimestamp(startedAt || new Date());

  fitDefMsg(w, 0, 0, [{ num: 0, type: 'enum' }, { num: 1, type: 'uint16' }, { num: 2, type: 'uint16' }, { num: 4, type: 'uint32' }]);
  w.pushU8(0); w.pushU8(4); w.pushU16(255); w.pushU16(0); w.pushU32(startTs);

  fitDefMsg(w, 1, 21, [{ num: 253, type: 'uint32' }, { num: 0, type: 'enum' }, { num: 1, type: 'enum' }]);
  w.pushU8(1); w.pushU32(startTs); w.pushU8(0); w.pushU8(0);

  fitDefMsg(w, 2, 20, [{ num: 253, type: 'uint32' }, { num: 3, type: 'uint8' }, { num: 4, type: 'uint8' }, { num: 7, type: 'uint16' }]);
  const INVALID_U8 = 0xFF, INVALID_U16 = 0xFFFF;
  series.forEach((p, i) => {
    w.pushU8(2);
    w.pushU32(startTs + i);
    w.pushU8(typeof p.hr === 'number' ? Math.round(p.hr) : INVALID_U8);
    w.pushU8(typeof p.cadence === 'number' ? Math.round(p.cadence) : INVALID_U8);
    w.pushU16(typeof p.power === 'number' ? Math.round(p.power) : INVALID_U16);
  });

  const endTs = startTs + Math.max(0, series.length - 1);
  const elapsedMs1000 = series.length * 1000;

  w.pushU8(1); w.pushU32(endTs); w.pushU8(0); w.pushU8(4); // timer stop_all

  fitDefMsg(w, 3, 19, [{ num: 253, type: 'uint32' }, { num: 2, type: 'uint32' }, { num: 7, type: 'uint32' }, { num: 8, type: 'uint32' }, { num: 9, type: 'uint32' }]);
  w.pushU8(3); w.pushU32(endTs); w.pushU32(startTs); w.pushU32(elapsedMs1000); w.pushU32(elapsedMs1000); w.pushU32(0);

  fitDefMsg(w, 4, 18, [{ num: 253, type: 'uint32' }, { num: 2, type: 'uint32' }, { num: 7, type: 'uint32' }, { num: 8, type: 'uint32' }, { num: 9, type: 'uint32' }, { num: 5, type: 'enum' }]);
  w.pushU8(4); w.pushU32(endTs); w.pushU32(startTs); w.pushU32(elapsedMs1000); w.pushU32(elapsedMs1000); w.pushU32(0); w.pushU8(sport);

  fitDefMsg(w, 5, 34, [{ num: 253, type: 'uint32' }, { num: 0, type: 'uint32' }, { num: 1, type: 'uint16' }, { num: 2, type: 'enum' }, { num: 3, type: 'enum' }, { num: 4, type: 'enum' }]);
  w.pushU8(5); w.pushU32(endTs); w.pushU32(elapsedMs1000); w.pushU16(1); w.pushU8(0); w.pushU8(26); w.pushU8(1);

  const dataBytes = w.toUint8Array();
  const header = new Uint8Array(12);
  const hv = new DataView(header.buffer);
  header[0] = 12; header[1] = 0x10;
  hv.setUint16(2, 100, true);
  hv.setUint32(4, dataBytes.length, true);
  header[8] = 0x2E; header[9] = 0x46; header[10] = 0x49; header[11] = 0x54; // ".FIT"

  const withoutCrc = new Uint8Array(header.length + dataBytes.length);
  withoutCrc.set(header, 0); withoutCrc.set(dataBytes, header.length);
  const crc = fitCrc16(withoutCrc);
  const full = new Uint8Array(withoutCrc.length + 2);
  full.set(withoutCrc, 0);
  new DataView(full.buffer).setUint16(withoutCrc.length, crc, true);
  return full;
}

// ---------- player ----------
// ---------- in-progress ride persistence ----------
// A rider's position in a workout (and which tab they're on) has to survive
// the app being backgrounded and reclaimed by iOS, or the page being fully
// reloaded — otherwise a phone call or a low-memory background kill wipes
// out a ride that's minutes from finishing. This is a small localStorage
// snapshot of just enough state to resume exactly where they left off:
// which workout (or queue) was active, which interval, and how much time
// was left on it. It intentionally does NOT try to preserve live sensor
// history across a relaunch — a fresh page load means a fresh Bluetooth
// connection anyway — it only protects the timer position itself.
const ACTIVE_SESSION_KEY = 'trbo_active_session_v1';
const ACTIVE_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h — beyond this, treat it as an abandoned ride rather than resuming into it unannounced
function saveActiveSession(snapshot) {
  try { localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({ ...snapshot, savedAt: Date.now() })); } catch (e) {}
}
function loadActiveSession() {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap || !snap.savedAt || Date.now() - snap.savedAt > ACTIVE_SESSION_MAX_AGE_MS) {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
      return null;
    }
    return snap;
  } catch (e) { return null; }
}
function clearActiveSession() {
  try { localStorage.removeItem(ACTIVE_SESSION_KEY); } catch (e) {}
}

function PlayerView({ workout, ftp, settings, trainer, heartRate, onExit, onSaveFtpResult, onApplyFtp, onSessionEnd, onEffortRating, isDemo, queueInfo, onQueueAdvance, workoutHistory, resume, sessionMeta }) {
  const intervals = workout.intervals;
  const isRampTest = !!workout.autoStopTest;
  const [currentIndex, setCurrentIndex] = useState(() => (resume && resume.index < intervals.length ? resume.index : 0));
  const [timeLeft, setTimeLeft] = useState(() => (resume && resume.index < intervals.length ? resume.timeLeft : intervals[0].duration));
  const [isPlaying, setIsPlaying] = useState(() => !resume); // fresh start begins playing immediately (Start workout was already the "I'm ready" tap) — a resumed/backgrounded session still comes back paused so the trainer doesn't surprise the rider with resistance
  const [isDone, setIsDone] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ftp, auto } once a ramp test ends
  const [ftpApplied, setFtpApplied] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // null | 'exit' | 'restart' — set while a confirm dialog is up
  const beepedRef = useRef(new Set());
  const wakeLockRef = useRef(null);
  const prevBleStatus = useRef(trainer.status);
  const trainerPowerRef = useRef(trainer.power);
  const heartRateRef = useRef(heartRate ? heartRate.bpm : null);
  const cadenceRef = useRef(trainer.cadence);
  const stepSamplesRef = useRef([]); // watt readings collected during the current ramp step
  const ftpTestSamplesRef = useRef([]); // watt readings collected during a workout's designated FTP-test block (e.g. the 20 minute test)
  const sessionPowerRef = useRef([]); // every watt reading for the whole session, for personal records
  const sessionHrRef = useRef([]); // in-memory only: bpm readings for this ride's on-screen summary + export. Never persisted.
  // One entry per second of the ride (power/hr/cadence, null where unknown)
  // — kept only for building a .tcx/.fit export right after finishing, not
  // persisted anywhere.
  const sessionSeriesRef = useRef([]);
  const sessionStartRef = useRef(resume ? null : new Date());
  const lastStepAvgRef = useRef(null); // average watts of the last fully-completed ramp step
  const underPowerStreakRef = useRef(0); // consecutive seconds under the fail threshold
  const triggerAutoStopRef = useRef(() => {});
  const loggedRef = useRef(false); // guards against logging the same session twice
  const sessionIdRef = useRef(null); // id of the history row this session wrote, for the post-ride survey
  const [effortGiven, setEffortGiven] = useState(0); // 0 = not answered yet
  const halfwayPlayedRef = useRef(false); // guards the halfway chime from repeating
  const offTargetStreakRef = useRef(0); // consecutive seconds off-target, for the nudge tone
  const confettiRef = useRef([]); // randomized confetti pieces, generated once per celebration
  const [celebrate, setCelebrate] = useState(false);
  // Full end-of-ride numbers shown on the finish screen and used for the
  // .tcx/.fit export buttons — set once, right when the ride ends.
  const [finishSummary, setFinishSummary] = useState(null);
  // Counts down once a queued workout finishes, then auto-advances into the
  // next one — the rider can also jump ahead or stop early instead of waiting.
  const [autoAdvanceIn, setAutoAdvanceIn] = useState(null);
  // Lets a rider scale back the remaining power targets if a ride is too
  // hard — session-only, always starts fresh at 100%. Hidden for the FTP
  // tests since dialing those down would just corrupt the result.
  const [intensityAdjust, setIntensityAdjust] = useState(() => (resume && typeof resume.intensityAdjust === 'number' ? resume.intensityAdjust : 1));
  const [showIntensityAdjust, setShowIntensityAdjust] = useState(false);
  const canAdjustIntensity = !workout.fixedLength;
  const { beep, chime, playCue } = useBeeper();
  const activeCues = SOUND_CUE_PACKS[settings.soundPack] || SOUND_CUE_PACKS.bright;

  // Elapsed time in seconds up to a given point in the workout — used both
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
    const dur = durationOverride != null ? durationOverride : computeElapsedSeconds();
    const avgPower = powerSamples.length ? avgOf(powerSamples) : null;
    const maxPower = powerSamples.length ? Math.max(...powerSamples) : null;
    const avgHr = hrSamples.length ? avgOf(hrSamples) : null;
    const maxHr = hrSamples.length ? Math.max(...hrSamples) : null;
    const np = powerSamples.length ? normalizedPower(powerSamples) : null;
    const tss = computeTss(np, ftp, dur);
    const calories = estimateCalories(avgPower, dur);
    // A personal best on average or peak power for this ride, measured
    // against every previously completed ride — celebrated with its own
    // cue rather than folding it into the generic finish sound. Only
    // fires when there's an actual prior best to have beaten.
    if (completed && settings.soundPersonalBest) {
      const priorPr = computePersonalRecords(workoutHistory);
      const beatAvg = priorPr && priorPr.bestAvgPower && avgPower != null && avgPower > priorPr.bestAvgPower.avgPower;
      const beatPeak = priorPr && priorPr.bestPeakPower && maxPower != null && maxPower > priorPr.bestPeakPower.maxPower;
      if (beatAvg || beatPeak) playCue(activeCues.personalBest, 0.3 * settings.soundVolume);
    }
    setFinishSummary({
      avgPower, maxPower, avgHr, maxHr, np, tss, calories, duration: dur,
      series: sessionSeriesRef.current.slice(),
      startedAt: sessionStartRef.current || new Date(),
      workoutName: workout.name,
    });
    // NOTE: avgHr/maxHr are deliberately NOT passed to onSessionEnd. Heart
    // rate is read live and shown on screen, and is written into the .tcx/.fit
    // file the rider downloads to their own device, but it is never persisted
    // to our database or sent to any third party. Keeping heart rate out of
    // stored records keeps it from becoming health data that we hold.
    if (onSessionEnd) {
      // The intensity offset the rider ended on (e.g. -10 for 90%) is itself
      // a difficulty signal for the planner: finishing a threshold day at
      // -10% says something without a survey answer. Only recorded for
      // adjustable workouts, and only when it was actually moved.
      const endAdjust = (!workout.fixedLength && intensityAdjust !== 1)
        ? Math.round((intensityAdjust - 1) * 100)
        : null;
      const sid = onSessionEnd({
        workoutId: workout.id || null,
        name: workout.name,
        category: workout.category || 'Custom',
        duration: dur,
        completed,
        avgPower, maxPower, tss, calories,
        intensityAdjust: endAdjust,
      });
      sessionIdRef.current = sid || null;
    }
  }

  useEffect(() => { trainerPowerRef.current = trainer.power; }, [trainer.power]);
  useEffect(() => { heartRateRef.current = heartRate ? heartRate.bpm : null; }, [heartRate && heartRate.bpm]);
  useEffect(() => { cadenceRef.current = trainer.cadence; }, [trainer.cadence]);

  // Keep a resumable snapshot of exactly where this ride is, so it survives
  // the app being backgrounded and killed by iOS (or a plain page reload).
  // Demo rides (no account) aren't worth persisting. Re-saves on every
  // interval/time-left change (so roughly once a second while riding), plus
  // right away whenever the app is backgrounded — belt and suspenders,
  // since a background kill can happen before the next tick lands.
  const sessionSnapshotRef = useRef(null);
  useEffect(() => {
    if (isDemo || isDone) return;
    sessionSnapshotRef.current = { ...sessionMeta, workout, currentIndex, timeLeft, intensityAdjust };
    saveActiveSession(sessionSnapshotRef.current);
  }, [isDemo, isDone, workout, currentIndex, timeLeft, intensityAdjust, sessionMeta]);
  useEffect(() => {
    if (isDemo) return;
    function persistNow() { if (sessionSnapshotRef.current) saveActiveSession(sessionSnapshotRef.current); }
    function onVisibility() { if (document.hidden) persistNow(); }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', persistNow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', persistNow);
    };
  }, [isDemo]);
  // Once the ride is actually finished, there's nothing left to resume.
  useEffect(() => { if (isDone) clearActiveSession(); }, [isDone]);

  // Once this workout finishes and there's a next one queued up, count down
  // to rolling into it automatically — cleared/cancelled by advancing or
  // exiting manually before it reaches zero.
  useEffect(() => {
    if (!isDone || !queueInfo || !queueInfo.hasNext) return;
    setAutoAdvanceIn(12);
    const t = setInterval(() => {
      setAutoAdvanceIn(s => {
        if (s == null) return s;
        if (s <= 1) { clearInterval(t); onQueueAdvance(); return null; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [isDone]);

  // Always keep this pointed at a fresh version of the auto-stop logic so
  // the ticking interval below can call it without needing to restart
  // itself every time state/props it depends on change.
  triggerAutoStopRef.current = () => {
    const estimateFrom = lastStepAvgRef.current;
    setIsPlaying(false);
    setIsDone(true);
    logSession(true, computeElapsedSeconds());
    if (estimateFrom == null) return; // failed before completing a single tracked step — not enough data to guess FTP
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
          playCue(activeCues.countdownTick, 0.35 * settings.soundVolume);
        }
        // Halfway-through-the-ride chime — fires once, whenever elapsed
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
      // Collect every second's readings for the whole ride. Power feeds the
      // stored session record; heart rate stays in memory and is used only for
      // the on-screen finish summary and the rider's own file export.
      if (typeof trainerPowerRef.current === 'number') sessionPowerRef.current.push(trainerPowerRef.current);
      if (typeof heartRateRef.current === 'number') sessionHrRef.current.push(heartRateRef.current);
      sessionSeriesRef.current.push({
        power: typeof trainerPowerRef.current === 'number' ? trainerPowerRef.current : null,
        hr: typeof heartRateRef.current === 'number' ? heartRateRef.current : null,
        cadence: typeof cadenceRef.current === 'number' ? cadenceRef.current : null,
      });
      // Off-target power nudge — a soft tick if power drifts well away
      // from the current interval's target for a sustained few seconds.
      // Opt-in and off by default since it can feel naggy.
      if (settings.soundOffTargetNudge && !isRampTest) {
        const curInterval = intervals[currentIndex];
        const power = trainerPowerRef.current;
        if (curInterval.type === 'power' && typeof power === 'number') {
          const targetWatts = Math.round((ftp * curInterval.target * intensityAdjust) / 100);
          const dev = targetWatts > 0 ? Math.abs(power - targetWatts) / targetWatts : 0;
          if (dev > 0.15) {
            offTargetStreakRef.current += 1;
            if (offTargetStreakRef.current >= 6) {
              playCue(activeCues.offTargetAlarm, 0.35 * settings.soundVolume);
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
      // Fixed-block FTP test (e.g. the 20 minute test): log the rider's
      // actual watts each second while they're inside the labeled test
      // interval, so an average — and an FTP estimate — can be worked out
      // the moment that block ends.
      if (workout.ftpTestLabel && intervals[currentIndex].label === workout.ftpTestLabel) {
        const power = trainerPowerRef.current;
        if (typeof power === 'number') ftpTestSamplesRef.current.push(power);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [isPlaying, isDone, currentIndex, settings.soundCountdown, settings.soundVolume, settings.soundHalfwayFinal, settings.soundOffTargetNudge, isRampTest, ftp, intensityAdjust]);

  useEffect(() => {
    if (timeLeft >= 0) return;
    if (currentIndex < intervals.length - 1) {
      if (settings.soundIntervalBeep) {
        const upcomingZone = zoneFor(intervals[currentIndex + 1], settings.colorblindMode);
        if (upcomingZone.name === 'Recovery') {
          // Recovery gets its own dedicated, softer descending cue —
          // always, regardless of the per-zone pitch setting below.
          playCue(activeCues.restStart, 0.25 * settings.soundVolume);
        } else {
          const cue = activeCues.intervalStart;
          const cueFreq = settings.soundZoneTones ? (ZONE_TONE_FREQ[upcomingZone.name] || cue.freq) : cue.freq;
          playCue({ ...cue, freq: cueFreq }, 0.3 * settings.soundVolume);
        }
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
      if (workout.ftpTestLabel && intervals[currentIndex].label === workout.ftpTestLabel) {
        const avg = avgOf(ftpTestSamplesRef.current);
        if (avg != null) {
          const mult = workout.ftpMultiplier || 0.95;
          const estimate = Math.round(avg * mult);
          setTestResult({ ftp: estimate, auto: false, resultLabel: `${workout.name} complete` });
          if (onSaveFtpResult) onSaveFtpResult(estimate, workout.name);
        }
      }
      const next = currentIndex + 1;
      setCurrentIndex(next);
      setTimeLeft(intervals[next].duration);
    } else {
      if (settings.soundCompletion) {
        if (settings.soundRichFanfare) {
          playCue(activeCues.workoutComplete, 0.3 * settings.soundVolume);
        } else {
          const cue = activeCues.workoutComplete;
          const lastNote = cue.pattern[cue.pattern.length - 1];
          beep(cue.freq * lastNote.ratio, (cue.dur / 1000) * lastNote.mult, 0.3 * settings.soundVolume, cue.wave);
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
      if (workout.ftpTestLabel && intervals[currentIndex].label === workout.ftpTestLabel) {
        const avg = avgOf(ftpTestSamplesRef.current);
        if (avg != null) {
          const mult = workout.ftpMultiplier || 0.95;
          const estimate = Math.round(avg * mult);
          setTestResult({ ftp: estimate, auto: false, resultLabel: `${workout.name} complete` });
          if (onSaveFtpResult) onSaveFtpResult(estimate, workout.name);
        }
      }
    }
  }, [timeLeft]);

  // Final-interval heads-up chime — fires whenever the ride enters its
  // last interval, whether by natural progression or a manual skip.
  useEffect(() => {
    if (settings.soundHalfwayFinal && intervals.length > 1 && currentIndex === intervals.length - 1) {
      chime([{ freq: 988, duration: 0.12, delay: 0 }, { freq: 1244, duration: 0.12, delay: 110 }, { freq: 1568, duration: 0.22, delay: 220 }], 0.16 * settings.soundVolume);
    }
  }, [currentIndex]);

  // ERG mode: push power target to trainer on interval change (or when the
  // rider dials the intensity up or down mid-ride). RPE-typed intervals are
  // converted to a %FTP target via rpeToPct so a "sprint" segment actually
  // raises the trainer's resistance instead of silently holding whatever
  // target the previous power-typed interval left in place.
  useEffect(() => {
    if (!settings.ergMode || trainer.status !== 'connected' || !trainer.hasControl) return;
    const current = intervals[currentIndex];
    const pct = current.type === 'power' ? current.target : current.type === 'rpe' ? rpeToPct(current.target) : null;
    if (pct != null) trainer.setErgTarget(Math.round((ftp * pct * intensityAdjust) / 100));
  }, [currentIndex, settings.ergMode, trainer.status, trainer.hasControl, ftp, intensityAdjust]);

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

  function togglePlay() {
    setIsPlaying(p => {
      const next = !p;
      if (next && !sessionStartRef.current) sessionStartRef.current = new Date();
      return next;
    });
  }
  function skip(dir) {
    const next = Math.min(intervals.length - 1, Math.max(0, currentIndex + dir));
    setCurrentIndex(next);
    setTimeLeft(intervals[next].duration);
    setIsDone(false);
    setTestResult(null);
    setFtpApplied(false);
    stepSamplesRef.current = [];
    ftpTestSamplesRef.current = [];
    underPowerStreakRef.current = 0;
    offTargetStreakRef.current = 0;
  }
  function restart() {
    setCurrentIndex(0); setTimeLeft(intervals[0].duration); setIsPlaying(false); setIsDone(false);
    beepedRef.current = new Set();
    setTestResult(null);
    setFtpApplied(false);
    stepSamplesRef.current = [];
    ftpTestSamplesRef.current = [];
    lastStepAvgRef.current = null;
    underPowerStreakRef.current = 0;
    offTargetStreakRef.current = 0;
    halfwayPlayedRef.current = false;
    setCelebrate(false);
    sessionPowerRef.current = [];
    sessionHrRef.current = [];
    sessionIdRef.current = null;
    setEffortGiven(0);
  }
  // Exit and restart both throw away an in-progress effort, so while the
  // workout is actively running we interrupt with a confirmation dialog
  // first. If it's paused (or already finished) there's nothing to lose by
  // stopping, so the action just happens right away.
  function requestAction(action) {
    if (isPlaying) {
      setIsPlaying(false); // pause while they decide — don't let the clock run out behind the dialog
      setPendingAction(action);
    } else {
      performAction(action);
    }
  }
  function performAction(action) {
    setPendingAction(null);
    if (action === 'exit') {
      if (!isDone) logSession(false);
      clearActiveSession();
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
  // What the rider is actually being asked for right now, after any
  // mid-ride intensity adjustment. Only power intervals scale — RPE and
  // free/rest segments aren't wattage-based, so they're left alone.
  const displayCurrent = (current.type === 'power' && intensityAdjust !== 1)
    ? { ...current, target: Math.round(current.target * intensityAdjust) }
    : current;
  const z = zoneFor(displayCurrent, settings.colorblindMode);
  const total = totalDuration(intervals);
  const elapsedBefore = totalDuration(intervals.slice(0, currentIndex));
  const elapsed = elapsedBefore + (current.duration - Math.max(0, timeLeft));
  const progress = Math.min(1, elapsed / total);
  const targetTxt = formatTarget(displayCurrent, ftp, settings.targetDisplay);
  const currentPowerTxt = trainer.power !== null ? `${trainer.power}W` : '– W';

  const ringProgress = isDone ? 1 : Math.min(1, (current.duration - Math.max(0, timeLeft)) / current.duration);
  const targetWattsForGauge = displayCurrent.type === 'power' ? Math.round((ftp * displayCurrent.target) / 100) : 0;

  // Orientation-aware layout: landscape (mounted on the bars) puts target/
  // ring/current side by side with controls to the right; portrait stacks
  // the ring alone, then each chip, then controls below. Driven by the same
  // JS orientation hook OrientationGate already uses elsewhere, not just a
  // CSS breakpoint, so the DOM order itself changes between the two.
  const isPortrait = useOrientation();
  const compact = settings.compactLabels;
  const textScale = settings.workoutTextScale || 1;
  const ringSize = Math.round((isDone
    ? (isPortrait ? (compact ? 130 : 170) : (compact ? 100 : 128))
    : (isPortrait ? (compact ? 115 : 150) : (compact ? 80 : 102))) * textScale);
  const timerFontSize = Math.round((isDone
    ? (isPortrait ? (compact ? 36 : 46) : (compact ? 27 : 34))
    : (isPortrait ? (compact ? 30 : 38) : (compact ? 22 : 28))) * textScale);
  const FONT_HEAD = "'Big Shoulders Display', sans-serif";
  const FONT_BODY = "'Manrope', sans-serif";
  const FONT_NUM = "'Space Grotesk', sans-serif";

  // Big-text mode on a phone: at 2x/4x the numbers are too large to sit around
  // the timer ring or the curved watts dial, so on portrait we strip both and
  // let the timer fill the screen — just timer, target watts, current watts
  // and the pause button. (Landscape/tablet keeps the full visuals: 2x was
  // designed for a tablet mounted further from the bars.)
  const bigText = textScale >= 2;
  const stripVisuals = bigText && isPortrait && !isDone;
  // In stripped mode show the target as clean watts, dropping the verbose
  // "RPE · %FTP · W" breakdown that would wrap across the whole screen.
  const simpleTargetTxt = displayCurrent.type === 'power' ? `${targetWattsForGauge}W` : targetTxt;

  function StatChip({ label, value, valueColor }) {
    return (
      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: isPortrait ? '8px 10px' : '8px 14px', minWidth: 80, width: isPortrait ? 'min(220px, 72vw)' : undefined, boxSizing: 'border-box' }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: Math.round(10.5 * textScale), color: SUB, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}>{label}</div>
        {/* "Both" target mode (e.g. "RPE 10/10 · ~130% FTP · 260W") can run
            longer than the box — wrap it instead of overflowing off the
            edge of the screen like it used to. */}
        <div style={{ fontFamily: FONT_NUM, fontSize: Math.round(18 * textScale), fontWeight: 600, color: valueColor || TEXT, marginTop: 2, wordBreak: 'break-word' }}>{value}</div>
      </div>
    );
  }

  const targetChip = canAdjustIntensity ? (
    <div style={{ position: 'relative', width: isPortrait ? 'min(220px, 72vw)' : undefined }}>
      {isDemo && !showIntensityAdjust && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 8,
          background: 'var(--accent)', color: INK, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, padding: '5px 10px',
          borderRadius: 8, whiteSpace: 'nowrap', animation: 'demo-tag-bounce 1.8s ease-in-out infinite', pointerEvents: 'none', zIndex: 2,
        }}>
          Tap to adjust intensity
          <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid var(--accent)' }} />
        </div>
      )}
      <button onClick={() => setShowIntensityAdjust(v => !v)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%', boxSizing: 'border-box' }}>
        <StatChip label={`Target${intensityAdjust !== 1 ? ` · ${Math.round(intensityAdjust * 100)}%` : ''}`} value={targetTxt} />
      </button>
    </div>
  ) : (
    <StatChip label="Target" value={targetTxt} />
  );
  const currentChip = <StatChip label="Current" value={currentPowerTxt} valueColor={trainer.status === 'connected' ? 'var(--accent)' : TEXT} />;
  // Large side-by-side stat used only in stripped big-text mode.
  function SimpleStat({ label, value, accent }) {
    return (
      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 8px', flex: 1, minWidth: 0, textAlign: 'center' }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: SUB, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontFamily: FONT_NUM, fontSize: 'min(15vw, 9vh)', fontWeight: 700, color: accent ? 'var(--accent)' : TEXT, marginTop: 4, lineHeight: 1, wordBreak: 'break-word' }}>{value}</div>
      </div>
    );
  }
  const ringTimerBlock = stripVisuals ? (
    <div className="player-timer" style={{ fontFamily: FONT_NUM, fontSize: 'min(40vw, 34vh)', fontWeight: 700, color: TEXT, lineHeight: 0.9, letterSpacing: -1, textAlign: 'center', margin: '0 auto' }}>
      {fmt(Math.max(0, timeLeft))}
    </div>
  ) : (
    <div className="ring-box" style={{ position: 'relative', width: ringSize, height: ringSize, display: 'flex', alignItems: 'center', justifyContent: 'center', isolation: 'isolate', flexShrink: 0, margin: isPortrait || isDone ? '0 auto' : undefined }}>
      {settings.visualProgressRing && <ProgressRing progress={isDone ? 1 : ringProgress} color={z.color} size={ringSize} />}
      <div className="player-timer" style={{ fontFamily: FONT_NUM, fontSize: timerFontSize, fontWeight: 600, color: TEXT, lineHeight: 1 }}>
        {isDone ? (testResult ? `${testResult.ftp}W` : fmtLong(total)) : fmt(Math.max(0, timeLeft))}
      </div>
    </div>
  );
  const gaugeSize = isPortrait ? { width: 150, height: 80, radius: 62, stroke: 10 } : { width: 120, height: 64, radius: 48, stroke: 9 };

  return (
    <div className="player-screen" style={{ padding: 'calc(14px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom)) 16px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', isolation: 'isolate' }}>
      {settings.visualZoneWash && (
        <div style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none', transition: 'background 1s ease', background: `radial-gradient(ellipse 80% 55% at 50% 15%, ${hexToRgba(z.color, isDone ? 0.08 : 0.22)} 0%, transparent 70%)` }} />
      )}
      {celebrate && <Confetti pieces={confettiRef.current} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexShrink: 0 }}>
        <button onClick={() => requestAction('exit')} style={{ background: 'none', border: 'none', color: SUB, fontFamily: FONT_BODY, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}><X size={18} /> Exit</button>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: FONT_HEAD, fontWeight: 900, textTransform: 'uppercase', fontSize: 16, letterSpacing: -0.3, color: TEXT, lineHeight: 1.1 }}>{workout.name}</div>
          {queueInfo && (
            <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: 'var(--accent)', fontWeight: 700, letterSpacing: 0.4, marginTop: 2 }}>
              <ListOrdered size={11} style={{ verticalAlign: -1, marginRight: 3 }} /> {queueInfo.position + 1} of {queueInfo.total} queued
            </div>
          )}
        </div>
      </div>

      <div className="player-main" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
        <div className="player-stats" style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: isDone ? SUB : z.color, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>
            {isDone ? (testResult ? (testResult.resultLabel || (testResult.auto ? 'Test ended — that’s your limit' : 'Ramp test complete')) : 'Workout complete') : (current.label || z.name)}
          </div>

          {!isDone ? (
            stripVisuals ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                {ringTimerBlock}
                <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                  <SimpleStat label="Target" value={simpleTargetTxt} />
                  <SimpleStat label="Current" value={currentPowerTxt} accent={trainer.status === 'connected'} />
                </div>
              </div>
            ) : isPortrait ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                {ringTimerBlock}
                {targetChip}
                {currentChip}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12 }}>
                <div style={{ justifySelf: 'end' }}>{targetChip}</div>
                {ringTimerBlock}
                <div style={{ justifySelf: 'start' }}>{currentChip}</div>
              </div>
            )
          ) : ringTimerBlock}

          {!isDone && canAdjustIntensity && showIntensityAdjust && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: SUB, marginBottom: 8 }}>
                Too hard? Scale back your remaining power targets for the rest of this ride.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <IconBtn onClick={() => setIntensityAdjust(v => Math.max(0.5, Math.round((v - 0.05) * 100) / 100))} disabled={intensityAdjust <= 0.5}>−</IconBtn>
                <div style={{ minWidth: 60 }}>
                  <div style={{ fontFamily: FONT_NUM, fontSize: 17, fontWeight: 600, color: TEXT }}>{Math.round(intensityAdjust * 100)}%</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: SUB }}>of plan</div>
                </div>
                <IconBtn onClick={() => setIntensityAdjust(v => Math.min(1, Math.round((v + 0.05) * 100) / 100))} disabled={intensityAdjust >= 1}>+</IconBtn>
                {intensityAdjust !== 1 && (
                  <button onClick={() => setIntensityAdjust(1)} style={{ background: 'none', border: 'none', color: SUB, fontFamily: FONT_BODY, fontSize: 12, textDecoration: 'underline', cursor: 'pointer', marginLeft: 4 }}>Reset</button>
                )}
              </div>
            </div>
          )}

          {!isDone && !stripVisuals && settings.visualPowerGauge && trainer.status === 'connected' && current.type === 'power' && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: isPortrait ? 18 : 6 }}>
              <PowerGauge power={trainer.power || 0} targetWatts={targetWattsForGauge} width={gaugeSize.width} height={gaugeSize.height} radius={gaugeSize.radius} stroke={gaugeSize.stroke} cvd={settings.colorblindMode} />
            </div>
          )}

          {!isDone && (trainer.status === 'connected' && trainer.cadence !== null || heartRate && heartRate.status === 'connected' && heartRate.bpm !== null) && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, fontFamily: FONT_BODY, fontSize: 12, color: SUB, marginTop: 8 }}>
              {trainer.status === 'connected' && trainer.cadence !== null && <span>{trainer.cadence} rpm</span>}
              {heartRate && heartRate.status === 'connected' && heartRate.bpm !== null && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><HeartPulse size={12} /> {heartRate.bpm} bpm</span>
              )}
            </div>
          )}

          {isDone && (
            <div style={{ fontFamily: FONT_BODY, fontSize: 16, color: SUB, marginTop: 6 }}>
              {testResult ? 'Estimated FTP — saved to your FTP history' : 'Nice work — here’s how it went.'}
            </div>
          )}

          {/* One-tap post-ride survey. Skippable (just leave it), never shown
              for FTP tests or demo rides, and it disappears into a quiet
              thank-you once answered. The answer updates the history row
              this session just wrote. */}
          {isDone && !testResult && !isDemo && onEffortRating && (
            <div style={{ marginTop: 14, maxWidth: 440, margin: '14px auto 0' }}>
              {effortGiven ? (
                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: SUB, textAlign: 'center' }}>
                  Noted — this helps your plan learn what suits you.
                </div>
              ) : (
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: SUB, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center', marginBottom: 10 }}>
                    How did that feel?
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {[
                      { v: 1, label: 'Easy' },
                      { v: 2, label: 'Moderate' },
                      { v: 3, label: 'Hard' },
                      { v: 4, label: 'Very hard' },
                      { v: 5, label: "Couldn’t finish" },
                    ].map(o => (
                      <button key={o.v}
                        onClick={() => { setEffortGiven(o.v); onEffortRating(sessionIdRef.current, o.v); }}
                        style={{ padding: '7px 12px', borderRadius: 999, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {isDone && testResult && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <button
                onClick={() => { if (onApplyFtp) onApplyFtp(testResult.ftp); setFtpApplied(true); }}
                disabled={ftpApplied}
                style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: ftpApplied ? PANEL2 : 'var(--accent)', color: ftpApplied ? SUB : INK, fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, cursor: ftpApplied ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                {ftpApplied ? <Check size={16} /> : <Zap size={16} />} {ftpApplied ? 'FTP updated' : `Update my FTP to ${testResult.ftp}W`}
              </button>
            </div>
          )}

          {isDone && finishSummary && (
            <div style={{ marginTop: 18, maxWidth: 440, margin: '18px auto 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', gap: 8 }}>
                {[
                  finishSummary.avgPower != null && { label: 'Avg power', value: `${finishSummary.avgPower}W` },
                  finishSummary.maxPower != null && { label: 'Max power', value: `${finishSummary.maxPower}W` },
                  finishSummary.avgHr != null && { label: 'Avg HR', value: `${finishSummary.avgHr} bpm` },
                  finishSummary.maxHr != null && { label: 'Max HR', value: `${finishSummary.maxHr} bpm` },
                  finishSummary.tss != null && { label: 'TSS (est.)', value: `${finishSummary.tss}` },
                  finishSummary.calories != null && { label: 'Calories (est.)', value: `${finishSummary.calories}` },
                ].filter(Boolean).map((c, i) => (
                  <div key={i} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 10px' }}>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 9.5, color: SUB, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{c.label}</div>
                    <div style={{ fontFamily: FONT_NUM, fontSize: 15, fontWeight: 600, color: TEXT, marginTop: 2 }}>{c.value}</div>
                  </div>
                ))}
              </div>
              {finishSummary.series.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => downloadBytes(
                      exportFilename(finishSummary.workoutName, finishSummary.startedAt, 'tcx'),
                      buildTcx({ startedAt: finishSummary.startedAt, series: finishSummary.series, name: finishSummary.workoutName, calories: finishSummary.calories }),
                      'application/vnd.garmin.tcx+xml'
                    )}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                    <Download size={13} /> Export .TCX
                  </button>
                  <button
                    onClick={() => downloadBytes(
                      exportFilename(finishSummary.workoutName, finishSummary.startedAt, 'fit'),
                      buildFit({ startedAt: finishSummary.startedAt, series: finishSummary.series }),
                      'application/octet-stream'
                    )}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                    <Download size={13} /> Export .FIT
                  </button>
                </div>
              )}
            </div>
          )}

          {isDone && queueInfo && queueInfo.hasNext && (
            <div style={{ marginTop: 18, maxWidth: 420, margin: '18px auto 0', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, textAlign: 'left' }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>
                Up next · {queueInfo.position + 2} of {queueInfo.total}
              </div>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 18, color: TEXT, marginBottom: 12 }}>{queueInfo.nextName}</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => { setAutoAdvanceIn(null); onQueueAdvance(); }}
                  style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  Continue{autoAdvanceIn != null ? ` (${autoAdvanceIn}s)` : ''}
                </button>
                <button onClick={() => requestAction('exit')}
                  style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  End queue here
                </button>
              </div>
            </div>
          )}

          {!isDone && next && settings.showNextPreview && (
            <div style={{ marginTop: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: SUB }}>
              Up next: <span style={{ color: TEXT }}>{next.label}</span> · {fmt(next.duration)}
            </div>
          )}
        </div>

        <div className="player-controls">
          <div className="player-controls-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, marginTop: 8 }}>
            <ControlSkipBtn onClick={() => skip(-1)} disabled={currentIndex === 0}><SkipBack size={18} /></ControlSkipBtn>
            <ControlPlayBtn onClick={isDone ? () => requestAction('restart') : togglePlay}>
              {isDone ? <RotateCcw size={28} /> : isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" style={{ marginLeft: 3 }} />}
            </ControlPlayBtn>
            <ControlSkipBtn onClick={() => skip(1)} disabled={currentIndex === intervals.length - 1}><SkipForward size={18} /></ControlSkipBtn>
          </div>

          {!isDone && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
              <button onClick={() => requestAction('restart')} style={{ background: 'none', border: 'none', color: SUB, fontFamily: FONT_BODY, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 10px' }}>
                <RotateCcw size={13} /> Restart
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ flexShrink: 0, marginTop: 14 }}>
        <LiveTimeline intervals={intervals} elapsed={elapsed} total={total} cvd={settings.colorblindMode} />
      </div>

      {pendingAction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={cancelPendingAction}>
          <div onClick={e => e.stopPropagation()} style={{ background: BG, borderRadius: 16, padding: 22, width: '100%', maxWidth: 340, textAlign: 'center' }}>
            <div style={{ fontFamily: FONT_HEAD, fontWeight: 900, textTransform: 'uppercase', fontSize: 24, letterSpacing: -0.5, color: TEXT, marginBottom: 8 }}>
              {pendingAction === 'exit' ? 'Exit workout?' : 'Restart workout?'}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: SUB, lineHeight: 1.6, marginBottom: 20 }}>
              Your ride is still running — are you sure you want to continue?
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={cancelPendingAction} style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Keep riding</button>
              <button onClick={() => performAction(pendingAction)} style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', background: RED, color: '#fff', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{pendingAction === 'exit' ? 'Exit' : 'Restart'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- settings view ----------
function SettingsView({ settings, updateSetting, ftp, setFtp, trainer, heartRate, customWorkouts, onResetCustom, ftpHistory, onClearFtpHistory, onClose, account, daysLeft, subscribed, compAccess, testerCompActive, testerCompDaysLeft, onLogout, onShowPaywall, ownerStats, stravaConnected, onConnectStrava, onDisconnectStrava, subscriptionPaused, subscriptionPaidThrough }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState('');
  const [pauseBusy, setPauseBusy] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [fbCategory, setFbCategory] = useState('bug');
  const [fbMessage, setFbMessage] = useState('');
  const [fbStatus, setFbStatus] = useState('idle'); // idle | sending | sent | error
  const [fbError, setFbError] = useState('');

  // Sends a private message straight to the help@trbo.bike inbox. Identity is
  // proved by the signed-in session (apiFetch attaches the auth token), so we
  // never send name/email up from here — the server reads the real account.
  async function sendFeedback() {
    const msg = fbMessage.trim();
    if (!msg || fbStatus === 'sending') return;
    setFbStatus('sending');
    setFbError('');
    try {
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, category: fbCategory }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send that. Please try again.');
      setFbMessage('');
      setFbStatus('sent');
    } catch (err) {
      setFbError(err.message || 'Something went wrong. Please try again.');
      setFbStatus('error');
    }
  }

  // Pausing stops the card being charged without cancelling. A full reload
  // afterwards is deliberate: subscription state is read once when the app
  // starts, and this is a rare enough action that a clean reload is more
  // trustworthy than threading the new state back up by hand.
  async function setPaused(nextPaused) {
    setPauseBusy(true);
    setPortalError('');
    try {
      const res = await apiFetch('/api/pause-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: nextPaused ? 'pause' : 'resume' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update your membership.');
      window.location.reload();
    } catch (err) {
      setPortalError(err.message || 'Something went wrong. Please try again.');
      setPauseBusy(false);
      setConfirmPause(false);
    }
  }

  // Sends the rider to Stripe's own subscription management page, where they
  // can change the card on file, download invoices, or cancel. The URL is
  // single-use and expires quickly, so it's fetched fresh on each tap rather
  // than stored anywhere.
  async function openBillingPortal() {
    setPortalBusy(true);
    setPortalError('');
    try {
      const res = await apiFetch('/api/customer-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not open subscription management.');
      window.location.href = data.url;
    } catch (err) {
      setPortalError(err.message || 'Something went wrong. Please try again.');
      setPortalBusy(false);
    }
  }

  const cvd = settings.colorblindMode;
  const connectedColor = cvd ? '#009E73' : '#8FC93A';
  const connectingColor = cvd ? '#E69F00' : '#FF9F40';
  const errorColor = cvd ? '#CC79A7' : RED;
  const statusColor = trainer.status === 'connected' ? connectedColor : trainer.status === 'connecting' ? connectingColor : trainer.status === 'error' ? errorColor : SUB;
  const statusLabel = trainer.status === 'connected' ? `Connected · ${trainer.deviceName}` : trainer.status === 'connecting' ? 'Connecting…' : trainer.status === 'error' ? 'Connection failed' : 'Not connected';
  const hrStatusColor = heartRate.status === 'connected' ? connectedColor : heartRate.status === 'connecting' ? connectingColor : heartRate.status === 'error' ? errorColor : SUB;
  const hrStatusLabel = heartRate.status === 'connected' ? `Connected · ${heartRate.deviceName}` : heartRate.status === 'connecting' ? 'Connecting…' : heartRate.status === 'error' ? 'Connection failed' : 'Not connected';

  // Status row + connect control. On the web the browser has its own device
  // chooser, so it's a single Connect button. In the native app (iOS) there's
  // no built-in chooser, so we scan and show a list of what's actually in
  // range for the rider to pick from — the step that was missing before.
  function BleConnectRow({ conn, statusColor, statusLabel }) {
    const native = conn.isNative;
    const busy = conn.status === 'connecting' || conn.scanning;
    const btnBase = { fontFamily: "'Manrope', sans-serif", padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: busy ? 'default' : 'pointer' };
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
          <div style={{ fontFamily: "'Manrope', sans-serif", flex: 1, fontSize: 14, color: TEXT }}>{conn.scanning ? 'Scanning…' : statusLabel}</div>
          {conn.status === 'connected' ? (
            <button onClick={conn.disconnect} style={{ ...btnBase, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT }}>Disconnect</button>
          ) : (
            <button onClick={() => (native ? conn.scan() : conn.connect())} disabled={busy}
              style={{ ...btnBase, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
              {native ? (conn.scanning ? 'Scanning…' : (conn.devices.length ? 'Rescan' : 'Scan')) : (conn.status === 'connecting' ? 'Connecting…' : 'Connect')}
            </button>
          )}
        </div>
        {native && conn.status !== 'connected' && conn.devices.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>{conn.scanning ? 'Looking…' : 'Tap to connect'}</div>
            {conn.devices.map(d => (
              <button key={d.deviceId} onClick={() => conn.connectTo(d.deviceId, d.name)} disabled={busy}
                style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 12px', cursor: busy ? 'default' : 'pointer' }}>
                <Bluetooth size={15} color="var(--accent)" style={{ flexShrink: 0 }} />
                <span style={{ fontFamily: "'Manrope', sans-serif", flex: 1, fontSize: 13.5, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>Connect</span>
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div style={{ padding: '16px 16px 80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 800, textTransform: 'uppercase', fontSize: 26, color: TEXT, letterSpacing: -0.3, marginBottom: 2 }}>Settings</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {account && (
            <button onClick={onLogout} style={{ fontFamily: "'Manrope', sans-serif", display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 12.5, cursor: 'pointer' }}>
              <LogOut size={14} /> Sign out
            </button>
          )}
          {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', color: SUB, cursor: 'pointer', padding: 4 }}><X size={22} /></button>}
        </div>
      </div>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13, color: SUB, marginBottom: 4 }}>Trainer, sounds and how the app looks.</div>

      <SectionHeader icon={<Bluetooth size={16} color="var(--accent)" />} title="Trainer connectivity" />
      <BleConnectRow conn={trainer} statusColor={statusColor} statusLabel={statusLabel} />
      {!trainer.supported && (
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB, marginBottom: 6, lineHeight: 1.5 }}>
          Bluetooth isn't available here. This works in Chrome on desktop or Android with a trainer that supports the FTMS standard — not in Safari or iOS.
        </div>
      )}
      {trainer.errorMsg && <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: RED, marginBottom: 6 }}>{trainer.errorMsg}</div>}
      <SettingRow label="ERG mode" sub="Trainer auto-sets resistance to match each interval's power target">
        <Switch checked={settings.ergMode} onChange={v => updateSetting('ergMode', v)} disabled={trainer.status !== 'connected' || !trainer.hasControl} />
      </SettingRow>
      <SettingRow label="Auto-pause on disconnect" sub="Pause the timer if the trainer connection drops mid-ride">
        <Switch checked={settings.autoPauseOnDisconnect} onChange={v => updateSetting('autoPauseOnDisconnect', v)} />
      </SettingRow>

      <SectionHeader icon={<HeartPulse size={16} color="var(--accent)" />} title="Heart rate monitor" />
      <BleConnectRow conn={heartRate} statusColor={hrStatusColor} statusLabel={hrStatusLabel} />
      {heartRate.status !== 'connected' && (
        <div style={{ display: 'flex', gap: 6, fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB, marginBottom: 6, lineHeight: 1.5 }}>
          <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>A chest strap or armband just needs to be worn — the sensor wakes on skin contact. A watch (Coros, Garmin, Apple Watch, etc.) won't show up until you turn on its <b style={{ color: TEXT }}>Broadcast Heart Rate</b> mode — that's the setting that makes the watch send its heart rate over Bluetooth for another app to pick up.</span>
        </div>
      )}
      {!heartRate.supported && (
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB, marginBottom: 6, lineHeight: 1.5 }}>
          Bluetooth isn't available here. Works with any standard BLE chest strap or armband — Polar, Wahoo, Garmin and most others.
        </div>
      )}
      {heartRate.errorMsg && <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: RED, marginBottom: 6 }}>{heartRate.errorMsg}</div>}
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: MUTED, marginBottom: 6, lineHeight: 1.5 }}>
        Your heart rate is shown live while you ride and is included in any workout file you export. It is never saved to your Trbo account and never sent to Strava.
      </div>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB, marginBottom: 6, lineHeight: 1.5 }}>
        Separate from your trainer — pair it here once and it'll show up alongside power during every ride.
      </div>

      {STRAVA_CLIENT_ID ? (
        <>
          <SectionHeader icon={<LinkIcon size={16} color="var(--accent)" />} title="Strava" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: stravaConnected ? connectedColor : SUB, flexShrink: 0 }} />
            <div style={{ fontFamily: "'Manrope', sans-serif", flex: 1, fontSize: 14, color: TEXT }}>{stravaConnected ? 'Connected' : 'Not connected'}</div>
            {stravaConnected ? (
              <button onClick={onDisconnectStrava} style={{ fontFamily: "'Manrope', sans-serif", padding: '7px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 13, cursor: 'pointer' }}>Disconnect</button>
            ) : (
              // Strava API brand guidelines (developers.strava.com/guidelines): official
              // "Connect with Strava" button, orange #FC5200, min 48px tall, exact button
              // text, links to strava.com/oauth/authorize (see connectStrava() below).
              <button
                onClick={onConnectStrava}
                aria-label="Connect with Strava"
                style={{
                  fontFamily: "'Manrope', sans-serif", display: 'flex', alignItems: 'center',
                  justifyContent: 'center', height: 48, padding: '0 20px', borderRadius: 6,
                  border: 'none', background: '#FC5200', color: '#FFFFFF', fontWeight: 700,
                  fontSize: 15, letterSpacing: 0.2, cursor: 'pointer', flexShrink: 0,
                }}
              >
                Connect with Strava
              </button>
            )}
          </div>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB, marginBottom: 4, lineHeight: 1.5 }}>
            Completed rides are pushed to your Strava account automatically once connected.
          </div>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, marginBottom: 6 }}>
            Powered by Strava
          </div>
        </>
      ) : null}

      <CollapsibleSection icon={<Volume2 size={16} color="var(--accent)" />} title="Sounds">
      <div style={{ padding: '10px 0', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14, color: TEXT, marginBottom: 8 }}>Sound pack</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip active={settings.soundPack === 'bright'} onClick={() => updateSetting('soundPack', 'bright')}>Bright</Chip>
          <Chip active={settings.soundPack === 'soft'} onClick={() => updateSetting('soundPack', 'soft')}>Soft</Chip>
        </div>
      </div>
      <SettingRow label="Interval transition beep"><Switch checked={settings.soundIntervalBeep} onChange={v => updateSetting('soundIntervalBeep', v)} /></SettingRow>
      <SettingRow label="3-2-1 countdown beep"><Switch checked={settings.soundCountdown} onChange={v => updateSetting('soundCountdown', v)} /></SettingRow>
      <SettingRow label="Completion sound"><Switch checked={settings.soundCompletion} onChange={v => updateSetting('soundCompletion', v)} /></SettingRow>
      <div style={{ padding: '10px 0', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", display: 'flex', justifyContent: 'space-between', fontSize: 14, color: TEXT, marginBottom: 6 }}>
          <span>Volume</span><span style={{ color: SUB }}>{Math.round(settings.soundVolume * 100)}%</span>
        </div>
        <input type="range" min={0} max={1} step={0.05} value={settings.soundVolume}
          onChange={e => updateSetting('soundVolume', Number(e.target.value))}
          style={{ width: '100%', accentColor: settings.accentColor }} />
      </div>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 14, marginBottom: 6 }}>Ride cues</div>
      <SettingRow label="Distinct tone per zone" sub="Interval-change beep pitch matches the upcoming effort — low for recovery, sharp for anaerobic">
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
      <SettingRow label="Personal best chime" sub="A distinct cue when a finished ride beats your average or peak power">
        <Switch checked={settings.soundPersonalBest} onChange={v => updateSetting('soundPersonalBest', v)} />
      </SettingRow>
      </CollapsibleSection>

      <CollapsibleSection icon={<Sun size={16} color="var(--accent)" />} title="Visuals">
      <div style={{ padding: '10px 0', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14, color: TEXT, marginBottom: 8 }}>Appearance</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip active={settings.theme === 'palette'} onClick={() => updateSetting('theme', 'palette')}>Default</Chip>
          <Chip active={settings.theme === 'dark'} onClick={() => updateSetting('theme', 'dark')}><Moon size={12} style={{ marginRight: 5, verticalAlign: -2 }} />Dark</Chip>
          <Chip active={settings.theme === 'light'} onClick={() => updateSetting('theme', 'light')}><Sun size={12} style={{ marginRight: 5, verticalAlign: -2 }} />Light</Chip>
        </div>
      </div>
      <SettingRow label="Colour-blind friendly palette" sub="Swaps zone colours, the live power gauge, and connection status dots for a set that stays distinguishable with red-green colour blindness">
        <Switch checked={settings.colorblindMode} onChange={v => updateSetting('colorblindMode', v)} />
      </SettingRow>
      <div style={{ padding: '10px 0', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14, color: TEXT, marginBottom: 8 }}>Interval targets show as</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip active={settings.targetDisplay === 'both'} onClick={() => updateSetting('targetDisplay', 'both')}>Watts + % FTP</Chip>
          <Chip active={settings.targetDisplay === 'watts'} onClick={() => updateSetting('targetDisplay', 'watts')}>Watts only</Chip>
          <Chip active={settings.targetDisplay === 'percent'} onClick={() => updateSetting('targetDisplay', 'percent')}>% FTP only</Chip>
        </div>
      </div>
      <div style={{ padding: '10px 0', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14, color: TEXT, marginBottom: 2 }}>Default orientation</div>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB, marginBottom: 8, lineHeight: 1.5 }}>
          Landscape is recommended — it's designed for a device mounted on your bars. Portrait works but some screens will feel cramped or stretched.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip active={settings.preferredOrientation === 'landscape'} onClick={() => updateSetting('preferredOrientation', 'landscape')}>Landscape (recommended)</Chip>
          <Chip active={settings.preferredOrientation === 'portrait'} onClick={() => updateSetting('preferredOrientation', 'portrait')}>Portrait</Chip>
        </div>
      </div>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 14, marginBottom: 6 }}>Ride cues</div>
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
      <div style={{ padding: '10px 0', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14, color: TEXT, marginBottom: 2 }}>Workout text size</div>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, color: SUB, marginBottom: 8, lineHeight: 1.5 }}>
          Scales the timer and target/current numbers you read mid-ride. 2x is sized for a tablet mounted further from the bars — on a phone, Large usually reads best.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip active={settings.workoutTextScale === 1} onClick={() => updateSetting('workoutTextScale', 1)}>Normal</Chip>
          <Chip active={settings.workoutTextScale === 1.25} onClick={() => updateSetting('workoutTextScale', 1.25)}>Large</Chip>
          <Chip active={settings.workoutTextScale === 1.5} onClick={() => updateSetting('workoutTextScale', 1.5)}>XL</Chip>
          <Chip active={settings.workoutTextScale === 2} onClick={() => updateSetting('workoutTextScale', 2)}>2x (tablet)</Chip>
          <Chip active={settings.workoutTextScale === 4} onClick={() => updateSetting('workoutTextScale', 4)}>4x (max)</Chip>
        </div>
        {settings.workoutTextScale >= 2 && (
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: 'var(--flame)', marginTop: 8, lineHeight: 1.5, display: 'flex', gap: 6 }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>At this size on a phone, the timer ring and the watts dial are hidden to make room — you'll see just the big timer, target, current watts and the pause button. Turn the text size back down to bring them back.</span>
          </div>
        )}
      </div>
      <SettingRow label="Keep screen awake" sub="Prevent the screen from sleeping while riding"><Switch checked={settings.keepAwake} onChange={v => updateSetting('keepAwake', v)} /></SettingRow>
      </CollapsibleSection>

      {account && (
        <>
          <SectionHeader icon={<Zap size={16} color="var(--accent)" />} title="Account & subscription" />
          <SettingRow label={account.name} sub={account.email}>
            <button onClick={onLogout} style={{ fontFamily: "'Manrope', sans-serif", padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 12.5, cursor: 'pointer' }}>Log out</button>
          </SettingRow>
          <SettingRow
            label={compAccess ? 'Friends & family — free access' : testerCompActive ? `Tester access — ${testerCompDaysLeft} day${testerCompDaysLeft === 1 ? '' : 's'} left` : subscribed ? 'Subscription — active' : `Free trial — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
            sub={compAccess ? 'Complimentary access, no card on file' : testerCompActive ? 'Thanks for testing — this expires automatically, no action needed' : subscribed ? 'Update your card, view invoices, or cancel any time' : 'No charge yet in this demo'}
          >
            {!subscribed && !compAccess && (
              <button onClick={onShowPaywall} style={{ fontFamily: "'Manrope', sans-serif", padding: '7px 12px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Upgrade now</button>
            )}
            {subscribed && !compAccess && (
              <button onClick={openBillingPortal} disabled={portalBusy} style={{ fontFamily: "'Manrope', sans-serif", padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 12.5, cursor: portalBusy ? 'default' : 'pointer', opacity: portalBusy ? 0.6 : 1 }}>
                {portalBusy ? 'Opening…' : 'Manage subscription'}
              </button>
            )}
          </SettingRow>
          {portalError && (
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12.5, color: RED, padding: '0 0 10px' }}>{portalError}</div>
          )}
          {subscribed && !compAccess && (
            <SettingRow
              label={subscriptionPaused ? 'Membership paused' : 'Taking a break?'}
              sub={subscriptionPaused
                ? (subscriptionPaidThrough
                    ? `You won't be charged again. You can keep riding until ${new Date(subscriptionPaidThrough).toLocaleDateString()} \u2014 resume before then and nothing changes. After that your membership ends, and you'd start a fresh one when you're ready.`
                    : "You won't be charged again. Resume any time before your paid period ends.")
                : 'Stop billing over the off-season. Your workouts, history, FTP and training plan all stay exactly as they are, and you keep riding until the time you\u2019ve already paid for runs out.'}
            >
              {subscriptionPaused ? (
                <button onClick={() => setPaused(false)} disabled={pauseBusy} style={{ fontFamily: "'Manrope', sans-serif", padding: '7px 12px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 12.5, cursor: pauseBusy ? 'default' : 'pointer', opacity: pauseBusy ? 0.6 : 1 }}>
                  {pauseBusy ? 'Resuming…' : 'Resume'}
                </button>
              ) : confirmPause ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setConfirmPause(false)} disabled={pauseBusy} style={{ fontFamily: "'Manrope', sans-serif", padding: '7px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: SUB, fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={() => setPaused(true)} disabled={pauseBusy} style={{ fontFamily: "'Manrope', sans-serif", padding: '7px 10px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 12.5, cursor: pauseBusy ? 'default' : 'pointer', opacity: pauseBusy ? 0.6 : 1 }}>
                    {pauseBusy ? 'Pausing…' : 'Confirm pause'}
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmPause(true)} style={{ fontFamily: "'Manrope', sans-serif", padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 12.5, cursor: 'pointer' }}>Pause membership</button>
              )}
            </SettingRow>
          )}
        </>
      )}

      {account && (
        <>
          <SectionHeader icon={<MessageSquare size={16} color="var(--accent)" />} title="Feedback & support" />
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12.5, color: SUB, lineHeight: 1.5, marginBottom: 12 }}>
            Found a bug, want a feature, or need a hand? Send it straight to us — it lands in our inbox and we&rsquo;ll reply to you by email.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {[['bug', 'Bug'], ['idea', 'Idea'], ['praise', 'Praise'], ['other', 'Other']].map(([key, label]) => (
              <Chip key={key} active={fbCategory === key} onClick={() => setFbCategory(key)}>{label}</Chip>
            ))}
          </div>
          <textarea
            value={fbMessage}
            onChange={e => { setFbMessage(e.target.value.slice(0, 4000)); if (fbStatus !== 'idle') setFbStatus('idle'); }}
            placeholder="What&rsquo;s on your mind?"
            rows={4}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical', background: PANEL2,
              border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', fontSize: 13.5,
              color: TEXT, fontFamily: "'Manrope', sans-serif",
            }}
          />
          {fbStatus === 'sent' && (
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12.5, color: 'var(--accent)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={14} /> Thanks — we&rsquo;ve got it and will get back to you at {account.email}.
            </div>
          )}
          {fbStatus === 'error' && fbError && (
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 12.5, color: RED, marginTop: 8 }}>{fbError}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button onClick={sendFeedback} disabled={!fbMessage.trim() || fbStatus === 'sending'} style={{
              fontFamily: "'Manrope', sans-serif", padding: '9px 18px', borderRadius: 10, border: 'none',
              background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 13,
              cursor: (!fbMessage.trim() || fbStatus === 'sending') ? 'default' : 'pointer',
              opacity: (!fbMessage.trim() || fbStatus === 'sending') ? 0.5 : 1,
            }}>
              {fbStatus === 'sending' ? 'Sending…' : 'Send feedback'}
            </button>
          </div>
        </>
      )}

      <SectionHeader icon={<Gauge size={16} color="var(--accent)" />} title="General" />
      <SettingRow label="FTP" sub="Used to calculate watt targets from % FTP">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FtpInput ftp={ftp} setFtp={setFtp}
            style={{ width: 70, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, padding: '6px 8px', fontSize: 14, fontFamily: "'Space Grotesk', sans-serif" }} />
          <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13, color: SUB }}>W</span>
        </div>
      </SettingRow>
      {ftpHistory && ftpHistory.length > 0 && (
        <div style={{ padding: '10px 0', borderBottom: `1px solid ${LINE}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14, color: TEXT }}>FTP test history</div>
            <button onClick={onClearFtpHistory} style={{ fontFamily: "'Manrope', sans-serif", background: 'none', border: 'none', color: SUB, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Trash2 size={12} /> Clear
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ftpHistory.slice().reverse().slice(0, 10).map(entry => (
              <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }}>
                <div>
                  <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13.5, color: TEXT, fontWeight: 600 }}>{entry.ftp}W</div>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: SUB }}>{entry.source}</div>
                </div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: SUB }}>{new Date(entry.date).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <SettingRow label="Custom workouts saved" sub={`${customWorkouts.length} workout${customWorkouts.length === 1 ? '' : 's'}`}>
        {!confirmReset ? (
          <button onClick={() => setConfirmReset(true)} disabled={customWorkouts.length === 0}
            style={{ fontFamily: "'Manrope', sans-serif", padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: customWorkouts.length === 0 ? MUTED : RED, fontSize: 12.5, cursor: customWorkouts.length === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} /> Clear all
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { onResetCustom(); setConfirmReset(false); }} style={{ fontFamily: "'Manrope', sans-serif", padding: '7px 10px', borderRadius: 8, border: 'none', background: RED, color: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Confirm</button>
            <button onClick={() => setConfirmReset(false)} style={{ fontFamily: "'Manrope', sans-serif", padding: '7px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
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
                <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 10, color: SUB, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700, color: TEXT }}>{c.value ?? '–'}</div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11.5, color: SUB, marginBottom: 6 }}>{ownerStats.total_rides_logged} rides logged in total, across everyone.</div>

          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 }}>Retention &amp; conversion</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            {[
              { label: 'Trial → paid conversion', value: ownerStats.trial_to_paid_conversion_pct != null ? `${ownerStats.trial_to_paid_conversion_pct}%` : null },
              { label: 'Riders active, last 7d', value: ownerStats.active_riders_last_7_days },
              { label: 'Riders active, last 30d', value: ownerStats.active_riders_last_30_days },
              { label: 'Subscribers idle 14d+', value: ownerStats.subscribers_inactive_14_days },
            ].map((c, i) => (
              <div key={i} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 10 }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 10, color: SUB, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700, color: TEXT }}>{c.value ?? '–'}</div>
              </div>
            ))}
          </div>

          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 }}>What people actually use</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              { label: 'Used the planner', value: ownerStats.planner_adoption_pct != null ? `${ownerStats.planner_adoption_pct}%` : null },
              { label: 'Ever queued a workout', value: ownerStats.queue_usage_pct != null ? `${ownerStats.queue_usage_pct}%` : null },
              { label: 'Ever starred a workout', value: ownerStats.starred_usage_pct != null ? `${ownerStats.starred_usage_pct}%` : null },
            ].map((c, i) => (
              <div key={i} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 10 }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 10, color: SUB, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700, color: TEXT }}>{c.value ?? '–'}</div>
              </div>
            ))}
          </div>

          {(ownerStats.top_categories_30d?.length > 0 || ownerStats.top_workouts_30d?.length > 0) && (
            <>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 11, color: SUB, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>Popular this month</div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                {ownerStats.top_categories_30d?.length > 0 && (
                  <div style={{ flex: '1 1 200px', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 10 }}>
                    <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 10, color: SUB, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>By category</div>
                    {ownerStats.top_categories_30d.map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'Manrope', sans-serif", fontSize: 13, color: TEXT, padding: '3px 0' }}>
                        <span>{c.category}</span><span style={{ color: SUB }}>{c.rides}</span>
                      </div>
                    ))}
                  </div>
                )}
                {ownerStats.top_workouts_30d?.length > 0 && (
                  <div style={{ flex: '1 1 200px', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 10 }}>
                    <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 10, color: SUB, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>By workout</div>
                    {ownerStats.top_workouts_30d.map((w, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: "'Manrope', sans-serif", fontSize: 13, color: TEXT, padding: '3px 0' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span><span style={{ color: SUB, flexShrink: 0 }}>{w.rides}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------- auth screens ----------
// Signed-out auth flow (login/signup/forgot/reset password) is rendered in
// the app's brand theme always, not whatever theme a not-yet-loaded profile
// might prefer — this keeps a visitor's first screen consistent with the
// public marketing pages (/pricing, /terms, /privacy), which use the same
// locked palette. See design_handoff_trbo bundle + PublicPages.jsx.
const AUTH = THEMES.palette;
const AUTH_FONT_HEAD = "'Big Shoulders Display', sans-serif";
const AUTH_FONT_BODY = "'Manrope', sans-serif";

// The auth screen's brand lockup (mark + wordmark) scales with available
// vertical room: full size on phone portrait and laptop, smaller on the
// short-height cases (phone landscape, tablet) — matches the login screen
// design spec's four reference sizes.
function computeAuthLockup() {
  if (typeof window === 'undefined') return { mark: 92, wordmark: 60 };
  const h = window.innerHeight;
  if (h < 500) return { mark: 60, wordmark: 40 }; // phone landscape
  if (h < 650) return { mark: 76, wordmark: 50 }; // tablet
  return { mark: 92, wordmark: 60 }; // phone portrait / laptop
}
function useAuthLockup() {
  const [size, setSize] = useState(computeAuthLockup);
  useEffect(() => {
    const update = () => setSize(computeAuthLockup());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

function AuthShell({ children, footer }) {
  const { mark, wordmark } = useAuthLockup();
  return (
    <div style={{ minHeight: '100dvh', background: AUTH.bg, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '40px 20px', fontFamily: AUTH_FONT_BODY }}>
      <div style={{ maxWidth: 340, width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 28 }}>
          <TrboMark size={mark} />
          <div style={{ fontFamily: AUTH_FONT_HEAD, fontWeight: 900, fontSize: wordmark, letterSpacing: -1.5, color: INK }}>TRBO</div>
        </div>
        {children}
        {footer && <div style={{ marginTop: 18, textAlign: 'center' }}>{footer}</div>}
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: `1px solid ${AUTH.line}`, display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap', fontSize: 11.5 }}>
          <a href="/pricing" style={{ color: AUTH.sub, textDecoration: 'none' }}>Pricing</a>
          <a href="/terms" style={{ color: AUTH.sub, textDecoration: 'none' }}>Terms</a>
          <a href="/privacy" style={{ color: AUTH.sub, textDecoration: 'none' }}>Privacy</a>
          <a href="mailto:Trbo.help@outlook.com" style={{ color: AUTH.sub, textDecoration: 'none' }}>Support</a>
        </div>
      </div>
    </div>
  );
}
function AuthField({ label, ...props }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontFamily: AUTH_FONT_BODY, fontSize: 12.5, color: AUTH.sub, marginBottom: 5 }}>{label}</label>
      <input {...props} style={{ width: '100%', background: AUTH.panel2, border: `1px solid ${AUTH.line}`, borderRadius: 8, color: AUTH.text, fontFamily: AUTH_FONT_BODY, padding: '11px 12px', fontSize: 14.5, boxSizing: 'border-box' }} />
    </div>
  );
}
function AuthError({ children }) {
  if (!children) return null;
  return <div style={{ background: hexToRgba(AUTH.red, 0.1), border: `1px solid ${AUTH.red}`, color: AUTH.red, borderRadius: 8, padding: '9px 12px', fontFamily: AUTH_FONT_BODY, fontSize: 13, marginBottom: 12 }}>{children}</div>;
}
function AuthNote({ children }) {
  return <div style={{ background: AUTH.panel, border: `1px solid ${AUTH.line}`, borderRadius: 8, padding: '9px 12px', fontFamily: AUTH_FONT_BODY, fontSize: 12, color: AUTH.sub, marginBottom: 12, lineHeight: 1.5 }}>{children}</div>;
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
      <button onClick={() => handleProvider('google', 'Google')} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${AUTH.line}`, background: AUTH.panel2, color: AUTH.text, fontFamily: AUTH_FONT_BODY, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Continue with Google</button>
      <button onClick={() => handleProvider('apple', 'Apple')} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${AUTH.line}`, background: AUTH.panel2, color: AUTH.text, fontFamily: AUTH_FONT_BODY, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Continue with Apple</button>
    </div>
  );
}
// Shared look for the big Big Shoulders Display headline used atop every
// auth screen ("Log in", "Start your free trial", etc).
function AuthTitle({ children, tight }) {
  return <div style={{ fontFamily: AUTH_FONT_HEAD, fontWeight: 700, fontSize: 32, color: AUTH.text, marginBottom: tight ? 4 : 22, textAlign: 'center' }}>{children}</div>;
}
function AuthPrimaryButton({ children, submitting, ...props }) {
  return (
    <button {...props} disabled={submitting} style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: AUTH.accent, color: INK, fontFamily: AUTH_FONT_BODY, fontWeight: 700, fontSize: 15, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>{children}</button>
  );
}
function AuthLink({ children, ...props }) {
  return <button {...props} style={{ background: 'none', border: 'none', color: AUTH.accent, fontFamily: AUTH_FONT_BODY, fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 13 }}>{children}</button>;
}

function LoginView({ onLogin, goSignup, goForgot, initialMsg }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [socialMsg, setSocialMsg] = useState(initialMsg || '');
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
      <div style={{ fontFamily: AUTH_FONT_BODY, fontSize: 13, color: AUTH.sub }}>
        New here? <AuthLink onClick={goSignup}>Start your free trial</AuthLink>
      </div>
    }>
      <AuthTitle>Log in</AuthTitle>
      <AuthError>{error}</AuthError>
      {socialMsg && <AuthNote>{socialMsg}</AuthNote>}
      <SocialAuthButtons onError={setSocialMsg} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 16px', color: AUTH.sub, fontFamily: AUTH_FONT_BODY, fontSize: 11.5 }}>
        <div style={{ flex: 1, height: 1, background: AUTH.line }} /> OR <div style={{ flex: 1, height: 1, background: AUTH.line }} />
      </div>
      <form onSubmit={submit}>
        <AuthField label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        <AuthField label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        <div style={{ textAlign: 'right', marginBottom: 16 }}>
          <button type="button" onClick={goForgot} style={{ background: 'none', border: 'none', color: AUTH.sub, fontFamily: AUTH_FONT_BODY, fontSize: 12.5, cursor: 'pointer', padding: 0 }}>Forgot password?</button>
        </div>
        <AuthPrimaryButton type="submit" submitting={submitting}>{submitting ? 'Logging in…' : 'Log in'}</AuthPrimaryButton>
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
    if (password !== confirm) { setError('Passwords don’t match.'); return; }
    setSubmitting(true);
    const result = await onSignup(name.trim(), email.trim().toLowerCase(), password);
    setSubmitting(false);
    if (result && result.error) { setError(result.error); return; }
    if (result && result.needsConfirmation) { setConfirmSent(true); return; }
  }

  if (confirmSent) {
    return (
      <AuthShell footer={<AuthLink onClick={goLogin}>Back to log in</AuthLink>}>
        <AuthTitle tight>Check your email</AuthTitle>
        <AuthNote>We've sent a confirmation link to {email}. Click it, then come back here and log in to start your {TRIAL_DAYS}-day free trial.</AuthNote>
      </AuthShell>
    );
  }

  if (SIGNUPS_PAUSED) {
    return (
      <AuthShell footer={<AuthLink onClick={goLogin}>Back to log in</AuthLink>}>
        <AuthTitle tight>New signups aren't open yet</AuthTitle>
        <AuthNote>Trbo is between launches right now, so we're not creating new accounts at the moment. See <a href="/pricing" style={{ color: AUTH.accent }}>trbo.help/pricing</a> for what's coming, or email <a href="mailto:Trbo.help@outlook.com" style={{ color: AUTH.accent }}>Trbo.help@outlook.com</a> and we'll let you know when it's back.</AuthNote>
      </AuthShell>
    );
  }

  return (
    <AuthShell footer={
      <div style={{ fontFamily: AUTH_FONT_BODY, fontSize: 13, color: AUTH.sub }}>
        Already have an account? <AuthLink onClick={goLogin}>Log in</AuthLink>
      </div>
    }>
      <AuthTitle tight>Start your free trial</AuthTitle>
      <div style={{ fontFamily: AUTH_FONT_BODY, fontSize: 12.5, color: AUTH.sub, textAlign: 'center', marginBottom: 16 }}>{TRIAL_DAYS} days free, then {MONTHLY_PRICE_LABEL}. Cancel anytime.</div>
      <AuthError>{error}</AuthError>
      {socialMsg && <AuthNote>{socialMsg}</AuthNote>}
      <SocialAuthButtons onError={setSocialMsg} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 16px', color: AUTH.sub, fontFamily: AUTH_FONT_BODY, fontSize: 11.5 }}>
        <div style={{ flex: 1, height: 1, background: AUTH.line }} /> OR <div style={{ flex: 1, height: 1, background: AUTH.line }} />
      </div>
      <form onSubmit={submit}>
        <AuthField label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
        <AuthField label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        <AuthField label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
        <AuthField label="Confirm password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Re-enter password" autoComplete="new-password" />
        <div style={{ marginTop: 4 }}>
          <AuthPrimaryButton type="submit" submitting={submitting}>{submitting ? 'Creating account…' : 'Start free trial'}</AuthPrimaryButton>
        </div>
        <div style={{ fontFamily: AUTH_FONT_BODY, fontSize: 11, color: AUTH.sub, textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>No payment required today. We'll ask for card details only when your trial ends.</div>
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
    <AuthShell footer={<AuthLink onClick={goLogin}>Back to log in</AuthLink>}>
      <AuthTitle>Reset your password</AuthTitle>
      {sent ? (
        <AuthNote>If an account exists for that email, we've just sent a real password reset link to it. Click the link in that email to set a new password.</AuthNote>
      ) : (
        <>
          <div style={{ fontFamily: AUTH_FONT_BODY, fontSize: 12.5, color: AUTH.sub, textAlign: 'center', marginBottom: 16 }}>Enter your email and we'll send you a link to reset your password.</div>
          <AuthError>{error}</AuthError>
          <form onSubmit={submit}>
            <AuthField label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            <AuthPrimaryButton type="submit" submitting={submitting}>{submitting ? 'Sending…' : 'Send reset link'}</AuthPrimaryButton>
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
    if (password !== confirm) { setError('Passwords don’t match.'); return; }
    setSubmitting(true);
    const result = await onUpdate(password);
    setSubmitting(false);
    if (result && result.error) setError(result.error);
  }

  return (
    <AuthShell>
      <AuthTitle tight>Set a new password</AuthTitle>
      <div style={{ fontFamily: AUTH_FONT_BODY, fontSize: 12.5, color: AUTH.sub, textAlign: 'center', marginBottom: 16 }}>You followed a password reset link. Choose a new password below.</div>
      <AuthError>{error}</AuthError>
      <form onSubmit={submit}>
        <AuthField label="New password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
        <AuthField label="Confirm new password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Re-enter password" autoComplete="new-password" />
        <AuthPrimaryButton type="submit" submitting={submitting}>{submitting ? 'Saving…' : 'Save new password'}</AuthPrimaryButton>
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

function PaywallView({ blocking, trialExpired, onClose, onLogout, userId, email, subscriptionPaused, subscriptionPaidThrough }) {
  const [error, setError] = useState('');
  const [redirecting, setRedirecting] = useState(false);
  const [plan, setPlan] = useState('monthly');
  const [resuming, setResuming] = useState(false);

  // Safety net. By design a paused membership still has access, so a paused
  // rider should never land on this screen -- they'd resume from Settings.
  // But if a webhook were ever missed, our records could say "paused" while
  // access had already lapsed, and the rider would be stranded here with no
  // way back to their subscription. This gives them one. If the server finds
  // the subscription is genuinely over it clears the flag and tells us to
  // fall back to normal checkout.
  async function resumeMembership() {
    setError('');
    setResuming(true);
    try {
      const res = await apiFetch('/api/pause-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume' }),
      });
      const data = await res.json();
      if (res.ok && data.resumed) { window.location.reload(); return; }
      if (data.requiresCheckout) {
        setError(data.error || 'That membership has ended \u2014 you can start a new one below.');
        setResuming(false);
        return;
      }
      throw new Error(data.error || 'Could not resume your membership.');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setResuming(false);
    }
  }

  async function startCheckout() {
    setError('');
    setRedirecting(true);
    try {
      const res = await apiFetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
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
        {trialExpired ? 'Subscribe to keep access to your workouts and the trainer connection.' : 'Lock in your subscription now so there’s no interruption when your trial ends.'}
      </div>

      {subscriptionPaused && (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: '14px 14px 12px', marginBottom: 18, background: PANEL2 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Your membership is paused</div>
          <div style={{ fontSize: 12.5, color: SUB, marginBottom: 10 }}>
            {subscriptionPaidThrough
              ? `It was set to end on ${new Date(subscriptionPaidThrough).toLocaleDateString()}. Resume to pick it straight back up \u2014 same plan, same price.`
              : 'Resume to pick it straight back up \u2014 same plan, same price.'}
          </div>
          <button onClick={resumeMembership} disabled={resuming} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 13.5, cursor: resuming ? 'default' : 'pointer', opacity: resuming ? 0.6 : 1 }}>
            {resuming ? 'Resuming\u2026' : 'Resume membership'}
          </button>
        </div>
      )}

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
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>Trbo — {plan === 'annual' ? 'Annual' : 'Monthly'}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{priceLabel}</div>
        </div>
        <div style={{ fontSize: 12, color: SUB, lineHeight: 1.6 }}>
          Full workout library · Custom workout builder · Trainer &amp; sensor connectivity · FTP testing &amp; history
        </div>
      </div>

      <AuthNote>You'll be taken to Stripe's secure checkout page to enter your card details. Your card number never touches this app or its database. Have a promo code? There's a field for it on that page.</AuthNote>
      <AuthError>{error}</AuthError>

      <button onClick={startCheckout} disabled={redirecting} style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, cursor: redirecting ? 'default' : 'pointer', marginTop: 6, opacity: redirecting ? 0.7 : 1 }}>
        {redirecting ? 'Redirecting to checkout…' : `Subscribe — ${priceLabel}`}
      </button>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 16 }}>
        {!blocking && <button onClick={onClose} style={{ background: 'none', border: 'none', color: SUB, fontSize: 12.5, cursor: 'pointer' }}>Not now</button>}
        <button onClick={onLogout} style={{ background: 'none', border: 'none', color: SUB, fontSize: 12.5, cursor: 'pointer' }}>Log out</button>
      </div>
    </div>
  );

  if (!blocking) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', boxSizing: 'border-box' }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} style={{ background: BG, width: '100%', maxWidth: 520, borderRadius: 18, border: `1px solid ${LINE}`, padding: '10px 20px 24px', maxHeight: 'min(90vh, calc(100dvh - 48px))', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {body}
        </div>
      </div>
    );
  }
  return <div style={{ minHeight: '100%', background: BG, padding: '20px 20px 40px', fontFamily: 'Inter, sans-serif' }}>{body}</div>;
}

// ---------- loading screen (random rider gif, picked once per mount) ----------
const LOADING_GIFS = [
  '/images/loading/loading-1.gif',
  '/images/loading/loading-2.gif',
  '/images/loading/loading-3.gif',
  '/images/loading/loading-4.gif',
  '/images/loading/loading-5.gif',
];
function LoadingView() {
  const [gif] = useState(() => LOADING_GIFS[Math.floor(Math.random() * LOADING_GIFS.length)]);
  return (
    <div style={{ height: '100dvh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={gif} alt="" width={128} height={128} style={{ imageRendering: 'pixelated' }} />
    </div>
  );
}

function DeviceLimitView({ onLogout }) {
  return (
    <div style={{ minHeight: '100%', background: BG, padding: '20px 20px 40px', fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center' }}>
      <div style={{ maxWidth: 380, width: '100%', margin: '0 auto', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 14 }}>
          <Smartphone size={20} color="var(--accent)" />
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 19, color: TEXT }}>Signed out on this device</div>
        </div>
        <div style={{ fontSize: 13, color: SUB, lineHeight: 1.6, marginBottom: 20 }}>
          This account can be signed in on up to {MAX_ACTIVE_DEVICES} device{MAX_ACTIVE_DEVICES === 1 ? '' : 's'} at once, and another device has taken this one's place. Log back in here to make this your active device again.
        </div>
        <button onClick={onLogout} style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
          Back to login
        </button>
      </div>
    </div>
  );
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

const ROTATE_HINT_SEEN_KEY = 'trbo_rotate_hint_seen_v1';
function OrientationGate({ preferredOrientation, children }) {
  const isPortrait = useOrientation();
  // Dismissal is remembered for good — once the rider says "continue in
  // portrait anyway", the rotate prompt never comes back, on this device.
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(ROTATE_HINT_SEEN_KEY) === '1'; } catch (e) { return false; }
  });
  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(ROTATE_HINT_SEEN_KEY, '1'); } catch (e) {}
  }

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
          <div style={{ fontSize: 42, marginBottom: 14, transform: 'rotate(90deg)' }}>📱</div>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 19, color: TEXT, marginBottom: 8 }}>Rotate your device</div>
          <div style={{ fontSize: 13.5, color: SUB, maxWidth: 320, lineHeight: 1.6, marginBottom: 22 }}>
            This app is designed for landscape — it's easier to read your timer and chart when your device is mounted on the bars. Turn your device sideways for the best experience.
          </div>
          <button onClick={dismiss} style={{ padding: '11px 20px', borderRadius: 10, border: `1px solid ${LINE}`, background: PANEL2, color: TEXT, fontSize: 13.5, cursor: 'pointer' }}>
            Continue in portrait anyway
          </button>
          <div style={{ fontSize: 11.5, color: SUB, marginTop: 10, maxWidth: 280 }}>We won't ask again. Some screens may look cramped or stretched in portrait. You can change your default under Settings → Visuals.</div>
        </div>
      )}
    </>
  );
}

// ---------- desktop install hint (shown once, ever) ----------
// Chrome/Edge (and other Chromium browsers) fire `beforeinstallprompt` when
// the current page qualifies for installation as an app. That event only
// exists in browsers that actually put an install icon in the address bar,
// so gating the hint on it — rather than guessing from screen width or
// user agent — means it only ever shows to people who can actually act on
// it. It never fires at all inside the native iOS/Android shell, or in a
// browser tab that's already running as an installed PWA.
const INSTALL_HINT_SEEN_KEY = 'trbo_install_hint_seen_v1';
function useInstallHint() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(INSTALL_HINT_SEEN_KEY) === '1'; } catch (e) { return false; }
  });

  useEffect(() => {
    if (isNative || dismissed) return;
    function handler(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [dismissed]);

  function dismiss() {
    setDismissed(true);
    setDeferredPrompt(null);
    try { localStorage.setItem(INSTALL_HINT_SEEN_KEY, '1'); } catch (e) {}
  }

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) {}
    dismiss();
  }

  return { show: !!deferredPrompt && !dismissed, dismiss, install };
}

function InstallHintToast({ onDismiss, onInstall }) {
  return (
    <div style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 40, width: 300, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: '14px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Download size={16} color="var(--accent)" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Install Trbo as a desktop app</div>
          <div style={{ fontSize: 12, color: SUB, lineHeight: 1.5 }}>
            Look for the install icon in your browser's address bar — or just click Install below.
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 10, alignItems: 'center' }}>
            <button onClick={onInstall} style={{ background: 'var(--accent)', border: 'none', color: INK, fontWeight: 700, fontSize: 12, borderRadius: 999, padding: '6px 14px', cursor: 'pointer' }}>Install</button>
            <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: SUB, fontSize: 12, cursor: 'pointer' }}>Not now</button>
          </div>
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: SUB, cursor: 'pointer', padding: 0, flexShrink: 0 }}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------- primary navigation (responsive) ----------
// Portrait phone keeps the classic bottom tab bar. Landscape phone, tablet,
// and laptop get a persistent left sidebar instead — fixes the old bottom
// bar floating mis-centered (capped at 520px) on wide viewports. See
// design_handoff_trbo/navigation/README.md for the full spec this implements.
const NAV_ITEMS = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'library', label: 'Library', Icon: Library },
  { key: 'basics', label: 'Basics', Icon: Dumbbell },
  { key: 'rides', label: 'Rides', Icon: Bike },
  { key: 'planner', label: 'Planner', Icon: CalendarDays },
  { key: 'builder', label: 'Builder', Icon: Wrench },
  { key: 'queue', label: 'Queue', Icon: ListOrdered },
  { key: 'feedback', label: 'Feedback', Icon: MessageSquare },
  { key: 'settings', label: 'Settings', Icon: SettingsIcon },
];
// Sidebar-only inactive text color. Follows the same theme-driven SUB/muted
// token as every other secondary label in the app, so it swaps correctly
// between light and dark mode instead of staying fixed to one value.
const SIDEBAR_INACTIVE = SUB;

function computeNavLayout() {
  if (typeof window === 'undefined') return { mode: 'sidebar', width: 200 };
  const w = window.innerWidth;
  const isLandscape = window.matchMedia ? window.matchMedia('(orientation: landscape)').matches : w > window.innerHeight;
  if (w < 700 && !isLandscape) return { mode: 'bottombar', width: 0 };
  const width = w >= 1180 ? 200 : w >= 860 ? 168 : 140;
  return { mode: 'sidebar', width };
}
function useNavLayout() {
  const [layout, setLayout] = useState(computeNavLayout);
  useEffect(() => {
    const update = () => setLayout(computeNavLayout());
    window.addEventListener('resize', update);
    let mq;
    if (window.matchMedia) {
      mq = window.matchMedia('(orientation: landscape)');
      if (mq.addEventListener) mq.addEventListener('change', update); else mq.addListener(update);
    }
    return () => {
      window.removeEventListener('resize', update);
      if (mq) { if (mq.removeEventListener) mq.removeEventListener('change', update); else mq.removeListener(update); }
    };
  }, []);
  return layout;
}

// Gives each nav tab ('home', 'rides', 'basics', 'queue', etc.) its own
// independent scroll position instead of one shared position bleeding
// across all of them. Pass a ref to the scrollable content container in
// sidebar mode (where content scrolls inside its own div), or null in
// bottom-tab-bar mode (where the page/window itself scrolls).
function useScrollMemory(view, containerRef) {
  const positions = useRef({}); // { [view]: last scroll offset }

  // Restore this tab's saved position (0 if never visited/scrolled) the
  // moment we switch to it, before the browser paints.
  useLayoutEffect(() => {
    const el = containerRef && containerRef.current;
    const saved = positions.current[view] || 0;
    if (el) el.scrollTop = saved; else window.scrollTo(0, saved);
  }, [view]);

  // Keep a live record of the current tab's scroll position as the person
  // scrolls, so switching away and back returns them to the same spot.
  useEffect(() => {
    const el = containerRef && containerRef.current;
    const target = el || window;
    function onScroll() {
      positions.current[view] = el ? el.scrollTop : window.scrollY;
    }
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => target.removeEventListener('scroll', onScroll);
  }, [view, containerRef && containerRef.current]);
}

function NavRow({ active, onClick, Icon, label }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 8, border: 'none',
      background: active ? 'var(--accent)' : 'transparent', color: active ? INK : SIDEBAR_INACTIVE,
      fontWeight: active ? 700 : 500, fontSize: 12.5, fontFamily: "'Manrope', sans-serif",
      cursor: 'pointer', textAlign: 'left', width: '100%',
    }}>
      {Icon && <Icon size={14} style={{ flexShrink: 0 }} />} <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

// Persistent left sidebar for landscape phone / tablet / laptop. Carries
// primary nav plus the workout category filters underneath, in the same
// chrome already used for category filtering elsewhere in the app.
function SidebarNav({ view, onNavigate, width, category, onSelectCategory }) {
  const showCategories = view === 'library' || view === 'basics' || view === 'rides';
  return (
    <div className="sidebar-nav" style={{
      width, flexShrink: 0, background: PANEL, borderRight: `1px solid ${LINE}`,
      display: 'flex', flexDirection: 'column', paddingLeft: 'env(safe-area-inset-left)',
      // Bounded to the viewport height with its own overflow, rather than
      // relying on position:sticky within the page's scroll -- that made
      // this share a single scroll region with the main content, which is
      // why scrolling the workout list used to drag the sidebar along with
      // it (and why iOS rubber-banding at the bottom of a list visibly
      // "jumped" the sidebar too). overscrollBehavior stops that bounce
      // from chaining into the content area next to it.
      height: '100dvh', overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '20px 14px 18px' }}>
        <TrboMark size={30} />
        <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 21, color: TEXT, letterSpacing: -0.3 }}>TRBO</span>
      </div>
      <div style={{ padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <NavRow key={key} active={view === key} onClick={() => onNavigate(key)} Icon={Icon} label={label} />
        ))}
      </div>
      {showCategories && (
        <div style={{ margin: '16px 10px 0', paddingTop: 10, borderTop: `1px solid ${LINE}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: SUB, letterSpacing: 0.6, textTransform: 'uppercase', padding: '0 10px 4px' }}>Categories</div>
          {CATEGORIES.filter(c => c !== 'Rides' && c !== 'Basics').concat('Custom').map(c => {
            const isActive = view === 'library' && category === c;
            return <NavRow key={c} active={isActive} onClick={() => onSelectCategory(isActive ? 'All' : c)} label={c} />;
          })}
        </div>
      )}
    </div>
  );
}

// Bottom tab bar — portrait phone only.
//
// This used to render all nine NAV_ITEMS side by side. On a 390px-wide phone
// that left each tab under 45px, with 10px labels truncating and icons
// crowding each other -- the bar read as a stacked mess rather than
// navigation. It now carries the four everyday destinations and moves the
// rest into a "More" sheet.
//
// NAV_ITEMS itself is deliberately untouched, so the sidebar (landscape
// phone, tablet, laptop -- where there is plenty of vertical room) still
// lists all nine exactly as before. This is a phone-only change.
const BOTTOM_TAB_KEYS = ['home', 'basics', 'rides', 'planner'];

// Everything not on the bar, in the order it appears in the sheet. Note this
// includes FTP and History, which have never had a bottom-bar entry at all --
// on a phone they were previously reachable only via the home screen, so the
// sheet actually widens what's reachable rather than burying things.
const MORE_ITEMS = [
  { key: 'library', label: 'Library', Icon: Library },
  { key: 'queue', label: 'Queue', Icon: ListOrdered },
  { key: 'builder', label: 'Builder', Icon: Wrench },
  { key: 'ftp', label: 'FTP', Icon: Gauge },
  { key: 'history', label: 'History', Icon: BarChart3 },
  { key: 'feedback', label: 'Feedback', Icon: MessageSquare },
  { key: 'settings', label: 'Settings', Icon: SettingsIcon },
];

// Matches the paddingBottom the app wrapper already reserves for the bar, so
// the sheet sits directly on top of it rather than underneath or overlapping.
const TABBAR_HEIGHT = 'calc(54px + env(safe-area-inset-bottom))';

function BottomTabBar({ view, onNavigate }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = BOTTOM_TAB_KEYS.map(k => NAV_ITEMS.find(n => n.key === k)).filter(Boolean);
  // The More tab reads as selected whenever the screen you're on lives inside
  // the sheet, so the bar never looks like nothing at all is active.
  const moreActive = MORE_ITEMS.some(m => m.key === view);

  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e) { if (e.key === 'Escape') setMoreOpen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  function go(key) { setMoreOpen(false); onNavigate(key); }

  const tabBtn = { flex: 1, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', minWidth: 0 };

  return (
    <>
      {moreOpen && (
        <div
          onClick={() => setMoreOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', boxSizing: 'border-box', marginBottom: TABBAR_HEIGHT,
              background: NAVBG, borderTop: `1px solid ${LINE}`,
              borderTopLeftRadius: 18, borderTopRightRadius: 18,
              padding: '10px 12px 14px',
              // overflowX pinned per the tablet scroll quirk that affects every
              // other overlay in the app.
              overflowX: 'hidden', overflowY: 'auto', maxHeight: '60dvh',
            }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 3, background: LINE, margin: '2px auto 12px' }} />
            {MORE_ITEMS.map(({ key, label, Icon }) => {
              const active = view === key;
              return (
                <button
                  key={key}
                  onClick={() => go(key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                    padding: '13px 12px', borderRadius: 10, border: 'none',
                    background: active ? 'var(--accent)' : 'transparent', color: active ? INK : TEXT,
                    fontFamily: "'Manrope', sans-serif", fontSize: 15, fontWeight: active ? 700 : 500, cursor: 'pointer',
                  }}
                >
                  <Icon size={18} style={{ flexShrink: 0 }} /> {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Sits above the sheet's backdrop so More stays tappable to dismiss. */}
      <div className="tabbar" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: NAVBG, borderTop: `1px solid ${LINE}`, display: 'flex', zIndex: 61 }}>
        {tabs.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => go(key)} className="tabbar-btn" style={{ ...tabBtn, color: view === key ? 'var(--accent)' : SUB }}>
            <Icon size={18} /><span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
          </button>
        ))}
        <button
          onClick={() => setMoreOpen(v => !v)}
          className="tabbar-btn"
          aria-expanded={moreOpen}
          style={{ ...tabBtn, color: moreOpen || moreActive ? 'var(--accent)' : SUB }}
        >
          <MoreHorizontal size={18} /><span style={{ fontSize: 10, fontWeight: 600 }}>More</span>
        </button>
      </div>
    </>
  );
}

// ---------- app ----------
export default function App() {
  // A saved in-progress ride (see saveActiveSession/PlayerView) is read once,
  // synchronously, before the very first render — so a relaunch after the
  // app was backgrounded and killed lands the rider straight back in their
  // workout instead of on the home tab with the ride gone. Stashed in a ref
  // (rather than re-read on every render) and consumed once by whichever
  // PlayerView mounts first; a later queue advance mounts a fresh PlayerView
  // with no resume payload, same as normal.
  const initialSessionRef = useRef(loadActiveSession());
  const initialSession = initialSessionRef.current;

  // Likewise, which tab (and library category) a rider was looking at is
  // kept in localStorage so reopening the app doesn't dump them back on
  // Home. Read synchronously on mount; written back out on every change.
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('trbo_last_view') || 'home'; } catch (e) { return 'home'; }
  });
  const [ftp, setFtpState] = useState(200);
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [customWorkouts, setCustomWorkouts] = useState([]);
  const [starredIds, setStarredIds] = useState(new Set());
  const [queue, setQueue] = useState([]); // ordered array of workout ids lined up to ride back-to-back
  const [savedQueues, setSavedQueues] = useState([]); // named, reloadable queue presets ("Monday plan", etc.)
  const [lastRemovedQueueItem, setLastRemovedQueueItem] = useState(null); // { id, index } of the most recently removed queue workout, for Undo
  const undoTimerRef = useRef(null);
  useEffect(() => () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }, []);
  const [activeQueue, setActiveQueue] = useState(() => (initialSession && initialSession.kind === 'queue' ? initialSession.queueWorkouts : null)); // array of resolved workout objects while a queue is actively playing, or null
  const [activeQueueIndex, setActiveQueueIndex] = useState(() => (initialSession && initialSession.kind === 'queue' ? initialSession.queueIndex : 0));
  const [ftpHistory, setFtpHistory] = useState([]);
  const [workoutHistory, setWorkoutHistory] = useState([]);
  const [trainingPlan, setTrainingPlan] = useState(null); // active periodized plan (or null)
  const [archivedPlans, setArchivedPlans] = useState([]); // finished/retired plans, newest first
  const [detailWorkout, setDetailWorkout] = useState(null);
  const [detailPresetMinutes, setDetailPresetMinutes] = useState(null); // set when opening from the planner
  const [editingWorkout, setEditingWorkout] = useState(null);
  const [activeWorkout, setActiveWorkout] = useState(() => (initialSession && initialSession.kind === 'single' ? initialSession.workout : null));
  const [activeGame, setActiveGame] = useState(null); // a mini game currently being played (or null)
  // Always starts on "All" — this used to be restored from localStorage
  // across app relaunches, but that meant Library could silently reopen
  // filtered to whatever category was last selected (sometimes with zero
  // matches), looking blank with no obvious explanation. Filter state is
  // still remembered while the app stays open (switching tabs and back),
  // just not carried across a full relaunch.
  const [libCategory, setLibCategory] = useState('All'); // shared with the sidebar's category filters on wide viewports

  // Persist tab + library category as they change; consume the one-time
  // resume payload shortly after mount so a later, unrelated PlayerView
  // mount (e.g. advancing to the next workout in a queue) never reapplies
  // an old saved position to the wrong workout.
  useEffect(() => { try { localStorage.setItem('trbo_last_view', view); } catch (e) {} }, [view]);
  useEffect(() => { initialSessionRef.current = null; }, []);
  const navLayout = useNavLayout(); // 'bottombar' (portrait phone) or 'sidebar' (landscape phone/tablet/laptop)
  // Each nav tab remembers its own scroll position independently, instead of
  // sharing one scroll position across Basics/Rides/Queue/etc. A tab starts
  // at the top the first time it's opened; if you scroll down yourself and
  // switch away, coming back restores exactly where you left off (e.g.
  // comparing a ride between the Rides and Basics tabs).
  const contentScrollRef = useRef(null);
  useScrollMemory(view, navLayout.mode === 'sidebar' ? contentScrollRef : null);
  // Public, signed-out preview — reached via a link ending in ?demo=ride
  // (the entry-point button on the login screen is added separately).
  // Takes priority over everything else, including an active session,
  // since it's meant to work for visitors with no account at all.
  const [demoMode, setDemoMode] = useState(() => (
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === 'ride'
  ));
  const trainer = useTrainer();
  const heartRate = useHeartRate();
  const installHint = useInstallHint();

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
  const [deviceRevoked, setDeviceRevoked] = useState(false); // this device got signed out for exceeding MAX_ACTIVE_DEVICES
  const [oauthBlockedMsg, setOauthBlockedMsg] = useState(''); // set if a Google/Apple sign-in came back rejected instead of a session

  // If someone hits "Continue with Google/Apple" for a brand-new account
  // while signups are paused, the database rejects it (see supabase-setup.sql
  // section 18) and Supabase sends them back here with an error in the URL
  // instead of a session, rather than the app ever seeing a signup happen.
  // Catch that and show a plain explanation instead of leaving the login
  // screen looking like nothing happened.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const search = new URLSearchParams(window.location.search);
    const errorDesc = hash.get('error_description') || search.get('error_description') || hash.get('error') || search.get('error');
    if (!errorDesc) return;
    window.history.replaceState({}, '', window.location.pathname);
    const isPausedError = /paused|database error saving new user|unexpected_failure/i.test(errorDesc);
    setOauthBlockedMsg(isPausedError
      ? "New signups aren't open yet. Already have an account? Log in the same way you originally signed up."
      : "That sign-in didn't complete. Please try again.");
  }, []);

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
      // Supabase re-verifies the session every time the tab regains focus,
      // firing this callback again (TOKEN_REFRESHED, or sometimes SIGNED_IN
      // a second time) even though nobody actually logged in or out. Only
      // replace `user` when the logged-in identity has genuinely changed —
      // returning the same object back from a state updater is a no-op re
      // -render, so the profile-load effect keyed on [user] below won't
      // retrigger and tear the whole app down to a loading screen mid-ride.
      setUser(prev => {
        const nextUser = session ? session.user : null;
        if ((prev?.id || null) === (nextUser?.id || null)) return prev;
        return nextUser;
      });
      setAuthLoading(false);
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  // ---- device cap: stop one paid account being shared across a pile of
  // devices at once. Each browser/app install keeps a random id in
  // localStorage and "checks in" with the database; if more than
  // MAX_ACTIVE_DEVICES are active for this account, the oldest ones get
  // marked revoked, and a device notices that the next time it checks in
  // (either right away, or on the next periodic check below) and gets
  // signed out with an explanation. Registration is best-effort: if it
  // fails (offline, or the database function isn't set up yet) nobody
  // gets locked out — it just quietly does nothing.
  useEffect(() => {
    if (!user) { setDeviceRevoked(false); return; }
    let mounted = true;
    let deviceId = localStorage.getItem('trbo_device_id');
    if (!deviceId) {
      deviceId = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('trbo_device_id', deviceId);
    }
    const deviceLabel = (navigator.userAgent || 'device').slice(0, 80);
    async function checkIn(isFirstCall) {
      try {
        const { data, error } = isFirstCall
          ? await supabase.rpc('register_device', { p_device_id: deviceId, p_device_label: deviceLabel, p_max_devices: MAX_ACTIVE_DEVICES })
          : await supabase.rpc('check_device', { p_device_id: deviceId });
        if (!error && data === true && mounted) setDeviceRevoked(true);
      } catch { /* offline, or the function isn't deployed yet — fail open */ }
    }
    checkIn(true);
    const interval = setInterval(() => checkIn(false), 4 * 60 * 1000);
    return () => { mounted = false; clearInterval(interval); };
  }, [user]);

  // Once we know who's logged in, load their profile + saved data from the database.
  const [ownerStats, setOwnerStats] = useState(null); // non-null only when logged in as the app owner
  useEffect(() => {
    if (!user) { setProfile(null); setCustomWorkouts([]); setStarredIds(new Set()); setQueue([]); setSavedQueues([]); setFtpHistory([]); setWorkoutHistory([]); setTrainingPlan(null); setArchivedPlans([]); setOwnerStats(null); return; }
    let mounted = true;
    (async () => {
      setProfileLoading(true);
      let { data: prof } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle();
      if (!prof) {
        // Fallback in case the sign-up trigger hasn't caught up yet.
        const { data: created } = await supabase.from('profiles')
          .insert({ id: user.id, name: user.user_metadata?.name || '', trial_start: new Date().toISOString() })
          .select(PROFILE_COLUMNS).maybeSingle();
        prof = created;
      }
      if (!mounted) return;
      if (prof) {
        setProfile(prof);
        setFtpState(prof.ftp || 200);
        setSettingsState({ ...DEFAULT_SETTINGS, ...(prof.settings || {}) });
        setTrainingPlan(prof.training_plan || null);
      }
      const { data: workouts } = await supabase.from('custom_workouts').select('*').eq('user_id', user.id).order('created_at', { ascending: true });
      if (mounted && workouts) setCustomWorkouts(workouts.map(w => w.workout));
      // Wrapped so that if starred_workouts hasn't been created yet (older
      // database not re-run against the latest supabase-setup.sql), the app
      // still loads fine — starring just quietly does nothing until it has.
      const { data: starred, error: starredErr } = await supabase.from('starred_workouts').select('workout_id').eq('user_id', user.id);
      if (mounted && !starredErr && starred) setStarredIds(new Set(starred.map(s => s.workout_id)));
      // Wrapped the same way — degrades to an empty (but working) queue if
      // queued_workouts hasn't been created yet.
      const { data: queued, error: queuedErr } = await supabase.from('queued_workouts').select('workout_id').eq('user_id', user.id).order('position', { ascending: true });
      if (mounted && !queuedErr && queued) setQueue(queued.map(q => q.workout_id));
      // Saved queue presets. Wrapped the same way -- degrades to an empty
      // (but working) list if saved_queues hasn't been created yet.
      const { data: saved, error: savedErr } = await supabase.from('saved_queues').select('*').eq('user_id', user.id).order('created_at', { ascending: true });
      if (mounted && !savedErr && saved) setSavedQueues(saved.map(s => ({ id: s.id, name: s.name, workoutIds: s.workout_ids || [] })));
      const { data: history } = await supabase.from('ftp_history').select('*').eq('user_id', user.id).order('date', { ascending: true });
      if (mounted && history) setFtpHistory(history.map(h => ({ id: h.id, date: h.date, ftp: h.ftp, source: h.source })));
      const { data: sessions } = await supabase.from('workout_history').select('*').eq('user_id', user.id).order('date', { ascending: true });
      if (mounted && sessions) setWorkoutHistory(sessions.map(s => ({ id: s.id, date: s.date, workoutId: s.workout_id, name: s.name, category: s.category, duration: s.duration, completed: s.completed, avgPower: s.avg_power, maxPower: s.max_power, tss: s.tss, calories: s.calories, outdoor: !!s.outdoor, rpe: s.rpe ?? null, intensityAdjust: s.intensity_adjust ?? null, effortRating: s.effort_rating ?? null })));
      // Archived (finished/retired) training plans. Wrapped so that if the
      // archived_plans table hasn't been created yet, the app still loads
      // fine and simply shows no history.
      const { data: archived, error: archErr } = await supabase.from('archived_plans').select('*').eq('user_id', user.id).order('archived_at', { ascending: false });
      if (mounted && !archErr && archived) setArchivedPlans(archived.map(a => ({ id: a.id, plan: a.plan, goalLabel: a.goal_label, totalWeeks: a.total_weeks, status: a.status, archivedAt: a.archived_at })));
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
  // The active training plan is a single JSON blob on the profile row (like
  // settings). Passing null clears it.
  function saveTrainingPlan(plan) {
    setTrainingPlan(plan);
    if (user) supabase.from('profiles').update({ training_plan: plan }).eq('id', user.id).then(() => {});
  }
  // Archive the active plan: copy it onto the archive shelf, then clear the
  // active slot. `status` is 'completed' (finished naturally) or 'retired'
  // (swapped out early to start something new). Updates local state
  // immediately so the UI responds, and persists in the background.
  async function archivePlan(plan, status = 'completed') {
    if (!plan) return;
    const row = {
      id: `plan_${Date.now()}`,
      plan,
      goalLabel: plan.goalLabel,
      totalWeeks: plan.totalWeeks,
      status,
      archivedAt: new Date().toISOString(),
    };
    setArchivedPlans(prev => [row, ...prev]);
    setTrainingPlan(null);
    if (user) {
      await supabase.from('archived_plans').insert({
        id: row.id, user_id: user.id, plan, goal_label: plan.goalLabel,
        total_weeks: plan.totalWeeks, status, archived_at: row.archivedAt,
      });
      await supabase.from('profiles').update({ training_plan: null }).eq('id', user.id);
    }
  }
  // Permanently remove one plan from the archive.
  function deleteArchivedPlan(id) {
    setArchivedPlans(prev => prev.filter(a => a.id !== id));
    if (user) supabase.from('archived_plans').delete().eq('id', id).eq('user_id', user.id).then(() => {});
  }
  // Opening a workout from the planner: look up the full library workout by id
  // and open the normal detail sheet, pre-scaled to the plan's target length.
  function openPlanWorkout(workout, plannedSeconds) {
    setDetailPresetMinutes(plannedSeconds ? Math.round(plannedSeconds / 60) : null);
    setDetailWorkout(workout);
  }

  async function handleSignup(name, email, password) {
    if (SIGNUPS_PAUSED) return { error: 'New signups aren’t open yet. Check back soon, or contact Trbo.help@outlook.com.' };
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
      const { data: prof } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle();
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

  // Finishes connecting Strava once we have the ?code= Strava handed back
  // after approval — shared by both the web redirect path below and the
  // native deep-link listener, since the exchange itself (POST to our own
  // /api/strava-connect, then refresh the profile) is identical either way.
  async function finishStravaConnect(code) {
    try {
      const res = await apiFetch('/api/strava-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        const { data: prof } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle();
        if (prof) setProfile(prof);
      }
    } catch (e) {}
  }

  // Strava sends people back here with ?code=... after they approve the
  // connection. The sessionStorage flag (set right before we redirect them
  // to Strava) is how we tell that apart from any other use of ?code= on
  // this page, e.g. a Google/Apple login in progress. Web only — native
  // uses the deep-link listener just below instead.
  useEffect(() => {
    if (!user || !STRAVA_CLIENT_ID || isNative) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code || sessionStorage.getItem('stravaOAuthPending') !== '1') return;
    sessionStorage.removeItem('stravaOAuthPending');
    // The state value was generated fresh right before we sent this person
    // to Strava (see connectStrava). If what came back doesn't match, this
    // ?code= wasn't the answer to our request — ignore it rather than
    // attach whatever account it belongs to.
    const expectedState = sessionStorage.getItem('stravaOAuthState');
    sessionStorage.removeItem('stravaOAuthState');
    const returnedState = params.get('state');
    window.history.replaceState({}, '', window.location.pathname);
    if (!expectedState || returnedState !== expectedState) return;
    finishStravaConnect(code);
  }, [user]);

  // Native: Strava approval opens in the OS's in-app browser (see
  // connectStrava below), not the app's own WebView, so there's no
  // window.location redirect to watch. Instead we listen for the OS
  // handing our custom-scheme deep link back to the running app.
  useEffect(() => {
    if (!user || !STRAVA_CLIENT_ID || !isNative) return;
    let unsubscribe;
    nativeOnAuthCallback((code) => {
      nativeCloseAuthUrl();
      finishStravaConnect(code);
    }).then((unsub) => { unsubscribe = unsub; });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [user]);

  function connectStrava() {
    if (!STRAVA_CLIENT_ID) return;
    sessionStorage.setItem('stravaOAuthPending', '1');
    if (isNative) {
      // The host here has to exactly match the "Authorization Callback
      // Domain" set in Strava's API application settings (currently
      // trbo.bike, same as the web redirect below) — Strava validates
      // redirect_uri against that domain even for a custom scheme.
      const redirectUri = 'app.trbo.trainer://trbo.bike';
      const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=auto&scope=activity:write`;
      nativeOpenAuthUrl(url);
      return;
    }
    const oauthState = crypto.randomUUID();
    sessionStorage.setItem('stravaOAuthState', oauthState);
    const redirectUri = window.location.origin + window.location.pathname;
    const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=auto&scope=activity:write&state=${oauthState}`;
    window.location.href = url;
  }
  async function disconnectStrava() {
    if (!user) return;
    await apiFetch('/api/strava-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disconnect: true }),
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
  // Heart rate is intentionally absent from everything below. It is displayed
  // live during a ride and included in the file the rider exports themselves,
  // but it is never written to our database and never sent to Strava.
  function recordWorkoutSession({ workoutId, name, category, duration, completed, avgPower, maxPower, tss, calories, outdoor, rpe, intensityAdjust }) {
    const entry = { id: newId(), date: new Date().toISOString(), workoutId, name, category, duration, completed, avgPower, maxPower, tss, calories, outdoor: !!outdoor, rpe: rpe ?? null, intensityAdjust: intensityAdjust ?? null, effortRating: null };
    setWorkoutHistory(list => [...list, entry]);
    if (user) {
      const baseRow = {
        id: entry.id, user_id: user.id, workout_id: workoutId, name, category, duration, completed, date: entry.date,
        avg_power: avgPower ?? null, max_power: maxPower ?? null,
        tss: tss ?? null, calories: calories ?? null,
        outdoor: !!outdoor, rpe: rpe ?? null,
      };
      // Try the full row first; if the survey columns haven't been added to
      // the database yet, the insert fails as a whole -- so retry without
      // them rather than lose the ride from history.
      supabase.from('workout_history').insert({ ...baseRow, intensity_adjust: intensityAdjust ?? null }).then(({ error }) => {
        if (error) supabase.from('workout_history').insert(baseRow).then(() => {});
      });
    }
    // Only push genuinely finished rides of real length to Strava — not
    // aborted attempts, and not confirmed-outdoor entries, since those were
    // ridden outside the app and the rider's own head unit/computer has
    // almost certainly already uploaded that ride itself.
    if (user && completed && !outdoor && duration >= 60 && profile && profile.strava_athlete_id) {
      apiFetch('/api/strava-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, durationSeconds: duration, date: entry.date, avgPower, maxPower }),
      }).catch(() => {});
    }
    return entry.id;
  }
  // One-tap post-ride survey answer (1 Easy .. 5 Couldn't finish), attached
  // to the session row that was just recorded. Fails silently if the
  // effort_rating column doesn't exist yet -- the local copy still updates,
  // so the finish screen behaves the same either way.
  function rateWorkoutSession(sessionId, rating) {
    if (!sessionId || !rating) return;
    setWorkoutHistory(list => list.map(e => (e.id === sessionId ? { ...e, effortRating: rating } : e)));
    if (user) supabase.from('workout_history').update({ effort_rating: rating }).eq('id', sessionId).eq('user_id', user.id).then(() => {});
  }
  // A confirmed outdoor ride logged after the fact (no live session, so no
  // power data) — duration + RPE feed estimateOutdoorTss for a fallback load
  // estimate, so the ride still counts toward the rider's training load.
  function logOutdoorRide({ workoutId, name, category, durationSeconds, rpe }) {
    const tss = estimateOutdoorTss(durationSeconds, rpe);
    recordWorkoutSession({ workoutId, name, category, duration: durationSeconds, completed: true, avgPower: null, maxPower: null, tss, calories: null, outdoor: true, rpe });
  }
  function clearWorkoutHistory() {
    setWorkoutHistory([]);
    if (user) supabase.from('workout_history').delete().eq('user_id', user.id).then(() => {});
  }

  function toggleStar(workoutId) {
    const wasStarred = starredIds.has(workoutId);
    setStarredIds(prev => {
      const next = new Set(prev);
      if (wasStarred) next.delete(workoutId); else next.add(workoutId);
      return next;
    });
    if (user) {
      if (wasStarred) supabase.from('starred_workouts').delete().eq('user_id', user.id).eq('workout_id', workoutId).then(() => {});
      else supabase.from('starred_workouts').insert({ user_id: user.id, workout_id: workoutId }).then(() => {});
    }
  }

  // Queue is small (a handful of workouts at most) so the simplest correct
  // way to keep positions in sync is to just replace the whole saved list
  // after every change, rather than patching individual rows.
  function persistQueue(ids) {
    if (!user) return;
    supabase.from('queued_workouts').delete().eq('user_id', user.id).then(() => {
      if (ids.length === 0) return;
      supabase.from('queued_workouts').insert(ids.map((workout_id, i) => ({ user_id: user.id, workout_id, position: i }))).then(() => {});
    });
  }
  function toggleQueue(workoutId) {
    setQueue(prev => {
      const inQueue = prev.includes(workoutId);
      const next = inQueue ? prev.filter(id => id !== workoutId) : [...prev, workoutId];
      persistQueue(next);
      return next;
    });
  }
  const UNDO_REMOVE_MS = 8000;
  function removeFromQueue(workoutId) {
    setQueue(prev => {
      const index = prev.indexOf(workoutId);
      const next = prev.filter(id => id !== workoutId);
      persistQueue(next);
      if (index !== -1) {
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        setLastRemovedQueueItem({ id: workoutId, index });
        undoTimerRef.current = setTimeout(() => setLastRemovedQueueItem(null), UNDO_REMOVE_MS);
      }
      return next;
    });
  }
  function undoRemoveFromQueue() {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setLastRemovedQueueItem(item => {
      if (!item) return null;
      setQueue(prev => {
        // If it somehow got re-added already, don't duplicate it.
        if (prev.includes(item.id)) return prev;
        const next = prev.slice();
        next.splice(Math.min(item.index, next.length), 0, item.id);
        persistQueue(next);
        return next;
      });
      return null;
    });
  }
  function moveQueueItem(workoutId, dir) {
    setQueue(prev => {
      const idx = prev.indexOf(workoutId);
      const target = idx + dir;
      if (idx === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      persistQueue(next);
      return next;
    });
  }
  // Used by the Queue tab's press-and-hold drag reorder — takes the whole
  // new order at once (rather than one swap at a time like moveQueueItem)
  // since the rider may have dragged an item past several others in one go.
  function reorderQueue(nextIds) {
    setQueue(prev => {
      // Sanity check: only accept it if it's actually a reordering of what's
      // already queued (same ids, same count) — guards against a stray call
      // racing a separate add/remove and corrupting the queue.
      if (nextIds.length !== prev.length) return prev;
      const prevSet = new Set(prev);
      if (!nextIds.every(id => prevSet.has(id))) return prev;
      persistQueue(nextIds);
      return nextIds;
    });
  }
  function clearQueue() {
    setQueue([]);
    if (user) supabase.from('queued_workouts').delete().eq('user_id', user.id).then(() => {});
  }

  // ---- saved queue presets: named snapshots of the current queue a rider
  // can reload later ("Monday plan", "Weekend plan"). Capped at
  // MAX_SAVED_QUEUES presets, MAX_SAVED_QUEUE_WORKOUTS workouts each -- both
  // easy to change later since they're just numbers here. ----
  const MAX_SAVED_QUEUES = 8;
  const MAX_SAVED_QUEUE_WORKOUTS = 8;
  function saveQueueAs(name) {
    const trimmedName = (name || '').trim();
    if (!trimmedName || !user) return { ok: false, reason: 'name' };
    if (savedQueues.length >= MAX_SAVED_QUEUES) return { ok: false, reason: 'limit' };
    if (queue.length === 0) return { ok: false, reason: 'empty' };
    if (queue.length > MAX_SAVED_QUEUE_WORKOUTS) return { ok: false, reason: 'too-long' };
    const tempId = `temp_${Date.now()}`;
    const workoutIds = [...queue];
    setSavedQueues(prev => [...prev, { id: tempId, name: trimmedName, workoutIds }]);
    supabase.from('saved_queues').insert({ user_id: user.id, name: trimmedName, workout_ids: workoutIds }).select('id').maybeSingle().then(({ data }) => {
      if (data) setSavedQueues(prev => prev.map(sq => (sq.id === tempId ? { ...sq, id: data.id } : sq)));
    });
    return { ok: true };
  }
  function loadSavedQueue(id) {
    const sq = savedQueues.find(s => s.id === id);
    if (!sq) return;
    setQueue(sq.workoutIds);
    persistQueue(sq.workoutIds);
  }
  function deleteSavedQueue(id) {
    setSavedQueues(prev => prev.filter(sq => sq.id !== id));
    if (user) supabase.from('saved_queues').delete().eq('id', id).eq('user_id', user.id).then(() => {});
  }

  // ---- active queue playback: rolls two or more workouts seamlessly into
  // each other without dropping back to the library in between ----
  function startQueue(workouts) {
    if (!workouts || workouts.length === 0) return;
    setActiveWorkout(null);
    setActiveQueueIndex(0);
    setActiveQueue(workouts);
  }
  function advanceQueue() {
    setActiveQueueIndex(i => {
      const next = i + 1;
      if (!activeQueue || next >= activeQueue.length) { setActiveQueue(null); return 0; }
      return next;
    });
  }
  function exitQueue() {
    setActiveQueue(null);
    setActiveQueueIndex(0);
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
    if (starredIds.has(id)) toggleStar(id);
    if (queue.includes(id)) removeFromQueue(id);
    setDetailWorkout(null);
  }
  function resetCustomWorkouts() {
    setCustomWorkouts([]);
    if (user) supabase.from('custom_workouts').delete().eq('user_id', user.id).then(() => {});
  }

  const theme = THEMES[settings.theme] || THEMES.dark;

  // Rider's recent weekly training load — the average TSS of the last few
  // completed weeks. Feeds the planner so a new plan ramps from where the
  // rider actually is, not a generic guess. Null-safe: 0 until there's history.
  const recentWeeklyTss = useMemo(() => {
    const completed = (workoutHistory || []).filter(w => w.completed && w.tss);
    if (!completed.length) return 0;
    const byWeek = {};
    completed.forEach(w => { const wk = startOfWeek(w.date); byWeek[wk] = (byWeek[wk] || 0) + (w.tss || 0); });
    const weekTotals = Object.entries(byWeek).sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 4).map(e => e[1]);
    if (!weekTotals.length) return 0;
    return Math.round(weekTotals.reduce((a, b) => a + b, 0) / weekTotals.length);
  }, [workoutHistory]);

  const themeVars = {
    '--bg': theme.bg, '--panel': theme.panel, '--panel2': theme.panel2, '--line': theme.line,
    '--text': theme.text, '--sub': theme.sub, '--red': theme.red, '--muted': theme.muted, '--navbg': theme.navbg,
    // NEW
    '--hero1': theme.hero1, '--hero1-ink': theme.hero1ink, '--hero1-chip': theme.hero1chip,
    '--hero2': theme.hero2, '--hero2-ink': theme.hero2ink, '--hero2-chip': theme.hero2chip,
    '--hero3': theme.hero3, '--hero3-ink': theme.hero3ink, '--hero3-chip': theme.hero3chip,
    '--flame': theme.flame,
  };
  const themeCss = Object.entries(themeVars).map(([k, v]) => `${k}:${v};`).join('');
  const globalStyle = "@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Space+Mono:wght@700&family=Inter:wght@400;500;600&display=swap');"
    + " :root { " + themeCss + " }"
    // 100% (rather than 100dvh) doesn't track iOS Safari/WKWebView's real
    // visible viewport as the browser chrome shows/hides, which is what
    // left a white gap below shorter screens (e.g. the login form) — the
    // page was sized to a stale, taller-than-actual 100%.
    + " html, body, #root { height: 100%; height: 100dvh; }"
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
    + " .sidebar-nav { height: 100vh; height: 100dvh; }"
    + " .player-screen { height: 100vh; height: 100dvh; box-sizing: border-box; }"
    + " .player-main { flex: 1; min-height: 0; overflow: auto; }"
    + " @media (orientation: landscape) { .player-main { flex-direction: row !important; align-items: center; justify-content: center; gap: 20px; } .player-stats { flex: 1 1 auto; max-width: 560px; } .player-controls { flex: 0 0 auto; } }"
    // finish-line celebration confetti
    + " @keyframes confetti-fall { 0% { transform: translateY(-20px) rotate(0deg); opacity: 1; } 100% { transform: translateY(420px) rotate(600deg); opacity: 0; } }"
    // gentle bounce drawing a first-time demo visitor's eye to the intensity dial
    + " @keyframes demo-tag-bounce { 0%, 100% { transform: translateX(-50%) translateY(0); } 50% { transform: translateX(-50%) translateY(-4px); } }";
  const wrapStyle = { '--accent': theme.accent || settings.accentColor, ...themeVars, background: BG, minHeight: '100%', fontFamily: 'Inter, sans-serif', colorScheme: settings.theme === 'dark' ? 'dark' : 'light' };

  // ---- public demo ride: no account needed, takes priority over auth ----
  if (demoMode) {
    return (
      <div style={wrapStyle}>
        <style>{globalStyle}</style>
        <OrientationGate preferredOrientation={DEFAULT_SETTINGS.preferredOrientation}>
          <PlayerView
            workout={DEMO_WORKOUT}
            ftp={DEMO_FTP}
            settings={{ ...DEFAULT_SETTINGS, ergMode: true }}
            trainer={trainer}
            heartRate={heartRate}
            isDemo
            onExit={() => {
              const url = new URL(window.location.href);
              url.searchParams.delete('demo');
              window.history.replaceState({}, '', url);
              setDemoMode(false);
            }}
          />
        </OrientationGate>
      </div>
    );
  }

  if (authLoading) {
    return <div style={wrapStyle}><style>{globalStyle}</style><LoadingView /></div>;
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

  // ---- gate 1: not logged in → auth flow ----
  if (!user) {
    return (
      <div style={wrapStyle}>
        <style>{globalStyle}</style>
        {authScreen === 'login' && <LoginView onLogin={handleLogin} goSignup={() => setAuthScreen('signup')} goForgot={() => setAuthScreen('forgot')} initialMsg={oauthBlockedMsg} />}
        {authScreen === 'signup' && <SignupView onSignup={handleSignup} goLogin={() => setAuthScreen('login')} />}
        {authScreen === 'forgot' && <ForgotPasswordView onReset={handleForgotPassword} goLogin={() => setAuthScreen('login')} />}
      </div>
    );
  }

  // ---- gate 1b: this device got signed out for exceeding the device cap ----
  if (deviceRevoked) {
    return (
      <div style={wrapStyle}>
        <style>{globalStyle}</style>
        <DeviceLimitView onLogout={handleLogout} />
      </div>
    );
  }

  if (profileLoading || !profile) {
    return <div style={wrapStyle}><style>{globalStyle}</style><LoadingView /></div>;
  }

  const account = { name: profile.name || user.user_metadata?.name || 'Rider', email: user.email };
  // A paused membership stays "subscribed" in Stripe's eyes -- billing just
  // stops. So paused riders keep everything until the period they already
  // paid for runs out, and only then does access lapse. Without this second
  // condition, pausing would quietly become a free membership for life.
  const subscriptionPaused = !!profile.subscription_paused;
  const paidThroughAt = profile.subscription_paid_through ? new Date(profile.subscription_paid_through).getTime() : null;
  const pausedAccessExpired = subscriptionPaused && paidThroughAt != null && paidThroughAt <= Date.now();
  const subscribed = !!profile.subscribed && !pausedAccessExpired;
  const compAccess = !!profile.comp_access; // friends & family: free, permanent access, no card ever
  // Tester comp: free access that expires on its own -- granted automatically
  // (see handle_new_user in supabase-setup.sql) to anyone who signs up via a
  // Supabase "Invite user" invite, i.e. a hand-picked, approved tester.
  const testerCompExpiresAt = profile.comp_expires_at ? new Date(profile.comp_expires_at).getTime() : null;
  const testerCompActive = testerCompExpiresAt != null && testerCompExpiresAt > Date.now();
  const testerCompDaysLeft = testerCompActive ? Math.max(1, Math.ceil((testerCompExpiresAt - Date.now()) / 86400000)) : 0;
  const hasFullAccess = subscribed || compAccess || testerCompActive;
  const daysLeft = daysLeftInTrial(profile.trial_start);
  const trialExpired = daysLeft <= 0;

  // ---- gate 2: trial over and neither subscribed nor comped → blocking paywall ----
  if (trialExpired && !hasFullAccess) {
    return (
      <div style={wrapStyle}>
        <style>{globalStyle}</style>
        <PaywallView blocking trialExpired onLogout={handleLogout} userId={user.id} email={user.email} subscriptionPaused={subscriptionPaused} subscriptionPaidThrough={profile.subscription_paid_through} />
      </div>
    );
  }

  if (activeQueue) {
    const current = activeQueue[activeQueueIndex];
    const queueInfo = { position: activeQueueIndex, total: activeQueue.length, hasNext: activeQueueIndex < activeQueue.length - 1, nextName: activeQueueIndex < activeQueue.length - 1 ? activeQueue[activeQueueIndex + 1].name : null };
    const resume = initialSession && initialSession.kind === 'queue' ? { index: initialSession.currentIndex, timeLeft: initialSession.timeLeft, intensityAdjust: initialSession.intensityAdjust } : null;
    return (
      <div style={wrapStyle}>
        <style>{globalStyle}</style>
        <OrientationGate preferredOrientation={settings.preferredOrientation}>
          <PlayerView key={current.id + '_q' + activeQueueIndex} workout={current} ftp={ftp} settings={settings} trainer={trainer} heartRate={heartRate}
            onExit={exitQueue} onSaveFtpResult={recordFtpResult} onApplyFtp={setFtp} onSessionEnd={recordWorkoutSession} onEffortRating={rateWorkoutSession}
            queueInfo={queueInfo} onQueueAdvance={advanceQueue} workoutHistory={workoutHistory}
            resume={resume} sessionMeta={{ kind: 'queue', queueWorkouts: activeQueue, queueIndex: activeQueueIndex }} />
        </OrientationGate>
      </div>
    );
  }

  if (activeWorkout) {
    const resume = initialSession && initialSession.kind === 'single' ? { index: initialSession.currentIndex, timeLeft: initialSession.timeLeft, intensityAdjust: initialSession.intensityAdjust } : null;
    return (
      <div style={wrapStyle}>
        <style>{globalStyle}</style>
        <OrientationGate preferredOrientation={settings.preferredOrientation}>
          <PlayerView workout={activeWorkout} ftp={ftp} settings={settings} trainer={trainer} heartRate={heartRate} onExit={() => { clearActiveSession(); setActiveWorkout(null); }} onSaveFtpResult={recordFtpResult} onApplyFtp={setFtp} onSessionEnd={recordWorkoutSession} onEffortRating={rateWorkoutSession} workoutHistory={workoutHistory}
            resume={resume} sessionMeta={{ kind: 'single' }} />
        </OrientationGate>
      </div>
    );
  }

  if (activeGame) {
    return (
      <div style={wrapStyle}>
        <style>{globalStyle}</style>
        <Suspense fallback={<LazyFallback />}>
          <MiniGamePlayer game={activeGame} ftp={ftp} trainer={trainer} heartRate={heartRate} onExit={() => setActiveGame(null)} cvd={settings.colorblindMode} />
        </Suspense>
      </div>
    );
  }

  const isSidebar = navLayout.mode === 'sidebar';
  function handleNavigate(key) {
    if (key === 'builder') setEditingWorkout(null);
    if (key === 'library') setLibCategory('All');
    setView(key);
  }
  function handleSelectCategory(c) {
    setLibCategory(c);
    setView('library');
  }

  return (
    <ColorblindContext.Provider value={settings.colorblindMode}>
    <div style={{ ...wrapStyle, position: 'relative', ...(isSidebar ? {} : { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(54px + env(safe-area-inset-bottom))' }) }}>
      <style>{globalStyle}</style>
      <OrientationGate preferredOrientation={settings.preferredOrientation}>
        <div style={isSidebar ? { display: 'flex', height: '100dvh', overflow: 'hidden' } : undefined}>
          {isSidebar && (
            <SidebarNav view={view} onNavigate={handleNavigate} width={navLayout.width} category={libCategory} onSelectCategory={handleSelectCategory} />
          )}
          <div
            ref={isSidebar ? contentScrollRef : undefined}
            style={isSidebar ? { flex: 1, minWidth: 0, height: '100dvh', overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' } : undefined}
          >
            {!hasFullAccess && <TrialBanner daysLeft={daysLeft} onUpgrade={() => setShowPaywallModal(true)} />}

            <Suspense fallback={<LazyFallback />}>
            {view === 'home' && <HomeView account={account} ftpHistory={ftpHistory} workoutHistory={workoutHistory} trainingPlan={trainingPlan} onNavigate={setView} onPlayGame={setActiveGame} />}
            {view === 'library' && <LibraryView customWorkouts={customWorkouts} onOpen={setDetailWorkout} category={libCategory} onCategoryChange={setLibCategory} starredIds={starredIds} onToggleStar={toggleStar} />}
            {view === 'basics' && <LibraryView customWorkouts={customWorkouts} onOpen={setDetailWorkout} lockedCategory="Basics" title="Basics" starredIds={starredIds} onToggleStar={toggleStar} />}
            {view === 'rides' && <LibraryView customWorkouts={customWorkouts} onOpen={setDetailWorkout} lockedCategory="Rides" title="Rides" starredIds={starredIds} onToggleStar={toggleStar} />}
            {view === 'games' && <MiniGamesView onPlay={setActiveGame} />}
            {view === 'planner' && <PlannerView plan={trainingPlan} ftp={ftp} recentWeeklyTss={recentWeeklyTss} library={LIBRARY} workoutHistory={workoutHistory} ftpHistory={ftpHistory} onSetFtp={setFtp} onSavePlan={saveTrainingPlan} onOpenPlanWorkout={openPlanWorkout} archivedPlans={archivedPlans} onArchivePlan={archivePlan} onDeleteArchivedPlan={deleteArchivedPlan} onLogOutdoor={logOutdoorRide} />}
            {view === 'builder' && <BuilderView customWorkouts={customWorkouts} saveCustomWorkout={saveCustomWorkout} deleteCustomWorkout={deleteCustomWorkout} editingWorkout={editingWorkout} clearEditing={() => setEditingWorkout(null)} ownerStats={ownerStats} />}
            {view === 'queue' && <QueueView queue={queue} customWorkouts={customWorkouts} onOpen={setDetailWorkout} onRemove={removeFromQueue} onReorder={reorderQueue} onClear={clearQueue} onStartQueue={startQueue} savedQueues={savedQueues} maxSavedQueues={MAX_SAVED_QUEUES} maxSavedQueueWorkouts={MAX_SAVED_QUEUE_WORKOUTS} onSaveQueue={saveQueueAs} onLoadSavedQueue={loadSavedQueue} onDeleteSavedQueue={deleteSavedQueue} lastRemovedQueueItem={lastRemovedQueueItem} onUndoRemove={undoRemoveFromQueue} />}
            {view === 'ftp' && <FtpView ftp={ftp} setFtp={setFtp} ftpHistory={ftpHistory} onClearFtpHistory={clearFtpHistory} onOpenWorkout={setDetailWorkout} />}
            {view === 'history' && <HistoryView workoutHistory={workoutHistory} onClear={clearWorkoutHistory} />}
            {view === 'feedback' && <FeedbackView userId={user.id} />}
            {view === 'settings' && (
              <SettingsView
                settings={settings} updateSetting={updateSetting} ftp={ftp} setFtp={setFtp} trainer={trainer} heartRate={heartRate}
                customWorkouts={customWorkouts} onResetCustom={resetCustomWorkouts} ftpHistory={ftpHistory} onClearFtpHistory={clearFtpHistory}
                account={account} daysLeft={daysLeft} subscribed={subscribed} compAccess={compAccess} testerCompActive={testerCompActive} testerCompDaysLeft={testerCompDaysLeft} onLogout={handleLogout} onShowPaywall={() => setShowPaywallModal(true)}
                subscriptionPaused={subscriptionPaused} subscriptionPaidThrough={profile.subscription_paid_through}
                ownerStats={ownerStats}
                stravaConnected={!!(profile && profile.strava_athlete_id)} onConnectStrava={connectStrava} onDisconnectStrava={disconnectStrava}
              />
            )}
            </Suspense>
          </div>
        </div>

        {detailWorkout && (
          <WorkoutDetail
            workout={detailWorkout} ftp={ftp} setFtp={setFtp} settings={settings}
            presetMinutes={detailPresetMinutes}
            isCustom={customWorkouts.some(w => w.id === detailWorkout.id)}
            starred={starredIds.has(detailWorkout.id)} onToggleStar={toggleStar}
            inQueue={queue.includes(detailWorkout.id)} onToggleQueue={toggleQueue}
            onClose={() => { setDetailWorkout(null); setDetailPresetMinutes(null); }}
            onStart={(w) => { setActiveWorkout(w); setDetailWorkout(null); setDetailPresetMinutes(null); }}
            onEdit={() => { setEditingWorkout(detailWorkout); setDetailWorkout(null); setDetailPresetMinutes(null); setView('builder'); }}
            onDelete={() => deleteCustomWorkout(detailWorkout.id)}
            onSaveScaled={(w) => { saveCustomWorkout(w); setDetailWorkout(null); setDetailPresetMinutes(null); }}
          />
        )}

        {showPaywallModal && (
          <PaywallView onClose={() => setShowPaywallModal(false)} onLogout={handleLogout} userId={user.id} email={user.email} />
        )}

        {!isSidebar && <BottomTabBar view={view} onNavigate={handleNavigate} />}

        {installHint.show && <InstallHintToast onDismiss={installHint.dismiss} onInstall={installHint.install} />}
      </OrientationGate>
    </div>
    </ColorblindContext.Provider>
  );
}
