# SPEC-067 — CLI Standalone App Support

**Date:** 2026-03-17
**Status:** Draft
**Scope:** OSS — `@open-mercato/cli`

---

## TLDR

The CLI (`@open-mercato/cli`) was built assuming it always runs inside the Open Mercato monorepo. When installed in a **standalone Next.js app** (single-repo, packages resolved from `node_modules`) three subsystems break: the path resolver, integration-test discovery, and the ephemeral test environment. This spec defines the correct permanent fix delivered as a **single phase**. The core architectural change is introducing a `CliEnvironment` value-object — a single plain record encoding `{ mode, rootDir, appDir, packageRoot }` — produced once by the resolver and consumed by all subsystems, eliminating per-subsystem `isMonorepo()` branching and hardcoded path segments.

---

## Problem Statement

### Root Cause

`@open-mercato/cli` conflates two orthogonal concepts and scatters the decision logic across every subsystem:

| Concept | Monorepo value | Standalone value |
|---------|----------------|-----------------|
| **workspace root** | repo root (symlinks present) | directory where `node_modules/@open-mercato/*` lives |
| **app directory** | `apps/mercato` (or similar) | `cwd` (or `cwd/apps/*` subdirectory if present) |
| **package sources** | `packages/<pkg>/src/` | `node_modules/@open-mercato/<pkg>/src/` |
| **build scripts** | `yarn workspace @open-mercato/app <cmd>` | `yarn run <cmd>` from `appDir` |
| **binary resolution** | `rootDir/node_modules/` | may be in `appDir/node_modules/` |

Every place the CLI makes a decision it reaches for `isMonorepo()` and hard-codes the monorepo branch. The standalone branch is either absent or falls through to `cwd`, producing wrong paths and failing commands.

### Affected Subsystems

#### 1. `src/lib/resolver.ts` — `createResolver`

```
Current: rootDir = monorepoRoot ?? cwd
Problem: When node_modules are real directories (not symlinks) and live
         above cwd, monorepoRoot is null. rootDir becomes cwd.
         detectAppDir(cwd) then finds no apps/ subdirectory → appDir = cwd,
         so all generated-file paths point at the project root, not the app.
```

#### 2. `src/lib/testing/integration-discovery.ts`

```
Current: discovery roots = [apps/, packages/]
Problem: Standalone app's src/modules/ is never scanned.
         Tests inside node_modules/@open-mercato/*/src/modules/__integration__/
         are never found. Module ID resolution is incomplete → tests for
         installed modules are filtered out as "unknown module".
```

#### 3. `src/lib/testing/integration.ts`

```
Current:
  APP_BUILD_ARTIFACTS   = hardcoded apps/mercato/... paths
  APP_BUILD_INPUT_PATHS = hardcoded apps/mercato/ + packages/core/ + packages/ui/
  build commands use: runYarnWorkspaceCommand('@open-mercato/app', 'initialize'|'build'|'start')
  checksum rm() targets hardcoded apps/mercato path
  build:packages executed unconditionally

Problem: No apps/mercato/ in standalone; no @open-mercato/app workspace;
         no build:packages script. Every build step throws or resolves wrong dir.
```

#### 4. `src/mercato.ts` — `dev` / `start` commands

```
Current: nodeModulesBase = isMonorepo ? rootDir : appDir   (single candidate)
         nextBin   = nodeModulesBase/node_modules/next/dist/bin/next
         mercatoBin = nodeModulesBase/node_modules/@open-mercato/cli/bin/mercato

Problem: When packages are hoisted into a parent directory the binary is not
         found under appDir. Single-candidate search fails silently.
```

---

## Proposed Solution

### Core Design: `CliEnvironment` value-object

Replace the per-subsystem `isMonorepo()` + ad-hoc path computation pattern with a single plain record produced once by the resolver:

```ts
/**
 * Resolved execution environment for the CLI.
 * Produced once by resolveEnvironment(); consumed by all subsystems.
 */
export type CliEnvironment = {
  /** Whether the CLI is running inside a Yarn/npm workspace monorepo. */
  mode: 'monorepo' | 'standalone'
  /** Workspace or project root (where package.json / node_modules live). */
  rootDir: string
  /** Next.js application directory (contains src/, package.json, next.config.*). */
  appDir: string
  /**
   * Resolve the root directory of an installed @open-mercato package.
   * In monorepo: packages/<pkg>/  In standalone: node_modules/<pkg>/
   */
  packageRoot: (packageName: string) => string
}

export function resolveEnvironment(cwd?: string): CliEnvironment
```

`resolveEnvironment` is a **pure function** (no class, no singleton). Callers may provide `cwd` for testability. Subsystems call it once at module init or at the start of their command, then use the returned object — no further `isMonorepo()` calls.

#### Three environments fully covered

| Environment | `mode` | `rootDir` | `appDir` | `packageRoot('@open-mercato/core')` |
|-------------|--------|-----------|---------|-------------------------------------|
| Monorepo (symlinks) | `monorepo` | symlink target parent | `detectAppDir(rootDir)` | `rootDir/packages/core` |
| Standalone, hoisted `node_modules` | `standalone` | `nodeModulesRoot` above cwd | `detectAppDir(rootDir)` if exists, else `cwd` | `rootDir/node_modules/@open-mercato/core` |
| Standalone, local `node_modules` | `standalone` | `cwd` | `cwd` | `cwd/node_modules/@open-mercato/core` |

#### Resolver correctness fix (prerequisite)

The `rootDir` derivation must be fixed before the environment object can be built correctly:

```ts
// Before
const rootDir = monorepoRoot ?? cwd

// After
const rootDir = monorepoRoot ?? nodeModulesRoot ?? cwd

const shouldResolveAppFromRoot =
  isMonorepo || (nodeModulesRoot !== null && path.resolve(nodeModulesRoot) !== path.resolve(cwd))

const candidateAppDir = shouldResolveAppFromRoot ? detectAppDir(rootDir, true) : rootDir
const appDir =
  isMonorepo
    ? candidateAppDir
    : shouldResolveAppFromRoot && candidateAppDir !== rootDir && existsSync(candidateAppDir)
      ? candidateAppDir
      : cwd
```

### Integration discovery: standalone roots

Two new roots added to both `resolveEnabledModuleIds` and `discoverIntegrationSpecFiles`:

| New root | Purpose |
|----------|---------|
| `env.rootDir/src/modules` | Standalone app modules at project root |
| `env.rootDir/node_modules/@open-mercato` | Installed package module trees (source-shipped) |

Extract `collectModuleIdsFromModulesRoot(root, set)` helper to eliminate inline loops.

### Integration test environment: resolver-derived paths

All hardcoded path segments replaced with `CliEnvironment`-derived values:

```ts
const env = resolveEnvironment()

// Build artifacts
const APP_BUILD_ARTIFACTS = [
  path.join(env.appDir, '.mercato', 'next', 'BUILD_ID'),
  path.join(env.appDir, '.mercato', 'generated', 'modules.generated.ts'),
  path.join(env.packageRoot('@open-mercato/core'), 'dist', 'index.js'),
  path.join(env.packageRoot('@open-mercato/ui'),   'dist', 'index.js'),
]

// Workspace command replacement
// Before: runYarnWorkspaceCommand('@open-mercato/app', 'initialize', ...)
// After:  runYarnCommand(['initialize'], env, opts, env.appDir)
```

`runYarnWorkspaceCommand` and `startYarnWorkspaceCommand` are removed. `runYarnCommand` / `startYarnCommand` gain an optional `cwd` parameter defaulting to `env.rootDir`.

`build:packages` step is guarded:

```ts
const PROJECT_SUPPORTS_PACKAGE_BUILDS =
  typeof readPackageScripts(env.rootDir)['build:packages'] === 'string'
```

### Binary resolution: multi-base ordered search

```ts
function resolveInstalledBinary(baseDirs: string[], relativeBinPath: string): string {
  for (const baseDir of baseDirs) {
    const candidate = path.join(baseDir, 'node_modules', relativeBinPath)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`Could not find installed binary "${relativeBinPath}". Checked: ...`)
}

const bases = Array.from(new Set([env.rootDir, env.appDir]))
const nextBin    = resolveInstalledBinary(bases, 'next/dist/bin/next')
const mercatoBin = resolveInstalledBinary(bases, '@open-mercato/cli/bin/mercato')
```

---

## Implementation Plan

All steps are a single phase delivered in one PR.

### Step 1 — `resolver.ts`: fix `rootDir`/`appDir` derivation + export `CliEnvironment`

- [ ] 1.1 Destructure `nodeModulesRoot` in `createResolver`; change `rootDir = monorepoRoot ?? nodeModulesRoot ?? cwd`
- [ ] 1.2 Introduce `shouldResolveAppFromRoot`; update `candidateAppDir` and `appDir` derivation
- [ ] 1.3 Define and export `CliEnvironment` type
- [ ] 1.4 Add `resolveEnvironment(cwd?: string): CliEnvironment` export that delegates to the fixed `createResolver` and maps to the value-object shape (`mode`, `rootDir`, `appDir`, `packageRoot`)
- [ ] 1.5 Unit tests: `resolveEnvironment` covers monorepo, standalone-hoisted, standalone-local

### Step 2 — `integration-discovery.ts`: standalone discovery roots

- [ ] 2.1 Extract `collectModuleIdsFromModulesRoot(root, set)` helper; replace all inline loops
- [ ] 2.2 Add `src/modules` and `node_modules/@open-mercato` roots in `resolveEnabledModuleIds`
- [ ] 2.3 Add same roots to `discoverIntegrationSpecFiles` discovery roots array
- [ ] 2.4 Unit tests: standalone `src/modules` discovery; installed-package `node_modules/@open-mercato` discovery

### Step 3 — `integration.ts`: resolver-derived paths + cwd-aware yarn helpers

- [ ] 3.1 Import `existsSync`, `readFileSync`; call `resolveEnvironment()` at module level
- [ ] 3.2 Add `resolveFirstExistingPath`, `collectExistingPaths`, `readPackageScripts` helpers
- [ ] 3.3 Derive `APP_BUILD_ARTIFACTS`, `APP_BUILD_INPUT_PATHS`, `APP_MODULES_CHECKSUM_PATH`, `PROJECT_SUPPORTS_PACKAGE_BUILDS` from environment
- [ ] 3.4 Add `cwd` parameter to `runYarnRawCommand`, `runYarnCommand`, `startYarnRawCommand`
- [ ] 3.5 Replace `startYarnWorkspaceCommand` → `startYarnCommand(args, env, opts, cwd)`; remove both workspace helpers
- [ ] 3.6 Update `startEphemeralEnvironment`: remove `appWorkspace`, wire new helpers, guard `build:packages`

### Step 4 — `mercato.ts`: `resolveInstalledBinary` + multi-base search

- [ ] 4.1 Add `resolveInstalledBinary(baseDirs, relativeBinPath)` helper
- [ ] 4.2 Replace `nodeModulesBase` with `bases` array in both `dev` and `start` handlers
- [ ] 4.3 Use `resolveInstalledBinary` for `nextBin` and `mercatoBin`

---

## Migration & Backward Compatibility

- `PackageResolver` interface: **no change** — `resolveEnvironment` is a new export alongside `createResolver`
- `CliEnvironment.packageRoot` subsumes `resolver.getPackageRoot()` for subsystem use; `getPackageRoot` remains on the interface for existing callers
- `runYarnWorkspaceCommand` / `startYarnWorkspaceCommand`: private functions, safe to remove
- Monorepo behaviour preserved: when `mode === 'monorepo'` all resolved paths are identical to the previous implementation

---

## Integration Coverage

| Scenario | Test type |
|----------|-----------|
| `resolveEnvironment` — monorepo (symlinks) | Unit |
| `resolveEnvironment` — standalone hoisted `node_modules` | Unit |
| `resolveEnvironment` — standalone local `node_modules` | Unit |
| `resolveEnabledModuleIds` — `src/modules` root | Unit |
| `resolveEnabledModuleIds` — `node_modules/@open-mercato` root | Unit |
| `discoverIntegrationSpecFiles` — standalone app | Unit |
| `discoverIntegrationSpecFiles` — installed packages | Unit |
| Ephemeral env build pipeline — standalone | Manual / canary against standalone scaffold |
| `mercato dev` binary resolution — standalone | Manual smoke test |

---

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 0.1 | 2026-03-17 | Initial draft |
| 0.2 | 2026-03-17 | Resolved Q1–Q3: single phase, `CliEnvironment` abstraction, scope limited to three subsystems |
