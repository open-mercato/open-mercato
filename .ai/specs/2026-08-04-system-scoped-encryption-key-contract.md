# System-scoped encryption key contract

**Status:** partially implemented — Phase 1 and Phase 2 shipped in PR #4160; Phase 3 (rotation and decryption) is open and blocks nothing today but must land before a second system-scoped map is added.
**Issue:** #3876 · **PR:** #4160
**Owner decision required:** Phase 3, § Open Questions.

## Problem

Encryption at rest is tenant-scoped: `TenantDataEncryptionService` resolves a DEK per `tenant_id`, and the encryption map that says which fields are encrypted lives in the `encryption_maps` table, keyed by `(entity_id, tenant_id, organization_id)`.

Some records exist **before any tenant does**. A self-service onboarding request captures an email, a name, an organization name and a bcrypt password hash while the person filling the form still has no workspace; `tenant_id` is `NULL` until provisioning completes. With no tenant there is no DEK, so those records were written in plaintext — the exposure reported in #3876.

## Solution — `keyScope: 'system'`

A module declares an encryption map in code with an explicit key scope:

```ts
// packages/onboarding/src/modules/onboarding/encryption.ts
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'onboarding:onboarding_request',
    keyScope: 'system',
    fields: [
      { field: 'email', hashField: 'email_hash' },
      { field: 'first_name' },
      { field: 'last_name' },
      { field: 'organization_name' },
      { field: 'password_hash' },
    ],
  },
]
```

Contract:

| Aspect | Tenant scope (default) | System scope |
|---|---|---|
| Map source | `encryption_maps` row | module code (`defaultEncryptionMaps`), injected by `applySystemDefault` |
| KMS key id | `<tenantId>` | `system:<entityId>` — stable, independent of any tenant |
| Applies when | the record has a tenant | always, including `tenant_id IS NULL` |
| After the record gains a tenant | n/a | **still the system key** — the key id is derived from the entity, never from the row |
| Persisted as an `encryption_maps` row | yes | **no** — see § Invariants |
| Deterministic lookup | optional `hashField` | same |

The last row of that table is the important one: a completed onboarding request has a `tenant_id`, but its ciphertext is still sealed under `system:onboarding:onboarding_request`. Anything that infers the key from the row's `tenant_id` will get it wrong.

## Invariants

1. **A system-scoped map is never persisted as a tenant `encryption_maps` row.** Tenant setup (`setup-app.ts`) and `mercato entities seed-encryption` both skip them. Persisting one makes the tenant-scoped CLIs believe they own the entity — see § Migration & Backward Compatibility for the corruption path this closed.
2. **Tenant-scoped commands refuse system-scoped entities.** `rotate-encryption-key` and `decrypt-database` filter them out by the module-declared set (not by the DB row, so databases already carrying a stale row are protected) and log the skip, naming `backfill-system-encryption` instead.
3. **Fail closed.** `bootstrap.ts` throws rather than starting with an unresolved default-map list; the backfill aborts before writing when encryption is off or the KMS is unhealthy.
4. **Bytes on disk, not row visibility.** Soft-deleted rows are encrypted and backfilled like any other.

## Phases

### Phase 1 — write path (shipped, PR #4160)

- `ModuleEncryptionMap.keyScope` (optional, `'tenant' | 'system'`), passed through `getDefaultEncryptionMaps`.
- `TenantDataEncryptionService` accepts `defaultEncryptionMaps` and injects system maps via `applySystemDefault`; key id becomes `system:<entityId>`.
- The encryption subscriber no longer short-circuits on a missing tenant, so tenant-less entities reach the service.
- `onboarding_requests.email_hash` (nullable, unique) + additive migration; lookups read the hash with a legacy-plaintext `$or` fallback.

### Phase 2 — historical data (shipped, PR #4160)

- `mercato entities backfill-system-encryption [--entity] [--dry-run] [--batch-size] [--debug]` — forward-only, idempotent, keyset-paged over the primary key.
- Invariants 1 and 2 implemented and regression-tested.
- Operator documentation: `apps/docs/docs/user-guide/encryption.mdx` → *Backfilling system-scoped records*.

### Phase 3 — rotation and decryption (OPEN)

System-scoped data currently has **no** rotation or decryption path. Rotating the KMS/fallback key makes existing `system:<entityId>` ciphertext permanently unreadable, and `decrypt-database` cannot unwind it.

Bounded today because the only system-scoped entity is onboarding requests: they expire in 24 hours and `password_hash` is nulled on completion, so the residual data is a name, an email and an organization name on completed rows. The commands fail loudly rather than corrupting. This is why Phase 3 does not block Phase 1/2 shipping — but it MUST land before a second system-scoped map is declared.

Scope when it is picked up:

- `rotate-system-encryption-key --old-key`, mirroring `rotate-encryption-key` but resolving `system:<entityId>` for both the old and new DEK.
- A decrypt path for system scope, or an explicit documented decision that system-scoped data is write-only-encrypted and is dropped rather than decrypted.
- Whether `encryption_maps` should gain a `key_scope` column so persisted metadata can represent the scope, instead of relying on invariant 1.

## Migration & Backward Compatibility

**Contract-surface classification** (`BACKWARD_COMPATIBILITY.md`):

| Surface | Change | Classification |
|---|---|---|
| `ModuleEncryptionMap` (types) | added optional `keyScope` | ADDITIVE — compliant |
| `EncryptionMapRecord` (types) | added optional `keyScope` | ADDITIVE — compliant |
| `TenantDataEncryptionService` constructor | added optional `defaultEncryptionMaps` option | ADDITIVE — compliant |
| CLI commands | added `entities backfill-system-encryption` | ADDITIVE — compliant |
| DB schema | added nullable `onboarding_requests.email_hash` + unique constraint | ADDITIVE — compliant, reversible |
| CLI behavior | `rotate-encryption-key` / `decrypt-database` now skip system-scoped entities | **behavior change** — see below |

Nothing was removed, renamed or narrowed, so no deprecation bridge is required.

**The one behavior change, and why it is not a break.** Before this work, tenant setup persisted an `encryption_maps` row for every declared map — system-scoped included — with a `tenant_id`. A *completed* onboarding row also carries a `tenant_id`, so `rotate-encryption-key --old-key` matched it, failed to decrypt `system:<entityId>` ciphertext with the old tenant key, fell through with the ciphertext still in its payload, and re-encrypted that ciphertext under the tenant DEK. The result was unreadable by runtime decryption and unrecoverable without a backup. Those commands therefore never had a *working* behavior on system-scoped rows to preserve; skipping them removes a data-loss path rather than removing a capability.

**Upgrade path for an existing deployment:**

1. Ensure `TENANT_DATA_ENCRYPTION=true` and a healthy KMS — Vault, or a stable private `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`. The key **and** the lookup-hash pepper must stay stable across replicas and releases; changing either makes existing ciphertext unreadable or makes hash lookups miss previously written digests.
2. Apply the additive migration and restart every replica. Startup must not report a no-op/unhealthy KMS.
3. `yarn mercato entities backfill-system-encryption --dry-run`, then run it for real, then dry-run again to confirm zero rows remain.
4. Verify one legacy pending verification and one fresh signup end to end.

Deployments that skip step 3 are not broken: reads are plaintext-tolerant, `findPendingByToken` never depended on the hash, and resubmission checks both the hash candidates and the legacy `(email = input AND email_hash IS NULL)` branch. They simply keep their historical exposure.

**Downgrade:** reverting the code leaves backfilled rows encrypted and unreadable by the older build. Reverting requires a database restore, not just a code revert. The migration itself is reversible (`down()` drops the constraint and column).

## Testing

| Area | Coverage |
|---|---|
| Map declaration and registry passthrough | `packages/onboarding/src/__tests__/encryption.test.ts`, `packages/shared/src/modules/__tests__/registry.test.ts` |
| System-key encryption and tenant-less subscriber delegation | `packages/shared/src/lib/encryption/__tests__/{tenantDataEncryptionService,subscriber}.test.ts` |
| Backfill command | `packages/core/src/modules/entities/__tests__/cli-backfill-system-encryption.test.ts` — encrypt + hash, idempotency, dry-run, keyset paging, missing-DEK warning, fail-closed aborts, unknown entity |
| Invariants 1 and 2 | `packages/core/src/modules/entities/__tests__/cli-system-scope-guards.test.ts` |
| Legacy row → backfill → resubmit / verification | `packages/onboarding/src/__tests__/backfill-legacy-request.test.ts` |
| Ciphertext at rest, hash lookup, onboarding end to end | `packages/onboarding/src/modules/onboarding/__integration__/TC-ONB-001-self-service-consent.spec.ts` |

## Open Questions

1. **Rotation semantics (Phase 3).** Should system-scoped rotation be a separate command, or should `rotate-encryption-key` gain a `--system` mode? A separate command keeps the tenant command's blast radius unchanged; a flag keeps one entry point.
2. **Decryptability.** Is system-scoped data ever meant to be decrypted back to plaintext (mirroring `decrypt-database`), or is "encrypted or deleted" the correct policy for pre-tenant PII?
3. **Persisted scope metadata.** Add `key_scope` to `encryption_maps` so the DB can represent the scope, or keep invariant 1 (never persist system maps) as the single source of truth? Invariant 1 is simpler but relies on every future writer honoring it.

## Changelog

- **2026-08-04** — spec created alongside PR #4160. Phases 1 and 2 implemented; Phase 3 open pending the answers above.
