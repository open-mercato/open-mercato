# SPEC-019: Two-Factor Authentication (2FA) with Authenticator Apps

## Overview

Add optional Two-Factor Authentication to Open Mercato using TOTP (Time-based One-Time Passwords), compatible with Google Authenticator, Microsoft Authenticator, Authy, 1Password, and other standard authenticator apps. 2FA is opt-in per user account — each user decides whether to enable it. Tenant admins can optionally enforce 2FA for all users in their tenant.

## Goals

- Users can enable/disable 2FA on their own account via the profile page.
- The login flow gains a second step when 2FA is active: after email+password, the user must provide a TOTP code.
- Recovery codes are generated at setup time so users can regain access if they lose their authenticator device.
- Tenant admins can enforce 2FA for all users within a tenant.
- API key authentication is unaffected (keys bypass 2FA — they are already scoped and expiring). However, the UI must clearly communicate this, and 2FA should be required when creating or rotating API keys (see Security Considerations).

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
- Each code: 10 alphanumeric characters, grouped as `XXXXXX-XXXXXX` for readability (~52 bits of entropy). This provides strong brute-force resistance even with moderate rate limiting.
- Stored as bcrypt hashes (same cost as passwords) so plaintext is never at rest.
- Shown to the user exactly once during setup — they must save them.
- Each code can be used once, then marked consumed.
- User can regenerate all recovery codes (invalidates existing ones, requires 2FA verification — see 2FA Management endpoints).

---

## Data Model

### New Entity: `UserTwoFactor`

**Table:** `user_two_factors`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | `uuid` | No | PK |
| `user_id` | `uuid` | No | FK → `users.id`, unique |
| `secret` | `text` | No | TOTP secret (base32). **Always encrypted at rest** — encryption is mandatory for this field regardless of whether tenant-wide data encryption is enabled (see Security Considerations) |
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
| `two_factor_verified_at` | `timestamptz` | Yes | Timestamp of the most recent 2FA verification in this session. Used to implement a grace period (e.g. 5 minutes) for sensitive operations like disabling 2FA or regenerating recovery codes, avoiding repeated TOTP prompts |

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
   → Set a short-lived, HttpOnly, Secure, SameSite=Strict cookie
     containing the challengeToken (separate from the normal session cookie)
   → Return { ok: true, twoFactorRequired: true }
   → No JWT issued yet

2. Client redirects to /login/two-factor
   (challengeToken is transmitted automatically via the HttpOnly cookie —
    never in the URL, localStorage, or any client-accessible storage)

3. POST /api/auth/two-factor/verify
   Body: { code: "123456" }
   (challengeToken read from the HttpOnly cookie by the server)
   → Validate TOTP code (or recovery code)
   → Mark session.two_factor_pending = false
   → Clear the challenge cookie
   → Issue JWT, set session cookies
   → Return { ok: true, redirect: '/backend' }
```

### Flow (when 2FA is NOT enabled for the user)

No change. Login works exactly as before.

### Flow (when tenant enforces 2FA but user hasn't set it up)

```
1. POST /api/auth/login (email + password)
   → Credentials valid, 2FA not configured, tenant requires it
   → Create session with two_factor_pending = true
   → Set short-lived HttpOnly challenge cookie (same as above)
   → Return { ok: true, twoFactorSetupRequired: true }

2. Client redirects to /login/two-factor/setup
   (challengeToken transmitted via HttpOnly cookie)
   → User sets up 2FA (scan QR, verify code)
   → On success, session unlocked, challenge cookie cleared, JWT issued
```

### Challenge Token

The `challengeToken` reuses the existing `Session` entity with `two_factor_pending = true`. This session:
- Has a short expiry (5 minutes) for the 2FA challenge phase.
- Cannot be used to access protected resources (middleware rejects `two_factor_pending = true` sessions).
- Is promoted to a full session (standard TTL) once 2FA is verified.

**Transport:** The challenge token is delivered exclusively via a **short-lived, HttpOnly, Secure, SameSite=Strict cookie** (named e.g. `__Host-2fa-challenge`). It is never placed in query strings, `localStorage`, `sessionStorage`, or any client-accessible JavaScript state. This prevents leakage through browser history, `Referer` headers, CDN/proxy logs, or XSS.

**Required response headers on all 2FA routes:**
- `Referrer-Policy: no-referrer` — prevents leaking tokens or QR URIs via Referer.
- `Cache-Control: no-store` — prevents caching of secrets, QR codes, recovery codes, or tokens.

---

## API Endpoints

### 2FA Verification (Login Flow)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/two-factor/verify` | Challenge token | Verify TOTP code or recovery code during login |

**Request:**
```typescript
{
  code: string        // 6-digit TOTP code or recovery code (XXXXX-XXXXX)
}
// challengeToken is read from the HttpOnly cookie by the server
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
| DELETE | `/api/auth/two-factor` | JWT + 2FA | — | Disable 2FA (requires password + TOTP/recovery code) |
| POST | `/api/auth/two-factor/recovery-codes` | JWT + 2FA | — | Regenerate recovery codes (requires password + TOTP/recovery code) |

**`GET /api/auth/two-factor/status`**

```json
{
  "enabled": true,
  "verifiedAt": "2026-02-05T10:30:00Z",
  "recoveryCodesRemaining": 6
}
```

**`DELETE /api/auth/two-factor`**

Disabling 2FA requires both password and a current TOTP code (or recovery code). This prevents an attacker who has only the password and an active session from silently removing the second factor. If the tenant enforces 2FA (`auth.twoFactor.required = true`), users cannot disable 2FA — only a tenant admin can reset it, and the user must then re-enroll.

Request:
```typescript
{
  password: string   // Current password for confirmation
  code: string       // Current TOTP code or recovery code (XXXXX-XXXXX)
}
```

Response:
```json
{ "ok": true }
```

**Tenant enforcement:** If `auth.twoFactor.required` is `true`, this endpoint returns `403` with `{ "ok": false, "error": "Two-factor authentication is required by your organization" }`.

**`POST /api/auth/two-factor/recovery-codes`**

Regenerates all 8 recovery codes (old ones become invalid). Requires both password and a current TOTP code (or a recovery code). Alternatively, if the user has verified 2FA within the last 5 minutes (tracked via a `two_factor_verified_at` timestamp on the session), the TOTP/recovery code can be omitted to avoid repeated prompts.

Request:
```typescript
{
  password: string   // Current password for confirmation
  code?: string      // Current TOTP code or recovery code — optional if 2FA was verified within last 5 minutes
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
| DELETE | `/api/auth/two-factor/admin/reset` | JWT + 2FA | `auth.users.2fa.reset` | Admin resets 2FA for a specific user |

**`DELETE /api/auth/two-factor/admin/reset`**

Allows admins to disable 2FA for a user who has lost their device and recovery codes. This is a sensitive operation with additional safeguards:

- **Dedicated permission:** Requires the `auth.users.2fa.reset` feature (separate from `auth.users.edit`) so it can be granted selectively.
- **Admin re-authentication:** The admin must provide their own password (and their own 2FA code if the admin has 2FA enabled) to confirm the action.
- **Audit logging:** The event `auth.two_factor.admin_reset` records who performed the reset, on which user, when, from which IP, and the reason provided.
- **User notification:** The affected user receives a notification (in-app and optionally email) informing them that their 2FA was reset, by whom, and that they should re-enroll immediately.
- **Reason field:** The admin must provide a reason for the reset (stored in the audit log) to support compliance and incident review.

If the tenant enforces 2FA, the affected user will be required to re-enroll during their next login.

Request:
```typescript
{
  userId: string
  password: string    // Admin's own password for confirmation
  code?: string       // Admin's own TOTP code (required if admin has 2FA enabled)
  reason: string      // Reason for the reset (stored in audit log)
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
1. The challenge token is read automatically from the HttpOnly cookie (no query parameters).
2. Shows a simple form: "Enter the 6-digit code from your authenticator app".
3. Also shows a "Use recovery code" toggle/link that reveals an input for `XXXXXX-XXXXXX` format codes.
4. On submit, calls `POST /api/auth/two-factor/verify` (cookie sent automatically).
5. On success, stores JWT and redirects to `/backend`.
6. On failure, shows error message and allows retry.
7. If token is expired (5 min), shows "Session expired, please log in again" with link to `/login`.

### Login 2FA Setup Page (Tenant-Enforced)

**Route:** `/login/two-factor/setup` (auto-discovered from `frontend/login/two-factor/setup.tsx`)

**Behavior:**
1. The challenge token is read automatically from the HttpOnly cookie (no query parameters).
2. Calls `POST /api/auth/two-factor/setup` (cookie sent automatically).
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
- "Regenerate recovery codes" button (requires password + TOTP code).
- "Disable two-factor authentication" button (requires password + TOTP code). Hidden if tenant enforces 2FA.

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
        "resetReason": "Reason for reset",
        "resetReasonPlaceholder": "e.g. User lost their authenticator device",
        "status": "2FA Status",
        "active": "Active",
        "inactive": "Inactive"
      },
      "confirmPassword": "Enter your password to confirm",
      "confirmCode": "Enter your current 2FA code to confirm",
      "required": "Your organization requires two-factor authentication. Please set it up to continue.",
      "cannotDisableEnforced": "Two-factor authentication is required by your organization and cannot be disabled.",
      "apiKeyWarning": "API keys bypass two-factor authentication. Treat them like passwords."
    }
  }
}
```

---

## ACL Changes

Add to `packages/core/src/modules/auth/acl.ts`:

| Feature | Description |
|---------|-------------|
| `auth.users.2fa.reset` | Allows resetting another user's 2FA. Separate from `auth.users.edit` so it can be granted selectively to trusted admins only. |

2FA setup and disable remain self-service (the user's own session). Declare `auth.users.2fa.reset` in `setup.ts` `defaultRoleFeatures` — granted to the `admin` role by default, not granted to `manager` or other roles.

---

## Events

Add to `packages/core/src/modules/auth/events.ts`:

```typescript
{ id: 'auth.two_factor.enabled', label: 'Two-Factor Authentication Enabled', category: 'lifecycle' },
{ id: 'auth.two_factor.disabled', label: 'Two-Factor Authentication Disabled', category: 'lifecycle' },
{ id: 'auth.two_factor.verified', label: 'Two-Factor Code Verified (Login)', category: 'lifecycle', excludeFromTriggers: true },
{ id: 'auth.two_factor.recovery_used', label: 'Recovery Code Used', category: 'lifecycle' },
{ id: 'auth.two_factor.admin_reset', label: 'Two-Factor Reset by Admin', category: 'lifecycle' },  // includes: adminUserId, targetUserId, reason, sourceIp
```

---

## Security Considerations

### TOTP Secret Storage
- The TOTP secret is **always encrypted at rest**, regardless of whether tenant-wide data encryption is enabled. If the database leaks and secrets are stored in plaintext, an attacker can recreate valid TOTP codes for every user, effectively bypassing 2FA entirely. Encryption of this field must be unconditional.
- Use `findOneWithDecryption` / `findWithDecryption` when reading `UserTwoFactor`.
- The secret is only returned to the user during the initial setup flow. It is never exposed again via any API.

### Recovery Code Storage
- Recovery codes are bcrypt-hashed (same cost factor as passwords).
- Plaintext codes are shown exactly once during generation and never stored.
- Verification: iterate over unused hashes and `bcryptjs.compare()`.

### Rate Limiting

Rate limiting on 2FA verification endpoints is critical — the combination of recovery code length and rate limit determines the practical brute-force resistance.

Uses the shared rate limiting library from `@open-mercato/shared/lib/ratelimit` (see SPEC-022). All 2FA endpoints use **handler-level enforcement** (not metadata-driven) because they need compound keys that include the challenge token or user identity, not just client IP.

**Integration pattern** (same as `login.ts`, `reset.ts` in the auth module):

```typescript
import { getCachedRateLimiterService } from '../../bootstrap'
import { checkRateLimit, getClientIp, readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit'

// Module-level config — env-overridable with hardcoded defaults
const twoFactorVerifyRateLimitConfig = readEndpointRateLimitConfig('2FA_VERIFY', {
  points: 5, duration: 300, blockDuration: 300, keyPrefix: '2fa-verify',
})

export const metadata = {} // no dispatcher-level enforcement

export async function POST(req: Request) {
  // ... read challengeToken from HttpOnly cookie, parse body ...
  try {
    const rateLimiterService = getCachedRateLimiterService()
    if (rateLimiterService) {
      const clientIp = getClientIp(req)
      const compoundKey = `${clientIp}:${challengeTokenId}`
      const rateLimitError = await checkRateLimit(
        rateLimiterService,
        twoFactorVerifyRateLimitConfig,
        compoundKey,
        translate('api.errors.rateLimit', 'Too many requests. Please try again later.'),
      )
      if (rateLimitError) return rateLimitError // 429 with Retry-After + X-RateLimit-* headers
    }
  } catch {
    // fail-open: rate limiter failures never block critical auth flows
  }
  // ... rest of handler ...
}
```

**Per-endpoint configurations:**

| Endpoint | Env prefix | Default | Key strategy | Behavior on exhaust |
|----------|-----------|---------|-------------|-------------------|
| `POST /api/auth/two-factor/verify` | `2FA_VERIFY` | 5 req / 300s, block 300s | `IP:challengeTokenId` | Invalidate challenge token, return 429 |
| `POST /api/auth/two-factor/setup/verify` | `2FA_SETUP_VERIFY` | 5 req / 300s, block 300s | `IP:challengeTokenId` | Same as above |
| `DELETE /api/auth/two-factor` | `2FA_DISABLE` | 5 req / 300s, block 300s | `IP:userId` | Return 429 |
| `POST /api/auth/two-factor/recovery-codes` | `2FA_RECOVERY_REGEN` | 3 req / 300s, block 300s | `IP:userId` | Return 429 |
| `DELETE /api/auth/two-factor/admin/reset` | `2FA_ADMIN_RESET` | 3 req / 300s, block 300s | `IP:adminUserId` | Return 429 |

Environment variables follow the `RATE_LIMIT_{PREFIX}_POINTS`, `RATE_LIMIT_{PREFIX}_DURATION`, `RATE_LIMIT_{PREFIX}_BLOCK_DURATION` convention from `readEndpointRateLimitConfig()`.

**Challenge token invalidation on exhaust:**

When the `2fa-verify` or `2fa-setup-verify` limiter is exhausted, the handler must also invalidate the challenge token (mark `session.two_factor_pending` as expired) so the user is forced to restart the login flow. This is done inside the handler after detecting `rateLimitError`, not inside the rate limiter itself.

**OpenAPI:** All rate-limited 2FA endpoints must declare a `429` error in their `openApi` export:

```typescript
const rateLimitErrorSchema = z.object({
  error: z.string().describe('Rate limit exceeded message'),
})

// In openApi.methods.POST.errors:
{ status: 429, description: 'Too many verification attempts', schema: rateLimitErrorSchema }
```

**Optional future enhancement:**
- Heuristic-based stricter limits for suspicious source IPs (known datacenter ranges, Tor exit nodes, etc.).

### Challenge Token Security
- Challenge tokens expire after 5 minutes.
- A challenge token with `two_factor_pending = true` cannot be used to access any protected resource.
- Middleware must reject sessions where `two_factor_pending = true` for all routes except the 2FA verification and setup endpoints (see Middleware Allowlist below).

### JWT / Session Token Storage

The token storage mechanism determines XSS and CSRF risk profiles. The implementation must follow one of these two approaches:

1. **(Recommended) HttpOnly cookie-based sessions:** The JWT or session token is stored exclusively in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. CSRF protection is provided by `SameSite` plus a CSRF token for state-changing requests. This is the preferred approach because JavaScript cannot access the token, eliminating XSS-based token theft.

2. **Bearer token in application memory:** The JWT is kept in JavaScript memory only (never `localStorage` or `sessionStorage`) and sent as a `Bearer` header. Requires a refresh-token flow (refresh token in an HttpOnly cookie) and strong XSS protections. This approach is acceptable but carries higher risk if XSS mitigations fail.

**Never store JWTs or session tokens in `localStorage` or `sessionStorage`** — these are accessible to any script running on the page and trivially exfiltrable via XSS.

### Middleware Allowlist for `two_factor_pending` Sessions

When a session has `two_factor_pending = true`, the middleware must enforce a strict allowlist of accessible endpoints. Everything else must return `401 Unauthorized`. The allowlist:

- `POST /api/auth/two-factor/verify` — verify TOTP/recovery code during login
- `POST /api/auth/two-factor/setup` — generate secret + QR (for tenant-enforced setup)
- `POST /api/auth/two-factor/setup/verify` — verify initial code during forced setup
- `POST /api/auth/logout` — allow the user to abandon the login attempt
- `GET /login/two-factor` — the 2FA challenge page (frontend)
- `GET /login/two-factor/setup` — the forced setup page (frontend)

This restriction must apply uniformly across all authorization mechanisms: REST API, SSR page loads, WebSocket connections, file downloads, and any other request pathway.

### API Keys and 2FA Bypass

API keys bypass 2FA by design (they are already scoped, permission-limited, and expiring). However, this must be explicitly communicated and mitigated:

- **UI warning:** The API key creation dialog must display a prominent warning: "API keys bypass two-factor authentication. Treat them like passwords."
- **2FA required for key management:** Creating, rotating, or deleting API keys requires a current TOTP code (or recovery code) if the user has 2FA enabled.
- **Documentation:** The API key documentation page must state that keys bypass 2FA and recommend setting short lifetimes and IP allowlists for high-security environments.
- **Future enhancements (out of scope):** API key IP allowlisting, configurable key lifetime policies.

### Audit Trail
- All 2FA events (enable, disable, verify, recovery use, admin reset) are emitted as events and can be captured by the audit log module.
- Admin 2FA resets additionally record: who performed the reset, the target user, the source IP, and the stated reason.

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
- `sessions` — add `two_factor_pending boolean NOT NULL DEFAULT false` and `two_factor_verified_at timestamptz NULL`.

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
- API keys bypass 2FA entirely — they are already scoped, expiring, and permission-limited. The UI now warns about this when creating keys.

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

### 2026-02-09
- **Security hardening** based on review feedback:
  - Challenge token now delivered via HttpOnly/Secure/SameSite=Strict cookie instead of URL query string (prevents leakage via browser history, Referer headers, CDN/proxy logs)
  - Required `Referrer-Policy: no-referrer` and `Cache-Control: no-store` headers on all 2FA routes
  - TOTP secret is now always encrypted at rest, regardless of tenant encryption setting
  - Disabling 2FA and regenerating recovery codes now require 2FA verification (TOTP or recovery code), not just password — prevents 2FA bypass after password compromise
  - If tenant enforces 2FA, users cannot disable it (admin must reset, then user re-enrolls)
  - Added `two_factor_verified_at` session field for 5-minute grace period on sensitive operations
  - Admin 2FA reset now requires dedicated `auth.users.2fa.reset` permission, admin re-authentication, a reason field, user notification, and full audit logging
  - Explicit middleware allowlist for `two_factor_pending` sessions (only 2FA verify/setup and logout endpoints accessible)
  - Added JWT/session token storage security guidance (HttpOnly cookie recommended, never localStorage)
  - Rate limiting rewritten to use the shared `@open-mercato/shared/lib/ratelimit` library (SPEC-022 / PR #521): handler-level enforcement with `checkRateLimit()`, compound keys (`IP:challengeTokenId`, `IP:userId`), `readEndpointRateLimitConfig()` for env-overridable defaults, fail-open pattern, 429 + `Retry-After`/`X-RateLimit-*` headers, OpenAPI 429 error schemas
  - Recovery codes increased from 8 to 10 alphanumeric characters (`XXXXX-XXXXX`, ~52 bits entropy)
  - API keys: UI warning that keys bypass 2FA, 2FA required to create/rotate keys
  - New i18n keys for 2FA code confirmation, admin reset reason, enforcement messaging, API key warning

### 2026-02-05
- Initial specification
- TOTP-based 2FA with authenticator app support
- Recovery codes with bcrypt hashing
- Optional per-tenant enforcement
- Full API, data model, and UI design
