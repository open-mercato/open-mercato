# Code Review: `feat/crm-enhancement` vs `develop`

**Date**: 2026-03-11
**Branch**: `feat/crm-enhancement`
**Scope**: 109 files, ~20,900 lines added, ~1,032 removed across 5 commits. Major CRM enhancement adding deal lines, timeline, analytics, branches, saved views, email integration, and customer 360 dashboard.

---

## CRITICAL (7 findings — must fix before merge)

### 1. Security regression: Session invalidation removed on password change
- **Files**: `packages/core/src/modules/auth/commands/users.ts`, `authService.ts`
- `deleteAllUserSessions()` was removed from both password change and password reset flows. Compromised sessions remain valid after password change. The integration test validating this (`TC-AUTH-018.spec.ts`) was also deleted.
- **Fix**: Restore session invalidation logic and the test.

### 2. Missing tenant/org scoping on deal lookups in multiple API routes
- **Files**: `api/deals/[id]/contacts/route.ts`, `lines/route.ts`, `lines/reorder/route.ts`, `emails/route.ts`
- Use bare `em.findOne(CustomerDeal, { id })` with **no** `tenantId`/`organizationId` filter. A user in tenant A could access deals from tenant B.
- **Fix**: Add `tenantId` and `organizationId` to all `findOne` filters, use `findOneWithDecryption`.

### 3. Cross-tenant data leak in `pipeline-metrics/route.ts`
- `CustomerPipelineStage` query filters only by `pipelineId` — no tenant scoping. Leaks stage configuration across tenants.

### 4. `deal-emails.ts` command missing tenant scope checks
- Never calls `ensureTenantScope()` or `ensureOrganizationScope()`. Also throws raw `Error` instead of `CrudHttpError`, and doesn't filter `deletedAt: null` — emails can be sent against soft-deleted deals.

### 5. Workers query across ALL tenants
- `interaction-overdue.ts` and `interaction-reminder.ts` query `CustomerActivity` without any tenant/org filter.
- `email-poll.ts` passes `{}` as decryption scope — deduplication and parent lookup cross all tenants.

### 6. Deal inactivity worker uses wrong status values
- `deal-inactivity-check.ts`: Filters `status NOT IN ('won', 'lost')` but the system uses `'win'` and `'loose'` as canonical values. Deals with these statuses generate false inactivity alerts.
- **Fix**: Use `NOT IN ('won', 'lost', 'win', 'loose', 'closed')`.

### 7. Catalog: SKU uniqueness error handling removed
- `catalog/commands/variants.ts`: `rethrowVariantUniqueConstraint` deleted. Duplicate SKU now returns raw 500 instead of user-friendly field error. Test also deleted. Unrelated to CRM scope.
- **Fix**: Restore or replace with equivalent error handling.

---

## HIGH (10 findings)

| # | File(s) | Issue |
|---|---------|-------|
| 1 | `saved-views/route.ts` PUT/DELETE | No tenant scoping on `findOne` — cross-tenant update/delete of shared views |
| 2 | `saved-views/route.ts` POST | Non-null assertions `auth.orgId!` — creates global records if auth fields are null |
| 3 | `setup.ts` | `defaultRoleFeatures` misses several features from `acl.ts`; mixed wildcard + explicit listing is confusing |
| 4 | `CustomerDealEmail` | Unique constraint on `messageId` alone — two tenants receiving the same email causes cross-tenant violation. Scope to `['tenantId', 'messageId']` |
| 5 | `comments.ts` | Direct import of `User` entity from `auth` module — violates "no cross-module ORM relationships" |
| 6 | `cli.ts` | `import { SalesOrder }` from sales module — breaks module independence |
| 7 | `deal-lines.ts` | `loadDealLineSnapshot` doesn't filter `deletedAt: null` |
| 8 | `deals/[id]/contacts/route.ts` et al. | Flat `metadata.requireFeatures` for all methods; PUT requires `manage` but metadata only declares `view` |
| 9 | Missing `page.meta.ts` | Automations page and deals analytics page have no auth/RBAC guard |
| 10 | `deals/page.tsx` | Empty `catch {}` on `fetchSavedViews` silently swallows all errors |

---

## MEDIUM (18 findings)

| # | Area | Issue |
|---|------|-------|
| 1 | Analytics routes (4) | Raw SQL via string interpolation; `from`/`to` params lack date validation |
| 2 | `bulk-update/route.ts` | Direct entity mutation bypasses Command pattern — no undo, no audit, no events |
| 3 | `branches/route.ts` | Company lookup for org inheritance lacks tenant scoping |
| 4 | `saved-views/route.ts` | `nativeUpdate` for `isDefault` reset has no tenant filter |
| 5 | `purchase-history/route.ts` | Double query (paginated + summary) — summary inaccurate for >100 orders |
| 6 | Events `saved-view` | Hyphenated event ID `customers.saved-view.*` inconsistent with convention; event IDs are FROZEN — fix before release |
| 7 | ACL `customers.saved-views.manage` | Hyphenated feature ID inconsistent; feature IDs are FROZEN |
| 8 | `CustomerBranch.budget` | Entity type `string` vs validator coerces to `number` — mismatch |
| 9 | Analytics config | `isActive` mapped as `type: 'text'` but column is `boolean` |
| 10 | `CustomerDealMention` | Missing `org_tenant` index |
| 11 | 3 migrations | Missing `down()` methods (saved_views, deal_lines, deal_emails/mentions) |
| 12 | `deal-lines.ts` reorder | Missing event emission — no search reindex, no real-time UI refresh |
| 13 | `deals.ts` | `recordStageHistory` runs `em.findOne` between mutations and `flush` |
| 14 | `deals/page.tsx` | Summary mixes page-level value totals with cross-page deal counts |
| 15 | `CustomerDashboard.tsx` | 5-column grid without responsive breakpoints |
| 16 | `ActivitiesSection.tsx` | Unsafe `as Record<string, unknown>` casts |
| 17 | `saved-views.ts` | `ctx.auth?.sub ?? ''` — creates views with empty userId if auth missing |
| 18 | `deal-inactivity-check.ts` | Raw SQL operator precedence needs explicit parentheses |

---

## LOW (15 findings)

- Duplicated `resolveAuth`/`checkFeature` helpers across 5+ routes
- `any` types in multiple locations
- Missing tests for `shared.tsx` utilities
- Hardcoded 23% tax rate in seed data
- "loose" vs "lost" typo in dictionaries
- `BranchRecord` leaking snake_case to frontend
- Inline SVG styles bypassing dark mode
- Email `noreply@open-mercato.local` fallback will be rejected by mail servers
- i18n keys untranslated in es/de/pl
- `formatRelativeTime` doesn't handle future dates
- `formatDuration` returns "0m" for negative seconds
- Missing `down()` in 3 migrations
- Unused `CustomerDeal` import in `deal-inactivity-check.ts`
- `email-poll.ts` unnecessary non-null assertions
- `email-poll.ts` inconsistent handler signature vs other workers

---

## Cross-cutting observations

1. **Unrelated changes bundled in**: Auth session invalidation removal, catalog SKU error handling removal, and doc screenshot deletions should be in separate branches.
2. **Module boundary violations**: 2 direct cross-module entity imports (sales `SalesOrder`, auth `User`).
3. **Tenant scoping pattern**: New API routes mostly follow conventions well, but tenant scoping is systematically incomplete for nested resource lookups.
4. **`deal-emails` is the weakest new command**: Missing scope checks, raw errors, no soft-delete filter — the entire file needs rework.
5. **Workers need a tenant iteration pattern**: 3 of 4 new workers query across all tenants.

---

## Recommended fix priority

1. **Revert** auth session invalidation and catalog SKU changes (or move to separate PRs)
2. **Fix all tenant scoping** gaps in API routes and workers
3. **Add `page.meta.ts`** to automations and analytics pages
4. **Rework `deal-emails.ts`** command with proper scope checks and error handling
5. **Fix FROZEN identifiers** (event IDs, feature IDs) before they ship
