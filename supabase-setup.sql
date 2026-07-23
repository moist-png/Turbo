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
$$ language plpgsql security definer set search_path = public;

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
-- logged-in user can touch -- not which *columns*. Without something below,
-- a technically-minded user could open their browser's developer tools and
-- set their own "subscribed" to true for free, without ever paying.
--
-- NOTE: a plain "revoke update (col) ... from authenticated" does NOT work
-- for this on Supabase, even though it looks like it should. Supabase
-- grants full table-level UPDATE to the authenticated/anon roles by
-- default, and a table-level grant overrides any column-specific revoke --
-- so those revoke lines (if you're seeing this comment in an old version of
-- this file) were silently doing nothing this whole time. The actual
-- protection is the trigger in section 6b below, which covers this column
-- along with comp_access, comp_expires_at, and the Strava token columns
-- added in section 9.

-- 6b. The actual protection for subscribed, stripe_customer_id,
--     stripe_subscription_id, comp_access, comp_expires_at, and the Strava
--     token columns (added in section 9): a trigger that blocks any write
--     to these specific columns unless it comes from "postgres" (you,
--     running SQL directly here or in the SQL Editor) or "service_role"
--     (our own backend functions -- api/stripe-webhook.js,
--     api/strava-connect.js, api/strava-upload.js -- which authenticate
--     with the service role key). Everyone else -- meaning every rider's
--     own signed-in browser session, which connects as "authenticated" --
--     gets a clean error if they try to touch these columns directly,
--     no matter what request they send. Normal fields like name, ftp, and
--     settings are completely unaffected.
create or replace function public.protect_service_only_columns()
returns trigger as $$
begin
  if current_user not in ('postgres', 'service_role') then
    if new.subscribed is distinct from old.subscribed
       or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id
       or new.comp_access is distinct from old.comp_access
       or new.comp_expires_at is distinct from old.comp_expires_at
       or new.strava_access_token is distinct from old.strava_access_token
       or new.strava_refresh_token is distinct from old.strava_refresh_token
       or new.strava_token_expires_at is distinct from old.strava_token_expires_at then
      raise exception 'This field can only be changed by the server.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security invoker set search_path = public;

drop trigger if exists protect_service_only_columns_trigger on public.profiles;
create trigger protect_service_only_columns_trigger
before update on public.profiles
for each row execute function public.protect_service_only_columns();

-- 7. Personal records: average/peak power captured per ride (only present on
--    rides done with a trainer connected), used to work out personal bests on
--    the History screen.
alter table public.workout_history add column if not exists avg_power integer;
alter table public.workout_history add column if not exists max_power integer;

-- 7a. Confirmed outdoor rides: logged after the fact rather than followed
--     live, so there's no captured power stream. `rpe` (1-10) is only ever
--     used to estimate a fallback TSS at log time (see estimateOutdoorTss in
--     planner.js) so the ride still counts toward training load.
alter table public.workout_history add column if not exists outdoor boolean default false;
alter table public.workout_history add column if not exists rpe integer;

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
  mkt_ids uuid[];
  result json;
begin
  select (auth.jwt() ->> 'email') = 'freddiesmuscles@gmail.com' into is_owner;
  if not is_owner then
    return null;
  end if;

  -- Marketing/demo accounts (e.g. "Luca", see the marketing section below)
  -- carry dozens of seeded rides that would otherwise inflate ride counts,
  -- active-rider counts and adoption rates and distort the only numbers you
  -- have. Collect their ids once and exclude them from every figure below.
  -- When there are none, mkt_ids is an empty array and "<> all(mkt_ids)"
  -- keeps every row, so this changes nothing until an account is flagged.
  select coalesce(array_agg(id), '{}'::uuid[]) into mkt_ids
    from public.profiles where coalesce(marketing_account, false);

  select json_build_object(
    'total_users', (select count(*) from public.profiles where id <> all(mkt_ids)),
    'subscribed_users', (select count(*) from public.profiles where subscribed = true and id <> all(mkt_ids)),
    'trial_users', (select count(*) from public.profiles where subscribed = false and trial_start > now() - interval '7 days' and id <> all(mkt_ids)),
    'expired_trial_users', (select count(*) from public.profiles where subscribed = false and trial_start <= now() - interval '7 days' and id <> all(mkt_ids)),
    'signups_last_7_days', (select count(*) from public.profiles where created_at > now() - interval '7 days' and id <> all(mkt_ids)),
    'signups_last_30_days', (select count(*) from public.profiles where created_at > now() - interval '30 days' and id <> all(mkt_ids)),
    'rides_last_24h', (select count(*) from public.workout_history where date > now() - interval '1 day' and user_id <> all(mkt_ids)),
    'rides_last_7_days', (select count(*) from public.workout_history where date > now() - interval '7 days' and user_id <> all(mkt_ids)),
    'total_rides_logged', (select count(*) from public.workout_history where user_id <> all(mkt_ids)),

    -- Understanding users: conversion, retention, and churn risk, so you can
    -- tell at a glance whether the trial is working and whether paying
    -- riders are actually sticking around, not just whether signups exist.
    'trial_to_paid_conversion_pct', (
      select case when (
          count(*) filter (where subscribed = true) + count(*) filter (where subscribed = false and trial_start <= now() - interval '7 days')
        ) = 0 then null
        else round(100.0 * count(*) filter (where subscribed = true) / (
          count(*) filter (where subscribed = true) + count(*) filter (where subscribed = false and trial_start <= now() - interval '7 days')
        ), 1)
      end
      from public.profiles where id <> all(mkt_ids)
    ),
    'active_riders_last_7_days', (select count(distinct user_id) from public.workout_history where date > now() - interval '7 days' and user_id <> all(mkt_ids)),
    'active_riders_last_30_days', (select count(distinct user_id) from public.workout_history where date > now() - interval '30 days' and user_id <> all(mkt_ids)),
    'subscribers_inactive_14_days', (
      select count(*) from public.profiles p
      where p.subscribed = true
        and p.id <> all(mkt_ids)
        and not exists (select 1 from public.workout_history wh where wh.user_id = p.id and wh.date > now() - interval '14 days')
    ),

    -- Understanding product choices: which built-in features people
    -- actually adopt (planner, queue, starring), and which workouts/
    -- categories they actually ride, versus what's just sitting in the
    -- library unused.
    'planner_adoption_pct', (
      select case when (select count(*) from public.profiles where id <> all(mkt_ids)) = 0 then null
        else round(100.0 * count(*) filter (where training_plan is not null or id in (select user_id from public.archived_plans)) / (select count(*) from public.profiles where id <> all(mkt_ids)), 1)
      end
      from public.profiles where id <> all(mkt_ids)
    ),
    'queue_usage_pct', (
      select case when (select count(*) from public.profiles where id <> all(mkt_ids)) = 0 then null
        else round(100.0 * (select count(distinct user_id) from public.queued_workouts where user_id <> all(mkt_ids)) / (select count(*) from public.profiles where id <> all(mkt_ids)), 1)
      end
    ),
    'starred_usage_pct', (
      select case when (select count(*) from public.profiles where id <> all(mkt_ids)) = 0 then null
        else round(100.0 * (select count(distinct user_id) from public.starred_workouts where user_id <> all(mkt_ids)) / (select count(*) from public.profiles where id <> all(mkt_ids)), 1)
      end
    ),
    'top_categories_30d', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select category, count(*) as rides
        from public.workout_history
        where date > now() - interval '30 days' and category is not null and user_id <> all(mkt_ids)
        group by category
        order by rides desc
        limit 6
      ) t
    ),
    'top_workouts_30d', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select name, count(*) as rides
        from public.workout_history
        where date > now() - interval '30 days' and name is not null and user_id <> all(mkt_ids)
        group by name
        order by rides desc
        limit 8
      ) t
    )
  ) into result;

  return result;
end;
$$ language plpgsql security definer set search_path = public;

-- 9. Strava connection: run this once too. Stores each person's own Strava
--    tokens so completed rides can be pushed to their Strava account.
--    strava_athlete_id is harmless (just an ID, not a credential) and stays
--    readable/writable like any normal profile field. The three actual
--    token columns are covered by the protection trigger in section 6b
--    above, so only api/strava-connect.js and api/strava-upload.js
--    (running with the service role key) can ever write them.
alter table public.profiles add column if not exists strava_athlete_id text;
alter table public.profiles add column if not exists strava_access_token text;
alter table public.profiles add column if not exists strava_refresh_token text;
alter table public.profiles add column if not exists strava_token_expires_at bigint;

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
$$ language plpgsql security definer set search_path = public;

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
--     Revoke it the same way with "= false". Protected by the trigger in
--     section 6b above -- only you, running SQL directly, or the server
--     itself can change it, so nobody can grant themselves free access from
--     their browser's dev tools.
alter table public.profiles add column if not exists comp_access boolean default false;

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
-- Protected by the same trigger in section 6b.

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
$$ language plpgsql security definer set search_path = public;

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
$$ language plpgsql security definer set search_path = public;

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

-- invited_at is not reliably present on auth.users at INSERT time even for
-- genuine Supabase invites (dashboard "Invite user" or inviteUserByEmail),
-- so a signups-paused check that only looked at invited_at was rejecting
-- those too. There's a second, reliable exemption below: an admin_invited
-- flag passed directly in raw_user_meta_data at creation time, which --
-- unlike invited_at -- is guaranteed present in the same INSERT since it's
-- literal data handed to the create/invite call (see api/admin-invite.js).
create or replace function public.handle_new_user()
returns trigger as $$
declare
  norm_email text;
  domain_part text;
  already_seen boolean;
  is_disposable boolean;
  effective_trial_start timestamptz;
  tester_comp_expires timestamptz;
  is_approved_invite boolean;
begin
  is_approved_invite := new.invited_at is not null
    or coalesce((new.raw_user_meta_data->>'admin_invited')::boolean, false);

  if public.signups_paused() and not is_approved_invite then
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

  -- Anyone who lands here as an approved invite (either signal) got there
  -- through a manual action only you ever take, per person -- invited
  -- already means approved tester. Give them 30 days of free access
  -- starting now, no separate approval step on top of the invite itself.
  if is_approved_invite then
    tester_comp_expires := now() + interval '30 days';
  else
    tester_comp_expires := null;
  end if;

  insert into public.profiles (id, name, trial_start, comp_expires_at)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), effective_trial_start, tester_comp_expires);

  insert into public.trial_history (email_normalized) values (norm_email);

  return new;
end;
$$ language plpgsql security definer set search_path = public;

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
$$ language plpgsql security definer set search_path = public;

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
$$ language plpgsql security definer set search_path = public;

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
$$ language plpgsql security definer set search_path = public;

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

-- 20a-i. Keep the board genuinely anonymous. The RLS SELECT policy above
--     lets any signed-in tester read every post -- that's intended, the
--     board is shared -- but "shared" must not mean "you can see who wrote
--     what." A row-level policy can't hide a single column, so this does it
--     at the grant level instead: revoke the blanket table read, then hand
--     back read access to every column EXCEPT user_id. After this, a tester
--     asking for the author of someone else's post (even by crafting the
--     request by hand in dev tools) simply gets a permission error on that
--     column -- the id never leaves the database.
--
--     Safe to re-run: revoke/grant are idempotent. Whenever you add a new
--     column to feedback_items later, add it to the grant list below too,
--     or it won't be readable by the app.
revoke select on public.feedback_items from anon, authenticated;
grant select (id, body, photo_paths, status, upvote_count, created_at)
  on public.feedback_items to anon, authenticated;

-- With user_id no longer readable, the app can't tell on its own which
-- posts are the signed-in person's own (needed to show the "You" label and
-- their delete button). This function answers exactly that and nothing
-- more: it runs with elevated rights so it can look at user_id internally,
-- but only ever returns the ids of posts belonging to whoever is calling
-- it -- never anyone else's, and never the ids themselves mapped to names.
create or replace function public.my_feedback_ids()
returns setof bigint as $$
  select id from public.feedback_items where user_id = auth.uid();
$$ language sql stable security definer set search_path = public;

revoke execute on function public.my_feedback_ids() from public;
grant execute on function public.my_feedback_ids() to authenticated;

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

-- 20b. Email sequence system: tracks which lifecycle emails (trial
--     nudges, the day-8 "why didn't you subscribe" survey, subscriber
--     retention nudges) have already gone out to whom, so the daily
--     scheduler in api/email-sequence-cron.js never double-sends. Also
--     holds survey answers and the opt-out flag every email respects.
--     Backend-only (service role) -- nobody's browser ever reads or writes
--     these directly, so RLS stays on with zero policies, same as the
--     rate_limits table below.
create table if not exists public.email_sequence_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  sequence_key text not null,
  sent_at timestamptz default now(),
  unique (user_id, sequence_key)
);
alter table public.email_sequence_log enable row level security;

create table if not exists public.trial_survey_responses (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  primary_reason text,
  followup_detail text,
  created_at timestamptz default now(),
  responded_at timestamptz,
  followup_at timestamptz
);
alter table public.trial_survey_responses enable row level security;

alter table public.profiles add column if not exists email_opt_out boolean default false;
revoke update (email_opt_out) on public.profiles from authenticated;

-- 20b. Saved workout queues: a rider can save their current queue as a named
--      preset ("Monday plan", "Weekend plan", etc.) and reload it later --
--      separate from the single active queue in queued_workouts (section
--      17) above, which is just "what's lined up to ride right now."
--      Capped client-side at 8 saved queues per person, 8 workouts each --
--      generous enough for real use, small enough to keep the UI and this
--      table tidy. Easy to loosen later; these are just numbers in the app.
create table if not exists public.saved_queues (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  workout_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);
create index if not exists saved_queues_user_idx on public.saved_queues (user_id, created_at);

alter table public.saved_queues enable row level security;
drop policy if exists "Users can view own saved queues" on public.saved_queues;
create policy "Users can view own saved queues" on public.saved_queues for select using (auth.uid() = user_id);
drop policy if exists "Users can save own queues" on public.saved_queues;
create policy "Users can save own queues" on public.saved_queues for insert with check (auth.uid() = user_id);
drop policy if exists "Users can rename own saved queues" on public.saved_queues;
create policy "Users can rename own saved queues" on public.saved_queues for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own saved queues" on public.saved_queues;
create policy "Users can delete own saved queues" on public.saved_queues for delete using (auth.uid() = user_id);

-- 20c. Post-ride effort survey (Stage 1.1 of the planner roadmap). After a
--      completed session the app asks one tap-to-answer question ("How did
--      that feel?"); the answer lands in effort_rating (1 Easy .. 5 Couldn't
--      finish). intensity_adjust records the intensity offset (percent, e.g.
--      -10) the rider ended the ride on -- finishing a threshold day at -10%
--      is itself a meaningful difficulty signal. Both are nullable and the
--      app degrades gracefully if these columns don't exist yet. The UPDATE
--      policy is new: the survey answer arrives a few seconds after the row
--      is inserted, so riders need to be able to update their own rows.
alter table public.workout_history add column if not exists effort_rating smallint;
alter table public.workout_history add column if not exists intensity_adjust smallint;
drop policy if exists "Users can update own workout history" on public.workout_history;
create policy "Users can update own workout history" on public.workout_history for update using (auth.uid() = user_id);

-- 21. The BEFORE UPDATE trigger in section 6b stops writes to the
--     credential/billing columns, but does nothing about reads -- Supabase's
--     default table-wide SELECT grant meant a signed-in person's own
--     browser session could read their own raw Strava tokens and Stripe
--     customer/subscription IDs directly (e.g. from the browser console),
--     bypassing the app's own column allowlist in src/App.jsx entirely.
--     Those are live credentials -- a leaked Strava refresh token lets
--     someone act on that person's Strava account indefinitely, outside of
--     Trbo -- so this removes the blanket grant and replaces it with
--     column-level grants covering only what the app actually reads
--     client-side. subscribed/comp_access/comp_expires_at stay readable
--     (the app displays them); the token and Stripe ID columns do not.
--     Must run after every column referenced below already exists, so this
--     stays as the last section in this file -- if you add more columns to
--     profiles above, decide here whether the browser should ever read
--     them and update the list below accordingly.
revoke select on public.profiles from authenticated, anon;
grant select (
  id, name, ftp, trial_start, subscribed, settings, created_at,
  strava_athlete_id, training_plan, comp_access, comp_expires_at
) on public.profiles to authenticated, anon;


-- 22. Subscription pause ("seasonal rider"). Riders who stop training over
--     winter can pause billing instead of cancelling outright.
--
--     How it works: pausing sets `cancel_at_period_end` on the Stripe
--     subscription. Billing stops immediately, the rider keeps riding until
--     the period they've already paid for runs out, and Stripe then ends
--     the subscription cleanly on its own. Resuming before that date simply
--     clears the flag and normal billing carries on.
--
--     (Stripe's `pause_collection` was the obvious candidate and is the
--     wrong tool: it keeps rolling the billing period over and voiding each
--     invoice, so the paid-through date keeps moving, access never lapses,
--     and a rider could pause an annual plan and return to nearly a free
--     year. It also leaves dormant subscriptions behind forever.)
--
--     `subscription_paused` mirrors cancel_at_period_end and
--     `subscription_paid_through` records when access runs out. Because
--     pause ends at exactly the moment access does, a rider can only ever
--     be paused while they still have access -- there's no state where
--     someone is paused but locked out of the app.
alter table public.profiles add column if not exists subscription_paused boolean not null default false;
alter table public.profiles add column if not exists subscription_paid_through timestamptz;

-- Both are billing state, so they belong in the same locked-down group as
-- `subscribed` -- otherwise a rider could set subscription_paid_through to
-- the year 3000 from their browser console and ride free indefinitely.
-- (This replaces the version of the function in section 6b; re-running the
-- whole file is safe and lands on this final definition.)
create or replace function public.protect_service_only_columns()
returns trigger as $$
begin
  if current_user not in ('postgres', 'service_role') then
    if new.subscribed is distinct from old.subscribed
       or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id
       or new.subscription_paused is distinct from old.subscription_paused
       or new.subscription_paid_through is distinct from old.subscription_paid_through
       or new.comp_access is distinct from old.comp_access
       or new.comp_expires_at is distinct from old.comp_expires_at
       or new.strava_access_token is distinct from old.strava_access_token
       or new.strava_refresh_token is distinct from old.strava_refresh_token
       or new.strava_token_expires_at is distinct from old.strava_token_expires_at then
      raise exception 'This field can only be changed by the server.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security invoker;

-- The rider's own browser needs to *read* these two to know whether to show
-- "Pause" or "Resume" and when paused access runs out. Reading is fine --
-- the trigger above is what stops them being written.
grant select (
  id, name, ftp, trial_start, subscribed, settings, created_at,
  strava_athlete_id, training_plan, comp_access, comp_expires_at,
  subscription_paused, subscription_paid_through
) on public.profiles to authenticated, anon;

-- 23. Marketing / demo account ("Luca"). A permanently good-looking demo
--     account used for App Store screenshots, the marketing site and the
--     tutorial screenshots.
--
--     WHY THIS ISN'T JUST A ONE-OFF INSERT: everything on the home screen is
--     measured against *today's* date, not against stored values -- this
--     week's rides, the weekly streak (consecutive Monday-start weeks with a
--     ride), the 8-week training-load chart, and the "next up" nudge (days
--     since the last VO2 / FTP test / ride). A set of rows seeded once looks
--     perfect today, thin in two weeks, and dead in a month: the streak badge
--     vanishes and the load chart empties out.
--
--     So instead of seeding once, reseed_marketing_account() WIPES AND
--     REBUILDS this one account's history *relative to now()* every time it
--     runs. That's what "frozen" means here -- the picture is regenerated
--     against the current date, so it always looks the same. It's wired to
--     run daily off the existing email cron (api/email-sequence-cron.js), so
--     the account maintains itself, and it's safe to run by hand in the SQL
--     Editor any time to refresh it immediately.
--
--     `marketing_account` flags the account out of the owner dashboard
--     (admin_dashboard_stats, section 8) and the lifecycle emails, so its
--     seeded rides don't distort the real numbers or trigger customer emails.
alter table public.profiles add column if not exists marketing_account boolean default false;

-- IMPORTANT for future edits: this function ONLY rebuilds workout_history and
-- ftp_history (plus a few profile fields) for the one marketing account. It
-- must NEVER be broadened to touch training_plan, starred_workouts,
-- queued_workouts, saved_queues or custom_workouts -- those are set up once by
-- hand inside the app (sign in as Luca and use the Planner / star / queue /
-- Builder) and are deliberately left untouched here. Every statement is scoped
-- by this one user id; an unscoped delete here would wipe real riders' data.
create or replace function public.reseed_marketing_account()
returns void as $$
declare
  v_user_id uuid;
  v_ftp integer := 240;
begin
  -- Look the account up by email every run -- never hard-code a UUID, since it
  -- changes if the account is ever deleted and recreated.
  select id into v_user_id from auth.users where lower(email) = lower('mdownus@gmail.com');

  -- If the account doesn't exist on this database, do nothing rather than
  -- error. The whole setup file is re-run by hand and must not blow up on a
  -- machine where this account was never created.
  if v_user_id is null then
    return;
  end if;

  -- Profile. Name is just "Luca" -- no surname, which is fine (the home screen
  -- shows the first word, Settings shows it whole, and a single name reads
  -- cleanly in both). FTP 240 matches the most recent seeded FTP entry.
  -- comp_access unlocks the app permanently with no card; comp_expires_at
  -- stays null (that's the separate 30-day tester field). marketing_account
  -- keeps it out of the owner stats and the email sequence.
  update public.profiles
     set name = 'Luca',
         ftp = v_ftp,
         comp_access = true,
         comp_expires_at = null,
         subscribed = false,
         marketing_account = true
   where id = v_user_id;

  -- ---- FTP history: 5 entries over ~9 months, gently rising, so the home
  --      screen sparkline has a visible upward shape and a "+6" delta chip
  --      without looking suspiciously smooth.
  delete from public.ftp_history where user_id = v_user_id;
  insert into public.ftp_history (id, user_id, ftp, source, date) values
    ('mkt-ftp-1', v_user_id, 208, '20-minute test', now() - interval '38 weeks'),
    ('mkt-ftp-2', v_user_id, 219, 'Ramp test',      now() - interval '28 weeks'),
    ('mkt-ftp-3', v_user_id, 228, '20-minute test', now() - interval '19 weeks'),
    ('mkt-ftp-4', v_user_id, 234, 'Ramp test',      now() - interval '9 weeks'),
    ('mkt-ftp-5', v_user_id, 240, '20-minute test', now() - interval '3 weeks');

  -- ---- Workout history: rebuild ~10 weeks of rides, all dated as offsets
  --      from now(). A ride every ~2 days guarantees every Monday-start week
  --      in the range contains at least one (so the streak never has a gap)
  --      and that the last 7 days are always covered. Workout ids and names
  --      are real entries from LIBRARY in src/App.jsx. avg/max power and TSS
  --      vary by index so the Personal Records panel and the training-load
  --      chart read like a real person's, with a deliberately lighter stretch
  --      around week 6 so the load chart has shape rather than a flat wall.
  delete from public.workout_history where user_id = v_user_id;

  insert into public.workout_history
    (id, user_id, workout_id, name, category, duration, completed, date, avg_power, max_power, tss, calories, outdoor, rpe)
  select
    'mkt-ride-' || g.n,
    v_user_id,
    c.workout_id, c.name, c.category, c.duration,
    true,
    now() - make_interval(days => g.n * 2, hours => 5),
    c.avg_power + (g.n % 5) * 5,
    c.max_power + (g.n % 4) * 18,
    round((c.tss * case when g.n between 20 and 23 then 0.6 else 1 end)::numeric, 0),
    c.calories,
    false,
    null
  from generate_series(0, 33) as g(n)
  cross join lateral (
    select * from (values
      (0, 'endurance-hour',       'Steady endurance hour', 'Basics', 3600, 168, 235, 58, 610),
      (1, 'vo2-5x3',              'VO2 max 5×3',           'Basics', 2400, 205, 440, 62, 520),
      (2, 'ride-coastal-rollers', 'Coastal Rollers',       'Rides',  4200, 192, 480, 78, 720),
      (3, 'sweet-spot-builder',   'Sweet spot builder',    'Basics', 3600, 210, 300, 74, 640),
      (4, 'recovery-spin',        'Recovery spin',         'Basics', 1800, 130, 190, 26, 300),
      (5, 'threshold-2x20',       'Threshold 2×20',        'Basics', 3600, 228, 320, 88, 690),
      (6, 'ride-sunday-club',     'Sunday Club Run',       'Rides',  5400, 178, 520, 92, 880),
      (7, 'over-unders',          'Over-unders 4×4',       'Basics', 3300, 224, 360, 82, 650),
      (8, 'ride-chaingang',       'Chaingang Special',     'Rides',  3600, 236, 640, 90, 700),
      (9, 'rolling-endurance',    'Rolling endurance',     'Basics', 4200, 172, 260, 70, 720)
    ) as cat(idx, workout_id, name, category, duration, avg_power, max_power, tss, calories)
    where cat.idx = g.n % 10
  ) c;

  -- Two confirmed outdoor rides (no power stream -- an RPE instead, which the
  -- app uses to estimate their TSS), so the history looks like a real
  -- person's and the outdoor feature is visibly in use.
  insert into public.workout_history
    (id, user_id, workout_id, name, category, duration, completed, date, avg_power, max_power, tss, calories, outdoor, rpe)
  values
    ('mkt-outdoor-1', v_user_id, null, 'Outdoor ride', 'Rides', 5400, true, now() - interval '12 days' - interval '6 hours', null, null, 95,  820,  true, 6),
    ('mkt-outdoor-2', v_user_id, null, 'Outdoor ride', 'Rides', 7200, true, now() - interval '33 days' - interval '6 hours', null, null, 120, 1050, true, 7);

  -- One aborted ride mid-history -- real accounts have them, and it shows the
  -- app records a bailed session without counting it as a finish.
  insert into public.workout_history
    (id, user_id, workout_id, name, category, duration, completed, date, avg_power, max_power, tss, calories, outdoor, rpe)
  values
    ('mkt-aborted-1', v_user_id, 'ride-alpine-ascent', 'Alpine Ascent', 'Rides', 900, false, now() - interval '30 days' - interval '4 hours', 198, 410, 20, 180, false, null);

  -- One FTP-test ride near the most recent (3-week-old) FTP entry, so the ride
  -- history lines up with the FTP history above.
  insert into public.workout_history
    (id, user_id, workout_id, name, category, duration, completed, date, avg_power, max_power, tss, calories, outdoor, rpe)
  values
    ('mkt-ftptest-1', v_user_id, 'ftp-test-20', '20 minute FTP test', 'Basics', 3000, true, now() - interval '21 days' - interval '5 hours', 233, 360, 68, 560, false, null);
end;
$$ language plpgsql security definer set search_path = public;
