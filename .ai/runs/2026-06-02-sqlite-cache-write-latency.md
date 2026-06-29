# SQLite Cache Write Latency

## Goal

Reduce SQLite cache write latency for issue #2350 while preserving cache API and tag invalidation behavior.

## Scope

- Tune SQLite cache connection settings in `packages/cache/src/strategies/sqlite.ts`.
- Add focused tests for SQLite initialization/performance-relevant PRAGMA behavior and existing tag semantics.
- Update cache strategy guidance for SQLite versus Redis latency tradeoffs.

## Non-goals

- Do not change the `CacheStrategy` interface.
- Do not change `CACHE_STRATEGY=sqlite` in `apps/mercato/.env.example`.
- Do not introduce a new cache backend or production dependency.
- Do not change tenant scoping, invalidation semantics, or module cache call sites.

## Implementation Plan

### Phase 1: SQLite Write Tuning

Configure the SQLite cache connection for cache-appropriate durability and lower write latency:

- `PRAGMA journal_mode = WAL`
- `PRAGMA synchronous = NORMAL`
- `PRAGMA busy_timeout = 5000`
- `PRAGMA foreign_keys = ON`

Keep the existing per-call write semantics intact so behavior remains compatible.

### Phase 2: Tests And Documentation

Add unit coverage around initialization PRAGMAs and preserve set/get/tag invalidation coverage for the SQLite strategy. Update cache docs and env comments so operators understand SQLite is a single-server convenience cache and Redis remains the lower-latency shared production option.

### Phase 3: Validation And PR

Run focused package validation, self-review backward compatibility, commit, push to the fork, and open a PR against `open-mercato:develop`.

## Risks

- WAL and `synchronous=NORMAL` trade some cache-file durability for lower latency. This is acceptable because cache entries can be regenerated.
- SQLite remains a single-server strategy. Multi-server deployments should continue to use Redis.
- If an older SQLite build returns a non-WAL journal mode, tests should mock better-sqlite3 behavior rather than depend on host filesystem details.

## Validation

- `yarn workspace @open-mercato/cache test` — passed.
- `yarn workspace @open-mercato/cache build` — passed.
- `yarn exec tsc -p packages/cache/tsconfig.json --noEmit` — passed.
- `yarn build:packages` — passed.
- `yarn generate` — passed; OpenAPI generation used static fallback because local Node 26 lacks a native `isolated-vm` build.
- `yarn typecheck` — passed after `yarn generate`.
- `yarn workspace @open-mercato/cache typecheck` — blocked by package-local script not resolving root `typescript`; root `tsc` command above covered the package.
- Follow-up for CI: `yarn workspace @open-mercato/core test --runTestsByPath src/modules/api_keys/api/__tests__/keys.route.test.ts` — passed after adding the missing transactional EM mock.

## PR

- Opened PR #2400 against `open-mercato:develop`.
- Requested `review`, `skip-qa`, and `refactor` labels in a PR comment because the current GitHub token cannot apply labels to the upstream repository.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: SQLite Write Tuning

- [x] 1.1 Configure SQLite cache connection PRAGMAs — 94aaccb4a

### Phase 2: Tests And Documentation

- [x] 2.1 Add focused SQLite strategy tests — 94aaccb4a
- [x] 2.2 Update cache strategy guidance — 94aaccb4a

### Phase 3: Validation And PR

- [x] 3.1 Run validation and self-review — a3c391314
- [x] 3.2 Push branch and open PR — PR #2400

### Post-merge maintenance

- [x] Merge `origin/develop` to resolve conflict in `api_keys/keys.route.test.ts`; adopted develop's `transactional` mock (superseding the PR's equivalent fix). Full gate re-run green. — 1673e5a59
