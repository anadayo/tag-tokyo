import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request) => {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error } = await client.rpc("cleanup_expired_private_data");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, cleanedAt: new Date().toISOString() });
});
