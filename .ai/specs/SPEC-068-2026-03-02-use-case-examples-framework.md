# SPEC-068: Use-Case Examples Framework

| Field | Value |
|-------|-------|
| **Status** | Active |
| **Author** | Open Mercato Team & Partners |
| **Created** | 2026-03-02 |
| **Related** | SPEC-013 (setup.ts), SPEC-041 (UMES), SPEC-045 (registry pattern), SPEC-051 (Partnership Portal), SPEC-053 (B2B PRM) |

## TLDR
**Key Points:**
- Introduce a first-class "example" layer so engineers can bootstrap a polished use-case solution (like a B2B PRM or B2B Quotes system) with a single command instead of a blank tenant.
- Examples are **not** part of the Open Mercato core repository. Official examples live in a **separate GitHub repository** `open-mercato/ready-apps` (alongside `open-mercato/open-mercato`); community examples live in their own repos.
- Bootstrap via `create-mercato-app --example <name|url>`, adopting the same pattern as `create-next-app --example`.
- Preserve UMES and module boundaries: all vertical behavior is delivered via app modules, setup hooks, widgets, enrichers, and events, built within the example's own `src/modules` structure.

**Scope:**
- Example definition and distribution model (external to core).
- `--example` flag for `create-mercato-app` CLI.
- Fetch mechanism and repository structure.

**Concerns:**
- Keep the core absolutely clean of specific business logic or use-case configurations.
- Ensure extensions built for examples fully leverage the Universal Mercato Extension System (UMES).

## Overview
Open Mercato needs productized "ready projects" that reduce time-to-first-value for common B2B use cases (for example PRM, field service, marketplace ops). Today, teams start from a generic tenant and manually assemble modules, dictionaries, workflows, and role settings.

This spec defines a framework to package those decisions into reusable examples while keeping the core platform entirely agnostic.

> **Market Reference:** Modeled after `create-next-app --example`, which lets developers bootstrap from official examples in the Next.js monorepo or from any public GitHub URL. Adopted: `--example` flag, GitHub tarball fetch, centralized official examples repo + community URL support. Rejected: custom CLI commands (`mercato init --starter`), npm-only distribution, manual clone-and-copy workflow.

## Problem Statement
Without an examples framework:
- each implementation repeats the same setup work,
- demo and pilot environments are inconsistent across teams,
- reuse is ad hoc and hard to maintain,
- sales-to-delivery handoff has no standard baseline.

If examples were integrated into the core:
- the core repository would become bloated with specific, niche configurations.
- the maintenance burden on the core team would increase dramatically.
- partner agencies would lack ownership over the specific vertical solutions they create.

The business goal is to turn repeated delivery patterns into reusable assets owned by the ecosystem, while keeping core evolution safe and lean.

## Proposed Solution
Implement a Use-Case Examples framework with two tiers:

1. **The Core Engine**: `open-mercato/core` and `create-mercato-app` remain agnostic and clean.
2. **Official Examples**: Maintained by the Open Mercato team in a **separate GitHub repository** `open-mercato/ready-apps` (sibling to `open-mercato/open-mercato`), each example as a subdirectory.
3. **Community Examples**: Maintained by partners/agencies in their own GitHub repositories.
4. **The Bootstrap Flow**: `create-mercato-app --example <name|url>` fetches the example via GitHub API tarball and scaffolds a ready-to-run app.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Examples live outside the core repository | Keeps core clean, reduces bloat, delegates domain ownership to partners/agencies. |
| Official examples centralized in `open-mercato/ready-apps` | Easier maintenance and discoverability, same pattern as `vercel/next.js/examples`. |
| Community examples in independent repos | Partners/agencies own their vertical solutions fully. |
| `--example` flag on `create-mercato-app` | Industry-standard UX from `create-next-app`; single-command bootstrap. |
| Each example is a complete, runnable app | No merge complexity; each example includes the full scaffold plus domain modules. |
| GitHub API tarball fetch | No git dependency required; proven mechanism from `create-next-app`. |
| No new runtime extension model | Reuse UMES, events, setup.ts, entity extensions within the deployed application. |
| App-level ownership for business-specific behavior | Matches monorepo rule: user-specific features live in the generated app's `src/modules`. |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| `mercato init --starter` CLI command | Adds core CLI complexity for something that belongs at scaffold time |
| Delta/overlay on top of bare scaffold | Merge conflicts, version coupling, and complex implementation |
| NPM-only distribution | "Black-box" packages restrict customization of complex business logic |
| Manual two-step flow (scaffold then copy) | Poor DX, error-prone, unnecessary friction |
| Each example in its own repo | Too much overhead for official examples; community examples still use this model |

### What This Spec Explicitly Avoids
- No example configurations committed to the `open-mercato/open-mercato` core repository.
- No direct cross-module ORM relationships inside the core.
- No use-case-specific KPI ownership or API logic in the core frameworks.

## User Stories / Use Cases
- An Engineer wants to bootstrap a new B2B PRM application. They run `npx create-mercato-app my-prm --example b2b-prm` and get a complete, demo-ready PRM app.
- An Engineer wants to use a community example. They run `npx create-mercato-app my-app --example https://github.com/some-agency/their-example`.
- A Partner Agency wants to distribute their specialized marketplace workflows. They maintain a GitHub repository with a complete Open Mercato app that includes their UMES extensions, widgets, and seeds.
- An Engineer wants a blank app with no example. They run `npx create-mercato-app my-app` (unchanged behavior).

## Architecture

### CLI Interface

New flag for `create-mercato-app`: `--example` (alias `-e`)

```bash
# Official example — fetches from open-mercato/ready-apps repo
npx create-mercato-app my-prm --example b2b-prm

# Community example — fetches from any public GitHub repo
npx create-mercato-app my-app --example https://github.com/some-agency/their-example

# No example — current behavior (bare scaffold)
npx create-mercato-app my-app
```

Resolution logic:
- Plain name (e.g., `b2b-prm`) → fetches the `b2b-prm/` subdirectory from `open-mercato/ready-apps` GitHub repo
- URL → fetches the full repo at that URL

Backward compatibility: the no-flag invocation remains unchanged. `--example` is purely additive. Existing `--registry` and `--verdaccio` flags continue to work for npm package resolution.

### Repository Structure

Official examples live in `open-mercato/ready-apps`:

```text
examples/
├── b2b-prm/                  # Complete standalone app
│   ├── src/modules/           # PRM-specific modules
│   ├── package.json
│   ├── .env.example
│   └── ...
├── README.md                  # Index of available examples
└── package.json               # Minimal root
```

Each example subdirectory is a **complete, runnable app** — the full `create-mercato-app` scaffold with domain modules pre-installed.

### Fetch Mechanism

Uses GitHub API tarball download (same approach as `create-next-app`):

- Official: `GET https://api.github.com/repos/open-mercato/ready-apps/tarball/main` → extract subdirectory
- Community: `GET https://api.github.com/repos/{owner}/{repo}/tarball/{branch}` → extract full repo
- No git dependency required

Examples use the same `.template` file convention and placeholder set (`{{APP_NAME}}`, `{{PACKAGE_VERSION}}`, `{{REGISTRY_CONFIG}}`) as the bare scaffold.

### Reference Flow
```text
developer runs `npx create-mercato-app my-b2b-app --example b2b-prm` →
create-mercato-app fetches b2b-prm/ from open-mercato/ready-apps via GitHub API tarball →
extracts to target directory, runs placeholder substitution →
agentic setup wizard runs →
developer runs `yarn install` → `yarn initialize` (setup.ts hooks run seedDefaults/seedExamples) →
app is ready with domain baseline.
```

### Error Handling
- Example name not found in the tarball: clear error listing available examples
- GitHub API unreachable / 404: error with suggestion to check network or URL
- Private repo without auth: error suggesting `GITHUB_TOKEN` env var for authenticated requests
- Community URL pointing to non-existent repo: clear "repository not found" error

### Non-Negotiable Architecture Guardrails
1. Example modules extend host surfaces only through UMES and documented core contracts.
2. Example implementation lives completely outside the OM core repository.
3. The Open Mercato platform provides the extension points (hooks, enrichers, registries), but not the business configuration for examples.

## Data Models

Not applicable. This spec defines distribution and bootstrap infrastructure, not application entities.

## API Contracts

Not applicable. No application HTTP APIs are introduced. The external contract is the `--example` CLI flag.

## Implementation Details

Because examples are external complete apps, there is no centralized database table required in the core engine. The "installation status" of an example is simply the presence of its modules and configurations within the application codebase.

The standard `yarn initialize` (which triggers module hooks defined in `setup.ts`) is sufficient to bootstrap the application after scaffolding.

## Versioning

Each example declares compatible core versions through `@open-mercato/*` dependency versions in its `package.json`. No separate version tracking needed.

## Migration & Compatibility
- Examples (being separate codebases) define their compatibility via `@open-mercato/*` dependency versions in `package.json`.
- Core APIs guarantee semantic versioning, allowing example maintainers to update their apps accordingly.
- The `open-mercato/ready-apps` repo should have CI that validates each example still builds against current core versions.
- Backward compatible: `create-mercato-app` without `--example` continues to work exactly as before.

## Implementation Plan

### Phase 1 — CLI Flag
1. Add `--example` / `-e` flag to `create-mercato-app` argument parser.
2. Implement GitHub API tarball fetch and subdirectory extraction.
3. Implement URL detection (plain name vs GitHub URL).
4. Add error handling for missing examples, network failures, private repos.

### Phase 2 — Examples Repository
1. Create `open-mercato/ready-apps` repository.
2. Add B2B PRM as first official example (`b2b-prm/`).
3. Add CI to validate each example builds.
4. Add README with index of available examples.

### File Manifest

| File | Repo | Action | Purpose |
|------|------|--------|---------|
| `packages/create-app/src/index.ts` | open-mercato | Modify | Add `--example` flag, fetch logic |
| `packages/create-app/AGENTS.md` | open-mercato | Modify | Document `--example` flag |
| `examples/b2b-prm/` | open-mercato/ready-apps | Create | First official example |
| `README.md` | open-mercato/ready-apps | Create | Example index and usage docs |
| `.github/workflows/ci.yml` | open-mercato/ready-apps | Create | Validate examples build |

### Testing Strategy
- Unit: URL parsing, name resolution, tarball extraction
- Integration: end-to-end `create-mercato-app --example` with a test fixture
- CI on examples repo: each example must `yarn install && yarn generate && yarn build`

## Risks & Impact Review

### Migration & Deployment Risks

#### CLI flag breaks existing create-mercato-app usage
- **Scenario**: Adding `--example` flag conflicts with existing argument parsing.
- **Severity**: Low
- **Affected area**: `create-mercato-app` CLI
- **Mitigation**: `--example` is purely additive; existing flags and no-flag behavior unchanged.
- **Residual risk**: Negligible

### Operational Risks

#### GitHub API rate limiting blocks example fetch
- **Scenario**: Unauthenticated GitHub API calls hit rate limits during workshop/training events.
- **Severity**: Medium
- **Affected area**: `create-mercato-app --example` bootstrap
- **Mitigation**: Support `GITHUB_TOKEN` env var for authenticated requests; clear error message on rate limit.
- **Residual risk**: Low with token usage

#### Official examples drift from core compatibility
- **Scenario**: Core packages update but examples repo is not updated, causing build failures for new users.
- **Severity**: Medium
- **Affected area**: Developer onboarding experience
- **Mitigation**: Periodic CI on examples repo; Dependabot for `@open-mercato/*` dependency updates.
- **Residual risk**: Medium — requires active maintenance

## Final Compliance Report — 2026-03-18

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/create-app/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Starters/examples live outside core repository | Compliant | Examples in `open-mercato/ready-apps`, not in core |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | N/A — framework spec, not entity spec |
| packages/create-app/AGENTS.md | MUST NOT break the standalone app template | Compliant | `--example` is additive; bare scaffold unchanged |
| packages/create-app/AGENTS.md | CLI commands are STABLE contract surface | Compliant | Additive flag, no breaking changes |
| .ai/specs/AGENTS.md | Non-trivial spec must include full structure | Compliant | All required sections included |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| CLI interface matches fetch mechanism | Pass | `--example` resolves to tarball fetch for both official and community |
| Repository structure matches fetch logic | Pass | Subdirectory extraction for official, full repo for community |
| Error handling covers failure modes | Pass | Network, 404, rate limit, private repo covered |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved as the examples framework spec.

## Changelog

### 2026-03-20
- Official examples repository changed from `open-mercato/examples` to `open-mercato/ready-apps` (decided after team evaluation).
- Removed superseded SPEC-062 (Use-Case Starters Framework).
- Status changed from Draft to Active.

### 2026-03-18
- Renumbered from SPEC-062 to SPEC-068 to resolve numbering conflict with PR #1003 (Official Modules, SPEC-061–067).
- Renamed concept from "starters" to "examples" to align with industry-standard terminology (`create-next-app --example`).
- Added `--example` flag as the official bootstrap mechanism, replacing the manual two-step scaffold-then-copy flow.
- Added `open-mercato/ready-apps` centralized repository for official examples.
- Added GitHub API tarball fetch mechanism.
- Added error handling, versioning, and testing strategy.
- Added compliance report.

### 2026-03-17
- Renumbered from SPEC-061 to SPEC-062 to resolve numbering conflict with PR #1003.

### 2026-03-02
- Initial specification.
