# Stable Workflow Activity Outputs

## TLDR

Persist every compatible successful workflow activity result under the definition-stable path `context.activities[activityId]`. The new namespace covers synchronous transition activities, synchronous step activities, and completed asynchronous activities while preserving every existing result alias and all unrelated context values. Transition and asynchronous activities keep their legacy context aliases unchanged; step activity outputs are today persisted only in `stepInstance.outputData.activityResults` and are not addressable from workflow context at all, so for step activities the stable path is their first context-persisted output — a scoped, intended behavior addition. A legacy alias named exactly `activities` is the sole compatibility exception and suppresses the stable write for that activity.

This is an additive workflow-context contract. It adds no route, UI, entity, migration, event, command, dependency, or module coupling.

## Overview

Workflow definitions need a stable way to address an earlier activity result. Activity IDs are already definition-owned identifiers, but result placement currently depends on the activity name, activity type, or asynchronous completion convention — and step activity outputs are not placed in workflow context at all.

The proposed namespace makes the activity ID the canonical lookup key without removing the legacy paths. A later transition condition, activity input mapping, or signal-correlation feature can read `activities.<activityId>` regardless of how the activity executed.

The design follows the state-placement principle represented by [AWS Step Functions `ResultPath`](https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultpath.html): task output can be combined with existing workflow state at a stable location. Open Mercato does not adopt JSONPath mutation or configurable result paths in this scope; it uses one deterministic namespace derived from the existing activity ID.

## Problem Statement

Successful workflow activity results are currently addressable — or not addressable — depending on how the activity executed:

- synchronous transition activity results are written to workflow context under `activityName || activityType` (`transition-handler.ts`);
- asynchronous results are written to workflow context under `${activityId}_result` when the durable completion is applied (`workflow-executor.ts` for the root, `parallel-handler.ts` for branches);
- synchronous step activity results are persisted only in `stepInstance.outputData.activityResults` (keyed by activity ID) and are **not** written to workflow context at all.

The context conventions are valid runtime behavior and must remain available, but they are not a durable definition contract. Names can be edited, types are not unique, synchronous versus asynchronous execution changes the lookup convention, and step activity outputs have no context path whatsoever. A definition that needs the ID returned by an earlier `CALL_API` activity therefore has no single stable path.

## Goals

- Write every compatible successful activity output to `context.activities[activityId]`.
- Cover synchronous transition, synchronous step, and completed asynchronous activity paths.
- Preserve existing transition and asynchronous aliases unchanged; the step path has no legacy context alias to preserve.
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

For transition and asynchronous activities the write occurs at the same point where each path currently writes its legacy context alias. For step activities — which today write no context alias — the write occurs where the step handler already collects successful outputs into `stepInstance.outputData.activityResults`, applied to the effective context through the same token write helpers the transition path uses. It must not make a failed or still-pending activity visible as completed.

An output is **compatible** when the activity reports success and its output is not `undefined`. The stable path stores the raw output value — object, array, scalar, or `null` — identically across all paths. Legacy aliases keep their existing per-path quirks unchanged: the shared executor's intra-batch write applies only to object outputs, the transition commit writes any truthy output, and the asynchronous resumes write any truthy output.

### Merge rules

1. If `context.activities` is absent, create an object containing the current activity ID.
2. If it is an object, preserve its entries and set the current activity ID.
3. Re-execution of the same activity ID replaces that ID's previous output deterministically.
4. Preserve every unrelated top-level context key.
5. Continue writing the current legacy alias in the same batch on the paths where one exists today (transition and asynchronous); the step path adds no legacy context alias.
6. If the current legacy alias is literally `activities`, preserve its value exactly and omit the nested activity-ID write for that activity, regardless of the output's shape.

The last rule is a narrow compatibility exception for an existing naming collision. It is distinct from an unrelated pre-existing object at `context.activities`, which is merged normally. Definitions should avoid naming an activity `activities` when they need the stable namespace.

### Execution paths

The same merge contract applies to:

- transition activities completed synchronously;
- step activities completed synchronously (the first context-persisted output for this path);
- asynchronous activities when their durable completion result is applied.

Concretely, the existing result-application sites are the transition synchronous commit and the transition async-pause commit in `transition-handler.ts` (both funnel through `applyTokenContextWrites`), the root asynchronous resume in `workflow-executor.ts`, and the branch asynchronous resume in `parallel-handler.ts`; the step path adds one new write where `step-handler.ts` already collects successful `outputData.activityResults`. Each path uses the effective root or branch context already selected by the executor. The feature does not introduce cross-branch reads, shared mutable context, or a new merge strategy.

Within a single synchronous batch, the stable path mirrors the legacy name-keyed intra-batch behavior: once an activity in the batch succeeds, a later activity in the same batch can interpolate `{{context.activities.<earlierActivityId>}}` exactly as it can already interpolate the legacy name-keyed output.

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

On the transition and asynchronous paths the namespace duplicates references within the same persisted JSON document: the legacy alias and stable activity-ID alias may both contain the output. This preserves compatibility at the cost of bounded per-activity context growth. The step path writes only the stable alias, so it adds no duplication.

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
- Existing transition and asynchronous aliases remain exact.
- Step activities gain their first context-persisted output under `activities[activityId]`. This is a scoped, intended behavior addition: no legacy step context alias exists to preserve, and `stepInstance.outputData.activityResults` remains unchanged. Definitions that do not read the new namespace observe no behavioral difference.
- Existing context values are preserved, including a non-object legacy `activities` alias.
- Existing retries, branch merges, execution ordering, and failure semantics remain unchanged.
- The new path is additive and available only for activity results completed after deployment; historical context is not rewritten.

## Implementation Approach

### Phase 1 — Contract tests

1. Add failing tests for synchronous transition, synchronous step, and asynchronous completion outputs.
2. Cover existing-object merge, absent-object creation, same-ID replacement, and unrelated context preservation.
3. Lock compatibility behavior for the transition and asynchronous legacy aliases, and lock the absence of any step-path legacy context alias.
4. Cover object and non-object collisions on the top-level `activities` key.
5. Cover object, scalar, `null`, and `undefined` outputs plus intra-batch stable-path interpolation.

This phase is test-only and precisely defines the compatibility boundary.

### Phase 2 — Result application

1. Extend the existing activity-result merge paths, reusing one internal helper only where it reduces duplication across current call sites.
2. Apply the stable alias at every result-application site: the transition synchronous commit and the transition async-pause commit in `transition-handler.ts`, the root asynchronous resume in `workflow-executor.ts`, the branch asynchronous resume in `parallel-handler.ts`, and a new step-path write where `step-handler.ts` collects successful `outputData.activityResults`.
3. Keep pending, failed, and retry scheduling paths unchanged.

This phase is complete when the focused workflow executor tests pass without changing public contracts.

### Phase 3 — Regression verification

1. Run focused workflow activity and parallel-branch suites.
2. Run workflow package typecheck and the smallest relevant build gate.
3. Verify no generated registry or migration changed.

## Integration and Test Coverage

### Module coverage

- Transition activity success writes both the legacy alias and `activities[activityId]`.
- Step activity success writes `activities[activityId]` to the effective context (its first context-persisted output) while `stepInstance.outputData.activityResults` remains unchanged.
- Async completion writes `${activityId}_result` and `activities[activityId]` in both the root and branch resume paths.
- Scalar and `null` outputs of successful activities reach the stable path on every path; `undefined` outputs are skipped.
- A later activity in the same synchronous batch can interpolate `{{context.activities.<earlierActivityId>}}`.
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

- **Scenario**: Large activity outputs are persisted twice under legacy and stable aliases on the paths where a legacy alias exists.
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

### Duplicate activity IDs

- **Scenario**: Definition validation does not enforce activity-ID uniqueness across a definition (only parallel branch keys are checked today), so two different activities sharing an ID overwrite each other's stable output.
- **Severity**: Low
- **Affected area**: The stable path for the colliding IDs; the pre-existing `${activityId}_result` alias has the same exposure.
- **Mitigation**: Deterministic last-write-wins semantics are documented; a validator warning on duplicate activity IDs is listed as a deferred follow-up.
- **Residual risk**: Definitions with duplicate IDs read the most recently completed output until validation is added.

### Divergent execution paths

- **Scenario**: One synchronous or asynchronous completion path omits the new alias.
- **Severity**: Medium
- **Affected area**: Definition portability across activity execution modes.
- **Mitigation**: Shared contract tests cover every enumerated result-application site, including both asynchronous resume paths and the new step-path write.
- **Residual risk**: A future result path must add the same contract; a focused helper or test fixture should make omissions visible.

## Alternatives Considered

### Keep name/type aliases only

Rejected because editable names, repeated types, and differing async conventions do not provide a stable definition contract.

### User-configurable result paths

Deferred because it adds validation, collision, editor, and compatibility complexity without a current need. A fixed activity-ID namespace solves the concrete addressing problem.

### Replace legacy aliases

Rejected because it would break existing definitions and consumers.

### Reserved key `__activities`

A double-underscore reserved key (matching the existing `__result` and `_pendingAsyncActivities` context keys) would eliminate the `activities` naming-collision exception entirely, along with its merge rule and tests. Rejected in favor of the user-facing `activities` key: workflow authors interpolate the path directly (`{{context.activities.<id>}}`), and a reserved-looking prefix signals internal runtime state rather than a supported definition contract. The cost is the narrow, documented collision exception.

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
- Definition-validation warning for duplicate activity IDs within one definition.

## Final Compliance Report — 2026-07-20 (amended 2026-07-21)

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/workflows/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| Root and core guides | Preserve public contracts and existing behavior | Compliant | Stable addressing is additive; every existing legacy alias remains, and the step path's first context write is an explicit, scoped behavior addition |
| Root and workflows guides | Keep changes minimal and within module ownership | Compliant | Only existing workflow result-application paths change |
| Core guide | Do not edit generated files by hand | Compliant | No generated file or registry is involved |
| Core guide | Entities require migrations and snapshots | N/A | No entity or schema change |
| Core guide | New routes require OpenAPI and guards | N/A | No route is added or changed |
| Workflows guide | Preserve root and branch state machines | Compliant | Existing effective-context selection and branch merge behavior remain |
| Backward compatibility | Do not remove or rename contract surfaces | Compliant | Transition and asynchronous aliases remain exact; the step path has no legacy context alias to preserve; the explicit `activities` collision exception is documented |
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

### 2026-07-21 — Amendment after specification review

- Corrected the step-path description: step activity outputs are today persisted only in `stepInstance.outputData.activityResults` and are not addressable from workflow context, so `activities[activityId]` is their first context-persisted output — a scoped, intended behavior addition rather than a write beside an existing alias.
- Defined output-shape compatibility: the stable path stores the raw output whenever the activity succeeds and its output is not `undefined`; legacy aliases keep their per-path quirks.
- Enumerated the concrete result-application sites (transition sync commit, transition async-pause commit, root async resume, branch async resume, new step-path write).
- Documented the duplicate-activity-ID validation gap as a risk and deferred a validator warning.
- Specified intra-batch visibility of `{{context.activities.<earlierActivityId>}}`, mirroring legacy name-keyed behavior.
- Added the reserved-key `__activities` alternative with its tradeoff; corrected the compliance report accordingly.

### Review — 2026-07-20

- Reviewer: Agent
- Security: Passed
- Performance: Passed
- Cache: N/A
- Commands: N/A
- Risks: Passed
- Verdict: Approved
