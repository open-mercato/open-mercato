# Integration Auth Login Redirect Loop

| Field | Value |
|-------|-------|
| Status | Draft, reviewed 2026-07-07 |
| Scope | OSS |
| Owner | Core Auth / Integration Testing / CLI |
| Related Guides | `AGENTS.md`, `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`, `packages/core/AGENTS.md`, `packages/core/src/modules/auth/AGENTS.md`, `packages/shared/AGENTS.md`, `packages/cli/AGENTS.md` |
| Related Specs | `.ai/specs/implemented/SPEC-027-2026-02-08-integration-testing-automation.md`, `.ai/specs/2026-03-25-coherent-access-denied-ux.md`, `.ai/specs/2026-05-27-acl-dependency-bundles.md`, `.ai/specs/enterprise/implemented/SPEC-ENT-007-2026-03-06-auth-login-interceptors-extension.md` |

## TLDR
**Key Points:**
- Fix a baseline integration-test blocker where the shared Playwright `login(page, 'admin')` helper can enter an infinite `/backend -> /api/auth/session/refresh?redirect=/backend -> /backend` loop.
- The failure was reproduced in a standalone TraceCore app on a clean `origin/main` baseline, using an unrelated warehouse browser spec, so this is an Open Mercato integration auth/session reliability issue rather than an application feature regression.
- This is a 401/missing-or-invalid-cookie session-refresh loop, not the earlier 403 access-denied/login loop covered by the coherent access-denied UX and ACL dependency specs.

**Scope:**
- Add a deterministic regression covering the browser `/backend` cookie flow used by `@open-mercato/core/helpers/integration/auth`.
- Fix the smallest verified root cause in the shared helper and/or staff session refresh path.
- Improve integration readiness diagnostics so API-token readiness cannot hide browser/SSR auth failures.

**MVP Boundary:**
- Ship one auth integration regression, one smallest verified helper/session fix, and one bounded cookie-backed readiness probe.
- Defer broader create-app smoke automation, new auth UX, and auth model redesign unless implementation evidence proves they are required.

**Concerns:**
- Auth/session behavior is a high-risk contract surface. The fix must preserve login, session refresh, MFA/interceptor compatibility, session revocation, tenant scoping, and standalone-app parity.
- Implementation must prove the failing boundary before changing auth runtime code; "make the loop disappear" is not enough if it weakens canonical staff-session validation.

## Overview
The ephemeral integration runner currently proves that `/api/auth/login` returns a JWT and that a Bearer-token API call works. That is not enough for browser tests: UI specs authenticate through `login(page, role)`, then load server-rendered backend pages that call `getAuthFromCookies()` and may redirect to `/api/auth/session/refresh`.

In TraceCore, a clean baseline run of an unrelated warehouse spec on `origin/main` reproduced:

```text
page.goto: net::ERR_TOO_MANY_REDIRECTS at http://127.0.0.1:55362/backend
at login (.../node_modules/@open-mercato/core/src/helpers/integration/auth.ts:193:16)
```

The redirect chain is:

```text
/backend
  -> /api/auth/session/refresh?redirect=/backend
  -> /backend
  -> /api/auth/session/refresh?redirect=/backend
```

**Market Reference:** Playwright's documented authentication setup pattern recommends a single deterministic authentication fixture that stores validated browser context state and fails early when the authenticated landing page is not reachable. This spec adopts the deterministic "auth setup must prove the protected page loaded" principle and rejects per-spec local login workarounds because they fragment the platform contract.

**Related-spec boundary:** `.ai/specs/2026-03-25-coherent-access-denied-ux.md` establishes that 403 means authenticated-but-not-authorized and must not trigger a login redirect. This spec addresses a different failure class: `/backend` cannot establish a valid staff auth context at all, so the protected route attempts 401-style session refresh and loops. The implementation must keep that distinction intact.

## Problem Statement
The shared integration helper can report an authentication setup failure only after Playwright hits `ERR_TOO_MANY_REDIRECTS` during `page.goto('/backend')`. At that point the failing product spec receives a generic browser navigation error, not an actionable auth diagnostic.

Observed facts from the TraceCore baseline:
- `yarn test:integration:ephemeral --no-reuse-env --force-rebuild --filter src/modules/warehouse_operations/__integration__/TC-WAREHOUSE-COMPONENT-ORDERS-002.spec.ts` failed on a clean `origin/main` checkout.
- The failure occurs before the warehouse workflow starts, at `login(page, 'admin')`.
- The ephemeral readiness probe had already passed because API login plus Bearer-token API access worked.
- Backend SSR still treated the browser request as unauthenticated or invalid and redirected to `session/refresh`.
- Refresh redirected back to `/backend`, but the next `/backend` request still failed `getAuthFromCookies()`.

This makes unrelated app PRs appear blocked by their own changes when the baseline platform auth harness is already broken.

### Non-Goals
- Do not redesign the staff auth model, JWT payload shape, cookie names, or session token format.
- Do not replace `login(page, role)` with per-spec UI login flows.
- Do not alter 403/ACL challenge behavior from the coherent access-denied UX spec.
- Do not add product UI, new auth settings, or new persisted entities.

## Proposed Solution
Implement the fix in Open Mercato, not in downstream app specs:

1. Add a focused auth integration regression that uses the published helper path:
   `import { login } from '@open-mercato/core/helpers/integration/auth'`.
2. Make the regression assert that `await login(page, 'admin')` reaches a usable backend page without a session refresh loop.
3. Diagnose the first failing boundary with safe, non-secret instrumentation in tests:
   - API login response status.
   - Cookie names present in the Playwright browser context, never values.
   - `/backend` and `/api/auth/session/refresh` response statuses/locations.
   - Whether `resolveAuthFromCookiesDetailed()` classifies the token as `missing` or `invalid`, without logging token contents.
4. Apply the smallest verified fix:
   - If API request-context cookies are not reliably available to the browser context, bridge `auth_token` and `session_token` into `page.context().addCookies(...)` using response data and safe Set-Cookie parsing.
   - If `/api/auth/login` returns a token but does not set the expected browser cookies in the request context, keep the endpoint contract stable and fix cookie propagation without changing cookie names.
   - If refresh issues a JWT that `getAuthFromCookies()` rejects, align `AuthService.refreshFromSessionToken()` output with `resolveCanonicalStaffAuthContext()` requirements or redirect invalid refresh results to `/login` instead of `/backend`.
   - If both are true, fix both with separate commits and tests.
5. Extend CLI ephemeral readiness to include a browser-equivalent cookie-backed `/backend` probe so this failure is caught before unrelated specs run.

### Root-Cause Verification Gates
Before changing runtime auth code, the implementation must classify the failure into one or more of these boundaries:

| Boundary | Required evidence | Allowed fix |
|----------|-------------------|-------------|
| API login -> Playwright browser context | `POST /api/auth/login` succeeds, but browser context lacks `auth_token` and/or `session_token` cookie names before `page.goto('/backend')` | Improve the shared helper's cookie handoff using redacted Set-Cookie parsing or response-token fallback. |
| Browser refresh -> canonical staff auth | Refresh receives `session_token` and sets `auth_token`, but the next SSR auth resolution returns `invalid` | Fix refresh/session lookup so the emitted JWT satisfies `resolveCanonicalStaffAuthContext()`, or fail closed to `/login`. |
| Readiness blind spot | API Bearer probe passes while cookie-backed `/backend` probe loops | Add a bounded cookie-backed readiness probe that fails before Playwright specs start. |

The implementation must not relax `resolveCanonicalStaffAuthContext()` or treat an invalid staff session as authenticated. Any auth runtime edit must preserve existing `metadata` and `openApi` exports on modified API route files.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Fix upstream helper/session flow | The failure reproduces on clean app baseline and affects every module spec using the shared helper. |
| Keep app specs unchanged | Local wrappers would mask the platform defect and diverge standalone apps from monorepo behavior. |
| Add diagnostics without token values | Auth tests need actionable evidence without leaking credentials or session tokens. |
| Treat readiness as API + browser auth | Passing Bearer-token API auth is not equivalent to SSR cookie auth. |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Waive affected app integration specs | Leaves all browser specs using `login(page)` vulnerable and keeps future PRs noisy. |
| Replace login imports in TraceCore only | Works around one app while the published helper remains broken for other standalone apps. |
| Disable `/backend` refresh during tests | Masks a real staff-session boundary and weakens auth coverage. |

## User Stories / Use Cases
- **Framework maintainer** wants `login(page, 'admin')` to fail with an auth-specific diagnostic when browser cookies are invalid so that baseline failures are triaged quickly.
- **App developer** wants ephemeral integration tests to distinguish product regressions from shared auth harness failures so that unrelated feature PRs are not blocked incorrectly.
- **Standalone app author** wants the npm-published helper path to work in generated apps without local copies or forked login utilities.

## Architecture
The affected path spans the published helper, core auth endpoints, shared auth resolution, the backend route guard, and CLI readiness:

1. `packages/core/src/helpers/integration/auth.ts`
   - Fast path posts to `/api/auth/login` via `page.request`.
   - Adds selected tenant/org cookies from JWT claims.
   - Navigates to `/backend`.
2. `packages/core/src/modules/auth/api/login.ts`
   - Issues `auth_token` and `session_token` cookies.
   - Returns `token` and optional `refreshToken` in JSON.
3. `apps/mercato/src/app/(backend)/backend/page.tsx` and `packages/shared/src/lib/auth/server.ts`
   - Backend SSR calls `getAuthFromCookies()`.
   - `resolveAuthFromCookiesDetailed()` reports `missing`, `invalid`, or `authenticated`.
   - Invalid/missing auth redirects to `/api/auth/session/refresh?redirect=/backend`.
4. `packages/core/src/modules/auth/lib/sessionIntegrity.ts`
   - `resolveCanonicalStaffAuthContext()` remains the authority for staff JWT/session validity.
   - The fix must not bypass session revocation, soft-deleted user/role handling, tenant consistency, or organization consistency.
5. `packages/core/src/modules/auth/api/session/refresh.ts`
   - Reads `session_token`.
   - Issues a new `auth_token`.
   - Redirects back to the requested path.
6. `packages/cli/src/lib/testing/integration.ts`
   - Readiness currently verifies login API + Bearer API only.

### Runtime Flow
1. `login(page, 'admin')` posts credentials to `/api/auth/login` through Playwright's request context.
2. The auth endpoint returns the existing success payload and sets `auth_token` plus `session_token` cookies.
3. The helper derives tenant/org selection cookies from the returned JWT and navigates the page to `/backend`.
4. Backend SSR resolves `auth_token` through `getAuthFromCookies()`.
5. Missing/invalid staff auth redirects to browser session refresh.
6. Session refresh either emits a canonical staff `auth_token` and redirects to the sanitized target, or clears staff cookies and redirects to `/login?redirect=...`.

The regression passes only when step 4 reaches an authenticated backend state without requiring an unbounded refresh loop.

### Commands & Events
No new domain commands or events are proposed. This is test harness and auth runtime behavior.

Undo/rollback is N/A for domain state because no business entity mutation is introduced. The only existing write effects involved are staff session creation/refresh and browser cookie mutation; failure handling remains fail-closed through existing cookie clearing, login redirect, logout, and session revocation behavior.

### Frontend Architecture Contract
No new App Router pages, backend shell components, providers, or heavy client widgets are planned. If implementation evidence proves that `apps/mercato/src/app/(backend)/backend/page.tsx` or shared backend shell UI must change, the implementation PR must add a Frontend Architecture Contract before touching those files. For the current scoped design, this section is N/A.

## Data Models
No schema changes.

Existing records involved:
- `auth.sessions`: referenced by JWT `sid`; refresh and canonical auth must agree on the session/user binding.
- `auth.users`, `auth.user_roles`, `auth.role_acls`, `auth.user_acls`: canonical auth resolution must continue using encrypted reads and wildcard-aware role semantics.

No new PII or sensitive columns are introduced. Existing auth user queries must continue using `findWithDecryption` / `findOneWithDecryption`; no encryption map changes are required for this spec.

## API Contracts
No new public API endpoints.

Existing endpoint contracts must remain backward compatible:

All modified auth API route files must keep or update their existing `metadata` and `openApi` exports. No route URL, method, response field, cookie name, or import path may be removed or renamed.

### Staff Login
- `POST /api/auth/login`
- Existing response remains `{ ok: true, token, redirect, refreshToken? }`.
- Existing cookies remain:
  - `auth_token`: httpOnly, staff JWT.
  - `session_token`: httpOnly, refresh/session token.
- Validation continues through the existing `userLoginSchema`-based login parsing.
- Existing error statuses remain `400`, `401`, `403`, and `429` with no account-existence disclosure.
- Login interceptors remain compatible:
  - Standard login still sets a full-access `auth_token`.
  - An interceptor-produced pending-token branch must not receive a full `session_token` by accident.
  - The helper must treat pending/MFA responses as not-yet-authenticated rather than forging browser auth.

### Browser Session Refresh
- `GET /api/auth/session/refresh?redirect=/backend`
- Valid `session_token` must either:
  - set a valid `auth_token` and redirect to the sanitized target, or
  - clear staff auth cookies and redirect to `/login?redirect=...` when canonical auth cannot be satisfied.
- It must not redirect back to the protected page with a token that the next SSR request will reject.
- Existing open-redirect hardening via `sanitizeRedirectPath()` and `buildRequestOriginUrl()` must remain intact.
- Invalid/missing refresh cookies must continue clearing `auth_token` and `session_token`.

### API Session Refresh
- `POST /api/auth/session/refresh`
- Existing JSON response and errors remain unchanged.
- Existing zod request validation and refresh rate limits remain unchanged.

### Integration Readiness Probe
- No new public endpoint is added.
- `probeApplicationReadiness()` may add an internal HTTP probe that:
  - logs in with known ephemeral admin credentials,
  - carries cookie names/values only in process memory,
  - follows redirects manually with a bounded redirect count,
  - reports only statuses, locations, and cookie names,
  - fails readiness if `/backend` and `/api/auth/session/refresh` repeat.

### Security and Input Handling Invariants
- No new externally callable API route, request schema, or persisted query surface is introduced.
- Existing login and refresh zod validation, rate limits, account-existence non-disclosure, and ORM/service parameterization remain in force.
- Redirect input handling remains limited to the existing sanitized redirect path helpers; manual readiness redirects must reject cross-origin or protocol-relative locations.
- XSS and design-system UI requirements are N/A because no rendered product UI or user-provided HTML is added.

## Internationalization (i18n)
No user-facing UI strings are planned. If diagnostics are surfaced in browser pages later, they must use existing auth i18n patterns. Test failure messages may be plain English.

## UI/UX
No product UI changes.

Developer-facing UX change:
- Integration helper failures should identify the auth boundary that failed, for example:
  - API login failed with status `401`.
  - Browser context lacks `auth_token` after login.
  - `/backend` redirected repeatedly between `/backend` and `/api/auth/session/refresh`.
  - Refresh produced a cookie but SSR classified auth as invalid.

Diagnostics must list cookie names only, never values.

## Configuration
No new production configuration.

Optional test-only diagnostics may be gated by an env var such as `OM_INTEGRATION_AUTH_DEBUG=1`, but the regression should not require it.

## Performance, Cache & Scale
- No new list endpoint, search endpoint, database index, queue worker, or cache entry is introduced.
- Readiness adds at most one authenticated probe with bounded redirects and existing request timeout behavior.
- Cache invalidation is N/A because no cached read model or data write path is added.
- No N+1 or large-list behavior is introduced; auth/session lookups remain point reads through existing services.

## Migration & Compatibility
- No database migration.
- No breaking changes to endpoint URLs, response shapes, cookie names, import paths, or helper exports.
- The published helper import `@open-mercato/core/helpers/integration/auth` remains stable.
- Existing legacy monorepo helper imports may keep working through current re-exports, but new tests must use the npm-published helper path.
- `BACKWARD_COMPATIBILITY.md` applies because auth helper imports, auth API URLs, cookie names, API response fields, DI service names, and session semantics are contract surfaces.
- Standalone apps inherit the fix after package upgrade without changing their tests.

## Implementation Plan

### Phase 1: Reproduce and Pin the Failure
1. Add a focused integration spec under `packages/core/src/modules/auth/__integration__/`.
2. Import `login` from `@open-mercato/core/helpers/integration/auth`, not from the legacy monorepo helper path.
3. The test should call `await login(page, 'admin')`, assert the URL is `/backend`, and assert a backend shell landmark or dashboard content is visible.
4. Add a second assertion path that follows `/backend` redirects with a cookie jar at the HTTP level and fails with the exact redirect chain if it loops.
5. Capture redacted diagnostics on failure: login status, cookie names, backend/refresh status and `Location` headers, and `missing` vs `invalid` auth classification.
6. Verify the test fails on the current baseline before applying fixes.

### Phase 2: Fix the Verified Auth Boundary
1. If Playwright request cookies are not propagated, update `packages/core/src/helpers/integration/auth.ts` to safely mirror `auth_token`/`session_token` into the browser context.
2. If refresh can emit a non-canonical JWT, update `packages/core/src/modules/auth/api/session/refresh.ts` and/or `AuthService.refreshFromSessionToken()` so refresh either produces auth accepted by `resolveCanonicalStaffAuthContext()` or sends the browser to `/login`.
3. Preserve the existing fallback UI-login path in the helper and keep bounded retry-on-429 behavior.
4. Preserve login interceptors and MFA/pending-token behavior from the enterprise auth-login interceptor contract.
5. Add focused unit tests for any new helper utility that parses Set-Cookie headers, builds diagnostics, or detects redirect loops.
6. Ensure rate-limit retries remain bounded and do not hide persistent auth failures.

### Phase 3: Harden Ephemeral Readiness
1. Extend `probeApplicationReadiness()` in `packages/cli/src/lib/testing/integration.ts` with a cookie-backed `/backend` probe.
2. The probe should perform login, carry Set-Cookie values through a protected-page request, and detect repeated `/backend`/`session/refresh` redirects.
3. Keep readiness output concise and redacted; no cookie values, JWTs, refresh tokens, credentials, or Set-Cookie payloads.
4. Make readiness fail before Playwright starts when browser auth is broken.
5. Add CLI unit coverage for redirect-loop detection and redacted readiness detail formatting.

### Phase 4: Validation and Release Notes
1. Run targeted auth integration regression in ephemeral mode.
2. Run a representative non-auth browser spec that uses `login(page, 'admin')`.
3. Run package tests/builds for `@open-mercato/core` and `@open-mercato/cli`.
4. Run `yarn typecheck`.
5. Document the fix as integration-test/auth-harness reliability in release notes or changelog.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/auth/__integration__/TC-AUTH-053-login-helper-backend-cookie-flow.spec.ts` | Create | Regression for `login(page)` reaching `/backend` without redirect loop. |
| `packages/core/src/helpers/integration/auth.ts` | Modify if proven | Stabilize API-login-to-browser-cookie handoff and improve diagnostics. |
| `packages/core/src/modules/auth/api/session/refresh.ts` | Modify if proven | Prevent refresh from redirecting to protected pages with invalid canonical auth. |
| `packages/core/src/modules/auth/services/authService.ts` | Modify if proven | Align refresh session lookup with canonical staff auth requirements. |
| `packages/core/src/modules/auth/lib/sessionIntegrity.ts` | Modify only if proven | Preserve canonical validation while fixing a verified mismatch. |
| `packages/cli/src/lib/testing/integration.ts` | Modify | Add browser-cookie readiness probe. |
| `packages/core/src/helpers/integration/__tests__/*.test.ts` | Create/modify if needed | Unit-test helper cookie parsing/diagnostic helpers without Playwright. |
| `packages/cli/src/lib/testing/__tests__/integration.test.ts` | Modify | Unit-test readiness redirect-loop detection and redacted detail output. |

### Testing Strategy
- Targeted regression:
  - `yarn test:integration:ephemeral --no-reuse-env --force-rebuild --filter packages/core/src/modules/auth/__integration__/TC-AUTH-053-login-helper-backend-cookie-flow.spec.ts`
- Representative existing browser spec:
  - `yarn test:integration:ephemeral --no-reuse-env --force-rebuild --filter packages/core/src/modules/core/__integration__/integration/TC-INT-001.spec.ts`
- Package validation:
  - `yarn workspace @open-mercato/core test`
  - `yarn workspace @open-mercato/core build`
  - `yarn workspace @open-mercato/cli test`
  - `yarn workspace @open-mercato/cli build`
  - `yarn typecheck`
- Redaction validation:
  - Unit tests must assert diagnostic strings do not contain raw `auth_token`, `session_token`, JWT-looking values, refresh-token values, or Set-Cookie payloads.

## Risks & Impact Review

### Data Integrity Failures
No schema or new write-path data model changes are proposed. Login still creates sessions through existing `AuthService.createSession()`, and refresh still validates an existing `auth.sessions` record before issuing a new staff JWT.

### Cascading Failures & Side Effects
Auth helper changes affect many integration specs. A too-narrow fix could make one app pass while published standalone helpers remain broken. Auth runtime changes can also affect login interceptors, MFA pending-token branches, logout/session revocation, and all server-rendered backend pages.

### Tenant & Data Isolation Risks
The fix must not weaken tenant/org checks. `om_selected_tenant` and `om_selected_org` may influence superadmin scope only through existing `applySuperAdminScope()` semantics.

### Migration & Deployment Risks
No migration or downtime risk. The behavioral change ships through packages and affects integration/development runtime immediately after upgrade.

### Operational Risks
Auth/session code has high blast radius. Keep runtime changes minimal and prove them with regression tests.

### Risk Register

#### Cookie Value Leakage in Diagnostics
- **Scenario**: A failing integration helper logs raw `auth_token` or `session_token` values.
- **Severity**: High
- **Affected area**: Auth tests, CI logs, developer machines.
- **Mitigation**: Diagnostics may log cookie names, statuses, and redirect locations only. Never log token values or Set-Cookie payloads.
- **Residual risk**: Low if tests assert redaction behavior for helper diagnostic utilities.

#### Weakening Canonical Session Validation
- **Scenario**: Refresh is changed to accept stale, cross-user, or cross-tenant session/JWT combinations to make tests pass.
- **Severity**: Critical
- **Affected area**: Staff auth, logout/session revocation, tenant isolation.
- **Mitigation**: Keep `resolveCanonicalStaffAuthContext()` as the authority. Fix token/cookie handoff or redirect behavior, not the validation rules.
- **Residual risk**: Medium because auth code is sensitive; requires core auth review.

#### Readiness Probe Becomes Too Slow or Flaky
- **Scenario**: Adding browser-cookie readiness makes ephemeral startup slower or fails due to expected first-load redirects.
- **Severity**: Medium
- **Affected area**: Local integration workflow and CI.
- **Mitigation**: Implement a bounded HTTP probe with a small redirect limit and explicit success criteria. Reuse existing `probeFetch()` timeout.
- **Residual risk**: Low after validating on local ephemeral and CI-like runs.

#### Standalone and Monorepo Behavior Diverge
- **Scenario**: The fix relies on monorepo-only paths or app-specific code and does not work from npm packages.
- **Severity**: High
- **Affected area**: Standalone app integration tests.
- **Mitigation**: Regression must import from `@open-mercato/core/helpers/integration/auth`; CLI readiness must run through the same package path used by standalone apps.
- **Residual risk**: Medium until verified through a create-app/standalone smoke if package publication changes are involved.

#### Login Interceptor or MFA Branch Regression
- **Scenario**: Cookie-handoff changes assume every successful `/api/auth/login` response is a full staff session and accidentally authenticate an interceptor-generated pending/MFA token.
- **Severity**: High
- **Affected area**: Enterprise login interceptors, future MFA extensions, staff login.
- **Mitigation**: Preserve the existing login response/cookie semantics. Helper fast-path may proceed to `/backend` only when a canonical backend auth context can be established; pending/interceptor responses must fall back or fail explicitly.
- **Residual risk**: Medium because interceptor packages may be outside the OSS test matrix; include a compatibility note in implementation review.

#### Readiness Probe Consumes Rate Limit Budget
- **Scenario**: Adding an authenticated readiness probe consumes the same login rate-limit bucket as tests, making the first real spec hit `429`.
- **Severity**: Medium
- **Affected area**: Ephemeral integration startup and auth-heavy test suites.
- **Mitigation**: Keep the probe count to one successful login, preserve bounded retry behavior, and surface `429` distinctly in readiness output.
- **Residual risk**: Low after CLI unit tests and one full ephemeral validation.

#### Redirect Probe Masks Open-Redirect Hardening
- **Scenario**: Manual redirect-following code treats external or protocol-relative `Location` headers as normal and weakens the protection already covered by `sanitizeRedirectPath()`.
- **Severity**: High
- **Affected area**: Auth refresh, readiness diagnostics, security posture.
- **Mitigation**: The readiness probe must validate same-origin/local redirect locations and report unsafe redirects as readiness failures. Runtime endpoints must keep existing `sanitizeRedirectPath()` and `buildRequestOriginUrl()` usage.
- **Residual risk**: Low with targeted unit tests for unsafe `Location` values.

## Final Compliance Report — 2026-07-07

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/auth/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/cli/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Preserve behavior unless a spec explicitly asks for behavior change | Compliant | Spec scopes a regression fix for existing helper behavior. |
| root AGENTS.md | Follow `BACKWARD_COMPATIBILITY.md` before contract changes | Compliant | Spec requires additive/stable helper/API behavior and no import path changes. |
| root AGENTS.md | Never expose cross-tenant data or skip tenant/organization scoping | Compliant | Canonical staff auth remains authoritative; tenant/org cookies may only influence existing superadmin scope semantics. |
| om-spec-writing checklist | MVP is explicit and future work is deferred | Compliant | TLDR includes a concrete MVP boundary and Non-Goals defer auth model/UI redesign. |
| `BACKWARD_COMPATIBILITY.md` | Public import paths, API URLs, cookie names, response fields, DI names, and session semantics are stable contract surfaces | Compliant | Spec forbids renames/removals and keeps `@open-mercato/core/helpers/integration/auth` stable. |
| `.ai/specs/AGENTS.md` | New non-trivial specs use `{date}-{title}.md` and stay implementation-accurate | Compliant | File is `.ai/specs/2026-07-07-integration-auth-login-redirect-loop.md`; related specs were cross-checked. |
| `.ai/qa/AGENTS.md` | Integration tests live in module `__integration__` folders and reuse shared helpers | Compliant | Regression is under auth `__integration__` and imports the published helper path. |
| packages/core/AGENTS.md | API route files export `metadata` and `openApi` | Compliant | API Contracts require preserving/updating existing exports on modified auth endpoints. |
| packages/core/AGENTS.md | Custom write routes wire mutation guards; domain writes use commands | N/A | This spec does not add CRUD/custom domain write routes; login/session refresh keep existing auth service flow. |
| packages/core/AGENTS.md | Use `findWithDecryption` / `findOneWithDecryption` for encrypted entities | Compliant | Data Models require existing auth user queries to continue using encrypted reads. |
| om-spec-writing checklist | Input validation, injection, XSS, and URL encoding are covered | Compliant | Security and Input Handling Invariants keep existing zod validation/parameterized service access and mark UI/XSS as N/A. |
| om-spec-writing checklist | Performance, cache, and scale impact is explicit | Compliant | Performance, Cache & Scale section marks cache/list/index/worker concerns N/A and bounds readiness cost. |
| packages/core/src/modules/auth/AGENTS.md | Never log credentials/session tokens | Compliant | Diagnostics are explicitly redacted. |
| packages/core/src/modules/auth/AGENTS.md | Ask before changing session token format, RBAC semantics, wildcard matching, super-admin behavior, or tenant provisioning outputs | Compliant | Spec declares these as non-goals and requires preserving canonical staff validation. |
| packages/shared/AGENTS.md | Shared helpers must stay infrastructure-only, typed, and avoid domain-specific drift | Compliant | No new shared helper is proposed; if shared auth server changes, it must preserve narrow typed contracts. |
| packages/shared/AGENTS.md | Do not gate raw feature arrays with ad hoc wildcard matching | Compliant | Spec does not add feature checks and preserves existing canonical auth/RBAC behavior. |
| packages/cli/AGENTS.md | Keep standalone app generator/testing contracts aligned | Compliant | CLI readiness change is scoped to shared ephemeral runner behavior. |
| packages/cli/AGENTS.md | Ask before changing CLI command contracts | Compliant | No CLI command names, flags, or generated paths change; readiness behavior becomes stricter before test execution. |
| `SPEC-027` integration testing | Shared Playwright helpers define the platform integration-test login contract | Compliant | This spec hardens the helper contract rather than replacing it in product specs. |
| Coherent access-denied UX spec | 403 means authenticated-but-not-authorized and must not redirect to login | Compliant | This spec explicitly scopes itself to missing/invalid auth cookie session-refresh loops, not 403 ACL loops. |
| Enterprise auth-login interceptor spec | Login response/cookie interception must remain compatible with pending/MFA branches | Compliant | API Contracts and risks require pending-token compatibility. |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No model changes. |
| API contracts match UI/UX section | Pass | No product UI changes; existing auth endpoints preserved. |
| Risks cover all write operations | Pass | Only existing session creation/refresh writes are involved; risks cover revocation/canonical validation. |
| Commands defined for all mutations | N/A | No domain mutation commands. |
| Cache strategy covers all read APIs | N/A | No caching change. |
| MVP and deferred scope are explicit | Pass | MVP Boundary and Non-Goals separate deliverable scope from broader auth redesign and standalone automation. |
| Frontend Architecture Contract | N/A | No App Router or backend shell UI changes are planned; spec requires a contract if implementation expands into UI/page files. |
| Test plan covers affected API and UI paths | Pass | Auth helper browser path, HTTP redirect chain, CLI readiness, core/CLI unit tests, and representative browser spec are covered. |
| Security redaction is testable | Pass | Testing Strategy requires assertions against raw cookies/JWTs/Set-Cookie payloads in diagnostics. |

### Non-Compliant Items
None.

### Verdict
**Fully compliant**: Approved for implementation planning. Implementation must still prove the exact root cause before editing auth/session code.

## Changelog
### Review — 2026-07-07
- **Reviewer**: Agent
- **Security**: Passed — raw credentials, JWTs, refresh tokens, and Set-Cookie payloads are explicitly excluded from diagnostics.
- **Performance**: Passed — readiness probe must be bounded and reuse existing timeouts.
- **Cache**: N/A — no caching behavior changes.
- **Commands**: N/A — no domain commands or events.
- **Risks**: Passed — added interceptor/MFA, rate-limit, open-redirect, canonical-validation, and standalone parity risks.
- **Verdict**: Approved for implementation planning.

### 2026-07-07
- Initial specification created from TraceCore baseline evidence showing `login(page, 'admin')` redirect loop on clean `origin/main`.
- Reviewed with `om-spec-writing`: added metadata, related-spec boundaries, non-goals, root-cause gates, API/readiness contracts, expanded risks, and final compliance matrix.
- Tightened strict checklist coverage with explicit MVP, undo N/A, security/input invariants, and performance/cache boundaries.
- Implementation planning corrected the auth regression id to `TC-AUTH-053` because `TC-AUTH-052` already exists for user create tenant-scope coverage on `develop`.
- Implementation evidence on current `origin/develop`: the new targeted regression passed before runtime auth edits, so the implementation keeps token/session semantics unchanged and adds redacted helper diagnostics instead of weakening canonical auth validation.
- CLI readiness implementation added a bounded cookie-backed `/backend` probe with same-origin redirect validation and cookie-name-only diagnostics; unit coverage follows in Step 3.2.
- CLI readiness unit coverage now verifies cookie propagation to `/backend`, redirect-loop diagnostics, unsafe protocol-relative redirect rejection, and absence of raw cookie values in failure messages.
- Checkpoint validation fixed the repo-wide explicit sort comparator guard by adding comparators to auth and CLI diagnostic cookie-name ordering.
- Checkpoint validation stabilized the CLI build-cache test so source-fingerprint invalidation changes file size as well as content, avoiding same-millisecond mtime flakes.
