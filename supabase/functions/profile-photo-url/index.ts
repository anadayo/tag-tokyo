import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  const authorization = request.headers.get("authorization");
  if (!authorization) return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });

  let body: { userIds?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders }); }
  const userIds = Array.isArray(body.userIds)
    ? [...new Set(body.userIds.filter((value): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)))].slice(0, 50)
    : [];
  if (userIds.length === 0) return Response.json({ urls: {} }, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
  const { data: paths, error: pathError } = await userClient.rpc("get_authorized_profile_photo_paths", { p_user_ids: userIds });
  if (pathError) return Response.json({ error: pathError.message }, { status: 403, headers: corsHeaders });

  const serviceClient = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const entries = await Promise.all((paths ?? []).map(async (item: { user_id: string; object_path: string }) => {
    const { data, error } = await serviceClient.storage.from("profile-photos").createSignedUrl(item.object_path, 300);
    return error || !data?.signedUrl ? null : [item.user_id, data.signedUrl] as const;
  }));
  return Response.json({ urls: Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)) }, { headers: corsHeaders });
});
