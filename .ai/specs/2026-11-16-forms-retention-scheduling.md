# Forms retention scheduling

> **Program:** split out of package D1 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Depends on:** the counting period and reporting from [`2026-11-16-operational-retention-pruners.md`](2026-11-16-operational-retention-pruners.md).
> **Verified at** `main` @ `08dada9624` by reading code, twice (author and independent reviewer); nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-09-30-forms-module-into-core.md
Extends: .ai/specs/2026-11-16-operational-retention-pruners.md

## 📝 TLDR

A form owner can set a retention period on a form. The setting is stored and shown, and nothing ever applies it: the worker that anonymizes submissions past their period exists and is never run. **Proposed (future):** that worker runs on a daily schedule across all organizations. On an existing installation it counts for thirty days first, and tells the people who manage forms what it is about to do, before it changes anything.

**What "anonymize" means here, unchanged by this spec:** answers to fields flagged as sensitive are replaced, uploaded content is cleared, invitation contact details are removed. Answers to fields nobody flagged stay as they are, including a name typed into an unflagged text field.

**Not in this spec:** deleting submissions; consent records and the access audit, which are evidence; erasure on a data subject's request.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Scope of the schedule | One system-scoped schedule; the worker finds the organizations that have a form with a retention period | A schedule per organization would need seeding for every existing one. The list comes from the forms tables themselves. |
| 2 | When it starts changing data on an existing installation | After the shared thirty-day counting period, unless the mode is set explicitly | ⚠ NEEDS HUMAN CONFIRMATION. It changes what users see, irreversibly. |
| 3 | Who is told | Users who can manage forms receive one in-app notification per form when the first counting run finds submissions past the period | The counting run's log reaches only the operator; the form's owner is usually a tenant user. |
| 4 | Retention versus erasure for other modules | The event the worker emits carries the reason `retention`; only a `request` reason may trigger erasure elsewhere | A planned subscriber would anonymize the linked CRM person on that event. A retention period on a form must not erase CRM records in bulk. |
| 5 | Soft-deleted forms | Their submissions are still subject to the period | Deleting a form should not make its submissions permanent. |
| 6 | Edition | OSS, as the forms module is | ⚠ NEEDS HUMAN CONFIRMATION, as for the parent spec. |

## 📝 Problem Statement

- **The worker is never run.** Its header says to wire it through the scheduler or run it by hand, and names a command that does not exist — the module has no `cli.ts` (`packages/core/src/modules/forms/workers/retention-purge.ts:10-16`). `forms/setup.ts` registers nothing but role features.
- **It cannot take a system-scoped tick.** It throws without an organization and tenant in its payload (`:39-46, 63-65`).
- **Every run scans everything.** Eligibility is decided in application code after loading each non-anonymized submission (`:125-138`). The age is `submittedAt ?? updatedAt`, reached through the submission's version to its form (`packages/core/src/modules/forms/lib/retention.ts:58`).
- **It skips soft-deleted forms**, so their submissions are kept forever (`:77`).
- **One bad row stops everything after it.** The anonymize service throws when a submission's version is missing or a value cannot be decrypted (`packages/core/src/modules/forms/services/anonymize-service.ts:104-118`). The worker's order is fixed, so the same row would block every later organization on every run.
- **Anonymization is narrower than the word suggests.** Only answers to fields flagged `x-om-sensitive` are replaced, and the flag is opt-in (`anonymize-service.ts:163-166`). Uploaded content is held inline and is already cleared (`:128-136`; `attachment-service.ts:149-156`); no separate stored file exists.
- **Each anonymization emits a persistent event**, `forms.submission.anonymized`, which reaches the webhook bridge (`workers/retention-purge.ts:145`). `.ai/specs/2026-06-17-form-to-deals.md` plans a subscriber that anonymizes the linked CRM person and deletes deal files on it.
- **A period of null, zero or less means keep forever** (`retention.ts:9-11, 60`).

## 📝 Proposed Solution

1. The worker accepts a tick whose tenant and organization are both absent, and nothing in between. It lists the tenant and organization pairs that own a form with a positive period, including soft-deleted forms, and processes each with its own entity-manager fork.
2. Per form, it selects candidates in the database with two indexed queries: submitted submissions by `submitted_at`, and never-submitted ones by `updated_at`.
3. A submission that fails is caught, counted and reported, and the worker moves on.
4. It uses the shared history mode. While counting, it records per-form counts and, on the first run that finds any, notifies the users who can manage forms.
5. The event it emits gains a `reason`.
6. A system-scoped, cron-valued schedule is registered from the module's `setup.ts` and from an upgrade action.

| Alternative | Why rejected |
|---|---|
| Keep scanning in application code | Cost grows with every submission ever made, daily. |
| One schedule per organization | See assumption 1. |
| Delete instead of anonymize | Changes the module's contract with form owners. |
| Anonymize unflagged fields too | The service's rule is the form designer's choice; widening it here would destroy answers nobody marked as personal. It is stated instead. |

## 📝 Delta

### Capability: forms-retention

#### MODIFIED Requirement: Form retention period
The system SHALL anonymize a submission once it is older than its form's retention period, on a schedule, in every organization, whether or not the form has since been deleted.

##### Scenario: Past retention
- WHEN a submission is older than its form's period, the counting period has passed, and the scheduled job runs
- THEN the submission is anonymized as the existing service defines

##### Scenario: Counting period
- WHEN the same job runs during the installation's counting period
- THEN nothing changes, the per-form count is recorded, and users who manage forms are notified once for that form

##### Scenario: No period
- WHEN a form has no retention period
- THEN its submissions are never touched

##### Scenario: A submission that cannot be anonymized
- WHEN one submission fails
- THEN it is counted and reported, and later submissions and organizations are still processed

Frozen by: `packages/core/src/modules/forms/__tests__/retention-purge-worker.test.ts`

#### MODIFIED Requirement: Anonymization event
The system SHALL state, in the event it emits when a submission is anonymized, whether the cause was retention or a request.

##### Scenario: Retention
- WHEN the scheduled job anonymizes a submission
- THEN the event's reason is `retention`

Frozen by: `packages/core/src/modules/forms/__tests__/retention-purge-worker.test.ts`

## 📝 Architecture

- **Worker** `forms/workers/retention-purge.ts`: absent scope; organization walk from the forms tables; per-organization fork; two queries per form in keyset batches with a cap per run; per-submission failure isolation.
- **Shared helper**: this worker uses the helper's mode resolution, first-run recording and reporting, not its delete loop. The pruner spec's helper exposes those three as separate functions for this purpose.
- **Notification**: a notification type declared in the forms module, sent through the notifications module by its documented subscriber pattern, addressed to users holding the forms management feature in that organization.
- **Event**: `forms.submission.anonymized` gains an optional `reason`. The existing manual anonymize route sends `request`.
- **Registration**: `forms/setup.ts` gains `seedDefaults` with a system-scoped daily cron schedule, `isEnabled` omitted; an upgrade action `forms.register-retention-schedule` with its version and locale keys.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Forms → scheduler | `schedulerService` by DI key, guarded by `hasRegistration` | No schedule; nothing is applied |
| Forms → notifications | The module's notification type and an event subscriber | No notifications module: the count is still recorded and reported |
| Other modules → the event | Subscribe and read `reason` | — |

## 📝 Data Models

Two additive partial indexes on `forms_form_submission`, created concurrently in a hand-written, non-transactional migration with the module snapshot:

| Index | For |
|---|---|
| `(form_version_id, submitted_at)` where `anonymized_at` is null and `deleted_at` is null | Submitted submissions |
| `(form_version_id, updated_at)` where `anonymized_at` is null, `deleted_at` is null and `submitted_at` is null | Never-submitted ones |

## 📝 API Contracts

- **Event payload** `forms.submission.anonymized` gains `reason?: 'retention' | 'request'`. Additive.
- **Notification type** `forms.retention.pending`, with its locale keys.
- It honours `OM_RETENTION_HISTORY_MODE` from the pruner spec. One schedule id and one upgrade-action id are added.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A tick with a tenant and no organization | Rejected, as today |
| A form's period is shortened | The next run applies the new period |
| A soft-deleted form | Its period still applies |
| A submission whose version is missing | Counted as failed; reported; skipped on later runs until fixed |
| Thousands of submissions become eligible at once | The cap per run bounds both the work and the events emitted |
| The run is interrupted | Anonymization is idempotent; the next run continues |
| Scheduler absent | Nothing is applied; the counting period never starts |
| A downstream subscriber ignores `reason` | It would act on retention as on a request. The planned form-to-deals subscriber is not yet built; this spec records the constraint on it |

## 📝 Migration & Backward Compatibility

- Behaviour change for installations with a retention period set: submissions start to be anonymized. Ordinary protocol, bridged by the per-installation counting period and the notification.
- `UPGRADE_NOTES.md`: that the period configured on forms now takes effect; exactly what anonymization changes and what it leaves; how to see the counts; how to stop it (`OM_RETENTION_HISTORY_MODE=report`, or clear the period on the form); the upgrade action to run.
- The event field is additive. The worker's queue name and the anonymize service's signature are unchanged.

## 📋 Implementation Plan

### Phase 1 — Selection
1. **Characterize** in the existing worker test that a past-retention submission persists when nothing schedules the worker, that the worker throws without a scope, and that the event carries no reason. Commit alone.
2. Add the index migration.
3. Replace the in-code scan with the two queries, keeping `lib/retention.ts` as the single definition of the cutoff; include soft-deleted forms. Unit tests: submitted, never submitted, no period, shortened period, deleted form.

### Phase 2 — Scheduling and safety
1. Accept an absent scope; walk organizations; fork per organization; isolate per-submission failures. Unit tests with two organizations and one failing row.
2. Adopt the shared mode, first-run recording and reporting. Unit tests for counting, for anonymization after the period, and for an explicit mode.
3. Add `reason` to the event, from the worker and from the manual route.
4. Add the notification type and send it once per form. Unit test that a second counting run does not repeat it.
5. Register the schedule in `setup.ts`; add the upgrade action with its version and locale keys.
6. Integration tests; `UPGRADE_NOTES.md`; the forms docs page.
7. Archive this Delta into `.ai/specs/capabilities/forms-retention.md` if that directory has been adopted by then.

### File manifest

| File | Action |
|---|---|
| `packages/core/src/modules/forms/workers/retention-purge.ts`, `lib/retention.ts`, `setup.ts`, `events.ts`, `notifications.ts`, `i18n/*.json` | Modify / create |
| `packages/core/src/modules/forms/api/…/anonymize` route | Modify — reason |
| `packages/core/src/modules/forms/migrations/*` and the snapshot | Create |
| `packages/core/src/modules/configs/lib/upgrade-actions.ts` and its locale keys | Modify |
| `packages/shared/src/lib/retention/prune.ts` | Modify — separate mode and reporting functions |
| `packages/core/src/modules/forms/__integration__/TC-FORMS-RETENTION-00{1,2}.spec.ts` | Create |
| `UPGRADE_NOTES.md`, forms docs page | Modify |

## 🧪 Integration Coverage

The scheduled tick reads its mode from the running app's environment, so the tests call the worker's handler in process, with the mode injected, after creating fixtures through the API and backdating them with a direct query. This follows the in-process pattern of `packages/core/src/modules/entities/__integration__/TC-ENTITIES-009-encryption-map-concurrency.spec.ts`.

| Test | Covers |
|---|---|
| TC-FORMS-RETENTION-001 | A submission past its form's period: counting mode leaves it, and a user who manages forms sees one notification through the notifications API; delete mode anonymizes it and `GET` on the submission shows the anonymized state with the flagged answer replaced and an unflagged answer intact |
| TC-FORMS-RETENTION-002 | A form with no period, and a submission inside its period, are untouched; two organizations are processed in one call; a soft-deleted form's old submission is anonymized |

## 📝 Risks & Impact Review

#### Submissions are anonymized that an owner still wanted
- **Scenario**: A period set years ago, never applied, takes effect.
- **Severity**: High
- **Affected area**: form submissions
- **Mitigation**: Thirty days of counting; a notification to the people who manage forms; the upgrade note; clearing the period or setting the mode stops it.
- **Residual risk**: Irreversible once applied. It is what the owner configured.

#### A retention period is taken for full anonymization
- **Scenario**: An owner believes old submissions hold no personal data, and unflagged fields still do.
- **Severity**: High
- **Affected area**: forms with personal data in unflagged fields
- **Mitigation**: Stated in the TLDR, the upgrade note, the notification text and the docs page.
- **Residual risk**: Remains until form designers flag their fields.

#### Retention cascades into another module
- **Scenario**: A subscriber treats the event as an erasure request and removes CRM records.
- **Severity**: High
- **Affected area**: any subscriber to the event
- **Mitigation**: The `reason` field; the constraint recorded against the form-to-deals spec; no such subscriber exists today.
- **Residual risk**: A third-party subscriber written before the field existed.

#### The first run is heavy
- **Scenario**: A large backlog on the first run after the counting period.
- **Severity**: Medium
- **Affected area**: forms tables, the event stream, webhooks
- **Mitigation**: Keyset batches, a cap per run, the new indexes.
- **Residual risk**: Several days to work through a large backlog.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/queue/AGENTS.md` (MUST rules). Not reviewed: the forms module guide and the notifications section of `packages/core/AGENTS.md`; the implementer reads both.

| Rule | Status | Notes |
|---|---|---|
| Background work through the worker contract | Compliant | Existing worker, existing scheduler |
| Tenant and organization scoping | Compliant | Each organization is processed with its own scope and fork |
| Cross-module effects through events and notifications | Compliant | No direct import |
| Event payloads frozen | Compliant | One optional field added |
| Migration workflow | Deviation, stated | Concurrent index migration written by hand, following an existing precedent |
| Integration coverage | Compliant | Two tests |

**Verdict:** approved for implementation, with assumptions 2 and 6 open.

## Changelog

### 2026-11-16
- Written autonomously, split out of the operational pruner spec after its review.
- Revised after independent review: the file-removal phase was removed because uploads are held inline and already cleared; per-submission failure isolation added; the event gains a reason so retention cannot cascade into erasure elsewhere; an in-app notification added; soft-deleted forms included; a second index added; what anonymization leaves behind stated plainly.
