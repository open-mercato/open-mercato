---
title: "Package build scripts must rewrite side-effect ESM imports and declared watch entrypoints must exist"
modules: ["checkout"]
areas: ["architecture","integration"]
topics: ["build-output","module-boundaries","package-runtime","json-assets"]
---

# Package build scripts must rewrite side-effect ESM imports and declared watch entrypoints must exist

**Context**: `@open-mercato/checkout` emitted `import "./commands"` into dist because its build post-processing only rewrote `from` and dynamic imports. `@open-mercato/gateway-stripe` declared `"watch": "node watch.mjs"` without a `watch.mjs` file.

**Problem**: Dev boot failed on unsupported directory ESM imports, and `yarn watch:packages` aborted immediately on the missing watch entrypoint.

**Rule**: For package-local build scripts, handle all three relative import forms when fixing ESM output: static `from`, dynamic `import(...)`, and bare side-effect `import "..."`. If a package exposes a `watch` script, keep a real `watch.mjs` entrypoint committed alongside `build.mjs`.

**Applies to**: Workspace packages with custom `build.mjs` / `watch.mjs` tooling and any new ESM package added to the monorepo.

**JSON asset regression (PR #7754, 2026-10-25)**: A checkout resolver imported `../i18n/en.json`. Source tests and package compilation passed, but the app build failed because the emitted resolver retained the relative import and `buildPackage` defaults `copyJson` to false. Enable the shared builder's `copyJson` option when emitted modules import source JSON. Verify a clean package build, bundle the emitted consumer, and inspect the npm package contents; source-level tests alone cannot prove that runtime assets ship.
