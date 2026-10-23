# Catalog product edit section policy

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-overrides-framework.md`, `.ai/specs/2026-10-22-attachment-section-policy-bridge.md`, `.ai/specs/2026-10-09-catalog-nested-offer-optimistic-locking.md`
**Related:** issue #6686, `.ai/specs/2026-09-04-crudform-group-visibility.md`

## TLDR

Adopt the generic `CrudForm` section-override framework on the catalog product **edit** form. A standalone app module can add, hide, or replace any of the ten stable built-in sections through `entry.overrides.forms.sections` without copying the page. The catalog adapter owns explicit per-section client validation, payload leaves, dependencies, independent actions, and secondary writes so a hidden section neither blocks save nor clears or mutates stored data.

This is a focused catalog adopter, independently deployable after the generic framework, attachment bridge, and nested-offer concurrency prerequisite land. Product create and repository-wide form adoption remain separate specs. Because the work changes protected catalog, `CrudForm`, override, action, and optimistic-lock surfaces, implementation and review are restricted to Open Mercato core team members.

## Overview

The target is `packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx`, using:

- `hostId = 'crud-form:catalog.product'`;
- `formVariant = 'edit'`;
- `formOperation = 'update'`;
- `hostResourceKind = 'catalog.product'` and `hostResourceId = product.id`.

The page currently contains ten groups and one large submit callback. Visual hiding alone is unsafe because the client schema parses hidden values, custom-field validation runs before the page callback, compliance helpers emit nulls, metadata combines user and reserved leaves, and conversion/offer writes run independently. This spec extracts catalog-owned runtime descriptors and a server adapter while retaining existing UI components and legacy endpoint behavior.

## Problem Statement

The current form has these concrete failure modes:

1. A stored `minOrderQty=100000001` is accepted by `productUpdateSchema` but rejected by the client form schema. Restoring and whole-form parsing would block a title edit on an invisible compliance field.
2. `CrudForm` validates all fetched custom-field definitions before `onSubmit`; a hidden required custom field can block a visible edit.
3. `buildComplianceProductPayload` emits all compliance/SEO keys, converting blanks to `null`; a hidden compliance card can erase stored values.
4. `buildMetadataPayload` combines user metadata with the details-owned `metadata.__useMarkdown` leaf. Omitting or replacing the whole object can lose one side.
5. Unit-conversion create/update/delete calls occur after the product update and must not run when `product-uom` is hidden.
6. Categorization currently deletes deselected offers before the product update and builds offer payloads from categorization plus details fallbacks. Hidden categorization must run none of those writes.
7. Option-schema, variant, and attachment controls mutate outside parent submit and need declared policy/action/lock bindings.
8. The SEO injection widget reads details fields and runs handlers even if its card is visually hidden. A details policy must disable that widget or supply its compatible data contract.

## Goals and Non-goals

### Goals

- Publish and pin all ten built-in section ids.
- Give each section explicit validation, payload, dependency, action, and secondary-write ownership.
- Preserve hidden data from the tenant/organization-scoped locked server record, never from stale browser restoration.
- Keep visible-section validation and existing server/domain invariants authoritative.
- Prove the real `modules.ts` → bootstrap → browser → guarded backend round trip.
- Preserve no-policy rendering, payload fields, endpoint choice, side-effect order, audit/events, and lock behavior.

### Non-goals

- Product create; its compound builder has a different topology and transaction flow.
- Per-product, tenant-configured, or role-configured visibility.
- Changing `CrudForm.hiddenGroupIds`.
- Implementing nested-offer locking or shared attachment operations; those hard prerequisites have their own specs.
- EUDR lifecycle or data-model changes.
- Moving the existing inline section components solely for organization.

## Stable Section Contract

The edit host publishes these stable ids:

`details`, `dimensions`, `metadata`, `options`, `product-uom`, `compliance`, `variants`, `meta`, `categorize`, `custom-fields`.

The canonical override key is:

```text
crud-form:catalog.product/edit/update/<section-id>
```

Example:

```ts
overrides: {
  forms: {
    sections: {
      'crud-form:catalog.product/edit/update/compliance': {
        operation: 'hide',
        contributionId: 'my_app.catalog.hide_compliance',
      },
    },
  },
}
```

The contribution must name the matching server capability. An unknown id rejects the entire configured policy, renders the blocking error state, exposes no mutation controls, and emits `crud_form_section_policy_invalid`; it never falls back to an actionable base section.

## Proposed Solution

### 1. Catalog-owned descriptors

Create a pure route-local module, `packages/core/src/modules/catalog/backend/catalog/products/components/productFormSections.ts`, that exports:

- the ordered stable ids;
- explicit runtime descriptors using the framework UI interfaces;
- section-specific Zod schemas or validation functions that preserve existing transforms;
- the catalog composition validator for active cross-section invariants;
- payload leaf ownership;
- dependency and provided-data-contract ids;
- parent-submit secondary-write ownership;
- independent mutation-surface facts.

The existing edit page root gains at most 20 net lines of identity/descriptor wiring. The create root is unchanged and appears only in regression coverage. The edit root does not gain inline policy tables, effects, or capability logic. Existing group components stay in place.

### 2. Validation contract

The catalog adapter does not call the current whole-form client schema over hidden values. It validates each active section with an explicit schema and then runs a composition validator over parsed active outputs.

| Section | Exact field/input ownership |
|---|---|
| `details` | `title`, `description`, `useMarkdown`, `mediaDraftId`, `mediaItems`, `defaultMediaId`, `defaultMediaUrl` |
| `dimensions` | `dimensions.{width,height,depth,unit}`, `weight.{value,unit}` |
| `metadata` | `metadata.*` except reserved `__useMarkdown`, `optionSchema`, `option_schema`, `dimensions`, `weight` |
| `options` | `options`, `optionSchemaId` and option-schema action inputs |
| `product-uom` | `defaultUnit`, `defaultSalesUnit`, `defaultSalesUnitQuantity`, `uomRoundingScale`, `uomRoundingMode`, `unitPriceEnabled`, `unitPriceReferenceUnit`, `unitPriceBaseQuantity`, `unitConversions[].{id,updatedAt,unitCode,toBaseFactor,sortOrder,isActive}` |
| `compliance` | `countryOfOriginCode`, `pkwiuCode`, `cnCode`, `hsCode`, `taxClassificationCode`, `gtuCodes`, `ageMin`, `isExciseGood`, `exciseCategory`, `requiresPrescription`, `hazmatClass`, `unNumber`, `hazmatPackingGroup`, `containsLithiumBattery`, `launchAt`, `endOfLifeAt`, `availableFrom`, `availableUntil`, `minOrderQty`, `maxOrderQty`, `orderQtyIncrement`, `requiresShipping`, `isQuoteOnly`, `seoTitle`, `seoDescription`, `canonicalUrl` |
| `variants` | `variants` display/action state only; each action validator owns its route input |
| `meta` | `subtitle`, `handle`, `sku`, `productType`, `taxRateId`, `hasVariants` |
| `categorize` | `categoryIds`, `channelIds`, `tags`, plus versioned offer delta derived by the prerequisite protocol |
| `custom-fields` | `customFieldsetCode` and `customFields.<definition-key>` for the active fetched definitions |

The descriptor source exports these literal field arrays and a test compares their union/collisions against `ProductFormValues` plus the fetched custom-field namespace. Cross-section rules are exhaustively assigned: `unitPriceEnabled` requires reference unit/base quantity inside `product-uom`; `defaultSalesUnit` and active conversions require `defaultUnit`; a non-base sales unit requires an active matching conversion; `minOrderQty <= maxOrderQty`, `launchAt <= endOfLifeAt`, and `availableFrom <= availableUntil` stay inside `compliance`; `details.useMarkdown` owns only `metadata.__useMarkdown`; `options` may consume the locked title contract; `categorize` may consume locked title/description/media fallbacks; `variants` requires the option-schema contract; and the SEO widget requires writable title/description. A rule runs client-side only when all of its owned fields are active. A hidden value may be read for display/server fallback but cannot create an unreachable client error. The server adapter merges submitted active leaves with the current scoped locked product and runs the complete authoritative domain validation before mutation.

Before `CrudForm`'s custom-field required gate, definitions are projected to the active `custom-fields` descriptor. Hiding that section removes its definitions and omits its payload; it does not delete values.

### 3. Payload and preservation ownership

| Section | Payload/write ownership |
|---|---|
| `details` | title, description, media fields, and `metadata.__useMarkdown` |
| `dimensions` | dimensions, weight value/unit |
| `metadata` | user metadata leaves except reserved keys |
| `options` | option schema id/definition in parent update |
| `product-uom` | UoM parent fields plus conversion create/update/delete lifecycle |
| `compliance` | current 26 compliance/SEO leaves |
| `variants` | no parent payload; independent variant actions only |
| `meta` | subtitle, handle, SKU, type, tax, configurability |
| `categorize` | categories, tags, offers, and offer removals |
| `custom-fields` | fieldset code and custom-field payload |

Payload fragments deep-merge by leaf. Duplicate ownership fails generation/tests.

Metadata is server-owned at merge time:

- details visible, metadata hidden: update only `metadata.__useMarkdown`, preserving every user leaf;
- metadata visible, details hidden: update allowed user leaves and preserve the stored reserved leaf;
- both visible: merge their non-overlapping authorized leaves;
- both hidden: omit metadata completely.

The guarded product-policy façade loads the tenant/organization-scoped product under the parent optimistic lock, merges only active authorized leaves, then delegates to the existing product command. A stale parent version produces the standard `optimistic_lock_conflict`; current-version saves preserve the latest hidden leaves even if the browser loaded older values.

### 4. Secondary writes and dependencies

- Hidden `product-uom` runs no conversion sync.
- Hidden `categorize` sends no category/tag/offer leaves and runs no offer deletion.
- Visible sections retain current write ordering and each child mutation uses its own current version.
- `product-uom` carries every loaded conversion's `id` and `updatedAt`. Update/delete requests override the parent header with that conversion token, use `resourceKind: 'catalog.product_unit_conversion'`, route conflicts through `surfaceRecordConflict`, and stop remaining conversion work. Successful create/update responses return a fresh `updatedAt`; the page replaces conversion values and versions together so successive saves never synthesize or drop child tokens. Because conversions remain legacy post-parent secondary writes, a conversion conflict does not roll back the already committed parent update; tests pin that partial-success boundary and prove no later conversion/action runs.
- The versioned `offerChanges` capability and authoritative child snapshots from `.ai/specs/2026-10-09-catalog-nested-offer-optimistic-locking.md` must be implemented first; this adopter binds `categorize` only to that capability and never reintroduces the legacy browser pre-delete path.
- `options` may read the loaded title without making details fields active.
- `categorize` offer fallbacks come from the scoped locked product when details is hidden, not stale browser values.
- `variants` requires the option-schema data contract for display/action behavior.
- the active `catalog.injection.product-seo` widget requires the writable details title/description contract. Hiding/replacing details fails closed unless the same app policy disables that widget via `overrides.widgets.injection` or the replacement provides the compatible contract.

### 5. Independent action surfaces

Action-bearing sections publish exact guarded façade and delegated-provider facts:

Every row asserts resolver-selected host `catalog.product/<productId>`, which each façade independently scopes and authorizes:

| Mutation surface id | Capability id | Guarded policy façade | Mutation target | Delegated provider | Lock |
|---|---|---|---|---|---|
| `catalog.product.edit.submit` | `catalog.product.edit.update/v1` | `PUT /api/catalog/products/:productId/section-policy` | `catalog.product/<productId>` | `catalog.product.update` | parent product version |
| `catalog.product.edit.details.attachment.create` | `attachments.section-policy.create/v1` | `POST /api/attachments/section-policy` | `attachments.attachment`, id absent | shared attachment create operation | not applicable |
| `catalog.product.edit.details.attachment.delete` | `attachments.section-policy.delete/v1` | `DELETE /api/attachments/section-policy?id=:id` | `attachments.attachment/<attachmentId>` | shared attachment delete operation | not applicable |
| `catalog.product.edit.options.schema.create` | `catalog.product.option-schema.create/v1` | `POST /api/catalog/products/:productId/section-actions/option-schemas` | `catalog.option_schema`, id absent | existing option-schema create command | no prior version |
| `catalog.product.edit.options.schema.update` | `catalog.product.option-schema.update/v1` | `PUT /api/catalog/products/:productId/section-actions/option-schemas/:schemaId` | `catalog.option_schema/<schemaId>` | existing option-schema update command | option-schema row version |
| `catalog.product.edit.options.schema.delete` | `catalog.product.option-schema.delete/v1` | `DELETE /api/catalog/products/:productId/section-actions/option-schemas/:schemaId` | `catalog.option_schema/<schemaId>` | existing option-schema delete command | option-schema row version |
| `catalog.product.edit.variants.create` | `catalog.product.variant.create/v1` | `POST /api/catalog/products/:productId/section-actions/variants` | `catalog.product_variant`, id absent | existing variant create command | no prior version |
| `catalog.product.edit.variants.generate` | `catalog.product.variant.generate/v1` | `POST /api/catalog/products/:productId/section-actions/variants/generate` | `catalog.product/<productId>` | existing generated-variant command | no prior version |
| `catalog.product.edit.variants.update` | `catalog.product.variant.update/v1` | `PUT /api/catalog/products/:productId/section-actions/variants/:variantId` | `catalog.product_variant/<variantId>` | existing variant update command | variant row version |
| `catalog.product.edit.variants.delete` | `catalog.product.variant.delete/v1` | `DELETE /api/catalog/products/:productId/section-actions/variants/:variantId` | `catalog.product_variant/<variantId>` | existing variant delete command | variant row version |

The attachment prerequisite owns extraction and façade behavior. This adopter only declares the two matching surface ids and binds the details controls. “No entity-version lock” is not an auth exemption.

Stable data-contract ids are `catalog.product.edit.title/v1`, `catalog.product.edit.details-seo/v1`, `catalog.product.edit.option-schema/v1`, and `catalog.product.edit.offer-fallbacks/v1`. Every action request carries the accepted policy token and the exact parent/child resource binding required by its table row. A route, method, capability id, data-contract id, or resource binding mismatch returns the framework's exact `409 extension_policy_mismatch` before delegated domain code runs.

The parent façade accepts the framework-projected product payload plus the prerequisite `offerChanges` envelope when `categorize` is active. It asserts and independently reauthorizes host and mutation target `catalog.product/<productId>`, request operation `update`, mutation surface `catalog.product.edit.submit`, and the parent's `updatedAt`; it merges hidden leaves from the scoped locked record, runs authoritative product validation, and delegates once to `catalog.product.update`.

Built-in and replacement controls use `runSectionMutation`. Hiding removes the controls but does not weaken the underlying legacy endpoint. A replacement activates only when its mutation-surface facts structurally match the accepted provider.

### 6. Bootstrap and create/edit isolation

The edit page passes explicit operation/resource identity because its current initial values omit `id`. Pending policy bootstrap renders `LoadingMessage` and exposes no submit/action path. A settled failure on this explicitly configured host renders a blocking `ErrorMessage`, emits diagnostic code `crud_form_section_policy_invalid` with host/variant/operation/contribution/reason fields, and exposes no mutation controls. Only an edit host with no configured policy uses the complete base form.

Product create receives no section-policy identity or runtime wiring and remains policy-ineligible. Its different two-card builder and compound workflow require a separate adopter spec. Regression tests prove an edit policy cannot resolve on create even though both use the legacy widget spot `crud-form:catalog.product`.

## Architecture

| Area | Change |
|---|---|
| catalog product edit page | Bounded explicit identity and descriptor import wiring |
| `components/productFormSections.ts` | Pure descriptors, schemas, composition validation, payload/dependency/action facts |
| catalog product policy façade | Locked current-record merge and accepted-policy validation before existing command |
| catalog extension facts | Stable edit surface, ten section ids, dependencies, capabilities, actions |
| test-only app fixture | Real app-level overrides under the integration fixture tree; never production-discovered or emitted by default |

The framework spec owns generic `shared`, `ui`, generator, and bootstrap changes. This adopter does not redefine those contracts.

## Data Models

No database entity, column, relation, index, or migration changes. The product and child records keep current schemas. Runtime descriptors and generated facts are code/build artifacts only.

## API Contracts

Legacy catalog routes retain their URLs and request/response behavior. Policy-enabled edit/actions use the exact additive guarded façade entry points above; attachment façade behavior is pinned by its prerequisite spec. Policy mismatch returns exact HTTP `409` code `extension_policy_mismatch`; record-version mismatch keeps `optimistic_lock_conflict` and is surfaced through `surfaceRecordConflict`.

No existing response field is removed. Any additive response needed by the configured fixture must be documented and tested; nested offer snapshots belong to the separate locking spec.

## UI/UX

- No policy: current edit form renders and saves unchanged.
- Valid pending policy: standard loading state, no edit/action controls.
- Valid ready policy: hidden cards occupy no space; added/replaced cards use existing group layout, keyboard, focus, and accessibility behavior.
- Failed/mismatched configured policy: blocking error plus structured internal diagnostic, no edit/action controls, never partial customization.

No new primitive or user-facing policy editor is added.

## Frontend Architecture Contract

- The existing edit root remains a client component; no new page-root client boundary and no create-root source change.
- The edit route root receives at most 20 net lines of wiring.
- Descriptors/schemas/facts live in the pure route-local module and do not enter global providers.
- No new production dependency.
- Catalog edit route gzip delta stays under 10 KiB without explicit waiver; create route source has a zero-line diff (shared chunks may legitimately change).
- `yarn check:client-boundaries` passes. The Playwright hydration case fails on any React hydration/console error or any editable base-form frame before ready. Record one `yarn dev:profile` edit-route RSS sample and baseline/commit metadata as informational evidence; RSS has no pass/fail threshold in this adopter.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Hidden compliance contains client-invalid/server-valid stored value | Visible edit succeeds; hidden value omitted and preserved |
| Hidden required custom field is empty | Visible edit reaches submit and succeeds; hidden custom field unchanged |
| One metadata section hidden | Server merges active authorized leaves with current locked hidden leaves |
| Details hidden while SEO widget active | Policy fails closed unless widget disabled or replacement provides contract |
| UoM hidden | No conversion create/update/delete call |
| Visible UoM conversion stale | Exact optimistic conflict; parent may already be committed per legacy ordering; no later conversion/action runs |
| Categorize hidden | No category/tag/offer payload or offer deletion |
| Edit initial values omit `id` | Explicit update/resource identity still resolves correctly |
| Edit policy appears on create | Create has no policy identity and stays on its unchanged legacy flow |
| Replacement exposes undeclared action | Action unavailable; façade rejects mismatched token |
| Manifest changes during edit | `409 extension_policy_mismatch`; reload/retry guidance |
| Configured policy fails bootstrap/dependency checks | `ErrorMessage`, `crud_form_section_policy_invalid` diagnostic, and zero mutation controls |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Hidden values are cleared | Critical | Omit hidden leaves; merge server-owned nested leaves from locked record | New fields must be assigned to a descriptor |
| Invisible validation blocks save | High | Explicit active section schemas, composition validator, custom-field projection | Domain authors must classify new cross-field rules |
| Secondary writes still run | High | Descriptor-owned lifecycle and per-section tests | Indirect future actions need fact updates |
| Action auth/locks weaken | High | Guarded façade delegates to existing provider and preserves ACL/scoping/locks | Misdeclared new surface fails closed |
| No-policy behavior drifts | High | Baseline payload/endpoint/order equivalence tests | Refactor must remain focused |
| Client route grows | Medium | Pure descriptor module and declared LOC/bundle/RSS budgets | Existing route remains large |

Rollback removes the catalog eligibility/facts and fixture. The generic framework remains installed but this host returns to the complete base form. No data rollback is required.

## Migration & Backward Compatibility

This adopter is additive. It does not rename/remove `crud-form:catalog.product`, the ten group ids, existing routes, response fields, component handles, or `hiddenGroupIds`. The guarded façades are additive and legacy endpoints remain usable by non-policy clients.

The edit host id, `edit` variant, `update` operation, ten section ids, contribution/capability ids, mutation-surface ids, and documented data-contract ids become stable. Any future rename/removal follows the repository deprecation protocol.

## Phasing

1. Catalog descriptors and explicit active validation.
2. Locked server adapter and metadata preservation.
3. Secondary-write binding, dependencies, and catalog action façades after attachment/offer prerequisites.
4. Configured fixture, unit/integration/Playwright coverage, docs, and harness refresh.

Each phase leaves the default no-policy edit flow working.

## Implementation Plan

### Phase 1 — descriptors and validation

1. Add `productFormSections.ts` with the ordered ten ids, explicit section schemas/validators, composition validator, field/custom-field ownership, payload leaves, dependencies, secondary writes, and action facts.
2. Wire only the edit page with `formVariant='edit'`, `formOperation='update'`, `hostResourceKind='catalog.product'`, `hostResourceId={product.id}`, and descriptors. Do not modify or declare policy identity on create.
3. Replace whole-form client parsing on the policy path with section parsing plus composition validation. Add one active/hidden projection test for every section, including `minOrderQty=100000001` and hidden required custom fields, plus a ten-row replacement matrix proving the exact required field ownership, capabilities, dependencies, data contracts, and failure for each target.

### Phase 2 — preservation adapter

4. Add the catalog product policy façade/capability. Load the scoped current product under the parent optimistic lock, merge only active payload leaves, run authoritative domain validation, then delegate to the existing product command.
5. Implement metadata leaf ownership and test details-visible/metadata-hidden, metadata-visible/details-hidden, both visible, both hidden, and concurrent hidden-leaf change preservation.
6. Prove no-policy payload fields, endpoint selection, child-write order, events/audit, and optimistic-lock behavior match the pre-refactor baseline.

### Phase 3 — writes, dependencies, actions

7. Move conversion sync, category/tag/versioned-offer projection, and other submit-coupled branches behind owning descriptors without changing visible-section ordering or the prerequisite offer-change protocol.
8. Publish `catalog.product.edit.title/v1`, `catalog.product.edit.details-seo/v1`, `catalog.product.edit.option-schema/v1`, and `catalog.product.edit.offer-fallbacks/v1`. Test dependency mismatch, widget disablement, and compatible replacement.
9. Add the exact catalog option-schema/variant façades from the action table and bind them plus the prerequisite attachment façades through `runSectionMutation`; test ACL, scope, policy, resource, lock, conflict, reload, hide, and replacement behavior.

### Phase 4 — end-to-end proof

10. Add a self-contained, test-only fixture module under `.ai/qa/fixtures/crudform-section-policy/`; its `modules.ts` hides compliance/UoM, replaces one action-bearing section, adds one new display-only section positioned relative to a stable built-in id, and disables SEO when details is removed. Assert production module discovery and create-app default emission exclude it.
11. Add Playwright coverage for absent/replaced/added cards, edit/create isolation, pending submit block, explicit update identity, replacement action, visible-field save, preserved compliance/conversions/custom fields/metadata, disabled widget handlers, and configured-policy blocking failure. Create and clean up every fixture record.
12. Add API/integration tests for the exact parent façade binding/delegation, omission-preserves versus explicit-null-clears, capability mismatch, exact 409 shapes, legacy endpoint behavior, tenant/org scoping, permission denial, stale conversion update/delete, post-success conversion token refresh, and partial-success stop behavior.
13. Document the catalog recipe and distinction among `hiddenGroupIds`, `forms.sections`, and `widgets.injection`; refresh the standalone harness through `om-refresh-standalone-harness` with its required failure-first focused test and release report.
14. Record `yarn check:client-boundaries`, focused catalog unit/integration/Playwright commands, create-source no-diff assertion, edit bundle gzip delta, hydration trace, dev RSS edit sample, standalone harness report path, and every configured validation command with exit status.

## Integration Coverage

- Product policy façade: exact route/capability/surface/resource/operation, active leaf merge, hidden leaf preservation, explicit null clear, stale parent conflict, policy mismatch, wrong scope, one command delegation, and exact `crud_form_section_policy_invalid` diagnostic fields.
- Independent actions: every tabled option-schema/variant route plus both prerequisite attachment routes, exact capability/surface ids, ACL, parent/child resource versions, and delegated-provider call count.
- Conversion lifecycle: per-row update/delete tokens, fresh returned versions, stale-child unified conflict, no later child calls, and pinned already-committed-parent boundary.
- Browser: configured `modules.ts` policy through bootstrap, real UI, save, reload, persistence, action replacement, and widget disablement.
- No-policy baseline: golden request payload, endpoint URL/method, ordered command/event/audit trace, mutation headers, and two successive saves.

## Acceptance Criteria

1. A standalone app module can add a new section relative to any stable id, hide any stable section, or propose a replacement for any stable section without copying the page; descriptor-level tests cover compatible and missing capability/dependency/field ownership for all ten replacement targets.
2. All ten section ids are documented and contract-pinned.
3. Hidden sections contribute no unreachable client/custom-field errors, payload leaves, side effects, or actions.
4. Saving a visible field preserves every hidden stored value, including conversions and nested metadata leaves.
5. Pinned golden payloads and ordered traces prove visible sections retain current domain validation, exact lock bindings, event ids/payloads, audit records, and write ordering.
6. Injected widgets are disabled through widget overrides, not card hiding; dependency mismatches fail closed.
7. Create remains unaffected and policy-ineligible.
8. Unknown ids and stale manifests expose no mutation controls and emit `crud_form_section_policy_invalid` with host, variant, operation, contribution id, and reason.
9. Self-contained unit, API/integration, and configured Playwright tests ship with implementation.
10. The named client-boundary, focused catalog, create-source no-diff, edit bundle, hydration, standalone harness, and configured validation gates pass with recorded artifacts; RSS is recorded as informational evidence.

## Prior Review Finding Disposition

| Finding | Resolution |
|---|---|
| Framework and catalog were independently deployable but bundled | Generic contract extracted to `2026-10-22-crudform-section-overrides-framework.md`; this file is catalog-only |
| Shared descriptor mixed server facts with UI/runtime types | Shared facts moved to framework data contract; runtime validators/groups/clients stay UI/domain-owned |
| Undefined validation/payload/context semantics | This adopter uses explicit section validation results, payload projectors, and a composition validator defined by the framework |
| Arbitrary Zod projection could lose transforms/refinements | Explicit section schemas preserve transforms; cross-section rules are allocated deliberately; server validates merged full state |
| Four-argument component handle broke the public signature | Framework preserves the two-argument helper and encodes variant/operation in a separate scope string |
| Hidden validation, custom fields, metadata, bootstrap, browser proof | Each has an explicit phase, invariant, and regression case above |

## Final Compliance Report

| Area | Status | Evidence required before implementation PR approval |
|---|---|---|
| Scope cohesion | Ready | Catalog edit adopter only; framework/create/rollout/attachment/offer locking separate |
| Data safety | Ready | Omission plus locked server merge; no browser-snapshot preservation |
| Compatibility | Ready | Additive façades/facts; stable host and group ids retained |
| Security/scoping | Ready | Existing ACL and tenant/org filters remain authoritative |
| Integration coverage | Ready | All affected parent/action API and key UI paths listed |
| Frontend architecture | Ready | Bounded route wiring and measurable gates |
| Ownership | Ready | Implementation restricted to Open Mercato core team members |

## Changelog

- **2026-10-22:** Split the generic framework into its own spec and refocused this document on catalog product edit. Defined explicit section validation/composition semantics, server-owned preservation, stable two-argument replacement handles through the framework scope helper, action façades, complete tests, and core-team-only implementation ownership.
- **2026-10-09:** Generalized the original draft and audited catalog failure modes, actions, dependencies, bootstrap, and browser coverage.
- **2026-09-30:** Initial catalog product section-policy draft for issue #6686.
