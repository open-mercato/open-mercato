# Migrate PR #4650 to develop

## Goal

Recreate the dependency update from PR #4650 on the repository's configured `develop` base, validate the migrated update, publish a replacement PR, and close the original `main`-targeted PR only after the replacement is ready.

## Scope

- Start from the current `origin/develop` head.
- Preserve PR #4650's direct dependency-version intent across the root and workspace manifests.
- Reconcile `yarn.lock` against the current `develop` dependency graph.
- Run the repository's configured validation gate and the authoritative automated PR review.
- Link and close PR #4650 after the replacement PR is ready for review.

## Non-goals

- Do not introduce unrelated dependency upgrades beyond the versions requested by PR #4650.
- Do not change application behavior, public contracts, database schema, or source code.
- Do not merge the replacement PR.

## Implementation Plan

### Phase 1: Port the dependency update

1. Replay PR #4650's manifest version changes onto `origin/develop` and regenerate a coherent lockfile.
2. Compare the migrated delta with PR #4650 to confirm that all still-applicable dependency updates are preserved without reverting newer `develop` changes.

### Phase 2: Validate the migrated dependency graph

1. Run the configured validation commands in order and resolve failures attributable to the migration.

### Phase 3: Publish the replacement and retire the original

1. Finalize and review the replacement PR against `develop`, including normalized labels and a comprehensive verification summary.
2. Close PR #4650 with a comment linking the ready replacement PR.

## Risks

- `develop` is hundreds of commits ahead of the original PR base, so a direct cherry-pick may conflict in manifests or the lockfile; resolution must retain newer `develop` entries while applying only the requested version bumps.
- The update spans runtime, build, test, ORM, queue, AI, UI, and integration dependencies, so the full validation gate is necessary even though no source files change.
- PR #4650 previously had a failing test check; the replacement must be judged against current `develop`, not the stale source branch's CI result.

## Progress

PR: #4804

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Port the dependency update

- [x] 1.1 Replay PR #4650's manifest version changes onto `origin/develop` and regenerate a coherent lockfile. — df78b530e
- [x] 1.2 Compare the migrated delta with PR #4650 to confirm that all still-applicable dependency updates are preserved without reverting newer `develop` changes. — df78b530e

### Phase 2: Validate the migrated dependency graph

- [ ] 2.1 Run the configured validation commands in order and resolve failures attributable to the migration.

### Phase 3: Publish the replacement and retire the original

- [ ] 3.1 Finalize and review the replacement PR against `develop`, including normalized labels and a comprehensive verification summary.
- [ ] 3.2 Close PR #4650 with a comment linking the ready replacement PR.
