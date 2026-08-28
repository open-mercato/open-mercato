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
| 1.1 | 2026-08-27 | Spec review: the deal write path is now in scope. `syncDealPeople` becomes set-diffing **and** stamps the deal's `updated_at`, because neither change alone fixes both the lost-update race and the `linkedAt` reset. Corrected the integration-test location, the validation gate, the `CreatedPersonSummary` BC row, the overstated Goals list; added the deal refresh-event decision and the sibling-tab asymmetry. |
| 1.2 | 2026-08-27 | Recorded the blast radius of the `syncDealPeople` change: five call sites across three commands, both execute and undo, all inside an existing flush phase. |
| 1.3 | 2026-08-28 | Spec review round 2: set-diffing collides with the `is_primary` partial unique index that delete-and-recreate currently makes unreachable, so the set-diff must clear displaced flags and flush first; the lock stamp is keyed to membership **or** the primary flag and stated as a property of the whole deal write path rather than the people half; corrected the `CustomerDeal.updatedAt` citation. |
| 1.4 | 2026-08-28 | Round-3 inline review: the `is_primary` rule was incomplete (covered a displaced row that stays, not one that is removed — inserts commit before deletes); named the `updated_at` touch mechanism and undo-path semantics; the write-path fix now ships as its own issue and PR; enumerated the real prop surface and flagged the extraction as the risky step. |

## TLDR

- The Deal detail **People** tab and the Company detail **People** tab render different components with different capabilities.
- Company uses `CompanyPeopleSection` — person cards with **Unlink**, a **Filters** toggle, a **sort** selector and an **Add person** dialog that creates the contact already linked.
- Deal uses `DealLinkedEntitiesTab` — link rows with a single search box. It already pages and searches server-side; what it lacks is **unlink, Filters, sort, card rendering and inline create**.
- Extract the company section's shell into a reusable `LinkedPeopleSection` and drive both tabs from it through thin, host-specific wrappers.
- The deal write path (`syncDealPeople`) needs two corrections before the new UI is safe: it must **diff the link set** instead of deleting and recreating every row, and it must **stamp the deal's `updated_at`** so the optimistic lock this design relies on actually engages.
- No schema change, no new endpoint, no contract break.

## Overview

`customers` renders "the people attached to this record" on two detail pages. The company page has received sustained investment (cards, roles, decision makers, unlink, filtering); the deal page has not. The gap is not a design decision — the two surfaces were built at different times against different components, and the deal side was never brought forward.

This spec closes the gap by **sharing one component** rather than porting features twice. After this change there is a single implementation of "linked people list", and any future improvement lands on both pages at once.

Making the deal list interactive also promotes two latent defects in the deal write path into user-visible ones, so they are fixed here rather than left for the implementation to discover. See § Deal Write Path.

## Problem Statement

On `/backend/customers/deals/{id}` → **People**:

1. **No unlink.** A person linked in error can only be removed through the "Manage links" dialog — open a modal, find the row, deselect, confirm. There is no per-person action on the list itself.
2. **No filtering or sorting.** The tab has one text input. There is no Filters affordance and no sort control, so a deal with many contacts cannot be ordered by name or by recency.
3. **No inline create.** Adding a brand-new contact means leaving the deal for the People section, creating the person, navigating back, and linking. The company tab has done this in one dialog since SPEC-046.
4. **Sparse rows.** Deal rows show `label` plus one subtitle line. The company page shows a `PersonCard` with job title, status, email, phone, lifecycle stage, temperature and source.

Paging and server-side search are **not** missing — `loadLinkedPeoplePage` (`backend/customers/deals/[id]/hooks/useDealAssociations.ts:207-232`) already issues a paged, `sort`- and `search`-aware request. An implementer should reuse that behaviour, not rebuild it.

## Goals / Scope

- Deal People tab gains: per-person **Unlink**, **Filters** toggle, **sort** control (name A–Z / Z–A / recently linked), `PersonCard` rendering, and an **Add person** dialog.
- Company People tab keeps **exactly** its current behaviour, including roles, decision makers, starred contacts and both refresh events.
- One shared component backs both tabs.
- `GET /api/customers/deals/{id}/people` returns the fields `PersonCard` needs, **additively**.
- `syncDealPeople` preserves `linkedAt` for untouched links, orders the `is_primary` reconciliation so the partial unique index is never violated, and advances the deal's lock token whenever link membership or a primary flag changes.

## Non-Goals

- The Deal **Companies** tab. It keeps `DealLinkedEntitiesTab`, which stays in the codebase unchanged and is still exported. See Risk 6 for the asymmetry this leaves behind.
- Roles (`RolesSection`) and the decision-makers footer on the deal tab. Those model a person↔company relationship; a person↔deal equivalent is separate work.
- A per-link `DELETE /api/customers/deals/{id}/people/{personId}` endpoint. See § API Contracts.
- Marking a deal contact primary from the list. `isPrimary` stays read-only here.
- Live cross-session refresh on the deal tab. See Risk 5.
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

The block above is the shape, not the full surface. `CompanyPeopleSection.tsx` is 843 lines and additionally threads roles, decision makers, the starred-people preference, both refresh events, the link dialog's add-new slot and the guarded-mutation runner. `header` + `renderFooter` carry the first two; the rest arrive as explicit props (`linkDialogOpen` / `onLinkDialogOpenChange` for the add-new slot to close its host, `runGuardedMutation`, `onLoadingChange`, `refreshKey`, the label set and the empty state). **Step 2 is the risky step of this spec** — everything else is additive, while the extraction rewrites a large working component. The regression gate is that `CompanyPeopleSection.test.tsx` must pass unmodified.

The generic parameters exist so the concrete `LinkEntityAdapter<PersonDetails, PersonLinkSettings>` produced by `createPersonLinkAdapter` stays assignable without widening to `unknown`.

**Messaging and locking stay with the host.** The shell never calls `flash` and never builds an optimistic-lock header; it awaits `onUnlink` / `onLinkConfirm` and reloads. This is what lets the two hosts use completely different write paths under one UI.

### Deal Write Path

Both corrections below are in `syncDealPeople` (`commands/deals.ts:385-440`).

**Delivery.** They ship as their **own issue and PR**, ahead of and separate from the UI work, rather than as phase 1 of it. They are a live concurrency and data-loss bug on an aggregate with undo semantics — unrelated to UI parity, a different blast radius, and independently revertable. Bundling them would mean one PR that cannot be reverted in halves. The UI work depends on them landing first but does not contain them.

#### 1. Set-diff the links instead of delete-and-recreate

Today the whole-set branch runs `await em.nativeDelete(CustomerDealPersonLink, { deal })` and then recreates a row for every id in the payload. `CustomerDealPersonLink.createdAt` is `onCreate` (`data/entities.ts:460`) and the endpoint serialises it as `linkedAt` (`api/deals/[id]/people/route.ts:130`), so **every** people write resets the linked date for **every** remaining person.

That is invisible today — `DealLinkedEntitiesTab` renders neither a linked date nor a recency sort. This spec makes both visible, so the reset would become a user-facing data-loss bug: unlinking one contact would re-date the other eleven and collapse "recently linked" into an arbitrary label tie-break.

Change the whole-set branch to compute the delta against the existing rows: delete only links whose person is absent from the payload, insert only links whose person is new, and leave untouched rows alone.

The `400` primary-must-be-linked guard is unchanged, but **`isPrimary` reconciliation cannot stay as it is**. `customer_deal_people` carries a partial unique *index* — `create unique index "customer_deal_people_primary_uq" on "customer_deal_people" ("deal_id") where "is_primary"` (`data/entities.ts:442-446`). A unique index in PostgreSQL is immediate and cannot be deferred to commit time, so two rows for one deal holding `is_primary` simultaneously is an error even inside a transaction that would end consistent.

Today's delete-everything-first shape makes that state unreachable: every row is gone before any insert happens, so at most one row is ever created with the flag set. Set-diffing removes exactly that protection and makes write ordering load-bearing. There are **two** distinct ways to collide, and they need different handling because the unit of work commits inserts before deletes:

- **The displaced row stays.** Ada linked and primary; payload `[Ada, Bob]` with primary Bob. Nothing is deleted — Bob is *inserted* with `is_primary = true` while Ada is only *updated* to `false`. If the insert lands first, the index rejects it.
- **The displaced row is removed.** Ada linked and primary; payload `[Bob]` with primary Bob. Ada's row is *deleted* and Bob's is *inserted*. Because inserts commit before deletes, the insert still hits the index while Ada's row is present.

So clearing the flag before setting the new one is necessary but **not sufficient** — it only covers the first case. The rule is: **every removal and every flag clear must have reached the database before any insert carrying `is_primary = true`.** Two ways to satisfy it, either acceptable:

- flush removals *and* flag clears before inserting, or
- keep `em.nativeDelete` for the removed links — it issues SQL immediately rather than joining the unit of work, so it is ordered correctly by construction — and flush only the flag clears.

Either way this mirrors what the `personIds === undefined` branch already does for exactly this reason (`commands/deals.ts:404-410`, where a mid-function `em.flush()` exists for no other purpose).

#### 2. Stamp the deal's `updated_at` when link membership changes

The optimistic-lock token for a deal is `customer_deals.updated_at`, read by the reader the CRUD factory auto-registers (`di.ts:55-66` hand-wires only the company/person readers, because those share a polymorphic table). `CustomerDeal.updatedAt` is declared `onUpdate`-only (`data/entities.ts:367`), so it is stamped only when the deal entity itself enters the change set.

A `{ id, personIds }` payload never does that: `updateDealCommand`'s scalar phase assigns only fields the payload carries, and `syncDealPeople` touches link rows exclusively. The lock token therefore does not move on a people-only write.

Set-diffing alone does **not** close this. Two users open a deal holding `{Ada, Bob, Cid}` at version `T`. A unlinks Ada and sends `{Bob, Cid}`; the write succeeds and `updated_at` is still `T`. B unlinks Bob and sends `{Ada, Cid}` — computed from B's stale view. B's header still reads `T`, still matches, and the diff against the current `{Bob, Cid}` **re-adds Ada** and removes Bob. Neither user is told. Set-diffing changes which rows move; it does not stop the stale payload from winning.

So `syncDealPeople` must also mark the deal dirty whenever it actually changes the links — **membership or the primary flag**. Keying the rule to membership alone would leave the adjacent hole open: moving the primary between two already-linked people mutates deal state without changing the set, so two concurrent primary changes would both succeed and the later one would silently win. The same applies to the `personIds === undefined` branch, which mutates link rows and never touches the deal today. A write that changes neither membership nor the primary must **not** bump the token, or every idle save would invalidate other sessions.

Nothing in the UI sends `primaryPersonEntityId` today — it is API-only, and this spec keeps `isPrimary` read-only on the new tab — so this costs nothing now and makes the guarantee hold for whatever sets the primary next.

**Mechanism.** MikroORM will not add the deal to the change set for a no-op assignment, so the stamp has to be an explicit touch: assign `deal.updatedAt = new Date()`. That assignment is what dirties the entity; the `onUpdate` hook then supplies the committed value, so the two do not fight — the assignment is the trigger, not the source of truth. This is the established pattern in this module: `commands/people.ts:997-999` does exactly this when only profile fields changed and the parent entity would otherwise stay clean (see also `commands/shared.ts:204`, `commands/pipelines.ts:90`).

**Undo paths.** A restore must **stamp a new token, not replay the snapshot's**. Reinstating the recorded `updated_at` would hand the undone deal a version other sessions may already hold, so a stale writer's header would match a record that has since changed underneath it — reintroducing the lost update this section exists to remove. The link rows are restored to their snapshot; the lock token moves forward.

The two corrections do not have equal status on the sibling `syncDealCompanies`, which shares the delete-and-recreate shape.

- **The set-diff is deferrable.** Nothing renders a company link date and the Companies tab keeps `DealLinkedEntitiesTab`, so no user-visible value depends on those rows surviving. If it is deferred, say so in the implementation PR rather than leaving the asymmetry silent.
- **The `updated_at` stamp is not.** A companies-only `{ id, companyIds }` write moves the lock token exactly as little as a people-only write does, so deferring it would leave the lost-update race open on the adjacent field of the same aggregate — with nothing to explain to a later reader why one path is locked and the other is not. State the stamp as a property of the **deal write path**: any change to link membership or a primary flag, people or companies, advances the token.

#### Blast radius of the change

`syncDealPeople` has five call sites across three commands, in both directions: `createDealCommand` execute and undo, `updateDealCommand` execute and undo, and `deleteDealCommand`'s undo restore. All five run inside a `withAtomicFlush` phase list (or the `runCrudCommandWrite` phases on the update path), so the set-diff inherits the existing flush boundary and introduces no new mutate→read interleave.

Two of them deserve explicit thought during implementation:

- **Undo / restore paths** replay a snapshot rather than a user edit. Set-diffing reaches the same final membership as delete-and-recreate, so the restored set is unchanged; the only difference is that rows which happen to survive keep their `created_at`. That is the desired behaviour — an undo should not re-date links it did not touch.
- **The create path** runs against a deal with no existing links, so the diff degenerates to all-inserts and the `updated_at` stamp is irrelevant there.

The command tests below must therefore cover the update path directly and assert that create and the undo directions still produce the exact sets they produce today.

#### Alternative considered — delta payload

`addPersonIds` / `removePersonIds` would let two disjoint unlinks commute without conflicting at all, which is strictly better UX than a 409. It is deferred because it widens the deal update contract for every existing caller, and because a 409 routed into the existing conflict bar is this repository's established concurrent-edit story. Worth revisiting if deal-contact contention turns out to be common.

### Create-and-link

`CreatePersonDialog` currently requires `companyId`, pre-fills `companyEntityId`, renders it as a locked field, and relies on the people create command's `syncLegacyPrimaryCompanyLink` to write the link row — one request, create + link.

Make `companyId`/`companyName` **optional**:

- **With** a company — unchanged: locked field, auto-link, company header line.
- **Without** — the normal editable `CompanySelectField`, no company header, a neutral success message. Creating from a deal may therefore also attach a company in the same form.

The people CRUD route has no `dealEntityId` equivalent, so the deal link is a **follow-up write** through the same optimistic-locked selection save. If the create response carries no id the host falls back to a plain list refresh rather than silently dropping the link.

`CreatedPersonSummary` keeps emitting `companyId` and `companyName` — widened to `string | null`, always present — so no `onPersonCreated` consumer loses a guarantee. See § Backward Compatibility.

## Data Models

No entity, migration or snapshot change. `CustomerDealPersonLink`, `CustomerPersonCompanyLink`, `CustomerEntity` and `CustomerPersonProfile` are read as they are today.

The **write semantics** of `customer_deal_people` change: rows now survive an unrelated people update instead of being recreated, so `created_at` becomes a durable "linked at" value rather than a per-write timestamp. No backfill — existing rows keep whatever date the last write gave them, and the value only becomes meaningful going forward. Say so in the PR body so the first post-deploy "recently linked" ordering is not read as a bug.

## API Contracts

### `GET /api/customers/deals/{id}/people` — additive response widening

Today each item is `{ id, label, subtitle, kind, linkedAt, isPrimary }`. `PersonCard` needs the same shape the company endpoint already returns, so add:

```
displayName, primaryEmail, primaryPhone, status, lifecycleStage,
jobTitle, department, createdAt, organizationId, temperature, source
```

- Every existing key is **retained** with unchanged semantics, so `DealLinkedEntitiesTab` and any third-party consumer keep working. ADDITIVE-ONLY under `BACKWARD_COMPATIBILITY.md` § API Routes.
- `jobTitle` / `department` come from `CustomerPersonProfile`, fetched in **one batched query** keyed by the linked person ids — not per row.
- `search` widens to match the new fields (email, phone, job title, department, status, lifecycle stage, source), mirroring the company endpoint.
- The `sort` enum is unchanged and already accepts `name-asc` / `name-desc` / `recent`.
- The `openApi` export is updated to match.

The handler materialises every link row and then filters, sorts and paginates in memory (`api/deals/[id]/people/route.ts:113-144`), so the batch is keyed by *all* linked person ids, not the page's twenty. That is deliberate and fine at the expected scale — a deal carries tens of contacts, not thousands. If that assumption ever breaks, the in-memory pipeline is the thing to fix first, not the batch.

### `createPersonLinkAdapter` — additive option

Add `excludeLinkedDealId?: string`, mirroring the existing `excludeLinkedCompanyId`. It forwards the `excludeLinkedDealId` query parameter that `/api/customers/people` already supports (`api/people/route.ts:67`), so people already on the deal are not offered again.

### No new endpoint

A per-link `DELETE .../people/{personId}` would need its own mutation-guard wiring, ACL, OpenAPI surface and undo semantics. Routing through `PUT /api/customers/deals` keeps one aggregate, one audit trail and one command with undo support.

Concurrency is **not** part of this rationale. Until the `updated_at` stamp in § Deal Write Path lands, the existing whole-set path offers no more protection than a per-link `DELETE` would; with it, both shapes would be equally lockable. The endpoint decision rests on surface area and undo, not on safety.

## Security & Tenant Isolation

- No new endpoint and no new ACL feature. `GET /api/customers/deals/{id}/people` keeps `requireFeatures: ['customers.deals.view']`; the write path keeps the deal update guard.
- The added profile read is scoped by the **deal's own** `tenantId` + `organizationId` (never caller-supplied) and goes through `findWithDecryption`, matching the sibling company route.
- The route's existence-oracle behaviour from #5504 — a cross-organization read is denied as *not found*, not `403` — is preserved verbatim. The widened response must not reintroduce a distinguishable error path.
- The response adds no field the caller could not already read from `/api/customers/people` for the same person under the same feature grant.
- Set-diffing keeps the existing `requireCustomerEntity` + `ensureSameScope` check on every **newly added** person. Untouched links were scope-checked when they were created, so skipping them re-checks nothing that was ever unchecked.
- The starred-people preference is browser-local and keyed by record id (`om:starred-people:{scopeId}`); deal and company scopes cannot collide.

## Backward Compatibility

| Surface | Change | Class |
|---------|--------|-------|
| `GET /api/customers/deals/{id}/people` | keys added, none removed or retyped | ADDITIVE |
| `DealLinkedEntitiesTab` | untouched, still exported, still used by the Companies tab | NONE |
| `CompanyPeopleSection` props | unchanged public surface; `CompanyPersonSummary` becomes an alias of `LinkedPersonSummary` (already shape-compatible — everything but `id`/`displayName` is optional today) | NONE |
| `CreatePersonDialog` **props** | `companyId`/`companyName` required → optional | ADDITIVE — every existing call site keeps compiling |
| `CreatedPersonSummary` **payload** | `companyId`/`companyName` widened `string` → `string \| null`, still always emitted | ADDITIVE — a consumer reading them still gets a property; only a consumer assigning to a non-nullable `string` needs a null check. Making them *optional* would have been a break and is explicitly rejected. |
| `createPersonLinkAdapter` | optional option added | ADDITIVE |
| `PersonCard` | imports its person type from the new module | NONE (structural type, re-exported) |
| `syncDealPeople` | link rows survive an unrelated update; deal `updated_at` advances on membership change | BEHAVIOURAL FIX — no signature or payload change. Callers that relied on `linkedAt` being rewritten do not exist; a caller that ignored the lock now receives the 409 it should always have received. |

No deprecation protocol needed — nothing is removed or renamed.

## Risks & Impact Review

| # | Risk | Failure scenario | Severity | Mitigation | Residual |
|---|------|------------------|----------|------------|----------|
| 1 | Regression on the company tab during extraction | The shell drops one of the two refresh events (`customers.person_company_link.deleted`, `customers.person.company_assignment.detached` from #5114) and stale people linger for other viewers | High | Both events stay wired in the company wrapper and map onto `refreshKey`; the existing company test file must pass **unmodified** | Low |
| 2 | Lost update on concurrent unlink | Two users unlink different contacts from the same deal; the second whole-set payload is computed from a stale view and reinstates the first user's removal, with no 409 and no error. Moving unlink onto the card turns this from an edge case into an ordinary one — a modal flow made writes rare, a one-click action makes them frequent | **High** | `syncDealPeople` stamps the deal's `updated_at` on membership change, so the second writer's stale lock header fails the version check and raises the existing conflict bar. Pinned by an interleaved-write regression test, and the resulting UX (click Unlink → conflict bar → reload) is an explicit step in the QA script rather than something QA discovers | Low |
| 3 | `linkedAt` reset across the whole deal | A single unlink re-dates every surviving link, breaking the linked date on the card and the "recently linked" sort | **High** | Set-diffing `syncDealPeople`; regression test asserts untouched rows keep their `created_at` | Low |
| 4 | N+1 on profile lookup | A deal with many contacts issues one profile query per person | Medium | Single batched `$in` query keyed by person ids, as the company route already does | Low |
| 5 | Deal tab does not refresh live | Another session changes the deal's people; the company tab would refresh from a broadcast event, the deal tab will not, so a viewer can act on a stale list until they reload | Medium | Accepted for this change. `customers.deal.updated` exists but carries no `clientBroadcast`, and adding it would broadcast every deal write to every client — a blast radius that deserves its own change. The optimistic lock from Risk 2 makes a stale action fail loudly with a 409 rather than silently, which is the property that actually matters | Medium — documented gap, follow-up candidate |
| 6 | Sibling-tab asymmetry | Deal People ships with cards, filters, sort and unlink while the adjacent Deal Companies tab stays a flat list; users read the difference as breakage | Low | Accepted trade-off, recorded here rather than left implicit. `LinkedPeopleSection` is deliberately host-parameterised so a companies equivalent is a wrapper, not a rewrite; no follow-up is committed in this spec | Low |
| 7 | Created person is not linked to the deal | Create succeeds, the follow-up selection save fails; a stray person exists | Medium | The follow-up write reports its own failure through the existing flash/conflict path; the person remains valid and can be linked manually | Low |
| 8 | Response widening breaks a consumer | A third party reads the deal people list positionally | Low | Purely additive; existing keys retained | Low |

## Rollout / Rollback

- Single PR, no migration, no feature flag, no data backfill. Deploy-and-done.
- Rollback is a plain revert. No schema to unwind. The only persisted effect is that link rows created while the fix was live keep their genuine `created_at` — reverting restores the delete-and-recreate behaviour and those dates start being overwritten again, which is the pre-change status quo, not corruption.
- Browser-local starred-people keys are already versioned and self-healing.
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

`components/detail/__tests__/CompanyPeopleSection.test.tsx` (existing): **must pass unmodified** — the regression gate for the extraction.

`backend/customers/deals/[id]/__tests__/page.test.tsx`: updated to mock the new section and to keep asserting that a people change patches the deal inline without a full detail reload.

### Command

`commands/__tests__/` — the two write-path fixes, both currently uncovered:

- **`linkedAt` preservation**: link three people, then update with one removed; the two survivors keep their original `created_at` and only the removed row disappears.
- **lock-token advance**: a `{ id, personIds }` update that changes membership advances `customer_deals.updated_at`, and so does a primary-only change; an update that alters neither membership nor the primary does **not**. The same holds for a companies-only update.
- **interleaved writes**: two updates from the same base version, changing disjoint members — the second is rejected with the optimistic-lock conflict rather than silently reinstating the first one's removal.
- `isPrimary` reconciliation across a set-diffing update, explicitly covering **moving the primary to a newly added person in the same write** — the case the partial unique index rejects if the insert lands before the displaced flag is cleared and flushed. The `400` primary-must-be-linked guard still holds.
- create and both undo directions still produce the exact link sets they produce today (see § Blast radius).

### API

`api/deals/[id]/people/__tests__/` (new directory — the existing `api/deals/[id]/__tests__/route.existenceOracle.test.ts` covers the deal *detail* route, not this one):

- the widened payload includes the new keys
- profile fields resolve in one batched query
- a cross-organization request still fails as **not found** (re-proving the #5504 existence-oracle behaviour on this handler)
- `search` matches on an added field

### Integration / UI

Per `.ai/qa/AGENTS.md`, executable specs live in the module's own folder, **not** in `.ai/qa/tests/` (that directory is Playwright config only and is not discovered by `yarn test:integration`). Add `packages/core/src/modules/customers/__integration__/TC-CRM-088.spec.ts` — id verified free on `develop`, to be re-checked against the implementation branch — covering: link an existing person, filter and sort the list, unlink from the card, and create-and-link a new contact. Self-contained fixtures, cleaned up in teardown.

Screenshots attached to the PR since this is a customer-facing UI change (`needs-qa`).

### Gate

The configured CI-mirroring gate (`.ai/agentic.config.json` → `validation.commands`), in order:

```
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
```

The second `yarn build:packages` rebuilds against what `yarn generate` produced. `yarn i18n:check-sync` / `yarn i18n:check-usage` are load-bearing here because step 6 below adds locale keys.

## Implementation Breakdown

1. **Fix the deal write path — separate issue and PR.** Set-diffing `syncDealPeople` with the insert-ordering rule above, plus the `updated_at` touch on membership or primary-flag change; decide and state whether `syncDealCompanies` comes along. Command tests. Lands before the UI work and is revertable on its own; steps 2–6 below are the UI PR and depend on it.
2. **Extract the shell.** Add `LinkedPeopleSection.tsx`; rewrite `CompanyPeopleSection.tsx` as a wrapper over it. Company test file must pass untouched.
3. **Widen the deal people endpoint.** Additive fields, batched profile query, widened search, updated `openApi`, API tests.
4. **Add the deal wrapper.** `DealPeopleSection.tsx` + `excludeLinkedDealId` on the person adapter; wire the deal detail page's People tab; unit tests.
5. **Inline create.** Make `CreatePersonDialog`'s company context optional while keeping `CreatedPersonSummary` fields always emitted; wire the add-person action and the link dialog's add-new slot on the deal side; tests.
6. **Locales + integration.** New keys in `packages/core/src/modules/customers/i18n/`, the Playwright case, screenshots.

## Final Compliance Report

| Requirement | Status |
|-------------|--------|
| No cross-module ORM relationship introduced | ✅ reads existing entities only |
| Tenant/organization scoping on every added read | ✅ scoped by the deal's own ids |
| `findWithDecryption` used for the added profile read | ✅ |
| Scope check retained on every newly linked person | ✅ `requireCustomerEntity` + `ensureSameScope` on inserts |
| No hardcoded user-facing strings | ✅ all copy routed through `translate(...)` with locale entries |
| No hardcoded status colors / arbitrary values | ✅ reuses `PersonCard`, already DS-compliant |
| Optimistic locking on the deal write path | ✅ token advances on any link membership or primary-flag change, people and companies alike; pinned by an interleaved-write test |
| `withAtomicFlush` discipline preserved in `syncDealPeople` | ✅ the set-diff runs inside the existing flush phases; the one added flush is the `is_primary` ordering barrier the partial unique index requires |
| `BACKWARD_COMPATIBILITY.md` contracts preserved | ✅ additive, plus one behavioural fix that removes a silent lost update |
| No `packages/enterprise/` change | ✅ |
| Tests ship with the implementation | ✅ unit + command + API + integration |

## Changelog

| Date | Change |
|------|--------|
| 2026-08-27 | Initial specification. |
| 2026-08-27 | Spec review round 1: added § Deal Write Path (set-diffing `syncDealPeople` + `updated_at` stamp) after review showed the stated optimistic-lock guarantee did not hold and that every people write reset `linkedAt`; rewrote the no-new-endpoint rationale and Risks 2–3; corrected the integration-test path, the validation gate and the `CreatedPersonSummary` BC row; trimmed the Goals list; documented the deal refresh-event decision and the sibling-tab asymmetry. |
| 2026-08-28 | Spec review round 2: added the `is_primary` ordering requirement (partial unique index is immediate, and set-diffing removes the delete-everything-first protection); widened the lock-stamp rule to cover primary-flag changes and both link tables; split the `syncDealCompanies` note into its deferrable and non-deferrable halves; fixed the `data/entities.ts` line citation. |
| 2026-08-28 | Round-3 inline review: corrected the `is_primary` rule to cover a removed displaced row (inserts commit before deletes), named the `updated_at` touch mechanism and the undo-path semantics, split the write-path fix into its own issue and PR, and enumerated the real `LinkedPeopleSection` prop surface. |
