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

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema and rollout

- [ ] 1.1 Add lookup hash columns and migrate the schema
- [ ] 1.2 Reconcile encryption rules and verify persisted writes

### Phase 2: Lookup readers

- [ ] 2.1 Route person and company matching through the scoped indexes
- [ ] 2.2 Verify encrypted inbound matching beyond the fallback bound

### Phase 3: Existing records and validation

- [ ] 3.1 Backfill existing records and document rollout
- [ ] 3.2 Run validation and review the implementation
