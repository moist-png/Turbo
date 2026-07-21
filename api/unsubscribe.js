// Unsubscribe from the email sequences. Two steps on purpose: the link in
// the email (a GET) only shows a confirmation page, and the actual opt-out
// happens on the button press (a POST). Corporate email scanners auto-fetch
// every link in an email to check it for malware -- if the GET acted
// immediately, those scanners would silently unsubscribe people who never
// clicked anything. Scanners follow links but don't press buttons.
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './_rateLimit.js';
import { verify, unsubPayload } from './_emailLink.js';
import { pageShell, pageH1, pageP } from './_emailTemplates.js';

const SUPABASE_URL = 'https://wxwdqqjzfrfddqcgkrfv.supabase.co';
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Anything from the URL that lands inside generated HTML gets escaped
// first, so a crafted link can't smuggle markup into the page.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function badLinkPage(res) {
  res.status(403).send(pageShell(pageH1('Hmm.') + pageP('That link looks like it\u2019s been altered.')));
}

export default async function handler(req, res) {
  const ok = await checkRateLimit(supabaseAdmin, req, res, 'unsubscribe', { limit: 20, windowSeconds: 3600 });
  if (!ok) return;

  res.setHeader('Content-Type', 'text/html');

  if (req.method === 'GET') {
    const { uid, sig } = req.query || {};
    if (!uid || !verify(unsubPayload(uid), sig)) return badLinkPage(res);

    // Confirmation page only -- no database change yet. The same signed
    // uid/sig pair rides along as hidden fields and is verified again on
    // the POST, so the button press proves the same thing the link did.
    res.status(200).send(pageShell(
      pageH1('Unsubscribe from Trbo emails?') +
      pageP('Press the button below and you won\u2019t get any more emails from this sequence. You can still use Trbo as normal.') +
      `<form method="POST" action="/api/unsubscribe">` +
      `<input type="hidden" name="uid" value="${escapeHtml(uid)}" />` +
      `<input type="hidden" name="sig" value="${escapeHtml(sig)}" />` +
      `<button type="submit" style="background:#2FC5AE;color:#14171A;border:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;cursor:pointer;">Unsubscribe me</button>` +
      `</form>`
    ));
    return;
  }

  if (req.method === 'POST') {
    const { uid, sig } = req.body || {};
    if (!uid || !verify(unsubPayload(uid), sig)) return badLinkPage(res);

    const { error } = await supabaseAdmin.from('profiles').update({ email_opt_out: true }).eq('id', uid);
    if (error) {
      console.error('Error unsubscribing:', error);
      res.status(500).send(pageShell(pageH1('Something went wrong') + pageP('Please try again in a bit.')));
      return;
    }

    res.status(200).send(pageShell(pageH1('You\u2019re unsubscribed') + pageP('You won\u2019t get any more emails from this sequence. You can still use Trbo as normal.')));
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
