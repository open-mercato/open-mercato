---
title: "Keep fallible document preparation outside encryption guards"
modules: ["query_index","search","entities","shared"]
areas: ["module-data","debugging"]
topics: ["data-integrity","encryption","query-index","filters"]
---

# Keep fallible document preparation outside encryption guards

**Context**: Query-index aggregation and encryption shared an empty catch, so a configuration failure could skip encryption and let a plaintext document continue to persistence.

**Rule**: Complete document preparation before entering an encryption-only guard. When encryption throws, log and rethrow or skip the write explicitly; never return the pre-encryption payload. Keep regression coverage at the final persistence boundary so a helper-level fix cannot mask a plaintext write.

**Applies to**: index projections, search/vector payloads, export staging, and every write path that conditionally encrypts a prepared document.

**Document-storage evidence (#7810)**: Custom entity writes must finish encryption before entering the SQL upsert/fallback block. A missing tenant key or foreign-key ciphertext must stop the write rather than reach a fallback with the original document. Test the final serialized JSONB with real AES, including partial updates that retain legacy plaintext and already encrypted values; helper-only ciphertext assertions do not prove persistence is protected.

**Decrypted-query evidence (#8174)**: Moving encrypted predicates into memory must not re-evaluate SQL-applied public predicates against lossy projections. Keep storage metadata on its actual columns, retain typed JSON for deferred array predicates, and strip internal comparison aliases from responses. Real PostgreSQL tests catch projection mistakes that a row-returning query mock cannot.

**Operator-composition evidence (#7996)**: When merging a new query operator with deferred decrypted filtering, audit the in-memory matcher as well as every SQL compiler. Prepared negation values carry the pattern in an object. Exercise direct encrypted fields and mixed encrypted/public OR groups, retaining the same null and array semantics as the SQL path.
