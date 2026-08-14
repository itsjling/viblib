import prompts from "prompts";

import { type CatalogSkill, normalizeInstallName } from "../catalog/types.js";
import { runSkills } from "../skills/cli.js";
import { ViblibError } from "../util/errors.js";
import {
  loadCatalogSkills,
  selectCatalogSkills,
  type InstallOptions,
} from "./install.js";

export type UninstallOptions = Pick<
  InstallOptions,
  "global" | "category" | "skill" | "agent" | "yes" | "all" | "cwd" | "runner"
>;

async function pickInstalledSkills(
  entries: CatalogSkill[]
): Promise<CatalogSkill[]> {
  const answer = await prompts<{ skills?: string[] }>(
    {
      choices: entries.map((entry) => ({
        title: `${entry.skill} (${entry.source})`,
        value: normalizeInstallName(entry.skill),
      })),
      message: "Select skills to uninstall",
      name: "skills",
      type: "multiselect",
    },
    {
      onCancel: () => {
        throw new ViblibError("Aborted.");
      },
    }
  );
  const names = new Set(answer.skills);
  return entries.filter((entry) =>
    names.has(normalizeInstallName(entry.skill))
  );
}

async function confirmUninstall(count: number): Promise<void> {
  const answer = await prompts(
    {
      initial: false,
      message: `Remove ${count} installed skill(s)?`,
      name: "ok",
      type: "confirm",
    },
    {
      onCancel: () => {
        throw new ViblibError("Aborted.");
      },
    }
  );
  if (!answer.ok) throw new ViblibError("Removal cancelled.");
}

export async function runUninstall(
  options: UninstallOptions = {}
): Promise<void> {
  const selectsEverything = options.all || options.skill?.includes("*");
  const effectiveOptions = options.all
    ? Object.assign({}, options, { agent: ["*"], yes: true })
    : options;
  const hasSelector = Boolean(
    selectsEverything ||
    effectiveOptions.category?.length ||
    effectiveOptions.skill?.length
  );
  if (effectiveOptions.yes && !hasSelector)
    throw new ViblibError("--yes needs --category, --skill, or --all.");

  const entries = await loadCatalogSkills();
  if (entries.length === 0)
    throw new ViblibError("No catalog skills are available.");
  const selected = hasSelector
    ? selectCatalogSkills(entries, effectiveOptions)
    : await pickInstalledSkills(entries);
  if (selected.length === 0) throw new ViblibError("No skills selected.");

  console.log(
    `Uninstall plan (${effectiveOptions.global ? "global" : "project"}):\n${selected
      .map((entry) => `  remove: ${entry.skill}`)
      .join("\n")}`
  );
  if (!effectiveOptions.yes) await confirmUninstall(selected.length);

  const args = [
    "remove",
    ...selected.map((entry) => normalizeInstallName(entry.skill)),
    "--yes",
    ...(effectiveOptions.global ? ["--global"] : []),
    ...(effectiveOptions.agent?.length
      ? ["--agent", ...effectiveOptions.agent]
      : []),
  ];
  const result = await runSkills(args, {
    cwd: effectiveOptions.cwd,
    inherit: true,
    runner: effectiveOptions.runner,
  });
  if (result.code !== 0)
    throw new ViblibError("Could not remove one or more selected skills.");
  console.log(`Removed ${selected.length} selected skill(s).`);
}
