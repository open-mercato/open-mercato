# Record retention: notifications and assistant conversations

> **Program:** first part of package D3 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** the `privacy.ts` convention and the `privacy` module from [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md). **Consumed by** [`enterprise/GDPR/2026-11-16-privacy-dsr-engine.md`](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md).
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/GDPR/2026-11-16-privacy-data-class-contract.md

## 📝 TLDR

A notification stays in a user's inbox forever, whether read, acted on or dismissed. An assistant conversation that a user deleted stays in the database forever; its delete route says a future worker will purge it. Both hold personal data, and nothing says how long either lives. The operational pruners cover tables nobody reads; these are tables people do read, so the rule for what may go has to come from the module that owns them. **Proposed (future):** a module may declare a *retention set* — a group of its own records that can be deleted by age — and implement one method that deletes a batch. An operator command runs it, in preview by default. Notifications, assistant conversations and unreferenced chat drafts are the first sets. A separate installation-scope run, accepted only by evidence sets that declare it, expires evidence rows that have no tenant. Nothing is deleted unless an operator, or the enterprise policy engine, asks.

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
| 4 | Which notifications may go | Read, acted on or dismissed, and older than the window. An expired unread notification stays only until the existing expiry command dismisses it | Eligibility uses the stored status. Expiry cleanup is unchanged; a dismissed-by-expiry row is prunable. |
| 5 | Soft-deleted rows | A second target a set may declare | Only the owning module knows when its soft-deleted rows are safe to remove. |
| 6 | Whose records can be left out | Each set names, in `excludableSubjectKinds`, the subject kinds whose records its handler can leave out under its declared matching rule; the first sets cannot fully attribute mentions and declare none. R5-10 protects pending-action staff links by creator, approver/resolver and typed target, with payload-only mentions outside that rule. A subject to leave out of any other kind makes the run skip the set, with reason `hold_not_honourable` | A hold on a person can then spare the records that are plainly theirs. A person merely mentioned in a notification's text cannot be spared, so a hold on such a person stops that set instead of being ignored. R5-10's narrower pending-action protection has the explicit payload-mention limit below. |
| 7 | Legal holds in a manual run | The command consults an optional guard, `privacyRetentionGuard`, which the enterprise engine registers from its holds, and takes `--exclude-subject` from the operator. A registered guard that fails makes the run refuse | The engine requires held subjects to be left out of retention. An operator's run must not be the one path around that, and the erase run already fails closed the same way with `privacyErasureGuard`. |
| 8 | Chat uploads never sent | A separate `attachments.unreferenced_chat_drafts` set releases unlisted `ai-chat-draft` uploads past a caller-supplied window with a 30-day floor; no default schedule | The attachments module owns uploads and cannot attribute them to a user. A tenant-wide reference check through the assistant service prevents deletion of a listed upload. Any subject hold skips this set. |
| 9 | Retention-run evidence age | Delete terminal `privacy.retention_run` entries after 365 days by default, floor 30, through `privacy.retention_evidence`; unresolved work and active holds postpone expiry | The program sets every privacy evidence age to 365 days by default, floor 30. It is an accountability default, not a legal period; a controller sets another finite age through R3-3. The generic `privacy.` exclusion in history sets is never unlimited permission to keep this evidence. |
| 10 | Evidence rows with no tenant | A separate installation-scope run: `privacyRetentionService.runInstallation` and `mercato privacy retention --installation`, accepted only by sets declaring `installationScope: true` and reading only `tenant_id IS NULL` rows. `PrivacyScope` stays tenant-required; preview is the default, and holds, positions and aggregate evidence follow the tenant rules | R4-3 gives null-tenant `privacy.tenant_export` rows a finite age, and C8 leaves the caller/handler contract to this spec. A nullable tenant would let every scoped method accept "no tenant"; a separate entry leaves tenant runs unchanged and makes installation scope explicit at every call. |

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
- **Some evidence has no tenant.** `action_logs.tenant_id` is nullable (`audit_logs/data/entities.ts`), and R4-3 bounds historical `privacy.tenant_export` rows with `tenant_id IS NULL`. `PrivacyScope.tenantId` is required, so no tenant run can reach them.

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
| `installationScope` | Optional boolean, default `false`. `true` lets the set also run at installation scope, over rows with no tenant; see "Installation-scope runs" below |

### The handler

One method, `pruneRecords`. It receives a scope, a window, a fixed cutoff, a target, a batch limit, a keyset position, exclusions and a dry-run flag. It commits at most one batch and returns counts, pending-file count, the next position and completion. A dry run writes nothing and advances the same keyset. Only `privacyRetentionService.run` drives it, including for the enterprise engine. The handler of an installation-capable set also implements `pruneInstallationRecords`, which only `privacyRetentionService.runInstallation` drives; see "Installation-scope runs" below.

Rules every implementation follows:

- It touches only its own module's tables, or calls the owning module's service where the records belong to another module.
- It refuses a window below its minimum. A handler's minimum may come from a tenant setting, such as the tenant's legal-retention age; it then refuses a shorter window, and refuses every window while that setting is unset.
- A handler may blank or reduce records in place instead of deleting them. The `deleted` count then counts roots processed, once per root, rather than physical deletes or changed child rows. Coverage handlers collect their current record footprint and strip it within each batch before and after blanking, through **DEC-B — The audit-history strip routine** and **R3-1 — The audit-history rule for every erasure**, owned by the erasure spec's **Audit history — `audit_logs`**. They use the batch transaction, write no snapshots of removed values and roll back on a failed or skipped strip. Subject erasure's run-wide two passes remain the erasure owner's routine.
- Each batch is its own transaction. The service fixes the eligibility cutoff once as `runStartedAt - olderThanDays` in UTC and carries it with the continuation; handlers compare their declared age column with that timestamp, without subtracting the window a second time. Each handler orders by an immutable unique key, normally `(created_at, id)`, never by offset. The opaque position binds the tenant, organization, set, target, window, cutoff and exclusion digest to the last examined key. A mismatch is refused; a resumed run uses the saved cutoff. Limits are validated integers from 1 to 100.
- The handler enforces every module-specific prerequisite on every batch, including a required active policy. The command cannot bypass it by supplying a window.
- After each committed batch, the service completes post-commit cache work and drains pending file deletions before recording success; see R3-8 below.
- It never returns or logs an identifier.
- It leaves out the records of the listed subjects, for the kinds it declared.

Sets from every enabled module follow these rules. `getRetentionSets` reads `privacy.retentionSets` under **R3-2 — The registry carries the whole `privacy.ts` default export**, in the contract spec's **Architecture → Components** and **Phase 1 — Contract and discovery**. The registry is the inventory; the consuming-set catalog below records handoffs without replacing it. Settings needed by another set use **R3-3 — Tenant privacy settings live in `module_configs`**, in the contract spec's **Tenant privacy settings** and **Phase 7 — Settings and bounded export evidence**.

Any `retention_bounded` table classification must resolve the deleting owner's local `privacy.ts.retentionBounds` metadata from [table coverage](2026-11-16-privacy-table-coverage.md), **Declarations and row subsets** and **API Contracts**. A `kind: 'retention_set'` bound names the actual `retentionSetId` and exact table/subset, allowed `columns`, `ageAnchor` and `eligibility`; a set id or translated `ageBasis` alone is insufficient. Consume that owner's `PrivacyRetentionBoundHandler.resolve({ scope, boundId, now, em })` projection for the effective window, mode/counting grace and enabled/scheduled/worker state, and `evaluateFixtureRow` for the captured row on the supplied read-only manager. Missing metadata or evaluation blocks verification; off, unscheduled, unavailable and pending states report their actual enforcement gap. This references C5's existing bound contract and adds no bound id or alternate retention runner.

The [inactive-subject spec](2026-11-16-inactive-subject-retention.md), **API Contracts**, separately owns the additive `subjectRetentionSets` and `activitySources` members and `privacyRetentionService.listFilteredCandidates`, `evaluateCandidates` and `eraseCandidates`. Those methods share this service's registration; they do not become `pruneRecords` handlers. Explicit candidate evaluation checks only supplied references and fails closed on a missing required source or unknown result. `eraseCandidates` rechecks eligibility and uses **R3-14 — The `eraseSubjects` entry point** with `related: 'skip' | 'exclude'` only, under **R3-13 — No `related_subjects: include` anywhere**. This spec does not define a second candidate contract or copy the forms-specific matcher from **R3-5 — Holds, honestly**.

### The command

`mercato privacy retention --tenant <id> --set <id> --older-than-days <n> --reference <text> [--target records|softDeleted] [--exclude-subject <kind:id> …] [--max <n>] [--after <cursor>] [--apply]`

Preview by default: it walks the set and prints the count. With `--apply` it processes up to `--max` roots. The maximum is an integer 1–1000, default 1000, with database batches of at most 100; a capped preview returns a continuation and does not claim a total. For standard sets it writes one audit entry per run under `privacy.retention_run`, with a random run UUID as resource id and the set, the window, the target, the counts, `filesPending`, preserved shared-file count, the number of exclusions, the terminal status, required-side-effect status, refusal or skip reason, and the reference. No attachment id or storage coordinate is logged. Evidence-expiry sets select the shared aggregate path below through their declaration; the command and engine cannot replace it with ordinary actor/reference/run evidence.

`mercato privacy retention --installation --set <id> --older-than-days <n> --reference <text> [--exclude-subject <kind:id> …] [--max <n>] [--after <cursor>] [--apply]`

Exactly one of `--tenant` and `--installation` is required. The installation form takes no tenant, organization or target other than `records`. It runs only a set declaring `installationScope: true`, in preview by default, as "Installation-scope runs" below describes.

### Legal holds

Under **DEC-C — Retention sets and holds**, before preview and before each apply batch, the service builds the list of subjects to leave out:

1. the `--exclude-subject` values, repeatable;
2. when the optional DI key `privacyRetentionGuard` is registered, the subjects its `excludedSubjects({ scope, setId })` returns. The enterprise engine registers it from its active holds. At entry, a guard that throws refuses before anything is counted or deleted; a later failure stops before the next batch and preserves earlier committed counts. Without a guard, only the operator's values are used.

Without the validated engine exception below, if any subject on the list has a kind outside the set's `excludableSubjectKinds`, the run refuses the set with reason `hold_not_honourable` and deletes nothing. This fails closed: a held person the set cannot attribute records to stops the set for that tenant. Otherwise the list is passed to every `pruneRecords` call as `excludeSubjects`.

The service canonicalizes the list and checks it again before each apply batch. If the guard fails or the list changes, it stops before the next write, reports committed counts and `hold_guard_failed` or `holds_changed`, and requires a fresh preview; it does not roll back completed batches. A new hold is protected from the next batch. A hold committed after a batch's check can affect that batch; hold activation is not atomic with module writes.

The command and the enterprise engine both call `privacyRetentionService.run`. The typed in-process entry below carries the engine's validated per-policy `allowUnmatchedHolds` decision. Only unsupported kinds returned by a successful guard may pass under that decision; operator exclusions, guard errors, stale holds, class-hold refusals and explicit set holds remain refusals. The command supplies no engine policy context and has no opt-out, even if a stored policy enables the flag. The first sets below declare no excludable kind: an `auth:user` hold also stops them because that user may be mentioned in someone else's text. The DSR engine owns **R3-10 — One definition of a stale hold**; this service never catches a refusal and turns it into an empty exclusion list.

An installation-scope run applies the same rule without a tenant. It asks the guard's optional `installationExcludedSubjects({ setId })` instead of `excludedSubjects`, and has no unmatched-hold opt-out; see "Installation-scope runs" below.

### First sets

| Set | Age | Floor | What goes | Can leave out (`excludableSubjectKinds`) |
|---|---|---|---|---|
| `notifications.inbox` | `created_at` | 30 days | Read, acted-on or dismissed notifications, including those dismissed by expiry cleanup | `[]`: any subject hold skips the set |
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
| `privacy.tenant_export_evidence` | [Tenant exit](2026-11-16-tenant-exit-export.md), **CLI, audit and output — Tenant-export evidence expiry**: terminal completion of settled lifecycle groups; tenant runs use effective `retention.privacy.tenantExportEvidenceAgeDays`, installation runs `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS` under R4-3 | 30 days | Whole settled `privacy.tenant_export` groups; unresolved publication or reconciliation stays. `[]`, `runEvidence: 'aggregate'`, `installationScope: true` |

Both closure sets use stable markers so later polls/edits cannot reset age. In-place reduction counts roots processed as `deleted`; coverage handlers perform the current-history strip described above, including provider-owned child records through their services. The content-ai owner supplies EUDR's `retention.eudr.recordAgeYears` under R3-3; this catalog supplies no second setting or schedule.

### Pending-action staff exclusions

R5-10 defines the `ai_assistant.pending_actions` staff matching rule. For every held or explicitly excluded `auth:user`, the assistant-owned handler leaves the whole action out when `created_by_user_id` or `resolved_by_user_id` names that user, or when the typed pair `(target_entity_type, target_record_id)` names that staff user. A batch action is also left out when any decrypted `records[].entityType` / `recordId` pair names that user. Match type and id together, never a bare record id. These checks apply to standalone and conversation-linked actions, in preview and under the per-batch guard/exclusion recheck on apply. An action created by someone else is protected when the held user is its approver/resolver or target; no part of that excluded action or its attachment list is pruned.

Content-ai coverage still owns the handler, terminal-state eligibility and shared file-release routine. Its **Pending assistant actions** and `privacy-pending-action-retention.test.ts` must use this R5-10 rule rather than creator-only matching. Neither spec claims to recognize arbitrary staff mentions inside `normalized_input`, `field_diff`, prose or opaque payloads. Those mentions alone remain unprotected by selective staff exclusions; changing that requires a separate design owned by content-ai coverage. Unsupported customer/identifier kinds continue to skip the set with `hold_not_honourable`, subject only to the existing validated engine exception. The first sets above still declare `[]`, so their staff holds skip the whole set.

### R3-7 — Chat file release honours other conversations

The shared assistant deletion routine collects `attachment_ids` before removing messages and pending actions. Before calling `releaseByIds`, it scans its own message and pending-action tables throughout the tenant, including soft-deleted rows not selected in this batch and standalone actions with no conversation. An id still listed outside the exact rows being deleted is removed from the deleted rows only, counted as `filesShared`, and never released. A standalone action being pruned is treated as its own selected row, never as a missing conversation that permits release. The check covers a maliciously injected colleague's id and a legitimately shared id. Attachment scope, organization and `expectedEntityId: 'ai-chat-draft'` checks still apply through the owner service; the attachment service's shared-storage check is additional protection, not a replacement for this scan.

All assistant writes of attachment lists, including message append, import and pending-action persistence, and every file-release path, including standalone-action retention, use the same tenant-scoped transaction advisory lock. They acquire it before reference checks and hold it through commit; writes recheck that each referenced attachment is still available through `attachmentService`. Thus a newly committed reference cannot appear between the surviving-reference check and release. Locks live in the assistant module; no caller reads attachment tables directly. The content-ai erasure class calls this same routine and uses R3-7 unchanged.

### Conversation rows and concurrent writes

The routine also locks each selected conversation row, then rechecks tenant, organization, target, deletion state and age against the fixed cutoff before touching children. Append and soft delete acquire the same row lock before their accessibility check; creation of a reused client id uses the same scoped conversation-id lock. If append wins first, its new activity makes the conversation ineligible. If retention wins, append rechecks after waiting and refuses the missing or deleted conversation without inserting a message.

Children match the exact tenant, organization and `conversation_id`, with `created_at >=` the selected row's `created_at`. For a deleted row they also have `created_at <= deleted_at`; later children of a reused live id survive. The routine enumerates every incarnation before deletion. If intervals overlap or children cannot be assigned safely, it skips that incarnation with `ambiguous_conversation_children`, releasing no files. It never deletes a live incarnation merely because an older row has the same id.

### Unreferenced chat drafts

The attachments module owns `attachments.unreferenced_chat_drafts`. Its handler selects only scoped `ai-chat-draft` uploads older than the fixed cutoff. It calls the new assistant-owned `assistantAttachmentReferences.withUnlistedIds` service through DI, which takes the same tenant lock, scans all message and pending-action attachment lists, and invokes the attachment owner's release callback only for unlisted candidates before commit. It never returns transcripts. Missing assistant registration or a failed scan refuses with `reference_source_unavailable`; no fallback query crosses module boundaries. The attachment owner rechecks scope, age and entity under lock, releases through its existing ownership and shared-object machinery, and queues durable deletions with the set's origin. A newer upload, a listed upload and any upload outside the exact scope survive. This is an explicit manual/scheduled retention target; no new automatic deletion starts on upgrade.

### Notification cache

For each committed notification batch the owner collects distinct affected `(tenant_id, organization_id)` pairs and calls its existing `invalidateNotificationCache(..., 'deleted')` in `notifications/lib/notificationService.ts`. The handler lives with that helper or shares a module-local helper; it does not duplicate cache tags. A failed invalidation makes the run incomplete, retains the affected scope pairs in the continuation, and retries them before advancing. A caller resuming that continuation retries those scopes even when no notification rows remain. Dry run never invalidates.

### R3-8 — Retention drains its own pending file deletions

`privacyRetentionService.run` calls `drainPendingDeletions(scope, { origin })` for `origin: 'privacy:retention:<setId>'` after every committed batch, regardless of whether the caller is the command or the enterprise engine. In apply mode it also retries that origin's backlog at entry, including a resumed run with no matching rows. Preview never drains or writes. The handler releases rows and enqueues deletion coordinates in its transaction; provider deletion runs only after commit. File-producing sets require the erasure seam at pre-flight; a set without files can run when attachments is disabled, with zero pending files and no drain capability to invoke. The service reports the remaining `filesPending` and a failure makes the command exit 2 and the engine pass incomplete. A later run or the attachments drain command retries the durable coordinates. The engine adds no separate drain. The declaration alone never implies success while files remain pending.

### Aggregate evidence for expiry runs

The shared driver owns both evidence projections. `PrivacyRetentionSetDefinition.runEvidence` is optional, defaults to `standard` and is validated once with the declaration under R3-2. Declare `runEvidence: 'aggregate'` on `privacy.retention_evidence`; [C1’s **Export-evidence expiry**](2026-11-16-privacy-data-class-contract.md) and [the export-audit spec’s **Export-evidence expiry**](2026-11-16-export-audit-event.md) must select it on `privacy.export_evidence` and `audit_logs.export_evidence` respectively. Other dedicated evidence-expiry owners use this same selection. This is not an input flag, a handler logger or permission to suppress runner evidence.

For `aggregate`, `privacyRetentionService.run` builds the exact `PrivacyRetentionAggregateSummary` below from validated set id, counts and invocation dates, using a strict zod schema with no passthrough. It calls `actionLogService.log` itself under resource kind `privacy.retention_run`, static command id `privacy.retention.run`, resource id equal to the validated set id and the trusted invocation tenant/organization, both null for an installation-scope run. Besides the audit row’s intrinsic database id, scope and timestamps, the only variable evidence is that summary. Pass null actor/on-behalf-of, parent/related pairs and undo token; omit payload, before/after snapshots and changes. Never spread caller, handler, command or engine context into it. In particular, no reference, actor id, export/request id, subject id, prior run id, policy id, continuation, error text or attachment coordinate is copied into context, labels or projections. The required caller `reference` is still validated for invocation consistency, but is not persisted by this branch. Standard sets retain their ordinary run evidence.

Preview writes no expiry summary. Apply requires the audit logger at entry and writes one aggregate summary for the bounded invocation, including zero-change, skipped or incomplete outcomes, using only its actual counts/dates; reasons and retry positions stay in the immediate result. Missing logging capability refuses before pruning; a later write failure reports `complete: false`, `status: 'incomplete'`, `reason: 'evidence_write_failed'` with committed counts and retry position preserved. A summary is not successful deletion proof by itself. Neither command wrappers nor the engine add a second identifying `privacy.retention_run` entry for this invocation. Handlers return counts through `pruneRecords` and never bypass or duplicate the driver’s logger. Export-evidence expiry waits until this path and its tests ship.

### Retention-run evidence

This spec owns expiry of `privacy.retention_run`, including the inactive-subject command's entries. Declare `retention.privacy.retentionEvidenceAgeDays` in `privacy.ts.settings`: integer, unit days, minimum 30, default 365, through R3-3. Declare `privacy.retention_evidence`, target `records`, floor 30, `excludableSubjectKinds: []`, handler `privacyRetentionEvidenceHandler`, `runEvidence: 'aggregate'`, `installationScope: true`. Its installation-scope branch, for summaries with no tenant, is in "Installation-scope runs" below. It uses `privacyRetentionService.run` and the audit owner's DEC-B method with the exact `includeResourceKinds: ['privacy.retention_run']`, `mode: 'delete'`, scope, fixed cutoff, cursor, limit and dry-run flag. It never queries audit tables. The effective age must satisfy both the setting and caller window. The audit owner lists candidate metadata through `actionLogService.list`; strict aggregate summaries of the shape above are terminal count evidence and expire at the same finite age, including summaries from this set itself. An aggregate summary's resource id equals its validated `setId`, so DEC-B can select or exclude that pair without adding a run identifier. Malformed or unidentified evidence refuses the evidence batch before the delete call; never infer completion from a missing ordinary run UUID or delete an unvalidated summary by kind alone. For standard entries, exclude an unresolved run by the exact pair `{ resourceKind: 'privacy.retention_run', resourceId: retentionRunId }`, preserving that identity across its entries, never a bare UUID or a child R3-14 erasure `runId`. A missing or unavailable completion check refuses the evidence pass. Whole-entry deletion removes actor, reference and context as well as the resource id; only aggregate counts, dates and set id survive in a separate summary, without subjects, preview contents, retention/erasure run ids, actor or free-text reference.

For inactive-subject entries, consume the aggregate audit metadata owned by [inactive-subject retention](2026-11-16-inactive-subject-retention.md), **API Contracts**: `status: 'running' | 'complete' | 'stopped' | 'incomplete' | 'refused'`, `terminal: boolean`, `requiredSideEffects: 'complete' | 'pending' | 'failed'`, `filesPending: number` and `continuationPending: boolean`. Only settled terminal evidence is eligible. Running/incomplete work, pending files, failed/pending required effects, a continuation of committed unfinished work and missing/invalid completion metadata remain unresolved; a zero remaining candidate count never proves success. A capped invocation can be `stopped` and terminal only when all work it began is settled. These completion fields do not redefine that owner's candidate/activity contracts or the child erasure result.

An active hold or explicit exclusion skips this evidence set; a guard failure refuses. The evidence handler itself refuses any non-empty `excludeSubjects`, so the engine's unmatched-hold flag does not override evidence preservation. A later pass after release uses the original evidence age. No scheduler is introduced here: the operator must schedule the command, or enable the engine policy. An unconfigured runner or unresolved work means the finite target is not yet enforced and is reported as such. Generic history sets still exclude `privacy.`; their exemption is separate from this dedicated owner expiry.

### Installation-scope runs

R4-3 gives historical `privacy.tenant_export` rows with `tenant_id IS NULL` a finite age, `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS`, and C8's **Installation invocation** cites this spec's caller/handler contract (assumption 10) and supplies the handler and its audit method. `PrivacyScope` stays tenant-required. An installation run is a separate, explicit entry, never a tenant run with the tenant left out.

- **Entry.** `privacyRetentionService.runInstallation(input: PrivacyRetentionInstallationRunInput)` and the command's `--installation` form. The input has no `scope`, tenant, organization or `enginePolicy`; its strict zod schema rejects them. The tenant `run` entry and `pruneRecords` are unchanged and never reach a null-tenant row.
- **Which sets.** Only a set declaring `installationScope: true`. R3-2 validation accepts that flag only together with `runEvidence: 'aggregate'`, `targets: ['records']` and `excludableSubjectKinds: []`, so installation work is always evidence expiry with no files and no subject it can leave out. At entry the service resolves the handler and requires `pruneInstallationRecords`. A set without the flag, or a handler without the method, refuses with `installation_unsupported` before anything is counted. The declaring sets are C8's `privacy.tenant_export_evidence` and this spec's `privacy.retention_evidence`.
- **Which rows.** The handler selects exactly `tenant_id IS NULL` through its owner service, never all tenants and never a tenant row. It applies its set's own eligibility, terminal-state and unresolved-work rules exactly as its tenant path does. C8 owns the audit-owner method its handler calls, `actionLogService.expireInstallationTenantExportEvidence`.
- **Age.** The privacy module's `resolveInstallationEvidenceAgeDays()` reads `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS` with zod: unset means 365, an integer of at least 30 is used, and anything else refuses with `installation_age_invalid`. No tenant `module_configs` age applies. A caller window below the effective age refuses, as a tenant run refuses below its tenant setting. The handler checks both on every batch, so an invalid value refuses before anything is counted.
- **Holds.** The guard gains an optional method, `installationExcludedSubjects({ setId })`, which returns every subject under an active hold anywhere in the installation, or throws. The Enterprise guard also throws on a set hold naming the run's set and on any class hold, as its tenant guard refuses those. A row with no tenant cannot be attributed to one, so a hold in any tenant counts. Installation sets declare `[]`, so any returned subject or `--exclude-subject` value skips the set with `hold_not_honourable`. A registered guard that throws, or lacks the method, refuses with `hold_guard_failed`; it is never read as "no holds". Without a guard, only the operator's values are checked. The check repeats before every apply batch, with `holds_changed` as for tenant runs. There is no `allowUnmatchedHolds` opt-out at installation scope.
- **Position and locking.** The fixed cutoff, keyset, `max` and batch limits follow the tenant rules. The opaque position binds an installation marker, in place of tenant and organization, with the set, target, window, cutoff, exclusion digest and effective installation age. A tenant continuation given to an installation run, the reverse, or a resumed run whose installation age changed, refuses before a handler runs. Each batch is its own transaction. The owner takes `withAdvisoryXactLock` (`@open-mercato/shared/lib/db/advisoryLock`) under a fixed installation key for that set, so two installation runners cannot mutate the same selection; tenant runs keep their own locks.
- **Evidence.** Preview writes nothing. Apply writes the one strict `PrivacyRetentionAggregateSummary` of "Aggregate evidence for expiry runs", with null tenant and organization, resource kind `privacy.retention_run`, command id `privacy.retention.run` and the set id as resource id. The logger requirement and failure rules are the same. No file is produced, so R3-8 has nothing to drain, no drain is called, and `filesPending` and `filesShared` are zero. Output is counts only.
- **Its own evidence.** At installation scope `privacy.retention_evidence` deletes, through DEC-B with `tenantId: null` and exact `{ resourceKind: 'privacy.retention_run', resourceId }` pairs, only validated strict aggregate summaries whose resource id is the id of an installation-capable set, once older than the installation age. The installation run therefore creates no unbounded evidence of its own. A selected row that is not a valid strict summary refuses the batch, as at tenant scope. The action-log system pass's `system-history:<run UUID>` summaries and every other null-tenant row stay with their own owners.
- **Who runs it.** An operator, or the operator's scheduler, runs the command. This spec adds no scheduler and no engine path, and tenant policies never govern installation rows. Without a runner, or while a hold or unresolved work remains, the finite installation age is reported as not yet enforced.

### Design decisions

| Decision | Rationale |
|---|---|
| A separate registry | See assumption 3. |
| The caller supplies the window | One implementation serves the manual command and the enterprise engine. |
| A floor per set | Each has readers that assume some history. |
| A position in and out | Without one, a dry run with a limit returns the same batch for ever and a preview cannot count past it. |
| Attachments are released through their owner, by id | The assistant module must not delete from the attachments table. Chat uploads are not attached to the conversation, so the handler collects the ids from `attachment_ids` on the conversation's messages and pending actions before it deletes them. It applies R3-7 and passes only unshared ids to `releaseByIds` with `expectedEntityId: 'ai-chat-draft'` in the same transaction. |
| `ageBasis` is text | A person must be able to read what a window means before choosing one. |
| A subject the set cannot leave out stops the set | Ignoring it would delete a held person's records by age. Skipping only delays retention. |
| The guard is optional and soft, and fails closed when present | Without the enterprise engine there are no holds; with it, a guard that cannot answer must not be read as "no holds". |
| A separate installation entry, not a nullable scope | Tenant runs keep a required tenant, so no tenant-path fault can reach null-tenant rows, and an installation run is always explicit. See assumption 10. |
| Installation scope only for aggregate evidence sets | Those sets have no files, no subject they can leave out and no actor in their evidence, so a run without a tenant needs no new hold, drain or evidence rule. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Model these as data classes | See assumption 3. |
| Instance-wide windows from environment variables, on a schedule | The path #2980 took for change history, which maintainers placed in Enterprise. |
| One generic purge of every soft-deleted row | No shared rule for when a soft-deleted row is safe to remove. |
| Letting the engine delete by SQL | It would have to know every module's tables. |
| Include change history and inactive contacts | Each is a decision of its own; see "Not in this spec". |
| No retention-run evidence expiry until the controller sets an age | Evidence would stay unbounded wherever nobody sets one; a finite default with a floor protects by default and stays configurable. |
| A nullable tenant in `PrivacyScope` | Every scoped method in the program would then accept "no tenant"; R4-3 and C8 rule it out. |
| One tenant-or-installation scope union on `run` | It changes the input the engine and every coverage set already cite, and lets an installation call reach tenant-only paths such as engine policy and file drains. |
| A separate installation service in each owning module | The action-log system pass does this for generic history; for privacy evidence it would repeat holds, positions and aggregate evidence in every owner. |

### Known limits

- Holds exist only when the enterprise guard is installed, as **R3-5 — Holds, honestly** requires in the program spec's **Known limits**. OSS operators can supply explicit exclusions; because the first sets cannot protect every mention, any supplied subject skips those sets.
- A subject mentioned only in text cannot be attributed reliably. All first sets therefore declare `excludableSubjectKinds: []`; tenant-wide skips may delay retention for a long hold.
- R5-10 protects pending actions through explicit creator, approver/resolver and typed target links, including batch targets. A staff user mentioned only in payload text remains unprotected by that set's selective exclusions; content-ai coverage owns any design to cover those mentions.
- Unread notifications stay until they are read, actioned or dismissed; the existing expiry command can dismiss them.
- Unreferenced chat drafts need an operator run or an enterprise policy. A listed upload remains until every referencing record is removed; no uploader-based subject erasure is claimed.
- Installation-scope runs treat a hold in any tenant as a hold on every null-tenant row, so a long hold anywhere delays installation evidence expiry. A registered Enterprise guard without `installationExcludedSubjects` refuses every installation run until it implements the method, which the DSR engine ships in its Phase 1. Installation runs need an operator's schedule; no engine policy covers them.

## 📝 Delta

### Capability: privacy-record-retention

#### ADDED Requirement: Retention sets
The system SHALL let a module declare a set of its own records that can be deleted by age, and SHALL delete from it only when a caller supplies a window at or above the set's minimum.

##### Scenario: Preview
- WHEN the command runs without the apply flag
- THEN it prints how many records are past the window, however many batches that takes, and changes nothing

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
- WHEN no guard is registered
- THEN only the operator's `--exclude-subject` values are checked against the set declaration

##### Scenario: Another creator's action targets a held staff user
- WHEN an old terminal action was created by another user and its approver/resolver or typed single-record or batch target is a held or explicitly excluded staff user
- THEN R5-10 leaves the whole action and its attachment list unchanged in preview and apply; an otherwise eligible unrelated action can still be pruned

#### ADDED Requirement: Notification retention
The system SHALL delete notifications past the window that are read, acted on or dismissed, and SHALL keep rows still marked unread. Expiry cleanup may first dismiss them.

##### Scenario: Old and read
- WHEN a read notification is older than the window
- THEN it is deleted

##### Scenario: Old and unread
- WHEN an unread notification is older than the window
- THEN it is kept until its status changes; after expiry cleanup dismisses it, the same old row is eligible

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
- THEN its row is released and its stored object is deleted or reported pending; a listed or newer upload stays

#### ADDED Requirement: A bounded engine entry
The system SHALL accept the engine's validated per-policy unmatched-hold decision only through the typed in-process `privacyRetentionService.run` entry, retain every other guard refusal, and own every R3-8 drain.

##### Scenario: One reserved engine batch
- WHEN the engine supplies a matching policy id/version/decision and a maximum of at most 100
- THEN the service calls at most one handler batch, drains only after its commit, and returns the remaining position and pending-file count

##### Scenario: A stale hold under the opt-out
- WHEN the policy enables `allowUnmatchedHolds` but the guard refuses a stale hold or an explicit set hold
- THEN no handler is called and the refusal is preserved

#### ADDED Requirement: Finite retention-run evidence
The system SHALL expire terminal retention-run evidence through its dedicated owner set, with the configured finite age and whole-entry deletion, preserving held and unresolved evidence.

##### Scenario: Expired evidence
- WHEN a terminal entry is older than both the configured age and the caller's window and no exclusion applies
- THEN `privacy.retention_evidence` deletes the entry including actor, reference and context, without changing other privacy evidence kinds

#### ADDED Requirement: Installation-scope runs
The system SHALL run a set at installation scope only through the separate installation entry and only when the set declares `installationScope: true`, SHALL then read only rows with no tenant, and SHALL keep `PrivacyScope` tenant-required.

##### Scenario: Preview of null-tenant evidence
- WHEN `mercato privacy retention --installation --set privacy.tenant_export_evidence` runs without the apply flag
- THEN it counts only settled null-tenant groups older than the installation age and changes nothing

##### Scenario: A set without installation support
- WHEN `--installation` names `notifications.inbox`
- THEN the command refuses with `installation_unsupported` and exits 1

##### Scenario: Tenant rows stay out
- WHEN an installation run is applied
- THEN due null-tenant rows are deleted, every tenant row is unchanged, and the one aggregate summary has null tenant and organization

##### Scenario: A hold anywhere
- WHEN a registered guard reports an active hold in any tenant, or lacks `installationExcludedSubjects`
- THEN the set skips with `hold_not_honourable`, or refuses with `hold_guard_failed`, and nothing is deleted

## 📝 Architecture

- **Types** in `packages/shared/src/modules/privacy.ts`: the set declaration, handler, guard, fixed-cutoff position and count types, validated with zod.
- **`privacy` module**: the registry of sets, the `retention` command, and `privacyRetentionService.run` for in-process callers with the same inputs. The service resolves `privacyRetentionGuard` softly, checks it before every batch, applies the hold rule and owns R3-8. It also owns `runInstallation`, the command's `--installation` form and `resolveInstallationEvidenceAgeDays()`.
- **`notifications`**, **`ai_assistant`**, **`attachments`**: their declarations and handlers; notification cache invalidation; assistant reference and row locks. Optional services are resolved softly; a missing required capability refuses its set.
- **`attachments`**: `releaseByIds` and `drainPendingDeletions`, which the erasure spec's attachments seam adds together with the `attachment_pending_deletions` table. This spec uses them and does not define them. Handlers use the set's `privacy:retention:<setId>` origin. R3-8 drains after each committed batch and counts failures for every caller.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Command → handlers | The set registry and DI keys | An unknown set is reported |
| Assistant handler → attachments | The attachments service: `releaseByIds` in the batch's transaction, `drainPendingDeletions` after commit | The service lacks the methods: the set's `records` and `softDeleted` targets are refused, with the reason, until the erasure spec's seam phase lands |
| Command → holds | `privacyRetentionGuard` by DI key, resolved softly; a registered guard that throws is a refusal | Only the `--exclude-subject` values are left out |
| Enterprise engine → sets | `privacyRetentionService.run`, including holds, continuation and R3-8 | No direct handler loop |
| Attachments draft set → assistant references | `assistantAttachmentReferences.withUnlistedIds` by DI; same tenant lock as R3-7 | Refuse `reference_source_unavailable` |
| Command → installation sets | `runInstallation` for sets declaring `installationScope: true`, handler `pruneInstallationRecords`, guard `installationExcludedSubjects` | Unsupported set or handler: `installation_unsupported`; registered guard without the method: `hold_guard_failed` |

## 📝 Data Models

One additive index, created concurrently, with its migration and snapshot: `notifications (tenant_id, created_at)`. Conversations are found through the existing index on tenant, organization and `deleted_at`, and through the tenant's own conversations for the live target. No new table or column. Installation runs add no index: the audit owner's existing `action_logs_resource_idx` on `(tenant_id, resource_kind, resource_id, created_at)` serves `tenant_id IS NULL`.

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
  installationScope?: boolean   // default false; true only with aggregate evidence, ['records'] and []
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
  }) => Promise<{ matched: number; deleted: number; filesPending?: number; filesShared?: number; next?: string; done: boolean; incompleteReason?: string }>
  pruneInstallationRecords?: (input: {   // required when the set declares installationScope; rows with tenant_id IS NULL only
    olderThanDays: number
    target: 'records'
    limit: number
    cutoff: string
    after?: string
    dryRun: boolean
  }) => Promise<{ matched: number; deleted: number; next?: string; done: boolean; incompleteReason?: string }>
}

type PrivacyRetentionGuard = {
  excludedSubjects: (input: {
    scope: PrivacyScope
    setId: string
  }) => Promise<{ subjects: PrivacySubjectReference[] }>   // throws when it cannot answer, or to refuse a held set
  installationExcludedSubjects?: (input: {
    setId: string
  }) => Promise<{ subjects: PrivacySubjectReference[] }>   // every active hold in any tenant; throws when it cannot answer, or to refuse a set hold naming the set or any class hold
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

type PrivacyRetentionInstallationRunInput = {   // strict: no scope, tenant, organization or enginePolicy
  setId: string
  olderThanDays: number
  target: 'records'
  reference: string
  max: number
  batchLimit?: number
  after?: string
  excludeSubjects?: PrivacySubjectReference[]
  dryRun: boolean
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
}

type PrivacyRetentionAggregateSummary = {
  setId: string
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
runInstallation(input: PrivacyRetentionInstallationRunInput): Promise<PrivacyRetentionRunResult>
resolveInstallationEvidenceAgeDays(): number   // OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS; unset 365, floor 30, else throws installation_age_invalid
```

- **`retentionSets`** — optional on the planned `privacy.ts` default export. R3-2 owns registry generation and member validation; this spec adds the retention collector and schema, not a second generator design.
- **`privacyRetentionService.run`** — the only batch driver for command and engine. Zod validates scope/set, a supported target, positive integer `olderThanDays`, reference length 1–120, `max` as integer 1–1000 and `batchLimit` as integer 1–100 (default 100), bounded by the remaining maximum; a handler examines at most its `limit`. With `enginePolicy` supplied, `max` is at most 100 and the service makes at most one `pruneRecords` call, returning `next` even if that call did not spend the full reservation. The engine owns any subsequent reservation. The service coordinates the transaction boundary, fixed cutoff/position and R3-8 drain; the owning handler commits its module transaction before post-commit work. A handler may return `incompleteReason` after a committed batch; the service still performs R3-8 and then stops with that reason and its retry position. `cutoff` is the fixed UTC ISO eligibility timestamp, or null only when validation/refusal occurs before selection; `after` carries it with the bound keyset and no caller may supply a replacement cutoff. `matched`, `deleted` and `filesShared` count this invocation only, so an engine can accumulate successive reservations without counting prior batches twice. `reason` preserves `hold_not_honourable`, `hold_guard_failed`, `holds_changed`, policy refusals and handler incomplete reasons; a changed guard or policy requires a new preview before further writes. `done` means the selection is exhausted; `complete` additionally requires successful cache work, zero pending files and no refusal or incomplete reason. `filesPending` in a handler result defaults to zero and is replaced by the post-drain remaining count, never summed repeatedly over the same backlog.
- **Aggregate evidence.** `runEvidence` is declaration-only; `PrivacyRetentionRunInput` accepts no override. `PrivacyRetentionAggregateSummary` is the complete allowed variable evidence for aggregate runs; its counts are non-negative integers and its dates are UTC ISO timestamps with `finishedAt >= startedAt`. The driver’s evidence writer enforces the set-id-only resource and null actor/payload fields described above. Unknown summary keys are rejected, not passed through.
- **Engine policy context.** Only in-process engine callers supply `enginePolicy`; the CLI argument schema accepts no such field or opt-out flag. Before preview and every apply batch, resolve the optional `privacyRetentionPolicyService.getActiveWindow` from [enterprise coverage](../enterprise/GDPR/2026-11-16-privacy-coverage-enterprise.md), **Policy access**. With context supplied, missing service/policy refuses, errors refuse, and policy id/version, exact scope/set/window/target, mode and `allowUnmatchedHolds` must match. Apply requires an apply policy. Policy changes stop with committed counts and require a fresh preview; policy id/version/decision join the continuation digest. With no context, the unmatched-hold decision is always false. All held references still reach `pruneRecords` as exclusions; the flag permits only the guard's otherwise unsupported kinds, and handlers keep their own stricter rules. It cannot suppress failed guards, R3-10 stale holds, set/class holds or explicit caller exclusions. Every caller receives the same R3-8 post-commit drain; no engine drain is added.
- **`privacyRetentionService.runInstallation`** — the only driver of `pruneInstallationRecords`. Its zod schema is strict and has the same set, window, reference, `max`, `batchLimit` and exclusion rules as `run`, with `target` fixed to `records`. It refuses `installation_unsupported` unless the set declares `installationScope: true` and its handler has the method, and passes no `scope` and no `excludeSubjects`: installation sets declare `[]`, so any exclusion or returned hold skips first. It resolves the guard's `installationExcludedSubjects` before preview and every apply batch; a registered guard without it, or one that throws, refuses with `hold_guard_failed`. It writes the aggregate summary with null tenant and organization, calls no R3-8 drain and returns `filesPending: 0` and `filesShared: 0`. The result type, `cutoff`, `next`, `done` and `complete` keep their `run` meanings. R3-2 rejects `installationScope: true` on a declaration without `runEvidence: 'aggregate'`, `targets: ['records']` and `excludableSubjectKinds: []`.
- **`assistantAttachmentReferences.withUnlistedIds`** — proposed assistant DI service: `{ scope, ids, transaction, release }`; validates candidate UUIDs, acquires the R3-7 lock, scans tenant-wide references and calls `release(unlistedIds)` in the same transaction. Callback code belongs to attachments; the assistant service never touches its tables.
- **`privacyRetentionGuard`** — an optional DI key. The OSS side only resolves it; the enterprise DSR engine registers it. `installationExcludedSubjects` is an additive optional method; it is consulted only by installation runs, and the DSR engine implements it (DSR engine, "How a hold matches").
- **CLI** as above. `--exclude-subject` takes `<kind>:<id>`, validated by the command's zod schema, and may repeat. Exactly one of `--tenant` and `--installation` is required; with `--installation`, `--target` is absent or `records`. `installation_unsupported` and `installation_age_invalid` exit 1. Exit 0 when the run finished, 2 when it stopped on a failure or files remain pending, 1 when it refused or stopped for changed holds: a window below the floor, an unknown set, a registered guard that threw, or a subject to leave out that the set cannot leave out (`hold_not_honourable`); file drain failures exit 2 even after row deletion committed.
- **Audit entry** `privacy.retention_run`: standard runs use the ordinary entry above; aggregate runs use only `PrivacyRetentionAggregateSummary` and the fixed/null audit metadata, with no caller identifier or reference. Installation-scope summaries also have null tenant and organization.
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
| An expired unread notification | Kept while still unread; once `cleanupExpired` dismisses it, eligible by `created_at` |
| Rows with no tenant | Not touched by a tenant-scoped run; only an installation run of a set declaring `installationScope: true` reads them |
| `--max` reached | The run stops and says more remain |
| The guard returns a subject of a kind a set declares | Its records are left out; none of the first sets declares any kind |
| A terminal action names a held staff user only as approver/resolver or typed target | R5-10 leaves the whole action out even when someone else created it; includes batch targets and standalone actions |
| A staff user appears only in an action's payload text | R5-10 does not attribute that mention; the action may expire despite a selective staff exclusion, as the known limit states |
| The guard returns a subject of a kind the set does not declare | Refused with `hold_not_honourable`; nothing counted or deleted; exit 1 |
| The guard throws, or refuses a set under a hold on the set itself | Refused; nothing counted or deleted; exit 1 |
| No guard registered | Only explicit exclusions apply; the first sets skip for any such subject, and preview says no hold guard is installed |
| `--exclude-subject` names a kind the set does not declare | Refused the same way, with `hold_not_honourable` |
| A malformed `--exclude-subject` value | Rejected by the argument schema before anything runs |
| A hold placed between batches | The next check stops with `holds_changed`; earlier committed batches remain committed |
| A reused conversation id | Only unambiguous time-bounded children of the selected row can go; later live children stay |
| An append racing live pruning | Row lock plus age recheck; append-first survives, retention-first refuses the append |
| A continuation for another scope, cutoff or exclusion list | Refused before a handler runs |
| A bounded engine call with `enginePolicy.allowUnmatchedHolds` | Policy id/version/window/target/decision are revalidated; only the otherwise unsupported guard-returned kinds may pass, with all held references still given to the handler |
| The same policy used by the OSS CLI | No engine context is accepted; unmatched holds still refuse |
| A stale hold, guard error, explicit set/class hold or operator exclusion under the opt-out | Refused; the flag never turns a refusal into an empty exclusion list |
| A standalone action still lists a conversation's upload | Its reference protects that upload under R3-7, including from draft cleanup |
| Terminal retention evidence past its configured age | Dedicated `privacy.retention_evidence` deletes the whole entry; held or unresolved evidence survives with an explicit reason |
| Both `--tenant` and `--installation`, or neither | Rejected by the argument schema before anything runs |
| `--installation` for a set without `installationScope: true`, or a handler without `pruneInstallationRecords` | Refused with `installation_unsupported`; nothing counted; exit 1 |
| A malformed or below-30 `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS` | Refused with `installation_age_invalid` before anything is counted; exit 1 |
| An installation window below the installation age | Refused, with the age in the message |
| A registered guard without `installationExcludedSubjects`, or one that throws | Installation run refused with `hold_guard_failed`; tenant runs unaffected |
| An active hold in any tenant during an installation run | The set skips with `hold_not_honourable`; nothing deleted; exit 1 |
| A tenant continuation given to an installation run, the reverse, or a changed installation age on resume | Refused before a handler runs |
| A null-tenant `system-history:<run UUID>` summary or other null-tenant row | Not selected by installation `privacy.retention_evidence`; it stays with its own owner |

## 📝 Migration & Backward Compatibility

New declaration and service surfaces, including optional `runEvidence`, are additive: one optional member of the planned convention, types, command, services, optional DI keys, an audit entry and one index. New cutoff and cursor requirements are for the unreleased handler contract. Existing routes keep their URLs and response shapes; append may no longer succeed against a conversation concurrently deleted. Lock ordering is tenant reference lock, conversation-id lock, then conversation row lock. No new user-editable entity is added. The declaration's field is `excludableSubjectKinds`; an earlier draft named it `excludableSubjects`, and nothing has shipped with that name. Nothing is deleted on upgrade. `UPGRADE_NOTES.md` names the command and says what each set removes. The installation surfaces are additive and optional: `installationScope`, `pruneInstallationRecords`, `installationExcludedSubjects`, `runInstallation`, `resolveInstallationEvidenceAgeDays`, the `--installation` flag and the `installation_unsupported` and `installation_age_invalid` reasons. `PrivacyScope`, `run`, `pruneRecords` and `excludedSubjects` are unchanged; a guard without the new method refuses installation runs only. C8 lists `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS` in both `.env.example` files.

## 📋 Implementation Plan

1. Add zod-derived types, `getRetentionSets` under R3-2, cutoff and keyset validation. Unit tests `retention-position.test.ts`: deleted rows between batches, equal creation times, resume, foreign tenant/set/target/cutoff tokens and changed exclusions.
2. Add service and command. Unit tests `retentionService.test.ts`: preview, floors, unknown set, bounded maxima/batches, malformed exclusions, no guard, failed guard, unsupported `auth:user` and person kinds, a fake supporting handler, and a hold created between batches. Test validated engine opt-out, missing/changed policy, wrong scope/set/target/window, stale holds, guard failures, set/class holds, explicit exclusions and a CLI refusing any opt-out input. Every engine call is at most one reserved batch, continuation binds policy identity/decision, and completed counts survive a later refusal. Assert returned `cutoff` matches the opaque saved continuation across reservations, invocation counts do not double-count prior batches, and an entry-time refusal returns a null cutoff. Both callers use R3-8; a fake attachment service proves one drain per committed batch and none before commit, retry with no candidates, storage failure counts and engine incomplete outcome. A committed handler batch with `incompleteReason` drains once, preserves counts and stops at its retry cursor. Add `runInstallation`, `resolveInstallationEvidenceAgeDays` and the `--installation` form. Unit tests `retentionInstallationRun.test.ts`: the strict input rejects scope, tenant, organization and `enginePolicy`; `--tenant` with `--installation` and neither are rejected; R3-2 rejects `installationScope` without aggregate evidence, `['records']` and `[]`; an unsupported set or handler refuses; installation age unset, override, below floor and malformed; a window below the age; no guard, a guard without the method, a throwing guard, a hold in another tenant and an explicit exclusion; `holds_changed` between batches; tenant and installation continuations swapped and a changed age on resume; a null tenant and organization summary, logger failure, zero file counts and no drain call; and the tenant `run` never calling `pruneInstallationRecords`.
3. `notifications`: handler and index; unit tests `notificationRetention.test.ts` for all statuses, cleanup-then-prune and each distinct cache scope, no dry-run invalidation, invalidation failure and retry of a saved affected scope after its last row was deleted. Any staff hold stops even notifications addressed to someone else.
4. **Characterize** that deleting a conversation hides its row and leaves messages; characterize reusable client ids and current append ordering in `conversation-delete.characterization.test.ts` before changing those paths.
5. `ai_assistant`: shared delete routine, reference service and all attachment-list writers using the locks. Unit tests `conversationRetention.test.ts`: both targets, no message, age recheck, both append commit orders, reused id with a different owner, ambiguous child interval, standalone and conversation-linked pending actions, legitimate shared id, injected id, concurrent new reference, tenant/organization isolation, storage failure and retry. Assert R3-7 is shared by subject erasure and `ai_assistant.pending_actions`; a surviving standalone action protects a file during conversation/draft pruning, and a surviving message protects it during standalone-action pruning. The action set's eligibility and R5-10 exclusions remain content-ai-owned tests in `privacy-pending-action-retention.test.ts`: creator, approver/resolver and typed single/batch target matches independently protect whole actions, including another creator's action targeting a held staff user. Cover guard-returned holds and explicit exclusions, standalone and conversation-linked actions, same id with a different target type, unrelated eligible actions, preserved attachment lists, preview/apply and a hold added between batches. Keep the payload-only-mention limit explicit.
6. `attachments`: draft set and age/scope recheck through the reference service, durable release. Unit tests `chatDraftRetention.test.ts`: old unlisted upload, recent or listed upload, missing reference service, scanner failure, subject hold and shared storage object.
7. Add `privacy.retention_evidence`, its R3-3 setting and audit-owner consumer. `retentionEvidence.test.ts`: finite default/floor, exact `{ resourceKind: 'privacy.retention_run', resourceId: retentionRunId }` exclusion rather than child erasure ids, terminal versus unresolved state, inactive-subject status/terminal/required-side-effect/file/continuation metadata, settled capped invocations, missing/invalid completion, pending file/cache work, failed completion read, any subject hold even under engine opt-out, guard failure, scope/age/keyset, full removal of actor/reference/context, and aggregate-only summary. Add `retentionEvidenceSummary.test.ts` for strict declaration/type validation, both export sets selecting the same branch, CLI/engine parity, distinctive reference/actor/export/request/subject/retention-run/erasure-run markers and preview contents absent from every persisted audit field, standard logging unchanged, preview with no summary, zero-change/skip/incomplete summaries, logger unavailable/write failure and counts preserved after commit. Age out a prior aggregate summary without copying its database id into the next one. It also covers inactive-subject entries without reading their subjects or preview documents. At installation scope `privacy.retention_evidence` uses the installation age and deletes only due, validated null-tenant aggregate summaries of installation-capable set ids, keeping recent ones, `system-history:` summaries, malformed rows (which refuse the batch) and every tenant row.
8. Self-contained TC-PRIVACY-RETENTION-001/002/003/004 and TC-PRIVACY-CHAT-DRAFT-001; docs and upgrade notes. Run generators after adding discovered files.
9. Archive this Delta into `.ai/specs/capabilities/privacy-record-retention.md` if adopted.

| File | Action |
|---|---|
| `packages/shared/src/modules/privacy.ts` | Modify |
| `packages/core/src/modules/privacy/{privacy.ts,cli.ts,lib/retentionService.ts,lib/retentionEvidence.ts,lib/retentionRunEvidence.ts,lib/installationEvidenceAge.ts,di.ts,__tests__/{retentionEvidence,retentionEvidenceSummary,retentionInstallationRun}.test.ts}` | Create / modify; share the service registration with inactive-subject extensions |
| `packages/core/src/modules/notifications/{privacy.ts,lib/*,migrations/*,__tests__/notificationRetention.test.ts}` | Create / modify |
| `packages/ai-assistant/src/modules/ai_assistant/{privacy.ts,lib/*,di.ts,data/repositories/AiChatConversationRepository.ts,__tests__/privacy-pending-action-retention.test.ts}` | Create / modify; include all attachment-list writers found during implementation and the content-ai-owned R5-10 exclusion tests |
| `packages/core/src/modules/attachments/{privacy.ts,lib/*,di.ts,__tests__/chatDraftRetention.test.ts}` | Create / modify for draft retention |
| `packages/core/src/modules/privacy/__integration__/TC-PRIVACY-RETENTION-00{1,2,3,4}.spec.ts` | Create |
| `packages/core/src/modules/attachments/__integration__/TC-PRIVACY-CHAT-DRAFT-001.spec.ts` | Create |
| `UPGRADE_NOTES.md`, docs | Modify |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-PRIVACY-RETENTION-001 | Own staff users, notifications and conversations created through APIs, backdated in fixture setup, and removed in `finally`. Preview writes nothing; apply removes an old read row from `GET /api/notifications`, keeps an unread row, and cleanup-then-prune removes an expired dismissed row. Warm the inbox cache first. Soft-delete through `DELETE /api/ai_assistant/ai/conversations/:conversationId`; after apply direct queries find only its unambiguous old children gone, while `GET /api/ai_assistant/ai/conversations` and its messages path retain a reused live id's rows. Explicit staff and person exclusions skip the set with exit 1, including a staff mention in another owner's content. |
| TC-PRIVACY-RETENTION-002 | Own two users and two conversations, upload files through `POST /api/attachments` under `ai-chat-draft`, persist ids through the chat write path and pending-action fixture. Two conversations list one upload; an injected id names the surviving user's listed upload. Pruning one preserves both surviving downloads and counts shared ids; an unshared file returns 404 and local bytes disappear. Deterministic barriers test both append/prune commit orders, resumption across deleted keyset rows and a new hold between batches. In the enterprise variant the engine calls the same service with a failing storage driver: the pass reports pending files/incomplete, durable coordinates survive, and retry drains them. Cleanup users, conversations, holds, policies, pending rows and local bytes in `finally`. |
| TC-PRIVACY-RETENTION-003 | Own old/recent terminal and unresolved `privacy.retention_run` entries, including inactive-subject entries with their owner's status, terminal, requiredSideEffects, filesPending and continuationPending metadata. Settled capped work may expire; missing/invalid completion, unfinished committed work and pending/failed file/cache/required effects stay unresolved. Verify exclusions use the exact retentionRunId resource pair across entries, never a child erasure runId. Set/list the evidence age through R3-3; preview writes nothing, apply removes only due terminal entries from the audit API, including actor/reference/context. An unrelated privacy evidence kind survives. Run the same driver with the dedicated export-evidence declarations once their owners ship: summaries contain only set id, counts and run dates; unique caller reference/actor/export/request/subject/retention-run/erasure-run markers and preview contents are absent from every stored audit field. A due prior aggregate summary expires without its id being copied into a fresh one. In the enterprise lane any subject hold skips even under an unmatched-hold policy, failed guard refuses, and release permits expiry without resetting age. Remove fixtures/settings/policies/holds in `finally`. |
| TC-PRIVACY-RETENTION-004 | Own null-tenant aggregate `privacy.retention_run` summaries for `privacy.retention_evidence` and `privacy.tenant_export_evidence` set ids, one null-tenant `system-history:` summary and the same kinds in an owned tenant, backdated in private fixtures. `mercato privacy retention --installation --set privacy.retention_evidence` previews without writing, then on apply deletes only the due null-tenant summaries of installation-capable set ids; recent ones, the `system-history:` summary and every tenant row remain, checked by direct queries. The new summary has null tenant and organization and only set id, counts and dates. `--installation` with `notifications.inbox`, with `--tenant`, with a malformed or below-30 `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS`, with a window below the age, or with a tenant continuation exits 1 and changes nothing; `--exclude-subject` skips with `hold_not_honourable`. Enterprise lane: an active hold in another tenant skips, and a guard without `installationExcludedSubjects` refuses. C8's TC-TENANT-EXPORT-002 runs the same entry for null-tenant `privacy.tenant_export` groups. Remove fixtures, holds and environment overrides in `finally`. |
| TC-PRIVACY-CHAT-DRAFT-001 | Own scoped uploads: old unsent, old listed in a message, old listed in a pending action, recent, and another organization's. After preview and apply of `attachments.unreferenced_chat_drafts`, only old unsent bytes disappear and their download returns 404; other downloads remain. Missing/failed reference service and an active enterprise staff hold delete nothing. Own all fixtures and clean rows, bytes and policies in `finally`. |

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
- **Mitigation**: Each set declares `excludableSubjectKinds`. The command and the service read the holds through `privacyRetentionGuard`, which the engine registers, and refuse a set with `hold_not_honourable` when a held subject's kind is not declared. A registered guard that cannot answer is a refusal. All first sets declare `[]`, so a staff hold stops the set too. The engine calls the same service, which rereads holds before every batch; tests cover a new hold between batches.
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
- **Mitigation**: Nothing runs by default; a thirty-day floor; unread ones are kept.
- **Residual risk**: Accepted by whoever chooses the window.

#### Orphaned files
- **Scenario**: A conversation is deleted and its files are not. A release keyed by the conversation would find nothing, because chat uploads are stored under `ai-chat-draft` with a browser-minted record id.
- **Severity**: Critical
- **Affected area**: attachment storage; whatever personal documents users uploaded to the assistant
- **Mitigation**: The handler releases by the ids its messages and pending actions hold, in the batch's transaction, and the stored objects go through the durable pending-deletion rows of the erasure spec's seam. The set refuses to run without those methods. Unit tests and TC-PRIVACY-RETENTION-002 check that the stored file is gone.
- **Residual risk**: Unsent uploads remain until the draft set is run or scheduled; uploads falsely listed in a surviving conversation stay listed. Storage failures remain durably pending and make the run incomplete.

#### Cached notification text survives a crashed invalidation
- **Scenario**: The process dies after deleting a batch but before publishing its cache retry scopes.
- **Severity**: Low
- **Affected area**: notification list cache
- **Mitigation**: Invalidate every affected scope after commit, fail on cache errors and keep retry scopes in any returned continuation; unit and warmed-cache API tests pin normal invalidation.
- **Residual risk**: A crash before the continuation is saved can leave cached text until the existing cache TTL; no durable cache outbox is added by this spec.

#### A surviving conversation loses its file
- **Scenario**: Client-supplied ids cause retention to release another conversation's upload, or a new reference races the scan.
- **Severity**: High
- **Affected area**: chat files and other users
- **Mitigation**: R3-7 scans all surviving message/action lists under the shared writer lock; attachment ownership and shared-object checks still apply; tests cover shared and injected ids.
- **Residual risk**: A future attachment-list writer that omits the lock can reopen the race; the writer inventory and regression test are release gates.

#### An installation run reaches tenant rows
- **Scenario**: A fault or a crafted continuation makes an installation run delete tenant evidence, or a tenant run reaches null-tenant rows.
- **Severity**: High
- **Affected area**: privacy evidence in every tenant
- **Mitigation**: A separate entry with a strict schema and no scope; only sets declaring `installationScope: true`; handlers select exactly `tenant_id IS NULL` through their owner; positions bind the installation marker and refuse a swap. `retentionInstallationRun.test.ts` and TC-PRIVACY-RETENTION-004 assert tenant rows survive.
- **Residual risk**: An owner method that ignores the exact null-tenant predicate. Owner tests, including C8's, are release gates.

#### Null-tenant evidence outlives its installation age
- **Scenario**: No runner is scheduled, a hold exists in some tenant, or a registered Enterprise guard lacks `installationExcludedSubjects`, so null-tenant evidence stays past `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS`.
- **Severity**: Medium
- **Affected area**: storage limitation for installation evidence
- **Mitigation**: The command and docs name the `--installation` run; each skip or refusal only delays deletion and is reported, and preview shows what is due.
- **Residual risk**: Until an operator schedules installation runs, and while any tenant holds a subject, the finite age is designed but not enforced.

## Final Compliance Report — 2026-11-16

Pass-two review: cross-spec references and shared decisions checked against the merged workspace; runner: local, Python document checks only. Pass-three references and the shared aggregate evidence contract were checked directly; no independent review was available. No implementation tests were run. Independent review could not launch because the collaboration service returned `no rollout found`; this revision was reviewed directly.

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` for the convention file. Relevant AI assistant, notifications, attachments, shared and core guide sections checked against the read-only repository; implementation tests were not run.

| Rule | Status | Notes |
|---|---|---|
| No cross-module table access | Compliant | Module-owned handlers, owner services and assistant reference callbacks |
| Additive contract change | Compliant | One optional member |
| Edition | Compliant | Declaration, handlers, service and command in OSS; schedules and policies in Enterprise (assumption 2, DEC-2) |
| Tenant scoping | Compliant | Every tenant call takes a scope; installation runs are a separate entry that reads only rows with no tenant |
| Installation-scope evidence (R4-3) | Specified | `runInstallation` and `--installation`, for sets declaring `installationScope: true`; exact `tenant_id IS NULL` rows, installation age, fail-closed holds, preview default, null-tenant aggregate summary; `PrivacyScope` unchanged |
| Legal holds honoured by manual runs | Compliant | `privacyRetentionGuard`, resolved softly, fails closed; `hold_not_honourable` for a kind a set cannot leave out |
| R5-10 pending-action staff exclusions | Specified for explicit links | Creator, approver/resolver and typed single/batch targets protect whole actions, including another creator's action; unit/integration coverage required. Payload-only staff mentions are an accepted known limit; any later matcher is content-ai coverage's own design |
| Validate inputs with zod | Compliant | The command's argument schema, including `--exclude-subject` |
| Integration coverage | Specified | Five self-contained tests over status, cache, concurrency, files, draft uploads, evidence expiry, installation-scope runs and hold skips |

**Verdict:** revised design; implementation waits on the contract registry and the erasure spec's **Phase 2 — Seams** for `releaseForRecord`, `releaseByIds` and durable draining. The installation-scope run for R4-3's null-tenant evidence is decided here; C8 supplies its audit-owner method and tests. No implementation is claimed.

## Changelog

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
