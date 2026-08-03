---
title: "Global search has no per-record ACL hook"
modules: ["documents","search"]
areas: ["module-data","integration"]
topics: ["access-control","data-scoping","query-index"]
---

# Global search has no per-record ACL hook

**Context**: Documents are visible per record via explicit shares, not per organization.

**Problem**: OM global search has NO per-record ACL hook — only the `search.view` feature gate — so indexing a share-scoped/private entity via `search.ts` leaks its title and content to any org user holding the module feature.

**Rule**: For per-doc-shared modules, ship the search entity `enabled: false` until a per-record visibility hook exists; let users discover records through the permission-filtered list route instead.

**Applies to**: any entity whose read authorization is finer-grained than tenant/organization scope.
