# Pre-Implementation Analysis: Catalog Compliance & Commercial Product Fields (PL/EU batch)

**Spec**: `.ai/specs/2026-06-11-catalog-compliance-and-commercial-product-fields.md`
**Analyzed**: 2026-06-11 (fresh-context audit, `om-pre-implement-spec` skill)
**Codebase verified against**: worktree `claude/pensive-kowalevski-f6a1ad`

## Executive Summary

The spec is well-researched, additive-only, and verified accurate against the codebase on nearly every claim: `decorateProductsAfterList` holds per-item pricing assignment (suppression is feasible), expression-based partial unique indexes are an established MikroORM pattern with migration + snapshot support, both routes' `transformItem` spread unknown fields through, the variants duplicate-rethrow seam exists and needs exactly the planned new branch, products/variants carry no encryption maps, and seeds/optimistic-lock guards are unaffected. One **Critical** implementation landmine exists exactly as the spec words it: attaching `superRefine` to `variantCreateSchema` breaks `variantUpdateSchema` composition at module load on zod 4.4.3 (empirically verified: `.partial()` throws on refined object schemas). The fix is mechanical and already modeled in the same file (`productBaseSchema` is deliberately refinement-free). With that restructure plus four Warning-level adjustments (update-path merged-state GTIN validation, the seventh audit-log mapping site, migration-predicate verification, duplicate-error status/key alignment), the spec is ready.

**Recommendation: READY-WITH-FIXES** — fixes are spec-text clarifications and one validator-composition restructure; no architectural rework.

---

## Backward Compatibility — 13-Surface Audit

| # | Surface | Spec impact | Verdict |
|---|---------|------------|---------|
| 1 | Auto-discovery files | No files renamed/removed; edits stay inside existing convention files (`data/entities.ts`, `data/validators.ts`, `translations.ts`, `i18n/*.json`) plus one new `lib/gtin.ts` and one new component | OK — ADDITIVE |
| 2 | Type definitions | `ProductSnapshot`/`VariantSnapshot` (module-internal) gain fields; `ProductFormValues` gains fields; exported zod schemas gain **optional** fields only. Nuance: converting exported `variantCreateSchema` into a refined schema removes downstream `.partial()`/`.extend()` affordances (zod 4 throws) — same posture as the already-refined `productCreateSchema`, so accepted precedent, but see Critical C-1 for the in-file breakage | OK with note |
| 3 | Function signatures | None changed | OK |
| 4 | Import paths | None moved | OK |
| 5 | Event IDs | `catalog.product.*` / `catalog.variant.*` unchanged; payloads gain fields additively (`emitCrudSideEffects` serializes the entity) | OK — ADDITIVE |
| 6 | Widget spot IDs | No spot renamed; new wizard step + edit-page group ids are additive; `crud-form:catalog.*` spots untouched | OK — ADDITIVE |
| 7 | API routes | No URL/method changes; request/response fields added. `pricing: null` for quote-only items is schema-compatible today (`productListItemSchema.pricing` is already `.nullable().optional()`, products route.ts:956, and the decorator already emits `null` when no price resolves, route.ts:724) and only fires when the merchant opts in (default `false`) | OK — ADDITIVE |
| 8 | Database schema | 26 + 2 columns, all nullable or defaulted ("MAY add new columns with defaults"); 1 new partial unique index ("MAY add new indexes freely"); `barcode` untouched | OK — ADDITIVE |
| 9 | DI service names | None | OK |
| 10 | ACL feature IDs | None; covered by existing `catalog.products.manage` / `catalog.variants.manage` (variants route metadata verified, api/variants/route.ts:59-64) | OK |
| 11 | Notification type IDs | None | OK |
| 12 | AI agent/tool IDs | None (catalog AI tools read products via the same list API; new fields flow additively) | OK |
| 13 | CLI / generated files | `yarn generate` regenerates `#generated/entities/catalog_product_variant` field constants additively; no export-name changes | OK — ADDITIVE |

**Missing BC section**: Not missing — spec has "Migration & Compatibility" with an explicit surface check. Accurate.

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|--------------|
| C-1 | data/validators.ts composition (runtime, not contract) | Phase 1 step 3 says "`variantCreateSchema` (+ GTIN superRefine)". `variantUpdateSchema` is built as `z.object({ id }).merge(variantCreateSchema.partial())` (validators.ts:268-272). **Verified on the repo's zod 4.4.3: `.partial()` on a superRefined object throws** `".partial() cannot be used on object schemas containing refinements"` — module-load failure across every consumer of validators.ts (routes, commands, OpenAPI generation, bootstrap) | **Critical** | Introduce an unrefined `variantBaseSchema` (current shape + new optional `gtinType`/`hsCode`), then `export const variantCreateSchema = variantBaseSchema.superRefine(gtinRefinement)` and `export const variantUpdateSchema = z.object({ id }).merge(variantBaseSchema.partial()).superRefine(gtinUpdatePayloadRefinement)`. This is exactly the pattern already documented in the same file: `// Base schema without refinements (used for .partial() in update schema)` (validators.ts:178) and the `.ai/lessons.md` `safeExtend()` lesson |
| C-1b | Same trap, products side | "extend `productBaseSchema` … with cross-field refinements for qty/date ranges" is ambiguous. Refinements attached to `productBaseSchema` itself break `productBaseSchema.partial()` in `productUpdateSchema` (validators.ts:226-234) | **Critical** (same fix) | Add new fields to `productBaseSchema` (fields only); put qty/date cross-field checks in a `productComplianceCrossFieldRefinement(input, ctx)` function chained as an additional `.superRefine(...)` on **both** `productCreateSchema` and `productUpdateSchema`, exactly like `productUomCrossFieldRefinement`. Chained `.superRefine()` calls accumulate checks and do not throw |

---

## Spec Claims vs Code — Verification Matrix (audit brief items a–j)

| Item | Claim | Verdict | Evidence |
|------|-------|---------|----------|
| a | `decorateProductsAfterList` makes per-item `pricing` suppression feasible | **Confirmed** | Hook wired via `hooks.afterList` (products route.ts:843-845). Per-item pricing assigned in a final loop: `item.pricing = {...}` or `null` (route.ts:695-726). Once `is_quote_only` is in `list.fields`, the item carries the flag inside the loop; setting `item.pricing = null` (or better: pushing `null` into `pricingEntries` to skip resolution work) is a 3-line change. `pricing` is already nullable in the OpenAPI item schema |
| b | Expression-index pattern is migration/snapshot compatible | **Confirmed, with a caution** | Customers declares 4 expression indexes (customers/data/entities.ts:10-29); they appear in `.snapshot-open-mercato.json` with the full `expression` string (snapshot line ~3374). **Partial UNIQUE** expression indexes have 20 precedents in `packages/ai-assistant/src/modules/ai_assistant/data/entities.ts` whose generated migrations preserve the full `where` clause (e.g. Migration20260419100521.ts:7-8). Caution (W-3): the customers migration that shipped those indexes (`Migration20251030150038.ts:14-17`) created them **without** the WHERE predicate — entity/snapshot vs shipped-DDL drift that `yarn db:generate` "no changes" cannot detect |
| c | Variants route exposes a fields list + item schema to extend | **Confirmed** | `list.fields` array (api/variants/route.ts:110-131, `FV.*` constants + string literals) and `variantListItemSchema` (route.ts:249-268). Both need `gtin_type` + `hs_code`. `FV` constants for the new columns exist only after `yarn generate` |
| d | `transformItem` passes unknown fields through via spread | **Confirmed** | Products: `const normalized = { ...item }` then `return { ...normalized, ... }` (route.ts:817-840). Variants: same shape (route.ts:156-164). `ProductListItem` is `Record<string, unknown> & {...}` (route.ts:318) so no type friction. Only `list.fields` + OpenAPI item schemas need explicit edits |
| e | Variant duplicate rethrow exists; GTIN violation needs a new branch + message | **Confirmed** | `rethrowVariantUniqueConstraint` (commands/variants.ts:1162-1174) matches **only** `catalog_product_variants_sku_unique` and rethrows everything else raw — a GTIN unique violation today would surface as an unhandled `UniqueConstraintViolationException` (500). Both create (line 635) and update (line 862) paths route through it, so one new constraint-name branch (`catalog_product_variants_gtin_scope_unique`) + a translated error covers both. See W-4: the existing duplicate-SKU pattern is `CrudHttpError(400)` with `fieldErrors` + key `catalog.variants.errors.skuExists` — the spec says "409-style" and proposes key `catalog.variants.validation.gtinDuplicate`; align to 400 + the `errors.*` family (or justify the divergence) |
| f | i18n key style + `catalog.products.compliance.*` collision check | **Confirmed, no collision** | Locale files use **flat dotted keys** (621 keys in en.json). Existing validation family: `catalog.products.validation.{baseUnitRequired,handleFormat,referenceUnitRequired,skuFormat,titleRequired}` — spec's `catalog.products.validation.*` additions fit. Zero existing `*.compliance*` keys. Note: `catalog.products.create.seoWidget.*` (SPEC-071 SEO sanity widget) already exists — different keys, no collision, but see the seoWidget gap note |
| g | Products/variants not in any encryption map | **Confirmed** | No `packages/core/src/modules/catalog/encryption.ts` exists; the modules that export `defaultEncryptionMaps` are audit_logs, auth, communication_channels, customer_accounts, customers, inbox_ops, integrations, sales, staff, messages — catalog absent. No catalog entries in entities-module encryption defaults. Compliance codes are not PII — N/A stands |
| h | Optimistic-lock guards unaffected | **Confirmed** | `packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts` curates catalog entities `CatalogProduct`, `CatalogProductVariant` (lines 32-40) — both already have `updated_at` (entities.ts:179-180, 542-543) and both routes return `updated_at` in `list.fields`. No new entities means the list is unchanged. `packages/core/src/__tests__/optimistic-lock-ui-coverage.test.ts` — spec adds no new raw mutating UI calls (CrudForm pages + existing variant pages) so it is unaffected |
| i | Seeds unaffected by NOT NULL DEFAULT columns | **Confirmed** | `seed/examples.ts` creates products/variants via `em.create(CatalogProduct, {...})` / `em.create(CatalogProductVariant, {...})` (lines 866, 950) — entity property initializers (`requiresShipping = true` etc. once added to `[OptionalProps]`) + DB column defaults make omitted fields valid. No raw SQL inserts in catalog seeds |
| j | 13-surface BC audit | **Done** | See table above — all additive; one Critical implementation hazard (zod composition), zero contract-surface violations |

---

## Spec Completeness

### Missing Sections
None. TLDR, Overview, Problem Statement, Proposed Solution (+ design decisions + alternatives), Architecture, Data Models, API Contracts, i18n, UI/UX, Migration & Compatibility, Implementation Plan (phased), Integration Test Coverage, Risks & Impact Review, Final Compliance Report, Changelog — all present.

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|----------------|
| Proposed Solution §3 / Concerns | "six places" mapping-site count is one short per command | There is a **seventh site**: the audit-log change-key list passed to `buildChanges` — products use an inline array in update `buildLog` (commands/products.ts:1769-1782: title, sku, productType, uom fields, isActive); variants use `VARIANT_CHANGE_KEYS` (commands/variants.ts:85-100). Without additions, audit diffs silently omit the new fields (undo still works — it uses full snapshots). Add the seventh site to the spec's checklist and to the command round-trip unit test |
| Data Models / Validators (variants) | GTIN validation on **partial update** cannot be payload-only | `PUT { gtinType: 'ean13' }` (barcode only in DB) or `PUT { barcode: '…' }` (gtinType already set in DB) bypass any zod payload refinement — the merged state is never checksum-validated, so a typed-but-invalid pair can be persisted in two steps; the unique index protects duplicates, not validity. Add a command-level merged-state check in `catalog.variants.update` (after loading `record`, validate `effectiveGtinType = parsed.gtinType ?? record.gtinType` against `effectiveBarcode = parsed.barcode ?? record.barcode`), and add a TC-CAT-COMP-002 case for the two-step path. (Products' qty/date refinements share the blind spot but match the existing UoM-refinement precedent — Info) |
| API Contracts (variants) | Duplicate error status/key ambiguity | Spec says "409-style structured error like SKU duplicates" but the existing SKU pattern is **400** (`throwDuplicateVariantSkuError`, commands/variants.ts:1152-1160) with `fieldErrors` and key `catalog.variants.errors.skuExists`. Pin the contract: 400 + `fieldErrors.barcode` (or `gtinType`) + key in the `catalog.variants.errors.*` family, so TC-CAT-COMP-002 asserts the right status |
| i18n / translations.ts | Field-name casing inconsistent across spec sections | Proposed Solution §6 says "`seo_title`/`seo_description` declared translatable"; the i18n section says camelCase. `translations.ts` uses **camelCase entity property names** (checkout precedent: `successTitle`, `startEmailSubject`; catalog: `title`, `subtitle`). Use `seoTitle`, `seoDescription` |

---

## AGENTS.md Compliance

| Rule | Assessment |
|------|-----------|
| Entity Schema & Migration Workflow (core AGENTS.md) | Spec follows it (db:generate probe, scoped SQL + snapshot, no-op recheck). Add W-3 verification step |
| Domain writes through commands | OK — extends existing commands; no route-level mutation |
| `withAtomicFlush` / flush-before-relation-sync | OK — no new relation syncs; scalar fields ride existing phases. The `.ai/lessons.md` "Flush entity updates before relation syncs" lesson is already encoded in the products update command structure |
| Zod in `data/validators.ts`, types via `z.infer` | OK as planned; C-1 restructure required |
| Optimistic locking (root AGENTS.md) | OK — no new entities; `CrudForm` auto-derive already active on both pages |
| i18n, 4 locales, no hardcoded strings | OK as planned; flat-key style confirmed |
| DS rules for new section component | OK — spec pins DS primitives, semantic tokens, `useT()`. `ProductUomSection` props contract verified: `{ values: ProductFormValues; errors: Record<string, string>; setValue: (id, value) => void }` (ProductUomSection.tsx:42-45) |
| Integration tests self-contained, module-local | OK — TC-CAT-COMP-001..004 in `__integration__/`, API-fixture based |
| Encryption maps for GDPR fields | OK — correctly N/A (verified no catalog encryption.ts) |
| Boy Scout rule | Edit page + create page touches — keep migrated lines token-clean |

No violations beyond the items above.

---

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| C-1 zod composition breakage ships | App fails at module load (validators.ts imported by routes/commands/OpenAPI/bootstrap) — caught instantly in dev, but wastes an implementation cycle and can slip past unit tests that import only the create schema | Restructure per C-1 before writing field code; add a trivial test that `variantUpdateSchema.safeParse({ id: uuid })` succeeds (proves composition executes) |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Migration DDL drops the GTIN index predicate (W-3) | Without `WHERE deleted_at IS NULL AND gtin_type IS NOT NULL AND barcode IS NOT NULL`, soft-deleted rows keep blocking barcode reuse (known repo flake class) — NULL gtin_type rows are safe either way (PG treats NULLs as distinct) but the soft-delete clause is load-bearing. The customers module is a live precedent of predicate drift between entity and shipped migration | Hand-verify the emitted migration SQL contains the full predicate; use the ai_assistant entities/migrations as the syntax reference for `create unique index … where …`; TC-CAT-COMP-002 should include delete-then-recreate of a typed barcode |
| Two-step GTIN update bypasses validation (W-2) | Invalid typed barcodes persisted; downstream feeds (the whole point of G-3.3) cannot trust `gtin_type` | Command-level merged-state validation in `catalog.variants.update` + test case |
| Audit diffs omit new fields (W-1 / seventh site) | Compliance fields are exactly the kind auditors look at; change history would show "updated" with no visible diff | Add fields to products' inline `buildChanges` list and `VARIANT_CHANGE_KEYS`; assert in the command unit test |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Quote-only price leakage via other read surfaces | `/api/catalog/prices` list API, pricing resolve paths, and offers payloads still expose price rows for quote-only products — suppression covers only product list/detail decoration | In-scope-by-design (data-first batch; sales enforcement deferred). State it explicitly as a non-goal so reviewers do not flag it as a missed path |
| Query-engine routing for dual-declared ids | `catalog_product`/`catalog_product_variant` are dual-declared in `ce.ts` (system entries, `fields: []`). Verified: `HybridQueryEngine.isCustomEntity` returns false for ids backed by a registered ORM table unless a `custom_entities` row exists (query_index/lib/engine.ts:995-1030, the #2939 fix) — system ids are never registered there, so base columns serve from the table, no reindex. Claim holds on healthy installs | None needed; do not add `forceCustomEntityStorage` anywhere |
| New-step typing in create wizard | `STEP_FIELD_MATCHERS: Record<ProductFormStep, …>` (create/page.tsx:121-128) — adding `compliance` to `PRODUCT_FORM_STEPS` without matchers is a compile error, a built-in guard | Follow spec Phase 2 step 3 |
| GTIN type select UX | Static enum options (no async hydration risk), but the field is nullable so it needs an explicit clear affordance; per `.ai/lessons.md`, non-clearable selects must ignore empty `onValueChange`, clearable ones need an explicit clear item | Render an explicit "None" item or clear button |

---

## Gap Analysis

### Critical Gaps (Block Implementation)
- **Validator composition restructure (C-1/C-1b)**: spec text must direct refinements to the create/update exports, never to base schemas consumed by `.partial()`. One-paragraph spec edit + the unrefined-base pattern.

### Important Gaps (Should Address)
- **Update-path merged-state GTIN validation** (W-2): command-level check + integration case for two-step updates.
- **Seventh mapping site** (W-1): products' inline `buildChanges` list + `VARIANT_CHANGE_KEYS`; include in the round-trip unit test's assertions.
- **Migration predicate verification step** (W-3): add to Phase 1 step 6 ("verify emitted DDL contains the full WHERE predicate; db:generate no-op only proves snapshot-entity parity").
- **Duplicate-error contract pin** (W-4): 400 + `fieldErrors` + `catalog.variants.errors.*` family, matching `throwDuplicateVariantSkuError`.

### Nice-to-Have Gaps
- `translations.ts` casing: use `seoTitle`/`seoDescription` (camelCase, checkout precedent).
- Clarify whether quote-only suppression also skips the resolver call (push `null` into `pricingEntries`) — saves work and avoids resolving prices that are then discarded.
- Clarify interaction with the existing create-page `seoWidget` (`catalog.products.create.seoWidget.*`): does it stay keyed off `title`/`description`, or should it read the new `seoTitle`/`seoDescription` when set? Recommend an explicit non-goal note.
- The referenced `CATALOG_GAP_ANALYSIS.preview.html` is not in the repo — citation-only; fine, but the spec stands alone without it.
- `text[]` precedent for `gtu_codes` confirmed (`workflows.assigned_to_roles`, `audit_logs.changed_fields` — `@Property({ type: 'text[]' })`).
- Numeric/date mapping precedent: integers (`age_min`, `min_order_qty`, …) map to `number` like `uomRoundingScale` (smallint); timestamps map to `Date` props with ISO-string snapshots like `createdAt` — do **not** copy the `toNumericString` string-mapping used for `numeric`-typed columns.

---

## Remediation Plan

### Before Implementation (Must Do)
1. **Amend spec Phase 1 step 3 (C-1/C-1b)**: introduce `variantBaseSchema` (unrefined); apply GTIN `superRefine` on the exported `variantCreateSchema`/`variantUpdateSchema`; chain product compliance cross-field checks as an additional `.superRefine` on `productCreateSchema`/`productUpdateSchema` — never on `productBaseSchema`.
2. **Amend spec Phase 1 step 4 (W-1)**: add the audit change-key sites (products inline `buildChanges` list, `VARIANT_CHANGE_KEYS`) to the field-wiring checklist and the round-trip unit test.
3. **Amend spec Phase 1 step 4 (W-2)**: add command-level merged-state GTIN validation to `catalog.variants.update`; add the two-step update case to TC-CAT-COMP-002.
4. **Pin the duplicate-error contract (W-4)**: 400 `CrudHttpError` + `fieldErrors`, key `catalog.variants.errors.gtinDuplicate` (align family with `skuExists`); update API Contracts + TC-CAT-COMP-002 wording ("409-style" to "structured 400 duplicate error, same shape as duplicate SKU").

### During Implementation (Add to Spec/Checklist)
1. **Migration verification (W-3)**: after `yarn db:generate`, diff the emitted `create unique index` DDL against the spec's SQL including the full predicate; reference ai_assistant migrations for syntax. Re-run db:generate for the no-op check as planned.
2. **translations.ts**: `seoTitle`, `seoDescription` (camelCase).
3. **GTIN select**: explicit clear affordance; ignore synthetic empty `onValueChange` if a non-clearable variant is chosen.
4. **Quote-only suppression**: skip the resolver for flagged items (push `null` into `pricingEntries`) rather than discarding a resolved price.
5. Add a one-line non-goals note: price rows remain readable via `/api/catalog/prices` and resolver surfaces for quote-only products (enforcement is the deferred sales-side work).

### Post-Implementation (Follow Up)
1. Run `yarn i18n:check-sync` (4 locales) and the standard gate (`yarn generate`, `yarn build:packages`, `yarn typecheck`, `yarn test`, integration specs).
2. Confirm `optimistic-lock-editable-entities.test.ts` and `optimistic-lock-ui-coverage.test.ts` still pass untouched (expected — no new entities, no raw mutating UI calls).
3. Consider a follow-up spec for quote-only enforcement in sales/cart and the deferred G-3.5 GPSR responsible-person entity, as already scoped out.

---

## Recommendation

**READY-WITH-FIXES** — implement after folding in C-1/C-1b (validator composition restructure; mechanical, modeled in the same file) and the four Warning remediations (W-1 audit change-keys, W-2 update-path GTIN merged-state validation, W-3 migration predicate verification, W-4 duplicate-error status/key alignment). No blockers, no contract-surface violations, no architectural concerns.
