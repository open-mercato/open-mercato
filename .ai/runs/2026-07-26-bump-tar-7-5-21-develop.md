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

- [x] 1.1 Apply the `tar` manifest and lockfile update on a branch based on `origin/develop`. — 9e0fe1723, 3ce7637b0
- [x] 1.2 Verify the focused dependency change and run the configured validation gate. — afd8b89aa

### Phase 2: Tracker handoff

- [x] 2.1 Finalize and review the replacement PR against `develop`, then close PR #4520 with a link to its replacement. — PR #4522; #4520 closed 2026-07-26T07:36:42Z; unblocked by merging `develop` (which carries #4608) in a71ea7bde

## Validation

**Source:** local run on merged head `a71ea7bde` (current `develop` merged in), plus GitHub Actions checks on the same head. **Runner:** local for the gate below; GitHub Actions for the full CI suite.

The `blocked` state this plan previously carried was caused by two phone custom-field translation keys missing from the `develop` base, not by this PR's diff. That fix landed upstream in #4608 (merged into `develop` 2026-07-30T14:45:15Z) and is now present on this branch.

| Gate command | Result |
|--------------|--------|
| `yarn generate` | ✅ pass |
| `yarn build:packages` | ✅ pass |
| `yarn i18n:check-sync` | ✅ pass — all translation files in sync |
| `yarn i18n:check-usage` | ✅ **exit 0, zero missing keys** (previously exit 1 on the two phone keys) |

Dependency integrity after merging 445 commits of `develop`: `package.json` still pins `"tar": "7.5.21"`, `packages/create-app/package.json` requests `^7.5.21`, and the lockfile contains exactly one `tar` descriptor — `tar@npm:7.5.21` → `7.5.21`. No downlevel `tar` remains reachable.
