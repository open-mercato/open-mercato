# Fix: `onStepFinish` wired twice on the tool-loop-agent path

Issue: #5042
Engine: om-auto-create-pr (steps: 4, --loop: no)

## Goal

Stop `runAiAgentText` from wiring the same `onStepFinish` hook twice when
`executionEngine === 'tool-loop-agent'`, so `BudgetEnforcer` counts each step once
and a turn is no longer aborted mid-flight with `budget-tool-calls` at 2× the real
tool-call count.

## Scope

- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts` — drop the
  redundant `onStepFinish` from the `builtToolLoopAgent.stream({ … })` call; the
  construction-time wiring in `ToolLoopAgentSettings` is the intended one (the
  surrounding comment already documents it as such).
- A regression test that locks the invariant: exactly one wiring reaches the SDK,
  so a per-step event fans out to the caller's hook exactly once.

## Non-goals

- No change to the `stream-text` execution path (its single wiring is correct).
- No change to `BudgetEnforcer`, `LoopTrace`, or the budget semantics themselves.
- No dedup logic inside `mergeCallbacks` (that lives in the `ai` SDK).

## Risks

- Low. The removed argument is a duplicate of a hook already wired at construction,
  so behavior on the tool-loop-agent path is strictly "fires once instead of twice".
- The path had no unit coverage before this change; the new test is what makes the
  regression detectable.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix and lock the invariant

- [ ] 1.1 Remove the duplicate `onStepFinish` from the `ToolLoopAgent.stream(...)` call
- [ ] 1.2 Add a regression test asserting a single SDK-side wiring and one caller callback per step
- [ ] 1.3 Run the targeted ai-assistant test suite
- [ ] 1.4 Run the full validation gate
