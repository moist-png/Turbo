// All copy for the lifecycle email sequence lives here, kept separate from
// the sending/scheduling logic in email-sequence-cron.js so the words can
// be edited without touching anything that decides *when* an email goes
// out. Every template is a function of (ctx) -> { subject, html }, where
// ctx carries whatever that particular email needs (first name, links,
// small behavioral facts like "have they ridden yet").

const INK = '#14171A';
const CREAM = '#F3EDE3';
const TEAL = '#2FC5AE';
const BORDER = '#E3D9C8';
const MUTED = '#8B7F6E';

// Six answers for the one-click trial-abandonment survey. `label` is what
// shows as a button in the email; `prompt` is what the optional follow-up
// page asks afterwards.
export const SURVEY_ANSWERS = [
  { key: 'too_expensive', label: 'Too expensive', prompt: 'What would\u2019ve felt like the right price?' },
  { key: 'missing_feature', label: 'Missing a feature I needed', prompt: 'What feature was missing?' },
  { key: 'different_app', label: 'Went with a different app', prompt: 'Mind sharing which one?' },
  { key: 'not_right_time', label: 'Wasn\u2019t the right time', prompt: null }, // handled separately (check-in offer)
  { key: 'bug_issue', label: 'Ran into a bug or issue', prompt: 'What happened?' },
  { key: 'other', label: 'Something else', prompt: 'Go ahead, we\u2019re listening.' },
];

function wrap(bodyHtml, unsubscribeUrl) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:${CREAM};font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
    <div style="font-weight:800;font-size:20px;letter-spacing:-0.3px;color:${INK};margin-bottom:22px;">TRBO</div>
    <div style="background:#ffffff;border:1px solid ${BORDER};border-radius:14px;padding:26px 24px;">
      ${bodyHtml}
    </div>
    <div style="margin-top:18px;font-size:11px;color:${MUTED};text-align:center;line-height:1.6;">
      Trbo &middot; Botany NSW, Australia<br />
      <a href="${unsubscribeUrl}" style="color:${MUTED};">Unsubscribe from these emails</a>
    </div>
  </div>
</body>
</html>`;
}

function button(label, url) {
  return `<a href="${url}" style="display:inline-block;background:${TEAL};color:${INK};text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;margin-top:6px;">${label}</a>`;
}
function p(text) {
  return `<p style="font-size:14.5px;line-height:1.6;color:${INK};margin:0 0 14px;">${text}</p>`;
}
function h1(text) {
  return `<h1 style="font-size:19px;font-weight:700;color:${INK};margin:0 0 14px;">${text}</h1>`;
}

const SITE = 'https://trbo.bike';

// ---------------------------------------------------------------------------
// Track A -- during the 7-day trial
// ---------------------------------------------------------------------------
function trialDay0(ctx) {
  return {
    subject: 'Welcome to Trbo — let\u2019s get your trainer connected',
    html: wrap(
      h1(`Hey ${ctx.firstName},`) +
      p('You\u2019re in for 7 days, no card needed. First thing: open Trbo and connect your smart trainer over Bluetooth — once it\u2019s paired, ERG mode holds your power target automatically, no guessing your gear.') +
      p('From there, the workout library\u2019s all yours — structured sessions, real rides, and a training planner if you want the whole week mapped out.') +
      button('Open Trbo', SITE),
      ctx.unsubscribeUrl
    ),
  };
}
function trialDay3(ctx) {
  return {
    subject: 'Still there? Here\u2019s a 20-minute starter',
    html: wrap(
      h1(`No rush, ${ctx.firstName}`) +
      p('Haven\u2019t hopped on yet — totally fine. If you\u2019ve got 20 minutes, that\u2019s enough to get a feel for how Trbo rides. Pick anything under "Basics" and just go.') +
      button('Find a 20-min ride', SITE),
      ctx.unsubscribeUrl
    ),
  };
}
function trialDay6(ctx) {
  return {
    subject: 'Your trial ends tomorrow',
    html: wrap(
      h1('One day left') +
      p(`${ctx.firstName}, your free trial wraps up tomorrow. If Trbo\u2019s earned a spot in your training, keeping it going is $8.99/month — or $89.99/year, which works out to 10 months paid for 12.`) +
      button('Keep your access', SITE),
      ctx.unsubscribeUrl
    ),
  };
}
function trialDay7(ctx) {
  return {
    subject: 'Your trial ends today',
    html: wrap(
      h1('Last day') +
      p(`Today\u2019s the day, ${ctx.firstName}. Subscribe now and pick up exactly where you left off — nothing about your history, plan, or FTP resets.`) +
      button('Subscribe now', SITE),
      ctx.unsubscribeUrl
    ),
  };
}

// ---------------------------------------------------------------------------
// Track B -- trial ended, never subscribed
// ---------------------------------------------------------------------------
function nonconvertDay8(ctx) {
  const buttons = SURVEY_ANSWERS.map(a => `<div style="margin-bottom:8px;">${button(a.label, ctx.surveyLinks[a.key])}</div>`).join('');
  return {
    subject: 'Quick one — what stopped you subscribing?',
    html: wrap(
      h1('One question, one click') +
      p(`${ctx.firstName}, your trial wrapped up and you didn\u2019t stick around — no hard feelings, just curious why. Pick whichever\u2019s closest, takes one tap:`) +
      buttons,
      ctx.unsubscribeUrl
    ),
  };
}
function nonconvertDay11(ctx) {
  let body;
  if (ctx.surveyReason === 'too_expensive') {
    body = p(`${ctx.firstName}, since price was the sticking point — the annual plan works out to $5.49/month if paid yearly (12 months for the price of 11). Might be worth a look.`) + button('See pricing', SITE);
  } else if (ctx.surveyReason === 'missing_feature') {
    body = p(`${ctx.firstName}, thanks for the note on what was missing — genuinely useful. If you want to keep an eye on what\u2019s shipping, or drop more feedback any time, that\u2019s always open.`) + button('Open Trbo', SITE);
  } else {
    body = p(`${ctx.firstName}, just a quick reminder Trbo\u2019s still here — structured workouts, ERG mode, and the training planner, whenever you\u2019re ready to pick it back up.`) + button('Open Trbo', SITE);
  }
  return { subject: 'Following up on that', html: wrap(h1('Following up') + body, ctx.unsubscribeUrl) };
}
function nonconvertDay14(ctx) {
  return {
    subject: 'The door\u2019s open whenever you\u2019re ready',
    html: wrap(
      h1('No pressure') +
      p(`That\u2019s the last one from us for now, ${ctx.firstName}. If you ever want back in, everything\u2019s exactly where you left it.`) +
      button('Open Trbo', SITE),
      ctx.unsubscribeUrl
    ),
  };
}

// ---------------------------------------------------------------------------
// Track C -- subscribed, or a comped tester
// ---------------------------------------------------------------------------
function subDay0(ctx) {
  const headline = ctx.isTester ? 'Thanks for testing Trbo' : 'You\u2019re in — welcome to Trbo';
  const lede = ctx.isTester
    ? `${ctx.firstName}, thanks for helping test Trbo before launch. Poke around, ride whatever looks interesting, and use the Feedback tab for anything broken, missing, or great.`
    : `${ctx.firstName}, you\u2019re all set. Next up: build a training plan so every week has a plan instead of guesswork.`;
  return { subject: headline, html: wrap(h1(headline) + p(lede) + button('Open Trbo', SITE), ctx.unsubscribeUrl) };
}
function subDay3(ctx) {
  return {
    subject: 'Build your first training plan',
    html: wrap(
      h1('Let the planner do the thinking') +
      p(`${ctx.firstName}, tell it your FTP and how many days a week you\u2019ve got, and Trbo lays out a periodized plan — base, build, and taper — instead of you picking a workout cold every day.`) +
      button('Build a plan', SITE),
      ctx.unsubscribeUrl
    ),
  };
}
function subDay9(ctx) {
  return {
    subject: 'Have you raced the pros yet?',
    html: wrap(
      h1('Race the Pros') +
      p(`${ctx.firstName}, if you haven\u2019t tried it yet — five real race efforts, you against the clock. Ganna\u2019s TT pace, Pogačar\u2019s climb, Bennett\u2019s sprint. Short, sharp, worth it.`) +
      button('Race the Pros', SITE),
      ctx.unsubscribeUrl
    ),
  };
}
function subDay14(ctx) {
  if (ctx.recentRideCount >= 3) {
    return {
      subject: 'You\u2019ve put in the work — nice',
      html: wrap(
        h1('Two weeks in') +
        p(`${ctx.firstName}, ${ctx.recentRideCount} rides in your first two weeks — that\u2019s a real start. Keep the streak going.`) +
        button('Open Trbo', SITE),
        ctx.unsubscribeUrl
      ),
    };
  }
  return {
    subject: 'Two weeks in — let\u2019s get you back on the bike',
    html: wrap(
      h1('Easing back in') +
      p(`${ctx.firstName}, your first two weeks were quieter than most — happens. No pressure, just a nudge: a short 20-minute ride is the easiest way back in.`) +
      button('Find a short ride', SITE),
      ctx.unsubscribeUrl
    ),
  };
}

const TEMPLATES = {
  trial_day0: trialDay0, trial_day3: trialDay3, trial_day6: trialDay6, trial_day7: trialDay7,
  nonconvert_day8: nonconvertDay8, nonconvert_day11: nonconvertDay11, nonconvert_day14: nonconvertDay14,
  sub_day0: subDay0, sub_day3: subDay3, sub_day9: subDay9, sub_day14: subDay14,
};

export function buildEmail(sequenceKey, ctx) {
  const fn = TEMPLATES[sequenceKey];
  if (!fn) return null;
  return fn(ctx);
}

// Simple confirmation/follow-up pages the survey and unsubscribe links land
// on -- plain, on-brand, no email-client constraints since these render in
// a normal browser.
export function pageShell(bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:40px 20px;background:${CREAM};font-family:Arial,Helvetica,sans-serif;display:flex;justify-content:center;">
  <div style="max-width:420px;width:100%;">
    <div style="font-weight:800;font-size:20px;letter-spacing:-0.3px;color:${INK};margin-bottom:20px;">TRBO</div>
    <div style="background:#ffffff;border:1px solid ${BORDER};border-radius:14px;padding:26px 24px;">
      ${bodyHtml}
    </div>
  </div>
</body>
</html>`;
}
export { p as pageP, h1 as pageH1, button as pageButton, INK, TEAL, BORDER, MUTED };
