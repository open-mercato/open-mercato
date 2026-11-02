---
title: "Keep fallible document preparation outside encryption guards"
modules: ["query_index","search","entities","cli"]
areas: ["module-data","debugging","testing"]
topics: ["data-integrity","encryption","query-index","concurrency","testing"]
---

# Keep fallible document preparation outside encryption guards

**Context**: Query-index aggregation and encryption shared an empty catch, so a configuration failure could skip encryption and let a plaintext document continue to persistence.

**Rule**: Complete document preparation before entering an encryption-only guard. When encryption throws, log and rethrow or skip the write explicitly; never return the pre-encryption payload. Keep regression coverage at the final persistence boundary so a helper-level fix cannot mask a plaintext write.

**Applies to**: index projections, search/vector payloads, export staging, and every write path that conditionally encrypts a prepared document.


## Maintenance persistence boundaries

Encryption-maintenance compare-and-swap updates must select every column whose old value they compare, including non-null lookup hashes, and pin the original tenant and organization in SQL. A mocked row containing fields that the real SELECT omits hides this failure; prove the persistence boundary against PostgreSQL.

A protected final verification sweep must remain bounded. Scan by primary-key keyset pages under the same protection as policy retirement, inspect every page, and test residual ciphertext beyond the first page with a tiny batch size. Table locks do not make materializing a tenant's entire table safe.
