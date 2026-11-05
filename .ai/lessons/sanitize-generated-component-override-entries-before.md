---
title: "Sanitize generated component override entries before runtime use"
modules: ["shared","cli"]
areas: ["umes","architecture"]
topics: ["component-overrides","generated-files","filters"]
---

# Sanitize generated component override entries before runtime use

**Context**: Enterprise security login overrides caused `/login` SSR failures because the server-side override registry received at least one malformed entry from generated component overrides, and `getComponentOverrides()` assumed every item had `target.componentId`.

**Rule**: Shared runtime registries fed by generated/module-loaded plugin arrays must defensively filter malformed or `undefined` entries both at registration time and before lookup. Never assume SSR imports across client/server module boundaries preserve registry item shape.

**Applies to**: `packages/shared/src/modules/widgets/component-registry.ts` and any similar generated registries that are consumed during Next.js SSR/bootstrap.
