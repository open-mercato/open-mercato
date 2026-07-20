# Stable Workflow Activity Outputs

## TLDR

Persist every compatible successful workflow activity result under the definition-stable path `context.activities[activityId]`. The new namespace covers synchronous transition activities, synchronous step activities, and completed asynchronous activities while preserving every existing result alias and all unrelated context values. A legacy alias named exactly `activities` is the sole compatibility exception and suppresses the stable write for that activity.

This is an additive workflow-context contract. It adds no route, UI, entity, migration, event, command, dependency, or module coupling.

## Overview

Workflow definitions need a stable way to address an earlier activity result. Activity IDs are already definition-owned identifiers, but result placement currently depends on the activity name, activity type, or asynchronous completion convention.

The proposed namespace makes the activity ID the canonical lookup key without removing the legacy paths. A later transition condition, activity input mapping, or signal-correlation feature can read `activities.<activityId>` regardless of how the activity executed.

The design follows the state-placement principle represented by [AWS Step Functions `ResultPath`](https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultpath.html): task output can be combined with existing workflow state at a stable location. Open Mercato does not adopt JSONPath mutation or configurable result paths in this scope; it uses one deterministic namespace derived from the existing activity ID.

## Problem Statement

Successful workflow activity results are currently addressable through legacy conventions:

- synchronous results use `activityName || activityType`;
- asynchronous results use `${activityId}_result`.

Those conventions are valid runtime behavior and must remain available, but they are not a durable definition contract. Names can be edited, types are not unique, and synchronous versus asynchronous execution changes the lookup convention. A definition that needs the ID returned by an earlier `CALL_API` activity therefore has no single stable path.

## Goals

- Write every compatible successful activity output to `context.activities[activityId]`.
- Cover synchronous transition, synchronous step, and completed asynchronous activity paths.
- Preserve existing synchronous and asynchronous aliases unchanged.
- Merge with existing `context.activities` entries instead of replacing the object.
- Make retries and branch execution deterministic.
- Keep behavior unchanged for definitions that do not read the new namespace.

## Non-Goals

- Adding or changing `WAIT_FOR_SIGNAL` behavior.
- Adding correlation, polling, retry, or timeout semantics.
- Adding configurable result paths or a general expression language.
- Changing activity IDs, definition validation, or editor behavior.
- Removing or deprecating legacy result aliases.
- Persisting output outside the existing workflow context JSON.
- Adding entities, migrations, API routes, events, commands, or cache entries.

## User Stories and Use Cases

- A workflow author references the result of a named activity by its immutable definition ID.
- A transition condition reads the same output path whether the producer ran synchronously or asynchronously.
- A parallel branch reads the output produced in its effective context without changing sibling-branch behavior.
- A future workflow capability can consume a stable activity result without coupling its contract to legacy aliases.

## Proposed Solution

After an activity completes successfully, merge its output into the effective workflow context:

```ts
context.activities[activityId] = output
```

The write occurs at the same point where each execution path currently writes its legacy alias. It must not make a failed or still-pending activity visible as completed.

### Merge rules

1. If `context.activities` is absent, create an object containing the current activity ID.
2. If it is an object, preserve its entries and set the current activity ID.
3. Re-execution of the same activity ID replaces that ID's previous output deterministically.
4. Preserve every unrelated top-level context key.
5. Continue writing the current legacy alias in the same batch.
6. If the current legacy alias is literally `activities`, preserve its value exactly and omit the nested activity-ID write for that activity, regardless of the output's shape.

The last rule is a narrow compatibility exception for an existing naming collision. It is distinct from an unrelated pre-existing object at `context.activities`, which is merged normally. Definitions should avoid naming an activity `activities` when they need the stable namespace.

### Execution paths

The same merge contract applies to:

- transition activities completed synchronously;
- step activities completed synchronously;
- asynchronous activities when their durable completion result is applied.

Each path uses the effective root or branch context already selected by the executor. The feature does not introduce cross-branch reads, shared mutable context, or a new merge strategy.

## Architecture

```text
activity succeeds
  -> existing execution path selects effective context
  -> existing legacy alias is preserved
  -> activities[activityId] is merged when compatible
  -> existing context persistence continues
```

The change belongs entirely to the workflows module's existing activity-result application paths. A small shared merge helper is justified only if all three current call sites need identical conflict behavior; otherwise the existing local result-assignment helper should be extended directly. No new public abstraction or package export is required.

## Data Models

No entity or schema change is required. `WorkflowInstance.context` and branch context already persist JSON-compatible activity outputs.

The namespace duplicates references within the same persisted JSON document: the legacy alias and stable activity-ID alias may both contain the output. This preserves compatibility at the cost of bounded per-activity context growth.

## API Contracts

No HTTP, command, event, DI, or package API changes.

Workflow instance responses that already expose context may include the additive `activities` object after a successful activity. Existing fields and aliases remain unchanged.

## UI/UX

No UI changes. The workflow editor already owns activity IDs, and this specification does not add path pickers, labels, validation messages, or visualization changes.

## Security, Privacy, Performance, and Cache

- The stable alias contains the same output already persisted under a legacy key; it does not introduce a new data source or authorization boundary.
- Existing tenant and organization scoping on workflow instance access remains unchanged.
- No output is added to logs, events, URLs, or client storage beyond existing context responses.
- Duplicating output under an additional JSON key increases persisted context size. The increase is proportional to successful activity outputs and does not create an unbounded list or history.
- No cache is added or changed. Mutable workflow execution context remains uncached.

## Migration and Backward Compatibility

- No database migration or backfill.
- Existing workflow definitions require no update.
- Existing synchronous and asynchronous aliases remain exact.
- Existing context values are preserved, including a non-object legacy `activities` alias.
- Existing retries, branch merges, execution ordering, and failure semantics remain unchanged.
- The new path is additive and available only for activity results completed after deployment; historical context is not rewritten.

## Implementation Approach

### Phase 1 — Contract tests

1. Add failing tests for synchronous transition, synchronous step, and asynchronous completion outputs.
2. Cover existing-object merge, absent-object creation, same-ID replacement, and unrelated context preservation.
3. Lock compatibility behavior for both synchronous and asynchronous legacy aliases.
4. Cover object and non-object collisions on the top-level `activities` key.

This phase is test-only and precisely defines the compatibility boundary.

### Phase 2 — Result application

1. Extend the existing activity-result merge path, reusing one internal helper only where it reduces duplication across current call sites.
2. Apply the stable alias at successful completion for all three execution paths.
3. Keep pending, failed, and retry scheduling paths unchanged.

This phase is complete when the focused workflow executor tests pass without changing public contracts.

### Phase 3 — Regression verification

1. Run focused workflow activity and parallel-branch suites.
2. Run workflow package typecheck and the smallest relevant build gate.
3. Verify no generated registry or migration changed.

## Integration and Test Coverage

### Module coverage

- Transition activity success writes both the legacy alias and `activities[activityId]`.
- Step activity success writes both aliases.
- Async completion writes `${activityId}_result` and `activities[activityId]`.
- Existing `activities` object entries survive subsequent activity completions.
- A retry or re-execution replaces only the same activity ID.
- Root and branch effective contexts receive the result through their existing paths.
- Failed and pending activities do not publish a successful stable result.
- A legacy alias named `activities` is preserved exactly and suppresses the stable write for that activity.

### API integration coverage

Extend a self-contained workflow execution scenario to create a definition with a `CALL_API` activity, run it, and assert through the existing instance detail API that both the legacy alias and stable activity-ID path contain the same successful result. Create and clean up all fixtures within the test.

### Key UI path

N/A. There is no UI change. Existing workflow execution inspection may be used for manual verification, but no headed UI acceptance gate is introduced by this specification.

## Risks and Impact Review

### Context growth

- **Scenario**: Large activity outputs are persisted twice under legacy and stable aliases.
- **Severity**: Medium
- **Affected area**: Workflow context storage and serialization.
- **Mitigation**: Preserve only one additional deterministic reference per successful activity; do not add history or copies outside the existing context document.
- **Residual risk**: Definitions producing large outputs retain the existing size risk and incur an additional copy until legacy aliases can be reconsidered in a separate compatibility process.

### Namespace collision

- **Scenario**: A legacy activity alias already writes a scalar or array to `context.activities`.
- **Severity**: Low
- **Affected area**: The new stable path for that completion batch.
- **Mitigation**: Preserve the legacy value and omit the nested write rather than coercing or overwriting it.
- **Residual risk**: The stable alias is unavailable until the definition changes the conflicting activity name.

### Divergent execution paths

- **Scenario**: One synchronous or asynchronous completion path omits the new alias.
- **Severity**: Medium
- **Affected area**: Definition portability across activity execution modes.
- **Mitigation**: Shared contract tests cover all three current result-application paths.
- **Residual risk**: A future result path must add the same contract; a focused helper or test fixture should make omissions visible.

## Alternatives Considered

### Keep name/type aliases only

Rejected because editable names, repeated types, and differing async conventions do not provide a stable definition contract.

### User-configurable result paths

Deferred because it adds validation, collision, editor, and compatibility complexity without a current need. A fixed activity-ID namespace solves the concrete addressing problem.

### Replace legacy aliases

Rejected because it would break existing definitions and consumers.

## Success Criteria

- All compatible successful activity execution modes expose the same `activities.<activityId>` path; the documented legacy alias collision is the only exception.
- Legacy aliases and unrelated context values remain unchanged.
- Retry and branch behavior remains deterministic.
- Focused unit and API integration coverage passes.
- No schema, route, UI, event, command, cache, or package contract changes.

## Deferred Follow-Ups

- Optional editor assistance for selecting stable context paths.
- Any future deprecation strategy for legacy activity aliases.
- General configurable result placement or expression syntax.

## Final Compliance Report — 2026-07-20

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/workflows/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| Root and core guides | Preserve public contracts and existing behavior | Compliant | Stable addressing is additive and every legacy alias remains |
| Root and workflows guides | Keep changes minimal and within module ownership | Compliant | Only existing workflow result-application paths change |
| Core guide | Do not edit generated files by hand | Compliant | No generated file or registry is involved |
| Core guide | Entities require migrations and snapshots | N/A | No entity or schema change |
| Core guide | New routes require OpenAPI and guards | N/A | No route is added or changed |
| Workflows guide | Preserve root and branch state machines | Compliant | Existing effective-context selection and branch merge behavior remain |
| Backward compatibility | Do not remove or rename contract surfaces | Compliant | Both synchronous and asynchronous aliases remain exact, including the explicit `activities` collision exception |
| Security and tenancy | Do not weaken tenant or organization scope | Compliant | No access path or query changes |
| UI and i18n | User-facing changes use existing UI and translations | N/A | No UI or text change |
| Spec guidance | Define integration coverage for affected APIs and UI paths | Compliant | Existing instance API is covered; UI is explicitly N/A |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data model matches runtime | Pass | Existing JSON context stores the additive namespace |
| API matches implementation | Pass | Only already-exposed context gains an additive key |
| Risks cover side effects | Pass | Storage growth, collisions, and path divergence are explicit |
| Commands and events | N/A | No command or event changes |
| Cache strategy | Pass | Mutable context remains uncached |
| Compatibility | Pass | Legacy aliases and conflicts have explicit rules and tests |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — approved for implementation after the required public claim and Core admission gates.

## Changelog

### 2026-07-20

- Initial specification for definition-stable workflow activity output addressing.
- Added compatibility rules, phased delivery, integration coverage, risk review, and final compliance report.

### Review — 2026-07-20

- Reviewer: Agent
- Security: Passed
- Performance: Passed
- Cache: N/A
- Commands: N/A
- Risks: Passed
- Verdict: Approved
