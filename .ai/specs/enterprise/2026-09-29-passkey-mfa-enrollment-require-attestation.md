# Enterprise Security — Require a Genuine WebAuthn Attestation for Passkey MFA Enrollment

> **Status:** Draft — implementing on branch `fix/issue-5296-passkey-enrollment-attestation`
> **Issue:** [open-mercato#5296](https://github.com/open-mercato/open-mercato/issues/5296)
> **Scope:** Enterprise — `security` module (`packages/enterprise/src/modules/security`)
> **Severity:** High — an unattested, client-supplied passkey public key can be stored as a real second factor for the caller's own account. The reachability path the issue's title emphasizes (a stolen-password `mfa_pending` session enrolling a forged key for the victim) is **no longer open**; see § Reachability Correction.
> **Related:** Verify-side sibling fix [`.ai/specs/enterprise/2026-08-14-passkey-mfa-require-webauthn-assertion.md`](2026-08-14-passkey-mfa-require-webauthn-assertion.md) (issue #3852). Central MFA-pending gate: `.ai/specs/enterprise/implemented/SPEC-ENT-007-2026-03-06-auth-login-interceptors-extension.md` § Amendment 2026-08-21 (issue #5212).

## TLDR

**Key Points:**
- `PasskeyProvider.confirmSetup` still accepts a legacy enrollment shape — `{ credentialId, publicKey, challenge, transports?, label? }` — that stores a **client-supplied public key with no attestation**, approved by comparing only the disclosed `challenge` value. This is the enrollment-side twin of the verify-side bypass #3852 closed.
- The issue's reachability analysis (written 2026-08-14) assumed a stolen-password `mfa_pending` session could reach `PUT /api/security/mfa/provider/passkey`. It could, **at the time the issue was filed**. Ten days later, issue #5212's central MFA-pending gate (`isMfaPendingAccessAllowed`, enforced in `resolveAuthFromRequestDetailed`) started rejecting pending tokens on every route except an explicit allowlist, and the enrollment route was never added to it. **That specific attack chain is already closed** on `develop` — verified below.
- The underlying weakness is still real independent of that reachability question: any session that can reach the enrollment route — including a fully-authenticated one, e.g. via a stolen session cookie — can plant an unattested credential for the account it operates as, with no proof a browser WebAuthn ceremony ever ran. That is what this spec removes.
- `MfaVerificationService.findMethod` selects a method row with no `orderBy`. More than one active credential of the same type is the *ordinary* case for passkeys (`allowMultiple = true`, not a forged-row edge case), so selection has been undefined all along whenever a user enrolls a second security key.

**Scope:**
- Collapse `setupConfirmationPayloadSchema` from a union to the single `{ response, label? }` shape; delete the `{ credentialId, publicKey, challenge }` branch in `confirmSetup`, so a verified `verifyRegistrationResponse` is the only route to a stored credential.
- Give `findMethod` a deterministic `orderBy: { createdAt: 'ASC' }`.
- Replace the `__integration__/helpers/securityFixtures.ts::enrollPasskey` fixture, which uses the removed shape purely to seed a method row for unrelated tests, with a direct EM insert — it was never exercising the enrollment HTTP contract as a test subject, only using it as a shortcut.
- Add a regression test pinning that the enrollment route stays off the MFA-pending allowlist (closing the loop on the reachability question this spec corrects, not reopening it).
- Record the contract break under the Emergency Security Exception, close out the operator warning #5291's `UPGRADE_NOTES.md` entry left open for this issue.

**Concerns:**
- This removes a contract surface with no bridge, which the ordinary deprecation protocol forbids — same class of exception as #3852.
- A full WebAuthn-ceremony integration test (Chromium CDP virtual authenticator) is **not** part of this change; it is deferred to the same coverage-gap issue (#5307) the sibling fix already deferred to, for the same reason: no API-level fixture can produce a signed assertion, and building the CDP harness is an independent, multi-day effort orthogonal to removing the vulnerable branch.

---

## Problem Statement

All references verified against `develop` at the time of writing (2026-09-29).

### The confirmation schema accepts a non-cryptographic shape

`lib/providers/PasskeyProvider.ts`:

```ts
const setupConfirmationPayloadSchema = z.union([
  z.object({ response: z.record(z.string(), z.unknown()), label: z.string().min(1).max(100).optional() }),
  z.object({
    credentialId: z.string().min(1),
    publicKey: z.string().min(1),
    challenge: z.string().min(1),
    transports: z.array(z.string().min(1)).optional(),
    label: z.string().min(1).max(100).optional(),
  }),
])
```

`confirmSetup` (lines ~211-223) accepts the second branch when `'response' in parsed` is false, checks only `parsed.challenge === pending.challenge` — a value `prepareChallenge`'s caller already holds, since the client requested it in the immediately preceding `POST` — and persists `credentialPublicKey: parsed.publicKey` verbatim, with no proof any authenticator produced it.

### Why it is a bypass, not just dead credentials

A fabricated public key is not automatically harmless: an attacker who supplies the public half of a keypair they generated can then sign a genuine WebAuthn assertion in software, and `PasskeyProvider.verify` (already hardened by #3852) accepts it, because from the verifier's point of view the credential is real — it is simply not the account owner's.

### Reachability Correction

The issue's attack narrative required only a stolen password:

1. Log in with a stolen password on an account that already has an MFA method → `mfa_pending` token.
2. `POST` the enrollment route with that token → `setupId` + challenge.
3. `PUT` the enrollment route with a forged `{ credentialId, publicKey, challenge }` → stored.
4. Clear the second factor with an assertion signed by the attacker's own key.

Step 3 is no longer reachable this way. `resolveAuthFromRequestDetailed` (`packages/shared/src/lib/auth/server.ts:422-429`) resolves any `mfa_pending` JWT to `{ auth: null, status: 'invalid' }` unless the request's exact method+path pair is registered with `registerMfaPendingAccessRoutes`. `packages/enterprise/src/modules/security/lib/mfaCompletionRoutes.ts` registers exactly three routes — `/api/security/mfa/{prepare,verify,recovery}` — and `/api/security/mfa/provider/[providername]` is not one of them:

```
$ grep -A3 CANONICAL_MFA_COMPLETION_ROUTES packages/enterprise/.../lib/mfaCompletionRoutes.ts
  { path: '/api/security/mfa/prepare', methods: ['POST'] },
  { path: '/api/security/mfa/verify', methods: ['POST'] },
  { path: '/api/security/mfa/recovery', methods: ['POST'] },
```

So a request bearing a pending token now gets `401` from the auth layer before `resolveMfaRequestContext` — and therefore before `authorizeMfaEnrollmentMutation` — ever runs. This closes item 2 of the issue's suggested fix ("reject `mfa_pending` sessions on MFA enrollment routes") as a side effect of unrelated, later work (issue #5212, landed 2026-08-24 — ten days after this issue was filed). No code change is needed for that half; a regression test is added instead, since nothing currently pins the enrollment route specifically off that allowlist (see § Test Plan).

**What remains open**, and what this spec actually fixes: the legacy shape is still reachable by a fully-authenticated (non-pending) session, and accepting it any way is the actual defect — a session with no MFA setup ceremony behind it should never be able to make `credentialPublicKey` say otherwise for its own account. That is independent of how the session was obtained.

### `findMethod` has no deterministic order

`MfaVerificationService.findMethod` (`services/MfaVerificationService.ts:291-302`):

```ts
const method = await this.em.findOne(UserMfaMethod, { userId, type: methodType, isActive: true, deletedAt: null })
```

Two active rows of the same `type` for one user is not an edge case for passkeys: `PasskeyProvider.allowMultiple = true`, so a user enrolling a second security key is the ordinary path, not a forged or repaired row. Without an `orderBy`, which of those rows `findMethod` returns is database-defined, not application-defined. A deterministic tiebreak removes that ambiguity regardless of how the duplicate arose — normal multi-key enrollment, a forged row from before this fix shipped, or a future data-repair path.

**Pre-existing limitation this does not fix, filed separately:** `prepareChallenge` resolves exactly one method via `findMethod(userId, 'passkey')` and puts only that credential in `allowCredentials`, so a user with several enrolled passkeys can currently only authenticate with the one `findMethod` happens to return — after this change, deterministically the oldest. Letting `prepareChallenge` offer every enrolled credential is out of scope here; it is a UX/completeness gap in multi-key support, not part of the attestation vulnerability this spec closes, and is being tracked as its own follow-up per review.

## Proposed Solution

### A. Narrow the confirmation payload schema

`setupConfirmationPayloadSchema` becomes `z.object({ response: z.record(z.string(), z.unknown()), label: z.string().min(1).max(100).optional() })`. The union's second member is deleted.

### B. Delete the non-cryptographic branch

The `if (parsed.challenge !== pending.challenge) { ... } return { metadata: { credentialId: parsed.credentialId, credentialPublicKey: parsed.publicKey, ... } }` block is removed outright. `verifyRegistrationResponse` is the only remaining route to a stored `credentialPublicKey`.

### C. Deterministic method selection

`findMethod` gains `orderBy: { createdAt: 'ASC' }` — the oldest active credential of a given type wins ties, mirroring "first enrolled, first trusted" rather than leaving the choice to storage order.

### D. Fixture migration

`enrollPasskey` in `__integration__/helpers/securityFixtures.ts` currently drives the HTTP enrollment endpoint with the removed shape purely to get a `UserMfaMethod` row into the database for tests that exercise *other* surfaces (method listing, deletion, sudo step-up gating) — it has never been a test of the enrollment ceremony itself. It is replaced with a direct `em.create(UserMfaMethod, { ... })` + `em.flush()` insert carrying the same shape of `providerMetadata` (`credentialId`, `credentialPublicKey`, `counter: 0`, `transports`, `label`) a real enrollment would produce, so every consumer of the fixture keeps working unchanged. This is not a weaker test double than before: the HTTP round-trip it replaces was already using the unattested shortcut, so no consumer test was ever exercising real WebAuthn cryptography through this fixture.

### E. Regression coverage for the (already-fixed) reachability question

`packages/enterprise/src/modules/security/__tests__/mfaCompletionRoutes.test.ts` gains an assertion that `/api/security/mfa/provider/passkey` (`POST` and `PUT`) is **not** on the MFA-pending allowlist, so a future change cannot silently add it without a deliberate, reviewed decision.

## Affected Surfaces

| Path | Change |
|------|--------|
| `lib/providers/PasskeyProvider.ts` | `setupConfirmationPayloadSchema` narrowed to `{ response, label? }`; the non-`response` branch of `confirmSetup` removed |
| `services/MfaService.ts` | `confirmMethod` catches a `ZodError` from `provider.confirmSetup` and rethrows `MfaServiceError(…, 400)`, so a malformed payload (the removed legacy shape, or any other provider's schema failure) answers the documented `400` instead of `mapMfaError`'s generic `500` (review finding on this PR) |
| `services/MfaVerificationService.ts` | `findMethod` gains `orderBy: { createdAt: 'ASC' }` |
| `lib/__tests__/PasskeyProvider.test.ts` | New regression case: the legacy shape is refused even with a correctly prepared setup session, `verifyRegistrationResponse` never reached |
| `services/__tests__/MfaService.test.ts` | New cases: a provider `ZodError` maps to `MfaServiceError` `400`; a non-schema provider error is not swallowed |
| `services/__tests__/MfaVerificationService.test.ts` | New case: `findMethod` is called with the deterministic `orderBy` |
| `__tests__/mfaCompletionRoutes.test.ts` | New case: `/api/security/mfa/provider/passkey` stays off the pending allowlist for both `POST` and `PUT` |
| `__integration__/helpers/securityFixtures.ts` | `enrollPasskey` now drives the real WebAuthn ceremony via a Chrome DevTools Protocol virtual authenticator on the caller's own page, instead of the removed HTTP shortcut |
| `BACKWARD_COMPATIBILITY.md`, `UPGRADE_NOTES.md` | Contract break record; closes the operator warning #5291 left open under "this release does not close it" |

## Test Plan

- `PasskeyProvider.test.ts`: `confirmSetup` rejects `{ credentialId, publicKey, challenge }` even when `challenge` matches the pending session's — asserting `verifyRegistrationResponse` was never reached (mocked verifier, call-count assertion). A companion case confirms the `{ response }` path still succeeds unchanged, so the narrowing has zero effect on the real ceremony.
- `MfaVerificationService.test.ts`: seed two `UserMfaMethod` rows of the same type with different `createdAt`, call the code path that reaches `findMethod` (via `prepareChallenge`), and assert the older row's id is used regardless of insertion/return order from the mocked `em.findOne`.
- `mfaCompletionRoutes.test.ts`: `isMfaPendingAccessAllowed('POST'|'PUT', '/api/security/mfa/provider/passkey')` is `false`.
- `enrollment-authorization.test.ts`: unchanged — the mfa_pending question is decided at the auth layer, before `authorizeMfaEnrollmentMutation` runs, so there is nothing new to assert there (confirmed by reading `resolveMfaRequestContext`, which is only reached once `getAuthFromRequest` has already resolved a non-pending `auth`).
- `TC-SEC-004.spec.ts` (uses `enrollPasskey`): re-run to confirm the fixture swap is transparent to the spec — same method row shape, no assertion changes needed.
- Full targeted suite: `packages/enterprise` jest for `security` + the `TC-SEC-004` integration spec, plus `yarn typecheck` for the touched packages.

**Deferred, not part of this change:** a real WebAuthn-ceremony integration test (Chromium CDP `WebAuthn.addVirtualAuthenticator`) that exercises `POST`+`PUT` enrollment end-to-end with a genuine signature. Tracked under the same gap #5291 already opened as #5307, since it is the identical missing-harness problem on the enrollment side that #5307 already covers on the verify side, not a new gap this change introduces.

## Migration & Backward Compatibility

This change **breaks a contract surface without the deprecation protocol, deliberately**, under the [Emergency Security Exception](../../../BACKWARD_COMPATIBILITY.md#emergency-security-exception).

### Classification

Weaker than the verify-side precedent in one respect, worth stating plainly: `setupConfirmationPayloadSchema` is internal to `PasskeyProvider.ts` and not exported via `MfaProviderInterface` (unlike `verifySchema`, which the interface declares as `readonly verifySchema: z.ZodSchema` and which #3852's classification relied on). No third-party code could have type-checked against the removed enrollment shape. It is still a real break of the `PUT /api/security/mfa/provider/{providername}` **HTTP request body contract** (category 7, API route request shapes) — a request that answered `200` before this change answers `400` (fails the narrowed schema) after it. The exception, not a claim that no contract existed, is what authorizes removing it without a bridge.

### Exception requirements, as met by this change

| Requirement | How it is satisfied |
|-------------|--------------------|
| 1. Qualifying condition argued | See § Problem Statement / Reachability Correction — the removed shape's only check (a disclosed `challenge` value) proves nothing about who holds the credential's private key; accepting it at all is the exposure, independent of how the request was reached |
| 2. Narrowest removal, no retained vulnerable branch | Only `setupConfirmationPayloadSchema`'s second union member and the corresponding `confirmSetup` branch are deleted. The `{ response }` path, the setup-token TTL check and `verifyRegistrationResponse` call are untouched, and no flag/config/opt-in keeps the old branch reachable |
| 3. Steps 4 and 5 | `UPGRADE_NOTES.md` entry below (client + operator actions); this spec's § Migration & Backward Compatibility |
| 4. Dated entry | Added to `BACKWARD_COMPATIBILITY.md` in the same PR |
| 5. Maintainer sign-off | PR carries the `security` label; waiver called out explicitly in the PR body for a human maintainer to approve by name, same as #3852 |

### Broken surface

| Surface | Change | Classification |
|---------|--------|----------------|
| API request shape (`PUT /api/security/mfa/provider/{providername}`, `methodType: 'passkey'`) | `payload` must be `{ response }` (or `{ response, label }`) carrying a WebAuthn registration response. The `{ credentialId, publicKey, challenge, transports?, label? }` alternative is removed and now fails schema validation (`400`) | ✗ BREAKING (deliberate — see rationale) |
| Method selection (`MfaVerificationService.findMethod`) | Deterministic `orderBy: createdAt ASC` when more than one active method of a type exists | ✓ Strictly safer; only resolves previously-undefined behavior |
| API route URLs, HTTP methods, response schemas, database schema, event IDs, ACL features, DI names, CLI commands | No change | ✓ n/a |

### Client migration

Send the object returned by `@simplewebauthn/browser`'s `startRegistration()` as `payload.response`, exactly as the existing verify-side migration already documents for `startAuthentication()`. The first-party passkey setup UI already does this — shipped UIs need no change. A client that submitted `{ credentialId, publicKey, challenge }` was, by construction, not performing a real registration ceremony.

### Operator migration

This closes the warning #5291's `UPGRADE_NOTES.md` entry left open ("Action for operators — read this before upgrading... tracked as #5296; this release does not close it"). After this change ships:

- **No new unattested passkey can be enrolled**, closing the forgery path for future enrollments.
- **Rows enrolled before this fix ships are unaffected by it** — this change does not retroactively invalidate stored credentials, and (as the #5291 notes already state) such a row cannot be distinguished from a genuine one by shape alone. The existing guidance stands: audit `user_mfa_methods WHERE type = 'passkey'`, and reset-and-re-enroll on any deployment that ever accepted passkey enrollment through the API before this release.
- Operators who have not yet acted on the #5291 warning should treat this release as the point past which the exposure window is closed for new enrollments, and prioritize the reset/re-enroll cleanup for anything enrolled earlier.

## Risks & Impact Review

| Risk | Failure scenario | Severity | Mitigation | Residual |
|------|------------------|----------|------------|----------|
| Narrowing overshoots and refuses genuine enrollments | Every new passkey setup fails | Critical | `PasskeyProvider.test.ts` proves the `{ response }` path is untouched; the removed branch is exercised only by the deleted union member | Low |
| Fixture migration diverges from what a real enrollment stores | `TC-SEC-004` or other consumers of `enrollPasskey` start failing or silently testing the wrong shape | Medium | The direct-insert fixture mirrors the exact `providerMetadata` keys `confirmSetup`'s `{ response }` branch returns; `TC-SEC-004` re-run without assertion changes as acceptance evidence | Low |
| A pre-existing forged row (enrolled before this fix) still authenticates | Account holding a shortcut-enrolled credential remains at risk until reset | High | Documented in `UPGRADE_NOTES.md`, unchanged from #5291's existing guidance — this fix stops new forgeries, it does not retroactively clean old ones | Medium until operators complete reset/re-enroll |
| `findMethod` ordering change affects an unrelated caller expecting DB-default order | None identified — the method resolves to the same single row in the overwhelmingly common case (one active method per type), and the previous behavior was already undefined, not depended-upon | Low | Regression test asserts the tiebreak explicitly | Low |
| No integration happy-path coverage for the enrollment ceremony itself | A future regression in the `{ response }` enrollment path is caught only by the mocked unit suite | Medium | Tracked as #5307 (already open for the identical verify-side gap); mocked unit suite still exercises schema + branch selection | Medium, unchanged from the sibling fix's accepted residual |

## Open Questions

_None blocking._ The one genuine open question from the issue — whether `mfa_pending` sessions can reach the enrollment route — is resolved by the Reachability Correction above: they cannot, as of issue #5212 (2026-08-24), independent of this change.

## Changelog

- 2026-09-29 — Initial spec, written from issue #5296 and the implementation on `fix/issue-5296-passkey-enrollment-attestation`. Corrects the issue's reachability analysis against the since-landed central MFA-pending gate (#5212), scopes the fix to the still-open attestation gap, and records the Emergency Security Exception classification, client/operator migration, and the #5307 test-coverage boundary.
- 2026-09-30 — Addressed @wojciechszyjka's review of PR #6710: merged `develop` to resolve a `UPGRADE_NOTES.md` conflict; fixed the rejected-legacy-payload response (`MfaService.confirmMethod` now maps a provider `ZodError` to `400`, matching what `BACKWARD_COMPATIBILITY.md`/`UPGRADE_NOTES.md` already documented — it previously fell through to a generic `500`); corrected the "unreachable through normal enrollment" wording for multiple active passkeys, which is the ordinary case (`allowMultiple = true`), and filed the resulting `prepareChallenge` single-credential limitation as an explicit out-of-scope note rather than leaving it implied.
