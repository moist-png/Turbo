// Survey answers and unsubscribes are clicked straight out of an email --
// nobody's signed in when that happens, often days or weeks after their
// session expired. Rather than pre-generating and storing a token for every
// person before every send, these links carry a signature (HMAC, using
// EMAIL_LINK_SECRET -- set once in Vercel's project environment variables,
// value is unrelated to any third-party account so it's fine for this file
// to generate its own) that proves the link came from an email Trbo
// actually sent, without needing a database lookup just to know who
// clicked.
import crypto from 'crypto';

// No fallback value on purpose: if the env var ever went missing in
// production, a hardcoded fallback would make every link forgeable by
// anyone who's read this file. A loud crash (these endpoints 500) is
// strictly better than silently accepting forged links.
const SECRET = process.env.EMAIL_LINK_SECRET;
if (!SECRET) throw new Error('EMAIL_LINK_SECRET is not set');
const SITE = 'https://trbo.bike';

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

// Constant-time compare -- an ordinary === would leak timing information
// about how many leading characters matched, which is exactly the kind of
// thing that makes a signature guessable byte by byte.
export function verify(payload, sig) {
  if (!sig || typeof sig !== 'string') return false;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function surveyPayload(userId, answer) {
  return `survey:${userId}:${answer}`;
}
export function followupPayload(userId) {
  return `followup:${userId}`;
}
export function checkinPayload(userId, value) {
  return `checkin:${userId}:${value}`;
}
export function unsubPayload(userId) {
  return `unsub:${userId}`;
}

export function surveyLink(userId, answer) {
  const sig = sign(surveyPayload(userId, answer));
  return `${SITE}/api/survey?uid=${userId}&answer=${encodeURIComponent(answer)}&sig=${sig}`;
}
export function followupSig(userId) {
  return sign(followupPayload(userId));
}
export function checkinLink(userId, value) {
  const sig = sign(checkinPayload(userId, value));
  return `${SITE}/api/survey?uid=${userId}&checkin=${value}&sig=${sig}`;
}
export function unsubscribeLink(userId) {
  const sig = sign(unsubPayload(userId));
  return `${SITE}/api/unsubscribe?uid=${userId}&sig=${sig}`;
}
