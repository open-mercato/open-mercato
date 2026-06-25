# Label-Based Package Previews

**Date:** 2026-06-22
**Status:** Approved
**Scope:** OSS CI workflow and package preview publishing
**Related:** `.github/workflows/package-previews.yml`, `.github/workflows/npm-snapshot-preview.yml`, `.github/workflows/snapshot.yml`, [implemented/2026-03-21-open-mercato-develop-snapshot-release.md](implemented/2026-03-21-open-mercato-develop-snapshot-release.md)

## TLDR

PRs must no longer publish npm snapshot packages automatically. Maintainers can request package previews explicitly:

- `publish-pkg-preview` publishes pkg.pr.new previews without publishing to npm.
- `publish-npm-snapshot` runs the previous npm canary snapshot path, including standalone integration, only when the team wants to compare it against pkg.pr.new previews.
- Pushes to `develop` continue publishing the moving npm `develop` snapshot channel.

## Problem

The old PR snapshot workflow published real npm canary packages for every trusted PR. That made npm publish side effects too broad for normal review and made it hard to determine whether lighter pkg.pr.new previews are enough for most package validation.

## Design

### 1. pkg.pr.new Preview Workflow

`.github/workflows/package-previews.yml` runs on `pull_request` `labeled` events and only proceeds when the added label is `publish-pkg-preview`.

The workflow:

1. checks out the PR code,
2. installs with Yarn 4 from the committed lockfile,
3. runs the package build sequence used by snapshot publishing (`build:packages`, `generate`, `build:packages`),
4. runs `yarn pkg-pr-new publish --comment=update --no-template --yarn --packageManager=yarn` once for all public package directories.

`pkg-pr-new` is kept in root `devDependencies` so CI executes the locked CLI instead of `npx`, `dlx`, or another moving installer command.

### 2. npm Snapshot Preview Workflow

`.github/workflows/npm-snapshot-preview.yml` preserves the old PR canary snapshot behavior behind the `publish-npm-snapshot` label.

The workflow:

1. runs only for same-repository PR branches because it requires `NPM_TOKEN`,
2. publishes lockstep npm canary snapshots via `scripts/release-snapshot.sh`,
3. comments the exact npm snapshot versions on the PR,
4. runs standalone app integration against the exact published snapshot.

This path is intentionally separate from pkg.pr.new so maintainers can test whether npm canaries are still needed.

### 3. develop Snapshot Workflow

`.github/workflows/snapshot.yml` remains the trusted `develop` branch snapshot workflow. It no longer listens to PR events.

Pushes to `develop` still:

- publish all public packages under the npm `develop` dist-tag,
- keep exact snapshot versions installable,
- run standalone integration against the exact published snapshot.

## Labels

| Label | Effect |
| --- | --- |
| `publish-pkg-preview` | Publish pkg.pr.new package previews for the current PR commit. |
| `publish-npm-snapshot` | Publish the old npm canary snapshot preview and run standalone integration. |

Both labels are action triggers, not persistent pipeline states. To publish a fresh preview for a newer commit, remove and re-add the label.

## Compatibility

- Stable `latest` releases remain unchanged.
- The npm `develop` channel remains unchanged for pushes to `develop`.
- PR preview publishing becomes opt-in.
- Fork PRs can request pkg.pr.new previews, but npm snapshot previews are restricted to same-repository PR branches.

## Integration Coverage

Affected operational paths:

- `.github/workflows/package-previews.yml`
- `.github/workflows/npm-snapshot-preview.yml`
- `.github/workflows/snapshot.yml`
- `package.json`
- `yarn.lock`

Affected runtime API paths:

- none

Affected key UI paths:

- none

Validation:

- YAML parse check for edited workflows.
- `yarn install --immutable` after adding `pkg-pr-new`.
- No local npm publish or pkg.pr.new publish should run during implementation.

## Changelog

### 2026-06-22

- Initial spec for label-triggered pkg.pr.new package previews and opt-in npm snapshot previews.
