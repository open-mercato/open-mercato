---
title: "Sidebar hydration must preserve the exact RBAC inclusion semantics of the server layout"
modules: ["ui"]
areas: ["backend-ui","debugging"]
topics: ["access-control","data-scoping","generated-files"]
---

# Sidebar hydration must preserve the exact RBAC inclusion semantics of the server layout

**Context**: The server-rendered backend layout previously decided sidebar route visibility by calling `rbac.userHasAllFeatures(...)` per route requirement. A hydration refactor replaced that with local matching against `loadAcl().features`.

**Problem**: Even when the raw ACL snapshot looked sparse or scope-normalized differently, the original per-feature RBAC checks could still grant routes. Replacing that logic caused `requireFeatures` sidebar items to disappear after the refactor.

**Rule**: When moving sidebar/header resolution into a shared payload builder or API, keep route inclusion logic behaviorally identical to the previous RBAC gate. Do not replace `userHasAllFeatures(...)` checks with ad hoc filtering against a cached/raw feature array unless equivalence is proven with regression tests.

**Applies to**: Backend chrome payload builders, nav hydration refactors, sidebar route filtering, and any future optimization that tries to replace RBAC service checks with local feature matching.
