# SPEC-053: Docker Command Parity for Windows Developer Workflow

## TLDR
**Key Points:**
- Define a feature request to make Docker-based developer workflows expose the same practical command surface as native macOS/Linux workflows.
- Focus on scripts that are currently hard to run from Windows hosts (`*.sh` scripts, Turbo-root workflows, CLI reinstall/init, skills install).
- Introduce a documented command bridge (`docker compose exec app ...`) plus first-class `docker:*` scripts and helper entrypoints to remove shell/OS friction.

**Scope:**
- Root script inventory and compatibility mapping for Docker dev and Docker fullapp profiles.
- DX improvements for Windows users who develop only through Docker.
- Standardized wrappers for frequently used commands (build/generate/init/reinstall/install-skills/test/lint).
- Documentation updates for Docker command usage and troubleshooting.

**Non-scope:**
- Replacing native Linux/macOS workflows.
- Changes to business modules, API contracts, or database schema.
- Production runtime behavior of the app itself.

---

## Overview

OpenMarketo/Open Mercato already provides Dockerized development (`docker-compose.fullapp.dev.yml`) and full-stack runtime (`docker-compose.fullapp.yml`). However, many day-to-day engineering commands are still optimized for host-native Unix shells or root monorepo execution. This creates friction for Windows developers who primarily work through Docker and need practical access to the same command stack as macOS/Linux contributors.

This feature request introduces a command parity layer so Docker users can run developer workflows with predictable, documented, one-liner commands.

## Problem Statement

Current script and Docker setup shows a parity gap:

1. Root scripts include Unix shell invocations (e.g., `./scripts/*.sh`) and shell composition patterns that are not host-portable on Windows without WSL.
2. Docker fullapp production image is optimized for runtime (`yarn start`) and does not expose root monorepo tooling by default.
3. Docker docs explain stack startup but do not provide comprehensive mapping of “host command → Docker equivalent” for the full developer command set.
4. Tasks such as CLI reinstall/init flows and skills installation are not presented as first-class Docker workflows, making them hard to discover and repeat.

### Observed Gaps (Current Repository)

| Area | Evidence | Practical Impact for Windows + Docker users |
|------|----------|---------------------------------------------|
| Root script uses shell script files | `clean:generated`, `clean:packages`, `install-skills`, `registry:*`, `release:*` execute `./scripts/*.sh` | Hard or impossible to run natively in PowerShell/CMD without WSL; users need containerized execution path |
| Skills installer implementation | `scripts/install-skills.sh` relies on bash + `ln -s` symlinks | Works in Linux container but lacks an official Docker wrapper/docs flow |
| Runtime fullapp compose | `docker-compose.fullapp.yml` starts app with `yarn start` in `apps/mercato` | Monorepo root commands are not first-class in this profile |
| Production runner image | Dockerfile runner stage performs `yarn workspaces focus ... --production` | Tooling/dev dependencies used by root workflows are not guaranteed in runtime image |
| Dev compose entrypoint | `docker/scripts/dev-entrypoint.sh` automates install/build/generate/init then runs `yarn dev` | Good baseline, but no explicit host-level command bridge for ad-hoc script execution |

## Proposed Solution

Create a dedicated Docker command parity initiative:

1. **Compatibility Matrix**
   - Add an explicit matrix that maps root `package.json` scripts to support status in:
     - native host
     - `docker-compose.fullapp.dev.yml` app container
     - `docker-compose.fullapp.yml` app container
   - Classify each as: `works`, `works-with-wrapper`, `unsupported-by-design`.

2. **First-class Docker wrappers**
   - Add root `docker:*` scripts that run commands inside the dev app container using `docker compose exec app ...`.
   - Prioritize high-value scripts:
     - `generate`, `initialize`, `reinstall`, `db:migrate`, `db:generate`
     - `lint`, `typecheck`, `test`
     - `install-skills`
     - selected `mercato` CLI command passthrough.

3. **Container helper command**
   - Add a small helper script (Node/TS preferred for cross-platform host use) that:
     - detects active compose profile/container
     - executes requested script inside container
     - prints actionable errors when stack/container is not running.

4. **Docs and onboarding updates**
   - Extend Docker docs with “Windows + Docker developer command cookbook”.
   - Include examples for reinstalling CLI/init and installing skills from container context.

5. **Acceptance checks**
   - Verify parity commands in both Docker dev and Docker fullapp modes, documenting expected unsupported cases.

## Architecture

### Current State

- Root scripts include Turbo monorepo orchestration and shell scripts.
- Docker dev profile mounts repository and runs `yarn dev` through `docker/scripts/dev-entrypoint.sh`.
- Docker fullapp profile is oriented toward running built app (`yarn start`), not full monorepo development tasks.

### Target State

- A thin command bridge layer at repo root provides a stable interface for Docker users.
- Docker users execute `yarn docker:<command>` from Windows host; wrapper delegates into running Linux container.
- Docs provide deterministic flow: start stack → run command wrappers → troubleshoot.

## Data Models

No data model or schema changes.

## API Contracts

No HTTP/API contract changes.

## Integration Coverage (Required)

This feature is developer-experience infrastructure; no user-facing API/UI paths are added. Validation coverage should include command execution scenarios:

- Docker dev mode:
  - wrapper executes `generate`
  - wrapper executes `initialize -- --reinstall`
  - wrapper executes `install-skills`
- Docker fullapp mode:
  - wrapper reports supported runtime commands
  - wrapper returns clear unsupported message for monorepo-only operations (if intentionally excluded)

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Wrapper targets wrong container name/profile | Medium | Developer CLI UX | Auto-detect compose context and allow explicit override env var | Low |
| False expectation that every command works in production container | Medium | Documentation/Support | Mark unsupported commands explicitly in matrix and error text | Low |
| Windows path/shell quoting issues in wrappers | High | Windows developer workflow | Implement wrapper in Node (not bash), add command argument tests | Medium |
| Drift between new scripts and matrix docs | Medium | Documentation accuracy | Add lightweight CI check to compare script keys with matrix entries | Low |

## Migration & Backward Compatibility

- Additive only: introduces new Docker wrapper commands and docs.
- Existing host-native scripts remain unchanged.
- No breaking changes to existing command names or runtime contracts.

## Implementation Plan

### Phase 1: Inventory + Matrix
- Enumerate root scripts and classify Docker support level.
- Publish matrix in Docker docs.

### Phase 2: Wrapper Commands
- Add cross-platform wrapper helper.
- Add prioritized `docker:*` scripts to root `package.json`.

### Phase 3: Validation + Docs
- Validate wrappers in both Docker modes.
- Publish Windows-focused cookbook and troubleshooting section.

## Final Compliance Report

- ✅ Spec includes TLDR, architecture, risks, compatibility, and implementation phases.
- ✅ Change type is additive and does not alter API/data contracts.
- ✅ Includes explicit integration coverage requirements for command execution paths.

## Changelog

- 2026-03-03: Created feature request spec for Docker command parity across Windows Docker workflows and native dev command surface.
## Key Commands

The key commands to migrate are:

- `yarn dev:greenfield`
- `yarn initialize`
- `yarn generate`
