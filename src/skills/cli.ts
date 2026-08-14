import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import { assertSafeSkillName } from "../catalog/types.js";
import { ViblibError } from "../util/errors.js";
import { sourceForCatalog } from "./source.js";
import type { InstalledSkill, SkillScope } from "./types.js";

const require = createRequire(import.meta.url),
  MINIMUM_NODE_MAJOR = 22,
  MINIMUM_NODE_MINOR = 20;

export interface SkillsRunOptions {
  cwd?: string;
  inherit?: boolean;
  runner?: SkillsRunner;
}
export interface SkillsRunResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type SkillsRunner = (
  args: string[],
  options: Required<Pick<SkillsRunOptions, "cwd" | "inherit">>
) => Promise<SkillsRunResult>;

function skillsBin(): string {
  const manifest = require.resolve("skills/package.json");
  return path.join(path.dirname(manifest), "bin", "cli.mjs");
}

function assertSupportedNode(): void {
  const [major = 0, minor = 0] = process.versions.node
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  if (
    major < MINIMUM_NODE_MAJOR ||
    (major === MINIMUM_NODE_MAJOR && minor < MINIMUM_NODE_MINOR)
  ) {
    throw new ViblibError(
      "viblib and skills@1.5.22 require Node.js 22.20.0 or newer.",
      { exitCode: 2 }
    );
  }
}

function defaultRunner(
  args: string[],
  options: Required<Pick<SkillsRunOptions, "cwd" | "inherit">>
): Promise<SkillsRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [skillsBin(), ...args], {
      cwd: options.cwd,
      shell: false,
      stdio: options.inherit ? "inherit" : "pipe",
    });
    let stdout = "",
      stderr = "";
    if (!options.inherit) {
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stderr, stdout }));
  });
}

export async function runSkills(
  args: string[],
  options: SkillsRunOptions = {}
): Promise<SkillsRunResult> {
  assertSupportedNode();
  const cwd = options.cwd ?? process.cwd(),
    inherit = options.inherit ?? false;
  return (options.runner ?? defaultRunner)(args, { cwd, inherit });
}

function parseInstalled(value: unknown): InstalledSkill[] {
  if (!Array.isArray(value)) {
    throw new Error("Expected an array.");
  }
  return value.map((entry): InstalledSkill => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Expected an object entry.");
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.name !== "string" ||
      typeof item.path !== "string" ||
      typeof item.scope !== "string" ||
      !Array.isArray(item.agents) ||
      !item.agents.every((agent) => typeof agent === "string") ||
      ![item.source, item.sourceUrl, item.sourceType].every(
        (field) => field === null || typeof field === "string"
      )
    ) {
      throw new Error("Entry has an unsupported shape.");
    }
    return {
      agents: item.agents as string[],
      name: item.name,
      path: item.path,
      scope: item.scope,
      source: item.source as string | null,
      sourceType: item.sourceType as string | null,
      sourceUrl: item.sourceUrl as string | null,
    };
  });
}

export async function listInstalledSkills(options: {
  scope: SkillScope;
  cwd?: string;
  runner?: SkillsRunner;
}): Promise<InstalledSkill[]> {
  const result = await runSkills(
    ["list", "--json", ...(options.scope === "global" ? ["--global"] : [])],
    { cwd: options.cwd, runner: options.runner }
  );
  if (result.code !== 0) {
    throw new ViblibError(
      `Could not list installed skills: ${result.stderr || result.stdout}`,
      { exitCode: 2 }
    );
  }
  try {
    return parseInstalled(JSON.parse(result.stdout));
  } catch (error) {
    throw new ViblibError(
      `The installed skills tool returned an unsupported list format. It must be skills@1.5.22. ${error instanceof Error ? error.message : ""}`,
      { exitCode: 2 }
    );
  }
}

export async function discoverSkills(
  source: string,
  options: { cwd?: string; runner?: SkillsRunner } = {}
): Promise<{
  source: string;
  skills: { name: string; description?: string }[];
}> {
  const result = await runSkills(["add", source, "--list"], {
      cwd: options.cwd,
      runner: options.runner,
    }),
    output = stripVTControlCharacters(`${result.stdout}\n${result.stderr}`);
  if (result.code !== 0) {
    throw new ViblibError(
      `Could not discover skills from '${source}': ${output.trim()}`,
      { exitCode: 2 }
    );
  }
  const skills = parseDiscoveryOutput(output);
  if (skills.length === 0) {
    throw new ViblibError(
      "Could not parse the discovery output from skills@1.5.22. Update the parser for this skills version before continuing.",
      { exitCode: 2 }
    );
  }
  for (const skill of skills) {
    assertSafeSkillName(skill.name);
  }
  return {
    skills,
    source: await sourceForCatalog(source, options.cwd),
  };
}

export function parseDiscoveryOutput(
  output: string
): { name: string; description?: string }[] {
  const lines = stripVTControlCharacters(output).split(/\r?\n/),
    start = lines.findIndex((line) => /Available Skills\s*$/.test(line));
  if (start === -1) {
    return [];
  }

  const skills: { name: string; description?: string }[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/Use --skill|Run without --list/.test(line)) {
      break;
    }
    const bar = line.indexOf("│");
    if (bar === -1) {
      continue;
    }
    const content = line.slice(bar + 1),
      name = content.match(/^ {4}(\S.*)$/);
    if (name && !content.startsWith("      ")) {
      skills.push({ name: name[1].trim() });
      continue;
    }
    const description = content.match(/^ {6}(\S.*)$/),
      current = skills.at(-1);
    if (description && current) {
      const text = description[1].trim();
      if (!/^Files:\s+\d+$/.test(text)) {
        current.description = current.description
          ? `${current.description} ${text}`
          : text;
      }
    }
  }

  const names = new Set<string>();
  for (const skill of skills) {
    if (!skill.name || names.has(skill.name)) {
      return [];
    }
    names.add(skill.name);
  }
  return skills;
}
