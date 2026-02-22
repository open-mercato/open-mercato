# Brainstorm: Decouple SSO from Core Auth Module

**Date**: 2026-02-21
**Status**: Ready for planning
**Trigger**: Architect feedback (Piotr) — SSO must not leak outside the enterprise module

## What We're Building

Refactor the SSO integration so the core auth module has **zero knowledge of SSO**. The enterprise SSO module will inject its login behavior via widget injection with a rich context callback interface. This follows the Open/Closed Principle — auth is open for extension (injection spots) but closed for modification (no SSO imports).

### Problem Statement

The login page (`packages/core/src/modules/auth/frontend/login.tsx`) currently:
- Hardcodes calls to `/api/sso/hrd` (Home Realm Discovery) on email blur (line ~169)
- Hardcodes redirect to `/api/sso/initiate` on form submit (line ~198)
- Manages SSO-specific state (`ssoConfigId`, `ssoChecking`)
- Contains SSO-specific error handling and conditional UI (hide password, show SSO button)

This violates the architecture: the enterprise package is 100% optional, and other modules must not know SSO exists.

### What Stays (No Change Needed)

- SSO module depending on core `AuthService` for session creation, user lookup, role resolution — legitimate bottom-up dependency
- SSO `AccountLinkingService` creating `User`/`UserRole` entities for JIT provisioning — necessary
- SSO API routes (`/api/sso/hrd`, `/api/sso/initiate`, `/api/sso/callback/oidc`) — stay in enterprise
- Server-side auth events (`auth.login.success`, `auth.login.failed`, etc.) — stay as-is

## Why This Approach

**Widget injection + rich context callbacks** was chosen because:

1. **Proven pattern** — widget injection is mature in the codebase (catalog product SEO, workflow order approvals). Discovery, loading, priority ordering all work.
2. **Generic context interface** — `InjectionWidgetComponentProps<TContext>` already supports passing arbitrary context. The login form passes callbacks (`setError`, `setAuthOverride`) without knowing who consumes them.
3. **No shared package changes** — we don't need to modify `WidgetInjectionEventHandlers` (which is CRUD-oriented). The login form defines its own context type.
4. **Supports full form takeover** — when `ssoRequired=true`, the SSO widget signals `authOverride` to hide the password form entirely. Better UX than server-side-only enforcement.
5. **Future extensibility** — social login, LDAP, or any auth provider can inject into the same spots without touching the login form.

### Alternatives Considered

- **Extend widget event handlers**: Would require changing the shared injection system (`onEmailValidated`, `onSubmitOverride`). Too invasive for one use case.
- **Pure event bus**: Over-engineered. The module event bus is server-side; we need client-side communication within a single React component tree.
- **Slot-based rendering with shared context**: Works but tighter coupling through React context providers. Callbacks in `InjectionWidgetComponentProps.context` are simpler.

## Key Decisions

1. **Two extension mechanisms**:
   - **Widget injection** (UI) — `<InjectionSpot>` on the login form for rendering SSO UI (button, loading state)
   - **Rich context object** (communication) — login form passes callbacks to injected widgets via `context` prop

2. **Login form context interface** (what the login form exposes):
   - `email: string` — current email value
   - `setError(message: string)` — display an error in the form's error area
   - `setAuthOverride(override: AuthOverride | null)` — signal that an alternative auth method claims the flow (hides password, replaces submit)
   - `onEmailChange: Observable/callback registration` — notify widgets when email changes (for HRD)

3. **AuthOverride type** (what a widget can signal):
   - `providerLabel: string` — e.g., "SSO" or "Google Workspace"
   - `onSubmit: () => void` — replacement submit action (e.g., redirect to IdP)
   - `hidePassword: boolean` — whether to hide the password field

4. **Injection spot IDs**:
   - `auth.login:alternative-auth` — where SSO button / alternative auth UI renders

5. **Error display**: SSO errors flow through the login form's existing error display via `setError` callback. Consistent UX, single error area.

6. **Full form takeover**: When `ssoRequired=true` for a domain, the SSO widget calls `setAuthOverride(...)` to hide password and replace the submit action. The form doesn't know it's SSO — it just knows "an alternative provider claimed this email."

7. **Enterprise SSO widget file structure**:
   ```
   packages/enterprise/src/modules/sso/
   ├── widgets/
   │   ├── injection/
   │   │   └── login-sso/
   │   │       ├── widget.ts           # InjectionWidgetModule metadata
   │   │       └── widget.client.tsx   # "Continue with SSO" button, HRD logic
   │   └── injection-table.ts          # Maps to auth.login:alternative-auth
   ```

8. **After refactoring, login.tsx will have**: Zero references to `/api/sso/*`, zero SSO-specific state, zero SSO-specific error handling. Only generic `<InjectionSpot>` and context callbacks.

## Open Questions

1. **HRD debouncing**: HRD check happens on email change. Should the login form debounce email changes before notifying widgets, or should each widget handle its own debouncing?

2. **Multiple auth providers**: If both SSO and (future) social login inject into the same spot, should `setAuthOverride` support a list of providers, or first-claim-wins?

3. **SSO callback error redirect**: Currently SSO callback errors redirect to `/?error=sso_failed`. After decoupling, should this use a generic `?authError=` param, or should the SSO widget handle error parsing from the URL itself?

## Scope

### In Scope
- Remove all SSO references from `packages/core/src/modules/auth/frontend/login.tsx`
- Define `LoginFormContext` type and `AuthOverride` type in core auth
- Add `<InjectionSpot spotId="auth.login:alternative-auth">` to the login form
- Create SSO injection widget in `packages/enterprise/src/modules/sso/widgets/`
- Create `injection-table.ts` mapping to `auth.login:alternative-auth`
- Move HRD logic and SSO redirect logic into the SSO widget

### Out of Scope
- SSO API routes (stay in enterprise, unchanged)
- SSO services / data model (unchanged)
- SSO callback / session flow (unchanged)
- Adding new SSO providers
- Server-side auth events (already clean, no changes)
