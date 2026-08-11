---
title: "Organization-scoped routes must resolve request selection, not token home scope"
modules: ["entities","directory","auth"]
areas: ["module-data","integration","debugging"]
topics: ["data-scoping","access-control","route-coverage"]
---

# Organization-scoped routes must resolve request selection, not token home scope

**Context**: A custom encryption-map route persisted configuration using `auth.orgId`, while the command it configured used the request-selected organization from `om_selected_org`.

**Problem**: A valid request for a second organization returned success but wrote the configuration into the user's home organization. The following scoped write then failed because its actual organization had no configuration.

**Rule**: Custom organization-scoped routes must call `resolveOrganizationScopeForRequest` and use its validated `tenantId` and `selectedId` for reads, writes, guards, and cache invalidation. Treat token scope as identity context, not as a substitute for request scope.

**Applies to**: custom APIs, configuration records, cache keys, mutation guards, and integration fixtures that exercise organization selection.
