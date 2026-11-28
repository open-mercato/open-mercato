# Privacy coverage: enterprise modules

> **Tracker:** open-mercato/open-mercato#8593
> **Program:** [program](../../GDPR/2026-11-15-gdpr-ready-deployments-program.md)
> **Edition:** Enterprise
> **GDPR basis:** Art. 5(1)(c), 5(1)(e), 15, 17, 32

## TLDR

**Key points:**
- Data classes for `sso`, `security`, `record_locks` and `agent_orchestrator`, so the Enterprise [privacy module](2026-11-16-privacy-dsr-engine.md) exports and erases what they hold about a staff user or a customer.
- Age bounds for their operational tables: MFA challenges and step-up sessions, the SCIM provisioning log, record-lock history, agent runs and processes.

**Scope:**
- One `privacy.ts` declaration and one handler (`lib/privacy.ts`, registered in `di.ts`) per module, under the [contract](../../GDPR/2026-11-16-privacy-data-class-contract.md).
- `security` deletes a user's MFA rows on ordinary user deletion (new subscriber).
- Module-owned prune workers, following the [OSS retention pruners](../../GDPR/2026-11-16-operational-retention-pruners.md) pattern.

**Concerns:**
- Agent rows are append-only by module rule; this spec adds one exception: whole rows may be deleted, never edited.

## Overview

The OSS [coverage spec](../../GDPR/2026-11-16-privacy-coverage.md) covers every OSS module. These four enterprise modules hold person data the OSS run never sees. The `sso` cleanup subscriber reads `payload.userId`, while `auth.user.deleted` carries `id`; that fix is in the OSS coverage spec's Phase 1 and this spec relies on it for ordinary deletes without repeating it.

## Problem Statement

| Module | Holds about a person | Today |
|---|---|---|
| `sso` | Identities (IdP subject, e-mail, name, groups, external id), role grants, deactivations; SCIM log with external ids. `tenant_id` nullable on all four tables | Cleanup subscriber reads `payload.userId` (`sso/subscribers/user-deleted-cleanup.ts:11-33`) but the auth delete emits `id` (`auth/commands/users.ts:1173-1180`), so it never matches; when fixed it only soft-deletes identities, keeping e-mail and name. SCIM log never pruned |
| `security` | MFA methods (TOTP secret, label, provider metadata such as the e-mail for e-mail codes), recovery-code hashes, challenges, step-up (sudo) sessions with their token | No `auth.user.deleted` subscriber: every row survives user deletion. `mfa_challenges` are never deleted; `SudoChallengeService.cleanupExpired()` has no caller (`security/services/SudoChallengeService.ts:565-569`) |
| `record_locks` | Locking user, `locked_by_ip`, releasing user; conflicts naming two users | Inline cleanup soft-deletes after 3 days (locks), 7 days (resolved) and 1 day (pending conflicts) (`record_locks/lib/recordLockService.ts:48-51, 1396-1437`), only when a tenant has lock activity; rows are never removed |
| `agent_orchestrator` | Process input, subject label/title/facets; run input/output; span attributes; tool-call summaries; context bundles; proposals; corrections; evaluation cases copied from runs; run artifacts and stored objects; the process input copied into a core workflow instance (`workers/process-execution-starter.ts:194-200`) | Rows are append-only (`agent_orchestrator/AGENTS.md:169`). Trace-content retention deletes stored trace objects by the tenant's `retentionDays` (`lib/trace/contentRetention.ts:178`) but leaves every row. Nothing ends a run or a process |

## Proposed Solution

### Classes

| Class | Subject kinds | Tables | Mode | Erase | Export (no secrets) |
|---|---|---|---|---|---|
| `sso.identities` | `auth:user` | `sso_identities`, `sso_role_grants`, `sso_user_deactivations`, `scim_provisioning_log` | delete | The user's identities (soft-deleted ones too), role grants and deactivations; SCIM log rows whose `resource_id` is one of those identities or whose `scim_external_id` equals their `external_id` within the same `sso_config_id` | Provider, IdP subject, e-mail, name, groups, external id, provisioning method, login dates; granted roles; deactivation dates |
| `security.mfa` | `auth:user` | `user_mfa_methods`, `mfa_recovery_codes`, `mfa_challenges`, `sudo_sessions` | delete | Every row of the user | Method type, label, e-mail of an e-mail method, created and last-used dates; number of unused recovery codes |
| `record_locks.locks` | `auth:user` | `record_locks`, `record_lock_conflicts` | delete | Locks held by the user (`locked_by_user_id`). Conflicts naming the user and another user are `retained` / `other_party`, `retainedUntil` = the age bound below | Locked resource kind/id, times, IP |
| `agent_orchestrator.runs` | `customers:person` | `process_instances`, `agent_runs`, `agent_spans`, `agent_tool_calls`, `agent_context_bundles`, `agent_guardrail_checks`, `agent_proposals`, `agent_corrections`, `agent_run_sessions`, `agent_run_artifacts`, `agent_eval_cases`, `agent_eval_case_runs`, `agent_eval_results` | delete | Processes whose `source_entity_id` or `subject_id` equals the subject's id, and everything under them (below). A running process is `retained` / `open_case` (retry later) | Process dates, agent, outcome, input, label/title; runs' input/output; proposals; corrections |
| `agent_orchestrator.delegations` | `auth:user` | `agent_delegation_grants` | delete | Grants the user gave (`delegator_user_id`). Throws when the user is an agent's own account (`agent_principals.user_id`), which refuses the run | Agent, scopes, dates |

**Matching.** SSO tables may hold `tenant_id` null: rows match by `user_id` (a globally unique id) after the auth root has confirmed the user is in the request's tenant; a non-null `tenant_id` must equal the scope. Agent processes match by id value: subject ids are UUIDs, so no type mapping is needed. Processes about the customer's deal, order or claim do not carry the person's id and are not found; the age bound ends them.

**Process tree** (erasure and pruning alike): the process, its runs and their delegated child runs (`parent_run_id`, transitively), spans, tool calls, context bundles, guardrail checks, proposals, corrections, sessions, run artifacts with their stored objects (artifact and payload keys), evaluation case runs and results of those runs, evaluation cases whose `source_id` is one of those runs or corrections, and the linked core workflow instance (`process_instances.workflow_instance_id`) through the workflows module's terminal-instance deletion in the OSS coverage spec. A stored object or workflow instance that cannot be deleted fails the class, so the run reports it and a re-run retries.

**Staff ids stay ids.** Who triggered, was assigned, corrected or decided (`assignee_user_id`, `corrected_by_user_id`, `disposition_by`, `created_by`, `enforced_by`, `configured_by`) remain as ids; the user row they point to is gone.

**Rules for every handler** (from the contract): own tables only, `findWithDecryption` reads, every query carries `tenant_id` (+ `organization_id = X or null` when an organization is given), idempotent, and `touched` lists every deleted row as `<module>:<entity>` + id so the privacy run strips history, removes index entries and invalidates caches once.

**Exempt tables** (`exemptTables`): `sso_configs`, `scim_tokens`, `mfa_enforcement_policies`, `sudo_challenge_configs` — configuration and integration credentials holding staff ids only; `agent_principals` — agent service accounts, not people; `agent_settings`, `agent_guardrail_sets`, `agent_eval_assertions`, `process_definitions` — configuration; `agent_eval_suite_runs`, `agent_metric_rollups` — aggregates with no per-person content.

### Ordinary user deletion

`security` adds a persistent `auth.user.deleted` subscriber (`security:user-deleted-cleanup`) that reads `id` and `tenantId` and deletes the user's MFA methods, recovery codes, challenges and sudo sessions. Idempotent. The `sso` subscriber fix stays in the OSS coverage spec.

### Age bounds

| Table(s) | Deleted when | Default | Setting (`0` keeps) | Worker |
|---|---|---|---|---|
| `mfa_challenges`, `sudo_sessions` | `expires_at` older than | 1 day | `OM_SECURITY_EXPIRED_RETENTION_DAYS` | `security:expired-prune`, hourly |
| `scim_provisioning_log` | `created_at` older than (null-tenant rows too) | 90 days | `OM_SSO_SCIM_LOG_RETENTION_DAYS` | `sso:scim-log-prune`, daily |
| `record_locks`, `record_lock_conflicts` | soft-deleted longer than | 30 days | `OM_RECORD_LOCKS_HISTORY_RETENTION_DAYS` | `record_locks:history-prune`, daily; first runs the existing soft-delete step for every tenant, so idle tenants are covered |
| Process trees and process-less run trees | process `completed_at` / terminal run `completed_at` older than | 365 days | `OM_AGENT_ORCHESTRATOR_RETENTION_DAYS` | `agent_orchestrator:record-prune`, daily |

- The day of grace on challenges and sudo sessions keeps a late verification's "expired" answer; `cleanupExpired()` stays as it is.
- The agent bound is the class's `pruneExpired(scope, olderThan, opts)`, called by the module worker and by the privacy module's tenant purge. It deletes whole process trees as defined above, never a part of one. Evaluation cases a person approved are kept unless their source run is deleted.
- **AI Act.** If a deployment uses agents in a high-risk AI system (Annex III), Art. 19(1) and 26(6) of Regulation (EU) 2024/1689 require keeping its logs for at least six months; the default 365 days satisfies that, and the docs warn not to set fewer than 183 days in that case. No obligation applies otherwise.
- Workers use bounded batches and a time budget, schedules are registered in each module's `setup.ts` `seedDefaults` (scheduler upsert), all system-scoped.

### Design decisions

| Decision | Rationale |
|---|---|
| Delete credentials and identities outright | Soft deletion leaves the secret, e-mail and name in the table. |
| Delete agent process trees on erasure | Person data copied into a dozen agent tables cannot be partially cleared; whole-row deletion keeps the append-only rule's intent (no edited rows). |
| Default bounds instead of tenant settings | These are operational logs; a fixed, overridable installation default bounds them from day one, like the OSS pruners. |
| Conflicts retained, bounded by age | A conflict is also the other user's record. |

## Architecture

Per module: `privacy.ts` (default export `PrivacyModuleDeclaration`), `lib/privacy.ts` (handler), `di.ts` registration, `workers/<name>.ts`, `setup.ts` schedule. `security/subscribers/user-deleted-cleanup.ts`. No module reads another's tables; the agent class deletes the workflow instance through the workflows service.

## Data Models

No new table or column. Additive indexes, with each module's snapshot: `mfa_challenges (expires_at)`, `sudo_sessions (expires_at)`, `scim_provisioning_log (created_at)`, `record_locks (deleted_at)`, `record_lock_conflicts (deleted_at)`, `process_instances (tenant_id, completed_at)`, `agent_runs (tenant_id, completed_at)`.

## API Contracts

- DI handler keys: `ssoPrivacyHandler`, `securityPrivacyHandler`, `recordLocksPrivacyHandler`, `agentOrchestratorPrivacyHandler`, `agentDelegationsPrivacyHandler`.
- Subscriber `security:user-deleted-cleanup` on `auth.user.deleted` (persistent).
- Env settings in the table above, added to both `.env.example` files.
- No route, event or feature added.

## Migration & Compatibility

- `UPGRADE_NOTES.md`: "Enterprise now deletes expired MFA challenges and sudo sessions after 1 day, SCIM log entries after 90 days, hidden record-lock history after 30 days and finished agent processes/runs after 365 days; set the `OM_*_RETENTION_DAYS` variable to `0` to keep."
- `BACKWARD_COMPATIBILITY.md`: no contract surface changes; `agent_orchestrator/AGENTS.md` rule 9 gains "whole rows may be deleted by retention or erasure, never updated".

## Risks & Impact Review

#### An IdP re-provisions an erased user
- **Scenario**: The person still exists at the identity provider; the next SCIM sync or SSO login recreates the account.
- **Severity**: Medium
- **Affected area**: `sso`, `auth`.
- **Mitigation**: Deployment docs: deprovision at the IdP before erasing; the erasure report lists the SSO configuration.
- **Residual risk**: Depends on the controller's IdP process.

#### Agent evidence deleted too early
- **Scenario**: A high-risk AI deployment sets the agent bound below six months.
- **Severity**: Medium
- **Affected area**: `agent_orchestrator`.
- **Mitigation**: Default 365 days; docs warning; `0` keeps.
- **Residual risk**: Operator configuration.

#### Part of a process tree survives
- **Scenario**: A stored object or the workflow instance cannot be deleted.
- **Severity**: Medium
- **Affected area**: Agent records, core workflows.
- **Mitigation**: The class fails, the run reports it, a re-run retries the idempotent delete.
- **Residual risk**: Storage outage delays erasure.

#### Processes about a customer's other records are not found
- **Scenario**: A process about the person's order names only the order.
- **Severity**: Low
- **Affected area**: `agent_orchestrator`.
- **Mitigation**: Age bound ends it; stated in the report's known limits.
- **Residual risk**: Kept up to the bound.

## Implementation Plan

### Phase 1: security
1. `security.mfa` class and handler; unit tests: export has no secret, erase removes every table's rows, another user untouched.
2. `auth.user.deleted` subscriber; TC-SEC-PRIV-003.
3. Index migration, `security:expired-prune` worker and schedule; pg test for the 1-day boundary.

### Phase 2: sso
1. `sso.identities` class and handler, null-tenant matching; TC-SSO-PRIV-001.
2. Index migration, `sso:scim-log-prune` worker; pg test for the window and `0`.

### Phase 3: record_locks
1. `record_locks.locks` class; TC-RL-PRIV-001.
2. Index migration, `record_locks:history-prune` worker; pg test for soft-delete then physical removal.

### Phase 4: agent_orchestrator
1. Process-tree deleter (shared by erase and prune) with stored objects and workflow instance; unit test over a tree with a grandchild run.
2. `agent_orchestrator.runs` and `.delegations` classes; TC-AGENT-PRIV-001/002.
3. `pruneExpired`, index migration, `agent_orchestrator:record-prune` worker; pg test.
4. `agent_orchestrator/AGENTS.md` rule 9 exception; `.env.example` and `UPGRADE_NOTES.md`.

## Integration Coverage

All tests create their own users, locks and processes through API fixtures and clean up in `finally`.

| Test | Asserts |
|---|---|
| TC-SEC-PRIV-001 | Export of a staff user with a TOTP method lists type and label, never the secret |
| TC-SEC-PRIV-002 | Privacy erasure of a staff user removes MFA methods, codes, challenges and sudo sessions |
| TC-SEC-PRIV-003 | Ordinary staff-user delete removes the user's MFA rows |
| TC-SSO-PRIV-001 | Erasing a SCIM-provisioned user removes identity, grants, deactivations and that identity's SCIM log rows; another user's rows remain |
| TC-RL-PRIV-001 | Erasing a user removes their locks; a conflict with another user is retained and reported `other_party` |
| TC-AGENT-PRIV-001 | Erasing a person removes the process whose source is the person with its runs, proposals and artifacts; a running process is reported `open_case` and kept |
| TC-AGENT-PRIV-002 | Erasing a staff user removes the grants they gave; erasing an agent's own account is refused with nothing changed |

## Final Compliance Report — 2026-11-20

### AGENTS.md Files Reviewed
- `AGENTS.md`, `packages/core/AGENTS.md`, `packages/queue/AGENTS.md`, `packages/events/AGENTS.md`, `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Tenant/organization scoping | Compliant | Null-tenant SSO rows matched only after the auth tenant check |
| root AGENTS.md | No cross-module ORM access | Compliant | Workflow instance deleted through the workflows service |
| root AGENTS.md | `findWithDecryption` for reads | Compliant | All handler reads |
| packages/events | Persistent subscribers idempotent | Compliant | `security:user-deleted-cleanup` |
| agent_orchestrator AGENTS.md | Append-only rows | Amended | Whole-row deletion only, documented in rule 9 |

### Verdict
Compliant — ready once the OSS contract and the privacy module land.

## Changelog
### 2026-11-20
- Rewritten to minimal GDPR scope.
