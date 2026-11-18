# Record retention: notifications and assistant conversations

> **Program:** first part of package D3 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** the `privacy.ts` convention and the `privacy` module from [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md). **Consumed by** [`enterprise/GDPR/2026-11-16-privacy-dsr-engine.md`](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md).
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/GDPR/2026-11-16-privacy-data-class-contract.md

## 📝 TLDR

A notification stays in a user's inbox forever, whether read, acted on or dismissed. An assistant conversation that a user deleted stays in the database forever; its delete route says a future worker will purge it. Both hold personal data, and nothing says how long either lives. The operational pruners cover tables nobody reads; these are tables people do read, so the rule for what may go has to come from the module that owns them. **Proposed (future):** a module may declare a *retention set* — a group of its own records that can be deleted by age — and implement one method that deletes a batch. An operator command runs it, in preview by default. Notifications, assistant conversations and unreferenced chat drafts are the first sets. Every run is tenant-scoped; privacy evidence always carries its tenant. Nothing is deleted unless an operator, or the enterprise policy engine, asks.

**Not in this spec, and each needing its own:**

- **Change history.** Deleting it ends undo, version history and the restoring of deleted records, and would also delete the record of erasures. Maintainers have said its pruning belongs in Enterprise (#2980).
- **Inactive contacts and portal users.** That is erasure of people by age, with its own questions about what "inactive" means and how failures are remembered.
- Messages, inbox email and call records, which wait for the communication coverage spec.
- Per-tenant policies, schedules and holds, which are the enterprise engine's.

## 📝 Overview

> **Market reference.** Microsoft Purview and Google Vault both express retention as "this category, this age, delete or keep", evaluated by the service that owns the content, with a preview of what would go. Mattermost ships the same for messages, with a per-category window and a nightly job. Adopted: a declared category, an age, a preview. Rejected: one global window, and deletion by a component that does not own the data.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Who decides the window | The caller. This spec ships no default window and no schedule | Shipping only the module-owned method and a manual command keeps the OSS part to what cannot live anywhere else. |
| 2 | Edition | The declaration, the module-owned handlers, `privacyRetentionService` and the command in OSS; schedules, tenant policies and holds in Enterprise | Program DEC-2 settles it. The tables belong to OSS modules, so their handlers live there; an enterprise-only build would have to reach into core tables. The manual command keeps retention usable on every deployment. Schedules and per-tenant policy are governance, which D5 adds on the same service. |
| 3 | Is a retention set a data class | No. A separate declaration in the same file | A data class must name subject kinds and take part in export and erasure; the erase run refuses a kind unless every class declaring it can erase. A set of rows to prune by age is neither. |
| 4 | Which notifications may go | Read, acted on or dismissed, and older than the window; also an unread notification whose `expires_at` is older than the cutoff. An unread notification with no expiry stays until its status changes | Eligibility uses the stored status and expiry time. The existing expiry command is never scheduled, so the set does not depend on it: an unread row that expired longer ago than the window is treated as dismissed-then-deleted. Expiry cleanup itself is unchanged. |
| 5 | Soft-deleted rows | A second target a set may declare | Only the owning module knows when its soft-deleted rows are safe to remove. |
| 6 | Whose records can be left out | Each set names, in `excludableSubjectKinds`, the subject kinds whose records its handler can leave out under its declared matching rule; the first sets cannot fully attribute mentions and declare none. R5-10 protects pending-action staff links by creator, approver/resolver and typed target, with payload-only mentions outside that rule. A subject to leave out of any other kind makes the run skip the set, with reason `hold_not_honourable` | A hold on a person can then spare the records that are plainly theirs. A person merely mentioned in a notification's text cannot be spared, so a hold on such a person stops that set instead of being ignored. R5-10's narrower pending-action protection has the explicit payload-mention limit below. |
| 7 | Legal holds in a manual run | Resolve the tenant protection state and Enterprise guard before every batch. A protected tenant with an unavailable guard refuses. Positively verified ordinary OSS also takes the operator’s explicit `--exclude-subject` | The common resolver protects both erasure and retention. |
| 8 | Chat uploads never sent | A separate `attachments.unreferenced_chat_drafts` set releases unlisted `ai-chat-draft` uploads past a caller-supplied window with a 30-day floor; no default schedule | The attachments module owns uploads and cannot attribute them to a user. A tenant-wide reference check through the assistant service prevents deletion of a listed upload. Any subject hold skips this set. |
| 9 | Retention-run evidence age | Delete terminal `privacy.retention_run` entries after 365 days by default, floor 30, through `privacy.retention_evidence`; unresolved work and active holds postpone expiry | The program sets every privacy evidence age to 365 days by default, floor 30. It is an accountability default, not a legal period; a controller sets another finite age through R3-3. The generic `privacy.` exclusion in history sets is never unlimited permission to keep this evidence. |
| 10 | Evidence about a soft-deleted tenant | Runs stay tenant-scoped. `run` validates the tenant id's format and scope, not that the tenant is active, so a soft-deleted tenant's sets run normally | Tenant deletion is a soft delete (`directory/commands/tenants.ts`), and under R4-3 every `privacy.tenant_export` entry carries its tenant. No privacy evidence set needs a run without a tenant, and `PrivacyScope` stays tenant-required. |

## 📝 Problem Statement

| Table | Age column | Cleanup today | What reads old rows |
|---|---|---|---|
| `notifications` | `created_at`; `expires_at` is indexed; `created_at` only inside an index led by recipient and status | A command that marks expired ones dismissed. It never deletes and has no schedule (`notifications/lib/notificationService.ts:959-993`; `cli.ts:5-12`) | The notification inbox |
| `ai_chat_conversations`, `ai_chat_messages` | `last_message_at`, `created_at`, `deleted_at`; an index on tenant, organization and `deleted_at` | Soft delete only (`ai_assistant/data/repositories/AiChatConversationRepository.ts:343-364`). The delete route's text promises a future retention worker (`api/ai/conversations/[conversationId]/route.ts:84-89`) | Chat history |

- **Notification statuses** are `unread`, `read`, `actioned` and `dismissed` (`notifications/data/entities.ts:5`). There is no "expired" status; expiry is a time. `notifications` has no `deleted_at` and no encryption map.
- **A conversation owns more than messages.** Pending actions point at it (`ai_pending_actions.conversation_id`, same module), and messages list attachment ids.
- **A conversation's files are not attached to it.** The chat's upload adapter stores each file under the entity id `ai-chat-draft`, with a record id minted in the browser (`packages/ui/src/ai/upload-adapter.ts:16, 346-347`), and nothing on the server re-links it. Only the ids survive, in `attachment_ids` on messages and pending actions (`ai_assistant/data/entities.ts:182-183, 923-924`). A release by record (`releaseForRecord(entity, conversationId)`) would find nothing and report success.
- **The contract has no place for this.** A data-class definition requires at least one subject kind and one of the actions discover or export (contract spec, `privacyDataClassDefinitionSchema`), and the erase run's pre-flight refuses a kind when a class declaring it cannot erase.
- **Attachment ids are untrusted.** The chat route persists `input.attachmentIds` as supplied (`ai_assistant/api/ai/chat/route.ts:321-328`). Scope and entity checks do not establish ownership; attachment rows have no uploader column (`attachments/data/entities.ts`).
- **Conversation ids can be reused.** Their unique indexes cover live rows only; `createOrGet` ignores a soft-deleted row (`ai_assistant/data/entities.ts`; `data/repositories/AiChatConversationRepository.ts:137-160`). Children carry the client-visible id, rather than the conversation row id.
- **Nothing in the first sets needs a tenant setting**, because the window comes from the caller. Other sets may require a policy or setting and enforce it inside their handler.

## 📝 Proposed Solution

### The declaration

The default export of `privacy.ts` gains an optional member, `retentionSets`. Each set has:

| Field | Meaning |
|---|---|
| `id` | `<module>.<name>` |
| `title`, `ageBasis` | Locale keys: what the set is, and one sentence saying what "age" means for it |
| `minimumDays` | The shortest window the set accepts |
| `targets` | `records`, `softDeleted`, or both |
| `excludableSubjectKinds` | The subject kinds whose records the handler can leave out when given `excludeSubjects`. An empty list means it can leave out no subject |
| `handlerService` | The DI key of the handler |
| `runEvidence` | Optional `standard` or `aggregate`, default `standard`; the declaration chooses the shared driver’s evidence projection, never the caller |
| `unmatchedHoldsOptOut` | Optional `'allowed'` or `'forbidden'`, default `'allowed'`. `'forbidden'` marks a set whose evidence cannot be released by the engine's `allowUnmatchedHolds`; the engine's policy validation refuses the opt-out for it and `run` refuses an `enginePolicy` with `allowUnmatchedHolds: true` for it. R3-2 validation accepts only those two values |

### The handler

One method, `pruneRecords`. It receives a scope, a window, a fixed cutoff, a target, a batch limit, a keyset position, exclusions and a dry-run flag. It commits at most one batch and returns counts, pending-file count, the next position and completion. A dry run writes nothing and advances the same keyset. Only `privacyRetentionService.run` drives it, including for the enterprise engine.

Rules every implementation follows:

- It touches only its own module's tables, or calls the owning module's service where the records belong to another module.
- It refuses a batch it cannot run safely by rejecting it before commit with a bounded reason code, such as a window below its minimum, a missing prerequisite, `reference_source_unavailable`, a missing or unavailable completion check, or malformed or unidentified evidence; the batch rolls back and `run` returns `status: 'refused'` with that code.
- It refuses a window below its minimum. A handler's minimum may come from a tenant setting, such as the tenant's legal-retention age; it then refuses a shorter window, and refuses every window while that setting is unset.
- A handler may blank or reduce records in place instead of deleting them. The `deleted` count then counts roots processed, once per root, rather than physical deletes or changed child rows. Coverage handlers collect their current record footprint and strip it within each batch before and after blanking, through **DEC-B — The audit-history strip routine** and **R3-1 — The audit-history rule for every erasure**, owned by the erasure spec's **Audit history — `audit_logs`**. They use the batch transaction, write no snapshots of removed values and roll back on a failed or skipped strip. Subject erasure's run-wide two passes remain the erasure owner's routine.
- Each batch is its own transaction. The service fixes the eligibility cutoff once as `runStartedAt - olderThanDays` in UTC and carries it with the continuation; handlers compare their declared age column with that timestamp, without subtracting the window a second time. Each handler orders by an immutable unique key, normally `(created_at, id)`, never by offset. The opaque position binds the tenant, organization, set, target, window, cutoff and exclusion digest to the last examined key. A mismatch is refused; a resumed run uses the saved cutoff. Limits are validated integers from 1 to 100.
- The handler enforces every module-specific prerequisite on every batch, including a required active policy. The command cannot bypass it by supplying a window.
- After each committed batch, the service completes post-commit cache work and drains pending file deletions before recording success; see R3-8 below.
- It never returns or logs an identifier.
- A dry-run batch may return `warnings`: bounded machine codes for a condition that would make the same apply batch refuse, such as `REPLAY_ROLLOUT_UNCONFIRMED`; never identifiers or free text.
- It leaves out the records of the listed subjects, for the kinds it declared.

Sets from every enabled module follow these rules. `getRetentionSets` reads `privacy.retentionSets` under **R3-2 — The registry carries the whole `privacy.ts` default export**, in the contract spec's **Architecture → Components** and **Phase 1 — Contract and discovery**. The registry is the inventory; the consuming-set catalog below records handoffs without replacing it. Settings needed by another set use **R3-3 — Tenant privacy settings live in `module_configs`**, in the contract spec's **Tenant privacy settings** and **Phase 7 — Settings and bounded export evidence**.

Any `retention_bounded` table classification must resolve the deleting owner's local `privacy.ts.retentionBounds` metadata from [table coverage](2026-11-16-privacy-table-coverage.md), **Declarations and row subsets** and **API Contracts**. A `kind: 'retention_set'` bound names the actual `retentionSetId` and exact table/subset, allowed `columns`, `ageAnchor` and `eligibility`; a set id or translated `ageBasis` alone is insufficient. Consume that owner's `PrivacyRetentionBoundHandler.resolve({ scope, boundId, now, em })` projection for the effective window, mode/counting grace and enabled/scheduled/worker state, and `evaluateFixtureRow` for the captured row on the supplied read-only manager. Missing metadata or evaluation blocks verification; off, unscheduled, unavailable and pending states report their actual enforcement gap. This references C5's existing bound contract and adds no bound id or alternate retention runner.

The [inactive-subject spec](2026-11-16-inactive-subject-retention.md), **API Contracts**, separately owns the additive `subjectRetentionSets` and `activitySources` members and `privacyRetentionService.listFilteredCandidates`, `evaluateCandidates` and `eraseCandidates`. Those methods share this service's registration; they do not become `pruneRecords` handlers. Explicit candidate evaluation checks only supplied references and fails closed on a missing required source or unknown result. `eraseCandidates` rechecks eligibility and uses **R3-14 — The `eraseSubjects` entry point** with `related: 'skip' | 'exclude'` only, under **R3-13 — No `related_subjects: include` anywhere**. This spec does not define a second candidate contract or copy the forms-specific matcher from **R3-5 — Holds, honestly**.

### The command

`mercato privacy retention --tenant <id> --set <id> --older-than-days <n> --reference <text> [--target records|softDeleted] [--exclude-subject <kind:id> …] [--max <n>] [--after <cursor>] [--apply]`

Preview by default: it walks the set up to `--max` roots and prints the count; when it stops at `--max` it reports the count as a lower bound ("at least") with a continuation, never as a total. With `--apply` it processes up to `--max` roots. The maximum is an integer 1–1000, default 1000, with database batches of at most 100. For standard sets, apply writes two audit entries under `privacy.retention_run`, both with the same random retention-run UUID as resource id. The started entry is written before the first apply batch, with the set, the window, the target, the fixed cutoff, the number of exclusions, validated selection proof metadata described under Retention-run evidence, the reference and `status: 'running'`; if it cannot be written the run refuses before any batch. The terminal entry is written at the end with the counts, `filesPending`, preserved shared-file count, the terminal status, required-side-effect status, refusal or skip reason and the reference. Preview writes neither. No attachment id or storage coordinate is logged. Evidence-expiry sets select the shared aggregate path below through their declaration; the command and engine cannot replace it with ordinary actor/reference/run evidence.

`--tenant` is required. The command and `run` validate the tenant id's format and scope, not that the tenant is active; a soft-deleted tenant's sets, including its evidence sets, run normally, because tenant deletion is a soft delete (`directory/commands/tenants.ts`). No form of the command runs without a tenant.

### Legal holds

Under **DEC-C — Retention sets and holds**, before preview and before each apply batch, the service builds the list of subjects to leave out:

1. the `--exclude-subject` values, repeatable;
2. the subjects returned by `excludedSubjects({ scope, setId })` on the guard resolved by `privacyHoldProtectionService.requirePrivacyHoldProtection({ tenantId })`. Use the tenant’s guard even for an organization run. A guard exception refuses before the first count or write, or before the next batch with committed counts preserved. The ordinary OSS result uses only explicit exclusions.

**Durable guard requirement.** The OSS `privacy` module owns `privacyHoldProtectionService` and the internal tenant-only, no-organization `moduleConfigService` record `privacy.holdProtectionRequired`. The resolver accepts the available, validated Enterprise guard for the requested operation. It reports `unprotected` only when the exact tenant’s readable protection state is positively clear and the composition does not expect a guard. A protected, unknown, unreadable or missing-in-an-expected-composition state with no valid guard throws `guard_unavailable`. No tenant settings endpoint, environment flag or CLI override clears this state. Ordinary OSS provisioning records a clear baseline; upgrades backfill it only for positively verified never-protected tenants. Keep destructive writers stopped during the upgrade until the Enterprise owner latches all existing held tenants and verifies the migration. If prior protection cannot be established, keep the tenant unknown until authorized reconciliation.

Before accepting its first hold, the Enterprise owner durably sets the record to required; a failed write refuses hold creation. The marker remains when the Enterprise module or its guard registration disappears. Only the Enterprise owner may clear it after an authorized, audited reconciliation proves no live or stale hold remains under the same tenant hold-mutation fence. Apply the resolver before preview and every destructive batch in record retention, forms retention, and C4 erasure with each operation’s own guard contract. A guard disappearing between batches returns `guard_unavailable` and preserves committed counts. Check the durable state again on retries, through both OSS and Enterprise entry points.

Without the validated engine exception below, if any subject on the list has a kind outside the set's `excludableSubjectKinds`, the run skips the set — result `status: 'skipped'`, `reason: 'hold_not_honourable'`, `complete: false`, CLI exit 1 — and counts and deletes nothing. The engine records the same result as a skipped pass. This fails closed: a held person the set cannot attribute records to stops the set for that tenant. Otherwise the list is passed to every `pruneRecords` call as `excludeSubjects`.

The service canonicalizes the list and checks it again before each apply batch. If the guard fails or the list changes, it stops before the next write, reports committed counts and `hold_guard_failed` or `holds_changed`, or the typed `guard_unavailable` when the required protection cannot be resolved, and requires a fresh preview; it does not roll back completed batches. A new hold is protected from the next batch. A hold committed after a batch's check can affect that batch; hold activation is not atomic with module writes.

The command and the enterprise engine both call `privacyRetentionService.run`. The typed in-process entry below carries the engine's validated per-policy `allowUnmatchedHolds` decision. Only unsupported kinds returned by a successful guard may pass under that decision. The decision never lifts an explicit exclusion: an operator or caller exclusion of an undeclared kind still skips the set with `hold_not_honourable` (status `skipped`, exit 1). Guard errors, stale holds, class-hold refusals and explicit set holds remain refusals. The command supplies no engine policy context and has no opt-out, even if a stored policy enables the flag. For a set declaring `unmatchedHoldsOptOut: 'forbidden'`, `run` refuses an `enginePolicy` with `allowUnmatchedHolds: true` before anything is counted, with reason `unmatched_holds_forbidden`. The first sets below declare no excludable kind: an `auth:user` hold also stops them because that user may be mentioned in someone else's text. The DSR engine owns **R3-10 — One definition of a stale hold**; this service never catches a refusal and turns it into an empty exclusion list.

### First sets

| Set | Age | Floor | What goes | Can leave out (`excludableSubjectKinds`) |
|---|---|---|---|---|
| `notifications.inbox` | `created_at`; for an unread row, `expires_at` | 30 days | Read, acted-on or dismissed notifications, including those dismissed by expiry cleanup, and unread notifications whose `expires_at` is older than the cutoff | `[]`: any subject hold skips the set |
| `ai_assistant.conversations` — `records` | `last_message_at`, or `created_at` without a message | 30 days | Conversation rows and their own messages, participants and pending actions; safely releasable listed files | `[]`: any subject hold skips the set |
| `ai_assistant.conversations` — `softDeleted` | `deleted_at` | 30 days | The same, restricted to the deleted incarnation | `[]` |
| `attachments.unreferenced_chat_drafts` — `records` | Attachment `created_at` | 30 days | `ai-chat-draft` uploads not listed in any surviving assistant message or pending action | `[]`: uploads have no uploader column |

Set ids and data-class ids have separate registries. `notifications.inbox` and `ai_assistant.conversations` deliberately reuse the corresponding class id to name the same content; a set lookup never falls back to a data-class lookup.

### Consuming-set catalog

These are `records` sets defined by their linked owners. Their owners supply the handlers, prerequisites and exact eligibility tests; every committed batch uses R3-8 below.

| Set | Owner and age | Floor | Effect and excludable kinds |
|---|---|---|---|
| `checkout.finished_open_payments` | [Commerce coverage](2026-11-16-privacy-coverage-commerce.md), retention sets: terminal marked payments, using stable `privacy_open_case_at` | 1 day | Reduce a completed payment for legal retention, or blank it when due; blank failed/cancelled/expired payments. Pending/processing survive. `[]` |
| `warranty_claims.retained_open_claims` | Commerce coverage, retention sets: marked closed/cancelled claims, using `closed_at`, or stable `privacy_retained_at` when absent | 1 day | Blank through the closed-claim routine, strip current history and release files; remove mark. `[]` |
| `eudr.retained_records` | [Content-ai coverage](2026-11-16-privacy-coverage-content-ai.md), **Producers named on EUDR records**: statement submission, latest linked retained statement for plots | 1825 days, plus exact configured calendar-year date | Recheck stored due date/current statements and apply saved erasure preference; not an age from the erasure marker. `['eudr:plot_producer', 'eudr:evidence_producer']` |
| `ai_assistant.pending_actions` | Content-ai coverage, **Pending assistant actions**: `resolved_at` of terminal confirmed/cancelled/expired/failed actions, including standalone rows | 30 days | Never pending/executing; release safe files through the shared assistant routine. `['auth:user']` under R5-10: creator `created_by_user_id`, approver/resolver `resolved_by_user_id`, or a typed staff-user target in `(target_entity_type, target_record_id)` or `records[].entityType` / `recordId`. Payload-only mentions are unprotected; a customer hold fails closed with `hold_not_honourable` |
| `privacy.export_evidence` | [Contract spec](2026-11-16-privacy-data-class-contract.md), **Export-evidence expiry**; effective `retention.privacy.exportEvidenceAgeDays` | Owner-defined | Whole subject-export/request evidence entries; owner-declared root kinds plus `privacy:identifier`, with whole-set skip for subject holds or explicit exclusions |
| `privacy.settings_evidence` | Contract spec, **Settings-command evidence expiry**; effective `retention.privacy.settingsEvidenceAgeDays`, anchored to successful terminal `completed` | Owner-defined | Whole `configs.module_config` / `privacy.settings.set` operation-UUID groups; failed/conflicting, held or unresolved groups stay. `[]` |
| `privacy.tenant_export_evidence` | [Tenant exit](2026-11-16-tenant-exit-export.md), **CLI, audit and output — Tenant-export evidence expiry**: terminal completion of settled lifecycle groups; effective `retention.privacy.tenantExportEvidenceAgeDays`. Under R4-3 every entry carries its tenant, so tenant runs reach all of it, including a soft-deleted tenant's | 30 days | Whole settled `privacy.tenant_export` groups; unresolved publication or reconciliation stays. `[]`, `runEvidence: 'aggregate'` |

Both closure sets use stable markers so later polls/edits cannot reset age. In-place reduction counts roots processed as `deleted`; coverage handlers perform the current-history strip described above, including provider-owned child records through their services. The content-ai owner supplies EUDR's `retention.eudr.recordAgeYears` under R3-3; this catalog supplies no second setting or schedule.

### Pending-action staff exclusions

R5-10 defines the `ai_assistant.pending_actions` staff matching rule. For every held or explicitly excluded `auth:user`, the assistant-owned handler leaves the whole action out when `created_by_user_id` or `resolved_by_user_id` names that user, or when the typed pair `(target_entity_type, target_record_id)` names that staff user. A batch action is also left out when any decrypted `records[].entityType` / `recordId` pair names that user. Match type and id together, never a bare record id. These checks apply to standalone and conversation-linked actions, in preview and under the per-batch guard/exclusion recheck on apply. An action created by someone else is protected when the held user is its approver/resolver or target; no part of that excluded action or its attachment list is pruned.

Content-ai coverage still owns the handler, terminal-state eligibility and shared file-release routine. Its **Pending assistant actions** and `privacy-pending-action-retention.test.ts` must use this R5-10 rule rather than creator-only matching. Neither spec claims to recognize arbitrary staff mentions inside `normalized_input`, `field_diff`, prose or opaque payloads. Those mentions alone remain unprotected by selective staff exclusions; changing that requires a separate design owned by content-ai coverage. Unsupported customer/identifier kinds continue to skip the set with `hold_not_honourable`, subject only to the existing validated engine exception. The first sets above still declare `[]`, so their staff holds skip the whole set.

### R3-7 — Chat file release honours other conversations

The shared assistant deletion routine collects `attachment_ids` before removing messages and pending actions. Before calling `releaseByIds`, it scans its own message and pending-action tables throughout the tenant, including soft-deleted rows not selected in this batch and standalone actions with no conversation. An id still listed outside the exact rows being deleted is removed from the deleted rows only, counted as `filesShared`, and never released. A standalone action being pruned is treated as its own selected row, never as a missing conversation that permits release. The check covers a maliciously injected colleague's id and a legitimately shared id. Attachment scope, organization and `expectedEntityId: 'ai-chat-draft'` checks still apply through the owner service; the attachment service's shared-storage check is additional protection, not a replacement for this scan.

All assistant writes of attachment lists, including message append, import and pending-action persistence, and every file-release path, including standalone-action retention, use the same tenant-scoped transaction advisory lock. They acquire it before reference checks and hold it through commit; writes recheck that each referenced attachment is still available through `attachmentService`. Thus a newly committed reference cannot appear between the surviving-reference check and release. Locks live in the assistant module; no caller reads attachment tables directly. The content-ai erasure class calls this same routine and uses R3-7 unchanged.

**Lock and statement bounds.** The tenant reference lock is a transaction advisory lock taken through `withAdvisoryXactLock` (`@open-mercato/shared/lib/db/advisoryLock`), so it is released at every batch commit and never held between batches. Retention batches and every assistant writer that takes it pass `waitDeadlineMs: 5000`; a writer that cannot acquire it in time fails with the helper's `AdvisoryLockUnavailableError` and returns a retryable error (the chat and import routes answer 503 with a retry hint) instead of blocking. Inside the lock a retention batch sets `SET LOCAL statement_timeout = '30s'` and `lock_timeout = '5s'` and is capped at 100 roots and a 30-second budget; on a timeout it rolls back, and the service stops with `incompleteReason: 'reference_lock_timeout'` and the batch's retry position. The tenant-wide scan uses GIN `jsonb_path_ops` indexes on `ai_chat_messages.attachment_ids` and `ai_pending_actions.attachment_ids` (see Data Models), so it costs one index probe per candidate id rather than a table scan.

**Attachment-library assignments are live references.** The attachments library lists every upload in a tenant and organization, whatever its owner entity (`attachments/api/library/route.ts`), and `PATCH /api/attachments/library/:id` writes `storageMetadata.assignments` (`api/library/[id]/route.ts`). The access registry and target access service treat those assignments as links to other records (`lib/access-registry.ts`, `lib/target-access-service.ts`). Every upload starts with one assignment, its own primary pair `{ type: 'ai-chat-draft', id: <record id> }`. The attachment owner's release path — `releaseByIds` with `expectedEntityId: 'ai-chat-draft'`, used by this routine, by the chat-draft set's release callback and by content-ai conversation erasure — rechecks each row under its row lock and treats any assignment other than that own primary pair as a live reference. It skips the id, reports it as shared so the caller counts it in `filesShared`, and releases neither row nor bytes. This mirrors the existing `releaseScoped` refusal (409) when other assignments remain (`attachments/lib/attachment-service.ts`). The assistant-side scan cannot see assignments and does not try; the check is the owner's.

### Conversation rows and concurrent writes

The routine also locks each selected conversation row, then rechecks tenant, organization, target, deletion state and age against the fixed cutoff before touching children. Append and soft delete acquire the same row lock before their accessibility check; creation of a reused client id uses the same scoped conversation-id lock. If append wins first, its new activity makes the conversation ineligible. If retention wins, append rechecks after waiting and refuses the missing or deleted conversation without inserting a message.

Children match the exact tenant, organization and `conversation_id`, with `created_at >=` the selected row's `created_at`. For a deleted row they also have `created_at <= deleted_at`; later children of a reused live id survive. The routine enumerates every incarnation before deletion. If intervals overlap or children cannot be assigned safely, it skips that incarnation with `ambiguous_conversation_children`, releasing no files. It never deletes a live incarnation merely because an older row has the same id.

### Unreferenced chat drafts

The attachments module owns `attachments.unreferenced_chat_drafts`. Its handler selects only scoped `ai-chat-draft` uploads older than the fixed cutoff. It calls the new assistant-owned `assistantAttachmentReferences.withUnlistedIds` service through DI, which takes the same tenant lock, scans all message and pending-action attachment lists, and invokes the attachment owner's release callback only for unlisted candidates before commit. It never returns transcripts. Missing assistant registration or a failed scan refuses with `reference_source_unavailable`; no fallback query crosses module boundaries. The attachment owner rechecks scope, age and entity under lock, releases through its existing ownership and shared-object machinery, and queues durable deletions with the set's origin. A newer upload, a listed upload, an upload assigned to another record through the attachment library and any upload outside the exact scope survive; an assigned upload is counted as shared. This is an explicit manual/scheduled retention target; no new automatic deletion starts on upgrade.

### Notification cache

For each committed notification batch the owner collects distinct affected `(tenant_id, organization_id)` pairs and calls its existing `invalidateNotificationCache(..., 'deleted')` in `notifications/lib/notificationService.ts`. The handler lives with that helper or shares a module-local helper; it does not duplicate cache tags. A failed invalidation makes the run incomplete, retains the affected scope pairs in the continuation, and retries them before advancing. A caller resuming that continuation retries those scopes even when no notification rows remain. Dry run never invalidates.

### R3-8 — Retention drains its own pending file deletions

`privacyRetentionService.run` calls `drainPendingDeletions(scope, { origin })` for `origin: 'privacy:retention:<setId>'` after every committed batch, regardless of whether the caller is the command or the enterprise engine. In apply mode it also retries that origin's backlog at entry, including a resumed run with no matching rows. Preview never drains or writes. The handler releases rows and enqueues deletion coordinates in its transaction; provider deletion runs only after commit. File-producing sets require the erasure seam at pre-flight; a set without files can run when attachments is disabled, with zero pending files and no drain capability to invoke. The service reports the remaining `filesPending` and a failure makes the command exit 2 and the engine pass incomplete. A later run or the attachments drain command retries the durable coordinates. The engine adds no separate drain. The declaration alone never implies success while files remain pending.

### Aggregate evidence for expiry runs

The shared driver owns both evidence projections. `PrivacyRetentionSetDefinition.runEvidence` is optional, defaults to `standard` and is validated once with the declaration under R3-2. Declare `runEvidence: 'aggregate'` on `privacy.retention_evidence`; [C1’s **Export-evidence expiry**](2026-11-16-privacy-data-class-contract.md) and [the export-audit spec’s **Export-evidence expiry**](2026-11-16-export-audit-event.md) must select it on `privacy.export_evidence` and `audit_logs.export_evidence` respectively. Other dedicated evidence-expiry owners use this same selection. This is not an input flag, a handler logger or permission to suppress runner evidence.

For `aggregate`, `privacyRetentionService.run` builds the exact `PrivacyRetentionAggregateSummary` below from validated set id, counts, invocation dates and the run's outcome (`status` and, when not complete, a `reason` from the bounded `PrivacyRetentionAggregateReason` enum), using a strict zod schema with no passthrough. It calls `actionLogService.log` itself under resource kind `privacy.retention_run`, static command id `privacy.retention.run`, resource id equal to the validated set id and the trusted invocation tenant/organization. Besides the audit row’s intrinsic database id, scope and timestamps, the only variable evidence is that summary. Pass null actor/on-behalf-of, parent/related pairs and undo token; omit payload, before/after snapshots and changes. Never spread caller, handler, command or engine context into it. In particular, no reference, actor id, export/request id, subject id, prior run id, policy id, continuation, error text or attachment coordinate is copied into context, labels or projections. The required caller `reference` is still validated for invocation consistency, but is not persisted by this branch. Standard sets retain their ordinary run evidence.

Preview writes no expiry summary. Apply requires the audit logger at entry and writes one aggregate summary for the bounded invocation, including zero-change, refused, skipped or incomplete outcomes, using only its actual counts, dates, status and bounded reason; free-text detail and retry positions stay in the immediate result. Handler `incompleteReason` strings are mapped to `handler_incomplete` and handler refusal codes to `handler_refused`, never copied. A process killed between a committed batch and the summary write leaves that batch's deletions without a summary; the deleted rows were themselves expiring evidence, and the next invocation does not count them. This is a stated residual, not a silent success. Missing logging capability refuses before pruning; a later write failure reports `complete: false`, `status: 'incomplete'`, `reason: 'evidence_write_failed'` with committed counts and retry position preserved. A summary is not successful deletion proof by itself. Neither command wrappers nor the engine add a second identifying `privacy.retention_run` entry for this invocation. Handlers return counts through `pruneRecords` and never bypass or duplicate the driver’s logger. Export-evidence expiry waits until this path and its tests ship.

### Retention-run evidence

This spec owns expiry of `privacy.retention_run`, including the inactive-subject command's entries. Declare `retention.privacy.retentionEvidenceAgeDays` in `privacy.ts.settings`: integer, unit days, minimum 30, default 365, through R3-3. Declare `privacy.retention_evidence`, target `records`, floor 30, `excludableSubjectKinds: []`, handler `privacyRetentionEvidenceHandler`, `runEvidence: 'aggregate'`, `unmatchedHoldsOptOut: 'forbidden'`. It uses `privacyRetentionService.run` and the audit owner's DEC-B method with the exact `includeResourceKinds: ['privacy.retention_run']`, `mode: 'delete'`, scope, fixed cutoff, cursor, limit and dry-run flag. It never queries audit tables. The effective age must satisfy both the setting and caller window. The audit owner lists candidate metadata through `actionLogService.list`; strict aggregate summaries of the shape above are terminal count evidence and expire at the same finite age, including summaries from this set itself. An aggregate summary's resource id equals its validated `setId`, so DEC-B can select or exclude that pair without adding a run identifier. Malformed or unidentified evidence refuses the evidence batch before the delete call; never infer completion from a missing ordinary run UUID or delete an unvalidated summary by kind alone. A standard started entry without terminal evidence is unresolved. Persist a versioned selection digest over canonical scope, set, target, fixed cutoff, handler selection inputs, explicit and guard exclusion identities (and validated engine opt-out), and the initial cursor/continuation. Use a tenant-bound keyed digest so entries expose neither identities nor raw cursors. Resume only with reproduced inputs and proven continuity from the original initial cursor; associate the terminal receipt with the original run UUID. The audit owner settles it only on a verified complete receipt for that exact selection, including every bounded segment and all required side effects, or an authorized audited reconciliation that independently proves original selection completion. A later normal run, higher cutoff, broader exclusions, missing original proof metadata or zero candidates leaves it unresolved. Age then starts at the settled receipt. For standard entries, exclude an unresolved run by the exact pair `{ resourceKind: 'privacy.retention_run', resourceId: retentionRunId }`, preserving that identity across its entries, never a bare UUID or a child R3-14 erasure `runId`. A missing or unavailable completion check refuses the evidence pass. Whole-entry deletion removes actor, reference and context as well as the resource id; only aggregate counts, dates and set id survive in a separate summary, without subjects, preview contents, retention/erasure run ids, actor or free-text reference.

For inactive-subject entries, consume the aggregate audit metadata owned by [inactive-subject retention](2026-11-16-inactive-subject-retention.md), **API Contracts**: `status: 'running' | 'complete' | 'stopped' | 'incomplete' | 'refused'`, `terminal: boolean`, `requiredSideEffects: 'complete' | 'pending' | 'failed'`, `filesPending: number` and `continuationPending: boolean`. Only settled terminal evidence is eligible. Running/incomplete work, pending files, failed/pending required effects, a continuation of committed unfinished work and missing/invalid completion metadata remain unresolved; a zero remaining candidate count never proves success. A capped invocation can be `stopped` and terminal only when all work it began is settled. These completion fields do not redefine that owner's candidate/activity contracts or the child erasure result.

An active hold or explicit exclusion skips this evidence set; a guard failure refuses. Its `unmatchedHoldsOptOut: 'forbidden'` declaration makes the engine refuse the opt-out at policy validation and `run` refuse it with `unmatched_holds_forbidden`, and the evidence handler itself refuses any non-empty `excludeSubjects`, so the engine's unmatched-hold flag does not override evidence preservation. A later pass after release uses the original evidence age. No scheduler is introduced here: the operator must schedule the command, or enable the engine policy. An unconfigured runner or unresolved work means the finite target is not yet enforced and is reported as such. Generic history sets still exclude `privacy.`; their exemption is separate from this dedicated owner expiry. Every run of this set is tenant-scoped, including for a soft-deleted tenant. Rows with no tenant, such as the action-log system pass's `system-history:<run UUID>` summaries, stay with their own owners.

### Design decisions

| Decision | Rationale |
|---|---|
| A separate registry | See assumption 3. |
| The caller supplies the window | One implementation serves the manual command and the enterprise engine. |
| A floor per set | Each has readers that assume some history. |
| A position in and out | Without one, a dry run with a limit returns the same batch for ever and a preview cannot count past it. |
| Attachments are released through their owner, by id | The assistant module must not delete from the attachments table. Chat uploads are not attached to the conversation, so the handler collects the ids from `attachment_ids` on the conversation's messages and pending actions before it deletes them. It applies R3-7 and passes only unshared ids to `releaseByIds` with `expectedEntityId: 'ai-chat-draft'` in the same transaction; the owner additionally keeps any upload assigned to another record. |
| `ageBasis` is text | A person must be able to read what a window means before choosing one. |
| A subject the set cannot leave out stops the set | Ignoring it would delete a held person's records by age. Skipping only delays retention. |
| The guard is optional and soft, and fails closed when present | Without the enterprise engine there are no holds; with it, a guard that cannot answer must not be read as "no holds". |
| Every run is tenant-scoped, including for a soft-deleted tenant | Privacy evidence always carries its tenant, so no set needs a run without one. See assumption 10. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Model these as data classes | See assumption 3. |
| Instance-wide windows from environment variables, on a schedule | The path #2980 took for change history, which maintainers placed in Enterprise. |
| One generic purge of every soft-deleted row | No shared rule for when a soft-deleted row is safe to remove. |
| Letting the engine delete by SQL | It would have to know every module's tables. |
| Include change history and inactive contacts | Each is a decision of its own; see "Not in this spec". |
| No retention-run evidence expiry until the controller sets an age | Evidence would stay unbounded wherever nobody sets one; a finite default with a floor protects by default and stays configurable. |
| A nullable tenant in `PrivacyScope` | Every scoped method in the program would then accept "no tenant", and no retention set needs it. |

### Known limits

- Holds exist only when the enterprise guard is installed, as **R3-5 — Holds, honestly** requires in the program spec's **Known limits**. OSS operators can supply explicit exclusions; because the first sets cannot protect every mention, any supplied subject skips those sets.
- A subject mentioned only in text cannot be attributed reliably. All first sets therefore declare `excludableSubjectKinds: []`; tenant-wide skips may delay retention for a long hold.
- R5-10 protects pending actions through explicit creator, approver/resolver and typed target links, including batch targets. A staff user mentioned only in payload text remains unprotected by that set's selective exclusions; content-ai coverage owns any design to cover those mentions.
- An unread notification with no `expires_at` stays until it is read, actioned or dismissed; one whose expiry is older than the cutoff goes with the set, without depending on the unscheduled expiry command.
- Unreferenced chat drafts need an operator run or an enterprise policy. A listed upload remains until every referencing record is removed; no uploader-based subject erasure is claimed.
- Evidence about a soft-deleted tenant expires only while the operator keeps that tenant's run scheduled, or its engine policy stays active, until its evidence sets are empty.

## 📝 Delta

### Capability: privacy-record-retention

#### ADDED Requirement: Retention sets
The system SHALL let a module declare a set of its own records that can be deleted by age, and SHALL delete from it only when a caller supplies a window at or above the set's minimum.

##### Scenario: Preview
- WHEN the command runs without the apply flag
- THEN it counts records past the window up to `--max` (default 1000), changes nothing, and, when it stops at `--max`, reports the count as "at least" with a continuation rather than a total

##### Scenario: Below the floor
- WHEN the window is shorter than the set's minimum
- THEN the command refuses

##### Scenario: Unknown set
- WHEN the set does not exist
- THEN the command says so and exits non-zero

#### ADDED Requirement: Legal holds in retention runs
The system SHALL leave out of every retention run the subjects an operator names and the subjects a registered hold guard returns, and SHALL refuse a set that cannot leave one of them out.

For `ai_assistant.pending_actions`, R5-10's declared staff matching covers creator, approver/resolver and typed target links, including batch targets; it does not promise preservation of payload-only mentions.

##### Scenario: A subject named by the operator
- WHEN the command runs with `--exclude-subject auth:user:<id>` on `notifications.inbox` or `ai_assistant.conversations`
- THEN the set skips with `hold_not_honourable`, including records that might mention that user in someone else's text

##### Scenario: A held subject the set cannot leave out
- WHEN the guard returns a `customers:person` subject for a set that does not declare that kind
- THEN nothing is counted or deleted, the run reports `hold_not_honourable`, and the command exits 1

##### Scenario: The guard cannot answer
- WHEN a guard is registered and throws
- THEN nothing is counted or deleted and the command exits 1

##### Scenario: No guard
- WHEN the common resolver positively identifies a clear ordinary OSS tenant with no guard
- THEN only the operator's `--exclude-subject` values are checked against the set declaration

##### Scenario: Another creator's action targets a held staff user
- WHEN an old terminal action was created by another user and its approver/resolver or typed single-record or batch target is a held or explicitly excluded staff user
- THEN R5-10 leaves the whole action and its attachment list unchanged in preview and apply; an otherwise eligible unrelated action can still be pruned

#### ADDED Requirement: Notification retention
The system SHALL delete notifications past the window that are read, acted on or dismissed, and unread notifications whose expiry is older than the cutoff, and SHALL keep unread rows that have not expired that long ago. Expiry cleanup may first dismiss them, but the set does not depend on it.

##### Scenario: Old and read
- WHEN a read notification is older than the window
- THEN it is deleted

##### Scenario: Old and unread
- WHEN an unread notification is older than the window and has no `expires_at`, or expired less than the window ago
- THEN it is kept until its status changes or its expiry passes the cutoff; after expiry cleanup dismisses it, the same old row is eligible

##### Scenario: Expired and never read
- WHEN an unread notification's `expires_at` is older than the cutoff and the expiry command has never run
- THEN it is deleted with the read rows

#### MODIFIED Requirement: Deleted assistant conversations
The system SHALL keep a conversation a user deleted until retention is run for it, and SHALL then remove it with everything that belongs to it.

##### Scenario: Soft-deleted target
- WHEN the soft-deleted target is pruned
- THEN conversations deleted longer ago than the window are gone with their messages, participants and pending actions, unshared listed attachment rows and stored files are gone or durably reported pending, shared listed files remain available, and live incarnations are untouched

##### Scenario: A subject to leave out
- WHEN a staff user is held, including one mentioned only in another owner's transcript
- THEN the whole set skips with `hold_not_honourable`

Frozen by: `packages/ai-assistant/src/modules/ai_assistant/__tests__/conversation-delete.characterization.test.ts`

##### Scenario: Surviving reference
- WHEN two conversations list the same upload, or a client injects a colleague's listed id, and only one conversation is pruned
- THEN R3-7 keeps the file available and reports the preserved shared reference

##### Scenario: Assigned through the attachment library
- WHEN a user assigned an `ai-chat-draft` upload to another record through `PATCH /api/attachments/library/:id`, and its conversation is pruned or the chat-draft set reaches it
- THEN the owner's release path skips it as shared, the file stays available on the other record, and `filesShared` counts it

##### Scenario: Append and retention
- WHEN append and live retention race
- THEN a committed append makes the row ineligible, or retention commits first and append inserts nothing

##### Scenario: Pending storage failure through the engine
- WHEN the engine calls the service and storage deletion fails after commit
- THEN R3-8 reports `filesPending`, marks the pass incomplete and retries from durable coordinates

#### ADDED Requirement: Unreferenced chat-draft retention
The system SHALL offer `attachments.unreferenced_chat_drafts`, applying its age floor and R3-7 reference lock, and SHALL release only unlisted uploads in the exact scope.

##### Scenario: A draft never sent
- WHEN an unlisted draft is past the supplied window and the set is applied
- THEN its row is released and its stored object is deleted or reported pending; a listed, newer or library-assigned upload stays

#### ADDED Requirement: A bounded engine entry
The system SHALL accept the engine's validated per-policy unmatched-hold decision only through the typed in-process `privacyRetentionService.run` entry, retain every other guard refusal, and own every R3-8 drain.

##### Scenario: One reserved engine batch
- WHEN the engine supplies a matching policy id/version/decision and a maximum of at most 100
- THEN the service calls at most one handler batch, drains only after its commit, and returns the remaining position and pending-file count

##### Scenario: A stale hold under the opt-out
- WHEN the policy enables `allowUnmatchedHolds` but the guard refuses a stale hold or an explicit set hold
- THEN no handler is called and the refusal is preserved

##### Scenario: An opt-out on a set that forbids it
- WHEN the engine supplies `allowUnmatchedHolds: true` for a set declaring `unmatchedHoldsOptOut: 'forbidden'`, such as `privacy.retention_evidence`
- THEN `run` refuses with `unmatched_holds_forbidden` before anything is counted

#### ADDED Requirement: Finite retention-run evidence
The system SHALL expire terminal retention-run evidence through its dedicated owner set, with the configured finite age and whole-entry deletion, preserving held and unresolved evidence.

##### Scenario: Expired evidence
- WHEN a terminal entry is older than both the configured age and the caller's window and no exclusion applies
- THEN `privacy.retention_evidence` deletes the entry including actor, reference and context, without changing other privacy evidence kinds

##### Scenario: A soft-deleted tenant
- WHEN the run names a tenant that has since been soft-deleted
- THEN it runs as for an active tenant and expires that tenant's due evidence; rows with no tenant and other tenants' rows are unchanged

## 📝 Architecture

- **Types** in `packages/shared/src/modules/privacy.ts`: the set declaration, handler, guard, fixed-cutoff position and count types, validated with zod.
- **`privacy` module**: the registry of sets, the `retention` command, and `privacyRetentionService.run` for in-process callers with the same inputs. The service resolves required protection and the guard through `privacyHoldProtectionService`, checks it before every batch, applies the hold rule and owns R3-8.
- **`notifications`**, **`ai_assistant`**, **`attachments`**: their declarations and handlers; notification cache invalidation; assistant reference and row locks. Optional services are resolved softly; a missing required capability refuses its set.
- **`attachments`**: `releaseByIds` and `drainPendingDeletions`, which the erasure spec's attachments seam adds together with the `attachment_pending_deletions` table. This spec uses them and does not define them. Handlers use the set's `privacy:retention:<setId>` origin. R3-8 drains after each committed batch and counts failures for every caller.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Command → handlers | The set registry and DI keys | An unknown set is reported |
| Assistant handler → attachments | The attachments service: `releaseByIds` in the batch's transaction, `drainPendingDeletions` after commit | The service lacks the methods: the set's `records` and `softDeleted` targets are refused, with the reason, until the erasure spec's seam phase lands |
| Command → holds | `privacyHoldProtectionService` validates the tenant latch and `privacyRetentionGuard` | A required/unknown guard failure refuses; a verified ordinary OSS run uses explicit exclusions |
| Enterprise engine → sets | `privacyRetentionService.run`, including holds, continuation and R3-8 | No direct handler loop |
| Attachments draft set → assistant references | `assistantAttachmentReferences.withUnlistedIds` by DI; same tenant lock as R3-7 | Refuse `reference_source_unavailable` |

## 📝 Data Models

Additive indexes, created concurrently, each with its migration and snapshot: `notifications (tenant_id, created_at)`; and GIN `jsonb_path_ops` indexes on `ai_chat_messages (attachment_ids)` and `ai_pending_actions (attachment_ids)` for the R3-7 reference scan. Expired unread notifications use the existing `expires_at` index. Conversations are found through the existing index on tenant, organization and `deleted_at`, and through the tenant's own conversations for the live target. No new table or column.

## 📝 API Contracts

```ts
type PrivacyRetentionSetDefinition = {
  id: string
  title: string                 // locale key
  ageBasis: string              // locale key
  minimumDays: number
  targets: Array<'records' | 'softDeleted'>
  excludableSubjectKinds: string[]
  handlerService: string
  runEvidence?: 'standard' | 'aggregate'
  unmatchedHoldsOptOut?: 'allowed' | 'forbidden'   // default 'allowed'; 'forbidden' for evidence sets that can never honour an unmatched-hold opt-out
}

type PrivacyRetentionHandler = {
  pruneRecords: (input: {
    scope: PrivacyScope
    olderThanDays: number
    target: 'records' | 'softDeleted'
    limit: number
    cutoff: string
    after?: string
    excludeSubjects?: PrivacySubjectReference[]
    dryRun: boolean
  }) => Promise<{ matched: number; deleted: number; filesPending?: number; filesShared?: number; next?: string; done: boolean; incompleteReason?: string; warnings?: string[] }>
}

type PrivacyRetentionGuard = {
  excludedSubjects: (input: {
    scope: PrivacyScope
    setId: string
  }) => Promise<{ subjects: PrivacySubjectReference[] }>   // throws when it cannot answer, or to refuse a held set
}

type PrivacyRetentionEnginePolicy = {
  policyId: string
  updatedAt: string
  allowUnmatchedHolds: boolean
}

type PrivacyRetentionRunInput = {
  scope: PrivacyScope
  setId: string
  olderThanDays: number
  target: 'records' | 'softDeleted'
  reference: string
  max: number
  batchLimit?: number
  after?: string
  excludeSubjects?: PrivacySubjectReference[]
  dryRun: boolean
  enginePolicy?: PrivacyRetentionEnginePolicy
}

type PrivacyRetentionRunResult = {
  cutoff: string | null
  matched: number
  deleted: number
  filesPending: number
  filesShared: number
  next?: string
  done: boolean
  complete: boolean
  status: 'complete' | 'incomplete' | 'refused' | 'skipped'
  reason?: string
  warnings?: string[]   // distinct dry-run warning codes of this invocation
}

type PrivacyRetentionAggregateReason =
  | 'hold_not_honourable' | 'hold_guard_failed' | 'guard_unavailable' | 'holds_changed'
  | 'policy_refused' | 'window_refused' | 'files_pending' | 'handler_incomplete'
  | 'handler_refused'

type PrivacyRetentionAggregateSummary = {
  setId: string
  status: 'complete' | 'incomplete' | 'refused' | 'skipped'
  reason?: PrivacyRetentionAggregateReason   // required unless status is 'complete'
  counts: {
    matched: number
    deleted: number
    filesPending: number
    filesShared: number
  }
  startedAt: string
  finishedAt: string
}

run(input: PrivacyRetentionRunInput): Promise<PrivacyRetentionRunResult>
```

- **`retentionSets`** — optional on the planned `privacy.ts` default export. R3-2 owns registry generation and member validation; this spec adds the retention collector and schema, not a second generator design.
- **`privacyRetentionService.run`** — the only batch driver for command and engine. It validates the tenant id's format and scope, not that the tenant is active; a soft-deleted tenant's sets run normally. Zod validates scope/set, a supported target, positive integer `olderThanDays`, reference length 1–120, `max` as integer 1–1000 and `batchLimit` as integer 1–100 (default 100), bounded by the remaining maximum; a handler examines at most its `limit`. With `enginePolicy` supplied, `max` is at most 100 and the service makes at most one `pruneRecords` call, returning `next` even if that call did not spend the full reservation. The engine owns any subsequent reservation. The service coordinates the transaction boundary, fixed cutoff/position and R3-8 drain; the owning handler commits its module transaction before post-commit work. A handler may return `incompleteReason` after a committed batch; the service still performs R3-8 and then stops with that reason and its retry position. `cutoff` is the fixed UTC ISO eligibility timestamp, or null only when validation/refusal occurs before selection; `after` carries it with the bound keyset and no caller may supply a replacement cutoff. `matched`, `deleted` and `filesShared` count this invocation only, so an engine can accumulate successive reservations without counting prior batches twice. `status` is `skipped` only for `hold_not_honourable` (a held subject the set cannot leave out; nothing counted or deleted); `refused` for every validation, guard, policy, floor or handler refusal, including `unmatched_holds_forbidden`; `incomplete` for a run that committed work and stopped early, including `holds_changed`; `complete` otherwise. `reason` preserves `hold_not_honourable`, `hold_guard_failed`, `holds_changed`, `unmatched_holds_forbidden`, policy refusals and handler refusal and incomplete reasons; a changed guard or policy requires a new preview before further writes. `done` means the selection is exhausted; `complete` additionally requires successful cache work, zero pending files and no refusal or incomplete reason. `filesPending` in a handler result defaults to zero and is replaced by the post-drain remaining count, never summed repeatedly over the same backlog. `warnings` carries the distinct handler warning codes of this invocation, only from dry runs; it changes neither `status`, `complete` nor the exit code. The CLI preview prints them, and the engine stores them with its preview pass. The aggregate summary never carries them.
- **Aggregate evidence.** `runEvidence` is declaration-only; `PrivacyRetentionRunInput` accepts no override. `PrivacyRetentionAggregateSummary` is the complete allowed variable evidence for aggregate runs; its counts are non-negative integers, its dates are UTC ISO timestamps with `finishedAt >= startedAt`, its `status` mirrors the run result's status and its `reason` is the bounded `PrivacyRetentionAggregateReason` (policy/floor/setting refusals, including `unmatched_holds_forbidden`, map to `policy_refused` or `window_refused`; any other handler refusal code, such as a missing or unavailable completion check, malformed or unidentified evidence or `reference_source_unavailable`, maps to `handler_refused` with status `refused`; handler `incompleteReason` strings map to `handler_incomplete` with status `incomplete`). The driver’s evidence writer enforces the set-id-only resource and null actor/payload fields described above. Unknown summary keys are rejected, not passed through.
- **Engine policy context.** Only in-process engine callers supply `enginePolicy`; the CLI argument schema accepts no such field or opt-out flag. Before preview and every apply batch, resolve the optional `privacyRetentionPolicyService.getActiveWindow` from [enterprise coverage](../enterprise/GDPR/2026-11-16-privacy-coverage-enterprise.md), **Policy access**. With context supplied, missing service/policy refuses, errors refuse, and policy id/version, exact scope/set/window/target, mode and `allowUnmatchedHolds` must match. Apply requires an apply policy. A set declaring `unmatchedHoldsOptOut: 'forbidden'` refuses context with `allowUnmatchedHolds: true` with `unmatched_holds_forbidden` before the guard is read or anything is counted. Policy changes stop with committed counts and require a fresh preview; policy id/version/decision join the continuation digest. With no context, the unmatched-hold decision is always false. All held references still reach `pruneRecords` as exclusions; the flag permits only the guard's otherwise unsupported kinds, and handlers keep their own stricter rules. It cannot suppress failed guards, R3-10 stale holds, set/class holds or explicit caller exclusions. Every caller receives the same R3-8 post-commit drain; no engine drain is added.
- **`assistantAttachmentReferences.withUnlistedIds`** — proposed assistant DI service: `{ scope, ids, transaction, release }`; validates candidate UUIDs, acquires the R3-7 lock, scans tenant-wide references and calls `release(unlistedIds)` in the same transaction. Callback code belongs to attachments; the assistant service never touches its tables.
- **`privacyRetentionGuard`** — an optional DI key. The OSS resolver applies the durable guard requirement above; the enterprise DSR engine registers it. `excludedSubjects` receives a registered retention-set id, or the fixed id `forms.submission_retention` that scheduled forms retention passes ([forms retention scheduling](2026-11-16-forms-retention-scheduling.md), R3-5). That id is not a registered set and never falls back to the `forms.submissions` data class: no set hold can name it, subject holds are returned as for any set, and a class hold the guard cannot attribute to it — including one on `forms.submissions` — makes the guard throw, as for any set.
- **CLI** as above. `--exclude-subject` takes `<kind>:<id>`, validated by the command's zod schema, and may repeat. `--tenant` is required. Exit 0 when the run finished, 2 when it stopped on a failure or files remain pending, 1 when it refused, skipped or stopped for changed holds: a window below the floor, an unknown set, a registered guard that threw, or a subject to leave out that the set cannot leave out (status `skipped`, reason `hold_not_honourable`); file drain failures exit 2 even after row deletion committed.
- **Audit entry** `privacy.retention_run`: standard runs use the started and terminal entries above, sharing one retention-run UUID resource id; aggregate runs use only `PrivacyRetentionAggregateSummary` and the fixed/null audit metadata, with no caller identifier or reference.
- No new route. Existing conversation write paths acquire the shared locks and validate attachment availability.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A window below the floor | Refused, with the floor in the message |
| A batch fails | The run stops, reports the count so far and exits 2; a re-run starts again and finds what is left |
| A conversation with a message newer than the window | Not matched: its age is its last message |
| A conversation with no message | Its age is its creation |
| A pending action still awaiting an answer in an old conversation | Deleted with the conversation; the floor is thirty days and pending actions expire long before |
| A listed file another conversation still references | Its reference disappears only with the deleted child; R3-7 never releases the id and counts it as shared |
| A listed id that no longer exists, or belongs to another tenant or owner entity | Skipped and counted; never an error |
| A file whose storage delete fails | The conversation is gone; the file stays in `attachment_pending_deletions` and the report counts it pending; the next run, or the attachments drain command, deletes it |
| A file uploaded in the chat but never sent | The conversations set does not reach it; `attachments.unreferenced_chat_drafts` releases it past its window |
| An expired unread notification | Eligible once its `expires_at` is older than the cutoff, whether or not `cleanupExpired` ran; once dismissed it is eligible by `created_at` |
| An unread notification with no expiry | Kept until its status changes |
| Rows with no tenant | Not touched by any run; `PrivacyScope` requires a tenant, and under R4-3 tenant-export evidence always carries its tenant. The action-log system pass's own null-tenant summaries stay with that owner |
| A run naming a soft-deleted tenant | Runs normally; its due evidence expires as for an active tenant |
| `--max` reached | The run stops and says more remain; a preview reports "at least" its count with a continuation |
| The process is killed after committed batches | The started `privacy.retention_run` entry has no terminal entry; evidence expiry preserves both as unresolved until a later complete run of the same set, target and scope covers the cutoff |
| An `ai-chat-draft` upload assigned to another record through the attachment library | The owner's release path skips it as shared under its row lock; conversation pruning, draft cleanup and conversation erasure leave it available |
| The tenant reference lock or a statement times out | The batch rolls back and the run stops with `reference_lock_timeout` and its retry position; a waiting assistant write fails with a retryable error |
| The guard returns a subject of a kind a set declares | Its records are left out; none of the first sets declares any kind |
| A terminal action names a held staff user only as approver/resolver or typed target | R5-10 leaves the whole action out even when someone else created it; includes batch targets and standalone actions |
| A staff user appears only in an action's payload text | R5-10 does not attribute that mention; the action may expire despite a selective staff exclusion, as the known limit states |
| The guard returns a subject of a kind the set does not declare | Skipped with `hold_not_honourable` (status `skipped`); nothing counted or deleted; exit 1 |
| The guard throws, or refuses a set under a hold on the set itself | Refused; nothing counted or deleted; exit 1 |
| No guard registered | Only explicit exclusions apply; the first sets skip for any such subject, and preview says no hold guard is installed |
| `--exclude-subject` names a kind the set does not declare | Skipped the same way, with `hold_not_honourable` |
| A malformed `--exclude-subject` value | Rejected by the argument schema before anything runs |
| A hold placed between batches | The next check stops with `holds_changed`; earlier committed batches remain committed |
| A reused conversation id | Only unambiguous time-bounded children of the selected row can go; later live children stay |
| An append racing live pruning | Row lock plus age recheck; append-first survives, retention-first refuses the append |
| A continuation for another scope, cutoff or exclusion list | Refused before a handler runs |
| A bounded engine call with `enginePolicy.allowUnmatchedHolds` | Policy id/version/window/target/decision are revalidated; only the otherwise unsupported guard-returned kinds may pass, with all held references still given to the handler |
| The same policy used by the OSS CLI | No engine context is accepted; unmatched holds still refuse |
| `allowUnmatchedHolds: true` for a set declaring `unmatchedHoldsOptOut: 'forbidden'` | Refused with `unmatched_holds_forbidden` before anything is counted |
| A stale hold, guard error or explicit set/class hold under the opt-out | Refused; the flag never turns a refusal into an empty exclusion list |
| An operator or caller exclusion of an undeclared kind under the opt-out | Skipped with `hold_not_honourable` (status `skipped`, exit 1); the flag never lifts an explicit exclusion |
| A standalone action still lists a conversation's upload | Its reference protects that upload under R3-7, including from draft cleanup |
| Terminal retention evidence past its configured age | Dedicated `privacy.retention_evidence` deletes the whole entry; held or unresolved evidence survives with an explicit reason |

## 📝 Migration & Backward Compatibility

New declaration and service surfaces, including optional `runEvidence`, are additive: one optional member of the planned convention, types, command, services, optional DI keys, audit entries and three indexes. New cutoff and cursor requirements are for the unreleased handler contract. Existing routes keep their URLs and response shapes; append may no longer succeed against a conversation concurrently deleted. Lock ordering is tenant reference lock, conversation-id lock, then conversation row lock. No new user-editable entity is added. The declaration's field is `excludableSubjectKinds`; an earlier draft named it `excludableSubjects`, and nothing has shipped with that name. Nothing is deleted on upgrade. `UPGRADE_NOTES.md` names the command and says what each set removes. The optional declaration member `unmatchedHoldsOptOut` (default `'allowed'`), the `unmatched_holds_forbidden` reason, the optional `warnings` result members and the `handler_refused` summary reason are additive; a declaration without the member keeps today's behaviour. `PrivacyScope`, `run`, `pruneRecords` and `excludedSubjects` keep a required tenant; no installation-scope entry, method, flag or setting is part of this contract.

## 📋 Implementation Plan

1. Add zod-derived types, `getRetentionSets` under R3-2, cutoff and keyset validation. Unit tests `retention-position.test.ts`: deleted rows between batches, equal creation times, resume, foreign tenant/set/target/cutoff tokens and changed exclusions.
2. Add service and command. Unit tests `retentionService.test.ts`: preview counting up to `--max` and reporting a capped count as "at least" with a continuation, floors, unknown set, exact `status`/`reason`/exit code for `hold_not_honourable` (skipped, exit 1) versus guard and validation refusals (refused, exit 1) and `holds_changed` (incomplete), bounded maxima/batches, malformed exclusions, no guard, failed guard, unsupported `auth:user` and person kinds, a fake supporting handler, and a hold created between batches. Test validated engine opt-out, missing/changed policy, wrong scope/set/target/window, stale holds, guard failures, set/class holds, explicit exclusions and a CLI refusing any opt-out input. A dry-run handler warning reaches the result's `warnings` once per invocation and changes neither status nor exit code; an apply run carries none. A handler refusal returns `refused` with its code. An operator exclusion of an undeclared kind under a validated engine opt-out still skips with `hold_not_honourable`. Every engine call is at most one reserved batch, continuation binds policy identity/decision, and completed counts survive a later refusal. Assert returned `cutoff` matches the opaque saved continuation across reservations, invocation counts do not double-count prior batches, and an entry-time refusal returns a null cutoff. Both callers use R3-8; a fake attachment service proves one drain per committed batch and none before commit, retry with no candidates, storage failure counts and engine incomplete outcome. A committed handler batch with `incompleteReason` drains once, preserves counts and stops at its retry cursor. Standard apply writes the started entry before the first batch (a logger failure refuses before any write) and the terminal entry under the same resource pair; a simulated crash after a committed batch leaves a started entry with no terminal entry that the evidence pass reports as unresolved. The engine-policy tests also cover `unmatchedHoldsOptOut`: R3-2 accepts only `'allowed'` and `'forbidden'`; an `enginePolicy` with `allowUnmatchedHolds: true` on a `'forbidden'` set refuses with `unmatched_holds_forbidden` before the guard is read or anything is counted, while the same context on an `'allowed'` set keeps today's behaviour. A run naming a soft-deleted tenant is accepted and processes that tenant's rows only; a malformed tenant id is refused; the argument schema rejects a run without `--tenant`. Test guard missing/throwing for positively clear versus latched or unreadable tenants, including loss between batches. For started evidence, certify an exact multi-segment resume, reject a later run with broader exclusions or an unproven cursor, and preserve legacy started evidence until audited reconciliation.
3. `notifications`: handler and index; unit tests `notificationRetention.test.ts` for all statuses, an unread row whose `expires_at` is older than the cutoff deleted without the expiry command, unread rows with no or a recent expiry kept, cleanup-then-prune and each distinct cache scope, no dry-run invalidation, invalidation failure and retry of a saved affected scope after its last row was deleted. Any staff hold stops even notifications addressed to someone else.
4. **Characterize** that deleting a conversation hides its row and leaves messages; characterize reusable client ids and current append ordering in `conversation-delete.characterization.test.ts` before changing those paths.
5. `ai_assistant`: shared delete routine, reference service and all attachment-list writers using the locks, the GIN reference indexes and the lock/statement bounds. Unit tests `conversationRetention.test.ts`: both targets, no message, a listed upload assigned to another record through the attachment library kept and counted shared, a writer timing out on the lock with a retryable error, a batch timing out with `reference_lock_timeout`, age recheck, both append commit orders, reused id with a different owner, ambiguous child interval, standalone and conversation-linked pending actions, legitimate shared id, injected id, concurrent new reference, tenant/organization isolation, storage failure and retry. Assert R3-7 is shared by subject erasure and `ai_assistant.pending_actions`; a surviving standalone action protects a file during conversation/draft pruning, and a surviving message protects it during standalone-action pruning. The action set's eligibility and R5-10 exclusions remain content-ai-owned tests in `privacy-pending-action-retention.test.ts`: creator, approver/resolver and typed single/batch target matches independently protect whole actions, including another creator's action targeting a held staff user. Cover guard-returned holds and explicit exclusions, standalone and conversation-linked actions, same id with a different target type, unrelated eligible actions, preserved attachment lists, preview/apply and a hold added between batches. Keep the payload-only-mention limit explicit.
6. `attachments`: draft set and age/scope recheck through the reference service, durable release, and the `releaseByIds` assignment recheck for `ai-chat-draft` uploads. Unit tests `chatDraftRetention.test.ts`: old unlisted upload, recent or listed upload, an old unlisted upload assigned to another record (kept, shared), an upload whose only assignment is its own primary pair (released), missing reference service, scanner failure, subject hold and shared storage object.
7. Add `privacy.retention_evidence`, its R3-3 setting and audit-owner consumer. `retentionEvidence.test.ts`: finite default/floor, exact `{ resourceKind: 'privacy.retention_run', resourceId: retentionRunId }` exclusion rather than child erasure ids, terminal versus unresolved state, inactive-subject status/terminal/required-side-effect/file/continuation metadata, settled capped invocations, missing/invalid completion, pending file/cache work, failed completion read, any subject hold even under engine opt-out, guard failure, scope/age/keyset, full removal of actor/reference/context, and aggregate-only summary. Unresolved started-without-terminal standard runs are preserved until a later complete run of the same set, target and scope covers their cutoff. Add `retentionEvidenceSummary.test.ts` for strict declaration/type validation, the summary's `status` and bounded `reason` for complete, incomplete, refused and skipped invocations, including a handler refusal recorded as `refused` / `handler_refused` and a handler incomplete string as `incomplete` / `handler_incomplete` (handler strings never copied), both export sets selecting the same branch, CLI/engine parity, distinctive reference/actor/export/request/subject/retention-run/erasure-run markers and preview contents absent from every persisted audit field, standard logging unchanged, preview with no summary, zero-change/skip/incomplete summaries, logger unavailable/write failure and counts preserved after commit. Age out a prior aggregate summary without copying its database id into the next one. It also covers inactive-subject entries without reading their subjects or preview documents. `privacy.retention_evidence` declares `unmatchedHoldsOptOut: 'forbidden'`, and its tenant runs never select a null-tenant row, including `system-history:` summaries.
8. Self-contained TC-PRIVACY-RETENTION-001/002/003/004 and TC-PRIVACY-CHAT-DRAFT-001; docs and upgrade notes. Run generators after adding discovered files.
9. Archive this Delta into `.ai/specs/capabilities/privacy-record-retention.md` if adopted.

| File | Action |
|---|---|
| `packages/shared/src/modules/privacy.ts` | Modify |
| `packages/core/src/modules/privacy/{privacy.ts,cli.ts,lib/retentionService.ts,lib/retentionEvidence.ts,lib/retentionRunEvidence.ts,di.ts,__tests__/{retentionEvidence,retentionEvidenceSummary}.test.ts}` | Create / modify; share the service registration with inactive-subject extensions |
| `packages/core/src/modules/notifications/{privacy.ts,lib/*,migrations/*,__tests__/notificationRetention.test.ts}` | Create / modify |
| `packages/ai-assistant/src/modules/ai_assistant/{privacy.ts,lib/*,di.ts,data/repositories/AiChatConversationRepository.ts,migrations/*,__tests__/privacy-pending-action-retention.test.ts}` and snapshot | Create / modify; GIN reference indexes; include all attachment-list writers found during implementation and the content-ai-owned R5-10 exclusion tests |
| `packages/core/src/modules/attachments/{privacy.ts,lib/*,di.ts,__tests__/chatDraftRetention.test.ts}` | Create / modify for draft retention |
| `packages/core/src/modules/privacy/__integration__/TC-PRIVACY-RETENTION-00{1,2,3,4}.spec.ts` | Create |
| `packages/core/src/modules/attachments/__integration__/TC-PRIVACY-CHAT-DRAFT-001.spec.ts` | Create |
| `UPGRADE_NOTES.md`, docs | Modify |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-PRIVACY-RETENTION-001 | Own staff users, notifications and conversations created through APIs, backdated in fixture setup, and removed in `finally`. Preview writes nothing; apply removes an old read row from `GET /api/notifications`, keeps an unread row with no expiry, removes an unread row whose expiry is older than the cutoff without running the expiry command, and cleanup-then-prune removes an expired dismissed row. A capped preview reports "at least" with a continuation. Warm the inbox cache first. Soft-delete through `DELETE /api/ai_assistant/ai/conversations/:conversationId`; after apply direct queries find only its unambiguous old children gone, while `GET /api/ai_assistant/ai/conversations` and its messages path retain a reused live id's rows. Explicit staff and person exclusions skip the set with exit 1, including a staff mention in another owner's content. |
| TC-PRIVACY-RETENTION-002 | Own two users and two conversations, upload files through `POST /api/attachments` under `ai-chat-draft`, persist ids through the chat write path and pending-action fixture. Two conversations list one upload; an injected id names the surviving user's listed upload; a third upload, listed only in the pruned conversation, is assigned to an own CRM record through `PATCH /api/attachments/library/:id`. Pruning one conversation preserves both surviving downloads and the assigned upload (still downloadable from the record), and counts shared ids; an unshared file returns 404 and local bytes disappear. Deterministic barriers test both append/prune commit orders, resumption across deleted keyset rows and a new hold between batches. In the enterprise variant the engine calls the same service with a failing storage driver: the pass reports pending files/incomplete, durable coordinates survive, and retry drains them. Cleanup users, conversations, holds, policies, pending rows and local bytes in `finally`. |
| TC-PRIVACY-RETENTION-003 | Own old/recent terminal and unresolved `privacy.retention_run` entries, including inactive-subject entries with their owner's status, terminal, requiredSideEffects, filesPending and continuationPending metadata. Settled capped work may expire; missing/invalid completion, unfinished committed work and pending/failed file/cache/required effects stay unresolved. Verify exclusions use the exact retentionRunId resource pair across entries, never a child erasure runId. Set/list the evidence age through R3-3; preview writes nothing, apply removes only due terminal entries from the audit API, including actor/reference/context. An unrelated privacy evidence kind survives. Run the same driver with the dedicated export-evidence declarations once their owners ship: summaries contain only set id, counts and run dates; unique caller reference/actor/export/request/subject/retention-run/erasure-run markers and preview contents are absent from every stored audit field. A due prior aggregate summary expires without its id being copied into a fresh one. In the enterprise lane any subject hold skips even under an unmatched-hold policy, failed guard refuses, and release permits expiry without resetting age. Remove fixtures/settings/policies/holds in `finally`. |
| TC-PRIVACY-RETENTION-004 | Tenant-scoped expiry of aggregate evidence, including a soft-deleted tenant. Own two tenants, soft-delete one through the directory tenant delete command, and backdate in private fixtures aggregate `privacy.retention_run` summaries for `privacy.retention_evidence` and `privacy.tenant_export_evidence` set ids in both tenants, plus one null-tenant `system-history:` summary. `mercato privacy retention --tenant <soft-deleted id> --set privacy.retention_evidence` previews without writing, then on apply deletes only that tenant's due summaries; its recent ones, the other tenant's rows and the null-tenant summary remain, checked by direct queries. The new summary carries the soft-deleted tenant and only set id, counts and dates. A run without `--tenant`, with a malformed tenant id, with a window below the evidence age or with another tenant's continuation exits 1 and changes nothing; `--exclude-subject` skips with `hold_not_honourable`. Enterprise lane: an active hold in the fixture tenant skips, and an engine policy with `allowUnmatchedHolds` is refused for this set with `unmatched_holds_forbidden`. In the enterprise profile, before asserting deletion the case runs the tenant-scoped preview of the same set and requires that it reports no `hold_not_honourable` skip; if it does, the case fails with a message naming a leaked or concurrent hold rather than a missing deletion. Hold-creating suites carry the `@privacy-holds` tag and run under the suite's single worker (`workers: 1`, `.ai/qa/tests/playwright.config.ts`). C8's TC-TENANT-EXPORT-002 runs the same tenant entry for a soft-deleted tenant's `privacy.tenant_export` groups. Remove fixtures, tenants and holds in `finally`. |
| TC-PRIVACY-CHAT-DRAFT-001 | Own scoped uploads: old unsent, old unsent but assigned to an own record through the attachment library, old listed in a message, old listed in a pending action, recent, and another organization's. After preview and apply of `attachments.unreferenced_chat_drafts`, only old unsent bytes disappear and their download returns 404; other downloads remain. Missing/failed reference service and an active enterprise staff hold delete nothing. Own all fixtures and clean rows, bytes and policies in `finally`. |

The conversations UI is unchanged; TC-PRIVACY-RETENTION-002 reloads the surviving conversation and attachment preview after pruning. Its file fixtures also include a terminal standalone action sharing a surviving message's upload and a surviving standalone action sharing a deleted conversation's upload; both downloads remain. R5-10 fixtures include another creator's terminal action whose typed target is a held staff user, an action naming that user only as approver/resolver, and a batch target; holds and explicit exclusions preserve each whole action and its attachment list while an unrelated action expires. Use owned fixtures for standalone and conversation-linked actions and clean all holds/actions in `finally`. Engine coverage is coordinated with TC-PRIVACY-GOV-004 in the DSR engine spec, including the typed policy context and every non-overridable guard refusal.

## 📝 Risks & Impact Review

#### Retention in OSS runs only on demand
- **Scenario**: An OSS deployment never runs the command, so old notifications, conversations and unsent drafts stay.
- **Severity**: Medium
- **Affected area**: storage limitation on OSS deployments
- **Mitigation**: Assumption 2 places schedules and policies in Enterprise. `UPGRADE_NOTES.md` and the docs name the command and what each set removes, and an operator can schedule it.
- **Residual risk**: Until an operator schedules the command or enables an engine policy, these records keep today's unbounded lifetime.

#### A held person's records are deleted
- **Scenario**: A person under a hold is mentioned in a notification addressed to someone else, or an operator runs the command for a tenant with holds.
- **Severity**: High
- **Affected area**: legal holds
- **Mitigation**: Each set declares `excludableSubjectKinds`. The command and the service read the holds through `privacyRetentionGuard`, which the engine registers, and skip a set with `hold_not_honourable` when a held subject's kind is not declared. A registered guard that cannot answer is a refusal. All first sets declare `[]`, so a staff hold stops the set too. The engine calls the same service, which rereads holds before every batch; tests cover a new hold between batches.
- **Residual risk**: A hold committed after a batch check is seen at the next batch boundary; earlier writes cannot be undone. OSS has explicit exclusions but no hold engine. The DSR policy opt-out retains its stated unmatched-mention risk.

#### Another creator's action about a held staff user expires
- **Scenario**: An old terminal action was created by someone else but names the held staff user as approver/resolver or target.
- **Severity**: High
- **Affected area**: pending-action holds and explicit exclusions
- **Mitigation**: R5-10 matches `created_by_user_id`, `resolved_by_user_id` and typed single/batch target pairs independently, leaving each matched action whole. Content-ai's `privacy-pending-action-retention.test.ts` and TC-PRIVACY-RETENTION-002 cover another creator's action, holds and explicit exclusions, preserved files and unrelated eligible controls.
- **Residual risk**: Arbitrary staff mentions only in `normalized_input`, `field_diff` or opaque payloads cannot be attributed by these links and may expire under a staff hold. This is an accepted known limit under R5-10; any later matcher is content-ai coverage's own design, and this spec adds no matcher or whole-set skip.

#### A user loses something they wanted
- **Scenario**: A read notification with a link the user meant to return to is deleted.
- **Severity**: Low
- **Affected area**: the notification inbox
- **Mitigation**: Nothing runs by default; a thirty-day floor; unread ones are kept unless their own expiry is older than the cutoff.
- **Residual risk**: Accepted by whoever chooses the window.

#### Orphaned files
- **Scenario**: A conversation is deleted and its files are not. A release keyed by the conversation would find nothing, because chat uploads are stored under `ai-chat-draft` with a browser-minted record id.
- **Severity**: Critical
- **Affected area**: attachment storage; whatever personal documents users uploaded to the assistant
- **Mitigation**: The handler releases by the ids its messages and pending actions hold, in the batch's transaction, and the stored objects go through the durable pending-deletion rows of the erasure spec's seam. The set refuses to run without those methods. Unit tests and TC-PRIVACY-RETENTION-002 check that the stored file is gone.
- **Residual risk**: Unsent uploads remain until the draft set is run or scheduled; uploads falsely listed in a surviving conversation stay listed. Storage failures remain durably pending and make the run incomplete.

#### The tenant reference lock stalls assistant writes
- **Scenario**: A retention batch holds the tenant-wide reference lock while it scans and deletes, and chat appends queue behind it.
- **Severity**: Medium
- **Affected area**: assistant chat latency in that tenant
- **Mitigation**: The lock is transaction-scoped and released at each commit; batches are capped at 100 roots and 30 seconds with statement and lock timeouts; writers wait at most 5 seconds and get a retryable error; GIN indexes keep the reference scan to index probes.
- **Residual risk**: A user may see a retry prompt while a batch runs.

#### A killed run leaves deletions without terminal evidence
- **Scenario**: The process dies after committed batches and before the run's evidence is final.
- **Severity**: Low
- **Affected area**: accountability for retention runs
- **Mitigation**: Standard runs write a started entry before the first batch; started-without-terminal is unresolved evidence that expiry preserves until a later complete run covers its cutoff.
- **Residual risk**: For aggregate evidence-expiry sets, a kill between a batch commit and the summary write loses that batch's counts; the deleted rows were themselves expiring evidence.

#### Cached notification text survives a crashed invalidation
- **Scenario**: The process dies after deleting a batch but before publishing its cache retry scopes.
- **Severity**: Low
- **Affected area**: notification list cache
- **Mitigation**: Invalidate every affected scope after commit, fail on cache errors and keep retry scopes in any returned continuation; unit and warmed-cache API tests pin normal invalidation.
- **Residual risk**: A crash before the continuation is saved can leave cached text until the existing cache TTL; no durable cache outbox is added by this spec.

#### A surviving conversation or record loses its file
- **Scenario**: Client-supplied ids cause retention to release another conversation's upload, a new reference races the scan, or a user assigned the upload to another record through the attachment library.
- **Severity**: High
- **Affected area**: chat files, other users and the records they were assigned to
- **Mitigation**: R3-7 scans all surviving message/action lists under the shared writer lock; the attachment owner's release path treats every assignment other than the upload's own primary pair as a live reference under its row lock; attachment ownership and shared-object checks still apply; tests cover shared, injected and assigned ids.
- **Residual risk**: A future attachment-list writer that omits the lock can reopen the race; the writer inventory and regression test are release gates.

#### Evidence about a soft-deleted tenant is never expired
- **Scenario**: A tenant is soft-deleted and nobody keeps running its evidence sets, so its privacy evidence outlives the configured age.
- **Severity**: Medium
- **Affected area**: storage limitation for privacy evidence
- **Mitigation**: Every evidence entry carries its tenant, and `run` accepts a soft-deleted tenant's id, so the ordinary tenant run expires it; docs tell operators to keep the run, or the engine policy, active for that tenant until its evidence sets are empty. TC-PRIVACY-RETENTION-004 covers a soft-deleted tenant.
- **Residual risk**: An operator who stops the runs for a deleted tenant leaves its evidence until the next run.

## Final Compliance Report — 2026-11-16

Pass-two review: cross-spec references and shared decisions checked against the merged workspace; runner: local, Python document checks only. Pass-three references and the shared aggregate evidence contract were checked directly; no independent review was available. No implementation tests were run. Independent review could not launch because the collaboration service returned `no rollout found`; this revision was reviewed directly.

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` for the convention file. Relevant AI assistant, notifications, attachments, shared and core guide sections checked against the read-only repository; implementation tests were not run.

| Rule | Status | Notes |
|---|---|---|
| No cross-module table access | Compliant | Module-owned handlers, owner services and assistant reference callbacks |
| Additive contract change | Compliant | One optional `privacy.ts` member; optional declaration fields `runEvidence` and `unmatchedHoldsOptOut` |
| Edition | Compliant | Declaration, handlers, service and command in OSS; schedules and policies in Enterprise (assumption 2, DEC-2) |
| Tenant scoping | Compliant | Every call takes a tenant scope; no run reads rows without a tenant |
| Tenant-export evidence (R4-3) | Compliant | Every entry carries its tenant; tenant-scoped runs expire it, including for a soft-deleted tenant; no installation-scope mode |
| Legal holds honoured by manual runs | Specified | Durable protection resolver refuses unavailable required guards; `hold_not_honourable` skips a set that cannot leave a held kind out |
| R5-10 pending-action staff exclusions | Specified for explicit links | Creator, approver/resolver and typed single/batch targets protect whole actions, including another creator's action; unit/integration coverage required. Payload-only staff mentions are an accepted known limit; any later matcher is content-ai coverage's own design |
| Validate inputs with zod | Compliant | The command's argument schema, including `--exclude-subject` |
| Integration coverage | Specified | Five self-contained tests over status, cache, concurrency, files, draft uploads, evidence expiry, soft-deleted-tenant evidence and hold skips |

**Verdict:** revised design; implementation waits on the contract registry and the erasure spec's **Phase 2 — Seams** for `releaseForRecord`, `releaseByIds` and durable draining. Every run is tenant-scoped; under R4-3 tenant-export evidence always carries its tenant, including for soft-deleted tenants. No implementation is claimed.

## Changelog

### 2026-11-18

- Defined a common durable Enterprise hold latch and exact original-selection proof for settling interrupted retention evidence.

### 2026-11-17
- Chat-file release: the attachment owner's release path treats an attachment-library assignment to another record as a live reference, so conversation pruning, draft cleanup and conversation erasure keep such uploads; tests and TC-PRIVACY-RETENTION-002 / TC-PRIVACY-CHAT-DRAFT-001 cover it.
- Standard runs write a started `privacy.retention_run` entry before the first batch; unresolved started-only runs are preserved by evidence expiry. Aggregate summaries gain a bounded `status` and `reason`.
- `hold_not_honourable` is pinned as `status: 'skipped'`, exit 1; preview counts up to `--max` and reports "at least" when capped.
- `notifications.inbox` also deletes unread notifications whose expiry is older than the cutoff, without depending on the unscheduled expiry command.
- The tenant reference lock gains wait, lock and statement timeouts, a batch duration cap and GIN indexes for the reference scan.
- The installation-scope run mode is removed: every privacy evidence entry carries its tenant, `run` accepts a soft-deleted tenant's id, and TC-PRIVACY-RETENTION-004 now covers tenant-scoped evidence expiry for a soft-deleted tenant with a hold-leak precondition.
- Under the engine opt-out, an explicit operator or caller exclusion of an undeclared kind still skips with `hold_not_honourable`; only guard errors, stale holds and set/class holds are refusals. Handler refusals are a defined outcome (`refused`, summary reason `handler_refused`), and dry-run batches can return bounded `warnings`, such as `REPLAY_ROLLOUT_UNCONFIRMED`, that preview prints and the engine stores with its preview pass.
- Set declarations gain optional `unmatchedHoldsOptOut`; `privacy.retention_evidence` declares `'forbidden'`, and `run` refuses an engine opt-out for such a set with `unmatched_holds_forbidden`.

### 2026-11-16
- Written autonomously as "retention for personal-data classes", covering five classes in two modes.
- Rewritten after independent review, and renamed. Rows pruned by age are no longer data classes: the contract requires a class to name subjects and take part in erasure, and the erase run would then have refused every staff user. They are retention sets in their own registry. Change history is removed: its "latest undoable entry" rule would have kept exactly the snapshots retention is meant to remove, it would have deleted the record of erasures, the premise about deal stage history was wrong (a transitions table exists), and maintainers place it in Enterprise. Inactive contacts and portal users are removed to a spec of their own. The handler takes and returns a position, so a preview can count. Notification statuses are corrected. Conversations take their pending actions and attachments with them. Indexes reduced to the one that has a reader.
- Amended: a set's handler may call the owning module's service, so that the enterprise change-history sets can exist without writing to a core table.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), critical fix: the conversations set promised that a pruned conversation's files are released, with no residual risk. But chat uploads are stored under `ai-chat-draft` with a browser-minted record id, so a release by conversation finds nothing and every uploaded file would have outlived the deletion. The handler now collects the ids from `attachment_ids` on messages and pending actions and releases them through `releaseByIds`, with stored objects going through the erasure spec's durable pending-deletion rows. Added edge cases, unit tests and a file assertion in TC-PRIVACY-RETENTION-001. The risk is now Critical with a stated residual risk: chat uploads never sent in a message.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g5-08 — the manual command ignored legal holds and could not be told whom to leave out; it now takes a repeatable `--exclude-subject <kind:id>`, consults the optional `privacyRetentionGuard` (registered by the enterprise engine) in preview and apply, refuses when a registered guard fails, and refuses a set with `hold_not_honourable` when a subject to leave out has a kind outside the declaration's new `excludableSubjectKinds` (which replaces the unreleased `excludableSubjects`). The engine applies the same rule to its passes. Updated assumptions, the declaration, the command, a new Delta requirement, the types, edge cases, plan, TC-PRIVACY-RETENTION-001, the risk and compliance.

- Council round two fixes (GPT-6.1 Sol workers): r6-02 — R3-7 surviving chat references and writer locks; r6-05 — R3-8 shared service drain and pending counts; r6-24 — staff holds skip unmatchable mentions; r6-25 — unreferenced chat-draft set; r6-30 — per-batch guard checks; r6-31 — registry inventory; r6-35 — bound fixed-cutoff keysets; r6-43 — conversation incarnations; g5-20 — append locking and age recheck; g5-21 — durable deletion dependency retained; g5-22 — notification cache invalidation; g5-30 — expiry dismissal semantics; F-72 — separate set/class namespaces; R1 seam-phase nit — Phase 2 dependency.
- Council round two fixes, pass two (GPT-6.1 Sol workers): W04/W05 — consuming closure, EUDR and standalone-action sets with exact ages/exclusions; W07 — bounded typed engine policy context, non-overridable guard refusals and R3-8 for every caller; W13 — cite the separate subject-set/activity-source and candidate execution contract; shared R3-7 references include standalone actions; current-history reduction counts roots; finite retention-run evidence default and owner expiry; live replay incompleteness preserves the retry position.
- Council round two fixes, pass three (GPT-6.1 Sol workers): rechecked the bounded W07 entry, exposed its saved cutoff and per-invocation counts, and added the shared declaration-selected aggregate evidence path for retention and both export-evidence sets, with strict identifier-free logging, failure semantics, manifest and coverage. R3-7 reference checks and all R3-8 drains remain service-owned.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): consume C5's owner-local retention-bound metadata/projections and C1's separate export/settings evidence sets; align inactive-subject completion metadata, exact retention-run exclusions and identifier-free expiry coverage without changing the owned age or R3-8 drain.
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): R5-10 — replace creator-only pending-action exclusions with exact creator, approver/resolver and typed single/batch target matches, including another creator's action about a held staff user; align assumptions, catalog, unit/integration coverage, risks and compliance, and state the unresolved payload-only-mention limit without adding a new design.
