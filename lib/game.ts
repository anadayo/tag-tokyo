import type { GrowthState, TagSpot, TokyoArea } from "@/lib/types";

export const LEVEL_THRESHOLDS = Array.from({ length: 100 }, (_, index) =>
  Math.ceil(30000 * Math.pow(index / 99, 1.35)),
);

export const INITIAL_GROWTH: GrowthState = {
  totalEarnedExp: 0,
  availableExp: 0,
  lastDailyLoginDate: null,
  areaContributions: {},
  ownedCosmetics: [],
  equippedFrame: null,
  equippedBackground: null,
  equippedTitle: null,
  spotClaims: {},
};

export const DAILY_LOGIN_EXP = 20;

export const TOKYO_AREAS: TokyoArea[] = [
  { id: "kichijoji", name: "吉祥寺", x: 13, y: 48 },
  { id: "shinjuku", name: "新宿", x: 35, y: 52 },
  { id: "shibuya", name: "渋谷", x: 36, y: 72 },
  { id: "ikebukuro", name: "池袋", x: 42, y: 30 },
  { id: "ueno", name: "上野", x: 69, y: 28 },
  { id: "kitasenju", name: "北千住", x: 80, y: 12 },
];

export const TAG_SPOTS: TagSpot[] = [
  { id: "spot-shibuya", name: "SHIBUYA TAG SPOT", areaId: "shibuya", x: 49, y: 77 },
  { id: "spot-shinjuku", name: "SHINJUKU TAG SPOT", areaId: "shinjuku", x: 27, y: 40 },
  { id: "spot-ueno", name: "UENO TAG SPOT", areaId: "ueno", x: 78, y: 38 },
];

export const COSMETICS: Array<{
  id: string;
  name: string;
  kind: string;
  slot: "frame" | "background" | "title";
  cost: number;
  color: string;
  rewardLevel?: number;
  campaignOnly?: boolean;
}> = [
  { id: "frame-mint", name: "TOKYO MINT", kind: "フレーム", slot: "frame", cost: 500, color: "#21c78a" },
  { id: "frame-coral", name: "CROSS CORAL", kind: "フレーム", slot: "frame", cost: 800, color: "#ff5f69" },
  { id: "background-night", name: "TOKYO NIGHT", kind: "背景", slot: "background", cost: 800, color: "#25242b" },
  { id: "title-walker", name: "東京ウォーカー", kind: "称号", slot: "title", cost: 1000, color: "#ffd75e" },
  { id: "title-cafe", name: "カフェ開拓中", kind: "称号", slot: "title", cost: 1000, color: "#b88a63" },
  { id: "background-season", name: "SEASON LIGHT", kind: "季節背景", slot: "background", cost: 2000, color: "#92b5c7" },
  { id: "title-level-50", name: "CITY EXPLORER", kind: "Lv50特典", slot: "title", cost: 0, color: "#087fb7", rewardLevel: 50 },
  { id: "frame-level-100", name: "TOKYO MASTER", kind: "Lv100特典", slot: "frame", cost: 0, color: "#d6ab31", rewardLevel: 100 },
  { id: "background-level-100", name: "TOKYO HORIZON", kind: "Lv100特典", slot: "background", cost: 0, color: "#ff6b70", rewardLevel: 100 },
  { id: "title-level-100", name: "東京を歩ききった人", kind: "Lv100限定", slot: "title", cost: 0, color: "#d6ab31", rewardLevel: 100 },
  { id: "title-beta-tester", name: "β TESTER", kind: "先着300名限定", slot: "title", cost: 0, color: "#ff5f69", campaignOnly: true },
];

export const INITIAL_PROFILE = {
  displayName: "あなた",
  handle: "tokyo_player",
  gender: "unspecified" as const,
  avatarDataUrl: "",
  bio: "東京のカフェと散歩が好きです。気軽に話せるとうれしいです。",
  activityArea: "",
  weekend: "新しいお店を探すか、映画を観ています",
  romance: "まずはゆっくり話したい",
  contactFrequency: "1日数回くらい",
  values: "お互いの時間を大切にしたい",
  lifestyle: "朝型・休日は外出多め",
  work: "",
  moneyStyle: "",
  marriageView: "",
  extraBio: "",
  tags: [] as string[],
  primaryTags: [] as string[],
};

export const PROFILE_UNLOCKS = [
  { level: 1, label: "基本プロフィール" },
  { level: 3, label: "休日の過ごし方" },
  { level: 5, label: "恋愛観・連絡頻度" },
  { level: 7, label: "価値観・生活スタイル" },
  { level: 9, label: "仕事・お金の使い方" },
  { level: 11, label: "結婚観・自己紹介追加枠" },
  { level: 50, label: "CITY EXPLORER称号" },
  { level: 100, label: "限定フレーム・背景・称号" },
];

export function getLevel(totalEarnedExp: number) {
  let level = 1;
  LEVEL_THRESHOLDS.forEach((threshold, index) => {
    if (totalEarnedExp >= threshold) level = index + 1;
  });
  return Math.min(level, LEVEL_THRESHOLDS.length);
}

export function getLevelProgress(totalEarnedExp: number) {
  const level = getLevel(totalEarnedExp);
  const current = LEVEL_THRESHOLDS[level - 1];
  const next = LEVEL_THRESHOLDS[level] ?? current;
  const span = Math.max(1, next - current);
  return { level, remaining: Math.max(0, next - totalEarnedExp), percent: Math.min(100, ((totalEarnedExp - current) / span) * 100) };
}

export function drawSpotReward(random = Math.random()) {
  if (random < 1 / 300) return { type: "cosmetic", rarity: "SSR", label: "SUPER BOOST", exp: 0 };
  if (random < 1 / 80) return { type: "cosmetic", rarity: "SR", label: "BOOST", exp: 0 };
  if (random < 1 / 25) return { type: "cosmetic", rarity: "RARE", label: "限定プロフィール装飾", exp: 0 };
  if (random < 0.12) return { type: "exp", rarity: "BIG", label: "+100 EXP", exp: 100 };
  if (random < 0.37) return { type: "exp", rarity: "GOOD", label: "+50 EXP", exp: 50 };
  return { type: "exp", rarity: "NORMAL", label: "+30 EXP", exp: 30 };
}
