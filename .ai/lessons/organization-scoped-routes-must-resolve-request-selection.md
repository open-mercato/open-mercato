---
title: "Organization-scoped routes must resolve request selection and reject invalid explicit writes"
modules: ["entities","directory","auth","customer_accounts"]
areas: ["module-data","integration","debugging"]
topics: ["data-scoping","access-control","route-coverage"]
---

# Organization-scoped routes must resolve request selection and reject invalid explicit writes

**Context**: A custom encryption-map route persisted configuration using `auth.orgId`, while the command it configured used the request-selected organization from `om_selected_org`.

**Problem**: A valid request for a second organization returned success but wrote the configuration into the user's home organization. The following scoped write then failed because its actual organization had no configuration.

**Rule**: Custom organization-scoped routes must call `resolveOrganizationScopeForRequest` and use its validated `tenantId` and `selectedId` for reads, writes, guards, and cache invalidation. A write must reject `selectionRejected` before repository access; `selectedId` may be a safe fallback for reads, but it must never silently redirect an explicitly selected write. Treat token scope as identity context, not as a substitute for request scope.

**Applies to**: custom APIs, configuration records, cache keys, mutation guards, and integration fixtures that exercise organization selection.

**Lifecycle command evidence**: Staff invitation cancellation (#7275) must pass the resolved `organizationScope` and `selectedOrganizationId` into its command. The service call, event, and audit log must all use that effective scope. Re-reading `auth.orgId` in the command would silently redirect a validated request back to the user's home organization. Cover an allowed secondary organization, a rejected explicit selection, and an all-organizations view without a concrete write target.
