---
title: "Hydrated backend chrome payloads must receive the original request for scope-aware RBAC"
modules: ["ui","auth","events"]
areas: ["backend-ui"]
topics: ["access-control","data-scoping","events"]
---

# Hydrated backend chrome payloads must receive the original request for scope-aware RBAC

**Context**: The backend sidebar/header payload moved from server layout assembly to `/api/auth/admin/nav` + client hydration, while org/tenant scope still depends on request cookies and headers.

**Problem**: If the original request is not forwarded into payload resolution, selected org/tenant scope falls back to account defaults, which can empty `grantedFeatures` for the active scope and remove every `requireFeatures` sidebar route.

**Rule**: Any server helper that resolves scoped backend chrome, navigation, or ACL-derived payloads must receive the original `Request` whenever scope can depend on cookies, forwarded headers, or query params.

**Applies to**: Backend chrome payload builders, scoped sidebar/header APIs, organization-aware RBAC helpers, and any refactor that moves scope-sensitive work behind an API boundary.
