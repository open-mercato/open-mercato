# Catalog generate-missing variants operation

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-27-catalog-variant-combination-claim.md`, `.ai/specs/implemented/2026-05-25-oss-optimistic-locking.md`
**Related:** `.ai/specs/2026-09-30-catalog-product-form-section-policy.md`

## TLDR

Replace the product edit page's browser-side loop of `catalog.variants.create` calls with one reusable, scoped `catalog.variants.generate_missing` domain operation and ordinary catalog API. The server recomputes missing complete finite combinations in stable code order, delegates every candidate to the landed combination-claim boundary, treats only the typed duplicate as a skip, and preserves the existing ordered partial-success behavior for other failures. This ships independently; the later section-policy adopter only binds its guarded façade to the landed operation.

## Overview

The current edit page computes `missingCombos` in the browser and loops `createCrud('catalog/variants')`. That UI implementation is not a reusable domain capability, can begin from stale state, and cannot safely distinguish a concurrent winner from an unrelated create failure. The combination-claim prerequisite supplies the transaction-held uniqueness primitive, but deliberately does not implement generation.

## Problem Statement

A section-policy action cannot delegate to a browser loop. Generation needs one server contract that reauthorizes scope, validates a current parent version, derives combinations from the current schema and live variants, and invokes the existing create command so events, audit, indexing, custom fields, and undo remain intact. It must remain correct under two generators, manual create contention, schema changes, and retries after a partial failure.

## Goals and Non-goals

### Goals

- Publish one reusable `catalog.variants.generate_missing` operation.
- Recompute complete finite missing combinations from authoritative scoped state.
- Delegate each candidate through `catalog.variants.create` and the combination-claim prerequisite.
- Preserve deterministic ordering and the existing stop-on-first-nonduplicate-failure boundary.
- Replace the current edit-page loop with one guarded API call without changing its visible workflow.

### Non-goals

- Implementing generic or catalog section-policy wiring.
- Changing variant identity, schema barriers, unique index, or claim rules owned by the prerequisite.
- Making multi-variant generation atomic or adding aggregate undo.
- Generating variants for incomplete, free-form, multi-select, or schema-less option definitions.
- Changing manual variant create/update/delete contracts.

## Proposed Solution

Register DI service `catalogVariantGenerationService` with operation id `catalog.variants.generate_missing`. Its `generateMissing` method receives trusted tenant/organization context, an authorized product id, and the expected parent version. It loads the scoped current product/schema, enumerates complete finite combinations by stable option/choice code, reads current live variants, and processes the remaining combinations in canonical order. Before each attempt it recomputes the remaining set. It invokes a reusable guard-complete `catalog.variants.create` provider extracted from the existing CRUD route, so every candidate runs the registered `create` guards, modified-payload revalidation, command side effects, and after-success callbacks exactly as a direct create. The legacy DI bridge remains update/delete-only and therefore does not run for either direct or generated candidate creates. Only `variant_combination_exists` is recorded as a scoped skip. Any other failure stops the sequence and carries sanitized partial-progress evidence.

Expose the operation through a normal catalog route used by the existing page. The later section-policy adopter adds only its policy façade and delegates once to this same service.

## Architecture

| Area | Change |
|---|---|
| generation service | Scoped authoritative recomputation and ordered orchestration |
| guarded variant-create provider | Shared direct/generated seam for registered `create` guards, operation-accurate legacy-bridge exclusion, modified-payload validation, command execution, and callbacks |
| existing variant create command | One invocation per guarded candidate; owns claim, mutation, events, audit, index, custom fields, undo |
| catalog API route | Auth/feature/scope, aggregate route guard, parent optimistic guard, strict request/response/OpenAPI, one service call |
| product edit page | Replace the browser create loop with one guarded shared-helper request and reload |
| later section-policy adopter | Bind its policy façade to the landed service; define no generation semantics |

The service contains no ORM write path for variants. It cannot bypass the route-level generation guard, per-candidate create guards, create command, or combination-claim seam.

## Data Models

No new database entity or migration. The prerequisite owns `option_combination_key`, stable code canonicalization, schema locks, lazy null-key handling, and the partial unique index.

```ts
type GenerateMissingVariantsInput = {
  productId: string
  expectedUpdatedAt: string
}

type GenerateMissingVariantsResult = {
  complete: true
  createdIds: string[]
  skippedIds: string[]
}

type GenerateMissingVariantsProgress = {
  createdIds: string[]
  skippedIds: string[]
  failedCombinationIndex: number
}
```

Ids are returned only after the caller is authorized for the same tenant/organization/product. Combination keys and foreign row ids are not exposed.

## API Contracts

Add `POST /api/catalog/products/:productId/variants/generate-missing` with feature `catalog.variants.manage`. The request has an empty strict JSON object (maximum raw body 1 KiB); the expected product version comes from the standard optimistic-lock header. The route independently validates auth, feature, tenant/organization product scope, and the DI-aware parent guard. Because generation is a state-changing action on the existing `catalog.product/<productId>`, it runs `runRouteMutationGuards` with logical operation `custom`, which maps to registry operation `update` and includes the update/delete-only legacy bridge. It supplies resource kind `catalog.product`, resource id `productId`, and an internal strict payload containing only that authoritative id before delegating once; a modified input is strictly revalidated and reauthorized against the URL/scoped product, and every after-success callback receives the actual product id only after the service completes.

Inside the service, each candidate traverses the same guard-complete provider used by direct `catalog.variants.create`: registered guards receive resource kind `catalog.product_variant`, operation `create`, absent pre-create id, and the scoped candidate payload; the update/delete-only legacy bridge is collected by the shared machinery but intentionally does not match `create`. Modified payloads are strictly revalidated and recanonicalized; denial stops generation; after-success callbacks receive the actual created variant id. The generated path cannot call the command bus directly around this provider.

Success is HTTP 200:

```json
{ "complete": true, "createdIds": ["uuid"], "skippedIds": ["uuid"] }
```

The route preserves the standard `409 optimistic_lock_conflict`, `409 variant_combination_claim_unresolved`, the shared fixed `422` mutation-guard rejection envelope, validation/permission/not-found envelopes, and create-command failures. A nonduplicate failure after progress uses the original status/code and adds only same-scope `details.generationProgress` matching the strict progress schema. Typed duplicates are not errors and appear in `skippedIds`. Strict Zod request/params/success/error schemas and OpenAPI document these outcomes.

## UI/UX

The existing Generate missing variants button, permission behavior, loading state, success/empty/error translations, and post-operation reload remain. One click makes one route call. A complete response reloads variants and reports success. A partial failure reloads authoritative variants before presenting the localized error so retry begins from server state; it never reports full rollback.

## Frontend Architecture Contract

The existing product edit client root and variant list remain. The handler uses `useGuardedMutation(...).runMutation(...)`, `apiCallOrThrow`, and `withScopedApiRequestHeaders(buildOptimisticLockHeader(product.updatedAt), ...)`; no raw `fetch`, provider, route-root, or new production dependency is added. The old per-combination browser create loop is deleted. Focused tests assert one request/click, guarded retry wiring, reload on complete/partial outcomes, and no hydration or client-boundary regression.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| No finite option schema or no missing combination | 200 with empty arrays; no create command |
| Two generators start together | Claim boundary yields one live row per key; loser records scoped skips |
| Manual create wins a candidate | Generator records only the typed duplicate as a skip and recomputes |
| Generator wins before manual create | Manual create receives the prerequisite's stable duplicate 409 |
| Schema changes between candidates | Next recomputation uses locked current schema; unresolved/invalid state aborts |
| Candidate create fails after earlier successes | Earlier rows remain; later candidates do not run; progress is returned in sanitized error details |
| Retry after partial failure | Recompute from live rows; committed rows skip and no duplicate side effects occur |
| Stale parent version before first candidate | Standard 409; zero create command calls |
| Aggregate update/custom or candidate create guard denies | Fixed 422; no denied candidate mutation or later candidate runs; prior committed candidates remain explicit progress |
| Candidate guard modifies payload | Strictly revalidate, recanonicalize, and claim the modified candidate before create |
| Update/delete-only legacy guard is installed | Runs for the aggregate existing-product action; does not run for direct/generated candidate creates |
| Wrong scope | Scoped not-found/permission response with no product/variant existence leak |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Concurrent callers create duplicates | Critical | Every candidate delegates to the transaction-held claim plus unique index | Incomplete/non-finite variants remain outside claim by design |
| Service bypasses command side effects | High | Source invariant forbids direct variant persistence; command-call count and trace tests | New side effects added to create need fixture updates |
| Aggregate or generated candidate bypasses applicable mutation guards | Critical | Aggregate `custom`→`update` guard plus legacy bridge; shared registry-`create` provider for candidates; modified-payload revalidation, actual-id callbacks, and parity tests | Aggregate update and per-row create guards intentionally both run |
| Partial success is misreported as rollback | High | Typed progress, authoritative reload, explicit UI copy/test | Operators may still retry after an unrelated failure |
| Stale schema produces wrong combinations | High | Server recomputation by stable codes before every attempt and prerequisite schema locks | Hot schemas can make generation abort and retry |
| Response leaks foreign ids | Critical | Same-scope authorization and sanitized errors | Authorized callers receive ids they can already list |

Rollback returns the existing page to its browser loop while retaining the additive route/service for compatibility. After publication, removing the operation id, DI key, route, or response fields follows deprecation. The combination-claim prerequisite and its index remain installed.

## Migration & Backward Compatibility

No data migration. The service/route/DI key are additive. Existing manual CRUD routes, variant command ids, events, audit records, index behavior, and option payloads remain. The page's visible workflow is preserved. Each successful generated row still has one ordinary create command/action log; there is no new aggregate undo record or changed event id.

## Phasing and Implementation Plan

1. Extract a guard-complete variant-create provider shared by direct CRUD and generation; preserve registered `create` guards, the existing operation-accurate exclusion of the update/delete-only legacy bridge, modified-payload validation, command execution, actual-id callbacks, and existing responses/side effects.
2. Implement the typed generation service over that provider and the landed combination canonicalizer/claim result; prohibit direct command-bus or ORM bypass.
3. Add the strict route, auth/feature/scope checks, aggregate `custom`→`update` route guard with legacy bridge, parent optimistic guard, exact response/error schemas including 422, OpenAPI, actual product-id callback, and one-service-delegation tests.
4. Replace the product edit browser loop with one guarded request, authoritative reload on success/partial failure, and preserved localized states.
5. Add barrier tests for generator/generator and generator/manual-create in both winning orders, schema mutation, winner rollback, update-only aggregate guard plus legacy bridge, create-only candidate guard with legacy non-invocation, both layers' deny/modify/callback paths, typed duplicate, unresolved history, retry after partial failure, and exact side-effect counts.
6. Run focused catalog service/command/API/page tests, core build/typecheck, client-boundary check, `git diff --check`, and the configured validation gate.

## Integration Coverage

- Guarded create provider: direct/generated parity; registered create-only guard selection; explicit non-invocation of the update/delete-only legacy bridge; deny, modify, invalid modification, thrown guard, actual created-id callback, and callback failure; one command only after approval.
- Service: empty/finite schemas, canonical stable-code order, authoritative recomputation, one guarded create provider call per attempted candidate, duplicate-only skip, and stop-on-other-error.
- API: exact route/method/feature, strict empty body, raw-size limit, scoped product, parent version, aggregate `custom`→`update` registry and legacy-bridge lifecycle, reauthorization after modification, actual product-id callback, one delegation, OpenAPI including 422, and sanitized errors/progress.
- Concurrency: two generators and manual/generator contenders in both winning orders, schema mutation barrier, unresolved historical null row, and partial-failure retry.
- Side effects: one event/audit/index/custom-field/undo contribution for each committed create, zero duplicates, no aggregate double emission, and no later call after failure.
- Browser: one guarded request, loading/empty/success/error states, authoritative reload after complete or partial result, retry, and unchanged manual controls.

## Acceptance Criteria

1. `catalog.variants.generate_missing` is a reusable DI-resolved server operation with one documented ordinary route independent of section policy.
2. The server, not the browser, derives and recomputes missing finite combinations in stable code order.
3. Every attempted candidate traverses the shared guard-complete create provider, `catalog.variants.create`, and the landed combination-claim seam; no direct command or variant writer bypass is introduced.
4. Only the typed same-scope duplicate is skipped; every other failure stops later work and preserves explicit partial progress.
5. Two concurrent generators or a generator/manual-create pair produce at most one live row per complete combination and exactly one set of create side effects per winner.
6. The product edit button performs one guarded call and reloads authoritative state on complete or partial outcomes.
7. Existing manual variant APIs, events, audit, indexing, custom fields, undo/redo, and visible workflow remain compatible.
8. Focused and configured validation pass with recorded evidence.
9. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root security/data rules | Preserve scope, guards, and command side effects | Compliant | Route uses aggregate `custom`→`update` including the legacy bridge; every candidate uses applicable registered create guards before the command |
| root optimistic-lock rules | Protect custom actions and surface conflicts | Compliant | Parent header and DI guard reject stale generation before mutation; child claims own concurrency |
| catalog guide | Use existing command/event patterns | Compliant | The service orchestrates `catalog.variants.create` and introduces no ORM writer |
| UI/backend guide | Custom writes use guarded mutation and shared API helpers | Compliant | Existing button uses one `useGuardedMutation` request and reloads authoritative state |
| `.ai/specs/AGENTS.md` | One independently deployable capability with integration coverage | Compliant | Generation is separate from variant identity and section-policy binding |
| `BACKWARD_COMPATIBILITY.md` | New route, DI key, and operation id are stable additive contracts | Compliant | All new surfaces are named and rollback retains them |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | No new model; ids/progress reflect committed scoped create results |
| API contracts match UI/UX | Pass | One-call handler consumes exact success/error and reload requirements |
| Risks cover every write path | Pass | Direct/manual, two generators, schema races, partial retry, and scope are covered |
| Commands defined for all mutations | Pass | Every row mutation is guarded then executed by `catalog.variants.create`; generation is orchestration only |
| Frontend architecture contract is measurable | Pass | Old loop removal, one guarded request, reload, and boundary checks are explicit |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — independently deployable after the variant-combination claim prerequisite.

## Changelog

- **2026-10-27:** Split authoritative generate-missing orchestration and its ordinary page/API adoption from the catalog section-policy adopter.
