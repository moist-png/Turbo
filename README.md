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
- A monthly subscription paywall (the payment form itself is still a
  placeholder \u2014 no real card processor is connected yet)
- Every user's FTP, settings, custom workouts, and FTP test history are
  saved to their own private rows in the database

## Files
- `src/App.jsx` \u2014 the whole app
- `src/supabaseClient.js` \u2014 your Supabase connection details
- `supabase-setup.sql` \u2014 the database setup script (already run, kept here for reference)
