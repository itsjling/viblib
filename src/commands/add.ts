import chalk from "chalk";
import prompts from "prompts";

import { loadCatalog, saveCatalog } from "../catalog/io.js";
import { normalizeCategory, normalizeInstallName } from "../catalog/types.js";
import { discoverSkills, type SkillsRunner } from "../skills/cli.js";
import {
  normalizeSource,
  sourceKey,
  splitSkillSelector,
} from "../skills/source.js";
import { ViblibError } from "../util/errors.js";

export interface AddOptions {
  skill?: string[];
  category?: string[];
  replace?: boolean;
  yes?: boolean;
  cwd?: string;
  runner?: SkillsRunner;
}

async function pickSkills(
  skills: { name: string; description?: string }[]
): Promise<string[]> {
  const answer = await prompts<{ skills?: string[] }>(
    {
      choices: skills.map((skill) => ({
        title: skill.description
          ? `${skill.name} — ${skill.description}`
          : skill.name,
        value: skill.name,
      })),
      message: "Select skills to add",
      name: "skills",
      type: "multiselect",
    },
    {
      onCancel: () => {
        throw new ViblibError("Aborted.");
      },
    }
  );
  return answer.skills ?? [];
}

async function resolveRequestedSkills(
  explicit: string[],
  discovered: { name: string; description?: string }[]
): Promise<string[]> {
  if (explicit.length === 0) {
    return pickSkills(discovered);
  }
  if (explicit.includes("*")) {
    return discovered.map(({ name }) => name);
  }
  return explicit;
}

export async function runAdd(
  source: string,
  opts: AddOptions = {}
): Promise<void> {
  if (!source.trim()) {
    throw new ViblibError("Source must not be empty.");
  }
  const inlineSelector = splitSkillSelector(source).skill;
  if (opts.yes && !opts.skill?.length && !inlineSelector) {
    throw new ViblibError("--yes requires --skill or --skill *.");
  }
  const discovered = await discoverSkills(source, {
      cwd: opts.cwd,
      runner: opts.runner,
    }),
    available = new Map<string, { name: string; description?: string }>();
  for (const skill of discovered.skills) {
    const key = normalizeInstallName(skill.name);
    if (available.has(key)) {
      throw new ViblibError(
        `The source contains more than one skill named '${key}' after normalization.`
      );
    }
    available.set(key, skill);
  }
  const explicit = [inlineSelector, ...(opts.skill ?? [])].filter(
      (name): name is string => Boolean(name)
    ),
    requested = await resolveRequestedSkills(explicit, discovered.skills),
    names = [...new Set(requested.map((name) => normalizeInstallName(name)))];
  if (!names.length) {
    return;
  }
  const selected = names
    .map((name) => available.get(name))
    .filter((skill): skill is { name: string; description?: string } =>
      Boolean(skill)
    );
  if (selected.length !== names.length) {
    throw new ViblibError(
      "One or more requested skills were not found in the source."
    );
  }
  const categories = [...new Set((opts.category ?? []).map(normalizeCategory))],
    { catalog, catalogPath } = await loadCatalog(),
    incomingSource = await normalizeSource(discovered.source, opts.cwd),
    collisions: { name: string }[] = [];
  for (const { name } of selected) {
    const current = catalog.skills[normalizeInstallName(name)];
    if (
      current &&
      sourceKey(await normalizeSource(current.source, opts.cwd)) !==
        sourceKey(incomingSource)
    ) {
      collisions.push({ name });
    }
  }
  if (collisions.length && !opts.replace) {
    throw new ViblibError(
      `Skills already belong to another source: ${collisions.map(({ name }) => name).join(", ")}. Use --replace to change them.`
    );
  }
  let changed = false;
  for (const { name } of selected) {
    const key = normalizeInstallName(name),
      current = catalog.skills[key],
      mergedCategories = [
        ...new Set([...(current?.categories ?? []), ...categories]),
      ],
      next = {
        categories: mergedCategories,
        skill: name,
        source: discovered.source,
      };
    if (
      !current ||
      current.skill !== next.skill ||
      current.source !== next.source ||
      current.categories.join("\0") !== next.categories.join("\0")
    ) {
      changed = true;
    }
    catalog.skills[key] = next;
  }
  if (changed) {
    await saveCatalog(catalog, catalogPath);
  }
  if (incomingSource.type === "local") {
    console.warn(
      "Local catalog sources depend on this machine's file layout and may not work elsewhere."
    );
  }
  console.log(
    chalk.green(
      `${changed ? "Added" : "Already cataloged"} ${selected.length} skill${selected.length === 1 ? "" : "s"}.`
    )
  );
}
