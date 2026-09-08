---
title: "Docker entrypoints must verify required binaries, not just non-empty node_modules"
modules: ["cli","create_app"]
areas: ["framework-context","module-data","architecture"]
topics: ["build-output","command-pattern","package-runtime"]
---

# Docker entrypoints must verify required binaries, not just non-empty node_modules

**Context**: The standalone app dev entrypoint only checked whether `node_modules` existed and was non-empty before skipping `yarn install`.

**Problem**: A stale named volume from another app can leave `node_modules` populated but incomplete, with `node_modules/.bin/mercato` and `@open-mercato/cli` missing. Startup then fails later with `/bin/sh: mercato: not found`.

**Rule**: Docker startup scripts must verify the specific required package/binary for the next command (for example `node_modules/@open-mercato/cli` and `node_modules/.bin/mercato` before `yarn initialize`), not just the presence of a non-empty `node_modules` directory.

**Applies to**: `packages/create-app/template/docker/scripts/*.sh` and any future container entrypoints that rely on installed CLI binaries.
