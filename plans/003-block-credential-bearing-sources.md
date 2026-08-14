# Plan 003: Block credential-bearing source references before use or storage

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status row in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 414b6d9..HEAD -- src/skills/source.ts src/skills/cli.ts src/catalog/io.ts test/viblib.test.ts`
> Compare changed in-scope code with the excerpts below. A material mismatch is
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `414b6d9`, 2026-08-14

## Why this matters

Generic URL sources can contain credentials in URL user-info or sensitive query
parameters. The current flow can send that source to another process, store it
in `catalog.json`, and later print it. Reject credential-bearing source
references before discovery and during catalog validation. Existing unsafe
catalog entries must fail with a field-only error that never repeats the source.

## Current state

- `src/skills/source.ts` accepts generic HTTP URLs and retains the raw URL
  (`src/skills/source.ts:121-151`):

```ts
return {
  ref: fragmentRef,
  source: bareInput,
  subpath: null,
  type: bareInput.endsWith(".git") ? "git" : "well-known",
};
```

- `sourceForInvocation` returns the original non-local input
  (`src/skills/source.ts:174-182`).
- `discoverSkills` invokes the pinned tool before catalog normalization
  (`src/skills/cli.ts:149-169`):

```ts
const result = await runSkills(["add", source, "--list"], {
  cwd: options.cwd,
  runner: options.runner,
});
```

- Catalog source validation checks only whitespace and control characters
  (`src/catalog/io.ts:72-79`). Its `invalid(field, message)` helper is already a
  safe pattern because it identifies the field without printing its value.
- `saveCatalog` writes mode `0o600`, but file permissions do not prevent later
  JSON or terminal output from exposing a stored source.

Keep the current module direction: `src/skills/source.ts` has no catalog import,
so `src/catalog/io.ts` may import a source-safety assertion without a cycle.
Use `ViblibError` for direct user input and convert it to catalog `invalid(...)`
at the catalog boundary.

## Commands you will need

| Purpose       | Command                                                            | Expected on success        |
| ------------- | ------------------------------------------------------------------ | -------------------------- |
| Install       | `pnpm install --frozen-lockfile`                                   | exit 0; lockfile unchanged |
| Focused tests | `pnpm exec vitest run test/viblib.test.ts -t "credential-bearing"` | new security cases pass    |
| Typecheck     | `pnpm typecheck`                                                   | exit 0, no errors          |
| Full tests    | `pnpm test`                                                        | all tests pass             |
| Quality       | `pnpm check`                                                       | exit 0                     |

## Scope

**In scope**:

- `src/skills/source.ts`
- `src/skills/cli.ts`
- `src/catalog/io.ts`
- `test/viblib.test.ts`
- `plans/README.md` for the status update

**Out of scope**:

- Adding a credential store, login flow, environment-variable loader, or Git
  credential helper.
- Changing supported noncredential source forms or canonicalization.
- Automatically rewriting an existing catalog.
- Scrubbing arbitrary output from the pinned tool; the unsafe input must be
  rejected before that tool starts.
- Logging policy unrelated to source references.

## Git workflow

- Branch: `advisor/003-block-credential-bearing-sources`
- Commit message: `fix(source): reject credential-bearing URLs`
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Add a pure source-safety assertion

In `src/skills/source.ts`, add an exported assertion that accepts a source
string and returns `void` or throws `ViblibError`.

Required behavior:

1. Attempt `new URL(value)` only for URL-like inputs. Shorthand such as
   `owner/repo`, local paths, and `git@host:path` must keep working.
2. Reject any parsed URL whose `username` or `password` is nonempty.
3. Compare query-parameter names case-insensitively against an explicit set:
   `token`, `access_token`, `api_key`, `apikey`, `key`, `secret`,
   `client_secret`, `password`, `passwd`, `signature`, `sig`,
   `x-amz-signature`, and `x-goog-signature`.
4. The thrown message must state the policy and safer direction without
   including the URL, parameter values, or user-info.
5. Do not reject fragments merely because they contain a ref; `#main` and other
   literal refs are part of the supported source grammar.

Use a top-level immutable set for the sensitive parameter names. Do not use a
regex that tries to print a sanitized copy; rejection is safer and sufficient
for this flow.

**Verify**:
`pnpm typecheck` -> exit 0.

### Step 2: Enforce the assertion before external use

Call the assertion at the start of `normalizeSource`, before selector or
fragment parsing. Also call it at the start of `discoverSkills`, before
`runSkills`, because that exported function currently reaches the subprocess
without calling `normalizeSource` first.

The checks may be repeated by `sourceForInvocation` and `sourceForCatalog`
through `normalizeSource`; keep that defense. Do not include the rejected source
in an error message.

**Verify**:
`pnpm typecheck` -> exit 0.

### Step 3: Enforce the assertion on hand-edited catalogs

In `validateSkill` in `src/catalog/io.ts`, call the same assertion after the
existing string/control-character check. Catch its error and call
`invalid(`${field}.source`, "must not contain URL credentials.")` or equivalent.
The resulting message may name the field and rule only.

This makes `list --json`, human list, install previews, uninstall previews, and
sync fail before they can display an unsafe persisted source. Do not add
call-site redaction that would allow the unsafe value to remain stored.

**Verify**:
`pnpm typecheck` -> exit 0.

### Step 4: Add security regression tests

Add tests titled with `credential-bearing` to `test/viblib.test.ts`:

1. `normalizeSource` rejects a synthetic URL containing user-info; the error
   text does not contain the fixture's marker.
2. It rejects each sensitive query-key class using table-driven cases; error
   text contains no parameter value.
3. Ordinary HTTPS, GitHub/GitLab shorthand, SSH Git, local paths, and literal
   refs remain accepted.
4. `discoverSkills` rejects unsafe input before the injected runner is called.
5. `validateCatalog` rejects a hand-edited unsafe source and its error contains
   only the catalog field/policy, not the fixture marker.

Fixtures must be synthetic. Do not copy credentials from any environment,
configuration file, remote, or command output.

**Verify**:
`pnpm exec vitest run test/viblib.test.ts -t "credential-bearing"` -> all new
cases pass and the runner-call assertion remains zero.

### Step 5: Run the full repository gates

**Verify**:

- `pnpm typecheck` -> exit 0.
- `pnpm test` -> all tests pass.
- `pnpm check` -> exit 0.
- `git diff --name-only` -> only this plan's in-scope files are listed.

## Test plan

- Test the pure source boundary, subprocess boundary, and persisted-catalog
  boundary.
- Include accepted noncredential inputs so the policy does not become a general
  URL-format change.
- Every rejection assertion must also prove that its synthetic marker is absent
  from the thrown message.

## Done criteria

- [ ] URL user-info and listed sensitive query parameters are rejected before
      discovery or normalization.
- [ ] The pinned `skills` runner is never called for rejected source input.
- [ ] Hand-edited unsafe catalog entries fail without their source appearing in
      the error.
- [ ] Supported ordinary source forms and refs still pass.
- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm check` exit 0.
- [ ] No out-of-scope files are modified.
- [ ] The Plan 003 row in `plans/README.md` is updated.

## STOP conditions

Stop and report if:

- The project intentionally supports signed or credential-bearing direct URLs;
  that needs an explicit credential transport and migration design first.
- An existing documented source form becomes unparseable or rejected by the
  proposed assertion.
- A safe error path requires printing any rejected URL component or parameter
  value.
- The fix requires editing the pinned dependency or storing credentials in a
  new location.
- An in-scope excerpt has materially changed since `414b6d9`.

## Maintenance notes

- Review the sensitive query-key set when adding new download providers.
- Keep source credentials outside the catalog; file mode `0o600` is not a
  substitute for data minimization.
- Plan 005 depends on this plan because it will refactor `normalizeSource` and
  must preserve this new safety boundary.
