// Exchanges a Strava OAuth "code" (from the redirect after someone approves
// the connection) for real access/refresh tokens, then stores those tokens
// on that person's profile row using the service role key -- so the tokens
// never have to pass through or live in the browser.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://wxwdqqjzfrfddqcgkrfv.supabase.co';
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { userId, code, disconnect } = req.body || {};
    if (!userId) {
      res.status(400).json({ error: 'Missing userId.' });
      return;
    }

    if (disconnect) {
      await supabaseAdmin.from('profiles').update({
        strava_athlete_id: null, strava_access_token: null, strava_refresh_token: null, strava_token_expires_at: null,
      }).eq('id', userId);
      res.status(200).json({ disconnected: true });
      return;
    }

    if (!code) {
      res.status(400).json({ error: 'Missing code.' });
      return;
    }

    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('Strava token exchange failed:', tokenData);
      res.status(400).json({ error: 'Strava didn\u2019t accept that connection. Please try again.' });
      return;
    }

    await supabaseAdmin.from('profiles').update({
      strava_athlete_id: String(tokenData.athlete?.id || ''),
      strava_access_token: tokenData.access_token,
      strava_refresh_token: tokenData.refresh_token,
      strava_token_expires_at: tokenData.expires_at,
    }).eq('id', userId);

    res.status(200).json({ connected: true });
  } catch (err) {
    console.error('Error connecting Strava:', err);
    res.status(500).json({ error: 'Could not connect to Strava. Please try again.' });
  }
}
