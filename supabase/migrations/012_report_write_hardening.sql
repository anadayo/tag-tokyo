-- Reports must pass through the rate-limited match-aware RPC.

revoke insert on public.reports from authenticated;
