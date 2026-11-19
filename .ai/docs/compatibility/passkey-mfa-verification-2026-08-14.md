# Passkey MFA Verification Payload (2026-08-14)

Issue #3852 removed the non-cryptographic passkey verification shape from `PasskeyProvider` in the enterprise `security` module. This is a **deliberate breaking change to a STABLE contract surface (category 7, API request shapes)** that ships under the [Emergency Security Exception](../../../BACKWARD_COMPATIBILITY.md#emergency-security-exception) rather than the ordinary deprecation protocol.

**Classification.** The removed shape was a *publicly supported* surface, not an undocumented accident: it was part of the exported `MfaProviderInterface.verifySchema` union that a third-party client could validate against, and the enterprise test suite pinned it in a case named *"supports legacy verification payload for backward compatibility"*. It is therefore a genuine STABLE-surface break, and the exception — not a claim that no contract existed — is what authorizes it.

**Exception requirements, as met by this change:**

|Requirement|How it is satisfied|
|---|---|
|1. Qualifying condition argued|See *Why the deprecation protocol does not apply* below — both values the removed shape compared are disclosed by the server, so accepting it *is* the bypass|
|2. Narrowest removal, no retained vulnerable branch|Only `verifyPayloadSchema` and the two non-cryptographic acceptance paths are deleted. The `{ response }` path, the challenge TTL check and the signature-counter update are untouched, and **no flag, config toggle or opt-in keeps the old shape reachable**|
|3. Steps 4 and 5|[`UPGRADE_NOTES.md`](../../../UPGRADE_NOTES.md) `0.6.7 → 0.7.0` (client *and* operator actions); spec [`.ai/specs/enterprise/2026-08-14-passkey-mfa-require-webauthn-assertion.md`](../../specs/enterprise/2026-08-14-passkey-mfa-require-webauthn-assertion.md) § Migration & Backward Compatibility|
|4. Dated entry|This section|
|5. Maintainer sign-off|PR carries the `security` label; the waiver is called out in the PR body for explicit human approval|

|Surface|Change|Classification|
|---|---|---|
|API request shape (`POST /api/security/mfa/verify`, `POST /api/security/sudo/verify`, `methodType: 'passkey'`)|`payload` must be `{ response }` carrying a WebAuthn assertion. The `{ credentialId, challenge }` alternative is removed and now answers `401`|✗ BREAKING (deliberate — see rationale)|
|Provider contract (`MfaProviderInterface.verifySchema` for `passkey`)|`verifyPayloadSchema` narrows from a union to a single object requiring `response`|✗ BREAKING for a caller that validated against the exported schema|
|Verification behavior|A verified `verifyAuthenticationResponse` is the only route to a positive verdict; an absent verify context is a rejection rather than a `credentialId` comparison|✗ BREAKING for a client that skipped `/api/security/mfa/prepare`|
|Failure mode|A payload that fails the schema, and an assertion the verifier throws on, return `false` instead of throwing — so they answer the documented `401` and count toward the challenge attempt limit instead of logging a `500` that skipped lockout|✓ Strictly safer (no verdict flips from negative to positive)|
|API route URLs, HTTP methods, response schemas, database schema, event IDs, ACL features, DI names, CLI commands|No change|✓ n/a|

**Why the deprecation protocol does not apply.** The protocol exists to give downstream authors a bridge release. Here the request shape being removed *is* the vulnerability: both values it compared are disclosed by the server, so a bridge would keep the passkey second factor bypassable for a minor version in both login MFA and sudo step-up. A security fix that leaves the hole open is not a fix.

**Migration path.** Send `startAuthentication()` output as `payload.response`. The first-party `PasskeyChallengeVerify` component already does, so shipped UIs are unaffected. Credentials enrolled through the setup path's client-supplied `publicKey` shortcut are **not** reliably rendered unusable by this change — depending on what the client supplied, such a row holds either a key nobody can sign with or a keypair the enroller controls, and the second kind produces assertions this change accepts. That shortcut is a separate open surface (#5296); operator-facing remediation is in [`UPGRADE_NOTES.md`](../../../UPGRADE_NOTES.md).
