# Customer email and domain blind indexes

Source doc: .ai/specs/2026-09-04-customers-email-domain-blind-index.md

## Goal

Resolve encrypted CRM person emails and company domains by exact match, including older records after rollout and backfill.

## Scope

Add nullable lookup hashes and indexes, reconcile deployed encryption maps, update the scoped readers, and provide an idempotent backfill command. Preserve HTTP contracts, plaintext lookups and the inbound matcher signature.

## Implementation Plan

1. Add the columns, migration and indexed write path. Reconcile existing policies without dropping unrelated field rules. Cover policy reconciliation, hashing and database mapping.
2. Add scoped hash-first matching with decrypted candidate verification, the plaintext path and bounded fallback. Cover encrypted inbound matching beyond the fallback limit.
3. Add and document a paginated, dry-run-capable backfill. Run focused tests, the configured validation gate and a PR review.

## Risks

Rolling deployments require the schema before the new ORM metadata. Reconciliation must preserve existing map customizations and invalidate cached policies. Domain hashes require a keyed digest to avoid exposing the underlying value through a guessable index. Backfill must guard concurrent writes and leave source ciphertext untouched.

## Progress

PR: #10302

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema and rollout

- [x] 1.1 Add lookup hash columns and migrate the schema — 5d652dea6d
- [x] 1.2 Reconcile encryption rules and verify persisted writes — 4439780e93

### Phase 2: Lookup readers

- [x] 2.1 Route person and company matching through the scoped indexes — 02e3c951e4
- [x] 2.2 Verify encrypted inbound matching beyond the fallback bound — 02e3c951e4

### Phase 3: Existing records and validation

- [x] 3.1 Backfill existing records and document rollout — 8b67d39f7c
- [x] 3.2 Run validation and review the implementation — 4439780e93
