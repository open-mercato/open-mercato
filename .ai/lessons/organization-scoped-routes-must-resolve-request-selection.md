---
title: "Organization-scoped routes must resolve request selection and reject invalid explicit writes"
modules: ["entities","directory","auth","customer_accounts","notifications"]
areas: ["module-data","integration","debugging","testing"]
topics: ["data-scoping","access-control","route-coverage","backward-compatibility","integration-fixtures"]
---

# Organization-scoped routes must resolve request selection and reject invalid explicit writes

**Context**: A custom encryption-map route persisted configuration using `auth.orgId`, while the command it configured used the request-selected organization from `om_selected_org`.

**Problem**: A valid request for a second organization returned success but wrote the configuration into the user's home organization. The following scoped write then failed because its actual organization had no configuration.

**Rule**: Custom organization-scoped routes must call `resolveOrganizationScopeForRequest` and use its validated `tenantId` and `selectedId` for reads, writes, guards, and cache invalidation. A write must reject `selectionRejected` before repository access; `selectedId` may be a safe fallback for reads, but it must never silently redirect an explicitly selected write. Treat token scope as identity context, not as a substitute for request scope.

**Applies to**: custom APIs, configuration records, cache keys, mutation guards, and integration fixtures that exercise organization selection.

**Testing the resolved scope**: Do not assume `om_selected_org=__all__` widens a restricted principal to every granted organization. The existing resolver retains that principal's home selection. Assert that exact behavior, and use an unrestricted principal for the separate all-organization positive control. For a selected-organization regression, compare the switched request with an actor whose home organization is the selected one; retain rejected-selection and empty-scope negative cases.

**Feature-bound scopes**: Feature checks may rebuild a finite scope without retaining `selectionRejected`. A route that must refuse an unavailable explicit selection should also compare a concrete requested organization with the validated selected organization, using the existing all-organization sentinel helper. Keep the bound feature filters; do not bypass them by resolving a broader raw scope.

**Compatibility boundary**: A new method on an existing route must keep the same organization contract as its sibling methods unless a route-wide migration is explicitly approved. The staff invitation GET/POST route uses authenticated `tenantId`/`orgId`; its additive cancellation DELETE, guard, command, event and audit must use that same scope. A selected-organization cookie must not retarget only cancellation while listing and resend still use the authenticated organization. Cover a real differing selection cookie and direct command context overrides; keep generic selected-scope resolution for routes that already expose that contract.

**2026-11-18 HTTP evidence (#9136)**: A direct handler test with a mocked mutation guard can strip an unknown `tenantId` safely, while the real dispatcher refuses the same forged scope with 403 before the handler runs. Prove an ordinary authorized write succeeds first, then submit the forged scope and verify both tenants remain unchanged. Keep a separate allowed-origin save/retry after an external-origin refusal; updating the configuration contract also requires updating older integration fixtures that assumed arbitrary origins were valid. An unsharded CI matrix label of `none` is not evidence that the selected integration suite was skipped; inspect its executed test list.
