# SPEC-066: Official Modules Changesets Release Workflow

**Date:** 2026-03-15
**Status:** Draft
**Scope:** OSS — Changesets-based stable and prerelease publishing workflow for `open-mercato/official-modules`
**Author:** Open Mercato Team
**Related:** [SPEC-061-2026-03-13-official-modules-lifecycle-management.md](./SPEC-061-2026-03-13-official-modules-lifecycle-management.md), [SPEC-062-2026-03-13-official-modules-development-monorepo.md](./SPEC-062-2026-03-13-official-modules-development-monorepo.md), [SPEC-063-2026-03-13-official-modules-verdaccio-prototyping.md](./SPEC-063-2026-03-13-official-modules-verdaccio-prototyping.md), [SPEC-064-2026-03-14-official-modules-platform-versioning-policy.md](./SPEC-064-2026-03-14-official-modules-platform-versioning-policy.md)

---

## TLDR

**Key Points:**
- `official-modules` MUST use Changesets for independent per-package versioning instead of lockstep workspace bumps.
- Stable publication MUST keep the current operational model: a manually triggered release from `main`, typically executed during the Friday release window.
- Prerelease publication MUST be automated for PRs and pushes to `develop` and `main`, using non-stable snapshot versions and npm prerelease tags.
- Both stable and prerelease publication MUST create aggregate GitHub Release artifacts at the repository level; per-package GitHub Releases are explicitly rejected.
- `.changeset/*.md` files are the release intent source of truth and MUST be authored in feature PRs for publishable package changes.

**Scope:**
- `.changeset/config.json` contract
- `.changeset/*.md` authoring and validation rules
- preview/prerelease workflow for PR and branch validation
- stable `workflow_dispatch` release from `main`
- aggregate GitHub Release strategy for stable and prerelease runs
- CI rules for missing changesets and stale artifact validation

**Concerns:**
- Changesets defaults often assume an auto-maintained Release PR, but this repository needs a manual stable release trigger to match existing team operations.
- Preview GitHub Releases can create noise if every run creates a new immutable entry; preview release artifacts therefore need an update-in-place strategy.
- Stable npm publication, version commits, and GitHub Releases must stay consistent even when publish or push steps fail mid-flight.

---

## Overview

SPEC-062 defines `official-modules` as a separate monorepo with independently published packages. SPEC-064 defines the platform compatibility policy for those packages. What remains missing is the release mechanics: how package changes are declared in PRs, how preview builds are published, how weekly stable releases are cut, and how maintainers get a readable release artifact without reintroducing a fake single repo version.

This spec defines that missing release layer.

The main design constraint is operational: the team already ships stable releases through a manually triggered Friday release from `main`. The new workflow must preserve that control model while replacing global version bumps with package-specific versioning.

> **Market Reference:** Modeled after Changesets-based multi-package repositories with snapshot prereleases and repository-level release notes. Adopted: per-PR changeset files, independent package publication, snapshot prereleases, and aggregate GitHub Releases. Rejected: lockstep repo versioning, per-package GitHub Releases, and an auto-merge Release PR as the primary stable release path.

---

## Problem Statement

Without an explicit Changesets release workflow, `official-modules` will fail in predictable ways:

1. **Lockstep habits will leak back into the repo**
   Maintainers will try to reproduce the current monorepo release model and bump all packages together, defeating the point of independent package versioning.

2. **PR authors will not know when a changeset is required**
   Without a release intent contract, some package changes will ship without version bumps while others will receive inconsistent bump levels.

3. **Preview validation will be under-specified**
   If preview publishing is not clearly defined, maintainers will validate workspace behavior instead of published artifacts and miss packaging/exports failures.

4. **Stable release operations will be ambiguous**
   If Changesets is introduced without a stable operator workflow, the team will not know whether stable releases come from auto-generated Release PRs, direct merges to `main`, or manual scripts.

5. **GitHub Releases will either become spam or disappear**
   Per-package GitHub Releases are too noisy in a multi-package repo, while no GitHub Release artifact makes it harder to audit what actually shipped in each release window.

The repository needs one explicit, operator-friendly contract that covers authoring, preview publishing, stable publishing, and release summaries together.

---

## Proposed Solution

Define `official-modules` release management around five layers:

1. **Static repository policy**
   `.changeset/config.json` encodes independent package versioning, public publication, and internal dependency update behavior.

2. **Per-PR release intent**
   Authors add `.changeset/*.md` files describing which publishable packages changed, which bump level they require, and which notes should appear in release output.

3. **Automated prerelease publishing**
   PRs and pushes to `develop`/`main` publish snapshot builds using Changesets snapshot versioning, without committing prerelease versions back to the branch.

4. **Manual stable publishing**
   A `workflow_dispatch` release on `main` consumes all pending changesets, versions changed packages, publishes stable npm versions, commits version/changelog updates, and pushes them back to `main`.

5. **Aggregate GitHub Release artifacts**
   Each stable release creates one immutable repository-level GitHub Release. Each preview source channel creates or updates one mutable prerelease GitHub Release. Neither stable nor preview creates GitHub Releases per package.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Use Changesets directly, but not a Release PR as the primary stable path | Preserves the team's existing manual Friday release operation from `main` |
| Require `.changeset/*.md` in feature PRs | Makes versioning intent explicit and reviewable before merge |
| Preview builds use snapshot prerelease versions and npm prerelease tags | Validates published artifacts without polluting stable semver lines |
| Stable and preview both produce aggregate GitHub Releases | Gives one human-readable audit artifact per release context without per-package noise |
| Preview GitHub Releases are updated in place per PR/branch | Avoids flooding the Releases page with ephemeral runs |
| Package versions come from npm metadata, not git tags | Prevents the repo from implying a false single version line |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Lockstep `workflow_dispatch` with one shared bump input (`patch`/`minor`/`major`) | Conflicts with per-package versioning and creates meaningless bumps for unchanged modules |
| Standard Changesets Release PR merged for every stable release | Adds a second release merge artifact and diverges from the current manual Friday release operation |
| Publish stable versions on every merge to `main` | Reduces operator control and removes the team's release window |
| Per-package GitHub Releases | Too noisy for a repository expected to contain many optional packages |
| npm publish without GitHub Release artifacts | Too opaque for operators and consumers during weekly release windows |

---

## User Stories / Use Cases

- **Module maintainer** wants to add a changeset in a PR so that release intent is reviewed together with code changes.
- **Release operator** wants to trigger one stable release from `main` on Friday so that only changed packages are published.
- **Reviewer** wants CI to fail when a publishable package changes without an accompanying changeset.
- **Contributor** wants preview builds for their PR so that packaging, exports, and sandbox installation are validated before merge.
- **Consumer** wants one GitHub Release page that shows which packages shipped in a stable or preview run without opening one release per module.

---

## Architecture

### 1. Release Inputs

The workflow is driven by three inputs:

1. static config in `.changeset/config.json`
2. checked-in release intent files in `.changeset/*.md`
3. runtime workflow context:
   - PR number
   - branch name
   - commit SHA
   - release channel (`preview` or `stable`)

These inputs produce one ephemeral release plan per workflow run. The release plan is not committed; it is generated in CI and used to drive publishing and GitHub Release note rendering.

### 2. `.changeset/config.json` Contract

The repository MUST define:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "open-mercato/official-modules" }],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

Rules:

- `fixed` MUST remain empty to preserve independent versioning.
- `linked` MUST remain empty unless a future spec intentionally couples package version lines.
- `commit` MUST remain `false`; commits are controlled by the stable release workflow, not by the Changesets CLI.
- `access` MUST be `public`.
- `baseBranch` MUST be `main`.
- `updateInternalDependencies` MUST be `patch` so internal runtime dependency bumps remain valid when one published official module depends on another.

### 3. `.changeset/*.md` Authoring Contract

Each publishable package change SHOULD produce one changeset file via:

```bash
yarn changeset
```

Example:

```md
---
"@open-mercato/module-n8n-integration": minor
"@open-mercato/module-stripe-payments": patch
---

Add credential test action for n8n and fix Stripe webhook retry classification.
```

Rules:

- The YAML frontmatter maps publishable package names to `patch`, `minor`, or `major`.
- The Markdown body becomes release-note input and SHOULD be concise, user-facing, and package-relevant.
- One PR MAY contain multiple changeset files, but the normal case SHOULD be one file per PR.
- Package changes that do not result in a published artifact MUST use an explicit skip path, such as a CI-recognized label or PR template checkbox, rather than silently omitting a changeset.
- Docs-only, CI-only, or internal repository changes that do not affect a publishable package MAY skip a changeset.

### 4. Version Calculation Rules

The workflow MUST compute release output using Changesets semantics:

- only packages referenced by pending changesets are candidates for publication
- when multiple changesets mention the same package, the highest bump wins:
  - `major > minor > patch`
- release notes for a package aggregate all matching changeset descriptions
- internal dependent packages MAY receive a `patch` bump when required by `updateInternalDependencies`
- unchanged packages MUST NOT be version-bumped

### 5. Stable Workflow

Stable publication MUST be implemented as a `workflow_dispatch` GitHub Actions workflow restricted to `main`.

Stable workflow steps:

1. verify the workflow is running on `refs/heads/main`
2. install dependencies and validate the repository
3. run `changeset status` and fail fast if there are no pending releases
4. render an ephemeral `release-plan.json` artifact for summary generation
5. run `changeset version`
6. build packages and run standalone/sandbox validation against the versioned artifacts
7. run `changeset publish`
8. commit version, changelog, and lockfile updates back to `main`
9. create one aggregate stable GitHub Release using the rendered release plan and published versions

Stable workflow properties:

- stable publish MUST use npm `latest`
- stable version changes MUST be committed only after publish succeeds
- stable release tags MUST be repository-level, not package-level
- if `changeset publish` reports no packages to publish, the workflow MUST fail or exit without creating commit/tag/release artifacts

Recommended stable tag format:

```text
stable-YYYY-MM-DD
```

Recommended commit message:

```text
chore(release): publish official modules YYYY-MM-DD
```

### 6. Prerelease Workflow

Prerelease publishing MUST be automated for:

- `pull_request` targeting `main` or `develop`
- `push` to `develop`
- `push` to `main`

Prerelease workflow steps:

1. install dependencies and validate the repository
2. compute the release plan from pending changesets
3. if no publishable packages changed, skip publication and exit cleanly
4. run Changesets snapshot versioning in the workflow workspace only
5. build packages and run standalone/sandbox validation against the snapshot artifacts
6. publish snapshot versions to npm using a prerelease dist-tag
7. create or update one aggregate prerelease GitHub Release for the PR or branch source

Prerelease workflow properties:

- prerelease version changes MUST NOT be committed back to the source branch
- prerelease packages MUST publish under npm tag `preview`
- prerelease versions MUST be unique per run and MUST include channel identity plus commit identity
- prerelease GitHub Releases MUST be marked `prerelease: true`

Recommended preview source mapping:

| Source | Mutable tag | Title example |
|--------|-------------|---------------|
| PR #123 | `preview-pr-123` | `Official Modules Preview — PR #123` |
| `develop` push | `preview-develop` | `Official Modules Preview — develop` |
| `main` push | `preview-main` | `Official Modules Preview — main` |

The mutable preview tag is a repository-run marker, not a package version. The workflow MAY move that tag to the latest published preview commit for the same source channel.

### 7. Aggregate GitHub Release Strategy

Stable and preview release artifacts follow different lifecycle rules:

#### Stable

- one immutable GitHub Release per stable publish run
- `prerelease: false`
- title contains release date
- body lists only published packages and their published versions

Recommended stable title:

```text
Official Modules Stable Release — 2026-03-20
```

#### Preview

- one mutable GitHub Release per preview source channel
- `prerelease: true`
- updated in place on subsequent runs for the same PR or branch
- body lists the latest preview package versions for that source channel

Both release types SHOULD render:

- published package name
- published version
- bump level
- aggregated note bullets from related changesets
- install examples using exact package versions

Per-package GitHub Releases are forbidden by this spec.

### 8. CI Enforcement

The repository MUST enforce these checks in PR CI:

1. if a publishable package changed, a changeset file is required unless an explicit skip path is used
2. `.changeset/config.json` must remain compliant with repository policy
3. package builds must succeed
4. layout validation from SPEC-062 and publish scripting from SPEC-063 must remain green
5. standalone/sandbox generation and build must validate published artifact shape, not only workspace source behavior

Changeset guard SHOULD inspect:

- `packages/*/src/modules/**`
- package manifests for publishable packages
- export maps
- release scripts and workflows that materially affect published artifacts

### 9. Failure and Retry Behavior

Stable and preview workflows MUST fail loudly on partial success signals.

Rules:

- aggregate GitHub Releases MUST be created only after successful npm publication
- stable version commits MUST happen only after successful npm publication
- if npm publication partially succeeds, the workflow MUST stop before creating final commit/tag/release artifacts
- reruns MUST use actual npm state to avoid republishing already-published versions
- preview reruns for the same PR/branch MUST update the existing prerelease GitHub Release instead of creating a new one

This keeps npm as the source of truth and avoids presenting a clean GitHub release artifact for a failed publish.

---

## Data Models

### `.changeset/config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "open-mercato/official-modules" }],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

### `.changeset/*.md`

```md
---
"@open-mercato/module-example-a": minor
"@open-mercato/module-example-b": patch
---

Add setup validation for Example A and fix webhook status mapping for Example B.
```

### Ephemeral Release Plan

Recommended generated artifact:

```json
{
  "channel": "stable",
  "source": "main",
  "packages": [
    {
      "name": "@open-mercato/module-example-a",
      "oldVersion": "1.2.3",
      "newVersion": "1.3.0",
      "bump": "minor",
      "notes": [
        "Add setup validation for Example A."
      ]
    }
  ]
}
```

This artifact is not committed. It exists only to drive summary rendering and GitHub Release creation.

---

## API Contracts

No application HTTP APIs are introduced by this spec. The external contracts are repository commands and workflow behavior.

### Repository Commands

| Command | Purpose |
|---------|---------|
| `yarn changeset` | Create a new `.changeset/*.md` file |
| `yarn release:status` | Render pending release status from current changesets |
| `yarn release:preview` | Build and publish preview snapshot packages |
| `yarn release:stable` | Run the same stable steps used by the manual GitHub workflow |
| `yarn validate:changesets` | Fail when publishable package changes lack a valid changeset |

### Stable Workflow Contract

Recommended workflow shape:

- Trigger: `workflow_dispatch`
- Branch restriction: `main` only
- Required permissions:
  - `contents: write`
  - `id-token: write`
- Required secrets:
  - `NPM_TOKEN`
  - `GITHUB_TOKEN`

Stable workflow outputs SHOULD include:

- published package list
- stable tag name
- GitHub Release URL

### Preview Workflow Contract

Recommended workflow shape:

- Trigger:
  - `pull_request` to `main`, `develop`
  - `push` to `main`, `develop`
- Required permissions:
  - `contents: write`
  - `pull-requests: write`
- Required secrets:
  - `NPM_TOKEN`
  - `GITHUB_TOKEN`

Preview workflow outputs SHOULD include:

- published package list
- preview tag name
- GitHub prerelease URL
- PR comment or workflow summary with exact install commands

### Integration Coverage Matrix

| Flow | Coverage Requirement |
|------|----------------------|
| package change with valid changeset | PR CI |
| package change without changeset | PR CI failure |
| preview publish from PR | Preview smoke test |
| preview publish from `develop` push | Preview smoke test |
| stable manual publish from `main` | Release smoke test |
| stable run with no pending changesets | Failure-path test |
| aggregate stable GitHub Release rendering | Contract test |
| aggregate preview GitHub Release update-in-place | Contract test |
| standalone/sandbox install from published artifact | Integration test |

---

## Internationalization (i18n)

Not applicable. This spec defines repository tooling and release workflows, not product UI strings.

---

## UI/UX

Not applicable in product UI. Relevant developer UX requirements are:

- `yarn changeset` is the canonical way to add release intent
- preview and stable workflows are explicit and deterministic
- release operators get one aggregate GitHub Release page per release context
- PR authors get clear feedback when a changeset is missing or malformed

---

## Configuration

| Key | Default | Purpose |
|-----|---------|---------|
| `NPM_REGISTRY_URL` | `https://registry.npmjs.org` | Stable and preview publish target |
| `PREVIEW_NPM_TAG` | `preview` | Dist-tag for prerelease npm publishes |
| `STABLE_NPM_TAG` | `latest` | Dist-tag for stable npm publishes |
| `GITHUB_RELEASE_PREFIX_STABLE` | `stable` | Stable aggregate tag prefix |
| `GITHUB_RELEASE_PREFIX_PREVIEW` | `preview` | Preview aggregate tag prefix |
| `OM_RELEASE_CHANNEL` | workflow-defined | Release channel for scripts (`stable` or `preview`) |

---

## Migration & Compatibility

- This spec is additive relative to SPEC-062, SPEC-063, and SPEC-064.
- It does not change runtime application APIs, database schemas, or module packaging contracts.
- It changes release operations by replacing lockstep release scripts with Changesets-driven per-package publication.
- Stable publication remains manually triggered from `main`, preserving current operator expectations.
- Package versions remain the consumer-facing compatibility source of truth; aggregate GitHub Releases are reporting artifacts, not semantic repo versions.

### Compatibility Rules

| Contract | Rule |
|---------|------|
| Stable release trigger | MUST remain a manual `workflow_dispatch` from `main` |
| Prerelease publication | MUST NOT mutate stable versions or commit preview versions to branches |
| GitHub Releases | MUST be aggregate repo-level artifacts, not per-package artifacts |
| Package publication | MUST publish only changed packages |
| Release intent | MUST come from checked-in `.changeset/*.md` files |

---

## Implementation Plan

### Phase 1 — Repository Contracts

1. Add `.changeset/config.json` with the repository policy from this spec.
2. Add `yarn changeset`, `yarn release:status`, and `yarn validate:changesets` scripts to the root package.
3. Implement a helper that renders an ephemeral release-plan JSON artifact from current changesets.
4. Update `PULL_REQUEST_TEMPLATE.md` to require either a changeset or an explicit skip reason.

### Phase 2 — Preview Workflow

1. Add a preview GitHub Actions workflow for PRs and pushes to `main` / `develop`.
2. Implement snapshot versioning and preview npm publication under the `preview` dist-tag.
3. Implement mutable aggregate prerelease GitHub Release creation per PR/branch source.
4. Add standalone/sandbox smoke validation against preview artifacts.

### Phase 3 — Stable Workflow

1. Add a manual stable GitHub Actions workflow restricted to `main`.
2. Implement stable release plan generation, `changeset version`, and `changeset publish`.
3. Commit version/changelog changes back to `main` only after successful publish.
4. Create one immutable aggregate stable GitHub Release per stable run.

### Phase 4 — Validation and Operator Docs

1. Add CI enforcement for missing changesets and invalid release metadata.
2. Add tests for release-plan rendering and aggregate GitHub Release body generation.
3. Document stable operator steps and preview consumer install steps.
4. Validate rerun and partial-failure handling in dry-run or staging conditions.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `.changeset/config.json` | Create | Canonical Changesets policy |
| `.github/workflows/preview.yml` | Create | Automated prerelease publication |
| `.github/workflows/publish.yml` | Create | Manual stable publication from `main` |
| `scripts/release/render-release-plan.mjs` | Create | Generate ephemeral release summary |
| `scripts/release/render-github-release.mjs` | Create | Build aggregate GitHub Release notes |
| `scripts/release/preview.mjs` | Create | Preview snapshot publish orchestration |
| `scripts/release/stable.mjs` | Create | Stable publish orchestration |
| `PULL_REQUEST_TEMPLATE.md` | Modify | Require changeset or explicit skip |
| `README.md` | Modify | Document author and operator release flows |

### Testing Strategy

- Unit test release-plan aggregation from multiple changeset files.
- Unit test aggregate GitHub Release body rendering for stable and preview channels.
- Contract test that missing changesets fail CI when publishable packages change.
- Integration test preview publish against packed artifacts and sandbox generate/build.
- Integration test stable publish dry-run against a fixture repository with multiple package bumps.

---

## Risks & Impact Review

### Data Integrity Failures

Repository release metadata is the main data surface. The critical integrity risks are incorrect version state, incorrect release summaries, and repo/npm divergence after partial release failures. Stable publish therefore sequences validation before publish and delays committing version changes until publish succeeds.

### Cascading Failures & Side Effects

Publishing to npm, creating GitHub Releases, pushing commits, and updating mutable preview tags are coupled side effects. The workflow must avoid presenting a successful GitHub release artifact when npm publication only partially succeeded.

### Tenant & Data Isolation Risks

Not applicable directly. This spec defines repository release tooling, not tenant-scoped runtime behavior.

### Migration & Deployment Risks

The main deployment risk is operational confusion during transition from lockstep scripts to Changesets. This is mitigated by preserving the stable `workflow_dispatch` model from `main` and introducing preview/stable flows incrementally.

### Operational Risks

Main operational risks are npm outages, GitHub API failures, and release-note/tag drift for preview channels. The design must prefer explicit failure over silent best-effort behavior.

### Risk Register

#### Missing Changeset For Publishable Package
- **Scenario**: A PR modifies a publishable module package but merges without a `.changeset/*.md` file.
- **Severity**: High
- **Affected area**: Stable versioning, release notes, npm publication correctness
- **Mitigation**: CI-enforced changeset validation plus explicit skip path for non-publishable changes
- **Residual risk**: Maintainers can still choose the wrong bump level; that remains a review responsibility

#### Stable Publish Succeeds But Version Commit Push Fails
- **Scenario**: npm publication succeeds, but the workflow fails while pushing version/changelog updates back to `main`.
- **Severity**: High
- **Affected area**: Repo state, future release planning, changelog accuracy
- **Mitigation**: Stable workflow commits only after publish succeeds and fails loudly if push fails; rerun instructions must reconcile npm state before another publish attempt
- **Residual risk**: A human recovery step may still be required when npm and git diverge

#### Partial npm Publish Creates Misleading Release Artifact
- **Scenario**: Some packages publish successfully before npm or network failure interrupts the workflow, but GitHub Release creation would otherwise continue.
- **Severity**: Critical
- **Affected area**: Release auditability, consumer trust, operator response
- **Mitigation**: Aggregate GitHub Release creation happens only after successful publish completion; partial publish halts before commit/tag/release
- **Residual risk**: Operators must inspect npm state before rerunning

#### Preview GitHub Releases Flood The Repository
- **Scenario**: Every preview run creates a new immutable GitHub Release entry, overwhelming the Releases page.
- **Severity**: Medium
- **Affected area**: Repository usability, operator signal-to-noise
- **Mitigation**: Preview releases are mutable and keyed per PR or branch source, updating in place instead of creating a new entry each run
- **Residual risk**: Very active PRs still churn one prerelease artifact repeatedly, but the total release count remains bounded

#### Preview Versions Leak Into Stable Branch State
- **Scenario**: Snapshot versioned manifests from a preview workflow are accidentally committed back to `main` or `develop`.
- **Severity**: High
- **Affected area**: Stable release correctness, peer/version policy from SPEC-064
- **Mitigation**: Preview workflow performs snapshot versioning only in ephemeral CI workspace and never commits preview manifests
- **Residual risk**: Manual local misuse of Changesets snapshot commands remains possible outside CI

#### Standalone Validation Uses Workspace Illusion Instead Of Published Shape
- **Scenario**: CI validates only local workspace source and misses missing files or invalid exports in packed artifacts.
- **Severity**: High
- **Affected area**: Consumer installs, CLI module discovery, sandbox reliability
- **Mitigation**: Preview and stable workflows both require packed/published artifact validation plus sandbox generate/build
- **Residual risk**: Registry propagation timing can still produce transient false negatives in preview jobs

---

## Final Compliance Report — 2026-03-15

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/create-app/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Check existing specs before non-trivial changes | Compliant | SPEC-061, SPEC-062, SPEC-063, and SPEC-064 are referenced and aligned |
| root AGENTS.md | Non-trivial changes require a spec | Compliant | This document defines the new repository release architecture |
| root AGENTS.md | Specs must list integration coverage for affected API/UI paths | Compliant | Workflow/integration coverage matrix is included for release surfaces |
| `.ai/specs/AGENTS.md` | Spec includes TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog | Compliant | All required sections are present |
| `packages/cli/AGENTS.md` | Standalone generators consume compiled package artifacts from installed packages | Compliant | Both preview and stable workflows require artifact-based sandbox validation |
| `packages/cli/AGENTS.md` | Build order is `build` -> `generate` -> `build` for standalone correctness | Compliant | Spec requires standalone/sandbox validation against versioned artifacts and references build-order-safe validation |
| `packages/create-app/AGENTS.md` | MUST build before publishing | Compliant | Preview and stable workflows both build before publication |
| `packages/create-app/AGENTS.md` | MUST test realistic standalone behavior, not only workspace behavior | Compliant | Sandbox generate/build against packed or published artifacts is mandatory |
| root AGENTS.md | Keep changes simple and focused | Compliant | Spec isolates release workflow concerns from package layout and platform compatibility policies |
| root AGENTS.md | Backward compatibility changes must be explicit | Compliant | Migration & Compatibility section states this is additive and keeps manual stable release from `main` |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Config, changeset files, and ephemeral release-plan artifacts map to command/workflow contracts |
| API contracts match UI/UX section | Pass | Developer-facing commands and workflow UX are consistent |
| Risks cover all write operations | Pass | npm publish, git push, tag/release creation, and preview mutation risks are covered |
| Commands defined for all mutations | Pass | Authoring, preview publish, stable publish, and validation commands are specified |
| Cache strategy covers all read APIs | N/A | No runtime read API or cache layer is introduced |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation

---

## Changelog

### 2026-03-15
- Initial specification for Changesets-based stable and prerelease publishing in `official-modules`
- Adopted manual stable `workflow_dispatch` from `main`
- Adopted aggregate GitHub Releases for both stable and preview publication
- Defined `.changeset/config.json`, `.changeset/*.md`, preview workflow, stable workflow, and CI guard contracts

### Review — 2026-03-15
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: N/A
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
