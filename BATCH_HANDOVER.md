# Handover — Batches 1–4 (July 2026 full review)

For Claude (or anyone) picking this up in a future session. Findings come
from a top-to-bottom read of the repo on 21 July 2026 — every `api/*.js`
file, the full `supabase-setup.sql`, `src/App.jsx`, `src/planner.js`, and
configs — plus a clean `npm audit` (0 vulnerabilities). Each batch below is
sized to ship as one focused session. Follow the standard trbo-ops workflow
every time (clone → strip token → change → esbuild check → build → revert
dist → rebase → push → strip → delete clone).

---

## Batch 1 — Pre-relaunch security pass — ✅ SHIPPED 21 July 2026

All seven items landed in one commit, plus item 4.1 riding along:

- **1.1** `api/_emailLink.js` — full 64-char HMAC signatures; missing
  `EMAIL_LINK_SECRET` now throws at import instead of falling back to a
  guessable dev secret. Landed before `RESEND_API_KEY` went live, so no
  in-flight links were invalidated.
- **1.2** `api/survey.js` — `escapeHtml` helper added; `uid` escaped where
  it lands in the hidden form input. Other query values confirmed
  allowlist-validated before use.
- **1.3** `src/App.jsx` — Strava OAuth `state` parameter (web flow):
  `crypto.randomUUID()` stored in sessionStorage before redirect, appended
  to the authorize URL, compared on return, cleared either way. Native
  deep-link flow untouched (out of scope per original spec).
- **1.4** `api/_rateLimit.js` — `failClosed` option added;
  `api/admin-invite.js` passes `failClosed: true`. All other endpoints
  keep failing open (deliberate availability choice, commented in file).
- **1.5** `api/unsubscribe.js` — GET now renders a confirmation page;
  the actual opt-out moved to POST behind a button, with the same
  signature verified on both. Email scanners can no longer silently
  unsubscribe people. URL format in emails unchanged.
- **1.6** `api/email-sequence-cron.js` — query-string secret channel
  removed; header-only auth. Manual-testing curl command noted in file.
- **1.7** `api/admin-invite.js` — `crypto.timingSafeEqual` secret
  comparison (length-guarded). Body-secret channel kept for
  `public/admin-invite.html`.
- **4.1** `api/stripe-webhook.js` — `past_due` now keeps `subscribed`
  true, so Stripe's smart retries act as a grace period on failed
  renewals. **Dashboard step still open:** confirm in Stripe → Settings →
  Billing → Subscriptions and emails that smart retries are on and the
  final-failure outcome is "cancel subscription."

`SECURITY_HANDOVER.md` folded into this file and deleted (Batch 1
superseded its items #3/#4/#5). Its one residual note, preserved here:

> Feedback photo files are stored under a folder named after the
> uploader's user id (`<userId>/<uuid>.jpg`), so board anonymity covers
> the *text* of who wrote a post but a determined person could still read
> an author's id out of a photo's storage path. Fully closing this means
> random folder ids plus reworking the photo-delete rule — worth doing
> only if the board ever opens beyond trusted testers; low urgency while
> it's testers-only.

**Explicitly out of scope (decided, don't reopen):** client-side paywall
hardening (accepted risk at this price point) and the photo-path item
above.

---

## Batch 2 — Repo hygiene: untrack `dist/` and `node_modules/`

The repo tracks ~22,000 files of build output and installed packages.
This slows every clone and creates the recurring "revert dist/ before
committing" hazard. One-time fix, permanent payoff. **Do this as its own
commit with nothing else in it.**

Steps:
1. **First, read `codemagic.yaml` and confirm both workflows run a
   dependency install (`npm ci` or `npm install`) and `npm run build`
   before `npx cap sync`.** This was not verified during the review — it
   is the one precondition. If either workflow relies on committed
   `dist/` or `node_modules/`, add the missing install/build step to the
   yaml in the same commit.
2. Vercel builds from source (`vite build`) — no dependency there, but
   glance at the Vercel project's build settings to confirm the build
   command isn't overridden to something that skips the build.
3. Add `.gitignore` (or extend it) with `dist/` and `node_modules/`.
4. `git rm -r --cached dist node_modules` (leaves local copies intact),
   commit, push.
5. After the push, watch one Codemagic build for each platform (iOS +
   Android) and one Vercel deploy go green before calling it done.

Note: history still contains the old blobs, so the `.git` folder stays
big until/unless history is rewritten — **do not rewrite history**; the
win is that future commits, diffs, and status checks stop touching 22k
files, and the dist-revert ritual disappears from the standard workflow.
Update the trbo-ops skill's workflow step 7 note once this lands.

---

## Batch 3 — Performance: load screens on demand + small backend tidy

### 3.1 Lazy-load non-core screens
`src/main.jsx` / `src/App.jsx` currently import everything eagerly.
Convert to `React.lazy(() => import('./MiniGames.jsx'))` (etc.) with a
`<Suspense>` fallback (minimal centered spinner in brand colors) for:
`MiniGames.jsx`, `PlannerView.jsx`, `Feedback.jsx`, `PrivacyPage.jsx`,
`TermsPage.jsx`, `PublicPages.jsx`. Vite handles the chunking
automatically.

Gotchas:
- `React.lazy` needs default exports — check each file's export style
  first and adjust if any use named exports.
- `planner.js` (the logic module) is imported by `App.jsx` directly at
  line ~11 for `WORKOUT_PURPOSE` etc. — that stays eager; only the
  *views* go lazy.
- Capacitor: lazy chunks are local files inside the app bundle, so this
  works offline/native — but do one TestFlight sanity pass anyway,
  specifically opening each lazy screen with airplane mode on.
- PWA: confirm `vite-plugin-pwa` precaches the new chunks (default
  `globPatterns` covers `**/*.js` — just verify in the build output).

Measure before/after: note the main chunk size from `npm run build`
output in the commit message so the win is on record.

### 3.2 `api/email-sequence-cron.js` — batch the email lookups
The loop calls `auth.admin.getUserById` once per profile. Replace with
one `auth.admin.listUsers` page (the cohort is ≤15 days of signups, well
under one page at current scale) into a `Map(id → email)` before the
loop. Keep the per-profile error handling. Purely a scale/tidiness fix —
behaviour identical.

---

## Batch 4 — Product/commercial (each item is a decision + a small build)

### 4.1 Grace period on failed renewal payments — ✅ SHIPPED with Batch 1
Code side done (see Batch 1 above). **Still open:** the Stripe dashboard
check — Settings → Billing → Subscriptions and emails: confirm smart
retries are on and the after-final-failure outcome is set to cancel the
subscription.

### 4.2 Subscription pause (the "seasonal rider" feature no big rival has)
Zwift's lack of pausing is a documented complaint. Two routes:
- **Recommended: Stripe Customer Portal.** Enable the portal in the
  Stripe Dashboard with "Pause subscription" allowed, then add a
  serverless endpoint (`api/customer-portal.js`, copying the auth +
  rate-limit pattern from `create-checkout-session.js`) that creates a
  portal session for the verified user's `stripe_customer_id` and
  returns the URL; add a "Manage subscription" button in Settings. This
  also gives card-update and cancel self-service for free — support
  email load drops too.
- Custom pause UI in-app: more work, no extra value at this stage. Don't.
Webhook note: a paused subscription's status handling should be tested —
pause via `pause_collection` keeps status `active` (access continues
until period end, then `past_due`/unpaid per settings). Decide the
intended behaviour (recommend: paused riders keep access until their
paid period ends, then it lapses) and verify the webhook produces it in
live mode with a real test on Hubert's own account before announcing.
Managed Payments caveat: confirm the portal + pause features are
available under Managed Payments once eligibility clears — if not,
ship 4.1 alone and revisit.

### 4.3 Marketing-site messaging (content, not code — for when the site gets built)
Position against "execution platforms," not against Zwift:
- Lead: the periodised planner ("a real training plan, not a workout
  list") at a quarter of TrainerRoad's price.
- Second: runs in any browser — no install, works on ChromeOS and
  locked-down laptops; nothing else in the market does this.
- Third: works with older trainers (dual-protocol Bluetooth incl. Wahoo
  KICKR SNAP) and never stores heart-rate data.
- Once Batch 4.2 ships: "pause any time" as a headline.
- Hard rule: every claim gets checked against shipped reality first (see
  the claims audit in PLANNER_ROADMAP.md Stage 4). Overstating the
  adaptive story before the planner roadmap ships it would burn the
  exact trust the angle depends on.

---

## Suggested order

2 → 3 in consecutive sessions (repo knowledge is fresh). 4.2 waits for
the Managed Payments eligibility answer. 4.3 is writing, not code —
schedule with the marketing site build.

After each batch ships: update this file (strike the batch).
