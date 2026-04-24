## Overview

- Goal: align customer detail endpoint custom-field responses with the existing shared convention, restore cosmetic dependency ordering in `packages/shared/package.json`, and document the correct response-shape rule in monorepo and standalone AGENTS guidance.
- Scope:
  - `packages/core/src/modules/customers/api/people/[id]/route.ts`
  - `packages/core/src/modules/customers/api/companies/[id]/route.ts`
  - focused test coverage for the response-shape normalization
  - `packages/shared/package.json`
  - root and standalone AGENTS guidance that covers custom-field detail endpoint response shape
- Non-goals:
  - root-cause rework for the example sync polling loops
  - broader migration of every custom-field detail endpoint outside the targeted customer detail surfaces
  - changes to persisted custom-field storage or request payload contracts
- Source spec: `.ai/specs/implemented/SPEC-046-2026-02-25-customer-detail-pages-v2.md`

## Risks

- Detail endpoints are part of a stable API surface, so the response-shape alignment must preserve all existing fields and only normalize custom-field keys to the documented bare-key shape inside `customFields`.
- AGENTS guidance must stay synchronized between monorepo and standalone templates; missing one copy would reintroduce drift.
- Tests should avoid broad route integration setup and stay focused on the normalization contract to keep the change small and deterministic.

## Implementation Plan

### Phase 1: API contract alignment

- 1.1 Extract or reuse the shared response normalization path for people and company detail custom fields
- 1.2 Add focused coverage that locks the `customFields` response shape to bare keys for customer detail endpoints

### Phase 2: Guidance and cleanup

- 2.1 Restore alphabetical dependency ordering in `packages/shared/package.json`
- 2.2 Update monorepo and standalone AGENTS guidance to require bare-key `customFields` detail responses via the shared helper

### Phase 3: Validation and delivery

- 3.1 Run targeted validation, review the diff for BC/scope, and open the PR with the required summary

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API contract alignment

- [x] 1.1 Extract or reuse the shared response normalization path for people and company detail custom fields — 6805aa444
- [x] 1.2 Add focused coverage that locks the `customFields` response shape to bare keys for customer detail endpoints — 6805aa444

### Phase 2: Guidance and cleanup

- [x] 2.1 Restore alphabetical dependency ordering in `packages/shared/package.json` — 6805aa444
- [x] 2.2 Update monorepo and standalone AGENTS guidance to require bare-key `customFields` detail responses via the shared helper — 6805aa444

### Phase 3: Validation and delivery

- [ ] 3.1 Run targeted validation, review the diff for BC/scope, and open the PR with the required summary
