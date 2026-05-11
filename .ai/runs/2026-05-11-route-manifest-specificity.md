# Route Manifest Specificity Fix

**Branch:** `fix/route-manifest-specificity`
**Date:** 2026-05-11
**Closes:** #1870

## Overview

Fix `findRouteManifestMatch` and `findApiRouteManifestMatch` in
`packages/shared/src/modules/registry.ts` so that literal URL segments beat
dynamic `[param]` segments, and dynamic segments beat catch-all `[...param]`
segments, matching the precedence rules of every standard router (Next.js,
React Router, Express).

**Root cause:** The auto-generated manifests emit routes alphabetically by
file path. ASCII `[` (0x5B) sorts before lowercase letters, so dynamic
segments always appear before sibling literal segments in the manifest. Both
`findRouteManifestMatch` and `findApiRouteManifestMatch` use first-match-wins
iteration with no specificity sort, making `/things/new` unreachable whenever
a `things/[id]` route exists in the same module.

**Affected file:** `packages/shared/src/modules/registry.ts`
**Test file:** `packages/shared/src/modules/__tests__/registry.test.ts`

### Scope

- Add `sortRoutesBySpecificity` (exported, for downstream app workaround).
- Apply it inside `registerFrontendRouteManifests`, `registerBackendRouteManifests`, and `registerApiRouteManifests` — sort once at registration, not per match.
- Expand unit tests to cover all specificity orderings.

### Non-goals

- Do not touch `findFrontendMatch`, `findBackendMatch`, or `findApi` — those
  operate on `Module[]` with module-order precedence and are not mentioned in
  the issue.
- Do not change manifest generation order in the CLI generator (the
  registration-time sort is sufficient and avoids generator churn).
- Do not change any API response shapes, event IDs, or other contract
  surfaces.

## Implementation Plan

### Phase 1: Core fix — specificity sort at manifest registration

1.1 Add `segmentSpecificity` (internal) and `sortRoutesBySpecificity` (exported) helpers to `registry.ts`.
1.2 Apply `sortRoutesBySpecificity` in `registerFrontendRouteManifests`, `registerBackendRouteManifests`, and `registerApiRouteManifests`.

### Phase 2: Tests

2.1 Add `findRouteManifestMatch` and `findApiRouteManifestMatch` specificity test suite.
2.2 Add `sortRoutesBySpecificity` ordering test suite.

## Risks

- **Ordering change is a strict improvement** — no app today relies on
  dynamic segments winning over literals; that was an accidental behaviour
  caused by ASCII sort.
- **No contract surface changes** — `sortRoutesBySpecificity` is a new
  export; existing exports are unchanged.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Core fix — specificity sort at manifest registration

- [ ] 1.1 Add `segmentSpecificity` and `sortRoutesBySpecificity` helpers
- [ ] 1.2 Apply sort in all three register functions

### Phase 2: Tests

- [ ] 2.1 Add `findRouteManifestMatch` and `findApiRouteManifestMatch` specificity tests
- [ ] 2.2 Add `sortRoutesBySpecificity` ordering tests
