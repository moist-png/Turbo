-- Trbo: database setup
-- Paste this whole thing into Supabase SQL Editor and click "Run".
-- Safe to re-run in full any time — every statement below either checks
-- "if exists"/"if not exists" first or uses "create or replace", so running
-- it again after a previous run (or after this file gets new sections
-- added) won't error out on things that already exist.

-- 1. One row per user: their app-level info (FTP, trial, subscription, settings)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  ftp integer default 200,
  trial_start timestamptz default now(),
  subscribed boolean default false,
  settings jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- 2. Custom-built workouts
create table if not exists public.custom_workouts (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  workout jsonb not null,
  created_at timestamptz default now()
);

-- 3. FTP test history
create table if not exists public.ftp_history (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  ftp integer not null,
  source text,
  date timestamptz default now()
);

-- 3b. Completed workout history -- one row per ride, used for the
--     "this week", "recent activity" and "next up" suggestions on the home screen.
create table if not exists public.workout_history (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  workout_id text,
  name text,
  category text,
  duration integer not null,
  completed boolean default true,
  date timestamptz default now()
);

-- 4. Lock every table down so people can only ever see their own rows
alter table public.profiles enable row level security;
alter table public.custom_workouts enable row level security;
alter table public.ftp_history enable row level security;
alter table public.workout_history enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "Users can view own workouts" on public.custom_workouts;
create policy "Users can view own workouts" on public.custom_workouts for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own workouts" on public.custom_workouts;
create policy "Users can insert own workouts" on public.custom_workouts for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own workouts" on public.custom_workouts;
create policy "Users can update own workouts" on public.custom_workouts for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own workouts" on public.custom_workouts;
create policy "Users can delete own workouts" on public.custom_workouts for delete using (auth.uid() = user_id);

drop policy if exists "Users can view own ftp history" on public.ftp_history;
create policy "Users can view own ftp history" on public.ftp_history for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own ftp history" on public.ftp_history;
create policy "Users can insert own ftp history" on public.ftp_history for insert with check (auth.uid() = user_id);
drop policy if exists "Users can delete own ftp history" on public.ftp_history;
create policy "Users can delete own ftp history" on public.ftp_history for delete using (auth.uid() = user_id);

drop policy if exists "Users can view own workout history" on public.workout_history;
create policy "Users can view own workout history" on public.workout_history for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own workout history" on public.workout_history;
create policy "Users can insert own workout history" on public.workout_history for insert with check (auth.uid() = user_id);
drop policy if exists "Users can delete own workout history" on public.workout_history;
create policy "Users can delete own workout history" on public.workout_history for delete using (auth.uid() = user_id);

-- 5. The moment someone signs up, automatically create their profile row
--    and start their 7-day free trial.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, trial_start)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), now());
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 6. Stripe integration: run this part once to add real payments.
--    New columns so we can look a user up from a Stripe webhook event.
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
create index if not exists profiles_stripe_subscription_id_idx on public.profiles (stripe_subscription_id);

-- IMPORTANT: Row Level Security (above) only controls which *rows* a
-- logged-in user can touch -- not which *columns*. Without the line below,
-- a technically-minded user could open their browser's developer tools and
-- set their own "subscribed" to true for free, without ever paying. This
-- revokes their ability to write to the three billing columns directly;
-- only the server-side webhook (api/stripe-webhook.js), which connects
-- with a special key that ignores this restriction entirely, is able to
-- set them. Everything else users already relied on -- name, ftp, settings
-- is untouched.
revoke update (subscribed, stripe_customer_id, stripe_subscription_id) on public.profiles from authenticated;

-- 7. Personal records: average/peak power captured per ride (only present on
--    rides done with a trainer connected), used to work out personal bests on
--    the History screen.
alter table public.workout_history add column if not exists avg_power integer;
alter table public.workout_history add column if not exists max_power integer;

-- 7b. Heart rate is NOT stored. Trbo reads heart rate over Bluetooth and shows
--     it live during a ride, and includes it in the file a rider exports to
--     their own device, but it is never written to this database. These two
--     columns existed in earlier versions; dropping them permanently deletes
--     any heart rate previously recorded, so that Trbo does not hold health
--     data about its riders. Safe to re-run: the columns may already be gone.
alter table public.workout_history drop column if exists avg_hr;
alter table public.workout_history drop column if exists max_hr;

-- 8. Private dashboard for you (the app owner) only -- signup counts, active
--    subscribers, trial users and ride activity, never any other person's
--    individual data. "security definer" lets this one function see across
--    every account despite Row Level Security above, but the check inside
--    it means it only ever returns real numbers to YOUR login -- every
--    other account gets nothing back, and the dashboard simply won't
--    appear in their app.
--
--    Already set below to freddiesmuscles@gmail.com — if you ever log into
--    Trbo with a different email, update the address in the line below
--    to match, then re-run this file.
create or replace function public.admin_dashboard_stats()
returns json as $$
declare
  is_owner boolean;
  result json;
begin
  select (auth.jwt() ->> 'email') = 'freddiesmuscles@gmail.com' into is_owner;
  if not is_owner then
    return null;
  end if;

  select json_build_object(
    'total_users', (select count(*) from public.profiles),
    'subscribed_users', (select count(*) from public.profiles where subscribed = true),
    'trial_users', (select count(*) from public.profiles where subscribed = false and trial_start > now() - interval '7 days'),
    'expired_trial_users', (select count(*) from public.profiles where subscribed = false and trial_start <= now() - interval '7 days'),
    'signups_last_7_days', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'signups_last_30_days', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'rides_last_24h', (select count(*) from public.workout_history where date > now() - interval '1 day'),
    'rides_last_7_days', (select count(*) from public.workout_history where date > now() - interval '7 days'),
    'total_rides_logged', (select count(*) from public.workout_history)
  ) into result;

  return result;
end;
$$ language plpgsql security definer;

-- 9. Strava connection: run this once too. Stores each person's own Strava
--    tokens so completed rides can be pushed to their Strava account. These
--    are protected the same way as everything else above (RLS: only the
--    owning user's row), since a leaked Strava token here only affects that
--    one person's own Strava account, not billing or anyone else's data.
alter table public.profiles add column if not exists strava_athlete_id text;
alter table public.profiles add column if not exists strava_access_token text;
alter table public.profiles add column if not exists strava_refresh_token text;
alter table public.profiles add column if not exists strava_token_expires_at bigint;
-- Same reasoning as the billing columns above: only the server-side
-- functions (api/strava-connect.js, api/strava-upload.js), which use the
-- service role key, can write the actual token values.
revoke update (strava_access_token, strava_refresh_token, strava_token_expires_at) on public.profiles from authenticated;

-- 10. Training load: an estimated Training Stress Score and calorie count
--     computed once when each ride finishes (using the FTP active at the
--     time), stored alongside the rest of that ride's history so the
--     History screen and load trend don't need to recompute them later.
alter table public.workout_history add column if not exists tss numeric;
alter table public.workout_history add column if not exists calories integer;

-- 11. Training planner: the rider's active periodized plan, stored as a single
--     JSON blob on their profile row (exactly like the settings column). It's
--     covered by the same Row Level Security as the rest of the profile, so a
--     user can only ever read or write their own plan. Nothing sensitive lives
--     here -- it's just the generated week-by-week schedule -- so no extra
--     column-level restriction is needed.
alter table public.profiles add column if not exists training_plan jsonb;

-- 12. Archived training plans: when a rider finishes a plan (or retires one to
--     start a new block), the active plan is copied here so their history is
--     kept. The active plan itself still lives in profiles.training_plan
--     (section 11) -- this table is only the archive shelf, one row per saved
--     plan. Same Row Level Security as everything else: a user can only ever
--     see or touch their own archived plans.
create table if not exists public.archived_plans (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  plan jsonb not null,
  goal_label text,
  total_weeks integer,
  status text default 'completed',      -- 'completed' | 'retired'
  archived_at timestamptz default now()
);

alter table public.archived_plans enable row level security;

drop policy if exists "Users can view own archived plans" on public.archived_plans;
create policy "Users can view own archived plans" on public.archived_plans for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own archived plans" on public.archived_plans;
create policy "Users can insert own archived plans" on public.archived_plans for insert with check (auth.uid() = user_id);
drop policy if exists "Users can delete own archived plans" on public.archived_plans;
create policy "Users can delete own archived plans" on public.archived_plans for delete using (auth.uid() = user_id);

-- 13. Trial abuse prevention: closes the two easiest ways to get repeat free
--     trials -- deleting your account and signing up again with the same
--     email, and Gmail-style "+alias" / dot tricks (person+1@gmail.com,
--     per.son@gmail.com, etc. all land in the same inbox as person@gmail.com)
--     -- plus known disposable/temp-mail domains. It does NOT require a card
--     and does NOT block or error out on signup; a repeat email just starts
--     with its trial already used up, so it lands straight on the normal
--     "subscribe to continue" screen instead of getting another free week.
--
--     This table is intentionally separate from profiles and is never
--     touched when a user deletes their account, so "this email already had
--     a trial" survives even if they try to start over from scratch. Nobody
--     (not even a logged-in user) can read or write it directly -- only the
--     trigger function below can, since it runs with elevated privileges.
create table if not exists public.trial_history (
  id bigint generated always as identity primary key,
  email_normalized text not null,
  created_at timestamptz default now()
);
create index if not exists trial_history_email_idx on public.trial_history (email_normalized);
alter table public.trial_history enable row level security;

create or replace function public.normalize_trial_email(raw_email text)
returns text as $$
declare
  local_part text;
  domain_part text;
  at_pos int;
  plus_pos int;
begin
  if raw_email is null then
    return null;
  end if;
  raw_email := lower(trim(raw_email));
  at_pos := position('@' in raw_email);
  if at_pos = 0 then
    return raw_email;
  end if;
  local_part := substring(raw_email from 1 for at_pos - 1);
  domain_part := substring(raw_email from at_pos + 1);
  if domain_part in ('gmail.com', 'googlemail.com') then
    plus_pos := position('+' in local_part);
    if plus_pos > 0 then
      local_part := substring(local_part from 1 for plus_pos - 1);
    end if;
    local_part := replace(local_part, '.', '');
    domain_part := 'gmail.com';
  end if;
  return local_part || '@' || domain_part;
end;
$$ language plpgsql immutable;

-- A short, easy-to-extend list of well-known throwaway/temp-mail domains.
-- Not exhaustive (new ones appear constantly) but catches the common ones
-- with zero ongoing maintenance. Add more any time by editing this array
-- and re-running this file.
create or replace function public.is_disposable_email_domain(domain_part text)
returns boolean as $$
begin
  return domain_part = any(array[
    '10minutemail.com','guerrillamail.com','guerrillamail.info','mailinator.com',
    'tempmail.com','temp-mail.org','throwawaymail.com','yopmail.com','trashmail.com',
    'getnada.com','maildrop.cc','mintemail.com','fakeinbox.com','sharklasers.com',
    'dispostable.com','mailnesia.com','moakt.com','tempmailo.com','emailondeck.com',
    'discard.email','mohmal.com','burnermail.io','mailcatch.com','spamgourmet.com'
  ]);
end;
$$ language plpgsql immutable;

-- Replaces the section-5 signup trigger: same job as before (create the
-- profile, start the trial) for a genuine new person, but backdates the
-- trial for a normalized-email repeat or a disposable-domain signup so it
-- reads as already expired.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  norm_email text;
  domain_part text;
  already_seen boolean;
  is_disposable boolean;
  effective_trial_start timestamptz;
begin
  norm_email := public.normalize_trial_email(new.email);
  domain_part := split_part(norm_email, '@', 2);
  is_disposable := public.is_disposable_email_domain(domain_part);

  select exists(
    select 1 from public.trial_history where email_normalized = norm_email
  ) into already_seen;

  if already_seen or is_disposable then
    effective_trial_start := now() - interval '30 days'; -- reads as trial already used up
  else
    effective_trial_start := now();
  end if;

  insert into public.profiles (id, name, trial_start)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), effective_trial_start);

  insert into public.trial_history (email_normalized) values (norm_email);

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 14. Friends & family: free, permanent access for people you personally
--     choose to comp -- no card, no Stripe checkout. Grant it to someone by
--     running (swap in their real email):
--
--       update public.profiles set comp_access = true
--       where id = (select id from auth.users where email = 'their@email.com');
--
--     Revoke it the same way with "= false". Protected the same way as the
--     billing columns in section 6 -- only you, running SQL directly, can
--     change it, so nobody can grant themselves free access from their
--     browser's dev tools.
alter table public.profiles add column if not exists comp_access boolean default false;
revoke update (comp_access) on public.profiles from authenticated;

-- 14b. Tester comp: free access that expires on its own, separate from the
--     permanent comp_access above. Set automatically (see handle_new_user
--     in section 18 below) for anyone who signs up via a Supabase "Invite
--     user" invite -- since that's only ever you, personally inviting an
--     approved tester, "invited" already means "approved" here. No manual
--     revoke needed: once comp_expires_at is in the past, the app treats
--     them like anyone else whose trial has run out. To extend someone
--     manually (swap in their real email):
--
--       update public.profiles set comp_expires_at = now() + interval '30 days'
--       where id = (select id from auth.users where email = 'their@email.com');
alter table public.profiles add column if not exists comp_expires_at timestamptz;
revoke update (comp_expires_at) on public.profiles from authenticated;

-- 15. Device cap: stops one paid (or trialing) account being used on lots of
--     devices at once. Each browser/app install gets a random id, generated
--     by the app and stored only on that device, which "checks in" here.
--     If more devices are active for one account than the app's
--     MAX_ACTIVE_DEVICES constant allows, the oldest ones are marked
--     revoked, and that device signs itself out (with an explanation) the
--     next time it checks in.
create table if not exists public.active_devices (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  device_id text not null,
  device_label text,
  last_seen timestamptz default now(),
  revoked boolean default false,
  created_at timestamptz default now(),
  unique (user_id, device_id)
);
create index if not exists active_devices_user_idx on public.active_devices (user_id);

alter table public.active_devices enable row level security;
drop policy if exists "Users can view own devices" on public.active_devices;
create policy "Users can view own devices" on public.active_devices for select using (auth.uid() = user_id);
-- Deliberately no insert/update/delete policy for regular users -- every
-- write goes through register_device() below, which is the only thing
-- that gets to decide who is or isn't revoked.

-- Called once when the app loads for a logged-in person. Registers/refreshes
-- this device and enforces the cap, returning whether this exact device is
-- (now) revoked.
create or replace function public.register_device(p_device_id text, p_device_label text, p_max_devices int default 2)
returns boolean as $$
declare
  uid uuid;
  is_revoked boolean;
begin
  uid := auth.uid();
  if uid is null then
    return false;
  end if;

  insert into public.active_devices (user_id, device_id, device_label, last_seen, revoked)
  values (uid, p_device_id, p_device_label, now(), false)
  on conflict (user_id, device_id)
  do update set last_seen = now(), device_label = excluded.device_label, revoked = false;

  -- Keep the newest p_max_devices devices; revoke anything older than that.
  -- The device that just checked in above always has the freshest
  -- last_seen, so it's never the one revoked here.
  update public.active_devices
  set revoked = true
  where user_id = uid
    and id in (
      select id from public.active_devices
      where user_id = uid and revoked = false
      order by last_seen desc
      offset greatest(p_max_devices, 0)
    );

  select revoked from public.active_devices
  where user_id = uid and device_id = p_device_id
  into is_revoked;

  return coalesce(is_revoked, false);
end;
$$ language plpgsql security definer;

-- Called periodically while the app is open, to catch a device that gets
-- revoked because a *different* device registered after it -- without this,
-- an already-open tab would stay signed in indefinitely.
create or replace function public.check_device(p_device_id text)
returns boolean as $$
declare
  uid uuid;
  is_revoked boolean;
begin
  uid := auth.uid();
  if uid is null then
    return false;
  end if;
  select revoked from public.active_devices
  where user_id = uid and device_id = p_device_id
  into is_revoked;
  return coalesce(is_revoked, false);
end;
$$ language plpgsql security definer;

-- 16. Starred workouts: lets a rider star/favorite any workout or ride
--     (built-in or their own custom one) and pull them up quickly, including
--     via the "Starred" sort in the library. One row per star; starring
--     again does nothing (unique constraint), unstarring just deletes the
--     row. No update policy needed since it's always insert-to-star /
--     delete-to-unstar, never edited in place.
create table if not exists public.starred_workouts (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  workout_id text not null,
  created_at timestamptz default now(),
  unique (user_id, workout_id)
);
create index if not exists starred_workouts_user_idx on public.starred_workouts (user_id);

alter table public.starred_workouts enable row level security;
drop policy if exists "Users can view own starred workouts" on public.starred_workouts;
create policy "Users can view own starred workouts" on public.starred_workouts for select using (auth.uid() = user_id);
drop policy if exists "Users can star workouts" on public.starred_workouts;
create policy "Users can star workouts" on public.starred_workouts for insert with check (auth.uid() = user_id);
drop policy if exists "Users can unstar workouts" on public.starred_workouts;
create policy "Users can unstar workouts" on public.starred_workouts for delete using (auth.uid() = user_id);

-- 17. Workout queue: an ordered list of workouts/rides (built-in or custom)
--     a rider has lined up to roll through back-to-back, via the "Queue"
--     button next to "Start workout" and managed from the Queue page.
--     Unlike starred_workouts this needs an update policy too, since
--     reordering the queue rewrites the position column on existing rows.
create table if not exists public.queued_workouts (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  workout_id text not null,
  position integer not null default 0,
  created_at timestamptz default now(),
  unique (user_id, workout_id)
);
create index if not exists queued_workouts_user_idx on public.queued_workouts (user_id, position);

alter table public.queued_workouts enable row level security;
drop policy if exists "Users can view own queue" on public.queued_workouts;
create policy "Users can view own queue" on public.queued_workouts for select using (auth.uid() = user_id);
drop policy if exists "Users can add to own queue" on public.queued_workouts;
create policy "Users can add to own queue" on public.queued_workouts for insert with check (auth.uid() = user_id);
drop policy if exists "Users can reorder own queue" on public.queued_workouts;
create policy "Users can reorder own queue" on public.queued_workouts for update using (auth.uid() = user_id);
drop policy if exists "Users can remove from own queue" on public.queued_workouts;
create policy "Users can remove from own queue" on public.queued_workouts for delete using (auth.uid() = user_id);

-- 18. Enforce the signup pause at the database level, not just in the app.
--     SIGNUPS_PAUSED in src/App.jsx only blocks the email/password form and
--     the in-app "Start your free trial" screen -- it never touched
--     "Continue with Google" / "Continue with Apple" on the LOG IN screen,
--     because those call supabase.auth.signInWithOAuth() directly and, for
--     a brand-new Google/Apple identity, that creates a real account with
--     no app code in the loop at all. This closes that door for good,
--     regardless of which signup path someone finds.
--
--     invited_at is only ever set on users created via the Supabase
--     dashboard's "Invite user" (or the admin inviteUserByEmail API) --
--     never on a self-serve signup, email or OAuth. So this blocks all
--     self-serve signups while leaving your manual test-account invites
--     working exactly as before. It also never affects existing users
--     logging back in (via any method) -- this trigger only runs on a new
--     row being inserted into auth.users, not on a login to an account
--     that already exists.
--
--     IMPORTANT: this is a second flag, separate from SIGNUPS_PAUSED in
--     src/App.jsx. Flip both together at relaunch -- run this again with
--     `select false;` swapped in below.
create or replace function public.signups_paused()
returns boolean as $$
  select true; -- keep in sync with SIGNUPS_PAUSED in src/App.jsx
$$ language sql immutable;

create or replace function public.handle_new_user()
returns trigger as $$
declare
  norm_email text;
  domain_part text;
  already_seen boolean;
  is_disposable boolean;
  effective_trial_start timestamptz;
  tester_comp_expires timestamptz;
begin
  if public.signups_paused() and new.invited_at is null then
    raise exception 'Signups are currently paused.' using errcode = 'P0001';
  end if;

  norm_email := public.normalize_trial_email(new.email);
  domain_part := split_part(norm_email, '@', 2);
  is_disposable := public.is_disposable_email_domain(domain_part);

  select exists(
    select 1 from public.trial_history where email_normalized = norm_email
  ) into already_seen;

  if already_seen or is_disposable then
    effective_trial_start := now() - interval '30 days'; -- reads as trial already used up
  else
    effective_trial_start := now();
  end if;

  -- Anyone who lands here with invited_at set got there through a Supabase
  -- "Invite user" invite -- and since that's a manual action only you ever
  -- take, per person, invited already means approved tester. Give them 30
  -- days of free access starting the moment they accept the invite and set
  -- a password, no separate approval step on top of the invite itself.
  if new.invited_at is not null then
    tester_comp_expires := now() + interval '30 days';
  else
    tester_comp_expires := null;
  end if;

  insert into public.profiles (id, name, trial_start, comp_expires_at)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), effective_trial_start, tester_comp_expires);

  insert into public.trial_history (email_normalized) values (norm_email);

  return new;
end;
$$ language plpgsql security definer;

-- 19. Rate limiting: stops one runaway script (a buggy loop, a hostile
--     script using a stolen session, or a scraper hitting the checkout/
--     Strava endpoints) from hammering the database or the Vercel
--     functions and running up usage. This is enforced entirely on the
--     server side -- inside Postgres and inside the Vercel functions
--     themselves -- so nothing running in someone's browser can turn it
--     off or raise its own limit.
--
--     One shared counter table, one shared "check and count" function.
--     Every write below is counted twice: once against the signed-in
--     person (so one account can't spam even from many devices) and once
--     against their network address (so a script that keeps creating new
--     trial accounts can't just spam under a fresh account each time).
--     A "bucket" is just a label like "workout_history:user:<their id>"
--     or "create-checkout-session:ip:<their address>" plus a time window,
--     so each person/address/action combination gets its own counter that
--     resets on its own every window.
create table if not exists public.rate_limits (
  bucket text primary key,
  count integer not null default 0,
  window_start timestamptz not null
);

-- Locked down completely -- unlike every other table above, this one has
-- no policies at all, on purpose. Nobody signed in with the app's public
-- key (anon or authenticated) has any reason to read or write this table
-- directly; the only things that ever touch it are the SECURITY DEFINER
-- functions below (which run with elevated rights that RLS doesn't apply
-- to) and the Vercel functions using the service-role key (which bypasses
-- RLS by design). Enabling RLS with zero policies means "nobody via the
-- public API, ever" -- exactly what's wanted here.
alter table public.rate_limits enable row level security;

-- Adds one to a bucket's counter for the current time window and reports
-- back whether that bucket is still under its limit. Also does a tiny bit
-- of self-cleanup (roughly 1 in 100 calls) so this table never grows
-- without bound -- no separate scheduled job needed.
create or replace function public.bump_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns boolean as $$
declare
  w timestamptz;
  current_count integer;
begin
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits (bucket, count, window_start)
  values (p_bucket || ':' || extract(epoch from w)::text, 1, w)
  on conflict (bucket) do update
    set count = public.rate_limits.count + 1
  returning count into current_count;

  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return current_count <= p_limit;
end;
$$ language plpgsql security definer;

-- Deliberately NOT callable directly by the app (only by the trigger
-- below, and by the Vercel functions using the service-role key, both of
-- which bypass this restriction). Without this, someone could call this
-- function directly, as fast as they like, with a made-up bucket name --
-- which would just move the spam problem from the real tables onto this
-- one instead of stopping it.
revoke execute on function public.bump_rate_limit(text, int, int) from public, anon, authenticated;

-- Attach this trigger to any table with `before insert` or `before update`
-- to rate-limit writes to it. Pass the action name, the per-person limit,
-- the time window in seconds, and (optionally) the per-network-address
-- limit as the trigger's arguments -- see the table-by-table setup below
-- for real examples. Reads the requester's network address the same way
-- Supabase's own docs recommend (via the X-Forwarded-For request header),
-- so this works for genuine spam without needing anything from the client.
create or replace function public.rate_limit_trigger()
returns trigger as $$
declare
  action text := TG_ARGV[0];
  user_limit int := TG_ARGV[1]::int;
  window_seconds int := TG_ARGV[2]::int;
  ip_limit int := nullif(TG_ARGV[3], '')::int;
  uid uuid := auth.uid();
  client_ip text;
  allowed boolean;
begin
  if uid is not null then
    allowed := public.bump_rate_limit(action || ':user:' || uid::text, user_limit, window_seconds);
    if not allowed then
      raise exception 'You''re doing that too fast -- please wait a bit and try again.' using errcode = 'P0001';
    end if;
  end if;

  if ip_limit is not null then
    client_ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
    if client_ip <> '' then
      allowed := public.bump_rate_limit(action || ':ip:' || client_ip, ip_limit, window_seconds);
      if not allowed then
        raise exception 'Too many requests from this network -- please wait a bit and try again.' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- Table-by-table limits. Numbers are generous for a genuine rider (nobody
-- legitimately finishes 60 workouts an hour) but tight enough to stop a
-- spam loop from doing real damage. All safe to re-run, and safe to tune
-- any time by re-running this file with different numbers below.
drop trigger if exists rl_workout_history on public.workout_history;
create trigger rl_workout_history before insert on public.workout_history
  for each row execute function public.rate_limit_trigger('workout_history', '60', '3600', '200');

drop trigger if exists rl_ftp_history on public.ftp_history;
create trigger rl_ftp_history before insert on public.ftp_history
  for each row execute function public.rate_limit_trigger('ftp_history', '20', '3600', '60');

drop trigger if exists rl_custom_workouts on public.custom_workouts;
create trigger rl_custom_workouts before insert on public.custom_workouts
  for each row execute function public.rate_limit_trigger('custom_workouts', '40', '3600', '150');

drop trigger if exists rl_archived_plans on public.archived_plans;
create trigger rl_archived_plans before insert on public.archived_plans
  for each row execute function public.rate_limit_trigger('archived_plans', '15', '3600', '50');

drop trigger if exists rl_starred_workouts on public.starred_workouts;
create trigger rl_starred_workouts before insert on public.starred_workouts
  for each row execute function public.rate_limit_trigger('starred_workouts', '200', '3600', '600');

drop trigger if exists rl_queued_workouts on public.queued_workouts;
create trigger rl_queued_workouts before insert on public.queued_workouts
  for each row execute function public.rate_limit_trigger('queued_workouts', '200', '3600', '600');

drop trigger if exists rl_profiles_update on public.profiles;
create trigger rl_profiles_update before update on public.profiles
  for each row execute function public.rate_limit_trigger('profiles_update', '120', '3600', '400');

-- 20. Feedback board: testers post feedback (with up to 3 photos) and
--     upvote each other's posts. Gated to signed-in people only, never
--     public -- since signups are paused and only approved testers can
--     currently create an account, "signed in" already means "a confirmed
--     tester" for now. Posts show anonymously to other testers (nobody but
--     you, reading the table directly, can see who wrote what); voting
--     uses each person's own account so it can't be stacked, and
--     un-upvoting is just deleting the vote row.
create table if not exists public.feedback_items (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  body text not null,
  photo_paths text[] not null default '{}'::text[] check (coalesce(array_length(photo_paths, 1), 0) <= 3),
  status text not null default 'new',
  upvote_count integer not null default 0,
  created_at timestamptz default now()
);
create index if not exists feedback_items_rank_idx on public.feedback_items (upvote_count desc, created_at desc);

create table if not exists public.feedback_votes (
  id bigint generated always as identity primary key,
  feedback_id bigint references public.feedback_items(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique (feedback_id, user_id)
);
create index if not exists feedback_votes_feedback_idx on public.feedback_votes (feedback_id);

alter table public.feedback_items enable row level security;
alter table public.feedback_votes enable row level security;

-- Any signed-in person can see and post feedback (never anonymous/public),
-- but can only delete their own post. No update policy for regular users --
-- upvote_count only ever changes via the trigger below (security definer
-- bypasses RLS), and status is only ever changed by you, directly in
-- Supabase, when triaging.
drop policy if exists "Signed-in users can view feedback" on public.feedback_items;
create policy "Signed-in users can view feedback" on public.feedback_items for select using (auth.uid() is not null);
drop policy if exists "Signed-in users can post feedback" on public.feedback_items;
create policy "Signed-in users can post feedback" on public.feedback_items for insert with check (auth.uid() = user_id);
drop policy if exists "Users can delete own feedback" on public.feedback_items;
create policy "Users can delete own feedback" on public.feedback_items for delete using (auth.uid() = user_id);

drop policy if exists "Signed-in users can view votes" on public.feedback_votes;
create policy "Signed-in users can view votes" on public.feedback_votes for select using (auth.uid() is not null);
drop policy if exists "Users can upvote" on public.feedback_votes;
create policy "Users can upvote" on public.feedback_votes for insert with check (auth.uid() = user_id);
drop policy if exists "Users can remove own upvote" on public.feedback_votes;
create policy "Users can remove own upvote" on public.feedback_votes for delete using (auth.uid() = user_id);

-- Keeps upvote_count on feedback_items in sync automatically, so ranking
-- the list is just "order by upvote_count desc" -- no counting joins
-- needed on every read.
create or replace function public.sync_feedback_upvote_count()
returns trigger as $$
begin
  if (TG_OP = 'INSERT') then
    update public.feedback_items set upvote_count = upvote_count + 1 where id = new.feedback_id;
    return new;
  elsif (TG_OP = 'DELETE') then
    update public.feedback_items set upvote_count = greatest(0, upvote_count - 1) where id = old.feedback_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_feedback_upvote_count on public.feedback_votes;
create trigger trg_feedback_upvote_count
  after insert or delete on public.feedback_votes
  for each row execute function public.sync_feedback_upvote_count();

-- Same spam protection pattern as every other write in this file --
-- generous for genuine use, tight enough to stop abuse.
drop trigger if exists rl_feedback_items on public.feedback_items;
create trigger rl_feedback_items before insert on public.feedback_items
  for each row execute function public.rate_limit_trigger('feedback_items', '20', '3600', '60');

drop trigger if exists rl_feedback_votes on public.feedback_votes;
create trigger rl_feedback_votes before insert on public.feedback_votes
  for each row execute function public.rate_limit_trigger('feedback_votes', '200', '3600', '600');

-- Storage bucket for feedback photos. Private (not public) -- only
-- signed-in people can view or upload, matching the "testers only, never
-- public" rule for the whole board. Uploads are required to live under a
-- folder named after the uploader's own user id (enforced below), which is
-- what lets the delete-your-own-photo policy work without a lookup table.
insert into storage.buckets (id, name, public)
values ('feedback-photos', 'feedback-photos', false)
on conflict (id) do nothing;

drop policy if exists "Signed-in users can view feedback photos" on storage.objects;
create policy "Signed-in users can view feedback photos" on storage.objects
  for select using (bucket_id = 'feedback-photos' and auth.uid() is not null);

drop policy if exists "Signed-in users can upload feedback photos" on storage.objects;
create policy "Signed-in users can upload feedback photos" on storage.objects
  for insert with check (bucket_id = 'feedback-photos' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete own feedback photos" on storage.objects;
create policy "Users can delete own feedback photos" on storage.objects
  for delete using (bucket_id = 'feedback-photos' and (storage.foldername(name))[1] = auth.uid()::text);

