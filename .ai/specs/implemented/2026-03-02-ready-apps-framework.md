# Ready Apps Framework

| Field | Value |
|-------|-------|
| **Status** | Active |
| **Author** | Open Mercato Team & Partners |
| **Created** | 2026-03-02 |
| **Related** | SPEC-013 (setup.ts), SPEC-041 (UMES), SPEC-045 (registry pattern), SPEC-051 (Partnership Portal), SPEC-053 (B2B PRM) |

## TLDR
**Key Points:**
- Introduce a first-class "ready app" layer so engineers can bootstrap a polished use-case solution (like a B2B PRM or B2B Quotes system) with a single command instead of a blank tenant.
- Ready apps are **not** part of the Open Mercato core repository. Each official ready app lives in its **own GitHub repository** under the `open-mercato` organization, using the naming convention `ready-app-<appname>`.
- Bootstrap via `create-mercato-app --app <name>` for official Open Mercato ready apps and `create-mercato-app --app-url <github-url>` for external GitHub-hosted ready apps.
- Preserve UMES and module boundaries: all vertical behavior is delivered via app modules, setup hooks, widgets, enrichers, and events, built within the ready app's own `src/modules` structure.

**Scope:**
- Ready app definition and distribution model (external to core).
- `--app` and `--app-url` flags for `create-mercato-app`.
- GitHub repository naming and fetch mechanism.

**Concerns:**
- Keep the core absolutely clean of specific business logic or use-case configurations.
- Ensure extensions built for ready apps fully leverage the Universal Mercato Extension System (UMES).

## Overview
Open Mercato needs productized "ready projects" that reduce time-to-first-value for common B2B use cases such as PRM, field service, or marketplace ops. Today, teams start from a generic tenant and manually assemble modules, dictionaries, workflows, and role settings.

This spec defines a framework to package those decisions into reusable ready apps while keeping the core platform entirely agnostic.

> **Market Reference:** Inspired by source-first scaffolders in the JavaScript ecosystem, but adapted to Open Mercato's ecosystem and ownership model. Adopted: `--app`, `--app-url`, GitHub tarball fetch, and one official ready app per repository. Rejected: centralized official catalog repo, npm-only distribution, manual clone-and-copy workflow.

## Problem Statement
Without a ready apps framework:
- each implementation repeats the same setup work,
- demo and pilot environments are inconsistent across teams,
- reuse is ad hoc and hard to maintain,
- sales-to-delivery handoff has no standard baseline.

If ready apps were integrated into the core:
- the core repository would become bloated with specific, niche configurations,
- the maintenance burden on the core team would increase dramatically,
- partner agencies would lack ownership over the specific vertical solutions they create.

The business goal is to turn repeated delivery patterns into reusable assets owned by the ecosystem, while keeping core evolution safe and lean.

## Proposed Solution
Implement a Ready Apps framework with two tiers:

1. **The Core Engine**: `open-mercato/core` and `create-mercato-app` remain agnostic and clean.
2. **Official Ready Apps**: Maintained by the Open Mercato team in **separate GitHub repositories** under the `open-mercato` organization, one repository per app, named `ready-app-<appname>`.
3. **External Ready Apps**: Maintained by partners/agencies in their own GitHub repositories.
4. **The Bootstrap Flow**: `create-mercato-app --app <name>` fetches an official Open Mercato repository; `create-mercato-app --app-url <url>` fetches an external GitHub repository and scaffolds a ready-to-run app.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Ready apps live outside the core repository | Keeps core clean, reduces bloat, delegates domain ownership to partners/agencies. |
| Official ready apps use one repo per app | Preserves clear ownership, release cadence, CI, and issue tracking per app. |
| Official repo naming is `ready-app-<appname>` | Makes CLI resolution deterministic and keeps organization-level discovery simple. |
| External ready apps remain independent GitHub repos | Partners/agencies own their vertical solutions fully. |
| `--app` flag on `create-mercato-app` | Single-command bootstrap for official Open Mercato maintained ready apps. |
| `--app-url` flag on `create-mercato-app` | Explicit path for external GitHub-hosted ready apps without overloading one flag. |
| Each ready app is a complete, runnable app | No merge complexity; each app includes the full scaffold plus domain modules. |
| GitHub API tarball fetch | No git dependency required; proven mechanism for scaffold tools. |
| No new runtime extension model | Reuse UMES, events, setup.ts, entity extensions within the deployed application. |
| App-level ownership for business-specific behavior | Matches monorepo rule: user-specific features live in the generated app's `src/modules`. |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Centralized official repo such as `open-mercato/ready-apps` | Couples unrelated apps into one release surface and one CI pipeline; ownership is less clear. |
| Single overloaded source flag for both official and external sources | Less explicit than separating official-name lookup from direct external URL fetch. |
| NPM-only distribution | "Black-box" packages restrict customization of complex business logic. |
| Manual two-step flow (scaffold then copy) | Poor DX, error-prone, unnecessary friction. |
| Delta/overlay on top of bare scaffold | Merge conflicts, version coupling, and complex implementation. |

### What This Spec Explicitly Avoids
- No ready app configurations committed to the `open-mercato/open-mercato` core repository.
- No direct cross-module ORM relationships inside the core.
- No use-case-specific KPI ownership or API logic in the core frameworks.

## User Stories / Use Cases
- An Engineer wants to bootstrap a new B2B PRM application. They run `npx create-mercato-app my-prm --app prm` and get a complete, demo-ready PRM app from `open-mercato/ready-app-prm`.
- An Engineer wants to use an external ready app. They run `npx create-mercato-app my-app --app-url https://github.com/some-agency/ready-app-marketplace`.
- A Partner Agency wants to distribute their specialized marketplace workflows. They maintain a GitHub repository with a complete Open Mercato app that includes their UMES extensions, widgets, and seeds.
- An Engineer wants a blank app with no ready app. They run `npx create-mercato-app my-app` (unchanged behavior).

## Architecture

### CLI Interface

New flags for `create-mercato-app`: `--app` and `--app-url`

```bash
# Official Open Mercato ready app
npx create-mercato-app my-prm --app prm

# External GitHub-hosted ready app
npx create-mercato-app my-app --app-url https://github.com/some-agency/ready-app-marketplace

# No ready app - current behavior (bare scaffold)
npx create-mercato-app my-app
```

Resolution logic:
- `--app <name>` resolves to the GitHub repository `open-mercato/ready-app-<name>`
- `--app-url <url>` fetches the full GitHub repository at that URL
- `--app` and `--app-url` are mutually exclusive
- App names are kebab-case slugs and MUST map directly to repository names without additional lookup tables in v1

Backward compatibility:
- The no-flag invocation remains unchanged.
- `--app` and `--app-url` are additive optional flags.

### Repository Structure

Official ready apps live as separate repositories in the `open-mercato` organization:

```text
open-mercato/ready-app-prm
open-mercato/ready-app-quotes
open-mercato/ready-app-field-service
```

Each repository root is a **complete, runnable app**:

```text
ready-app-prm/
├── src/modules/           # PRM-specific modules
├── package.json
├── .env.sample
├── README.md
└── ...
```

### Fetch Mechanism

Uses GitHub API tarball download:

- Official: `GET https://api.github.com/repos/open-mercato/ready-app-<name>/tarball/<ref>`
- External: `GET https://api.github.com/repos/{owner}/{repo}/tarball/<ref>`
- No git dependency required

Ref resolution:
- `--app <name>` MUST resolve the official repository ref to the exact tag `v<create-mercato-app version>`
- Official bootstrap MUST NOT default to `main` for stable releases
- `--app-url <github-url>` uses the ref encoded in the GitHub URL when present (for example `/tree/<ref>`); otherwise it uses the repository default branch

### Imported App Snapshot Contract

Ready apps fetched via `--app` and `--app-url` are complete source repositories, not templates.

Rules:
- The CLI MUST extract the fetched ready app into the target directory as a raw source snapshot
- The CLI MUST NOT rewrite dependency versions, package names, or application source files inside fetched ready apps
- Imported ready apps MUST NOT rely on `.template` files or placeholder substitution
- The `.template` processor remains part of the bare scaffold path only, not the imported ready app path
- The CLI MUST skip the interactive agentic setup wizard for imported ready apps
- If agentic tooling is needed for an imported ready app, it MUST be added explicitly later by a separate manual command

### Reference Flow
```text
developer runs `npx create-mercato-app my-prm-app --app prm` ->
create-mercato-app resolves `open-mercato/ready-app-prm` + tag `v<create-mercato-app version>` ->
downloads the GitHub tarball ->
extracts the ready app source snapshot to the target directory ->
developer runs `yarn install` -> `yarn initialize` (setup.ts hooks run) ->
app is ready with domain baseline.
```

### Error Handling
- Official app repo not found: clear error including the resolved repository name (`open-mercato/ready-app-<name>`)
- Official app tag not found: clear compatibility error including the missing tag name and repo
- GitHub API unreachable / 404: error with suggestion to check network or repository URL
- Private repo without auth: error suggesting `GITHUB_TOKEN` env var for authenticated requests
- `--app-url` with a non-GitHub URL: clear error stating that only GitHub repositories are supported in v1
- Imported ready app contains `.template` files: clear error stating that imported ready apps must be committed source snapshots
- Both `--app` and `--app-url` provided: clear validation error before any network call

### Non-Negotiable Architecture Guardrails
1. Ready app modules extend host surfaces only through UMES and documented core contracts.
2. Ready app implementation lives completely outside the OM core repository.
3. The Open Mercato platform provides the extension points (hooks, enrichers, registries), but not the business configuration for ready apps.

## Data Models

Not applicable. This spec defines distribution and bootstrap infrastructure, not application entities.

## API Contracts

Not applicable. No application HTTP APIs are introduced. The external contract is the `create-mercato-app` CLI surface:
- `--app <name>`
- `--app-url <github-url>`

## Implementation Details

Because ready apps are external complete apps, there is no centralized database table required in the core engine. The "installation status" of a ready app is simply the presence of its modules and configurations within the application codebase.

The standard `yarn initialize` (which triggers module hooks defined in `setup.ts`) is sufficient to bootstrap the application after scaffolding.

## Versioning

Ready app bootstrap has three independent version axes:

1. **CLI version**: the version of `create-mercato-app`
2. **Ready app source ref**: the git tag or branch fetched from the ready app repository
3. **Committed dependency graph**: the exact dependency versions stored inside the fetched ready app repository

### Release Line Contract

- `create-mercato-app` and official `@open-mercato/*` packages MUST ship on the same version line
- Official ready app repositories MUST publish a matching git tag for every supported Open Mercato release using the format `v<version>`
- `--app` MUST fetch the official ready app tag that matches the running `create-mercato-app` version exactly
- Official ready app `main` branches MAY move ahead, but they are not the compatibility contract used by released CLI bootstraps
- Dependency versions inside an official ready app tag are owned by that ready app repository and MUST NOT be rewritten by the CLI

### Dependency Strategy

- Official ready apps MUST commit their `@open-mercato/*` dependency versions directly in `package.json`
- External ready apps MUST own their dependency policy in source control and MUST declare explicit versions or semver ranges in `package.json`
- The CLI MUST treat dependency versions in imported ready apps as repository-owned source, not bootstrap-time inputs
- External ready apps SHOULD pin stable major/minor ranges conservatively and update them intentionally after verification

### Reproducibility

- Official `--app` bootstraps are reproducible because the repo ref resolves from the CLI release and the dependency graph is committed in that tagged ready app repository
- External `--app-url` bootstraps are reproducible only when the URL points to a stable ref; otherwise they follow the repository default branch and whatever dependency graph is committed there
- External maintainers SHOULD document the tested Open Mercato compatibility range in their README

## Migration & Compatibility
- Official ready apps define compatibility through the pair `(repo tag, committed dependency graph)`, aligned to the `create-mercato-app` release line.
- External ready apps define compatibility through the chosen ref and the versions committed in their own `package.json`.
- Core APIs guarantee semantic versioning, allowing ready app maintainers to update their apps accordingly.
- Each official `ready-app-*` repository should have CI that validates every supported release tag still builds against the matching core release line.
- Backward compatible: `create-mercato-app` without `--app` or `--app-url` continues to work exactly as before.

## Implementation Plan

### Phase 1 - CLI Flags
1. Add `--app` and `--app-url` to the `create-mercato-app` argument parser.
2. Enforce mutual exclusivity between `--app` and `--app-url`.
3. Implement official app name resolution from `<name>` to `open-mercato/ready-app-<name>`.
4. Resolve official app ref from the running CLI version to tag `v<version>`.
5. Implement GitHub API tarball fetch for both official and external repositories.
6. Implement raw snapshot extraction for imported ready apps without template processing.
7. Skip the interactive agentic setup wizard for imported ready apps.
8. Add error handling for missing repos, missing tags, network failures, invalid URLs, private repos, unsupported `.template` files in imported apps, and duplicate source flags.

### Phase 2 - Official Ready App Repositories
1. Create the first official repository, such as `open-mercato/ready-app-prm`.
2. Add the first ready app implementation as a complete runnable application at repo root.
3. Commit explicit first-party dependency versions in the repository for each tagged release line.
4. Add CI to validate the app builds for the tagged release line.
5. Document the organization naming convention and release tagging rules for future official ready apps.

### File Manifest

| File | Repo | Action | Purpose |
|------|------|--------|---------|
| `packages/create-app/src/index.ts` | open-mercato | Modify | Add `--app` / `--app-url`, repo resolution, fetch logic |
| `packages/create-app/AGENTS.md` | open-mercato | Modify | Document `--app` / `--app-url` behavior |
| repo root | `open-mercato/ready-app-prm` | Create | First official ready app |
| `README.md` | `open-mercato/ready-app-prm` | Create | App usage, compatibility, and bootstrap docs |
| `.github/workflows/ci.yml` | `open-mercato/ready-app-prm` | Create | Validate the ready app builds |

### Testing Strategy
- Unit: name-to-repo resolution, official tag resolution, URL parsing, mutual exclusivity validation, tarball extraction, and imported-app snapshot validation
- Integration: end-to-end `create-mercato-app --app` with an official fixture repo tagged to the current CLI version
- Integration: end-to-end `create-mercato-app --app-url` with an external GitHub fixture repo copied as-is
- Integration: verify imported ready apps do not get `AGENTS.md`, `.ai/`, `.claude/`, `.cursor/`, or other wizard-generated files added or overwritten by bootstrap
- CI on each official ready app repo: `yarn install && yarn generate && yarn build`

## Risks & Impact Review

### Migration & Deployment Risks

### Operational Risks

#### GitHub API rate limiting blocks ready app fetch
- **Scenario**: Unauthenticated GitHub API calls hit rate limits during workshop/training events.
- **Severity**: Medium
- **Affected area**: `create-mercato-app --app` / `--app-url` bootstrap
- **Mitigation**: Support `GITHUB_TOKEN` env var for authenticated requests; clear error message on rate limit.
- **Residual risk**: Low with token usage

#### Per-app repositories drift from core compatibility
- **Scenario**: Core packages update but one or more official ready app repos are not updated, causing build failures for new users.
- **Severity**: Medium
- **Affected area**: Developer onboarding experience
- **Mitigation**: CI in every official ready app repo; required release tags per supported version; ownership assigned per app repo.
- **Residual risk**: Medium - requires active maintenance

#### Imported ready app is not actually committed as a source snapshot
- **Scenario**: A ready app repository still contains `.template` files or expects bootstrap-time rewriting, causing broken installs after fetch.
- **Severity**: High
- **Affected area**: Imported ready app bootstrap correctness
- **Mitigation**: Forbid template-based imported apps and fail closed during scaffold.
- **Residual risk**: Low

#### Organization-level discovery becomes weaker without one central catalog repo
- **Scenario**: Users do not know which official ready app names are available for `--app`.
- **Severity**: Medium
- **Affected area**: Developer experience and discoverability
- **Mitigation**: Maintain a documentation index on docs.open-mercato.com or in the main documentation repo; keep repo naming deterministic.
- **Residual risk**: Low

## Final Compliance Report - 2026-04-01

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/create-app/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Ready apps live outside core repository | Compliant | Official apps live in separate `open-mercato/ready-app-*` repositories, not in core |
| root AGENTS.md | App-specific behavior lives in the app codebase | Compliant | Each ready app remains a complete runnable app with its own `src/modules` |
| packages/create-app/AGENTS.md | MUST NOT break the standalone app template | Compliant | Bare scaffold remains unchanged; new flags are additive |
| BACKWARD_COMPATIBILITY.md | CLI commands are STABLE contract surface | Compliant with explicit removal request | Supported ready-app source flags are `--app` and `--app-url`; this implementation intentionally limits the CLI surface to those two flags |
| .ai/specs/AGENTS.md | Non-trivial spec must include full structure | Compliant | All required sections included |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| CLI interface matches fetch mechanism | Pass | `--app` resolves to `open-mercato/ready-app-<name>` and `--app-url` resolves to a direct GitHub repo URL |
| Repository structure matches fetch logic | Pass | Each official ready app repo root is a full runnable app |
| Error handling covers failure modes | Pass | Network, 404, invalid URL, rate limit, private repo, and duplicate flags covered |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** - Approved as the ready apps framework spec.

## Changelog

### 2026-04-01
- Reworked the distribution model from one centralized official repo to one official repo per ready app under the `open-mercato` organization.
- Introduced the official repository naming convention `ready-app-<appname>`.
- Replaced the earlier bootstrap contract with `--app` for official Open Mercato apps and `--app-url` for external GitHub-hosted apps.
- Added a raw-snapshot versioning contract: imported ready apps are copied as committed source, and dependency versions remain owned by the ready app repositories.
- Normalized the spec filename to `2026-03-02-ready-apps-framework.md` and removed the legacy numbered heading.
- Implemented Phase 1 in `packages/create-app`: ready app flags, GitHub snapshot import, snapshot validation, and unit/integration-style tests for the in-repo CLI surface.
- Removed the temporary preview-only source alias so the supported CLI surface remains `--app` and `--app-url` only.

### 2026-03-20
- Official app catalog repository changed from an earlier naming variant to `open-mercato/ready-apps` (superseded by the 2026-04-01 one-repo-per-app decision).
- Removed superseded SPEC-062 (Use-Case Starters Framework).
- Status changed from Draft to Active.

### 2026-03-18
- Renumbered from SPEC-062 to SPEC-068 to resolve numbering conflict with PR #1003 (Official Modules, SPEC-061-067).
- Renamed the concept from "starters" to a more standard bootstrap term at that stage of the design process.
- Added an earlier single-flag bootstrap mechanism, later superseded by the 2026-04-01 `--app` / `--app-url` decision.
- Added `open-mercato/ready-apps` as a centralized catalog repository, later superseded by the 2026-04-01 one-repo-per-app decision.
- Added GitHub API tarball fetch mechanism.
- Added error handling, versioning, and testing strategy.
- Added compliance report.

### 2026-03-17
- Renumbered from SPEC-061 to SPEC-062 to resolve numbering conflict with PR #1003.

### 2026-03-02
- Initial specification.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 - CLI Flags | Done | 2026-04-01 | `packages/create-app` now supports `--app`, `--app-url`, GitHub tarball imports, raw snapshot validation, and imported-app wizard skip behavior with automated tests |
| Phase 2 - Official Ready App Repositories | Not Started | — | Requires work in external repositories such as `open-mercato/ready-app-prm`, which are outside this monorepo |

### Phase 1 - Detailed Progress
- [x] Step 1: Add `--app` and `--app-url` to the `create-mercato-app` argument parser
- [x] Step 2: Enforce mutual exclusivity between `--app` and `--app-url`
- [x] Step 3: Implement official app name resolution from `<name>` to `open-mercato/ready-app-<name>`
- [x] Step 4: Resolve official app ref from the running CLI version to tag `v<version>`
- [x] Step 5: Implement GitHub API tarball fetch for both official and external repositories
- [x] Step 6: Implement raw snapshot extraction for imported ready apps without template processing
- [x] Step 7: Skip the interactive agentic setup wizard for imported ready apps
- [x] Step 8: Add validation and error handling for invalid URLs, duplicate source flags, missing repos or refs, private repos, rate limits, and `.template` files in imported apps

### Phase 2 - Detailed Progress
- [ ] Step 1: Create the first official repository, such as `open-mercato/ready-app-prm`
- [ ] Step 2: Add the first ready app implementation as a complete runnable application at repo root
- [ ] Step 3: Commit explicit first-party dependency versions in the repository for each tagged release line
- [ ] Step 4: Add CI to validate the app builds for the tagged release line
- [ ] Step 5: Document the organization naming convention and release tagging rules for future official ready apps
