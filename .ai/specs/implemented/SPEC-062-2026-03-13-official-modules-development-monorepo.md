# SPEC-062: Official Modules Development Monorepo

**Date:** 2026-03-13
**Status:** Draft
**Scope:** OSS — separate repository architecture for `open-mercato/official-modules`
**Author:** Open Mercato Team
**Related:** external draft `SPEC-060: Official Modules Marketplace Repository`, [SPEC-061-2026-03-13-official-modules-lifecycle-management.md](./SPEC-061-2026-03-13-official-modules-lifecycle-management.md)

---

## TLDR

**Key Points:**
- `official-modules` SHOULD be a separate Turborepo monorepo dedicated to developing and publishing optional Open Mercato modules
- Every published module is its own npm package, but each package MUST embed Open Mercato module source under `src/modules/<module_id>/`
- The repository MUST include a standalone sandbox app for real integration testing of packages exactly as end users consume them
- Default development targets published stable `@open-mercato/*` packages and a standalone sandbox app

**Scope:**
- repository structure and workspace layout
- single-package contract for official modules
- sandbox application for development and CI
- build, publish, and local testing workflow

**Concerns:**
- package naming and internal module IDs use different conventions and must not be conflated
- current CLI/resolver constraints require a package layout that differs from the flat `src/` sketch in external SPEC-060

---

## Overview

The official modules effort needs its own repository, but not merely as a place to store code. It needs a developer-facing monorepo that supports:

- isolated module development outside the main Open Mercato monolith
- package-by-package publishing
- realistic testing in a standalone app
- compatibility with the current CLI resolver, generator, and `eject` behavior

This spec defines how that repository should be structured and operated.

It complements external SPEC-060 by focusing on repository architecture and daily development workflow, not on user-facing `module add` lifecycle flows.

> **Market Reference:** Modeled after Turborepo package workspaces, Changesets-based release management, and shadcn-style source ownership. Adopted: multi-package monorepo, sandbox app, per-package versioning, source-preserving publish. Rejected: git submodule to the main repo, flat single-package repository, and local file-linking as the primary development model.

---

## Problem Statement

Without an explicit repository architecture, `official-modules` will drift into one of three bad states:

1. **Package layout incompatible with current CLI**
   The current resolver and `eject` logic expect modules inside `src/modules/<module_id>/`. A flat package layout will publish successfully but fail in real apps.

2. **Development environment unlike production**
   If modules are tested only inside a source-linked monorepo, issues with published artifacts, exports, or generated files will be missed until users install them.

3. **No stable workflow for core compatibility**
   Module authors need one default workflow against stable published core packages and one explicit fallback workflow for unreleased core changes.

4. **Naming inconsistency leaks into runtime**
   npm package names are naturally kebab-case, but Open Mercato module IDs are snake_case/plural. Without a contract, packages, module IDs, and folder names will diverge and break discovery.

The repo must encode the correct conventions instead of relying on tribal knowledge.

---

## Proposed Solution

Create `open-mercato/official-modules` as a dedicated Turborepo monorepo with three core building blocks:

1. **Package workspaces for publishable modules**
   Each module lives in `packages/<package-folder>/` and is published independently as `@open-mercato/module-<name>`.

2. **A standalone sandbox app**
   `apps/sandbox/` is a real standalone Open Mercato app used for local development, CI smoke tests, and preview validation.

3. **A source-preserving package contract**
   Published packages include:
   - compiled runtime output in `dist/`
   - module source in `src/modules/<module_id>/` for `eject`
   - deep subpath exports compatible with current import rewriting

This keeps the developer workflow close to what end users actually install, while still supporting fast workspace iteration inside the repository.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Separate repository | Keeps optional/community module work decoupled from core release cadence |
| Turborepo monorepo | Supports multiple publishable packages plus shared tooling and sandbox app |
| Standalone sandbox | Validates published-package behavior, not only source-linked workspace behavior |
| Package names in kebab-case, module IDs in snake_case | Preserves npm conventions and Open Mercato module conventions simultaneously |
| Stable npm core by default | Makes module repo independently reproducible |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Git submodule to main repo | Reintroduces tight coupling and confusing dependency ownership |
| Flat repo with one module per repo | Too much overhead for shared tooling, CI, and sandbox maintenance |
| Flat package `src/` layout | Incompatible with current CLI resolver and `eject` expectations |
| `npm link` as primary workflow | Too environment-sensitive and unlike real npm consumption |

---

## User Stories / Use Cases

- **Module maintainer** wants to build and test a module in isolation so that optional functionality can evolve outside the core repo
- **Module maintainer** wants to run one sandbox app against workspace packages so that integration issues are caught before publish
- **Community contributor** wants a template and deterministic repository structure so that new modules follow the same conventions as official ones

---

## Architecture

### Repository Layout

```text
official-modules/
├── apps/
│   └── sandbox/
│       ├── src/
│       │   └── modules.ts
│       ├── package.json
│       └── .env.example
├── packages/
│   ├── _template/
│   │   ├── src/modules/example_module/
│   │   ├── build.mjs
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── n8n-integration/
│   │   ├── src/modules/n8n_integration/
│   │   ├── build.mjs
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── stripe-payments/
│       └── ...
├── scripts/
│   ├── sync-sandbox-modules.mjs
│   ├── publish-preview.mjs
│   └── validate-package-layout.mjs
├── .changeset/
├── .github/workflows/
├── turbo.json
├── tsconfig.base.json
└── package.json
```

### Naming Contract

The repository MUST distinguish three different names:

| Concern | Example | Convention |
|---------|---------|------------|
| npm package name | `@open-mercato/module-n8n-integration` | kebab-case |
| package folder | `packages/n8n-integration` | kebab-case |
| Open Mercato module ID | `n8n_integration` | snake_case, plural rules when applicable |

Rule:

- package names follow npm conventions
- runtime module IDs follow Open Mercato conventions from root `AGENTS.md`
- package folder name does not need to equal module ID

### Single Package Contract

Every publishable module package MUST look like this:

```text
packages/n8n-integration/
├── src/
│   └── modules/
│       └── n8n_integration/
│           ├── index.ts
│           ├── acl.ts
│           ├── setup.ts
│           ├── events.ts
│           ├── api/
│           ├── backend/
│           ├── data/
│           └── widgets/
├── dist/
│   └── modules/
│       └── n8n_integration/
│           └── ...
├── build.mjs
├── package.json
└── tsconfig.json
```

Why both `src/` and `dist/`:

- `src/modules/...` is needed for `eject` and source inspection
- `dist/modules/...` is needed for standalone generator/runtime compatibility

### Package Export Contract

Package exports MUST support deep imports, because cross-module import rewrites may produce paths such as:

```ts
@open-mercato/module-n8n-integration/modules/n8n_integration/data/entities
```

Therefore each package SHOULD expose wildcard exports similar to core Open Mercato packages:

- `.`
- `./*`
- `./*/*`
- `./*/*/*`
- deeper patterns as needed

### Sandbox App Contract

`apps/sandbox/` is a standalone app inside the repo, not a source-only demo.

It MUST:

- use the same package-manager install flow as a real standalone app
- register module packages in `src/modules.ts`
- run `yarn mercato generate all`
- be able to `next build`
- exercise at least one enabled official module at runtime

Recommended bootstrap path:

```bash
npx create-mercato-app sandbox
```

Then move or generate that app under `apps/sandbox/` and adapt its `src/modules.ts`, package dependencies, and CI scripts to the `official-modules` repository contract.

Example `src/modules.ts` entry:

```ts
{ id: 'n8n_integration', from: '@open-mercato/module-n8n-integration' }
```

### Dependency Strategy

Default strategy:

- `apps/sandbox` depends on published stable `@open-mercato/*` packages
- module packages depend on published stable `@open-mercato/*` packages

This keeps the repository reproducible and aligned with how end users consume published modules.

### Development Modes

#### Mode A — Normal Module Development

Use when developing official modules against the latest stable Open Mercato release.

Flow:

1. edit module package source
2. build package
3. install/update workspace package in sandbox
4. run `yarn mercato generate all`
5. run sandbox dev/build/tests

---

## Data Models

This spec introduces repository/package contracts rather than application entities.

### Module Package `package.json`

```json
{
  "name": "@open-mercato/module-n8n-integration",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js",
    "./*": {
      "types": "./src/*.ts",
      "default": "./dist/*.js"
    },
    "./*/*": {
      "types": "./src/*/*.ts",
      "default": "./dist/*/*.js"
    },
    "./*/*/*": {
      "types": "./src/*/*/*.ts",
      "default": "./dist/*/*/*.js"
    },
    "./*/*/*/*": {
      "types": "./src/*/*/*/*.ts",
      "default": "./dist/*/*/*/*.js"
    }
  },
  "files": [
    "dist",
    "src/modules",
    "package.json",
    "README.md"
  ],
  "keywords": ["open-mercato-module"],
  "open-mercato": {
    "displayName": "n8n Integration",
    "moduleId": "n8n_integration",
    "ejectable": true,
    "minCoreVersion": "0.14.0"
  }
}
```

### Root `package.json`

The root repo package file SHOULD declare:

- workspaces for `apps/*` and `packages/*`
- turbo scripts for build/test/dev
- changesets scripts for release
- helper scripts for sandbox sync and preview publish

### Sandbox `src/modules.ts`

This file remains the runtime source of enabled module entries. The repository may generate or assist updates to it, but it remains a real app-level file.

---

## API Contracts

No application HTTP APIs are introduced by this spec. The external contracts are repository commands and CI flows.

### Repository Commands

| Command | Purpose |
|---------|---------|
| `yarn build` | Build all module packages and supporting tooling |
| `yarn test` | Run package-level tests |
| `yarn sandbox:generate` | Run `mercato generate all` in sandbox |
| `yarn sandbox:dev` | Start sandbox development server |
| `yarn sandbox:build` | Build sandbox as CI smoke test |
| `yarn changeset` | Create release notes/version intent |
| `yarn publish:preview` | Publish preview versions for PR validation |
| `yarn publish:stable` | Publish stable versions after merge |

### CI Contract

PR pipeline MUST:

1. install dependencies
2. build all packages
3. run unit tests
4. validate package layout contract
5. install or wire packages into sandbox
6. run `yarn mercato generate all` in sandbox
7. run sandbox build
8. optionally publish preview versions

Main branch release pipeline MUST:

1. verify Changesets state
2. publish changed packages
3. make packages discoverable through npm metadata
4. fail loudly on partial publish errors

### Integration Coverage Matrix

| Flow | Coverage Requirement |
|------|----------------------|
| build one module package | Unit/build test |
| sandbox resolves one workspace module | Integration test |
| sandbox `mercato generate all` after package change | Integration test |
| package exports support deep import paths | Contract test |
| preview publish installs in clean sandbox | CI smoke test |

---

## Internationalization (i18n)

Not applicable. This spec defines repository and package-development structure, not app UI.

---

## UI/UX

Not applicable in the product UI. The relevant developer UX requirements are:

- one-command sandbox generate/build
- predictable package naming
- deterministic template for new module packages
- explicit scripts instead of undocumented shell recipes

---

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `NPM_REGISTRY_URL` | `https://registry.npmjs.org` | Registry used for stable package resolution |
| `PREVIEW_NPM_TAG` | `preview` | Dist-tag for PR preview publishes |
| `SANDBOX_APP_URL` | `http://localhost:3000` | Sandbox runtime URL in local dev |

---

## Migration & Compatibility

- No runtime database migrations are introduced by this repository architecture
- The repository contract is additive relative to external SPEC-060
- The package layout is intentionally constrained by the current CLI resolver and `eject` implementation
- Package naming and module ID mapping MUST be documented in the template to avoid future drift

### Compatibility Rules

| Contract | Rule |
|---------|------|
| Package layout | MUST publish `src/modules/<module_id>` and `dist/modules/<module_id>` |
| Module ID | MUST remain Open Mercato-compatible snake_case/plural naming |
| Package exports | MUST support deep module imports |
| Sandbox app | MUST behave like a standalone app, not a monorepo shortcut |

---

## Implementation Plan

### Phase 1 — Repository Skeleton

1. Initialize Turborepo root
2. Add root workspace config, turbo config, and TypeScript base config
3. Create `apps/sandbox` from `npx create-mercato-app sandbox`
4. Create `packages/_template`
5. Create first reference module package

### Phase 2 — Package Contract Tooling

1. Add shared `build.mjs` pattern for module packages
2. Add layout validation script
3. Add template `package.json` and exports contract
4. Add module ID vs package-name validation

### Phase 3 — Sandbox Workflow

1. Register reference module in sandbox `src/modules.ts`
2. Add `sandbox:generate`, `sandbox:dev`, `sandbox:build`
3. Ensure sandbox uses real `mercato` CLI path and standalone behavior
4. Add smoke tests for generate/build

### Phase 4 — Release Workflow

1. Configure Changesets
2. Add preview publish script and workflow
3. Add stable publish workflow

### File Manifest

| File | Repo | Action | Purpose |
|------|------|--------|---------|
| `package.json` | official-modules | Create | workspace root scripts and metadata |
| `turbo.json` | official-modules | Create | task orchestration |
| `tsconfig.base.json` | official-modules | Create | shared TypeScript settings |
| `apps/sandbox/package.json` | official-modules | Create | standalone sandbox app |
| `apps/sandbox/src/modules.ts` | official-modules | Create | sandbox module registration |
| `packages/_template/package.json` | official-modules | Create | starter package contract |
| `packages/_template/src/modules/example_module/index.ts` | official-modules | Create | reference module layout |
| `scripts/validate-package-layout.mjs` | official-modules | Create | enforce layout/exports rules |
| `.github/workflows/ci.yml` | official-modules | Create | package build + sandbox smoke tests |
| `.github/workflows/publish.yml` | official-modules | Create | stable package publishing |

### Testing Strategy

- Unit tests for package contract validators
- Contract tests for deep package exports
- Sandbox integration test for `mercato generate all`
- Sandbox smoke build in CI

---

## Risks & Impact Review

### Data Integrity Failures

This repository architecture mainly manages source and build artifacts, not business data. The main integrity risk is publishing malformed package contents or stale build output.

Mitigation:

- CI validates layout before preview/stable publish
- sandbox build uses published-style artifacts, not only source files

### Cascading Failures & Side Effects

A broken package export or missing `dist/modules` output can break:

- sandbox generation
- standalone installs
- `eject`
- deep imports rewritten by CLI

Mitigation:

- contract tests on exports
- mandatory sandbox generate/build in CI

### Tenant & Data Isolation Risks

Not applicable directly. This is repository tooling, not tenant-scoped runtime logic.

### Migration & Deployment Risks

The main deployment risk is coupling the module repo too tightly to assumptions from the main Open Mercato monorepo.

Mitigation:

- stable npm core remains the default path

### Operational Risks

- preview publish can diverge from stable npm setup
- sandbox app can drift from real standalone template expectations
- package naming drift can create hard-to-debug generator failures

Mitigation:

- periodic sync against `create-mercato-app` template expectations
- validation script for naming/layout
- documented contributor template

### Risk Register

#### Package Layout Drifts From CLI Contract

- **Scenario**: A module package publishes flat `src/` or omits `src/modules/<module_id>`.
- **Severity**: High
- **Affected area**: standalone installs, `eject`, generator discovery
- **Mitigation**: layout validation in CI and template-enforced structure
- **Residual risk**: Low

#### Package Name and Module ID Diverge Incorrectly

- **Scenario**: Package name uses one identifier while `open-mercato.moduleId`, folder path, and sandbox registration use another.
- **Severity**: High
- **Affected area**: module discovery, imports, runtime enablement
- **Mitigation**: explicit naming contract and validator script
- **Residual risk**: Low

#### Sandbox Stops Reflecting Real Standalone Behavior

- **Scenario**: Sandbox is optimized for workspace shortcuts and no longer catches published-package issues.
- **Severity**: Medium
- **Affected area**: CI confidence, preview validation
- **Mitigation**: sandbox must run `mercato generate all` and consume package artifacts through standalone-compatible paths
- **Residual risk**: Medium

---

## Final Compliance Report — 2026-03-13

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/shared/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Separate repo/package concerns cleanly | Compliant | Spec keeps external module packages outside core monorepo |
| root AGENTS.md | Module IDs follow platform naming conventions | Compliant | Explicit package-name vs module-id mapping |
| packages/cli/AGENTS.md | Standalone behavior must remain compatible with generated discovery | Compliant | Package layout aligns with current resolver/eject expectations |
| packages/create-app/AGENTS.md | Standalone apps must be tested realistically | Compliant | Sandbox app is a required contract, not optional demo |
| `.ai/specs/AGENTS.md` | Non-trivial spec must include full structure | Compliant | All required sections included |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Repository layout matches current CLI constraints | Pass | `src/modules/<module_id>` and `dist/modules/<module_id>` required |
| Naming contract is explicit | Pass | Separates package name, package folder, and module ID |
| Sandbox mirrors standalone expectations | Pass | Uses standalone app model and CLI generation flow |
| Risks cover packaging and workflow failures | Pass | Layout, exports, and sandbox drift covered |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved as the repository-architecture companion spec for official modules. It provides the missing developer-workflow layer around external SPEC-060.

---

## Out of Scope

- End-user `module add/list/upgrade` CLI UX
- Backend marketplace browser
- Paid/licensed module distribution
- Cryptographic provenance/signature verification
- Detailed module lifecycle state management inside consuming apps
- Cross-repo development against unreleased core snapshots

---

## References

- [packages/cli/src/lib/resolver.ts](/Users/dpalatynski/Private/open-mercato-latest/packages/cli/src/lib/resolver.ts)
- [packages/cli/src/lib/eject.ts](/Users/dpalatynski/Private/open-mercato-latest/packages/cli/src/lib/eject.ts)
- [packages/create-app/AGENTS.md](/Users/dpalatynski/Private/open-mercato-latest/packages/create-app/AGENTS.md)
- [packages/create-app/template/src/modules.ts](/Users/dpalatynski/Private/open-mercato-latest/packages/create-app/template/src/modules.ts)

---

## Changelog

### 2026-03-13

- Initial draft for `official-modules` repository architecture
- Added strict package layout contract aligned with current CLI behavior
- Added sandbox app, naming contract, and stable package-based development workflow
