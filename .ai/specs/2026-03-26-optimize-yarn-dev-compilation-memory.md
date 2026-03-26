# Optimize `yarn dev` Compilation Time and Memory Usage

**Status**: Draft
**Date**: 2026-03-26
**Author**: Agent

## TLDR

The `yarn dev` pipeline spawns ~22 Node.js processes (18 esbuild watchers + Next.js/Turbopack + worker + scheduler + turbo daemon), rebuilds all packages from scratch on every restart due to disabled Turbo cache, and runs an expensive post-build `.js` extension rewrite across 2000+ files after every change. This spec proposes seven targeted optimizations to reduce cold-start time by ~80%, cut steady-state memory by ~40%, and improve incremental rebuild latency.

## Overview

The current `yarn dev` script orchestrates:

```
yarn build:packages && yarn watch:packages & sleep 3 && yarn dev:app
```

1. **`build:packages`** — Turbo builds all 18 packages via esbuild (each with its own `build.mjs`)
2. **`watch:packages`** — Turbo spawns 18 parallel esbuild watchers (each a separate Node.js process)
3. **`sleep 3`** — Hardcoded delay before starting the app
4. **`dev:app`** — Starts Next.js with Turbopack + worker process + scheduler process

Each package's build uses esbuild with every `.ts/.tsx` file as a separate entry point (core alone has ~2068 files), followed by a post-build plugin that globs and regex-rewrites all output files to add `.js` extensions to ESM imports.

## Problem Statement

### P1 — Full rebuild on every restart

`turbo.json` sets `"cache": false` on the `build` task, and `globalPassThroughEnv: ["*"]` invalidates any cache by passing all env vars. Every `yarn dev` invocation rebuilds all 18 packages from scratch even when zero source files changed.

### P2 — Expensive post-build `.js` extension rewriting

The `addJsExtension` esbuild plugin runs `onEnd` after every build/rebuild:
- Globs all `dist/**/*.js` files (2000+ in core)
- Reads each file, runs 3 regex replacements with `existsSync` checks per import
- Writes back modified files

This runs on **every** incremental rebuild in watch mode, not just the changed files.

### P3 — 18 separate Node.js watcher processes

`turbo run watch --parallel` spawns a separate Node.js process per package. Each process loads esbuild, creates a context, and maintains filesystem watchers independently. With 18 packages this means ~18 resident processes consuming 50–150 MB each.

### P4 — Unnecessary dev-time processes

`AUTO_SPAWN_WORKERS` and `AUTO_SPAWN_SCHEDULER` default to `true`, spawning background worker and scheduler processes during development even when not needed for most frontend/backend work.

### P5 — Hardcoded `sleep 3` race condition

The 3-second sleep between watch start and Next.js launch is arbitrary. On slower machines the initial build may not finish in time; on fast machines it wastes 3 seconds.

### P6 — No memory limits

No `NODE_OPTIONS` are set, so each of the ~4+ main processes can grow heap unboundedly. Combined with P3, total memory can exceed 4–6 GB.

### P7 — Target mismatch

Build target is `node18` while `package.json` declares `"engines": { "node": "24.x" }`. Targeting a newer engine allows esbuild to emit more modern syntax, reducing output size and parse time.

## Proposed Solution

Seven independent, incrementally adoptable optimizations ordered by impact/effort ratio.

### Phase 1 — Enable Turbo cache for `build` (High impact, Low effort)

**Changes:**

1. **`turbo.json`**: Remove `"cache": false` from the `build` task, replace `globalPassThroughEnv: ["*"]` with an explicit allowlist of variables that actually affect build output.

```jsonc
// turbo.json
{
  "globalPassThroughEnv": [
    "NODE_ENV",
    "DATABASE_URL",
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL"
    // ... other runtime-only vars
  ],
  "tasks": {
    "build": {
      // cache: true (default) — no longer disabled
      "inputs": ["src/**/*.ts", "src/**/*.tsx", "tsconfig.json", "build.mjs", "package.json"],
      "outputs": ["dist/**"]
    }
    // ... rest unchanged
  }
}
```

**Expected impact:** Subsequent `yarn dev` starts skip `build:packages` entirely when source files haven't changed. Cold-start reduction from ~30–60s to ~2–5s.

### Phase 2 — Incremental `.js` extension rewriting (High impact, Low effort)

**Changes to `scripts/watch.mjs` and `packages/core/build.mjs`:**

Instead of globbing all `dist/**/*.js` on every rebuild, track which files actually changed:

```javascript
// In the addJsExtension plugin
const addJsExtension = {
  name: 'add-js-extension',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return

      // Only process files that esbuild actually wrote
      // Use result.metafile.outputs to identify changed files
      const changedFiles = Object.keys(result.metafile?.outputs ?? {})
        .filter(f => f.endsWith('.js'))
        .map(f => path.resolve(f))

      // Fallback to full glob only on initial build (no metafile)
      const filesToProcess = changedFiles.length > 0
        ? changedFiles
        : await glob('dist/**/*.js', { cwd: packageDir, absolute: true })

      for (const file of filesToProcess) {
        addJsExtensionsToFile(file)
      }
    })
  }
}
```

Enable `metafile: true` in the esbuild configuration to get output file tracking.

**Alternative (longer-term):** Replace the post-build rewrite entirely with an esbuild `onResolve` plugin that adds `.js` at resolve time, eliminating the need for any post-processing.

**Expected impact:** Watch-mode rebuilds process 1–5 files instead of 2000+. Rebuild latency drops from ~2–5s to ~100–300ms.

### Phase 3 — Consolidate watchers into a single process (Medium impact, Medium effort)

**Create `scripts/watch-all.mjs`:**

Replace 18 separate Turbo-spawned processes with a single Node.js script that creates multiple esbuild contexts:

```javascript
import { watch } from './watch.mjs'
import { glob } from 'glob'
import path from 'node:path'

const packageDirs = await glob('packages/*/package.json')
const packages = packageDirs
  .map(p => path.dirname(path.resolve(p)))
  .filter(dir => existsSync(path.join(dir, 'src')))

// Create all esbuild contexts in a single process
await Promise.all(packages.map(dir => watch(dir)))
```

Update `package.json`:
```json
"watch:packages": "node scripts/watch-all.mjs"
```

esbuild contexts within a single process share the same thread pool and filesystem cache, significantly reducing overhead.

**Expected impact:** Memory reduction of ~500–800 MB (from 18 processes to 1). Faster startup as there's no Turbo overhead for spawning.

### Phase 4 — Disable worker/scheduler by default in dev (Medium impact, Low effort)

**Changes to `.env.example` and documentation:**

```bash
# .env (development defaults)
AUTO_SPAWN_WORKERS=false
AUTO_SPAWN_SCHEDULER=false
```

Developers who need workers/scheduler can opt in explicitly. Most frontend and API development doesn't require background processing.

**Expected impact:** ~200–400 MB memory savings, 2 fewer Node.js processes.

### Phase 5 — Replace `sleep 3` with readiness check (Low-Medium impact, Low effort)

**Changes to `package.json`:**

```json
"dev": "yarn build:packages && yarn watch:packages & node scripts/wait-for-packages.js && yarn dev:app"
```

**Create `scripts/wait-for-packages.js`:**

```javascript
import { existsSync } from 'node:fs'
import { glob } from 'glob'
import path from 'node:path'

const packages = await glob('packages/*/package.json')
const distChecks = packages
  .map(p => path.resolve(path.dirname(p), 'dist'))
  .filter(d => existsSync(path.resolve(path.dirname(d), 'src')))

const maxWait = 30_000
const start = Date.now()
const interval = 200

while (Date.now() - start < maxWait) {
  const allReady = distChecks.every(d => existsSync(d))
  if (allReady) {
    console.log('[dev] All packages ready')
    process.exit(0)
  }
  await new Promise(r => setTimeout(r, interval))
}

console.error('[dev] Timeout waiting for packages')
process.exit(1)
```

**Expected impact:** Eliminates arbitrary delay; adapts to machine speed. Saves ~2s on fast machines, prevents race conditions on slow machines.

### Phase 6 — Set `NODE_OPTIONS` memory limits (Low impact, Low effort)

**Changes to `.env.example`:**

```bash
# Prevent unbounded heap growth in dev
NODE_OPTIONS="--max-old-space-size=2048"
```

**Expected impact:** Prevents OOM on memory-constrained machines. Forces garbage collection at reasonable thresholds.

### Phase 7 — Update esbuild target to `node24` (Low impact, Low effort)

**Changes to all `build.mjs` and `watch.mjs` files:**

```javascript
target: 'node24',  // was 'node18'
```

**Expected impact:** Smaller output (modern syntax preserved), marginally faster parsing. Aligns build target with declared engine requirements.

## Architecture

No architectural changes are required. All optimizations are configuration and build-tooling changes that preserve the existing module system, auto-discovery, and runtime behavior.

```
Before:
  yarn dev
    └─ turbo build (18 packages, no cache) ........... 30-60s
    └─ turbo watch (18 Node.js processes) ............ ~1.5 GB RSS
    └─ sleep 3
    └─ next dev + worker + scheduler ................. ~800 MB RSS
                                            Total: ~2.3 GB, ~35s startup

After (all phases):
  yarn dev
    └─ turbo build (18 packages, cached) ............. 2-5s (cache hit: <1s)
    └─ node watch-all.mjs (1 process, 18 contexts) .. ~200 MB RSS
    └─ wait-for-packages (adaptive) .................. 0-5s
    └─ next dev (no worker/scheduler) ................ ~500 MB RSS
                                            Total: ~700 MB, ~5s startup
```

## Data Models

No changes.

## API Contracts

No changes. All optimizations are build-time only.

## Risks & Impact Review

| Risk | Failure Scenario | Severity | Affected Area | Mitigation | Residual Risk |
|------|-----------------|----------|---------------|------------|---------------|
| Turbo cache staleness | Cached build output served when source actually changed | High | Build correctness | Explicit `inputs` declaration limits cache keys to source files; `turbo clean` as escape hatch | Low — esbuild output is deterministic |
| Watcher consolidation misses events | Single-process watcher drops file change events under high load | Medium | Dev experience | esbuild's built-in watcher is battle-tested; add per-package rebuild logging | Low |
| Metafile-based incremental rewrite misses files | First build after cache hit skips extension rewrite | Medium | Runtime imports | Fallback to full glob when `metafile.outputs` is empty; initial build always does full pass | Low |
| Disabled workers break workflow testing | Developer forgets to enable workers when testing async features | Low | Dev workflow | Clear console message on startup: "Workers disabled — set AUTO_SPAWN_WORKERS=true to enable" | Low |
| `wait-for-packages` timeout on CI | 30s timeout too short for constrained CI runners | Low | CI pipeline | CI uses `yarn build` (not `yarn dev`), so this script is dev-only | Negligible |
| `node24` target breaks older Node | Output uses syntax not available in Node 18/20 | Low | Deployment | `engines` field already requires Node 24.x; CI enforces this | Negligible |

## Non-Goals

- Migrating away from esbuild (e.g., to `tsc --build` with project references)
- Switching from Turbopack to Webpack or Vite for Next.js
- Restructuring the monorepo package layout
- Optimizing production build times (this spec is dev-mode only)

## Implementation Plan

All phases are independent and can be landed in any order. Recommended sequence by impact/effort:

| Order | Phase | Effort | Dependencies |
|-------|-------|--------|-------------|
| 1 | Phase 1 — Turbo cache | ~1h | None |
| 2 | Phase 2 — Incremental rewrite | ~2h | None |
| 3 | Phase 4 — Disable workers | ~30m | None |
| 4 | Phase 7 — node24 target | ~30m | None |
| 5 | Phase 6 — Memory limits | ~15m | None |
| 6 | Phase 5 — Readiness check | ~1h | None |
| 7 | Phase 3 — Consolidate watchers | ~3h | None (but benefits from Phase 2) |

## Test Plan

- **Phase 1**: Run `yarn dev` twice, verify second start skips package builds (check turbo output for "FULL TURBO" or cache-hit messages)
- **Phase 2**: Change a single file in `packages/core/src/`, verify only 1–3 files are reprocessed (check console output)
- **Phase 3**: Run `yarn dev`, verify all packages rebuild on change, check RSS with `ps aux | grep node`
- **Phase 4**: Run `yarn dev` without workers, confirm dev server works, confirm workers start when env var set
- **Phase 5**: Run `yarn dev` on fresh clone (no `dist/`), verify it waits until packages build
- **Phase 6**: Monitor memory with `node --v8-pool-size=0 --max-old-space-size=2048`, verify GC pressure stays reasonable
- **Phase 7**: Run `yarn dev`, verify all modules load correctly, run `yarn test`

## Changelog

| Date | Change |
|------|--------|
| 2026-03-26 | Initial draft |
