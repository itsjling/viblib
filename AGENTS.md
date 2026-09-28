# viblib

`viblib` is a personal skill catalog CLI. It stores skill sources and categories, then wraps the pinned [`skills`](https://www.npmjs.com/package/skills) package to install, uninstall, and sync those skills in a project or globally. Catalog commands (`add`, `remove`, `category`) change only the catalog; `install`, `uninstall`, and `sync` change only installed skills.

## Layout

- `src/cli.ts` — Commander program. The published bin is `viblib` → `dist/cli.mjs`.
- `src/commands/` — one handler per command: `add`, `remove`, `list`, `category`, `install`, `uninstall`, `sync`.
- `src/catalog/` — catalog types and JSON IO. The file is `~/.viblib/catalog.json`; `VIBLIB_HOME` moves that directory.
- `src/skills/` — process wrapper for the `skills` CLI, source parsing, and lock comparison.
- `src/util/errors.ts` — `ViblibError`.
- `test/` — Vitest suite (`test/viblib.test.ts`, `test/helpers.ts`). Config is `vitest.config.ts`.
- `plans/` — numbered implementation plans (handoffs for future work). Status, order, and dependencies are in `plans/README.md`.
- `package.json` — scripts below, engines (`node >=22.20.0`, `pnpm >=10`), and the `skills` pin. Build config is `tsdown.config.ts` and `tsconfig.json`.

## Install, run, and verify

Package manager is pnpm (`packageManager` is `pnpm@10.26.0`).

```sh
pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm check
pnpm build
pnpm run prepublishOnly
```

- `pnpm dev` runs `tsx src/cli.ts`. Pass CLI args after `--` (for example `pnpm dev -- list`).
- `pnpm test` runs `vitest run`. `pnpm test:watch` leaves Vitest open.
- `pnpm typecheck` runs `tsc -p tsconfig.json`.
- `pnpm check` runs `ultracite check`. `pnpm fix` runs `ultracite fix`. `pnpm lint` is `oxlint --type-aware`; `pnpm format` is `oxfmt`.
- `pnpm build` runs `tsdown` and writes `dist/cli.mjs`.
- `pnpm run prepublishOnly` runs `pnpm typecheck && pnpm test && pnpm check`. Pack and publish also run `prepack`, which is `pnpm build`.

## Read next

- CLI usage, catalog shape, sync exit codes, and the release steps: [README.md](README.md).
- Planned work: [plans/](plans/README.md). Read the index, then the numbered plan in full before changing code.

Ultracite (oxlint + oxfmt) is the formatter and linter: `pnpm check` and `pnpm fix`.
