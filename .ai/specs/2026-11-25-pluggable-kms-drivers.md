# Pluggable KMS drivers

Issue: [#9344](https://github.com/open-mercato/open-mercato/issues/9344) · OSS prerequisite

## TLDR

An OSS or Enterprise app registers npm packages that supply the existing tenant-data `KmsService` in `src/providers/kms.ts`. Early provider bootstrap selects the driver consistently across processes. HashiCorp Vault ships as a separate npm package and remains the default for deployments already configured with `VAULT_*`. The [Enterprise cloud drivers](enterprise/2026-11-25-cloud-kms-drivers.md) use the same contract.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Why |
|---|---|---|---|
| OSS1 | Can the npm driver contract ship independently? | Publish the OSS contract first and prove it with an out-of-repo fixture. | An unknown third-party package can use the seam with Enterprise disabled. |
| OSS2 | How are packages registered? | Explicit app-owned registrations with literal lazy npm imports under `src/providers/`. | Cache, queue and KMS share a location and early bootstrap lifecycle. |
| OSS3 | How do existing Vault deployments adopt the registration? | Include the Vault npm package and its default registration in the monorepo app and standalone scaffold. | Existing deployment variables, DEK locations and ciphertext formats continue to work without a key migration. |

## Overview

Deployment maintainers own package installation and selection. Business modules keep requesting the existing KMS service and using existing encryption helpers. Drivers can use different storage or key-management systems and must implement stable DEK lifecycle behavior. This spec covers the extension point, provider initialization, the first-party Vault package and safety rules for explicit selection. Official cloud adapters, envelope persistence and cross-provider maintenance are covered by the Enterprise spec.

## Problem Statement

[`createKmsService()`](../../packages/shared/src/lib/encryption/kms.ts) selects Vault, a derived key, or no-op based on environment and encryption mode. [Core bootstrap](../../packages/core/src/bootstrap.ts) has both legacy and process-root paths. Other callers construct the service directly, including [API-key storage](../../packages/core/src/modules/api_keys/services/apiKeyService.ts), [OAuth grants](../../packages/core/src/modules/integrations/lib/oauth/grant-service.ts), [search-token guards](../../packages/core/src/modules/query_index/lib/search-tokens.ts) and the [starter inspection child process](../../packages/starter/src/encryption-preflight.mjs). Overriding DI alone would leave these paths on different keys.

## Proposed Solution

Use the shared application-provider convention from the [cache host](https://github.com/open-mercato/open-mercato/pull/10513) and [queue driver proposal](https://github.com/open-mercato/open-mercato/pull/10510). Keep app-owned, typed registrations in `src/providers/` and provider implementations in independent npm packages. Use the same early server bootstrap for explicit registration and resolve the appropriate provider before starting any process that needs it. Verify the production artifact with [Next.js output file tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

## Delta

### Capability: pluggable-kms-drivers

#### ADDED Requirement: Explicit npm driver selection

The app SHALL activate an installed compatible driver by registered ID across web, worker, scheduler, setup and application CLI processes.

##### Scenario: A new package works without Core changes
- WHEN an app adds and registers a compatible OSS driver under a previously unknown npm name and selects its ID
- THEN the production web build and separately started CLI and worker use the same deployment's keys with Enterprise disabled

##### Scenario: Package selection is invalid
- WHEN selection is unknown, missing, mismatched, ineligible or unavailable before startup
- THEN the affected process returns a sanitized failure and keeps protected workloads out of service

#### ADDED Requirement: Selected drivers refuse unsafe operations

An explicitly selected npm driver SHALL refuse protected writes when the configured key cannot be obtained.

##### Scenario: Key unavailable
- WHEN an encrypted write needs a key and the selected driver times out, denies access or cannot return the authoritative DEK
- THEN the write fails before commit and retries cannot produce plaintext or alternate-key ciphertext

##### Scenario: Selection omitted
- WHEN the deployment uses the legacy selection path
- THEN existing Vault, derived-key and disabled selection remains governed by the existing policy and the separately tracked [outage policy](https://github.com/open-mercato/open-mercato/pull/10648)

#### ADDED Requirement: Vault is a packaged default driver

The monorepo app and generated standalone app SHALL ship the same Vault npm package and registration. Existing Vault configuration SHALL continue to select that driver when a deployment omits `OM_KMS_DRIVER`.

##### Scenario: Existing Vault deployment upgrades
- WHEN a deployment built from either template boots with its existing Vault environment and omits `OM_KMS_DRIVER`
- THEN the default registration resolves the Vault npm package and reads the same authoritative key at the same Vault KV v2 path

##### Scenario: Vault is selected explicitly
- WHEN `OM_KMS_DRIVER=open-mercato/vault` is set and Vault cannot provide the configured key
- THEN protected work fails under the explicit-driver safety policy

## Architecture

### Registration and selection

1. The app declares direct production dependencies and pins resolved versions in its lockfile. `<app root>/src/providers/kms.ts` exports `kmsDrivers` using `defineKmsDriverRegistration`. Each registration has a stable namespaced ID, edition, a literal lazy import and a settings function. Registration is declarative and side-effect-free. Generate the shared server provider manifest from the app-owned files. The Next standalone server and app-root Node loader use the same registrations. A missing optional registry has a deterministic empty entry. Generation and build require installed packages and run without evaluating registries, reading settings or connecting to Vault or a cloud service.
2. `OM_KMS_DRIVER` selects an exact registered ID. When unset, the existing encryption toggle and legacy settings select a default. An explicitly blank or malformed setting, a selection with tenant encryption disabled, a missing/stale registry, incompatible version, duplicate or reserved ID, absent package, load failure, or edition mismatch fails with a safe configuration error. Resolve named modules from app code. Runtime input cannot supply a URL, filesystem path, npm specifier, version or shell command. The deployment owns selector and settings. Tenant and organization administrators have no control over loading or credentials.
3. Reject a commercial registration before its loader runs if Enterprise activation is absent. The OSS host accepts the existing Enterprise activation decision and contains no cloud SDK imports. Reserve the `open-mercato/` registration namespace for first-party definitions and protect built-in names. Reconcile manifest and descriptor IDs and editions before construction. Installed drivers are trusted Node.js dependencies with process privileges. Code review, pinning and provenance matter even when an inactive loader is never evaluated.
4. Run the shared early provider bootstrap before service or request-container construction. The web server, workers, scheduler, application CLI and setup run this phase. The starter preflight child process and key-consuming maintenance commands call the same phase directly. Await one resolved-driver startup promise and publish the result only after validation and readiness. Keep `createKmsService(): KmsService` synchronous and the `kmsService` DI key stable. Direct consumers and both bootstrap paths resolve the same initialized handle. A call with an explicit selector before initialization fails with a configuration error. Keep caller-supplied service objects working for existing tests and maintenance, and make those lifecycle choices explicit in maintenance. Selection and configuration change on coordinated restart. Commands without a key-consuming dependency can run without KMS initialization.
5. Load, validate and construct only the selected package during serving startup. Use a bounded startup check, request deadlines, finite retries for transient failures, single-flight recovery probes with backoff, and idempotent close on shutdown and failed initialization. Retain the existing `isHealthy(): boolean` contract as a synchronous snapshot. Add a bounded async probe to npm driver definitions, with stable sanitized reason classes and no allocation of real tenant DEKs. Fold selected-provider readiness into the existing `/api/healthz` 200/503 contract, with its current response shape. A health probe exercises the selected crypto dependency and, where applicable, its independent key store. Recovery tools verify decryptability for the scopes they operate on.

### Proposed server contract

The additive entry point is `@open-mercato/shared/lib/encryption/kms-driver`. Package authors use `@open-mercato/shared` as a peer dependency. Package IDs are independent of npm names. Loaders must use ordinary Node/server exports.

| Surface | v1 requirements |
|---|---|
| `defineKmsDriver` | Descriptor with `contractVersion: 1`, stable ID, edition, strict driver-owned Zod settings schema and a factory. The factory returns `{ service: KmsService, probe, close }`. Factory and probe may be asynchronous, obey the host deadline and disposal. The factory receives validated settings and narrow host services such as redacted diagnostics and cancellation. It receives no request-scoped container or broad environment object. |
| `defineKmsDriverRegistration` | App registration supplies the expected ID and edition, a literal module loader for the descriptor and a settings callback. Validate settings once per selected profile. Errors expose safe field paths and codes. |
| `KmsService` | Preserve the current methods and return shapes. For npm drivers, `getTenantDek` returns null only for a proven absent slot. `createTenantDek` is create-if-absent and returns the durable winner across processes. A dependency error, unauthorized access, inability to create or invalid key throws a normalized failure. Keep `invalidateDek` supported. |
| Scope | Use the authorized logical key ID, including existing `system:<entityId>` IDs from `resolveEncryptionKeyId`. The key response must match the requested ID and decode to an existing-compatible 32-byte DEK. A driver must isolate its deployment and scopes. Module callers retain the existing tenant/organization authorization checks. |

This example registers a fictional external package.

```ts
import { defineKmsDriverRegistration } from '@open-mercato/shared/lib/encryption/kms-driver'

export const kmsDrivers = [
  defineKmsDriverRegistration({
    id: 'example/key-store',
    edition: 'oss',
    load: () => import('@example/mercato-kms-driver').then((module) => module.kmsDriver),
    settings: () => ({ namespace: process.env.EXAMPLE_KEY_STORE_NAMESPACE }),
  }),
]
```

Set `OM_KMS_DRIVER=example/key-store` at runtime. Packages can be scoped or unscoped and can come from the app's approved public or private npm registry. The host does not assume any future provider ID or vendor capabilities.

### Default Vault package

- Ship `@open-mercato/kms-driver-vault` as a first-party OSS package with the ID `open-mercato/vault`. Both `apps/mercato/src/providers/kms.ts` and the standalone template's `src/providers/kms.ts` ship a registration with a literal lazy import. The package owns the Vault KV v2 client, CAS provisioning, deadlines and recovery. The host owns selection, encryption policy and the public `KmsService` facade. Keep package dependencies acyclic so Vault can be packed and built independently.
- Preserve `TENANT_DATA_ENCRYPTION`, `TENANT_DATA_ENCRYPTION_DEBUG`, `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_KV_PATH`, `VAULT_REQUEST_TIMEOUT_MS`, `VAULT_RECOVERY_COOLDOWN_MS`, and the existing derived-key configuration. A legacy configuration that resolves to Vault uses the same factory through the default registration, with legacy behavior governed by the established outage policy. Explicit `OM_KMS_DRIVER=open-mercato/vault` uses the strict selected-driver policy. A missing default registration or unavailable package for a configured Vault deployment is a configuration error.
- Keep the existing Vault key addresses, mount, DEK encoding, compare-and-set winner and cache invalidation behavior. Keep the published `HashicorpVaultKmsService` constructor available at its existing import path as a compatibility facade to the extracted client. The facade loads the client only when called. The packaging change requires no data rewrite, key rotation or Vault permission change. Preserve standalone upgrades by carrying forward the pinned Vault default package and registration and testing existing deployment environments after regeneration.
- Distinguish a proven absent key from a transport failure, forbidden read or invalid response. The explicit driver returns `null` only for proven absence and permits creation only under its provisioning policy. Preserve the implicit profile's existing behavior through the host policy.

The shipped `src/providers/kms.ts` includes the following registration. The package validates settings after selection. Its duration fields accept numeric environment strings and apply the legacy `secret/data` mount, 1,000 ms request timeout and 30,000 ms recovery cooldown defaults when settings are omitted. On implicit legacy selection, preserve the existing credential normalization and timeout parsing. The host keeps `TENANT_DATA_ENCRYPTION_DEBUG` as its diagnostics toggle.

```ts
import { defineKmsDriverRegistration } from '@open-mercato/shared/lib/encryption/kms-driver'

export const kmsDrivers = [
  defineKmsDriverRegistration({
    id: 'open-mercato/vault',
    edition: 'oss',
    load: () => import('@open-mercato/kms-driver-vault').then((module) => module.kmsDriver),
    settings: () => ({
      vaultAddr: process.env.VAULT_ADDR,
      vaultToken: process.env.VAULT_TOKEN,
      mountPath: process.env.VAULT_KV_PATH,
      requestTimeoutMs: process.env.VAULT_REQUEST_TIMEOUT_MS,
      recoveryCooldownMs: process.env.VAULT_RECOVERY_COOLDOWN_MS,
    }),
  }),
]
```

### Write safety and diagnostics

The host owns strict handling for explicitly selected npm drivers. Implement on the shared [KMS unavailability enforcement](https://github.com/open-mercato/open-mercato/pull/10648) or a reviewed equivalent that covers the same entry points. Verify the prerequisite before enabling npm drivers. The selected driver supplies the only keys for serving, even when legacy Vault or derived-key environment settings are present. Audit guards that interpret `isHealthy() === false` as disabled, including subscriber, raw/custom-field and index writers. Sanitize failures at existing error boundaries, reuse `KMS_UNAVAILABLE` for dependency failure, and preserve authorization-before-key-resolution. A verified missing slot can be created only under the selected driver's provisioning policy. A dry run cannot create a slot. Failure while reading never counts as proven absence. Any successful protected read must authenticate existing ciphertext with the correct key. External DEK storage and key custody remain the driver's responsibility.

## Data Model

The OSS extension installs no database entities or custody schema. App registration and deployment configuration select the configured driver. Define a provider-neutral, optional database binding check for a deployment that has adopted a persistent driver. The adopting feature provisions the binding through its own migration. At database-backed startup, check for the optional binding in the known application schema before selecting a legacy or npm service. A verified absent table or inactive binding follows stock selection. An unreadable or unknown binding fails before writes. An active binding requires matching runtime selection and activation. This check permits the host to detect accidental removal of driver configuration without knowing any commercial driver. Drivers document how their storage, deployment namespace and native key identity are pinned. Treat a provider change on an existing database as an explicit migration and require provider-specific preflight and recovery evidence before activating a writer against it.

## API Contracts

Preserve existing HTTP routes, readiness JSON shape, `KmsService` method signatures, DI keys, CLI commands and existing encryption formats. External selection may make the existing health endpoint report degraded when the selected provider is unhealthy. Return the existing sanitized unavailable surface for protected work. Add no tenant-facing driver routes.

## Migration & Backward Compatibility

Stock apps use the delivered Vault registration and keep their deployment settings. Existing standalone apps upgrading from before provider registries were tracked receive the default package and registration through the supported upgrade path. A deployment can add an optional package and manifest without selecting it. A compatible driver upgrade has to read keys produced by its supported previous versions. Unknown contract or key format fails closed. Rollback of the packaging-only Vault change restores the old binary with the same mounts and scopes. Rollback across a custody change requires proving the prior image can read the authoritative key store or completing the driver's documented reverse migration with writers stopped. Removing the selector is safe only when the next effective driver can read every authoritative key and decrypt every scope.

## Operator documentation

Update the [encryption guide](../../apps/docs/docs/user-guide/encryption.mdx) and the application provider guide with the implementation. Include the following instructions once the packages are available.

- Existing Vault installations keep their `TENANT_DATA_ENCRYPTION` and `VAULT_*` settings. Use the default entry in `src/providers/kms.ts`. Verify that an upgraded deployment can read previously encrypted records before accepting writes. No key rotation is required for the packaging update.
- To install a different driver, add a direct dependency from an approved npm registry and add its documented registration to `src/providers/kms.ts`. Run `yarn generate`, build the app, and configure the same exact `OM_KMS_DRIVER` on the web server, workers, scheduler and key-consuming CLI. Supply provider settings at runtime. For explicit Vault selection use `OM_KMS_DRIVER=open-mercato/vault`.
- Changing key custody is a separate operation. Preserve a recoverable snapshot and the old keys, pause writers and follow the provider's documented adoption or rewrap procedure. Verify authenticated reads and the rollback path before restarting writers.

## Risks & Impact Review

| Risk | Mitigation | Residual impact |
|---|---|---|
| High · untrusted package has process access | Explicit direct dependencies, literal registration, managed lockfile and server-only packaging. Reject invalid selectors before loading. | An approved package still operates at host trust level. |
| High · bootstrap paths resolve different drivers | Share initialized resolver and process generation across DI, direct calls, starter, CLI and workers. Refuse an uninitialized explicit selector. | Upgrades require coordinated restart and mixed-binary validation. |
| High · outage bypasses encryption | Gate activation on fail-closed coverage across mapped writes and raw paths. Refuse to provision after a read failure. | Affected paths become unavailable during outages. |
| Medium · cloud latency and transport pressure | Probe/operation deadlines, bounded retries and concurrency, single process client, aggregate diagnostics. | Cold starts and cache misses depend on the selected dependency. |

## Verification

- Pack and install a fixture from outside the Mercato workspace, then generate and build a clean standalone consumer. With Enterprise disabled, prove the built web app, a separate worker and CLI encrypt/decrypt the same committed data across restarts. Include the starter child process and system scopes. Repeat with Enterprise enabled.
- Test untouched stock Vault, derived, disabled and unconfigured deployments. Verify bound database startup when the selector is absent, wrong, disabled or incompatible, and intentionally untouched databases without a binding. Exercise dynamic-import isolation, duplicate/invalid descriptors, version/edition mismatch, and one initialization/close per process. Assert the provider build needs no runtime credentials or provider network access.
- Pack the Vault package and install it with the shipped registration in a standalone fixture. Against disposable Vault KV v2, seed fixtures using the previous runtime and prove the upgraded web, worker and starter/CLI read the same keys and old ciphertext. Cover explicit and legacy selection, disabled or derived-only deployments without a Vault import, simultaneous creates converging on the stored winner, transient recovery with the documented settings, and strict refusal on explicit selection failure. Verify the old import path resolves in the packed consumer and rolling back the package-only change can still read its keys.
- Use isolated PostgreSQL and self-created fixtures via normal entry points. After warming and again with a cold cache, inject failure and check persisted values and response status on CRM mapped writes, user/session-key and OAuth credentials, custom-field/custom-entity writes and search/index propagation. Verify another tenant cannot substitute a key, and a failed write leaves neither plaintext nor partial state.
- Cover `/api/healthz` healthy, transient recovery, persistent configuration failure and legacy response compatibility. Exercise CLI dry run, setup refusal before writes and concurrent provisioning using two processes. Keep fixture creation and teardown self-contained.

## Phasing

1. Ship the OSS contract, deterministic registry and lifecycle needed by a packed OSS fixture after the shared cache provider bootstrap lands.
2. Connect normal operational entry points and enforce explicit-provider safety before declaring the extension supported.
3. Ship the Vault extraction as a dedicated OSS follow-up. Publish the default package and activate its registration in both app layouts after the host lands. Prove compatibility with a previously deployed Vault configuration before release. Enterprise providers can build on the OSS host without changing this stock installation path.

## Final Compliance Report — 2026-11-25

Server-only additive registration keeps business call sites on the existing shared encryption helpers and DI. No edition-specific dependency belongs in OSS. Strict operation failure stays scoped to explicitly selected drivers. Implementation still requires packaging, real entry-point and outage tests.

## Changelog

- 2026-11-25 · Proposed the independent OSS extension for #9344.
- 2026-11-26 · Aligned setup with `src/providers/` and specified the packaged Vault default and standalone compatibility tests.

## Implementation Plan

1. Publish descriptor and registration types. Add the KMS entry to the shared provider generator and prove a minimal app still builds with no registered driver.
2. Bind the validated process resolver through both core bootstrap paths, direct consumers, standalone server, worker, scheduler, init and starter. Test startup/close and readiness with an out-of-repo package before moving to real encrypted writes.
3. Integrate strict write safety and run the failure/tenant-isolation matrix with the packed OSS driver. Document driver authorship, installation and verification for every process type.
4. Extract and pack the Vault driver, keep the existing constructor facade, and ship the default `src/providers/kms.ts` registration and dependency in both app layouts. Verify an environment-only upgrade, both routes to Vault and a package-only rollback against existing fixture keys. Publish the operator guidance in the encryption and application provider guides.
5. Archive the verified requirements into `.ai/specs/capabilities/pluggable-kms-drivers.md` in the implementation PRs.
