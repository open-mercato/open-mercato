# Credentials out of the command audit log, and the history strip

> **Tracker:** open-mercato/open-mercato#8593
> **Program:** [program](2026-11-15-gdpr-ready-deployments-program.md)
> **Edition:** OSS
> **GDPR basis:** Art. 32(1) and Art. 5(1)(f) (credentials in history); Art. 17 and Art. 5(2) (history strip after erasure, keeping who/when)

## TLDR

**Key points**
- The command audit log (`action_logs`) keeps plaintext passwords, a password hash and raw device and cart tokens. The command bus stores each command's input for redo, even when the command has no undo, and some undo payloads include a password hash. The fix is one bus rule, changes to five commands, and one migration that removes the stored replay data.
- The same spec adds `action_logs.stripped_at` and `actionLogService.stripForResources(scope, refs)`. That is the history strip the Enterprise `privacy` module calls after an erasure.

**Scope**
- Bus: no redo envelope when the handler has no `undo`.
- Commands: checkout links and templates, device register and update, cart merge, staff-user delete.
- Restore never writes a password hash from history.
- Batched data migration that clears replay data of the affected resource kinds. New `stripped_at` column; undo and redo refuse a stripped row.
- `stripForResources` for the erasure run.

**Out of scope** (one line each)
- A name-based credential detector for undoable third-party commands: security backlog.
- MFA method secrets in `security.mfa_method` undo payloads: open PR #9578.
- Age-based action-log retention: Enterprise, in [DSR engine](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md).
- Personal data in snapshots of entries that can still be undone: removed only by the strip on erasure or by age retention.

## Overview

The action log is the platform's accountability record and its undo/redo store. A credential stored there outlives the password change that produced it. It sits in every database backup. It is readable by anyone with database access, and stored in clear when tenant encryption is off, because `command_payload` is encrypted only when encryption is on (`packages/core/src/modules/audit_logs/encryption.ts`). That fails Art. 32(1) and Art. 5(1)(f) regardless of how carefully the rest of the record is handled.

> **Market reference.** PaperTrail (Rails) makes each model declare what it must not record. Adopted: each owning command declares a redo input without the secret, plus one structural rule in the bus that needs no field names. Rejected for now: Rails-style central `filter_parameters` name matching. Its false positives would silently remove undo from third-party commands.

## Problem Statement

Verified on `b0304f2986`.

- **The bus records input it can never use.** `persistLog` wraps `metadata.redoInput ?? options.input` as `__redoInput` unless the command declares `replayable: false` (`packages/shared/src/lib/commands/command-bus.ts:1064-1069`). It does this whether or not the handler is undoable (`isUndoable`, `:1077`). Undo requires a handler (`:593`), and redo requires an `undone` row (`packages/core/src/modules/audit_logs/api/audit-logs/actions/redo/route.ts:89`). For a command without `undo`, the stored input is dead data.

| Command (resource kind) | Credential stored | Where |
|---|---|---|
| `security.password.change` (`security.profile`, Enterprise) | Current and new plaintext password, in the redo input. The command has no `undo` | `packages/enterprise/src/modules/security/api/profile/password/route.ts:66-69`; `commands/changePassword.ts` |
| `checkout.link.*`, `checkout.template.*` create, update, delete | Plaintext `password` in the redo input, which is the raw request body (`api/links/route.ts:75`, `api/templates/route.ts:71`). `passwordHash` in the undo payload (`commands/links.ts:176-180, 373-378, 483-487`, same in `templates.ts`). Restore writes the hash back (`commands/shared.ts:303`) | `packages/checkout/src/modules/checkout/` |
| `devices.user_devices.register`, `update` (`devices.user_device`) | Raw `pushToken` in the redo input (`data/validators.ts:14, 36`). Snapshots and undo payloads have carried only a fingerprint since the module was created | `packages/core/src/modules/devices/commands/{register,update}.ts` |
| `cart.merge` (`cart.cart_merge_log`) | The whole `CartMergeInput` in the redo input: plaintext guest `sourceToken` plus the buyer's `routeContext` | `packages/core/src/modules/cart/commands/merge.ts:243-257, 688-702` |
| Staff user delete (`auth.user`) | `passwordHash` in the undo payload (`commands/users.ts:1189-1208`, captured at `:1786`). Undo writes it back (`:1234, :1246`). Create and update already strip both (`:436-447`, `:967-983`). Before `b21eb70c2d` (v0.9.0), create and update stored the plaintext password in the redo input | `packages/core/src/modules/auth/commands/users.ts` |

- In every release, these credentials sit only in `command_payload`. Audit snapshots were sanitized from the start: checkout via `toCheckoutAuditSnapshot` (`checkout/commands/shared.ts:353-357`), devices via redaction and later a fingerprint, staff users via the view serializer.
- Nothing expires: there is no undo time limit and no pruning.
- No history strip exists. An erasure can delete a person and still leave the person's name and email in every `snapshot_before` that describes them.

## Proposed Solution

### 1. Bus: no redo envelope without `undo`

`persistLog` receives the `undoable` flag that `execute` already computes (`command-bus.ts:433`). When it is false, `command_payload` is `metadata.payload` as given (or null), with no `__redoInput`. Undoable commands are unchanged. This fixes the password change with no change to the Enterprise command. It also covers any third-party command without `undo`.

### 2. Command fixes

| Command | What it logs afterwards | Undo and redo afterwards |
|---|---|---|
| Checkout link and template: create, update, delete | `redoInput` = input without a non-empty `password`. An explicit clear (`null` or `''`) stays, because it carries no secret. Undo snapshots replace `passwordHash` with `passwordProtected: boolean`. | Restore keeps the live row's hash (see 3). Refused with 409 `checkout.protected_replay_unavailable` before any write when the target `passwordProtected` differs from the live row's protection. This covers undo of adding or removing a password, and redo of either: link and template update gain an explicit `redo` that runs the check against the `after` snapshot and then re-executes the sanitized input. It also covers recreating a missing row that was protected. Template propagation copies only the live template hash. |
| Device register and update | `redoInput` = parsed input without `pushToken` | Redo re-executes. An absent token leaves the live one unchanged (`validators.ts:28`). Undo is unchanged (`devices/commands/shared.ts` already keeps the live token). |
| Cart merge | `redoInput` = `{ targetCartId, tenantId, organizationId }`; new explicit `redo` handler | Undo is unchanged (it reads `mergeLogId`). Redo throws `CrudHttpError(409, { code: 'cart.merge_redo_unavailable' })` before any write. Setting `replayable: false` is not used, because it would also remove undo. |
| Staff user delete | Undo payload = `withoutPasswordHash(before)` plus `passwordProtected` | Undo restores the account, roles, ACL and custom fields without a password. The user resets it through the reset flow or `mercato auth set-password`. |
| Password change (Enterprise) | None. Rule 1 applies | Never undoable, as today |

### 3. Restore never writes a hash from history

Checkout `buildTemplateSnapshotData` stops copying `passwordHash`. `restoreLinkFromSnapshot` and `restoreTemplateFromSnapshot` leave the live hash untouched. `createLinkFromSnapshot` and `createTemplateFromSnapshot` write `null` and are reached only for `passwordProtected: false`. Staff-user undo sets no hash on a recreated row and leaves an existing row's hash as it is. Every check runs before the first write in the handler, so a refusal changes nothing: no row, no propagation to linked links, no replay state.

### 4. `stripped_at` and the history cleanup migration

- **Column.** `action_logs.stripped_at timestamptz null`. It means the row's replay data was removed and undo and redo are permanently refused. The strip in 5 and the migration below are its only writers.
- **Refusal.** `claimForUndo`, `claimForRedo`, `findByUndoToken`, `latestUndoableForActor`, `latestUndoableForResource` and `latestUndoneForActor` add `strippedAt: null` to their filters. The compare-and-set claims thereby close the race with a concurrent strip. After authorization, the redo route answers a stripped row with 410 `audit_logs.history_stripped`. An undo by token already fails, because the token is null. The list API returns `strippedAt`. The audit-log UI hides undo and redo for such rows and shows one line, "Undo history removed".
- **Data migration** (audit_logs, non-transactional, as in `catalog/migrations/Migration20260914120100.ts`):
  - Target: rows whose `resource_kind` is in the closed list `security.profile`, `checkout.link`, `checkout.template`, `devices.user_device`, `cart.cart_merge_log`, `auth.user`.
  - Loop: `SELECT DISTINCT tenant_id` over those kinds (including null), then keyset batches of 1000 ids per tenant. Each batch is one self-committing `UPDATE … SET command_payload = NULL, undo_token = NULL, stripped_at = now() WHERE id IN (…) AND stripped_at IS NULL`.
  - Snapshots, changes and context stay: they never held these credentials (Problem Statement), so role and ACL history of staff users survives.
  - No tenant key is needed. An interrupted run resumes, because stripped rows no longer match.
  - All of `auth.user` is selected: encrypted rows cannot be told apart, and delete entries carry the hash in every release.
  - Batching lives in an exported helper `stripCredentialHistory(execute, { tenantId?, batchSize? })` in `audit_logs/lib/credentialHistoryCleanup.ts`. The migration calls it with its own `this.execute`; tests call it scoped to a fixture tenant.

### 5. History strip for erasure: `stripForResources`

```ts
actionLogService.stripForResources(scope: PrivacyScope, refs: PrivacyRecordRef[]): Promise<{ stripped: number; pending: number }>
```

- **Match.**
  - Scope: `tenant_id = scope.tenantId`. When `scope.organizationId` is set, `organization_id = scope.organizationId OR organization_id IS NULL`. Only rows with `stripped_at IS NULL` match.
  - Record: `resource_id`, `parent_resource_id` or `related_resource_id` is one of the refs' `recordId`s. A child record's history (an interaction under a person) is stripped with its parent.
  - `entityType` is not compared. Action-log kinds (`customers.person`) are named differently from entity ids (`customers:customer_person`), and record ids are UUIDs.
- **Effect.**
  - Nulls `command_payload`, `snapshot_before`, `snapshot_after`, `changes_json`, `context_json` and `undo_token`, and sets `stripped_at`.
  - Keeps id, tenant and organization, `actor_user_id`, `on_behalf_of_user_id`, `command_id`, `action_label`, `action_type`, the resource, parent and related kind and id, `changed_fields`, `primary_changed_field`, `correlation_keys` (id-shaped only), `source_key`, `execution_state` and `created_at`. Who did what to which record, and when, survives (Art. 5(2)).
- **Concurrency.** Rows in `undoing` are skipped and counted in `pending`. An in-flight undo writes a trace row that copies snapshots (`command-bus.ts:769-800`). The caller repeats the call until `pending` is 0, and the repeat also strips that trace row.
- **Bounds.** Refs go in chunks of 500 ids, rows in statements of at most 1000. The call is idempotent and needs no tenant key. It is a service method with no RBAC of its own; the caller authorizes.
- **Consumer.** The Enterprise `privacy` erasure run calls it once, centrally, with the `touched` refs of all handlers ([DSR engine](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md)).
- **Types.** It imports `PrivacyScope` and `PrivacyRecordRef` from `packages/shared/src/modules/privacy.ts` ([contract](2026-11-16-privacy-data-class-contract.md)).

### 6. Privacy declaration of `audit_logs`

`audit_logs/privacy.ts` declares one class and one exemption:

- `audit_logs.action_log`: tables `action_logs`; `subjectKinds: []` (history is a copy of other modules' records, removed per `touched` ref by `stripForResources`); handler `auditLogsPrivacyHandler`; `eraseMode: 'delete'`; `retentionSetting: 'audit_logs.action_log_retention_days'`. `exportSubject` returns no sections and `eraseSubject` changes nothing, because the primary records carry the subject's data. `pruneExpired(scope, olderThan, { dryRun, limit })` deletes the tenant's entries older than `olderThan` in batches, except DSR entries (`command_id` starting `privacy.`), which hold no values. Unset keeps everything. The Enterprise runner is its only caller ([DSR engine](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md), action-log age bound, #2980), so OSS ships no schedule or setting for it.
- `access_logs`: exempt. It is already bounded inline (7 days / 8 hours).

## Architecture

- `shared` command bus: rule 1, inside `persistLog`.
- Owner commands: each uses its existing `buildLog` and `redoInput` seams and its own restore helpers (checkout, devices, cart, auth). Core never imports checkout or Enterprise code. The migration's kind list is plain strings.
- `audit_logs` owns the column, the refusal, the migration helper and `stripForResources`, because it owns the `action_logs` table. No other module writes that table.
- Two writers bypass the bus: sales status history and the undo trace row. Neither carries a redo envelope; the trace row is handled by `pending`.

## Data Models

- `ActionLog` (`action_logs`): adds `strippedAt: Date | null` (`stripped_at timestamptz null`). The schema migration and module snapshot come from `yarn db:generate`; the data migration is hand-written. No new index: every strip query is bounded by `tenant_id` through `action_logs_tenant_idx` or `action_logs_resource_idx`.
- Checkout and auth: no schema change. `passwordProtected` exists only inside undo payloads.

## API Contracts

- **DI:** new method `actionLogService.stripForResources` (signature above). New export `stripCredentialHistory` (internal, used by the migration and tests).
- **HTTP (additive):**
  - `GET /api/audit_logs/audit-logs/actions` returns `strippedAt`.
  - `POST /api/audit_logs/audit-logs/actions/redo` returns 410 `audit_logs.history_stripped`.
  - Checkout undo and redo return 409 `checkout.protected_replay_unavailable`. Cart-merge redo returns 409 `cart.merge_redo_unavailable`.
  - All are translated through existing CRUD error handling, with i18n keys in `audit_logs`, `checkout` and `cart`.
- **Unchanged:** no new command, event, CLI or setting. `CommandLogMetadata` is unchanged.

## Migration & Backward Compatibility

- **Emergency Security Exception.** It applies only where storing the credential is itself the vulnerability:
  - checkout undo and redo that no longer restore a hash;
  - staff-user delete undo without a password;
  - cart-merge redo refusal;
  - the migration that removes undo and redo of pre-upgrade entries of the six kinds.
  A bridge would keep the stored credentials and their replay reachable. Each of those PRs carries the argument, the `security` label and a named maintainer approval. Everything else is additive or behaviour-neutral: rule 1 removes data nobody could read back, and the column, field and method are new.
- **`UPGRADE_NOTES.md` (one entry).**
  - The command audit log no longer stores passwords, hashes or tokens.
  - The upgrade strips replay data from existing `security.profile`, checkout, device, cart-merge and staff-user entries, so those pre-upgrade actions can no longer be undone or redone. Their snapshots stay.
  - Undo of a staff-user delete restores the account without a password, and the user must reset it.
  - Undo or redo that would add or remove a pay-link or template password returns 409; set the password again by hand.
  - Cart-merge redo returns 409.
  - Stop old app and worker instances before `yarn db:migrate`.
  - Installations without tenant encryption held these values in clear, and backups keep them until they expire.
- **`BACKWARD_COMPATIBILITY.md`:** one dated entry naming the surfaces above, their STABLE classification, the qualifying argument and the migration path.

## Risks & Impact Review

#### Pre-upgrade actions lose undo
- **Scenario**: An administrator wants to undo, after the upgrade, a staff-user deletion made the day before.
- **Severity**: Medium
- **Affected area**: Historical entries of the six kinds
- **Mitigation**: The upgrade note says so in advance. Entries keep actor, time, label and snapshots.
- **Residual risk**: That undo is gone. It is the cost of clearing the payload without every tenant's key.

#### A restore path writes or clears a credential
- **Scenario**: A helper still assigns a hash from a payload that no longer has one, and nulls a live password. Or an undo of a password removal reports success while the pay page stays open.
- **Severity**: High
- **Affected area**: Checkout links and templates, staff users
- **Mitigation**: The restore rule ships in the same step as the payload change. Unit tests cover unrelated edit, delete, password change, password add and remove, and the missing-row cases. TC-AUD-CRED-002 covers the public pay page.
- **Residual risk**: Low once those tests exist.

#### Old instances write credentials after the migration
- **Scenario**: During a rolling upgrade, an old pod logs a pay-link edit after the migration ran.
- **Severity**: Medium
- **Affected area**: `action_logs` rows written in that window
- **Mitigation**: The upgrade order is stated: stop old instances before migrating.
- **Residual risk**: A row written by a forgotten instance keeps the credential until erasure or Enterprise age retention strips it.

#### A credential-bearing undoable command was missed
- **Scenario**: A third-party command with `undo` logs a secret in its input.
- **Severity**: Medium
- **Affected area**: Any undoable command not reviewed here
- **Mitigation**: Rule 1 covers every command without `undo`. First-party credential inputs were inventoried.
- **Residual risk**: Undoable third-party commands. The name-based detector stays in the security backlog.

#### The erasure strip removes more history than the subject's
- **Scenario**: A deal whose `related_resource_id` is the erased person loses its snapshots.
- **Severity**: Low
- **Affected area**: Audit detail of related records
- **Mitigation**: Only content columns are cleared. The deal itself and the who/when of its history stay.
- **Residual risk**: Accepted. Those snapshots usually contain the subject's data anyway.

## Implementation Plan

### Phase 1: Stop new credentials (one PR per package: `shared`, `core`, `checkout`)
1. Bus rule 1. `command-bus.redo-envelope.test.ts`: a non-undoable command called with `{ currentPassword, newPassword }` logs neither value; an undoable command still gets `__redoInput`.
2. Checkout links and templates (sections 2 and 3). `links.audit.test.ts`, `templates.audit.test.ts`: no password or bcrypt hash in any logged content; restore keeps the live hash; 409 for differing `passwordProtected` and for a protected missing row, with nothing written.
3. Devices register and update. `devices.audit.test.ts`: no token in logged content; redo keeps the live token.
4. Cart merge. `merge.audit.test.ts`: no `sourceToken` or `routeContext` in logged content; undo works; redo returns 409 with both carts unchanged.
5. Staff-user delete. `users.delete-audit.test.ts`: no hash logged; undo recreates the user with a null hash, roles and ACL.
6. Each package test records everything passed to `actionLogService.log`, serializes it and asserts the plaintext, hash and token strings are absent.

### Phase 2: Clean history
1. `stripped_at` on the entity; `yarn db:generate`, keeping only that column plus the snapshot. Add the refusal in the service, the redo-route 410, the list field and the UI line. Unit tests per filter and for the 410.
2. `stripCredentialHistory` and the data migration. Unit tests: emitted SQL, non-transactional, closed kind list, resume after a forced failure, already-stripped rows untouched.
3. `UPGRADE_NOTES.md`, the `BACKWARD_COMPATIBILITY.md` entry, one line on the audit-log docs page.

### Phase 3: History strip API (after the contract file from [contract](2026-11-16-privacy-data-class-contract.md) exists)
1. `stripForResources`. Unit tests: matches on all three id columns; org-or-null scoping; other tenants untouched; `undoing` rows counted in `pending`; idempotent; kept columns unchanged.
2. `audit_logs/privacy.ts` and `auditLogsPrivacyHandler` with `pruneExpired`. Unit tests: only entries older than the cutoff go; `privacy.*` entries stay; other tenants untouched; dry run writes nothing; batches stop at `limit`.

## Integration Coverage

Each test creates its own fixture tenant or records through the API, and removes records, audit rows and fixtures in `finally`. Direct SQL goes through `packages/core/src/helpers/integration/dbFixtures.ts` (`withClient`), and in-process service calls follow `TC-ENTITIES-009-encryption-map-concurrency.spec.ts`.

| Test | Paths | Asserts |
|---|---|---|
| TC-AUD-CRED-001 | `POST/DELETE /api/auth/users`, `POST /api/audit_logs/audit-logs/actions/undo`, `POST /api/auth/login` | Delete a staff user, then undo. The account and its roles are back, and the old password is rejected. After an admin password update, login succeeds. |
| TC-AUD-CRED-002 | Checkout link and template CRUD routes, audit undo and redo, `POST /api/checkout/pay/<slug>/verify-password` | Undo of a title edit on a protected link leaves the old password working. An edit removes the password; undoing it returns 409 `checkout.protected_replay_unavailable` and the row is unchanged. A template's unrelated-edit undo keeps protection, and a link created from it still requires the password. |
| TC-AUD-CRED-003 | `POST /api/cart/current/merge`, audit undo and redo | Merge two fixture carts, undo succeeds, redo returns 409 `cart.merge_redo_unavailable`, and both carts stay in their post-undo state. |
| TC-AUD-CRED-004 | Direct SQL fixtures, `stripCredentialHistory({ tenantId })`, `GET …/actions`, `POST …/actions/redo` | Seed `done` and `undone` rows of affected and unaffected kinds in the fixture tenant and run the helper. Affected rows show `strippedAt`, a null token and their snapshots still present. Redo of the `undone` one returns 410. Unaffected kinds and another tenant are unchanged. |
| TC-AUD-CRED-005 | `POST /api/customers/people`, interaction create, in-process `stripForResources`, `GET …/actions` | Create a person and an interaction under it, then strip with the person ref. Both rows show `strippedAt`, no snapshots and the same actor and time. The tenant's other rows are untouched, and a second call strips 0. |

## Final Compliance Report — 2026-11-20

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Never commit or log credentials | Compliant | This is the fix |
| root AGENTS.md | No cross-module ORM relations; owner-only writes | Compliant | `audit_logs` alone writes `action_logs`; kinds are strings |
| root AGENTS.md | Tenant scoping | Compliant | Strip and migration are tenant-bounded |
| root AGENTS.md | Migration workflow | Compliant | Generated column migration plus a hand-written data migration with snapshot |
| `BACKWARD_COMPATIBILITY.md` | Emergency Security Exception, steps 4–5 | Compliant | Narrow surfaces, dated entry, upgrade note, named approval on each PR |
| `.ai/qa/AGENTS.md` | Self-contained integration tests | Compliant | TC-AUD-CRED-001..005 own their fixtures |

Verdict: ready for implementation. Phase 3 waits for the contract file.

## Changelog

### 2026-11-20
- Rewritten to minimal GDPR scope
