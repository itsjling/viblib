import chalk from "chalk";
import prompts from "prompts";

import { loadCatalog, saveCatalog } from "../catalog/io.js";
import { normalizeCategory, normalizeInstallName } from "../catalog/types.js";
import { ViblibError } from "../util/errors.js";

export interface CategoryOptions {
  skill?: string[];
  all?: boolean;
  yes?: boolean;
  json?: boolean;
}

async function selectSkills(
  names: string[],
  message: string
): Promise<string[]> {
  const result = await prompts<{ skills?: string[] }>(
    {
      choices: names.map((name) => ({ title: name, value: name })),
      message,
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

async function confirm(message: string): Promise<void> {
  const result = await prompts<{ ok?: boolean }>(
    { initial: false, message, name: "ok", type: "confirm" },
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

function resolveSelected(
  explicit: string[] | undefined,
  available: string[]
): string[] {
  return explicit?.length ? explicit.map(normalizeInstallName) : available;
}

async function chooseCategorySkills(
  explicit: string[] | undefined,
  available: string[],
  message: string
): Promise<string[]> {
  if (explicit?.length) {
    return resolveSelected(explicit, []);
  }
  return selectSkills(available, message);
}

async function chooseCategoryRemovalSkills(
  opts: CategoryOptions,
  matching: string[]
): Promise<string[]> {
  if (opts.all) {
    return matching;
  }
  return chooseCategorySkills(
    opts.skill,
    matching,
    "Select skills to remove from this category"
  );
}

export async function runCategoryAdd(
  categoryInput: string,
  opts: CategoryOptions = {}
): Promise<void> {
  const category = normalizeCategory(categoryInput);
  if (opts.yes && !opts.skill?.length) {
    throw new ViblibError("--yes requires --skill.");
  }
  const { catalog, catalogPath } = await loadCatalog(),
    selected = await chooseCategorySkills(
      opts.skill,
      Object.keys(catalog.skills),
      "Select skills to categorize"
    );
  if (!selected.length) {
    return;
  }
  const missing = selected.filter((name) => !catalog.skills[name]);
  if (missing.length) {
    throw new ViblibError(`Skills not found: ${missing.join(", ")}.`);
  }
  let changed = false;
  for (const name of selected) {
    const skill = catalog.skills[name];
    if (!skill.categories.includes(category)) {
      skill.categories.push(category);
      changed = true;
    }
  }
  if (changed) {
    await saveCatalog(catalog, catalogPath);
  }
  console.log(
    chalk.green(
      `${changed ? "Added" : "Category already applied to"} ${selected.length} skill${selected.length === 1 ? "" : "s"}.`
    )
  );
}

export async function runCategoryRemove(
  categoryInput: string,
  opts: CategoryOptions = {}
): Promise<void> {
  const category = normalizeCategory(categoryInput),
    { catalog, catalogPath } = await loadCatalog(),
    matching = Object.entries(catalog.skills)
      .filter(([, skill]) => skill.categories.includes(category))
      .map(([name]) => name);
  if (opts.yes && !opts.all && !opts.skill?.length) {
    throw new ViblibError("--yes requires --skill or --all.");
  }
  const selected = await chooseCategoryRemovalSkills(opts, matching);
  if (!selected.length) {
    return;
  }
  const invalid = selected.filter(
    (name) =>
      !catalog.skills[name] ||
      !catalog.skills[name].categories.includes(category)
  );
  if (invalid.length) {
    throw new ViblibError(
      `Skills are not in category '${category}': ${invalid.join(", ")}.`
    );
  }
  if (!opts.yes) {
    await confirm(`Remove category '${category}' from selected skills?`);
  }
  for (const name of selected) {
    catalog.skills[name].categories = catalog.skills[name].categories.filter(
      (item) => item !== category
    );
  }
  await saveCatalog(catalog, catalogPath);
  console.log(
    chalk.green(
      `Removed category from ${selected.length} skill${selected.length === 1 ? "" : "s"}.`
    )
  );
}

export async function runCategoryList(
  opts: CategoryOptions = {}
): Promise<void> {
  const { catalog } = await loadCatalog(),
    selected = opts.skill?.length
      ? resolveSelected(opts.skill, [])
      : Object.keys(catalog.skills),
    missing = selected.filter((name) => !catalog.skills[name]);
  if (missing.length) {
    throw new ViblibError(`Skills not found: ${missing.join(", ")}.`);
  }
  const categories = new Map<string, string[]>();
  for (const name of selected) {
    for (const category of catalog.skills[name].categories) {
      categories.set(category, [...(categories.get(category) ?? []), name]);
    }
  }
  const result = Object.fromEntries(
    [...categories.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([category, names]) => [
        category,
        names.toSorted((a, b) => a.localeCompare(b)),
      ])
  );
  if (opts.json) {
    console.log(JSON.stringify({ categories: result }, null, 2));
    return;
  }
  for (const [category, names] of Object.entries(result)) {
    console.log(`${category}: ${names.join(", ")}`);
  }
}
