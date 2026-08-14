export type SkillScope = "project" | "global";

export interface InstalledSkill {
  name: string;
  path: string;
  scope: string;
  agents: string[];
  source: string | null;
  sourceUrl: string | null;
  sourceType: string | null;
}

export interface SourceIdentity {
  source: string;
  ref: string | null;
  subpath: string | null;
  type: "git" | "local" | "download" | "well-known";
}

export interface UpstreamLockEntry {
  source?: string;
  sourceUrl?: string;
  sourceType?: string;
  ref?: string;
}

export type UpstreamLock = Record<string, UpstreamLockEntry>;
