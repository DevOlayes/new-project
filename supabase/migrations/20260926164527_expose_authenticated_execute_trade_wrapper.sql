-- Recovered migration: authenticated wrapper for private AI trade execution.
-- The wrapper verifies auth.uid() before crossing into the private schema.

create or replace function public.execute_trade(
  p_user_id uuid,
  p_opportunity_id uuid,
  p_stake numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Unauthorized trade execution';
  end if;

  return private.execute_trade(p_user_id, p_opportunity_id, p_stake);
end;
$function$;

revoke all on function public.execute_trade(uuid,uuid,numeric) from anon;
grant execute on function public.execute_trade(uuid,uuid,numeric) to authenticated;
grant execute on function public.execute_trade(uuid,uuid,numeric) to service_role;
