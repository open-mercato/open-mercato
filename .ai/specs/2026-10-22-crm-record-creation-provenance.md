# CRM record creation provenance

## 📝 TLDR

Add immutable creator attribution to people, companies and deals for issue #7700. The server records the authenticated human actor when known; existing/imported records with no evidenced creator remain null. This additive metadata capability is independent of every other [Phase 1 slice](2026-10-22-crm-field-model-phase-1.md).

## Overview and Problem Statement

`owner_user_id` identifies current responsibility, not who created the record. Reassignment must not erase provenance. Baseline was `main` `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`, reviewed 2026-10-22; implementation re-verified every reference below against `main` `d5490b61e684a14a1cf4c4607d282e9ab1b1f0fa` on 2026-11-27. Existing command audit (`ActionLog`) remains the detailed action history; this field is a convenient stable attribution, not a substitute log.

## Resolved assumptions (autonomous defaults)

Existing rows receive null. No caller can assert another user's creator ID. Never substitute owner, importer, earliest available audit entry, API-key creator or migration operator. These defaults are reversible additions and do not invent historical facts.

### Trusted creator predicate

All three create commands resolve the creator through one customers-owned helper, `resolveCreatorUserId(ctx, { tenantId })` in `commands/shared.ts` (`tenantId` is the created record's tenant), evaluated against the `CommandRuntimeContext` (`packages/shared/src/lib/commands/types.ts`: `auth`, `systemActor`, `runAs`) of the original `execute` only. It is an ordered rule; the first matching step wins:

1. `ctx.systemActor === true` → `null` (seeds, system jobs).
2. `ctx.runAs` present → `null` (agent run: the actor is the agent principal; the human is only `onBehalfOfUserId`, which stays in the action log).
3. `ctx.auth` missing → `null` (sync_excel import, CLI, workers).
4. The context is key-derived → `null`: `ctx.auth.isApiKey === true`, a non-empty `ctx.auth.keyId`, or a `sub` starting with `api_key:` (every HTTP API key, including MCP/AI-chat session-bound keys and regular keys whose `auth.userId` is only the key's creator, plus the AI runner's `api_key:` envelope).
5. The actor's home tenant differs from the created record's tenant → `null`. The home tenant is `ctx.auth.actorTenantId` when that key is present (`'actorTenantId' in ctx.auth`, even when its value is `null`) (set only by `applySuperAdminScope` in `shared/src/lib/auth/server.ts` when a super admin switches tenant, while `auth.tenantId` is overwritten with the selected tenant), otherwise `ctx.auth.tenantId`; a missing home tenant also yields `null`. A super admin who switched tenant through the HTTP session therefore never stores a foreign tenant's user reference.
6. `ctx.auth.sub` is not a UUID → `null`.
7. Otherwise → `ctx.auth.sub`.

`ctx.auth.userId` is never read. Organization is deliberately not part of the rule: staff legitimately create records in any organization their grants allow, so a same-tenant creator from another organization is recorded; name resolution follows the existing author-label contract described under UI (see Risks). When a context reaches step 6 (authenticated, not key-derived, same home tenant) and its `sub` is not a UUID, the helper logs one low-cardinality warning `customers.creator_unresolved` through the module logger, without the `sub` value or other PII, so silent attribution loss is observable; it still returns `null`. Steps 1–5 never warn. The helper never throws and never blocks the write: a context without a trusted human yields null and creation proceeds unchanged. It deliberately does not honour the super-admin explicit-author override in `normalizeAuthorUserId`, because no caller may assert a creator. Session-bound HTTP keys are recorded as null because `AuthContext` exposes no public marker that distinguishes them from regular keys (the classification is private to `shared/src/lib/auth/server.ts`). The in-process AI chat operation runner (`ai-assistant/.../lib/ai-api-operation-runner.ts` `buildAuthEnvelope`) presents the signed-in staff user as a normal session (`sub` = user UUID, no `isApiKey`); a create executed through it after that user's mutation approval therefore records that user, matching the action-log actor. Its envelope does not forward `actorTenantId`, so step 5 cannot detect a tenant-switched super admin on that path. No customers AI tool creates people, companies or deals today, so this path is latent; before any customers create tool uses the runner, the runner must forward `actorTenantId` (or the predicate must return null for its super-admin principals), with a predicate test. Do not copy the existing todo-link validators (`data/validators.ts`, `createdByUserId` accepted from the body): this field is never read from input.

## 📝 Proposed Solution and Architecture

Add `created_by_user_id` to `CustomerEntity` (people and companies share `customer_entities`) and `CustomerDeal` in customers, using the module's existing `@mikro-orm/decorators/legacy` property style. Record the ID only: no ORM relation and no SQL foreign key to `users`, so deleting a user never fails or cascades. Public create/update validators do not declare the field; Zod's default object parsing strips an unknown `createdByUserId`/`created_by_user_id` key, so forged values are ignored without rejecting existing clients, including GET→PUT round-trips that echo the field back. Route `mapInput` and update commands never pass or assign it. CRUD event IDs and payloads are unchanged.

### Create, undo and redo invariants

The value is fixed by the original create and is copied verbatim everywhere a row is rebuilt; it is never re-derived from the undoing/redoing actor.

- `customers.people.create` (`commands/people.ts`, shared builder `buildPersonGraph` used by both `execute` and redo), `customers.companies.create` (`commands/companies.ts`) and `customers.deals.create` (`commands/deals.ts`) set it from `resolveCreatorUserId` in `execute` only. Shared builders take `createdByUserId: string | null` as an explicit argument and never read `ctx`; redo passes the value from the create's captured `after` snapshot.
- `PersonSnapshot`, `CompanySnapshot` and `DealSnapshot` carry `createdByUserId`; the snapshot loaders read it from the entity.
- Snapshots taken by update `prepare`/`captureAfter` and by delete use the same snapshot types, so they carry the creator too. Every path that re-creates a removed row from a snapshot writes the snapshot value: redo of create (people, companies, deals), undo of update when the row is missing, and undo of delete. Paths that only reassign fields on a surviving row leave the column untouched.
- Undo of create removes the row as today.
- Undo tokens captured before this release have snapshots without the key; rebuilding from them writes `null`.

### Entry-point matrix (implementation head)

Rows marked *latent* have no callable create path today. Before the matrix is declared complete, grep every `customers.people.create`, `customers.companies.create` and `customers.deals.create` call site and every direct insert into `customer_entities`/`customer_deals`; add any new row with its proof.

| Entry point | Path | Expected creator | Proven by |
|---|---|---|---|
| Backend create pages/dialogs, quick deal, sales document customer creation (people/companies only) | Browser POST to the customers routes with the staff session cookie; the CRUD factory builds the command context from that session | Signed-in staff user | Integration: staff-session create of each kind |
| Deal duplicate (list and kanban, `lib/duplicateDeal.ts`) | POST `/api/customers/deals` with the payload `duplicateDeal` builds | The user who duplicates; the source creator is not copied | Unit: `duplicateDeal` payload omits creator keys; integration: user A creates, user B duplicates, copy records B |
| Inbox actions (`inbox-actions.ts`, people/companies) | In-process dispatch through the exported `executeCommand` in `inbox_ops/lib/executionHelpers.ts`, which builds `auth` with `sub` = approving user when none is passed | The approving user | Unit: drive the exported `executeCommand` with a capturing command bus and assert the context resolves to the approving user |
| Excel import (`sync_excel` customers adapter, people) | In-process dispatch with the adapter's private `buildCommandContext` (`auth: null`, `sync_excel/lib/adapters/customers.ts`) | Always null | Unit: through the adapter's existing test harness when it captures the command context, otherwise a literal `auth: null` case citing that builder |
| In-process AI chat operation runner (*latent*: no customers create tool today) | Customers POST routes with the runner's private `buildAuthEnvelope` auth (`sub` = staff user UUID or `api_key:<uuid>`, no `isApiKey`) | The approving staff user for a user principal; null for an `api_key:` principal (step 5) | Unit: predicate cases for both envelope principal shapes |
| AI codemode / MCP HTTP calls | Customers POST routes with an API key | null | Integration: API-key create of each kind |
| Workflow `CALL_API` activity (`workflows/lib/activity-executor.ts`, one-time API key); `UPDATE_ENTITY` allowlists update commands only | Customers POST routes with an API key | null | Covered by the API-key integration case |
| Agent orchestrator seeds | `customers.deals.create` with `systemActor: true` | null | Unit: predicate case `systemActor` with a UUID `sub` |
| `cli.ts` example and stress seeds, dashboards analytics seed, raw-SQL test fixtures | Direct inserts | null (no value written) | Not applicable: no command path |

There is no separate clone command; "clone" in this spec means the deal duplicate action above.

## 📝 Data Model and API Contracts

Both columns are nullable `uuid`, no default, no constraint, no index until a real creator-filter use case exists. Generate them with `yarn db:generate`, keep only the intended `ALTER TABLE ... ADD COLUMN "created_by_user_id" uuid NULL` statements, commit the customers `migrations/.snapshot-open-mercato.json` update and run `yarn generate`; a second `yarn db:generate` must report no changes.

Response contract, mirroring the existing owner field on each surface:

| Surface | Key | How the value reaches the response |
|---|---|---|
| `GET /api/customers/people`, `/companies`, `/deals` list items | `created_by_user_id` (snake_case, like `owner_user_id`) | Added to each route's `list.fields`. The query engine selects listed base fields from the base table row (`query_index/lib/engine.ts`, `applySelection` uses the base column when it exists), not from the index document, so rows indexed before the migration read the column's `NULL`. Each route also normalizes the key to `?? null` in its item shaping (`afterList` for people and companies, the deal list decoration for deals). Exports derived from list items include the same raw UUID column as `owner_user_id` (documented in the upgrade note). |
| `GET /api/customers/people/{id}`, `/companies/{id}`, `/deals/{id}` main record | `createdByUserId` (camelCase, like `ownerUserId`) | Set from the entity with `?? null`. Nullable UUID only; no expanded user profile, name or email. |

The snake_case list key is deliberate: list items on these routes already use snake_case user references (`owner_user_id` in `api/people/route.ts` `list.fields` and its `afterList` rebuild, `api/companies/route.ts` `list.fields`, and `dealListItemSchema` in `api/deals/route.ts`), and mixing conventions within one list item would be the larger contract inconsistency. The upgrade note names both spellings.

OpenAPI declares `created_by_user_id` in the three list item schemas as `z.string().uuid().nullable().optional()` (matching `owner_user_id`, and tolerating list payloads cached before the upgrade) and `createdByUserId` in the three detail record schemas as `z.string().uuid().nullable()`, both described as read-only server-assigned creator attribution; create/update request schemas do not gain it. The customers create/update schemas must stay non-strict while the field is response-only (pinned by the round-trip test). Existing names, types, envelopes and route parent view ACLs are unchanged; same-tenant cross-organization reads keep returning 404 as today.

This is personal attribution metadata: scope reads to the parent tenant/organization and never return expanded user data from customers routes. Because it is an opaque relational identifier, encrypting it would obstruct the UUID-reference convention already used by owner IDs; no encrypted column, search token or vector source changes.

## 📝 UI/UX

Show "Created by" as a display-only fact in the live detail headers, never inside a `CrudForm` field set or save payload, and without self-injected widgets:

- Deal: `components/detail/DealDetailHeader.tsx`, next to the existing Owner and Created facts.
- Person: `components/detail/PersonDetailHeader.tsx` on `backend/customers/people-v2/[id]`.
- Company: `components/detail/CompanyDetailHeader.tsx` on `backend/customers/companies-v2/[id]`.
- Legacy person and company pages (`backend/customers/people/[id]`, `companies/[id]`), still directly addressable: `components/detail/PersonHighlights.tsx` and `CompanyHighlights.tsx`.

All five render one shared display-only leaf (`components/detail/CreatedByFact.tsx`) so the rules below live in one place.

List row links (`backend/customers/people/page.tsx`, `companies/page.tsx`) and global search results (`search.ts`) open the v2 detail pages, and deals have a single detail page.

Resolve the name client-side with the existing `components/detail/authorUserLookup.ts` `resolveAuthorUserNames(ids, signal)` batch lookup against `/api/auth/users?ids=`, sent with `x-om-forbidden-redirect: 0`. That route requires `auth.users.list` (wildcard grants such as `auth.*` match) and, by its documented design for author and assignee labels, resolves explicit `?ids=` lookups tenant-wide rather than by the selected organization, and hides super-admin users from non-super-admin viewers (`auth/api/users/route.ts`). Creator labels deliberately adopt exactly that existing contract: a viewer who holds `auth.users.list` sees the same names they already see for activity authors; a super-admin creator renders "Unknown creator" for ordinary viewers. Rules:

- `createdByUserId` null → render "Unknown creator" immediately; no request.
- Deal whose creator equals the server-resolved owner and whose owner label is a non-empty name that is not a UUID → reuse it; no request. The deal detail route already returns that owner name to every deal viewer in the adjacent Owner fact, so this discloses nothing new. A blank or UUID-like owner label falls through to the lookup.
- While the lookup is in flight → a neutral placeholder (not "Unknown creator").
- Deleted user, 403/failed lookup, or a successful lookup that does not return this id → "Unknown creator". A raw UUID is never rendered.
- Results are keyed by the creator id (the lookup is tenant-wide, so organization switches do not change its answer; a tenant switch reloads the page). When the id changes, the rendered name is cleared and a pending response for the previous id is discarded (effect-local cancellation); the `AbortSignal` passed to `resolveAuthorUserNames` aborts the request on unmount.

Keys: `customers.detail.createdBy.label` ("Created by"), `customers.detail.createdBy.unknown` ("Unknown creator"), added to every customers locale file present at implementation head (verified 2026-11-27: `en`, `pl`, `de`, `es`, `ko`; the module ships `ko` beyond the four documented core locales); `yarn i18n:check-sync` and `yarn i18n:check-usage` are authoritative. Recorded exception to the umbrella Frontend Architecture Contract row for creator labels ("existing response data"): the new `CreatedByFact` leaf issues one client lookup through an existing authorized endpoint and helper already used by detail activity sections; it is not an event scan and adds no library. The exception is listed in the PR body for maintainer review. No new client island, provider or browser library: the headers and highlights are existing `"use client"` components (browser-only reason: interactive header state); the added effect is cleaned up on unmount. Request delta per detail view: at most one `/api/auth/users` call (one `users` query plus its existing role/super-admin lookups), zero when the creator is null or reused from the deal owner. Server detail and list routes add no SQL statement: the column is read with the row already loaded.

## Migration & Backward Compatibility

Add nullable columns and module snapshot; no attribution backfill, no reindex requirement and no new required request field. Existing creation/update payloads, optimistic-lock behavior and event payloads remain. Rollback is a compatibility release that removes the header fact while retaining the column and data; there is no runtime toggle and no destructive down migration after production writes. Add an `UPGRADE_NOTES.md` entry for the additive response fields, naming both key spellings, noting that list exports gain the `created_by_user_id` column, and telling operators who run the opt-in `ENABLE_CRUD_API_CACHE` with a persistent store to purge the customers people/companies/deals list cache once the last instance running the previous version has stopped serving requests: cached list payloads predate the key and carry no TTL, so until the next write invalidates them they omit `created_by_user_id`; clients must treat an absent list key like `null`.

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Spoofed attribution through request bodies | High | Field absent from validators; server-only assignment; update never writes it; tests send forged values on create and update | None known |
| Wrong permanent creator from an undo/redo actor | High | Snapshot carries the value; every rebuild path copies it; tests run rebuilds as a different actor | None known |
| Cross-organization or cross-tenant user disclosure | High | Customers routes return only the UUID; a creator whose home tenant differs is never stored; names come from the org-scoped, ACL-gated users API with unknown fallback | A same-tenant creator from another organization is visible as an opaque UUID to record viewers; a viewer with `auth.users.list` can resolve it to a name exactly as for activity authors (existing tenant-wide id-lookup contract); the latent AI runner path needs `actorTenantId` forwarding before it can create records |
| API-key and agent creates recorded as null | Low | Ordered predicate; action log keeps the key, agent actor and on-behalf-of attribution | Attribution for key-authenticated AI sessions waits for a shared session-key marker |
| Stale cached list payloads without the key | Low | Upgrade note to purge the opt-in CRUD list cache | Operators who skip the purge see the key appear after the next write |
| A create path missed during implementation | Medium | Entry-point matrix with proof per row and a call-site grep | Future create paths must reuse the helper |

## Integration Coverage and Test Plan

Unit (jest, customers commands and components):

- `resolveCreatorUserId` truth table: staff session UUID; super-admin context with `tenantId` = record tenant but `actorTenantId` = another tenant (null), with `actorTenantId` equal to the record tenant (UUID), with `actorTenantId: null` (null) and with the key absent (falls back to `tenantId`); missing home tenant (null); the `customers.creator_unresolved` warning for an authenticated non-key same-tenant non-UUID `sub`, and no warning for any step 1–5 case including `api_key:<uuid>` without `isApiKey`; API key with and without `userId`; key-derived auth lacking `isApiKey` with `sub` `api_key:<uuid>`; the AI runner auth shape; `runAs`; `systemActor` together with a UUID `sub`; missing auth; non-UUID `sub`; `auth.tenantId` different from the record tenant.
- Each create command stores the resolved value; inbox actions through the exported `executeCommand` (approving user) and the sync_excel context (`auth: null` → null) as described in the matrix.
- Update snapshots capture the creator; redo of create, undo of an update after the row is gone, and undo of delete restore the captured creator when executed by a different actor or an API key, and write null from a snapshot without the key (pre-release undo token).
- Update commands ignore forged input; `buildDealDuplicatePayload` (`lib/duplicateDeal.ts`) output carries no creator keys and `DealDuplicateSource` gains no creator field.
- `CreatedByFact`: name rendered; null creator renders "Unknown creator" without a request; lookup returning no row for the id, 403 and failure render "Unknown creator" and never the UUID; placeholder while pending; a late response for a previous creator or organization scope is ignored and a scope change clears the name; deal reuses the owner name when the ids match and the label is a real name, and falls through to the lookup for a blank or UUID-like owner label.

Integration (`packages/core/src/modules/customers/__integration__`, two tenants plus two organizations in one tenant, all users/organizations/records created by the test and removed in `finally`):

- Staff session creates a person, a company and a deal: list items expose `created_by_user_id` and detail responses expose `createdByUserId` equal to the creating user; the action log actor for that create matches.
- API-key create of each kind stores null, and the action log actor identifies the API key.
- Forged `createdByUserId`/`created_by_user_id` on create and update are ignored and do not fail the request, including a PUT whose body spreads the non-null fields of the GET detail's `person`/`company`/`deal` record (with its `createdByUserId`) plus `id` (the existing update schemas already reject several nullable detail fields echoed as `null`, independent of this slice); the stored creator is unchanged.
- Owner reassignment leaves the creator unchanged; user A creates a deal and user B duplicates it, and the copy records B.
- User A creates each kind, user B deletes it and undoes: the restored record keeps A. User A creates each kind, then create-undo and redo run through the audit-log undo/redo endpoints (existing undo integration harness): the redone record keeps A, and a redo of an API-key-created record keeps null.
- A super admin whose session switched into another tenant (`om_selected_tenant`) creates each kind there: the creator is null.
- Pre-migration simulation: for each kind, create a record with an API key (null column), poll until its `entity_indexes` row exists, then run `UPDATE entity_indexes SET doc = doc - 'created_by_user_id' ... RETURNING entity_id` and assert one row changed, as an index document written before the migration would be; re-check the key is absent after the reads below, and read with the CRUD list cache bypassed; the list and detail responses still return the key with `null`. A record created by a staff user whose index doc key is removed the same way still returns the creator, pinning base-column selection. The generated migration itself is a nullable `ADD COLUMN` with no data statement, applied by the integration environment's migration run.
- List export (CSV) for each kind contains the `created_by_user_id` column.
- For each kind, a viewer in the other organization of the same tenant and a viewer in the other tenant get 404 on detail and do not see the record in the list or its export; a viewer whose grants include the record's organization sees it.
- UI (Playwright): deal, people-v2, companies-v2 and the legacy people/companies detail pages show the creator's name for a viewer with `auth.users.list` (including a viewer whose only grant is a wildcard such as `auth.*`), "Unknown creator" for a viewer with `auth.users.list` when the creator user was deleted, and "Unknown creator" for a viewer without it (deal fixture with owner ≠ creator) and for a null creator; a deal whose owner is its creator shows the owner's name to a viewer without `auth.users.list` with no `/api/auth/users` request; the field is absent from edit forms.

Validation: the configured gate plus `yarn generate`, `yarn check:client-boundaries`, the i18n sync/usage checks and the design-system rules for the touched header lines. Per the umbrella Frontend Architecture Contract, record the before/after production gzip size of the deal, people-v2, companies-v2 and legacy people/companies detail routes (budget 10 KiB), list the touched `"use client"` files with their browser-only reason in the PR body, and zero hydration errors from browser QA. The ≤5% steady-state RSS budget is not measured in this slice; completion requires a maintainer approving the PR to explicitly accept that recorded exception (rationale: no module, dependency or provider is added, only one shared leaf with one effect and two strings), otherwise a before/after RSS measurement of the same detail-route scenario is added before merge.

Umbrella fixture dimensions: two tenants and two organizations in one tenant, wildcard ACLs and undo/redo are covered above. Encryption on/off is not applicable to the new value (a plain UUID outside the encryption maps); the existing records' encrypted fields keep their current coverage. Concurrent stale versions are not applicable because the field is never writable.

### Council dispositions (not adopted)

| Finding | Disposition |
|---|---|
| Expose `createdByUserId` (camelCase) in list items | Rejected: list items on these routes use snake_case user references (`owner_user_id`); one item must not mix conventions. The upgrade note names both spellings. |
| Store null when the creator's organization differs from the record's | Rejected: staff legitimately create records in any organization their grants allow; the value is an opaque same-tenant UUID and names follow the existing author-label lookup contract. Documented in Risks. |
| Disposable-database migration test seeded on the previous schema | Rejected: the migration is a nullable `ADD COLUMN` with no data statement, applied by the integration environment; list and detail read the base column, which the index-document simulation pins. |
| Re-check creator visibility before reusing the deal owner's name | Rejected: the same name is already returned to every deal viewer in the adjacent Owner fact. |
| Version CRUD list cache keys | Rejected for this slice: cache keys are a shared factory contract; the optional list schema, the client rule for an absent key and the upgrade-note purge cover the transition. |
| Durable guard against future create paths | Rejected: the single helper, the call-site grep and the entry-point matrix are the guard; a static scanner is out of scope. |

## Final Compliance Report — 2026-11-27

Root/core/customers/shared/UI/QA and backward-compatibility rules are addressed: additive nullable columns with generated migration and snapshot, command-owned writes with snapshot-based undo/redo, unchanged ACLs and response envelopes, OpenAPI response-only documentation, localized UI with existing components, and same-change tests. This document claims no executed runtime tests.

## Changelog

- 2026-10-22: Initial independent provenance slice with null historical defaults and server-only attribution.
- 2026-11-27: Pre-implementation council round 1 remediation: pinned the trusted creator predicate (API keys, agent runs and system contexts record null), snapshot-based redo/undo rebuild rules, an entry-point matrix, per-surface response key casing, null-not-absent list values and exports, named header surfaces and the authorized users lookup with i18n keys, migration discipline, rollback mechanism and a scoped audit-agreement test.
- 2026-11-27: Council round 2 remediation: ordered predicate with system/agent/key precedence and a same-tenant guard, explicit AI runner outcome, entry-point proof column, base-column list projection with null normalization on all routes, UI loading/stale/no-UUID rules, cross-tenant and cross-org read tests, pre-release undo-token tests, CRUD list cache upgrade note, and frontend budget evidence.
- 2026-11-27: Council round 3 remediation: super-admin home-tenant guard via `actorTenantId`, explicit organization stance, unresolved-creator warning, update-snapshot capture, boundary-level entry-point proofs with latent rows and the workflow `CALL_API` row, legacy detail pages via a shared `CreatedByFact` leaf, scope-keyed lookup results, pre-migration index-doc simulation and export tests, cache purge timing, and an explicit RSS exception gate.
- 2026-11-27: Council round 4 remediation: corrected the users-lookup contract (tenant-wide id lookups, hidden super admins) and adopted it explicitly, pinned `actorTenantId` presence semantics and key-derived detection, reordered the tenant check before the UUID check for the warning, documented the latent AI runner tenant gap, owner-label guard, optional list schema, create-undo-redo and super-admin tenant-switch integration cases, stricter index-doc simulation, wildcard and deleted-creator UI cases, legacy routes in budget evidence, an explicit umbrella exception and a dispositions table.

## 📋 Implementation Plan

### Phase 1 — Additive creator attribution

1. Add nullable fields, generated migration and snapshot; add `resolveCreatorUserId`; set the value in the three create commands; carry it through snapshots and every rebuild path; unit tests for the predicate, commands and undo/redo.
2. Add list/detail projections and OpenAPI response fields; add the shared `CreatedByFact` leaf to the three headers and two legacy highlights with i18n keys; add the integration and UI tests above and the upgrade note; finish the shared validation gate without attributing unknown history.
