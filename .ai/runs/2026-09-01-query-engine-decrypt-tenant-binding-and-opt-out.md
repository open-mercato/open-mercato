# Execution plan — query-engine decrypt tenant binding and opt-out

**Source doc:** `.ai/specs/2026-09-01-query-engine-decrypt-tenant-binding-and-opt-out.md`
**Issue:** #5430 · **Spec PR:** #5820
**Engine:** om-auto-create-pr (steps: 10, --loop: no)
**Branch:** `fix/query-engine-decrypt-tenant-binding-and-opt-out`

## Goal

Make query-engine field decryption fail closed: bind the DEK to the tenant the caller asserted instead of the tenant stored on the row, and add an additive `QueryOptions.decryptEncryptedFields` so a query can decline plaintext it never asked for.

## Scope

- `packages/shared/src/lib/encryption/decryptScope.ts` — new pure helper (`resolveDecryptScope`, `resolveDecryptEnabled`).
- `packages/shared/src/lib/query/engine.ts` — `BasicQueryEngine.decryptRow`.
- `packages/core/src/modules/query_index/lib/engine.ts` — `HybridQueryEngine.decryptRow`, including the `cf:` custom-field branch.
- `packages/shared/src/lib/encryption/subscriber.ts` — `EncryptionSubscriber.decrypt` scope resolution.
- `packages/shared/src/lib/query/types.ts`, `packages/shared/src/lib/crud/factory.ts` — the additive option and its pass-through.
- `apps/docs/docs/user-guide/encryption.mdx`, `apps/docs/docs/architecture/data-encryption.mdx` — the at-rest-not-ACL contract.
- Tests in the existing suites plus new helper/subscriber suites and one integration spec.

## Non-goals

- `packages/core/src/modules/entities/api/records.ts` field projection (spec suggestion 2) — deferred to its own spec.
- `ModuleEncryptionMap.requiredFeatures` (spec suggestion 3) — deferred to its own spec.
- The search read path (`packages/search/src/lib/presenter-enricher.ts`) — already binds to the caller's tenant; no change.
- Index-write callers of `decryptIndexDocForSearch` (indexer, reindexer, CLI) — the row's tenant is authoritative there.
- In-app locale strings, including `entities.encryption.description`.

## Risks

- The guard sits on every decrypting read path, so a **pre-existing** scoping bug elsewhere would start returning ciphertext and could be reported as a regression. Intended; mitigated by the aggregated warning and called out in the PR body.
- ~~Phase 3's `omitAutomaticTenantOrgScope` default~~ — **dropped during implementation.** Both engines require `opts.tenantId` on every query (`engine.ts:410`, `query_index/lib/engine.ts:470`), so the Phase 1 guard already refuses foreign-tenant rows on those reads. Flipping the default would only have stripped plaintext from legitimately global rows (`tenant_id IS NULL`) for no security gain. `decryptEncryptedFields` is now a pure opt-in, which removes the spec's only `⚠ NEEDS HUMAN CONFIRMATION` assumption.
- Log volume: bounded to one aggregated warning per query execution rather than one per row.

## Implementation Plan

### Phase 1 — Fail-closed tenant binding in the query engines

1.1 Add `resolveDecryptScope` + types in `packages/shared/src/lib/encryption/decryptScope.ts`, with unit tests.
1.2 Apply it in `BasicQueryEngine` (`packages/shared/src/lib/query/engine.ts`), with engine tests.
1.3 Apply it in `HybridQueryEngine` (`packages/core/src/modules/query_index/lib/engine.ts`), covering the `cf:` branch, with engine tests.
1.4 Emit one aggregated `warn` per query when rows are refused, with tests in both engine suites.

### Phase 2 — Extend the guard to the ORM read path

2.1 Guard `EncryptionSubscriber.decrypt` (`packages/shared/src/lib/encryption/subscriber.ts`), with a new subscriber test suite.

### Phase 3 — `decryptEncryptedFields` opt-out

3.1 Add the option to `QueryOptions` and `resolveDecryptEnabled` to the helper, with default-matrix tests.
3.2 Honour it in both engines so a declined query performs no DEK lookup, with tests.
3.3 Expose it through `makeCrudRoute` (`packages/shared/src/lib/crud/factory.ts`), with a factory test.
3.4 Add integration spec `TC-ENC-001` asserting a correctly scoped list of an encrypted entity still returns plaintext.

### Phase 4 — Documentation correction

4.1 State the at-rest-not-read-side-ACL contract and document the new option in both encryption docs.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fail-closed tenant binding in the query engines

- [x] 1.1 Add the decrypt-scope helper and its unit tests — 53746d6b4
- [x] 1.2 Apply the guard in BasicQueryEngine — 53746d6b4
- [x] 1.3 Apply the guard in HybridQueryEngine including custom fields — be0a7f745
- [x] 1.4 Emit one aggregated refusal warning per query — 53746d6b4

### Phase 2: Extend the guard to the ORM read path

- [x] 2.1 Guard EncryptionSubscriber.decrypt — b16024790

### Phase 3: decryptEncryptedFields opt-out

- [x] 3.1 Add the QueryOptions option and the default rule — 4292a46e3
- [x] 3.2 Honour the option in both engines — 4292a46e3
- [x] 3.3 Expose the option through makeCrudRoute — 4292a46e3
- [x] 3.4 Add the TC-ENC-001 integration spec — 4292a46e3

### Phase 4: Documentation correction

- [x] 4.1 Document the at-rest contract and the new option — 37d2110b6
