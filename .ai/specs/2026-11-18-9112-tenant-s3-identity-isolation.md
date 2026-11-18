# Tenant S3 identity isolation (#9112)

## TLDR and status

Proposed security fix; **blocked for merge pending a named human maintainer security exception**. Root migration and contract records are included; no approval is assumed. Automated review cannot grant the exception. Issue: https://github.com/open-mercato/open-mercato/issues/9112.

## Overview and problem statement

Tenant S3 credential writes currently accept arbitrary keys. Five S3 routes spread resolved credential blobs into the driver, permitting an undeclared credentialsEnvPrefix to read server environment credentials. Missing/blank keys and authMode=ambient leave SDK credentials undefined, selecting the platform's default AWS credential chain. The health checker duplicates this behavior and can probe operator-accessible buckets.

Existing relevant designs: implemented/SPEC-045i-storage-hub.md documents generic driver environment-prefix and default-chain support; 2026-08-21-integration-secret-credential-editing.md documents explicit secret-preservation and ambient clearing. Enterprise automated-database-backups (2026-07-08) plans trusted, unscoped operator-created storage services. Preserve that generic operator API; it is not a tenant-supplied credential boundary.

## Proposed solution and architecture

Reuse data/guards.ts discovery and the existing integrations credentials PUT mutation guard. The provider guard targets only storage_s3 credential writes. A strict provider-local schema rejects ambient mode, absent/blank keys, credentialsEnvPrefix and every undeclared credential key. It uses the existing masked-secret merge helper before validating preserved secrets, including its destination-change protection. Other integrations are unaffected.

Apply the same schema at five tenant route boundaries, the tenant storage service factory, attachment credential enhancement, signed-upload compatibility route, quota-recovery worker and the health check so previously stored unsafe credentials cannot regain access. Construct driver config only from parsed fields plus authenticated tenant/organization scope. A scoped S3StorageDriver independently rejects ambient auth, environment prefixes and incomplete/blank keys before AWS client construction. Trusted, unscoped driver construction retains its existing operator-only behavior; tenant inputs have no switch to select that path. The marketplace offers access-key mode only.

No production dependencies, generic integrations service/validator edits, environment flags, bootstrap changes, database migrations or new architecture are introduced. Newly discovered provider guards require yarn generate and the ordinary module bootstrap.

## Data models and API contracts

No schema/data migration. PUT /api/integrations/storage_s3/credentials returns 422 for unsafe or undeclared fields, including a completely empty credential object. Valid explicit keys, optional session token, region, bucket, endpoint and forcePathStyle remain supported. Existing secret sentinel and unchangedSecretFields protocols remain supported; changing endpoint requires secret re-entry. Direct service writes remain a trusted operator API, but tenant consumers reject unsafe persisted blobs at runtime.

The five /api/storage-providers/s3 operations (upload, download, delete, list, signed-url) return their existing integration-not-configured response for unusable stored credentials before driver creation. Health reports unhealthy without contacting AWS. The signed-upload compatibility route also validates stored credentials and releases its claimed reservation on rejection. The quota-recovery worker validates credentials before constructing its scoped driver, retaining/retrying its reservation if credentials are unsafe. Internal scoped driver callers fail before constructing the AWS client if explicit keys are missing.

## Migration & Backward Compatibility

STABLE credential/API behavior is intentionally narrowed: tenant ambient/default-chain auth, tenant environment-prefix lookup, and arbitrary credential injection stop working. These shapes are themselves the exploit: a bridge accepting them for tenant operations would retain platform-principal selection. No tenant opt-in/flag retains that branch. Removing only tenant use preserves trusted unscoped operator APIs and is narrower than deleting generic driver capabilities.

**Required human action before merge:** named maintainer approval explicitly acknowledging the Emergency Security Exception in BACKWARD_COMPATIBILITY.md, steps 1–3. A bot approval or the issue's implementation notes do not supply the waiver. The dated root contract entry records the STABLE credential/API removal, this qualification and migration. The coordinating task added root client/operator migration and dated contract records; the waiver is still pending.

Client migration: replace ambient/prefix/empty credentials with explicit, nonblank tenant-specific accessKeyId and secretAccessKey (plus sessionToken for temporary credentials), select access_keys, remove undeclared fields and re-save. Existing stored unsafe credentials remain in the database but become unusable; no automatic credential copying occurs. For empty/partial configurations, enter the required bucket and region as well. Clearing the S3 credential object with PUT now fails validation; use supported integration state controls instead.

Operator migration: provision a least-privilege tenant principal for the intended bucket, issue/rotate credentials, and reconfigure affected scoped S3 attachment partitions with explicit keys as needed. Review platform AWS access logs, bucket writes and costs for misuse; previously saved ambient/prefix configurations are newly suspect. The existing provider env preset may preconfigure explicit keys; it must not distribute a broad platform principal to tenants. No startup command or new environment variable is required, but **existing tenant/partition configuration must change**, so this fix does not satisfy a no-configuration-change automerge request. Rollback restores the vulnerability and is not a safe migration.

## Risks & Impact Review

| Scenario | Severity | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Existing ambient/prefix tenant or scoped attachment config stops serving files | High | Clear client/operator migration, health rejection, human security exception gate | Operators must provision keys before rollout |
| Previously stored hidden config re-enters driver | High | Runtime schema at every integration boundary and scoped driver enforcement | Trusted custom code remains responsible for never dropping request scope |
| Secret-preserving edits regress or change destination | High | Real PUT/guard/masking regression coverage and existing destination protections | Concurrent edits retain existing optimistic-lock behavior |
| Unknown fields become persisted via tenant PUT | High | Strict schema before persistence, with undeclared-field regressions | Direct operator service writes remain trusted, runtime rejects unsafe blobs |
| Optional module disabled or registry not regenerated | Medium | Existing discovery mechanism; run yarn generate | Disabled provider exposes no provider routes |

## Validation and integration coverage

Self-contained provider regression tests exercise the real integrations PUT handler, guard registry and masking helper with mocked persistence and authenticated scope. Cover rejected ambient/blank/prefix/unknown-field writes, valid explicit save, masked/omitted-secret preservation, changed endpoint, absent stored secret and unrelated integration behavior. Driver and health tests assert rejection before SDK construction/probing; route regressions cover unsafe stored credentials at upload/download/delete/list/signed URL entrypoints. Existing provider quota, key scope, endpoint safety and explicit-key tests remain in the suite.

Initial reproduction: timeout 180 yarn workspace @open-mercato/storage-s3 test --runInBand --runTestsByPath src/modules/storage_s3/__tests__/s3Driver.test.ts src/modules/storage_s3/__tests__/health.test.ts — 13 failed / 37 passed before production edits. Final provider suite: 191 tests passed (18 suites), with provider build/typecheck passing. The ordered configured gate passed both package builds, generation, i18n sync/usage and workspace typecheck. Full yarn test failed in web-research-model because ts-jest requires the JavaScript compiler API absent from native TypeScript 7; yarn build:app failed because Turbopack rejects dependency symlinks outside the worktree and cannot resolve Next. These are unresolved validation blockers. With OM_ENABLE_STORAGE_S3=true, direct app-workspace generation produced the storage_s3 guard registry entry; Turbo strict environment mode does not forward this flag by default. Live AWS and browser QA are not established by mocked tests; do not claim otherwise.

## Final Compliance Report

Provider-local implementation only. Existing generic validator/types, DI names, URLs, event IDs, encryption, tenant scoping, optimistic-lock route checks and mutation guard call sites remain intact. No shared/core production changes; the app route tests now use explicit tenant-key fixtures. Protected tenant credential behavior has an explicit merge blocker, not an assumed waiver. Root upgrade/contract entries are included; named human approval and validation/QA remain prerequisites.

## Changelog

- 2026-11-18: Review expanded runtime coverage to signed-upload completion and quota recovery with reservation regressions.
- 2026-11-18: Confirmed defect, captured failing regressions, prepared provider-local enforcement and passing provider suite (191 tests), provider build/typecheck and S3-enabled guard generation; full workspace test/app-build failures and the human contract exception remain blockers.

- 2026-11-18: Parent review traced hosted CI failure to app-level S3 route fixtures; supplied explicit tenant keys and preserved app-boundary MIME/quota/download assertions. Added required root client/operator migration and contract records without assuming a human waiver.

Parent independently reproduced all five app route-test failures with the original implicit-credential fixture, then passed all five after supplying explicit tenant keys. Hosted CI for the prior head also reported this exact app-suite regression; fixture correction preserves MIME, quota and download-header assertions.
