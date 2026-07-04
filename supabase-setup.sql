-- Turbo Trainer: database setup
-- Paste this whole thing into Supabase SQL Editor and click "Run".

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

create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

create policy "Users can view own workouts" on public.custom_workouts for select using (auth.uid() = user_id);
create policy "Users can insert own workouts" on public.custom_workouts for insert with check (auth.uid() = user_id);
create policy "Users can update own workouts" on public.custom_workouts for update using (auth.uid() = user_id);
create policy "Users can delete own workouts" on public.custom_workouts for delete using (auth.uid() = user_id);

create policy "Users can view own ftp history" on public.ftp_history for select using (auth.uid() = user_id);
create policy "Users can insert own ftp history" on public.ftp_history for insert with check (auth.uid() = user_id);
create policy "Users can delete own ftp history" on public.ftp_history for delete using (auth.uid() = user_id);

create policy "Users can view own workout history" on public.workout_history for select using (auth.uid() = user_id);
create policy "Users can insert own workout history" on public.workout_history for insert with check (auth.uid() = user_id);
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
--    \u26a0\ufe0f BEFORE RUNNING THIS: replace 'YOUR-LOGIN-EMAIL@example.com' below
--    with the email address you personally log into Turbo Trainer with.
create or replace function public.admin_dashboard_stats()
returns json as $$
declare
  is_owner boolean;
  result json;
begin
  select (auth.jwt() ->> 'email') = 'YOUR-LOGIN-EMAIL@example.com' into is_owner;
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
