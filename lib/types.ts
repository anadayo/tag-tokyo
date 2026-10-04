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
};

export type LiveMessage = {
  id: number;
  matchId: string;
  senderId: string;
  body: string;
  createdAt: string;
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
  weekend: string;
  romance: string;
  contactFrequency: string;
  values: string;
  lifestyle: string;
  work: string;
  moneyStyle: string;
  marriageView: string;
  extraBio: string;
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
