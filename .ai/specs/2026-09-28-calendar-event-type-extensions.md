# Calendar Event Type Extensions

**Status:** Proposed  
**Issue:** [#6684](https://github.com/open-mercato/open-mercato/issues/6684)  
**Related:** [CRM Calendar](./2026-06-11-crm-calendar.md), [Configurable Calendar Event Types](./2026-09-28-configurable-calendar-event-types.md)

## TLDR

Allow enabled modules to add, patch, hide, wrap, or replace calendar event types without importing into or forking the customers module. A generated `calendar-event-types.ts` registry supplies static type metadata and behavior, while one UMES component handle supplies custom React panels inside the existing `CrudForm` host. The capability works without tenant behavior overrides; the shipped six definitions plus module contributions form a complete catalog on their own.

Persisted `CustomerInteraction.interactionType` strings remain durable. A module disappearing hides its types from new selection but historical records still open through a safe fallback. Module panels receive form capabilities, not submit or network authority.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Why | Confirm? |
|---|---|---|---|---|
| Q1 | Should module extensions share the administrator-configuration spec? | No; publish a linked companion spec. | A fresh-context review found two independently deployable capabilities. | Reversible |
| Q2 | What does a module “delete” mean? | A `null` tombstone hides a key from new selection only. | Modules must not delete dictionary rows or rewrite historical interactions. | Reversible |
| Q3 | How can modules customize React? | One exact UMES panel handle supports props transforms, wrappers, and replacement inside the host `CrudForm`. | It reuses the canonical extension system and preserves mutation guards. | Reversible |

## Goals and non-goals

### Goals

- Discover module-owned type definitions and overrides through generated enabled-module facts.
- Compose contributions deterministically with provenance, collision diagnostics, and process-global idempotent registration.
- Let every core and contributed type traverse the same UMES panel handle.
- Preserve host-owned submission, optimistic locking, custom-field injection, mutation guards, and keyboard behavior.
- Degrade gracefully when an optional contributing module is disabled.

### Non-goals

- Tenant/admin configuration; the linked configurable-types spec owns that overlay.
- Dynamic importing arbitrary components by metadata key.
- Direct ORM relations from customers to optional modules.
- Giving module panels a raw submit, request, or transaction callback.
- Renaming stored interaction type values.

## User stories and acceptance criteria

### US-B1 — Contribute a vertical type

As an HRM module author, I want to contribute a `site-visit` type with visit semantics so CRM users can schedule it without a customers fork.

- An enabled module can add a stable-key definition through `calendar-event-types.ts`.
- Generation fails on duplicate base definitions and identifies both owners.
- The exact key is selectable and persists byte-for-byte.
- Disabling the module removes the type from new selection but historical records still render/edit through fallback.

### US-B2 — Patch or hide an existing type

As a module author, I want to extend or hide a core/contributed type when my module is enabled.

- A partial patch changes only declared properties; arrays replace instead of concatenate.
- A `null` override is a selection tombstone, not a data deletion.
- Resolution order and winning provenance are observable and pinned by tests.
- App/test programmatic overrides use the same normalized entry contract.

### US-B3 — Supply custom React

As a module author, I want a visit-specific panel while customers retains the canonical form lifecycle.

- Wrappers/props transforms are the preferred extension; full replacement remains possible.
- The stable props expose type metadata, mode, values, errors, `setValue`, disabled state, and capabilities.
- The panel receives no submit or raw network callback.
- A module needing durable data uses sanctioned custom fields or its own extension entity linked by ID.

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
                           └── resolve base + patch + tombstone
                                ├── catalog API / CalendarEventEditor
                                └── optional admin overlay from companion spec

widgets/components.ts
  └── section:customers.calendar-event-editor.type-panel
       └── props → wrapper → replacement
            └── existing CrudForm owns submit/locking/injections
```

The registry is metadata, not a second interaction store. Customers owns the host and resolver. Contributors declare facts at build time and optional UI overrides through the existing component registry. No runtime import from customers to HRM or another optional peer is permitted.

## Public registry contract

The public contract lives at `@open-mercato/core/modules/customers/calendar-event-types`:

```ts
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

export const calendarEventTypes: CalendarEventTypeDefinition[]
export const calendarEventTypeOverrides: Record<
  string,
  Partial<CalendarEventTypeDefinition> | null
>
```

`CalendarEventTypeBehavior` is imported from the customers-owned resolver contract and defaults to the six stable base kinds. This extension can ship before administrator overlays because every definition is complete after static composition.

### Discovery and generation

`packages/core/src/modules/customers/generators.ts` adds a generator plugin scanning the additive convention `calendar-event-types.ts` in enabled modules and emitting `calendar-event-types.generated.ts`. `yarn generate` is mandatory after contributions change.

- Keys are trimmed lowercase dictionary keys under the existing length limit.
- Duplicate base definitions fail generation; changes to existing keys use overrides.
- Generated entries preserve module ID, source path, and enabled-module order.
- Generated module facts declare the new convention and exact UMES host.
- Registration occurs before route/UI resolution and uses the established `globalThis` registry pattern.
- Re-registration replaces the same module entry idempotently for development/test reloads.

The new convention and public export path become frozen after release and require the normal deprecation protocol thereafter.

### Composition rules

1. Start with the immutable six-type customers baseline.
2. Append enabled-module definitions in generated module order.
3. Apply enabled-module patches/tombstones in generated module order.
4. Apply programmatic app/test overrides.
5. Optionally pass the result to the administrator overlay resolver from the companion spec.

A later patch wins per property. Arrays replace. Each output item records the winning property provenance. A collision diagnostic contains module IDs and keys, never loaded source or credentials.

`null` makes a key non-selectable for new records. `resolveCalendarEventType(key, { includeHistorical: true })` still returns the last known base semantics or the meeting-shaped compatibility fallback. Disabling a module has the same selection effect without persisting a tombstone.

`panelKey` is opaque metadata exposed to panel props; it never loads code. React arrives only through `widgets/components.ts`.

## UMES component contract

Customers declares and binds exact handle:

`section:customers.calendar-event-editor.type-panel`

with versioned props contract `customers.calendar.event-type-panel.v1`:

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

`CalendarEventEditor` resolves `useRegisteredComponent(handle, DefaultEventTypePanel)` inside its existing single `CrudForm`. Every core/contributed type uses that component path; there are no hard-coded tabs that bypass it.

The props intentionally omit submit, delete, `apiCall`, transaction, and request-header callbacks. A replacement can still import APIs on its own, so server validation and code review remain the enforcement boundary. Documentation requires wrappers/props transforms unless full visual replacement is necessary.

Existing frozen spots `crud-form:customers.customer_interaction` and `crud-form:customers.customer_interaction:fields` remain unchanged. A panel can address sanctioned custom fields or extension entity IDs, but no direct ORM relationship is added.

## API and runtime behavior

No new mutation route is introduced by this spec. The effective catalog endpoint defined by the companion spec may expose static registry metadata when that companion ships; before then, the current calendar/editor may consume the same resolver service through its existing server bootstrap.

Registry output includes only serializable metadata: key, label/i18n key, appearance, behavior, selectable state, module provenance, configurability, and panel key. It never serializes functions or component loaders.

Interaction create/update remains owned by customers. It verifies that new values use an effective selectable key. Historical updates of an unavailable unchanged key are allowed through fallback semantics. Module disable cannot erase or rewrite customer data.

## UI/UX behavior

- Contributed types appear in the existing calendar type selector in resolved order and use exact keys.
- Module provenance is visible in the activity-type manager when the companion admin feature is present.
- A non-configurable contribution is read-only in that manager.
- A module-owned panel renders within the same dialog header, footer, validation summary, keyboard behavior, and conflict surface as core types.
- When a module is disabled, an existing record shows the raw key plus a localized “Type no longer available” warning and the default panel fallback.
- If a wrapper/replacement throws, the error boundary reports it and renders the default panel with a localized warning; the entire event draft is not discarded.

Prototype: [configurable calendar event types](../prototypes/configurable-calendar-event-types/index.html). Screen 5 illustrates an HRM `site-visit` panel inside the host form. The artifact is illustrative and uses synthetic data.

## Frontend Architecture Contract

| Surface | Server root | Client island | Reason |
|---|---|---|---|
| Calendar editor | existing server page | existing lazy `CalendarEventEditor`; extracted `EventTypePanel` leaf | selected-type reactivity and component-registry lookup |

No page-root client component, provider, or heavy dependency is added. The generated registry is registered by the existing bootstrap mechanism; the component override registry already exists. The panel leaf stays under 300 LOC, and module-owned panels must follow their module's boundary budget.

Required evidence: `yarn check:client-boundaries`, `yarn generate`, `yarn build:packages`, `yarn build:app`, a hydration test for the default and replacement panels, and bundle output proving no module panel is pulled into unrelated routes when disabled.

## Failure modes and observability

| Failure | User behavior | System behavior |
|---|---|---|
| Duplicate base key | build does not ship | generator fails with both module owners |
| Patch targets unknown key | build warning or configured strict failure | diagnostic names module/key; baseline remains valid |
| Registry registration repeats | no visible change | replace same module entry idempotently |
| Contributing module disabled | type absent from new selection; historical warning | fallback preserves exact key and stored data |
| Custom panel throws | default panel + localized warning | error boundary reports module/type/handle, no form values |
| Registry unavailable at runtime | shipped types remain usable | report error and use immutable baseline |

Structured logs include module ID, type key, phase, and winning provenance but no interaction values or credentials.

## Security and compatibility

- Registry declarations are trusted code shipped with enabled modules, never tenant-authored executable input.
- Metadata is zod-validated before registration and normalized to immutable output.
- No direct cross-module ORM relation or mandatory dependency on an optional contributor is introduced.
- Existing interaction values, routes, methods, events, CrudForm spots, and exports remain stable.
- New auto-discovery filename, public exports, generated fact, and component handle are additive but frozen once released.
- Removing the extension machinery leaves interactions intact and returns the app to the six core definitions.

## Implementation plan

### Phase A — Registry and generation

1. Add public zod/types, six immutable definitions, normalized process-global registry, and unit tests for add/patch/null/collision/provenance/fallback.
2. Add the customers generator plugin and discovery convention; emit/register generated entries and extend generated module facts.
3. Add one synthetic `site-visit` contribution in the canonical example; mirror any app-template changes and refresh the standalone harness contract.

*Exit:* enabled modules deterministically change the in-memory catalog and disabling the example preserves historical fallback.

### Phase B — UMES host

4. Declare the exact component host and versioned props type.
5. Extract/bind `EventTypePanel` through `useRegisteredComponent` while preserving the single `CrudForm`, existing injection spots, locking, and keyboard behavior.
6. Add a real wrapper/replacement fixture and error-boundary coverage.

*Exit:* core and contributed types traverse the same host, and a module panel cannot take over submission through provided props.

### Phase C — Verification and documentation

7. Document contribution, precedence, tombstones, panel safety, and compatibility in framework docs and `UPGRADE_NOTES.md` where required.
8. Run generation, module-decoupling tests, focused UI tests, package build, typecheck, lint, integration test, app build, DS review, and standalone-harness refresh.

## Integration coverage

Fixtures use the canonical example module and clean all created records in `finally`.

- **TC-CETE-001 — contribution lifecycle:** enable the example `site-visit` definition, verify catalog key/provenance/order and exact interaction persistence; disable it and verify new selection removal plus historical fallback without rewrite.
- **TC-CETE-002 — patch and tombstone:** patch one core definition and tombstone another; verify last-wins property provenance, replacement-array behavior, hidden selection, and unchanged historical edits.
- **TC-CETE-003 — UMES panel:** wrap the shared panel with a synthetic field, verify values flow through host setters and submission/locking remain host-owned; force a render error and verify the default-panel fallback preserves the draft.
- **TC-CETE-004 — module decoupling:** run the repository module-decoupling fixture with the contributor absent and assert no unresolved first-party target, import, generated loader, or route failure.

## Risks

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Registry collision or load-order drift | High | Fail duplicate definitions; generated stable order; provenance snapshots | Intentional competing patches remain last-wins |
| Custom panel bypasses host safety | High | No submit/network props; server validation; real wrapper tests and docs | Arbitrary code can import APIs, so review remains necessary |
| Disabled module strands records | Medium | Exact keys persist; disable affects selection only; historical fallback | Specialized fields are unavailable until module returns |
| Generated contract breaks third parties | High | Additive convention, frozen exports/handle, deprecation protocol | Future schema evolution needs compatibility bridges |

## Final compliance report

### Sources reviewed

- `AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`
- `packages/core/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`, shared override/component-registry contracts
- `.ai/ds-rules.md`, `.ai/ui-components.md`, frontend architecture contract guidance

### Compliance matrix

| Rule | Status | Notes |
|---|---|---|
| Scope cohesion | Pass after split | Static module contributions and UMES host function without administrator overlays |
| Module isolation | Pass | Generated facts + registry + UMES; no direct optional-module imports/ORM links |
| Generated files and naming | Pass | Additive convention, generator plugin, mandatory `yarn generate`, frozen published surfaces |
| Host safety | Pass | One `CrudForm`; existing spots/guards/locking remain; panel props exclude submission |
| Compatibility | Pass | Durable keys, historical fallback, additive public contracts, deprecation policy |
| Security/privacy | Pass | Trusted code contributions, zod metadata, no new persistence/PII |
| Design system/i18n/a11y | Pass | Host retains shared primitives/tokens/copy/keyboard semantics |
| Integration coverage | Pass | Lifecycle, precedence, panel fallback, and module decoupling covered |
| Frontend contract | Pass | One bounded client leaf; no provider/page-root/heavy dependency expansion |

### Verdict

Approved for review. The extension-registry capability is independently deployable and linked to, but not coupled to, the administrator configuration spec.

## Changelog

### 2026-09-28 — Initial proposal

- Split module-owned extension contracts from administrator configuration after independent scope review.
- Defined generated registry composition, tombstone/history behavior, exact UMES panel contract, and module-decoupling coverage.
