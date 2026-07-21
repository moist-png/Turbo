// A working way to get a specific person into Trbo while public signups
// stay paused (see supabase-setup.sql / the GDPR Article 27 note).
//
// The dashboard's "Invite" button and the client-side signUp() call both
// go through Supabase's "Allow new users to sign up" switch -- which is
// exactly the switch that's turned off right now, so both are blocked.
// admin.createUser() is a different code path in Supabase's own Auth
// server: it isn't gated by that switch, only by the Email provider being
// enabled at all (which it is, since the whole app runs on email auth).
// So this creates the account directly, then hands back a one-click
// sign-in link to send the person yourself -- no confirmation email, no
// dependency on Supabase's or Resend's mail sending at all.
//
// If comp_access is requested, it's set directly here rather than trusted
// from the browser, matching how it's protected everywhere else in the
// app (see supabase-setup.sql -- comp_access can't be written by a client
// with just the anon key).
import { randomUUID, timingSafeEqual } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './_rateLimit.js';

const SUPABASE_URL = 'https://wxwdqqjzfrfddqcgkrfv.supabase.co';
const SITE_URL = 'https://trbo.bike';
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Constant-time compare -- an ordinary === leaks how many leading
// characters matched via response timing, which is what makes a secret
// guessable byte by byte. Length check first: timingSafeEqual requires
// equal-length buffers, and length isn't a secret.
function secretsMatch(candidate, secret) {
  if (typeof candidate !== 'string' || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorized(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.authorization || '';
  const headerOk = authHeader.startsWith('Bearer ') && secretsMatch(authHeader.slice(7), secret);
  // The body channel stays -- public/admin-invite.html depends on it and
  // both channels travel over HTTPS.
  const bodyOk = secretsMatch(req.body?.secret, secret);
  return headerOk || bodyOk;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!authorized(req)) {
    res.status(401).json({ error: 'Not authorized.' });
    return;
  }

  // This is a single-operator tool, not a public endpoint -- the limit
  // just stops a leaked/guessed secret from being hammered into a mass
  // account-creation script, not everyday use.
  const ok = await checkRateLimit(supabaseAdmin, req, res, 'admin-invite', {
    limit: 20,
    windowSeconds: 3600,
    // Admin endpoint: if the limiter itself is broken, block rather than
    // let requests through unlimited (see _rateLimit.js).
    failClosed: true,
  });
  if (!ok) return;

  const email = (req.body?.email || '').trim().toLowerCase();
  const compAccess = !!req.body?.compAccess;

  if (!email || !email.includes('@')) {
    res.status(400).json({ error: "That doesn't look like a valid email address." });
    return;
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    // Never actually used -- they sign in via the link below, not a
    // password. Just satisfies the field.
    password: randomUUID() + randomUUID(),
  });

  if (createError) {
    const alreadyExists = createError.status === 422 || /already/i.test(createError.message || '');
    res.status(alreadyExists ? 409 : 500).json({ error: createError.message });
    return;
  }

  if (compAccess) {
    const { error: compError } = await supabaseAdmin
      .from('profiles')
      .update({ comp_access: true })
      .eq('id', created.user.id);
    if (compError) {
      console.error('Created user but failed to set comp_access:', compError);
    }
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: SITE_URL },
  });

  if (linkError || !linkData?.properties?.action_link) {
    // Don't leave a confirmed, unreachable account behind -- roll it back
    // so a retry doesn't hit "already registered".
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    console.error('Created user but failed to generate sign-in link:', linkError);
    res.status(500).json({
      error: 'Created the account but could not build a sign-in link, so it was rolled back. Try again.',
    });
    return;
  }

  res.status(200).json({
    email,
    compAccess,
    loginLink: linkData.properties.action_link,
  });
}
