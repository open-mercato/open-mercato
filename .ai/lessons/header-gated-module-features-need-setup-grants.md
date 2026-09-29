---
title: "Header-gated module features need setup grants"
modules: ["notifications","search","ui"]
areas: ["backend-ui","module-data","architecture"]
topics: ["access-control","data-scoping","testing"]
---

# Header-gated module features need setup grants

**Context**: The empty starter preset enabled the `notifications` module, but the notification bell stayed hidden because the module declared `notifications.view` in `acl.ts` without a matching `setup.ts` grant for default roles.

**Problem**: Enabling a module is not enough for feature-gated header chrome. `BackendHeaderChrome` and similar runtime surfaces check effective ACL grants, so a missing `defaultRoleFeatures` entry makes enabled module UI look absent after tenant initialization.

**Rule**: Any module with header, sidebar, page, API, or runtime UI gated by `requireFeatures` / `hasFeature` must declare those feature grants in `setup.ts` for the default roles that should see the surface. Add ACL setup tests for visible shell features such as topbar icons.

**Applies to**: Module `acl.ts` / `setup.ts` pairs, starter presets, `BackendHeaderChrome`, notification/message/search/AI shell buttons, and tenant initialization ACL tests.
