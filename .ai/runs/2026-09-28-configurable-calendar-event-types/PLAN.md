# Execution plan — configurable calendar event types

**Created:** 2026-09-28
**Branch:** `feat/configurable-calendar-event-types`
**Subject issue:** [#6684](https://github.com/open-mercato/open-mercato/issues/6684)
**Source spec PR:** [#6687](https://github.com/open-mercato/open-mercato/pull/6687)
**Source specs:** `.ai/specs/2026-09-28-configurable-calendar-event-types.md`, `.ai/specs/2026-09-28-calendar-event-type-extensions.md`, and `.ai/specs/2026-09-28-calendar-event-type-react-panels.md` on `spec/configurable-calendar-event-types`

## Source revision reconciliation

The source PR was revised on 2026-09-29 after the original execution plan and Steps 1.1–1.4 were committed. The current source specs replace the calendar-specific generator with the existing headless widget loader, `modules.ts` calendar overrides, and a Customers DI registry. They require the example key `visit` (rather than `site-visit`), a Meeting label patch, a Note tombstone, selected-type validation, and an availability-aware Visit panel. Step 1.4a below corrects the superseded registry work without rewriting earlier commits. All remaining work follows the three current source specs.

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add the public event-type behavior contract and deterministic registry | group:A:capable | done | 1e3ed8d3c |
| 1 | 1.2 | Generate and bootstrap module event-type contributions | group:A:capable | done | 16873badc |
| 1 | 1.3 | Persist activity-type behavior through dictionary commands and APIs | group:B:capable | done | fc4e475c6 |
| 1 | 1.4 | Expose the scoped effective activity-type catalog | group:B:capable | done | 98aa7096f |
| 1 | 1.4a | Replace superseded generator architecture with widget, module, and DI composition | group:A:capable | done | 33035d525 |
| 1 | 1.5 | Enforce applicability and reversible destructive type switches | group:B:capable | done | 33035d525 |
| 2 | 2.1 | Add a CrudForm custom-fieldset allowlist contract | group:C:capable | done | 33035d525 |
| 2 | 2.2 | Drive the calendar editor from resolved types and the UMES panel host | group:C:capable | done | 33035d525 |
| 2 | 2.3 | Add the authoritative activity-type behavior editor and calendar link | group:C:capable | done | 33035d525 |
| 2 | 2.4 | Demonstrate Visit widget add, Meeting patch, and Note tombstone in the example module | group:D:capable | done | 33035d525 |
| 2 | 2.5 | Add selected-type widget validation and scoped Visit availability preview/server rule | group:D:capable | done | 33035d525 |
| 2 | 2.6 | Add the Visit React panel and dual-runtime UMES override paths | group:C:capable | done | 33035d525 |
| 3 | 3.1 | Add self-contained event-type and custom-panel integration coverage | group:D:capable | done | 4bb14a34c |
| 3 | 3.2 | Document the frozen extension contract and refresh standalone coverage | group:D:capable | done | 437dbcace |
| 3 | 3.3 | Verify live UI flows and publish screenshot evidence to the PR | group:D:capable | done | 2ebe740d7 |

## Progress

> Resume checklist for `om-auto-continue-pr`; the Tasks table above carries the same status and commit references.

### Phase 1: Runtime contracts and enforcement

- [x] 1.1 Add the public event-type behavior contract and deterministic registry — 1e3ed8d3c
- [x] 1.2 Generate and bootstrap module event-type contributions — 16873badc
- [x] 1.3 Persist activity-type behavior through dictionary commands and APIs — fc4e475c6
- [x] 1.4 Expose the scoped effective activity-type catalog — 98aa7096f
- [x] 1.4a Replace superseded generator architecture with widget, module, and DI composition — 33035d525
- [x] 1.5 Enforce applicability and reversible destructive type switches — 33035d525

### Phase 2: Shared and application UI

- [x] 2.1 Add a CrudForm custom-fieldset allowlist contract — 33035d525
- [x] 2.2 Drive the calendar editor from resolved types and the UMES panel host — 33035d525
- [x] 2.3 Add the authoritative activity-type behavior editor and calendar link — 33035d525
- [x] 2.4 Demonstrate Visit widget add, Meeting patch, and Note tombstone in the example module — 33035d525
- [x] 2.5 Add selected-type widget validation and scoped Visit availability preview/server rule — 33035d525
- [x] 2.6 Add the Visit React panel and dual-runtime UMES override paths — 33035d525

### Phase 3: End-to-end evidence and durable contracts

- [x] 3.1 Add self-contained event-type and custom-panel integration coverage — 4bb14a34c
- [x] 3.2 Document the frozen extension contract and refresh standalone coverage — 437dbcace
- [x] 3.3 Verify live UI flows and publish screenshot evidence to the PR — 2ebe740d7

## Goal

Implement all three current specifications from PR #6687 so administrators can configure bounded calendar event-type behavior and enabled modules can add, patch, hide, wrap, or replace event types without coupling to the Customers module. The example module must add `visit` through a headless widget, rename Meeting and hide Note through module configuration, validate availability in the mounted form widget and server, and render an availability-aware Visit panel through UMES.

## Scope

- Customers-owned behavior schema, immutable six-type baseline, existing generic headless widget loader, module overrides, source-owned DI registry, deterministic composition, provenance, historical fallback, and public exports.
- Additive `customer_dictionary_entries.activity_type_behavior` JSONB persistence, migration snapshot, dictionary command/API round trips, optimistic locking, undo/redo, cache invalidation, and resolved catalog API.
- Server-side interaction validation for selectability and applicable fields, confirmation-required destructive type changes, atomic custom/core field clearing, and undo restoration.
- Additive `CrudForm` fieldset filtering; calendar editor resolution, fallback warnings, destructive-switch confirmation, and the frozen `section:customers.calendar-event-editor.type-panel` UMES handle.
- Authoritative Customers dictionary behavior editor plus removal of the duplicate display-only calendar settings inputs in favor of a link.
- Mirrored `apps/mercato` and `packages/create-app/template` example contributions, including Visit availability checks, custom panel, and tests that prove add/patch/tombstone behavior.
- Unit, module-decoupling, Playwright integration, design-system, documentation, upgrade-note, and standalone-harness coverage required by the three specs.

## Non-goals

- Tenant-authored JavaScript/React or a general-purpose form builder.
- Renaming or normalizing persisted `interactionType` values.
- Direct ORM relationships between Customers and contributing modules.
- Replacing the single host `CrudForm`, its mutation guards, optimistic locking, or existing frozen injection spots.
- Product custom-field picker work tracked separately by #3554.
- Merging or rewriting the design-only source PR #6687.

## Risks

- **Critical scope isolation:** cache and catalog reads must include tenant, organization, and inherited organization scope; cross-organization tests are mandatory.
- **High data integrity:** same-type edits preserve hidden values, while cross-type clearing requires an explicit 409-confirmation round trip and one undoable atomic command.
- **High compatibility:** the new widget spot, payload kind, calendar override domain, DI service, public import path, and UMES handle become additive contracts; existing `KIND_CONFIG`, `EDITOR_KINDS`, `EditorKindConfig`, and `editorKindOfInteractionType()` remain bridged.
- **High module isolation:** Customers may consume generated serializable facts but must never import the optional example module or any future contributor directly.
- **Dependent source docs:** #6687 is not yet merged. This implementation references its branch paths without copying its design/prototype commits; merge #6687 before or with this implementation so the source specs land on `develop`.

## External references

- No external skill URLs were supplied.
- Adopted the complete behavior and acceptance criteria from PR #6687 and issue #6684.
- Market links inside the source specs are context only; project contracts and tests are authoritative.

## Implementation plan

### Phase 1 — Runtime contracts and enforcement

#### Step 1.1 — Add the public event-type behavior contract and deterministic registry

- Add closed zod schemas/types for `CalendarEventTypeBehavior`, definitions, partial overrides, normalized entries, provenance, tombstones, and historical fallback.
- Preserve the six shipped type behaviors and legacy exports byte-for-byte through adapters/deprecated bridges.
- Implement process-global, idempotent registration and deterministic add/patch/null/programmatic override composition with immutable outputs.
- Cover duplicates, unknown patches, array replacement, property provenance, module disappearance, and fallback behavior with unit tests.

#### Step 1.2 — Superseded contribution bootstrap

The originally committed generator approach was superseded by the current source specs. Step 1.4a removes it and supplies the generic widget loader, module override, and DI contribution paths.

#### Step 1.3 — Persist activity-type behavior through dictionary commands and APIs

- Add nullable JSONB `activity_type_behavior` to `CustomerDictionaryEntry`, an additive migration, and the Customers migration snapshot update without applying the migration locally.
- Extend validators only for `kind = activity_type`; reject behavior for other kinds.
- Include behavior in command snapshots, create/update/undo/redo, change logs, and cache invalidation; retain one `updatedAt` version.
- Extend existing dictionary list/create/update/delete/reset response/request shapes additively and enforce optimistic-lock headers for edit/reset/delete.
- Add focused schema, command, route, undo, and stale-write tests.

#### Step 1.4 — Expose the scoped effective activity-type catalog

- Implement one Customers-owned resolver layering core definitions, module registry entries, inherited dictionary rows, and local organization rows.
- Return immutable serializable metadata, provenance, configurability, inheritance/local-override flags, fieldset diagnostics, and nullable `updatedAt`.
- Add authenticated `GET /api/customers/activity-types` with `customers.interactions.view`, OpenAPI, validated organization scope, cache tags for tenant/org/ancestors, fail-soft baseline fallback, logging, and error reporting.
- Add resolver/API/cache invalidation and tenant/organization isolation tests.

#### Step 1.5 — Enforce applicability and reversible destructive type switches

- Resolve the effective type inside interaction create/update commands before persistence; reject unavailable types for new records and non-null inapplicable fields.
- Permit unchanged unavailable historical types through meeting fallback without rewriting their exact keys.
- Add `confirmDiscardInapplicableValues`, optimistic-lock-before-diff ordering, typed confirmation-required 409s, atomic clearing of core/custom fields, and full undo/redo snapshots.
- Preserve side-effect, indexing, cache, and event ordering; add command/API tests for bypass attempts, stale writes, exact field lists, rollback, undo, and same-type hidden-value preservation.

#### Step 1.4a — Align completed foundation work with the revised source specs

- Retire the calendar-specific generator and global generated entry contract from Steps 1.1–1.2; keep the immutable six-type baseline and compatibility bridges.
- Load only the generic `calendar:customers.event-types` headless widget spot after server bootstrap, honoring enabled modules and widget overrides.
- Add the loose shared `ModuleOverrides.calendar` dispatcher domain, a Customers parser/applier, and an Awilix `calendarEventTypeRegistry` with source-owned upsert/replace/patch/remove/removeSource/snapshot operations.
- Compose widget definitions, full overrides, patches, module config, and DI sources in the current spec's precedence order; preserve provenance and historical fallback; reject invalid sources atomically.
- Ensure catalog resolution fails closed and caches by registry version; test disabled contributors, malformed inputs, no Customers dependency in the example, and module isolation.

### Phase 2 — Shared and application UI

#### Step 2.1 — Add a CrudForm custom-fieldset allowlist contract

- Add optional `customFieldsetAllowlist?: Record<string, readonly string[]>` without changing omitted behavior.
- Filter rendered/submitted custom-field sections by allowed fieldset codes, with reserved `__general__` semantics and preservation of hidden initial values.
- Keep existing injection spots and field/group IDs stable; add focused CrudForm unit tests and public prop documentation.

#### Step 2.2 — Drive the calendar editor from resolved types and the UMES panel host

- Load the effective catalog once per editor/screen flow and use it for selector order, appearance, behavior, fieldset allowlists, provenance, and historical warnings.
- Keep `CalendarEventEditor` as one `CrudForm`; replace hard-coded field morphology reads through the shared resolver while retaining deprecated bridges.
- Bind `section:customers.calendar-event-editor.type-panel` via `useRegisteredComponent` with the v1 capability-only props contract and a guarded error fallback to the default panel.
- Implement client preview/cancel/confirm for destructive type changes and server 409 handling without exposing submit/network authority to panels.
- Add hydration, error-boundary, default/replacement panel, fallback, and draft-preservation tests.

#### Step 2.3 — Add the authoritative activity-type behavior editor and calendar link

- Extend Customers → Dictionaries → Activity types with source/key/semantics/selectability/order/field summary/fieldset visibility and localized loading, empty, inherited, read-only, conflict, stale-fieldset, and error states.
- Add a `CrudForm` editor for appearance plus bounded behavior; localize all copy and preserve keyboard/a11y/design-system rules.
- Remove the display-only Event Categories/Activity Types inputs from Calendar Customization and link to the authoritative manager.
- Cover create/edit/local override/reset/conflict and link behavior with component tests.

#### Step 2.4 — Demonstrate add, patch, tombstone, and custom UI in the example module

- Add mirrored headless `calendar-visit` widgets in the existing app and create-app example modules, mapped in their injection tables.
- Add `visit` with complete bounded behavior and `panelKey: 'example.visit'`; hide `note` and rename Meeting through the example module's `calendar` override in `modules.ts`.
- Keep the standalone example disabled by default, enable it in integration fixtures, mirror locale/tests/template changes, and verify add/patch/tombstone behavior and Customers-disabled boot.

#### Step 2.5 — Selected-type validation and Visit availability

- Filter existing interaction `CrudForm` injection widgets by optional `calendarEventTypeKeys` metadata before mounting and lifecycle dispatch; keep global widgets active.
- Add a shared scoped Visit availability evaluator using staff team-member IDs, resource IDs, and planner windows for a bounded half-open interval. Missing peers, permissions, or lookup failures must return unknown and block save.
- Expose authenticated, feature-gated `GET /api/example/visit-availability` with validated input, safe per-subject statuses, and OpenAPI.
- Add a mounted Visit widget that rechecks availability in `onBeforeSave`, and a server mutation guard using the same evaluator for direct API writes. Test inactive-widget bypass, retry, scope, and direct API rejection.

#### Step 2.6 — Visit React panel and UMES tiers

- Add the localized Visit panel using host capabilities only, with pending/available/unavailable/retry preview states and inline field errors.
- Register a type-specific wrapper in the example module's existing `widgets/components.ts`; preserve the default panel for other types and host-owned submit, delete, keyboard, optimistic-lock, and guarded mutation paths.
- Verify file, inline, and programmatic UMES tiers, dual-runtime hydration, null fallback, and render-error fallback without exposing a submit callback.

### Phase 3 — End-to-end evidence and durable contracts

#### Step 3.1 — Add self-contained event-type and custom-panel integration coverage

- Add API-created, finally-cleaned Playwright fixtures for administrator round trip, field applicability, destructive switch cancel/409/confirm/undo/stale lock, historical/deleted type fallback, fieldsets, and cross-organization isolation.
- Add example-module integration coverage proving catalog add/provenance/order, exact `visit` persistence, one patched core label, one tombstoned type, custom panel value flow, module-disable historical fallback, and no host-submit authority.
- Exercise the authoritative settings link and replacement error fallback with stable role/label locators.

#### Step 3.2 — Document the frozen extension contract and refresh standalone coverage

- Document the public definition/override exports, headless widget spot, module and DI contribution paths, precedence, tombstones, historical fallback, panel safety, and example in framework docs.
- Add the required `UPGRADE_NOTES.md` compatibility/deprecation entry and update the existing CRM calendar spec changelog/status where available on `develop`; reference source PR #6687 for the three pending specs.
- Refresh module facts/standalone harness expectations and template-sync checks for the mirrored example surface.
- Run documentation/link-focused checks as scratch verification; final validation remains in the final gate.

## Verification cadence

- Checkpoint 1 after Steps 1.1–1.5: focused core/shared tests, build/typecheck slice, migration diff review, and PR verification comment.
- Checkpoint 2 after Steps 2.1–2.4: focused UI/example tests, generation/template sync, Playwright smoke/screenshots when runnable, and PR verification/evidence comments.
- Final gate after Steps 3.1–3.2: full configured validation commands in order, full `yarn test:integration`, `yarn test:create-app:integration` for mirrored template surfaces, `om-ds-guardian`, standalone-harness refresh, automated review/autofix, and `om-auto-qa-pr` as the available QA-verification workflow corresponding to the requested `om-auto-verify-qa-pr` wording.
