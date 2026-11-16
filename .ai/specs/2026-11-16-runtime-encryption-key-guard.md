# Runtime encryption-key guard

> **Program:** packages A1 and A2 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Verified at** `main` @ `08dada9624`; code references are inline.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-11-01-7231-compose-encryption-key.md

## 📝 TLDR

An operator who deploys with Docker Compose is stopped before the app starts if the tenant encryption secret is one published in this repository, too weak, or absent. An operator who deploys any other way (Kubernetes, a bare `mercato server start`, a managed platform) gets no check: the runtime uses whatever is in the environment, and with nothing there it writes plaintext. **Proposed (future):** put the policy in shared code. A published encryption secret is refused by every production process. A weak secret, or encryption left unconfigured, stops a production *service* from starting — after one release in which it only warns. Development stacks keep working with a warning.

**Not in this spec:** what happens when a configured KMS becomes unreachable (program package A3); immediate lookup-secret refusal before the rehash tools of Phase D of [`2026-11-16-encryption-map-coverage-and-backfill.md`](2026-11-16-encryption-map-coverage-and-backfill.md) (program package B1); any change to the Compose files; key rotation itself; implementation of the later default flip or post-Phase-D lookup refusal (both have tracked release tasks here); `FORMS_ENCRYPTION_MASTER_KEY`, owned by the forms module and its separate organization-key adapter (`packages/core/src/modules/forms/services/encryption-service.ts:128-170`). The CI workflow commits a forms key (`.github/workflows/ci.yml:1045`); this guard does not inspect it and makes no claim to protect deployments that reuse it. The forms owner must supply that check.

## 📝 Overview

This closes the gap #7231 left on purpose. That work removed the published key from the Compose files and added a preflight service, and stated "No changes to runtime cryptography, KMS interfaces…". The same rules now move into the runtime, as far as the existing migration tooling allows.

> **Market reference.** Rails refuses to boot in production without `secret_key_base`; Django's `check --deploy` flags a short or default `SECRET_KEY` but only warns. Adopted from Rails: a hard stop for material that is publicly known. Adopted from Django: a staged warning for weak-but-private configuration, and a check that runs without starting the server. Rejected: Django's choice to never refuse — a key anyone can read in this repository is not a configuration smell.

## 📝 Problem Statement

- **The runtime does not validate the secret.** `resolveDerivedKeySecret` takes `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`, then `TENANT_DATA_ENCRYPTION_KEY`, and uses the first non-empty value (`packages/shared/src/lib/encryption/kms.ts:119-135`).
- **Nothing configured means plaintext.** With encryption on, no healthy Vault and no secret, `createKmsService` logs a warning and returns a no-op service (`kms.ts:455-461`). Encryption is on unless explicitly disabled (`packages/shared/src/lib/encryption/toggles.ts:3-9`).
- **The same secret keys lookup hashes.** `resolveLookupPepper` uses `LOOKUP_HASH_PEPPER`, then the two encryption variables; with none set, hashes are unkeyed (`packages/shared/src/lib/encryption/aes.ts:190-221`).
- **The policy exists in Compose only.** An inline script, copied into three Compose files, refuses a secret under 32 bytes, with fewer than 8 distinct characters, or whose SHA-256 is one of five published values. It also refuses "no secret and no Vault", an insecure Vault address, and a missing or unsafe lookup secret (`docker-compose.fullapp.yml:18-45`).
- **The five values in today's Compose denylist are repository test and development material:** the development Compose key, `om-ephemeral-integration-fallback-key`, `tc-customers-seed-001-derived-key`, `installation-pepper-secret-value` and `checkout-encryption-fallback-secret` (`scripts/__tests__/fullapp-compose-encryption.test.mjs:18-21`).
- **A sixth published value is missing from the Compose denylist:** `ci-standalone-test-fallback-key`, committed in `.github/workflows/{snapshot,npm-snapshot-preview}.yml` and `scripts/test-create-app-integration.ts`. It is 31 bytes, so Compose refuses it as weak; the runtime published set must include its SHA-256 and refuse it as published. Removing a literal from CI never makes it private again.
- **An error during bootstrap is swallowed.** `createRequestContainer` wraps bootstrap in `try { … } catch { /* optional */ }` (`packages/shared/src/lib/di/container.ts:278-284`). If `createKmsService` threw at `packages/core/src/bootstrap.ts:194`, the KMS service, the encryption service and its subscriber would silently go unregistered and the process would write plaintext. Tenant setup has the same shape: it catches and logs only in debug mode (`packages/core/src/modules/auth/lib/setup-app.ts:394-412`).
- **The KMS service is built in many places:** callers across `bootstrap.ts`, `api_keys`, `auth` (CLI and tenant setup), `entities` CLI, `integrations` (credentials and OAuth grants), `query_index`, and the `TenantDataEncryptionService` constructor default.
- **Migration tooling is incomplete.** The runbook says there is "no universal pepper-rotation/backfill CLI", that lookup candidates cover the current keyed hash and the legacy unkeyed hash but "not an old keyed pepper", and that rotation skips system-scoped maps (`starters/docker/encryption-migration.md:147-153`).
- **The repository's own test environments would be refused.** The ephemeral integration app runs with `NODE_ENV=production` and defaults to a published secret (`packages/cli/src/lib/testing/integration.ts:2196, 2282, 3693`). The standalone-app CI uses a 31-byte secret (`.github/workflows/snapshot.yml:232, 376`).
- **The development runner looks like production to its children.** `mercato server dev` starts Next.js in development mode but spawns workers and the scheduler through `buildServerProcessEnvironment`, which forces `NODE_ENV=production` (`packages/cli/src/mercato.ts:402-404, 2312, 2391`). The development Compose files default to a published key (`starters/docker/compose.fullapp.dev.yml:143`).
- **A per-run handshake already exists.** The `yarn dev` supervisor creates a random token per run (`scripts/dev-runtime-diagnostics.mjs:22-24`) and passes it to its child as `OM_DEV_RUNTIME_TOKEN` (`scripts/dev-runtime-supervisor.mjs:190`). Dev diagnostics key off that handshake, not `NODE_ENV`, and stay closed when the flag is set by hand (`packages/shared/src/lib/dev-runtime/server.ts:46-68`). `mercato server dev` passes nothing comparable to the workers and scheduler it spawns.
- **Services are more than the web server.** Long-running processes: the Next.js server, `queue worker`, `scheduler start`, `search worker`, `ai_assistant mcp:serve` and `mcp:serve-http`, `workflows start-worker`, `channel_discord start-gateway`, `server start`, and the documents collaboration server, which is a plain Node script outside the CLI dispatcher (`packages/documents/package.json:9-10`). A single-queue worker builds no container at start and fails per job instead (`packages/cli/src/lib/worker-job-handler.ts:33-34`); the local queue drops a job once its attempts are used up.
- **Three preflight scripts call `createKmsService` and replace any error with "restore the original keys"** (`packages/starter/src/encryption-preflight.mjs:38-44, 208`, with copies in `scripts/` and the create-app template). One runs in production through `docker/scripts/init-or-migrate.sh`.
- **A runtime precedent exists.** The JWT signing secret is checked on every read and eagerly at server start, where a violation exits the process (`packages/shared/src/lib/auth/jwt.ts:140-165`, `apps/mercato/src/instrumentation.ts:5-24`).

## 📝 Prior spec drift

- `.ai/specs/2026-11-01-7231-compose-encryption-key.md`: in sync with the code. Its status line reads "named maintainer security-waiver approval pending", so the precedent this spec uses for the published-secret case is not yet signed off.

## 📝 Decisions

Answered by the issue assignee on 2026-11-16. R1–R3 were raised by the independent review and change two earlier answers.

| # | Decision |
|---|---|
| Q1 | This spec owns everything decidable at boot from configuration. The fail-closed spec owns a configured KMS that becomes unreachable. |
| Q2 → R1 | Boot refusal covers the *encryption* secret and "nothing configured". **Lookup-secret findings warn in the first release.** A tracked post-Phase-D task below delivers refusal after all hash fills and token reindex procedures ship; it does not leave warnings permanent. |
| Q3 | A shared policy module. The Compose files are not edited; a test keeps them in step. |
| Q4 → R2 | A published encryption secret is refused wherever the KMS is built and at every service start. **Weak and unconfigured are refused only when a service starts.** Services are listed under Components. |
| Q5 | A `warn` / `enforce` setting bridges weak and unconfigured, and the insecure Vault address under the resolved default below. `warn` stays a supported, deprecated opt-out after the default flips. |
| R3 | One spec, two PRs. The spec ends at the bridge; the later default flip is a tracked release task with stated gates. |

## 📝 Proposed Solution

One module decides whether the tenant-encryption configuration is safe and returns findings.

| Finding | Meaning | In production |
|---|---|---|
| `published_secret` | Encryption is on and the effective encryption secret hashes to a published value | Refused wherever the KMS is built, and at service start |
| `weak_secret` | Encryption is on and the effective encryption secret is under 32 UTF-8 bytes, or has fewer than 8 distinct characters | Bridged, at service start |
| `not_configured` | Encryption is on, no secret is set, and Vault address and token are not both set | Bridged, at service start |
| `published_lookup_secret`, `weak_lookup_secret`, `missing_lookup_secret` | The effective lookup secret is published, weak or absent | Warning in the initial release; tracked post-Phase-D refusal below |
| `insecure_vault_address` | Not HTTPS, except loopback; or carries credentials | Bridged at service start, same as weak/unconfigured |

**Bridged** means governed by `TENANT_DATA_ENCRYPTION_KEY_POLICY`. In the release that ships this (target 0.11.0) the default is `warn`: the service starts and logs one loud warning. Set to `enforce`, the service refuses to start. One-off commands, builds and migrations never refuse on a bridged finding; they warn.

**Production** here means `NODE_ENV` is `production` and the process holds no valid binding to a live development runner. Under R5-2, a process whose `NODE_ENV` is not `production` is a development process: it ignores the mark file and attempted dev marks, never needs a binding, and is never forced onto production rules. Only a process with `NODE_ENV=production` that carries the dev mark runs the R3-11 binding check. Without a valid binding it remains production and logs once at error level. `mercato server dev` binds the production-mode workers and scheduler it spawns to itself with a per-run nonce (see Development runner under Components). Outside production every finding is a single warning and nothing is refused. Under `NODE_ENV=test` the ordinary runtime logger is silent regardless of any mark; the explicit check command still simulates production and prints findings.

### Resolved assumptions (autonomous defaults)

| # | Question | Chosen default | Fallback |
|---|---|---|---|
| 1 | Remote HTTP Vault or embedded URL credentials | ⚠ NEEDS HUMAN CONFIRMATION. `insecure_vault_address` joins the ordinary `warn` / `enforce` service-start bridge, default `warn` for one minor | A maintainer may keep warning-only for documented local TLS termination; absent that decision, the bridged default is the design and remote HTTP is refused under `enforce`. |
| 2 | Later published lookup-secret refusal | ⚠ NEEDS HUMAN CONFIRMATION. Open a separate release task with PR A2, using a fresh named-maintainer Emergency Security Exception after Phase D and B4 gates pass. The program's DEC-12 records this same later task and separate approval gate; neither A1 nor #7231 approves it | If the program owner or maintainer declines the separate waiver, use the ordinary bridge for the published lookup finding too; weak/missing lookup findings always take the ordinary bridge. No A1 approval substitutes for this decision. |

### Design decisions

| Decision | Rationale |
|---|---|
| A typed error that swallow sites rethrow | Without it the refusal turns into silent plaintext (see Problem Statement). |
| Inspect the *effective* secrets only | The runtime uses the first non-empty variable; Compose makes the same choice. |
| Lookup-secret findings warn until the tracked Phase D gates pass | Before the repair commands exist, refusal would strand maintenance. The release task adds published lookup refusal by the exception route, or its bridge fallback, and weak/missing lookup refusal by the ordinary bridge; all required commands use a safe current secret and old material only from maintenance variables. |
| Bridged findings stop services, not commands | Build stages and migrations run in production mode without secrets. Writes made by a one-off command on an unconfigured installation are the fail-closed spec's concern. |
| With encryption off, the secret is judged as a lookup secret | Switched off, the value encrypts nothing and only keys lookup hashes. Refusing it while a published `LOOKUP_HASH_PEPPER` merely warns would treat the same exposure two ways. |
| The check is the first statement of `createRequestContainer` | Bootstrap registers the event bus and subscribers before it reaches the KMS (`packages/core/src/bootstrap.ts:151-194`). Checking first means a refused process registers nothing. |
| The service-start check ships with the refusal, not with the bridge | A single-queue worker never builds a container at start. Without the start check it would stay up, reject every job and let the local queue discard them. |
| The development runner binds its children to itself | They run in production mode for logging and performance reasons, on development secrets; without an exemption every development stack on the default key would lose its workers. A bare variable would be an operator-settable switch round the refusal, which the compatibility exception forbids. R3-11 therefore requires a parent IPC nonce and the matching fixed-path file, not an environment nonce. The diagnostics token is an existing precedent for per-run generation, not proof of the new binding. |
| No override for a published encryption secret | The compatibility exception forbids a retained toggle. |
| Environment parsing is memoized; dev liveness is not | Per-request callers need cheap inspection, but an orphan must lose its exemption. IPC disconnect clears the binding immediately and policy calls recheck parent PID/liveness and the fixed-path mark. |
| A small command prints the findings | Operators need a check they can run before upgrading; `doctor` (program package G4) later aggregates the same findings as `encryption.key_policy.<code>`, from `inspectTenantEncryptionConfig`. |
| The repository's own test environments are fixed first | Otherwise the change breaks the integration suite it ships with. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Replace the Compose inline scripts with a call into the shared module | Reopens an artifact that shipped days ago under a waiver still pending. |
| Enforce only at server start | Workers and the scheduler never run the startup hook, and a published secret must not be usable by any production process. |
| Return a refusing KMS service instead of throwing | Until the fail-closed spec lands, an unhealthy KMS means plaintext writes. |
| Refuse a weak secret immediately | A short private secret "merely makes an insecure usage possible"; the exception does not cover it. |
| Refuse an unsafe lookup secret before Phase D | Strands operators; the tracked gated release task supplies the later refusal. |
| A fixed replacement secret for the test runner | Any constant in the repository is published material. |
| Two specs, one per compatibility route | Both stand on the same module and tests. Separate PRs keep the approvals apart. |
| Change the development Compose default instead of marking the runner's children | Invalidates the data of every existing development stack and edits three more Compose files. |
| Tell operators to run maintenance commands outside production mode | A non-production CLI writes a `.env` from the example file and fills unset variables with placeholders (`packages/cli/src/mercato.ts:358-366`); the Compose file records that it broke init and migrations in the production image. |

## 📝 Delta

### Capability: tenant-encryption-configuration

#### MODIFIED Requirement: Tenant encryption secret acceptance
In production, the system SHALL refuse to build its encryption service when the effective tenant encryption secret is a value published in this repository, and SHALL NOT continue without an encryption service as a result.

##### Scenario: Published secret in production
- WHEN any production process builds its encryption service with a published encryption secret
- THEN the process fails with a message naming the variable and the rotation procedure, the secret is not printed, and no request or job is handled without encryption

##### Scenario: Published secret outside production
- WHEN a development process starts with a published secret
- THEN it runs and logs one warning

##### Scenario: Development processes beside a live mark file
- WHEN a development-mode CLI or a Next.js development-server grandchild starts with a published secret beside a live runner mark file and has no parent IPC binding
- THEN it ignores the file, remains non-production and runs with one warning under R5-2

##### Scenario: Development runner
- WHEN `mercato server dev` spawns a worker while a published secret is set
- THEN the worker runs and logs one warning

##### Scenario: Development mark without the runner
- WHEN a production process starts with a published secret and environment-only dev variables or a forged run file set, but no valid parent IPC binding
- THEN it is refused as if the mark were absent, and logs once at error level that the mark was ignored

##### Scenario: Rotating away
- WHEN a production process runs with a new strong secret as current and the published value in the old-key variable
- THEN it is not refused

Frozen by: `packages/shared/src/lib/encryption/__tests__/kms.key-acceptance.characterization.test.ts`

#### MODIFIED Requirement: Unconfigured or weak tenant encryption
In production, the system SHALL warn when the effective encryption secret is weak, when encryption is on and neither a secret nor Vault is configured, or when the configured Vault address is insecure, and SHALL refuse to start a service on those bridged findings when the key policy is `enforce`.

##### Scenario: Weak secret, default policy
- WHEN a production web server starts with a 20-byte secret and no policy set
- THEN it starts and logs one warning naming the release in which this will be refused

##### Scenario: Weak secret, enforce
- WHEN a production queue worker starts with the same secret and the policy set to `enforce`
- THEN it exits non-zero with a message naming the variable

##### Scenario: Insecure Vault
- WHEN a production service uses remote HTTP Vault or URL credentials under `enforce`
- THEN it refuses at service start; loopback HTTP without URL credentials is allowed

##### Scenario: One-off command
- WHEN a one-off command runs in production with a weak secret and the policy set to `enforce`
- THEN it runs and logs one warning

Frozen by: `packages/shared/src/lib/encryption/__tests__/kms.key-acceptance.characterization.test.ts`

#### ADDED Requirement: Development binding lifetime
For a process with `NODE_ENV=production`, the system SHALL honour a dev exemption only while R3-11's parent IPC binding remains valid. Under R5-2, non-production processes need no exemption or binding.

##### Scenario: Runner exits
- WHEN the runner exits after its production-mode child successfully bound
- THEN IPC disconnect invalidates the exemption and exits the child; a cached earlier inspection cannot preserve it

#### ADDED Requirement: Gated lookup refusal delivery
PR A2 SHALL open the separately tracked post-Phase-D refusal task with the acceptance criteria and gates under Migration & Backward Compatibility.

##### Scenario: Required tooling ships
- WHEN B1 Phase D and B4 repair procedures pass the task gates
- THEN the task ships published lookup refusal only with its named security waiver or bridge fallback, and weak/missing lookup findings begin their own ordinary warning period before enforcement

#### ADDED Requirement: Startup exit
The system SHALL exit the web server process with a non-zero code when the configuration is refused at startup.

##### Scenario: Server start
- WHEN the production server starts with a refused configuration
- THEN the process exits 1 after writing the reason to standard error, and serves no request

#### ADDED Requirement: Configuration check command
The system SHALL report the findings for the current environment without connecting to the database, and SHALL exit non-zero when a production service would be refused.

##### Scenario: Check before upgrade
- WHEN an operator runs the check from any shell mode with a published encryption secret and a remote HTTP Vault address
- THEN production-service findings are listed with their variable names and both conditional data-state exits, no secret value is shown, and the command exits 1

## 📝 Architecture

```mermaid
flowchart TD
  P["keyPolicy.ts (new)<br/>rules, published hashes, typed error"]
  K["createKmsService (existing)"] -- "throws on published secret" --> P
  C["createRequestContainer (existing)"] -- "check first; rethrow" --> P
  C --> K
  I["instrumentation.ts (existing)<br/>app + template"] -- "assert, exit 1" --> P
  W["service entrypoints (existing)<br/>worker, scheduler, search, MCP, collab"] -- "assert before run" --> P
  X["check command (new)"] -- inspect --> P
  R["integration runner (existing)"] -. "is this secret safe?" .-> P
  T["parity test (new)"] -- "runs the Compose script" --> F["3 Compose files (unchanged)"]
  T -- compares --> P
```

Takeaway: one module holds the rules. A published secret stops every production process; weak and unconfigured stop services; nothing is swallowed.

### Components

- **`packages/shared/src/lib/encryption/keyPolicy.ts`** (new)
  - `inspectTenantEncryptionConfig(env)` returns findings: a code, a subject, the variable name and a disposition. It never returns a secret, a length or a hash. Only the environment parsing is memoized for `process.env`; runtime classification and the parent binding are checked separately.
  - `enforceTenantEncryptionSecretPolicy()` throws `TenantEncryptionPolicyError` for a published encryption secret in production, and logs each other finding once.
  - `assertTenantEncryptionServicePolicy()` does the same and also throws for bridged findings when the policy is `enforce`. It is the service-start form.
  - `isTenantEncryptionPolicyError(err)` recognises the error by a `Symbol.for` brand, because `instanceof` fails across bundle copies.
  - The initial published hash set contains all six values identified above, including the removed 31-byte CI literal. A historical committed deployment-key literal stays in the set after its source is deleted; the code stores only SHA-256 digests and tests supply the public probes.
  - `isUnsafeTenantEncryptionSecret(value)` is for tooling that launches the app.
  - Normalization matches `kms.ts` (trim, strip surrounding quotes).
- **`createRequestContainer`** calls the enforce function as its first statement, before any registrar or bootstrap runs, and its bootstrap `catch` rethrows the typed error.
- **`createKmsService`** calls the enforce function before it builds anything, for callers that never create a container.
- **Other swallow sites** rethrow the typed error: the DEK-provisioning `catch` in tenant setup and other in-process callers. The three preflight scripts need the cross-process protocol below; a `Symbol.for` brand does not cross IPC. Every other call site is audited in the same change; any `catch` that would hide the error rethrows it.
- **Preflight IPC protocol.** In `--encryption-probe`, catch `TenantEncryptionPolicyError` and send `{ type: 'tenant-encryption-policy-refused', code, envName }`, then exit with reserved code 78. Only the declared finding codes and known configuration variable names are allowed; no arbitrary error message or secret crosses IPC. `runIsolatedProbe` validates the message and exit-code pair and reconstructs a locally branded policy error with the sanitized policy message. `assertEncryptionCompatible` rethrows it rather than wrapping it as `EncryptionCompatibilityError`. All other failure/timeout/malformed-message cases keep today's generic compatibility failure. The parent thus never tells an operator to restore a published key when the probe refused it. Apply identically in the starter, script and template copies and test the actual fork boundary for each.
- **Web server.** `instrumentation.ts`, in the app and in the create-app template, calls the service-start assertion beside the JWT assertion, inside the same Node-only, not-during-build guard and the same exit-on-throw block.
- **Other services.** The CLI dispatcher in `packages/cli/src/mercato.ts` holds one list of service commands and calls the service-start assertion before it runs any of them: `queue worker`, `scheduler start`, `search worker`, `ai_assistant mcp:serve`, `ai_assistant mcp:serve-http`, `workflows start-worker` and `channel_discord start-gateway`. The built-in `server start` branch calls the assertion before it spawns `next start`, covering apps scaffolded before instrumentation gained the assertion. A static unit test flags first-party CLI worker launchers missing from this service list. Third-party long-running commands must call the exported assertion at entry; automatic detection of arbitrary third-party services is not claimed. A throw takes the dispatcher's existing failure path and exits 1, before the command consumes anything. Workers spawned by `server start` are separate `mercato` processes and pass through the same check. The documents collaboration server is not a CLI command, so its entry script calls the assertion itself before it listens.
- **R3-11 — The dev-runner binding is delivered over IPC.** This is the normative implementation of DEC-E and R3-11, limited by R5-2 to processes with `NODE_ENV=production` that carry the dev mark. Non-production processes ignore the mark file; `initializeTenantEncryptionDevBinding(projectDir)` returns immediately without file or IPC checks, and no encryption-policy binding is needed.
  - `mercato server dev` generates 24 random bytes per run and writes `.mercato/dev-runtime-mark.json`, mode `0600`, under the resolved project directory, holding the nonce and its own PID. The path is fixed, never read from the environment. Eager and lazy production-mode dev children, including workers and the scheduler, use a spawn IPC channel; non-production Next.js processes need no binding. The binding nonce is never passed through environment variables, argv or logs; `OM_DEV_RUNTIME` and `OM_DEV_RUNTIME_MARK_FILE` never grant an exemption. The diagnostics-only `OM_DEV_RUNTIME_TOKEN` remains separate and grants no encryption exemption.
  - Before any policy assertion or KMS construction, a production-mode dev child installs its IPC receiver with `initializeTenantEncryptionDevBinding(projectDir)` and signals readiness. The runner sends `{ type: 'tenant-encryption.dev-binding', nonce, parentPid }` through that channel. The receiver validates the shape and accepts only its original parent channel. Initialization is asynchronous and bounded to five seconds when an IPC channel exists; timeout, missing IPC or malformed messages establish no binding. Direct synchronous policy calls before initialization fail closed as production.
  - A production-mode child honours the mark only if it received that parent message, the parent PID equals `process.ppid` and is alive, and the fixed-path file carries that same PID and nonce (constant-time comparison). Require current-user ownership, regular file/no symlink and mode `0600`. A foreign environment path is ignored. These checks prevent a copied environment, PID 1 substituted for a different parent, or an arbitrary live PID from granting the exemption.
  - Cache the parsed environment only. Revalidate the parent identity/liveness and file on each runtime-policy call. An IPC `disconnect` invalidates the binding immediately and exits the bound production-mode dev child before another request or job; the runner cleans up the mark on normal shutdown. A production-mode child that carries a file or attempted mark without a valid binding remains production and logs once at error level, with a sanitized reason and no nonce. A non-production child ignores both, even beside a live mark file or when its parent is a Next.js child rather than the runner. A restart within the same run gets a new parent message; it cannot reuse a cached exemption from a prior channel.
  - `server start` neither writes the mark nor sends a binding message. It discards inherited dev variables before spawning services. `.mercato/` is already ignored by git.
  - **Threat model:** this prevents accidental or copy-pasted production bypasses. A person with shell access deliberately forging a parent process and its IPC exchange is out of scope. This residual and unsupported development-mode serving are disclosed in the exception request and operator docs; the spec does not claim cryptographic attestation of the runner executable.
- **Check command.** `mercato entities check-encryption-config` always evaluates production-service rules under the configured policy, even from a development/test shell or bound dev child. It neither changes the caller's `NODE_ENV` nor applies a dev exemption. It reads the environment only, never infers database contents, and is in the dispatcher's no-`.env` list in every mode.
- **Integration runner.** See Phase 2.

### What a refusal says

The environment-only inspector cannot know whether a database holds data. Every refusal names the variable, states the reason and prints both conditional exits; it never selects a branch based on guessed installation state:

| Finding | Exits named |
|---|---|
| Published or weak encryption secret | If the database already holds data, keep traffic stopped and use `starters/docker/encryption-migration.md` with the old secret in `TENANT_DATA_ENCRYPTION_OLD_KEY`; do not replace a key over existing ciphertext. Generate a new secret directly only for a confirmed empty database. The complete data-maintenance steps below are printed or linked in both cases. |
| Nothing configured | Set a safe secret; for existing plaintext run `mercato entities backfill-encryption --tenant <id> --apply`, the search-owned `mercato search encrypt-vector-display` step, and `mercato entities backfill-system-encryption`; generate directly only for a confirmed empty database. An operator may explicitly disable tenant encryption with `TENANT_DATA_ENCRYPTION=false`, accepting plaintext storage. |
| Lookup-secret finding after its gated release | Set a safe current lookup secret, retain the old secret only in maintenance variables and run the exact hash fills and B4 token procedure below before traffic returns; generate directly only for a confirmed empty database. |
| Insecure Vault address under `enforce` | Use HTTPS without embedded credentials; HTTP is allowed only for loopback. Review a local TLS-termination deployment before relying on the explicit deprecated `warn` opt-out. |

It never includes a secret, its length, hash or database-state claim. The required data-maintenance list is `mercato entities rehash-lookups` per tenant and for `none`, `mercato customers fill-lookup-hashes`, `mercato sso fill-lookup-hashes` and `mercato communication_channels fill-lookup-hashes` for enabled modules, and `mercato entities backfill-system-encryption` for system records, citing B1 Phase D: DEC-F — The B1 hand-offs and R3-12 — Fill commands for module-written hashes. Run the additional enabled coverage-owned fills listed by B1, including `mercato forms fill-privacy-hashes` and `mercato inbox_ops fill-privacy-lookups`, to recompute stale non-null hashes too. B1 Phase D introduces the customers command and columns; it is not an existing remedy today. B4's API Contracts → Search-owned vector maintenance adapter specifies DI `searchVectorDisplayMaintenance: SearchVectorDisplayMaintenance`, exported from `@open-mercato/search/modules/search/lib/vector-display-maintenance`, with `enumerateScopes`, `prepare`, bounded `readBaselinePage`, `resealPage` and independent target-only `readTargetPage` using session-pinned concrete DEKs. Its Vector CLI / service contract defines the `searchVectorDisplayMaintenance.run` facade returning `VectorDisplayMaintenanceReport`, shared with `mercato search encrypt-vector-display --tenant <id> --apply`. Under R4-10 as corrected by R5-3, the facade gains optional `pin?: { providerIdentity: string; wrappedDekFingerprint: string }`. `providerIdentity` is `VectorDisplayMaintenanceKeyPin.providerIdentity`; `wrappedDekFingerprint` is the SHA-256 of the tenant's stored wrapped-DEK bytes, read without unwrapping and changed on every rotation. Enterprise supplies its frozen target and the run refuses with `pin_mismatch` if the active provider identity or wrapped-DEK fingerprint differs. Calls without a pin retain the existing behavior. It encrypts plaintext displays and reseals old-key envelopes, accepting `TENANT_DATA_ENCRYPTION_OLD_KEY` only from the maintenance environment. For every affected tenant require a fresh report from the beginning with `verification: 'full'`, `done: true`, `complete: true` and zero per-column `plaintext`, `oldKey`, `unreadable` and `blocked` counts, verifying every non-null mapped value under the target key. Enterprise's protected rotation additionally compares its encrypted pre-rotation logical baseline through independent pinned-target reads; the B4 report alone does not prove equality. The adapter is now specified; its implementation, capability preflight and independent full both-store verification must pass before the search-enabled A1 exit is advertised as available. R5-3 names stored wrapped-DEK bytes, but current derived-key tenants have no stored wrapped DEK; the search/encryption owner must resolve that source before those targets can satisfy the pin, and no substitute fingerprint is defined here.

If the effective lookup secret changed, including when it fell back to the rotated encryption key, keep traffic and all ordinary writers stopped after the B1 Phase D hash passes. Only the named maintenance passes and their dedicated reindex workers may write; coverage-owned fills are required for deployed hash columns in enabled modules, as B1 specifies. Follow the [search-index spec](2026-11-16-search-index-pii-protection.md), Proposed Solution → 1. Keyed token hashes → Reindex / Purge and report / Secret change: run `mercato query_index reindex --tenant <id> --entity <module:entity> --force` for every enabled tenant/entity. Rebuild tenantless catalogue scopes with `mercato query_index reindex --entity <catalogue:entity> --force` without a tenant flag; use `mercato query_index reindex --entity <module:entity> --force` without a tenant flag for tenantless rows of tenant-capable entities. Then run `mercato query_index purge-legacy-tokens --tenant <id|none>` as a report for every scope, use `--apply` only for obsolete absent-source rows and repeat the report from the beginning. Require `done: true`, `legacyRows: 0` and zero `fingerprintRows` under every non-current fingerprint, with no unresolved obsolete-source work; retain present/unknown-source tokens and repair their writer rather than purging them to hide a residual. Traffic and ordinary writers resume only after those gates and all store/hash checks pass. Retain the old key until ORM, system, vector and required token gates all verify.

### Rotation and maintenance

- Rotation runs with the new secret as current and the old one in `TENANT_DATA_ENCRYPTION_OLD_KEY`. Only the current secret is inspected, so a production process rotating *away* from a published secret passes.
- Lookup hashes are refreshed by the exact B1 Phase D / R3-12 list and enabled coverage-owned fills above before traffic returns. All fill commands preview by default and require `--apply`; the existing system command keeps its `--dry-run` convention. After every effective lookup-secret change B4 supplies the forced token rebuild for all tenant/entity and tenantless scopes, then query_index-owned purge/report with zero legacy and old-key residuals; all writers remain stopped throughout. These procedures, including vector rotation with search enabled, are release gates. Initial lookup findings warn; their separately tracked release task adds refusal after those gates pass.
- A command that needs the published secret as its *current* one, such as decrypting the database in place, is refused. The supported order is rotate first, then decrypt. The runbook gains that sentence.
- The guard has two conditions that are not production: a non-production `NODE_ENV`, and a development mark bound to the live runner. Neither is a retained toggle. A non-production `NODE_ENV` takes the whole runtime out of production mode — the CLI then writes a `.env` from the example file and fills unset variables with placeholders (`packages/cli/src/mercato.ts:358-366`) — and is not a supported way to serve. The mark has no effect on its own: it requires the R3-11 parent IPC binding while `mercato server dev` remains alive, and otherwise the process treats itself as production and logs at error level. `doctor` cannot see another process's mode; each process checks itself at start.

## 📝 Data Models

None. No entity, table, column or migration. The data-model graph is skipped for that reason.

## 📝 API Contracts

### Exports — `@open-mercato/shared/lib/encryption/keyPolicy`

```ts
export type TenantEncryptionConfigFindingCode =
  | 'published_secret' | 'weak_secret' | 'not_configured'
  | 'published_lookup_secret' | 'weak_lookup_secret' | 'missing_lookup_secret'
  | 'insecure_vault_address'

export type TenantEncryptionConfigFinding = {
  code: TenantEncryptionConfigFindingCode
  subject: 'encryption_secret' | 'lookup_secret' | 'kms' | 'vault_address'
  envName: string | null
  disposition: 'refuse' | 'bridge' | 'warn'
}

export function inspectTenantEncryptionConfig(env?: NodeJS.ProcessEnv): TenantEncryptionConfigFinding[]
export function enforceTenantEncryptionSecretPolicy(): void
export function assertTenantEncryptionServicePolicy(): void
export function isTenantEncryptionPolicyError(err: unknown): boolean
export function isUnsafeTenantEncryptionSecret(value: string | null | undefined): boolean
export function isTenantEncryptionProductionRuntime(): boolean
export function initializeTenantEncryptionDevBinding(projectDir: string): Promise<void>
```

### Configuration

| Variable | Values | Default | Notes |
|---|---|---|---|
| `TENANT_DATA_ENCRYPTION_KEY_POLICY` | `warn`, `enforce` | `warn` | Normalized like the other encryption variables and compared case-insensitively. An unrecognised value falls back to the default and is reported once. No effect on a published secret, and none outside production |

Added to `apps/mercato/.env.example` and the create-app template's copy in the same change. `OM_DEV_RUNTIME` and `OM_DEV_RUNTIME_MARK_FILE` are ignored as exemption inputs and are not added to `.env.example`; the fixed-path mark and parent IPC carry the binding. `initializeTenantEncryptionDevBinding` is called by CLI and Node instrumentation before policy assertions; the exported runtime predicate first checks `NODE_ENV` and returns false without consulting the file or binding for a non-production process (R5-2); only production-mode marked processes use the validated binding, never a bare variable.

### CLI

`mercato entities check-encryption-config` — no flags. Always simulates a production service even under non-production `NODE_ENV`. Prints one line per finding: code, variable, disposition, plus conditional remediation with no database-state guess. Exit 0 when a production service would start under the current policy, 1 otherwise.

### Behaviour change of existing functions

- `createKmsService()` keeps its signature. In production it can now throw `TenantEncryptionPolicyError`.
- `createRequestContainer()` rejects with that error instead of returning a container without encryption.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Published value in `TENANT_DATA_ENCRYPTION_KEY` while `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` holds a strong secret | No finding; the legacy variable is not effective |
| Strong encryption secret, published `LOOKUP_HASH_PEPPER` | Initial release warns; the gated lookup-refusal task changes this after repair tooling ships |
| Vault configured, no secret, no pepper | Initial `missing_lookup_secret` warning; after its ordinary bridge ships, service start under `enforce` refuses; module-written hashes remain null without a secret |
| Vault configured but unreachable at boot | Not this spec |
| Encryption switched off, published secret still set | Initially `published_lookup_secret` warning; covered by the later lookup-refusal task because the value still keys lookup hashes |
| Encryption switched off, nothing set | No finding. Compose refuses this case; the runtime does not, and the parity test does not compare it |
| `next build`, `generate`, migrations with no secret | Not refused; `not_configured` is a bridged finding and these are not services |
| `next build` with a published secret in the build environment | Refused if the build constructs a container |
| Refused configuration during a request in an app with no eager check | Container creation rejects; the request fails with the reason logged. Nothing is written |
| Worker spawned by `mercato server dev` on a published development key | Runs with one warning |
| Development-mode CLI or Next.js dev grandchild beside a live mark file, with no binding | Ignores the file and stays non-production under R5-2; the published key only warns |
| `NODE_ENV=test` with any mark or file | Stays non-production; the ordinary logger remains silent |
| `OM_DEV_RUNTIME` set in a production deployment, or copied into a `.env` | No valid binding: treated as production, refused on a published secret, one error-level log naming the variable |
| Runner crashes after a successful check | IPC disconnect immediately invalidates the binding and exits the child; a surviving synchronous caller rechecks parent identity/liveness before another operation |
| Worker restarted by the runner within one run | Same run file, but a fresh authenticated-by-channel parent message is required; no inherited environment nonce |
| PID-1, foreign-path or unrelated-live-PID forgery | Environment cannot supply the binding; fixed-path, parent equality and IPC receipt checks refuse it |
| Single-queue worker in production on a published secret | Refused by the dispatcher before it consumes a job |
| Compose deployment | Unchanged. Its preflight is stricter than the runtime on the lookup secret and on encryption-off; the runtime does not loosen it |
| Standalone app created before this change | `mercato server start` asserts before spawning Next.js, so both published and bridged findings apply. A direct `next start` bypasses that CLI; the upgrade note requires adding the instrumentation call for that launch path |
| Unknown policy value | Default applies; one warning names the accepted values |
| Multi-replica rollout with one replica misconfigured | That replica refuses or warns alone |

## 📝 Migration & Backward Compatibility

| Change | Route | Why |
|---|---|---|
| Published encryption secret refused in production | Emergency Security Exception | The accepted input is itself the vulnerability: the value is readable by anyone. Same class as the dated entry "Compose encryption (2026-11-01, #7231)" |
| Weak secret, nothing configured, insecure Vault address | Ordinary protocol, behind `TENANT_DATA_ENCRYPTION_KEY_POLICY` | Default warning for one minor; explicit `warn` remains after the flip |
| Later lookup-secret refusal | Separate tracked release task after Phase D and B4 | Published lookup material needs its own security waiver or bridge fallback; weak/missing lookup secrets take the ordinary bridge |
| `createKmsService()` and `createRequestContainer()` can throw a new typed error | Part of the change above; disclosed in the upgrade note | Third-party code that calls either must not swallow it |
| New variable, exports, CLI command | Additive | — |

**What the exception requires of the PR that ships the refusal**

- Argue the condition in the PR text: name the surface, the vulnerability, why a bridge would leave it exploitable, and why neither a non-production `NODE_ENV` nor the bound development mark is a retained toggle (see Rotation and maintenance).
- Keep no toggle for the published case, and let nothing else ride along. The bridge ships in a separate PR.
- Add a dated entry at the end of `BACKWARD_COMPATIBILITY.md`.
- Add the `UPGRADE_NOTES.md` entry below.
- Carry the `security` label and a named human maintainer approval that acknowledges the waiver.

**If a maintainer declines the exception** — including because #7231's own waiver is declined — the published case is bridged like the others. Nothing else changes.

**Ordinary-protocol schedule for the bridge**

| Release | Target | Default | `warn` |
|---|---|---|---|
| Ships the bridge | 0.11.0 | `warn` | Accepted |
| Flips the default | 0.12.0 at the earliest, after gates | `enforce` | Accepted, logged as deprecated but supported; no removal scheduled |

The default flip is a release task tracked with PR A2. `warn` remains an explicit deprecated opt-out, matching the program's ordinary protocol; there is no removal task. The flip is gated on all of:

- at least one minor release has shipped the warning;
- all of B1 Phase D has shipped: mapped `rehash-lookups`, all three exact R3-12 module fill commands, enabled coverage-owned hash fills and system-scope rotation; B4 supplies forced token rebuilds across every tenant/entity and tenantless scope, query_index purge/report showing zero legacy and non-current-key rows, and verified old-key vector reseal;
- the conditional refusal exits and every named command have been verified on populated weak-secret and plaintext installations, with search enabled;
- `mercato server start` enforces before spawning Next.js for previously scaffolded apps, and the upgrade note covers direct `next start`.

### Tracked post-Phase-D lookup-secret refusal

Open this release task with PR A2, separately from the default flip, and name it “Refuse unsafe lookup secrets after B1 Phase D”. Its acceptance criteria change `published_lookup_secret` from warning to refusal at container/KMS construction and service start in production, including with encryption off; this needs a fresh dated Emergency Security Exception and named human approval. If declined, ship that finding behind the ordinary bridge instead. `weak_lookup_secret` and `missing_lookup_secret` become service-start bridged findings, warn for at least one minor from their own introduction, then follow the gated `enforce` default with explicit `warn` still supported. The original encryption-bridge counting period does not substitute for their warning period.

Task gates: the three exact R3-12 fills, enabled coverage-owned fills, mapped rehash and system rotation ship; old/current/legacy/unreadable/collision cases pass in B1; B4's forced tenant/entity and tenantless token rebuilds, zero-legacy/zero-old-key query_index purge/report, and old-key vector reseal procedure verify on a populated search-enabled installation with all writers stopped; every refusal message carries both empty/populated branches; safe-current/old-environment maintenance passes without a bypass. Tests: `keyPolicy.lookup-refusal.test.ts` covers published pepper in a service, a one-off command and encryption-off mode; weak/missing lookup under warn/enforce; and safe current material with old material in maintenance variables. TC-ENCRYPTION-LOOKUP-001 owns isolated tenant/entity and tenantless fixtures with keyed login, SSO, sender, forms and inbox hashes for enabled modules, runs the documented maintenance order in a child environment, verifies lookups/token search, refuses traffic until the zero-residual report, and refuses the unsafe service before work. Include a fallback-key rotation with no dedicated pepper and an incomplete token rebuild that must keep the gate closed; `finally` removes all fixtures and processes. This test ships with the refusal task, not the initial warning PR.

The versions are targets, to be corrected at merge if the release train differs.

**`UPGRADE_NOTES.md` content**

- *Operators:* a production process now refuses a published tenant-encryption secret. What stops working: any deployment still using one of the repository's sample or test values. What to do: rotate following `starters/docker/encryption-migration.md`, then refresh lookup hashes, or logins and other hash lookups stop matching; do not generate a new secret over existing data. Use the exact R3-12 commands `mercato customers fill-lookup-hashes`, `mercato sso fill-lookup-hashes` and `mercato communication_channels fill-lookup-hashes` alongside `mercato entities rehash-lookups`, enabled coverage-owned fills and `mercato entities backfill-system-encryption`, in B1 Phase D order. Complete B4's search-owned vector step; after any effective lookup-secret change, including an encryption-fallback rotation, force the B4 query-index token rebuild for every tenant/entity and tenantless scope, then run `mercato query_index purge-legacy-tokens` apply/report until legacy and old-key row counts are zero. Keep traffic and all writers stopped until every pass verifies. A1 ships only after a verified rotation path works with search enabled; it never advises a presently broken rotation as the sole remedy. Data sealed with a published secret remains suspect after rotation.
- *Operators:* weak/absent encryption configuration and an insecure Vault address now warn at service start and will be refused in a later minor; run `mercato entities check-encryption-config`, and set `TENANT_DATA_ENCRYPTION_KEY_POLICY=enforce` to adopt it early.
- *Standalone app authors:* `mercato server start` now checks before spawning Next.js even for older apps. If launching `next start` directly, add the service-start assertion to `src/instrumentation.ts`; refresh the preflight script for its typed IPC refusal. The dev nonce comes over IPC only; copied env files cannot exempt a production process. Deliberate forged-parent execution and serving in development mode are outside the guard's threat model.
- *Operators:* lookup-secret findings warn initially. PR A2 opens the separately gated refusal task above; its later release note must name its new warning period/waiver and the same maintenance commands. A deprecated explicit `warn` remains supported after an ordinary default flip.
- *Module authors:* `createKmsService()` and `createRequestContainer()` can throw `TenantEncryptionPolicyError` in production. Do not catch it; if a broad `catch` surrounds either call, rethrow when `isTenantEncryptionPolicyError(err)` is true.

**Backports.** None.

**Template sync.** `instrumentation.ts` and `.env.example` are mirrored into the create-app template in the same change; `packages/create-app/src/lib/template-instrumentation-runtime.test.ts` already asserts the two instrumentation files match.

## 📋 Phasing

| Phase | Outcome | PR | Behaviour change |
|---|---|---|---|
| 1 | Policy module, check command, parity test, characterization test | Any | None in services |
| 2 | Repository test environments use safe secrets | Any | None in production |
| 3 | Typed error rethrown; published secret refused everywhere, including at service start (A1) | Its own PR | Yes — exception route |
| 4 | Bridge for weak/unconfigured and insecure Vault at service start (A2), default `warn` | Its own PR | Warnings only |

Phases 3 and 4 may land in the same release but never in the same PR. Phase 3 release is also gated on the verified search-enabled rotation exit; Phase 4 opens the two later release tasks rather than leaving lookup warnings permanent.

## 📋 Implementation Plan

### Phase 1 — Policy, no behaviour change
1. **Characterize.** Add `kms.key-acceptance.characterization.test.ts` asserting today's behaviour under `NODE_ENV=production`: a published secret yields a working derived-key service; a 20-byte secret does too; nothing configured yields the no-op service. Commit it alone, green.
2. Add `keyPolicy.ts` with inspection, the typed error and the helper exports, wired to nothing. Unit tests: each finding code, effective-variable precedence, normalization, the distinct-character rule with multi-byte characters, policy-value parsing, memoization and its test reset, and that no secret, length or digest appears in any finding or message.
3. Add `mercato entities check-encryption-config`. Unit tests for output, both conditional remediation branches and exit codes under development, test and production `NODE_ENV`; the check always evaluates production-service policy and creates no `.env`.
4. Add the parity test. It reads each Compose file, slices the `encryption-preflight` command's block scalar out by indentation (no YAML dependency is added to `packages/shared`), runs that script with `node -e` under probe environments with a strong lookup pepper set so that only the encryption secret decides, and compares each verdict with `isUnsafeTenantEncryptionSecret`. Probes: all six published values (including the removed CI literal), 31 and 32 bytes, 7 and 8 distinct characters, multi-byte characters, quoted and padded values. It needs no Docker. The test lists what it compares and what it deliberately does not (the toggle-off case, Vault address, lookup secret).

### Phase 2 — Test environments
1. Integration runner. Add an optional `tenantEncryptionKey` to `EphemeralEnvironmentState` and to `writeEphemeralEnvironmentState`. Add `resolveEphemeralTenantEncryptionKey`, called after the runner has decided whether it is reusing an environment. When reusing or attaching, the stored value wins, because the running app and its database already use it. When creating, a safe inherited value is used, otherwise a new random one. The result is assigned to the runner's own environment before either child environment is built, so the Playwright process and the app server (the two sites that default to the published value) read the same one. An existing environment whose state has no stored key was started on the published default and is treated as stale. The state file sits under `.ai/qa/`, which `.gitignore` already excludes; it now holds a throwaway secret for a throwaway database, and agents that read that file should know it. Unit tests cover reuse, attach, create with a safe inherited value, create with an unsafe one, and stale state.
2. Replace the 31-byte standalone CI secret, at every occurrence in `snapshot.yml`, `npm-snapshot-preview.yml` and `scripts/test-create-app-integration.ts`, with a value generated per run.
3. Search for all six published literals in tests that start the app or CLI in production mode (known: `TC-CUSTOMERS-SEED-001`) and switch them to a generated value. Leave the literals where they are inputs to refusal tests.
4. Run the full integration suite.

### Phase 3 — Refuse a published secret (PR A1)

Gate before release: B1's store-owned classification and the enterprise/search owners' combined rotation procedure must verify with search enabled. The refusal message must name a working data-preserving exit.
1. Make the in-process swallow sites rethrow the typed error and implement the preflight child/parent IPC protocol in all three copies. Add the R3-11 dev binding before anything throws. Unit tests with `NODE_ENV=production`: env-only nonce/path, PID-1 substituted for a different parent, unrelated live PID, absent/mismatched file, missing IPC, stale file, wrong owner/mode/symlink and expired parent all classify as production with one error log and no nonce. Under R5-2, separately test a development-mode CLI and a Next.js dev grandchild beside a live mark file without a binding: both stay non-production, accept the published dev key with one warning and perform no binding/file validation. Also test development/test modes with invalid marks; test mode remains silent. Test a real spawned parent-child IPC exchange, eager/lazy spawn options, fixed-path `0600` file, readiness/timeout, parent exit after successful validation, restart with a fresh channel, cleanup and no binding on `server start`. Policy tests can simulate refusal; container rejection is tested only after step 2 wires the throw.
2. Call the enforce function first in `createRequestContainer` and in `createKmsService`. Update the characterization test's published-secret case to the new scenarios; adjust `kms.test.ts` cases that run in production mode. Now add the container-rejection test asserting nothing is registered before the refusal.
3. Add the service-start assertion to every service entrypoint: `instrumentation.ts` in the app and the template, the dispatcher's service-command list, and the documents collaboration server. Extend `template-instrumentation-runtime.test.ts`, the instrumentation tests in both locations, and add a dispatcher test that each listed command is checked before it runs. At this point the assertion can only refuse a published secret.
4. `UPGRADE_NOTES.md`, the dated `BACKWARD_COMPATIBILITY.md` entry, the runbook's rotate-then-decrypt sentence and its note for deployments outside Compose, and the encryption pages in `apps/docs`.
5. Integration tests TC-ENCRYPTION-KEY-001 to 003 and TC-ENCRYPTION-KEY-004-PUBLISHED ship in this same PR, proving dispatcher refusal before any worker/scheduler work.

### Phase 4 — Bridge (PR A2)
1. Add the policy setting. Make the service-start assertion, already in place at every service entrypoint, refuse bridged findings under `enforce`. Update the characterization test's weak and unconfigured cases. Unit tests for each policy value at each kind of entrypoint.
2. Add the variable to both `.env.example` files and the docs.
3. Integration tests TC-ENCRYPTION-KEY-004-ENFORCE and 005, including insecure Vault, workflow worker, Discord gateway and `server start`.
4. Open separate tracked release tasks for the default flip and the post-Phase-D lookup refusal, with every gate and test above. Keep `warn` supported after the flip.
5. Archive this Delta into `.ai/specs/capabilities/tenant-encryption-configuration.md` if that directory has been adopted by then; it does not exist today and adding it is a taxonomy change.

### File manifest

| File | Action |
|---|---|
| `packages/shared/src/lib/encryption/keyPolicy.ts` | Create |
| `packages/shared/src/lib/encryption/kms.ts` | Modify — one call in `createKmsService` |
| `packages/shared/src/lib/di/container.ts` | Modify — check first; rethrow |
| `packages/core/src/modules/auth/lib/setup-app.ts` | Modify — rethrow |
| Other `createKmsService` callers (`api_keys`, `integrations`, `query_index`, `entities` and `auth` CLI, `tenantDataEncryptionService.ts`) | Audit; modify only where a `catch` would hide the error |
| `packages/shared/src/lib/encryption/__tests__/{keyPolicy,keyPolicy.compose-parity,kms.key-acceptance.characterization}.test.ts`, a container rejection test | Create |
| `packages/shared/src/lib/encryption/__tests__/kms.test.ts` | Modify |
| Key-policy dev-binding child-process tests, CLI service-list/`server start` tests, and preflight IPC protocol tests for all three copies | Create / modify in PR A1 |
| `packages/shared/src/lib/encryption/__tests__/keyPolicy.lookup-refusal.test.ts`, `packages/core/src/modules/entities/__integration__/TC-ENCRYPTION-LOOKUP-001.spec.ts` | Create in the tracked post-Phase-D release task |
| `packages/core/src/modules/entities/cli.ts`, `packages/core/src/modules/entities/i18n/{en,de,es,ko,pl}.json` | Modify — check command and translated policy/remediation text |
| `packages/cli/src/mercato.ts` | Modify — service-command list and assertion; the development-runner binding for `server dev` children (fixed-path mark and parent IPC nonce, all eager/lazy dev children; assertion in `server start`); check command in the no-`.env` list |
| `packages/documents/server/documents-collab-server.ts` | Modify — assertion before listen |
| `packages/starter/src/encryption-preflight.mjs`, `scripts/dev-encryption-preflight.mjs`, `packages/create-app/template/scripts/dev-encryption-preflight.mjs` | Modify — validated policy-refusal IPC message and reserved exit 78, local error reconstruction/rethrow (kept identical by template sync) |
| `packages/core/src/modules/entities/__integration__/TC-ENCRYPTION-KEY-*.spec.ts` | Create |
| `apps/mercato/src/instrumentation.ts`, `packages/create-app/template/src/instrumentation.ts` and their tests | Modify |
| `packages/cli/src/lib/testing/integration.ts` | Modify — state field, resolver, two sites |
| `.github/workflows/snapshot.yml`, `.github/workflows/npm-snapshot-preview.yml`, `scripts/test-create-app-integration.ts` | Modify |
| `packages/core/src/modules/customers/__integration__/TC-CUSTOMERS-SEED-001.spec.ts` | Modify |
| `apps/mercato/.env.example`, `packages/create-app/template/.env.example` | Modify |
| `UPGRADE_NOTES.md`, `BACKWARD_COMPATIBILITY.md`, `starters/docker/encryption-migration.md`, `apps/docs/docs/user-guide/encryption.mdx`, `apps/docs/docs/architecture/data-encryption.mdx` | Modify |

Editing the CI workflows is a pipeline change; the repository rules ask for a maintainer's agreement before it.

## 🧪 Integration Coverage

No API or UI path changes. The observable surface is process start. Specs live in `packages/core/src/modules/entities/__integration__/`, run the built CLI as `packages/core/src/modules/auth/__integration__/TC-AUTH-033.spec.ts` does, and read exit codes through `spawnSync` with a timeout. Each test builds its child environment explicitly: `NODE_ENV=production`, and the three secret variables, the Vault variables and the policy variable each set to the value the case needs. A variable that must be absent is set to an empty string, never deleted, because the CLI refills unset variables from the app's `.env` (`packages/cli/src/lib/load-env.ts:17-20`). All tests run in production mode, so no `.env` is created. They create no records.

| Test | Command | Covers |
|---|---|---|
| TC-ENCRYPTION-KEY-001 | `mercato auth list-users` | Each of the six published values as the encryption secret: non-zero exit before any data is read, the variable is named, the value is absent from output. This exercises the real path: container creation, bootstrap, the rethrow. Once more with `OM_DEV_RUNTIME=1` and no runner: still refused, and an error line names the ignored mark |
| TC-ENCRYPTION-KEY-002 | `mercato entities check-encryption-config` | Production mode with a new strong secret current and a published value in the old-key variable: exit 0, no refusal finding. Production mode with encryption off and a published secret: exit 0, a lookup warning |
| TC-ENCRYPTION-KEY-003 | `mercato entities check-encryption-config` | Production mode, strong encryption secret, published `LOOKUP_HASH_PEPPER`: exit 0 with the lookup finding as a warning |
| TC-ENCRYPTION-KEY-004-PUBLISHED (PR A1) | `mercato scheduler start`, `mercato queue worker <queue>`, `mercato workflows start-worker`, `mercato channel_discord start-gateway`, `mercato server start` | Published secret: each exits non-zero before consuming, listening or spawning Next.js; no fixtures/jobs are needed |
| TC-ENCRYPTION-KEY-004-ENFORCE (PR A2) | Same five service commands | Weak and missing encryption configuration and a remote HTTP/credential-bearing Vault URL with strong secrets: refuse under `enforce`; each child owns its process/timeout cleanup |
| TC-ENCRYPTION-KEY-005 | `mercato entities check-encryption-config` | Production mode, 20-byte secret: exit 0 under the default policy with a bridged finding; exit 1 under `enforce` |

Covered by unit tests instead, with the reason:

- **The web server's exit** — starting a second production server inside the suite is not practical; the instrumentation tests in the app and the template cover it.
- **Development-mode and development-runner behaviour** — a development-mode CLI run would write a `.env` into the app directory in CI, and a live `server dev` cannot run inside the suite; the policy's production test and each case of the runner's binding are unit-tested. R5-2 cases cover a development-mode CLI and a Next.js dev grandchild beside a live mark file without a binding, plus invalid marks in development/test; none becomes production. The unbound mark is also covered by TC-ENCRYPTION-KEY-001.
- **"Starts and warns" for a long-running service** — a process that keeps running cannot be asserted by exit code; the dispatcher hook is unit-tested for each policy value.
- **"A one-off command still runs" with a weak secret** — the ephemeral database is sealed with the runner's key, so a data-reading command under a different secret would not behave representatively.
- **Container rejection never yields a container without the subscriber.**
- **Vault URL bridge** — `keyPolicy.test.ts` covers loopback HTTP (IPv4/IPv6), remote HTTP, HTTPS, embedded credentials even on HTTPS, and warn/enforce plus one-off commands.
- **Preflight cross-process refusal** — each copy spawns a probe that refuses a published secret; parent output names the policy reason, never says restore that key, and rejects malformed IPC/exit pairs with the generic compatibility failure.

The existing Docker-based `scripts/__tests__/fullapp-compose-encryption.test.mjs` continues to cover Compose.

## 📝 Risks & Impact Review

#### The refusal degrades into silent plaintext
- **Scenario**: A `catch` between the throw and the process boundary hides the error; the process continues with no encryption service.
- **Severity**: Critical
- **Affected area**: every production process
- **Mitigation**: A typed error with a brand; the check runs before the container registers anything; the known swallow sites rethrow; every call site is audited; every service entrypoint exits before doing work; a test asserts container creation rejects.
- **Residual risk**: A third-party module that wraps container creation in a broad `catch`. The upgrade note tells authors what to do; nothing can enforce it.

#### An operator on a published secret cannot fully migrate
- **Scenario**: Rotation re-encrypts tenant data, but system-scoped records and keyed lookup hashes are outside the tool.
- **Severity**: High
- **Affected area**: installations with data sealed under a published secret
- **Mitigation**: A1 waits for verified ORM plus search-owned vector rotation, including R4-10's frozen-target `pin` with R5-3's provider identity and stored wrapped-DEK fingerprint and `pin_mismatch` refusal; Enterprise V13 covers matching pins and each mismatched member. The default flip and lookup refusal wait for all Phase D commands and B4 token repair. Both conditional message branches link the complete order. Maintenance uses safe current material and the old material only in its dedicated variables.
- **Residual risk**: Key migration still needs maintenance downtime and operator verification; it cannot repair any prior disclosure of public-key-encrypted data.

#### A production instance stops at upgrade
- **Scenario**: A deployment on a repository sample value upgrades and refuses to start.
- **Severity**: High
- **Affected area**: non-Compose production deployments using published material
- **Mitigation**: The check command, the message and the upgrade note; the initial refusal set contains six known public values, and a test requires any historical committed deployment-key literal to remain in that set.
- **Residual risk**: Downtime for an operator who upgrades without reading notes.

#### The change breaks the repository's own integration suite
- **Scenario**: The ephemeral app, which runs in production mode on a published default, is refused.
- **Severity**: High
- **Affected area**: CI
- **Mitigation**: Phase 2 lands before Phase 3 and ends with a full suite run.
- **Residual risk**: A test that builds its own environment outside the searched literals; it fails loudly.

#### An operator replaces the secret instead of rotating
- **Scenario**: Faced with a refusal, an operator sets a new secret over existing data; ciphertext becomes unreadable and keyed lookups, including login, stop matching.
- **Severity**: High
- **Affected area**: any installation with encrypted data
- **Mitigation**: The message and the upgrade note both say not to, and why.
- **Residual risk**: Recoverable only by restoring the old secret.

#### The Compose copy and the module drift apart
- **Scenario**: A sixth published value is added to one and not the other.
- **Severity**: Medium
- **Affected area**: the two enforcement points disagree
- **Mitigation**: The parity test runs the Compose script itself and compares verdicts.
- **Residual risk**: Rules the test deliberately does not compare, which it lists.

#### The exception is not granted
- **Scenario**: A maintainer declines the waiver.
- **Severity**: Medium
- **Affected area**: the published-secret case
- **Mitigation**: The fallback is stated: bridge it.
- **Residual risk**: A published secret stays usable outside Compose for longer.

#### Non-production mode is used to dodge the guard
- **Scenario**: An operator serves with `NODE_ENV=development`, or sets the development runner's mark, to keep a published secret.
- **Severity**: Medium
- **Affected area**: misconfigured deployments
- **Mitigation**: In a production-mode process, the mark counts only with a valid binding to a live `mercato server dev` run; set by hand it changes nothing, and that process logs at error level that it ignored it. Under R5-2, a non-production process ignores the mark and never needs the binding. A non-production `NODE_ENV` takes the whole runtime out of production mode and is not a supported way to serve. Neither is documented as an operator option. Each process checks itself at start, because `doctor` cannot see other processes' modes.
- **Residual risk**: A shell user deliberately forges the actual parent process and IPC exchange, or serves in development mode. R3-11 explicitly excludes those deliberate execution choices; environment-only and arbitrary-live-PID forgeries no longer qualify.

#### Development workers are refused
- **Scenario**: The binding fails for a production-mode development worker, for example because the run file cannot be written, or an unrelated development CLI/Next.js grandchild encounters the runner's file without a binding.
- **Severity**: Medium
- **Affected area**: local development stacks on the default key
- **Mitigation**: R5-2 keeps non-production CLI and Next.js processes outside the binding check regardless of the file; explicit unit cases cover both beside a live file. Production-mode workers still require R3-11's binding; their error line names the reason, and unit tests cover the runner's write and cleanup.
- **Residual risk**: A development stack loses its workers until the cause is fixed; it does not fall back to an unbound exemption.

#### A Vault URL or lookup-policy transition blocks an installation
- **Scenario**: Remote HTTP Vault or an unsafe lookup secret becomes refused after its warning period.
- **Severity**: High
- **Affected area**: service startup and deployments outside Compose
- **Mitigation**: The Vault bridge warns for one minor and retains explicit `warn`; the separate lookup task waits for all fills, token repair and its own warning period or named security waiver.
- **Residual risk**: TLS-termination deployments need review; previously scaffolded apps launched by direct `next start` still need their instrumentation update.

## Final Compliance Report — 2026-11-16

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `.ai/specs/AGENTS.md` — in full
- `BACKWARD_COMPATIBILITY.md` — protocol, Emergency Security Exception, the #7231 dated entry
- `packages/core/AGENTS.md` — Encryption section
- `packages/create-app/AGENTS.md` — template-sync rules
- `.ai/qa/AGENTS.md` — test placement
- `packages/shared/AGENTS.md` and `packages/cli/AGENTS.md` — relevant encryption, infrastructure-boundary and CLI contract rules reviewed for this revision.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Ask before changing public contracts | Compliant | Behaviour changes classified; exception conditions listed |
| root AGENTS.md | Ask before changing pipeline automation | Needs approval | Two workflow files and one script change |
| root AGENTS.md | No code under `apps/mercato/src/` except registries | Deviation | One call added to the existing `instrumentation.ts`, beside the JWT assertion already there |
| root AGENTS.md | Mirror `.env.example` and app files into the template | Compliant | Named in Phases 3 and 4 |
| root AGENTS.md | Never commit credentials | Compliant | The module holds hashes of already-published values |
| root AGENTS.md | A catch that records an error must also report it | Compliant | Rethrow sites do not record; warnings go through the structured logger |
| packages/core/AGENTS.md → Encryption | Never hand-roll AES or KMS | Compliant | No encryption code changes; SHA-256 is used only to compare against published values |
| `BACKWARD_COMPATIBILITY.md` | Protocol or argued exception | Compliant | Both routes specified, with fallback, target versions and gates |
| `BACKWARD_COMPATIBILITY.md` → Emergency Security Exception | No flag or opt-in retains the vulnerable branch | Subject to named waiver | Parent IPC plus fixed-path parent-PID mark closes env-only bypasses; deliberate shell-controlled parent forgery is out of scope and explicitly disclosed to the approving maintainer |
| `.ai/qa/AGENTS.md` | Integration tests self-contained | Specified, not run | Initial startup tests create no records; the later lookup-refusal task owns an isolated tenant and cleanup |
| R5-2 | Development processes never inherit production rules from a mark | Specified | Only marked production-mode processes validate R3-11; development CLI and Next.js dev-grandchild unit cases ignore a live file, and test mode remains silent |
| B4 API Contracts, R4-10 and R5-3 | Bind vector maintenance to the rotation target | Required dependency | Enterprise supplies `pin?: { providerIdentity: string; wrappedDekFingerprint: string }`; `pin_mismatch` blocks completion, V13 covers provider/fingerprint drift, and independent logical verification remains required; the derived-provider wrapped-DEK source remains an owner design dependency |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | N/A | No data model |
| Findings table matches Delta scenarios | Pass | Each disposition has a scenario |
| Delta scenarios map to tests | Pass | Each has a TC or a named unit test, with the reason where unit-only |
| Every MODIFIED requirement has a characterization test | Pass | Phase 1 step 1 |
| Every step leaves the app working | Pass | The rethrow lands before anything throws; test environments are fixed before the refusal |

### Non-Compliant Items
- **Rule**: no code under `apps/mercato/src/` except generated registries. **Gap**: `instrumentation.ts` gains one call. **Recommendation**: obtain explicit maintainer sign-off for the app-file deviation before merge and mirror the template; the CLI assertion also protects `mercato server start`.

Three items need explicit maintainer sign-off before merge: the security-exception waiver, the CI workflow edits, and the deviation for `apps/mercato/src/instrumentation.ts`. The later published-lookup refusal needs its own waiver; the resolved Vault bridge default remains marked for human confirmation.

### Verdict
**Approved for implementation**, subject to all three explicit approvals and the recorded resolved-default decisions.

## Changelog

### 2026-11-16
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): apply R5-2 only to production-mode dev marks, keep development CLI and Next.js grandchildren non-production beside a live file, specify unit coverage and align binding risks/compliance; cite R5-3's provider identity and stored wrapped-DEK fingerprint in the rotation hand-off and record the missing derived-provider source.
- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): cite R4-10's optional vector-maintenance target `pin` and `pin_mismatch`, retaining the independent Enterprise verification gate and linking its provider/DEK-version coverage in the migration risk and compliance row.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): replaced the remaining baseline/read design dependency with B4's specified `SearchVectorDisplayMaintenance` adapter and pinned-key baseline/reseal/target-read contract; preserved implementation gates, environment-only old keys and the complete hash/token/writer-stop recovery order.
- Council round two fixes, pass three (GPT-6.1 Sol workers): replaced the stale plaintext-only B4 description with `searchVectorDisplayMaintenance.run`, `VectorDisplayMaintenanceReport`, environment-only old-key reseal and full target-key gates; aligned tenantless rebuild examples and report/apply order with B4; aligned the separate lookup-waiver assumption with the program's DEC-12 while preserving its human approval and bridge fallback.
- Skeleton with open questions; questions answered by the issue assignee; full specification written.
- Independent review returned "resolve direction first": the refusal would have been swallowed by container bootstrap, and lookup-secret refusals would have stranded operators.
- Added `isTenantEncryptionProductionRuntime()` to the exports; `2026-11-16-kms-fail-closed.md` reads it. The two specs keep separate settings.
- Second independent review returned "revise": the first five problems were closed in part, and it found that development stacks would lose their workers, that worker enforcement landed one PR too late, and that the service list was incomplete.
- Revised again: check moved to the first statement of container creation; service-start assertion extended to search worker, MCP servers and the collaboration server and moved into the refusal PR; development runner marks its children; preflight scripts pass the error through; encryption-off classified as a lookup finding; pin-the-pepper and run-outside-production advice removed in favour of the runbook; runner precedence and test environments corrected.
- First revision: typed error with rethrow at the swallow sites; lookup-secret findings downgraded to warnings (R1); weak and unconfigured enforced at service start only (R2); spec ends at the bridge, with the default flip as a gated release task (R3); check command added; runner change specified against the state file; parity test runs the Compose script; target versions named; integration tests name their commands.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g1-03 — `OM_DEV_RUNTIME=1` no longer exempts a process by itself. `mercato server dev` writes a run file with a per-run nonce and its PID and passes the nonce and the file path to its children; the mark counts only when the nonce matches and the PID is live, and otherwise the process treats itself as production and logs once at error level. The `doctor` reliance is replaced by this runtime check. Updated the production definition, a design decision, a Delta scenario, Components, the retained-toggle argument, edge cases, the Phase 3 unit tests, TC-ENCRYPTION-KEY-001, two risks and a compliance row. g1-04 — the lookup-secret refusal, the default flip's gate, the refusal exits, the upgrade note and the incomplete-migration risk now point at Phase D of the encryption-map spec (`mercato entities rehash-lookups`, system-scope rotation in `backfill-system-encryption`).

- Council round two fixes (GPT-6.1 Sol workers): r1kk-03 tracked lookup refusal; r1kk-04 and R3-11 parent IPC binding; r1kk-15 full first-party service list; r1kk-18 Vault URL bridge default; r1kk-19 `server start` assertion; r1kk-22 conditional data-state exits; r1kk-23 retained `warn`; r1kk-24 same-PR worker refusal proof; r1kk-26 disconnect invalidation; g1-17 token reindex/purge; g1-24 sixth published literal; g1-25 typed preflight IPC; g1-31 forms-key exclusion/owner; g1-32 explicit app-file sign-off; F-46 production-rule check command; F-47 container test after wiring.
- Council round two fixes, pass two (GPT-6.1 Sol workers): aligned DEC-F/R3-12 gates with the new customers command and enabled coverage-owned fills; corrected purge ownership to query_index; required B4 forced token rebuilds for every tenant/entity and tenantless scope plus a fresh zero-legacy/zero-old-key report before traffic or writers resume, including encryption-fallback rotations; carried the same gates into default-flip, lookup-refusal, tests and upgrade notes; retained R3-11's IPC binding and the separate lookup-waiver default/ordinary-bridge fallback; identified B4's reseal service as still undelivered.

### Review — 2026-11-16 (historical; superseded by this revision)
- **Reviewer**: Agent (fresh context, spec path only), then author revision
- **Security**: Failed on first pass (fail-open refusal); corrected in the revision
- **Performance**: Inspection memoized per process
- **Cache**: N/A
- **Commands**: N/A — no domain mutation
- **Risks**: Fail-open, incomplete migration and non-production bypass added
- **Verdict**: Two review rounds, both followed by revision. The second revision has not been independently re-read
- Fix verification follow-up: the refusal exits, the rotation note and the upgrade note now name the module fill commands next to `rehash-lookups`. `rehash-lookups` covers only mapped hash fields, so module-written hashes such as the CRM, SSO and inbound-sender ones would otherwise stay stale after a key rotation.
