# Calendar Event Type Extensions

**Status:** Implemented; QA pending
**Issue:** [#6684](https://github.com/open-mercato/open-mercato/issues/6684)  
**Related:** [CRM Calendar](./2026-06-11-crm-calendar.md), [Configurable Calendar Event Types](./2026-09-28-configurable-calendar-event-types.md), [Calendar Event Type React Panels](./2026-09-28-calendar-event-type-react-panels.md)

## TLDR

Customers owns a six-type calendar foundation, a scoped read API, and authoritative interaction validation. Other enabled modules contribute event types and patches through the existing widget injection system; app-owned widgets carry replacement and patch declarations; module DI registrars register the same contributions for API/worker execution through a customers-owned service. No calendar-specific generator, convention file, or generated event-type registry is introduced. Optional contributors must continue loading when customers is disabled, with a diagnostic for the unused contribution.

When a widget for the selected event type is mounted in the calendar form, its `onBeforeSave` handler can block a save and return field errors through the existing `CrudForm` injection pipeline, as the catalog SEO widget does. Server-side rules remain authoritative for direct API callers.

## Goals and non-goals

### Goals

- Reuse `widgets/injection/<name>/widget.ts`, `widgets/injection-table.ts`, existing generic widget/component overrides, without calendar-specific shared metadata or an override domain.
- Compose the six customers definitions, enabled widget declarations and module-owned programmatic changes deterministically; expose the result to the separate administrator overlay.
- Expose a small programmatic API through Awilix, with explicit removal and cleanup semantics.
- Allow optional modules to reference the public calendar contract by type without hard dependencies or customers-owned imports of contributor code.
- Keep exact persisted `CustomerInteraction.interactionType` keys, historical fallback, mutation guards, optimistic locking, and undo behavior.
- Let a mounted Visit-self-gated widget validate the form before save without giving it mutation authority.

### Non-goals

- A new `calendar-event-types.ts` auto-discovery convention, generator plugin, or `calendar-event-types.generated.ts` artifact.
- A second calendar form or component registry. The optional React-panel companion uses existing UMES component replacement.
- Tenant-authored JavaScript, executable dictionary configuration, or direct ORM relationships across modules.
- Treating browser widget validation as a substitute for server validation.

## User stories and acceptance criteria

### US-B1 — Contribute types through widgets

The standalone app's optional `example` module can expose a `Visit` type (stable key `visit`) from a declarative, headless injection widget mapped to the customers calendar-type spot. It appears in the scoped catalog and editor and persists with the exact `visit` key. Disabling `example` removes it from new selection while existing records open with a raw-key warning and compatibility fallback. Duplicate base keys produce a deterministic conflict diagnostic; an explicit override is required to change another owner's definition.

### US-B2 — Configure and change types

An app can replace, patch, or disable a type through the Customers-owned `CalendarEventTypeWidget` payload and DI registry. The standalone `example` module demonstrates renaming the visible `meeting` label through a code patch while preserving the `meeting` key and all six baseline types. Type-removal examples belong to a separate app-owned contribution, not the shipped Example. Code can use the DI registry to add a type, change it, disable selection, and remove its contribution. Each operation is validated before it changes the effective catalog. Removing a higher-tier contribution reveals the next surviving tier; it never deletes interactions or dictionary rows.

### US-B3 — Validate selected types in the form

An optional module maps a UI widget to the existing interaction `CrudForm` spot. Its own render and event handlers inspect the selected key and become inert for other types; the generic form and injection host perform no calendar filtering. For `visit`, the mounted widget checks staff recipients and selected resources against their availability calendars; its `onBeforeSave` can return `{ ok: false, message, fieldErrors }`. `CrudForm` shows the same inline errors and prevents its write. Switching to another key makes the Visit widget inert; its handler rechecks the current key before validating. Direct API requests still pass customers-owned validation and the example's server-side availability rule.

### US-B4 — Survive absent optional peers

The contributing module has no hard `requires: ['customers']`. With customers disabled, the module loads and its unrelated features work; its calendar declaration is inert and a structured warning names the module, widget ID, and missing host. A programmatic caller uses a local `tryResolve` helper; absent `calendarEventTypeRegistry` yields the same optional-integration warning and a no-op, never a boot failure.

## Market reference

[Backstage extension overrides](https://backstage.io/docs/frontend-system/architecture/extension-overrides/) distinguish routine configuration from explicit overrides and avoid mutating the original extension. This spec makes common event-type customization declarative through widgets and module config, while the DI API provides explicit source-owned overrides and removal. It reuses Open Mercato's widget and override infrastructure rather than adopting Backstage's separate frontend extension model.

## Architecture

```text
enabled widget injection tables ──> calendar:customers.event-types ──┐
module DI registration of the same widget payload ───────────────────┤
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

Customers owns the foundation, resolver, DI service, route, and command validation. The extension module owns its widget declaration and any widget UI or server rule. The generic widget registry discovers enabled modules as it does today; Customers uses the unchanged widget loader for browser declarations; contributor DI registration supplies server declarations. No shared loader, generator, or global bootstrap acquires calendar policy. Existing generic `yarn generate` obligations for newly added widget files still apply.

### Canonical foundation ownership

The immutable Call and Task definitions retain `endTime: true`; empty `customFieldsetIds` means unrestricted legacy fields.

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

Keep the generic injection-widget union and loader unchanged. Customers exports `CalendarEventTypeWidget = InjectionWidgetModule & { eventTypes: readonly CalendarEventTypeDefinition[]; eventTypeOverrides?: Readonly<Record<string, CalendarEventTypeDefinition | null>>; eventTypePatches?: readonly CalendarEventTypePatch[] }`. A declaration includes the ordinary `Widget: () => null` member and normal metadata, and maps its stable widget ID to `calendar:customers.event-types` through `widgets/injection-table.ts`. Calendar payload validation and composition belong to Customers, not shared widget metadata.

Customers loads only this exact spot through the existing `loadInjectionWidgetsForSpot` API. Browser consumers use the scoped authoritative catalog. The example's `di.ts` softly resolves `calendarEventTypeRegistry`, clears its prior source, and registers the same definitions/replacements/patches for server API and worker execution. The Customers DI registrar does not import any contributor. There is no calendar override domain, global calendar dispatcher, server-wide widget bootstrap, or calendar-specific generator.

The example declaration uses the existing generic `metadata.requiredModules: ['customers']` gate. Its module can still boot with the host absent: optional service resolution skips the unused registration and warns rather than creating a hard dependency. Contributors use type-only imports from the public Customers contract; Customers never imports optional staff/resources implementations or contributor code.

### Composition and precedence

1. Start with the immutable six-type customers baseline.
2. Add definitions from enabled widgets in stable enabled-module order, then injection-table priority and widget ID. A duplicate base key is rejected with both owners named; later changes use an override or patch.
3. Apply complete replacement/`null` maps from widget declarations, then module-owned DI programmatic operations. The last override in a tier wins. A higher-tier definition can re-enable a lower-tier tombstone; `null` hides new selection only.
4. Apply patches from widgets, then programmatic code to surviving definitions. Patches cannot change a key or resurrect a missing/disabled definition. Fieldset list operations run replace → delete → append with exact-ID de-duplication.
5. The administrator companion applies inherited and local organization dictionary overlays last, only where `adminConfigurable !== false`.

Every effective property records source tier and module/widget or programmatic owner. A non-null replacement for an unknown key may add a synthetic type with a warning; a `null` for an unknown key is a warning/no-op. Malformed entries are rejected atomically per source with no partial application. Snapshots are immutable and exclude tenant labels, interaction values, and executable code.

## Module-owned configuration and programmatic API

Configure `eventTypeOverrides` and `eventTypePatches` on the Customers-typed widget declaration, not `src/modules.ts` or shared `ModuleOverrides`. The normal module entry enables the contributor. The example's widget always adds Visit with `adminConfigurable: false`; changing its required availability behavior through dictionary settings is therefore disallowed. Only the Meeting-label patch is an explicit demonstration gated by `OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES`, parsed with default `false`. The module's `di.ts` registers this same declaration for server execution through the service below.

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

The example must show additive and modifying code contributions in one enabled standalone app:

1. Add `Visit` with stable key `visit`, `baseKind: 'event'`, `panelKey: 'example.visit'`, `adminConfigurable: false`, end time, recipients, location, and resources enabled, all-day/recurrence disabled. Its label comes from `example.calendar.visit` with a translated English fallback.
2. Rename the displayed `meeting` label to “Customer meeting” using `replaceLabelKey` from the widget's `eventTypePatches` when the demo flag is enabled. Add keys to the example module's supported locale files. Keep the stored `meeting` key and historical rows unchanged.
3. Preserve all six baseline types in new selection with the demo flag both disabled and enabled. The shipped Example must not remove or disable any calendar type. Explain `eventTypeOverrides: { note: null }` only as a separate app-owned customization in the Customers guide; historical fallback and DI removal remain supported generic contracts.

The example exposes `eventTypes` and `eventTypePatches` in `widgets/injection/calendar-visit/widget.ts`, with `Widget: () => null`; `widgets/injection-table.ts` binds the declaration and `di.ts` registers the same payload server-side. The Customers standalone harness guide links these files, the Visit panel, and the command availability guard. `OMH-238` checks the module-owned customization route and optional dependency behavior. DI `upsert`, `patch`, `replace`, `remove`, and `removeSource` tests use temporary source-owned definitions; removing a contribution reveals the lower tier and never rewrites stored interactions.

### Visit availability contract

The `Visit` editor previews availability for the proposed half-open interval `[scheduledAt, scheduledAt + durationMinutes)` and rechecks it on create/update before persistence. It accepts a positive duration and never treats an all-day or recurring Visit as implicitly available. The preview and save-time rule share one scoped evaluation service so they cannot disagree on subject mapping or interval semantics. Visit reports each selected staff member or resource by display name and distinguishes missing schedules or intervals outside working hours from an existing booking (`example.calendar.visitAvailability.booked`). Booking checks include overlapping Customers interactions of every event type, including recurrence occurrences, in the authorized tenant and organization. Use half-open intervals: touching boundaries do not overlap. Canceled and deleted interactions do not reserve subjects. On edit, pass the validated current `excludeInteractionId` to preview; the command guard excludes that same existing interaction automatically, while retaining other collisions. Preview and rejected writes return the blocked subject names and reason keys without disclosing other event titles or IDs. Booking reads and recurrence expansion are bounded; failed, incomplete, or unsupported booking checks fail closed rather than reporting an available subject. These guards protect Visit scheduling against bookings from any type; they do not impose Visit rules on other event-type writes.

- For each selected recipient, resolve `participants[].userId` to an **active staff team-member ID** through a public, tenant/organization-scoped staff surface. Only matching staff members are checked against `planner` availability with `subjectType: 'member'` and the team-member ID. Customer contacts and email-only guests have no staff calendar and are skipped. An auth user ID is not a team-member ID; never send it directly as a planner subject.
- For each selected resource in `linkedEntities` with `type: 'resource'`, resolve the active resource by ID through the public resources surface and check `planner` availability with `subjectType: 'resource'` and that resource ID. Do not import staff/resource entities or form a cross-module ORM relation. Preserve the existing resource label snapshot and all unrelated links.
- Use planner's merged availability windows, assigned rule sets, time zones, and unavailability exceptions. Every checked subject must cover the whole proposed interval; no positive availability window, an uncovered span, or explicit unavailability reports that subject as unavailable. Batch bounded subject IDs, scope every lookup by tenant and organization, and return only subject IDs/statuses and localized messages the caller may view.
- Expose a scoped, read-only `GET /api/example/visit-availability` preview with zod-validated ISO `startAt`/`endAt` and bounded staff-user/resource ID lists. Require `customers.interactions.manage` and the relevant `planner.view`, `staff.view`, or `resources.view` feature before reading each source. Return per-subject `available | unavailable | unknown` plus a localized reason key, not raw schedule rules. Export `openApi`; the `VisitPanel` uses `apiCall`, never raw `fetch`. The server-side mutation guard or command interceptor calls the same evaluator against fresh data immediately before save. An installed/enabled dependency with a failed lookup or unauthorized subject yields an **unknown** result that blocks the check; it is never treated as missing or available. A disabled/not-installed staff or resources module produces a translated warning and skips only that absent module's checks, even when subject IDs remain in the draft. The panel, remaining enabled checks, and unrelated example features continue working. The same warning-only policy applies when planner is unavailable. Planner time-zone interpretation is opt-in through `respectTimezone: true` and unbounded weekly-template expansion through `weeklyScheduleTemplate: true` in this evaluator; the planner's existing callers retain their prior default semantics.
- The example checks published availability windows; it does not claim an exclusive reservation. Existing calendar overlap warnings may still appear. If implementation later promises no double booking, it needs a separate atomic reservation contract.

## Mounted widget validation

The form keeps `crud-form:customers.customer_interaction` and generic `CrudForm`/`InjectionSpot`/shared widget loading unchanged. The Visit widget owns both render and mutation-handler applicability, reading the selected category from normal injection context. Its validation immediately returns for any non-Visit category. No shared `calendarEventTypeKeys` metadata, calendar filter, or fieldset allowlist prop is introduced. Customers' `useCalendarCustomFields` implements fieldset applicability within its editor. An empty `customFieldsetIds` list preserves unrestricted legacy fields; only a non-empty list restricts them.

The template example's `visit` widget runs a fresh availability check in `onBeforeSave` and returns `{ ok: false, message, fieldErrors }` when any checked staff recipient or resource is unavailable or the lookup is unknown. `VisitPanel` owns the interactive preview/status presentation through the same scoped evaluator; the widget need not render a duplicate status UI and must validate even if the panel is replaced. Field-error keys map to the actual `CrudForm` field IDs for recipients, resources, or the time interval; the panel shows the same errors inline. `CrudForm` merges them with normal field errors and blocks submission, matching catalog SEO behavior. The host retains one form, submit/delete buttons, guarded mutation, optimistic-lock header, conflict bar, keyboard shortcuts, and retry. Widget code receives no submit callback or mutation authority. A disabled or nonmatching widget cannot block the save; its own handlers enforce applicability independently of visual hiding. A pending or failed pre-save check must not silently allow submission; failure shows a localized retry state and fails closed for that selected widget.

Browser `onBeforeSave` improves the editor experience but is bypassable by direct API callers. The customers command always validates key selectability, bounded core fields, applicable fieldsets, ACL, scope, and optimistic locking. The standalone example registers an optional server-side mutation guard or command interceptor for `visit` that invokes the same fresh availability evaluator before create/update. It returns typed validation/conflict details for affected recipients or resources and tests the same invalid request through the API. A missing contributor removes its extra rule while customers' core safety checks remain. Never execute React widget handlers on the server as the validation authority.

## API and runtime behavior

`GET /api/customers/activity-types[?organizationId=<uuid>]` requires authentication and `customers.interactions.view`, exports OpenAPI, and returns `{ items: EffectiveCalendarEventType[], fallbackKey: 'meeting' }`. It uses the same server resolver as interaction create/update, scoped by tenant and organization. Items contain effective appearance, behavior, selectability, provenance, `adminConfigurable`, and `panelKey`, but no widget functions or loaders. Cache keys and tags are tenant/organization scoped; registry version changes invalidate static composition and relevant scoped responses. If authoritative widget/config resolution fails, the route returns a retryable error and commands fail closed. The editor may use the immutable six definitions only to display an existing draft, with selection and save disabled until the scoped catalog reloads; it never reuses another scope's cache or treats baseline fallback as proof that a key is selectable.

Calendar-picker mutations explicitly enforce selectable types and reject unavailable changed keys. Internal commands preserve existing arbitrary/nonselectable interaction-key behavior when `enforceSelectableType` is not requested. Same-key historical updates retain the compatibility fallback; hiding a picker item never changes a stored key. New type-specific server guards run in the guarded mutation flow after core validation and before persistence. No new interaction mutation route is introduced. A stored key is never rewritten because a widget, module, config entry, or programmatic contribution disappears.

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
- Metadata and programmatic calls are zod-validated before registry changes; the server enforces scope and ACL on every write, the calendar picker opts into core applicability enforcement, and contributed types keep authoritative server guards for their own invariants.
- Customers never imports an optional contributor, creates cross-module ORM relations, or unconditionally resolves its service.
- Generic widget gates and the selected-type filter use the enabled-module set and wildcard-aware feature checks. Client-side widget visibility does not authorize an API write.

## Migration & Backward Compatibility

- Existing six-type behavior and stored interaction strings remain stable when there are no contributions.
- Existing widget spots, mutation hooks, module override domains, route URLs, and dictionary rows remain intact. The new Customers spot, Customers-owned widget payload type, DI key, and public resolver/types are additive contracts; shared widget metadata and override domains are unchanged; record them in `BACKWARD_COMPATIBILITY.md` and `UPGRADE_NOTES.md` before release.
- No calendar-specific generated contract exists. Existing generic widget auto-discovery output remains governed by its current compatibility contract.
- `editorKindOfInteractionType()` remains as a deprecated bridge for at least one minor version. Removing an event-type contribution changes new selection only and preserves historical fallback.
- The administrator and React-panel companion specs depend on this foundation but can ship without any optional contributor.

## Implementation plan

### Phase A — Customers foundation

1. Add the canonical public zod schema/types, six definitions, historical fallback, and resolver with tests for key stability and behavior bounds.
2. Add the scoped catalog route/OpenAPI, consume it in `CalendarEventEditor`, and replace hard-coded selection and command key validation with the same resolver. Test authoritative-read failure as retryable and nonselectable.

*Exit:* the six customers types work end-to-end through the owned API, editor, and commands before any optional contribution is enabled.

### Phase B — Widget, configuration, and programmatic control

3. Consume the unchanged generic loader at the Customers calendar spot and register server declarations through contributor DI, and test enabled-module order, collision diagnostics, invalid-source atomicity, HMR replacement, and customers-absent boot.
4. Keep shared overrides and global bootstraps unchanged; test contributor-owned DI registration before the first API/worker resolver read.
5. Register the Awilix `calendarEventTypeRegistry` service; implement `upsert`, `replace`, `patch`, `remove`, `removeSource`, immutable snapshots, source ownership, versioned invalidation, and soft-optional `tryResolve` tests.
6. Extend the standalone template's existing disabled `example` module: declare `visit` through its headless widget, optionally rename `meeting` through its widget payload while preserving all baseline types, document/test DI add/patch/remove, and verify customers-disabled boot. Add translated labels and mirror the monorepo example where needed for reference parity.

*Exit:* every contribution tier resolves deterministically and programmatic removal reveals the next tier.

### Phase C — Selected-type validation

7. Keep selected-key applicability inside the example widget and Customers editor, using the existing `onBeforeSave` lifecycle without modifying `CrudForm`. Implement the example's shared staff/resource availability evaluator, scoped preview, mounted field errors, and server mutation rule for `visit`; preserve global widget behavior and host submission authority. The React `VisitPanel` is delivered by the linked panel spec through the same example module.

*Exit:* `Visit` can be created and edited in the standalone app, the mounted widget blocks invalid form saves, and direct API writes enforce the same rule. The custom React editor and its visible availability states are the cross-spec end-to-end completion gate with the linked panel spec; this phase's widget and server rule do not depend on panel implementation.

### Phase D — Verification and documentation

8. Document the widget payload, Customers-owned widget replacements/patches, DI lifecycle, missing-host warnings, server guard requirement, and example; update compatibility notes and standalone harness coverage.
9. Run generic `yarn generate` only where normal widget auto-discovery requires it, module-decoupling tests, focused UI/unit tests, package build, typecheck, lint, integration tests, and app build.

## Integration coverage

Fixtures create records through APIs and remove them in `finally`; no test relies on demo data.

- **TC-CETE-001 — standalone Visit lifecycle:** scaffold a standalone app, enable the shipped `example` module in the test fixture, verify `Visit`/`visit` in the scoped API and editor, save/reload its exact key, then disable `example` and verify new-use rejection plus unchanged historical fallback.
- **TC-CETE-002 — rename, preserve, remove contribution:** enable `OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES` in the fixture and verify `meeting` displays the translated “Customer meeting” label but retains its stored key and all six baseline types remain available with either flag value. Keep historical rows intact. Exercise DI `upsert`/`patch`/`replace`/`remove`/`removeSource` with a temporary source and verify precedence, cache invalidation, and immutable provenance.
- **TC-CETE-003 — optional module decoupling:** boot the standalone app with `example` enabled and customers absent; assert one missing-host warning and working unrelated example behavior. Boot with `example` absent and customers enabled; assert six baseline types and no unresolved import.
- **TC-CETE-004 — mounted Visit validation:** create scoped staff-member, guest/customer, resource, weekly availability, and unavailability-exception fixtures. Select `visit`, assert only staff recipients and resources are checked, an unavailable subject produces the mapped inline field error and blocks save, an available interval succeeds, and switching type makes its self-gated validator inert. Exercise the preview GET's 401/403 and cross-organization denial without exposing raw rules. Assert feature-hidden/disabled widgets do not run and a failed lookup/load never silently allows save.
- **TC-CETE-005 — direct API enforcement:** submit the same unavailable Visit through the interaction API and verify the server rule blocks it; test member-user-ID mapping, resource IDs, time-zone boundaries, missing rule sets, cross-organization IDs, dependency failures, update rechecks, and guest/customer bypass. Reject zero/negative duration and all-day or recurring Visit requests through the direct API as well as the editor. Core key/field/scope checks remain when `example` is disabled.
- **TC-CETE-006 — server registration:** enable the example and verify its own DI registrar registers the widget declaration before API/worker catalog reads; no global dispatcher or shared calendar override exists. Cover absent host no-op/warning and idempotent source cleanup.

## Risks

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Widget declarations drift between server and client | High | Server resolver is authoritative; editor reads catalog API; hydration and direct API tests | A stale client may need retry |
| Client widget rule mistaken for authoritative validation | High | Explicit server guard example and direct API test; customers always checks core invariants | Optional business rule disappears when its module is disabled |
| Visit availability changes after preview | High | Re-evaluate current planner windows in the server mutation flow; display refresh/retry state | Concurrent changes after the check can still occur without an atomic reservation contract |
| Staff user ID is mistaken for planner member ID | High | Resolve active team-member ID through a scoped public staff surface; test auth-user fallback and guest/customer skipping | Staff roster changes may require retry |
| Optional planner/staff/resources lookup fails | Medium | Unavailable installed peers fail closed; absent/disabled peers warn and skip their own checks without imports | Visit scheduling pauses until the peer recovers |
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
| Widget and override contracts | Pass | Existing generic injection tables and form hooks are reused unchanged; all calendar payloads and DI rules are module-owned |
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
- Required an optional-module example and Visit-self-gated widget validation with direct API guard coverage.

### Review — 2026-09-29

- **Reviewer**: Agent fresh-context scope review and author follow-up.
- **Security**: Passed after making catalog-load failure display-only in the editor and fail-closed on writes.
- **Performance**: Passed with exact-spot widget loading and versioned, scoped cache invalidation.
- **Cache**: Passed with tenant/organization keys and registry-version invalidation.
- **Commands**: Passed with authoritative key/core-field validation and optional server guard coverage.
- **Risks**: The reviewer proposed separate foundation and validation specs; this proposal retains them as staged prerequisites and acceptance of one end-to-end widget contribution capability. The administrator overlay and React panel remain separate.
- **Verdict**: Ready for design review.

### 2026-09-29 — Standalone Visit implementation example

- Required the existing scaffolded `example` module to add `Visit`, optionally rename `meeting` in code, preserve all baseline types, and provide a custom React editor through the companion panel spec.
- Specified staff-recipient and resource availability checks through planner windows, a shared preview/save evaluator, optional-module behavior, and standalone integration coverage.

### 2026-09-30 — Module-boundary implementation alignment

- Aligned the implementation with Customers-owned widget payloads, contributor DI registration, and unchanged shared forms/loaders/override contracts.
- Preserved unrestricted empty fieldsets, Call/Task end times, internal-command compatibility, and historical keys; calendar-picker selection remains explicit.
- Documented immutable Visit behavior, opt-in demo overrides, missing optional-module warnings, and opt-in planner time-zone evaluation. QA remains pending.

### 2026-09-30 — Event-local timezone selection

- Every type, including code-owned Visit and Task, supports a selected IANA timezone independently of field applicability; Customers stores it as a nullable interaction column and preserves it through API reads and undo/redo.
- Editor wall-clock conversion and recurrence use the selected event timezone; planner time-zone evaluation remains an explicit, separate opt-in.

### 2026-09-30 — Weekly schedule anchors and timezone follow-up

- Verified the staff user-to-member mapping against real data. An editor-created Tuesday rule anchored at October 6 incorrectly excluded September 29; Visit now treats unbounded weekly DTSTART values as weekday/time anchors through a generic planner opt-in.
- Preserved one-off resource dates, bounded recurrence start/count behavior, and existing planner callers. Added exact Warsaw 09:15–12:00 coverage inside Tuesday 09:00–13:00 availability, with outside-window rejection.
- Expanded self-contained TC-EXAMPLE-018 to staff/resource weekly and dated schedules, UTC/Warsaw intervals, daylight-saving offsets, direct create/update guards, and title-only edits after schedule removal. Event timezone storage and TC-CAL-014 complement the existing preview/save evaluator; live QA remains pending.

### 2026-09-30 — Preserve shipped calendar types

- Example adds Visit and optionally patches Meeting without removing or disabling any built-in type, regardless of the demo flag. Generic app-owned removal instructions and Customers tombstone support remain available.

### 2026-10-01 — Strict picker enforcement without public-route regression

- Made `enforceSelectableType` an explicit calendar-picker signal instead of injecting it into every public interaction write. Existing integrations keep accepting their established keys and same-type payloads, while contributed types continue to enforce authoritative server rules.

### 2026-09-30 — Named availability and calendar booking conflicts

- Visit reports each selected staff member or resource by display name and distinguishes missing schedules or intervals outside working hours from an existing booking (`example.calendar.visitAvailability.booked`). Booking checks include overlapping Customers interactions of every event type, including recurrence occurrences, in the authorized tenant and organization. Use half-open intervals: touching boundaries do not overlap. Canceled and deleted interactions do not reserve subjects. On edit, pass the validated current `excludeInteractionId` to preview; the command guard excludes that same existing interaction automatically, while retaining other collisions. Preview and rejected writes return the blocked subject names and reason keys without disclosing other event titles or IDs. Booking reads and recurrence expansion are bounded; failed, incomplete, or unsupported booking checks fail closed rather than reporting an available subject. These guards protect Visit scheduling against bookings from any type; they do not impose Visit rules on other event-type writes.
- TC-EXAMPLE-018 creates its own staff/resource, availability, normal Meeting and recurring Event fixtures; asserts named preview/POST/PUT conflicts, self-edit exclusion, boundary contact, cancellation and deletion release, and preserved failed-update data. Frontend unit coverage checks the named booking messages. Both new booking API cases passed locally with the shared 20-second timeout; full UI QA remains pending.
