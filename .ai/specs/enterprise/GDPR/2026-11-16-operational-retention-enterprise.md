# Operational retention for enterprise tables

> **Program:** split out of packages D1 and D2 of [`../../GDPR/2026-11-15-gdpr-ready-deployments-program.md`](../../GDPR/2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Depends on:** the shared helper from [`../../GDPR/2026-11-16-operational-retention-pruners.md`](../../GDPR/2026-11-16-operational-retention-pruners.md).
> **Code baseline:** Worktree snapshot `9e09023483`.

Extends: .ai/specs/GDPR/2026-11-16-operational-retention-pruners.md
Extends: .ai/specs/enterprise/implemented/SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa.md

## 📝 TLDR

Three enterprise tables grow without bound. Expired step-up ("sudo") sessions have a cleanup method that nothing calls, although the module's own spec says a scheduled job calls it. MFA challenges are never deleted at all. The SCIM provisioning log keeps every entry. **Proposed (future):** the security module deletes sudo sessions and MFA challenges a day after they expire, on an hourly schedule, and the SSO module can prune its provisioning log by age when an operator opts in.

**Not in this spec:** record-lock history, whose existing inline cleanup only soft-deletes rows and does not bound their physical retention; MFA methods and recovery codes, which are a user's data and belong to `2026-11-16-privacy-coverage-enterprise.md`, class `security.credentials`. This spec adds no record-lock purge.

## 📝 Overview

> **Market reference.** Keycloak expires authentication sessions and action tokens on a background timer, and Okta and Azure AD keep provisioning logs for a fixed, administrator-visible period. Adopted: expired step-up and challenge rows deleted on a schedule shortly after expiry; provisioning-log pruning by age only when an operator opts in. Rejected: inline cleanup on writes and pruning an audit-like provisioning log by default.

**Scope and ownership.** The `security` module owns `sudo_sessions` and `mfa_challenges` cleanup; the `sso` module owns `scim_provisioning_log`. Both consume the operational-pruners spec's shared helper, schedule expectations and history-mode bridge, and each prunes only its own tables. User credentials and record-lock history belong to other specs (see "Not in this spec").

## 📝 Resolved assumptions

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | SCIM log default | Disabled; the operator sets a window | It is a provisioning audit record. |
| 2 | Expired challenges and sessions | Deleted a day after expiry, from the first run, with no counting period | Nothing can use them after expiry; the day keeps the answer to a late verification unchanged. |
| 3 | Queues | Two new queues at concurrency 1, one per module | Two dedicated prune queues, `security-expired-prune` and `sso-scim-log-prune`, add two to the connection ceiling. Inventory all enabled queues with the parent's deployment budget gate; do not infer that they fit a default budget of twenty. |
| 4 | How existing installations get the schedules | A command in each module, `mercato security register-schedules` and `mercato sso register-schedules` | The upgrade-action list is a static array in core, and core cannot import enterprise code. |

## 📝 Problem Statement

- `SudoChallengeService.cleanupExpired()` deletes `sudo_sessions` whose `expires_at` has passed (`packages/enterprise/src/modules/security/services/SudoChallengeService.ts:565-569`). It has no caller; `SPEC-ENT-001` says it is "called by scheduled cleanup job".
- `mfa_challenges` has no delete anywhere in the security module (`packages/enterprise/src/modules/security/data/entities.ts:208`).
- `scim_provisioning_log` is written on every SCIM operation and never pruned; its tenant column is nullable and its index leads with the SSO configuration (`packages/enterprise/src/modules/sso/data/entities.ts:183-189`). It holds an external id in clear.
- Record-lock history is soft-deleted inline at fixed windows (`packages/enterprise/src/modules/record_locks/lib/recordLockService.ts:49-51, 1388-1437`), not physically purged, as the enterprise coverage spec's Problem Statement records. That path stays unchanged and is not counted as age-based erasure here.

## 📝 Proposed Solution

| Table | Eligible when | Default | Variable |
|---|---|---|---|
| `sudo_sessions` | Expired for more than | 1 day | `OM_SECURITY_SUDO_SESSION_RETENTION_DAYS` |
| `mfa_challenges` | Expired for more than | 1 day | `OM_SECURITY_MFA_CHALLENGE_RETENTION_DAYS` |
| `scim_provisioning_log` | Older than | Disabled | `OM_SSO_SCIM_LOG_RETENTION_DAYS` |

- The security module adds a prune handler that deletes both tables in bounded batches through the shared helper, with one system-scoped hourly cron schedule. The existing `cleanupExpired` method is one unbounded delete; it remains unchanged: expiry at `expiresAt <= now`, no grace, all matching rows deleted, full total returned. The worker uses a separate internal `pruneExpiredHistory` path with the configured one-day grace, batches and time budget. The worker never calls `cleanupExpired()`.
- A challenge is eligible on `expires_at` alone. Challenges live ten minutes, and a lockout sets `expires_at` to now, so the expiry test covers verified ones too.
- The day of grace matters: a verification that arrives late is told "expired" while the row exists and "not found" once it is gone.
- The SSO module adds a prune handler with a daily schedule. A positive window enables eligibility by `created_at`, but deletion additionally follows `OM_RETENTION_HISTORY_MODE`: unset counts only in the opt-in minor, explicit delete deletes immediately, unset after the flip deletes only after thirty days from its first count, and explicit report always counts only. This consumes DEC-H — The counting-period bridge from the parent spec, independently of B6's failed-job age bridge. An unset/zero window disables the path regardless of mode. Both workers use the parent's time-budgeted loop, statement timeout and immediate coalesced continuations; no daily fixed ceiling is added.
- Both register from `setup.ts` and from their own registration command.

| Alternative | Why rejected |
|---|---|
| Prune the SCIM log by default | An audit record; opt-in is the reversible choice. |
| Inline cleanup after writes, as record locks do | Never runs on an idle installation. |

## 📝 Delta

### Capability: operational-retention

#### MODIFIED Requirement: Expired step-up sessions and challenges
The system SHALL delete sudo sessions and MFA challenges once they have been expired for longer than the configured window.

##### Scenario: Expired past the window
- WHEN a sudo session or an MFA challenge expired longer ago than the window and the job runs
- THEN the row is gone and an active session is untouched

##### Scenario: Expired inside the window
- WHEN a challenge expired a minute ago
- THEN it is untouched

##### Scenario: Not yet expired
- WHEN a challenge or a session has not expired
- THEN it is untouched

Frozen by: `packages/enterprise/src/modules/security/__tests__/sudo-session-retention.characterization.test.ts`

#### ADDED Requirement: Provisioning log retention
The system SHALL select SCIM provisioning log entries older than a configured positive `created_at` window, count them under report mode and delete them only when the parent's effective history mode permits. It SHALL keep all entries when the window is unset or zero.

##### Scenario: Not configured
- WHEN no window is set
- THEN no entry is deleted

##### Scenario: Opt-in minor
- WHEN a positive window is set and history mode is unset in the opt-in minor
- THEN eligible entries are counted only, including null-tenant entries; the mode warning names the next minor's default

##### Scenario: Explicit delete
- WHEN a positive window and `OM_RETENTION_HISTORY_MODE=delete` are set
- THEN old entries are deleted and entries inside the window remain

##### Scenario: After the flip
- WHEN mode is unset after the flip
- THEN entries are counted for thirty days from the SCIM table's first count, with the table/date warning; after that they are deleted

##### Scenario: Explicit report
- WHEN history mode is report
- THEN old entries are counted only regardless of elapsed time

## 📝 Architecture

- `packages/enterprise/src/modules/security`: dedicated queue at concurrency 1, prune handler, registration in `setup.ts`, registration command.
- `packages/enterprise/src/modules/sso`: dedicated queue at concurrency 1, prune handler, registration in `setup.ts`, registration command.
- Each owner preserves its coverage/default-export members and adds `retentionSchedules` using the parent's “Enabled-handler schedule expectations”: security declares `{ key: 'security:expired-prune:system', queue: 'security-expired-prune', scopeType: 'system' }`; SSO declares `{ key: 'sso:scim-log-prune:system', queue: 'sso-scim-log-prune', scopeType: 'system' }`. Setup and CLI registration consume those exact constants and the parent's SHA-256 UUID algorithm with null tenant/organization. Enabled enterprise modules contribute through the shared collector; scheduler imports no enterprise package. Missing/disabled schedules remain distinct, and schedule presence proves no worker is live.
- Both consume the parent's named `parseRetentionWindow`, `pruneBatches` and `reportRetentionRun` exports from `packages/shared/src/lib/retention/prune.ts`. SSO also uses `resolveRetentionMode` and `recordRetentionFirstCount`, supplying its caller release default and a configs-service storage callback for `retention.operational.scim_provisioning_log.firstCountAt` under the parent's installation-scoped metadata convention. No enterprise code is imported into shared. The scheduler service is resolved by DI key and guarded by `hasRegistration`; neither module reads the other's tables.
- SCIM's history release waits for the parent's R3-2 — The registry carries the whole `privacy.ts` default export and DEC-I — The doctor's extension point dependencies. Its default flip additionally waits for R3-4 — An opt-in database tier for the doctor and the doctor-owned Phase 5 `pruners.unscheduled` count-service handoff. Enterprise handlers contribute their expected system schedule ids as data. The parent's `getOperationalRetentionWindows()` reports core windows only: this enterprise spec retains its own three window settings, parsed by their deleting owners, and neither imports enterprise defaults into shared nor claims the register already inventories them.

## 📝 Data Models

Additive indexes, created concurrently: `sudo_sessions (expires_at)`, `mfa_challenges (expires_at)` and `scim_provisioning_log (created_at)`, with the owning module snapshots. No new column or table. SCIM first-count metadata reuses the parent's existing `module_configs`/configs-service convention; it is not a tenant privacy limit under R3-3 — Tenant privacy settings live in `module_configs`.

## 📝 API Contracts

Three window settings plus the parent's `OM_RETENTION_HISTORY_MODE`, two schedule ids derived from the exact keys in Architecture, two registration commands. `SudoChallengeService.cleanupExpired(): Promise<number>` retains its existing immediate cutoff and all-rows count; the new worker path is separate. The settings are added to both `.env.example` files. No route is added.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Module disabled by its enterprise flag | Nothing registers; nothing is pruned |
| Scheduler absent | Same |
| A challenge or sudo session that expired minutes ago | Kept for the window, so a late verification still gets the "expired" answer |
| SCIM entry with no tenant | Counted or deleted by the same age and effective history mode as tenant entries |
| Positive SCIM window but history report mode | Counts only; a window alone does not authorize deletion |
| Direct `cleanupExpired()` call | Deletes all sessions expired at or before now with no grace; returns total, as today |

## 📝 Migration & Backward Compatibility

Additive settings and schedules. After the grace window a late verification is told "not found" instead of "expired"; within it nothing a user can observe changes. `UPGRADE_NOTES.md` names the two registration commands, the settings and `OM_RETENTION_HISTORY_MODE`. A configured SCIM window alone does not delete in the opt-in minor: explicit delete opts in immediately; after the flip an unset mode waits thirty days from the table's first count; explicit report stays the opt-out. `cleanupExpired` callers keep their current cutoff and total. No published method is redirected to the worker's grace/budget path.

## 📋 Implementation Plan

1. **Characterize** that an expired sudo session and an expired challenge persist today. Commit alone.
2. Index migrations.
3. Security: separate worker path, dedicated queue, registration and command; `sudo-session-retention.test.ts` with a fake clock for grace boundaries. `SudoChallengeService.cleanupExpired.test.ts` characterizes and preserves immediate expiry including equality, mixed rows, multiple batches worth of expired rows and the full count; ship TC-SEC-RETENTION-001.
4. SSO: dedicated queue, handler, registration and command; `scim-retention.test.ts` for unset/zero window, report/delete, both release defaults, inside/outside counting period, warning/date, missing configs service and bounded continuations. Pin the parent's named helper imports and SCIM's own release default; declare each enterprise schedule in its owner's `retentionSchedules` and test registration/expectation id parity and disabled-row preservation, without a copied scheduler id list or foreign table reads. Ship TC-SSO-RETENTION-001 in the same change; its history default cannot flip before the parent diagnostic/count-service gate.
5. Both `.env.example` files; `UPGRADE_NOTES.md`.
6. Archive the Delta if the capabilities directory has been adopted by then.

| File | Action |
|---|---|
| `packages/enterprise/src/modules/security/{workers/*,setup.ts,privacy.ts,migrations/*}` | Create / modify; preserve coverage members and add own schedule declaration |
| `packages/enterprise/src/modules/sso/{workers/*,setup.ts,privacy.ts,migrations/*}` | Create / modify; preserve coverage members and add own schedule declaration |
| `packages/enterprise/src/modules/{security,sso}/cli.ts` | Create / modify — registration commands |
| `packages/enterprise/src/modules/security/services/SudoChallengeService.ts` and `__tests__/SudoChallengeService.cleanupExpired.test.ts` | Preserve public method; characterize behaviour |
| `packages/enterprise/src/modules/security/__integration__/TC-SEC-RETENTION-001.spec.ts` | Create |
| `packages/enterprise/src/modules/sso/__integration__/TC-SSO-RETENTION-001.spec.ts` | Create |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-SEC-RETENTION-001 | In-process worker with injected clock/window deletes own sudo/challenge fixtures beyond grace and keeps active/recently expired rows; run twice for idempotency; own active sudo session still authorizes a protected action; direct cleanupExpired separately proves immediate cutoff and full count |
| TC-SSO-RETENTION-001 | In-process handler with injected window, clock and mode: old tenant and null-tenant fixtures survive report, opt-in unset and flipped counting period; explicit delete and flipped post-period delete them, recent fixtures remain; unset/zero window keeps all; repeat idempotent |

Both integration tests create their own scopes and rows, restrict the handler's test adapter to fixture ids, and remove all fixtures, first-count configuration and continuation jobs in `finally`. They use real database deletes with injected configuration; no seeded data, environment-mode limit or unrelated row deletion is permitted.

## 📝 Risks & Impact Review

#### A challenge in use is deleted
- **Scenario**: The predicate treats an in-flight challenge as finished.
- **Severity**: Medium
- **Affected area**: MFA verification
- **Mitigation**: Only rows expired for more than a day; unit tests for a row that has not expired and one inside the window.
- **Residual risk**: Low.

#### Provisioning evidence is lost
- **Scenario**: An operator sets a short window and later needs the log.
- **Severity**: Medium
- **Affected area**: SCIM audit view
- **Mitigation**: Disabled window by default; positive window still follows history mode and its release bridge. Explicit delete opts in immediately, so the upgrade note says the thirty-day default counting period is bypassed by that explicit choice.
- **Residual risk**: The operator's choice.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/queue/AGENTS.md` (MUST rules). Not reviewed: the enterprise module guides.

| Rule | Status | Notes |
|---|---|---|
| Enterprise scope in the enterprise specs directory | Compliant | — |
| Background work through the worker contract | Compliant | — |
| No cross-module table access | Compliant | Each module prunes its own tables |
| Integration coverage | Compliant design | Both handlers ship self-contained, in-process real-database tests |
| Stable service behaviour | Compliant design | cleanupExpired cutoff and total unchanged; worker has its own method |

**Verdict:** design approved; implementation depends on the parent helper and its edition decision, and the history mode/doctor release gates apply to SCIM.
## Changelog

- 2026-11-16 — Initial specification.
