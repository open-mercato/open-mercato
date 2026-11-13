# Honest Run State — a run must not report success when work was skipped, and a working step must not look parked

- **Date:** 2026-07-30
- **Status:** proposed, awaiting approval (this is an Ask-First state-machine change per `workflows/AGENTS.md`)
- **Trigger:** the shipped `sales.order-approval` workflow silently skips all three of its status
  writes and still reports `COMPLETED`.

## TLDR

Two halves of the same problem: the product reports state that is not true.

**At the run level** — a workflow run today ends in one of `COMPLETED`, `FAILED`, `CANCELLED`. That vocabulary cannot
express *"it finished, but part of it did not happen"* — so it reports the same word for a clean run
and for a run that swallowed three failed writes.

**At the step level** — a step whose agent is actively running paints the same amber "paused" as a
step blocked on a human for three days, and nothing says *what* is being waited for.

This proposes an **additive `outcome` verdict** alongside the existing lifecycle `status`, one hard
invariant — **a run that suppressed a failure can never be `success`** — and a **step presentation
model that separates "the engine is working" from "we are blocked on the outside world", with a
one-line reason.**

## Problem statement

`sales.order-approval` is triggered by `sales.order.created` and carries three `UPDATE_ENTITY`
activities. For a system-originated order there is no acting user, so all three throw. Every
transition sets `continueOnActivityFailure: true`, so each throw is swallowed and the run advances.
It reaches END and is written `COMPLETED`.

The order is never marked `pending_approval`, `approved` or `rejected`. Nothing surfaces. The run
list, the KPI rollup and the instance detail all report a healthy workflow.

Fixing the missing identity (a separate change) stops *this* workflow failing. It does not stop the
next one reporting success for work it did not do.

### Three root causes, not one

1. **A tolerated failure leaves no durable trace.** `handleAutomatedStep` *returns*
   `{status:'FAILED'}` rather than throwing, and only `executeStep`'s catch writes
   `StepInstance.status = 'FAILED'`. So the step row stays `ACTIVE` for ever and no `STEP_FAILED`
   event is logged. There is nothing to compute a verdict from.
2. **Terminal status conflates two questions** — *did it reach the end?* and *did everything it
   attempted succeed?* One enum answers both, so it answers neither honestly.
3. **Tolerance is invisible after the fact.** `continueOnActivityFailure` and
   `errorDirective: continueWithFallback` are authoring-time switches with no runtime footprint. An
   operator reading a finished run cannot tell a clean run from a tolerated one.

## Proposed solution

### Keep `status`. Add `outcome`.

`status` stays exactly as it is — it is the **lifecycle** state and it drives control flow (is this
run active? can it be retried? may the executor advance it?). Nothing about it changes.

`outcome` is the **verdict**, written once when the run terminates, `null` while it is still going.

| `outcome` | Meaning |
|---|---|
| `success` | Reached END. Nothing failed, nothing was suppressed. |
| `success_with_warnings` | Reached END and did everything it was asked to, but something worth reading happened — a step skipped by design, an optional source degraded, compensation that ran cleanly. |
| `partial_failure` | Reached END, **but at least one activity or step failed and was tolerated.** The `order-approval` case. |
| `failure` | Did not reach END. |
| `cancelled` | A human stopped it. |
| `compensated` | Rolled back. |

### The invariant that is the actual fix

> **A run that suppressed at least one failure MUST NOT be `success`.**

One pure function decides the verdict from the run's recorded evidence; it is not assembled ad hoc
at each exit point. The invariant gets its own test, and that test is the point of this change.

### Why not simply add enum members to `status`

Because `status` is consumed as a control-flow switch in many places — the instance list filters,
the failure-queue union, the KPI rollup's terminal-set classification, `canApplyBulkReplay`, the
run views, and any third-party subscriber. Adding members changes every one of those silently: an
unrecognised status falls through a filter rather than erroring, so the failure mode is *invisible
omission*, which is the exact class of bug this document exists to remove.

An additive nullable column changes nobody until they opt in, and `status` keeps meaning what every
existing consumer already believes it means.

### The enabling fix (must land first)

A verdict needs evidence. So: **a tolerated failure must still be recorded as a failure.** Mark the
`StepInstance` `FAILED` and log `STEP_FAILED` / `ACTIVITY_FAILED` even when the run is allowed to
continue. Tolerating a failure is a routing decision, not a reason to forget it happened.

This also repairs a second bug found during integration triage: because the step row stays `ACTIVE`,
`POST /api/workflows/instances/[id]/rerun-step` refuses it with 409 `WORKFLOW_STEP_STILL_PARKED` —
so rerun-from-step cannot rerun exactly the step it exists for.

## Consumers that must be updated in the same change

- **KPI rollup** — `successRate` currently counts `COMPLETED` as success. It must not count
  `partial_failure`. Report it as its own number rather than folding it into either bucket.
- **Needs-attention queue** — `partial_failure` belongs in it. A run nobody looks at because it said
  COMPLETED is the failure this is fixing.
- **Run views and the instance list** — show the verdict, not just the lifecycle state.
- **Instance list filters** — filterable by outcome.

## Migration & backward compatibility

- New **nullable** column. Existing rows stay `null`, meaning *"ran before outcomes existed"*. Do
  **not** backfill a guess — a fabricated verdict is the same dishonesty in a different direction.
- `status` is untouched, so every existing consumer, filter, subscriber and third-party integration
  keeps working unchanged.
- Additive under `BACKWARD_COMPATIBILITY.md` (DB schema: additive column; no event id, route or type
  removed or narrowed).

## Risks

| Risk | Mitigation |
|---|---|
| Runs that used to look fine start looking degraded | That is the intent, and it is a reporting change, not a behaviour change. Worth calling out in UPGRADE_NOTES: existing tolerated-failure workflows will begin reporting `partial_failure`. |
| Two fields to keep in sync (`status`, `outcome`) | One pure resolver, one write site at termination, one invariant test. |
| `COMPENSATED` has no terminal timestamp today | Known, tracked separately; the outcome write is the natural place to fix it. |

## Open question for the maintainer

Should `partial_failure` be **retryable** like `FAILED` is? It reached END, so the engine considers
it done — but the work it skipped was never done. Retrying would re-run the whole graph, including
the parts that succeeded. Recommendation: not retryable as a whole; use rerun-from-step on the
specific failed step, which is what that feature is for (and which the enabling fix above unblocks).

## Changelog

- **2026-07-30** — Proposed after the shipped `order-approval` workflow was found reporting
  `COMPLETED` for a run in which all three of its writes failed and were swallowed.

---

# Part 2 — Step presentation: working vs waiting, and waiting for what

## Problem

`INVOKE_AGENT` running an agent in a worker renders as an amber pause indicator. So does a
`USER_TASK` that has been sitting on someone's desk since Tuesday. An operator opening a run cannot
answer the first question they have: **is anything happening right now, or is this stuck?**

The cause is that the canvas paints the *engine's* lifecycle state, and the engine's vocabulary was
built for control flow, not for reading. `WAITING_FOR_ACTIVITIES` means "the executor has handed
work to a queue and will resume when it returns" — that is the engine **working**, not idle. Painting
it as a pause is the single most misleading thing on the run views.

Nor is there anywhere to say *what* is being waited for, even though the engine knows: the wait
reason, the signal name, the timer deadline, the task assignee, the pending proposal.

## Proposed presentation model

Three presentation states, derived — never stored — from the run evidence that already exists.
`lib/run-execution.ts` is already the single pure answer to "what did this run do"; this extends it
rather than adding a second source.

| State | Colour | Motion | Means |
|---|---|---|---|
| **Working** | info / blue | animated | The system is doing something right now: an activity executing, an async activity in a worker, an agent invoked and running, a sub-workflow child running, branches advancing after a fork. |
| **Waiting** | warning / amber | static | Blocked on something **outside** the system: a person, a timer, an external signal or webhook, a condition, a proposal decision. |
| **Attention** | destructive-adjacent | static | Parked in the failure queue (`metadata.attention`), or breached. Needs a human, and not in the ordinary way. |

Plus the existing terminal states — not started, completed, failed, skipped, cancelled, compensated.

**The rule:** amber means *we are blocked on the outside world*. If the system is doing work, it is
blue and it moves. `WAITING_FOR_ACTIVITIES` is **working**, not waiting — that single reclassification
is what fixes the reported complaint.

## The one-line reason

Every non-terminal step carries one line saying what it is doing or waiting for. Derived from data
the engine already records:

| Situation | Line |
|---|---|
| Async activity in flight | *Running `<activity name>`…* |
| `INVOKE_AGENT` running | *Agent `<agent label>` is running…* |
| `INVOKE_AGENT` parked on disposition | *Waiting for a decision on the proposal* |
| `USER_TASK` | *Waiting for `<assignee or role queue>`* — plus the deadline when one is set |
| `WAIT_FOR_TIMER` | *Waiting until `<absolute time>`* |
| `WAIT_FOR_SIGNAL` | *Waiting for signal `<name>`* |
| `WAIT_FOR_CONDITION` | *Waiting for a condition* — plus its timeout |
| Sub-workflow | *Waiting for `<child workflow>`* |
| Parallel fork | *`<n>` of `<m>` branches still running* |
| Failure-queue park | *Parked for attention* |

Use the agent's **label**, never its definition key — an existing rule in this module. Never leak an
assignee the viewer is not entitled to see: the §6.4 visibility model already decides that, and this
line must not become a way around it.

## Constraints

- **Status is never colour-only.** Each state pairs its DS token with its own icon shape and an
  `sr-only` name. This is a §4.6 acceptance criterion with a live guard
  (`components/__tests__/canvasAccessibility.test.tsx`).
- **Motion respects `prefers-reduced-motion`.** A blue step must still be distinguishable from an
  amber one with animation disabled — so the icon and the label carry the distinction, and motion is
  an enhancement.
- **Derived, never stored.** No new column, no new engine event. If the evidence for a line is not
  already recorded, say so rather than inventing a write.
- One pure resolver, unit-tested without a canvas — the pattern `lib/run-execution.ts`,
  `lib/node-outcome-rows.ts` and `lib/breach-routing.ts` already follow.
- Both the **run detail views** and the Studio's **"Show last run" overlay** read the same resolver,
  so they cannot disagree.

## Open question

Should a step that is *working* also show elapsed time (*"running for 4m"*)? It is the second
question an operator asks, and `StepInstance` carries `startedAt`. Recommended yes, as part of the
same line, since it is free.

## Changelog

- **2026-07-30** — Part 2 added after the maintainer reported that a running `INVOKE_AGENT` shows an
  amber pause indicator, and asked for waiting to be distinguished from working with a one-line
  reason.
