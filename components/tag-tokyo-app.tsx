"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell, ChevronRight, Clock3, HeartHandshake, Home, LogOut, MapPin,
  MessageCircle, OctagonAlert, Power, ShieldCheck, Sparkles, UserRound, UsersRound,
} from "lucide-react";
import { track } from "@/lib/analytics";
import { sampleCrossings } from "@/lib/demo-profiles";
import { isInsideTokyo, requestPrivateLocation } from "@/lib/location";
import { hasSupabase, supabase } from "@/lib/supabase";
import type { CrossItem, TabId, TagDuration, TagSessionState } from "@/lib/types";

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

function HomeScreen({ session, now, setDuration, start, stop, notice }: {
  session: TagSessionState;
  now: number;
  setDuration: (duration: TagDuration) => void;
  start: () => void;
  stop: () => void;
  notice: string;
}) {
  return (
    <section className="screen home-screen">
      <div className="eyebrow"><MapPin /> TOKYO ONLY</div>
      <h1>東京ですれ違った人と、<br />あとからつながる。</h1>
      <p className="lead">現在地は誰にも表示されません。近くにいた事実だけを、あとからCROSSに届けます。</p>

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

function MeScreen({ verified, setVerified, email, setEmail, authNotice, sendMagicLink }: {
  verified: boolean;
  setVerified: (value: boolean) => void;
  email: string;
  setEmail: (value: string) => void;
  authNotice: string;
  sendMagicLink: () => void;
}) {
  return (
    <section className="screen">
      <header className="screen-header"><div><span>ME</span><h2>プロフィール</h2></div></header>
      <div className="me-card">
        <div className="me-avatar">A</div>
        <div><h3>あなた</h3><p>東京で使う、すれ違いマッチング</p></div>
        <button aria-label="プロフィール編集"><ChevronRight /></button>
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
          <span><b>18歳以上確認</b><small>正式版では本人確認サービスに接続します</small></span>
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
  const crossings = useMemo(() => sampleCrossings(MY_TAGS), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${ASSET_PREFIX}/sw.js`).catch(() => undefined);
    return () => window.clearInterval(timer);
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
      setNotice("MEで18歳以上確認を完了してください");
      setAuthNotice("TAG ONの前に18歳以上確認が必要です");
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

  return (
    <main className="app-shell">
      <div className="top-brand"><span className="brand-mark"><Sparkles /></span><b>TAG TOKYO</b><small>BETA</small></div>
      {tab === "home" && <HomeScreen session={session} now={now} setDuration={(duration) => setSession((current) => ({ ...current, duration }))} start={startTag} stop={stopTag} notice={notice} />}
      {tab === "cross" && <CrossScreen crossings={crossings} />}
      {tab === "match" && <MatchScreen />}
      {tab === "me" && <MeScreen verified={verified} setVerified={setVerified} email={email} setEmail={setEmail} authNotice={authNotice} sendMagicLink={sendMagicLink} />}
      <BottomNav tab={tab} onChange={(next) => {
        setTab(next);
        track("tagtokyo_tab_view", { tab: next });
        if (next === "cross") track("tagtokyo_cross_view");
      }} />
    </main>
  );
}
