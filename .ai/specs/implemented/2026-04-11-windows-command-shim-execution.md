# Windows Command Shim Execution

## TLDR

Normalize Windows subprocess execution for Yarn, npm-style `.cmd` shims, and Mercato CLI shims by routing them through `cmd.exe /d /s /c` before spawning. This fixes Windows dev/build flows that can hang or fail when Node spawns `.cmd` files directly with `shell: false`.

## Overview

Windows package-manager commands such as `yarn.cmd`, `npx.cmd`, and generated CLI shims such as `mercato.cmd` are command scripts, not native executables. Several Open Mercato developer workflows selected those shims explicitly, or spawned `yarn` directly, then passed them to `spawn`/`spawnSync` without a shell wrapper.

The fix keeps Linux/macOS execution unchanged and only rewrites Windows shim execution at the local process helper boundary.

## Problem Statement

Affected Windows flows could stall, fail to start, or report unhelpful subprocess errors during long-running build/dev tasks because `.cmd` shims were spawned directly:

- `mercato module add` package installation
- integration test Yarn/Npx commands
- root `yarn dev` and `yarn dev:ephemeral` flows
- standalone app template dev runtime
- create-app Verdaccio smoke commands
- AI assistant stdio MCP default command
- splash coding/git helper command launches

## Proposed Solution

Add small local helpers named `resolveWindowsCommandShim` or equivalent near each process helper. On Windows:

- `yarn` defaults are converted to `yarn.cmd` where the caller previously used a bare Yarn command.
- commands ending with `.cmd` are executed as `cmd.exe /d /s /c <binary> ...args`.
- non-Windows platforms and non-`.cmd` commands remain unchanged.

## Architecture

The change is intentionally local instead of introducing a new shared runtime package because the affected files span root scripts, app templates, CLI test utilities, and one AI assistant stdio client. Keeping the rewrite at each process helper avoids changing public imports, package contracts, or generated app runtime assumptions.

### Updated Command Paths

- `packages/cli/src/lib/module-install.ts`: official module install flow.
- `packages/cli/src/lib/testing/integration.ts`: Yarn/Npx integration command helpers.
- `scripts/dev.mjs` and `packages/create-app/template/scripts/dev.mjs`: main dev runner command helper.
- `apps/mercato/scripts/dev.mjs` and `packages/create-app/template/scripts/dev-runtime.mjs`: `mercato.cmd` runtime helper.
- `scripts/dev-ephemeral.ts`: ephemeral dev setup and app runtime launch.
- `scripts/lib/verdaccio.ts`: create-app Verdaccio smoke command helper.
- `scripts/dev-splash-coding-flow.mjs` and template copy: agentic init command capture.
- `scripts/dev-splash-git-repo-flow.mjs` and template copy: executable lookup launch helper.
- `packages/ai-assistant/src/modules/ai_assistant/lib/mcp-client.ts`: default stdio MCP command.

## Data Models

No data models, database schema, migrations, or persisted settings are changed.

## API Contracts

No HTTP API routes, OpenAPI contracts, event IDs, widget IDs, ACL features, notification types, or CLI command names are changed. This is a runtime invocation fix for existing commands.

## Integration Coverage

No browser UI paths or API paths are added. Relevant command-path coverage:

- `yarn dev`
- `yarn dev:verbose`
- `yarn dev:app`
- `yarn dev:ephemeral`
- `yarn mercato module add <packageSpec>`
- `yarn test:integration`
- create-app Verdaccio smoke test commands
- AI assistant stdio MCP connection using its default command

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Argument quoting changes on Windows | Medium | Dev and test scripts | Use `cmd.exe /d /s /c <shim> ...args` with argument arrays instead of string concatenation | Low |
| Divergence between root scripts and create-app template copies | Medium | Standalone app scaffolds | Apply identical helper shape to root and template copies | Low |
| Unintended behavior change for explicit custom commands | Low | AI assistant stdio MCP | Only wrap the default Yarn command; explicit `options.command` remains caller-owned | Low |
| Missed future direct `.cmd` spawn | Medium | Developer tooling | Document the pattern in this spec for future process helpers | Medium |

## Migration & Backward Compatibility

- Additive and behavior-preserving on Linux/macOS.
- Existing command names and CLI arguments are unchanged.
- No import paths or public TypeScript interfaces are removed.
- Windows callers get corrected process invocation without needing to change commands.

## Final Compliance Report

| Check | Status | Notes |
|-------|--------|-------|
| Backward compatibility | Pass | No public contracts changed |
| Security impact | Pass | No new command input surfaces; arguments remain structured arrays |
| API/UI coverage | N/A | No API or browser UI path introduced |
| Data migration | N/A | No schema changes |
| Windows command coverage | Pass | All repo occurrences of explicit `yarn.cmd`, `npx.cmd`, and `mercato.cmd` were reviewed |

## Changelog

### 2026-04-11

- Added Windows `.cmd` shim resolution for module install, integration test helpers, dev runners, create-app template scripts, Verdaccio smoke helpers, ephemeral dev, splash helpers, and AI assistant stdio MCP default startup.
- Standardized the command shape to `cmd.exe /d /s /c <shim> ...args` while keeping non-Windows execution unchanged.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 - Inventory | Done | 2026-04-11 | Searched for explicit `yarn.cmd`, `npx.cmd`, `mercato.cmd`, and direct Yarn spawns |
| Phase 2 - Runtime Fixes | Done | 2026-04-11 | Added local shim resolution helpers at process helper boundaries |
| Phase 3 - Verification | Done | 2026-04-11 | Ran `git diff --check` and `node --check` on changed `.mjs` scripts |

## Verification

- `git diff --check`
- `node --check scripts/dev.mjs`
- `node --check apps/mercato/scripts/dev.mjs`
- `node --check scripts/dev-splash-coding-flow.mjs`
- `node --check scripts/dev-splash-git-repo-flow.mjs`
- `node --check packages/create-app/template/scripts/dev.mjs`
- `node --check packages/create-app/template/scripts/dev-runtime.mjs`
- `node --check packages/create-app/template/scripts/dev-splash-coding-flow.mjs`
- `node --check packages/create-app/template/scripts/dev-splash-git-repo-flow.mjs`

Full Yarn-based package tests were not runnable in the current checkout because Yarn reports a missing node_modules state file.
