# Person ↔ Company multi-select on the person form

**Status:** Draft / proposal — for discussion; implementation not committed.
**Scope:** OSS `customers` module (`packages/core/src/modules/customers/`) — person create/edit form, the person create/update API + command, and the existing per-person company-link endpoints.
**Prior art:** issue #671 + closed PR #672 (SPEC-035 Party Archetype — rejected, different problem) · QA `TC-CRM-005` (behavior contract) · issue #2615 (single-select blank-label fix, superseded) · issue #1716 (primary-badge contrast).

## TLDR

**Key points:**
- The person form exposes **one** company via `companyEntityId` (`CompanySelectField`, a single-value combobox), but the data model already stores **many** companies per person in the `customer_person_company_links` join table, with full command/undo support and dedicated link endpoints.
- Add a **new** multi-company picker component (`CompanyMultiSelectField`, built on `TagsInput`) so a person can be linked to several companies on every surface that edits companies: the classic create page, the create dialog, the v2 edit page, and the classic edit page's `PersonHighlights` editor. **`CompanySelectField` keeps its scalar `value: string | undefined` / `onChange(next: string | undefined)` contract unchanged**, so external callers of the exported component continue to compile and behave identically; only in-repo call sites swap to the new component. See *Migration & Backward Compatibility* → *Component contract*.
- **Primary company is not user-managed.** The existing `is_primary` invariant and the legacy `customer_people.company_entity_id` mirror are preserved by auto-defaulting a primary deterministically. No primary affordance is rendered.

**Scope:**
- UI: add `CompanyMultiSelectField` and wire it into the shared person form field builder (classic create page, create dialog, v2 edit page via `createPersonEditFields`) and migrate `PersonHighlights` on the classic edit page to it; keep the capped-list + by-id label hydration that #2615 added. **Do not** change `CompanySelectField`'s signature; it stays exported and unchanged for external callers.
- Edit path: the form reconciles the selected set against the current set by calling the existing `POST`/`DELETE` `/api/customers/people/[id]/companies[/[linkId]]` link endpoints. No change to the person update contract for companies.
- Create path: the person does not exist yet, so there are no `[id]/companies` endpoints to call. The person **create** payload gains an additive `companyEntityIds: string[]`; the create command links the set in the same transaction it already uses for `companyEntityId`.
- `companyEntityId` is retained as a `@deprecated` mirror of the auto-primary on both request and response.

**Explicitly NOT in scope:**
- The Party / PartyRole identity layer (#671 / #672 / SPEC-035) — a different, rejected proposal about role *types* (customer/supplier/partner), not person→company membership. This spec does not reintroduce it.
- User-facing primary-company selection or a primary toggle.
- Changing the `customer_person_company_links` schema, the `is_primary` column, or the active-unique index. **No DB migration is intended.**

## Overview

`CompanySelectField` in `packages/core/src/modules/customers/components/formConfig.tsx` renders a single-value combobox bound to the person profile's `companyEntityId`. That value maps to the FK column `customer_people.company_entity_id`, which the backend keeps as a mirror of the **primary** row in `customer_person_company_links`. The join table (`CustomerPersonCompanyLink`) is the real source of truth for the full set — the person detail API already returns a `companies[]` array derived from it (`summarizePersonCompanies`), and the per-person link endpoints (`api/people/[id]/companies/route.ts`, `.../[linkId]/route.ts`) already create/update/remove rows via the undoable `customers.personCompanyLinks.*` commands.

The gap is purely the form: it caps a many-to-many relationship at one. `TC-CRM-005` lists "Person can be linked to multiple companies (if allowed)" as expected behavior, and #2615 touched this exact field but intentionally kept it single while fixing a blank-label bug. This spec closes the gap on the write side (form) without altering the storage model.

## Problem Statement

- **UI under-models the data.** A person can legitimately belong to multiple companies (consultant with several clients, contact spanning group entities). The DB, commands, undo, detail read API, and QA scenario all assume multi; only the form is single-value.
- **Workarounds are lossy.** Operators who need a second company today either overwrite the first (silently detaching it) or drop to the detail page's link affordance, so the primary create/edit flow can't express the real relationship.
- **A prior patch entrenched single-value.** #2615 fixed the capped-list blank-label symptom but left the field single, so the limitation is now "working as designed" rather than a visible bug.

## Proposed Solution

### UI — new `CompanyMultiSelectField` component

Add a **new** component `CompanyMultiSelectField` to `packages/core/src/modules/customers/components/formConfig.tsx`, built on **`TagsInput`** (`@open-mercato/ui/backend/inputs/TagsInput`), the shipped multi-select primitive. It does **not** replace `CompanySelectField`; both components coexist in the same module file. `CompanyMultiSelectField` reuses the existing module-local helpers verbatim (`normalizeCompanyOption`, the `/api/customers/companies` list loader, and the by-id `loadCompanyOption` resolve that #2615 introduced) so there is no logic fork.

- `value: string[]` — the linked company ids.
- `onChange(next: string[])` — the form field value.
- `loadSuggestions(query)` — reuse the current `/api/customers/companies?pageSize=100&sortField=name&sortDir=asc` loader (plus query filtering) for options.
- `selectedOptions` / `resolveLabel` — hydrate labels for already-linked ids not present in the capped page, reusing the by-id resolve (`/api/customers/companies?id=<id>`, module-local `loadCompanyOption`). This preserves the #2615 fix for the multi case (a linked company outside the first 100 still renders its label).
- `allowCustomValues={false}` — only real companies can be linked.

Selected companies render as removable `Tag` pills. The inline "create company" dialog that `CompanySelectField` already implements is extracted into a shared, non-breaking internal helper (`CompanyCreateDialog` — pure refactor, no exported-signature change) and reused by `CompanyMultiSelectField` so operators can still create a company inline and have it added to the set; `CompanySelectField` continues to render the same dialog with identical behavior.

No primary toggle, star, or ordering control is rendered — primary is a backend concern (below).

**`CompanySelectField` is left intact.** Its props (`value: string | undefined`, `onChange(next: string | undefined)`, `labels`) and runtime behavior are unchanged, so its exported contract and any third-party importer keep working. What changes is **which component each person surface renders**, not the scalar component itself.

#### Surfaces that gain the multi-select (verified against the code)

The module exposes four person surfaces that show or edit companies. Only three of them share the form field builder, and the classic edit page does **not**:

| Surface | Entry point | Field source today | Change |
| --- | --- | --- | --- |
| Classic **create** page | `backend/customers/people/create/page.tsx` (`"use client"`, `CrudForm`) | `createPersonFormFields` (`formConfig.tsx:968`), `companyEntityId` field at `:1036` | The builder's company field becomes `CompanyMultiSelectField`. |
| **Create dialog** on the list/detail pages | `components/detail/CreatePersonDialog.tsx:81` | `createPersonFormFields` | Gains the multi-select automatically through the shared builder; named here so it is covered by tests. |
| **v2 edit** page | `backend/customers/people-v2/[id]/page.tsx` (`"use client"`, `CrudForm`) | `createPersonEditFields` (`formConfig.tsx:1788`), which maps `createPersonFormFields` | Gains the multi-select through the shared builder. |
| Classic **edit** page | `backend/customers/people/[id]/page.tsx` (`"use client"`) | `PersonHighlights` (`components/detail/PersonHighlights.tsx:697`) → `CompanySelectField` at `:255`; the page does **not** use `createPersonFormFields` | **Concrete integration required:** `PersonHighlights` is migrated at its call site to render `CompanyMultiSelectField` and reconcile the set through the existing link endpoints. `CompanySelectField` stays exported and unchanged for other callers. |

There is no `/backend/customers/people-v2` create route: the `people-v2` tree contains only `[id]/page.tsx`. Any v2 create surface would be **new proposed work**, not existing infrastructure, and is out of scope here.

### Write path

Because create and edit have different capabilities, each uses the mechanism already available to it:

- **Edit via the form (v2 edit page).** On submit, `CrudForm` diffs the selected set against the person's current `companies[]` (from the detail API) and issues, through `useGuardedMutation`:
  - `POST /api/customers/people/[id]/companies { companyId }` for each added company (idempotent — `addPersonCompanyLink` undeletes a soft-deleted row and no-ops a duplicate).
  - `DELETE /api/customers/people/[id]/companies/[linkId]` for each removed company (passing the company id as the last segment, which `resolveLinkId` already accepts).
  - These reuse the undoable `customers.personCompanyLinks.create` / `.delete` commands verbatim. The person update contract is **unchanged** for companies.
- **Edit via `PersonHighlights` (classic edit page).** `PersonHighlights` currently receives a scalar `onCompanySave(companyId | null)` (`components/detail/PersonHighlights.tsx:57`) and edits one company. It is changed to render `CompanyMultiSelectField` for the person's full company set and to receive `onCompaniesChange(nextIds: string[])`, which runs the **same** diff-and-reconcile logic as the form path above (shared helper `reconcilePersonCompanyLinks(nextIds)`, using the existing link endpoints and guarded mutation). The displayed highlight becomes the primary company plus a count/secondary list; navigation to a company still resolves by id. This is what makes classic edit multi-select work while `CompanySelectField` itself stays untouched.
- **Create (no id yet).** The person create payload gains an additive, optional `companyEntityIds: string[]`. The `customers.people.create` command links the set while building the person graph, in the same `withAtomicFlush` transaction that already calls `syncLegacyPrimaryCompanyLink`. The existing single `companyEntityId` stays accepted for back-compat (treated as a one-element set when `companyEntityIds` is absent). Both the classic create page and `CreatePersonDialog` reach this path through the shared builder.

### Create command undo/redo (snapshot restoration)

The create command's `execute`, `undo`, and `redo` must all round-trip the full company set, not just the primary:

- **`execute`** links the resolved id set inside the existing `withAtomicFlush({ transaction: true })` block. A new helper `linkPersonCompanies(em, entity, profile, companyEntityIds)` runs as a single atomic phase and is **bounded and batched** (see *Cardinality bound and batched assembly*): it deduplicates the input, enforces `MAX_PERSON_COMPANIES`, resolves **all** companies in one scoped query, loads the person's existing links **once**, then writes the missing links in one pass. The **first** id becomes primary via the existing `syncLegacyPrimaryCompanyLink` path, the remaining ids are added as non-primary links via the existing `addPersonCompanyLink` helper (no new primary logic). It must not call `addPersonCompanyLink` per id with its implicit `loadPersonCompanyLinks`/`requireCompany` round-trips; the batched variant takes the pre-loaded link set and company map as arguments. `captureAfter` already stores `companies[]` through `loadPersonSnapshot` → `summarizePersonCompanies`, so no snapshot-shape change is needed.
- **`undo`** already deletes the person graph (which cascades/soft-deletes the links); unchanged.
- **`redo`** currently calls only `syncLegacyPrimaryCompanyLink(em, newEntity, newProfile, after.profile.companyEntityId)`. It is extended to call the same `linkPersonCompanies(em, newEntity, newProfile, orderedCompanyIds)` helper, where `orderedCompanyIds` is derived from the snapshot's `companies[]` with the `isPrimary` entry first so the primary flag and the `company_entity_id` mirror are reproduced exactly. This runs inside the existing redo `withAtomicFlush({ transaction: true })` block, preserving atomicity. Both the `entity-absent` (recreate) and `entity-present` (restore) redo branches use the helper, replacing the current single-company call in each.
- **Atomicity & ordering:** link restoration shares the redo transaction with the entity/profile/tag restore, so a mid-restore failure rolls back the whole redo. Primary/link metadata (`is_primary`, scope, timestamps semantics) are reproduced by routing the first id through the primary path and the rest through the standard add path — exactly the invariants `execute` establishes.

### Primary handling (not user-facing)

The `customer_person_company_links.is_primary` invariant and the `company_entity_id` mirror are preserved automatically:

- On create, the **first** id in `companyEntityIds` (or the lone `companyEntityId`) is linked as primary via the existing `syncLegacyPrimaryCompanyLink` / `addPersonCompanyLink(isPrimary: true)` path; the rest are non-primary links.
- On edit, adds default to non-primary (`addPersonCompanyLink` without `isPrimary`), **except** when the person currently has no companies — then the first add becomes primary, matching today's `addPersonCompanyLink` behavior. Removing the primary promotes a remaining link via the existing `promoteFallbackPrimaryLink`. All of this is existing helper behavior; the spec adds no new primary logic.
- The form never sends `isPrimary`, so there is no way to change which company is primary from the UI — consistent with "primary is out of scope."

## Architecture

- **No cross-module coupling added.** All reads/writes stay within the customers module and the existing link commands.
- **Canonical primitives only:** `TagsInput` (shipped multi-select), `apiCall`/`useGuardedMutation` for the link writes (the person form is a `CrudForm`; the company reconciliation runs as guarded mutations within the form's submit, per `packages/ui/AGENTS.md` → CrudForm + non-`CrudForm` writes). No raw `fetch`.
- **Undo/redo** of edit-path link add/remove is unchanged: each is already an undoable `customers.personCompanyLinks.*` command.
- **Create-command redo requires a change** (see *Create command undo/redo* below). The create snapshot already captures the full `companies[]` set (`loadPersonSnapshot` calls `summarizePersonCompanies`), but today's redo (`commands/people.ts` create `redo`) only re-links the single primary via `syncLegacyPrimaryCompanyLink(em, …, after.profile.companyEntityId)` — it never restores the remaining snapshot companies. Multi-company create → undo → redo currently loses every non-primary link. The redo design is extended to restore the complete snapshot set.
- **Encryption:** no new columns; company display labels already flow through `findWithDecryption` in `summarizePersonCompanies` / the companies list route. Nothing new to declare in `encryption.ts`.

### Frontend Architecture Contract

This feature adds client form state (selected-company set), asynchronous option hydration, and guarded link writes on the person surfaces listed in *Surfaces that gain the multi-select*. Per the repository Frontend Architecture Contract (`.ai/specs/2026-05-13-frontend-client-boundary-ram-reduction.md` → *Frontend Architecture Contract*):

#### 1. Server/Client boundary map

All four entry points are **already client components** (`"use client"` at line 1 of each `page.tsx` / the dialog). There is no server page root to keep here and no server/client split to add; the contract question is which client module grows.

| Surface | Page root (already `"use client"`) | Client module that changes | Data owner | Notes |
| --- | --- | --- | --- | --- |
| Classic create `/backend/customers/people/create` | `backend/customers/people/create/page.tsx` | `components/formConfig.tsx` — `createPersonFormFields` → `CompanyMultiSelectField` | `POST /api/customers/people` (`companyEntityIds`) | No new `"use client"`; no page-root change. |
| Create dialog (`CreatePersonDialog`) | — (dialog, already client) | same `createPersonFormFields`; `components/detail/CreatePersonDialog.tsx` unchanged apart from receiving the new field | same as classic create | Covered by the shared builder; no new file. |
| v2 edit `/backend/customers/people-v2/[id]` | `backend/customers/people-v2/[id]/page.tsx` | `createPersonEditFields` → `createPersonFormFields` → `CompanyMultiSelectField` | `POST`/`DELETE /api/customers/people/[id]/companies[/[linkId]]` | No v2 create route exists; none is proposed. |
| Classic edit `/backend/customers/people/[id]` | `backend/customers/people/[id]/page.tsx` | `components/detail/PersonHighlights.tsx` — call site swaps `CompanySelectField` → `CompanyMultiSelectField`, adds set reconciliation | same link endpoints, through the shared reconcile helper | The page keeps using `PersonHighlights`; it does not adopt `createPersonFormFields`. |

`CompanySelectField` remains exported and unchanged; the multi-select is additive. No new route, no server-page extraction, and no new provider is introduced.

#### 2. `"use client"` ledger

| File | Change | Reason | Imported by | Heavy deps? | Cleanup / hydration risk |
| --- | --- | --- | --- | --- | --- |
| `components/formConfig.tsx` (already `"use client"`) | Adds `CompanyMultiSelectField` + extracted `CompanyCreateDialog` | Stateful multi-select: selected set, async option fetch, inline-create dialog. Browser-only capability. | classic create page, create dialog, `createPersonEditFields` | No (reuses `TagsInput`, `apiCall`; no table/editor/chart/SDK) | Options fetched via existing `loadOptions`/`loadCompanyOption`; abort/stale handled as today's single-select does. No new global effect/subscription. |
| `components/detail/PersonHighlights.tsx` (already `"use client"`) | Swaps the company editor to `CompanyMultiSelectField`; `onCompanySave` → `onCompaniesChange(nextIds)` | The classic detail editor is the only classic-edit company surface | `backend/customers/people/[id]/page.tsx:697` | No | Same page already hydrates the company; the set load reuses the detail API's `companies[]`. |

No **new** top-level `"use client"` file is introduced; both changed modules are existing client modules.

#### 3. Client blob guardrail

Both changed files are existing client modules and the additions are small leaves reusing existing helpers. No table/editor/calendar/graph/browser-SDK dependency is added. If `formConfig.tsx`'s touched additions trend past ~300 LOC net, extract `CompanyMultiSelectField` to a sibling leaf file importing the shared helpers — the extraction fallback, not expected to be needed. `PersonHighlights.tsx` is a leaf already; the swap is net-neutral apart from the reconcile callback.

#### 4. Budgets

| Budget | Default target | Spec value |
| --- | --- | --- |
| Backend page-root `"use client"` | 0 new unallowlisted | 0 (no page root touched; all four roots are already client) |
| Touched client files over 300 LOC growth | 0 unless justified | 0 new; `formConfig.tsx` additions kept minimal with the extraction fallback; `PersonHighlights.tsx` swap is net-neutral |
| Heavy browser libraries at page/provider root | 0 | 0 |
| Hydration/interaction smoke test | required for each changed interactive surface | classic create, create dialog, v2 edit, classic edit (`PersonHighlights`) — see *Test & evidence plan* |
| Performance evidence | static check + one build signal | `yarn check:client-boundaries` clean + `yarn workspace @open-mercato/core build` green |

#### 5. Provider / bootstrap scope

| Provider/bootstrap | Global? | Scope | Why | Exit criteria to narrow |
| --- | --- | --- | --- | --- |
| None added | — | — | Both surfaces use the person page's existing provider scope and `apiCall`; no new provider, context, or global bootstrap registration. | n/a |

#### 6. Test & evidence plan

Covered by the integration + hydration coverage in *Integration Test Coverage* below. Each of the four surfaces (classic create, create dialog, v2 edit, classic edit) gets an interaction check that the multi-company field renders, loads options, and submits/reconciles; plus `yarn check:client-boundaries` output and a green core build as the static + build evidence.

## Data Models

**No schema change.** Reuses:

- `customer_person_company_links` (`CustomerPersonCompanyLink`): `person_entity_id`, `company_entity_id`, `is_primary`, scope + timestamps + `deleted_at`; active-partial-unique on `(person_entity_id, company_entity_id) WHERE deleted_at IS NULL`.
- `customer_people.company_entity_id` (`CustomerPersonProfile.company`): retained as the `@deprecated` mirror of the auto-primary.

## API Contracts

- **Unchanged:** `GET /api/customers/people/[id]` still returns `companies[]` and the `@deprecated` `companyEntityId` (now documented as "primary mirror"). Edit uses the existing:
  - `GET/POST /api/customers/people/[id]/companies`
  - `PATCH/DELETE /api/customers/people/[id]/companies/[linkId]`
- **Additive (create):** `POST /api/customers/people` request gains optional `companyEntityIds: string[]` (uuids). `companyEntityId` remains accepted and is `@deprecated`. When both are present, `companyEntityIds` is authoritative and `companyEntityId` is folded in as a member (deduplicated); a currently-valid payload is **never newly rejected** — the API MUST NOT 400 on a `companyEntityId`-only or mismatched pair, since that would narrow an accepted contract (Category 7). Response adds nothing new (detail GET already carries `companies[]`).
- **Validator:** extend `personCreateSchema` with `companyEntityIds: z.array(uuid()).max(MAX_PERSON_COMPANIES).optional()`; derive types via `z.infer`. No change to `personUpdateSchema` for companies.

### Cardinality bound and batched assembly (resource safety)

The company set is attacker-controlled and is processed inside one write transaction, so it must be bounded **and** assembled without per-id reloads. Today `addPersonCompanyLink` calls `requireCompany` and `loadPersonCompanyLinks` on every invocation (`lib/personCompanies.ts:332-333`), so linking N ids one-by-one costs N company lookups and N full link-set loads — quadratic work and a long-held transaction. The design fixes this at both ends:

- **Constant:** `MAX_PERSON_COMPANIES = 50`, exported from the customers module (mirrors the repo's existing array caps such as `.max(20)` / `.max(50)`), and used in both the schema and the command.
- **Request schema:** `z.array(uuid()).max(MAX_PERSON_COMPANIES)` bounds the **raw** array length before any dedup, so an oversized payload is rejected by validation without entering the command.
- **Command boundary:** after folding in the legacy `companyEntityId`, the **deduplicated union** is re-checked against `MAX_PERSON_COMPANIES`. This closes the hole where many duplicate UUIDs pass the raw size check but a mismatched legacy field pushes the resolved set over the limit. Over-limit input is a validation error (`createCrudFormError`), not a partial write.
- **Batched assembly:** `linkPersonCompanies` resolves all companies in **one** scoped query (`id IN (…)` plus `organizationId`/`tenantId`) and loads the person's existing links **once** (`loadPersonCompanyLinks`); it then writes/undeletes the missing links from the in-memory maps. No per-id `requireCompany`/`loadPersonCompanyLinks` round-trip remains inside the loop. A missing or foreign company in the batched result fails the whole transaction (no partial graph).
- **Regression test:** a create request whose deduplicated set exceeds `MAX_PERSON_COMPANIES` returns a validation error and leaves **no** person row and **no** links behind.

## Migration & Backward Compatibility

Per `BACKWARD_COMPATIBILITY.md` (no changes to that document are required; no deprecation-protocol exemption is used):
- `companyEntityId` on the people request/response is **retained**, marked `@deprecated` with a JSDoc note pointing to `companyEntityIds` / `companies[]`. It continues to reflect the primary link. Removal is a separate future change with its own deprecation window.
- `personCreateSchema` gains an optional field (additive — non-breaking).
- No frozen contract (event id, DI key, route URL, DB schema, ACL feature) changes.

### Component contract (`CompanySelectField`)

`CompanySelectField` is an exported component in `components/formConfig.tsx` importable by third-party modules — a public-type / signature contract surface (Category 2/3 of `BACKWARD_COMPATIBILITY.md`). The original draft's "swap `CompanySelectField` value/onChange from scalar to `string[]`" would have **broken** that signature. This revision avoids the breakage entirely:

- `CompanySelectField` keeps its exact signature — `{ value?: string; onChange(next?: string): void; labels }` — and its runtime behavior. No `@deprecated` tag is needed; it remains the supported single-select primitive for third-party and future scalar uses.
- The multi-select is a **new, separate** component `CompanyMultiSelectField` with its own `{ value: string[]; onChange(next: string[]): void; labels }` signature. New additive export — non-breaking.
- The in-repo consumer changes by **call site, not by contract**: `PersonHighlights` replaces its use of the scalar component with the new multi-select component and adopts `onCompaniesChange(nextIds)`. `PersonHighlights` is internal to the module (not an exported package surface), so this is a behaviour change on one internal screen, not a public-signature break. Any third-party importer of `CompanySelectField` is unaffected.
- The inline create-company dialog is extracted into an internal `CompanyCreateDialog` and shared by both components. This is an internal refactor only; neither component's exported signature or behavior changes, and no import path is removed.
- **Covered consumers:** `PersonHighlights` (unchanged, still scalar), the person create/edit form field builder `createPersonFormFields` (migrated to `CompanyMultiSelectField`), and external importers of `CompanySelectField` (unaffected). No deprecation window is consumed because nothing is removed or narrowed.

## UI/UX

- The person **create/form surfaces** (classic create page, create dialog, v2 edit page) render `CompanyMultiSelectField` — a `TagsInput` of company pills with the inline "create company" dialog preserved. Empty state shows the existing placeholder.
- The person-**detail** inline editor (`PersonHighlights` on the classic edit page) also moves to `CompanyMultiSelectField`: it shows the primary company plus the rest of the set and edits the full set inline. The scalar `CompanySelectField` component is not rendered there any more, but it stays exported and unchanged.
- Dialog keyboard contract (`Cmd/Ctrl+Enter` submit, `Escape` cancel) is inherited from the shared `CompanyCreateDialog` (extracted from today's inline-create dialog) — unchanged.
- No status colors, arbitrary Tailwind sizes, or inline SVG introduced; `Tag` + `TagsInput` already follow DS tokens. Boy-Scout: migrate any touched lines in `formConfig.tsx` to semantic tokens if applicable.
- All copy via `useT()` keys under `customers.people.form.company*`; no hard-coded strings.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Edit reconciliation races (parallel add/remove) leave the set inconsistent | Medium | person edit submit | Sequence link calls through `useGuardedMutation`; rely on `addPersonCompanyLink` idempotency (undelete/no-op) and `removePersonCompanyLink`; reload `companies[]` after save | Partial failure mid-sequence surfaces via flash + the reloaded set reflects actual DB state |
| Create links not atomic with the person row | Medium | person create command | Links are added inside the command's existing `withAtomicFlush({ transaction: true })` block via `linkPersonCompanies`, same transaction as the entity/profile/tag writes | None beyond existing create-command guarantees |
| Create **redo** restores only the primary company, silently dropping non-primary links | High | person create command `redo` | Redo calls `linkPersonCompanies` with the snapshot's full `companies[]` (primary-first ordering) in both redo branches, inside the redo transaction, instead of the current single `syncLegacyPrimaryCompanyLink` call; required integration test asserts create→undo→redo preserves every link and the primary | None — redo reproduces the exact snapshot set and primary flag |
| `CompanySelectField` signature change breaks `PersonHighlights` / external callers | High (original draft) | component contract | Resolved: `CompanySelectField` kept intact; multi-select is the new `CompanyMultiSelectField`; the in-repo `PersonHighlights` call site swaps component (internal screen, not an exported contract); shared dialog extracted without signature change | None — no exported contract changes |
| Unbounded `companyEntityIds` causes quadratic link work and a long transaction | High | create command | `MAX_PERSON_COMPANIES = 50` enforced on the raw array in the schema and on the deduplicated union at the command boundary; `linkPersonCompanies` batches company resolution and loads the person's links once; over-limit request is rejected with no rows written | None — bounded and batched by construction |
| Removing the primary company via multi-select silently repoints `company_entity_id` | Low | legacy mirror | Existing `promoteFallbackPrimaryLink` already handles this; documented as intended | Third-party readers of `companyEntityId` see a different (still valid) primary |
| Capped option list hides a linked company label (the #2615 class, now multiplied across N pills) | Medium | form render | Reuse by-id `loadCompanyOption` hydration per selected id; add integration coverage for a linked company beyond the first 100 | None if hydration runs for every selected id |
| `companyEntityId` + `companyEntityIds` both sent on create | Low | create validator | `companyEntityIds` is authoritative; `companyEntityId` is folded in as a member (dedup). Never 400 a currently-valid payload (Category 7 — no contract narrowing) | A client sending a mismatched pair gets the union, not an error — acceptable and documented |

Rollback: revert the form component + the additive validator field; the link table and commands are untouched, so no data migration or state cleanup is involved.

## Integration Test Coverage (ships with implementation)

Per `.ai/qa/AGENTS.md`, these land in the same change under `packages/core/src/modules/customers/__integration__/`:

- **Create with multiple companies:** `POST /api/customers/people` with `companyEntityIds: [a, b]`; read back `GET /[id]`; assert `companies[]` contains both and exactly one `isPrimary` (the first id).
- **Create → undo → redo (multi-company):** create a person with `companyEntityIds: [a, b]`; undo the create; redo it; assert `GET /[id]` returns **both** `a` and `b` with the same single `isPrimary` as the original create (guards the create-redo restoration — regression for the dropped-`b` bug this spec fixes).
- **Edit add/remove:** from a person with company `a`, select `[a, b]` → assert both linked; then `[b]` → assert `a` removed, `b` present; assert the legacy `companyEntityId` still resolves to an active linked company.
- **Capped-list label hydration (#2615 regression, multi):** create >100 companies, link the person to one omitted from the first page, open the edit form, assert its pill renders the saved label (not blank).
- **Back-compat:** `POST` with only the deprecated `companyEntityId` still links that one company as primary.
- **Over-limit rejection:** a `POST` whose deduplicated company set exceeds `MAX_PERSON_COMPANIES` is rejected and leaves **no** person row and **no** links; a raw array longer than the bound is rejected before the command runs.
- **Legacy union bound:** a payload with `companyEntityIds` just under the cap plus a distinct `companyEntityId` that pushes the deduplicated union over the cap is rejected.
- **Component contract (`CompanySelectField`):** the exported scalar component still compiles and behaves unchanged (import + scalar render guard), independent of the `PersonHighlights` call-site swap.
- **Surface interaction (per Frontend Architecture Contract):** classic create, create dialog, v2 edit, and the classic edit `PersonHighlights` editor each load the multi-company field, hydrate options, and submit/reconcile successfully.

Reference the existing CRM fixtures (`@open-mercato/core/helpers/integration/crmFixtures`).

## Phasing

- **Phase 1 — Create path + undo/redo.** Add the bounded `companyEntityIds` field to `personCreateSchema`; add the batched `linkPersonCompanies` helper (one company query, one link-set load) and call it from the create command `execute`; extend both `redo` branches to restore the full snapshot `companies[]` via the same helper (replacing the single `syncLegacyPrimaryCompanyLink` call). Back-compat for `companyEntityId`. Integration tests for create, create→undo→redo (multi), back-compat, and the over-limit / legacy-union bound.
- **Phase 2 — Multi-select component + call sites.** Add `CompanyMultiSelectField` (new component on `TagsInput`) and extract the shared `CompanyCreateDialog`, leaving `CompanySelectField` intact. Wire `createPersonFormFields` (classic create + create dialog + v2 edit via `createPersonEditFields`) to the new field; migrate `PersonHighlights` to the new component with `onCompaniesChange` and the shared reconcile helper; keep inline company creation and by-id label hydration. Integration + interaction tests for edit add/remove (both form and `PersonHighlights`), capped-list hydration, and the four surfaces.
- **Phase 3 — Docs/QA.** Update `TC-CRM-005` notes and any people-form docs to reflect multi-company; confirm `companyEntityId` deprecation note.

## Final Compliance Report

- **TLDR / Overview / Problem / Proposed Solution / Architecture / Data Models / API Contracts / Risks / Changelog** — all present.
- **Component contract (blocker):** `CompanySelectField` scalar signature is **retained**; multi-select ships as the new `CompanyMultiSelectField`. The `PersonHighlights` call site swaps component (internal screen, not an exported contract), and external importers of `CompanySelectField` are unaffected. No signature narrowing, no deprecation window consumed.
- **Create undo/redo (major):** the create command `redo` is redesigned to restore the full snapshot `companies[]` (primary-first) via a shared `linkPersonCompanies` helper inside the redo transaction, instead of re-linking only the primary. A create→undo→redo multi-company integration test is required.
- **Frontend Architecture Contract (major):** present with the real Server/Client boundary map (all four roots already `"use client"`; no v2 create route), `"use client"` ledger, client-blob guardrail + extraction fallback, measurable budgets, provider scope (none added), and per-surface interaction evidence for classic create, create dialog, v2 edit, and the classic edit `PersonHighlights`.
- **Resource safety (major):** `MAX_PERSON_COMPANIES = 50` bounds the raw array and the deduplicated command-level union; `linkPersonCompanies` batches company resolution and loads the person's links once, eliminating the per-id `requireCompany`/`loadPersonCompanyLinks` round-trips. Over-limit requests are rejected with no rows written.
- **Canonical primitives:** `TagsInput`, `apiCall`/`useGuardedMutation`, existing link commands — no raw `fetch`, no new cross-module coupling.
- **DS / i18n:** semantic tokens only, `useT()` keys, dialog keyboard contract preserved via the shared `CompanyCreateDialog`.
- **CI / validation:** spec-only change; the repository CI (lint, DS lint, scope/audit guards, docs-applicable tests) runs on the same-repo carry branch and is the validation source. No code, schema, or API surface ships from this PR.

## Changelog

- 2026-10-07 — Initial draft (spec-only). Open Questions resolved; full design, phasing, risks, and integration coverage written. No implementation.
- 2026-10-07 — Backward-compatibility review against `BACKWARD_COMPATIBILITY.md`. Removed a proposed 400-reject on a `companyEntityId`/`companyEntityIds` mismatch (would have narrowed an accepted request contract — Category 7); the deprecated field is now folded in rather than rejected. Renamed the section to "Migration & Backward Compatibility" per Deprecation Protocol step 5. Confirmed no changes to the BC document and no deprecation-protocol exemption are needed.
- 2026-10-09 — Review revision addressing three findings. (1) **blocker** — stopped mutating `CompanySelectField` in place; the scalar component is retained and the multi-select is a new `CompanyMultiSelectField`, with `PersonHighlights` + external callers covered in a new *Component contract* subsection and a dedicated test. (2) **major** — redesigned the create-command `redo` to restore the complete company-link snapshot (primary-first, atomic) via a shared `linkPersonCompanies` helper, with a required create→undo→redo multi-company integration test; corrected the earlier "undo is unchanged" claim. (3) **major** — added the Frontend Architecture Contract (boundary map, `"use client"` ledger, blob guardrail, budgets, provider scope, per-route hydration/QA evidence) for all four classic + v2 routes. Added a Final Compliance Report; noted the maintainer-gated CI/mutation/enterprise-guard validations as spec-external.
- 2026-11-15 — Carry-forward revision: corrected the `PersonHighlights` reference to its full path (`components/detail/PersonHighlights.tsx:255`) and replaced the non-existent `om-spec-writing` reference citation with the repository's canonical Frontend Architecture Contract source (`.ai/specs/2026-05-13-frontend-client-boundary-ram-reduction.md`). No design change; all three prior findings remain resolved.
- 2026-11-15 — Second carry-forward revision (review of the carried-forward head): corrected the route/form integration map to the real code — `people-v2` has no create page, the classic edit page does not use `createPersonFormFields` and needs the `PersonHighlights` call-site migration, and all four page roots are already `"use client"` — and added the *Cardinality bound and batched assembly* design (`MAX_PERSON_COMPANIES = 50`, schema + deduplicated command-level enforcement, batched company/link loading, over-limit regression) in response to an independent security finding.
