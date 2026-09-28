# Calendar Event Type Extensions

**Status:** Proposed  
**Issue:** [#6684](https://github.com/open-mercato/open-mercato/issues/6684)  
**Related:** [CRM Calendar](./2026-06-11-crm-calendar.md), [Configurable Calendar Event Types](./2026-09-28-configurable-calendar-event-types.md), [Calendar Event Type React Panels](./2026-09-28-calendar-event-type-react-panels.md)

## TLDR

Allow enabled modules and downstream apps to add, patch, disable, replace, or programmatically alter calendar event types without importing into or forking the customers module. The extension model deliberately matches AI module extensibility: co-located base/override/extension exports, `modules.ts` inline overrides, programmatic APIs, deterministic tier precedence, `null` disablement, generated registry exports, runtime introspection, and stable validation rules. This spec also owns the canonical customers calendar-type foundation—the six definitions, schema, resolver, minimal read API, editor transport, and interaction validation—so contributed keys work before either companion capability ships. A separate companion spec defines optional React panels through the existing UI component override system.

Persisted `CustomerInteraction.interactionType` strings remain durable. A module disappearing hides its types from new selection but historical records still open through a safe fallback.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Why | Confirm? |
|---|---|---|---|---|
| Q1 | Should module extensions share the administrator-configuration spec? | No; publish a linked companion spec over this spec's foundation. | A fresh-context review found separately reviewable capabilities with one canonical prerequisite. | Reversible |
| Q2 | What does a module “delete” mean? | A `null` tombstone hides a key from new selection only. | Modules must not delete dictionary rows or rewrite historical interactions. | Reversible |
| Q3 | Should event-type extensibility offer every AI module authoring tier? | Yes: co-located base/override/extension exports, `modules.ts`, and programmatic APIs. | Explicit maintainer direction; shared semantics reduce framework surprise. | Confirmed |

## Goals and non-goals

### Goals

- Discover module-owned type definitions and overrides through generated enabled-module facts.
- Match the AI registry's base → file override/extension → `modules.ts` → programmatic extensibility options and semantics.
- Compose contributions deterministically with provenance, collision diagnostics, runtime snapshots, and process-global idempotent registration.
- Deliver the effective static catalog to the existing client editor and validate persisted interaction keys against the same resolver.
- Preserve host-owned validation, storage, interaction mutation guards, and optimistic locking.
- Degrade gracefully when an optional contributing module is disabled.

### Non-goals

- Tenant/admin configuration; the linked configurable-types spec owns that overlay.
- React panel replacement or wrapping; the linked optional React-panels spec owns that capability after this foundation lands.
- Direct ORM relations from customers to optional modules.
- Renaming stored interaction type values.

## User stories and acceptance criteria

### US-B1 — Contribute a vertical type

As an HRM module author, I want to contribute a `site-visit` type with visit semantics so CRM users can schedule it without a customers fork.

- An enabled module can add a stable-key definition through `calendar-event-types.ts`.
- Generation fails on duplicate base definitions and identifies both owners.
- The exact key is selectable and persists byte-for-byte.
- Disabling the module removes the type from new selection but historical records still render/edit through fallback.

### US-B2 — Replace, disable, or patch an existing type

As a module author, I want to extend or hide a core/contributed type when my module is enabled.

- A non-null override is a complete replacement whose `key` must match its map key; `null` disables selection without deleting data.
- An extension changes only declared properties and supports explicit replace/delete/append operations for `customFieldsetIds`.
- Extensions apply after full overrides, cannot resurrect a missing/disabled definition, and use replace → delete → append order like AI agent extensions.
- File exports, `modules.ts` inline configuration, and programmatic APIs expose equivalent override and extension capabilities.
- Resolution order, winning provenance, skipped entries, and runtime snapshots are observable and pinned by tests.

### US-B3 — Configure extensions at the app or bootstrap tier

As a downstream app owner, I want the same choice AI provides between a reusable module export, app-local `modules.ts` configuration, and dynamic boot-time code.

- `ModuleEntry.overrides.calendar.eventTypes` accepts full replacements or `null` by stable key.
- `ModuleEntry.overrides.calendar.extensions` accepts the same normalized extension records as file exports.
- Public `applyCalendarEventTypeOverrides()` and `applyCalendarEventTypeExtensions()` functions provide the highest-precedence boot/test tier.
- A non-null override for a missing key creates a synthetic definition with a warning; `null` for a missing key is a no-op.
- No override source mutates another module's source, dictionary rows, or persisted interactions.

## Market reference

- [Backstage extension overrides](https://backstage.io/docs/frontend-system/architecture/extension-overrides/) separates configuration, wrappers, and replacements. Adopt the explicit wrapper/replace model and deterministic ownership diagnostics.
- [Odoo CRM activity types](https://www.odoo.com/documentation/19.0/applications/sales/crm/optimize/utilize_activities.html) shows why installed applications need vertical activity types. Adopt module contributions while avoiding direct app-to-CRM imports.

## Architecture

```text
enabled modules
  └── calendar-event-types.ts
       └── customers generator plugin
            └── calendar-event-types.generated.ts
                 └── registerCalendarEventTypeEntries()
                      └── process-global normalized registry
                           ├── file overrides + extensions
modules.ts overrides.calendar ─┤
programmatic apply* APIs ───────┘
                           └── resolve base + replacement/tombstone + extensions
                                ├── GET /api/customers/activity-types
                                ├── CalendarEventEditor
                                ├── interaction create/update validation
                                └── optional admin overlay from companion spec
```

The registry is metadata, not a second interaction store. Customers owns the host and resolver. Contributors declare facts at build time. No runtime import from customers to HRM or another optional peer is permitted.

### Canonical foundation ownership

This spec is the single owner of `CalendarEventBaseKind`, `CalendarEventTypeBehavior`, the immutable six-type baseline, `EffectiveCalendarEventType`, the compatibility fallback, `resolveCalendarEventTypes()`, and the minimal `GET /api/customers/activity-types` contract. Those contracts live in the customers public path even when there are zero contributed modules.

The configurable-types companion imports and enriches this foundation with scoped dictionary overlays; it MUST NOT redeclare the schema, baseline, endpoint, or resolver. Its implementation therefore follows this spec's foundation phase, while the extension registry itself remains optional at runtime. The React-panels companion consumes the same public effective-definition type and can treat absent `panelKey` as the default panel. This ordering removes duplicate ownership and permits the static registry to ship and function on its own.

### Module isolation and optionality

This is inversion of control, not a reverse business-module dependency. Customers owns the public contract and generator plugin but never imports, resolves, or hard-requires a contributor. A contributor may use `import type` from the stable customers public path; its declaration remains serializable and contains no customer entity, service, or component import. The generated bootstrap joins enabled declarations to the host registry.

- A general module that only optionally enriches CRM MUST NOT declare `requires: ['customers']`; when customers is disabled its generator plugin is absent, the convention is not scanned, and stale generated output is reconciled away.
- An app-only module whose sole purpose is CRM customization MAY explicitly declare `requires: ['customers']`; that is an intentional hard product dependency, not hidden coupling.
- Runtime access to an optional peer service still uses a local `tryResolve()` and no-ops when absent. This spec itself needs no cross-module service call.
- Durable cross-module data uses custom fields or an extension entity with FK IDs/snapshots, never a direct ORM relationship.
- `packages/core/src/__tests__/module-decoupling.test.ts` covers both the contributor-absent and customers-absent graphs.

## Public registry contract

The public contract lives at `@open-mercato/core/modules/customers/calendar-event-types`:

```ts
type CalendarEventBaseKind = 'meeting' | 'call' | 'email' | 'note' | 'event' | 'task'

type CalendarEventTypeBehavior = {
  schemaVersion: 1
  baseKind: CalendarEventBaseKind
  selectable: boolean
  order: number
  fields: {
    endTime: boolean
    allDay: boolean
    recurrence: boolean
    location: 'none' | 'location' | 'phoneLink'
    people: 'none' | 'attendees' | 'participants' | 'recipients' | 'assignee'
    priority: boolean
    resources: boolean
  }
  customFieldsetIds: string[]
}

type CalendarEventTypeDefinition = {
  key: string
  label: string
  labelKey?: string
  icon?: string | null
  color?: string | null
  behavior: CalendarEventTypeBehavior
  adminConfigurable?: boolean
  panelKey?: string
}

type CalendarEventTypeOverridesMap = Record<
  string,
  CalendarEventTypeDefinition | null
>

type CalendarEventTypeExtension = {
  targetEventTypeKey: string
  replaceLabel?: string
  replaceLabelKey?: string | null
  replaceIcon?: string | null
  replaceColor?: string | null
  replaceBaseKind?: CalendarEventBaseKind
  replaceSelectable?: boolean
  replaceOrder?: number
  replaceFields?: Partial<CalendarEventTypeBehavior['fields']>
  replaceAdminConfigurable?: boolean
  replacePanelKey?: string | null
  replaceCustomFieldsetIds?: string[]
  deleteCustomFieldsetIds?: string[]
  appendCustomFieldsetIds?: string[]
}

export const calendarEventTypes: CalendarEventTypeDefinition[]
export const calendarEventTypeOverrides: CalendarEventTypeOverridesMap
export const calendarEventTypeExtensions: CalendarEventTypeExtension[]

export function defineCalendarEventTypeExtension(
  extension: CalendarEventTypeExtension,
): CalendarEventTypeExtension
```

`CalendarEventTypeBehavior` and `CalendarEventBaseKind` come from the customers-owned resolver contract and default to the six stable base kinds. The three exports deliberately mirror AI's `aiAgents`, `aiAgentOverrides`, and `aiAgentExtensions`: base definitions are additive, overrides fully replace or disable, and extensions patch the surviving effective definition. There is no separate `calendar-event-type-overrides.ts` file.

Extension application follows AI's operation ordering:

1. apply all `replace*` scalar/field operations; `replaceCustomFieldsetIds` replaces the entire list;
2. apply `deleteCustomFieldsetIds` by exact fieldset ID;
3. apply `appendCustomFieldsetIds`, preserving declared order and de-duplicating by exact ID.

`replaceFields` replaces only its named closed-schema field properties; it cannot add arbitrary behavior keys. `key` is immutable under an extension. This extension can ship before administrator overlays because every definition is complete after static composition.

### Discovery and generation

`packages/core/src/modules/customers/generators.ts` adds a generator plugin scanning the additive convention `calendar-event-types.ts` in enabled modules and emitting `calendar-event-types.generated.ts`. `yarn generate` is mandatory after contributions change.

- Keys are trimmed lowercase dictionary keys under the existing length limit.
- Duplicate base definitions fail generation; changes to existing keys use overrides.
- Generated entries preserve module ID, source path, enabled-module order, and separate base/override/extension provenance.
- Generated module facts declare the new convention.
- Registration occurs before route/UI resolution and uses the established `globalThis` registry pattern.
- Re-registration replaces the same module entry idempotently for development/test reloads.
- Convention files are declaration-only: runtime imports of another business module are rejected; public `import type` statements are allowed.

The new convention and public export path become frozen after release and require the normal deprecation protocol thereafter.

### Generated output contract

`calendar-event-types.generated.ts` mirrors the AI generated-registry shape and exports:

```ts
type CalendarEventTypeConfigEntry = {
  moduleId: string
  eventTypes: CalendarEventTypeDefinition[]
  overrides: CalendarEventTypeOverridesMap
  extensions: CalendarEventTypeExtension[]
}

export const calendarEventTypeConfigEntries: CalendarEventTypeConfigEntry[]
export const allCalendarEventTypes: CalendarEventTypeDefinition[]
export const calendarEventTypeOverrideEntries: Array<{
  moduleId: string
  overrides: CalendarEventTypeOverridesMap
}>
export const calendarEventTypeExtensionEntries: Array<{
  moduleId: string
  extensions: CalendarEventTypeExtension[]
}>
export const allCalendarEventTypeExtensions: CalendarEventTypeExtension[]
```

The base/override/extension entry shapes and export names become stable generated-file contracts. Missing optional override/extension exports normalize to empty maps/arrays, so older modules remain byte-for-byte behavior compatible.

## Three override paths

### AI parity matrix

| AI extensibility contract | Calendar event-type equivalent | Parity requirement |
|---|---|---|
| `aiAgents` / `aiTools` | `calendarEventTypes` | Additive base registration; duplicate base IDs fail. |
| `aiAgentOverrides` / `aiToolOverrides` | `calendarEventTypeOverrides` | Full definition or `null`; matching map key; missing non-null target may create a warned synthetic entry. |
| `aiAgentExtensions` | `calendarEventTypeExtensions` | Patch the surviving definition; replace → delete → append; cannot resurrect disabled/missing targets. |
| `ModuleEntry.overrides.ai.*` | `ModuleEntry.overrides.calendar.*` | Same app-level inline tier and enabled-module ordering. |
| `applyAi*Overrides/Extensions()` | `applyCalendarEventTypeOverrides/Extensions()` | Highest-precedence process-lifetime tier with immutable snapshots. |
| Generated AI config/override/extension entries | Generated calendar config/override/extension entries | Separate stable exports with module provenance. |
| Programmatic → inline → file → base | Programmatic → inline → file → base | Same replacement/disable precedence; extensions apply after the winner is selected. |

Calendar-specific names and fields differ, but every AI authoring option, precedence class, disable/replace/patch distinction, validation invariant, state bucket, and introspection capability has an explicit equivalent. Tenant dictionary overlays are an additional higher layer owned by the companion spec; they are not a substitute for any static AI-parity tier.

### Path A — co-located module exports

Reusable modules export `calendarEventTypeOverrides` and `calendarEventTypeExtensions` beside `calendarEventTypes` in the discovered convention file. A module MUST edit its own canonical entry instead of overriding/extending it; these exports target definitions owned by other modules or the six customers baselines.

### Path B — `modules.ts` inline

The unified override umbrella gains one additive domain:

```ts
interface CalendarOverridesShape {
  eventTypes?: LooseOverrideMap
  extensions?: readonly unknown[]
}

interface ModuleOverrides {
  // existing domains remain unchanged
  calendar?: CalendarOverridesShape
}
```

Example app-level replacement, disablement, and patch without a synthetic override module:

```ts
{
  id: 'customers',
  from: '@open-mercato/core',
  overrides: {
    calendar: {
      eventTypes: {
        note: null,
        meeting: replacementMeetingDefinition,
      },
      extensions: [
        defineCalendarEventTypeExtension({
          targetEventTypeKey: 'event',
          replacePanelKey: 'my_app.conference',
          appendCustomFieldsetIds: ['conference_details'],
        }),
      ],
    },
  },
}
```

Customers registers a `calendar` applier with `registerModuleOverrideApplier()`. The app's existing `applyModuleOverridesFromEnabledModules(enabledModules)` call dispatches entries in module order; no second bootstrap call is added. `apps/mercato` and the create-app template keep the same shared wiring.

Shared cannot import customers/core types, so `CalendarOverridesShape` stays deliberately loose in `@open-mercato/shared`; the customers registrar zod-parses it into `CalendarEventTypeOverridesMap` and `CalendarEventTypeExtension[]` before changing state. Wiring is explicit and complete:

1. add `calendar?: CalendarOverridesShape` to `ModuleOverrides`;
2. add `'calendar'` to the closed `ModuleOverrideDomain` union and `DOMAIN_KEYS`;
3. expose the focused side-effect registrar at `@open-mercato/core/modules/customers/calendar-event-type-overrides`;
4. import that registrar in both `apps/mercato/src/bootstrap-common.ts` and the create-app template before `applyModuleOverridesFromEnabledModules()`;
5. add the same specifier to `OPTIONAL_OVERRIDE_APPLIER_MODULES` for CLI/worker dynamic bootstrap.

An integration test declares only `overrides.calendar`, starts each bootstrap path, and fails on either the dispatcher's “domain not yet wired” warning or an unchanged registry. This prevents a typed-but-ignored domain.

### Path C — programmatic API

The public customers contract exports:

```ts
applyCalendarEventTypeOverrides(overrides: CalendarEventTypeOverridesMap): void
applyCalendarEventTypeExtensions(extensions: CalendarEventTypeExtension[]): void
snapshotCalendarEventTypeOverrides(): {
  eventTypes: Readonly<CalendarEventTypeOverridesMap>
  modulesConfigEventTypes: Readonly<CalendarEventTypeOverridesMap>
  extensions: readonly CalendarEventTypeExtension[]
  modulesConfigExtensions: readonly CalendarEventTypeExtension[]
}
```

Programmatic calls are process-lifetime, idempotent for empty input, and highest precedence. Override calls are last-write-wins per key; extension calls append in call order. The immutable snapshot mirrors AI's `snapshotProgrammaticOverrides()` by exposing both the programmatic and `modules.ts` buckets; it never includes file declarations, resolved tenant dictionary values, or mutable references.

An `@__internal resetCalendarEventTypeOverridesForTests()` hook clears file-registration test state, inline state, programmatic state, and diagnostic snapshots between tests. Production code cannot invoke it through the public package export.

## End-to-end custom module example

An app module named `my_custom_overrides` can add `site-visit`, patch the existing `meeting` type, and disable `note` without a customers source edit:

```ts
// apps/mercato/src/modules/my_custom_overrides/calendar-event-types.ts
import {
  defineCalendarEventTypeExtension,
  type CalendarEventTypeDefinition,
  type CalendarEventTypeOverridesMap,
} from '@open-mercato/core/modules/customers/calendar-event-types'

export const calendarEventTypes: CalendarEventTypeDefinition[] = [
  {
    key: 'site-visit',
    label: 'Site visit',
    labelKey: 'myCustomOverrides.eventTypes.siteVisit',
    icon: 'MapPin',
    color: 'info',
    behavior: {
      schemaVersion: 1,
      baseKind: 'event',
      selectable: true,
      order: 70,
      fields: {
        endTime: true,
        allDay: false,
        recurrence: false,
        location: 'location',
        people: 'attendees',
        priority: false,
        resources: false,
      },
      customFieldsetIds: ['site_visit_details'],
    },
    panelKey: 'my_custom_overrides.site_visit',
  },
]

export const calendarEventTypeOverrides: CalendarEventTypeOverridesMap = {
  note: null,
}

export const calendarEventTypeExtensions = [
  defineCalendarEventTypeExtension({
    targetEventTypeKey: 'meeting',
    replaceLabelKey: 'myCustomOverrides.eventTypes.customerMeeting',
    replacePanelKey: 'my_custom_overrides.customer_meeting',
    appendCustomFieldsetIds: ['meeting_outcome'],
  }),
]
```

The module is then enabled through the normal `modules.ts` entry and `yarn generate` materializes its declaration. The linked React-panels spec shows the companion `widgets/components.ts` wrapper. If the decision is app-local instead, the same replacement/disable/extension values can live under that module entry's `overrides.calendar`; if it is dynamic at boot, the two `applyCalendarEventType*` functions provide the final tier.

### Composition and precedence

1. Start with the immutable six-type customers baseline.
2. Append enabled-module definitions in generated module order.
3. Compose full replacement/disable maps, lowest to highest: file exports → `modules.ts` inline → programmatic. Last source per key wins within each tier.
4. Apply the composed map: `null` disables; a non-null definition replaces; a non-null definition for a missing key adds a warned synthetic definition.
5. Apply extensions after overrides, in file → `modules.ts` → programmatic order. Each extension applies replace → delete → append; an extension targeting a missing/disabled key is skipped with a warning and cannot resurrect it.
6. Optionally pass the static result to the administrator overlay resolver from the companion spec.

Higher-precedence non-null overrides can resurrect a lower-tier tombstone, exactly like AI overrides. Every effective property and fieldset-list operation records winning provenance. Diagnostics contain module IDs and keys, never loaded source or credentials.

`null` makes a key non-selectable for new records. `resolveCalendarEventType(key, { includeHistorical: true })` still returns the last known base semantics or the meeting-shaped compatibility fallback. Disabling a module has the same selection effect without persisting a tombstone.

### Validation parity with AI

| Input | Result |
|---|---|
| Unique, valid base definition | Added to the base catalog. |
| Duplicate base key | Generation fails and names both owners. |
| Override map key equals non-null `value.key` | Full replacement is accepted. |
| Override map key differs from non-null `value.key` | Entry is skipped with a structured warning; the lower tier survives. |
| Non-null override targets a missing key | Synthetic type is accepted with a warning; code review should prefer `calendarEventTypes` when possible. |
| `null` targets a missing key | No-op; provenance records the attempted tombstone for diagnostics. |
| Extension targets a missing/disabled key | Skipped with a warning; extensions never resurrect. |
| Malformed definition/extension | Rejected by zod before registration; no partial application. |

Registration and every `apply*` function normalize input before mutating global state. Repeated registration of the same module replaces that module's previous entry, which keeps HMR/tests idempotent.

Each accepted/skipped replacement, tombstone, extension, resurrection, and synthetic definition emits a structured log containing source tier, module ID when applicable, type key, operation, and outcome. Logs never include interaction values, dictionary labels supplied by tenants, or credentials.

`panelKey` is opaque serializable metadata. It never loads code; the linked React-panels spec defines how a UI component may consume it through the existing component registry.

## API and runtime behavior

This spec owns the minimal authenticated read contract:

`GET /api/customers/activity-types[?organizationId=<uuid>]`

- Requires authentication and `customers.interactions.view`; organization scope is validated through the existing request context.
- Returns `{ items: EffectiveCalendarEventType[], fallbackKey: 'meeting' }` from the static resolver, including key, resolved label/icon/color, behavior, selectability, static provenance, `adminConfigurable`, and `panelKey`.
- Exports OpenAPI, never exposes component functions/loaders, and uses tenant/organization-scoped caching. The configurable companion adds inheritance and `updatedAt` fields without changing the route.
- `CalendarEventEditor` loads this endpoint once per scoped editor session, orders selectable types by `behavior.order` then key, and uses the selected definition for core-field/custom-fieldset visibility. Read failure reports a localized retry state and uses the immutable six-type baseline; it never reuses another scope's cache.

No new mutation route is introduced. Existing interaction create/update resolves the effective static key in the authenticated scope before persistence. Create and a changed type reject a missing/disabled key; an unchanged unavailable historical key remains editable through meeting-shaped fallback semantics. Direct clients therefore cannot persist a key the editor would reject.

Registry output includes only serializable metadata: key, label/i18n key, appearance, behavior, selectable state, module provenance, configurability, and panel key. It never serializes functions or component loaders.

Interaction create/update remains owned by customers. It verifies that new values use an effective selectable key. Historical updates of an unavailable unchanged key are allowed through fallback semantics. Module disable cannot erase or rewrite customer data.

## UI/UX behavior

- Contributed types appear in the existing calendar type selector in resolved order and use exact keys.
- Module provenance is visible in the activity-type manager when the companion admin feature is present.
- A non-configurable contribution is read-only in that manager.
- When a module is disabled, an existing record shows the raw key plus a localized “Type no longer available” warning and baseline behavior fallback.
- The selector and server mutations consume the same resolver result through the owned catalog API; no client-only type exists.

Prototype: [configurable calendar event types](../prototypes/configurable-calendar-event-types/index.html). The artifact is illustrative and uses synthetic data.

## Failure modes and observability

| Failure | User behavior | System behavior |
|---|---|---|
| Duplicate base key | build does not ship | generator fails with both module owners |
| Override key/value mismatch | lower tier remains effective | skip with module/key diagnostic, matching AI validation |
| Extension targets unknown/disabled key | lower tier remains effective | skip with warning; never resurrect |
| Synthetic non-null override targets unknown key | new type appears with provenance | accept with explicit warning, matching AI synthetic-entry behavior |
| Registry registration repeats | no visible change | replace same module entry idempotently |
| Contributing module disabled | type absent from new selection; historical warning | fallback preserves exact key and stored data |
| Registry or catalog read unavailable at runtime | shipped types remain usable | report error and use tenant-safe immutable baseline |

Structured logs include module ID, type key, phase, and winning provenance but no interaction values or credentials.

## Security and module safety

- Registry declarations are trusted code shipped with enabled modules, never tenant-authored executable input.
- Metadata is zod-validated before registration and normalized to immutable output.
- No direct cross-module ORM relation or mandatory dependency on an optional contributor is introduced.
- Existing interaction values, routes, methods, events, CrudForm spots, and exports remain stable.

## Migration & Backward Compatibility

- Existing apps and modules that declare none of the new exports retain the six-type behavior byte-for-byte.
- The six definitions, behavior/effective types, resolver, fallback, and catalog read route are the canonical additive foundation reused by both companion specs.
- New auto-discovery filename, `ModuleOverrides.calendar` shape, public types/functions, generated exports/entry shapes, and module facts are additive but frozen once released.
- `null` remains selection disablement; full overrides retain key/value matching; extension operation order and four-tier precedence cannot change incompatibly after release.
- The generated reader treats absent override/extension arrays as empty for at least one minor version, allowing old generated artifacts during rolling builds.
- Published event-type keys, the convention filename, required export names, programmatic function names, `ModuleOverrides.calendar` paths, and generated export names require the standard deprecation bridge plus `UPGRADE_NOTES.md` before any rename/removal.
- Removing the extension machinery leaves interactions intact and returns the app to the six core definitions.

## Implementation plan

### Phase A — Registry and generation

1. Add the canonical public zod/types, six immutable definitions, compatibility fallback, normalized process-global resolver/registry, AI-parity override/extension composers, programmatic APIs/snapshots, and unit tests for add/replace/disable/extend/collision/provenance/fallback.
2. Add the customers generator plugin and discovery convention; emit the stable base/override/extension exports, register generated entries, and extend generated module facts.
3. Add the loose shared `ModuleOverrides.calendar` shape/domain key, customers registrar, static and dynamic bootstrap imports in the app plus create-app template, and tests that fail if the domain is unwired; then test file → `modules.ts` → programmatic precedence, resurrection, synthetic definitions, key/value validation, and extension ordering.
4. Add one synthetic `site-visit` contribution plus cross-module replacement/disable/extension fixtures in the canonical example; mirror app-template changes and refresh the standalone harness contract.

*Exit:* enabled modules deterministically change the in-memory catalog and disabling the example preserves historical fallback.

### Phase B — Runtime delivery and enforcement

5. Add the scoped, cached catalog read route/OpenAPI over the static resolver and consume it in `CalendarEventEditor` with baseline retry fallback.
6. Replace client hard-coded type selection and server hard-coded type validation with the shared resolver while retaining the deprecated `editorKindOfInteractionType()` bridge.

*Exit:* a contributed key is selectable, persists exactly, reloads, and is rejected consistently when unavailable without either companion feature installed.

### Phase C — Verification and documentation

7. Document all three authoring paths, precedence, replacement-vs-extension choice, tombstones, snapshots, bootstrap wiring, and compatibility alongside the AI override guide; update `UPGRADE_NOTES.md` and `BACKWARD_COMPATIBILITY.md` with the frozen surfaces.
8. Run generation, module-decoupling tests, package build, typecheck, lint, integration tests, app build, and standalone-harness refresh.

## Integration coverage

Fixtures use the canonical example module and clean all created records in `finally`.

- **TC-CETE-001 — contribution lifecycle:** enable the example `site-visit` definition, verify the authenticated catalog API, editor selection, key/provenance/order, exact interaction persistence, and reload; disable it and verify new selection/server mutation rejection plus historical fallback without rewrite.
- **TC-CETE-002 — AI-parity override tiers:** replace one core definition and tombstone another through file exports, override both through `modules.ts`, then override them programmatically; verify programmatic → inline → file → base precedence, higher-tier resurrection, key/value mismatch warnings, synthetic-definition behavior, snapshots, hidden selection, and unchanged historical edits.
- **TC-CETE-003 — module decoupling:** run the repository module-decoupling fixture with the contributor absent and assert no unresolved first-party target, import, generated loader, or route failure.
- **TC-CETE-004 — extension ordering:** apply file, inline, and programmatic extensions to one surviving type; verify replace → delete → append fieldset semantics, exact de-duplication, property provenance, and warning/no-op behavior against a disabled type.
- **TC-CETE-005 — dispatcher bootstrap:** declare only `overrides.calendar` and verify application before first resolver load in Next.js and dynamic CLI/worker bootstrap; assert no unwired-domain warning and mirror coverage in the create-app template.

## Risks

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Registry collision or load-order drift | High | Fail duplicate definitions; generated stable order; AI-parity precedence and provenance snapshots | Intentional competing overrides/extensions remain last-wins |
| Override/extension semantics drift from AI | High | Shared terminology, three matching authoring paths, contract tests comparing precedence/disablement/validation invariants | Domain fields differ, so exact type shapes remain calendar-specific |
| Disabled module strands records | Medium | Exact keys persist; disable affects selection only; historical fallback | Specialized fields are unavailable until module returns |
| Generated contract breaks third parties | High | Additive convention, frozen exports, deprecation protocol | Future schema evolution needs compatibility bridges |
| Client and server catalogs drift | High | One resolver behind catalog API and mutations; integration test exact key lifecycle | Stale client requests still require normal retry UX |

## Final compliance report

### Sources reviewed

- `AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`
- `packages/core/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`, shared override/component-registry contracts
- AI override/extension public contracts, docs, generated registries, and `BACKWARD_COMPATIBILITY.md`
- `.ai/ds-rules.md`, `.ai/ui-components.md`, frontend architecture contract guidance

### Compliance matrix

| Rule | Status | Notes |
|---|---|---|
| Scope cohesion | Pass after split | Static registry composition is independent from administrator overlays and React panel hosting |
| Module isolation | Pass | Host-owned generator + public type-only contributor contract; no reverse runtime imports, optional hard requirement, or ORM links |
| Unified overrides | Pass | File, `modules.ts`, and programmatic paths match AI replacement/disable/extension semantics and precedence |
| Bootstrap wiring | Pass | Closed shared domain, loose boundary shape, customers registrar, static/dynamic imports, and unwired-domain tests are explicit |
| Generated files and naming | Pass | Additive convention, stable base/override/extension exports, mandatory `yarn generate`, frozen published surfaces |
| Compatibility | Pass | Durable keys, historical fallback, additive public contracts, deprecation policy |
| Security/privacy | Pass | Trusted code contributions, zod metadata, no new persistence/PII |
| Runtime delivery | Pass | Owned scoped catalog API, editor transport, and server mutation validation consume one resolver |
| Integration coverage | Pass | Lifecycle, precedence, extension ordering, dispatcher bootstrap, and module decoupling covered |

### Verdict

Approved for review. The extension-registry capability is independently deployable and linked to, but not coupled to, the administrator configuration spec.

## Changelog

### 2026-09-28 — Initial proposal

- Split module-owned extension contracts from administrator configuration after independent scope review.
- Defined generated registry composition, tombstone/history behavior, and module-decoupling coverage.

### 2026-09-28 — AI extensibility parity

- Split full replacement/disablement from patch extensions and aligned operation ordering with `aiAgentOverrides` / `aiAgentExtensions`.
- Added equivalent file, `modules.ts`, and programmatic authoring paths, stable generated exports, snapshots, validation, precedence, and synthetic-entry behavior.
- Clarified optional-module isolation and linked the optional React-panel companion spec.

### 2026-09-28 — Scope cohesion review

- Moved the optional UMES panel contract, component override tiers, frontend constraints, and UI tests into the linked React-panels companion spec.
- Added the canonical foundation, catalog/editor transport, interaction validation, and complete shared-dispatcher bootstrap wiring after final architectural review.
