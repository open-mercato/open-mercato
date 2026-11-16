# Keep credentials out of the command audit log

> **Program:** package C2 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Reference only:** `.ai/specs/2026-08-20-command-audit-sensitive-data-redaction.md` on `upstream/feat/security-readiness` (PR #5557).
> **Verified at** `main` @ `08dada9624` by reading code, twice (author and independent reviewer); nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-07-28-protected-roles-and-audit-seam.md

## 📝 TLDR

The command audit log stores, for every logged action, the input the command was called with, so that the action can be redone. Nothing filters that input, and it is stored even for commands that can never be undone or redone. As a result the log holds the plaintext old and new passwords of every password change made through the enterprise security module, pay-link passwords, raw push tokens, a cart merge token, and a deleted staff user's password hash — indefinitely, and in clear on installations without tenant encryption. **Proposed (future):** the bus stops storing replay input for commands that cannot be replayed; the commands that can be replayed stop recording credentials, without losing undo; and a migration clears what is already stored.

**Not in this spec:** a name-based credential check in the command bus for unknown and third-party commands, which becomes its own child spec (`command-audit-credential-check`); personal data in snapshots, which undo needs while an action can be undone (removal on erasure is the data-class coverage spec, by age is retention); who may view snapshots (PR #8978); MFA secrets (PR #9578).

## 📝 Overview

> **Market reference.** Rails' `filter_parameters` strips credential-named parameters from what gets recorded at one central point; PaperTrail, the Rails versioning library, makes each model declare what to skip. This spec takes the PaperTrail half now — each known command declares what it records — plus one structural rule that needs no names at all. The central name-based half is deferred to its own spec because its matcher and its effect on third-party undo need a design of their own.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Does this spec remove personal data from snapshots? | No. Credentials and secrets only | Undo re-creates a deleted record from its snapshot, so names and emails cannot leave while the action is undoable. The program's wording for C2 is narrowed to match. |
| 2 | Scope after review | Command fixes and history cleanup only; the central check is split out | The reviewer's verdict was SPLIT: the fixes are urgent and small, the check is a new contract with a two-release roll-out. |
| 3 | Root-cause fix in the bus | Do not store replay input for a command that has no undo handler | Redo needs a row that was undone, and undo needs a handler. For such commands the stored input is dead data. This fixes the password-change case with no change to the enterprise command. |
| 4 | Pay links | Undo is kept. The undo payload and replay input stop carrying the password and its hash, and restoring a link never touches its stored hash | Delete is a soft delete, so the hash never leaves the row. Removing undo, as first drafted, was unnecessary — and dropping the hash from the payload without fixing restore would have nulled a live link's password on an unrelated undo. |
| 5 | What undo of a deleted staff user restores | Everything except the password; the user resets it | Already the shipped behaviour for redo of a user creation. |
| 6 | How history is cleaned | A data-only migration that clears the replay payload on existing rows of the affected resource kinds | ⚠ NEEDS HUMAN CONFIRMATION. It is the mechanism PR #9578 uses for MFA rows: a NULL write needs no tenant key, runs for every installation without an operator step, and one mechanism for one class of defect is easier to reason about. The cost is that past actions of those kinds can no longer be undone or redone. |
| 7 | Compatibility route | No exception is claimed for the command fixes; the user-delete change follows the ordinary protocol; the history migration is argued as PR #9578 argues its own | ⚠ NEEDS HUMAN CONFIRMATION, for the migration only. |
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
- **A hard-deleted user survives only here.** User delete removes the row; the log's copy of the hash is the last one.
- **Nothing expires.** There is no time limit on undo and no pruning of the log.
- **The precedent for doing it right exists.** User creation and update already exclude the password and its hash (`users.ts:430-450, 967-986`). Person delete records a trimmed view snapshot beside a full undo payload (`packages/core/src/modules/customers/commands/people.ts:1431-1451`).
- **Two writers reach the log without the bus:** sales status history (`packages/core/src/modules/sales/lib/statusHistory.ts:16`) and the trace row written on undo, which copies the snapshots (`command-bus.ts:746-778`). Neither carries the replay payload.
- **Two readers use the replay payload:** warranty replacement-order undo and enterprise record locks. Neither reads the resource kinds this spec touches.

## 📝 Proposed Solution

1. **The bus** stops storing replay input for a command with no undo handler.
2. **Each affected command** declares a replay input without the credential, and an undo payload without the hash.
3. **Restore paths** stop writing a credential they were not given.
4. **A migration** clears the replay payload on existing rows of the affected kinds.
5. **A test per package** asserts that its credential-bearing commands log none.

### What each command records afterwards

| Command | Change | Undo and redo afterwards |
|---|---|---|
| Change password | None in the command; the bus rule applies | As today: never undoable |
| Pay link and template — create, update, delete | Replay input without `password`; undo payload without `passwordHash`; restore leaves the stored hash alone on an existing row | Undo and redo work. Undoing a password change does not bring the old password back; the link keeps its current one |
| Device — register, update | Replay input without the token | Undo works as today. Redo re-creates the device without a token, which is what undo already does |
| Cart merge | Replay input without the source token and route context | Redo is not offered for a merge whose token is gone |
| Delete staff user | Undo payload without `passwordHash` | Undo restores the account, roles and ACL with no password; the user resets it |

### Design decisions

| Decision | Rationale |
|---|---|
| A structural rule in the bus instead of a name list | It cannot miss a name and cannot remove anyone's undo. |
| Restore never writes a credential it was not given | Otherwise removing the hash from the payload turns an unrelated undo into a way to strip a password. |
| Undo is kept wherever the record can be restored without the secret | Losing undo is a cost; the review showed it was avoidable for pay links. |
| The cleanup clears the whole replay payload of the affected kinds | The column is encrypted per tenant; a selective edit would need every tenant's key and a decrypt-edit-encrypt pass. Clearing needs neither. |
| Kinds are selected by `resource_kind` | It is stored in clear; `command_id` is encrypted. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| A central name-based filter now | Deferred to its own spec: the matcher's word rules, tenant-defined custom-field keys, and the effect on third-party undo are unresolved. |
| Make credential-carrying actions non-undoable | First draft. Unnecessary for pay links, and unsafe without fixing restore. |
| A resumable CLI that decrypts, edits and re-encrypts | Operators who never run it stay exposed with no signal; it must handle plaintext, encrypted, mixed and undecryptable rows; a second mechanism beside PR #9578's. |
| Stop recording input by default for every command | Redo of every existing undoable command depends on it. |

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

#### MODIFIED Requirement: Undo of pay-link changes
The system SHALL NOT store a pay link's password or its hash in the audit log, and undoing any change to a link SHALL leave the link's current password in place.

##### Scenario: Undo an unrelated edit
- WHEN a protected link's title is edited and the edit is undone
- THEN the title is back and the link is still protected by the same password

##### Scenario: Undo a delete
- WHEN a protected link is deleted and the delete is undone
- THEN the link is back and still protected

Frozen by: `packages/checkout/src/modules/checkout/commands/__tests__/links.audit.characterization.test.ts`

#### MODIFIED Requirement: Replay of device and cart actions
The system SHALL NOT store a push token or a cart merge token in the audit log.

##### Scenario: Device registered
- WHEN a device is registered with a push token
- THEN the audit entry's replay input holds no token

Frozen by: `packages/core/src/modules/devices/commands/__tests__/register.audit.characterization.test.ts`, `packages/core/src/modules/cart/commands/__tests__/merge.audit.characterization.test.ts`

#### ADDED Requirement: Stored credentials are cleared
The system SHALL clear the replay payload of existing audit entries of the affected kinds when it is upgraded.

##### Scenario: After upgrade
- WHEN the upgrade's migrations have run
- THEN no entry of those kinds created before the upgrade holds a replay payload or offers undo

## 📝 Architecture

- **Command bus** (`packages/shared/src/lib/commands/command-bus.ts`): when building the log payload, the replay envelope is written only if the handler is undoable. The bus already has that predicate for undo.
- **Commands**: `checkout` links, templates and their shared restore helper; `devices` register and update; `cart` merge; `auth` user delete. Each uses the existing `redoInput` seam and its own `buildLog`.
- **Migration** in `audit_logs`: sets `command_payload` and `undo_token` to NULL for rows whose `resource_kind` is in the affected list and whose `created_at` precedes the migration. It works tenant by tenant, in bounded batches, because the table's indexes lead with the tenant.
- **Per-package tests**: `core`, `checkout` and `enterprise` each assert on their own commands. Core cannot import the other two.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Commands → log | Their own `buildLog` and `redoInput` | A disabled module logs nothing |
| Migration → rows | SQL on plaintext columns only | Kinds a deployment never used match nothing |

**Affected resource kinds.** Each is read from the command's `buildLog` during implementation and listed in the migration: the security profile, pay links, pay-link templates, user devices, carts (merge), and staff users. Clearing every staff-user entry also removes the legacy plaintext passwords.

## 📝 Data Models

No entity, table or column changes. Row values change: `command_payload` and `undo_token` become NULL on historical rows of the affected kinds. The data-model graph is skipped because the schema is untouched.

## 📝 API Contracts

- **No new surface.** No type, route, command or setting is added.
- **Audit list API** — unchanged in shape. Historical entries of the affected kinds return a null `undoToken`.
- **Behaviour of undo** for staff-user delete changes as described; it is tracked as a contract in `BACKWARD_COMPATIBILITY.md`.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Undo of a staff-user delete made before the upgrade | Not offered: the migration cleared it |
| Undo of a title edit on a protected link, after a later password change | Title restored; current password kept |
| Undo of a link *creation* | The link is removed, as today |
| Redo of a device registration | Device restored without a token; the app re-registers its token on next start |
| A command with no undo handler that a module later makes undoable | Its earlier rows have no replay payload and cannot be redone; new rows can |
| A third-party command with no undo handler | Its input is no longer stored. Nothing could replay it before |
| A third-party undoable command that logs a secret | Unchanged, and still stored. The deferred check is what addresses it |
| An older entry of the same record becoming "latest undoable" | Cannot happen through this change: the migration clears every earlier entry of the affected kinds together |
| Migration interrupted | Batches are independent; re-running continues, and cleared rows match nothing |
| Backups and any query-index copy of audit rows | Still hold the old values; the upgrade note says so |

## 📝 Migration & Backward Compatibility

| Change | Route |
|---|---|
| No replay input for commands without an undo handler | Behaviour-neutral: the data could not be used. Dated entry |
| Pay-link, device and cart commands record no credential | Defect fixes; undo behaviour preserved except that a password change cannot be undone |
| Staff-user delete: undo restores no password | Ordinary protocol. That undo's behaviour is a tracked contract; announced in the release that ships it, with an upgrade note |
| Historical rows lose their replay payload | Irreversible. Argued as PR #9578 argues its own migration; needs a named maintainer |

- **`UPGRADE_NOTES.md`:** which past actions can no longer be undone; that a restored staff user must reset their password; that installations without tenant encryption have held these values in clear; that backups taken before the upgrade remain sensitive and a reindex should follow.
- **`BACKWARD_COMPATIBILITY.md`:** PR #9578 reports the file within ten bytes of its size budget. The dated entry here must fit, or the budget is raised in a change of its own first.
- **Coordination with PR #9578:** it clears MFA rows by the same mechanism. The two migrations select different resource kinds and can land in either order; both append to the same two documents.

## 📋 Phasing

| Phase | Outcome | Behaviour change |
|---|---|---|
| 1 | Characterization tests | None |
| 2 | Bus rule; command fixes; per-package tests | As listed |
| 3 | Migration | Historical rows cleared |

Phase 2 ships as one PR per package (`shared`, `core`, `checkout`); the enterprise package needs none.

## 📋 Implementation Plan

### Phase 1 — Prove it
1. **Characterize.** Add the six tests named under Delta. Each runs the command against a recording log service and asserts what is stored today. Commit them alone, green. A row whose assertion cannot be made true leaves the Problem Statement.

### Phase 2 — Stop it
1. Bus: write the replay envelope only for an undoable handler. Update the bus characterization test. Unit test that an undoable command is unaffected.
2. Pay links and templates: replay input without the password; undo payload without the hash; restore leaves the stored hash alone on an existing row and sets none on a re-created one. Unit tests for both Delta scenarios and for undoing a password change.
3. Devices: replay input without the token, for register and update.
4. Cart merge: replay input without the source token and route context.
5. Staff-user delete: undo payload without the hash; undo restores without it.
6. Per-package tests listing each package's credential-bearing commands and asserting no credential key in what they log.
7. `UPGRADE_NOTES.md`, the dated compatibility entry, the audit-log docs page.
8. Integration tests TC-AUDIT-SECRETS-001 and 002.

### Phase 3 — Clean it
1. Add the migration with the resource kinds confirmed from each `buildLog`. Unit-test the batch statement against a database with rows of affected and unaffected kinds, encrypted and plaintext, with and without a tenant.
2. Integration test TC-AUDIT-SECRETS-003.
3. Archive this Delta into `.ai/specs/capabilities/command-audit-secrets.md` if that directory has been adopted by then; it does not exist today.

### File manifest

| File | Action |
|---|---|
| `packages/shared/src/lib/commands/command-bus.ts` | Modify |
| `packages/checkout/src/modules/checkout/commands/{links,templates,shared}.ts` | Modify |
| `packages/core/src/modules/devices/commands/{register,update}.ts` | Modify |
| `packages/core/src/modules/cart/commands/merge.ts` | Modify |
| `packages/core/src/modules/auth/commands/users.ts` | Modify |
| `packages/core/src/modules/audit_logs/migrations/*` and the module snapshot | Create |
| The six characterization tests; per-package credential tests in `core` and `checkout` | Create |
| `packages/core/src/modules/audit_logs/__integration__/TC-AUDIT-SECRETS-00{1..3}.spec.ts` | Create |
| `UPGRADE_NOTES.md`, `BACKWARD_COMPATIBILITY.md`, audit-log docs page | Modify |

## 🧪 Integration Coverage

The replay payload is never returned by the API and is encrypted at rest, so the tests assert behaviour. Each creates its fixtures through the API and removes them.

| Test | Path | Covers |
|---|---|---|
| TC-AUDIT-SECRETS-001 | `DELETE /api/auth/users`, the audit undo route, `POST /api/auth/login` | Delete a staff user, undo; the account exists again; the old password does not sign in; after `mercato auth set-password` the new one does |
| TC-AUDIT-SECRETS-002 | Checkout link routes, the audit undo route, the public link route | A protected link's title edit is undone and the link still demands its password; a protected link is deleted, the delete undone, and it still demands its password |
| TC-AUDIT-SECRETS-003 | Audit list API | An entry of an affected kind, inserted directly with an earlier timestamp before the migration is re-applied to the test database, returns a null `undoToken` afterwards; an entry of an unaffected kind is unchanged |

Password change is covered by the bus unit tests, since the rule lives there. Device and cart replay input is unit-tested, because redo of those actions is not observable through the API. The Undo control in the audit-log list is unchanged for new actions.

## 📝 Risks & Impact Review

#### Past actions can no longer be undone
- **Scenario**: An administrator wants to undo a staff-user deletion made the day before the upgrade.
- **Severity**: Medium
- **Affected area**: historical entries of the affected kinds
- **Mitigation**: The upgrade note says so before the upgrade; the snapshot columns are untouched, so the history still shows what changed.
- **Residual risk**: The undo is gone. That is the cost of clearing an encrypted column without every tenant's key.

#### A restored user cannot sign in
- **Scenario**: Undo of a user delete returns an account with no password.
- **Severity**: Medium
- **Affected area**: staff users
- **Mitigation**: The reset flow and the CLI both set a password; redo of user creation already behaves this way.
- **Residual risk**: An account without a working email needs an administrator.

#### A restore path still writes a credential
- **Scenario**: One of the restore helpers keeps assigning a hash from a payload that no longer has one, and nulls a live password.
- **Severity**: High
- **Affected area**: pay links and templates
- **Mitigation**: The restore rule is part of the same step as the payload change; both Delta scenarios are tested at unit and integration level.
- **Residual risk**: Low once those tests exist.

#### A leaking command was missed
- **Scenario**: Another command stores a secret in its replay input.
- **Severity**: High
- **Affected area**: any undoable command whose input carries a secret
- **Mitigation**: The independent review searched command files and found the device-update and cart-merge cases, now included. Commands without an undo handler are covered structurally.
- **Residual risk**: Undoable commands in third-party modules, and any first-party one both passes missed. The deferred central check is the control for those.

#### The migration is slow or locks the table
- **Scenario**: A large audit table is updated in one statement.
- **Severity**: Medium
- **Affected area**: upgrade window
- **Mitigation**: Tenant by tenant, in bounded batches, on indexed columns.
- **Residual risk**: Upgrade time grows with the number of affected rows.

#### Old copies remain elsewhere
- **Scenario**: Backups and any index copy of audit rows still hold the values.
- **Severity**: Medium
- **Affected area**: backups, `query_index`
- **Mitigation**: Stated in the upgrade note.
- **Residual risk**: Backups cannot be rewritten.

## Final Compliance Report — 2026-11-16

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `.ai/specs/AGENTS.md` — in full
- `BACKWARD_COMPATIBILITY.md` — protocol, Emergency Security Exception
- `.ai/qa/AGENTS.md` — test placement
- Not reviewed: `packages/shared/AGENTS.md`, the `auth`, `cart` and `checkout` module guides; the implementer reads them.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Never bypass command side effects | Compliant | Uses the bus's own seams |
| root AGENTS.md | Never commit or log credentials | Compliant | This is the fix |
| root AGENTS.md | Ask before touching multiple modules | Needs approval | `shared`, `auth`, `devices`, `cart`, `checkout`, `audit_logs` |
| root AGENTS.md | Migration workflow | Compliant | Data-only migration with the module snapshot |
| `BACKWARD_COMPATIBILITY.md` | Protocol | Compliant | Ordinary route for the tracked undo; the migration needs a named maintainer; the size budget is flagged |
| `.ai/qa/AGENTS.md` | Integration tests self-contained | Compliant | Fixtures created and removed per test |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Problem table matches the fix table | Pass | Seven rows; one delegated to PR #9578, one covered by the migration |
| Delta scenarios map to tests | Pass | TC or unit test for each |
| Each MODIFIED requirement has a characterization test | Pass | Six, in Phase 1 |
| Every step leaves the app working | Pass | The payload and restore changes ship in the same step |

### Non-Compliant Items
None in the document. Two items need a person: the history migration's waiver, and approval to touch six modules.

### Verdict
**Approved for implementation of Phases 1 and 2.** Phase 3 needs the waiver.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. The review confirmed every stored-credential claim by tracing each command's route, and found: the first draft's pay-link design could strip a live link's password through an unrelated undo; three missed leaks (device update, cart merge, legacy user rows); a structural fix for commands that cannot be replayed; and that the central name-based check was not buildable as specified. The check is split into its own spec; pay links keep undo; history is cleared by migration instead of a CLI.

### Review — 2026-11-16
- **Reviewer**: Agent (fresh context, spec path only), then author revision
- **Security**: One critical design defect corrected; three leaks added
- **Performance**: Migration batched per tenant
- **Cache**: N/A
- **Commands**: Replay and undo semantics specified per command
- **Risks**: Restore-path risk added
- **Verdict**: Revised; the revision has not been independently re-read
