# Pre-Implementation Analysis: CRM Call Transcriptions (PR #1645)

| Field | Value |
|---|---|
| **Date** | 2026-04-23 |
| **Reviewer** | Maciej Dudziak (haxiorz) — independent pre-impl review requested via pkarw on PR #1645 |
| **Target** | [open-mercato#1645](https://github.com/open-mercato/open-mercato/pull/1645) — spec/crm-call-transcriptions |
| **Specs** | `.ai/specs/2026-04-21-crm-call-transcriptions.md` (parent), `2026-04-22-transcription-zoom-adapter.md`, `2026-04-22-transcription-tldv-adapter.md` |
| **Prior reviews in PR** | `ANALYSIS-2026-04-21-crm-call-transcriptions.md` (3 passes), `ANALYSIS-2026-04-22-transcription-provider-specs.md` (2 passes), `ANALYSIS-2026-04-22-crm-call-transcriptions-review.md` (1 pass, 5 findings applied). @dominikpalatynski approved on 2026-04-22. |
| **Scope** | OSS. 3 spec files + 2 analysis files. Spec-only change; no code in PR. |

## Executive Summary

The spec set is **materially ready to implement** but **not yet blocker-free**. The architecture has already been through a major module-boundary redesign (customers ↔ dedicated `call_transcripts` hub), adopts the existing `@open-mercato/webhooks` inbound pipeline, retires a premature DI multi-provider token, and documents a two-phase commit with a durable recovery path. All 13 BC contract surfaces are additive. The author has run three internal architectural-review passes and addressed every finding in-writing.

What's still open is narrower than the prior reviews surfaced: **one undeclared ACL feature the spec depends on**, **one prerequisite platform change with no phase-zero home**, **two integration-test cases whose wording was not updated when the transaction model was rewritten**, and **several internal-consistency gaps** (entity types, cascade assumptions, BC section omissions). Recommend one more cleanup pass plus one explicit prerequisite-spec before Phase 1 starts. No architectural redesign required.

**Recommendation: _Needs targeted spec updates first (≤ 1 day of editing), then ready to implement._**

---

## Verification Scope

Claims in the spec were spot-checked against the current `develop` tree. Only items that affect implementation correctness or BC are reported.

| Spec claim | Verdict | Evidence |
|---|---|---|
| `WebhookEndpointAdapter` has no `handleHandshake` hook today | ✅ Correct | `packages/webhooks/src/modules/webhooks/lib/adapter-registry.ts:3-32` — interface has only `providerKey`, `subscribedEvents`, `formatPayload?`, `verifyWebhook`, `processInbound` |
| Shared `/api/webhooks/inbound/[endpointId]` route persists receipt, emits event, returns fixed ack, runs `processInbound` async | ✅ Correct | `packages/webhooks/src/modules/webhooks/api/inbound/[endpointId]/route.ts:85-112` (receipt, emit at :102, ack `{ok:true}` at :112); `subscribers/inbound-process.ts:4` (`persistent:true`, async) |
| `registerGatewayAdapter` / `registerDataSyncAdapter` use a module-level Map pattern | ✅ Correct | `packages/shared/src/modules/payment_gateways/types.ts:233-244`; `packages/core/src/modules/data_sync/lib/adapter-registry.ts:1-16` |
| `IntegrationHubId` union accepts new hub string | ✅ Correct (already open union with `\| string` fallback at `packages/shared/src/modules/integrations/types.ts:15-22`) |
| `customers.person.created` / `.updated` event IDs exist | ✅ Correct | `packages/core/src/modules/customers/events.ts:10-11` |
| Customers commands fork their own EM and run their own transaction | ✅ Correct | `packages/core/src/modules/customers/commands/interactions.ts:302` (`em.fork()`), `:244-273` (explicit `runInTransaction`) — confirms cross-module `withAtomicFlush` is not possible today, as the spec now documents |
| `customers/translations.ts` absent today | ✅ Correct — must CREATE |
| `customers/encryption.ts` lacks an entry for the new participants junction | ✅ Correct — must EXTEND |
| `customers/search.ts` does not index `customer_interaction` | ✅ Correct |
| `SearchOptions` has no user-feature context; search service applies no runtime ACL filter | ✅ Correct (`packages/shared/src/modules/search.ts:64-83`, `packages/search/src/service.ts:78-120`) — validates the v1 "title + source only" scope narrowing |
| `customers:timeline:interaction` widget spot does not exist today | ✅ Correct — spec creates it |
| `CustomerInteractionParticipant` entity does not exist today | ✅ Correct — spec creates it |
| **`customers.interactions.create` feature ID** — referenced in spec §API Contracts, §Access Control for the unmatched resolve route | ❌ **Not found** | `packages/core/src/modules/customers/acl.ts` declares `customers.interactions.view` and `customers.interactions.manage` only — no `.create`. See Finding C-1 below. |

---

## Backward Compatibility Audit

Reviewed against all 13 categories in [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md). The author's own §Backward Compatibility matrix is accurate for the surfaces it lists. Items below are additions I found during independent audit.

### Violations / Gaps

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| BC-1 | Cat. 5 — Event payloads | The spec (§5 Retroactive matching, last paragraph) states: *"The `customers.person.updated` payload contract MUST include the previous `primary_email`/`primary_phone` snapshot … this spec adds that field … additive, BC-safe"*. Additive to an existing event payload is allowed (Cat. 5 explicitly permits new optional fields), but the change is buried in §5 and is **not reflected in §Backward Compatibility** matrix row 5, which lists only new event IDs. | Warning | Add a line to BC row #5: *"Additive: new optional `previousPrimaryEmail?` / `previousPrimaryPhone?` fields on `customers.person.updated` payload. No removal of existing fields."* Mention it in RELEASE_NOTES so subscribers in third-party modules know they can rely on it. |
| BC-2 | Cat. 10 — ACL feature IDs | Spec references `customers.interactions.create` (parent spec ~L965 and §Access Control for unmatched resolve). This feature ID **does not exist today** in `customers/acl.ts`. Cat. 10 allows adding NEW feature IDs freely, so creating it is fine — but the spec does not declare it, does not add it to `customers/setup.ts` `defaultRoleFeatures`, and does not claim it as a NEW ID in §Backward Compatibility. | **Critical** (pre-impl) | Either (a) add `customers.interactions.create` to `customers/acl.ts` with default role seeding in `customers/setup.ts`, and list it in BC row #10 as an additive new feature; or (b) downgrade the unmatched-resolve route guard to `customers.interactions.manage` (existing) + per-subject checks. Option (a) is more precise; option (b) requires no new ACL surface. |
| BC-3 | Cat. 8 — Database schema | Spec Risks table says: *"Deleting a Person: `customer_interaction_participants` rows cascade (FK ON DELETE CASCADE)"*. But §Data Models declares `customerEntityId` as a plain `@Property({ type: 'uuid', nullable: true })` — no explicit FK constraint, no `onDelete` attribute. Since Open Mercato uses ID-only cross-entity references (not ORM relationships), the ON DELETE CASCADE would need to be declared at the SQL level in the migration (`yarn db:generate` from a plain property alone will NOT produce a cascade). The GDPR risk mitigation depends on this constraint existing. | Warning | Either (a) declare an explicit FK with `onDelete: 'CASCADE'` on the entity (crossing the cross-module ORM boundary; not allowed here since `customer_entity_id` is a cross-domain ID), (b) write a subscriber on `customers.person.deleted` that explicitly unlinks/deletes participants, or (c) hand-augment the migration with a raw FK CASCADE and document this as an acceptable exception. Pick one and encode it in the spec — right now the risk mitigation has no implementation path. |
| BC-4 | Cat. 13 — Generated file contracts | Spec Phase 1 step 11 runs `yarn generate` + `yarn db:generate` and Phase 1 step 9 extends `IntegrationHubId` union. Generated files like `entities.generated.ts` and the aggregated `modules.generated.ts` MUST remain shape-compatible. The spec doesn't describe any breaking shape change, but **extends the `@open-mercato/shared` package's public types** — third-party modules that depend on pinned `@open-mercato/shared` versions must re-build after upgrade. | Info | Mention in RELEASE_NOTES that third-party integration provider packages must bump their peer-dep on `@open-mercato/shared` to gain `call_transcripts` as a valid `IntegrationHubId`. No code fix needed. |

All other 10 BC surfaces are clean per the author's existing matrix. Confirmed additive-only.

### Missing Migration & BC Section

The parent spec has a §Backward Compatibility section but does NOT have a titled "Migration & Backward Compatibility" section of the sort required by `BACKWARD_COMPATIBILITY.md` §Deprecation Protocol. Since this spec introduces no deprecations, that's acceptable — but a one-line note like *"No deprecation bridges required; all changes are additive."* would make the intent explicit.

---

## Spec Completeness Check

Parent spec against the spec-writing template:

| Section | Status | Notes |
|---|---|---|
| TLDR & Overview | ✅ | Clear |
| Problem Statement | ✅ | Market research included |
| Proposed Solution | ✅ | 7 subsections |
| Architecture | ✅ | ASCII diagram consistent with rewritten module split |
| Data Models | ✅ | 4 new entities fully specified with indexes, CHECK constraints, encryption maps |
| API Contracts | ✅ | All 6 new routes + shared webhook intake + command bus commands |
| UI & UX | ✅ | Inline timeline, unmatched inbox, sidebar badge, dialogs |
| Risks & Impact Review | ✅ | 13 rows incl. cross-module projection failure |
| Phasing | ⚠️ **See G-1** | 6 phases, BUT no Phase 0 for the `handleHandshake` prerequisite |
| Implementation Plan | ✅ | Per-phase steps concrete |
| Integration Test Coverage | ⚠️ **See F-1, F-2** | Two tests (TC-CT-013, TC-CT-016) still describe chain-undo / cross-module atomic rollback — contradicted by the revised §4 "Transaction model" |
| Final Compliance Report | ✅ | 30+ row matrix, AGENTS.md coverage exhaustive |
| Changelog | ✅ | Extensive daily diary; 12+ entries |
| "Migration & Backward Compatibility" sub-section | ⚠️ | Not separately titled — optional but recommended |

---

## AGENTS.md Compliance

Against root `AGENTS.md`, `packages/core/AGENTS.md`, `packages/webhooks/AGENTS.md`, `packages/shared/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md`, `packages/core/src/modules/integrations/AGENTS.md`, `packages/search/AGENTS.md`.

### Compliant

The author's own §Final Compliance Report matrix is thorough and accurate. I re-checked every row against the actual AGENTS.md files; all pass. Specifically:

- Event IDs `module.entity.action` past tense ✓
- `requireFeatures` declarative, never `requireRoles` ✓
- No direct ORM relationships between modules ✓ (`interactionId` / `sourceCallTranscriptId` are FK-by-id only)
- Commands undoable with per-phase undo documented ✓
- `withAtomicFlush` used for single-module multi-phase writes ✓
- Encryption maps declared via `defaultEncryptionMaps` for every regulated column ✓
- `findWithDecryption` discipline called out for all sensitive reads ✓
- `emitCrudSideEffects` + `emitCrudUndoSideEffects` symmetrical ✓
- Auto-discovery file layout for new module follows convention ✓
- Integration providers own env-backed preconfiguration inside the provider package ✓
- Generated files committed after `yarn generate` / `yarn db:generate` ✓ (phase-gated)
- Widget injection used instead of direct cross-module coupling ✓

### Violations / Gaps

| Rule | Location | Severity | Fix |
|---|---|---|---|
| `packages/core/AGENTS.md` → "When adding features to `acl.ts`, also add them to `setup.ts` `defaultRoleFeatures`" | Spec references `customers.interactions.create` but does not declare it anywhere | Critical | See BC-2 above. If this feature is created, it must be seeded. |
| Root AGENTS.md → "Agents MUST automatically run `yarn mercato configs cache structural --all-tenants` after enabling/disabling modules in `src/modules.ts`" | Phase 1 step 11 runs this command; Phase 3 does not mention it. Phase 3 adds a new backend page `/backend/call-transcripts/unmatched` and new sidebar injection, both of which are structural nav changes. | Warning | Add the same `yarn mercato configs cache structural --all-tenants` invocation to the end of Phase 3. Without it, the nav cache hides the new unmatched inbox sidebar badge until first boot. |
| `packages/core/AGENTS.md` → `api/interceptors.ts` → "For CRUD list narrowing, prefer writing `query.ids` (comma-separated UUIDs)" | Spec §7 "Timeline union" describes the `participantOf` interceptor compliantly | ✅ no action |
| Root AGENTS.md → DS rules (no arbitrary text sizes, semantic tokens only) | Spec §UI & UX mentions `<StatusBadge>`, `<LoadingMessage>`, etc., but does not list DS-token usage for pill colors on matched-vs-unmatched participants | Low | Add one sentence: *"Matched pills: `variant='success'`; unmatched pills: `variant='neutral'`; host pill icon: lucide `crown` at `size-3`. No hardcoded colors."* |
| `packages/core/AGENTS.md` → "No `any` / `unknown` in shared types" | The shared exports were cleaned up to `JsonValue`. BUT the entity field `providerMetadata?: Record<string, unknown> \| null` at §Data Models still uses `unknown`. | Low | Change the entity type to `Record<string, JsonValue>` to match the shared contract. Row-level persistence is JSONB and doesn't care; only the TypeScript consistency is at stake. |

---

## Risk Assessment

Author's existing §Risks table is strong. Adding risks the spec does not currently surface:

### High

| Risk | Impact | Mitigation |
|---|---|---|
| **R-1. Phase 4 blocks on a prerequisite that has no spec of its own.** | `handleHandshake` additive extension to `@open-mercato/webhooks` is a hard prerequisite for the Zoom adapter (Phase 4). The spec describes the API shape but does not own it — it sits between `packages/webhooks` (not a spec in this PR) and Phase 4. If the prerequisite change lands without review, it becomes an informal contract change to `WebhookEndpointAdapter`. | Author a 1-page prerequisite spec `.ai/specs/{date}-webhooks-handshake-hook.md` covering just the new optional hook + its interaction with the shared inbound route + tests. Land that spec and the code change BEFORE Phase 4 starts. Alternatively: include the `@open-mercato/webhooks` extension inside Phase 1 of the parent spec so it has a documented owner and test coverage. |
| **R-2. Undeclared feature ID `customers.interactions.create`.** | Implementation will either (a) fail route guards at runtime because the feature is not registered, or (b) silently fall back to "user denied" for all authenticated users — the exact failure depends on `rbacService`'s behavior on unknown feature IDs. Either way, the unmatched-resolve flow is broken. | Declare the feature (BC-2 option a), OR switch the guard to an existing feature (BC-2 option b). Pick one and update §Access Control + Phase 2 steps. |
| **R-3. GDPR right-to-forget gap.** | Spec explicitly defers retention worker to a follow-up, but active GDPR erasure is regulatory, not optional. Deleting a `CustomerPerson` leaves `call_transcripts.text` intact (the aggregate is transcript-module-owned, not CRM-owned). `participants_summary` in `CallTranscriptUnmatched` still holds `email_hash`/`phone_hash` (recoverable if the plaintext is known). The Risk row acknowledges "requires documented operator flow" but does not define one. | Add to Phase 6 an operator-facing CLI command `yarn mercato call-transcripts erase --email <email>` that (a) finds all `CallTranscript` rows via `email_hash`, (b) redacts `text`/`segments`/`provider_metadata`/`source_meeting_url` in place (or hard-deletes the aggregate), (c) cascades to `customer_interaction_participants` via email_hash. Document the SLA (seconds, not days). Or: file a follow-up spec and explicitly mention it as a v1.1 gate in RELEASE_NOTES. Whichever path, don't ship without it. |

### Medium

| Risk | Impact | Mitigation |
|---|---|---|
| **R-4. Conceptual overlap with existing `inbox_ops` module.** | The existing `inbox_ops` module (Email-to-ERP Agent) already owns an "inbox" UX: inbound email webhooks, human-in-the-loop proposals, a settings/proposals/log nav surface, notification renderers, proposal `inbox_ops.proposal.created` / `.accepted` / `.rejected` events. The new `call_transcripts` module introduces *another* "unmatched inbox" with `lucide:inbox` icon. Users will see two inboxes with similar UX and different ownership. No spec acknowledges this. | Add one paragraph to the parent spec §UI & UX differentiating the two inboxes (different subject matter, different ACL, different owner), and either (a) choose a distinct icon for `/backend/call-transcripts/unmatched` (lucide `phone-incoming` or `voicemail` would be on-brand), or (b) group both under a shared "Inbox" sidebar section with sub-items. Option (a) is lower-risk. |
| **R-5. Recovery-subscriber retry storm on sustained customers outage.** | Spec §4 describes "persistent recovery subscriber retries with exponential backoff; after N retries the transcript falls back to `projection_status='unmatched'`". But N is not specified, the backoff ceiling is mentioned in the Risks row as "1m → 30m capped" only in passing, and there is no dead-letter path. During a 1-hour customers outage + a steady webhook stream, the queue could grow unbounded. | Specify N (suggest 5), specify max interval (suggest 30m), specify what happens on the N+1th failure (fallback to inbox is already stated — confirm it clears the retry counter). Include a test TC-CT-NEW-1: *"forced customers-projection failure for 6 consecutive retries → transcript ends up at `projection_status='unmatched'` in the inbox and no further retry events are emitted."* |
| **R-6. Notification fanout on bulk unmatched storm.** | `notify-unmatched-transcript` subscriber emits an in-app notification to **all users with `call_transcripts.unmatched.resolve`**. On a tenant with dozens of managers, a 1000-transcript backfill produces ~1000× (managers) notifications. | Cap the subscriber's emission per user per time window (e.g. coalesce identical notification types per user per hour). Or change default role seeding so only `admin` / `superadmin` get the feature by default, not `manager`. |
| **R-7. tl;dv `matched_via` gap at CRM boundary.** | tl;dv sub-spec establishes that only the organizer gets deterministic matching; other speakers carry `matchable=false` on the transcript-side participant but do NOT get a CRM junction row (per the CRM-side CHECK `email OR phone`). If a sales rep expects "see every participant on the CRM timeline", this is a silent under-counting. | Add a UI hint on `<CallTranscriptCard>` near the participants strip: *"N speakers recognized by display name only; not linked to CRM records. {Invite to CRM} to surface them here."* Already partially covered by the spec's "Invite to CRM" affordance — just needs explicit differentiation text and an i18n key. |

### Low

| Risk | Impact | Mitigation |
|---|---|---|
| R-8. `sourceCallTranscriptId` CF coupling fragility | If `call_transcripts.text` is deleted but `sourceCallTranscriptId` lingers on `CustomerInteraction`, the `<CallTranscriptCard>` gets a 404 with no user-facing recovery. | Spec already has reingest + inbox fallback. Add a widget-level error state telling the operator to reingest or reset the CF. |
| R-9. Zoom 3-second handshake inside the existing middleware stack | `handleHandshake` runs synchronously BEFORE `verifyWebhook` per the spec, but does it run before rate-limiting and dedup in the shared route? The shared route does dedup after verify. | Explicit: `handleHandshake` SHOULD run FIRST in the route handler, before any rate-limit / receipt-persist / event-emit logic. Add that to the prerequisite spec (R-1). |
| R-10. Spec-file cleanup after landing | All three specs get moved to `.ai/specs/implemented/` post-deploy per Phase 6 step 6. Ensure the two ANALYSIS files go with them (or to `.ai/specs/implemented/analysis/`). Current convention isn't set by the spec. | Minor — follow `.ai/specs/AGENTS.md` convention once implementing. |

---

## Gap Analysis

### Critical (block implementation)

- **G-1. `handleHandshake` prerequisite has no phase-zero.** See R-1. Either write the 1-page prerequisite spec (recommended) or extend Phase 1 to include the `@open-mercato/webhooks` change with its own test coverage.
- **G-2. `customers.interactions.create` feature undeclared.** See BC-2 / R-2. Must be resolved before Phase 2 kicks off.

### Important (should address)

- **G-3. TC-CT-013 and TC-CT-016 use stale language.** Rewrite both test descriptions:
  - **TC-CT-013** now: *"Chain-undo deletes customers projection AND call_transcripts rows."* → should read: *"Undo after Phase C: invokes `customers.interactions.delete_from_transcript` (idempotent), then deletes transcript+participants+staging rows in a separate transaction. On inverse-command failure, transcript rows still delete; a `call_transcripts.transcript.undo_partial` event is emitted."*
  - **TC-CT-016** now: *"Forced customers-projection failure → outer transaction rolls back → no orphan CallTranscript row; caller receives 500."* → should read: *"Forced customers-projection failure: transcript row commits with `projection_status='projection_failed'` + `last_error`; `call_transcripts.transcript.projection_failed` event emitted; a recovery subscriber retries with exponential backoff; after N retries falls back to `projection_status='unmatched'` and appears in the inbox."*
  - Add **TC-CT-NEW-1** (see R-5) for the N-retry fallback path.
- **G-4. Phase 3 missing `yarn mercato configs cache structural --all-tenants`.** See AGENTS.md violations table.
- **G-5. Spec does not acknowledge the existing `inbox_ops` module.** See R-4. One paragraph + icon choice resolves it.
- **G-6. Cascade mitigation for GDPR person-delete is under-specified.** See BC-3 and R-3.

### Nice-to-have

- **G-7. RELEASE_NOTES entry templated in the spec.** The spec includes a draft release note. Good — just make sure it lands alongside the Phase 6 polish step.
- **G-8. `CustomerInteractionParticipant` migration foreign-key strategy.** Spec doesn't specify whether `interaction_id` has a DB FK to `customer_interactions.id`. Since both are in the same module (`customers`), a true FK is both permitted and desirable here. Clarify.
- **G-9. Reingest semantics on projected transcripts with evolving participants.** If a tenant's contacts changed between original ingest and reingest, `customers.interactions.update_from_transcript` must decide whether to add/remove/reorder participant rows. Spec says "updates participants aligned" but doesn't specify the diff algorithm.
- **G-10. The `@open-mercato/transcription-zoom` and `-tldv` package publication cadence.** Neither sub-spec says whether these packages go to npm on the same release cadence as core, or independently. Also neither says MIT license explicitly in the `integration.ts` sample (Zoom does; tl;dv's is cropped in my fetch).

---

## Remediation Plan

### Before Implementation (Must Do)

1. **Declare `customers.interactions.create`** in `customers/acl.ts` + seed in `customers/setup.ts` `defaultRoleFeatures`, **OR** switch the unmatched-resolve guard to `customers.interactions.manage`. Update spec §Access Control and §API Contracts correspondingly. [Fixes BC-2 / R-2 / G-2]
2. **Author a prerequisite spec** `.ai/specs/2026-04-{NN}-webhooks-handshake-hook.md` covering the additive `handleHandshake` hook on `WebhookEndpointAdapter`: interface change, shared-route integration point (must run BEFORE rate-limit/dedup for Zoom's 3s window), test matrix, backward compatibility (additive; existing adapters return `null`). Reference it as a hard prerequisite for Phase 4. [Fixes R-1 / G-1 / R-9]
3. **Rewrite TC-CT-013 and TC-CT-016** to match the new two-phase transaction model; add TC-CT-NEW-1 for recovery-subscriber fallback. [Fixes G-3]
4. **Define GDPR erasure mechanism** — minimum, specify the operator workflow (CLI or admin UI action) for "erase all transcripts referencing this email". Close with a concrete SLA + test. [Fixes BC-3 / R-3 / G-6]
5. **Add `yarn mercato configs cache structural --all-tenants`** to Phase 3 after the sidebar injection step. [Fixes G-4]
6. **Add one paragraph differentiating the new unmatched inbox from `inbox_ops`** and pick a non-`inbox` lucide icon for the call transcripts sidebar badge. [Fixes R-4 / G-5]

### During Implementation (Add to Spec)

7. Specify N + backoff ceiling for the recovery subscriber; confirm the dead-letter path clears the retry counter. [R-5]
8. Add notification fanout cap for `notify-unmatched-transcript`. [R-6]
9. Add the participant-diff algorithm for `customers.interactions.update_from_transcript`. [G-9]
10. Clarify `CustomerInteractionParticipant.interaction_id` FK (same-module DB FK is OK) and add `ON DELETE CASCADE`. [G-8]
11. Update entity `providerMetadata` type from `Record<string, unknown>` to `Record<string, JsonValue>` for consistency with the shared contract. [AGENTS compliance Low]

### Post-Implementation (Follow Up)

12. Retention worker spec (transcripts older than N months) — spec already calls this out as a Follow-up Track.
13. User-feature-aware search filter in `packages/search` to unlock transcript-body full-text indexing. — Spec calls this out.
14. Calendar-enrichment v2 to turn tl;dv display-name-only speakers into matchable identities. — Spec calls this out.
15. `commandBus.runInShared(em, async bus => { … })` primitive to restore cross-module atomicity. — Spec flags as separate platform concern.

---

## Cross-Module Interaction With `inbox_ops`

Since the user called out "focus on InboxOps module," an explicit note on overlap:

- **`inbox_ops`** (existing, shipped): ingests **forwarded emails** via webhook, runs **LLM extraction** to propose structured CRM actions, queues **proposals** with an approval UX. Events: `inbox_ops.email.received`, `inbox_ops.proposal.created`, `inbox_ops.action.executed`, etc. Owner entity: `InboxEmail`, `InboxProposal`, `InboxSettings`. ACL: `inbox_ops.*`. UI at `/backend/inbox-ops/*`.
- **`call_transcripts`** (this PR): ingests **meeting transcripts** via webhook, runs **email-deterministic matching** to CRM records, queues **unmatched transcripts** for manual claim. Events: `call_transcripts.transcript.*`. Owner entity: `CallTranscript`, `CallTranscriptParticipant`, `CallTranscriptUnmatched`. ACL: `call_transcripts.*`. UI at `/backend/call-transcripts/*`.

They are **correctly distinct modules** — different input types, different processing models (LLM extraction vs deterministic matching), different permission surfaces, different data aggregates. The risk is **UX confusion**, not architectural conflict. Mitigation in R-4 is sufficient.

One pattern `call_transcripts` could usefully borrow from `inbox_ops`: the latter already has a mature "proposal" approval flow with edit/reject/reprocess semantics. The `call_transcripts` unmatched-claim dialog is simpler (one-shot resolve) but the underlying UX idioms (dialog, row actions, bulk dismiss, live event refresh) are identical. If the implementer follows `inbox_ops`' pattern closely (dialog component structure, bulk-action wiring, notification-renderer style), the two modules will feel consistent to users even with the separate nav surfaces.

---

## Recommendation

**Needs targeted spec updates first (items 1–6 above), then ready to implement.**

None of the remaining issues require architectural redesign. The @dominikpalatynski approval covers the big-picture module-boundary decision; the items here are implementation-correctness polish. Estimated effort: 2–4 hours of spec editing, plus the 1-page prerequisite spec for `handleHandshake`.

Once items 1–6 land, Phase 1 can start the same day. Pipeline label should move from `review` → `changes-requested` until items 1–6 are addressed, then back to `review`, then (if QA needed — likely YES given the new UI surface and the cross-module coordination) to `qa` per the PR workflow table in root AGENTS.md.

---

## Reviewer Notes

- @pkarw asked on 2026-04-23 whether @itrixjarek and @haxiorz were good with the spec. This analysis is my (haxiorz) answer: structurally yes (pending the 6 items above), and I'd recommend @itrixjarek cross-check the transaction-model rewrite specifically, because the two-phase commit + recovery subscriber + per-phase undo interaction with `emitCrudSideEffects` / `emitCrudUndoSideEffects` is the most novel piece in the set, and prior reviews mostly validated the shape, not the runtime behavior.
- No code was modified during this review. All findings reference existing code at file:line; no speculative edits.
- The author's internal ANALYSIS files in the PR are high-quality and honest — they captured and resolved the major issues before this external review. This report is a targeted delta, not a re-audit.
