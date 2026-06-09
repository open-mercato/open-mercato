# Execution Plan: Re-target Dependabot minor-and-patch group to `develop` (#2867)

## Goal

Recreate Dependabot PR #2867 — which mistakenly targets `main` — as a PR against
`develop`, then close the original #2867.

## Background

PR #2867 (`build(deps): bump the minor-and-patch group across 1 directory with 11
updates`) is a Dependabot PR opened against `main`. The repo's integration branch is
`develop`. Dependabot's base-branch config can't be fixed from a single retarget, so
we reproduce the identical dependency bumps on a `develop`-based branch and close the
original. Verified that `develop`'s package.json specifiers for every affected package
are identical to `main`'s pre-bump state, so the bump applies cleanly.

## Scope

Apply the same 11 grouped minor/patch dependency bumps to the workspace `package.json`
files and regenerate `yarn.lock` against `develop`'s tree.

| Package | From | To |
|---------|------|----|
| ai | ^6.0.197 / 6.0.194 | ^6.0.198 / 6.0.198 |
| semver | ^7.8.2 | ^7.8.3 |
| @stripe/stripe-js | ^9.7.0 | ^9.8.0 |
| imapflow | ^1.0.171 | ^1.3.7 |
| svix | ^1.95.1 | ^1.95.2 |
| tar (resolutions) | 7.5.13 | 7.5.16 |
| rate-limiter-flexible | ^11.1.1 | ^11.2.0 |
| @aws-sdk/client-s3 | ^3.1063.0 | ^3.1064.0 |
| @aws-sdk/s3-request-presigner | ^3.1063.0 | ^3.1064.0 |
| @radix-ui/react-scroll-area | ^1.2.0 | ^1.2.11 |
| @radix-ui/react-slider | ^1.2.0 | ^1.4.0 |

## Non-goals

- No source-code changes, refactors, or behavior changes.
- No major-version bumps beyond what Dependabot grouped.
- No changes to Dependabot config.

## Risks

- `@radix-ui/react-slider` 1.3→1.4 and `ai` SDK bumps are the most behavioral; covered
  by build + typecheck + unit tests.
- `yarn.lock` regenerated against `develop` may differ from #2867's lock if develop's
  transitive tree diverged; that is correct and expected.

## Implementation Plan

### Phase 1: Apply dependency bumps

- 1.1 Edit the 12 workspace `package.json` files to the target versions
- 1.2 Run `yarn install` to regenerate `yarn.lock`

### Phase 2: Validate

- 2.1 Run `yarn build:packages`, `yarn typecheck`, `yarn test`
- 2.2 Open PR against `develop`, close #2867

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Apply dependency bumps

- [x] 1.1 Edit workspace package.json files to target versions — 016a7a02b
- [x] 1.2 Regenerate yarn.lock via yarn install — 016a7a02b

### Phase 2: Validate

- [ ] 2.1 Run build:packages / typecheck / test
- [ ] 2.2 Open PR against develop and close #2867
