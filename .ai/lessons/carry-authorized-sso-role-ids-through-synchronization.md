---
title: "Carry authorized SSO role IDs through synchronization"
modules: ["sso","auth"]
areas: ["module-data","testing"]
topics: ["access-control","concurrency","role-mappings"]
---

# Carry authorized SSO role IDs through synchronization

During #9014 review, checking the config author's authority before role synchronization still left a race. Synchronization resolved role names again and could select a different role renamed concurrently into the same normalized name. A final session check denied login, but the earlier transaction had already committed the elevated role; password authentication could still use it.

Return an immutable role-ID footprint from authorization and carry it into the writer. Reject freshly resolved IDs outside that footprint before expanding locks or persisting grants, and repeat the subset check after refresh. Reject ambiguous normalized names rather than relying on database iteration order. Final session checks remain necessary for later account or config changes, but do not repair an already committed unauthorized role grant.

The regression must introduce a new matching privileged role after authorization and assert no role grant, user-role write, or new lock footprint occurs. See `accountLinkingService.authorization.test.ts`, `ssoAuthorizationService.test.ts`, and the enterprise SSO authority-ceiling spec.
