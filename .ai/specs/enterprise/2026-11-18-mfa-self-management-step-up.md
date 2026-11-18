# MFA self-management step-up and Email OTP possession proof (#9145)

## TLDR

Require the existing sudo step-up for MFA activation, removal and recovery-code regeneration. Preserve compelled first enrollment. Activate Email OTP only after verifying a code sent to the pending destination.

## Overview and problem

An authenticated session can currently add a factor, replace the Email OTP destination at confirmation, remove factors, and rotate recovery codes without proving the actor still controls existing credentials. The Email OTP UI confirms an empty payload; no setup code is sent. Issue: https://github.com/open-mercato/open-mercato/issues/9145.

## Proposed solution and architecture

Register `security.mfa.self.manage` with the existing `auto` sudo challenge. Confirmations check sudo inside the existing enrollment advisory-lock transaction, before invoking the provider or activating its pending row. Only a user with zero active methods, an authenticated tenant context, and confirmed enforced/noncompliant policy may skip sudo. Policy lookup failure does not grant an exemption. Removal and recovery-code routes validate sudo before command dispatch. Request-backed command execution/redo and method-restoration undo also check step-up so replay cannot bypass the route guards. Trusted server callers without an HTTP request retain the established service/command signatures. Existing scoped sudo token verification remains responsible for user, target, tenant, organization, expiry and effective policy bindings.

The client uses existing guarded mutation and sudo challenge mechanisms. It first tries the mutation, handles only the standard `sudo_required` response, asks for existing step-up, and retries with its token. Compelled first enrollment consequently never needs an unnecessary sudo challenge.

Email OTP setup sends a generated six-digit code using the existing email/OTP helpers. Pending setup stores a hash, creation time, owner and immutable destination. Confirmation requires the code, ignores supplied email, limits wrong attempts to five, rejects expired or consumed setup, and prevents concurrent verification/replay. Only explicit existing test mode exposes a setup code in clientData.

Email setup uses the existing DI rate limiter before hashing or sending mail: five requests per ten minutes per tenant/user and normalized destination, plus twenty per tenant/trusted IP. Without a trusted IP, the request bucket is user-scoped rather than shared among unrelated users. A degraded or unavailable limiter fails closed. Existing limiter enablement/store settings remain authoritative. Setup replaces that user's prior in-memory challenge and reuses an existing pending Email OTP row under the enrollment advisory lock, preventing repeated requests from appending inactive rows. Sudo checks reuse the resolved authenticated context.

## Data models and API contracts

No schema migration, dependency, startup or environment change. Route URLs, methods, request envelopes, response envelopes, service signatures, event IDs and ACL features remain. Provider runtime context adds an optional commandContext carrying the already-resolved actor/container; existing provider implementations remain compatible. New sudo target is additive. Existing provider setup clientData adds a test-only code using the established OTP testing seam.

## Migration & Backward Compatibility

This is intentional security narrowing: code-free Email OTP confirmation stops succeeding, confirmation-time email no longer overrides the verified destination, and affected self-management mutations require sudo by default. A bridge accepting those insecure calls would preserve the vulnerability. Custom clients must collect the code delivered during POST setup and send `payload.code` on PUT, handle `sudo_required`, and retry with `X-Sudo-Token` for the new target. Compelled first enrollment remains available without an existing factor.

Operators must ensure email delivery works before enabling Email OTP enrollment. Existing active factors are not silently invalidated; operators should audit suspicious enrollments and reset untrusted factors through existing administration/recovery procedures. Pending in-memory setup sessions are restarted after rollout as with existing provider restarts.

UPGRADE_NOTES.md and BACKWARD_COMPATIBILITY.md contain the client/operator disclosure and dated exception request. Named human maintainer approval remains a merge blocker. Automated review cannot supply the human waiver.

## Risks & impact review

- High: session theft becomes durable factor compromise if any mutation misses the guard. Route/service regressions cover all affected writes; no successful mutation occurs after sudo rejection.
- High: a concurrent enrollment could reuse the first-enrollment exception. Resolve active-method count and guard while holding the existing per-user transaction lock.
- Medium: brute force or concurrent OTP replay. Hash stored codes, bound attempts and TTL, serialize in-process verification and consume once. Existing in-memory provider setup lifecycle remains; this change does not add distributed state.
- Medium: third-party clients sending empty confirmation payloads break. Required migration and human security exception are explicitly recorded above; no insecure compatibility branch.
- Medium: unavailable email or policy services block voluntary enrollment. Fail closed and allow setup retry; compelled exemption requires verified policy.

## Integration coverage

Module unit and route/service integration tests must cover missing/invalid sudo, valid-token success, target binding, compulsory first enrollment versus existing factors, provider not invoked after denial, no command dispatch after denial, missing/wrong/expired/replayed OTP, wrong user, immutable destination and concurrent confirmation. API Playwright coverage creates a tenant-bound user/role, exercises setup, sudo rejection and password step-up, OTP rejection/confirmation, recovery rotation and removal; fixtures are deleted in finally. UI regression covers code entry before confirmation and sudo retry/cancellation. Execution requiring a running app is reported separately from added coverage.

## Final compliance report

Scope is the enterprise security module and this issue-specific spec. No cross-module ORM relationship, dependency, infrastructure, startup or production configuration change. Human compatibility waiver and manual QA approval are not granted by this task. Validation results are recorded in the PR and task evidence.

## Changelog

- 2026-11-18: Parent review adds root migration/exception disclosures, reuses authenticated sudo context, and addresses the inherited setup-abuse finding with tenant/user/destination/IP rate limits, pending challenge replacement and locked pending-row reuse. Human waiver and application QA remain pending.
- 2026-11-18: Document requested issue #9145 hardening, compatibility impact, migration obligations and security regression matrix.
