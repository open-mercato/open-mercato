---
title: "`dbMigrate` must not write migration snapshots during initialize flows"
modules: ["cli"]
areas: ["module-data","architecture"]
topics: ["generated-files","database-migrations","runtime-startup"]
---

# `dbMigrate` must not write migration snapshots during initialize flows

**Context**: A branch change started passing a custom MikroORM `snapshotName` into `dbMigrate`, while `yarn initialize` always runs `dbMigrate`.

**Problem**: Fresh initialize/reinstall flows began rewriting per-module `.snapshot-*.json` files as a side effect, creating noisy git diffs unrelated to the migration application itself.

**Rule**: Keep stable snapshot naming for `dbGenerate`, but disable migration snapshots for `dbMigrate` (`snapshot: false`) so initialize applies committed migrations without mutating snapshot files.

**Applies to**: `packages/cli/src/lib/db/commands.ts` and any future init/bootstrap flow that calls `dbMigrate`.
