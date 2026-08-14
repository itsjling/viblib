# Plan 009: Document selector and confirmation rules per command

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status row in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 414b6d9..HEAD -- README.md src/cli.ts src/commands/add.ts src/commands/remove.ts src/commands/category.ts src/commands/install.ts src/commands/uninstall.ts src/commands/sync.ts`
> Source files are reference-only and must not be modified. If their selector
> rules changed, or the target README paragraph no longer exists, stop and
> report.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `414b6d9`, 2026-08-14

## Why this matters

The README applies one broad selector rule to commands that use flags in
different ways. It says skill and category cannot be mixed even though `add`
uses both together, and it says `--yes` always needs a selector even though
`sync --yes` intentionally applies all drift. Replace the broad statement with
short command-specific rules that match current help and code.

## Current state

The examples already show valid combinations (`README.md:34-57`), including:

```sh
npx viblib add owner/repo@my-skill --category frontend
npx viblib sync --yes
```

The next paragraph contradicts them (`README.md:59`):

```text
Skill and category selectors cannot be mixed in one command. ...
`--yes` needs an explicit selector. `--all` selects the whole catalog,
targets all agents, and skips prompts.
```

The live rules to document are:

- `add`: `--skill` selects upstream skills and `--category` tags them, so they
  may be combined. `--yes` needs `--skill`, `--skill '*'`, or an inline source
  selector.
- `remove`: positional names and repeated `--skill` both select catalog entries.
  `--yes` needs one of those or `--all`.
- `category add`: selects skills interactively or with repeated `--skill`; it
  has no `--yes` option.
- `category remove`: `--yes` needs `--skill` or `--all`; here `--all` means all
  skills currently in that category.
- `install` and `uninstall`: `--category` and `--skill` cannot be mixed. A
  selector, `--skill '*'`, or `--all` enables noninteractive use. `--all` also
  targets every agent and skips prompts.
- `sync`: `--category` and `--skill` cannot be mixed, but `--yes` needs no
  selector and applies every detected drift in the chosen scope. `--check`
  never writes.

Do not infer new behavior from option names. Confirm each statement against
`src/commands/*.ts` and live `--help` before editing.

## Commands you will need

| Purpose               | Command                           | Expected on success                 |
| --------------------- | --------------------------------- | ----------------------------------- |
| Add help              | `pnpm dev add --help`             | exit 0; documented add flags appear |
| Remove help           | `pnpm dev remove --help`          | exit 0                              |
| Category help         | `pnpm dev category add --help`    | exit 0; no `--yes` flag             |
| Category removal help | `pnpm dev category remove --help` | exit 0                              |
| Install help          | `pnpm dev install --help`         | exit 0                              |
| Uninstall help        | `pnpm dev uninstall --help`       | exit 0                              |
| Sync help             | `pnpm dev sync --help`            | exit 0                              |
| Tests                 | `pnpm test`                       | all tests pass                      |
| Quality               | `pnpm check`                      | exit 0                              |

## Scope

**In scope**:

- `README.md`
- `plans/README.md` for the status update

**Reference-only; do not modify**:

- `src/cli.ts`
- `src/commands/add.ts`
- `src/commands/remove.ts`
- `src/commands/category.ts`
- `src/commands/install.ts`
- `src/commands/uninstall.ts`
- `src/commands/sync.ts`

**Out of scope**:

- Changing CLI behavior, help strings, examples that already work, tests, or
  the release section.
- Adding new flags or resolving naming preferences.
- Running any example that needs a real catalog, source, or network access.

## Git workflow

- Branch: `advisor/009-document-selector-rules`
- Commit message: `docs: clarify selector and confirmation rules`
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Verify the live command surface

Run every help command from the command table. Compare flags with
`src/cli.ts:34-187` and the command-level validation listed under Current state.
Help alone does not express every cross-flag rule, so both sources are required.

**Verify**:
All seven help commands exit 0, and `category add --help` contains no `--yes`.

### Step 2: Replace the broad paragraph with command-specific guidance

Keep the existing examples. Replace `README.md:59` with a short subsection or
list titled `Selectors and confirmation`:

1. State once that `--skill`, `--category`, and `--agent` may be repeated where
   a command supports them.
2. Give one concise bullet for `add`.
3. Give one for catalog mutation commands (`remove`, `category add`, and
   `category remove`) while preserving their distinct `--all`/`--yes` meanings.
4. Give one for `install`/`uninstall`, including selector exclusivity and the
   all-agent meaning of `--all`.
5. Give one for `sync`, including selector exclusivity, selector-free `--yes`,
   and read-only `--check`.

Retain the next paragraph's distinction between catalog mutation and installed
skill mutation. Do not duplicate the full command synopsis at `README.md:86-98`.

**Verify**:

- `rg -n "Selectors and confirmation|sync.*--yes|category remove|install.*uninstall" README.md`
  -> matches the new guidance.
- `git diff -- README.md` -> examples, sync exit codes, and release instructions
  are unchanged except where needed to remove the contradiction.

### Step 3: Run documentation and repository checks

**Verify**:

- Re-run every help command -> exit 0.
- `pnpm test` -> all tests pass.
- `pnpm check` -> exit 0.
- `git diff --name-only` -> only `README.md` and the plan index status change are
  listed.

## Test plan

- No new automated source test is needed for prose-only work.
- Verify each documented flag against live help and each cross-flag rule against
  its command implementation.
- Do not execute networked examples.

## Done criteria

- [ ] README clearly allows `add --skill` with `--category`.
- [ ] `--yes` requirements are stated separately for add, catalog mutation,
      install/uninstall, and sync.
- [ ] `--all` means all agents only where install/uninstall implement it.
- [ ] README states that `sync --yes` may run without a selector and that
      `sync --check` never writes.
- [ ] Existing examples and command synopsis remain accurate.
- [ ] `pnpm test` and `pnpm check` exit 0.
- [ ] No source or other out-of-scope file is modified.
- [ ] The Plan 009 row in `plans/README.md` is updated.

## STOP conditions

Stop and report if:

- Live help or command code no longer matches the rules under Current state.
- Accurate documentation requires a CLI behavior change.
- An example requires a real catalog, remote source, or network call to verify.
- The target README section has been substantially rewritten since `414b6d9`.

## Maintenance notes

- Update this subsection whenever selector validation changes.
- Keep command-specific rules near the usage examples; the synopsis alone does
  not explain cross-flag behavior.
- Avoid restoring one broad `--yes` or `--all` rule across commands with
  different semantics.
