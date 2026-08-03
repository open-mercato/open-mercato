---
title: "Resolve principal names server-side, never raw UUIDs"
modules: ["documents","auth"]
areas: ["backend-ui","module-data"]
topics: ["encryption","ui-components","data-scoping"]
---

# Resolve principal names server-side, never raw UUIDs

**Context**: The share dialog rendered GUIDs because `GET /api/documents/[id]/shares` stores only `principalId`.

**Rule**: Resolve names server-side in the GET route (it already imports `User`/`Role` from auth): batch `findWithDecryption(em, User, { id: { $in }, tenantId, $or: [{ organizationId: null }, { organizationId }] })` — email is encrypted, so it must be decrypted — plus `em.find(Role, { id: { $in }, tenantId })`, and return `principalLabel`/`principalSecondary` (the client `normalizeShare` already prefers `principalLabel`). Never surface a bare UUID as a person's identity in UI.

**Applies to**: any picker or list that renders principals. For long values, wrap flex children in `min-w-0 flex-1` with `truncate` and `shrink-0` the trailing controls — an `Input` next to a clear button overflows its grid cell without a `min-w-0 flex-1` wrapper.
