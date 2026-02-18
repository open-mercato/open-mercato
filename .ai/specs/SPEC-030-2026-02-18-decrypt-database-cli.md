# SPEC-030: Decrypt Database CLI Command

## TLDR

**Key Points:**
- Add a `decrypt-database` CLI command to the `entities` module that writes all encrypted field values back as plaintext, enabling operators to fully disable tenant data encryption.
- The command is the inverse of `rotate-encryption-key`: it decrypts each encrypted column and writes the raw value back, then optionally deactivates the associated `EncryptionMap` records.

**Scope:**
- New `decrypt-database` command in `packages/core/src/modules/entities/cli.ts`
- `--confirm <tenantUuid>` required safety gate — no interactive fallback; suitable for CI and runbooks
- `--dry-run` mode that reports what would change without touching the database
- Optional `--deactivate-maps` flag to mark `EncryptionMap` records as inactive after decryption
- Hash-field clearing: lookup hash columns (e.g. `email_hash`) are conditionally nulled after decryption
- Scoping: `--tenant` required; optional `--org` / `--entity` to narrow scope

**New flags:**
- `--batch-size <n>` (default: 500) — rows fetched per transaction batch; keyset-paginated by `id`
- `--sleep-ms <n>` (default: 0) — pause between batches to reduce prod write pressure
- `--confirm <tenantUuid>` — safety gate; operator must pass the exact tenant UUID; no interactive fallback
- `--check` — report env status (`TENANT_DATA_ENCRYPTION`), active map count, and sampling decrypt estimate without touching data

**Concerns:**
- Operation is irreversible without a backup; spec mandates a backup warning and `--confirm <tenantUuid>` gate
- Operator must also set `TENANT_DATA_ENCRYPTION=false` in environment after running the command, otherwise future writes will re-encrypt fields
- **Query index must be reindexed after decryption** — until `mercato query_index reindex --tenant <uuid>` is run (after env flip + restart), search and filter results are degraded (query index docs still hold encrypted payloads)

---

## Overview

Open Mercato encrypts sensitive entity fields at rest using AES-GCM via `TenantDataEncryptionService`. The encryption lifecycle is:

1. **Enable**: seed `EncryptionMap` records (`mercato entities seed-encryption --tenant <uuid>`)
2. **Rotate keys**: re-encrypt under a new DEK (`mercato entities rotate-encryption-key --tenant <uuid> --old-key <secret>`)
3. **Disable** *(this spec)*: decrypt all fields to plaintext and optionally deactivate maps (`mercato entities decrypt-database --tenant <uuid> --confirm <tenantUuid>`)

Operators who decide to disable encryption (e.g. when moving to an external vault or changing compliance posture) currently have no supported path to drain encrypted data back to plaintext. They must patch rows manually or write one-off scripts, which is error-prone and untested.

> **Market Reference**: HashiCorp Vault's CLI exposes a `vault transit/decrypt` bulk endpoint; `pg_crypto` has pgp_sym_decrypt; Ansible Vault has `ansible-vault decrypt`. All require explicit opt-in, display a warning, and support dry-run. We adopt the same safety patterns — explicit confirmation, dry-run, and clear post-step instructions.

---

## Problem Statement

- There is no supported, tested CLI path to reverse data encryption for a tenant.
- Operators must write ad-hoc scripts that are untested and risk partial decryption on crash.
- Hash lookup fields (`email_hash`) become orphaned and can produce false-positive query matches if encryption is disabled without clearing them.
- After decryption, `EncryptionMap` records remain active. `TenantDataEncryptionService` guards every decrypt attempt with an `isEncryptedPayload()` check; when the stored value is already plaintext the check returns false and the value is returned as-is — safe, but the map lookup overhead runs on every read (wasteful). Deactivating the maps removes this overhead and prevents any future confusion about encryption state.

---

## Proposed Solution

Add a `decrypt-database` command to the existing `entities` module CLI (`packages/core/src/modules/entities/cli.ts`). The command:

1. Loads all active `EncryptionMap` records for the requested scope.
2. Iterates every entity type and every organization scope.
3. For each database row, attempts to decrypt each field value using `decryptWithAesGcm`. **NULL values are skipped unconditionally** — `if value == null: skip field` (no update, no warning). For non-null values, AES-GCM authentication-tag verification is the authoritative signal: if decryption succeeds, the value was encrypted; if it fails, the **error code** determines the action.

   `decryptWithAesGcm` MUST throw a typed `TenantDataEncryptionError` (defined as `class TenantDataEncryptionError extends Error { code: TenantDataEncryptionErrorCode }`). The error codes form an exhaustive enum:
   - `AUTH_FAILED` — AES-GCM authentication-tag mismatch: value is plaintext → skip field, no update.
   - `MALFORMED_PAYLOAD` — bad base64/hex encoding or unexpected payload structure → **warn, increment per-scope `malformedPayloadCount`, skip field**. These values may be corrupted ciphertexts rather than plaintext.
   - `KMS_UNAVAILABLE` — KMS service unreachable → rollback current batch and abort run.
   - `WRONG_KEY` — DEK returned by KMS does not decrypt the envelope → rollback current batch and abort run.
   - `DECRYPT_INTERNAL` — any other unexpected internal failure → rollback current batch and abort run.

   **Any non-`TenantDataEncryptionError` exception thrown by `decryptWithAesGcm`** (e.g. a raw `Error`, a string, an unexpected library error) MUST be treated as `DECRYPT_INTERNAL` — rollback current batch and abort run. This prevents silent data loss from unclassified exceptions.

   Only `AUTH_FAILED` is definitively treated as "value is already plaintext". `MALFORMED_PAYLOAD` is counted and surfaced in the summary so the operator is aware that some payloads may be corrupted. All other codes (including unclassified exceptions mapped to `DECRYPT_INTERNAL`) cause the batch to rollback and abort.

4. Decrypts via `decryptWithAesGcm` using the tenant DEK obtained from `createKmsService()`.
5. Writes the plaintext value back using raw SQL (same pattern as `rotate-encryption-key`). JSON.parse is attempted on the decrypted string; if JSON.parse returns a non-string primitive (number, boolean, object, array), the raw string is written instead to avoid type mismatches with text columns.
6. Clears hash-field columns (`hashField` entries in `EncryptionMap.fieldsJson`) by setting them to `NULL` **only if `rowDecrypted = true`**. Hash fields are never nulled on rows where all field values were already plaintext. If a `hashField` column does not exist in the table, the command emits a warning and skips that specific hash column rather than aborting the run. Missing hash field columns are reported in the final summary.
7. Optionally (via `--deactivate-maps`) sets `EncryptionMap.isActive = false` and `deletedAt = now()` for all **processed maps** — defined as every map included in the run's selected map set after applying `--tenant`, `--org`, and `--entity` filters, regardless of whether any rows were actually updated. When `--org` is provided, global maps (`organization_id IS NULL`) are always included in the processed set, because they were part of the selected map set and apply to tenant-wide rows.
8. Prints a final summary and a post-step reminder to set `TENANT_DATA_ENCRYPTION=false`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Reuse `decryptWithAesGcm` + raw SQL (not ORM) | Mirrors `rotate-encryption-key`; avoids ORM subscriber re-encryption side effects |
| Decrypt-then-authenticate instead of regex/format heuristic | AES-GCM authentication-tag failure is the only reliable signal that a value is encrypted. Regex on `salt:iv:ciphertext:v1` format is fragile: plaintext could accidentally match; format versioning could change. Try-decrypt-catch-auth-fail is deterministic and format-version-agnostic. |
| Typed `TenantDataEncryptionError` with exhaustive enum + fallback | `AUTH_FAILED` → treat as plaintext. `MALFORMED_PAYLOAD` → warn + count. `KMS_UNAVAILABLE`, `WRONG_KEY`, `DECRYPT_INTERNAL` → abort batch. Any non-`TenantDataEncryptionError` exception → treat as `DECRYPT_INTERNAL`. Ambiguous catch-all is unsafe. |
| `MALFORMED_PAYLOAD` warns and counts rather than silently skipping | A base64-decode failure could mean a genuinely corrupted ciphertext. Counting and surfacing in the summary ensures the operator can investigate rather than assuming all is clean. |
| NULL field values skipped unconditionally | NULL is not an encrypted value; attempting decrypt on null would produce an unclassified error. Skip silently without warning. |
| Null hash fields **only when `rowDecrypted = true`** | Nulling hash fields on rows already containing plaintext would destroy hash indexes on partially-migrated tenants. Conditional null is safe in all deployment states. |
| Warn + skip missing `hashField` columns | Schema drift is possible on long-lived tenants. Hard fail would abort the run for one missing column; warn + skip preserves progress. |
| `malformedPayloadCount` per-scope + global aggregate | Per-scope counts (logged in `--debug`) help the operator locate problematic tables/columns. Global total + top-N table:column summary surfaced in the final summary. |
| Keyset pagination (`id > lastId ORDER BY id LIMIT n`) | Offset pagination degrades on large tables; keyset is O(log n) and safe across long-running commands. For UUID PKs (standard in Open Mercato), ordering is lexicographic — deterministic, not insertion-ordered. Concurrent inserts during a long run may not be covered by the current pass; the command is idempotent — run it again to catch any missed rows. An index on `(tenant_id, organization_id, id)` is **recommended** for large tables; without it the DB may fall back to a sequential scan per batch (slow but correct). |
| Distinct org scopes from `encryption_maps`, not entity tables | Fast and complete. If a map has no org, it covers global records. |
| Batch transactional updates with single-connection constraint | All UPDATEs in a batch run on the same connection inside the explicit transaction; no interleaving with implicit autocommit queries. Short per-batch transactions + optional sleep reduce prod write amplification. |
| `--confirm <tenantUuid>` with no interactive fallback | Operator must type the exact tenant UUID. Deterministic for CI pipelines and runbooks; prevents copy-paste accidents. |
| Separate `--deactivate-maps` flag (not default) | Operator may want to verify decryption before committing to disable; decouples the two concerns. |
| "Processed map" = map in the selected set, not "map with updated rows" | Deactivation should not depend on whether any rows changed — a tenant already in plaintext still benefits from removing map overhead. |
| Global maps always processed when `--org` is provided | Global maps apply to tenant-wide rows and are part of the selected map set; deactivating only per-org maps while leaving global maps active would leave overhead and potential confusion. |
| `--check` reports both encrypted candidates and malformed payloads | Active map count alone doesn't reveal ciphertexts. Sampling gives "estimated encrypted candidates" + "malformed payloads" — both surfaced so the operator has a complete picture. Labeled as an estimate. |
| JSON.parse result must be string | Encrypted values are always serialized strings. If JSON.parse returns non-string, write the raw string to avoid type mismatch on text columns. |
| Do not toggle `TENANT_DATA_ENCRYPTION` env var | Env var lives in infrastructure config; CLI cannot reliably change it across all replicas. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Auto-disable the env toggle from CLI | CLI runs in one process; other replicas still have the old env; dangerous race condition |
| ORM-based write-back | ORM subscribers (`EncryptionSubscriber`) re-encrypt the value on flush; breaks the decryption goal |
| Export plaintext to file then reimport | Two-step fragile; requires operator to manage intermediate plaintext files |
| Interactive `--confirm` prompt | Non-deterministic in CI; `--confirm <tenantUuid>` is already ergonomic for one-shot operator commands |

---

## User Stories

- **DevOps engineer** wants to decrypt all tenant data so that they can migrate to a different encryption provider without data loss.
- **Platform admin** wants to disable tenant data encryption for a specific tenant during a compliance audit so that data is readable by the auditor's tooling.
- **Developer** wants to run `--dry-run` first so that they can verify which rows and fields will be affected before committing.

---

## Architecture

```
mercato entities decrypt-database
  --tenant <uuid>              Required: target tenant ID
  [--org <uuid>]               Optional: limit to one organization
  [--entity <id>]              Optional: limit to one entity type (e.g. customers:customer_entity)
  [--dry-run]                  Preview only — no writes
  [--check]                    Report env status, active map count, and sampling decrypt/malformed estimate; implies --dry-run
  [--deactivate-maps]          Mark processed EncryptionMap records as inactive after decryption
  [--confirm <tenantUuid>]     Required safety gate: operator must pass the exact tenant UUID; no interactive fallback
  [--batch-size <n>]           Rows fetched per transaction batch; default 500; use keyset pagination on id
  [--sleep-ms <n>]             Milliseconds to pause between batches; default 0; use on prod to reduce write pressure
  [--debug]                    Verbose output (DEK fingerprint, row counts per batch, batch timing, per-scope malformed count)
```

### Data Flow

```
CLI invocation
  └─ parseArgs()
  └─ safety gate: --confirm <tenantUuid> MUST match --tenant <uuid>; abort with error if missing or mismatched
       (no interactive fallback — deterministic for CI/runbooks)
  └─ --dry-run (without --check): full scan flow below, skip all writes, print what would change
  └─ --check (implies --dry-run):
       print TENANT_DATA_ENCRYPTION env value
       print count of active EncryptionMap records for scope
       for each map × scope: SELECT LIMIT 100 rows, attempt in-memory decrypt per field
         skip NULL values silently
         count rows where at least one field → AUTH_SUCCESS (= was encrypted)      → encryptedCandidatesSampled
         count fields that → MALFORMED_PAYLOAD                                     → malformedPayloadCountSampled
       print: "estimated encrypted candidates (sampled): N"
       print: "malformed payloads (sampled): M" (⚠ if M > 0: may indicate corruption)
       print: "not a proof of absence — run full command + rerun --check to confirm"
       exit 0
  └─ createRequestContainer() → em, conn
  └─ createKmsService() → KmsService
  └─ em.find(EncryptionMap, { tenantId, isActive: true, deletedAt: null })
       totalMalformedPayloadCount = 0; malformedByLocation = Map<"table:column", count>
       for each map:
         resolveScopes(tenantId, organizationId):
           - if --org provided: single scope [organizationId]
           - if --org absent: all distinct organization_id values from encryption_maps for tenant
                              + NULL scope (global records) — sourced from maps table, not entity tables
           for each scope:
             lastId = null; processed = 0; scopeMalformedCount = 0
             loop:
               SELECT rows WHERE tenant_id = ? AND organization_id IS NOT DISTINCT FROM ?
                 AND (lastId IS NULL OR id > lastId) ORDER BY id LIMIT batchSize
               if no rows → break
               lastId = last row id
               BEGIN TRANSACTION  ← all UPDATEs on same connection; no autocommit queries interleaved
                 for each row:
                   rowDecrypted = false
                   for each field:
                     if value == null: skip (no update, no warning)
                     try:
                       plaintext = decryptWithAesGcm(value, dek.key)
                       parsed = JSON.parse(plaintext) if result is string; else raw plaintext
                       accumulate UPDATE SET col = parsed
                       rowDecrypted = true
                     catch TenantDataEncryptionError where code == AUTH_FAILED:
                       value is plaintext → skip
                     catch TenantDataEncryptionError where code == MALFORMED_PAYLOAD:
                       scopeMalformedCount++; malformedByLocation["table:col"]++; warn in log; skip field
                     catch TenantDataEncryptionError where code in {KMS_UNAVAILABLE, WRONG_KEY, DECRYPT_INTERNAL}:
                       ROLLBACK; abort batch and run with error
                     catch (non-TenantDataEncryptionError):
                       treat as DECRYPT_INTERNAL → ROLLBACK; abort batch and run with error
                   if rowDecrypted:
                     for each hashField:
                       if column exists: accumulate UPDATE SET hash_col = NULL
                       else: warn + skip; record in summary as "skipped missing column"
                   if not dry-run AND (plaintext fields | hash nulls) exist: execute UPDATE
               COMMIT
               if --debug: log batch duration, scopeMalformedCount; if batch > 30s → recommend smaller --batch-size
               if sleep-ms > 0: sleep(sleep-ms)
             processed += batch count
             totalMalformedPayloadCount += scopeMalformedCount
  └─ if --deactivate-maps and not dry-run:
       -- "processed maps" = all maps in selected set after --tenant/--org/--entity filters
       -- (not conditional on rows being updated; plaintext-already tenants still benefit)
       -- when --org provided: global maps (org IS NULL) are also deactivated — they were in the selected set
       UPDATE encryption_maps SET is_active = false, deleted_at = now()
         WHERE tenant_id = ? AND deleted_at IS NULL
         [AND (organization_id = ? OR organization_id IS NULL) -- if --org provided]
         [AND entity_id = ? -- if --entity provided]
       print ⚠ "Restart all application replicas — in-process map caches may still be active."
       if TENANT_DATA_ENCRYPTION=true: print ⚠ "Env TENANT_DATA_ENCRYPTION is still true — new writes will be re-encrypted."
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
- If `TENANT_DATA_ENCRYPTION` remains `true` after decryption and `EncryptionMap` records remain active, `TenantDataEncryptionService` checks `isEncryptedPayload()` on every read. For plaintext values the check returns `false` and the value is returned as-is — **no decryption is attempted, no errors are produced**. The overhead is wasteful (map lookup per read) but not harmful. Deactivating maps via `--deactivate-maps` removes this overhead. Setting `TENANT_DATA_ENCRYPTION=false` prevents new writes from being encrypted.

---

## Implementation Plan

### Phase 1: Core decrypt-database command + --check mode

**Goal**: Working command that decrypts all encrypted fields for a tenant, reports results, and provides pre/post status via `--check`.

1. **Add `decryptDatabase` command skeleton** to `packages/core/src/modules/entities/cli.ts`
   - `parseArgs` (already present — reuse); add `batchSize` (default 500), `sleepMs` (default 0), `confirm` (string), `check` (boolean)
   - Safety gate: `--confirm <tenantUuid>` MUST equal `--tenant <uuid>`; abort with a clear error if absent or mismatched — no interactive fallback
   - Validate: `--tenant` required; KMS must be reachable to decrypt
   - Obtain `em`, `conn` via `createRequestContainer()`
   - Obtain KMS via `createKmsService()`

2. **`--check` mode** (exit early, no writes):
   - Print `TENANT_DATA_ENCRYPTION` env value
   - Print count of active `EncryptionMap` records for scope
   - For each map × scope: `SELECT LIMIT 100` rows; skip NULL field values silently
   - Count `encryptedCandidatesSampled` (rows with at least one `AUTH_SUCCESS`) and `malformedPayloadCountSampled` (fields throwing `MALFORMED_PAYLOAD`)
   - Print: `"estimated encrypted candidates (sampled): N"` and `"malformed payloads (sampled): M"` (with `⚠` if M > 0)
   - Print: `"not a proof of absence — run full command + rerun --check to confirm"`
   - Exit 0

3. **Load EncryptionMap records** for scope (`tenantId`, optional `organizationId`, optional `entityId` filter)

4. **Implement `processDecryptScope`** (mirrors `processScope` in `rotateEncryptionKey`):
   - Resolve org scopes: if `--org` provided → `[organizationId]`; if absent → all distinct `organization_id` values from `encryption_maps` + `null` — sourced from the maps table, not entity tables
   - Use keyset pagination: `WHERE tenant_id = ? AND organization_id IS NOT DISTINCT FROM ? AND id > $lastId ORDER BY id LIMIT $batchSize`; repeat until no rows returned. An index on `(tenant_id, organization_id, id)` per entity table is **recommended** for large tables (slow but correct without it). Because UUID keyset order is lexicographic (not insertion-ordered), concurrent inserts during a long run may not be covered in the current pass — the command is idempotent; **run it again after the first pass to catch any rows inserted concurrently**.
   - Per batch, open a transaction; **all UPDATEs MUST run on the same connection inside the explicit transaction; no autocommit queries interleaved**:
     - For each field:
       - `value == null` → skip silently (no update, no warning)
       - `AUTH_SUCCESS` → write plaintext (if JSON.parse returns non-string type, write raw string)
       - `AUTH_FAILED` → skip (plaintext)
       - `MALFORMED_PAYLOAD` → warn + increment `scopeMalformedCount` + record `table:column` in `malformedByLocation` + skip
       - `KMS_UNAVAILABLE | WRONG_KEY | DECRYPT_INTERNAL` → ROLLBACK + abort
       - Any non-`TenantDataEncryptionError` exception → treat as `DECRYPT_INTERNAL` → ROLLBACK + abort
     - If `rowDecrypted = true`: collect `NULL` for every `hashField`; if column missing → warn + skip
     - If updates exist and not `--dry-run`: execute raw-SQL `UPDATE`
   - Commit batch; in `--debug`: log batch duration + `scopeMalformedCount`; if > 30 s recommend smaller `--batch-size`; if `--sleep-ms > 0`: sleep

5. **DEK cache** — reuse `Map<string, TenantDek | null>` pattern from rotate to avoid redundant KMS calls

6. **Summary output**:
   - Rows fetched (total from DB per entity/scope)
   - Rows updated (subset that required changes — may be less than fetched)
   - Entities processed
   - Hash fields cleared
   - Hash fields skipped due to missing columns (with column names)
   - `totalMalformedPayloadCount` (global aggregate across all scopes) — if > 0: print `⚠ N field values returned MALFORMED_PAYLOAD and were skipped; these may be corrupted ciphertexts. Investigate before assuming decryption is complete.`
   - In `--debug`: also print top-N `table:column` locations by `malformedPayloadCount` to help locate problematic fields without log excavation

7. **Post-step reminder** printed after completion:
   ```
   ✅ Decryption complete. Required next steps:
      1. Set TENANT_DATA_ENCRYPTION=false in your environment / secrets
      2. Restart all application replicas
      3. Run: mercato query_index reindex --tenant <uuid>  ← run after env flip + restart; search/filter degraded until this completes
      4. Run: mercato entities decrypt-database --tenant <uuid> --check  to confirm no encrypted values remain
      NOTE: if the run was long and concurrent inserts occurred, run again before step 4 — it is idempotent.
   ```

### Phase 2: EncryptionMap deactivation (`--deactivate-maps`)

**Goal**: `--deactivate-maps` flag cleanly deactivates processed maps after decryption.

1. After all scopes processed (and not `--dry-run`), soft-delete **processed maps** (maps in the selected set after filters; not conditioned on rows being updated):
   - If `--org` is provided: deactivate maps for that `organization_id` **and** global maps (`organization_id IS NULL`). Global maps are included because they were part of the selected map set and apply to tenant-wide rows; leaving them active while deactivating per-org maps would produce inconsistent state.
   - If `--org` is absent: deactivate all active maps for the tenant.
   ```sql
   UPDATE encryption_maps
   SET is_active = false, deleted_at = now()
   WHERE tenant_id = ? AND deleted_at IS NULL
     [AND (organization_id = ? OR organization_id IS NULL) -- if --org provided]
     [AND entity_id = ? -- if --entity flag provided]
   ```

2. After deactivation, unconditionally print:
   - `⚠ Restart all application replicas — in-process map caches may still be active.`
   - If `TENANT_DATA_ENCRYPTION=true` in current env: `⚠ Env TENANT_DATA_ENCRYPTION is still true — new writes will be re-encrypted until env is updated and replicas restarted.`

3. In `--dry-run` (without `--check`), report which maps would be deactivated if `--deactivate-maps` is passed.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/entities/cli.ts` | Modify | Add `decryptDatabase` command; add to default export |

### Testing Strategy

- **Integration test** (`packages/core/src/modules/entities/__tests__/cli-decrypt-database.test.ts`):
  - Seed a tenant with encrypted fields (use `DerivedKeyKmsService` with a known test secret)
  - `--confirm` mismatch: assert command aborts with a clear error before touching data
  - `--check` mode: assert env value + map count + sampling estimates printed; no rows changed; output labeled "estimated … (sampled)"
  - `--check` with a `MALFORMED_PAYLOAD` value seeded: assert `malformedPayloadCountSampled > 0` reported with `⚠`
  - Run with `--dry-run`; assert no rows changed, summary correct
  - Run without `--dry-run`; assert rows are plaintext in the DB
  - Assert hash fields set to `NULL` for decrypted rows
  - Seed a row with already-plaintext values (mixed-mode tenant); assert hash fields NOT nulled for that row
  - Seed a row with a NULL field value; assert field skipped silently (no warning, no update for that field)
  - Run again; assert idempotency (zero updates on second run — `AUTH_FAILED` → all fields treated as plaintext)
  - Simulate `MALFORMED_PAYLOAD`: assert field skipped, `totalMalformedPayloadCount` in summary, `⚠` warning printed
  - Simulate non-`TenantDataEncryptionError` exception from `decryptWithAesGcm`: assert treated as `DECRYPT_INTERNAL` → batch rolled back, run aborted
  - Simulate `KMS_UNAVAILABLE`: assert ROLLBACK, run aborts with error, no partial commit
  - Simulate missing `hashField` column: assert warn + skip, column listed in summary
  - With `--deactivate-maps` and `--org` provided: assert that org maps **and** global maps deactivated; maps for other orgs untouched
  - With `--deactivate-maps` and no `--org`: assert all active maps for tenant deactivated; assert restart warning printed
  - With `--deactivate-maps` on an already-plaintext tenant: assert maps are still deactivated (deactivation not conditional on rows updated)
  - With `--entity` filter: assert only targeted entity type processed
  - With `--batch-size 2`: assert keyset pagination processes all rows (more rows than one batch)
  - Org-scope with `--org` absent: assert records with `organization_id = null` are also processed
  - Simulate concurrent insert (row with UUID ordered after `lastId`): assert second run picks up the missed row (idempotency + concurrent-insert coverage)

---

## Risks & Impact Review

### Data Integrity Failures

- **Interrupted run**: If the process crashes mid-batch, the in-progress batch is rolled back atomically, and all prior committed batches are already plaintext. The next run safely skips already-plaintext rows (`AUTH_FAILED` → skip) — idempotent by design.
- **JSON field corruption**: Decrypted value is parsed as JSON before writing. If JSON.parse returns a non-string type, the raw string is written. If parsing fails entirely, the raw string is written (same fallback as `rotate-encryption-key`).
- **NULL column values**: NULL is skipped unconditionally (no update, no warning). Attempting decrypt on null would produce an unclassified exception; skipping is both safe and correct.
- **Hash field orphaning**: Hash fields nulled only when `rowDecrypted = true`. Missing columns warned and skipped.
- **Corrupted ciphertexts (`MALFORMED_PAYLOAD`)**: Values that fail base64/hex decoding are skipped with a warning and counted. Final summary warns if count > 0. In `--debug` mode, the top-N `table:column` locations are printed to help locate problematic fields.
- **Unclassified exceptions**: Any exception that is not a `TenantDataEncryptionError` is treated as `DECRYPT_INTERNAL` — batch is rolled back and the run aborts. This prevents unknown error types from silently bypassing the abort logic.

#### Irreversible Plaintext Write
- **Scenario**: Operator runs command without a database backup; plaintext data written; cannot revert to ciphertext.
- **Severity**: Critical
- **Affected area**: All entities with `EncryptionMap` records for the tenant
- **Mitigation**: `--confirm <tenantUuid>` must exactly match `--tenant <uuid>` — no interactive fallback; documentation requires backup first; `--dry-run` to preview
- **Residual risk**: Operator runs against the correct tenant but has no backup — acceptable since the safety gate explicitly identifies the target

#### Stale Hash Fields Causing False Query Matches
- **Scenario**: Hash fields left non-null after decryption; equality queries using hash index match wrong records.
- **Severity**: High
- **Affected area**: `auth:user` email lookup; any entity using `hashField` in `EncryptionMap`
- **Mitigation**: Command conditionally NULLs `hashField` columns — only when `rowDecrypted = true`. Missing hash columns warned and skipped.
- **Residual risk**: None — hash columns are cleared as part of normal decryption; partially-migrated tenants protected by conditional null logic.

#### Corrupted Ciphertext Silently Left in Place
- **Scenario**: A field value is a malformed/truncated ciphertext; `MALFORMED_PAYLOAD` is thrown; field is skipped; operator may believe decryption was complete.
- **Severity**: Medium
- **Affected area**: Any entity field with storage corruption
- **Mitigation**: `totalMalformedPayloadCount` prominently reported in summary with `⚠`; `--debug` shows top-N `table:column` locations; `--check` sampling after the run also reports `malformedPayloadCountSampled`
- **Residual risk**: Operator ignores the warning — corrupted values remain; manual inspection required

### Cascading Failures & Side Effects

- **Re-encryption by ORM subscribers**: Writing back via raw SQL bypasses ORM subscribers (same approach as `rotate-encryption-key`). Subscribers are not triggered.
- **Query index**: The `query_index` module stores encrypted `doc` columns. This command does **not** touch the query index. Operators must run `mercato query_index reindex` **after** setting `TENANT_DATA_ENCRYPTION=false` and restarting replicas.
- **Vector search**: `vector:vector_search` entity has encrypted result fields; covered by `EncryptionMap` so it will be decrypted if maps exist for it.

#### Query Index Not Updated
- **Scenario**: After decryption, query index still holds encrypted doc payloads.
- **Severity**: Medium
- **Affected area**: Search, filtering, and query-index-backed reads
- **Mitigation**: Post-step instructions include `mercato query_index reindex --tenant <uuid>` as step 3 (after env flip + restart)
- **Residual risk**: Until reindex runs, search results may be degraded — acceptable as a post-step action

### Tenant & Data Isolation Risks

- `--tenant` is required; all SQL queries are `WHERE tenant_id = ?`. Cross-tenant leakage is structurally impossible.
- The `resolveScopes` function enumerates organizations within the tenant, maintaining correct isolation boundaries.

### Migration & Deployment Risks

- No schema migration. Command is additive.
- `TENANT_DATA_ENCRYPTION` env var must be changed by the operator after decryption; post-step instructions cover this.
- If the env var is not changed, new writes will be encrypted again — documented in post-step output.

#### Runtime / Cache Mismatch After Map Deactivation
- **Scenario**: Maps deactivated in DB but running replicas still hold in-process caches; new plaintext writes may be re-encrypted.
- **Severity**: High
- **Affected area**: Any replicas not restarted after `--deactivate-maps`
- **Mitigation**: Command prints `⚠ Restart all application replicas` immediately after deactivation; post-step includes replica restart
- **Residual risk**: Operator delays restart — next decryption run will handle any newly-re-encrypted rows (idempotent)

### Performance Risks

#### Large Table Write Pressure
- **Scenario**: Tenant has millions of rows; unbounded single-transaction decryption causes MVCC bloat and I/O spikes.
- **Severity**: High
- **Affected area**: All database tables with encrypted fields; primary replicas under active write load
- **Mitigation**: Keyset-paginated batches; each batch in its own short transaction on a single connection; `--batch-size` (default 500) and `--sleep-ms` (default 0) configurable; operators should use `--sleep-ms 100` or higher on production. `--debug` logs batch duration; batches > 30 s emit recommendation to reduce `--batch-size`. Rows fetched ≥ rows updated (already-plaintext rows require no write).
- **Residual risk**: Operators may not set `--sleep-ms` — post-step documentation recommends it; default 500 is conservative for most schemas

### Operational Risks

#### DEK Unavailable During Decryption
- **Scenario**: KMS service is unreachable; `KMS_UNAVAILABLE` thrown.
- **Severity**: High
- **Affected area**: All entities for the tenant
- **Mitigation**: Early abort if KMS unhealthy. Mid-run `KMS_UNAVAILABLE` triggers ROLLBACK of current batch before aborting — no partial commit.
- **Residual risk**: None — prior committed batches are safe and will be skipped on next run (idempotent)

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
| root AGENTS.md | Validate all inputs with zod | N/A | CLI args parsed by `parseArgs()`; no user-facing HTTP request |
| root AGENTS.md | Never hand-write migrations | Compliant | No migration needed |
| packages/core/AGENTS.md | Respect encryption feature flag | Compliant | Command checks `isTenantDataEncryptionEnabled()` and aborts if disabled |
| packages/core/AGENTS.md | Do not hand-roll AES/KMS calls | Compliant | Uses `decryptWithAesGcm` + `createKmsService()` from shared lib |
| packages/core/AGENTS.md | CLI files export default `ModuleCli[]` | Compliant | New command added to existing default export array |
| packages/cli/AGENTS.md | CLI commands auto-discovered from `cli.ts` | Compliant | Added to `packages/core/src/modules/entities/cli.ts` |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match implementation | Pass | Uses existing `EncryptionMap` entity; no new schema |
| Risks cover all write operations | Pass | Row update, map deactivation, runtime cache mismatch, and large-table perf all documented |
| Idempotency guaranteed | Pass | `AUTH_FAILED` → skip; ROLLBACK on abort; prior committed batches safe; second run recommended after concurrent inserts |
| Hash-field clearing is conditional | Pass | Nulled only when `rowDecrypted = true` |
| Hash-field missing column handled | Pass | Warn + skip; reported in summary |
| NULL field values handled | Pass | Skip silently; no warning; no update |
| `MALFORMED_PAYLOAD` surfaces to operator | Pass | Counted per-scope; aggregated globally; top-N locations in `--debug`; `⚠` in summary |
| `--check` reports malformed payloads separately | Pass | `malformedPayloadCountSampled` printed with `⚠` if > 0 |
| Non-`TenantDataEncryptionError` exceptions handled | Pass | Treated as `DECRYPT_INTERNAL` → ROLLBACK + abort |
| `--confirm` is non-interactive | Pass | TLDR, body, and Design Decisions consistent |
| Org-scope covers null organization_id | Pass | Sourced from maps table; includes NULL scope |
| Safety gate identifies target by value | Pass | `--confirm <tenantUuid>` must match `--tenant` exactly |
| Batch single-connection constraint documented | Pass | Data flow and Design Decisions both state no autocommit interleaving |
| Summary distinguishes rows fetched vs updated | Pass | Both counters in final output |
| `--deactivate-maps` scope matches processed scope | Pass | SQL WHERE conditioned on `--org` and `--entity` |
| Global maps deactivated when `--org` provided | Pass | `OR organization_id IS NULL` in WHERE; rationale documented |
| "Processed map" defined precisely | Pass | Map in selected set after filters; not conditioned on rows updated |
| `--check` labeled as estimate | Pass | "estimated … (sampled)" + "not a proof of absence" |
| `--check` fully in Phase 1; Phase 2 is maps-only | Pass | Phase structure clean |
| Post-step reindex order correct | Pass | Step 3: after env flip + restart |
| JSON.parse non-string fallback specified | Pass | Design Decisions + pseudocode |
| Index as recommendation not requirement | Pass | "recommended for large tables" |
| Concurrent-insert gap documented | Pass | Design Decisions + post-step NOTE + test case |
| Error classification exhaustive | Pass | `AUTH_FAILED`, `MALFORMED_PAYLOAD`, abort codes, unclassified fallback |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved, ready for implementation.

---

## Changelog

### 2026-02-19 (rev 5)
- **NULL field values**: explicit `if value == null: skip silently` added to algorithm, pseudocode, and test matrix
- **`malformedPayloadCount` scoping**: per-scope counter + global `totalMalformedPayloadCount` aggregate; `--debug` prints per-scope count + top-N `table:column` locations in final summary
- **`--check` reports malformed payloads**: `malformedPayloadCountSampled` reported separately from `encryptedCandidatesSampled`; `⚠` if > 0
- **`TenantDataEncryptionError` contract**: defined as `class TenantDataEncryptionError extends Error { code: TenantDataEncryptionErrorCode }`; any non-`TenantDataEncryptionError` exception treated as `DECRYPT_INTERNAL` → ROLLBACK + abort; added to Design Decisions and pseudocode
- **Global maps deactivation rationale**: added explanatory sentence in Phase 2 and Proposed Solution — global maps are part of the selected set and apply to tenant-wide rows
- **Concurrent-insert gap**: documented in Design Decisions keyset row, post-step NOTE, and new test case (second run picks up concurrently inserted rows)
- Extended test matrix: NULL value skip, `--check` malformed sampling, concurrent-insert idempotency, non-`TenantDataEncryptionError` exception handling

### 2026-02-18 (rev 4)
- **TLDR**: removed "interactive prompt when flag absent" — consistently "no interactive fallback" throughout
- Added "Interactive prompt" to Alternatives Considered
- **`MALFORMED_PAYLOAD` semantics**: warn + count rather than silently treated as plaintext; `⚠` in summary; added "Corrupted Ciphertext Silently Left in Place" risk
- **Rollback constraint**: all UPDATEs in batch on same connection; no autocommit interleaving
- **`--check` output labeled as estimate**: "estimated … (sampled)" + "not a proof of absence"
- **Index changed to recommended**: "recommended for large tables; slow but correct without it"
- **JSON.parse non-string fallback specified**: write raw string if parse returns non-string
- **"Processed map" defined**: map in selected set after filters; deactivation not conditional on rows updated
- **Phase structure**: `--check` in Phase 1; Phase 2 is deactivation only

### 2026-02-18 (rev 3)
- Typed `TenantDataEncryptionError` error codes; fixed idempotency description; missing hashField handling; org scope from maps table; UUID keyset + index recommendation; `--check` sampling; `--deactivate-maps` SQL scoped; Stale Hash Fields risk corrected; post-step reindex order; rows fetched vs updated in summary; `--debug` batch timing

### 2026-02-18 (rev 2)
- Replaced regex heuristic with try-decrypt; conditional hash-field nulling; org scoping + NULL scope; batching + keyset; `--sleep-ms`; strengthened `--confirm`; `--check` mode; `--deactivate-maps` warnings; query-index reindex to TLDR + post-step; added perf and cache-mismatch risks

### 2026-02-18
- Initial specification
