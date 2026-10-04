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

  const now = new Date().toISOString();
  const { data: evidence, error: evidenceQueryError } = await client
    .from("age_verification_requests")
    .select("id,object_path")
    .is("evidence_deleted_at", null)
    .lte("delete_by", now);
  if (evidenceQueryError) return Response.json({ error: evidenceQueryError.message }, { status: 500 });

  const paths = (evidence ?? []).map((item) => item.object_path);
  if (paths.length > 0) {
    const { error: removeError } = await client.storage.from("age-verification-evidence").remove(paths);
    if (removeError) return Response.json({ error: removeError.message }, { status: 500 });
    const ids = (evidence ?? []).map((item) => item.id);
    const { error: markError } = await client
      .from("age_verification_requests")
      .update({ evidence_deleted_at: now })
      .in("id", ids);
    if (markError) return Response.json({ error: markError.message }, { status: 500 });
  }

  return Response.json({ ok: true, deletedAgeEvidence: paths.length, cleanedAt: now });
});
