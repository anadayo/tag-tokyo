"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Check, CreditCard, Flag, HeartHandshake, RefreshCw, ShieldAlert, Trash2, TrendingUp, UsersRound, X } from "lucide-react";
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

type ReviewChecks = { age: boolean; document: boolean; issuer: boolean };
type AdminStats = { registeredUsers: number; confirmedEmails: number; betaTesters: number; remainingSlots: number; dau: number; activeMatches: number; openReports: number };
type CommerceStats = { visits: number; registrations: number; confirmedEmails: number; tagUsers: number; crossings: number; matches: number; checkoutStarts: number; paidOrders: number; grossSales: number; refundTotal: number };
type SafetyReport = { id: number; reason: string; detail: string; status: "open" | "in_review" | "actioned" | "closed"; priority: number; created_at: string };

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
  const [checks, setChecks] = useState<Record<string, ReviewChecks>>({});
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [commerceStats, setCommerceStats] = useState<CommerceStats | null>(null);
  const [reports, setReports] = useState<SafetyReport[]>([]);

  function setCheck(requestId: string, key: keyof ReviewChecks, value: boolean) {
    setChecks((current) => {
      const previous = current[requestId] ?? { age: false, document: false, issuer: false };
      return { ...current, [requestId]: { ...previous, [key]: value } };
    });
  }

  const load = useCallback(async () => {
    if (!supabase) return setAllowed(false);
    setNotice("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return setAllowed(false);
    const { data: account } = await supabase.from("users").select("role,status").eq("auth_user_id", user.id).maybeSingle();
    if (!account || account.status !== "active" || !["owner", "moderator"].includes(account.role)) return setAllowed(false);
    setAllowed(true);
    const [{ data, error }, statsResult, reportsResult, commerceResult] = await Promise.all([
      supabase.from("age_verification_requests").select("id,user_id,object_path,document_type,status,submitted_at,delete_by,reviewed_at,review_note,evidence_deleted_at").order("submitted_at", { ascending: false }).limit(100),
      supabase.rpc("get_beta_admin_stats"),
      supabase.from("reports").select("id,reason,detail,status,priority,created_at").order("priority", { ascending: false }).order("created_at", { ascending: false }).limit(100),
      supabase.rpc("get_commerce_admin_stats", { p_days: 30 }),
    ]);
    if (error) return setNotice(error.message);
    setRequests((data ?? []) as ReviewRequest[]);
    if (!reportsResult.error) setReports((reportsResult.data ?? []) as SafetyReport[]);
    const statRow = Array.isArray(statsResult.data) ? statsResult.data[0] : statsResult.data;
    if (statRow) setStats({ registeredUsers: Number(statRow.registered_users), confirmedEmails: Number(statRow.confirmed_emails), betaTesters: Number(statRow.beta_testers), remainingSlots: Number(statRow.remaining_slots), dau: Number(statRow.dau), activeMatches: Number(statRow.active_matches), openReports: Number(statRow.open_reports) });
    const commerceRow = Array.isArray(commerceResult.data) ? commerceResult.data[0] : commerceResult.data;
    if (!commerceResult.error && commerceRow) setCommerceStats({
      visits: Number(commerceRow.visits), registrations: Number(commerceRow.registrations), confirmedEmails: Number(commerceRow.confirmed_emails),
      tagUsers: Number(commerceRow.tag_users), crossings: Number(commerceRow.crossings), matches: Number(commerceRow.matches),
      checkoutStarts: Number(commerceRow.checkout_starts), paidOrders: Number(commerceRow.paid_orders),
      grossSales: Number(commerceRow.gross_sales), refundTotal: Number(commerceRow.refund_total),
    });

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
    const itemChecks = checks[item.id] ?? { age: false, document: false, issuer: false };
    if (approved && !Object.values(itemChecks).every(Boolean)) return setNotice("承認前に3項目すべてを確認してください");
    const note = approved ? "20歳以上・証明書名・発行者名を確認" : "必要な3項目を確認できないため再提出";
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
    const { error: emailError } = await supabase.functions.invoke("send-age-verification-notifications");
    setBusy(null);
    if (markError) setNotice(`画像は削除済みですが削除記録の更新に失敗しました: ${markError.message}`);
    else if (emailError) setNotice(`${approved ? "承認" : "却下"}と画像削除は完了しました。メールは送信待ちです。`);
    else setNotice(`${approved ? "承認・利用解放" : "却下"}、画像削除、定型メール送信が完了しました`);
    await load();
  }

  async function updateReport(reportId: number, status: SafetyReport["status"]) {
    if (!supabase) return;
    setBusy(`report-${reportId}`);
    const action = status === "in_review" ? "assigned" : status === "closed" ? "closed" : "warned";
    const { error } = await supabase.rpc("review_report", { p_report_id: reportId, p_status: status, p_action: action, p_note: "運営画面から更新", p_pause_reported_user: false });
    setBusy(null);
    if (error) return setNotice(error.message);
    setNotice("通報状況を更新しました");
    await load();
  }

  if (!hasSupabase) return <main className="moderation-page"><h1>年齢確認</h1><p>Supabase設定が必要です。</p></main>;
  if (allowed === null) return <main className="moderation-page"><h1>年齢確認</h1><p>権限を確認しています...</p></main>;
  if (!allowed) return <main className="moderation-page denied"><ShieldAlert /><h1>運営者専用です</h1><p>オーナーまたはモデレーターのアカウントでログインしてください。</p><a href="../">TAG TOKYOへ戻る</a></main>;

  return <main className="moderation-page">
    <header><div><small>TAG TOKYO / SAFETY</small><h1>年齢確認キュー</h1></div><button onClick={() => void load()} aria-label="更新"><RefreshCw /></button></header>
    {stats && <section className="admin-stats" aria-label="運用状況">
      <div><UsersRound /><span><small>登録 / 認証</small><b>{stats.registeredUsers} / {stats.confirmedEmails}</b></span></div>
      <div><Check /><span><small>β TESTER</small><b>{stats.betaTesters}<em> 残り{stats.remainingSlots}</em></b></span></div>
      <div><Activity /><span><small>24h ACTIVE</small><b>{stats.dau}</b></span></div>
      <div><HeartHandshake /><span><small>MATCH</small><b>{stats.activeMatches}</b></span></div>
      <div><Flag /><span><small>未対応通報</small><b>{stats.openReports}</b></span></div>
    </section>}
    {commerceStats && <section className="commerce-admin" aria-label="直近30日の収益化指標">
      <header><TrendingUp /><div><small>LAST 30 DAYS</small><h2>登録・交流・売上</h2></div></header>
      <div className="commerce-admin-grid">
        <span><small>訪問</small><b>{commerceStats.visits.toLocaleString()}</b></span>
        <span><small>新規登録</small><b>{commerceStats.registrations.toLocaleString()}</b></span>
        <span><small>メール認証</small><b>{commerceStats.confirmedEmails.toLocaleString()}</b></span>
        <span><small>TAG利用者</small><b>{commerceStats.tagUsers.toLocaleString()}</b></span>
        <span><small>CROSS</small><b>{commerceStats.crossings.toLocaleString()}</b></span>
        <span><small>MATCH</small><b>{commerceStats.matches.toLocaleString()}</b></span>
        <span><small>決済到達</small><b>{commerceStats.checkoutStarts.toLocaleString()}</b></span>
        <span><small>購入完了</small><b>{commerceStats.paidOrders.toLocaleString()}</b></span>
      </div>
      <div className="commerce-money"><span><CreditCard /><small>売上</small><b>¥{commerceStats.grossSales.toLocaleString()}</b></span><span><small>返金</small><b>¥{commerceStats.refundTotal.toLocaleString()}</b></span><span><small>純売上</small><b>¥{Math.max(0, commerceStats.grossSales - commerceStats.refundTotal).toLocaleString()}</b></span></div>
    </section>}
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
        {item.status === "pending" && <>
          <div className="review-checklist" aria-label="承認条件">
            <label><input type="checkbox" checked={checks[item.id]?.age ?? false} onChange={(event) => setCheck(item.id, "age", event.target.checked)} /><span><b>20歳以上</b><small>年齢または生年月日で確認</small></span></label>
            <label><input type="checkbox" checked={checks[item.id]?.document ?? false} onChange={(event) => setCheck(item.id, "document", event.target.checked)} /><span><b>証明書名</b><small>公的証明書の種類を確認</small></span></label>
            <label><input type="checkbox" checked={checks[item.id]?.issuer ?? false} onChange={(event) => setCheck(item.id, "issuer", event.target.checked)} /><span><b>発行者名</b><small>公的機関の発行を確認</small></span></label>
          </div>
          <div className="review-actions"><button disabled={busy === item.id} onClick={() => void review(item, false)}><X />再提出を依頼</button><button disabled={busy === item.id || !Object.values(checks[item.id] ?? {}).every(Boolean) || Object.keys(checks[item.id] ?? {}).length !== 3} onClick={() => void review(item, true)}><Check />承認して利用解放</button></div>
        </>}
        {item.status !== "pending" && <p className="review-note">{item.review_note || "審査メモなし"}</p>}
      </article>)}
    </section>
    <section className="report-queue">
      <header><Flag /><div><small>SAFETY REPORTS</small><h2>通報状況</h2></div></header>
      {reports.length === 0 ? <p className="review-empty">通報はありません。</p> : reports.map((report) => <article key={report.id}>
        <div><span className={`review-state ${report.status}`}>{report.status}</span><b>{report.reason}</b><small>{new Date(report.created_at).toLocaleString("ja-JP")} · 優先度 {report.priority}</small>{report.detail && <p>{report.detail}</p>}</div>
        <div className="report-actions"><button disabled={busy === `report-${report.id}`} onClick={() => void updateReport(report.id, "in_review")}>確認中</button><button disabled={busy === `report-${report.id}`} onClick={() => void updateReport(report.id, "actioned")}>対応済み</button><button disabled={busy === `report-${report.id}`} onClick={() => void updateReport(report.id, "closed")}>閉じる</button></div>
      </article>)}
    </section>
  </main>;
}
