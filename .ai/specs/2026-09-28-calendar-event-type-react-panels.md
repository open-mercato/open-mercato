# Calendar Event Type React Panels

**Status:** Proposed
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

As a module author, I want a visit-specific panel while customers retains the canonical form lifecycle.

- A wrapper can branch on `definition.key` or `panelKey` and delegate all other types to `Original`.
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

Existing frozen spots `crud-form:customers.customer_interaction` and `crud-form:customers.customer_interaction:fields` remain unchanged. The new panel handle does not supersede generic CrudForm field widgets or the selected-type mounted widget's `onBeforeSave` validation. A wrapper/replacement cannot bypass the host's injection event pipeline.

## Three React override paths

This spec adds no calendar-specific registration API. It uses the existing component override surface exactly as AI UI parts do.

### Path A — module file

A reusable module exports a component contribution from `widgets/components.ts`. A type-specific wrapper SHOULD inspect `definition.key` or `panelKey`, render its additional fields, and delegate other types to `Original`.

### Path B — `modules.ts` inline

An app can target the handle through the existing umbrella:

```ts
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import { withMyCalendarEventTypePanel } from './modules/my_custom_overrides/calendar-event-panel'

const panelHandle = ComponentReplacementHandles.section(
  'customers.calendar-event-editor',
  'type-panel',
)

{
  id: 'my_custom_overrides',
  from: '@app',
  overrides: {
    widgets: {
      components: {
        [panelHandle]: {
          target: { componentId: panelHandle },
          priority: 50,
          metadata: { module: 'my_custom_overrides' },
          wrapper: withMyCalendarEventTypePanel,
        } satisfies ComponentOverride,
      },
    },
  },
}
```

This is the existing `ComponentOverride` descriptor shape, including the repeated target used for validation and diagnostics. Client-visible component overrides must not be gated by server-only environment variables; use an unconditional entry or a `NEXT_PUBLIC_*` gate consistently on server and browser.

### Path C — programmatic

Bootstrap code and tests may call the existing `applyComponentOverrides()` with the same handle. Programmatic component overrides retain the current highest precedence, composed-state introspection, idempotent registration, and internal test reset behavior.

Because the component registry exists separately in server and browser runtimes, an app-level programmatic decision MUST execute in both before component entries register. The app/template `modules.ts` gains one synchronous, browser-safe export:

```ts
export function applyProgrammaticComponentOverrides(): void {
  applyComponentOverrides({
    'section:customers.calendar-event-editor.type-panel': shouldUseCustomPanel
      ? myPanelOverride
      : null,
  })
}
```

`bootstrap-common.ts` calls it before `applyModuleOverridesFromEnabledModules()` and registry first-load. `ClientBootstrap.ensureModuleOverridesApplied()` calls the same export after applying inline widget overrides but before `ComponentOverridesBootstrap` filters/registers generated entries. The programmatic store wins regardless of call order, but this sequence makes initialization explicit. The function must be deterministic in both runtimes: use literals or `NEXT_PUBLIC_*` flags, never server-only environment values, request/tenant state, or async I/O. Both `apps/mercato` and the create-app template receive the hook and SSR→hydration regression coverage; tests reset the store between runs.

For all three paths, existing UMES composition remains authoritative: base registration, file contributions, inline overrides, then programmatic overrides. The client resolver selects the highest-priority replacement, composes wrappers in ascending priority, and reduces props transforms in ascending priority before the final render; focused tests pin this host to that resolver. `null` disables the contributed override and falls back to the host default; it does not disable the event type.

### End-to-end `my_custom_overrides` wrapper

The module paired with the widget-extension example contributes a statically discoverable wrapper:

```ts
// apps/mercato/src/modules/my_custom_overrides/widgets/components.ts
import * as React from 'react'
import type { ComponentType } from 'react'
import type { CalendarEventTypePanelProps } from '@open-mercato/core/modules/customers/calendar-event-types'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import { SiteVisitPanel } from '../components/SiteVisitPanel'

const panelHandle = ComponentReplacementHandles.section(
  'customers.calendar-event-editor',
  'type-panel',
)

export function withMyCalendarEventTypePanel(
  Original: ComponentType<CalendarEventTypePanelProps>,
): ComponentType<CalendarEventTypePanelProps> {
  function MyCalendarEventTypePanel(props: CalendarEventTypePanelProps) {
    if (props.panelKey === 'my_custom_overrides.site_visit') {
      return React.createElement(SiteVisitPanel, props)
    }
    return React.createElement(Original, props)
  }
  return MyCalendarEventTypePanel
}

export const componentOverrides: ComponentOverride<CalendarEventTypePanelProps>[] = [
  {
    target: { componentId: panelHandle },
    priority: 50,
    metadata: { module: 'my_custom_overrides' },
    wrapper: (Original) => withMyCalendarEventTypePanel(Original),
  },
]

export default componentOverrides
```

`SiteVisitPanel` renders only the specialized fields and calls `props.setValue`; it does not create another form or submit button. The local handle expression remains statically foldable by the generator. After enabling the module, run `yarn generate`.

## Runtime and UI behavior

- Core and contributed types use the same host panel path.
- `panelKey` is opaque metadata passed to props. It never resolves a module or component name.
- The host keeps dialog header/footer, validation summary, `Cmd/Ctrl+Enter`, `Escape`, loading state, conflict bar, and retry behavior.
- Module panels use shared primitives, semantic tokens, `useT()`, and accessible labels/focus behavior.
- A missing/disabled component contribution renders `DefaultEventTypePanel`.
- An error thrown while rendering a composed wrapper component or replacement is isolated by the existing UMES boundary; the plain default panel renders and current values remain in the host form. Wrapper-factory and props-transform code must remain pure/non-throwing because it executes before that boundary.
- A contributor needing data fetching uses scoped public APIs and loading/error primitives but cannot bypass server-side event-type validation.

Prototype: [configurable calendar event types](../prototypes/configurable-calendar-event-types/index.html). Screen 5 illustrates an HRM `site-visit` panel inside the host form. The artifact is illustrative and uses synthetic data.

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
3. Add type-specific wrapper and replacement fixtures through `widgets/components.ts`.

*Exit:* every type traverses the host and a missing/disabled contribution renders the unchanged default.

### Phase B — Override tiers and safety

4. Add `modules.ts` fixtures and the mirrored, synchronous `applyProgrammaticComponentOverrides()` app/template hook invoked before server and browser registration; do not add a calendar-specific component registry.
5. Add props-transform/wrapper/replacement precedence, SSR→hydration programmatic persistence, existing error-boundary behavior, form-state preservation, module-disabled, and no-capability-leak tests.
6. Document the three paths beside AI/component override documentation and add frozen surfaces to `BACKWARD_COMPATIBILITY.md` and `UPGRADE_NOTES.md`.

*Exit:* file, inline, and programmatic tiers behave exactly like other UMES/AI UI parts and preserve host safety.

### Phase C — Verification

7. Run generation, component-registry and focused UI tests, package build, client-boundary checks, typecheck, lint, integration tests, app build, DS review, and standalone-harness refresh.

## Integration coverage

Fixtures use a canonical example module and clean created records in `finally`.

- **TC-CETP-001 — default and module lifecycle:** render every core/contributed type through the handle, disable the contributor, and verify default fallback plus unchanged persisted data.
- **TC-CETP-002 — React override tiers:** target the handle through file, `modules.ts`, and the dual-runtime programmatic UMES hook; verify existing precedence, `null` fallback, composed-state introspection, internal reset isolation, and the same component before/after hydration.
- **TC-CETP-003 — type-specific wrapper:** branch on `definition.key` and `panelKey`, delegate other types to `Original`, change a sanctioned field through `setValue`, and submit through the host.
- **TC-CETP-004 — host authority:** verify no submit/network callback is present, generic custom-field widgets and selected-type `onBeforeSave` validation still run under default/wrapped/replaced panels; `Cmd/Ctrl+Enter`, `Escape`, guarded mutation, optimistic locking, conflicts, and retry remain host-owned.
- **TC-CETP-005 — render failure boundaries:** force a composed wrapper-component render error and a replacement render error, assert the plain default fallback preserves the draft, and verify current UMES diagnostics omit form values while allowing unknown wrapper attribution; separately prove wrapper-factory/props-transform errors are outside the fallback guarantee.
- **TC-CETP-006 — optional-module isolation:** run module-decoupling and bundle checks with customers absent and with the contributor disabled; assert no unresolved import/loader and no unrelated-route panel chunk.

## Risks

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Custom code bypasses host safety | High | No mutation callbacks; server validation; wrapper-first docs; real guard/locking tests | Trusted code can import APIs, so review remains necessary |
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

- Clarified that panel overrides preserve the selected-type mounted widget validation owned by the extension spec.
