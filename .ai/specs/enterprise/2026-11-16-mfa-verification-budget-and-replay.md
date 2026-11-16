# MFA verification budget and TOTP replay protection

Status: implementation and regression coverage complete; full repository unit validation, review and QA pending.
Issue: [#9153](https://github.com/open-mercato/open-mercato/issues/9153).
Related: [enterprise MFA specification](implemented/SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa.md).

## TLDR

Apply the existing MFA attempt policy per tenant/user across challenges, temporarily lock verification at the limit, notify the account owner, and persist the last accepted TOTP step. Keep the existing verification API and startup/configuration contracts.

## Overview and Problem Statement

The MFA verification service needs account-level accounting and persistent proof consumption that remain consistent across requests and server instances. Challenge-local counters and stateless provider validation do not supply these invariants.

## Proposed Solution and Architecture

Before evaluating a provider proof, verify challenge ownership and enforcement policy. Inside one existing ORM transaction, acquire a nonblocking PostgreSQL advisory lock keyed by tenant and user, reload the challenge and factor, check the durable account state, evaluate the proof, and commit the attempt or acceptance. Contenders return the existing unsuccessful verification result without evaluating a proof or retaining a waiting connection.

Use the existing `mfa.maxAttempts` and `mfa.challengeTtlMs` policy. A new state starts a failure window lasting `challengeTtlMs`. Failures across challenges share the counter. Reaching `maxAttempts` sets a temporary lock lasting `challengeTtlMs` from that failure. Blocked requests neither extend the lock nor evaluate proofs. Expiry or successful verification resets the account budget. Existing per-challenge limits remain enforced. Provider validation errors count as failures and retain their original error behavior after the transaction commits; other provider failures roll back.

The TOTP provider records the absolute matched time step, including accepted clock skew, in factor metadata. It rejects counters at or below the persisted high-water mark, including the code consumed during enrollment confirmation. The service passes a detached provider record and persists accepted provider metadata together with challenge consumption, so failed evaluation or transaction rollback cannot consume a TOTP proof.

After committing a lock transition, emit `security.mfa.verification_locked`. A persistent subscriber uses the existing notification service and tenant-scoped user lookup. An idempotent notification group identifies the user and lock occurrence. In-app and email delivery use existing strategies and preferences; no codes, secrets, request payloads or challenges enter the notification. Delivery follows the platform's existing post-commit event guarantees and cannot undo the security state.

## Data Models

`MfaVerificationState` is module-owned internal state, with no user-editable CRUD surface or cross-module ORM relation:

| Column | Meaning |
| --- | --- |
| `id` | Generated UUID primary key |
| `tenant_id`, `user_id` | Unique account scope |
| `attempts` | Failed-verification count, default zero |
| `reset_at` | Failure-window end or lock expiry |
| `locked_until` | Nullable temporary lock expiry |
| `updated_at` | Existing ORM update timestamp convention |

`UserMfaMethod.providerMetadata.lastAcceptedTimeStep` is an additive provider-owned number. Existing metadata and the legacy secret representation remain supported.

## API Contracts

No route, request/response schema, exported signature, feature grant or DI key changes. Both login (`POST /api/security/mfa/verify`) and MFA-backed sudo (`POST /api/security/sudo/verify`) use the guarded service. Lockout and lock contention use its existing `false` result and generic rejection path. Recovery codes remain a separate existing recovery path.

The event and notification type `security.mfa.verification_locked` are additive. Existing events and notification identifiers remain unchanged.

## Migration & Backward Compatibility

The generated `Migration20261115235522_security` creates only `mfa_verification_states` and its tenant/user uniqueness constraint. The scoped generated snapshot includes that table. No backfill is needed: account state is created lazily and pre-existing TOTP factors acquire their accepted-step metadata on the next successful verification.

Apply the migration through the normal release process before deploying code that reads the new table. Complete the rollout to every serving replica before relying on the protection; earlier code does not enforce the new state. There are no new environment variables, dependencies, provider preconfiguration or startup commands. Existing ORM, database, event and notification mechanisms remain the architecture.

The authorized narrow `down` drops only the new internal state table. Roll back application code before schema rollback. Rollback discards temporary budgets and withdraws this protection; it preserves existing factors/challenges and accepted-step metadata. Do not use schema rollback as an account-unlock mechanism. No existing contract is removed, renamed or narrowed, so a deprecation bridge is unnecessary.

## Integration Coverage

Real PostgreSQL Jest coverage in `MfaVerificationService.postgres.test.ts` uses independent entity managers and a small pool. It executes the actual migration class up/down, checks scoped uniqueness and preservation of existing MFA records, and tests fresh-challenge budget persistence, lock expiry, proof replay, concurrent success/failure, unrelated-account liveness, wrong-owner rejection, tenant isolation, and transaction rollback after provider evaluation.

Unit coverage verifies both synchronous and asynchronous provider validation errors, configured thresholds, skewed TOTP counters and provider-instance replacement. Subscriber coverage verifies scoped recipients, invalid events, idempotent notification grouping and absence of proof variables.

The API fixture submits the next-window code for verification after enrollment, within the existing default one-step tolerance, so it uses a fresh proof without real-time sleeps; TC-SEC-014 now expects fresh challenges to remain locked after exhaustion. TC-SEC-003 preserves a successful OTP verification on a new unlocked fixture before exhausting its budget, then requires rejection of a fresh correct challenge; its scoped disposable API/browser run passed without skips. Existing login/sudo route suites cover the unchanged service call sites and rejection contracts. Manual QA must exercise both API paths with disposable accounts, plus the existing notification UI/email delivery and migration rollout/rollback. No rendering component changes; the scoped OTP run includes an inspected configured-methods-page screenshot, while broad manual QA remains pending.

## Risks & Impact Review

| Risk | Severity | Mitigation and residual limit |
| --- | --- | --- |
| Concurrent requests accept one proof twice or exceed the budget | High | Account transaction lock spans reload, evaluation and flush; independent-manager PostgreSQL contention tests |
| Notification delivery fails after state commit | Medium | Security state remains committed; persistent delivery and group deduplication use existing notification guarantees |
| Mixed-version deployment or premature schema rollback | High | Migration precedes patched code; finish all replicas; revert code before dropping the new table |
| Contending requests hold the connection pool | Medium | Nonblocking advisory acquisition returns without proof evaluation; small-pool unrelated-account test |
| Scope mix-up or proof material in alerts | High | Tenant/user state key and queries; recipient scope validation; alerts contain no proof material |

## Resolved assumptions

Reuse existing attempt/window settings rather than add operator knobs. Use ordinary module-local PostgreSQL persistence because the general cache contract has no atomic compare-and-set guarantee. Keep recovery-code behavior unchanged. Parent authorized the additive entity/migration and this uniquely scoped spec; manual QA remains required for the schema change.

## Final Compliance Report

Scoped migration generated with `yarn db:generate`; unrelated generated drift removed. No project database migration applied. Focused regressions (44/44), the full affected module suite (391 unit tests plus seven separately executed PostgreSQL cases), and configured gate evidence are recorded in the PR and [validation record](../../analysis/issue-9153/validation.md). All configured source checks and app build passed; the full repository unit command remains incomplete after its bounded retry. Deployment, independent approval and manual QA are not claimed by this document.

## Changelog

- 2026-11-16: Added account budget, transactional replay consumption, notification and additive migration design, compatibility/rollback instructions and integration coverage for #9153.

- 2026-11-16: Corrected the missed OTP email integration expectation after hosted CI; preserved positive verification and verified account lock persistence in an actual disposable API/browser run.
