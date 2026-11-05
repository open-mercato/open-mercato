---
title: "Standalone source-mirror discovery must remap source extensions to runtime files"
modules: ["create_app","cli"]
areas: ["framework-context","architecture","umes"]
topics: ["access-control","build-output","generated-files"]
---

# Standalone source-mirror discovery must remap source extensions to runtime files

**Context**: Published packages can ship `src/modules/**/*.ts` alongside compiled `dist/modules/**/*.js`. Generators may discover convention files from the source mirror while runtime bootstrap imports the compiled package exports.

**Problem**: If standalone discovery finds `src/modules/configs/cli.ts` and then validates that exact relative path under `dist/modules`, the check fails because the runtime file is `cli.js`. The module then silently loses CLI/setup/ACL and other convention registrations in `modules.cli.generated.ts`, which breaks bootstrap-only flows like `yarn setup`.

**Rule**: When discovery uses a standalone source mirror, resolve the logical file from `src`, then remap it to the matching compiled file in `dist` by basename, not by keeping the source extension. Discovery and runtime paths must stay logically aligned even when `.ts` becomes `.js`.

**Applies to**: `packages/cli` `resolveModuleFile()`, standalone module registry generation, CLI bootstrap generation, and any future source-mirror-based convention file lookup.
