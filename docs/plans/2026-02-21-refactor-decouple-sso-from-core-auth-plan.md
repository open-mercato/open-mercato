---
title: "refactor: Decouple SSO from core auth login page"
type: refactor
date: 2026-02-21
brainstorm: docs/brainstorms/2026-02-21-sso-auth-decoupling-brainstorm.md
---

# Decouple SSO from Core Auth Login Page

## Overview

The core auth login page (`packages/core/src/modules/auth/frontend/login.tsx`) has 11+ hardcoded SSO references that violate the Open/Closed Principle. The enterprise package is 100% optional, yet the login page directly calls SSO API endpoints, manages SSO-specific state, and conditionally renders SSO UI. This refactoring removes all SSO knowledge from core auth and uses the existing widget injection system to let the enterprise SSO module inject its behavior.

## Problem Statement

The SSO spec (`sso_spec.md`) declares "Zero auth module changes — Integrate via event subscribers, extensions, and widget injection." The current implementation violates this:

| Line(s) | Violation | What it does |
|---------|-----------|-------------|
| 89-90 | SSO state | `ssoConfigId`, `ssoChecking` state variables |
| 98-105 | SSO error parsing | Parses `sso_failed`, `sso_missing_config`, `sso_email_not_verified` from URL |
| 164-178 | HRD API call | `checkSso()` calls `POST /api/sso/hrd` |
| 196-199 | SSO redirect | Redirects to `/api/sso/initiate` on submit |
| 339 | HRD trigger | `onBlur` handler calls `checkSso()` |
| 342-345 | SSO banner | "SSO is enabled for this account" UI |
| 349 | Password conditional | `required={!ssoConfigId}` |
| 352-357 | Hidden fields | Password & remember-me hidden when SSO active |
| 358-364 | Button text | "Continue with SSO" vs "Sign in" conditional |

Additionally, line 358 uses a raw `<button>` instead of the `Button` component (pre-existing bug).

## Proposed Solution

Use **widget injection** with a **rich context callback interface** — the same proven pattern used by catalog (product-seo) and workflows (order-approval).

1. The login form defines an `<InjectionSpot>` with spot ID `auth.login:form` and passes a typed `LoginFormWidgetContext` via the `context` prop
2. The enterprise SSO module creates an injection widget that subscribes to this spot
3. The widget performs HRD, signals auth override, and handles SSO-specific errors
4. The login form reacts to generic callbacks (`setAuthOverride`, `setError`) without knowing SSO exists

## Technical Approach

### Architecture

```
┌──────────────────────────────────────────────┐
│ Core Auth Login Page (login.tsx)              │
│                                              │
│  ┌─────────────┐   ┌──────────────────────┐ │
│  │ Email Input  │──>│ InjectionSpot        │ │
│  └─────────────┘   │ spotId: auth.login    │ │
│  ┌─────────────┐   │ context: {            │ │
│  │ Password    │   │   email, tenantId,    │ │
│  │ (hideable)  │   │   setAuthOverride,    │ │
│  └─────────────┘   │   setError,           │ │
│  ┌─────────────┐   │   searchParams        │ │
│  │ Submit Btn  │   │ }                     │ │
│  └─────────────┘   └──────────┬───────────┘ │
└──────────────────────────────────────────────┘
                                │
                    (only if enterprise installed)
                                │
                                ▼
┌──────────────────────────────────────────────┐
│ Enterprise SSO Widget (widget.client.tsx)     │
│                                              │
│  - Listens to email changes                  │
│  - Calls POST /api/sso/hrd                   │
│  - Calls context.setAuthOverride()           │
│  - Renders "Continue with SSO" button        │
│  - Handles SSO error params from URL         │
└──────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 1: Define Injection Contract in Core Auth

**Files to create/modify:**

- `packages/core/src/modules/auth/frontend/login-injection.ts` — Define `LoginFormWidgetContext` and `AuthOverride` types

```typescript
// Types that the login form exposes to injected widgets
export type AuthOverride = {
  providerId: string         // e.g., 'sso'
  providerLabel: string      // e.g., 'Continue with SSO'
  onSubmit: () => void       // replacement submit action
  hidePassword: boolean      // whether to hide password field
  hideRememberMe: boolean    // whether to hide remember-me
  hideForgotPassword: boolean // whether to hide forgot password link
}

export type LoginFormWidgetContext = {
  email: string
  tenantId: string | null
  searchParams: URLSearchParams
  setAuthOverride: (override: AuthOverride | null) => void
  setError: (error: string | null) => void
}
```

**Success criteria:**
- [x] Types exported and importable by enterprise package
- [x] No SSO-specific naming in the types (generic "auth override" concept)

#### Phase 2: Refactor Login Page

**File to modify:** `packages/core/src/modules/auth/frontend/login.tsx`

**Changes:**

1. **Remove all SSO state** (lines 89-90): Replace `ssoConfigId`/`ssoChecking` with generic `authOverride: AuthOverride | null`
2. **Remove `checkSso` function** (lines 164-178): Entirely deleted
3. **Remove SSO error parsing** (lines 98-105): Replaced by a generic `?authError=` handler OR left to the widget via `searchParams` in context
4. **Remove SSO submit branch** (lines 196-199): Replace with `if (authOverride) { authOverride.onSubmit(); return }`
5. **Remove SSO conditional UI** (lines 342-364): Password visibility driven by `authOverride?.hidePassword`, button text driven by `authOverride?.providerLabel`
6. **Remove email `onBlur` SSO check** (line 339): Replace with generic email state tracking for the context
7. **Add `<InjectionSpot>`**: Render injection spot with `LoginFormWidgetContext`
8. **Fix raw `<button>`** (line 358): Replace with `Button` component

**After refactoring, login.tsx will:**
- Track `email` state (for passing to context)
- Track `authOverride: AuthOverride | null` state
- Render `<InjectionSpot spotId="auth.login:form" context={loginFormContext} />`
- Conditionally hide password based on `authOverride?.hidePassword`
- Use `authOverride?.providerLabel` for submit button text
- Call `authOverride?.onSubmit()` when form submits with an active override
- Display errors via existing error state (populated by widget's `setError` callback)

**Success criteria:**
- [x] Zero imports from `@open-mercato/enterprise` or SSO paths
- [x] Zero references to `/api/sso/*`
- [x] Zero SSO-specific state variables
- [x] Zero SSO-specific error codes
- [x] Login form works identically as before when no widgets are injected (password-only flow)
- [x] `InjectionSpot` renders nothing when enterprise module is not installed
- [x] Raw `<button>` replaced with `Button` component

#### Phase 3: Create SSO Injection Widget in Enterprise

**Files to create:**

```
packages/enterprise/src/modules/sso/
├── widgets/
│   ├── injection/
│   │   └── login-sso/
│   │       ├── widget.ts           # InjectionWidgetModule metadata + event handlers
│   │       └── widget.client.tsx   # Client component: HRD logic + SSO button
│   └── injection-table.ts          # Maps to auth.login:form spot ID
```

**`widgets/injection-table.ts`:**
```typescript
import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

const injectionTable: ModuleInjectionTable = {
  'auth.login:form': [
    {
      widgetId: 'sso.injection.login-sso',
      priority: 100,
    },
  ],
}

export default injectionTable
```

**`widgets/injection/login-sso/widget.ts`:**
```typescript
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import type { LoginFormWidgetContext } from '@open-mercato/core/modules/auth/frontend/login-injection'
import Widget from './widget.client'

const widgetModule: InjectionWidgetModule<LoginFormWidgetContext> = {
  metadata: {
    id: 'sso.injection.login-sso',
    title: 'SSO Login',
    features: [],  // No features required — SSO detection should work for all users
    priority: 100,
    enabled: true,
  },
  Widget,
}

export default widgetModule
```

**`widgets/injection/login-sso/widget.client.tsx`:**

The widget component:
1. Receives `LoginFormWidgetContext` via `context` prop
2. On mount: checks `searchParams` for SSO error codes (`sso_failed`, `sso_missing_config`, `sso_email_not_verified`, `sso_state_missing`, `sso_idp_error`, `sso_missing_params`) and calls `context.setError()` with translated messages
3. Watches `context.email` changes (with 300ms debounce)
4. Calls `POST /api/sso/hrd` with `{ email, tenantId }` for HRD
5. If SSO found: calls `context.setAuthOverride()` with redirect logic
6. If SSO not found: calls `context.setAuthOverride(null)` to clear
7. Renders SSO info banner ("SSO is enabled for this account") within the injection spot when override is active

**Success criteria:**
- [x] Widget discovered by generator (`npm run modules:prepare`)
- [x] Widget lazy-loaded only when enterprise module is present
- [x] HRD call includes `tenantId` from context
- [x] HRD call debounced (300ms)
- [x] All 6 SSO error codes handled and translated
- [x] `setAuthOverride` called with redirect logic (to `/api/sso/initiate`)
- [x] `setAuthOverride(null)` called when email doesn't match SSO domain
- [x] Network errors during HRD gracefully handled (fallback to password)

#### Phase 4: Server-Side SSO Enforcement (Security Fix)

**File to modify:** `packages/enterprise/src/modules/sso/` — add a subscriber or middleware

When `ssoRequired=true`, the password login API must reject credentials. Two approaches:

**Option A (Recommended): Auth login event subscriber**
- Create `packages/enterprise/src/modules/sso/subscribers/enforce-sso-login.ts`
- Subscribe to `auth.login.success` (ephemeral)
- Check if user's organization has `ssoRequired=true` on any active SSO config matching the user's email domain
- If yes: the subscriber can't prevent login after success, so this approach doesn't work

**Option B: HRD response extension + login API hook**
- Extend HRD response to include `ssoRequired: boolean`
- The SSO widget communicates this to the login form via `authOverride`
- Add server-side check: create a middleware or hook in the enterprise module that intercepts `/api/auth/login` requests, checks SSO enforcement, and returns 403 if SSO is required

Option B is the correct approach. The enterprise SSO module would need to register an API middleware or use the existing hook system to intercept password logins for SSO-enforced organizations.

**Success criteria:**
- [ ] `POST /api/auth/login` returns 403 when user's organization mandates SSO
- [ ] Error message: "SSO login is required for this organization"
- [ ] Super-admin bypass works (break-glass access)
- [ ] Check only runs when enterprise SSO module is installed

#### Phase 5: Run Generator and Verify

- [x] Run `npm run modules:prepare` to regenerate injection widget and table files
- [x] Verify `injection-widgets.generated.ts` includes the new SSO widget entry
- [x] Verify `injection-tables.generated.ts` includes the `auth.login:form` mapping
- [ ] Verify login page works without enterprise module (password-only)
- [ ] Verify login page works with enterprise module (SSO detection + redirect)
- [ ] Verify SSO callback errors display correctly
- ~~[ ] Verify `ssoRequired` enforcement on password login API~~ (deferred)

## Acceptance Criteria

### Functional Requirements

- [ ] Login page has zero SSO references (no imports, no state, no API calls, no error codes)
- [ ] Login page renders standard password form when no widgets inject
- [ ] SSO widget injects into login form via `auth.login:form` spot ID
- [ ] SSO widget performs HRD on email change (debounced, tenant-scoped)
- [ ] Password field hides when SSO is detected
- [ ] "Continue with SSO" button appears and redirects to IdP
- [ ] SSO callback errors display in the login form's error area
- [ ] Password login rejected server-side when `ssoRequired=true`
- [ ] Super-admin can bypass SSO enforcement (break-glass)

### Non-Functional Requirements

- [ ] No visual regression in login page (with or without SSO)
- [ ] Widget lazy-loads — no bundle size impact when enterprise module absent
- [ ] HRD network errors don't break the login form

### Quality Gates

- [ ] `yarn build` passes
- [ ] `yarn lint` passes
- [ ] No `any` types in new code
- [ ] Raw `<button>` replaced with `Button` component
- [ ] All user-facing strings use i18n translation keys

## Dependencies & Prerequisites

- Widget injection system must work on `frontend/` pages (to verify — same Next.js app shares bootstrap)
- Enterprise SSO module must be able to import `LoginFormWidgetContext` type from core auth
- Generator must discover widgets under `packages/enterprise/`

## Risk Analysis & Mitigation

| Risk | Severity | Mitigation |
|------|----------|------------|
| Widget injection doesn't work on frontend pages | High | Verify early in Phase 1. If blocked, add client-side widget bootstrap path |
| HRD timing race (user submits before HRD returns) | Medium | Disable submit button while auth override is being determined; add `isChecking` to AuthOverride |
| Multiple widgets claim the same email | Low | First widget to call `setAuthOverride` wins; subsequent calls overwrite |
| Layout flash when SSO widget loads and hides password | Medium | Accept minor flash; widget loader is cached after first load |
| Breaking existing SSO flow during migration | High | Test SSO end-to-end with real IdP (Keycloak) after refactoring |

## References & Research

### Internal References

- SSO spec: `.ai/specs/enterprise/sso_spec.md` (Section 3.4: Integration Points)
- Brainstorm: `docs/brainstorms/2026-02-21-sso-auth-decoupling-brainstorm.md`
- Login page: `packages/core/src/modules/auth/frontend/login.tsx`
- Widget injection types: `packages/shared/src/modules/widgets/injection.ts`
- Injection spot component: `packages/ui/src/backend/injection/InjectionSpot.tsx`
- Injection loader: `packages/shared/src/modules/widgets/injection-loader.ts`
- Reference widget (catalog): `packages/core/src/modules/catalog/widgets/injection/product-seo/`
- Reference injection table: `packages/core/src/modules/catalog/widgets/injection-table.ts`
- SSO services: `packages/enterprise/src/modules/sso/services/ssoService.ts`
- SSO HRD endpoint: `packages/enterprise/src/modules/sso/api/hrd/route.ts`
- Auth events: `packages/core/src/modules/auth/events.ts`
