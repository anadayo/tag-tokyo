"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileWarning, ShieldCheck, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import type { EditableProfile } from "@/lib/types";

type VerificationStatus = "not_started" | "pending" | "verified" | "rejected" | "expired";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function verificationErrorMessage(message: string) {
  if (message.includes("verification already pending")) return "すでに確認中です。再提出は不要です";
  if (message.includes("terms and privacy consent required")) return "利用規約とプライバシーポリシーへの同意を完了してください";
  if (message.includes("evidence upload not found")) return "画像の送信を確認できませんでした。もう一度選び直してください";
  if (message.includes("row-level security") || message.includes("Unauthorized")) return "ログイン状態を確認できませんでした。認証メールのリンクから開き直してください";
  if (message.includes("payload too large") || message.includes("maximum allowed size")) return "画像サイズが大きすぎます。5MB以下にしてください";
  return "送信できませんでした。通信状態を確認して、もう一度お試しください";
}

export function AgeVerificationPanel({ authenticated, consentReady, initialStatus, profile, onStartRegistration }: { authenticated: boolean; consentReady: boolean; initialStatus: VerificationStatus; profile: EditableProfile; onStartRegistration?: () => void }) {
  const [status, setStatus] = useState(initialStatus);
  const [documentType, setDocumentType] = useState("drivers_license");
  const [file, setFile] = useState<File | null>(null);
  const [masked, setMasked] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(consentReady);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [backendReady, setBackendReady] = useState<boolean | null>(authenticated ? null : false);

  useEffect(() => {
    if (!authenticated || !supabase) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      const { error } = await supabase!.from("age_verification_requests").select("id").limit(1);
      if (active) setBackendReady(!error);
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [authenticated]);

  async function submit() {
    if (!supabase || !authenticated) return setNotice("先にメール認証を完了してください");
    if (!file || !MIME_EXTENSIONS[file.type] || file.size > 5 * 1024 * 1024) return setNotice("5MB以下のJPEG・PNG・WebP画像を選んでください");
    if (!masked) return setNotice("隠す項目を確認してからチェックしてください");
    if (!legalAccepted) return setNotice("利用規約とプライバシーポリシーへの同意が必要です");

    setSubmitting(true);
    track("age_verification_start", { document_type: documentType });
    setNotice("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      return setNotice("ログイン状態を確認できませんでした");
    }
    if (!consentReady) {
      const { error: consentError } = await supabase.rpc("complete_profile_onboarding", {
        p_display_name: profile.displayName,
        p_handle: profile.handle,
        p_gender: profile.gender,
        p_terms_version: "2026-10-05",
        p_privacy_version: "2026-10-05",
      });
      if (consentError) {
        setSubmitting(false);
        return setNotice(verificationErrorMessage(consentError.message));
      }
    }
    const path = `${user.id}/${crypto.randomUUID()}.${MIME_EXTENSIONS[file.type]}`;
    const { error: uploadError } = await supabase.storage.from("age-verification-evidence").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      setSubmitting(false);
      return setNotice(verificationErrorMessage(uploadError.message));
    }
    const { error: requestError } = await supabase.rpc("submit_age_verification", { p_object_path: path, p_document_type: documentType });
    if (requestError) {
      await supabase.storage.from("age-verification-evidence").remove([path]);
      setSubmitting(false);
      return setNotice(verificationErrorMessage(requestError.message));
    }
    setStatus("pending");
    setFile(null);
    setSubmitting(false);
    setNotice("提出を受け付けました。運営確認後、画像原本を削除します。");
    track("age_verification_complete", { status: "pending" });
  }

  if (status === "verified") return <div className="age-status verified"><CheckCircle2 /><span><b>20歳以上を確認済み</b><small>審査に使った画像原本は確認後に削除します</small></span></div>;
  if (status === "pending") return <div className="age-status pending verification-wait"><ShieldCheck /><span><b>運営確認中</b><small>確認目安：通常24時間以内（β版のため前後する場合があります）</small><small>再提出は不要です。承認後、TAG・MATCH・メッセージが利用できます</small></span></div>;
  if (!authenticated) return <div className="age-status pending age-registration-gate"><ShieldCheck /><span><b>まずメール認証を完了してください</b><small>認証後、この場所から年齢確認画像を提出できます</small></span>{onStartRegistration && <button type="button" onClick={onStartRegistration}>登録を始める</button>}</div>;
  if (authenticated && backendReady !== true) return <div className="age-status pending"><ShieldCheck /><span><b>{backendReady === null ? "年齢確認を準備しています" : "年齢確認はまだ利用できません"}</b><small>{backendReady === null ? "安全な接続を確認中です" : "運営側の設定完了後に提出できます"}</small></span></div>;

  return <div className="age-verification-panel">
    <div className="age-warning"><FileWarning /><span><b>{status === "rejected" ? "再提出が必要です" : "20歳以上の確認"}</b><small>氏名・住所・顔写真・証明書番号は必ず隠してください</small></span></div>
    <p>画像に残すのは「年齢または生年月日」「証明書名」「発行者名」だけです。原本全体をそのまま送らないでください。</p>
    <label className="field"><span>証明書の種類</span><select value={documentType} onChange={(event) => setDocumentType(event.target.value)} disabled={!authenticated || submitting}><option value="drivers_license">運転免許証</option><option value="passport">パスポート</option><option value="residence_card">在留カード</option><option value="other">その他の公的証明書</option></select></label>
    <label className="id-upload"><Upload /><span>{file ? file.name : "身分証画像を選択"}<small>不要な項目を隠した画像 / JPEG・PNG・WebP / 5MBまで</small></span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={!authenticated || submitting} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
    <label className="access-check"><input type="checkbox" checked={masked} onChange={(event) => setMasked(event.target.checked)} disabled={!authenticated || submitting} /><span>氏名・住所・顔写真・証明書番号を隠したことを確認しました</span></label>
    {!consentReady && <label className="access-check"><input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} disabled={!authenticated || submitting} /><span><a href="./terms/" target="_blank" rel="noreferrer">利用規約</a>と<a href="./privacy/" target="_blank" rel="noreferrer">プライバシーポリシー</a>に同意する</span></label>}
    <button className="primary-wide" disabled={!authenticated || !file || !masked || !legalAccepted || submitting} onClick={submit}>{submitting ? "安全に送信中..." : authenticated ? "運営確認へ提出" : "メール認証後に提出できます"}</button>
    {notice && <p className="field-notice" role="status">{notice}</p>}
  </div>;
}
