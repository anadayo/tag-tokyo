export type TabId = "home" | "cross" | "map" | "match" | "me";
export type TagDuration = 30 | 60 | 180;

export type LiveMatch = {
  id: string;
  otherUserId: string;
  displayName: string;
  handle: string | null;
  bio: string;
  avatarUrl: string | null;
  isOfficial: boolean;
  createdAt: string;
  activityStatus: "recent" | "away" | "inactive";
  unreadCount: number;
};

export type LiveCrossing = {
  id: string;
  otherUserId: string;
  displayName: string;
  handle: string | null;
  bio: string;
  areaLabel: string;
  crossedAt: string;
  tagged: boolean;
  isOfficial: boolean;
  tags: string[];
  primaryTags: string[];
  commonTagCount: number;
  activityStatus: "recent" | "away" | "inactive";
};

export type OfficialProfile = {
  userId: string;
  displayName: string;
  handle: string | null;
  bio: string;
  avatarUrl: string | null;
};

export type DiscoveryProfile = {
  userId: string;
  displayName: string;
  handle: string | null;
  bio: string;
  avatarUrl: string | null;
  isOfficial: boolean;
  liked: boolean;
  tags: string[];
  primaryTags: string[];
  commonTagCount: number;
  activityStatus: "recent" | "away" | "inactive";
  relevanceScore: number;
};

export type TagCatalogItem = {
  id: number;
  name: string;
  category: string;
  aliases: string[];
  popularity: number;
  recentUses: number;
};

export type DailyMission = {
  key: "tag_on" | "walk_1km" | "cross_opened" | "all_complete";
  rewardExp: number;
  completed: boolean;
};

export type AreaChampion = {
  areaId: string;
  areaName: string;
  userId: string | null;
  displayName: string | null;
  handle: string | null;
  points: number;
  isOfficial: boolean;
  myPoints: number;
  pointsToFirst: number;
};

export type TagStreak = {
  current: number;
  totalDays: number;
  lastTagDate: string | null;
};

export type LiveMessage = {
  id: number;
  matchId: string;
  senderId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  reactions: Array<{ userId: string; reaction: "heart" | "smile" | "thanks" }>;
};

export type TagSessionState = {
  active: boolean;
  duration: TagDuration;
  startedAt: number | null;
  expiresAt: number | null;
  areaLabel: string | null;
  serverSessionId: string | null;
  validDistanceMeters: number;
  walkExpEarned: number;
  dailyDistanceMeters: number;
  dailyWalkExp: number;
  dailyWalkExpCap: number;
  movementStatus: string | null;
};

export type TagSessionResult = {
  durationSeconds: number;
  distanceMeters: number;
  walkExp: number;
  crossCount: number;
  spotCount: number;
  areas: string[];
};

export type GrowthState = {
  totalEarnedExp: number;
  availableExp: number;
  lastDailyLoginDate: string | null;
  areaContributions: Record<string, number>;
  ownedCosmetics: string[];
  equippedFrame: string | null;
  equippedBackground?: string | null;
  equippedTitle?: string | null;
  spotClaims: Record<string, string>;
};

export type EditableProfile = {
  displayName: string;
  handle: string;
  gender: "woman" | "man" | "nonbinary" | "unspecified";
  avatarDataUrl: string;
  bio: string;
  activityArea: string;
  weekend: string;
  romance: string;
  contactFrequency: string;
  values: string;
  lifestyle: string;
  work: string;
  moneyStyle: string;
  marriageView: string;
  extraBio: string;
  tags: string[];
  primaryTags: string[];
};

export type TokyoArea = {
  id: string;
  name: string;
  x: number;
  y: number;
};

export type TagSpot = {
  id: string;
  name: string;
  areaId: string;
  x: number;
  y: number;
};
