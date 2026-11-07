# Person ↔ Company multi-select on the person form

**Status:** Draft / proposal — for discussion; implementation not committed.
**Scope:** OSS `customers` module (`packages/core/src/modules/customers/`) — person create/edit form, the person create/update API + command, and the existing per-person company-link endpoints.
**Prior art:** issue #671 + closed PR #672 (SPEC-035 Party Archetype — rejected, different problem) · QA `TC-CRM-005` (behavior contract) · issue #2615 (single-select blank-label fix, superseded) · issue #1716 (primary-badge contrast).

## TLDR

**Key points:**
- The person form exposes **one** company via `companyEntityId` (`CompanySelectField`, a single-value combobox), but the data model already stores **many** companies per person in the `customer_person_company_links` join table, with full command/undo support and dedicated link endpoints.
- Add a **new** multi-company picker component (`CompanyMultiSelectField`, built on `TagsInput`) so a person can be linked to several companies, on both the create and edit forms, on both the classic and `people-v2` pages. **`CompanySelectField` keeps its scalar `value: string | undefined` / `onChange(next: string | undefined)` contract unchanged** so its existing consumer (`PersonHighlights.tsx:255`) and any external callers of the exported component continue to compile and behave identically. See *Migration & Backward Compatibility* → *Component contract*.
- **Primary company is not user-managed.** The existing `is_primary` invariant and the legacy `customer_people.company_entity_id` mirror are preserved by auto-defaulting a primary deterministically. No primary affordance is rendered.

**Scope:**
- UI: add `CompanyMultiSelectField` and wire it into the person create/edit form (classic + v2); keep the capped-list + by-id label hydration that #2615 added. **Do not** change `CompanySelectField`'s signature; it stays in place for `PersonHighlights` and external callers.
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

**`CompanySelectField` is left intact.** Its props (`value: string | undefined`, `onChange(next: string | undefined)`, `labels`) and runtime behavior are unchanged. `PersonHighlights.tsx:255` (the person-detail inline company editor) and any third-party importer keep working with no edit. Only the person **create/edit form field builder** (`createPersonFormFields`) swaps to `CompanyMultiSelectField`.

### Write path

Because create and edit have different capabilities, each uses the mechanism already available to it:

- **Edit (person has an id).** On submit, the form diffs the selected set against the person's current `companies[]` (from the detail API) and issues, through `useGuardedMutation`:
  - `POST /api/customers/people/[id]/companies { companyId }` for each added company (idempotent — `addPersonCompanyLink` undeletes a soft-deleted row and no-ops a duplicate).
  - `DELETE /api/customers/people/[id]/companies/[linkId]` for each removed company (passing the company id as the last segment, which `resolveLinkId` already accepts).
  - These reuse the undoable `customers.personCompanyLinks.create` / `.delete` commands verbatim. The person update contract is **unchanged** for companies.
- **Create (no id yet).** The person create payload gains an additive, optional `companyEntityIds: string[]`. The `customers.people.create` command links each id while building the person graph, in the same `withAtomicFlush` transaction that already calls `syncLegacyPrimaryCompanyLink`. The existing single `companyEntityId` stays accepted for back-compat (treated as a one-element set when `companyEntityIds` is absent).

### Create command undo/redo (snapshot restoration)

The create command's `execute`, `undo`, and `redo` must all round-trip the full company set, not just the primary:

- **`execute`** links the resolved id set inside the existing `withAtomicFlush({ transaction: true })` block. A new helper `linkPersonCompanies(em, entity, profile, companyEntityIds)` runs as a single atomic phase: the **first** id becomes primary via the existing `syncLegacyPrimaryCompanyLink` path, the remaining ids are added as non-primary links via the existing `addPersonCompanyLink` helper (no new primary logic). `captureAfter` already stores `companies[]` through `loadPersonSnapshot` → `summarizePersonCompanies`, so no snapshot-shape change is needed.
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

This feature adds client form state (selected-company set), asynchronous option hydration, and guarded link writes across four person routes. Per `om-spec-writing` → `references/frontend-architecture-contract.md`:

#### 1. Server/Client boundary map

| Route / surface | Server root | Client islands | Data owner | Notes |
| --- | --- | --- | --- | --- |
| `/backend/customers/people/create` (classic create) | `backend/customers/people/create/page.tsx` | existing `CrudForm` client island + new `CompanyMultiSelectField` leaf | `POST /api/customers/people` (`companyEntityIds`) | No new page-root `"use client"`; the picker is a field inside the already-client `CrudForm`. |
| `/backend/customers/people/[id]` (classic edit, via `PersonHighlights`) | `backend/customers/people/[id]/page.tsx` | existing detail client island + `CompanyMultiSelectField` in the form; **`PersonHighlights` keeps `CompanySelectField`** | `POST`/`DELETE /api/customers/people/[id]/companies[/[linkId]]` | Inline detail editor contract unchanged (scalar `CompanySelectField`). |
| `/backend/customers/people-v2` (v2 create) | v2 `page.tsx` | shared `createPersonFormFields` → `CompanyMultiSelectField` leaf | same as classic create | Shares the form field builder with classic; no v2-specific client root added. |
| `/backend/customers/people-v2/[id]` (v2 edit) | v2 `[id]/page.tsx` | same shared field builder | same as classic edit | — |

Rules honored: `page.tsx`/`layout.tsx` stay server components; the only client surface added is the `CompanyMultiSelectField` leaf, scoped to the form, reusing the form's existing provider scope. No new shared/global provider.

#### 2. `"use client"` ledger

| File | Reason | Imported by | Heavy deps? | Cleanup / hydration risk | Alternative rejected |
| --- | --- | --- | --- | --- | --- |
| `components/formConfig.tsx` (already `"use client"`) | Adds `CompanyMultiSelectField` + extracted `CompanyCreateDialog`: stateful multi-select (selected set, async option fetch, inline-create dialog). Browser-only capability: controlled form state + `fetch`-backed option hydration + dialog focus/keyboard. | `createPersonFormFields` (classic + v2 person form) | No (reuses `TagsInput`, `apiCall`; no table/editor/chart/SDK) | Options fetched via existing `loadOptions`/`loadCompanyOption`; abort/stale handled as today's single-select does. No new global effect/subscription. | A separate client file was rejected — the component shares `normalizeCompanyOption`/`loadCompanyOption` with `CompanySelectField` in the same file; splitting would duplicate logic. |

No **new** top-level `"use client"` file is introduced; the change extends an existing client module.

#### 3. Client blob guardrail

`formConfig.tsx` is an existing client module. The additions (`CompanyMultiSelectField` + extracted `CompanyCreateDialog`) are small leaves reusing existing helpers; the dialog extraction is net-neutral LOC. No table/editor/calendar/graph/browser-SDK dependency is added. If the file's touched additions trend past ~300 LOC net, extract `CompanyMultiSelectField` to a sibling leaf file importing the shared helpers — called out as the extraction fallback, not expected to be needed.

#### 4. Budgets

| Budget | Default target | Spec value |
| --- | --- | --- |
| Generated backend page-root `"use client"` | 0 new unallowlisted | 0 (no page root touched) |
| Touched client page/root files over 300 LOC | 0 unless justified | 0 new; `formConfig.tsx` additions kept minimal, extraction fallback defined |
| Heavy browser libraries at page/provider root | 0 | 0 |
| Per-route hydration smoke test | required for changed interactive route | Hydration/interaction coverage on classic create, classic edit, v2 create, v2 edit (see Test & Evidence) |
| Performance evidence | static check + one runtime/build/bundle signal | `yarn check:client-boundaries` clean + `yarn workspace @open-mercato/core build` green |

#### 5. Provider / bootstrap scope

| Provider/bootstrap | Global? | Scope | Why | Exit criteria to narrow |
| --- | --- | --- | --- | --- |
| None added | — | — | The picker uses the person form's existing provider scope and `apiCall`; no new provider, context, or global bootstrap registration. | n/a |

#### 6. Test & evidence plan

Covered by the integration + hydration coverage in *Integration Test Coverage* below. Each of the four routes (classic create, classic edit, v2 create, v2 edit) gets a hydration/interaction check that the multi-company field renders, loads options, and submits; plus `yarn check:client-boundaries` output and a green core build as the static + build evidence.

## Data Models

**No schema change.** Reuses:

- `customer_person_company_links` (`CustomerPersonCompanyLink`): `person_entity_id`, `company_entity_id`, `is_primary`, scope + timestamps + `deleted_at`; active-partial-unique on `(person_entity_id, company_entity_id) WHERE deleted_at IS NULL`.
- `customer_people.company_entity_id` (`CustomerPersonProfile.company`): retained as the `@deprecated` mirror of the auto-primary.

## API Contracts

- **Unchanged:** `GET /api/customers/people/[id]` still returns `companies[]` and the `@deprecated` `companyEntityId` (now documented as "primary mirror"). Edit uses the existing:
  - `GET/POST /api/customers/people/[id]/companies`
  - `PATCH/DELETE /api/customers/people/[id]/companies/[linkId]`
- **Additive (create):** `POST /api/customers/people` request gains optional `companyEntityIds: string[]` (uuids). `companyEntityId` remains accepted and is `@deprecated`. When both are present, `companyEntityIds` is authoritative and `companyEntityId` is folded in as a member (deduplicated); a currently-valid payload is **never newly rejected** — the API MUST NOT 400 on a `companyEntityId`-only or mismatched pair, since that would narrow an accepted contract (Category 7). Response adds nothing new (detail GET already carries `companies[]`).
- **Validator:** extend `personCreateSchema` with `companyEntityIds: z.array(uuid()).optional()`; derive types via `z.infer`. No change to `personUpdateSchema` for companies.

## Migration & Backward Compatibility

Per `BACKWARD_COMPATIBILITY.md` (no changes to that document are required; no deprecation-protocol exemption is used):
- `companyEntityId` on the people request/response is **retained**, marked `@deprecated` with a JSDoc note pointing to `companyEntityIds` / `companies[]`. It continues to reflect the primary link. Removal is a separate future change with its own deprecation window.
- `personCreateSchema` gains an optional field (additive — non-breaking).
- No frozen contract (event id, DI key, route URL, DB schema, ACL feature) changes.

### Component contract (`CompanySelectField`)

`CompanySelectField` is an exported component in `components/formConfig.tsx` consumed in-repo by `PersonHighlights.tsx:255` and importable by third-party modules — i.e. a public-type / signature contract surface (Category 2/3 of `BACKWARD_COMPATIBILITY.md`). The original draft's "swap `CompanySelectField` value/onChange from scalar to `string[]`" would have **broken** that signature and the `PersonHighlights` scalar editing path. This revision avoids the breakage entirely:

- `CompanySelectField` keeps its exact signature — `{ value?: string; onChange(next?: string): void; labels }` — and its runtime behavior. No `@deprecated` tag is needed; it remains the supported single-select for inline/detail use.
- The multi-select is a **new, separate** component `CompanyMultiSelectField` with its own `{ value: string[]; onChange(next: string[]): void; labels }` signature. New additive export — non-breaking.
- The inline create-company dialog is extracted into an internal `CompanyCreateDialog` and shared by both components. This is an internal refactor only; neither component's exported signature or behavior changes, and no import path is removed.
- **Covered consumers:** `PersonHighlights` (unchanged, still scalar), the person create/edit form field builder `createPersonFormFields` (migrated to `CompanyMultiSelectField`), and external importers of `CompanySelectField` (unaffected). No deprecation window is consumed because nothing is removed or narrowed.

## UI/UX

- The person **create/edit form's** company field becomes `CompanyMultiSelectField` — a `TagsInput` of company pills with the inline "create company" dialog preserved. Empty state shows the existing placeholder. The person-**detail** inline editor (`PersonHighlights`) keeps the single-select `CompanySelectField` and is visually unchanged.
- Dialog keyboard contract (`Cmd/Ctrl+Enter` submit, `Escape` cancel) is inherited from the shared `CompanyCreateDialog` (extracted from today's inline-create dialog) — unchanged.
- No status colors, arbitrary Tailwind sizes, or inline SVG introduced; `Tag` + `TagsInput` already follow DS tokens. Boy-Scout: migrate any touched lines in `formConfig.tsx` to semantic tokens if applicable.
- All copy via `useT()` keys under `customers.people.form.company*`; no hard-coded strings.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Edit reconciliation races (parallel add/remove) leave the set inconsistent | Medium | person edit submit | Sequence link calls through `useGuardedMutation`; rely on `addPersonCompanyLink` idempotency (undelete/no-op) and `removePersonCompanyLink`; reload `companies[]` after save | Partial failure mid-sequence surfaces via flash + the reloaded set reflects actual DB state |
| Create links not atomic with the person row | Medium | person create command | Links are added inside the command's existing `withAtomicFlush({ transaction: true })` block via `linkPersonCompanies`, same transaction as the entity/profile/tag writes | None beyond existing create-command guarantees |
| Create **redo** restores only the primary company, silently dropping non-primary links | High | person create command `redo` | Redo calls `linkPersonCompanies` with the snapshot's full `companies[]` (primary-first ordering) in both redo branches, inside the redo transaction, instead of the current single `syncLegacyPrimaryCompanyLink` call; required integration test asserts create→undo→redo preserves every link and the primary | None — redo reproduces the exact snapshot set and primary flag |
| `CompanySelectField` signature change breaks `PersonHighlights` / external callers | High (original draft) | component contract | Resolved: `CompanySelectField` kept intact; multi-select is the new `CompanyMultiSelectField`; shared dialog extracted without signature change | None — no exported contract changes |
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
- **Component contract (`PersonHighlights`):** the person-detail inline company editor still renders `CompanySelectField` and edits a single company with the unchanged scalar contract (guards against an accidental signature regression).
- **Route hydration/interaction (per Frontend Architecture Contract):** classic create, classic edit, v2 create, v2 edit each load the multi-company field, hydrate options, and submit successfully.

Reference the existing CRM fixtures (`@open-mercato/core/helpers/integration/crmFixtures`).

## Phasing

- **Phase 1 — Create path + undo/redo.** Add `companyEntityIds` to `personCreateSchema`; add the `linkPersonCompanies` helper and call it from the create command `execute`; extend both `redo` branches to restore the full snapshot `companies[]` via the same helper (replacing the single `syncLegacyPrimaryCompanyLink` call). Back-compat for `companyEntityId`. Integration tests for create, create→undo→redo (multi), and back-compat.
- **Phase 2 — Form multi-select component.** Add `CompanyMultiSelectField` (new component on `TagsInput`) and extract the shared `CompanyCreateDialog`, leaving `CompanySelectField` intact. Wire `createPersonFormFields` (classic + v2, create + edit) to the new field; wire edit reconciliation through the existing link endpoints; keep inline company creation and by-id label hydration. Integration + route-hydration tests for edit add/remove, capped-list hydration, the four routes, and the `PersonHighlights` scalar-contract guard.
- **Phase 3 — Docs/QA.** Update `TC-CRM-005` notes and any people-form docs to reflect multi-company; confirm `companyEntityId` deprecation note.

## Final Compliance Report

- **TLDR / Overview / Problem / Proposed Solution / Architecture / Data Models / API Contracts / Risks / Changelog** — all present.
- **Component contract (blocker):** `CompanySelectField` scalar signature is **retained**; multi-select ships as the new `CompanyMultiSelectField`. `PersonHighlights` and external callers are explicitly covered in *Migration & Backward Compatibility → Component contract* and guarded by a dedicated integration test. No signature narrowing, no deprecation window consumed.
- **Create undo/redo (major):** the create command `redo` is redesigned to restore the full snapshot `companies[]` (primary-first) via a shared `linkPersonCompanies` helper inside the redo transaction, instead of re-linking only the primary. A create→undo→redo multi-company integration test is required.
- **Frontend Architecture Contract (major):** added with Server/Client boundary map, `"use client"` ledger, client-blob guardrail + extraction fallback, measurable budgets, provider scope (none added), and per-route hydration/interaction evidence across all four classic + v2 routes.
- **Canonical primitives:** `TagsInput`, `apiCall`/`useGuardedMutation`, existing link commands — no raw `fetch`, no new cross-module coupling.
- **DS / i18n:** semantic tokens only, `useT()` keys, dialog keyboard contract preserved via the shared `CompanyCreateDialog`.
- **CI / validation (open, maintainer-gated):** current-head CI, mutation tests, and the Enterprise Contribution Guard are `not_run` because the fork requires maintainer authorization to execute those workflows. These are **spec-external** gates — they are satisfied by a maintainer re-running the workflows on the branch, not by further spec edits. No enterprise-scope content is in this OSS spec.

## Changelog

- 2026-10-07 — Initial draft (spec-only). Open Questions resolved; full design, phasing, risks, and integration coverage written. No implementation.
- 2026-10-07 — Backward-compatibility review against `BACKWARD_COMPATIBILITY.md`. Removed a proposed 400-reject on a `companyEntityId`/`companyEntityIds` mismatch (would have narrowed an accepted request contract — Category 7); the deprecated field is now folded in rather than rejected. Renamed the section to "Migration & Backward Compatibility" per Deprecation Protocol step 5. Confirmed no changes to the BC document and no deprecation-protocol exemption are needed.
- 2026-10-09 — Review revision addressing three findings. (1) **blocker** — stopped mutating `CompanySelectField` in place; the scalar component is retained and the multi-select is a new `CompanyMultiSelectField`, with `PersonHighlights` + external callers covered in a new *Component contract* subsection and a dedicated test. (2) **major** — redesigned the create-command `redo` to restore the complete company-link snapshot (primary-first, atomic) via a shared `linkPersonCompanies` helper, with a required create→undo→redo multi-company integration test; corrected the earlier "undo is unchanged" claim. (3) **major** — added the Frontend Architecture Contract (boundary map, `"use client"` ledger, blob guardrail, budgets, provider scope, per-route hydration/QA evidence) for all four classic + v2 routes. Added a Final Compliance Report; noted the maintainer-gated CI/mutation/enterprise-guard validations as spec-external.
