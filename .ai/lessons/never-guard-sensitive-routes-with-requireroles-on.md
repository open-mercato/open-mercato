---
title: "Never guard sensitive routes with `requireRoles` on mutable role names"
modules: ["auth"]
areas: ["architecture"]
topics: ["access-control","data-scoping"]
---

# Never guard sensitive routes with `requireRoles` on mutable role names

**Context**: Feature toggles routes were guarded with `requireRoles: ['superadmin']`. Since role names are user-editable, a tenant admin with `auth.roles.manage` could create a role named "superadmin" and escalate privileges — even though reserved-name validation blocked the exact attack, the architecture remained fragile.

**Problem**: `requireRoles` checks mutable string names against the auth context. If the reserved name list has a gap or a new privileged name is introduced, the same privilege escalation pattern reappears.

**Rule**: Always use `requireFeatures` with immutable feature IDs (declared in `acl.ts`) instead of `requireRoles` for access control. Reserve `requireRoles` only for truly exceptional, well-documented cases. When adding a new module, declare granular features in `acl.ts` and wire `defaultRoleFeatures` in `setup.ts` — never ship an empty `acl.ts` with `requireRoles` guards.

**Applies to**: All API routes, backend page metadata (`page.meta.ts`), and any runtime access control check.
