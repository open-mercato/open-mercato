# Standalone Harness Canonical List UI Enforcement

- **Status:** Draft
- **Date:** 2026-07-31
- **Scope:** OSS standalone-app agent harness and generated-code evaluation
- **Related:** merged PR #4529, issue #4670, `.ai/specs/2026-07-24-standalone-ai-development-harness.md`, sibling spec `2026-07-31-standalone-harness-locale-catalog-completeness.md`

## TLDR

A Claude Sonnet 5 standalone-module run after PR #4529 generated a backend list with a raw HTML table instead of the canonical `DataTable`. Strengthen the existing OMH-185 complete-module oracle so the required Books route must contain route-scoped `DataTable`/`RowActions` evidence and cannot borrow unrelated evidence from elsewhere in the generated module.

This expands OMH-185 and its trusted writable/review lane. It does not add a duplicate CRUD case, change runtime UI APIs, or repair the generated `visits` module directly.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | Add a new case or expand existing coverage? | Expand OMH-185. | OMH-185 already owns complete generated modules and already claims canonical `DataTable` coverage. | OK |
| Q2 | Should the fix add Claude-specific prompting? | No; strengthen fixed route-scoped evaluation for every runner. | The framework invariant is model-independent. | OK |
| Q3 | Must valid list JSX live in `page.tsx`? | No; allow delegation anywhere under `backend/books/**`. | The case already requires that subtree and valid server/client decomposition should remain possible. | OK |
| Q4 | Should this remain combined with locale-catalog validation? | No; ship separate focused specs on one design PR. | Fresh-context review found each check independently deployable and testable. | OK |

## Overview

PR #4529 established the portable standalone harness and added the complete-module writable case. The backend-UI procedure and OMH-185 prompt already require `DataTable`, so the missing contract is at acceptance: `writable-ast-oracles.mjs` collects facts across all `src/modules/library/**`, then `module.table` accepts any `DataTable`, `RowActions`, `extensionTableId`, and action strings found anywhere in that aggregate.

That design permits evidence laundering. A correct component or disconnected declaration elsewhere can satisfy the oracle while the required list route renders a manual `<table>`. The supplied screenshot demonstrates the product-level symptom on `src/modules/visits/backend/page.tsx`.

## Problem Statement

The harness claims that OMH-185 proves a canonical extensible list, but its evidence is not bound to the route under evaluation. A model can therefore produce a backend list that forfeits DataTable pagination, loading/empty/error/export behavior, injection hosts, and stable table/action contracts while still passing a broad module-wide check.

Generated-code review can catch this semantically, but it is supplemental and runs only after prerequisite lanes pass. The fixed controller-owned oracle must reject the wrong artifact deterministically.

## Proposed Solution

Keep `packages/create-app/agentic/shared/ai/harness/writable-ast-oracles.mjs` as the one primary owner. Change the existing `module.table` check from module-wide facts to Books-list subtree facts, require canonical package imports and stable host props, and reject raw table tags inside that subtree. Add failure-first unit fixtures that prove the old aggregate check can pass the wrong route and the new check cannot.

## Scope Boundaries

### In scope

- Route-scoped OMH-185 `module.table` semantics.
- Failure-first negative and positive oracle tests.
- OMH-185 description/review evidence synchronization.
- Fresh-scaffold writable, target-build, generated-review, and Claude/Sonnet release proof.

### Out of scope

- Locale-catalog key validation; the sibling spec owns it.
- Runtime `DataTable` or `RowActions` changes.
- Repairing the generated `visits` module.
- Adding a canonical example module; PR #4728 owns that separate proposal.
- Completing unrelated broad certification in #4670.

## Research and Existing-System Findings

- `packages/create-app/agentic/shared/ai/skills/om-backend-ui-design/references/crud-surfaces.md` already requires exact `DataTable` and `RowActions` imports, stable IDs, controlled search/pagination, localized actions, and shared state behavior.
- `packages/create-app/agentic/shared/ai/review-checklist.md` already rejects manual list tables.
- OMH-014 validates a focused CRUD UI implementation; OMH-185 validates a complete vertical slice. The reported failure belongs to OMH-185 because it occurred during complete module generation.
- `collectSourceFiles` safely gathers TypeScript/TSX sources, and `collectFacts` retains import, JSX tag, JSX attribute, call, string, and object-property evidence. The implementation can reuse these mechanisms with a narrower source set.
- The [OpenHands evaluation-harness guidance](https://docs.openhands.dev/openhands/usage/developers/evaluation-harness) treats benchmark-specific result evaluation as an explicit workflow phase. This supports judging the required route artifact rather than accepting intermediate evidence elsewhere in an agent workspace.

## Goals and Success Criteria

1. A Books list subtree containing raw table markup fails `module.table` even if another module file contains sufficient canonical-looking evidence.
2. A valid Books route may delegate to a client component under `backend/books/**` and still pass.
3. Passing evidence includes exact canonical imports, `DataTable` JSX, stable entity/table identity, controlled search, and existing add/edit/delete acceptance.
4. The existing `module.table` check ID remains stable; only its semantics become stricter.
5. OMH-185 writable output, target validation, generated review, related cases, and the full requested Claude release suite pass from fresh scaffolds.

## Architecture

### One primary owner

The primary owner is `packages/create-app/agentic/shared/ai/harness/writable-ast-oracles.mjs`. The current backend-UI skill already states the desired behavior. Tests, case prose, and review policy support the oracle but do not duplicate its implementation contract.

If a pre-fix live trace proves the runner failed to load the existing backend-UI reference, routing/context ownership may be fixed separately through failure-first evidence. Do not add model-specific answer text.

### Route-scoped fact collection

For OMH-185, gather a second fact set from:

```text
src/modules/library/backend/books/**
```

Use `safeTargetEntry` and `collectSourceFiles`; never follow symlinks, import target code, execute target scripts, or inspect paths outside the disposable target. The subtree is already required by the case prompt and artifact contract.

### Stronger `module.table`

Retain the existing check ID and require all of the following from the list-subtree facts:

- `DataTable` imported from `@open-mercato/ui/backend/DataTable`.
- `RowActions` imported from `@open-mercato/ui/backend/RowActions`.
- A `DataTable` JSX use with `extensionTableId` plus `entityId` or `entityIds`.
- Controlled `searchValue` and `onSearchChange`; keep the existing server filter evidence.
- The canonical `/backend/library/books/create` add destination.
- Stable edit and delete action IDs/labels under the existing qualified-ID allowance.
- No raw `table`, `thead`, `tbody`, `tr`, `th`, or `td` JSX tags in the list subtree.

The route may render a component defined below it; the component does not need to live in `page.tsx`. Evidence outside the subtree cannot satisfy the check.

Keep `pageSize <= 100`, pagination completeness, state handling, and accessibility in generated-code review unless the AST representation is stable enough to add without false positives. This spec does not weaken any existing assertion.

### Fixed result contract

The oracle response remains:

```ts
type OracleCheck = {
  id: string
  passed: boolean
  requirement: string
}
```

Missing sources or unsafe paths produce a normal failed check with repository-relative, sanitized diagnostics. They must not crash the oracle or produce invalid structured output.

## Data Models

No application data model, migration, cache, queue, or tenant data changes.

## API Contracts

No runtime HTTP or component API changes. OMH-185 retains its case ID, validator ID, fixture, writable allowlist, timeout, release lane, and generated-review lane. `module.table` retains its ID with stricter artifact binding.

## Internationalization

No user-facing copy is added by this evaluator change. Localized actions remain part of the generated list contract, while deterministic locale-catalog resolution is defined in the sibling spec.

## UI/UX and Frontend Architecture

The implementation changes no product-rendering file, so UI mockups and the frontend architecture contract are N/A. The user-provided screenshot is diagnostic PR evidence and must not be committed with its local absolute path.

The generated output under test must use the canonical list family so it inherits stable extension hosts and the shared pagination/loading/empty/error/export behavior.

## Edge Cases and Failure Scenarios

| Scenario | Expected behavior |
|---|---|
| Raw Books table plus unrelated valid DataTable | Fail; unrelated evidence is ignored. |
| `page.tsx` delegates to `BooksTable.tsx` under the same subtree | Pass when the child fulfills the contract. |
| Valid DataTable imported from a backend barrel | Fail; standalone guidance requires the stable documented import path. |
| DataTable exists without `extensionTableId` | Fail. |
| DataTable uses uncontrolled client-only search | Fail existing controlled-search evidence. |
| Raw table exists only in an unrelated module path | Outside this check's claim; generated review still evaluates the complete changed slice. |
| Books subtree is missing or contains a symlink | Fail closed through safe-target guards. |
| Claude auth/capacity is unavailable | Requested release certification remains blocked; another runner cannot substitute. |

## Testing Strategy

### Failure-first oracle tests

Extend `packages/create-app/src/lib/writable-ast-oracles.test.ts`:

1. Stage a raw Books list plus a sibling module file with `DataTable`, `RowActions`, `extensionTableId`, create route, and action strings. Record that the unchanged aggregate check passes, then require the strengthened check to fail.
2. Stage a canonical DataTable implementation inside `backend/books/**` and require a pass.
3. Stage delegation from `page.tsx` to a subtree client component and require a pass.
4. Stage missing canonical import, missing stable ID, and raw-table-tag variants and require targeted failures.
5. Verify the oracle always returns schema-valid JSON and sanitized requirements.

### Focused and package gates

```bash
node --import tsx --test --test-name-pattern="complete module oracle" packages/create-app/src/lib/writable-ast-oracles.test.ts
yarn workspace create-mercato-app test
```

Then emit a fresh standalone controller and run:

```bash
yarn harness:validate --case OMH-185
yarn harness:validate --runner claude --case OMH-185 --writable-root /absolute/disposable/app --acknowledge-writes
yarn harness:validate --family module
yarn harness:validate --all
```

Use a fresh disposable target for every writable run. After a passing oracle, run target `yarn generate`, `yarn typecheck`, `yarn lint`, and `yarn build`, then run the isolated generated-code review. Rerun related OMH-014 and mandatory safety cases.

From a fresh controller with pinned skills, finish with:

```bash
yarn install-skills
yarn harness:release --runner claude --prepare-targets /absolute/empty-release-targets --acknowledge-writes
```

Require the schema-valid mode-`0600` sanitized release report and every requested lane to pass. `yarn harness:validate --all` is not a substitute for the release suite.

### Repository gate

Use one Docker/local runner per `.ai/docs/agent-instructions.md`, then run `yarn build:packages`, `yarn generate`, the second `yarn build:packages`, `yarn typecheck`, and `yarn test`. Run `yarn build:app` if emitted/template output changes.

## Phasing and Implementation Plan

### Phase 1 — Prove the aggregate-evidence defect

1. Add the disconnected-valid-evidence/raw-list fixture.
2. Run it against the unchanged oracle and retain the sanitized false-pass evidence.
3. Run a fresh OMH-185 Claude attempt when capacity is available and classify the result honestly.

### Phase 2 — Bind the oracle to the required route

1. Add route-subtree source collection.
2. Strengthen `module.table` with imports, props, actions, and raw-tag rejection.
3. Add positive delegation and negative variant tests.
4. Keep failures structured and sanitized.

### Phase 3 — Synchronize and certify

1. Tighten OMH-185/review documentation without adding a case ID.
2. Run focused, package, deterministic, related, and mandatory gates.
3. Run fresh writable target validation and generated review.
4. Run the full Claude/Sonnet release suite and publish only sanitized evidence.

Each phase leaves the harness valid; the oracle change does not land without its regression tests.

## Risks and Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Valid component lives outside required subtree | Medium | Case prompt already owns `backend/books/**`; allow all nested delegation within it. | Low for OMH-185. |
| Alias/barrel import causes a false negative | Low | Enforce the documented standalone import path deliberately and test its diagnostic. | Low. |
| Disconnected evidence remains inside the subtree | Medium | Require canonical import, JSX, props, actions, and absence of raw tags together; retain generated review. | Low to medium. |
| Stricter check lowers current runner pass rate | Medium | Treat semantic failures as defects, not reasons to weaken the oracle; preserve timeouts and fresh targets. | Medium. |
| Model-specific prose duplicates the contract | Medium | Keep the fixed oracle as owner; guidance changes require separate trace evidence. | Low. |

### Rollback

Revert route-scoped logic, its focused tests, and synchronized prose together. Do not renumber OMH-185 or remove `module.table`. A legitimate false positive requires a failing fixture before the check is narrowed.

## Migration and Backward Compatibility

No runtime migration and no protected contract change. Public imports, DataTable APIs, routes, events, ACL/DI IDs, database schema, and generated bootstrap registries remain unchanged. The existing harness check ID is preserved.

## Final Compliance Report — 2026-07-31

| Rule source | Status | Notes |
|---|---|---|
| Root AGENTS.md standalone-harness routing | Compliant | Uses failure-first evolve/refresh and full release contracts. |
| UI AGENTS.md canonical lists | Compliant | Requires DataTable/RowActions and rejects manual list markup at the required route. |
| create-app AGENTS.md standalone parity | Compliant | Requires fresh emitted controller and target validation. |
| om-evolve-harness one-owner rule | Compliant | `writable-ast-oracles.mjs` is the sole primary owner. |
| BACKWARD_COMPATIBILITY.md | Compliant | No stable runtime or generated registry surface changes. |
| QA self-contained tests | Compliant | Temporary fixtures and fresh targets own all state. |
| Scope cohesion | Compliant | This spec owns only canonical list UI acceptance; locale validation was split out. |

**Verdict:** Fully compliant and ready for implementation after spec review. No assumption requires human confirmation.

## Changelog

- 2026-07-31: Split from the combined UI/i18n draft after mandatory fresh-context scope review; defined route-scoped OMH-185 canonical list enforcement.

### Review — 2026-07-31

- **Reviewer:** Agent plus mandatory fresh-context scope reviewer
- **Security:** Passed; safe target boundaries remain mandatory.
- **Performance:** Passed; source collection is bounded to the existing case subtree.
- **Cache/Commands/Data:** N/A; no runtime behavior or persistence changes.
- **Risks:** Passed with route-placement and evidence-laundering mitigations.
- **Verdict:** Approved after split; fresh-context per-file scope recheck passed.
