---
title: "Keep fallible document preparation outside encryption guards"
modules: ["query_index","search"]
areas: ["module-data","debugging"]
topics: ["data-integrity","encryption","query-index"]
---

# Keep fallible document preparation outside encryption guards

**Context**: Query-index aggregation and encryption shared an empty catch, so a configuration failure could skip encryption and let a plaintext document continue to persistence.

**Rule**: Complete document preparation before entering an encryption-only guard. When encryption throws, log and rethrow or skip the write explicitly; never return the pre-encryption payload. Keep regression coverage at the final persistence boundary so a helper-level fix cannot mask a plaintext write.

**Applies to**: index projections, search/vector payloads, export staging, and every write path that conditionally encrypts a prepared document.
