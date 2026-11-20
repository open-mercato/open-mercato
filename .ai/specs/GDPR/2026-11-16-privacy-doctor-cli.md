# Privacy doctor command

> **Program:** package G4 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). The program schedules its skeleton first, in Phase 1.
> **Code baseline:** `main` at `08dada9624`.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/GDPR/2026-11-16-privacy-data-class-contract.md
Extends: .ai/specs/GDPR/2026-11-16-runtime-encryption-key-guard.md

## 📝 TLDR

An operator has no way to ask a deployment "what about your configuration is unsafe for personal data?". The settings that matter are spread over many environment variables and the module list, and several unsafe states are silent. **Proposed (future):** one command, `mercato privacy doctor`, that reads this process's configuration, reports findings with a severity and a fix, and exits non-zero when one is an error. It starts with seven checks built from shared predicates and the module registry, after Phase 1 exports the predicates. Checks that depend on other packages are held in this spec's backlog. An opt-in `--database` tier adds counting checks; the default stays configuration-only (R3-4). Other packages add checks through `doctorChecks`, an optional member of their `privacy.ts` default export.

The starter's existing `yarn om doctor` is a separate environment audit (`packages/starter/src/cli.mjs`). The documented Readiness Scanner (`npx mercato-readiness-scanner scan .`, `apps/docs/docs/deployment/readiness-scanner.mdx`) is another: it checks release files and credential hygiene. This command keeps its own checks, report and exits. G4 alone scaffolds the module, with the id `privacy` that program DEC-10 settles. The module shell, the command and its built-in checks are OSS (DEC-2); a check declared by an enterprise module lives in that module.

**Not in this spec:** fixing anything it reports; probing the running site; a UI; the mode of the web server and the workers, which only each process can see and which the key guard checks in that process; a complete report of third-party processors, which belongs to the deployment documentation (G5); the per-package test for tables no privacy declaration covers, which is the table-coverage spec's.

Shared owners are cited by their decision names: R3-2 — “The registry carries the whole `privacy.ts` default export” and R3-3 — “Tenant privacy settings live in `module_configs`” supply declarations/services, and C1's `getPrivacyDoctorChecks` collector carries DEC-I's member under R3-2; DEC-E — “The dev-runtime mark” and R3-11 — “The dev-runner binding is delivered over IPC” belong to the key guard. DEC-H — “The counting-period bridge” belongs to the operational-pruner/forms owners. This spec owns DEC-I — “The doctor's extension point” (the `doctorChecks` member and check shape), R3-4 — “An opt-in database tier for the doctor” and R4-7 — “Doctor database tier and settings”. R4-5 — “Attachment pending-deletion rows” belongs to erasure/table coverage; the doctor consumes the attachments-owned check.

## 📝 Overview

> **Market reference.** Django's `check --deploy` runs named checks, each with an id and a hint; GitLab's self-hosted `gitlab:check` also exits non-zero for use in a deploy pipeline. Adopted: stable check ids, severities, a remediation line, a machine-readable report, a non-zero exit. Rejected: auto-fix flags, which turn a report into a second configuration path.

## 📝 Resolved assumptions

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Command name | `mercato privacy doctor`, not the issue's `mercato doctor privacy` | The dispatcher routes `mercato <module> <command>`. |
| 2 | Which spec creates the `privacy` module | G4 alone creates `index.ts` with `license: 'MIT'`, the initial `cli.ts`, module enablement and template sync; C1 extends it | Program DEC-10 settles the id `privacy`: a mass noun with no plural, like the existing `security`, `content`, `progress` and `availability` ids. A module id is frozen once shipped, so it is fixed before the scaffold. The shell is OSS (DEC-2): one module and one harness case. |
| 3 | What a check may read | By default, environment variables, the module registry and read-only local filesystem probes. With `--database`, counting queries and tenant privacy settings through C1's `createReadOnlyPrivacySettingsService`, on the read-only EntityManager and supplied tenant list (R3-4/R4-7); findings contain counts only | A check that copied another module's default would drift from it; one that imported another module would break module isolation. Where a rule lives in a module today, its owner exports the predicate first. |
| 4 | When it exits non-zero | Exit 2 on any error-level finding, in every mode; `--no-fail` turns that off | Gating on `NODE_ENV` would make a pipeline that runs the CLI in another mode pass silently. The program's G4 row and its doctor acceptance case use the same rule. |
| 5 | Severity of a state the platform itself tolerates | A warning. Error is reserved for states the runtime refuses, a published secret, and one named exception class: an enabled module whose own operation the runtime refuses, or will refuse from the next minor, above a bound because a required secret is absent. Its only member is R5-4's `sso.scim_lookup_secret_missing`: without a lookup secret, SCIM `userName`/email filters keep unlimited SQL equality on plaintext identities, but identities stored as ciphertext are answered from at most 100 and, from the minor after the warning minor, get HTTP 400 above that. The check is therefore an error only when tenant data encryption is enabled, and it is raised from the warning minor so that the operator's gate comes before the refusal. A new member needs a program decision | The key-guard spec treats unconfigured encryption as a warning for one release and names switching encryption off as a legitimate choice; the doctor must not contradict it. DEC-12's warning minor governs the key guard's lookup-secret findings, not this module-declared check; `--no-fail` still lets a pipeline accept the finding deliberately. |
| 6 | Checks that need the database | Run only with `--database`, declared with `needs: 'database'` | R3-4. Connection or check failure is an error finding, never a clean skipped run. The default creates no container or database connection. |
| 7 | How other packages add checks | `doctorChecks`, an optional member of the `privacy.ts` default object; checks-only declarations use `dataClasses: []`. No further generator change | C1 Export shape under R3-2, “The registry carries the whole `privacy.ts` default export”, supplies optional `Module.privacy` and the derived `Module.privacyDataClasses` bridge. Default-only is the deliberate convention policy; existing generators support named fallbacks for other conventions. |
| 8 | Machine-readable output | `--out <file>` writes JSON | The dispatcher prints "Running" and "Done" lines on standard output. |
| 9 | Whether the doctor reports a service running outside production or under the development runner's mark | No. It reports the mode of its own process and states in every report that it cannot see another process's mode | The CLI process cannot observe the web server or the workers (DEC-E). The key guard implements R3-11, “The dev-runner binding is delivered over IPC”; it checks each process at its own start: a development mark without a valid binding to the live development runner is treated as production, so the refusal applies, and is logged once at error level. |
| 10 | Who owns a check that needs another spec’s code | This spec owns backlog delivery; checks explicitly declared by a consumer spec stay with that module | Built-ins use shared predicates; module checks and count factories remain module-owned. No duplicate aggregate check substitutes for them. |
| 11 | Name of the scheduler-owned diagnostic | `pruners.unscheduled`, declared only by `scheduler`, as named by the operational-pruner owner | The doctor owns delivery; scheduler owns its counting query. This exact scheduler/id pair is the sole check-id prefix exception; service keys retain the scheduler prefix. |

## 📝 Problem Statement

- **Unsafe states are silent.** With encryption on and nothing configured, writes land in clear after one log line (`packages/shared/src/lib/encryption/kms.ts:455-461`). Meilisearch indexes decrypted fields unless `SEARCH_EXCLUDE_ENCRYPTED_FIELDS` is set (`packages/search/src/di.ts:51-57`). The rate limiter is shared only when it is enabled, its strategy is `redis` and a Redis URL is set (`packages/shared/src/lib/ratelimit/service.ts:24`).
- **Production Compose ships permissive defaults.** Demo mode is on when its variable is unset (`packages/core/src/modules/auth/lib/setup-app.ts:575-578`); Meilisearch defaults to a published development key (`docker-compose.fullapp.yml:147`).
- **Pruners can be absent without a trace.** Setup code registers schedules only when `schedulerService` is registered, for example `customer_accounts/setup.ts` and `communication_channels/setup.ts`.
- **The rules are private and duplicated.** The search-exclusion parser exists twice inside the search package and is exported from neither place; the "shared rate limiter" test is a private expression; self-service onboarding is parsed strictly in one file and loosely in another.
- **The CLI sees only its own environment.** It loads the app's `.env`; the web server and workers can run with different values (`packages/cli/src/lib/load-env.ts:17-20`).
- **No such mercato command exists.** `packages/cli/src/mercato.ts` has no `doctor`, `preflight` or `check` command. The starter already has `yarn om doctor`; it does not supply this module command.
- **The Readiness Scanner covers a different layer.** It is a standalone `npx` package, run against a standalone app in CI and inside each deployed workload; it reads `.env` and Compose files and the environment, flags weak, default and published credentials, and never contacts the database or loads the module registry (`apps/docs/docs/deployment/readiness-scanner.mdx`). It cannot run module-declared privacy checks or count stored rows. The split: the scanner owns release files and secret hygiene; the privacy doctor owns privacy runtime configuration, module-declared checks and opt-in database counts. Where both flag a published value (the Meilisearch key, the Compose database password), the doctor's predicate lives in shared code beside the runtime that uses it; the scanner is a separate repository with no runtime dependency on the platform, so it keeps its own list, and G5's `hardening` page tells operators to run both.

## 📝 Proposed Solution

A command that runs a list of checks. Each check has a stable id and returns findings. Check declarations are validated with zod; rendered text uses translation keys through the CLI translation resolver, never hard-coded operator copy.

**A finding** carries: check id, severity (`error`, `warning`, `info`), a one-line statement, a one-line fix, and the variable or module it concerns. Never a secret, a hash or personal row data. Database findings may contain aggregate counts; tenant ids stay internal to the execution context.

**First checks**

| Id | Reads | Finding |
|---|---|---|
| `encryption.disabled` | The encryption toggle | Warning when tenant encryption is switched off |
| `search.encrypted_fields_indexed` | Search host and exclusion predicates | Warning when a fulltext host is configured and encrypted fields are not excluded |
| `search.published_key` | The search API key | Error when it is a key published in this repository |
| `ratelimit.not_shared` | The shared-limiter predicate | Warning when the rate limiter is per process |
| `demo.enabled` | Demo and onboarding predicates | Warning when demo mode or self-service onboarding is on; unset demo mode is on, unset onboarding is off. Onboarding warns for a token accepted by any current caller; callers keep their strictness |
| `runtime.not_production` | The key guard's production predicate `isTenantEncryptionProductionRuntime()`, or `NODE_ENV` before it lands | Info naming the mode of this process only. The statement says that the web server's and the workers' modes are not visible to the doctor, and that the key guard's runtime check covers them in each process |
| `scheduler.module_absent` | The module registry | Warning when the scheduler module is not enabled. An enabled module does not prove a scheduler process is running, and the finding says so |

**Backlog: checks that wait for another spec.** This spec owns each one. Each is built in Phase 5, one step per check, after its dependency lands and before the release that ships that dependency. The specs named under "Depends on" are not amended: they provide a predicate, not a check.

| Id | Severity | Predicate | Depends on |
|---|---|---|---|
| `encryption.key_policy.<code>` | `refuse`: error. `bridge`: error when `TENANT_DATA_ENCRYPTION_KEY_POLICY` is `enforce`, otherwise warning. `warn`: warning | One finding per entry of `inspectTenantEncryptionConfig(context.env)`; `<code>` is the entry's `code`, the subject its `envName` | Key-guard spec Phase 1, step 2 (`keyPolicy.ts`). The `enforce` rule applies once its Phase 4 adds the policy setting; before that, `bridge` is a warning |
| `encryption.plaintext_on_unavailable` | Warning | Tenant encryption is on and effective `TENANT_DATA_ENCRYPTION_UNAVAILABLE_WRITES` is `plaintext`, read through `getTenantEncryptionUnavailableWrites(env)` from `@open-mercato/shared/lib/encryption/keyPolicy` | Fail-closed API Contracts, “Setting export”, and Phase 3 step 1 supply this side-effect-free accessor. The production accessor remains key-guard-owned; the telemetry counter `encryption.unavailable_writes` is distinct |
| `headers.hsts` | Warning | A production deployment serving HTTPS would send no `Strict-Transport-Security` header, read through the predicate program package A5 exports from `packages/shared/src/lib/security/` | Program package A5, which is an issue with no spec. Its PR exports the predicate |
| `pruners.unscheduled` | Warning | `needs: 'database'`: scheduler-owned `scheduler.retention_schedules` counts exact enabled-handler schedule expectations, returning `missing` and `disabled` separately; system rows count once with null tenant even with zero tenants, tenant expectations retain their exact tenant scope; no payloads or row ids leave the service | Operational-retention-pruners “Enabled-handler schedule expectations” defines `getRetentionScheduleDefinitions(modules)`, `getRetentionScheduleExpectations({ definitions, tenantIds })`, `bindPrunerScheduleDoctorCheck(check, definitions)` and `createPrunerScheduleCounter({ em, definitions })`; doctor Phase 3/R3-4 binds before isolated selection. Module absence stays `scheduler.module_absent` |
| `database.published_password` | Error | The effective Postgres password equals the repository-published Compose default; inspect `DATABASE_URL` or `POSTGRES_PASSWORD` without returning either value | Program A6 exports a shared predicate for its effective credential configuration; Meilisearch is already covered by `search.published_key` |
| `runtime.next_telemetry_enabled` | Warning | Next.js telemetry is not explicitly disabled by the A7 setting; this is distinct from Open Mercato telemetry | Program A7 exports a side-effect-free predicate for `NEXT_TELEMETRY_DISABLED` and its documented default |
| `privacy.non_eu_provider` | Warning | Environment-configured email/AI choice has a reviewed non-EU processing region; unknown region reported as unknown, never certified EU | F4 (template provider choice) exports the shared region predicates that program DEC-6 requires; configuration tier only |
| `<providerModule>.non_eu_provider` | Warning | `needs: 'database'`: owner count service counts non-EU/unknown database-configured choices, without returning credentials or configuration rows | Each provider module, coordinated by F4 under DEC-6, declares one concrete stable id per module and supplies the count factory; database tier only, separate from the configuration check |
| `privacy.uncovered_modules` | Warning | An enabled module has a table that no data class, `tables` entry or baseline entry of the table-coverage spec covers | A list of each module's tables at run time. The generated module registry currently carries none, so the table-coverage spec's per-package test is the check until then |

Checks shipped through a module's own `doctorChecks` remain owned there. Declarations preserve the whole default object under R3-2 and require C1 Phase 1 plus this spec's Phase 3; checks-only modules use `dataClasses: []`. The operator page lists these known consumers without treating configuration as stored-data evidence:

| Id or owner diagnostic | Tier | Owner and prerequisite |
|---|---|---|
| `search.raw_tokens_stored` | Configuration | Search-index-PII-protection Phase 1 reads `OM_SEARCH_STORE_RAW_TOKENS`; separate from built-in `search.encrypted_fields_indexed`. It proves no stored-token/backlog count; B4's token/vector report commands own residual counts |
| `entities.encryption_backfill_pending`, `entities.encryption_backfill_unverified` | Database | B1 Phase A owner factories count persisted required-map values for selected tenants without returning values or identifiers. A lost or bounded-out scan is unverified. Use B1’s scoped verification command plus delegated owner reports for release/rollout proof, including independent system scopes. |
| `query_index.legacy_tokens_stored`, `query_index.noncurrent_token_keys` | Database | Search-index-PII-protection Architecture, “Doctor database counts”: each selected check supplies its own lazy `query_index.token_counts` factory with `{ em }`; counters `legacyRows`, `nonCurrentKeyRows`, `currentKeyRows` count only `search_tokens` for supplied non-null tenants. Legacy rows warn; non-current keyed rows error. Missing lookup material fails; explicit tenantless reports and positive current-key verification remain separate |
| `configs.queue_payloads_unsealed`, `configs.queue_failed_retention_default` | Configuration | Queue-payload-minimization Phase 1 uses `inspectQueuePrivacyConfig({ env, moduleIds })` and the failed-age release default; potential use/settings only, never proof that stored jobs are sealed, drained or expired |
| `configs.retention_history_mode_default` | Configuration | Operational-retention-pruners Phase 3 uses the same `resolveRetentionMode` and `getOperationalRetentionWindows()` as its deleting owners, with no copied defaults or first-count reads. C1 Phase 1 and doctor Phase 3 precede its opt-in history release (DEC-H); the default flip additionally waits for R3-4 and `pruners.unscheduled`. It also warns, without echoing the value, when `OM_RETENTION_HISTORY_MODE` is set to anything other than `report`/`delete` (trimmed, case-insensitive), which the shared parser resolves to `report` |
| `forms.retention_mode_default` | Configuration | Forms-retention-scheduling Phase 2 uses the shared `resolveRetentionMode` parser with its own release default and per-form notice gate; no copied operational-history default. C1 Phase 1 and doctor Phase 3 precede its independent mode/default gate (DEC-H) |
| `audit_logs.access_retention_disabled` | Configuration | Access-log-retention uses the owner's shared `getAccessLogRetentionWindows()` and effective kind-list parser, including fractional/`keep`/empty-kind semantics; warning for a `keep` window, informational for a window set to `0`, which keeps meaning the default; no copied defaults or access-log rows. C1 Phase 1 and doctor Phase 3 precede its `keep` value |
| `privacy.retention_settings_unset` | Database | R4-7 requires C1's `createReadOnlyPrivacySettingsService({ em, definitions, tenantIds })` from “Bootstrap-free settings reads — R3-3”; tally missing/invalid required settings and report counts only. C1 owns the aggregate adapter/binding; complements the domain checks |
| `sales.retention_age_unset`, `checkout.retention_age_unset`, `staff.retention_age_unset` | Database | Commerce and people-ops own their checks; C1 Phase 7, “Bootstrap-free settings reads — R3-3”, supplies `createReadOnlyPrivacySettingsService({ em, definitions, tenantIds })` through configs-owned `createModuleConfigPrivacyReader({ em })`. Tally unset/invalid settings for supplied tenants only; unavailable reads fail the check. Each isolated `--only` selection works without the aggregate check |
| `attachments.pending_deletions_stale` | Database | R4-5: attachments declares `needs: 'database'` in its `privacy.ts.doctorChecks`; count `attachment_pending_deletions` rows older than 7 days. Erasure/table coverage classify them `runtime_state`; successful drain deletes the row. They write no action-log entries and need no planned history identities; findings contain counts only |
| `forms.invitation_suppression_secret_missing`, `forms.invitation_unsubscribe_secret_missing` | Configuration | Email-unsubscribe Phase 2, “Privacy declaration, erasure and tenant exit”; reads availability of the two independent secret chains only |
| `forms.invitation_suppression_secret_fallback` | Configuration | Email-unsubscribe Phase 2; warning when the suppression key resolves from `FORMS_DISTRIBUTION_TOKEN_SECRET` or `JWT_SECRET` instead of `FORMS_INVITATION_SUPPRESSION_SECRET`; reports which variable resolved only, never a secret value |
| `forms.invitation_suppression_secret_fallback_in_use` | Database | Same forms owner and lazy `forms.invitation_suppressions` factory, counter `suppression_rows`; error when the fallback resolves and the supplied tenant has suppression rows, so a `JWT_SECRET` rotation would block its optional invitations. Counts only; default runs list `database_not_requested` |
| `forms.invitation_suppression_key_mismatch` | Database | Same forms owner; lazy `forms.invitation_suppressions` factory, counter `suppression_key_mismatch`, derives the current suppression key id lazily and counts mismatched rows only in the supplied tenant across its organizations. Missing current key reports unavailable, never zero. No hash/key id/recipient values leave the check; default runs list `database_not_requested` |
| `sso.scim_lookup_secret_missing` | Configuration | Enterprise `sso`, encryption-map coverage under R5-4: error when `moduleIds` includes `sso`, tenant data encryption is enabled (the `TENANT_DATA_ENCRYPTION` toggle that `encryption.disabled` reads, with the parsing of `isTenantDataEncryptionEnabled()` in `packages/shared/src/lib/encryption/toggles.ts`: unset, empty or unparsable means on) and no lookup secret is set; not raised with encryption off, where SCIM keeps plaintext equality. Raised from the warning minor N, ahead of the N+1 refusal; the named exception in assumption 5. Reads only `env`/`moduleIds`; no database read or secret value in output |
| `data_erasure.manifest_unconfigured` | Configuration | Restore-replay “API Contracts”, Doctor: required manifest variables and safe deployment name only. Directory existence, shared durability and cross-replica visibility are operator attestations; status/capture commands own I/O verification. No replay/database-state proof |
| `data_erasure.backup_retention_exceeds_replay_window` | Configuration | Restore-replay “API Contracts”, Doctor: warns when `backups` is enabled and `OM_BACKUP_RETENTION_DAYS` is at or above `OM_ERASURE_MANIFEST_RETENTION_DAYS`; environment only, no backups import |

The shared settings check consumes the owners' declarations, including `retention.sales.orderAgeYears`, `retention.checkout.paymentAgeYears` and `retention.staff.employmentRecordAgeYears`. C1 R3-3 owns storage, validation, the settings CLI and aggregate adapter. Valid declaration defaults satisfy the count; instance fallback never does. Missing/invalid required values count; an unavailable adapter or database fails the check rather than counting a clean tenant.

### Design decisions

| Decision | Rationale |
|---|---|
| Predicates are exported from shared code and the runtime switches to them | One rule, read by both. |
| Every report states that it describes this process's configuration and only the requested database counts | Web and workers may differ; the doctor cannot see them. DEC-E and key-guard R3-11 own the runtime check and IPC binding. |
| The doctor does not report other processes' modes | It cannot see them. The development runner's mark is checked by the key guard at each service's start: a mark without a valid binding to the live development runner is treated as production, so the refusal applies, and is logged once at error level. A service started with a non-production `NODE_ENV` is not refused; the key guard's warnings go to that service's own log. |
| A module's check is a member of its `privacy.ts` default export | R3-2 in the contract spec owns future `module.privacy`; the collector validates `doctorChecks` independently. No further generator change here. |
| Severity is fixed by the check, never operator-configurable; a check may emit different fixed severities for distinct states | A configurable severity becomes a way to silence a real problem. A state-dependent severity, such as the access-log check's warning for `keep` and informational finding for `0`, is still decided in the check's code. |
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
| A plural or otherwise conforming module id | `privacy` has no plural; DEC-10 follows the mass-noun ids already shipped, and an id is frozen once shipped. |
| Add the privacy checks to the Readiness Scanner | The scanner is a separate package that must not load the module registry or contact the database. Module-declared checks and database counts need both. The two tools stay separate; see Problem Statement. |

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

##### Scenario: Other processes' modes
- WHEN the command runs
- THEN `runtime.not_production` names the mode of this process only, and the report states that the web server's and the workers' modes are not visible to it

#### ADDED Requirement: Works on a refused deployment
The system SHALL run configuration checks without building the application container, even when runtime configuration is refused. The opt-in database tier may build only its restricted read-only context for counts and C1 settings reads.

##### Scenario: Refused configuration
- WHEN the command runs on a configuration the key guard refuses
- THEN it reports its findings and does not fail on the refusal

#### ADDED Requirement: Explicit database assessment
The system SHALL run database checks only with `--database`, using read-only transactions for counting queries and C1's `createReadOnlyPrivacySettingsService` for tenant privacy settings, and SHALL report whether each requested check completed. Findings SHALL contain counts only, never setting values, versions or personal rows (R4-7).

##### Scenario: Default versus requested tier
- WHEN database checks are declared and the command runs without `--database`
- THEN it makes no database connection and records those checks as skipped with `database_not_requested`
- WHEN `--database` is supplied
- THEN it supplies the transaction manager, tenant list and count-service resolver; C1 settings reads use that same manager/list, failures are errors and personal rows or setting values never appear in output

##### Scenario: Required retention settings
- WHEN `--database --only privacy.retention_settings_unset` is selected
- THEN the check uses `createReadOnlyPrivacySettingsService` for the supplied tenants and reports only missing/invalid required-setting counts

##### Scenario: Stale pending attachment deletion
- WHEN an `attachment_pending_deletions` row is older than 7 days and `--database` is requested
- THEN the attachments-owned `attachments.pending_deletions_stale` check surfaces its count; a successful drain removes the runtime row without action-log entries or planned history identities (R4-5)

##### Scenario: Declaration-only module
- WHEN `configs` exports `{ dataClasses: [], doctorChecks: [...] }`
- THEN its checks validate and run without registering a data class

#### ADDED Requirement: Checks from other modules
The system SHALL run checks that an enabled module declares.

##### Scenario: Module-declared check
- WHEN an enabled module's `privacy.ts` default export declares a check in `doctorChecks`
- THEN its findings appear in the report under its own id

##### Scenario: Invalid declaration
- WHEN a module declares a check whose id does not start with its module id, outside scheduler's exact `pruners.unscheduled` exception, or repeats another check's id
- THEN the report lists `doctor.check_invalid` as an error naming the module, and every other check runs

## 📝 Architecture

- **`packages/core/src/modules/privacy/`**: `index.ts`, and `cli.ts` with the `doctor` command. `cli.ts` reads the module list through `getCliModules()`, which may only be called from a file of that name, and passes it to the runner.
- **`lib/doctor/`**: `types.ts`, `runDoctor.ts`, `report.ts` and one file per first check. Checks default to `needs: 'configuration'`. The runner isolates failures and runs configuration checks without a container. The opt-in database runner is specified below.
- **Shared predicates**, each exported and adopted by its current caller in the same change:

| Predicate | Home | Replaces |
|---|---|---|
| Fulltext host configured; encrypted fields excluded | `packages/shared/src/lib/search/` | Two private parsers in the search package |
| Rate limiter is shared | `packages/shared/src/lib/ratelimit/` | A private expression in the service |
| Demo mode on; self-service onboarding on | `packages/shared/src/lib/` | Parsers in `auth` and `onboarding`. The doctor uses the widest reading; callers keep their current strictness |
| Search key is published | `packages/shared/src/lib/search/` | New; holds a SHA-256, as the key guard does for encryption secrets |

- **Extension point.** DEC-I, “The doctor's extension point”, permits the default export of a module's `privacy.ts` to carry `doctorChecks`, an array of checks, beside `dataClasses`. The contract spec supplies that future registry support under R3-2; today there is no `privacy.ts` convention. This spec makes no further generator change. Declaration-only modules export `{ dataClasses: [], doctorChecks: [...] }`, so `configs` does not need a fictitious class.
  - `getPrivacyDoctorChecks(modules)` in `packages/shared/src/modules/registry.ts` validates each entry with the zod schema in `packages/shared/src/modules/privacy.ts` and stamps it with its module id, from `module.privacy.doctorChecks` under R3-2, independently of data-class validation.
  - An entry that fails the schema, whose id does not start with `<moduleId>.` (except exactly `scheduler` declaring `pruners.unscheduled`) or whose id repeats another's, is returned as rejected instead of thrown, so one module's mistake does not hide the other checks. The runner reports each rejected entry as `doctor.check_invalid`. The operational-pruner owner's existing exception applies to no other module/id pair or count-service prefix.
  - A check is defined in `privacy.ts` itself. It reads its context and may make synchronous, read-only probes of the local filesystem through `node:fs` (does a directory exist, is it writable), and no other process or network in the default tier. A check with `needs: 'database'` follows R3-4 below instead of making a database connection itself. It imports only modules with no side effects at load (types, constants, shared predicates, `node:fs`), so the table-coverage spec's test can still load the file. This is the rule the table-coverage spec states (its edge case on `privacy.ts` imports).
  - It becomes available once the contract spec's generator support (its Phase 1) has landed; until then only the first checks run.
- **Dispatcher.** The command joins the list of commands that never create a `.env`.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Doctor → rules | Shared predicates | — |
| Doctor → module list | The generated CLI registry | — |
| Other packages → doctor | `module.privacy.doctorChecks`, collected by `getPrivacyDoctorChecks` under R3-2 | No checks from that module |
| Other processes → doctor | None. The key guard checks each process at its own start | The report says the modes are not visible |

### R3-4 — An opt-in database tier for the doctor

`mercato privacy doctor` SHALL remain configuration-only. `--database` SHALL also run checks declared with `needs: 'database'`. Those checks receive a read-only `EntityManager` and the tenant list. Under R4-7 — “Doctor database tier and settings”, they may run counting queries and read tenant privacy settings through C1's `createReadOnlyPrivacySettingsService({ em, definitions, tenantIds })`, on that same transaction-bound manager and allowed tenant list. Findings contain counts only, never personal data or setting values/versions. Token-index counts, unset retention settings and similar database assessments belong to this tier. This owns R3-4 and R4-7. C1 owns R3-3 settings and `privacy.retention_settings_unset`, which SHALL use that read-only settings service; coverage modules supply the setting declarations. B4 supplies search's configuration check and query_index's two database token checks, separately from its residual-count commands.

The runner obtains a database connection without application bootstrap, so a key-guard refusal cannot prevent configuration findings. It creates a read-only transaction, applies a statement timeout, and passes a transaction-bound EntityManager to checks. The database enforces read-only access; a TypeScript annotation alone is insufficient. Only the database-tier bootstrap enumerates tenant ids, through the directory-owned `createDirectoryPrivacyTenantReader({ em })` from `packages/core/src/modules/directory/lib/privacy-register.ts`, the same owner file that supplies the register's `directoryPrivacyService`. Its `listTenantIds({ after, limit })` returns ids of non-deleted tenants in id order after an opaque keyset cursor, `limit` 1–100, and `filterExistingTenantIds(ids)` validates `--tenant` input; it returns ids only. Privacy code never queries directory tables itself. Tenants are processed in batches of at most 100: each batch opens a fresh read-only transaction, reads its page through the reader bound to that transaction, runs each selected database check with that page as `tenantIds`, and closes. `--tenant <id>` (repeatable) replaces enumeration with the named tenants, still batched; an id that is not an existing tenant is a usage error. A database finding carries an integer `count`; the runner sums `count` across batches for findings with the same id and subject and keeps the most severe severity. With zero tenants the runner still runs one batch with an empty list. Counting queries return aggregate counts; C1 settings reads keep values/versions internal to the check. Findings never return record ids, settings values or rows. Each tenant query applies its validated tenant predicate; tenant-wide scope includes all organizations and does not cross tenants. Scheduler's `pruners.unscheduled` alone may count with null tenant: expected system rows require both `tenant_id IS NULL` and `organization_id IS NULL`, counted only in the first batch (`batch.index === 0`), so once even with no tenant rows. Its tenant expectations retain the exact non-null tenant predicate. It grants no installation access to other checks. A check uses a DI counting service owned by the module that owns the counted data or its sanctioned service, with this manager. It never reads another module's tables. Scheduler and provider count checks therefore live in those modules' `privacy.ts` declarations; this spec owns their backlog work. Connection and transaction failures produce `doctor.database_unavailable`, an error, while configuration findings remain in the report. A throwing database check produces `doctor.check_failed`; the runner rolls back and runs the batch's remaining checks in a fresh read-only transaction.

The database runner builds a minimal Awilix container for counting, with C1 settings reads also permitted under R4-7; it never calls application/request bootstrap or runs general module `di.ts` registration. Each selected database check supplies optional `countServices` factories on its own declaration. The factories come from that owner module, import without side effects, and receive only `{ em }`, the transaction-bound manager. Service keys must start with the declaring module id; duplicates or invalid factories are `doctor.check_invalid`. Factories are invoked lazily by `resolveCountingService` and expose only `PrivacyDoctorCountingService.count`. No count service is instantiated during a default run. A missing or throwing factory becomes `doctor.check_failed`; nothing silently falls back to foreign table reads. Rebuild this restricted container for each fresh transaction.

Reports list tiers requested, completed checks and skipped checks with reasons. Without `--database`, database checks are listed as skipped with `database_not_requested`; the report says they were not assessed. `--only` naming a database check without `--database` is a usage error. `--no-fail` suppresses finding exit codes only; it never suppresses usage or report-write failures.

Consumers own their queries. R3-3, “Tenant privacy settings live in `module_configs`”, in C1's “Bootstrap-free settings reads — R3-3”, supplies `createReadOnlyPrivacySettingsService({ em, definitions, tenantIds })`, returning only `Pick<PrivacySettingsService, 'get'>`, through configs-owned `createModuleConfigPrivacyReader({ em })` on the same read-only manager. Commerce's `sales.retention_age_unset`/`checkout.retention_age_unset` and people-ops' `staff.retention_age_unset` tally unset/invalid outcomes through this get-only boundary; values/versions stay internal and unavailable reads become `doctor.check_failed`. Null/unknown tenants and organization scope refuse. Each isolated `--only <module>.retention_age_unset --database` works without another selected check; no general bootstrap, cache, new connection or transaction runs. Configuration-only runs import/construct neither reader. C1 Phase 7 supplies this construction path; it is not a missing design.

C1's “Bootstrap-free settings reads — R3-3” supplies the service used by `privacy.retention_settings_unset` under R4-7. In `privacy/cli.ts`, collect `getPrivacySettings(modules)` and apply C1's `bindPrivacySettingsDoctorCheck(check, definitions)` before isolated selection/execution. The selected check reads effective required settings through `createReadOnlyPrivacySettingsService({ em, definitions, tenantIds })` on its supplied manager/list, tallies missing or invalid outcomes and returns counts alone. A valid declaration default satisfies the check; instance fallback never does; unavailable reads fail instead of counting zero. C1 owns its named `privacy.retention_settings` / `required_unset` adapter and binding; R4-7 supersedes the earlier counting-only restriction in C1's cited text. `--only privacy.retention_settings_unset --database` works independently and complements the domain checks. No application bootstrap, general `di.ts` registration or foreign-table query runs, and configuration-only runs construct no reader or counter.

Operational-retention-pruners' “Enabled-handler schedule expectations” owns the scheduler handoff. In `privacy/cli.ts`, collect `getRetentionScheduleDefinitions(modules)` from the same enabled snapshot and call `bindPrunerScheduleDoctorCheck(check, definitions)` before isolated `--only` selection/execution. It binds only `countServices['scheduler.retention_schedules']` as `({ em }) => createPrunerScheduleCounter({ em, definitions })`; an unbound factory refuses. `getRetentionScheduleExpectations({ definitions, tenantIds })` supplies the owner's exact key/UUID and system/tenant expansion, shared with registration. Invoke `count({ tenantId: null, counter })` once for each of `missing` and `disabled`, even with zero tenants, then those counters for the allowed tenant expectations. Forms/provider/query_index checks likewise use their own lazy factories; the known-consumer table names their exact counters. Token counts cover supplied tenants only and replace neither explicit tenantless reports nor G6's positive current-key probe.

## 📝 Data Models

None. The data-model graph is skipped.

## 📝 API Contracts

**`mercato privacy doctor`**

| Flag | Meaning |
|---|---|
| `--no-fail` | Exit 0 despite error findings after a report is successfully written |
| `--database` | Also run read-only database checks: counting queries and C1 tenant privacy settings reads; findings contain counts only |
| `--out <file>` | Also write the report as JSON, created with owner-only permissions |
| `--force` | Allow `--out` to replace an existing file |
| `--only <id>` (repeatable) | Run only the named checks |
| `--tenant <id>` (repeatable) | With `--database`, count only these tenants instead of enumerating all; without `--database` it is a usage error |

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
  "scope": "this_process_configuration_and_requested_counts",
  "tiers": ["configuration"],
  "completed": [
    { "id": "encryption.disabled", "needs": "configuration" },
    { "id": "search.encrypted_fields_indexed", "needs": "configuration" },
    { "id": "search.published_key", "needs": "configuration" },
    { "id": "ratelimit.not_shared", "needs": "configuration" },
    { "id": "demo.enabled", "needs": "configuration" },
    { "id": "runtime.not_production", "needs": "configuration" },
    { "id": "scheduler.module_absent", "needs": "configuration" }
  ],
  "skipped": [{ "id": "pruners.unscheduled", "reason": "database_not_requested" }],
  "tenants": null,
  "mode": "production",
  "findings": [
    { "id": "search.published_key", "severity": "error", "subject": "MEILISEARCH_API_KEY", "statement": "…", "fix": "…" }
  ]
}
```

**Extension type** — `@open-mercato/shared/modules/privacy`

```ts
export type PrivacyDoctorFinding = {
  id: string
  severity: 'error' | 'warning' | 'info'
  subject: string | null
  statement: string
  fix: string
  count?: number
}

export type PrivacyDoctorContext = {
  env: NodeJS.ProcessEnv
  moduleIds: readonly string[]
}

export type PrivacyDoctorCountingService = {
  count: (input: { tenantId: string | null; counter: string }) => Promise<number>
}

export type PrivacyDoctorCheck = {
  id: string
} & (
  | { needs?: 'configuration'; run: (context: PrivacyDoctorContext) => PrivacyDoctorFinding[] }
  | {
      needs: 'database'
      countServices?: Record<string, (input: { em: EntityManager }) => PrivacyDoctorCountingService>
      run: (context: PrivacyDoctorContext & {
        em: EntityManager
        tenantIds: readonly string[]
        batch: { index: number; last: boolean }
        resolveCountingService: (id: string) => PrivacyDoctorCountingService
      }) => Promise<PrivacyDoctorFinding[]>
    }
)

// added to the default export of privacy.ts
doctorChecks?: PrivacyDoctorCheck[]
```

**Collector** — `packages/shared/src/modules/registry.ts`

```ts
export function getPrivacyDoctorChecks(modules: Module[]): {
  checks: Array<PrivacyDoctorCheck & { moduleId: string }>
  rejected: Array<{ moduleId: string; id: string | null; reason: 'invalid' | 'wrong_prefix' | 'duplicate' }>
}
```

`tenants` is null without `--database`; otherwise `{ "selection": "all" | "selected", "count": number }`, never the ids. `count` on a finding is a nonnegative integer that statement and fix keys render; configuration findings omit it. The zod schema checks `id`, the optional `needs` discriminant, `countServices` factory map and `run`. Count service implementations count their own tables only and reject unknown counters and non-finite, negative or non-integer counts. The resolver wraps `count` to reject tenant ids outside the supplied list and null for every caller/key except scheduler's selected `pruners.unscheduled` resolving `scheduler.retention_schedules`. This is the exact nullable-tenant `count` contract consumed by C1's “Bootstrap-free settings counts” and the operational owner's “Enabled-handler schedule expectations”; no separate installation service or resolver is used. For null tenant, scheduler compares system expectations with exact system scope, null tenant/organization rows once, even with an empty tenant list. For non-null tenants it compares only tenant expectations in that exact scope and null organization. The owner's key/UUID expansion is normative; missing or soft-deleted rows and scope/source/target mismatches count as `missing`, valid disabled rows only as `disabled`, valid enabled rows as neither. Unknown counters refuse; no payload or row id leaves the service. Enabled registration never proves a running worker. Each selected check has its own count container: B4's two checks may each carry `query_index.token_counts`, without a cross-check duplicate rejection; collisions within a check and foreign service-key prefixes still refuse. `EntityManager` is a type-only import from `@mikro-orm/postgresql`; all counts retain database read-only enforcement. Findings are zod-validated, including asynchronous results. Released ids are never reused for another meaning.

C1 owns settings validation, the read-only settings factory and configs delegation. R4-7 permits checks to construct that get-only service with their existing `em` and `tenantIds`; no general service resolver or new context member is added. The tenant resolver validates count-service `tenantId` exactly as for other tenant services. Configuration checks never receive the count resolver or construct a settings reader. Output follows C1's “File handling”: fsync a `0600` temp in the target directory, publish with `link(temp, target)` without force, unlink temp and fsync the directory where supported; same-filesystem `rename` only with force. Unsupported hard links refuse, including on Windows; use a private directory with suitable Windows ACLs. Ordinary failures clean temps; a crash can leave an unpublished temp, never a partial target.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Database unavailable, or a check attempts a write | Error finding; configuration findings remain; no write commits |
| A module has only checks | `dataClasses: []` and `doctorChecks` validate; the collector returns its checks |
| A check throws | Reported as an error-level finding `doctor.check_failed` naming the check; other checks continue |
| Rate-limit strategy variable set to an empty string | The predicate treats it as not shared instead of throwing, as the config parser does today |
| Unknown id passed to `--only` | Usage error, exit 1, listing the known ids |
| `--tenant` naming no existing tenant, or used without `--database` | Usage error, exit 1, before any check runs |
| Many tenants | Batches of at most 100, each in its own read-only transaction; counts summed per finding |
| Module `privacy` not enabled | The command does not exist; the upgrade note says to enable it |
| Standalone app with its own modules | Registry checks read that app's registry; its modules may declare checks |
| A module's check fails the schema, has a wrong prefix, or repeats an id | `doctor.check_invalid`, error, naming the module and the reason; the other checks run |
| A backlog check's dependency has not landed | The check does not exist yet; the operator page lists it as planned |
| Web and workers configured differently | Not visible; stated in every report |
| A service runs with a non-production `NODE_ENV` or the development runner's mark | Not visible to the doctor, and the report says so. The key guard's runtime check in that service treats a mark without a valid binding to the live development runner as production and logs it once at error level. A non-production `NODE_ENV` is not refused; the guard warns in that service's log |
| Secret-bearing variable | Only its name and whether it is set are reported |

## 📝 Migration & Backward Compatibility

- Additive: a new command, a new module enabled in `apps/mercato/src/modules.ts` and carried into the create-app template by template sync, an optional `doctorChecks` member of the `privacy.ts` default export (a convention not yet released), new shared exports. The contract spec owns R3-2 generator changes; this spec does not change them again. The database tier and optional `needs` are additive; existing synchronous checks keep their signature.
- Moving a private rule into a shared predicate changes no behaviour; each move is covered by the caller's existing tests.
- The report carries `reportVersion`. Its required `completed` and `skipped` arrays account for every selected declaration; failed checks have error findings and do not appear completed. Requested tiers are explicit.
- `UPGRADE_NOTES.md`: one operator note that the command exists and that existing apps enable the `privacy` module to get it.

## 📋 Phasing

| Phase | Outcome |
|---|---|
| 1 | Shared predicates, adopted by their callers |
| 2 | The module, the command, the report, the seven first checks |
| 3 | The extension point and opt-in database tier, after the contract spec's R3-2 registry support; no further generator change |
| 4 | Documentation |
| 5 | The backlog checks, one step each, after the dependency the backlog table names, and each owner-declared database check's TC-PRIVACY-DOCTOR-003 case once that owner ships it |

## 📋 Implementation Plan

### Phase 1 — Predicates
1. Export the search, rate-limit and demo predicates from shared code and switch each current caller to them. Unit tests for each over set, unset, empty and malformed values. No behaviour changes.
2. Add the published-search-key predicate with its hash.

### Phase 2 — Command
1. Create the sole `privacy` module, with the id program DEC-10 settles: `index.ts` exporting metadata with `license: 'MIT'` and its initial `cli.ts` implementing `doctor`; this spec alone owns creation and enablement, in OSS (DEC-2). The contract Phase 2 extends `cli.ts` with `classes` and later commands; enable the module; run template sync and `yarn generate`; add the create-app harness case or exemption the template's fact-sheet test requires.
2. Add `types.ts` and `runDoctor.ts`: isolation of a throwing check, `--only`, the exit-code rule. Unit tests with fake checks and explicit completed/skipped/failed report entries.
3. Add the seven checks, one file each, with unit tests asserting that no secret value appears in any finding. The `runtime.not_production` test asserts that the finding names this process's mode and states that other processes' modes are not visible.
4. Add the report writer and the `doctor` command; add it to the dispatcher's no-`.env` list, with a dispatcher test.
5. Integration tests TC-PRIVACY-DOCTOR-001 and 002.

### Phase 3 — Extension point
1. Add `doctorChecks` to the default export's type and to its zod schema in `packages/shared/src/modules/privacy.ts`, and `getPrivacyDoctorChecks(modules)` to `registry.ts`. No generator change. Unit tests in `packages/shared/src/modules/__tests__/registry.test.ts`: a valid check, a wrong prefix, scheduler’s exact `pruners.unscheduled` prefix exception accepted only for scheduler, rejection of that id for any other module, a duplicate id across modules, a `run` that is not a function; invalid `needs`; and a `configs` fixture with `dataClasses: []` and only `doctorChecks`. Each rejected entry is returned, not thrown; a valid declaration-only module reaches the runner.
2. Run module-declared checks after the first checks; report each rejected entry as `doctor.check_invalid`. Unit test: a module list whose entry carries a `privacy.ts` default export with one check reaches the runner, and its finding appears under its id.
3. Extend `registry-variant-parity.test.ts`, the contract spec's generator suite, so that a fixture module's `privacy.ts` default export with a `doctorChecks` member is present on that module's entry in the generated CLI registry. This covers the path from the file to the runner without touching the generator.

4. Add the R3-4/R4-7 read-only database runner, async checks, tier reporting, the directory-owned tenant reader, `--tenant` and batching. Named unit suite `doctorDatabaseTier.test.ts`: default makes no connection, settings adapter or count-service factory; explicit tier passes tenant ids, batch metadata, transaction-bound manager and count resolver; 250 fixture tenants produce three batches of at most 100, each in a fresh transaction, with summed `count`; `--tenant` selects only the named tenants and rejects an unknown id or use without `--database`; a query recorder shows only the directory reader touches `tenants`; lazy factory prefix/collision validation and missing/throwing service; independent selected checks may share an owner service key; cross-tenant counts isolated and null accepted only for scheduler's exact check/service pair; attempted writes roll back; unavailable database reports an error; one throwing check does not hide another. Directory owner unit test `directory/lib/__tests__/privacy-register.test.ts`: keyset order, deleted tenants excluded, limit bounds, ids only. Integration TC-PRIVACY-DOCTOR-003 in its Phase 3 form uses a fixture module check with its own count-service factory over its own fixture rows: default run makes no connection; `--database` counts across two owned tenants without row data in read-only transactions; `--tenant` narrows to one; writes are refused; an unavailable database is an error that keeps configuration findings; `--only` naming the fixture check without `--database` exits 1. Owner checks add their cases to TC-PRIVACY-DOCTOR-003 in the Phase 5 step that delivers each.

### Phase 4 — Documentation
1. Add the operator page under `apps/docs/docs/deployment/`, listing every check id with its meaning and fix, the backlog checks as planned, the statement that the doctor cannot see other processes' modes, when to run the Readiness Scanner instead or as well, and the `UPGRADE_NOTES.md` note. Document that A1/A2 runtime evidence is the actual candidate per-replica health signal, with real startup checks. No diagnostic observed in the doctor process certifies another process.

### Phase 5 — Backlog checks
Each step lands after its dependency and before the release that ships it. Each adds one file under `checks/` for built-ins or a declaration/count service in the owning module for database checks, unit tests for its severities and for the absence of any secret value, and its line on the operator page.
1. `encryption.key_policy.<code>`, after key-guard Phase 1. Unit tests: each disposition's severity, and `bridge` under `warn` and `enforce` once key-guard Phase 4 has landed.
2. `encryption.plaintext_on_unavailable`, after fail-closed Phase 3 step 1's specified `getTenantEncryptionUnavailableWrites(env)` export; test unset/invalid/explicit modes without invoking the write decision or its telemetry.
3. `headers.hsts`, after the A5 PR.
4. `database.published_password`, after A6; test URL and direct-password forms, unset values and output redaction.
5. `runtime.next_telemetry_enabled`, after A7; test unset, disabled and enabled values.
6. `privacy.non_eu_provider` plus separate `<providerModule>.non_eu_provider` database checks, after F4 delivers the region predicates and coordinates the provider modules' count factories that DEC-6 requires; replace each placeholder with the concrete module id in its declaration. Test EU, non-EU, unknown and database-configured choices with provider-owned count fixtures; no unique check spans tiers.
7. `pruners.unscheduled`, implemented only in scheduler's `privacy.ts` with `countServices['scheduler.retention_schedules']`, the owner's exact check-id prefix exception and ordinary `{ em }` factory/`count({ tenantId, counter })` signature. Consume operational-retention-pruners' “Enabled-handler schedule expectations”: `privacy/cli.ts` collects `getRetentionScheduleDefinitions(modules)` from its enabled snapshot and calls `bindPrunerScheduleDoctorCheck(check, definitions)` before isolated `--only` selection, binding `({ em }) => createPrunerScheduleCounter({ em, definitions })`. Use `getRetentionScheduleExpectations({ definitions, tenantIds })` for exact key/UUID and scope expansion. Test isolated `--only pruners.unscheduled --database`, zero tenants/zero schedules, both `missing`/`disabled` counters once with null tenant for system rows, distinct supplied tenants for tenant rows, missing/soft-deleted/disabled/enabled rows, duplicate expectations, wrong scope/source/target, absent scheduler, unbound factory and count failure. All other checks reject null/foreign tenants; all use read-only transactions. Add the scheduler case to TC-PRIVACY-DOCTOR-003: zero tenants/zero schedules still counts exact missing system ids once, separately disabled and deduplicated, including across two batches. Ship before the pruner default flip; no configuration-only run claims schedules exist or workers run.
8. Consume C1 Phase 7's “Bootstrap-free settings reads — R3-3” for sales/checkout/staff and `privacy.retention_settings_unset` under R4-7, using `createReadOnlyPrivacySettingsService({ em, definitions, tenantIds })` through configs-owned `createModuleConfigPrivacyReader({ em })`. C1 retains ownership of the named aggregate adapter and `bindPrivacySettingsDoctorCheck(check, definitions)`; do not copy settings/defaults or introduce a new get-capability in the doctor's context. Preserve isolated `--only` tests, no general bootstrap, counts-only findings and the owners' declarations. The shared check does not replace domain checks. Unit tests: each domain selection alone, valid defaults, invalid stored values, ignored instance fallback and unavailable reads; no personal row, setting value or version reaches output. Add the settings cases to TC-PRIVACY-DOCTOR-003: `--only privacy.retention_settings_unset --database` alone uses `createReadOnlyPrivacySettingsService` with the supplied manager/list and emits counts only; each isolated sales/checkout/staff check fails on an unavailable read. `privacy.uncovered_modules` stays in the backlog until a runtime table inventory is specified.
9. Owner-declared database checks, each after its owner's declaration ships: query_index's `query_index.legacy_tokens_stored` / `query_index.noncurrent_token_keys` (search-index-PII-protection), forms' `forms.invitation_suppression_secret_fallback_in_use` and `forms.invitation_suppression_key_mismatch` (email-unsubscribe Phase 2) and attachments' `attachments.pending_deletions_stale` (R4-5). The doctor ships no code for them; the step adds each isolated `--only <id> --database` case and its owner failure path to TC-PRIVACY-DOCTOR-003. Attachments: rows older than 7 days versus exact-boundary/recent rows, no default-tier query, tenant isolation, read failure and successful-drain row removal without action-log entries or planned history identities. Include B1’s two aggregate-only owner checks when Phase A ships; test persisted plaintext despite valid maps and incomplete/unverifiable counts.

### File manifest

| File | Action |
|---|---|
| `packages/shared/src/lib/{search,ratelimit}/…` and a demo-mode helper, with tests | Create / modify |
| `packages/search/src/di.ts`, `packages/search/src/modules/search/api/settings/fulltext/route.ts`, `packages/shared/src/lib/ratelimit/service.ts`, the two demo-mode callers | Modify — use the predicates |
| `packages/core/src/modules/privacy/{index.ts,cli.ts}` | Create |
| `packages/core/src/modules/privacy/lib/doctor/{types.ts,runDoctor.ts,report.ts,checks/*.ts}` and tests | Create |
| `packages/core/src/modules/directory/lib/privacy-register.ts` and its test | Create / modify — Phase 3: `createDirectoryPrivacyTenantReader`; shared with the register spec's `directoryPrivacyService` |
| `packages/cli/src/mercato.ts` and its test | Modify — no-`.env` list |
| `apps/mercato/src/modules.ts`, template `modules.ts` (via sync), the create-app harness case | Modify |
| `packages/shared/src/modules/{privacy.ts,registry.ts}` and `__tests__/registry.test.ts` | Modify — Phase 3: `doctorChecks`, `getPrivacyDoctorChecks` |
| `packages/cli/src/lib/generators/__tests__/registry-variant-parity.test.ts` | Modify — Phase 3: fixture assertion only; the generator is not changed |
| `packages/core/src/modules/privacy/lib/doctor/checks/*.ts` and tests, owner-module `privacy.ts` declarations/count-service factories | Create/modify — Phase 5 backlog checks |
| `packages/core/src/modules/privacy/__integration__/TC-PRIVACY-DOCTOR-00{1..3}.spec.ts` | Create |
| `apps/docs/docs/deployment/privacy-doctor.mdx`, `UPGRADE_NOTES.md` | Create / modify |

## 🧪 Integration Coverage

No API or UI path. All JSON output files are removed in `finally`. The tests run the built CLI through `spawnSync` with an explicit environment. Tests 001 and 002 create no records. Test 003 creates its own two tenants, counting fixtures and a fixture-module check and count-service factory registration, then cleans them and all output files in `finally`; each later step's case owns and removes its own fixtures the same way. Variables are set to explicit values; the rate-limit strategy is set to `memory`, not emptied.

| Test | Covers |
|---|---|
| TC-PRIVACY-DOCTOR-001 | Published search key and a per-process rate limiter: exit 2; both findings present; the key's value absent from output; `--no-fail` exits 0 |
| TC-PRIVACY-DOCTOR-003 | Grows by phase. Phase 3: a fixture module check makes no connection by default; `--database` counts its own fixtures across two tenants without row data, in read-only transactions; `--tenant` narrows; writes are refused; an unavailable database is an error that keeps configuration findings; tenant checks reject null/foreign ids; `--only` without the requested tier is exit 1. Phase 5 step 7 adds the scheduler case (zero tenants/zero schedules still counts exact missing system ids once, separately disabled and deduplicated); step 8 the settings cases (`privacy.retention_settings_unset` through C1's read-only settings service, counts only; isolated sales/checkout/staff checks); step 9 each owner-declared query_index, forms and attachments check with its owner failure paths (`attachments.pending_deletions_stale` counts only rows older than 7 days and clears after successful drain without history entries) |
| TC-PRIVACY-DOCTOR-002 | Safe configuration: exit 0; `--out` writes a report that parses, carries `reportVersion` and `scope`, has `runtime.not_production` as info, and states that other processes' modes are not visible; the file is not replaced without `--force` |

Module-declared checks are covered by the Phase 3 unit tests and the generator fixture test; no module declares one before Phase 3, so an integration test would need a fixture module enabled in the app.

## 📝 Risks & Impact Review

#### A clean report is read as compliance
- **Scenario**: An operator treats exit 0 as proof.
- **Severity**: Medium
- **Affected area**: operator decisions
- **Mitigation**: The report states its scope and ends by saying it checks configuration and requested aggregate counts, not lawful basis, contracts or compliance of data content.
- **Residual risk**: People skip footers.

#### The doctor passes while another process is misconfigured
- **Scenario**: The CLI's environment is safe and a worker's is not, or a service runs with a non-production `NODE_ENV` or the development runner's mark.
- **Severity**: Medium
- **Affected area**: multi-process deployments
- **Mitigation**: Stated in every report and on the operator page. The runtime's own guards run in each process: the key guard treats a development mark without a valid binding to the live development runner as production and logs it once at error level.
- **Residual risk**: The doctor cannot see it. A service served with `NODE_ENV=development` only warns, in its own log.

#### A module's check never runs
- **Scenario**: A module declares a check in a place the registry does not load, or with an id the collector rejects.
- **Severity**: Medium
- **Affected area**: checks from other packages
- **Mitigation**: Checks are a member of the default export, which the registry loads; the generator fixture test covers the path; a rejected entry is reported as `doctor.check_invalid`, an error.
- **Residual risk**: A module that declares nothing is indistinguishable from one with nothing to check.

#### A backlog check never ships
- **Scenario**: A dependency lands and the check that waits for it is forgotten, so a changed default ships without its check.
- **Severity**: Medium
- **Affected area**: the program's rule that every changed default ships with a doctor check
- **Mitigation**: Each backlog check names its dependency, and Phase 5 places it before the release that ships that dependency.
- **Residual risk**: `privacy.uncovered_modules` still awaits a runtime inventory; the provider checks wait for F4 to deliver the region predicates and coordinate the provider count factories. Neither is advertised as an active check.

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
- **Mitigation**: Callers keep their current strictness; demo defaults on, onboarding defaults off, and the doctor accepts onboarding tokens used by any caller; existing tests cover each caller.
- **Residual risk**: An untested corner of a parser.

#### A counting check reads or changes personal rows
- **Scenario**: A database check runs an unscoped query, exposes a setting value or tries to repair a setting.
- **Severity**: High
- **Affected area**: the opt-in database tier
- **Mitigation**: Database-enforced read-only transactions, owner-scoped counting queries and C1's get-only settings factory on the supplied manager/list, statement timeout, counts-only output, unit and integration coverage. R4-5's stale-row count reports delayed cleanup without claiming deletion or an enforced seven-day TTL.
- **Residual risk**: A future query can count the wrong population; owner review remains necessary.

## Final Compliance Report — 2026-11-16

### Applicable repository guidance
- `AGENTS.md` (root), `.ai/specs/AGENTS.md` — in full
- `BACKWARD_COMPATIBILITY.md` — §1, §13
- `packages/create-app/AGENTS.md` — template sync
- Applicable CLI, shared, queue, search and Core guidance includes `packages/cli/AGENTS.md` boundaries, `packages/shared/AGENTS.md` boundaries, `packages/queue/AGENTS.md` boundaries, `packages/search/AGENTS.md` boundaries and `packages/core/AGENTS.md` Encryption and Cross-Module Coupling sections.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Modules stay independent | Compliant | Checks read shared predicates and the registry; tenant ids come from the directory-owned reader, never a privacy query on directory tables |
| root AGENTS.md | Never log credentials | Compliant | Names only; tested per check |
| root AGENTS.md | Ask before touching multiple modules | Covered by this spec | Predicate moves touch `search`, `auth`, `onboarding`, `shared`; this spec is the covering spec the rule asks for, and each PR goes through ordinary maintainer review |
| root AGENTS.md | No code under `apps/mercato/src/` except registries | Compliant | Only module enablement |
| root AGENTS.md | Module ids plural snake_case | Compliant (DEC-10) | `privacy` is a mass noun with no plural, like the shipped `security`, `content`, `progress` and `availability` ids; G4 alone scaffolds it |
| `BACKWARD_COMPATIBILITY.md` | New commands and convention exports may be added | Compliant design | Optional needs/countServices and doctorChecks; R3-2 owns the prerequisite generator work, this spec adds none |
| `.ai/qa/AGENTS.md` | Integration tests self-contained | Compliant | Database test owns two tenants and all fixtures; cleanup in `finally` |
| root AGENTS.md | User-facing strings use i18n | Designed | Check/report output uses translation keys |
| R3-4 / R4-7 | Configuration-only default; read-only database counts and C1 tenant settings reads | Compliant design | `privacy.retention_settings_unset` uses `createReadOnlyPrivacySettingsService`; explicit flag, same manager/tenant list, counts-only findings, unavailable reads are errors |
| R4-5 | Attachments-owned stale pending-deletion diagnostic | Cited design | `attachments.pending_deletions_stale`, `needs: 'database'`, rows older than 7 days; runtime rows delete after drain and write no action-log entries/history identities |

C1 defines bootstrap-free, configs-owned reads for both domain settings and the shared aggregate check. B4/forms use owner factories. Scheduler consumes the operational owner's declared manifest/binding with the same nullable-tenant count signature; only its exact check/service pair may count null-tenant system rows.

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Delta scenarios map to tests | Designed | TC-001 to TC-003 and named registry/database unit suites |
| Every step leaves the app working | Pass | Phase 1 changes no behaviour |
| Check ids are consistent between tables | Pass | — |
| Severities agree with the key-guard spec | Pass | Assumption 5 names the single exception class (a module whose operation the runtime refuses, or will refuse from the next minor, above a bound without a required secret), R5-4's encryption-conditional `sso.scim_lookup_secret_missing`, and lists it in the known-consumer table |
| Extension point matches the binding contract design | Aligned | Optional `Module.privacy` carries `doctorChecks`; `Module.privacyDataClasses` is derived; default-only is C1’s deliberate policy |
| Every check named here has an owner | Pass | This spec owns backlog delivery, including owner-module database declarations/count factories; other specs own their separately shipped checks |
| Claims about other processes' modes | Pass | The doctor reports its own process only; the key guard's runtime check covers each service |

### Non-Compliant Items
No implementation was assessed. C1 now extends G4's sole scaffold and specifies bootstrap-free get-only settings reads and the independent settings counter/binding; forms names all five suppression/unsubscribe checks, including the two fallback-secret checks, and fail-closed specifies its shared accessor. The pruner owner now specifies its side-effect-free enabled-handler schedule definitions, exact key/UUID expansion and scheduler factory/binding; their implementation and isolated-selection tests remain default-flip prerequisites.

### Verdict
**Design settled.** Assumption 4 and the module id (DEC-10) are decided; the shell, command and built-in checks are proposed for OSS. Written upstream approval must name this proposed OSS carrier under [DEC-2](2026-11-15-gdpr-ready-deployments-program.md#decisions) before implementation or OSS submission. C1 Phase 1/R3-2 precedes Phase 3; C1 Phase 7 supplies domain get-only settings reads and the independent shared check/counter. Owner token/forms checks use lazy tenant counters; scheduler's exact check/service pair alone counts system rows with null tenant, including zero-tenant installations.
## Changelog

- 2026-11-16 — Initial specification.
