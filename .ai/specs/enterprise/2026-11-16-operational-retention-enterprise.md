# Operational retention for enterprise tables

> **Program:** split out of packages D1 and D2 of [`../2026-11-15-gdpr-ready-deployments-program.md`](../2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Depends on:** the shared helper from [`../2026-11-16-operational-retention-pruners.md`](../2026-11-16-operational-retention-pruners.md).
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-16-operational-retention-pruners.md
Extends: .ai/specs/enterprise/implemented/SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa.md

## 📝 TLDR

Three enterprise tables grow without bound. Expired step-up ("sudo") sessions have a cleanup method that nothing calls, although the module's own spec says a scheduled job calls it. MFA challenges are never deleted at all. The SCIM provisioning log keeps every entry. **Proposed (future):** the security module deletes sudo sessions and MFA challenges a day after they expire, on an hourly schedule, and the SSO module can prune its provisioning log by age when an operator opts in.

**Not in this spec:** record-lock history, which already cleans itself; MFA methods and recovery codes, which are a user's data and belong to the enterprise coverage spec.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | SCIM log default | Disabled; the operator sets a window | It is a provisioning audit record. |
| 2 | Expired challenges and sessions | Deleted a day after expiry, from the first run, with no counting period | Nothing can use them after expiry; the day keeps the answer to a late verification unchanged. |
| 3 | Queues | Two new queues at concurrency 1, one per module | Neither `security` nor `sso` has a worker today. Two connections against the default budget of twenty. |
| 4 | How existing installations get the schedules | A command in each module, `mercato security register-schedules` and `mercato sso register-schedules` | The upgrade-action list is a static array in core, and core cannot import enterprise code. |

## 📝 Problem Statement

- `SudoChallengeService.cleanupExpired()` deletes `sudo_sessions` whose `expires_at` has passed (`packages/enterprise/src/modules/security/services/SudoChallengeService.ts:565-569`). It has no caller; `SPEC-ENT-001` says it is "called by scheduled cleanup job".
- `mfa_challenges` has no delete anywhere in the security module (`packages/enterprise/src/modules/security/data/entities.ts:208`).
- `scim_provisioning_log` is written on every SCIM operation and never pruned; its tenant column is nullable and its index leads with the SSO configuration (`packages/enterprise/src/modules/sso/data/entities.ts:183-189`). It holds an external id in clear.
- Record-lock history is cleaned inline at fixed windows (`packages/enterprise/src/modules/record_locks/lib/recordLockService.ts:49-51, 1388-1437`) and is left as it is.

## 📝 Proposed Solution

| Table | Eligible when | Default | Variable |
|---|---|---|---|
| `sudo_sessions` | Expired for more than | 1 day | `OM_SECURITY_SUDO_SESSION_RETENTION_DAYS` |
| `mfa_challenges` | Expired for more than | 1 day | `OM_SECURITY_MFA_CHALLENGE_RETENTION_DAYS` |
| `scim_provisioning_log` | Older than | Disabled | `OM_SSO_SCIM_LOG_RETENTION_DAYS` |

- The security module adds a prune handler that deletes both tables in bounded batches through the shared helper, with one system-scoped hourly cron schedule. The existing `cleanupExpired` method is one unbounded delete; it is kept and delegates to the same batched path.
- A challenge is eligible on `expires_at` alone. Challenges live ten minutes, and a lockout sets `expires_at` to now, so the expiry test covers verified ones too.
- The day of grace matters: a verification that arrives late is told "expired" while the row exists and "not found" once it is gone.
- The SSO module adds a prune handler with a daily schedule; it follows the shared helper's history mode.
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
The system SHALL delete SCIM provisioning log entries older than a configured window, and SHALL keep all of them when no window is set.

##### Scenario: Not configured
- WHEN no window is set
- THEN no entry is deleted

## 📝 Architecture

- `packages/enterprise/src/modules/security`: queue, prune handler, registration in `setup.ts`, registration command.
- `packages/enterprise/src/modules/sso`: queue, prune handler, registration in `setup.ts`, registration command.
- Both use `packages/shared/src/lib/retention/prune.ts` and the scheduler service resolved by DI key and guarded by `hasRegistration`. Neither module reads the other's tables.

## 📝 Data Models

Additive indexes, created concurrently: `sudo_sessions (expires_at)`, `mfa_challenges (expires_at)` and `scim_provisioning_log (created_at)`. No other change.

## 📝 API Contracts

Three settings, two schedule ids, two registration commands. The settings are added to both `.env.example` files. No route or type.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Module disabled by its enterprise flag | Nothing registers; nothing is pruned |
| Scheduler absent | Same |
| A challenge or sudo session that expired minutes ago | Kept for the window, so a late verification still gets the "expired" answer |
| SCIM entry with no tenant | Pruned by age like any other |

## 📝 Migration & Backward Compatibility

Additive settings and schedules. After the grace window a late verification is told "not found" instead of "expired"; within it nothing a user can observe changes. `UPGRADE_NOTES.md` names the two registration commands and the settings.

## 📋 Implementation Plan

1. **Characterize** that an expired sudo session and an expired challenge persist today. Commit alone.
2. Index migrations.
3. Security: queue, handler, registration, the registration command; unit tests with a fake clock for rows inside the grace window, past it, and not yet expired.
4. SSO: queue, handler, registration, the registration command; unit tests for unset, `0` and a window.
5. Integration test; both `.env.example` files; `UPGRADE_NOTES.md`.
6. Archive the Delta if the capabilities directory has been adopted by then.

| File | Action |
|---|---|
| `packages/enterprise/src/modules/security/{workers/*,setup.ts,migrations/*}` | Create / modify |
| `packages/enterprise/src/modules/sso/{workers/*,setup.ts,migrations/*}` | Create / modify |
| `packages/enterprise/src/modules/{security,sso}/cli.ts` | Create / modify — registration commands |
| `packages/enterprise/src/modules/security/__integration__/TC-SEC-RETENTION-001.spec.ts` | Create |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-SEC-RETENTION-001 | In the enterprise test environment, a sudo session and an MFA challenge inserted and backdated past the grace window are deleted when the handler is called in process; the test's own active sudo session still authorizes a protected action |

SCIM log pruning is unit-tested, because its default is disabled and the window comes from the running app's environment.

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
- **Mitigation**: Disabled by default; the counting period of the shared helper applies once enabled.
- **Residual risk**: The operator's choice.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/queue/AGENTS.md` (MUST rules). Not reviewed: the enterprise module guides.

| Rule | Status | Notes |
|---|---|---|
| Enterprise scope in the enterprise specs directory | Compliant | — |
| Background work through the worker contract | Compliant | — |
| No cross-module table access | Compliant | Each module prunes its own tables |
| Integration coverage | Partly | One test; the SCIM path is unit-tested for the reason given |

**Verdict:** approved for implementation.

## Changelog

### 2026-11-16
- Written autonomously, split out of the operational pruner spec after its review.
- Revised after independent review: upgrade actions cannot reach enterprise code, so each module gets a registration command; two new queues stated; the challenge predicate reduced to expiry; a day of grace added for sudo sessions because a late verification's answer changes once the row is gone; batching and an index added for sudo sessions.
