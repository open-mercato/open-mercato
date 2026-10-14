# Require WebAuthn Registration Verification for Passkey Enrollment

> Status: Implemented on the fix branch; validation in progress — named human maintainer security-exception approval required before merge.
> Issue: [#6800](https://github.com/open-mercato/open-mercato/issues/6800), following [#5296](https://github.com/open-mercato/open-mercato/issues/5296).

## TLDR

Require the existing WebAuthn registration-response path for every new passkey. Reject the client-supplied public-key shortcut without activating a method.

## Overview

This closes the enrollment gap left by [the signed-assertion verification fix](2026-08-14-passkey-mfa-require-webauthn-assertion.md) within the existing [enterprise MFA design](implemented/SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa.md). The implementation is limited to the confirmation branch and its API error boundary.

## Problem Statement

`PasskeyProvider.confirmSetup()` accepts either a WebAuthn registration response or `{ credentialId, publicKey, challenge }`. The latter branch compares a challenge already disclosed by setup, then persists the caller's public key without invoking `verifyRegistrationResponse`. Possession of that challenge does not establish a valid registration ceremony. Keeping this branch behind any compatibility flag would preserve the vulnerability.

This is the enrollment gap tracked separately from the assertion-verification fix (#3852 / #5306). It does not establish a stolen-password MFA bypass: the central `mfa_pending` route gate already excludes provider enrollment (#5453). Credit for the original report and external proof of concept [#6710](https://github.com/open-mercato/open-mercato/pull/6710) belongs to @Sawarz; this change is independently implemented in the enterprise package.

## Proposed Solution

1. Require `{ response, label? }` in the existing confirmation schema and remove the public-key shortcut. Keep registration verification against the signed setup's challenge, expected origins, RP ID, user binding, and expiry.
2. Convert a provider confirmation `ZodError` into `MfaServiceError('Invalid payload', 400)` before changing the pending method. The existing API error map translates that message. Preserve other exceptions and the existing provider mismatch, duplicate-label, feature and scope checks.
3. Replace the integration fixture's fabricated public key with a Chromium CDP virtual authenticator and native browser registration. Prove both signed authentication and rejection of unsigned enrollment/verification, including multiple enrolled credentials.

The current `attestationType: 'none'`, user-verification settings, authenticator selection, RP/origin configuration, credential metadata compatibility and signed assertion policy remain unchanged. “Attestation” here means the verified WebAuthn registration response; it does not mandate hardware provenance certificates.

## Architecture and Data Model

No database, migration, dependency, DI, event, ACL or UI component change is needed. `MfaService.confirmMethod` already fetches the pending method by user and setup ID; activation, flush and `security.mfa.enrolled` happen only after provider confirmation. Failed schema validation must leave that record inactive, with its setup secret and metadata unchanged and no enrollment event.

Multiple passkeys remain supported (`allowMultiple = true`). No method-selection change is needed: `prepareChallenge` stores the selected method ID, and `verifyChallenge` resolves that exact ID with user and active/deleted guards. Tests will authenticate the credential actually returned in `allowCredentials`, rather than assume an unordered database query selects a particular passkey.

## API Contracts

| API | Expected behavior |
| --- | --- |
| `POST /api/security/mfa/provider/passkey` | Existing registration options and signed setup ID; unchanged authorization. |
| `PUT /api/security/mfa/provider/passkey` | `{ setupId, payload: { response, label? } }` verifies registration and returns `{ ok: true }`; legacy public-key or malformed outer confirmation shape returns localized HTTP 400. |
| `GET /api/security/mfa/methods` | Only verified registrations become active; existing response unchanged. |
| `POST /api/security/mfa/prepare` and `/verify` | Existing challenge-bound signed assertions continue to work, including when several passkeys exist; unsigned attempts return 401. |

The generic route's top-level provider-payload envelope fallback remains supported; only the vulnerable passkey-specific inner shape is removed. Cryptographic verifier rejections retain their existing error handling; this change specifically controls schema failures rather than broadly swallowing verifier/runtime faults.

## Migration & Backward Compatibility

The PUT request payload is a **STABLE** API contract. This removal requests the Emergency Security Exception in `BACKWARD_COMPATIBILITY.md`: continued acceptance of the old shape is the vulnerability, so a bridge cannot close it. Only staging/deprecation/bridge steps are waived; this spec, client/operator upgrade instructions, a dated compatibility entry, the `security` label and named human maintainer acknowledgment are mandatory. **Human waiver acknowledgment is pending and blocks merge. An automated review cannot supply it.**

Clients using the shortcut must request registration options, run `navigator.credentials.create` (or the existing SimpleWebAuthn browser helper), serialize the returned registration credential, and submit `{ response, label? }`. The shipped UI already uses that path. Update test fixtures that supplied fake public keys. No raw `publicKey` confirmation flag is retained.

Existing stored passkeys are not deleted, migrated or automatically invalidated. Their historical enrollment provenance cannot be inferred from the current metadata, and keys enrolled through the shortcut may be suspect. Operators should audit their exposure and enrollment history and arrange reset/re-enrollment through a trusted registration ceremony where provenance is uncertain, preserving alternate recovery methods to avoid lockout. Registration verification does not retroactively repair stored credentials. Existing verification still requires a signed assertion.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Malformed payload becomes a server error | Real route → service → provider regression asserts 400 and no activation or enrollment event. |
| Real passkey users cannot enroll | Preserve verifier settings and metadata formats; unit tests pin verifier arguments and real browser tests enroll and authenticate two credentials. |
| Existing keys remain suspect | Explicit operator disclosure; no silent mass invalidation. |
| Enrollment authorization is inadvertently widened | No gate changes; pin POST/PUT exclusion for MFA-pending sessions and test live rejection. |
| Tests falsely pass with verifier mocks | Retain existing real-crypto assertion suite and add CDP authenticator registration/login through live APIs. |

## Integration Coverage

`TC-SEC-004` owns its user fixture and virtual authenticator, cleans up both, and exercises the passkey UI, POST setup, PUT confirmation, GET methods, password login, POST prepare and POST verify. It rejects the legacy confirmation shape with the genuine current setup challenge, confirms no new active method, enrolls two genuine credentials with distinct labels, rejects MFA-pending enrollment and unsigned verification, then completes a real signed challenge. No demo entity or fake public-key persistence is required. The ephemeral CLI exposes a loopback IP; the passkey test uses the same server through `localhost` for browser and registration/assertion requests because Chromium rejects IP-address RP IDs. Remote environments retain their configured hostname and the server verifies the corresponding origin normally.

## Implementation and Validation

Implement the provider/schema and service error boundary after capturing failing regressions. Run focused enterprise provider/service/route/completion-gate and real-crypto tests, then the configured ordered local validation gate. Run the live enterprise integration suite through the authoritative managed ephemeral CLI with enterprise/security enabled. Capture browser evidence and exact commit validation in the PR. CI and independent human QA remain separate required evidence.

## Final Compliance Report

The change is limited to the enterprise security module, its tests, and required security migration documentation. No OSS behavior, tenant scope, stored credential format, feature grant, migration, dependency, protected pipeline policy or UI governance file changes. The public request narrowing is deliberate and cannot merge until a named human maintainer acknowledges the documented waiver. Independent scope review found no additional capability or contract expansion. Focused regression evidence: the unchanged implementation failed six new checks (including the legacy route returning 200 and malformed payloads returning 500); after the fix, 52 focused tests passed, including the real-crypto assertion suite. The full enterprise suite passed 2,004 tests before the final synchronous-provider regression and workspace type checking passed all 38 tasks. Complete gate, live browser and exact-head CI results belong in the PR evidence; their completion and the human waiver must not be inferred from this document.

## Changelog

- 2026-10-01: Created the specification skeleton before implementation.
- 2026-10-01: Completed code-path and compatibility review; retained existing method-ID binding and specified real authenticator coverage without changing credential selection policy.
- 2026-10-01: Implemented the response-only confirmation and localized validation boundary; added real route regressions, two-authenticator integration coverage, and migration disclosures. Independent scope review completed; human waiver remains pending.
- 2026-10-01: Self-review found an invocation-time validation edge case; reproduced it, switched to `try/catch`, and verified synchronous and asynchronous provider failures with no activation. Final focused tests: 52 passed.
- 2026-10-01: Live Chromium rejected the ephemeral loopback IP as a WebAuthn RP domain. The passkey test now uses the same server through `localhost` for browser and ceremony API requests; production origin checks are unchanged.
