"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck, Ban, Bell, Camera, ChevronRight, Clock3, Crown, Flag, Gift, HeartHandshake, Home, LockKeyhole, LogOut, Map,
  MapPin, MessageCircle, Minus, Plus, Power, ShieldCheck, ShoppingBag,
  Send, Sparkles, Star, Trophy, UserRound, UsersRound, Zap,
} from "lucide-react";
import { track } from "@/lib/analytics";
import { AgeVerificationPanel } from "@/components/age-verification-panel";
import {
  COSMETICS, DAILY_LOGIN_EXP, getLevelProgress, INITIAL_GROWTH, INITIAL_PROFILE, PROFILE_UNLOCKS,
  TAG_SPOTS, TOKYO_AREAS,
} from "@/lib/game";
import { isInsideTokyo, requestPrivateLocation } from "@/lib/location";
import { hasSupabase, isLiveCommunityEnabled, supabase } from "@/lib/supabase";
import type { EditableProfile, GrowthState, LiveCrossing, LiveMatch, LiveMessage, OfficialProfile, TabId, TagDuration, TagSessionState } from "@/lib/types";

const INITIAL_SESSION: TagSessionState = {
  active: false,
  duration: 60,
  startedAt: null,
  expiresAt: null,
  areaLabel: null,
};
const ASSET_PREFIX = process.env.NODE_ENV === "production" ? "/tag-tokyo" : "";
const HANDLE_PATTERN = /^[A-Za-z0-9_]{5,15}$/;
const TERMS_VERSION = "2026-10-04";
const PRIVACY_VERSION = "2026-10-04";

function ProfilePhoto({ profile, className = "" }: { profile: EditableProfile; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- local data URL, not a network image.
  if (profile.avatarDataUrl) return <img className={`profile-photo ${className}`} src={profile.avatarDataUrl} alt="プロフィール写真" />;
  return <span className={className}>{profile.displayName.slice(0, 1).toUpperCase()}</span>;
}

function MessageAccessGate({ onClose, onEmail }: { onClose: () => void; onEmail: (email: string, gender: EditableProfile["gender"]) => void }) {
  const [email, setEmail] = useState("");
  const [gender, setGender] = useState<EditableProfile["gender"]>("unspecified");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [error, setError] = useState("");

  function submit() {
    if (!email.includes("@")) return setError("メールアドレスを入力してください");
    if (!termsAccepted || !privacyAccepted) return setError("利用規約とプライバシーポリシーへの同意が必要です");
    onEmail(email.trim().toLowerCase(), gender);
  }

  return <div className="message-gate-overlay" role="dialog" aria-modal="true" aria-labelledby="message-gate-title">
    <section className="access-card">
      <button className="message-gate-close" aria-label="閉じる" onClick={onClose}>×</button>
      <div className="access-brand"><span className="brand-mark"><Sparkles /></span><b>TAG TOKYO</b><small>MESSAGE</small></div>
      <div className="access-copy"><span>MESSAGE ACCESS</span><h1 id="message-gate-title">メッセージは、<br />メール認証のあと。</h1><p>すれ違い・MAP・プロフィール育成は登録なしで遊べます。メッセージを開く時だけ、メール認証と同意が必要です。</p></div>
      <label className="access-field"><span>メールアドレス</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
      <label className="access-field"><span>性別</span><select value={gender} onChange={(event) => setGender(event.target.value as EditableProfile["gender"])}><option value="unspecified">回答しない</option><option value="woman">女性</option><option value="man">男性</option><option value="nonbinary">その他</option></select></label>
      <label className="access-check"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span><a href={`${ASSET_PREFIX}/terms/`} target="_blank" rel="noreferrer">利用規約</a>に同意する</span></label>
      <label className="access-check"><input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /><span><a href={`${ASSET_PREFIX}/privacy/`} target="_blank" rel="noreferrer">プライバシーポリシー</a>に同意する</span></label>
      {error && <p className="access-error" role="alert">{error}</p>}
      <button className="access-button" onClick={submit}>メール認証へ進む <ChevronRight /></button>
      <p className="access-note"><ShieldCheck /> {hasSupabase ? "メールアドレスはログイン認証のためSupabase Authへ送信されます。プロフィール画面には公開されません。" : "認証サーバーへ接続できないため、入力内容は送信されません。"}</p>
    </section>
  </div>;
}

function formatRemaining(expiresAt: number | null, now: number) {
  const seconds = Math.max(0, Math.floor(((expiresAt || now) - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function BottomNav({ tab, onChange }: { tab: TabId; onChange: (tab: TabId) => void }) {
  const items: Array<{ id: TabId; label: string; icon: typeof Home }> = [
    { id: "home", label: "HOME", icon: Home },
    { id: "cross", label: "CROSS", icon: Sparkles },
    { id: "map", label: "MAP", icon: Map },
    { id: "match", label: "MATCH", icon: HeartHandshake },
    { id: "me", label: "ME", icon: UserRound },
  ];
  return (
    <nav className="bottom-nav" aria-label="メインナビゲーション">
      {items.map(({ id, label, icon: Icon }) => (
        <button key={id} className={tab === id ? "active" : ""} onClick={() => onChange(id)}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function HomeScreen({ session, now, setDuration, start, stop, notice, growth, dailyBonusNotice }: {
  session: TagSessionState;
  now: number;
  setDuration: (duration: TagDuration) => void;
  start: () => void;
  stop: () => void;
  notice: string;
  growth: GrowthState;
  dailyBonusNotice: string;
}) {
  const progress = getLevelProgress(growth.totalEarnedExp);
  return (
    <section className="screen home-screen">
      <div className="eyebrow"><MapPin /> TOKYO ONLY</div>
      <h1>東京を歩くほど、<br />出会いと自分が育つ。</h1>
      <p className="lead">現在地は誰にも表示されません。近くにいた事実だけをCROSSへ届け、街での活動をプロフィールの成長につなげます。</p>

      <div className={`tag-orbit ${session.active ? "is-on" : ""}`}>
        <button className="tag-power" onClick={session.active ? stop : start} aria-label={session.active ? "TAG OFF" : "TAG ON"}>
          <Power aria-hidden="true" />
          <strong>{session.active ? "TAG ON" : "TAG ON"}</strong>
          <span>{session.active ? formatRemaining(session.expiresAt, now) : "タップして開始"}</span>
        </button>
      </div>

      <div className="duration-group" aria-label="TAG ON時間">
        {([30, 60, 180] as TagDuration[]).map((duration) => (
          <button
            key={duration}
            className={session.duration === duration ? "active" : ""}
            disabled={session.active}
            onClick={() => setDuration(duration)}
          >
            {duration === 180 ? "3時間" : `${duration}分`}
          </button>
        ))}
      </div>

      {notice && <div className="notice" role="status">{notice}</div>}
      {dailyBonusNotice && <div className="daily-bonus" role="status"><Gift /><span><b>{dailyBonusNotice}</b><small>毎日最初のアクセスで受け取れます</small></span></div>}
      <div className="privacy-strip"><ShieldCheck /><span><b>現在地は非公開</b><small>正確な距離・時刻・移動方向も相手には表示しません</small></span></div>
      <div className="today-row">
        <div><small>今日のCROSS</small><strong>0</strong></div>
        <div><small>TAGされた数</small><strong>0</strong></div>
        <div><small>新しいMATCH</small><strong>0</strong></div>
      </div>
      <div className="growth-summary">
        <div className="level-badge"><span>PROFILE</span><b>Lv.{progress.level}</b></div>
        <div className="growth-copy">
          <div><b>次のLvまで {progress.remaining} EXP</b><strong>{growth.availableExp.toLocaleString()} EXP</strong></div>
          <div className="level-track"><span style={{ width: `${progress.percent}%` }} /></div>
          <small>所持EXPは使ってもプロフィールLvに影響しません</small>
        </div>
      </div>
    </section>
  );
}

function MapScreen({ growth, setGrowth, liveEnabled }: { growth: GrowthState; setGrowth: React.Dispatch<React.SetStateAction<GrowthState>>; liveEnabled: boolean }) {
  const [selectedAreaId, setSelectedAreaId] = useState("kitasenju");
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);
  const [stake, setStake] = useState(100);
  const [result, setResult] = useState("");
  const [rewardDisplay, setRewardDisplay] = useState<null | { tier: "normal" | "rare" | "super"; label: string }>(null);
  const area = TOKYO_AREAS.find((item) => item.id === selectedAreaId) ?? TOKYO_AREAS[0];
  const spot = TAG_SPOTS.find((item) => item.id === selectedSpotId) ?? null;
  const myPoints = growth.areaContributions[area.id] ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const alreadyClaimed = spot ? growth.spotClaims[spot.id] === today : false;

  async function contribute() {
    if (!liveEnabled || !supabase) {
      setResult("年齢確認とサービス開始後に利用できます");
      return;
    }
    if (growth.availableExp < stake) {
      setResult("所持EXPが足りません");
      return;
    }
    setResult("拠点からの距離を確認しています…");
    try {
      const location = await requestPrivateLocation();
      const { error } = await supabase.rpc("contribute_area_exp", {
        p_area_id: area.id,
        p_amount: stake,
        p_latitude: location.latitude,
        p_longitude: location.longitude,
      });
      if (error) throw error;
    } catch (error) {
      setResult(error instanceof Error ? error.message : "拠点の1km圏内でのみEXPを投下できます");
      return;
    }
    setGrowth((current) => ({
      ...current,
      availableExp: current.availableExp - stake,
      areaContributions: { ...current.areaContributions, [area.id]: (current.areaContributions[area.id] ?? 0) + stake },
    }));
    setResult(`${area.name}へ${stake} EXP投下しました。プロフィールLvは下がりません。`);
    track("tagtokyo_area_exp_contributed", { area_id: area.id, amount: stake });
  }

  async function drawSpot() {
    if (!spot || alreadyClaimed) return;
    if (!liveEnabled || !supabase) {
      setResult("年齢確認とサービス開始後に利用できます");
      return;
    }
    setResult("現在地を確認しています…");
    try {
      const location = await requestPrivateLocation();
      const { data, error } = await supabase.rpc("draw_tag_spot", {
        p_spot_id: spot.id,
        p_latitude: location.latitude,
        p_longitude: location.longitude,
      });
      if (error) throw error;
      const reward = Array.isArray(data) ? data[0] : data;
      const rewardType = String(reward?.reward_type ?? "exp");
      const rewardKey = String(reward?.reward_key ?? "");
      const rewardExp = Number(reward?.reward_exp ?? 0);
      const tier = rewardKey === "spot-ssr" || rewardKey === "spot-sr" ? "super" : rewardKey === "spot-rare" ? "rare" : "normal";
      const rewardName = rewardKey === "spot-ssr" ? "SUPER BOOST" : rewardKey === "spot-sr" ? "BOOST" : "限定プロフィール装飾";
      setGrowth((current) => ({
        ...current,
        totalEarnedExp: current.totalEarnedExp + rewardExp,
        availableExp: current.availableExp + rewardExp,
        ownedCosmetics: rewardType === "cosmetic" && !current.ownedCosmetics.includes(rewardKey) ? [...current.ownedCosmetics, rewardKey] : current.ownedCosmetics,
        spotClaims: { ...current.spotClaims, [spot.id]: today },
      }));
      setRewardDisplay({ tier, label: rewardType === "exp" ? `${rewardExp} EXP獲得しました` : `${rewardName}を獲得しました` });
      setResult("");
      track("tagtokyo_spot_drawn", { spot_id: spot.id, reward_key: rewardKey });
    } catch (error) {
      setResult(error instanceof Error ? error.message : "TAG SPOTを利用できませんでした");
    }
  }

  return (
    <section className="screen map-screen">
      <header className="screen-header"><div><span>PLAY TOKYO</span><h2>MAP</h2></div><div className="wallet"><Zap />{growth.availableExp.toLocaleString()}</div></header>
      <div className="map-privacy"><ShieldCheck /><span><b>人の現在地は表示しません</b><small>MAPは遊ぶエリアとTAG SPOTを選ぶためのフィールドです</small></span></div>
      <div className="tokyo-map" aria-label="東京エリアマップ">
        <div className="map-river" />
        {TOKYO_AREAS.map((item) => {
          const mine = growth.areaContributions[item.id] ?? 0;
          return <button key={item.id} className={`area-pin ${selectedAreaId === item.id ? "selected" : ""}`} style={{ left: `${item.x}%`, top: `${item.y}%` }} onClick={() => { setSelectedAreaId(item.id); setSelectedSpotId(null); setResult(""); }}>
            <Trophy /><b>{item.name}</b><span>{mine > 0 ? "YOU" : "未登録"}</span><small>{mine > 0 ? `${mine}pt` : "--"}</small>
          </button>;
        })}
        {TAG_SPOTS.map((item) => <button key={item.id} className="spot-pin" aria-label={item.name} style={{ left: `${item.x}%`, top: `${item.y}%` }} onClick={() => { setSelectedSpotId(item.id); setSelectedAreaId(item.areaId); setResult(""); }}><Gift /></button>)}
        <div className="map-legend"><span><Trophy />AREA 1位</span><span><Gift />TAG SPOT</span></div>
      </div>

      {spot ? (
        <div className="map-panel spot-panel">
          <div className="panel-title"><span className="panel-icon"><Gift /></span><div><small>FREE DRAW</small><h3>{spot.name}</h3></div></div>
          <p>現地にいることを非公開判定して、1日1回無料で抽選できます。完全なハズレはありません。</p>
          <div className="reward-line"><span>通常</span><b>30 / 50 / 100 EXP</b><span>レア</span><b>限定プロフィール装飾</b><span>激レア</span><b>BOOST / SUPER BOOST</b></div>
          <button className="primary-wide spot-draw" disabled={alreadyClaimed || !liveEnabled} onClick={() => void drawSpot()}>{alreadyClaimed ? "本日は受取済み" : liveEnabled ? "現地で無料抽選" : "サービス開始後に利用可能"}</button>
        </div>
      ) : (
        <div className="map-panel">
          <div className="area-head"><div><small>AREA BATTLE</small><h3>{area.name}</h3></div></div>
          {myPoints > 0 ? <div className="rank-row mine"><Star /><span><small>あなたの投下</small><b>プロフィール Lv.{getLevelProgress(growth.totalEarnedExp).level}</b></span><strong>{myPoints.toLocaleString()}pt</strong></div> : <div className="area-empty"><Trophy /><span><b>ランキングデータはまだありません</b><small>実際のEXP投下後に表示されます</small></span></div>}
          <div className="area-range-note"><MapPin /><span><b>拠点の1km圏内限定</b><small>現在地は距離判定だけに使い、投下履歴には保存しません</small></span></div>
          <div className="stake-control"><button aria-label="EXPを減らす" onClick={() => setStake(Math.max(100, stake - 100))}><Minus /></button><b>{stake} EXP</b><button aria-label="EXPを増やす" onClick={() => setStake(Math.min(1000, stake + 100))}><Plus /></button></div>
          <button className="primary-wide" disabled={!liveEnabled} onClick={contribute}>{liveEnabled ? "現在地を確認して投下" : "サービス開始後に利用可能"}</button>
        </div>
      )}
      {result && <div className="notice map-result" role="status">{result}</div>}
      {rewardDisplay && <div className="reward-overlay" role="dialog" aria-modal="true" aria-label="抽選結果">
        <div className={`reward-modal is-${rewardDisplay.tier}`}>
          {rewardDisplay.tier !== "normal" && <div className="celebration-stars" aria-hidden="true"><Sparkles /><Star /><Sparkles /></div>}
          <span className="reward-tier">{rewardDisplay.tier === "super" ? "激レア" : rewardDisplay.tier === "rare" ? "レア" : "獲得"}</span>
          <div className="reward-icon"><Gift /></div>
          <h3>{rewardDisplay.label}</h3>
          <button onClick={() => setRewardDisplay(null)}>閉じる</button>
        </div>
      </div>}
    </section>
  );
}

function OfficialBadge() {
  return <span className="official-badge" title="TAG TOKYO公認・管理人"><BadgeCheck />公認・管理人</span>;
}

function LiveCrossScreen({ crossings, officialProfile, onTag, error }: { crossings: LiveCrossing[]; officialProfile: OfficialProfile | null; onTag: (crossing: LiveCrossing) => Promise<void>; error: string }) {
  return <section className="screen">
    <header className="screen-header"><div><span>CROSS</span><h2>すれ違い</h2></div><button className="icon-button" aria-label="通知"><Bell /></button></header>
    <div className="privacy-strip"><ShieldCheck /><span><b>場所と時刻はぼかして表示</b><small>現在地・正確な距離・移動方向は相手に公開しません</small></span></div>
    {officialProfile && <article className="live-cross-card official-profile-card"><div className="chat-avatar">{officialProfile.displayName.slice(0, 1)}</div><div><OfficialBadge /><h3>{officialProfile.displayName}</h3><p>{officialProfile.handle ? `@${officialProfile.handle} · ${officialProfile.bio || "TAG TOKYOを運営しています"}` : officialProfile.bio || "TAG TOKYOを運営しています"}</p></div><span className="official-profile-label">WELCOME</span></article>}
    {crossings.length === 0 ? <div className="empty-state"><div className="empty-icon"><Sparkles /></div><h3>新しいCROSSを待っています</h3><p>東京都内でTAG ONにすると、近くにいた年齢確認済みユーザーが後から表示されます。</p></div> : <div className="live-cross-list">
      {crossings.map((crossing) => <article className={`live-cross-card ${crossing.isOfficial ? "official-profile-card" : ""}`} key={crossing.id}><div className="chat-avatar">{crossing.displayName.slice(0, 1)}</div><div><small>{crossing.areaLabel}</small><h3>{crossing.displayName} {crossing.isOfficial && <OfficialBadge />}</h3><p>{crossing.handle ? `@${crossing.handle}` : crossing.bio || "プロフィールを確認してTAGできます"}</p></div><button disabled={crossing.tagged} onClick={() => void onTag(crossing)}><Sparkles />{crossing.tagged ? "TAG済み" : "TAG"}</button></article>)}
    </div>}
    {error && <p className="chat-error" role="alert">{error}</p>}
  </section>;
}

function MatchScreen() {
  return (
    <section className="screen">
      <header className="screen-header"><div><span>MATCH</span><h2>マッチ</h2></div></header>
      <div className="empty-state">
        <div className="empty-icon"><MessageCircle /></div>
        <h3>相互TAGで、はじめて話せる</h3>
        <p>すれ違った相手にTAGを送り、相手からもTAGが届くとチャットが開きます。知らない人から突然DMは届きません。</p>
      </div>
      <div className="rule-list">
        <div><ShieldCheck /><span><b>相互TAGだけ</b><small>片方からのTAGでは連絡できません</small></span></div>
        <div><UsersRound /><span><b>ブロック・通報</b><small>マッチ後もすぐに安全操作できます</small></span></div>
        <div><Clock3 /><span><b>すれ違いは30日で削除</b><small>位置情報そのものは24時間以内に削除します</small></span></div>
      </div>
    </section>
  );
}

function LiveMatchScreen({
  matches, messages, currentUserId, selectedMatchId, loading, error, memberReady, messageAccessReady,
  onSelect, onSend, onBlock, onReport, onRequireEmail,
}: {
  matches: LiveMatch[];
  messages: Record<string, LiveMessage[]>;
  currentUserId: string | null;
  selectedMatchId: string | null;
  loading: boolean;
  error: string;
  memberReady: boolean;
  messageAccessReady: boolean;
  onSelect: (matchId: string) => void;
  onSend: (matchId: string, body: string) => Promise<boolean>;
  onBlock: (matchId: string) => Promise<void>;
  onReport: (matchId: string, reason: string, detail: string) => Promise<boolean>;
  onRequireEmail: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [reportReason, setReportReason] = useState("harassment");
  const [reportDetail, setReportDetail] = useState("");
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? matches[0] ?? null;
  const thread = selectedMatch ? messages[selectedMatch.id] ?? [] : [];

  async function submitMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedMatch || !draft.trim() || sending) return;
    setSending(true);
    const sent = await onSend(selectedMatch.id, draft);
    if (sent) setDraft("");
    setSending(false);
  }

  if (!messageAccessReady) {
    return <section className="screen">
      <header className="screen-header"><div><span>MATCH</span><h2>メッセージ</h2></div></header>
      <div className="empty-state"><div className="empty-icon"><LockKeyhole /></div><h3>メール認証が必要です</h3><p>実在ユーザーとのメッセージは、認証後に相互マッチした相手とだけ利用できます。</p><button className="primary-wide" onClick={onRequireEmail}>メール認証へ進む</button></div>
    </section>;
  }

  if (!memberReady) {
    return <section className="screen">
      <header className="screen-header"><div><span>MATCH</span><h2>メッセージ</h2></div></header>
      <div className="empty-state"><div className="empty-icon"><ShieldCheck /></div><h3>年齢確認の完了後に開きます</h3><p>規定の年齢確認と利用規約への同意が完了したユーザーだけが、実在ユーザーと交流できます。</p></div>
    </section>;
  }

  if (!selectedMatch) {
    return <section className="screen">
      <header className="screen-header"><div><span>MATCH</span><h2>マッチ</h2></div></header>
      <div className="empty-state"><div className="empty-icon"><MessageCircle /></div><h3>{loading ? "マッチを確認中" : "相互TAGを待っています"}</h3><p>お互いにTAGした相手だけがここに表示され、メッセージを交換できます。</p></div>
      {error && <p className="chat-error" role="alert">{error}</p>}
    </section>;
  }

  return <section className="screen live-match-screen">
    <header className="screen-header"><div><span>MATCH</span><h2>メッセージ</h2></div><span className="match-count">{matches.length}</span></header>
    <div className="live-match-tabs" aria-label="マッチ一覧">
      {matches.map((match) => <button key={match.id} className={selectedMatch.id === match.id ? "active" : ""} onClick={() => { onSelect(match.id); setShowSafety(false); }}><span>{match.displayName.slice(0, 1)}</span><b>{match.displayName}{match.isOfficial && <BadgeCheck aria-label="公式" />}</b></button>)}
    </div>
    <div className="chat-card">
      <header className="chat-header"><div className="chat-avatar">{selectedMatch.displayName.slice(0, 1)}</div><div><b>{selectedMatch.displayName} {selectedMatch.isOfficial && <OfficialBadge />}</b><small>{selectedMatch.handle ? `@${selectedMatch.handle}` : "相互TAGでマッチ"}</small></div><button aria-label="安全メニュー" onClick={() => setShowSafety((value) => !value)}><ShieldCheck /></button></header>
      {showSafety && <div className="chat-safety-panel">
        <b>安全メニュー</b>
        <label><span>通報理由</span><select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option value="harassment">迷惑行為・嫌がらせ</option><option value="impersonation">なりすまし</option><option value="solicitation">勧誘・営業</option><option value="unsafe">危険を感じる行為</option><option value="other">その他</option></select></label>
        <textarea value={reportDetail} maxLength={1000} placeholder="状況を入力（任意）" onChange={(event) => setReportDetail(event.target.value)} />
        <div><button onClick={async () => { if (await onReport(selectedMatch.id, reportReason, reportDetail)) { setReportDetail(""); setShowSafety(false); } }}><Flag />通報する</button><button className="danger" onClick={() => void onBlock(selectedMatch.id)}><Ban />ブロック</button></div>
      </div>}
      <div className="chat-thread" aria-live="polite">
        {thread.length === 0 && <div className="chat-start"><Sparkles /><b>マッチしました</b><span>まずは共通点から話してみましょう</span></div>}
        {thread.map((message) => <div key={message.id} className={`chat-message ${message.senderId === currentUserId ? "mine" : "theirs"}`}><p>{message.body}</p><time>{new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time></div>)}
      </div>
      <form className="chat-compose" onSubmit={submitMessage}><textarea aria-label="メッセージ" value={draft} maxLength={1000} rows={2} placeholder="メッセージを入力" onChange={(event) => setDraft(event.target.value)} /><button type="submit" aria-label="送信" disabled={sending || !draft.trim()}><Send /></button></form>
    </div>
    {error && <p className="chat-error" role="alert">{error}</p>}
  </section>;
}

function FeedbackPanel() {
  const [rating, setRating] = useState<number | null>(null);
  const [topic, setTopic] = useState("わかりやすさ");
  const [sent, setSent] = useState(false);
  const topics = ["わかりやすさ", "プロフィール", "MAP・EXP", "安心感", "もっと使いたい機能"];

  function submit() {
    if (!rating) return;
    track("tagtokyo_feedback", { rating, topic });
    setSent(true);
  }

  return <div className="settings-card feedback-card">
    <div className="section-heading"><div><small>FEEDBACK</small><h3>使ってみて、どうだった？</h3></div><Star /></div>
    <p>個人情報なしで、サービス改善に使う評価だけ送れます。</p>
    <div className="rating-row" aria-label="満足度">{[1, 2, 3, 4, 5].map((value) => <button key={value} className={rating && value <= rating ? "selected" : ""} onClick={() => { setRating(value); setSent(false); }} aria-label={`${value}点`}>{value}</button>)}</div>
    <label className="feedback-topic"><span>一番改善してほしいところ</span><select value={topic} onChange={(event) => { setTopic(event.target.value); setSent(false); }}>{topics.map((item) => <option key={item}>{item}</option>)}</select></label>
    <button className="primary-wide" disabled={!rating || sent} onClick={submit}>{sent ? "評価を受け付けました" : "匿名で評価を送る"}</button>
  </div>;
}

function MeScreen({ email, setEmail, authNotice, sendMagicLink, growth, buyCosmetic, equipCosmetic, profile, setProfile, isOwner, liveEnabled, emailAuthenticated, consentReady, ageVerificationStatus }: {
  email: string;
  setEmail: (value: string) => void;
  authNotice: string;
  sendMagicLink: () => void;
  growth: GrowthState;
  buyCosmetic: (id: string) => void;
  equipCosmetic: (id: string) => void;
  profile: EditableProfile;
  setProfile: (profile: EditableProfile) => void;
  isOwner: boolean;
  liveEnabled: boolean;
  emailAuthenticated: boolean;
  consentReady: boolean;
  ageVerificationStatus: "not_started" | "pending" | "verified" | "rejected" | "expired";
}) {
  const progress = getLevelProgress(growth.totalEarnedExp);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [editorError, setEditorError] = useState("");
  const [photoNotice, setPhotoNotice] = useState("");
  const equippedTitle = COSMETICS.find((item) => item.id === growth.equippedTitle)?.name;
  const profileFields: Array<{ key: keyof EditableProfile; label: string; level: number; placeholder: string; long?: boolean }> = [
    { key: "displayName", label: "表示名", level: 1, placeholder: "表示名" },
    { key: "handle", label: "ユーザーID", level: 1, placeholder: "5〜15文字の英数字または _" },
    { key: "bio", label: "自己紹介", level: 1, placeholder: "あなたらしさが伝わる自己紹介", long: true },
    { key: "weekend", label: "休日の過ごし方", level: 3, placeholder: "休日は何をしていますか？", long: true },
    { key: "romance", label: "恋愛観", level: 5, placeholder: "どんな関係を築きたいですか？", long: true },
    { key: "contactFrequency", label: "連絡頻度", level: 5, placeholder: "理想の連絡頻度" },
    { key: "values", label: "大切にしている価値観", level: 7, placeholder: "大切にしたいこと", long: true },
    { key: "lifestyle", label: "生活スタイル", level: 7, placeholder: "朝型・夜型など" },
    { key: "work", label: "仕事について", level: 9, placeholder: "仕事への向き合い方", long: true },
    { key: "moneyStyle", label: "お金の使い方", level: 9, placeholder: "貯蓄・趣味など" },
    { key: "marriageView", label: "結婚観", level: 11, placeholder: "将来について", long: true },
    { key: "extraBio", label: "自己紹介追加枠", level: 11, placeholder: "もう少し伝えたいこと", long: true },
  ];

  function openEditor() {
    setDraft(profile);
    setEditorError("");
    setEditing(true);
    track("tagtokyo_profile_editor_opened");
  }

  async function saveProfile() {
    const handle = draft.handle.trim().toLowerCase();
    if (!HANDLE_PATTERN.test(handle)) {
      setEditorError("ユーザーIDは5〜15文字の英数字または _ で入力してください");
      return;
    }
    const nextProfile = { ...draft, displayName: draft.displayName.trim().slice(0, 50) || "あなた", handle };
    if (emailAuthenticated && supabase) {
      const { error } = await supabase.rpc("update_member_profile", {
        p_display_name: nextProfile.displayName,
        p_handle: nextProfile.handle,
        p_bio: nextProfile.bio,
        p_gender: nextProfile.gender,
      });
      if (error) {
        setEditorError(error.message.includes("update_member_profile") ? "プロフィール更新機能のDB設定が必要です" : error.message);
        return;
      }
    }
    setProfile(nextProfile);
    setEditing(false);
    track("tagtokyo_profile_updated", { unlocked_level: progress.level });
  }

  function selectPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 750 * 1024) {
      setPhotoNotice("写真は750KB以下の画像を選んでください");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProfile({ ...profile, avatarDataUrl: String(reader.result) });
      setPhotoNotice("この端末に写真を保存しました");
    };
    reader.readAsDataURL(file);
  }

  return (
    <section className="screen">
      <header className="screen-header"><div><span>ME</span><h2>プロフィール</h2></div></header>
      {isOwner && <div className="owner-note"><Crown /><span><b>OWNER MODE</b><small>全プロフィール項目と装飾を自由に確認できます</small></span></div>}
      <div className={`me-card profile-showcase ${growth.equippedBackground ? `equip-${growth.equippedBackground}` : ""}`}>
        <label className={`me-avatar avatar-upload ${growth.equippedFrame ? `equip-${growth.equippedFrame}` : ""}`}><ProfilePhoto profile={profile} /><input type="file" accept="image/*" onChange={selectPhoto} /><span className="avatar-camera"><Camera /></span></label>
        <div>{equippedTitle && <small className="equipped-title">{equippedTitle}</small>}<h3>{profile.displayName} {isOwner && <OfficialBadge />} <span className="profile-level">Lv.{progress.level}</span></h3><p>@{profile.handle} · {profile.bio}</p>{photoNotice && <small className="photo-notice">{photoNotice}</small>}</div>
        <button aria-label="プロフィール編集" onClick={openEditor}><ChevronRight /></button>
      </div>
      <div className="settings-card growth-card">
        <div className="section-heading"><div><small>PROFILE GROWTH</small><h3>自分を育てる</h3></div><strong>{growth.availableExp.toLocaleString()} EXP</strong></div>
        <div className="level-track large"><span style={{ width: `${progress.percent}%` }} /></div>
        <p className="next-level">次のLvまで <b>{progress.remaining} EXP</b></p>
        <div className="unlock-list">
          {PROFILE_UNLOCKS.map((unlock) => {
            const open = progress.level >= unlock.level;
            return <div key={unlock.level} className={open ? "unlocked" : ""}>{open ? <Sparkles /> : <LockKeyhole />}<span><b>Lv.{unlock.level}</b>{unlock.label}</span></div>;
          })}
        </div>
      </div>
      <div className="settings-card cosmetic-card">
        <div className="section-heading"><div><small>DRESS UP</small><h3>装飾アイテム</h3></div><ShoppingBag /></div>
        <p className="cosmetic-intro">見た目を確認して、EXPで交換。取得後はいつでも装備できます。</p>
        <div className="cosmetic-grid">
          {COSMETICS.map((item) => {
            const owned = growth.ownedCosmetics.includes(item.id);
            const equipped = growth.equippedFrame === item.id || growth.equippedBackground === item.id || growth.equippedTitle === item.id;
            return <article key={item.id} className="cosmetic-tile">
              <div className={`cosmetic-visual visual-${item.slot}`} style={{ "--item-color": item.color } as React.CSSProperties}><span>{item.slot === "title" ? "Aa" : "A"}</span></div>
              <div><small>{item.kind}</small><b>{item.name}</b></div>
              <button disabled={equipped || (!isOwner && !owned && growth.availableExp < item.cost)} onClick={() => owned ? equipCosmetic(item.id) : buyCosmetic(item.id)}>{equipped ? "装備中" : owned ? "装備する" : isOwner ? "自由に試着" : `${item.cost} EXP`}</button>
            </article>;
          })}
        </div>
      </div>
      <div className="settings-card">
        <h3>アカウント</h3>
        <label className="field"><span>メールアドレス</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <button className="primary-wide" onClick={sendMagicLink}>{hasSupabase ? "ログインリンクを送る" : "接続準備中"}</button>
        {authNotice && <p className="field-notice">{authNotice}</p>}
      </div>
      <div className="settings-card">
        <h3>安全と本人確認</h3>
        <AgeVerificationPanel key={`${ageVerificationStatus}-${consentReady}`} authenticated={emailAuthenticated} consentReady={consentReady} initialStatus={ageVerificationStatus} profile={profile} />
        {isOwner && <a className="moderation-link" href={`${ASSET_PREFIX}/moderation/`}><ShieldCheck /><span><b>運営審査画面</b><small>提出画像の確認・承認・削除</small></span><ChevronRight /></a>}
        <button className="setting-link"><span>ブロックしたユーザー</span><ChevronRight /></button>
        <button className="setting-link"><span>通報履歴</span><ChevronRight /></button>
        <button className="setting-link danger"><span>退会する</span><LogOut /></button>
      </div>
      <div className="settings-card compact">
        <p><b>位置情報の扱い</b></p>
        <p>すれ違い判定だけに利用し、生の位置情報は数時間から24時間以内に削除します。他ユーザーへ現在地や正確な距離を公開しません。</p>
      </div>
      <div className={`settings-card launch-status ${liveEnabled ? "is-live" : ""}`}>
        <div className="section-heading"><div><small>COMMUNITY STATUS</small><h3>{liveEnabled ? "限定ベータを運用中" : "コミュニティ開始準備中"}</h3></div><ShieldCheck /></div>
        <p>{liveEnabled ? "年齢確認済みの参加者だけが交流機能を利用できます。" : "実在ユーザー同士のTAG・MATCH・メッセージはまだ有効化していません。"}</p>
        <ul><li>現在地・正確な距離は非公開</li><li>ブロック・通報を常時利用可能</li><li>20歳未満は利用不可</li></ul>
      </div>
      <FeedbackPanel />
      {editing && <div className="profile-editor-overlay" role="dialog" aria-modal="true" aria-label="プロフィール編集">
        <div className="profile-editor">
          <header><div><small>EDIT PROFILE</small><h3>プロフィールを編集</h3></div><button aria-label="編集を閉じる" onClick={() => setEditing(false)}>×</button></header>
          <p className="editor-guide">{isOwner ? "オーナーはすべての項目を編集できます" : `Lv.${progress.level}までの項目を編集できます`}。表示名は50文字まで、ユーザーIDは5〜15文字の英数字または _ です。</p>
          <div className="editor-fields">
            <label><span>性別</span><select value={draft.gender} onChange={(event) => setDraft((current) => ({ ...current, gender: event.target.value as EditableProfile["gender"] }))}><option value="unspecified">回答しない</option><option value="woman">女性</option><option value="man">男性</option><option value="nonbinary">その他</option></select></label>
            {profileFields.map((field) => {
              const unlocked = isOwner || progress.level >= field.level;
              return <label key={field.key} className={!unlocked ? "locked-field" : ""}><span>{field.label}{!unlocked && <small><LockKeyhole />Lv.{field.level}で解放</small>}</span>{field.long
                ? <textarea disabled={!unlocked} value={draft[field.key]} placeholder={field.placeholder} maxLength={field.key === "bio" || field.key === "extraBio" ? 500 : 160} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />
                : <input disabled={!unlocked} value={draft[field.key]} placeholder={field.placeholder} maxLength={field.key === "displayName" ? 50 : field.key === "handle" ? 15 : 60} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: field.key === "handle" ? event.target.value.replace(/[^A-Za-z0-9_]/g, "") : event.target.value }))} />}</label>;
            })}
          </div>
          {editorError && <p className="editor-error" role="alert">{editorError}</p>}
          <div className="editor-actions"><button onClick={() => setEditing(false)}>キャンセル</button><button onClick={() => void saveProfile()}>保存する</button></div>
        </div>
      </div>}
    </section>
  );
}

export default function TagTokyoApp() {
  const [tab, setTab] = useState<TabId>("home");
  const [session, setSession] = useState<TagSessionState>(INITIAL_SESSION);
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [growth, setGrowth] = useState<GrowthState>(INITIAL_GROWTH);
  const [profile, setProfile] = useState<EditableProfile>(INITIAL_PROFILE);
  const [isOwner, setIsOwner] = useState(false);
  const [isEmailAuthenticated, setIsEmailAuthenticated] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [databaseLiveEnabled, setDatabaseLiveEnabled] = useState(false);
  const [liveMemberReady, setLiveMemberReady] = useState(false);
  const [ageVerificationStatus, setAgeVerificationStatus] = useState<"not_started" | "pending" | "verified" | "rejected" | "expired">("not_started");
  const [consentReady, setConsentReady] = useState(false);
  const [liveCrossings, setLiveCrossings] = useState<LiveCrossing[]>([]);
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [officialProfile, setOfficialProfile] = useState<OfficialProfile | null>(null);
  const [liveMessages, setLiveMessages] = useState<Record<string, LiveMessage[]>>({});
  const [selectedLiveMatchId, setSelectedLiveMatchId] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [showMessageGate, setShowMessageGate] = useState(false);
  const [growthLoaded, setGrowthLoaded] = useState(false);
  const [dailyBonusNotice, setDailyBonusNotice] = useState("");
  const liveEnabled = isLiveCommunityEnabled && databaseLiveEnabled;

  const refreshLiveCommunity = useCallback(async (userId: string) => {
    if (!supabase) return;
    setLiveLoading(true);
    setLiveError("");
    const [{ data: matchRows, error: matchError }, { data: crossingRows, error: crossingError }, { data: likeRows }] = await Promise.all([
      supabase.from("matches").select("id,user_a,user_b,created_at").order("created_at", { ascending: false }),
      supabase.from("crossings").select("id,user_a,user_b,area_label,crossed_at").order("crossed_at", { ascending: false }),
      supabase.from("likes").select("sender_id,crossing_id").eq("sender_id", userId),
    ]);
    if (matchError) {
      setLiveError(matchError.message);
      setLiveLoading(false);
      return;
    }
    if (crossingError) {
      setLiveError(crossingError.message);
      setLiveLoading(false);
      return;
    }

    const rows = (matchRows ?? []) as Array<{ id: string; user_a: string; user_b: string; created_at: string }>;
    const crossingItems = (crossingRows ?? []) as Array<{ id: string; user_a: string; user_b: string; area_label: string; crossed_at: string }>;
    const otherIds = [...new Set([
      ...rows.map((match) => match.user_a === userId ? match.user_b : match.user_a),
      ...crossingItems.map((crossing) => crossing.user_a === userId ? crossing.user_b : crossing.user_a),
    ])];
    const matchIds = rows.map((match) => match.id);
    const profileByUser = new globalThis.Map<string, { display_name: string; handle: string | null; bio: string; avatar_url: string | null; is_official: boolean }>();

    if (otherIds.length > 0) {
      let { data: profileRows, error: profileError } = await supabase.rpc("get_visible_member_profiles", { p_user_ids: otherIds });
      if (profileError) {
        const fallback = await supabase.from("profiles").select("user_id,display_name,handle,bio,avatar_url").in("user_id", otherIds);
        profileRows = (fallback.data ?? []).map((item) => ({ ...item, is_official: false }));
        profileError = fallback.error;
      }
      if (profileError) {
        setLiveError(profileError.message);
        setLiveLoading(false);
        return;
      }
      for (const item of profileRows ?? []) profileByUser.set(item.user_id, item);
    }

    const nextMatches = rows.map((match) => {
      const otherUserId = match.user_a === userId ? match.user_b : match.user_a;
      const other = profileByUser.get(otherUserId);
      return {
        id: match.id,
        otherUserId,
        displayName: other?.display_name ?? "TAGユーザー",
        handle: other?.handle ?? null,
        bio: other?.bio ?? "",
        avatarUrl: other?.avatar_url ?? null,
        isOfficial: other?.is_official ?? false,
        createdAt: match.created_at,
      } satisfies LiveMatch;
    });
    const taggedCrossings = new Set((likeRows ?? []).map((like) => like.crossing_id));
    setLiveCrossings(crossingItems.map((crossing) => {
      const otherUserId = crossing.user_a === userId ? crossing.user_b : crossing.user_a;
      const other = profileByUser.get(otherUserId);
      return {
        id: crossing.id,
        otherUserId,
        displayName: other?.display_name ?? "TAGユーザー",
        handle: other?.handle ?? null,
        bio: other?.bio ?? "",
        areaLabel: crossing.area_label,
        crossedAt: crossing.crossed_at,
        tagged: taggedCrossings.has(crossing.id),
        isOfficial: other?.is_official ?? false,
      } satisfies LiveCrossing;
    }));
    setLiveMatches(nextMatches);
    setSelectedLiveMatchId((current) => current && matchIds.includes(current) ? current : matchIds[0] ?? null);

    if (matchIds.length > 0) {
      const { data: messageRows, error: messageError } = await supabase
        .from("messages")
        .select("id,match_id,sender_id,body,created_at")
        .in("match_id", matchIds)
        .order("created_at", { ascending: true })
        .limit(500);
      if (messageError) setLiveError(messageError.message);
      else {
        const grouped: Record<string, LiveMessage[]> = {};
        for (const item of messageRows ?? []) {
          const message: LiveMessage = { id: item.id, matchId: item.match_id, senderId: item.sender_id, body: item.body, createdAt: item.created_at };
          grouped[message.matchId] = [...(grouped[message.matchId] ?? []), message];
        }
        setLiveMessages(grouped);
      }
    } else setLiveMessages({});
    setLiveLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${ASSET_PREFIX}/sw.js`).catch(() => undefined);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.localStorage.removeItem("tagtokyo_demo_matches_v1");
    window.localStorage.removeItem("tagtokyo_growth_preview_v2");
    window.localStorage.removeItem("tagtokyo_profile_preview_v1");
    const saved = window.localStorage.getItem("tagtokyo_growth_v3");
    const timeout = window.setTimeout(() => {
      if (saved) {
        try {
          const restored = JSON.parse(saved) as GrowthState;
          setGrowth({ ...INITIAL_GROWTH, ...restored });
        } catch { /* Ignore invalid local state. */ }
      }
      setGrowthLoaded(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (growthLoaded) window.localStorage.setItem("tagtokyo_growth_v3", JSON.stringify(growth));
  }, [growth, growthLoaded]);

  useEffect(() => {
    if (!growthLoaded) return;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
    if (growth.lastDailyLoginDate === today) return;
    const timeout = window.setTimeout(() => {
      setGrowth((current) => ({
        ...current,
        totalEarnedExp: current.totalEarnedExp + DAILY_LOGIN_EXP,
        availableExp: current.availableExp + DAILY_LOGIN_EXP,
        lastDailyLoginDate: today,
      }));
      setDailyBonusNotice(`毎日ログイン +${DAILY_LOGIN_EXP} EXP`);
      track("tagtokyo_daily_login_bonus", { exp: DAILY_LOGIN_EXP });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [growth.lastDailyLoginDate, growthLoaded]);

  useEffect(() => {
    const saved = window.localStorage.getItem("tagtokyo_profile_v2");
    if (!saved) return;
    try {
      const restored = JSON.parse(saved) as EditableProfile;
      const timeout = window.setTimeout(() => setProfile({ ...INITIAL_PROFILE, ...restored }), 0);
      return () => window.clearTimeout(timeout);
    } catch { /* Ignore invalid local state. */ }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("tagtokyo_profile_v2", JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      // Local owner access must never grant production privileges.
      if (process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("owner-check") === "1") {
        const timeout = window.setTimeout(() => setIsOwner(true), 0);
        return () => window.clearTimeout(timeout);
      }
      return;
    }

    const connectedClient = client;
    let active = true;
    async function syncOwnerRole() {
      const { data: statusData } = await connectedClient.rpc("live_community_status");
      if (active) setDatabaseLiveEnabled(statusData === true);
      const { data: { user } } = await connectedClient.auth.getUser();
      if (!user) {
        if (active) {
          setIsOwner(false);
          setIsEmailAuthenticated(false);
          setCurrentUserId(null);
          setLiveMemberReady(false);
          setAgeVerificationStatus("not_started");
          setConsentReady(false);
          setOfficialProfile(null);
        }
        return;
      }
      let { data } = await connectedClient.from("users").select("id,role,status,age_verified,age_verification_status,terms_accepted_at,privacy_accepted_at").eq("auth_user_id", user.id).maybeSingle();
      const pendingConsent = window.sessionStorage.getItem("tagtokyo_pending_message_consent_v1");
      if (data && pendingConsent && (!data.terms_accepted_at || !data.privacy_accepted_at)) {
        const savedProfile = window.localStorage.getItem("tagtokyo_profile_v2");
        let onboardingProfile: EditableProfile = INITIAL_PROFILE;
        if (savedProfile) {
          try { onboardingProfile = { ...INITIAL_PROFILE, ...JSON.parse(savedProfile) as EditableProfile }; } catch { /* Use defaults. */ }
        }
        const { error: onboardingError } = await connectedClient.rpc("complete_profile_onboarding", {
          p_display_name: onboardingProfile.displayName,
          p_handle: onboardingProfile.handle,
          p_gender: onboardingProfile.gender,
          p_terms_version: TERMS_VERSION,
          p_privacy_version: PRIVACY_VERSION,
        });
        if (onboardingError) setAuthNotice(onboardingError.message);
        else {
          window.sessionStorage.removeItem("tagtokyo_pending_message_consent_v1");
          const refreshed = await connectedClient.from("users").select("id,role,status,age_verified,age_verification_status,terms_accepted_at,privacy_accepted_at").eq("auth_user_id", user.id).maybeSingle();
          data = refreshed.data;
        }
      }
      const { data: ownProfile } = await connectedClient.from("profiles").select("display_name,handle,bio,gender").eq("user_id", data?.id ?? "").maybeSingle();
      if (ownProfile && active) {
        setProfile((current) => ({
          ...current,
          displayName: ownProfile.display_name,
          handle: ownProfile.handle ?? current.handle,
          bio: ownProfile.bio ?? "",
          gender: (["woman", "man", "nonbinary", "unspecified"] as const).includes(ownProfile.gender) ? ownProfile.gender : "unspecified",
        }));
      }
      const { data: welcomeRows } = await connectedClient.rpc("get_official_welcome_profile");
      const welcome = Array.isArray(welcomeRows) ? welcomeRows[0] : null;
      if (active) {
        setIsOwner(data?.role === "owner");
        setIsEmailAuthenticated(Boolean(user.email));
        setCurrentUserId(data?.id ?? null);
        setLiveMemberReady(Boolean(data?.status === "active" && data?.age_verified && data?.age_verification_status === "verified" && data?.terms_accepted_at && data?.privacy_accepted_at));
        setAgeVerificationStatus(data?.age_verification_status ?? "not_started");
        setConsentReady(Boolean(data?.terms_accepted_at && data?.privacy_accepted_at));
        setOfficialProfile(welcome ? {
          userId: welcome.user_id,
          displayName: welcome.display_name,
          handle: welcome.handle,
          bio: welcome.bio,
          avatarUrl: welcome.avatar_url,
        } : null);
      }
    }
    void syncOwnerRole();
    const { data: { subscription } } = connectedClient.auth.onAuthStateChange(() => void syncOwnerRole());
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!liveEnabled || !currentUserId || !supabase) return;
    const refreshTimer = window.setTimeout(() => void refreshLiveCommunity(currentUserId), 0);
    const client = supabase;
    const channel = client.channel(`messages-${currentUserId}`).on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const item = payload.new as { id: number; match_id: string; sender_id: string; body: string; created_at: string };
        const message: LiveMessage = { id: item.id, matchId: item.match_id, senderId: item.sender_id, body: item.body, createdAt: item.created_at };
        setLiveMessages((current) => {
          const thread = current[message.matchId] ?? [];
          if (thread.some((existing) => existing.id === message.id)) return current;
          return { ...current, [message.matchId]: [...thread, message] };
        });
      },
    ).subscribe();
    return () => {
      window.clearTimeout(refreshTimer);
      void client.removeChannel(channel);
    };
  }, [currentUserId, liveEnabled, refreshLiveCommunity]);

  useEffect(() => {
    if (!session.active || !session.expiresAt) return;
    const timeout = window.setTimeout(() => {
      setSession((current) => ({ ...current, active: false, startedAt: null, expiresAt: null }));
      setNotice("TAG ONが自動終了しました");
      track("tagtokyo_tag_session_ended", { reason: "expired" });
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [session.active, session.expiresAt]);

  async function startTag() {
    if (!liveEnabled) {
      setNotice("実ユーザー機能は現在準備中です");
      return;
    }
    if (!liveMemberReady) {
      setNotice("MEでメール認証と20歳以上確認を完了してください");
      setAuthNotice("TAG ONの利用にはメール認証と20歳以上確認が必要です");
      setTab("me");
      return;
    }
    setNotice("位置情報を確認しています…");
    try {
      const location = await requestPrivateLocation();
      if (!isInsideTokyo(location)) throw new Error("TAG ONは東京都内でのみ利用できます");
      const startedAt = Date.now();
      const expiresAt = startedAt + session.duration * 60 * 1000;
      setNow(startedAt);
      if (supabase) {
        const { error } = await supabase.rpc("start_tag_session", {
          p_latitude: location.latitude,
          p_longitude: location.longitude,
          p_duration_minutes: session.duration,
          p_delete_at: location.deleteAt,
        });
        if (error) throw error;
      }
      setSession((current) => ({ ...current, active: true, startedAt, expiresAt, areaLabel: "東京都内" }));
      setNotice("TAG ONを開始しました");
      track("tagtokyo_tag_session_started", { duration_minutes: session.duration, backend: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "TAG ONを開始できませんでした");
    }
  }

  async function stopTag() {
    if (supabase) await supabase.rpc("stop_tag_session");
    setSession((current) => ({ ...current, active: false, startedAt: null, expiresAt: null }));
    setNotice("TAG ONを終了しました");
    track("tagtokyo_tag_session_ended", { reason: "manual" });
  }

  async function sendMagicLink() {
    if (!hasSupabase || !supabase) {
      setAuthNotice("認証サーバーへ接続できません");
      return;
    }
    if (!email.includes("@")) {
      setAuthNotice("メールアドレスを入力してください");
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
    setAuthNotice(error ? error.message : "ログインリンクをメールへ送りました");
  }

  async function requestMessageAccess(nextEmail: string, gender: EditableProfile["gender"]) {
    setEmail(nextEmail);
    const nextProfile = { ...profile, gender };
    setProfile(nextProfile);
    window.localStorage.setItem("tagtokyo_profile_v2", JSON.stringify(nextProfile));
    setShowMessageGate(false);
    if (!hasSupabase || !supabase) {
      setAuthNotice("メール認証の接続を準備中です。現在はメッセージを送信できません。");
      setTab("me");
      return;
    }
    window.sessionStorage.setItem("tagtokyo_pending_message_consent_v1", JSON.stringify({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION }));
    const { error } = await supabase.auth.signInWithOtp({ email: nextEmail, options: { emailRedirectTo: window.location.href } });
    setAuthNotice(error ? error.message : "ログインリンクをメールへ送りました。認証後にメッセージを開けます。");
    setTab("me");
  }

  async function sendLiveMessage(matchId: string, body: string) {
    if (!supabase || !currentUserId) return false;
    setLiveError("");
    const { data, error } = await supabase.rpc("send_match_message", { p_match_id: matchId, p_body: body });
    if (error) {
      setLiveError(error.message);
      return false;
    }
    const item = Array.isArray(data) ? data[0] : data;
    if (item) {
      const message: LiveMessage = { id: item.id, matchId: item.match_id, senderId: item.sender_id, body: item.body, createdAt: item.created_at };
      setLiveMessages((current) => {
        const thread = current[matchId] ?? [];
        return thread.some((existing) => existing.id === message.id) ? current : { ...current, [matchId]: [...thread, message] };
      });
    }
    track("tagtokyo_message_sent", { match_id: matchId });
    return true;
  }

  async function sendLiveTag(crossing: LiveCrossing) {
    if (!supabase || !currentUserId) return;
    setLiveError("");
    const { data: matched, error } = await supabase.rpc("send_crossing_tag", { p_crossing_id: crossing.id });
    if (error) return setLiveError(error.message);
    setLiveCrossings((current) => current.map((item) => item.id === crossing.id ? { ...item, tagged: true } : item));
    setNotice(matched ? `${crossing.displayName}さんとMATCHしました` : `${crossing.displayName}さんへTAGを送りました`);
    track("tagtokyo_live_tag_sent", { crossing_id: crossing.id, matched: Boolean(matched) });
    if (matched) await refreshLiveCommunity(currentUserId);
  }

  async function blockLiveMatch(matchId: string) {
    if (!supabase || !currentUserId) return;
    const { error } = await supabase.rpc("block_match_member", { p_match_id: matchId });
    if (error) return setLiveError(error.message);
    setLiveMatches((current) => current.filter((match) => match.id !== matchId));
    setSelectedLiveMatchId(null);
    setLiveError("ブロックしました。この相手とのメッセージ送信は停止されました。");
    track("tagtokyo_match_blocked", { match_id: matchId });
  }

  async function reportLiveMatch(matchId: string, reason: string, detail: string) {
    if (!supabase) return false;
    const { error } = await supabase.rpc("report_match_member", { p_match_id: matchId, p_reason: reason, p_detail: detail });
    if (error) {
      setLiveError(error.message);
      return false;
    }
    setLiveError("通報を受け付けました。必要に応じてブロックも利用してください。");
    track("tagtokyo_match_reported", { match_id: matchId, reason });
    return true;
  }

  async function buyCosmetic(id: string) {
    const item = COSMETICS.find((candidate) => candidate.id === id);
    if (!item || (!isOwner && growth.availableExp < item.cost) || growth.ownedCosmetics.includes(id)) return;
    if (supabase) {
      const { error } = isOwner
        ? await supabase.rpc("owner_unlock_cosmetics")
        : await supabase.rpc("exchange_cosmetic", { p_cosmetic_id: id });
      if (error) {
        setAuthNotice(error.message);
        return;
      }
    }
    setGrowth((current) => ({
      ...current,
      availableExp: isOwner ? current.availableExp : current.availableExp - item.cost,
      ownedCosmetics: [...current.ownedCosmetics, id],
      equippedFrame: item.slot === "frame" ? id : current.equippedFrame,
      equippedBackground: item.slot === "background" ? id : current.equippedBackground,
      equippedTitle: item.slot === "title" ? id : current.equippedTitle,
    }));
    track(isOwner ? "tagtokyo_owner_cosmetic_unlocked" : "tagtokyo_cosmetic_exchanged", { cosmetic_id: id, exp_cost: isOwner ? 0 : item.cost });
  }

  function equipCosmetic(id: string) {
    const item = COSMETICS.find((candidate) => candidate.id === id);
    if (!item || (!isOwner && !growth.ownedCosmetics.includes(id))) return;
    setGrowth((current) => ({
      ...current,
      equippedFrame: item.slot === "frame" ? id : current.equippedFrame,
      equippedBackground: item.slot === "background" ? id : current.equippedBackground,
      equippedTitle: item.slot === "title" ? id : current.equippedTitle,
    }));
    track("tagtokyo_cosmetic_equipped", { cosmetic_id: id });
  }

  return (
    <main className="app-shell">
      <div className="top-brand"><span className="brand-mark"><Sparkles /></span><b>TAG TOKYO</b><small>PLAY BETA</small></div>
      {tab === "home" && <HomeScreen session={session} now={now} setDuration={(duration) => setSession((current) => ({ ...current, duration }))} start={startTag} stop={stopTag} notice={notice} growth={growth} dailyBonusNotice={dailyBonusNotice} />}
      {tab === "cross" && <LiveCrossScreen crossings={liveEnabled && liveMemberReady ? liveCrossings : []} officialProfile={officialProfile} onTag={sendLiveTag} error={liveError} />}
      {tab === "map" && <MapScreen growth={growth} setGrowth={setGrowth} liveEnabled={liveEnabled} />}
      {tab === "match" && (liveEnabled
        ? <LiveMatchScreen matches={liveMatches} messages={liveMessages} currentUserId={currentUserId} selectedMatchId={selectedLiveMatchId} loading={liveLoading} error={liveError} memberReady={liveMemberReady} messageAccessReady={isEmailAuthenticated} onSelect={setSelectedLiveMatchId} onSend={sendLiveMessage} onBlock={blockLiveMatch} onReport={reportLiveMatch} onRequireEmail={() => setShowMessageGate(true)} />
        : <MatchScreen />)}
      {tab === "me" && <MeScreen email={email} setEmail={setEmail} authNotice={authNotice} sendMagicLink={sendMagicLink} growth={growth} buyCosmetic={buyCosmetic} equipCosmetic={equipCosmetic} profile={profile} setProfile={setProfile} isOwner={isOwner} liveEnabled={liveEnabled} emailAuthenticated={isEmailAuthenticated} consentReady={consentReady} ageVerificationStatus={ageVerificationStatus} />}
      <BottomNav tab={tab} onChange={(next) => {
        setTab(next);
        window.scrollTo({ top: 0, behavior: "instant" });
        track("tagtokyo_tab_view", { tab: next });
        if (next === "cross") track("tagtokyo_cross_view");
      }} />
      {showMessageGate && <MessageAccessGate onClose={() => setShowMessageGate(false)} onEmail={requestMessageAccess} />}
    </main>
  );
}
