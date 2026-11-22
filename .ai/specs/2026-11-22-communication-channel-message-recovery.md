# Reconcile partial communication-channel message workflows

- **Status** — Proposed
- **Tracking issue** — [#5327](https://github.com/open-mercato/open-mercato/issues/5327)
- **Prerequisite for channel recovery activation** — [Delivery safety #5137](https://github.com/open-mercato/open-mercato/issues/5137) and [its implementation PR #5330](https://github.com/open-mercato/open-mercato/pull/5330)
- **Related design** — [Communication hubs](implemented/SPEC-045d-communication-notification-hubs.md), [Inbound email reliability](implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md), [Normalized inbound timestamps](2026-08-21-normalized-inbound-message-timestamp-contract.md)

## TLDR

Record workflow identity before creating a Message. Record each required event or delivery intent in the same transaction as the state that authorizes it. Resume from those records after interruption so retrying an inbound item repairs its links and CRM effects, retrying a keyed channel send reuses its Message, and a publication failure leaves a successful provider send intact.

## Overview

The scope covers inbound channel materialization, user-authored channel sends, and an audit of `messages.message.sent` for ordinary Messages sends. Channel recovery also covers publication of `communication_channels.message.sent` after provider success. Provider timestamp semantics, changes to what counts as authorized delivery, a Messages-wide outbox, unrelated event producers, and production data repair are outside this design.

## Problem Statement

| Boundary | Current failure | Required recovery |
| --- | --- | --- |
| [Inbound ingestion](../../packages/core/src/modules/communication_channels/commands/ingest-inbound-message.ts) | Compose commits before channel rows. Inbound already derives a Message idempotency key from channel and provider identity, but the external-row duplicate check returns before publication. A failed conversation or contact event can prevent the received event from being attempted. | Return the same Message, write missing channel rows, and resume every recorded effect in order. |
| [Poll and Gmail history](../../packages/core/src/modules/communication_channels/workers/poll-channel.ts) | A permanent ingest failure calls the [best-effort dead-letter writer](../../packages/core/src/modules/communication_channels/lib/dead-letter.ts). The cursor can advance when writing recovery evidence fails. | Advance only after a complete materialization with durable publication intent or a committed terminal record with an actionable recovery reference. |
| [Channel send admission](../../packages/core/src/modules/communication_channels/lib/send-as-user.ts) | Compose, channel links, and enqueue use separate boundaries. A retry of the facade can compose another Message. | Persist one action per caller-generated key and resume either side of channel-link creation. |
| [Channel provider success](../../packages/core/src/modules/communication_channels/commands/deliver-outbound-message.ts) | The sent-event emit shares the provider send's error path. An emit failure can downgrade a committed success and make a retry call the adapter again. | Persist success and sent-event intent together. Recover publication independently from delivery. |
| [Ordinary Messages sends](../../packages/core/src/modules/messages/commands/messages.ts) | Compose, draft-to-sent, reply, and forward emit after commit. The [event bus](../../packages/events/src/bus.ts) enqueues separately from that commit. Queue retries cover accepted persistent jobs. A process stop before enqueue leaves no durable authored-send intent. | Characterize the commit gap and document it independently from channel recovery. Preserve the validity of Messages with no channel link. |

[The issue's synthetic command-level evidence](https://github.com/open-mercato/open-mercato/issues/5327#issuecomment-6350662368) confirms the failed-publication paths. The implementation must verify crash and concurrency guarantees against PostgreSQL and both supported queue strategies.

## Resolved assumptions (autonomous defaults)

| Question | Decision |
| --- | --- |
| Should the workflows have separate specs? | Keep inbound and outbound channel recovery together because they share recovery identity, scoped diagnostics, and dispatch. Audit ordinary Messages in this spec. A Messages-wide outbox requires a separate design and rollout. |
| What can recovery infer for historical rows? | Repair only from verified provider, Message, link, or operation evidence. Label ambiguous rows for investigation. Automatically replay only a recorded intent or an explicitly verified historical recovery. |
| How should callers opt into safe retries? | Add an optional idempotency header to the HTTP entry points that use the channel facade and an optional key to the DI input. Built-in callers retain the same key for retries of one user action. Existing unkeyed clients retain their calling contract. Unkeyed actions are inspectable, with automatic dispatch starting only for a handoff already confirmed. |
| Where should operators recover failures? | Start with scoped CLI commands and an auditable recovery record. Existing UI and HTTP paths exercise recovery through the normal send and ingest flows. |

## Proposed Solution

Use a channel-owned workflow row for inbound and outbound actions. Commit each durable effect intent with the domain change that makes it valid. Reuse the scheduler, queue worker contract, typed module events, and existing delivery commands. The [Todo bulk-complete outbox](../../packages/create-app/template/src/modules/example/workers/todos-bulk-dispatch.ts) demonstrates a commit-and-recover pattern in the repository. The same pattern requires stable effect identity and idempotent consumption across a broker acknowledgement crash. [AWS transactional outbox guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

### Inbound materialization and replay

1. Validate channel identity, provider capability, exact tenant and organization, and the current worker authority before claiming the source. Use the existing channel/provider identity and Message key encoding where present. A missing provider message ID requires another trusted provider-native stable identity or terminal quarantine. Record the identity and replay reference before the Messages command can commit.
2. Use the Messages-owned `messages.messages.record_existing` command defined by #5137 through the command bus. On this baseline the caller uses `messages.messages.compose` with a source-derived idempotency key. Preserve that key so a prior Message can be found. The inbound command returns the original Message and thread on replay, including a concurrent unique-key winner, after verifying scope and source. It never emits authored-send events or creates delivery jobs. Preserve the legitimate inbound indexing, notification, and UI effects identified in #5137's consumer audit. An existing sent-folder match remains an outbound copy and exits without inbound effects.
3. Create or adopt the scoped conversation, mapping, external message, and inbound link. Serialize competing attempts for the same workflow and re-read uniqueness winners in the same scope. Persist a conversation-created intent with a new conversation and a contact-resolved intent with the corresponding contact change. Record the received intent in the transaction that completes the external message and link. Gate dispatch of these intents on complete inbound materialization and preserve their existing publication order. A duplicate with incomplete recorded work resumes it before returning.
4. A retryable failure keeps the cursor unchanged until the page can be retried. A terminal failure upserts durable `ChannelIngestDeadLetter` evidence with workflow identity, failure stage, resolved Message ID if known, and a replay reference. Both poll and Gmail history workers propagate failure to persist that evidence and preserve the prior cursor. Treat the existing excerpt as diagnostic evidence. Replay uses a verified refetch or bounded, encrypted replay data retained with the workflow.
5. Recovery reuses the same path and emits one logical received event after completeness. Store the resolution, actor, and outcome. Concurrent cursor ingestion, provider redelivery, and manual recovery converge on the same row and event identity.

### Channel send admission and provider outcome

1. Validate the actor, channel ownership, mutation guards, recipients, attachments, and any CRM authority before creating an action. Persist the keyed action and an input fingerprint first. Derive the Messages key from the workflow identity, and reuse the committed Message on retry. Recover a partial composition only with the same verified action and scope. Persist identity and progress for unkeyed calls too, using a server-generated action ID for that invocation. Keep the facade's existing `sendViaEmail: false` ownership rule.
2. Commit the conversation, mapping, outbound link, and delivery intent together. The operation can then attempt the existing queue handoff eagerly. For keyed calls, recovery dispatches the exact same intent if the queue is unavailable or the process stops. For unkeyed calls, require a successful synchronous handoff or a verified worker claim before any automatic retry. A definite initial enqueue failure records a failed admission. An unconfirmed handoff remains inspectable for explicit recovery, which must first establish whether the initial handoff or provider send occurred. Preserve the meaning of a legacy `202` with `enqueuedForDelivery: true` by requiring a confirmed handoff or a recorded delivery outcome before returning it. A pre-handoff failure uses the existing failure path. An unkeyed request retried as a fresh action cannot be correlated to the first action. It must never cause automatic redispatch of an unconfirmed first action. Updated callers retry with the same key even when the original response is lost. The CRM Person-email caller and Messages channel-sender delegation forward the key and revalidate access on replay. The CRM response uses the stored handoff time on keyed replay. Guard callbacks that perform admission-side effects must recognize a replay of the same action.
3. Workers detect stale pending work from the durable intent, using a retry age and dispatch state. A stable delivery identity, a scoped atomic worker claim, and a terminal-state check prevent concurrent handoffs from repeating a successful send. Persist provider success and the channel sent-event intent together. Protect an adapter's accepted `queued` outcome from resend while retaining the existing queued delivery status. The success branch cannot reach the provider-failure handler after commit.
4. Apply the new success and publication logic to the shared delivery command, including existing bridge jobs. Admission of non-facade sends through the outbound bridge keeps its current contract. Verify that the existing authored-event subscribers cannot initiate delivery for a partial facade send. Preserve the channel-facade origin and bridge checks before enabling keyed send. Apply the verified delivery-safety policy for ambiguous acknowledgement. Where the provider supports idempotency, reuse the same provider key inside its documented validity window. Otherwise fail closed on an ambiguous attempt and require provider evidence before retry. For example, Resend documents a 24-hour key window. [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)

### Channel-authored events and ordinary Messages audit

For `sendAsUser`, record a Messages-owned authored intent with the committed Message. Opt into this behavior using the trusted channel workflow reference in the internal command context. Preserve the existing event ID, payload, SSE routing, and subscriber scope. Hold publication until the facade confirms link creation through a Messages-owned command. If confirmation fails, resume it using the recorded channel workflow. Inbound materialization cannot insert an authored intent.

For ordinary Messages, verify each compose, draft-to-sent, reply, and forward commit and event path. The current bus can retry after persistent enqueue, while a producer stop between the database commit and queue acknowledgement can leave the effect unrecorded. Characterize this boundary in the release evidence, including whether each subscriber already has an independent durable record and how the effect behaves on worker retry. Ordinary Messages remain valid without a channel link, and channel diagnostics must exclude them. Any general Messages durability fix needs a separate design for existing subscribers, SSE, and external transport.

## Architecture

- The channel hub owns channel workflow records, dead-letter resolution, and channel effect intents. Messages owns Message creation and authored intent. Cross-module handoffs use the existing command bus, DI facade, and typed events. Store UUID references across module boundaries.
- The dispatcher uses the existing scheduler to run bounded `@open-mercato/queue` jobs. Atomically lease due, scoped rows, release the short transaction before queue or provider calls, and compare the claim token when recording results. Cap retries and expose expired leases and blocked rows. When the scheduler is absent, the scoped operator command can dispatch pending rows. [PostgreSQL row-locking behavior](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE)
- Distinguish intent durability, queue acknowledgement, and consumer completion. The database records one logical event. Queue delivery can repeat after a crash between acceptance and recording acknowledgement. Carry a stable internal event identifier, keep business payloads compatible, and reuse the identity on each handoff. Verify the event bus's persistent, inline, and broadcast paths for this opt-in delivery. Deduplicate each affected built-in durable effect with the existing domain key or an effect receipt committed atomically with that effect. CRM linking already deduplicates on its scoped interaction identity. A consumer with an external side effect needs provider idempotency or explicit ambiguous-outcome handling. Retain the ordinary at-least-once contract for third-party persistent subscribers.
- Replay uses each record's trusted scope and destination. Before requeueing or invoking a command, revalidate the bound tenant, organization, channel ownership, and relevant authority. Trust event scope from the event bus context. Preserve exact null-organization semantics for eligible legacy records. Never broaden a lookup across scopes when an identifier is missing.

## Data Model

Proposed field names are internal to the implementation. All persisted workflow and effect records carry `tenant_id` and exact `organization_id` scope.

| Record | Required data and invariants |
| --- | --- |
| `channel_message_workflows` | UUID, direction, channel, initiating actor or provider identity, scoped non-null action digest, request fingerprint for outbound, stage, optional Message/link IDs, bounded encrypted replay data or verified provider locator, timestamps, attempt status, and recovery audit reference. Unique identity includes direction and the owning scope. Null organization must participate consistently in uniqueness. |
| Channel outbox and Messages channel-authored intents | UUID, scoped workflow or aggregate reference, unique logical effect key, effect kind, ordered sequence when needed, next attempt, lease token and expiry, acknowledgement and terminal failure metadata. Use encrypted typed payload snapshots where reconstructing from mutable state would change the meaning of an event. Never persist provider credentials. |
| `ChannelIngestDeadLetter` | Add nullable workflow and resolved Message references, a failure stage, terminal or resolved state, resolved time and actor. Preserve the existing diagnostic excerpt. Use one terminal record for one scoped source key, reusing a committed winner when replay races. |

Keep unresolved intent and authorized replay material available for recovery. Remove transient payloads after completion or approved expiry and retain the minimum identity and audit metadata needed for deduplication. Declare PII-bearing fields in module encryption maps, include existing-tenant map backfill where required, and route reads through scoped decryption helpers. Diagnostics return identifiers, enum stages, and redacted error classes only.

## API Contracts

- `POST /api/communication_channels/send-as-user` and `POST /api/customers/people/{id}/emails` accept optional `Idempotency-Key`. `POST /api/messages` forwards the same header when `senderChannelId` selects [channel-sender delegation](../../packages/core/src/modules/messages/lib/composeSenderDelegation.ts). Validate a bounded opaque key, bind the stored action to tenant, exact organization, actor and channel, and compare a fingerprint over validated send inputs including order-sensitive fields. The same key and inputs return the same Message/thread/channel result for the authorized actor. A different fingerprint returns a scoped `409` with a stable additive error code. The DI facade accepts the equivalent optional `idempotencyKey`.
- Existing ordinary message compose, draft, reply and forward paths retain their HTTP contracts. Channel recovery applies to the facade's authored effect. Ordinary Messages keep their independent send semantics.
- Add read-only `communication_channels message-workflows inspect` and explicit `communication_channels message-workflows replay` CLI operations. Require a concrete tenant, organization scope, channel, and workflow or dead-letter ID for writes. Inspection can page a single channel by stage and age. Replay runs under an authenticated actor context with the same management feature and ownership policy as the source, or a separately authorized and audited system worker principal. Foreign and unknown IDs produce uniform non-disclosing results. Bare IDs, a blanket superadmin flag, and assignment to a different organization never grant access. Expose dry-run by default, with an explicit execution flag and persisted attempt actor, time, and outcome.
- Replay authorization is rechecked on stale work. Inbound replay and post-success outbound publication never invoke a delivery adapter. Channel-authored publication restores the existing authorized subscriber effects. Any external-send subscriber reached by recovery must use an idempotent admission path. A channel delivery job requires a separate persisted delivery intent and valid worker state.

## UI/UX

Use existing composer and status surfaces. A composer retry keeps its original key for the same send. Editing the payload or starting a deliberate new send uses a new key. No new screen is required.

## Edge Cases & Failure Scenarios

| Scenario | Expected behavior |
| --- | --- |
| Inbound compose commits and the hub dies | A replay finds the original Message, then fills missing channel rows and records the received intent. |
| A conversation/contact event or received enqueue fails | The recorded effect remains due. Recovery continues in order once publication is available and downstream CRM creates one interaction. |
| An inbound terminal error occurs while the dead-letter store is unavailable | The worker reports a retryable storage failure and keeps the cursor. Once the row commits, the cursor can advance. |
| A keyed channel send stops before link persistence, after link persistence, or after queue acceptance | The same action ID resumes at the relevant boundary and reports the original Message. Repeated queue delivery converges on one provider outcome. |
| Provider success commits and event publication fails | The delivery remains sent. Recovery attempts publication only. |
| A lease expires with unknown provider outcome | Reconcile against provider evidence or the provider's supported idempotency window. Otherwise stop in an explicit ambiguous state. |
| A legacy row has no trustworthy identity or acknowledgement | Show an ambiguous or stale diagnostic. Require positive evidence to repair a link or enqueue anything. |
| Scope, channel ownership, or attachments change | Block replay or delivery where current authorization requires it, leave diagnostic state, and avoid disclosing foreign records. |

## Risks & Impact Review

| Risk | Impact | Mitigation and residual risk |
| --- | --- | --- |
| Duplicate external send | High | Durable keyed admission, recovery claim, terminal-send separation, and provider-specific acknowledgement evidence. An unknown provider outcome can still require manual resolution. |
| Accidental historical replay | High | Inspect only by default. Repair a named, scoped operation from verified evidence. Imported inbound work can repair inbound effects only. |
| Event or UI behavior drifts | High | Keep event IDs, business payloads and broadcasts. Exercise inline, queued, failover and duplicate handoff modes. Third-party side effects still need idempotency. |
| Operator access exposes a personal mailbox | High | Reuse current ownership limits, enforce exact scope on every join and command, and redact evidence. Test another actor in the same organization as well as foreign tenant and organization. |
| Scheduler lag, stalled leases, or retained PII | Medium | Bounded jobs, indexed due and age queries, redacted counts, explicit retention, and documented scoped recovery. Unavailable workers can delay dispatch. |

## Migration & Backward Compatibility

- Add tables, indexes, and nullable columns through new migrations and module snapshots. Leave shipped migrations intact. Existing Messages without a channel link remain valid. Use the prior inbound key encoding to recover scoped prior Messages. Do not infer or publish events from the absence of a link.
- Preserve command IDs and return shapes, endpoint paths, DI registration, ACL rules, event names, payloads, and worker compatibility. The header, optional facade field, and operator commands are additive. Describe keyed retry behavior, the unkeyed limitation, rollout requirements, and CLI usage in `UPGRADE_NOTES.md`. Any incompatible change discovered in implementation requires a covering spec and the [deprecation protocol](../../BACKWARD_COMPATIBILITY.md).
- Deploy schema before enabling new writers. Enable recovery for verified producers after worker compatibility is proven. Drain or fence old work that could bypass durable claim and provider-outcome checks during rollout. On rollback, pause new admissions and outbox dispatch, keep the schema and pending evidence, and resume only on compatible code. Effects already published or delivered remain irreversible.
- Legacy diagnostics can identify scoped pending links and known dead letters. Historical publication or delivery status needs positive evidence. Already-delivered mail cannot be undone. Recovery honors existing cancellation and deletion rules.

## Integration Test Coverage

Use self-contained fixtures and cleanup, synthetic provider responses, failure injection, and both local and Redis queue strategies. Each phase ships its affected API regressions with the change.

| Entry point | Regression coverage |
| --- | --- |
| Live webhook, inbound poll, Gmail history, manual channel history import, and scoped replay | Stop after Message commit. Replay and race two attempts against PostgreSQL. Assert one Message/link and one logical received effect after complete rows. Fail at each prerequisite publication, then recover CRM linkage. Assert zero authored events, email jobs, or provider sends. Test durable terminal evidence, dead-letter persistence failure, both cursor decisions, and a recorded recovery outcome. |
| Channel send HTTP and DI facade, CRM Person-email POST, Messages channel-sender delegation and composer retry | Inject failure before link persistence, before enqueue, and after acceptance before acknowledgement. Check stable IDs, one link and one provider send after keyed retry. Cover concurrent same key, edited input conflict, unkeyed error followed by a fresh request, ambiguous legacy handoff, disabled channel, and changed ownership. |
| Outbound delivery and stale pending inspection | Fail publication following committed success and restart recovery. Assert sent status, one provider call, one logical sent effect, and an empty due backlog. Exercise expired leases, unknown provider acknowledgement, and a stale legacy link without durable intent. |
| Channel-authored effect and ordinary Messages audit | Stop after channel-authored compose commits and again after the link commits. Resume confirmation, assert one logical authored effect, and verify that no parallel Messages/Resend send is admitted. Characterize accepted-job retries and pre-enqueue failures for ordinary compose, draft-to-sent, reply and forward. Assert that ordinary internal and Messages/Resend sends stay excluded from channel recovery and draft saves do not publish. |
| Recovery authorization | Deny foreign tenant, organization, and personal mailbox access for inspect and replay. Cover null organization, wrong actor, token scope, conflicting Message evidence, and an authorized restart. |

## Final Compliance Report

| Area | Design evidence |
| --- | --- |
| Module isolation | Each module owns its records and exposes command or event handoffs. CRM stays a subscriber and optional facade caller. |
| Data safety | Scoped uniqueness, authorized replay, redacted diagnostics, encryption mapping, and rollout fencing are explicit. |
| Backward compatibility | Additive migration and facade input. Existing identities, responses, delivery intent, and subscribers are preserved. |
| Implementation readiness | Provider acknowledgement and event idempotency are acceptance gates. Inbound and outbound activation depend on verified delivery safety from #5137. |

## Changelog

- 2026-11-22. Proposed durable identity, delivery intent, publication recovery, and scoped operator diagnostics for #5327.

## Phasing

1. Inbound recovery and cursor safety.
2. Keyed outbound admission and independent delivery publication.
3. Ordinary Messages durability audit and rollout verification.

## Implementation Plan

### Phase 1 — Inbound recovery

1. Verify that #5137's implementation or an equivalent reviewed fix is on the implementation base. Add scoped workflow/dead-letter persistence and build recovery on the prerequisite's Message record-existing path. Test original Message reuse against existing keys and prove the inbound path creates no authored effects.
2. Commit channel rows and their intents at the correct boundaries. Add scoped outbox dispatch and cursor gating. Exercise crashes, retries, and PostgreSQL uniqueness races.
3. Add scoped inspect and replay with audit outcomes. Verify CRM effect idempotency, provider replay evidence, and negative authorization tests. Ship inbound recovery independently.

### Phase 2 — Channel outbound

1. Add optional keyed admission to the facade and all three HTTP entry points and retain the key across first-party retries. Commit the channel-authored intent with its Message and the delivery intent with the link. Confirm the link before releasing the authored intent. Test response compatibility, conflicting input, concurrent attempts, loss of the first acknowledgement, and keyed versus unkeyed dispatch after error.
2. Make provider success and sent-event intent atomic. Fence legacy work and test post-send publication failure, provider-accepted queued status, ambiguous provider acknowledgement, and stale pending recovery with zero duplicate sends.

### Phase 3 — Messages audit and rollout

1. Document the ordinary Messages commit, enqueue, and consumer guarantees for compose, draft-to-sent, reply, and forward. Verify that channel repair does not touch ordinary Messages. Record any gaps for a separate follow-up.
2. Test rollback and replay on both queue strategies, including recovery of channel-authored confirmation across its module boundary. Document deployment, diagnostic output, and how to pause dispatch while preserving pending work.
