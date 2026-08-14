# Plan 002: Detect source-subpath drift during sync

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status row in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 414b6d9..HEAD -- src/skills/types.ts src/commands/sync.ts test/viblib.test.ts`
> Compare changed in-scope code with the excerpts below. A material mismatch is
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `414b6d9`, 2026-08-14

## Why this matters

The catalog can select a directory inside a repository, but sync compares only
the repository URL and ref. An installation from `skills/old` can therefore be
reported as current when the catalog now points at `skills/new`. Use the pinned
lock entry's `skillPath` to prove that the installed skill lies under the
catalog's requested subpath.

## Current state

- `src/skills/source.ts` already normalizes source subpaths and includes them in
  `sourceKey`; its grammar is not part of this plan.
- `src/skills/types.ts` models the upstream lock fields consumed by sync, but it
  omits the pinned lock's optional `skillPath` field (`src/skills/types.ts:20-25`):

```ts
export interface UpstreamLockEntry {
  source?: string;
  sourceUrl?: string;
  sourceType?: string;
  ref?: string;
}
```

- `src/commands/sync.ts` compares only normalized repository and ref
  (`src/commands/sync.ts:77-94`):

```ts
const lockEntry = lock[entry.skill] ?? lock[installName],
  trackedSource = lockEntry?.sourceUrl ?? lockEntry?.source;
// ...
if (!actual || actual.source !== wanted.source || actualRef !== wanted.ref) {
  drifts.push({ entry, status: "changed" });
}
```

The pinned `skills@1.5.22` project and global lock writers store a repository-
relative `skillPath`, usually ending in `SKILL.md`. The lock's `source` or
`sourceUrl` normally identifies the repository, so normalizing that field alone
does not recover the selected subpath. Do not compare `actual.subpath` with
`wanted.subpath`; that would mark valid subpath installs as changed because the
lock source usually has no subpath.

Follow the existing sync tests at `test/viblib.test.ts:346-387`: write a real
temporary `skills-lock.json`, inject installed-list JSON, then assert exit code
or successful completion.

## Commands you will need

| Purpose       | Command                                                 | Expected on success        |
| ------------- | ------------------------------------------------------- | -------------------------- |
| Install       | `pnpm install --frozen-lockfile`                        | exit 0; lockfile unchanged |
| Focused tests | `pnpm exec vitest run test/viblib.test.ts -t "subpath"` | new sync cases pass        |
| Typecheck     | `pnpm typecheck`                                        | exit 0, no errors          |
| Full tests    | `pnpm test`                                             | all tests pass             |
| Quality       | `pnpm check`                                            | exit 0                     |

## Scope

**In scope**:

- `src/skills/types.ts`
- `src/commands/sync.ts`
- `test/viblib.test.ts`
- `plans/README.md` for the status update

**Out of scope**:

- `src/skills/source.ts`; do not change accepted source grammar.
- `src/skills/lock.ts`; keep its existing file lookup and error semantics.
- Hash/content comparison, agents, copy/link mode, and upstream floating-ref
  updates, which the README explicitly says sync ignores.
- Lock schema migrations or changes to the pinned `skills` package.
- Presence-only behavior for downloads and global local sources.

## Git workflow

- Branch: `advisor/002-compare-sync-source-subpaths`
- Commit message: `fix(sync): compare installed source subpaths`
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Model the pinned lock field

Add `skillPath?: string` to `UpstreamLockEntry` in `src/skills/types.ts`. Do not
make it required: old, malformed, and some source-specific lock entries may omit
it, and sync must treat the omission according to the requested source.

**Verify**:
`pnpm typecheck` -> exit 0.

### Step 2: Add a pure subpath-match helper

In `src/commands/sync.ts`, add a private helper with this contract:

- If `wanted.subpath` is `null`, return `true`; a repository-root catalog
  source may select a nested skill by name.
- If a subpath is requested but `skillPath` is missing or empty, return `false`
  because sync cannot prove the installed location.
- Convert backslashes to `/`, normalize with `path.posix.normalize`, and reject
  absolute or parent-escaping lock paths as non-matches.
- Return `true` only when the normalized lock path equals the requested
  subpath or starts with `${wantedSubpath}/`. This segment boundary prevents
  `skills/foo-old` from matching `skills/foo`.

Import `node:path` specifically for POSIX path handling. The helper should not
read the filesystem.

**Verify**:
`pnpm typecheck` -> exit 0.

### Step 3: Include the helper in the drift predicate

Extend the existing `changed` condition in `getSyncDrift` so repository, ref,
and requested subpath must all match. Pass `wanted.subpath` and
`lockEntry?.skillPath` to the new helper. Preserve the current early return for
presence-only source types and the current handling of a missing lock source.

Do not derive the installed path from `InstalledSkill.path`; that path points at
the destination, not the upstream repository location.

**Verify**:
`pnpm typecheck` -> exit 0.

### Step 4: Add subpath regression tests

Add four cases to the `sync` suite in `test/viblib.test.ts`:

1. Same repository/ref and a `skillPath` under the requested subpath resolves
   with no drift.
2. Same repository/ref but a `skillPath` under a different subpath rejects with
   `exitCode: 1` in check mode.
3. A requested subpath with no `skillPath` rejects with `exitCode: 1`.
4. A catalog source with no requested subpath remains in sync when the lock's
   `skillPath` is nested.

Use a supported shorthand such as `owner/repo/skills/foo#main` for the catalog,
and lock paths such as `skills/foo/SKILL.md`. Keep the current installed-list
runner and temporary lock-file pattern.

**Verify**:
`pnpm exec vitest run test/viblib.test.ts -t "subpath"` -> all four new cases
pass.

### Step 5: Run the full repository gates

**Verify**:

- `pnpm typecheck` -> exit 0.
- `pnpm test` -> all tests, including existing presence-only cases, pass.
- `pnpm check` -> exit 0.
- `git diff --name-only` -> only this plan's in-scope files are listed.

## Test plan

- Place tests beside the existing sync lock-file tests.
- Test positive, negative, missing-data, and root-source compatibility cases.
- Retain the existing malformed-lock, matching-ref, global-local, and recheck
  tests unchanged. They guard the branches most likely to regress.

## Done criteria

- [ ] `UpstreamLockEntry` models optional `skillPath`.
- [ ] A changed repository subpath produces `changed` drift and exit code 1.
- [ ] A matching subpath produces no drift.
- [ ] Missing `skillPath` fails closed only when the catalog requested a
      subpath.
- [ ] Repository-root catalog entries preserve current behavior.
- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm check` exit 0.
- [ ] No out-of-scope files are modified.
- [ ] The Plan 002 row in `plans/README.md` is updated.

## STOP conditions

Stop and report if:

- The installed `skills` version is no longer `1.5.22` or its lock writer no
  longer records repository-relative `skillPath` values.
- A real lock fixture shows that `skillPath` has different semantics from those
  stated above.
- Matching the source requires fetching a repository or reading installed skill
  contents.
- The proposed comparison changes the documented presence-only cases.
- An in-scope excerpt has materially changed since `414b6d9`.

## Maintenance notes

- Re-check `skillPath` semantics whenever the pinned `skills` version changes.
- Keep path comparison POSIX-based because upstream serializes repository paths
  with `/` on every platform.
- Do not turn this into content-hash sync. The catalog does not store resolved
  versions or fingerprints.
