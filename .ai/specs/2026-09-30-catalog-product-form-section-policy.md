# CrudForm section overrides — generic add, hide, and replace contract

## 📝 TLDR

Open Mercato already has most of this capability in separate UMES primitives: injection widgets can add grouped cards, `hiddenGroupIds` can hide a card for presentation, component handles can replace a section component, response enrichers can load extension data, and widget lifecycle handlers plus API/command interceptors can save it. What is missing is one contract that resolves those pieces together and refuses to apply a visual change when its validation and persistence behavior is unresolved.

This specification adds a generic, server-resolved `CrudForm` section contract for every bound form host variant. An app can add, hide, or replace a section through `entry.overrides.forms.sections`; the UI and submit pipeline consume the same resolved descriptor list, and each operation is activated only when its exact post-override backend requirements are present. The catalog product edit form is the first high-risk adopter and the proof that hidden values, custom fields, metadata subkeys, secondary writes, optimistic locking, and configured-app browser behavior remain coherent.

The original FR remains [#6686](https://github.com/open-mercato/open-mercato/issues/6686). The design is generalized because a catalog-only policy would duplicate UMES and leave every other `CrudForm` with the same unsafe gap.

## 📝 Overview

The capability has four layers:

1. **Existing UMES contributions remain the implementation units.** Injection widgets render added/replacement sections and reuse `WidgetInjectionEventHandlers`; response enrichers load data; API/command interceptors or mutation guards own backend validation and persistence changes; `InjectionPlacement` orders contributions; `ComponentReplacementHandles.section` renders replacements.
2. **A generic resolver composes them.** `useResolvedCrudFormSections({ hostId, formVariant, baseSections })` returns `pending | ready | failed` plus one ordered descriptor list. Rendering, local validation, payload projection, and host-owned writes all iterate that same list.
3. **The server authorizes the composition.** Section contributions declare exact backend requirements and a `roundTripId`. The final post-override registries are checked at generation and server bootstrap. Only accepted operations reach the client manifest; unresolved operations fail closed.
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
- Make UI activation contingent on an exact backend companion after all overrides are composed.
- Give every production grouped-form invocation a resolved host, stable variant, and generated adoption status.
- Keep no-override business behavior equivalent; only additive manifest/round-trip metadata and child concurrency tokens may differ.
- Make catalog product edit the first complete adopter, including its custom save pipeline.

### Non-goals

- A per-record visibility-expression language, tenant setting, or role rules engine.
- Changing the presentation-only semantics of `hiddenGroupIds`.
- Treating CSS, translated titles, or DOM selectors as extension keys.
- Replacing `overrides.widgets.injection` for disabling an injected widget.
- Automatically inferring arbitrary host side effects from source code. Complex hosts declare them explicitly.

## 📝 Proposed Solution

### 1. Canonical section identity and override shape

Every eligible form reuses `CrudForm`'s existing `resolvedInjectionSpotId` precedence: explicit `injectionSpotId`, otherwise the first normalized `entityId`/`entityIds` value. It also has a stable section variant and stable section ids. The canonical override key is `<hostId>/<formVariant>/<sectionId>`.

`formVariant` distinguishes different section schemas sharing one widget scope, for example `crud-form:catalog.product/create` versus `crud-form:catalog.product/edit`. A grouped invocation may use `default` only when its resolved host has one authoritative base-section schema. When multiple invocations resolve to the same host with different group ids, generation requires an explicit additive `formVariant` prop and matching extension-host facts; it never guesses from a route or transient record state. The existing injection spot remains unchanged for widget compatibility.

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
  lifecycle?: Pick<
    WidgetInjectionEventHandlers<CrudFormSectionContext<TValues>, TValues>,
    'onBeforeSave' | 'onSave' | 'onAfterSave'
  >
}

export type CrudFormSectionContribution<TValues, TPayload> = {
  id: string
  hostId: string
  formVariant: string
  sectionId: string
  operation: 'add' | 'hide' | 'replace'
  descriptor?: CrudFormSectionDescriptor<TValues, TPayload>
  requires: CrudFormSectionBackendRequirements
}

export type CrudFormSectionMutationSurface = {
  id: string
  kind: 'api' | 'command'
  target: string
  operations: readonly {
    operation: string
    optimisticLock: 'entity-version' | 'not-applicable'
  }[]
}
```

`useResolvedCrudFormSections({ hostId, formVariant, baseSections })` returns the only section list a host variant may consume. `CrudForm` renders `descriptor.group`; validation iterates descriptor validation; payload projection merges descriptor contributions; host-owned before/after writes use the existing widget lifecycle dispatcher. Contributed UI uses the existing injection widget definition, and the group component resolves a variant-qualified `ComponentReplacementHandles.section(hostId, formVariant, sectionId)` through `useRegisteredComponent` while retaining the existing unqualified handle as a compatibility fallback for forms with one `default` variant.

Simple forms derive `ownedFieldIds` from `CrudFormGroup.fields` and use the standard CRUD payload projector. Custom-component groups or hosts with derived payloads/secondary writes provide explicit descriptors. This keeps easy forms easy without pretending that catalog/sales/workflow side effects are inferable.

`mutationSurfaces` is data-only metadata for actions initiated inside a section but outside the parent form submit, such as an option-schema dialog or variant create/delete button. Those actions keep their existing components and guarded CRUD helpers; the descriptor makes their exact entity/route/command operations and optimistic-lock expectations visible to generation, backend requirement matching, replacement compatibility, and tests. Hiding a section removes its action controls but is not an authorization revocation for the underlying endpoint.

### 3. Add and replace reuse UMES

- **Add:** a registered injection widget with `kind: 'group'` supplies UI and lifecycle behavior. `InjectionWidgetPlacement` gains the existing additive `InjectionPlacement` fields (`position`, `relativeTo`), and merging calls `insertByInjectionPlacement`.
- **Replace:** the replacement contribution targets the same canonical section key and renders through `ComponentReplacementHandles.section`. The original descriptor remains the error-boundary fallback only when the replacement's backend contract is also compatible; otherwise resolution retains the base section before render.
- **Disable an injected widget:** continue using `overrides.widgets.injection[widgetId] = null`, which already removes the component and handlers together.

No new render-widget or lifecycle system is introduced.

### 4. Backend pairing is mandatory and fail-closed

Every operation contribution declares exact requirements. Even a visual-only `hide` is represented by a headless contribution so the override must name the backend behavior that makes omission safe:

```ts
export type CrudFormSectionBackendRequirements = {
  roundTripId: string
  read?: readonly FormSectionBackendRequirement[]
  write: readonly FormSectionBackendRequirement[]
}

export type FormSectionBackendRequirement =
  | { kind: 'response-enricher'; id: string; targetEntity: string }
  | { kind: 'api-interceptor'; id: string; route: string; methods: readonly string[] }
  | { kind: 'command-interceptor'; id: string; targetCommand: string }
  | { kind: 'mutation-guard'; id: string; entityId: string; operations: readonly string[] }
```

Rules:

1. **A write-side requirement is mandatory for hide and replace.** A response enricher alone cannot prove validation/save coherence. Standard `makeCrudRoute` forms may explicitly name one shared form-section request-projection interceptor plus host data in the resolved manifest; complex hosts name a domain interceptor/guard that owns their extra writes. There is no implicit pairing based only on matching names.
2. **A writable addition also requires a write-side contribution; an addition/replacement that needs extension data additionally requires a response enricher.** Its widget `onSave` may persist through its own API, but that endpoint still needs a declared interceptor or mutation guard and the same `roundTripId`. A declared display-only addition is the only operation that may have no write requirement.
3. **Match section-local actions too.** When `mutationSurfaces` is non-empty, add/replace contributions must resolve compatible backend requirements for every action they expose, including operation and optimistic-lock semantics. Hide removes controls but does not weaken the endpoint's existing auth or lock guard.
4. **Validate the final registries, not source declarations.** Generation checks static facts; server bootstrap checks `getEnrichersForEntity`, API/command interceptor registries, and mutation guards after unified overrides. A disabled/replaced backend contribution therefore invalidates its section operation.
5. **Publish only accepted operations.** The client receives a data-only resolved manifest and fingerprint. A missing/mismatched companion retains the base section for hide/replace or omits an addition; it never applies a UI-only mutation.
6. **Bind the request to the resolved policy.** Existing `onBeforeSave.requestHeaders`, `withScopedApiRequestHeaders`, `buildExtensionHeader`, and interceptor/guard header parsing carry the policy fingerprint/round-trip token. The server rejects a stale or unrecognized token instead of accepting a differently evaluated client policy.

This is the enforcement point requested by this revision: an app author cannot hide or replace a section without a resolvable backend validation/save contribution.

The authoring path stays small. An app module registers one section contribution and its named backend handler, then selects it from `modules.ts`:

```ts
overrides: {
  forms: {
    sections: {
      'crud-form:catalog.product/edit/compliance': {
        operation: 'hide',
        contributionId: 'services.hide-product-compliance',
      },
    },
  },
}
```

The `services.hide-product-compliance` contribution fact carries the `roundTripId` and exact API/command interceptor or mutation-guard target. Generation fails if that handler is absent; server bootstrap omits the operation if it is disabled after overrides. The app author never wires a second client store or manually coordinates render and submit callbacks.

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

The catalog keeps ten stable ids:

`details`, `dimensions`, `metadata`, `options`, `product-uom`, `compliance`, `variants`, `meta`, `categorize`, `custom-fields`.

| Section | Active validation/payload/write ownership |
|---|---|
| `details` | title validation; title/description/media payload; `metadata.__useMarkdown`; variant-media fallback |
| `dimensions` | dimensions and weight payload |
| `metadata` | user metadata leaves excluding reserved `__useMarkdown` and other framework-reserved keys |
| `options` | option schema definition/id in the product payload; reads the full stored title when details is hidden; declares independent `catalog/option-schemas` create/update/delete mutation surfaces and their entity-version locks |
| `product-uom` | UoM schema/imperative checks, UoM payload, and conversion create/update/delete lifecycle |
| `compliance` | compliance-only schema projection and the 26 compliance/SEO payload keys |
| `variants` | no parent-product payload; declares independent variant create, generated-create, and delete mutation surfaces plus their feature guards and entity-version lock expectations |
| `meta` | subtitle/handle/SKU/type/tax/configurability payload |
| `categorize` | category/tag/offer payload, offer deletion, and offer snapshot merge; it may read full details values |
| `custom-fields` | custom-field definition validation, `customFieldsetCode`, and custom field payload |

Specific invariants:

- hidden compliance does not parse or submit its values, so a server-valid/client-invalid stored quantity cannot block a title edit;
- hidden custom fields are excluded before definition validation and omitted from payload;
- visible details plus hidden metadata updates only `metadata.__useMarkdown` and preserves every hidden user metadata leaf;
- visible metadata plus hidden details preserves the stored `__useMarkdown` value;
- hidden UoM runs no conversion synchronization;
- hidden categorize runs no offer deletion/update;
- offer deletes and conversion updates/deletes keep their existing child versions; existing-offer upserts add `id` plus `updatedAt` to the nested product payload and the product command enforces each offer version before mutation; creates require no prior version; the product update keeps the product version;
- hiding an action-bearing section removes its controls, while an addition/replacement that exposes equivalent actions must declare compatible backend mutation surfaces and requirements;
- with no override configured, the current business-field payload and write ordering are preserved; only declared manifest/round-trip metadata and existing-offer concurrency fields are additive.

## 📝 Architecture and Contract Surfaces

| Area | Change |
|---|---|
| `packages/shared/src/modules/overrides.ts` | Add `forms.sections` and compose it with existing override helpers |
| `packages/shared/src/modules/widgets/injection.ts` | Add `InjectionPlacement` fields to group placement; add optional section requirement metadata |
| `packages/shared/src/modules/widgets/extension-points.ts` | Add optional host variants and project exact section/round-trip requirements into additive contribution facts |
| `packages/ui/src/backend/CrudForm.tsx` | Reuse `resolvedInjectionSpotId`, accept optional stable `formVariant`, resolve descriptors once, gate readiness, and use active validation/custom-field/payload projections |
| `packages/ui/src/backend/injection/` | Generic resolver and section component adapter built on current widget/component registries |
| server bootstrap + interceptor registries | Validate post-override requirements and publish accepted manifest/fingerprint |
| CLI module facts/generators | Emit host variants/sections, override keys, requirements, diagnostics, and per-invocation coverage failures |
| docs/create-app harness | Document and prove the app-module recipe |
| catalog product edit | Domain descriptors and first full adoption |

Additive stable surfaces:

- `ModuleOverrides.forms.sections`;
- canonical host/variant/section keys and the optional additive `CrudForm.formVariant` prop;
- `CrudFormSectionDescriptor` and resolver result;
- optional placement/requirement fact fields;
- catalog product section ids, already protected as built-in group ids.

Nothing is removed or renamed. Existing `CrudForm` props, spot ids, component handles, override keys, and widget behavior remain compatible. The deprecation protocol applies to any later rename/removal of a host or section id.

### Migration & Backward Compatibility

This is an additive contract. Existing forms need no migration and continue to use their current `groups`, `hiddenGroupIds`, injection widgets, validation, and submit callbacks until they opt into section descriptors. Existing injection-widget disablement remains under `overrides.widgets.injection`; it is not translated into `forms.sections`. Catalog's nested offer input additively accepts optional `id`/`updatedAt`; legacy callers that omit them retain the current channel-matching behavior, while the product edit adopter always sends and enforces them for existing offers.

Newly published host ids, form variants, built-in section ids, contribution ids, `roundTripId` values, and documented imports become stable extension surfaces. They cannot later be renamed or removed without the repository deprecation protocol, an `UPGRADE_NOTES.md` bridge, and dual acceptance for at least one minor release. Optional fields may be added to descriptors, facts, manifests, and override objects, but existing required fields and operation meanings cannot be narrowed.

Adoption is fail-closed rather than flag-day: generation inventories every grouped invocation, but only unambiguous host variants with complete descriptors and validated backend requirements advertise add/hide/replace support. A custom invocation that is not ready continues to render and save exactly as before. No stored setting, database migration, or data rewrite is involved, so rollback restores the complete base form without transforming records.

## 📝 Data Models

No database entity, column, relation, index, migration, or tenant-owned setting is added. The new models are typed runtime/build artifacts only:

- base and contributed section descriptors;
- the composed override map;
- generated extension facts and diagnostics;
- the server-approved data-only manifest and fingerprint.

The manifest contains host id, form variant, section/contribution ids, placement, supported operations, exact backend requirement identities, and a content fingerprint. It contains no functions, record values, credentials, tenant data, or user data. Widget components and backend handlers continue to load from their existing registries.

## 📝 API Contracts

No endpoint URL or response changes shape. The product-update request schema additively accepts `offers[].id` and `offers[].updatedAt`; when supplied, `syncOffers` resolves that exact tenant/organization-scoped offer and enforces its version before mutation. The catalog product form supplies both for every existing offer. Omitted versions keep the current legacy behavior for backward compatibility rather than silently making the new form unversioned.

The platform bootstrap contract additively exposes the approved section manifest/fingerprint to the client, and mutated requests carry one existing `x-om-ext-*` extension header containing the resolved round-trip identity. The shared projection interceptor or host-specific guard verifies that identity before request validation/save logic proceeds.

The header is not an authorization credential. Authentication, feature guards, tenant/organization scoping, optimistic locking, route schemas, and command invariants remain authoritative. A valid user cannot activate a policy the server did not resolve for the current application build.

## 📝 UI/UX

- No policy: the current form renders immediately and unchanged.
- Valid policy still bootstrapping: the form body shows the standard `LoadingMessage`; actions are unavailable.
- Valid resolved policy: added/replaced/hidden cards occupy the resolved placement with existing group layout, collapse, ordering, autofocus, and accessibility behavior.
- Settled policy failure: the complete base form renders with an internal diagnostic; users are never shown a half-customized form.
- Unknown/stale ids never white-screen the page and never silently activate.

No new design-system primitive or user-facing configuration UI is introduced. Developer diagnostics use structured logging; public documentation and generated facts are the authoring interface.

## 📝 System-wide CrudForm Adoption Audit

Audit scope: production TSX under `apps/mercato/src/modules`, `packages/*/src/modules`, and `external/official-modules`, excluding tests, generated fixtures, docs, and create-app mirrors. The audit parses JSX with `@babel/parser`; raw text matching is invalid because it counted the `<CrudForm>` text in a staff comment as a renderer.

- 124 source files contain an actual `CrudForm` JSX invocation.
- 132 `CrudForm` invocations exist in those files.
- 98 grouped invocations exist across 94 files and therefore enter this contract audit.
- 57 grouped invocations already resolve a widget host through the same precedence as `CrudForm`: `injectionSpotId`, then `entityId`/the first `entityIds` value.
- 41 grouped invocations have none of those inputs and need an explicit `injectionSpotId` before section overrides can target them.

Coverage is per JSX invocation, not per file. Every grouped invocation is checked by generation and classified as:

- **standard:** group field ids plus a single CRUD mutation; it can use the shared projection interceptor;
- **custom:** custom group components, derived payloads, multiple API calls, or secondary writes; it must supply explicit descriptors and domain backend requirements;
- **unbound:** no `resolvedInjectionSpotId`; overrides are unavailable until an explicit spot is added;
- **ambiguous variant:** the host resolves, but another invocation at that host declares a different base-section set without a stable `formVariant`; overrides are unavailable until variants are declared.

| Source family | Grouped invocations | Resolved host | Unbound |
|---|---:|---:|---:|
| `apps/mercato/src/modules/example` | 3 | 3 | 0 |
| `packages/checkout/src/modules/checkout` | 1 | 1 | 0 |
| `packages/core/src/modules/api_keys` | 1 | 0 | 1 |
| `packages/core/src/modules/attachments` | 1 | 1 | 0 |
| `packages/core/src/modules/auth` | 4 | 4 | 0 |
| `packages/core/src/modules/business_rules` | 5 | 0 | 5 |
| `packages/core/src/modules/catalog` | 8 | 8 | 0 |
| `packages/core/src/modules/currencies` | 4 | 0 | 4 |
| `packages/core/src/modules/customer_accounts` | 2 | 1 | 1 |
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

The exact 41 unbound invocations are:

- `packages/core/src/modules/api_keys/backend/api-keys/create/page.tsx:154`
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

Resolved does not imply unambiguous. Catalog product create/edit share `crud-form:catalog.product` but expose different group sets; `TodoForm` create/edit likewise share one entity-derived spot while exposing `tips` versus `actions`. Generator facts therefore key base sections by `(resolvedInjectionSpotId, formVariant)` and reject a host whose differing schemas still collide on `default`.

The implementation must generate the exact invocation/host/variant/section inventory so this hand-written snapshot cannot silently drift. New grouped invocations without a resolved spot, new collisions without variants, or missing section facts fail the repository coverage test.

## 📝 Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Policy pending during client bootstrap | Render loading state; no editable form and no submit |
| Client bootstrap settles failed | Render full base form; report diagnostic; no partial override |
| Backend companion missing/disabled/replaced incompatibly | Retain base for hide/replace or omit addition; fail generation/bootstrap diagnostics |
| Client and server manifests differ | Server rejects the round-trip token; no mutation |
| Unknown host/section/contribution id | Ignore operation, keep base, emit actionable diagnostic with valid ids |
| Two invocations share a host but expose different groups | Require distinct stable `formVariant` values; reject both override surfaces while ambiguous |
| Two modules replace one section | Existing precedence applies; warn with both module ids |
| Added widget is disabled through widget overrides | Section contribution becomes unresolved and is omitted with its handlers |
| Hidden section owns required custom fields | Definitions are excluded before validation; values omitted and preserved server-side |
| One object has leaves owned by two sections | Deep-merge non-conflicting leaves; preserve hidden leaves; collision fails tests/dev resolution |
| Create form hides a server-required field | Operation rejected unless its write interceptor supplies/derives a valid value for `create` |
| All sections hidden | Form body may render empty, but submit is disabled unless the resolved backend contract explicitly permits a no-op mutation |
| Secondary child writes | Descriptor controls whether submit-coupled writes run; update/delete operations enforce each child's own version, including nested offer upserts |
| Section-local immediate actions | Descriptor facts list their exact mutation surfaces; hide removes controls, and add/replace activates only with compatible backend requirements |

## 📝 Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Default behavior regresses across 98 grouped invocations | High | All grouped `CrudForm` rendering/submission | Resolver empty-policy identity fast path, behavior-equivalence tests, generated invocation inventory, phased verification | Undetected host-specific callback coupling; constrained by per-family tests and fail-closed enablement |
| Two schemas share one injection spot | High | Create/edit and multi-dialog hosts | Stable `formVariant`, variant-qualified facts/keys/handles, and generation failure on differing `default` schemas | Authors must preserve variants as public ids after publication |
| UI/backend module gating diverges | High | Validation and persistence | Server-resolved manifest, final-registry validation, fingerprint header, base fallback | In-flight deploy skew can reject a save; rejection is safer than silent corruption and is retryable after refresh |
| Field/payload ownership is incomplete | High | Host schemas and mutation payloads | Generated group-field coverage, explicit custom-component ownership, leaf-collision diagnostics, per-host tests | Cross-section derived reads still require domain review |
| Side effects run for hidden sections | High | Complex hosts with multiple writes | Explicit domain descriptors and backend requirements; never classify detected multiple-write hosts as standard | Runtime-indirect writes may evade static classification; those hosts remain unsupported until explicitly audited |
| Section-local dialog/button mutations are absent from host facts | High | Action-bearing custom groups | Descriptor `mutationSurfaces`, exact backend matching, and configured replacement action tests | New indirect actions still require generator coverage and domain review |
| Nested offer upserts overwrite concurrent edits | High | Catalog product/channel offers | Product form sends offer `id`/`updatedAt`; command enforces supplied child versions; regression tests cover conflict and create | Legacy API callers without the additive version remain on existing behavior until a separately deprecated tightening |
| Public override/section ids drift | Medium | Third-party modules | Stable facts, docs, compatibility tests, deprecation protocol | Intentional future migrations still require a bridge release |
| Adoption becomes a flag-day migration | Medium | Delivery scope and module owners | Bind/inventory all hosts, enable catalog first, keep other complex hosts fail-closed until adapters land | Some forms remain non-customizable initially, but retain current safe behavior |

Rollback removes the forms override resolver and catalog adopter. There is no migration or stored policy; apps fall back to the complete base form. Existing widgets, fields, and `hiddenGroupIds` continue working.

## 📋 Phasing

1. **Framework contract and server resolution.** Types, override composition, facts, post-override backend checks, resolved manifest, fingerprint header.
2. **CrudForm integration.** One resolver/list for render and submit, readiness gating, validation/custom-field/payload projection, UMES add/replace adapters.
3. **Invocation inventory and canonical bindings.** Generated coverage for all 98 grouped invocations; bind the 41 genuinely unbound invocations, declare variants for shared-host schema collisions, and classify standard vs custom without enabling unsafe hide/replace.
4. **Catalog product first adopter.** Ten domain descriptors, corrected validation/payload ownership, side-effect control.
5. **Configured-app proof, docs, and standalone harness.** Real build-time override through browser and backend.

Each phase leaves the default application working. A host cannot advertise add/hide/replace readiness until its backend requirements pass.

## 📋 Implementation Plan

### Phase 1 — generic contract

1. Add `forms.sections` to `ModuleOverrides` and the domain union. Compose with existing store/array helpers; preserve `null` as “disable this customization and restore base” plus existing precedence.
2. Extend injection group placement with `position`/`relativeTo`; reuse `insertByInjectionPlacement`.
3. Add form-variant, section, action-surface, and backend-requirement fields to extension contribution facts, including `roundTripId` and exact targets.
4. Add generator validation that every section operation resolves a UI contribution and mandatory write-side backend contribution after overrides; add static diagnostics and coverage tests.
5. Add server bootstrap validation against final enricher/interceptor/guard registries and expose only the accepted data-only manifest plus fingerprint.
6. Carry the fingerprint via existing injection request-header aggregation and reject unknown/stale values in the standard projection interceptor/host guard.

### Phase 2 — CrudForm integration

7. Implement `useResolvedCrudFormSections` with `hostId`, `formVariant`, `pending | ready | failed`, no separate global store, and an empty-policy identity fast path.
8. Resolve group UI through existing injection widgets and `ComponentReplacementHandles.section`; add an error-boundary fallback only for already-authorized replacements.
9. Derive active field/custom-field definitions and validate only active sections. Keep full values read-only for cross-section reads.
10. Deep-merge active payload contributions; fail on duplicate leaf ownership; run section lifecycle through existing widget event dispatch.
11. Add framework tests: add/before/after, hide, replace, widget disable, missing companion, override precedence, delayed bootstrap, settled failure, manifest mismatch, custom fields, all-hidden, shared-host variant isolation/collision, and no-override behavior equivalence.

### Phase 3 — all host discovery

12. Generate the 98-invocation inventory and add canonical extension declarations for every grouped form. Reuse the 57 existing resolved spots (including `entityIds`), add explicit spots only to the 41 unbound invocations listed above, add stable variants where one spot has differing group schemas, and mirror template-owned app files where required.
13. Auto-classify only single-mutation field-group forms as standard. Require explicit domain descriptors for custom components, derived payloads, multiple API calls, or secondary writes; coverage fails if such a host is marked standard.
14. Emit module facts with exact host ids, stable form variants and section ids, supported operations, backend requirements, source invocation, and diagnostics. Refresh the standalone framework facts.

### Phase 4 — catalog product edit

15. Create catalog product section descriptors using the corrected ownership table, including option-schema and variant immediate-action mutation surfaces. Keep current group components in place; do not perform the previously proposed 1,400-line component move.
16. Split client validation by active section. Add the server-valid/client-invalid `minOrderQty=100000001` regression and hidden required-custom-field regression.
17. Implement key-path payload contribution and nested metadata merging. Test details-visible/metadata-hidden and metadata-visible/details-hidden save/reload cases.
18. Move conversion sync, offer deletion/payload, and other submit-coupled writes behind their owning descriptors. Retain current per-child headers for offer deletes and conversion updates/deletes; add optional `id`/`updatedAt` to the nested offer input, have this form send both, and enforce each supplied version against the scoped offer inside `syncOffers` while preserving legacy unversioned callers. Add action-surface/lock tests for option-schema and variant create/update/delete operations without moving those immediate actions into form submit.
19. Prove the no-policy path produces the same product business-field payload and child-write order as the pre-refactor implementation, apart from declared section round-trip metadata and nested existing-offer `updatedAt` tokens.

### Phase 5 — configured build and docs

20. Add a self-contained configured fixture app/module whose `modules.ts` hides compliance/UoM, replaces an action-bearing built-in section (`options` or `variants`), adds one section, and disables an injected widget through `overrides.widgets.injection`.
21. In Playwright against that built fixture, assert absent/replaced/added cards, action controls supplied only by the authorized replacement, one replacement action reaching its declared guarded target, delayed-bootstrap submit blocking, visible-field save, preservation of compliance/conversions/custom fields, metadata leaf behavior, disabled widget handlers, and manifest-mismatch rejection. Create and clean up all records.
22. Add API/integration tests for omission-preserves vs explicit-null-clears and exact round-trip enforcement.
23. Document the generic recipe, form variants, requirement pairing, failure behavior, stable catalog ids, and the distinction among `hiddenGroupIds`, `forms.sections`, and `widgets.injection`.
24. Update `BACKWARD_COMPATIBILITY.md`, the unified-overrides status table, package guidance, template mirrors, and run the standalone-harness refresh with a failure-first case.

## 📋 Acceptance Criteria

| # | Criterion |
|---|---|
| AC1 | Every production grouped `CrudForm` invocation appears in generated facts with a resolved host and unambiguous stable variant, or an explicit blocking diagnostic. |
| AC2 | An app can add, hide, and replace sections without copying a host page. |
| AC3 | Add/replace reuse injection widgets, section component handles, placement, and lifecycle primitives; no parallel widget system exists. |
| AC4 | Hide/replace never activates without an exact write-side interceptor/command-interceptor/mutation-guard requirement; additions needing data also require an enricher. |
| AC5 | Missing or mismatched backend contributions keep the base UI and block the custom policy rather than applying client-only behavior. |
| AC6 | Rendering, validation, payload projection, and side effects consume one resolved descriptor list. |
| AC7 | Pending bootstrap cannot expose or submit the unmodified form; settled failure shows the complete base form. |
| AC8 | Hidden fields and hidden custom-field definitions cannot cause unreachable client validation errors. |
| AC9 | Hidden values and nested payload leaves are preserved; explicit visible clears still clear. |
| AC10 | Catalog compliance, conversions, offers, custom fields, metadata/`__useMarkdown`, and optimistic locks satisfy the invariants above. |
| AC11 | A policy-configured fixture build exercises the real `modules.ts` → client UI → backend interceptor/guard round trip in Playwright. |
| AC12 | With no override configured, rendering, business fields, write order, and current tests remain behavior-equivalent; differences are limited to declared section round-trip metadata and child concurrency tokens. |
| AC13 | Existing `hiddenGroupIds` and `overrides.widgets.injection` behavior remains unchanged and documented. |
| AC14 | Action-bearing sections publish exact mutation surfaces; add/replace actions activate only with compatible backend requirements, while hide removes controls without weakening endpoint authorization. |
| AC15 | Catalog product edits carry and enforce the version of every existing nested offer they upsert; conflict and legacy-compatibility behavior are both tested. |

## Resolved assumptions (autonomous defaults)

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| Q1 | New client policy store or UMES composition? | Compose existing UMES/override registries. | Smaller surface and prevents two precedence/bootstrap models. |
| Q2 | Can UI-only hide/replace be allowed with a warning? | No; fail closed and retain base. | A warning cannot prevent validation/data divergence. |
| Q3 | Is an enricher alone enough? | No for writes. Hide/replace require a write-side interceptor/guard; an enricher is additionally required when data loading changes. | Read enrichment cannot override validation or persistence. |
| Q4 | Parse restored hidden values through the host schema? | No. Validate the active projection; expose full loaded values only for cross-section reads. | Fixes server-valid/client-invalid invisible values while keeping server authority. |
| Q5 | Replace the whole catalog page or extract all inline components? | Neither. Add descriptors around current groups and resolve their section handles. | Avoids page coupling and an unrelated 1,400-line move. |
| Q6 | Enable every complex host immediately? | Bind and inventory all; enable only when explicit backend requirements resolve. | Universal mechanism with fail-closed incremental adoption is safer than guessed side-effect ownership. |
| Q7 | Use a new section host id or the existing injection identity? | Reuse `resolvedInjectionSpotId`; add `formVariant` only to distinguish different section schemas at one spot. | Preserves UMES widget scope, respects `entityIds`, and prevents create/edit collisions without redundant ids. |

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
| Existing offer upserts lacked the claimed child lock | Additive nested `id`/`updatedAt`, scoped enforcement for supplied versions, conflict tests, and explicit legacy compatibility |
| Compliance payload count was stale | Corrected from 23 to the current 26 keys |
| Inventory counted files/comments instead of JSX invocations | Replaced with a reproduced Babel AST audit: 124 renderer files, 132 invocations, 98 grouped invocations across 94 files |
| Existing `entityIds` host resolution was ignored | Canonical identity now reuses `resolvedInjectionSpotId`; 57 are resolved and only 41 need a new spot |
| One spot can expose multiple section schemas | Added stable `formVariant` to addresses, facts, manifests, handles, diagnostics, coverage, and tests |

## 📋 Final Compliance Report — 2026-10-09

| Area | Status | Evidence |
|---|---|---|
| Canonical mechanisms | ✅ | Reuses UMES widget/component/placement/lifecycle, unified overrides, facts, enrichers/interceptors/guards, and extension headers. |
| Backend coherence | ✅ | Mandatory exact requirements, post-override server validation, manifest fingerprint, fail-closed base fallback. |
| Validation/data safety | ✅ | Active validation/custom-field projection, key-path payload ownership, domain secondary-write/action-surface descriptors, and nested offer version enforcement. |
| Backward compatibility | ✅ | Additive types/props/facts; no existing prop, handle, spot, id, or override behavior changes. |
| System coverage | ✅ | AST-audited 124 renderer files / 132 invocations and all 98 grouped invocations; 57 resolve through current UMES inputs, 41 unbound invocations and shared-host variant collisions are explicitly routed. |
| Integration coverage | ✅ | Configured build-time policy, UI, save, persistence, widget-disable, readiness, mismatch, and cleanup are required. |
| Scope cohesion | ✅ | One capability: coherent section composition. Catalog is the first adopter/proof, not a parallel mechanism. |

## 📋 Changelog

- **2026-10-09 — Review/autofix generalization.** Reframed the catalog-only hidden policy as a generic add/hide/replace `CrudForm` contract built from existing UMES primitives. Added mandatory backend requirements and fail-closed server resolution, active validation/custom-field projection, nested payload ownership, bootstrap readiness, configured-app browser coverage, an AST audit of all 98 grouped invocations, host variants for shared widget scopes, catalog action surfaces/nested-offer locking, and explicit disposition of every prior review finding.
- **2026-09-30 — Initial specification.** Proposed a catalog product hidden-section policy and corrected the original component-extraction and unconfigured-browser-test assumptions.
