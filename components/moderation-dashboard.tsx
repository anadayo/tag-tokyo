"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, ShieldAlert, Trash2, X } from "lucide-react";
import { hasSupabase, supabase } from "@/lib/supabase";

type ReviewRequest = {
  id: string;
  user_id: string;
  object_path: string;
  document_type: string;
  status: "pending" | "approved" | "rejected";
  submitted_at: string;
  delete_by: string;
  reviewed_at: string | null;
  review_note: string;
  evidence_deleted_at: string | null;
};

const DOCUMENT_LABELS: Record<string, string> = {
  drivers_license: "運転免許証",
  passport: "パスポート",
  residence_card: "在留カード",
  other: "その他の公的証明書",
};

export function ModerationDashboard() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return setAllowed(false);
    setNotice("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return setAllowed(false);
    const { data: account } = await supabase.from("users").select("role,status").eq("auth_user_id", user.id).maybeSingle();
    if (!account || account.status !== "active" || !["owner", "moderator"].includes(account.role)) return setAllowed(false);
    setAllowed(true);
    const { data, error } = await supabase.from("age_verification_requests").select("id,user_id,object_path,document_type,status,submitted_at,delete_by,reviewed_at,review_note,evidence_deleted_at").order("submitted_at", { ascending: false }).limit(100);
    if (error) return setNotice(error.message);
    setRequests((data ?? []) as ReviewRequest[]);

    const pending = (data ?? []).filter((item) => !item.evidence_deleted_at) as ReviewRequest[];
    const signed = await Promise.all(pending.map(async (item) => {
      const { error: auditError } = await supabase!.rpc("record_age_verification_view", { p_request_id: item.id });
      if (auditError) return [item.id, ""] as const;
      const { data: urlData } = await supabase!.storage.from("age-verification-evidence").createSignedUrl(item.object_path, 300);
      return [item.id, urlData?.signedUrl ?? ""] as const;
    }));
    setImageUrls(Object.fromEntries(signed));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function review(item: ReviewRequest, approved: boolean) {
    if (!supabase || item.status !== "pending") return;
    const note = approved ? "20歳以上を確認" : window.prompt("却下理由を入力してください（個人情報は書かない）", "必要な3項目を確認できません")?.trim();
    if (!approved && !note) return;
    setBusy(item.id);
    setNotice("");
    const { data: objectPath, error: reviewError } = await supabase.rpc("review_age_verification", { p_request_id: item.id, p_approved: approved, p_note: note });
    if (reviewError) {
      setBusy(null);
      return setNotice(reviewError.message);
    }
    const path = String(objectPath || item.object_path);
    const { error: removeError } = await supabase.storage.from("age-verification-evidence").remove([path]);
    if (removeError) {
      setBusy(null);
      setNotice(`判定は保存しましたが画像削除に失敗しました。至急Storageから削除してください: ${removeError.message}`);
      return void load();
    }
    const { error: markError } = await supabase.rpc("mark_age_evidence_deleted", { p_request_id: item.id });
    setBusy(null);
    setNotice(markError ? `画像は削除済みですが削除記録の更新に失敗しました: ${markError.message}` : `${approved ? "承認" : "却下"}し、画像原本を削除しました`);
    await load();
  }

  if (!hasSupabase) return <main className="moderation-page"><h1>年齢確認</h1><p>Supabase設定が必要です。</p></main>;
  if (allowed === null) return <main className="moderation-page"><h1>年齢確認</h1><p>権限を確認しています...</p></main>;
  if (!allowed) return <main className="moderation-page denied"><ShieldAlert /><h1>運営者専用です</h1><p>オーナーまたはモデレーターのアカウントでログインしてください。</p><a href="../">TAG TOKYOへ戻る</a></main>;

  return <main className="moderation-page">
    <header><div><small>TAG TOKYO / SAFETY</small><h1>年齢確認キュー</h1></div><button onClick={() => void load()} aria-label="更新"><RefreshCw /></button></header>
    <div className="moderation-warning"><ShieldAlert /><p><b>画像は審査以外に利用しないでください。</b><br />確認するのは年齢または生年月日、証明書名、発行者名のみです。判定後は原本を即時削除します。</p></div>
    {notice && <p className="moderation-notice" role="status">{notice}</p>}
    <section className="review-list">
      {requests.length === 0 && <p className="empty-review">審査待ちはありません。</p>}
      {requests.map((item) => <article className="review-card" key={item.id}>
        <div className="review-meta"><span className={`review-state ${item.status}`}>{item.status}</span><b>{DOCUMENT_LABELS[item.document_type] ?? item.document_type}</b><small>提出 {new Date(item.submitted_at).toLocaleString("ja-JP")}</small><small>ID {item.id.slice(0, 8)}</small></div>
        {item.evidence_deleted_at
          ? <div className="evidence-deleted"><Trash2 />画像原本は削除済み</div>
          : imageUrls[item.id]
            // eslint-disable-next-line @next/next/no-img-element -- short-lived private signed URL.
            ? <img className="evidence-image" src={imageUrls[item.id]} alt="年齢確認の提出画像" />
            : <div className="evidence-deleted"><ShieldAlert />画像を表示できません</div>}
        {item.status === "pending" && <div className="review-actions"><button disabled={busy === item.id} onClick={() => void review(item, false)}><X />却下</button><button disabled={busy === item.id} onClick={() => void review(item, true)}><Check />20歳以上を承認</button></div>}
        {item.status !== "pending" && <p className="review-note">{item.review_note || "審査メモなし"}</p>}
      </article>)}
    </section>
  </main>;
}
