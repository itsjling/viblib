# Plan 005: Characterize and split the source parser without changing grammar

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status row in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 414b6d9..HEAD -- src/skills/source.ts test/viblib.test.ts`
> Plan 003 is expected to have changed these files. Confirm its credential guard
> is present, then compare all other changes with the excerpts below. Any
> unexplained material mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/003-block-credential-bearing-sources.md`
- **Category**: tests
- **Planned at**: commit `414b6d9`, 2026-08-14

## Why this matters

`normalizeSource` decides catalog identity, collision behavior, invocation
arguments, and sync comparisons for every supported source form. Fallow measured
cyclomatic complexity 28 and cognitive complexity 37 in its 112-line body, and
the test suite does not call the module directly. First lock down the current
grammar with table tests, then split the function into private stages without
changing any accepted input or output.

## Current state

- `src/skills/source.ts` contains selector parsing, fragment parsing, local-path
  handling, GitHub/GitLab forms, generic URLs, SSH, and raw Git fallback.
- `normalizeSource` is called by add, install, sync, and the pinned adapter.
- `sourceForCatalog`, `sourceForInvocation`, and `sourceKey` are part of the same
  behavior boundary.
- `test/viblib.test.ts:1-27` imports no functions from `src/skills/source.ts`.

The dispatcher starts by stripping selectors and fragments
(`src/skills/source.ts:57-77`):

```ts
const trimmed = splitSkillSelector(input.trim()).source;
// ...
const { input: bareInput, ref: fragmentRef } = splitFragment(trimmed);
if (bareInput.startsWith("github:")) {
  return normalizeSource(/* canonical alias */, cwd);
}
```

It then checks source forms in an order that is part of the current grammar.
For example, hosted tree URLs precede shorthand and generic HTTP parsing
(`src/skills/source.ts:90-150`). Preserve that order.

Plan 003 adds a credential-safety assertion at the source boundary. Keep that
assertion at the public dispatcher entrance and cover it in the characterization
suite; do not move it into only one URL branch.

Match the existing test style: one `describe` block, table-driven `it.each`
where cases share a shape, temporary paths from `test/helpers.ts`, and exact
object assertions.

## Commands you will need

| Purpose       | Command                                                                                      | Expected on success        |
| ------------- | -------------------------------------------------------------------------------------------- | -------------------------- |
| Install       | `pnpm install --frozen-lockfile`                                                             | exit 0; lockfile unchanged |
| Focused tests | `pnpm exec vitest run test/viblib.test.ts -t "source normalization"`                         | all grammar cases pass     |
| Typecheck     | `pnpm typecheck`                                                                             | exit 0, no errors          |
| Full tests    | `pnpm test`                                                                                  | all tests pass             |
| Complexity    | `pnpm exec oxlint --type-aware --deny=complexity --deny=max-statements src/skills/source.ts` | exit 0                     |
| Quality       | `pnpm check`                                                                                 | exit 0                     |

## Scope

**In scope**:

- `src/skills/source.ts`
- `test/viblib.test.ts`
- `plans/README.md` for the status update

**Out of scope**:

- New source formats or changes to canonical output.
- Fixing ambiguous refs that contain `/`, URL decoding, or host-specific policy.
- `src/skills/cli.ts`, command behavior, catalog schema, or lock semantics.
- New parser dependencies.
- Changing or weakening Plan 003's credential checks.

## Git workflow

- Branch: `advisor/005-characterize-source-parser`
- Prefer two commits: `test(source): characterize accepted grammar`, then
  `refactor(source): split normalization stages`.
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Add a table-driven grammar suite before production edits

Import `normalizeSource`, `sourceForCatalog`, `sourceForInvocation`,
`sourceKey`, and `splitSkillSelector` into `test/viblib.test.ts`. Add a
`source normalization` suite that records current outputs for:

- `owner/repo`.
- `owner/repo#main`.
- `owner/repo/path/to/skill#v1`.
- Inline selector `owner/repo@Foo Skill`.
- `github:owner/repo#main`.
- `gitlab:group/project#release`.
- A GitHub tree URL with ref and nested skill path.
- A GitLab subgroup tree URL with ref and nested skill path.
- GitHub SSH input with a fragment ref.
- A generic HTTPS well-known source with a fragment ref.
- A generic HTTPS URL ending in `.git`.
- A relative local path with a test-owned temporary `cwd`.
- Parent-escaping shorthand/tree subpaths, which must reject.
- A normal non-local round trip through `sourceForCatalog`.
- A local round trip through `sourceForInvocation`.
- `sourceKey` differences for ref and subpath.
- Plan 003's accepted and rejected URL-security cases.

Use `path.join` and the temporary directory helper for platform-safe local-path
expectations. Do not depend on the operator's home directory or on a real repo.

Run the tests before changing production code. If any expected result differs,
record the actual current behavior and decide whether it is an intentional
characterization; do not silently turn this task into a parser fix.

**Verify**:
`pnpm exec vitest run test/viblib.test.ts -t "source normalization"` -> all new
tests pass against the pre-refactor code.

### Step 2: Extract private helpers along existing grammar boundaries

Refactor `src/skills/source.ts` while keeping `normalizeSource` as the exported
ordered dispatcher. Extract focused private helpers for these stages:

1. Initial selector/fragment preparation.
2. Local-path recognition and resolution.
3. Hosted GitHub/GitLab tree URL recognition.
4. GitHub shorthand recognition.
5. Generic HTTP URL recognition/canonicalization.
6. GitHub SSH recognition.
7. Raw Git fallback.

Each helper should either return a `SourceIdentity`/Promise result or `null` to
let the dispatcher continue. Keep top-level regex constants outside loops and
give captures meaningful names where doing so does not alter matches. Do not
export helpers merely for tests; test the public grammar.

Keep Plan 003's safety assertion before any branch. Avoid recursive alias calls
if a small canonical-input helper can preserve the same result more clearly,
but do not change alias/ref precedence.

**Verify**:

- `pnpm typecheck` -> exit 0.
- `pnpm exec vitest run test/viblib.test.ts -t "source normalization"` -> exact
  characterization outputs remain unchanged.

### Step 3: Check complexity and all consumers

Run a scoped Oxlint gate that raises complexity and max-statements findings to
errors for `src/skills/source.ts`. The repository-wide `pnpm lint` currently
fails on unrelated existing type-aware errors, so it is not a valid done gate
for this scoped plan. `normalizeSource` and every extracted helper must pass the
scoped gate.

**Verify**:

- `pnpm exec oxlint --type-aware --deny=complexity --deny=max-statements src/skills/source.ts`
  -> exit 0 with no complexity or max-statements error in the source parser.
- `pnpm test` -> all add/install/sync tests pass as well as the new suite.
- `pnpm typecheck` -> exit 0.
- `pnpm check` -> exit 0.
- `git diff --name-only` -> only this plan's in-scope files are listed, apart
  from the already-landed Plan 003 changes in history.

## Test plan

- Characterization tests land before the refactor.
- Cover every current parser branch, ordering-sensitive forms, invalid
  traversal, catalog/invocation conversions, and source-key identity.
- Use exact `SourceIdentity` objects rather than partial matches.
- No test may use the network, the operator's catalog, or a real home path.

## Done criteria

- [ ] Every supported source branch has a direct public-behavior test.
- [ ] Characterization tests pass before and after extraction with identical
      expected results.
- [ ] `normalizeSource` is an ordered dispatcher with focused private helpers.
- [ ] Plan 003's credential boundary remains at the public entrance.
- [ ] The scoped Oxlint complexity/max-statements command exits 0.
- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm check` exit 0.
- [ ] No out-of-scope files are modified.
- [ ] The Plan 005 row in `plans/README.md` is updated.

## STOP conditions

Stop and report if:

- Plan 003 has not landed or its source-safety boundary is missing.
- A characterization case reveals a likely bug that needs a behavior decision.
  Record it separately; do not fix it during extraction.
- A refactor changes any expected normalized source, ref, subpath, type, selector,
  or local-path result.
- A test needs network access or host-specific filesystem state.
- Reducing complexity requires changing public grammar or another module.

## Maintenance notes

- Add a characterization row before adding any new source form.
- Parser branch order is observable; reviewers should check it as carefully as
  each regex.
- Re-run this suite when upgrading `skills`, because viblib's normalization must
  continue to describe the pinned tool's lock and invocation behavior.
