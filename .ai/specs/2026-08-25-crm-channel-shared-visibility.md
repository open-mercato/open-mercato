# CRM Conversation Shared Visibility

> **Status:** IMPLEMENTED. The Open Questions gate is closed — see § Gate Decisions. Q1 and Q3 were **reopened and re-decided on 2026-08-28**; read those rows before assuming the original answers still hold.
> Readiness audit: [`analysis/ANALYSIS-2026-08-25-crm-channel-shared-visibility.md`](analysis/ANALYSIS-2026-08-25-crm-channel-shared-visibility.md). Every Critical and High finding in that audit is addressed by a numbered Step below.

## 📝 TLDR

A personal communication channel (`CommunicationChannel.user_id` set) is private by definition today: every email it ingests becomes a `customer_interactions` row with `visibility = 'private'` and `author_user_id = channel.user_id`, readable only by that owner — with no admin bypass. Handing one customer conversation to a colleague therefore means flipping every message one at a time. This spec adds a single owner-controlled escalation: **a mailbox owner may share their whole email conversation with one CRM Person with the team.** The share is a row in a new table, so it is retroactive (existing private messages become visible), instantly reversible (delete the row and they are hidden again), and non-destructive (it never rewrites per-message `visibility`, so individual decisions survive). Only the mailbox owner may share their own conversation; tenant/organization scoping and the existing fail-closed read filters are preserved.

## ✅ Gate Decisions (Q1–Q4 closed)

Answers are derived from the implementation brief's own wording plus the audit's safety findings. Each records *why*, so a later contributor does not silently re-open it.

| # | Question | Decision | Rationale |
|---|---|---|---|
| **Q1** | One spec or split (channel-level + conversation-level)? | **REOPENED 2026-08-28 → both.** Conversation-level *and* a `communication_channels.visibility` column. | Originally decided conversation-level-only, on the belief that a team mailbox could be approximated by connecting the mailbox tenant-wide. **That belief was wrong for email**: `connect/credentials` (IMAP) and `oauth/[provider]/initiate` (Gmail) both hardcode `userId: auth.sub`, and `connect/tenant-credentials` — the only route producing `user_id IS NULL` — is push-only (FCM/APNs/Expo) per its own OpenAPI summary and the `connect_tenant_channel` ACL comment. There was therefore **no mechanism at any level** to run a genuine team mailbox, which makes the channel flag a substantive capability rather than the redundant convenience Q1 first assumed. The **R8 hazard that motivated the original NO is mitigated, not ignored**: the column addition is followed *in the same migration* by `UPDATE communication_channels SET visibility='shared' WHERE user_id IS NULL`, so every existing tenant-wide push channel keeps its shared status on deploy. `set-channel-visibility.test.ts` pins the tenant-scoped-channel refusal. |
| **Q2** | Retroactivity of a flip | **Retroactive and reversible, by read-time derivation.** A share row widens what the read filter admits; no row is ever rewritten. | Option (b) write-time backfill is a privacy one-way door (audit R4: un-sharing cannot distinguish owner-shared from flip-shared rows) and leaves the query index stale (R6). Option (c) forward-only makes the feature useless — sharing a conversation that shows no history does not hand anything over. Read-time derivation gets retroactivity *and* lossless undo. |
| **Q3** | Unit of a shared conversation | **Person × mailbox owner** for the conversation grant (unchanged). **REOPENED 2026-08-28:** the channel flag additionally requires a denormalised `customer_interactions.channel_id`. | The conversation grant still keys on `(person, owner_user_id)`, reusing `customer_interactions_email_visibility_idx` with no schema change — that decision stands. But the *channel* flag cannot reuse it: an owner with one shared and one private mailbox has the **same `author_user_id` on both**, so an author-keyed rule would expose the private one. Channel sharing therefore denormalises `channel_id`, written at ingestion and backfilled once via the only available chain (`message_channel_links` carries no channel id): `external_message_id → message_channel_links.id`, `.external_conversation_id → external_conversations.id`, `.channel_id`. This is audit finding #5's own recommendation, accepted here rather than avoided. `TC-CRM-EMAIL-VISIBILITY-004` pins the two-mailbox leak case: the sibling private mailbox must stay hidden and the private-email count must land on 1, not 0. |
| **Q4** | Who may flip; does un-sharing claw back | **Owner-only. No admin escalation. Un-sharing fully claws back.** | The implementation brief says "only the owner can toggle". Per audit finding #2 / R3, the two reserved features (`customers.email.view_private`, `communication_channels.admin`) are **already granted tenant-wide** via `admin: ['customers.*']` and explicit grants, so activating either as the Q4 mechanism would retroactively expose every private email in every tenant. This spec activates **neither**; both stay inert, and a test asserts it. Because sharing is derived at read time, revoking is instant and complete. |

---

## 📝 Problem Statement

Per-email visibility already ships: `customer_interactions.visibility` (`private` | `shared` | NULL legacy), a fail-closed read filter in `lib/visibilityFilter.ts`, an owner-gated `PATCH /api/customers/interactions/{id}/visibility`, and a lock/people toggle in `components/detail/EmailCardActions.tsx`. What is missing is any way to act on a *conversation*:

- `customers/lib/link-channel-message-handler.ts` → `resolveVisibility()` hard-codes `channelUserId ? 'private' : 'shared'`. Every message a personal mailbox ingests is private, forever, unless flipped by hand.
- Handing a 40-message thread to a colleague costs 40 clicks and emits 40 audit events.
- Teammates see only an opaque private-email count on the Person (`data/enrichers.ts` → `privateEmailCountEnricher`), which is the intended privacy behaviour but offers no affordance to receive access.
- There is no third state between "my private mailbox" and "connect it as a tenant-wide channel", the latter surrendering owner-only management.

## 📝 Existing Architecture (what this builds on — not re-specified here)

Enumerated so the design states only its delta. Every row verified against the working tree.

| Concern | Current mechanism | Source |
|---|---|---|
| Channel ownership | `CommunicationChannel.user_id`; `NULL` = tenant-wide | `communication_channels/data/entities.ts` |
| Channel authorization | `assertCanAccessChannel` / `assertCanManageChannel`; personal = owner-only, no admin bypass | `communication_channels/lib/access-control.ts` |
| Person ↔ email anchor | `customer_interactions` row per matched Person, `interaction_type='email'`, `author_user_id = channel.user_id` | `customers/lib/link-channel-message-handler.ts` |
| Per-email visibility | `customer_interactions.visibility` (`private` \| `shared` \| NULL legacy) | `customers/data/entities.ts:670` |
| Covering index | `customer_interactions_email_visibility_idx` on `(entity_id, interaction_type, visibility, author_user_id)` `WHERE interaction_type='email' AND deleted_at IS NULL` | `customers/data/entities.ts:564` |
| Read enforcement (shared helpers) | `applyEmailVisibilityFilter` (kysely) / `buildEmailVisibilityMikroFilter` (MikroORM) — fail-closed, no admin bypass, legacy NULL passes through | `customers/lib/visibilityFilter.ts` |
| Read enforcement (**bypasses** the helpers) | `privateEmailCountEnricher` (raw kysely, hard-codes `visibility='private'` + `author_user_id != userId`, lines 272–275); `interactionEmailCardEnricher` (independent strip at line 437) | `customers/data/enrichers.ts` |
| Write authorization | `canChangeEmailVisibility` + the owner check in the dedicated route | `customers/lib/visibilityFilter.ts`, `customers/api/interactions/[id]/visibility/route.ts` |
| Audit | `customers.email.visibility_changed` (`clientBroadcast: true`) | `customers/events.ts:84` |
| Person Emails tab | `buildPersonEmailThreads` → `GET /api/customers/people/[id]/email-threads` → `PersonEmailThreadsTab` / `EmailThreadsPanel` | `customers/lib/personEmailThreads.ts`, `packages/ui/src/backend/messages/` |
| Inert v2 hooks (**stay inert**) | `customers.email.view_private`, `communication_channels.admin` | `customers/acl.ts`, `communication_channels/acl.ts` |

Terminology: the brief's "PeopleCustomer entity" is `CustomerEntity` with `kind='person'` (entity id `customers.person`). This spec says **Person**.

## 📝 Proposed Solution

One new concept: a **conversation share** — "mailbox owner *O* has shared their email conversation with Person *P* with the team."

```
customer_email_conversation_shares
  (tenant_id, organization_id, person_entity_id, owner_user_id)  ← unique, alive rows
```

A share row is *derived into* the existing read predicate rather than acted on by a parallel read path. Today's predicate hides a row when it is `interaction_type='email' AND visibility='private' AND author_user_id != caller`. The new arm admits such a row when `(entity_id, author_user_id)` matches a live share. Because both columns are already the leading/trailing columns of `customer_interactions_email_visibility_idx`, the widened predicate uses the existing index with no schema change to `customer_interactions`.

Three properties fall out for free:

- **Retroactive** — history becomes visible the moment the row exists.
- **Reversible and lossless** — deleting the row re-hides everything; per-message `visibility` is never rewritten, so a message the owner shared individually stays shared and one they kept private goes back to private.
- **No index staleness** — nothing writes to `customer_interactions`, so `entity_indexes` cannot drift (audit R6 avoided).

**Phase 1 is a prerequisite, not a follow-up.** The rule is currently enforced at five sites, only three through the shared helpers, and the helper's return type (`{ $or?: ... }`) is consumed inconsistently by its four MikroORM callers — `activities/route.ts:311` merges the whole fragment via `Object.assign`, while `personEmailThreads.ts:157` does `interactionWhere.$or = build(...).$or` and would **silently discard** any arm the widening adds. That is a fail-**open** shape (audit BC #1 / R1). Phase 1 consolidates all five sites and fixes the fragment contract *before* anything is widened.

## 📝 Data Model

New entity in `customers/data/entities.ts`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid not null | scoping |
| `organization_id` | uuid null | scoping (NULL-org-inclusive, matching sibling entities) |
| `person_entity_id` | uuid not null | the shared Person (`customer_entities.id`, `kind='person'`) — FK id, no cross-module ORM relation |
| `owner_user_id` | uuid not null | the mailbox owner doing the sharing; matches `customer_interactions.author_user_id` |
| `shared_by_user_id` | uuid not null | actor for audit; equals `owner_user_id` under Q4 but recorded explicitly so a future admin-escalation path is additive |
| `created_at` | timestamptz | `onCreate` |
| `updated_at` | timestamptz null | `onCreate` + `onUpdate` — required by root `AGENTS.md` for a user-editable entity so optimistic locking functions |
| `deleted_at` | timestamptz null | soft delete |

Indexes:
- `customer_email_conversation_shares_uq` — `UNIQUE (tenant_id, person_entity_id, owner_user_id) WHERE deleted_at IS NULL` (idempotent share; re-sharing is a no-op, not a duplicate).
- `customer_email_conversation_shares_lookup_idx` — `(tenant_id, organization_id, person_entity_id) WHERE deleted_at IS NULL` (Person-page read).
- `customer_email_conversation_shares_owner_idx` — `(tenant_id, owner_user_id) WHERE deleted_at IS NULL` (the "conversations I have shared" read).

The channel flag adds two more pieces:

- **`communication_channels.visibility`** — `text NOT NULL DEFAULT 'private'`. Made explicit rather than inferred from `user_id`, so a *personal* mailbox can be team-visible without surrendering owner-only management. The migration follows the column add with `UPDATE … SET visibility='shared' WHERE user_id IS NULL` **in the same file**, so existing tenant-wide push channels keep working.
- **`customer_interactions.channel_id`** — `uuid null`, written at ingestion and backfilled once via the `message_channel_links` → `external_conversations` chain, plus a partial index on `(channel_id, entity_id)` for email rows. Required because the channel arm must key on the channel, not the author (see Q3). Unresolvable rows stay `NULL`, which every predicate treats as *not shared*.

Both are additive column adds. Migrations are a single additive `CREATE TABLE` + indexes for the share table

## 📝 API Contracts

New route `customers/api/people/[id]/email-share/route.ts`, mirroring the structure, mutation-guard wiring and **404-not-403 masking** of `api/interactions/[id]/visibility/route.ts` (the masking is deliberate — it hides row existence; do not "fix" it to 403).

**`GET /api/customers/people/{id}/email-share`** — returns the caller-relevant share state for the Person.
```json
{ "sharedByMe": true, "sharedBy": [{ "userId": "…", "userName": "…", "sharedAt": "…" }], "canShare": true, "updatedAt": "…" }
```
`canShare` is true when the caller authored at least one private email interaction for this Person (i.e. they own a mailbox with a conversation to share). `sharedBy` lists owners who shared *with* the caller, so the UI can render "shared by Ann".

**`PUT /api/customers/people/{id}/email-share`** — body `{ "shared": boolean }`. Creates or soft-deletes the caller's own share row for this Person. Idempotent.
- Requires `customers.email.share_conversation` **and** `customers.people.view`.
- Owner-only: the route writes a share keyed on `owner_user_id = caller`. There is no request field naming another owner, so escalation is structurally impossible rather than merely checked.
- 404 when the Person is not visible in the caller's tenant/org scope; 400 when the caller has no private email conversation with this Person (nothing to share); 409 on optimistic-lock conflict.
- Honours `If-Unmodified-Since`-style optimistic locking via `buildOptimisticLockHeader(share.updatedAt)`; the create path has no prior version so the header is omitted for a first share.
- Wires the mutation-guard registry per `packages/core/AGENTS.md` § API Routes (operation `update`), and exports `openApi`.

Response-shape additions (all **optional** fields, fail-closed absent ⇒ today's behaviour, per audit BC #6/#7):
- `GET /api/communication_channels/me/channels` — each channel gains `visibility` and `updatedAt` (the latter so the toggle can send the optimistic-lock header).
- `EmailCardWidgetData` is **unchanged**: `currentVisibility` keeps its exact present meaning, and a teammate reading a shared email is shown the state, **not** a toggle that would 404. The `sharedVia` / `sharedByUserName` fields Step 11 originally proposed were **not** added — see Step 11.

## 📝 UI/UX

- **Person detail → Emails tab header** (`PersonEmailThreadsTab`): a `Switch`-style control "Share this conversation with my team", visible only when `canShare` is true. Flipping it on opens a confirm dialog naming the consequence ("Your colleagues will be able to read your email history with this person"), with `Cmd/Ctrl+Enter` submit and `Escape` cancel per root `AGENTS.md`. Flipping off needs no confirm (it is the safe direction).
- **Teammate view**: when `sharedBy` is non-empty, the tab shows a `Badge` reading "Shared by {name}" using semantic status tokens — never hardcoded Tailwind status colors (`.ai/ds-rules.md`).
- **Email card**: a conversation-shared email read by a teammate renders the existing read-only state; the owner still sees their per-message toggle, which continues to work independently of the conversation share.
- The write goes through `useGuardedMutation(...).runMutation(...)` with `retryLastMutation` in the injection context (`customers/AGENTS.md` rule 6), and surfaces conflicts via `surfaceRecordConflict(err, t)`.
- All strings via `useT()` under `customers.email.conversationShare.*`, added to **all five** locale files (`en`, `pl`, `de`, `es`, `ko`) so `yarn i18n:check-sync` passes.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Caller has no private email with this Person | `PUT` returns 400; the UI hides the control (`canShare: false`). |
| Person is merged or deleted after sharing | Share row is soft-deleted alongside the Person by the existing person-delete command; orphan rows are inert because the read arm joins on `person_entity_id`. |
| Owner leaves / user deactivated | Share row survives (the team keeps the handed-over history — that is the point). Documented explicitly so it is not read as a leak. |
| Message arrives after sharing | Ingested `private` as always, and admitted by the share arm at read time. No write-path change, so threading-inherited replies are covered too. |
| Owner shares, then flips one message to `private` individually | Conversation share still admits it — the share is the broader grant. Documented; the per-message control is not a within-share exclusion mechanism. |
| API-key caller (`auth.isApiKey`) | `viewerUserId` is null, matches no share and no author arm. Sees only shared/legacy rows, exactly as today. |
| Tenant-wide channel (`user_id IS NULL`) | Its mail is already `shared`; `canShare` is false, nothing to do. |
| Two owners both share the same Person | Both rows exist; the read arm admits both mailboxes' history. Unique index is per `(tenant, person, owner)`. |
| `ENABLE_CRUD_API_CACHE` on | The share write invalidates the `customers.interaction` collection cache tags for the affected tenant/org (audit R7 — `buildPersonDetailCacheTags` does not otherwise observe this write). |

## 📝 Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| **R1 — Fail-open filter fragment.** `buildEmailVisibilityMikroFilter` returns `{ $or }`; 2 of 4 callers spread only `.$or`, so a new non-`$or` arm compiles clean and is dropped. | **Critical** | All email read paths | Step 1: return an opaque `FilterQuery` fragment, merge with `Object.assign` at all four callers, unit-test that a non-`$or` arm survives. Also keep the widened predicate expressible as one nested `$or` for defence in depth. | None once all four callers are converted; the test locks it. |
| **R2 — Two read paths bypass the shared helpers.** `privateEmailCountEnricher` / `interactionEmailCardEnricher`. | **High** | Person page count, email card actions | Steps 2–3: refactor both onto the shared predicate **before** widening. | None. |
| **R3 — Reserved ACL features are already granted tenant-wide.** | **High** | Every tenant | This spec activates neither feature. New feature id `customers.email.share_conversation` only ever writes a share owned by the caller, so the existing `admin: ['customers.*']` wildcard grant is harmless. Step 12 asserts the v1 owner-only filter still ignores caller features. | None. |
| **R4 — Over-share across an owner's multiple mailboxes** (Q3 trade-off). | Medium | Multi-mailbox owners | Documented in the confirm dialog copy ("your email history with this person"). Additive `channel_id` refinement stays open. | Accepted. |
| **R5 — GDPR surface.** Sharing widens who receives personal data. | Medium | Compliance | Every share/un-share emits `customers.email.conversation_visibility_changed`, so the act is auditable. Erasure scope is unchanged: no new copy of message content is created, only a read grant. Reconciliation with `enterprise/2026-07-08-gdpr-data-erasure.md` is a post-implementation follow-up. | Low. |
| **R6 — Write sites disagree on the default.** Three sites compute `channelUserId ? 'private' : 'shared'`; two bypass `resolveVisibility()` (lines 339, 418). | Medium | Ingestion | Step 2 consolidates all three. No behaviour change today; prevents divergence under any future default change. | None. |
| **R7 — Person-detail cache staleness.** | Medium | Cached reads | Share write invalidates `customers.interaction` tags (see Edge Cases). | None. |
| **R8 — Share-list size in the read predicate.** A tenant with very many shares makes the `$or` arm large. | Low | Read latency | The arm is scoped to the Person on Person-scoped reads (one tuple). Unscoped reads (`/interactions`, `/activities`) fetch the caller's applicable shares with an explicit cap (`SHARE_ARM_MAX = 500`) and log when the cap truncates — never silently. | Low; a subquery form is the documented escalation. |

## 📝 Migration & Backward Compatibility

Audited against all 13 contract surfaces in `BACKWARD_COMPATIBILITY.md`.

| Surface | Change | Classification |
|---|---|---|
| **2. Types / 3. Signatures** | `EmailVisibilityMikroFilter` narrows from `{ $or?: … }` to an opaque `FilterQuery<CustomerInteraction>`. All four callers are in-repo and converted in the same commit. `ApplyEmailVisibilityFilterOptions` and `BuildPersonEmailThreadsOptions` gain **optional** `sharedConversations` with a fail-closed default (absent ⇒ today's strict owner-only behaviour), matching the `userFeatures` precedent. | Breaking-shape but fully in-repo → **allowed with same-commit caller update**. `@deprecated` alias `EmailVisibilityMikroFilter` retained as a type alias for one minor per the deprecation protocol. |
| **5. Event IDs** | **New** ids `customers.email.conversation_visibility_changed` and `communication_channels.channel.visibility_changed`. The customers event is **audit-only, not `clientBroadcast`** — its payload names a Person and a mailbox owner with no recipient hint, so broadcasting would tell the whole tenant audience that user X had a private conversation with Person P. The existing `customers.email.visibility_changed` payload is **not** touched — its required `interactionId` stays required (audit BC #4). | Additive. |
| **7. API route URLs** | New `GET`/`PUT /api/customers/people/{id}/email-share` **and `PUT /api/communication_channels/channels/{id}/visibility`** (owner-only, 404-masked, optimistic-locked; mirrors `set-primary`). Existing routes unchanged; the 404 masking on the per-message route is preserved verbatim. | Additive. |
| **8. DB schema** | One new table + three indexes (`customer_email_conversation_shares`), **plus two additive columns**: `communication_channels.visibility` (`NOT NULL DEFAULT 'private'`, with the same-migration `UPDATE … WHERE user_id IS NULL`) and `customer_interactions.channel_id` (nullable, backfilled, with a partial index). Both are additive column adds; no existing column is altered or dropped, and no `visibility` value on `customer_interactions` is ever rewritten. | Additive. |
| **10. ACL feature IDs** | **New** `customers.email.share_conversation` **and `communication_channels.share_own_channel`** (owner-scoped by construction — the write derives the owner from the actor, so the wildcard grant admins hold is not an escalation), granted to `admin` (via the existing `customers.*` wildcard) and added explicitly to `employee` in `defaultRoleFeatures`, then synced with `yarn mercato auth sync-role-acls`. `customers.email.view_private` and `communication_channels.admin` stay **inert**. | Additive. |
| **6. Widget spot IDs** | `EmailCardWidgetData` gains optional `sharedVia`. `currentVisibility` semantics unchanged. | Additive. |
| 1, 4, 9, 11, 12, 13 | Auto-discovery, import paths, DI keys, notification ids, CLI, generated files — no change beyond `yarn generate`. | n/a |

## 📝 Phasing

- **Phase 1 — Consolidate enforcement.** No behaviour change; makes the widening safe. Steps 1–3.
- **Phase 2 — Share model and write path.** Steps 4–8.
- **Phase 3 — Read widening.** Steps 9–11.
- **Phase 4 — UI and i18n.** Steps 12–13.
- **Phase 5 — Tests and gate.** Steps 14–16.

## 📝 Implementation Plan

- [ ] **Step 1 — Fix the filter-fragment contract.** Change `buildEmailVisibilityMikroFilter` to return `FilterQuery<CustomerInteraction>` (keep `EmailVisibilityMikroFilter` as a `@deprecated` alias). Convert `personEmailThreads.ts:157`, `api/people/[id]/route.ts:598`, `api/companies/[id]/route.ts:484` to `Object.assign`-style merging (`activities/route.ts:311` already does). Add a unit test in `lib/__tests__/visibilityFilter.test.ts` asserting a non-`$or` arm survives every caller's merge.
- [ ] **Step 2 — Consolidate the write-side default.** Route the inline `channelUserId ? 'private' : 'shared'` at `link-channel-message-handler.ts:339` and `:418` through `resolveVisibility()`. No behaviour change; assert parity with a unit test.
- [ ] **Step 3 — Move both bypassing read paths onto the shared predicate.** Refactor `privateEmailCountEnricher` (raw kysely, lines 272–275) to use `applyEmailVisibilityFilter`, and `interactionEmailCardEnricher` (line 437) to use a shared `isEmailHiddenFrom(...)` helper extracted into `lib/visibilityFilter.ts`. Verify the private-email count is unchanged for existing fixtures.
- [ ] **Step 4 — Add the `CustomerEmailConversationShare` entity** to `customers/data/entities.ts` per § Data Model, with `updated_at` (`onCreate`+`onUpdate`) and `deleted_at`.
- [ ] **Step 5 — Author the migration.** `CREATE TABLE` + the three indexes in `customers/migrations/`; update `migrations/.snapshot-open-mercato.json` in the same commit. Run `yarn db:generate` afterwards as a no-op check (expected: `no changes` for `customers`). Do **not** run `yarn db:migrate`.
- [ ] **Step 6 — Declare the ACL feature and event.** Add `customers.email.share_conversation` to `acl.ts`; add it to `setup.ts` `defaultRoleFeatures` for `employee` (admin already covered by `customers.*`). Add `customers.email.conversation_visibility_changed` to `events.ts` with `clientBroadcast: true`. Leave both reserved features inert. Run `yarn generate`.
- [ ] **Step 7 — Add the share service.** `lib/conversationShares.ts`: `listSharesForPerson`, `listSharesForViewer` (capped at `SHARE_ARM_MAX = 500`, logging truncation), `canViewerSharePerson`. Register in `di.ts`. Tenant/org scoping is mandatory on every query.
- [ ] **Step 8 — Add the commands and the API route.** Undoable `customers.email_conversation_share.set` command emitting the new event and invalidating `customers.interaction` cache tags. Route `api/people/[id]/email-share/route.ts` with `GET`/`PUT` per § API Contracts: owner-only by construction, mutation-guard registry wired (operation `update`), optimistic locking, 404 masking, `openApi` export.
- [ ] **Step 9 — Widen the shared predicates.** Add optional `sharedConversations: Array<{ personEntityId: string; ownerUserId: string }>` to `ApplyEmailVisibilityFilterOptions`; emit the extra nested-`$or` / `eb.or` arm matching `(entity_id, author_user_id)`. Absent ⇒ byte-identical to today (fail closed).
- [ ] **Step 10 — Wire the share lookup into every read path.** `personEmailThreads.ts`, `api/people/[id]/route.ts`, `api/companies/[id]/route.ts`, `api/activities/route.ts`, `api/interactions/route.ts`, `api/interactions/counts/route.ts`, and both enrichers. Person-scoped paths pass the single relevant tuple; unscoped paths use `listSharesForViewer`.
- [x] **Step 11 — SUPERSEDED.** Originally: add `sharedVia` / `sharedByUserName` to the `/email-threads` payload and `sharedVia` to `EmailCardWidgetData`. **Delivered differently:** the teammate-facing "Shared by {name}" affordance reads from the dedicated `GET /email-share` response (`sharedBy[]`, with resolved user names) instead. Same user-visible outcome, two fewer frozen contract surfaces touched. Neither identifier exists in the shipped code, and § API Contracts / § Integration Test Coverage no longer assert them. A per-message `sharedVia` provenance badge remains a genuinely additive follow-up.
- [ ] **Step 12 — Build the Emails-tab control.** Share switch + confirm dialog (`Cmd/Ctrl+Enter` / `Escape`), "Shared by {name}" badge with semantic status tokens, `useGuardedMutation` + `surfaceRecordConflict`. No hardcoded strings, no arbitrary Tailwind values.
- [ ] **Step 13 — Add i18n keys** under `customers.email.conversationShare.*` to all five locale files (`en`, `pl`, `de`, `es`, `ko`). Run `yarn i18n:check-sync` and `yarn i18n:check-usage`.
- [ ] **Step 14 — Unit tests.** Extend `lib/__tests__/visibilityFilter.test.ts`: kysely and MikroORM predicates agree on a shared row matrix (with and without shares); a non-`$or` arm survives; the v1 owner-only filter still ignores caller features including `customers.*` and `*` (asserts R3).
- [ ] **Step 15 — Integration tests** (ship in the same PR per `.ai/qa/AGENTS.md`), extending the `TC-CRM-EMAIL-VISIBILITY-*` family with self-contained API fixtures and teardown: owner shares → teammate sees history; owner un-shares → teammate loses it; teammate cannot share (404 masking preserved); admin gets no bypass without an explicit grant; a threading-inherited reply on a shared conversation is visible (covers R6); the private-email count reflects the widened rule (R2); Emails tab and `/interactions` timeline agree (R1).
- [ ] **Step 16 — Run the full validation gate** in `.ai/agentic.config.json` order and fix fallout: `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.

## 📝 Integration Test Coverage

| Path | Scenario |
|---|---|
| `PUT /api/customers/people/{id}/email-share` | Owner shares (201/200, idempotent on repeat); non-owner with no private conversation → 400; cross-tenant Person → 404; stale `updatedAt` → 409. |
| `GET /api/customers/people/{id}/email-share` | `canShare` true for owner, false for teammate; `sharedBy` populated for teammate after a share. |
| `GET /api/customers/people/{id}/email-threads` | Teammate sees owner's history only while the share is live; `sharedVia: 'conversation'` set. |
| `GET /api/customers/people/{id}?include=interactions` | Same widening as the Emails tab (R1 agreement). |
| `GET /api/customers/interactions` + `/interactions/counts` | Unscoped list and count honour the share. |
| `GET /api/customers/activities` | Deprecated surface honours the share. |
| Person page private-email count | Drops to 0 for a teammate once the conversation is shared (R2). |
| Inbound ingestion | Reply threaded onto a shared conversation is visible to the teammate without a new share (R6). |
| `PUT /api/communication_channels/channels/{id}/visibility` | Owner flips their own channel (200, idempotent on repeat); non-owner refused (404/403); admin holding `communication_channels.admin` refused; tenant-scoped channel refused; stale `updatedAt` → 409. |
| Channel share, retroactive + reversible (`TC-CRM-EMAIL-VISIBILITY-004`) | Teammate gains mail sent BEFORE the flip on both `/email-threads` and `/interactions`; loses it on revert; owner keeps their own throughout. |
| **Two-mailbox leak canary** (`-004`) | One owner, two private mailboxes, only one shared: the sibling stays hidden on both surfaces and the private-email count lands on **1, not 0**. This is the case an author-keyed predicate would leak. |
| UI (Playwright) | Owner toggles the switch, confirms the dialog, teammate reloads and reads the thread with the "Shared by" badge; owner toggles off and the teammate's view empties. |

## 📝 Prior Specs Reviewed

| Spec | Relevance |
|---|---|
| [`2026-05-21-email-integration-foundation.md`](2026-05-21-email-integration-foundation.md) § *Per-user privacy & visibility model (v1 — strict owner-only)* | Authoritative record of the current model and of the deferred "v2 oversight" capability. This spec is **not** that oversight feature: it is owner-initiated sharing, not manager-initiated inspection. Both reserved features stay inert precisely so the two do not merge. |
| [`implemented/2026-05-27-crm-email-integration.md`](implemented/2026-05-27-crm-email-integration.md) | Shipped the per-email `visibility` column, the filters, the PATCH route and the Emails tab. This spec extends those filters; it must not fork them. |
| [`implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md`](implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md) | Owns thread identity and the threading-inheritance path covered by Step 2 / R6. |
| [`enterprise/2026-07-08-gdpr-data-erasure.md`](enterprise/2026-07-08-gdpr-data-erasure.md) | GDPR surface; reconciled in § Risks R5, with a post-implementation follow-up. |

## 📝 Changelog

| 2026-08-28 | **Q1 and Q3 reopened and re-decided** after review of PR open-mercato#5756. Q1's original "no channel column" rested on a workaround that does not exist for email (tenant-wide connect is push-only), so the channel flag is in scope; its R8 hazard is mitigated by the same-migration `UPDATE … WHERE user_id IS NULL` rather than avoided. Q3 keeps `(person, owner)` for the conversation grant but accepts the `channel_id` denormalisation for the channel flag, because both mailboxes of one owner share an `author_user_id`. § Data Model, § API Contracts, § Migration & BC (surfaces 5, 7, 8, 10) and § Integration Test Coverage updated; Step 11 marked superseded. |

| Date | Change |
|---|---|
| 2026-08-25 | Skeleton drafted with the Q1–Q4 Open Questions gate (`om-spec-writing`). |
| 2026-08-25 | Readiness audit completed — 2 Critical / 6 Warning BC findings, 5 High risks ([`analysis/ANALYSIS-…`](analysis/ANALYSIS-2026-08-25-crm-channel-shared-visibility.md)). |
| 2026-08-25 | Gate closed (Q1–Q4 decided from the implementation brief + audit safety findings); all deferred sections filled; 16-step Implementation Plan added. Ready for implementation. |
</content>
