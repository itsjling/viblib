import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ViblibError } from "../util/errors.js";
import {
  CATALOG_VERSION,
  type Catalog,
  type CatalogSkill,
  emptyCatalog,
  normalizeCategory,
  normalizeInstallName,
} from "./types.js";

export function getCatalogPath(): string {
  const home = process.env.VIBLIB_HOME?.trim()
    ? path.resolve(process.env.VIBLIB_HOME)
    : path.join(os.homedir(), ".viblib");
  return path.join(home, "catalog.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && "code" in error && error.code === "ENOENT";
}

function invalid(field: string, message: string): never {
  throw new ViblibError(`Invalid catalog at ${field}: ${message}`);
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  field: string
): void {
  const actual = Object.keys(value).toSorted(),
    expected = [...keys].toSorted();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalid(field, `expected fields ${expected.join(", ")}.`);
  }
}

function validateSkill(value: unknown, key: string): CatalogSkill {
  const field = `skills.${JSON.stringify(key)}`;
  if (!isRecord(value)) {
    invalid(field, "expected an object.");
  }
  exactKeys(value, ["skill", "source", "categories"], field);
  if (
    typeof value.skill !== "string" ||
    !value.skill.trim() ||
    hasControlCharacters(value.skill)
  ) {
    invalid(`${field}.skill`, "expected a non-empty string.");
  }
  if (
    typeof value.source !== "string" ||
    !value.source.trim() ||
    value.source !== value.source.trim() ||
    hasControlCharacters(value.source)
  ) {
    invalid(`${field}.source`, "expected a non-empty string.");
  }
  if (
    !Array.isArray(value.categories) ||
    !value.categories.every((category) => typeof category === "string")
  ) {
    invalid(`${field}.categories`, "expected an array of strings.");
  }
  let normalizedName: string;
  try {
    normalizedName = normalizeInstallName(value.skill);
  } catch {
    invalid(`${field}.skill`, "is not a valid install name.");
  }
  if (key !== normalizedName) {
    invalid(field, "key does not match the normalized skill name.");
  }
  const categories: string[] = [],
    seen = new Set<string>();
  for (const [index, category] of value.categories.entries()) {
    let normalized: string;
    try {
      normalized = normalizeCategory(category);
    } catch {
      invalid(`${field}.categories[${index}]`, "is not valid.");
    }
    if (category !== normalized) {
      invalid(`${field}.categories[${index}]`, "must be normalized.");
    }
    if (seen.has(category)) {
      invalid(`${field}.categories[${index}]`, "is duplicated.");
    }
    seen.add(category);
    categories.push(category);
  }
  return { categories, skill: value.skill, source: value.source };
}

export function validateCatalog(value: unknown): Catalog {
  if (!isRecord(value)) {
    invalid("$", "expected an object.");
  }
  exactKeys(value, ["version", "skills"], "$");
  if (value.version !== CATALOG_VERSION) {
    invalid("version", `expected ${CATALOG_VERSION}.`);
  }
  if (!isRecord(value.skills)) {
    invalid("skills", "expected an object.");
  }
  const skills: Record<string, CatalogSkill> = {};
  for (const [key, skill] of Object.entries(value.skills)) {
    skills[key] = validateSkill(skill, key);
  }
  return { skills, version: CATALOG_VERSION };
}

export async function loadCatalog(): Promise<{
  catalog: Catalog;
  catalogPath: string;
}> {
  const target = getCatalogPath();
  try {
    const raw = await fs.readFile(target, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      invalid("$", "invalid JSON.");
    }
    return { catalog: validateCatalog(parsed), catalogPath: target };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { catalog: emptyCatalog(), catalogPath: target };
    }
    throw error;
  }
}

function canonicalCatalog(catalog: Catalog): Catalog {
  validateCatalog(catalog);
  const skills: Record<string, CatalogSkill> = {};
  for (const key of Object.keys(catalog.skills).toSorted((a, b) =>
    a.localeCompare(b)
  )) {
    const entry = catalog.skills[key];
    skills[key] = {
      ...entry,
      categories: [...entry.categories].toSorted((a, b) => a.localeCompare(b)),
    };
  }
  return { skills, version: CATALOG_VERSION };
}

export async function saveCatalog(
  catalog: Catalog,
  target = getCatalogPath()
): Promise<void> {
  const body = `${JSON.stringify(canonicalCatalog(catalog), null, 2)}\n`,
    dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const temporary = path.join(
    dir,
    `.catalog-${process.pid}-${crypto.randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}
