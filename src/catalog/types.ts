import { ViblibError } from "../util/errors.js";

export const CATALOG_VERSION = 1 as const;

export interface CatalogSkill {
  skill: string;
  source: string;
  categories: string[];
}

export interface Catalog {
  version: typeof CATALOG_VERSION;
  skills: Record<string, CatalogSkill>;
}

const MAX_INSTALL_NAME_LENGTH = 255,
  INVALID_NAME_RUN = /[^a-z0-9._]+/g,
  NAME_EDGE = /^[.-]+|[.-]+$/g,
  INVALID_CATEGORY_RUN = /[^a-z0-9]+/g,
  CATEGORY_EDGE = /^-+|-+$/g;

export function normalizeInstallName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(INVALID_NAME_RUN, "-")
    .replace(NAME_EDGE, "")
    .slice(0, MAX_INSTALL_NAME_LENGTH);
  if (!normalized) {
    throw new ViblibError("Skill name must normalize to 1–255 characters.");
  }
  return normalized;
}

export function normalizeCategory(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(INVALID_CATEGORY_RUN, "-")
    .replace(CATEGORY_EDGE, "");
  if (!normalized) {
    throw new ViblibError("Category must not be empty.");
  }
  return normalized;
}

export function emptyCatalog(): Catalog {
  return { skills: {}, version: CATALOG_VERSION };
}
