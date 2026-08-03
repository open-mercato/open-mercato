# Rebuild relation labels on custom-entity record lists

## Goal

Recreate the useful intent of closed PR #4300 on a fresh `develop` base so relation columns in generic custom-entity record lists show human-readable labels for both custom and system-entity targets without inheriting the original conflicts or CLA history.

## Scope

- Keep the relation target metadata additive and limited to relation-kind field definitions.
- Reuse the existing QueryEngine-backed relation options endpoint and shared display resolver instead of querying the custom-record-only endpoint.
- Render resolved labels and supported deep links while retaining raw IDs as the failure fallback and cell title.
- Add regression coverage for single and multi relations, request batching/chunking, synthesized relation URLs, and fetch failures.

## Non-goals

- Do not revive or modify PR #4300 or its contributor branch.
- Do not change relation storage, the relation options API contract, or unrelated generic-record behavior.
- Do not alter database schema, permissions, or tenant/organization scoping.

## Implementation Plan

### Phase 1: Correct relation display resolution

1. Expose relation target metadata additively and resolve record-list relation values through the shared relation-options path.
2. Render labels and supported links in relation cells while preserving raw-ID titles and progressive fallback behavior.

### Phase 2: Regression coverage and delivery

1. Add focused tests for metadata exposure, single/multi values, batched chunks, synthesized URLs, and failed lookups.
2. Run the configured validation gate, complete the authoritative autofix review, and finalize the PR for review.

## Risks

- Relation definitions created outside the current editor may omit `optionsUrl`; synthesizing it from `relatedEntityId` preserves compatibility with those definitions.
- Multiple relation fields can contain the same raw ID for different targets; display maps must remain field-scoped to avoid cross-entity label collisions.
- Relation lookup failures must not make the list unusable; raw IDs remain the stable fallback.

## Progress

PR: #4904

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Correct relation display resolution

- [x] 1.1 Expose relation target metadata additively and resolve record-list relation values through the shared relation-options path. — 85de7cf645
- [x] 1.2 Render labels and supported links in relation cells while preserving raw-ID titles and progressive fallback behavior. — 85de7cf645

### Phase 2: Regression coverage and delivery

- [x] 2.1 Add focused tests for metadata exposure, single/multi values, batched chunks, synthesized URLs, and failed lookups. — 85de7cf645
- [ ] 2.2 Run the configured validation gate, complete the authoritative autofix review, and finalize the PR for review.
