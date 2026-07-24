// Thin wrapper around Resend's REST API -- no SDK dependency, just fetch,
// same style as the plain fetch() calls in strava-connect.js.
//
// RESEND_API_KEY and RESEND_FROM_EMAIL are both set in Vercel's project
// environment variables once the Resend account exists and trbo.bike is
// verified as a sending domain there. Until then, sendEmail() below skips
// the actual send and just logs what it would have sent, so the rest of
// the sequence (logging, skipping already-sent emails, etc.) still runs
// and can be tested end to end before a real key exists.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Trbo <hello@trbo.bike>';

export async function sendEmail({ to, subject, html, replyTo, attachments }) {
  if (!RESEND_API_KEY) {
    console.warn(`RESEND_API_KEY not set -- skipping send to ${to}: "${subject}"`);
    return { skipped: true };
  }

  // reply_to lets a support message land in the inbox from our verified
  // sending domain (so it's actually delivered) while a plain "Reply" still
  // goes straight back to the rider who wrote in.
  const payload = { from: FROM_EMAIL, to, subject, html };
  if (replyTo) payload.reply_to = replyTo;
  // Resend wants each attachment as { filename, content: <base64 string> }.
  // Used by the Settings feedback form to attach a screenshot or two.
  if (attachments && attachments.length) payload.attachments = attachments;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${errText}`);
  }
  return res.json();
}
