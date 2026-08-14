import chalk from "chalk";
import prompts from "prompts";

import { loadCatalog, saveCatalog } from "../catalog/io.js";
import { normalizeInstallName } from "../catalog/types.js";
import { ViblibError } from "../util/errors.js";

export interface RemoveOptions {
  skill?: string[];
  all?: boolean;
  yes?: boolean;
}

async function pick(names: string[]): Promise<string[]> {
  const result = await prompts<{ skills?: string[] }>(
    {
      choices: names.map((name) => ({ title: name, value: name })),
      message: "Select skills to remove",
      name: "skills",
      type: "multiselect",
    },
    {
      onCancel: () => {
        throw new ViblibError("Aborted.");
      },
    }
  );
  return result.skills ?? [];
}

async function confirm(): Promise<void> {
  const result = await prompts<{ ok?: boolean }>(
    {
      initial: false,
      message: "Remove selected catalog entries?",
      name: "ok",
      type: "confirm",
    },
    {
      onCancel: () => {
        throw new ViblibError("Aborted.");
      },
    }
  );
  if (!result.ok) {
    throw new ViblibError("Aborted.");
  }
}

async function resolveRemovalSelection(
  all: boolean,
  explicit: string[],
  available: string[]
): Promise<string[]> {
  if (all) {
    return available;
  }
  if (explicit.length > 0) {
    return explicit.map(normalizeInstallName);
  }
  return pick(available);
}

export async function runRemove(
  names: string[] = [],
  opts: RemoveOptions = {}
): Promise<void> {
  const { catalog, catalogPath } = await loadCatalog(),
    explicit = [...names, ...(opts.skill ?? [])];
  if (opts.yes && !opts.all && !explicit.length) {
    throw new ViblibError("--yes requires a skill selector or --all.");
  }
  const selected = [
    ...new Set(
      await resolveRemovalSelection(
        Boolean(opts.all),
        explicit,
        Object.keys(catalog.skills)
      )
    ),
  ];
  if (!selected.length) {
    return;
  }
  const missing = selected.filter((name) => !catalog.skills[name]);
  if (missing.length) {
    throw new ViblibError(`Skills not found: ${missing.join(", ")}.`);
  }
  if (!opts.yes) {
    await confirm();
  }
  const selectedSet = new Set(selected);
  catalog.skills = Object.fromEntries(
    Object.entries(catalog.skills).filter(([name]) => !selectedSet.has(name))
  );
  await saveCatalog(catalog, catalogPath);
  console.log(
    chalk.green(
      `Removed ${selected.length} skill${selected.length === 1 ? "" : "s"}.`
    )
  );
}
