// Runs once a day (see the "crons" entry in vercel.json). For every person
// created in roughly the last two weeks, works out which track they're on
// (still trialing / trial lapsed without converting / subscribed-or-comped)
// and whether today happens to be one of that track's send days -- then
// sends that one email, if it hasn't already gone out.
//
// Safe to trigger more than once on the same day: email_sequence_log keeps
// a permanent (user, sequence) record, so a re-run just skips everything
// already sent.
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from './_resend.js';
import { buildEmail, SURVEY_ANSWERS } from './_emailTemplates.js';
import { surveyLink, unsubscribeLink } from './_emailLink.js';

const SUPABASE_URL = 'https://wxwdqqjzfrfddqcgkrfv.supabase.co';
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = [0, 3, 6, 7];
const NONCONVERT_DAYS = [8, 11, 14];
const SUB_DAYS = [0, 3, 9, 14];

export default async function handler(req, res) {
  // Vercel's own scheduler sends this as a Bearer header automatically.
  // Also accept it as a ?secret= query param so this can be triggered
  // manually (from a browser, or a tool that can't set custom headers) for
  // testing -- same secret either way, just a second channel to present it.
  const authHeader = req.headers.authorization || '';
  const headerOk = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const queryOk = !!process.env.CRON_SECRET && req.query?.secret === process.env.CRON_SECRET;
  if (!headerOk && !queryOk) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const summary = { sent: 0, skipped: 0, notConfigured: 0, errors: 0 };

  try {
    const cutoff = new Date(Date.now() - 15 * DAY_MS).toISOString();
    const { data: profiles, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('id, name, created_at, subscribed, comp_access, comp_expires_at, email_opt_out')
      .gte('created_at', cutoff);
    if (profErr) throw profErr;

    for (const profile of profiles || []) {
      try {
        if (profile.email_opt_out) { summary.skipped++; continue; }

        const daysSince = Math.floor((Date.now() - new Date(profile.created_at).getTime()) / DAY_MS);
        if (daysSince > 14) { summary.skipped++; continue; }

        const isSubscribed = !!profile.subscribed;
        const isTesterComp = !!profile.comp_access || (profile.comp_expires_at && new Date(profile.comp_expires_at).getTime() > Date.now());

        let track, days;
        if (isSubscribed || isTesterComp) { track = 'sub'; days = SUB_DAYS; }
        else if (daysSince <= 7) { track = 'trial'; days = TRIAL_DAYS; }
        else { track = 'nonconvert'; days = NONCONVERT_DAYS; }

        if (!days.includes(daysSince)) { summary.skipped++; continue; }
        const sequenceKey = `${track}_day${daysSince}`;

        const { data: already } = await supabaseAdmin
          .from('email_sequence_log')
          .select('id')
          .eq('user_id', profile.id)
          .eq('sequence_key', sequenceKey)
          .maybeSingle();
        if (already) { summary.skipped++; continue; }

        // trial_day3 only fires for people who genuinely haven't ridden yet.
        if (sequenceKey === 'trial_day3') {
          const { count } = await supabaseAdmin.from('workout_history').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).eq('completed', true);
          if (count > 0) { summary.skipped++; continue; }
        }

        const { data: userRes, error: userErr } = await supabaseAdmin.auth.admin.getUserById(profile.id);
        if (userErr || !userRes?.user?.email) { summary.errors++; continue; }
        const email = userRes.user.email;
        const firstName = (profile.name || '').trim().split(' ')[0] || 'there';

        const ctx = {
          firstName,
          isTester: isTesterComp && !isSubscribed,
          unsubscribeUrl: unsubscribeLink(profile.id),
        };

        if (sequenceKey === 'nonconvert_day8') {
          ctx.surveyLinks = {};
          for (const a of SURVEY_ANSWERS) ctx.surveyLinks[a.key] = surveyLink(profile.id, a.key);
        }
        if (sequenceKey === 'nonconvert_day11') {
          const { data: surveyRow } = await supabaseAdmin.from('trial_survey_responses').select('primary_reason').eq('user_id', profile.id).maybeSingle();
          ctx.surveyReason = surveyRow?.primary_reason || null;
        }
        if (sequenceKey === 'sub_day14') {
          const { count } = await supabaseAdmin.from('workout_history').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).eq('completed', true).gte('date', new Date(Date.now() - 14 * DAY_MS).toISOString());
          ctx.recentRideCount = count || 0;
        }

        const template = buildEmail(sequenceKey, ctx);
        if (!template) { summary.skipped++; continue; }

        const result = await sendEmail({ to: email, subject: template.subject, html: template.html });
        if (result?.skipped) {
          // No RESEND_API_KEY configured yet -- don't log this as sent, or
          // this person would silently never get this email once the real
          // key does go in, since the log would already say it went out.
          summary.notConfigured++;
          continue;
        }
        await supabaseAdmin.from('email_sequence_log').insert({ user_id: profile.id, sequence_key: sequenceKey });
        summary.sent++;
      } catch (innerErr) {
        console.error(`Error processing profile ${profile.id}:`, innerErr);
        summary.errors++;
      }
    }

    res.status(200).json({ ok: true, checked: (profiles || []).length, ...summary });
  } catch (err) {
    console.error('email-sequence-cron failed:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
