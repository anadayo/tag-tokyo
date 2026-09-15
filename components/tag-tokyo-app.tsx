"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell, ChevronRight, Clock3, Gift, HeartHandshake, Home, LockKeyhole, LogOut, Map,
  MapPin, MessageCircle, Minus, OctagonAlert, Plus, Power, ShieldCheck, ShoppingBag,
  Sparkles, Star, Trophy, UserRound, UsersRound, Zap,
} from "lucide-react";
import { track } from "@/lib/analytics";
import { sampleCrossings } from "@/lib/demo-profiles";
import {
  COSMETICS, drawSpotReward, getLevelProgress, INITIAL_GROWTH, PROFILE_UNLOCKS,
  TAG_SPOTS, TOKYO_AREAS,
} from "@/lib/game";
import { isInsideTokyo, requestPrivateLocation } from "@/lib/location";
import { hasSupabase, supabase } from "@/lib/supabase";
import type { CrossItem, GrowthState, TabId, TagDuration, TagSessionState } from "@/lib/types";

const INITIAL_SESSION: TagSessionState = {
  active: false,
  duration: 60,
  startedAt: null,
  expiresAt: null,
  areaLabel: null,
};
const MY_TAGS = ["音楽", "カフェ", "ゲーム", "散歩", "映画", "ラーメン"];
const ASSET_PREFIX = process.env.NODE_ENV === "production" ? "/tag-tokyo" : "";

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

function HomeScreen({ session, now, setDuration, start, stop, notice, growth }: {
  session: TagSessionState;
  now: number;
  setDuration: (duration: TagDuration) => void;
  start: () => void;
  stop: () => void;
  notice: string;
  growth: GrowthState;
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

function MapScreen({ growth, setGrowth }: { growth: GrowthState; setGrowth: React.Dispatch<React.SetStateAction<GrowthState>> }) {
  const [selectedAreaId, setSelectedAreaId] = useState("kitasenju");
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);
  const [stake, setStake] = useState(100);
  const [result, setResult] = useState("");
  const area = TOKYO_AREAS.find((item) => item.id === selectedAreaId) ?? TOKYO_AREAS[0];
  const spot = TAG_SPOTS.find((item) => item.id === selectedSpotId) ?? null;
  const myPoints = growth.areaContributions[area.id] ?? 0;
  const isAreaChampion = myPoints > area.championPoints;
  const today = new Date().toISOString().slice(0, 10);
  const alreadyClaimed = spot ? growth.spotClaims[spot.id] === today : false;

  function contribute() {
    if (growth.availableExp < stake) {
      setResult("所持EXPが足りません");
      return;
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
    setResult(duplicateReward ? "取得済み装飾の代わりに+100 EXPを獲得しました" : `${reward.rarity} ${reward.label}を獲得しました`);
    track("tagtokyo_spot_draw_preview", { spot_id: spot.id, reward: reward.rarity });
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
          <div className="reward-line"><span>通常</span><b>30 / 50 / 100 EXP</b><span>最高</span><b>SUPER BOOST</b></div>
          <button className="primary-wide spot-draw" disabled={alreadyClaimed} onClick={previewDraw}>{alreadyClaimed ? "本日のプレビュー済み" : "抽選をプレビュー"}</button>
        </div>
      ) : (
        <div className="map-panel">
          <div className="area-head"><div><small>AREA BATTLE</small><h3>{area.name}</h3></div><span className="demo-badge inline">DEMO RANKING</span></div>
          <div className="rank-row"><Trophy /><span><small>現在1位</small><b>{isAreaChampion ? `あなた · Lv.${getLevelProgress(growth.totalEarnedExp).level}` : `${area.champion} · Lv.${area.championLevel}`}</b></span><strong>{(isAreaChampion ? myPoints : area.championPoints).toLocaleString()}pt</strong></div>
          <div className="rank-row mine"><Star /><span><small>{isAreaChampion ? "次点 DEMO" : "あなた"}</small><b>{isAreaChampion ? `${area.champion} · Lv.${area.championLevel}` : `プロフィール Lv.${getLevelProgress(growth.totalEarnedExp).level}`}</b></span><strong>{(isAreaChampion ? area.championPoints : myPoints).toLocaleString()}pt</strong></div>
          <div className="stake-control"><button aria-label="EXPを減らす" onClick={() => setStake(Math.max(100, stake - 100))}><Minus /></button><b>{stake} EXP</b><button aria-label="EXPを増やす" onClick={() => setStake(Math.min(1000, stake + 100))}><Plus /></button></div>
          <button className="primary-wide" onClick={contribute}>このエリアへ投下</button>
        </div>
      )}
      {result && <div className="notice map-result" role="status">{result}</div>}
    </section>
  );
}

function DemoCard({ profile }: { profile: CrossItem }) {
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
          <button className="tag-button" disabled title="サンプルプロフィールにはTAGできません"><Sparkles />サンプルのためTAG不可</button>
        </div>
      </div>
    </article>
  );
}

function CrossScreen({ crossings }: { crossings: CrossItem[] }) {
  return (
    <section className="screen">
      <header className="screen-header"><div><span>CROSS</span><h2>すれ違い</h2></div><button className="icon-button" aria-label="通知"><Bell /></button></header>
      <div className="demo-note"><OctagonAlert /><span><b>世界観プレビュー</b>表示中の人物はすべて架空のサンプルです。実在ユーザーとしてのTAG・MATCH・通知は発生しません。</span></div>
      <div className="cross-list">{crossings.map((profile) => <DemoCard key={profile.id} profile={profile} />)}</div>
    </section>
  );
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

function MeScreen({ verified, setVerified, email, setEmail, authNotice, sendMagicLink, growth, buyCosmetic }: {
  verified: boolean;
  setVerified: (value: boolean) => void;
  email: string;
  setEmail: (value: string) => void;
  authNotice: string;
  sendMagicLink: () => void;
  growth: GrowthState;
  buyCosmetic: (id: string) => void;
}) {
  const progress = getLevelProgress(growth.totalEarnedExp);
  return (
    <section className="screen">
      <header className="screen-header"><div><span>ME</span><h2>プロフィール</h2></div></header>
      <div className="me-card">
        <div className={`me-avatar ${growth.equippedFrame ? "has-frame" : ""}`}>A</div>
        <div><h3>あなた <span className="profile-level">Lv.{progress.level}</span></h3><p>東京で育つ、あなたのプロフィール</p></div>
        <button aria-label="プロフィール編集"><ChevronRight /></button>
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
        <div className="section-heading"><div><small>EXP SHOP</small><h3>プロフィール装飾</h3></div><ShoppingBag /></div>
        <div className="cosmetic-list">
          {COSMETICS.map((item) => {
            const owned = growth.ownedCosmetics.includes(item.id);
            return <div key={item.id} className="cosmetic-item"><span className="cosmetic-swatch" style={{ background: item.color }} /><span><b>{item.name}</b><small>{item.kind}</small></span><button disabled={owned || growth.availableExp < item.cost} onClick={() => buyCosmetic(item.id)}>{owned ? "取得済み" : `${item.cost} EXP`}</button></div>;
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
          <span><b>20歳以上確認</b><small>正式版では本人確認サービスに接続します</small></span>
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
  const crossings = useMemo(() => sampleCrossings(MY_TAGS), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${ASSET_PREFIX}/sw.js`).catch(() => undefined);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("tagtokyo_growth_preview_v1");
    if (saved) {
      try {
        const restored = JSON.parse(saved) as GrowthState;
        const timeout = window.setTimeout(() => setGrowth(restored), 0);
        return () => window.clearTimeout(timeout);
      } catch { /* Ignore invalid preview state. */ }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("tagtokyo_growth_preview_v1", JSON.stringify(growth));
  }, [growth]);

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
      setNotice(hasSupabase ? "TAG ONを開始しました" : "端末内プレビューでTAG ONを開始しました。位置情報は送信していません");
      track("tagtokyo_tag_session_started", { duration_minutes: session.duration, backend: hasSupabase });
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

  function buyCosmetic(id: string) {
    const item = COSMETICS.find((candidate) => candidate.id === id);
    if (!item || growth.availableExp < item.cost || growth.ownedCosmetics.includes(id)) return;
    setGrowth((current) => ({
      ...current,
      availableExp: current.availableExp - item.cost,
      ownedCosmetics: [...current.ownedCosmetics, id],
      equippedFrame: item.kind === "フレーム" ? id : current.equippedFrame,
    }));
    track("tagtokyo_cosmetic_exchanged", { cosmetic_id: id, exp_cost: item.cost });
  }

  return (
    <main className="app-shell">
      <div className="top-brand"><span className="brand-mark"><Sparkles /></span><b>TAG TOKYO</b><small>PLAY BETA</small></div>
      {tab === "home" && <HomeScreen session={session} now={now} setDuration={(duration) => setSession((current) => ({ ...current, duration }))} start={startTag} stop={stopTag} notice={notice} growth={growth} />}
      {tab === "cross" && <CrossScreen crossings={crossings} />}
      {tab === "map" && <MapScreen growth={growth} setGrowth={setGrowth} />}
      {tab === "match" && <MatchScreen />}
      {tab === "me" && <MeScreen verified={verified} setVerified={setVerified} email={email} setEmail={setEmail} authNotice={authNotice} sendMagicLink={sendMagicLink} growth={growth} buyCosmetic={buyCosmetic} />}
      <BottomNav tab={tab} onChange={(next) => {
        setTab(next);
        window.scrollTo({ top: 0, behavior: "instant" });
        track("tagtokyo_tab_view", { tab: next });
        if (next === "cross") track("tagtokyo_cross_view");
      }} />
    </main>
  );
}
