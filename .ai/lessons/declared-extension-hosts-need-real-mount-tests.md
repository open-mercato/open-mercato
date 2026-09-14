---
title: "Declared extension hosts need real mount tests"
area: [umes, backend-ui, debugging]
module: [ui, core, catalog, customers]
topic: [component-overrides, api-interceptors, optional-modules, testing]
---

# Declared extension hosts need real mount tests

**Context**: A DataTable component override and a catalog API interceptor were discovered and registered correctly, but their concrete render/route call sites never consumed the registries. Separately, a customer list treated an optional staff module as its only user-name resolver.

**Problem**: Registry-only tests passed while the extension produced no visible behavior. An optional dependency failure then collapsed known auth-user identifiers into an “unknown” label.

**Rule**: Every published extension host needs a regression test that registers an extension and exercises the real rendered component or exported route handler. Optional-module integrations must retain a host-owned fallback for data that the host already stores, and failures must remain fail-soft without erasing resolvable identity.

**Applies to**: Component overrides, handwritten API routes that publish interceptor targets, and list/detail UI that enriches host records through optional modules.
