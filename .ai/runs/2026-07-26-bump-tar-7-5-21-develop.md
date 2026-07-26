# Bump tar to 7.5.21 on develop

## Goal

Migrate the `tar` dependency update from PR #4520 onto the configured `develop` base branch, verify the resulting dependency graph, open a replacement PR, and close the original `main`-based PR.

## Scope

- Update `packages/create-app/package.json` from `tar ^7.5.20` to `tar ^7.5.21` on `develop`.
- Regenerate the corresponding Yarn lockfile entries.
- Run targeted dependency checks and the configured validation gate.
- Replace PR #4520 with a new PR targeting `develop`, retaining a clear audit trail between them.

## Non-goals

- No application behavior, public API, database schema, or module contract changes.
- No unrelated dependency upgrades or lockfile cleanup.
- No changes to Dependabot configuration.

## Implementation Plan

### Phase 1: Migration

1. Apply the `tar` manifest and lockfile update on a branch based on `origin/develop`.
2. Verify the focused dependency change and run the configured validation gate.

### Phase 2: Tracker handoff

1. Finalize and review the replacement PR against `develop`, then close PR #4520 with a link to its replacement.

## Risks

- The lockfile could pick up unrelated drift; constrain regeneration and inspect the exact diff.
- A dependency regression could affect standalone app archive handling; package builds and the configured repository gate provide automated coverage.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Migration

- [ ] 1.1 Apply the `tar` manifest and lockfile update on a branch based on `origin/develop`.
- [ ] 1.2 Verify the focused dependency change and run the configured validation gate.

### Phase 2: Tracker handoff

- [ ] 2.1 Finalize and review the replacement PR against `develop`, then close PR #4520 with a link to its replacement.
