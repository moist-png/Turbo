// Creates a Stripe Customer Portal session so a subscriber can manage their
// own membership -- update the card on file, see invoices, or cancel --
// without emailing support. Runs on Vercel's servers, so it's allowed to use
// the Stripe secret key.
//
// Note on the customer id: it's read here server-side from the profiles row,
// never accepted from the browser. stripe_customer_id is deliberately absent
// from PROFILE_COLUMNS in src/App.jsx, so the client never sees it and can't
// ask for a portal session belonging to somebody else.
//
// Dashboard prerequisite: the portal has to be activated once at
// https://dashboard.stripe.com/settings/billing/portal -- until then Stripe
// rejects session creation for want of a configuration. That case is caught
// below and reported clearly rather than as a generic failure.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './_rateLimit.js';
import { verifyUser } from './_auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SUPABASE_URL = 'https://wxwdqqjzfrfddqcgkrfv.supabase.co';
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ok = await checkRateLimit(supabaseAdmin, req, res, 'customer-portal', {
    limit: 10,
    windowSeconds: 3600,
  });
  if (!ok) return;

  const verifiedUser = await verifyUser(supabaseAdmin, req);
  if (!verifiedUser) {
    res.status(401).json({ error: 'Please sign in again and retry.' });
    return;
  }

  try {
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', verifiedUser.id)
      .maybeSingle();

    if (profErr) throw profErr;

    // Comped testers and anyone still on the free trial have never been
    // through checkout, so there's no Stripe customer to manage.
    if (!profile?.stripe_customer_id) {
      res.status(404).json({ error: 'No paid membership found on this account.' });
      return;
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/?portal=done`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    // Stripe's own wording for the un-activated portal is developer-facing;
    // translate it so the rider sees something sensible and the real cause
    // still lands in the Vercel logs.
    const notConfigured = typeof err?.message === 'string' && err.message.includes('configuration');
    if (notConfigured) {
      console.error('Customer portal is not activated in the Stripe Dashboard:', err.message);
      res.status(500).json({ error: 'Subscription management is not available yet. Please contact support.' });
      return;
    }
    console.error('Error creating customer portal session:', err);
    res.status(500).json({ error: 'Could not open subscription management. Please try again.' });
  }
}
