# Execution plan — workflows: claim a PAUSED instance before a signal advances it

Issue: open-mercato/open-mercato#7185

## Goal

Make `sendSignal` advance a `PAUSED` workflow instance exactly once under concurrent delivery, and let
`sendSignalByCorrelationKey` callers see which instances failed instead of only a success count.

## Scope

- `packages/core/src/modules/workflows/lib/signal-handler.ts`
  - Claim the instance with a conditional `UPDATE … SET status = 'RUNNING' WHERE id = ? AND status = 'PAUSED'
    AND current_step_id = ?` (tenant/org scoped) after all read-only validation and before any mutation.
    A losing delivery throws the existing `SignalError('WORKFLOW_NOT_PAUSED')`, so the instance signal
    route keeps answering 409.
  - Add `sendSignalByCorrelationKeyWithResults` returning `{ count, failures[] }`; the existing
    `sendSignalByCorrelationKey` keeps its `Promise<number>` contract and delegates.
- `packages/core/src/modules/workflows/api/signals/route.ts` + `api/openapi.ts` — additive optional
  `failures` array on the correlation-key response.
- Unit regression test that interleaves three concurrent deliveries against one simulated row.

## Non-goals

- `workflows.instance.resumed` emission (#7186).
- The FORKED/branch signal path (`resumeBranch`), shared with timer/task/condition resumes — separate follow-up.
- The event-driven correlated wait spec (`.ai/specs/2026-07-20-correlated-workflow-signal-waits.md`) — not implemented here.

## Risks

- `current_step_id` in the claim predicate prevents a stale delivery from consuming a later wait the
  winner parked on. A workflow that loops back onto the same wait step can still legitimately be resumed
  by a later delivery — that is a genuinely new wait.
- Internal callers (activity worker, sub-workflow resume, agent disposition) already treat
  `WORKFLOW_NOT_PAUSED` as a failure of a duplicate delivery; the claim only moves the same error to the
  race window.

## Progress

PR: #7190

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Atomic claim

- [x] 1.1 Claim the PAUSED instance with a conditional update in sendSignal — 39130dde9
- [x] 1.2 Concurrency regression test for sendSignal — 39130dde9

### Phase 2: Correlation-key fan-out failures

- [x] 2.1 Surface per-instance failures from the correlation-key fan-out — 39130dde9, f77998add
- [x] 2.2 Docs and module guide update — f77998add
