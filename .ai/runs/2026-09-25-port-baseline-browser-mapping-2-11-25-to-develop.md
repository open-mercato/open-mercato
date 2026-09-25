# Port baseline-browser-mapping 2.11.25 to develop

## Goal

Recreate the lockfile-only dependency update from PR #6453 on a branch based on `develop`, ship it as a replacement pull request, and retire the original `main`-targeted PR with a cross-link.

## Scope

- Port the `baseline-browser-mapping` lockfile resolution from 2.10.8/2.11.21 to the shared 2.11.25 resolution already proposed by PR #6453.
- Preserve `develop` as the replacement PR's base and keep the product source and package manifests unchanged.
- Validate the resulting dependency graph through the repository's configured gate and an automated review pass.
- Close PR #6453 only after the replacement PR is ready and linked.

## Non-goals

- No package-manifest, application-code, generated-file, or database changes.
- No unrelated dependency refreshes or lockfile normalization.
- No merge of either pull request.

## Implementation Plan

### Phase 1: Port the dependency update

1. Reproduce PR #6453's `yarn.lock` delta on top of `origin/develop` while preserving its dependency authorship.
2. Confirm the resulting lockfile resolves both existing ranges to `baseline-browser-mapping` 2.11.25 with no unrelated changes.

### Phase 2: Verify and hand off

1. Run the configured validation gate, complete the authoritative PR review/autofix pass, finalize the replacement PR, and close PR #6453 with the replacement link.

## Risks

- `develop` may have lockfile drift relative to the original `main` base; the port must retain only the intended resolution change.
- Dependency-only validation can be broad and time-consuming, but the configured gate remains authoritative.
- Closing the source PR is irreversible tracker state, so it happens only after the replacement PR is ready.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Port the dependency update

- [ ] 1.1 Reproduce PR #6453's `yarn.lock` delta on top of `origin/develop` while preserving its dependency authorship.
- [ ] 1.2 Confirm the resulting lockfile resolves both existing ranges to `baseline-browser-mapping` 2.11.25 with no unrelated changes.

### Phase 2: Verify and hand off

- [ ] 2.1 Run the configured validation gate, complete the authoritative PR review/autofix pass, finalize the replacement PR, and close PR #6453 with the replacement link.
