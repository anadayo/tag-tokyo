import Stripe from "npm:stripe@22.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const SITE_URL = "https://anadayo.github.io/tag-tokyo/";
const allowedOrigins = new Set(["https://anadayo.github.io", "http://localhost:3000", "http://localhost:3342", "http://localhost:3344"]);

function stripeKeyMode(key: string) {
  if (/^(?:sk|rk)_test_/.test(key)) return "test";
  if (/^(?:sk|rk)_live_/.test(key)) return "live";
  return "unknown";
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://anadayo.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return Response.json({ error: "Method Not Allowed" }, { status: 405, headers });

  const authorization = request.headers.get("authorization");
  if (!authorization) return Response.json({ error: "ログインが必要です" }, { status: 401, headers });

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return Response.json({ error: "決済は現在準備中です" }, { status: 503, headers });

  let body: { productKey?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers }); }
  if (body.productKey !== "boost" && body.productKey !== "super-boost") {
    return Response.json({ error: "商品を確認できません" }, { status: 400, headers });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user?.email) return Response.json({ error: "ログイン状態を確認できません" }, { status: 401, headers });

  const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [{ data: controls }, { data: member }, { data: product }] = await Promise.all([
    serviceClient.from("commerce_controls").select("purchases_enabled,legal_review_completed,stripe_test_mode").eq("singleton", true).single(),
    serviceClient.from("users").select("id,status,age_verified,age_verification_status,terms_accepted_at,privacy_accepted_at").eq("auth_user_id", user.id).single(),
    serviceClient.from("commerce_products").select("product_key,name,description,unit_amount,currency,item_key,item_quantity,active").eq("product_key", body.productKey).single(),
  ]);
  if (!controls?.purchases_enabled || !controls.legal_review_completed) {
    return Response.json({ error: "販売開始前です" }, { status: 403, headers });
  }
  if (!member || member.status !== "active" || !member.age_verified || member.age_verification_status !== "verified"
    || !member.terms_accepted_at || !member.privacy_accepted_at) {
    return Response.json({ error: "購入にはメール認証・規約同意・20歳以上確認が必要です" }, { status: 403, headers });
  }
  if (!product?.active) return Response.json({ error: "現在購入できない商品です" }, { status: 404, headers });

  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count: recentOrders } = await serviceClient.from("payment_orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", member.id)
    .gte("created_at", tenMinutesAgo);
  if ((recentOrders ?? 0) >= 5) return Response.json({ error: "短時間に購入操作が続いています。10分ほどお待ちください" }, { status: 429, headers });

  const configuredMode = controls.stripe_test_mode ? "test" : "live";
  const actualMode = stripeKeyMode(stripeKey);
  if (configuredMode !== actualMode) return Response.json({ error: "決済設定を確認中です" }, { status: 503, headers });

  const { data: order, error: orderError } = await serviceClient.from("payment_orders").insert({
    user_id: member.id,
    product_key: product.product_key,
    amount_total: product.unit_amount,
    currency: product.currency,
  }).select("id").single();
  if (orderError || !order) return Response.json({ error: "注文を開始できませんでした" }, { status: 500, headers });

  const stripe = new Stripe(stripeKey);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email,
      client_reference_id: member.id,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: product.currency,
          unit_amount: product.unit_amount,
          product_data: { name: product.name, description: product.description },
        },
      }],
      metadata: { order_id: order.id, product_key: product.product_key },
      payment_intent_data: { metadata: { order_id: order.id, product_key: product.product_key, app_user_id: member.id } },
      success_url: `${SITE_URL}?purchase=success&order=${order.id}`,
      cancel_url: `${SITE_URL}?purchase=cancel&order=${order.id}`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      locale: "ja",
    }, { idempotencyKey: `tag-tokyo-order-${order.id}` });
    const { error: updateError } = await serviceClient.from("payment_orders")
      .update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() })
      .eq("id", order.id);
    if (updateError || !session.url) return Response.json({ error: "決済画面を準備できませんでした" }, { status: 500, headers });
    return Response.json({ checkoutUrl: session.url, orderId: order.id }, { headers });
  } catch {
    await serviceClient.from("payment_orders").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", order.id);
    return Response.json({ error: "決済画面を準備できませんでした" }, { status: 502, headers });
  }
});
