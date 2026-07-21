// Pause or resume a membership -- the "seasonal rider" feature. Someone who
// stops training over winter can stop being billed without losing their
// account, their history, or their training plan.
//
// How the pause works, and why it's built this way:
//   * Pausing sets `pause_collection` on the Stripe subscription with
//     behavior 'void'. Stripe stops charging the card and voids the
//     invoices it would otherwise raise. Nothing is cancelled, so resuming
//     is a single call rather than a fresh checkout.
//   * A paused subscription's status in Stripe stays "active". That means
//     the status check in the webhook cannot be trusted on its own -- see
//     the pause columns it writes, and the access rule in src/App.jsx.
//   * The rider keeps access until the period they've already paid for runs
//     out, then it lapses. That's the fair reading of "I paid for this
//     month" and it avoids the ugly case of pausing on day 2 of a billing
//     month and losing 28 paid days.
//
// Stripe's Customer Portal deliberately does NOT let subscribers pause
// themselves, which is why this exists as our own endpoint rather than a
// portal setting.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './_rateLimit.js';
import { verifyUser } from './_auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SUPABASE_URL = 'https://wxwdqqjzfrfddqcgkrfv.supabase.co';
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function periodEndIso(subscription) {
  // Stripe moved current_period_end onto subscription items in newer API
  // versions; accept either shape rather than assuming one.
  const seconds =
    subscription.current_period_end ??
    subscription.items?.data?.[0]?.current_period_end ??
    null;
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ok = await checkRateLimit(supabaseAdmin, req, res, 'pause-subscription', {
    limit: 10,
    windowSeconds: 3600,
  });
  if (!ok) return;

  const verifiedUser = await verifyUser(supabaseAdmin, req);
  if (!verifiedUser) {
    res.status(401).json({ error: 'Please sign in again and retry.' });
    return;
  }

  const { action } = req.body || {};
  if (action !== 'pause' && action !== 'resume') {
    res.status(400).json({ error: 'Unknown action.' });
    return;
  }

  try {
    // The subscription id is read from the rider's own profile row, never
    // taken from the request -- so nobody can pause somebody else's
    // membership by sending a different id.
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('stripe_subscription_id')
      .eq('id', verifiedUser.id)
      .maybeSingle();

    if (profErr) throw profErr;
    if (!profile?.stripe_subscription_id) {
      res.status(404).json({ error: 'No paid membership found on this account.' });
      return;
    }

    const subscription = await stripe.subscriptions.update(profile.stripe_subscription_id, {
      pause_collection: action === 'pause' ? { behavior: 'void' } : null,
    });

    // The webhook will write these too, but writing them here means the
    // rider sees the change immediately instead of waiting on a round trip
    // from Stripe.
    const paidThrough = periodEndIso(subscription);
    const update = { subscription_paused: action === 'pause' };
    if (paidThrough) update.subscription_paid_through = paidThrough;

    await supabaseAdmin.from('profiles').update(update).eq('id', verifiedUser.id);

    res.status(200).json({ paused: action === 'pause', paidThrough });
  } catch (err) {
    console.error(`Error trying to ${action} subscription:`, err);
    res.status(500).json({ error: `Could not ${action} your membership. Please try again.` });
  }
}
