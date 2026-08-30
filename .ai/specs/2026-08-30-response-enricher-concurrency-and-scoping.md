# Response Enricher Concurrency and Request Scoping

**Status:** Ready for re-review

**Tracking issue:** [#5779](https://github.com/open-mercato/open-mercato/issues/5779)
**Related roadmap:** [Enterprise Performance & Stability Hardening](https://github.com/open-mercato/open-mercato/pull/5777)

## 📝 TLDR

Reduce CRUD response-enrichment tail latency without changing default responses. The response-enricher runner will execute independent enrichers concurrently within equal-priority bands while preserving serial ordering between priorities, and authenticated CRUD list GET callers may use an additive `?enrich=` selector to skip declared enrichment namespaces they do not need. Existing callers continue to run every eligible enricher, and `OM_ENRICHERS_CONCURRENT_BANDS=0` restores the legacy serial execution path for one release.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|----------|-----------------|-----------|----------|
| Q1 | Keep concurrency and request scoping together or split them? | Keep one issue-aligned spec and implementation PR. | The maintainer confirmed that #5779 intentionally treats the scheduler and selector as one response-enricher performance deliverable despite their independent deployability. | confirmed 2026-08-30 |
| Q2 | What is the selector contract? | Use exact, case-sensitive, trimmed `providesFields` tokens. An absent `enrich` parameter means all; a present empty value means no declared fields. | Exact tokens add no wildcard parser or ambiguous namespace rules, while the absent/present distinction preserves existing callers and provides an explicit minimal request. | ok |
| Q3 | Which HTTP operations receive request scoping? | Populate `requestedFields` only for authenticated CRUD list GET requests. | `makeCrudRoute` owns list request parsing, while generic single-record enrichment is also used by mutation responses and detail routes build context elsewhere. Keeping detail and mutation selection out of scope avoids an incomplete contract. | revised after review |
| Q4 | How does the rollout switch behave? | Default concurrent bands on; parse the shared boolean vocabulary; `0`/`off` restores fully serial execution. | This ships the measured performance improvement by default while retaining a one-release operational escape hatch and avoiding ad hoc boolean parsing. | ok |

## 📝 Problem Statement

`applyResponseEnrichers` and `applyResponseEnricherToRecord` currently await each active enricher in strict sequence. Because every enricher owns an independent timeout (2 seconds by default), unrelated enrichers at the same priority accumulate latency and can produce an N × timeout tail. The public `EnricherContext.requestedFields` hook is already declared but never populated, so CRUD list consumers cannot avoid work for enrichment namespaces they do not render.

The 2026-08 production-topology benchmark cited by #5779 recorded 2,104 slow-enricher threshold events in a three-minute run at 20 offered journeys per second. This spec covers the focused runner, per-enricher cache-format safety, and list request-contract changes needed to remove that amplification; query-engine pipeline concurrency remains outside scope.

## 📝 Proposed Solution

Partition the already priority-sorted active enrichers into descending priority bands. Execute every member of one band against the same immutable band input, derive an additive delta from each successful or fallback result, await the band as a unit, and merge those deltas deterministically in registry order before starting the next lower-priority band. Plain-object deltas merge recursively so two same-module enrichers can extend the same namespace without erasing distinct nested fields; arrays, scalars, and conflicting leaves remain atomic, with the later registry entry winning. Each entry retains its own timeout, fallback, critical-error behavior, cache behavior, timing metric, and metadata outcome.

Read-through caches store only the owning enricher's versioned additive delta, never a whole enriched record. A cache hit applies that delta to the current band input through the same deterministic merge path, preventing a result cached under a broader selector or feature cohort from reintroducing another enricher's fields.

Add optional `providesFields?: string[]` metadata to `ResponseEnricher`. For authenticated CRUD list GET requests, parse `?enrich=` into `EnricherContext.requestedFields`; when the parameter is present, skip an enricher only if it declares `providesFields` and none of those exact tokens were requested. Enrichers without metadata remain fail-open and continue to run. Absence of the parameter is byte-compatible with current behavior.

## 📝 Overview

The response-enricher contract is a shared extension point used by first-party and third-party modules. Registry entries are already globally sorted by descending `priority`, and the documented model requires enrichers to add namespaced data. Different priorities therefore remain an ordered pipeline, while equal priorities are an independence declaration and can share one input snapshot. Multiple enrichers from the same module may legitimately extend the same top-level namespace, so correctness depends on extracting and recursively merging their additive object deltas rather than spreading full-record results.

The request-scoping half follows the response-shaping principle used by [JSON:API sparse fieldsets](https://jsonapi.org/format/#fetching-sparse-fieldsets): callers can state which optional response data they intend to consume, while omission preserves the server's normal response. Open Mercato uses a dedicated `enrich` parameter instead of overloading `fields`, because the latter is already associated with base-record projection and must not acquire extension-execution semantics. The existing `enrichMany` requirement remains unchanged and continues the batch-first approach exemplified by [GraphQL DataLoader](https://github.com/graphql/dataloader); band concurrency complements batching and must never replace it with per-record work.

### Scope

In scope:

- Concurrent execution for equal-priority entries in both list and single-record response-enricher runners.
- Serial execution across descending priority bands so explicit dependencies remain expressible.
- A one-release, default-on environment switch that restores the full legacy serial runner.
- Additive `ResponseEnricher.providesFields?: string[]` metadata.
- CRUD-list-GET-only parsing of `?enrich=` into the already-public `EnricherContext.requestedFields` field.
- Selection-aware active-enricher and CRUD-list-cache planning.
- Versioned per-enricher read-through cache entries that store additive deltas instead of whole records.
- One first-party declaration (`customers.deal-pipeline-state` provides `_pipeline`) and API integration coverage proving the generic list route behavior.
- OpenAPI query documentation, public narrative documentation, and monorepo/standalone `.env.example` parity.

Out of scope:

- Cache invalidation policy changes or changes to the separate CRUD list response-cache storage format.
- Query-engine extension-runner concurrency or query-engine-specific field selection.
- Generic detail-route `?enrich=` selection; single-record runner concurrency remains in scope, but detail routes own their contexts outside `makeCrudRoute` and require a separate end-to-end design.
- A wildcard or hierarchical selector language.
- Automatic inference of `providesFields` from runtime output.
- Retrofitting every shipped enricher declaration in this PR; undeclared enrichers deliberately keep running under explicit selection.
- Changes to enricher discovery, override precedence, ACL feature matching, tenant scoping, or the `enrichMany` batch contract.

## 📝 Architecture

### Selection pipeline

For an authenticated list GET request handled by `makeCrudRoute`:

1. The list path checks `URLSearchParams.has('enrich')` so absence remains distinguishable from a present empty value.
2. When present, it calls the existing `readQueryParamList(searchParams, 'enrich')` helper to normalize repeated and comma-separated values, then de-duplicates tokens in first-seen order and stores them as `requestedFields`.
3. If the parameter is absent, `requestedFields` remains `undefined`; `enrichSingleRecord` and every non-list caller also leave it `undefined`.
4. ACL, tenant-disable, and requested-field filters select the active entries.
5. The same selected entries drive both `resolveListCacheEnricherPlan` and response execution.
6. The runner partitions the selected, already-sorted entries into priority bands and executes them.

Selection is deliberately fail-open for legacy declarations. When `requestedFields` is defined, an entry is skipped only when it has a non-`undefined` `providesFields` array and the two arrays have no exact match. An enricher that omits `providesFields` always runs because the framework cannot prove that skipping it is safe. An empty `providesFields` array is an explicit declaration that no selectable token is provided and is skipped by every explicit `enrich` request; module authors should normally omit the property instead.

### Priority-band execution

The runner uses the following conceptual algorithm for both list and single-record paths:

```text
input = original response record(s)
for each descending priority band:
  bandInput = input
  outcomes = await all band entries against bandInput
  if a critical outcome failed: throw the first failed critical entry in registry order
  deltas = derive additive deltas for successful, cached, and fallback outcomes
  input = merge deltas onto bandInput in registry order
return input
```

The implementation should extract shared helpers for band partitioning, entry execution, and deterministic merging only where doing so removes duplication without widening the public surface. The kill switch bypasses banding and uses the existing fully serial semantics for the entire list or record pipeline.

### Deterministic merge rules

- Every member of a band receives the same immutable-by-convention `bandInput` reference. Enrichers remain responsible for returning new records and not mutating their input.
- For each record, the runner derives an additive structural delta by comparing an outcome with that entry's input. Keys omitted from the outcome do not encode deletion. New or changed plain-object branches are traversed recursively; arrays, scalars, dates, and other non-plain objects are atomic values.
- List deltas remain aligned to the current records and retain the original list order. Single-record results use the same delta representation.
- Deltas merge in stable registry order. Plain objects merge recursively, so `{ _module: { first: 1 } }` and `{ _module: { second: 2 } }` produce both nested fields even when the enrichers share a module and priority. If two deltas change the same leaf, the later registry entry wins, matching the legacy stable registration-order winner.
- Fallback objects are treated as additive deltas and use the same recursive merge rules. The framework does not add deletion semantics; enrichers remain additive by contract.
- A lower-priority band receives the fully merged output of every higher-priority band. An enricher that intentionally consumes another enricher's output must declare a strictly lower priority; equal priority means no data dependency.
- `enrichedBy` and `enricherErrors` remain ordered by registry order, never by promise completion order. Cache hits count as enriched; non-critical failures remain in `enricherErrors` and do not enter `enrichedBy`, matching current behavior.
- Each entry retains its own timeout, read-through cache key/tags, fallback, timing measurement, slow threshold, and `critical` policy. A critical failure aborts the response after the band settles enough to choose the first failed critical entry in registry order; no partial current-band merge is returned.

### Rollout switch

`OM_ENRICHERS_CONCURRENT_BANDS` is parsed with `parseBooleanWithDefault(..., true)` from `@open-mercato/shared/lib/boolean`.

- Unset or a recognized true token: priority-band concurrency is enabled.
- `0`, `false`, `off`, `disable`, or another recognized false token: the legacy entry-by-entry serial runner is used.
- An unrecognized value falls back to enabled, consistent with the shared parser contract.

The switch changes only scheduling. Requested-field selection still applies in both modes. The variable is documented in `apps/mercato/.env.example` and mirrored to `packages/create-app/template/.env.example` with `yarn template:sync:fix`. It is retained for one minor release and may be removed only after production timing/error telemetry shows no merge or dependency regressions.

### Cache interaction

Requested-field filtering occurs before `resolveListCacheEnricherPlan`, per-enricher cache lookup, or execution. Explicitly skipped or ACL/tenant-ineligible entries therefore never read or apply their cache entries.

The separate per-enricher read-through cache changes from whole enriched records to a versioned delta format:

- Cache keys include a new format version so legacy whole-record entries are guaranteed misses and can expire naturally.
- A successful live execution stores only the delta attributable to that enricher relative to its input. It never stores unchanged base fields or namespaces inherited from earlier priorities.
- A list cache value maps each stable record id to its delta, so a hit is applied to the current list without restoring a cached record order. Single-record values store one delta.
- A cache hit recursively merges the cached delta onto the current band input through the same registry-order merge path as a live outcome.
- Because active-entry filtering precedes lookup and an entry's cache contains only its own delta, a cache primed by a broader selector or authorization cohort cannot reintroduce an excluded or ACL-gated peer namespace.
- Cache resolution/read/write failures remain fail-open, and existing TTLs and invalidation tags remain unchanged.

The CRUD list response-cache plan remains selection-aware:

- Explicitly skipped enrichers do not appear in its signature.
- A selected all-cacheable cohort may still use the enriched cache-hit fast path.
- Any selected non-cacheable or undeclared enricher keeps the existing live-enrichment path.
- A request that selects no declared enrichers stores and serves only the base payload in its selector-specific CRUD cache cohort; the existing normalized query segment keeps that cohort separate from an otherwise equivalent request.

## 📝 Data Model

No entities, tables, columns, migrations, indexes, cache stores, or persistent configuration records change. `requestedFields` and `providesFields` are in-memory request/declaration metadata only.

Tenant and organization isolation remain owned by the existing context and each enricher's scoped queries. Requested-field selection narrows the already ACL- and tenant-eligible cohort; it never adds an entry that those filters rejected.

## 📝 API Contracts

### Generic CRUD list GET selector

All `makeCrudRoute` list GET requests whose route opts into `enrichers: { entityId }` accept:

```http
GET /api/<resource>?enrich=<token>[,<token>...]
```

Repeated parameters are equivalent to one comma-separated value:

```http
GET /api/customers/deals?enrich=_pipeline&enrich=_anotherNamespace
```

Contract:

| Request shape | `EnricherContext.requestedFields` | Execution |
|---------------|-----------------------------------|-----------|
| no `enrich` parameter | `undefined` | Every ACL/tenant-eligible enricher runs, preserving current behavior. |
| `?enrich=` | `[]` | Declared enrichers are skipped; enrichers without `providesFields` still run. |
| `?enrich=_pipeline` | `['_pipeline']` | Declared enrichers run only when `providesFields` intersects exactly. |
| `?enrich=_pipeline,_pipeline` | `['_pipeline']` | Duplicate tokens are removed. |
| `?enrich=unknown` | `['unknown']` | No validation error; no declared enricher matches, while undeclared enrichers remain fail-open. |

Tokens are case-sensitive opaque identifiers. First-party declarations should use the top-level response namespace they own, including the leading underscore (for example `_pipeline` or `_customer_accounts`). A declaration may list multiple tokens when one batch operation supplies multiple independent namespaces.

The parameter is read only by the generic CRUD list path. Generic single-record enrichment, POST, PUT, PATCH, and DELETE responses receive `requestedFields: undefined` even if a caller appends `enrich`, so mutation responses remain byte-compatible. Generic detail GET selection is explicitly out of scope because detail routes assemble their own contexts outside this factory.

### OpenAPI contract

The selector is part of the public list query schema, not narrative-only documentation. The implementation adds a reusable optional `enrich` field accepting `string | string[]` to the query schema passed to `createCrudOpenApiFactory` for every CRUD list route that opts into response enrichers. Its description states that repeated and comma-separated tokens are equivalent, matching is exact and case-sensitive, omission runs all eligible enrichers, and a present empty value is an explicit empty selection.

OpenAPI tests inspect the generated GET query schema and assert that it:

- accepts a single comma-separated string and repeated string values;
- preserves `''` as a present value instead of coercing it to absence;
- keeps the entire `enrich` property optional, preserving absent-versus-empty semantics; and
- documents the parameter only on the GET list operation, never on mutation operations.

The customers deals route is the first end-to-end proof: its `dealListQuerySchema` composes the shared field before that schema is passed to both `makeCrudRoute` and `createCustomersCrudOpenApi`, preventing runtime/OpenAPI drift.

### Type contract

`ResponseEnricher` gains one additive optional property:

```typescript
export interface ResponseEnricher<TRecord = any, TEnriched = any> {
  // Existing fields remain unchanged.
  providesFields?: string[]
}
```

`EnricherContext.requestedFields?: string[]` already exists and keeps its type and meaning; the change activates it for CRUD list GET requests. No required field, import path, registry shape, function parameter, API route URL, or response field is removed or narrowed.

### Response metadata

`_meta.enrichedBy` lists only enrichers that executed successfully or returned a read-through cache hit. `_meta.enricherErrors` lists only executed non-critical failures. Skipped entries appear in neither array. The arrays remain in registry order.

## 📝 UI/UX

There is no new screen or component. Backend pages and data consumers may add `enrich=<namespace>` to existing CRUD list GET URLs when they know the exact extension data they render. Callers that do nothing retain the full current response.

Visual mockups and browser screenshots are not applicable because the feature changes API execution and latency only; no rendered UI is added or modified.

## 📝 Edge Cases & Failure Scenarios

- **Equal-priority dependency:** an enricher that reads another equal-priority enricher's output may observe only the prior band input. The contract and docs require a lower priority for dependencies; the kill switch offers rollback during the compatibility window.
- **Same-module namespace extensions:** distinct nested keys are recursively preserved; only conflicting writes to the same leaf use the later registry entry.
- **Timeout in one band member:** other band members complete independently. A non-critical timeout contributes fallback/error metadata; a critical timeout fails the response.
- **Read-through cache failure:** fail-open behavior remains per entry and cannot block other band members; legacy whole-record cache keys miss after the format-version bump.
- **Cache primed by a broader cohort:** only the selected entry's own delta can be read and applied, so excluded or ACL-gated peer namespaces are not restored.
- **Unknown or duplicated tokens:** unknown values are harmless non-matches and duplicates are removed without returning 400.
- **Whitespace-only selector:** it resolves to an empty explicit selection, not to `undefined`.
- **Enricher without `providesFields`:** it always runs for compatibility, even under `?enrich=`.
- **CRUD list cache:** selection is applied before the cache signature so excluded namespaces cannot leak from another cohort's cached payload.
- **Detail request with `enrich`:** the parameter has no selection effect; detail-route support requires separate context wiring and is outside this change.
- **Mutation requests with `enrich`:** the selector is ignored and all eligible enrichers run, preserving mutation-response behavior.
- **Malformed enricher output:** the runner keeps the existing expectation that list enrichers return aligned records. This feature does not add a new validator or silently reorder records.

## 📝 Migration & Backward Compatibility

This change touches stable contract surfaces and is intentionally additive:

- `ResponseEnricher.providesFields` is optional, which `BACKWARD_COMPATIBILITY.md` permits for exported interfaces.
- `makeCrudRoute` keeps the same function signature and return shape.
- `EnricherContext.requestedFields` is not changed; it is populated for the first time on CRUD list GET requests.
- `?enrich=` is an optional query parameter. Its absence preserves the active cohort and response bytes.
- Existing enrichers that omit `providesFields` remain unskippable and therefore cannot disappear from an explicit request unexpectedly.
- Cross-priority dependency behavior is preserved. Same-priority visibility becomes concurrent by default because equal priority carries no declared order/dependency contract; the environment switch restores the legacy sequence during rollout.
- Metadata order is preserved in registry order, not completion order.
- Per-enricher read-through cache keys are format-versioned and legacy entries become misses; TTLs, tags, and fail-open behavior are preserved while values narrow from whole records to additive deltas.

No deprecation is introduced. The spec and public response-enricher documentation must land with the implementation. Release notes are not required for an additive optional type field, but the changelog should call out the default-on scheduling change and its escape hatch.

## 📝 Risks & Impact Review

### Same-priority enricher has an undeclared dependency

- **Scenario:** An existing enricher reads a namespace written by another enricher with the same priority, so concurrent execution sees the band input instead of the peer's output.
- **Severity:** High
- **Affected area:** Any CRUD route where those two extension modules are enabled together.
- **Mitigation:** Preserve serial ordering across priorities; document equal priority as independent; scan shipped enrichers for cross-namespace reads; keep `OM_ENRICHERS_CONCURRENT_BANDS=0` for one release; add a test proving lower-priority consumers receive the merged higher band.
- **Residual risk:** Third-party modules may depend on incidental registration order despite the existing contract. The kill switch bounds operational impact while module owners assign explicit priorities.

### Concurrent load increases downstream pressure

- **Scenario:** Several equal-priority enrichers start database or remote-service work simultaneously, reducing latency but increasing instantaneous connection or rate-limit demand.
- **Severity:** Medium
- **Affected area:** Shared database pools and external integrations used by same-priority enrichers.
- **Mitigation:** Concurrency is bounded by the number of active entries in one entity/priority band; existing per-entry timeouts and batch queries remain mandatory; the kill switch is immediate; benchmark pool wait and error metrics before removing it.
- **Residual risk:** A route with an unusually large equal-priority cohort may need priorities or provider-side limits adjusted.

### Incorrect merge loses or overwrites enriched fields

- **Scenario:** Promise completion order leaks into the output, or two same-module/same-priority enrichers overwrite distinct nested additions under their shared namespace.
- **Severity:** High
- **Affected area:** Response payload correctness across all enriched CRUD routes.
- **Mitigation:** Derive additive structural deltas, recursively merge plain-object branches after the band completes in stable registry order, and add list and single-record regressions with inverted completion order plus two same-module enrichers adding distinct nested keys.
- **Residual risk:** Two enrichers writing different values to the same leaf still have one deterministic registry-order winner.

### Field selection contaminates cache cohorts

- **Scenario:** A whole-record per-enricher cache value primed under a broader selector or feature cohort is applied to a narrower request and restores an excluded or ACL-gated namespace; alternatively, an excluded non-cacheable enricher is accidentally treated as active by the CRUD list cache plan.
- **Severity:** High
- **Affected area:** Cached CRUD list APIs and potentially tenant-visible extension fields.
- **Mitigation:** Filter active entries before all cache lookup/planning; version per-enricher cache keys; store only owning-enricher deltas; merge hits onto current input; cover a broader-cohort prime followed by explicit exclusion and missing-feature requests, plus empty, subset, absent, cacheable, and non-cacheable CRUD cache cohorts.
- **Residual risk:** A buggy enricher can still put unauthorized data inside its own declared delta; that remains the module's existing authorization responsibility.

### Ambiguous or stale `providesFields` declarations

- **Scenario:** A module declares the wrong token, causing explicit callers to skip an enricher they expected or to keep doing unnecessary work.
- **Severity:** Medium
- **Affected area:** Only callers that opt into `?enrich=`; default callers are unaffected.
- **Mitigation:** Keep undeclared entries fail-open, document exact top-level tokens, test the first-party `_pipeline` declaration end to end, and treat declaration/output drift as a module contract test concern.
- **Residual risk:** Third-party declaration mistakes can affect their opt-in consumers until corrected.

### Rollout configuration drifts between monorepo and scaffold

- **Scenario:** Operators cannot discover or consistently set the kill switch in standalone apps.
- **Severity:** Low
- **Affected area:** Deployment rollback ergonomics.
- **Mitigation:** Update `apps/mercato/.env.example`, run `yarn template:sync:fix`, and verify `packages/create-app/template/.env.example` parity.
- **Residual risk:** Existing deployments must add the variable manually only if they need the rollback path.

## 📋 Phasing

### Phase 1: Priority-band execution with rollback

Introduce the shared scheduler/delta-merge behavior and versioned per-enricher delta cache for list and single-record runners behind the default-on kill switch. Add deterministic unit coverage for concurrency, same-module namespace composition, cross-band ordering, metadata, timeout/fallback, cache hits, cross-cohort cache isolation, critical errors, and the fully serial escape path. The application remains deployable after this phase; response selection is unchanged.

### Phase 2: Requested-field activation and first-party proof

Add `providesFields`, CRUD-list-GET query parsing through `readQueryParamList`, selection-aware cache planning, OpenAPI schema wiring, the `_pipeline` declaration, public docs, environment-template parity, and API integration coverage. Existing callers remain unchanged because the selector is optional.

## 📋 Implementation Plan

### Phase 1: Priority-band execution with rollback

1. Add internal helpers in `packages/shared/src/lib/crud/enricher-runner.ts` to group already-sorted entries by numeric priority and resolve the default-on flag with `parseBooleanWithDefault`.
2. Add internal structural-delta helpers that recursively diff and merge plain objects, treat arrays/scalars as atomic, ignore deletions, and resolve conflicting leaves in registry order. Use them for successful and fallback outcomes.
3. Refactor list entry execution into per-entry outcomes that preserve read-through cache, timeout, fallback, `critical`, timing, and metadata semantics; merge each completed band's deltas before starting the next.
4. Version per-enricher cache keys and store only per-record additive deltas (record-id keyed for lists), applying hits to the current input instead of replacing it with a cached record.
5. Apply the same scheduler, delta cache, and deterministic merge rules to single-record execution, keeping legacy serial scheduling available behind the switch without retaining unsafe whole-record cache replacement.
6. Add `packages/shared/src/lib/crud/__tests__/enricher-runner.test.ts` using controlled promises rather than wall-clock sleeps to prove same-band overlap, cross-band sequencing, stable merge/metadata order, two same-module/same-priority enrichers adding distinct nested keys, critical failure, fallback, timeout, cache behavior, broad-to-excluded and authorized-to-unauthorized cache isolation, legacy-key misses, and serial-switch behavior.
7. Document `OM_ENRICHERS_CONCURRENT_BANDS=true` in `apps/mercato/.env.example`, mirror it with `yarn template:sync:fix`, and verify template parity.

### Phase 2: Requested-field activation and first-party proof

8. Add optional `providesFields?: string[]` with contract documentation in `packages/shared/src/lib/crud/response-enricher.ts`.
9. Extend the active-entry filter in `packages/shared/src/lib/crud/enricher-runner.ts` so absent `requestedFields` runs all entries, explicit selections skip only non-intersecting declared entries, and ACL/tenant checks remain mandatory.
10. Populate `requestedFields` only for the list context in `packages/shared/src/lib/crud/factory.ts`: use `URLSearchParams.has` for absent-versus-empty and the existing `readQueryParamList` for repeated/comma-separated values. Leave `enrichSingleRecord` and mutation contexts unchanged.
11. Ensure `resolveListCacheEnricherPlan` uses the same filtered cohort and add unit coverage for absent, empty, matching, non-matching, undeclared, cacheable, and non-cacheable selections.
12. Add a reusable optional `enrich: string | string[]` list-query field and compose it into every enriched CRUD list query schema passed to both `makeCrudRoute` and `createCrudOpenApiFactory`. Add schema-generation assertions for repeated/comma-separated acceptance, present empty, absent, and GET-only documentation.
13. Declare `providesFields: ['_pipeline']` on `customers.deal-pipeline-state` and add a self-contained customers API integration test that creates its own deal fixture, verifies default/full and explicit `_pipeline` responses, verifies `?enrich=` omits `_pipeline` without changing base fields, and cleans up in `finally`.
14. Update `apps/docs/docs/framework/widget-injection.md` and `apps/docs/docs/framework/api/crud-factory.mdx` with the declaration/query contract, list-only scope, delta-cache behavior, priority-band dependency rule, and rollback switch.
15. Run focused shared/core tests, the executable integration test, template sync verification, package build/typecheck, and the repository's configured validation gate. Record benchmark evidence comparing serial versus concurrent controlled enrichers and confirm the band duration approaches the maximum member latency rather than their sum.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/shared/src/lib/crud/enricher-runner.ts` | Modify | Select entries, partition priority bands, derive/merge deltas, version per-enricher cache entries, and honor the kill switch. |
| `packages/shared/src/lib/crud/response-enricher.ts` | Modify | Add the optional `providesFields` public contract. |
| `packages/shared/src/lib/crud/query-params.ts` | Modify | Reuse repeated/comma-separated parsing and expose the shared optional query-field schema. |
| `packages/shared/src/lib/crud/factory.ts` | Modify | Populate `requestedFields` only for list GET requests and feed the same list context to cache planning/execution. |
| `packages/shared/src/lib/crud/__tests__/enricher-runner.test.ts` | Add | Cover scheduling, recursive delta merge, failure, selection, cross-cohort delta-cache safety, and rollback semantics. |
| `packages/shared/src/lib/crud/__tests__/crud-factory.enricher-cache.test.ts` | Modify | Cover selector-aware factory/cache cohorts where the existing harness is closest. |
| `packages/shared/src/lib/crud/__tests__/query-params.test.ts` | Modify | Lock repeated/comma-separated and absent-versus-present-empty selector parsing. |
| `packages/core/src/modules/customers/data/enrichers.ts` | Modify | Declare `_pipeline` as a first-party selectable field. |
| `packages/core/src/modules/customers/api/{companies,deals,interactions,people}/route.ts` | Modify | Compose the shared `enrich` field into enriched list query schemas used by runtime and OpenAPI. |
| `packages/core/src/modules/staff/api/timesheets/time-projects/route.ts` | Modify | Compose the shared `enrich` field into the remaining enriched CRUD list query schema. |
| `packages/core/src/modules/customers/api/deals/__tests__/openapi.test.ts` | Add | Assert the generated GET query schema documents repeated/comma, present empty, and absence semantics without adding the parameter to mutations. |
| `packages/core/src/modules/customers/__integration__/TC-CRM-ENRICH-001.spec.ts` | Add | Exercise default, explicit, and empty enrichment selection on a real CRUD list API. |
| `apps/mercato/.env.example` | Modify | Document the rollout switch. |
| `packages/create-app/template/.env.example` | Modify/generated sync | Preserve standalone configuration parity. |
| `apps/docs/docs/framework/widget-injection.md` | Modify | Document module-author declaration and priority dependency rules. |
| `apps/docs/docs/framework/api/crud-factory.mdx` | Modify | Document the GET selector, cache semantics, and compatibility behavior. |

### Validation Strategy

Run locally unless an `app` compose container is already active, in which case use the repository's Docker runner for the complete gate:

```bash
yarn workspace @open-mercato/shared test --runInBand enricher-runner
yarn workspace @open-mercato/shared test --runInBand crud-factory.enricher-cache
yarn workspace @open-mercato/shared test --runInBand query-params
yarn workspace @open-mercato/core test --runInBand openapi
yarn workspace @open-mercato/core test --runInBand customers
npx playwright test --config .ai/qa/tests/playwright.config.ts TC-CRM-ENRICH-001
yarn template:sync
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
```

Acceptance criteria:

- Controlled equal-priority enrichers both start before either is released; a lower-priority entry does not start until the band merges.
- With concurrency enabled, a band containing delays A and B completes near `max(A, B)` rather than `A + B`; with the switch disabled, it remains serial.
- Output and metadata order are independent of promise completion order.
- Two same-module/same-priority enrichers that add distinct nested keys retain both keys; conflicting leaves resolve in registry order.
- A per-enricher cache primed under a broader selector or authorized feature cohort cannot restore excluded or unauthorized peer fields, and legacy whole-record cache entries are ignored.
- Default GET responses are byte-equivalent in fields and metadata to the legacy runner.
- `?enrich=` excludes `_pipeline`; `?enrich=_pipeline` and an absent parameter include it; base deal fields remain identical.
- The generated list GET OpenAPI schema accepts single/repeated forms, preserves a present empty value, and keeps absence distinct; mutation operations do not document `enrich`.
- Detail and mutation response enrichment leave `requestedFields` undefined.
- ACL, tenant/organization scoping, timeout/fallback/critical behavior, and cache safety tests continue to pass.
- `yarn template:sync` reports no drift after the env change.

## Final Compliance Report — 2026-08-30

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/AGENTS.md` (API Routes, CRUD Factory, and Response Enrichers)
- `packages/create-app/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root `AGENTS.md` | Preserve behavior unless explicitly changed by the issue/spec. | Compliant | Omitted `enrich` preserves the active cohort; cross-priority order remains serial; the scheduling change has a rollback switch. |
| root `AGENTS.md` | Public contract changes require backward-compatibility review. | Compliant | The only type addition is optional; the optional query parameter and compatibility behavior are documented in this spec. |
| `BACKWARD_COMPATIBILITY.md` | Stable interfaces may gain optional fields; `makeCrudRoute` signature/return shape must not break. | Compliant | `providesFields?` is additive and no existing required field, parameter, route, or response field changes. |
| `packages/shared/AGENTS.md` | Shared infrastructure uses precise, narrow types and existing helpers. | Compliant | The selector is `string[]`; parsing reuses `readQueryParamList`; the rollout flag uses `parseBooleanWithDefault`; no domain dependency enters shared. |
| `packages/shared/AGENTS.md` | Wildcard-aware ACL checks remain canonical. | Compliant | Selection is applied in addition to, never instead of, existing ACL/tenant filtering. |
| `packages/core/AGENTS.md` | List enrichers keep `enrichMany`, namespaced fields, feature gating, and tenant safety. | Compliant | The scheduler preserves batch calls and context; `_pipeline` is an existing namespaced output. |
| `.ai/qa/AGENTS.md` | Integration tests are executable, self-contained, deterministic, and cleaned up. | Compliant | `TC-CRM-ENRICH-001` creates and deletes its own deal fixture and uses the preferred module `__integration__` location. |
| root + `packages/create-app/AGENTS.md` | App env changes must remain synchronized with the create-app template. | Compliant | The plan runs `yarn template:sync:fix` and verifies `yarn template:sync`. |
| root `AGENTS.md` | Tenant/organization scoping must never be weakened. | Compliant | Requested fields can only remove already-eligible enrichers; all existing scope filters remain. |
| root `AGENTS.md` | No direct cross-module ORM relationships or schema changes. | N/A | The feature adds no entity, relationship, migration, or persistent data. |
| root `AGENTS.md` | UI work must use the design system and i18n. | N/A | No UI-rendering file or user-facing string changes. |
| root `AGENTS.md` | New editable entities use optimistic locking. | N/A | No entity or mutation form is added. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No persistent model changes; declaration/context types match selector semantics. |
| API contracts match UI/UX section | Pass | GET consumers may opt in; no UI is required and default callers remain unchanged. |
| Risks cover all write operations | Pass | There are no data writes; scheduling, cache, merge, downstream pressure, and rollout risks are covered. |
| Commands defined for all mutations | N/A | No mutation is introduced. |
| Cache strategy covers all read APIs | Pass | Active filtering precedes all lookup/planning, per-enricher caches store versioned owning-entry deltas, and the CRUD list cache plan uses the same selected cohort. |
| Integration coverage covers affected API paths | Pass | The generic list path is exercised through customers deals; OpenAPI assertions cover the selector schema; runner unit tests cover single-record scheduling without claiming detail selection. |

### Non-Compliant Items

None. The fresh-context review correctly identified that the two phases are independently deployable; the maintainer explicitly approved a one-spec/one-implementation-PR exception because #5779 defines them as one response-enricher performance deliverable.

### Verdict

**Compliant under an explicit maintainer-approved scope exception:** Requested changes resolved; ready for re-review and implementation.

## Changelog

### 2026-08-30

- Added the focused response-enricher concurrency and requested-field scoping specification for #5779.
- Recorded four autonomous defaults, the additive compatibility contract, cache-safety requirements, rollback switch, integration coverage, and phased implementation plan.
- Recorded maintainer confirmation that #5779 intentionally ships both independently deployable phases as one specification and implementation PR.
- Resolved review feedback by replacing whole-record band merges with recursive additive deltas, changing per-enricher caches to a versioned delta format with cross-cohort isolation tests, narrowing `?enrich=` to CRUD list GETs, reusing `readQueryParamList`, and adding explicit OpenAPI schema coverage.

### Review — 2026-08-30

- **Reviewer:** Agent
- **Security:** Passed after remediation — selection only narrows the existing ACL/tenant-eligible cohort, filtering precedes cache lookup, and cached values contain only the owning enricher's delta.
- **Performance:** Passed — band concurrency removes additive same-priority latency while retaining batch queries and a bounded rollback path.
- **Cache:** Passed after remediation — per-enricher caches are versioned additive deltas rather than whole records, with broad-to-narrow selector and feature-cohort regressions required.
- **Merge correctness:** Passed after remediation — recursive plain-object delta merging preserves distinct nested additions from same-module/same-priority enrichers and keeps registry-order conflict resolution.
- **API/OpenAPI:** Passed after remediation — request selection is list-only, parsing reuses `readQueryParamList`, and the generated GET query schema must assert repeated/comma, empty, and absent semantics.
- **Commands:** N/A — no mutations or commands are introduced.
- **Risks:** Passed — dependency, merge, downstream pressure, cache cohort, declaration drift, and rollout risks have mitigations and residuals.
- **Scope cohesion:** Exception approved — the two phases are independently deployable, and the maintainer confirmed they remain bundled as the single performance deliverable tracked by #5779.
- **Verdict:** All requested changes addressed; ready for re-review and implementation under the recorded scope exception.
