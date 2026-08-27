# Deal People Tab — Linked-People Parity

**Created:** 2026-08-27
**Module:** `customers`
**Status:** Draft
**Related:** [SPEC-046 Customer Detail Pages v2](implemented/SPEC-046-2026-02-25-customer-detail-pages-v2.md), [CRM Linking Modals and Mobile Variants](implemented/2026-04-19-crm-linking-modals-and-mobile-variants.md), [CRM Detail Pages UX Enhancements](2026-04-06-crm-detail-pages-ux-enhancements.md)

---

## Revision History

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | 2026-08-27 | Initial spec: share the company linked-people section with the deal People tab. |

## TLDR

- The Deal detail **People** tab and the Company detail **People** tab render two different components with very different capabilities.
- Company uses `CompanyPeopleSection` — person cards with **Unlink**, a **Filters** toggle, a **sort** selector, server-side search, pagination, and an **Add person** dialog that creates the contact already linked.
- Deal uses `DealLinkedEntitiesTab` — a flat list of `next/link` rows with a single search box. **No unlink, no filters, no sort, no create.**
- Extract the company section's presentational + list-fetching shell into a reusable `LinkedPeopleSection`, then drive it from both pages through thin, host-specific wrappers.
- Net user-visible result: the two tabs behave identically. No new endpoint, no schema change, no contract break.

## Overview

`customers` renders "the people attached to this record" on two detail pages. The company page has received sustained investment (cards, roles, decision makers, unlink, filtering); the deal page has not. The gap is not a design decision — the two surfaces were built at different times against different components, and the deal side was never brought forward.

This spec closes the gap by **sharing one component** rather than porting features twice. That is the whole point: after this change there is a single implementation of "linked people list" and any future improvement lands on both pages at once.

## Problem Statement

On `/backend/customers/deals/{id}` → **People**:

1. **No unlink.** A person linked to a deal in error can only be removed through the "Manage links" dialog — the user must open a modal, find the row, deselect it, and confirm. There is no per-person action on the list itself.
2. **No filtering.** The tab has one text input. There is no Filters affordance and no sort control, so a deal with many contacts cannot be ordered by name or by recency.
3. **No inline create.** Adding a brand-new contact means leaving the deal for the People section, creating the person, navigating back, and linking. The company tab has done this in one dialog since SPEC-046.
4. **Sparse rows.** Deal rows show `label` + one subtitle line. The company page shows a `PersonCard` with job title, status, email, phone, lifecycle stage, temperature and source.

The underlying capability already exists and is proven on the company page. The deal page simply does not use it.

## Goals / Scope

- Deal People tab gains: per-person **Unlink**, **Filters** toggle, **sort** (name A–Z / Z–A / recently linked), server-side search, pagination, `PersonCard` rendering, and an **Add person** dialog.
- Company People tab keeps **exactly** its current behaviour, including roles, decision makers, starred contacts and both refresh events.
- One shared component backs both tabs.
- `GET /api/customers/deals/{id}/people` returns the fields `PersonCard` needs, **additively**.

## Non-Goals

- The Deal **Companies** tab. It keeps `DealLinkedEntitiesTab`, which stays in the codebase unchanged and is still exported.
- Roles (`RolesSection`) and the decision-makers footer on the deal tab. Those model a person↔company relationship; a person↔deal equivalent is separate work.
- A per-link `DELETE /api/customers/deals/{id}/people/{personId}` endpoint. See § API Contracts for why the existing update path is used instead.
- Marking a deal contact primary from the list. `isPrimary` stays read-only here.
- Any change to `packages/enterprise/`.

## Proposed Solution

### Architecture

Three components after the change, all under `packages/core/src/modules/customers/components/detail/`:

| Component | Role |
|-----------|------|
| `LinkedPeopleSection.tsx` (new) | The shared shell. Owns search, Filters toggle, sort, the `PersonCard` grid, pagination, the link dialog, the empty state and the starred-people preference. Host-agnostic. |
| `CompanyPeopleSection.tsx` (rewritten as a wrapper) | Company adapter. Supplies the company fetch/link/unlink handlers, `RolesSection` as a header slot, `DecisionMakersFooter` as a footer slot, and owns `CreatePersonDialog`. |
| `DealPeopleSection.tsx` (new) | Deal adapter. Supplies the deal fetch handler, the selection-based link/unlink handlers, and owns `CreatePersonDialog`. |

`LinkedPeopleSection` is parameterised, not branched — it contains no `if (isDeal)`. The host passes behaviour in:

```ts
type LinkedPeopleSectionProps<TDetails, TLinkSettings> = {
  scopeId: string                                  // scopes the starred-people preference
  loadPage: (p: { page; pageSize; sort; search }) => Promise<LinkedPeoplePage>
  onUnlink: (personId: string) => Promise<void>    // host owns messaging + locking
  linkAdapter: LinkEntityAdapter<TDetails, TLinkSettings>
  onLinkConfirm: (input: LinkEntityConfirmInput<TLinkSettings>) => Promise<void>
  header?: React.ReactNode                         // company: RolesSection
  renderFooter?: (ctx) => React.ReactNode          // company: DecisionMakersFooter
  refreshKey?: number                              // host-triggered reload
  // + labels, empty state, guarded-mutation runner
}
```

The generic parameters exist so the concrete `LinkEntityAdapter<PersonDetails, PersonLinkSettings>` produced by `createPersonLinkAdapter` stays assignable without widening to `unknown`.

**Messaging and locking stay with the host.** The shell never calls `flash` and never builds an optimistic-lock header; it awaits `onUnlink` / `onLinkConfirm` and reloads. This is what lets the two hosts use completely different write paths under one UI.

### Write paths

| | Company | Deal |
|---|---|---|
| Link | `POST /api/customers/people/{personId}/companies` per added id | `PUT /api/customers/deals` with the full `personIds` set |
| Unlink | `DELETE /api/customers/people/{personId}/companies/{companyId}` | `PUT /api/customers/deals` with `personIds` minus one |
| Concurrency | link rows are their own aggregate; the existing `optimistic-lock-exempt` annotation applies | the deal is the aggregate — `buildOptimisticLockHeader(deal.updatedAt)` + `surfaceRecordConflict` on 409 |

The deal side reuses the page's existing `handlePeopleAssociationsChange`, so unlink and inline-create inherit optimistic locking and the conflict bar with no new code.

### Create-and-link

`CreatePersonDialog` currently requires `companyId`, pre-fills `companyEntityId`, renders it as a locked field, and relies on the people create command's `syncLegacyPrimaryCompanyLink` to write the link row — one request, create + link.

Make `companyId`/`companyName` **optional**:

- **With** a company — unchanged: locked field, auto-link, company header line.
- **Without** — the normal editable `CompanySelectField`, no company header, a neutral success message. Creating from a deal may therefore also attach a company in the same form.

The people CRUD route has no `dealEntityId` equivalent, so the deal link is a **follow-up write** through the same optimistic-locked selection save. If the create response carries no id the dialog's host falls back to a plain list refresh rather than silently dropping the link.

## Data Models

No entity, migration or snapshot change. `CustomerDealPersonLink`, `CustomerPersonCompanyLink`, `CustomerEntity` and `CustomerPersonProfile` are read as they are today.

## API Contracts

### `GET /api/customers/deals/{id}/people` — additive response widening

Today each item is `{ id, label, subtitle, kind, linkedAt, isPrimary }`. `PersonCard` needs the same shape the company endpoint already returns, so add:

```
displayName, primaryEmail, primaryPhone, status, lifecycleStage,
jobTitle, department, createdAt, organizationId, temperature, source
```

- Every existing key is **retained** with unchanged semantics, so `DealLinkedEntitiesTab` and any third-party consumer keep working. This is an ADDITIVE-ONLY change under `BACKWARD_COMPATIBILITY.md` § API Routes.
- `jobTitle` / `department` come from `CustomerPersonProfile`, fetched in **one batched query** keyed by the linked person ids — not per row.
- `search` widens to match the new fields (email, phone, job title, department, status, lifecycle stage, source), mirroring the company endpoint.
- The `sort` enum is unchanged and already accepts `name-asc` / `name-desc` / `recent`.
- The `openApi` export is updated to match.

### `createPersonLinkAdapter` — additive option

Add `excludeLinkedDealId?: string`, mirroring the existing `excludeLinkedCompanyId`. It forwards the `excludeLinkedDealId` query parameter that `/api/customers/people` already supports, so people already on the deal are not offered again.

### No new endpoint

A per-link `DELETE .../people/{personId}` would need its own mutation-guard wiring, ACL, OpenAPI surface and undo semantics, and would bypass the deal's optimistic lock — two writers could unlink concurrently without a 409. Routing through `PUT /api/customers/deals` keeps one aggregate, one lock and one audit trail.

## Security & Tenant Isolation

- No new endpoint and no new ACL feature. `GET /api/customers/deals/{id}/people` keeps `requireFeatures: ['customers.deals.view']`; the write path keeps the deal update guard.
- The added profile read is scoped by the **deal's own** `tenantId` + `organizationId` (never caller-supplied) and goes through `findWithDecryption`, matching the sibling company route.
- The route's existence-oracle behaviour introduced in #5504 — a cross-organization read is denied as *not found*, not `403` — is preserved verbatim. The widened response must not reintroduce a distinguishable error path.
- The response adds no field the caller could not already read from `/api/customers/people` for the same person under the same feature grant.
- The starred-people preference is browser-local and keyed by record id (`om:starred-people:{scopeId}`); deal and company scopes cannot collide.

## Backward Compatibility

| Surface | Change | Class |
|---------|--------|-------|
| `GET /api/customers/deals/{id}/people` | keys added, none removed or retyped | ADDITIVE |
| `DealLinkedEntitiesTab` | untouched, still exported, still used by the Companies tab | NONE |
| `CompanyPeopleSection` props | unchanged public surface; `CompanyPersonSummary` becomes an alias of `LinkedPersonSummary` (same shape) | NONE |
| `CreatePersonDialog` | `companyId`/`companyName` required → optional; `CreatedPersonSummary.companyId`/`companyName` optional | ADDITIVE for existing callers, which always pass them |
| `createPersonLinkAdapter` | optional option added | ADDITIVE |
| `PersonCard` | imports its person type from the new module | NONE (structural type, re-exported) |

No deprecation protocol needed — nothing is removed or renamed.

## Risks & Impact Review

| # | Risk | Failure scenario | Severity | Mitigation | Residual |
|---|------|------------------|----------|------------|----------|
| 1 | Regression on the company tab during extraction | The shell drops one of the two refresh events (`customers.person_company_link.deleted`, `customers.person.company_assignment.detached` from #5114) and stale people linger for other viewers | High | Both events stay wired in the company wrapper and map onto `refreshKey`; the existing company test file must pass **unmodified** | Low |
| 2 | Deal unlink races a concurrent deal edit | Two users unlink different people; last write wins and one link returns | Medium | Unlink routes through the optimistic-locked deal update; a 409 raises the conflict bar | Low |
| 3 | N+1 on profile lookup | A deal with many contacts issues one profile query per person | Medium | Single batched `$in` query keyed by person ids, as the company route already does | Low |
| 4 | Created person is not linked to the deal | Create succeeds, the follow-up selection save fails; a stray person exists | Medium | The follow-up write reports its own failure through the existing flash/conflict path; the person remains valid and can be linked manually | Low |
| 5 | Response widening breaks a consumer | A third party reads the deal people list positionally | Low | Purely additive; existing keys retained | Low |

## Rollout / Rollback

- Single PR, no migration, no feature flag, no data backfill. The change is deploy-and-done.
- Rollback is a plain revert: no schema to unwind and no persisted state written by this change other than the browser-local starred-people key, which is already versioned and self-healing.
- No coordination with `create-app` template sync — nothing under `apps/mercato/src/app/**` or `.env.example` is touched.

## Testing

Required in the same PR as the implementation.

### Unit

`components/detail/__tests__/DealPeopleSection.test.tsx` (new):

1. loads from `/api/customers/deals/{id}/people` with `page`/`pageSize`/`sort`
2. unlink saves the remaining selection
3. search and sort changes are forwarded to the endpoint
4. Filters toggle hides and restores the controls
5. empty state offers both link and add actions
6. the add-person dialog opens without a company context
7. a created person is appended to the deal selection

`components/detail/__tests__/CompanyPeopleSection.test.tsx` (existing): **must pass unmodified** — this is the regression gate for the extraction.

`backend/customers/deals/[id]/__tests__/page.test.tsx`: updated to mock the new section and to keep asserting that a people change patches the deal inline without a full detail reload.

### API

`api/deals/[id]/__tests__/`: the widened payload includes the new keys; profile fields resolve in one batched query; the cross-organization request still fails as **not found** (existence-oracle regression from #5504); `search` matches on an added field.

### Integration / UI

Per `.ai/qa/AGENTS.md`, a Playwright case under `.ai/qa/tests/` covering the deal People tab: link an existing person, filter/sort the list, unlink from the card, and create-and-link a new contact — self-contained fixtures, cleaned up in teardown. Screenshots attached to the PR since this is a customer-facing UI change (`needs-qa`).

### Gate

`yarn generate`, `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build:app`.

## Implementation Breakdown

1. **Extract the shell.** Add `LinkedPeopleSection.tsx`; rewrite `CompanyPeopleSection.tsx` as a wrapper over it. Company test file must pass untouched.
2. **Widen the deal people endpoint.** Additive fields, batched profile query, widened search, updated `openApi`, API tests.
3. **Add the deal wrapper.** `DealPeopleSection.tsx` + `excludeLinkedDealId` on the person adapter; wire the deal detail page's People tab; unit tests.
4. **Inline create.** Make `CreatePersonDialog`'s company context optional; wire the add-person action and the link dialog's add-new slot on the deal side; tests.
5. **Locales + integration.** New keys in `packages/core/src/modules/customers/i18n/`, Playwright case, screenshots.

## Final Compliance Report

| Requirement | Status |
|-------------|--------|
| No cross-module ORM relationship introduced | ✅ reads existing entities only |
| Tenant/organization scoping on every added read | ✅ scoped by the deal's own ids |
| `findWithDecryption` used for the added profile read | ✅ |
| No hardcoded user-facing strings | ✅ all copy routed through `translate(...)` with locale entries |
| No hardcoded status colors / arbitrary values | ✅ reuses `PersonCard`, already DS-compliant |
| Optimistic locking on the new write path | ✅ deal update header + `surfaceRecordConflict` |
| `BACKWARD_COMPATIBILITY.md` contracts preserved | ✅ additive only |
| No `packages/enterprise/` change | ✅ |
| Tests ship with the implementation | ✅ unit + API + integration |

## Changelog

| Date | Change |
|------|--------|
| 2026-08-27 | Initial specification. |
