# CRM deal types

**Date:** 2026-10-22 · **Status:** Draft · **Issue:** [#7700](https://github.com/open-mercato/open-mercato/issues/7700)

## 📝 TLDR

Add an optional, tenant-configurable deal type so sales teams can distinguish new business, upsells, cross-sells and renewals without repurposing pipeline stages or status. The field works through existing deal commands, forms, filters, exports and API-backed AI reads. It ships independently of stage/outcome synchronization, actual close dates, creator provenance and line-item valuation.

## Resolved assumptions (autonomous defaults)

| ID | Question | Default and rationale |
|---|---|---|
| DT1 | Are the four types a fixed enum? | No. They are seeded dictionary defaults. Preserve custom, imported and historical tokens with bounded lenient text, matching existing customer classification conventions. |
| DT2 | Should old deals become new business automatically? | No. Existing rows and new creates that omit the field remain `null`; no inference from title, source, customer status, amount or related deals. |
| DT3 | Does type depend on closure or line items? | No. Fresh scope review identified an independent capability; neither spec is an implementation prerequisite. |
| DT4 | Does renewal type drive financial or workflow behavior? | No. Descriptive classification only; no automatic forecast probability, pricing, subscription or closure changes. |

## 📝 Overview and Problem Statement

At audited baseline `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`, `CustomerDeal` has source/status/stage but no deal type. All three already serve different purposes. #7700 requests four business-motion defaults; the design preserves tenant-specific alternatives and unknown values rather than treating that suggested list as an exhaustive schema.

Sales operations can filter renewals without creating a separate renewal pipeline. A rep can label an upsell on any open or closed deal without reopening it or changing its value. An importer can preserve an upstream custom classification without altering the tenant's stage/status vocabulary.

## 📝 Proposed Solution

Add nullable `CustomerDeal.dealType` and use customer dictionary kind `deal-types`. Use the existing dictionary labels/appearance/sort management and the existing deal create/update aggregate. The first-party UI offers a single select with an explicit Unspecified state and preserves an unrecognized current token as a retained option. The route slug and stored dictionary kind are both `deal-types`; do not introduce a new alias that remaps an already-supported custom slug.

Rejected alternatives: fixed enum blocks tenant terminology; defaulting every record to `new_business` fabricates data; encoding type in stage requires duplicate pipelines and changes progress semantics; automatically copying a similarly named custom field can overwrite unrelated tenant-defined data. This feature does none of those.

## 📝 Architecture and Real Call Sites

Domain/runtime changes remain under `packages/core/src/modules/customers/`; the narrow registration exception is `configs/lib/upgrade-actions.ts` for the existing tenant-upgrade mechanism, which invokes the customers-owned seeding function. No new package, external provider, shared domain helper, public AI mutation tool or workflow engine behavior is required.

| Existing path | Required integration |
|---|---|
| `data/entities.ts`, `data/validators.ts`, `commands/deals.ts` | Nullable field, lenient validation, create/update persistence and complete before/after/delete/redo snapshots. |
| `api/deals/route.ts`, `api/deals/[id]/route.ts` | Create/update input, indexed list projection, detail output, filter/count/export and OpenAPI. |
| `api/deals/aggregate/route.ts` | Same type filter as the list plus cache-key normalization; lane aggregates must not include excluded deals. |
| `api/dictionaries/context.ts`, `lib/dictionaries.ts`, `cli.ts`, `setup.ts` | Expose `deal-types` in settings with identity mapping to stored kind `deal-types`; seed a previously absent dictionary idempotently and preserve existing dictionaries/settings. |
| `components/detail/DealForm.tsx`, `components/detail/create/{CreateDealForm,DealDetailsFields,dealFormTypes}.tsx/ts` | Both existing form families carry an optional value; preserve public object-literal compatibility. |
| `components/detail/DealsSection.tsx`, deal-detail `hooks/useDealFormHandlers.ts` | Person/company embedded create and detail save preserve/submit the field with the deal version. |
| `backend/customers/deals/pipeline/components/QuickDealDialog.tsx` and pipeline page | Quick-create input and pipeline filter propagation; drag/drop and other stage actions preserve type. |
| `ai-tools/deals-pack.ts` | `customers.list_deals` gains optional type filter; list/get mappings retain nullable type from existing APIs. Existing stage mutation never changes/invents type. |
| `workflows.ts` | Existing `customers.deals.update` safe-command candidate remains off by default unless enabled by the tenant; adding the optional field does not enable workflows or grant permissions. |

No customers deal-import adapter was found in this baseline. Do not invent or scaffold one in this change. Document the existing create/update command/API payload for adapter authors; test import-style command invocations with `syncOrigin`, explicit type and omitted type. Any discovered supported importer during implementation must use these guarded commands, not direct ORM writes. Existing stress/demo CLI SQL inserts may omit the nullable column; update typed table metadata when necessary without guessing example types.

### Write, undo and concurrency contract

`dealCreateSchema`/`dealUpdateSchema` accept optional nullable `dealType`, trimmed text of at most 150 characters (matching dictionary value bounds). Empty/whitespace normalizes to `null`; omitted update preserves the current value. Values are case-preserved tokens, not labels or a closed enum. Literal unknown strings remain accepted and round-trippable. Dictionary management controls offered choices, not whether historical/imported records can be read.

Use `customers.deals.create/update` and their normal scope, mutation-guard, optimistic-lock, audit, custom-field and side-effect pipeline. Extend the existing `runCrudCommandWrite` update phases; never introduce a direct type-only ORM bypass. Snapshot the field in create/update/delete and redo reconstruction. Undo restores the old type under current authorization and version safeguards; missing fields in older stored snapshots mean unknown/absent, not an instruction to clear a newer value. A legacy snapshot replay must preserve the current type unless that operation predates and recreates the entire deal, in which case restored type is `null`. Test the old-snapshot branch explicitly.

Capture immutable before/after type values within the mutation transaction and feed the logging hook from that result; do not reload a racing writer's type as this operation's after-state. Advance the deal's `updatedAt` on an actual type mutation. Existing custom fields, owner/source/status/stage/value fields stay unchanged when absent. Post-commit CRUD/index/cache effects refresh list/detail/aggregate/AI reads. No type-specific event is added, and this write must not emit won/lost events when status is unchanged.

AI callers remain subject to `prepareMutation`/pending-action approval and endpoint RBAC when executing documented PUT through the existing operation runner. No existing mutation tool schema or allowlist is widened to smuggle type changes into `customers.update_deal_stage`; its preservation behavior is tested. Workflow/import command execution respects the same field validator, scope, command guards and actor policy; retries of the same literal update converge.

## 📝 Data Models

| Owner | Property / column | Definition |
|---|---|---|
| `CustomerDeal` / `customer_deals` | `dealType` / `deal_type` | Nullable text, default `NULL`; bounded at API/command boundary to 150 characters. |
| Existing `CustomerDictionaryEntry` | `kind='deal-types'` | Seed `new_business`, `upsell`, `cross_sell`, `renewal` only for a previously absent dictionary; scoped tenant/org labels and existing appearance/order metadata. |

Add a partial live-row index `(tenant_id, organization_id, deal_type, id) WHERE deleted_at IS NULL`. Keep all existing indexes, columns and unique constraints. No new child entity, foreign key or custom-field definition is needed. Existing `updated_at` remains the aggregate version.

Deal type is a bounded business classification, with no new note, contact or personal-assessment field. It follows the existing plaintext deal `status`/`source` dictionary treatment and is not added to encryption maps. Existing encrypted title/description reads continue through decryption helpers. Never copy names, email content or identifiers into type automatically; do not log input tokens or arbitrary imported payloads. Tenant/org restrictions apply to dictionary and deal queries.

### Migration and Backward Compatibility

Generate/review an additive nullable-column/index migration plus matching customers schema snapshot. Existing rows stay `NULL`. Setup seeds new tenants; an idempotent customer dictionary upgrade action seeds `deal-types` only when the scope has neither entries nor a kind-setting row for that kind. The current dictionary commands have no kind-level serialization, so add a customers-owned advisory transaction helper for this kind. Upgrade seeding, entry create/update/delete and kind-setting writes targeting `deal-types` acquire the same `customers_dictionary_kind` lock keyed by tenant/organization/kind; acquire it before checking existence and use its transaction/entity manager throughout. Use existing `withAdvisoryXactLock` without a nested/forked write transaction. This is an explicit new coordination point in customers, not an assumed existing guarantee. The first seed writes a kind-setting marker even for an empty dictionary; concurrent administrator writes serialize, and an existing marker prevents later reseeding. Preserve all other kinds and current route guards/response shapes. Test seed versus entry create/delete and kind-setting changes, including lock ordering and failed-transaction rollback. Per-entry ON CONFLICT alone is insufficient. A tenant that already registered custom kind `deal-types` keeps its entries, defaults, labels, sort mode, selection mode, visibility, ordering and colors exactly; do not append missing defaults. Existing intentionally empty dictionaries remain empty. The native deal field is single-valued regardless of the dictionary's pre-existing tag selection mode, and never changes that setting. Keep any separate stored `deal_type` kind unchanged as well; do not merge or rename it. A pre-existing `cf_deal_type` remains a separate custom field with its original semantics; no automatic promotion or deletion occurs.

All request fields are optional and response fields additive. Make new TypeScript form/output properties optional where consumers construct the exported shape. Old snapshots, clients and UI payloads keep working. No legacy status, stage label, endpoint, event, ACL, DI key or injection spot changes. Rollback leaves the additive column and stored values intact; no data-reversing down migration is needed. This design PR does not apply a local migration.

## 📝 API Contracts

| Route / tool | Additive contract |
|---|---|
| `POST /api/customers/deals` | Optional `dealType: string|null`; absence stores null. Existing response envelope unchanged. |
| `PUT /api/customers/deals` | Optional `dealType`; omission preserves, null clears, standard deal version required under existing optimistic-lock policy. |
| `GET /api/customers/deals` | Add `deal_type: string|null`; optional repeated `dealType` query normalized to at most 20 unique exact tokens, 150 chars each. OR within type filter, AND with other categories. Browser/list API callers may use repeated query parameters. The existing AI operation runner supports scalar query values only, so `customers.list_deals` accepts one optional exact `dealType` string; it forwards that scalar without comma joining, array coercion or query text embedded in the manifest path. Shared AI runner types/behavior remain unchanged. Commas inside a token are literal, so custom dictionary values remain filterable. |
| `GET /api/customers/deals/[id]` | Add `deal.dealType: string|null`; preserve all existing detail fields. |
| `GET /api/customers/deals/aggregate` | Accept identical `dealType` normalization/predicate, include it in the existing aggregate cache identity. |
| Existing authenticated deal exports | Include `deal_type` when selected; apply the exact list filter and standard export batching. |
| `GET /api/customers/deals/type-options` | New read-only selector route, guarded by `customers.deals.view`, returning `{ items: [{value,label,icon?,color?}] }` using scoped existing customer dictionary loading. |
| Existing `/api/customers/dictionaries/deal-types` and entry routes | Existing dictionary GET/POST/PATCH/DELETE and sort settings operate on the added kind. Existing management guards stay unchanged. |
| `customers.list_deals`, `customers.get_deal` | Preserve tool IDs/features/policies; add one optional exact string type input to list and nullable `dealType` output to both API-backed mappings. |

The dedicated options GET is intentional: the existing generic dictionary GET requires `customers.people.view`, so a deals-only viewer could otherwise lack the choices despite permission to edit a deal. Reuse the scoped dictionary query/appearance helpers without importing another route handler or widening the generic dictionary route's guard. This endpoint accepts no arbitrary kind; it always reads `deal-types`. No new ACL feature is needed.

Filters operate before pagination/count/export; use parameterized equality/IN queries, not text interpolation. Support explicit `dealTypeEmpty=true|false` (shared boolean parser) for unspecified/assigned records, AND with the token filter when both are supplied; null is not encoded as a magic token that might collide with a tenant value. Existing valid sort semantics remain unchanged; type sorting is not offered in this phase.

Deal writes reuse `customers.deals.manage`, reads `customers.deals.view`, dictionary writes `customers.settings.manage`; wildcard-aware checks are mandatory. Scope comes from auth. Invalid input yields translated 400 field errors, unauthorized requests 403, inaccessible records 404, and stale version the standard 409. Every route exports `metadata`/`openApi`, and existing CRUD routes retain `makeCrudRoute` indexing. Dictionary response caches use existing tenant/org keys; every seed/edit invalidates the options cache, while deal updates invalidate filtered list/aggregate caches.

## 📝 UI/UX and Frontend Architecture Contract

Show Deal type as an optional field in standalone create, embedded person/company deal create, deal detail, and Kanban quick create. Use the same shared field/schema helper across the two existing form families; do not create a third parallel form model. Default to Unspecified. Keep a deleted/unknown current option visible as retained text; saving another field cannot clear it. Add optional list column and a type filter shared by list and pipeline. Pipeline lane totals must match the filtered cards. Dictionary settings gains the Deal types section.

Use `CrudForm`, `DataTable`, existing dictionary selector/appearance components, standard loading/error/empty states, `apiCall` helpers and translated strings in all five locales. Preserve form group IDs, registered component IDs and injection spots. `CrudForm` carries the deal `updatedAt`; quick/inline custom writes use guarded mutation, correct scoped version headers and conflict surfaces. Dialogs support Escape/Cmd+Enter/Ctrl+Enter and labeled icon controls.

| Client ledger / boundary | Constraint |
|---|---|
| Existing deal list/pipeline/detail/create and embedded detail clients | Retain existing client-root exceptions; add no root directive, shared provider or heavy dependency. |
| `DealTypeField` client leaf | Stateful selection and options request; abort/ignore obsolete results after scope changes. Below 300 LOC. |
| Existing dictionary settings client | Add kind metadata and existing editor binding, no new state architecture. |

Server API/lib owns dictionary/scoping/validation; browser code imports no ORM. Require hydration and key-interaction tests for each changed route, client-boundary check and a production bundle comparison with zero new shared dependency chunks and at most 5 KiB gzip route growth. Query tests assert no per-row dictionary lookup. Existing oversized roots must not gain new orchestration complexity.

## 📝 Edge Cases & Failure Scenarios

Removing or relabeling a dictionary choice does not rewrite deal values. Unknown imported values render rather than disappearing. A type-only change to a closed deal leaves its existing closure fields untouched and emits no closure notification. A stale quick dialog produces 409 rather than replacing a concurrent type change. An options request failing leaves a saved type intact and shows retry, not an empty default. A tenant with no seeded options can leave the field unspecified; API writes remain valid.

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Field is lost in one of several create/save forms | Medium | Explicit real-callsite matrix and per-surface browser/API tests. | Out-of-tree clients must opt into the optional field. |
| Pipeline cards and lane totals disagree | High | Shared filter normalization/predicate and aggregate cache identity; parity test. | No type-based forecasting promised. |
| Dictionary rename destroys historical/imported values | High | Lenient bounded text, stable values, retained unknown options, no automatic migration. | Tenant may intentionally maintain many custom tokens. |
| Undo replays a newer writer's after-state or clears absent old-snapshot field | High | Transaction-captured snapshots, version checks and old-snapshot compatibility tests. | Existing command-log delivery lifecycle remains unchanged. |
| New field bypasses AI/import/workflow authorization | High | Existing guarded command/API path, unchanged tool policies and workflow enablement; negative tests. | No new blanket automation grant. |

## 🧪 Integration and Test Coverage

Create and clean fixtures per test. Cover deal POST/PUT/list/detail, aggregate and export; null/empty/omitted/unknown/custom/boundary-long values; 20-token filter bounds and literal comma values; boolean-empty filter; pagination/count/export/aggregate parity; tenant/org isolation; 403/404/409; no PII logs; dictionary lifecycle and dedicated options access for a deals-only user lacking people-view permission. Upgrade fixtures must include an existing custom `deal-types` dictionary, an intentionally empty configured kind, an unrelated `deal_type` kind, settings in non-default modes and colliding seed values; prove no remapping, merging or overwrite and no duplicate seeds after retries.

Command tests cover create/update/delete undo/redo, snapshots predating the field, exact-transaction after-state, concurrent edits, retry convergence and import-style `syncOrigin`. Test type-only updates to open/closed deals leave status/stage/outcome/value fields and closure-event counts unchanged. Exercise existing workflow-safe command with tenant enablement both off/on, using the established workflow test helpers; no new workflow declaration is necessary.

AI tests verify single-token scalar list filter forwarding (including a literal comma), rejection of array tool input without changing the shared runner, nullable type in list/detail outputs, scope/feature denial, and that existing `customers.update_deal_stage` preserves type through its pending-action/API runner path. A generic AI PUT test proves ordinary approval and mutation guards still apply; do not create a live model/provider dependency.

Browser coverage includes standalone deal create, person embedded create, company embedded create, detail edit/clear/unknown-value preservation, Kanban quick create, list/pipeline filter and lane totals, and dictionary settings. Include keyboard flow, hydration, option failure/retry and stale-save conflict. No seeded examples or external service credentials.

## Final Compliance Report — 2026-10-22

Reviewed root/core/customers/shared, AI assistant, UI/backend, cache/events, QA/spec guides and backward-compatibility contract. One independently deployable descriptive classification; no closure/line-item dependency or cross-module ORM relation. Scoped dictionary/read routes, typed optional inputs, command mutation/replay, lock versions, post-commit invalidation, real caller matrix, additive schema and API/UI tests are specified. Encryption exclusion is explicit for bounded business tokens; existing encrypted customer content handling stays intact. Data/API/UI naming and empty/omitted semantics agree. Verdict: ready for design review; implementation and runtime verification are not performed by this document.

## Changelog

- 2026-10-22 — Initial autonomous draft split from deal closure after independent scope review; preserved lenient dictionary values, null defaults and existing writer guards.

## 📋 Phasing and Implementation Plan

1. **Additive data and vocabulary.** Add nullable field/index and migration snapshot, identity dictionary mapping, idempotent seeds for absent dictionaries and typed optional form shape. Old payloads/rows stay valid; test no-inference and existing-kind/settings preservation.
2. **Guarded aggregate writes.** Extend deal schemas, commands, exact transaction snapshots and all replay branches. Prove null/omission, custom fields, stale versions and old snapshots; preserve status/value side effects.
3. **Consistent reads and integrations.** Add list/detail/export/aggregate predicates/cache keys, dedicated type-options GET and OpenAPI. Extend API-backed AI mapping and verify workflow/import-style command use without widening policies.
4. **Every UI entry point.** Wire the shared field across real create/detail/quick-create forms, type column/filter, pipeline totals and dictionary settings. Add translations and route/browser tests.
5. **Validate and document.** Run scoped suites and configured gates with selected runner, client/bundle evidence and migration no-op checks. Document optional `dealType` for import/API consumers; do not apply local migrations without authorization.
