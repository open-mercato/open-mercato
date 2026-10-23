# CrudForm section overrides framework

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Related:** `.ai/specs/2026-09-30-catalog-product-form-section-policy.md`, `.ai/specs/2026-10-09-crudform-section-adoption-rollout.md`, issue #6686

## TLDR

Add a generic, additive `entry.overrides.forms.sections` contract for grouped `CrudForm` hosts. An override may add, hide, or replace a stable section only when the final server registries prove that rendering, validation, payload projection, independent actions, and persistence remain coherent. The framework is independently deployable: it ships the contract, resolver, fail-closed server manifest, request binding, and framework tests, but does not enable or inventory a domain host by itself.

Implementation crosses protected `shared`, `ui`, generator, bootstrap, and public extension surfaces. It must be performed and reviewed by Open Mercato core team members; third-party modules consume the documented contract after it ships.

## Overview

Open Mercato already has the underlying mechanisms:

- injection widgets add grouped cards and lifecycle handlers;
- `ComponentReplacementHandles.section(scope, sectionId)` identifies replaceable sections;
- unified module overrides establish precedence and `null` disablement;
- enrichers, API/command interceptors, mutation guards, and request extension headers pair UI contributions with backend behavior;
- `CrudForm.hiddenGroupIds` hides presentation only and remains unchanged.

The missing layer is a checked composition contract. A browser must never hide or replace controls while the backend continues validating or writing the removed behavior. This spec adds that layer without adding a second widget registry or changing existing form behavior.

## Problem Statement

Current extension primitives are individually valid but cannot prove a coherent section round trip:

| Operation | Existing primitive | Gap |
|---|---|---|
| Add | grouped injection widget | Placement, loading, write behavior, and backend capability are not checked together |
| Hide built-in | `hiddenGroupIds` | Presentation-only; host schema, custom-field checks, payload writes, and side effects still run |
| Replace built-in | component registry | The two-argument section handle says nothing about payload or action compatibility |
| Disable injected widget | `overrides.widgets.injection[id] = null` | Already coherent and remains the correct operation for widget UI plus handlers |

A client-only policy would introduce bootstrap skew and data-loss windows. A generic projection of an arbitrary host Zod schema is also unsafe: `.pick()` is unavailable after effects, transforms may be lost, and cross-section refinements cannot be assigned automatically. Eligible hosts therefore publish explicit runtime validators and server adapters.

## Goals and Non-goals

### Goals

- Add one canonical override domain for built-in section add/hide/replace operations.
- Keep shared facts serializable and server-safe; keep React, Zod runtime schemas, and API clients in `@open-mercato/ui` or the owning domain.
- Preserve the existing two-argument `ComponentReplacementHandles.section(scope, sectionId)` signature.
- Fail closed when UI, dependencies, mutation surfaces, or semantic backend capabilities do not match after all overrides.
- Make policy-enabled requests explicit, request-local, and safe under overlapping async mutations.
- Preserve observable no-policy behavior: the same rendered groups, validation result, payload, endpoint, lifecycle order, and mutation headers for the same inputs.

### Non-goals

- Physically adopting every form host in the framework PR.
- Repository-wide host inventory, official-module scanning, and standalone-app adopter evidence; the rollout and adopter specs own those deliverables.
- A per-record visibility language, tenant setting, or role policy engine.
- Changing `hiddenGroupIds` semantics.
- Using section hiding to disable an injected widget; widget disablement stays under `overrides.widgets.injection`.
- Inferring domain side effects or cross-field validation from arbitrary source code.

## Proposed Solution

### 1. Data-only shared contract

`packages/shared` owns only JSON-serializable identities and facts. It must not import `CrudForm`, React, Zod, or domain packages.

```ts
export type CrudFormSectionAddress = {
  hostId: string
  formVariant: string
  formOperation: 'create' | 'update'
  sectionId: string
}

export type FormSectionOverride =
  | { operation: 'add'; contributionId: string; placement?: InjectionPlacement }
  | { operation: 'hide'; contributionId: string }
  | { operation: 'replace'; contributionId: string }

export type CrudFormSectionCapabilityRequirement = {
  capabilityId: string
  protocol: 'crud-form-sections/v1'
  modes: readonly (
    | 'display-only'
    | 'read-enrichment'
    | 'omit-preserves'
    | 'merge-server-leaves'
    | 'domain-adapter'
    | 'independent-action'
  )[]
  payloadPaths?: readonly string[]
  customFieldOwnership?: CrudFormCustomFieldOwnershipFact
  mutationSurfaceIds?: readonly string[]
  allowNoopSubmit?: boolean
}

export type CrudFormCustomFieldOwnershipFact =
  | { mode: 'none' }
  | { mode: 'ids'; ids: readonly string[]; definitionSetId?: string }
  | { mode: 'all'; definitionSetId: string }

export type CrudFormSectionContributionFact = {
  id: string
  address: CrudFormSectionAddress
  operation: FormSectionOverride['operation']
  roundTripId: string
  requiredCapabilities: readonly CrudFormSectionCapabilityRequirement[]
  requiredSectionIds?: readonly string[]
  requiredDataContractIds?: readonly string[]
}

export type CrudFormSectionDependencyFact = {
  consumerContributionId: string
  requiredSectionIds: readonly string[]
  requiredDataContractIds: readonly string[]
}

export type CrudFormSectionMutationSurfaceFact = {
  id: string
  kind: 'parent-submit' | 'parent-delete' | 'section-action'
  guardedFacade: { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; routePattern: string }
  delegatedTarget: { kind: 'command' | 'service'; id: string }
  requestOperation: string
  hostResourceKind: string
  mutationResourceKind: string
  optimisticLock: 'none' | 'target-required' | 'target-optional'
}

export type CrudFormSectionCapabilityProviderFact = {
  capabilityId: string
  protocol: 'crud-form-sections/v1'
  hostId: string
  formVariant: string
  formOperation: 'create' | 'update'
  roundTripId: string
  modes: CrudFormSectionCapabilityRequirement['modes']
  payloadPaths: readonly string[]
  customFieldOwnership: CrudFormCustomFieldOwnershipFact
  mutationSurfaces: readonly CrudFormSectionMutationSurfaceFact[]
  providedDataContractIds: readonly string[]
  allowNoopSubmit: boolean
}

export type CrudFormSectionSurfaceAlternativeFact = {
  id: string
  hostId: string | null
  formVariant: string
  formOperation: 'create' | 'update'
  orderedSectionIds: readonly string[]
  callerIds: readonly string[]
  contributionIds: readonly string[]
  ownershipFacts: readonly {
    sectionId: string
    payloadPaths: readonly string[]
    customFieldOwnership: CrudFormCustomFieldOwnershipFact
  }[]
  mutationSurfaceIds: readonly string[]
  dependencies: readonly CrudFormSectionDependencyFact[]
}
```

All arrays are sorted by documented ordinal or canonical id before hashing. Absent optional arrays canonicalize to empty arrays; `mode: 'all'` requires the exact generated custom-field definition-set id; duplicate ids, duplicate payload/custom-field ownership, unknown references, and non-finite alternative combinations are generation errors. These exact serializable shapes—not an id-only lookup—are the public matcher input.

`ModuleOverrides` gains the additive optional shape:

```ts
forms?: {
  sections?: Record<string, FormSectionOverride | null>
}
```

The canonical key is `<hostId>/<formVariant>/<formOperation>/<sectionId>`. Existing precedence applies: programmatic overrides, then `modules.ts`, then contributed/base declarations. `null` disables that customization and restores the base section or omits an addition.

### 2. Explicit runtime descriptors in UI/domain code

Runtime behavior is not placed in shared facts. `@open-mercato/ui` defines the generic interfaces; each eligible host supplies concrete descriptors and schemas.

```ts
export type CrudFormSectionValidationResult<TParsed> =
  | { success: true; data: TParsed }
  | { success: false; fieldErrors: Record<string, string> }

export type CrudFormSectionValidationInput<TValues> = {
  sectionValues: Readonly<Record<string, unknown>>
  fullValues: Readonly<TValues>
}

export type CrudFormSectionRuntimeDescriptor<TValues, TParsed, TPayload> = {
  id: string
  roundTripId: string
  group: CrudFormGroup
  ownedFieldPaths: readonly string[]
  ownedCustomFieldIds?: readonly string[] | 'all'
  customFieldDefinitionSetId?: string
  validate: (
    input: CrudFormSectionValidationInput<TValues>,
  ) => CrudFormSectionValidationResult<TParsed>
  projectPayload: (parsed: TParsed, fullValues: Readonly<TValues>) => Partial<TPayload>
  mutationSurfaceIds?: readonly string[]
  requiredSectionIds?: readonly string[]
  requiredDataContractIds?: readonly string[]
  providedDataContractIds?: readonly string[]
}

export type CrudFormSectionCompositionValidator<TValues, TPayload> = (input: {
  activeSectionIds: ReadonlySet<string>
  parsedSections: ReadonlyMap<string, unknown>
  fullValues: Readonly<TValues>
  payload: Readonly<Partial<TPayload>>
}) => CrudFormSectionValidationResult<Partial<TPayload>>
```

Rules:

1. Each opted-in section owns an explicit validator. The framework never projects an arbitrary host Zod schema by field name.
2. A section validator receives only its projected input for parsing/transforms. `fullValues` is read-only context; it cannot make hidden fields active or return errors for unreachable controls.
3. Cross-section client invariants live in the host `compositionValidator`. It may report errors only against active fields. When an invariant involves hidden server-owned data, the server adapter merges the submitted active leaves with the tenant/organization-scoped locked record and runs the authoritative domain schema.
4. Payload fragments deep-merge by leaf. Duplicate leaf ownership is a generation/development error.
5. Custom-field definitions are projected before `CrudForm`'s required-field gate.

`roundTripId` is `<descriptor-id>@v<positive-integer>`. Its owner must increment it whenever renderer output, validator/transforms, payload projection, field/custom-field ownership, dependencies, provided contracts, actions, or lifecycle semantics change. The generator records a normalized source hash for each descriptor export and fails when one of those semantic inputs changes without a revision bump. Pure documentation/format changes may update the stored hash only through an explicit reviewed non-semantic fixture. Once published, retaining an old revision requires a real compatibility adapter and dual manifest facts for at least one minor release; otherwise old clients fail the handshake and must reload. Contract fixtures mutate every semantic category and prove an unchanged revision is rejected.

This preserves section-specific Zod transforms and makes full-record invariants explicit instead of pretending they can be derived mechanically.

### 3. Stable identity and component handles

The canonical form tuple is `(hostId, formVariant, formOperation)`. Policy-enabled update forms also supply `resourceId`; operation is never inferred from `initialValues.id`.

The existing component helper remains unchanged:

```ts
ComponentReplacementHandles.section(scope, sectionId)
```

The framework adds a pure `crudFormSectionScope({ hostId, formVariant, formOperation })` helper that returns a stable scope string. A policy-enabled group resolves:

```ts
ComponentReplacementHandles.section(crudFormSectionScope(address), sectionId)
```

No required parameter is added to `ComponentReplacementHandles.section`, and existing non-CrudForm section handles remain byte-for-byte unchanged.

Reusable/dynamic forms declare finite legal surface alternatives. Each alternative is one exact host-or-null, variant, operation, ordered-section list, caller list, ownership-fact list, mutation-surface list, and dependency-fact list. Independent arrays whose cross-product admits invalid combinations are forbidden. A deliberate `hostId: null` path remains compatibility-only and bypasses policy lookup.

### 4. Server capability matching and fail-closed resolution

Every hide/replace and every writable addition names a versioned semantic backend capability published by the final post-override provider registry. A display-only addition may use a declarative `section-policy` provider; that provider cannot satisfy hide, replace, read enrichment, payload, or action modes.

Capability matching compares:

- protocol, host, variant, form operation, and round-trip id;
- preservation mode and exact payload paths;
- exact custom-field ownership mode, ids, and dynamic definition-set id;
- mutation surface kind, guarded façade target, delegated provider target, request operation, resource kind, and optimistic-lock mode;
- dependency/provided-data-contract ids.
- `allowNoopSubmit`, which defaults false and may be true only for an explicitly declared parent-submit capability with zero active writable leaves and no active independent action.

Generation validates static declarations. Server bootstrap validates final enabled registries after module overrides and publishes only a wholly accepted policy in a data-only manifest plus fingerprint. A missing or incompatible capability rejects that configured policy candidate. The client never receives authority to activate an unaccepted or partial operation.

For an explicitly configured host, an unknown section, missing/incompatible capability, dependency mismatch, or invalid alternative rejects the entire policy and produces the blocking configured-host failure state. Keeping a base section or omitting an addition is used only while resolving a valid policy internally; it is never exposed as a successful partial policy.

### 5. Resolve protocol and protected request facts

The authenticated bootstrap endpoint is `POST /api/extensions/crud-form-sections/resolve` with JSON:

```ts
type ResolveCrudFormSectionsRequest = {
  hostId: string
  formVariant: string
  formOperation: 'create' | 'update'
  hostResourceKind: string
  hostResourceId?: string
  clientManifestFingerprint: string
  clientRoundTripIds: string[]
}

type ResolveCrudFormSectionsResponse =
  | {
      state: 'ready'
      fingerprint: string
      policyToken: string
      activeSectionIds: string[]
      acceptedContributionIds: string[]
    }
  | { state: 'failed'; code: 'crud_form_section_policy_invalid' }
```

The client fingerprint is canonical SHA-256 over the selected generated surface alternative plus the runtime descriptors' ordered `(id, roundTripId)` pairs. The server returns `ready` only when that fingerprint and those pairs equal its final post-override manifest. An old browser bundle therefore blocks before rendering or mutation rather than mapping current contribution ids to stale validators, renderers, or payload projection.

`policyToken` is unsigned base64url canonical JSON containing protocol `crud-form-sections/v1`, host, variant, form operation, resolver-selected host-resource kind/id, contribution/round-trip/capability ids, ordered active section ids, client/server manifest fingerprint, and issued-at schema version. It is a request assertion and coherence carrier, not proof of resolver issuance, authentication, or authorization. An authorized caller can reconstruct it. Mutation façades therefore decode it with size/schema limits and independently recompute every fact, reauthorize the asserted host/target in current tenant/organization scope, and compare route and registry state. A modified token is accepted only when all asserted facts describe a currently valid composition and the actor is independently authorized; otherwise it is rejected. The response never returns internal failure detail; the server diagnostic records host, variant, operation, contribution id, and reason without tenant data or registry dumps.

Bound mutations use these exact protected extension headers:

| Header | Value |
|---|---|
| `x-om-ext-crud-form-sections-policy` | resolver `policyToken` |
| `x-om-ext-crud-form-sections-fingerprint` | resolver fingerprint |
| `x-om-ext-crud-form-sections-mutation-surface` | exact declared mutation surface id |
| `x-om-ext-crud-form-sections-request-operation` | exact declared operation such as `create`, `update`, `delete`, or domain action |
| `x-om-ext-crud-form-sections-host-resource-kind` | resolver-selected, server-reauthorized host resource kind |
| `x-om-ext-crud-form-sections-host-resource-id` | asserted host record id; omitted only when the host itself is being created |
| `x-om-ext-crud-form-sections-mutation-resource-kind` | exact declared mutation target kind |
| `x-om-ext-crud-form-sections-mutation-resource-id` | target id; omitted for a create action |

All values are single-valued, length-bounded, and built with the shared extension-header helper. Callers may add ordinary domain headers (for example `x-sudo-token`) and the standard optimistic-lock header. The client helper rejects custom-header collisions with these eight protected names before I/O and then applies its generated values last. The server cannot infer provenance; it schema-validates every value and reauthorizes/recomputes the asserted host, route parameters, mutation target, operation, surface, and fingerprint from authenticated server state. A mismatch rejects before domain mutation. Duplicate wire headers are always malformed.

The two bindings are independent. A product-hosted offer create carries host `catalog.product/<productId>` and mutation target kind `catalog.offer` with no target id; offer update/delete carries the same host plus `catalog.offer/<offerId>`. A parent form update carries identical host and mutation-target records. Thus a nested action can never replace or omit the host record that authorized its composition.

### 6. Request-local mutation binding

Policy-enabled parent submit/delete and section-local actions use immutable bound clients built over the existing `apiCall`/CRUD helpers. Policy headers are applied directly to each request and never stored in `withScopedApiRequestHeaders`, whose module-global stack cannot isolate overlapping promises.

```ts
export type CrudFormMutationBinding = {
  mutationSurfaceId: string
  requestOperation: string
  mutationResourceKind: string
  mutationResourceId?: string
  expectedUpdatedAt?: string
}
```

- custom protected-header collisions are rejected by the client before I/O; server security relies on fact recomputation rather than claimed header provenance;
- the standard client copies the resolver-selected host assertion into each request; server security comes from independent host/target reauthorization and fact recomputation, not token provenance;
- parent update/delete defaults to the parent version;
- child update/delete requires its own `resourceKind`, `resourceId`, and `expectedUpdatedAt`, replacing the parent lock for that request;
- create rejects an accidental prior version;
- delete builds its binding after `onBeforeDelete`, never from save headers;
- the guarded façade reauthorizes the asserted host and validates policy identity, request operation, mutation-target binding, and mutation surface before delegating to the existing domain operation.

The policy token is not authentication. Every façade uses this precedence: route middleware authenticates and checks its feature first; the handler validates route identity and establishes a tenant/organization-scoped authorized host/target (using the existing non-enumerating not-found shape); only then does it validate policy facts; domain body validation, sudo/step-up checks, optimistic locking, and command execution follow in the adopter's pinned order. Compound-invalid tests prove an unauthenticated, unauthorized, out-of-scope, or missing target never receives a policy-specific 409.

### 7. Readiness and resolver behavior

`useResolvedCrudFormSections(...)` returns `pending | ready | failed`, the accepted ordered runtime descriptors, diagnostics, and a policy token or `null`.

- no configured policy: identity fast path, no subscription or readiness delay;
- configured policy pending: render `LoadingMessage`, expose no save/delete/action controls;
- ready: rendering, validation, payload construction, dependency checks, and lifecycle iterate the same descriptors;
- settled failure on an explicitly policy-enabled host: render a blocking `ErrorMessage`, expose no save/delete/action controls, and report an internal diagnostic; never restore a mutation-capable base form or render a partial policy;
- no configured policy: render the complete base form through the identity path.

Dependencies are evaluated against the final section and widget registries. A hide/replace that removes a field or data contract required by an active section/widget fails closed unless the consumer is disabled or the replacement provides the same named contract.

## Architecture

| Layer | Responsibility |
|---|---|
| `packages/shared/src/modules/overrides.ts` | Data-only `forms.sections` shape, composer, dispatcher domain |
| `packages/shared/src/modules/widgets/extension-points.ts` | Serializable host/contribution/capability/dependency facts |
| `packages/shared/src/modules/widgets/component-registry.ts` | Existing two-argument section helper plus additive scope builder export |
| `packages/ui/src/backend/CrudForm.tsx` | Optional explicit surface identity; consume resolved runtime descriptors; active custom-field gate; bound mutation contexts |
| `packages/ui/src/backend/injection/` | Resolver, readiness state, runtime descriptor interfaces, component adapter |
| `packages/ui/src/backend/utils/` | Immutable request-bound wrappers; protected-header merge |
| server bootstrap/registries | Validate final capabilities and publish accepted manifest/fingerprint |
| CLI generators | Validate authored finite alternatives, duplicate ownership, diagnostics, and stable facts |
| framework test fixture | Non-production host proving generic add/hide/replace and failure behavior |

No route-specific component or domain schema may be imported by a global provider or shared package.

## Data Models

No database schema or tenant-owned setting changes. Generated manifests contain identifiers, operation metadata, capability facts, dependencies, and content fingerprints only; they contain no React values, functions, record values, tenant data, credentials, or resource ids. Request-local resolver responses/tokens and headers do contain the authorized host resource id needed for binding. They use `Cache-Control: private, no-store`, are never persisted in generated artifacts or application caches, and are redacted from structured logs, errors, traces, and diagnostics. Only resource kind and a one-way correlation hash may be logged.

## API Contracts

Existing routes remain backward compatible. The exact resolve endpoint/request/response and eight protected headers are defined above. Policy-enabled adopters add guarded façade routes or command ids that delegate to existing domain services. A façade returns HTTP `409` `{ "error": "extension_policy_mismatch", "code": "extension_policy_mismatch" }` and performs no mutation for missing, malformed, stale, wrong-mode, wrong-operation, wrong-host, wrong-target, or undeclared-action policy identity. It does not echo tokens, fingerprints, or registry internals.

Existing auth/permission failures and `optimistic_lock_conflict` responses retain their established shapes. Legacy callers without policy headers retain current behavior on legacy endpoints.

## UI/UX

No new user-facing configuration UI or design-system primitive is added. A valid policy preserves existing group layout, ordering, collapse, keyboard, autofocus, and accessibility behavior. Unknown ids and mismatches produce developer diagnostics, not user-facing partial forms.

## Frontend Architecture Contract

- zero new page-root client boundaries or route-specific imports in global providers;
- generic resolver under 200 net LOC and `CrudForm` integration under 80 net LOC by extracting helpers;
- empty-policy identity path performs no manifest subscription or descriptor cloning beyond current normalization;
- resolver complexity is linear in base sections, contributions, and active dependencies;
- `yarn check:client-boundaries` passes;
- Strict Mode mount/unmount tests prove subscription cleanup and no duplicate lifecycle execution;
- hydration tests prove no editable base-form flash while a configured policy is pending.

## Edge Cases and Failure Scenarios

| Case | Required behavior |
|---|---|
| Unknown host/variant/operation/section | Keep base behavior; blocking diagnostic for an opted-in surface |
| Runtime groups differ from declaration | Do not activate policy; never union conditional schemas |
| Active widget depends on hidden section | Fail closed unless widget disabled or replacement supplies contract |
| All sections hidden | Disable submit unless the matched parent-submit provider and requirement both set `allowNoopSubmit: true`; any active independent action still forbids no-op readiness |
| Custom client header collides with a protected name | Client fails before I/O; server independently rejects any value that does not recompute |
| Parent and child mutations overlap | Distinct immutable clients; no header leakage |
| Child uses parent version | Binding validation rejects before I/O |
| Client/server manifest skew during resolve | Blocking `failed` before editable UI; a later deploy skew returns `409 extension_policy_mismatch`, no mutation |
| Bootstrap fails on a configured host | Blocking error, no mutation controls, no partial customization |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Shared `CrudForm` regression | High | Empty-policy identity tests and focused resolver extraction | Host-specific behavior remains outside this framework spec |
| UI/backend skew corrupts data | High | Server-approved manifest, guarded façades, mutation-blocking configured-host failure | Deploy skew can block editing until refresh |
| Runtime types leak into shared | High | Data-only shared contract and package-boundary test | New modes require deliberate fact evolution |
| Arbitrary Zod projection loses transforms/refinements | High | Explicit section validators and composition validator | Domain authors must allocate invariants correctly |
| Header leakage across async calls | High | Immutable per-request clients; no ambient policy scope | Bypass attempts reach only legacy semantics, not accepted façade |
| Public ids drift | Medium | Generated stable facts, compatibility tests, deprecation protocol | Intentional future changes need a bridge release |

Before the first public release, rollback may remove the optional resolver/manifest path. After any documented import, id, or protocol ships, operational rollback disables host eligibility and policy activation while retaining the public types, imports, and identity behavior. Removing a published contract then requires the deprecation bridge described below; rollback is not an exception to compatibility policy.

## Migration & Backward Compatibility

All additions are optional. Existing `CrudForm` props, `hiddenGroupIds`, widget spots, component handles, APIs, and override domains retain their behavior. The existing two-argument section helper is not overloaded or reordered.

Once published, host ids, variants, form operations, section ids, capability ids, mutation-surface ids, round-trip ids, and documented imports are stable contract surfaces. Any rename/removal follows `BACKWARD_COMPATIBILITY.md`: deprecated bridge, dual acceptance for at least one minor release, `UPGRADE_NOTES.md`, and a migration section in a follow-up spec.

## Phasing

1. Shared data contract and override composition.
2. Server capability registry, manifest, fingerprint, and guarded façade helpers.
3. UI runtime descriptors, resolver, readiness, explicit validation/composition, and bound clients.
4. Framework fixture, documentation, compatibility updates, and exact validation gates.

Each phase leaves the default application working. No host advertises section operations until its separate adopter spec supplies complete domain descriptors and capabilities.

## Implementation Plan

### Phase 1 — data-only contract

1. Add `forms.sections` to `ModuleOverrides`, the domain union, composer, dispatcher, tests, docs status table, and package guidance. Preserve existing precedence and `null` semantics.
2. Add serializable section address, contribution, capability, dependency, mutation-surface, and finite-surface fact types under `packages/shared`; add a package-boundary test preventing React/Zod/UI/domain imports.
3. Add `crudFormSectionScope(address)` while preserving `ComponentReplacementHandles.section(scope, sectionId)` unchanged; pin both outputs in compatibility tests.

### Phase 2 — server enforcement

4. Register post-override semantic capabilities from enrichers/interceptors/guards and declarative display-only providers. Match canonical serialized facts, not ids alone.
5. Build the accepted manifest/fingerprint at server bootstrap and implement the exact authenticated resolve endpoint, canonical token encoding/limits, blocking failure response, and safe diagnostics.
6. Add guarded façade helpers and a shared parser/builder for the eight protected headers. Validate token schema/current client/server fingerprint, reauthorized host assertion, mode, route, request operation, mutation target, mutation surface, and delegated provider after auth/ACL/scoped-target gates and before domain mutation; return the exact `extension_policy_mismatch` 409 body.

### Phase 3 — UI integration

7. Add optional `formVariant`, `formOperation`, `resourceId`, and runtime descriptor/composition-validator inputs to `CrudForm`; require explicit identity only for policy-enabled surfaces.
8. Implement the resolver/readiness state and section adapter using current injection/component registries. Preserve an allocation-light no-policy path.
9. Validate explicit section projections, then composition; project custom-field definitions before the existing gate; deep-merge payload leaves and reject collisions.
10. Add immutable bound clients to submit/delete contexts and `runSectionMutation` to group/widget contexts. Test parent update/delete, child update/delete, create, policy-header protection, and overlapping requests.

### Phase 4 — framework proof and docs

11. Add a non-production framework fixture that proves one display addition, one hide, one replacement, duplicate leaf/custom-field ownership rejection, `ids`/`all` definition-set matching, capability mismatch, and configured-host blocking failure without importing a domain module.
12. Add framework tests for add/hide/replace, display-only add, capability/dependency/custom-field mismatch, protected-token reconstruction under server reauthorization, semantic descriptor drift without a round-trip bump, no-op allow/deny, override precedence, bootstrap pending/failure, manifest mismatch, finite alternatives, ungrouped bypass, and observable no-policy equivalence.
13. Update `BACKWARD_COMPATIBILITY.md`, framework docs, package guides, and the unified-overrides status table.
14. Run `yarn workspace @open-mercato/shared test`, `yarn workspace @open-mercato/shared build`, `yarn workspace @open-mercato/ui test`, `yarn workspace @open-mercato/ui build`, `yarn generate`, `yarn check:client-boundaries`, `yarn template:sync`, `git diff --check`, and the configured validation gate. Record command, exit status, and artifact/diff evidence for every gate.

## Integration Coverage

- Resolve API/manifest: exact request/response, accepted and rejected capability/custom-field/no-op combinations, client/runtime/server fingerprint and mandatory round-trip revision skew, final-registry overrides, malformed/oversized/reconstructed token, stale fingerprint, no-store/redaction, safe diagnostic fields.
- Guarded façade: client collision rejection; server missing/duplicate/malformed/recomputed-value rejection; wrong route/operation/host/target/action; auth/ACL/scope precedence; ordinary domain plus optimistic-lock header composition; exact non-leaking 409; delegated provider invoked once.
- Browser fixture: server render → pending → ready without editable flash; add/hide/replace layout; submit/delete/action bindings; configured-host failure blocks every mutation control.
- Compatibility: no-policy payload, endpoint selection, lifecycle order, `hiddenGroupIds`, and widget-disable behavior unchanged.

## Acceptance Criteria

1. `entry.overrides.forms.sections` composes through the canonical override system.
2. Shared facts are data-only; runtime validation/render/mutation types live outside shared.
3. `ComponentReplacementHandles.section(scope, sectionId)` remains a two-argument compatible surface.
4. The framework never projects arbitrary host schemas; adopters provide explicit transformed section validators and a composition validator.
5. No UI operation activates without an exact final semantic backend capability and dependency match.
6. Policy-enabled requests use immutable request-bound clients with correct per-resource optimistic-lock binding.
7. Pending, failed, stale, and mismatched states never expose a partially active policy.
8. No-policy forms retain the same rendered groups, validation result, payload, endpoint, lifecycle order, and mutation headers for pinned fixture inputs.
9. A configured host never exposes mutation controls until its exact policy is ready; settled failure is a blocking state.
10. The named framework, integration, compatibility, client-boundary, template-parity, and configured validation commands pass with recorded evidence.

## Final Compliance Report

| Area | Status | Evidence required before implementation PR approval |
|---|---|---|
| Scope cohesion | Ready | Framework ships no domain adopter |
| Shared boundary | Ready | Data-only facts; runtime types remain UI/domain-owned |
| Backward compatibility | Ready | Additive props/domain/facts; unchanged two-argument handle |
| Security/scoping | Ready | Policy is not auth; guarded façades retain ACL and tenant/org enforcement |
| Validation correctness | Ready | Explicit per-section transforms plus composition/server full-record checks |
| Frontend architecture | Ready | No new route-root boundary; declared LOC/bundle/hydration gates |
| Testability | Ready | Each phase names focused unit/integration/browser evidence |

## Changelog

- **2026-10-22:** Extracted the independently deployable generic framework from the catalog adopter. Separated data-only shared facts from UI/domain runtime descriptors, preserved the two-argument component-handle contract, defined explicit transformed section validation and full-record invariant handling, and recorded core-team-only implementation ownership.
