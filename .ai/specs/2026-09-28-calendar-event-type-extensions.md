# Calendar Event Type Extensions

**Status:** Proposed  
**Issue:** [#6684](https://github.com/open-mercato/open-mercato/issues/6684)  
**Related:** [CRM Calendar](./2026-06-11-crm-calendar.md), [Configurable Calendar Event Types](./2026-09-28-configurable-calendar-event-types.md), [Calendar Event Type React Panels](./2026-09-28-calendar-event-type-react-panels.md)

## TLDR

Customers owns a six-type calendar foundation, a scoped read API, and authoritative interaction validation. Other enabled modules contribute event types and patches through the existing widget injection system; apps can configure overrides in `modules.ts`; bootstrap or runtime code can add, patch, disable, and remove contributions through a customers-owned DI service. No calendar-specific generator, convention file, or generated event-type registry is introduced. Optional contributors must continue loading when customers is disabled, with a diagnostic for the unused contribution.

When a widget for the selected event type is mounted in the calendar form, its `onBeforeSave` handler can block a save and return field errors through the existing `CrudForm` injection pipeline, as the catalog SEO widget does. Server-side rules remain authoritative for direct API callers.

## Goals and non-goals

### Goals

- Reuse `widgets/injection/<name>/widget.ts`, `widgets/injection-table.ts`, existing widget overrides, and the unified `modules.ts` override dispatcher.
- Compose the six customers definitions, enabled widget declarations, app configuration, and programmatic changes deterministically; expose the result to the separate administrator overlay.
- Expose a small programmatic API through Awilix, with explicit removal and cleanup semantics.
- Allow optional modules to reference the public calendar contract by type without hard dependencies or customers-owned imports of contributor code.
- Keep exact persisted `CustomerInteraction.interactionType` keys, historical fallback, mutation guards, optimistic locking, and undo behavior.
- Let a mounted selected-type widget validate the form before save without giving it mutation authority.

### Non-goals

- A new `calendar-event-types.ts` auto-discovery convention, generator plugin, or `calendar-event-types.generated.ts` artifact.
- A second calendar form or component registry. The optional React-panel companion uses existing UMES component replacement.
- Tenant-authored JavaScript, executable dictionary configuration, or direct ORM relationships across modules.
- Treating browser widget validation as a substitute for server validation.

## User stories and acceptance criteria

### US-B1 — Contribute types through widgets

An enabled HRM module can expose a `site-visit` type from a declarative, headless injection widget mapped to the customers calendar-type spot. The type appears in the scoped catalog and editor and persists with its exact key. Disabling HRM removes it from new selection while existing records open with a raw-key warning and compatibility fallback. Duplicate base keys produce a deterministic conflict diagnostic; an explicit override is required to change another owner's definition.

### US-B2 — Configure and change types

An app can replace, patch, or disable a type through `ModuleEntry.overrides.calendar`. Code can use the DI registry to add a type, change it, disable selection, and remove its contribution. Each operation is validated before it changes the effective catalog. Removing a higher-tier contribution reveals the next surviving tier; it never deletes interactions or dictionary rows.

### US-B3 — Validate selected types in the form

An optional module can map a UI widget to the existing interaction `CrudForm` spot and declare which event-type keys activate it. The calendar host mounts only widgets applicable to the selected key. A mounted widget's `onBeforeSave` can return `{ ok: false, message, fieldErrors }`; `CrudForm` shows the same inline errors and prevents its write. Switching to another key unmounts the widget and removes its validator. Direct API requests still pass customers-owned validation and any explicitly registered server-side rule.

### US-B4 — Survive absent optional peers

The contributing module has no hard `requires: ['customers']`. With customers disabled, the module loads and its unrelated features work; its calendar declaration is inert and a structured warning names the module, widget ID, and missing host. A programmatic caller uses a local `tryResolve` helper; absent `calendarEventTypeRegistry` yields the same optional-integration warning and a no-op, never a boot failure.

## Market reference

[Backstage extension overrides](https://backstage.io/docs/frontend-system/architecture/extension-overrides/) distinguish routine configuration from explicit overrides and avoid mutating the original extension. This spec makes common event-type customization declarative through widgets and module config, while the DI API provides explicit source-owned overrides and removal. It reuses Open Mercato's widget and override infrastructure rather than adopting Backstage's separate frontend extension model.

## Architecture

```text
enabled widget injection tables ──> calendar:customers.event-types ──┐
modules.ts overrides.calendar ────────────────────────────────────────┤
Awilix calendarEventTypeRegistry operations ─────────────────────────┤
six customers definitions ───────────────────────────────────────────┤
                                                                      ▼
                                              customers calendar resolver
                                               ├─ scoped catalog API
                                               ├─ CalendarEventEditor
                                               └─ interaction commands

selected key ──> mounted crud-form:customers.customer_interaction widget
                     └─ existing onBeforeSave / fieldErrors pipeline
```

Customers owns the foundation, resolver, DI service, route, and command validation. The extension module owns its widget declaration and any widget UI or server rule. The generic widget registry discovers enabled modules as it does today; implementation may expose its already registered widget entries to the server resolver, but must not add a calendar-specific generation pass or generated exports. Existing generic `yarn generate` obligations for newly added widget files still apply.

### Canonical foundation ownership

This spec alone defines `CalendarEventBaseKind`, `CalendarEventTypeBehavior`, `CalendarEventTypeDefinition`, `EffectiveCalendarEventType`, six immutable baseline definitions, the meeting-shaped historical fallback, `resolveCalendarEventTypes()`, and the minimal `GET /api/customers/activity-types` route. The customers foundation, catalog route, editor consumption, and command key validation ship together before widget contributions are enabled. The administrator-configuration companion adds scoped dictionary overlays to this resolver and route; it does not redeclare them. The React-panels companion consumes `EffectiveCalendarEventType` and can fall back when `panelKey` is absent.

The public contract stays at `@open-mercato/core/modules/customers/calendar-event-types`. `CalendarEventBaseKind` is `'meeting' | 'call' | 'email' | 'note' | 'event' | 'task'`. The versioned behavior contains `baseKind`, `selectable`, `order`, closed core-field applicability (`endTime`, `allDay`, `recurrence`, `location`, `people`, `priority`, `resources`), and `customFieldsetIds`. A definition contains a stable `key`, localized label metadata, appearance, behavior, optional `adminConfigurable`, and optional opaque `panelKey`. The existing six keys and persisted strings are immutable. Zod validates definitions and all contribution paths against the same closed schema; fieldset IDs and order use the bounds in the configurable-types companion.

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
```

`EffectiveCalendarEventType` carries the resolved definition plus selectability, source provenance, and a historical-fallback marker. The administrator companion adds inherited/local state and nullable `updatedAt` without removing these base fields.

The exported patch contract is bounded and stable:

```ts
type CalendarEventTypePatch = {
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
```

`replaceFields` accepts only named core fields; list operations run replace, then delete, then append. Unknown behavior keys, arbitrary callbacks, and a patch that changes `key` are rejected.

### Widget contribution contract

Add one headless data-widget payload to the existing injection widget union, with declarative arrays/maps of base definitions, full overrides (`definition | null`), and patches. The public spot is `calendar:customers.event-types`. A module maps its widget ID to this spot in its normal `widgets/injection-table.ts`; there is no new root module file. The payload is serializable metadata, without React components, callbacks, service instances, tenant values, or interaction values. The generic widget loader must recognize this payload kind and expose it to the customers server resolver. It loads only widgets mapped to the spot, through existing enabled-module and widget-override gates; it must not load all widgets in an API request.

The server registration path is explicit: bootstrap registers the existing generic widget entries/tables in the server runtime before the first catalog or command resolution, and customers asks the generic loader for this exact spot. Re-registration replaces a source's prior declaration for HMR/tests. A cache version change invalidates composed definitions and tenant/organization catalog caches. No browser-only widget registry may become the source of truth for the server. The browser receives effective serializable definitions from the catalog API, not widget module functions.

The host checks the enabled module set before loading optional contributions. A table entry from a module whose host is absent remains legal; its widget is not evaluated and one structured warning is emitted per registration/version. Do not set `metadata.requiredModules: ['customers']` on an otherwise optional widget solely to hide the warning: the explicit missing-host diagnostic is part of this contract. The host never imports optional modules. Contributors may use `import type` from the public customers contract and `tryResolve()` for optional runtime services, but may not import customers entities, private editor code, or service implementations.

### Composition and precedence

1. Start with the immutable six-type customers baseline.
2. Add definitions from enabled widgets in stable enabled-module order, then injection-table priority and widget ID. A duplicate base key is rejected with both owners named; later changes use an override or patch.
3. Apply complete replacement/`null` maps from widget declarations, then `modules.ts` entries in enabled-module order, then DI programmatic operations. The last override in a tier wins. A higher-tier definition can re-enable a lower-tier tombstone; `null` hides new selection only.
4. Apply patches from widgets, then `modules.ts`, then programmatic code to surviving definitions. Patches cannot change a key or resurrect a missing/disabled definition. Fieldset list operations run replace → delete → append with exact-ID de-duplication.
5. The administrator companion applies inherited and local organization dictionary overlays last, only where `adminConfigurable !== false`.

Every effective property records source tier and module/widget or programmatic owner. A non-null replacement for an unknown key may add a synthetic type with a warning; a `null` for an unknown key is a warning/no-op. Malformed entries are rejected atomically per source with no partial application. Snapshots are immutable and exclude tenant labels, interaction values, and executable code.

## Module configuration and programmatic API

The unified override umbrella adds a loose `ModuleOverrides.calendar` shape in shared and a customers-owned zod-parsing `calendar` applier. Its public, typed form is:

```ts
type CalendarOverrides = {
  eventTypes?: Record<string, CalendarEventTypeDefinition | null>
  patches?: CalendarEventTypePatch[]
}
```

For example, an optional module's `modules.ts` entry can hide `note` and alter `meeting` without importing customers at runtime:

```ts
{
  id: 'my_custom_overrides',
  from: '@app',
  overrides: {
    calendar: {
      eventTypes: { note: null },
      patches: [{ targetEventTypeKey: 'meeting', replaceOrder: 25 }],
    },
  },
}
```

The existing `applyModuleOverridesFromEnabledModules()` call dispatches the domain in module order. Register the customers applier only when customers is enabled in each app and create-app bootstrap path, including CLI/worker paths; no unconditional customers import or second global bootstrap call. The dispatcher must tolerate a missing optional domain applier with a diagnostic. An integration test proves an inline-only override reaches both server and client catalog consumers.

`calendarEventTypeRegistry` is an Awilix-resolved application-singleton customers service, registered only when customers is enabled. Its public interface uses stable `sourceId` ownership:

```ts
interface CalendarEventTypeRegistry {
  upsert(sourceId: string, definition: CalendarEventTypeDefinition): void
  replace(sourceId: string, key: string, definition: CalendarEventTypeDefinition | null): void
  patch(sourceId: string, patch: CalendarEventTypePatch): void
  remove(sourceId: string, key: string): void
  removeSource(sourceId: string): void
  snapshot(): Readonly<CalendarEventTypeRegistrySnapshot>
}
```

`upsert` adds or updates the caller's own base definition; it cannot silently overwrite another owner's base. `replace` is the explicit cross-owner full override or selection tombstone. `patch` is the bounded partial edit. `remove` clears that source's base/override/patch contributions for one key; `removeSource` is teardown for a module reload or test. Neither deletes persisted customer data. Repeating the same input is idempotent. Registry operations validate first, update an immutable process-local snapshot with definitions, source provenance, and version, then invalidate affected catalog caches. Programmatic changes are process-local; multi-worker deployments register the same declarations in each worker at bootstrap. Runtime changes across workers require application-level coordination and are not advertised as globally transactional.

An optional module resolves the service inside a local `tryResolve` helper. Failure to resolve because customers is disabled logs one missing-host warning and returns without changing its other module behavior. Other DI failures propagate; they are not mistaken for an absent peer. No customer service resolves the optional module.

## Required implementation example

Ship a small enabled example module under `apps/mercato/src/modules/` with a headless calendar-type widget mapped through `widgets/injection-table.ts`, and a separate conditional interaction-form widget. The example must demonstrate all three operations without a customers source edit:

```ts
// Declarative payload in the example module's calendar-type widget
eventTypes: [{ key: 'site-visit', /* complete bounded definition */ }],
overrides: { note: null },
patches: [{ targetEventTypeKey: 'meeting', replaceLabelKey: 'example.customerMeeting' }],

// Optional bootstrap/teardown code, after tryResolve('calendarEventTypeRegistry')
registry?.upsert('example', fieldAuditDefinition)
registry?.patch('example', { targetEventTypeKey: 'meeting', replaceOrder: 25 })
registry?.remove('example', 'field-audit')
```

The tested example must make the distinction visible: the widget adds `site-visit`, the patch modifies `meeting`, the `null` override hides `note`, and DI adds then removes its own `field-audit` definition. A separate test removes a programmatic override of an existing key and verifies that the lower widget/base tier becomes effective. Show the equivalent app-level `overrides.calendar` form in documentation. Run the example module with customers disabled and assert the app and unrelated module behavior still work to prove the calendar seam is optional. Example code must keep translated labels and complete valid definitions; the abbreviated snippet above is explanatory only.

## Mounted widget validation

The form continues to use its existing `crud-form:customers.customer_interaction` spot. Add optional `calendarEventTypeKeys` metadata to injection widgets (or an equivalent typed applicability predicate owned by the host). The host passes the selected effective key in injection context, filters applicable widgets before rendering and before event dispatch, and runs `onBeforeSave` only for an active mounted widget. The filter must apply equally to create/update, validation, required-field markers, and `onAfterSave`; changing the selected type unmounts the old widget and clears its widget-origin field errors. Global mutation widgets without a type filter continue to behave as today.

The example module's selected-type widget renders a site-visit helper and returns `{ ok: false, message, fieldErrors: { location: ... } }` for an invalid site visit. `CrudForm` merges these errors with its normal field errors and blocks submission, matching catalog SEO behavior. The host retains one form, submit/delete buttons, guarded mutation, optimistic-lock header, conflict bar, keyboard shortcuts, and retry. Widget code receives no submit callback or mutation authority. A disabled, hidden, unmounted, or nonmatching widget cannot block the save. Loading must settle before submit so a matching validator is not silently skipped; load failure shows a localized retry state and fails closed for that selected widget.

Browser `onBeforeSave` improves the editor experience but is bypassable by direct API callers. The customers command always validates key selectability, bounded core fields, applicable fieldsets, ACL, scope, and optimistic locking. A contributor with additional business invariants must register an optional server-side mutation guard or command interceptor through the existing contract, keyed to its selected type; the example includes such a rule and tests the same invalid request through the API. A missing contributor removes its extra rule while customers' core safety checks remain. Never execute React widget handlers on the server as the validation authority.

## API and runtime behavior

`GET /api/customers/activity-types[?organizationId=<uuid>]` requires authentication and `customers.interactions.view`, exports OpenAPI, and returns `{ items: EffectiveCalendarEventType[], fallbackKey: 'meeting' }`. It uses the same server resolver as interaction create/update, scoped by tenant and organization. Items contain effective appearance, behavior, selectability, provenance, `adminConfigurable`, and `panelKey`, but no widget functions or loaders. Cache keys and tags are tenant/organization scoped; registry version changes invalidate static composition and relevant scoped responses. If authoritative widget/config resolution fails, the route returns a retryable error and commands fail closed. The editor may use the immutable six definitions only to display an existing draft, with selection and save disabled until the scoped catalog reloads; it never reuses another scope's cache or treats baseline fallback as proof that a key is selectable.

Existing interaction create/update rejects a missing or disabled changed key, while an unchanged historical key remains editable through the compatibility fallback. New type-specific server guards run in the guarded mutation flow after core validation and before persistence. No new interaction mutation route is introduced. A stored key is never rewritten because a widget, module, config entry, or programmatic contribution disappears.

## Failure modes and observability

| Failure | User behavior | System behavior |
|---|---|---|
| Duplicate widget base key | lower/base definition remains | reject later declaration; log both owners and keys |
| Invalid widget or app override | last valid tier remains | zod rejection per source, no partial registration; structured warning |
| Patch targets missing/disabled key | no change | skip with module/widget/source warning |
| Customers disabled | contributor's unrelated features work | calendar payload inert; one missing-host warning, no hard import or `requires` |
| Contributing module disabled | historical raw key and fallback; no new selection | widget/rule unloaded; data retained |
| Matching widget fails to load | localized retry; save waits | do not silently bypass mounted validation |
| Registry or scoped catalog unavailable | localized retry; baseline display only, selection/save disabled | retryable route error; command fails closed; no cross-scope cached value |
| Programmatic source removed | lower tier becomes effective | invalidate versioned composition/cache; never delete interactions |

Logs identify source tier, module/widget ID, type key, operation, and outcome. They exclude interaction content, tenant-authored labels, credentials, and form values.

## Security and module safety

- Only trusted enabled module code may define widget payloads or use the DI API; tenant dictionary configuration stays declarative and bounded.
- Metadata and programmatic calls are zod-validated before registry changes; the server enforces scope, ACL, core applicability, and guards on every direct write.
- Customers never imports an optional contributor, creates cross-module ORM relations, or unconditionally resolves its service.
- Generic widget gates and the selected-type filter use the enabled-module set and wildcard-aware feature checks. Client-side widget visibility does not authorize an API write.

## Migration & Backward Compatibility

- Existing six-type behavior and stored interaction strings remain stable when there are no contributions.
- Existing widget spots, mutation hooks, module override domains, route URLs, and dictionary rows remain intact. The new spot, payload kind, metadata field, calendar override domain, DI key, and public resolver/types are additive contracts; record them in `BACKWARD_COMPATIBILITY.md` and `UPGRADE_NOTES.md` before release.
- No calendar-specific generated contract exists. Existing generic widget auto-discovery output remains governed by its current compatibility contract.
- `editorKindOfInteractionType()` remains as a deprecated bridge for at least one minor version. Removing an event-type contribution changes new selection only and preserves historical fallback.
- The administrator and React-panel companion specs depend on this foundation but can ship without any optional contributor.

## Implementation plan

### Phase A — Customers foundation

1. Add the canonical public zod schema/types, six definitions, historical fallback, and resolver with tests for key stability and behavior bounds.
2. Add the scoped catalog route/OpenAPI, consume it in `CalendarEventEditor`, and replace hard-coded selection and command key validation with the same resolver. Test authoritative-read failure as retryable and nonselectable.

*Exit:* the six customers types work end-to-end through the owned API, editor, and commands before any optional contribution is enabled.

### Phase B — Widget, configuration, and programmatic control

3. Extend the existing headless widget union/loader for the calendar spot, register generic widget entries/tables on the server before resolver use, and test enabled-module order, collision diagnostics, invalid-source atomicity, HMR replacement, and customers-absent boot.
4. Add the shared loose `overrides.calendar` domain and customers applier through existing app/create-app, CLI, and worker bootstraps. Test inline-only dispatch and widget → inline precedence.
5. Register the Awilix `calendarEventTypeRegistry` service; implement `upsert`, `replace`, `patch`, `remove`, `removeSource`, immutable snapshots, source ownership, versioned invalidation, and soft-optional `tryResolve` tests.
6. Add the example module showing a widget-added type, widget and inline modification/disablement, and DI add/patch/remove, plus the customers-disabled scenario.

*Exit:* every contribution tier resolves deterministically and programmatic removal reveals the next tier.

### Phase C — Selected-type validation

7. Add selected-key widget applicability and mounted `onBeforeSave` behavior to the existing `CrudForm` host. Add the example widget's field error and optional server mutation rule; preserve global widget behavior and host submission authority.

*Exit:* the example event can be created and edited, its mounted widget blocks invalid form saves, and direct API writes enforce the server rule.

### Phase D — Verification and documentation

8. Document the widget payload, module-config overrides, DI lifecycle, missing-host warnings, server guard requirement, and example; update compatibility notes and standalone harness coverage.
9. Run generic `yarn generate` only where normal widget auto-discovery requires it, module-decoupling tests, focused UI/unit tests, package build, typecheck, lint, integration tests, and app build.

## Integration coverage

Fixtures create records through APIs and remove them in `finally`; no test relies on demo data.

- **TC-CETE-001 — widget contribution lifecycle:** enable the example widget, verify scoped API/editor selection and exact-key persistence; disable it and verify mutation rejection for new use plus unchanged historical fallback.
- **TC-CETE-002 — add/modify/remove:** verify widget addition, a patch to `meeting`, a `note` tombstone, an inline override, DI `upsert`/`patch`/`remove`/`removeSource`, deterministic precedence, cache invalidation, and immutable provenance snapshot.
- **TC-CETE-003 — optional module decoupling:** boot with customers absent and contributor enabled; assert one warning and working unrelated contributor functionality. Boot with contributor absent and customers enabled; assert six baseline types and no unresolved import.
- **TC-CETE-004 — mounted validation:** select `site-visit`, mount its widget, return `fieldErrors.location`, block save, then switch type and verify the widget unmounts and no longer blocks. Assert feature-hidden/disabled widgets do not run and a failed matching widget load cannot silently allow save.
- **TC-CETE-005 — direct API enforcement:** submit the same invalid site visit through the API; verify the optional server rule blocks it while core key/field/scope checks remain with the contributor disabled.
- **TC-CETE-006 — bootstraps:** declare only `overrides.calendar` and verify dispatch before the first resolver read in Next.js, CLI/worker, and create-app template, with no unwired-domain warning while customers is enabled.

## Risks

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Widget declarations drift between server and client | High | Server resolver is authoritative; editor reads catalog API; hydration and direct API tests | A stale client may need retry |
| Client widget rule mistaken for authoritative validation | High | Explicit server guard example and direct API test; customers always checks core invariants | Optional business rule disappears when its module is disabled |
| Process-local programmatic changes differ across workers | Medium | Require identical bootstrap registration; document external coordination for live changes | A caller can still misconfigure one worker |
| Optional host unavailable | Medium | Soft `tryResolve`, no hard dependency, one structured warning and module-decoupling tests | Calendar contribution has no effect until host is enabled |
| Competing definitions or patches | Medium | Reject duplicate bases; deterministic precedence, provenance, and diagnostics | Explicit competing overrides remain last-wins |

## Final compliance report

### Sources reviewed

- `AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`
- `packages/core/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`, existing injection-loader and catalog SEO widget contracts

### Compliance matrix

| Rule | Status | Notes |
|---|---|---|
| Scope cohesion | Pass with staged foundation | Foundation/API/commands ship first; selected-type validation completes the widget contribution contract; administrator overlays and React panels remain separate |
| Module isolation | Pass | Generic widgets and soft-optional DI; no customers import of contributors or cross-module ORM link |
| Widget and override contracts | Pass | Existing injection tables, form hooks, and unified module dispatcher are reused; new surfaces are additive |
| Server integrity | Pass | One server resolver plus optional guard; browser validator never authorizes direct writes |
| Tenant/organization isolation | Pass | Scoped catalog, cache, and mutations; no tenant values in global declarations |
| Compatibility | Pass | Stable stored keys, frozen existing spots, deprecated bridge, additive contracts |
| UI/i18n/accessibility | Pass | `CrudForm` retains controls; selected widget errors use existing translated field-error flow |
| Integration coverage | Pass | Add/modify/remove, disabled peers, mounted validation, direct API and bootstraps |

### Verdict

Approved for review as a widget-based extension contract over the customers calendar foundation.

## Changelog

### 2026-09-28 — Initial proposal

- Split module-owned extensions from administrator configuration and optional React panels.

### 2026-09-29 — Widget and DI revision

- Replaced the calendar-specific generator and generated registry with headless widget injection, inline module configuration, and a customers-owned DI API for add/patch/disable/remove.
- Required an optional-module example and selected-type mounted widget validation with direct API guard coverage.

### Review — 2026-09-29

- **Reviewer**: Agent fresh-context scope review and author follow-up.
- **Security**: Passed after making catalog-load failure display-only in the editor and fail-closed on writes.
- **Performance**: Passed with exact-spot widget loading and versioned, scoped cache invalidation.
- **Cache**: Passed with tenant/organization keys and registry-version invalidation.
- **Commands**: Passed with authoritative key/core-field validation and optional server guard coverage.
- **Risks**: The reviewer proposed separate foundation and validation specs; this proposal retains them as staged prerequisites and acceptance of one end-to-end widget contribution capability. The administrator overlay and React panel remain separate.
- **Verdict**: Ready for design review.
