# Privacy coverage: enterprise modules

> **Program:** a coverage spec of [`../../GDPR/2026-11-15-gdpr-ready-deployments-program.md`](../../GDPR/2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), for the enterprise modules `sso`, `security`, `agent_orchestrator` and `record_locks`.
> **Builds on:** [`../../GDPR/2026-11-16-privacy-data-class-contract.md`](../../GDPR/2026-11-16-privacy-data-class-contract.md) and [`../../GDPR/2026-11-16-privacy-subject-erasure.md`](../../GDPR/2026-11-16-privacy-subject-erasure.md), including their addenda, and [`../../GDPR/2026-11-16-privacy-table-coverage.md`](../../GDPR/2026-11-16-privacy-table-coverage.md). The governance module's own rows are covered in [`2026-11-16-privacy-dsr-engine.md`](2026-11-16-privacy-dsr-engine.md).
> **Verified at** `main` @ `08dada9624` by reading each module's entities, services and its own rules; nothing was run. This revision checked the run/delegation links, workflow starter, both storage adapters, SCIM log writes and lock-cleanup predicates in the read-only repository. Object-storage integration and ORM execution were not run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-16-privacy-data-class-contract.md
Extends: .ai/specs/GDPR/2026-11-16-privacy-subject-erasure.md

## 📝 TLDR

When a staff user is deleted, their single-sign-on identity, their MFA secrets and recovery codes, their step-up sessions and their record locks all stay. The one subscriber that was meant to remove the SSO identity reads a field the event does not carry. Agent runs hold whatever was fed to an agent about a customer and whatever it answered, copied into a dozen places, in rows the module's own rules say must never be changed. **Proposed (future):** for `sso`, `security` and `record_locks`, a data class each: a staff user's identities, secrets and sessions are deleted outright, after every other class has run and only once the run has confirmed it will not be refused. For `agent_orchestrator`, an erasure keeps a customer's agent records unchanged and reports them as retained evidence, because clearing them would mean rewriting append-only audit records copied into a dozen places. Process-linked records end by age under an active tenant policy, and the unbounded gap for process-less runs is stated. A finished process includes its delegated-run tree, stored objects and core workflow graph.

**Not in this spec:** the sign-in log and known devices of the 11-13 spec, which are added to the `security` class when they are built; repairing the broken subscriber, which is required and specified in program package A9.

**Checked on 2026-11-16: the SSO subscriber reads the wrong field.** It reads `payload.userId` (`sso/subscribers/user-deleted-cleanup.ts`), while the auth delete command passes `id` in its CRUD side-effect identifiers (`packages/core/src/modules/auth/commands/users.ts`). All three target tables require `user_id`. Phase 1 characterizes the installed ORM's generated SQL and verifies a second user's rows are untouched; it must also cover missing ids and any `ignoreUndefinedInQuery` override. No database or ORM probe was run for this revision. The required fix never sends a query without a validated id.


**The subscriber must be fixed.** The requirement is in the program spec under [A9 — required fix](../../GDPR/2026-11-15-gdpr-ready-deployments-program.md#a9--required-fix): read `id`, send no statement without one, clean up the rows earlier deletions left, and test with the payload the event really carries. The `sso` class in this spec does not replace that fix. The class runs only in an erase run; an ordinary user deletion relies on the subscriber.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | SSO identities, role grants, MFA methods, recovery codes, challenges, step-up sessions | Hard-deleted, as the last classes to run | They are credentials and links for one account. Soft deletion leaves the secret in the table. Deleting them before the run is sure to finish could leave a live administrator with no second factor. |
| 2 | Agent records about a customer | Option A: an erasure clears nothing; the records are reported as retained evidence, and a retention set deletes each finished process whole, with everything under it, once the tenant's window has passed | The module's rules make runs, spans, tool calls, corrections and evaluation results append-only. The content is copied into evaluation cases, guardrail evidence, context bundles, artifacts and offloaded traces; clearing some and not others is worse than clearing none, and clearing all of it rewrites the record of what an agent was given and did. A process about the customer's deal, order or claim is not found by their id under either option. Retaining the records, reporting them and ending them by the tenant's policy is what the module can stand behind. Clearing content (option B) is under Alternatives considered. |
| 3 | A staff user who triggered, was assigned, corrected or decided | Left as an id | Who acted is the audit record. |
| 4 | An agent's own account | The run is refused in pre-flight | It is a service account. Deleting it through the person route would break the agent and remove nothing about a person. |
| 5 | Delegation grants a user gave to an agent | Revoked, and kept | A grant is the evidence of the authority an agent acted under. Revoking stops it working; the row stays. |
| 6 | Record locks | The user's lock rows are deleted. Conflict rows, which involve a second user, are left to the module's clean-up, which gains physical removal thirty days after its existing hide step | Deleting a conflict would drop the other person's pending conflict. |
| 7 | SSO rows with no tenant | Match the globally unique user id only after the auth owner confirms tenant membership; when an organization scope is supplied, also restrict to that organization | No inferred organization set is needed for a tenant-wide run. Non-null tenant ids must equal the scope; contradictory rows are refused and reported. Provisioning logs use the scoped identity/config pairs collected before deletion. |
| 8 | The period for agent records under option A | The tenant's retention policy for the set, in the enterprise engine. Floor 180 days after a process finished; recommended 365. Setup creates no policy. With no policy nothing is deleted, and the class reports the records as retained with no end date | Deleting audit records on upgrade is not something to do unasked, as the change-history retention spec decided for its own sets (its assumption 2), and the DSR engine creates no domain policy (its assumption 4). The floor is twice the longest window the agent metrics read. The no-end report and Known limits make the open-ended keeping visible to the controller. |
| 9 | Deleting rows the module calls append-only | One exception to the module's rule: the retention set deletes whole rows of a finished process past the window. No row is ever updated. The Phase 3 change that ships the set writes the exception into `agent_orchestrator/AGENTS.md` | Immutability protects a record while it is kept; ending the keeping deletes the row and changes nothing in it. Without the exception option A would have no end. |
| 10 | Workflow events are immutable today | The workflow owner adds a narrowly scoped exception for deleting a terminal process's complete workflow graph through its service: whole-graph deletion after the process policy window, with no snapshots of removed values. Content-ai coverage's Phase 5 writes it into `packages/core/src/modules/workflows/AGENTS.md` with the owner service | Deleting a whole terminal graph changes no kept row and leaves no copy of the process input behind. It permits no general event update or delete. When the owner service is absent at runtime, the set refuses with `workflow_retention_unavailable`, keeps the graph and process locator, and never claims complete deletion. |
| 11 | Process-linked `user_tasks` | Mapped to the `processes` section with R4-8's four workflow tables, as retained `evidence` with the process policy date or null | The owner's graph read enumerates tasks with the rest of the graph, and a task's form data, comments and bindings are copies of process content, like a step's input. Without a declaration every graph with a task would block verification. R4-8 assigns the mapping to this spec. |

## 📝 Problem Statement

| Module | What it holds about a person | Linked by | Today |
|---|---|---|---|
| `sso` | Identity: subject, email, name, groups, external id; role grants; deactivations; the provisioning log with external ids | `user_id` on the first three; by value in the log. Tenant may be empty on every table | Identities are soft-deleted when unlinked. Grants and deactivations are deleted only by the subscriber that never runs correctly (`sso/subscribers/user-deleted-cleanup.ts:11-33`). The program's A9 fix makes that subscriber hard-delete a deleted user's identities, soft-deleted ones included, with their grants and deactivations |
| `security` | MFA methods with the TOTP secret in clear, an email for email codes, passkey data; recovery-code hashes; challenges; step-up sessions with their token in clear | `user_id` | Methods are soft-deleted; recovery codes are marked used and kept; challenges are never deleted; expired step-up sessions have a clean-up nothing calls |
| `agent_orchestrator` | See the list of stores below | A customer by the process's subject type and id — processes about their deal, order or claim, the common case, do not name them. A staff user by ids, one of them inside a JSON column. Runs have no user column | Runs, spans, tool calls, corrections, evaluation results, guardrail checks, context bundles and guardrail-set versions have append-only or immutable rules in the module guide (`agent_orchestrator/AGENTS.md:169-229`). Full payloads are offloaded to object storage, and the rows keep the keys. The storage service can delete (`packages/storage-s3/src/modules/storage_s3/lib/storage-service.ts:77, 177`), but both the trace store (`lib/trace/artifactStore.ts`) and run-file store (`lib/runtime/artifactFileStore.ts`) expose only upload and download on their structural storage types. No retention exists |
| `record_locks` | The locking user, their address, who released | `locked_by_user_id` | Rows are soft-deleted after days and never removed (`record_locks/lib/recordLockService.ts:49-51, 1404-1413`) |

- **No module here has an encryption map** except `agent_orchestrator`.
- **A SCIM-provisioned person always has a user**, so no new subject kind is needed.
- **`agent_principals.user_id` is the agent's own account**, a real row in the users table.
- **Where agent content lives.** Run input and output; proposal payloads; corrections' proposed and corrected values; evaluation cases' input and expected output, copied from runs and corrections (`agent_orchestrator/data/entities.ts:468-499`); evaluation results' and guardrail checks' evidence; tool-call summaries and span attributes (`:309, 351-354`); context-bundle sources and their payload references (`:1203-1228`); run artifacts (`:1716-1720`); session outcomes; a process's label, title, input and facets; offloaded traces.
- **Where the stored objects are named.** `agent_runs.output_artifact_key`, `agent_tool_calls.request_artifact_key` and `response_artifact_key`, `agent_context_bundles.payload_ref`, `agent_run_artifacts.storage_key` (`data/entities.ts:187, 357, 360, 1228, 1716`).
- **Core workflow copy.** `workers/process-execution-starter.ts:194-200` starts a workflow with `initialContext: decrypted.input` and metadata containing only `initiatedBy`; it does not set the customer `entityId` used by `workflows.instances` discovery. `process_instances.workflow_instance_id` is the link. The core graph is `workflow_instances`, `step_instances`, `workflow_branch_instances`, `workflow_events` and `user_tasks` (`packages/core/src/modules/workflows/data/entities.ts`).
- **Delegated runs.** `ai-tools.ts` supplies `parentRunId` without the workflow triple. `AgentRun.parent_run_id` must be followed transitively; the current tool caps delegation depth, but the handler must handle a stored grandchild too. `commands/runs.ts` stamps trace-inspector re-runs with `rerunOfRunId`, a different link; a re-run is a separate process-less run.
- **What reads old agent rows.** Metric rollups are recomputed every five minutes over windows of 24 hours to 90 days and kept as rows of their own (`lib/metrics/metricRollupService.ts:8-13, 122-168`). Evaluation suites run on replay runs, which belong to no workflow instance (`agent_orchestrator/AGENTS.md`, data model, `AgentRun`), and their case runs keep score, pass and cost (`data/entities.ts:1850`). Evaluation cases copy a source run's or correction's input and are edited by people (`:450-499`).
- **Reference-only columns elsewhere**: who enforced an MFA policy, who configured step-up, who created a SCIM token.
- **Fixtures exist.** SCIM creates identities with no identity provider (`sso/__integration__/api/TC-SSO-003-scim-user-lifecycle.spec.ts`), and agent processes have API tests (`agent_orchestrator/__integration__/TC-AGENT-CASELOAD-010.spec.ts`).

## 📝 Proposed Solution

### Classes

| Class | Subject kinds | `erasureGroup` | On erasure |
|---|---|---|---|
| `sso.identities` | `auth:user` | `credentials` | Identities, role grants and deactivations **deleted** outright, soft-deleted rows included. Provisioning-log entries for that user **deleted** |
| `security.credentials` | `auth:user` | `credentials` | MFA methods, recovery codes, challenges and step-up sessions **deleted** outright |
| `record_locks.locks` | `auth:user` | `records` | The user's lock rows **deleted**; conflict rows naming them **retained**, reason `other_party`, with their cleanup eligibility date |
| `agent_orchestrator.principals` | `auth:user` | `records` | Refuses in pre-flight when the user is an agent's account. Otherwise: grants the user gave are **revoked** and **retained** as evidence; their ids elsewhere stay |
| `agent_orchestrator.records` | `customers:person` | `records` | **Retained** as evidence (option A, assumption 2) |

Each class declares the `erasureGroup` shown, so the credential classes run after every class that holds records. None of them owns a subject kind, so none sets `anonymizeOwnerWhenRetained`.

Exports follow the same finds, with secrets left out: an MFA method by type, label and date; an identity by provider and identifiers; directly attributed agent processes by agent, dates, outcome and content. Every agent export section reports `related_record_processes_not_searched`: processes whose subject is the customer's deal, order or claim were not searched, and an empty direct result is not complete coverage of those records.

`agent_orchestrator.principals` is separate from `.records` because a staff user and a customer are different subjects with different outcomes, and a staff user's erasure ships in Phase 2 without waiting for the Phase 3 retention set. Identifier references supplied by hold guards remain the contract's **DEC-A — Subjects known only by an identifier (`privacy:identifier`)**; these classes do not derive aliases or reinterpret an identifier id as a user id.

### SSO matching and deletion order

After the auth owner's tenant check, read every matching identity, including soft-deleted ones, through the encryption helpers. Keep its `(id, external_id, sso_config_id, organization_id)` in memory before deleting anything. Provisioning-log rows match `resource_type = 'User'` and either `resource_id = identity.id` or a non-empty `scim_external_id = identity.external_id`, inside that identity's exact configuration and organization and with `tenant_id` equal to the requested tenant or null. Never match an external id across configurations. `sso/services/scimService.ts` logs the identity id on create, patch and delete. Export uses the same find. Delete matching logs first, then grants and deactivations, then identities, in one transaction; aliases are never logged or stored by the privacy run.

Under **R3-1 — The audit-history rule for every erasure**, the erasure spec's **The run** and **Audit history — `audit_logs`** own dry-run planning, both history passes, replay leases and snapshot-free cleanup, through **DEC-B — The audit-history strip routine**. Each class enumerates the same complete `historyRecords` inventory in dry-run before any dependent mutation and returns actual identities on apply, including soft-deleted and other people's edited rows. The coordinator persists the plan, strips immediately after account locking and again after the owner, and refuses an unplanned identity before editing it. Internal deletion, blanking and grant revocation create no snapshot or audit entry carrying removed values. These are history selectors, not new audit writes; unlogged rows use their discovered module entity id with the colon replaced by a dot.

| Class | History records returned |
|---|---|
| `sso.identities` | Every deleted `sso_identities` id as `sso.sso_identity`, `sso_role_grants` id as `sso.sso_role_grant`, `sso_user_deactivations` id as `sso.sso_user_deactivation` and `scim_provisioning_log` id as `sso.scim_provisioning_log`; these are entity identities for rows without command logs today |
| `security.credentials` | Every deleted method id as both `security.mfa_method` (existing command kind) and `security.user_mfa_method` (entity identity), recovery id as `security.mfa_recovery_code`, challenge id as `security.mfa_challenge` and session id as `security.sudo_session`; also `security.user_mfa` and `security.recovery_codes` paired with the user id, matching aggregate command logs |
| `record_locks.locks` | Every deleted lock id as `record_locks.record_lock`; unchanged retained conflicts and other users' released locks add no history record |
| `agent_orchestrator.principals` | Every revoked grant as `agent_orchestrator.delegation_grant`, matching `commands/grants.ts` |
| `agent_orchestrator.records` | `[]`: the erasure changes no row (assumption 2) |

The security class also declares `auditResourceKinds: ['security.user_mfa', 'security.recovery_codes']` for existing user-id audit records. Internal cleanup writes no snapshot or log carrying removed values. Tests pin the exact selectors before implementation ships.

### Retained declarations and exact row evidence

Use [verification](../../GDPR/2026-11-16-privacy-verification-suite.md), **Definition and run evidence**, for `PrivacyRetainedDeclaration`; use C4’s [**Contract additions — `@open-mercato/shared/modules/privacy`**](../../GDPR/2026-11-16-privacy-subject-erasure.md) for the owner type `PrivacyRetainedRecord` and `PrivacyErasureSectionResult.retainedRecords`. Each table row below is a class-level `retained` declaration with exactly `section`, `table`, `columns` and `reason`; class id comes from the enclosing definition. On erasure, the owning handler emits that section with outcome `retained`, matching `retainReason`, and one `retainedRecords` entry per exact surviving row: `{ table, rowId, columns, reason }`. The runner stamps `dataClassId`. Emit only matched rows and columns that actually survive this applied run, never a table-wide waiver or another subject's inventory. A mixed result separates deleted credentials or anonymized content from each retained subset; only its own `retained` section may carry survivor evidence. Empty sections grant no survivor allowance. C4 now specifies these optional type additions and runner stamping; that implementation remains a prerequisite, and aggregate `affected` counts are insufficient. Exact evidence stays in dry-run/apply reports and encrypted audit/journal results and is omitted from `privacy.subject.erased`, under C4’s event-safe section projection.

| Class / section | Table | Retained columns | Reason |
|---|---|---|---|
| `sso.identities` / `configuration_authorship` | `scim_tokens` | `created_by` | `other_party` |
| `security.credentials` / `configuration_authorship` | `mfa_enforcement_policies` | `enforced_by` | `other_party` |
| `security.credentials` / `configuration_authorship` | `sudo_challenge_configs` | `configured_by` | `other_party` |
| `record_locks.locks` / `conflicts` | `record_lock_conflicts` | `resource_kind`, `resource_id`, `base_action_log_id`, `incoming_action_log_id`, `conflict_actor_user_id`, `incoming_actor_user_id`, `resolved_by_user_id` | `other_party` |
| `record_locks.locks` / `released_locks` | `record_locks` | `released_by_user_id` | `other_party` |
| `agent_orchestrator.principals` / `grants` | `agent_delegation_grants` | `agent_principal_id`, `agent_user_id`, `delegator_user_id`, `revoked_by_user_id`, `scopes`, `issuer`, `subject`, `audience` | `evidence` |
| `agent_orchestrator.principals` / `authorship` | `process_instances` | `triggered_by`, `assignee_user_id` | `other_party` |
| `agent_orchestrator.principals` / `authorship` | `process_definitions` | `created_by` | `other_party` |
| `agent_orchestrator.principals` / `authorship` | `agent_corrections` | `corrected_by_user_id` | `other_party` |
| `agent_orchestrator.principals` / `authorship` | `agent_proposals` | `disposition_by` | `other_party` |
| `agent_orchestrator.principals` / `authorship` | `agent_eval_cases` | `approved_by_user_id` | `other_party` |
| `agent_orchestrator.principals` / `authorship` | `agent_runs` | `flagged_by` | `other_party` |
| `agent_orchestrator.principals` / `authorship` | `agent_eval_suite_runs` | `triggered_by` | `other_party` |
| `agent_orchestrator.records` / `processes` | `process_instances` | `input`, `source_entity_type`, `source_entity_id`, `subject_type`, `subject_id`, `subject_label`, `subject_title`, `subject_facets`, `outcome_id`, `outcome_label`, `failure_reason` | `evidence` |
| `agent_orchestrator.records` / `processes` | `workflow_instances` | `id`, `context`, `metadata`, `correlation_key`, `error_message`, `error_details`, `pending_transition` | `evidence` |
| `agent_orchestrator.records` / `processes` | `step_instances` | `id`, `workflow_instance_id`, `branch_instance_id`, `input_data`, `output_data`, `error_data` | `evidence` |
| `agent_orchestrator.records` / `processes` | `workflow_branch_instances` | `id`, `workflow_instance_id`, `parent_branch_id`, `context_namespace`, `pending_transition`, `error_message`, `error_details` | `evidence` |
| `agent_orchestrator.records` / `processes` | `workflow_events` | `id`, `workflow_instance_id`, `step_instance_id`, `branch_instance_id`, `event_data`, `user_id` | `evidence` |
| `agent_orchestrator.records` / `processes` | `user_tasks` | `id`, `workflow_instance_id`, `step_instance_id`, `branch_instance_id`, `task_name`, `description`, `form_schema`, `form_data`, `comments`, `reassign_reason`, `entity_bindings` | `evidence` |
| `agent_orchestrator.records` / `runs` | `agent_runs` | `input`, `output`, `error_message`, `context_routing`, `output_artifact_key` | `evidence` |
| `agent_orchestrator.records` / `proposals` | `agent_proposals` | `payload`, `guard_results`, `disposition_reason`, `auto_disposition_block` | `evidence` |
| `agent_orchestrator.records` / `corrections` | `agent_corrections` | `proposed_value`, `corrected_value`, `reason` | `evidence` |
| `agent_orchestrator.records` / `evaluation_cases` | `agent_eval_cases` | `source_id`, `name`, `input`, `input_key`, `expected`, `assertions` | `evidence` |
| `agent_orchestrator.records` / `evaluation_results` | `agent_eval_results` | `evidence` | `evidence` |
| `agent_orchestrator.records` / `guardrails` | `agent_guardrail_checks` | `evidence` | `evidence` |
| `agent_orchestrator.records` / `spans` | `agent_spans` | `name`, `attributes` | `evidence` |
| `agent_orchestrator.records` / `tool_calls` | `agent_tool_calls` | `request_summary`, `response_summary`, `request_artifact_key`, `response_artifact_key`, `error_message` | `evidence` |
| `agent_orchestrator.records` / `bundles` | `agent_context_bundles` | `routed_sources`, `pruned_sources`, `sources`, `payload_ref` | `evidence` |
| `agent_orchestrator.records` / `artifacts` | `agent_run_artifacts` | `file_name`, `storage_key`, `caption`, `promoted_attachment_id` | `evidence` |
| `agent_orchestrator.records` / `sessions` | `agent_run_sessions` | `outcome` | `evidence` |

Credentials and SSO dependants deleted by their classes have no retained declaration. The `released_locks` section covers another user's lock naming this user only as releaser. The `conflicts` and `released_locks` sections use the existing cleanup's earliest eligibility dates. Grants and authorship have no end date here and report `retainedUntil: null`. Agent content sections use the exact process policy date, or null with the stated cause; evaluation cases remain person-curated with no promised date. Configurations/other-party rows are exported with secrets and other people's values omitted. Retained declarations locate allowed columns without widening subject discovery to arbitrary mentions or permitting a retained file through verification's stricter file checks. For record conflicts, select all scoped rows naming the user as `conflict_actor_user_id`, `incoming_actor_user_id` or `resolved_by_user_id`, including hidden rows, and populate one `PrivacyRetainedRecord` per surviving conflict; retained released locks name exactly that user in `released_by_user_id` on another user’s lock. For agent option A, enumerate the direct process’s full delegated tree and the retained copied evaluation cases through the same owner discovery used for export, then populate each matching section/table/row/column/reason entry above. No policy or preview-only policy reports `retainedUntil: null` with its cause; a failed policy read reports unavailable, never an invented date. An active apply policy reports the process’s earliest eligibility and `retentionSetId: agent_orchestrator.processes`; curated evaluation cases have no end date. Preserve `related_record_processes_not_searched` in the report.

Under **R4-8 — The workflow privacy read result**, core workflow row evidence comes from content-ai's **Modules assigned after the council review — Owner graph evidence**, `workflowPrivacyRetentionService.readInstanceGraphForPrivacy({ scope, instanceId })`, never an agent-module table query. Its result is a flat array of `{ table, rowId, columns, reason }`. The five workflow rows above are the fixed table-to-section map: R4-8's `workflow_instances`, `step_instances`, `workflow_branch_instances` and `workflow_events`, plus `user_tasks` (assumption 11), each map to the existing `agent_orchestrator.records` section `processes`. They declare surviving `evidence` for process-linked graphs whose metadata does not name the customer, so workflow subject discovery has not cleared their copied content. Copy only the owner's exact surviving row ids, columns and reason into that mapped retained section, with the process's policy date or null as above; a `deleted` entry supplies no retained allowance. Unknown tables, undeclared columns or a reason without a matching retained declaration remain incomplete, never a table-wide waiver. Missing capability or incomplete owner evidence still blocks TC-PRIVACY-ENT-003 and G6's TC-PRIVACY-VERIFY-010; neither a process locator nor aggregate counts grant retained permission. C4 owns the row-evidence type and class stamp; G6 owns declaration matching only.

### The agent's own account

`agent_orchestrator.principals` implements the erasure spec's read-only check, `checkErasable`. For a user who is an agent's principal it refuses, naming the agent, and the run does not start for that subject.

### Agent records about a customer

**Option A — decided (assumption 2).** Nothing is changed by an erasure. The class exports processes whose subject directly equals the customer and reports them as retained evidence. It uses the policy access service below for the earliest retention eligibility date; absence of an apply policy means `retainedUntil: null`, with an explanation. A hold, failure or changed policy can delay deletion, so this date is not a deadline. Evaluation cases copied from the customer's runs or corrections are reported as retained too. Process-linked records end through one retention set, declared in the module's `privacy.ts` under the record-retention spec:

| Set | Age | Floor | What goes | Can leave out |
|---|---|---|---|---|
| `agent_orchestrator.processes` — `records` | `completed_at` of a process in a terminal state — `completed`, `auto_completed`, `failed` or `cancelled` — stamped when it became terminal (`lib/processes/processProjection.ts:70-72, 282-284`) | 180 days | The process; workflow-linked root runs and every `parent_run_id` descendant; their proposals, corrections, bundles, spans, tool calls, evaluation results, guardrail checks, artifacts and sessions; stored objects; the linked core workflow and its descendants through the workflow owner | `[]`: any subject hold skips the tenant |

- **Period.** The handler requires an active tenant policy for `agent_orchestrator.processes`, read on every batch through `privacyRetentionPolicyService`. Both command and engine use `privacyRetentionService.run`, including its typed engine policy context and **R3-8 — Retention drains its own pending file deletions**. No provider or policy is `policy_required`; a failed provider is `policy_unavailable`. The supplied window/target must equal the policy window/target and be at least 180 days. Apply also requires policy mode `apply`; a preview policy permits dry run only. A raw handler call enforces these checks too.
- **Holds.** Under **DEC-C — Retention sets and holds**, `excludableSubjectKinds: []`. A held customer's data can be in a process about their order or deal, or in arbitrary input. Any subject hold skips the set with `hold_not_honourable`, whether a customer has addresses or none, and whether the guard returns derived `privacy:identifier` references too. No claim is made to leave out only that customer. The engine policy's explicitly acknowledged `allowUnmatchedHolds` remains the only opt-out; it cannot promise preservation of indirect content.
- **The exception to the module's rule.** The module's guide names the append-only kinds and gains one exception: the retention set deletes whole rows of a finished process past the window. No row is updated, by the erasure or by the set (assumption 9).
- **What survives.** Metric rollups are rows of their own, and live metrics read at most 90 days back, inside the floor. Evaluation suites run on replay runs that belong to no process, so the set never reaches them or their case runs. Evaluation cases are not in the set: a person curates them, and they stay until a person archives or deletes them.
- **Stored objects.** Both structural storage types in `lib/trace/artifactStore.ts` and `lib/runtime/artifactFileStore.ts` gain `delete({ key, scope })`, which the storage service already has. In each batch the handler deletes a row's objects before the row, and deletes the row only once all its objects are gone. A missing object counts as deleted. When a delete fails, the row and its key stay, so the next pass finds the object again; the row is not counted as deleted. A run is deleted only after every row under it, deepest delegated children first. The process is deleted last, after its run tree and workflow owner both succeed. Proposals/corrections/bundles linked by either the workflow instance id or any selected run id are included, so delegated content is not lost from discovery. A remaining running descendant prevents the graph from being eligible. Discovery of descendants is tenant/organization-scoped, cycle-checked and repeated under the process lock; cycles or ambiguous ownership refuse the graph rather than skip rows.
- Runs with no process — Playground, evaluation replays and trace-inspector re-runs, including their children, traces and stored objects — are outside the set and have **no end date** under this program. Follow-up `AGENT-PROCESSLESS-RETENTION`, owned by `agent_orchestrator`, must specify their own terminal-run set; this spec does not imply they are retained for only 180 days.
- **Core workflow graph.** The set calls `workflowPrivacyRetentionService.deleteInstanceGraph` through DI for each non-null `workflow_instance_id`; it never accesses workflow tables. Under R5-9, the owner service locks the scoped instance, rechecks status in `COMPLETED`, `CANCELLED` or `FAILED` and no running, retrying or replaying work, and deletes tasks, events, steps and branches before the instance in the batch transaction. A terminal `failed` process and its `FAILED` graph are eligible only after the policy window; failure alone does not make an in-flight retry safe to delete. Definitions, triggers and drafts are untouched. A missing service, unsafe state/sharing or owner failure leaves the process locator and reports `workflow_retention_unavailable` or `workflow_not_terminal`; the batch is not complete. The cursor advances past that examined process, so a refused graph cannot stall later eligible processes; a fresh pass retries the preserved locator with the original age, rather than resetting it. Object deletions already confirmed cannot be rolled back, but their source rows stay retryable if the database transaction rolls back. The workflow guide's immutable-event exception is assumption 10. Under DEC-J, [content-ai coverage](../../GDPR/2026-11-16-privacy-coverage-content-ai.md), **Modules assigned after the council review** and **Phase 5 — workflows**, owns both deletion under R5-9 and the `readInstanceGraphForPrivacy` evidence method cited below; their implementations and the exception must land before the agent set ships. Under R4-8, the read operation supplies a flat array of exact scoped row ids, columns and reasons without values; wrong scope is no match, unreadable/ambiguous or unexhausted enumeration is incomplete. The fixed mapping above supplies retained declarations for the five named workflow tables; missing/incomplete evidence or an unmapped table remains a verification blocker. This is deletion of a terminal whole graph, separate from its subject-erasure blanking exception.

Clearing content on erasure (option B) is not adopted; see Alternatives considered. A process about the customer's deal, order or claim is not found by the customer's id.

### Policy access

`data_erasure` registers the optional DI key `privacyRetentionPolicyService`; consumers resolve it softly and never read its tables. Its new read-only method is:

```ts
getActiveWindow(input: {
  scope: PrivacyScope
  setId: string
}): Promise<{
  policyId: string
  updatedAt: string
  olderThanDays: number
  target: 'records' | 'softDeleted'
  mode: 'preview' | 'apply'
  allowUnmatchedHolds: boolean
} | null>
```

`null` means no enabled record-mode policy for the exact tenant, optional organization and set. The provider validates uniqueness and refuses ambiguous policies; an organization-scoped caller never receives a wider policy as permission. A database error throws, rather than becoming null. The agent class reports `retainedUntil = completed_at + olderThanDays` only for an active apply policy, with `retentionSetId: 'agent_orchestrator.processes'`; absent provider, null result or preview-only policy reports no end date and the cause. A provider failure reports policy status unavailable and never fabricates a date. The handler refuses absent/unavailable policy, revalidates window and target on every batch, and binds policy id/version to its continuation; a change requires a new preview. The change-history sets and the OSS retention service's typed engine entry consume the same method. This is the normative read-only seam; the DSR engine's file manifest and DI registration must deliver it before these consumers ship.

### Record-lock clean-up

Characterize `cleanupHistoricalRecords` first: it soft-deletes inactive locks after three days, pending conflicts after one day and resolved conflicts after seven days, and never physically deletes them (`record_locks/lib/recordLockService.ts`). Preserve those predicates. Add a second step that removes rows thirty days after `deleted_at`, using the same tenant scope. The retained conflict report uses `other_party`: an already hidden row has eligibility `deleted_at + 30 days`; a pending row has `created_at + 1 day + 30 days`; a resolved row has `updated_at + 7 days + 30 days`. These are earliest dates, recalculated if its state changes; actual removal waits for the module's demand-triggered cleanup. Export includes those conflict rows without another user's private data.


### Design decisions

| Decision | Rationale |
|---|---|
| Hard delete for credentials, last | See assumption 1. |
| Two agent classes | A staff user's grants are revoked and a customer's records are retained; the staff class ships in Phase 2 without waiting for the Phase 3 retention set. |
| Grants are revoked, not deleted | See assumption 5. |
| The refusal is a pre-flight check | A class that runs among many cannot make the run "change nothing" once others have acted. |
| Rows with no tenant are matched only after the auth owner's tenant check | See assumption 7. |
| A customer's agent records are retained on erasure | See assumption 2. |
| Process-linked agent records end by deleting a finished process whole | It ends the keeping without changing what was kept, and a floor above the metrics windows keeps every row a reader still uses. See assumptions 8 and 9. |
| Objects are deleted before their row | A row deleted first would leave an object nothing points at. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Clear only run input and output | The same content is in evaluation cases, evidence, bundles, artifacts and traces. |
| Option B: clear content in every store on erasure, keeping rows, ids, timings and outcomes | It needs a second exception to the append-only rule for clearing content, the keep-the-key-until-deleted object rule, withdrawal of derived evaluation cases and an R3-1 inventory of every cleared identity. It rewrites the record of what an agent did and still misses processes about the customer's deal, order or claim. |
| Module setup creates an active 365-day policy for every tenant | It deletes audit records on upgrade unasked; the engine creates no domain policy (assumption 8). |
| No exception to the agent or workflow immutability rules | Option A would have no end: the records are kept with no end date, and the gap stays on the program's list (assumptions 9 and 10). |
| Delete a customer's agent runs on erasure | Runs from the last 90 days feed the metrics and cost views, and erasure would reach them at any age. Option A's set deletes only finished processes past a floor of 180 days, and evaluation history is in replay runs it never reaches. |
| A retention set that clears content and keeps the rows | It mutates append-only rows, which is option B's exception, and leaves rows nobody needs. |
| Soft-delete credentials, as today | The secret stays in the table. |
| Delete a user's delegation grants | See assumption 5. |
| Delete conflict rows with the user's locks | They belong to two people. |
| Match SSO rows before the owner's tenant check | A caller could name another tenant's user; assumption 7 permits the globally unique id only after that check. |

### Known limits

- A customer mentioned in a run that belongs to a process about someone else is not found.
- Process-less Playground, replay and re-run trees and their objects are kept without an end date; `AGENT-PROCESSLESS-RETENTION` is assigned to the agent module.
- A staff user's id inside a JSON column is left where it is.
- A customer's data in a process about their deal, order or claim is not reached by subject discovery, export or erasure. Each export section states `related_record_processes_not_searched`; the age set reaches it only under a policy and skips on any subject hold by default.
- Until a tenant sets a policy for the set, agent records have no end.
- Evaluation cases copied from a customer's runs stay until a person removes them.

## 📝 Delta

### Capability: privacy-coverage-enterprise

#### ADDED Requirement: Export of enterprise records
The system SHALL include in a staff user's export their single-sign-on identities, the kinds of MFA they have set up, and their record locks, and in a customer's export processes whose subject directly names that customer, with a notice that processes about related deals, orders and claims were not searched.

##### Scenario: MFA
- WHEN a user with a TOTP method is exported
- THEN the method's type and date appear and its secret does not

#### MODIFIED Requirement: Erasure of a staff user's credentials and identities
The system SHALL, when a staff user is erased, delete their single-sign-on identities and grants, their MFA methods, recovery codes, challenges and step-up sessions, and their record locks, leaving no row, and SHALL do so only after the run has confirmed that no class refuses.

##### Scenario: Identity
- WHEN a user with an SSO identity is erased
- THEN no identity, grant or deactivation row for them exists, including soft-deleted ones

##### Scenario: MFA secret
- WHEN a user with MFA is erased
- THEN no method, recovery code, challenge or step-up session of theirs exists

##### Scenario: Refused elsewhere
- WHEN another class refuses the user in pre-flight
- THEN their MFA methods and identities are untouched

##### Scenario: Another tenant's user
- WHEN a run for one tenant names a user of another
- THEN the owner's check stops it and no identity is deleted

Frozen by: `packages/enterprise/src/modules/sso/__tests__/user-deleted-cleanup.characterization.test.ts`

#### ADDED Requirement: An agent's account
The system SHALL refuse to erase a user that is an agent's own account, before anything is changed.

##### Scenario: Refused
- WHEN erasure is requested for an agent's account
- THEN nothing changes and the run names the agent

#### ADDED Requirement: Agent records about a customer
The system SHALL export directly attributed customer processes and state the indirect-search gap. On erasure it SHALL report retained evidence and the earliest date from an active apply policy, or no end date with a cause. Under that policy it SHALL delete a finished process with its full delegated run tree, workflow graph and stored objects past the window.

##### Scenario: Retained
- WHEN a customer with an agent process is erased
- THEN the process is unchanged and the run reports it as retained, with the earliest eligibility date for an active apply policy or with no end date and the cause

##### Scenario: Past the window
- WHEN the set is applied and a finished process is older than the window
- THEN no row of the process, its transitive run tree or linked workflow graph remains, stored objects are gone, and a process inside the window or still running is unchanged

##### Scenario: Failed process past the window
- WHEN a terminal `failed` process and its linked `FAILED` workflow graph are past the policy window and no retry or replay is in flight
- THEN R5-9 permits whole-graph deletion; a recent failed graph or one with running, retrying or replaying work is preserved

##### Scenario: An object that cannot be deleted
- WHEN deleting a stored object fails
- THEN the row that names it keeps its key, and the next pass deletes both

##### Scenario: A held customer
- WHEN any customer is held, with or without an address, including one whose process subject is their order
- THEN the set skips the tenant with `hold_not_honourable`; derived identifier references do not turn it into a selective exclusion

##### Scenario: No policy through the command
- WHEN the retention command or a direct handler call supplies a valid window but no active policy exists
- THEN no row or object is deleted and the handler reports `policy_required`

##### Scenario: Indirect customer export
- WHEN a customer owns a deal with an agent process and has a directly attributed process too
- THEN only the direct process is exported and the section explicitly says related-record processes were not searched

##### Scenario: Workflow failure
- WHEN the workflow owner cannot delete the instance graph
- THEN the process locator remains, the run is incomplete, the cursor advances past it so later eligible processes can be examined, and a fresh pass retries it

#### MODIFIED Requirement: Record-lock history cleanup
The system SHALL preserve the existing hide thresholds and physically remove hidden lock/conflict rows only after thirty further days.

##### Scenario: Hidden conflict
- WHEN cleanup sees a conflict hidden more than thirty days ago
- THEN it is removed; a recent hidden conflict stays and is reported as retained during erasure

Frozen by: `packages/enterprise/src/modules/record_locks/__tests__/historical-cleanup.characterization.test.ts`

## 📝 Architecture

- `sso`, `security`, `record_locks`: `privacy.ts`, a handler under `lib/privacy/`, its registration, table declarations — including the reference-only columns — and the group each class runs in.
- `agent_orchestrator`: two classes; the pre-flight check; under option A, the retention set and its handler, `delete` on both artifact stores, and the exceptions in the module and workflow guides.
- `record_locks`: the clean-up's second step.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Run → enterprise classes | The data-class registry | Module disabled by its flag: no class |
| SSO class → "is this user in the tenant" | The owner's pre-flight check, which runs before any class acts | The run does not start |
| `agent_orchestrator` → a customer | Its own process table's subject columns | — |
| Engine or command → the agent set | `privacyRetentionService.run`; handler verifies exact active policy through `privacyRetentionPolicyService` | No policy/provider: refuse; no deletion |
| Agent class → policy date | Soft DI `privacyRetentionPolicyService.getActiveWindow` | Report no end date with cause |
| Agent set → workflow graph | Soft DI `workflowPrivacyRetentionService.deleteInstanceGraph`, with scoped id and batch transaction | Keep process locator and refuse incomplete graph |
| Agent set → stored objects | Delete through both trace and run-artifact stores over the storage service | Storage unreachable: rows and keys stay retryable |

## 📝 Data Models

No new table or column under option A; the new policy reader consumes the engine's existing planned policy rows. Indexes on `user_id` where a class looks up by it and none exists; each step lists them.

## 📝 API Contracts

- Uses the erasure spec's `checkErasable`, `erasureGroup` and `PrivacyRetainReason` values. Consumes verification's additive `retained` declarations and the erasure-owner `dataClassId`/`retainedRecords` section evidence; defines no competing result shape. The erasure coordinator and flattened sections remain **R3-14 — The `eraseSubjects` entry point**.
- Declares one retention set in `retentionSets`, with `excludableSubjectKinds`, and implements its `pruneRecords`, both as the record-retention spec defines them.
- Both artifact stores' structural storage types gain `delete({ key, scope })`, matching the existing storage service. They expose module-local deletion wrappers for their respective encrypted object namespaces.
- `privacyRetentionPolicyService.getActiveWindow` is defined under Policy access above and implemented in `data_erasure`; no public route is added.
- Consumes content-ai coverage's **Modules assigned after the council review** and **Phase 5 — workflows**: `workflowPrivacyRetentionService.deleteInstanceGraph({ scope, instanceId, transaction, dryRun })` returns `{ deleted: boolean, reason?: string }`; missing instance is idempotent success, wrong scope never matches, and R5-9 permits only `COMPLETED`, `CANCELLED` or `FAILED` graphs past the policy window with no running, retrying or replaying work. Unsafe state refuses and preserves the process locator while the cursor advances past it. Under R4-8, the same owner defines `workflowPrivacyRetentionService.readInstanceGraphForPrivacy({ scope, instanceId })` returning a flat `Array<{ table: string; rowId: string; columns: string[]; reason: PrivacyRetainReason | 'deleted' }>`. There is no `found`/`complete`/`records`/`historyRecords` envelope. The workflow owner defines enumeration, deletion ordering, invalidation and snapshot-free audit effects; the agent consumes each returned table through the fixed section map above and never treats `deleted` as retained evidence.
- No route changes.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| An identity with no tenant | Matched by user id; see assumption 7 |
| A user provisioned by SCIM and deleted here | The identity provider may provision them again; the docs say erasure must be mirrored there |
| A grant the user gave to an agent | Revoked; the agent can no longer act under it |
| A conflict between the erased user and a colleague | Retained with `other_party` and earliest cleanup date; cleanup runs on module activity, so the date is not a guaranteed removal time |
| A lock currently held by the user | Deleted; the record becomes unlocked |
| A first-group class fails | The account stays locked and its MFA and identities intact; a re-run continues |
| A step-up session in use | Deleted; the next protected action asks again |
| A customer with processes in two organizations | Both are found within the tenant |
| A process still running, or waiting on a person | Never in the agent set; only a terminal process has a `completed_at` |
| A terminal failed process with a `FAILED` workflow | R5-9 permits deletion past the policy window with no running, retrying or replaying work; recent or active graphs stay |
| A workflow graph refuses deletion | The process locator stays and the run is incomplete; the cursor advances past that process so later candidates are reachable, and a fresh pass retries it |
| Any subject hold, including a person with or without derived identifiers | The agent set skips the tenant with `hold_not_honourable` by default |
| Missing/preview policy | No end date promised; absent policy refuses the handler, preview policy never permits apply |
| A delegated grandchild without workflow fields | Found through transitive `parent_run_id`, deleted before its parent |
| A trace-inspector re-run with only `rerun_of_run_id` | Outside the process set; retained with no end date and named follow-up |
| A stored object already missing | Counted as deleted; the row is removed |
| An evaluation case whose source run the set deleted | Kept; its link to the source no longer resolves |
| A process-linked workflow whose metadata does not name the customer | The five mapped workflow tables, `user_tasks` included, report exact surviving evidence in `processes`, with the process policy date or null; a deleted row grants no retained allowance |
| A workflow reader row outside the fixed table/column/reason declarations | Incomplete graph verification; neither a locator nor aggregate counts waive that row |
| A window below 180 days | Refused, with the floor in the message |

## 📝 Migration & Backward Compatibility

Additive. Record-lock rows hidden more than thirty days ago start being removed; nothing reads them. Under option A the agent module's guide gains one exception to its append-only rule, for the retention set's deletion of whole rows. Nothing is deleted from agent tables until a tenant sets an apply policy, including command callers. The workflow guide gains the assumption-10 whole-graph exception before that path can ship. No new editable entity is added; the engine's policy entities/forms retain optimistic locking and localized consequence text. New DI methods and optional registry members are additive; existing routes and event ids stay stable.

## 📋 Phasing

Each class ships its export and erase together.

| Phase | Outcome | Depends on |
|---|---|---|
| 1 | SSO and record-lock cleanup characterizations; cleanup regression | — |
| 2 | `sso`, `security`, `record_locks`, and `agent_orchestrator.principals` | Erasure spec, Phase 3 and **Contract additions**; verification's retained declarations and erasure-owner exact row-evidence handoff |
| 3 | `agent_orchestrator.records` under option A, with the module's retention set, both stores' delete, workflow owner service, policy reader and guide exceptions | The record-retention spec; the engine |

## 📋 Implementation Plan

### Phase 1
1. **Characterize** the SSO subscriber with the real auth event payload and a second user's identity. Freeze generated SQL under the installed ORM/config, missing-id behavior and the danger of `ignoreUndefinedInQuery`; program A9 turns it into a regression requiring zero writes for a missing id. Its cascade uses trusted event tenant/user scope, preserves legacy null-tenant rows and asks the auth owner whether a deleted user was restored; the privacy class's tenant-checked null-tenant rule (assumption 7) is not a cascade permission.
2. **Characterize** the existing cleanup's hide thresholds and the continued presence of old hidden rows in `historical-cleanup.characterization.test.ts` before changing it. Add physical deletion thirty days after hiding; clock-based tests preserve active and recently hidden rows and tenant scope.

### Phase 2
1. One step per module: the class with its group, tables, export sections with secrets left out, the erase, and the table declarations. The whole default object is collected under **R3-2 — The registry carries the whole `privacy.ts` default export**; table claims follow the table-coverage spec's **Declarations and row subsets**, without duplicate class/map claims. Unit tests `ssoPrivacy.test.ts`, `securityPrivacy.test.ts` and `recordLockPrivacy.test.ts`: soft-deleted and null-tenant identities, foreign tenant, pre-flight refusal, exact config-scoped log matches by identity and external id before identity deletion, identical external id in another config retained, and conflict `other_party` with pending/resolved/hidden cleanup dates. Assert dry-run/apply history identity equality for R3-1, no snapshot-bearing blanking, exact class/section/row/column/reason retained evidence, and rejection of a wrong row or missing class stamp.
2. `agent_orchestrator.principals`: the pre-flight check; revoking grants. Unit tests.
3. Integration tests TC-PRIVACY-ENT-001 and 002. Add shared SSO test fixtures under `sso/helpers/integration/privacyFixtures.ts`, exporting `seedPrivacySsoUser` and its idempotent cleanup. It creates owned config/token, identity (live or soft-deleted), grant and deactivation rows and returns exact row ids; no seeded users or provider configuration. Reuse it for TC-PRIVACY-ENT-002 and the verification spec's **TC-PRIVACY-VERIFY-006** enterprise A9 lane: two tenants/users, ordinary API delete, persistent subscriber drain, every target identity/grant/deactivation gone, another user's and legacy null-tenant rows preserved, and a delayed delete→undo control unchanged. Clean every fixture and action entry in `finally`. A9 ships in program Phase 1 and must not wait for privacy-class Phase 2; its carrier delivers the helper/regression first when necessary.

### Phase 3
1. `data_erasure`: the optional policy reader and exact-window/mode/version validation; `agent_orchestrator.records`: qualified export and retained report. Unit tests `agentPrivacyPolicy.test.ts`: active apply, preview, no policy, absent provider, provider error, changed version and no-policy direct command; related-deal export carries the gap notice.
2. The exceptions in both module guides; `delete` on trace and run-file storage types and wrappers. Consume the workflow owner's `deleteInstanceGraph` and `readInstanceGraphForPrivacy` implementations: R5-9 terminal-status and fixed-cutoff safety including `FAILED`, no in-flight retry/replay, child-first deletion, the R4-8 flat row/column/reason result and no snapshots of deleted context; missing/incomplete provider evidence and rollback tests. Pin the five-table map, `user_tasks` included, to `processes`, including copied context whose metadata does not name the customer; copy exact owner reasons, omit `deleted` entries from retained allowances, and reject wrong rows, undeclared columns/reasons and unmapped tables.
3. The retention set and `agentProcessRetention.test.ts`: finished processes past the window and every row under them, objects before rows. Unit tests: inside and outside the window; a running process; a held customer without addresses and an order-subject process skipping the set; a held customer with derived identifiers skipping the set; a staff hold skipping the set; transitive delegated grandchild and cycle; a failed object delete keeping the row and its key; a missing object; a window below the floor; another tenant's process; complete workflow graph removal for a terminal `failed` process with a `FAILED` workflow past the policy window; recent failed and running/retrying/replaying graph controls; workflow refusal preserving the process locator and advancing the cursor to a later eligible process; a fresh pass retrying the refused graph; both artifact namespaces; process-less run tree retained; fixed-cutoff resumption and dry run.
4. Integration test TC-PRIVACY-ENT-003; share its owned delegated-child/grandchild, completed/failed-workflow and both-artifact-store fixture and cleanup with G6’s **TC-PRIVACY-VERIFY-010**. Both lanes require exact retained row/column/reason evidence through the R4-8 map, including workflow metadata without the customer identity, no-policy/no-end reporting, `related_record_processes_not_searched`, recent/running/retrying/process-less controls, a failed process with an aged `FAILED` graph and no retry/replay, refusal advancing past that graph to a later eligible process, and workflow/artifact failure then retry. Include `deleted` and wrong-row/column/reason/unmapped-table controls that grant no retained allowance. The declared tables leave the coverage baseline only after their handlers and proof pass; missing workflow-owner evidence blocks graph verification.
5. Archive this Delta into `.ai/specs/capabilities/privacy-coverage-enterprise.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/enterprise/src/modules/{sso,security,agent_orchestrator,record_locks}/{privacy.ts,lib/privacy/*,di.ts}` | Create / modify |
| `packages/enterprise/src/modules/agent_orchestrator/{lib/trace/artifactStore.ts,lib/runtime/artifactFileStore.ts,AGENTS.md}` | Modify |
| `packages/core/src/modules/workflows/{lib/privacy/retentionService.ts,di.ts,AGENTS.md}` | Create / modify owner service and immutable-event exception |
| `packages/enterprise/src/modules/data_erasure/{lib/retention/policyService.ts,di.ts}` | Create / modify policy reader |
| `packages/enterprise/src/modules/record_locks/lib/recordLockService.ts` | Modify |
| `packages/enterprise/src/modules/sso/__tests__/user-deleted-cleanup.characterization.test.ts` | Create |
| `packages/enterprise/src/modules/sso/helpers/integration/privacyFixtures.ts` | Create reusable owned SSO identity/grant/deactivation fixtures and cleanup for TC-PRIVACY-ENT-002 and TC-PRIVACY-VERIFY-006; may ship first with A9 |
| `packages/enterprise/src/modules/record_locks/__tests__/historical-cleanup.characterization.test.ts` | Create |
| `packages/enterprise/src/modules/{sso,security,record_locks,agent_orchestrator}/__tests__/*Privacy*.test.ts`, `packages/enterprise/src/modules/agent_orchestrator/__tests__/agentProcessRetention.test.ts` | Create module-local privacy and policy/graph tests named in the plan |
| `packages/enterprise/src/modules/{security,sso,agent_orchestrator}/__integration__/TC-PRIVACY-ENT-00{1,2,3}.spec.ts` | Create |

## 🧪 Integration Coverage

In the enterprise test environment. Every test creates its own users, organizations, SSO configuration, policies and records through the APIs or explicit private fixtures, then cleans all rows, policies and objects in `finally`. Reuse fixture helpers, never seeded/demo records. After user erasure their routes are unobservable, so tests also query directly.

| Test | Covers |
|---|---|
| TC-PRIVACY-ENT-001 | Own user with MFA, recovery code, challenge, step-up session, lock and pending/resolved/hidden conflicts. Export omits secrets; erasure removes credentials and locks, reports each conflict `other_party` with earliest date, and returns all changed history records. Run cleanup with a controlled clock; only rows hidden for thirty days are physically removed. Another tenant's rows survive. |
| TC-PRIVACY-ENT-002 | Create own SCIM config/token and user via the lifecycle helper. Export includes matching provisioning logs. Seed logs matched only by identity id, only by external id, and a same-external-id log in another config; include soft-deleted/null-tenant identities. Erasure removes matching logs, identities, grants and deactivations, preserves the other user/config, and needs no aliases after commit. Agent-account erasure refuses before changes. |
| TC-PRIVACY-ENT-003 | Own customer, directly attributed process and order/deal-subject process through API helpers. Export includes only the direct one with `related_record_processes_not_searched`; erase retains it with no end date. The command with no policy refuses and changes nothing. Create an active 180-day apply policy, terminal backdated completed and failed processes, linked `COMPLETED` and `FAILED` workflows with context, steps, branch, event and task data, root run and delegated child/grandchild, both artifact-store objects. Preview changes nothing; apply deletes the entire graph and both objects, preserving recent failed, running/retrying/replaying and process-less trees. Refuse one graph and assert its locator stays, the outcome is incomplete and its cursor advances so a later eligible process is removed on continuation; a fresh pass retries the refused graph without resetting its age. Disable/fail the workflow service and assert no false completion and a remaining process locator; retry completes. Holds on the customer with and without an address both skip the whole set, including the order process. Cleanup every fixture and object in `finally`; no production storage required, use local/test drivers. |

Each erasure test checks exact retained evidence against its captured fixture ids and declared columns, plus a wrong-row control that must fail verification. TC-PRIVACY-ENT-001 includes configuration authorship and another user's released lock; 002 includes retained SCIM-token authorship and reuses `seedPrivacySsoUser` with TC-PRIVACY-VERIFY-006; 003 and G6’s TC-PRIVACY-VERIFY-010 share the Phase 3 delegated-tree/workflow/both-artifact fixture and check every retained process-tree section and derived evaluation-case row without excusing unrelated records. Both keep no-policy/no-end and related-process gap reporting, and both keep process-less trees explicitly outside `agent_orchestrator.processes`. No retained declaration permits an omitted secret or a missed credential row. Graph fixtures require the R4-8 flat workflow-owner evidence and the five-table `processes` mapping above, `user_tasks` included, with a process-linked graph whose metadata does not name the customer. Assert exact owner row ids/columns/reasons, no retained allowance for `deleted` entries and no allowance for undeclared tables/columns/reasons. Missing/incomplete evidence blocks both lanes. Normal A9 deletion remains a separate subscriber test, with null-tenant rows preserved and the exact TC-PRIVACY-VERIFY-006 controls listed in Phase 2, step 3.

## 📝 Risks & Impact Review

#### A customer's data stays in agent records
- **Scenario**: Under option A, an erased customer's details remain in runs, evaluation cases and traces.
- **Severity**: High
- **Affected area**: erasure completeness
- **Mitigation**: Reported as retained, with the date the tenant's policy gives or with no end date; past eligibility the retention set can delete the process, delegated run tree, workflow graph and stored objects; assumption 2 records why content is not cleared on erasure.
- **Residual risk**: Until the eligibility date the data remains, and holds/failures can extend it. No policy keeps process records indefinitely. Process-less Playground, evaluation replay and re-run trees keep input/output, traces and objects indefinitely; follow-up `AGENT-PROCESSLESS-RETENTION` belongs to the agent module. Evaluation cases stay until a person removes them. Indirect process content is not subject-exported and the section explicitly says so.

#### Age-based deletion removes audit records
- **Scenario**: The retention set deletes rows the module's rules call immutable, and someone later needs an old run.
- **Severity**: Medium
- **Affected area**: agent audit, core workflow events, metrics and evaluation history
- **Mitigation**: Whole rows of finished processes only, past a floor of 180 days that is twice the longest metrics window; rollups are their own rows; evaluation suites run on replay runs outside the set; holds are honoured or the set is skipped; the agent guide and workflow guide document their narrow whole-graph retention exceptions.
- **Residual risk**: A process older than the tenant's window can no longer be inspected. That is the purpose of the window.

#### Workflow cleanup cannot finish
- **Scenario**: A terminal process has a nonterminal or unavailable workflow graph, a retry or replay is in flight, or the owner service is not registered.
- **Severity**: High
- **Affected area**: workflow context, step/event/task copies and process retention
- **Mitigation**: Resolve the owner service through DI and lock/recheck its graph. R5-9 permits `COMPLETED`, `CANCELLED` and `FAILED` graphs past the policy window, but never running, retrying or replaying work. Refuse unsafe deletion, retain the process locator and advance past it so later candidates remain reachable; a fresh pass retries it. Assumption 10 records the whole-graph exception, which ships with the owner service. The fixed map takes only exact owner-reported surviving rows through the five-table `processes` declarations; `deleted` entries and unmapped tables grant no retained permission. `agentProcessRetention.test.ts` and TC-PRIVACY-ENT-003 cover failed-process eligibility, recent/in-flight controls, refusal progress, owner failure, mapping controls and retry.
- **Residual risk**: The graph remains with personal data until the dependency or state is repaired; the pass reports incomplete and never claims whole-process deletion.

#### A stored trace outlives its row
- **Scenario**: A run's offloaded payload stays in object storage after its row is gone.
- **Severity**: High
- **Affected area**: object storage
- **Mitigation**: Both artifact stores gain deletion; all transitive delegated runs are walked; each source row keeps its key until deletion succeeds. The process locator stays until the workflow owner commits; unit and integration tests cover graph and storage failures.
- **Residual risk**: An object whose delete keeps failing stays, still named by its row, and the next pass retries it.

#### A held customer's indirect process is removed
- **Scenario**: An order process contains a held customer's data but does not name their person id.
- **Severity**: High
- **Affected area**: agent and workflow legal-hold data
- **Mitigation**: `excludableSubjectKinds: []` skips every subject hold, including derived identifier references; tests cover a held customer's order and a customer without addresses.
- **Residual risk**: An explicit engine `allowUnmatchedHolds` opt-out permits unmatched data to expire; long holds delay the whole tenant's retention.

#### An administrator is left without a second factor
- **Scenario**: MFA and identities are deleted and the run then stops.
- **Severity**: High
- **Affected area**: the account being erased
- **Mitigation**: The pre-flight check; these classes run last; the account is locked first.
- **Residual risk**: A failure inside the credentials group; a re-run continues, with the account locked meanwhile.

#### A provider re-creates the user
- **Scenario**: The identity provider still lists the person and provisions them again.
- **Severity**: Medium
- **Affected area**: SSO tenants
- **Mitigation**: The docs; the dry run notes that the user is provisioned by SCIM.
- **Residual risk**: Outside the product.

#### A lock is deleted under someone's hands
- **Scenario**: The erased user held a lock at that moment.
- **Severity**: Low
- **Affected area**: one record
- **Mitigation**: The user is being removed; nobody else held it.
- **Residual risk**: None.

## Final Compliance Report — 2026-11-16

Pass-two review: cross-spec references and shared decisions checked against the merged workspace; runner: local, Python document checks only. Pass-three checks used C4’s current retained-row contract and G6’s named graph lane; no independent review was available. No implementation tests were run. Independent review could not launch because the collaboration service returned `no rollout found`; this revision was reviewed directly.

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, the enterprise, agent orchestrator, workflows, core and shared guide sections against code; no implementation validation was run.

| Rule | Status | Notes |
|---|---|---|
| Enterprise scope in the enterprise specs directory | Compliant | — |
| No cross-module table access | Compliant | Each class in its own module |
| The agent module's append-only rule | Compliant, with one documented exception | Erasure changes no row (assumption 2). The retention set deletes whole rows of finished processes past the window and updates none. Assumption 9 |
| Retention sets and holds | Compliant | `excludableSubjectKinds` declared; a hold the set cannot honour skips it with `hold_not_honourable`; runs only through the command or the engine |
| Tenant scoping | Compliant, with a stated rule | Rows with no tenant are matched by a tenant-checked user id |
| Integration coverage | Specified | Three self-contained tests, reusing helpers with owned fixture data and cleanup |
| R4-8 workflow evidence | Specified for the five mapped tables | Flat owner result, fixed `processes` mapping of R4-8's four tables plus `user_tasks` (assumption 11) and exact literal columns/reasons; `deleted` is never retained |
| R5-9 failed-process retention | Specified | `FAILED` graphs may be deleted after the policy window; running/retrying/replaying work stays. Refusal preserves the locator and incomplete outcome while advancing the cursor; unit and TC-PRIVACY-ENT-003 cases cover both progress and retry |

**Verdict:** Phases 1, 2 and 3 approved as a design. Phase 3 ships option A (assumption 2) with the period, append-only exception, workflow exception and `user_tasks` mapping of assumptions 8 to 11. It lands after the policy reader and the workflow owner service it depends on.

## Changelog

### 2026-11-16
- SSO subscriber checked: it matches zero rows rather than every row. The opening note and Phase 1 step 1 now state the verified behaviour.
- The opening note now says the subscriber must be fixed and points to the requirement in the program spec.
- Written autonomously with resolved assumptions.
- Revised after independent review. Credentials and identities are deleted last, behind a read-only check, because deleting them before the owner could refuse would leave a live administrator without a second factor. Matching SSO rows with no tenant by user id alone was unsafe and now depends on the owner's confirmation and the organization. The agent module is split in two: a class for staff users, which refuses an agent's account in pre-flight and revokes grants instead of deleting them, and a class for customers, whose default is now to retain and report — the first draft's list of content to clear missed evaluation cases, evidence, context bundles, artifacts and more, and the storage service cannot delete. Conflict rows are left, since they involve a second user. Tests use the SCIM and agent fixtures that exist. A characterization of the SSO subscriber comes first, because it may be deleting far more than intended today.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g3-06 — option A's retention period was a promise with no period, no default and no way to delete offloaded traces, and it would have deleted rows the module calls immutable while the spec said the module's rules were unchanged. Option A now has a defined set, `agent_orchestrator.processes`, that deletes a finished process whole with every row under it, past a tenant's policy window with a 180-day floor; no policy means nothing is deleted and the report says so (assumption 8). The module's guide gains one exception for that deletion (assumption 9). The trace store's `delete` and the keep-the-key-until-deleted rule moved from option B into option A. The set declares `excludableSubjectKinds` and skips on a hold it cannot honour. The rejected "delete agent runs" is reconciled: metrics read 90 days, rollups are their own rows, evaluation suites use replay runs outside the set. The problem statement now says the storage service can delete and only the trace store's type cannot. Coordinator follow-ups: the SSO row notes that the program's A9 fix hard-deletes a deleted user's identities, soft-deleted ones included; the classes table names each class's `erasureGroup` value, and the spec cites the erasure spec's normative `checkErasable` and `erasureGroup` instead of its addendum. Updated the TLDR, assumptions, problem statement, proposed solution, design decisions, alternatives, known limits, Delta, architecture, API contracts, edge cases, migration, phasing, plan, file list, TC-PRIVACY-ENT-003, risks and the compliance report.

- Council round two fixes (GPT-6.1 Sol workers): r6-03 and r6-22 — fail-closed agent hold skips including indirect orders and identifier references; r6-04 — workflow-owned graph deletion with assumption 10; r6-08 — transitive delegated runs; r6-15 — process-less indefinite retention and assigned follow-up; r6-23 — active-policy checks in every handler batch; r6-28 — config-scoped SCIM log matching before identity deletion; r6-29 — optional policy reader and honest eligibility dates; r6-32 — tenant-checked SSO user matching; r6-37 — both artifact stores; r6-38 — retained conflict reports and cleanup dates; r6-47 — cleanup characterization; g3-18 — qualified indirect export coverage; F-74 — append-only wording; r6-46 and R1 assignment nit — program-row correction requested from its owner.
- Council round two fixes, pass two (GPT-6.1 Sol workers): W02 — exact entity/log identities, dry-run history planning and the owner's two passes without snapshot-bearing cleanup; W14 — retained declarations and exact class/section/table/row/column/reason evidence, reusable owned SSO fixtures for A9 acceptance; policy-reader target/engine entry and workflow owner handoffs aligned; program A9 cascade and confirmed erasure null-tenant rules distinguished.
- Council round two fixes, pass three (GPT-6.1 Sol workers): cite C4’s owner `PrivacyRetainedRecord`, populate exact retained conflict/process-tree row evidence in separate retained sections, and keep evidence out of the completion event. Link Phase 3’s delegated-tree/workflow/both-artifact fixture to G6 TC-PRIVACY-VERIFY-010, preserving gap/no-end reporting and process-less exclusions; distinguish the specified workflow delete seam from its still-missing retained-evidence seam.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): consume content-ai's existing workflow graph read/delete contracts and closed-status safety, preserving process locators and exact-evidence gates; retain C4 type ownership and the existing SSO/TC-006 fixture controls, and identify the still-undesigned enterprise workflow retained mappings without adding declarations.
- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): R4-8 — consume the flat workflow privacy read result, map its four named tables to the existing `processes` section with exact retained columns and reasons, remove the stale envelope/mapping blocker, and align tests, risks and compliance; report the unassigned `user_tasks` retained-evidence design without adding it.
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): R5-9 — align terminal workflow graph deletion to include `FAILED` after the policy window, preserve running/retrying/replaying work, and advance past refused processes without claiming completion; add failed-process, refusal-progress and retry coverage to the unit and integration plan, risks and compliance.
