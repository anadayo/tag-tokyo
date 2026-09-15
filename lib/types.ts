export type TabId = "home" | "cross" | "match" | "me";
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
