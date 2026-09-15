import type { GrowthState, TagSpot, TokyoArea } from "@/lib/types";

export const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1450, 2000, 2500, 3200, 4100, 5200, 6500];

export const INITIAL_GROWTH: GrowthState = {
  totalEarnedExp: 2260,
  availableExp: 1480,
  areaContributions: { kitasenju: 2400 },
  ownedCosmetics: [],
  equippedFrame: null,
  spotClaims: {},
};

export const TOKYO_AREAS: TokyoArea[] = [
  { id: "kichijoji", name: "吉祥寺", x: 13, y: 48, champion: "MIO", championPoints: 2840, championLevel: 8, isDemo: true },
  { id: "shinjuku", name: "新宿", x: 35, y: 52, champion: "REN", championPoints: 3920, championLevel: 9, isDemo: true },
  { id: "shibuya", name: "渋谷", x: 36, y: 72, champion: "AOI", championPoints: 4610, championLevel: 10, isDemo: true },
  { id: "ikebukuro", name: "池袋", x: 42, y: 30, champion: "SORA", championPoints: 3260, championLevel: 8, isDemo: true },
  { id: "ueno", name: "上野", x: 69, y: 28, champion: "YUI", championPoints: 2740, championLevel: 7, isDemo: true },
  { id: "kitasenju", name: "北千住", x: 80, y: 12, champion: "NAGI", championPoints: 3000, championLevel: 8, isDemo: true },
];

export const TAG_SPOTS: TagSpot[] = [
  { id: "spot-shibuya", name: "SHIBUYA TAG SPOT", areaId: "shibuya", x: 49, y: 77 },
  { id: "spot-shinjuku", name: "SHINJUKU TAG SPOT", areaId: "shinjuku", x: 27, y: 40 },
  { id: "spot-ueno", name: "UENO TAG SPOT", areaId: "ueno", x: 78, y: 38 },
];

export const COSMETICS = [
  { id: "frame-mint", name: "TOKYO MINT", kind: "フレーム", cost: 500, color: "#21c78a" },
  { id: "frame-coral", name: "CROSS CORAL", kind: "フレーム", cost: 800, color: "#ff5f69" },
  { id: "title-walker", name: "東京ウォーカー", kind: "称号", cost: 1000, color: "#ffd75e" },
];

export const PROFILE_UNLOCKS = [
  { level: 1, label: "基本プロフィール" },
  { level: 3, label: "休日の過ごし方" },
  { level: 5, label: "恋愛観・連絡頻度" },
  { level: 7, label: "価値観・生活スタイル" },
  { level: 9, label: "仕事・お金の使い方" },
  { level: 11, label: "結婚観・自己紹介追加枠" },
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
