# Plan 001: Reject option-like skill names before invoking `skills`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status row in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 414b6d9..HEAD -- src/catalog/types.ts src/catalog/io.ts src/skills/cli.ts src/commands/install.ts test/viblib.test.ts`
> If an in-scope file changed, compare the excerpts below with the live code.
> Any material mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `414b6d9`, 2026-08-14

## Why this matters

`viblib` passes exact upstream skill names to a pinned command-line parser.
That parser treats a dash-prefixed value after `--skill` as another option, not
as a skill name. A source can therefore advertise a name that changes install
scope or selects more skills than the user chose. Reject such names at the
discovery, catalog, and process boundaries before they can reach `skills`.

## Current state

- `src/catalog/types.ts` owns install-name normalization.
- `src/catalog/io.ts` validates hand-edited catalog files.
- `src/skills/cli.ts` parses names from the external discovery output.
- `src/commands/install.ts` builds the final `skills add` argument vector.
- `test/viblib.test.ts` uses injected `SkillsRunner` functions to inspect exact
  child-process arguments without running the real tool.

Current catalog validation checks content and normalized keys but not option
syntax (`src/catalog/io.ts:65-93`):

```ts
if (
  typeof value.skill !== "string" ||
  !value.skill.trim() ||
  hasControlCharacters(value.skill)
) {
  invalid(`${field}.skill`, "expected a non-empty string.");
}
// ...
normalizedName = normalizeInstallName(value.skill);
```

Installation then forwards the exact display name (`src/commands/install.ts:143-152`):

```ts
const args = [
  "add",
  await sourceForInvocation(source, options.cwd),
  "--skill",
  ...group.map((entry) => entry.skill),
  "--yes",
  // ...
];
```

The pinned `skills@1.5.22` parser consumes values after `--skill` only while
they do not start with `-`. Keep the dependency pinned; this plan hardens
`viblib` against that documented local behavior rather than changing upstream.

Match the existing error convention: throw `ViblibError` for user-facing
contract failures, and make catalog failures name the field without repeating
the unsafe value. Model tests on the injected runners around
`test/viblib.test.ts:211-228` and `test/viblib.test.ts:255-285`.

## Commands you will need

| Purpose       | Command                                                     | Expected on success                |
| ------------- | ----------------------------------------------------------- | ---------------------------------- |
| Install       | `pnpm install --frozen-lockfile`                            | exit 0; `pnpm-lock.yaml` unchanged |
| Focused tests | `pnpm exec vitest run test/viblib.test.ts -t "option-like"` | new regression tests pass          |
| Typecheck     | `pnpm typecheck`                                            | exit 0, no errors                  |
| Full tests    | `pnpm test`                                                 | all tests pass                     |
| Quality       | `pnpm check`                                                | exit 0                             |

## Scope

**In scope** (the only source and test files to modify):

- `src/catalog/types.ts`
- `src/catalog/io.ts`
- `src/skills/cli.ts`
- `src/commands/install.ts`
- `test/viblib.test.ts`
- `plans/README.md` for the status update

**Out of scope**:

- `src/skills/source.ts`; source URL safety belongs to Plan 003.
- `src/cli.ts`; do not change viblib's own option definitions.
- The `skills` dependency or its bundled parser.
- Catalog schema/version changes or automatic catalog rewrites.
- Selector behavior for `--skill '*'`; `*` is a viblib selector and must not
  become a stored skill name.

## Git workflow

- Branch: `advisor/001-reject-option-like-skill-names`
- Use focused conventional commits, for example
  `fix(install): reject option-like skill names`.
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Define one safe-name assertion

In `src/catalog/types.ts`, add an exported assertion with an explicit `void`
return type. It must reject a raw skill name whose first character is `-` and
throw a `ViblibError` that explains that option-like names cannot be passed to
the pinned installer. Keep `normalizeInstallName` unchanged; normalized catalog
keys and raw process arguments serve different purposes.

Do not introduce a broad new naming grammar. Spaces and case in upstream
display names currently work and must keep working.

**Verify**:
`pnpm typecheck` -> exit 0.

### Step 2: Enforce the assertion at all three trust boundaries

1. In `src/skills/cli.ts`, assert every parsed discovery name before
   `discoverSkills` returns it. Unsafe discovery output must fail closed.
2. In `src/catalog/io.ts`, call the assertion while validating `value.skill`.
   Convert its failure into the existing field-based `invalid(...)` error so a
   hand-edited catalog cannot bypass the rule and the message does not include
   the unsafe value.
3. In `applyCatalogInstall` in `src/commands/install.ts`, assert every entry
   before printing its source or constructing any arguments. This is the last
   guard for direct in-memory callers.

Do not quote or shell-escape the value as a substitute. `spawn` already uses
`shell: false`; the defect is option parsing inside the child process.

**Verify**:
`pnpm typecheck` -> exit 0.

### Step 3: Add regression tests

Extend `test/viblib.test.ts` with tests whose titles contain `option-like`:

1. Discovery output with a dash-prefixed skill row is rejected rather than
   returned.
2. `validateCatalog` rejects an otherwise well-formed entry whose raw skill is
   dash-prefixed and whose key matches the current normalization result.
3. A direct `applyCatalogInstall` call with such an entry rejects before its
   runner is called.
4. The existing multiword `Foo Skill` case still forwards the exact display
   name after `--skill`.

Use a synthetic name only. Do not include any source credentials in fixtures.

**Verify**:
`pnpm exec vitest run test/viblib.test.ts -t "option-like"` -> all selected
tests pass and the runner-call assertion remains zero for the rejection case.

### Step 4: Run the full repository gates

Run each command separately so the failing gate is clear.

**Verify**:

- `pnpm typecheck` -> exit 0.
- `pnpm test` -> all tests pass.
- `pnpm check` -> exit 0.
- `git diff --name-only` -> only the files in this plan's scope are listed.

## Test plan

- Put all new tests in `test/viblib.test.ts` beside the catalog-validation,
  discovery-parser, and install-adapter suites they exercise.
- Cover discovery, hand-edited catalog input, direct install invocation, and a
  normal-name regression.
- Assert both the thrown error type/message class and the absence of runner
  calls. The key security property is that the child parser never sees the
  unsafe value.

## Done criteria

- [ ] Dash-prefixed discovery names fail before catalog mutation.
- [ ] Dash-prefixed names in hand-edited catalogs fail validation without the
      raw name appearing in the error.
- [ ] `applyCatalogInstall` refuses unsafe in-memory entries before logging or
      invoking its runner.
- [ ] Normal multiword names retain their exact child-process argument shape.
- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm check` exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] The Plan 001 row in `plans/README.md` is updated.

## STOP conditions

Stop and report if:

- `skills@1.5.22` in the lockfile no longer matches the parser behavior stated
  above.
- A documented, legitimate existing catalog contains a dash-prefixed skill
  name and the project needs a migration policy.
- Preventing option parsing requires changing the upstream package or adding a
  delimiter that its pinned parser does not support.
- The fix requires changing selector semantics or source parsing.
- An in-scope excerpt has materially changed since `414b6d9`.

## Maintenance notes

- Review this assertion whenever the pinned `skills` version changes; its
  option parser is the contract being defended.
- Keep the install-side assertion even if discovery and catalog validation
  appear sufficient. It protects direct callers and future import paths.
- Do not broaden this task into a general skill-name cleanup. New naming rules
  need compatibility tests and a separate plan.
