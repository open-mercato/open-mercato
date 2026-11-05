# SPEC-063: Official Modules Verdaccio Registry & Publishing Scripts

**Date:** 2026-03-13
**Status:** Draft
**Scope:** OSS — local registry infrastructure and publish/build scripting for `open-mercato/official-modules`
**Author:** Open Mercato Team
**Related:** external draft `SPEC-060: Official Modules Marketplace Repository`, [SPEC-062-2026-03-13-official-modules-development-monorepo.md](./SPEC-062-2026-03-13-official-modules-development-monorepo.md)

---

## TLDR

**Key Points:**
- `official-modules` MUST ship with its own local Verdaccio setup for preview package publishing and prototyping
- The repo MUST include explicit scripts under `scripts/` for:
  - starting/checking registry assumptions
  - building publishable packages
  - publishing preview builds to Verdaccio
  - publishing stable builds with the same script contract later reused in CI
- These scripts are infrastructure-only; consumer flows like installing modules into core repo or standalone apps are out of scope for this spec

**Scope:**
- `docker-compose.yml` for Verdaccio
- `scripts/` layout and script contracts
- preview/stable publish flow
- CI-oriented non-interactive behavior

**Concerns:**
- manual `npm publish` steps are too error-prone for iterative prototyping
- preview publishing must validate real package artifacts, not workspace shortcuts
- the same scripts must work locally first and in CI later without being rewritten

---

## Overview

The `official-modules` repository needs a repeatable way to produce npm-like artifacts before stable publication. That requires more than a general note about Verdaccio. It needs repository-native infrastructure:

- a local registry service
- deterministic build scripts
- deterministic publish scripts
- non-interactive CI compatibility

This spec defines that infrastructure layer only.

It intentionally stops before consumer installation flows. Its job is to ensure that `official-modules` can produce preview and stable packages in a controlled, scriptable way.

> **Market Reference:** Modeled after package-maintainer workflows that use local npm-compatible registries and script-first release pipelines. Adopted: local Verdaccio service, pack-then-publish flow, non-interactive CI-ready scripts. Rejected: manual one-off shell commands as the primary workflow and direct `npm publish` from package folders without a shared wrapper.

---

## Problem Statement

Without dedicated registry and publish scripts inside `official-modules`, the team will run into four predictable problems:

1. **Manual publish drift**
   Different maintainers will build and publish packages in different ways, producing inconsistent artifacts.

2. **Workspace illusion**
   Modules may appear valid while running inside the monorepo, but the published tarball may miss files, exports, or build output.

3. **No reusable CI contract**
   If local prototype publishing is manual, CI later needs a second implementation rather than reusing trusted scripts.

4. **Prototype friction**
   Fast prototyping becomes expensive if every preview publish requires ad hoc npm commands, login steps, and build sequencing decisions.

The repository needs a narrow, well-defined infrastructure layer for registry-backed packaging and publication.

---

## Proposed Solution

Define `official-modules` with:

1. **A local Verdaccio service**
   Managed through repository `docker-compose.yml`.

2. **A script-first `scripts/` directory**
   Responsible for:
   - registry health checks
   - local registry user setup
   - build orchestration
   - tarball packing
   - preview publish
   - stable publish

3. **A single publish contract**
   Local development and future CI use the same scripts, differing only by environment variables and auth inputs.

4. **Artifact-first publishing**
   Scripts MUST publish packed tarballs, not raw workspace directories, so preview/stable flows validate the same shape consumers will install.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Repository-owned Verdaccio compose | Makes local preview publishing reproducible for every maintainer |
| `scripts/` as the single entrypoint | Avoids tribal knowledge and future CI duplication |
| Tarball-first publish flow | Validates actual package artifacts and resolved workspace dependencies |
| Separate preview vs stable scripts | Keeps prototyping and release semantics explicit |
| CI-ready non-interactive mode from day one | Prevents later rewrite of local scripts into pipeline-only variants |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Manual `npm publish` from package folders | Inconsistent, error-prone, and not CI-friendly |
| Only a README runbook with commands | Too easy to drift and too hard to automate later |
| Public npm used for prototypes | Too heavy for inner-loop development and noisy for release history |
| `npm link` instead of packed artifacts | Bypasses packaging validation entirely |

---

## User Stories / Use Cases

- **Module maintainer** wants one command to publish a preview build to a local registry so that they can prototype without touching public npm
- **Module maintainer** wants packaging to go through real tarballs so that missing files or bad exports fail early
- **CI maintainer** wants local and CI publication to use the same scripts so that release automation stays close to developer reality
- **Contributor** wants a local Verdaccio bootstrap path that works without reverse-engineering registry setup

---

## Architecture

### Repository Layout

```text
official-modules/
├── docker-compose.yml
├── scripts/
│   ├── build-packages.sh
│   ├── pack-packages.sh
│   ├── publish-preview.sh
│   ├── publish-stable.sh
│   └── registry/
│       ├── ping.sh
│       ├── setup-user.sh
│       └── whoami.sh
├── packages/
│   ├── _template/
│   ├── n8n-integration/
│   └── stripe-payments/
├── package.json
└── turbo.json
```

### Verdaccio Service

The repo MUST include a minimal `docker-compose.yml` entry for Verdaccio:

```yaml
services:
  verdaccio:
    image: verdaccio/verdaccio:5
    container_name: official-modules-verdaccio
    ports:
      - "4873:4873"
    volumes:
      - verdaccio_storage:/verdaccio/storage
      - verdaccio_conf:/verdaccio/conf
    environment:
      - VERDACCIO_APPDIR=/verdaccio
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:4873/-/ping"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  verdaccio_storage:
  verdaccio_conf:
```

Rules:

- local default URL is `http://localhost:4873`
- service name MUST be `verdaccio`
- scripts assume the standard ping endpoint `/-/ping`

### Script Contracts

#### `scripts/registry/ping.sh`

Purpose:

- verify registry is reachable before any publish action

Contract:

- reads `VERDACCIO_URL` or defaults to `http://localhost:4873`
- exits non-zero with clear error if registry is down

#### `scripts/registry/setup-user.sh`

Purpose:

- interactive local bootstrap for registry credentials

Contract:

- depends on `ping.sh`
- runs `npm adduser --registry "$VERDACCIO_URL"`
- skipped in CI

#### `scripts/registry/whoami.sh`

Purpose:

- verify auth status before non-interactive publish

Contract:

- depends on `ping.sh`
- runs `npm whoami --registry "$VERDACCIO_URL"`
- exits non-zero with actionable error if auth is missing

#### `scripts/build-packages.sh`

Purpose:

- build all publishable packages in the correct order

Contract:

- runs root package build pipeline
- MUST fail on first package build failure
- MUST be safe in both local and CI execution

Recommended implementation shape:

```bash
yarn build
```

or, if sandbox build is intentionally excluded from publish preparation:

```bash
yarn build:packages
```

The final choice belongs to repository implementation, but it MUST be one documented script, not tribal knowledge.

#### `scripts/pack-packages.sh`

Purpose:

- pack each publishable workspace into tarballs

Contract:

- removes stale tarballs first
- packs only non-private publishable packages
- emits tarballs into a deterministic temp/output directory
- fails if expected tarball for any target package is missing

Why this script exists:

- workspace dependencies must be materialized the same way they will be for consumers
- publish scripts should work from prepared tarballs rather than from mutable package folders

#### `scripts/publish-preview.sh`

Purpose:

- publish preview packages to local Verdaccio

Contract:

- depends on `registry/ping.sh`
- depends on `registry/whoami.sh` unless `CI=true` and token auth is provided
- depends on `build-packages.sh`
- depends on `pack-packages.sh`
- publishes to `VERDACCIO_URL`
- uses preview versioning and/or preview dist-tag

Preview semantics:

- preview builds MUST NOT overwrite stable versions
- preview builds SHOULD use either:
  - unique prerelease versions
  - stable version + `preview`/`prototype` dist-tag

#### `scripts/publish-stable.sh`

Purpose:

- publish stable packages using the same artifact-first pipeline

Contract:

- shares build/pack steps with preview flow
- target registry is configurable via `NPM_REGISTRY_URL`
- intended for future CI and release pipelines
- MUST remain callable locally for dry runs or private registry testing

### Package Selection Rules

The publish scripts MUST define how packages are selected. Allowed strategies:

1. publish all non-private packages
2. publish changed packages only
3. publish an explicit allowlist passed via CLI args

Initial recommended rule:

- local preview publish: allow package filter arg, fallback to all publishable packages
- stable publish: changed packages only once Changesets is wired

### CI Reuse Strategy

The same scripts SHOULD be reused in CI with different inputs:

| Flow | Script | Difference |
|------|--------|------------|
| Local preview | `publish-preview.sh` | interactive or local auth against Verdaccio |
| PR preview | `publish-preview.sh` | CI token auth, non-interactive |
| Stable release | `publish-stable.sh` | public registry token, non-interactive |

This spec deliberately keeps CI logic thin. Pipelines call scripts; scripts contain the publish logic.

---

## Data Models

This spec defines script and package contracts rather than runtime application entities.

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `VERDACCIO_URL` | `http://localhost:4873` | local preview registry |
| `NPM_REGISTRY_URL` | `https://registry.npmjs.org` | stable publish registry |
| `PREVIEW_DIST_TAG` | `preview` | preview dist-tag |
| `PUBLISH_PACKAGE_FILTER` | unset | optional package subset for preview publishing |
| `CI` | unset/false | enables non-interactive behavior |
| `NODE_AUTH_TOKEN` | unset | registry auth token for CI publishing |

### Publishable Package Contract

A package is publishable when:

- `package.json` is present
- `private` is absent or `false`
- build output exists
- required package metadata is valid

### Tarball Output Contract

Packed tarballs SHOULD be emitted into a deterministic directory, for example:

```text
.artifacts/packages/
```

This makes local debugging and CI artifact collection simpler.

---

## API Contracts

No application HTTP APIs are introduced. The external interfaces are repository scripts and Docker Compose commands.

### Repository Commands

| Command | Description |
|---------|-------------|
| `docker compose up -d verdaccio` | start local registry |
| `docker compose down` | stop local registry |
| `./scripts/registry/setup-user.sh` | create/login registry user locally |
| `./scripts/build-packages.sh` | build publishable packages |
| `./scripts/pack-packages.sh` | pack tarballs for publish |
| `./scripts/publish-preview.sh` | publish preview packages to Verdaccio |
| `./scripts/publish-stable.sh` | publish stable packages using same artifact contract |

### Package Script Wiring

The root `package.json` SHOULD expose convenient wrappers:

```json
{
  "scripts": {
    "registry:up": "docker compose up -d verdaccio",
    "registry:down": "docker compose down",
    "registry:setup-user": "./scripts/registry/setup-user.sh",
    "build:packages": "./scripts/build-packages.sh",
    "pack:packages": "./scripts/pack-packages.sh",
    "publish:preview": "./scripts/publish-preview.sh",
    "publish:stable": "./scripts/publish-stable.sh"
  }
}
```

### Integration Coverage Matrix

| Flow | Coverage Requirement |
|------|----------------------|
| Verdaccio service starts and answers `/-/ping` | Smoke test |
| `build-packages.sh` fails on build errors | Script test |
| `pack-packages.sh` emits tarballs for publishable packages | Script test |
| `publish-preview.sh` publishes to Verdaccio | Integration test |
| `publish-stable.sh` supports non-interactive mode | Script/integration test |
| CI reuses script entrypoints rather than duplicating logic | Review/contract requirement |

---

## Internationalization (i18n)

Not applicable. This is repository infrastructure and scripting.

---

## UI/UX

Not applicable in product UI. Developer UX goals are:

- one obvious command to start the registry
- one obvious command to publish preview packages
- deterministic output location for tarballs
- explicit failures instead of silent partial publishes

---

## Configuration

| Config | Default | Purpose |
|--------|---------|---------|
| `docker-compose.yml` Verdaccio port | `4873` | local npm-compatible registry |
| `.artifacts/packages/` | generated at runtime | tarball output directory |
| root `package.json` script aliases | required | stable script entrypoints for local and CI use |

---

## Migration & Compatibility

- No application database migrations are introduced
- This spec is additive to SPEC-062
- It does not define consumer install flows
- It does not define module registration in `src/modules.ts`
- It establishes infrastructure contracts that future CI and consumer specs depend on

### Compatibility Rules

| Contract | Rule |
|---------|------|
| Preview publish | MUST use tarball-first flow |
| Stable publish | SHOULD reuse the same build/pack steps as preview publish |
| Registry startup | MUST be possible with plain `docker compose up -d verdaccio` |
| CI usage | MUST be non-interactive when `CI=true` |

---

## Implementation Plan

### Phase 1 — Verdaccio Infrastructure

1. Add `docker-compose.yml` with `verdaccio` service
2. Add `scripts/registry/ping.sh`
3. Add `scripts/registry/setup-user.sh`
4. Add `scripts/registry/whoami.sh`

### Phase 2 — Build and Pack Scripts

1. Add `scripts/build-packages.sh`
2. Add `scripts/pack-packages.sh`
3. Define tarball output directory contract
4. Fail on stale/missing build artifacts

### Phase 3 — Publish Scripts

1. Add `scripts/publish-preview.sh`
2. Add `scripts/publish-stable.sh`
3. Add preview dist-tag/version policy
4. Add root `package.json` command aliases

### Phase 4 — CI Reuse

1. Ensure scripts support non-interactive auth
2. Keep workflow YAML thin and script-driven
3. Add smoke/integration checks for registry and preview publish

### File Manifest

| File | Repo | Action | Purpose |
|------|------|--------|---------|
| `docker-compose.yml` | official-modules | Create | local Verdaccio service |
| `scripts/registry/ping.sh` | official-modules | Create | registry health check |
| `scripts/registry/setup-user.sh` | official-modules | Create | local interactive auth bootstrap |
| `scripts/registry/whoami.sh` | official-modules | Create | auth verification |
| `scripts/build-packages.sh` | official-modules | Create | build publishable packages |
| `scripts/pack-packages.sh` | official-modules | Create | produce tarballs for publish |
| `scripts/publish-preview.sh` | official-modules | Create | preview publish to Verdaccio |
| `scripts/publish-stable.sh` | official-modules | Create | stable publish using same contract |
| `package.json` | official-modules | Modify/Create | script aliases |

### Testing Strategy

- Smoke test for Verdaccio startup and ping
- Script tests for build and pack steps
- Integration test for preview publish to local Verdaccio
- CI dry run or staging test for stable publish script

---

## Risks & Impact Review

### Data Integrity Failures

The main integrity risk is partial or malformed package publication.

Mitigation:

- tarball-first publish
- explicit build/pack failure checks
- deterministic artifact directory

### Cascading Failures & Side Effects

If publish scripts are wrong, every downstream prototype and CI flow inherits that error.

Mitigation:

- centralize logic in scripts, not workflow YAML
- test scripts directly

### Tenant & Data Isolation Risks

Not applicable. This spec covers local registry and package artifacts, not runtime tenant data.

### Migration & Deployment Risks

The main deployment risk is divergence between local preview and CI/stable publish logic.

Mitigation:

- same script entrypoints in local and CI flows
- environment variables only change auth/registry target, not the logical flow

### Operational Risks

- Verdaccio may be down or misconfigured locally
- maintainers may forget login/auth setup
- preview tags can be overwritten or become ambiguous

Mitigation:

- `ping.sh` and `whoami.sh` gate publish
- explicit preview version/dist-tag policy
- clear root script wrappers

### Risk Register

#### Manual Publish Drift Reappears

- **Scenario**: Maintainers bypass scripts and publish packages directly.
- **Severity**: Medium
- **Affected area**: preview reliability, CI parity
- **Mitigation**: documented script entrypoints and future CI reuse of the same scripts
- **Residual risk**: Medium

#### Tarball Packaging Omits Required Files

- **Scenario**: Package builds locally but tarball misses `dist` or required metadata.
- **Severity**: High
- **Affected area**: all preview consumers, future stable release
- **Mitigation**: `pack-packages.sh` validation and publish-from-tarball contract
- **Residual risk**: Low

#### CI and Local Publish Flows Diverge

- **Scenario**: CI uses custom YAML logic while local scripts use different steps.
- **Severity**: High
- **Affected area**: release reliability
- **Mitigation**: workflows invoke repository scripts instead of duplicating publish logic
- **Residual risk**: Low

#### Verdaccio Availability Blocks Prototyping

- **Scenario**: Local registry is down or unhealthy, preventing preview publishing.
- **Severity**: Low
- **Affected area**: local prototyping
- **Mitigation**: `docker compose up -d verdaccio` as the standard recovery path and health checks before publish
- **Residual risk**: Low

---

## Final Compliance Report — 2026-03-13

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/create-app/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Non-trivial infrastructure changes should be specified explicitly | Compliant | Dedicated Verdaccio/scripts spec created |
| `.ai/specs/AGENTS.md` | Full spec structure required | Compliant | All required sections included |
| packages/create-app/AGENTS.md | Standalone ecosystem relies on Verdaccio testing | Compliant | This spec defines the producer-side registry infrastructure that supports that workflow |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Scope stays on registry/build/publish only | Pass | Consumer install flows explicitly out of scope |
| Scripts are reusable in CI | Pass | Same script contract for local and CI |
| Publish flow validates artifacts, not workspaces | Pass | Tarball-first rule is explicit |
| Verdaccio setup is concrete enough to implement | Pass | `docker-compose.yml` and script contracts defined |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved as the infrastructure-focused Verdaccio and publish-scripts spec for `official-modules`.

---

## Out of Scope

- Installing preview packages into core repo
- Installing preview packages into standalone apps
- `src/modules.ts` registration flows
- Resolver changes for consuming external module packages
- Lifecycle management of installed modules

---

## References

- [package.json](/Users/dpalatynski/Private/open-mercato-latest/package.json)
- [scripts/registry/setup-user.sh](/Users/dpalatynski/Private/open-mercato-latest/scripts/registry/setup-user.sh)
- [scripts/registry/publish.sh](/Users/dpalatynski/Private/open-mercato-latest/scripts/registry/publish.sh)
- [scripts/release-snapshot.sh](/Users/dpalatynski/Private/open-mercato-latest/scripts/release-snapshot.sh)
- [packages/create-app/AGENTS.md](/Users/dpalatynski/Private/open-mercato-latest/packages/create-app/AGENTS.md)

---

## Changelog

### 2026-03-13

- Refocused the spec on local Verdaccio infrastructure and repository scripts only
- Added `docker-compose.yml` contract for the local registry
- Added build/pack/publish script contracts for future CI reuse
