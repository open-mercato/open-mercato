# Migrate PR #4645 to develop

## Goal

Recreate PR #4645's Next.js 16.2.12 dependency update on `develop`, address the review-requested standalone template parity fix, and leave a validated replacement PR while keeping the original PR closed.

## Scope

- Preserve the original dependency bump in the root and Mercato app manifests.
- Mirror the exact Next.js pin into the standalone create-app template as required by its dependency-parity contract.
- Regenerate only the Yarn lockfile entries required by the Next.js patch update.
- Reuse the existing template dependency drift test as regression coverage and run the repository's configured validation gate.

## Non-goals

- Upgrade unrelated dependencies or change application behavior.
- Change scaffold modes, generator architecture, public contracts, database structure, or API surfaces.
- Reopen or modify the Dependabot branch behind PR #4645.

## Implementation Plan

### Phase 1: Migrate and correct the dependency update

1. Reapply PR #4645's Next.js 16.2.12 manifest and lockfile changes on top of `develop` while preserving the original commit attribution.
2. Address the code-review finding by synchronizing the standalone create-app template pin and prove parity with the focused regression test.

### Phase 2: Validate and deliver the replacement

1. Run the configured validation gate in order and resolve any failures attributable to this change.
2. Complete the authoritative review/autofix pass, finalize the replacement PR metadata, and confirm the original PR remains closed.

## Risks

- The original lockfile was generated from `main`; replaying it on `develop` may conflict with newer lockfile entries. Resolve by regenerating only the dependency-derived lockfile changes on `develop`.
- A framework patch can expose build or type incompatibilities. The complete package, generation, test, typecheck, and app-build gate covers those surfaces.
- No new test is planned because the existing `template-dependency-drift.test.ts` test directly reproduces and prevents the review finding.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Migrate and correct the dependency update

- [x] 1.1 Reapply PR #4645's Next.js 16.2.12 manifest and lockfile changes on top of `develop` while preserving the original commit attribution. — 2e6bd84a6
- [ ] 1.2 Address the code-review finding by synchronizing the standalone create-app template pin and prove parity with the focused regression test.

### Phase 2: Validate and deliver the replacement

- [ ] 2.1 Run the configured validation gate in order and resolve any failures attributable to this change.
- [ ] 2.2 Complete the authoritative review/autofix pass, finalize the replacement PR metadata, and confirm the original PR remains closed.
