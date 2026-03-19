# Consideration: Enterprise Password Change Integration

**Date:** 2026-03-05
**Related spec:** `SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa.md`
**Status:** Pre-implementation design decision

---

## Problem Statement

The enterprise security module introduces a hardened password change flow (`PasswordService`, `PUT /api/security/profile/password`) that requires current-password verification and policy enforcement. The existing core auth module has its own password change flow (`PUT /api/auth/profile`) with no current-password requirement.

Two questions need resolving before implementation:

1. **How to plug the enterprise password logic into the core flow without modifying core?**
2. **How to hide the core UI password pages when the enterprise module is active?**

---

## What the Spec Currently Says (§14.5)

The spec takes a **pure-injection strategy**:

- Security module owns a new page at `backend/profile/security/` with `PasswordChangeForm` calling `PUT /api/security/profile/password`
- A "Security & MFA" menu item is injected into the profile dropdown pointing to this new page
- Existing auth routes (`/backend/profile/change-password`, `PUT /api/auth/profile`) remain **unchanged**

**The gap:** the spec adds a new path but doesn't prevent users from using the old one — which allows password changes without current-password verification even when the enterprise module is active.

---

## Option 1 — Spec As-Is (no additional work)

Follow the spec exactly. The old "Change Password" page and route still work. Enterprise users are directed to the new security page via the injected menu item but can bypass it.

| | |
|---|---|
| **Core changes** | None |
| **Security posture** | Weak — old path remains a bypass |
| **UX** | Two "Change Password" entries in the dropdown |
| **Verdict** | Not recommended if the goal is hardened password management |

---

## Option 2 — Spec + Blocking API Interceptor (recommended minimum)

Keep the spec's separate route and page. Additionally register a `before` interceptor in `packages/enterprise/src/modules/security/api/interceptors.ts` that blocks password mutation attempts on the old core route:

```typescript
// packages/enterprise/src/modules/security/api/interceptors.ts
const blockCorePasswordChange: ApiInterceptor = {
  id: 'security.block-core-password-change',
  targetRoute: 'auth/profile',
  methods: ['PUT'],
  priority: 100,
  before: async (request) => {
    const body = request.body as Record<string, unknown>
    if (!body?.password) return { ok: true }  // email-only updates pass through

    return {
      ok: false,
      statusCode: 403,
      message: 'Password changes must be made from the Security profile page.',
    }
  },
}

export const interceptors: ApiInterceptor[] = [blockCorePasswordChange]
```

**Behaviour when module is disabled:** interceptor is never registered — core route works as normal.

| | |
|---|---|
| **Core changes** | None |
| **Security posture** | Strong — old route is closed for password mutations |
| **UX** | Old page still visible in dropdown, but fails with a clear message |
| **Verdict** | Good security, acceptable UX |

---

## Option 3 — Spec + Interceptor + UI Redirect (recommended, requires small additive core change)

Extends Option 2 by also redirecting the "Change Password" dropdown item to point at the enterprise security page when the module is active.

### The gap in UMES today

`ProfileDropdown` ([packages/ui/src/backend/ProfileDropdown.tsx](packages/ui/src/backend/ProfileDropdown.tsx)) accepts a `changePasswordHref` prop (default: `/backend/profile/change-password`) designed for exactly this override. However, its usage in the app layout:

```tsx
// apps/mercato/src/app/(backend)/backend/layout.tsx:363
<ProfileDropdown email={auth?.email} />
```

...does not go through `useRegisteredComponent`, so the component replacement system (`propsTransform`) cannot intercept it today.

Menu injection (`menu:topbar:profile-dropdown`) is **additive only** — it cannot hide or modify the built-in "Change Password" item.

### Required additive change to `packages/ui`

Wrap `ProfileDropdown` at its usage site so it becomes replacement-aware:

```tsx
// apps/mercato/src/app/(backend)/backend/layout.tsx
const ResolvedDropdown = useRegisteredComponent<ProfileDropdownProps>(
  'ui:profile-dropdown',
  ProfileDropdown
)
<ResolvedDropdown email={auth?.email} />
```

This registers `ui:profile-dropdown` as a stable component handle — an **additive, non-breaking** UMES contract surface entry.

### Enterprise module then uses `propsTransform`

```ts
// packages/enterprise/src/modules/security/widgets/components.ts
{
  target: { componentId: 'ui:profile-dropdown' },
  priority: 100,
  features: ['security.profile.password'],
  propsTransform: (props) => ({
    ...props,
    changePasswordHref: '/backend/profile/security',
  }),
}
```

Result: the existing "Change Password" item silently redirects to the enterprise security profile page. No duplicate entries, no confusing error states.

| | |
|---|---|
| **Core changes** | One additive line in app layout (registers `ui:profile-dropdown` handle) |
| **Security posture** | Strong — both old route and old UI are closed |
| **UX** | Seamless — single "Change Password" entry redirects to the hardened page |
| **Verdict** | Best option |

---

## Summary Comparison

| | Option 1 (spec as-is) | Option 2 (+ interceptor) | Option 3 (+ interceptor + UI redirect) |
|---|---|---|---|
| Core changes | None | None | 1 additive line in layout |
| Old route blocked | No | **Yes** | **Yes** |
| Old UI item hidden/redirected | No | No | **Yes** |
| UX clarity | Poor (two entries) | Medium (fails with message) | **Best (transparent redirect)** |
| Implementation effort | Low | Low | Low + small PR to `packages/ui` |

---

## Decision Needed

1. Do we accept the small additive change to `packages/ui` (Option 3), or limit to Option 2 only?
2. The `ui:profile-dropdown` handle becomes a **frozen UMES contract surface** once added — confirm we're happy with this handle ID before merging.
3. Should the blocking interceptor return a `403` (permission denied) or a `400` with a redirect hint? A `400` with `{ error: '...', redirectTo: '/backend/profile/security' }` gives the UI the opportunity to navigate the user automatically.
