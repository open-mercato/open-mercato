# Response Enricher Concurrency and Request Scoping

**Status:** Draft — ⚠ NEEDS HUMAN CONFIRMATION on scope split

**Tracking issue:** [#5779](https://github.com/open-mercato/open-mercato/issues/5779)
**Related roadmap:** [Enterprise Performance & Stability Hardening](https://github.com/open-mercato/open-mercato/pull/5777)

## 📝 TLDR

Reduce CRUD response-enrichment tail latency without changing default responses. The response-enricher runner will execute independent enrichers concurrently within equal-priority bands while preserving serial ordering between priorities, and authenticated GET callers may use an additive `?enrich=` selector to skip declared enrichment namespaces they do not need. Existing callers continue to run every eligible enricher, and `OM_ENRICHERS_CONCURRENT_BANDS=0` restores the legacy serial execution path for one release.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|----------|-----------------|-----------|----------|
| Q1 | Keep concurrency and request scoping together or split them? | Provisionally keep one issue-aligned spec and implementation PR, but do not implement until a maintainer confirms or requests two specs/issues. | The issue and `om-auto-fix-issue` feature route require one implementation PR, but the fresh-context scope review found the scheduler and selector independently deployable under the repository's one-capability-per-spec rule. Resolving that conflict changes the delivery shape. | ⚠ NEEDS HUMAN CONFIRMATION |
| Q2 | What is the selector contract? | Use exact, case-sensitive, trimmed `providesFields` tokens. An absent `enrich` parameter means all; a present empty value means no declared fields. | Exact tokens add no wildcard parser or ambiguous namespace rules, while the absent/present distinction preserves existing callers and provides an explicit minimal request. | ok |
| Q3 | Which HTTP operations receive request scoping? | Populate `requestedFields` only for authenticated GET list/detail requests. | Pages consume GET responses; keeping mutation response enrichment unchanged minimizes behavioral surface and makes rollback straightforward. | ok |
| Q4 | How does the rollout switch behave? | Default concurrent bands on; parse the shared boolean vocabulary; `0`/`off` restores fully serial execution. | This ships the measured performance improvement by default while retaining a one-release operational escape hatch and avoiding ad hoc boolean parsing. | ok |

## 📝 Problem Statement

`applyResponseEnrichers` and `applyResponseEnricherToRecord` currently await each active enricher in strict sequence. Because every enricher owns an independent timeout (2 seconds by default), unrelated enrichers at the same priority accumulate latency and can produce an N × timeout tail. The public `EnricherContext.requestedFields` hook is already declared but never populated, so list/detail consumers cannot avoid work for enrichment namespaces they do not render.

The 2026-08 production-topology benchmark cited by #5779 recorded 2,104 slow-enricher threshold events in a three-minute run at 20 offered journeys per second. This spec covers the focused runner and request-contract changes needed to remove that amplification; per-enricher caching, CRUD-cache-hit behavior, and query-engine pipeline concurrency remain outside scope.

## 📝 Proposed Solution

Partition the already priority-sorted active enrichers into descending priority bands. Execute every member of one band against the same immutable band input, await the band as a unit, merge results deterministically in registry order, then pass the merged output to the next lower-priority band. Each entry retains its own timeout, fallback, critical-error behavior, cache behavior, timing metric, and metadata outcome.

Add optional `providesFields?: string[]` metadata to `ResponseEnricher`. For authenticated GET requests, parse `?enrich=` into `EnricherContext.requestedFields`; when the parameter is present, skip an enricher only if it declares `providesFields` and none of those exact tokens were requested. Enrichers without metadata remain fail-open and continue to run. Absence of the parameter is byte-compatible with current behavior.

## 📝 Overview

The response-enricher contract is a shared extension point used by first-party and third-party modules. Registry entries are already globally sorted by descending `priority`, and the documented model requires each enricher to add data under its own top-level namespace. Those two facts provide a safe concurrency boundary: different priorities remain an ordered pipeline, while equal priorities are an independence declaration and can share one input snapshot.

The request-scoping half follows the response-shaping principle used by [JSON:API sparse fieldsets](https://jsonapi.org/format/#fetching-sparse-fieldsets): callers can state which optional response data they intend to consume, while omission preserves the server's normal response. Open Mercato uses a dedicated `enrich` parameter instead of overloading `fields`, because the latter is already associated with base-record projection and must not acquire extension-execution semantics. The existing `enrichMany` requirement remains unchanged and continues the batch-first approach exemplified by [GraphQL DataLoader](https://github.com/graphql/dataloader); band concurrency complements batching and must never replace it with per-record work.

### Scope

In scope:

- Concurrent execution for equal-priority entries in both list and single-record response-enricher runners.
- Serial execution across descending priority bands so explicit dependencies remain expressible.
- A one-release, default-on environment switch that restores the full legacy serial runner.
- Additive `ResponseEnricher.providesFields?: string[]` metadata.
- GET-only parsing of `?enrich=` into the already-public `EnricherContext.requestedFields` field.
- Selection-aware active-enricher and CRUD-list-cache planning.
- One first-party declaration (`customers.deal-pipeline-state` provides `_pipeline`) and API integration coverage proving the generic list route behavior.
- Public documentation and monorepo/standalone `.env.example` parity.

Out of scope:

- Read-through caching changes, cache invalidation changes, or skipping enrichers on CRUD cache hits beyond selection-aware planning.
- Query-engine extension-runner concurrency or query-engine-specific field selection.
- A wildcard or hierarchical selector language.
- Automatic inference of `providesFields` from runtime output.
- Retrofitting every shipped enricher declaration in this PR; undeclared enrichers deliberately keep running under explicit selection.
- Changes to enricher discovery, override precedence, ACL feature matching, tenant scoping, or the `enrichMany` batch contract.

## 📝 Architecture

### Selection pipeline

For an authenticated GET request handled by `makeCrudRoute`:

1. `buildEnricherContext` reads every `enrich` query value from `ctx.request`.
2. Each value is split on commas, trimmed, de-duplicated in first-seen order, and stored as `requestedFields`.
3. If the parameter is absent, `requestedFields` remains `undefined`.
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
  input = merge successful and fallback outcomes onto bandInput in registry order
return input
```

The implementation should extract shared helpers for band partitioning, entry execution, and deterministic merging only where doing so removes duplication without widening the public surface. The kill switch bypasses banding and uses the existing fully serial semantics for the entire list or record pipeline.

### Deterministic merge rules

- Every member of a band receives the same immutable-by-convention `bandInput` reference. Enrichers remain responsible for returning new records and not mutating their input.
- List results merge by input index, retaining the original list order. Each result is spread over the accumulated record in stable registry order. Single-record results use the same stable spread order.
- Because conforming enrichers own disjoint top-level namespaces, a later merge cannot erase another enricher's field. If two equal-priority enrichers violate the contract and write the same key, the later registry entry wins, matching the previous stable registration-order winner.
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

Requested-field filtering occurs before `resolveListCacheEnricherPlan` computes its signature and `skipEnrichersOnCacheHit` decision. Therefore:

- Explicitly skipped enrichers do not appear in the signature.
- A selected all-cacheable cohort may still use the enriched cache-hit fast path.
- Any selected non-cacheable or undeclared enricher keeps the existing live-enrichment path.
- A request that selects no declared enrichers stores and serves only the base payload in its selector-specific CRUD cache cohort; the existing normalized query segment may keep that cohort separate from an otherwise equivalent request.
- The cache never serves a namespace that the request excluded, and no ACL/tenant filter is weakened.

## 📝 Data Model

No entities, tables, columns, migrations, indexes, cache stores, or persistent configuration records change. `requestedFields` and `providesFields` are in-memory request/declaration metadata only.

Tenant and organization isolation remain owned by the existing context and each enricher's scoped queries. Requested-field selection narrows the already ACL- and tenant-eligible cohort; it never adds an entry that those filters rejected.

## 📝 API Contracts

### Generic CRUD GET selector

All `makeCrudRoute` GET list/detail requests whose route opts into `enrichers: { entityId }` accept:

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

The parameter is read only for GET requests. POST, PUT, PATCH, and DELETE response enrichment receives `requestedFields: undefined` even if a caller appends `enrich`, so mutation responses remain byte-compatible.

### Type contract

`ResponseEnricher` gains one additive optional property:

```typescript
export interface ResponseEnricher<TRecord = any, TEnriched = any> {
  // Existing fields remain unchanged.
  providesFields?: string[]
}
```

`EnricherContext.requestedFields?: string[]` already exists and keeps its type and meaning; the change activates it for CRUD GET requests. No required field, import path, registry shape, function parameter, API route URL, or response field is removed or narrowed.

### Response metadata

`_meta.enrichedBy` lists only enrichers that executed successfully or returned a read-through cache hit. `_meta.enricherErrors` lists only executed non-critical failures. Skipped entries appear in neither array. The arrays remain in registry order.

## 📝 UI/UX

There is no new screen or component. Backend pages and data consumers may add `enrich=<namespace>` to existing GET URLs when they know the exact extension data they render. Callers that do nothing retain the full current response.

Visual mockups and browser screenshots are not applicable because the feature changes API execution and latency only; no rendered UI is added or modified.

## 📝 Edge Cases & Failure Scenarios

- **Equal-priority dependency:** an enricher that reads another equal-priority enricher's output may observe only the prior band input. The contract and docs require a lower priority for dependencies; the kill switch offers rollback during the compatibility window.
- **Overlapping namespaces:** stable registry-order merge determines the winner, but overlapping writes remain a contract violation and are not legitimized by this feature.
- **Timeout in one band member:** other band members complete independently. A non-critical timeout contributes fallback/error metadata; a critical timeout fails the response.
- **Read-through cache failure:** existing fail-open cache behavior remains per entry and cannot block other band members.
- **Unknown or duplicated tokens:** unknown values are harmless non-matches and duplicates are removed without returning 400.
- **Whitespace-only selector:** it resolves to an empty explicit selection, not to `undefined`.
- **Enricher without `providesFields`:** it always runs for compatibility, even under `?enrich=`.
- **CRUD list cache:** selection is applied before the cache signature so excluded namespaces cannot leak from another cohort's cached payload.
- **Mutation requests with `enrich`:** the selector is ignored and all eligible enrichers run, preserving mutation-response behavior.
- **Malformed enricher output:** the runner keeps the existing expectation that list enrichers return aligned records. This feature does not add a new validator or silently reorder records.

## 📝 Migration & Backward Compatibility

This change touches stable contract surfaces and is intentionally additive:

- `ResponseEnricher.providesFields` is optional, which `BACKWARD_COMPATIBILITY.md` permits for exported interfaces.
- `makeCrudRoute` keeps the same function signature and return shape.
- `EnricherContext.requestedFields` is not changed; it is populated for the first time on GET requests.
- `?enrich=` is an optional query parameter. Its absence preserves the active cohort and response bytes.
- Existing enrichers that omit `providesFields` remain unskippable and therefore cannot disappear from an explicit request unexpectedly.
- Cross-priority dependency behavior is preserved. Same-priority visibility becomes concurrent by default because equal priority carries no declared order/dependency contract; the environment switch restores the legacy sequence during rollout.
- Metadata order is preserved in registry order, not completion order.

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

- **Scenario:** Promise completion order leaks into the output, or full-record results from one enricher overwrite a peer's namespace.
- **Severity:** High
- **Affected area:** Response payload correctness across all enriched CRUD routes.
- **Mitigation:** Merge outcomes only after the band completes, in stable registry order, onto the original band input; add list and single-record regression tests with inverted completion order and disjoint namespaces.
- **Residual risk:** Two contract-violating enrichers writing the same key still have one deterministic winner, as they did under serial execution.

### Field selection contaminates CRUD cache cohorts

- **Scenario:** A payload enriched for one selector is served to a request that excluded that namespace, or an excluded non-cacheable enricher is accidentally treated as active.
- **Severity:** High
- **Affected area:** Cached CRUD list APIs and potentially tenant-visible extension fields.
- **Mitigation:** Apply requested-field filtering inside the single active-entry resolver used by execution and cache planning; cover empty, subset, absent, cacheable, and non-cacheable cohorts in unit tests.
- **Residual risk:** None beyond the existing correctness of cache key scoping and ACL/tenant selection.

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

Introduce the shared scheduler/merge behavior for list and single-record runners behind the default-on kill switch. Add deterministic unit coverage for concurrency, cross-band ordering, metadata, timeout/fallback, cache hits, critical errors, and the fully serial escape path. The application remains deployable after this phase; response selection is unchanged.

### Phase 2: Requested-field activation and first-party proof

Add `providesFields`, GET query parsing, selection-aware cache planning, the `_pipeline` declaration, public docs, environment-template parity, and API integration coverage. Existing callers remain unchanged because the selector is optional.

## 📋 Implementation Plan

### Phase 1: Priority-band execution with rollback

1. Add internal helpers in `packages/shared/src/lib/crud/enricher-runner.ts` to group already-sorted entries by numeric priority and resolve the default-on flag with `parseBooleanWithDefault`.
2. Refactor list entry execution into per-entry outcomes that preserve read-through cache, timeout, fallback, `critical`, timing, and metadata semantics; merge each completed band deterministically before starting the next.
3. Apply the same scheduler and deterministic merge rules to single-record execution, keeping legacy serial helpers available behind the switch rather than duplicating behavior.
4. Add `packages/shared/src/lib/crud/__tests__/enricher-runner.test.ts` using controlled promises rather than wall-clock sleeps to prove same-band overlap, cross-band sequencing, stable merge/metadata order, critical failure, fallback, timeout, cache behavior, and serial-switch behavior.
5. Document `OM_ENRICHERS_CONCURRENT_BANDS=true` in `apps/mercato/.env.example`, mirror it with `yarn template:sync:fix`, and verify template parity.

### Phase 2: Requested-field activation and first-party proof

6. Add optional `providesFields?: string[]` with contract documentation in `packages/shared/src/lib/crud/response-enricher.ts`.
7. Extend the active-entry filter in `packages/shared/src/lib/crud/enricher-runner.ts` so absent `requestedFields` runs all entries, explicit selections skip only non-intersecting declared entries, and ACL/tenant checks remain mandatory.
8. Populate `requestedFields` in `packages/shared/src/lib/crud/factory.ts` from repeated/comma-separated GET `enrich` parameters, preserving `undefined` when absent and ignoring the parameter for non-GET methods.
9. Ensure `resolveListCacheEnricherPlan` uses the same filtered cohort and add unit coverage for absent, empty, matching, non-matching, undeclared, cacheable, and non-cacheable selections.
10. Declare `providesFields: ['_pipeline']` on `customers.deal-pipeline-state` and add a self-contained customers API integration test that creates its own deal fixture, verifies default/full and explicit `_pipeline` responses, verifies `?enrich=` omits `_pipeline` without changing base fields, and cleans up in `finally`.
11. Update `apps/docs/docs/framework/widget-injection.md` and `apps/docs/docs/framework/api/crud-factory.mdx` with the declaration/query contract, priority-band dependency rule, cache interaction, and rollback switch.
12. Run focused shared/core tests, the executable integration test, template sync verification, package build/typecheck, and the repository's configured validation gate. Record benchmark evidence comparing serial versus concurrent controlled enrichers and confirm the band duration approaches the maximum member latency rather than their sum.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/shared/src/lib/crud/enricher-runner.ts` | Modify | Select entries, partition priority bands, execute/merge outcomes, and honor the kill switch. |
| `packages/shared/src/lib/crud/response-enricher.ts` | Modify | Add the optional `providesFields` public contract. |
| `packages/shared/src/lib/crud/factory.ts` | Modify | Populate `requestedFields` for GET requests and feed the same context to cache planning/execution. |
| `packages/shared/src/lib/crud/__tests__/enricher-runner.test.ts` | Add | Cover scheduling, merge, failure, selection, cache, and rollback semantics. |
| `packages/shared/src/lib/crud/__tests__/crud-factory.enricher-cache.test.ts` | Modify | Cover selector-aware factory/cache cohorts where the existing harness is closest. |
| `packages/core/src/modules/customers/data/enrichers.ts` | Modify | Declare `_pipeline` as a first-party selectable field. |
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
- Default GET responses are byte-equivalent in fields and metadata to the legacy runner.
- `?enrich=` excludes `_pipeline`; `?enrich=_pipeline` and an absent parameter include it; base deal fields remain identical.
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
| `packages/shared/AGENTS.md` | Shared infrastructure uses precise, narrow types and existing helpers. | Compliant | The selector is `string[]`; the rollout flag uses `parseBooleanWithDefault`; no domain dependency enters shared. |
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
| Cache strategy covers all read APIs | Pass | The active cohort is shared by execution and list-cache planning, preventing cross-selector cache leakage. |
| Integration coverage covers affected API paths | Pass | The generic list path is exercised through customers deals; runner unit tests cover single-record scheduling and selector semantics. |

### Non-Compliant Items

#### Scope cohesion requires a maintainer decision

- **Rule:** A spec covers one independently deployable capability; a `SPLIT` verdict returns to the maintainer as an Open Question.
- **Source:** `.ai/skills/om-spec-writing/references/spec-checklist.md` §1.
- **Gap:** Priority-band concurrency remains complete with response selection unchanged after Phase 1, while requested-field scoping works under either the concurrent or legacy serial scheduler. Sharing a runner file and performance goal does not make either capability depend on the other.
- **Recommendation:** Confirm one of two delivery shapes before implementation: (a) keep #5779 intentionally bundled as one implementation PR and record an explicit exception, or (b) split into a concurrency spec/issue and a requested-field scoping spec/issue, then update the top-level feature route accordingly.

### Verdict

**Non-compliant:** Blocked pending ⚠ NEEDS HUMAN CONFIRMATION on the scope/delivery shape.

## Changelog

### 2026-08-30

- Added the focused response-enricher concurrency and requested-field scoping specification for #5779.
- Recorded four autonomous defaults, the additive compatibility contract, cache-safety requirements, rollback switch, integration coverage, and phased implementation plan.

### Review — 2026-08-30

- **Reviewer:** Agent
- **Security:** Passed — selection only narrows the existing ACL/tenant-eligible cohort and cache planning uses the same filter.
- **Performance:** Passed — band concurrency removes additive same-priority latency while retaining batch queries and a bounded rollback path.
- **Cache:** Passed — selector-aware active entries drive both cache signatures and execution.
- **Commands:** N/A — no mutations or commands are introduced.
- **Risks:** Passed — dependency, merge, downstream pressure, cache cohort, declaration drift, and rollout risks have mitigations and residuals.
- **Scope cohesion:** Split recommended — the two phases are independently deployable and have distinct contracts/risks.
- **Verdict:** Needs revision pending maintainer confirmation of the one-PR exception or a two-spec/two-issue split.
