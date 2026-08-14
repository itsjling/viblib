import prompts from "prompts";

import { type CatalogSkill, normalizeInstallName } from "../catalog/types.js";
import { listInstalledSkills, type SkillsRunner } from "../skills/cli.js";
import { readUpstreamLock } from "../skills/lock.js";
import { normalizeSource } from "../skills/source.js";
import type { SkillScope } from "../skills/types.js";
import { ViblibError } from "../util/errors.js";
import {
  applyCatalogInstall,
  loadCatalogSkills,
  selectCatalogSkills,
  type InstallOptions,
} from "./install.js";

export interface SyncOptions extends Pick<
  InstallOptions,
  "global" | "category" | "skill" | "yes" | "cwd" | "runner"
> {
  check?: boolean;
}
export interface Drift {
  entry: CatalogSkill;
  status: "missing" | "changed";
}
interface DriftOptions {
  scope: SkillScope;
  cwd?: string;
  runner?: SkillsRunner;
}

function usesPresenceOnly(
  scope: SkillScope,
  sourceType: string | null,
  wantedType: string
): boolean {
  if (sourceType === "download") {
    return true;
  }
  return (
    scope === "global" && (sourceType === "local" || wantedType === "local")
  );
}

export async function getSyncDrift(
  entries: CatalogSkill[],
  options: DriftOptions
): Promise<Drift[]> {
  const installed = await listInstalledSkills(options),
    byName = new Map(
      installed.map((item) => [normalizeInstallName(item.name), item])
    ),
    drifts: Drift[] = [],
    tracked: {
      entry: CatalogSkill;
      installName: string;
      wanted: Awaited<ReturnType<typeof normalizeSource>>;
    }[] = [];
  for (const entry of entries) {
    const installName = normalizeInstallName(entry.skill),
      item = byName.get(installName);
    if (!item) {
      drifts.push({ entry, status: "missing" });
      continue;
    }
    const wanted = await normalizeSource(entry.source, options.cwd);
    if (usesPresenceOnly(options.scope, item.sourceType, wanted.type)) {
      continue;
    }
    tracked.push({ entry, installName, wanted });
  }

  if (tracked.length === 0) {
    return drifts;
  }
  const lock = await readUpstreamLock(options.scope, options.cwd);
  for (const { entry, installName, wanted } of tracked) {
    const lockEntry = lock[entry.skill] ?? lock[installName],
      trackedSource = lockEntry?.sourceUrl ?? lockEntry?.source;
    if (!trackedSource) {
      drifts.push({ entry, status: "changed" });
      continue;
    }
    const actual = await normalizeSource(trackedSource, options.cwd).catch(
        () => null
      ),
      actualRef = lockEntry?.ref ?? actual?.ref ?? null;
    if (
      !actual ||
      actual.source !== wanted.source ||
      actualRef !== wanted.ref
    ) {
      drifts.push({ entry, status: "changed" });
    }
  }
  return drifts;
}

export async function runSync(options: SyncOptions): Promise<void> {
  if (options.category?.length && options.skill?.length) {
    throw new ViblibError("Use either --category or --skill, not both.");
  }
  const scope: SkillScope = options.global ? "global" : "project";
  let drifts: Drift[];
  try {
    drifts = await getSyncDrift(
      selectCatalogSkills(await loadCatalogSkills(), options),
      { cwd: options.cwd, runner: options.runner, scope }
    );
  } catch (error) {
    if (error instanceof ViblibError) {
      throw error;
    }
    throw new ViblibError(
      `Could not check skill sync: ${error instanceof Error ? error.message : String(error)}`,
      { exitCode: 2 }
    );
  }
  if (drifts.length === 0) {
    console.log("Catalog skills are in sync.");
    return;
  }
  console.log(
    drifts.map((drift) => `${drift.status}: ${drift.entry.skill}`).join("\n")
  );
  const nonInteractive = !process.stdin.isTTY || !process.stdout.isTTY;
  if (options.check || (nonInteractive && !options.yes)) {
    throw new ViblibError(`${drifts.length} skill(s) need sync.`, {
      exitCode: 1,
    });
  }
  let selected = drifts.map((drift) => drift.entry);
  if (!options.yes) {
    const answer = await prompts({
      choices: [
        { title: "Apply all", value: "all" },
        { title: "Choose changes", value: "choose" },
        { title: "Do nothing", value: "none" },
      ],
      message: "Sync changes",
      name: "action",
      type: "select",
    });
    if (answer.action === "none" || !answer.action) {
      throw new ViblibError(`${drifts.length} skill(s) need sync.`, {
        exitCode: 1,
      });
    }
    if (answer.action === "choose") {
      const choice = await prompts({
        choices: drifts.map((drift) => ({
          title: `${drift.status}: ${drift.entry.skill}`,
          value: drift.entry.skill,
        })),
        message: "Choose skills",
        name: "skills",
        type: "multiselect",
      });
      selected = drifts
        .filter((drift) =>
          (choice.skills as string[] | undefined)?.includes(drift.entry.skill)
        )
        .map((drift) => drift.entry);
    }
  }
  let failedSources: string[] = [];
  if (selected.length > 0) {
    const result = await applyCatalogInstall(selected, {
      cwd: options.cwd,
      runner: options.runner,
      scope,
    });
    failedSources = result.failed;
  }
  const remaining = await getSyncDrift(
    selectCatalogSkills(await loadCatalogSkills(), options),
    { cwd: options.cwd, runner: options.runner, scope }
  );
  if (remaining.length > 0) {
    const failure = failedSources.length
      ? ` Failed sources: ${failedSources.join(", ")}.`
      : "";
    throw new ViblibError(
      `${remaining.length} skill(s) still need sync.${failure}`,
      { exitCode: 1 }
    );
  }
  console.log("Catalog skills are in sync.");
}
