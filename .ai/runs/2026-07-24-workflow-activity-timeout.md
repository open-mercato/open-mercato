# Make workflow activity timeouts reachable (#4424)

> Retro-fitted plan. The run itself was executed before the skills collection was
> installed in this clone, so the work landed as a single commit without a tracked
> plan. This file reconstructs the plan from the delivered change so
> `om-auto-continue-pr` can resume it and so the PR carries the standard
> `Tracking plan:` reference.

## Overview

Goal: make a per-activity timeout configured in the workflows backend actually bound the
activity's execution, instead of being silently discarded on save and ignored at run time.

Root cause: three layers disagreed on the field name. The activity editors write
`timeoutMs` (visual editor) or `timeout` (CrudForm and classic editors),
`activityDefinitionSchema` accepted only `timeout: z.string()` — so `z.object()` stripped
`timeoutMs` before it reached the database — and `lib/activity-executor.ts` read only
`timeoutMs`. Net effect: activity-level timeouts did nothing for any definition created
through the API or the UI.

## Scope

- Accept the canonical `timeoutMs` in `activityDefinitionSchema` and keep `timeout` as a
  deprecated alias (duration string or milliseconds), per `BACKWARD_COMPATIBILITY.md`.
- Normalize both fields before execution on the sync path and the async (queue) path.
- Make the three activity editors display the effective value regardless of which field
  carries it, so the value round-trips between editors.
- Document the behavior in the user guide.

## Non-goals

- No change to the hub's activity/step state machines or to the queue worker contract.
- No schema/migration work — activities live in the definition JSON, so there is no
  new column and no optimistic-locking obligation.
- No new UI field or i18n key; the existing "Timeout" inputs are reused.

## Implementation Plan

### Phase 1: Runtime normalization

1. Add `toTimeoutMs()` to `lib/duration.ts` — accepts ms numbers, ms strings and duration
   strings (`PT30S`, `5m`), returns `undefined` for anything unusable.
2. Add `resolveActivityTimeoutMs()` to `lib/activity-executor.ts` (canonical `timeoutMs`
   wins over the deprecated alias) and apply it in `executeActivity` and in
   `enqueueActivity`'s queue payload so the async worker path is covered too.

### Phase 2: Save-time schema

1. Accept `timeoutMs: z.number().int().positive().optional()` and widen `timeout` to
   `string | number` in `activityDefinitionSchema`.
2. Reject an alias that cannot be interpreted at save time instead of ignoring it.

### Phase 3: Editors

1. `NodeEditDialog`, `ActivityArrayEditor` and `TransitionsEditor` display the effective
   timeout regardless of which field carries it and clear the other field on edit.

### Phase 4: Tests and docs

1. Regression tests: schema round-trip, `toTimeoutMs` unit coverage, and an activity that
   actually times out through the deprecated alias.
2. Document `timeoutMs` and the accepted alias forms in the workflows user guide.

## Risks

- **Behavior change, intentional and disclosed:** shipped example definitions
  (`examples/sales-pipeline-definition.json`) and code-defined workflows (`workflows.ts`)
  already carry activity-level `timeout: "PT10S"`-style values that were no-ops. They
  become effective, so a slow `CALL_API` activity in those definitions is now bounded
  where it previously ran unbounded. Called out in the PR body and summary comment so a
  maintainer signs off on it rather than discovering it in production.
- Rejecting an unusable `timeout` alias at save time could surface an error on re-saving a
  definition that stored garbage there. Accepted: the alternative is keeping the silent
  no-op this issue is about, and empty/absent values remain valid.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

PR: #4495

### Phase 1: Runtime normalization

- [x] 1.1 Add `toTimeoutMs()` to `lib/duration.ts` — f37ec9ba1
- [x] 1.2 Add `resolveActivityTimeoutMs()` and apply it on the sync and async paths — f37ec9ba1

### Phase 2: Save-time schema

- [x] 2.1 Accept `timeoutMs`, widen the `timeout` alias to `string | number` — f37ec9ba1
- [x] 2.2 Reject an uninterpretable alias at save time — f37ec9ba1

### Phase 3: Editors

- [x] 3.1 All three activity editors show the effective timeout and clear the other field — f37ec9ba1

### Phase 4: Tests and docs

- [x] 4.1 Regression tests (schema round-trip, `toTimeoutMs`, real timeout via the alias) — f37ec9ba1
- [x] 4.2 Document timeouts in `apps/docs/docs/user-guide/workflows/activities.mdx` — f37ec9ba1
