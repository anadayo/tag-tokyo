"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BadgeCheck, Ban, Bell, Camera, ChevronRight, Clock3, Crown, Flag, Gift, Heart, HeartHandshake, Home, LockKeyhole, LogOut, Map,
  MapPin, MessageCircle, Minus, Plus, Power, ShieldCheck, ShoppingBag,
  Search, Send, Sparkles, Star, Trophy, UserRound, UsersRound, Zap, Footprints, Route,
} from "lucide-react";
import { track } from "@/lib/analytics";
import { AgeVerificationPanel } from "@/components/age-verification-panel";
import {
  COSMETICS, DAILY_LOGIN_EXP, getLevelProgress, INITIAL_GROWTH, INITIAL_PROFILE, PROFILE_UNLOCKS,
  TAG_SPOTS, TOKYO_AREAS,
} from "@/lib/game";
import { isInsideTokyo, requestPrivateLocation, watchPrivateLocation } from "@/lib/location";
import { hasSupabase, isLiveCommunityEnabled, supabase } from "@/lib/supabase";
import type { AreaChampion, BetaCampaignStatus, DailyMission, DiscoveryProfile, EditableProfile, GrowthState, LiveCrossing, LiveMatch, LiveMessage, OfficialProfile, TabId, TagCatalogItem, TagDuration, TagSessionResult, TagSessionState, TagStreak, TodayStats } from "@/lib/types";

const INITIAL_SESSION: TagSessionState = {
  active: false,
  duration: 30,
  startedAt: null,
  expiresAt: null,
  areaLabel: null,
  serverSessionId: null,
  validDistanceMeters: 0,
  walkExpEarned: 0,
  dailyDistanceMeters: 0,
  dailyWalkExp: 0,
  dailyWalkExpCap: 100,
  movementStatus: null,
};
const ASSET_PREFIX = process.env.NODE_ENV === "production" ? "/tag-tokyo" : "";
const HANDLE_PATTERN = /^[A-Za-z0-9_]{5,15}$/;
const TERMS_VERSION = "2026-10-05";
const PRIVACY_VERSION = "2026-10-05";
const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_PHOTO_MAX_SIDE = 1200;
const PROFILE_PHOTO_TARGET_BYTES = 1.5 * 1024 * 1024;
const PROFILE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const EMPTY_TODAY_STATS: TodayStats = { crosses: 0, receivedTags: 0, newMatches: 0 };
const EMPTY_BETA_STATUS: BetaCampaignStatus = { claimedCount: 0, remainingCount: 300, campaignOpen: true, isBetaTester: false, betaTesterNumber: null, rewardClaimed: false, boostQuantity: 0, boostActiveUntil: null };

function tokyoDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(date);
}

function adultBirthDateLimit() {
  const [year, month, day] = tokyoDateKey().split("-").map(Number);
  const cutoff = new Date(Date.UTC(year - 20, month - 1, day));
  return cutoff.toISOString().slice(0, 10);
}

function isAdultBirthDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= adultBirthDateLimit();
}

function MemberAvatar({ url, name, className = "" }: { url: string | null; name: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private profile storage.
  if (url) return <img className={`member-avatar-image ${className}`} src={url} alt={`${name}さんのプロフィール写真`} />;
  return <span className={className}>{name.slice(0, 1).toUpperCase()}</span>;
}

async function getSignedProfilePhotoUrls(userIds: string[]) {
  if (!supabase || userIds.length === 0) return {} as Record<string, string>;
  const { data, error } = await supabase.functions.invoke("profile-photo-url", { body: { userIds } });
  if (error || !data || typeof data !== "object") return {} as Record<string, string>;
  return (data as { urls?: Record<string, string> }).urls ?? {};
}

function ProfilePhoto({ profile, className = "" }: { profile: EditableProfile; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- local data URL, not a network image.
  if (profile.avatarDataUrl) return <img className={`profile-photo ${className}`} src={profile.avatarDataUrl} alt="プロフィール写真" />;
  return <span className={className}>{profile.displayName.slice(0, 1).toUpperCase()}</span>;
}

function MessageAccessGate({ onClose, onEmail }: { onClose: () => void; onEmail: (email: string, gender: EditableProfile["gender"], birthDate: string) => void }) {
  const [email, setEmail] = useState("");
  const [gender, setGender] = useState<EditableProfile["gender"]>("unspecified");
  const [birthDate, setBirthDate] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [error, setError] = useState("");

  function submit() {
    if (!email.includes("@")) return setError("メールアドレスを入力してください");
    if (!isAdultBirthDate(birthDate)) return setError("20歳以上の生年月日を入力してください");
    if (!termsAccepted || !privacyAccepted) return setError("利用規約とプライバシーポリシーへの同意が必要です");
    onEmail(email.trim().toLowerCase(), gender, birthDate);
  }

  return <div className="message-gate-overlay" role="dialog" aria-modal="true" aria-labelledby="message-gate-title">
    <section className="access-card">
      <button className="message-gate-close" aria-label="閉じる" onClick={onClose}>×</button>
      <div className="access-brand"><span className="brand-mark"><Sparkles /></span><b>TAG TOKYO</b><small>MESSAGE</small></div>
      <div className="access-copy"><span>MESSAGE ACCESS</span><h1 id="message-gate-title">メッセージは、<br />登録と年齢確認のあと。</h1><p>MAP・プロフィール育成は登録なしで遊べます。交流機能はメール認証、規約同意、公的書類による20歳以上確認が必要です。</p></div>
      <label className="access-field"><span>メールアドレス</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
      <label className="access-field"><span>生年月日</span><input type="date" value={birthDate} max={adultBirthDateLimit()} onChange={(event) => setBirthDate(event.target.value)} autoComplete="bday" /></label>
      <label className="access-field"><span>性別</span><select value={gender} onChange={(event) => setGender(event.target.value as EditableProfile["gender"])}><option value="unspecified">回答しない</option><option value="woman">女性</option><option value="man">男性</option><option value="nonbinary">その他</option></select></label>
      {(gender === "nonbinary" || gender === "unspecified") && <p className="access-gender-note">現在、マッチング機能は男性・女性登録間のみ対応しています。MAP・育成機能は利用できます。</p>}
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

function TagIntro({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  return <div className="v04-overlay" role="dialog" aria-modal="true" aria-labelledby="tag-intro-title">
    <section className="v04-modal tag-intro-modal">
      <button className="message-gate-close" aria-label="閉じる" onClick={onClose}>×</button>
      <span className="v04-modal-icon"><MapPin /></span>
      <small>BEFORE TAG ON</small>
      <h2 id="tag-intro-title">位置情報は、街での体験を<br />判定するためだけに使います。</h2>
      <div className="v04-trust-list">
        <div><ShieldCheck /><span><b>現在地は誰にも表示しません</b><small>正確な距離・時刻・移動方向も非公開です</small></span></div>
        <div><Clock3 /><span><b>位置サンプルは24時間以内に削除</b><small>プロフィールには移動経路を保存しません</small></span></div>
        <div><Footprints /><span><b>歩いた分はサーバーでEXP判定</b><small>100mごとに2 EXP、1日100 EXPまで</small></span></div>
      </div>
      <button className="primary-wide" onClick={onStart}>理解してTAG ON</button>
    </section>
  </div>;
}

function SessionResult({ result, onClose, onCross }: { result: TagSessionResult; onClose: () => void; onCross: () => void }) {
  const minutes = Math.max(1, Math.round(result.durationSeconds / 60));
  return <div className="v04-overlay" role="dialog" aria-modal="true" aria-labelledby="session-result-title">
    <section className="v04-modal result-modal">
      <span className="v04-modal-icon"><Route /></span><small>TAG SESSION COMPLETE</small>
      <h2 id="session-result-title">東京での活動を記録しました</h2>
      <div className="result-grid">
        <div><small>時間</small><b>{minutes}分</b></div><div><small>距離</small><b>{(result.distanceMeters / 1000).toFixed(2)}km</b></div>
        <div><small>移動EXP</small><b>+{result.walkExp}</b></div><div><small>CROSS</small><b>{result.crossCount}</b></div>
        <div><small>SPOT DROP</small><b>{result.spotCount}</b></div><div><small>エリア</small><b>{result.areas.length}</b></div>
      </div>
      <button className="primary-wide" onClick={onCross}>CROSSを確認</button>
      <button className="text-action" onClick={onClose}>HOMEに戻る</button>
    </section>
  </div>;
}

function MatchCelebration({ displayName, commonTags, onMessage, onClose }: { displayName: string; commonTags: string[]; onMessage: () => void; onClose: () => void }) {
  return <div className="v04-overlay match-celebration-overlay" role="dialog" aria-modal="true" aria-label="マッチ成立">
    <section className="v04-modal match-celebration-modal"><Heart className="match-heart" /><small>MUTUAL LIKE</small><h2>MATCH!</h2><p><b>{displayName}さん</b>とマッチしました</p><strong>共通TAG {commonTags.length}個</strong>{commonTags.length > 0 && <div className="profile-tags">{commonTags.slice(0, 5).map((tag) => <span className="primary" key={tag}>#{tag}</span>)}</div>}<div className="modal-actions"><button onClick={onClose}>あとで</button><button onClick={onMessage}><MessageCircle />メッセージを送る</button></div></section>
  </div>;
}

function DailyMissionBoard({ missions }: { missions: DailyMission[] }) {
  if (missions.length === 0) return null;
  const labels: Record<DailyMission["key"], string> = {
    tag_on: "TAG ONする",
    walk_1km: "東京を1km歩く",
    cross_opened: "CROSSを見る",
    all_complete: "3つすべて達成",
  };
  return <section className="mission-board">
    <header><div><small>DAILY MISSION</small><h3>今日の東京</h3></div><span>{missions.filter((item) => item.completed && item.key !== "all_complete").length} / 3</span></header>
    <div className="mission-list">{missions.map((mission) => <div key={mission.key} className={`${mission.completed ? "is-done" : ""} ${mission.key === "all_complete" ? "is-bonus" : ""}`}>
      <span className="mission-check">{mission.completed ? "✓" : ""}</span><b>{labels[mission.key]}</b><strong>+{mission.rewardExp} EXP</strong>
    </div>)}</div>
    <p>交流操作を強制しない、毎日リセットの無料ミッションです。</p>
  </section>;
}

function BetaCampaignCard({ status, authenticated, liveEnabled, now, onActivate }: { status: BetaCampaignStatus; authenticated: boolean; liveEnabled: boolean; now: number; onActivate: () => void }) {
  const activeUntil = status.boostActiveUntil ? new Date(status.boostActiveUntil) : null;
  const active = Boolean(activeUntil && activeUntil.getTime() > now);
  return <section className={`beta-campaign ${status.isBetaTester ? "is-member" : ""}`}>
    <div className="beta-campaign-icon"><Crown /></div>
    <div className="beta-campaign-copy">
      <small>TAG TOKYO BETA</small>
      <h2>{status.isBetaTester ? `β TESTER #${status.betaTesterNumber}` : status.campaignOpen ? "先着300名 βテスター募集" : "βテスター募集終了"}</h2>
      <p>{status.isBetaTester ? "限定称号と通常800円相当のBOOSTを獲得しました。" : status.campaignOpen ? `メール認証完了で限定称号＋BOOST。残り${status.remainingCount}名。` : "通常登録は引き続き利用できます。"}</p>
      {(status.isBetaTester || status.boostQuantity > 0) && <div className="beta-rewards">{status.isBetaTester && <span><BadgeCheck />β TESTER称号</span>}{status.boostQuantity > 0 && <span><Zap />BOOST ×{status.boostQuantity}</span>}</div>}
      {(status.isBetaTester || status.boostQuantity > 0) && (active
        ? <strong className="boost-active">BOOST発動中 · {activeUntil!.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}まで</strong>
        : status.boostQuantity > 0 && <button disabled={!authenticated || !liveEnabled} onClick={onActivate}><Zap />{liveEnabled ? "BOOSTを使う" : "交流開始後に使用可能"}</button>)}
    </div>
    {!status.isBetaTester && status.campaignOpen && <strong className="beta-counter">{status.claimedCount}<small>/300</small></strong>}
  </section>;
}

function HomeScreen({ session, now, start, stop, extend, notice, growth, dailyBonusNotice, showGuide, dismissGuide, missions, streak, todayStats, betaStatus, authenticated, liveEnabled, activateBoost }: {
  session: TagSessionState;
  now: number;
  start: () => void;
  stop: () => void;
  extend: () => void;
  notice: string;
  growth: GrowthState;
  dailyBonusNotice: string;
  showGuide: boolean;
  dismissGuide: () => void;
  missions: DailyMission[];
  streak: TagStreak | null;
  todayStats: TodayStats;
  betaStatus: BetaCampaignStatus;
  authenticated: boolean;
  liveEnabled: boolean;
  activateBoost: () => void;
}) {
  const progress = getLevelProgress(growth.totalEarnedExp);
  const nextUnlock = PROFILE_UNLOCKS.find((item) => item.level > progress.level);
  const walkPercent = Math.min(100, (session.dailyWalkExp / Math.max(1, session.dailyWalkExpCap)) * 100);
  const showEndingSoon = Boolean(session.active && session.expiresAt && session.expiresAt - now <= 5 * 60 * 1000 && session.expiresAt > now);
  return (
    <section className="screen home-screen">
      <div className="eyebrow"><MapPin /> TOKYO ONLY</div>
      <h1>東京を歩くほど、<br />出会いと自分が育つ。</h1>
      <p className="lead">現在地は誰にも表示されません。近くにいた事実だけをCROSSへ届け、街での活動をプロフィールの成長につなげます。</p>
      <BetaCampaignCard status={betaStatus} authenticated={authenticated} liveEnabled={liveEnabled} now={now} onActivate={activateBoost} />

      {showGuide && <section className="start-guide">
        <header><span>はじめかた</span><button onClick={dismissGuide}>閉じる</button></header>
        <div><b>1</b><span><strong>TAG ON</strong><small>東京で位置情報をON</small></span></div>
        <div><b>2</b><span><strong>歩いてEXP</strong><small>100mごとに2 EXP</small></span></div>
        <div><b>3</b><span><strong>CROSSを確認</strong><small>近くにいた人へ後からTAG</small></span></div>
      </section>}

      <div className={`tag-orbit ${session.active ? "is-on" : ""}`}>
        <button className="tag-power" onClick={session.active ? stop : start} aria-label={session.active ? "TAG OFF" : "TAG ON"}>
          <Power aria-hidden="true" />
          <strong>{session.active ? "TAG ON" : "TAG ON"}</strong>
          <span>{session.active ? `移動EXP 計測中 · ${formatRemaining(session.expiresAt, now)}` : "タップして開始"}</span>
        </button>
      </div>

      <div className="tag-session-rule"><Clock3 /><span><b>1回30分</b><small>位置情報は30分で自動OFF。続ける場合はもう一度TAG ONしてください。</small></span></div>
      {showEndingSoon && <div className="tag-ending-soon" role="status"><Clock3 /><span><b>TAG ON終了まであと5分</b><small>操作しない場合は自動で終了します</small></span><button onClick={extend}>30分延長</button></div>}

      {notice && <div className="notice" role="status">{notice}</div>}
      {dailyBonusNotice && <div className="daily-bonus" role="status"><Gift /><span><b>{dailyBonusNotice}</b><small>毎日最初のアクセスで受け取れます</small></span></div>}
      {streak && <div className="streak-strip"><span><Zap /><b>{streak.current} DAYS</b></span><div><strong>TAG STREAK</strong><small>累計 {streak.totalDays} TAG DAY · 途切れてもペナルティはありません</small></div></div>}
      <div className="walk-progress-card">
        <div className="walk-progress-head"><span><Footprints /><b>今日の移動EXP</b></span><strong>{session.dailyWalkExp} / {session.dailyWalkExpCap}</strong></div>
        <div className="walk-track"><span style={{ width: `${walkPercent}%` }} /></div>
        <div className="walk-meta"><span>{(session.dailyDistanceMeters / 1000).toFixed(2)} km</span><small>上限まで約 {Math.max(0, (5000 - session.dailyDistanceMeters) / 1000).toFixed(2)} km</small></div>
        {session.movementStatus === "speed_held" || session.movementStatus === "speed_rejected" ? <p className="movement-pause"><Clock3 />移動速度を確認中です。歩行速度に戻ると自動再開します。</p> : null}
      </div>
      <DailyMissionBoard missions={missions} />
      <div className="privacy-strip"><ShieldCheck /><span><b>現在地は非公開</b><small>正確な距離・時刻・移動方向も相手には表示しません</small></span></div>
      <div className="today-row">
        <div><small>今日のCROSS</small><strong>{todayStats.crosses}</strong></div>
        <div><small>TAGされた数</small><strong>{todayStats.receivedTags}</strong></div>
        <div><small>新しいMATCH</small><strong>{todayStats.newMatches}</strong></div>
      </div>
      <div className="growth-summary">
        <div className="level-badge"><span>PROFILE</span><b>Lv.{progress.level}</b></div>
        <div className="growth-copy">
          <div><b>次のLvまで {progress.remaining} EXP</b><strong>{growth.availableExp.toLocaleString()} EXP</strong></div>
          <div className="level-track"><span style={{ width: `${progress.percent}%` }} /></div>
          <small>所持EXPは使ってもプロフィールLvに影響しません</small>
          {nextUnlock && <small className="next-unlock">Lv.{nextUnlock.level}で「{nextUnlock.label}」を解放</small>}
        </div>
      </div>
    </section>
  );
}

function MapScreen({ growth, setGrowth, liveEnabled, onInventoryChanged }: { growth: GrowthState; setGrowth: React.Dispatch<React.SetStateAction<GrowthState>>; liveEnabled: boolean; onInventoryChanged: () => void }) {
  const [selectedAreaId, setSelectedAreaId] = useState("kitasenju");
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);
  const [stake, setStake] = useState(100);
  const [result, setResult] = useState("");
  const [rewardDisplay, setRewardDisplay] = useState<null | { tier: "normal" | "rare" | "super"; label: string }>(null);
  const [confirmContribution, setConfirmContribution] = useState(false);
  const [championNotice, setChampionNotice] = useState("");
  const [champions, setChampions] = useState<AreaChampion[]>([]);
  const area = TOKYO_AREAS.find((item) => item.id === selectedAreaId) ?? TOKYO_AREAS[0];
  const champion = champions.find((item) => item.areaId === area.id) ?? null;
  const spot = TAG_SPOTS.find((item) => item.id === selectedSpotId) ?? null;
  const myPoints = growth.areaContributions[area.id] ?? 0;
  const today = tokyoDateKey();
  const alreadyClaimed = spot ? growth.spotClaims[spot.id] === today : false;

  const loadChampions = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("get_area_champions");
    if (error) return;
    const rows = (data ?? []) as Array<{ area_id: string; area_name: string; champion_user_id: string | null; champion_display_name: string | null; champion_handle: string | null; champion_points: number; champion_is_official: boolean; my_points: number; points_to_first: number }>;
    setChampions(rows.map((item) => ({
      areaId: item.area_id,
      areaName: item.area_name,
      userId: item.champion_user_id,
      displayName: item.champion_display_name,
      handle: item.champion_handle,
      points: Number(item.champion_points ?? 0),
      isOfficial: Boolean(item.champion_is_official),
      myPoints: Number(item.my_points ?? 0),
      pointsToFirst: Number(item.points_to_first ?? 0),
    })));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadChampions(), 0);
    return () => window.clearTimeout(timer);
  }, [loadChampions]);

  async function contribute() {
    if (stake >= 500) {
      setConfirmContribution(true);
      return;
    }
    await performContribution();
  }

  async function performContribution() {
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
    await loadChampions();
    if (!champion?.userId || myPoints + stake > champion.points) {
      setChampionNotice(`${area.name}のCHAMPIONになりました`);
      window.setTimeout(() => setChampionNotice(""), 2200);
    }
    track("area_exp_contributed", { area_id: area.id, amount: stake });
    track("area_contribution", { area_id: area.id, amount: stake });
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
      const rewardName = rewardKey === "spot-ssr" ? "SUPER BOOST（BOOST 3回分）" : rewardKey === "spot-sr" ? "BOOST" : "限定プロフィール装飾";
      const isBoostReward = rewardKey === "spot-ssr" || rewardKey === "spot-sr";
      setGrowth((current) => ({
        ...current,
        totalEarnedExp: current.totalEarnedExp + rewardExp,
        availableExp: current.availableExp + rewardExp,
        ownedCosmetics: rewardType === "cosmetic" && !isBoostReward && !current.ownedCosmetics.includes(rewardKey) ? [...current.ownedCosmetics, rewardKey] : current.ownedCosmetics,
        spotClaims: { ...current.spotClaims, [spot.id]: today },
      }));
      setRewardDisplay({ tier, label: rewardType === "exp" ? `${rewardExp} EXP獲得しました` : `${rewardName}を獲得しました` });
      if (isBoostReward) onInventoryChanged();
      setResult("");
      track("spot_reward_received", { spot_id: spot.id, reward_key: rewardKey, earned_exp: rewardExp });
      track("spot_draw", { spot_id: spot.id, reward_key: rewardKey, earned_exp: rewardExp });
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
          const leader = champions.find((entry) => entry.areaId === item.id);
          return <button key={item.id} className={`area-pin ${selectedAreaId === item.id ? "selected" : ""}`} style={{ left: `${item.x}%`, top: `${item.y}%` }} onClick={() => { setSelectedAreaId(item.id); setSelectedSpotId(null); setResult(""); }}>
            <Trophy /><b>{item.name}</b><span>{leader?.displayName ? leader.displayName.slice(0, 7) : mine > 0 ? "YOU" : "未登録"}</span><small>{leader?.points ? `${leader.points.toLocaleString()}pt` : mine > 0 ? `${mine}pt` : "--"}</small>
          </button>;
        })}
        {TAG_SPOTS.map((item) => <button key={item.id} className="spot-pin" aria-label={item.name} style={{ left: `${item.x}%`, top: `${item.y}%` }} onClick={() => { setSelectedSpotId(item.id); setSelectedAreaId(item.areaId); setResult(""); track("spot_open", { spot_id: item.id, area_id: item.areaId }); }}><Gift /></button>)}
        <div className="map-legend"><span><Trophy />AREA BATTLE</span><span><Gift />SPOT DROP</span></div>
      </div>

      {spot ? (
        <div className="map-panel spot-panel">
          <div className="panel-title"><span className="panel-icon"><Gift /></span><div><small>SPOT DROP</small><h3>{spot.name.replace("TAG SPOT", "SPOT")}</h3></div></div>
          <p>現地にいることを非公開判定して、1日1回無料で抽選できます。完全なハズレはありません。</p>
          <div className="reward-line"><span>通常</span><b>30 / 50 / 100 EXP</b><span>レア</span><b>限定プロフィール装飾</b><span>激レア</span><b>BOOST / SUPER BOOST</b></div>
          <button className="primary-wide spot-draw" disabled={alreadyClaimed || !liveEnabled} onClick={() => void drawSpot()}>{alreadyClaimed ? "本日は受取済み" : liveEnabled ? "現地で無料抽選" : "サービス開始後に利用可能"}</button>
        </div>
      ) : (
        <div className="map-panel">
          <div className="area-head"><div><small>AREA BATTLE</small><h3>{area.name}</h3></div></div>
          {champion?.userId ? <div className="champion-row"><Crown /><span><small>AREA CHAMPION</small><b>{champion.displayName}{champion.isOfficial ? " · 公認" : ""}</b>{champion.handle && <em>@{champion.handle}</em>}</span><strong>{champion.points.toLocaleString()}pt</strong></div> : <div className="area-empty"><Trophy /><span><b>最初のCHAMPIONを募集中</b><small>実際にEXPが投下されると表示されます</small></span></div>}
          {myPoints > 0 && <div className="rank-row mine"><Star /><span><small>あなたの投下</small><b>プロフィール Lv.{getLevelProgress(growth.totalEarnedExp).level}</b></span><strong>{myPoints.toLocaleString()}pt</strong></div>}
          {champion && champion.pointsToFirst > 0 && <p className="points-to-first">あと <b>{champion.pointsToFirst.toLocaleString()} EXP</b> で1位</p>}
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
      {confirmContribution && <div className="v04-overlay" role="dialog" aria-modal="true" aria-label="EXP投下の確認"><section className="v04-modal safety-confirm-modal"><span className="v04-modal-icon"><Zap /></span><h2>{area.name}へ{stake} EXP投下しますか？</h2><p>所持EXP：{growth.availableExp.toLocaleString()} → {(growth.availableExp - stake).toLocaleString()}<br />プロフィールLvは下がりません。</p><div className="modal-actions"><button onClick={() => setConfirmContribution(false)}>キャンセル</button><button onClick={() => { setConfirmContribution(false); void performContribution(); }}>投下する</button></div></section></div>}
      {championNotice && <div className="connected-overlay champion-earned" role="status"><Trophy /><b>AREA CHAMPION!</b><small>{championNotice}</small></div>}
    </section>
  );
}

function OfficialBadge() {
  return <span className="official-badge" title="TAG TOKYO公認・管理人"><BadgeCheck />公認・管理人</span>;
}

function AgeVerifiedBadge() {
  return <span className="age-verified-badge"><ShieldCheck />20歳以上確認済み</span>;
}

function ActivityStatus({ status }: { status: "recent" | "away" | "inactive" }) {
  const label = status === "recent" ? "最近利用" : status === "away" ? "しばらく前に利用" : "90日以上利用なし";
  return <span className={`activity-status is-${status}`}><i aria-hidden="true" />{label}</span>;
}

function LiveCrossScreen({ crossings, recommendations, officialProfile, memberReady, liveEnabled, onTag, onLike, onRequireAccount, error, showGuide, onDismissGuide }: {
  crossings: LiveCrossing[];
  recommendations: DiscoveryProfile[];
  officialProfile: OfficialProfile | null;
  memberReady: boolean;
  liveEnabled: boolean;
  onTag: (crossing: LiveCrossing) => Promise<void>;
  onLike: (profile: DiscoveryProfile) => Promise<void>;
  onRequireAccount: () => void;
  error: string;
  showGuide: boolean;
  onDismissGuide: () => void;
}) {
  const showWelcomeOnly = officialProfile && !recommendations.some((profile) => profile.userId === officialProfile.userId);
  return <section className="screen">
    <header className="screen-header"><div><span>DISCOVER</span><h2>東京でみつける</h2></div><button className="icon-button" aria-label="通知"><Bell /></button></header>
    {showGuide && <section className="cross-guide"><Sparkles /><div><b>DISCOVERとCROSSの違い</b><p>DISCOVERは東京のおすすめ。CROSSはTAG ON中に近くにいた人です。正確な場所や時刻は表示しません。</p></div><button onClick={onDismissGuide}>確認</button></section>}
    <section className="discovery-section" aria-labelledby="discovery-title">
      <div className="section-heading"><div><small>RECOMMENDED</small><h3 id="discovery-title">おすすめ</h3></div><Heart /></div>
      {!liveEnabled ? <div className="discovery-gate"><LockKeyhole /><span><b>マッチ機能は開始準備中です</b><small>安全設定の完了後、実在ユーザーだけを表示します</small></span></div>
        : !memberReady ? <div className="discovery-gate"><ShieldCheck /><span><b>プロフィールを見るには本人確認が必要です</b><small>メール認証・規約同意・20歳以上確認を完了してください</small></span><button onClick={onRequireAccount}>設定へ</button></div>
          : recommendations.length === 0 ? <div className="discovery-gate"><UsersRound /><span><b>新しいプロフィールを待っています</b><small>異性・共通TAG 5個以上の条件を満たす実在ユーザーだけを表示します</small></span></div>
            : <div className="discovery-grid">{recommendations.map((profile) => <article className={`discovery-card ${profile.isOfficial ? "is-official" : ""}`} key={profile.userId}>
              <div className="discovery-avatar"><MemberAvatar url={profile.avatarUrl} name={profile.displayName} /></div>
              <div className="discovery-copy">{profile.isOfficial && <OfficialBadge />}<h3>{profile.displayName}</h3><AgeVerifiedBadge /><small>{profile.handle ? `@${profile.handle}` : "TAG TOKYOメンバー"}</small><ActivityStatus status={profile.activityStatus} /><p>{profile.bio || "プロフィールを見て、気になったらいいねを送れます。"}</p>{profile.tags.length > 0 && <div className="profile-tags compact-tags">{[...profile.primaryTags, ...profile.tags.filter((tag) => !profile.primaryTags.includes(tag))].slice(0, 5).map((tag) => <span key={tag} className={profile.primaryTags.includes(tag) ? "primary" : ""}>#{tag}</span>)}</div>}{profile.commonTagCount > 0 && <small className="common-tag-count">共通タグ {profile.commonTagCount}</small>}</div>
              <button className="discovery-like" disabled={profile.liked} onClick={() => void onLike(profile)}><Heart />{profile.liked ? "送信済み" : "いいね"}</button>
            </article>)}</div>}
    </section>
    <div className="privacy-strip"><ShieldCheck /><span><b>場所と時刻はぼかして表示</b><small>現在地・正確な距離・移動方向は相手に公開しません</small></span></div>
    {showWelcomeOnly && <article className="live-cross-card official-profile-card"><div className="chat-avatar">{officialProfile.displayName.slice(0, 1)}</div><div><OfficialBadge /><h3>{officialProfile.displayName}</h3><p>{officialProfile.handle ? `@${officialProfile.handle} · ${officialProfile.bio || "TAG TOKYOを運営しています"}` : officialProfile.bio || "TAG TOKYOを運営しています"}</p></div><span className="official-profile-label">WELCOME</span></article>}
    <div className="cross-section-title"><Sparkles /><span><b>CROSS</b><small>街で近くにいた人</small></span></div>
    {crossings.length === 0 ? <div className="empty-state"><div className="empty-icon"><Sparkles /></div><h3>新しいCROSSを待っています</h3><p>東京都内でTAG ONにすると、近くにいた年齢確認済みユーザーが後から表示されます。</p></div> : <div className="live-cross-list">
      {crossings.map((crossing) => <article className={`live-cross-card ${crossing.isOfficial ? "official-profile-card" : ""}`} key={crossing.id}><div className="chat-avatar"><MemberAvatar url={crossing.avatarUrl ?? null} name={crossing.displayName} /></div><div><small>{crossing.areaLabel} · このエリアですれ違いました</small><h3>{crossing.displayName} {crossing.isOfficial && <OfficialBadge />}</h3><AgeVerifiedBadge /><ActivityStatus status={crossing.activityStatus} /><p>{crossing.handle ? `@${crossing.handle}` : crossing.bio || "プロフィールを確認してTAGできます"}</p>{crossing.primaryTags.length > 0 && <div className="profile-tags compact-tags">{crossing.primaryTags.map((tag) => <span className="primary" key={tag}>#{tag}</span>)}</div>}<small className="common-tag-count">共通タグ {crossing.commonTagCount}</small></div><button disabled={crossing.tagged} onClick={() => void onTag(crossing)}><Sparkles />{crossing.tagged ? "TAG済み" : "TAG"}</button></article>)}
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
        <h3>相互いいねで、はじめて話せる</h3>
        <p>おすすめの相手へいいねを送り、相手からもいいねが届くとチャットが開きます。すれ違いの相互TAGでもマッチできます。</p>
      </div>
      <div className="rule-list">
        <div><ShieldCheck /><span><b>相互いいね・相互TAGだけ</b><small>片方からの操作だけでは連絡できません</small></span></div>
        <div><UsersRound /><span><b>ブロック・通報</b><small>マッチ後もすぐに安全操作できます</small></span></div>
        <div><Clock3 /><span><b>すれ違いは30日で削除</b><small>位置情報そのものは24時間以内に削除します</small></span></div>
      </div>
    </section>
  );
}

function LiveMatchScreen({
  matches, messages, currentUserId, selectedMatchId, loading, error, memberReady, messageAccessReady,
  onSelect, onSend, onReact, onLoadOlder, onUnmatch, onBlock, onReport, onRequireEmail,
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
  onReact: (messageId: number, reaction: "heart" | "like" | "laugh" | "wow") => Promise<void>;
  onLoadOlder: (matchId: string, before: string) => Promise<void>;
  onUnmatch: (matchId: string) => Promise<void>;
  onBlock: (matchId: string) => Promise<void>;
  onReport: (matchId: string, reason: string, detail: string) => Promise<boolean>;
  onRequireEmail: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [reportReason, setReportReason] = useState("harassment");
  const [reportDetail, setReportDetail] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"unmatch" | "block" | "reportBlock" | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? matches[0] ?? null;
  const thread = selectedMatch ? messages[selectedMatch.id] ?? [] : [];
  const commonTags = selectedMatch?.primaryTags.slice(0, 3) ?? [];
  const conversationStarters = commonTags.length > 0
    ? [`${commonTags[0]}好きなんですね！`, "この辺よく来ます？", "共通TAGが多くて気になりました"]
    : ["この辺よく来ます？", "プロフィールを見て気になりました", "マッチありがとうございます！"];

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
      <div className="empty-state"><div className="empty-icon"><MessageCircle /></div><h3>{loading ? "マッチを確認中" : "相互いいねを待っています"}</h3><p>お互いにいいね、またはTAGした相手だけがここに表示され、メッセージを交換できます。</p></div>
      {error && <p className="chat-error" role="alert">{error}</p>}
    </section>;
  }

  return <section className="screen live-match-screen">
    <header className="screen-header"><div><span>MATCH</span><h2>メッセージ</h2></div><span className="match-count">{matches.length}</span></header>
    <div className="live-match-tabs" aria-label="マッチ一覧">
      {matches.map((match) => {
        const lastMessage = messages[match.id]?.at(-1);
        return <button key={match.id} className={selectedMatch.id === match.id ? "active" : ""} onClick={() => { onSelect(match.id); setShowSafety(false); setShowProfile(false); }}>
          <span className="match-list-avatar"><MemberAvatar url={match.avatarUrl} name={match.displayName} />{match.unreadCount > 0 && <em>{match.unreadCount}</em>}</span>
          <span className="match-list-copy"><b>{match.displayName}{match.isOfficial && <BadgeCheck aria-label="公式" />}<ShieldCheck aria-label="20歳以上確認済み" /></b><small>{lastMessage?.body ?? "マッチしました"}</small></span>
          <time>{lastMessage ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(lastMessage.createdAt)) : ""}</time>
        </button>;
      })}
    </div>
    <div className="chat-card">
      <header className="chat-header"><button className="chat-profile-trigger" onClick={() => { setShowProfile(true); track("profile_view", { source: "chat" }); }} aria-label={`${selectedMatch.displayName}さんのプロフィールを開く`}><span className="chat-avatar"><MemberAvatar url={selectedMatch.avatarUrl} name={selectedMatch.displayName} /></span><span><b>{selectedMatch.displayName} {selectedMatch.isOfficial && <OfficialBadge />}</b><AgeVerifiedBadge /><small>{selectedMatch.handle ? `@${selectedMatch.handle}` : "相互いいねでマッチ"}</small><ActivityStatus status={selectedMatch.activityStatus} /></span></button><button aria-label="安全メニュー" onClick={() => setShowSafety((value) => !value)}><ShieldCheck /></button></header>
      {showSafety && <div className="chat-safety-panel">
        <b>安全メニュー</b>
        <label><span>通報理由</span><select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option value="harassment">迷惑行為・嫌がらせ</option><option value="impersonation">なりすまし</option><option value="solicitation">勧誘・営業</option><option value="unsafe">危険を感じる行為</option><option value="other">その他</option></select></label>
        <textarea value={reportDetail} maxLength={1000} placeholder="状況を入力（任意）" onChange={(event) => setReportDetail(event.target.value)} />
        <div><button onClick={async () => { if (await onReport(selectedMatch.id, reportReason, reportDetail)) { setReportDetail(""); setShowSafety(false); setConfirmAction("reportBlock"); } }}><Flag />通報する</button><button onClick={() => setConfirmAction("unmatch")}><HeartHandshake />解除</button><button className="danger" onClick={() => setConfirmAction("block")}><Ban />ブロック</button></div>
      </div>}
      <div className="chat-thread" aria-live="polite">
        {thread.length >= 50 && <button className="load-older" disabled={loadingOlder} onClick={async () => { setLoadingOlder(true); await onLoadOlder(selectedMatch.id, thread[0].createdAt); setLoadingOlder(false); }}>{loadingOlder ? "読み込み中" : "過去のメッセージを表示"}</button>}
        {thread.length === 0 && <div className="chat-start"><Sparkles /><b>マッチしました</b><span>まずは共通点から話してみましょう</span>{commonTags.length > 0 && <div className="chat-common-tags">{commonTags.map((tag) => <em key={tag}>#{tag}</em>)}</div>}<div className="starter-list">{conversationStarters.map((starter) => <button key={starter} onClick={() => setDraft(starter)}>{starter}</button>)}</div></div>}
        {thread.map((message, index) => {
          const day = new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(new Date(message.createdAt));
          const previousDay = index > 0 ? new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(new Date(thread[index - 1].createdAt)) : null;
          return <div key={message.id} className="chat-message-wrap">{day !== previousDay && <div className="chat-date-separator">{day}</div>}<div className={`chat-message ${message.senderId === currentUserId ? "mine" : "theirs"}`}><p>{message.body}</p><div className="message-meta"><time>{new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}{message.senderId === currentUserId && message.readAt ? " · 既読" : ""}</time>{message.senderId !== currentUserId && <span className="reaction-actions"><button aria-label="ハート" onClick={() => void onReact(message.id, "heart")}>❤️</button><button aria-label="いいね" onClick={() => void onReact(message.id, "like")}>👍</button><button aria-label="笑い" onClick={() => void onReact(message.id, "laugh")}>😂</button><button aria-label="びっくり" onClick={() => void onReact(message.id, "wow")}>😮</button></span>}</div>{message.reactions.length > 0 && <small className="reaction-summary">{message.reactions.map((reaction) => reaction.reaction === "heart" ? "❤️" : reaction.reaction === "like" ? "👍" : reaction.reaction === "laugh" ? "😂" : "😮").join(" ")}</small>}</div></div>;
        })}
      </div>
      <form className="chat-compose" onSubmit={submitMessage}><label><textarea aria-label="メッセージ" value={draft} maxLength={100} rows={2} placeholder="メッセージを入力" onChange={(event) => setDraft(event.target.value)} /><small>{draft.length} / 100</small></label><button type="submit" aria-label="送信" disabled={sending || !draft.trim()}><Send /></button></form>
    </div>
    {error && <p className="chat-error" role="alert">{error}</p>}
    {showProfile && <div className="v04-overlay" role="dialog" aria-modal="true" aria-label={`${selectedMatch.displayName}さんのプロフィール`}><section className="v04-modal member-profile-modal"><button className="modal-close" aria-label="閉じる" onClick={() => setShowProfile(false)}>×</button><span className="profile-modal-avatar"><MemberAvatar url={selectedMatch.avatarUrl} name={selectedMatch.displayName} /></span><h2>{selectedMatch.displayName} <small>Lv.{selectedMatch.profileLevel}</small></h2><AgeVerifiedBadge />{selectedMatch.activityArea && <p className="profile-modal-area"><MapPin />{selectedMatch.activityArea}</p>}<p>{selectedMatch.bio || "自己紹介はまだありません"}</p>{selectedMatch.primaryTags.length > 0 && <div className="profile-tags">{selectedMatch.primaryTags.map((tag) => <span className="primary" key={tag}>#{tag}</span>)}</div>}<small className="common-tag-count">共通TAG {selectedMatch.commonTagCount}個</small></section></div>}
    {confirmAction && <div className="v04-overlay" role="dialog" aria-modal="true" aria-label="安全操作の確認"><section className="v04-modal safety-confirm-modal"><span className="v04-modal-icon">{confirmAction === "unmatch" ? <HeartHandshake /> : <Ban />}</span><h2>{confirmAction === "unmatch" ? `${selectedMatch.displayName}さんとのマッチを解除しますか？` : confirmAction === "reportBlock" ? "このユーザーもブロックしますか？" : `${selectedMatch.displayName}さんをブロックしますか？`}</h2><p>{confirmAction === "unmatch" ? "メッセージを停止し、30日間お互いのおすすめに表示しません。30日後は再マッチできます。" : "今後、お互いのCROSS・おすすめ・MATCHに表示されなくなります。"}</p><div className="modal-actions"><button onClick={() => setConfirmAction(null)}>キャンセル</button><button className="danger" onClick={async () => { const action = confirmAction; setConfirmAction(null); if (action === "unmatch") await onUnmatch(selectedMatch.id); else await onBlock(selectedMatch.id); }}>{confirmAction === "unmatch" ? "解除する" : "ブロック"}</button></div></section></div>}
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

function TagCollectionEditor({ catalog, selected, primary, onChange }: {
  catalog: TagCatalogItem[];
  selected: string[];
  primary: string[];
  onChange: (selected: string[], primary: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("すべて");
  const categories = ["すべて", ...new Set(catalog.map((tag) => tag.category))];
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = catalog.filter((tag) => (category === "すべて" || tag.category === category)
    && (!normalizedQuery || [tag.name, ...tag.aliases].some((value) => value.toLowerCase().includes(normalizedQuery))));

  function toggle(name: string) {
    if (selected.includes(name)) onChange(selected.filter((tag) => tag !== name), primary.filter((tag) => tag !== name));
    else if (selected.length < 50) onChange([...selected, name], primary);
  }

  function togglePrimary(name: string) {
    if (!selected.includes(name)) return;
    if (primary.includes(name)) onChange(selected, primary.filter((tag) => tag !== name));
    else if (primary.length < 5) onChange(selected, [...primary, name]);
  }

  return <fieldset className="tag-selector tag-collection"><legend>TAG COLLECTION <small>{selected.length} / 50</small></legend>
    <p>5個以上選択。★はプロフィール上部に出すメインタグ（最大5個）です。</p>
    <label className="tag-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タグや別名を検索" /></label>
    <div className="tag-categories">{categories.map((item) => <button type="button" key={item} className={category === item ? "selected" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
    {selected.length > 0 && <div className="selected-tag-list">{selected.map((name) => <span key={name}><button type="button" className="tag-primary" aria-label={`${name}をメインタグにする`} aria-pressed={primary.includes(name)} onClick={() => togglePrimary(name)}><Star /></button><button type="button" onClick={() => toggle(name)}>#{name} ×</button></span>)}</div>}
    <div className="tag-catalog-list">{filtered.map((tag) => <button type="button" key={tag.id} className={selected.includes(tag.name) ? "selected" : ""} aria-pressed={selected.includes(tag.name)} onClick={() => toggle(tag.name)}>#{tag.name}{tag.recentUses > 0 && <small>HOT</small>}</button>)}</div>
    {filtered.length === 0 && <p className="tag-empty">該当するタグがありません</p>}
  </fieldset>;
}

function MeScreen({ email, setEmail, birthDate, setBirthDate, authNotice, sendMagicLink, signOut, requestAccountDeletion, growth, buyCosmetic, equipCosmetic, profile, setProfile, tagCatalog, isOwner, liveEnabled, emailAuthenticated, consentReady, ageVerificationStatus }: {
  email: string;
  setEmail: (value: string) => void;
  birthDate: string;
  setBirthDate: (value: string) => void;
  authNotice: string;
  sendMagicLink: (termsAccepted: boolean, privacyAccepted: boolean) => void;
  signOut: () => void;
  requestAccountDeletion: () => void;
  growth: GrowthState;
  buyCosmetic: (id: string) => void;
  equipCosmetic: (id: string) => void;
  profile: EditableProfile;
  setProfile: (profile: EditableProfile) => void;
  tagCatalog: TagCatalogItem[];
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
  const [termsAccepted, setTermsAccepted] = useState(consentReady);
  const [privacyAccepted, setPrivacyAccepted] = useState(consentReady);
  const equippedTitle = COSMETICS.find((item) => item.id === growth.equippedTitle)?.name;
  const profileFields: Array<{ key: keyof EditableProfile; label: string; level: number; placeholder: string; long?: boolean }> = [
    { key: "displayName", label: "表示名", level: 1, placeholder: "表示名" },
    { key: "handle", label: "ユーザーID", level: 1, placeholder: "5〜15文字の英数字または _" },
    { key: "activityArea", label: "よく行くエリア", level: 1, placeholder: "北千住・綾瀬・上野など" },
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
    if (draft.tags.length < 5 || draft.tags.length > 50) {
      setEditorError("興味タグは5〜50個選んでください");
      return;
    }
    const nextProfile = { ...draft, displayName: draft.displayName.trim().slice(0, 50) || "あなた", handle };
    if (emailAuthenticated && supabase) {
      let { error } = await supabase.rpc("update_member_profile_v3", {
        p_display_name: nextProfile.displayName,
        p_handle: nextProfile.handle,
        p_bio: nextProfile.bio,
        p_gender: nextProfile.gender,
        p_activity_area: nextProfile.activityArea,
        p_weekend: nextProfile.weekend,
        p_romance_view: nextProfile.romance,
        p_contact_frequency: nextProfile.contactFrequency,
        p_values_detail: nextProfile.values,
        p_lifestyle: nextProfile.lifestyle,
        p_work_detail: nextProfile.work,
        p_money_style: nextProfile.moneyStyle,
        p_marriage_view: nextProfile.marriageView,
        p_extra_bio: nextProfile.extraBio,
      });
      if (error?.message.includes("update_member_profile_v3")) {
        const v2Fallback = await supabase.rpc("update_member_profile_v2", {
          p_display_name: nextProfile.displayName,
          p_handle: nextProfile.handle,
          p_bio: nextProfile.bio,
          p_gender: nextProfile.gender,
          p_weekend: nextProfile.weekend,
          p_romance_view: nextProfile.romance,
          p_contact_frequency: nextProfile.contactFrequency,
          p_values_detail: nextProfile.values,
          p_lifestyle: nextProfile.lifestyle,
          p_work_detail: nextProfile.work,
          p_money_style: nextProfile.moneyStyle,
          p_marriage_view: nextProfile.marriageView,
          p_extra_bio: nextProfile.extraBio,
        });
        error = v2Fallback.error;
      }
      if (error?.message.includes("update_member_profile_v2")) {
        const legacyFallback = await supabase.rpc("update_member_profile", {
          p_display_name: nextProfile.displayName,
          p_handle: nextProfile.handle,
          p_bio: nextProfile.bio,
          p_gender: nextProfile.gender,
        });
        error = legacyFallback.error;
      }
      if (error) {
        setEditorError(error.message.includes("update_member_profile") ? "プロフィール更新機能のDB設定が必要です" : error.message);
        return;
      }
      let { error: tagError } = await supabase.rpc("set_my_profile_tags_v2", { p_tag_names: nextProfile.tags, p_primary_names: nextProfile.primaryTags });
      if (tagError?.message.includes("set_my_profile_tags_v2")) {
        const fallback = await supabase.rpc("set_my_profile_tags", { p_tag_names: nextProfile.tags.slice(0, 8) });
        tagError = fallback.error;
      }
      if (tagError) {
        setEditorError(tagError.message.includes("set_my_profile_tags") ? "プロフィールタグ機能のDB更新後に保存できます" : tagError.message);
        return;
      }
    }
    setProfile(nextProfile);
    setEditing(false);
    track("tagtokyo_profile_updated", { unlocked_level: progress.level });
  }

  async function selectPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!PROFILE_PHOTO_TYPES.includes(file.type) || file.size > PROFILE_PHOTO_MAX_BYTES) {
      setPhotoNotice("写真は5MB以下のJPEG・PNG・WebPを選んでください");
      event.target.value = "";
      return;
    }
    setPhotoNotice("写真を調整しています…");
    const objectUrl = URL.createObjectURL(file);
    let savedOnDevice = false;
    try {
      const image = new Image();
      image.src = objectUrl;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("invalid image"));
      });
      const scale = Math.min(1, PROFILE_PHOTO_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas unavailable");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let quality = 0.86;
      let avatarDataUrl = canvas.toDataURL("image/jpeg", quality);
      while (avatarDataUrl.length * 0.75 > PROFILE_PHOTO_TARGET_BYTES && quality > 0.5) {
        quality -= 0.1;
        avatarDataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      setProfile({ ...profile, avatarDataUrl });
      savedOnDevice = true;
      if (emailAuthenticated && supabase) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("メール認証後にクラウド保存できます");
        const avatarBlob = await fetch(avatarDataUrl).then((response) => response.blob());
        const objectPath = `${user.id}/avatar.jpg`;
        const { error: uploadError } = await supabase.storage.from("profile-photos").upload(objectPath, avatarBlob, {
          contentType: "image/jpeg",
          upsert: true,
        });
        if (uploadError) throw uploadError;
        const { error: profileError } = await supabase.rpc("set_my_profile_avatar", { p_object_path: objectPath });
        if (profileError) throw profileError;
        setPhotoNotice("写真をクラウドに保存しました");
      } else {
        setPhotoNotice("この端末に保存しました。メール認証後はクラウドにも保存されます");
      }
    } catch {
      setPhotoNotice(savedOnDevice
        ? "写真は端末に保存しましたが、クラウド保存に失敗しました。ログイン状態を確認してください"
        : "画像を読み込めませんでした。別の写真を選んでください");
    } finally {
      URL.revokeObjectURL(objectUrl);
      event.target.value = "";
    }
  }

  return (
    <section className="screen">
      <header className="screen-header"><div><span>ME</span><h2>プロフィール</h2></div></header>
      {isOwner && <div className="owner-note"><Crown /><span><b>OWNER MODE</b><small>全プロフィール項目と装飾を自由に確認できます</small></span></div>}
      <div className={`me-card profile-showcase ${growth.equippedBackground ? `equip-${growth.equippedBackground}` : ""}`}>
        <label className={`me-avatar avatar-upload ${growth.equippedFrame ? `equip-${growth.equippedFrame}` : ""}`}><ProfilePhoto profile={profile} /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectPhoto(event)} /><span className="avatar-camera"><Camera /></span></label>
        <div>{equippedTitle && <small className="equipped-title">{equippedTitle}</small>}<h3>{profile.displayName} {isOwner && <OfficialBadge />} <span className="profile-level">Lv.{progress.level}</span></h3>{ageVerificationStatus === "verified" && <AgeVerifiedBadge />}<p>@{profile.handle} · {profile.bio}</p>{profile.activityArea && <small className="profile-area"><MapPin />{profile.activityArea}</small>}{profile.tags.length > 0 && <div className="profile-tags">{[...profile.primaryTags, ...profile.tags.filter((tag) => !profile.primaryTags.includes(tag))].slice(0, 5).map((tag) => <span className={profile.primaryTags.includes(tag) ? "primary" : ""} key={tag}>#{tag}</span>)}</div>}{photoNotice && <small className="photo-notice">{photoNotice}</small>}</div>
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
          {COSMETICS.filter((item) => (!item.campaignOnly || isOwner || growth.ownedCosmetics.includes(item.id)) && (!item.rewardLevel || progress.level >= item.rewardLevel || growth.ownedCosmetics.includes(item.id))).map((item) => {
            const owned = growth.ownedCosmetics.includes(item.id);
            const equipped = growth.equippedFrame === item.id || growth.equippedBackground === item.id || growth.equippedTitle === item.id;
            return <article key={item.id} className="cosmetic-tile">
              <div className={`cosmetic-visual visual-${item.slot}`} style={{ "--item-color": item.color } as React.CSSProperties}><span>{item.slot === "title" ? "Aa" : "A"}</span></div>
              <div><small>{item.kind}</small><b>{item.name}</b></div>
              <button disabled={equipped || (!isOwner && !owned && (Boolean(item.rewardLevel) || growth.availableExp < item.cost))} onClick={() => owned ? equipCosmetic(item.id) : buyCosmetic(item.id)}>{equipped ? "装備中" : owned ? "装備する" : isOwner ? "自由に試着" : item.rewardLevel ? `Lv.${item.rewardLevel}で獲得` : `${item.cost} EXP`}</button>
            </article>;
          })}
        </div>
      </div>
      <div className="settings-card">
        <div className="section-heading"><div><small>ACCOUNT</small><h3>{emailAuthenticated ? "アカウント登録済み" : "無料アカウントを作成"}</h3></div><ShieldCheck /></div>
        <div className="registration-progress" aria-label="登録状況">
          <span className={isAdultBirthDate(birthDate) ? "complete" : ""}><b>1</b>生年月日</span>
          <span className={emailAuthenticated ? "complete" : ""}><b>2</b>メール認証</span>
          <span className={consentReady ? "complete" : ""}><b>3</b>規約同意</span>
          <span className={ageVerificationStatus === "verified" ? "complete" : ""}><b>4</b>年齢確認</span>
        </div>
        <label className="field"><span>生年月日（20歳以上）</span><input type="date" value={birthDate} max={adultBirthDateLimit()} onChange={(event) => setBirthDate(event.target.value)} autoComplete="bday" disabled={emailAuthenticated && Boolean(birthDate)} /></label>
        <label className="field"><span>メールアドレス</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" disabled={emailAuthenticated} /></label>
        {!consentReady && <>
          <label className="access-check"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span><a href={`${ASSET_PREFIX}/terms/`} target="_blank" rel="noreferrer">利用規約</a>に同意する</span></label>
          <label className="access-check"><input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /><span><a href={`${ASSET_PREFIX}/privacy/`} target="_blank" rel="noreferrer">プライバシーポリシー</a>に同意する</span></label>
        </>}
        {!emailAuthenticated || !consentReady
          ? <button className="primary-wide" disabled={!isAdultBirthDate(birthDate)} onClick={() => sendMagicLink(termsAccepted, privacyAccepted)}>{hasSupabase ? emailAuthenticated ? "同意して登録を完了" : "認証メールを送る" : "接続準備中"}</button>
          : <button className="secondary-wide" onClick={signOut}>ログアウト</button>}
        {authNotice && <p className="field-notice">{authNotice}</p>}
      </div>
      <div className="settings-card">
        <h3>安全と20歳以上確認</h3>
        <AgeVerificationPanel key={`${ageVerificationStatus}-${consentReady}`} authenticated={emailAuthenticated} consentReady={consentReady} initialStatus={ageVerificationStatus} profile={profile} />
        {isOwner && <a className="moderation-link" href={`${ASSET_PREFIX}/moderation/`}><ShieldCheck /><span><b>運営審査画面</b><small>提出画像の確認・承認・削除</small></span><ChevronRight /></a>}
        {emailAuthenticated && <button className="setting-link danger" onClick={requestAccountDeletion}><span>退会・データ削除を申請</span><LogOut /></button>}
      </div>
      <div className="settings-card compact">
        <p><b>位置情報の扱い</b></p>
        <p>すれ違い判定だけに利用し、生の位置情報は数時間から24時間以内に削除します。他ユーザーへ現在地や正確な距離を公開しません。</p>
      </div>
      <div className={`settings-card launch-status ${liveEnabled ? "is-live" : ""}`}>
        <div className="section-heading"><div><small>COMMUNITY STATUS</small><h3>{liveEnabled ? "正式サービス運用中" : "正式公開の最終準備中"}</h3></div><ShieldCheck /></div>
        <p>{liveEnabled ? "年齢確認済みの参加者だけが交流機能を利用できます。" : "プロフィール作成と街歩き機能を公開中です。実在ユーザー同士のTAG・MATCH・メッセージは届出確認後に有効化します。"}</p>
        <ul><li>現在地・正確な距離は非公開</li><li>ブロック・通報を常時利用可能</li><li>20歳未満は利用不可</li></ul>
      </div>
      <FeedbackPanel />
      {editing && <div className="profile-editor-overlay" role="dialog" aria-modal="true" aria-label="プロフィール編集">
        <div className="profile-editor">
          <header><div><small>EDIT PROFILE</small><h3>プロフィールを編集</h3></div><button aria-label="編集を閉じる" onClick={() => setEditing(false)}>×</button></header>
          <p className="editor-guide">{isOwner ? "オーナーはすべての項目を編集できます" : `Lv.${progress.level}までの項目を編集できます`}。表示名は50文字まで、ユーザーIDは5〜15文字の英数字または _ です。</p>
          <div className="editor-fields">
            <label><span>性別</span><select value={draft.gender} onChange={(event) => setDraft((current) => ({ ...current, gender: event.target.value as EditableProfile["gender"] }))}><option value="unspecified">回答しない</option><option value="woman">女性</option><option value="man">男性</option><option value="nonbinary">その他</option></select></label>
            {(draft.gender === "nonbinary" || draft.gender === "unspecified") && <p className="access-gender-note">現在、マッチング機能は男性・女性登録間のみ対応しています。MAP・育成機能は利用できます。</p>}
            <TagCollectionEditor catalog={tagCatalog} selected={draft.tags} primary={draft.primaryTags} onChange={(tags, primaryTags) => setDraft((current) => ({ ...current, tags, primaryTags }))} />
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
  const [birthDate, setBirthDate] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [growth, setGrowth] = useState<GrowthState>(INITIAL_GROWTH);
  const [profile, setProfile] = useState<EditableProfile>(INITIAL_PROFILE);
  const [tagCatalog, setTagCatalog] = useState<TagCatalogItem[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [isEmailAuthenticated, setIsEmailAuthenticated] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [databaseLiveEnabled, setDatabaseLiveEnabled] = useState(false);
  const [liveMemberReady, setLiveMemberReady] = useState(false);
  const [ageVerificationStatus, setAgeVerificationStatus] = useState<"not_started" | "pending" | "verified" | "rejected" | "expired">("not_started");
  const [consentReady, setConsentReady] = useState(false);
  const [liveCrossings, setLiveCrossings] = useState<LiveCrossing[]>([]);
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [discoveryProfiles, setDiscoveryProfiles] = useState<DiscoveryProfile[]>([]);
  const [officialProfile, setOfficialProfile] = useState<OfficialProfile | null>(null);
  const [liveMessages, setLiveMessages] = useState<Record<string, LiveMessage[]>>({});
  const [selectedLiveMatchId, setSelectedLiveMatchId] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [showMessageGate, setShowMessageGate] = useState(false);
  const [growthLoaded, setGrowthLoaded] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [dailyBonusNotice, setDailyBonusNotice] = useState("");
  const [dailyMissions, setDailyMissions] = useState<DailyMission[]>([]);
  const [tagStreak, setTagStreak] = useState<TagStreak | null>(null);
  const [todayStats, setTodayStats] = useState<TodayStats>(EMPTY_TODAY_STATS);
  const [betaStatus, setBetaStatus] = useState<BetaCampaignStatus>(EMPTY_BETA_STATUS);
  const [matchCelebration, setMatchCelebration] = useState<null | { matchId: string | null; userId: string; displayName: string; commonTags: string[] }>(null);
  const [showHomeGuide, setShowHomeGuide] = useState(false);
  const [showCrossGuide, setShowCrossGuide] = useState(false);
  const [showTagIntro, setShowTagIntro] = useState(false);
  const [showConnected, setShowConnected] = useState(false);
  const [walkPulse, setWalkPulse] = useState("");
  const [sessionResult, setSessionResult] = useState<TagSessionResult | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const stopLocationWatchRef = useRef<null | (() => void)>(null);
  const locationRequestPendingRef = useRef(false);
  const lastMilestoneRef = useRef(0);
  const dailyCapTrackedRef = useRef(false);
  const walkMissionClaimedRef = useRef(false);
  const previousLevelRef = useRef<number | null>(null);
  const betaTrackedRef = useRef(false);
  const liveEnabled = isLiveCommunityEnabled && databaseLiveEnabled;

  const refreshBetaStatus = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("get_beta_campaign_status");
    if (error) return;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    setBetaStatus({
      claimedCount: Number(row.claimed_count ?? 0),
      remainingCount: Number(row.remaining_count ?? 0),
      campaignOpen: Boolean(row.campaign_open),
      isBetaTester: Boolean(row.is_beta_tester),
      betaTesterNumber: row.beta_tester_number === null ? null : Number(row.beta_tester_number),
      rewardClaimed: Boolean(row.reward_claimed),
      boostQuantity: Number(row.boost_quantity ?? 0),
      boostActiveUntil: row.boost_active_until ?? null,
    });
    if (row.is_beta_tester && !betaTrackedRef.current) {
      betaTrackedRef.current = true;
      track("beta_tester_awarded", { beta_tester_number: Number(row.beta_tester_number) });
    }
  }, []);

  const activateBetaBoost = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc("activate_beta_boost");
    if (error) {
      setNotice(error.message === "live community is not enabled" ? "交流機能の開始後にBOOSTを使用できます" : error.message);
      return;
    }
    setNotice("BOOSTを発動しました。30分間、CROSS探索範囲が1.5倍になります。");
    track("beta_boost_activated");
    await refreshBetaStatus();
  }, [refreshBetaStatus]);

  const refreshDailyMissions = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("get_daily_missions");
    if (error) return;
    const rows = (data ?? []) as Array<{ mission_key: string; reward_exp: number; completed: boolean }>;
    const missions: DailyMission[] = rows.map((item) => ({
      key: item.mission_key as DailyMission["key"],
      rewardExp: Number(item.reward_exp),
      completed: Boolean(item.completed),
    }));
    setDailyMissions(missions);
    walkMissionClaimedRef.current = Boolean(missions.find((item) => item.key === "walk_1km")?.completed);
  }, []);

  const claimDailyMission = useCallback(async (key: DailyMission["key"]) => {
    if (!supabase || key === "all_complete") return;
    const { data, error } = await supabase.rpc("claim_daily_mission", { p_mission_key: key });
    if (error) return;
    const awarded = Number(data ?? 0);
    if (awarded > 0) {
      setGrowth((current) => ({ ...current, totalEarnedExp: current.totalEarnedExp + awarded, availableExp: current.availableExp + awarded }));
      setWalkPulse(`MISSION +${awarded} EXP`);
      window.setTimeout(() => setWalkPulse(""), 2200);
      track("daily_mission_completed", { mission_key: key, earned_exp: awarded });
    }
    await refreshDailyMissions();
  }, [refreshDailyMissions]);

  const refreshTagStreak = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("get_my_tag_streak");
    if (error) return;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    setTagStreak({ current: Number(row.current_streak ?? 0), totalDays: Number(row.total_tag_days ?? 0), lastTagDate: row.last_tag_date ?? null });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!window.sessionStorage.getItem("tagtokyo_first_visit_v1")) {
        window.sessionStorage.setItem("tagtokyo_first_visit_v1", "1");
        track("first_visit");
      }
      const today = tokyoDateKey();
      const firstVisitDate = window.localStorage.getItem("tagtokyo_first_visit_date_v1");
      if (!firstVisitDate) window.localStorage.setItem("tagtokyo_first_visit_date_v1", today);
      else {
        const elapsedDays = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${firstVisitDate}T00:00:00Z`)) / 86400000);
        if (elapsedDays >= 1 && !window.localStorage.getItem("tagtokyo_return_day_1_v1")) {
          window.localStorage.setItem("tagtokyo_return_day_1_v1", "1");
          track("return_day_1");
        }
        if (elapsedDays >= 7 && !window.localStorage.getItem("tagtokyo_return_day_7_v1")) {
          window.localStorage.setItem("tagtokyo_return_day_7_v1", "1");
          track("return_day_7");
        }
      }
      setShowHomeGuide(window.localStorage.getItem("tagtokyo_home_guide_v04") !== "done");
      setShowCrossGuide(window.localStorage.getItem("tagtokyo_cross_guide_v04") !== "done");
    }, 0);
    return () => {
      window.clearTimeout(timer);
      stopLocationWatchRef.current?.();
    };
  }, []);

  useEffect(() => {
    const level = getLevelProgress(growth.totalEarnedExp).level;
    const previous = previousLevelRef.current;
    previousLevelRef.current = level;
    if (previous !== null && level > previous) {
      setLevelUp(level);
      track("profile_level_up", { profile_level: level });
      const timer = window.setTimeout(() => setLevelUp(null), 2800);
      return () => window.clearTimeout(timer);
    }
  }, [growth.totalEarnedExp]);

  const loadPersistentAccountState = useCallback(async (userId: string) => {
    if (!supabase) return;
    await supabase.rpc("claim_level_rewards");
    const [profileResult, cosmeticsResult, contributionsResult, drawsResult, loginResult, tagsResult] = await Promise.all([
      supabase.from("profiles").select("display_name,handle,bio,gender,avatar_url,activity_area,weekend,romance_view,contact_frequency,values_detail,lifestyle,work_detail,money_style,marriage_view,extra_bio,total_earned_exp,available_exp,equipped_frame,equipped_background,equipped_title").eq("user_id", userId).maybeSingle(),
      supabase.from("user_cosmetics").select("cosmetic_id").eq("user_id", userId),
      supabase.from("area_contributions").select("area_id,points").eq("user_id", userId),
      supabase.from("tag_spot_draws").select("spot_id,draw_date").eq("user_id", userId).order("draw_date", { ascending: false }).limit(100),
      supabase.from("daily_login_claims").select("claim_date").eq("user_id", userId).order("claim_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("user_tags").select("is_primary,sort_order,tags(name)").eq("user_id", userId).order("sort_order", { ascending: true }),
    ]);
    if (profileResult.error) {
      setAuthNotice(profileResult.error.message);
      return;
    }
    const row = profileResult.data;
    if (!row) return;
    let avatarUrl = "";
    if (row.avatar_url) {
      const { data } = await supabase.storage.from("profile-photos").createSignedUrl(row.avatar_url, 3600);
      avatarUrl = data?.signedUrl ?? "";
    }
    const selectedTags = (tagsResult.data ?? []).flatMap((item) => {
      const related = item.tags as unknown as { name?: string } | Array<{ name?: string }> | null;
      return Array.isArray(related) ? related.map((tag) => tag.name).filter(Boolean) : related?.name ? [related.name] : [];
    }) as string[];
    const primaryTags = (tagsResult.data ?? []).filter((item) => item.is_primary).flatMap((item) => {
      const related = item.tags as unknown as { name?: string } | Array<{ name?: string }> | null;
      return Array.isArray(related) ? related.map((tag) => tag.name).filter(Boolean) : related?.name ? [related.name] : [];
    }) as string[];
    setProfile((current) => ({
      ...current,
      displayName: row.display_name,
      handle: row.handle ?? current.handle,
      bio: row.bio ?? "",
      gender: (["woman", "man", "nonbinary", "unspecified"] as const).includes(row.gender) ? row.gender : "unspecified",
      avatarDataUrl: avatarUrl || current.avatarDataUrl,
      activityArea: row.activity_area ?? "",
      weekend: row.weekend ?? "",
      romance: row.romance_view ?? "",
      contactFrequency: row.contact_frequency ?? "",
      values: row.values_detail ?? "",
      lifestyle: row.lifestyle ?? "",
      work: row.work_detail ?? "",
      moneyStyle: row.money_style ?? "",
      marriageView: row.marriage_view ?? "",
      extraBio: row.extra_bio ?? "",
      tags: selectedTags,
      primaryTags,
    }));
    const areaContributions = Object.fromEntries((contributionsResult.data ?? []).map((item) => [item.area_id, Number(item.points)]));
    const spotClaims: Record<string, string> = {};
    for (const item of drawsResult.data ?? []) if (!spotClaims[item.spot_id]) spotClaims[item.spot_id] = item.draw_date;
    setGrowth({
      totalEarnedExp: Number(row.total_earned_exp ?? 0),
      availableExp: Number(row.available_exp ?? 0),
      lastDailyLoginDate: loginResult.data?.claim_date ?? null,
      areaContributions,
      ownedCosmetics: (cosmeticsResult.data ?? []).map((item) => item.cosmetic_id),
      equippedFrame: row.equipped_frame,
      equippedBackground: row.equipped_background,
      equippedTitle: row.equipped_title,
      spotClaims,
    });
  }, []);

  const refreshLiveCommunity = useCallback(async (userId: string) => {
    if (!supabase) return;
    setLiveLoading(true);
    setLiveError("");
    let matchResult = await supabase.from("matches").select("id,user_a,user_b,created_at").is("ended_at", null).order("created_at", { ascending: false });
    if (matchResult.error?.message.includes("ended_at")) matchResult = await supabase.from("matches").select("id,user_a,user_b,created_at").order("created_at", { ascending: false });
    const [{ data: crossingRows, error: crossingError }, { data: likeRows }] = await Promise.all([
      supabase.from("crossings").select("id,user_a,user_b,area_label,crossed_at").gt("expires_at", new Date().toISOString()).order("crossed_at", { ascending: false }),
      supabase.from("likes").select("sender_id,crossing_id").eq("sender_id", userId),
    ]);
    const { data: matchRows, error: matchError } = matchResult;
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
    const profileByUser = new globalThis.Map<string, { display_name: string; handle: string | null; bio: string; avatar_url: string | null; is_official: boolean; profile_tags?: string[]; primary_tags?: string[]; common_tag_count?: number; activity_status?: "recent" | "away" | "inactive"; profile_level?: number; activity_area?: string }>();

    if (otherIds.length > 0) {
      let { data: profileRows, error: profileError } = await supabase.rpc("get_visible_member_profiles_v2", { p_user_ids: otherIds });
      if (profileError?.message.includes("get_visible_member_profiles_v2")) {
        const legacy = await supabase.rpc("get_visible_member_profiles", { p_user_ids: otherIds });
        profileRows = legacy.data;
        profileError = legacy.error;
      }
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
      const signedPhotoUrls = await getSignedProfilePhotoUrls(otherIds);
      for (const item of profileRows ?? []) profileByUser.set(item.user_id, { ...item, avatar_url: signedPhotoUrls[item.user_id] ?? null });
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
        activityStatus: other?.activity_status ?? "inactive",
        unreadCount: 0,
        tags: other?.profile_tags ?? [],
        primaryTags: other?.primary_tags ?? [],
        commonTagCount: Number(other?.common_tag_count ?? 0),
        profileLevel: Number(other?.profile_level ?? 1),
        activityArea: other?.activity_area ?? "",
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
        avatarUrl: other?.avatar_url ?? null,
        areaLabel: crossing.area_label,
        crossedAt: crossing.crossed_at,
        tagged: taggedCrossings.has(crossing.id),
        isOfficial: other?.is_official ?? false,
        tags: other?.profile_tags ?? [],
        primaryTags: other?.primary_tags ?? [],
        commonTagCount: Number(other?.common_tag_count ?? 0),
        activityStatus: other?.activity_status ?? "inactive",
      } satisfies LiveCrossing;
    }));
    setLiveMatches(nextMatches);
    setSelectedLiveMatchId((current) => current && matchIds.includes(current) ? current : matchIds[0] ?? null);

    if (matchIds.length > 0) {
      const messageBatches = await Promise.all(matchIds.map(async (matchId) => {
        let result = await supabase!.from("messages").select("id,match_id,sender_id,body,created_at,read_at").eq("match_id", matchId).order("created_at", { ascending: false }).limit(50);
        if (result.error?.message.includes("read_at")) {
          const fallback = await supabase!.from("messages").select("id,match_id,sender_id,body,created_at").eq("match_id", matchId).order("created_at", { ascending: false }).limit(50);
          result = fallback as typeof result;
        }
        return result;
      }));
      const messageError = messageBatches.find((batch) => batch.error)?.error;
      const messageRows = messageBatches.flatMap((batch) => batch.data ?? []).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      if (messageError) setLiveError(messageError.message);
      else {
        const messageIds = (messageRows ?? []).map((item) => item.id);
        const reactionResult = messageIds.length > 0
          ? await supabase.from("message_reactions").select("message_id,user_id,reaction").in("message_id", messageIds)
          : { data: [], error: null };
        const grouped: Record<string, LiveMessage[]> = {};
        for (const item of messageRows ?? []) {
          const reactions = (reactionResult.data ?? []).filter((reaction) => reaction.message_id === item.id).map((reaction) => ({ userId: reaction.user_id, reaction: reaction.reaction as "heart" | "like" | "laugh" | "wow" }));
          const message: LiveMessage = { id: item.id, matchId: item.match_id, senderId: item.sender_id, body: item.body, createdAt: item.created_at, readAt: "read_at" in item ? item.read_at as string | null : null, reactions };
          grouped[message.matchId] = [...(grouped[message.matchId] ?? []), message];
        }
        setLiveMessages(grouped);
        setLiveMatches((current) => current.map((match) => ({ ...match, unreadCount: (grouped[match.id] ?? []).filter((message) => message.senderId !== userId && !message.readAt).length })));
      }
    } else setLiveMessages({});

    let discoveryResult = await supabase.rpc("get_discovery_profiles_v2", { p_limit: 24 });
    if (discoveryResult.error?.message.includes("get_discovery_profiles_v2")) discoveryResult = await supabase.rpc("get_discovery_profiles", { p_limit: 24 });
    const [{ data: discoveryRows, error: discoveryError }, { data: recentEndedRows }] = await Promise.all([
      Promise.resolve(discoveryResult),
      supabase.from("matches").select("user_a,user_b").not("ended_at", "is", null).gt("ended_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ]);
    if (discoveryError) {
      setDiscoveryProfiles([]);
      setLiveError((current) => current || (discoveryError.message.includes("get_discovery_profiles") ? "おすすめ機能のDB設定が必要です" : discoveryError.message));
    } else {
      const cooldownUsers = new Set((recentEndedRows ?? []).map((match) => match.user_a === userId ? match.user_b : match.user_a));
      const discoveryItems = ((discoveryRows ?? []) as Array<{ user_id: string; display_name: string; handle: string | null; bio: string | null; avatar_url: string | null; is_official: boolean; liked: boolean; profile_tags?: string[]; primary_tags?: string[]; common_tag_count?: number; activity_status?: "recent" | "away" | "inactive"; relevance_score?: number }>).filter((item) => !cooldownUsers.has(item.user_id));
      const signedPhotoUrls = await getSignedProfilePhotoUrls(discoveryItems.map((item) => item.user_id));
      setDiscoveryProfiles(discoveryItems.map((item) => ({
        userId: item.user_id,
        displayName: item.display_name,
        handle: item.handle,
        bio: item.bio ?? "",
        avatarUrl: signedPhotoUrls[item.user_id] ?? null,
        isOfficial: item.is_official,
        liked: item.liked,
        tags: item.profile_tags ?? [],
        primaryTags: item.primary_tags ?? [],
        commonTagCount: Number(item.common_tag_count ?? 0),
        activityStatus: item.activity_status ?? "inactive",
        relevanceScore: Number(item.relevance_score ?? 0),
      })));
    }
    const { data: statRows } = await supabase.rpc("get_today_home_stats");
    const stats = Array.isArray(statRows) ? statRows[0] : statRows;
    if (stats) setTodayStats({ crosses: Number(stats.cross_count ?? 0), receivedTags: Number(stats.received_tag_count ?? 0), newMatches: Number(stats.new_match_count ?? 0) });
    setLiveLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${ASSET_PREFIX}/sw.js`).catch(() => undefined);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const betaTimer = window.setTimeout(() => void refreshBetaStatus(), 0);
    void supabase.rpc("get_tag_catalog", { p_query: "", p_category: null, p_limit: 500 }).then(async ({ data, error }) => {
      if (!active) return;
      let rows = (data ?? []) as Array<{ tag_id: number; name: string; category: string; aliases: string[]; popularity: number; recent_uses: number }>;
      if (error) {
        const fallback = await supabase!.from("tags").select("id,name").order("name", { ascending: true });
        rows = (fallback.data ?? []).map((tag) => ({ tag_id: tag.id, name: tag.name, category: "その他", aliases: [], popularity: 0, recent_uses: 0 }));
      }
      setTagCatalog(rows.map((row) => ({ id: row.tag_id, name: row.name, category: row.category, aliases: row.aliases ?? [], popularity: Number(row.popularity), recentUses: Number(row.recent_uses) })));
    });
    return () => { active = false; window.clearTimeout(betaTimer); };
  }, [refreshBetaStatus]);

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
    const timeout = window.setTimeout(() => {
      if (saved) {
        try {
          const restored = JSON.parse(saved) as EditableProfile;
          setProfile({ ...INITIAL_PROFILE, ...restored });
        } catch { /* Ignore invalid local state. */ }
      }
      setProfileLoaded(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (profileLoaded) window.localStorage.setItem("tagtokyo_profile_v2", JSON.stringify(profile));
  }, [profile, profileLoaded]);

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
      let { data } = await connectedClient.from("users").select("id,role,status,birth_date,age_verified,age_verification_status,terms_accepted_at,privacy_accepted_at").eq("auth_user_id", user.id).maybeSingle();
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
          const refreshed = await connectedClient.from("users").select("id,role,status,birth_date,age_verified,age_verification_status,terms_accepted_at,privacy_accepted_at").eq("auth_user_id", user.id).maybeSingle();
          data = refreshed.data;
        }
      }
      if (data?.id && active) await loadPersistentAccountState(data.id);
      const { data: welcomeRows } = await connectedClient.rpc("get_official_welcome_profile");
      const welcome = Array.isArray(welcomeRows) ? welcomeRows[0] : null;
      if (active) {
        setIsOwner(data?.role === "owner");
        setIsEmailAuthenticated(Boolean(user.email));
        setEmail(user.email ?? "");
        setBirthDate(data?.birth_date ?? "");
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
        void refreshBetaStatus();
        const returnUrl = new URL(window.location.href);
        if (returnUrl.searchParams.get("onboarding") === "1" && !data?.terms_accepted_at) {
          returnUrl.searchParams.delete("onboarding");
          window.history.replaceState({}, "", `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
          setTab("me");
          setAuthNotice("メール認証が完了しました。生年月日と規約への同意を確認して「同意して登録を完了」を押してください。");
          track("email_auth_complete");
        }
      }
    }
    void syncOwnerRole();
    const { data: { subscription } } = connectedClient.auth.onAuthStateChange(() => void syncOwnerRole());
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadPersistentAccountState, refreshBetaStatus]);

  useEffect(() => {
    if (!liveEnabled || !liveMemberReady || !currentUserId || !supabase) return;
    let active = true;
    async function claimServerDailyBonus() {
      const { data, error } = await supabase!.rpc("claim_daily_login_bonus");
      if (!active || error) return;
      const awarded = Number(data ?? 0);
      await loadPersistentAccountState(currentUserId!);
      if (active && awarded > 0) {
        setDailyBonusNotice(`毎日ログイン +${awarded} EXP`);
        track("tagtokyo_daily_login_bonus", { exp: awarded, backend: true });
      }
    }
    void claimServerDailyBonus();
    return () => { active = false; };
  }, [currentUserId, liveEnabled, liveMemberReady, loadPersistentAccountState]);

  useEffect(() => {
    if (!liveEnabled || !liveMemberReady || !supabase) return;
    let active = true;
    void supabase.rpc("get_today_movement").then(({ data, error }) => {
      if (!active || error) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return;
      setSession((current) => ({
        ...current,
        dailyDistanceMeters: Number(row.distance_m ?? 0),
        dailyWalkExp: Number(row.walk_exp ?? 0),
        dailyWalkExpCap: Number(row.daily_cap ?? 100),
      }));
      dailyCapTrackedRef.current = Number(row.walk_exp ?? 0) >= Number(row.daily_cap ?? 100);
    });
    return () => { active = false; };
  }, [liveEnabled, liveMemberReady]);

  useEffect(() => {
    if (!liveEnabled || !liveMemberReady || !supabase) return;
    void supabase.rpc("touch_member_activity");
    const timer = window.setInterval(() => void supabase?.rpc("touch_member_activity"), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [liveEnabled, liveMemberReady]);

  useEffect(() => {
    if (!liveEnabled || !liveMemberReady) return;
    const timer = window.setTimeout(() => void refreshDailyMissions(), 0);
    return () => window.clearTimeout(timer);
  }, [liveEnabled, liveMemberReady, refreshDailyMissions]);

  useEffect(() => {
    if (!liveEnabled || !liveMemberReady) return;
    const timer = window.setTimeout(() => void refreshTagStreak(), 0);
    return () => window.clearTimeout(timer);
  }, [liveEnabled, liveMemberReady, refreshTagStreak]);

  useEffect(() => {
    if (!liveEnabled || !liveMemberReady || !currentUserId || !supabase) return;
    const refreshTimer = window.setTimeout(() => void refreshLiveCommunity(currentUserId), 0);
    const client = supabase;
    const channel = client.channel(`messages-${currentUserId}`).on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const item = payload.new as { id: number; match_id: string; sender_id: string; body: string; created_at: string; read_at: string | null };
        const message: LiveMessage = { id: item.id, matchId: item.match_id, senderId: item.sender_id, body: item.body, createdAt: item.created_at, readAt: item.read_at, reactions: [] };
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
  }, [currentUserId, liveEnabled, liveMemberReady, refreshLiveCommunity]);

  useEffect(() => {
    if (!session.active || !session.expiresAt) return;
    const timeout = window.setTimeout(() => void finishTagSession("expired"), Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
    // The timer is intentionally recreated only when the active expiry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.active, session.expiresAt]);

  async function recordMovement(serverSessionId: string, location: Awaited<ReturnType<typeof requestPrivateLocation>>) {
    if (!supabase || locationRequestPendingRef.current) return;
    locationRequestPendingRef.current = true;
    try {
      const { data, error } = await supabase.rpc("update_tag_location", {
        p_session_id: serverSessionId,
        p_latitude: location.latitude,
        p_longitude: location.longitude,
        p_accuracy_m: location.accuracy,
        p_captured_at: location.capturedAt,
        p_delete_at: location.deleteAt,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return;
      const awarded = Number(row.awarded_exp ?? 0);
      const sessionDistance = Number(row.session_distance_m ?? 0);
      const status = String(row.sample_status ?? "accepted");
      setSession((current) => ({
        ...current,
        validDistanceMeters: sessionDistance,
        walkExpEarned: Number(row.session_walk_exp ?? current.walkExpEarned),
        dailyDistanceMeters: Number(row.daily_distance_m ?? current.dailyDistanceMeters),
        dailyWalkExp: Number(row.daily_walk_exp ?? current.dailyWalkExp),
        dailyWalkExpCap: Number(row.daily_cap ?? 100),
        movementStatus: status,
      }));
      if (awarded > 0) {
        setGrowth((current) => ({ ...current, totalEarnedExp: current.totalEarnedExp + awarded, availableExp: current.availableExp + awarded }));
        setWalkPulse(`+${awarded} EXP`);
        window.setTimeout(() => setWalkPulse(""), 1800);
        track("walk_exp_earned", { exp: awarded, distance_m: sessionDistance });
      }
      const milestone = Math.floor(sessionDistance / 500) * 500;
      if (milestone > lastMilestoneRef.current) {
        lastMilestoneRef.current = milestone;
        setWalkPulse(milestone % 1000 === 0 ? `${milestone / 1000}km 達成` : `${milestone}m 達成`);
        window.setTimeout(() => setWalkPulse(""), 2200);
      }
      if (!dailyCapTrackedRef.current && Number(row.daily_walk_exp ?? 0) >= Number(row.daily_cap ?? 100)) {
        dailyCapTrackedRef.current = true;
        track("walk_daily_cap_reached");
      }
      if (!walkMissionClaimedRef.current && Number(row.daily_distance_m ?? 0) >= 1000) {
        walkMissionClaimedRef.current = true;
        void claimDailyMission("walk_1km");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "移動記録を送信できませんでした";
      if (message.includes("expired") || message.includes("not active")) void finishTagSession("expired");
    } finally {
      locationRequestPendingRef.current = false;
    }
  }

  useEffect(() => {
    if (!liveEnabled || !liveMemberReady || !supabase || session.active) return;
    let active = true;
    void supabase.rpc("get_active_tag_session").then(({ data, error }) => {
      if (!active || error) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return;
      const duration = [30, 60, 180].includes(Number(row.duration_minutes)) ? Number(row.duration_minutes) as TagDuration : 60;
      setSession((current) => ({ ...current, active: true, duration, startedAt: new Date(row.started_at).getTime(), expiresAt: new Date(row.expires_at).getTime(), areaLabel: "東京都内", serverSessionId: row.session_id, validDistanceMeters: Number(row.valid_distance_m ?? 0), walkExpEarned: Number(row.walk_exp_earned ?? 0), movementStatus: "restored" }));
      stopLocationWatchRef.current?.();
      stopLocationWatchRef.current = watchPrivateLocation((sample) => void recordMovement(row.session_id, sample), (message) => setNotice(message));
      setNotice("進行中のTAG ONを復元しました");
    });
    return () => { active = false; };
    // Restoring runs only when membership becomes ready; movement writes use the current handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEnabled, liveMemberReady]);

  function requestTagStart() {
    track("tag_on_tapped", { duration_minutes: session.duration });
    if (window.localStorage.getItem("tagtokyo_tag_intro_v04") === "done") void startTag();
    else setShowTagIntro(true);
  }

  async function startTag() {
    setShowTagIntro(false);
    window.localStorage.setItem("tagtokyo_tag_intro_v04", "done");
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
      track("tag_location_permission_granted");
      if (!isInsideTokyo(location)) throw new Error("TAG ONは東京都内でのみ利用できます");
      const startedAt = Date.now();
      const expiresAt = startedAt + session.duration * 60 * 1000;
      setNow(startedAt);
      let serverSessionId: string | null = null;
      if (supabase) {
        const { data, error } = await supabase.rpc("start_tag_session", {
          p_latitude: location.latitude,
          p_longitude: location.longitude,
          p_accuracy_m: location.accuracy,
          p_duration_minutes: session.duration,
          p_delete_at: location.deleteAt,
        });
        if (error) throw error;
        serverSessionId = String(data);
      }
      lastMilestoneRef.current = 0;
      setSession((current) => ({ ...current, active: true, startedAt, expiresAt, areaLabel: "東京都内", serverSessionId, validDistanceMeters: 0, walkExpEarned: 0, movementStatus: "starting" }));
      stopLocationWatchRef.current?.();
      if (serverSessionId) stopLocationWatchRef.current = watchPrivateLocation(
        (sample) => void recordMovement(serverSessionId!, sample),
        (message) => setNotice(message),
      );
      setNotice("TAG ONを開始しました");
      setShowConnected(true);
      window.setTimeout(() => setShowConnected(false), 1500);
      track("tag_on_started", { tag_duration: session.duration });
      track("tag_on", { tag_duration: session.duration });
      void claimDailyMission("tag_on");
      void refreshTagStreak();
      track("tagtokyo_tag_session_started", { duration_minutes: session.duration, backend: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "TAG ONを開始できませんでした");
    }
  }

  async function finishTagSession(reason: "manual" | "expired") {
    stopLocationWatchRef.current?.();
    stopLocationWatchRef.current = null;
    let result: TagSessionResult = {
      durationSeconds: session.startedAt ? Math.max(0, Math.round((Date.now() - session.startedAt) / 1000)) : 0,
      distanceMeters: session.validDistanceMeters,
      walkExp: session.walkExpEarned,
      crossCount: 0,
      spotCount: 0,
      areas: [],
    };
    if (supabase && session.serverSessionId) {
      const { data, error } = await supabase.rpc("finish_tag_session");
      const row = Array.isArray(data) ? data[0] : data;
      if (!error && row) result = {
        durationSeconds: Number(row.duration_seconds ?? result.durationSeconds),
        distanceMeters: Number(row.distance_m ?? result.distanceMeters),
        walkExp: Number(row.walk_exp ?? result.walkExp),
        crossCount: Number(row.cross_count ?? 0),
        spotCount: Number(row.spot_count ?? 0),
        areas: Array.isArray(row.areas) ? row.areas : [],
      };
    }
    setSession((current) => ({ ...current, active: false, startedAt: null, expiresAt: null, serverSessionId: null, movementStatus: null }));
    setSessionResult(result);
    setNotice(reason === "expired" ? "TAG ONが自動終了しました" : "TAG ONを終了しました");
    track("tag_on_finished", { reason, tag_duration: result.durationSeconds, valid_distance: result.distanceMeters, earned_exp: result.walkExp, cross_count: result.crossCount });
    track("tag_on_complete", { reason, duration_seconds: result.durationSeconds, earned_exp: result.walkExp, cross_count: result.crossCount });
    track("tagtokyo_tag_session_ended", { reason });
  }

  async function stopTag() { await finishTagSession("manual"); }

  async function sendMagicLink(termsAccepted: boolean, privacyAccepted: boolean) {
    if (!hasSupabase || !supabase) {
      setAuthNotice("認証サーバーへ接続できません");
      return;
    }
    if (!isEmailAuthenticated && !email.includes("@")) {
      setAuthNotice("メールアドレスを入力してください");
      return;
    }
    if (!isAdultBirthDate(birthDate)) {
      setAuthNotice("20歳以上の生年月日を入力してください");
      return;
    }
    if (!termsAccepted || !privacyAccepted) {
      setAuthNotice("利用規約とプライバシーポリシーへの同意が必要です");
      return;
    }
    window.sessionStorage.setItem("tagtokyo_pending_message_consent_v1", JSON.stringify({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION }));
    if (isEmailAuthenticated) {
      const { error: birthDateError } = await supabase.rpc("set_my_birth_date", { p_birth_date: birthDate });
      if (birthDateError) return setAuthNotice(birthDateError.message.includes("set_my_birth_date") ? "生年月日保存用のDB更新が必要です" : birthDateError.message);
      const { error } = await supabase.rpc("complete_profile_onboarding", {
        p_display_name: profile.displayName,
        p_handle: profile.handle,
        p_gender: profile.gender,
        p_terms_version: TERMS_VERSION,
        p_privacy_version: PRIVACY_VERSION,
      });
      if (error) return setAuthNotice(error.message);
      window.sessionStorage.removeItem("tagtokyo_pending_message_consent_v1");
      setConsentReady(true);
      setAuthNotice("アカウント登録が完了しました");
      track("profile_complete");
      void refreshBetaStatus();
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    const redirectUrl = new URL(window.location.href);
    redirectUrl.searchParams.set("onboarding", "1");
    track("registration_start");
    const { error } = await supabase.auth.signInWithOtp({ email: normalizedEmail, options: { emailRedirectTo: redirectUrl.toString(), data: { birth_date: birthDate } } });
    setAuthNotice(error ? error.message : "認証メールを送りました。メール内のリンクを開いて登録を完了してください");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setIsEmailAuthenticated(false);
    setCurrentUserId(null);
    setLiveMemberReady(false);
    setConsentReady(false);
    setAgeVerificationStatus("not_started");
    setEmail("");
    setBirthDate("");
    setAuthNotice("ログアウトしました");
  }

  async function requestAccountDeletion() {
    if (!supabase || !isEmailAuthenticated) return;
    if (!window.confirm("退会とアカウントデータの削除を申請します。よろしいですか？")) return;
    const { error } = await supabase.rpc("request_account_deletion");
    setAuthNotice(error ? error.message : "退会・データ削除の申請を受け付けました");
  }

  async function requestMessageAccess(nextEmail: string, gender: EditableProfile["gender"], nextBirthDate: string) {
    setEmail(nextEmail);
    setBirthDate(nextBirthDate);
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
    const redirectUrl = new URL(window.location.href);
    redirectUrl.searchParams.set("onboarding", "1");
    const { error } = await supabase.auth.signInWithOtp({ email: nextEmail, options: { emailRedirectTo: redirectUrl.toString(), data: { birth_date: nextBirthDate } } });
    setAuthNotice(error ? error.message : "ログインリンクをメールへ送りました。認証後にメッセージを開けます。");
    setTab("me");
  }

  async function sendLiveMessage(matchId: string, body: string) {
    if (!supabase || !currentUserId) return false;
    const existingThread = liveMessages[matchId] ?? [];
    setLiveError("");
    const { data, error } = await supabase.rpc("send_match_message", { p_match_id: matchId, p_body: body });
    if (error) {
      setLiveError(error.message);
      return false;
    }
    const item = Array.isArray(data) ? data[0] : data;
    if (item) {
      const message: LiveMessage = { id: item.id, matchId: item.match_id, senderId: item.sender_id, body: item.body, createdAt: item.created_at, readAt: item.read_at ?? null, reactions: [] };
      setLiveMessages((current) => {
        const thread = current[matchId] ?? [];
        return thread.some((existing) => existing.id === message.id) ? current : { ...current, [matchId]: [...thread, message] };
      });
    }
    track("tagtokyo_message_sent", { match_id: matchId });
    if (!existingThread.some((message) => message.senderId === currentUserId)) track("first_message_sent", { match_id: matchId });
    else if (existingThread.some((message) => message.senderId !== currentUserId)) track("message_reply", { match_id: matchId });
    return true;
  }

  async function loadOlderMessages(matchId: string, before: string) {
    if (!supabase) return;
    const { data, error } = await supabase.from("messages").select("id,match_id,sender_id,body,created_at,read_at").eq("match_id", matchId).lt("created_at", before).order("created_at", { ascending: false }).limit(50);
    if (error) return setLiveError(error.message);
    const rows = [...(data ?? [])].reverse();
    const messageIds = rows.map((item) => item.id);
    const { data: reactionRows } = messageIds.length > 0 ? await supabase.from("message_reactions").select("message_id,user_id,reaction").in("message_id", messageIds) : { data: [] };
    const older = rows.map((item) => ({
      id: item.id,
      matchId: item.match_id,
      senderId: item.sender_id,
      body: item.body,
      createdAt: item.created_at,
      readAt: item.read_at,
      reactions: (reactionRows ?? []).filter((reaction) => reaction.message_id === item.id).map((reaction) => ({ userId: reaction.user_id, reaction: reaction.reaction as "heart" | "like" | "laugh" | "wow" })),
    } satisfies LiveMessage));
    setLiveMessages((current) => ({ ...current, [matchId]: [...older, ...(current[matchId] ?? [])] }));
  }

  async function selectLiveMatch(matchId: string) {
    setSelectedLiveMatchId(matchId);
    track("chat_open", { match_id: matchId });
    if (!supabase) return;
    const { error } = await supabase.rpc("mark_match_read", { p_match_id: matchId });
    if (error) return;
    setLiveMessages((current) => ({ ...current, [matchId]: (current[matchId] ?? []).map((message) => message.senderId === currentUserId ? message : { ...message, readAt: message.readAt ?? new Date().toISOString() }) }));
    setLiveMatches((current) => current.map((match) => match.id === matchId ? { ...match, unreadCount: 0 } : match));
  }

  async function reactToLiveMessage(messageId: number, reaction: "heart" | "like" | "laugh" | "wow") {
    if (!supabase || !currentUserId) return;
    const { error } = await supabase.rpc("react_to_message", { p_message_id: messageId, p_reaction: reaction });
    if (error) return setLiveError(error.message);
    setLiveMessages((current) => Object.fromEntries(Object.entries(current).map(([matchId, thread]) => [matchId, thread.map((message) => message.id === messageId ? { ...message, reactions: [...message.reactions.filter((item) => item.userId !== currentUserId), { userId: currentUserId, reaction }] } : message)])));
  }

  async function unmatchLiveMember(matchId: string) {
    if (!supabase) return;
    const { error } = await supabase.rpc("unmatch_member", { p_match_id: matchId });
    if (error) return setLiveError(error.message);
    setLiveMatches((current) => current.filter((match) => match.id !== matchId));
    setSelectedLiveMatchId(null);
    setLiveError("マッチを解除しました");
  }

  async function sendLiveTag(crossing: LiveCrossing) {
    if (!supabase || !currentUserId) return;
    setLiveError("");
    const { data: matched, error } = await supabase.rpc("send_crossing_tag", { p_crossing_id: crossing.id });
    if (error) return setLiveError(error.message);
    setLiveCrossings((current) => current.map((item) => item.id === crossing.id ? { ...item, tagged: true } : item));
    setNotice(matched ? `${crossing.displayName}さんとMATCHしました` : `${crossing.displayName}さんへTAGを送りました`);
    track("tag_sent", { crossing_id: crossing.id });
    if (matched) track("match_created", { source: "cross" });
    track("tagtokyo_live_tag_sent", { crossing_id: crossing.id, matched: Boolean(matched) });
    if (matched) {
      await refreshLiveCommunity(currentUserId);
      setMatchCelebration({ matchId: null, userId: crossing.otherUserId, displayName: crossing.displayName, commonTags: crossing.tags.filter((tag) => profile.tags.includes(tag)) });
    }
  }

  async function sendProfileLike(target: DiscoveryProfile) {
    if (!supabase || !currentUserId || target.liked) return;
    setLiveError("");
    const { data: matched, error } = await supabase.rpc("send_profile_like", { p_receiver: target.userId });
    if (error) {
      setLiveError(error.message === "daily like limit reached" ? "本日のいいね上限に達しました" : error.message);
      return;
    }
    setDiscoveryProfiles((current) => current.map((item) => item.userId === target.userId ? { ...item, liked: true } : item));
    track("tag_sent", { source: "discover" });
    track("like_sent", { source: "discover" });
    track("tagtokyo_profile_like_sent", { matched: Boolean(matched) });
    if (matched) {
      track("match_created", { source: "discover" });
      setNotice(`${target.displayName}さんとMATCHしました`);
      await refreshLiveCommunity(currentUserId);
      setMatchCelebration({ matchId: null, userId: target.userId, displayName: target.displayName, commonTags: target.tags.filter((tag) => profile.tags.includes(tag)) });
    } else {
      setNotice(`${target.displayName}さんへいいねを送りました`);
    }
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
    if (!item || (!isOwner && item.campaignOnly) || (!isOwner && growth.availableExp < item.cost) || growth.ownedCosmetics.includes(id)) return;
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

  async function equipCosmetic(id: string) {
    const item = COSMETICS.find((candidate) => candidate.id === id);
    if (!item || (!isOwner && !growth.ownedCosmetics.includes(id))) return;
    if (supabase && isEmailAuthenticated) {
      const { error } = await supabase.rpc("equip_profile_cosmetic", { p_cosmetic_id: id });
      if (error) {
        setAuthNotice(error.message.includes("equip_profile_cosmetic") ? "装飾のクラウド保存設定が必要です" : error.message);
        return;
      }
    }
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
      <div className="top-brand"><span className="brand-mark"><Sparkles /></span><b>TAG TOKYO</b><small>BETA</small></div>
      {tab === "home" && <HomeScreen session={session} now={now} start={requestTagStart} stop={stopTag} extend={() => void startTag()} notice={notice} growth={growth} dailyBonusNotice={dailyBonusNotice} showGuide={showHomeGuide} dismissGuide={() => { window.localStorage.setItem("tagtokyo_home_guide_v04", "done"); setShowHomeGuide(false); }} missions={dailyMissions} streak={tagStreak} todayStats={todayStats} betaStatus={betaStatus} authenticated={isEmailAuthenticated} liveEnabled={liveEnabled} activateBoost={() => void activateBetaBoost()} />}
      {tab === "cross" && <LiveCrossScreen crossings={liveEnabled && liveMemberReady ? liveCrossings : []} recommendations={liveEnabled && liveMemberReady ? discoveryProfiles : []} officialProfile={officialProfile} memberReady={liveMemberReady} liveEnabled={liveEnabled} onTag={sendLiveTag} onLike={sendProfileLike} onRequireAccount={() => setTab("me")} error={liveError} showGuide={showCrossGuide} onDismissGuide={() => { window.localStorage.setItem("tagtokyo_cross_guide_v04", "done"); setShowCrossGuide(false); }} />}
      {tab === "map" && <MapScreen growth={growth} setGrowth={setGrowth} liveEnabled={liveEnabled} onInventoryChanged={() => void refreshBetaStatus()} />}
      {tab === "match" && (liveEnabled
        ? <LiveMatchScreen matches={liveMatches} messages={liveMessages} currentUserId={currentUserId} selectedMatchId={selectedLiveMatchId} loading={liveLoading} error={liveError} memberReady={liveMemberReady} messageAccessReady={isEmailAuthenticated} onSelect={(matchId) => void selectLiveMatch(matchId)} onSend={sendLiveMessage} onReact={reactToLiveMessage} onLoadOlder={loadOlderMessages} onUnmatch={unmatchLiveMember} onBlock={blockLiveMatch} onReport={reportLiveMatch} onRequireEmail={() => setShowMessageGate(true)} />
        : <MatchScreen />)}
      {tab === "me" && <MeScreen email={email} setEmail={setEmail} birthDate={birthDate} setBirthDate={setBirthDate} authNotice={authNotice} sendMagicLink={sendMagicLink} signOut={() => void signOut()} requestAccountDeletion={() => void requestAccountDeletion()} growth={growth} buyCosmetic={buyCosmetic} equipCosmetic={equipCosmetic} profile={profile} setProfile={setProfile} tagCatalog={tagCatalog} isOwner={isOwner} liveEnabled={liveEnabled} emailAuthenticated={isEmailAuthenticated} consentReady={consentReady} ageVerificationStatus={ageVerificationStatus} />}
      <BottomNav tab={tab} onChange={(next) => {
        setTab(next);
        window.scrollTo({ top: 0, behavior: "instant" });
        track("tagtokyo_tab_view", { tab: next });
        if (next === "cross") { track("tagtokyo_cross_view"); track("cross_opened"); void claimDailyMission("cross_opened"); }
        if (next === "map") track("map_opened");
      }} />
      {showMessageGate && <MessageAccessGate onClose={() => setShowMessageGate(false)} onEmail={requestMessageAccess} />}
      {showTagIntro && <TagIntro onClose={() => setShowTagIntro(false)} onStart={() => void startTag()} />}
      {showConnected && <div className="connected-overlay" role="status"><Sparkles /><b>TOKYO CONNECTED</b><small>移動EXPの計測を開始しました</small></div>}
      {walkPulse && <div className="walk-exp-pulse" role="status"><Footprints />{walkPulse}</div>}
      {levelUp && <div className="level-up-overlay" role="status"><small>PROFILE LEVEL UP</small><b>Lv.{levelUp}</b><Sparkles /></div>}
      {sessionResult && <SessionResult result={sessionResult} onClose={() => setSessionResult(null)} onCross={() => { setSessionResult(null); setTab("cross"); track("cross_opened", { source: "tag_result" }); }} />}
      {matchCelebration && <MatchCelebration displayName={matchCelebration.displayName} commonTags={matchCelebration.commonTags} onClose={() => setMatchCelebration(null)} onMessage={() => { const matchId = liveMatches.find((match) => match.otherUserId === matchCelebration.userId)?.id ?? matchCelebration.matchId; if (matchId) setSelectedLiveMatchId(matchId); setMatchCelebration(null); setTab("match"); }} />}
    </main>
  );
}
