# Calendar Event Type React Panels

**Status:** Implemented; QA pending
**Issue:** [#6684](https://github.com/open-mercato/open-mercato/issues/6684)
**Depends on:** Calendar-type foundation in [Calendar Event Type Extensions](./2026-09-28-calendar-event-type-extensions.md)
**Related:** [CRM Calendar](./2026-06-11-crm-calendar.md), [Calendar Event Type Extensions](./2026-09-28-calendar-event-type-extensions.md), [Configurable Calendar Event Types](./2026-09-28-configurable-calendar-event-types.md)

## TLDR

After the canonical customers calendar-type foundation is present, add one stable component-replacement handle so enabled modules and downstream apps can wrap, transform, replace, or programmatically alter its React UI. The feature reuses the existing Unified Module Extension System (UMES) and therefore exposes the same three UI authoring paths as AI UI parts: `widgets/components.ts`, `modules.ts` inline component overrides, and `applyComponentOverrides()` at bootstrap/test time. Selected-type `onBeforeSave` validation is supplied by mounted injection widgets under the extension spec and remains active with default, wrapped, or replaced panels.

Customers retains the single `CrudForm`, submission, optimistic locking, guards, and keyboard lifecycle. The panel receives form capabilities but no submit, delete, request, transaction, or raw network callback. Event-type metadata remains serializable; `panelKey` can select behavior but never dynamically imports code.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Why | Confirm? |
|---|---|---|---|---|
| Q1 | Should the React host ship in the event-type extension spec? | No; keep it as this linked companion capability deployed after the customers-owned foundation. | The UI host is independently reviewable and optional, but its props intentionally reuse the canonical effective-definition contract. | Confirmed by scope review |
| Q2 | Which extension framework should own the UI? | Existing UMES component replacement, not a calendar-specific registry. | It already supports wrappers, props transforms, replacement, inline configuration, and programmatic application. | Reversible |
| Q3 | Where does submission live? | Always in the customers-owned `CrudForm`. | Preserves mutation guards, optimistic locking, errors, injection spots, and keyboard behavior. | Reversible |

## Goals and non-goals

### Goals

- Route every core and contributed event type through one exact component handle.
- Match all existing UMES/AI UI component authoring tiers without creating another loader or precedence model.
- Make wrappers and props transforms the safe default while retaining full panel replacement.
- Preserve host-owned submission and graceful fallback when a module is disabled or its panel throws.
- Keep optional contributors decoupled from customers at runtime.
- Depend only on the canonical customers foundation, not on any contributed type or administrator overlay.

### Non-goals

- Defining, replacing, disabling, or extending event-type metadata; the linked widget-extension spec owns that.
- Administrator-authored React, JavaScript, component names, or import paths.
- Replacing the whole dialog, form header/footer, mutation handler, or conflict surface.
- Adding direct ORM relationships between customers and a contributor.
- Providing an unrestricted form builder.

## User stories and acceptance criteria

### US-C1 — Add a type-specific panel

As a module author, I want the standalone app's `example` module to provide a custom React editor for `Visit` while customers retains the canonical form lifecycle.

- A wrapper branches on `definition.key === 'visit'` (or `panelKey === 'example.visit'`), renders `VisitPanel`, and delegates every other type to `Original`.
- `VisitPanel` owns the Visit-specific field layout for time, recipients, resources, location, and availability feedback. It displays pending, available, unavailable, and retry states from the shared scoped evaluator; it does not create a second form.
- Stable props expose the effective definition, mode, values, errors, disabled state, capabilities, and `setValue`.
- The panel receives no submit, delete, `apiCall`, transaction, or request-header callback.
- Durable custom data uses sanctioned custom fields or a contributor-owned extension entity linked by ID.

### US-C2 — Configure React at every supported tier

As a downstream app owner, I want the same deployment choices used by AI UI component overrides.

- A reusable module can contribute through `widgets/components.ts`.
- An app can use `ModuleEntry.overrides.widgets.components[handle]` without creating a synthetic module.
- Bootstrap/test code can use `applyComponentOverrides()` at the existing highest-precedence tier.
- Existing UMES file → inline → programmatic precedence, `null` disablement, wrappers, props transforms, composed-state inspection, and shared test reset behavior remain authoritative.

### US-C3 — Fail safely

As a CRM user, I want an unavailable or broken optional panel to preserve my event draft.

- Disabling a contributor falls back to the default panel.
- A wrapper-component or replacement render error follows existing `useRegisteredComponent` reporting: component handle plus replacement module when known, never form values.
- For those child-render errors, the existing UMES boundary renders the plain default panel and preserves the current draft; wrapper-factory and props-transform exceptions occur before that boundary and are not given a new guarantee by this spec.

## Architecture

```text
widgets/components.ts ───────────────┐
modules.ts overrides.widgets ────────┼── existing UMES component registry
applyComponentOverrides() ───────────┘           │
                                                  ▼
section:customers.calendar-event-editor.type-panel
                                                  │
effective definition + host form capabilities ───┤
                                                  ▼
                           wrapper / props transform / replacement
                                                  │
                                                  ▼
                         customers-owned CrudForm submit lifecycle
```

Customers owns and binds the handle after importing `EffectiveCalendarEventType` and its resolver from the prerequisite foundation. Contributors target it through public UMES contracts; customers never imports or resolves a contributor. This is inversion of control, not a reverse dependency on a contributor.

- A general module that only optionally enriches CRM MUST NOT declare `requires: ['customers']`; when customers is absent the handle is never mounted and the contribution remains inert.
- An app-only module whose sole purpose is CRM customization MAY explicitly declare `requires: ['customers']` as an intentional product dependency.
- A component may use `import type` from the stable customers contract but MUST NOT import customers entities, services, or private editor components.
- Durable cross-module state uses custom fields or a separate extension entity with FK IDs/snapshots, never a direct ORM relationship.

## Stable component contract

Customers declares this exact handle:

`section:customers.calendar-event-editor.type-panel`

and this versioned props contract:

`customers.calendar.event-type-panel.v1`

```ts
type CalendarEventTypePanelProps = {
  definition: EffectiveCalendarEventType
  panelKey?: string
  mode: 'create' | 'edit'
  values: Readonly<Record<string, unknown>>
  errors: Readonly<Record<string, string | undefined>>
  disabled: boolean
  capabilities: Readonly<CalendarEventPanelCapabilities>
  setValue: (fieldId: string, value: unknown) => void
}
```

`EffectiveCalendarEventType` is the canonical foundation export, and `CalendarEventPanelCapabilities` is a new UI-only closed object owned by this spec. `panelKey` is optional: all six baseline kinds work without it, and a later widget-contributed definition may supply it as an opaque routing hint. This spec does not redefine event metadata or require a contributed type.

`CalendarEventEditor` resolves `useRegisteredComponent(handle, DefaultEventTypePanel)` inside its existing single `CrudForm`. Every shipped, contributed, replaced, and administrator-configured type traverses this component path; there are no type-specific tabs that bypass it.

The props intentionally omit submit, delete, `apiCall`, transaction, request-header, retry, and raw validation-bypass callbacks. A replacement remains trusted code and can import APIs independently, so server validation and code review remain enforcement boundaries.

Existing frozen spots `crud-form:customers.customer_interaction` and `crud-form:customers.customer_interaction:fields` remain unchanged. The new panel handle does not supersede generic CrudForm field widgets or the example widget's self-gated Visit `onBeforeSave` validation. Generic `CrudForm`, `InjectionSpot`, shared widget loading, and widget metadata remain unchanged. A wrapper/replacement cannot bypass the host's injection event pipeline.

## Three React override paths

This spec adds no calendar-specific registration API. It uses the existing component override surface exactly as AI UI parts do.

### Path A — module file

A reusable module exports a component contribution from `widgets/components.ts`. A type-specific wrapper SHOULD inspect `definition.key` or `panelKey`, render its additional fields, and delegate other types to `Original`.

### Path B — `modules.ts` inline

An app can target the handle through the existing umbrella:

```ts
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import { withExampleCalendarEventTypePanel } from './modules/example/widgets/components'

const panelHandle = ComponentReplacementHandles.section(
  'customers.calendar-event-editor',
  'type-panel',
)

{
  id: 'example',
  from: '@app',
  overrides: {
    widgets: {
      components: {
        [panelHandle]: {
          target: { componentId: panelHandle },
          priority: 50,
          metadata: { module: 'example' },
          wrapper: withExampleCalendarEventTypePanel,
        } satisfies ComponentOverride,
      },
    },
  },
}
```

This is the existing `ComponentOverride` descriptor shape, including the repeated target used for validation and diagnostics. It demonstrates an alternative to the required example's file contribution; do not register both descriptors for the same wrapper in one app. Client-visible component overrides must not be gated by server-only environment variables; use an unconditional entry or a `NEXT_PUBLIC_*` gate consistently on server and browser.

### Path C — programmatic

Bootstrap code and tests may call the existing `applyComponentOverrides()` with the same handle. Programmatic component overrides retain the current highest precedence, composed-state introspection, idempotent registration, and internal test reset behavior.

The component registry exists separately in server and browser runtimes. Programmatic applications must register their existing UMES override in each applicable runtime before rendering; this feature does not add an `applyProgrammaticComponentOverrides()` export, global bootstrap hook, or calendar-specific dispatcher. The canonical example uses the already-discovered `widgets/components.ts` contribution. Tests use the existing registry reset and `applyComponentOverrides()` utilities without changing shared component infrastructure.

For all three paths, existing UMES composition remains authoritative: base registration, file contributions, inline overrides, then programmatic overrides. The client resolver selects the highest-priority replacement, composes wrappers in ascending priority, and reduces props transforms in ascending priority before the final render; focused tests pin this host to that resolver. `null` disables the contributed override and falls back to the host default; it does not disable the event type.

### Standalone `example` module Visit editor

Extend `packages/create-app/template/src/modules/example/` with a statically discoverable wrapper and a `VisitPanel`; keep `example` disabled in the shipped standalone `modules.ts` and enable it in integration fixtures. Mirror the monorepo example if needed for reference parity:

```ts
// packages/create-app/template/src/modules/example/widgets/components.ts
import * as React from 'react'
import type { ComponentType } from 'react'
import type { CalendarEventTypePanelProps } from '@open-mercato/core/modules/customers/calendar-event-types'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import { VisitPanel } from '../components/VisitPanel'

const panelHandle = ComponentReplacementHandles.section(
  'customers.calendar-event-editor',
  'type-panel',
)

export function withExampleCalendarEventTypePanel(
  Original: ComponentType<CalendarEventTypePanelProps>,
): ComponentType<CalendarEventTypePanelProps> {
  function ExampleCalendarEventTypePanel(props: CalendarEventTypePanelProps) {
    if (props.definition.key === 'visit' && props.panelKey === 'example.visit') {
      return React.createElement(VisitPanel, props)
    }
    return React.createElement(Original, props)
  }
  return ExampleCalendarEventTypePanel
}

export const componentOverrides: ComponentOverride<CalendarEventTypePanelProps>[] = [
  {
    target: { componentId: panelHandle },
    priority: 50,
    metadata: { module: 'example' },
    wrapper: (Original) => withExampleCalendarEventTypePanel(Original),
  },
]

export default componentOverrides
```

`VisitPanel` wraps the default type-field layout for `visit`: the module wrapper supplies `Original` as a child, preserving the standard datepicker, time selects, recipient/resource fields, location, and two-column layout, and adds availability feedback around those fields. It uses `props.values`, `props.errors`, and `props.setValue`, renders translated inline errors and a retry action, and delegates submission to the host `CrudForm`. Its preview calls the scoped evaluator endpoint through `apiCall`, never raw `fetch`; the selected-type injection widget performs a fresh pre-save check independently, including when another panel replaces `VisitPanel`. The optional server rule protects direct API writes. Visit is code-owned (`adminConfigurable: false`). Absent/disabled staff, resources, or planner integrations show translated warnings and skip only unavailable checks; enabled peers still enforce authorization and availability. The evaluator explicitly opts into planner `respectTimezone: true` without changing other planner callers. Empty custom fieldsets remain unrestricted legacy fields. Only Meeting label customization uses the declaration's demo flag, default false. Example adds Visit and preserves all baseline types with either flag value; it never removes or disables a type. Use shared UI primitives, semantic tokens, and accessible controls. The local handle expression remains statically foldable by the existing UMES generator; after enabling the example module, run normal `yarn generate`.

## Runtime and UI behavior

- Core and contributed types use the same host panel path.
- `panelKey` is opaque metadata passed to props. It never resolves a module or component name.
- The host keeps dialog header/footer, validation summary, `Cmd/Ctrl+Enter`, `Escape`, loading state, conflict bar, and retry behavior.
- Module panels use shared primitives, semantic tokens, `useT()`, and accessible labels/focus behavior.
- A missing/disabled component contribution renders `DefaultEventTypePanel`.
- An error thrown while rendering a composed wrapper component or replacement is isolated by the existing UMES boundary; the plain default panel renders and current values remain in the host form. Wrapper-factory and props-transform code must remain pure/non-throwing because it executes before that boundary.
- A contributor needing data fetching uses scoped public APIs and loading/error primitives but cannot bypass server-side event-type validation.

Prototype: [configurable calendar event types](../prototypes/configurable-calendar-event-types/index.html). Screen 5 illustrates a visit-like custom panel inside the host form; implementation uses the standalone `example` module's `VisitPanel` and staff/resource availability states. The artifact is illustrative and uses synthetic data.

## Frontend Architecture Contract

| Surface | Server root | Client island | Reason |
|---|---|---|---|
| Calendar editor | existing server page | existing lazy `CalendarEventEditor`; extracted `EventTypePanel` leaf | selected-type reactivity and component-registry lookup |

No page-root client component, provider, or heavy dependency is added. The component registry already exists. The host leaf stays under 300 LOC, and module-owned panels follow their module boundary budget. Disabled modules must not add their panel code to unrelated routes.

Required evidence: `yarn check:client-boundaries`, `yarn generate`, `yarn build:packages`, `yarn build:app`, hydration tests for the default/wrapper/replacement paths, and bundle evidence that a disabled optional panel is not loaded.

## Failure modes and observability

| Failure | User behavior | System behavior |
|---|---|---|
| Contributor disabled or handle override absent | default panel | no cross-module lookup or error |
| File override fails the minimal target check | lower tier/default survives | existing registry silently filters it; this spec adds no diagnostic guarantee |
| Inline/programmatic override is malformed | lower tier/default survives when rejected/no-op | existing override layer may warn with the handle key; contributor module attribution is not guaranteed |
| Wrapper component/replacement throws during render | plain default panel; draft preserved | existing boundary reports handle and replacement module when known, never values; wrapper attribution may be `unknown` |
| Wrapper factory or props transform throws | existing host error behavior; no panel fallback guarantee | exception occurs before the current replacement boundary; author tests must prevent it |
| `panelKey` unknown | default/type-agnostic wrapper behavior | no dynamic import; structured diagnostic only when a wrapper chooses to report it |
| Programmatic override applied twice | existing UMES deterministic result | existing idempotence/snapshot rules apply |

Existing UMES logs contain the component handle, outcome, and replacement module when known. They do not guarantee type key, source tier, or wrapper attribution. They never include form values, interaction content, tenant labels, or credentials.

## Security and module safety

- Component contributions are trusted code shipped with enabled modules, never tenant-authored executable input.
- Host props do not convey mutation authority; customers routes still validate tenant/organization scope, ACL, selectability, and optimistic-lock headers.
- No contributor is imported by customers, no optional service is required, and no direct cross-module ORM relationship is added.
- Existing generic field injection remains available and is preferred when custom React is unnecessary.

## Migration & Backward Compatibility

- Apps with no component contribution render the current default panel unchanged.
- This capability requires the canonical customers foundation/types but no contributed event type and no administrator configuration.
- The new handle and versioned props export are additive but frozen after release under `BACKWARD_COMPATIBILITY.md`.
- Existing CrudForm widget spots, component override precedence, helper names, snapshots, and `null` semantics do not change.
- A future props revision uses a new versioned contract or an additive optional field; removal/rename requires a deprecated bridge for at least one minor release plus `UPGRADE_NOTES.md`.
- Removing this capability restores the default panel and leaves event types and persisted interactions untouched.

## Implementation plan

### Phase A — Host contract

1. Export the exact component handle, zod/runtime-safe public props boundary where applicable, TypeScript props, default panel, and error boundary.
2. Extract/bind `EventTypePanel` through `useRegisteredComponent` inside the existing single `CrudForm` without changing submission, generic injection spots, locking, or keyboard behavior.
3. Extend the standalone template's `example/widgets/components.ts` with a wrapper that renders the custom `VisitPanel` only for `visit`, and add replacement fixtures; keep the module disabled by default.

*Exit:* every type traverses the host, the enabled standalone example renders the custom Visit editor, and a missing/disabled contribution renders the unchanged default.

### Phase B — Override tiers and safety

4. Verify existing `modules.ts` component overrides and programmatic UMES application in applicable runtimes; do not add a global app/template hook or calendar-specific registry.
5. Add props-transform/wrapper/replacement precedence, SSR→hydration programmatic persistence, existing error-boundary behavior, form-state preservation, module-disabled, and no-capability-leak tests.
6. Document the three paths beside AI/component override documentation and add frozen surfaces to `BACKWARD_COMPATIBILITY.md` and `UPGRADE_NOTES.md`.

*Exit:* file, inline, and programmatic tiers behave exactly like other UMES/AI UI parts and preserve host safety.

### Phase C — Verification

7. Run generation, component-registry and focused UI tests, package build, client-boundary checks, typecheck, lint, integration tests, app build, DS review, and standalone-harness refresh.

## Integration coverage

Fixtures use a canonical example module and clean created records in `finally`.

- **TC-CETP-001 — default and module lifecycle:** render every core/contributed type through the handle, disable the contributor, and verify default fallback plus unchanged persisted data.
- **TC-CETP-002 — React override tiers:** target the handle through file, `modules.ts`, and existing programmatic UMES registration in each applicable runtime; verify existing precedence, `null` fallback, composed-state introspection, internal reset isolation, and the same component before/after hydration.
- **TC-CETP-003 — standalone Visit editor:** in a scaffolded app with `example` enabled, select `visit` and verify `VisitPanel` renders its custom time, recipients, resources, and location controls; change fields through `setValue`. With scoped staff-user-to-member and resource fixtures, assert per-subject pending, available, and unavailable states, mapped inline errors, and blocked save for unavailable choices. An available Visit submits through the host, and every other type delegates to `Original`.
- **TC-CETP-004 — host authority:** verify no submit/network callback is present, generic custom-field widgets and selected-type `onBeforeSave` validation still run under default/wrapped/replaced panels; `Cmd/Ctrl+Enter`, `Escape`, guarded mutation, optimistic locking, conflicts, and retry remain host-owned.
- **TC-CETP-005 — render failure boundaries:** force a composed wrapper-component render error and a replacement render error, assert the plain default fallback preserves the draft, and verify current UMES diagnostics omit form values while allowing unknown wrapper attribution; separately prove wrapper-factory/props-transform errors are outside the fallback guarantee.
- **TC-CETP-006 — optional-module isolation:** run module-decoupling and bundle checks with customers absent and with the contributor disabled; assert no unresolved import/loader and no unrelated-route panel chunk.
- **TC-CETP-007 — unavailable preview:** force the scoped availability preview to fail; verify the Visit panel shows the fourth state, a localized retry action, preserves the draft, and cannot submit until the independent mounted widget check succeeds. Verify retry reaches an available/unavailable state, plus hydration and keyboard behavior in the standalone app.

## Risks

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Custom code bypasses host safety | High | No mutation callbacks; server validation; wrapper-first docs; real guard/locking tests | Trusted code can import APIs, so review remains necessary |
| Visit availability preview is stale or unavailable | Medium | Panel shows pending/retry states; mounted widget and server rule re-evaluate before save | A later schedule change remains possible without reservation semantics |
| Full replacement fragments UX | Medium | Wrappers/props transforms preferred; host retains dialog shell and lifecycle | Specialized panels may still vary internally |
| Handle/props change breaks modules | High | Frozen exact handle and versioned props; additive evolution/deprecation bridge | Future host needs may require a v2 contract |
| Optional panel inflates unrelated bundles | Medium | Existing lazy boundary; bundle test with contributor disabled | Shared dependencies may remain deduplicated in common chunks |

## Final compliance report

### Sources reviewed

- `AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`
- `packages/core/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`, component replacement and unified override contracts
- AI override/UI-part docs and `.ai/specs/implemented/2026-05-04-modules-ts-unified-overrides.md`
- `.ai/ds-rules.md`, `.ai/ui-components.md`, frontend architecture contract guidance

### Compliance matrix

| Rule | Status | Notes |
|---|---|---|
| Scope cohesion | Pass after split | One optional React host over the explicit prerequisite foundation, using the existing UMES component system |
| AI/UMES parity | Pass | File, `modules.ts`, and programmatic component paths retain existing semantics and precedence |
| Module isolation | Pass | Host-owned handle; inert optional contribution; no reverse runtime import, service requirement, or ORM link |
| Host safety | Pass | One `CrudForm`; existing spots/guards/locking remain; props exclude mutation authority |
| Compatibility | Pass | Additive frozen handle/versioned props and unchanged existing UMES contracts |
| Security/privacy | Pass | Trusted code only, scoped server validation, logs omit values/PII |
| Design system/i18n/a11y | Pass | Shared primitives/tokens/translations and host keyboard/focus lifecycle required |
| Integration coverage | Pass | All three tiers, fallback, host authority, render failure, and optionality covered |
| Frontend contract | Pass | One bounded client leaf; no provider/page-root/heavy dependency expansion |

### Verdict

Approved for review as a companion capability deployed after the canonical customers foundation. It remains optional and independent from contributed definitions and administrator configuration.

## Changelog

### 2026-09-28 — Initial proposal

- Split the React panel host from the static registry after fresh-context scope review.
- Defined the exact handle, versioned safe props, default/error fallback, and frontend boundary.
- Reused all existing UMES/AI UI component authoring tiers instead of adding calendar-specific registration or precedence.
- Declared the foundation dependency, dual-runtime programmatic bootstrap hook, and current UMES fallback/diagnostic limits.

### 2026-09-29 — Widget validation alignment

- Clarified that panel overrides preserve the Visit-self-gated widget validation owned by the extension spec.

### 2026-09-29 — Standalone Visit example

- Required a real custom `VisitPanel` in the standalone template's existing `example` module, including staff/resource availability feedback and standalone integration coverage.

### 2026-09-30 — Module-boundary implementation alignment

- Aligned the implementation with Customers-owned widget payloads, contributor DI registration, and unchanged shared forms/loaders/override contracts.
- Preserved unrestricted empty fieldsets, Call/Task end times, internal-command compatibility, and historical keys; calendar-picker selection remains explicit.
- Documented immutable Visit behavior, opt-in demo overrides, missing optional-module warnings, and opt-in planner time-zone evaluation. QA remains pending.

### 2026-09-30 — Event-local timezone selection

- Every type, including code-owned Visit and Task, supports a selected IANA timezone independently of field applicability; Customers stores it as a nullable interaction column and preserves it through API reads and undo/redo.
- Editor wall-clock conversion and recurrence use the selected event timezone; planner time-zone evaluation remains an explicit, separate opt-in.

### 2026-09-30 — Standard presentation and explicit timezone follow-up

- Reused the original Customers panel for Visit and normalized server error aliases in the module wrapper; no changes to shared forms or widget infrastructure.
- Added an event-local IANA timezone selector in the host, persisted its optional nullable zone, and restored wall-time fields on edit. Preview conversion uses that zone instead of the browser zone; weekly event recurrence retains its wall time across daylight-saving transitions.
- Added self-contained TC-CAL-014 API/editor/DST cases and expanded TC-EXAMPLE-018 weekly/one-off staff/resource coverage. Live verification requires the new nullable Customers timezone migration; QA remains pending until the gate runs.

### 2026-09-30 — Preserve shipped calendar types

- Example adds Visit and optionally patches Meeting without removing or disabling any built-in type, regardless of the demo flag. Generic app-owned removal instructions and Customers tombstone support remain available.

### 2026-09-30 — Named availability and calendar booking conflicts

- Visit reports each selected staff member or resource by display name and distinguishes missing schedules or intervals outside working hours from an existing booking (`example.calendar.visitAvailability.booked`). Booking checks include overlapping Customers interactions of every event type, including recurrence occurrences, in the authorized tenant and organization. Use half-open intervals: touching boundaries do not overlap. Canceled and deleted interactions do not reserve subjects. On edit, pass the validated current `excludeInteractionId` to preview; the command guard excludes that same existing interaction automatically, while retaining other collisions. Preview and rejected writes return the blocked subject names and reason keys without disclosing other event titles or IDs. Booking reads and recurrence expansion are bounded; failed, incomplete, or unsupported booking checks fail closed rather than reporting an available subject. These guards protect Visit scheduling against bookings from any type; they do not impose Visit rules on other event-type writes.
- TC-EXAMPLE-018 creates its own staff/resource, availability, normal Meeting and recurring Event fixtures; asserts named preview/POST/PUT conflicts, self-edit exclusion, boundary contact, cancellation and deletion release, and preserved failed-update data. Frontend unit coverage checks the named booking messages. Live integration execution remains part of the QA gate.
