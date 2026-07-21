// Shared rate limiter for the api/*.js functions below. These functions run
// on Vercel, not in the browser, but Vercel's servers don't remember
// anything between requests -- each call is a fresh instance. So instead of
// counting requests in memory (which would forget everything a second
// later), this counts them in the same Supabase database these functions
// already talk to, using the "bump_rate_limit" function set up in
// supabase-setup.sql. That keeps the count durable and shared across every
// server Vercel happens to run this on.
//
// This limits by network address (IP), not by account -- unlike the
// database triggers in supabase-setup.sql, these three endpoints don't
// verify who's actually calling them (they trust whatever userId is in the
// request body), so an IP-based limit is the one that actually can't be
// talked around by just changing that field.

export async function checkRateLimit(supabaseAdmin, req, res, action, { limit, windowSeconds, failClosed = false }) {
  const forwardedFor = req.headers['x-forwarded-for'] || '';
  const ip = forwardedFor.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

  const { data: allowed, error } = await supabaseAdmin.rpc('bump_rate_limit', {
    p_bucket: `${action}:ip:${ip}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    // If the rate limiter itself fails, the default is to let the request
    // through -- taking down surveys or unsubscribes because the counter
    // hiccuped would hurt more than it protects (a deliberate availability
    // choice). The exception is anything admin-grade: those pass
    // failClosed: true, because there a broken limiter should block, not
    // wave requests past the one guardrail on a powerful endpoint.
    console.error(`Rate limit check failed for ${action}:`, error);
    if (failClosed) {
      res.status(503).json({ error: 'Temporarily unavailable. Please try again shortly.' });
      return false;
    }
    return true;
  }

  if (!allowed) {
    res.status(429).json({ error: 'Too many requests. Please wait a bit and try again.' });
    return false;
  }

  return true;
}
