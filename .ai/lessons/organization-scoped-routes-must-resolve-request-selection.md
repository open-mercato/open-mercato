---
title: "Organization-scoped routes must resolve request selection and reject invalid explicit writes"
modules: ["entities","directory","auth","customer_accounts"]
areas: ["module-data","integration","debugging"]
topics: ["data-scoping","access-control","route-coverage","backward-compatibility"]
---

# Organization-scoped routes must resolve request selection and reject invalid explicit writes

**Context**: A custom encryption-map route persisted configuration using `auth.orgId`, while the command it configured used the request-selected organization from `om_selected_org`.

**Problem**: A valid request for a second organization returned success but wrote the configuration into the user's home organization. The following scoped write then failed because its actual organization had no configuration.

**Rule**: Custom organization-scoped routes must call `resolveOrganizationScopeForRequest` and use its validated `tenantId` and `selectedId` for reads, writes, guards, and cache invalidation. A write must reject `selectionRejected` before repository access; `selectedId` may be a safe fallback for reads, but it must never silently redirect an explicitly selected write. Treat token scope as identity context, not as a substitute for request scope.

**Applies to**: custom APIs, configuration records, cache keys, mutation guards, and integration fixtures that exercise organization selection.

**Compatibility boundary**: A new method on an existing route must keep the same organization contract as its sibling methods unless a route-wide migration is explicitly approved. The staff invitation GET/POST route uses authenticated `tenantId`/`orgId`; its additive cancellation DELETE, guard, command, event and audit must use that same scope. A selected-organization cookie must not retarget only cancellation while listing and resend still use the authenticated organization. Cover a real differing selection cookie and direct command context overrides; keep generic selected-scope resolution for routes that already expose that contract.
