# Pre-Implementation Analysis: CRM Channel & Conversation Shared Visibility

**Spec:** [`.ai/specs/2026-08-25-crm-channel-shared-visibility.md`](../2026-08-25-crm-channel-shared-visibility.md)
**Analysed:** 2026-08-25
**Analyst:** pre-implement readiness audit (`om-pre-implement-spec`)
**Verified against:** working tree at `cez/a5ac18fb` (branch `fork/crm-they-dev` lineage)

---

## Executive Summary

The spec is an intentional **skeleton with an unresolved Open Questions gate**, so it is not implementable as written — nine of the twelve required sections are explicitly deferred, and the two headline design choices (Q2 retroactivity, Q3 conversation unit) determine the entire data model. That is the expected state for this stage and is not itself a defect.

What the audit adds is that **the gate as currently phrased is under-specified against the actual codebase**. Three findings would silently produce a privacy regression regardless of which gate answers are chosen: (1) the per-email visibility rule is enforced in **five** places, only three of which go through the shared helper in `lib/visibilityFilter.ts` — the other two hard-code `visibility = 'private'` in raw SQL/JS and will disagree with any widened rule; (2) `buildEmailVisibilityMikroFilter` returns `{ $or }` and **every caller spreads only `.$or`**, so any predicate that cannot be expressed as a single `$or` arm is dropped at compile-clean call sites and the filter **fails open**; (3) `customers.email.view_private` and `communication_channels.admin` are already granted to `admin`/`superadmin` on every existing tenant (the former via the `customers.*` wildcard in `setup.ts`), so answering Q4 by "wiring the reserved feature" retroactively exposes every private email in every tenant on deploy, with no separate opt-in.

Separately, Q2(a) ("read-time derivation") is materially more expensive than the spec assumes: **there is no channel id on `customer_interactions` and none on `message_channel_links` either**. Deriving a channel from an interaction is a four-table hop. The gate should say so.

**Recommendation: Needs spec updates first.** Do not start implementation. Close the gate with the four questions re-scoped per § Remediation, then fill the deferred sections; the BC and risk material below is ready to be pasted into the spec's Migration and Risks sections once the shape is chosen.

---

## Backward Compatibility

### Violations Found

Audited against all 13 contract-surface categories in [`BACKWARD_COMPATIBILITY.md`](../../../BACKWARD_COMPATIBILITY.md). Because the spec defers its implementation plan, these are assessed against the **stated direction** in § Proposed Solution plus what each gate answer necessarily entails.

| # | Surface | Issue | Severity | Proposed fix |
|---|---------|-------|----------|--------------|
| 1 | **2. Types / 3. Function signatures** | `buildEmailVisibilityMikroFilter` returns `EmailVisibilityMikroFilter = { $or?: FilterQuery[] }` (`customers/lib/visibilityFilter.ts:141`). Both callers consume **only the `$or` key** — `personEmailThreads.ts:157` (`interactionWhere.$or = build(...).$or`) and `api/people/[id]/route.ts:599`. If the widened rule needs an `$and`, a `$not`, or a subquery arm, adding it to the return type **compiles cleanly and is silently discarded by every caller**, so private rows leak. This is a fail-**open** shape change. | **Critical** | Do not widen the return type. Either (a) change the contract to a single opaque `FilterQuery` fragment merged with `Object.assign`, updating both callers in the same commit and adding a unit test that asserts a non-`$or` arm survives; or (b) keep the predicate expressible as one `$or` by denormalising the channel decision onto `customer_interactions` (see #5). Option (b) is preferred — it keeps the existing 6 call sites untouched. |
| 2 | **10. ACL feature IDs** | `customers.email.view_private` is declared inert (`customers/acl.ts`) but `setup.ts:85` grants `admin: ['customers.*']` — a wildcard that already matches it, and `authorizeFeatures` is wildcard-aware. `communication_channels.admin` is likewise granted explicitly to `superadmin` **and** `admin` (`communication_channels/setup.ts:54-73`). Answering Q4 "yes, admins may flip" by activating either reserved feature **retroactively grants it to every existing admin on every tenant** with no migration and no opt-in. | **Critical** | Never wire the reserved features as the Q4 mechanism. If admin escalation is wanted, mint a **new** feature id (e.g. `customers.email.share_conversation.admin`), grant it to **no** role in `defaultRoleFeatures`, and require an explicit operator grant. Also note in the spec that any new `customers.*` feature is auto-granted to `admin` by the existing wildcard, so a genuinely restricted capability must be namespaced outside `customers.*` or explicitly denied. |
| 3 | **8. Database schema** | § Proposed Solution wants `CommunicationChannel.visibility` defaulting to `private` for `user_id`-scoped rows and `shared` for tenant-wide rows. A plain `DEFAULT 'private'` column addition makes **every existing tenant-wide channel private on deploy** (WhatsApp Business, Slack workspaces, FCM/APNs push channels) — an availability regression, not just a privacy one. | **Warning** | Single migration: `ADD COLUMN visibility text NOT NULL DEFAULT 'private'` followed by `UPDATE communication_channels SET visibility = 'shared' WHERE user_id IS NULL` in the same migration, plus the module snapshot update in the same commit. Per lesson [duplicate-migration-creation-causes-initialize-failures](../../lessons/duplicate-migration-creation-causes-initialize-failures.md), check `communication_channels/migrations/` for overlapping DDL first, and per `packages/core/AGENTS.md` § Entity Schema, keep only this module's generated SQL and update `migrations/.snapshot-open-mercato.json`. |
| 4 | **5. Event IDs** | The spec's audit trail would naturally reuse `customers.email.visibility_changed` (`customers/events.ts:84`). Its payload today carries a required `interactionId` plus `previousVisibility`/`nextVisibility`/`authorUserId`/`actorUserId`/`adminBypass` (emitted at `api/interactions/[id]/visibility/route.ts:147`). A channel-level or conversation-level flip has no single `interactionId`; emitting `null` there removes a field existing consumers read. | **Warning** | Mint new additive event ids rather than overloading: `communication_channels.channel.visibility_changed` and `customers.email.conversation_visibility_changed`. New ids are free under category 5 (`MAY add new event IDs freely`); mutating an existing payload is not. Both are `clientBroadcast: true` candidates to match the existing SSE refresh behaviour. |
| 5 | **8. Database schema (Q2-dependent)** | Q2(a) read-time derivation assumes an interaction can name its channel. It cannot: `customer_interactions` carries only `channel_provider_key` and `external_message_id` (`customers/data/entities.ts:670` region), and **`message_channel_links` has no `channel_id` column either** (`communication_channels/data/entities.ts:279-329`). The chain is `customer_interactions.external_message_id → message_channel_links.id → .external_conversation_id → external_conversations.channel_id → communication_channels.id` — a four-table join on **every** email read. | **Warning** | Add a denormalised, additive `customer_interactions.channel_id uuid null` written by `link-channel-message-handler.ts` (which already resolves the channel at line 99-108), backfilled once via the join above. This keeps the read predicate a single `$or` arm (resolving #1 option (b)) and preserves the existing covering index shape. State the backfill as an explicit implementation step. |
| 6 | **2. Types** | `BuildPersonEmailThreadsOptions` (`lib/personEmailThreads.ts:53`) and `ApplyEmailVisibilityFilterOptions` (`lib/visibilityFilter.ts:52`) are consumed by 6 call sites plus tests. Adding a **required** field (e.g. `sharedChannelIds`) narrows them. | **Warning** | Add only optional fields with a fail-closed default (absent ⇒ today's strict owner-only behaviour), matching the precedent set by `userFeatures` on the same types. |
| 7 | **6. Widget injection spot IDs** | The private/shared toggle is rendered from `EmailCardWidgetData` (`components/detail/EmailCardActions.tsx:19-33`), whose `currentVisibility`/`isAuthor` are produced by `interactionEmailCardEnricher`. Category 6 freezes the data type passed at an existing spot. | **Warning** | Extend `EmailCardWidgetData` with **optional** fields only (e.g. `sharedVia?: 'message' \| 'conversation' \| 'channel'`). Do not repurpose `currentVisibility`'s meaning — a teammate reading a channel-shared email must not be shown a control that 404s. |
| 8 | **7. API route URLs** | New routes are additive and fine. The one hazard: `PATCH /api/customers/interactions/[id]/visibility` returns **404, not 403**, for non-authors, deliberately masking row existence (`route.ts:83-86`). Channel-level sharing makes a row *readable* by a teammate while still not *flippable*. | Warning | Preserve the 404 masking verbatim for the per-message route, and give the conversation/channel toggle its own route with its own owner gate. Add an explicit spec line stating the masking is intentional so a later reviewer does not "fix" it to 403. |
| 9 | 1, 4, 9, 11, 12, 13, 14 | Auto-discovery conventions, import paths, DI keys, notification type ids, AI agent/tool ids, CLI commands, generated-file contracts — **no violation identified**. New subscribers/events/ACL entries are additive and only require `yarn generate`. Verified specifically that the customers AI tool pack cannot leak email: `activities-tasks-pack.ts:267` pins `interactionType: 'task'`, and the people/companies packs read through `GET /api/customers/people/[id]?include=interactions`, which applies the visibility filter at `route.ts:599`. | ✓ n/a | — |

### Missing BC Section

**Confirmed missing.** The spec has no *Migration & Backward Compatibility* section. `BACKWARD_COMPATIBILITY.md` § Deprecation Protocol step 5 makes this mandatory for any PR touching a contract surface, and this change touches at minimum categories 2, 3, 5, 8 and 10. Rows #1–#8 above are drafted so they can be pasted in directly once the gate closes.

---

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|----------------|
| Problem Statement | Present only as a bullet sketch under a `*(to be written after the gate)*` marker | Promote the four evidence bullets into prose; they are already accurate and verified. |
| Proposed Solution | Deferred — depends on Q2/Q3 | Blocked on the gate. |
| Architecture / design decisions | Absent | Must name the interaction→channel resolution strategy (finding #5) and the filter-shape decision (finding #1) as explicit ADR-style choices. |
| Data Models | Absent | `CommunicationChannel.visibility` enum + values; the conversation-level row (new table vs. column) implied by Q3; the `customer_interactions.channel_id` denormalisation. |
| API Contracts | Absent | At least: channel visibility PATCH, conversation visibility PATCH, and the added response fields on `GET /api/communication_channels/me/channels` and `GET /api/customers/people/[id]/email-threads`. |
| UI/UX | Absent | Where the channel toggle lives (profile channels list) vs. the conversation toggle (Emails tab thread header); the confirm dialog; the teammate-facing "shared by <owner>" affordance. |
| Edge Cases & Failure Scenarios | Absent | See § Gap Analysis. |
| Risks & Impact Review | Absent | Populate from § Risk Assessment below. |
| Phasing | Absent | Blocked on Q1 (one spec vs. two). |
| Implementation Plan | Absent | Blocked on the gate. |
| **Integration Test Coverage** | **Absent** | Required by root `AGENTS.md` § Documentation and Specifications and `.ai/qa/AGENTS.md`: every affected API path and key UI path must be enumerated **and the tests must ship in the same change**. Existing precedent to extend: `TC-CRM-EMAIL-VISIBILITY-001` (filter) and `-002` (`/email-threads`) in `customers/__integration__/`. |
| Final Compliance Report | Absent | Run the spec-writing compliance gate before the spec is marked ready. |
| Changelog | Absent | Required by `.ai/specs/AGENTS.md` § Spec Content Checklist. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|----------------|
| Open Questions Q2 | Options (a)/(b)/(c) are presented as an even trade. They are not: (a) is a four-table join because no channel id exists on either `customer_interactions` or `message_channel_links` (finding #5), and (b) is **irreversible** — once rows are rewritten to `shared`, un-sharing cannot distinguish channel-shared from individually-shared rows, which the spec notes but does not weight as a privacy one-way door. | Restate Q2 with the join cost and the irreversibility called out, and add the hybrid the codebase actually favours: **denormalise `channel_id`, derive at read time from a single indexed column**. That gets (a)'s reversibility at (b)'s read cost. |
| Open Questions Q4 | Asks whether an admin may flip, without noting that both candidate features are **already granted** on every tenant (finding #2). Answering "yes" is therefore not a new grant but a retroactive tenant-wide unlock. | Restate Q4 to make the blast radius explicit, and offer the safe mechanism (new, ungranted feature id). |
| § Existing Architecture table | Accurate as far as it goes, and every row was verified. But it omits the two read paths that **do not** use the shared filter (see Risk R2) — which is exactly the information the design needs. | Add rows for `data/enrichers.ts` → `privateEmailCountEnricher` and `interactionEmailCardEnricher`. |
| § Prior Specs Reviewed | Good. All four referenced specs exist at the stated paths (verified). | No change. |

---

## AGENTS.md Compliance

Most compliance checks are **unassessable** — the spec proposes no code, no route signatures, no `className` snippets, and no UI mocks, so there is nothing to score against the Design System rules, the CRUD-factory rules, or the `apiCall`/`CrudForm` rules. That is a completeness finding, not a compliance finding. The following are assessable now:

| Rule | Location | Fix |
|------|----------|-----|
| Root `AGENTS.md` § Documentation and Specifications — "for every new feature, the spec MUST list integration coverage for all affected API paths and key UI paths" | Spec § "Sections deferred" | Not optional at spec-completion time. Enumerate the scenarios (see § Remediation). |
| `.ai/specs/AGENTS.md` § Spec Content Checklist — "Risks must document concrete failure scenarios, severity, affected area, mitigation, and residual risk" | Deferred | Populate from § Risk Assessment. |
| `packages/core/AGENTS.md` § ACL Grant Sync — new `acl.ts` features must be mirrored into `setup.ts` `defaultRoleFeatures` and synced with `yarn mercato auth sync-role-acls` | Not yet specified | Add an explicit implementation step. Note the deliberate exception for finding #2: an admin-escalation feature is granted to **no** role by design, and the spec must say so or a later contributor will "fix" the omission. |
| `packages/core/AGENTS.md` § Command Side Effects — writes go through commands with `indexer: { entityType, cacheAliases }` | Not yet specified | `customers:customer_interaction` is query-indexed (`api/interactions/route.ts:89`). Any Q2(b) backfill that writes rows with raw SQL leaves `entity_indexes` stale — see lesson [projection-updates-that-change-indexed-parent-fields](../../lessons/projection-updates-that-change-indexed-parent-fields.md). Spec must state the reindex path. |
| Root `AGENTS.md` § Always — optimistic locking is default ON for user-editable entities | Not yet specified | `CommunicationChannel` already has `updated_at` (`[OptionalProps]` includes `updatedAt`). The channel visibility flip is a single-field action endpoint, so it may follow the documented exemption the per-message toggle already uses (`EmailCardActions.tsx` carries an explicit `optimistic-lock-exempt` rationale comment). Whichever is chosen, state it — and reuse that comment style. |
| Root `AGENTS.md` § UI & HTTP — dialogs need `Cmd/Ctrl+Enter` submit and `Escape` cancel; no hardcoded user-facing strings | Not yet specified | Sharing a mailbox is a privacy-consequential action and should carry a confirm dialog. Plan the i18n keys (`customers.email.visibility.*` and `communication_channels.visibility.*` already have sibling keys to follow). |
| `.ai/lessons.md` scan | Done | Matched and read: [feature-gated-runtime-helpers-must-use-wildcard-aware](../../lessons/feature-gated-runtime-helpers-must-use-wildcard-aware.md) (directly relevant to finding #2), [projection-updates-that-change-indexed-parent-fields](../../lessons/projection-updates-that-change-indexed-parent-fields.md), [duplicate-migration-creation-causes-initialize-failures](../../lessons/duplicate-migration-creation-causes-initialize-failures.md), [cross-module-query-precedent-is-not-permission-to-copy](../../lessons/cross-module-query-precedent-is-not-permission-to-copy.md) (relevant: the customers module already reaches into hub tables by string class name — do not extend that coupling further without a DI service). |

> **Note on skill inputs:** the skill's step 5 asks for `.agents/skills/om-code-review/references/review-checklist.md`. That file does not exist in this repository — `.ai/skills/om-code-review/` is a repo-local override containing only `SKILL.md`, and `.agents/skills/` is not present in this checkout at all. The checklist step was therefore satisfied from `om-code-review/SKILL.md` plus the package `AGENTS.md` rules.

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **R1 — Fail-open filter regression.** The visibility rule is enforced at five sites. Widening it at three (the shared helpers) and missing two produces inconsistent results across UI surfaces, with the inconsistency biased toward **over**-exposure on some paths and stale hiding on others. | A teammate sees a thread on the Emails tab but not the timeline, or vice versa. Worst case, a private email becomes readable on a path that was widened without an owner check. | Enumerate all five in the spec and require every one to route through a single helper: `lib/visibilityFilter.ts` (kysely + MikroORM), `data/enrichers.ts:privateEmailCountEnricher`, `data/enrichers.ts:interactionEmailCardEnricher`, and the write gate `canChangeEmailVisibility`. Add a unit test asserting the kysely and MikroORM predicates agree on a shared matrix of rows — the existing `lib/__tests__/visibilityFilter.test.ts` is the place. |
| **R2 — Two read paths bypass the shared helper entirely.** `privateEmailCountEnricher` (`data/enrichers.ts:223`) hard-codes `.where('visibility','=','private').where('author_user_id','!=',userId)` in raw kysely. `interactionEmailCardEnricher` (`data/enrichers.ts:~109`) independently strips the card when `visibility === 'private' && !isAuthor`. Neither imports `visibilityFilter.ts`. | Under channel-level sharing the Person page tells a teammate "3 private emails" for emails they can now actually read, and the reply/forward actions are stripped from emails they are entitled to act on. Both are user-visible wrong-state bugs, not just cosmetics. | Refactor both to consume the shared predicate before widening anything. This is a prerequisite step, not a follow-up. |
| **R3 — Reserved ACL features are already granted.** See BC finding #2. | Activating `customers.email.view_private` exposes every private email in every tenant to every admin the moment `sync-role-acls` runs — with no migration, no notice, and no per-tenant opt-in. Directly contradicts the v1 model that three separate code comments describe as "no admin bypass". | Mint a new, ungranted feature id for any admin capability. Add a spec assertion that neither reserved feature is activated by this work, and a test that asserts the v1 owner-only filter still ignores caller features. |
| **R4 — Un-sharing is a one-way door under Q2(b).** Rewriting rows to `shared` destroys the distinction between "owner shared this message deliberately" and "the channel flip shared it". | An owner who flips a channel to shared and immediately regrets it cannot restore the prior state; per-message decisions made before the flip are lost. Irreversible privacy loss with no undo. | Prefer read-time derivation off a denormalised `channel_id` (finding #5), which makes un-sharing instant and lossless. If Q2(b) is chosen anyway, require a snapshot table capturing pre-flip per-row visibility so the flip is undoable via the command pattern. |
| **R5 — GDPR surface.** Widening readership of personal-mailbox content changes who is a recipient of personal data the tenant processes. | The spec's own § Prior Specs flags [`enterprise/2026-07-08-gdpr-data-erasure.md`](../enterprise/2026-07-08-gdpr-data-erasure.md) as relevant but defers the reconciliation. Erasure and access-request scopes derived from "who can see this" change when channel sharing lands. | The Risks section must reconcile explicitly: does a shared conversation change the erasure scope, and is the sharing act itself auditable (it should be — hence the new event ids in finding #4)? |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **R6 — Query-index staleness.** `customers:customer_interaction` is indexed. The existing per-message PATCH deliberately routes through `customers.interactions.update` "instead of a raw em.flush() that would leave the indexed `entity_indexes` doc stale" (`visibility/route.ts:111-115`). A bulk backfill must honour the same rule. | Grid/search filters return rows the API no longer returns, or vice versa, until a manual reindex. | Backfill through the command path or emit `query_index.upsert_one` per affected record; state which in the implementation plan. |
| **R7 — Person-detail cache is tagged on customers resources only.** `buildPersonDetailCacheTags` invalidates on `customers.person/address/tagAssignment/labelAssignment/personCompanyLink/interaction/activity` (`api/people/[id]/route.ts:73-81`). A channel-level flip writes to `communication_channels` — **nothing in that tag set**. | With `ENABLE_CRUD_API_CACHE` on, a teammate keeps seeing the pre-flip (hidden) view until TTL, even though the flip succeeded. The cache key *is* per-caller (`caller=` at line 99), so this is a staleness bug, not a cross-user leak. | The flip's write path must invalidate the `customers.interaction` collection tags for the affected tenant/org, or the spec must state that channel sharing is only reflected after TTL and justify it. |
| **R8 — Migration default flips tenant-wide channels private.** BC finding #3. | Shared WhatsApp/Slack/push channels lose their shared status on deploy. | Data-migration `UPDATE` in the same migration file. |
| **R9 — Three write sites hard-code the default.** `link-channel-message-handler.ts` computes visibility at line 197 via `resolveVisibility()`, but **also** at line 339 and line 418 with an inline `channelUserId ? 'private' : 'shared'` — both inside `handleThreadingInheritance`, bypassing the helper. | A channel-level default threaded only through `resolveVisibility()` silently does not apply to threading-inherited messages (replies from unknown addresses), so a shared channel still ingests some mail as private. | Consolidate all three onto `resolveVisibility()` before adding the channel dimension, and cover the threading-inheritance path in the integration tests (`TC-CRM-EMAIL-005` already exercises it). |
| **R10 — Read-path cost under Q2(a) without denormalisation.** The covering index `customer_interactions_email_visibility_idx` is `(entity_id, interaction_type, visibility, author_user_id) WHERE interaction_type='email' AND deleted_at IS NULL` (`data/entities.ts:564`). A four-table join predicate cannot use it. | Every email list, timeline, count and Person-page load regresses; the counts route and the enricher run per-page. | Denormalise `channel_id` (finding #5) and extend the partial index to include it. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **R11 — Cross-module coupling growth.** The customers module already reads `MessageChannelLink`, `Message` and `CommunicationChannel` by **string class name** to dodge the no-cross-module-ORM rule (`personEmailThreads.ts:10-17`, `link-channel-message-handler.ts:71-77`). Channel visibility adds a fourth such read. | Per lesson [cross-module-query-precedent-is-not-permission-to-copy](../../lessons/cross-module-query-precedent-is-not-permission-to-copy.md), existing precedent is coupling to retire, not a pattern to extend. | Denormalising `channel_id` + a `visibility` snapshot onto `customer_interactions` (the sanctioned FK-id + snapshot mechanism in `packages/core/AGENTS.md` § Cross-Module Coupling) removes the need for a fourth string-name read rather than adding one. |
| **R12 — No notification for the shared/un-shared transition.** | A teammate has no signal that a conversation was handed to them; an owner has no signal that their channel is now team-visible. | Optional, but cheap: `notifications.ts` types are additive and free under category 11. Decide deliberately rather than by omission. |
| **R13 — DS/i18n/keyboard compliance unbudgeted.** | New badge, toggle and confirm dialog need semantic status tokens, `useT()` keys and `Cmd/Ctrl+Enter`/`Escape` handling. | Budget it in the phasing; follow `.ai/ds-rules.md`. Existing `EmailCardActions.tsx` is a clean local precedent. |

---

## Gap Analysis

### Critical Gaps (block implementation)

- **The Open Questions gate (Q1–Q4) is unanswered.** Q2 and Q3 determine the data model; nothing below the gate can be written first.
- **Interaction → channel resolution is unspecified and non-trivial.** No `channel_id` on `customer_interactions`; none on `message_channel_links` either. The spec must pick: denormalise, or accept a four-table join. Recommend denormalise.
- **The complete inventory of enforcement points is missing.** Five read/write sites (R1/R2). A spec that names three of five will ship a half-widened rule.
- **Un-share semantics are undefined.** Q4 asks the question but the answer needs a data model (snapshot table vs. derivation), not just a yes/no.
- **Migration & Backward Compatibility section is absent** while the change touches BC categories 2, 3, 5, 8 and 10.

### Important Gaps (should address)

- **Integration test coverage list** — required to ship in the same change. Minimum scenarios: owner flips channel → teammate sees history / does not, per Q2; owner flips back → teammate loses access; teammate cannot flip (404 masking preserved); admin cannot flip unless explicitly granted; threading-inherited reply on a shared channel is shared (R9); private-email count reflects the widened rule (R2); Emails tab and `/interactions` timeline agree (R1).
- **Cache invalidation strategy** for the person-detail cache (R7).
- **Query-index refresh path** for any backfill (R6).
- **Audit events** — new event ids and their payloads (BC #4).
- **Error handling** — what a flip returns when the channel is mid-disconnect, when the caller lost `connect_user_channel` since connecting, and when the channel is tenant-wide (flip should be rejected or no-op).
- **Undo/redo behaviour** — `packages/core/AGENTS.md` requires domain writes via commands; the flip is a domain write and should be undoable.
- **ACL definitions** — the new feature ids and their `dependsOn` chain, plus the deliberate no-grant decision (R3).
- **i18n key plan** for both modules.

### Nice-to-Have Gaps

- Notification on share/un-share (R12).
- A CLI backfill command if Q2(b) is chosen.
- Whether an org-level or role-level policy can forbid channel sharing outright (an enterprise concern; worth a forward-compatibility note so the column is not modelled as a bare boolean).
- Search index (`search.ts`) — verify whether email interaction bodies reach `search_tokens`; if so, widened visibility has a search surface too.

---

## Remediation Plan

### Before Implementation (must do)

1. **Close the gate**, with Q2 and Q4 re-scoped. Q2 should present the denormalised-`channel_id` + read-time-derivation hybrid as a fourth option and state the four-table-join cost of plain (a). Q4 should state that both candidate features are already granted tenant-wide.
2. **Add the Migration & Backward Compatibility section** using BC findings #1–#8.
3. **Enumerate all five enforcement points** in the spec's architecture section, and make "consolidate them onto one helper" an explicit Phase 1 step that ships **before** any widening.
4. **Decide the filter-fragment contract** (BC #1) — this is the single highest-risk technical decision in the change, because getting it wrong fails open at compile-clean call sites.
5. **Fill Data Models, API Contracts, UI/UX, Edge Cases, Risks, Phasing, Implementation Plan, Integration Test Coverage, Compliance Report and Changelog.**

### During Implementation (add to spec as steps)

1. Consolidate the three hard-coded `channelUserId ? 'private' : 'shared'` sites onto `resolveVisibility()` (R9).
2. Refactor `privateEmailCountEnricher` and `interactionEmailCardEnricher` onto the shared predicate (R2).
3. Add `customer_interactions.channel_id` + backfill + extended partial index (BC #5, R10).
4. Add `communication_channels.visibility` with the `UPDATE ... WHERE user_id IS NULL` data migration and the snapshot update (BC #3).
5. Mint new event ids and new ACL feature ids; grant the admin-escalation feature to no role (BC #2, #4).
6. Wire cache invalidation for the person-detail tags (R7) and the query-index refresh (R6).
7. Ship the integration tests in the same PR, extending the `TC-CRM-EMAIL-VISIBILITY-*` family.

### Post-Implementation (follow up)

1. Reconcile with [`enterprise/2026-07-08-gdpr-data-erasure.md`](../enterprise/2026-07-08-gdpr-data-erasure.md) — does a shared conversation widen the erasure/access-request scope? (R5)
2. Retire the string-class-name cross-module reads in `personEmailThreads.ts` / `link-channel-message-handler.ts` behind a DI service owned by `communication_channels` (R11, per the matching lesson).
3. Revisit the deferred v2 admin-oversight capability — this spec deliberately is **not** it, and the distinction should be re-asserted in [`2026-05-21-email-integration-foundation.md`](../2026-05-21-email-integration-foundation.md) once channel sharing exists, so the two do not silently merge.

---

## Recommendation

**Needs spec updates first.** The skeleton is well-researched and its § Existing Architecture table checks out against the code line by line — that is genuinely good groundwork. But two Critical BC findings (the fail-open filter fragment, and the already-granted reserved ACL features) would each produce a privacy regression under *any* gate answer, and the Q2(a) option as written is materially more expensive than the spec presents because no channel id exists anywhere on the interaction→link chain. Close the gate with those three facts on the table, add the Migration & Backward Compatibility and Integration Test Coverage sections, then re-run this audit against the completed spec before implementation starts.
