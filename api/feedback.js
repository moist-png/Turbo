// Settings-based feedback: a signed-in rider writes in from the Feedback &
// support section of Settings, and it lands as an email in the help@trbo.bike
// inbox. This is the mechanism that replaces the in-app message board once the
// beta ends -- private, one-to-one, and something Hubert can just reply to.
//
// The rider's identity comes from their verified auth token (never a field in
// the request body), so the email always shows who genuinely wrote in, and a
// plain "Reply" in the inbox goes straight back to them.
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './_rateLimit.js';
import { verifyUser } from './_auth.js';
import { sendEmail } from './_resend.js';

const SUPABASE_URL = 'https://wxwdqqjzfrfddqcgkrfv.supabase.co';
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SUPPORT_INBOX = 'help@trbo.bike';
const MAX_MESSAGE = 4000;

// Where the message gets routed in the rider's own words. Keeps triage quick
// without making the rider think hard -- anything unclear is just "Other".
const CATEGORIES = {
  bug: 'Bug / something broken',
  idea: 'Idea / feature request',
  praise: 'Praise',
  other: 'Something else',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ok = await checkRateLimit(supabaseAdmin, req, res, 'feedback', {
    limit: 12,
    windowSeconds: 3600,
  });
  if (!ok) return;

  const verifiedUser = await verifyUser(supabaseAdmin, req);
  if (!verifiedUser) {
    res.status(401).json({ error: 'Please sign in again and retry.' });
    return;
  }

  const { message, category } = req.body || {};
  const trimmed = (message || '').toString().trim();
  if (!trimmed) {
    res.status(400).json({ error: 'Please write a message first.' });
    return;
  }
  const body = trimmed.slice(0, MAX_MESSAGE);
  const catLabel = CATEGORIES[category] || CATEGORIES.other;

  // The rider's display name makes the inbox easier to read; it's a nice-to-
  // have, so a failed lookup just falls back to the email.
  let riderName = '';
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('name')
      .eq('id', verifiedUser.id)
      .maybeSingle();
    riderName = (profile?.name || '').trim();
  } catch { /* non-fatal */ }

  const email = verifiedUser.email || '';
  const who = riderName ? `${riderName} (${email})` : email;

  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#14171A;line-height:1.5;">` +
    `<p style="margin:0 0 4px;"><strong>${escapeHtml(catLabel)}</strong></p>` +
    `<p style="margin:0 0 16px;color:#5a5f66;">From ${escapeHtml(who)}</p>` +
    `<div style="white-space:pre-wrap;border-left:3px solid #2FC5AE;padding:2px 0 2px 14px;">${escapeHtml(body)}</div>` +
    `<hr style="border:none;border-top:1px solid #E3D9C8;margin:20px 0;" />` +
    `<p style="margin:0;color:#8a8f96;font-size:12px;">Sent from Settings &rsaquo; Feedback &amp; support &middot; account ${escapeHtml(verifiedUser.id)}</p>` +
    `</div>`;

  try {
    await sendEmail({
      to: SUPPORT_INBOX,
      subject: `[${catLabel}] Feedback from ${who}`,
      html,
      replyTo: email || undefined,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error sending feedback email:', err);
    res.status(500).json({ error: "Couldn't send that just now. Please try again." });
  }
}
