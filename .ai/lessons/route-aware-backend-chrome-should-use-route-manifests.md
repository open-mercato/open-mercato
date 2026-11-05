---
title: "Route-aware backend chrome should use route manifests, not the full module registry"
modules: ["ui","events"]
areas: ["backend-ui","architecture"]
topics: ["events","generated-files","regeneration"]
---

# Route-aware backend chrome should use route manifests, not the full module registry

**Context**: The app bootstrap has two generated module manifests: the full `modules.generated.ts` and the lighter `modules.app.generated.ts`, while route-aware consumers already have dedicated generated manifests such as `backend-routes.generated.ts`.

**Problem**: Hydrated sidebar work was refactored to call `getModules()` for route data, which forced bootstrap onto the full module manifest and regressed the original fast-path split between app bootstrap and route manifests.

**Rule**: Backend chrome, breadcrumbs, static settings path discovery, and other route-aware consumers should read `backend-routes.generated.ts` or `getBackendRouteManifests()`. Keep `modules.app.generated.ts` in bootstrap unless the caller truly needs the full module registry beyond route manifests.

**Applies to**: `apps/*/src/bootstrap.ts`, backend layouts, hydrated sidebar/header APIs, route matching helpers, and any future performance optimization around generated registries.
