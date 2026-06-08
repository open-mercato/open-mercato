# Pre-Implementation Analysis: Timesheets — Projects Portfolio View

Analyses spec [`.ai/specs/2026-04-24-timesheets-projects-portfolio-view.md`](../2026-04-24-timesheets-projects-portfolio-view.md).

## Executive Summary

Spec is **ready to implement with minor corrections**. Schema, ACL, indexes, and component namespaces all align with reality. One factual error (entity ID format) and three documentation gaps must be fixed in the spec before Phase A step 3. Zero backward-compatibility violations detected — the feature is read-only and additive across every contract surface.

**Recommendation:** Apply the four fixes below to the spec, then proceed with implementation as scoped.

---

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| — | — | None detected across all 13 contract surfaces. Feature is additive: new routes, new optional query params, new namespaced response fields (`_staff`). No column renames, no event renames, no type-shape changes. | — | — |

### Missing BC Section

The spec covers BC inside the **Risks & Impact Review** table and **Final Compliance Report**, but does not have a dedicated `## Migration & Backward Compatibility` section. Low impact for a pure additive feature, but recommended for consistency with `BACKWARD_COMPATIBILITY.md` expectations.

---

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| Migration & Backward Compatibility | Cosmetic — BC is already covered inline | Add a short dedicated section that explicitly states "all changes are additive; no deprecations required" |
| Integration Test Coverage | Medium — tests referenced per step, not enumerated | Add a list under Phasing of every API path and UI path with the scenarios to cover (per `AGENTS.md`: "every new feature MUST list integration coverage") |
| i18n Keys Plan | Low — keys mentioned but not enumerated | Enumerate the specific `staff.timesheetsProjects.*` keys (tab labels, KPI card labels, column headers, empty states) so the implementer has a checklist |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| Architecture — Response Enrichers | Spec states `targetEntity: 'staff.time_project'` (dot, singular) | **CRITICAL factual fix.** Canonical form in this repo is `staff:staff_time_project` (colon, with module prefix) — confirmed in `packages/core/generated/entities.ids.generated.ts` and existing usage at `api/timesheets/time-projects/route.ts:67` and `search.ts`. Using the wrong ID means the enricher would never fire. |
| API Contracts — KPI endpoint | No mention of how `include` query param is validated | Spec should state: parse with `z.string().optional().transform(splitCsv)` + `z.enum(['hoursWeek','hoursTrend','members','myRole']).array()`. Unknown values rejected silently (dropped) — safer for future additions. |
| Security — Data encryption | Spec doesn't mention `findWithDecryption` | If `StaffTimeProject` / `StaffTeamMember` fields fall under the tenant encryption feature flag, the enricher and KPI endpoint MUST use `findWithDecryption` / `findAndCountWithDecryption`, not raw `em.find`. Confirm encryption scope for these entities and document the choice. |
| UI — Empty states | Spec covers sparkline empty state (`all-zero → flat zinc-200 line`) but not card/table empty states for "Mine" filter with zero assigned projects | Add one-liner: "When the `Mine` tab is empty, render a friendly empty-state card with 'You aren't assigned to any projects yet.'" |

---

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|---|---|---|
| Entity IDs must match canonical `module:entity_name` format | Spec Architecture → Response Enricher: `targetEntity: 'staff.time_project'` | Change to `staff:staff_time_project` |
| Every API route must export `openApi` | Spec API Contracts section | Already stated ✓ — no change needed, just flagging that the KPI endpoint will need this at implementation time |
| `findWithDecryption` for entity queries | Spec Architecture → Data Flow | Add an explicit note: "All DB reads from the enricher and KPI endpoint go through `findWithDecryption` or `findAndCountWithDecryption` when the entity is encryption-scoped" |
| `useGuardedMutation` for non-CrudForm writes | N/A | Not applicable — feature is read-only |
| Button/IconButton primitives (from `.ai/lessons.md`) | UI Components — `ViewModeToggle` | Spec says "Two-segment control" — implementer must use `Button` (not raw `<button>`) with `variant="ghost"` pattern and explicit `type="button"` |
| Page-level components need replacement handles (component-replaceability section of implement-spec skill) | Spec UI Components | Consider assigning handles: `section:staff.projects-kpi-strip`, `section:staff.projects-saved-view-tabs`, `data-table:staff.time_project`, `section:staff.projects-cards`. Document once implementation lands. |

### Pass (No Action)

- Code placement correct (`packages/core/src/modules/staff/...`)
- Tenant scoping called out in Security section
- ACL features exist in `acl.ts` — no new features needed
- No cross-module ORM relationships introduced
- i18n via `useT()` / `resolveTranslations()` declared
- `DataTable` reused for table view
- No new events / subscribers / commands introduced (pure read feature) — avoids Commands/Events sections entirely

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Enricher N+1 across project list | Backend latency on medium orgs (50+ projects) | Spec already requires batched `enrichMany` — implementer must verify with EXPLAIN; add a unit test asserting the enricher issues ≤ 2 queries for N projects |
| Collab sees PM-only fields (`members`) via URL manipulation | Data isolation breach | Enricher MUST gate `members` emission on `rbacService.userHasAllFeatures(userId, ['staff.timesheets.projects.manage'], scope)`. Add integration test asserting Collab response never contains `members`. Spec already flags this — move it to an explicit test scenario. |
| Wrong entity ID means enricher silently never runs | Feature appears broken with no error | Add a startup assertion in dev: `enricher.targetEntity` must appear in `generated/entities.ids.generated.ts`. Alternatively, import `E.staff.staff_time_project` instead of hardcoding the string. |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| KPI aggregate slow at high entry volume | Dashboard load >500ms | Use existing indexes (`staff_time_entries_project_date_idx` confirmed present). Cap aggregation to 7 weeks. Add per-request profiling via `OM_PROFILE`. |
| Date bucketing edge cases (ISO week vs calendar week, timezone) | Sparkline numbers off by one week at year boundaries | Document: use ISO 8601 week numbering with `date_trunc('week', date AT TIME ZONE 'UTC')`. Unit test around 2026-12-28 → 2027-01-04 transition. |
| `staff.time_project.role` column values might include values beyond `Lead`/`Contributor` | UI shows blank / unexpected strings | Check existing data + validator. If free-form, the UI should fall back to the raw string; if enum, the spec should list the exact accepted values. |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `localStorage` view mode resets across devices | Minor user annoyance | Documented in spec as accepted |
| Sparkline SVG renders poorly on very narrow viewports | Visual regression on mobile | Page is desktop-backoffice per CLAUDE.md; acceptable |
| Customer name lookup (`customer_id` → display) adds a query | Extra join | Spec already uses FK IDs across modules — reuse existing customer enricher or leave as ID-only (customer name comes from `staff_time_projects.customer_id` join already in the current table) |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

1. **Entity ID format** — spec's `staff.time_project` will not match the registry. Change to `staff:staff_time_project` (or import `E.staff.staff_time_project`) before implementation.

### Important Gaps (Should Address)

1. **Encryption posture** — confirm which of `StaffTimeProject`, `StaffTimeProjectMember`, `StaffTimeEntry`, `StaffTeamMember` are encryption-scoped and document the helper to use in every new query.
2. **`include` parsing rules** — zod schema for the new query param + behaviour on unknown values.
3. **Role values in `StaffTimeProjectMember.role`** — confirm if it's an enum (list values) or free text (fallback to raw string).
4. **Integration test scenarios enumerated** — list them in the spec per AGENTS.md rule ("every new feature MUST list integration coverage for all affected API paths and key UI paths").
5. **i18n keys enumerated** — provide a checklist of keys to add under `staff.timesheetsProjects.*`.

### Nice-to-Have Gaps

1. **Replacement handles** — assign and document handles for new page-level components (enables third-party component replacement).
2. **Migration & BC section** — dedicated section stating "additive-only".
3. **Empty-state copy for zero-assignment Collab** — one-liner in UI section.

---

## Remediation Plan

### Before Implementation (Must Do)

1. **Fix entity ID** in spec Architecture and API Contracts sections: `staff.time_project` → `staff:staff_time_project` (or switch to `E.staff.staff_time_project` import).
2. **Clarify encryption posture** for staff time entities; add one line in Security section stating which helper is used (`findWithDecryption` vs `em.find`).
3. **Enumerate integration test scenarios** — list API + UI paths explicitly. Minimum set:
   - `GET /api/timesheets/projects/kpis` returns PM shape for PM user, Collab shape for Collab user
   - `GET /api/timesheets/projects/kpis` → 401 unauthenticated, 403 missing feature
   - `GET /api/timesheets/projects/kpis` → org-scoped (cross-tenant leakage test)
   - `GET /api/timesheets/time-projects?include=hoursTrend,members` returns `_staff` namespace on each item
   - `GET /api/timesheets/time-projects?include=...` returns enrichment for PM but omits `members` for Collab
   - `GET /api/timesheets/time-projects?mine=1` filters to membership subset
   - UI: PM view toggle persists across reloads
   - UI: Collab user sees 3 KPIs and no avatar stack
   - UI: saved-view tabs update URL query params and filter the list
4. **Enumerate i18n keys** in the spec as a checklist (tab labels, KPI labels, column headers, empty states, sparkline aria-label, KPI delta announcements).

### During Implementation (Add to Spec)

1. **Replacement handles** for new components, document in staff module AGENTS.md.
2. **Role-value handling** for `StaffTimeProjectMember.role` — discovered during step 1 (backend helpers).
3. **Week-boundary unit test** on `computeProjectHoursTrend` for year transitions.

### Post-Implementation (Follow Up)

1. Add release-note entry about the new `/api/timesheets/projects/kpis` endpoint and the new `include` + `mine` query params.
2. Update [`.ai/lessons.md`](../../lessons.md) if new patterns or pitfalls emerge during implementation (e.g., ISO-week SQL helper choice).

---

## Recommendation

**Needs spec updates first** — four small edits to the spec (entity ID fix + encryption posture + integration test list + i18n key list). None are architectural; all can be applied in a single pass, and implementation can start immediately after.

No backward-compatibility blockers. No schema blockers. No ACL blockers. No UI collisions.
