import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import chalk from "chalk";
import { Command } from "commander";

import packageMetadata from "../package.json";
import { runAdd } from "./commands/add.js";
import {
  runCategoryAdd,
  runCategoryList,
  runCategoryRemove,
} from "./commands/category.js";
import { runInstall } from "./commands/install.js";
import { runList } from "./commands/list.js";
import { runRemove } from "./commands/remove.js";
import { runSync } from "./commands/sync.js";
import { runUninstall } from "./commands/uninstall.js";
import { ViblibError } from "./util/errors.js";

const collectValues = (value: string, previous: string[]): string[] => [
  ...previous,
  value,
];

export function createProgram(): Command {
  const program = new Command();

  program
    .name("viblib")
    .description("Manage a personal skill catalog and install its skills.")
    .version(packageMetadata.version);

  program
    .command("add <source>")
    .description("Add a skill source to the catalog.")
    .option(
      "--skill <name>",
      "Install name; repeat to add more skills.",
      collectValues,
      []
    )
    .option(
      "--category <name>",
      "Category; repeat to add more.",
      collectValues,
      []
    )
    .option("--replace", "Replace an existing catalog entry.")
    .option("-y, --yes", "Skip confirmation prompts.")
    .action(async (source: string, options) => await runAdd(source, options));

  program
    .command("remove [skills...]")
    .description("Remove skills from the catalog.")
    .option(
      "--skill <name>",
      "Skill name; repeat to remove more.",
      collectValues,
      []
    )
    .option("--all", "Remove every catalog entry.")
    .option("-y, --yes", "Skip confirmation prompts.")
    .action(
      async (skills: string[], options) => await runRemove(skills, options)
    );

  program
    .command("list")
    .description("List catalog skills.")
    .option("--category <name>", "Only show this category.")
    .option("--json", "Print JSON.")
    .option("--plain", "Print one skill name per line.")
    .action(async (options) => await runList(options));

  const category = program
    .command("category")
    .description("Manage skill categories.");

  category
    .command("add <category>")
    .description("Add a category to skills.")
    .option(
      "--skill <name>",
      "Skill name; repeat to select more.",
      collectValues,
      []
    )
    .action(
      async (categoryName: string, options) =>
        await runCategoryAdd(categoryName, options)
    );

  category
    .command("remove <category>")
    .description("Remove a category from skills.")
    .option(
      "--skill <name>",
      "Skill name; repeat to select more.",
      collectValues,
      []
    )
    .option("--all", "Apply to every catalog skill.")
    .option("-y, --yes", "Skip confirmation prompts.")
    .action(
      async (categoryName: string, options) =>
        await runCategoryRemove(categoryName, options)
    );

  category
    .command("list")
    .description("List catalog categories.")
    .option("--json", "Print JSON.")
    .action(async (options) => await runCategoryList(options));

  program
    .command("install")
    .description("Install catalog skills through skills.")
    .option("-g, --global", "Install globally instead of in this project.")
    .option(
      "--category <name>",
      "Category; repeat to select more.",
      collectValues,
      []
    )
    .option(
      "--skill <name>",
      "Skill name; repeat to select more.",
      collectValues,
      []
    )
    .option(
      "-a, --agent <name>",
      "Agent; repeat to select more.",
      collectValues,
      []
    )
    .option("--copy", "Copy instead of linking when supported.")
    .option("-y, --yes", "Skip confirmation prompts.")
    .option("--all", "Select every catalog skill.")
    .action(async (options) => await runInstall(options));

  program
    .command("uninstall")
    .description("Uninstall catalog skills through skills.")
    .option("-g, --global", "Remove from global scope instead of this project.")
    .option(
      "--category <name>",
      "Category; repeat to select more.",
      collectValues,
      []
    )
    .option(
      "--skill <name>",
      "Skill name; repeat to select more.",
      collectValues,
      []
    )
    .option(
      "-a, --agent <name>",
      "Agent; repeat to select more.",
      collectValues,
      []
    )
    .option("-y, --yes", "Skip confirmation prompts.")
    .option("--all", "Select every catalog skill.")
    .action(async (options) => await runUninstall(options));

  program
    .command("sync")
    .description("Check or restore installed skills to match the catalog.")
    .option("-g, --global", "Use global scope instead of this project.")
    .option(
      "--category <name>",
      "Category; repeat to select more.",
      collectValues,
      []
    )
    .option(
      "--skill <name>",
      "Skill name; repeat to select more.",
      collectValues,
      []
    )
    .option("--check", "Report differences without changing anything.")
    .option("-y, --yes", "Skip confirmation prompts.")
    .action(async (options) => await runSync(options));

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((error: unknown) => {
    const viblibError = ViblibError.fromUnknown(error);
    console.error(chalk.red(viblibError.message));
    process.exitCode = viblibError.exitCode;
  });
}
