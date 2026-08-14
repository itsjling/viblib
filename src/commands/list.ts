import { loadCatalog } from "../catalog/io.js";
import { normalizeCategory } from "../catalog/types.js";
import { ViblibError } from "../util/errors.js";

export interface ListOptions {
  category?: string;
  json?: boolean;
  plain?: boolean;
}

function groupsForSkill(
  categories: string[],
  selectedCategory: string | undefined
): string[] {
  if (selectedCategory) {
    return [selectedCategory];
  }
  if (categories.length > 0) {
    return categories;
  }
  return ["uncategorized"];
}

export async function runList(opts: ListOptions = {}): Promise<void> {
  if (opts.json && opts.plain) {
    throw new ViblibError("Use either --json or --plain, not both.");
  }
  const { catalog } = await loadCatalog(),
    category = opts.category ? normalizeCategory(opts.category) : undefined,
    entries = Object.entries(catalog.skills)
      .filter(([, skill]) => !category || skill.categories.includes(category))
      .toSorted(([left], [right]) => left.localeCompare(right));
  if (opts.json) {
    console.log(
      JSON.stringify({ skills: Object.fromEntries(entries) }, null, 2)
    );
    return;
  }
  if (opts.plain) {
    for (const [name] of entries) {
      console.log(name);
    }
    return;
  }
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const skillGroups = groupsForSkill(entry[1].categories, category);
    for (const group of skillGroups) {
      groups.set(group, [...(groups.get(group) ?? []), entry]);
    }
  }
  const groupsSorted = [...groups.entries()].toSorted(([left], [right]) => {
    if (left === "uncategorized") {
      return 1;
    }
    if (right === "uncategorized") {
      return -1;
    }
    return left.localeCompare(right);
  });
  for (const [group, skills] of groupsSorted) {
    console.log(group);
    for (const [, skill] of skills) {
      console.log(`  ${skill.skill} (${skill.source})`);
    }
  }
}
