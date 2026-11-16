# Credential check on logged commands

> **Program:** split out of package C2 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Follows:** [`2026-11-16-audit-snapshot-redaction.md`](2026-11-16-audit-snapshot-redaction.md), which fixes the known commands and the commands that cannot be replayed.
> **Verified at** `main` @ `08dada9624` by reading code; the matcher's failure cases come from the independent review of the parent spec.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-16-audit-snapshot-redaction.md

## 📝 TLDR

After the parent spec, a first-party command that can be undone no longer writes a password or token into the audit log, and a command that cannot be undone writes no input at all. What remains is every undoable command nobody has looked at, and every third-party module's commands: nothing tells their authors when one logs a credential. **Proposed (future):** the command bus inspects what it is about to log for keys that name a credential and reports any it finds, by key name only. A module's own tests can turn that report into a failure. It changes nothing that is stored.

**Not in this spec:** removing the detected values from the row. That step would silently take undo away from third-party actions and from entities with tenant-defined field names, and needs evidence from the reports first.

## 📝 Overview

> **Market reference.** Rails ships a default `filter_parameters` list of partial key names and lets an application extend it; Sentry's server-side scrubbing does the same and adds "safe fields" to exempt false positives. Adopted: a default word list, word-based matching, and declared safe keys. Rejected for now: acting on a match by rewriting stored data, which both of those tools do, because here the stored data is what undo replays.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Report, or strip | Report only | ⚠ NEEDS HUMAN CONFIRMATION. The most reversible choice. Stripping is the stronger control, and a maintainer may want it; it is left as a later decision informed by what the reports show. |
| 2 | Failing tests on a match | Opt-in through one variable, set in first-party test configuration | A throw by default would break third-party test suites on a minor upgrade; 102 first-party test files touch the bus. |
| 3 | When the check runs | Once, on the assembled log payload, just before it is written | The command's own remedies — a replay input without the secret, a non-replayable action, a safe path — are only known after it has run and built its log entry. Checking the raw input first would fail commands that already do the right thing. |
| 4 | Tenant-defined keys | Not inspected | Custom-field keys are data. A tenant naming a field "token" must not trigger a report on every save. |

## 📝 Problem Statement

- The bus stores a command's input as its replay payload unless the command declares otherwise (`packages/shared/src/lib/commands/command-bus.ts:1036-1042`), and stores snapshots, an undo payload, a change set and a context.
- A command with no `buildLog` is still logged when caller metadata, an interceptor's `logContext`, or a snapshot makes its metadata non-null (`command-bus.ts:385-431`).
- The parent spec's review found credential-bearing replay input in five first-party commands. The same pattern can exist in any undoable command.
- A name-only matcher designed too simply fails both ways. Misses seen in review of an earlier attempt: `secretKey`, `privateKeyPem`, `tokenValue`. Further misses to design for: plurals (`credentials`, `recoveryCodes`), `pwd`, `passphrase`, `pin`, `signingKey`, `accessKey`, `jwt`, `bearer`, `salt`, `signature`, `otpauthUrl`, `connectionString`, and `totp` not matching `otp`. False positives: `passwordPolicy`, `cookieConsent`, `authorizationStatus`, `credentialType`, and `tokenHash` on a form invitation.
- Custom-field values travel inside `custom` and `cf_*` containers whose keys are chosen by tenants (`command-bus.ts:170-191`).
- Two writers reach the log without the bus: sales status history and the trace row written on undo.

## 📝 Proposed Solution

### What is inspected

The assembled log payload: the replay input as it will be stored, the undo payload, both snapshots, the change set and the context. Not inspected: the contents of the containers the bus treats as tenant-defined data — `custom`, `customFields`, `customValues` and `cf`.

### How a key matches

1. **Split** the key into lower-case words: on any character that is not a letter or digit; between a lower-case letter and an upper-case one; between a run of capitals and a following capitalized word; and between letters and digits. `privateKeyPem` → `private`, `key`, `pem`; `APIKey` → `api`, `key`; `OAuth2Token` → `o`, `auth`, `2`, `token`; `x-api-key` → `x`, `api`, `key`.
2. **Stem** plurals: a trailing `s` or `es` is dropped before comparison.
3. **Match** when the words contain one of these, as a word or as an adjacent pair:

| Single words | Adjacent pairs |
|---|---|
| `password`, `passwd`, `pwd`, `passphrase`, `secret`, `token`, `jwt`, `bearer`, `otp`, `totp`, `pin`, `credential`, `authorization`, `cookie`, `salt`, `signature` | `api key`, `private key`, `signing key`, `access key`, `recovery code`, `connection string`, `otpauth url` |

4. **Do not match** when the key's final word is one of `id`, `at`, `count`, `fingerprint`, `hint`, `enabled`, `required`, `expires`, `length`, `version`, `policy`, `status`, `type`, `consent`, `label`, `prefix`, `usage`, `limit`, `digits`, `mode`, `fields`, `name`, `url`, `ref`, `image`, `banner`, `enc`, `encrypted`, `hash`. One exception: `password` directly followed by a final `hash` matches, so `passwordHash` is reported and `tokenHash`, `passwordPolicy` and `passwordUpdatedAt` are not.
5. **Match only a non-empty string value.** Objects and arrays are traversed, not matched, so `tokenUsage: {…}` and `secretSantaList: […]` are not reported. A number matches only under `pin`, `otp` or `totp`.
6. **Do not match** a key path a command lists in `auditSafePaths`.

### What happens on a match

- One report through the telemetry facade with a stable code, the command id, and the matching key paths joined into one string under an attribute name that the facade's own secret-key filter does not mask. Never a value.
- The facade does not throttle. The bus keeps a per-process record and reports a given command id at most once every ten minutes.
- When `OM_AUDIT_CREDENTIAL_CHECK` is `throw`, the bus throws instead. That happens after the command's own write, which is acceptable in a test and is why nothing but first-party test configuration sets it.
- The row is stored exactly as before.

### Design decisions

| Decision | Rationale |
|---|---|
| Paths, not bare key names, for the safe list | The same key can be harmless in one place and a secret in another. |
| A closed, documented word list | An author must be able to predict a match. |
| Reports throttled per command id | A hot command with a false positive must not flood the error stream. |
| The two writers that bypass the bus are documented, not wrapped | Neither stores a replay payload; wrapping them is a separate change. |

| Alternative | Why rejected |
|---|---|
| Strip on match now | See assumption 1. |
| Match on values (entropy, formats) | False positives on ids and hashes; no author can predict it. |
| Throw by default in tests | See assumption 2. |

## 📝 Delta

### Capability: command-audit-secrets

#### ADDED Requirement: Credential check on logged commands
The system SHALL detect credential-named keys in what a command is about to log and SHALL report them by key path, without recording their values and without changing what is stored.

##### Scenario: Unknown command
- WHEN a third-party undoable command logs an input containing `clientSecret`
- THEN an error naming the command and the key path is reported, and the row is stored unchanged

##### Scenario: Declared safe path
- WHEN a command lists a matching path as safe
- THEN nothing is reported

##### Scenario: Tenant-defined field
- WHEN a record with a custom field named `token` is saved
- THEN nothing is reported

##### Scenario: Opt-in failure
- WHEN the check variable is `throw` and a command's log payload matches
- THEN the command fails

##### Scenario: A command that already strips its secret
- WHEN a command accepts a password and declares a replay input without it
- THEN nothing is reported

## 📝 Architecture

- **`packages/shared/src/lib/commands/auditSecrets.ts`** (new): `findCredentialKeyPaths(value, options)` — pure, synchronous, no I/O.
- **Command bus**: calls it once in the step that persists the log, on the payload about to be written.
- **`CommandLogMetadata.auditSafePaths?: readonly string[]`** — new optional field.
- **Reporting**: the telemetry runtime the shared package already uses, with an explicit log line when no backend is configured.
- **First-party jest setup** sets the variable.

## 📝 Data Models

None.

## 📝 API Contracts

- `@open-mercato/shared/lib/commands/auditSecrets` — `findCredentialKeyPaths`, exported so module authors can assert on their own commands.
- `CommandLogMetadata.auditSafePaths` — optional.
- `OM_AUDIT_CREDENTIAL_CHECK` — unset (report) or `throw`.
- Reported error code `commands.audit_credential_key`.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Deeply nested or very large payload | Traversal is bounded in depth and node count; hitting the bound is reported once as its own code |
| Arrays of objects | Each element is inspected; the path uses an index wildcard |
| A credential under an innocuous key such as `value` | Not detected; stated in the author documentation |
| The same match on every execution | One report per command id per throttle window |
| A first-party command that trips the check when the variable is first set | Fixed or given a safe path in the same change |
| Telemetry backend absent | A structured error-level log line |

## 📝 Migration & Backward Compatibility

Additive: a new optional metadata field, a new export, a new variable. No stored data changes. `UPGRADE_NOTES.md` tells module authors that reports may appear and how to resolve one: `redoInput`, `replayable: false`, or a safe path.

## 📋 Implementation Plan

1. Add the matcher with unit tests: every listed word and pair in camel, snake and kebab case; plurals; each exempt final word; the `passwordHash` and `tokenHash` cases; value rules; custom-field containers; safe paths; the traversal bound.
2. Call it from the bus on the assembled payload. Unit tests: report without a value; row unchanged; throttle; throw mode; a command that strips its secret through its replay input is not reported; the attribute survives the telemetry facade's filter.
3. Set the variable in the jest setup of each first-party package that registers commands — the step lists them. Fix or declare whatever the unit suites then trip, command by command. The review's sample suggests about half of the commands that accept a secret already strip it and will not trip.
4. Author documentation and the `UPGRADE_NOTES.md` note.
5. Archive the Delta if the capabilities directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/lib/commands/auditSecrets.ts` and tests | Create |
| `packages/shared/src/lib/commands/{command-bus,types}.ts` | Modify |
| First-party jest setup files | Modify |
| Commands that trip the check | Modify |
| Docs, `UPGRADE_NOTES.md` | Modify |

## 🧪 Integration Coverage

No API or UI path changes and nothing stored changes, so there is no behaviour to observe through the running app. The integration environment runs in production mode, where the check only reports. Coverage is by unit tests on the matcher and the bus, and by the first-party unit suites running in throw mode.

## 📝 Risks & Impact Review

#### False sense of safety
- **Scenario**: Authors read "no report" as "no credential logged".
- **Severity**: Medium
- **Affected area**: third-party and future commands
- **Mitigation**: The documentation states that detection is by name and lists what it cannot see.
- **Residual risk**: Inherent to name-based detection.

#### Report noise
- **Scenario**: A harmless key matches on a hot path.
- **Severity**: Low
- **Affected area**: error stream
- **Mitigation**: Exempt final words, safe paths, throttling per command.
- **Residual risk**: One report per window until the author declares the path.

#### The check slows every command
- **Scenario**: Traversing large snapshots on each execution.
- **Severity**: Low
- **Affected area**: command throughput
- **Mitigation**: Pure traversal with a depth and node bound.
- **Residual risk**: Negligible against a database write.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` §2. Not reviewed: `packages/shared/AGENTS.md`, `packages/telemetry/AGENTS.md`.

| Rule | Status | Notes |
|---|---|---|
| Never log credentials | Compliant | Reports carry key paths only |
| Additive changes to command types | Compliant | One optional field |
| Integration coverage | N/A | Nothing observable through the running app; stated |

**Verdict:** approved for implementation, with assumption 1 open.

## Changelog

### 2026-11-16
- Written autonomously, split out of the audit-snapshot-redaction spec after its review. The matcher rules answer the specific misses and false positives that review listed.
- Revised after independent review: the check moved from before execution to the assembled log payload, because a command's remedies are unknown until it has built its log entry; the `password` exception narrowed to `passwordHash`; only string values match; the word-splitting rule, the exempt list and the tenant-data containers made exact; reporting adapted to the telemetry facade. Known remaining outcomes: `leaseToken`, `claimToken` and `captchaToken` are reported and need a declared safe path if harmless; `sessionId` and `saltedHash` are not reported.
