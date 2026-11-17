# Keep credentials out of the command audit log

> **Program:** package C2 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Reference only:** `.ai/specs/2026-08-20-command-audit-sensitive-data-redaction.md` on `upstream/feat/security-readiness` (PR #5557).
> **Verified at** `main` @ `08dada9624` by reading code, twice (author and independent reviewer); nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-07-28-protected-roles-and-audit-seam.md

## 📝 TLDR

The command audit log stores, for every logged action, the input the command was called with, so that the action can be redone. Nothing filters that input, and it is stored even for commands that can never be undone or redone. As a result the log holds the plaintext old and new passwords of every password change made through the enterprise security module, pay-link passwords, raw push tokens, a cart merge token, and a deleted staff user's password hash — indefinitely, and in clear on installations without tenant encryption. **Proposed (future):** the bus stops storing replay input for commands that cannot be replayed; the commands that can be replayed stop recording credentials, while keeping safe undo; protected rows that no longer exist cannot be recreated without their password; and a migration strips historical entries that may contain credentials.

**Not in this spec:** a name-based credential check in the command bus for unknown and third-party commands, which becomes its own child spec (`command-audit-credential-check`); personal data in snapshots, which undo needs while an action can be undone (removal on erasure is `actionLogService.applyRetention` and its `subjectHistoryService` wrapper in [`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md), by age is enterprise retention); who may view snapshots (PR #8978); MFA secrets (PR #9578).

## 📝 Overview

> **Market reference.** Rails' `filter_parameters` strips credential-named parameters from what gets recorded at one central point; PaperTrail, the Rails versioning library, makes each model declare what to skip. This spec takes the PaperTrail half now — each known command declares what it records — plus one structural rule that needs no names at all. The [credential-check child spec](2026-11-16-command-audit-credential-check.md) defines the central name-based check as report-only; rewriting stored data and its effect on third-party undo remain deferred there.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Does this spec remove personal data from snapshots? | No. Credentials and secrets only | Undo re-creates a deleted record from its snapshot, so names and emails cannot leave while the action is undoable. The program's wording for C2 is narrowed to match. |
| 2 | Scope after review | Command fixes and history cleanup only; the central check is split out | The reviewer's verdict was SPLIT: the fixes are urgent and small; the child now defines report-only matching with opt-in test failure. |
| 3 | Root-cause fix in the bus | Do not store replay input for a command that has no undo handler | Redo needs a row that was undone, and undo needs a handler. For such commands the stored input is dead data. This fixes the password-change case with no change to the enterprise command. |
| 4 | Pay links and templates | Keep undo on existing rows without writing a credential. Store only a `passwordProtected` boolean: a protected or unknown target keeps the live hash, an unprotected target clears it, and replay whose target is protected or unknown while the live row has no hash is refused | Normal deletes are soft. A physically missing row has lost its hash, and so has a row whose password an edit removed, so restoring protection without the hash must fail closed rather than report success over an open page. |
| 5 | What undo of a deleted staff user restores | Everything except the password; the user resets it | Already the shipped behaviour for redo of a user creation. |
| 6 | How history is cleaned | A data-only migration strips existing entries of the affected resource kinds, using the erasure spec's `stripped_at` mark | Decided: the migration removes stored content and replay for the closed affected-kind list, without tenant keys, and is irreversible. Encrypted content cannot be edited selectively without every tenant's key, and an opt-in cleanup leaves operators who never run it exposed. No vulnerable replay branch is kept. It ships under assumption 7's exception, after erasure Phase 2. |
| 7 | Compatibility route | Emergency Security Exception for staff-delete password restoration, password replay changes, cart merge redo and historical cleanup | Decided. The stored credential and its replay are the vulnerability, so a bridge would keep them reachable for the whole deprecation window; no credential-retaining bridge ships (program DEC-5). Process gate: each affected PR carries the qualifying argument, a dated `BACKWARD_COMPATIBILITY.md` entry, client and operator `UPGRADE_NOTES.md` instructions, the `security` label and the named maintainer approval. |
| 8 | Retention of the log | Not addressed | The maintainer's comment on #2980 (2026-11-12) places it in Enterprise. |

## 📝 Problem Statement

**The mechanism.** When a command is logged, its replay payload defaults to the input: `metadata.redoInput !== undefined ? metadata.redoInput : options.input` (`packages/shared/src/lib/commands/command-bus.ts:1036-1042`). The input is whatever the caller passed: validated for some commands, the raw request body for others. A command avoids this only by declaring `redoInput` or `replayable: false`. The payload is written even when the command has no undo handler, although redo requires a row that was undone (`packages/core/src/modules/audit_logs/api/audit-logs/actions/redo/route.ts:89`) and undo requires a handler (`command-bus.ts:570`). The column is encrypted when the tenant has encryption on and stored as-is when it does not.

**What is stored today**

| Command | Stored | Where |
|---|---|---|
| Change password (enterprise `security`) | Both passwords, in the replay input. The command has no undo handler | `packages/enterprise/src/modules/security/api/profile/password/route.ts:66-69`; `commands/changePassword.ts:59-76` |
| Create, update, delete pay link or template (`checkout`) | `passwordHash` in the undo payload; the plaintext password in the replay input, which is the raw request body | `packages/checkout/src/modules/checkout/commands/links.ts:179-182, 377-381, 487-489`; `api/links/route.ts:73-76` |
| Register and update device (`devices`) | The raw push token in the replay input | `packages/core/src/modules/devices/commands/register.ts:142-156`, `update.ts:99-114` |
| Merge cart (`cart`) | A plaintext source token and route context in the replay input | `packages/core/src/modules/cart/commands/merge.ts:252, 688-702` |
| Delete staff user (`auth`) | `passwordHash` in the undo payload; undo writes it back | `packages/core/src/modules/auth/commands/users.ts:1190-1246` |
| Create and update staff user, before commit `b21eb70c2d` | Rows from that period may still hold a plaintext password; replaying them is already refused | `users.ts:1372-1388` |
| Remove MFA method (enterprise `security`) | TOTP secret and provider metadata | Fixed by open PR #9578 |

- **Restore reads the hash from the payload.** Pay-link restore assigns `passwordHash: snapshot.passwordHash ?? null` (`packages/checkout/src/modules/checkout/commands/shared.ts:254`). Link delete is a soft delete, so the row still holds its own hash.
- **An edit can remove a password.** Link and template updates rehash `parsed.password` whenever it is present, and `hashCheckoutPassword` returns null for an empty value (`checkout/lib/utils.ts:253-256`; `commands/links.ts:314`; `commands/templates.ts:297-299`). Today undo of that edit re-protects the page from the logged hash.
- **A hard-deleted user survives only here.** User delete removes the row; the log's copy of the hash is the last one.
- **Nothing expires.** There is no time limit on undo and no pruning of the log.
- **The precedent for doing it right exists.** User creation and update already exclude the password and its hash (`users.ts:430-450, 967-986`). Person delete records a trimmed view snapshot beside a full undo payload (`packages/core/src/modules/customers/commands/people.ts:1431-1451`).
- **Two writers reach the log without the bus:** sales status history (`packages/core/src/modules/sales/lib/statusHistory.ts:16`) and the trace row written on undo, which copies the snapshots (`command-bus.ts:746-778`). Neither carries the replay payload.
- **Two readers use the replay payload:** warranty replacement-order undo and enterprise record locks. Neither reads the resource kinds this spec touches.

## 📝 Proposed Solution

1. **The bus** stops storing replay input for a command with no undo handler.
2. **Each affected command** declares a replay input without the credential, and an undo payload without the hash.
3. **Restore paths** keep the hash on existing links and templates; refuse recreating protected rows when the hash is unavailable.
4. **A migration** strips existing rows of the affected kinds and disables both undo and redo. It depends on the OSS erasure spec's column and replay guards.
5. **A test per package** asserts that its credential-bearing commands log none.

### What each command records afterwards

| Command | Change | Undo and redo afterwards |
|---|---|---|
| Change password | None in the command; the bus rule applies | As today: never undoable |
| Pay link and template — create, update, delete | Replay input without a non-empty `password`; an explicit clear stays as `password: null`, which carries no secret. Undo payload without `passwordHash`, with `passwordProtected` instead. Restore never assigns a hash from history: a protected or unknown target keeps the live hash, an unprotected target clears it | Unrelated edit, password-change and soft-delete undo keep the current hash; undo of adding a password clears it again; redo of a password removal removes it again. Restoring a target that is protected or lacks the boolean, when the row is missing or the live row has no hash (for example undo of an edit that removed the password), is refused with 409 `checkout.protected_replay_unavailable` before writes |
| Device — register, update | Replay input without the token | Undo works as today. Undo and redo preserve the live token on an existing row and never recover a lost token from history; a physically new row has no token until the app registers one |
| Cart merge | Replay input without the source token and route context; explicit `redo` handler | Undo is preserved; redo refuses with typed 409 `cart.merge_redo_unavailable` before any write. It never falls back to `execute` with missing credentials |
| Delete staff user | Undo payload without `passwordHash` | Undo restores the account, roles and ACL with no password; the user resets it |

### Design decisions

| Decision | Rationale |
|---|---|
| A structural rule in the bus instead of a name list | It cannot miss a name and cannot remove anyone's undo. |
| Restore never writes a credential it was not given | Otherwise removing the hash from the payload turns an unrelated undo into a way to strip a password. |
| Restore never reports protection it cannot apply | Undo of a password removal would otherwise succeed while the public pay page stays open; today's undo re-protects it, so silent success would be a regression in a security control. |
| Undo is kept wherever the record can be restored without the secret | Losing undo is a cost; the review showed it was avoidable for pay links. |
| Historical cleanup strips whole entries and marks them | Encrypted content cannot be edited selectively without keys. Clearing content and setting `stripped_at` makes history honest and disables both replay directions. |
| Kinds are selected by `resource_kind` | It is stored in clear; `command_id` is encrypted. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| A central name-based filter now | The child defines matcher rules and tenant-data exclusions for a report-only check; rewriting stored data and its effect on third-party undo remain deferred. |
| Make credential-carrying actions non-undoable | First draft. Unnecessary for pay links, and unsafe without fixing restore. |
| A resumable CLI that decrypts, edits and re-encrypts | Operators who never run it stay exposed with no signal; it must handle plaintext, encrypted, mixed and undecryptable rows; a second mechanism beside PR #9578's. |
| Stop recording input by default for every command | Redo of every existing undoable command depends on it. |
| Ordinary deprecation protocol with a one-minor bridge | The bridge would keep stored credentials and their replay reachable for the deprecation window. |

## 📝 Delta

### Capability: command-audit-secrets

#### MODIFIED Requirement: Replay input of commands that cannot be replayed
The system SHALL NOT store a command's input in the audit log when the command has no undo handler.

##### Scenario: Password change
- WHEN a user changes their password through the security profile
- THEN the audit entry exists and holds no replay payload

Frozen by: `packages/shared/src/lib/commands/__tests__/command-bus.replay-input.characterization.test.ts`

#### MODIFIED Requirement: Undo of a staff user deletion
The system SHALL restore a deleted staff user on undo without a password, and SHALL NOT store the user's password hash in the audit log.

##### Scenario: Undo
- WHEN an administrator deletes a staff user and then undoes it
- THEN the account, its roles and its permissions are back, and signing in with the old password fails

Frozen by: `packages/core/src/modules/auth/commands/__tests__/users.delete-undo.characterization.test.ts`

#### MODIFIED Requirement: Undo of pay-link and template changes
The system SHALL NOT store a link or template password or its hash in the audit log. Undo on an existing row SHALL keep its current hash when the target state is protected and clear it when the target state is unprotected; replay SHALL refuse restoring a protected or unknown-protection state when no hash is available, whether the row is missing or its live hash was removed.

##### Scenario: Undo an unrelated edit
- WHEN a protected link's title is edited and the edit is undone
- THEN the title is back and the link is still protected by the same password

##### Scenario: Undo a delete
- WHEN a protected link is deleted and the delete is undone
- THEN the link is back and still protected

##### Scenario: Undo a password change
- WHEN a protected link changes its password and that action is undone
- THEN its other settings are restored and its current password remains in force

##### Scenario: Undo a password removal
- WHEN an edit removes a protected link's or template's password and that edit is undone
- THEN undo returns 409 `checkout.protected_replay_unavailable` before any write, the row stays as it is, and the operator sets a new password; undo never reports success while the page is open

##### Scenario: Undo a password addition
- WHEN a password is added to an unprotected link and that edit is undone
- THEN the hash is cleared and the link is unprotected again, as before the edit

##### Scenario: Template restore
- WHEN an unrelated edit, a soft delete or a password change of a protected template is undone
- THEN the template is restored with its current hash unchanged, and a newly created link from it still requires that password

##### Scenario: Missing protected row
- WHEN a protected link or template is created, creation is undone, its row is physically removed, and redo is requested
- THEN redo returns 409 `checkout.protected_replay_unavailable`, creates no row and publishes no unprotected page
- WHEN undo of a delete must recreate a protected row, or a legacy snapshot lacks `passwordProtected`
- THEN the same refusal occurs before any write

Frozen by: `packages/checkout/src/modules/checkout/commands/__tests__/links.audit.characterization.test.ts`, `packages/checkout/src/modules/checkout/commands/__tests__/templates.audit.characterization.test.ts`

#### MODIFIED Requirement: Replay of device and cart actions
The system SHALL NOT store a push token or a cart merge token in the audit log.

##### Scenario: Device registered
- WHEN a device is registered with a push token
- THEN the audit entry's replay input holds no token

##### Scenario: Cart merge replay
- WHEN a cart merge is undone and its action is redone
- THEN undo has restored the carts, redo returns 409 `cart.merge_redo_unavailable`, and neither cart changes

Frozen by: `packages/core/src/modules/devices/commands/__tests__/register.audit.characterization.test.ts`, `packages/core/src/modules/cart/commands/__tests__/merge.audit.characterization.test.ts`

#### ADDED Requirement: Stored credentials are cleared
The system SHALL strip stored content of existing audit entries of the affected kinds and make undo and redo unavailable when it is upgraded.

##### Scenario: After upgrade
- WHEN the upgrade's migrations have run
- THEN no entry of those kinds created before the upgrade holds snapshots, change values, context or replay payload; each has `strippedAt`, keeps existing field names, and offers neither undo nor redo
- WHEN a pre-upgrade entry was already `undone` and redo is requested directly
- THEN redo returns 410 `audit_logs.history_stripped` after authorization

## 📝 Architecture

- **Command bus** (`packages/shared/src/lib/commands/command-bus.ts`): when building the log payload, the replay envelope is written only if the handler is undoable. The bus already has that predicate for undo.
- **Commands**: `checkout` links, templates and their shared restore helper; `devices` register and update; `cart` merge; `auth` user delete. Each uses the existing `redoInput` seam and its own `buildLog`.
- **Historical cleanup** in `audit_logs`: new exported internal helper `stripCredentialHistory(execute, { tenantId, before, limit, after, dryRun })` in `lib/credentialHistoryCleanup.ts`, where `execute(sql, params)` is a raw-SQL executor. It needs no DI, ORM metadata or tenant key, so the migration (whose ORM is initialised with `entities: []`, `packages/cli/src/lib/db/commands.ts:473-518`) passes its own `this.execute` and tests pass a fixture connection. It selects unstripped rows of the closed affected-kind list before an explicit cutoff, one tenant at a time, in keyset batches by `id`, filtering on `tenant_id`, `resource_kind` and `created_at` through `action_logs_resource_idx (tenant_id, resource_kind, resource_id, created_at)`. Already stripped rows do not match. The helper returns matched/changed/skipped counts, next cursor and done. `tenantId: null` means only installation rows, never every tenant. Tests pass their fixture tenant and cutoff.
  - **Delivery.** The data-only migration is non-transactional (`isTransactional()` returns `false`, as `attachments/migrations/Migration20261009120000_attachments.ts` and `catalog/migrations/Migration20260914120100.ts` do), because one transaction across every batch would hold row locks on `action_logs` for the whole sweep and lose all progress on failure. Each batch is one data-modifying statement issued through `this.execute`, so it commits on its own. Its first CTE selects at most `limit` candidate ids after the cursor without locking them; a second `MATERIALIZED` CTE re-reads those ids, still unstripped, with `FOR UPDATE SKIP LOCKED`; a third keeps only the locked ids for which `pg_try_advisory_xact_lock(hashtextextended(AUDIT_REPLAY_LEASE_LOCK_PREFIX || id::text, 0))` succeeds, with `AUDIT_REPLAY_LEASE_LOCK_PREFIX = 'audit_replay_lease:'` imported from `audit_logs` and bound as a parameter ([erasure spec](2026-11-16-privacy-subject-erasure.md), The lease's PostgreSQL form); the update touches only those and returns their ids. The statement returns the candidate count, the updated count and the last candidate id as the next cursor. `skipped` is candidates minus updated rows, because a row skipped by `SKIP LOCKED` is absent from the locking select and could not be counted there. The cursor advances past every candidate, so a skipped row is not revisited in the same run. The transaction-level try-lock conflicts with the session-level `pg_advisory_lock` a live replay holds on the same key, and is released when the statement commits. The migration enumerates scopes as `SELECT DISTINCT tenant_id` over unstripped rows of the affected kinds, then loops each scope until `done`.
  - **Cutoff.** Each run takes its cutoff once, as the database time at its start, and uses it for every batch of that run. A rerun takes a fresh cutoff. Old command executors are drained before the upgrade, so every row present at the start of a run is a pre-upgrade or drained-executor row; a cutoff pinned at an earlier failed attempt would miss rows that an old executor wrote between attempts, while a fresh cutoff costs the stored content and undo of clean affected-kind rows written between attempts: the strip clears their `command_payload`, `undo_token`, snapshots, `changes_json` and `context_json`, which for `auth.user` includes the before/after values of role and ACL changes made in that interval.
  - **Completion.** After every scope is done, the migration runs a verification query counting unstripped affected-kind rows created before the run's cutoff, across all scopes. If that count, or the summed `skipped` count, is non-zero, it throws an error naming both counts and the rerun instruction, so the migrator does not record it as applied; the upgrade gate stays closed until a rerun ends with zero skips and a zero verification count. The verification query is the gate: a counting fault cannot let an unstripped row through. Committed batches stay committed; a rerun matches only rows still unstripped.
  - It uses the erasure spec's replay exclusion locks and row locks, clears `command_payload`, `undo_token`, `snapshot_before`, `snapshot_after`, `changes_json` and `context_json`, preserves existing projected field names and sets `stripped_at`. No tenant key is needed. A NULL context retains no credential; actor id/time columns remain. This is an explicit security-cleanup caller of the same strip state, not a second meaning for `stripped_at`.
- **Deployment prerequisite**: erasure Phase 2's column, conditional strip/delete tests, locked execution-time undo/redo checks, stripped readers and TC-AUD-STRIPPED-OSS-001 land before the migration. The erasure spec owns those contracts and tests; this cleanup consumes the same replay lease/row locks and does not redefine them. Drain old command executors during upgrade; do not run a nulling migration beside binaries that still replay stale in-memory payloads.
- **Per-package tests**: `core` and `checkout` assert on their own commands. `shared` tests the no-undo bus rule with a recording service, including an old/new-password input. No enterprise code or new enterprise test is needed; core never imports checkout or enterprise.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Commands → log | Their own `buildLog` and `redoInput` | A disabled module logs nothing |
| Migration → rows | SQL on plaintext columns only | Kinds a deployment never used match nothing |

**Affected resource kinds.** Verified in today's `buildLog` methods: `security.profile`, `checkout.link`, `checkout.template`, `devices.user_device`, `cart.cart_merge_log` and `auth.user`. The migration uses exactly this closed list. Clearing every staff-user entry also removes the legacy plaintext passwords, and with them the before/after values of pre-upgrade role and permission changes; see Risks for why the selection cannot be narrowed.

## 📝 Data Models

No schema is introduced here. This spec consumes `action_logs.stripped_at`, its index and migration from the OSS erasure spec under DEC-B — “The audit-history strip routine” and R3-1 — “The audit-history rule for every erasure”. Historical rows lose all content columns listed above and their undo token, keep existing projections and actor/time columns, and receive the strip mark. The graph is omitted because this spec adds no entity.

## 📝 API Contracts

- **No new route, command or setting.** Add only the internal fixture-scoped cleanup helper and non-secret `passwordProtected` snapshot flag. Existing handler and service signatures stay compatible.
- **Audit list API** — uses the erasure spec's additive `strippedAt` and `changedFields` fields; historical entries return a null `undoToken`. Its list, details and redo controls honour the mark.
- **Replay routes** — undo and redo use erasure Phase 2's stripped-entry refusal; authorized redo of a stripped entry returns 410. Cart merge redo returns 409 `cart.merge_redo_unavailable`; restoring a protected or unknown-protection link or template state without an available hash (a missing row, or a live row whose password an edit removed) returns 409 `checkout.protected_replay_unavailable`, both translated through existing CRUD error handling.
- **Behaviour of undo** for staff-user delete changes as described; it is tracked as a contract in `BACKWARD_COMPATIBILITY.md`.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Undo of a staff-user delete made before the upgrade | Not offered: the migration cleared it |
| Undo of a title edit on a protected link, after a later password change | Title restored; current password kept |
| Undo of a link or template creation | Soft-deletes as today; redo keeps the surviving hash. If the row is gone, protected or unknown-protection snapshots refuse recreation |
| Legacy snapshot without `passwordProtected` | Cannot recreate a missing row or restore onto a live row without a hash; never assume it was unprotected |
| Undo of an edit that removed a link or template password | Target state is protected and the live row has no hash: 409 `checkout.protected_replay_unavailable` before any write; the page stays as the edit left it and the operator sets a new password |
| Undo of an edit that added a password | Target state is unprotected: the hash is cleared, as today |
| Redo of an edit that removed a password | The stored `password: null` clears the hash again; no secret was logged |
| Cart merge after undo | Explicit redo handler refuses with typed 409 and leaves both carts unchanged |
| Redo of a device registration | Existing token stays authoritative, as `devices/commands/shared.ts:applySnapshot` already does; a missing row is recreated without a token and the app registers one |
| A command with no undo handler that a module later makes undoable | Its earlier rows have no replay payload and cannot be redone; new rows can |
| A third-party command with no undo handler | Its input is no longer stored. Nothing could replay it before |
| A third-party undoable command that logs a secret | Unchanged, and still stored. The deferred check is what addresses it |
| An older entry of the same record becoming "latest undoable" | Cannot happen through this change: the migration clears every earlier entry of the affected kinds together |
| Migration interrupted | Each batch statement commits on its own; the migration is not recorded as applied, re-running continues with a fresh cutoff, and cleared rows match nothing |
| A live replay holds an entry's lease, or another transaction holds its row lock, during the sweep | That entry is skipped and counted as candidates minus updated rows; the final verification query also finds it unstripped; the migration throws after the sweep, stays unapplied and is rerun after the lock is released |
| Backups | Still hold old values until expiry; the upgrade note says so. Audit action/access logs are excluded from query-index token generation (`packages/core/src/modules/query_index/lib/search-tokens.ts:18`); no index cleanup or reindex is prescribed here |

## 📝 Migration & Backward Compatibility

| Change | Route |
|---|---|
| No replay input for commands without an undo handler | Behaviour-neutral: the data could not be used. Dated entry |
| Link/template credentials and cart redo | Emergency Security Exception, steps 1–3 only (assumption 7). Narrow credential fixes; disclose password undo/recreation refusal, including the refused undo of a password removal, and typed cart redo refusal. No credential-carrying bridge. The `checkout` and `core` PRs carry the named maintainer approval and `security` label |
| Staff-user delete: undo restores no password | Emergency Security Exception, steps 1–3 only. The logged reusable hash and its restoration are the vulnerability; an old-behavior bridge would keep both reachable. The `core` PR carries the named maintainer approval and `security` label |
| Historical rows lose content and replay | Emergency Security Exception, steps 1–3 only; old credential-bearing content remains exploitable if retained. Narrow affected-kind list, dated entry and disclosure; irreversible. The dated entry names the loss of historical before/after values for staff-user role and ACL changes and why the `auth.user` selection cannot be narrowed by date. The migration PR carries the named maintainer approval and `security` label |

- **`UPGRADE_NOTES.md`:** which past actions can no longer be undone; that pre-upgrade staff-user entries lose their before/after values, including role and permission changes, while field names, actor and time remain, and that an operator who needs those values must export them before upgrading; that if the cleanup migration stops on skipped or unstripped entries, the operator reruns it before traffic resumes, because a rerun also strips the stored content and undo of clean affected-kind entries written between attempts, including `auth.user` role and ACL changes; that undo of an edit which removed a pay-link or template password is refused and the operator sets a new password; that a restored staff user must reset their password; that installations without tenant encryption have held these values in clear; that backups taken before the upgrade remain sensitive until they expire. No query-index rebuild is required for these audit rows. Client instructions cover both new replay error codes and 410; operator instructions cover password resets, upgrade order, lost historical values and rollback limits.
- **`BACKWARD_COMPATIBILITY.md`:** append a dated entry naming each removed credential-bearing surface, its STABLE classification, the qualifying argument, narrow scope and migration path. Steps 4–5 remain mandatory. The implementing PR names the approving human maintainer and links their explicit waiver; an automated review cannot supply it.
- **Coordination with PR #9578:** it clears MFA rows by the same mechanism. The two migrations select different resource kinds; this migration additionally requires the OSS erasure Phase 2 strip state and replay guards first. Both append to the same two documents.

## 📋 Phasing

| Phase | Outcome | Behaviour change |
|---|---|---|
| 1 | Characterization tests | None |
| 2 | Bus rule; command fixes; per-package tests | As listed |
| 3 | Migration | Historical rows cleared |

Phase 2 ships as one PR per package (`shared`, `core`, `checkout`); the enterprise package needs none.

## 📋 Implementation Plan

### Phase 1 — Prove it
1. **Characterize.** Add the six characterization test files named under Delta (bus, staff delete, links, templates, device register and cart merge). Each runs the command against a recording log service and asserts what is stored today. Commit them alone, green. A row whose assertion cannot be made true leaves the Problem Statement.

### Phase 2 — Stop it
1. Bus: write the replay envelope only for an undoable handler. Update the bus characterization test. Unit test that an undoable command is unaffected.
2. Pay links and templates: replay input without a non-empty password, keeping an explicit clear as `password: null`; undo payload without the hash, with `passwordProtected`. Both restore helpers never assign a hash from history: a protected or unknown target keeps the live hash, an unprotected target clears it, and a protected or unknown target over a live row with no hash refuses with 409 `checkout.protected_replay_unavailable` before writes. Both creation helpers refuse a missing protected or unknown-protection row before writes. Add `links.audit.test.ts` and `templates.audit.test.ts`: unrelated edit undo, soft-delete undo, password-change undo, password-removal undo (refused, row unchanged), password-addition undo (hash cleared), password-removal redo, create/undo/redo with a surviving row, and physical removal before redo; delete-undo recreation also refuses. Test template-propagated links keep their current passwords.
3. Devices: replay input without the token, for register and update.
4. Cart merge: replay input without the source token and route context; add explicit `redo` that throws `CrudHttpError(409, { code: 'cart.merge_redo_unavailable', error: translatedMessage })` before any write. Unit-test merge, undo and typed refusal; do not set `replayable: false`, which would remove undo too.
5. Staff-user delete: undo payload without the hash; undo restores without it.
6. Per-package credential tests in core and checkout, including device update; shared bus tests for no-undo handlers. Assert no plaintext password, hash, source token or push token in all logged content. No enterprise test imports.
7. `UPGRADE_NOTES.md`, the dated compatibility entry, the audit-log docs page.
8. Integration tests TC-AUDIT-SECRETS-001, 002 and 004. The `core` and `checkout` PRs carry the `security` label and the named maintainer approval for the changed replay behavior (assumption 7).

### Phase 3 — Clean it
1. After erasure Phase 2, including its OSS-only TC-AUD-STRIPPED-OSS-001 gate, add `stripCredentialHistory` and its non-transactional migration caller. `credentialHistoryCleanup.test.ts` runs database-level fixtures of affected/unaffected kinds, encrypted/plaintext rows, done/undone states, other tenants and installation scope. Pass an explicit cutoff and fixture tenant; assert idempotence, pagination, all cleared columns and the strip mark. Interruption: fail the executor after the second batch, assert the first two batches stay committed and the rest unstripped, then rerun to completion. Lease: hold `pg_advisory_lock(hashtextextended('audit_replay_lease:' || id::text, 0))` on one entry from a second connection, assert that entry is skipped and counted, the migration entry point throws without being recorded, and a rerun after release strips it. Row lock: from a second connection, open a transaction holding `SELECT … FOR UPDATE` on another entry; assert it is counted as skipped (candidates minus updated), the verification query reports it, the entry point throws without being recorded, and a rerun after that transaction ends strips it. Verification: with the skip counter forced to zero by a test seam, an unstripped pre-cutoff row still makes the entry point throw. Never rerun a migration against the shared test database.
2. Integration test TC-AUDIT-SECRETS-003. The migration PR carries the `security` label and the named maintainer approval (assumption 7).
3. Archive this Delta into `.ai/specs/capabilities/command-audit-secrets.md` if that directory has been adopted by then; it does not exist today.

### File manifest

| File | Action |
|---|---|
| `packages/shared/src/lib/commands/command-bus.ts` | Modify |
| `packages/checkout/src/modules/checkout/commands/{links,templates,shared}.ts` | Modify |
| `packages/core/src/modules/devices/commands/{register,update}.ts` | Modify |
| `packages/core/src/modules/cart/commands/merge.ts`, cart and checkout `i18n/*.json` | Modify — explicit typed redo refusal and translated replay errors |
| `packages/core/src/modules/auth/commands/users.ts` | Modify |
| `packages/core/src/modules/audit_logs/{lib/credentialHistoryCleanup.ts,lib/__tests__/credentialHistoryCleanup.test.ts,migrations/*}` | Create — fixture-scoped cleanup and migration; consumes the erasure column |
| The six characterization tests; per-package credential tests in `core` and `checkout` | Create |
| `packages/core/src/modules/audit_logs/__integration__/TC-AUDIT-SECRETS-00{1..4}.spec.ts` | Create |
| `UPGRADE_NOTES.md`, `BACKWARD_COMPATIBILITY.md`, audit-log docs page | Modify |

## 🧪 Integration Coverage

The replay payload is never returned by the API and is encrypted when tenant encryption is enabled, so the tests assert behavior and use scoped direct fixtures for historical storage. Each owns a fixture tenant and actor, creates records through APIs except the explicit legacy audit fixture, and removes records, audit rows, uploads and tenant in `finally`. No seeded/demo data or global migration re-application.

| Test | Path | Covers |
|---|---|---|
| TC-AUDIT-SECRETS-001 | `DELETE /api/auth/users`, the audit undo route, `POST /api/auth/login` | Delete a staff user, undo; the account exists again; the old password does not sign in; after `mercato auth set-password` the new one does |
| TC-AUDIT-SECRETS-002 | Checkout link/template CRUD routes, audit undo route, public pay route | For a link and a template: undo an unrelated edit, a soft delete and a password change; verify the live row retains its current password. A link created from the restored template still demands that password. Remove a link's password by an edit, then undo it: the undo route returns 409 `checkout.protected_replay_unavailable` and the public pay route still serves the page unprotected, exactly as the edit left it, with no success reported. Test UI fixture cleanup owns every generated link |
| TC-AUDIT-SECRETS-003 | Audit list API, audit redo route and audit list/details UI | Insert done and undone legacy entries in the fixture tenant, call `stripCredentialHistory` with that tenant and explicit cutoff, and read them through the list API: `strippedAt`, existing field names, no content and null token. Redo of the undone entry returns 410; the UI shows the stripped line and no redo. Unaffected kinds and another fixture tenant remain unchanged. Never rerun the migration |
| TC-AUDIT-SECRETS-004 | Cart merge route, audit undo and redo routes | Create two fixture carts and merge with a fixture token, undo successfully, then redo returns typed 409 `cart.merge_redo_unavailable`; both carts remain in their post-undo state |

Password change is covered by the bus unit tests, since the rule lives there. Device replay input is unit-tested; cart redo refusal is observed through the real audit redo route in TC-004. Missing protected link/template rows are exercised in unit tests at the creation helpers. The Undo control in the audit-log list is unchanged for new actions.

## 📝 Risks & Impact Review

#### Past actions can no longer be undone
- **Scenario**: An administrator wants to undo a staff-user deletion made the day before the upgrade.
- **Severity**: Medium
- **Affected area**: historical entries of the affected kinds
- **Mitigation**: The upgrade note says so before the upgrade; the entries retain actor, time and existing field names and show the erasure spec's stripped line, without content. The migration ships under the Emergency Security Exception with that upgrade disclosure.
- **Residual risk**: The undo is gone. That is the cost of clearing an encrypted column without every tenant's key.

#### A restored user cannot sign in
- **Scenario**: Undo of a user delete returns an account with no password.
- **Severity**: Medium
- **Affected area**: staff users
- **Mitigation**: The reset flow and the CLI both set a password; redo of user creation already behaves this way.
- **Residual risk**: An account without a working email needs an administrator.

#### A restore path still writes a credential
- **Scenario**: One of the restore helpers keeps assigning a hash from a payload that no longer has one, and nulls a live password; or undo of a password removal reports success while the page stays open.
- **Severity**: High
- **Affected area**: pay links and templates
- **Mitigation**: The restore rule is part of the same step as the payload change; link and template edit, delete, password-change, password-removal and password-addition undo are tested at unit level, and password-removal undo also through TC-AUDIT-SECRETS-002; unit tests also cover physical disappearance and unknown legacy protection state.
- **Residual risk**: Low once those tests exist.

#### Protected-row replay publishes an unprotected page
- **Scenario**: A protected link or template row is physically removed between undo and replay, or its password was removed by the edit being undone.
- **Severity**: High
- **Affected area**: checkout links and templates
- **Mitigation**: Non-secret protection marker; creation and restore helpers refuse protected or unknown-protection targets without a live hash before writes. Unit tests cover create/undo/remove/redo, delete undo and password-removal undo for both kinds.
- **Residual risk**: The operator must recreate the configuration with a new password; old replay cannot recover it.

#### A leaking command was missed
- **Scenario**: Another command stores a secret in its replay input.
- **Severity**: High
- **Affected area**: any undoable command whose input carries a secret
- **Mitigation**: The independent review searched command files and found the device-update and cart-merge cases, now included. Commands without an undo handler are covered structurally.
- **Residual risk**: Undoable commands in third-party modules, and any first-party one both passes missed. The deferred central check is the control for those.

#### The migration is slow or locks the table
- **Scenario**: A large audit table is updated in one statement or one long transaction, or a failure discards all progress.
- **Severity**: Medium
- **Affected area**: upgrade window
- **Mitigation**: A non-transactional migration; tenant by tenant, one self-committing statement per bounded batch, filtered through `action_logs_resource_idx`, with `SKIP LOCKED` row locks and replay-lease try-locks; a skipped or interrupted run stays unapplied and resumes on rerun.
- **Residual risk**: Upgrade time grows with the number of affected rows; a long-running live replay delays completion until a rerun.

#### Staff-user history loses non-credential values
- **Scenario**: Stripping every pre-upgrade `auth.user` entry also removes the before/after values of role and permission changes, not only the password material.
- **Severity**: Medium
- **Affected area**: accountability for staff-user role and ACL changes made before the upgrade
- **Mitigation**: The entries keep `changed_fields`, actor and time, so who changed which fields of which user and when stays visible. Narrowing is not safe: create and update entries stopped carrying the password only from commit `b21eb70c2d` (first tagged release v0.9.0), and an installation's upgrade date to that release cannot be recovered from the database, so a date cutoff would leave late-upgraded plaintext passwords in place; delete entries carry the hash in their undo payload in every release before this fix. The loss is disclosed in `UPGRADE_NOTES.md` and in the dated `BACKWARD_COMPATIBILITY.md` entry.
- **Residual risk**: Historical before/after values of staff-user role and ACL changes are gone; operators who need them must export the audit log before upgrading, within their own credential-handling rules. A rerun after a skipped or interrupted run takes a fresh cutoff and also strips the stored content and undo of clean affected-kind entries written between attempts, including `auth.user` role and ACL changes made in that interval; rerunning before traffic resumes keeps that set empty.

#### Old copies remain elsewhere
- **Scenario**: A backup taken before upgrade still holds credentials.
- **Severity**: Medium
- **Affected area**: backup storage and restores
- **Mitigation**: Stated in the upgrade note.
- **Residual risk**: Backups cannot be rewritten.

## Final Compliance Report — 2026-11-16

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `.ai/specs/AGENTS.md` — in full
- `BACKWARD_COMPATIBILITY.md` — protocol, Emergency Security Exception
- `.ai/qa/AGENTS.md` — test placement
- Reviewed relevant shared, auth, checkout and telemetry guide sections and current replay/restore source; cart/devices implementation still requires the implementer's full module-guide review. No implementation validation was run for this spec revision.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Never bypass command side effects | Compliant | Uses the bus's own seams |
| root AGENTS.md | Never commit or log credentials | Compliant | This is the fix |
| root AGENTS.md | Ask before touching multiple modules | Compliant | `shared`, `auth`, `devices`, `cart`, `checkout`, `audit_logs`; covered by this spec under program package C2; each package PR goes through ordinary maintainer review |
| root AGENTS.md | Migration workflow | Compliant | Data-only migration with the module snapshot |
| `BACKWARD_COMPATIBILITY.md` | Emergency Security Exception | Compliant | Route decided (assumption 7); no vulnerable bridge. The affected Phase 2 PRs and the Phase 3 PR carry the qualifying argument, dated entry, client/operator disclosure, `security` label and named maintainer approval |
| `.ai/qa/AGENTS.md` | Integration tests self-contained | Compliant | Fixtures created and removed per test |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Problem table matches the fix table | Pass | Seven evidence rows; known MFA work remains external; historical rows are stripped by the cleanup |
| Delta scenarios map to tests | Pass | TC or unit test for each |
| Each MODIFIED requirement has a characterization test | Pass | Six, in Phase 1 |
| Every step leaves the app working | Pass | The payload and restore changes ship in the same step |

### Non-Compliant Items
None. The affected Phase 2 replay changes and the Phase 3 cleanup take the Emergency Security Exception; the named maintainer approval on each of those PRs is a pull-request process gate, not an open design item.

### Verdict
**Ready for implementation.** Every design decision is settled under Resolved assumptions. Phase 1 may start now. The affected Phase 2 replay changes and Phase 3 ship under the Emergency Security Exception, each PR carrying the named maintainer approval; Phase 3 also waits for erasure Phase 2.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. The review confirmed every stored-credential claim by tracing each command's route, and found: the first draft's pay-link design could strip a live link's password through an unrelated undo; three missed leaks (device update, cart merge, legacy user rows); a structural fix for commands that cannot be replayed; and that the central name-based check was not buildable as specified. The check is split into its own spec; pay links keep undo; history is cleared by migration instead of a CLI.

- Council round two fixes (GPT-6.1 Sol workers): r3e-09 — explicit cart redo refusal; r3e-14 — Emergency Security Exception and release gate; r3e-15 — strip historical done/undone entries and disable redo; r3e-21 — template undo scenarios and tests; r3e-22 — fixture-scoped cleanup helper instead of migration re-application; r3e-28 — six named characterization files and consistent package tests; r3e-34 — erasure owner link; g2-10 — protected recreation fails closed; F-71 — remove unsupported query-index cleanup advice.

### 2026-11-17
- Pay-link and template restore follows the target protection state: protected keeps the live hash, unprotected clears it, and a protected or unknown target over a row with no hash refuses with 409 `checkout.protected_replay_unavailable`. This covers undo of an edit that removed a password, and redo of a removal keeps `password: null`.
- Historical cleanup is a non-transactional migration with one self-committing statement per batch, using `SKIP LOCKED` row locks and replay-lease try-locks, a per-run cutoff and an explicit throw on skipped entries; added interruption and lease tests.
- Disclosed that stripping pre-upgrade `auth.user` entries removes role and ACL before/after values, and why the selection cannot be narrowed.
- The cleanup batch selects candidates without locking, then locks them with `SKIP LOCKED` and the replay-lease try-lock on `hashtextextended(AUDIT_REPLAY_LEASE_LOCK_PREFIX || id::text, 0)`, and counts skipped rows as candidates minus updated rows; a final verification query of unstripped pre-cutoff affected-kind rows gates completion, with a row-lock test beside the lease test. A rerun's fresh cutoff is disclosed as stripping clean entries written between attempts.

### Review — 2026-11-16
- **Reviewer**: Agent (fresh context, spec path only), then author revision
- **Security**: One critical design defect corrected; three leaks added
- **Performance**: Migration batched per tenant
- **Cache**: N/A
- **Commands**: Replay and undo semantics specified per command
- **Risks**: Restore-path risk added
- **Verdict**: Revised; the revision has not been independently re-read

- Council round two fixes, pass two (GPT-6.1 Sol workers): checked the C2 program/child scope and protected-role replay seam; cited the exact DEC-B/R3-1 owners and made the erasure Phase 2 conditional-state, locked-replay and OSS integration gate explicit prerequisites for historical cleanup. The named human security waiver remains pending; this revision grants none.

- Council round two fixes, pass three (GPT-6.1 Sol workers): checked the merged C2 program/child and C4 references; cleanup still consumes the exact OSS strip state, replay lease/locked checks and Phase 2 integration gate. No additional command or migration change was needed; the named-human security waiver remains pending.

- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): replaced stale unresolved-matcher/two-release wording with the child spec's existing report-only matcher, tenant-data exclusions and opt-in test-failure contract; credential filtering remains deferred and the security waiver remains pending.
