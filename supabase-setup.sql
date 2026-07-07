-- Trbo: database setup
-- Paste this whole thing into Supabase SQL Editor and click "Run".
-- Safe to re-run in full any time \u2014 every statement below either checks
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

-- 7. Personal records: average/peak power and heart rate captured per ride
--    (only present on rides done with a trainer and/or heart rate monitor
--    connected), used to work out personal bests on the History screen.
alter table public.workout_history add column if not exists avg_power integer;
alter table public.workout_history add column if not exists max_power integer;
alter table public.workout_history add column if not exists avg_hr integer;
alter table public.workout_history add column if not exists max_hr integer;

-- 8. Private dashboard for you (the app owner) only -- signup counts, active
--    subscribers, trial users and ride activity, never any other person's
--    individual data. "security definer" lets this one function see across
--    every account despite Row Level Security above, but the check inside
--    it means it only ever returns real numbers to YOUR login -- every
--    other account gets nothing back, and the dashboard simply won't
--    appear in their app.
--
--    Already set below to freddiesmuscles@gmail.com \u2014 if you ever log into
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
