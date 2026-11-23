# Execution plan — clear super-admin scope-selection cookies on identity change (GHSA-6729-5rxh-qg37)

**Source advisory:** GHSA-6729-5rxh-qg37 (repository security advisory, medium severity, triage)
**Source doc:** repository advisory `GHSA-6729-5rxh-qg37` (`om_selected` tenant/org cookies survive a change of user)
**Date:** 2026-11-24
**Engine:** om-auto-create-pr (steps: 6, --loop: no)

## Goal

Stop a stale `om_selected_tenant` / `om_selected_org` browser selection from silently re-scoping a different super-admin who signs in on the same browser. The logout path already clears both cookies (#7516); the login success path and the onboarding `clearAuthCookies` helper still leave them in place, and `applySuperAdminScope` (`packages/shared/src/lib/auth/server.ts`) applies them unconditionally for `is_super_admin` principals.

## Scope

- `packages/core/src/modules/auth/api/login.ts` — expire `om_selected_tenant` and `om_selected_org` on the **login success response only** (the failed-login path changes no identity and stays untouched).
- `packages/onboarding/src/modules/onboarding/lib/verify-redirects.ts` — add the same two cookie clears to `clearAuthCookies` (defence in depth; onboarding ends sessions on its redirect exits).
- Regression tests:
  - core: login success clears both scope cookies; failed login does not touch them.
  - onboarding: `clearAuthCookies` callers expire both scope cookies.

## Non-goals

- No change to `applySuperAdminScope` semantics, cookie readers, or the organization switcher itself.
- `/api/auth/session/refresh` and `PUT /api/auth/profile` are deliberately untouched (same identity re-issue; clearing there would snap a super-admin back to their home org mid-session).
- No changes to the MFA pending-token handling already present on the login path.
- No DB schema, API route shape, or contract-surface changes.

## Risks

- Login response now clears cookies a client may still want if the SAME user re-logs in (acceptable: the switcher re-persists on next selection; logout already behaves this way per #7516).
- Onboarding redirects that clear auth cookies now also drop the selection — intended, identity is changing there.

## Implementation Plan

### Phase 1: Core login fix

- [ ] 1.1 Expire `om_selected_tenant` + `om_selected_org` on the login success response in `packages/core/src/modules/auth/api/login.ts`
- [ ] 1.2 Unit/regression coverage: success clears both; failure leaves both; refresh/profile untouched (guard tests)

### Phase 2: Onboarding defence in depth

- [ ] 2.1 Add both scope-cookie clears to `clearAuthCookies` in `packages/onboarding/src/modules/onboarding/lib/verify-redirects.ts`
- [ ] 2.2 Regression coverage for the onboarding helper

### Phase 3: Validation and PR

- [ ] 3.1 Targeted tests (core auth login suite, onboarding suites), lint
- [ ] 3.2 Full configured validation gate (local runner)
- [ ] 3.3 Draft PR open, labels applied, summary comment, review pass

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.
