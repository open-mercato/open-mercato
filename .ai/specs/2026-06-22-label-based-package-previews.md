# Explicit Package Previews

**Date:** 2026-06-22
**Status:** Approved
**Scope:** OSS CI workflow and package preview publishing
**Related:** `.github/workflows/package-previews.yml`, `.github/workflows/npm-snapshot-preview.yml`, `.github/workflows/snapshot.yml`, [implemented/2026-03-21-open-mercato-develop-snapshot-release.md](implemented/2026-03-21-open-mercato-develop-snapshot-release.md)

## TLDR

PRs must no longer publish npm snapshot packages automatically. Maintainers can request package previews explicitly without creating skipped preview checks for unrelated labels or no-op comment-router checks for ordinary PR comments:

- Manual `Package Previews` workflow dispatches, `gh workflow run`, or the `om-auto-publish-pr` skill publish pkg.pr.new previews without publishing to npm.
- Manual `NPM Snapshot Preview` workflow dispatches run the previous npm canary snapshot path, including standalone integration, only when the team wants to compare it against pkg.pr.new previews.
- Pushes to `develop` continue publishing the moving npm `develop` snapshot channel.

## Problem

The old PR snapshot workflow published real npm canary packages for every trusted PR. That made npm publish side effects too broad for normal review and made it hard to determine whether lighter pkg.pr.new previews are enough for most package validation.

## Design

### 1. pkg.pr.new Preview Workflow

`.github/workflows/package-previews.yml` runs on `workflow_dispatch` with a required `pr_number` input.

The workflow:

1. resolves the PR and rejects fork branches,
2. checks out the PR head SHA,
3. installs with Yarn 4 from the committed lockfile,
4. runs the package build sequence used by snapshot publishing (`build:packages`, `generate`, `build:packages`),
5. runs `yarn pkg-pr-new publish --comment=update --no-template --yarn --packageManager=yarn` once for all public package directories.

`pkg-pr-new` is kept in root `devDependencies` so CI executes the locked CLI instead of `npx`, `dlx`, or another moving installer command.

### 2. npm Snapshot Preview Workflow

`.github/workflows/npm-snapshot-preview.yml` preserves the old PR canary snapshot behavior behind explicit `workflow_dispatch` with a required `pr_number` input.

The workflow:

1. resolves the PR, pins its head SHA and author ID, and rejects fork branches,
2. gates the credentialed job on the protected `npm-preview` environment and verifies independent deployment approval before checking out the pinned PR head SHA,
3. publishes lockstep npm canary snapshots via `scripts/release-snapshot.sh`,
4. comments the exact npm snapshot versions on the PR,
5. runs standalone app integration against the exact published snapshot.

This path is intentionally separate from pkg.pr.new so maintainers can test whether npm canaries are still needed.

#### Approval and credential boundary

The `npm-preview` environment must require a maintainer reviewer, prevent self-review, disallow administrator bypass, and restrict deployment refs to trusted `main` with no tags. Stable `production` approval remains independent. Dispatch from `main`, then review the resolved PR SHA before approval; dependency install hooks and release scripts are PR-controlled code.

The first snapshot step reads the run's environment approval history with `actions: read`. Only an approval for `npm-preview` from someone other than the PR author (immutable user ID), dispatcher, and triggering actor permits checkout. Missing approvals, unrelated/rejected approvals, and API errors fail closed. Only the first run attempt is accepted: retries require a fresh dispatch so earlier approvals cannot authorize a newly resolved PR head.

Only `secrets.NPM_PREVIEW_TOKEN` supplies npm authentication in this workflow. It must be a distinct granular credential stored exclusively in `npm-preview`, with publishing access to the explicit public workspace package allowlist, including `create-mercato-app`, and no unrelated package or organization administration grants. It must not reuse or fall back to the stable `NPM_TOKEN`. A missing token stops the job before installing dependencies. Trusted branch snapshots, stable publishing, snapshot versioning, and provenance remain unchanged.

Operators must verify the actual npm package grants, noninteractive publishing permissions, expiration/rotation owner, environment reviewers, no-self-review/no-bypass policy, ref restrictions, and environment-only secret placement, recording non-secret evidence on the issue or PR. The [operator checklist](../../CONTRIBUTING.md#npm-snapshot-preview-security-setup) is required before first use; these settings are external to the repository and are not established by YAML or unit tests. Npm write grants cannot restrict these shared package names to preview versions or dist-tags, so independent approval is required even with a dedicated credential.

### 3. Trigger Decision: Dispatch Only

The preview workflows intentionally do not use PR labels or issue-comment slash-command routers.

- Label triggers (`pull_request` `labeled`) create workflow runs for every added PR label, then rely on job-level `if` filters. On label-heavy automation this shows many skipped preview checks.
- Issue-comment routers create workflow runs for every PR comment before the router can inspect comment text. Normal review discussion would therefore create repeated no-op router checks.
- Manual `workflow_dispatch`, `gh workflow run`, and `om-auto-publish-pr` create a run only when a maintainer explicitly asks for a package preview.

This trades slash-command convenience for a clean PR Checks surface.

### 4. develop Snapshot Workflow

`.github/workflows/snapshot.yml` remains the trusted `develop` branch snapshot workflow. It no longer listens to PR events.

Pushes to `develop` still:

- publish all public packages under the npm `develop` dist-tag,
- keep exact snapshot versions installable,
- run standalone integration against the exact published snapshot.

## Manual Dispatch

| Dispatch path | Effect |
| --- | --- |
| manual `Package Previews` dispatch with `pr_number` | Publish pkg.pr.new package previews for the selected PR head. |
| `gh workflow run package-previews.yml --ref develop -f pr_number=<PR>` | Publish pkg.pr.new package previews for the selected PR head. |
| `om-auto-publish-pr <PR>` | Publish pkg.pr.new package previews for the selected PR head via GitHub CLI. |
| manual `NPM Snapshot Preview` dispatch with `pr_number` | Publish the old npm canary snapshot preview and run standalone integration for the selected PR head. |

Dispatches are action triggers, not persistent pipeline states. To publish a fresh preview for a newer commit, re-run the workflow or skill with the same PR number.

## Compatibility

- Stable `latest` releases remain unchanged.
- The npm `develop` channel remains unchanged for pushes to `develop`.
- PR preview publishing becomes opt-in.
- Both PR preview workflows are restricted to same-repository PR branches. This avoids checking out fork code in workflows that are dispatched from trusted workflow contexts and can publish artifacts or comment on PRs.
- Npm previews additionally require independent environment approval and a dedicated preview credential. Retry via a fresh dispatch rather than **Re-run jobs**. pkg.pr.new previews retain their existing flow.

## Integration Coverage

Affected operational paths:

- `.github/workflows/package-previews.yml`
- `.github/workflows/npm-snapshot-preview.yml`
- `.github/workflows/snapshot.yml`
- `.ai/skills/om-auto-publish-pr/SKILL.md`
- `package.json`
- `yarn.lock`

Affected runtime API paths:

- none

Affected key UI paths:

- none

Validation:

- YAML parse check for edited workflows.
- `node --test scripts/__tests__/preview-workflows.test.mjs scripts/__tests__/npm-provenance-runners.test.mjs` verifies job approval/credential isolation, independent versus self/missing/unrelated/rejected approvals, API errors, fresh-dispatch retries, pinned SHA, same-repository dispatch, and provenance runner requirements.
- Operator acceptance: confirm unapproved/self-approved runs do not reach PR checkout, then approve an intended pinned same-repository SHA and verify canary publication, provenance, and exact-version standalone integration. This live publish check requires maintainer authorization and is not run locally.
- `yarn install --immutable` after adding `pkg-pr-new`.
- No local npm publish or pkg.pr.new publish should run during implementation.

## Changelog

### 2026-10-26

- Required independent `npm-preview` environment approval before PR checkout and a distinct environment-scoped `NPM_PREVIEW_TOKEN` with no stable credential fallback (issue #7835).
- Rejected approvals from the PR author or workflow initiators, missing/unrelated approval, and run retries that could reuse old approval; added executable regression coverage and the operator configuration checklist.

### 2026-06-24

- Replaced label-triggered preview workflows with manual `workflow_dispatch` to avoid duplicate skipped checks from unrelated label events.
- Rejected slash-command routers because ordinary PR comments would still create no-op router workflow runs in checks.
- Added the `om-auto-publish-pr` skill as the preferred CLI-backed convenience path for pkg.pr.new previews.
- Restricted both preview workflows to same-repository PR branches under the dispatch model.

### 2026-06-22

- Initial spec for label-triggered pkg.pr.new package previews and opt-in npm snapshot previews.
