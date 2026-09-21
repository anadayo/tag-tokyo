export type TabId = "home" | "cross" | "map" | "match" | "me";
export type TagDuration = 30 | 60 | 180;

export type DemoProfile = {
  id: string;
  displayName: string;
  age: number;
  gender: "woman" | "man";
  occupation: string;
  bio: string;
  activityArea: string;
  tags: string[];
  avatarIndex: number;
  isDemo: true;
};

export type CrossItem = DemoProfile & {
  crossedLabel: string;
  sharedTags: string[];
};

export type TagSessionState = {
  active: boolean;
  duration: TagDuration;
  startedAt: number | null;
  expiresAt: number | null;
  areaLabel: string | null;
};

export type GrowthState = {
  totalEarnedExp: number;
  availableExp: number;
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
  champion: string;
  championPoints: number;
  championLevel: number;
  isDemo: true;
};

export type TagSpot = {
  id: string;
  name: string;
  areaId: string;
  x: number;
  y: number;
};
