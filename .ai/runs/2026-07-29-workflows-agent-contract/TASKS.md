# PR B — Disposition contract (spec Phase 5 §7.5 / §7.6 / A7)

Branch `feat/workflows-disposition-contract`, stacked on `feat/workflows-agent-contract` (PR A).
Lineage: PR A's last commit `a7ba95c0d`.

`PLAN.md` belongs to PR A and is not edited here.

## Maintainer decisions this PR implements

1. **SLA breach escalates, NEVER decides.** No auto-reject, no auto-approve, no automatic
   disposition of any kind. The threshold logic in `dispositionService.ts` is untouched.
2. **The Review (Who/When) rewrite is approved.** `createUserTask` honours the workflow author's
   assignee / role queue / deadline.
3. **A7 is in scope as its own revertible commit.**

## Tasks

| Step | Title | Status | Commit |
|------|-------|--------|--------|
| B.1 | Review (Who/When) contract — `invokeAgentConfigSchema.review`, `lib/agent-review.ts`, `lib/agent-disposition-task.ts`, bridge + queue-job pass-through, `dispositionService.createUserTask` | done | `408fa7533` |
| B.2 | Disposition SLAs, escalate-only — schedule via `lib/task-sla.ts`; breach vocabulary chosen from the step's shape; `attention` marker | done | `9a77822dc` |
| B.3 | A7 — `agent_proposals.user_task_id` + close the review task from `commands/dispose.ts` | done | `5a41960f1` |
| B.4 | Review (Who/When) section on the Invoke Agent inspector + i18n ×4 | done | `f54ba32fc` |
| B.5 | Threshold slider (presentation only) + fail-closed copy | done | `479fcae38` |
| B.6 | Proposal draft card + trace link on the disposition task; `workflows.task.detail:context` spot | done | `c2ecef00c` (+ `2fddad98b`, a typing follow-up the workspace-wide typecheck caught) |

## The `dispositionService.ts` diff, exactly

Reviewers asked for this precisely. Four hunks, no others:

1. `AgentDispositionReview` type re-exported from the workflows module (type-only import, erased at
   run time) + an optional `review` field on `DispositionCtx`.
2. The class docstring's `user_task` bullet gained a sentence.
3. `createUserTask` — the inline `em.create(entities.UserTask, {...})` (+ its `StepInstance` lookup
   and `em.flush`) replaced by one call to `createAgentDispositionTask`, inside the SAME try/catch,
   with the SAME `pending:<proposalId>` fallback on failure.
4. A new private `recordUserTaskId` (A7) writing `user_task_id` via a targeted `nativeUpdate` that
   does not touch `updated_at`.

**Untouched:** `shouldAutoApprove` (the `>=` compare, the `alwaysAsk` arm, the fail-closed
`typeof !== 'number'` branch), `dispose`, `autoApprove`, `raiseUserTask`, `DispositionOutcome`.

## No path disposes a proposal without a human

- `shouldAutoApprove` is the ONLY producer of a verdict without a human, it is unchanged, and it is
  neither read nor called by any new code.
- `resolveAgentReviewBreachHandling` cannot return a verdict or a route — `agentReviewOnBreachSchema`
  does not accept one, and a test asserts `route` / `approve` / `reject` all fail to parse.
- `applyBreachHandling` chooses the escalate-only vocabulary from the STEP's shape, so a
  hand-authored `kind:'slaBreach'` transition on an agent step cannot fire.
- A7 closes a task AFTER a verdict has already been committed by someone else; it never writes a
  disposition, and `closeAgentDispositionTask` deliberately cannot advance a run (guarded by a test
  whose DI container throws on every token but `eventLogger`).
- The §7.6 draft card is read-only; a test asserts it issues no non-GET call.

## Bugs found

1. **The disposition task was actable by nobody.** Created with no assignee and no role queue, so
   under the §6.4 model `currentTaskOwnerId` is null ⇒ `ownsTheRow` is false for every principal ⇒
   `actable` is false; it was visible only to administrative oversight. It also emitted no
   `workflows.task.assigned`, so the notification subscriber never saw it, and no
   `USER_TASK_CREATED`, so it was absent from the run's audit trail. Fixed by B.1.
2. **`step_instance_id` could hold a workflow instance id.** The inline creation fell back to
   `ctx.processId` when the ACTIVE step instance was not found — a value that is not a step instance
   at all, and which the SLA scheduler and the run view both address. Now the fallback is explicit
   and the branch id is carried too.
3. **An `slaBreach` route on an agent step would have routed a disposition breach.** PR A made
   `kind:'slaBreach'` round-trip through the canvas; nothing stopped a hand-authored or code-defined
   definition from putting one on an agent step, where `resolveTaskBreachHandling` would have
   followed it and advanced the run past a pending proposal. B.2 makes that structurally impossible.
4. **The agent inspector could never author its error directive.** The `invokeAgent` arm omitted the
   error-handling group entirely — while PR A's node face tells the author that unwired outcomes
   inherit exactly that directive. It also hard-coded two English strings for its Advanced group.
   Fixed in B.4.
5. **Unencoded trace href** on the caseload detail page (`/backend/traces/${proposal.runId}`), unlike
   the process link two lines below it. Fixed in B.6.

## Known pre-existing failures (not introduced here)

- `yarn workspace @open-mercato/enterprise test`: 7 failures in 3 suites (baked file-agent
  `sourceFiles`, `computeAgentTokenUsageFromDir` parity, `opencode.jsonc` web-tool invariant).
  Verified identical on a clean tree (`git stash -u`) before any commit in this PR.
- `yarn agents:check-budget`: the root `AGENTS.md` is 92 bytes over and the `packages/ai-assistant`
  chain is over its recorded baseline. Both reproduce on a clean tree; neither file is touched here.
