// Handles every click coming out of the trial-abandonment survey email.
// Nobody is signed in when this runs -- it's a cold click from an email,
// possibly weeks after their session expired -- so identity comes entirely
// from the signed link (see _emailLink.js), not from auth.
//
//   GET  ?uid&answer&sig        -- records the one-click primary reason,
//                                  shows an optional tailored follow-up
//   GET  ?uid&checkin=yes|no&sig -- records the "check back in?" choice
//   POST { uid, fsig, detail }  -- records the optional free-text follow-up
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './_rateLimit.js';
import { verify, surveyPayload, followupPayload, followupSig, checkinPayload, checkinLink } from './_emailLink.js';
import { SURVEY_ANSWERS, pageShell, pageP, pageH1, pageButton } from './_emailTemplates.js';

const SUPABASE_URL = 'https://wxwdqqjzfrfddqcgkrfv.supabase.co';
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Anything that arrived in the URL and lands inside generated HTML gets
// escaped first, so a crafted link can't smuggle markup into the page.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function errorPage(res, status, message) {
  res.status(status).setHeader('Content-Type', 'text/html');
  res.send(pageShell(pageH1('Hmm.') + pageP(message)));
}

export default async function handler(req, res) {
  const ok = await checkRateLimit(supabaseAdmin, req, res, 'survey', { limit: 40, windowSeconds: 3600 });
  if (!ok) return;

  if (req.method === 'GET') {
    const { uid, answer, checkin, sig } = req.query || {};
    if (!uid) return errorPage(res, 400, 'That link is missing some information.');

    // ---- path 1: the "check back in?" yes/no choice ----
    if (checkin === 'yes' || checkin === 'no') {
      if (!verify(checkinPayload(uid, checkin), sig)) return errorPage(res, 403, 'That link looks like it\u2019s been altered.');
      await supabaseAdmin.from('trial_survey_responses')
        .update({ followup_detail: checkin === 'yes' ? 'checkin_yes' : 'checkin_no', followup_at: new Date().toISOString() })
        .eq('user_id', uid);
      res.setHeader('Content-Type', 'text/html');
      res.send(pageShell(pageH1('Got it') + pageP(
        checkin === 'yes' ? 'We\u2019ll check back in with you in a couple of months. Thanks for the heads up.' : 'No worries — thanks for letting us know.'
      )));
      return;
    }

    // ---- path 2: the primary one-click answer ----
    const validAnswer = SURVEY_ANSWERS.find(a => a.key === answer);
    if (!validAnswer) return errorPage(res, 400, 'That answer wasn\u2019t recognized.');
    if (!verify(surveyPayload(uid, answer), sig)) return errorPage(res, 403, 'That link looks like it\u2019s been altered.');

    const { error } = await supabaseAdmin.from('trial_survey_responses')
      .upsert({ user_id: uid, primary_reason: answer, responded_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) { console.error('Error saving survey response:', error); return errorPage(res, 500, 'Something went wrong saving that. Sorry!'); }

    res.setHeader('Content-Type', 'text/html');

    if (validAnswer.key === 'not_right_time') {
      res.send(pageShell(
        pageH1('Thanks for letting us know') +
        pageP('Would it help if we checked back in with you in a couple of months?') +
        `<div style="display:flex;gap:10px;">` +
        pageButton('Yes, check in with me', checkinLink(uid, 'yes')) +
        pageButton('No thanks', checkinLink(uid, 'no')) +
        `</div>`
      ));
      return;
    }

    res.send(pageShell(
      pageH1('Thanks — noted') +
      pageP(validAnswer.prompt + ' (totally optional)') +
      `<form method="POST" action="/api/survey">` +
      `<input type="hidden" name="uid" value="${escapeHtml(uid)}" />` +
      `<input type="hidden" name="fsig" value="${followupSig(uid)}" />` +
      `<textarea name="detail" rows="3" maxlength="500" style="width:100%;box-sizing:border-box;border:1px solid #E3D9C8;border-radius:8px;padding:10px;font-size:14px;font-family:Arial,Helvetica,sans-serif;"></textarea>` +
      `<div style="margin-top:10px;"><button type="submit" style="background:#2FC5AE;color:#14171A;border:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;cursor:pointer;">Send</button></div>` +
      `</form>`
    ));
    return;
  }

  if (req.method === 'POST') {
    const { uid, fsig, detail } = req.body || {};
    if (!uid || !verify(followupPayload(uid), fsig)) return errorPage(res, 403, 'That link looks like it\u2019s been altered.');

    await supabaseAdmin.from('trial_survey_responses')
      .update({ followup_detail: (detail || '').slice(0, 500), followup_at: new Date().toISOString() })
      .eq('user_id', uid);

    res.setHeader('Content-Type', 'text/html');
    res.send(pageShell(pageH1('Thanks!') + pageP('Really appreciate you taking the time.')));
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
