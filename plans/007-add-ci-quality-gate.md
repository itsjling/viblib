# Plan 007: Run release-quality checks on every pull request and main push

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status row in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 414b6d9..HEAD -- .github/workflows/ci.yml package.json pnpm-lock.yaml`
> Plan 006 is expected to have changed `package.json`. Confirm that
> `test:cli-contract` exists. Any other material mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/006-test-built-cli-contract.md`
- **Category**: dx
- **Planned at**: commit `414b6d9`, 2026-08-14

## Why this matters

The package has working local checks but no tracked CI workflow. A pull request
or main-branch push can break typechecking, tests, formatting, lint, or the npm
artifact without an independent signal. Add one read-only GitHub Actions job
that uses the repository's pinned package manager and minimum supported Node
version, then runs the same gates used for release.

## Current state

- There is no `.github` directory or workflow at commit `414b6d9`.
- `package.json:37-43` defines `typecheck`, `test`, `check`, `prepack`, and
  `prepublishOnly`.
- `package.json:63-66` requires Node `>=22.20.0` and pins
  `pnpm@10.26.0`.
- `README.md:102-128` documents a fully manual release process.
- Plan 006 adds `test:cli-contract`, which builds and tests `dist/cli.mjs`.

The workflow must not publish, create tags/releases, write repository content,
or require secrets. Keep permissions at `contents: read`.

## Commands you will need

| Purpose         | Command                                                                | Expected on success           |
| --------------- | ---------------------------------------------------------------------- | ----------------------------- |
| YAML parse      | `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml")'` | exit 0                        |
| Frozen install  | `pnpm install --frozen-lockfile`                                       | exit 0; lockfile unchanged    |
| Typecheck       | `pnpm typecheck`                                                       | exit 0, no errors             |
| Source tests    | `pnpm test`                                                            | all source tests pass         |
| Quality         | `pnpm check`                                                           | exit 0                        |
| Built CLI       | `pnpm test:cli-contract`                                               | build and contract tests pass |
| Package preview | `pnpm pack --dry-run --json`                                           | exit 0; `dist/cli.mjs` listed |

## Scope

**In scope**:

- `.github/workflows/ci.yml` (create)
- `plans/README.md` for the status update

**Out of scope**:

- `package.json`, `pnpm-lock.yaml`, source, tests, and README.
- GitHub branch-protection settings.
- npm publishing, release creation, credentials, or provenance setup.
- Dependency upgrades or warning cleanup.
- A test matrix beyond the package's minimum supported Node version.

## Git workflow

- Branch: `advisor/007-add-ci-quality-gate`
- Commit message: `ci: add pull request quality gate`
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Create the least-privilege workflow

Create `.github/workflows/ci.yml` with:

- Name: `CI`.
- Triggers: `pull_request` and pushes to `main`.
- Top-level `permissions: contents: read`.
- One `quality` job on `ubuntu-latest`.
- A reasonable timeout, such as 15 minutes.
- `actions/checkout@v4`.
- `pnpm/action-setup@v4` with version `10.26.0`.
- `actions/setup-node@v4` with Node `22.20.0` and `cache: pnpm`.
- Separate named steps for frozen install, typecheck, source tests, quality
  checks, built CLI contract tests, and package preview.

Use the exact commands in the table above. Do not combine them into one opaque
shell step. Do not add write permissions, environment secrets, or release
events.

**Verify**:
`ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml")'` -> exit
0 and no syntax exception.

### Step 2: Reproduce every CI step locally

Run each command exactly as the workflow will. The frozen install must not edit
`pnpm-lock.yaml`. Existing lint warnings may remain because `pnpm check`
currently exits 0; changing that policy is outside this plan.

**Verify**:

- `pnpm install --frozen-lockfile` -> exit 0.
- `pnpm typecheck` -> exit 0.
- `pnpm test` -> exit 0.
- `pnpm check` -> exit 0.
- `pnpm test:cli-contract` -> exit 0.
- `pnpm pack --dry-run --json` -> exit 0 and includes `dist/cli.mjs`.
- `git diff --name-only` -> only `.github/workflows/ci.yml` and the plan index
  status change are listed.

### Step 3: Verify on GitHub after the branch is pushed

This is an operator-authorized step only. If the operator asks for a push or PR,
confirm the `quality` job starts and all named steps pass. If no push is
authorized, leave this verification pending in the PR handoff; do not expand
scope by pushing.

**Verify**:
GitHub Actions shows one successful `quality` job for the branch or pull request.

## Test plan

- CI itself is the test artifact; no source test file changes.
- Parse YAML locally, reproduce every command, then use one hosted Actions run
  when the operator authorizes a push.
- Confirm the workflow has read-only permissions and no secret references.

## Done criteria

- [ ] Pull requests and main pushes trigger the `quality` job.
- [ ] The job uses pnpm 10.26.0 and Node 22.20.0.
- [ ] Frozen install, typecheck, source tests, quality checks, built CLI tests,
      and package preview are separate visible steps.
- [ ] Workflow permissions are `contents: read` only.
- [ ] Local reproduction commands all exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] The Plan 007 row in `plans/README.md` is updated.

## STOP conditions

Stop and report if:

- Plan 006 has not landed or `pnpm test:cli-contract` is missing.
- `package.json` no longer pins the stated Node/pnpm versions.
- Frozen install wants to change `pnpm-lock.yaml`.
- The requested workflow needs write permissions, branch-protection changes,
  publishing credentials, or any secret.
- A hosted run fails because an action major is unavailable; verify the current
  official action release before changing versions.

## Maintenance notes

- Update CI and `package.json` together when raising the minimum Node or pinned
  pnpm version.
- This gate does not publish. Keep release authority in the manual process until
  a separate release-automation decision is made.
- If warning policy becomes strict later, change the local script first so CI
  and developer behavior remain the same.
