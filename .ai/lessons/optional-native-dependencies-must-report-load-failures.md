---
title: "Optional native dependencies must report load failures accurately"
modules: ["cache"]
areas: ["integration","module-data","debugging"]
topics: ["error-states","package-runtime","testing"]
---

# Optional native dependencies must report load failures accurately

**Context**: The cache package warned that SQLite was unavailable because of a "missing dependency: better-sqlite3", even though the package was installed.

**Problem**: The actual failure was a stale native build of `better-sqlite3` after a Node.js upgrade. The misleading warning sent debugging toward dependency declarations instead of the ABI mismatch and rebuild.

**Rule**: For optional native dependencies, preserve and classify the original load error. Do not collapse ABI/version/build failures into "missing dependency" messages. When loading native modules from package runtimes, prefer `createRequire(import.meta.url)` over dynamic `import()` if it is more reliable for CJS/native addons.

**Applies to**: `packages/cache/src/strategies/sqlite.ts`, `packages/cache/src/service.ts`, and any package with optional native providers.
