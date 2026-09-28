# Execution plan — configurable calendar event types

**Created:** 2026-09-28
**Branch:** `feat/configurable-calendar-event-types`
**Subject issue:** [#6684](https://github.com/open-mercato/open-mercato/issues/6684)
**Source spec PR:** [#6687](https://github.com/open-mercato/open-mercato/pull/6687)
**Source specs:** `.ai/specs/2026-09-28-configurable-calendar-event-types.md` and `.ai/specs/2026-09-28-calendar-event-type-extensions.md` on `spec/configurable-calendar-event-types`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add the public event-type behavior contract and deterministic registry | group:A:capable | done | 1e3ed8d3c |
| 1 | 1.2 | Generate and bootstrap module event-type contributions | group:A:capable | done | 16873badc |
| 1 | 1.3 | Persist activity-type behavior through dictionary commands and APIs | group:B:capable | todo | — |
| 1 | 1.4 | Expose the scoped effective activity-type catalog | group:B:capable | todo | — |
| 1 | 1.5 | Enforce applicability and reversible destructive type switches | group:B:capable | todo | — |
| 2 | 2.1 | Add a CrudForm custom-fieldset allowlist contract | group:C:capable | todo | — |
| 2 | 2.2 | Drive the calendar editor from resolved types and the UMES panel host | group:C:capable | todo | — |
| 2 | 2.3 | Add the authoritative activity-type behavior editor and calendar link | group:C:capable | todo | — |
| 2 | 2.4 | Demonstrate add, patch, tombstone, and custom UI in the example module | group:D:capable | todo | — |
| 3 | 3.1 | Add self-contained event-type and custom-panel integration coverage | group:D:capable | todo | — |
| 3 | 3.2 | Document the frozen extension contract and refresh standalone coverage | group:D:capable | todo | — |

## Goal

Implement both specifications from PR #6687 so administrators can configure bounded calendar event-type behavior and enabled modules can add, patch, hide, wrap, or replace event types without coupling to the Customers module. The example module must prove all extension operations in a real app: tombstone one shipped type, patch the applicable fields of another, and add a `site-visit` type rendered through custom UMES UI.

## Scope

- Customers-owned behavior schema, immutable six-type baseline, generated module registry, deterministic composition, provenance, historical fallback, and public exports.
- Additive `customer_dictionary_entries.activity_type_behavior` JSONB persistence, migration snapshot, dictionary command/API round trips, optimistic locking, undo/redo, cache invalidation, and resolved catalog API.
- Server-side interaction validation for selectability and applicable fields, confirmation-required destructive type changes, atomic custom/core field clearing, and undo restoration.
- Additive `CrudForm` fieldset filtering; calendar editor resolution, fallback warnings, destructive-switch confirmation, and the frozen `section:customers.calendar-event-editor.type-panel` UMES handle.
- Authoritative Customers dictionary behavior editor plus removal of the duplicate display-only calendar settings inputs in favor of a link.
- Mirrored `apps/mercato` and `packages/create-app/template` example contributions, including a custom `site-visit` panel and tests that prove add/patch/tombstone behavior.
- Unit, generator, module-decoupling, Playwright integration, design-system, documentation, upgrade-note, and standalone-harness coverage required by the two specs.

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
- **High compatibility:** the new convention file, generated export, public import path, and UMES handle become frozen contracts; existing `KIND_CONFIG`, `EDITOR_KINDS`, `EditorKindConfig`, and `editorKindOfInteractionType()` remain bridged.
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

#### Step 1.2 — Generate and bootstrap module event-type contributions

- Add the Customers generator plugin for module-root `calendar-event-types.ts`, emitting the additive generated registry with module ID, source path, and enabled-module order.
- Register generated entries before catalog/API/UI resolution without importing app bootstrap files into packages.
- Declare/bind the new convention and UMES host in generated module facts and extension-point metadata.
- Add generator and disabled-module/decoupling tests; run generation as a scratch check but do not hand-edit ephemeral outputs.

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

- Add mirrored example-module `calendar-event-types.ts` files in the app and create-app template.
- Add `site-visit` with complete visit behavior and `panelKey`; tombstone one shipped type; patch a different shipped type's applicable field configuration.
- Add a real wrapper/props-transform or replacement in `widgets/components.ts` rendering a custom localized visit panel through host capabilities only.
- Mirror locale/tests/template changes and verify the generated contribution, modified existing type, hidden type, and custom panel contract.

### Phase 3 — End-to-end evidence and durable contracts

#### Step 3.1 — Add self-contained event-type and custom-panel integration coverage

- Add API-created, finally-cleaned Playwright fixtures for administrator round trip, field applicability, destructive switch cancel/409/confirm/undo/stale lock, historical/deleted type fallback, fieldsets, and cross-organization isolation.
- Add example-module integration coverage proving catalog add/provenance/order, exact `site-visit` persistence, one patched core layout, one tombstoned type, custom panel value flow, module-disable historical fallback, and no host-submit authority.
- Exercise the authoritative settings link and replacement error fallback with stable role/label locators.

#### Step 3.2 — Document the frozen extension contract and refresh standalone coverage

- Document the public definition/override exports, generation convention, precedence, tombstones, historical fallback, panel safety, and example in framework docs.
- Add the required `UPGRADE_NOTES.md` compatibility/deprecation entry and update the existing CRM calendar spec changelog/status where available on `develop`; reference source PR #6687 for the two pending specs.
- Refresh module facts/standalone harness expectations and template-sync checks for the new convention and mirrored example surface.
- Run documentation/link-focused checks as scratch verification; final validation remains in the final gate.

## Verification cadence

- Checkpoint 1 after Steps 1.1–1.5: focused core/shared/generator tests, build/typecheck slice, migration diff review, and PR verification comment.
- Checkpoint 2 after Steps 2.1–2.4: focused UI/example tests, generation/template sync, Playwright smoke/screenshots when runnable, and PR verification/evidence comments.
- Final gate after Steps 3.1–3.2: full configured validation commands in order, full `yarn test:integration`, `yarn test:create-app:integration` for mirrored template surfaces, `om-ds-guardian`, standalone-harness refresh, automated review/autofix, and `om-auto-qa-pr` as the available QA-verification workflow corresponding to the requested `om-auto-verify-qa-pr` wording.
