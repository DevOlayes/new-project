-- Recovered migration: lock identity synchronization behind the Auth trigger.
-- The sync function is not exposed as an authenticated/anonymous RPC.
-- Trigger execution remains available through the SECURITY DEFINER function.

revoke all on function public.sync_auth_identity_to_profile() from public;
revoke all on function public.sync_auth_identity_to_profile() from anon;
revoke all on function public.sync_auth_identity_to_profile() from authenticated;
grant execute on function public.sync_auth_identity_to_profile() to service_role;
