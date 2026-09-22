import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type VerificationEvent = {
  auth_user_id: string;
  verification_reference: string;
  status: "verified" | "rejected" | "expired";
  method: string;
};

function hexToBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)));
}

async function signatureIsValid(body: string, signature: string | null, secret: string) {
  const supplied = signature ? hexToBytes(signature) : null;
  if (!supplied) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, supplied, new TextEncoder().encode(body));
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const secret = Deno.env.get("AGE_VERIFICATION_WEBHOOK_SECRET");
  if (!secret) return new Response("Age verification is not configured", { status: 503 });

  const body = await request.text();
  const valid = await signatureIsValid(body, request.headers.get("x-tag-verification-signature"), secret);
  if (!valid) return new Response("Unauthorized", { status: 401 });

  let event: VerificationEvent;
  try {
    event = JSON.parse(body) as VerificationEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(event.auth_user_id) || !/^[a-z0-9_-]{8,200}$/i.test(event.verification_reference)
    || !["verified", "rejected", "expired"].includes(event.status) || !/^[a-z0-9_-]{2,80}$/i.test(event.method)) {
    return new Response("Invalid verification event", { status: 400 });
  }

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const verified = event.status === "verified";
  const { error } = await client.from("users").update({
    age_verified: verified,
    age_verification_status: event.status,
    age_verified_at: verified ? new Date().toISOString() : null,
    age_verification_method: event.method,
    age_verification_reference: event.verification_reference,
  }).eq("auth_user_id", event.auth_user_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ accepted: true });
});
