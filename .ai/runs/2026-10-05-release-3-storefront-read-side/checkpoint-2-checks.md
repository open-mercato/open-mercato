# Checkpoint 2 — Phase 2 (part 1: scaffold, entities, migration, admin CRUD)

**Timestamp:** 2026-10-05T12:01:57Z
**Steps covered:** 2.1–2.4-fix (384a10d53e .. a0de6848be)
**Runner:** local mode
**Touched areas:** new core module `ecommerce` (index/acl/setup/events/notifications/i18n, entities, validators, migration, admin CRUD for stores + domain/channel bindings); apps/mercato modules.ts; create-app template modules.ts + scripts/template-sync.ts.

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ pass | |
| `yarn turbo run typecheck --filter=@open-mercato/core --force` | ✅ pass | |
| `yarn workspace @open-mercato/core test src/modules/ecommerce src/__tests__` | ✅ pass | 29 suites, 307 tests |
| `yarn i18n:check-sync` | ✅ pass | |
| `yarn i18n:check-usage` | ✅ pass (advisory) | repo-wide unused-key count is pre-existing |
| create-app `template-modules-parity.test.ts` | ✅ pass | ecommerce registered in TEMPLATE_COMMENTED_MODULES |
| `yarn db:generate` drift probe | ✅ ecommerce: no changes after 2.3 | wms drift discarded (pre-existing) |
| UI verification | ⏭️ skipped | no UI in this window |
| Integration suite | ⏭️ deferred | needs applied migrations; owner approval pending |
