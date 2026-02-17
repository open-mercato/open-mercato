# ADR: Security Module for @open-mercato/enterprise

**Status:** Accepted
**Date:** 2026-02-11
**Package:** `packages/enterprise/src/modules/security/`
**Framework:** Next.js 16, React 19, MikroORM 6, PostgreSQL, Redis
**Estimated effort:** 8–10 weeks (single senior developer)

---

## 1. Context

Open Mercato is a multi-tenant, AI-supportive enterprise platform for building CRMs, ERPs, and commerce backends. The existing authentication system (`packages/core/src/modules/auth/`) provides JWT-based login, cookie sessions, API key auth, role-based access control, and password hashing via bcryptjs. It does **not** currently offer multi-factor authentication, sudo re-authentication challenges, or a user-facing profile/security management page.

Enterprise customers require defence-in-depth security: MFA enrollment, enforcement policies at tenant and organisation scope, and elevated re-authentication for critical operations. Third-party module developers need a simple API to protect their own critical sections with sudo challenges.

This ADR defines a new **security** module inside the enterprise package that delivers these capabilities while respecting Open Mercato's architectural principles: isomorphic module independence, widget injection for cross-module UI, feature-based ACL, event-driven audit, and foreign-key-only relationships between modules.

---

## 2. Decision

We will implement a `security` module at `packages/enterprise/src/modules/security/` that provides six capabilities:

1. **Extensible profile page** with password management and widget injection points for other modules.
2. **Multi-factor authentication** with three built-in methods — TOTP authenticator apps (multiple), passkeys/WebAuthn (multiple), and OTP email — plus a **pluggable MFA provider registry** so third-party module developers can register custom MFA methods (e.g. SMS, push notifications, hardware tokens) that are auto-discovered at bootstrap.
3. **MFA enforcement** configurable by superadmin at platform, tenant, or organisation scope.
4. **Sudo challenge system** allowing superadmin to require re-authentication for specific packages, modules, routes, or features — configurable from the admin UI.
5. **Developer sudo API** so module authors can declare sudo-protected targets by default (overridable by superadmin).
6. **MFA admin management** including user MFA reset and compliance reporting.
7. **Pluggable MFA provider architecture** enabling module developers to contribute new MFA methods (e.g. hardware tokens, push notifications, biometric providers) via a standard interface that integrates with enrollment, verification, and the challenge UI automatically.

---

## 3. Architecture

### 3.1 Module placement

The module lives at `packages/enterprise/src/modules/security/` following the standard 24-module directory structure already established in the codebase. All auto-discovery conventions (pages in `backend/`, routes in `api/`, subscribers in `subscribers/`) apply unchanged. All views (both user-facing profile/MFA pages and admin pages) live under the `backend/` path.

### 3.2 Integration points

| Integration | Mechanism | Notes |
|---|---|---|
| Auth module | Foreign key (`userId`) | No direct ORM relationships — links MFA credentials to users by ID only |
| Directory module | Foreign key (`tenantId`, `orgId`) | Enforcement policies scoped to tenants/orgs |
| Profile UI | Widget injection | Password change and MFA sections injected into profile page |
| Sudo protection | Shared library export | Challenge middleware + React hook for other modules to consume |
| Audit trail | Event system | All security actions emit events consumed by `audit_logs` module |
| Notifications | Event subscribers | MFA changes, enforcement deadlines, and recovery code usage trigger user notifications |
| Email delivery | Resend (existing) | OTP codes, MFA enrollment confirmations, enforcement deadline reminders |
| Custom MFA providers | MFA provider registry (auto-discovery) | Third-party modules register custom MFA methods via `MfaProviderInterface` |

### 3.3 Data flows

**MFA authentication flow:**

1. User submits credentials to `POST /api/auth/login` (unchanged endpoint).
2. Auth module validates credentials and emits `auth.login.success` event.
3. Security module subscriber intercepts: checks if user has active MFA methods.
4. If no MFA → standard JWT issued (existing behaviour preserved).
5. If MFA enabled → response modified to return `{ mfa_required: true, challenge_id, available_methods }`.
6. Client presents MFA challenge UI (TOTP input, passkey prompt, OTP email, or custom provider UI).
7. User completes MFA verification via `POST /api/security/mfa/verify`.
8. Full JWT issued with `mfa_verified: true` claim in the token.

**Sudo challenge flow:**

1. User attempts a sudo-protected action.
2. Frontend middleware intercepts and presents `SudoChallengeModal`.
3. User re-authenticates (password if no MFA, or MFA if enabled).
4. Short-lived sudo token issued (HMAC-SHA256, default 5 min TTL) and attached as `X-Sudo-Token` header.
5. Original request retries with sudo token — API middleware validates it against `SudoSession` table.

**MFA enforcement flow:**

1. Superadmin creates enforcement policy at platform, tenant, or organisation scope.
2. On next login, auth middleware checks enforcement and adds `mfa_enrollment_required` flag to auth context.
3. Frontend layout redirects unenrolled users to MFA setup page.
4. After optional `enforcement_deadline`, unenrolled users are locked out entirely.

### 3.4 Pluggable MFA provider architecture

The security module ships three built-in MFA methods (TOTP, passkey, OTP email) but is designed to be extended by third-party modules with custom MFA methods (e.g. SMS, push notifications, hardware tokens). This follows Open Mercato's core philosophy of isomorphic module independence — any module can contribute new MFA methods without modifying the security module.

**Provider interface:**

Every MFA method — built-in or custom — implements `MfaProviderInterface`. The security module's `MfaProviderRegistry` auto-discovers all registered providers at bootstrap.

```typescript
// packages/enterprise/src/modules/security/lib/mfa-provider-interface.ts

export interface MfaProviderInterface {
  /** Unique type identifier stored in user_mfa_methods.type (e.g. 'totp', 'push_notify', 'hardware_token') */
  readonly type: string

  /** Human-readable label shown in UI (e.g. 'Authenticator App', 'Push Notification') */
  readonly label: string

  /** Icon identifier from Lucide (e.g. 'Smartphone', 'Key', 'Fingerprint') */
  readonly icon: string

  /** Whether users can register multiple instances (e.g. multiple passkeys, but only one email) */
  readonly allowMultiple: boolean

  /** Provider-specific metadata schema (Zod) for the setup payload */
  readonly setupSchema: z.ZodSchema

  /** Provider-specific metadata schema (Zod) for the verify payload */
  readonly verifySchema: z.ZodSchema

  /**
   * Begin enrollment for a user. Returns provider-specific setup data
   * that the frontend component needs (e.g. QR URI for TOTP, device prompt for push).
   */
  setup(userId: string, payload: unknown): Promise<{
    setupId: string
    /** Data sent to the client to render the setup UI */
    clientData: Record<string, unknown>
  }>

  /**
   * Confirm enrollment after user completes the setup challenge.
   * Returns the metadata to persist in user_mfa_methods.provider_metadata.
   */
  confirmSetup(userId: string, setupId: string, payload: unknown): Promise<{
    /** JSON metadata stored in user_mfa_methods.provider_metadata */
    metadata: Record<string, unknown>
  }>

  /**
   * Send or prepare a verification challenge (e.g. send email OTP, send push).
   * Called when the user selects this method during login or sudo challenge.
   * No-op for methods like TOTP where the user generates the code client-side.
   */
  prepareChallenge(userId: string, method: UserMfaMethod): Promise<{
    /** Data sent to the client to render the verify UI */
    clientData?: Record<string, unknown>
  }>

  /**
   * Verify a user's response to the challenge.
   */
  verify(userId: string, method: UserMfaMethod, payload: unknown): Promise<boolean>

  /**
   * Optional: React component for the setup wizard.
   * If not provided, a generic form based on setupSchema is rendered.
   */
  SetupComponent?: React.ComponentType<MfaSetupComponentProps>

  /**
   * Optional: React component for the verification step in SudoChallengeModal / login.
   * If not provided, a generic code input is rendered.
   */
  VerifyComponent?: React.ComponentType<MfaVerifyComponentProps>
}

export interface MfaSetupComponentProps {
  clientData: Record<string, unknown>
  onConfirm: (payload: unknown) => Promise<void>
  onCancel: () => void
}

export interface MfaVerifyComponentProps {
  clientData?: Record<string, unknown>
  onVerify: (payload: unknown) => Promise<void>
  onCancel: () => void
  onResend?: () => Promise<void>  // for code-based methods like email OTP
}
```

**Provider registry:**

```typescript
// packages/enterprise/src/modules/security/lib/mfa-provider-registry.ts

export class MfaProviderRegistry {
  private providers = new Map<string, MfaProviderInterface>()

  /**
   * Register a new MFA provider. Called during module bootstrap.
   * Built-in providers are registered by the security module itself.
   * Custom providers are registered by third-party modules in their setup.ts.
   */
  register(provider: MfaProviderInterface): void {
    if (this.providers.has(provider.type)) {
      throw new Error(`MFA provider '${provider.type}' is already registered`)
    }
    this.providers.set(provider.type, provider)
  }

  /** Get a provider by type identifier */
  get(type: string): MfaProviderInterface | undefined {
    return this.providers.get(type)
  }

  /** List all registered providers (for MFA setup page to show available methods) */
  listAll(): MfaProviderInterface[] {
    return Array.from(this.providers.values())
  }

  /** List providers available for a given tenant (respects enforcement allowed_methods) */
  listAvailable(allowedMethods?: string[] | null): MfaProviderInterface[] {
    if (!allowedMethods) return this.listAll()
    return this.listAll().filter(p => allowedMethods.includes(p.type))
  }
}
```

**How third-party modules register custom MFA providers:**

```typescript
// Example: in a hypothetical @open-mercato/push-auth module's setup.ts

import type { ModuleSetupConfig } from '@open-mercato/shared'
import type { MfaProviderInterface } from '@open-mercato/enterprise/security'
import { PushNotificationProvider } from './providers/PushNotificationProvider'
import { PushSetupWizard } from './components/PushSetupWizard'
import { PushVerifyPrompt } from './components/PushVerifyPrompt'

export const setup: ModuleSetupConfig = {
  name: 'push-auth',
  label: 'Push Authentication',

  // Register custom MFA provider — auto-discovered by security module at bootstrap
  mfaProviders: [
    {
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
    },
  ],
}
```

**Auto-discovery at bootstrap:**

During application bootstrap, the security module scans all registered modules for `mfaProviders` arrays (same pattern as `sudoProtected` scanning). Each provider is validated against `MfaProviderInterface` and registered in the `MfaProviderRegistry` singleton. The registry is then injected into `MfaService` and `MfaVerificationService` via the DI container so all enrollment and verification calls are routed through the registered provider.

**Built-in providers:**

The security module itself registers three built-in providers:

| Provider type | Class | Description |
|---|---|---|
| `totp` | `TotpProvider` | RFC 6238 authenticator apps (Google Authenticator, Authy, etc.) |
| `passkey` | `PasskeyProvider` | WebAuthn/FIDO2 platform and roaming authenticators |
| `otp_email` | `OtpEmailProvider` | 6-digit codes sent via Resend email service |

---

## 4. Database schema

All entities use UUID primary keys (`gen_random_uuid()`), soft deletes via `deleted_at`, automatic timestamps, and tenant/organisation scoping. Sensitive fields use the existing field-level encryption system with tenant-scoped keys from the Vault integration.

### 4.1 `user_mfa_methods`

Stores each MFA method registered by a user. Users can have multiple methods of different types. The `type` column is a free-form text field (not a CHECK constraint) so that custom MFA providers registered by third-party modules can use any type identifier. Built-in types are `totp`, `otp_email`, and `passkey`. The `provider_metadata` JSONB column stores provider-specific data (e.g. passkey credential IDs, hardware token serial numbers, phone numbers for SMS providers) — each provider defines its own metadata schema.

```sql
CREATE TABLE "user_mfa_methods" (
  "id"                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"               uuid        NOT NULL,
  "tenant_id"             uuid        NOT NULL,
  "organization_id"       uuid        NULL,
  "type"                  text        NOT NULL,   -- provider type: 'totp', 'otp_email', 'passkey', or any custom type
  "label"                 text        NULL,       -- user-friendly name (e.g. "Work Yubikey", "Backup authenticator")
  "secret"                text        NULL,       -- TOTP secret (encrypted at rest via tenant key); NULL for non-TOTP
  "provider_metadata"     jsonb       NULL,       -- provider-specific data (passkey creds, custom provider state, etc.)
  "is_active"             boolean     NOT NULL DEFAULT true,
  "last_used_at"          timestamptz NULL,
  "created_at"            timestamptz NOT NULL,
  "updated_at"            timestamptz NOT NULL,
  "deleted_at"            timestamptz NULL,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_user_mfa_methods_user_type" ON "user_mfa_methods" ("user_id", "type", "is_active");
CREATE INDEX "idx_user_mfa_methods_tenant" ON "user_mfa_methods" ("tenant_id");
```

**provider_metadata examples by type:**

| Type | provider_metadata contents |
|---|---|
| `totp` | `{}` (secret stored in dedicated encrypted column) |
| `passkey` | `{ "credentialId": "...", "publicKey": "...", "counter": 42, "transports": ["usb", "internal"] }` |
| `otp_email` | `{}` (uses user's verified email from auth module) |
| (custom) | Provider-defined JSON — schema validated by the provider's `setupSchema` |

### 4.2 `mfa_recovery_codes`

Stores hashed recovery codes. 10 codes are generated per user; each code is a random alphanumeric string, bcrypt-hashed before storage.

```sql
CREATE TABLE "mfa_recovery_codes" (
  "id"          uuid        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"     uuid        NOT NULL,
  "tenant_id"   uuid        NOT NULL,
  "code_hash"   text        NOT NULL,     -- bcrypt hash of the recovery code
  "is_used"     boolean     NOT NULL DEFAULT false,
  "used_at"     timestamptz NULL,
  "created_at"  timestamptz NOT NULL,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_mfa_recovery_codes_user" ON "mfa_recovery_codes" ("user_id", "is_used");
```

### 4.3 `mfa_enforcement_policies`

Defines MFA enforcement rules set by superadmin at various scopes. Policies cascade: platform → tenant → organisation.

```sql
CREATE TABLE "mfa_enforcement_policies" (
  "id"                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  "scope"                 text        NOT NULL CHECK ("scope" IN ('platform', 'tenant', 'organisation')),
  "tenant_id"             uuid        NULL,       -- NULL for platform scope
  "organization_id"       uuid        NULL,       -- only for organisation scope
  "is_enforced"           boolean     NOT NULL DEFAULT true,
  "allowed_methods"       jsonb       NULL,       -- restrict to specific MFA types; NULL = all allowed
  "enforcement_deadline"  timestamptz NULL,       -- grace period end date; lockout after
  "enforced_by"           uuid        NOT NULL,   -- superadmin user ID who set the policy
  "created_at"            timestamptz NOT NULL,
  "updated_at"            timestamptz NOT NULL,
  "deleted_at"            timestamptz NULL,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_mfa_enforcement_scope" ON "mfa_enforcement_policies" ("scope", "tenant_id");
```

### 4.4 `sudo_challenge_configs`

Defines which modules, packages, routes, or features require sudo re-authentication. Entries can be created by developers (defaults) or superadmin (overrides).

```sql
CREATE TABLE "sudo_challenge_configs" (
  "id"                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NULL,       -- NULL for platform-wide defaults
  "organization_id"      uuid        NULL,       -- organisation-specific override
  "target_type"          text        NOT NULL CHECK ("target_type" IN ('package', 'module', 'route', 'feature')),
  "target_identifier"    text        NOT NULL,   -- e.g. "@open-mercato/core", "auth.roles", "DELETE /api/auth/roles/:id"
  "is_enabled"           boolean     NOT NULL DEFAULT true,
  "is_developer_default" boolean     NOT NULL DEFAULT false,
  "ttl_seconds"          integer     NOT NULL DEFAULT 300,
  "challenge_method"     text        NOT NULL DEFAULT 'auto' CHECK ("challenge_method" IN ('auto', 'password', 'mfa')),
  "configured_by"        uuid        NULL,       -- superadmin user ID; NULL for developer defaults
  "created_at"           timestamptz NOT NULL,
  "updated_at"           timestamptz NOT NULL,
  "deleted_at"           timestamptz NULL,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_sudo_configs_target" ON "sudo_challenge_configs" ("target_type", "target_identifier");
```

### 4.5 `sudo_sessions`

Tracks active sudo sessions for token validation and expiry.

```sql
CREATE TABLE "sudo_sessions" (
  "id"               uuid        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"          uuid        NOT NULL,
  "tenant_id"        uuid        NOT NULL,
  "session_token"    text        NOT NULL,   -- HMAC-SHA256 signed short-lived token
  "challenge_method" text        NOT NULL,   -- 'password', 'totp', 'passkey', 'otp_email', or any custom provider type
  "expires_at"       timestamptz NOT NULL,
  "created_at"       timestamptz NOT NULL,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_sudo_sessions_token" ON "sudo_sessions" ("session_token", "expires_at");
```

### 4.6 `mfa_challenges`

Temporary challenge records created during login or sudo flows when MFA verification is required.

```sql
CREATE TABLE "mfa_challenges" (
  "id"            uuid        NOT NULL DEFAULT gen_random_uuid(),  -- used as challenge_id in API
  "user_id"       uuid        NOT NULL,
  "tenant_id"     uuid        NOT NULL,
  "otp_code_hash" text        NULL,       -- bcrypt hash of OTP for email method
  "method_type"   text        NULL,       -- pre-selected method if only one available
  "attempts"      integer     NOT NULL DEFAULT 0,
  "expires_at"    timestamptz NOT NULL,   -- 10 min validity
  "verified_at"   timestamptz NULL,
  "created_at"    timestamptz NOT NULL,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_mfa_challenges_lookup" ON "mfa_challenges" ("id", "expires_at");
```

---

## 5. MikroORM entity definitions

Create all entities in `data/entities.ts` using MikroORM decorators following the existing patterns (see `packages/core/src/modules/auth/data/` and the example module for reference).

```typescript
// packages/enterprise/src/modules/security/data/entities.ts

import { Entity, PrimaryKey, Property, Enum, Index } from '@mikro-orm/core'

/**
 * Built-in MFA method types. Custom providers use arbitrary string identifiers
 * registered via MfaProviderRegistry — they are NOT added to this enum.
 * The `type` column in user_mfa_methods is free-form text to support extensibility.
 */
export enum MfaMethodType {
  TOTP = 'totp',
  OTP_EMAIL = 'otp_email',
  PASSKEY = 'passkey',
}

export enum EnforcementScope {
  PLATFORM = 'platform',
  TENANT = 'tenant',
  ORGANISATION = 'organisation',
}

export enum SudoTargetType {
  PACKAGE = 'package',
  MODULE = 'module',
  ROUTE = 'route',
  FEATURE = 'feature',
}

export enum ChallengeMethod {
  AUTO = 'auto',
  PASSWORD = 'password',
  MFA = 'mfa',
}

/**
 * Tracks which method was used for a sudo challenge.
 * For custom providers, the string type identifier is stored directly —
 * this enum covers built-in types only. The DB column is free-form text.
 */
export enum SudoChallengeMethodUsed {
  PASSWORD = 'password',
  TOTP = 'totp',
  PASSKEY = 'passkey',
  OTP_EMAIL = 'otp_email',
}

@Entity({ tableName: 'user_mfa_methods' })
export class UserMfaMethod {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  /** Free-form text to support both built-in and custom provider types */
  @Property({ type: 'text' })
  type!: string

  @Property({ type: 'text', nullable: true })
  label?: string | null

  @Property({ type: 'text', nullable: true })
  secret?: string | null // TOTP secret (encrypted at rest); NULL for non-TOTP

  /** Provider-specific metadata (passkey creds, custom provider state, etc.) */
  @Property({ name: 'provider_metadata', type: 'jsonb', nullable: true })
  providerMetadata?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'last_used_at', type: Date, nullable: true })
  lastUsedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'mfa_recovery_codes' })
export class MfaRecoveryCode {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'code_hash', type: 'text' })
  codeHash!: string

  @Property({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean = false

  @Property({ name: 'used_at', type: Date, nullable: true })
  usedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'mfa_enforcement_policies' })
export class MfaEnforcementPolicy {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Enum({ items: () => EnforcementScope })
  scope!: EnforcementScope

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'is_enforced', type: 'boolean', default: true })
  isEnforced: boolean = true

  @Property({ name: 'allowed_methods', type: 'jsonb', nullable: true })
  allowedMethods?: MfaMethodType[] | null

  @Property({ name: 'enforcement_deadline', type: Date, nullable: true })
  enforcementDeadline?: Date | null

  @Property({ name: 'enforced_by', type: 'uuid' })
  enforcedBy!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sudo_challenge_configs' })
export class SudoChallengeConfig {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Enum({ name: 'target_type', items: () => SudoTargetType })
  targetType!: SudoTargetType

  @Property({ name: 'target_identifier', type: 'text' })
  targetIdentifier!: string

  @Property({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean = true

  @Property({ name: 'is_developer_default', type: 'boolean', default: false })
  isDeveloperDefault: boolean = false

  @Property({ name: 'ttl_seconds', type: 'integer', default: 300 })
  ttlSeconds: number = 300

  @Enum({ name: 'challenge_method', items: () => ChallengeMethod, default: ChallengeMethod.AUTO })
  challengeMethod: ChallengeMethod = ChallengeMethod.AUTO

  @Property({ name: 'configured_by', type: 'uuid', nullable: true })
  configuredBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sudo_sessions' })
export class SudoSession {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'session_token', type: 'text' })
  sessionToken!: string

  /** Free-form text — built-in types or custom provider type identifiers */
  @Property({ name: 'challenge_method', type: 'text' })
  challengeMethod!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'mfa_challenges' })
export class MfaChallenge {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'otp_code_hash', type: 'text', nullable: true })
  otpCodeHash?: string | null

  @Property({ name: 'method_type', type: 'text', nullable: true })
  methodType?: MfaMethodType | null

  @Property({ type: 'integer', default: 0 })
  attempts: number = 0

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'verified_at', type: Date, nullable: true })
  verifiedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
```

---

## 6. Zod validators

Create all API validation schemas in `data/validators.ts`.

```typescript
// packages/enterprise/src/modules/security/data/validators.ts

import { z } from 'zod'

// ── Password ──

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
})

// ── MFA setup ──

export const totpSetupConfirmSchema = z.object({
  setupId: z.string().uuid(),
  code: z.string().length(6).regex(/^\d{6}$/),
})

export const totpSetupRequestSchema = z.object({
  label: z.string().max(100).optional(),
})

export const passkeyRegisterSchema = z.object({
  credential: z.object({
    id: z.string(),
    rawId: z.string(),
    response: z.object({
      attestationObject: z.string(),
      clientDataJSON: z.string(),
    }),
    type: z.literal('public-key'),
  }),
  label: z.string().max(100).optional(),
})

export const passkeyAuthenticateSchema = z.object({
  challengeId: z.string().uuid(),
  credential: z.object({
    id: z.string(),
    rawId: z.string(),
    response: z.object({
      authenticatorData: z.string(),
      clientDataJSON: z.string(),
      signature: z.string(),
      userHandle: z.string().optional(),
    }),
    type: z.literal('public-key'),
  }),
})

// ── MFA verification (supports built-in + custom provider types) ──

export const mfaVerifySchema = z.object({
  challengeId: z.string().uuid(),
  method: z.string().min(1),          // any registered provider type (not limited to built-in enum)
  code: z.string().optional(),        // for code-based methods (TOTP, OTP email)
  credential: z.any().optional(),     // for passkey (WebAuthn assertion)
  providerPayload: z.any().optional(), // for custom providers — provider validates internally
})

export const recoveryCodeSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().min(8).max(20),
})

// ── Enforcement ──

export const enforcementPolicySchema = z.object({
  scope: z.enum(['platform', 'tenant', 'organisation']),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  isEnforced: z.boolean().default(true),
  allowedMethods: z.array(z.string().min(1)).optional(), // any registered provider type
  enforcementDeadline: z.string().datetime().optional(),
})

export const enforcementPolicyUpdateSchema = enforcementPolicySchema.partial()

// ── Sudo ──

export const sudoChallengeInitSchema = z.object({
  targetIdentifier: z.string().min(1).max(500),
})

export const sudoChallengeVerifySchema = z.object({
  sessionId: z.string().uuid(),
  method: z.string().min(1),           // 'password' or any registered provider type
  password: z.string().optional(),
  code: z.string().optional(),
  credential: z.any().optional(),
  providerPayload: z.any().optional(), // for custom providers
})

export const sudoConfigSchema = z.object({
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  targetType: z.enum(['package', 'module', 'route', 'feature']),
  targetIdentifier: z.string().min(1).max(500),
  isEnabled: z.boolean().default(true),
  ttlSeconds: z.number().int().min(60).max(1800).default(300),
  challengeMethod: z.enum(['auto', 'password', 'mfa']).default('auto'),
})

export const sudoConfigUpdateSchema = sudoConfigSchema.partial()

// ── Admin ──

export const mfaResetSchema = z.object({
  reason: z.string().min(1).max(500),
})

export const removeMfaMethodSchema = z.object({
  methodId: z.string().uuid(),
})
```

---

## 7. API endpoints

All endpoints use the existing `makeCrudRoute` factory and OpenAPI specification pattern. Feature-based access control gates every endpoint. Public endpoints (MFA verify during login, recovery codes during login) require a valid `challenge_id` instead of JWT auth.

### 7.0 CRUD factory + command/undo policy

- For standard CRUD-style endpoints in this module, use the existing CRUD factory (`makeCrudRoute`) and keep OpenAPI metadata in route definitions.
- For security-critical mutations that have side effects across entities (e.g. MFA reset, policy updates with downstream notifications), implement explicit command handlers rather than inline route logic.
- Where a mutation is logically reversible, command handlers must provide undo metadata/payload and follow the shared command/undo conventions from `@open-mercato/shared/lib/commands`.
- For irreversible security actions (e.g. one-time recovery code consumption, challenge verification attempts), mark them as non-undoable and document that explicitly in command metadata/audit logs.

### 7.1 Profile and password

| Method | Endpoint | Feature | Description |
|---|---|---|---|
| `GET` | `/api/security/profile` | `security.profile.view` | Current user profile with MFA status summary |
| `PUT` | `/api/security/profile/password` | `security.profile.password` | Change password (requires current password) |

### 7.2 MFA management

| Method | Endpoint | Feature | Description |
|---|---|---|---|
| `GET` | `/api/security/mfa/methods` | `security.mfa.view` | List current user's MFA methods |
| `POST` | `/api/security/mfa/totp/setup` | `security.mfa.manage` | Begin TOTP enrollment — returns QR URI and secret |
| `POST` | `/api/security/mfa/totp/confirm` | `security.mfa.manage` | Verify TOTP code to activate enrollment |
| `POST` | `/api/security/mfa/passkey/register-options` | `security.mfa.manage` | Get WebAuthn credential creation options |
| `POST` | `/api/security/mfa/passkey/register` | `security.mfa.manage` | Complete passkey registration |
| `POST` | `/api/security/mfa/otp-email/setup` | `security.mfa.manage` | Enable OTP email method |
| `POST` | `/api/security/mfa/provider/:type/setup` | `security.mfa.manage` | Begin enrollment for any registered custom MFA provider |
| `POST` | `/api/security/mfa/provider/:type/confirm` | `security.mfa.manage` | Confirm enrollment for any registered custom MFA provider |
| `GET` | `/api/security/mfa/providers` | `security.mfa.view` | List all available MFA provider types (built-in + custom) |
| `DELETE` | `/api/security/mfa/methods/:id` | `security.mfa.manage` | Remove an MFA method (soft delete) |
| `POST` | `/api/security/mfa/verify` | (public — requires `challenge_id`) | Verify MFA during login flow |
| `POST` | `/api/security/mfa/recovery` | (public — requires `challenge_id`) | Use recovery code for login |
| `POST` | `/api/security/mfa/recovery-codes/regenerate` | `security.mfa.manage` | Generate new set of 10 recovery codes |

### 7.3 MFA enforcement (superadmin)

| Method | Endpoint | Feature | Description |
|---|---|---|---|
| `GET` | `/api/security/enforcement` | `security.enforcement.view` | List all enforcement policies |
| `POST` | `/api/security/enforcement` | `security.enforcement.manage` | Create enforcement policy |
| `PUT` | `/api/security/enforcement/:id` | `security.enforcement.manage` | Update enforcement policy |
| `DELETE` | `/api/security/enforcement/:id` | `security.enforcement.manage` | Remove enforcement policy |
| `GET` | `/api/security/enforcement/compliance` | `security.enforcement.view` | Compliance report — enrolled vs unenrolled per policy |
| `POST` | `/api/security/users/:id/mfa/reset` | `security.admin.mfa-reset` | Reset user's MFA (superadmin only) |
| `GET` | `/api/security/users/:id/mfa/status` | `security.admin.view` | View user MFA enrollment status |

### 7.4 Sudo challenge

| Method | Endpoint | Feature | Description |
|---|---|---|---|
| `POST` | `/api/security/sudo/challenge` | (authenticated) | Initiate sudo challenge — returns session ID and required method |
| `POST` | `/api/security/sudo/verify` | (authenticated) | Verify sudo challenge — returns sudo token |
| `GET` | `/api/security/sudo/configs` | `security.sudo.view` | List all sudo-protected targets |
| `POST` | `/api/security/sudo/configs` | `security.sudo.manage` | Add sudo protection to a target |
| `PUT` | `/api/security/sudo/configs/:id` | `security.sudo.manage` | Update sudo config (TTL, method, enabled) |
| `DELETE` | `/api/security/sudo/configs/:id` | `security.sudo.manage` | Remove sudo protection |

---

## 8. Service layer

Services are registered via Awilix in the module's `di.ts`. Each service is request-scoped and receives the auth context and MikroORM entity manager from the DI container.

### 8.1 `PasswordService`

**File:** `services/PasswordService.ts`

Handles password change validation, policy enforcement (delegating to existing `packages/shared/src/lib/auth/passwordPolicy.ts`), bcrypt hashing, and optionally password history tracking. Uses the existing `bcryptjs` dependency.

Methods:

- `changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>` — validates current password, applies policy, hashes new password, updates user record, emits `security.password.changed` event.
- `validatePasswordPolicy(password: string): { valid: boolean; errors: string[] }` — delegates to existing password policy validators.
- `verifyPassword(userId: string, password: string): Promise<boolean>` — used by sudo challenge for password-based re-auth.

### 8.2 `MfaService`

**File:** `services/MfaService.ts`

Manages MFA method lifecycle by **delegating to the `MfaProviderRegistry`** for all provider-specific operations. The service itself handles cross-cutting concerns (recording methods, generating recovery codes, enforcing method limits, emitting events) while each provider handles its own setup/verify logic.

Methods:

- `setupMethod(userId: string, providerType: string, payload: unknown): Promise<{ setupId: string; clientData: Record<string, unknown> }>` — resolves the provider from registry, calls `provider.setup()`, creates an inactive `UserMfaMethod` record, returns provider-specific client data. This is the **unified entry point** for all provider types (built-in and custom).
- `confirmMethod(userId: string, setupId: string, payload: unknown): Promise<void>` — resolves the provider, calls `provider.confirmSetup()`, stores returned metadata in `provider_metadata`, activates the method, generates recovery codes if this is the user's first MFA method. Emits `security.mfa.enrolled`.
- `setupTotp(userId: string, label?: string): Promise<{ setupId: string; uri: string; secret: string; qrDataUrl: string }>` — convenience wrapper around `setupMethod('totp', ...)` that extracts TOTP-specific fields.
- `confirmTotp(userId: string, setupId: string, code: string): Promise<void>` — convenience wrapper around `confirmMethod`.
- `getRegistrationOptions(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON>` — convenience wrapper for passkey provider setup.
- `completeRegistration(userId: string, credential: RegistrationResponseJSON, label?: string): Promise<void>` — convenience wrapper for passkey provider confirmation.
- `setupOtpEmail(userId: string): Promise<void>` — convenience wrapper for OTP email provider.
- `sendOtpEmail(userId: string, challengeId: string): Promise<void>` — generates 6-digit code, bcrypt-hashes it into `MfaChallenge.otp_code_hash`, sends via Resend email service.
- `getUserMethods(userId: string): Promise<UserMfaMethod[]>` — lists active MFA methods for a user.
- `getAvailableProviders(tenantId: string, orgId?: string): Promise<Array<{ type: string; label: string; icon: string; allowMultiple: boolean }>>` — lists all registered providers, filtered by enforcement policy's `allowed_methods` if set.
- `removeMethod(userId: string, methodId: string): Promise<void>` — soft-deletes an MFA method. Prevents removing the last method if MFA enforcement is active for the user's scope. Emits `security.mfa.removed` event.
- `generateRecoveryCodes(userId: string): Promise<string[]>` — generates 10 random alphanumeric codes using `crypto.randomBytes`, bcrypt-hashes each, stores in `mfa_recovery_codes`, soft-deletes any existing codes. Returns plaintext codes (shown once only). Emits `security.recovery.regenerated` event.

### 8.3 `MfaVerificationService`

**File:** `services/MfaVerificationService.ts`

Handles the verification step during login and sudo challenges. **Routes all verification calls through the `MfaProviderRegistry`** so that custom providers are automatically supported alongside built-in methods.

Methods:

- `createChallenge(userId: string): Promise<{ challengeId: string; availableMethods: Array<{ type: string; label: string; icon: string }> }>` — creates an `MfaChallenge` record with 10-minute expiry, returns the challenge ID and the user's available methods with display metadata from the provider registry.
- `prepareChallenge(challengeId: string, methodType: string): Promise<{ clientData?: Record<string, unknown> }>` — resolves the provider, calls `provider.prepareChallenge()` (e.g. sends email OTP, triggers push notification). Returns any client data the frontend component needs.
- `verifyChallenge(challengeId: string, methodType: string, payload: unknown): Promise<boolean>` — validates challenge exists and is not expired, checks attempt count (max 5), **resolves provider from registry and calls `provider.verify()`**. On success, sets `verified_at`. On failure, increments `attempts`. This single method handles ALL provider types (built-in + custom).
- `verifyRecoveryCode(userId: string, code: string): Promise<boolean>` — iterates the user's unused recovery codes, bcrypt-compares each, marks the matched code as used. Emits `security.recovery.used` event with remaining count.

### 8.4 `MfaEnforcementService`

**File:** `services/MfaEnforcementService.ts`

Manages enforcement policy CRUD, compliance checking, and enforcement status resolution during auth flows.

Methods:

- `isEnforced(tenantId: string, orgId?: string): Promise<{ enforced: boolean; policy?: MfaEnforcementPolicy }>` — resolves the effective enforcement policy for a given scope by checking organisation → tenant → platform cascade.
- `getComplianceReport(scope: EnforcementScope, scopeId?: string): Promise<{ total: number; enrolled: number; pending: number; overdue: number }>` — returns enrolled vs unenrolled user counts for the given scope.
- `createPolicy(data: z.infer<typeof enforcementPolicySchema>, adminId: string): Promise<MfaEnforcementPolicy>` — creates or updates enforcement policy. Validates scope/ID consistency. Emits `security.enforcement.created`.
- `updatePolicy(id: string, data: Partial<...>, adminId: string): Promise<MfaEnforcementPolicy>` — updates an existing policy. Emits `security.enforcement.updated`.
- `deletePolicy(id: string): Promise<void>` — soft-deletes enforcement policy.
- `checkUserCompliance(userId: string): Promise<{ compliant: boolean; deadline?: Date; enforced: boolean }>` — returns whether a user meets the active enforcement policy for their scope.

### 8.5 `SudoChallengeService`

**File:** `services/SudoChallengeService.ts`

Manages sudo challenge lifecycle, token issuance, and token validation. Tokens are HMAC-SHA256 signed with the server secret, stored in `sudo_sessions` for dual (crypto + database) validation.

Methods:

- `isProtected(targetType: SudoTargetType, targetIdentifier: string, tenantId?: string, orgId?: string): Promise<{ protected: boolean; config?: SudoChallengeConfig }>` — checks if an action requires sudo, resolving organisation → tenant → platform → developer defaults.
- `initiate(userId: string, targetIdentifier: string): Promise<{ sessionId: string; method: 'password' | 'mfa'; availableMfaMethods?: MfaMethodType[] }>` — determines challenge method (`password` if no MFA, `mfa` if MFA enabled), creates a pending `SudoSession`. Emits `security.sudo.challenged`.
- `verify(sessionId: string, method: string, payload: unknown): Promise<{ sudoToken: string; expiresAt: Date }>` — validates re-authentication (delegates to `PasswordService.verifyPassword` or `MfaVerificationService`), generates HMAC-SHA256 token, stores in `SudoSession`, returns token + expiry. Emits `security.sudo.verified`.
- `validateToken(token: string): Promise<{ valid: boolean; userId?: string; expiresAt?: Date }>` — checks HMAC signature, looks up session in database, verifies not expired.
- `registerDeveloperDefault(targetType: SudoTargetType, identifier: string, ttlSeconds?: number): Promise<void>` — called during module setup to register developer defaults with `is_developer_default: true`.
- `cleanupExpired(): Promise<number>` — deletes expired sudo sessions. Called by scheduled cleanup job.

### 8.6 `MfaAdminService`

**File:** `services/MfaAdminService.ts`

Superadmin-only operations for managing user MFA status across the platform.

Methods:

- `resetUserMfa(adminId: string, userId: string, reason: string): Promise<void>` — soft-deletes all `UserMfaMethod` records for the user, marks all recovery codes as used, emits `security.mfa.reset` event with admin ID and reason. Sends notification to the affected user.
- `getUserMfaStatus(userId: string): Promise<{ enrolled: boolean; methods: { type: MfaMethodType; label?: string; lastUsed?: Date }[]; recoveryCodesRemaining: number; compliant: boolean }>` — returns comprehensive MFA status for admin view.
- `bulkComplianceCheck(tenantId: string): Promise<Array<{ userId: string; email: string; enrolled: boolean; methodCount: number; compliant: boolean }>>` — returns compliance status for all users in a tenant.

---

## 9. Shared library exports

The security module exports utilities for other modules to consume. These are the **public API** for third-party developers.

### 9.1 Server-side exports

```typescript
// packages/enterprise/src/modules/security/index.ts

// ── Sudo middleware for API routes ──
export { requireSudo } from './lib/sudo-middleware'
// Usage in any module's API route:
//   import { requireSudo } from '@open-mercato/enterprise/security'
//   export async function DELETE(req: NextRequest) {
//     await requireSudo(req, 'my-module.dangerous-action')
//     // proceed with protected operation
//   }

// ── Developer default registration ──
export { registerSudoDefaults } from './lib/sudo-middleware'
// Usage in any module's setup.ts:
//   sudoProtected: [
//     { type: 'feature', identifier: 'auth.roles.delete' },
//     { type: 'route', identifier: 'DELETE /api/auth/roles/:id' },
//   ]

// ── MFA Provider Interface (for custom MFA method developers) ──
export type {
  MfaProviderInterface,
  MfaSetupComponentProps,
  MfaVerifyComponentProps,
} from './lib/mfa-provider-interface'

// ── Types ──
export type {
  MfaMethodType,
  EnforcementScope,
  SudoTargetType,
  ChallengeMethod,
} from './data/entities'
```

### 9.2 Client-side exports

```typescript
// packages/enterprise/src/modules/security/components/index.ts

// ── Sudo hook for developers ──
export { useSudoChallenge } from './hooks/useSudoChallenge'
// Usage in any module's component:
//   import { useSudoChallenge } from '@open-mercato/enterprise/security/components'
//   const { requireSudo, isSudoActive } = useSudoChallenge()
//   const sudoToken = await requireSudo('my-module.dangerous-action')
//   if (!sudoToken) return // user cancelled
//   await myDangerousAction({ headers: { 'X-Sudo-Token': sudoToken } })

// ── MFA status hook ──
export { useMfaStatus } from './hooks/useMfaStatus'

// ── Sudo HOC ──
export { withSudoProtection } from './components/SudoProvider'

// ── Sudo context provider (added to root layout by module setup) ──
export { SudoProvider } from './components/SudoProvider'
```

---

## 10. `requireSudo` middleware implementation

```typescript
// packages/enterprise/src/modules/security/lib/sudo-middleware.ts

import { NextRequest, NextResponse } from 'next/server'

/**
 * API-side middleware that validates the X-Sudo-Token header.
 * If the token is missing, expired, or invalid, returns 403 with
 * { sudo_required: true, challenge_url } so the client can
 * trigger the SudoChallengeModal.
 *
 * Usage:
 *   await requireSudo(req, 'auth.roles.delete')
 */
export async function requireSudo(
  req: NextRequest,
  targetIdentifier: string
): Promise<void> {
  // 1. Resolve auth context from request
  // 2. Check if target is sudo-protected via SudoChallengeService.isProtected()
  // 3. If not protected, return immediately (no-op)
  // 4. Extract X-Sudo-Token header
  // 5. If missing, throw SudoRequiredError (caught by error handler → 403)
  // 6. Validate token via SudoChallengeService.validateToken()
  // 7. If invalid/expired, throw SudoRequiredError
  // 8. Token valid → return (operation proceeds)
}

/**
 * Error class for sudo-required responses.
 * The global error handler catches this and returns:
 * { status: 403, body: { sudo_required: true, challenge_url: '/api/security/sudo/challenge' } }
 */
export class SudoRequiredError extends Error {
  public readonly targetIdentifier: string
  constructor(targetIdentifier: string) {
    super(`Sudo authentication required for: ${targetIdentifier}`)
    this.targetIdentifier = targetIdentifier
  }
}
```

---

## 11. `useSudoChallenge` hook implementation

```typescript
// packages/enterprise/src/modules/security/components/hooks/useSudoChallenge.ts

import { useContext, useCallback } from 'react'
import { SudoContext } from '../SudoProvider'

interface UseSudoChallengeReturn {
  /**
   * Opens the SudoChallengeModal and resolves with a sudo token string.
   * Returns null if the user cancels the challenge.
   * The caller attaches the token as X-Sudo-Token header on the protected request.
   */
  requireSudo: (targetIdentifier: string) => Promise<string | null>

  /** Whether a valid sudo session is currently active */
  isSudoActive: boolean
}

export function useSudoChallenge(): UseSudoChallengeReturn {
  const ctx = useContext(SudoContext)

  const requireSudo = useCallback(
    async (targetIdentifier: string): Promise<string | null> => {
      // 1. Check if there's an existing valid sudo token in context
      // 2. If valid and not expired, return it immediately (no modal)
      // 3. Otherwise, call ctx.openChallenge(targetIdentifier)
      //    which renders the SudoChallengeModal and returns a Promise
      // 4. Modal handles: POST /api/security/sudo/challenge to get session
      //    then presents password or MFA input
      //    then POST /api/security/sudo/verify to get token
      // 5. On success: store token in context, resolve Promise with token
      // 6. On cancel: resolve Promise with null
      return ctx.openChallenge(targetIdentifier)
    },
    [ctx]
  )

  return {
    requireSudo,
    isSudoActive: ctx.isSudoActive,
  }
}
```

---

## 12. Module setup

### 12.1 `setup.ts`

```typescript
// packages/enterprise/src/modules/security/setup.ts

import type { ModuleSetupConfig } from '@open-mercato/shared'

export const setup: ModuleSetupConfig = {
  name: 'security',
  label: 'Security',
  icon: 'Shield',

  defaultRoleFeatures: {
    superadmin: ['security.*'],
    admin: [
      'security.profile.*',
      'security.mfa.*',
      'security.enforcement.view',
      'security.admin.view',
    ],
    employee: [
      'security.profile.*',
      'security.mfa.*',
    ],
  },

  // Built-in MFA providers are registered in di.ts.
  // Third-party modules register custom providers via mfaProviders array in their own setup.ts.
  // See section 3.4 for the MfaProviderInterface contract and auto-discovery mechanism.

  // Developer defaults for sudo protection within this module
  sudoProtected: [
    { type: 'feature', identifier: 'security.enforcement.manage' },
    { type: 'feature', identifier: 'security.admin.mfa-reset' },
    { type: 'feature', identifier: 'security.sudo.manage' },
  ],
}
```

### 12.2 `acl.ts`

```typescript
// packages/enterprise/src/modules/security/acl.ts

export const securityFeatures = [
  'security.*',
  'security.profile.*',
  'security.profile.view',
  'security.profile.password',
  'security.mfa.*',
  'security.mfa.view',
  'security.mfa.manage',
  'security.enforcement.*',
  'security.enforcement.view',
  'security.enforcement.manage',
  'security.sudo.*',
  'security.sudo.view',
  'security.sudo.manage',
  'security.admin.*',
  'security.admin.view',
  'security.admin.mfa-reset',
] as const
```

### 12.3 `di.ts`

```typescript
// packages/enterprise/src/modules/security/di.ts

import { asClass, asValue, Lifetime } from 'awilix'
import { PasswordService } from './services/PasswordService'
import { MfaService } from './services/MfaService'
import { MfaVerificationService } from './services/MfaVerificationService'
import { MfaEnforcementService } from './services/MfaEnforcementService'
import { MfaAdminService } from './services/MfaAdminService'
import { SudoChallengeService } from './services/SudoChallengeService'
import { MfaProviderRegistry } from './lib/mfa-provider-registry'
// Built-in providers
import { TotpProvider } from './lib/providers/TotpProvider'
import { PasskeyProvider } from './lib/providers/PasskeyProvider'
import { OtpEmailProvider } from './lib/providers/OtpEmailProvider'

export function registerSecurityServices(container: any) {
  // Create and populate the provider registry (singleton)
  const mfaProviderRegistry = new MfaProviderRegistry()
  mfaProviderRegistry.register(new TotpProvider())
  mfaProviderRegistry.register(new PasskeyProvider())
  mfaProviderRegistry.register(new OtpEmailProvider())

  // Third-party providers are registered during bootstrap (see setup.ts scanning)

  container.register({
    mfaProviderRegistry: asValue(mfaProviderRegistry),
    passwordService: asClass(PasswordService, { lifetime: Lifetime.SCOPED }),
    mfaService: asClass(MfaService, { lifetime: Lifetime.SCOPED }),
    mfaVerificationService: asClass(MfaVerificationService, { lifetime: Lifetime.SCOPED }),
    mfaEnforcementService: asClass(MfaEnforcementService, { lifetime: Lifetime.SCOPED }),
    mfaAdminService: asClass(MfaAdminService, { lifetime: Lifetime.SCOPED }),
    sudoChallengeService: asClass(SudoChallengeService, { lifetime: Lifetime.SCOPED }),
  })
}
```

### 12.4 `events.ts`

```typescript
// packages/enterprise/src/modules/security/events.ts

export const securityEvents = {
  // Password
  'security.password.changed': { userId: 'string' },

  // MFA lifecycle (methodType is any registered provider type string)
  'security.mfa.enrolled': { userId: 'string', methodType: 'string', methodId: 'string' },
  'security.mfa.removed': { userId: 'string', methodType: 'string', methodId: 'string' },
  'security.mfa.verified': { userId: 'string', methodType: 'string', context: 'string' },
  'security.mfa.failed': { userId: 'string', methodType: 'string', attemptCount: 'number' },
  'security.mfa.reset': { adminId: 'string', targetUserId: 'string', reason: 'string' },

  // Provider registry
  'security.mfa.provider.registered': { providerType: 'string', moduleName: 'string' },

  // Recovery
  'security.recovery.used': { userId: 'string', remainingCodes: 'number' },
  'security.recovery.regenerated': { userId: 'string' },

  // Enforcement
  'security.enforcement.created': { adminId: 'string', scope: 'string', scopeId: 'string' },
  'security.enforcement.updated': { adminId: 'string', policyId: 'string' },

  // Sudo
  'security.sudo.challenged': { userId: 'string', targetIdentifier: 'string' },
  'security.sudo.verified': { userId: 'string', targetIdentifier: 'string', method: 'string' },
  'security.sudo.failed': { userId: 'string', targetIdentifier: 'string', reason: 'string' },
} as const
```

---

## 13. Frontend pages

### 13.1 Profile and MFA pages (`backend/profile/`)

| Page path | Description |
|---|---|
| `backend/profile/page.tsx` | Extensible profile page with widget injection points. Contains password change form by default. Registers `security.profile.sections` and `security.profile.sidebar` injection points for other modules. |
| `backend/profile/mfa/page.tsx` | MFA management page. Dynamically renders all registered providers from `MfaProviderRegistry`. Displays current enrolled methods with status badges, provides setup wizards for each available provider type (built-in + custom), shows recovery code management section. The "Add method" UI queries `/api/security/mfa/providers` to list available providers and renders each provider's `SetupComponent` or a generic form if none is provided. |
| `backend/profile/mfa/setup-totp/page.tsx` | TOTP setup wizard: QR code display, manual secret entry toggle, 6-digit verification input, recovery codes display on first MFA enrollment. |
| `backend/profile/mfa/setup-passkey/page.tsx` | Passkey registration flow using WebAuthn browser API. Browser compatibility check, authenticator selection (platform vs roaming), label input. |

### 13.2 Admin pages (`backend/security/`)

| Page path | Description |
|---|---|
| `backend/security/page.tsx` | Security dashboard showing platform MFA adoption stats, active enforcement policies count, sudo protection summary. |
| `backend/security/enforcement/page.tsx` | MFA enforcement management. CRUD for policies with scope selector (platform/tenant/org), deadline date picker, allowed methods checkboxes, affected user count preview. |
| `backend/security/sudo/page.tsx` | Sudo challenge configuration. Tree view of all registered packages and modules with toggle switches. Developer defaults shown with badge. Custom TTL input per target. |
| `backend/security/users/page.tsx` | User security management. Table with columns: user, email, MFA status, method count, compliance state, last login. Row actions: view detail, reset MFA. |

### 13.3 Shared components

| Component | File | Description |
|---|---|---|
| `SudoChallengeModal` | `components/SudoChallengeModal.tsx` | Radix Dialog for re-authentication. Auto-detects method (password vs MFA). For built-in providers: renders TOTP 6-digit input, passkey browser prompt, or OTP email flow. For custom providers: renders the provider's `VerifyComponent` or a generic code input. Resolves with sudo token on success, null on cancel. |
| `GenericProviderSetup` | `components/GenericProviderSetup.tsx` | Fallback setup component for custom providers that don't supply `SetupComponent`. Renders a form based on the provider's `setupSchema` (Zod → form fields). |
| `GenericProviderVerify` | `components/GenericProviderVerify.tsx` | Fallback verify component for custom providers that don't supply `VerifyComponent`. Renders a single code input field. |
| `MfaMethodCard` | `components/MfaMethodCard.tsx` | Card displaying one MFA method: icon per type, label, active/inactive badge, last-used timestamp, remove button with confirmation. |
| `TotpSetupWizard` | `components/TotpSetupWizard.tsx` | Multi-step: (1) QR code + manual secret, (2) verification input, (3) recovery codes display. Uses `qrcode` for client-side QR or receives data URI from server. |
| `PasskeySetupFlow` | `components/PasskeySetupFlow.tsx` | Handles `navigator.credentials.create()` ceremony. Browser support check, authenticator prompt, label input, success confirmation. |
| `PasswordChangeForm` | `components/PasswordChangeForm.tsx` | Current password + new password + confirmation. Real-time policy validation feedback (length, complexity). Submit calls `PUT /api/security/profile/password`. |
| `EnforcementPolicyForm` | `components/EnforcementPolicyForm.tsx` | Scope selector, tenant/org picker (conditional), deadline date picker, method checkboxes, affected users preview count. |
| `MfaComplianceBadge` | `components/MfaComplianceBadge.tsx` | Status badge: "Enrolled" (green), "Pending" (yellow), "Overdue" (red), "Not Required" (grey). |
| `RecoveryCodesDisplay` | `components/RecoveryCodesDisplay.tsx` | Grid of recovery codes with copy-all button and download-as-txt button. Shown once during generation with warning. |
| `SudoProvider` | `components/SudoProvider.tsx` | React context provider wrapping app layout. Manages sudo token state, renders `SudoChallengeModal` when triggered, exposes `openChallenge()` to children via context. |

### 13.4 Widget injection points

The profile page exposes injection points so other modules can extend it:

| Injection ID | Location | Description |
|---|---|---|
| `security.profile.sections` | Profile page body | Other modules register widget components that render as additional collapsible sections below password change. |
| `security.profile.sidebar` | Profile side navigation | Modules add extra navigation items (e.g. "API Keys", "Connected Apps"). |
| `security.admin.user-actions` | Admin user table rows | Modules add context-specific action buttons per user row. |

---

## 14. Auth flow integration

### 14.1 Login flow modification

The existing `POST /api/auth/login` endpoint is extended **without modifying the auth module**. A security module event subscriber listens to `auth.login.success`:

```typescript
// packages/enterprise/src/modules/security/subscribers/auth-login.ts

// Subscribes to: auth.login.success
// 1. Receives { userId, tenantId } from event payload
// 2. Queries UserMfaMethod for active methods where userId matches
// 3. If no active methods → does nothing (standard JWT issued by auth module)
// 4. If active methods found → modifies the response:
//    - Replaces full JWT with a partial/pending token (short-lived, 10 min)
//    - Adds to response body:
//      { mfa_required: true, challenge_id: <new MfaChallenge.id>,
//        available_methods: [{ type: 'totp', label: 'Authenticator App', icon: 'Smartphone' }, ...] }
// 5. Client detects mfa_required and presents MFA challenge UI
//    (renders built-in UI for known types, or provider's VerifyComponent for custom types)
// 6. After successful POST /api/security/mfa/verify:
//    - Full JWT issued with additional claims: mfa_verified: true, mfa_methods: ['totp', 'passkey']
```

### 14.2 JWT token extensions

Two optional claims are added to the JWT payload. Existing JWT validation ignores unknown claims, so this is fully backwards-compatible:

| Claim | Type | Description |
|---|---|---|
| `mfa_verified` | `boolean` | `true` when user completed MFA during this session. Absent for non-MFA users. |
| `mfa_methods` | `string[]` | List of enrolled MFA method types. Used by sudo challenge to determine available methods. |

### 14.3 Enforcement redirect

When MFA enforcement is active, the auth middleware (extended via shared library) adds an `mfa_enrollment_required` flag to the auth context. The frontend layout checks this flag and redirects unenrolled users to `/profile/mfa`. After `enforcement_deadline`, the auth middleware blocks JWT issuance entirely.

---

## 15. Sudo challenge system — detailed design

### 15.1 Developer defaults via `setup.ts`

Module developers declare sudo-protected targets in their module's `setup.ts`. These are registered during module bootstrap with `is_developer_default: true` and can be toggled off by superadmin:

```typescript
// Example: in any module's setup.ts
export const setup: ModuleSetupConfig = {
  // ... other config
  sudoProtected: [
    { type: 'feature', identifier: 'auth.roles.delete' },
    { type: 'route', identifier: 'DELETE /api/auth/roles/:id' },
    { type: 'module', identifier: 'billing.settings' },
  ],
}
```

During bootstrap, the security module scans all registered modules for `sudoProtected` arrays and calls `SudoChallengeService.registerDeveloperDefault()` for each entry. Entries are upserted (existing entries are not duplicated).

### 15.2 Superadmin UI overrides

The admin sudo configuration page (`backend/security/sudo/page.tsx`) displays:

- Tree view of all packages → modules → features/routes
- Each node has a toggle switch (enabled/disabled)
- Developer defaults shown with a "Developer Recommended" badge
- Custom TTL input per target (slider: 1–30 minutes)
- Challenge method selector: Auto (MFA if available, else password), Password only, MFA only
- Scope selector: Platform-wide, per tenant, or per organisation

### 15.3 Resolution order

When checking if a target is sudo-protected, configs are resolved in this order (first match wins):

1. Organisation-specific config (most specific)
2. Tenant-specific config
3. Platform-wide admin config
4. Developer default

If `is_enabled: false` at any level, it overrides lower-priority configs.

### 15.4 API-side enforcement

```typescript
// In an API route handler:
import { requireSudo } from '@open-mercato/enterprise/security'

export async function DELETE(req: NextRequest) {
  await requireSudo(req, 'auth.roles.delete')
  // If we get here, sudo validation passed
  // ... proceed with the protected deletion
}
```

If the `X-Sudo-Token` header is missing or invalid, `requireSudo` throws `SudoRequiredError`, which the global error handler catches and returns:

```json
{
  "status": 403,
  "error": "sudo_required",
  "message": "Sudo authentication required for: auth.roles.delete",
  "challenge_url": "/api/security/sudo/challenge"
}
```

### 15.5 Frontend enforcement

```typescript
// In any module's React component:
import { useSudoChallenge } from '@open-mercato/enterprise/security/components'

function DeleteRoleButton({ roleId }: { roleId: string }) {
  const { requireSudo } = useSudoChallenge()

  const handleDelete = async () => {
    const sudoToken = await requireSudo('auth.roles.delete')
    if (!sudoToken) return // user cancelled the challenge modal

    await fetch(`/api/auth/roles/${roleId}`, {
      method: 'DELETE',
      headers: { 'X-Sudo-Token': sudoToken },
    })
  }

  return <button onClick={handleDelete}>Delete Role</button>
}
```

---

## 16. Email templates

Create email templates in `emails/` using React components with the existing Resend integration:

| Template | File | Trigger | Content |
|---|---|---|---|
| OTP Code (email) | `emails/otp-code.tsx` | OTP email MFA verification | 6-digit code, 10-min expiry note, "if you didn't request this" warning |
| MFA Enrolled | `emails/mfa-enrolled.tsx` | New MFA method activated | Method type, timestamp, "if you didn't do this contact admin" |
| MFA Reset | `emails/mfa-reset.tsx` | Admin resets user's MFA | Admin action notice, instructions to re-enroll, support contact |
| Enforcement Deadline | `emails/enforcement-deadline.tsx` | 7/3/1 days before deadline | Days remaining, link to MFA setup, what happens after deadline |

---

## 17. Dependencies

New npm packages to add to `packages/enterprise/package.json`:

| Package | Version | Purpose |
|---|---|---|
| `otpauth` | `^9.x` | RFC 6238 TOTP generation and verification. Zero dependencies. |
| `@simplewebauthn/server` | `^11.x` | Server-side WebAuthn/FIDO2 registration and authentication. |
| `@simplewebauthn/browser` | `^11.x` | Client-side WebAuthn API wrapper for passkeys. |
| `qrcode` | `^1.x` | QR code generation for TOTP provisioning URIs. |

Existing dependencies already available and leveraged: `bcryptjs`, `@open-mercato/shared` (encryption, auth, email via Resend), `zod`, `@mikro-orm/core`, `pg`, Redis client.

---

## 18. Environment variables

Add to `.env.example`:

```env
# ── Security Module ──
SECURITY_TOTP_ISSUER=Open Mercato          # TOTP issuer name shown in authenticator apps
SECURITY_TOTP_WINDOW=1                     # TOTP time-step tolerance (number of windows)
SECURITY_OTP_EXPIRY_SECONDS=600            # OTP email code validity period
SECURITY_OTP_MAX_ATTEMPTS=5                # Max OTP verification attempts per challenge
SECURITY_SUDO_DEFAULT_TTL=300              # Default sudo token TTL in seconds
SECURITY_SUDO_MAX_TTL=1800                 # Maximum configurable sudo TTL
SECURITY_WEBAUTHN_RP_NAME=Open Mercato     # WebAuthn relying party name
SECURITY_WEBAUTHN_RP_ID=                   # WebAuthn RP ID (defaults to hostname)
SECURITY_RECOVERY_CODE_COUNT=10            # Number of recovery codes generated
SECURITY_MFA_EMERGENCY_BYPASS=false        # Emergency bypass for MFA (disaster recovery only)
```

---

## 19. Security considerations

### TOTP

- Secrets encrypted at rest using tenant-scoped keys via Vault integration.
- Time-step tolerance of 1 window (30 seconds before/after) to accommodate clock drift.
- Used codes tracked in a short-lived Redis set to prevent replay within the same time window.
- Secret displayed only during setup; never retrievable via API after confirmation.

### WebAuthn / Passkeys

- Credential public keys encrypted at rest.
- Signature counter validated on each authentication to detect cloned keys.
- Origin and RP ID validation enforced server-side.
- Attestation verification optional (configurable) for enterprise hardware key requirements.

### OTP email

- 6-digit codes with 10-minute expiry.
- Codes bcrypt-hashed before storage (never stored in plaintext).
- Rate limiting: max 3 OTP requests per 10-minute window per user.
- Codes bound to specific challenge sessions; cannot be reused across challenges.

### Custom MFA providers

- Custom providers must implement the full `MfaProviderInterface` contract.
- Provider-specific secrets/credentials are stored in the `provider_metadata` JSONB column — the security module does not interpret this data, but it is still encrypted at rest via the field-level encryption system.
- Providers are responsible for their own verification security (rate limiting within the provider, replay protection, etc.).
- The registry validates providers at registration time against the interface contract.
- Custom provider types appear in enforcement policy `allowed_methods` alongside built-in types.

### Sudo tokens

- HMAC-SHA256 signed with server secret; not user-forgeable.
- Validated both cryptographically (signature) and via database lookup (session table).
- Default TTL of 5 minutes; configurable per target (1–30 minutes).
- Tokens scoped to user session; cannot be transferred between users.
- Expired sessions purged via scheduled cleanup job.

### Recovery codes

- 10 codes generated using `crypto.randomBytes` (cryptographically secure).
- Each code bcrypt-hashed individually; original codes shown only once during generation.
- Consumed codes marked `is_used: true` and cannot be reused.
- Regeneration invalidates all previous codes.
- Recovery code usage triggers security notification to user.

### Rate limiting

- MFA verification: max 5 attempts per challenge session (then challenge is invalidated).
- Password change: max 5 attempts per hour per user.
- Sudo challenge: max 3 attempts per session.
- All rate limits enforced via Redis counters with TTL.
- Account lockout notification after excessive failed attempts.

---

## 20. Implementation phases

### Phase 1: Foundation (weeks 1–2)

Goal: module scaffolding, database entities, profile page with password management.

| Task | Priority | Est. days | Depends on |
|---|---|---|---|
| Scaffold module structure (all standard files) | High | 0.5 | — |
| Create database entities and migration | High | 1 | Scaffold |
| Implement `PasswordService` | High | 1 | Entities |
| Build profile page with widget injection points | High | 1.5 | PasswordService |
| Build `PasswordChangeForm` component | High | 1 | Profile page |
| Profile/password API endpoints with OpenAPI specs | High | 1 | PasswordService |
| Feature permissions and role setup (`setup.ts`, `acl.ts`) | High | 0.5 | Scaffold |
| Event definitions and audit subscribers | Medium | 0.5 | Scaffold |
| Unit tests for `PasswordService` | High | 1 | PasswordService |

### Phase 2: MFA core (weeks 3–4)

Goal: provider registry, all three built-in MFA methods, verification, modified login flow.

| Task | Priority | Est. days | Depends on |
|---|---|---|---|
| Implement `MfaProviderInterface` and `MfaProviderRegistry` | Critical | 1 | Phase 1 |
| Implement `TotpProvider` (built-in) | High | 1 | Registry |
| Implement `PasskeyProvider` (built-in) | High | 1.5 | Registry |
| Implement `OtpEmailProvider` (built-in) | High | 0.5 | Registry |
| `MfaService` (unified service delegating to registry) | High | 1.5 | All providers |
| `MfaVerificationService` (unified verifier via registry) | High | 1 | MfaService |
| Recovery code generation and verification | High | 1 | MfaService |
| Auth login flow integration (event subscriber) | Critical | 1.5 | MfaVerificationService |
| MFA management page + setup wizards (TOTP, passkey) | High | 2 | MFA APIs |
| `GenericProviderSetup` + `GenericProviderVerify` components | High | 1 | Registry |
| MFA API endpoints including `/providers` and `/provider/:type/*` | High | 1 | MfaService |
| Bootstrap auto-discovery for `mfaProviders` in module setup | High | 0.5 | Registry |
| Integration tests for all MFA flows | High | 1.5 | All MFA work |

### Phase 3: Enforcement and admin (weeks 5–6)

Goal: MFA enforcement policies, admin management UI, and MFA reset.

| Task | Priority | Est. days | Depends on |
|---|---|---|---|
| `MfaEnforcementService` | High | 1.5 | Phase 2 |
| Enforcement redirect middleware | High | 1 | EnforcementService |
| `MfaAdminService` (reset, status, bulk check) | High | 1 | Phase 2 |
| Enforcement API endpoints | High | 1 | EnforcementService |
| Admin enforcement management page | High | 1.5 | Enforcement APIs |
| Admin user security management page | High | 1 | MfaAdminService |
| Security dashboard page | Medium | 1 | All admin services |
| Enforcement notification handlers (deadline reminders) | Medium | 0.5 | EnforcementService |
| Tests for enforcement and admin flows | High | 1 | All Phase 3 |

### Phase 4: Sudo system and polish (weeks 7–8)

Goal: complete sudo challenge system, developer APIs, i18n, production hardening.

| Task | Priority | Est. days | Depends on |
|---|---|---|---|
| `SudoChallengeService` | High | 1.5 | Phase 2 |
| Sudo validation middleware (`requireSudo`) | High | 1 | SudoService |
| `SudoChallengeModal` component | High | 1.5 | SudoService |
| `useSudoChallenge` hook + `SudoProvider` | High | 1 | Modal |
| Admin sudo configuration page | High | 1.5 | SudoService |
| Developer default registration during bootstrap | High | 0.5 | SudoService |
| `withSudoProtection` HOC | Medium | 0.5 | useSudoChallenge |
| Complete i18n translations (`i18n/en.json`) | Medium | 0.5 | All UI |
| Email templates (OTP, MFA changes, enforcement) | Medium | 0.5 | All services |
| End-to-end integration tests | High | 1.5 | All Phase 4 |
| Security audit and hardening review | Critical | 1 | All phases |

---

## 21. Testing strategy

Tests use Jest 30 (existing infrastructure). Coverage targets are higher than standard modules due to the sensitivity of security logic.

**Unit tests:** every service method with edge cases — policy validation, hash verification, TOTP time drift, counter validation, attempt counting, TTL expiry, scope resolution cascading.

**Integration tests:** full flows end-to-end — MFA enrollment through login through verification through JWT issuance, enforcement creation through redirect through enrollment through compliant login, sudo protection through 403 through challenge through verify through retry with token.

**Coverage targets:**

| Area | Target |
|---|---|
| Service layer | > 90% |
| API routes | > 85% |
| Lib utilities (crypto, TOTP, WebAuthn) | > 95% |
| React components | > 75% |

## 21.1 Integration test specification (required)

Integration tests for this module must be implemented under the existing QA harness, using Playwright TypeScript tests and API-level fixture setup.

### Test placement

- Primary suite folder:
  - `/.ai/qa/tests/integration/security/`
- Suggested file split:
  - `/.ai/qa/tests/integration/security/security-mfa-flows.spec.ts`
  - `/.ai/qa/tests/integration/security/security-enforcement.spec.ts`
  - `/.ai/qa/tests/integration/security/security-sudo.spec.ts`
  - `/.ai/qa/tests/integration/security/security-admin.spec.ts`
  - `/.ai/qa/tests/integration/security/security-provider-registry.spec.ts`

### Mandatory test scenarios

1. MFA core:
   - enroll/verify TOTP
   - enroll/verify passkey (feature-detected; skip with explicit reason when unsupported in CI runtime)
   - enroll/verify OTP email
   - challenge verification success/failure attempt counters
   - recovery code usage and regeneration
2. Enforcement:
   - policy cascade resolution (organisation > tenant > platform)
   - grace-period redirect to MFA enrollment
   - hard lockout after deadline
   - `allowed_methods` filtering affects setup options and verify paths
3. Sudo:
   - protected endpoint returns sudo-required response without valid token
   - challenge + verify returns short-lived token
   - token accepted within TTL, rejected after expiry
   - admin override disables/enables developer default target
4. Admin/security operations:
   - superadmin MFA reset path with reason
   - user status/compliance reporting endpoints
   - cross-tenant isolation checks (cannot read/manage another tenant's users)
5. Provider registry:
   - built-in providers listed
   - custom provider registration appears in `/api/security/mfa/providers`
   - generic fallback UI path works when custom `SetupComponent`/`VerifyComponent` missing

### Fixture and cleanup rules

- Tests must be fully self-contained:
  - create tenants/users/policies/method records via API fixtures per test or per describe block
  - never rely on seeded/demo data
- Cleanup must run in `finally`/teardown:
  - remove created users, methods, policies, sudo configs/sessions, and challenge records
- Each test must assert tenant scoping boundaries where relevant.

### Execution and CI

- Local run:
  - `yarn test:integration --grep security`
- Full suite:
  - `yarn test:integration`
- Report:
  - `yarn test:integration:report`

### Coverage gate for this module

- No phase in this ADR is considered complete without corresponding integration coverage for new API paths and key UI paths introduced in that phase.

---

## 22. Complete file manifest

All files to create in `packages/enterprise/src/modules/security/`:

```
security/
├── index.ts                                    # Module exports (public API)
├── setup.ts                                    # Module init, role features, sudo defaults
├── acl.ts                                      # Feature permission definitions
├── di.ts                                       # Awilix DI service registration
├── events.ts                                   # Event type definitions
├── types.ts                                    # TypeScript interfaces and types
├── notifications.ts                            # Notification handler registrations
│
├── data/
│   ├── entities.ts                             # MikroORM entity definitions (6 entities)
│   └── validators.ts                           # Zod schemas for API validation
│
├── migrations/
│   └── Migration[timestamp].ts                 # Database migration
│
├── services/
│   ├── PasswordService.ts                      # Password change and verification
│   ├── MfaService.ts                           # MFA method lifecycle management
│   ├── MfaVerificationService.ts               # MFA challenge verification
│   ├── MfaEnforcementService.ts                # Enforcement policy management
│   ├── MfaAdminService.ts                      # Superadmin MFA operations
│   └── SudoChallengeService.ts                 # Sudo challenge lifecycle
│
├── lib/
│   ├── mfa-provider-interface.ts               # MfaProviderInterface type definition
│   ├── mfa-provider-registry.ts                # MfaProviderRegistry singleton
│   ├── sudo-middleware.ts                       # API route sudo validation middleware
│   ├── otp.ts                                  # OTP code generation and hashing
│   └── providers/                              # Built-in MFA provider implementations
│       ├── TotpProvider.ts                     # TOTP (RFC 6238) provider
│       ├── PasskeyProvider.ts                  # WebAuthn/FIDO2 provider
│       └── OtpEmailProvider.ts                 # OTP email provider
│
├── api/
│   ├── profile/route.ts                        # Profile and password endpoints
│   ├── mfa/route.ts                            # MFA management endpoints
│   ├── enforcement/route.ts                    # Enforcement policy endpoints
│   ├── sudo/route.ts                           # Sudo challenge endpoints
│   ├── admin/route.ts                          # Admin security endpoints
│   └── openapi.ts                              # OpenAPI spec definitions
│
├── backend/
│   ├── profile/
│   │   ├── page.tsx                            # User profile page (extensible)
│   │   └── mfa/
│   │       ├── page.tsx                        # MFA management page
│   │       ├── setup-totp/page.tsx             # TOTP setup wizard
│   │       └── setup-passkey/page.tsx          # Passkey registration flow
│   └── security/
│       ├── page.tsx                            # Security dashboard
│       ├── enforcement/page.tsx                # Enforcement management
│       ├── sudo/page.tsx                       # Sudo configuration
│       └── users/page.tsx                      # User security management
│
├── components/
│   ├── SudoChallengeModal.tsx                  # Sudo re-auth dialog
│   ├── SudoProvider.tsx                        # Sudo context provider
│   ├── MfaMethodCard.tsx                       # MFA method display card
│   ├── TotpSetupWizard.tsx                     # TOTP enrollment component
│   ├── PasskeySetupFlow.tsx                    # WebAuthn registration component
│   ├── GenericProviderSetup.tsx                # Fallback setup UI for custom providers
│   ├── GenericProviderVerify.tsx               # Fallback verify UI for custom providers
│   ├── PasswordChangeForm.tsx                  # Password change form
│   ├── EnforcementPolicyForm.tsx               # Enforcement policy editor
│   ├── MfaComplianceBadge.tsx                  # Compliance status badge
│   ├── RecoveryCodesDisplay.tsx                # Recovery code presentation
│   └── hooks/
│       ├── useSudoChallenge.ts                 # Developer-facing sudo hook
│       └── useMfaStatus.ts                     # MFA status hook
│
├── widgets/
│   ├── injection/profile-sections.ts           # Profile page widget injection config
│   └── dashboard/security-stats.ts             # Dashboard widget config
│
├── subscribers/
│   ├── audit.ts                                # Audit log event subscriber
│   ├── notification.ts                         # User notification subscriber
│   └── auth-login.ts                           # Login flow MFA interceptor
│
├── emails/
│   ├── otp-code.tsx                            # OTP email template
│   ├── mfa-enrolled.tsx                        # MFA enrollment confirmation
│   ├── mfa-reset.tsx                           # MFA reset notification
│   └── enforcement-deadline.tsx                # Enforcement deadline reminder
│
└── i18n/
    └── en.json                                 # English translations
```

---

## 23. Risk assessment

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| WebAuthn browser compatibility | Medium | Low | SimpleWebAuthn provides polyfills. Graceful degradation to TOTP. Feature detection before offering passkey. |
| Login flow regression | Critical | Medium | Event subscriber pattern avoids modifying auth module. Feature flag to disable MFA check. Comprehensive login integration tests. |
| Clock drift affecting TOTP | Low | Medium | 1-window tolerance. Server NTP sync. Error message suggesting user time sync. |
| Enforcement lockout (users locked out accidentally) | High | Low | Grace period with deadline. Superadmin always has MFA reset. Emergency bypass env flag. |
| Sudo token forgery | Critical | Very Low | HMAC-SHA256 with server secret. Dual validation (crypto + DB). Short TTL. |
| Migration on large user bases | Medium | Low | New tables only (no ALTER on existing). Additive, non-blocking migration. |
| Recovery code exhaustion | Medium | Medium | Warning notifications at 3 and 1 remaining. Regeneration always available. Admin reset as last resort. |
| Malicious custom MFA provider | Medium | Low | Providers validated against interface at registration. Provider code runs in the same trust boundary as the module that registered it (same as any other module code). Code review required for third-party modules. |

---

## 24. Consequences

**Positive:**

- All users gain self-service password management and MFA enrollment without admin intervention.
- Enterprise customers can enforce MFA at any organisational level with compliance tracking.
- The sudo challenge system protects critical operations across all modules with a simple developer API.
- Module developers get a one-line integration (`requireSudo` / `useSudoChallenge`) for protecting sensitive actions.
- Module developers can contribute custom MFA methods via `MfaProviderInterface` without modifying the security module — providers are auto-discovered and integrate with enrollment, verification, enforcement, and the challenge UI automatically.
- No modifications to the existing auth module — the security module integrates purely through events and shared libraries.

**Negative:**

- Login flow adds one additional database query per login to check for MFA methods (mitigated by index on `user_id, type, is_active`).
- Four new npm dependencies added to the core package.
- Sudo-protected actions add one additional HTTP round-trip for token validation (mitigated by short-lived token caching in SudoProvider context).
- Superadmins have a new configuration surface (enforcement policies, sudo configs) that requires training/documentation.

**Neutral:**

- Recovery codes add user responsibility to store codes securely. This is standard industry practice.
- WebAuthn support depends on browser capabilities, but TOTP and OTP email provide universal fallback.
- Custom MFA providers run in the same trust boundary as the module that registered them — this is consistent with Open Mercato's module architecture but means third-party modules should be code-reviewed.
