# Dev-mode warning for `$like`/`$ilike` filters on encrypted-at-rest columns

**Issue:** #5051 — "No supported pattern for searching encrypted-at-rest columns — `$ilike` on ciphertext fails silently"
**Related:** #2990 (migrate user-facing `$ilike` searches to query-engine + `search_tokens`) — deliberately NOT duplicated here.

## Scope decision

Issue #5051 proposes three remedies. Only two ship here:

| Proposal | This PR | Why |
|---|---|---|
| `searchWithDecryption(em, Entity, where, { textFilter })` bounded-window helper | ❌ out | A load-then-filter-in-app helper is the wrong long-term answer; `search_tokens` already backs encrypted text search. Adding a second sanctioned pattern would compete with #2990's migration target. |
| Dev-mode warning when a string operator targets an encryption-map property | ✅ in | The silent-failure half of the report. Nothing covers the raw-ORM path today. |
| Prominent note in the encryption docs | ✅ in | The reporter hit this three times in a month; the docs currently bury `LIKE` in a single trailing clause. |

## Existing coverage (verified, not re-built)

`packages/shared/src/lib/query/ciphertext-search-warning.ts` already warns when a text filter falls
back to `ILIKE` against an encrypted column — but only inside the two **query engines**
(`packages/shared/src/lib/query/engine.ts`, `packages/core/src/modules/query_index/lib/engine.ts`).
The naive path from the report — `em.find` / `findWithDecryption` with a hand-written
`{ title: { $ilike: '%q%' } }` — never reaches that code and stays silent. That gap is this PR.

## Anchor point

`packages/shared/src/lib/encryption/find.ts` — `findWithDecryption` / `findOneWithDecryption` /
`findAndCountWithDecryption` are the entry points `packages/shared/AGENTS.md` already mandates over
raw `em.find`, and they receive both the `where` clause and the decryption scope. No query-engine
surgery required.

**Cost gate:** `TenantDataEncryptionService.getEncryptedFieldNames(entityId, tenantId, null)` calls
`fetchAllOrganizationFieldNames`, which issues an **uncached** SQL read against `encryption_maps`.
The query engines only pay that in a rare fallback branch; these helpers would pay it on every
`$ilike` query. The warning is therefore gated to `NODE_ENV !== 'production'` — matching the
"dev-mode warning" the issue asks for, for a concrete reason rather than by convention.

## Progress

- [x] Confirm the gap is real and not already covered (`ciphertext-search-warning` is query-engine only)
- [x] Confirm no open PR already addresses #5051
- [ ] Add the `raw-orm-filter` reason + hint to `ciphertext-search-warning.ts` (additive)
- [ ] Add `packages/shared/src/lib/encryption/likeFilterWarning.ts` — `FilterQuery` scanner + dev gate
- [ ] Wire it into the three `find.ts` helpers
- [ ] Unit tests: operator scanner (nested `$and`/`$or`/`$not`, relation filters), dev gate, warn-once, never-throws
- [ ] Docs: expand `apps/docs/docs/architecture/data-encryption.mdx` → "Querying encrypted columns"
- [ ] `packages/shared/AGENTS.md`: note the raw-ORM warning next to the existing query-engine one
- [ ] Validation gate
- [ ] Open PR, link #2990, apply labels

## Design notes

- **Scanner precision.** `collectLikeFilterFields` descends into `$and`/`$or`/`$not` but treats a
  nested plain-key object (`{ customer: { name: { $ilike } } }`) as a *relation* filter and does not
  attribute `name` to the root entity — the encryption map is per-entity, so a relation field would
  be a false positive.
- **Reuse over reinvention.** Field-name normalization, the encryption-map lookup, the warn-once
  cache and the never-throw contract all come from the existing
  `warnOnCiphertextLikeFallback`; this change only adds a caller and a reason.
