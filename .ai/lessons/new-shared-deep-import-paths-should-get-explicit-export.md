---
title: "New shared deep import paths should get explicit export-map entries"
modules: ["shared"]
areas: ["integration","testing","debugging"]
topics: ["events","package-runtime","testing"]
---

# New shared deep import paths should get explicit export-map entries

**Context**: A new shared utility under `@open-mercato/shared/lib/events/patterns` built correctly, but sibling workspace tests failed to resolve it through the package name.

**Problem**: Generic wildcard export rules are not always enough for every tool in the workspace, especially test runners resolving package subpaths across linked workspaces. That turns a valid refactor into a package-resolution failure.

**Rule**: When adding a new shared utility intended for cross-package imports, add an explicit `package.json` export entry for the new subpath instead of relying only on broad wildcard export patterns.

**Applies to**: `packages/shared/package.json` and future cross-package utilities added under new `@open-mercato/shared/lib/*` paths.
