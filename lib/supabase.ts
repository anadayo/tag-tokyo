import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabase = Boolean(url && key);
export const supabase = hasSupabase ? createClient(url!, key!) : null;

// A configured database alone must never turn on real-world matching.
// The owner enables it only after the launch checklist is complete.
export const isLiveCommunityEnabled = hasSupabase && process.env.NEXT_PUBLIC_TAG_TOKYO_LIVE_ENABLED === "true";
