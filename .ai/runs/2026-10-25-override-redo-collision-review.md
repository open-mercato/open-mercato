# Execution plan — override creation redo collisions (adopted from PR #7717)

**Origin:** Reconstructed by `om-auto-continue-pr --adopt auto` on 2026-10-25 because this PR had no tracking plan.
**PR:** https://github.com/open-mercato/open-mercato/pull/7717
**Author:** @haxiorz

## Goal

Preserve the recorded override identity during creation redo while refusing an occupied toggle/tenant slot with a deliberate translated HTTP 409.

## Scope

The feature-toggle override creation redo, its conflict translations, and focused command regressions.

## Non-goals

No schema, dependency, API-shape, command-bus, authorization, or QA/pipeline changes. Preserve existing update, clear, no-op clear, and undo behavior. Do not overwrite an occupying row or expose another tenant.

## Evidence

- PR #7717 and issue #7665 establish identity-preserving creation redo.
- Review https://github.com/open-mercato/open-mercato/pull/7717#pullrequestreview-5643491623 reports the occupied `(toggle_id, tenant_id)` unique-key failure and requests a 409 plus regression coverage.
- The shared `makeCreateRedo` uses `isUniqueViolation` to translate insert races to conflicts.

## Assumptions and risks

The existing PR base, `main`, is authoritative. A scoped precheck protects the occupying row; the unique constraint remains authoritative for concurrent insert races. Cache invalidation happens only after successful persistence. Existing API lifecycle coverage remains applicable.

## Progress

### Phase 1: Already landed on this PR

- [x] 1.1 Preserve creation redo identity and cover the lifecycle — 91b76432ee8a428e7b746d29711c8e81911b7790

### Phase 2: Address the collision review

- [x] 2.1 Add occupied-slot and uniqueness-race conflicts with no-mutation and retry coverage. — 4b4fd495800dd557ce6510fc2f930d7c4753be4c
- [x] 2.2 Run focused red/green tests, scoped compiler/lint checks, and lessons validation; review compatibility and scope. — 4b4fd495800dd557ce6510fc2f930d7c4753be4c
- [x] 2.3 Publish on the existing branch, report evidence, request re-review, and release the claim. — 4b4fd495800dd557ce6510fc2f930d7c4753be4c

## Validation and handoff

Runner: local. The isolated compose profiles could not be used without local environment configuration. Shared dependencies and task-owned test overlays were consumed read-only.

- Red: six regression failures against the original command; existing cases remained green.
- Green: 35/35 override command tests, plus all 15 feature-toggle suites / 127 tests.
- Scoped semantic TypeScript check of command, test, and import graph: zero diagnostics.
- Scoped ESLint, `git diff --check`, all-locale translation sync, module translation values, and lessons catalog checks (5/5) passed.
- Current-head CI is pending. Previous full-gate evidence on `91b76432ee` is historical; it is not a green claim for the follow-up.
- Author-side compatibility and code review: https://github.com/open-mercato/open-mercato/pull/7717#pullrequestreview-5644704849. No remaining actionable code findings; no self-approval.
- @wojciechszyjka was requested for re-review through the GitHub reviewer-request API. `changes-requested`, `skip-qa`, category, priority and risk labels are preserved.

No main merge was needed: the fetched current base was mergeable, and this fix does not depend on unrelated main changes. No migration, schema, public API-shape, discovery, or dependency changes were made.
