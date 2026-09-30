# Customers calendar event types

Use this guide after `.ai/guides/modules/customers/index.md` when adding, removing, or modifying calendar event types. Calendar behavior belongs to Customers and app-owned contributions. Keep framework packages read-only; generic CrudForm, InjectionSpot, widget loading, and module overrides must remain independent of calendar business rules.

## Exact reference implementation

- [Customers definitions, schemas, and registry operations](../../node_modules/@open-mercato/core/src/modules/customers/calendar-event-types.ts)
- [Customers server catalog resolution](../../node_modules/@open-mercato/core/src/modules/customers/lib/calendar/eventTypeResolver.ts)
- [Customers editor](../../node_modules/@open-mercato/core/src/modules/customers/components/calendar/CalendarEventEditor.tsx)
- [Example adds Visit, removes Note, and patches Meeting](../../src/modules/example/widgets/injection/calendar-visit/widget.ts)
- [Example injection bindings](../../src/modules/example/widgets/injection-table.ts)
- [Example Visit lifecycle widget](../../src/modules/example/widgets/injection/visit-availability/widget.ts)
- [Example optional availability checks](../../src/modules/example/lib/visitAvailability.ts)
- [Example Visit panel and dependency warnings](../../src/modules/example/components/VisitPanel.tsx)
- [Example server validation](../../src/modules/example/commands/interceptors.ts)
- [Example server availability guard](../../src/modules/example/lib/visitAvailabilityGuard.ts)
- [Example server DI registration](../../src/modules/example/di.ts)

The shipped example is disabled by default. Read and adapt its connected files into your own `src/modules/<id>/`; enable your own module in `src/modules.ts`. Do not modify the canonical teaching example merely to customize an app.

## Add a type

Export an ordinary injection widget typed as `CalendarEventTypeWidget` from `@open-mercato/core/modules/customers/calendar-event-types`. Include stable `metadata.id`, `Widget: () => null`, and `eventTypes: [definition]`. Bind the widget to `calendar:customers.event-types` in your module's `widgets/injection-table.ts`. Use the example's injection-table shape; retain enabled-module and feature gates.

A definition has a stable lowercase `key`, fallback `label`, translated `labelKey`, optional `icon`, `color`, `panelKey`, and a complete `behavior`. Set `schemaVersion: 1`, a supported `baseKind`, `selectable`, `order`, every `fields` switch, and `customFieldsetIds`. The `baseKind` selects the existing Customers persistence behavior; a new type does not require a duplicate customer event entity. Visit uses `baseKind: 'event'` and `panelKey: 'example.visit'`. Keep validation, custom fields, and panel selection inside the owning business module.

An empty `customFieldsetIds` preserves unrestricted legacy custom fields; it does not hide every field. Supply a non-empty list to restrict the editor to those fieldsets. Preserve shipped field behavior when adapting a definition, including `endTime: true` for Call and Task.

## Remove, replace, or patch a type

Use `eventTypeOverrides: { note: null }` to remove a type from the selectable catalog. A non-null override supplies a complete replacement definition accepted by the Customers schema. For a targeted modification, add an `eventTypePatches` entry with `targetEventTypeKey`, then explicit operations such as `replaceLabelKey`, `replaceFields`, `replaceSelectable`, `replaceCustomFieldsetIds`, `appendCustomFieldsetIds`, or `deleteCustomFieldsetIds`. The example changes Meeting's translated label with `replaceLabelKey`. Its Note removal and Meeting patch are opt-in demonstrations controlled by `OM_EXAMPLE_CALENDAR_DEMO_OVERRIDES`; the default is false. Visit sets `adminConfigurable: false`, so its extension behavior remains code-owned.

Removing a type is a catalog tombstone, not deletion of existing activities or tasks. Preserve historical fallback when opening records whose type is tombstoned, unknown, or contributed by a disabled module. Test existing records as well as the create selector, and do not silently migrate their stable type keys.

For server-owned programmatic contributions, resolve Customers' `calendarEventTypeRegistry` through DI. Its `upsert`, `replace`, `patch`, `remove`, and `removeSource` operations carry provenance; follow the exact installed signatures and keep source cleanup deterministic. The example's `di.ts` softly resolves this service and registers the same widget definitions, replacements, and patches for API and worker execution. Follow that module registrar when adapting the client declaration: registering a browser widget alone does not register server contributions. Keep dependency resolution optional and do not add a global calendar dispatcher or calendar properties to shared override or widget metadata contracts.

## Optional staff and resources

Staff and resources are optional integrations. Do not statically import their entities or implementations into an app module that must work without those packages. Resolve optional services or query by scoped entity IDs only after confirming the module is enabled. If staff or resources are unavailable, show a translated warning, skip only their unavailable checks, and keep the Visit panel and ordinary Customers calendar operational. An installed and enabled dependency still enforces its normal authorization, scope, and availability validation. A denied or failed check must not be treated as a missing module.

The availability widget must gate its handlers to Visit itself; UI visibility alone does not gate mutation hooks. Keep matching server validation in API/command interceptors so direct calls enforce the same rules. Preserve tenant/organization scope, optimistic locking, guarded mutations, and the read/save/reload round trip.

## Validation

Run `yarn generate` after adding injection files, then the smallest relevant typecheck and tests. Cover add/replace/patch/remove order, translated labels, custom fieldsets, historical fallback, Visit-only hooks, direct API validation, disabled staff, disabled resources, both absent, and enabled-but-denied dependencies. The harness regression is `OMH-238`; shared components and installed package files are outside the app's writable scope.
