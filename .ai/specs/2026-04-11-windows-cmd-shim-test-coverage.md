# Windows `.cmd` Shim — Test Coverage

## TLDR

Add unit tests for the `resolveWindowsCommandShim` / `resolveYarnBinary` helpers introduced in `fix/windows-cmd-shim-execution`, and fix two pre-existing Windows-only test failures that block `yarn test` locally on Windows.

**Scope:**
- Export shim helpers from TypeScript files so they can be tested in isolation
- Unit tests covering all four platform/command combinations
- Fix `ERR_UNSUPPORTED_ESM_URL_SCHEME` in `ready-apps.test.ts` (Windows ESM path)
- Fix `EPERM symlink` in `resolve-environment.test.ts` (Windows symlink permissions)

## Overview

The `fix/windows-cmd-shim-execution` PR added `resolveWindowsCommandShim` as a private function in nine files. The function is pure and side-effect-free, making it ideal for unit testing, but because it is unexported there is currently zero automated coverage of the Windows branch. A future contributor who accidentally breaks the `.cmd` wrapping logic would not see a failing test until the bug is reported from a Windows dev environment.

Additionally, two unrelated tests in `packages/cli` and `packages/create-app` fail on every Windows checkout because they use POSIX-only APIs (`symlink` without Developer Mode, raw Windows drive-letter paths as ESM import URLs). These failures obscure real regressions and make `yarn test` unreliable on Windows.

## Problem Statement

1. `resolveWindowsCommandShim` and `resolveYarnBinary` are private and untested — the Windows code path has no automated guard.
2. `resolve-environment.test.ts` fails with `EPERM: operation not permitted, symlink` on Windows without Developer Mode enabled.
3. `ready-apps.test.ts` fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME: protocol 'c:'` because a raw Windows absolute path is passed as `--import` to Node's ESM loader.

## Proposed Solution

### Phase 1 — Export helpers and add unit tests

Export `resolveWindowsCommandShim` (and `resolveYarnBinary` where present) from each TypeScript file so tests can import them directly. Keep the function signatures unchanged — add only `export` keyword. For `.mjs` scripts the helpers stay private; `node --check` is sufficient for those.

Add a new test file `packages/cli/src/lib/__tests__/windows-shim.test.ts` and a matching one at `scripts/lib/__tests__/windows-shim.test.ts` that cover all cases via a `platform` argument override.

### Phase 2 — Fix pre-existing Windows test failures

**`resolve-environment.test.ts`** — Wrap the `symlink` call in a `try/catch`. If it throws `EPERM`, skip the test with a `test.skip` and a message explaining that Developer Mode is required. The feature under test (symlink detection in monorepo mode) is verified by the remaining non-symlink cases in the same file.

**`ready-apps.test.ts`** — Replace the raw `mockFetchModulePath` string with `pathToFileURL(mockFetchModulePath).href` before passing it as `--import`. Node's ESM loader accepts `file://` URLs on all platforms.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Export helpers, don't extract to shared package | Preserves the "intentionally local" architecture; shared package would change public import contracts |
| `platform` as parameter in tests, not `process.platform` mock | Avoids patching globals; functions already have consistent signatures |
| Skip symlink tests on EPERM rather than skipping the whole suite | Keeps the coverage that does work; makes the reason explicit in output |
| `pathToFileURL` fix in `ready-apps.test.ts` | Correct Node API for cross-platform ESM URL construction |

## Architecture

No architectural changes. This spec adds exports and tests to existing files only.

### Files affected

| File | Change |
|------|--------|
| `packages/cli/src/lib/module-install.ts` | Export `resolveWindowsCommandShim`, `resolveYarnBinary` |
| `packages/cli/src/lib/testing/integration.ts` | Export `resolveWindowsCommandShim`, `resolveYarnBinary` |
| `scripts/lib/verdaccio.ts` | Export `resolveWindowsCommandShim` |
| `scripts/dev-ephemeral.ts` | Export `resolveWindowsCommandShim` |
| `packages/cli/src/lib/__tests__/windows-shim.test.ts` | **Create** — unit tests for CLI shim helpers |
| `scripts/lib/__tests__/windows-shim.test.ts` | **Create** — unit tests for scripts/lib shim helpers |
| `packages/cli/src/lib/__tests__/resolve-environment.test.ts` | Fix EPERM symlink skip |
| `packages/create-app/src/lib/ready-apps.test.ts` | Fix ESM URL scheme error |

## Data Models

Not applicable — no data model changes.

## API Contracts

Not applicable — no HTTP API changes.

## Implementation Plan

### Phase 1 — Export helpers + unit tests

1. Add `export` to `resolveWindowsCommandShim` and `resolveYarnBinary` in `packages/cli/src/lib/module-install.ts` and `packages/cli/src/lib/testing/integration.ts`
2. Add `export` to `resolveWindowsCommandShim` in `scripts/lib/verdaccio.ts` and `scripts/dev-ephemeral.ts`
3. Create `packages/cli/src/lib/__tests__/windows-shim.test.ts`:

```ts
// cases to cover:
// resolveWindowsCommandShim('yarn.cmd', ['install'], 'win32')
//   → { command: 'cmd.exe', args: ['/d', '/s', '/c', 'yarn.cmd', 'install'] }
// resolveWindowsCommandShim('node', ['script.js'], 'win32')
//   → { command: 'node', args: ['script.js'] }   (not .cmd — no wrap)
// resolveWindowsCommandShim('yarn.cmd', ['install'], 'linux')
//   → { command: 'yarn.cmd', args: ['install'] }  (non-Windows — no wrap)
// resolveYarnBinary('win32') → 'yarn.cmd'
// resolveYarnBinary('linux') → 'yarn'
// verdaccio pattern: resolveWindowsCommandShim('yarn', [...], 'win32')
//   → { command: 'cmd.exe', args: ['/d', '/s', '/c', 'yarn.cmd', ...] }
//   (auto-promote because verdaccio variant promotes 'yarn' → 'yarn.cmd' inside)
```

4. Create matching `scripts/lib/__tests__/windows-shim.test.ts` for `verdaccio.ts` helper (Jest or Node test runner, matching the pattern used in adjacent test files)
5. Run `yarn test --filter @open-mercato/cli` and confirm new tests pass

### Phase 2 — Fix pre-existing Windows failures

6. In `packages/cli/src/lib/__tests__/resolve-environment.test.ts`, wrap symlink-dependent tests:

```ts
import { symlink } from 'node:fs/promises'

async function trySymlink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path)
    return true
  } catch (err: any) {
    if (err.code === 'EPERM') return false
    throw err
  }
}
// In each symlink test: if (!await trySymlink(...)) { test.skip(...); return }
```

7. In `packages/create-app/src/lib/ready-apps.test.ts`, replace the `--import` argument:

```ts
import { pathToFileURL } from 'node:url'
// Before: ['--import', mockFetchModulePath, ...]
// After:  ['--import', pathToFileURL(mockFetchModulePath).href, ...]
```

8. Run `yarn test` on Windows and confirm all suites are green

## Risks & Impact Review

### Risk Register

#### Exporting private helpers changes the public surface of `@open-mercato/cli`
- **Scenario**: A third-party module imports `resolveWindowsCommandShim` from `@open-mercato/cli` and breaks when it is later removed
- **Severity**: Low
- **Affected area**: `packages/cli` package public API
- **Mitigation**: Mark exports with `/** @internal */` JSDoc; the helpers have no plausible use outside tests
- **Residual risk**: Minimal — `@open-mercato/cli` is a developer tooling package, not a runtime dependency for app modules

#### `pathToFileURL` fix changes test behaviour on Linux
- **Scenario**: `file://` URL works on Linux but reveals a different failure mode in the test
- **Severity**: Low
- **Affected area**: `packages/create-app` tests only
- **Mitigation**: `pathToFileURL` is the correct Node API on all platforms; the test was already broken on Windows — Linux was just lucky
- **Residual risk**: None — `file://` URLs are universally supported by Node's ESM loader

#### Symlink skip silences real failures on Windows with Developer Mode
- **Scenario**: Developer Mode is enabled, symlink works, but the code under test has a regression that only shows up in symlink mode
- **Severity**: Low
- **Affected area**: Monorepo-mode detection in `resolveEnvironment`
- **Mitigation**: The skip is only triggered when `EPERM` is thrown; with Developer Mode the test runs normally
- **Residual risk**: Devs without Developer Mode skip two cases — acceptable given the rest of the suite covers non-symlink monorepo detection

## Final Compliance Report

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/cli/AGENTS.md`
- `packages/create-app/AGENTS.md`

### Compliance Matrix

| Rule | Status | Notes |
|------|--------|-------|
| No new public API contracts | Compliant | Exports marked `@internal` |
| No new data model or migration | Compliant | Tests only |
| Behaviour changes covered by tests | Compliant | This spec IS the test coverage |
| No cross-module ORM | Compliant | N/A |
| No hardcoded user-facing strings | Compliant | N/A |

### Verdict

Fully compliant — ready for implementation.

## Changelog

### 2026-04-11
- Initial specification
- Implemented Phase 1: exported `resolveWindowsCommandShim` / `resolveYarnBinary` with optional `platform` parameter from `module-install.ts`, `testing/integration.ts`, `scripts/lib/verdaccio.ts`, `scripts/dev-ephemeral.ts`; created `packages/cli/src/lib/__tests__/windows-shim.test.ts` (11 cases covering both CLI and verdaccio variants)
- Implemented Phase 2: `resolve-environment.test.ts` — `trySymlink()` helper with EPERM-guard skips symlink tests gracefully on Windows without Developer Mode; `ready-apps.test.ts` — `pathToFileURL(mockFetchModulePath).href` fixes `ERR_UNSUPPORTED_ESM_URL_SCHEME` on Windows
- Note: during investigation found an additional pre-existing Node 24 regression in `openapi-paths.ts` (`fileURLToPath` without explicit `windows` option throws on Node 24 with POSIX URLs); tracked and fixed separately on branch `fix/node24-fileURLToPath-windows`
