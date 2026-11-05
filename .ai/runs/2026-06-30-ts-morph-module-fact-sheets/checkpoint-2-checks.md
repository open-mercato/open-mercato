# Checkpoint 2 — steps 1.7 .. 1.10

**Fired:** 2026-06-30T15:40:00Z (Phase 1 closed; 4 steps landed this resume)
**Steps covered:** 1.7 (T1 customers fixture) → 1.10 (T4 malformed-source resilience)
**SHA range:** b0bbfdca2 .. 933bfc587
**Touched packages:** `packages/cli` (test-only: 4 new `__tests__` files under `src/lib/generators/`)
**Resume context:** prior autonomous run stopped at checkpoint 1 (HEAD 3da0ba94a) and was taken over per maintainer request; this checkpoint covers the takeover's Phase-1 test completion.

## Validation

| Check | Result |
|-------|--------|
| `yarn workspace @open-mercato/cli typecheck` | ✅ exit 0 |
| `yarn workspace @open-mercato/cli test -- module-facts` | ✅ 4 suites / 29 tests pass |
| i18n sync/usage | ⏭️ N/A — no locale files or user-facing strings touched |
| `yarn generate` / `build:packages` / `db:generate` | ⏭️ N/A — test-only additions; no module structure, entity, or generated-file change |

## Tests added (T1–T4, packages/cli)

| Test | File | What it locks |
|------|------|---------------|
| T1 | `module-facts.customers.fixture.test.ts` | Real source-derived customers facts (anti-drift): entities=25 colon-form, events=49, acl=21, search=6, notifications=2 (`customers.deal.won/lost`), diTokens=[], **cli=4** (`seed-dictionaries`, `seed-examples`, `seed-stresstest`, `interactions:backfill`), **tableIds=3** (companies/deals/people `.list`), hostEntityIds=[`customers:customer_entity`]. Deliberately NOT the abbreviated spec §6 example (see NOTIFY 15:20 decision). |
| T2 | `module-facts.api-auth-source.test.ts` | API-route auth is read from the registry `apis[].metadata` (per-method requireFeatures), scoped to the requested module id; missing/absent registry → empty apiRoutes + warning. |
| T3 | `module-facts.bc-resolve.test.ts` | Cross-module BC resolve guard over all 9 D5 modules: entity ids colon-form + module-prefixed + unique; event/acl/notification ids module-prefixed; events + acl unique; `searchEntities ⊆ entities`; `hostTokens.entityIds ⊆ entities` and end with `_entity`; allowlist == emitted module set. |
| T4 | `module-facts.malformed-source.test.ts` | Resilience: malformed/missing/syntactically-broken convention files yield empty sections + warnings and never throw (search/notifications/cli warnings asserted; empty module → all-empty facts). |

## UI verification
N/A — this window touched only `packages/cli` unit tests. No frontend/backend/portal/widget surface. Skipped per the UI-checks-never-block rule.

## Verdict
PASS. Phase 1 (extractor + emitter + generate wiring + T1–T4) is complete and green. Next: Phase 2 — Step 2.1 author the conceptual `.ai/guides/module-system.md` (Layer 1), then 2.2 dedup migrated prose from the core package guide.
