# Checkpoint 4 — Phase 15 (QA #2055 CRM + sales update/delete coverage)

**Steps covered:** 15.1 .. 15.5
**SHA range:** `8c35339d5` (15.1) .. `5c9ceeeb0` (15.5)
**Touched packages:** `@open-mercato/core` (customers + sales backend pages/hooks + 1 integration spec). No `@open-mercato/shared` / `@open-mercato/ui` source change this resume.

## What landed

| Step | Commit | Summary |
|------|--------|---------|
| 15.1 | 8c35339d5 | Deals update + delete handlers send the optimistic-lock header (`useDealFormHandlers.ts`) + unit test. |
| 15.2 | 49f25480b | company-v2 + people-v2 custom delete handlers send the header + page delete-header tests. |
| 15.3 | 32fb756f8 | sales channels list delete sends the header; 409 → localized conflict flash + list refresh. |
| 15.4 | ed4efbdd0 | TC-LOCK-OSS-004 extended with stale-DELETE→409 + fresh-DELETE-succeeds + header-less-DELETE-still-works cases. |
| 15.5 | 5c9ceeeb0 | Coverage-completion spec implementation-status table; docs already cover the pattern. |

## Targeted validation

| Check | Result |
|-------|--------|
| `yarn build:packages` | ✓ (exit 0) |
| `yarn generate` | ✓ (exit 0) |
| `yarn i18n:check-sync` | ✓ all 4 locales in sync; no new keys added (reused `ui.forms.flash.recordModified`, `sales.channels.*`) |
| Core unit tests (touched) | ✓ 9/9 — `useDealFormHandlers.optimisticLock` (2), companies-v2 page (4 incl. delete-header), people-v2 page (3 incl. delete-header) |
| Typecheck (root TS 6.0.3, `./node_modules/.bin/tsc -p packages/core/tsconfig.json`) | ✓ exit 0 |
| `yarn workspace @open-mercato/core typecheck` (workspace TS 5.9.3) | ✗ env-only: `tsconfig.json(7,27): TS5103 Invalid value for '--ignoreDeprecations'` — workspace resolves TS 5.9.3 vs tsconfig `ignoreDeprecations:"6.0"`. Pre-existing on develop; root tsc 6.0.3 is clean. |
| Lint (changed files) | ✗ env-only: `eslint-plugin-react` `testReactVersion ... getFilename is not a function` crash (ESLint 10 / plugin mismatch in this worktree). Pre-existing; CI lints in a clean env. |

## UI / Playwright verification

- **Skipped locally.** The janitor sandbox has Docker but no running Postgres/Redis and no `.env`; the ephemeral integration stack (which is the authoritative Playwright env, `yarn test:integration`) could not be stood up here.
- The DELETE-path enforcement is covered by the **TC-LOCK-OSS-004** integration spec (runs in CI `ephemeral-integration` with `OM_OPTIMISTIC_LOCK=all`). The server delete-guard path in `makeCrudRoute` (`runMutationGuards` with `operation:'delete'`, `factory.ts:2591`) is entity-agnostic, so proving it for `customers.deal` proves it for `customers.company` / `customers.person` / `sales.channel` (all use auto-registered generic readers).
- Client header wiring is unit-proven (deal handler + company/people page delete-header assertions).

## Deferred (NOT in this increment)

- `sales.order` document editing (lines/adjustments/shipments/payments, status transitions) — command-style endpoints, not `makeCrudRoute` PUT. Needs command-level expected-version checks (coverage-completion spec Phase 4).
- Nested panels (deal associations/pipeline/closure, channel offer prices, document lines) — coverage-completion spec Phase 3.

These are recorded in `.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md` (implementation-status table).
