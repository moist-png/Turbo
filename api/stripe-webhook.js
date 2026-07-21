// Stripe calls this URL directly (never the user's browser) whenever a
// payment or subscription event happens. We verify the request really came
// from Stripe using STRIPE_WEBHOOK_SECRET, then update the matching row in
// Supabase using the "service_role" key \u2014 which is why that key must only
// ever live here, as a Vercel environment variable, and never in src/.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Vercel would otherwise parse the request body as JSON, but Stripe's
// signature check needs the exact raw, unparsed bytes \u2014 so we turn that off
// and read the raw body ourselves below.
export const config = {
  api: { bodyParser: false },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Same public project URL that's already in src/supabaseClient.js.
const SUPABASE_URL = 'https://wxwdqqjzfrfddqcgkrfv.supabase.co';
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      // Fired the moment someone finishes paying on Stripe's checkout page.
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        if (userId) {
          await supabaseAdmin
            .from('profiles')
            .update({
              subscribed: true,
              stripe_customer_id: session.customer,
              stripe_subscription_id: session.subscription,
            })
            .eq('id', userId);
        }
        break;
      }
      // Fired later on renewals, failed payments, or cancellations \u2014 keeps
      // the "subscribed" flag accurate for the life of the subscription.
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        // past_due is included on purpose: it means a renewal charge failed
        // and Stripe is still retrying the card. Keeping access during that
        // window turns Stripe's smart retries into a grace period, instead
        // of cutting someone off the instant a card expires. If the retries
        // all fail, the status moves to canceled/unpaid and this same
        // handler flips access off then.
        const isActive = ['active', 'trialing', 'past_due'].includes(subscription.status);
        await supabaseAdmin
          .from('profiles')
          .update({ subscribed: isActive })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }
      default:
        break; // other event types aren't relevant to this app
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error handling webhook event:', err);
    res.status(500).send('Webhook handler failed');
  }
}
