# SPEC-ENT-007: Auth Login Interceptors as External Extension (MFA Challenge Gate)

## TLDR
Introduce MFA login gating as an **external extension** using existing UMES/API extension points, without modifying `packages/core`, `packages/ui`, or `packages/shared`.
The extension intercepts `POST /api/auth/login`, rewrites successful login responses to `mfa_required`, and swaps login UI to a challenge panel via component wrapper.
This spec is additive-only and includes explicit backward-compatibility and migration requirements.

## Overview
This specification extracts the auth-login interceptor behavior into a dedicated extension implementation path and contract. It is intentionally scoped to extension mode (app module / external package) to preserve platform upgradeability and avoid direct core modifications.

## Problem Statement
Current MFA onboarding relies on login response transformation and UI takeover. Without a formal extension-focused spec, implementation drifts toward ad-hoc platform edits, inconsistent contracts, and BC risk (especially around login response/cookie behavior).

We need a concrete spec that:
- Uses only extension surfaces
- Defines prerequisites and compatibility boundaries
- Defines response/cookie semantics for `mfa_required` branch
- Includes explicit integration coverage for auth login interception

## Proposed Solution
Build an extension module `auth_extensions` (app-level or standalone package) that provides:
1. API `after` interceptor for `auth/login`
2. Login-form component wrapper for `section:auth.login.form`
3. Event-driven UI handoff via `om:auth:login-response`
4. Strict fail-closed behavior (interceptor failures do not block standard login)

Scope choice for this spec: **external extension only**.
- Preferred location: `apps/mercato/src/modules/auth_extensions/`
- Optional packaged form: `packages/<vendor>/src/modules/auth_extensions/`

## Architecture
### Components
- `api/interceptors.ts` in extension module:
  - `targetRoute: 'auth/login'`
  - `methods: ['POST']`
  - `after(...)` rewrites successful response to MFA pending payload
- `widgets/components.ts` in extension module:
  - wrapper override for `section:auth.login.form`
  - listens to `om:auth:login-response`
  - renders MFA challenge panel when `mfa_required === true`

### Data Flow
1. User submits login form to `POST /api/auth/login`.
2. Auth endpoint returns standard success payload.
3. Extension interceptor checks MFA eligibility and rewrites response:
   - `{ ok: true, mfa_required: true, challenge_id, available_methods, token }`
4. Client emits/receives `om:auth:login-response` and wrapper displays challenge UI.
5. User verifies challenge on `/api/security/mfa/verify`.
6. Full session JWT/cookie is issued only after successful verification.

### Prerequisites (Must Exist)
- API dispatcher executes registered `after` interceptors for custom API routes, including `auth/login`.
- Login page exposes replacement handle `section:auth.login.form`.
- Login page dispatches DOM event `om:auth:login-response` with response detail.

If any prerequisite is absent, this extension spec is blocked until prerequisite spec is completed.

## Data Models
No new database tables in this spec.
Uses existing security entities from enterprise MFA module (`mfa_challenges`, `user_mfa_methods`, etc.).

## API Contracts
### Intercepted Endpoint
- `POST /api/auth/login` (existing)

### Success Branches
- Standard success (no MFA required):
  - existing response contract preserved
- MFA-required success (extension branch):
  - `ok: true`
  - `mfa_required: true`
  - `challenge_id: string`
  - `available_methods: Array<{ type: string; label: string; icon: string }>`
  - `token: string` (short-lived pending token)
  - `redirect` may be omitted or `null`

### Cookie Contract
- For MFA-required branch, auth cookie must represent pending state, not full-access state.
- If platform currently sets full `auth_token` before interception, dispatcher must support cookie overwrite aligned to rewritten token.
- This spec does not define new cookie names; it aligns existing `auth_token` semantics to pending-token branch.

## UI/UX
- Wrapper target: `section:auth.login.form`
- Event consumed: `om:auth:login-response`
- Challenge UI:
  - method list from `available_methods`
  - back action returns to login form
  - keyboard support for dialogs: `Cmd/Ctrl+Enter` submit, `Escape` cancel
- All buttons must use `Button`/`IconButton`
- API calls from UI must use `apiCall`/`apiCallOrThrow`

## Risks & Impact Review
### Incorrect cookie/session branch (High)
- Impact: user gets logged in without MFA challenge.
- Mitigation: add explicit integration assertions for response body + cookie value alignment.

### Interceptor not executed for custom routes (High)
- Impact: MFA branch never triggers.
- Mitigation: prerequisite gate + integration test proving interceptor execution for `auth/login`.

### Contract drift in feature/event IDs (Medium)
- Impact: ACL/subscriber mismatches.
- Mitigation: freeze canonical IDs in this spec and ENT-001 alignment patch.

### UI override unavailable in login tree (Medium)
- Impact: response rewritten but no challenge UI rendered.
- Mitigation: provider registration test in frontend route tree and wrapper smoke tests.

## Migration & Backward Compatibility
This section is mandatory for contract-surface changes.

### Affected Surfaces
- API route behavior (`POST /api/auth/login`) additive branch
- Component replacement handle usage (`section:auth.login.form`)
- DOM login response event (`om:auth:login-response`)

### Compatibility Rules
1. Do not remove or rename existing login endpoint.
2. Keep standard successful branch unchanged for non-MFA users.
3. MFA branch is additive and must be documented for clients.
4. Do not rename frozen handle/event IDs.
5. Any future event/field renames require deprecation bridge and release notes.

### Consumer Migration
- API consumers must handle `mfa_required: true` branch on login success.
- UI consumers may continue existing flow if they do not enable this extension module.

## Implementation Plan
### Phase 1 — Extension Scaffolding
- Create `apps/mercato/src/modules/auth_extensions/`.
- Add `index.ts` metadata and optional `acl.ts`.
- Register module in `apps/mercato/src/modules.ts`.

### Phase 2 — Auth Login Interceptor
- Implement `api/interceptors.ts` with `security.auth.login.mfa-challenge` (or extension-specific id).
- Fail-closed behavior: return `{}` on errors.
- Add unit tests for rewrite/no-op/error branches.

### Phase 3 — Login Wrapper UI
- Implement `widgets/components.ts` wrapper for `section:auth.login.form`.
- Parse `om:auth:login-response` payload and render challenge panel.
- Add unit tests for payload parsing and wrapper state transitions.

### Phase 4 — Integration Verification
- Add end-to-end integration tests for:
  - login with MFA-enabled user
  - login with non-MFA user
  - invalid challenge and retry
  - cookie/token alignment in MFA branch

## Integration Test Coverage
### API Paths
- `POST /api/auth/login`
- `POST /api/security/mfa/verify`
- `POST /api/security/mfa/recovery` (if enabled)

### UI Paths
- `/login` standard flow
- `/login` MFA-required challenge flow

### Required Cases
1. Interceptor executes for `auth/login` and rewrites response.
2. Wrapper displays challenge panel on `mfa_required` payload.
3. Pending token does not grant backend access before verification.
4. After verify, full access is granted.

## Final Compliance Report
### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md` (API interceptors + component replacement conventions)
- `packages/ui/AGENTS.md` (UI primitives and form rules)
- `packages/shared/AGENTS.md` (shared contract and typing constraints)
- `.ai/specs/AGENTS.md` (spec format and BC section requirement)

### Compliance Matrix
- No direct core package modifications required by this spec: PASS
- Uses extension points (`api/interceptors.ts`, `widgets/components.ts`): PASS
- Includes BC migration section: PASS
- Includes integration API/UI coverage: PASS

### Verdict
Ready for implementation in external-extension mode, contingent on prerequisites.

## Changelog
### 2026-03-06
- Initial draft for extension-only auth login interceptor specification.

## Implementation Status
| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Extension Scaffolding | Not Started | — | — |
| Phase 2 — Auth Login Interceptor | Not Started | — | — |
| Phase 3 — Login Wrapper UI | Not Started | — | — |
| Phase 4 — Integration Verification | Not Started | — | — |

## Amendment 2026-08-21 — Central MFA-Pending Token Gate (issue #5212)

The interceptor's provisional token (`mfa_pending: true`, `mfa_verified: false`) was
accepted by every staff API because the canonical auth resolvers never inspected the
assurance claims. This amendment defines the platform-wide gate that rejects pending
credentials everywhere except registered MFA completion routes.

### Contract

- `isMfaPendingJwtPayload(payload)` — `packages/shared/src/lib/auth/jwt.ts`. True iff
  `mfa_pending === true && mfa_verified !== true`.
- Pending-access allowlist — `packages/shared/src/lib/auth/mfaPendingAccess.ts`
  (generic infrastructure): `registerMfaPendingAccessRoutes(routes)` (additive, idempotent,
  methods merge per path), `isMfaPendingAccessAllowed(method, pathname)` (fail-closed:
  exact path + exact method, trailing-slash tolerant, case-insensitive), and
  `listMfaPendingAccessRoutes()` for tests/ops. The registry ships **empty**.
- Enforcement point — `resolveAuthFromRequestDetailed` / `resolveAuthFromCookiesDetailed`
  in `packages/shared/src/lib/auth/server.ts`: pending payloads resolve to
  `{ auth: null, status: 'invalid' }` unless the request matches a registered completion
  route; cookie/RSC resolution rejects pending tokens unconditionally.

### Ownership boundary

- `packages/shared` owns only the generic registry and predicate. It contains no route
  defaults and no knowledge of any concrete MFA implementation.
- The enterprise `security` module owns the canonical `/api/security/mfa/{prepare,verify,recovery}`
  routes and registers them via `lib/mfaCompletionRoutes.ts`, imported by the module entry
  (`index.ts`) and by the completion routes' shared helper, so registration always precedes
  request authentication.
- Third-party MFA implementations register their own completion routes during their module
  bootstrap through the same additive API.

### Migration & Backward Compatibility

| Surface | Classification | Notes |
|---|---|---|
| `registerMfaPendingAccessRoutes` / `isMfaPendingAccessAllowed` / `listMfaPendingAccessRoutes` / `isMfaPendingJwtPayload` | ADDITIVE-ONLY | New exports; signatures frozen as shipped here. Future evolution must keep existing call sites working or follow the deprecation protocol (§27). |
| Registry default set | CHANGED (security-narrowing) | Pre-amendment builds effectively allowed the provisional token everywhere; the fix intentionally narrows pending tokens to registered completion routes. No stable contract is removed — pending tokens were never documented as general credentials. |
| Login/MFA endpoint URLs, methods, request/response shapes | UNCHANGED | Completion endpoints keep requiring `auth.mfa_pending === true`; verified replacement tokens and non-MFA logins behave exactly as before. |
| Third-party MFA modules | MIGRATION REQUIRED (one line) | Any implementation that completes challenges on its own endpoints must call `registerMfaPendingAccessRoutes` during bootstrap; without it its completion routes reject pending tokens (fail-closed). |

### Integration coverage

| Path | Case | Suite |
|---|---|---|
| `POST /api/auth/login` → pending token issued | interceptor flow unchanged | `TC-SEC-002`, `TC-SEC-014` |
| `GET /api/auth/profile` with pending bearer/cookie | 401 + `auth_token`/`session_token` cleared | `TC-SEC-014` |
| `POST /api/security/mfa/recovery-codes/regenerate` with pending token | 401 (mutation blocked pre-second-factor) | `TC-SEC-014` |
| `POST /api/security/mfa/prepare` / `verify` with pending token | reachable, contracts unchanged | `TC-SEC-014` |
| Verified replacement token | normal read + mutation access restored | `TC-SEC-014` |
| Failed-challenge cleanup / attempt exhaustion | correct code rejected after lockout; fresh challenge works | `TC-SEC-014`; TTL expiry at service level in `MfaVerificationService.test.ts` |
