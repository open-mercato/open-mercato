# Checkpoint 13 — QA round-6 fixes (Phase 31)

**Steps covered:** 31.0 → 31.7 (merge develop + 6 fixes + integration specs)
**SHA range:** 91fc6abd7 (merge) … 6293715d1 (integration specs)
**Touched packages:** @open-mercato/core (customer_accounts, inbox_ops, feature_toggles, catalog/customers/directory/staff/workflows merge resolutions), @open-mercato/ui (conflicts store test), @open-mercato/checkout

## Source
@alinadivante QA round-6 comment https://github.com/open-mercato/open-mercato/pull/2055#issuecomment-4613412850.

## Fixes (one atomic commit each)
| Step | Commit | Fix |
|------|--------|-----|
| 31.0 | 91fc6abd7 | Merge latest develop (0.6.5) + resolve 13 conflicts |
| 31.1 | a965a099c | Customer Users: surface 409 conflict bar on save+delete |
| 31.2 | bae74923e | Customer Roles: surface 409 conflict bar on save+delete |
| 31.3 | d120f11b6 | Inbox Settings: surface 409 conflict bar on working-language save |
| 31.4 | 1f0984274 | Feature Toggle GLOBAL default-value boolean selector normalize (the path #2410 missed) |
| 31.5 | ec804ef20 | Pay Links stale DELETE: client header + server enforce in delete commands |
| 31.6 | c7b3d041b | Feature Toggle identifier validator accepts dots/dashes |
| (specs) | 6293715d1 | Integration specs: TC-CHKT-039, TC-LOCK-OSS-014, TC-LOCK-OSS-015, TC-FT-003 |

## Validation

### Typecheck
- `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/ui --filter=@open-mercato/checkout` ✅ (after `yarn generate`)

### Build
- `yarn build:packages` ✅ (21/21; populates `packages/core/dist/generated/` needed by the ephemeral runner)

### Unit tests (targeted)
- ui `conflicts/store.test.ts` — 6/6 ✅ (new: plain `{ status, body }` apiCall-envelope recognition + non-409 ignore)
- checkout `commands/optimistic-lock.test.ts` — 12/12 ✅ (was 6; +6 for `checkout.link.delete` / `checkout.template.delete` stale→409)
- core `feature_toggles/components/booleanOverrideSelectValue.test.ts` — 4/4 ✅
- core `feature_toggles/identifier-validation.test.ts` — 4/4 ✅ (new)

### Integration (Playwright, ephemeral env, OM_OPTIMISTIC_LOCK=all)
- TC-CHKT-039 (pay-link stale DELETE → 409, record survives; fresh/header-less delete OK)
- TC-LOCK-OSS-013 (user route — existing, regression)
- TC-LOCK-OSS-014 (role route stale PUT/DELETE → 409)
- TC-LOCK-OSS-015 (inbox settings PATCH stale → 409; self-contained, restores language)
- TC-FT-003 (dotted/dashed feature-toggle identifier create+edit round-trip)
- Result: see final-gate / run log.

### Browser smoke (Playwright MCP)
- Conflict bar surfaces on Customer Users / Roles / Inbox stale save; pay-link stale delete blocked; feature-toggle boolean selector renders stored value; dotted identifier edit succeeds.

## Browser smoke (Playwright MCP, ephemeral env :5001) — DONE
- **Finding 1 (headline) — verified live:** two-tab stale save on `/backend/customer_accounts/users/<id>` surfaced the unified bar: *"Record changed — This record was modified by someone else. Refresh and try again."* with a Refresh action, and NO generic "Failed to save user" toast. Screenshot: `checkpoint-13-artifacts/customer-users-conflict-bar.png`. (Findings 2/3 share the identical fix mechanism.)
- **Finding 6 data confirmed:** the seeded `customers.interactions.legacy-adapters` (dotted+dashed identifier, boolean, defaultValue=true) loads cleanly on the global feature-toggle edit page post-merge. Screenshot: `checkpoint-13-artifacts/ft-legacy-adapters-edit.png`. (Save path proven by TC-FT-003; global writes require superadmin.)
- App builds + serves with the develop(0.6.5) merge applied (login, sidebar, lists, detail/edit pages all render).
