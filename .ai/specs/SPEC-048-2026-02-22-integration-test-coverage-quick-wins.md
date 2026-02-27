# SPEC-040: Integration Test Coverage Quick Wins (API Tests)

**Date:** 2026-02-22
**Updated:** 2026-02-23
**Status:** In Progress — Phase 1 complete
**Scope:** Integration test coverage improvement across all core modules

---

## Context

Baseline integration test coverage: **56.51% lines, 26.1% functions, 55.98% branches** across 102 tests.

### Test Landscape (Before This Branch)

| Type | Count | Description |
|------|-------|-------------|
| **API only** | 13 | TC-AUTH-016, TC-CAT-010, TC-TRANS-001/002/003/008, TC-SALES-020–027 (untracked) |
| **UI only** | 36 | Most of auth (001–007), sales (001–007, 010–018), early catalog, admin |
| **Hybrid** | 47 | All CRM tests, most catalog/admin tests — API fixture setup + UI validation |
| **Skipped** | 3 | TC-SALES-008/009/012 (stubs) |

**Key insight:** Only **13 out of 102 tests are pure API tests**. The vast majority are UI or Hybrid (API for fixture setup, UI for assertions). Pure API tests are the fastest to write, most stable, and directly exercise the command/handler layer where function coverage is critically low (26%).

### Added by This Branch

**15 new pure-API test files** across 6 modules, bringing the total to **117 tests** (~28 pure-API).

### Modules Still with Zero Integration Tests

workflows (18 routes), notifications (12), business_rules (9), attachments (7), planner (6), perspectives (3), feature_toggles (8, UI-only admin tests)

### Critically Undertested Files (0% function coverage)

- `sales/commands/documents.ts` — 12% lines (5,903 lines — core Quote/Order/Invoice logic)
- `sales/commands/payments.ts` — 15% lines, `shipments.ts` — 13%, `configuration.ts` — 17%
- `catalog/commands/products.ts` — 12%, `prices.ts` — 15%, `variants.ts` — 17%
- `auth/commands/users.ts` — 17%, `roles.ts` — 21%
- `customers/commands/people.ts` — 16%, `companies.ts` — 18%
- `workflows/lib/workflow-executor.ts` — 16%, `step-handler.ts` — 20%, `transition-handler.ts` — 18%
- `notifications/lib/notificationService.ts` — 16%
- `query_index/lib/engine.ts` — 9% (data query engine core)

---

## Prioritized Phases

### Phase 1 — Quick Wins (Simple CRUD modules, 15 test files) ✅ COMPLETE

Modules with straightforward CRUD APIs, no complex state. Maximum coverage gain per effort.

| Module | Routes | Tests | What's Covered |
|--------|--------|-------|----------------|
| **currencies** | 5 | 3 | Currency CRUD, exchange rate CRUD, rate fetch config |
| **staff** | 10+ | 4 | Team member CRUD, team CRUD, team role CRUD, leave request lifecycle |
| **dictionaries** | 4 | 2 | Dictionary CRUD, dictionary entries CRUD |
| **api_keys** | 1 | 1 | API key create/list/revoke via API |
| **audit_logs** | 4 | 2 | Action log read, access log read |
| **directory** | 4 | 3 | Organization CRUD, tenant CRUD, org switcher |

**Helpers created** (centralized in `packages/core/src/modules/core/__integration__/helpers/`):
- `currenciesFixtures.ts` — currency/exchange-rate/fetch-config create + cleanup ✅
- `staffFixtures.ts` — team-member/team/team-role create + cleanup ✅
- `generalFixtures.ts` — dictionaries, api_keys, directory entity create + cleanup ✅

**Module `meta.ts` files created** for: currencies, staff, dictionaries, audit_logs, directory (each exports `integrationMeta.dependsOnModules`).

**Test files:**

| File | Test ID | Scope | Status |
|------|---------|-------|--------|
| `packages/core/src/modules/currencies/__integration__/TC-CUR-001.spec.ts` | TC-CUR-001 | Currency CRUD | ✅ |
| `packages/core/src/modules/currencies/__integration__/TC-CUR-002.spec.ts` | TC-CUR-002 | Exchange rate CRUD | ✅ |
| `packages/core/src/modules/currencies/__integration__/TC-CUR-003.spec.ts` | TC-CUR-003 | Rate fetch config | ✅ |
| `packages/core/src/modules/staff/__integration__/TC-STAFF-001.spec.ts` | TC-STAFF-001 | Team member CRUD | ✅ |
| `packages/core/src/modules/staff/__integration__/TC-STAFF-002.spec.ts` | TC-STAFF-002 | Team CRUD | ✅ |
| `packages/core/src/modules/staff/__integration__/TC-STAFF-003.spec.ts` | TC-STAFF-003 | Team role CRUD | ✅ |
| `packages/core/src/modules/staff/__integration__/TC-STAFF-004.spec.ts` | TC-STAFF-004 | Leave request lifecycle | ✅ |
| `packages/core/src/modules/dictionaries/__integration__/TC-DICT-001.spec.ts` | TC-DICT-001 | Dictionary CRUD | ✅ |
| `packages/core/src/modules/dictionaries/__integration__/TC-DICT-002.spec.ts` | TC-DICT-002 | Dictionary entries CRUD | ✅ |
| `packages/core/src/modules/core/__integration__/admin/TC-ADMIN-012.spec.ts` | TC-ADMIN-012 | API key CRUD via API | ✅ |
| `packages/core/src/modules/audit_logs/__integration__/TC-AUD-001.spec.ts` | TC-AUD-001 | Action log read | ✅ |
| `packages/core/src/modules/audit_logs/__integration__/TC-AUD-002.spec.ts` | TC-AUD-002 | Access log read | ✅ |
| `packages/core/src/modules/directory/__integration__/TC-DIR-001.spec.ts` | TC-DIR-001 | Organization CRUD | ✅ |
| `packages/core/src/modules/directory/__integration__/TC-DIR-002.spec.ts` | TC-DIR-002 | Tenant CRUD | ✅ |
| `packages/core/src/modules/directory/__integration__/TC-DIR-003.spec.ts` | TC-DIR-003 | Organization switcher | ✅ |

### Bug Fixes Found During Phase 1

The following production bugs were discovered and fixed while writing tests:

1. **`currencies/commands/currencies.ts`** — `buildChanges` returned `undefined`-valued keys that would overwrite real data on partial updates. Now filters out entries where `.to` is `undefined` before applying.
2. **`currencies/commands/exchange-rates.ts`** — Same `buildChanges` undefined-filtering bug as currencies.
3. **`currencies/api/exchange-rates/route.ts`** — `DELETE` handler `mapInput` was using `parsed.body` (empty for DELETE requests). Fixed to extract `id` from query string, matching the currencies route pattern.

---

### Phase 2 — Medium Effort (~12 test files)

Modules with more endpoints or logic requiring richer fixture setup.

| Module | Routes | Tests | What's Covered |
|--------|--------|-------|----------------|
| **notifications** | 12 | 4 | List + read/dismiss, batch ops, settings, role/feature config |
| **feature_toggles** | 8 | 3 | Global toggle CRUD, override CRUD, check endpoints |
| **business_rules** | 9 | 3 | Rule set CRUD, rule CRUD + ordering, rule execution |
| **attachments** | 7 | 2 | File upload + library CRUD, image retrieval + partitions |

**Test files:**

| File | Test ID | Scope |
|------|---------|-------|
| `packages/core/src/modules/notifications/__integration__/TC-NOTIF-001.spec.ts` | TC-NOTIF-001 | Notification list + read/dismiss |
| `packages/core/src/modules/notifications/__integration__/TC-NOTIF-002.spec.ts` | TC-NOTIF-002 | Batch operations |
| `packages/core/src/modules/notifications/__integration__/TC-NOTIF-003.spec.ts` | TC-NOTIF-003 | Notification settings |
| `packages/core/src/modules/notifications/__integration__/TC-NOTIF-004.spec.ts` | TC-NOTIF-004 | Role/feature notification config |
| `packages/core/src/modules/feature_toggles/__integration__/TC-FT-001.spec.ts` | TC-FT-001 | Global toggle CRUD |
| `packages/core/src/modules/feature_toggles/__integration__/TC-FT-002.spec.ts` | TC-FT-002 | Override CRUD |
| `packages/core/src/modules/feature_toggles/__integration__/TC-FT-003.spec.ts` | TC-FT-003 | Check endpoints (boolean/string/number/json) |
| `packages/core/src/modules/business_rules/__integration__/TC-BR-001.spec.ts` | TC-BR-001 | Rule set CRUD |
| `packages/core/src/modules/business_rules/__integration__/TC-BR-002.spec.ts` | TC-BR-002 | Rule CRUD + ordering |
| `packages/core/src/modules/business_rules/__integration__/TC-BR-003.spec.ts` | TC-BR-003 | Rule execution |
| `packages/core/src/modules/attachments/__integration__/TC-ATT-001.spec.ts` | TC-ATT-001 | File upload + library CRUD |
| `packages/core/src/modules/attachments/__integration__/TC-ATT-002.spec.ts` | TC-ATT-002 | Image retrieval + partitions |

---

### Phase 3 — Higher Effort (~8 test files)

Complex stateful modules requiring multi-step fixture chains.

| Module | Routes | Tests | What's Covered |
|--------|--------|-------|----------------|
| **workflows** | 18 | 5 | Definition CRUD, instance lifecycle, user tasks, signals, events |
| **planner** | 6 | 3 | Availability rule sets, weekly/date-specific rules, access |

---

### Phase 4 — Deepen Existing Module Coverage

Additional API tests for already-tested modules targeting untested endpoints (command files at 12–20%).

| Module | Untested Endpoints | Est. Tests |
|--------|-------------------|-----------|
| **sales** | shipment/order/order-line statuses, document numbers/addresses, delivery windows, notes, tags, dashboard widgets | 5–8 |
| **catalog** | offers, option-schemas, product-media | 3–4 |
| **customers** | dashboard widgets, address format settings, check-phone | 2–3 |
| **auth** | session refresh, sidebar preferences, features list | 2–3 |

---

## Implementation Approach

All new tests follow the pure API pattern:
- Import `apiRequest`, `getAuthToken` from `@open-mercato/core/modules/core/__integration__/helpers/api`
- `try/finally` with nullable IDs for safe cleanup
- Fixtures created via API POST, never UI navigation
- Assert HTTP status codes with descriptive messages (`'POST /api/path should return 201'`)
- Clean up created records in `finally` via `deleteEntityIfExists`-style helpers
- No per-test timeout/retry overrides
- `encodeURIComponent` on all ID values in query strings
- Unique resource names via `Date.now()` suffixes to avoid conflicts
- `getOrgContextFromToken()` to extract `organizationId`/`tenantId` from JWT for multi-tenant-aware fixtures

Per module:
1. Create `__integration__/` directory with `meta.ts` declaring `dependsOnModules` ✅
2. Add fixture helpers in `core/__integration__/helpers/` (centralized) ✅
3. Write CRUD happy path first, then edge cases as separate test files ✅
4. Verify each test passes before moving on ✅

## Verification

1. **Start ephemeral environment** before any test runs:
   - Check `.ai/qa/ephemeral-env.json` — reuse if `status: running`
   - Otherwise: `yarn test:integration:ephemeral:start`
   - Use `BASE_URL` from `ephemeral-env.json` for all test runs

2. **Per-test verification** (fail-fast during development):
   ```bash
   npx playwright test --config .ai/qa/tests/playwright.config.ts <path-to-test> --retries=0
   ```

3. **Phase-level suite run** after completing each phase:
   ```bash
   yarn test:integration:ephemeral
   ```

4. **Coverage check** after each phase:
   - Re-run with coverage enabled, compare `coverage-summary.json` totals
   - Verify function coverage is climbing (main target metric)

5. **Data isolation check**: confirm no test relies on seeded/demo data and all created records are cleaned up in `finally` blocks
