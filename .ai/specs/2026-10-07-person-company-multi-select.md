# Person ↔ Company multi-select on the person form

**Status:** Draft / proposal — for discussion; implementation not committed.
**Scope:** OSS `customers` module (`packages/core/src/modules/customers/`) — person create/edit form, the person create/update API + command, and the existing per-person company-link endpoints.
**Prior art:** issue #671 + closed PR #672 (SPEC-035 Party Archetype — rejected, different problem) · QA `TC-CRM-005` (behavior contract) · issue #2615 (single-select blank-label fix, superseded) · issue #1716 (primary-badge contrast).

## TLDR

**Key points:**
- The person form exposes **one** company via `companyEntityId` (`CompanySelectField`, a single-value combobox), but the data model already stores **many** companies per person in the `customer_person_company_links` join table, with full command/undo support and dedicated link endpoints.
- Replace the single-value picker with a **multi-select** (`TagsInput`) so a person can be linked to several companies, on both the create and edit forms, on both the classic and `people-v2` pages (they share `CompanySelectField`).
- **Primary company is not user-managed.** The existing `is_primary` invariant and the legacy `customer_people.company_entity_id` mirror are preserved by auto-defaulting a primary deterministically. No primary affordance is rendered.

**Scope:**
- UI: swap `CompanySelectField` (single) for a multi-company picker on the person form; keep the capped-list + by-id label hydration that #2615 added.
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

### UI — multi-company picker

Replace `CompanySelectField`'s single-value `Select`/combobox with a multi-value control built on **`TagsInput`** (`@open-mercato/ui/backend/inputs/TagsInput`), which is already the shipped multi-select primitive:

- `value: string[]` — the linked company ids.
- `onChange(next: string[])` — the form field value.
- `loadSuggestions(query)` — reuse the current `/api/customers/companies?pageSize=100&sortField=name&sortDir=asc` loader (plus query filtering) for options.
- `selectedOptions` / `resolveLabel` — hydrate labels for already-linked ids not present in the capped page, reusing the by-id resolve (`/api/customers/companies?id=<id>`) that #2615 introduced as `loadCompanyOption`. This preserves the #2615 fix for the multi case (a linked company outside the first 100 still renders its label).
- `allowCustomValues={false}` — only real companies can be linked.

Selected companies render as removable `Tag` pills. The "add company" affordance (the current inline create-company dialog in `CompanySelectField`) is retained so operators can still create a company inline and have it added to the set.

No primary toggle, star, or ordering control is rendered — primary is a backend concern (below).

### Write path

Because create and edit have different capabilities, each uses the mechanism already available to it:

- **Edit (person has an id).** On submit, the form diffs the selected set against the person's current `companies[]` (from the detail API) and issues, through `useGuardedMutation`:
  - `POST /api/customers/people/[id]/companies { companyId }` for each added company (idempotent — `addPersonCompanyLink` undeletes a soft-deleted row and no-ops a duplicate).
  - `DELETE /api/customers/people/[id]/companies/[linkId]` for each removed company (passing the company id as the last segment, which `resolveLinkId` already accepts).
  - These reuse the undoable `customers.personCompanyLinks.create` / `.delete` commands verbatim. The person update contract is **unchanged** for companies.
- **Create (no id yet).** The person create payload gains an additive, optional `companyEntityIds: string[]`. The `customers.people.create` command links each id while building the person graph, in the same `withAtomicFlush` transaction that already calls `syncLegacyPrimaryCompanyLink`. The existing single `companyEntityId` stays accepted for back-compat (treated as a one-element set when `companyEntityIds` is absent).

### Primary handling (not user-facing)

The `customer_person_company_links.is_primary` invariant and the `company_entity_id` mirror are preserved automatically:

- On create, the **first** id in `companyEntityIds` (or the lone `companyEntityId`) is linked as primary via the existing `syncLegacyPrimaryCompanyLink` / `addPersonCompanyLink(isPrimary: true)` path; the rest are non-primary links.
- On edit, adds default to non-primary (`addPersonCompanyLink` without `isPrimary`), **except** when the person currently has no companies — then the first add becomes primary, matching today's `addPersonCompanyLink` behavior. Removing the primary promotes a remaining link via the existing `promoteFallbackPrimaryLink`. All of this is existing helper behavior; the spec adds no new primary logic.
- The form never sends `isPrimary`, so there is no way to change which company is primary from the UI — consistent with "primary is out of scope."

## Architecture

- **No cross-module coupling added.** All reads/writes stay within the customers module and the existing link commands.
- **Canonical primitives only:** `TagsInput` (shipped multi-select), `apiCall`/`useGuardedMutation` for the link writes (the person form is a `CrudForm`; the company reconciliation runs as guarded mutations within the form's submit, per `packages/ui/AGENTS.md` → CrudForm + non-`CrudForm` writes). No raw `fetch`.
- **Undo** is unchanged: each link add/remove is already an undoable `customers.personCompanyLinks.*` command; create links go through the person create command's existing undo snapshot (which already captures `companies[]`).
- **Encryption:** no new columns; company display labels already flow through `findWithDecryption` in `summarizePersonCompanies` / the companies list route. Nothing new to declare in `encryption.ts`.

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

## UI/UX

- The person form's company field becomes a `TagsInput` of company pills with the inline "create company" dialog preserved. Empty state shows the existing placeholder.
- Dialog keyboard contract (`Cmd/Ctrl+Enter` submit, `Escape` cancel) is inherited from the existing inline-create dialog — unchanged.
- No status colors, arbitrary Tailwind sizes, or inline SVG introduced; `Tag` + `TagsInput` already follow DS tokens. Boy-Scout: migrate any touched lines in `formConfig.tsx` to semantic tokens if applicable.
- All copy via `useT()` keys under `customers.people.form.company*`; no hard-coded strings.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Edit reconciliation races (parallel add/remove) leave the set inconsistent | Medium | person edit submit | Sequence link calls through `useGuardedMutation`; rely on `addPersonCompanyLink` idempotency (undelete/no-op) and `removePersonCompanyLink`; reload `companies[]` after save | Partial failure mid-sequence surfaces via flash + the reloaded set reflects actual DB state |
| Create links not atomic with the person row | Medium | person create command | Links are added inside the command's existing `withAtomicFlush({ transaction: true })` block, same as today's single link | None beyond existing create-command guarantees |
| Removing the primary company via multi-select silently repoints `company_entity_id` | Low | legacy mirror | Existing `promoteFallbackPrimaryLink` already handles this; documented as intended | Third-party readers of `companyEntityId` see a different (still valid) primary |
| Capped option list hides a linked company label (the #2615 class, now multiplied across N pills) | Medium | form render | Reuse by-id `loadCompanyOption` hydration per selected id; add integration coverage for a linked company beyond the first 100 | None if hydration runs for every selected id |
| `companyEntityId` + `companyEntityIds` both sent on create | Low | create validator | `companyEntityIds` is authoritative; `companyEntityId` is folded in as a member (dedup). Never 400 a currently-valid payload (Category 7 — no contract narrowing) | A client sending a mismatched pair gets the union, not an error — acceptable and documented |

Rollback: revert the form component + the additive validator field; the link table and commands are untouched, so no data migration or state cleanup is involved.

## Integration Test Coverage (ships with implementation)

Per `.ai/qa/AGENTS.md`, these land in the same change under `packages/core/src/modules/customers/__integration__/`:

- **Create with multiple companies:** `POST /api/customers/people` with `companyEntityIds: [a, b]`; read back `GET /[id]`; assert `companies[]` contains both and exactly one `isPrimary`.
- **Edit add/remove:** from a person with company `a`, select `[a, b]` → assert both linked; then `[b]` → assert `a` removed, `b` present; assert the legacy `companyEntityId` still resolves to an active linked company.
- **Capped-list label hydration (#2615 regression, multi):** create >100 companies, link the person to one omitted from the first page, open the edit form, assert its pill renders the saved label (not blank).
- **Back-compat:** `POST` with only the deprecated `companyEntityId` still links that one company as primary.

Reference the existing CRM fixtures (`@open-mercato/core/helpers/integration/crmFixtures`).

## Phasing

- **Phase 1 — Create path.** Add `companyEntityIds` to `personCreateSchema` + the create command link loop; back-compat for `companyEntityId`. Integration tests for create + back-compat.
- **Phase 2 — Form multi-select.** Replace `CompanySelectField` with the `TagsInput` picker (create + edit, classic + v2), wire edit reconciliation through the existing link endpoints, keep inline company creation and by-id label hydration. Integration tests for edit add/remove + capped-list hydration.
- **Phase 3 — Docs/QA.** Update `TC-CRM-005` notes and any people-form docs to reflect multi-company; confirm `companyEntityId` deprecation note.

## Changelog

- 2026-10-07 — Initial draft (spec-only). Open Questions resolved; full design, phasing, risks, and integration coverage written. No implementation.
- 2026-10-07 — Backward-compatibility review against `BACKWARD_COMPATIBILITY.md`. Removed a proposed 400-reject on a `companyEntityId`/`companyEntityIds` mismatch (would have narrowed an accepted request contract — Category 7); the deprecated field is now folded in rather than rejected. Renamed the section to "Migration & Backward Compatibility" per Deprecation Protocol step 5. Confirmed no changes to the BC document and no deprecation-protocol exemption are needed.
