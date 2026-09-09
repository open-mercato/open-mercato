---
title: "Feature-gated runtime helpers must use wildcard-aware permission matching"
modules: ["customer_accounts","customers","events"]
areas: ["architecture","backend-ui","module-data"]
topics: ["access-control","command-pattern","events"]
---

# Feature-gated runtime helpers must use wildcard-aware permission matching

**Context**: ACL wildcard grants like `customer_accounts.*` correctly passed server-side checks, but several shared UI/runtime helpers still gated behavior with exact `includes` or `Set.has` checks.

**Problem**: Navigation, notification handlers, mutation guards, and command interceptors could silently disappear or stop running even though the user had a valid wildcard permission from RBAC.

**Rule**: Any feature-gated helper outside the core RBAC service must use the shared wildcard-aware matcher (`hasFeature` / `hasAllFeatures`) instead of ad hoc exact-match checks such as `features.includes(...)`, `set.has(...)`, or `every(...includes(...))`.

**Additional rule**: Do not assume every `granted` feature array is normalized to exact requested ids. Some flows return exact feature-check responses, while others pass through stored wildcard ACLs or resolved feature snapshots. Runtime helpers must treat all granted-feature arrays as wildcard-capable input.

**Applies to**: Navigation builders, injected menu filtering, notification dispatchers, mutation guards, command interceptors, and similar client/server ACL-driven registries.
