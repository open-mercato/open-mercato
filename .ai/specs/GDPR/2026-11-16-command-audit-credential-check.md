# Credential check on logged commands

> **Program:** split out of package C2 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Follows:** [`2026-11-16-audit-snapshot-redaction.md`](2026-11-16-audit-snapshot-redaction.md), which fixes the known commands and the commands that cannot be replayed.
> **Verified at** `main` @ `08dada9624` by reading code; the matcher's failure cases come from the independent review of the parent spec.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-16-audit-snapshot-redaction.md

## 📝 TLDR

After the parent spec, the known credential-bearing first-party commands no longer write passwords or tokens into the audit log, and commands with no undo handler write no replay input. What remains is every undoable command nobody has looked at, and every third-party module's commands: nothing tells their authors when one logs a credential. **Proposed (future):** the command bus inspects what it is about to log for keys that name a credential and reports any it finds, by key name only. A module's own tests can turn that report into a failure. It changes nothing that is stored.

**Not in this spec:** removing the detected values from the row. That step is rejected (assumption 1): it would silently take undo away from third-party actions and from entities with tenant-defined field names, and a name match is not proof of a credential.

## 📝 Overview

> **Market reference.** Rails ships a default `filter_parameters` list of partial key names and lets an application extend it; Sentry's server-side scrubbing does the same and adds "safe fields" to exempt false positives. Adopted: a default word list, word-based matching, and declared safe keys. Rejected: acting on a match by rewriting stored data, which both of those tools do, because here the stored data is what undo replays.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Report, or strip | Report only | Decided; the program's C2 row records it. A strip would remove undo from third-party actions without their authors knowing, and a name match also hits harmless keys, so it would destroy legitimate replay data. The known credential-bearing commands are fixed by declaration in the parent spec; for the rest, the report names the command so its author fixes it with `redoInput` or `replayable: false`. |
| 2 | Failing tests on a match | Opt-in through one variable, set in first-party test configuration | A throw by default would break third-party test suites on a minor upgrade; 102 first-party test files touch the bus. |
| 3 | When the check runs | Once, on the assembled log payload, before persistence; any test failure is raised after commit | The command's own remedies — a replay input without the secret, a non-replayable action, a safe path — are only known after it has run and built its log entry. Checking the raw input first would fail commands that already do the right thing. |
| 4 | Tenant-defined keys | Not inspected | Custom-field keys are data. A tenant naming a field "token" must not trigger a report on every save. |

## 📝 Problem Statement

- The bus stores a command's input as its replay payload unless the command declares otherwise (`packages/shared/src/lib/commands/command-bus.ts:1036-1042`), and stores snapshots, an undo payload, a change set and a context.
- A command with no `buildLog` is still logged when caller metadata, an interceptor's `logContext`, or a snapshot makes its metadata non-null (`command-bus.ts:385-431`).
- The parent spec identifies credential-bearing replay input in checkout link/template commands, device registration/update, cart merge and the security password change. Its structural bus rule handles the password command with no undo handler; its per-command fixes handle the replayable cases. The same pattern can exist in any other undoable command.
- A name-only matcher designed too simply fails both ways. Misses seen in review of an earlier attempt: `secretKey`, `privateKeyPem`, `tokenValue`. Further misses to design for: plurals (`credentials`, `recoveryCodes`), `pwd`, `passphrase`, `pin`, `signingKey`, `accessKey`, `jwt`, `bearer`, `salt`, `signature`, `otpauthUrl`, `connectionString`, and `totp` not matching `otp`. False positives: `passwordPolicy`, `cookieConsent`, `authorizationStatus`, `credentialType`, and `tokenHash` on a form invitation.
- Custom-field values travel inside `custom`, `customFields`, `customValues` and `cf`, and as top-level `cf_<key>` changes (`command-bus.ts:170-191`; `packages/shared/src/lib/custom-fields/keys.ts`). Their keys are chosen by tenants.
- Two writers reach the log without the bus: sales status history and the trace row written on undo.

## 📝 Proposed Solution

### What is inspected

Inspect both the assembled execute log payload and every new undo trace's assembled payload before persistence. Execute includes the replay input, undo payload, both snapshots, changes and context. The undo trace has only the mapped roots it actually persists and can copy legacy snapshots, changes and context from a retained source row. Apply the same bounds and sanitization. Undo does not inherit arbitrary safe paths from persisted legacy log metadata. At every depth, skip the complete subtree of `custom`, `customFields`, `customValues`, `custom_fields`, `custom_values` and `cf`, and any key starting with `cf_` or `cf:`. Apply this before tokenizing keys, including top-level keys in request bodies and inferred change sets. These are tenant-defined data.

### How a key matches

1. **Split** the key into lower-case words: on any character that is not a letter or digit; between a lower-case letter and an upper-case one; between a run of capitals and a following capitalized word; and between letters and digits. `privateKeyPem` → `private`, `key`, `pem`; `APIKey` → `api`, `key`; `OAuth2Token` → `o`, `auth`, `2`, `token`; `x-api-key` → `x`, `api`, `key`.
2. **Exceptions before exemptions.** An adjacent pair in the following table, or `password` followed by a final `hash`, is a candidate even if its final word is otherwise exempt. Use the plural normalization in rule 4 to compare pairs. Thus `otpauthUrl`, `accessKey`, `recoveryCodes` and `passwordHash` remain candidates.

| Single words | Adjacent pairs |
|---|---|
| `password`, `passwd`, `pwd`, `passphrase`, `secret`, `token`, `jwt`, `bearer`, `otp`, `totp`, `pin`, `credential`, `authorization`, `cookie`, `salt`, `signature` | `api key`, `private key`, `signing key`, `access key`, `recovery code`, `connection string`, `otpauth url` |

3. **Final-word exemptions.** Unless rule 2 applies, do not match when the original final word is `id`, `at`, `count`, `fingerprint`, `hint`, `enabled`, `required`, `expires`, `length`, `version`, `policy`, `status`, `type`, `consent`, `label`, `prefix`, `usage`, `limit`, `digits`, `mode`, `fields`, `name`, `url`, `ref`, `image`, `banner`, `enc`, `encrypted` or `hash`. `tokenHash`, `passwordPolicy` and `passwordUpdatedAt` do not match.
4. **Normalize plurals conservatively.** Remove exactly one trailing `s` only when the word does not end in `ss` and the result is a word in the closed single-word or pair vocabulary. Do not remove `es`. `access` stays `access`; `cookies`, `signatures`, `passphrases`, `credentials` and `codes` normalize to their singular forms. A non-exempt key containing a single word or adjacent pair from the table is a candidate.
5. **Check the candidate's value.** Match a non-empty string; a non-empty array containing a non-empty string; or a change-set object with a `from` or `to` side that is such a string or string array. A numeric value, including a change-set side, matches only for `pin`, `otp` or `totp`. Emit one match at the candidate key. Other objects and arrays are traversed without matching the container itself, so `tokenUsage: {…}` and `secretSantaList: [{ name: '…' }]` do not match by their container names.
6. **Safe paths.** Do not match a key path a command lists in `auditSafePaths`. Compare the original structural path in memory, before any diagnostic sanitization. Array indexes use `*`. Never emit the original path.

### Traversal order and limits

- **Order.** Visit the log roots in the fixed order `commandPayload`, `snapshotBefore`, `snapshotAfter`, `changes`, `context`, then each value depth-first, pre-order: object keys in insertion order (`Object.keys`), array elements by index. Matches are emitted in visit order, so the first 50 retained paths are deterministic.
- **Counting.** Every visited value counts as one node: each object, array, key's value and array element, including primitives. The root log object is depth 0; each key or index step adds 1. Skipped tenant-data subtrees and safe-path subtrees are not visited and do not count.
- **Limits.** Exported constants `AUDIT_CREDENTIAL_CHECK_MAX_DEPTH = 32` and `AUDIT_CREDENTIAL_CHECK_MAX_NODES = 20000`. A value at depth greater than the depth limit is not visited: its subtree is skipped and the scan continues with the next sibling. The node that would exceed the node limit stops the whole scan; matches found before it are kept.
- **Cycles and shared references.** A shared reference reached by two paths is visited at each path, as JSON serialization would store it twice. An object already on the current ancestor path is a cycle: its subtree is skipped with reason `cycle` and the scan continues. Such a payload cannot be serialized anyway.
- **Reporting a limit.** Hitting any limit yields `truncated: 'depth' | 'nodes' | 'cycle'` (the highest-precedence reason met during the scan, in the order `depth`, `nodes`, `cycle`, regardless of which was met first) and one `reportError` with code `commands.audit_check_limit` per command execution, carrying only the reason and the root name. It does not throw in test mode. The scan outcome is still reported for the matches found.

### What happens on a match

- Call the shared telemetry runtime's `reportError` for every occurrence, with stable code `commands.audit_credential_key` and the registered command id. Never sample, throttle or suppress at the bus or facade; volume control belongs to the collector and backend.
- Diagnostics use only closed-vocabulary segments: log roots (`commandPayload`, `snapshotBefore`, `snapshotAfter`, `changes`, `context`), envelope segments (`undo`, `redo`, `input`, `before`, `after`, `from`, `to`), and recognized credential words. Replace all other key segments, including map keys, with `*`; arrays also use `*`. Canonicalize credential segments from recognized words, never the original key spelling. Deduplicate, retain at most 50 paths and cap each at 256 characters. No identifier, email, token, tenant field name or value reaches telemetry, exceptions or fallback logs. Use `auditKeyPaths` for this sanitized string and test it through the facade's redactor.
- Persist the row unchanged. Only `NODE_ENV === 'test'` honours `OM_AUDIT_CREDENTIAL_CHECK=throw`. In that mode, raise the sanitized diagnostic after the row's transaction commits and normal post-commit side effects finish. On undo, capture the diagnostic before `markUndone`, then raise only after atomic commit (including ambient transaction ownership) or successful legacy finalization and normal post-commit hooks, outside the catch that would release an undo claim; never throw inside an atomic log transaction. The test failure does not mean the command rolled back.
- Outside test mode, `throw` degrades to reporting, with one configuration warning per process through `createLogger`; it never fails a committed mutation. The warning contains the setting name only. Matches themselves are still reported on every execution.

### Design decisions

| Decision | Rationale |
|---|---|
| Paths, not bare key names, for the safe list | The same key can be harmless in one place and a secret in another. |
| A closed, documented word list | An author must be able to predict a match. |
| Every occurrence is reported | Source throttling loses evidence; collectors and backends own volume controls. |
| Test-only throw after commit | Production callers must never retry a successful mutation because this diagnostic failed it. |
| Sanitized structural paths | Data-derived map keys must not become telemetry attributes or log messages. |
| The two writers that bypass the bus are documented, not wrapped | Neither stores a replay payload; wrapping them is a separate change. |

| Alternative | Why rejected |
|---|---|
| Strip on match | Silently removes undo and destroys replay data on false positives; see assumption 1. |
| Match on values (entropy, formats) | False positives on ids and hashes; no author can predict it. |
| Throw by default in tests | See assumption 2. |

## 📝 Delta

### Capability: command-audit-secrets

#### ADDED Requirement: Credential check on logged commands
The system SHALL detect credential-named keys in what a command is about to log and SHALL report them by sanitized structural path, without recording their values and without changing what is stored.

##### Scenario: Unknown command
- WHEN a third-party undoable command logs an input containing `clientSecret`
- THEN an error naming the command and a sanitized structural path is reported on every occurrence, and the row is stored unchanged

##### Scenario: Declared safe path
- WHEN a command lists a matching path as safe
- THEN nothing is reported

##### Scenario: Tenant-defined field
- WHEN a record with a custom field named `token` is saved inside a tenant-data container or as `cf_token` or `cf:token`, at the top level or nested, including a `{ from, to }` change
- THEN nothing is reported or thrown for that subtree

##### Scenario: Opt-in failure
- WHEN `NODE_ENV` is `test`, the check variable is `throw` and a command's assembled log payload matches
- THEN the row commits unchanged, post-commit side effects finish, and the test receives a sanitized failure

##### Scenario: Production configured to throw
- WHEN `NODE_ENV` is `production` and the check variable is `throw`
- THEN each match is reported, one configuration warning is logged, the audit row persists and the caller receives the successful result

##### Scenario: Data-derived map key
- WHEN an email-keyed map contains a `passwordHash` change with string `from` and `to` values
- THEN a diagnostic with a wildcard map segment is emitted; the email and both values appear nowhere in telemetry, errors or fallback logs

##### Scenario: A command that already strips its secret
- WHEN a command accepts a password and declares a replay input without it
- THEN nothing is reported

## 📝 Architecture

- **`packages/shared/src/lib/commands/auditSecrets.ts`** (new): `findCredentialKeyPaths(value, options)` — pure, synchronous, no I/O; returns `{ paths: string[]; truncated: null | 'depth' | 'nodes' | 'cycle' }`. Exports `AUDIT_CREDENTIAL_CHECK_MAX_DEPTH` and `AUDIT_CREDENTIAL_CHECK_MAX_NODES`.
- **Command bus**: computes matches once on the assembled payload before log persistence; reports without changing persistence, and raises test-only failure after commit and normal post-commit work.
- **`CommandLogMetadata.auditSafePaths?: readonly string[]`** — new optional field.
- **Reporting**: the telemetry runtime the shared package already uses, with a structured `createLogger` error line when no backend is configured. Both use the same sanitized diagnostic, and no occurrence is throttled.
- **First-party jest setup** sets the variable.

## 📝 Data Models

None.

## 📝 API Contracts

- `@open-mercato/shared/lib/commands/auditSecrets` — `findCredentialKeyPaths`, exported so module authors can assert on their own commands.
- `CommandLogMetadata.auditSafePaths` — optional.
- `OM_AUDIT_CREDENTIAL_CHECK` — unset (report) or `throw` (honoured only with `NODE_ENV=test`; otherwise warn once and report).
- `findCredentialKeyPaths(value, options): { paths: string[]; truncated: null | 'depth' | 'nodes' | 'cycle' }` returns sanitized paths only, in visit order. Original paths used for safe-list matching never leave the matcher. `AUDIT_CREDENTIAL_CHECK_MAX_DEPTH` (32) and `AUDIT_CREDENTIAL_CHECK_MAX_NODES` (20000) are exported constants; changing either is a behaviour change recorded in `UPGRADE_NOTES.md`. The traversal-limit code is `commands.audit_check_limit`, with the reason and root name only.
- Reported error code `commands.audit_credential_key`.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Deeply nested or very large payload | Beyond depth 32 the subtree is skipped and the scan continues; at 20000 nodes the scan stops. Either is reported once per execution as `commands.audit_check_limit`; matches found before the limit are still reported |
| Cyclic object | The repeated ancestor's subtree is skipped with reason `cycle` |
| Arrays of objects | Each element is inspected; the path uses an index wildcard |
| A credential under an innocuous key such as `value` | Not detected; stated in the author documentation |
| The same match on every execution | Every occurrence reported; no source limiter |
| `throw` set outside tests | Warn once about configuration, report every match, persist the row and return success |
| Data-derived ancestor key | Replace with `*` before any diagnostic leaves the matcher |
| Test failure after mutation | Persisted state remains; test owns cleanup, including audit entries |
| A first-party command that trips the check when the variable is first set | Fixed or given a safe path in the same change |
| Telemetry backend absent | A structured error-level log line |

## 📝 Migration & Backward Compatibility

Additive: `CommandLogMetadata.auditSafePaths` is an optional §2 member; `@open-mercato/shared/lib/commands/auditSecrets` / `findCredentialKeyPaths` is a new §4 file subpath through existing wildcard exports, stable once released; `OM_AUDIT_CREDENTIAL_CHECK` is a new variable. No stored data changes. `UPGRADE_NOTES.md` tells module authors that reports may appear and how to resolve one: `redoInput`, `replayable: false`, or a safe path.

## 📋 Implementation Plan

1. Add `auditSecrets.test.ts`: every Problem Statement example in camel, snake and kebab case; every word, pair and exempt suffix; `accessKey`, `otpauthUrl`, cookies, signatures, passphrases, `recoveryCodes: string[]`, a `{ from, to }` `passwordHash` and numeric OTP; empty values; safe paths. Traversal bounds: a credential key at depth 31, 32 and 33 (found, found, skipped with `truncated: 'depth'` while a later sibling at depth 1 is still found); a payload of 19999, 20000 and 20001 nodes with a credential as the last node (found, found, not found with `truncated: 'nodes'`); deterministic match order across roots and insertion order; a shared reference reported at both paths; a cycle skipped with `truncated: 'cycle'`; a cycle met before a depth skip reports `truncated: 'depth'`, and a cycle met before the node limit reports `truncated: 'nodes'`. Test raw bodies and change sets with top-level and nested `cf_token` and `cf:token`, and every skipped container, in report and throw modes. Test email-, external-id- and token-keyed maps and a credential-like key containing an email; diagnostics carry only canonical vocabulary and wildcards, within the length and count caps.
2. Add `command-bus.audit-secrets.test.ts`: unchanged rows, every repeated occurrence reported, test-only failure after commit and post-commit side effects, production and development `throw` returning success with one warning, no secret in messages or attributes, and a stripped replay input causing no report. Test atomic and non-atomic execute and undo paths, including ambient transaction rollback, retained legacy source rows whose copied trace contains a diagnostic match, committed trace and consumed claim in test throw mode, and facade redaction. No throttle or throttle test.
3. Set the variable in first-party jest setups that register commands. Fix or declare matches command by command. This affects test configuration only; no deployment default sets `throw`.
4. Add TC-AUDIT-CHECK-001 below, author documentation and the `UPGRADE_NOTES.md` note, including committed-state semantics of a test failure.
5. Archive the Delta if the capabilities directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/lib/commands/auditSecrets.ts` and tests | Create |
| `packages/shared/src/lib/commands/{command-bus,types}.ts` | Modify |
| First-party jest setup files | Modify |
| `packages/core/src/modules/audit_logs/__integration__/TC-AUDIT-CHECK-001.spec.ts`, `packages/core/src/helpers/integration/commandBusChild.ts` | Create — real log persistence and diagnostic boundary in a child process with its own environment |
| Commands that trip the check | Modify |
| Docs, `UPGRADE_NOTES.md` | Modify |

## 🧪 Integration Coverage

No API or UI contract changes. Unit tests cover the matcher and bus; first-party command suites run in test-only throw mode. TC-AUDIT-CHECK-001 exercises the bus with the real `actionLogService` and a test-registered undoable command in its own fixture tenant, with a recording telemetry bridge.

**Harness.** New `packages/core/src/helpers/integration/commandBusChild.ts` exports `runCommandInChild({ appRoot, env, tenantId, organizationId, actorUserId, executions })`. It spawns a Node child (`process.execPath`) with the environment it is given (`NODE_ENV` and `OM_AUDIT_CREDENTIAL_CHECK` set per case; the database URL and the encryption and lookup secrets the ephemeral app itself uses, so rows are sealed under the same keys), so no setting of the running shared app changes. The child bootstraps in process with `bootstrapFromAppRoot` and `createRequestContainer`, as `helpers/integration/queue-runner.ts` and `entities/__integration__/TC-ENTITIES-009-encryption-map-concurrency.spec.ts` already do; registers the test command `test.audit_check.secret_command` in the child's command registry only; installs a recording telemetry bridge and a recording logger sink; executes the command through `commandBus.execute` with the fixture actor's auth context; and writes one JSON line to stdout per execution with the result status, the action-log id, every recorded report (code and attributes) and every fallback log line, then exits. Nothing is registered in the shared app process.

Two production-mode executions with `OM_AUDIT_CREDENTIAL_CHECK=throw` both return success, persist unchanged rows and report twice; an email-keyed map and `cf_token` change leak no data into either report or fallback logger. Read the rows through `GET /api/audit_logs/audit-logs/actions` as that tenant's fixture actor to verify normal audit availability. A test-mode child proves the row remains committed after the diagnostic failure: its JSON line carries the sanitized failure and the action-log id, which the spec reads back through the API. Each child exits after its case, so the bridge, environment and command registration die with it. In `finally` delete the fixture action-log rows by the returned ids, the actor and the tenant. Never change the running shared app's environment or depend on demo records.

## 📝 Risks & Impact Review

#### False sense of safety
- **Scenario**: Authors read "no report" as "no credential logged".
- **Severity**: Medium
- **Affected area**: third-party and future commands
- **Mitigation**: The documentation states that detection is by name and lists what it cannot see.
- **Residual risk**: Inherent to name-based detection.

#### A reported credential stays stored
- **Scenario**: An unfixed third-party command logs a credential; the check reports it and the row keeps the value.
- **Severity**: Medium
- **Affected area**: `action_logs` rows of that command
- **Mitigation**: Every occurrence is reported with the command id; the author fixes the command with `redoInput` or `replayable: false`; first-party commands are fixed when the test-only throw is first set; the `applyRetention` strip (DEC-B) clears the payload on erasure or by age.
- **Residual risk**: Rows written before the author's fix keep the value until they are stripped; this is the cost of never breaking undo silently.

#### Report noise
- **Scenario**: A harmless key matches on a hot path.
- **Severity**: Low
- **Affected area**: error stream
- **Mitigation**: Exempt final words, safe paths and collector-side volume controls. Every source occurrence remains visible.
- **Residual risk**: Repeated reports until the author declares the path; the collector may aggregate them.

#### A diagnostic exposes a data-derived key
- **Scenario**: A map is keyed by an email or token above a credential-named field.
- **Severity**: High
- **Affected area**: telemetry and local logs
- **Mitigation**: Emit only closed-vocabulary structural segments and canonical credential words; wildcard every other key before any output. Unit and integration tests inspect all sinks.
- **Residual risk**: Key-name detection still misses credentials under innocuous names; it never exports those names to improve detection.

#### The check slows every command
- **Scenario**: Traversing large snapshots on each execution.
- **Severity**: Low
- **Affected area**: command throughput
- **Mitigation**: Pure traversal bounded at depth 32 and 20000 nodes, with one limit report per execution.
- **Residual risk**: Negligible against a database write.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` §2, `packages/shared/AGENTS.md`, `packages/telemetry/AGENTS.md` and the command-bus/custom-field source paths cited above.

| Rule | Status | Notes |
|---|---|---|
| Never emit personal data or credentials | Compliant | Closed-vocabulary diagnostics only; dynamic keys and values never leave |
| Never throttle `reportError` | Compliant | Every occurrence reaches the runtime; volume control is downstream |
| Preserve production mutation results | Compliant | Throw is test-only and follows committed logging |
| Additive changes to command types | Compliant | One optional field |
| Integration coverage | Specified | TC-AUDIT-CHECK-001 owns fixtures, sinks and cleanup; no new UI path |

**Verdict:** design ready. Under program DEC-2, work proposed for OSS requires written upstream maintainer approval naming the carrier before implementation. An independent security fix may proceed on its own named, explicitly approved carrier. The design verdict and ordinary PR review do not grant that approval.

## Changelog

### 2026-11-18 — Review corrections

- Scan undo traces copied from retained history, with test failure deferred until undo and its post-commit effects finish.

### 2026-11-16
- Written autonomously, split out of the audit-snapshot-redaction spec after its review. The matcher rules answer the specific misses and false positives that review listed.
- Revised after independent review: the check moved from before execution to the assembled log payload, because a command's remedies are unknown until it has built its log entry; the `password` exception narrowed to `passwordHash`; at that revision only string values matched (superseded by round-two compound-value rules); the word-splitting rule, the exempt list and the tenant-data containers made exact; reporting adapted to the telemetry facade. Known remaining outcomes: `leaseToken`, `claimToken` and `captchaToken` are reported and need a declared safe path if harmless; `sessionId` and `saltedHash` are not reported.

- Council round two fixes (GPT-6.1 Sol workers): r3e-04 — ordered matcher, conservative plurals and compound values; r3e-05 — tenant-defined keys excluded at every depth; r3e-12 — test-only throw after committed logging; r3e-16 — report every occurrence; r3e-31 — closed-vocabulary diagnostic paths.

- Council round two fixes, pass two (GPT-6.1 Sol workers): checked both C2 carriers and the program; narrowed the parent guarantee to its known commands, removed the stale five-command count, and classified the new matcher file subpath consistently with the contract spec's §4 rules. Report-only persistence and test-only post-commit throw are unchanged.

- Council round two fixes, pass three (GPT-6.1 Sol workers): checked the merged parent/program scope and import/member compatibility references; existing matcher, report-only persistence and test-only post-commit failure already satisfy the remaining packet, with no additional contract change.

### 2026-11-17
- Defined the matcher's traversal contract: fixed root and key-insertion order, node and depth counting, exported limits (depth 32, 20000 nodes), skip-subtree on depth, stop-scan on nodes, cycle and shared-reference handling, one `commands.audit_check_limit` report per execution, and a `truncated` field on `findCredentialKeyPaths`, with boundary tests at limit−1, limit and limit+1.
- Named the TC-AUDIT-CHECK-001 harness: `helpers/integration/commandBusChild.ts` runs each case in a Node child with its own environment, bootstrapped in process as existing integration helpers do, so the shared app is never reconfigured.
- `truncated` reports the highest-precedence reason met (`depth`, then `nodes`, then `cycle`), not the first in time, with a unit case for a cycle met before a depth skip.
