# viblib

`viblib` keeps your personal skill list and calls the pinned [`skills`](https://www.npmjs.com/package/skills) CLI for project or global installs. Use `npx skills` for one-off installs and updates.

Run it with `npx viblib`, or install it globally:

```sh
npm install --global viblib
```

Node.js 22.20.0 or newer is required.

## Catalog

The catalog lives at `~/.viblib/catalog.json`. Set `VIBLIB_HOME` to move it. Commands create the file on the first write, so there is no setup command.

```json
{
  "version": 1,
  "skills": {
    "my-skill": {
      "skill": "my-skill",
      "source": "owner/repo#main",
      "categories": ["frontend"]
    }
  }
}
```

The catalog stores source references, exact upstream skill names, and optional categories. It does not store skill files, fingerprints, or resolved versions. You may edit it by hand; each command checks the whole file before it acts.

## Use

```sh
# Add one skill, every skill from a source, or choose from a picker.
npx viblib add owner/repo@my-skill --category frontend
npx viblib add owner/repo --skill '*' --category frontend --yes
npx viblib add owner/repo

# Import skills from the old repository.
npx viblib add ~/.vibetools/repo/.agents/skills

# Browse and edit the catalog.
npx viblib list
npx viblib list --category frontend --plain
npx viblib category add work --skill my-skill
npx viblib category remove work --all --yes
npx viblib remove my-skill --yes

# Install or remove catalog skills in the current project.
npx viblib install --category frontend
npx viblib uninstall --skill my-skill

# Use the same commands for global installs.
npx viblib install --skill my-skill --global --agent codex
npx viblib uninstall --all --global
```

`--skill`, `--category`, and `--agent` may occur more than once. Skill and category selectors cannot be mixed in one command. Install and uninstall open a catalog picker when no selector is given. `--yes` needs an explicit selector. `--all` selects the whole catalog, targets all agents, and skips prompts. `--copy` asks `skills` to copy files instead of linking them.

`add`, `remove`, and `category` change only the catalog. `install` and `uninstall` change only installed skills. They use the current project by default; pass `--global` to use global scope.

## Sync

```sh
npx viblib sync
npx viblib sync --global
npx viblib sync --category frontend
npx viblib sync --check
npx viblib sync --yes
```

Sync checks the whole catalog by default. A selector limits the check. It reports:

- `missing`: the catalog skill is not installed in the chosen scope.
- `changed`: the skill is installed, but its `skills` lock entry is absent or its source or literal ref differs.

Some local and direct-download installs do not get an upstream lock. For those cases, sync checks presence only. It ignores extra skills, agents, link or copy mode, upstream changes on a floating ref, and local file edits.

In a terminal, sync shows the differences and lets you apply all, choose changes, or do nothing. `--yes` applies all differences. `--check` never writes. Without a terminal, plain sync acts like `--check` unless you pass `--yes`. After an apply, sync reads installed state and the lock again.

Exit code `0` means the selected catalog skills are in sync. Exit code `1` means drift remains or the command input or apply failed. Exit code `2` means the check could not finish, such as when installed state or a lock file could not be read.

To fetch upstream changes, use `npx skills update`. This does not change the catalog because the catalog has no resolved version data.

## Commands

```text
viblib add <source> [--skill <name>]... [--category <name>]... [--replace] [-y]
viblib remove [skills...] [--skill <name>]... [--all] [-y]
viblib list [--category <name>] [--json | --plain]
viblib category add <category> [--skill <name>]...
viblib category remove <category> [--skill <name>]... [--all] [-y]
viblib category list [--json]
viblib install [-g] [--category <name>]... [--skill <name>]... [-a <agent>]... [--copy] [-y] [--all]
viblib uninstall [-g] [--category <name>]... [--skill <name>]... [-a <agent>]... [-y] [--all]
viblib sync [-g] [--category <name>]... [--skill <name>]... [--check] [-y]
```

The wrapped `skills` process keeps its own telemetry behavior. Set `DISABLE_TELEMETRY=1` to turn it off.
