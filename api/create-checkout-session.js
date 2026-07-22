// This runs on Vercel's servers, never in the user's browser \u2014 that's why
// it's allowed to use the Stripe *secret* key (set as an environment
// variable in the Vercel project settings, never written into this file).
//
// Checkout runs through Stripe Managed Payments: Stripe becomes the
// merchant of record and handles sales tax/VAT/GST calculation, collection,
// and remittance in ~80 countries on our behalf. That means:
//   1. Prices must be pre-created Stripe Price objects (no more building
//      the price inline with price_data) -- see STRIPE_PRICE_MONTHLY /
//      STRIPE_PRICE_ANNUAL below.
//   2. The Checkout Session must be created with managed_payments.enabled
//      and the preview API version that feature requires.
//   3. Managed Payments must be turned on for the Stripe account first, at
//      https://dashboard.stripe.com/settings/managed-payments -- Stripe
//      runs an eligibility review before it's usable. Until that's done,
//      Checkout Sessions created with managed_payments.enabled will fail.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './_rateLimit.js';
import { verifyUser } from './_auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Same project used everywhere else -- only used here to count requests
// for rate limiting, never to read or write anyone's actual data.
const SUPABASE_URL = 'https://wxwdqqjzfrfddqcgkrfv.supabase.co';
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// The Managed Payments preview version this integration was built against.
const MANAGED_PAYMENTS_API_VERSION = '2026-02-25.preview';

// Set these in Vercel's project environment variables once the "Trbo
// Membership" product and its two prices exist in the Stripe Dashboard
// (Product catalog -> Create product). Price IDs look like price_1AbCdE...
// Keep the dollar amounts themselves in sync with MONTHLY_PRICE_LABEL /
// ANNUAL_PRICE_LABEL in src/App.jsx -- $8.99/month, $89.99/year.
const MONTHLY_PRICE_ID = process.env.STRIPE_PRICE_MONTHLY;
const ANNUAL_PRICE_ID = process.env.STRIPE_PRICE_ANNUAL;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Nobody legitimately needs to start more than a handful of checkouts an
  // hour -- this just stops a script from spamming Stripe session creation.
  const ok = await checkRateLimit(supabaseAdmin, req, res, 'create-checkout-session', {
    limit: 10,
    windowSeconds: 3600,
  });
  if (!ok) return;

  // Who's actually signed in, verified against Supabase -- not just
  // whatever userId/email happened to be in the request body. Someone can
  // only ever start a checkout for their own account this way.
  const verifiedUser = await verifyUser(supabaseAdmin, req);
  if (!verifiedUser) {
    res.status(401).json({ error: 'Please sign in again and retry.' });
    return;
  }

  try {
    const { plan } = req.body || {};
    const userId = verifiedUser.id;
    const email = verifiedUser.email;

    // Guard against ending up with two live subscriptions on one account.
    // The way that used to happen: a rider whose membership looked inactive
    // to the app pressed Upgrade, checked out again, and the webhook
    // overwrote stripe_subscription_id -- leaving the first subscription
    // still billing on Stripe but invisible here. We check Stripe itself
    // rather than trusting our own `subscribed` flag, since the whole point
    // is to catch the case where the two have drifted apart.
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_subscription_id')
      .eq('id', userId)
      .maybeSingle();

    if (existingProfile?.stripe_subscription_id) {
      try {
        const existing = await stripe.subscriptions.retrieve(existingProfile.stripe_subscription_id);
        const stillLive = !['canceled', 'incomplete_expired'].includes(existing.status);
        if (stillLive) {
          res.status(409).json({
            error: 'You already have a membership on this account. Open Settings to manage or resume it.',
            alreadySubscribed: true,
          });
          return;
        }
      } catch (lookupErr) {
        // Subscription genuinely gone from Stripe -- fall through and let
        // them subscribe again rather than blocking on a stale id.
        console.error('Ignoring stale stripe_subscription_id during checkout:', lookupErr?.message);
      }
    }

    const isAnnual = plan === 'annual';
    const priceId = isAnnual ? ANNUAL_PRICE_ID : MONTHLY_PRICE_ID;

    if (!priceId) {
      console.error(
        `Missing ${isAnnual ? 'STRIPE_PRICE_ANNUAL' : 'STRIPE_PRICE_MONTHLY'} environment variable.`
      );
      res.status(500).json({ error: 'Checkout is not configured yet. Please try again later.' });
      return;
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer_email: email,
        // We stash the Supabase user id here so the webhook knows whose
        // "profiles" row to mark as subscribed once payment succeeds.
        client_reference_id: userId,
        // Lets someone enter a coupon/promotion code on Stripe's checkout page.
        // Create the actual codes any time in the Stripe Dashboard under
        // Product catalog -> Coupons -- nothing else here needs to change.
        allow_promotion_codes: true,
        line_items: [{ price: priceId, quantity: 1 }],
        // Stripe acts as merchant of record: calculates/collects/remits
        // sales tax, VAT, and GST for us, handles fraud and disputes, and
        // sends receipts/invoices to the customer directly.
        managed_payments: { enabled: true },
        success_url: `${origin}/?checkout=success`,
        cancel_url: `${origin}/?checkout=cancelled`,
      },
      { apiVersion: MANAGED_PAYMENTS_API_VERSION }
    );

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
}
