# Plan 004: Serialize catalog updates so concurrent commands cannot lose data

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status row in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 414b6d9..HEAD -- src/catalog/io.ts src/commands/add.ts src/commands/remove.ts src/commands/category.ts test/viblib.test.ts`
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

Catalog writes use an atomic rename, so one file is never half-written. They do
not protect the read-change-write sequence. Two commands can read the same
catalog, make separate valid changes, and let the last rename discard the first
change. Put every catalog mutation behind one bounded cross-process lock and
reload the catalog only after acquiring it.

## Current state

- `src/catalog/io.ts` owns catalog paths, validation, reads, and atomic writes.
- `src/commands/add.ts`, `remove.ts`, and `category.ts` are the only catalog
  mutation commands.
- `install`, `uninstall`, `list`, and `sync` read catalog state but do not alter
  it.

The atomic primitive writes a temporary file then renames it
(`src/catalog/io.ts:171-188`):

```ts
await fs.writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
await fs.rename(temporary, target);
```

The command-level sequence remains unlocked. For example,
`src/commands/add.ts:103-145` loads, mutates, and saves later:

```ts
const { catalog, catalogPath } = await loadCatalog();
// collision checks and mutations
if (changed) {
  await saveCatalog(catalog, catalogPath);
}
```

Match the existing storage rules: catalog and temporary files remain private,
validation stays strict, and writes remain canonical and atomic. Keep network
discovery and user prompts outside the critical section so one paused command
does not block all catalog edits.

## Commands you will need

| Purpose       | Command                                                      | Expected on success                |
| ------------- | ------------------------------------------------------------ | ---------------------------------- |
| Install       | `pnpm install --frozen-lockfile`                             | exit 0; lockfile unchanged         |
| Focused tests | `pnpm exec vitest run test/viblib.test.ts -t "catalog lock"` | concurrency and cleanup cases pass |
| Typecheck     | `pnpm typecheck`                                             | exit 0, no errors                  |
| Full tests    | `pnpm test`                                                  | all tests pass                     |
| Quality       | `pnpm check`                                                 | exit 0                             |

## Scope

**In scope**:

- `src/catalog/io.ts`
- `src/commands/add.ts`
- `src/commands/remove.ts`
- `src/commands/category.ts`
- `test/viblib.test.ts`
- `plans/README.md` for the status update

**Out of scope**:

- Locking read-only commands or reads.
- Cross-machine or network locking.
- Catalog schema/version changes.
- New runtime dependencies.
- Automatic stale-lock deletion. Unsafe lock stealing can reintroduce the data
  loss this plan prevents.
- Changes to prompts, command output, source discovery, or selection policy.

## Git workflow

- Branch: `advisor/004-serialize-catalog-updates`
- Commit message: `fix(catalog): serialize concurrent updates`
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Add a bounded exclusive-lock primitive

In `src/catalog/io.ts`, add private constants for a short retry interval and a
bounded wait deadline. Add an async lock helper with this behavior:

1. Ensure the catalog directory exists.
2. Attempt to create `${catalogPath}.lock` with `fs.open(lockPath, "wx", 0o600)`.
   Exclusive creation is the cross-process ownership operation.
3. If creation fails with `EEXIST`, wait for the fixed interval and retry until
   the deadline. Then throw `ViblibError` with a clear "catalog is busy" message
   and the lock path. Tell the user to confirm no viblib process is active before
   manually removing an abandoned lock.
4. Write non-sensitive diagnostic metadata such as PID and creation time to the
   owned handle. Do not put catalog content or source values in the lock.
5. Return an async release function that closes the owned handle and removes the
   lock file. Call it only from `finally`.

Do not automatically delete a lock merely because its timestamp is old. Without
an atomic ownership check, that can delete another process's live lock.

**Verify**:
`pnpm typecheck` -> exit 0.

### Step 2: Add one transactional catalog-update API

In `src/catalog/io.ts`, add an exported generic helper with an explicit contract
like this:

```ts
interface CatalogUpdate<T> {
  changed: boolean;
  result: T;
}

export async function updateCatalog<T>(
  mutator: (catalog: Catalog) => Promise<CatalogUpdate<T>> | CatalogUpdate<T>
): Promise<T>;
```

Implementation order must be: acquire lock, call `loadCatalog`, call the
mutator, call `saveCatalog` only when `changed` is true, return `result`, and
release in `finally`. Keep `saveCatalog` exported for existing storage tests and
test seeding, but document in code that commands must use `updateCatalog` for
read-change-write operations.

**Verify**:
`pnpm typecheck` -> exit 0.

### Step 3: Convert every catalog mutation command

Update the four mutation flows:

- `runAdd`: finish discovery and skill selection first. Inside `updateCatalog`,
  re-run collision checks against the freshly loaded catalog, merge categories,
  and return whether anything changed. Preserve `--replace` behavior and output.
- `runRemove`: use an initial read only for the picker. Confirm with the user,
  then inside `updateCatalog` revalidate that every selected entry still exists
  before removing it.
- `runCategoryAdd`: select first, then revalidate entries and apply categories
  inside `updateCatalog`.
- `runCategoryRemove`: select and confirm first, then revalidate current
  category membership and remove it inside `updateCatalog`.

A concurrent change that invalidates the user's selection must produce the
existing missing/collision error, not overwrite the newer state. Do not hold the
lock while waiting for `prompts` or the external `skills` runner.

**Verify**:

- `pnpm typecheck` -> exit 0.
- `pnpm exec vitest run test/viblib.test.ts -t "catalog commands"` -> existing
  command cases pass.

### Step 4: Add deterministic concurrency and cleanup tests

In the catalog-storage suite in `test/viblib.test.ts`, add:

1. Two concurrent `updateCatalog` calls. Hold the first mutator on a promise
   barrier, start the second while the lock exists, then release the first. One
   adds `alpha`, the other `zebra`; the final catalog must contain both.
2. A mutator that throws. Assert the update rejects, `${catalogPath}.lock` no
   longer exists, and a later update succeeds.
3. A pre-existing lock file. With a test-only short wait option or injected lock
   timing, assert a clear busy error and unchanged catalog. Do not make the test
   wait for the production timeout.
4. Extend the existing atomic-write test so no temporary or lock artifact
   remains after a successful update.

Give `updateCatalog` a second optional internal options object with
`lockTimeoutMs` and `retryDelayMs`. Production commands must omit it and receive
bounded constants; tests may pass small positive values. Do not expose timing
flags on the public CLI.

**Verify**:
`pnpm exec vitest run test/viblib.test.ts -t "catalog lock"` -> all new cases
pass without real-time sleeps longer than the retry interval.

### Step 5: Run the full repository gates

**Verify**:

- `pnpm typecheck` -> exit 0.
- `pnpm test` -> all tests pass.
- `pnpm check` -> exit 0.
- `rg -n "saveCatalog\(" src/commands` -> no matches.
- `git diff --name-only` -> only this plan's in-scope files are listed.

## Test plan

- Keep storage and concurrency tests in `test/viblib.test.ts` with the existing
  temporary `VIBLIB_HOME` isolation.
- Prove preservation of both updates, cleanup after failure, bounded contention,
  and absence of leftover artifacts.
- Existing add collision/category merge tests must stay unchanged and pass.

## Done criteria

- [ ] All command read-change-write paths use `updateCatalog`.
- [ ] Two concurrent independent edits both survive.
- [ ] Locks are removed after success and thrown mutator errors.
- [ ] Contention has a bounded, clear error and never steals a lock.
- [ ] Prompts and discovery run outside the lock.
- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm check` exit 0.
- [ ] No out-of-scope files are modified.
- [ ] The Plan 004 row in `plans/README.md` is updated.

## STOP conditions

Stop and report if:

- Safe serialization requires a new dependency or automatic stale-lock
  stealing.
- A command must hold the lock across a prompt or network/process call to retain
  current semantics.
- A mutation cannot revalidate its selection against the freshly loaded catalog.
- The implementation requires locking read-only commands or changing schema.
- An in-scope excerpt has materially changed since `414b6d9`.

## Maintenance notes

- A killed process can leave a lock. The bounded error must explain safe manual
  recovery; do not hide or auto-delete it.
- Future catalog mutation commands must use `updateCatalog`, not a separate
  `loadCatalog`/`saveCatalog` pair.
- Review lock behavior on Windows as well as POSIX before claiming broader
  platform support.
