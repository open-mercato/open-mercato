---
title: "Empty collection scopes need an explicit semantic predicate"
modules: ["auth"]
areas: ["backend-ui","module-data","testing"]
topics: ["access-control","data-scoping","route-coverage"]
---

# Empty collection scopes need an explicit semantic predicate

**Context**: The user ACL editor sends `organizations: []` when the last organization is unticked. The route used `organizations !== null` to decide both whether a restriction existed and whether an otherwise empty ACL should be rejected.

**Problem**: A non-null check classified `[]` as an active restriction, so the UI's all-dimension clear request returned `400` instead of removing the override. Coercing `[]` to `null` globally would also be wrong because an empty array still carries deny-all organization semantics when another ACL dimension keeps the override row alive.

**Rule**: When nullable collections participate in guard or record-existence decisions, derive a named predicate from the business meaning, such as `organizations !== null && organizations.length > 0`, instead of using nullability as a proxy for content. Preserve the normalized payload passed to persistence, and cover both empty-collection outcomes: the fully empty record clears, while a record retained by another dimension keeps the empty collection's downstream semantics.

**Applies to**: ACL organization scopes, selected-id filters, nullable multiselects, and any route where `null`, `[]`, and a non-empty array have distinct combined-state behavior.
