# Security handover — remaining items (#3, #4, #5)

This file is a to-do list for the three lower-priority findings from the
July 2026 security review. Items #1 (feedback board anonymity) and #2
(database function search_path) were already fixed and shipped.

None of these three block relaunch on their own. They're ordered here by
priority. Each section says: what the problem is, why it matters, how bad it
really is, and exactly what to change. Hand this whole file to whoever picks
up the work (or back to Claude) and it should be enough to act on without
re-doing the investigation.

---

## #3 — Email links: shortened signature + a raw value dropped into a page

**Priority: low / medium. Two small things, same file family.**

### Background
Unsubscribe links and trial-survey links in emails can't rely on someone
being logged in — they're clicked cold, sometimes weeks later. So instead of
logging in, each link carries a *signature* that proves the link genuinely
came from an email Trbo sent. That signature is made in `api/_emailLink.js`.

### Problem 3a — the signature is cut down to half length
In `api/_emailLink.js`, the `sign()` function makes a proper 64-character
SHA-256 signature and then throws half of it away:

```js
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
}
```

The `.slice(0, 32)` keeps only the first 32 characters. A full-length
signature is dramatically harder to guess than a half one, and there's no
benefit to the shorter version — the links aren't meaningfully longer either
way.

**How bad is it?** Low. Even 32 hex characters is hard to brute-force, and
the rate limiter caps guessing attempts. But there's no reason to hand that
margin away.

**The fix:** delete `.slice(0, 32)` so the whole signature is used:

```js
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}
```

**Important gotcha:** the check in `verify()` further down the same file
re-runs `sign()` and compares, so it stays in sync automatically — no change
needed there. BUT any unsubscribe/survey link that was *already emailed to
someone* before this change carries an old 32-char signature and will stop
verifying after the switch. Since the email sequence is still in testing and
`RESEND_API_KEY` isn't live yet (no real emails have gone out), this is a
non-issue right now. Just make this change *before* real emails start
sending, not after, and there's nothing to migrate.

### Problem 3b — the user id is dropped straight into page HTML
In `api/survey.js`, when the follow-up form is built, the `uid` from the URL
is inserted directly into the page's HTML:

```js
`<input type="hidden" name="uid" value="${uid}" />` +
```

`uid` comes from the link's query string. Because it's placed into the page
without being escaped, a crafted `uid` value containing HTML/quote characters
could break out of that attribute. This is the classic shape of a
cross-site-scripting (XSS) issue.

**How bad is it?** Low in practice. To even reach this code path an attacker
needs a *valid signature* for their crafted `uid` (see #3a — they'd have to
forge one), and the survey page is a minor corner of the product. But
"untrusted value → straight into HTML" is exactly the pattern worth closing
on principle, and it's a two-line fix.

**The fix:** escape the value before putting it in HTML. Add a tiny helper at
the top of `api/survey.js`:

```js
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
```

Then use it wherever `uid` (or any other query value) goes into the page:

```js
`<input type="hidden" name="uid" value="${escapeHtml(uid)}" />` +
```

Do a quick scan of `api/survey.js` for any other spot where a value from
`req.query` or `req.body` lands inside a template string of HTML, and wrap
those in `escapeHtml(...)` too. As of this writing the `uid` input above is
the main one.

---

## #4 — Rate limiter "fails open"

**Priority: low. This is a judgement call, not a clear bug.**

### The situation
The shared rate limiter lives in `api/_rateLimit.js`. If the database call
that counts requests ever errors out, the code currently lets the request
through rather than blocking it:

```js
if (error) {
  // over it -- let the request through.
  console.error(`Rate limit check failed for ${action}:`, error);
  return true;   // <-- "fail open"
}
```

`return true` means "allowed." So a broken rate-limit check = no rate
limiting for that request.

**How bad is it?** Low, and this was a deliberate choice: it means a database
hiccup can't take down checkout, Strava, or the survey for real users. The
downside is that someone who could reliably *force* that error would slip
past throttling. On balance, "fail open" is a reasonable default for a
small app where availability matters more than perfect throttling.

### Options (pick based on appetite, no rush)
- **Leave it.** Defensible. Just be aware of the trade-off.
- **Fail open only for user-facing actions, closed for sensitive ones.**
  The most sensitive endpoint that leans on this is `admin-invite`. You
  could pass a flag through `checkRateLimit(...)` so that `admin-invite`
  (and only it) treats a limiter error as "block" (`return false`) while
  everything else keeps failing open. That keeps real riders unaffected
  while making the account-creation endpoint stricter.
- **Add basic alerting.** Regardless of the above, it's worth knowing *if*
  this error ever actually fires. The `console.error` already logs it; a
  once-over of Vercel logs (or a log alert) after launch tells you whether
  this is even a real-world concern.

### If you implement the per-action version
In `api/_rateLimit.js`, add an option like `failClosed` to the function's
last argument, and in the `if (error)` block return `!failClosed`. Then in
`api/admin-invite.js`'s `checkRateLimit(...)` call, pass
`failClosed: true` alongside the existing `limit` / `windowSeconds`.

---

## #5 — Strava connect has no CSRF "state" check

**Priority: low. Standard OAuth hardening.**

### The situation
When someone connects Strava, the app sends them to Strava to approve, then
Strava sends them back to Trbo with a `?code=...`. Right now the app tells a
real Strava return apart from any other `?code=` on the page using a browser
flag (`sessionStorage`), set in `src/App.jsx`:

```js
sessionStorage.setItem('stravaOAuthPending', '1');   // before redirecting out
...
if (!code || sessionStorage.getItem('stravaOAuthPending') !== '1') return;   // on return
```

The industry-standard OAuth flow adds one more thing: a random one-time
`state` value that goes out with the redirect and must come back unchanged.
It proves the round-trip wasn't tampered with or triggered by someone else
(a "cross-site request forgery" / CSRF protection).

**How bad is it?** Low here. The scope requested is `activity:write` only
(Trbo can post rides, not read private data), and the token exchange happens
server-side. The realistic worst case is a nuisance, not account takeover.
But `state` is the textbook way to do this and is worth adding before the
iOS/App Store submission, where reviewers sometimes look for it.

### The fix (all in `src/App.jsx`, around the Strava connect flow)
1. **Before redirecting out** (where `stravaOAuthPending` is set today):
   generate a random value, stash it, and add it to the Strava URL.
   ```js
   const state = crypto.randomUUID();
   sessionStorage.setItem('stravaOAuthState', state);
   sessionStorage.setItem('stravaOAuthPending', '1');
   // add to the authorize URL:  &state=${encodeURIComponent(state)}
   ```
2. **On return** (the effect that reads `?code=`): also read `?state=` and
   confirm it matches what was stored, then clear it.
   ```js
   const returnedState = params.get('state');
   const savedState = sessionStorage.getItem('stravaOAuthState');
   sessionStorage.removeItem('stravaOAuthState');
   if (!code || sessionStorage.getItem('stravaOAuthPending') !== '1') return;
   if (!returnedState || returnedState !== savedState) return;  // reject mismatch
   ```

That's it — no server change needed, because `api/strava-connect.js` already
verifies the logged-in user before storing any tokens. The `state` check is
purely about making sure the browser round-trip is the one this app started.

---

## Quick reference — files involved

| Item | File(s) |
|------|---------|
| #3a signature length | `api/_emailLink.js` (`sign()`) |
| #3b HTML escaping | `api/survey.js` |
| #4 rate limiter | `api/_rateLimit.js` (+ `api/admin-invite.js` if doing per-action) |
| #5 Strava state | `src/App.jsx` (Strava connect + return effect) |

## Residual note (not in the original five)
While fixing #1, one related leak was left for a future pass: feedback photo
files are still stored under a folder named after the uploader's user id
(`<userId>/<uuid>.jpg`), so the anonymity fix covers the *text* of who wrote
a post but a determined person could still read an author's id out of a
photo's storage path. Fully closing this means changing the storage folder
naming to a random id and reworking the photo-delete rule to match — a bigger
change than #1 itself. Worth doing if the board ever opens beyond trusted
testers; low urgency while it's testers-only.
