# Execution Plan — Port PR #5147 (major dependency group) to `develop`

## Goal

Recreate the Dependabot "major group" bumps from PR #5147 (opened against `main`, CI red) on top of `develop`, fix every breaking change the majors introduce so the full validation gate is green, then close #5147 with a pointer to the new PR.

## Overview

Dependabot opened [#5147](https://github.com/open-mercato/open-mercato/pull/5147) (`dependabot/npm_and_yarn/major-0421ac02f5`) against `main`. The team integrates on `develop`, which is 769 commits ahead of `main`, so the branch is unusable as-is — and its CI is failing (`prepare`, `lint`, `audit`). Several of the grouped bumps have *already* landed on `develop` through earlier ports, so the residual set is smaller than the PR's diff suggests.

Residual delta measured against `develop@4792c7717`:

| Package | #5147 target | `develop` today | Residual work |
|---------|--------------|-----------------|---------------|
| `@testing-library/jest-dom` | `^7.0.0` | `^7.0.0` | **none** — already ported |
| `better-sqlite3` | `^13.0.3` | `^13.0.2` | range bump inside major 13 |
| `bullmq` | `^6.0.9` | `^6.0.2` | range bump inside major 6 |
| `framer-motion` | `^13.0.0` | `^12.43.0` | major bump; **zero source imports** repo-wide |
| `ioredis` | `^6.0.0` | `^5.11.1` | major bump; consumed only through dynamic `import('ioredis')` behind narrow interfaces; peer ranges in `cache`/`scheduler` must widen |
| `eslint` | `^10.8.0` | `^9.39.4` | major bump; flat config already in place, `eslint-config-next@16.2.11` peer is `>=9.0.0` |
| `@tanstack/react-table` | `^9.0.0` | `^8.20.5` | major bump; **v9 is an API rewrite** — see below |

### The `@tanstack/react-table` v8 → v9 problem

v9 removes `useReactTable`, `getCoreRowModel` and `getSortedRowModel` from the package root and re-shapes `ColumnDef` from `ColumnDef<TData, TValue>` to `ColumnDef<TFeatures, TData, TValue>`. Every v8 call site therefore breaks. In this repo that is:

- **1 runtime call site** — `packages/ui/src/backend/DataTable.tsx` (3344 lines) uses `useReactTable`, both row-model factories, `flexRender`, and a wide slice of the table instance API (`getAllLeafColumns`, `getColumn`, `setColumnOrder`, `getHeaderGroups`, `getRowModel`, `getSelectedRowModel`, `getIsAllPageRowsSelected`, `toggleAllPageRowsSelected`, `column.getIsVisible`).
- **~102 type-only call sites** importing `ColumnDef` (plus `SortingState`, `VisibilityState`, `RowSelectionState`, `Column`).

v9 ships an official v8 compatibility entry point, `@tanstack/react-table/legacy`, exporting `useLegacyTable`, the `get*RowModel` stubs and `LegacyColumnDef<TData, TValue>`. `useLegacyTable` registers `StockFeatures`, which covers every feature `DataTable.tsx` touches (column visibility/ordering/sizing/pinning/resizing, row selection, row sorting, row pagination), so the migration is mechanically viable.

Because `@tanstack/react-table` is imported directly by module code outside this repo, its `ColumnDef` type is a de-facto public contract surface (see `BACKWARD_COMPATIBILITY.md` → types / import paths). This port therefore routes the repo's own call sites through the legacy entry point rather than rewriting them onto the v9-native API; a native v9 migration is a separate, spec-backed piece of work.

### Source

- Source PR: <https://github.com/open-mercato/open-mercato/pull/5147> (base `main`, CI red).
- Prior art: `.ai/runs/2026-06-08-migrate-deps-major-group-2836.md`, `.ai/runs/2026-06-15-migrate-pr-3069-deps-to-develop.md` — same "port a Dependabot PR from `main` onto `develop`, then close the original" pattern.

### External References

None (`--skill-url` not supplied).

## Scope

- Version-range edits in `package.json` / `apps/mercato/package.json` / `packages/*/package.json` for the residual set.
- Widen `ioredis` peer/optional ranges in `packages/cache` and `packages/scheduler` to `^5.0.0 || ^6.0.0`, mirroring how `bullmq` already spans two majors.
- `packages/ui/src/backend/DataTable.tsx` — migrate to `useLegacyTable` and the legacy row-model stubs.
- Repo-wide `@tanstack/react-table` type imports — repoint to the legacy entry point.
- `yarn.lock` — relock via `yarn install`.
- Whatever lint/type/test breakage the majors surface.

### Non-goals

- No native TanStack Table v9 rewrite (feature-slot API, `table.Subscribe`, `createColumnHelper`) — that needs its own spec.
- No behavioral changes to DataTable, caching, queueing or scheduling; this is a dependency port.
- No bumps beyond the set in #5147.
- No changes to `main` or to Dependabot's grouping config.

## Risks

- **`@tanstack/react-table` v9 (high).** DataTable is the single most widely used backend component in the repo. Mitigation: the legacy shim keeps the v8 semantics, and `packages/ui` has six DataTable test suites plus consumer tests across `core` that exercise render, sticky/responsive layout, column metadata, virtualization and extensions.
- **`ioredis` v6 (medium).** Redis is optional at runtime and reached through `import('ioredis')`; a constructor/option change would only surface with a live Redis. Mitigation: read the v6 changelog, check `packages/shared/src/lib/redis/connection.ts` and `packages/cache/src/strategies/redis.ts` against it, and keep the existing unit mocks green.
- **`eslint` v10 — realised, and blocked upstream.** `eslint-plugin-react@7.37.5` (latest stable) calls the `context.getFilename()` shim that eslint 10 removed, so the run aborts before linting anything. Its peer range stops at `^9.7`, `eslint-plugin-import@2.32.0` stops at `^9`, and `eslint-config-next@16.3.0` depends on both — so nothing in this repo can unblock it. eslint stays on `^9.39.4`; see Phase 3 in Progress.
- **`framer-motion` v13 (low).** No source imports; the dependency may simply be stale in `packages/ai-assistant`.
- Relocking against `develop` can move transitive versions relative to `main`'s lockfile — expected, and gated by `yarn audit`/CI.

## Implementation Plan

### Phase 1: Low-risk range bumps

- 1.1 Bump `better-sqlite3` → `^13.0.3` and `bullmq` → `^6.0.9`; confirm `@testing-library/jest-dom` is already at `^7.0.0`.
- 1.2 Bump `framer-motion` → `^13.0.0` in `packages/ai-assistant`; confirm no source imports exist.
- 1.3 Relock with `yarn install` and run a targeted build/typecheck.

### Phase 2: `ioredis` 5 → 6

- 2.1 Bump `ioredis` to `^6.0.0` in `apps/mercato`; widen the `cache`/`scheduler` peer ranges to `^5.0.0 || ^6.0.0`.
- 2.2 Reconcile the v6 breaking changes against `packages/shared/src/lib/redis/connection.ts`, `packages/cache/src/strategies/redis.ts`, `packages/shared/src/lib/ratelimit/service.ts` and `packages/cli/src/mercato.ts`.
- 2.3 Run the `cache`, `shared`, `queue` and `scheduler` test suites.

### Phase 3: `eslint` 9 → 10

- 3.1 Bump `eslint` to `^10.8.0` in the root, `apps/mercato` and `packages/eslint-plugin-ds`; relock.
- 3.2 Fix flat-config / plugin-peer fallout in `eslint.config.mjs` and the DS plugin.
- 3.3 Run `yarn lint` and the `eslint-plugin-ds` tests until green.

### Phase 4: `@tanstack/react-table` 8 → 9

- 4.1 Bump to `^9.0.0` in the root and `apps/mercato`; relock.
- 4.2 Migrate `packages/ui/src/backend/DataTable.tsx` to `useLegacyTable` + legacy row-model stubs.
- 4.3 Repoint every remaining `@tanstack/react-table` type import to the legacy entry point.
- 4.4 Run the `ui` and `core` DataTable-touching test suites and fix fallout.

### Phase 5: Full validation gate

- 5.1 Run the ordered `validation.commands` gate end to end; fix until green.

### Phase 6: Ship and retire the original

- 6.1 Open the PR against `develop`, apply the pipeline/category/priority/risk labels, run the review pass.
- 6.2 Close PR #5147 with a comment pointing at the replacement PR.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Low-risk range bumps

- [x] 1.1 Bump better-sqlite3 and bullmq ranges; verify jest-dom already ported — 929f41955
- [x] 1.2 Bump framer-motion to ^13.0.0; verify no source imports — 929f41955 (repo-wide grep for `framer-motion` / `from 'motion` in `.ts`/`.tsx` returns nothing; the dependency is declared but unused)
- [x] 1.3 Relock and run targeted build/typecheck — 929f41955 (`yarn build:packages` 22/22, `yarn generate`, `yarn typecheck` 22/22, cache 68/68, queue 66/66, scheduler 365/365; lock diff scoped to the three packages plus motion-dom/motion-utils)

### Phase 2: ioredis 5 to 6

- [x] 2.1 Bump ioredis and widen cache/scheduler peer ranges — ac326b9ea
- [x] 2.2 Reconcile ioredis v6 breaking changes against the four consumers — ac326b9ea (the only documented break is RESP3-by-default; `REDIS_WIRE_PROTOCOL = 2` is now threaded through `parseRedisUrl`, the queue's host-branch options, the cache strategy constructor, the rate limiter and the CLI flush client)
- [x] 2.3 Run cache/shared/queue/scheduler test suites — ac326b9ea (shared 1824/1824, cache 69/69, queue 66/66, scheduler 365/365, cli 1480/1480; new regression tests assert the RESP2 pin in `parseRedisUrl` and the cache strategy)

### Phase 3: eslint 9 to 10

- [x] 3.1 Bump eslint in root, app and eslint-plugin-ds; relock — **reverted, blocked upstream** (see 3.2)
- [x] 3.2 Fix flat-config and plugin-peer fallout — **not fixable in this repo.** On eslint 10.8.1 the whole lint run aborts before reporting a single file: `TypeError: Error while loading rule 'react/no-direct-mutation-state': contextOrFilename.getFilename is not a function` (`eslint-plugin-react/lib/util/version.js:31`). eslint 10 removed the `context.getFilename()` shim that `eslint-plugin-react` still calls. The plugin's latest stable release, 7.37.5, declares `eslint: "… || ^9.7"` and has no eslint-10 build (only a `next`-tagged `7.8.0-rc.0` prerelease). `eslint-plugin-import@2.32.0` caps at `^9` for the same reason, and `eslint-config-next@16.3.0` — already the latest — depends on both. eslint stays at `^9.39.4` until that chain ships eslint-10 support.
- [x] 3.3 Run yarn lint and eslint-plugin-ds tests until green — `yarn lint` green on the retained eslint 9; the lockfile was restored so the reverted experiment leaves no drift (`yarn install --immutable` clean)

### Phase 4: tanstack react-table 8 to 9

- [ ] 4.1 Bump react-table to ^9.0.0 and relock
- [ ] 4.2 Migrate DataTable.tsx to useLegacyTable
- [ ] 4.3 Repoint remaining react-table type imports to the legacy entry point
- [ ] 4.4 Run ui and core DataTable test suites and fix fallout

### Phase 5: Full validation gate

- [ ] 5.1 Run the ordered validation.commands gate end to end

### Phase 6: Ship and retire the original

- [ ] 6.1 Open the PR against develop, apply labels, run the review pass
- [ ] 6.2 Close PR #5147 with a pointer to the replacement PR
