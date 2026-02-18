# SPEC-030: Decrypt Database CLI Command

## TLDR

**Key Points:**
- Add a `decrypt-database` CLI command to the `entities` module that writes all encrypted field values back as plaintext, enabling operators to fully disable tenant data encryption.
- The command is the inverse of `rotate-encryption-key`: it decrypts each encrypted column and writes the raw value back, then optionally deactivates the associated `EncryptionMap` records.

**Scope:**
- New `decrypt-database` command in `packages/core/src/modules/entities/cli.ts`
- Mandatory `--confirm` safety gate (interactive prompt when flag absent)
- `--dry-run` mode that reports what would change without touching the database
- Optional `--deactivate-maps` flag to mark `EncryptionMap` records as inactive after decryption
- Hash-field clearing: lookup hash columns (e.g. `email_hash`) are nulled out after decryption since they are meaningless in plaintext mode
- Scoping: `--tenant` required; optional `--org` / `--entity` to narrow scope

**Concerns:**
- Operation is irreversible without a backup; spec mandates a backup warning and `--confirm` gate
- Operator must also set `TENANT_DATA_ENCRYPTION=false` in environment after running the command, otherwise future writes will re-encrypt fields

---

## Overview

Open Mercato encrypts sensitive entity fields at rest using AES-GCM via `TenantDataEncryptionService`. The encryption lifecycle is:

1. **Enable**: seed `EncryptionMap` records (`mercato entities seed-encryption --tenant <uuid>`)
2. **Rotate keys**: re-encrypt under a new DEK (`mercato entities rotate-encryption-key --tenant <uuid> --old-key <secret>`)
3. **Disable** *(this spec)*: decrypt all fields to plaintext and optionally deactivate maps (`mercato entities decrypt-database --tenant <uuid> --confirm`)

Operators who decide to disable encryption (e.g. when moving to an external vault or changing compliance posture) currently have no supported path to drain encrypted data back to plaintext. They must patch rows manually or write one-off scripts, which is error-prone and untested.

> **Market Reference**: HashiCorp Vault's CLI exposes a `vault transit/decrypt` bulk endpoint; `pg_crypto` has pgp_sym_decrypt; Ansible Vault has `ansible-vault decrypt`. All require explicit opt-in, display a warning, and support dry-run. We adopt the same safety patterns — explicit confirmation, dry-run, and clear post-step instructions.

---

## Problem Statement

- There is no supported, tested CLI path to reverse data encryption for a tenant.
- Operators must write ad-hoc scripts that are untested and risk partial decryption on crash.
- Hash lookup fields (`email_hash`) become orphaned and can produce false-positive query matches if encryption is disabled without clearing them.
- After decryption, `EncryptionMap` records remain active, which causes `TenantDataEncryptionService` to attempt (and fail) decryption on every read, producing silent errors.

---

## Proposed Solution

Add a `decrypt-database` command to the existing `entities` module CLI (`packages/core/src/modules/entities/cli.ts`). The command:

1. Loads all active `EncryptionMap` records for the requested scope.
2. Iterates every entity type and every organization scope.
3. For each database row, detects encrypted payload format (`salt:iv:ciphertext:v1`).
4. Decrypts via `decryptWithAesGcm` using the tenant DEK obtained from `createKmsService()`.
5. Writes the plaintext value back using raw SQL (same pattern as `rotate-encryption-key`).
6. Clears hash-field columns (`hashField` entries in `EncryptionMap.fieldsJson`) by setting them to `NULL`.
7. Optionally (via `--deactivate-maps`) sets `EncryptionMap.isActive = false` and `deletedAt = now()` for all processed maps.
8. Prints a final summary and a post-step reminder to set `TENANT_DATA_ENCRYPTION=false`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Reuse `decryptWithAesGcm` + raw SQL (not ORM) | Mirrors `rotate-encryption-key`; avoids ORM subscriber re-encryption side effects |
| Skip rows where value is not an encrypted payload | Idempotency — command is safe to re-run if interrupted |
| Null hash fields rather than re-hash plaintext | Hash fields are PBKDF2 lookup indexes tuned for encrypted-mode queries; leaving stale hashes causes incorrect equality matches |
| Separate `--deactivate-maps` flag (not default) | Operator may want to test decryption before committing to disable; decouples the two concerns |
| Require `--confirm` or interactive prompt | Prevents accidental invocation; mirrors `ansible-vault decrypt` UX |
| Do not toggle `TENANT_DATA_ENCRYPTION` env var | Env var lives in infrastructure config (`.env`, Kubernetes secret); CLI cannot reliably change it across all replicas |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Auto-disable the env toggle from CLI | CLI runs in one process; other replicas still have the old env; dangerous race condition |
| ORM-based write-back | ORM subscribers (`EncryptionSubscriber`) re-encrypt the value on flush; breaks the decryption goal |
| Export plaintext to file then reimport | Two-step fragile; requires operator to manage intermediate plaintext files |

---

## User Stories

- **DevOps engineer** wants to decrypt all tenant data so that they can migrate to a different encryption provider without data loss.
- **Platform admin** wants to disable tenant data encryption for a specific tenant during a compliance audit so that data is readable by the auditor's tooling.
- **Developer** wants to run `--dry-run` first so that they can verify which rows and fields will be affected before committing.

---

## Architecture

```
mercato entities decrypt-database
  --tenant <uuid>         Required: target tenant ID
  [--org <uuid>]          Optional: limit to one organization
  [--entity <id>]         Optional: limit to one entity type (e.g. customers:customer_entity)
  [--dry-run]             Preview only — no writes
  [--deactivate-maps]     Mark EncryptionMap records as inactive after decryption
  [--confirm]             Skip interactive confirmation prompt
  [--debug]               Verbose output (DEK fingerprint, row counts)
```

### Data Flow

```
CLI invocation
  └─ parseArgs()
  └─ safety gate: require --confirm or interactive prompt
  └─ createRequestContainer() → em, conn
  └─ createKmsService() → KmsService
  └─ em.find(EncryptionMap, { tenantId, isActive: true, deletedAt: null })
       for each map:
         resolveScopes(tenantId, organizationId)
           for each scope:
             SELECT rows WHERE tenant_id = ? AND organization_id IS NOT DISTINCT FROM ?
               for each row:
                 for each field:
                   isEncryptedPayload(value) → skip if false (already plaintext)
                   decryptWithAesGcm(value, dek.key) → plaintext
                   accumulate UPDATE SET col = plaintext
                 for each hashField:
                   accumulate UPDATE SET hash_col = NULL
               if not dry-run: execute UPDATE
  └─ if --deactivate-maps and not dry-run:
       UPDATE encryption_maps SET is_active = false, deleted_at = now() WHERE ...
  └─ print summary + post-step instructions
```

---

## Data Models

### EncryptionMap (existing, no changes to schema)

- `id`: UUID
- `tenant_id`: string
- `organization_id`: string | null
- `entity_id`: string
- `fields_json`: `Array<{ field: string; hashField?: string | null }>`
- `is_active`: boolean
- `deleted_at`: timestamptz | null

The `--deactivate-maps` path soft-deletes maps by setting `is_active = false` and `deleted_at = now()`.

---

## API Contracts

This is a CLI-only command. No HTTP API surface is added.

---

## Internationalization (i18n)

No user-facing UI strings. CLI output is English-only (consistent with existing CLI commands).

---

## Configuration

| Environment variable | Effect |
|---------------------|--------|
| `TENANT_DATA_ENCRYPTION` | Must be set to `false` by operator **after** running this command; the CLI will print a reminder |
| `KMS_*` (existing) | Used to retrieve DEK for decryption; must be set during command execution |

---

## Migration & Compatibility

- No database schema migration required.
- `EncryptionMap` soft-delete via `--deactivate-maps` uses existing `deleted_at` / `is_active` columns.
- Command is additive — no existing commands are modified.
- If `TENANT_DATA_ENCRYPTION` remains `true` after decryption, `TenantDataEncryptionService` will attempt to decrypt plaintext values (which are not in the `salt:iv:ciphertext:v1` format) and will pass them through unchanged (service skips non-matching payloads). This is safe but wasteful; the post-step reminder addresses it.

---

## Implementation Plan

### Phase 1: Core decrypt-database command

**Goal**: Working command that decrypts all encrypted fields for a tenant and reports results.

1. **Add `decryptDatabase` command skeleton** to `packages/core/src/modules/entities/cli.ts`
   - `parseArgs` (already present — reuse)
   - Safety gate: if `--confirm` absent, use `readline` to prompt "Type YES to continue:"
   - Validate: `--tenant` required; `TENANT_DATA_ENCRYPTION` must be enabled (KMS must be reachable to decrypt)
   - Obtain `em`, `conn` via `createRequestContainer()`
   - Obtain KMS via `createKmsService()`

2. **Load EncryptionMap records** for scope (`tenantId`, optional `organizationId`, optional `entityId` filter)

3. **Implement `processDecryptScope`** (mirrors `processScope` in `rotateEncryptionKey`):
   - SELECT rows via raw SQL
   - For each row, check each field with `isEncryptedPayload()`
   - Decrypt with `decryptWithAesGcm(value, dek.key)` — obtain DEK from `createKmsService().getTenantDek(tenantId)`
   - Parse decrypted string: attempt `JSON.parse`, fall back to raw string (same as rotate)
   - Collect column updates: plaintext for encrypted fields, `NULL` for hash fields
   - Execute UPDATE via raw SQL (skip in `--dry-run`)

4. **DEK cache** — reuse `Map<string, TenantDek | null>` pattern from rotate to avoid redundant KMS calls

5. **Summary output**: rows inspected, rows updated (or would update in dry-run), entities processed, hash fields cleared

6. **Post-step reminder** printed after completion:
   ```
   ✅ Decryption complete. Next steps:
      1. Set TENANT_DATA_ENCRYPTION=false in your environment / secrets
      2. Restart all application replicas
      3. Run: mercato entities decrypt-database --tenant <uuid> --dry-run to confirm no encrypted values remain
   ```

### Phase 2: EncryptionMap deactivation

**Goal**: `--deactivate-maps` flag cleanly disables encryption for future writes.

1. After all scopes processed (and not `--dry-run`), soft-delete processed `EncryptionMap` records:
   ```sql
   UPDATE encryption_maps
   SET is_active = false, deleted_at = now()
   WHERE tenant_id = ? AND deleted_at IS NULL
   [AND entity_id = ? -- if --entity flag provided]
   ```

2. In `--dry-run` mode, report which maps would be deactivated.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/entities/cli.ts` | Modify | Add `decryptDatabase` command; add to default export |

### Testing Strategy

- **Integration test** (`packages/core/src/modules/entities/__tests__/cli-decrypt-database.test.ts`):
  - Seed a tenant with encrypted fields (use `DerivedKeyKmsService` with a known test secret)
  - Run `decryptDatabase` command handler with `--dry-run`; assert no rows changed, summary correct
  - Run without `--dry-run`; assert rows are plaintext in the DB
  - Assert hash fields set to `NULL`
  - Run again; assert idempotency (no updates on second run)
  - With `--deactivate-maps`: assert `EncryptionMap` records soft-deleted
  - With `--entity` filter: assert only targeted entity type processed

---

## Risks & Impact Review

### Data Integrity Failures

- **Interrupted run**: If the process crashes mid-batch, some rows remain encrypted and others are plaintext. The next run safely skips already-plaintext rows (`isEncryptedPayload` returns false) — idempotent by design.
- **JSON field corruption**: Decrypted value is parsed as JSON before writing. If parsing fails, the raw string is written (same fallback as `rotate-encryption-key`). This mirrors production behavior.
- **Hash field orphaning**: Hash fields are set to `NULL` explicitly. If the operator later re-enables encryption, `seed-encryption` + `rotate-encryption-key` will regenerate hashes.

#### Irreversible Plaintext Write
- **Scenario**: Operator runs command without a database backup; plaintext data written; cannot revert to ciphertext.
- **Severity**: Critical
- **Affected area**: All entities with `EncryptionMap` records for the tenant
- **Mitigation**: Mandatory confirmation gate (`--confirm` or interactive YES prompt); documentation requires backup first; `--dry-run` to preview
- **Residual risk**: Operator ignores warning — acceptable since the safety gate is explicit

#### Stale Hash Fields Causing False Query Matches
- **Scenario**: Hash fields left non-null after decryption; equality queries using hash index match wrong records.
- **Severity**: High
- **Affected area**: `auth:user` email lookup; any entity using `hashField` in `EncryptionMap`
- **Mitigation**: Command unconditionally NULLs all `hashField` columns during decryption
- **Residual risk**: None — cleared as part of normal operation

### Cascading Failures & Side Effects

- **Re-encryption by ORM subscribers**: Writing back via raw SQL bypasses ORM subscribers (same approach as `rotate-encryption-key`). Subscribers are not triggered.
- **Query index**: The `query_index` module stores encrypted `doc` columns. This command does **not** touch the query index. Operators should run `mercato query_index reindex` after decryption to rebuild plaintext index docs. This is a known limitation — documented in post-step instructions.
- **Vector search**: `vector:vector_search` entity has encrypted result fields; covered by `EncryptionMap` so it will be decrypted if maps exist for it.

#### Query Index Not Updated
- **Scenario**: After decryption, query index still holds encrypted doc payloads.
- **Severity**: Medium
- **Affected area**: Search, filtering, and query-index-backed reads
- **Mitigation**: Post-step instructions include `mercato query_index reindex --tenant <uuid>`
- **Residual risk**: Until reindex runs, search results may be degraded — acceptable as a post-step action

### Tenant & Data Isolation Risks

- `--tenant` is required; all SQL queries are `WHERE tenant_id = ?`. Cross-tenant leakage is structurally impossible.
- The `resolveScopes` function (copied from `rotate-encryption-key`) enumerates organizations within the tenant, maintaining correct isolation boundaries.

### Migration & Deployment Risks

- No schema migration. Command is additive.
- `TENANT_DATA_ENCRYPTION` env var must be changed by the operator after decryption; the CLI cannot do this atomically across replicas. Post-step instructions cover this explicitly.
- If the env var is not changed, new writes will be encrypted again — a known operational gap documented in post-step output.

### Operational Risks

#### DEK Unavailable During Decryption
- **Scenario**: KMS service is unreachable; `getTenantDek` returns `null`; decryption fails for all rows.
- **Severity**: High
- **Affected area**: All entities for the tenant
- **Mitigation**: Command aborts early if KMS is unhealthy (`encryptionService.isEnabled()` check) with a clear error message
- **Residual risk**: None — operation cleanly fails before touching data

---

## Final Compliance Report — 2026-02-18

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/cli/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Uses raw SQL + FK IDs only |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | All SELECT/UPDATE scoped by `tenant_id` and `organization_id IS NOT DISTINCT FROM ?` |
| root AGENTS.md | Use `findWithDecryption` instead of `em.find` | N/A | CLI uses raw SQL to bypass ORM subscribers intentionally |
| root AGENTS.md | Validate all inputs with zod | N/A | CLI args parsed by `parseArgs()`; tenant UUID validated by presence check; no user-facing HTTP request |
| root AGENTS.md | Never hand-write migrations | Compliant | No migration needed |
| packages/core/AGENTS.md | Respect encryption feature flag | Compliant | Command checks `isTenantDataEncryptionEnabled()` and aborts if disabled |
| packages/core/AGENTS.md | Do not hand-roll AES/KMS calls | Compliant | Uses `decryptWithAesGcm` + `createKmsService()` from shared lib |
| packages/core/AGENTS.md | CLI files export default `ModuleCli[]` | Compliant | New command added to existing default export array |
| packages/cli/AGENTS.md | CLI commands auto-discovered from `cli.ts` | Compliant | Added to `packages/core/src/modules/entities/cli.ts` |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match implementation | Pass | Uses existing `EncryptionMap` entity; no new schema |
| Risks cover all write operations | Pass | Row update and map deactivation both documented |
| Idempotency guaranteed | Pass | `isEncryptedPayload` guard skips already-plaintext rows |
| Post-step instructions address env var gap | Pass | Printed after completion |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved, ready for implementation.

---

## Changelog

### 2026-02-18
- Initial specification
