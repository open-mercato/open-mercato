# Pre-Implementation Analysis: SPEC-069 — Core Timesheets

## Executive Summary

SPEC-069 is **well-structured and thorough** — it covers all required sections, has a detailed compliance report, and introduces **no backward compatibility violations** since it's entirely additive (new tables, new events, new features, new routes). The spec is **ready for Phase 1 implementation** with 3 verified findings to address during implementation.

**Critical finding**: The spec defines `TimeEntry.date` as `text (YYYY-MM-DD)` but the analytics aggregation engine only works with native `date`/`timestamp` types. This must be changed to `date` type before implementation.

**Recommendation: Ready to implement after addressing the 3 verified findings below.**

---

## Backward Compatibility Audit (13 Surfaces)

### Violations Found

| # | Surface | Issue | Severity | Status |
|---|---------|-------|----------|--------|
| — | — | — | — | **No violations** |

### Analysis per Surface

| # | Surface | Classification | Impact |
|---|---------|---------------|--------|
| 1 | Auto-discovery file conventions | No change | Extends existing `acl.ts`, `setup.ts`, `data/entities.ts`, `data/validators.ts`, `search.ts`, `events.ts`, `commands/index.ts`. All additive. New files follow convention (`analytics.ts`, `api/timesheets/*`, `backend/*`, `widgets/dashboard/*`) |
| 2 | Type definitions & interfaces | No change | No existing types modified. New Zod schemas added to `validators.ts` |
| 3 | Function signatures | No change | No existing functions modified |
| 4 | Import paths | No change | No modules moved |
| 5 | Event IDs | No change | New events only (`staff.timesheets.time_entry.*`, `staff.timesheets.time_project.*`). Existing staff events untouched |
| 6 | Widget injection spot IDs | No change | No existing spots modified. New dashboard widgets registered |
| 7 | API route URLs | No change | New routes only under `/api/staff/timesheets/*`. Existing staff routes untouched |
| 8 | Database schema | No change (Phase 1) | New tables only: `staff_time_entries`, `staff_time_entry_segments`, `staff_time_projects`, `staff_time_project_members`. No ALTER on existing tables. Phase 2 adds column to `staff_time_entries` with `NOT NULL DEFAULT` (non-breaking) |
| 9 | DI service names | No change | No DI registrations renamed |
| 10 | ACL feature IDs | No change | New features only (`staff.timesheets.*`). Existing staff features untouched |
| 11 | Notification type IDs | N/A | No notifications in Phase 1 (Phase 2 will add approval notifications) |
| 12 | CLI commands | No change | No CLI changes |
| 13 | Generated file contracts | No change | New `analytics.ts` will be auto-discovered by generator. No existing generated exports modified |

### Migration & Backward Compatibility Section

Present in spec (lines 814-831). Phase 1: new tables only, zero-downtime. Phase 2: additive column with default.

---

## Spec Completeness

### Required Sections Check

| Section | Present | Quality |
|---------|---------|---------|
| TLDR & Overview | Yes | Clear scope per phase |
| Problem Statement | Yes | Concise |
| Proposed Solution | Yes | Design decisions + alternatives table |
| Architecture | Yes | Module files, commands, events, ACL, setup all defined |
| Data Models | Yes | 5 entities with full field specs, phase boundaries marked |
| API Contracts | Yes | All routes with methods, paths, auth, features, request/response |
| UI/UX | Yes | ASCII mockups, sidebar placement, interaction behavior |
| Risks & Impact Review | Yes | 7 risk scenarios with severity + mitigation |
| Phasing | Yes | 3 phases clearly separated |
| Implementation Plan | Yes | 9 steps for Phase 1, 5 steps for Phase 2 |
| Integration Test Coverage | Yes | 17 API tests + 5 UI tests for Phase 1 |
| Final Compliance Report | Yes | Full matrix against all AGENTS.md files |
| Changelog | Yes | Two entries |

### Missing Sections

None. All required sections are present and complete.

### Minor Gaps in Existing Sections

| Section | Gap | Impact | Recommendation |
|---------|-----|--------|---------------|
| Data Models | `TimeProject.customer_id` is FK to `customer_entities.id` but API contract says `customerId` is **required** on create. Should it be nullable? Projects without a customer should be allowed (internal projects) | Low | Verify during Step 2 — make `customer_id` nullable if internal projects are valid |
| Data Models | `TimeProject.billing_mode` and `default_currency` listed in Phase 1 entity table but noted as Phase 3 additions | Cosmetic | Clarify in entity definition that these columns are NOT created in Phase 1 migration |
| API Contracts | Bulk save response returns `{ ok, created, updated, deleted }` but error response (422) returns `{ ok, errors[] }`. No mention of HTTP status for success | Low | Use 200 for success — clarify during implementation |
| Cache Strategy | Dashboard widget cache invalidation references `widget-data` tags but no detail on how staff module triggers invalidation on that tag | Low | Implement via event subscriber that invalidates `widget-data:staff:staff_time_entries` tag |

---

## AGENTS.md Compliance

### Compliance Matrix (from spec's own report)

The spec includes a comprehensive compliance matrix (lines 1128-1194) covering all relevant AGENTS.md files. All items pass.

### Additional Checks

| Rule | Status | Notes |
|------|--------|-------|
| `analytics.ts` must be created (new file) | Spec mentions it | Staff module currently has no `analytics.ts` — must be created from scratch |
| Dashboard widgets directory must be created | Spec mentions it | Staff module currently has no `widgets/dashboard/` — must be created |
| `api/interceptors.ts` for self-scope enforcement | Not explicitly in spec | Spec says "enforcement is implemented in existing dashboard widget data endpoint handling" — actual implementation needs to decide: interceptor vs. direct route modification |
| `findWithDecryption` usage | Compliant | Noted in architecture section |
| No `any` types | N/A | Implementation concern, not spec concern |
| Command pattern with undo | Compliant | Full command table with undo contracts |
| Keyboard shortcuts (Cmd+Enter, Escape) | Compliant | Mentioned for Add Project and Add Employee modals |

### Violations

None found.

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `date` field on `TimeEntry` is `text (YYYY-MM-DD)` — analytics aggregation engine may expect `timestamp`/`date` type for date range filtering | Dashboard summary widget may fail if aggregation SQL doesn't handle text dates | Verify `buildAggregationQuery()` handles text-type date fields. If not, use `date` column type instead of `text` in entity definition |
| Timer left running indefinitely (no auto-stop) | Inaccurate time data, inflated hours | Spec mentions background worker for >24h detection. This worker is NOT in Phase 1 file manifest — should be added or deferred explicitly |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Self-scope enforcement for dashboard widget — spec says "implemented in existing dashboard widget data endpoint handling" but this logic doesn't exist yet | Employee could see other employees' aggregated hours in summary widget | Implement via API interceptor (`api/interceptors.ts`) or custom filter injection in route |
| Large monthly grid with many projects — bulk save of 200 entries in single transaction | DB lock contention if entries span many projects | `withAtomicFlush({ transaction: true })` already specified. 200 is reasonable limit |
| `TimeProject.code` unique constraint scoped to `(organization_id, tenant_id)` — race condition on concurrent creates | Duplicate code error on concurrent requests | Handled by DB unique constraint + 409 response |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Search reindexing on project CRUD | Minor delay on save | Standard pattern, well-handled by existing search infrastructure |
| Cache invalidation complexity (5 cache keys, multiple invalidation chains) | Stale data shown briefly | TTLs are short (1-5 min), acceptable trade-off |
| Phase 2 migration adds `status` column to `staff_time_entries` | Brief metadata lock | PostgreSQL 11+ handles `NOT NULL DEFAULT` without row rewrite |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

None. The spec is comprehensive enough to begin implementation.

### Important Gaps (Should Address During Implementation)

| Gap | What's Needed |
|-----|---------------|
| **Self-scope enforcement mechanism** | Decide: API interceptor in `staff/api/interceptors.ts` vs. modification of `dashboards/api/widgets/data/route.ts`. Interceptor approach is recommended per AGENTS.md patterns |
| **`staffMemberId` resolution helper** | Need a utility to resolve current user's `staff_team_members.id` from `auth.userId`. Check if this already exists in staff module |
| **Timer auto-stop worker** | Spec mentions background worker for >24h running timers but it's not in Phase 1 file manifest. Either add to Phase 1 or explicitly defer |
| **`analytics.ts` date field type** | Verify that the analytics aggregation engine (`buildAggregationQuery`) can handle `text` type date fields, or use native `date` column type |

### Nice-to-Have Gaps

| Gap | What's Needed |
|-----|---------------|
| **Portuguese (pt) i18n** | Spec only defines `en.json` keys. For your company, you'll need `pt.json` translations |
| **`notifications.ts`** | Not needed for Phase 1 but Phase 2 approval notifications will need it. Plan ahead |
| **Export functionality** | "My Timesheets" has an Export button in mockup but no API contract or format defined. Likely deferred |

---

## Remediation Plan

### Before Implementation (Must Do)

1. **Verify analytics date handling**: Check if `buildAggregationQuery()` supports `text` date fields or if `TimeEntry.date` should use native `date` type
2. **Decide self-scope strategy**: API interceptor (recommended) vs. direct route modification for dashboard widget data endpoint
3. **Check for existing `staffMemberId` resolver**: Look for existing utility that maps `userId` → `staff_team_members.id`

### During Implementation (Add to Spec)

1. **Create `api/interceptors.ts`** for self-scope enforcement on dashboard widget data endpoint
2. **Clarify `customer_id` nullability** on `TimeProject` — internal projects without a customer should be supported
3. **Defer timer auto-stop worker** explicitly to Phase 1.5 or Phase 2 if not implementing now
4. **Add `analytics.ts` to file manifest** — it's mentioned in the spec but not in the Phase 1 file manifest table (line 989 has it, confirmed)

### Post-Implementation (Follow Up)

1. **Add Portuguese translations** (`i18n/pt.json`) for your company deployment
2. **Plan Phase 2 notifications** — `notifications.ts` + `notifications.client.ts` for approval events
3. **Define Export endpoint** — CSV/PDF export for "My Timesheets" data
4. **Run `yarn generate`** after all files are created to regenerate analytics, search, and other generated files

---

## Verified Findings (Post-Analysis)

The following 3 items were flagged during initial analysis and verified against the codebase:

### 1. `TimeEntry.date` must use native `date` type, NOT `text` — CONFIRMED

**Status**: Must fix in implementation (deviate from spec)

The spec defines `date` as `text (YYYY-MM-DD)`. The analytics aggregation engine (`packages/core/src/modules/dashboards/lib/aggregations.ts`):
- Passes JavaScript `Date` objects for range comparisons — fails against `text` columns
- Uses `DATE_TRUNC('month', column)` for grouping — requires `date`/`timestamp`, not `text`
- All existing analytics configs (`sales:orders`, `customers:deals`, `catalog:products`) use `timestamp` type

**Resolution**: Use PostgreSQL `date` type for `TimeEntry.date` column. The column stores `YYYY-MM-DD` values either way, but native `date` enables proper SQL operations. Register as `type: 'timestamp'` in analytics field mapping (the engine treats `date` and `timestamp` equivalently for aggregation).

### 2. Self-scope enforcement requires new API interceptor — CONFIRMED

**Status**: Must implement (not in spec file manifest)

The dashboard widget data endpoint (`/api/dashboards/widgets/data`) has no existing mechanism for entity-type-specific user scoping. The spec says "implemented in existing dashboard widget data endpoint handling" but this does not exist.

**Resolution**: Create `packages/core/src/modules/staff/api/interceptors.ts` with a `before` interceptor that:
- Targets `dashboards/widgets/data` POST requests
- Checks if `entityType === 'staff:staff_time_entries'`
- If user lacks `staff.timesheets.manage_all`, injects filter `{ field: 'staffMemberId', operator: 'eq', value: <resolved staff member ID> }`
- Removes any client-supplied `staffMemberId` filter to prevent bypass

Pattern reference: `apps/mercato/src/modules/example/api/interceptors.ts` (lines 121-150) demonstrates filter injection via interceptor.

### 3. Need shared `staffMemberId` resolver utility — CONFIRMED

**Status**: Should create (prevents code duplication)

The pattern `findOneWithDecryption(em, StaffTeamMember, { userId: auth.sub, deletedAt: null })` is duplicated in:
- `staff/api/team-members/self/route.ts` (lines 62-68)
- `staff/api/leave-requests.ts` (lines 106-112, inside `resolveLeaveRequestAccess()`)

**Resolution**: Create `packages/core/src/modules/staff/lib/staffMemberResolver.ts`:
```typescript
export async function getStaffMemberByUserId(
  em: EntityManager,
  userId: string,
  tenantId: string | null,
  organizationId: string | null,
): Promise<StaffTeamMember | null>
```
Reuse in: timesheets API routes, interceptor self-scope, and refactor existing leave-requests + self routes.

---

## Recommendation

**Ready to implement Phase 1** after incorporating the 3 verified findings above:
1. Use `date` type instead of `text` for `TimeEntry.date` column
2. Add `api/interceptors.ts` to the Phase 1 file manifest for self-scope enforcement
3. Create `lib/staffMemberResolver.ts` as a shared utility

Start with Step 1 (ACL scaffold). The spec is comprehensive, well-structured, and introduces no backward compatibility risks.
