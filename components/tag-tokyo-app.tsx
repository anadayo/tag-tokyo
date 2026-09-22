"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell, Camera, ChevronRight, Clock3, Crown, Gift, HeartHandshake, Home, LockKeyhole, LogOut, Map,
  MapPin, MessageCircle, Minus, OctagonAlert, Plus, Power, ShieldCheck, ShoppingBag,
  Sparkles, Star, Trophy, UserRound, UsersRound, Zap,
} from "lucide-react";
import { track } from "@/lib/analytics";
import { sampleCrossings } from "@/lib/demo-profiles";
import {
  COSMETICS, DAILY_LOGIN_EXP, drawSpotReward, getLevelProgress, INITIAL_GROWTH, INITIAL_PROFILE, PROFILE_UNLOCKS,
  TAG_SPOTS, TOKYO_AREAS,
} from "@/lib/game";
import { isInsideTokyo, requestPrivateLocation } from "@/lib/location";
import { hasSupabase, isLiveCommunityEnabled, supabase } from "@/lib/supabase";
import type { CrossItem, EditableProfile, GrowthState, TabId, TagDuration, TagSessionState } from "@/lib/types";

const INITIAL_SESSION: TagSessionState = {
  active: false,
  duration: 60,
  startedAt: null,
  expiresAt: null,
  areaLabel: null,
};
const MY_TAGS = ["音楽", "カフェ", "ゲーム", "散歩", "映画", "ラーメン"];
const ASSET_PREFIX = process.env.NODE_ENV === "production" ? "/tag-tokyo" : "";
const HANDLE_PATTERN = /^[A-Za-z0-9_]{5,15}$/;

function ProfilePhoto({ profile, className = "" }: { profile: EditableProfile; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- local preview data URL, not a network image.
  if (profile.avatarDataUrl) return <img className={`profile-photo ${className}`} src={profile.avatarDataUrl} alt="プロフィール写真のプレビュー" />;
  return <span className={className}>{profile.displayName.slice(0, 1).toUpperCase()}</span>;
}

function MessageAccessGate({ onClose, onEmail }: { onClose: () => void; onEmail: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [error, setError] = useState("");

  function submit() {
    if (!email.includes("@")) return setError("メールアドレスを入力してください");
    if (!termsAccepted || !privacyAccepted) return setError("利用規約とプライバシーポリシーへの同意が必要です");
    onEmail(email.trim().toLowerCase());
  }

  return <div className="message-gate-overlay" role="dialog" aria-modal="true" aria-labelledby="message-gate-title">
    <section className="access-card">
      <button className="message-gate-close" aria-label="閉じる" onClick={onClose}>×</button>
      <div className="access-brand"><span className="brand-mark"><Sparkles /></span><b>TAG TOKYO</b><small>MESSAGE</small></div>
      <div className="access-copy"><span>MESSAGE ACCESS</span><h1 id="message-gate-title">メッセージは、<br />メール認証のあと。</h1><p>すれ違い・MAP・プロフィール育成は登録なしで遊べます。メッセージを開く時だけ、メール認証と同意が必要です。</p></div>
      <label className="access-field"><span>メールアドレス</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
      <label className="access-check"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span><a href={`${ASSET_PREFIX}/terms/`} target="_blank" rel="noreferrer">利用規約</a>に同意する</span></label>
      <label className="access-check"><input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /><span><a href={`${ASSET_PREFIX}/privacy/`} target="_blank" rel="noreferrer">プライバシーポリシー</a>に同意する</span></label>
      {error && <p className="access-error" role="alert">{error}</p>}
      <button className="access-button" onClick={submit}>メール認証へ進む <ChevronRight /></button>
      <p className="access-note"><ShieldCheck /> 現在は安全な公開プレビューです。入力したメールアドレスは、認証接続が有効になるまで外部送信・保存しません。</p>
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

function Avatar({ profile, large = false }: { profile: CrossItem; large?: boolean }) {
  const column = profile.avatarIndex % 2;
  const row = Math.floor(profile.avatarIndex / 2);
  return (
    <div
      className={`avatar-sprite ${large ? "avatar-large" : ""}`}
      role="img"
      aria-label={`${profile.displayName}のサンプル写真`}
      style={{
        backgroundImage: `url('${ASSET_PREFIX}/profile-sprite-v1.png')`,
        backgroundSize: "200% 400%",
        backgroundPosition: `${column * 100}% ${(row / 3) * 100}%`,
      }}
    />
  );
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
  const [rewardDisplay, setRewardDisplay] = useState<null | { tier: "normal" | "rare" | "super"; label: string; demoOnly?: boolean }>(null);
  const area = TOKYO_AREAS.find((item) => item.id === selectedAreaId) ?? TOKYO_AREAS[0];
  const spot = TAG_SPOTS.find((item) => item.id === selectedSpotId) ?? null;
  const myPoints = growth.areaContributions[area.id] ?? 0;
  const isAreaChampion = myPoints > area.championPoints;
  const today = new Date().toISOString().slice(0, 10);
  const alreadyClaimed = spot ? growth.spotClaims[spot.id] === today : false;

  async function contribute() {
    if (growth.availableExp < stake) {
      setResult("所持EXPが足りません");
      return;
    }
    if (liveEnabled && supabase) {
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
    }
    const becomesChampion = myPoints <= area.championPoints && myPoints + stake > area.championPoints;
    setGrowth((current) => ({
      ...current,
      availableExp: current.availableExp - stake,
      areaContributions: { ...current.areaContributions, [area.id]: (current.areaContributions[area.id] ?? 0) + stake },
    }));
    setResult(becomesChampion ? `${area.name} AREAを塗り替えました。あなたが現在1位です。` : `${area.name}へ${stake} EXP投下しました。プロフィールLvは下がりません。`);
    track("tagtokyo_area_exp_contributed", { area_id: area.id, amount: stake });
  }

  function previewDraw() {
    if (!spot || alreadyClaimed) return;
    const reward = drawSpotReward();
    const rewardCosmeticId = `spot-${reward.rarity.toLowerCase()}`;
    const duplicateReward = reward.type === "cosmetic" && growth.ownedCosmetics.includes(rewardCosmeticId);
    const awardedExp = duplicateReward ? 100 : reward.exp;
    setGrowth((current) => ({
      ...current,
      totalEarnedExp: current.totalEarnedExp + awardedExp,
      availableExp: current.availableExp + awardedExp,
      ownedCosmetics: reward.type === "cosmetic" && !duplicateReward
        ? [...current.ownedCosmetics, rewardCosmeticId]
        : current.ownedCosmetics,
      spotClaims: { ...current.spotClaims, [spot.id]: today },
    }));
    const tier = reward.rarity === "RARE" ? "rare" : reward.rarity === "SR" || reward.rarity === "SSR" ? "super" : "normal";
    const label = duplicateReward
      ? "100 EXP獲得しました"
      : reward.type === "exp" ? `${reward.exp} EXP獲得しました` : `${reward.label}を獲得しました`;
    setRewardDisplay({ tier, label });
    setResult("");
    track("tagtokyo_spot_draw_preview", { spot_id: spot.id, reward: reward.rarity });
  }

  function previewReward(tier: "normal" | "rare" | "super") {
    const label = tier === "normal" ? "50 EXP獲得しました" : tier === "rare" ? "限定プロフィール装飾を獲得しました" : "SUPER BOOSTを獲得しました";
    setRewardDisplay({ tier, label, demoOnly: true });
  }

  return (
    <section className="screen map-screen">
      <header className="screen-header"><div><span>PLAY TOKYO</span><h2>MAP</h2></div><div className="wallet"><Zap />{growth.availableExp.toLocaleString()}</div></header>
      <div className="map-privacy"><ShieldCheck /><span><b>人の現在地は表示しません</b><small>MAPは遊ぶエリアとTAG SPOTを選ぶためのフィールドです</small></span></div>
      <div className="tokyo-map" aria-label="東京エリアマップ">
        <div className="map-river" />
        {TOKYO_AREAS.map((item) => {
          const mine = growth.areaContributions[item.id] ?? 0;
          const isMine = mine > item.championPoints;
          return <button key={item.id} className={`area-pin ${selectedAreaId === item.id ? "selected" : ""}`} style={{ left: `${item.x}%`, top: `${item.y}%` }} onClick={() => { setSelectedAreaId(item.id); setSelectedSpotId(null); setResult(""); }}>
            <Trophy /><b>{item.name}</b><span>{isMine ? "YOU" : item.champion}</span><small>{isMine ? mine : item.championPoints}pt</small>
          </button>;
        })}
        {TAG_SPOTS.map((item) => <button key={item.id} className="spot-pin" aria-label={item.name} style={{ left: `${item.x}%`, top: `${item.y}%` }} onClick={() => { setSelectedSpotId(item.id); setSelectedAreaId(item.areaId); setResult(""); }}><Gift /></button>)}
        <div className="map-legend"><span><Trophy />AREA 1位</span><span><Gift />TAG SPOT</span></div>
      </div>

      {spot ? (
        <div className="map-panel spot-panel">
          <div className="panel-title"><span className="panel-icon"><Gift /></span><div><small>FREE DRAW</small><h3>{spot.name}</h3></div></div>
          <p>正式版では現地にいることを非公開判定して、1日1回無料で抽選できます。完全なハズレはありません。</p>
          <div className="reward-line"><span>通常</span><b>30 / 50 / 100 EXP</b><span>レア</span><b>限定プロフィール装飾</b><span>激レア</span><b>BOOST / SUPER BOOST</b></div>
          <button className="primary-wide spot-draw" disabled={alreadyClaimed} onClick={previewDraw}>{alreadyClaimed ? "本日のプレビュー済み" : "抽選をプレビュー"}</button>
          {!hasSupabase && <div className="effect-preview"><small>演出確認</small><div><button onClick={() => previewReward("normal")}>通常</button><button onClick={() => previewReward("rare")}>レア</button><button onClick={() => previewReward("super")}>激レア</button></div><p>確認用のためEXP・景品は加算されません</p></div>}
        </div>
      ) : (
        <div className="map-panel">
          <div className="area-head"><div><small>AREA BATTLE</small><h3>{area.name}</h3></div><span className="demo-badge inline">DEMO RANKING</span></div>
          <div className="rank-row"><Trophy /><span><small>現在1位</small><b>{isAreaChampion ? `あなた · Lv.${getLevelProgress(growth.totalEarnedExp).level}` : `${area.champion} · Lv.${area.championLevel}`}</b></span><strong>{(isAreaChampion ? myPoints : area.championPoints).toLocaleString()}pt</strong></div>
          <div className="rank-row mine"><Star /><span><small>{isAreaChampion ? "次点 DEMO" : "あなた"}</small><b>{isAreaChampion ? `${area.champion} · Lv.${area.championLevel}` : `プロフィール Lv.${getLevelProgress(growth.totalEarnedExp).level}`}</b></span><strong>{(isAreaChampion ? area.championPoints : myPoints).toLocaleString()}pt</strong></div>
          <div className="area-range-note"><MapPin /><span><b>正式版は拠点の1km圏内限定</b><small>{liveEnabled ? "現在地は距離判定だけに使い、投下履歴には保存しません" : "プレビューでは場所に関係なくデモ投下できます"}</small></span></div>
          <div className="stake-control"><button aria-label="EXPを減らす" onClick={() => setStake(Math.max(100, stake - 100))}><Minus /></button><b>{stake} EXP</b><button aria-label="EXPを増やす" onClick={() => setStake(Math.min(1000, stake + 100))}><Plus /></button></div>
          <button className="primary-wide" onClick={contribute}>{liveEnabled ? "現在地を確認して投下" : "EXPをデモ投下"}</button>
        </div>
      )}
      {result && <div className="notice map-result" role="status">{result}</div>}
      {rewardDisplay && <div className="reward-overlay" role="dialog" aria-modal="true" aria-label="抽選結果">
        <div className={`reward-modal is-${rewardDisplay.tier}`}>
          {rewardDisplay.tier !== "normal" && <div className="celebration-stars" aria-hidden="true"><Sparkles /><Star /><Sparkles /></div>}
          <span className="reward-tier">{rewardDisplay.tier === "super" ? "激レア" : rewardDisplay.tier === "rare" ? "レア" : "獲得"}</span>
          <div className="reward-icon"><Gift /></div>
          <h3>{rewardDisplay.label}</h3>
          {rewardDisplay.demoOnly && <p>演出確認モードです。所持EXP・景品には反映されません。</p>}
          <button onClick={() => setRewardDisplay(null)}>閉じる</button>
        </div>
      </div>}
    </section>
  );
}

function DemoCard({ profile, tagged, onTag }: { profile: CrossItem; tagged: boolean; onTag: (profile: CrossItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="cross-card">
      <div className="photo-wrap">
        <Avatar profile={profile} large />
        <span className="demo-badge">DEMO</span>
        <div className="photo-copy">
          <h3>{profile.displayName}, {profile.age}</h3>
          <p>{profile.occupation}</p>
        </div>
      </div>
      <div className="cross-body">
        <div className="cross-when"><MapPin />{profile.crossedLabel}</div>
        <h4>共通TAG {profile.sharedTags.length}</h4>
        <div className="tag-list">{profile.sharedTags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
        {expanded && <p className="bio">{profile.bio}</p>}
        <div className="card-actions">
          <button className="detail-button" onClick={() => setExpanded((value) => !value)}>{expanded ? "閉じる" : "プロフィール"}</button>
          <button className={`tag-button ${tagged ? "is-tagged" : ""}`} disabled={tagged} onClick={() => onTag(profile)}>
            <Sparkles />{tagged ? "DEMO MATCH成立" : "DEMOでTAGする"}
          </button>
        </div>
      </div>
    </article>
  );
}

function CrossScreen({ crossings, taggedIds, onTag }: { crossings: CrossItem[]; taggedIds: string[]; onTag: (profile: CrossItem) => void }) {
  return (
    <section className="screen">
      <header className="screen-header"><div><span>CROSS</span><h2>すれ違い</h2></div><button className="icon-button" aria-label="通知"><Bell /></button></header>
      <div className="demo-note"><OctagonAlert /><span><b>世界観プレビュー</b>表示中の人物はすべて架空のサンプルです。TAGすると端末内だけでデモマッチが成立し、実在ユーザーへの通知・連絡は発生しません。</span></div>
      <div className="cross-list">{crossings.map((profile) => <DemoCard key={profile.id} profile={profile} tagged={taggedIds.includes(profile.id)} onTag={onTag} />)}</div>
    </section>
  );
}

function MatchScreen({ matches, onClear, messageAccessReady, onRequireEmail }: { matches: CrossItem[]; onClear: () => void; messageAccessReady: boolean; onRequireEmail: () => void }) {
  const [selectedMessage, setSelectedMessage] = useState("共通のTAGが多くて気になりました。よかったら話しませんか？");
  const [sent, setSent] = useState(false);
  const messageOptions = [
    "共通のTAGが多くて気になりました。よかったら話しませんか？",
    "最近よく行くカフェ、気になっています。おすすめありますか？",
    "休日の過ごし方が近そうです。まずは気軽に話せたらうれしいです。",
  ];

  if (matches.length > 0) {
    return (
      <section className="screen">
        <header className="screen-header"><div><span>MATCH</span><h2>マッチ</h2></div><span className="match-count">{matches.length}</span></header>
        <div className="demo-note"><OctagonAlert /><span><b>デモマッチ</b>すべて架空のプロフィールとの端末内プレビューです。メッセージは送信されません。</span></div>
        <div className="demo-match-list">
          {matches.map((profile) => <article className="demo-match" key={profile.id}>
            <Avatar profile={profile} />
            <div><b>{profile.displayName}, {profile.age}</b><small>共通TAG: {profile.sharedTags.join(" / ")}</small></div>
            <span>DEMO</span>
          </article>)}
        </div>
        <div className="message-preview">
          <small>FIRST MESSAGE</small>
          <h3>最初のひとことを選ぶ</h3>
          <div className="message-options">{messageOptions.map((message) => <button key={message} className={selectedMessage === message ? "selected" : ""} onClick={() => { setSelectedMessage(message); setSent(false); }}>{message}</button>)}</div>
          <div className="message-bubble">{sent ? selectedMessage : "メッセージを選ぶと、ここでプレビューできます"}</div>
          <button className="primary-wide" onClick={() => messageAccessReady ? setSent(true) : onRequireEmail()}>{messageAccessReady ? (sent ? "送信プレビュー済み" : "送信をプレビュー") : "メッセージを開く"}</button>
          {!messageAccessReady && <p className="message-gate-note"><LockKeyhole /> メッセージの確認にはメール認証が必要です</p>}
        </div>
        <button className="demo-reset" onClick={onClear}>デモマッチをリセット</button>
      </section>
    );
  }

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

function FeedbackPanel() {
  const [rating, setRating] = useState<number | null>(null);
  const [topic, setTopic] = useState("わかりやすさ");
  const [sent, setSent] = useState(false);
  const topics = ["わかりやすさ", "プロフィール", "MAP・EXP", "安心感", "もっと使いたい機能"];

  function submit() {
    if (!rating) return;
    track("tagtokyo_preview_feedback", { rating, topic });
    setSent(true);
  }

  return <div className="settings-card feedback-card">
    <div className="section-heading"><div><small>PREVIEW FEEDBACK</small><h3>このデモ、どうだった？</h3></div><Star /></div>
    <p>個人情報なしで、仮公開の改善に使う評価だけ送れます。</p>
    <div className="rating-row" aria-label="満足度">{[1, 2, 3, 4, 5].map((value) => <button key={value} className={rating && value <= rating ? "selected" : ""} onClick={() => { setRating(value); setSent(false); }} aria-label={`${value}点`}>{value}</button>)}</div>
    <label className="feedback-topic"><span>一番改善してほしいところ</span><select value={topic} onChange={(event) => { setTopic(event.target.value); setSent(false); }}>{topics.map((item) => <option key={item}>{item}</option>)}</select></label>
    <button className="primary-wide" disabled={!rating || sent} onClick={submit}>{sent ? "評価を受け付けました" : "匿名で評価を送る"}</button>
  </div>;
}

function MeScreen({ verified, setVerified, email, setEmail, authNotice, sendMagicLink, growth, buyCosmetic, equipCosmetic, profile, setProfile, isOwner, liveEnabled }: {
  verified: boolean;
  setVerified: (value: boolean) => void;
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

  function saveProfile() {
    const handle = draft.handle.trim().toLowerCase();
    if (!HANDLE_PATTERN.test(handle)) {
      setEditorError("ユーザーIDは5〜15文字の英数字または _ で入力してください");
      return;
    }
    setProfile({ ...draft, displayName: draft.displayName.trim().slice(0, 50) || "あなた", handle });
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
      setPhotoNotice("この端末だけに写真プレビューを保存しました");
    };
    reader.readAsDataURL(file);
  }

  return (
    <section className="screen">
      <header className="screen-header"><div><span>ME</span><h2>プロフィール</h2></div></header>
      {isOwner && <div className="owner-note"><Crown /><span><b>OWNER MODE</b><small>全プロフィール項目と装飾を自由に確認できます</small></span></div>}
      <div className={`me-card profile-showcase ${growth.equippedBackground ? `equip-${growth.equippedBackground}` : ""}`}>
        <label className={`me-avatar avatar-upload ${growth.equippedFrame ? `equip-${growth.equippedFrame}` : ""}`}><ProfilePhoto profile={profile} /><input type="file" accept="image/*" onChange={selectPhoto} /><span className="avatar-camera"><Camera /></span></label>
        <div>{equippedTitle && <small className="equipped-title">{equippedTitle}</small>}<h3>{profile.displayName} <span className="profile-level">Lv.{progress.level}</span></h3><p>@{profile.handle} · {profile.bio}</p>{photoNotice && <small className="photo-notice">{photoNotice}</small>}</div>
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
        <button className="primary-wide" onClick={sendMagicLink}>{hasSupabase ? "ログインリンクを送る" : "プレビューモード"}</button>
        {authNotice && <p className="field-notice">{authNotice}</p>}
      </div>
      <div className="settings-card">
        <h3>安全と本人確認</h3>
        <label className="setting-row">
          <span><b>20歳以上の自己申告（プレビュー）</b><small>実交流の開始時は、別途公的な年齢確認を行います</small></span>
          <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
        </label>
        <button className="setting-link"><span>ブロックしたユーザー</span><ChevronRight /></button>
        <button className="setting-link"><span>通報履歴</span><ChevronRight /></button>
        <button className="setting-link danger"><span>退会する</span><LogOut /></button>
      </div>
      <div className="settings-card compact">
        <p><b>位置情報の扱い</b></p>
        <p>すれ違い判定だけに利用し、生の位置情報は数時間から24時間以内に削除します。他ユーザーへ現在地や正確な距離を公開しません。</p>
      </div>
      <div className={`settings-card launch-status ${liveEnabled ? "is-live" : ""}`}>
        <div className="section-heading"><div><small>COMMUNITY STATUS</small><h3>{liveEnabled ? "限定ベータを運用中" : "安全なプレビューを公開中"}</h3></div><ShieldCheck /></div>
        <p>{liveEnabled ? "年齢確認済みの参加者だけが交流機能を利用できます。" : "実在ユーザー同士のTAG・MATCH・メッセージはまだ有効化していません。"}</p>
        <ul><li>現在地・正確な距離は非公開</li><li>ブロック・通報を常時利用可能</li><li>18歳未満は利用不可</li></ul>
      </div>
      <FeedbackPanel />
      {editing && <div className="profile-editor-overlay" role="dialog" aria-modal="true" aria-label="プロフィール編集">
        <div className="profile-editor">
          <header><div><small>EDIT PROFILE</small><h3>プロフィールを編集</h3></div><button aria-label="編集を閉じる" onClick={() => setEditing(false)}>×</button></header>
          <p className="editor-guide">{isOwner ? "オーナーはすべての項目を編集できます" : `Lv.${progress.level}までの項目を編集できます`}。表示名は50文字まで、ユーザーIDは5〜15文字の英数字または _ です。</p>
          <div className="editor-fields">
            {profileFields.map((field) => {
              const unlocked = isOwner || progress.level >= field.level;
              return <label key={field.key} className={!unlocked ? "locked-field" : ""}><span>{field.label}{!unlocked && <small><LockKeyhole />Lv.{field.level}で解放</small>}</span>{field.long
                ? <textarea disabled={!unlocked} value={draft[field.key]} placeholder={field.placeholder} maxLength={field.key === "bio" || field.key === "extraBio" ? 500 : 160} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />
                : <input disabled={!unlocked} value={draft[field.key]} placeholder={field.placeholder} maxLength={field.key === "displayName" ? 50 : field.key === "handle" ? 15 : 60} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: field.key === "handle" ? event.target.value.replace(/[^A-Za-z0-9_]/g, "") : event.target.value }))} />}</label>;
            })}
          </div>
          {editorError && <p className="editor-error" role="alert">{editorError}</p>}
          <div className="editor-actions"><button onClick={() => setEditing(false)}>キャンセル</button><button onClick={saveProfile}>保存する</button></div>
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
  const [verified, setVerified] = useState(false);
  const [email, setEmail] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [growth, setGrowth] = useState<GrowthState>(INITIAL_GROWTH);
  const [profile, setProfile] = useState<EditableProfile>(INITIAL_PROFILE);
  const [isOwner, setIsOwner] = useState(false);
  const [isEmailAuthenticated, setIsEmailAuthenticated] = useState(false);
  const [demoMatches, setDemoMatches] = useState<CrossItem[]>([]);
  const [showMessageGate, setShowMessageGate] = useState(false);
  const [growthLoaded, setGrowthLoaded] = useState(false);
  const [dailyBonusNotice, setDailyBonusNotice] = useState("");
  const crossings = useMemo(() => sampleCrossings(MY_TAGS), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${ASSET_PREFIX}/sw.js`).catch(() => undefined);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("tagtokyo_growth_preview_v2");
    const timeout = window.setTimeout(() => {
      if (saved) {
        try {
          const restored = JSON.parse(saved) as GrowthState;
          setGrowth({ ...INITIAL_GROWTH, ...restored });
        } catch { /* Ignore invalid preview state. */ }
      }
      setGrowthLoaded(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (growthLoaded) window.localStorage.setItem("tagtokyo_growth_preview_v2", JSON.stringify(growth));
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
    const saved = window.localStorage.getItem("tagtokyo_profile_preview_v1");
    if (!saved) return;
    try {
      const restored = JSON.parse(saved) as EditableProfile;
      const timeout = window.setTimeout(() => setProfile({ ...INITIAL_PROFILE, ...restored }), 0);
      return () => window.clearTimeout(timeout);
    } catch { /* Ignore invalid preview state. */ }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("tagtokyo_profile_preview_v1", JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    const saved = window.localStorage.getItem("tagtokyo_demo_matches_v1");
    if (!saved) return;
    try {
      const restored = JSON.parse(saved) as CrossItem[];
      const timeout = window.setTimeout(() => setDemoMatches(restored), 0);
      return () => window.clearTimeout(timeout);
    } catch { /* Ignore invalid preview state. */ }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("tagtokyo_demo_matches_v1", JSON.stringify(demoMatches));
  }, [demoMatches]);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      // Owner preview is useful locally, but a production URL must never grant it.
      if (process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("owner-preview") === "1") {
        const timeout = window.setTimeout(() => setIsOwner(true), 0);
        return () => window.clearTimeout(timeout);
      }
      return;
    }

    const connectedClient = client;
    let active = true;
    async function syncOwnerRole() {
      const { data: { user } } = await connectedClient.auth.getUser();
      if (!user) {
        if (active) {
          setIsOwner(false);
          setIsEmailAuthenticated(false);
        }
        return;
      }
      const { data } = await connectedClient.from("users").select("role").eq("auth_user_id", user.id).maybeSingle();
      if (active) {
        setIsOwner(data?.role === "owner");
        setIsEmailAuthenticated(Boolean(user.email));
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
    if (!session.active || !session.expiresAt) return;
    const timeout = window.setTimeout(() => {
      setSession((current) => ({ ...current, active: false, startedAt: null, expiresAt: null }));
      setNotice("TAG ONが自動終了しました");
      track("tagtokyo_tag_session_ended", { reason: "expired" });
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [session.active, session.expiresAt]);

  async function startTag() {
    if (!verified) {
      setNotice("MEで20歳以上確認を完了してください");
      setAuthNotice("TAG ONの前に20歳以上確認が必要です");
      setTab("me");
      return;
    }
    if (!isLiveCommunityEnabled) {
      const startedAt = Date.now();
      const expiresAt = startedAt + session.duration * 60 * 1000;
      setNow(startedAt);
      setSession((current) => ({ ...current, active: true, startedAt, expiresAt, areaLabel: "TOKYO DEMO" }));
      setNotice("端末内プレビューでTAG ONを開始しました。位置情報と実在ユーザーへの通知は発生しません");
      track("tagtokyo_preview_session_started", { duration_minutes: session.duration });
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
      setAuthNotice("Supabase接続前のため、現在は安全なUIプレビューです");
      return;
    }
    if (!email.includes("@")) {
      setAuthNotice("メールアドレスを入力してください");
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
    setAuthNotice(error ? error.message : "ログインリンクをメールへ送りました");
  }

  async function requestMessageAccess(nextEmail: string) {
    setEmail(nextEmail);
    setShowMessageGate(false);
    if (!hasSupabase || !supabase) {
      setAuthNotice("メール認証の本番接続を準備中です。公開プレビューではメッセージ送信はできません。");
      setTab("me");
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({ email: nextEmail, options: { emailRedirectTo: window.location.href } });
    setAuthNotice(error ? error.message : "ログインリンクをメールへ送りました。認証後にメッセージを開けます。");
    setTab("me");
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
    track(isOwner ? "tagtokyo_owner_cosmetic_previewed" : "tagtokyo_cosmetic_exchanged", { cosmetic_id: id, exp_cost: isOwner ? 0 : item.cost });
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

  function createDemoMatch(profile: CrossItem) {
    setDemoMatches((current) => current.some((item) => item.id === profile.id) ? current : [profile, ...current]);
    setNotice(`${profile.displayName}さんとDEMO MATCHが成立しました`);
    track("tagtokyo_demo_tagged", { profile_id: profile.id });
  }

  return (
    <main className="app-shell">
      <div className="top-brand"><span className="brand-mark"><Sparkles /></span><b>TAG TOKYO</b><small>PLAY BETA</small></div>
      {tab === "home" && <HomeScreen session={session} now={now} setDuration={(duration) => setSession((current) => ({ ...current, duration }))} start={startTag} stop={stopTag} notice={notice} growth={growth} dailyBonusNotice={dailyBonusNotice} />}
      {tab === "cross" && <CrossScreen crossings={crossings} taggedIds={demoMatches.map((item) => item.id)} onTag={createDemoMatch} />}
      {tab === "map" && <MapScreen growth={growth} setGrowth={setGrowth} liveEnabled={isLiveCommunityEnabled} />}
      {tab === "match" && <MatchScreen matches={demoMatches} onClear={() => setDemoMatches([])} messageAccessReady={isEmailAuthenticated} onRequireEmail={() => setShowMessageGate(true)} />}
      {tab === "me" && <MeScreen verified={verified} setVerified={setVerified} email={email} setEmail={setEmail} authNotice={authNotice} sendMagicLink={sendMagicLink} growth={growth} buyCosmetic={buyCosmetic} equipCosmetic={equipCosmetic} profile={profile} setProfile={setProfile} isOwner={isOwner} liveEnabled={isLiveCommunityEnabled} />}
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
