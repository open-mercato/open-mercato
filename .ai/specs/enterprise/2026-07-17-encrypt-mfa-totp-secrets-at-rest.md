# Encrypt MFA Provider Secrets At Rest

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Created** | 2026-07-17 |
| **Tracks** | [#3854](https://github.com/open-mercato/open-mercato/issues/3854) |
| **Builds on** | [SPEC-ENT-001 Security Module (Enterprise MFA)](implemented/SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa.md) |
| **Related** | `packages/enterprise/src/modules/security/`, `packages/shared/src/lib/encryption/`, `BACKWARD_COMPATIBILITY.md` |

## TLDR

**Key Points:**
- `UserMfaMethod.secret` (the TOTP seed) is persisted and read as plaintext — the `security` module declares no `encryption.ts`. A read-only DB compromise yields every enrolled user's seed and collapses the TOTP second factor tenant-wide (#3854).
- The naïve fix (declare the encryption map) **breaks enrollment**: `MfaService.confirmMethod` locates the pending method **by the `secret` column** (`em.findOne(UserMfaMethod, { …, secret: setupId })`) — an equality filter that can never match ciphertext. Worse, the TOTP `setupId` stored there is an HMAC-signed token whose base64url payload **embeds the plaintext seed**, so pending rows leak the seed too.
- This spec replaces the secret-as-session-key lookup with a hashed `setup_token_hash` column, declares the encryption map for `security:user_mfa_method.secret`, switches secret-consuming reads to the decryption helpers, and ships a per-tenant backfill CLI — with a dual-read window so in-flight setups and existing plaintext rows keep working during rollout.

**Scope:**
- Additive `setup_token_hash` column + module migration; confirm-flow lookup by hash with a legacy fallback.
- `encryption.ts` default map for `security:user_mfa_method` field `secret`.
- Decryption-helper reads in `MfaVerificationService`; a `mercato security encrypt-mfa-secrets` backfill CLI; `UPGRADE_NOTES.md` entry.

**Boundaries:**
- No provider-interface change: `setup()`/`confirmSetup()` signatures and the client-visible setupId format are untouched.
- Recovery codes and OTP-email codes are already bcrypt-hashed (`data/entities.ts:72`, `lib/otp.ts:21`) — out of scope.
- Crypto-shredding / per-method DEKs and passkey material (#3852) are out of scope.

## Problem Statement

The `ent_security` module stores the confirmed TOTP seed in `user_mfa_methods.secret` with no at-rest protection:

1. `MfaService.setupMethod` creates the pending row with `secret: result.setupId` (`services/MfaService.ts:84`), where TOTP's `setupId` is `base64url({ u: userId, s: <plaintext seed>, c: createdAt }) + HMAC` (`lib/providers/TotpProvider.ts:193-200`) — the seed is trivially decodable from the stored value.
2. `MfaService.confirmMethod` finds the pending row **by that value** — `em.findOne(UserMfaMethod, { userId, isActive: false, deletedAt: null, secret: setupId })` (`services/MfaService.ts:103-107`) — then overwrites `method.secret` with the provider-confirmed seed (`services/MfaService.ts:140`).
3. `MfaVerificationService.findMethod`/`findMethodById` read the confirmed seed with plain `em.findOne` (`services/MfaVerificationService.ts:288,301`) and hand it to the provider's `verify`.

With a read-only database compromise (backup leak, replica access, SQL-read vulnerability elsewhere), an attacker obtains every enrolled user's seed — both confirmed rows and pending setups — and can mint valid TOTP codes for all of them. The module is otherwise well-hashed (recovery codes and OTP-email codes use bcrypt); the provider `secret` is the one at-rest gap.

Declaring the encryption map alone is not shippable: the platform's `TenantDataEncryptionService` encrypts mapped fields via the ORM subscriber (`shared/src/lib/encryption/subscriber.ts` — `beforeCreate`/`beforeUpdate`/`onLoad`), so the confirm-flow equality filter in (2) would compare the client's plaintext `setupId` against stored ciphertext and never match — every new enrollment would fail with `MFA setup session not found`.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Locate pending setups by a new `setup_token_hash` column (SHA-256 of the client-held setupId), not by `secret` | Encrypted fields cannot serve as equality filters. A digest column supports the lookup without persisting anything decodable — the raw setupId (which embeds the seed for TOTP) never touches the database again. Mirrors the module's existing hash-at-rest posture (bcrypt recovery codes) and the platform's `hashField` lookup pattern (`auth:user.email_hash`). |
| Pending rows stop storing the setupId in `secret`; `secret` stays `NULL` until confirmation | Closes the pending-row leak in the same change. The seed exists server-side only transiently inside `confirmSetup` (TOTP re-derives it from the client-presented signed token), and at rest only in encrypted form after confirmation. |
| Legacy fallback in `confirmMethod`: when no row matches the hash, look up `{ userId, isActive: false, deletedAt: null, secret: setupId, setupTokenHash: null }` | In-flight setups created before the upgrade have the setupId in `secret` (plaintext) and no hash. The fallback is narrow (only hash-less pending rows), keeps those setups confirmable across the deploy, and is removable after one minor release per the deprecation protocol. |
| Encryption map declared in module `encryption.ts` (`security:user_mfa_method`, field `secret`) — no `hashField` for `secret` | After the lookup migration nothing filters on `secret` equality, so no companion hash is needed. The subscriber encrypts on create/update and decrypts on load once the map is seeded and `TENANT_DATA_ENCRYPTION` is enabled for the tenant. |
| Secret-consuming reads switch to `findOneWithDecryption` | Belt-and-braces per the platform encryption rules; the helper's fallback-scope decryption derives the tenant from the loaded row, so no signature changes are needed in `MfaVerificationService`'s private helpers. |
| Backfill is a module CLI (`mercato security encrypt-mfa-secrets`), not a SQL migration | Tenant-key encryption happens at the ORM layer with per-tenant DEKs — SQL cannot produce the ciphertext. The CLI re-persists rows through the `EntityManager` so the subscriber encrypts them; `isEncryptedWithDek` makes re-runs idempotent and prevents double encryption (`tenantDataEncryptionService.ts:369`). |
| Mixed plaintext/ciphertext reads need no special handling | `decryptFields` leaves values that do not decrypt as-is (`tenantDataEncryptionService.ts:400-410`), so plaintext rows keep verifying before the backfill reaches them, and encrypted rows decrypt — per tenant, in any order. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| `hashField: 'secret_hash'` on the encryption map and keep filtering by (hashed) secret | Keeps the secret doubling as a session identifier — the design smell that caused the blocker. The setupId is a *session* artifact; a dedicated token column names the concept and lets pending rows hold no secret-derived value at all. |
| Encrypt in application code inside `MfaService` (explicit encrypt/decrypt calls) | Bypasses the platform's single encryption path (map + subscriber + helpers) and its key rotation/rollout tooling; hand-rolled crypto call sites are exactly what the shared service exists to prevent. |
| Store pending setups outside the entity (cache/table with TTL) | Larger blast radius: new storage, new expiry semantics, and the passkey/OTP providers' pending flows would need re-plumbing. The hash column is additive and confined. |
| SQL migration that "encrypts" existing rows | Impossible at the SQL layer: DEKs are per-tenant and resolved through the KMS abstraction at runtime. |

## Architecture

```text
setup:    provider.setup() → { setupId, clientData }          confirm:  client presents setupId
              │                                                    │
              ▼                                                    ▼
   INSERT user_mfa_methods                              lookup by sha256(setupId)
   { setupTokenHash: sha256(setupId),                   → fallback (legacy rows only):
     secret: NULL, isActive: false }                      { secret: setupId, setupTokenHash: NULL }
                                                               │
                                                               ▼
                                             provider.confirmSetup() → { secret, metadata }
                                             UPDATE { secret, setupTokenHash: NULL, isActive: true }
                                                               │  (subscriber encrypts `secret`)
verify:   findOneWithDecryption(UserMfaMethod, …) → provider.verify(…, secret decrypted)
```

## Data Model

Additive migration on `user_mfa_methods` (module-scoped, `packages/enterprise/src/modules/security/migrations/`):

| Column | Type | Notes |
|--------|------|-------|
| `setup_token_hash` | `varchar(64) NULL` | SHA-256 hex of the client-held setupId. Set on pending rows, cleared on confirmation. Partial index `(user_id, setup_token_hash) WHERE setup_token_hash IS NOT NULL`. |

`secret` keeps its column type; its content becomes AES-GCM ciphertext (v1 payload format) for tenants with data encryption enabled once the map is seeded and the backfill has run. No other schema change; snapshot updated in the same commit per the migration workflow.

## Implementation Plan

### Phase 1 — Decouple the setup-session lookup from `secret`

1. Migration + entity property `setupTokenHash` (nullable) on `UserMfaMethod`.
2. `MfaService.setupMethod`: persist `setupTokenHash: sha256(result.setupId)`, `secret: null`.
3. `MfaService.confirmMethod`: primary lookup by `{ userId, isActive: false, deletedAt: null, setupTokenHash: sha256(setupId) }`; legacy fallback by `{ …, secret: setupId, setupTokenHash: null }`; on success write the confirmed `secret`, clear `setupTokenHash`.
4. Unit tests: confirm-by-hash, legacy fallback, hash cleared after confirmation, unknown setupId → 404.

Phase 1 is independently shippable and already removes the pending-row seed leak.

### Phase 2 — Encrypt the confirmed secret

1. `packages/enterprise/src/modules/security/encryption.ts` exporting `defaultEncryptionMaps` for `security:user_mfa_method` field `secret`; `yarn generate`.
2. `MfaVerificationService.findMethod`/`findMethodById` → `findOneWithDecryption` (fallback-scope decryption from the row's own `tenantId`).
3. Module CLI `mercato security encrypt-mfa-secrets [--tenant <uuid>]`: for each tenant with data encryption enabled, load `user_mfa_methods` rows and re-persist through the EM so the subscriber encrypts plaintext secrets; report counts; idempotent.
4. `UPGRADE_NOTES.md` (0.6.x): operators enable per tenant with `yarn mercato entities seed-encryption --tenant <id>` (seeds the map) followed by the backfill CLI; note the mixed-state read guarantee and the legacy confirm fallback window.
5. Tests: map declaration pinned; verification reads decrypt (subscriber-mocked service test); CLI idempotency (second run touches zero rows).

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `security/data/entities.ts` | Modify | `setupTokenHash` property |
| `security/migrations/MigrationXXXX.ts` + `.snapshot-open-mercato.json` | Create/Update | Additive column + partial index |
| `security/services/MfaService.ts` | Modify | Hash-based setup persistence and confirm lookup + legacy fallback |
| `security/services/MfaVerificationService.ts` | Modify | Decryption-helper reads |
| `security/encryption.ts` | Create | Default encryption map |
| `security/cli.ts` | Create | `encrypt-mfa-secrets` backfill command |
| `security/services/__tests__/*` | Modify/Create | Confirm-flow, decrypt-read, CLI idempotency coverage |
| `UPGRADE_NOTES.md` | Modify | Operator rollout steps |

## Migration & Backward Compatibility

- All schema and contract changes are additive: new nullable column, new module files, new CLI command. No API route, event id, ACL feature, DI name, or provider-interface change; the client-visible setupId format is unchanged.
- **Rollout order matters and is documented, not enforced:** deploy code → apply migration → (per tenant, if encryption enabled) seed map → run backfill. At every intermediate state reads keep working: plaintext secrets pass through `decryptFields` untouched; encrypted secrets decrypt; pre-upgrade pending setups confirm via the legacy fallback.
- The legacy `secret`-equality fallback in `confirmMethod` carries a `@deprecated` note and is removed after ≥1 minor release, following the deprecation protocol. Pending setups are short-lived (provider TTL), so the practical window is hours, not releases.
- Rollback before the backfill is plain code revert. After the backfill, rollback requires keeping the encryption map (decryption stays available through the subscriber); reverting to a build without the map would return ciphertext to `verify` and break TOTP for backfilled tenants — called out in UPGRADE_NOTES as the one irreversible step.

## Risks & Impact Review

#### Enrollment breaks if the lookup migration and the encryption map ship together incorrectly
- **Severity**: High. **Mitigation**: phases are ordered so the lookup no longer touches `secret` before any encryption activates; Phase 1 ships alone if needed. Confirm-flow tests pin both lookup paths.

#### Tenant lockout on rollback after backfill
- **Severity**: High. **Mitigation**: UPGRADE_NOTES marks the backfill as the point of no return for map removal; decryption remains available as long as the map exists, and key material is owned by the platform KMS abstraction (rotation via `mercato entities rotate-encryption-key` is unaffected).

#### Backfill misses rows / double-encrypts
- **Severity**: Medium. **Mitigation**: `isEncryptedWithDek` skip makes re-persistence idempotent; the CLI reports scanned/encrypted/skipped counts per tenant and can be re-run safely.

#### Legacy fallback becomes a permanent second lookup path
- **Severity**: Low. **Mitigation**: fallback is gated to `setupTokenHash IS NULL` rows (impossible for post-upgrade writes), documented with a removal target.

## Final Compliance Report

- **Backward compatibility**: all changes are additive — a new nullable column, new module files, and a new CLI command. No API route, event id, ACL feature, DI name, generated-file contract, or provider-interface surface is removed or altered; the client-visible setupId format is unchanged. The one transitional path (legacy `secret`-equality confirm fallback) follows the deprecation protocol: `@deprecated` marker, ≥1 minor release bridge, UPGRADE_NOTES entry, removal target recorded in this spec.
- **API contracts**: no endpoint URLs, methods, request/response shapes, or `MfaProvider` signatures change. `setup()`/`confirmSetup()`/`verify()` are untouched.
- **Data model**: one additive module-scoped migration (`user_mfa_methods.setup_token_hash` varchar(64) NULL + partial index), shipped with the updated `.snapshot-open-mercato.json` in the same commit per the default migration workflow. `secret` keeps its column type; only its content becomes ciphertext for encryption-enabled tenants.
- **Migration & rollback stance**: rollout order (code → migration → per-tenant map seed → backfill) is documented in UPGRADE_NOTES; every intermediate state keeps reads and enrollments working (plaintext pass-through, legacy confirm fallback). Rollback is a plain code revert before the backfill; after the backfill, removing the encryption map is the single irreversible step and is called out as such.
- **Test & integration coverage expectations**: unit tests pin both confirm-lookup paths (hash + legacy fallback), hash clearing on confirmation, unknown-setupId rejection, the encryption-map declaration, decryption-helper reads in `MfaVerificationService`, and backfill CLI idempotency (second run touches zero rows). Integration coverage for the implementing PR: the full enroll → confirm → verify flow against an encryption-enabled tenant, exercised both before and after running the backfill CLI, with self-contained fixtures per `.ai/qa/AGENTS.md`.
- **Residual risk**: post-backfill map removal bricks TOTP for backfilled tenants (High — accepted, documented as the point of no return); the legacy confirm fallback briefly retains a plaintext-setupId lookup for pre-upgrade pending rows (Low — gated to `setup_token_hash IS NULL`, practical window is provider-TTL hours). No other unmitigated risks identified in the Risks & Impact Review.

## References

- Issue [#3854](https://github.com/open-mercato/open-mercato/issues/3854) and the [confirm-flow blocker analysis](https://github.com/open-mercato/open-mercato/issues/3854#issuecomment-4999659365)
- `packages/shared/src/lib/encryption/tenantDataEncryptionService.ts` (`encryptFields`/`decryptFields`/`isEncryptedWithDek`)
- `packages/shared/src/lib/encryption/subscriber.ts` (`beforeCreate`/`beforeUpdate`/`onLoad`, fallback-scope decryption)
- `packages/core/src/modules/auth/encryption.ts` (map + `hashField` precedent)
- `packages/core/src/modules/entities/cli.ts` (`seed-encryption`, `rotate-encryption-key`)

## Changelog

### 2026-07-17
- Initial specification, derived from the #3854 audit finding and the confirm-flow blocker analysis.
- Added the Final Compliance Report section summarizing checklist compliance (review feedback on #4256).
