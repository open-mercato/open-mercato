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

The standalone app's optional `example` module can expose a `Visit` type (stable key `visit`) from a declarative, headless injection widget mapped to the customers calendar-type spot. It appears in the scoped catalog and editor and persists with the exact `visit` key. Disabling `example` removes it from new selection while existing records open with a raw-key warning and compatibility fallback. Duplicate base keys produce a deterministic conflict diagnostic; an explicit override is required to change another owner's definition.

### US-B2 — Configure and change types

An app can replace, patch, or disable a type through `ModuleEntry.overrides.calendar`. The standalone `example` module demonstrates renaming the visible `meeting` label through a code patch while preserving the `meeting` key, and hiding `note` from new selection with a `null` override. Code can use the DI registry to add a type, change it, disable selection, and remove its contribution. Each operation is validated before it changes the effective catalog. Removing a higher-tier contribution reveals the next surviving tier; it never deletes interactions or dictionary rows.

### US-B3 — Validate selected types in the form

An optional module can map a UI widget to the existing interaction `CrudForm` spot and declare which event-type keys activate it. The calendar host mounts only widgets applicable to the selected key. For `visit`, the mounted widget checks staff recipients and selected resources against their availability calendars; its `onBeforeSave` can return `{ ok: false, message, fieldErrors }`. `CrudForm` shows the same inline errors and prevents its write. Switching to another key unmounts the widget and removes its validator. Direct API requests still pass customers-owned validation and the example's server-side availability rule.

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

For example, a standalone app's optional `example` entry can hide `note` and rename `meeting` for display without changing either stored key:

```ts
{
  id: 'example',
  from: '@app',
  overrides: {
    calendar: {
      eventTypes: { note: null },
      patches: [{ targetEventTypeKey: 'meeting', replaceLabelKey: 'example.calendar.customerMeeting' }],
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

Extend the existing `packages/create-app/template/src/modules/example/` module in the standalone app template. Keep it disabled in the shipped `modules.ts` by default, then enable it in standalone integration fixtures. Its calendar-type widget is mapped through `widgets/injection-table.ts`; its selected-type form widget and server availability rule are separate contributions. Mirror the example in `apps/mercato/src/modules/example/` where the repository keeps those reference surfaces in parity. Do not create `my_custom_overrides`, edit customers source for the example, or make `example` depend on customers, staff, resources, or planner to boot.

The example must show all three requested code changes in one enabled standalone app:

1. Add `Visit` with stable key `visit`, `baseKind: 'event'`, `panelKey: 'example.visit'`, end time, recipients, location, and resources enabled, all-day/recurrence disabled. Its label comes from `example.calendar.visit` with a translated English fallback.
2. Rename the displayed `meeting` label to “Customer meeting” using `replaceLabelKey` from the module's calendar override/patch. Add keys to the example module's supported locale files. Keep the stored `meeting` key and historical rows unchanged.
3. Hide `note` from new selection using a `null` override from code. Existing `note` interactions remain readable/editable through historical fallback; demonstrate removal of the override to restore selection. Never delete or rewrite the baseline type.

The template example should make the seams easy to copy:

```ts
// example/widgets/injection/calendar-visit/widget.ts: declarative type payload
eventTypes: [{ key: 'visit', labelKey: 'example.calendar.visit', panelKey: 'example.visit', /* complete bounded behavior */ }],

// src/modules.ts: example entry configuration
overrides: { calendar: {
  eventTypes: { note: null },
  patches: [{ targetEventTypeKey: 'meeting', replaceLabelKey: 'example.calendar.customerMeeting' }],
} },
```

Document the equivalent DI calls and test `upsert`, `patch`, `replace(key, null)`, `remove`, and `removeSource` with a temporary source-owned type or override; removal reveals the lower tier. The deployed `Visit` example itself uses widgets plus module configuration, so no extra throwaway event type appears in the end-user selector. Run the example module with customers disabled and assert the app and unrelated example behavior still work. The abbreviated snippet is explanatory: implementation must supply complete, valid definitions, translations, and source-owned cleanup.

### Visit availability contract

The `Visit` editor previews availability for the proposed half-open interval `[scheduledAt, scheduledAt + durationMinutes)` and rechecks it on create/update before persistence. It accepts a positive duration and never treats an all-day or recurring Visit as implicitly available. The preview and save-time rule share one scoped evaluation service so they cannot disagree on subject mapping or interval semantics.

- For each selected recipient, resolve `participants[].userId` to an **active staff team-member ID** through a public, tenant/organization-scoped staff surface. Only matching staff members are checked against `planner` availability with `subjectType: 'member'` and the team-member ID. Customer contacts and email-only guests have no staff calendar and are skipped. An auth user ID is not a team-member ID; never send it directly as a planner subject.
- For each selected resource in `linkedEntities` with `type: 'resource'`, resolve the active resource by ID through the public resources surface and check `planner` availability with `subjectType: 'resource'` and that resource ID. Do not import staff/resource entities or form a cross-module ORM relation. Preserve the existing resource label snapshot and all unrelated links.
- Use planner's merged availability windows, assigned rule sets, time zones, and unavailability exceptions. Every checked subject must cover the whole proposed interval; no positive availability window, an uncovered span, or explicit unavailability reports that subject as unavailable. Batch bounded subject IDs, scope every lookup by tenant and organization, and return only subject IDs/statuses and localized messages the caller may view.
- Expose a scoped, read-only `GET /api/example/visit-availability` preview with zod-validated ISO `startAt`/`endAt` and bounded staff-user/resource ID lists. Require `customers.interactions.manage` and the relevant `planner.view`, `staff.view`, or `resources.view` feature before reading each source. Return per-subject `available | unavailable | unknown` plus a localized reason key, not raw schedule rules. Export `openApi`; the `VisitPanel` uses `apiCall`, never raw `fetch`. The server-side mutation guard or command interceptor calls the same evaluator against fresh data immediately before save. A failed lookup, missing optional dependency for a selected staff member/resource, or unauthorized subject is an **unknown** result that blocks a Visit save with a retryable error; it must never be reported as available. When the optional modules are absent and no subject of that kind is selected, the other Visit fields continue to work.
- The example checks published availability windows; it does not claim an exclusive reservation. Existing calendar overlap warnings may still appear. If implementation later promises no double booking, it needs a separate atomic reservation contract.

## Mounted widget validation

The form continues to use its existing `crud-form:customers.customer_interaction` spot. Add optional `calendarEventTypeKeys` metadata to injection widgets (or an equivalent typed applicability predicate owned by the host). The host passes the selected effective key in injection context, filters applicable widgets before rendering and before event dispatch, and runs `onBeforeSave` only for an active mounted widget. The filter must apply equally to create/update, validation, required-field markers, and `onAfterSave`; changing the selected type unmounts the old widget and clears its widget-origin field errors. Global mutation widgets without a type filter continue to behave as today.

The template example's `visit` widget runs a fresh availability check in `onBeforeSave` and returns `{ ok: false, message, fieldErrors }` when any checked staff recipient or resource is unavailable or the lookup is unknown. `VisitPanel` owns the interactive preview/status presentation through the same scoped evaluator; the widget need not render a duplicate status UI and must validate even if the panel is replaced. Field-error keys map to the actual `CrudForm` field IDs for recipients, resources, or the time interval; the panel shows the same errors inline. `CrudForm` merges them with normal field errors and blocks submission, matching catalog SEO behavior. The host retains one form, submit/delete buttons, guarded mutation, optimistic-lock header, conflict bar, keyboard shortcuts, and retry. Widget code receives no submit callback or mutation authority. A disabled, hidden, unmounted, or nonmatching widget cannot block the save. A pending or failed pre-save check must not silently allow submission; failure shows a localized retry state and fails closed for that selected widget.

Browser `onBeforeSave` improves the editor experience but is bypassable by direct API callers. The customers command always validates key selectability, bounded core fields, applicable fieldsets, ACL, scope, and optimistic locking. The standalone example registers an optional server-side mutation guard or command interceptor for `visit` that invokes the same fresh availability evaluator before create/update. It returns typed validation/conflict details for affected recipients or resources and tests the same invalid request through the API. A missing contributor removes its extra rule while customers' core safety checks remain. Never execute React widget handlers on the server as the validation authority.

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
6. Extend the standalone template's existing disabled `example` module: declare `visit` through its headless widget, rename `meeting` and hide `note` through its module configuration, document/test DI add/patch/remove, and verify customers-disabled boot. Add translated labels and mirror the monorepo example where needed for reference parity.

*Exit:* every contribution tier resolves deterministically and programmatic removal reveals the next tier.

### Phase C — Selected-type validation

7. Add selected-key widget applicability and mounted `onBeforeSave` behavior to the existing `CrudForm` host. Implement the example's shared staff/resource availability evaluator, scoped preview, mounted field errors, and server mutation rule for `visit`; preserve global widget behavior and host submission authority. The React `VisitPanel` is delivered by the linked panel spec through the same example module.

*Exit:* `Visit` can be created and edited in the standalone app, the mounted widget blocks invalid form saves, and direct API writes enforce the same rule. The custom React editor and its visible availability states are the cross-spec end-to-end completion gate with the linked panel spec; this phase's widget and server rule do not depend on panel implementation.

### Phase D — Verification and documentation

8. Document the widget payload, module-config overrides, DI lifecycle, missing-host warnings, server guard requirement, and example; update compatibility notes and standalone harness coverage.
9. Run generic `yarn generate` only where normal widget auto-discovery requires it, module-decoupling tests, focused UI/unit tests, package build, typecheck, lint, integration tests, and app build.

## Integration coverage

Fixtures create records through APIs and remove them in `finally`; no test relies on demo data.

- **TC-CETE-001 — standalone Visit lifecycle:** scaffold a standalone app, enable the shipped `example` module in the test fixture, verify `Visit`/`visit` in the scoped API and editor, save/reload its exact key, then disable `example` and verify new-use rejection plus unchanged historical fallback.
- **TC-CETE-002 — rename, hide, remove:** verify `meeting` displays the translated “Customer meeting” label but retains its stored key, `note` is absent from new selection but historical rows remain intact, and removing the code override restores `note`. Exercise DI `upsert`/`patch`/`replace`/`remove`/`removeSource` with a temporary source and verify precedence, cache invalidation, and immutable provenance.
- **TC-CETE-003 — optional module decoupling:** boot the standalone app with `example` enabled and customers absent; assert one missing-host warning and working unrelated example behavior. Boot with `example` absent and customers enabled; assert six baseline types and no unresolved import.
- **TC-CETE-004 — mounted Visit validation:** create scoped staff-member, guest/customer, resource, weekly availability, and unavailability-exception fixtures. Select `visit`, assert only staff recipients and resources are checked, an unavailable subject produces the mapped inline field error and blocks save, an available interval succeeds, and switching type unmounts the validator. Exercise the preview GET's 401/403 and cross-organization denial without exposing raw rules. Assert feature-hidden/disabled widgets do not run and a failed lookup/load never silently allows save.
- **TC-CETE-005 — direct API enforcement:** submit the same unavailable Visit through the interaction API and verify the server rule blocks it; test member-user-ID mapping, resource IDs, time-zone boundaries, missing rule sets, cross-organization IDs, dependency failures, update rechecks, and guest/customer bypass. Reject zero/negative duration and all-day or recurring Visit requests through the direct API as well as the editor. Core key/field/scope checks remain when `example` is disabled.
- **TC-CETE-006 — bootstraps:** declare only `overrides.calendar` and verify dispatch before the first resolver read in Next.js, CLI/worker, and create-app template, with no unwired-domain warning while customers is enabled.

## Risks

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Widget declarations drift between server and client | High | Server resolver is authoritative; editor reads catalog API; hydration and direct API tests | A stale client may need retry |
| Client widget rule mistaken for authoritative validation | High | Explicit server guard example and direct API test; customers always checks core invariants | Optional business rule disappears when its module is disabled |
| Visit availability changes after preview | High | Re-evaluate current planner windows in the server mutation flow; display refresh/retry state | Concurrent changes after the check can still occur without an atomic reservation contract |
| Staff user ID is mistaken for planner member ID | High | Resolve active team-member ID through a scoped public staff surface; test auth-user fallback and guest/customer skipping | Staff roster changes may require retry |
| Optional planner/staff/resources lookup fails | Medium | Unknown result blocks only selected Visit dependencies; localized retry and no cross-module import | Visit scheduling pauses until the peer recovers |
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
| Integration coverage | Pass | Standalone Visit/rename/hide, availability, custom editor, disabled peers, direct API and bootstraps |

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

### 2026-09-29 — Standalone Visit implementation example

- Required the existing scaffolded `example` module to add `Visit`, rename `meeting` in code, hide `note`, and provide a custom React editor through the companion panel spec.
- Specified staff-recipient and resource availability checks through planner windows, a shared preview/save evaluator, optional-module behavior, and standalone integration coverage.
