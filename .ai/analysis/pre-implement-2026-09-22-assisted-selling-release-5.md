# 🔍 Pre-implementation analysis: Assisted Selling (rev 6), Release 5 scope

**Readiness: no-go.** If the module were built as the spec is written now, three things would go wrong. The three encrypted fields would be stored in plaintext twice over: §5.7's entity ids match nothing, and no backfill reaches existing tenants. And every subscriber would take its tenant scope from a field in the event payload, which a "Never" rule in `packages/events/AGENTS.md` forbids. The fixes are small spec edits; the design itself holds.

Spec: `.ai/specs/2026-09-22-assisted-selling.md` rev 6 (with changelog 6.1/6.2) · audited 2026-11-19 against `BACKWARD_COMPATIBILITY.md` · template: `.ai/specs/AGENTS.md` "Spec Content Checklist" plus the built-in set (no spec template file exists; `2026-11-04-create-app-template-flag.md` is a feature spec, not a template).
Scope: the §11 "Release 5" block, i.e. Phase 1 (`mode` `rep | off`, no AI entities), Phase 2 items 1, 2 (server side), 3 and 5, and Phase 4, together with §5, §6, §7, §8 and §10. Phase 2 item 4, Phase 3 and Phase 5 are out of scope.
Grounded in: current `main` (`5d93cbd8bf`, where the module is absent) and the reference implementation `refs/remotes/pr/8268` (`bdb747c36a`; 114 new files under `packages/core/src/modules/assisted_selling/`).

**Next action:** revise the spec with the `om-spec-writing` skill (C1–C3, plus the "Before implementation" items below). After that, the AS1… steps can start, with the "During implementation" items added to each step's card.

## ⛔ Blocking before implementation

1. **C1. The §5.7 encryption entity ids are wrong.** `assisted_selling:message`, `:participant` and `:proposal` resolve to nothing, because the generator derives ids from the full class name. Replace them with `assisted_selling:assisted_selling_message`, `…_participant` and `…_proposal`. See [Completeness](#-spec-completeness) and [Spec vs. reference](#-spec-vs-reference-implementation).
2. **C2. No encryption-map backfill migration is specified** (#8893, and the encryption rule in `packages/core/AGENTS.md:529`). Add it to §5.7 and to Phase 1 item 1. See [Compliance](#-repo-rule-compliance).
3. **C3. Subscribers take their scope from the payload**, against `packages/events/AGENTS.md:22,126-129`. §5.1, §5.10, §6.6 and §6.7 must take the scope from the trusted subscriber context and use the payload fields (D-R5-32) only as a cross-check. See [Compliance](#-repo-rule-compliance).

## ⚠️ Decisions for the spec owner

| # | Question | Recommended answer | Trade-off |
|---|---|---|---|
| D1 | Who grants `employee` the `cart.proposals.view` feature that `GET /threads/:id` requires? Today §6.9 grants `employee` three `assisted_selling` features, and cart §10 (`2026-08-14-cart-module.md` "setup.ts grants are unchanged") keeps `cart.proposals.*` away from `employee`. As specified, an employee can list conversations but cannot open one (#8405, QA-High). The reference grants the feature from `assisted_selling/setup.ts:19-22`. | Keep the reference: `assisted_selling` grants `employee` `cart.proposals.view`. State this in §6.9 and add one line to cart §10. | A module grants another module's feature. The alternative is that cart's setup grants it, which widens cart's least-privilege line for a feature `employee` needs only here. |
| D2 | Which component owns `live_proposal_count`? §5.4 (l.386) says the §6.6 subscriber is the only writer, and §5.1 (l.290) says "the proposal commands and the subscriber". The reference has the withdraw and supersede commands decrement synchronously and the subscriber skip `rejectedBy: 'author'` (`commands/proposals.ts:170,618-627`; `lib/terminalStateSubscriber.ts:41-72`). It was hardened through four review rounds (R1, R2, R27, R28) with a two-connection PG test. | Adopt the reference rule in §5.4/§6.4/§10.3: author-initiated endings decrement inside their own published→terminal conditional update, and the subscriber decrements only for buyer rejection, acceptance and expiry. | The reference is proven. Keeping the spec's rule means rewriting the hardest-reviewed code in the module. |
| D3 | When `rateLimiterService` is absent, what do the buyer reads do? The reference fails closed only on the two buyer writes (503) and lets `GET /thread` and `GET /thread/events` through (`lib/rateLimit.ts:91,134,151`). The owner decided fail-closed 503 for the checkout pay-link routes. | Fail closed on all four buyer routes, for consistency with the 2026-11-19 decision, and add the `503` to §6.2/§6.10. | A deployment without a limiter cannot read conversations at all, instead of reading them unthrottled. |
| D4 | Ship the settings admin page in Release 5? §7 (l.774) and Phase 1 item 2 name one; the reference never built it (no `backend/assisted-selling/settings/`). Without it a store can be switched to `rep` only with `PUT /api/assisted_selling/settings/:storeId`. | Build it in AS7 as specified: `CrudForm`, `mode` `rep`/`off`, TTL, max lines, retention, idle-close. | Otherwise, defer it explicitly in §11 and accept an API-only enablement for Release 5. |
| D5 | Order of re-author steps (§6.4 l.623). The spec creates the successor and then rejects the old cart. The reference rejects first and then authors, and when authoring fails it marks the old row `withdrawn` (`commands/proposals.ts:761-799`), so the buyer is left with no proposal. The reference also re-authors on a closed thread (`:696-706`), although §6.3 step 1 requires `open`. | Write the reference's saga into §6.4: replay lookup, CAS on the old row, reject, author, link atomically, clean up on a lost CAS. Also say explicitly whether a closed thread may be re-authored (recommended: no, except the §8.1 merge path). | Reject-first never leaves two live offers. Its cost is a window in which the buyer has none. |
| D6 | Participant uniqueness for guests. `(thread_id, actor_type, actor_id)` treats NULL ids as distinct, so a thread can hold several guest-buyer rows (`data/entities.ts:198-202`). | Use `NULLS NOT DISTINCT` (see D7), or have the buyer-thread command enforce one guest participant, and state which in §5.2. | — |
| D7 | `NULLS NOT DISTINCT` (Postgres 15 or later) is used by the reference's attribution indexes (`data/entities.ts:464-485`). | Confirm that the platform's Postgres floor is 15 or later, then specify these indexes in §5.5. | If the floor is lower, the indexes need partial-index pairs. |
| D8 | §11a Q4, the retention period (365 days from `closed_at`; idle-close after 30 days). It is in Release 5 scope and still open, with a default. | Confirm the defaults (they are per-store settings, so a merchant can change them) and close Q4. | It is a legal choice, not a mechanism, so it does not block. |
| D9 | §5.10 cites `communication_channels/subscribers/user-deleted-cascade.ts` as the precedent for erasure on staff deletion. That precedent reads `payload.userId` on `main` (`:40-55`), but `auth.user.deleted` is emitted as `{ id, organizationId, tenantId }` (`auth/commands/users.ts:214-223`). | Remove the citation and specify the payload field (`id`). File the `communication_channels` bug separately. | — |

## 📋 Readiness gate

| # | Item | Result | Evidence / fix |
|---|---|---|---|
| R1 | Declared status | ✅ | "Specification (rev 6 — Release 5 spec revision)". The repo defines no status vocabulary (no template; `SDLC.md` has none), and the value is not Draft/Proposed/WIP. Nice-to-have: an explicit `Approved` status once C1–C3 are fixed. |
| R2 | No blocking open questions | ✅ | Q1 and Q2 are closed. Q3 belongs to Phase 3, which is out of scope. Q4 is open with a default and is listed as D8. There are no `⚠ NEEDS HUMAN CONFIRMATION` entries. |
| R3 | Traceability | ✅ | §10.1–§10.5 give an oracle for every Release 5 route and for the console path. The gaps are listed under Gaps: scheduling, the staff-erasure payload and the attribution split. |
| R4 | Contracts defined | ✅ (Important gaps) | Routes, codes (§6.10), events and ACL are present. Missing: the `POST /thread` new-thread status and body; the `POST /threads` opening-message field; the five cart DI reads the module consumes (I10); the `503` on buyer routes (D3); `proposal_already_resolved` and `store_required`. |
| R5 | Phases are deliverable | ✅ (Important gap I14) | Phases declare their dependencies (the §11 hard dependencies) and gates. For a one-PR-per-step re-land, the spec does not say how a step stays inert while S6/S7 (buyer routes and erasure) have not landed yet. |
| R6 | Grounded in the codebase | ❌ | **C1**: the §5.7 entity ids do not match the generator (`packages/cli/src/lib/generators/entity-ids.ts` `toSnake(className)`; the reference documents this at `encryption.ts:7-17` and guards it in `__tests__/encryption.test.ts:20-41`). Lesser mis-descriptions, all Important: "the helper loads that user's ACL fresh" (§8.1 l.820), which the reference helper does not do (I7); "inside the same atomic flush" across two cart commands, which is impossible (I3); and the cart read "the same read `GET /api/cart/carts/:id` serves", which is in fact the DI method `cartService.getForOrganizations` (I10). |

## 💥 Backward compatibility

The module is new and every surface it adds is additive. Things to watch on the surfaces it consumes or freezes:

| # | Surface (BC doc) | Phase/step | Change | Severity | Migration path |
|---|---|---|---|---|---|
| B1 | §9 DI Service Names, "MAY add **optional** methods" | Phase 1 items 3–4, Phase 2 item 1, Phase 4 (CA10a/b) | The reference adds five **required** members to `CartService` (`cart/lib/cartService.ts:198-226` at the ref): `getForOrganizations`, `getProposalCartLines`, `resolveBasketByToken`, `getProposalCartPricedLines`, `getAttributionLines`. §9 already forced `resolveForBuyer` to become optional (review R1→R6, `2efd2b45b8`). The spec names only `resolveBasketByToken` and a vague "cart's DI read". | Warning | Declare them optional (`?`) in the cart spec. `assisted_selling` calls them as optional and fails closed (404/503), the same way it treats `resolveForBuyer?`. List all five in §6 as consumed contracts. |
| B2 | §4 Import Paths (STABLE once shipped) | Phase 1 item 7 (F1) | The spec and cart rev 10 say `@open-mercato/shared/lib/commands/trustedContext`. The reference ships `…/trusted-context` with another signature (`{ actorType, actorId }` → `{ ctx, auditMetadata }`). Whichever path ships first is frozen. | Warning | Settle the path and signature in X10 (roadmap/cart §3.1a) before F1 lands, and make the AS, cart and checkout specs match. |
| B3 | §5 Event IDs | Phase 1 | Twelve new `assisted_selling.*` ids. `.reopened` was dropped before it ever shipped, which is fine. `cart.proposal.acceptance_undone` stays declared in `cart/events.ts:31` and is never emitted (D-R5-25); that is cart's concern, and no id is removed. | OK | Frozen on ship. |
| B4 | §7 API routes, §10 ACL ids, §8 schema | All | New `/api/assisted_selling/*` routes, six feature ids and six tables, all additive. | OK | Frozen on ship. Correct C1 before the first migration and encryption map land. |
| B5 | §2 Types (`SubscriberContext.container`, `WorkerJobContainer.register`, F2) | Phase 1 item 7 | The re-author subscriber needs the real container (#8427). These are additive types, and they are missing from `UPGRADE_NOTES.md` at the ref. | Warning | F2 documents them in `UPGRADE_NOTES.md`. |

The spec has no "Migration & Backward Compatibility" section; §12's BC row covers it. That is **Warning**-level: the changes elsewhere are additive and are documented by their owners, but B1 and B2 belong in such a section.

## 📝 Spec completeness

| Section | Missing / incomplete | Impact | What to add |
|---|---|---|---|
| §5.7 Encryption | Wrong entity ids (**C1**, Critical); no backfill (**C2**) | All three fields stored in plaintext | The corrected ids, and a `buildEncryptionMapBackfillSql` migration with an empty `down()` (pattern: `ai_assistant/migrations/Migration20261026192929_ai_assistant.ts:32`, `checkout/migrations/Migration20261109120000.ts`) |
| §5.10 Sweepers | No registration, cadence, failure policy or upgrade path | Existing tenants get no schedule (#8822); a scheduler failure aborts other modules' `seedDefaults` (#8462); organizations created later get none | `@open-mercato/scheduler` registration from `seedDefaults` (best-effort, never throws, like `cart/setup.ts:29`); hourly idle-close and daily retention; upgrade action `assisted_selling.register-schedules` with an `UPGRADE_NOTES.md` line; registration on organization creation; names matching the code (`assisted_selling.idle_close` / `.retention`) |
| §5.4, §5.5 Data model | Columns, nullability and indexes differ from the reference (see the Spec vs. reference table) | Snapshot drift when the migration is generated | `response_snapshot`, NOT NULL `published_at`, nullable `cart_line_id`, append-only attributions, attribution unique and degraded indexes |
| §5.6 Settings | Bounds only for the TTL | `max_proposal_lines` can exceed cart's 1–100 batch cap (cart §7a create contract), so the setting cannot be honoured | `max_proposal_lines` 1–100, `conversation_retention_days` 1–3650, `idle_close_days` 1–365 |
| §6 Consumed contracts | The five cart DI reads, the `resolveBasketByToken(token, scope)` signature, host-derived store scope | Each step invents its own cart seam | A "Consumed contracts" table (B1) |
| §6.7 Attribution | Pro-rata split of mixed lines | Commission rows that the spec cannot predict | The reference rule: split a merged line by proposal-contributed quantity in fixed point, give the buyer the remainder and give the rounding remainder to the last share; data comes from `cartService.getAttributionLines` |
| Migration & BC | No dedicated section | See B1/B2 | A short section |

## 🔍 Repo-rule compliance

| Rule (source) | Spec location | Fix | Severity |
|---|---|---|---|
| "A deployed module also needs a `buildEncryptionMapBackfillSql` migration … else existing tenants stay plaintext" (`packages/core/AGENTS.md:529`). Maps are seeded only at tenant creation (`shared/lib/encryption/migration-backfill.ts:3-6`). | §5.7, §11 Phase 1 item 1, §12 Encryption row | **C2**: add the backfill migration for the three maps to Phase 1 item 1 and a §10 case ("an existing tenant's message body is ciphertext after upgrade"). The reference has none (#8893, closed on `main` by #9064 for checkout's older entities only). | **Critical** |
| "Never rely on payload-provided tenant or organization scope when trusted scope is available"; subscriber-context scope comes from `emit(..., options)` (`packages/events/AGENTS.md:22,126-129`) | §5.1 l.302, §5.10 l.503, §6.6 l.678, §6.7 l.700, R11 | **C3**: resolve from the subscriber context's trusted `tenantId`/`organizationId`, require the payload fields (D-R5-32) to match, and log and ignore on mismatch or absence. The reference reads the payload first and falls back to the context (`lib/terminalStateSubscriber.ts:75-76` and every other handler), so it must change when ported. | **Critical** |
| Wildcard-aware checks scoped to the record (`core` → Access Control; lesson `feature-gated-runtime-helpers-must-use-wildcard-aware`) | §6.1 (S21) | The spec is right. The reference's `requireAssistedSellingFeatures` passes `organizationId: null` (`commands/shared.ts:37`); it must pass the thread's organization when ported. | Important |
| Command pattern with `withAtomicFlush` (root AGENTS, §6 intro) | §6.1 settings | The reference's settings save uses a bare `em.flush()` (`commands/settings.ts:128-145`); port it with `withAtomicFlush`. | Important |
| A catch that records an error must also `reportError` (root Task Router, logging) | §6.7 degraded emit | The reference loses `assisted_selling.attribution.degraded` when the emit fails after flush, because redelivery is guarded by the row count (`lib/attribution.ts:224,342-352`). Emit through an outbox, or make the guard tolerate the case. | Important |
| Never hard-code user-facing strings (root AGENTS) | §5.10 "Former team member"; participant fallbacks | The reference stores "Former team member", "Rep", "Customer" and "Guest" as literals (`lib/retention.ts:73-74`, `lib/participants.ts:25,81`). Store a neutral marker, or resolve the label at read time through i18n. | Important |
| No `any` (root AGENTS, Code Quality) | §6.2 events route | `{ fields: [...] as any }` (`api/storefront/thread/events/route.ts:79`); remove it when porting. | Nice-to-have |
| Use canonical components (root AGENTS, UI; `.ai/ui-backend-components.md`) | §7.1 | The spec names `EmailThreadsPanel`, `MessageComposer`, `CrudForm` for the builder, `SectionHeader` and `RecordNotFoundState`. The reference hand-builds the timeline and composer, uses a custom `Dialog` because "`CrudForm` has no array field" (`ProposalBuilderDialog.tsx:25-29`), and uses a raw `<h1>`. Either amend §7.1, using the builder exception, or port onto the named families. | Important |

## ⚠️ Risks

| Risk | Level | Impact | Mitigation |
|---|---|---|---|
| Plaintext personal data for every existing tenant (C1+C2) | High | GDPR: message bodies, rep names and rejection reasons stored unencrypted | C1 and C2; a §10 case reading the raw row on a tenant created **before** the migration |
| A superseded proposal stays acceptable (I3) | High | The buyer accepts an offer the platform has already retracted (§6.4 calls this "the sharpest version" of the failure). The reference's merge supersede commits `superseded` and then rejects the cart in a separate command; if the reject fails, redelivery skips the row because it is no longer `published` (`lib/reauthorOnMerge.ts:84-129`; same order at `commands/proposals.ts:911-941`). | Reject the cart first, or make the local transition resumable: an idempotent "superseded but cart still active" repair on redelivery and in a sweep. Add a test that fails the reject after the local commit. |
| Staff erasure never runs (I6) | High | `auth.user.deleted` carries `id`, and the reference reads `userId` (`lib/erasureSubscribers.ts:122`), so a departed rep's name stays shown to buyers. The unit test feeds `{ userId }`, so it passes. | Read `id`, scope by tenant only (a rep works across organizations), and test with the real emitter's payload. |
| Step-by-step re-land ships text storage before erasure and buyer reads (I14) | Medium | The plan's order (AS2a before AS6 and AS5) puts the staff open plus opening message on `main` first, which is exactly what S6/S7 forbid. | Keep every store at `mode: 'off'`, and have the settings validator refuse `rep` until AS5 and AS6 have landed; or state that a single release tag carries AS1–AS6. |
| Re-author audit marker lost (I7) | Medium | §8.1/§10.4 require a system-initiated audit entry. The reference discards `auditMetadata` (`lib/reauthorOnMerge.ts:112,356`) and calls `performAuthorProposal` directly, not through the command bus (`commands/proposals.ts:889`), so no command audit entry exists at all. | Run re-author through the command bus with the helper's metadata, and assert the marker in §10.4. |
| Rate limits weaker than specified (I8) | Medium | One combined `ip:sha256(token)` key (`lib/rateLimit.ts:98-102`) bounds neither one token from many IPs nor many tokens from one IP. With `trustProxyDepth=0` only the token digest applies. | Two buckets, per IP and per token, as §6.2 says; document the null-IP behaviour (#9398); D3. |
| Store settings written to the wrong organization (I4) | Medium | `PUT /settings/:storeId` writes under the caller's *selected* organization and never checks the store (`api/settings/[storeId]/route.ts:72-111`). If the rep's selected org is not the store's, authoring (which reads by the thread's org, inherited from the basket) sees `off`; any UUID gets a row. | §5.6/§6.1: settings belong to the store's organization, the store is resolved through `ecommerce` (soft, `tryResolve`), and the route answers 404 outside the caller's organizations. |
| Postgres concurrency suites not run by CI | Medium | Review history 2.14: suites named or gated wrongly were never selected. | AS2b adds `assisted_selling` to the `test:pg-integration` regex; check `jest --listTests` |
| Cross-module coupling in the merge subscriber | Low | The reference imports `auth`'s `User` entity and the `RbacService` type directly (`lib/reauthorOnMerge.ts:7-9`). | Use the DI services only (`module-decoupling.test.ts`). |
| `instanceof CrudHttpError` across bundles | Low | `commands/proposals.ts:360` | Use `isCrudHttpError`, as the routes already do. |

## 🔍 Gaps

- **Critical**: C1, C2, C3 (above).
- **Important**
  - **I1**: the employee grant (D1).
  - **I2**: counter ownership (D2).
  - **I3**: §6.4's "invoke `cart.proposal.reject` in the same command, inside the same atomic flush" and §6.3's "the other's transaction — including the proposal cart `cart.proposal.create` created inside it — rolls back" cannot hold: each cart command commits its own transaction. Specify the compensation design the reference uses instead (`rejectProposalCartBestEffort`, the withdraw CAS, link/discard helpers; `commands/proposals.ts:122-275,447-465,603-651`), and the supersede-ordering fix from Risks.
  - **I4**: settings ownership and validation (Risks).
  - **I5**: sweeper scheduling (Completeness).
  - **I6**: erasure.
    - Staff deletion: the payload field (`id`) and organization rule (D9).
    - Basket purge: erase **every** thread on the basket, not only the first one found. The reference uses `findOne` (`lib/erasureSubscribers.ts:57`), so closed threads survive.
  - **I7**: X10 helper contract (B2).
    - The ACL is reloaded by the caller, not the helper: the reference checks the user and both features in the target org explicitly (`lib/reauthorOnMerge.ts:235-265`). §8.1 must say so.
    - The audit marker must reach the log (Risks).
    - The reason string is `assisted_selling.reauthor_on_merge` here but `assisted_selling.reauthor` in cart rev 10 §7a. Pick one.
  - **I8**: buyer rate limits (D3, Risks).
  - **I9**: system messages. §5.1/§8.1 require a system message on the supersede fallback and in both threads on a collision. The reference posts none; it emits `thread.closed` with `reason: 'merge_collision'` (`lib/reauthorOnMerge.ts:191-218,385-399`). Either keep the spec rule and port the messages, or relax it. Recommended: keep it, because the buyer otherwise sees a proposal vanish unexplained.
  - **I10**: consumed cart DI reads (B1). In particular, `POST /threads` reads through `cartService.getForOrganizations` (`commands/threads.ts:105-111`), not `GET /api/cart/carts/:id`. A proposal-kind cart id answers `404`, not `409 cart_not_active`.
  - **I11**: console gaps against §7 and §10.5. These are reference changes for AS7 unless the owner trims §7.
    - No settings page (D4).
    - No basket summary: nothing calls `/api/cart/carts/:id`.
    - Inbox: store filter is a raw UUID field, the assignee filter has no named rep, and sort parameters are ignored by the API.
    - Provenance is a truncated raw `price_row_id`, and currency falls back to a hard-coded `'USD'` (`threads/[id]/page.tsx:510-528`).
    - Builder: variant is a free-text UUID with no configuration field (#8418); no client-side `max_proposal_lines` check; `rejectedLines` appear only as a count; a silent product-lookup failure (#9322).
    - Raw values and "Rep — Rep" (#8420, #9323).
    - Join and Leave are both always shown (#8422), Leave always claims success, and the assignee is never shown (#9391 item 5).
    - Withdraw sends no `updatedAt` because the detail payload lacks it (`api/threads/[id]/route.ts:94-108`), so §6.10's withdraw lock is dead code.
    - Attribution report filters are order, quote and proposal UUIDs instead of §6.1's actor, store and outcome.
  - **I12**: the message route. It accepts a post into a `closed` thread and silently creates a rep participant with no mode check and no `participant.joined` (`commands/messages.ts:22-66`). A lost participant race answers 500 in both the message and the authoring command (#9359, open). §6.1 should state that a closed thread is read-only and that posting requires a joined participant.
  - **I13**: attribution data model and semantics (Completeness and D7). Also: a `lineMap` that does not cover every line degrades the whole conversion (`lib/attribution.ts:49-72`), and a payload with neither an order id nor a quote id is skipped silently, with no `degraded` event (`:211-215`).
  - **I14**: step-level inertness for the re-land (Risks).
  - **I15**: the `/thread/events` semantics.
    - The reference never answers `200 changed: false`; "unchanged" is always a `304` (`events/route.ts:86`).
    - `proposalIds` is filtered by `updatedAt > since`, not by status change.
    - An unparseable `since` returns everything.
    - The thread cursor is stamped by DB `now()` while proposals use the app clock, so clock skew can drop ids (`lib/liveProposalCount.ts:15-21`).
    - Fix: §6.2 should define `changed: true` on every `200`, and one clock source (DB) for the cursor and `proposalIds`.
  - **I16**: missing contract details.
    - `POST /thread` answers `201 { ok, result: { threadId, status, alreadyOpen } }` for a new thread and `200` for an existing one.
    - The `POST /threads` opening message is the optional field `message`; without it the reference still writes an empty message row (`commands/threads.ts:183`). Recommended: no row without a message.
    - Codes missing from §6.10: `409 proposal_already_resolved` (`commands/proposals.ts:587-593`), `400 store_required`, and buyer `409 assisted_selling_unavailable` for a basket without a store.
- **Nice-to-have**
  - §6.3 step 4 says `422 proposal_has_no_lines`; §6.10, §10.2, cart §15a and the reference all say `proposal_empty`.
  - §4.2 and §5.7 cite "§6.3 step 6" for the proposal message, which is step 7.
  - The `EmailThreadsPanel` citation is `:85-87`, not `:70-75`.
  - The JSON field is `bodyFormat`, not `body_format`.
  - The adopted subscriber writes null over the identity columns when the payload lacks them (`lib/cartAdoptedIdentityMigration.ts:91-92`).
  - Line `quantity` accepts `0` and negative values (`data/validators.ts:44`).
  - `expiresAt` is recomputed locally instead of read from the cart (`commands/proposals.ts:410`).
  - Two queries lack a tenant predicate: the `User` lookup (`lib/participants.ts:50`) and the counter update (`lib/liveProposalCount.ts:16-22`).
  - Assign emits no event, so other consoles do not refresh. Add `assisted_selling.thread.assigned`, or accept.
  - `thread.closed` carries an undocumented `reason`.
  - `index.ts` declares `requires: ['cart']`, which the spec does not mention.
  - M1–M3 have no `down()`.
  - No injection spots on the conversation page (#8421, feature request).

## 🔀 Spec vs. reference implementation

Reference paths are under `packages/core/src/modules/assisted_selling/` at `bdb747c36a`. Classification: **(a)** spec should change · **(b)** reference must change when ported · **(c)** owner decision.

| # | Spec | Reference | Disagreement | Class |
|---|---|---|---|---|
| 1 | §5.7 l.441-446 | `encryption.ts:18-31` | Entity ids `assisted_selling:message` vs `assisted_selling:assisted_selling_message`; the spec's ids match nothing (C1) | (a) |
| 2 | §5.7, §11 P1.1 | migrations M1–M4 | No encryption backfill in either (C2, #8893) | (a)+(b) |
| 3 | §5.1 l.302, §6.6 l.678, §6.7 l.700, §5.10 l.503 | `lib/terminalStateSubscriber.ts:75-76` and all handlers | Payload-first scope; must be trusted context first (C3) | (a)+(b) |
| 4 | §6.9 l.739 | `setup.ts:19-22` | Reference also grants `employee` `cart.proposals.view` (#8405) | (c) D1 |
| 5 | §5.4 l.386, §6.4 l.619, §10.3 l.981 | `commands/proposals.ts:170,240,270,618-627`; `lib/terminalStateSubscriber.ts:41-72` | Counter decremented by the commands, not the subscriber | (c) D2 → (a) |
| 6 | §6.3 l.599, §6.4 l.619 | `commands/proposals.ts:122-275,447-465,603-651` | "Same atomic flush" / "rolls back the proposal cart": the reference compensates instead, which is the only possible approach (I3) | (a) |
| 7 | §6.4 l.619-621 | `lib/reauthorOnMerge.ts:84-129`; `commands/proposals.ts:911-941` | Supersede commits locally before rejecting the cart; a failed reject leaves an acceptable cart that is never retried | (b) |
| 8 | §6.4 l.623, §6.3 step 1 | `commands/proposals.ts:696-706,761-799` | Reauthor rejects first, withdraws the old row on failure, and accepts a closed thread | (c) D5 |
| 9 | §6.10 | `commands/proposals.ts:587-593,643-649,766-772` | `409 proposal_already_resolved` not in spec | (a) |
| 10 | §6.3 step 4 l.609 | `api/threads/[id]/proposals/route.ts:144` | `proposal_has_no_lines` vs `proposal_empty` | (a) |
| 11 | §5.4 l.349-366 | `data/entities.ts:405-406`, M2:22 | Extra `response_snapshot` jsonb (idempotent replay body) | (a) |
| 12 | §5.4 l.358 | `data/entities.ts:377-378` | `published_at` NOT NULL, not nullable | (a) |
| 13 | §5.5 l.400, l.408 | `data/entities.ts:464-485,522-523`; M3, M4 | Unique keys include `proposal_id` with `NULLS NOT DISTINCT`; extra degraded unique index plus dedupe migration (`bb0873db17`); `cart_line_id` nullable; no `updated_at`/`deleted_at` | (a) + (c) D7 |
| 14 | §6.7 l.694-696 | `lib/attribution.ts:134-187` | Pro-rata split of mixed lines through `getAttributionLines`, not "actor straight off the line" plus a module-side `CartMergeLog.outcome` join | (a) |
| 15 | §6.7 l.704 | `lib/attribution.ts:49-72,211-215,342-352` | Partial `lineMap` degrades the whole cart; no-id payload skipped silently; degraded emit lost on failure | (a)+(b) |
| 16 | §5.6 | `data/validators.ts:23-26,85` | Bounds `maxProposalLines` 1–500 (the request caps lines at 100), retention 1–3650, idle 1–365 are unspecified | (a), and (b) cap at 100 |
| 17 | §6.1 l.536, §5.6 | `api/settings/[storeId]/route.ts:64-111`; `commands/settings.ts:99-145` | No store lookup or 404; row written under the caller's selected org; bare `em.flush()`; unhandled errors answer 400 | (b) + (a) for the ownership rule |
| 18 | §7 l.774, §11 P1.2 | no `backend/assisted-selling/settings/` | Settings page never built | (c) D4 |
| 19 | §5.10 l.497-505 | `setup.ts:30-32`, `lib/scheduling.ts:86-143`, `configs/lib/upgrade-actions.ts:302-314` | Scheduling unspecified in spec; reference throws `AggregateError` out of `seedDefaults` (#8462) and covers neither later organizations nor any spec text | (a)+(b) |
| 20 | §5.10 l.497-498 | `workers/idle-close.worker.ts:19-20`, `workers/retention.worker.ts:17-18` | Names `assisted-selling-idle-close` vs `assisted_selling.idle_close` / `assisted_selling:idle-close` | (a) |
| 21 | §5.10 l.500-501 | `lib/erasureSubscribers.ts:57,122-135` | Staff erasure reads `userId` (no-op) and filters by home org; basket purge erases one thread | (b), (a) precedent D9 |
| 22 | §5.10 | `lib/retention.ts:29-42,73-74` | Erase is not one transaction (retry-safe); hard-coded label | (b) minor |
| 23 | §8.1 l.820 | `lib/reauthorOnMerge.ts:5,112,235-265,356,361`; `shared/lib/commands/trusted-context.ts:67-102` at the ref | Path `trusted-context` vs `trustedContext`; signature differs; the helper loads no ACL (the caller does); audit metadata discarded; re-author bypasses the command bus | (a) path/ACL wording + (b) audit |
| 24 | §5.1 l.298, §8.1 l.824,830 | `lib/reauthorOnMerge.ts:191-218,385-399` | No system messages on fallback or collision; event only | (b) (I9) |
| 25 | cart §7a l.593 (author-side reject needs `cart.proposals.author`) | `lib/reauthorOnMerge.ts:112-117` | Supersede rejects under `actorType: 'system'`, `auth: null` | (a)+(b): name the principal |
| 26 | §6.2 l.553,568,584 | `lib/rateLimit.ts:44-60,91,98-102,134-151` | One combined key, not per IP and per token; reads fail open; null-IP fallback undocumented | (b) + (c) D3 + (a) |
| 27 | §6.2 l.555 | `lib/buyerIdentity.ts:43-56,76-87` | Host-derived tenant, org and store, a store-match check, and 404 when `ecommerce` is absent: stricter than the spec, so the spec should adopt it | (a) |
| 28 | §6.2 l.572-582 | `api/storefront/thread/events/route.ts:76-86`; `lib/liveProposalCount.ts:15-21` | `changed` always true; `proposalIds` by `updatedAt`; mixed clocks; `as any` | (a)+(b) (I15) |
| 29 | §6.2 table | `api/storefront/thread/route.ts:122-124,189` | `201` vs `200` and body shape; storeless basket → `409` | (a) |
| 30 | §6.1 l.543, §6.10 | `commands/threads.ts:105-122,183` | DI `getForOrganizations` read; proposal-kind cart → 404, not `cart_not_active`; local `cart_not_active`; `store_required`; empty opening message row | (a), and (b) for the empty row |
| 31 | §6.1 (S21) | `commands/shared.ts:37` | `userHasAllFeatures(..., { organizationId: null })` | (b) |
| 32 | §6.1 messages | `commands/messages.ts:22-94` | Posts into a closed thread; implicit join without mode check or event; #9359 race → 500 | (b) |
| 33 | §6.1 assign | `commands/shared.ts:79-96` | Without a version, the lock is skipped (last write wins); no assign event | (c): require the header? (recommended yes) |
| 34 | §6.10 withdraw lock | `api/threads/[id]/route.ts:94-108`; `threads/[id]/page.tsx:351-356` | Proposals carry no `updatedAt`; console sends `{}` | (b) |
| 35 | §7 inbox l.770 | `backend/assisted-selling/page.tsx:131-136,214-261` | UUID store filter, no named-rep filter, raw UUID cells, ignored sort | (b) |
| 36 | §7 thread page l.771, §7.1 | `threads/[id]/page.tsx` | No basket summary; hand-built timeline and composer instead of `EmailThreadsPanel`/`MessageComposer`; no `SectionHeader`/`RecordNotFoundState` | (b), or (a) if trimmed |
| 37 | §7.2 provenance l.801 | `threads/[id]/page.tsx:510-528` | Gross only, a tooltip label, truncated raw `price_row_id`, raw quantity, `'USD'` fallback (#9323) | (b) |
| 38 | §7.1 builder l.789 | `ProposalBuilderDialog.tsx:25-29,76-88,186-192,239-250` | Custom dialog, not `CrudForm`; UUID variant and no configuration (#8418); silent lookup failure (#9322); no line-cap check; `rejectedLines` shown as a count | (a) for the dialog, (b) for the rest |
| 39 | §7 attribution report, §6.1 l.535 | `api/attributions/route.ts:28-38`; `attributions/page.tsx:158-161` | Filters are proposal, thread, cart, order, quote and date, not actor, store and outcome | (b), or (a) |
| 40 | §10.5 | `threads/[id]/page.tsx:282-296,427-455` | Join and Leave both shown (#8422); Leave always succeeds (#9391-5); "Rep — Rep" (#8420) | (b) |
| 41 | §5.2 l.316 | `data/entities.ts:198-202` | Unique index does not constrain guest rows | (c) D6 |
| 42 | §5.10 l.497, §6.8 | `lib/sweepers.ts:140`, `lib/reauthorOnMerge.ts:204` | `thread.closed` carries an undocumented `reason` | (a) |
| 43 | §11 P1.1 | `index.ts:18-19` | `requires: ['cart']`, `ejectable: true` | (a) minor |
| 44 | cart §7a l.551 | `lib/reauthorOnMerge.ts:361` | Reason `assisted_selling.reauthor` (cart) vs `assisted_selling.reauthor_on_merge` (AS spec and reference) | (a) cross-spec |

Spec and reference agree on everything else: every staff and buyer route path and method under `/api/assisted_selling/`, with the declared features and `openApi`; `pageSize` ≤ 100; 404 outside organization scope; mutation guards on every custom write; idempotency (lookup first, digest, `409`/`200` replay); `resolveForBuyer` with `storeId` failing closed with `503`; `ttlSeconds`; `rejectedLines`; the note as message body; the `X-Cart-Token`-only credential and the identified-buyer binding on all four buyer routes before any thread lookup; ETag/`304`; the terminal subscriber's conditional claim; the `kind = 'basket'` merge filter, re-point and idempotency key; the idle predicate repeated in the update; the twelve event ids with `clientBroadcast`; the six ACL ids; no AI tables; registration enabled in the app and commented out in the template.

## ✅ Release 5 analysis findings S1–S25: what rev 6 resolves

| Finding | Resolved in rev 6? | Where / residual |
|---|---|---|
| S1 `resolveForBuyer` contract | Yes | §6.3 step 2, §11 dependency, SPEC-029; optional member per the 2026-11-19 decision |
| S2 identified-buyer binding | Yes | §6.2, §8.12, R8 (D-R5-13, D-R5-21) |
| S3 event scope | Yes, with residual | §5.1, §6.6, R11 (D-R5-32). Residual: **C3**, scope must come from the trusted context |
| S4 route prefix | Yes | §6 intro and every path |
| S5 `ttlSeconds` | Yes | §5.6, §6.3 step 3 |
| S6 buyer routes ship with Phase 1 | Yes | §6.1 l.543, §11. Residual: I14 (step order of the re-land) |
| S7 retention with the first text route | Yes, with residual | §5.10 l.505, §11. Residual: I5 scheduling, I6 erasure defects |
| S8 header-only token | Yes | §6.2, R8 |
| S9 organization-scoped staff open | Yes, with residual | §5.1 l.294, §6.1 l.541. Residual: I10 (names an HTTP read; the actual read is DI `getForOrganizations`) |
| S10 `mode` `rep \| off` | Yes | §5.6, §6.10, §10.1 |
| S11 re-author principal | Yes | §8.1, R13, Q1 closed (D-R5-14). Residual: I7 (helper path, ACL wording, audit marker) |
| S12 defer mode exposure | Yes | §5.6 l.435 |
| S13 rejected lines | Yes, with residual | §6.3 step 4. Residual: code-name inconsistency (Nice) |
| S14 no promotion codes | Yes | §6.3 step 3, §10.2 |
| S15 proposal sweeper branches | Yes (cart-owned) | §10.3 "Sweepers" |
| S16 API-driven testing | Yes | §10 intro, §10.5 |
| S17 stale references | Yes | Header, R1, §10 |
| S18 attribution with `lineMap` | Yes, with residual | §6.7, Phase 4 (D-R5-16, D-R5-26). Residual: I13 (split rule, indexes) |
| S19 note storage | Yes | §5.3, §5.7, §6.3 step 7 |
| S20 registration and `sync-role-acls` | Yes, with residual | §6.9, §11 P1.1 (D-R5-36). Residual: D1 grant |
| S21 wildcard-aware RBAC | Yes (spec) | §6.1; reference residual #31 |
| S22 pricing-identity test | Yes | §10.2 |
| S23 idempotency | Yes, with residual | §5.4, §6.3. Residual: I3 (a rollback across cart commands is impossible), `response_snapshot` |
| S24 `text` only | Yes | §5.3, §6.1, §6.2 |
| S25 `/thread/events` server contract | Yes, with residual | §6.2. Residual: I15 semantics |

All 25 are addressed in the text. Eleven carry a residual (S3, S6, S7, S9, S11, S13, S18, S20, S21, S23, S25); S21's residual is in the reference only. None of the eleven re-opens a decision.

## 📋 Remediation plan

1. **Before implementation (spec edits)**
   - Fix C1, C2 and C3.
   - Take decisions D1, D2, D4 and D7. D3, D5, D6, D8 and D9 can wait until their step.
   - Add the "Consumed contracts" table with optional cart members (B1), and settle the X10 path and signature in the cart and roadmap specs (B2).
   - Rewrite §6.3/§6.4 around compensation (I3).
   - Define settings ownership by the store's organization (I4).
   - Add sweeper scheduling, upgrade action and names (I5).
   - Add the attribution split and indexes (I13).
   - State the inertness rule for the stepwise re-land (I14).
2. **During implementation (add to the step cards)**
   - AS1: settings store check and `withAtomicFlush` (#17); D1 grant.
   - AS2a/AS2b: organization-scoped `userHasAllFeatures` (#31); closed-thread and implicit-join fixes and the #9359 race (#32); `updatedAt` on proposals in the detail payload (#34).
   - AS3: supersede ordering and repair (#7); `isCrudHttpError`.
   - AS4: re-author through the command bus with the audit marker (#23); system messages (#24); the trusted-context scope (C3).
   - AS5: two rate-limit buckets (#26) and the events semantics (#28).
   - AS6: the staff-erasure payload `id`, erasing all threads on a basket purge (#21), non-throwing schedule registration (#19), and the encryption backfill (C2), unless it lands with AS2a's maps (recommended).
   - AS7: console items #35–#40, closing #8418, #8420, #8422, #9322, #9323 and #9391-5.
   - AS8: #13–#15.
3. **After implementation (follow-up)**
   - The `communication_channels` `userId` bug (D9).
   - Injection spots (#8421).
   - Quote-to-order attribution re-link (D-R5-26, out of Release 5).
   - The `trustProxyDepth` default question.

## 🧪 Audit limits

- I read the full spec and the Release 5 analysis S1–S25, plus `BACKWARD_COMPATIBILITY.md`, `packages/core/AGENTS.md` (Encryption, Upgrade Actions, Subscribers), `packages/events/AGENTS.md`, `.ai/specs/AGENTS.md`, `SDLC.md`, the D-R5 decision register, and the relevant cart-spec sections (§7a create contract, §8.3, §10 grants, `markConverted`).
- The reference was read by three parallel read-only passes (data model/ACL/setup; staff routes, commands and console; buyer routes, subscribers, sweepers and attribution). I spot-checked the load-bearing claims myself: the encryption ids, the `auth.user.deleted` payload, the supersede order, the settings route scoping, and the cart and `employee` grants.
- On `main` I searched: `packages/core/src/modules/cart/{events.ts,lib/cartService.ts,setup.ts}`, `packages/shared/src/lib/commands/`, `packages/ui/src/backend/messages/`, `auth`/`customer_accounts` events, and `buildEncryptionMapBackfillSql` usages. `resolveForBuyer`, the trusted-context helper, the cart proposal commands and the five cart reads are all absent on `main`, as the spec's hard dependencies expect.
- Nothing was built, run or tested. Line numbers in the reference are as read at `bdb747c36a`.
- Not verified: the module-facts byte caps; the PG version floor; whether `instanceof CrudHttpError` actually crosses a bundle boundary; the live state of the GitHub issues (taken from the 2026-11-19 appendix).
- Not audited here: the `.ai/review-checklist.md` items beyond those that the root and package `AGENTS.md` repeat, and the `.uxproof/` design contract.
- No suspected prompt injection was found in the spec, analyses or reference comments.
