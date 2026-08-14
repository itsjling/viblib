import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ViblibError } from "../util/errors.js";
import type { SkillScope, UpstreamLock } from "./types.js";

export function upstreamLockPath(
  scope: SkillScope,
  cwd = process.cwd()
): string {
  if (scope === "project") {
    return path.join(cwd, "skills-lock.json");
  }
  const stateHome = process.env.XDG_STATE_HOME;
  return stateHome
    ? path.join(stateHome, "skills", ".skill-lock.json")
    : path.join(os.homedir(), ".agents", ".skill-lock.json");
}

export async function readUpstreamLock(
  scope: SkillScope,
  cwd = process.cwd()
): Promise<UpstreamLock> {
  const target = upstreamLockPath(scope, cwd);
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(target, "utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("skills" in parsed) ||
      !(parsed as Record<string, unknown>).skills ||
      typeof (parsed as Record<string, unknown>).skills !== "object" ||
      Array.isArray((parsed as Record<string, unknown>).skills)
    ) {
      throw new Error("expected an object field named 'skills'");
    }
    return (parsed as { skills: UpstreamLock }).skills;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }
    throw new ViblibError(
      `Could not read the skills lock at ${target}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error, exitCode: 2 }
    );
  }
}
