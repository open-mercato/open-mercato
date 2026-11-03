---
title: "Keep mirrored dev runtimes aligned with their process registry type"
modules: ["events","create_app"]
areas: ["architecture","debugging"]
topics: ["events","dev-runtime","filters"]
---

# Keep mirrored dev runtimes aligned with their process registry type

**Context**: The new splash-based dev runtimes track child processes in a `Set`, but shutdown code in the root script, app runtime, and create-app template still used `.filter(...)` as if the registry were an array.

**Problem**: Pressing `Ctrl+C` crashed shutdown with `TypeError: children.filter is not a function`, leaving the runtime to exit noisily instead of terminating child processes cleanly.

**Rule**: When a runtime script stores child processes in a `Set`, all shutdown and cleanup logic must iterate via `Array.from(children)` or direct `for...of`, and the same fix must be mirrored in `apps/mercato` and `packages/create-app/template` copies.

**Applies to**: `scripts/dev.mjs`, `apps/mercato/scripts/dev.mjs`, `packages/create-app/template/scripts/dev.mjs`, and `packages/create-app/template/scripts/dev-runtime.mjs`.
