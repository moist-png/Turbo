// This runs on Vercel's servers, never in the user's browser \u2014 that's why
// it's allowed to use the Stripe *secret* key (set as an environment
// variable in the Vercel project settings, never written into this file).
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Keep these two in sync with MONTHLY_PRICE_LABEL / ANNUAL_PRICE_LABEL in src/App.jsx.
const MONTHLY_PRICE_CENTS = 799; // $7.99/month
const ANNUAL_PRICE_CENTS = 7999; // $79.99/year (about 2 months free vs monthly)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { userId, email, plan } = req.body || {};
    if (!userId || !email) {
      res.status(400).json({ error: 'Missing userId or email.' });
      return;
    }
    const isAnnual = plan === 'annual';

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      // We stash the Supabase user id here so the webhook knows whose
      // "profiles" row to mark as subscribed once payment succeeds.
      client_reference_id: userId,
      // Lets someone enter a coupon/promotion code on Stripe's checkout page.
      // Create the actual codes any time in the Stripe Dashboard under
      // Product catalog -> Coupons -- nothing else here needs to change.
      allow_promotion_codes: true,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: isAnnual ? 'Trbo \u2014 Annual plan' : 'Trbo \u2014 Monthly plan' },
            unit_amount: isAnnual ? ANNUAL_PRICE_CENTS : MONTHLY_PRICE_CENTS,
            recurring: { interval: isAnnual ? 'year' : 'month' },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
}
