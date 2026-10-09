# CrudForm section overrides — generic add, hide, and replace contract

## 📝 TLDR

Open Mercato already has most of this capability in separate UMES primitives: injection widgets can add grouped cards, `hiddenGroupIds` can hide a card for presentation, component handles can replace a section component, response enrichers can load extension data, and widget lifecycle handlers plus API/command interceptors can save it. What is missing is one contract that resolves those pieces together and refuses to apply a visual change when its validation and persistence behavior is unresolved.

This specification adds a generic, server-resolved `CrudForm` section contract for every bound form surface. An app can add, hide, or replace a section through `entry.overrides.forms.sections`; the UI and submit pipeline consume the same resolved descriptor list, and each operation is activated only when its semantic post-override backend capabilities are present. The catalog product edit form is the first high-risk adopter and the proof that hidden values, custom fields, metadata subkeys, secondary writes, optimistic locking, widget dependencies, and configured-app browser behavior remain coherent.

The original FR remains [#6686](https://github.com/open-mercato/open-mercato/issues/6686). The design is generalized because a catalog-only policy would duplicate UMES and leave every other `CrudForm` with the same unsafe gap.

## 📝 Overview

The capability has four layers:

1. **Existing UMES contributions remain the implementation units.** Injection widgets render added/replacement sections and reuse `WidgetInjectionEventHandlers`; response enrichers load data; API/command interceptors or mutation guards own backend validation and persistence changes; `InjectionPlacement` orders contributions; `ComponentReplacementHandles.section` renders replacements.
2. **A generic resolver composes them.** `useResolvedCrudFormSections({ hostId, formVariant, formOperation, resourceId, baseSections })` returns `pending | ready | failed` plus one ordered descriptor list. Rendering, local validation, payload projection, dependency checks, and host-owned writes all iterate that same list.
3. **The server authorizes the composition.** Section contributions declare versioned semantic backend capabilities and a `roundTripId`. The final post-override registries are checked at generation and server bootstrap. Only accepted operations reach the client manifest; unresolved operations fail closed.
4. **Hosts describe semantics, not transport.** A host owns its base section descriptors and any domain-specific payload/side-effect adapters. The framework supplies the resolver, validation projection, placement, component replacement, extension-header handshake, and the standard CRUD request-projection interceptor.

When no override is configured, current rendering and submission are preserved. The existing `hiddenGroupIds` prop remains presentation-only and backward compatible; it is not silently redefined.

## 📝 Problem Statement

### Current capability is fragmented

| Need | What exists now | Missing piece |
|---|---|---|
| Add a section | `ModuleInjectionTable` with `kind: 'group'`; `CrudForm` renders injection group cards | Relative placement among built-ins and a required backend round trip are not one checked contract |
| Hide a built-in section | Host-only `hiddenGroupIds` | It does not bypass the host Zod schema, custom-field definition validation, payload construction, or host side effects |
| Disable an injected section | `overrides.widgets.injection[id] = null` | This is already coherent and remains the correct mechanism for an existing widget |
| Replace a section | `ComponentReplacementHandles.section(scope, sectionId)` and `useRegisteredComponent` | Built-in `CrudForm` groups do not resolve the handle, and component replacement alone says nothing about save behavior |
| Load/save extension data | Response enrichers, field/group widgets, widget lifecycle handlers, API/command interceptors, mutation guards | Nothing proves that the UI contribution and backend contribution are both active after overrides |

Creating a second client-only section registry would duplicate the override store, bootstrap, placement, and component-replacement systems. More importantly, it would let a browser hide or replace controls while the server continued validating and saving the original contract.

### Catalog demonstrates the failure modes

`packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx` has ten built-in groups and a custom submit pipeline. Visual hiding alone is unsafe:

- `productFormSchema.safeParse(...)` validates the whole record. A stored `minOrderQty=100000001` is accepted by the current server update schema but rejected by the client form schema, so restoring it and parsing the whole form blocks on an invisible field.
- `CrudForm` validates every fetched custom-field definition before the page `onSubmit`. Hiding `custom-fields` does not bypass a required empty custom field.
- `buildComplianceProductPayload` always emits 26 compliance/SEO keys and converts blanks to `null`; a hidden compliance card would clear stored data.
- `buildMetadataPayload` combines user metadata with the details-owned `metadata.__useMarkdown` reserved key. Treating `metadata` as one section-owned blob loses the Markdown toggle or overwrites hidden metadata.
- UoM save logic creates, updates, and deletes product-unit-conversion records after the main product update.
- Categorization deletes deselected offers before the product update and builds offer payloads from both categorization and details values.

The general contract must handle whole-form validation, custom-field validation, nested payload ownership, and secondary writes—not merely card visibility.

## 📝 Goals and Non-goals

### Goals

- One additive contract for adding, hiding, and replacing sections on any bound grouped `CrudForm`.
- Reuse UMES widgets, component handles, placement, lifecycle handlers, enrichers, interceptors, guards, facts, and extension headers.
- Make UI activation contingent on an exact, semantic backend capability after all overrides are composed.
- Give every production invocation generated adoption status; policy-enabled grouped forms additionally require a resolved finite host, exact topology variant, explicit operation, and stable resource identity.
- Keep no-override business behavior equivalent; only additive manifest/round-trip metadata may differ.
- Make catalog product edit the first complete adopter, including its custom save pipeline.

### Non-goals

- A per-record visibility-expression language, tenant setting, or role rules engine.
- Changing the presentation-only semantics of `hiddenGroupIds`.
- Treating CSS, translated titles, or DOM selectors as extension keys.
- Replacing `overrides.widgets.injection` for disabling an injected widget.
- Automatically inferring arbitrary host side effects from source code. Complex hosts declare them explicitly.

## 📝 Proposed Solution

### 1. Canonical section identity and override shape

Every eligible form reuses `CrudForm`'s existing `resolvedInjectionSpotId` precedence: explicit `injectionSpotId`, otherwise the first normalized `entityId`/`entityIds` value. It also has a stable topology variant, explicit form mode, stable resource identity for updates, and stable section ids. The canonical surface tuple is `(hostId, formVariant, formOperation)` and the canonical override key is `<hostId>/<formVariant>/<formOperation>/<sectionId>`.

`formVariant` names the section topology; `formOperation: 'create' | 'update'` names the mutation semantics. They are deliberately separate: two forms can render the same sections but need different backend preservation rules, and a variant called `edit` cannot repair an incorrectly inferred create operation. A grouped invocation may use `default` only when its resolved host/operation has one authoritative base-section schema. Forms that opt into section policy pass `formOperation` explicitly; update forms also pass `resourceId`. Existing forms outside this policy retain the current `values.id`/version-history inference as a backward-compatible fallback. Generation rejects an opted-in update surface without a resource id and never guesses operation from a route, variant name, or transient form value. The existing injection spot remains unchanged for widget compatibility.

Static JSX presence is insufficient for dynamic forms. Each reusable invocation publishes finite `surfaceAlternatives`, including an explicit `null` host alternative when an unhosted compatibility path is intentional. Each entry is one legal host/variant/operation combination with its exact ordered section ids and ownership/action/dependency facts; independent host and variant arrays are forbidden because their cross-product would admit invalid surfaces. A stable resolver returns one declared entry id; generation verifies every statically discoverable caller, and runtime asserts that the host, variant, operation, and rendered groups exactly match that single entry. Unknown combinations, callers, or group shapes fail closed. Conditional groups are never unioned into one synthetic schema because that would make hide/replace ownership unsafe. A `null` host entry retains today's complete form behavior and bypasses manifest lookup and section-readiness gating.

```ts
export type CrudFormSurfaceDeclaration = {
  surfaceAlternatives: readonly {
    id: string
    hostId: string | null
    formVariant: string
    formOperation: 'create' | 'update'
    orderedSectionIds: readonly string[]
    ownershipFactIds: readonly string[]
    mutationSurfaceIds: readonly string[]
    dependencyFactIds: readonly string[]
    callerIds: readonly string[]
  }[]
}
```

```ts
export interface FormsOverridesShape {
  sections?: Record<string, FormSectionOverride | null>
}

export type FormSectionOverride =
  | {
      operation: 'hide'
      contributionId: string
    }
  | {
      operation: 'replace'
      contributionId: string
    }
  | {
      operation: 'add'
      contributionId: string
      placement?: InjectionPlacement
    }
```

Composition follows the existing override contract:

- every active operation names a registered contribution, including headless `hide` contributions;
- `operation` is explicit, so a stale replacement target cannot silently become an addition;
- `null` disables the customization at that key and restores the base section (or omits a proposed addition), preserving the unified override convention;
- programmatic overrides win over `modules.ts`, which wins over file contributions/base;
- stale keys and competing replacements produce existing override diagnostics.

The implementation uses the existing `OverrideStore`, `applyStoreOverrides`, `composeStore`, and array-override helpers. It does not copy the `nav` state shape or add a one-off subscription store.

### 2. One resolved descriptor list

```ts
export type CrudFormSectionResolution<TValues, TPayload> = {
  status: 'pending' | 'ready' | 'failed'
  sections: readonly CrudFormSectionDescriptor<TValues, TPayload>[]
  policyToken: string | null
  diagnostics: readonly FormSectionDiagnostic[]
}

export type CrudFormSectionAddress = {
  hostId: string
  formVariant: string
  formOperation: 'create' | 'update'
  sectionId: string
}

export type CrudFormSectionDescriptor<TValues, TPayload> = {
  id: string
  group: CrudFormGroup
  ownedFieldIds: readonly string[]
  ownedCustomFieldIds?: readonly string[] | 'all'
  placement?: InjectionPlacement
  componentHandle: string
  validation?: CrudFormSectionValidation<TValues>
  payload?: CrudFormSectionPayload<TValues, TPayload>
  mutationSurfaces?: readonly CrudFormSectionMutationSurface[]
  dependencies?: CrudFormSectionDependencies
  providesDataContracts?: readonly string[]
  lifecycle?: Pick<
    WidgetInjectionEventHandlers<CrudFormSectionContext<TValues>, TValues>,
    'onBeforeSave' | 'onSave' | 'onAfterSave'
  >
}

export type CrudFormSectionContribution<TValues, TPayload> = {
  id: string
  hostId: string
  formVariant: string
  formOperation: 'create' | 'update'
  sectionId: string
  operation: 'add' | 'hide' | 'replace'
  descriptor?: CrudFormSectionDescriptor<TValues, TPayload>
  requires: CrudFormSectionBackendRequirements
}

export type CrudFormSectionMutationSurface = {
  id: string
  kind: 'api' | 'command'
  policyFacadeTarget: string
  delegatedProviderTarget: string
  operations: readonly {
    requestOperation: string
    optimisticLock: 'entity-version' | 'not-applicable'
  }[]
}

export type CrudFormMutationBinding = {
  mutationSurfaceId: string
  requestOperation: string
  resourceId?: string
  expectedUpdatedAt?: string
}

export interface CrudFormMutationClient {
  apiCall: typeof apiCall
  apiCallOrThrow: typeof apiCallOrThrow
  readApiResultOrThrow: typeof readApiResultOrThrow
  createCrud: typeof createCrud
  updateCrud: typeof updateCrud
  deleteCrud: typeof deleteCrud
  forMutation: (binding: CrudFormMutationBinding) => CrudFormMutationClient
}

export type CrudFormSectionMutationRunner = <TResult>(
  input: CrudFormMutationBinding,
  mutation: (client: CrudFormMutationClient) => Promise<TResult>,
) => Promise<TResult>

export type CrudFormSectionDependencies = {
  readsFieldPaths?: readonly string[]
  requiresSectionIds?: readonly string[]
  requiresDataContracts?: readonly string[]
}
```

`useResolvedCrudFormSections({ hostId, formVariant, formOperation, resourceId, baseSections })` returns the only section list a host surface may consume. `CrudForm` renders `descriptor.group`; validation iterates descriptor validation; payload projection merges descriptor contributions; host-owned before/after writes use the existing widget lifecycle dispatcher. Contributed UI uses the existing injection widget definition, and the group component resolves an operation-qualified `ComponentReplacementHandles.section(hostId, formVariant, formOperation, sectionId)` through `useRegisteredComponent` while retaining the existing unqualified handle as a compatibility fallback for forms not opted into policy.

Simple forms derive `ownedFieldIds` from `CrudFormGroup.fields` and use the standard CRUD payload projector. Custom-component groups or hosts with derived payloads/secondary writes provide explicit descriptors. This keeps easy forms easy without pretending that catalog/sales/workflow side effects are inferable.

`mutationSurfaces` is data-only metadata for actions initiated inside a section but outside the parent form submit, such as an option-schema dialog or variant create/delete button. Those actions keep their existing components and guarded CRUD helpers; the descriptor makes their exact entity/route/command operations and optimistic-lock expectations visible to generation, capability matching, replacement compatibility, and tests. Hiding a section removes its action controls but is not an authorization revocation for the underlying endpoint.

`formOperation` is the stable form mode (`create` or `update`); `requestOperation` is the individual mutation (`create`, `update`, `delete`, or a declared domain action). `CrudForm` additively exposes `runSectionMutation` through both built-in `CrudFormGroupComponentProps` and contributed widget context. A group/button calls it with the declared surface id, request operation, target resource id, and expected child version around its existing guarded mutation. The callback receives an immutable `CrudFormMutationClient`: thin bound versions of the existing API/CRUD helpers that merge the operation/resource policy header directly into each request's `init.headers`. The runner verifies the surface is active before creating that client. It does **not** hold `withScopedApiRequestHeaders` open across an async callback; the current module-global stack cannot isolate overlapping promises.

Parent submit uses the same request-local design. `CrudFormSubmitContext` additively exposes a client bound to request operation `create` or `update` after `onBeforeSave` has contributed its headers. A policy-enabled standard projector or domain adapter must perform every policy-covered request through that client; generator/test coverage rejects an adapter that calls unbound helpers. Domain adapters call `requestClient.forMutation(...)` for declared secondary child writes. Policy-enabled mutations target additive policy-bound façade route/command ids whose guards require and validate the token before delegating to the existing domain service. Existing non-policy forms, shared endpoints, and the legacy scoped-header API remain backward compatible, but cannot masquerade as enforcement points for an absent token. Section-policy tokens never enter the ambient stack. Parent submit and independent actions share one header builder/server parser without cross-form state.

Delete is explicit, not inferred from the edit surface. A policy-enabled update form with `onDelete` declares the parent `delete` request operation in its host/backend capability. `CrudForm` runs the existing `onBeforeDelete` lifecycle first, then creates `CrudFormDeleteContext.requestClient` from those delete-specific headers, the same `formOperation: 'update'`, `requestOperation: 'delete'`, the deleted resource id, and its expected version. It never reuses `onBeforeSave` headers. If delete is not declared compatible, the delete action is unavailable under that policy; the server never accepts an update request action on a DELETE call.

Header merging has two explicit classes. Section-policy/round-trip headers are protected, always applied last, and cannot be supplied or overridden through request init; an attempt fails locally before any request. The optimistic-lock header is resource-specific: the parent version is the default only for the parent mutation, while `expectedUpdatedAt` on `forMutation`/`runSectionMutation` replaces it for that child request. An `entity-version` update/delete request operation requires both `resourceId` and `expectedUpdatedAt`; create requires no prior version and rejects an accidental expected version. Ordinary non-protected request headers continue to merge normally.

`dependencies` makes cross-section and injection-widget reads explicit. The resolver evaluates the final section list and final widget registry together. A hide/replace fails closed when an active section or widget still requires a removed field, section, or named data contract, unless the same policy disables that widget through `overrides.widgets.injection` or the replacement declares the compatible provided contract. Existing widget `requiredFields` facts are projected into this graph rather than re-declared.

### 3. Add and replace reuse UMES

- **Add:** a registered injection widget with `kind: 'group'` supplies UI and lifecycle behavior. `InjectionWidgetPlacement` gains the existing additive `InjectionPlacement` fields (`position`, `relativeTo`), and merging calls `insertByInjectionPlacement`.
- **Replace:** the replacement contribution targets the same canonical section key and renders through `ComponentReplacementHandles.section`. The original descriptor remains the error-boundary fallback only when the replacement's backend contract is also compatible; otherwise resolution retains the base section before render.
- **Disable an injected widget:** continue using `overrides.widgets.injection[widgetId] = null`, which already removes the component and handlers together.

No new render-widget or lifecycle system is introduced.

### 4. Backend pairing is mandatory and fail-closed

Every operation contribution declares semantic requirements. Even a visual-only `hide` is represented by a headless contribution so the override must name an actual server-registered capability that makes the operation safe:

```ts
export type CrudFormSectionBackendRequirements = {
  roundTripId: string
  capabilities: readonly FormSectionBackendCapabilityRequirement[]
}

export type FormSectionBackendCapabilityRequirement = {
  capabilityId: string
  protocol: 'crud-form-sections/v1'
  modes: readonly (
    | 'read-enrichment'
    | 'omit-preserves'
    | 'merge-server-leaves'
    | 'domain-adapter'
    | 'independent-action'
    | 'display-only'
  )[]
  payloadPaths?: readonly string[]
  mutationSurfaces?: readonly CrudFormSectionMutationSurface[]
}

export type RegisteredFormSectionBackendCapability =
  FormSectionBackendCapabilityRequirement & {
    hostId: string
    formVariant: string
    formOperation: 'create' | 'update'
    roundTripId: string
    policyFacade?:
      | { kind: 'api'; route: string; methods: readonly string[] }
      | { kind: 'command'; targetCommand: string }
    provider:
      | { kind: 'section-policy'; id: string; mode: 'display-only' }
      | { kind: 'response-enricher'; id: string; targetEntity: string }
      | { kind: 'api-interceptor'; id: string; route: string; methods: readonly string[] }
      | { kind: 'command-interceptor'; id: string; targetCommand: string }
      | { kind: 'mutation-guard'; id: string; entityId: string; operations: readonly string[] }
  }
```

Rules:

1. **A server-published capability is mandatory for every hide and replace.** A response enricher alone cannot prove validation/save coherence. Payload-owning sections require `omit-preserves`, `merge-server-leaves`, or `domain-adapter`; action-only/display-only sections still require an interceptor/guard capability that acknowledges the exact surface and operation, but do not invent a payload rewrite. Standard `makeCrudRoute` forms may use one shared projection interceptor; complex hosts use a domain interceptor/guard. There is no implicit pairing based only on ids, routes, or methods.
2. **A writable addition also requires a server capability; an addition/replacement that needs extension data additionally requires `read-enrichment` from a registered response enricher.** Its widget `onSave` may persist through its own API, but that endpoint still needs `independent-action`, the same `roundTripId`, and matching optimistic-lock semantics. A static display-only **addition** may use a declarative `section-policy` provider validated by server bootstrap; it has no mutation/payload modes and cannot satisfy hide, replace, enrichment, or action requirements. This gives every activated addition a server-known companion without inventing a no-op interceptor/guard.
3. **Capabilities prove behavior, not mere presence.** The actual interceptor/guard publishes protocol version, host, topology variant, form operation, owned payload paths, preservation mode, the complete semantic action contracts, and `roundTripId`. The section requirement is satisfied only by a compatible post-override capability. A registry entry with the right id/route/method but different projection or preservation semantics does not match.
4. **Match section-local actions structurally.** When `mutationSurfaces` is non-empty, add/replace contributions must resolve `independent-action` capabilities whose full `kind`, policy façade target, delegated provider target, operation set, and per-operation optimistic-lock mode equal the descriptor contracts. Matching surface ids alone is invalid. Generation validates the façade guard and delegated route/command/guard separately; their canonical serialization participates in the manifest fingerprint. Hide removes controls but does not weaken the endpoint's existing auth or lock guard.
5. **Validate the final registries, not source declarations.** Generation checks static facts; server bootstrap checks the declarative display-policy registry, `getEnrichersForEntity`, API/command interceptor registries, and mutation guards after unified overrides. A disabled/replaced backend contribution therefore invalidates its section operation.
6. **Publish only accepted operations.** The client receives a data-only resolved manifest and fingerprint. A missing/mismatched companion or dependency retains the base section for hide/replace or omits an addition; it never applies a UI-only mutation.
7. **Bind each request to the resolved policy.** The bound request client merges the applicable lifecycle headers (`onBeforeSave` or `onBeforeDelete`), `buildExtensionHeader` output, policy fingerprint/round-trip token, and optimistic-lock header explicitly into each request. It invokes an additive policy-bound façade operation whose guard derives the accepted policy from the server manifest and locked current record before delegating to existing domain logic; it never trusts client omission as proof that a field should be preserved. A missing, stale, unrecognized, or form-mode/request-operation/resource-mismatched token is rejected by that façade. Shared backward-compatible endpoints continue their existing behavior and are not claimed as missing-token enforcement boundaries.
8. **Scope independent actions through one runner.** Built-in and contributed group actions use `runSectionMutation` and its bound client to reach their declared policy façade; direct unbound calls are a coverage failure for a declared mutation surface. The façade verifies the action contract and action resource binding independently from the parent form resource, while existing endpoint auth, mutation guards, and optimistic-lock headers remain authoritative. The provider fact identifies both the façade and the actual delegated route/command so generation proves that matching is not decorative.
9. **Protect policy headers; rebind entity versions.** Bound clients reject caller-supplied section-policy header keys. A child `entity-version` update/delete must bind its own resource id and `expectedUpdatedAt`, replacing—not merging with—the parent lock for only that request. Creates carry no version. Provider/action facts determine whether those inputs are required. Parent delete uses an update form mode plus a distinct delete request operation and delete lifecycle headers.

A presentation-compatible replacement may name the base section's already-registered capability when it preserves the same fields, actions, and semantics; it does not register a duplicate backend handler. A behavioral replacement must name its own compatible capability. Thus every hide/replace has an explicit server companion while common projection/interceptor code remains shared.

This is the enforcement point requested by this revision: an app author cannot hide or replace a section without a resolvable backend validation/save contribution.

The authoring path stays small. An app module registers one section contribution and its named backend handler, then selects it from `modules.ts`:

```ts
overrides: {
  forms: {
    sections: {
      'crud-form:catalog.product/edit/update/compliance': {
        operation: 'hide',
        contributionId: 'services.hide-product-compliance',
      },
    },
  },
}
```

The `services.hide-product-compliance` contribution fact carries the `roundTripId` and required capability id. Its registered interceptor publishes the matching payload paths and `omit-preserves` semantics. Generation fails if that capability is absent; server bootstrap omits the operation if the provider is disabled or semantically incompatible after overrides. The app author never wires a second client store or manually coordinates render and submit callbacks.

### 5. Bootstrap readiness

`pending` is distinct from “no policy.” The provider starts with the server-resolved manifest and remains pending until client widget/component registries have applied their matching entries. A form with section overrides renders `LoadingMessage` and cannot submit while pending.

After a settled bootstrap failure, status becomes `failed`, diagnostics are reported, and the full base form is rendered. The fallback is never a partially applied policy. This reuses the readiness pattern already used by injection hooks; no `useSyncExternalStore(..., () => null)` first-paint window is added.

### 6. Validation and payload projection

The resolver keeps two views:

- **full values:** loaded/current values, available read-only for legitimate cross-section reads;
- **active values:** only fields owned by resolved sections, used for client validation and submission.

Hidden fields never enter active schema validation. The host does not run one unchanged whole-form schema over restored hidden values. Server validators remain authoritative for the keys actually submitted.

Before `CrudForm` custom-field validation, definitions are projected to `ownedCustomFieldIds` of active sections. Hiding a custom-field section therefore cannot produce an unreachable required-field error, while visible custom fields keep their current validation.

Payload contributions are key-path aware and deep-merged. Conflicting writes to the same leaf are a development error and a test failure. Separate sections may contribute different leaves of one object without clobbering each other.

### 7. Catalog product edit — first adopter

The first adopter is only the product **update** surface: `hostId = 'crud-form:catalog.product'`, `formVariant = 'edit'`, `formOperation = 'update'`, and `resourceId = product.id`. The page passes the operation and resource id explicitly because its current initial values omit `id`; policy resolution must not inherit the current incorrect injection-context inference of `operation: 'create'`.

Product create remains `formVariant = 'create'`, `formOperation = 'create'`, and fail-closed for section overrides in this phase. It has a different two-card topology plus a compound workflow spanning product creation, conversions, variants, prices, attachment transfer, inbox completion, and cleanup. It may adopt this mechanism only after a separate domain adapter describes that entire workflow. An edit policy can never resolve on create, even when both retain the legacy `crud-form:catalog.product` widget spot.

The catalog keeps ten stable ids:

`details`, `dimensions`, `metadata`, `options`, `product-uom`, `compliance`, `variants`, `meta`, `categorize`, `custom-fields`.

| Section | Active validation/payload/write ownership |
|---|---|
| `details` | title validation; title/description/media payload; `metadata.__useMarkdown`; variant-media fallback; provides the title/description data contract used by the SEO widget; declares attachment upload/delete mutation surfaces delegated by `ProductMediaManager` |
| `dimensions` | dimensions and weight payload |
| `metadata` | user metadata leaves excluding reserved `__useMarkdown` and other framework-reserved keys |
| `options` | option schema definition/id in the product payload; reads the full stored title when details is hidden; declares independent `catalog/option-schemas` create/update/delete mutation surfaces and their entity-version locks |
| `product-uom` | UoM schema/imperative checks, UoM payload, and conversion create/update/delete lifecycle |
| `compliance` | compliance-only schema projection and the 26 compliance/SEO payload keys |
| `variants` | no parent-product payload; declares independent variant create, generated-create, and delete mutation surfaces plus their feature guards and entity-version lock expectations |
| `meta` | subtitle/handle/SKU/type/tax/configurability payload |
| `categorize` | category/tag/offer payload, offer deletion, and offer snapshot merge; it may read full details values |
| `custom-fields` | custom-field definition validation, `customFieldsetCode`, and custom field payload |

The details media actions are not implicit in the parent payload:

| Mutation surface id | Policy façade | Delegated provider | Operation / lock mode |
|---|---|---|---|
| `catalog.product.details.attachment-create` | `POST /api/attachments/section-policy` | `POST /api/attachments` | `create` / `not-applicable` |
| `catalog.product.details.attachment-delete` | `DELETE /api/attachments/section-policy?id=:id` | `DELETE /api/attachments?id=:id` | `delete` / `not-applicable` |

Both attachment-module routes require `attachments.manage`. Extract the current inline upload/delete work into shared attachment operations used by both the legacy route and the policy façade; do not call one HTTP handler from the other and do not duplicate authentication, `resolveAttachmentRequestScope`, tenant/organization filtering, multipart/size validation, quota reservation/recovery, custom-field/tag/assignment handling, storage/cache cleanup, or CRUD side effects. The façade adds section-token validation before invoking the same operation. The lock exemption means only that attachments do not use an entity-version token in this flow; it is not an authorization exemption.

Cross-section facts are explicit rather than inferred from component source:

| Consumer | Declared dependency | Resolution rule |
|---|---|---|
| injected SEO widget | writable `catalog.product.title-description` from `details` | Hiding/replacing details requires disabling SEO or providing the compatible contract |
| `meta` title-to-handle behavior | read-only `catalog.product.loaded-title` | The host supplies the stored title independently of active payload fields; hiding details stops title writes but does not erase the read contract |
| `categorize` offer fallback | read-only `catalog.product.offer-fallbacks` from the locked current record | Domain adapter uses server/current values when details is hidden; never stale restored browser fields |
| `options` | read-only `catalog.product.loaded-title` | Template actions remain independent and guarded; hiding details cannot make title an active payload field |
| `variants` | `catalog.product.option-schema` | Base/full loaded values may satisfy read-only display; a replacement that changes the schema must provide the same contract, otherwise resolution fails |

Specific invariants:

- hidden compliance does not parse or submit its values, so a server-valid/client-invalid stored quantity cannot block a title edit;
- hidden custom fields are excluded before definition validation and omitted from payload;
- visible details plus hidden metadata updates only `metadata.__useMarkdown` and preserves every hidden user metadata leaf through a server-side `merge-server-leaves` capability;
- visible metadata plus hidden details preserves the stored `__useMarkdown` value through the same server-owned leaf merge;
- the server reads the tenant/organization-scoped current product under optimistic lock and merges only authorized visible metadata leaves; the client never sends restored hidden metadata as a preservation mechanism, so a stale parent version conflicts and a current-version request preserves the latest hidden leaves rather than overwriting them from a browser snapshot;
- hidden UoM runs no conversion synchronization;
- hidden categorize runs no offer deletion/update;
- offer deletes and conversion updates/deletes keep their existing child versions; the product update keeps the product version; nested offer-upsert concurrency hardening follows `.ai/specs/2026-10-09-catalog-nested-offer-optimistic-locking.md` rather than being bundled into this section contract;
- hiding an action-bearing section removes its controls, while an addition/replacement that exposes equivalent actions must declare compatible backend mutation surfaces and requirements;
- hiding/replacing details removes media upload/delete controls; an authorized replacement receives lock-exempt attachment create/delete surfaces through `runSectionMutation`, whose policy façade delegates to the actual scoped/authenticated attachment providers and is covered by hide/replace tests;
- the active `catalog.injection.product-seo` widget declares its title/description field reads and required details data contract; hiding/replacing details fails closed unless the policy also disables that widget or the replacement provides the compatible contract, so its `onBeforeSave` cannot validate stale/absent inputs;
- with no override configured, the current business-field payload and write ordering are preserved; only declared manifest/round-trip metadata differs.

## 📝 Architecture and Contract Surfaces

| Area | Change |
|---|---|
| `packages/shared/src/modules/overrides.ts` | Add `forms.sections` and compose it with existing override helpers |
| `packages/shared/src/modules/widgets/injection.ts` | Add `InjectionPlacement` fields to group placement; add optional section dependency/capability metadata |
| `packages/shared/src/modules/widgets/extension-points.ts` | Add optional host variants/operations and project semantic versioned section capabilities, dependencies, and round-trip requirements into additive contribution facts |
| `packages/ui/src/backend/CrudForm.tsx` | Reuse `resolvedInjectionSpotId`, accept optional stable `formVariant`, `formOperation`, and `resourceId`, resolve descriptors once, gate readiness, use active validation/custom-field/payload projections, and expose request-bound clients to submit/delete/group/widget mutation contexts |
| `packages/ui/src/backend/utils/` | Add immutable header-bound wrappers over existing API/CRUD helpers; keep legacy ambient scopes compatible but exclude section-policy tokens from them |
| `packages/ui/src/backend/injection/` | Generic resolver and section component adapter built on current widget/component registries |
| server bootstrap + interceptor registries | Validate post-override requirements and publish accepted manifest/fingerprint |
| CLI module facts/generators | Emit host variants/operations/sections, override keys, semantic capabilities/dependencies, diagnostics, and per-invocation coverage failures |
| docs/create-app harness | Document and prove the app-module recipe |
| catalog product routes | Bounded identity wiring in existing client roots; pure route-local descriptor/capability module; edit-only first full adoption |
| `packages/core/src/modules/attachments/api/route.ts` + attachment operations library | Keep legacy routes, extract reusable upload/delete operations, and add exact mandatory-token `/api/attachments/section-policy` façade routes with the same `attachments.manage` and request-scope behavior |

Additive stable surfaces:

- `ModuleOverrides.forms.sections`;
- canonical host/variant/operation/section keys and optional additive `CrudForm.formVariant`, `CrudForm.formOperation`, and `CrudForm.resourceId` props;
- `CrudFormSectionDescriptor` and resolver result;
- optional placement/requirement fact fields;
- catalog product section ids, already protected as built-in group ids.

Nothing is removed or renamed. Existing `CrudForm` props, spot ids, component handles, override keys, and widget behavior remain compatible. The deprecation protocol applies to any later rename/removal of a host or section id.

### Migration & Backward Compatibility

This is an additive contract. Existing forms need no migration and continue to use their current `groups`, `hiddenGroupIds`, injection widgets, validation, operation inference, and submit callbacks until they opt into section descriptors. Existing injection-widget disablement remains under `overrides.widgets.injection`; it is not translated into `forms.sections`. Policy-bound façade operations are additive entry points that delegate to existing domain services; legacy callers and shared endpoint contracts remain unchanged.

Newly published host ids, form variants, form operations, built-in section ids, contribution/capability ids, `roundTripId` values, and documented imports become stable extension surfaces. They cannot later be renamed or removed without the repository deprecation protocol, an `UPGRADE_NOTES.md` bridge, and dual acceptance for at least one minor release. Optional fields may be added to descriptors, facts, manifests, and override objects, but existing required fields and operation meanings cannot be narrowed.

Adoption is fail-closed rather than flag-day: generation inventories every grouped invocation, but only unambiguous host/variant/operation surfaces with complete descriptors, compatible dependencies, and validated backend capabilities advertise add/hide/replace support. A custom invocation that is not ready continues to render and save exactly as before. No stored setting, database migration, or data rewrite is involved, so rollback restores the complete base form without transforming records.

## 📝 Data Models

No database entity, column, relation, index, migration, or tenant-owned setting is added. The new models are typed runtime/build artifacts only:

- base and contributed section descriptors;
- the composed override map;
- generated extension facts, dependency graphs, capability manifests, and diagnostics;
- the server-approved data-only manifest and fingerprint.

The manifest contains host id, form variant, form operation, section/contribution ids, placement, supported operations, semantic capability/dependency facts, and a content fingerprint. It contains no functions, resource ids, record values, credentials, tenant data, or user data. Widget components and backend handlers continue to load from their existing registries. The per-request resource id is bound only in the signed/validated round-trip context.

## 📝 API Contracts

Existing endpoint URLs and request/response shapes do not change. Each policy-enabled parent or independent mutation uses an additive policy-bound façade route/command id whose guard requires a valid section token, operation, target resource, and declared lock mode before delegating to the existing domain service. This separation is what makes missing-token rejection enforceable without changing backward-compatible shared endpoints. Generated provider facts name both layers and tests prove the façade delegates to the real scoped/authenticated implementation.

The platform bootstrap contract additively exposes the approved section manifest/fingerprint to the client, and mutated requests carry one existing `x-om-ext-*` extension header containing the resolved round-trip identity, form mode, request operation, and resource binding. An immutable request-bound client adds that header directly to every API/CRUD request rather than relying on the ambient scoped-header stack. The shared projection interceptor or host-specific guard verifies that identity before request validation/save logic proceeds. For merge-owned objects such as catalog metadata, the server then reads the locked current record and merges only capability-authorized visible leaves; omission alone never directs preservation.

On a policy-bound façade, a missing, stale, wrong-form-mode, wrong-request-operation, wrong-resource, or undeclared-action policy token returns HTTP `409` with the stable machine code `extension_policy_mismatch` and no mutation. The response includes a reload/retry hint but does not echo fingerprints or registry internals. Existing auth/permission/version conflicts retain their current status and error codes, so clients can distinguish stale section policy from record-version conflict. Independent actions receive the same policy fingerprint plus their action surface/request-operation/resource binding through `runSectionMutation`; they do not reuse the parent resource binding or parent version as the target entity identity. Calls to legacy shared endpoints without a policy token retain their pre-feature semantics and are outside this guarantee.

The header is not an authorization credential. Authentication, feature guards, tenant/organization scoping, optimistic locking, route schemas, and command invariants remain authoritative. A valid user cannot activate a policy the server did not resolve for the current application build.

## 📝 UI/UX

- No policy: the current form renders immediately and unchanged.
- Valid policy still bootstrapping: the form body shows the standard `LoadingMessage`; actions are unavailable.
- Valid resolved policy: added/replaced/hidden cards occupy the resolved placement with existing group layout, collapse, ordering, autofocus, and accessibility behavior.
- Settled policy failure: the complete base form renders with an internal diagnostic; users are never shown a half-customized form.
- Unknown/stale ids never white-screen the page and never silently activate.

No new design-system primitive or user-facing configuration UI is introduced. Developer diagnostics use structured logging; public documentation and generated facts are the authoring interface.

## 📝 Frontend Architecture Contract

### Server/client boundary map

| Surface | Server owner | Client island | Data/decision owner |
|---|---|---|---|
| Generic backend form route | Existing host loader/server root where present; no boundary change required | Existing `CrudForm` island | Host supplies base values, explicit surface identity, and descriptors |
| Section-policy bootstrap | Server bootstrap and final backend registries | Existing bootstrap provider, with a small section-manifest reader | Server owns accepted capabilities/fingerprint; client may only consume the accepted manifest |
| Section render/submit | None added at page-root level | Existing `CrudForm`, injection widget leaves, and registered replacement leaves | One resolved descriptor list owns UI, active validation, projection, lifecycle, and dependency status |
| Catalog product create | Existing client `create/page.tsx` root | Existing `CrudForm`/`ProductBuilder` tree | Page wires create identity only; create remains policy-ineligible until its compound adapter exists |
| Catalog product edit | Existing client `[id]/page.tsx` root | Existing form and current local section components | Page wires update identity only; extracted catalog descriptor/domain modules own metadata merge, conversions, offers, and action facts |

### `"use client"` ledger

| File | Reason | Imported by | Heavy dependencies | Cleanup/hydration risk | Alternative rejected |
|---|---|---|---|---|---|
| `packages/ui/src/backend/CrudForm.tsx` (existing) | Stateful form, browser interaction, and lifecycle dispatch | Backend form client leaves | Existing form stack only; none added | Policy registry subscription must clean up under Strict Mode and cannot flash an editable base form | A server component cannot own interactive form state |
| `packages/ui/src/backend/injection/useResolvedCrudFormSections.ts` (new) | Reads the delivered manifest and reactive UMES registries | `CrudForm` | None; no domain/UI module imports | Target under 200 LOC; stable snapshot and unsubscribe required | Copying resolution into each host duplicates precedence and safety checks |
| `packages/core/src/modules/catalog/backend/catalog/products/create/page.tsx` (existing root) | Existing compound product-builder state and browser interactions | Next.js route | Existing route dependencies; none added | At most 20 net LOC of identity prop wiring; no descriptors/capabilities or new effects inline | Converting this existing large page in the same feature would broaden scope; new policy remains disabled here |
| `packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx` (existing root) | Existing product-edit state, dialogs, and browser interactions | Next.js route | Existing route dependencies; none added | At most 20 net LOC of identity/descriptor import wiring; no capability tables or resolver logic inline | Full server-boundary migration is separate work; bounded wiring avoids growing the existing client blob |
| `packages/core/src/modules/catalog/backend/catalog/products/components/productFormSections.ts` (new pure route-local module) | No `"use client"`; holds descriptors, dependency facts, and capability references | Catalog edit page and server/generator facts | No React or browser dependencies | Pure deterministic exports; separately unit tested | Defining these hundreds of lines inline in `[id]/page.tsx` would grow the client root |
| Existing injection/replacement component leaves | Route/module-owned interactivity | Generated/local widget registry | Whatever the existing local leaf owns; never promoted globally | Existing lifecycle cleanup remains authoritative | Eager import by the shared resolver would couple every form bundle to every adopter |

No page changes client/server classification: existing client roots remain client, and existing server roots remain server. Global providers gain no route-specific import.

### Client blob guardrail

- Zero new production dependencies, page-root client boundaries, or route-specific imports in global providers.
- The generic resolver/hook stays under 200 net LOC; descriptor/capability types and pure composition live in shared/server-safe modules. An exception requires a split before merge.
- Existing catalog create/edit client roots each accept at most 20 net LOC of prop/import wiring. All descriptor, dependency, and capability declarations live in the extracted pure route-local module; no new effects or inline policy tables enter either page root.
- Empty policy is an allocation-light identity path: no subscription, manifest fetch, or descriptor cloning beyond current group normalization.
- Resolution is linear in base sections + contributions + active widget dependencies; no nested scan across the repository registry.
- Catalog product create/edit bundle boundaries stay unchanged. The edit-only adopter must not pull edit components into the create route or vice versa.

### Budgets

| Budget | Target |
|---|---|
| Generated/backend page-root `"use client"` | 0 new unallowlisted |
| New client page/root files over 300 LOC | 0 |
| Existing oversized catalog create/edit client roots | At most 20 net LOC each, wiring only |
| Existing `CrudForm` growth | At most 80 net LOC because resolution is extracted |
| New resolver hook | At most 200 net LOC |
| Heavy browser libraries at page/provider root | 0 |
| Catalog create/edit route gzip delta | At most 10 KiB each without explicit split/waiver |
| Attributable dev-runtime RSS delta after create → edit | At most 25 MiB without maintainer waiver and tracked follow-up |
| Per-route hydration smoke | Required for catalog create and edit |

### Provider/bootstrap scope

| Provider/bootstrap | Global? | Scope | Why | Exit criteria to narrow |
|---|---|---|---|---|
| Existing extension/bootstrap provider | Existing global boundary | Stores only the small data-only accepted manifest/fingerprint | Any `CrudForm` can be an extension host | Split by runtime surface if measured manifest/subscription cost exceeds the declared budgets |
| Section resolver | No | Per mounted `CrudForm` | Combines that form's base descriptors with the accepted manifest and active registries | Unmount unsubscribes; empty policy uses identity fast path |
| Catalog descriptors/widgets | No | Catalog product edit route/module | Domain ownership and action dependencies are catalog-specific | Never become global; loaded only through existing route-local UMES registrations |

### Hydration, interactivity, and performance evidence

- `yarn check:client-boundaries` must pass and show no new page-root client exception, heavy global import, or oversized client root.
- `yarn build:app`/bundle output must show no new shared chunk containing catalog section components and no material route-chunk regression; a >10 KiB gzip increase on either catalog product route requires an explained split or explicit waiver.
- Playwright covers server render → pending bootstrap → ready hydration without a flash of the editable base form, early-submit blocking, settled-failure base fallback, create/edit policy isolation, and keyboard submit after readiness.
- Unit tests cover empty-policy identity, linear dependency resolution, registry update cleanup, and Strict Mode remount without duplicate lifecycle execution.
- Before merge, record the client-boundary report, changed route bundle deltas, and one dev-runtime RSS sample after opening product create then edit. No regression above 25 MiB attributable RSS is accepted without a documented follow-up and maintainer waiver.

## 📝 System-wide CrudForm Adoption Audit

Audit scope: production TSX under `apps/mercato/src/modules`, `packages/*/src/modules`, and `external/official-modules`, excluding tests, generated fixtures, docs, and create-app mirrors. The audit parses JSX with `@babel/parser`; raw text matching is invalid because it counted the `<CrudForm>` text in a staff comment as a renderer. The snapshot below was reproduced at source SHA `7187041c2` and merged into this PR by `3a0f60bf3`. `external/official-modules` was absent in that checkout; the generator must scan it whenever present.

- 131 source files contain an actual `CrudForm` JSX invocation.
- 139 `CrudForm` invocations exist in those files.
- 102 grouped invocations exist across 98 files and therefore enter this contract audit.
- 59 grouped invocations have a syntactically present widget host through the same precedence as `CrudForm`: `injectionSpotId`, then `entityId`/the first `entityIds` value.
- 43 grouped invocations have none of those inputs and need an explicit `injectionSpotId` before section overrides can target them.

These numbers are point-in-time review evidence, not a normative allowlist. The regenerated inventory at the eventual merge head is authoritative and merge-gating; it records its audited SHA and fails on unexplained drift.

Coverage is per JSX invocation, not per file. Every grouped invocation is checked by generation and classified as:

- **standard:** group field ids plus a single CRUD mutation; it can use the shared projection interceptor;
- **custom:** custom group components, derived payloads, multiple API calls, or secondary writes; it must supply explicit descriptors and domain backend capabilities;
- **unbound:** no `resolvedInjectionSpotId`; overrides are unavailable until an explicit spot is added;
- **dynamic host:** the expression can resolve to multiple hosts or no host; every alternative and caller must be declared and verified before overrides are available;
- **runtime variant:** one invocation can expose multiple section topologies; each exact ordered schema needs a stable declared variant and resolver, never a union;
- **ambiguous variant:** a host resolves, but its schema still collides on one variant id; overrides are unavailable until the collision is removed;
- **ungrouped compatibility:** no section address exists; the form retains identity behavior and bypasses section manifest/readiness gating.

| Source family | Grouped invocations | Resolved host | Unbound |
|---|---:|---:|---:|
| `apps/mercato/src/modules/example` | 3 | 3 | 0 |
| `packages/checkout/src/modules/checkout` | 1 | 1 | 0 |
| `packages/core/src/modules/api_keys` | 1 | 0 | 1 |
| `packages/core/src/modules/attachments` | 1 | 1 | 0 |
| `packages/core/src/modules/auth` | 4 | 4 | 0 |
| `packages/core/src/modules/availability` | 2 | 0 | 2 |
| `packages/core/src/modules/business_rules` | 5 | 0 | 5 |
| `packages/core/src/modules/catalog` | 8 | 8 | 0 |
| `packages/core/src/modules/currencies` | 4 | 0 | 4 |
| `packages/core/src/modules/customer_accounts` | 2 | 1 | 1 |
| `packages/core/src/modules/customer_groups` | 2 | 2 | 0 |
| `packages/core/src/modules/customers` | 10 | 9 | 1 |
| `packages/core/src/modules/devices` | 2 | 0 | 2 |
| `packages/core/src/modules/directory` | 4 | 4 | 0 |
| `packages/core/src/modules/entities` | 2 | 0 | 2 |
| `packages/core/src/modules/eudr` | 12 | 0 | 12 |
| `packages/core/src/modules/feature_toggles` | 3 | 1 | 2 |
| `packages/core/src/modules/planner` | 1 | 1 | 0 |
| `packages/core/src/modules/resources` | 2 | 2 | 0 |
| `packages/core/src/modules/sales` | 10 | 10 | 0 |
| `packages/core/src/modules/staff` | 6 | 6 | 0 |
| `packages/core/src/modules/warranty_claims` | 9 | 6 | 3 |
| `packages/core/src/modules/workflows` | 2 | 0 | 2 |
| `packages/enterprise/src/modules/security` | 2 | 0 | 2 |
| `packages/scheduler/src/modules/scheduler` | 2 | 0 | 2 |
| `packages/webhooks/src/modules/webhooks` | 2 | 0 | 2 |

The exact 43 unbound invocations in this snapshot are:

- `packages/core/src/modules/api_keys/backend/api-keys/create/page.tsx:154`
- `packages/core/src/modules/availability/backend/availability/policies/[id]/page.tsx:102`
- `packages/core/src/modules/availability/backend/availability/policies/create/page.tsx:53`
- `packages/core/src/modules/business_rules/backend/rules/[id]/page.tsx:149`
- `packages/core/src/modules/business_rules/backend/rules/create/page.tsx:72`
- `packages/core/src/modules/business_rules/backend/sets/[id]/page.tsx:282`
- `packages/core/src/modules/business_rules/backend/sets/create/page.tsx:97`
- `packages/core/src/modules/business_rules/components/InlineRuleEditor.tsx:206`
- `packages/core/src/modules/currencies/backend/currencies/[id]/page.tsx:252`
- `packages/core/src/modules/currencies/backend/currencies/create/page.tsx:96`
- `packages/core/src/modules/currencies/backend/exchange-rates/[id]/page.tsx:140`
- `packages/core/src/modules/currencies/backend/exchange-rates/create/page.tsx:37`
- `packages/core/src/modules/customer_accounts/backend/customer_accounts/roles/create/page.tsx:87`
- `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/QuickDealDialog.tsx:409`
- `packages/core/src/modules/devices/backend/devices/[id]/page.tsx:104`
- `packages/core/src/modules/devices/backend/devices/create/page.tsx:72`
- `packages/core/src/modules/entities/backend/entities/user/[entityId]/page.tsx:590`
- `packages/core/src/modules/entities/backend/entities/user/[entityId]/page.tsx:611`
- `packages/core/src/modules/eudr/backend/eudr/evidence-submissions/[id]/page.tsx:476`
- `packages/core/src/modules/eudr/backend/eudr/evidence-submissions/create/page.tsx:314`
- `packages/core/src/modules/eudr/backend/eudr/plots/[id]/page.tsx:347`
- `packages/core/src/modules/eudr/backend/eudr/plots/create/page.tsx:212`
- `packages/core/src/modules/eudr/backend/eudr/product-mappings/[id]/page.tsx:262`
- `packages/core/src/modules/eudr/backend/eudr/product-mappings/create/page.tsx:139`
- `packages/core/src/modules/eudr/backend/eudr/risk-assessments/[id]/page.tsx:324`
- `packages/core/src/modules/eudr/backend/eudr/risk-assessments/create/page.tsx:196`
- `packages/core/src/modules/eudr/backend/eudr/statements/[id]/page.tsx:643`
- `packages/core/src/modules/eudr/backend/eudr/statements/create/page.tsx:464`
- `packages/core/src/modules/eudr/components/MitigationActionsSection.tsx:366`
- `packages/core/src/modules/eudr/components/StatementLifecycleBar.tsx:315`
- `packages/core/src/modules/feature_toggles/backend/feature-toggles/global/create/page.tsx:28`
- `packages/core/src/modules/feature_toggles/components/FeatureToggleOverrideCard.tsx:121`
- `packages/core/src/modules/warranty_claims/backend/warranty_claims/[id]/edit/page.tsx:462`
- `packages/core/src/modules/warranty_claims/backend/warranty_claims/[id]/page.tsx:2478`
- `packages/core/src/modules/warranty_claims/backend/warranty_claims/create/page.tsx:1492`
- `packages/core/src/modules/workflows/components/EdgeEditDialogCrudForm.tsx:275`
- `packages/core/src/modules/workflows/components/NodeEditDialogCrudForm.tsx:1146`
- `packages/enterprise/src/modules/security/components/SecurityUserForm.tsx:165`
- `packages/enterprise/src/modules/security/components/SudoConfigCrudPage.tsx:169`
- `packages/scheduler/src/modules/scheduler/backend/config/scheduled-jobs/[id]/edit/page.tsx:120`
- `packages/scheduler/src/modules/scheduler/backend/config/scheduled-jobs/new/page.tsx:55`
- `packages/webhooks/src/modules/webhooks/backend/webhooks/[id]/page.tsx:502`
- `packages/webhooks/src/modules/webhooks/backend/webhooks/create/page.tsx:41`

Five previously listed customer/staff forms already resolve through `entityIds`; adding new spot ids there would duplicate the current UMES identity. Conversely, one source file can contain multiple invocations: both grouped entity-editor forms above are unbound, and the warranty detail page's grouped claim-line form is distinct from its two ungrouped dialogs.

### Complex bound-host migration routing

Already-bound does not mean section-ready. The generated inventory routes every custom submit, component group, or secondary write to an explicit domain descriptor instead of the shared single-CRUD projector:

| Family / exact renderer | Required routing |
|---|---|
| `packages/checkout/src/modules/checkout/components/LinkTemplateForm.tsx:1643` | Enumerate link/template mode + create/update surfaces; keep component groups, custom validation/payload normalization, dynamic endpoints, preview/publish, attachment transfer, delete, and locking in a checkout-owned adapter. |
| `attachments/components/AttachmentLibrary.tsx:657` | Batched upload, tags/assignments, and partial-success accounting stay in an attachment-owned adapter. |
| `auth/backend/users/{create/page.tsx:320,[id]/edit/page.tsx:536}` and `roles/{create/page.tsx:87,[id]/edit/page.tsx:213}` | Separate create/edit variants; ACL, dashboard-widget, consent, and custom-field writes declare their owning sections and child versions. |
| `customer_accounts/.../roles/[id]/page.tsx:366` | Role and permissions/ACL writes are custom; pair with the currently unbound create variant. |
| `customers` company/person pages, `CreatePersonDialog.tsx:159`, `CalendarEventEditor.tsx:533`, `ActivityForm.tsx:383`, `TaskForm.tsx:137`, and `DealForm.tsx:1307` | Preserve address/tag/widget/delegated writes; publish finite surface entries for Task/Deal forms and exact association variants. |
| `directory` tenant/organization create/edit and `feature_toggles/.../[id]/edit/page.tsx:75` | Preserve derived/custom-field payloads and pair the feature-toggle edit surface with its unbound create variant. |
| `planner/components/AvailabilityRuleSetForm.tsx:87`, `resources/components/ResourceCrudForm.tsx:408`, and `ResourceTypeCrudForm.tsx:108` | Keep delegated submit/delete and component-owned attachment/custom-field behavior in domain adapters. |
| Sales channel create/edit, `ChannelOfferForm.tsx:699`, `LineItemDialog.tsx:3078`, `AdjustmentDialog.tsx:801`, `PaymentDialog.tsx:612`, `ShipmentDialog.tsx:1698`, and `SalesDocumentForm.tsx:373,409,1529` | Declare product/media/price/watcher/customer/address side writes, finite order/quote hosts, mode variants, component sections, and delegated domain mutations. |
| Staff project create/edit plus `CreateProjectDialog.tsx:56`, `TeamForm.tsx:81`, `TeamRoleForm.tsx:144`, and `TeamMemberForm.tsx:542` | Separate full/compact project topologies and retain best-effort self-assignment/delegated writes. |
| Warranty registration, troubleshooting-guide, and vendor-policy create/edit | Keep their custom payload adapters; the unbound claim create/edit/line forms remain unsupported until their runtime mode variants are declared. |
| `apps/mercato/src/modules/example/components/TodoForm.tsx:114,221` and `backend/umes-handlers/page.tsx:435` | Todo requires create/edit variants; the handlers demo is explicitly non-mutating. |
| `customer_groups` create/edit | Same-schema standard candidates; the separate ungrouped terms editor remains compatibility-only. |
| Remaining catalog category, price, product-variant create/edit, and compound product-create forms | Inventory their existing hosts now; adopt them in the catalog wave of the separate rollout. Product create remains ineligible until its compound adapter covers attachment transfer, conversions, variants, prices, inbox completion, and cleanup. |

The minimum collision/runtime-variant migration set is: example Todo create/edit; auth user and role create/edit; customer company/person page, dialog, and sales quick-create shapes; customer-account roles; business-rule sets; EUDR evidence submissions; the two entity-editor forms on one page; staff full/compact projects; sales quote/order documents, lines, and adjustments; warranty claim create/edit/line modes; workflow node types; and DealForm association states. Identical-schema create/edit pairs do not receive gratuitous variants unless behavior or ownership differs.

Dynamic hosts are explicit: `DealForm` includes hosted and `null` alternatives and every caller is verified; `LineItemDialog` and `AdjustmentDialog` enumerate order/quote hosts; `TaskForm` enumerates its supported entity hosts. Runtime-varying forms such as `NodeEditDialogCrudForm`, warranty claim edit/detail, DealForm associations, and line-item kind/mode publish one exact ordered schema per stable runtime variant. An unresolved expression or observed schema mismatch is a blocking diagnostic, not a best-effort section surface.

### Ungrouped compatibility surface

Ungrouped forms have no addressable section topology. They retain current render/validation/submit identity behavior, do not request a section manifest, and never wait on section readiness. The generated inventory records them as compatibility-only rather than falsely claiming section support. Regression coverage includes dynamic/coupled representatives: entity record create/edit, integrations credentials, WMS location/warehouse/configuration dialogs, warranty assignment/transition/vendor-recovery actions, enterprise security password/enforcement-policy forms, planner schedule/rules editors, sales returns/settings dialogs, customer-group terms/person assignment, and agent-orchestrator drawers.

Resolved does not imply unambiguous. Catalog product create/edit share `crud-form:catalog.product` but expose different group sets and operations; `TodoForm` create/edit likewise share one entity-derived spot while exposing `tips` versus `actions`. Generator facts therefore key base sections by `(resolvedInjectionSpotId, formVariant, formOperation)` and reject a host/operation whose differing schemas still collide on `default`.

The implementation generates the exact invocation/host-alternative/variant/operation/ordered-section inventory so this hand-written snapshot cannot silently drift. New grouped invocations without a resolved spot, optional/dynamic expressions without finite alternatives and caller verification, runtime schemas without an exact variant, policy-enabled invocations without explicit operation/resource identity, or missing section facts fail the repository coverage test. The inventory is part of this framework contract; physically binding every diagnosed host follows `.ai/specs/2026-10-09-crudform-section-adoption-rollout.md` and is not bundled into the catalog proof.

## 📝 Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Policy pending during client bootstrap | Render loading state; no editable form and no submit |
| Client bootstrap settles failed | Render full base form; report diagnostic; no partial override |
| Backend companion missing/disabled/replaced incompatibly | Retain base for hide/replace or omit addition; fail generation/bootstrap diagnostics |
| Client and server manifests differ | Server rejects the round-trip token; no mutation |
| Unknown host/section/contribution id | Ignore operation, keep base, emit actionable diagnostic with valid ids |
| Two invocations share a host but expose different groups | Require distinct stable `formVariant` values; reject both override surfaces while ambiguous |
| Update surface omits explicit operation/resource identity | Reject section-policy activation; existing non-policy behavior keeps legacy inference |
| Edit-form delete | Keep `formOperation: update`, bind `requestOperation: delete` after `onBeforeDelete`, and require declared delete capability/resource version; never reuse submit headers |
| Create and edit share one injection spot | Match the full host/variant/operation tuple; an edit policy cannot resolve on create |
| Two modules replace one section | Existing precedence applies; warn with both module ids |
| Added widget is disabled through widget overrides | Section contribution becomes unresolved and is omitted with its handlers |
| Active widget/section reads a hidden dependency | Retain the base section unless the same policy disables the consumer or the replacement provides the named data contract |
| Section-local action bypasses the scoped runner | Policy façade rejects the missing/action-mismatched token; coverage flags direct legacy-endpoint calls from a policy-enabled adapter |
| Two section actions/forms overlap in time | Each callback receives a distinct immutable request-bound client; every request gets only that client's explicit headers, with no ambient stack or cross-form leakage |
| Child update/delete uses the parent version | Binding validation requires the child resource id/version and replaces the default lock for only that request; server child guard remains authoritative |
| Caller tries to replace a policy header | Bound client rejects before I/O; protected headers are applied last from the accepted manifest |
| Hidden section owns required custom fields | Definitions are excluded before validation; values omitted and preserved server-side |
| One object has leaves owned by two sections | Server deep-merges capability-authorized leaves into the locked current record; preserve hidden leaves; collision fails tests/dev resolution |
| Create form hides a server-required field | Operation rejected unless its write interceptor supplies/derives a valid value for `create` |
| All sections hidden | Form body may render empty, but submit is disabled unless the resolved backend contract explicitly permits a no-op mutation |
| Secondary child writes | Descriptor controls whether submit-coupled writes run; existing update/delete operations keep each child's current version contract |
| Optional/dynamic host resolves to an undeclared value | Do not request a manifest; retain base behavior and emit a blocking generation/runtime diagnostic |
| Runtime groups differ from the declared variant | Do not activate section policy; never union conditional groups into a wider ownership schema |
| Ungrouped form | Preserve current identity behavior and bypass section manifest/readiness entirely |
| Section-local immediate actions | Descriptor facts list their exact mutation surfaces; hide removes controls, and add/replace activates only with compatible backend capabilities |

## 📝 Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Default behavior regresses across 102 snapshot grouped invocations | High | All grouped `CrudForm` rendering/submission | Resolver empty-policy identity fast path, behavior-equivalence tests, generated merge-head inventory, phased verification | Undetected host-specific callback coupling; constrained by per-family tests and fail-closed enablement |
| Two schemas share one injection spot | High | Create/edit and multi-dialog hosts | Stable `formVariant`, variant-qualified facts/keys/handles, and generation failure on differing `default` schemas | Authors must preserve variants as public ids after publication |
| Dynamic host/schema is treated as statically resolved | High | Reusable dialogs and conditional groups | Finite host/variant alternatives, caller verification, exact ordered-schema runtime assertion, no unioning | Truly open-ended extension inputs remain section-ineligible until constrained |
| Operation is inferred incorrectly from missing `values.id` | High | Existing edit forms, including catalog product edit | Add explicit `formOperation`/`resourceId`; require them for policy-enabled updates; preserve legacy inference only outside policy | Unmigrated hosts remain safely ineligible for overrides |
| UI/backend module gating diverges | High | Validation and persistence | Server-resolved manifest, final-registry validation, fingerprint header, base fallback | In-flight deploy skew can reject a save; rejection is safer than silent corruption and is retryable after refresh |
| A handler exists but does not preserve the declared data | High | Hidden/replaced payload sections | Versioned semantic capabilities with modes, paths, operation, and action facts published by the actual provider | Provider implementation still needs integration tests against the real command |
| Field/payload ownership is incomplete | High | Host schemas and mutation payloads | Generated group-field coverage, explicit custom-component ownership, leaf-collision diagnostics, per-host tests | Cross-section derived reads still require domain review |
| Active widget reads a removed section | High | SEO and other injection lifecycle handlers | Generated dependency graph; fail closed or require widget disable/compatible replacement contract | Dynamic undeclared reads require module-owner audit |
| Client boundary expands through generic adoption | Medium | Shared `CrudForm`, bootstrap, catalog routes | Frontend Architecture Contract, focused hook budget, boundary check, route bundle/RSS evidence | Future adopters must repeat their route-specific evidence |
| Side effects run for hidden sections | High | Complex hosts with multiple writes | Explicit domain descriptors and semantic backend capabilities; never classify detected multiple-write hosts as standard | Runtime-indirect writes may evade static classification; those hosts remain unsupported until explicitly audited |
| Section-local dialog/button mutations are absent from host facts | High | Action-bearing custom groups | Descriptor `mutationSurfaces`, semantic capability matching, and configured replacement action tests | New indirect actions still require generator coverage and domain review |
| Policy header leaks across submits/actions | High | Concurrently mounted forms and action-bearing groups | Immutable request-bound API/CRUD clients, per-call action/resource binding, no ambient policy scope, overlap/unmount tests | Custom code can bypass the bound client; policy façade rejection and coverage keep that fail-closed |
| A shared legacy endpoint is mistaken for missing-token enforcement | High | Backward-compatible parent and action APIs | Policy callers use additive guarded façades; provider facts name the delegated implementation; legacy endpoints remain explicitly outside the guarantee | Domain authors must keep policy adapters on the façade path |
| Public override/section ids drift | Medium | Third-party modules | Stable facts, docs, compatibility tests, deprecation protocol | Intentional future migrations still require a bridge release |
| Adoption becomes a flag-day migration | Medium | Delivery scope and module owners | Inventory all hosts here, enable catalog first, and adopt other families through the separate rollout while incomplete hosts stay fail-closed | Some forms remain non-customizable initially, but retain current safe behavior |

Rollback removes the forms override resolver and catalog adopter. There is no migration or stored policy; apps fall back to the complete base form. Existing widgets, fields, and `hiddenGroupIds` continue working.

## 📋 Phasing

1. **Framework contract and server resolution.** Types, override composition, semantic capability/dependency facts, post-override checks, resolved manifest, fingerprint header.
2. **CrudForm integration.** Explicit operation/resource identity, one resolver/list for render and submit, readiness gating, validation/custom-field/payload projection, UMES add/replace adapters.
3. **Merge-head invocation inventory.** Generate authoritative coverage and blocking diagnostics for all grouped invocations, finite surface alternatives, runtime variants, and compatibility-only ungrouped forms. Physical binding/adoption of every host except the catalog product edit proof ships through `.ai/specs/2026-10-09-crudform-section-adoption-rollout.md`.
4. **Catalog product first adopter.** Ten domain descriptors, corrected validation/payload ownership, side-effect control.
5. **Configured-app proof, docs, and standalone harness.** Real build-time override through browser and backend.

Each phase leaves the default application working. A host surface cannot advertise add/hide/replace readiness until its backend capabilities and dependency graph pass.

## 📋 Implementation Plan

### Phase 1 — generic contract

1. Add `forms.sections` to `ModuleOverrides` and the domain union. Compose with existing store/array helpers; preserve `null` as “disable this customization and restore base” plus existing precedence.
2. Extend injection group placement with `position`/`relativeTo`; reuse `insertByInjectionPlacement`.
3. Add form-variant, form-operation, section, dependency, action-surface, and versioned semantic capability fields to extension contribution facts, including `roundTripId`, payload paths/modes, and provider targets.
4. Add generator validation that every section operation resolves a UI contribution, mandatory server capability, and compatible post-policy dependency graph; add static diagnostics and coverage tests.
5. Add server bootstrap validation against capabilities published by the final enricher/interceptor/guard registries and expose only the accepted data-only manifest plus fingerprint.
6. Carry the fingerprint via existing injection request-header aggregation and require it at additive policy-bound façade routes/commands. Add one shared section-policy header builder/parser plus immutable bound wrappers over existing API/CRUD helpers; protect policy keys, support explicit per-child lock replacement, and do not place policy tokens on the module-global scoped-header stack. Keep legacy shared endpoints backward compatible and explicitly outside missing-token enforcement.

### Phase 2 — CrudForm integration

7. Add optional `formOperation`/`resourceId` props and implement `useResolvedCrudFormSections` with `hostId`, `formVariant`, explicit operation/resource identity, `pending | ready | failed`, no separate global store, and an empty-policy identity fast path. Preserve current inference for non-policy callers only.
8. Resolve group UI through existing injection widgets and `ComponentReplacementHandles.section`; add an error-boundary fallback only for already-authorized replacements. Add the bound request client to submit/delete contexts and `runSectionMutation` to built-in group props/widget context. Test explicit-header merging with existing API/CRUD helpers.
9. Derive active field/custom-field definitions and validate only active sections. Keep full values read-only for cross-section reads.
10. Deep-merge active payload contributions; fail on duplicate leaf ownership; run section lifecycle through existing widget event dispatch.
11. Add framework tests: add/before/after, static display-only add without a fake handler, rejection of that provider for hide/replace, widget disable, missing/semantically incompatible capability, dependency mismatch, override precedence, delayed bootstrap, settled failure, form-mode/request-operation/resource/action mismatch, manifest mismatch, concurrent parent/action requests receiving only their own explicit headers, exact emitted headers for parent update, parent delete after `onBeforeDelete`, child update/delete, create without version, attempted policy-header override, policy-façade missing-token rejection, unchanged legacy endpoint behavior, unmount, direct-legacy-call coverage rejection, custom fields, all-hidden, shared-host variant/operation isolation and collision, finite dynamic hosts, exact runtime schema matching, ungrouped bypass, and no-override behavior equivalence.

### Phase 3 — merge-head discovery gate

12. Generate the merge-head inventory and record its source SHA. The current evidence snapshot is 139 invocations in 131 files, including 102 grouped invocations in 98 files, 59 syntactically hosted and 43 unbound; regenerated output, including official modules when present, is authoritative.
13. Emit finite legal `(hostId | null, formVariant, formOperation)` surface entries plus caller coverage and exact ordered groups/ownership/actions/dependencies, compatibility-only ungrouped classification, source locations, and blocking diagnostics. Reject optional/dynamic expressions, invalid cross-product combinations, or observed schemas that escape one exact entry.
14. Auto-classify only single-mutation field-group forms as standard. Route the complex bound families and collision set above to explicit domain descriptors, refresh standalone framework facts, and leave their physical binding to `.ai/specs/2026-10-09-crudform-section-adoption-rollout.md`.

### Phase 4 — catalog product edit

15. Create catalog product edit descriptors in the pure route-local `components/productFormSections.ts`, including option-schema, variant, and details attachment upload/delete mutation surfaces. Mark attachment create/delete as optimistic-lock-exempt, match them to the actual attachment providers, and route policy-enabled calls through bound façade clients. Limit existing create/edit client roots to at most 20 net LOC each of imports/prop wiring. Pass `formVariant="edit"`, `formOperation="update"`, and `resourceId={product.id}` explicitly. Declare create as `formVariant="create"`/`formOperation="create"` but ineligible until its compound domain adapter exists. Keep current group components in place; do not perform the previously proposed 1,400-line component move.
16. Split client validation by active section. Add one projection/preservation case for each of the ten edit groups, including the server-valid/client-invalid `minOrderQty=100000001` regression and hidden required-custom-field regression.
17. Implement key-path payload contribution and server-owned nested metadata merging against the scoped, optimistically locked current product. Test details-visible/metadata-hidden, metadata-visible/details-hidden, and a concurrent hidden metadata-leaf change that the browser must not overwrite.
18. Move conversion sync, offer deletion/payload, and other submit-coupled writes behind their owning descriptors while retaining current child-lock behavior. Test details/meta/categorize and options/variants dependency combinations. Add action-surface permission/lock/reload and policy-header propagation tests for option-schema, variant create/update/delete, and attachment upload/delete operations without moving those immediate actions into form submit. Test details hide/replace removes or safely delegates every media action.
19. Prove the no-policy path produces the same product business-field payload, endpoint selection, and child-write order as the pre-refactor implementation, apart from declared section round-trip metadata.

### Phase 5 — configured build and docs

20. Add a self-contained configured fixture app/module whose `modules.ts` hides compliance/UoM, replaces an action-bearing built-in section (`options` or `variants`), adds one section, and disables the SEO injection widget when its details dependency is removed.
21. In Playwright against that built fixture, assert absent/replaced/added cards, edit-only policy isolation from create, explicit update operation/resource identity despite initial values omitting `id`, action controls supplied only by the authorized replacement, one replacement action reaching its declared guarded target, delayed-bootstrap submit blocking, visible-field save, preservation of compliance/conversions/custom fields, concurrent metadata leaf preservation, dependency-mismatch fallback, disabled widget handlers, and manifest-mismatch rejection. Create and clean up all records.
22. Add API/integration tests for omission-preserves vs explicit-null-clears, capability mode/path mismatches, and exact round-trip enforcement, including the `409 extension_policy_mismatch` response without leaked registry details.
23. Document the generic recipe, form variants, requirement pairing, failure behavior, stable catalog ids, and the distinction among `hiddenGroupIds`, `forms.sections`, and `widgets.injection`.
24. Update `BACKWARD_COMPATIBILITY.md`, the unified-overrides status table, package guidance, template mirrors, and run the standalone-harness refresh with a failure-first case. Record the Frontend Architecture Contract evidence: client-boundary output, create/edit route bundle deltas, hydration coverage, and dev RSS sample.

## 📋 Acceptance Criteria

| # | Criterion |
|---|---|
| AC1 | Every production grouped `CrudForm` invocation appears in generated facts with a resolved host and unambiguous stable variant/operation, or an explicit blocking diagnostic. |
| AC2 | An app can add, hide, and replace sections without copying a host page. |
| AC3 | Add/replace reuse injection widgets, section component handles, placement, and lifecycle primitives; no parallel widget system exists. |
| AC4 | Hide/replace never activates without a versioned semantic capability published by an actual interceptor/command-interceptor/mutation guard; additions needing data also require an enricher capability. |
| AC5 | Missing or mismatched backend contributions keep the base UI and block the custom policy rather than applying client-only behavior. |
| AC6 | Rendering, validation, payload projection, and side effects consume one resolved descriptor list. |
| AC7 | Pending bootstrap cannot expose or submit the unmodified form; settled failure shows the complete base form. |
| AC8 | Hidden fields and hidden custom-field definitions cannot cause unreachable client validation errors. |
| AC9 | Hidden values and nested payload leaves are preserved; explicit visible clears still clear. |
| AC10 | Catalog compliance, conversions, offers, custom fields, metadata/`__useMarkdown`, and optimistic locks satisfy the invariants above. |
| AC11 | A policy-configured fixture build exercises the real `modules.ts` → client UI → backend interceptor/guard round trip in Playwright. |
| AC12 | With no override configured, rendering, business fields, endpoint selection, write order, and current tests remain behavior-equivalent; differences are limited to declared section round-trip metadata. |
| AC13 | Existing `hiddenGroupIds` and `overrides.widgets.injection` behavior remains unchanged and documented. |
| AC14 | Action-bearing sections publish structurally equal façade/delegated-provider mutation contracts (kind, both targets, request operations, lock modes); parent submit/delete and built-in/contributed actions use immutable request-bound clients with the correct lifecycle headers, protected policy headers, and per-child version replacement, with no ambient leakage; hide removes controls without weakening endpoint authorization. |
| AC15 | Catalog details declares lock-exempt attachment upload/delete surfaces matched to the actual providers; hide removes them and replace can invoke them only through an accepted bound policy façade. |
| AC16 | Section-enabled forms use explicit create/update and resource identity; catalog edit resolves as update despite omitted `initialValues.id`, and its policy never affects catalog create. |
| AC17 | Backend matching verifies preservation/projection modes, payload paths, actions, operation, and protocol—not only registry ids/routes/methods—and the server merges hidden metadata leaves from the locked current record. |
| AC18 | A hide/replace that breaks an active section/widget dependency fails closed unless the consumer is disabled or the replacement provides the compatible data contract; catalog SEO is the first regression case. |
| AC19 | The Frontend Architecture Contract passes: no new page-root boundary/global host import, focused resolver budget, client-boundary check, hydration coverage, route bundle evidence, and RSS evidence. |
| AC20 | Optional/dynamic forms publish finite legal `(hostId | null, formVariant, formOperation)` entries with exact groups/facts and verified callers; invalid cross-product combinations, unknown values, schema mismatches, and unioned schemas cannot activate policy. |
| AC21 | Ungrouped forms bypass manifest/readiness with behavior identity, and the regenerated merge-head inventory (including official modules when present) is the normative coverage gate. |
| AC22 | Missing-token rejection is enforced only on additive policy-bound façades; shared legacy endpoints remain backward compatible, and facts/tests prove each façade delegates to its actual provider. |

## Resolved assumptions (autonomous defaults)

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| Q1 | New client policy store or UMES composition? | Compose existing UMES/override registries. | Smaller surface and prevents two precedence/bootstrap models. |
| Q2 | Can UI-only hide/replace be allowed with a warning? | No; fail closed and retain base. | A warning cannot prevent validation/data divergence. |
| Q3 | Is an enricher alone enough? | No for writes. Hide/replace require a semantic capability from an interceptor/guard; an enricher capability is additionally required when data loading changes. | Read enrichment cannot override validation or persistence. |
| Q4 | Parse restored hidden values through the host schema? | No. Validate the active projection; expose full loaded values only for cross-section reads. | Fixes server-valid/client-invalid invisible values while keeping server authority. |
| Q5 | Replace the whole catalog page or extract all inline components? | Neither. Add descriptors around current groups and resolve their section handles. | Avoids page coupling and an unrelated 1,400-line move. |
| Q6 | Enable every complex host immediately? | Inventory all here; move every host except the catalog product edit proof to a separate adoption rollout and enable only when explicit backend capabilities and dependencies resolve. | Keeps the generic capability independently deployable without guessing host side effects. |
| Q7 | Use a new section host id or the existing injection identity? | Reuse `resolvedInjectionSpotId`; add topology `formVariant` plus explicit `formOperation` and update `resourceId`. | Preserves UMES widget scope and `entityIds` while preventing topology, operation, and record-identity collisions. |
| Q8 | Is matching a registered handler id/route/method enough? | No; match a versioned semantic capability published by the final provider. | Presence does not prove omission, leaf merge, domain-write, action, or locking behavior. |
| Q9 | Can catalog create inherit edit customization because the widget spot is shared? | No; the first adopter is update-only and create stays fail-closed until its compound adapter exists. | Create spans additional transactions and cleanup that the edit descriptors do not own. |

## 🔍 Prior Review Finding Disposition

| Inherited finding | Resolution in this revision |
|---|---|
| Hidden server-valid/client-invalid values still fail whole-form parse | Active-section validation projection; explicit quantity regression in steps 16/21 |
| Hidden required custom fields block before page submit | Active custom-field definition projection in step 9; regression in step 16 |
| `metadata.__useMarkdown` ownership is lost | Key-path ownership/deep merge and both hide combinations in step 17 |
| First-paint/early-submit window before client dispatch | Server-resolved manifest plus pending readiness gate in steps 5/7/21 |
| No configured-policy browser test | Real fixture app/module and Playwright round trip in steps 20–21 |

### Independent Generalization Audit Disposition

| Finding | Resolution in this revision |
|---|---|
| Option-schema and variant immediate mutations were absent | `mutationSurfaces` facts, backend compatibility rules, catalog ownership rows, and configured replacement-action coverage |
| Existing offer upserts lacked the claimed child lock | Removed unrelated concurrency hardening from this rollout; the section contract preserves current child-lock behavior and tracks any tightening independently |
| Compliance payload count was stale | Corrected from 23 to the current 26 keys |
| Inventory counted files/comments instead of JSX invocations | Replaced with a Babel AST snapshot at source SHA `7187041c2`: 131 renderer files, 139 invocations, 102 grouped invocations across 98 files; merge-head regeneration is authoritative |
| Existing `entityIds` host resolution was ignored | Canonical identity reuses `resolvedInjectionSpotId`; the snapshot has 59 syntactically hosted and 43 unbound grouped invocations |
| Optional/dynamic hosts were falsely treated as resolved | Added finite legal host/variant/operation surface entries, explicit `null`, caller verification, exact schema matching, and blocking unknown-combination diagnostics |
| One invocation can expose multiple runtime schemas | Added finite variant alternatives, exact ordered-section facts/runtime assertion, and a prohibition on unioning conditional groups |
| Bound complex forms and collision migrations were not routed | Added exact family/render paths, required domain-adapter routing, and the complete minimum collision/runtime-variant set |
| Ungrouped forms could be readiness-gated accidentally | Classified them compatibility-only with manifest/readiness bypass and representative coupled/dynamic regressions |

### Independent Catalog Runtime Audit Disposition

| Finding | Resolution in this revision |
|---|---|
| Catalog edit is currently inferred as create because initial values omit `id` | Added explicit `formOperation`/`resourceId`; policy-enabled updates require both and catalog edit has a dedicated regression |
| Edit policy could affect the compound create workflow | Canonical surface includes topology + operation; first adopter is update-only and create remains fail-closed until its domain adapter exists |
| Registry id/route/method does not prove preservation semantics | Replaced identity-only matching with provider-published `crud-form-sections/v1` capabilities covering modes, paths, action surfaces, operation, and round trip |
| Product command replaces the complete metadata object | Required server-side authorized-leaf merge against the scoped locked record, including a concurrent hidden-leaf preservation test |
| SEO widget remains active when details is hidden | Added generated dependency/data-contract facts and fail-closed resolution unless the widget is disabled or the replacement satisfies its contract |
| Shared `CrudForm`/bootstrap change lacked frontend boundary controls | Added the required server/client map, `"use client"` ledger, provider/blob guardrails, budgets, hydration tests, boundary check, bundle delta, and RSS evidence |
| Independent actions could still match only by surface id | Capability now embeds the full action contract; generation checks it against the actual provider and fingerprints its canonical form |
| Catalog create/edit roots were incorrectly described as server components | Corrected both as existing client roots, added ledger rows, capped each at 20 LOC of wiring, and extracted descriptors/capabilities into a pure route-local module |
| Independent actions had no way to propagate the policy token | Added `runSectionMutation` plus immutable bound API/CRUD clients to group/widget context, with action/resource binding, server rejection, and concurrency tests |
| Static display-only additions would need a fake backend handler | Added a bootstrap-validated declarative `section-policy` provider limited to display-only additions; it cannot satisfy hide/replace/write/read/action modes |
| Existing scoped-header stack merges overlapping async scopes | Section-policy tokens never use ambient scope; submit/delete/action callbacks receive distinct immutable request-bound clients and overlap tests assert request isolation |
| Parent/child lock and protected-policy header precedence was ambiguous | Defined two-class merging: policy keys are immutable/applied last; a declared child binding replaces the parent lock for only that request; exact emitted headers are tested |
| Delete conflicted with a create/update-only form mode | Separated stable `formOperation` from per-request operation; delete is constructed after `onBeforeDelete` with its own declared capability, resource/version, and bound client |
| Details omitted attachment upload/delete actions | Added lock-exempt attachment mutation surfaces, actual-provider matching, bound façade wiring, and hide/replace tests |
| Shared endpoints could not reject an absent policy token without breaking legacy callers | Added mandatory-token policy façades that delegate to unchanged shared domain operations; narrowed the guarantee to those façades |
| Repo-wide host binding and nested-offer locking were independently deployable scope | Kept generated inventory/diagnostics here, moved every non-proof host (including remaining catalog forms) to a separate rollout, and removed nested-offer concurrency hardening from this contract |

## 📋 Final Compliance Report — 2026-10-09

| Area | Status | Evidence |
|---|---|---|
| Canonical mechanisms | ✅ | Reuses UMES widget/component/placement/lifecycle, unified overrides, facts, enrichers/interceptors/guards, and extension headers. |
| Backend coherence | ✅ | Mandatory semantic provider capabilities, post-override server validation, operation/resource-bound fingerprint, fail-closed base fallback. |
| Validation/data safety | ✅ | Active validation/custom-field projection, key-path payload ownership, domain secondary-write/action-surface descriptors, and existing child-lock preservation. |
| Backward compatibility | ✅ | Additive types/props/facts; no existing prop, handle, spot, id, or override behavior changes. |
| System coverage | ✅ | SHA-labelled AST snapshot of 131 renderer files / 139 invocations and all 102 grouped invocations; 59 syntactically hosted, 43 unbound, dynamic hosts/runtime variants/complex migrations/ungrouped compatibility explicitly routed; merge-head regeneration is normative. |
| Integration coverage | ✅ | Configured build-time policy, create/edit isolation, UI, save, metadata concurrency preservation, widget dependencies/disablement, readiness, mismatch, and cleanup are required. |
| Frontend architecture | ✅ | Server/client map, client ledger, focused resolver/provider scope, hard budgets, boundary/build/bundle/RSS evidence, and hydration tests are specified. |
| Scope cohesion | ✅ | One capability: coherent section composition. Catalog is the first adopter/proof, not a parallel mechanism. |

## 📋 Changelog

- **2026-10-09 — Review/autofix generalization.** Reframed the catalog-only hidden policy as a generic add/hide/replace `CrudForm` contract built from existing UMES primitives. Added mandatory semantic backend capabilities and fail-closed server resolution, policy-bound façades, exact legal operation/resource/dynamic-host/runtime-variant surface identity, active validation/custom-field projection, server-owned nested payload preservation, widget dependency graphs, bootstrap readiness, the Frontend Architecture Contract, configured-app browser coverage, a merge-head-gated AST inventory with all complex migrations routed, catalog attachment/option/variant action surfaces, and explicit disposition of every review finding. Kept remaining-host physical adoption and nested-offer concurrency hardening as separate rollouts.
- **2026-09-30 — Initial specification.** Proposed a catalog product hidden-section policy and corrected the original component-extraction and unconfigured-browser-test assumptions.
