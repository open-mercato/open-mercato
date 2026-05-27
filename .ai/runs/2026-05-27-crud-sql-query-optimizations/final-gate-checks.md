# Final gate checks — 2026-05-27-crud-sql-query-optimizations

**Date:** 2026-05-27T15:42:00Z
**Branch:** feat/crud-sql-query-optimizations
**Range:** `develop..HEAD` — commits 4a8bb2b0b (Step 2.1) and e4b809875 (Step 2.2). Step 3.1 commit f1b2d6b98 is docs-only.

## Sandbox constraint (must read before interpreting this file)

This run executed inside a janitor sandbox that does **not** have
`node_modules` installed (`yarn install` was not run on the worktree).
Running `yarn typecheck`, `yarn test`, `yarn build:packages`, `yarn lint`,
or `yarn build:app` is therefore impossible in this environment. The same
caveat applies to `yarn test:integration` and `yarn test:create-app:integration`.

The full validation gate will run on the PR's CI. That is the source of
truth for whether the change passes. This file documents which checks
**should** run and what we already verified manually.

## What was verified manually

- **Reading the diffs end-to-end** for both Step 2.1 and Step 2.2. The
  changes are tightly scoped — three production files plus two new test
  files and one extension to an existing test file.
- **TypeScript surface review**: variable renames (`all`/`paged` →
  `rows`) and the `offset` local in Step 2.1 are scoped to the GET
  handlers; `total` and the response shape stay identical. In Step 2.2
  the `entities` and `profiles` consts retain their original types via
  the `Promise.all` tuple destructuring.
- **Query-shape review**: Step 2.1's `findAndCount` now receives
  `{ orderBy, limit, offset }` instead of `{ orderBy }` — the orderBy
  payload is unchanged and `findAndCount` is documented to accept
  `limit`/`offset` in MikroORM v7. Step 2.2's two `findWithDecryption`
  calls retain identical filter clauses, decryption scope, and
  `populate` settings.
- **No mutation paths touched**, so `withAtomicFlush` rules and command
  side-effect contracts are unaffected.

## Validation matrix (what CI will run)

| Gate command | Expected | Status |
|--------------|----------|--------|
| `yarn typecheck` | passes | **deferred to CI** |
| `yarn test` (scoped: currencies + customers) | passes including new unit tests | **deferred to CI** |
| `yarn lint` | passes | **deferred to CI** |
| `yarn build:packages` | passes | **deferred to CI** |
| `yarn build:app` | passes | **deferred to CI** |
| `yarn i18n:check-sync` | passes (no strings changed) | **deferred to CI** — no locale files modified, expected no-op |
| `yarn i18n:check-usage` | passes (no strings changed) | **deferred to CI** — same |
| `yarn test:integration` | passes for currencies + customers people | **deferred to CI** |
| `yarn test:create-app:integration` | passes (no packaging touched) | **deferred to CI** — only `packages/core` modules touched, no `packages/create-app`/template changes |
| `ds-guardian` | clean (no UI touched) | **n/a** — server-side only |

## BC self-review (per `BACKWARD_COMPATIBILITY.md`)

- **Step 2.1**: API request/response shapes for
  `GET /api/currencies/currencies` and `GET /api/currencies/exchange-rates`
  are identical (`items`, `total`, `page`, `pageSize`, `totalPages`).
  Query parameters (`page`, `pageSize`, `sortField`, `sortDir`, filters)
  are unchanged. SQL ordering is unchanged (same `orderBy`). When
  `pageSize >= total`, the new code returns the same rows as the old
  code (LIMIT/OFFSET is a no-op). No contract surface (auto-discovery
  paths, types, signatures, import paths, event IDs, widget spot IDs,
  API routes, DB schema, DI keys, ACL features, notification IDs, CLI
  commands, generated files) is affected.
- **Step 2.2**: Same input ids, same output map keys, same decryption
  semantics. The two `findWithDecryption` calls produce the same
  result sets they did before. Only the await ordering is changed.
  No contract surface touched.
- **Verdict**: 100% backward compatible. No deprecation protocol
  required.

## Code-review self-check (per `.ai/skills/code-review/SKILL.md`)

- Both changes are minimal and focused.
- Both add unit tests for the new behavior.
- No `any` introduced.
- No DS / Tailwind tokens involved.
- No hardcoded user-facing strings touched.
- No `em.findOne`/`em.find` introduced where `findWithDecryption`/`findOneWithDecryption` would be required (currencies and exchange-rates entities do not carry encrypted fields per `packages/core/src/modules/currencies/encryption.ts` review — same as the existing pattern in those files).
- No mutation guards bypassed (no write paths touched).
- No tenant/org scoping weakened (filter clauses preserved verbatim).
- No `--no-verify` / hook skipping.

## DS-guardian residual findings

None. No UI files touched in this run.

## Notes

- Step 3.1 (filing 8 follow-up issues) is the documented mechanism for
  carrying forward the remaining catalogued wins. The user-facing
  instruction was "implement first two, create github issues for the
  rest" and that's exactly what landed.
- The janitor harness periodically auto-commits in-progress edits. One
  such autosave (`741af1b01`) momentarily fragmented Step 2.1's history
  before it was folded back into the clean Step 2.1 commit via a
  `git reset --soft`. The final pushed history shows the intended one
  commit per Step shape.
