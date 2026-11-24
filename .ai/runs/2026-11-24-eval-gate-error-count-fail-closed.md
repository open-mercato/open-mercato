# Execution plan — eval gate reads errorCount fail-closed

## Goal

`runEvalGate` must never report `errorCount: 0` for a suite run whose error count it could not read, so the CLI `eval --gate` fixture-replay check cannot pass on a missing value.

## Scope

- `packages/enterprise/src/modules/agent_orchestrator/commands/evalRuns.ts` — `CompleteEvalRunCommandResult` gains `errorCount: number`; both return branches (fresh completion and idempotent terminal) return it.
- `packages/enterprise/src/modules/agent_orchestrator/lib/eval/evalGate.ts` — take `errorCount` from the complete-command result, drop the post-complete re-read and its `?? 0`, throw `[internal]` when the value is not a number.
- Tests: update the two `runEvalGate` unit tests whose mocked complete result lacks `errorCount`; add regression coverage for the command result and the gate.

## Non-goals

- No change to how `outcome` / `passScore` treat errored cases.
- No change to the CLI exit-code logic (`cli.ts`), the worker, or API route code.
- No DB / migration change.

## Root cause

`evalGate.ts:168` re-reads the suite run after `evalRuns.complete` and returns `finished?.errorCount ?? 0` (`:176`). A null re-read becomes "0 errors", which skips the only `errorCount` consumer that blocks a gate (`cli.ts:971`, fixture replay). The complete command already holds the committed value (sole production writer: `commands/evalRuns.ts:335`) but does not return it.

## Risks

- `POST /api/agent_orchestrator/eval-runs` spreads the complete result into its response, so it gains an additive `errorCount` field (BC-allowed additive response field; `GET` already exposes `error_count`).
- Duplicate command registration throws in production and command interceptors only merge fields, so the missing-value throw is a defensive guard only.

## Implementation Plan

### Phase 1: Fail-closed errorCount

1. Return `errorCount` from `evalRuns.complete` (both branches) with unit coverage.
2. Read `errorCount` from the complete result in `runEvalGate`, throw when absent, update affected tests and add the gate regression test.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fail-closed errorCount

- [x] 1.1 Return errorCount from evalRuns.complete — 04af36a0f0
- [x] 1.2 Read errorCount from the complete result in runEvalGate — 299abfbfcb
