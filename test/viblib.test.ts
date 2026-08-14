import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadCatalog,
  saveCatalog,
  validateCatalog,
} from "../src/catalog/io.js";
import {
  emptyCatalog,
  normalizeCategory,
  normalizeInstallName,
} from "../src/catalog/types.js";
import { createProgram } from "../src/cli.js";
import { runAdd } from "../src/commands/add.js";
import { runInstall, selectCatalogSkills } from "../src/commands/install.js";
import { runSync } from "../src/commands/sync.js";
import { runUninstall } from "../src/commands/uninstall.js";
import {
  discoverSkills,
  parseDiscoveryOutput,
  type SkillsRunner,
} from "../src/skills/cli.js";
import { ViblibError } from "../src/util/errors.js";
import { makeTempDir, rmTempDir, writeFile } from "./helpers.js";

const DISCOVERY_OUTPUT = `
│
◇  Available Skills
│
│    Foo Skill
│
│      A useful skill.
│
└  Use --skill <name> to install specific skills
`;

let temporaryHome = "",
  logSpy: ReturnType<typeof vi.spyOn>,
  warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  temporaryHome = await makeTempDir();
  process.env.VIBLIB_HOME = temporaryHome;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  delete process.env.VIBLIB_HOME;
  delete process.env.XDG_STATE_HOME;
  logSpy.mockRestore();
  warnSpy.mockRestore();
  await rmTempDir(temporaryHome);
});

const success = (stdout = ""): Awaited<ReturnType<SkillsRunner>> => ({
  code: 0,
  stderr: "",
  stdout,
});

async function seedCatalog(
  skills: Parameters<typeof saveCatalog>[0]["skills"]
): Promise<void> {
  await saveCatalog({ skills, version: 1 });
}

function installedJson(
  name: string,
  sourceType: string | null = "github"
): string {
  return JSON.stringify([
    {
      agents: ["Codex"],
      name,
      path: path.join(temporaryHome, name),
      scope: "project",
      source: "owner/repo",
      sourceType,
      sourceUrl: "https://github.com/owner/repo.git",
    },
  ]);
}

describe("catalog storage", () => {
  it("uses an empty catalog when no catalog file exists", async () => {
    await expect(loadCatalog()).resolves.toMatchObject({
      catalog: emptyCatalog(),
    });
  });

  it("matches skills name normalization and category kebab case", () => {
    expect(normalizeInstallName("  Foo BAR!!!  ")).toBe("foo-bar");
    expect(normalizeInstallName("a".repeat(300))).toHaveLength(255);
    expect(() => normalizeInstallName("!!!")).toThrow();
    expect(normalizeCategory(" Front_End.docs ")).toBe("front-end-docs");
  });

  it("refuses malformed catalogs without rewriting them", async () => {
    const catalogPath = path.join(temporaryHome, "catalog.json"),
      malformed = '{"version":1,"skills":[],"extra":true}';
    await writeFile(catalogPath, malformed);

    await expect(loadCatalog()).rejects.toThrow("Invalid catalog at $");
    await expect(fs.readFile(catalogPath, "utf8")).resolves.toBe(malformed);
  });

  it("writes canonical sorted storage atomically", async () => {
    const catalogPath = path.join(temporaryHome, "catalog.json");
    await seedCatalog({
      alpha: {
        categories: ["docs"],
        skill: "alpha",
        source: "owner/alpha",
      },
      zebra: {
        categories: ["work", "frontend"],
        skill: "zebra",
        source: "owner/zebra",
      },
    });

    const parsed = JSON.parse(await fs.readFile(catalogPath, "utf8"));
    expect(Object.keys(parsed.skills)).toEqual(["alpha", "zebra"]);
    expect(parsed.skills.zebra.categories).toEqual(["frontend", "work"]);
    expect((await fs.readdir(temporaryHome)).toSorted()).toEqual([
      "catalog.json",
    ]);
  });

  it("requires normalized keys, categories, and exact fields", () => {
    expect(() =>
      validateCatalog({
        skills: {
          "my-skill": {
            categories: ["Work"],
            skill: "My Skill",
            source: "owner/repo",
          },
        },
        version: 1,
      })
    ).toThrow('skills."my-skill".categories[0]');
  });
});

describe("catalog commands", () => {
  const discoveryRunner: SkillsRunner = async () => success(DISCOVERY_OUTPUT);

  it("adds explicit skills, normalizes categories, and stores inline selectors as sources", async () => {
    await runAdd("owner/repo@Foo Skill", {
      category: ["Front_End"],
      runner: discoveryRunner,
      yes: true,
    });

    await expect(loadCatalog()).resolves.toMatchObject({
      catalog: {
        skills: {
          "foo-skill": {
            categories: ["front-end"],
            skill: "Foo Skill",
            source: "owner/repo",
          },
        },
      },
    });
  });

  it("blocks source collisions unless replace is explicit and keeps categories", async () => {
    await runAdd("owner/repo", {
      category: ["frontend"],
      runner: discoveryRunner,
      skill: ["Foo Skill"],
      yes: true,
    });
    await expect(
      runAdd("other/repo", {
        runner: discoveryRunner,
        skill: ["Foo Skill"],
        yes: true,
      })
    ).rejects.toThrow("another source");

    await runAdd("other/repo", {
      category: ["backend"],
      replace: true,
      runner: discoveryRunner,
      skill: ["Foo Skill"],
      yes: true,
    });
    const { catalog } = await loadCatalog();
    expect(catalog.skills["foo-skill"]).toEqual({
      categories: ["backend", "frontend"],
      skill: "Foo Skill",
      source: "other/repo",
    });
  });
});

describe("pinned skills adapter", () => {
  it("parses only the pinned Available Skills section", () => {
    expect(
      parseDiscoveryOutput(`noise\n${DISCOVERY_OUTPUT}\nmore noise`)
    ).toEqual([{ description: "A useful skill.", name: "Foo Skill" }]);
  });

  it("uses add --list for discovery and fails closed on changed output", async () => {
    const calls: string[][] = [],
      runner: SkillsRunner = async (args) => {
        calls.push(args);
        return success(DISCOVERY_OUTPUT);
      };
    await expect(
      discoverSkills("owner/repo", { runner })
    ).resolves.toMatchObject({
      skills: [{ name: "Foo Skill" }],
      source: "owner/repo",
    });
    expect(calls).toEqual([["add", "owner/repo", "--list"]]);

    await expect(
      discoverSkills("owner/repo", { runner: async () => success("changed") })
    ).rejects.toThrow("skills@1.5.22");
  });
});

describe("install and uninstall", () => {
  beforeEach(async () => {
    await seedCatalog({
      "foo-skill": {
        categories: ["front-end"],
        skill: "Foo Skill",
        source: "owner/repo",
      },
    });
  });

  it("normalizes selectors and rejects category-skill combinations", async () => {
    const entries = (await loadCatalog()).catalog.skills;
    expect(
      selectCatalogSkills(Object.values(entries), { skill: ["FOO SKILL"] })
    ).toHaveLength(1);
    expect(() =>
      selectCatalogSkills(Object.values(entries), {
        category: ["frontend"],
        skill: ["foo-skill"],
      })
    ).toThrow("either --category or --skill");
  });

  it("preflights then forwards exact add flags through the pinned adapter", async () => {
    const calls: string[][] = [],
      runner: SkillsRunner = async (args) => {
        calls.push(args);
        return args[0] === "list" ? success("[]") : success();
      };

    await runInstall({
      agent: ["codex"],
      copy: true,
      global: true,
      runner,
      skill: ["foo-skill"],
      yes: true,
    });

    expect(calls).toEqual([
      ["list", "--json", "--global"],
      [
        "add",
        "owner/repo",
        "--skill",
        "Foo Skill",
        "--yes",
        "--global",
        "--copy",
        "--agent",
        "codex",
      ],
    ]);
  });

  it("expands uninstall --all to catalog names and all agents", async () => {
    const calls: string[][] = [];
    await runUninstall({
      all: true,
      global: true,
      runner: async (args) => {
        calls.push(args);
        return success();
      },
    });
    expect(calls).toEqual([
      ["remove", "foo-skill", "--yes", "--global", "--agent", "*"],
    ]);
  });

  it("continues through later sources after one install source fails", async () => {
    await seedCatalog({
      alpha: {
        categories: [],
        skill: "alpha",
        source: "first/repo",
      },
      beta: {
        categories: [],
        skill: "beta",
        source: "second/repo",
      },
    });
    const calls: string[][] = [];
    const result = runInstall({
      runner: async (args) => {
        calls.push(args);
        if (args[0] === "list") return success("[]");
        return {
          code: args[1] === "first/repo" ? 1 : 0,
          stderr: "",
          stdout: "",
        };
      },
      skill: ["*"],
      yes: true,
    });

    await expect(result).rejects.toThrow("Other sources were still attempted");
    expect(calls.filter(([command]) => command === "add")).toHaveLength(2);
  });
});

describe("sync", () => {
  beforeEach(async () => {
    await seedCatalog({
      "foo-skill": {
        categories: ["frontend"],
        skill: "Foo Skill",
        source: "owner/repo#main",
      },
    });
  });

  it("reports missing and changed entries with exit code 1", async () => {
    const cwd = path.join(temporaryHome, "changed-project"),
      missingRunner: SkillsRunner = async () => success("[]"),
      missing = runSync({ check: true, cwd, runner: missingRunner });
    await expect(missing).rejects.toMatchObject({ exitCode: 1 });

    await writeFile(
      path.join(cwd, "skills-lock.json"),
      JSON.stringify({
        skills: {
          "foo-skill": { ref: "old", source: "owner/repo" },
        },
        version: 1,
      })
    );
    const changed = runSync({
      check: true,
      cwd,
      runner: async () => success(installedJson("Foo Skill")),
    });
    await expect(changed).rejects.toMatchObject({ exitCode: 1 });
  });

  it("accepts matching source and literal ref", async () => {
    const cwd = path.join(temporaryHome, "project");
    await writeFile(
      path.join(cwd, "skills-lock.json"),
      JSON.stringify({
        skills: {
          "foo-skill": { ref: "main", source: "owner/repo" },
        },
        version: 1,
      })
    );
    await expect(
      runSync({
        check: true,
        cwd,
        runner: async () => success(installedJson("Foo Skill")),
      })
    ).resolves.toBeUndefined();
  });

  it("uses presence-only checks for global local installs", async () => {
    await seedCatalog({
      local: {
        categories: [],
        skill: "local",
        source: path.join(temporaryHome, "local-source"),
      },
    });
    process.env.XDG_STATE_HOME = path.join(temporaryHome, "state");
    await writeFile(
      path.join(temporaryHome, "state", "skills", ".skill-lock.json"),
      "not-json"
    );
    await expect(
      runSync({
        check: true,
        global: true,
        runner: async () => success(installedJson("local", "local")),
      })
    ).resolves.toBeUndefined();
  });

  it("returns exit code 2 when a lock cannot be checked", async () => {
    const cwd = path.join(temporaryHome, "broken-project");
    await writeFile(path.join(cwd, "skills-lock.json"), "not-json");
    const result = runSync({
      check: true,
      cwd,
      runner: async () => success(installedJson("Foo Skill")),
    });
    await expect(result).rejects.toBeInstanceOf(ViblibError);
    await expect(result).rejects.toMatchObject({ exitCode: 2 });
  });

  it("applies drift and checks installed state again", async () => {
    const cwd = path.join(temporaryHome, "apply-project");
    let installed = false;
    const calls: string[][] = [];
    const runner: SkillsRunner = async (args) => {
      calls.push(args);
      if (args[0] === "list")
        return success(installed ? installedJson("Foo Skill") : "[]");
      installed = true;
      await writeFile(
        path.join(cwd, "skills-lock.json"),
        JSON.stringify({
          skills: {
            "foo-skill": { ref: "main", source: "owner/repo" },
          },
          version: 1,
        })
      );
      return success();
    };

    await expect(runSync({ cwd, runner, yes: true })).resolves.toBeUndefined();
    expect(calls.map(([command]) => command)).toEqual(["list", "add", "list"]);
  });
});

describe("CLI surface", () => {
  it("exposes only catalog and skills wrapper commands", () => {
    const program = createProgram();
    expect(program.commands.map((command) => command.name())).toEqual([
      "add",
      "remove",
      "list",
      "category",
      "install",
      "uninstall",
      "sync",
    ]);
    expect(
      program.commands
        .find((command) => command.name() === "category")
        ?.commands.map((command) => command.name())
    ).toEqual(["add", "remove", "list"]);
  });
});
