# SPEC-ENT-001: Security Module (Enterprise MFA, Sudo, Enforcement)

> **Supersedes:** #496 (feat: add 2FA — implement SPEC-019)
> **Labels:** `enterprise`, `feature`, `security`
> **Module:** `packages/enterprise/src/modules/security/`

## Summary

Add a dedicated `security` module to `@open-mercato/enterprise` delivering enterprise-grade multi-factor authentication, sudo re-authentication challenges, MFA enforcement policies, and a pluggable MFA provider registry. This replaces the scope of #496 (SPEC-019) which covers only TOTP-based 2FA — this proposal extends that foundation with passkeys/WebAuthn, OTP email, tenant-scoped enforcement, a sudo challenge system for critical operations, and an extensibility layer so third-party modules can contribute custom MFA methods.

### Why this matters

The existing auth module provides JWT-based login, cookie sessions, API key auth, role-based ACL, and password hashing. It does not offer multi-factor authentication, sudo re-authentication challenges, or a user-facing profile/security management page. Enterprise customers require defence-in-depth security: MFA enrollment, enforcement policies at tenant and organisation scope, and elevated re-authentication for critical operations.

### Relationship to #496 (SPEC-019)

SPEC-019 covers TOTP-only 2FA with a `UserTwoFactor` entity, 8 recovery codes, and session-based challenge tokens. This proposal:

- **Keeps everything from SPEC-019** — RFC 6238 TOTP with `otpauth` library, QR code enrollment, authenticator app support, and recovery codes
- **Adds two more built-in methods** — WebAuthn/passkeys and OTP email
- **Adds a pluggable provider architecture** — `MfaProviderInterface` so modules can register custom MFA methods (SMS, push notifications, hardware tokens) that are auto-discovered at bootstrap
- **Adds MFA enforcement** — superadmin-configurable policies at platform, tenant, or organisation scope with grace periods and compliance reporting
- **Adds a sudo challenge system** — re-authentication for critical operations with both a server middleware (`requireSudo`) and a React hook (`useSudoChallenge`) for module developers
- **Adds admin MFA management** — user MFA reset, compliance dashboards, bulk status checks
- **Uses 10 recovery codes** instead of 8, and stores them in a separate table with individual bcrypt hashes
- **Replaces the `UserTwoFactor` entity** with a more extensible `UserMfaMethod` entity using a free-form `type` column and `provider_metadata` JSONB column for provider-specific data

SPEC-019 should be updated or replaced with a new spec reflecting this broader scope.

---

## Capabilities

### 1. Extensible profile page

Profile page at `backend/profile/page.tsx` with password management and widget injection points (`security.profile.sections`, `security.profile.sidebar`) so other modules can extend the profile with their own sections (e.g. "API Keys", "Connected Apps").

### 2. Multi-factor authentication

Three built-in MFA methods plus a pluggable provider registry:

| Provider type | Class | Description |
|---|---|---|
| `totp` | `TotpProvider` | RFC 6238 authenticator apps (Google Authenticator, Authy, etc.) |
| `passkey` | `PasskeyProvider` | WebAuthn/FIDO2 platform and roaming authenticators |
| `otp_email` | `OtpEmailProvider` | 6-digit codes sent via Resend email service |

Users can enroll multiple methods of different types. Multiple instances of the same type are supported where appropriate (e.g. multiple passkeys, but only one email). Recovery codes (10 per user, bcrypt-hashed individually) are generated on first MFA enrollment.

### 3. Pluggable MFA provider architecture

Every MFA method — built-in or custom — implements `MfaProviderInterface`:

```typescript
export interface MfaProviderInterface {
  readonly type: string           // unique identifier stored in user_mfa_methods.type
  readonly label: string          // human-readable label shown in UI
  readonly icon: string           // Lucide icon identifier
  readonly allowMultiple: boolean
  readonly setupSchema: z.ZodSchema
  readonly verifySchema: z.ZodSchema

  setup(userId: string, payload: unknown): Promise<{ setupId: string; clientData: Record<string, unknown> }>
  confirmSetup(userId: string, setupId: string, payload: unknown): Promise<{ metadata: Record<string, unknown> }>
  prepareChallenge(userId: string, method: UserMfaMethod): Promise<{ clientData?: Record<string, unknown> }>
  verify(userId: string, method: UserMfaMethod, payload: unknown): Promise<boolean>

  SetupComponent?: React.ComponentType<MfaSetupComponentProps>    // optional custom setup UI
  VerifyComponent?: React.ComponentType<MfaVerifyComponentProps>  // optional custom verify UI
}
```

Third-party modules register custom providers via `mfaProviders` arrays in their `setup.ts`. The security module auto-discovers these at bootstrap (same pattern as `sudoProtected` scanning). Generic fallback UI components (`GenericProviderSetup`, `GenericProviderVerify`) render forms based on the provider's Zod schema when no custom React components are provided.

Example third-party registration:

```typescript
// In a hypothetical @open-mercato/push-auth module's setup.ts
export const setup: ModuleSetupConfig = {
  name: 'push-auth',
  label: 'Push Authentication',
  mfaProviders: [{
    type: 'push_notification',
    label: 'Push Notification',
    icon: 'Bell',
    allowMultiple: false,
    setupSchema: pushSetupSchema,
    verifySchema: pushVerifySchema,
    setup: PushNotificationProvider.setup,
    confirmSetup: PushNotificationProvider.confirmSetup,
    prepareChallenge: PushNotificationProvider.prepareChallenge,
    verify: PushNotificationProvider.verify,
    SetupComponent: PushSetupWizard,
    VerifyComponent: PushVerifyPrompt,
  }],
}
```

### 4. MFA enforcement

Superadmins can create enforcement policies scoped to platform, tenant, or organisation. Policies support:

- Restricting allowed MFA methods via `allowed_methods` (works with both built-in and custom provider types)
- Grace period with `enforcement_deadline` — users redirected to MFA setup after login; locked out entirely after deadline
- Compliance reporting — enrolled vs unenrolled user counts per scope
- Policy cascade: organisation → tenant → platform (most specific wins)

### 5. Sudo challenge system

Re-authentication for critical operations, configurable by both developers and superadmins.

**Developer API (server-side):**

```typescript
import { requireSudo } from '@open-mercato/enterprise/security'

export async function DELETE(req: NextRequest) {
  await requireSudo(req, 'auth.roles.delete')
  // proceed with protected operation
}
```

**Developer API (client-side):**

```typescript
import { useSudoChallenge } from '@open-mercato/enterprise/security/components'

function DeleteRoleButton({ roleId }: { roleId: string }) {
  const { requireSudo } = useSudoChallenge()
  const handleDelete = async () => {
    const sudoToken = await requireSudo('auth.roles.delete')
    if (!sudoToken) return // user cancelled
    await fetch(`/api/auth/roles/${roleId}`, {
      method: 'DELETE',
      headers: { 'X-Sudo-Token': sudoToken },
    })
  }
  return <button onClick={handleDelete}>Delete Role</button>
}
```

**Developer defaults** — modules declare sudo-protected targets in `setup.ts` via `sudoProtected` arrays. These are auto-discovered at bootstrap and registered with `is_developer_default: true`. Superadmins can override them.

**Sudo tokens** — HMAC-SHA256 signed, dual-validated (crypto + DB lookup), default 5-min TTL (configurable 1–30 min per target).

### 6. MFA admin management

Superadmin capabilities: reset user MFA (with reason logging and notification), view individual user MFA status, bulk compliance checks per tenant, security dashboard with platform-wide adoption stats.

---

## Architecture

### Module placement

Standard enterprise module at `packages/enterprise/src/modules/security/` following all existing conventions: auto-discovered pages, routes, subscribers, entities.

### Integration points (no auth module modification)

| Integration | Mechanism | Notes |
|---|---|---|
| Auth module | Foreign key (`userId`) | No direct ORM relationships — foreign key only |
| Directory module | Foreign key (`tenantId`, `orgId`) | Enforcement policies scoped to tenants/orgs |
| Profile UI | Widget injection | Password change and MFA sections injected into profile page |
| Sudo protection | Shared library export | `requireSudo` middleware + `useSudoChallenge` hook |
| Audit trail | Event system | All security actions emit events consumed by `audit_logs` |
| Email delivery | Resend (existing) | OTP codes, MFA enrollment confirmations, enforcement deadline reminders |
| Custom MFA providers | MFA provider registry | Auto-discovered via `mfaProviders` in module `setup.ts` |

### Auth flow integration

The login flow is extended **without modifying the auth module**. A security module event subscriber listens to `auth.login.success`:

1. User submits credentials to `POST /api/auth/login` (unchanged)
2. Auth module validates and emits `auth.login.success`
3. Security subscriber checks for active MFA methods
4. If MFA enabled → response modified to `{ mfa_required: true, challenge_id, available_methods }`
5. Client presents MFA challenge UI (TOTP input, passkey prompt, OTP email, or custom provider UI)
6. User verifies via `POST /api/security/mfa/verify`
7. Full JWT issued with `mfa_verified: true` claim

Two backwards-compatible JWT claims added: `mfa_verified: boolean` and `mfa_methods: string[]`.

---

## Data model

### Tables (6 new tables, no ALTER on existing)

**`user_mfa_methods`** — stores each MFA method per user with free-form `type` text column (no CHECK constraint — extensible for custom providers), `provider_metadata` JSONB for provider-specific data, encrypted `secret` for TOTP. Indexed on `(user_id, type, is_active)`.

```sql
CREATE TABLE "user_mfa_methods" (
  "id"                uuid        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"           uuid        NOT NULL,
  "tenant_id"         uuid        NOT NULL,
  "organization_id"   uuid        NULL,
  "type"              text        NOT NULL,
  "label"             text        NULL,
  "secret"            text        NULL,
  "provider_metadata" jsonb       NULL,
  "is_active"         boolean     NOT NULL DEFAULT true,
  "last_used_at"      timestamptz NULL,
  "created_at"        timestamptz NOT NULL,
  "updated_at"        timestamptz NOT NULL,
  "deleted_at"        timestamptz NULL,
  PRIMARY KEY ("id")
);
```

**`mfa_recovery_codes`** — 10 bcrypt-hashed codes per user, individually marked as used.

**`mfa_enforcement_policies`** — scope-based (`platform`/`tenant`/`organisation`) enforcement rules with allowed methods filter and deadline.

**`sudo_challenge_configs`** — defines sudo-protected targets (by package, module, route, or feature) with developer defaults and admin overrides.

**`sudo_sessions`** — active sudo tokens with HMAC-SHA256 signature, expiry tracking.

**`mfa_challenges`** — temporary challenge records for login/sudo MFA verification with attempt counting and 10-min TTL.

---

## API endpoints

### Profile & password (2 endpoints)

| Method | Endpoint | Feature |
|---|---|---|
| `GET` | `/api/security/profile` | `security.profile.view` |
| `PUT` | `/api/security/profile/password` | `security.profile.password` |

### MFA management (13 endpoints)

| Method | Endpoint | Feature |
|---|---|---|
| `GET` | `/api/security/mfa/methods` | `security.mfa.view` |
| `POST` | `/api/security/mfa/totp/setup` | `security.mfa.manage` |
| `POST` | `/api/security/mfa/totp/confirm` | `security.mfa.manage` |
| `POST` | `/api/security/mfa/passkey/register-options` | `security.mfa.manage` |
| `POST` | `/api/security/mfa/passkey/register` | `security.mfa.manage` |
| `POST` | `/api/security/mfa/otp-email/setup` | `security.mfa.manage` |
| `POST` | `/api/security/mfa/provider/:type/setup` | `security.mfa.manage` |
| `POST` | `/api/security/mfa/provider/:type/confirm` | `security.mfa.manage` |
| `GET` | `/api/security/mfa/providers` | `security.mfa.view` |
| `DELETE` | `/api/security/mfa/methods/:id` | `security.mfa.manage` |
| `POST` | `/api/security/mfa/verify` | (public — requires `challenge_id`) |
| `POST` | `/api/security/mfa/recovery` | (public — requires `challenge_id`) |
| `POST` | `/api/security/mfa/recovery-codes/regenerate` | `security.mfa.manage` |

### MFA enforcement — superadmin (7 endpoints)

| Method | Endpoint | Feature |
|---|---|---|
| `GET` | `/api/security/enforcement` | `security.enforcement.view` |
| `POST` | `/api/security/enforcement` | `security.enforcement.manage` |
| `PUT` | `/api/security/enforcement/:id` | `security.enforcement.manage` |
| `DELETE` | `/api/security/enforcement/:id` | `security.enforcement.manage` |
| `GET` | `/api/security/enforcement/compliance` | `security.enforcement.view` |
| `POST` | `/api/security/users/:id/mfa/reset` | `security.admin.mfa-reset` |
| `GET` | `/api/security/users/:id/mfa/status` | `security.admin.view` |

### Sudo challenge (6 endpoints)

| Method | Endpoint | Feature |
|---|---|---|
| `POST` | `/api/security/sudo/challenge` | (authenticated) |
| `POST` | `/api/security/sudo/verify` | (authenticated) |
| `GET` | `/api/security/sudo/configs` | `security.sudo.view` |
| `POST` | `/api/security/sudo/configs` | `security.sudo.manage` |
| `PUT` | `/api/security/sudo/configs/:id` | `security.sudo.manage` |
| `DELETE` | `/api/security/sudo/configs/:id` | `security.sudo.manage` |

---

## Service layer

| Service | Responsibility |
|---|---|
| `PasswordService` | Password change, policy validation, bcrypt hashing |
| `MfaService` | MFA method lifecycle — delegates to `MfaProviderRegistry` for all provider-specific operations |
| `MfaVerificationService` | Challenge creation, preparation, and verification — routes through provider registry |
| `MfaEnforcementService` | Enforcement policy CRUD, scope resolution cascade, compliance checking |
| `SudoChallengeService` | Sudo challenge lifecycle, HMAC-SHA256 token issuance, dual validation, developer default registration |
| `MfaAdminService` | Superadmin operations — user MFA reset, status, bulk compliance |

All services are Awilix request-scoped. `MfaProviderRegistry` is a singleton injected as a value.

---

## Pages

All views live under the `backend/` path.

| Page | Description |
|---|---|
| `backend/security/page.tsx` | Security dashboard — MFA adoption stats |
| `backend/profile/page.tsx` | Extensible profile page with widget injection points |
| `backend/profile/mfa/page.tsx` | MFA management — dynamically renders providers from registry |
| `backend/profile/mfa/setup-totp/page.tsx` | TOTP setup wizard with QR code |
| `backend/profile/mfa/setup-passkey/page.tsx` | Passkey registration via WebAuthn |
| `backend/security/enforcement/page.tsx` | Enforcement policy management |
| `backend/security/sudo/page.tsx` | Sudo challenge configuration with tree view |
| `backend/security/users/page.tsx` | User security management with MFA status table |

### Shared components

`SudoChallengeModal`, `SudoProvider`, `MfaMethodCard`, `TotpSetupWizard`, `PasskeySetupFlow`, `GenericProviderSetup`, `GenericProviderVerify`, `PasswordChangeForm`, `EnforcementPolicyForm`, `MfaComplianceBadge`, `RecoveryCodesDisplay`

Hooks: `useSudoChallenge`, `useMfaStatus`

---

## Dependencies

| Package | Purpose |
|---|---|
| `otpauth` ^9.x | RFC 6238 TOTP generation and verification |
| `@simplewebauthn/server` ^11.x | Server-side WebAuthn registration and authentication |
| `@simplewebauthn/browser` ^11.x | Client-side WebAuthn API wrapper |
| `qrcode` ^1.x | QR code generation for TOTP provisioning URIs |

Existing dependencies leveraged: `bcryptjs`, `@open-mercato/shared`, `zod`, `@mikro-orm/core`, `pg`, Redis.

---

## Environment variables

```env
SECURITY_TOTP_ISSUER=Open Mercato
SECURITY_TOTP_WINDOW=1
SECURITY_OTP_EXPIRY_SECONDS=600
SECURITY_OTP_MAX_ATTEMPTS=5
SECURITY_SUDO_DEFAULT_TTL=300
SECURITY_SUDO_MAX_TTL=1800
SECURITY_WEBAUTHN_RP_NAME=Open Mercato
SECURITY_WEBAUTHN_RP_ID=
SECURITY_RECOVERY_CODE_COUNT=10
SECURITY_MFA_EMERGENCY_BYPASS=false
```

---

## Security considerations

- **TOTP:** secrets encrypted at rest via tenant-scoped Vault keys; replay prevention via Redis; 1-window time tolerance
- **WebAuthn:** credential public keys encrypted; signature counter validation; origin/RP ID enforcement
- **OTP email:** codes bcrypt-hashed; bound to challenge sessions; rate limited (3 per 10 min)
- **Custom providers:** validated against interface at registration; provider-specific data encrypted at rest via field-level encryption; providers responsible for own verification security
- **Sudo tokens:** HMAC-SHA256 signed; dual validation (crypto + DB); default 5-min TTL; scoped to user session
- **Recovery codes:** `crypto.randomBytes` generated; individually bcrypt-hashed; shown once only; usage triggers notification
- **Rate limiting:** all verification attempts limited via Redis counters (MFA: 5 per challenge, password: 5 per hour, sudo: 3 per session)

---

## Legacy SPEC-019 carry-over requirements

The following requirements from OSS SPEC-019 remain mandatory and must be preserved when implementing this enterprise scope:

- TOTP baseline parameters: SHA-1, 6 digits, 30-second period, 20-byte secret, ±1 window
- Challenge identifiers and secrets MUST NOT be transported via URL query params, localStorage, or sessionStorage
- Use short-lived, secure, HttpOnly, SameSite cookies for session-bound challenge transport
- `Cache-Control: no-store` on MFA challenge/setup verification responses
- `Referrer-Policy: no-referrer` on MFA challenge/setup routes
- TOTP secrets are always encrypted at rest regardless of optional tenant encryption toggle state
- Recovery codes are shown exactly once and stored only as bcrypt hashes
- Rate-limiting on verification endpoints must use Redis-backed counters
- Rate-limiter infrastructure failures should fail-open to avoid hard auth outage

---

## Risk assessment

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| WebAuthn browser compatibility | Medium | Low | SimpleWebAuthn polyfills; graceful degradation to TOTP; feature detection |
| Login flow regression | Critical | Medium | Event subscriber pattern (no auth module changes); feature flag; comprehensive tests |
| Clock drift affecting TOTP | Low | Medium | 1-window tolerance; NTP sync; user-facing time sync message |
| Enforcement lockout | High | Low | Grace period with deadline; superadmin MFA reset; emergency bypass env flag |
| Sudo token forgery | Critical | Very Low | HMAC-SHA256 + DB lookup; short TTL |
| Migration on large user bases | Medium | Low | New tables only (no ALTER); additive, non-blocking |
| Recovery code exhaustion | Medium | Medium | Notifications at 3 and 1 remaining; regeneration available; admin reset |
| Malicious custom MFA provider | Medium | Low | Interface validation at registration; same trust boundary as module code; code review required |

---

## Implementation phases

### Phase 1: Foundation

- [ ] Scaffold module structure (all standard files)
- [ ] Create MikroORM entities (6 entities) and database migration
- [ ] Implement `PasswordService`
- [ ] Build profile page with widget injection points
- [ ] Build `PasswordChangeForm` component
- [ ] Profile/password API endpoints with OpenAPI specs
- [ ] Feature permissions and role setup (`setup.ts`, `acl.ts`)
- [ ] Event definitions and audit subscribers
- [ ] Unit tests for `PasswordService`

### Phase 2: MFA core

- [ ] Implement `MfaProviderInterface` and `MfaProviderRegistry`
- [ ] Implement `TotpProvider` (built-in)
- [ ] Implement `PasskeyProvider` (built-in)
- [ ] Implement `OtpEmailProvider` (built-in)
- [ ] `MfaService` (unified service delegating to registry)
- [ ] `MfaVerificationService` (unified verifier via registry)
- [ ] Recovery code generation and verification
- [ ] Auth login flow integration (event subscriber)
- [ ] MFA management page + setup wizards (TOTP, passkey)
- [ ] `GenericProviderSetup` + `GenericProviderVerify` components
- [ ] MFA API endpoints including `/providers` and `/provider/:type/*`
- [ ] Bootstrap auto-discovery for `mfaProviders` in module setup
- [ ] Integration tests for all MFA flows

### Phase 3: Enforcement and admin

- [ ] `MfaEnforcementService`
- [ ] Enforcement redirect middleware
- [ ] `MfaAdminService` (reset, status, bulk check)
- [ ] Enforcement API endpoints
- [ ] Admin enforcement management page
- [ ] Admin user security management page
- [ ] Security dashboard page
- [ ] Enforcement notification handlers (deadline reminders)
- [ ] Tests for enforcement and admin flows

### Phase 4: Sudo system and polish

- [ ] `SudoChallengeService`
- [ ] Sudo validation middleware (`requireSudo`)
- [ ] `SudoChallengeModal` component
- [ ] `useSudoChallenge` hook + `SudoProvider`
- [ ] Admin sudo configuration page
- [ ] Developer default registration during bootstrap
- [ ] `withSudoProtection` HOC
- [ ] Complete i18n translations (`i18n/en.json`)
- [ ] Email templates (OTP, MFA changes, enforcement)
- [ ] End-to-end integration tests
- [ ] Security audit and hardening review

---

## File manifest

```text
packages/enterprise/src/modules/security/
├── index.ts                                  # Public API exports
├── setup.ts                                  # Module init, role features, sudo defaults
├── acl.ts                                    # Feature permission definitions
├── di.ts                                     # Awilix DI registration
├── events.ts                                 # Event type definitions
├── types.ts                                  # TypeScript interfaces and types
├── notifications.ts                          # Notification handler registrations
├── data/
│   ├── entities.ts                           # MikroORM entities (6)
│   └── validators.ts                         # Zod schemas
├── migrations/
│   └── Migration[timestamp].ts
├── services/
│   ├── PasswordService.ts
│   ├── MfaService.ts
│   ├── MfaVerificationService.ts
│   ├── MfaEnforcementService.ts
│   ├── MfaAdminService.ts
│   └── SudoChallengeService.ts
├── lib/
│   ├── mfa-provider-interface.ts
│   ├── mfa-provider-registry.ts
│   ├── sudo-middleware.ts
│   ├── otp.ts
│   └── providers/
│       ├── TotpProvider.ts
│       ├── PasskeyProvider.ts
│       └── OtpEmailProvider.ts
├── api/
│   ├── profile/route.ts
│   ├── mfa/route.ts
│   ├── enforcement/route.ts
│   ├── sudo/route.ts
│   ├── admin/route.ts
│   └── openapi.ts
├── backend/
│   ├── profile/
│   │   ├── page.tsx                          # User profile page (extensible)
│   │   └── mfa/
│   │       ├── page.tsx                      # MFA management page
│   │       ├── setup-totp/page.tsx           # TOTP setup wizard
│   │       └── setup-passkey/page.tsx        # Passkey registration flow
│   └── security/
│       ├── page.tsx                          # Security dashboard
│       ├── enforcement/page.tsx              # Enforcement management
│       ├── sudo/page.tsx                     # Sudo configuration
│       └── users/page.tsx                    # User security management
├── components/
│   ├── SudoChallengeModal.tsx
│   ├── SudoProvider.tsx
│   ├── MfaMethodCard.tsx
│   ├── TotpSetupWizard.tsx
│   ├── PasskeySetupFlow.tsx
│   ├── GenericProviderSetup.tsx
│   ├── GenericProviderVerify.tsx
│   ├── PasswordChangeForm.tsx
│   ├── EnforcementPolicyForm.tsx
│   ├── MfaComplianceBadge.tsx
│   ├── RecoveryCodesDisplay.tsx
│   └── hooks/
│       ├── useSudoChallenge.ts
│       └── useMfaStatus.ts
├── widgets/
│   ├── injection/profile-sections.ts
│   └── dashboard/security-stats.ts
├── subscribers/
│   ├── audit.ts
│   ├── notification.ts
│   └── auth-login.ts
├── emails/
│   ├── otp-code.tsx
│   ├── mfa-enrolled.tsx
│   ├── mfa-reset.tsx
│   └── enforcement-deadline.tsx
└── i18n/
    └── en.json
```

---

## References

- OSS SPEC-019 (legacy baseline): `/Users/piotrkarwatka/Projects/mercato-development/.ai/specs/SPEC-019-2026-02-05-two-factor-authentication.md`
- [#496](https://github.com/open-mercato/open-mercato/issues/496) — original 2FA feature request (SPEC-019, TOTP-only scope)

## Changelog

### 2026-02-17
- Initial enterprise security module specification created as `SPEC-ENT-001` in `.ai/specs/enterprise`.

### 2026-02-18
- Aligned spec content with the full detailed proposal superseding #496.
- Added explicit legacy SPEC-019 carry-over requirements to avoid security regressions.
