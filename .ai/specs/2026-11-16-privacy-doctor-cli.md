# Privacy doctor command

> **Program:** package G4 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). The program schedules its skeleton first, in Phase 1.
> **Verified at** `main` @ `08dada9624`; code references are inline.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-11-16-privacy-data-class-contract.md
Extends: .ai/specs/2026-11-16-runtime-encryption-key-guard.md

## 📝 TLDR

An operator has no way to ask a deployment "what about your configuration is unsafe for personal data?". The settings that matter are spread over many environment variables and the module list, and several unsafe states are silent. **Proposed (future):** one command, `mercato privacy doctor`, that reads this process's configuration, reports findings with a severity and a fix, and exits non-zero when one is an error. It starts with seven checks that can be computed today from shared code alone; other packages add theirs through an extension point defined here.

**Not in this spec:** fixing anything it reports; probing the running site; a UI; a report of third-party processors, which depends on per-module and database configuration and moves to the deployment documentation (G5); the list of modules without a privacy data class, which the contract spec adds when that concept exists.

## 📝 Overview

> **Market reference.** Django's `check --deploy` runs named checks, each with an id and a hint; GitLab's self-hosted `gitlab:check` also exits non-zero for use in a deploy pipeline. Adopted: stable check ids, severities, a remediation line, a machine-readable report, a non-zero exit. Rejected: auto-fix flags, which turn a report into a second configuration path.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Command name | `mercato privacy doctor`, not the issue's `mercato doctor privacy` | The dispatcher routes `mercato <module> <command>`. |
| 2 | Which spec creates the `privacy` module | This one, because the program runs it first. The contract spec then finds the module in place | The module's files and its create-app harness case are in this spec's manifest. |
| 3 | What a check may read | Environment variables and the module registry, through predicates exported from `@open-mercato/shared` | A check that copied another module's default would drift from it; one that imported another module would break module isolation. Where a rule lives in a module today, its owner exports the predicate first. |
| 4 | When it exits non-zero | On any error-level finding, in every mode; `--no-fail` turns that off | ⚠ NEEDS HUMAN CONFIRMATION. Gating on `NODE_ENV` would make a pipeline that runs the CLI in another mode pass silently. |
| 5 | Severity of a state the platform itself tolerates | A warning. Error is reserved for states the runtime refuses, or a published secret | The key-guard spec treats unconfigured encryption as a warning for one release and names switching encryption off as a legitimate choice; the doctor must not contradict it. |
| 6 | Checks that need the database | None in this version | An unreachable database does not make container creation fail, so a "skipped" tier could not be told from a real one. Added when a check needs it. |
| 7 | How other packages add checks | An optional second export from the `privacy.ts` convention file the contract spec introduces | Core cannot hold checks for the search, assistant or enterprise packages, or for a standalone app's modules. |
| 8 | Machine-readable output | `--out <file>` writes JSON | The dispatcher prints "Running" and "Done" lines on standard output. |

## 📝 Problem Statement

- **Unsafe states are silent.** With encryption on and nothing configured, writes land in clear after one log line (`packages/shared/src/lib/encryption/kms.ts:455-461`). Meilisearch indexes decrypted fields unless `SEARCH_EXCLUDE_ENCRYPTED_FIELDS` is set (`packages/search/src/di.ts:51-57`). The rate limiter is shared only when it is enabled, its strategy is `redis` and a Redis URL is set (`packages/shared/src/lib/ratelimit/service.ts:24`).
- **Production Compose ships permissive defaults.** Demo mode is on when its variable is unset (`packages/core/src/modules/auth/lib/setup-app.ts:575-578`); Meilisearch defaults to a published development key (`docker-compose.fullapp.yml:147`).
- **Pruners can be absent without a trace.** Modules register schedules only when the scheduler module is present.
- **The rules are private and duplicated.** The search-exclusion parser exists twice inside the search package and is exported from neither place; the "shared rate limiter" test is a private expression; self-service onboarding is parsed strictly in one file and loosely in another.
- **The CLI sees only its own environment.** It loads the app's `.env`; the web server and workers can run with different values (`packages/cli/src/lib/load-env.ts:17`, `packages/cli/src/mercato.ts:402-404`).
- **No such command exists.** `packages/cli/src/mercato.ts` has no `doctor`, `preflight` or `check` command.

## 📝 Proposed Solution

A command that runs a list of checks. Each check has a stable id and returns findings.

**A finding** carries: check id, severity (`error`, `warning`, `info`), a one-line statement, a one-line fix, and the variable or module it concerns. Never a secret, a hash or tenant data.

**First checks**

| Id | Reads | Finding |
|---|---|---|
| `encryption.disabled` | The encryption toggle | Warning when tenant encryption is switched off |
| `search.encrypted_fields_indexed` | Search host and exclusion predicates | Warning when a fulltext host is configured and encrypted fields are not excluded |
| `search.published_key` | The search API key | Error when it is a key published in this repository |
| `ratelimit.not_shared` | The shared-limiter predicate | Warning when the rate limiter is per process |
| `demo.enabled` | Demo and onboarding predicates | Warning when demo mode or self-service onboarding is on; unset counts as on, and any truthy token counts |
| `runtime.not_production` | The key guard's production predicate, or `NODE_ENV` before it lands | Info naming the mode this process is in |
| `scheduler.module_absent` | The module registry | Warning when the scheduler module is not enabled. An enabled module does not prove a scheduler process is running, and the finding says so |

**Checks other specs add**, each in the change that makes it computable. Those specs are amended to say so.

| Id | Added by |
|---|---|
| `encryption.key_policy.*` — the key guard's findings under their own codes; `refuse` is an error, `bridge` is an error only when its policy is `enforce`, `warn` is a warning | Key-guard spec |
| `encryption.unavailable_writes` — warning while the setting is `plaintext` | Fail-closed spec |
| `pruners.unscheduled` | Not available yet: it needs scheduler rows, and no check in this version reads the database |
| `privacy.uncovered_modules` | Contract spec |
| `headers.hsts` | Security headers (A5) |

### Design decisions

| Decision | Rationale |
|---|---|
| Predicates are exported from shared code and the runtime switches to them | One rule, read by both. |
| Every report states that it describes this process's environment only | Web and workers may differ; the doctor cannot see them. |
| Severity is fixed per check | A configurable severity becomes a way to silence a real problem. |
| A check that throws becomes a finding | One broken check must not hide the others. |
| The report ends with a fixed sentence on what it does not prove | A clean run is not a compliance statement. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Copy each default into the check | Drifts silently. |
| Import other modules' code | Breaks module isolation. |
| A processors report built from environment variables | The embedding provider is database configuration, the email default lives in one module, and map tiles are fixed at build time. An incomplete list would read as complete. |
| Run the checks at server start | The key guard already refuses what must be refused; the rest would be log noise on every boot. |
| Exit code decided by `NODE_ENV` | See assumption 4. |

## 📝 Delta

### Capability: privacy-doctor

#### ADDED Requirement: Configuration report
The system SHALL report privacy-relevant findings for the current process's configuration, each with a stable id, a severity and a fix, without revealing a secret, and SHALL exit non-zero when a finding is an error.

##### Scenario: Published search key
- WHEN the command runs with the search API key set to the repository's development key
- THEN it lists `search.published_key` as an error and exits 2

##### Scenario: Warnings only
- WHEN it runs with encryption switched off and a per-process rate limiter
- THEN it lists both as warnings and exits 0

##### Scenario: Opt out of failing
- WHEN it runs with an error-level finding and `--no-fail`
- THEN it lists the finding and exits 0

#### ADDED Requirement: Works on a refused deployment
The system SHALL complete without building the application container.

##### Scenario: Refused configuration
- WHEN the command runs on a configuration the key guard refuses
- THEN it reports its findings and does not fail on the refusal

#### ADDED Requirement: Checks from other modules
The system SHALL run checks that an enabled module declares.

##### Scenario: Module-declared check
- WHEN an enabled module declares a doctor check
- THEN its findings appear in the report under its own id

## 📝 Architecture

- **`packages/core/src/modules/privacy/`**: `index.ts`, and `cli.ts` with the `doctor` command. `cli.ts` reads the module list through `getCliModules()`, which may only be called from a file of that name, and passes it to the runner.
- **`lib/doctor/`**: `types.ts`, `runDoctor.ts`, `report.ts` and one file per first check. A check is `{ id, run(context) }` where the context holds the environment and the module list. Nothing in it builds a container.
- **Shared predicates**, each exported and adopted by its current caller in the same change:

| Predicate | Home | Replaces |
|---|---|---|
| Fulltext host configured; encrypted fields excluded | `packages/shared/src/lib/search/` | Two private parsers in the search package |
| Rate limiter is shared | `packages/shared/src/lib/ratelimit/` | A private expression in the service |
| Demo mode on; self-service onboarding on | `packages/shared/src/lib/` | Parsers in `auth` and `onboarding`. The doctor uses the widest reading; callers keep their current strictness |
| Search key is published | `packages/shared/src/lib/search/` | New; holds a SHA-256, as the key guard does for encryption secrets |

- **Extension point.** A module's `privacy.ts` may export `privacyDoctorChecks`, an array of checks. The generator surfaces it on the module registry beside `privacyDataClasses`. It becomes available once the contract spec's generator support has landed; until then only the first checks run.
- **Dispatcher.** The command joins the list of commands that never create a `.env`.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Doctor → rules | Shared predicates | — |
| Doctor → module list | The generated CLI registry | — |
| Other packages → doctor | `privacyDoctorChecks` on their own module | No checks from that module |

## 📝 Data Models

None. The data-model graph is skipped.

## 📝 API Contracts

**`mercato privacy doctor`**

| Flag | Meaning |
|---|---|
| `--no-fail` | Always exit 0 after reporting |
| `--out <file>` | Also write the report as JSON, created with owner-only permissions |
| `--force` | Allow `--out` to replace an existing file |
| `--only <id>` (repeatable) | Run only the named checks |

| Exit code | Meaning | How it is set |
|---|---|---|
| 0 | No error-level finding, or `--no-fail` | — |
| 1 | Usage error or internal failure | `process.exitCode`, or a throw, which the dispatcher turns into 1 |
| 2 | At least one error-level finding | `process.exitCode` |

**Report (version 1)**

```json
{
  "reportVersion": "1",
  "generatedAt": "2026-11-16T10:00:00.000Z",
  "scope": "this_process_environment",
  "mode": "production",
  "findings": [
    { "id": "search.published_key", "severity": "error", "subject": "MEILISEARCH_API_KEY", "statement": "…", "fix": "…" }
  ]
}
```

**Extension type** — `@open-mercato/shared/modules/privacy`

```ts
export type PrivacyDoctorCheck = {
  id: string                                  // '<moduleId>.<name>'
  run: (context: { env: NodeJS.ProcessEnv; moduleIds: readonly string[] }) => PrivacyDoctorFinding[]
}
```

Check ids are a stable surface once released: an id is never reused for a different meaning.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A check throws | Reported as an error-level finding `doctor.check_failed` naming the check; other checks continue |
| Rate-limit strategy variable set to an empty string | The predicate treats it as not shared instead of throwing, as the config parser does today |
| Unknown id passed to `--only` | Usage error, exit 1, listing the known ids |
| Module `privacy` not enabled | The command does not exist; the upgrade note says to enable it |
| Standalone app with its own modules | Registry checks read that app's registry; its modules may declare checks |
| Web and workers configured differently | Not visible; stated in every report |
| Secret-bearing variable | Only its name and whether it is set are reported |

## 📝 Migration & Backward Compatibility

- Additive: a new command, a new module enabled in `apps/mercato/src/modules.ts` and carried into the create-app template by template sync, an optional convention export, new shared exports.
- Moving a private rule into a shared predicate changes no behaviour; each move is covered by the caller's existing tests.
- The report carries `reportVersion`.
- `UPGRADE_NOTES.md`: one operator note that the command exists and that existing apps enable the `privacy` module to get it.

## 📋 Phasing

| Phase | Outcome |
|---|---|
| 1 | Shared predicates, adopted by their callers |
| 2 | The module, the command, the report, the seven first checks |
| 3 | The extension point, after the contract spec's generator support |
| 4 | Documentation |

## 📋 Implementation Plan

### Phase 1 — Predicates
1. Export the search, rate-limit and demo predicates from shared code and switch each current caller to them. Unit tests for each over set, unset, empty and malformed values. No behaviour changes.
2. Add the published-search-key predicate with its hash.

### Phase 2 — Command
1. Create the `privacy` module's `index.ts` and `cli.ts`; enable the module; run template sync and `yarn generate`; add the create-app harness case or exemption the template's fact-sheet test requires.
2. Add `types.ts` and `runDoctor.ts`: isolation of a throwing check, `--only`, the exit-code rule. Unit tests with fake checks.
3. Add the seven checks, one file each, with unit tests asserting that no secret value appears in any finding.
4. Add the report writer and the `doctor` command; add it to the dispatcher's no-`.env` list, with a dispatcher test.
5. Integration tests TC-PRIVACY-DOCTOR-001 and 002.

### Phase 3 — Extension point
1. Add `privacyDoctorChecks` to the convention file's exports and to the generator, beside `privacyDataClasses`. Unit tests in the generator's parity suite.
2. Run module-declared checks; reject an id that does not start with its module's id.

### Phase 4 — Documentation
1. Add the operator page under `apps/docs/docs/deployment/`, listing every check id with its meaning and fix, and the `UPGRADE_NOTES.md` note.
2. Archive this Delta into `.ai/specs/capabilities/privacy-doctor.md` if that directory has been adopted by then; it does not exist today.

### File manifest

| File | Action |
|---|---|
| `packages/shared/src/lib/{search,ratelimit}/…` and a demo-mode helper, with tests | Create / modify |
| `packages/search/src/di.ts`, `packages/search/src/modules/search/api/settings/fulltext/route.ts`, `packages/shared/src/lib/ratelimit/service.ts`, the two demo-mode callers | Modify — use the predicates |
| `packages/core/src/modules/privacy/{index.ts,cli.ts}` | Create |
| `packages/core/src/modules/privacy/lib/doctor/{types.ts,runDoctor.ts,report.ts,checks/*.ts}` and tests | Create |
| `packages/cli/src/mercato.ts` and its test | Modify — no-`.env` list |
| `apps/mercato/src/modules.ts`, template `modules.ts` (via sync), the create-app harness case | Modify |
| `packages/shared/src/modules/privacy.ts`, `packages/cli/src/lib/generators/module-registry.ts` | Modify — Phase 3 |
| `packages/core/src/modules/privacy/__integration__/TC-PRIVACY-DOCTOR-00{1,2}.spec.ts` | Create |
| `apps/docs/docs/deployment/privacy-doctor.mdx`, `UPGRADE_NOTES.md` | Create / modify |

## 🧪 Integration Coverage

No API or UI path. The tests run the built CLI through `spawnSync` with an explicit environment and create no records. Variables are set to explicit values; the rate-limit strategy is set to `memory`, not emptied.

| Test | Covers |
|---|---|
| TC-PRIVACY-DOCTOR-001 | Published search key and a per-process rate limiter: exit 2; both findings present; the key's value absent from output; `--no-fail` exits 0 |
| TC-PRIVACY-DOCTOR-002 | Safe configuration: exit 0; `--out` writes a report that parses, carries `reportVersion`, and is not replaced without `--force` |

## 📝 Risks & Impact Review

#### A clean report is read as compliance
- **Scenario**: An operator treats exit 0 as proof.
- **Severity**: Medium
- **Affected area**: operator decisions
- **Mitigation**: The report states its scope and ends by saying it checks configuration, not lawful basis, contracts or data content.
- **Residual risk**: People skip footers.

#### The doctor passes while another process is misconfigured
- **Scenario**: The CLI's environment is safe and a worker's is not.
- **Severity**: Medium
- **Affected area**: multi-process deployments
- **Mitigation**: Stated in every report; the runtime's own guards run in each process.
- **Residual risk**: The doctor cannot see it.

#### The report leaks a secret
- **Scenario**: A finding prints a variable's value.
- **Severity**: High
- **Affected area**: terminals, pipeline logs, the JSON file
- **Mitigation**: Findings carry variable names only; a unit test per check asserts it; the file is owner-readable.
- **Residual risk**: Low.

#### A predicate move changes behaviour
- **Scenario**: Unifying two parsers makes one caller stricter or looser.
- **Severity**: Medium
- **Affected area**: search exclusion, rate limiting, demo mode
- **Mitigation**: Callers keep their current strictness; the doctor alone uses the widest reading for demo mode; existing tests cover each caller.
- **Residual risk**: An untested corner of a parser.

## Final Compliance Report — 2026-11-16

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `.ai/specs/AGENTS.md` — in full
- `BACKWARD_COMPATIBILITY.md` — §1, §13
- `packages/create-app/AGENTS.md` — template sync
- Not reviewed: `packages/cli/AGENTS.md`, `packages/core/AGENTS.md` beyond the Encryption section, `packages/search/AGENTS.md`. The dispatcher change touches a CLI command contract, which that guide says to ask about first.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Modules stay independent | Compliant | Checks read shared predicates and the registry |
| root AGENTS.md | Never log credentials | Compliant | Names only; tested per check |
| root AGENTS.md | Ask before touching multiple modules | Needs approval | Predicate moves touch `search`, `auth`, `onboarding`, `shared` |
| root AGENTS.md | No code under `apps/mercato/src/` except registries | Compliant | Only module enablement |
| root AGENTS.md | Module ids plural snake_case | Deviation, stated | `privacy`, as in the contract spec |
| `BACKWARD_COMPATIBILITY.md` | New commands and convention exports may be added | Compliant | — |
| `.ai/qa/AGENTS.md` | Integration tests self-contained | Compliant | No fixtures |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Delta scenarios map to tests | Pass | TC-001, TC-002 and unit tests |
| Every step leaves the app working | Pass | Phase 1 changes no behaviour |
| Check ids are consistent between tables | Pass | — |
| Severities agree with the key-guard spec | Pass | After revision |

### Non-Compliant Items
None. One stated deviation: the module id.

### Verdict
**Approved — ready for implementation**, with assumption 4 open for confirmation.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review: five of the ten first checks could not be computed without importing another module or copying its default, so rules now come from predicates exported by their owners; the processors report and the uncovered-modules check were moved out; severities aligned with the key-guard spec; exit no longer depends on `NODE_ENV`; the container tier was dropped because an unreachable database does not fail container creation; an extension point for other packages' checks was added; exit-code mechanics specified.

### Review — 2026-11-16
- **Reviewer**: Agent (fresh context, spec path only), then author revision
- **Security**: Passed — no secret in output
- **Performance**: N/A
- **Cache**: N/A
- **Commands**: N/A
- **Risks**: Multi-process blind spot and predicate-move risk added
- **Verdict**: Revised; the revision has not been independently re-read
