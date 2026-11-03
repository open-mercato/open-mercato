# Enterprise Security — Require a Genuine WebAuthn Assertion for Passkey MFA Verification

> **Status:** Implemented 2026-08-14 (branch `fix/passkey-mfa-require-webauthn-assertion`, PR #5306) — awaiting merge and manual QA
> **Issue:** [open-mercato#3852](https://github.com/open-mercato/open-mercato/issues/3852)
> **Scope:** Enterprise — `security` module (`packages/enterprise/src/modules/security`)
> **Severity:** Critical — second-factor bypass reachable by anyone holding an `mfa_pending` session, in login MFA and in passkey-as-sudo step-up alike.

## TLDR

**Key Points:**
- `PasskeyProvider.verify()` accepted a `{ credentialId, challenge }` payload beside the genuine `{ response }` assertion and approved it by plain string comparison. Both compared values are **public**: `prepareChallenge()` returns the credential id and the challenge to the caller, and `GET /api/security/mfa/methods` discloses `providerMetadata.credentialId`.
- A third route needed even less. With no verify context — the client simply never called `/api/security/mfa/prepare` — the provider fell through to comparing only the disclosed credential id and ignored the challenge entirely.
- `SudoChallengeService.verify` → `MfaVerificationService.verifyChallenge` → `provider.verify` is the same code path, so the bypass defeated login-time MFA **and** passkey-as-sudo step-up.

**Scope:**
- Collapse `verifyPayloadSchema` from a union to a single object requiring `response`; delete the context-absent `credentialId` fallback and the trailing string-compare block, so a verified `verifyAuthenticationResponse` is the only route to a positive verdict.
- Replace the test that asserted the bypass worked with regression coverage for every route that previously reached a positive verdict without a signature, plus a real-crypto suite that proves genuine passkeys still authenticate.
- Record the contract break under the Emergency Security Exception, with client and operator migration instructions.

**Concerns:**
- This removes a STABLE contract surface with no bridge, which the ordinary deprecation protocol forbids. See § Migration & Backward Compatibility.
- It closes only the *verification* half. The *enrollment* half (#5296) still accepts a client-supplied `publicKey` with no attestation and is unaffected by this change.

---

## Problem Statement

All references verified against `develop` at issue-filing time.

### The verification schema accepted a non-cryptographic shape

`lib/providers/PasskeyProvider.ts` declared `verifyPayloadSchema` as a union of `{ response }` and `{ credentialId, challenge }`. The second branch was approved by string comparison against values the server itself discloses:

- `prepareChallenge()` returns `options.challenge` to the caller in `clientData`.
- `GET /api/security/mfa/methods` returns `providerMetadata.credentialId` for every enrolled method.

An attacker therefore did not need to guess either value; the API hands both over.

### An absent verify context weakened the check further

`MfaVerificationService.verifyChallenge` builds the verify context from `challenge.providerChallenge`, which `prepareChallenge` persists. When the client never called `/prepare`, no context existed, and the provider's context-absent fallback compared **only** the disclosed credential id, ignoring the challenge. That is a bypass with a single public value.

### Both entry points route through the same provider

`services/MfaVerificationService.ts` is the only call site of `provider.verify` in the module, and `SudoChallengeService.verify` delegates to it. So the same defect served `POST /api/security/mfa/verify` (login second factor) and `POST /api/security/sudo/verify` (sudo step-up).

### Root cause

The provider treated a *disclosed identifier* as an *authentication secret*. Possession of a credential id and a challenge proves nothing; only a signature over the challenge by the credential's private key does.

## Proposed Solution

Make a verified assertion the sole positive path.

### A. Narrow the payload schema

`verifyPayloadSchema` becomes `z.object({ response: z.record(z.string(), z.unknown()) })`. The union's second branch is removed, so a legacy payload fails the schema before any comparison happens.

### B. Require a prepared verify context

`verifyContextSchema.safeParse(context)` must succeed. An absent or malformed context is a rejection, not a fallback. The existing challenge TTL check runs unchanged against `pending.createdAt`.

### C. Delete the string-compare block

The trailing `credentialId` / `challenge` comparison is removed outright. `verifyAuthenticationResponse` from `@simplewebauthn/server` is the only remaining route to `true`, and the signature-counter update stays gated behind its positive verdict.

### D. Fail closed, and fail as a rejection rather than an error

`safeParse` instead of `parse`, and a `.catch()` around `verifyAuthenticationResponse` that returns `null`. This is deliberate and is the security-relevant choice: a thrown error reaches `mapMfaError` as a logged **500** and skips `registerFailedAttempt`, so rejected attempts would stop counting toward `securityConfig.mfa.maxAttempts` and the challenge lockout would be defeated. Returning `false` preserves the documented **401** and the attempt limit. No verdict flips from negative to positive.

The `.catch()` emits a `warn` through the logging facade (`createLogger('security').child({ component: 'passkey-provider' })`) carrying the method id, the rpId and the verifier's error — but not the assertion — so a misconfigured `rpId`/`expectedOrigins` is diagnosable rather than presenting as a mystery 401.

## Affected Surfaces

| Path | Change |
|------|--------|
| `lib/providers/PasskeyProvider.ts` | `verifyPayloadSchema` narrowed; context-absent fallback and string-compare block removed; verifier failure logged and rejected |
| `lib/__tests__/PasskeyProvider.test.ts` | Bypass-asserting test replaced with regression coverage for each previously-positive route |
| `lib/__tests__/PasskeyProviderWebAuthn.test.ts` (new) | Real `@simplewebauthn` verifier against a software authenticator |
| `__integration__/TC-SEC-004.spec.ts` | Asserts login verification answers `401` without an assertion |
| `__integration__/TC-SEC-006.spec.ts`, `TC-SEC-007.spec.ts` | Sudo step-up asserts `401`; sudo-token-gated remainders skipped with a stated reason (#5307) |
| `__integration__/helpers/securityFixtures.ts` | `verifyPasskeyChallenge` → the explicitly negative `attemptUnsignedPasskeyVerify` |
| `BACKWARD_COMPATIBILITY.md`, `UPGRADE_NOTES.md`, `.ai/qa/scenarios/TC-SEC-004-…md` | Contract break, exception record, client and operator migration |

## Test Plan

The load-bearing evidence is `PasskeyProviderWebAuthn.test.ts`, which does **not** mock `@simplewebauthn/server`. It generates a P-256 key pair, encodes the COSE public key the way `confirmSetup` stores it, and signs a genuine assertion over the challenge `prepareChallenge()` produced. Mocking the verifier could not prove what this change most needs proven — that the tightening did not overshoot and lock every passkey user out.

- A real assertion verifies and advances the stored signature counter.
- A tampered signature is refused and the counter is not advanced.
- An assertion replayed against a different prepared challenge is refused.
- The disclosed `{ credentialId, challenge }` pair is refused.

`PasskeyProvider.test.ts` adds five cases against the mocked verifier: the legacy shape is refused even with a correctly prepared context; a `credentialId`-only payload is refused when the client skipped `/prepare`; a well-formed assertion is refused when no challenge was prepared; an assertion the authenticator did not sign is refused without advancing the counter; and an assertion that makes the verifier throw resolves to `false` instead of propagating. The first three also assert `verifyAuthenticationResponse` was never reached. Three of the five fail against the pre-fix provider.

`TC-SEC-004` gives the fix live end-to-end coverage in CI. `TC-SEC-006`/`TC-SEC-007` gate on a pre-existing `test.skip(!passkeyMethod, …)` and the CI environment seeds no admin passkey, so their new `401` assertions are dark in CI today; the fix's CI signal comes from `TC-SEC-004` plus the unit suites, which exercise the identical provider path sudo routes through.

**Coverage gap, tracked as #5307.** Passkey verification has no integration-level *happy* path, because no API-level fixture can produce a signed assertion. Restoring it needs a Playwright virtual authenticator, or decoupling the sudo scenarios from passkeys onto TOTP.

## Migration & Backward Compatibility

This change **breaks a STABLE contract surface without the deprecation protocol, deliberately**, under the [Emergency Security Exception](../../../BACKWARD_COMPATIBILITY.md#emergency-security-exception).

### Classification

The removed shape was publicly supported, not an undocumented accident: it was part of the exported `MfaProviderInterface.verifySchema` union that a third-party client could validate against, and the enterprise suite pinned it in a case named *"supports legacy verification payload for backward compatibility"*. So this is a real category-7 (API request shape) break, and the exception — rather than a claim that no contract existed — is what authorizes it.

### Why no bridge

The protocol's bridge requirement exists to give downstream authors a migration window. Here the request shape being removed *is* the vulnerability: both values it compared are disclosed by the server, so keeping it alongside the assertion path for one minor version would leave the passkey second factor bypassable in login MFA and sudo step-up for that whole window. A security fix that keeps the hole open for a release is not a fix. Correspondingly, **no flag, config toggle or opt-in retains the old branch** — a retained branch would be exactly the bridge the exception refuses.

### Broken surfaces

| Surface | Change |
|---------|--------|
| `POST /api/security/mfa/verify`, `POST /api/security/sudo/verify` request shape (`methodType: 'passkey'`) | `{ credentialId, challenge }` now answers `401` |
| `MfaProviderInterface.verifySchema` for `passkey` | Narrows from a union to a single object requiring `response` |
| Verification with no prepared challenge | Now a rejection rather than a `credentialId` comparison |
| Route URLs, HTTP methods, response schemas, DB schema, event IDs, ACL features, DI names, CLI commands | Unchanged |

### Client migration

Send the object returned by `@simplewebauthn/browser`'s `startAuthentication()` as `payload.response`, after calling `/api/security/mfa/prepare` (or `/api/security/sudo/prepare`). The first-party `PasskeyChallengeVerify` component already does this, so shipped UIs need no change. A client that submitted the credential id and challenge was, by construction, not performing cryptographic verification.

### Operator migration

Full instructions are in [`UPGRADE_NOTES.md`](../../../UPGRADE_NOTES.md) under `0.6.7 → 0.7.0`. The essential point, and the one easy to get wrong: a passkey enrolled through the setup path's unattested `publicKey` shortcut is **not** reliably rendered unusable by this change. Such a row holds either a key nobody can sign with (that user is now locked out and needs an admin MFA reset) **or** a keypair the enroller controls, which signs assertions this change accepts. Both enrollment paths write identical `provider_metadata` keys, so the row cannot be attributed to an origin; the conservative remediation is to reset and re-enroll all passkey methods on any deployment that ever provisioned passkeys through the API, and to sequence #5296 ahead of the upgrade where possible.

## Risks & Impact Review

| Risk | Failure scenario | Severity | Mitigation | Residual |
|------|------------------|----------|------------|----------|
| Tightening overshoots and refuses genuine assertions | Every passkey user locked out of login and sudo | Critical | `PasskeyProviderWebAuthn.test.ts` proves a real signed assertion still verifies and advances the counter; manual QA against a real authenticator before merge | Low |
| Third-party client sends the legacy shape | That client's passkey step breaks at upgrade with `401` | Medium | Documented in `UPGRADE_NOTES.md` and `BACKWARD_COMPATIBILITY.md`; accepted under the exception | Accepted |
| Shortcut-enrolled credential holds an attacker-controlled valid keypair | Account takeover survives this fix | High | Disclosed in `UPGRADE_NOTES.md` with reset-and-re-enroll remediation; closed properly by #5296 | Medium until #5296 lands |
| Verifier error swallowed as a silent 401 | Misconfigured `rpId`/`expectedOrigins` reads as a user error | Medium | `.catch()` logs a `warn` with method id, rpId and the verifier error | Low |
| No integration happy path for passkey verification | A future regression in the `{ response }` path is caught only by unit tests | Medium | Tracked as #5307; unit suite runs the real verifier | Medium |

## Open Questions

1. ~~Throw or return `false` on a malformed payload / verifier error.~~ **Resolved (2026-08-14):** return `false`. Throwing produces a 500 that skips `registerFailedAttempt` and defeats the challenge attempt limit. See § D.
2. ~~Bridge the legacy shape for one minor version.~~ **Resolved (2026-08-14):** no bridge, under the Emergency Security Exception. See § Migration & Backward Compatibility.

_No open questions remain blocking._

## Changelog

- 2026-08-14 — Initial spec, written from issue #3852 and the implementation on `fix/passkey-mfa-require-webauthn-assertion`, to satisfy deprecation-protocol step 5 for the contract break. Records the Emergency Security Exception classification, the client and operator migration paths, and the #5296 / #5307 boundaries.
