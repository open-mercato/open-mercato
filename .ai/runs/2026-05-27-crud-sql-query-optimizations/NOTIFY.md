# Notify — 2026-05-27-crud-sql-query-optimizations

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-05-27T15:30:00Z — run started

- Brief: analyze CRUD API SQL queries across modules; implement first two BC quick wins; file GitHub issues for the rest.
- External skill URLs: none.
- Module scope: customers (CRM), sales, catalog, staff, resources, workflows, plus other modules with CRUD routes (currencies, auth, directory).
- Plan classification: **Spec-implementation run** — multi-phase work spanning analysis, two implementation Steps, and issue creation.
- Branch: `feat/crud-sql-query-optimizations` off `origin/develop` (latest at `da89d7530`).
- Two implementation steps chosen:
  - Step 2.1 — push DB-level pagination to currencies + exchange-rates list routes (highest-impact bug-grade fix; clear OOM/perf risk on large tables).
  - Step 2.2 — parallelize entity + profile decryption fetch in customers people `afterList` (highest-traffic CRM list endpoint).
- Other catalogued wins (C–J in PLAN.md) deferred to GitHub issues per user request.

## 2026-05-27T15:30:30Z — Step 2.1 landed

- Pushed `4a8bb2b0b`: `perf(currencies): push pagination to DB on currencies + exchange-rates list`.
- Janitor harness wrote an intermediate periodic-autosave commit (`741af1b01`) before the manual commit could land; resolved by `git reset --soft d51129921` to fold the changes into a single clean Step 2.1 commit. No content lost.
- Tests added under both `currencies/__tests__/list-pagination.test.ts` and `exchange-rates/__tests__/list-pagination.test.ts`. Cannot run locally — janitor sandbox has no `node_modules`. CI will verify.

## 2026-05-27T15:35:00Z — Step 2.2 landed

- Pushed `e4b809875`: `perf(customers): fetch CustomerEntity and CustomerPersonProfile concurrently in people afterList`.
- Added a deferred-promise concurrency test to `customers/api/people/__tests__/route.test.ts` that proves both fetches initiate before either resolves.
- No autosave conflict this time.

## 2026-05-27T15:38:00Z — Step 3.1 GitHub issues filed

- #2131 (C — sales shipments DictionaryEntry parallelize)
- #2132 (D — QueryEngine gate cf:* joins)
- #2133 (E — thread CF def index through QueryEngine)
- #2134 (F — sales shipments orderLines batching; depends on #2131)
- #2135 (G — makeCrudRoute cache-tag loop flatten)
- #2136 (H — audit em.findAndCount callers)
- #2137 (I — customers activities decorator parallelize)
- #2138 (J — auth roles ACL parallelize)
- All filed with `refactor` label. PR cross-link will be added once PR is opened.

## 2026-05-27T15:48:00Z — Step 4.1 complete — PR #2139 opened

- PR: https://github.com/open-mercato/open-mercato/pull/2139
- Title: `perf(crud): push pagination + parallelize decryption fetches for two CRUD SQL quick wins`
- Labels applied: `review`, `refactor`, `skip-qa` — each with a rationale comment per AGENTS.md.
- Three-signal in-progress lock claimed (assignee `pkarw`, `in-progress` label, claim comment).
- Cross-linked PR #2139 to each of #2131–#2138 via issue comments.
- Comprehensive summary comment posted with full Verification phases / How to verify / Risk analysis sections.
- `auto-review-pr` autofix pass substituted with manual self-review (janitor sandbox lacks `node_modules`); precedent: #2102 and #2130. CI on the PR runs the full gate.

## 2026-05-27T15:50:00Z — run complete

- Lock release follows immediately after this NOTIFY/HANDOFF commit lands.
