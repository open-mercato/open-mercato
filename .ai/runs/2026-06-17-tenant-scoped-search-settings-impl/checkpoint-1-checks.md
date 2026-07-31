# Checkpoint 1 — Phase 1 (core ModuleConfig tenant scoping)

**UTC:** 2026-06-17T14:3x:00Z
**Steps covered:** 1.1 → 1.3 (commits 5c33bf349 / 316b41f12 / f479bb87e; pushed head 15cd812a1)
**Packages touched:** `@open-mercato/core` (`src/modules/configs/*`)

## Checks

| Check | Scope | Result |
|-------|-------|--------|
| Unit — new service tests | `module-config-service.test.ts` | ✅ 5/5 pass |
| Unit — configs regression | `src/modules/configs` (7 suites) | ✅ 41/41 pass |
| Compile — `yarn build:packages` | all packages | ✅ 21/21 tasks successful (exit 0) |
| `yarn typecheck` (full) | core | deferred to final gate — needs `yarn generate` barrels on a fresh worktree |
| `yarn db:generate` drift probe | configs | deferred to final gate — snapshot hand-authored to MikroORM expression-index format (mirrors `record_locks` partial unique index) |
| UI / Playwright | — | N/A — Phase 1 touches no UI |

## Notes

- Migration `Migration20260617150000.ts` authored by hand (coding-agent exception); NOT applied (`yarn db:migrate` not run, per project rule). Both `.snapshot-open-mercato.json` and `.snapshot-openmercato.json` updated identically.
- Partial unique indexes expressed via `@Index({ expression })` so the entity metadata round-trips with the snapshot (no `db:generate` drift expected).
- Cache coherence: global (no-scope) writes bust the module cache tag so inheriting tenants re-resolve immediately; scoped writes only write their own key.

## BC

- `ModuleConfigService` gains an optional `scope` arg on every method; the no-scope path resolves the global row (`tenant_id IS NULL`) exactly as before. `restoreDefaults` unchanged in behavior (seeds global rows). `ModuleConfigRecord` gains additive fields (`tenantId`/`organizationId`/`source`) — read-only consumers unaffected.
