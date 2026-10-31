# CrudForm section overrides framework

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Related:** `.ai/specs/2026-09-30-catalog-product-form-section-policy.md`, `.ai/specs/2026-10-09-crudform-section-adoption-rollout.md`, issue #6686

## TLDR

Add a generic, additive `entry.overrides.forms.sections` contract for grouped `CrudForm` hosts. An override may add, hide, or replace a stable section only when the final server registries prove that rendering, validation, payload projection, independent actions, and persistence remain coherent. The framework is independently deployable: it ships the contract, resolver, fail-closed server manifest, request binding, and framework tests, but does not enable or inventory a domain host by itself.

Implementation crosses protected `shared`, `ui`, generator, bootstrap, and public extension surfaces. It must be performed and reviewed by Open Mercato core team members; third-party modules consume the documented contract after it ships.

Across this coordinated spec family, `Depends on` is the only directed implementation/readiness edge and must form a DAG. `Related` is undirected discoverability metadata: it imposes no merge order, readiness gate, or cycle constraint and is excluded from dependency validation. Reciprocal `Related` links are therefore intentional and never satisfy a missing hard prerequisite.

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
- Preserve the repository mutation-guard registry on every custom policy façade, including modified payloads, legacy bridges, and post-success callbacks.
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
  resourceBindingIds?: readonly string[]
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

All arrays are sorted by documented ordinal or canonical id before hashing. Absent optional arrays, including `resourceBindingIds`, canonicalize to empty arrays; `mode: 'all'` requires the exact generated custom-field definition-set id; duplicate ids, duplicate payload/custom-field ownership, unknown references, and non-finite alternative combinations are generation errors. A resource-binding id names a versioned provider-owned fact that translates between otherwise distinct resource namespaces (for example, a host resource kind and an attachment owner entity id). Its provider validates the fact schema; the framework matches exact ids, includes the normalized binding definition in the manifest fingerprint, and rejects a semantic definition change without an id revision. These exact serializable shapes—not an id-only lookup—are the public matcher input.

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

Runtime descriptors use one additive auto-discovery convention. An owning module exports `crudFormSections` from module-root `form-sections.ts` through `defineCrudFormSections(...)`. That server-safe declaration contains host/contribution ids and serializable facts plus lazy client loaders created with `lazyCrudFormSectionRuntime(() => import('./path/to/runtime.client'))`; it must not statically import React, Zod runtime schemas, or route components. A referenced `*.client.ts`/`*.client.tsx` module exports the concrete renderer/group, validator, projector, and lifecycle descriptor.

`yarn generate` emits two views from the same enabled-module discovery snapshot:

- a server facts registry used for final capability matching, manifest generation, inventory, and diagnostics, without importing client loaders;
- a browser runtime registry that preserves the lazy loader and maps each exact `contributionId` and host base descriptor id to one enabled runtime descriptor.

Duplicate ids, a fact without a loader, a loader without matching facts, non-literal ids/imports, a disabled module still present in either registry, and server/browser id or `roundTripId` divergence are generation failures. Registration order is enabled-module topological order followed by normalized source path and contribution id; overrides apply only after that base order is built. A standalone app uses the same `apps/mercato/src/modules/<module>/form-sections.ts` convention as a package module. The public import path, export name, file convention, generated registry shapes, and loader helper are compatibility surfaces and must be added to the module-development guide and `BACKWARD_COMPATIBILITY.md`.

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
- mutation surface kind, guarded façade target, delegated provider target, request operation, resource kinds, exact versioned resource-binding ids, and optimistic-lock mode;
- dependency/provided-data-contract ids.
- `allowNoopSubmit`, which defaults false and may be true only for an explicitly declared parent-submit capability with zero active writable leaves and no active independent action.

Generation validates static declarations. Server bootstrap validates final enabled registries after module overrides and publishes only a wholly accepted policy in a data-only manifest plus fingerprint. A missing or incompatible capability rejects that configured policy candidate. The client never receives authority to activate an unaccepted or partial operation.

`forms.sections` is a client-consumed override domain. The server registers its override applier before final manifest construction, and `ClientBootstrap` dispatches the same domain with widgets/notifications before re-registering the generated runtime registry. An enabled-module entry that carries `forms.sections` may be ungated or gated only by a `NEXT_PUBLIC_*` condition; the generator rejects server-only environment gating because it would create SSR/hydration policy divergence.

Server bootstrap also serializes a data-only configured-host ledger containing only canonical `(hostId, formVariant, formOperation)` tuples and the final manifest fingerprint. The browser uses that ledger—not absence in a locally re-evaluated override map—to choose the identity fast path. A listed host must resolve and remain non-actionable while pending/failed; an unlisted host may take the no-policy path. The client recomputes the same final override/fact fingerprint, and any server/browser configured-host, contribution, or round-trip divergence blocks before rendering. SSR/hydration tests cover ungated, `NEXT_PUBLIC_*`-gated, rejected server-only-gated, disabled-module, and stale-bundle cases.

For an explicitly configured host, an unknown section, missing/incompatible capability, dependency mismatch, or invalid alternative rejects the entire policy and produces the blocking configured-host failure state. Keeping a base section or omitting an addition is used only while resolving a valid policy internally; it is never exposed as a successful partial policy.

### 5. Resolve protocol and protected request facts

The authenticated bootstrap endpoint is `POST /api/extensions/crud-form-sections/resolve`. It accepts at most 16 KiB of `application/json`; a larger body returns `413` before JSON parsing. These strict Zod schemas are normative, and all TypeScript types are derived with `z.infer`:

```ts
const symbolicIdSchema = z.string().min(1).max(160)
  .regex(/^[a-z0-9][a-z0-9._:/-]*$/)
const resourceIdSchema = z.string().min(1).max(256)
  .regex(/^[\x21-\x2b\x2d-\x7e]+$/)
const roundTripIdSchema = z.string().min(3).max(192)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/)
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)
const policyTokenSchema = z.string().min(1).max(4096)
  .regex(/^[A-Za-z0-9_-]+$/)

const resolveCrudFormSectionsRequestSchema = z.object({
  hostId: symbolicIdSchema,
  formVariant: symbolicIdSchema,
  formOperation: z.enum(['create', 'update']),
  hostResourceKind: symbolicIdSchema,
  hostResourceId: resourceIdSchema.optional(),
  clientManifestFingerprint: fingerprintSchema,
  clientRoundTripIds: z.array(roundTripIdSchema).max(128),
}).strict().superRefine(requireCreateResourceAbsenceAndUniqueCanonicalRoundTrips)

const readyResolveCrudFormSectionsResponseSchema = z.object({
  state: z.literal('ready'),
  fingerprint: fingerprintSchema,
  policyToken: policyTokenSchema,
  activeSectionIds: z.array(symbolicIdSchema).max(128),
  acceptedContributionIds: z.array(symbolicIdSchema).max(128),
}).strict().superRefine(requireUniqueCanonicalIds)

const failedResolveCrudFormSectionsResponseSchema = z.object({
  state: z.literal('failed'),
  code: z.literal('crud_form_section_policy_invalid'),
}).strict()

const resolveCrudFormSectionsResponseSchema = z.discriminatedUnion('state', [
  readyResolveCrudFormSectionsResponseSchema,
  failedResolveCrudFormSectionsResponseSchema,
])
```

`clientRoundTripIds`, `activeSectionIds`, and `acceptedContributionIds` must be unique and in canonical lexical order; duplicates or non-canonical order are invalid. Create requires `hostResourceId` absent; update requires it present. The route exports `metadata = { POST: { requireAuth: true } }`; after authentication, the selected host provider enforces its declared feature set and tenant/organization-scoped host authorization before policy resolution. It exports `openApi` with the exact schemas and statuses: `200` ready/failed union, `400` malformed/duplicate/non-canonical input, `401` unauthenticated, `403` missing provider feature, `404` unavailable or non-authorized host/resource using the provider's non-enumerating shape, and `413` oversized body. Responses set `Cache-Control: private, no-store` and `Vary: Cookie, Authorization`.

The client fingerprint is canonical SHA-256 over the selected generated surface alternative plus the runtime descriptors' ordered `(id, roundTripId)` pairs. The server returns `ready` only when that fingerprint and those pairs equal its final post-override manifest. An old browser bundle therefore blocks before rendering or mutation rather than mapping current contribution ids to stale validators, renderers, or payload projection.

`policyToken` is unsigned base64url canonical JSON containing protocol `crud-form-sections/v1`, host, variant, form operation, resolver-selected host-resource kind/id, contribution/round-trip/capability ids, ordered active section ids, client/server manifest fingerprint, and issued-at schema version. Before encoding, the resolver measures the UTF-8 canonical JSON and requires at most 3072 bytes; base64url output is therefore at most 4096 characters. An otherwise valid composition that exceeds the aggregate payload bound returns the ordinary `failed` state, records internal reason `policy_token_too_large`, and exposes no partial/truncated token. Mutation façades enforce both the 4096-character encoded limit and the same decoded 3072-byte canonical-payload limit before schema parsing/recomputation. Boundary tests cover 3072 bytes, 3073 bytes, maximum-length individual ids, and large arrays; the per-field/cardinality maxima are validation ceilings, not a promise that every maximum can coexist in one carrier.

The token is a request assertion and coherence carrier, not proof of resolver issuance, authentication, or authorization. An authorized caller can reconstruct it. Mutation façades therefore decode it with size/schema limits and independently recompute every fact, reauthorize the asserted host/target in current tenant/organization scope, and compare route and registry state. A modified token is accepted only when all asserted facts describe a currently valid composition and the actor is independently authorized; otherwise it is rejected. The response never returns internal failure detail; the server diagnostic records host, variant, operation, contribution id, and reason without tenant data or registry dumps.

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

The shared header parser applies exact limits: policy token uses `policyTokenSchema`; fingerprint uses `fingerprintSchema`; mutation-surface id and host/mutation resource kinds use `symbolicIdSchema`; request operation is a 1–64 character symbolic id; resource ids use `resourceIdSchema`. A comma-joined or multiply supplied protected header is rejected even if one member would parse. Each façade adds a strict domain Zod body/query/params schema with a documented raw-body limit, exports declarative route metadata with the existing domain feature(s), and exports OpenAPI for every success, the stable 422 mutation-guard envelope, and every established auth/scope/policy/validation/optimistic-lock/domain error status.

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

`target-required` is an end-to-end atomicity contract, not merely a façade header check. The delegated provider must compare the expected target version at the authoritative mutation seam while excluding a competing write until commit: either reload the tenant/organization-scoped target with `PESSIMISTIC_WRITE`, call `enforceCommandOptimisticLockWithGuards` against that locked row inside the same transaction, mutate, flush, and commit through the same transaction manager; or perform a version-qualified atomic update/delete and require exactly one affected row. The façade may perform an earlier check only as defense in depth. `target-optional` uses the same atomic provider seam when a token is supplied and preserves its documented headerless compatibility otherwise. Provider capability registration fails when a required target provider lacks an explicit atomic lock/CAS declaration and contender coverage.

Every policy façade is a custom write route and therefore uses the shared façade helper to enforce the repository mutation-guard contract. After auth/feature/scope/policy checks and initial route-body validation, the helper calls `getAllMutationGuardInstances()`, appends `bridgeLegacyGuard(container)` when present, and runs `runMutationGuards(...)` with the closest `create`/`update`/`delete` operation plus `{ userFeatures }`. Because registered guards can return arbitrary statuses and bodies that static `OpenApiRouteDoc.responses` cannot enumerate, a blocked guard is normalized at this new façade boundary to HTTP `422` with `{ "error": "mutation_guard_rejected", "code": "mutation_guard_rejected", "details": <registered errorBody> }`; the original guard body is preserved under `details`, while `errorStatus` is recorded only in an internal diagnostic and never changes the documented wire status. Every façade declares this bounded response, with `details: z.unknown().optional()`, in OpenAPI. A `modifiedPayload` is merged into the validated projected payload, then rechecked by the route Zod schema, the policy's authorized leaf/resource contract, and the complete domain validator; a guard cannot smuggle an inactive or undeclared leaf into the mutation.

After one successful delegated mutation, every returned `afterSuccessCallbacks` item runs once. The helper accepts a required `resolveCommittedResourceId(result)` extractor for `create`; it must return the persisted non-empty resource id from the successful domain result before callbacks run. Update/delete use the already validated mutation target id. An absent/empty create id is an internal callback-contract failure: report it, skip callbacks rather than invoking them with a placeholder, and preserve the already committed success response. Callback failures are reported through the repository error-reporting/logger path but do not turn a committed write into an HTTP failure. The helper exposes no opt-out, and adapters test blocking plus the stable 422 envelope, payload modification, legacy bridging, callback ordering/failure, and the actual created id received by every create callback.

The policy token is not authentication. Every façade uses this precedence: route middleware authenticates and checks its feature first; the handler validates route identity and establishes a tenant/organization-scoped authorized host/target (using the existing non-enumerating not-found shape); only then does it validate policy facts; initial body validation, mutation guards plus modified-payload revalidation, sudo/step-up checks, optimistic locking, and command execution follow in the adopter's pinned order. Compound-invalid tests prove an unauthenticated, unauthorized, out-of-scope, or missing target never receives a policy-specific 409.

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
| module-root `form-sections.ts` + `*.client.tsx` | Auto-discovered server-safe facts/lazy loaders and concrete browser runtime descriptors |
| `packages/ui/src/backend/CrudForm.tsx` | Optional explicit surface identity; consume resolved runtime descriptors; active custom-field gate; bound mutation contexts |
| `packages/ui/src/backend/injection/` | Resolver, readiness state, runtime descriptor interfaces, component adapter |
| `packages/ui/src/backend/utils/` | Immutable request-bound wrappers; protected-header merge |
| server/client bootstrap and generated registries | Dispatch `forms.sections` in both runtimes; validate facts/loaders; publish configured-host ledger plus accepted manifest/fingerprint |
| server policy-façade helper | Enforce auth-adjacent policy/resource facts and the mandatory mutation-guard/legacy-bridge/callback contract |
| CLI generators | Validate authored finite alternatives, duplicate ownership, diagnostics, and stable facts |
| framework test fixture | Non-production host proving generic add/hide/replace and failure behavior |

No route-specific component or domain schema may be imported by a global provider or shared package.

## Data Models

No database schema or tenant-owned setting changes. Generated manifests contain identifiers, operation metadata, capability facts, dependencies, and content fingerprints only; they contain no React values, functions, record values, tenant data, credentials, or resource ids. Request-local resolver responses/tokens and headers do contain the authorized host resource id needed for binding. They use `Cache-Control: private, no-store`, are never persisted in generated artifacts or application caches, and are redacted from structured logs, errors, traces, and diagnostics. Only resource kind and a one-way correlation hash may be logged.

## API Contracts

Existing routes remain backward compatible. The exact resolve endpoint/request/response and eight protected headers are defined above. Policy-enabled adopters add guarded façade routes or command ids that delegate to existing domain services. A façade returns HTTP `409` `{ "error": "extension_policy_mismatch", "code": "extension_policy_mismatch" }` and performs no mutation for missing, malformed, stale, wrong-mode, wrong-operation, wrong-host, wrong-target, or undeclared-action policy identity. It does not echo tokens, fingerprints, or registry internals.

Existing auth/permission failures and `optimistic_lock_conflict` responses retain their established shapes. Legacy callers without policy headers retain current behavior on legacy endpoints.

Every new policy façade exports route `metadata` and `openApi`, declares its exact auth/features/body/header/status schemas, and uses the mandatory mutation-guard helper above. No façade delegates directly after policy validation.

## UI/UX

No new user-facing configuration UI or design-system primitive is added. A valid policy preserves existing group layout, ordering, collapse, keyboard, autofocus, and accessibility behavior. Unknown ids and mismatches produce developer diagnostics, not user-facing partial forms.

## Frontend Architecture Contract

| Route/surface | Server root | Client island owner | Data/request owner |
|---|---|---|---|
| existing backend routes rendering `CrudForm` | unchanged server root | existing `CrudForm` client boundary | route loader remains data owner; resolver owns only configured-host policy bootstrap |
| configured form host | unchanged | lazy module-owned `*.client.tsx` descriptors | one bounded resolver request; immutable bound clients own mutations |
| no-policy form host | unchanged | existing form island | existing calls only; zero resolver request |

- client-boundary ledger: `CrudForm.tsx` remains client because it owns form state/interactions; resolver/hooks are client-only for subscriptions and browser mutation binding; module `*.client.tsx` leaves are lazy because they contain renderers/Zod runtime values; `form-sections.ts`, manifests, and policy facts remain server-safe and never gain `"use client"`;
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
| Runtime contribution has no discoverable loader/fact pair | Generation fails; it cannot reach a manifest or browser registry |
| `forms.sections` entry uses a server-only environment gate | Generation fails before SSR/browser output can diverge |
| Server configured-host ledger and browser registry differ | Block before rendering; never take the identity fast path for a server-configured host |
| Active widget depends on hidden section | Fail closed unless widget disabled or replacement supplies contract |
| All sections hidden | Disable submit unless the matched parent-submit provider and requirement both set `allowNoopSubmit: true`; any active independent action still forbids no-op readiness |
| Custom client header collides with a protected name | Client fails before I/O; server independently rejects any value that does not recompute |
| Parent and child mutations overlap | Distinct immutable clients; no header leakage |
| Child uses parent version | Binding validation rejects before I/O |
| Two target-required updates race | Provider-held lock or version-qualified CAS permits one matching write; the loser receives the standard optimistic conflict before mutation |
| Target-required update races delete | The provider serializes or CAS-checks both; no request succeeds from a pre-lock snapshot and record-gone preserves the standard conflict contract |
| Mutation guard blocks or rewrites payload | Return the stable HTTP 422 `mutation_guard_rejected` envelope with the registered body under `details`, or revalidate the rewritten active payload before delegation; hidden/undeclared leaves fail closed |
| Post-success guard callback fails | Report/log once; preserve the already-committed success response |
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
2. Add the module-root `form-sections.ts` convention, `defineCrudFormSections`/lazy-runtime helpers, paired server-facts and browser-runtime generated registries, exact contribution lookup, deterministic ordering, disabled-module filtering, and fact/loader parity diagnostics.
3. Add serializable section address, contribution, capability, dependency, mutation-surface, and finite-surface fact types under `packages/shared`; add a package-boundary test preventing React/Zod/UI/domain imports.
4. Add `crudFormSectionScope(address)` while preserving `ComponentReplacementHandles.section(scope, sectionId)` unchanged; pin both outputs in compatibility tests.

### Phase 2 — server enforcement

5. Register post-override semantic capabilities from enrichers/interceptors/guards and declarative display-only providers. Match canonical serialized facts, not ids alone.
6. Dispatch `forms.sections` in server and client bootstrap, reject server-only-gated entries, and publish the configured-host ledger. Build the accepted manifest/fingerprint at server bootstrap and implement the exact authenticated resolve endpoint, strict Zod/body/cardinality/uniqueness bounds, metadata/provider features, OpenAPI/status map, canonical token encoding/limits, blocking failure response, and safe diagnostics.
7. Add guarded façade helpers and a shared parser/builder for the eight protected headers. Validate token schema/current client/server fingerprint, reauthorized host assertion, mode, route, request operation, mutation target, mutation surface, exact resource-binding ids, and delegated provider after auth/ACL/scoped-target gates and before domain mutation; reject `target-required` providers without an atomic lock/CAS declaration; then collect/run mutation guards plus the legacy bridge, revalidate modified payloads against the policy/domain contracts, and run post-success callbacks through error reporting. Return the exact `extension_policy_mismatch` 409 body for policy mismatches.

### Phase 3 — UI integration

8. Add optional `formVariant`, `formOperation`, `resourceId`, and runtime descriptor/composition-validator inputs to `CrudForm`; require explicit identity only for policy-enabled surfaces.
9. Implement the resolver/readiness state and section adapter using the generated runtime registry plus current injection/component registries. Consult the server ledger before the identity path.
10. Validate explicit section projections, then composition; project custom-field definitions before the existing gate; deep-merge payload leaves and reject collisions.
11. Add immutable bound clients to submit/delete contexts and `runSectionMutation` to group/widget contexts. Test parent update/delete, child update/delete, create, policy-header protection, and overlapping requests.

### Phase 4 — framework proof and docs

12. Add a non-production framework fixture that proves one display addition, one hide, one replacement, duplicate leaf/custom-field ownership rejection, `ids`/`all` definition-set matching, capability mismatch, and configured-host blocking failure without importing a domain module.
13. Add framework tests for discovery/loader parity, server/client dispatch and gating, add/hide/replace, display-only add, capability/dependency/custom-field mismatch, protected-token reconstruction under server reauthorization, semantic descriptor drift without a round-trip bump, no-op allow/deny, override precedence, bootstrap pending/failure, manifest mismatch, finite alternatives, ungrouped bypass, and observable no-policy equivalence.
14. Update `BACKWARD_COMPATIBILITY.md`, module-development/framework docs, package guides, and the unified-overrides status table with the new auto-discovery and generated-registry contracts.
15. Run `yarn workspace @open-mercato/shared test`, `yarn workspace @open-mercato/shared build`, `yarn workspace @open-mercato/ui test`, `yarn workspace @open-mercato/ui build`, `yarn generate`, `yarn check:client-boundaries`, `yarn template:sync`, `git diff --check`, and the configured validation gate. Record command, exit status, and artifact/diff evidence for every gate.

## Integration Coverage

- Discovery/bootstrap: package/app `form-sections.ts`, lazy runtime load, exact contribution lookup, deterministic order, disabled modules, server/browser parity, ungated/public-gated success, server-only-gated rejection, configured-host ledger, and stale-bundle blocking.
- Resolve API/manifest: exact request/response, accepted and rejected capability/custom-field/no-op combinations, client/runtime/server fingerprint and mandatory round-trip revision skew, final-registry overrides, malformed/oversized/reconstructed token, exact 3072-byte decoded / 4096-character encoded boundaries and aggregate-overflow failed state, stale fingerprint, no-store/redaction, safe diagnostic fields.
- Guarded façade: client collision rejection; comma-containing resource-id rejection; server missing/duplicate/malformed/recomputed-value rejection; wrong route/operation/host/target/action; auth/ACL/scope precedence; mutation-guard block/modify/legacy bridge/after-success/callback-failure behavior; modified hidden-leaf rejection; ordinary domain plus optimistic-lock header composition; `target-required` provider-declaration rejection and update/update plus update/delete contenders; exact non-leaking 409; delegated provider invoked once.
- Browser fixture: server render → pending → ready without editable flash; add/hide/replace layout; submit/delete/action bindings; configured-host failure blocks every mutation control.
- Compatibility: no-policy payload, endpoint selection, lifecycle order, `hiddenGroupIds`, and widget-disable behavior unchanged.

## Acceptance Criteria

1. `entry.overrides.forms.sections` composes through the canonical override system.
2. Shared facts are data-only; runtime validation/render/mutation types live outside shared.
3. Every runtime contribution is discoverable through the paired server/browser registries, and client/server override dispatch plus gating cannot diverge silently.
4. `ComponentReplacementHandles.section(scope, sectionId)` remains a two-argument compatible surface.
5. The framework never projects arbitrary host schemas; adopters provide explicit transformed section validators and a composition validator.
6. No UI operation activates without an exact final semantic backend capability and dependency match.
7. Policy-enabled requests use immutable request-bound clients with correct per-resource optimistic-lock binding, and every `target-required` delegated provider performs the compare/write atomically at its authoritative mutation seam.
8. Every custom policy façade preserves mutation guards, legacy bridging, safe payload modification, and post-success callbacks without allowing inactive-leaf writes.
9. Pending, failed, stale, and mismatched states never expose a partially active policy.
10. No-policy forms retain the same rendered groups, validation result, payload, endpoint, lifecycle order, and mutation headers for pinned fixture inputs.
11. A configured host never exposes mutation controls until its exact policy is ready; settled failure is a blocking state.
12. Canonical token payloads above 3072 bytes fail closed without truncation; accepted tokens never exceed 4096 base64url characters.
13. The named framework, integration, compatibility, client-boundary, template-parity, and configured validation commands pass with recorded evidence.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/docs/module-development.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root module rules | Use auto-discovery, keep shared facts isomorphic, and avoid domain coupling | Compliant | `form-sections.ts` produces paired server facts/browser loaders; shared shapes contain no React/Zod/domain imports |
| UI guides | `CrudForm` owns form behavior; writes use shared API helpers, guarded mutations, conflict and loading/error states | Compliant | Runtime descriptors integrate at `CrudForm`; immutable bound clients and blocking states are normative |
| root security rules | Policy cannot replace auth, feature, scope, mutation guards, sudo, or optimistic locking | Compliant | Exact gate order, reauthorization, strict headers, mandatory guard bridge, and per-resource locks are specified |
| `packages/core/AGENTS.md` → API Routes | New API routes export metadata/OpenAPI and validated schemas | Compliant | Resolver and façade contracts pin strict schemas, body/header bounds, feature metadata, and status maps |
| `.ai/specs/AGENTS.md` | One deployable framework capability with API/UI coverage | Compliant | No domain adopter ships here; fixture/API/browser/compatibility tests are explicit |
| `BACKWARD_COMPATIBILITY.md` | Preserve public helpers and version auto-discovery, ids, routes, and generated registries | Compliant | Existing two-argument section helper remains; every new surface is additive/versioned and documented |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data facts match runtime descriptors | Pass | Paired generation and fingerprint/round-trip checks fail on divergence |
| API contracts match UI readiness | Pass | Resolver pending/ready/failed states control all rendered mutation affordances |
| Risks cover all write paths | Pass | Parent, child, create, update, delete, modified-payload, and callback failures are covered |
| Commands/providers defined for mutations | Pass | Every surface names its façade and delegated command/service; framework itself performs no domain write |
| SSR/browser behavior is consistent | Pass | Shared dispatch, public-only gating, configured-host ledger, and stale-bundle blocking are pinned |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation.

## Changelog

- **2026-10-27:** Made `target-required` an atomic delegated-provider lock/CAS contract with contender coverage, excluded commas from wire resource ids, and completed the route/client-boundary ownership map.
- **2026-10-27:** Added versioned provider-owned resource-binding ids, the `form-sections.ts` lazy runtime discovery contract, server/browser override-dispatch parity and configured-host ledger, exact resolver/header validation and OpenAPI bounds, and mandatory mutation-guard/legacy-bridge/callback behavior for every policy façade.
- **2026-10-22:** Extracted the independently deployable generic framework from the catalog adopter. Separated data-only shared facts from UI/domain runtime descriptors, preserved the two-argument component-handle contract, defined explicit transformed section validation and full-record invariant handling, and recorded core-team-only implementation ownership.
