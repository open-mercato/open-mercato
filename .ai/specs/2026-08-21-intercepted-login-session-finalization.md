# Intercepted Login Session Finalization

**Status:** Implemented
**Date:** 2026-08-21
**Work item:** OM-SEC-003
**Package:** `@open-mercato/core`

## TLDR

The password login route must treat the result of registered after-interceptors as the final authentication decision. If interception fails, rejects the login, or replaces the response without an explicit token, Core deletes the newly created session and sends no authentication cookies. Enterprise policy remains outside MIT Core.

## Overview

Custom route interceptors can add an authentication step after password verification. Core currently creates a session before those interceptors run, then falls back to its original full-access token when the replacement response has no token. That behavior makes a fail-closed Enterprise policy impossible.

The change is deliberately generic. It does not know about SSO, MFA, providers, or commercial modules. It only finalizes the session according to the final intercepted response.

## Problem Statement

Three failure paths currently leave an issued session or full-access cookie:

1. An after-interceptor throws after Core creates the session.
2. An interceptor returns a policy denial body such as `{ ok: false }`.
3. An interceptor replaces a successful response but omits `token`, after which Core silently uses the original token.

The caller must never receive credentials that contradict the final authentication response.

## Proposed Solution

- Keep password verification, user lookup, role lookup, and session creation unchanged.
- Run registered after-interceptors as today.
- Delete the newly created session when interceptor execution fails.
- Treat a final response as credential-bearing only when `body.ok === true` and `body.token` is a non-empty string.
- Delete the newly created session and return the final body without cookies for every other result.
- Preserve the current success path, including support for an interceptor-supplied token.

### Market Reference

The design follows the same principle as a transient authentication session: an incomplete authentication flow must not become an application session. Keycloak documents transient and multi-step authentication sessions separately from completed user sessions in its [Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/).

## Architecture

```text
password accepted
      |
create bounded database session
      |
run after-interceptors
      |
      +-- execution failure --------------------+
      |                                         |
      +-- final body is not ok -----------------+--> delete session --> return without cookies
      |                                         |
      +-- final body has no explicit token -----+
      |
      +-- ok + explicit token --> issue cookies --> return
```

Core owns session creation and cleanup. Optional modules own their policy interceptors. No Core import or registration points at Enterprise.

## Data Models

No schema change. The existing `auth:session` record is deleted through `AuthService.deleteSessionById` when the login is not finalized.

## API Contracts

### `POST /api/auth/login`

The public route and existing request schema remain unchanged.

- Successful final response: `body.ok === true` and an explicit non-empty `body.token`; Core sets `auth_token` and the applicable refresh cookie.
- Rejected final response: Core returns the interceptor body and status but sets no authentication cookies.
- Malformed successful final response without an explicit token: Core returns the existing generic login error with HTTP 500 and sets no authentication cookies.
- Interceptor execution failure: Core returns the existing interceptor error response after deleting the session.

This is a behavioral correction within the existing additive interceptor contract. It does not add or remove request or response fields.

## Internationalization

N/A. Core does not add policy-specific user-facing text.

## UI/UX

N/A. Existing login UI continues to render the returned response.

## Migration & Compatibility

- No database migration.
- No route, method, field, event, DI key, or import-path change.
- An interceptor that intentionally replaces a successful login response must already return its own token. Falling back to the original token is removed because it defeats the replacement decision.

## Implementation Plan

### Phase 1: Finalization helper

1. Add a narrow cleanup path in `auth/api/login.ts`.
2. Require a successful final body and explicit token before setting cookies.
3. Reuse `AuthService.deleteSessionById` for rejected and failed interception.

### Phase 2: Regression tests

1. Prove a successful replacement token is still issued.
2. Prove a replacement denial receives no cookies and deletes the session.
3. Prove interceptor execution failure receives no cookies and deletes the session.
4. Prove a successful replacement without a token is rejected and cleaned up.

## Risks & Impact Review

#### Session cleanup fails
- **Scenario**: The database becomes unavailable while Core deletes a session after policy rejection.
- **Severity**: High
- **Affected area**: Password login and session storage
- **Mitigation**: Await cleanup and return no cookies regardless. The unexposed session identifier and refresh token cannot be used by the caller.
- **Residual risk**: A stale database row may remain until normal expiry or operational cleanup.

#### Existing interceptor relies on implicit token fallback
- **Scenario**: A custom module replaces an `ok: true` response without returning a token and previously received the original Core token.
- **Severity**: Medium
- **Affected area**: Third-party custom login interceptors
- **Mitigation**: Preserve merge behavior, where the original token remains in the merged body. Require explicit token only for replacement responses.
- **Residual risk**: An incorrectly implemented replacement interceptor will fail closed and must be corrected.

#### Policy rejection is returned with the interceptor status
- **Scenario**: The existing interceptor contract cannot independently replace both body and status.
- **Severity**: Low
- **Affected area**: HTTP semantics for policy denial
- **Mitigation**: Preserve the stable interceptor contract in this point. The response body remains authoritative and no credentials are issued.
- **Residual risk**: Some clients may receive HTTP 200 with `{ ok: false }` until a separately approved additive status override is introduced.

## Final Compliance Report — 2026-08-21

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/auth/AGENTS.md`
- `packages/shared/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root `AGENTS.md` | Keep Enterprise behavior out of OSS | Compliant | Core only finalizes a generic intercepted login. |
| auth `AGENTS.md` | Ask before changing session-token behavior | Compliant | The user approved explicit token finalization and pending-token isolation. |
| auth `AGENTS.md` | Never log credentials or tokens | Compliant | No token or request-body logging is added. |
| `BACKWARD_COMPATIBILITY.md` | Preserve stable route and response fields | Compliant | Route and schemas are unchanged. |
| root `AGENTS.md` | Preserve optional-module isolation | Compliant | Core imports no Enterprise code. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | No model or API field changes. |
| API contracts match UI/UX section | Pass | Existing login UI remains the consumer. |
| Risks cover all write operations | Pass | Session creation and cleanup are covered. |
| Commands defined for all mutations | N/A | Existing authentication session service owns this internal write. |
| Cache strategy covers all read APIs | N/A | No new read or cache surface. |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: Implemented and verified with focused automated coverage.**

## Changelog

### 2026-08-21

- Initial specification after approval of the Core and Enterprise split.
- **Review**: Security passed; performance passed; cache N/A; commands N/A; risks passed; verdict approved.
- Implemented fail-closed intercepted-login finalization, rejected-session cleanup, explicit replacement-token handling, and regression tests.
- **Verification**: 26 focused Core tests passed; package builds, lint, and `git diff --check` passed.
