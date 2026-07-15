// Pushes a completed indoor session to Strava as a manual activity (name,
// duration, and average power/heart rate in the description) so it shows up
// alongside someone's outdoor rides. Refreshes their Strava access token
// first if it's expired, using the stored refresh token.
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './_rateLimit.js';

const SUPABASE_URL = 'https://wxwdqqjzfrfddqcgkrfv.supabase.co';
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function refreshStravaToken(refreshToken) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error('Could not refresh Strava token.');
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // A real rider finishes at most a few rides an hour -- this just stops a
  // script from spamming Strava's activity-upload endpoint through us.
  const ok = await checkRateLimit(supabaseAdmin, req, res, 'strava-upload', {
    limit: 30,
    windowSeconds: 3600,
  });
  if (!ok) return;

  try {
    // Heart rate is deliberately not accepted here. Trbo shows it live but
    // never stores or forwards it, so it is not part of the Strava payload.
    const { userId, name, durationSeconds, date, avgPower, maxPower } = req.body || {};
    if (!userId || !name || !durationSeconds) {
      res.status(400).json({ error: 'Missing required fields.' });
      return;
    }

    const { data: prof } = await supabaseAdmin.from('profiles').select('strava_access_token, strava_refresh_token, strava_token_expires_at').eq('id', userId).maybeSingle();
    if (!prof || !prof.strava_refresh_token) {
      res.status(200).json({ skipped: true }); // not connected to Strava -- nothing to do, not an error
      return;
    }

    let accessToken = prof.strava_access_token;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!prof.strava_token_expires_at || prof.strava_token_expires_at <= nowSeconds + 60) {
      const refreshed = await refreshStravaToken(prof.strava_refresh_token);
      accessToken = refreshed.access_token;
      await supabaseAdmin.from('profiles').update({
        strava_access_token: refreshed.access_token,
        strava_refresh_token: refreshed.refresh_token,
        strava_token_expires_at: refreshed.expires_at,
      }).eq('id', userId);
    }

    const descriptionParts = [];
    if (avgPower != null) descriptionParts.push(`Avg power ${avgPower}W`);
    if (maxPower != null) descriptionParts.push(`Peak power ${maxPower}W`);
    const description = descriptionParts.length ? `Logged from Trbo \u2014 ${descriptionParts.join(' \u00b7 ')}` : 'Logged from Trbo';

    const activityRes = await fetch('https://www.strava.com/api/v3/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        name,
        type: 'VirtualRide',
        start_date_local: date || new Date().toISOString(),
        elapsed_time: durationSeconds,
        description,
        trainer: 1,
      }),
    });
    if (!activityRes.ok) {
      const errBody = await activityRes.text();
      console.error('Strava activity creation failed:', errBody);
      res.status(200).json({ uploaded: false }); // don't fail the whole session-save over a Strava hiccup
      return;
    }

    res.status(200).json({ uploaded: true });
  } catch (err) {
    console.error('Error uploading to Strava:', err);
    res.status(200).json({ uploaded: false }); // never let a Strava failure block the rider's own saved history
  }
}
