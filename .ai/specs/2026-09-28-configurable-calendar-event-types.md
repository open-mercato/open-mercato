# Configurable Calendar Event Types

**Status:** Proposed  
**Issue:** [#6684](https://github.com/open-mercato/open-mercato/issues/6684)  
**Depends on:** Calendar-type foundation in [Calendar Event Type Extensions](./2026-09-28-calendar-event-type-extensions.md)
**Related:** [CRM Calendar](./2026-06-11-crm-calendar.md), [Calendar Event Type Extensions](./2026-09-28-calendar-event-type-extensions.md), [Calendar Event Type React Panels](./2026-09-28-calendar-event-type-react-panels.md)

## TLDR

Let administrators configure the bounded behavior of calendar activity types in Customers → Dictionaries → Activity types. A type controls its appearance, stable base semantics, applicable core fields, custom-field fieldsets, selectability, and order. The calendar editor and interaction commands consume the same tenant/organization-scoped resolver, so the UI cannot bypass server validation. This capability builds on the customers calendar-type foundation from the extension spec but works when no module contributes or overrides a type.

No executable UI, arbitrary field schema, or direct React is stored in tenant data. Existing `CustomerInteraction.interactionType` values remain byte-for-byte stable. Disabling or deleting a type removes it from new selection but never rewrites historical interactions.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Why | Confirm? |
|---|---|---|---|---|
| Q1 | Should the brief be one spec? | Split administrator configuration from module-owned extension contracts, while reusing their customers-owned foundation. | A fresh-context review found separately reviewable capabilities with one explicit shared prerequisite. | Reversible |
| Q2 | Where is the authoritative administrator surface? | Customers → Dictionaries → Activity types; Calendar Customization links there. | One editor avoids conflicting sources of truth. | Reversible |
| Q3 | May administrators define arbitrary fields, labels, validation, or executable UI? | No. Configuration is limited to supported core-field semantics and existing custom-field fieldsets. | This remains safe, localizable, and server-enforceable. | Reversible |
| Q4 | What does disabling/deleting a type mean? | Hide it from new selection; preserve historical values and use a compatibility fallback. | Stored interaction types are a stable contract. | Reversible |

## Goals and non-goals

### Goals

- Configure appearance, base semantics, field applicability, fieldsets, selectability, and order per scoped activity type.
- Preserve tenant/organization inheritance, RBAC, optimistic locking, command undo, encryption boundaries, and existing interaction side effects.
- Use one effective resolver for the settings UI, calendar editor, API validation, and destructive type-switch analysis.
- Provide explicit loading, empty, inherited, read-only, conflict, error, and historical-type states.

### Non-goals

- A general-purpose form builder or tenant-authored JavaScript/React.
- Renaming or normalizing persisted `interactionType` values.
- Replacing `CrudForm`, custom-field definitions, or dictionary inheritance.
- Defining module-owned types or custom panels; those belong to the linked registry and React-panel companion specs.

## User stories and acceptance criteria

### US-A1 — Configure a type

As a CRM administrator, I want to configure an activity type so its event form matches my organization without code changes.

- The existing `customers.settings.manage` feature guards list and mutation access.
- The form edits label, icon, color, order, base kind, selectability, supported core fields, and applicable custom-field fieldsets.
- An inherited type can be viewed and, when allowed, customized by creating a local override.
- A local override can be reset without deleting the inherited/core definition.
- `updatedAt` protects edit, reset, and delete through the standard optimistic-lock conflict surface.

### US-A2 — Create and edit by effective behavior

As a CRM user, I want the event editor to show only fields relevant to the selected type.

- The exact selected dictionary key is persisted as `interactionType`.
- Create rejects non-null values for fields that are not applicable.
- A same-type edit omits hidden fields and preserves their existing values.
- Unknown, disabled, or deleted historical keys open with a visible warning and meeting-shaped fallback, without rewriting the key.

### US-A3 — Switch type safely

As a CRM user, I want a clear warning before a type switch discards data.

- The client previews all non-empty core/custom fields that would be cleared.
- Cancel preserves the draft.
- The server independently returns a typed confirmation-required `409` unless confirmation is explicit.
- Confirmed clearing is atomic and undo restores the core and custom-field snapshots.
- The optimistic-lock check runs before destructive analysis.

## Market reference

- [Odoo CRM activity types](https://www.odoo.com/documentation/19.0/applications/sales/crm/optimize/utilize_activities.html) separates administrator-controlled activity behavior from application-specific actions. Adopt the bounded configuration model; do not copy app-specific coupling.
- [ERPNext Customize Form](https://docs.frappe.io/erpnext/customize-form) supports standard-field customization plus custom fields. Adopt existing fieldsets as the no-code extension surface; reject arbitrary tenant-authored UI.

## Architecture

```text
shipped six-type baseline
          │
          ├── optional module catalog from companion spec
          │
activity_type dictionary rows
  └── nullable versioned behavior JSON
          │
          ▼
resolveCalendarEventTypes(scope)
  ├── GET /api/customers/activity-types
  ├── CalendarEventEditor / CrudForm
  ├── interaction create/update validation
  └── destructive-switch diff + undo
```

The customers module owns the resolver and all persistence. This spec extends—not replaces—the canonical foundation resolver and read route from the extension spec. With no contributed entries, the input is its immutable shipped six-type baseline. With contributions, the input has already resolved AI-parity file → `modules.ts` → programmatic replacement/disable/extension tiers before scoped dictionary overlays run. Dictionary overlays never import or mutate another module.

### Effective behavior schema

Import `CalendarEventBaseKind`, `CalendarEventTypeBehavior`, `EffectiveCalendarEventType`, their zod schemas, the six definitions, fallback, and `resolveCalendarEventTypes()` from the canonical customers public path established by the extension spec. This feature MUST NOT copy or redeclare them.

The canonical `customFieldsetIds` constraint remains at most 32 unique fieldset codes, each at most 100 characters; `order` remains an integer from 0 through 10,000. This spec's dictionary validator composes the same exported zod schema. Unknown or deleted fieldsets are reported in settings and omitted from the effective editor layout; they are never reassigned.

## Data model and migration

Reuse `CustomerDictionaryEntry`. Add nullable JSONB column `activity_type_behavior`, mapped as `activityTypeBehavior`, valid only for `kind = 'activity_type'`.

- Existing rows stay `NULL` and resolve exactly as today.
- Scope remains the dictionary contract: `tenant_id`, `organization_id`, normalized value, and inherited/local precedence.
- The existing `updated_at` is the single version for appearance and behavior.
- No behavior property contains PII, credentials, or free text; encryption maps do not change.
- The JSON document has `schemaVersion: 1`; readers ignore additive unknown properties only after schema validation supports them.
- The migration is additive and online-safe. Rollback drops only the unused nullable column; interactions are untouched.

No direct ORM relationship is introduced. The implementation updates the customers migration snapshot and does not apply the migration locally without approval.

## Resolver rules

Resolution order is deterministic:

1. immutable six-type core baseline;
2. optional effective static catalog supplied by the companion registry after its base, full override/disable, and patch-extension composition;
3. inherited dictionary entry;
4. local organization dictionary entry.

Dictionary arrays replace rather than concatenate. Equal `order` values preserve dictionary ordering and then key ordering. Resolver output is immutable and includes static source-tier/property provenance, inheritance, configurability, and nullable `updatedAt` metadata. Dictionary rows apply only when the static definition is `adminConfigurable !== false`; existing rows for a newly non-configurable definition remain stored but inactive and visible as a settings warning until the static restriction is removed.

If registry/configuration loading fails, callers report the error and use the shipped baseline. Historical resolution is always available: an unknown or unavailable key returns raw-key display metadata plus meeting-shaped behavior, but is not selectable for new records.

`editorKindOfInteractionType()` remains as a deprecated wrapper for at least one minor release and delegates to the new resolver's `baseKind`. Existing `KIND_CONFIG`, `EDITOR_KINDS`, and `EditorKindConfig` exports remain unchanged.

## API contracts

### Resolved catalog overlay

`GET /api/customers/activity-types[?organizationId=<uuid>]`

- This is the foundation route, not a second endpoint. Replace its resolver binding with the scoped overlay resolver while keeping the route/method/base response compatible.
- Requires authentication and `customers.interactions.view`; organization scope is validated through the existing request context.
- Returns `{ items: EffectiveCalendarEventType[], fallbackKey: 'meeting' }`.
- Each item includes `key`, resolved label/icon/color, behavior, `selectable`, source, `isInherited`, `isLocalOverride`, `adminConfigurable`, and nullable `updatedAt`.
- Exports OpenAPI and uses the DI-resolved cache with tenant, organization, and readable-ancestor tags.
- Never exposes component functions or registry loaders.

### Dictionary mutations

The existing activity-type dictionary POST/PATCH accepts optional `behavior`; other dictionary kinds reject it. GET/POST/PATCH responses add optional `behavior`, provenance, configurability, and `updatedAt` properties. PATCH/DELETE/reset use the standard optimistic-lock header.

Appearance and behavior update in one command/transaction and one undo record. Creating a local override uses the existing POST path. Reset deletes only the local row, revealing the lower-precedence definition. Cache invalidation and side effects run after commit.

### Interaction mutations

Existing interaction update input adds optional `confirmDiscardInapplicableValues: boolean`. Create/update resolves the effective type in the authenticated scope before persistence.

```json
{ "error": "Field is not applicable to this activity type", "code": "activity_type_field_not_applicable", "fields": ["recurrenceRule"] }
```

```json
{ "error": "Changing type will clear existing values", "code": "calendar_type_change_confirmation_required", "fields": ["location", "cf_visit_outcome"] }
```

Create with a missing/disabled key is rejected. Updating a historical record without changing its unavailable type remains allowed through fallback semantics. The optimistic-lock check precedes field-diff disclosure.

## UI/UX

Customers → Dictionaries → Activity types becomes the authoritative manager.

- Rows show appearance, stable key, source, base semantics, active/selectable state, field summary, fieldsets, and effective order.
- `New activity type` and `Configure` open one `CrudForm` dialog with Appearance, Form behavior, and Custom-field fieldsets groups.
- Module/inherited provenance is visible. Saving an editable inherited type creates a local override; Reset override removes only that row.
- Fieldset choices come from existing definitions for `customers.customer_interaction` and cover loading, empty, no-results, stale-fieldset, and error states.
- Calendar Customization removes the display-only Event Categories and Activity Types tag inputs and links to the authoritative manager.

`CalendarEventEditor` remains one `CrudForm`. Add optional `customFieldsetAllowlist?: Record<string, readonly string[]>`; omitted means byte-identical current behavior. The calendar passes the selected type's fieldset codes. Empty means no configured fieldset sections; general fields require reserved `__general__`.

The type selector orders effective selectable types by behavior order and dictionary sort. Editing an unavailable historical type prepends its current raw value with a warning, but switching away does not make it selectable again.

Prototype: [configurable calendar event types](../prototypes/configurable-calendar-event-types/index.html). It uses synthetic data and validates the composed administrator + module-extension journey; it does not implement live persistence, RBAC, or registry loading.

## Frontend Architecture Contract

| Surface | Server root | Client island | Data owner |
|---|---|---|---|
| `/backend/calendar` | existing server page | existing `CalendarScreen`; lazy `CalendarEventEditor` | activity-type + interactions APIs |
| `/backend/config/customers` | existing server shell | existing `DictionarySettings`; lazy `ActivityTypeEditor` | dictionary/activity-type APIs |

New client files are limited to `ActivityTypeEditor.tsx` for dialog state/fieldset loading and extracted behavior controls within the already-client calendar editor. No page-root client boundary, global provider, or heavy browser dependency is added. Each touched/new client leaf stays under 300 LOC or records an explicit split exception.

Required evidence: `yarn check:client-boundaries`, `yarn build:app`, Playwright hydration/interactivity for both routes, and an assertion that the catalog request is cached rather than repeated per field render.

## Failure modes and observability

| Failure | User behavior | System behavior |
|---|---|---|
| Catalog/config read fails | localized retry banner; shipped types remain usable | report error; use scoped baseline; never reuse another scope's cache |
| Stale settings edit | unified conflict bar with reload/retry | standard 409; no partial write |
| Type switch would discard values | exact confirmation list | typed 409 until explicit confirm |
| Confirmed clear fails | draft remains; localized error | transaction rolls back core and custom writes; no side effects emitted |
| Fieldset was removed | warning in settings; section omitted | stored custom values remain untouched |
| Unknown historical type | raw key + unavailable warning | meeting fallback; never rewrite key |

Structured logs include tenant/organization IDs, type key, resolver source counts, fallback reason, and cache outcome but no field values. A catch that records an error also calls the repository error-reporting helper.

## Security, privacy, and accessibility

- Every read/write is tenant- and organization-scoped; cross-organization tests are mandatory.
- RBAC uses immutable feature IDs, never role names.
- Zod validates every behavior and confirmation input.
- No new sensitive columns or encryption-map entries are required.
- User-facing copy is localized; dialogs support `Cmd/Ctrl+Enter` and `Escape`; icon-only controls have accessible labels.
- Production UI uses shared primitives and semantic design tokens; no hard-coded status colors or arbitrary values.

## Migration & Backward Compatibility

- Nullable JSONB and optional API fields are additive.
- Existing routes, methods, custom-field spots, and stored interaction type values remain unchanged.
- The deprecated resolver bridge and `UPGRADE_NOTES.md` entry remain for at least one minor version.
- The canonical schema, six definitions, fallback, resolver, and read route come from the prerequisite foundation; scoped dictionary overlays remain above every static file/`modules.ts`/programmatic source and cannot execute React.
- Old application code ignores the nullable column and continues using current fallbacks.
- Removing this feature leaves dormant configuration but requires no data conversion.

## Implementation plan

### Phase A — Schema and resolver

1. Reuse the canonical behavior zod/types, immutable core definitions, fallback, and route; add the scoped dictionary overlay resolver and overlay/provenance unit coverage without redeclaration.
2. Add the nullable entity field, migration, snapshot, validators, and command-backed dictionary mutations with optimistic locking and undo.
3. Enrich the existing cached catalog route/OpenAPI response with dictionary inheritance/configuration metadata and add tenant/organization isolation plus invalidation tests.

*Exit:* existing rows resolve unchanged and a scoped behavior round-trips through the API.

### Phase B — Server enforcement

4. Enforce field applicability in interaction create/update commands.
5. Add destructive-switch analysis, typed confirmation conflict, atomic core/custom snapshots, undo, and side-effect ordering tests.

*Exit:* direct clients cannot bypass behavior and confirmed clearing is reversible.

### Phase C — Administrator and calendar UI

6. Add the specialized activity-type list/editor, inherited/local states, fieldset selector, and conflict/error coverage.
7. Add `CrudForm.customFieldsetAllowlist`, replace hard-coded behavior lookups with resolved definitions, and wire destructive-switch confirmation.
8. Remove obsolete Calendar Customization inputs and add the authoritative manager link.

*Exit:* an administrator configures a custom type and a CRM user creates, reloads, edits, and safely switches it.

### Phase D — Verification and documentation

9. Add framework documentation and `UPGRADE_NOTES.md`; run generation if auto-discovery inputs change.
10. Run focused tests, package build, typecheck, lint, integration suite, app build, DS review, and standalone-harness checks if contract coverage changes.

## Integration coverage

All fixtures are API-created and removed in `finally`; no test uses demo data.

- **TC-CET-001 — scoped configuration round trip:** configure a custom type with end time, location, attendees, resources off, and one fixture fieldset; create it in Calendar; assert only applicable groups render; save/read/reopen; verify exact key and values. Cover 401/403 and cross-organization isolation.
- **TC-CET-002 — destructive type switch:** create a rich event, switch to a note-shaped type, verify Cancel; verify direct unconfirmed update returns typed 409; Confirm clears only listed fields atomically; undo restores; stale `updatedAt` wins before destructive confirmation.
- **TC-CET-003 — legacy/deleted compatibility:** remove a type used by a fixture interaction; assert raw-key warning and meeting fallback without value rewrite; switching away cannot switch back.
- **TC-CET-004 — fieldsets and settings cleanup:** assign one of two fixture fieldsets, assert only its fields render/submit, delete it and verify warning/no leak, and verify Calendar Customization links to the manager without duplicate inputs.

## Risks

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Configuration change hides existing data | High | Same-type saves preserve hidden values; only confirmed, atomic, undoable type changes clear | A user can intentionally confirm data removal |
| Scoped catalog cache leaks behavior | Critical | Full tenant/org/ancestor keys, tag invalidation, isolation tests, safe cache-disable fallback | Cache implementation defects remain possible |
| Invalid/stale fieldset assignment | Medium | Resolve against current definitions, show warnings, omit unknown sections, never delete stored values | Values remain hidden until remapped |
| Bounded model becomes a form builder | Medium | Versioned closed zod schema; no labels, arbitrary validation, code, or network callbacks | Future fields require deliberate schema evolution |

## Final compliance report

### Sources reviewed

- `AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`
- `packages/core/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`
- `.ai/ds-rules.md`, `.ai/ui-components.md`, frontend architecture contract guidance

### Compliance matrix

| Rule | Status | Notes |
|---|---|---|
| Scope cohesion | Pass after split | Administrator configuration is one overlay capability; it requires the canonical foundation but no contributed module entry or React panel |
| Tenant/organization isolation | Pass | Existing dictionary scope and fully scoped cache/API rules |
| Canonical CRUD/commands/UI | Pass | Existing dictionary command, `CrudForm`, `apiCall`, conflict and confirm primitives |
| Optimistic locking and undo | Pass | One `updatedAt`; confirmed clears snapshot core + custom values atomically |
| Compatibility | Pass | Additive schema/API, frozen spots retained, deprecated bridge |
| Security/privacy | Pass | Closed zod schema; no new PII; RBAC and scope explicit |
| Design system/i18n/a11y | Pass | Shared primitives/tokens, localized states, keyboard and accessible-label requirements |
| Integration coverage | Pass | API/UI paths, permissions, isolation, failure, undo, and historical behavior covered |
| Frontend contract | Pass | No page-root/provider expansion; two bounded client leaves and evidence budget |

### Verdict

Approved for review. The original combined brief was split by capability with the foundation dependency made explicit; no assumption requires human confirmation.

## Changelog

### 2026-09-28 — Initial proposal

- Split administrator configuration from module-owned extensions after independent scope review.
- Defined scoped behavior storage, resolver/API enforcement, destructive-switch undo, authoritative settings UI, and integration coverage.

### 2026-09-28 — Static extension precedence alignment

- Clarified that the companion registry fully resolves AI-parity file, `modules.ts`, and programmatic tiers before inherited/local dictionary overlays.
- Defined inactive-row behavior when a higher static tier makes a type non-configurable.
- Reused the registry spec's canonical schema, six definitions, resolver, fallback, and catalog route instead of duplicating ownership.
