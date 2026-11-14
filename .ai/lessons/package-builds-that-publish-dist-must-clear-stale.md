---
title: "Package builds that publish `dist/` must clear stale artifacts first"
modules: ["create_app"]
areas: ["debugging","module-data","architecture"]
topics: ["build-output","generated-files","database-migrations","concurrency"]
---

# Package builds that publish `dist/` must clear stale artifacts first

**Context**: Standalone parity started failing during `yarn initialize` because `@open-mercato/core` published a deleted migration file that still existed only in `dist/`.

**Problem**: Package build scripts that only overwrite current entry points leave removed files behind. Standalone/Verdaccio installs consume `dist/`, so stale migrations, routes, or generated outputs can execute even after the source file was deleted.

**Rule**: Any package build that publishes from `dist/` must explicitly prune stale outputs. When builds or readers can overlap, generate into an isolated staging directory and publish by copying the complete tree before pruning target-only entries; never expose a delete-then-regenerate window. A parallel test suite must build shared package outputs once before test discovery instead of letting multiple test files rebuild the same `dist/` tree. Do not rely on esbuild output to implicitly prune deleted files.

**Applies to**: Package `build.mjs` scripts, especially packages consumed by standalone apps through npm/Verdaccio.

Native integration runners may rebuild packages automatically after an environment retry. Wait for that runner to settle before starting another build or a generator that imports compiled modules. Overlapping cleanup and discovery can produce missing-module or `ENOTEMPTY` failures unrelated to the source change. Evidence: PR #9424 live RLS retry collided with a separate core rebuild; serialized rebuild and inventory generation restored complete output.
