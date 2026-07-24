// A working way to get a specific person into Trbo while public signups
// stay paused (see supabase-setup.sql / the GDPR Article 27 note) -- and
// one they can reuse for weeks or months of testing, not just once.
//
// WHY EMAIL + PASSWORD, NOT A LINK:
// Supabase's sign-in links (magic links, invite links) are single-use by
// design -- there's no way to make one that survives being opened twice,
// and it can even get silently burned before the person ever sees it (a
// messaging app building a link preview is enough). Testers who come back
// over days or weeks need something that doesn't expire, so this creates
// the account with a real password up front and hands both back. From
// then on it's an ordinary login at trbo.bike, no link involved.
//
// This still has to go through admin.createUser() with a metadata flag,
// not a plain client-side signUp() -- the handle_new_user() trigger in
// supabase-setup.sql rejects any new row in auth.users while signups are
// paused unless it's an approved invite. That trigger originally checked
// invited_at alone, but invited_at isn't reliably set on auth.users at
// the moment the row is inserted -- even for genuine Supabase invites --
// so this instead carries an admin_invited flag in user_metadata, which
// (unlike invited_at) is guaranteed present at insert time since it's
// literal data handed to this very call.
//
// If comp_access is requested, it's set directly here rather than trusted
// from the browser, matching how it's protected everywhere else in the
// app (see supabase-setup.sql -- comp_access can't be written by a client
// with just the anon key).
import { randomBytes, timingSafeEqual } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './_rateLimit.js';

const SUPABASE_URL = 'https://wxwdqqjzfrfddqcgkrfv.supabase.co';
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

// base64url has no characters that get mangled by double-clicking to
// select, by chat apps auto-linking things, or by a stray line-wrap --
// friendlier to copy/paste around than a raw random string with symbols.
function generatePassword() {
  return randomBytes(9).toString('base64url'); // 12 characters
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

  const password = generatePassword();

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { admin_invited: true },
  });

  if (createError) {
    const alreadyExists = createError.status === 422 || /already/i.test(createError.message || '');
    res.status(alreadyExists ? 409 : 500).json({
      error: alreadyExists
        ? 'That email already has a Trbo account. This tool only creates new ones -- to give them a fresh password instead, use the Supabase Dashboard (Authentication -> Users, find them, "Send password reset").'
        : (createError.message || 'Could not create the account (no further detail from Supabase).'),
    });
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

  res.status(200).json({ email, password, compAccess });
}
