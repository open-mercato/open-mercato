# Enterprise cloud KMS drivers

Issue: [#9344](https://github.com/open-mercato/open-mercato/issues/9344) · Enterprise Edition

Requires: .ai/specs/2026-11-25-pluggable-kms-drivers.md

Extends: .ai/specs/2026-09-30-encryption-key-rotation-hardening.md
Extends: .ai/specs/enterprise/2026-11-06-cli-backup-restore.md
Extends: .ai/specs/enterprise/2026-11-12-key-rotation-data-verification.md

## TLDR

Enterprise operators can protect Open Mercato data encryption keys with AWS KMS, Google Cloud KMS or Azure Key Vault and authenticate using workload or managed identity. Each driver is an independently installable commercial npm package. The app stores wrapped DEKs in PostgreSQL and keeps using the existing field encryption helpers. Existing deployments switch through a verified maintenance operation.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Why |
|---|---|---|---|
| ENT1 | How is the active provider selected? | One active write profile per deployment. Source and target profiles are explicit during offline maintenance. | A shared selection keeps web, workers and recovery on one authoritative key set. |
| ENT2 | Where do wrapped keys live? | Keep versioned envelopes in an Enterprise-owned PostgreSQL key store. | A committed snapshot can recover application ciphertext and its matching envelopes together. |
| ENT3 | What interface does the first release need? | Deployment configuration and operator CLI. | Provisioning and recovery already run under host-operator authority. |
| ENT4 | What happens on a provider failure? | Refuse key-dependent operations that cannot safely get the authoritative DEK. Provider changes require an explicit verified cutover. | Automatic fallback can create data encrypted under the wrong key. |

## Overview

The operators in #9344 run private or managed deployments where the cloud already supplies key custody and application identity. This proposal covers the three first-party driver packages, their shared key-envelope lifecycle and operational integration with protected rotation and backup/restore. Use [the OSS extension](../2026-11-25-pluggable-kms-drivers.md) and its application provider convention for npm registration and runtime selection. Independently built commercial or partner packages can use the same registration contract. Other cryptographic systems, including the separate [Forms key adapter](../../../packages/core/src/modules/forms/services/encryption-service.ts), keep their own custody and recovery requirements.

## Problem Statement

The [shared KMS service](../../../packages/shared/src/lib/encryption/kms.ts) retrieves Vault KV secrets or derives a DEK from a configured root. Cloud KMS APIs protect cryptographic inputs under a KEK and do not manage Mercato's tenant key inventory. A driver needs durable scope-to-envelope storage, compatible ciphertext lookup, safe provisioning and recovery. A configuration-only provider swap can make previously encrypted rows unreadable.

## Prior spec drift

The CLI backup/restore and protected rotation specifications describe planned Enterprise paths. The implementations in [PR #9333](https://github.com/open-mercato/open-mercato/pull/9333) and [PR #9334](https://github.com/open-mercato/open-mercato/pull/9334) are integration dependencies. On the pinned baseline `ffc8ada7f5e8aedd623e5e06f3acc3753e3f9dc0`, [Core rotation](../../../packages/core/src/modules/entities/cli.ts) uses the current service and legacy key inputs. The open protected rotation implementation pins derived/Vault source and target providers. Extend the protected resolver and backup custody verification after those contracts land. Confirm their final names, configuration and hooks before implementation.

## Proposed Solution

The Enterprise lifecycle owns one random 256-bit DEK per logical encryption scope. It delegates wrapping and unwrapping to the selected driver and supplies the resulting DEK through `KmsService`. The driver sees key material transiently in process and at the KMS operation boundary. Application field payloads keep the current local encryption format. Vault's [cloud auto-unseal architecture](https://developer.hashicorp.com/vault/docs/configuration/seal/seal-best-practices) supports the principle of cloud custody for wrapping keys while the application owns its data lifecycle. Operators can keep Vault with cloud-backed auto-unseal today when they want Vault in the path.

## Delta

### Capability: enterprise-cloud-kms

#### ADDED Requirement: Enterprise cloud driver activation

An Enterprise deployment SHALL be able to use any of the three qualified first-party packages through the same npm driver registration.

##### Scenario: First-party package activation
- WHEN an authorized Enterprise operator installs one package, supplies a valid KEK reference and enables its native workload identity
- THEN setup and normal web and worker operations can provision and read scoped DEKs without a static cloud credential

##### Scenario: Missing authorization
- WHEN the Enterprise activation or KMS key permissions are missing
- THEN selected startup refuses or readiness degrades and affected work cannot commit with a substitute key

#### ADDED Requirement: Durable scoped envelope

The Enterprise lifecycle SHALL use the committed envelope for the requested scope and generation.

##### Scenario: Concurrent first use
- WHEN two processes attempt to create the first DEK for the same provisionable scope
- THEN their successful writes use the same committed DEK and each unrelated scope remains isolated

##### Scenario: Historical key or bound context is wrong
- WHEN an envelope refers to a disabled, destroyed, unregistered or mismatched key, or its bound scope differs from the request
- THEN the operation reports failure without replacing the record or choosing a fallback

#### ADDED Requirement: Verified maintenance and recovery

The Enterprise lifecycle SHALL preserve every in-scope key dependency during offline provider migration, rotation and isolated recovery.

##### Scenario: Rewrap before activation
- WHEN the operator rewraps an existing deployment under a new KEK or provider and verifies complete scope coverage
- THEN the active binding switches once and existing application ciphertext remains readable without rewriting the data

##### Scenario: Recover from an encrypted snapshot
- WHEN recovery imports a snapshot protected by a retained source KEK
- THEN the operator can prove recovery with the original envelope context or rewrap under an authorized destination profile before releasing quarantine

##### Scenario: Verify a distinct target with a warmed source in the same process
- WHEN ordinary serving has cached the source DEK or has a source lookup in flight for a logical scope that rotation verifies against a distinct target generation
- THEN verification reads the target DEK through its pinned profile and generation without reading, joining or populating either ordinary shared map
- AND the target must authenticate target ciphertext before activation, even if the source key is still available

## Architecture

### Edition and package boundaries

- Put shared envelope storage, migration integration and operator guidance in the Enterprise `encryption_keys` module and maintenance composition. The OSS resolver depends only on generic driver and binding contracts.
- The three proposed npm packages are separately versioned, pinned, commercial workspaces and published through the approved Enterprise package path. An official package depends on the compatible shared npm contract and the common Enterprise envelope runtime. It owns its SDK, strict settings schema, limits, tests and deployment guide. OSS and the stock Enterprise install require none of the three packages or their SDKs. Follow the current commercial activation policy and `OM_ENABLE_ENTERPRISE_MODULES` gate at startup and in maintenance. Apply the guard before import and at commercial factory composition, including direct imports and preview. Preserve the repository's current licensing terms.
- Register installed packages through `kmsDrivers` in the application's `src/providers/kms.ts` and select an exact ID with `OM_KMS_DRIVER`. The shared early provider bootstrap resolves the same registry for the web app, workers, scheduler, setup and key-consuming CLI. The stock HashiCorp Vault registration uses the separate OSS default package. The Azure Key Vault driver has its own commercial package, ID, and custody model.
- A deployer maps the registered driver to one active instance profile. Each profile pins the driver ID, revision of non-secret key-routing settings, deployment namespace and allowed canonical KEK references. It also selects a cloud identity mechanism. Named maintenance profiles can use the same package with different settings. Store or compare canonical reference identity in protected metadata. Never derive routing from an address supplied by an envelope or request.
- The Enterprise composition turns a server-only envelope adapter into `KmsService`. External Enterprise driver packages can implement a versioned, narrow `wrap`, `unwrap`, `probe`, and `close` contract and reuse the same composition, or supply their own complete service via the public OSS contract. `wrap` takes a validated profile, DEK bytes, a trusted scope context and a deadline, and returns opaque bytes plus canonical key identity and wrapper format. `unwrap` takes a validated profile, the recorded wrapper and the expected scope context. It returns 32 authenticated DEK bytes or a normalized failure. Only drivers with a qualified envelope/maintenance adapter may participate in Enterprise rewrap, protected rotation and recovery. The resolver and coordinator dispatch by capability and registry entry. A future provider adds its package and its tests, with no Core vendor enum or switch.

### Provider qualification

| Package and stable ID | KEK and operation contract | Workload identity and permissions |
|---|---|---|
| `@open-mercato/kms-driver-aws` · `open-mercato/aws-kms` | AWS customer-managed symmetric encryption key. Accept a canonical key ARN and matching region/partition. Encrypt and Decrypt with the exact key ARN and equivalent non-secret context. Persist the returned ARN and opaque blob. Native backing-key rotation under the same ARN retains its provider-managed key material history. Alias retargeting requires an explicit profile/key change. [AWS Encrypt](https://docs.aws.amazon.com/kms/latest/APIReference/API_Encrypt.html), [AWS Decrypt](https://docs.aws.amazon.com/kms/latest/APIReference/API_Decrypt.html) | Use AWS SDK v3 workload credentials for the platform role or web identity and verify refresh. Grant `kms:Encrypt`/`kms:Decrypt` to the selected key. A read-only recovery identity receives source decrypt only. Scope permissions through key policy and IAM. [AWS SDK credentials](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html) |
| `@open-mercato/kms-driver-gcp` · `open-mercato/gcp-kms` | Symmetric `ENCRYPT_DECRYPT` CryptoKey resource with project, location and key ring. Encrypt using the primary or a configured explicit version. Record the returned CryptoKeyVersion and decrypt through its exact parent CryptoKey using the same AAD. The opaque blob selects the historical version. Verify the documented CRC32C request and response checks. [Google Encrypt](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys/encrypt), [Google Decrypt](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys/decrypt), [Google key states](https://docs.cloud.google.com/kms/docs/key-states), [Google integrity checks](https://docs.cloud.google.com/kms/docs/data-integrity-guidelines) | Use ADC backed by an attached service identity or Workload Identity Federation. Grant `cloudkms.cryptoKeyVersions.useToEncrypt`/`useToDecrypt` on the selected CryptoKey. Read-only recovery receives source decrypt only. [Google ADC](https://docs.cloud.google.com/docs/authentication/application-default-credentials) |
| `@open-mercato/kms-driver-azure` · `open-mercato/azure-key-vault` | Azure Key Vault RSA key, at least 2048 bits. Require a configured, versioned Key Vault key URI and allowlisted vault origin. Use RSA-OAEP-256 wrap/unwrap with the exact historical version. Verify that the selected SDK executes the intended remote wrap and that response key IDs resolve to the configured vault/key. Version rollover is explicit. [Azure Wrap Key](https://learn.microsoft.com/en-us/rest/api/keyvault/keys/wrap-key/wrap-key), [Azure Key Vault SDK](https://learn.microsoft.com/en-us/javascript/api/overview/azure/keyvault-keys-readme?view=azure-node-latest) | Use Managed Identity or Microsoft Entra Workload Identity in production. Grant wrap/unwrap on the selected key and key metadata read only if required for validation. Read-only recovery receives source unwrap only. [Azure Workload Identity](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/workloadidentitycredential) |

Provision KEKs and identity grants outside Mercato. Document registration, resource syntax, trust roots, network prerequisites, supported cloud environments and IAM templates for web, workers and maintenance. Its deployment guide must show an explicit lazy package import in `src/providers/kms.ts`, a matching `OM_KMS_DRIVER` value, and the process restart and verification steps from the [OSS operator documentation](../2026-11-25-pluggable-kms-drivers.md#operator-documentation). Use official SDKs and credential refresh, with bounded request and retry budgets. The supported production profiles use attached or federated identity. An SDK's developer credential sources do not count as live qualification. Preserve finite allowlists for all historical references and limit maintenance credentials to the declared source and target. Provider APIs receive opaque or non-secret scope values only. AWS encryption context can appear in audit logs. [AWS encryption context](https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html)

## Data Model

| Record | Invariants |
|---|---|
| Deployment binding | Singleton per application database. Stores deployment namespace, active driver/profile identity and monotonic epoch. Protected modes hold a maintenance checkpoint and keep ordinary serving fenced until activation. Update via CAS. The runtime checks the binding even if the selector is unset or changed. An opted-in database requires the matching selection and Enterprise activation. |
| Scope registry | Authoritative slot keyed by namespace, scope kind and logical key ID. Use tenant UUID or the existing canonical `system:<entityId>` key ID. A scope has one active DEK revision or an explicitly verified never-issued state. Bootstrap and migration register the complete applicable scope inventory. New scope registration is part of an authorized setup/provisioning path. No public repository or cross-module ORM relation. |
| DEK envelope | Bounded, versioned binary wrapper record with scope, generation, KEK/profile identity, wrap format, wrapped DEK blob and activation timestamps. A DEK generation identifies the application key. A separate wrapper revision changes on rewrap. Retain historical revisions under recovery policy. Use DB uniqueness and CAS for exactly one winner per scope/generation and one active revision. |
| Maintenance checkpoint | Reuse the protected coordinator/journal where available. Pin source and target identities, epoch, scope inventory and recovery artifact reference. Persist status and safe counts. Encrypt privileged recovery detail using the existing backup mechanism. |

Use an additive Enterprise migration with snapshots. Keep the deployment binding's presence/identity check provider-neutral so Core startup can refuse serving a bound database before creating a legacy provider. The table is optional for stock deployments. Probe from setup and normal serving paths before encryption or seeding. Restore includes the table in its control metadata validation. Old Mercato releases lack the check, so the deployment runbook prevents those binaries and credentials from starting against the database during or after adoption.

Scope binding is enforced inside the envelope as well as in storage. Define a versioned canonical encoding over deployment namespace, scope kind, logical key ID, generation, driver ID and KEK/profile identity. AWS uses a digest of this context as its non-secret encryption context. GCP uses canonical authenticated data compatible with its size limits. Azure RSA-OAEP wrapping lacks an AAD contract for this use. Wrap a fixed-length frame containing a format marker, the 32-byte DEK and the context digest. Verify the frame and digest on unwrap. This detects valid-envelope swaps between scopes. RSA public-key wrapping does not authenticate who produced a new envelope. The service trusts authorized key-store writes and authenticated recovery artifacts, including on Azure. Test both context binding and database writer isolation. Reuse platform cryptography and provider-supported primitives.

### Provisioning and failure semantics

- A missing row for an existing or unclassified scope fails. Only an authoritative never-issued scope may create a DEK. Use the existing random DEK helper. Wrap outside a SQL transaction, then atomically publish against the claimed slot and current epoch. On a race, unwrap the persisted winner. On uncertain commit, re-read before returning. Never expose an unpublished candidate to a field writer.
- Use a narrow, independently pooled key-store connection budget included in the deployment-wide PostgreSQL limit so callers in an ORM flush cannot deadlock waiting for a second connection from their own pool. Keep key writes independent of application row locks and avoid FK checks against uncommitted tenant creation. Test pool saturation, failed app transactions and retries. Reconcile a retained provisioning record by scope through the normal lifecycle and custody rules.
- Keep plaintext DEKs only in memory, with bounded lifetime and count. Reuse the existing service-level cache with explicit invalidation and a single authoritative cache policy. Never use Redis or persisted cache for DEK bytes. A still-valid DEK from the same binding can serve normal work while readiness is healthy. Once a process observes failure or epoch mismatch, revoke cached eligibility for new affected operations. Document the bounded detection window across replicas and restart all processes on a maintenance cutover. On a cold outage use the strict shared unavailable behavior. Never provision a new DEK after denial, timeout or corruption.
- Readiness tests a bounded wrap/unwrap of disposable bytes and a read-only store check for the selected active profile. It creates no tenant record, provider key, or provider version. Reuse the request-independent probe and backoff so health traffic does not amplify an outage. Protected maintenance verifies source access by unwrapping retained envelopes and needs no source wrap permission. It verifies all required scopes separately. Logs and metrics expose safe reason classes, operation, duration, readiness state and aggregate counts. Keep plaintext, wrapped blobs, tokens, customer identifiers and unrestricted SDK error bodies out of telemetry.

### Maintenance DEK isolation

The shared field encryption service caches DEKs and deduplicates in-flight provisioning by logical scope across service instances. A second service instance with a different driver profile still shares those maps.

All maintenance reads, including preview, staged-wrapper verification, rotation and isolated restore, bypass both shared maps. The maintenance resolver obtains each DEK directly through the pinned source or target profile and its versioned key handle. The handle pins deployment namespace, logical scope, profile identity and settings revision, binding epoch, DEK generation and wrapper revision. Resolve the exact recorded wrapper for an envelope-backed handle. Recheck the pinned binding and checkpoint before using a result or activating a target. A missing or mismatched result blocks verification. Maintenance reads neither populate the ordinary cache nor provision a missing key. Staging writes use the coordinator's explicit, guarded provisioning path.

### Migration, KEK rollover and DEK rotation

Cloud KEK rollover changes what wraps an existing DEK. A DEK rotation changes the key that protects application data.

| Operation | Required behavior |
|---|---|
| New installation | Apply the Enterprise schema through normal deployment and explicitly initialize the binding before running setup writes. Register tenant and system scopes through authorized provisioning. Setup refuses an uninitialized or mismatched binding. |
| Adopt from Vault or derived keys | Quiesce serving writers. Verify a recoverable backup and record original custody. Enumerate all tenant and system application key scopes and prove each key against supported persisted encryption surfaces where ciphertext exists. Materialize that same DEK under the target KEK. Refuse missing, mixed-key or unsupported histories until resolved through existing protected recovery. Mark unencrypted or unused scopes never-issued only after verifying absence. Stage and verify all wrappers. Activate the target epoch atomically, restart every writer, sample authenticated reads and exercise rollback before retiring source custody. |
| Change KEK, cloud driver or deployment namespace | Use the same stage/verify/activate protocol. Load explicit source and target profiles, unwrap with the recorded source context and rewrap the same DEK for the target context. Pin canonical references and verify read-back of every staged wrapper. Interrupted runs can resume under the same bindings or discard unactivated revisions while the source stays authoritative. Validate a version change even where vendor-managed rollover keeps the same canonical key resource. |
| Rotate application DEK | Extend protected rotation [#9334](https://github.com/open-mercato/open-mercato/pull/9334) with registry-backed source/target services and durable, version-pinned key handles. Keep distinct generations for source and target. Reuse the existing offline writer fence, compare-and-swap, encrypted backup and persisted-data verification. Resume rejects changed bindings or backup identity. Activate the target generation only on complete verification. A partially rewritten dataset stays quarantined. |
| Reverse or roll back | Before activation, discard staging and resume source serving only if no application ciphertext or lookup hash has been rewritten. Once a DEK rotation has committed any rewrite, keep writers fenced and retain both generations, even before activation. Resume under the pinned checkpoint or follow the protected rotation rollback procedure: restore the pre-rotation backup to a quarantined target, verify source custody and restored data, and perform a separately approved cutover. After activation, check all current scopes, including any created since cutover, before reversing a same-DEK migration through rewrap or starting a separately verified reverse rotation. Never remove historical KEK access until ordinary read verification, recovery rehearsals and backup retention allow retirement. |

Keep current derived/Vault profiles and existing protected CLI inputs accepted. Extend the `OM_ROTATION_SOURCE_PROVIDER` and `OM_ROTATION_TARGET_PROVIDER` resolution slot from #9334 with exact registered profile names and reject conflicts with legacy aliases. No raw keys, tokens or provider credentials in CLI arguments. Proposed Enterprise entry points are `mercato encryption_keys rewrap` with `--dry-run` for preview, `--resume <run-id>` for a pinned checkpoint, and `mercato encryption_keys status <run-id>` for inspection. Apply requires explicit source and target profiles and the coordinator's existing offline fence and acknowledgement. Only the active generation serves ordinary reads. Because existing payloads carry no generation identifier, a mixed-generation dataset during protected DEK rotation can be read only by the maintenance verifier that knows the source and target. Treat dry-run as read-only with respect to both application data and persisted DEK records.

### Encrypted backup and isolated restore

- Include binding, scope registry and envelope tables in the same logical snapshot as the protected application rows. Ensure module inclusion and validation under [#9333](https://github.com/open-mercato/open-mercato/pull/9333). Backup archive encryption keeps its existing age recipients and identities. Backups copy wrapped DEKs and field ciphertext without unwrapping the application keys, so a backup-only identity needs no KMS unwrap grant.
- Record the schema/version and an authenticated custody inventory or digest in the protected manifest or sidecar. Include each needed driver, format and historical key reference plus the bound source namespace. Preserve old manifest reads. No plaintext DEKs in archives, logs, temp files or manifests. Limit access to infrastructure detail as recovery metadata.
- Artifact verification checks the archive. A restored database remains isolated after import until a separate custody check proves matching source wrappers, key access and authenticated reads from each applicable key scope. Test binding/reference tampering and missing or disabled historical versions. To use a different cloud or deployment namespace, validate using the original context first and rewrap for the destination while still quarantined. Tenant-remapped data transfer and merging tenants into another live database are separate operations.
- Publish a runbook with a pre-change backup, post-change recovery exercise, least-privilege source/target mapping, intentional policy retirement and recommended native deletion protection. Missing cloud access stops release from quarantine even when the archive validates. No routine runtime role can delete or disable a KEK.

## API Contracts

Keep the shared `KmsService` and existing field cipher formats. Publish no new HTTP endpoints, events or ACL features. Readiness uses the existing health response shape and status contract. Existing CLI commands and machine output remain compatible. New maintenance actions report safe states and errors through the Enterprise CLI, mapping failures to its current exit-code convention.

## UI/UX

Operators use deployment configuration and host CLI. The runbook covers exact active profile, readiness, migration preview, resume, verified activation and quarantined recovery. Keep status text and progress in existing CLI presentation. Show a safe next action for blocked identity, missing key version, configuration drift and incomplete verification. The proposal has no browser workflow.

## Migration & Backward Compatibility

Stock installations use their existing factory behavior until explicit adoption. Preserve DI, import contracts, encryption policy scoping, at-rest formats and lookup hashes. New database tables and settings are additive. Ship coordinated deployment instructions with the binding guard and a greenfield path. Stopping the Enterprise module or downgrading a bound database requires the documented reversal while retaining the authoritative DEKs.

## Risks & Impact Review

| Risk | Mitigation | Residual impact |
|---|---|---|
| Critical · lost KEK makes data unreadable | Pin historical refs, require deletion protection and recovery exercises, keep verified backups and custody rights for retention. | Permanent destruction with no recoverable wrapper makes that DEK unrecoverable. |
| High · scope confusion or incomplete adoption | Bind namespace and logical key/generation, verify the persisted inventory, and refuse unknown or mixed histories. | Unsupported/custom encryption surfaces can block a cutover. |
| High · mixed processes or partial migration | Stop all writers, pin deployment epoch, use CAS, verify all staged wrappers and restart processes before release. | A supported cutover needs a maintenance window. Older binaries require deployment fencing. |
| High · privilege drift and KMS outage | Use resource-scoped workload roles, strict write policy, readiness and finite retry budget. | Protected operations become unavailable when no authoritative key can be accessed. |
| Medium · provisioning fan-out and restore quotas | Bound tenant provisioning, provider concurrency, pool usage and health retries. Measure cold start and multi-scope recovery. | Large inventories can lengthen maintenance windows. |

## Verification

- Pack and install each published driver in isolation. Verify stock OSS and Enterprise artifacts omit provider packages and SDKs. Exercise enabled and disabled Enterprise paths without evaluating a disabled driver. Verify a partner package can use the same supported contract and maintenance capability without a Core edit.
- Use self-contained PostgreSQL tests for two-process provisioning, process restart, valid tenant/system scopes, swapped envelopes, missing established slots, invalid wrapper versions, health/outage recovery, authorization failures, restore quarantine and pool saturation. Exercise actual setup and worker entry points, `/api/healthz`, and representative existing protected APIs from the OSS spec.
- Qualify each initial package against a disposable real cloud key and the documented production identity. Exercise credential refresh, allowed operations, denied or disabled key, historical unwrap after key-version transition, cancellation and redacted telemetry. Use workload identities and scoped keys. Run fast mock-based tests in ordinary CI and keep live evidence per provider for release.
- Prove Vault → cloud and derived → cloud migrations. Test rewrap between distinct cloud profiles and through an external envelope fixture. Verify unchanged application ciphertext and lookup hashes, crash before/after activation, resume with changed references, actual DEK rotation and failure to verify a tampered row. Exercise both source and target roles for each qualified cloud driver.
- Interrupt DEK rotation after a committed row rewrite and before target activation. Verify that discarding staging cannot reopen source serving, both generations remain available for resume, and rollback can release only a verified quarantined restore through a separately approved cutover. Verify that abandoning a same-DEK rewrap before activation leaves the source readable.
- In a single process, warm the ordinary cache with the source DEK and verify a distinct target generation for the same logical scope. Assert that maintenance calls the target resolver, obtains the target DEK and verifies target-encrypted data. Repeat with an unresolved ordinary source provisioning promise for the same scope and assert the target completes independently. Verify that an unavailable target fails even with a warm source and that maintenance leaves the ordinary cache unchanged. For same-DEK rewrap, verify target unwrap against the staged wrapper through the target profile even when the key bytes match.
- Create and verify encrypted backups and restore to isolated disposable targets. Confirm restoration with current and historical wrappers, then restore across provider profiles. Prove archive verification can succeed while missing source key custody keeps restore quarantined. Measure request, probe and maintenance budgets including database connections and cloud throttling. Keep fixtures and cloud resources disposable and clean them up through the approved maintenance environment.

## Phasing

1. Build the shared Enterprise envelope and binding lifecycle on the OSS contract. Integrate verified rewrap, rotation and backup custody before a provider is available to customers.
2. Qualify AWS, GCP and Azure as independent delivery work items, each with an installable package and the entire lifecycle gate. A later provider can use the same gate.

## Final Compliance Report — 2026-11-25

The OSS seam stays provider-neutral. Enterprise packages own cloud SDKs, protected lifecycle and storage. Existing authorization delegates to shared encryption scoping. No public app route, stored field cipher format or lookup contract changes. Live provider and maintenance tests are implementation gates, pending design review and delivery.

## Changelog

- 2026-11-25 · Proposed Enterprise AWS KMS, Google Cloud KMS and Azure Key Vault driver packages for #9344.
- 2026-11-25 · Specified cache isolation and regression coverage for pinned maintenance DEK lookups.
- 2026-11-26 · Aligned cloud driver registration with the common `src/providers/` convention and documented the default Vault package dependency.

## Implementation Plan

1. Consume the OSS manifest and strict write-safety prerequisites. Exercise `src/providers/kms.ts` registration and the same early provider bootstrap across serving and maintenance entry points. Implement the guarded Enterprise store and shared envelope contract. Qualify provisioning and refusal against disposable fixtures with all provider SDKs absent.
2. Add explicit, version-pinned maintenance profiles to the protected rotation coordinator. Bypass the shared DEK cache and in-flight map for maintenance reads, and prove verification uses the distinct target key for the same scope with the source cached and with the source lookup in flight. Implement the rewrap checkpoint and rollback rules. Prove no persistence from preview and test resume and stale-epoch refusal.
3. Extend backup snapshot and restore custody checks once #9333's operational contract lands. Rehearse full isolated recovery and cross-deployment rewrap with a fixture before releasing a cloud driver.
4. Implement and qualify the AWS package with native IAM-role authentication and historical references.
5. Implement and qualify the Google Cloud package with ADC workload identity, primary/explicit version handling and integrity checks.
6. Implement and qualify the Azure package with managed/federated identity, exact versioned wrapping and verified context framing.
7. Archive the Delta into `.ai/specs/enterprise/capabilities/enterprise-cloud-kms.md` in the implementation PR.
