# Consolidate page-two Dependabot updates

## Goal

Replace the seven open Dependabot pull requests shown on page 2 of the open-PR search with one verified dependency-update pull request targeting `develop`, then close the superseded pull requests with a link to the consolidated replacement.

## Scope

- Consolidate PRs #6200, #6201, #6202, #6203, #6204, #6205, and #6206.
- Carry their requested versions for `sanitize-html`, `baseline-browser-mapping`, `postcss-selector-parser`, `@humanfs/node`, `joi`, `body-parser`, and `colord` onto the current `develop` dependency graph.
- Preserve the existing dependency ranges except for the two direct `sanitize-html` pins already changed by #6200.
- Add focused regression coverage for the sanitizer upgrade where it materially protects application behavior.
- Run the configured validation gate and authoritative automated review before superseding the source PRs.

## Non-goals

- Do not include Dependabot PR #5857, which is not part of the referenced page-2 set.
- Do not modify Dependabot configuration or dependency ranges unrelated to the seven source PRs.
- Do not merge any of the source PRs or target the consolidated PR at `main`.

## Implementation Plan

### Phase 1: Consolidate dependency updates

1. Re-resolve the seven requested dependency versions from the current `develop` manifests and lockfile.
2. Add focused sanitizer regression coverage and run the affected package tests.

### Phase 2: Verify and supersede

1. Run the configured full validation gate and the authoritative PR review, fixing any dependency-related regressions.
2. Finalize the consolidated PR and close PRs #6200–#6206 with replacement links.

## Risks

- The source PRs target `main`, while this run targets `develop`; regenerating the lockfile from `develop` avoids copying stale graph state.
- `sanitize-html` 2.17.7 moves to an ESM-aware parser stack and requires Node.js 22.12 or newer; the repository pins Node.js 24.x.
- Closing the seven source PRs is deferred until the consolidated PR exists and passes local validation and review, so the updates remain recoverable if implementation is interrupted.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Consolidate dependency updates

- [ ] 1.1 Re-resolve the seven requested dependency versions from the current `develop` manifests and lockfile.
- [ ] 1.2 Add focused sanitizer regression coverage and run the affected package tests.

### Phase 2: Verify and supersede

- [ ] 2.1 Run the configured full validation gate and the authoritative PR review, fixing any dependency-related regressions.
- [ ] 2.2 Finalize the consolidated PR and close PRs #6200–#6206 with replacement links.
