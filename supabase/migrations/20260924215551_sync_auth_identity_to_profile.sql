-- Recovered migration: synchronize Supabase Auth identity into public.profiles.
-- The trigger is intentionally SECURITY DEFINER and has a fixed search_path.

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
begin
  provider := coalesce(new.raw_app_meta_data->>'provider','');
  telegram_id := coalesce(new.raw_user_meta_data->>'sub', new.raw_user_meta_data->>'id');
  telegram_username := new.raw_user_meta_data->>'preferred_username';

  insert into public.profiles (
    id,
    email,
    display_name,
    avatar_url,
    telegram_user_id,
    telegram_username,
    telegram_bot_access_granted,
    telegram_connected_at,
    last_login_provider
  )
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email,''),'@',1),
      'Flexa AI user'
    ),
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    ),
    case
      when provider = 'custom:telegram'
       and telegram_id ~ '^[0-9]+$'
      then telegram_id::bigint
    end,
    case when provider = 'custom:telegram' then telegram_username end,
    provider = 'custom:telegram',
    case when provider = 'custom:telegram' then now() end,
    nullif(provider,'')
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    telegram_user_id = coalesce(excluded.telegram_user_id, public.profiles.telegram_user_id),
    telegram_username = coalesce(excluded.telegram_username, public.profiles.telegram_username),
    telegram_bot_access_granted = case
      when provider = 'custom:telegram' then true
      else public.profiles.telegram_bot_access_granted
    end,
    telegram_connected_at = coalesce(excluded.telegram_connected_at, public.profiles.telegram_connected_at),
    last_login_provider = excluded.last_login_provider,
    updated_at = now();

  return new;
end;
$function$;

revoke all on function public.sync_auth_identity_to_profile() from public;
revoke all on function public.sync_auth_identity_to_profile() from anon;
revoke all on function public.sync_auth_identity_to_profile() from authenticated;
grant execute on function public.sync_auth_identity_to_profile() to service_role;

drop trigger if exists on_auth_user_identity_sync on auth.users;

create trigger on_auth_user_identity_sync
after insert or update of email, raw_user_meta_data, raw_app_meta_data
on auth.users
for each row
execute function public.sync_auth_identity_to_profile();
