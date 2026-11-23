# Execution plan — fail-closed MFA challenge creation on login

## Goal

Close the fail-open in the enterprise login MFA interceptor: when
`mfaVerificationService.createChallenge()` rejects for an account that requires
MFA, the `auth/login` route must never return the already-issued full staff JWT
or refresh token. Distinguish a genuine "no MFA methods configured" account
(login may proceed) from a challenge-creation or service-resolution failure
(login must be denied and the provisional session revoked).

## Source doc

Confidential vulnerability report (CWE-287, provisional CVSS 6.8) against
`packages/enterprise/src/modules/security/api/interceptors.ts` — private report,
not committed. Related spec: `.ai/specs/enterprise/implemented/SPEC-ENT-007-2026-03-06-auth-login-interceptors-extension.md`.

## Scope

- `packages/enterprise/src/modules/security/api/interceptors.ts` — MFA login after-interceptor.
- `packages/enterprise/src/modules/security/services/MfaVerificationService.ts` — tag the "no methods" error.
- `packages/enterprise/src/modules/security/lib/` — shared error-code constant.
- `packages/core/src/modules/auth/api/login.ts` — revoke the provisional session when the after-interceptor fails.
- Unit tests for both the interceptor and the login route.

## Non-goals

- Reworking the core login flow to defer session creation until MFA completes
  (larger architectural change; the minimal fail-closed + revocation fix closes
  the reported exposure).
- Changing MFA enrollment / enforcement policy behavior for users with zero
  methods (they still log in and get prompted to enroll).
- Touching unrelated auth, sudo, or MFA modules.

## Implementation Plan

### Phase 1: Fail-closed MFA challenge handling

- 1.1 Add a typed `MFA_NO_METHODS_CONFIGURED` error code constant and tag the
  `MfaVerificationService` "No MFA methods configured" error with it.
- 1.2 In the login MFA after-interceptor, only no-op for a genuine no-MFA
  account; throw on any other `createChallenge` failure or when the MFA service
  cannot be resolved, so the runner returns a failure and the route emits no token.
  Keep the emergency-bypass escape hatch working before service resolution.
- 1.3 In the core `auth/login` route, revoke the just-created session when the
  after-interceptor reports failure, before returning the error response.

### Phase 2: Regression coverage

- 2.1 Update the enterprise interceptor unit tests: challenge failure fails
  closed, no-MFA account stays a no-op, unavailable service fails closed, bypass
  still allows with a warning.
- 2.2 Add core login regression tests: an interceptor failure returns a non-200
  without an access/refresh token or auth cookie and revokes the session, for both
  `remember=true` and `remember=false`.

### Phase 3: Validation

- 3.1 Run the targeted Jest suites for both packages and typecheck the changed packages.
- 3.2 Run the configured validation gate and record any limits in the PR body.

## Risks

- Failing closed when the MFA verification service cannot be resolved could deny
  logins in a misconfigured deployment. Mitigation: the enterprise DI always
  registers the service, and the emergency bypass is checked first so operators
  keep an escape hatch.
- Relying on `createChallenge` throwing for the no-MFA case is existing behavior;
  the new error code makes the distinction explicit without changing the throw.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fail-closed MFA challenge handling

- [x] 1.1 Add a typed `MFA_NO_METHODS_CONFIGURED` error code constant and tag the service error — 1650720d07
- [x] 1.2 Fail closed in the login MFA after-interceptor on unexpected challenge failures — aa0346bee0
- [x] 1.3 Revoke the provisional session when the login after-interceptor fails — 2002b3cffa

### Phase 2: Regression coverage

- [x] 2.1 Update the enterprise interceptor unit tests — 2cd56abfcf
- [x] 2.2 Add core login regression tests for the fail-closed response — 6897d02e63

### Phase 3: Validation

- [x] 3.1 Run targeted tests and typecheck — interceptor (9), login (19), MfaVerificationService + challenge route (30) pass; enterprise + core `tsc --noEmit` pass
- [x] 3.2 Run the configured validation gate and record limits — `build:packages`, `generate`, `build:packages`, `i18n:check-sync`, `i18n:check-usage` (advisory), `typecheck`, `test` (51/51 tasks), `build:app` all pass
