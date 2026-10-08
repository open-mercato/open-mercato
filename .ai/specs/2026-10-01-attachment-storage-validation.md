# Attachment storage configuration validation

## 📝 TLDR

Provide one opt-in, process-wide validation policy at every attachment storage-factory resolution. Strict deployments reject missing partitions, absent or unknown drivers, malformed configuration and rejected provider invariants before credential enhancement, driver construction, cache use or file/provider operations. Default legacy behavior remains compatible.

Source issue: #6690. This is an additive storage-policy extension, separate from attachment owner authorization (#6726) and local-root configuration (#5946).

## Resolved assumptions (autonomous defaults)

| Question | Decision | Reason |
| --- | --- | --- |
| Make strict mode the default? | No. `OM_ATTACHMENT_STORAGE_POLICY=legacy` is the implicit compatibility default; `strict` opts in for each application process. Invalid policy values fail closed. | Existing partitions and integrations depend on fallback behavior. |
| Where do provider invariants live? | Provider-owned synchronous validators; core knows only generic partition/driver/configuration structure. Strict external drivers require a validator. | Core cannot safely infer a remote provider's schema or credential semantics. |
| Include owning-record authorization? | No. Coordinate #6726 separately. | Authorization and storage selection are independently deployable contracts. |
| Replace deprecated explicit-local helpers? | No. Document that explicit low-level drivers and deprecated filesystem helpers do not perform partition selection; callers needing the policy must use the factory/service. | This seam governs factory resolution, not arbitrary filesystem access. |

## 📝 Overview

The same policy applies to factories obtained through DI, directly constructed factories, existing instances after registration and factories loaded through duplicated server bundles. The policy is an operational choice shared by web, worker and CLI environment configuration. Provider modules register validators at module initialization alongside driver registration. Applications can register stricter validators through the supported attachment driver entry point before accepting work.

## 📝 Problem Statement

`StorageDriverFactory` eagerly constructs local drivers and falls back to local when the partition is missing, its driver is null, or a driver registration is absent. A DI override cannot cover direct construction in attachment download/upload helpers and late initialization. Credential enhancement precedes any common configuration validation. Some deletion paths remove the database row before resolving storage, and the CLI swallows failures, so rejecting configuration must occur before destructive side effects and remain machine-identifiable.

Existing storage-hub policy (`implemented/SPEC-045i-storage-hub.md`) explicitly preserves local fallback. That behavior remains available rather than silently becoming a breaking change.

## 📝 Proposed Solution

Introduce `AttachmentStorageConfigurationError`, a bundle-safe error discriminator, public validator types and registration, plus policy inspection/validation helpers. Resolve the policy for each operation, not once in a DI constructor. Strict mode checks the partition and driver before selecting an implementation; local/legacy drivers are created lazily only after validation. External drivers must have a registered synchronous validator, called before credentials and again after any credential enhancement.

The validator returns an explicit boolean. Exceptions, rejected results, missing validators and unexpected asynchronous results fail closed with a fixed safe reason; never preserve a provider exception or configuration in the public error. Validation runs before looking in the driver cache, so a cached instance cannot bypass a policy change or newly registered validator.

Core does not perform provider preconfiguration. The S3 package owns its schema/invariants and registers them beside its existing driver. Its configured stage permits fields supplied by the existing scoped credential enhancer, while its final stage requires a complete usable configuration and rejects conflicting credential modes, partial credentials and unsafe endpoints before constructing the SDK client. Endpoint safety reuses `assertStaticallySafeS3Endpoint` and its existing operator-controlled allowances; strict validation must not invent an HTTPS-only restriction that breaks supported HTTP MinIO. Explicit ambient credentials, and the existing default-chain behavior when no credential fields are supplied, remain valid. A partial access-key pair, missing environment-prefix credentials or an explicit ambient mode combined with explicit keys is rejected.

## 📝 Architecture

- New `attachments/lib/drivers/storageValidation.ts`: policy parser, registry, validator context and typed redacted errors. Global symbol-backed state follows existing DI registry conventions so server bundle duplication does not split policy registrations.
- `driverFactory.ts`: one validation boundary used by `resolveForPartition` and synchronous `resolveForAttachment`; lazy local/legacy constructors; pre-enhancement and post-enhancement checks; no failure fallback under strict mode. Existing two-argument driver registrations remain valid in legacy mode.
- Supported exports from `@open-mercato/core/modules/attachments/lib/drivers`, with policy/error/validator types also available from the attachment module public entry point.
- Attachment HTTP boundaries convert only the new error into a localized 503 response with stable code/reason; existing auth, not-found and provider operational errors retain their semantics. Missing-partition branches and upload's partition fallback honor strict policy before substituting another partition.
- Deletion resolves/validates storage before database removal and thumbnail cleanup. Actual irreversible provider deletion still follows the database commit as required by the attachment service contract.
- CLI reports the redacted error and rethrows typed configuration failures so the command cannot report success. Recovery workers preserve the same typed error for retry/error handling.
- Direct creation helpers cannot repair a missing requested partition into implicit local storage in strict mode.

Scope remains the existing tenant/organization pair. Validators receive that pair unchanged when supplied; partial scope is rejected in strict mode. Global operations remain supported with both scope values absent/empty. Errors include no scope values, partition names, bucket names, endpoints, credentials or raw validator exception messages.

## 📝 Data Models

No schema, migration or stored-data rewrite. Existing partition `storageDriver`/`configJson` remain the source of configuration. A null configuration means an empty object for an explicitly selected local driver; arrays, scalars and non-plain objects are malformed. A missing/null driver is invalid under strict mode. Driver-specific configuration is validated by its owner; local/legacy explicit selection remains supported.

## 📝 API Contracts

`OM_ATTACHMENT_STORAGE_POLICY` accepts `legacy` or `strict`; missing/empty means legacy. Unsupported nonempty values produce a typed `invalid_policy` failure before driver use.

The public validator receives a readonly context including driver key, configuration, optional partition code, optional tenant/organization scope and validation stage. It must be synchronous and side-effect free; it must not perform network or filesystem calls. Registration is keyed by driver and applies to every later factory resolution in that process. Web, worker and CLI must load provider registrations before resolving their storage; a missing registration fails closed in strict mode.

The typed error has stable code `ATTACHMENT_STORAGE_CONFIGURATION_INVALID`, HTTP status 503 and a finite reason enumeration (invalid policy, missing partition/driver, unknown driver, malformed configuration/scope, missing validator, rejected validator). Its safe serialization excludes configuration and causes. HTTP responses add `code` and `reason` beside the localized `error` message. Worker, CLI and startup code use the bundle-safe discriminator and reason.

Existing factory method signatures and legacy registration calls remain callable. No URL, ACL, DI name, event ID or existing successful response shape is removed.

## 📝 UI/UX

No new screen. Existing attachment failures display a localized storage-configuration-unavailable message. Operator diagnostics are the redacted stable reason; configuration values are never echoed to users. HTTP response schemas document the additive 503 error.

## 📝 Edge Cases & Failure Scenarios

- Missing requested partition: strict mode rejects before trying a default partition; legacy fallback is unchanged.
- Driver disabled/unregistered: strict mode rejects even if a cached local or provider instance exists.
- Credentials enhancer: generic/provider configured-stage validation happens first; enhanced output passes the same generic plain-object/scope checks and the provider final-stage validator again before constructor/cache use. Enhancer errors are redacted in strict mode.
- Cache hit: validation precedes the lookup; scope-enhanced configurations keep their existing per-call behavior.
- Late construction or duplicated import: registry state is process-wide; direct `new StorageDriverFactory(em)` has the same policy.
- Invalid provider config: validator rejection prevents both local writes and provider calls. Core cannot prevent a custom validator itself from violating its documented purity contract.
- Explicit local driver: valid under strict mode, including seeded partitions with null config; existing local root environment settings are unchanged.
- Existing global attachments: preserve the both-or-neither scope contract; do not invent a sentinel organization.
- Invalid config on deletion: retain metadata and thumbnails so the operator can repair configuration and retry.

## 📝 Migration & Backward Compatibility

This is additive and opt-in. Legacy mode preserves unknown/null/missing-partition fallback. Enable strict mode only after inventorying partitions, enabling their providers and registering validators in every process entry point. Provider/application validators must be installed before traffic or worker polling begins. Restart all processes after changing the policy. Rollback is setting `legacy` and restarting; it does not delete or move any data.

Applications should use `attachmentService` for business operations. The factory/validator entry points support storage-provider authors and platform integration. Explicit direct driver construction, S3 standalone APIs and deprecated explicit-filesystem helpers are outside partition resolution; migrate callers that require this policy to the supported service/factory rather than treating strict mode as a filesystem sandbox.

## 📝 Risks & Impact Review

| Risk | Severity / area | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Hidden legacy fallback dependency | High / strict deployments | Opt-in mode, explicit upgrade guidance, compatibility tests | Operators must audit partitions before enabling. |
| Missing validator at late initialization | High / strict provider operations | Process-wide registry, direct-construction and duplicated-module tests; missing registration rejects | Every worker/CLI bootstrap must import provider registrations. |
| Credential or endpoint leakage | High / HTTP/logs | Fixed code/reasons, discard provider causes and config, sentinel-secret tests | Custom validators must avoid their own unsafe logging. |
| Rejection after destructive removal | High / deletion | Resolve before metadata/thumbnail mutation; assert untouched effects in tests | Existing post-commit provider outage cleanup semantics remain. |
| Two attachment changes overlap | Medium / integration | Coordinate #6726 ownership and re-review common route edits | Normal merge conflict resolution may be required. |

## 📋 Integration Coverage

Ship tests through real factory calls and actual route/worker/CLI handlers using a registered fake driver: upload, file retrieval, image retrieval, both deletion routes, quota recovery, CLI deletion and direct late construction. Cover missing partition, null/unknown driver, malformed config, validator exception and enhancer rejection; assert zero constructor, local-write, provider-call and destructive metadata effects after rejection. Valid fake-driver cases must prove scoped input and actual store/read/delete invocation. Existing compatibility tests continue to prove legacy defaults.

Add a self-contained native API integration case for valid explicit-local upload/download/delete and strict malformed partition rejection. Fixtures are API-created and cleaned in finally; strict mode is selected on the disposable server, never the developer database. Where test setup uses handler-level fixtures, report that boundary explicitly rather than claiming a running database test. No UI path changes beyond existing error rendering.

## 📋 Phasing

One cohesive capability delivered in one implementation PR after a design-only spec PR. No independent authorization, quota or root-path feature is bundled.

## 📋 Implementation Plan

1. Add policy, validator, redacted error and bundle-safe registry contracts, plus baseline failing regression tests and compatibility tests.
2. Route every factory resolution through validation before credentials/cache/constructors; lazily initialize local drivers; register S3-owned validation.
3. Integrate typed HTTP/CLI failures and missing-partition behavior; resolve before destructive deletion; add route/worker/CLI tests and API integration coverage.
4. Document public imports, process activation, provider registration and rollback; run focused and configured full validation; publish implementation evidence and independent review.

## Final Compliance Report

Design preserves existing public contracts in legacy mode, introduces no schema or dependency, retains scope and mutation ordering, and keeps provider knowledge in its provider package. Independent review found the scope cohesive and no architectural blocker; it requested explicit structural revalidation of enhanced output and compatibility with supported MinIO/default-chain settings, both included above. Implementation and validation are pending. This spec does not claim deployment or approval.

## Changelog

- 2026-10-01: Initial autonomous design for #6690. Defaults preserve legacy behavior, require strict external-driver validation and keep authorization separate.
