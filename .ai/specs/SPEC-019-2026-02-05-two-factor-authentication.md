# SPEC-019: Two-Factor Authentication (2FA) with Authenticator Apps

## Overview

Add optional Two-Factor Authentication to Open Mercato using TOTP (Time-based One-Time Passwords), compatible with Google Authenticator, Microsoft Authenticator, Authy, 1Password, and other standard authenticator apps. 2FA is opt-in per user account — each user decides whether to enable it. Tenant admins can optionally enforce 2FA for all users in their tenant.

## Goals

- Users can enable/disable 2FA on their own account via the profile page.
- The login flow gains a second step when 2FA is active: after email+password, the user must provide a TOTP code.
- Recovery codes are generated at setup time so users can regain access if they lose their authenticator device.
- Tenant admins can enforce 2FA for all users within a tenant.
- API key authentication is unaffected (keys bypass 2FA — they are already scoped and expiring).

## Non-Goals

- SMS/email-based OTP (out of scope for this iteration).
- Hardware security keys / WebAuthn / FIDO2 (future spec).
- Per-role 2FA enforcement (tenant-wide toggle is sufficient for now).

---

## Architecture

### TOTP Standard

We use [RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238) (TOTP) with the following parameters:

| Parameter | Value |
|-----------|-------|
| Algorithm | SHA-1 (standard for authenticator app compatibility) |
| Digits | 6 |
| Period | 30 seconds |
| Secret length | 20 bytes (160 bits), base32-encoded |
| Window | ±1 step (allows 30 seconds clock drift) |

### Library

Use [`otpauth`](https://www.npmjs.com/package/otpauth) (zero-dependency, maintained, supports TOTP/HOTP, QR URI generation). Add it to `packages/core/package.json`.

For QR code generation on the server side, use [`qrcode`](https://www.npmjs.com/package/qrcode) to produce a data URI from the `otpauth://` URI. Add it to `packages/core/package.json`.

### Recovery Codes

- 8 single-use recovery codes generated at 2FA setup time.
- Each code: 8 alphanumeric characters, grouped as `XXXX-XXXX` for readability.
- Stored as bcrypt hashes (same cost as passwords) so plaintext is never at rest.
- Shown to the user exactly once during setup — they must save them.
- Each code can be used once, then marked consumed.
- User can regenerate all recovery codes (invalidates existing ones).

---

## Data Model

### New Entity: `UserTwoFactor`

**Table:** `user_two_factors`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | `uuid` | No | PK |
| `user_id` | `uuid` | No | FK → `users.id`, unique |
| `secret` | `text` | No | Encrypted TOTP secret (base32). Encrypted at rest via tenant data encryption if enabled |
| `is_enabled` | `boolean` | No | Whether 2FA is currently active (default: `false`) |
| `verified_at` | `timestamptz` | Yes | When the user first verified a code during setup |
| `tenant_id` | `uuid` | Yes | FK → tenants |
| `organization_id` | `uuid` | Yes | FK → organizations |
| `created_at` | `timestamptz` | No | |
| `updated_at` | `timestamptz` | No | |
| `deleted_at` | `timestamptz` | Yes | Soft delete |

**Constraints:**
- Unique index on `(user_id)` where `deleted_at IS NULL`.

### New Entity: `UserRecoveryCode`

**Table:** `user_recovery_codes`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | `uuid` | PK | |
| `user_two_factor_id` | `uuid` | No | FK → `user_two_factors.id` |
| `code_hash` | `text` | No | bcrypt hash of the recovery code |
| `used_at` | `timestamptz` | Yes | Null if unused, timestamp if consumed |
| `created_at` | `timestamptz` | No | |

**Constraints:**
- Index on `(user_two_factor_id, used_at)` for quick lookup of unused codes.

### Modified Entity: `Session`

Add a field to support the intermediate "2FA pending" state during login:

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `two_factor_pending` | `boolean` | No | Default `false`. If `true`, the session cannot be used for auth until 2FA is verified |

### Tenant Setting

A new config key in the existing `configs` module:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `auth.twoFactor.required` | `boolean` | `false` | When `true`, all users in the tenant must enable 2FA. Users who haven't set it up are redirected to 2FA setup after login |

---

## Login Flow Changes

### Current Flow

```
1. POST /api/auth/login (email + password)
2. → JWT issued, session created, redirect to /backend
```

### New Flow (when 2FA is enabled for the user)

```
1. POST /api/auth/login (email + password)
   → Credentials valid but 2FA enabled
   → Create session with two_factor_pending = true
   → Return { ok: true, twoFactorRequired: true, challengeToken: <session_token> }
   → No JWT issued yet

2. Client redirects to /login/two-factor?token=<challengeToken>

3. POST /api/auth/two-factor/verify
   Body: { token: <challengeToken>, code: "123456" }
   → Validate TOTP code (or recovery code)
   → Mark session.two_factor_pending = false
   → Issue JWT, set cookies
   → Return { ok: true, redirect: '/backend' }
```

### Flow (when 2FA is NOT enabled for the user)

No change. Login works exactly as before.

### Flow (when tenant enforces 2FA but user hasn't set it up)

```
1. POST /api/auth/login (email + password)
   → Credentials valid, 2FA not configured, tenant requires it
   → Create session with two_factor_pending = true
   → Return { ok: true, twoFactorSetupRequired: true, challengeToken: <session_token> }

2. Client redirects to /login/two-factor/setup?token=<challengeToken>
   → User sets up 2FA (scan QR, verify code)
   → On success, session unlocked, JWT issued
```

### Challenge Token

The `challengeToken` reuses the existing `Session` entity with `two_factor_pending = true`. This session:
- Has a short expiry (5 minutes) for the 2FA challenge phase.
- Cannot be used to access protected resources (middleware rejects `two_factor_pending = true` sessions).
- Is promoted to a full session (standard TTL) once 2FA is verified.

---

## API Endpoints

### 2FA Verification (Login Flow)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/two-factor/verify` | Challenge token | Verify TOTP code or recovery code during login |

**Request:**
```typescript
{
  token: string       // The challengeToken from login response
  code: string        // 6-digit TOTP code or recovery code (XXXX-XXXX)
}
```

**Response (success):**
```json
{
  "ok": true,
  "token": "<jwt>",
  "redirect": "/backend"
}
```

**Response (failure):**
```json
{
  "ok": false,
  "error": "Invalid verification code"
}
```

### 2FA Setup

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/two-factor/setup` | JWT or challenge token | Generate TOTP secret and QR code |
| POST | `/api/auth/two-factor/setup/verify` | JWT or challenge token | Verify initial code and activate 2FA |

**`POST /api/auth/two-factor/setup`**

Generates a new TOTP secret. Does NOT enable 2FA yet — the user must verify a code first.

Response:
```json
{
  "ok": true,
  "secret": "JBSWY3DPEHPK3PXP",
  "qrCodeDataUri": "data:image/png;base64,...",
  "otpauthUri": "otpauth://totp/OpenMercato:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=OpenMercato"
}
```

**`POST /api/auth/two-factor/setup/verify`**

Verifies the user can produce a valid code and activates 2FA.

Request:
```typescript
{
  code: string       // 6-digit TOTP code from authenticator
}
```

Response:
```json
{
  "ok": true,
  "recoveryCodes": [
    "A1B2-C3D4",
    "E5F6-G7H8",
    "..."
  ]
}
```

Recovery codes are returned **only once**. The user must save them. If the request was made with a challenge token (tenant-enforced setup during login), the response also includes:
```json
{
  "ok": true,
  "recoveryCodes": ["..."],
  "token": "<jwt>",
  "redirect": "/backend"
}
```

### 2FA Management

| Method | Path | Auth | Features | Purpose |
|--------|------|------|----------|---------|
| GET | `/api/auth/two-factor/status` | JWT | — | Check if 2FA is enabled for current user |
| DELETE | `/api/auth/two-factor` | JWT | — | Disable 2FA (requires password confirmation) |
| POST | `/api/auth/two-factor/recovery-codes` | JWT | — | Regenerate recovery codes (requires password confirmation) |

**`GET /api/auth/two-factor/status`**

```json
{
  "enabled": true,
  "verifiedAt": "2026-02-05T10:30:00Z",
  "recoveryCodesRemaining": 6
}
```

**`DELETE /api/auth/two-factor`**

Request:
```typescript
{
  password: string   // Current password for confirmation
}
```

Response:
```json
{ "ok": true }
```

**`POST /api/auth/two-factor/recovery-codes`**

Regenerates all 8 recovery codes (old ones become invalid).

Request:
```typescript
{
  password: string   // Current password for confirmation
}
```

Response:
```json
{
  "ok": true,
  "recoveryCodes": ["A1B2-C3D4", "..."]
}
```

### Admin Endpoints

| Method | Path | Auth | Features | Purpose |
|--------|------|------|----------|---------|
| GET | `/api/auth/users` | JWT | `auth.users.list` | User list now includes `twoFactorEnabled` field |
| DELETE | `/api/auth/two-factor/admin/reset` | JWT | `auth.users.edit` | Admin resets 2FA for a specific user |

**`DELETE /api/auth/two-factor/admin/reset`**

Allows admins to disable 2FA for a user who has lost their device and recovery codes.

Request:
```typescript
{
  userId: string
}
```

---

## File Layout

```
packages/core/src/modules/auth/
├── api/
│   ├── two-factor/
│   │   ├── verify.ts                  # POST: verify TOTP during login
│   │   ├── setup.ts                   # POST: generate secret + QR
│   │   ├── setup/
│   │   │   └── verify.ts             # POST: verify initial code, activate 2FA
│   │   ├── status.ts                  # GET: check 2FA status
│   │   ├── route.ts                   # DELETE: disable 2FA
│   │   ├── recovery-codes.ts          # POST: regenerate recovery codes
│   │   └── admin/
│   │       └── reset.ts              # DELETE: admin reset user's 2FA
│   └── ... (existing)
├── data/
│   ├── entities.ts                    # Add UserTwoFactor, UserRecoveryCode entities
│   └── validators.ts                 # Add 2FA-related schemas
├── services/
│   ├── authService.ts                 # Modify login to check 2FA
│   └── twoFactorService.ts           # NEW: TOTP generation, verification, recovery codes
├── frontend/
│   ├── login.tsx                      # Existing (minor changes for 2FA redirect)
│   └── login/
│       └── two-factor.tsx            # NEW: 2FA code entry page
├── backend/
│   ├── profile/
│   │   └── two-factor/
│   │       └── page.tsx              # NEW: 2FA setup/management in profile
│   └── ... (existing)
├── lib/
│   └── totp.ts                       # NEW: TOTP helpers (wraps otpauth library)
└── ... (existing files unchanged)
```

---

## Service: `TwoFactorService`

Location: `packages/core/src/modules/auth/services/twoFactorService.ts`

```typescript
class TwoFactorService {
  // Setup
  generateSecret(userEmail: string): { secret: string; otpauthUri: string }
  generateQrCodeDataUri(otpauthUri: string): Promise<string>

  // Verification
  verifyTotpCode(secret: string, code: string): boolean
  verifyRecoveryCode(userTwoFactorId: string, code: string): Promise<boolean>

  // Lifecycle
  enableTwoFactor(userId: string, secret: string, verificationCode: string): Promise<{ recoveryCodes: string[] }>
  disableTwoFactor(userId: string): Promise<void>

  // Recovery
  generateRecoveryCodes(): Promise<{ codes: string[]; hashes: string[] }>
  regenerateRecoveryCodes(userTwoFactorId: string): Promise<string[]>
  getRemainingRecoveryCodeCount(userTwoFactorId: string): Promise<number>

  // Status
  getUserTwoFactorStatus(userId: string): Promise<{ enabled: boolean; verifiedAt: Date | null; recoveryCodesRemaining: number } | null>
  isUserTwoFactorEnabled(userId: string): Promise<boolean>

  // Admin
  adminResetTwoFactor(userId: string): Promise<void>
}
```

DI registration in `di.ts`:
```typescript
twoFactorService: asClass(TwoFactorService).scoped()
```

---

## Frontend

### Login 2FA Challenge Page

**Route:** `/login/two-factor` (auto-discovered from `frontend/login/two-factor.tsx`)

**Behavior:**
1. Reads `token` query parameter (challengeToken).
2. Shows a simple form: "Enter the 6-digit code from your authenticator app".
3. Also shows a "Use recovery code" toggle/link that reveals an input for `XXXX-XXXX` format codes.
4. On submit, calls `POST /api/auth/two-factor/verify`.
5. On success, stores JWT and redirects to `/backend`.
6. On failure, shows error message and allows retry.
7. If token is expired (5 min), shows "Session expired, please log in again" with link to `/login`.

### Login 2FA Setup Page (Tenant-Enforced)

**Route:** `/login/two-factor/setup` (auto-discovered from `frontend/login/two-factor/setup.tsx`)

**Behavior:**
1. Reads `token` query parameter.
2. Calls `POST /api/auth/two-factor/setup` with challenge token.
3. Displays QR code and manual secret entry.
4. User enters verification code, calls `POST /api/auth/two-factor/setup/verify`.
5. Shows recovery codes with a "I have saved these codes" confirmation checkbox.
6. On confirmation, issues JWT and redirects.

### Profile 2FA Management Page

**Route:** `/backend/profile/two-factor` (admin backend page)

**Sections:**

**When 2FA is disabled:**
- "Enable Two-Factor Authentication" card with explanation.
- Button starts setup flow (QR code → verify → recovery codes).

**When 2FA is enabled:**
- Status: "Two-factor authentication is active since {date}".
- Recovery codes remaining: `N of 8`.
- "Regenerate recovery codes" button (requires password).
- "Disable two-factor authentication" button (requires password).

### User Management (Admin)

The existing user list page at `/backend/auth/users` shows a 2FA status indicator (badge or icon) for each user. Admins with `auth.users.edit` can reset a user's 2FA via a "Reset 2FA" action button.

---

## i18n Keys

Add to `packages/core/src/modules/auth/i18n/{locale}.json`:

```json
{
  "auth": {
    "twoFactor": {
      "title": "Two-Factor Authentication",
      "description": "Add an extra layer of security to your account using an authenticator app.",
      "enable": "Enable Two-Factor Authentication",
      "disable": "Disable Two-Factor Authentication",
      "enabled": "Two-factor authentication is enabled",
      "disabled": "Two-factor authentication is not enabled",
      "enabledSince": "Active since {date}",
      "setup": {
        "title": "Set Up Two-Factor Authentication",
        "scanQr": "Scan this QR code with your authenticator app",
        "manualEntry": "Or enter this secret manually:",
        "enterCode": "Enter the 6-digit code from your authenticator app",
        "verify": "Verify and Activate"
      },
      "challenge": {
        "title": "Two-Factor Verification",
        "enterCode": "Enter the 6-digit code from your authenticator app",
        "useRecovery": "Use a recovery code instead",
        "enterRecovery": "Enter one of your recovery codes",
        "backToCode": "Use authenticator code",
        "verify": "Verify",
        "expired": "Your verification session has expired. Please log in again.",
        "invalidCode": "Invalid verification code. Please try again."
      },
      "recoveryCodes": {
        "title": "Recovery Codes",
        "description": "Save these recovery codes in a safe place. Each code can only be used once. If you lose access to your authenticator app, you can use a recovery code to sign in.",
        "remaining": "{count} of 8 codes remaining",
        "regenerate": "Regenerate Recovery Codes",
        "regenerateWarning": "This will invalidate all existing recovery codes.",
        "saved": "I have saved these recovery codes",
        "copy": "Copy codes"
      },
      "admin": {
        "reset": "Reset 2FA",
        "resetConfirm": "This will disable two-factor authentication for this user. They will need to set it up again.",
        "status": "2FA Status",
        "active": "Active",
        "inactive": "Inactive"
      },
      "confirmPassword": "Enter your password to confirm",
      "required": "Your organization requires two-factor authentication. Please set it up to continue."
    }
  }
}
```

---

## ACL Changes

Add to `packages/core/src/modules/auth/acl.ts`:

No new dedicated features needed. Admin reset uses existing `auth.users.edit`. 2FA setup/disable uses the user's own session (self-service).

---

## Events

Add to `packages/core/src/modules/auth/events.ts`:

```typescript
{ id: 'auth.two_factor.enabled', label: 'Two-Factor Authentication Enabled', category: 'lifecycle' },
{ id: 'auth.two_factor.disabled', label: 'Two-Factor Authentication Disabled', category: 'lifecycle' },
{ id: 'auth.two_factor.verified', label: 'Two-Factor Code Verified (Login)', category: 'lifecycle', excludeFromTriggers: true },
{ id: 'auth.two_factor.recovery_used', label: 'Recovery Code Used', category: 'lifecycle' },
{ id: 'auth.two_factor.admin_reset', label: 'Two-Factor Reset by Admin', category: 'lifecycle' },
```

---

## Security Considerations

### TOTP Secret Storage
- The TOTP secret is stored encrypted when tenant data encryption is enabled.
- Use `findOneWithDecryption` / `findWithDecryption` when reading `UserTwoFactor`.
- The secret is only returned to the user during the initial setup flow. It is never exposed again via any API.

### Recovery Code Storage
- Recovery codes are bcrypt-hashed (same cost factor as passwords).
- Plaintext codes are shown exactly once during generation and never stored.
- Verification: iterate over unused hashes and `bcryptjs.compare()`.

### Rate Limiting
- The `POST /api/auth/two-factor/verify` endpoint should implement rate limiting: max 5 attempts per challenge token. After 5 failures, the challenge token is invalidated and the user must log in again.
- Recovery code verification counts toward the same limit.

### Challenge Token Security
- Challenge tokens expire after 5 minutes.
- A challenge token with `two_factor_pending = true` cannot be used to access any protected resource.
- Middleware must reject sessions where `two_factor_pending = true` for all routes except the 2FA verification and setup endpoints.

### Audit Trail
- All 2FA events (enable, disable, verify, recovery use, admin reset) are emitted as events and can be captured by the audit log module.

---

## Tenant Configuration

### Config Key

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `auth.twoFactor.required` | `boolean` | `false` | Enforce 2FA for all users in the tenant |

### Admin Settings Page

Add a toggle to the existing auth settings page at `/backend/auth/settings`:
- "Require two-factor authentication for all users"
- When enabled, users who haven't set up 2FA are forced through the setup flow after their next login.

---

## Migration Notes

### Database Migration

New tables:
- `user_two_factors` — stores TOTP secrets and 2FA status.
- `user_recovery_codes` — stores hashed recovery codes.

Modified tables:
- `sessions` — add `two_factor_pending boolean NOT NULL DEFAULT false`.

### Dependencies

Add to `packages/core/package.json`:
```json
{
  "otpauth": "^9.x",
  "qrcode": "^1.x"
}
```

Add `@types/qrcode` to devDependencies.

### Backward Compatibility

- Users without 2FA configured experience zero changes to their login flow.
- The `two_factor_pending` default (`false`) means existing sessions are unaffected.
- API keys bypass 2FA entirely — they are already scoped, expiring, and permission-limited.

---

## Implementation Plan

### Step 1: Data layer
1. Add `UserTwoFactor` and `UserRecoveryCode` entities to `data/entities.ts`.
2. Add `two_factor_pending` field to `Session` entity.
3. Generate database migration.
4. Add Zod validators for 2FA inputs.

### Step 2: TOTP library layer
1. Create `lib/totp.ts` with TOTP helpers wrapping `otpauth`.
2. Create `services/twoFactorService.ts` with all 2FA business logic.
3. Register in `di.ts`.

### Step 3: Login flow changes
1. Modify `api/login.ts` to detect 2FA-enabled users and return challenge tokens.
2. Create `api/two-factor/verify.ts` for TOTP/recovery code verification.
3. Update session middleware to reject `two_factor_pending` sessions.

### Step 4: 2FA setup API
1. Create `api/two-factor/setup.ts` (generate secret + QR).
2. Create `api/two-factor/setup/verify.ts` (verify initial code + activate).
3. Create `api/two-factor/status.ts`, `route.ts` (disable), `recovery-codes.ts`.
4. Create `api/two-factor/admin/reset.ts`.

### Step 5: Frontend — login flow
1. Create `frontend/login/two-factor.tsx` (code entry page).
2. Create `frontend/login/two-factor/setup.tsx` (forced setup page).
3. Modify `frontend/login.tsx` to handle `twoFactorRequired` response.

### Step 6: Frontend — profile management
1. Create `backend/profile/two-factor/page.tsx` (enable/disable/recovery codes).
2. Add 2FA status badge to user list page.
3. Add admin reset button to user detail page.

### Step 7: Events, i18n, config
1. Add events to `events.ts`.
2. Add i18n keys for all supported locales.
3. Add tenant config key for enforcement.
4. Add toggle to auth settings page.

### Step 8: Testing
1. Unit tests for `TwoFactorService` (secret generation, TOTP verification, recovery codes).
2. Unit tests for `lib/totp.ts`.
3. Integration tests for the modified login flow (with and without 2FA).
4. Integration tests for setup, disable, and recovery code flows.
5. Integration tests for admin reset.

---

## Alternatives Considered

### A. WebAuthn / FIDO2

Hardware security key support (YubiKey, etc.) provides the strongest 2FA. **Deferred** — more complex browser APIs, requires credential storage per device. Can be added as a second 2FA method alongside TOTP in a future spec.

### B. SMS / Email OTP

Sending one-time codes via SMS or email. **Rejected for initial implementation** — SMS is expensive, has delivery reliability issues, and is considered less secure (SIM swapping attacks). Email OTP adds complexity without strong security benefit over TOTP. Can be added later if needed.

### C. Mandatory 2FA for all users

Making 2FA mandatory for every account globally. **Rejected** — too aggressive for a self-hosted platform. The tenant-level enforcement toggle gives admins the choice.

### D. Storing recovery codes as plain text

Simpler lookup but insecure at rest. **Rejected** — recovery codes are functionally equivalent to passwords and must be hashed.

### E. Using `speakeasy` library

Popular but unmaintained (last publish 2019). **Rejected** in favor of `otpauth` which is actively maintained, has zero dependencies, and provides the same functionality.

---

## Changelog

### 2026-02-05
- Initial specification
- TOTP-based 2FA with authenticator app support
- Recovery codes with bcrypt hashing
- Optional per-tenant enforcement
- Full API, data model, and UI design
