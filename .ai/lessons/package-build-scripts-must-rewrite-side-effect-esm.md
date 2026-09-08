---
title: "Package build scripts must rewrite side-effect ESM imports and declared watch entrypoints must exist"
modules: ["checkout"]
areas: ["architecture","integration"]
topics: ["build-output","module-boundaries","package-runtime"]
---

# Package build scripts must rewrite side-effect ESM imports and declared watch entrypoints must exist

**Context**: `@open-mercato/checkout` emitted `import "./commands"` into dist because its build post-processing only rewrote `from` and dynamic imports. `@open-mercato/gateway-stripe` declared `"watch": "node watch.mjs"` without a `watch.mjs` file.

**Problem**: Dev boot failed on unsupported directory ESM imports, and `yarn watch:packages` aborted immediately on the missing watch entrypoint.

**Rule**: For package-local build scripts, handle all three relative import forms when fixing ESM output: static `from`, dynamic `import(...)`, and bare side-effect `import "..."`. If a package exposes a `watch` script, keep a real `watch.mjs` entrypoint committed alongside `build.mjs`.

**Applies to**: Workspace packages with custom `build.mjs` / `watch.mjs` tooling and any new ESM package added to the monorepo.
