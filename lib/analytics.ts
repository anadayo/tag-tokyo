import { supabase } from "@/lib/supabase";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function track(name: string, parameters: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.gtag?.("event", name, { service: "tag_tokyo", ...parameters });
  const funnelEvents = new Set(["visit", "registration_start", "email_auth_complete", "tag_on_started", "cross_created", "match_created", "checkout_started"]);
  if (!supabase || !funnelEvents.has(name)) return;
  const key = "tagtokyo_analytics_session_v1";
  let sessionId = window.sessionStorage.getItem(key);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    window.sessionStorage.setItem(key, sessionId);
  }
  const allowedKeys = new Set(["product_key", "source", "result", "matched", "duration_minutes", "value", "currency"]);
  const metadata = Object.fromEntries(Object.entries(parameters).filter(([parameter, value]) =>
    allowedKeys.has(parameter) && ["string", "number", "boolean"].includes(typeof value)
  ));
  void supabase.rpc("record_product_event", {
    p_event_name: name,
    p_anonymous_session_id: sessionId,
    p_metadata: metadata,
  });
}
