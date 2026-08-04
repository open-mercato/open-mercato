---
title: "Documents expose the wrong data: search index and principal labels"
modules: ["documents","search","auth"]
areas: ["module-data","backend-ui"]
topics: ["access-control","data-scoping","encryption"]
---

# Documents expose the wrong data: search index and principal labels

## Global search has no per-record ACL hook

**Context**: Documents are visible per record via explicit shares, not per organization.

**Problem**: OM global search has NO per-record ACL hook — only the `search.view` feature gate — so indexing a share-scoped/private entity via `search.ts` leaks its title and content to any org user holding the module feature.

**Rule**: For per-doc-shared modules, ship the search entity `enabled: false` until a per-record visibility hook exists; let users discover records through the permission-filtered list route instead.

**Applies to**: any entity whose read authorization is finer-grained than tenant/organization scope.

## Resolve principal names server-side, never raw UUIDs

**Context**: The share dialog rendered GUIDs because `GET /api/documents/[id]/shares` stores only `principalId`.

**Rule**: Resolve names server-side in the GET route (it already imports `User`/`Role` from auth): batch `findWithDecryption(em, User, { id: { $in }, tenantId, $or: [{ organizationId: null }, { organizationId }] })` — email is encrypted, so it must be decrypted — plus `em.find(Role, { id: { $in }, tenantId })`, and return `principalLabel`/`principalSecondary` (the client `normalizeShare` already prefers `principalLabel`). Never surface a bare UUID as a person's identity in UI.

**Applies to**: any picker or list that renders principals. For long values, wrap flex children in `min-w-0 flex-1` with `truncate` and `shrink-0` the trailing controls — an `Input` next to a clear button overflows its grid cell without a `min-w-0 flex-1` wrapper.
