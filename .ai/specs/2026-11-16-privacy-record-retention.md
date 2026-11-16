# Record retention: notifications and assistant conversations

> **Program:** first part of package D3 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** the `privacy.ts` convention and the `privacy` module from [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md). **Consumed by** [`enterprise/2026-11-16-privacy-dsr-engine.md`](enterprise/2026-11-16-privacy-dsr-engine.md).
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-11-16-privacy-data-class-contract.md

## 📝 TLDR

A notification stays in a user's inbox forever, whether read, acted on or dismissed. An assistant conversation that a user deleted stays in the database forever; its delete route says a future worker will purge it. Both hold personal data, and nothing says how long either lives. The operational pruners cover tables nobody reads; these are tables people do read, so the rule for what may go has to come from the module that owns them. **Proposed (future):** a module may declare a *retention set* — a group of its own records that can be deleted by age — and implement one method that deletes a batch. An operator command runs it, in preview by default. Notifications and assistant conversations are the first two. Nothing is deleted unless an operator, or the enterprise policy engine, asks.

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
| 2 | Edition | The declaration, the two handlers and the command in OSS; scheduling and policy in Enterprise | ⚠ NEEDS HUMAN CONFIRMATION. The program's fallback places all of D3 in Enterprise if maintainers keep privacy features there. The handlers must sit in the modules that own the tables either way; only the command would move. |
| 3 | Is a retention set a data class | No. A separate declaration in the same file | A data class must name subject kinds and take part in export and erasure; the erase run refuses a kind unless every class declaring it can erase. A set of rows to prune by age is neither. |
| 4 | Which notifications may go | Read, acted on or dismissed, and older than the window. Unread ones stay | An unread notification is one the user has not seen. A read one can still be acted on, which is why the floor is thirty days. |
| 5 | Soft-deleted rows | A second target a set may declare | Only the owning module knows when its soft-deleted rows are safe to remove. |
| 6 | Whose records can be left out | Each set names the subject kinds it can attribute a record to, and by which column | A hold on a person can then spare the records that are plainly theirs. A person merely mentioned in a notification's text cannot be spared, and the declaration says so. |

## 📝 Problem Statement

| Table | Age column | Cleanup today | What reads old rows |
|---|---|---|---|
| `notifications` | `created_at`; `expires_at` is indexed; `created_at` only inside an index led by recipient and status | A command that marks expired ones dismissed. It never deletes and has no schedule (`notifications/lib/notificationService.ts:959-993`; `cli.ts:5-12`) | The notification inbox |
| `ai_chat_conversations`, `ai_chat_messages` | `last_message_at`, `created_at`, `deleted_at`; an index on tenant, organization and `deleted_at` | Soft delete only (`ai_assistant/data/repositories/AiChatConversationRepository.ts:343-364`). The delete route's text promises a future retention worker (`api/ai/conversations/[conversationId]/route.ts:84-89`) | Chat history |

- **Notification statuses** are `unread`, `read`, `actioned` and `dismissed` (`notifications/data/entities.ts:5`). There is no "expired" status; expiry is a time. `notifications` has no `deleted_at` and no encryption map.
- **A conversation owns more than messages.** Pending actions point at it (`ai_pending_actions.conversation_id`, same module), and messages list attachment ids.
- **The contract has no place for this.** A data-class definition requires at least one subject kind and one of the actions discover or export (contract spec, `privacyDataClassDefinitionSchema`), and the erase run's pre-flight refuses a kind when a class declaring it cannot erase.
- **Nothing here needs a tenant setting**, because the window comes from the caller.

## 📝 Proposed Solution

### The declaration

The default export of `privacy.ts` gains an optional member, `retentionSets`. Each set has:

| Field | Meaning |
|---|---|
| `id` | `<module>.<name>` |
| `title`, `ageBasis` | Locale keys: what the set is, and one sentence saying what "age" means for it |
| `minimumDays` | The shortest window the set accepts |
| `targets` | `records`, `softDeleted`, or both |
| `excludableSubjects` | The subject kinds whose records the handler can leave out, each with a note on how a record is attributed |
| `handlerService` | The DI key of the handler |

### The handler

One method, `pruneRecords`. It is given a scope, a window, a target, a batch limit, a position to continue from, the subjects to leave out, and whether this is a dry run. It deletes at most one batch and returns how many matched, how many it deleted, the position to continue from, and whether more remain. In a dry run it deletes nothing and still advances the position, so a preview can count everything.

Rules every implementation follows:

- It touches only its own module's tables, or calls the owning module's service where the records belong to another module.
- It refuses a window below its minimum.
- Each batch is its own transaction.
- It never returns or logs an identifier.
- It leaves out the records of the listed subjects, for the kinds it declared.

### The command

`mercato privacy retention --tenant <id> --set <id> --older-than-days <n> --reference <text> [--target records|softDeleted] [--max <n>] [--apply]`

Preview by default: it walks the set and prints the count. With `--apply` it deletes up to `--max`. It writes one audit entry per run with the set, the window, the target, the counts and the reference.

### First sets

| Set | Age | Floor | What goes | Can leave out |
|---|---|---|---|---|
| `notifications.inbox` | `created_at` | 30 days | Notifications that are read, acted on or dismissed | A staff user's own notifications, by recipient |
| `ai_assistant.conversations` — `records` | `last_message_at`, or `created_at` when there was no message | 30 days | The conversation with its messages, participants and pending actions; its attachments are released through the attachments service | A staff user's conversations, by owner or participant |
| `ai_assistant.conversations` — `softDeleted` | `deleted_at` | 30 days | The same, for conversations a user already deleted | The same |

### Design decisions

| Decision | Rationale |
|---|---|
| A separate registry | See assumption 3. |
| The caller supplies the window | One implementation serves the manual command and the enterprise engine. |
| A floor per set | Each has readers that assume some history. |
| A position in and out | Without one, a dry run with a limit returns the same batch for ever and a preview cannot count past it. |
| Attachments are released through their owner | The assistant module must not delete from the attachments table. |
| `ageBasis` is text | A person must be able to read what a window means before choosing one. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Model these as data classes | See assumption 3. |
| Instance-wide windows from environment variables, on a schedule | The path #2980 took for change history, which maintainers placed in Enterprise. |
| One generic purge of every soft-deleted row | No shared rule for when a soft-deleted row is safe to remove. |
| Letting the engine delete by SQL | It would have to know every module's tables. |
| Include change history and inactive contacts | Each is a decision of its own; see "Not in this spec". |

### Known limits

- A person named inside a notification's text or a conversation's transcript, who is neither the recipient nor a participant, cannot be left out. While such a person is under a hold, a caller that must be certain skips the set for that tenant.
- Unread notifications are never pruned.

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

#### ADDED Requirement: Notification retention
The system SHALL delete notifications past the window that are read, acted on or dismissed, and SHALL keep unread ones.

##### Scenario: Old and read
- WHEN a read notification is older than the window
- THEN it is deleted

##### Scenario: Old and unread
- WHEN an unread notification is older than the window
- THEN it is kept

#### MODIFIED Requirement: Deleted assistant conversations
The system SHALL keep a conversation a user deleted until retention is run for it, and SHALL then remove it with everything that belongs to it.

##### Scenario: Soft-deleted target
- WHEN the soft-deleted target is pruned
- THEN conversations deleted longer ago than the window are gone with their messages, participants and pending actions, their attachments are released, and live conversations are untouched

##### Scenario: A subject to leave out
- WHEN a staff user is listed to be left out
- THEN none of the conversations they own or take part in is deleted

Frozen by: `packages/ai-assistant/src/modules/ai_assistant/__tests__/conversation-delete.characterization.test.ts`

## 📝 Architecture

- **Types** in `packages/shared/src/modules/privacy.ts`: the set declaration and the handler.
- **`privacy` module**: the registry of sets, the `retention` command, and `privacyRetentionService.run` for in-process callers with the same inputs.
- **`notifications`**, **`ai_assistant`**: the declaration and the handler.
- **`attachments`**: the `releaseForRecord` method the erasure spec adds; this spec uses it and does not define it.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Command → handlers | The set registry and DI keys | An unknown set is reported |
| Assistant handler → attachments | The attachments service | The service lacks the method: the set's `records` and `softDeleted` targets are refused, with the reason, until the erasure spec's first phase lands |
| Enterprise engine → sets | The same service method | — |

## 📝 Data Models

One additive index, created concurrently, with its migration and snapshot: `notifications (tenant_id, created_at)`. Conversations are found through the existing index on tenant, organization and `deleted_at`, and through the tenant's own conversations for the live target. No new table or column.

## 📝 API Contracts

```ts
type PrivacyRetentionSetDefinition = {
  id: string
  title: string                 // locale key
  ageBasis: string              // locale key
  minimumDays: number
  targets: Array<'records' | 'softDeleted'>
  excludableSubjects: Array<{ kind: string; attributedBy: string }>
  handlerService: string
}

type PrivacyRetentionHandler = {
  pruneRecords: (input: {
    scope: PrivacyScope
    olderThanDays: number
    target: 'records' | 'softDeleted'
    limit: number
    after?: string
    excludeSubjects?: PrivacySubjectReference[]
    dryRun: boolean
  }) => Promise<{ matched: number; deleted: number; next?: string; done: boolean }>
}
```

- **`retentionSets`** — an optional member of the default export of `privacy.ts`, which the generated registry already reads. Additive to a convention not yet released.
- **CLI** as above. Exit 0 when the run finished, 2 when it stopped on a failure, 1 on a refused window or an unknown set.
- **Audit entry** `privacy.retention_run`, with counts and no identifier.
- No route.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A window below the floor | Refused, with the floor in the message |
| A batch fails | The run stops, reports the count so far and exits 2; a re-run starts again and finds what is left |
| A conversation with a message newer than the window | Not matched: its age is its last message |
| A conversation with no message | Its age is its creation |
| A pending action still awaiting an answer in an old conversation | Deleted with the conversation; the floor is thirty days and pending actions expire long before |
| A notification that expired and is unread | Kept |
| Rows with no tenant | Not touched by a tenant-scoped run |
| `--max` reached | The run stops and says more remain |

## 📝 Migration & Backward Compatibility

All additive: one optional member of the convention file's default export, the types, a command, a service, an audit entry, one index. Nothing is deleted on upgrade. `UPGRADE_NOTES.md` names the command and says what each set removes.

## 📋 Implementation Plan

1. Add the types and the set registry, with validation. Unit tests.
2. Add the service and the command: preview across batches, floor, unknown set, `--max`, the audit entry. Unit tests with a fake handler.
3. `notifications`: the declaration, the handler, the index. Unit tests for each status and for a left-out recipient.
4. **Characterize** that a deleted conversation and its messages remain. Commit alone.
5. `ai_assistant`: the declaration with both targets and the handler, including pending actions and the release of attachments. Unit tests: live inside and outside the window; no message; soft-deleted inside and outside; a left-out owner and a left-out participant. Update the characterization test.
6. Integration test TC-PRIVACY-RETENTION-001; `UPGRADE_NOTES.md`; the docs page.
7. Archive this Delta into `.ai/specs/capabilities/privacy-record-retention.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/modules/privacy.ts` | Modify |
| `packages/core/src/modules/privacy/{cli.ts,lib/retentionService.ts,di.ts}` | Create / modify |
| `packages/core/src/modules/notifications/{privacy.ts,lib/*,migrations/*}` | Create / modify |
| `packages/ai-assistant/src/modules/ai_assistant/{privacy.ts,lib/*}` | Create / modify |
| `packages/core/src/modules/privacy/__integration__/TC-PRIVACY-RETENTION-001.spec.ts` | Create |
| `UPGRADE_NOTES.md`, docs | Modify |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-PRIVACY-RETENTION-001 | Notifications and a conversation are created through the API and backdated with a direct query; one conversation is deleted through its route. The command runs against the test app's database, as existing tests run commands. Preview changes nothing. After apply, `GET /api/notifications` no longer returns the old read notification and still returns the old unread one; a direct query shows the soft-deleted conversation and its messages gone; the live conversation is still returned by the conversations API. The test removes what remains |

## 📝 Risks & Impact Review

#### The edition question moves the command
- **Scenario**: Maintainers place all retention in Enterprise.
- **Severity**: Medium
- **Affected area**: the command and the service
- **Mitigation**: The handlers and the declaration stay where they are; the command and service move as they are.
- **Residual risk**: If handlers in OSS modules are also refused, retention for OSS tables has no home, as the program already notes for erasure.

#### A held person's records are deleted
- **Scenario**: A person under a hold is mentioned in a notification addressed to someone else.
- **Severity**: Medium
- **Affected area**: legal holds
- **Mitigation**: Each set states what it can and cannot attribute; the enterprise engine skips a set for a tenant with a subject hold it cannot honour.
- **Residual risk**: A manual run by an operator who did not check for holds. The command prints the limit before `--apply`.

#### A user loses something they wanted
- **Scenario**: A read notification with a link the user meant to return to is deleted.
- **Severity**: Low
- **Affected area**: the notification inbox
- **Mitigation**: Nothing runs by default; a thirty-day floor; unread ones are kept.
- **Residual risk**: Accepted by whoever chooses the window.

#### Orphaned files
- **Scenario**: A conversation is deleted and its attachments are not.
- **Severity**: Medium
- **Affected area**: attachment storage
- **Mitigation**: Release goes through the attachments service, and the set refuses to run without it.
- **Residual risk**: None while that dependency holds.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` for the convention file. Not reviewed: the `ai-assistant` and `notifications` guides in full.

| Rule | Status | Notes |
|---|---|---|
| No cross-module table access | Compliant | Each handler prunes its own tables; attachments through their service |
| Additive contract change | Compliant | One optional member |
| Edition | Open | See assumption 2 |
| Tenant scoping | Compliant | Every call takes a scope |
| Integration coverage | Compliant | One test over both sets |

**Verdict:** approved as a design. Implementation waits on assumption 2 and on the contract spec's first phase.

## Changelog

### 2026-11-16
- Written autonomously as "retention for personal-data classes", covering five classes in two modes.
- Rewritten after independent review, and renamed. Rows pruned by age are no longer data classes: the contract requires a class to name subjects and take part in erasure, and the erase run would then have refused every staff user. They are retention sets in their own registry. Change history is removed: its "latest undoable entry" rule would have kept exactly the snapshots retention is meant to remove, it would have deleted the record of erasures, the premise about deal stage history was wrong (a transitions table exists), and maintainers place it in Enterprise. Inactive contacts and portal users are removed to a spec of their own. The handler takes and returns a position, so a preview can count. Notification statuses are corrected. Conversations take their pending actions and attachments with them. Indexes reduced to the one that has a reader.
- Amended: a set's handler may call the owning module's service, so that the enterprise change-history sets can exist without writing to a core table.
