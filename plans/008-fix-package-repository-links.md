# Plan 008: Point npm package metadata at the current repository

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status row in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 414b6d9..HEAD -- package.json`
> If `package.json` changed, confirm the package is still named `viblib` and the
> stale links below still exist. A material mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `414b6d9`, 2026-08-14

## Why this matters

The npm package is named `viblib` and the Git remote points at
`itsjling/viblib`, but npm metadata still sends users to `vibetools-cli` for
source, documentation, and issues. Correct the three metadata fields so package
consumers reach the maintained repository. Do not change version, package name,
license, or publishing behavior.

## Current state

`package.json:12-20` contains:

```json
"homepage": "https://github.com/itsjling/vibetools-cli#readme",
"bugs": {
  "url": "https://github.com/itsjling/vibetools-cli/issues"
},
"repository": {
  "type": "git",
  "url": "git+https://github.com/itsjling/vibetools-cli.git"
}
```

At planning time, `git remote get-url origin` returns
`git@github.com:itsjling/viblib.git`. The repository uses sorted/normalized
`package.json` formatting through Oxfmt; preserve that layout.

## Commands you will need

| Purpose          | Command                                                                                                                                                                    | Expected on success          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Confirm remote   | `git remote get-url origin`                                                                                                                                                | identifies `itsjling/viblib` |
| Metadata check   | `node -e 'const p=require("./package.json"); const urls=[p.homepage,p.bugs.url,p.repository.url]; if(urls.some((url)=>!url.includes("itsjling/viblib"))) process.exit(1)'` | exit 0                       |
| Stale-name check | `rg -n "vibetools-cli" package.json`                                                                                                                                       | no matches; `rg` exits 1     |
| Typecheck        | `pnpm typecheck`                                                                                                                                                           | exit 0                       |
| Tests            | `pnpm test`                                                                                                                                                                | all tests pass               |
| Quality          | `pnpm check`                                                                                                                                                               | exit 0                       |

## Scope

**In scope**:

- `package.json`
- `plans/README.md` for the status update

**Out of scope**:

- Package name, version, license, keywords, engines, scripts, dependencies, and
  publish configuration.
- `pnpm-lock.yaml`; metadata-only changes must not alter it.
- README links, Git remotes, npm registry state, or a new release.
- Repository transfer or npm ownership work.

## Git workflow

- Branch: `advisor/008-fix-package-links`
- Commit message: `fix(package): point metadata at viblib repository`
- Do not push, publish, or open a pull request unless the operator asks.

## Steps

### Step 1: Confirm the intended public repository

Run `git remote get-url origin`. It must identify
`github.com:itsjling/viblib`. If the remote differs or the operator intends a
different public home, stop before editing.

**Verify**:
`git remote get-url origin` -> output identifies `itsjling/viblib`.

### Step 2: Replace only the three stale URLs

Set exact values in `package.json`:

```json
"homepage": "https://github.com/itsjling/viblib#readme",
"bugs": {
  "url": "https://github.com/itsjling/viblib/issues"
},
"repository": {
  "type": "git",
  "url": "git+https://github.com/itsjling/viblib.git"
}
```

Do not change adjacent package fields. Run the repository formatter only if the
edit does not preserve the existing format; inspect its diff and revert any
unrelated change.

**Verify**:

- The metadata-check command in the command table exits 0.
- `rg -n "vibetools-cli" package.json` returns no matches.
- `git diff -- package.json` shows only the three URLs.

### Step 3: Run repository checks

**Verify**:

- `pnpm typecheck` -> exit 0.
- `pnpm test` -> all tests pass.
- `pnpm check` -> exit 0.
- `git diff --name-only` -> only `package.json` and the plan index status change
  are listed.

## Test plan

- No new source tests are required for metadata-only values.
- Use exact Node assertions and a stale-string search instead of visual review
  alone.
- Run the normal repository gates to catch formatting or JSON damage.

## Done criteria

- [ ] Homepage is `https://github.com/itsjling/viblib#readme`.
- [ ] Bug URL is `https://github.com/itsjling/viblib/issues`.
- [ ] Repository URL is `git+https://github.com/itsjling/viblib.git`.
- [ ] `package.json` contains no `vibetools-cli` reference.
- [ ] No unrelated package field or lockfile changed.
- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm check` exit 0.
- [ ] The Plan 008 row in `plans/README.md` is updated.

## STOP conditions

Stop and report if:

- The origin remote no longer points at `itsjling/viblib`.
- The intended public repository differs from the current origin.
- Correcting metadata also requires a package rename, transfer, or npm ownership
  change.
- `pnpm-lock.yaml` changes as a result of the metadata edit.

## Maintenance notes

- Check these fields during future repository renames or transfers.
- A release is not required to complete the code change, but npm will show the
  new metadata only after a later publish.
