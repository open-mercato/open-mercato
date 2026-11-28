# Pre-Implementation Analysis: Dashboard v2 — Analytics Home

- **Spec:** `.ai/specs/2026-07-02-dashboard-v2-analytics-home.md`
- **Analyzed:** 2026-07-02 (om-pre-implement-spec)
- **Verdict:** **READY_WITH_CHANGES** — architecture is sound and genuinely additive, but the spec contains one incorrect BC claim (PATCH item route is NOT unaffected by the dual-shape layoutJson), two under-designed areas (custom-range/`previous_year` comparison; catalog field metadata), and one missed rollout gap (new widgets invisible to existing tenants via role-widget allowlists).

## Executive Summary

The substrate claims verified true: dnd-kit already lives in `packages/ui`, `@open-mercato/ai-assistant` is already an importable peer of core (inbox_ops precedent), `dependsOn` exists in the ACL DSL, no new entities/migrations are needed, and the integration harness exists. However, code inspection contradicts the spec in four places (below). Fix the spec first; none requires architectural rework.

## Backward Compatibility (all 13 categories checked)

### Violations / Corrections Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | API routes (§7) | Spec says "PATCH item route unchanged", but `api/layout/[itemId]/route.ts:88` calls `layout.layoutJson.findIndex(...)` directly on the stored JSON. Once PUT persists the `{items,preferences}` object shape, PATCH throws (`findIndex` undefined) → 500 for both screens. | **Critical** | Spec must include `[itemId]/route.ts` in Phase 1: read via the same dual-shape normalizer, write back preserving shape. Extend TC-DB2-003 with a PATCH-after-object-PUT assertion. |
| 2 | Type defs (§2) | `DashboardLayout.layoutJson` is typed `DashboardLayoutItem[]` with `default: []` (`dashboards/data/entities.ts:19-20`). Dual-shape storage requires widening this property type; spec's file list omits `data/entities.ts`. | Warning | Add `data/entities.ts` to touched files (type-only change, no migration — column is `json`). |
| 3 | Function sigs (§3) | `DashboardScreen` behavior swap: signature unchanged (prop-less), consumers verified — `apps/mercato/.../backend/page.tsx`, `packages/create-app/template/src/app/(backend)/backend/page.tsx`, ui-internal test. No third-party deep import of `DashboardScreen.tsx` found; docs mdx references the path textually (`apps/docs/docs/framework/dashboard/widgets-overview.mdx:59` — update). | Warning (accepted) | Legacy export + `/backend/dashboard/legacy` route + release note, as specced. Also update `packages/ui/src/backend/dashboard/__tests__/DashboardScreen.test.tsx` (imports `../DashboardScreen`) in the same change. |
| 4 | Type defs (§2) | `size: 'full'` widening: v1 `sizeClass` switch (`packages/ui/src/backend/dashboard/DashboardScreen.tsx:62-72`) has no `'full'` case — falls to default `md:col-span-1` (renders like *sm*, not *lg* as the spec claims). | Warning | Spec's "v1 renderer maps `full`→`lg`" requires an explicit one-line edit to the legacy `sizeClass`; add to Phase 2 step 5/6. |
| 5 | Doc citation | Spec cites "§27 ADDITIVE-ONLY" — `BACKWARD_COMPATIBILITY.md` has 14 numbered categories; the relevant ones are §2 (Types, STABLE — "Optional fields may be added freely"), §7 (API routes, STABLE), §8 (DB schema, ADDITIVE-ONLY), §10 (ACL IDs, FROZEN — additions fine). | Low | Fix citations. |

All other categories (events §5, spot IDs §6, DI §9, notifications §11, AI IDs §12, CLI §13, generated files §14): no changes — clean.

### Missing BC Section
Present ("Migration & Compatibility") and substantively correct apart from items 1–5 above. One internal contradiction: risk section claims "GET never mutates stored data", but the current GET already flushes normalized items on read (`api/layout/route.ts:146-148`, and `existingLayout.layoutJson = items` at :142). Reconcile: the normalizer must keep GET's persistence path shape-stable (keep writing arrays on the GET-normalize path, or explicitly accept shape upgrade there and say so).

## Verified Claims (evidence)

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Custom `{from,to}` absent today | **True** | `api/widgets/data/schema.ts:57-62` (preset-only), `services/widgetDataService.ts:59-62`; `validateRequest` rejects non-preset (`widgetDataService.ts:212`). |
| Aggregation layer ready for custom ranges | **True** | `buildAggregationQuery` already consumes concrete `{field,start,end}` dates (`lib/aggregations.ts:160-166`); presets resolve earlier in the service. Cache key hashes the whole request (`widgetDataService.ts:113-117`) so custom bounds partition automatically. |
| Comparison works for custom ranges | **False — needs design** | `widgetDataService.ts:143-144` calls `getPreviousPeriod(range, request.dateRange.preset)`; `getPreviousPeriod` switches on preset (`packages/ui/src/backend/date-range/dateRanges.ts:117-164`). Worse: `comparison.type === 'previous_year'` is validated but **ignored** — every comparison is a preset-family shift. Custom ranges have no preset. Spec must define: custom + `previous_period` → shift back by `daysDiff`; custom/any + `previous_year` → `subYears(1)` on both bounds — and decide whether to fix the ignored `previous_year` for presets in the same change (recommended; the insights API contract exposes `compare=previous_year`). |
| AnalyticsRegistry supports the catalog response | **Partial** | Registry exposes `entityId`, `requiredFeatures`, `entityConfig{tableName,dateField,defaultScopeFields}`, `fieldMappings: Record<field,{dbColumn,type}>`, `labelResolvers` (`services/analyticsRegistry.ts:10-19`, `packages/shared/src/modules/analytics.ts:5-31`). **Gaps:** (a) no human-readable labels for entities/fields — catalog `label` must be derived (humanized key) or i18n-mapped; (b) field `type` is `'numeric'|'text'|'uuid'|'timestamp'|'jsonb'` — spec's `kind: 'number'|'date'|'string'|'boolean'` does not map 1:1 (no boolean; uuid/jsonb unaccounted); (c) no per-field `aggregates`/`groupable` metadata — must be derived by type rules (numeric→sum/avg/min/max/count, all→count; groupable: text/uuid/timestamp; jsonb via dot-path like the existing groupBy fallback `widgetDataService.ts:219-226`); (d) catalog SHOULD filter entities by caller features using `requiredFeatures` (mirrors the data path) — spec is silent. |
| core→ai-assistant import legal | **True** | `@open-mercato/ai-assistant: workspace:*` is a **peerDependency** of `packages/core/package.json` (not `dependencies` — spec wording slightly off, but the import is established practice): `inbox_ops/lib/llmProvider.ts:13-17` imports `createModelFactory` from `@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory`. |
| Structured digest implementable; typed no-provider failure | **True** | `generateObject` from `ai` with zod schema (`llmProvider.ts:1`); `AiModelFactoryError` with code `'no_provider_configured'` (`model-factory.ts:288-297`, thrown at :644-656). |
| `dependsOn` supported in ACL DSL | **True** | `packages/shared/src/security/aclDependencies.ts:7` (`dependsOn?: readonly string[]` on feature descriptors); precedent `packages/core/src/modules/entities/acl.ts:7,14`. dashboards `acl.ts` uses the object form — compatible. |
| dnd-kit available where v2 lives | **True** | `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0`, `@dnd-kit/utilities ^3.2.2` are direct `dependencies` of `packages/ui/package.json` (only there). **No package.json change needed.** |
| Guard tests force v2 UI compliance | **False (but comply anyway)** | `optimistic-lock-ui-coverage.test.ts` scans `packages/core/src/modules/**/*.tsx`; the workspace variant scans `packages/<pkg>/src/modules/**` — `packages/ui` has no `src/modules`, so `packages/ui/src/backend/dashboard/v2/` is outside BOTH scans. v1 already ships raw `apiCall` PUT/PATCH un-guarded (`DashboardScreen.tsx:232-252`). Enforcement is therefore AGENTS.md-level, not test-level: v2 MUST still use `useGuardedMutation` (+ `retryLastMutation` in injection context) per `packages/ui/AGENTS.md`, and should record an explicit optimistic-lock decision (layout = per-user single-owner preference; the GET response exposes no `updatedAt` today → either thread it or document the exemption in-code). Fix the spec's Compliance Matrix line "file-level guard satisfied". |
| Integration harness exists | **True** | `packages/core/src/modules/dashboards/__integration__/TC-DASH-001-008.spec.ts` + `meta.ts` (`dependsOnModules`), with `getAuthToken`/`createUserFixture`/`setRoleAclFeatures` fixtures; UI Playwright (`page.goto`) precedent in attachments/api_keys/auth suites. |
| `yarn check:client-boundaries` exists | **True** | root `package.json` scripts: `check:client-boundaries` (+ `:fail`). |
| Route URLs auto-prefix correctly | **True** | `api/analytics/catalog/route.ts` → `/api/dashboards/analytics/catalog`; `api/insights/route.ts` → `/api/dashboards/insights` (module-id prefix convention; existing `api/widgets/data/batch` confirms). |
| i18n locales present | **True** | `dashboards/i18n/{en,de,es,pl}.json` exist; v1 screen uses `useT()`. |

## Spec Completeness

All required sections present (TLDR, Overview, Problem, Solution+Alternatives, User Stories, Architecture, Data Models, API Contracts, i18n, UI/UX + frontend contract, Migration & Compatibility, Implementation Plan/Phasing, Integration Tests, Risks, Compliance Report, Changelog).

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| API Contracts / layout | PATCH item route dual-shape handling missing (Critical #1) | Add to Existing-routes list + Phase 1 step 2. |
| API Contracts / widget-data | `previous_year` semantics + custom-range comparison undefined | Define both explicitly; add unit tests. |
| API Contracts / catalog | `label`, `kind`, `aggregates`, `groupable` derivation rules unspecified; feature filtering unspecified | Specify type→kind mapping (incl. uuid/jsonb), derivation rules, and `requiredFeatures`-based entity filtering. |
| Data Models | `data/entities.ts` type widening omitted | Add file + note "type-only, no migration". |
| Migration & Compatibility | New-widget visibility for existing tenants missing (below) | Add rollout step. |

## AGENTS.md Compliance

| Rule | Location | Fix |
|------|----------|-----|
| Setup/ACL sync: new features reach existing tenants only via `yarn mercato auth sync-role-acls` (core AGENTS.md → ACL Grant Sync) | Spec §Migration mentions role sync for defaults but not the existing-tenant sync command | Name the sync step in Phase 4 (step 14). |
| Widget visibility allowlists (dashboards-specific) | Not addressed | See Critical gap below. |
| `useGuardedMutation` for non-CrudForm writes (ui AGENTS.md) | Specced ✓ but justified with a guard test that doesn't apply | Reword; keep the requirement. |
| create-app template lockstep (`.ai/lessons.md:41-49`) | Template `backend/page.tsx` mounts `DashboardScreen` → silently gets v2 | No code change needed; add a verification note + release-note mention for standalone apps. |
| Routes export `openApi` / zod validators / DS tokens / i18n / dialogs Cmd+Enter/Esc | Specced ✓ | — |

## Risk Assessment

### High
| Risk | Impact | Mitigation |
|------|--------|-----------|
| PATCH 500s after first v2 save (Critical #1) | Both v1 and v2 resize/settings break for that user | Dual-shape read in `[itemId]/route.ts`; TC-DB2-003 PATCH-after-object-PUT case. |
| Default-screen swap regression | Landing page for all users | Already specced (legacy route, error boundaries, Playwright); adequate. |

### Medium
| Risk | Impact | Mitigation |
|------|--------|-----------|
| New widgets invisible on existing tenants | Flagship features ship dark | See Critical gap #2. |
| Comparison semantics wrong for custom ranges / `previous_year` | Wrong deltas on KPI cards + insights | Explicit design + unit tests. |
| GET-normalize flush path vs. shape upgrade | Accidental layout shape churn on read | Pure normalizer + decide/persist policy; unit tests both shapes. |

### Low
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Widget-count claim ("16") is off | Cosmetic | Actual: 18 in core src (10 dashboards + 4 customers + 2 sales + 2 staff) + 3 in create-app template. Fix or drop the number. |
| Digest cost/quality | Specced (cache 1h, numbers-first) | Adequate. |

## Gap Analysis

### Critical Gaps (Block Implementation)
- **PATCH item route dual-shape** — `api/layout/[itemId]/route.ts:88`; spec text says "unchanged". Must change.
- **New-widget visibility rollout** — `lib/access.ts:93`: `baseSet = allowedByRole.size > 0 ? allowedByRole : all`. `seedDefaults` populated admin/employee `DashboardRoleWidgets` allowlists on existing tenants, which will NOT contain `custom-metric`/`ai-insights` → both widgets invisible there. Fix: (a) give the new widgets `metadata.category: 'analytics'` or ids under `dashboards.analytics.*` so `resolveAnalyticsWidgetIds` (`lib/role-widgets.ts:23-28`) seeds them for new tenants; (b) ship an existing-tenant path — configs upgrade action calling `appendWidgetsToRoles`, or a documented CLI/sync step — in the spec.

### Important Gaps (Should Address)
- Custom-range + `previous_year` comparison design (widget-data AND insights APIs).
- Catalog metadata derivation (`label`/`kind`/`aggregates`/`groupable`) + `requiredFeatures` filtering.
- `data/entities.ts` layoutJson type widening.
- v1 `sizeClass` `'full'` case; ui dashboard test-file update after rename.
- Optimistic-lock decision for layout writes (exempt-with-reason vs. thread `updatedAt` into GET).
- `yarn mercato auth sync-role-acls` step for the two new ACL features on existing tenants.

### Nice-to-Have Gaps
- Update `apps/docs/.../widgets-overview.mdx:59` path reference; fix "§27" citations; fix widget count; note that `packages/ui/.../dashboard/index.ts` currently exports no types (spec says "unchanged types").

## Remediation Plan

### Before Implementation (Must Do — spec edits)
1. Rewrite the layout-BC paragraph: include `api/layout/[itemId]/route.ts` in the dual-shape work; extend TC-DB2-003 with PATCH-after-object-PUT.
2. Add the new-widget visibility rollout (analytics category/id convention + existing-tenant append path).
3. Specify comparison semantics for custom ranges and `previous_year` (both widget-data and insights), noting `comparison.type` is currently ignored (`widgetDataService.ts:143-144`).
4. Specify catalog derivation rules (type→kind map incl. uuid/jsonb, aggregates/groupable rules, label strategy, `requiredFeatures` filtering).
5. Add `data/entities.ts` + legacy `sizeClass` + ui dashboard test file to the touched-file list; correct the guard-test justification and "§27"/"16 widgets" wording; state the ACL sync command.

### During Implementation (Add to Spec)
1. Record the GET-normalize persistence policy decision and the layout optimistic-lock decision (exempt reason or `updatedAt` threading).
2. Keep the create-app template verified after the export swap (lessons.md lockstep rule).

### Post-Implementation (Follow Up)
1. Release note: `DashboardScreen` now renders v2; pin `DashboardScreenLegacy` to keep v1; run `yarn mercato auth sync-role-acls`.
2. Consider fixing `previous_year` for preset ranges platform-wide if descoped from this change.

## Recommendation
**READY_WITH_CHANGES** — implementable immediately after the five "Before Implementation" spec edits; no architectural revision needed.
