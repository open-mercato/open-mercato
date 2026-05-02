# Pre-Implementation Analysis: Materials Master Data — Phase 1

**Target spec:** [`.ai/specs/2026-05-02-materials-master-data.md`](../2026-05-02-materials-master-data.md)
**Analyst:** agent (pre-implement-spec skill)
**Date:** 2026-05-02

## Executive Summary

The spec is architecturally sound and namespace-clean (no collisions on event IDs, ACL features, API routes, tables, or `entityType`). Cross-module FK targets exist and match the spec's references. **However, four concrete dependencies referenced in the spec do not exist in the codebase as written, and one reusable widget injection target is unregistered.** None require redesign — all are surface-level fixes — but they are blockers for Steps 8, 13, and 14 unless resolved. Recommendation: **needs spec updates first** (≈30 minutes of edits), then ready to implement.

## Backward Compatibility

### Violations Found

No backward-incompatible changes proposed. The spec is purely additive across all 13 contract surfaces:

| # | Surface | Verdict |
|---|---------|---------|
| 1 | Auto-discovery file conventions | ✅ Adds new module-internal files following the existing convention |
| 2 | Type definitions & interfaces | ✅ New types only |
| 3 | Function signatures | ✅ No platform fn changes |
| 4 | Import paths | ✅ New `@open-mercato/core/modules/materials/...` exports |
| 5 | Event IDs | ✅ Namespace `materials.*` is free; ⚠️ **but** spec subscriber references a non-existent event ID — see Gap Analysis #1 |
| 6 | Widget injection spot IDs | ⚠️ Spec consumes spots that aren't formally registered — see Gap Analysis #2 |
| 7 | API route URLs | ✅ Namespace `/api/materials*` is free |
| 8 | Database schema | ✅ Six new tables, all `material_*` namespace free |
| 9 | DI service names | ✅ New `materialService`, `materialPriceFxRecomputer` keys |
| 10 | ACL feature IDs | ✅ Namespace `materials.*` is free |
| 11 | Notification type IDs | ✅ None in Phase 1 |
| 12 | CLI commands | ✅ None |
| 13 | Generated file contracts | ✅ Additive `BootstrapData.materials` field |

### Missing BC Section

The spec includes a "Migration & Backward Compatibility" section. It correctly notes the module is brand-new with no prior version. **No changes required.**

## Spec Completeness

### Missing Sections

None. Required sections from `spec-writing` skill are all present: TLDR, Overview, Problem Statement, Proposed Solution, Architecture (Decisions Locked + Module Layout), Data Models, API Contracts, Risks & Impact Review, Implementation Plan, Integration Test Coverage, Final Compliance Report, Migration & BC, Changelog.

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|----------------|
| Search Configuration | Spec says "fulltext on `code`/`name`/`description`, vector on long descriptions" but does not define the `MATERIAL_ENTITY_FIELDS` array, `MATERIAL_CUSTOM_FIELD_SOURCES` shape, or how vector service is resolved (env vs DI). Reference `customers/search.ts` lines 1–100 has the full pattern. | Add a concrete `search.ts` skeleton showing fields list + custom-field source registration + `formatResult` callback signature. Mark vector buildSource as deferred-to-implementation if vector key isn't decided yet. |
| Implementation Plan — Step 4 | Says "translations via `translations.ts`" but doesn't specify the `entityId` key. Convention from `catalog/translations.ts` is `<module>:<table_singular>` → `materials:material`. | Pin the entityId string in the spec to avoid drift. |
| Custom Fields registration | Spec says `Material` registered as custom-fields-extensible but doesn't pin the `id` string. Convention from `customers/ce.ts` is `<module>:<entity_singular>` → `materials:material`. | Pin the entityId in `ce.ts` declaration. |
| Cross-module FK validation | Spec mentions validator must verify supplier_company_id is org-scoped, but doesn't reference the helper pattern. `sales/commands/payments.ts:338` uses `findOneWithDecryption(em, Entity, { id }, undefined, { tenantId, organizationId })`. | Add a one-line note in Step 6 saying validator must call `findOneWithDecryption` (not raw `em.findOne`) for tenant scoping + decryption uniformity. |
| Identity map staleness mitigation | `.ai/lessons.md` line 22–28: command `buildLog()` must fork the EM or use `refresh: true` to avoid identical before/after snapshots. | Add a one-line constraint to the Implementation Plan introduction or to Step 3 (Material CRUD commands). |
| `crypto.randomUUID()` for parent-child creation | `.ai/lessons.md` line 271–278: when creating a parent and immediately referencing its `id` for child entities, generate UUID client-side. Material → MaterialUnit/SupplierLink/Price patterns all hit this. | Add a one-line constraint to Steps 5–7 (children of Material). |

## AGENTS.md Compliance

### Violations

| Rule | Location | Severity | Fix |
|------|----------|----------|-----|
| `defaultRoleFeatures` may only target roles that the platform actually seeds | spec ACL section: `procurement`, `production_planner`, `sales` roles assigned features, but platform only seeds `superadmin`, `admin`, `employee` (verified in `auth/cli.ts:419`). | **Critical** | Phase 1: assign features only to `admin` and `employee`. ERP-specific roles (`procurement`, `production_planner`, `sales`) belong in a separate spec that extends `auth/setup.ts` to seed them. |
| Singularity Law: feature ID `materials.lifecycle.manage` mixes the entity (`material`) with an action group (`lifecycle`) — inconsistent with `customers.deals.manage` (entity-scoped) | spec ACL section | **Low** | Rename to `materials.material.lifecycle.manage` for consistency, or fold into `materials.material.manage` (lifecycle is just one operation on a material). Recommend the latter — fewer feature IDs. |
| Partial unique indexes need raw `@Index({ expression: 'create unique index ... where deleted_at is null' })` because MikroORM v7 has no DSL helper | spec Data Model: `materials.code` and `materials.gtin` partial unique indexes | **Low** | Add an implementation note pointing to `customers/data/entities.ts:211` as the reference pattern. |
| `findWithDecryption` mandatory over `em.find`/`em.findOne` (AGENTS.md Data & Security) | spec doesn't explicitly require it, but Step 6 supplier validator and Step 12 link validator both load entities from other modules | **Medium** | Add an explicit note on the relevant steps. |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Step 8 subscriber listens to `currencies.fx_rate.updated`, which does not exist | Subscriber never fires; `MaterialPrice.base_currency_amount` cache stays stale forever | Change subscriber to listen to existing `currencies.exchange_rate.updated` (verified at `currencies/events.ts:16`). Update spec event name. |
| Step 13 widget injection targets `page:catalog.product.detail` and `page:customers.company.detail`, neither registered as a spot | Widgets render nowhere; no error, just silent no-op | Either (a) add the spots to `catalog/widgets/injection-table.ts` and create `customers/widgets/injection-table.ts` as part of Step 13, or (b) target the existing `crud-form:catalog.product` spot. Option (a) is correct architecturally but adds work. |
| Phase 1 default role features assume non-existent roles | `procurement`/`production_planner`/`sales` users have no implicit grants → operators get no access by default after deployment | Map features to `admin` (full) and `employee` (view + manage on material/units/supplier_link/price; no settings); track ERP role seeding as a separate spec. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Material→Catalog Product link is 1:1 enforced by unique index, but a tenant might legitimately want one Material to surface as multiple Products (variants, channels) | UX dead-end if business case appears post-launch | Acknowledged in Phase 2 scope; current 1:1 simplifies migration. Document escape hatch: drop unique on `catalog_product_id` if requirement emerges. Low likelihood given current `catalog.product` already supports variants. |
| `buildLog()` in commands using non-forked EntityManager produces stale snapshots (`.ai/lessons.md:22`) | Audit log shows `before == after`; undo cannot reconstruct prior state | Mandate forked EM in `buildLog()` for all five command files. Add as compliance check in Step 3/5/6/7/9. |
| Parent-child UUID timing (`.ai/lessons.md:271`) — Material created without explicit `id`, then unit/supplier/price commands reference `material.id` before flush | Validation fails with "expected string, received undefined"; create flow appears broken | Use `crypto.randomUUID()` in `em.create(Material, { id: randomUUID(), ... })` for any flow that creates parent + children in one transaction. |
| Search `buildSource` for vector embeddings requires either env-configured key or DI-resolved `vectorService` | Step 11 fails or vectors are skipped silently | Spec should state "vector buildSource is deferred to Step 11; if no vector service registered at boot, fall back to fulltext-only" — matches `customers/search.ts` pattern. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Concurrent lifecycle transitions (race) | Optimistic concurrency via `updated_at` already mentioned in spec | None additional needed |
| Soft-delete cascade ambiguity for `material_units` when parent material soft-deletes | Children remain with `deleted_at = null` referencing soft-deleted parent | Add explicit cascade rule in entity definition: `cascade: ['soft_delete']` or equivalent; tested by `material-units.spec.ts` |
| `MaterialSupplierLink.preferred` flag race (two concurrent toggles) | Partial unique index rejects second insert; user sees error | Acceptable — UX should re-fetch and retry |

## Gap Analysis

### Critical Gaps (Block Implementation)

1. **Event ID mismatch — `currencies.fx_rate.updated`** does not exist. Real ID is `currencies.exchange_rate.updated` (verified: `packages/core/src/modules/currencies/events.ts:16`). Step 8 subscriber and the `materials.price.fx_recalculated` chain depend on this. Fix: replace all spec mentions of `fx_rate.updated` with `exchange_rate.updated`.

2. **Widget injection spots are not registered.** Catalog has `crud-form:catalog.product` and `data-table:catalog.products` in `widgets/injection-table.ts`, but no `page:catalog.product.detail`. Customers has no `widgets/injection-table.ts` file at all. Step 13 will silently no-op against unregistered spots. Fix options:
   - **(a, recommended)** Add new spot `page:catalog.product.sidebar` to `catalog/widgets/injection-table.ts` and create new `customers/widgets/injection-table.ts` registering `page:customers.company.tabs`. Both are additive (BC-safe per surface #6) and the cleanest architectural fit.
   - **(b)** Target the existing `crud-form:catalog.product` spot. Less semantically correct (it's a form-field injection point, not a sidebar), but zero new infrastructure.

3. **`defaultRoleFeatures` references roles that platform doesn't seed.** Real seeded roles: `superadmin`, `admin`, `employee` (verified: `auth/cli.ts:419`). Spec assigns features to `procurement`, `production_planner`, `sales` which don't exist → grants attach to nothing. Fix: re-map Phase 1 features to `admin` (all) + `employee` (operational view/manage subset). Track ERP-specific role seeding as a separate spec.

4. **Search config is too vague to implement.** Spec says "fulltext + vector" but doesn't list fields, custom-field sources, or `formatResult` shape. Step 11 implementor will need to invent these. Fix: expand the Search Configuration section with the same shape as `customers/search.ts` (`MATERIAL_ENTITY_FIELDS` constant, `MATERIAL_CUSTOM_FIELD_SOURCES`, `formatResult` signature).

### Important Gaps (Should Address)

5. **Missing references to `.ai/lessons.md` constraints** that apply directly:
   - `extractUndoPayload` from `packages/shared/src/lib/commands/undo.ts` (lesson "We've got centralized helpers")
   - Forked EM in `buildLog()` (lesson "Avoid identity-map stale snapshots")
   - `crypto.randomUUID()` for parent-child create flows (lesson "MikroORM 6 does NOT generate UUIDs client-side")
   - Wildcard-aware permission matching (lesson "Feature-gated runtime helpers must use wildcard-aware permission matching") — applies to Step 13 widget visibility logic

6. **Cross-module FK validation pattern unspecified.** Spec mandates validation but doesn't tell the implementor *how*. Reference: `sales/commands/payments.ts:338` uses `findOneWithDecryption(em, CustomerCompanyProfile, { id }, undefined, { tenantId, organizationId })`. State this explicitly in Step 6 and Step 12.

7. **Custom field default values for existing tenants.** Spec ships two default custom fields (`internal_notes`, `safety_data_sheet_url`). Existing tenants get them via `yarn mercato entities install` — confirmed in `customers/AGENTS.md` reference. Spec mentions this in passing; should be a concrete checklist item in Step 14 (setup defaults).

### Nice-to-Have Gaps

8. **`MaterialLifecycleEvent` write path.** Spec defines the entity but doesn't specify whether lifecycle changes write to it via the lifecycle endpoint command itself or via a subscriber on `materials.material.lifecycle_changed`. Either works; subscriber pattern is more decoupled. Recommend: write inline in the lifecycle command (simpler, no event-loop dependency).

9. **`ce.ts` and `translations.ts` `entityId` strings unpinned.** Convention is `materials:material` per other modules. Pin once in spec to avoid drift.

10. **Feature ID consolidation.** `materials.lifecycle.manage` could fold into `materials.material.manage`. Trims one ACL feature.

## Remediation Plan

### Before Implementation (Must Do)

1. **Fix event ID:** Replace every occurrence of `currencies.fx_rate.updated` in spec with `currencies.exchange_rate.updated`. Affects: Decisions Locked Q6, Events table, Step 8, Subscribers section, Risk #FX volatility.
2. **Pick widget spot strategy** (option a recommended): update Step 13 to add a registration step for new spots (`page:catalog.product.sidebar` and `page:customers.company.tabs`) before injection. Add registration to `catalog/widgets/injection-table.ts` and create `customers/widgets/injection-table.ts`.
3. **Re-map `defaultRoleFeatures`** to `admin` + `employee` only. Add a forward note: "ERP role seeding (`procurement`, `production_planner`, `sales`) tracked in a separate `auth-erp-roles` spec; until then, operators with `employee` role + explicit feature grant manage materials."
4. **Expand Search Configuration section** with concrete `MATERIAL_ENTITY_FIELDS`, `MATERIAL_CUSTOM_FIELD_SOURCES`, and `formatResult` shape. Mirror `customers/search.ts:1-100`.
5. **Pin entity IDs:** `materials:material` in `ce.ts` and `translations.ts` declarations.
6. **Consolidate ACL:** drop `materials.lifecycle.manage`; lifecycle uses `materials.material.manage`.

### During Implementation (Add to Spec or Module AGENTS.md)

7. **Add lessons-derived constraints to Implementation Plan introduction:**
   - Use `crypto.randomUUID()` for parent IDs in any flow that creates parent + children before flush (Material + Unit/Supplier/Price)
   - Use forked EM (or `refresh: true`) in `buildLog()` for accurate `snapshotAfter`
   - Use `extractUndoPayload<T>` from `@open-mercato/shared/lib/commands/undo` — never duplicate
   - Use wildcard-aware `hasFeature`/`hasAllFeatures` matchers in widget visibility logic
8. **Add cross-module FK validation pattern:** Steps 6 and 12 must use `findOneWithDecryption(em, Entity, { id }, undefined, { tenantId, organizationId })`.
9. **Add explicit cascade-soft-delete behavior** for `material_units`, `material_supplier_links`, `material_prices` when parent Material is soft-deleted.

### Post-Implementation (Follow Up)

10. **Track separately:** spec for ERP role seeding (`auth-erp-roles`), spec for Phase 2 of materials (PIM features, ABC analysis, advanced translations), spec for catalog/customers shared `widgets/injection-table.ts` infrastructure if option (a) is chosen.
11. **Verify `materials.price.fx_recalculated` event consumers** are added when downstream modules (procurement) come online.
12. **Re-run pre-implement-spec on Phase 2** when its scope is finalized.

## Recommendation

**Status: ✅ Remediation applied 2026-05-02 — spec is ready to implement.**

Original recommendation was "needs spec updates first." All blockers and warnings (items 1–9 in the Remediation Plan) have been applied to the spec — see the spec's [Changelog](../2026-05-02-materials-master-data.md#changelog) for the full list of changes. Verified by post-edit grep: no residual `fx_rate.updated`, `materials.lifecycle.manage`, or unregistered spot references remain in the spec body (only in the changelog where they document what was fixed).

Item 10 (post-implementation follow-ups: `auth-erp-roles` spec, Phase 2 spec for materials, vector embedding readiness) remains open for separate planning.

The spec is ready for `auto-create-pr` or manual implementation starting at Step 1.
