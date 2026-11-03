---
title: "Hand-written custom routes resolve org scope via `resolveOrganizationScopeForRequest`, not `auth.orgId`"
modules: ["eudr","directory","customers"]
areas: ["architecture","module-data"]
topics: ["data-scoping","access-control"]
---

# Hand-written custom routes resolve org scope via `resolveOrganizationScopeForRequest`, not `auth.orgId`

**Context**: The eudr export route filtered by `auth.orgId` while the dispatcher authorizes against the selected organization; for multi-org users the two disagree (false 404s / wrong-org reads) (2026-07-06 cross-model review blocker).

**Rule**: Custom GET/action routes that query org-scoped entities must resolve `resolveOrganizationScopeForRequest({ container, auth, request })` (directory module) and filter `organizationId: { $in: scope.filterIds }` when `filterIds` is an array (null = unrestricted within tenant), like `customers/api/people/[id]/route.ts`.

**Applies to**: every hand-written route outside `makeCrudRoute` that queries tenant/org-scoped tables.
