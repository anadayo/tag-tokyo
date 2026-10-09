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

const BASE_AREAS: TokyoArea[] = [
  { id: "kichijoji", name: "吉祥寺", x: 13, y: 48, latitude: 35.7033, longitude: 139.5796, radiusMeters: 1000 },
  { id: "asakusa", name: "浅草", x: 79, y: 30, latitude: 35.7119, longitude: 139.7983, radiusMeters: 1000 },
  { id: "kitasenju", name: "北千住", x: 80, y: 12, latitude: 35.7497, longitude: 139.8050, radiusMeters: 1000 },
];

const YAMANOTE_STATIONS = [
  ["tokyo", "東京", "TOKYO", 35.681236, 139.767125],
  ["kanda", "神田", "KANDA", 35.69169, 139.770883],
  ["akihabara", "秋葉原", "AKIHABARA", 35.698353, 139.773114],
  ["okachimachi", "御徒町", "OKACHIMACHI", 35.707438, 139.774632],
  ["ueno", "上野", "UENO", 35.713768, 139.777254],
  ["uguisudani", "鶯谷", "UGUISUDANI", 35.720495, 139.778837],
  ["nippori", "日暮里", "NIPPORI", 35.727772, 139.770987],
  ["nishi-nippori", "西日暮里", "NISHI-NIPPORI", 35.732135, 139.766787],
  ["tabata", "田端", "TABATA", 35.738062, 139.76086],
  ["komagome", "駒込", "KOMAGOME", 35.736489, 139.746875],
  ["sugamo", "巣鴨", "SUGAMO", 35.733445, 139.73929],
  ["otsuka", "大塚", "OTSUKA", 35.731401, 139.728662],
  ["ikebukuro", "池袋", "IKEBUKURO", 35.728926, 139.71038],
  ["mejiro", "目白", "MEJIRO", 35.721204, 139.706587],
  ["takadanobaba", "高田馬場", "TAKADANOBABA", 35.712677, 139.703715],
  ["shin-okubo", "新大久保", "SHIN-OKUBO", 35.701306, 139.700044],
  ["shinjuku", "新宿", "SHINJUKU", 35.689592, 139.700413],
  ["yoyogi", "代々木", "YOYOGI", 35.683061, 139.702042],
  ["harajuku", "原宿", "HARAJUKU", 35.670168, 139.702689],
  ["shibuya", "渋谷", "SHIBUYA", 35.658034, 139.701636],
  ["ebisu", "恵比寿", "EBISU", 35.64669, 139.710106],
  ["meguro", "目黒", "MEGURO", 35.633998, 139.715828],
  ["gotanda", "五反田", "GOTANDA", 35.626446, 139.723444],
  ["osaki", "大崎", "OSAKI", 35.6197, 139.728553],
  ["shinagawa", "品川", "SHINAGAWA", 35.628471, 139.73876],
  ["takanawa-gateway", "高輪ゲートウェイ", "TAKANAWA GATEWAY", 35.6355, 139.7407],
  ["tamachi", "田町", "TAMACHI", 35.645736, 139.747575],
  ["hamamatsucho", "浜松町", "HAMAMATSUCHO", 35.655646, 139.756749],
  ["shimbashi", "新橋", "SHIMBASHI", 35.666195, 139.758587],
  ["yurakucho", "有楽町", "YURAKUCHO", 35.675069, 139.763328],
] as const;

const mapX = (longitude: number) => Math.max(0, Math.min(100, Math.round((longitude - 139.57) / 0.25 * 100)));
const mapY = (latitude: number) => Math.max(0, Math.min(100, Math.round((35.76 - latitude) / 0.16 * 100)));

const YAMANOTE_AREAS: TokyoArea[] = YAMANOTE_STATIONS.map(([id, name, , latitude, longitude]) => ({
  id, name, latitude, longitude, x: mapX(longitude), y: mapY(latitude), radiusMeters: 1000,
}));

export const TOKYO_AREAS: TokyoArea[] = [...BASE_AREAS, ...YAMANOTE_AREAS];

const YAMANOTE_SPOTS: TagSpot[] = YAMANOTE_STATIONS.map(([id, , romanized, latitude, longitude]) => ({
  id: `spot-${id}`, name: `${romanized} TAG SPOT`, areaId: id, latitude, longitude,
  x: mapX(longitude), y: mapY(latitude), radiusMeters: 150,
}));

export const TAG_SPOTS: TagSpot[] = [
  ...YAMANOTE_SPOTS,
  { id: "spot-asakusa", name: "ASAKUSA TAG SPOT", areaId: "asakusa", x: 80, y: 32, latitude: 35.7128, longitude: 139.7983, radiusMeters: 150 },
  { id: "spot-kitasenju", name: "KITASENJU TAG SPOT", areaId: "kitasenju", x: 80, y: 12, latitude: 35.7508, longitude: 139.8050, radiusMeters: 150 },
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
