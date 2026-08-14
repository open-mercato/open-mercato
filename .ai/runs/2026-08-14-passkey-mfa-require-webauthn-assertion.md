# Execution plan — require a genuine WebAuthn assertion for passkey MFA verification

**Issue:** [#3852](https://github.com/open-mercato/open-mercato/issues/3852) — `security(ent_security): passkey MFA second factor bypassable via non-cryptographic fallback`

**Supersedes:** PR [#5291](https://github.com/open-mercato/open-mercato/pull/5291), a third-party contribution that was closed without merging. `packages/enterprise` is the commercial package and we do not accept outside contributions there, so the fix is re-authored first-party from the issue report and the current `develop` source. No content from the closed PR's diff is carried over.

## Goal

Make a cryptographically verified WebAuthn assertion the only way to pass the passkey second factor, for both login-time MFA (`POST /api/security/mfa/verify`) and passkey-as-sudo step-up (`POST /api/security/sudo/verify`).

## Scope

`packages/enterprise/src/modules/security` only:

- `lib/providers/PasskeyProvider.ts` — the verify payload schema and the two non-cryptographic acceptance branches in `verify()`.
- `lib/__tests__/PasskeyProvider.test.ts` — replace the test that pins the bypass as intended behavior with regression coverage.
- a new real-crypto test that signs a genuine assertion with a software authenticator, so the removal is proven not to break real passkeys.
- `__integration__/` — the Playwright specs and the shared fixture that used the bypass as an API-level shortcut.
- `BACKWARD_COMPATIBILITY.md` and `UPGRADE_NOTES.md` — record the deliberate, non-deprecated request-shape removal.

### Non-goals

- The **setup-side** shortcut (`setupConfirmationPayloadSchema` accepting a client-supplied `publicKey` with no attestation). It is a separate defect with its own blast radius and gets its own issue.
- Restoring an integration-level passkey happy path. Producing a genuine assertion over the API is impossible by design; it needs a Playwright virtual authenticator driving the browser flow. Tracked as a follow-up issue.
- `OtpEmailProvider` / `TotpProvider` verification paths.
- Any change to challenge TTL handling, attempt limiting, or the signature-counter update.

## Implementation Plan

### Phase 1: Close the bypass in `PasskeyProvider`

`verify()` currently reaches a `true` verdict on three routes: a real `verifyAuthenticationResponse`, a `credentialId` + `challenge` string compare after the assertion branch, and — when no verify context exists at all — a bare `credentialId` compare. Both compared values are public: `prepareChallenge()` returns them to the caller and `GET /api/security/mfa/methods` discloses `providerMetadata.credentialId`.

1.1 Reduce `verifyPayloadSchema` to a single object that requires `response`, and reject a payload that fails the schema by returning `false` rather than throwing. A thrown `ZodError` reaches `mapMfaError` as a logged **500** and bypasses `registerFailedAttempt`, so rejected attempts would stop counting toward the challenge attempt limit; `safeParse` + `false` keeps the documented **401** and the lockout behavior.

1.2 Delete the context-absent `credentialId` fallback and the trailing string-compare block, so a verified `verifyAuthenticationResponse` is the only route to `true`.

### Phase 2: Unit regression coverage

2.1 Replace `supports legacy verification payload for backward compatibility` (which asserted the bypass worked) with regression tests: the legacy shape is refused with a correctly prepared context; a `credentialId`-only payload is refused when the client skipped `/prepare`; a well-formed assertion is refused when no challenge was prepared; and an assertion the authenticator did not sign is refused. The first two also assert `verifyAuthenticationResponse` was never reached.

2.2 Add `PasskeyProvider.webauthn.test.ts`, which does **not** mock `@simplewebauthn/server`: a software authenticator generates a P-256 key pair, stores the COSE public key the way `confirmSetup` does, and signs a real assertion over the prepared challenge. Asserts that a genuine assertion still verifies end to end and that a tampered signature does not. This is the evidence that the removal does not break real passkey login.

### Phase 3: Realign the integration suite

The Playwright specs used the bypass as their shortcut, so they assert a behavior that is now a vulnerability.

3.1 Turn the shared fixture into an explicitly named negative helper and update `TC-SEC-004` to assert that login verification with a non-cryptographic payload is refused.

3.2 Update `TC-SEC-006` and `TC-SEC-007` to assert that passkey sudo verification is refused, then skip their sudo-token-gated remainders with an explicit reason instead of asserting a token they can no longer obtain.

### Phase 4: Contract documentation

4.1 Record the removal in `BACKWARD_COMPATIBILITY.md` as a dated, deliberate exception to the deprecation protocol, and add an `UPGRADE_NOTES.md` entry telling downstream operators what changes and what to do about credentials enrolled through the setup shortcut.

4.2 File the two follow-up issues (setup-side attestation shortcut; virtual-authenticator integration coverage) and link them from the PR.

### Phase 5: Validation and delivery

5.1 Run the full `validation.commands` gate, then finalize the PR: labels, review pass, summary comment.

## Risks

- **Highest risk is a false negative**: over-tightening `verify()` would lock every passkey user out of login and sudo. Mitigated by Phase 2.2, which exercises the untouched `{ response }` path against the real `@simplewebauthn/server` with a genuinely signed assertion.
- **Deliberate breaking change.** `{ credentialId, challenge }` payloads start returning `401`. This skips the deprecation protocol on purpose: the request shape being removed *is* the vulnerability, so a bridge release would keep the second-factor bypass live. The first-party UI is unaffected — it sends `startAuthentication()` output.
- **Stranded credentials.** A passkey enrolled through the setup shortcut carries a fabricated public key and can never produce a verifiable assertion. Such a user needs an admin MFA reset. Documented in `UPGRADE_NOTES.md`.
- **Integration coverage loss.** Passkey verification has no API-level happy path after this change; Phase 3 makes that explicit rather than silent, and Phase 4.2 tracks restoring it.

## Progress

PR: #5306

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Close the bypass in PasskeyProvider

- [x] 1.1 Require a `response` payload and reject unparseable payloads without throwing — b635b1677
- [x] 1.2 Delete the context-absent and string-compare acceptance branches — b635b1677

### Phase 2: Unit regression coverage

- [x] 2.1 Replace the legacy-payload test with bypass regression tests — 0ed09d4b7
- [x] 2.2 Add a real-crypto test proving a genuine assertion still verifies — 0ed09d4b7

### Phase 3: Realign the integration suite

- [x] 3.1 Rework the shared fixture and TC-SEC-004 into a negative assertion — 5560dcaec
- [x] 3.2 Rework TC-SEC-006 and TC-SEC-007 sudo verification — 5560dcaec

### Phase 4: Contract documentation

- [x] 4.1 Document the deliberate break in BACKWARD_COMPATIBILITY.md and UPGRADE_NOTES.md — b508f95e2
- [x] 4.2 File the setup-shortcut and integration-coverage follow-up issues — #5296 already existed for the setup shortcut; filed #5307 for integration coverage

### Phase 5: Validation and delivery

- [x] 5.1 Run the full validation gate and finalize the PR — fb98bf0d9 (review pass raised one major finding, fixed in that commit)
