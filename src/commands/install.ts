import prompts from "prompts";

import { loadCatalog } from "../catalog/io.js";
import {
  type CatalogSkill,
  assertSafeSkillName,
  normalizeCategory,
  normalizeInstallName,
} from "../catalog/types.js";
import {
  listInstalledSkills,
  runSkills,
  type SkillsRunner,
} from "../skills/cli.js";
import { sourceForInvocation } from "../skills/source.js";
import type { SkillScope } from "../skills/types.js";
import { ViblibError } from "../util/errors.js";

export interface InstallOptions {
  global?: boolean;
  category?: string[];
  skill?: string[];
  agent?: string[];
  copy?: boolean;
  yes?: boolean;
  all?: boolean;
  cwd?: string;
  runner?: SkillsRunner;
}

const abort = (): never => {
  throw new ViblibError("Aborted.");
};

export async function loadCatalogSkills(): Promise<CatalogSkill[]> {
  const { catalog } = await loadCatalog();
  return Object.values(catalog.skills);
}

function assertKnownSelectors(
  entries: CatalogSkill[],
  categories: Set<string>,
  skills: Set<string>
): void {
  const knownSkills = new Set(
      entries.map((entry) => normalizeInstallName(entry.skill))
    ),
    knownCategories = new Set(entries.flatMap((entry) => entry.categories)),
    missingSkills = [...skills].filter((name) => !knownSkills.has(name)),
    missingCategories = [...categories].filter(
      (category) => !knownCategories.has(category)
    );
  if (missingSkills.length > 0) {
    throw new ViblibError(
      `Catalog skills not found: ${missingSkills.join(", ")}.`
    );
  }
  if (missingCategories.length > 0) {
    throw new ViblibError(
      `Catalog categories not found: ${missingCategories.join(", ")}.`
    );
  }
}

export function selectCatalogSkills(
  entries: CatalogSkill[],
  options: Pick<InstallOptions, "category" | "skill" | "all">
): CatalogSkill[] {
  if (options.category?.length && options.skill?.length) {
    throw new ViblibError("Use either --category or --skill, not both.");
  }
  if (options.all || options.skill?.includes("*")) {
    return entries;
  }
  if (!options.category?.length && !options.skill?.length) {
    return entries;
  }

  const categories = new Set(
      (options.category ?? []).map((category) => normalizeCategory(category))
    ),
    skills = new Set(
      (options.skill ?? []).map((skill) => normalizeInstallName(skill))
    );
  assertKnownSelectors(entries, categories, skills);
  return entries.filter(
    (entry) =>
      skills.has(normalizeInstallName(entry.skill)) ||
      entry.categories.some((category) => categories.has(category))
  );
}

async function pickCatalogSkills(
  entries: CatalogSkill[],
  message: string
): Promise<CatalogSkill[]> {
  const answer = await prompts<{ skills?: string[] }>(
      {
        choices: entries.map((entry) => ({
          title: `${entry.skill} (${entry.source})`,
          value: normalizeInstallName(entry.skill),
        })),
        message,
        name: "skills",
        type: "multiselect",
      },
      { onCancel: abort }
    ),
    selected = new Set(answer.skills);
  return entries.filter((entry) =>
    selected.has(normalizeInstallName(entry.skill))
  );
}

async function confirmPlan(message: string): Promise<void> {
  const answer = await prompts<{ ok?: boolean }>(
    { initial: true, message, name: "ok", type: "confirm" },
    { onCancel: abort }
  );
  if (!answer.ok) {
    abort();
  }
}

export async function applyCatalogInstall(
  entries: CatalogSkill[],
  options: {
    scope: SkillScope;
    agent?: string[];
    copy?: boolean;
    cwd?: string;
    runner?: SkillsRunner;
  }
): Promise<{ failed: string[]; installed: number }> {
  for (const entry of entries) {
    assertSafeSkillName(entry.skill);
  }
  const grouped = new Map<string, CatalogSkill[]>();
  for (const entry of entries) {
    grouped.set(entry.source, [...(grouped.get(entry.source) ?? []), entry]);
  }

  const failed: string[] = [];
  let installed = 0;
  for (const [source, group] of grouped) {
    console.log(`\n${source}`);
    const args = [
        "add",
        await sourceForInvocation(source, options.cwd),
        "--skill",
        ...group.map((entry) => entry.skill),
        "--yes",
        ...(options.scope === "global" ? ["--global"] : []),
        ...(options.copy ? ["--copy"] : []),
        ...(options.agent?.length ? ["--agent", ...options.agent] : []),
      ],
      result = await runSkills(args, {
        cwd: options.cwd,
        inherit: true,
        runner: options.runner,
      });
    if (result.code === 0) {
      installed += group.length;
    } else {
      failed.push(source);
    }
  }
  return { failed, installed };
}

export async function runInstall(options: InstallOptions = {}): Promise<void> {
  const selectsEverything = options.all || options.skill?.includes("*");
  const effectiveOptions = options.all
    ? Object.assign({}, options, { agent: ["*"], yes: true })
    : options;
  const hasSelector = Boolean(
    selectsEverything ||
    effectiveOptions.category?.length ||
    effectiveOptions.skill?.length
  );
  if (effectiveOptions.yes && !hasSelector) {
    throw new ViblibError("--yes needs --category, --skill, or --all.");
  }

  const entries = await loadCatalogSkills();
  if (entries.length === 0) {
    throw new ViblibError("No catalog skills are available.");
  }
  const selected = hasSelector
    ? selectCatalogSkills(entries, effectiveOptions)
    : await pickCatalogSkills(entries, "Select skills to install");
  if (selected.length === 0) {
    throw new ViblibError("No skills selected.");
  }

  const scope: SkillScope = effectiveOptions.global ? "global" : "project",
    installed = await listInstalledSkills({
      cwd: effectiveOptions.cwd,
      runner: effectiveOptions.runner,
      scope,
    }),
    installedNames = new Set(
      installed.map((entry) => normalizeInstallName(entry.name))
    );
  console.log(`Install plan (${scope}):`);
  for (const entry of selected) {
    const action = installedNames.has(normalizeInstallName(entry.skill))
      ? "replace or refresh"
      : "install";
    console.log(`  ${action}: ${entry.skill} (${entry.source})`);
  }
  if (!effectiveOptions.yes) {
    await confirmPlan(`Apply ${selected.length} change(s)?`);
  }

  const result = await applyCatalogInstall(selected, {
    agent: effectiveOptions.agent,
    copy: effectiveOptions.copy,
    cwd: effectiveOptions.cwd,
    runner: effectiveOptions.runner,
    scope,
  });
  console.log(
    `\nInstalled ${result.installed}/${selected.length} selected skill(s).`
  );
  if (result.failed.length > 0) {
    throw new ViblibError(
      `Failed sources: ${result.failed.join(", ")}. Other sources were still attempted.`
    );
  }
}
