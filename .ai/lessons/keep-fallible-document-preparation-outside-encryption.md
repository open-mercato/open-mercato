---
title: "Keep fallible document preparation outside encryption guards"
modules: ["query_index","search","entities","shared","cli"]
areas: ["module-data","debugging","testing"]
topics: ["data-integrity","encryption","query-index","filters","concurrency","testing"]
---

# Keep fallible document preparation outside encryption guards

**Context**: Query-index aggregation and encryption shared an empty catch, so a configuration failure could skip encryption and let a plaintext document continue to persistence.

**Rule**: Complete document preparation before entering an encryption-only guard. When encryption throws, log and rethrow or skip the write explicitly; never return the pre-encryption payload. Keep regression coverage at the final persistence boundary so a helper-level fix cannot mask a plaintext write.

**Applies to**: index projections, search/vector payloads, export staging, and every write path that conditionally encrypts a prepared document.

**Document-storage evidence (#7810)**: Custom entity writes must finish encryption before entering the SQL upsert/fallback block. A missing tenant key or foreign-key ciphertext must stop the write rather than reach a fallback with the original document. Test the final serialized JSONB with real AES, including partial updates that retain legacy plaintext and already encrypted values; helper-only ciphertext assertions do not prove persistence is protected.

**Decrypted-query evidence (#8174)**: Moving encrypted predicates into memory must not re-evaluate SQL-applied public predicates against lossy projections. Keep storage metadata on its actual columns, retain typed JSON for deferred array predicates, and strip internal comparison aliases from responses. Real PostgreSQL tests catch projection mistakes that a row-returning query mock cannot.

**Operator-composition evidence (#7996)**: When merging a new query operator with deferred decrypted filtering, audit the in-memory matcher as well as every SQL compiler. Prepared negation values carry the pattern in an object. Exercise direct encrypted fields and mixed encrypted/public OR groups, retaining the same null and array semantics as the SQL path.

## Maintenance persistence boundaries

Encryption-maintenance compare-and-swap updates must select every column whose old value they compare, including non-null lookup hashes, and pin the original tenant and organization in SQL. A mocked row containing fields that the real SELECT omits hides this failure; prove the persistence boundary against PostgreSQL.

A protected final verification sweep must remain bounded. Scan by primary-key keyset pages under the same protection as policy retirement, inspect every page, and test residual ciphertext beyond the first page with a tiny batch size. Table locks do not make materializing a tenant's entire table safe.

When adding an explicit CLI safety acknowledgment, update existing security fixtures so they still reach their original guard instead of failing at argument parsing. Run repository-wide invariant checks as well as focused feature tests; deterministic lock ordering must use an explicit sort comparator. Keep compatibility summaries concise and link detailed migration guidance so standalone harness context budgets remain intact.
