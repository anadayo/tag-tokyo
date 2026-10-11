"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    adsbygoogle?: Record<string, unknown>[];
  }
}

type AdSlotProps = {
  slot?: string;
  placement: "home" | "map";
};

export function AdSlot({ slot = "", placement }: AdSlotProps) {
  const initialized = useRef(false);
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim() || "ca-pub-6265700167821181";
  const preview = process.env.NEXT_PUBLIC_ADSENSE_PREVIEW === "true";
  const ready = /^ca-pub-\d{16}$/.test(client) && /^\d+$/.test(slot);

  useEffect(() => {
    if (!ready || initialized.current) return;
    initialized.current = true;
    window.adsbygoogle = window.adsbygoogle || [];
    window.adsbygoogle.push({});
  }, [ready]);

  if (preview && !ready) {
    return <aside className="ad-unit ad-unit-preview" aria-label={`${placement}広告プレビュー`}><small>広告プレビュー</small><span>AdSense 審査後に配信</span></aside>;
  }
  if (!ready) return null;

  return <aside className="ad-unit" aria-label="広告">
    <small>広告</small>
    <ins
      className="adsbygoogle"
      style={{ display: "block" }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  </aside>;
}
