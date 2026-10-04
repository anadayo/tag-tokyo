import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://anadayo.github.io/tag-tokyo/";

function emailContent(template: string) {
  if (template === "age_verification_approved") {
    return {
      subject: "【TAG TOKYO】年齢確認が完了しました",
      text: `TAG TOKYOの年齢確認が完了しました。\n\n20歳以上の確認が取れたため、対象機能をご利用いただけます。\n${SITE_URL}\n\n安心して利用するため、初対面では人目のある場所を選び、金銭や個人情報の要求には応じないでください。\n\nこのメールは送信専用です。`,
    };
  }
  return {
    subject: "【TAG TOKYO】年齢確認画像の再提出をお願いします",
    text: `TAG TOKYOへ年齢確認画像をご提出いただきありがとうございます。\n\n今回の画像では、20歳以上であること、証明書名、発行者名のすべてを確認できなかったため、承認できませんでした。\n\n氏名・住所・顔写真・証明書番号は隠したまま、次の3項目が読める画像を再提出してください。\n・年齢または生年月日\n・証明書名\n・発行者名\n\n再提出: ${SITE_URL}\n\nこのメールは送信専用です。`,
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const authorization = request.headers.get("authorization") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const isCron = Boolean(cronSecret && authorization === `Bearer ${cronSecret}`);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!isCron) {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: moderator, error } = await userClient.rpc("is_moderator");
    if (error || moderator !== true) return new Response("Forbidden", { status: 403 });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("TAG_TOKYO_FROM_EMAIL");
  if (!resendKey || !from) return Response.json({ error: "email provider is not configured" }, { status: 503 });

  const client = createClient(url, serviceKey);
  const { data: queued, error: queueError } = await client
    .from("age_verification_notifications")
    .select("id,user_id,template,attempts")
    .in("status", ["pending", "failed"])
    .lt("attempts", 5)
    .order("created_at", { ascending: true })
    .limit(10);
  if (queueError) return Response.json({ error: queueError.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  for (const item of queued ?? []) {
    const { data: claimed } = await client
      .from("age_verification_notifications")
      .update({ status: "sending", attempts: item.attempts + 1, last_error: "" })
      .eq("id", item.id)
      .in("status", ["pending", "failed"])
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const { data: user } = await client.from("users").select("email").eq("id", item.user_id).maybeSingle();
    if (!user?.email) {
      await client.from("age_verification_notifications").update({ status: "failed", last_error: "recipient email unavailable" }).eq("id", item.id);
      failed += 1;
      continue;
    }

    const content = emailContent(item.template);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [user.email], subject: content.subject, text: content.text }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 450);
      await client.from("age_verification_notifications").update({ status: "failed", last_error: detail }).eq("id", item.id);
      failed += 1;
      continue;
    }

    await client.from("age_verification_notifications").update({ status: "sent", sent_at: new Date().toISOString(), last_error: "" }).eq("id", item.id);
    sent += 1;
  }

  return Response.json({ ok: true, sent, failed });
});
