---
title: "`dbMigrate` must not write migration snapshots during initialize flows"
modules: ["cli","create_app"]
areas: ["module-data","architecture"]
topics: ["generated-files","database-migrations","runtime-startup","bootstrap-order"]
---

# `dbMigrate` must not write migration snapshots during initialize flows

**Context**: A branch change started passing a custom MikroORM `snapshotName` into `dbMigrate`, while `yarn initialize` always runs `dbMigrate`.

**Problem**: Fresh initialize/reinstall flows began rewriting per-module `.snapshot-*.json` files as a side effect, creating noisy git diffs unrelated to the migration application itself.

**Rule**: Keep stable snapshot naming for `dbGenerate`, but disable migration snapshots for `dbMigrate` (`snapshot: false`) so initialize applies committed migrations without mutating snapshot files.

**Activation corollary**: Generating runtime registries does not apply migrations. Any guide that activates a previously inert module with committed migrations must explicitly direct operators to run `yarn db:migrate`; otherwise its routes can become reachable before their tables exist.

**Reindex bootstrap corollary**: Initialization applies migrations before its normal application bootstrap. A post-migration reindex must bootstrap DI before creating its queue container, after migration ORMs close. Resolve the app directory lazily inside the non-fatal queue setup: runs with no applied migrations or no reindex declarations must remain bootstrap-free, and bootstrap failures must retain manual rebuild instructions without replacing a migration error. Regression coverage belongs in `commands.migrate-reindex.test.ts` and the broader database command suite.

**Applies to**: `packages/cli/src/lib/db/commands.ts`, create-app activation guidance, and any future init/bootstrap flow that calls `dbMigrate`.
