# Turbo Trainer

This is the Turbo Trainer app, connected to a real Supabase database for
accounts, saved workouts, and FTP history.

## Getting this online (no coding required)

1. Upload this whole folder to a new GitHub repository (drag and drop the
   files on GitHub's "upload an existing file" screen).
2. Go to vercel.com, sign in, click "Add New Project", and import that
   GitHub repository. Vercel automatically detects this is a Vite project
   \u2014 just click Deploy.
3. Once deployed, copy the web address Vercel gives you (something like
   `https://turbo-trainer-yourname.vercel.app`).
4. In Supabase: Authentication \u2192 URL Configuration \u2014 set "Site URL" to
   that address, and add it to "Redirect URLs" too. This makes password
   reset links go to the right place.

## What's already wired up
- Real sign up / log in / log out (Supabase Auth)
- Real "forgot password" emails
- A 7-day free trial that starts the moment someone signs up
- A monthly subscription paywall, now backed by real Stripe payments
- Every user's FTP, settings, custom workouts, and FTP test history are
  saved to their own private rows in the database

## Files
- `src/App.jsx` \u2014 the whole app
- `src/supabaseClient.js` \u2014 your Supabase connection details
- `supabase-setup.sql` \u2014 the database setup script
- `api/create-checkout-session.js` \u2014 server-side code that starts a Stripe payment
- `api/stripe-webhook.js` \u2014 server-side code that marks a user "subscribed" once Stripe confirms payment

## Turning on real payments (Stripe) \u2014 no coding required
1. **Update the database.** In Supabase \u2192 SQL Editor, run the "Stripe
   integration" section near the bottom of `supabase-setup.sql` (if you
   already ran the whole file before, just run that new section \u2014 it's
   safe to run the rest again too).
2. **Create a Stripe account** at stripe.com if you don't have one.
3. **Get your secret key.** In the Stripe Dashboard, go to Developers \u2192
   API keys, and copy the "Secret key" (starts with `sk_`). Keep this
   private \u2014 never share it or put it in this repo.
4. **Get your Supabase service role key.** In Supabase \u2192 Project Settings
   \u2192 API, copy the "service_role" key (this is different from the "anon
   public" key already used in `src/supabaseClient.js` \u2014 keep it private too).
5. **Add both as environment variables in Vercel.** In your Vercel project
   \u2192 Settings \u2192 Environment Variables, add:
   - `STRIPE_SECRET_KEY` \u2014 the key from step 3
   - `SUPABASE_SERVICE_ROLE_KEY` \u2014 the key from step 4
   - `STRIPE_WEBHOOK_SECRET` \u2014 leave a placeholder for now, you'll fill this in during step 7
6. **Redeploy** the project in Vercel so it picks up the new environment
   variables (Deployments \u2192 the three dots on the latest one \u2192 Redeploy).
7. **Connect the webhook.** In the Stripe Dashboard, go to Developers \u2192
   Webhooks \u2192 Add endpoint. Set the URL to
   `https://your-vercel-url.vercel.app/api/stripe-webhook` (use your real
   Vercel address), and select these events: `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Once
   created, Stripe shows you a "Signing secret" (starts with `whsec_`) \u2014
   copy it into the `STRIPE_WEBHOOK_SECRET` variable in Vercel from step 5,
   then redeploy one more time.
8. **Test it.** Stripe starts you in "test mode" (toggle in the top right
   of the dashboard) \u2014 use the test card number `4242 4242 4242 4242`, any
   future expiry date, and any 3-digit CVC. Once you've confirmed a test
   subscription works end-to-end, flip Stripe to "live mode" and repeat
   steps 3\u20137 with your live keys to start taking real payments.

