// This runs on Vercel's servers, never in the user's browser \u2014 that's why
// it's allowed to use the Stripe *secret* key (set as an environment
// variable in the Vercel project settings, never written into this file).
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const MONTHLY_PRICE_CENTS = 799; // $7.99 \u2014 keep this in sync with MONTHLY_PRICE_LABEL in src/App.jsx

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { userId, email } = req.body || {};
    if (!userId || !email) {
      res.status(400).json({ error: 'Missing userId or email.' });
      return;
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      // We stash the Supabase user id here so the webhook knows whose
      // "profiles" row to mark as subscribed once payment succeeds.
      client_reference_id: userId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Turbo Trainer \u2014 Monthly plan' },
            unit_amount: MONTHLY_PRICE_CENTS,
            recurring: { interval: 'month' },
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
