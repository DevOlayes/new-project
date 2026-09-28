-- Recovered migration: communication and login identity preferences.
-- Columns are added idempotently so this historical migration can be replayed safely.

alter table if exists public.profiles
  add column if not exists email text;

alter table if exists public.profiles
  add column if not exists email_marketing_opt_in boolean not null default false;

alter table if exists public.profiles
  add column if not exists telegram_bot_access_granted boolean not null default false;

alter table if exists public.profiles
  add column if not exists telegram_notifications_enabled boolean not null default true;

alter table if exists public.profiles
  add column if not exists telegram_connected_at timestamptz;

alter table if exists public.profiles
  add column if not exists last_login_provider text;
