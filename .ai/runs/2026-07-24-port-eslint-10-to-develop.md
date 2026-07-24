# Port ESLint 10 to develop

## Goal

Port the ESLint 10.7.0 dependency update from PR #4295 onto `develop`, keep the standalone create-app template aligned, and replace the original `main`-targeted PR with a validated `develop`-targeted PR.

## Scope

- Update the root workspace, Mercato app, and create-app template ESLint ranges to `^10.7.0`.
- Regenerate the Yarn lockfile against the current `develop` dependency graph.
- Run focused lint and dependency consistency checks, followed by the repository validation gate.
- Open a replacement PR against `develop`, then close PR #4295 with a link to the replacement.

## Non-goals

- Do not upgrade unrelated dependencies.
- Do not change ESLint rules or application behavior.
- Do not merge either PR.

## Implementation Plan

### Phase 1: Port dependency update

1. Apply the ESLint 10.7.0 ranges to all aligned package manifests.
2. Regenerate the lockfile and confirm the diff contains no unrelated dependency changes.

### Phase 2: Verify and publish

1. Run focused dependency, template, and lint validation.
2. Run the configured full validation gate and review compatibility/security scope.
3. Finalize the replacement PR and close the superseded original PR.

## Risks

- ESLint 10 is a major toolchain update and may expose new lint incompatibilities.
- Lockfile regeneration on `develop` can pull unrelated resolutions unless the manifest edits and resulting diff are reviewed closely.
- The create-app template must remain aligned with the monorepo package versions.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Port dependency update

- [ ] 1.1 Apply the ESLint 10.7.0 ranges to all aligned package manifests
- [ ] 1.2 Regenerate the lockfile and confirm the diff contains no unrelated dependency changes

### Phase 2: Verify and publish

- [ ] 2.1 Run focused dependency, template, and lint validation
- [ ] 2.2 Run the configured full validation gate and review compatibility/security scope
- [ ] 2.3 Finalize the replacement PR and close the superseded original PR
