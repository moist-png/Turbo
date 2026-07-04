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

-- 4. Lock every table down so people can only ever see their own rows
alter table public.profiles enable row level security;
alter table public.custom_workouts enable row level security;
alter table public.ftp_history enable row level security;

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
-- logged-in user can touch \u2014 not which *columns*. Without the line below,
-- a technically-minded user could open their browser's developer tools and
-- set their own "subscribed" to true for free, without ever paying. This
-- revokes their ability to write to the three billing columns directly;
-- only the server-side webhook (api/stripe-webhook.js), which connects
-- with a special key that ignores this restriction entirely, is able to
-- set them. Everything else users already relied on \u2014 name, ftp, settings
-- \u2014 is untouched.
revoke update (subscribed, stripe_customer_id, stripe_subscription_id) on public.profiles from authenticated;
