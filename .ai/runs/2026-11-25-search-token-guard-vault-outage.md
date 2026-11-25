# Execution plan — search-token ciphertext guard misses a Vault outage

Engine: om-auto-create-pr (steps: 5, --loop: no)

## Goal

Make the search-token ciphertext guard turn on during a real Vault outage, so a reindex that
cannot decrypt a record never replaces its good `search_tokens` rows with hashes of ciphertext.

## Problem

`packages/core/src/modules/query_index/lib/search-tokens.ts` decides whether to run the guard with
`resolveEncryptionMode(guardKmsService)`, where `guardKmsService` is a private KMS built once per
process. That instance never fetches a key, so its Vault circuit breaker never trips. It reports
`active` during an outage and turns `unavailable` only when Vault config is missing.

Meanwhile the decrypt step that runs just before tokenizing uses a different
`TenantDataEncryptionService` (`resolveTenantEncryptionService(em)`). When Vault is down and the DEK
cache is cold, `decryptEntityPayload` gets no DEK and returns the payload unchanged
(`tenantDataEncryptionService.ts:662-666`), so ciphertext reaches the tokenizer with the guard off.
`replaceSearchTokensForRecord` / `replaceSearchTokensForBatch` then delete the record's good tokens
and insert hashes nothing matches. No warning is logged, so nobody knows to reindex.

## Scope

- `query_index/lib/search-tokens.ts` — export a helper that derives the guard from the encryption
  service that did the decrypt (`!service.isEnabled()`), falling back to the existing private-KMS
  check when no service is available; let `replaceSearchTokensForBatch` honor a per-payload
  `guardCiphertext` override (the per-record path already does).
- `query_index/lib/indexer.ts` — `reindexSearchTokensForRecord` passes the guard derived from the
  service it decrypted with, read after the decrypt so it reflects that call's Vault probe.
- `query_index/lib/batch.ts` — optional `ciphertextGuard` callback on `IndexBatchOptions`, evaluated
  after the batch's decrypts and forwarded to the token writer.
- `query_index/lib/reindexer.ts`, `query_index/cli.ts` — pass `ciphertextGuard` from the service
  they already hand to `decryptDoc`.
- Unit tests for the helper, both writer paths and the batch option.

Why `isEnabled()`: it is `TENANT_DATA_ENCRYPTION && kms.isHealthy()` on the same instance whose
`getDek` just called Vault, and `decryptIndexDocForSearch` already skips entity decryption when it
returns `false`. Guard and decrypt therefore read one signal: decrypt skipped or failed → guard on.

## Non-goals

- `packages/search/src/strategies/token.strategy.ts` keeps the private-KMS fallback: it receives only
  a Kysely handle and pre-built fields. Wiring it to DI is a separate change.
- Derived-key fallback (`TENANT_DATA_ENCRYPTION_FALLBACK_KEY` with Vault configured):
  `FallbackKmsService.isHealthy()` stays true during an outage and hands out a key that cannot open
  Vault-encrypted data. Telling that ciphertext apart from a user-typed envelope needs the
  forgeable shape test removed in #2720, so this gap stays and is documented.
- A tenant whose DEK is missing from a healthy Vault (404 keeps the breaker closed). Pre-existing
  and rare; not addressed.
- No change to `shared` encryption contracts, DI names or public signatures (additive only).

## Implementation Plan

### Phase 1: Guard reads the decrypting service's health

1. Add `resolveCiphertextGuard(service)` to `search-tokens.ts`; honor per-payload `guardCiphertext`
   in `replaceSearchTokensForBatch`.
2. Wire `reindexSearchTokensForRecord` in `indexer.ts` to pass the derived guard.
3. Add `ciphertextGuard` to `IndexBatchOptions` and pass it from `reindexer.ts` and `cli.ts`.

### Phase 2: Tests

1. Unit tests in `search-tokens-ciphertext-guard.test.ts`: an unhealthy service turns the guard on and
   both writer paths preserve existing tokens; a healthy service keeps it off; no service falls back.
2. Unit test that `upsertIndexBatch` forwards `ciphertextGuard` to the token writer.

## Risks

- The guard now runs (shape check) on any write where the decrypting service is unhealthy. That is
  the documented `unavailable` behavior; a user-typed envelope-shaped value is skipped only while
  Vault is unreachable, then re-indexed on the next write.
- Additive optional fields on internal option types only; no contract surface changes.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Guard reads the decrypting service's health

- [x] 1.1 Add resolveCiphertextGuard and per-payload batch override — 97e0377549
- [x] 1.2 Wire reindexSearchTokensForRecord to the decrypting service — 73c8c97a89
- [x] 1.3 Add ciphertextGuard batch option and wire reindexer and CLI — 49460c3530

### Phase 2: Tests

- [x] 2.1 Guard helper and writer-path unit tests — c834b33f2b
- [x] 2.2 Batch option forwarding unit test — 8e591515f1
