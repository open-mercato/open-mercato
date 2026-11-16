# Forms retention scheduling

> **Program:** split out of package D1 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Depends on:** the named parsing and reporting exports in Phase 1 from [`2026-11-16-operational-retention-pruners.md`](2026-11-16-operational-retention-pruners.md).
> **Propagation dependency:** the R3-6 first-party subscriber and emitter changes in [`2026-06-17-form-to-deals.md`](../2026-06-17-form-to-deals.md), “R3-6 — The form-to-deals reason set”, and [`2026-11-16-privacy-coverage-content-ai.md`](2026-11-16-privacy-coverage-content-ai.md), Phase 1, ship before this schedule can anonymize.
> **Code baseline checked for this revision:** read-only snapshot `9e09023483`; specifications only, no runtime tests run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-09-30-forms-module-into-core.md
Extends: .ai/specs/GDPR/2026-11-16-operational-retention-pruners.md

## 📝 TLDR

A form owner can set a retention period on a form. The setting is stored and shown, and nothing ever applies it: the worker that anonymizes submissions past their period exists and is never run. **Proposed (future):** that worker runs on a daily schedule across all organizations. In the first minor that ships it, it counts and tells the people who manage forms what it would do; explicit delete opts in only after that form's notice period. From the next minor it anonymizes by default. Every form first gets a durable count and a notice, followed by thirty days without anonymization, even when the operator explicitly opts in.

**What "anonymize" means here, unchanged by this spec:** answers to fields flagged as sensitive are replaced, uploaded content is cleared, invitation contact details are removed. Answers to fields nobody flagged stay as they are, including a name typed into an unflagged text field.

**Not in this spec:** deleting submissions; consent records and the access audit, which are evidence; erasure on a data subject's request.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Scope of the schedule | One system-scoped schedule; the worker finds the organizations that have a form with a retention period | A schedule per organization would need seeding for every existing one. The list comes from the forms tables themselves. |
| 2 | When it starts changing data | `OM_FORMS_RETENTION_MODE=report\|delete`, independent of history deletion. Unset is report for one minor, then delete. Every form must finish its own thirty-day count-and-notice period even under explicit delete | DEC-H — The counting-period bridge applies separately. No operational-log setting starts anonymizing forms. |
| 3 | Who is told | `forms.submissions.manage`, matched with wildcard-aware policy and organization scope; at least one durable in-app notice must be delivered before the form's notice period starts. Without notifications or an authorized recipient, the form is counted, its notice stays pending and is retried each run, and nothing is anonymized | Anonymization is irreversible, and a notice nobody can see is no notice. The people who manage a form's submissions can change its period or act first. The run report counts forms whose notice is pending, so a blocked form is visible to the operator. |
| 4 | Retention versus erasure for other modules | Cite R3-6 — The form-to-deals reason set, now normative in `2026-06-17-form-to-deals.md` and `2026-11-16-privacy-coverage-content-ai.md`: `request` and `erasure` are subject-driven; `retention` and missing reasons cause no downstream writes | The optional event enum is exactly `request \| erasure \| retention`; this worker emits `retention` and consumes the owner's subscriber rule. |
| 5 | Soft-deleted forms | Their submissions remain subject to the configured period | Deleting a form must not make its submissions permanent. |
| 6 | Edition | OSS, in the forms module, as DEC-2 places it | Forms is an OSS module and owns the data, so it owns the worker and its schedule. The pruner helper exports it consumes are OSS too (`operational-retention-pruners`, assumption 8). Implementation waits only for those exports to be delivered. |

## 📝 Problem Statement

- **The worker is never run.** Its header says to wire it through the scheduler or run it by hand, and names a command that does not exist — the module has no `cli.ts` (`packages/core/src/modules/forms/workers/retention-purge.ts:10-16`). `forms/setup.ts` registers nothing but role features.
- **It cannot take a system-scoped tick.** It throws without an organization and tenant in its payload (`:39-46, 63-65`).
- **Every run scans everything.** Eligibility is decided in application code after loading each non-anonymized submission (`:125-138`). The age is `submittedAt ?? updatedAt`, reached through the submission's version to its form (`packages/core/src/modules/forms/lib/retention.ts:58`).
- **It skips soft-deleted forms**, so their submissions are kept forever (`:77`).
- **One bad row stops everything after it.** The anonymize service throws when a submission's version is missing or a value cannot be decrypted (`packages/core/src/modules/forms/services/anonymize-service.ts:104-118`). The worker's order is fixed, so the same row would block later submissions in that scoped invocation.
- **Anonymization is narrower than the word suggests.** Only answers to fields flagged `x-om-sensitive` are replaced, and the flag is opt-in (`anonymize-service.ts:163-166`). Uploaded content is held inline and is already cleared (`:128-136`; `attachment-service.ts:149-156`); no separate stored file exists.
- **Each anonymization emits a persistent event**, `forms.submission.anonymized`, which reaches the webhook bridge (`workers/retention-purge.ts:145`; `api/submissions/[submissionId]/anonymize/route.ts:95`). `.ai/specs/2026-06-17-form-to-deals.md` plans a subscriber that anonymizes the linked CRM person and deletes deal files on it.
- **The bridge and the schema carry only the id.** The webhook bridge rebuilds the payload as `{ submissionId, emittedAt }` (`subscribers/forms-webhook-bridge-anonymized.ts:29-35`), and the payload schema declares only `submissionId` (`events-payloads.ts:62-64`). A field added at the emitter alone reaches no webhook consumer.
- **A period of null, zero or less means keep forever** (`retention.ts:9-11, 60`).

## 📝 Proposed Solution

1. Accept a system tick with both tenant and organization absent, or the existing fully scoped payload; reject a partial scope. Discover tenant/organization pairs from the forms tables, including deleted forms with a positive period, and use an isolated fork per pair. All form, version, submission and notice-state operations include both scope ids.
2. Enumerate forms in a persisted, fair keyset walk across organizations. Persist the next form position between time-bounded ticks; do not restart at the first form each day. Count eligible submissions per form with the two indexed queries. Anonymization uses batches of at most 100 with a run budget and a persisted position; a cap on anonymization never grants notice eligibility to an unvisited form.
3. For every form generation with eligible submissions, persist the count and a pending notice before any anonymization. Retry pending notices until delivered. Start its thirty-day notice period only after delivery. Explicit delete never bypasses this rule.
4. Resolve the independent `OM_FORMS_RETENTION_MODE` and log/report it under that name. Unset counts only for one minor; unset means delete from the next minor, subject to the per-form notice gate. Explicit report always counts only. Changing history mode has no forms effect.
5. Before each anonymization batch, consult the optional retention guard under R3-5 below. Catch and report per-submission failures and continue through later forms/organizations; a failed form remains revisitable without starving the walk.
6. Emit the existing anonymized event with the additive reason and register the existing cleanup-only queue on a daily cron schedule from setup and a core upgrade action.

### R3-5 — Holds, honestly

Scheduled forms retention resolves `privacyRetentionGuard` softly by DI and calls `excludedSubjects({ scope, setId: 'forms.submissions' })`, following DEC-C — Retention sets and holds in `2026-11-16-privacy-record-retention.md`, “Legal holds” and its `PrivacyRetentionGuard` API contract. Absence is allowed: OSS has no legal-hold engine and runs as specified. A registered guard that throws refuses that organization's pass and reports the error; it is never treated as absent.

The verified first-party subject mapping is `subject_type = 'customer'` plus `subject_id` to `customer_accounts:user` (`forms/lib/portal-subject-policy.ts`). Exclude those held submissions in the selection and re-check before calling the service. For any returned held kind that cannot be matched completely, including `customers:person` or `privacy:identifier` without the required alias resolution, skip the organization's run with `hold_not_honourable`. Do not infer identity from arbitrary free-form subject types, read portal/CRM/holds tables, or assume a held person cannot appear through an invitation. A future alias-aware implementation may narrow this skip only with explicit coverage. Guard lookup and matching happen before destructive work and again for each batch; counts report held exclusions and skipped organizations separately.

The content-ai coverage spec's “Classes” also reaches a portal user through invitation `recipient_email_hash` and the user's `email_hashes`. A guard result contains subject references only, not those aliases. Therefore even a supported portal-user hold cannot safely use only the direct-id predicate when eligible invitation-attributed or unknown-type submissions exist. Before the first anonymization, a bounded existence check over that scoped pass's eligible rows tests for this attribution gap; if present, skip with `hold_not_honourable`. Recheck before each batch. With only fully understood `customer` mappings, leave out held user ids and process the others. Never interpret missing aliases as proof that an invitation belongs to no held user.

Legal holds exist only with the enterprise engine. OSS record retention has `--exclude-subject` and no legal holds. Operational pruners are age/expiry hygiene rather than subject operations and holds do not apply to them; forms anonymization is the exception specified here because it acts on attributed submissions. The program's Known limits must state this same R3-5 boundary.

| Alternative | Why rejected |
|---|---|
| Share `OM_RETENTION_HISTORY_MODE` | Enabling log deletion would silently enable irreversible form anonymization. |
| Let explicit delete bypass notice | Contradicts the promise to notify the form's managers before their first affected submission. |
| Rely on an installation-wide notice clock | Later forms or organizations could be anonymized without ever being visited. |
| Defer scheduling until a recipient exists | Recipients are per organization and the schedule is one system schedule; a pending notice already blocks anonymization per form while keeping its count durable. |
| Anonymize unflagged answers too | Retention keeps the existing service semantics; full erasure is owned by the content-ai coverage spec. |

## 📝 Delta

### Capability: forms-retention

#### MODIFIED Requirement: Form retention period
The system SHALL apply a form's positive retention period on a schedule, including deleted forms, only when its own mode permits and its generation's durable count and notice precede anonymization by at least thirty days. It SHALL respect R3-5 holds.

##### Scenario: Explicit delete on a new form
- WHEN forms mode is delete and an uncounted form has eligible submissions
- THEN only counts and notice state change; anonymization waits thirty days after the notice was delivered

##### Scenario: Opt-in minor
- WHEN forms mode is unset in its first minor, regardless of history mode
- THEN it counts and notifies only, and the forms-specific warning and doctor finding name the next minor's default

##### Scenario: Ready form
- WHEN its notice was delivered more than thirty days ago, forms mode permits delete, and the guard excludes no matching held subject
- THEN eligible submissions are anonymized through the existing service

##### Scenario: Held subject
- WHEN a held portal user's old submission and another user's eligible submission are selected in delete mode after notice
- THEN the held submission stays, and only the other is anonymized

##### Scenario: Unmatchable hold or guard failure
- WHEN the first guard check returns a kind the worker cannot fully match or throws
- THEN the organization's pass makes no anonymization writes and reports `hold_not_honourable` or the guard failure; a failure discovered before a later batch stops that batch and reports earlier committed work

##### Scenario: Later form beyond a run budget
- WHEN the walk spans multiple organizations and its budget ends before a form is reached
- THEN a later run resumes there; that form gets its own notice and thirty days before it may be anonymized

##### Scenario: No period or a failed submission
- WHEN no positive period is set, or the service fails for one selected row
- THEN respectively nothing is anonymized, or the failure is reported while later rows and organizations proceed

Frozen by: `packages/core/src/modules/forms/__tests__/retention-purge-worker.test.ts`

#### MODIFIED Requirement: Anonymization event
The system SHALL add an optional reason with exactly `request | erasure | retention` under R3-6 — The form-to-deals reason set; old payloads remain valid. First-party emitters always state it. The subscriber acts for request/erasure and acknowledges retention/omission with no writes, as its owning specs define.

##### Scenario: Sources and bridge
- WHEN the worker, manual anonymize route or the coverage erasure handler emits the event
- THEN respectively it carries retention, request or erasure, and the bridge forwards that same reason

Frozen by: `packages/core/src/modules/forms/__tests__/retention-purge-worker.test.ts`, `packages/core/src/modules/forms/__tests__/forms-webhook-bridge-anonymized.test.ts`

## 📝 Architecture

- **Worker:** keep `forms-retention-purge` at concurrency 1. Forms' own persisted walk state makes progress across restarts; no delivery queue is shared. Counts are stored per form/generation. Each count may be bounded at 10,000 matches, with `countTruncated = true` and notice text “at least”; each form's local notice gate prevents a truncated or not-yet-visited form from being anonymized early.
- **Shared helper:** the pruner spec's Phase 1 owns the exports `parseRetentionWindow`, `resolveRetentionMode`, `recordRetentionFirstCount`, `reportRetentionRun`, `pruneBatches`. Forms consumes pure mode resolution and reporting; its first count and notice timestamps live on the form, not in the helper's installation-first-count store. Forms does not modify `prune.ts` or use its hard-delete loop.
- **Durable notice:** the form row is the retryable notice outbox. Under its scoped row lock create a generation, record count and leave a pending marker. After commit publish `forms.retention.counted`; subsequent ticks republish pending generations until acknowledged. No cleared submission values enter the event or state.
- **Notification delivery:** optional consumer `notifications/subscribers/forms-retention-pending.ts` reads the zod event, resolves candidate recipients through its own `getRecipientUserIdsForFeature`, and calls `rbacService.userHasAllFeatures` for `forms.submissions.manage` in the exact tenant/organization. This uses wildcard-aware policy including `forms.*` and deny overrides. Use a new additive notifications-owned `notificationService.ensureVisibleInAppBatch(input, ctx): Promise<{ visibleRecipients: number }>` for the same existing batch input, with `groupKey = forms.retention:<formId>:<generation>`. It reuses recipient scope validation, channel resolution, row construction and SSE/cache side effects from `createBatch`; existing create/createBatch semantics are unchanged. In one notification transaction take the existing per-group/recipient advisory locks in sorted order, then check all same-group statuses for a durable, non-expired visible row, including read and dismissed. That visibility check and any recovery creation must be inside the same lock/transaction, never a subscriber precheck. Existing visible rows count toward the returned total. Without one, honor the currently resolved channels: create or refresh a suppressed row only if its effective channels include `in_app` (null retains the supported legacy visibility rule); otherwise leave that recipient pending without claiming delivery. Use `isInAppVisible` from `notificationVisibility.ts`, and re-use the same group lock for recovery. This prevents concurrent retries from duplicating a visible notice even after dismissal. A non-empty recipient list, a hidden stored row or successful dispatch alone does not start the countdown. Once visible delivery is confirmed, acknowledge through optional DI `formsRetentionNoticeService.markDelivered({ scope, formId, generation, deliveredAt })`. It conditionally sets the timestamp on that same generation only. A crash before acknowledgement retries the same group without duplicating notices, even if one was already read or dismissed. A stale generation is checked before delivery and ignored; the acknowledgement rechecks it under the form lock, so a reset can at worst leave an obsolete notice, never ready a new period. No recipient, missing RBAC, suppressed channels or delivery failure leaves it pending; no early anonymization.
- **Notification UI:** `forms.retention.pending` is declared in forms `notifications.ts` and `notifications.client.ts`, using `widgets/notifications/RetentionPendingRenderer.tsx`; it states the configured period, count or lower bound, deletion-start date, flagged-fields-only scope and how to stop it. Use i18n, semantic tokens and the shared notification renderer conventions.
- **Registration:** `forms/setup.ts.seedDefaults` and core action `forms.register-retention-schedule` call the same registration function; system scope, cron, omit `isEnabled`. Forms declares `retentionSchedules: [{ key: 'forms:retention-purge:system', queue: 'forms-retention-purge', scopeType: 'system' }]` beside its existing default-export members, consuming the parent spec's “Enabled-handler schedule expectations”. Registration uses that exact key's SHA-256-derived UUID, with null tenant/organization; scheduler's `pruners.unscheduled` consumes the same definition, without a copied id list. This schedule is expected independently of forms report/delete mode or per-form notice readiness; its existence never proves anonymization is occurring.
- **Doctor:** forms `privacy.ts.doctorChecks` adds configuration-only `forms.retention_mode_default`. Unset is warning under both release defaults, naming the next minor or the active default and per-form notice gate; explicit report/delete is informational. No forms mode diagnostic is delegated to the history diagnostic. Registration requires R3-2 — The registry carries the whole `privacy.ts` default export, contract Phase 1, and DEC-I — The doctor's extension point, the doctor's Phase 3. Preserve the forms coverage owner's existing `dataClasses` and other members of the default export.

## 📝 Data Models

Add nullable server-maintained columns on `forms_form`: `retention_generation` (uuid), `retention_observed_days` (integer), `retention_first_count_at`, `retention_notice_sent_at`, `retention_counted_at` (timestamptz), `retention_eligible_count` (integer), `retention_count_truncated` (boolean, default false), `retention_notice_pending` (boolean, default false). Scoped row locking protects the generation, counts and acknowledgement. These upkeep writes do not change the form's `updated_at`; user edits to `retention_days` retain their existing mutation guards and optimistic-lock header.

Any change to `retention_days`, including first setting, shortening, lengthening or clearing and restoring, resets the generation and all notice/count state in the same form command transaction, including undo/redo that changes the period; undo never restores an earlier ready generation. A stale delivery acknowledgement cannot ready a new generation. The worker detects mismatched observed days as an additional guard and resets before counting. Repeated counts with the same period do not reset the clock. New eligible submissions in an already-notified generation use that generation's notice; changing the period always requires a new notice and thirty days.

A single internal walk-position row in `module_configs`, through `moduleConfigService` only, uses module `forms`, name `retention.walk`, null tenant. It stores only tenant/org/form/generation keyset ids and the branch/timestamp/submission-id continuation position, never answers or aliases; it is separate from R3-3 — Tenant privacy settings live in `module_configs`, in the contract spec. Failure to persist the cursor pauses the walk rather than repeatedly starving later forms. No new editable entity is added.

Add two partial indexes on `forms_form_submission`, created concurrently in a non-transactional migration, with the module snapshot:

| Index | Purpose |
|---|---|
| `(tenant_id, organization_id, form_version_id, submitted_at, id)` where `anonymized_at is null and deleted_at is null` | Submitted candidates |
| `(tenant_id, organization_id, form_version_id, updated_at, id)` where `anonymized_at is null and deleted_at is null and submitted_at is null` | Never-submitted candidates |

## 📝 API Contracts

- `OM_FORMS_RETENTION_MODE`: `report` or `delete`; unset uses forms' own release default, report for one minor then delete. Invalid values fail safe to report with a warning. Add to both example environment files, template sync and forms' own upgrade note.
- `forms.submission.anonymized`: add `reason?: 'request' | 'erasure' | 'retention'` to `formsEventPayloadSchemas`; bridge adds it to `{ submissionId, emittedAt }`. Keep the event id, optionality and old payload acceptance. No new anonymized event is introduced.
- `forms.retention.counted`: new persistent notice event with `{ tenantId, organizationId, formId, generation, retentionDays, eligibleCount, countTruncated }`, all validated with zod. It contains no answers or respondent identifiers. The notification type stays `forms.retention.pending`; the event uses the past-tense id and the existing anonymization event remains separate.
- `notificationService.ensureVisibleInAppBatch`: additive service method with existing batch input/context, returns the count of currently authorized recipients with an existing or newly created visible in-app row; zero never permits acknowledgement.
- `formsRetentionNoticeService.markDelivered`: new forms-owned scoped, generation-checked acknowledgement; a missing form or obsolete generation is an idempotent no-op. Only the forms module writes these columns.
- Existing manual anonymize route, queue name and anonymize-service signature stay compatible. Scoped worker payloads remain valid; the new system tick is additive. Per-form administrative writes continue to carry the form's `updatedAt` lock version.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Partial scope | Rejected; absent scope is system mode, both ids preserve scoped mode |
| Period is first set or changes | New generation, fresh count and notice, thirty days again; clearing it disables anonymization |
| Soft-deleted form | Its period and per-form notice gate still apply |
| Submission with no version row | Not reachable by per-form version selection; not counted as a selected-row failure; repair is outside this worker |
| Missing notifications, no authorized recipient, delivery failure | Counts persist, notice stays pending and is retried, anonymization waits; the run report counts pending notices |
| Restart or concurrent ticks | Locked generation and group-key dedupe preserve count/notice state; cursor resumes later forms |
| Stale acknowledgement after period change | Ignored because the generation no longer matches |
| Guard absent | Runs as specified; OSS has no legal holds |
| Guard throws or a held kind cannot be matched | Refuse or skip the organization before anonymizing; report separately |
| Legacy subscriber ignores reason | May cascade retention into erasure elsewhere; upgrade note and the R3-6 first-party filter mitigate, third-party risk remains |
| History mode changes | No forms effect |

## 📝 Migration & Backward Compatibility

Ordinary protocol under DEC-H: forms starts opt-in for one minor with its own start warning, doctor check, variable and upgrade note. The next minor changes only forms' caller default; report remains the opt-out. The default-flip task waits for this spec's Phase 2 and its doctor check, independently of the history flip. Even explicit delete waits for the per-form notice period. New columns, events, notification type, DI service and reason field are additive. Never remove the existing anonymized event or make its reason required.

`UPGRADE_NOTES.md` names `OM_FORMS_RETENTION_MODE`, both defaults, the per-form thirty days, no-notification blocking behaviour, form reset semantics, registration action, what flagged-fields-only anonymization leaves, and the residual risk from older subscribers. It cites R3-6: request and erasure are subject-driven; retention and missing reasons must not cascade. `OM_RETENTION_HISTORY_MODE` controls operational history only.

## 📋 Implementation Plan

### Phase 1 — Selection and durable state
1. Characterize the existing fully scoped worker, flagged-field anonymization and reason-less payload in `retention-purge-worker.test.ts` and `forms-webhook-bridge-anonymized.test.ts`.
2. Add the columns, index migrations and snapshots. Extend the existing period-setting command in `commands/form.ts` to reset the generation atomically while preserving optimistic locking; add `retention-notice-state.test.ts` for first/set/shorten/lengthen/clear/restore, stale acknowledgement and concurrent claims.
3. Replace full scans with the two queries and fair persisted form walk, still scoped by both ids. `retention-selection.test.ts` covers submitted/draft cutoffs, deleted form, no period, unreachable orphan and over-budget multi-organization resumption. Ship the selection/state integration case in this phase.

### Phase 2 — Scheduling and safety
1. Consume the named helper exports without editing them. Add system scope alongside scoped payloads, failure isolation and forms-only mode resolution. `retention-mode.test.ts` tests explicit history delete with forms report, forms delete with history report, unset defaults, invalid values and mandatory notice gate under every delete path.
2. Implement R3-5 in `retention-holds.test.ts`: absent guard, held portal subject excluded, portal hold plus an eligible invitation/unknown-attribution submission skips, unmatchable person/identifier hold skips organization and guard failure refuses it. Inject a guard for the real-database integration test.
3. Add the exact R3-6 enum to schema, emitters and bridge; `forms-webhook-bridge-anonymized.test.ts` checks all three values and legacy omission. The coverage owner implements the erasure emitter. Gate destructive scheduling on the first-party subscriber changes and `TC-PRIVACY-FORMS-DEALS-001` in the content-ai spec, which asserts request/erasure cleanup and retention/missing no-op; no second subscriber design is defined here.
4. Add notification declaration/renderer, pending event, forms acknowledgement service and the optional notifications-owned subscriber. `retention-notification.test.ts` covers a second run, restart, crash after notification commit, dismissed notification, concurrent ticks, `forms.*` role, deny override, other organization, no recipients, suppressed in-app preference/type override and later visibility recovery; concurrent retries with dismissal between checks prove the service lock covers all-status lookup and creation. Durable per-form clocks gate anonymization.
5. Add forms-specific doctor check after contract Phase 1 and doctor Phase 3; schedule from the shared `retentionSchedules` definition, upgrade action, both example env files and template sync. Test missing scheduler, exact expectation/registration id parity and preservation of disabled schedules. Configuration-only doctor never reads schedule rows.
6. Ship the remaining integration cases, docs and upgrade note. A release task in the next minor flips forms' default, tests both defaults and retains warning severity for unset mode.
7. Archive this Delta if the capabilities directory has been adopted.

### File manifest

| File | Action |
|---|---|
| `packages/core/src/modules/forms/{workers/retention-purge.ts,lib/retention.ts,lib/retention-notice-service.ts,di.ts,setup.ts,privacy.ts,data/entities.ts,data/validators.ts,commands/form.ts,events.ts,events-payloads.ts}` | Modify / create; period mutation uses its actual form command call site |
| `packages/core/src/modules/forms/{notifications.ts,notifications.client.ts,widgets/notifications/RetentionPendingRenderer.tsx,i18n/*.json}` | Modify / create |
| `packages/core/src/modules/forms/{subscribers/forms-webhook-bridge-anonymized.ts,api/submissions/[submissionId]/anonymize/route.ts}` | Modify — reason |
| `packages/core/src/modules/notifications/subscribers/forms-retention-pending.ts` | Create — optional notification consumer; own recipient helpers and DI only |
| `packages/core/src/modules/notifications/lib/notificationService.ts` and `lib/__tests__/ensure-visible-in-app-batch.test.ts` | Add optional new service method; atomic all-status visibility check and recovery reuse existing helpers |
| `packages/core/src/modules/forms/__tests__/{retention-purge-worker,retention-selection,retention-mode,retention-holds,retention-notice-state,retention-notification,forms-webhook-bridge-anonymized}.test.ts` | Create / extend |
| `packages/core/src/modules/forms/migrations/*` and snapshot | Create / update |
| `packages/core/src/modules/configs/lib/upgrade-actions.ts` and locale keys | Modify |
| `packages/core/src/modules/forms/__integration__/TC-FORMS-RETENTION-00{1,2,3,4}.spec.ts` | Create |
| `apps/mercato/.env.example`, template copy, `UPGRADE_NOTES.md`, forms docs | Modify |

## 🧪 Integration Coverage

Use the in-process real-database pattern of `TC-ENTITIES-009-encryption-map-concurrency.spec.ts` with injected clock, forms mode, budgets and guard. Each test creates its own organizations, roles, forms, versions, submissions, notifications and webhook if needed, then removes all fixtures and state in `finally`. The test adapter limits the system walk to fixture scopes, so no unrelated test data is anonymized. No test relies on the running app's environment or seed data.

| Test | Covers |
|---|---|
| TC-FORMS-RETENTION-001 | Phase 1 selection/state and Phase 2 modes: explicit delete first counts and creates one notice; `forms.*` recipient sees it through notifications API/UI; a second run/restart does not duplicate it; before thirty days nothing changes, after thirty days submission GET shows flagged answer replaced and unflagged answer kept; changing period through forms API resets the gate with the correct optimistic-lock version |
| TC-FORMS-RETENTION-002 | Phase 1 fair walk spans more forms than a run budget in two own organizations; later forms cannot anonymize before their own notice; no-period/recent submissions stay; deleted forms still apply after notice; cleanup removes own cursor/state |
| TC-FORMS-RETENTION-003 | Manual anonymize POST yields request in webhook delivery payload, worker after its notice gate yields retention, coverage erasure handler yields erasure; bridge preserves each; fixtures include own webhook and teardown |
| TC-FORMS-RETENTION-004 | Held portal user's eligible direct submission survives delete, unheld direct fixture anonymizes after notice; a portal hold with eligible invitation/unknown attribution skips before any anonymization; person hold whose aliases cannot be matched skips the organization; thrown guard refuses; absent guard runs; other-tenant and other-organization submissions never change |

## 📝 Risks & Impact Review

| Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| An old configured period starts anonymizing wanted data | High | Form submissions | Independent mode, opt-in minor, durable per-form count/notice and thirty days under explicit or default delete, report opt-out | Irreversible after notice; a manager may ignore it |
| A hold is bypassed | High | Enterprise-held respondents | R3-5 guard before batches, exact known mapping, fail closed for unmatchable kinds or guard errors | Newly created hold after the final guard check remains a concurrency window owned by the engine; broad skips can delay all forms in an organization |
| Notice cannot be delivered | Medium | Forms with missing module/recipients | Pending durable outbox, no anonymization until delivered, pending notices counted in the run report | Retention can remain blocked; operator must restore recipients/notifications |
| Older third-party subscriber treats retention like a request | High | External modules and webhook consumers | Exact optional reason enum, bridge forwarding, R3-6 first-party filter and upgrade note | Third-party code predating reason can still cascade; this spec deliberately retains the frozen event |
| Unflagged answer contains personal data | High | Form answers | State flagged-fields-only behaviour in notice/docs; full erasure belongs to coverage | Designers must flag fields; retention is not full erasure |
| Large backlog or repeated bad row | Medium | Worker and event throughput | Fair persisted form cursor, indexed bounded counts and batches, per-row failure isolation | Several runs may be needed; failed rows need repair |

## Final Compliance Report — 2026-11-16

Reviewed root and specs rules, core setup/notifications/encryption/ACL guidance and queue connection rules against the design. No implementation or runtime tests were run.

| Rule | Status | Notes |
|---|---|---|
| Tenant/organization scope and module boundaries | Compliant design | Exact scopes; holds, recipients and acknowledgement through DI; optional consumer owns notification glue |
| Frozen event and backward compatibility | Compliant design | Optional exact R3-6 enum; old payloads accepted; independent DEC-H bridge |
| Optimistic locking | Compliant design | No new editable entity; period edits keep version checks, internal notice writes do not bump version |
| Count/notice durability and hold enforcement | Compliant design | Atomic form generation, retryable pending state, idempotent notification groups, mandatory per-form notice gate and R3-5 fail closed |
| Integration coverage | Compliant design | Four fixture-isolated tests, selection/state test ships in Phase 1 |
| Edition and notification default | Compliant design | OSS under DEC-2, as is the pruner helper; without a visible notice nothing is anonymized (assumptions 3 and 6) |

**Verdict:** design approved. Implementation is gated on delivery of the pruner helper exports (pruners Phase 1), contract Phase 1 and doctor Phase 3; destructive scheduling is also gated on the R3-6 first-party subscriber changes. Each upstream PR goes through ordinary maintainer review (DEC-2).

## Changelog

### 2026-11-16
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): align the existing forms schedule expectation to the doctor's exact pruners.unscheduled diagnostic id.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): use the current doctor-owned pruners.unscheduled diagnostic for the existing forms schedule expectation.
- Council round two fixes, pass three (GPT-6.1 Sol workers): verified R3-5/R3-6, DEC-C/DEC-H and helper/doctor references; supply the exact system schedule key through the parent's shared expectation manifest, preserving independent forms notice/mode gates.
- Council round two fixes, pass two (GPT-6.1 Sol workers): confirmed R3-5 guard and all four guard-state test paths; closed the invitation-attribution gap for portal holds; replaced stale R3-6 handoff wording with the owners' exact active/no-op reasons and delivery gate; exact DEC-C, DEC-H, R3-2 and DEC-I references, preserving the coverage default export.
- Council round two fixes (GPT-6.1 Sol workers): r8-01 independent forms mode and mandatory notice period; r8-03 R3-5 hold guard; r8-07 durable per-form count/notice and scoped wildcard recipients; r8-28 retained frozen event with explicit third-party risk; r8-30 pruner-owned helper exports; g5-17 fair counting walk and local gates; g5-35 exact management feature; g5-36 unreachable orphan corrected; g5-37 implementation gate aligned; R3-6 exact reason set cited.
- Written autonomously, split out of the operational pruner spec after its review.
- Revised after independent review: the file-removal phase was removed because uploads are held inline and already cleared; per-submission failure isolation added; the event gains a reason so retention cannot cascade into erasure elsewhere; an in-app notification added; soft-deleted forms included; a second index added; what anonymization leaves behind stated plainly.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g5-04 — `reason` is declared in `events-payloads.ts` and forwarded by the webhook bridge, both files, a bridge unit test and the integration test TC-FORMS-RETENTION-003 (the webhook payload carries `request` and `retention`) are in the manifest, and R3-6 requires the form-to-deals owner to update its subscriber (`request` and `erasure` act; retention and omission do not); g5-06 — anonymization by retention ships opt-in for one minor, with a warning at start and in `doctor` naming the next minor's default, and becomes the default after the counting period from the next minor.
