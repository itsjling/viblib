# Plan 006: Test the built command-line artifact that npm publishes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status row in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 414b6d9..HEAD -- package.json tsconfig.json vitest.config.ts vitest.cli.config.ts test/cli-contract.test.ts`
> New files may not exist yet. Compare changed existing files with the excerpts
> below. A material mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `414b6d9`, 2026-08-14

## Why this matters

The current tests import TypeScript source functions. npm users execute only
`dist/cli.mjs`, so a broken bundle, shebang, command registration, flag contract,
or process exit code can pass all tests and ship. Add a separate black-box suite
that builds the package, starts the exact published file, and runs without
network access or the real `skills` process.

## Current state

- `package.json:21-25` publishes only the built bin:

```json
"bin": { "viblib": "dist/cli.mjs" },
"files": ["dist"]
```

- `tsdown.config.ts:4-12` builds `src/cli.ts` to ESM in `dist` with a Node
  shebang.
- `vitest.config.ts:3-9` includes every `test/**/*.test.ts` file.
- `test/viblib.test.ts:449-466` checks command names through `createProgram`,
  but never starts `dist/cli.mjs`.
- `package.json:42-43` builds in `prepack`, while `prepublishOnly` checks source
  before that build.

Keep the fast source suite separate from the built-artifact suite. Use a second
Vitest config so `pnpm test` works on a clean checkout without requiring `dist`,
while `pnpm test:cli-contract` always builds first.

## Commands you will need

| Purpose         | Command                          | Expected on success                              |
| --------------- | -------------------------------- | ------------------------------------------------ |
| Install         | `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged                       |
| Build contract  | `pnpm test:cli-contract`         | build succeeds; black-box cases pass             |
| Source tests    | `pnpm test`                      | source suite passes without contract duplication |
| Typecheck       | `pnpm typecheck`                 | exit 0, no errors                                |
| Quality         | `pnpm check`                     | exit 0                                           |
| Package preview | `pnpm pack --dry-run --json`     | exit 0; output lists `dist/cli.mjs`              |

## Scope

**In scope**:

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `vitest.cli.config.ts` (create)
- `test/cli-contract.test.ts` (create)
- `plans/README.md` for the status update

**Out of scope**:

- Production command code. If the suite exposes a real defect, stop and report
  it instead of changing production behavior in this plan.
- `test/helpers.ts`; import its existing temporary-directory helpers without
  changing them, and keep the child-process harness local to the contract test.
- GitHub Actions; Plan 007 adds CI after this script exists.
- npm publishing, release automation, network calls, or real skill installs.
- Snapshot tests or platform-specific shell scripts.

## Git workflow

- Branch: `advisor/006-test-built-cli-contract`
- Commit message: `test(cli): exercise published binary`
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Separate source and built-artifact Vitest configs

Update `vitest.config.ts` to exclude `test/cli-contract.test.ts` while retaining
its current environment, include, reporter, and silent settings.

Create `vitest.cli.config.ts` with the same Node environment and reporter style,
but include only `test/cli-contract.test.ts`. Do not import the production
Vitest config if doing so makes config merging implicit; a short explicit config
is easier to audit. Add `vitest.cli.config.ts` to the `include` array in
`tsconfig.json` beside the existing `vitest.config.ts`; do not replace the
explicit include list with a broad repository glob.

**Verify**:

- `pnpm test` -> the existing source suite passes and does not list
  `cli-contract.test.ts`.
- `pnpm typecheck` -> exit 0 with both Vitest configs included.

### Step 2: Add a reusable child-process test harness

Create `test/cli-contract.test.ts`. Use `node:child_process` with
`process.execPath` and absolute `dist/cli.mjs`; never use a shell. For each run:

- Use `makeTempDir`/`rmTempDir` from `test/helpers.ts`.
- Set `VIBLIB_HOME` to the test-owned directory.
- Set `NO_COLOR=1`.
- Use a controlled temporary `cwd`.
- Capture stdout, stderr, and numeric exit code.
- Inherit the rest of `process.env` without changing the parent process.
- Add a timeout and reject on process-spawn errors.

Keep the child-process helper local to the new file. Cleanup must run in
`finally` or `afterEach` even when an assertion fails.

**Verify**:
`pnpm typecheck` -> exit 0.

### Step 3: Cover the published CLI contract

Add black-box cases for:

1. `--version`: exit 0 and exact `package.json` version.
2. `--help`: exit 0; includes the app description and all seven top-level
   commands.
3. `category --help`: exit 0; includes `add`, `remove`, and `list`.
4. Empty-home `list --json`: exit 0 and parsed output equals
   `{ skills: {} }`.
5. Seeded catalog `list --plain`: exit 0 and exact sorted output for `alpha` and
   `zebra`.
6. `list --json --plain`: exit 1, no normal output, and the existing conflict
   message on stderr.

Seed only the documented catalog v1 shape. None of these commands may invoke
the pinned `skills` runner or access the network.

**Verify**:
After a manual `pnpm build`, run
`pnpm exec vitest run --config vitest.cli.config.ts` -> all six cases pass.

### Step 4: Add a package script and release gate

In `package.json`, add:

```json
"test:cli-contract": "pnpm build && vitest run --config vitest.cli.config.ts"
```

Append `pnpm test:cli-contract` to `prepublishOnly` after typecheck, source tests,
and `pnpm check`. Keep `prepack: pnpm build`; a publish may rebuild once more,
which is safer than testing a stale artifact. Let the repository formatter keep
script keys in its configured order.

**Verify**:
`pnpm test:cli-contract` -> build exits 0 and all contract cases pass.

### Step 5: Run package and repository gates

**Verify**:

- `pnpm typecheck` -> exit 0.
- `pnpm test` -> source tests pass; contract suite is excluded.
- `pnpm check` -> exit 0.
- `pnpm test:cli-contract` -> all black-box cases pass.
- `pnpm pack --dry-run --json` -> output contains `dist/cli.mjs` and the bin path
  remains `dist/cli.mjs`.
- `git diff --name-only` -> only this plan's in-scope files are listed.

## Test plan

- Use real Node subprocesses against the built file, not imports from `src`.
- Isolate home and cwd for every case.
- Cover success output, help registration, catalog output, sorting, validation
  errors, and exit codes.
- Keep all cases offline and deterministic.

## Done criteria

- [ ] `pnpm test:cli-contract` builds and tests `dist/cli.mjs`.
- [ ] Source tests remain runnable without a pre-existing `dist` directory.
- [ ] Six black-box contract cases pass with isolated state.
- [ ] `prepublishOnly` includes the built-artifact contract gate.
- [ ] Package preview includes the expected executable bin.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm check`, and
      `pnpm test:cli-contract` exit 0.
- [ ] No out-of-scope files are modified.
- [ ] The Plan 006 row in `plans/README.md` is updated.

## STOP conditions

Stop and report if:

- The build output is no longer `dist/cli.mjs`.
- A contract case requires the network or a real `skills` invocation.
- The new test finds a production CLI defect; report it as a separate fix.
- Adding the release gate creates a lifecycle loop between `prepublishOnly`,
  `prepack`, build, and tests.
- The separate config requires broad TypeScript/test-runner changes.

## Maintenance notes

- Add a black-box case when changing command names, flags, output formats, or
  exit-code policy.
- Keep source-level tests for branch detail; the subprocess suite protects the
  published boundary.
- Plan 007 depends on this script and will run it in CI.
