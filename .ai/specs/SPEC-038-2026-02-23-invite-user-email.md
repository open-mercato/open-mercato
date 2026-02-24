# SPEC-038: User Invite via Email

## TLDR
**Key Points:**
- Introduces the ability to invite new users via an email link rather than requiring administrators to manually set passwords during creation.
- Enhances security and user experience by ensuring users are the only ones to know their password.

**Scope:**
- Modify the `auth.users.create` command and schema to accept an optional `sendInviteEmail` flag and make the `password` field optional.
- Generate a secure setup token (reusing `PasswordReset` logic) when an invite is requested.
- Send an `auth.user.invited` email notification containing the setup link.
- Update the UI `CreateUserPage` to support this toggle.
- Add a "Resend Invite" action to the user detail page.

**Concerns:**
- Token expiration and security. Currently, `PasswordReset` tokens expire in 1 hour. We will modify the logic to allow passing a custom expiration (48 hours) for invite link tokens.
- Ensuring the `PasswordReset` flow can correctly handle a "first setup" context vs a standard "reset" context if needed for UX, though the underlying mechanism is the same.

## Overview
Currently, the Open Mercato system requires an administrator to set a hardcoded password when creating a new user. This specification changes the user creation flow to allow sending an email invitation with a secure link, enabling the new user to set their own password initially. This brings the system in line with modern security best practices (where administrators never know or transmit user passwords) and reduces friction during onboarding.

> **Market Reference**: Systems like Okta, Auth0, and modern SaaS platforms (e.g., Linear, Notion) all use email-based invitation flows for new users rather than admin-set passwords. We are rejecting a completely separate "Invite" entity in favor of reusing the existing password reset token mechanism to keep the architecture lean and reduce surface area.

## Problem Statement
When a tenant administrator creates a new user via `CreateUserPage` (`auth.users.create`), they must provide a password. 
- **Security Risk:** Passwords are often communicated over insecure channels (Slack, email).
- **Friction:** The admin has the overhead of generating and communicating the password.
- **Compliance:** Violates the principle that only the user should ever know their password.

## Proposed Solution
The solution is to decouple user creation from password creation via an email invitation flow.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Reuse `PasswordReset` entity for invites | An invite is fundamentally the same as a password reset: a secure, time-bound token that allows setting a new password. Creating a separate `UserInvite` entity and flow would duplicate logic (token generation, email sending, UI form) unnecessarily. |
| Add `sendInviteEmail` flag to `auth.users.create` | Keeps the creation logic within a single command rather than creating a `auth.users.invite` command, as the entity creation logic (roles, custom fields, tenant scoping) is identical. |
| Make `password` optional on create | Necessary to allow the invite flow. Validation will ensure that *either* a password is provided *or* `sendInviteEmail` is true. |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Separate `auth.users.invite` command | Would lead to significant code duplication with `auth.users.create` regarding role assignment, tenant scoping, and custom field handling. |
| Dedicated `UserInvite` database entity | Over-engineering. The existing `PasswordReset` entity captures the exact requirements (userId, token hash, expiry). |

## User Stories / Use Cases
- **Administrator** wants to **invite a new team member via email** so that **they don't have to securely transmit a temporary password**.
- **New User** wants to **click a link in their email to set their password** so that **they can securely access their account**.
- **Administrator** wants to **resend an invite email** so that **users who lost the original email can still access the system**.

## Architecture
No new entities or modules are introduced. 

1. **User Creation:** The `auth.users.create` command handler is modified. If `sendInviteEmail` is true, it skips password hashing, creates the user, generates a reset token with a **48-hour expiration**, and saves a `PasswordReset` record.
2. **Notification:** The command emits a notification (or directly uses the notification service) to send an `auth.user.invited` email.
3. **Resend Action:** A new lightweight command `auth.users.resend-invite` is created to invalidate old tokens and send a new one.

### Commands & Events
- **Command Modified**: `auth.users.create`
- **Command New**: `auth.users.resend_invite`
- **Notification New**: `auth.user.invited`
- **Event**: Leverages existing `auth.user.created`

## Data Models
No changes to existing MikORM entities. We will utilize the existing `PasswordReset` and `User` entities in the `auth` module.

## API Contracts
### `auth.users.create` (Modified)
- `METHOD POST /api/auth/users`
- Request Schema Changes:
  ```typescript
  const createSchema = z.object({
    email: z.string().email(),
    password: passwordSchema.optional(), // Made optional
    sendInviteEmail: z.boolean().optional(), // Added
    organizationId: z.string().uuid(),
    roles: z.array(z.string()).optional(),
  }).refine(data => data.password || data.sendInviteEmail, {
    message: "Either password or sendInviteEmail must be provided",
    path: ["password"]
  })
  ```

### `auth.users.resend_invite` (New)
- `METHOD POST /api/auth/users/:id/resend-invite`
- Request: `{}` (ID in path)
- Response: `{ success: true }`

## Internationalization (i18n)
- `auth.users.form.field.sendInviteEmail`: "Send password setup link to e-mail"
- `auth.users.flash.inviteSent`: "Invitation sent"
- `auth.actions.resendInvite`: "Resend invite"
- Email templates for `auth.user.invited`

## UI/UX
- **Create User Form**: Add a Switch/Checkbox for "Send password setup link to e-mail". When checked, the "Password" input field is hidden.
- **User Detail Page**: Add "Resend invite" to the `ActionsDropdown` in the `FormHeader`. Only show this if the user hasn't set a password yet (or based on some logic, e.g., never logged in).
- **Setup Page**: Reuse the existing `/frontend/reset/[token]` page. It might be beneficial to check if it's an invite context to change the heading from "Reset Password" to "Setup Password".

## Implementation Plan

### Phase 1: Backend Support for Invites
1. Update `createSchema` in `packages/core/src/modules/auth/commands/users.ts` to make password optional and add `sendInviteEmail`. Add the `z.refine` validation.
2. Modify `createUserCommand` to handle the conditional password logic.
3. If `sendInviteEmail` is true, generate a token via `authService` (passing a custom 48-hour expiration), create a `PasswordReset` record, and trigger the `auth.user.invited` notification.
4. Define the `auth.user.invited` notification type in `packages/core/src/modules/auth/notifications.ts`.

### Phase 2: Frontend & Resend Logic
1. Update `CreateUserPage` (`packages/core/src/modules/auth/backend/users/create/page.tsx`) to implement the UI toggle and conditional field visibility.
2. Implement new command `auth.users.resend_invite` and expose via API route.
3. Update `UserDetailPage` (`packages/core/src/modules/auth/backend/users/[id]/edit/page.tsx`) to add the "Resend invite" action to the `FormHeader` dropdown.

## Risks & Impact Review

#### Unauthorized Invite Generation
- **Scenario**: An attacker spams the user creation endpoint or resend invite endpoint.
- **Severity**: Medium
- **Affected area**: `auth.users.create`, `auth.users.resend_invite`, Email Service
- **Mitigation**: Standard RBAC (`auth.users.manage` feature required) protects both endpoints. Standard rate limiting applies to API routes.
- **Residual risk**: Malicious admin could spam invites, but this is an insider threat issue.

#### Token Leakage
- **Scenario**: The invite token is logged or intercepted in transit.
- **Severity**: High
- **Affected area**: `auth` module notification flow
- **Mitigation**: Tokens are only sent via the configured email provider. They are not returned in the API response. They expire automatically after **48 hours**. We reuse the proven `PasswordReset` token logic but override the expiration time.
- **Residual risk**: Low. Secure transport (HTTPS/TLS for email) handles transit.

## Final Compliance Report — 2026-02-23

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/src/modules/auth/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Singular naming for commands/events | Compliant | `auth.users.resend_invite` follows plural module, singular entity pattern (though convention often uses `auth.users` as prefix for commands in this module, checking existing commands confirms this is the established pattern here e.g. `auth.users.create`). |
| root AGENTS.md | Zod validation for all API inputs | Compliant | Updates `createSchema`. |
| auth AGENTS.md | Hash passwords with bcryptjs | Compliant | Handled by existing create logic if password provided, skipped if invite. |
| auth AGENTS.md | Never log credentials | Compliant | Tokens are not logged. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Reusing existing models. |
| API contracts match UI/UX section | Pass | UI toggle aligns with `sendInviteEmail` field. |
| Risks cover all write operations | Pass | Addressed token limits and RBAC. |
| Commands defined for all mutations | Pass | `auth.users.resend_invite` defined. |

### Non-Compliant Items
None identified.

### Verdict
- **Fully compliant**: Approved — ready for implementation

## Changelog
### 2026-02-23
- Initial specification drafted following "Martin Fowler" spec-writing guidelines.
