# Safe Build / Dev Coexistence

**Status**: Draft
**Date**: 2026-03-23
**Author**: Agent

## Problem

When `yarn dev` is running, AI agents (or developers) sometimes run `yarn build` or `yarn build:packages` to verify the project compiles. The build process writes directly to `packages/*/dist/`, which is the **same directory** the dev server's watcher output lives in. This causes:

1. **Transient breakage**: esbuild overwrites `dist/` files while the Next.js dev server has them loaded — imports resolve to partially-written or stale files
2. **Post-build regression**: The build finishes but the dev watcher state is now out of sync with the `dist/` contents — hot reload fails or serves wrong code
3. **No recovery without restart**: The only fix is to kill `yarn dev` and start over

The root cause is that `build` and `dev` (watch) share the same output directory (`dist/`).

## Goals

- `yarn build` / `yarn build:packages` MUST NOT break a running `yarn dev` session
- Zero overhead when dev is not running — build should behave as today
- Minimal changes to existing build scripts
- Agent-safe: agents can run build checks without worrying about dev state

## Non-Goals

- Changing how `yarn dev` or watchers work
- Adding a build cache layer (turbo already handles that)
- Supporting concurrent `yarn build` invocations

## Solution: Isolated Build Output Directory

### Approach

Introduce a **`yarn build:check`** command that builds to an isolated output directory (`dist-check/`) instead of `dist/`. This is the command agents and developers should use when they want to verify compilability without disrupting a running dev server.

Additionally, make `yarn build:packages` dev-aware: if a dev server is running (detected via a lockfile or PID check), it warns and offers to use the isolated build instead.

### Phase 1: `yarn build:check` command

Add a new script that builds all packages to a temporary/isolated directory.

#### 1.1 Per-package build script changes

Each package's `build.mjs` already reads `outdir` from a constant. Make it configurable via an environment variable:

```javascript
// In each package's build.mjs
const outdir = join(__dirname, process.env.OM_BUILD_OUTDIR || 'dist')
```

#### 1.2 Root script

```jsonc
// package.json
{
  "scripts": {
    "build:check": "OM_BUILD_OUTDIR=dist-check turbo run build --filter='./packages/*'",
    // ... existing scripts unchanged
  }
}
```

#### 1.3 .gitignore

Add `dist-check/` to `.gitignore` (it's a throwaway build artifact).

### Phase 2: Dev-mode lockfile detection (optional enhancement)

#### 2.1 Dev lockfile

When `yarn dev` starts, write a lockfile at `.mercato/dev.lock` with the PID. Remove it on exit (via trap/signal handler).

#### 2.2 Build guard

Before `yarn build:packages` runs, check for the lockfile. If present and the PID is alive:
- Print a warning: `⚠ Dev server is running (PID xxxx). Use 'yarn build:check' for a safe build.`
- Optionally abort (controlled by `OM_BUILD_FORCE=1` to override)

### Phase 3: Agent tooling integration

Update AGENTS.md / CLAUDE.md to instruct agents:
- Use `yarn build:check` instead of `yarn build` when verifying compilation
- Use `yarn build:check` instead of `yarn build:packages` during dev sessions

## File Changes

| File | Change |
|------|--------|
| `package.json` | Add `build:check` script |
| `packages/*/build.mjs` | Read `OM_BUILD_OUTDIR` env var for output directory |
| `packages/*/watch.mjs` | No changes (watch always writes to `dist/`) |
| `.gitignore` | Add `dist-check/` |
| `AGENTS.md` | Add guidance to use `build:check` for verification |
| `scripts/dev-lockfile.sh` (new, Phase 2) | Lockfile management helpers |

## Affected Packages

All packages with `build.mjs`:
- `packages/shared/build.mjs`
- `packages/core/build.mjs`
- `packages/ui/build.mjs`
- `packages/cli/build.mjs`
- `packages/cache/build.mjs`
- `packages/queue/build.mjs`
- `packages/events/build.mjs`
- `packages/search/build.mjs`
- `packages/ai-assistant/build.mjs`
- `packages/content/build.mjs`
- `packages/onboarding/build.mjs`
- `packages/enterprise/build.mjs`
- Any integration provider packages (`packages/gateway-*/build.mjs`, etc.)

## Migration & Backward Compatibility

- No BC impact — this adds a new command, doesn't change existing ones
- `yarn build` and `yarn build:packages` continue to work exactly as before
- `dist-check/` is never used at runtime, only for verification

## Alternatives Considered

### A: Atomic swap (build to temp, rename to dist)
Rejected — still disrupts the watcher's in-memory state. The Next.js dev server caches module paths; swapping the directory underneath doesn't fix hot reload.

### B: File-level diffing (only overwrite changed files)
Rejected — adds complexity for marginal benefit. esbuild is fast; the problem isn't speed but shared state.

### C: Lock `yarn build` when dev is running
Rejected as sole solution — too restrictive. Agents need to verify builds. But added as optional Phase 2 warning.

## Implementation Phases

| Phase | Scope | Effort |
|-------|-------|--------|
| **1** | `build:check` command + env var in build scripts | Small (1-2 hours) |
| **2** | Dev lockfile + build guard warning | Small (1 hour) |
| **3** | AGENTS.md updates for agent guidance | Trivial |

## Test Plan

- [ ] Run `yarn dev`, then in another terminal run `yarn build:check` — dev server stays healthy
- [ ] Run `yarn build:check` without dev running — builds succeed, `dist-check/` created
- [ ] Run `yarn build` without dev running — unchanged behavior, writes to `dist/`
- [ ] Verify `dist-check/` is gitignored
- [ ] (Phase 2) Start dev, verify lockfile created; stop dev, verify lockfile removed
- [ ] (Phase 2) Start dev, run `yarn build:packages` — warning printed
