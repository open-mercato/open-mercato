# Command audit sensitive-data redaction

## TLDR

OpenMercato must never persist raw passwords, tokens, API keys or similar secrets in command audit records. The MIT Core command path will detect secret-bearing input, disable undo and redo for that execution, remove the raw redo input, redact sensitive fields from every audit payload, and repeat the sanitization inside `ActionLogService` as defense in depth.

Historical plaintext rows will be sanitized by an idempotent SQL migration. Encrypted rows require the application encryption service, so an idempotent audit-log CLI command will decrypt, sanitize and re-encrypt them in bounded batches.

This is one capability: credential-safe command history. Prevention and historical cleanup ship together because leaving either side open leaves recoverable secrets in the same audit store.

## Overview

`CommandBus.persistLog()` currently wraps the effective command input as `command_payload.__redoInput` for every logged command. This preserves generic redo, but it also persists raw fields such as `password`, `currentPassword`, `newPassword`, `token` and `credentials`. The audit encryption map reduces exposure at rest when encryption is healthy, but it does not satisfy the stronger rule that raw credentials must never enter audit storage.

The design follows the [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html), which identifies authentication passwords, access tokens, encryption keys and primary secrets as data that should be removed, masked, sanitized, hashed or encrypted rather than recorded directly. It also follows the established parameter-filtering pattern documented by [Ruby on Rails](https://guides.rubyonrails.org/action_controller_advanced_topics.html#parameters-filtering): filter common secret key families centrally instead of relying on every call site.

## Problem Statement

The current implementation has four failure paths:

1. `CommandBus` always persists the complete command input under `__redoInput` when a command produces an action log.
2. A command can place secrets in `payload`, `snapshotBefore`, `snapshotAfter`, `changes` or `context`, even if its input is safe.
3. `ActionLogService.log()` accepts direct callers that do not pass through `CommandBus`.
4. Existing databases may already contain raw secrets. Some rows are plaintext JSONB and some contain whole-field AES-GCM ciphertext.

Confirmed affected commands include Core `auth.users.create`, Core `auth.users.update`, Enterprise `security.password.change`, checkout password commands and any third-party command whose logged input uses a recognized secret field.

## Proposed Solution

### Central redaction contract

Add a shared, pure redaction utility under `packages/shared/src/lib/commands/`.

The utility recursively inspects object keys after lowercasing and removing punctuation. It treats keys ending in these families as sensitive:

- `password` and `passphrase`;
- `secret`;
- `token`;
- `apiKey` and `privateKey`;
- `recoveryCode`;
- `credentials`;
- `authorization` and `cookie`;
- `otp` and `otpSeed`.

Sensitive values are replaced with the constant marker `[REDACTED]`. Arrays and nested objects are traversed. Key paths such as `credentials.apiKey` are covered because punctuation is removed before matching.

`passwordHash`, `tokenHash`, lookup hashes, identifiers, expiry timestamps and counts are not matched. They are not raw credentials, and existing user delete undo needs the stored password verifier to restore a hard-deleted account. This point removes raw credentials, not all credential-derived state. Hash removal requires a separate redesign of user deletion and is not bundled here.

### Explicit command signal

Add optional `sensitiveInput?: boolean` to `CommandLogMetadata`.

- The automatic detector always wins and cannot be disabled.
- A handler sets `sensitiveInput: true` when a secret is carried under a generic field name that the detector cannot infer.
- Core user create/update and Enterprise password-change logs set the flag explicitly when appropriate.
- The field controls history behavior and is never persisted.

This is an additive public type change. Existing handlers compile and keep current behavior for non-sensitive commands.

### Command history behavior

For a sensitive execution:

1. Do not mint or persist an undo token.
2. Do not persist `__redoInput`, even in redacted form.
3. Keep safe business metadata and redacted snapshots for audit visibility.
4. Add `__redoUnavailable: "sensitive-data-redacted"` to the command payload.
5. Make the redo route reject this marker before considering any update fallback.

Disabling undo together with redo is intentional. A generic undo handler can depend on a removed credential or credential-derived transition, so presenting it as reversible would be unsafe and unreliable.

Non-sensitive executions retain byte-compatible undo and redo behavior.

### Defense in depth

`ActionLogService.log()` sanitizes `commandPayload`, both snapshots, `changes` and `context` again before creating the entity. If that second pass finds a secret, it clears `undoToken` and marks redo unavailable. This protects direct service callers and future command-bus regressions.

### Historical cleanup

Two idempotent mechanisms are required:

1. A module migration recursively redacts sensitive keys in plaintext JSONB columns, removes `__redoInput` from affected command payloads, adds the unavailable marker and clears affected undo tokens.
2. `mercato audit_logs sensitive-data:redact` scans rows in keyset-ordered batches. It uses the tenant encryption service to decrypt whole-field ciphertext, applies the same shared redactor, re-encrypts with the existing encryption map and updates only changed rows.

The CLI supports `--tenant`, `--org`, `--batch` and `--dry-run`. It exits non-zero when any encrypted row cannot be decrypted or safely re-encrypted. It never prints payload content or secret values.

## Architecture

```text
command input
    |
    v
CommandBus detector + buildLog sensitiveInput flag
    |
    +-- sensitive --> no undo token, no redo input, unavailable marker
    |
    v
recursive redaction of payload, snapshots, changes and context
    |
    v
ActionLogService defense-in-depth redaction
    |
    v
existing tenant encryption subscriber
    |
    v
action_logs
```

MIT Core owns the redaction utility, Command Bus enforcement, ActionLogService enforcement, migration, CLI and Core command adoption. Enterprise only marks and tests its own password-change command. Enterprise does not fork or override the Core security policy.

## Data Models

No table or column is added, removed or renamed.

Existing `action_logs` fields are reused:

- `undo_token` becomes null for a sensitive execution;
- `command_payload` carries safe audit metadata plus `__redoUnavailable`;
- `snapshot_before`, `snapshot_after`, `changes_json` and `context_json` are sanitized before persistence.

The database schema remains additive-only and unchanged.

## API Contracts

No route, request or successful response shape changes.

Behavior change for `POST /api/audit_logs/audit-logs/actions/redo`:

- an affected historical row or new sensitive row returns the existing `400` error shape with `Redo data unavailable for this action`;
- non-sensitive redo behavior is unchanged.

Sensitive executions no longer return an undo token in their action log, so callers do not receive an undo operation for password, token or credential changes.

## Internationalization

No new user-facing UI text. CLI output is operator-facing English text, consistent with the existing audit-log CLI.

## UI/UX

No UI file changes. Existing operation controls derive undo availability from the presence of `undoToken`, so sensitive actions naturally stop offering undo.

## Migration & Backward Compatibility

- `CommandLogMetadata.sensitiveInput` is optional and additive.
- Existing command IDs, event IDs, API routes, import paths and database columns remain unchanged.
- Default undo/redo behavior remains unchanged for non-sensitive input.
- Sensitive executions intentionally lose undo/redo because replay would require retaining a credential.
- The SQL migration is idempotent and handles plaintext rows without key access.
- Encrypted history is not modified by SQL. The CLI must run while the configured KMS/Vault or fallback key is available.
- The CLI is additive. No existing CLI command is renamed or removed.

## Implementation Plan

### Phase 1: Prevent new secret persistence

1. Add the shared detector, recursive redactor and redo-unavailable helpers with unit tests.
2. Extend `CommandLogMetadata` additively.
3. Enforce sensitive history behavior in `CommandBus`.
4. Sanitize again in `ActionLogService.log()`.
5. Update the redo resolver and its route tests.

### Phase 2: Adopt and prove credential commands

1. Mark Core user create/update logs sensitive when a password is supplied.
2. Mark Enterprise password change sensitive unconditionally.
3. Add raw persistence assertions for `password`, `currentPassword` and `newPassword`.
4. Add coverage for a non-sensitive command to prove redo compatibility.

### Phase 3: Clean historical rows

1. Add the plaintext JSONB redaction migration.
2. Add the encrypted-history CLI backfill with dry-run and bounded batches.
3. Test idempotency, tenant scoping, encryption unavailable and successful decrypt-redact-re-encrypt paths.

### Phase 4: Close the program item

1. Run focused shared, Core and Enterprise tests and builds.
2. Record completion evidence in this specification.
3. Commit all files once with `OM-SEC-001` in the commit title.

## Testing Strategy

- Pure utility tests for nested objects, arrays, punctuation, false positives, hashes and repeated runs.
- Command Bus tests that inspect the exact object passed to `ActionLogService.log()`.
- Tests with the encryption service absent, disabled and unavailable to prove redaction happens before encryption.
- ActionLogService direct-call tests to prove defense in depth.
- Redo route tests for the unavailable marker and unchanged non-sensitive replay.
- Auth command tests for password and non-password updates.
- Enterprise password-change command test.
- Historical backfill tests for plaintext, encrypted, scoped, dry-run and failure cases.

## Risks & Impact Review

#### False-positive key disables undo

- **Scenario**: A non-secret field ends with a sensitive suffix such as `token` and is treated as a credential.
- **Severity**: Medium
- **Affected area**: Command history and redo availability
- **Mitigation**: Match normalized suffix families, document the list, preserve ordinary identifiers, hashes, expiry timestamps and counters, and test representative false positives.
- **Residual risk**: A legitimately non-secret token-shaped value may lose undo. The safer failure is reduced convenience, not secret persistence.

#### Secret hidden under a generic key

- **Scenario**: A third-party command puts a credential under `value` or another name that cannot be inferred.
- **Severity**: High
- **Affected area**: Third-party command audit payloads
- **Mitigation**: Add explicit `sensitiveInput: true`, sanitize all log fields in the service, and document the handler contract.
- **Residual risk**: Semantic classification cannot be perfect without module intent. Review and tests remain required for nonstandard credential schemas.

#### Encrypted history cannot be decrypted

- **Scenario**: The CLI encounters ciphertext while KMS/Vault is unavailable or the DEK was lost.
- **Severity**: High
- **Affected area**: Historical audit cleanup
- **Mitigation**: Fail the row and the command without overwriting it, print only row IDs and counts, and make the CLI safely repeatable after key service recovery.
- **Residual risk**: Irrecoverable ciphertext cannot be selectively sanitized. The operator must revoke access to or remove that historical audit range under an approved recovery procedure.

#### Cleanup backfill loads a large audit table

- **Scenario**: Millions of rows create long transactions or database pressure.
- **Severity**: Medium
- **Affected area**: Database latency during cleanup
- **Mitigation**: Keyset pagination, bounded batches, per-row updates only when changed, dry-run and tenant filters.
- **Residual risk**: Full-instance cleanup remains I/O intensive and should run during a controlled maintenance window.

#### Redaction breaks a historical undo record

- **Scenario**: An affected action still has an undo token, but its required secret has been removed.
- **Severity**: Medium
- **Affected area**: Historical undo/redo
- **Mitigation**: Clear the undo token and mark redo unavailable atomically with redaction.
- **Residual risk**: Operators lose undo for credential-bearing history. Retaining the secret is not an acceptable alternative.

## Final Compliance Report - 2026-08-20

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/auth/AGENTS.md`
- `packages/enterprise/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| Root and auth rules | Never log credentials | Compliant | Redaction runs before persistence and again in the service. |
| Shared rules | Shared code remains infrastructure-only | Compliant | The utility classifies generic audit keys and imports no domain package. |
| Core encryption rules | Use the existing encryption service | Compliant | Historical encrypted rows use `TenantDataEncryptionService`; no new crypto is introduced. |
| Core command rules | Preserve command side effects and undo semantics | Compliant | Non-sensitive commands are unchanged; sensitive replay is deliberately disabled. |
| Tenant isolation | Scope every historical scan | Compliant | CLI filters are server/operator supplied and every row keeps its tenant/org scope. |
| Backward compatibility | Public type changes are additive | Compliant | One optional metadata field and one new CLI command are added. |
| Database schema | Additive-only | Compliant | No schema shape changes; migration changes stored values only. |
| Spec separation | Enterprise-only behavior stays in Enterprise | Compliant | Enterprise only adopts the MIT policy in its own command and tests. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | No new model or API response field. |
| API contracts match UI behavior | Pass | Missing undo token already hides undo; redo uses the existing 400 shape. |
| Risks cover write operations | Pass | New writes, direct service writes and historical rewrites are covered. |
| Commands remain auditable | Pass | Safe action metadata remains while credential material is removed. |
| Cache behavior | N/A | Audit payload persistence does not change application cache keys. |

### Non-Compliant Items

None identified before implementation.

### Verdict

Fully compliant: approved for implementation.

## Changelog

### 2026-08-20

- Created the focused MIT Core specification for `OM-SEC-001`.
- Recorded the automatic detector, explicit command signal, no-replay behavior, defense-in-depth service pass and two-part historical cleanup.
- Review: security passed, performance passed with batching, cache N/A, commands passed, risks passed. Verdict: approved.
- Implemented recursive prevention in Shared and Core, adopted it in Core and Enterprise credential commands, and added the idempotent migration plus encrypted-history cleanup CLI.
- Verified 49 focused unit tests, package builds for Shared, Core, Enterprise and CLI, a real PostgreSQL migration smoke, and integration test `TC-AUD-009` against the stored action-log row.
- Package typecheck remains blocked by unrelated existing workspace diagnostics, including `bullmq-otel`, `@open-mercato/telemetry`, `@tanstack/react-table/legacy` and an existing rate-limit overload. No diagnostic pointed to a changed path.
