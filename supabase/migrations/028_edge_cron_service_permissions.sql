-- Scheduled Edge Functions use the service role to invoke these private RPCs.
-- Keep them unavailable to browsers and signed-in members.

revoke all on function public.detect_crossings_private(integer, integer)
  from public, anon, authenticated;
revoke all on function public.cleanup_expired_private_data()
  from public, anon, authenticated;

grant execute on function public.detect_crossings_private(integer, integer)
  to service_role;
grant execute on function public.cleanup_expired_private_data()
  to service_role;
