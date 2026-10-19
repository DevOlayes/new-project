alter table public.profiles
  add column if not exists username text,
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz;

create unique index if not exists profiles_active_username_lower_uidx
  on public.profiles (lower(username))
  where username is not null and is_deleted = false;

create unique index if not exists wallets_user_asset_network_uidx
  on public.wallets (user_id, asset, network);

-- Every account has a USDT ledger wallet by default. Optional assets such as TON
-- are only provisioned through an explicit supported action, never as an assumed address.
insert into public.wallets (user_id, asset, network)
select p.id, 'USDT', 'TRC-20'
from public.profiles p
where not p.is_deleted
  and not exists (
    select 1 from public.wallets w
    where w.user_id = p.id and w.asset = 'USDT' and w.network = 'TRC-20'
  );

create or replace function public.sync_auth_identity_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  provider text;
  telegram_id text;
  telegram_username text;
  account_username text;
begin
  provider := coalesce(new.raw_app_meta_data->>'provider','');
  telegram_id := coalesce(new.raw_user_meta_data->>'sub', new.raw_user_meta_data->>'id');
  telegram_username := new.raw_user_meta_data->>'preferred_username';
  account_username := nullif(lower(trim(new.raw_user_meta_data->>'username')), '');

  insert into public.profiles (
    id, username, email, display_name, avatar_url, telegram_user_id,
    telegram_username, telegram_bot_access_granted, telegram_connected_at,
    last_login_provider
  )
  values (
    new.id, account_username, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(coalesce(new.email,''),'@',1), 'Flexa AI user'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    case when provider = 'custom:telegram' and telegram_id ~ '^[0-9]+$' then telegram_id::bigint end,
    case when provider = 'custom:telegram' then telegram_username end,
    provider = 'custom:telegram',
    case when provider = 'custom:telegram' then now() end,
    nullif(provider,'')
  )
  on conflict (id) do update set
    email = excluded.email,
    username = coalesce(excluded.username, public.profiles.username),
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    telegram_user_id = coalesce(excluded.telegram_user_id, public.profiles.telegram_user_id),
    telegram_username = coalesce(excluded.telegram_username, public.profiles.telegram_username),
    telegram_bot_access_granted = case when provider = 'custom:telegram' then true else public.profiles.telegram_bot_access_granted end,
    telegram_connected_at = coalesce(excluded.telegram_connected_at, public.profiles.telegram_connected_at),
    last_login_provider = excluded.last_login_provider,
    updated_at = now();

  insert into public.wallets (user_id, asset, network)
  select new.id, 'USDT', 'TRC-20'
  where not exists (
    select 1 from public.wallets w where w.user_id = new.id and w.asset = 'USDT' and w.network = 'TRC-20'
  );

  return new;
end;
$function$;
