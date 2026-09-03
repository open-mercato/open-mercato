# PR C — Run views & recovery (spec §8.3, §8.4)

Branch: `feat/workflows-run-debugging`, stacked on `feat/workflows-agent-contract` (PR A @ `a7ba95c0d`).
Brief: `BRIEFING-phase5.md` §8.3 / §8.4. Owned by this executor only — `PLAN.md` belongs to PR A, `TASKS.md` to PR B.

## Rerun-from-step mitigation (the one Ask-First item)

`workflows/AGENTS.md` Ask-First: *"Ask before changing workflow, step, or activity state machines."*
Rerun inserts a **new `PENDING` `StepInstance`** and leaves the terminal row untouched, so no status
is ever set out of order and both attempts stay in the audit trail. If that mitigation ever fails to
hold, STOP and escalate rather than widening the state machine.

**Outcome — the mitigation holds, and more cheaply than proposed.** The engine ALREADY mints a
fresh row on every step entry: `lib/step-handler.ts` `enterStep` does an unconditional
`em.create(StepInstance, { … status: 'ACTIVE' … })`, and `executeStep` calls it. So the rerun does
not have to insert a placeholder row at all — it repoints `currentStepId` and calls `executeStep`,
which is the same cursor-move shape `enterErrorHandlerStep` already uses for the definition-level
error handler. Inserting an explicit `PENDING` row on top of that would have produced a SECOND,
never-advanced row per rerun, polluting the Gantt and the failure queue forever; the `STEP_RERUN`
workflow event is the audit record instead, which is also what the module's event-sourcing rule
asks for. The terminal row is read for its `stepType` and otherwise untouched — pinned by
`rerunStep.route.test.ts` "never mutates the terminal StepInstance of the previous attempt".

## Tasks

| Step | Title | Status | Commit |
|------|-------|--------|--------|
| C.1 | `GET /api/workflows/instances/[id]/steps` — the `StepInstance` read surface §8.3 needs | done | `6c8bafe6c` |
| C.2 | Run detail restructured into Flow / Timeline / Context / Raw tabs + per-step I/O inspector | done | `ee5f9f648` |
| C.3 | Gantt run timeline with collapsed waits | done | `68ad96c3c` |
| C.4 | Live SSE — `clientBroadcast` on `workflows.instance.*` + run views subscribe | done | `a699bb6e2` |
| C.5 | Run-list filters — date range + failure-queue attention | done | `9acd91874` |
| C.6a | Fix: `DataTable`'s `bulkActions` prop discarded `{ ok, progressJobId }` | done | `4c563843f` |
| C.6 | Failure-queue triage + error grouping + bulk replay through the progress module | done | `0d6e24a12` |
| C.7 | Rerun-from-step — new ACL feature, `STEP_RERUN` event, fresh step-instance row | done | `d05905dfd` |
| C.8 | Studio canvas "Show last run" execution overlay | done | `629e492a6` |

## Validation

Runner: **local** (no compose `app` container running).

| Command | Result |
|---|---|
| `yarn build:packages` · `yarn generate` · `yarn build:packages` | pass |
| `yarn i18n:check-sync` · `yarn i18n:check-usage` | pass |
| `yarn typecheck` | pass (22/22) |
| `yarn workspace @open-mercato/core test` | 1219 suites / 10208 tests pass |
| `yarn workspace @open-mercato/ui test` | 208 suites / 1699 tests pass |
| `yarn lint` | 0 errors |
| `yarn build:app` | pass |

**Pre-existing failures, untouched by this PR:** `yarn test` fails in
`@open-mercato/enterprise` — `agent_orchestrator/__tests__/{agent-source-files,agent-token-usage,
webSearchEgress.integration}` (3 suites / 7 tests). `git diff feat/workflows-agent-contract..HEAD
-- packages/enterprise` is EMPTY, and the same three suites fail identically when run at PR A's
head, so they are inherited from the base branch.

`yarn agents:check-budget` also fails on the root `AGENTS.md` and the `packages/ui` /
`packages/ai-assistant` / `packages/core/src/modules/sales` chains — identical output on a clean
tree, none of those files touched here. The `packages/core/src/modules/workflows` chain stays
within budget with the new section.

**Release runbook:** two new ACL features (`workflows.instances.rerun_step`,
`workflows.instances.bulk_ops`). Existing tenants need `yarn mercato auth sync-role-acls`.

## Binding constraints

- One item = one commit; scoped tests each time; `yarn generate` after module-file changes.
- No `any`, no bare `.sort()`, no arbitrary Tailwind, no hardcoded status colours, status never
  colour-only, i18n ×4, `pageSize` ≤ 100.
- Out of scope (PR B): agent Review section, disposition SLAs, A7, proposal cards, trace links,
  threshold slider, `packages/enterprise/**`, the agent-node inspector.
- Out of scope (PR D): dry-run, `isDryRun`, step-through, Code view stage 2.

## Bugs found while implementing

1. **The run overlay mispaints any run with more than 100 events.** `backend/instances/[id]/page.tsx`
   reads `?sortDir=desc&pageSize=100`, so on a long run an early step's `STEP_ENTERED` has fallen off
   the page and the step painted `pending` despite having completed. Fixed by making `StepInstance`
   rows — one per execution, far fewer than events — authoritative for step state in
   `lib/run-execution.ts`. The taken-route overlay still reads events and inherits the cap.
2. **`COMPENSATION_ACTIVITY_FAILED` painted as a routine rollback.** The inline event-badge chain
   tested `includes('COMPENSATION')` before `includes('FAILED')`, so a failed compensation step got
   the same warning colour as a successful one. `lib/run-event-tone.ts` orders failure first.
3. **`text-orange-600` on the instance list's retry-count cell** — a hardcoded status colour the
   hex-only DS guard could not see. Fixed, and `status-colors-ds.test.ts` now also rejects raw
   Tailwind palette shades across both instance pages and `components/run/`.
4. **`workflows.instance.paused` and `workflows.instance.resumed` are declared but have no emit
   site.** `InstanceLifecycleEventId` in `lib/workflow-executor.ts` lists only
   `created|started|failed|cancelled|completed`, and PAUSED is set in ~10 places across
   `step-handler`, `signal-handler`, `execution-token` and the executor. Not fixed here — wiring
   ten emit sites in the step-handler files is a state-machine-adjacent change PR C should not make
   unasked. It costs little in practice: every step advance re-emits
   `workflows.instance.started` with the destination step, so a run that parks still pushes.
5. **`DataTable`'s `bulkActions` prop threw away its action's result.** `runPropBulkAction` did
   `const result = await action.onExecute(rows); if (result !== false) setRowSelection({})` and
   nothing else — so a host-owned action returning `{ ok, progressJobId }` (the shape
   `progress/AGENTS.md` mandates, and the injected `:bulk-actions` path already honours) got no
   toast, no top-bar tracking, and a rejected promise surfaced as an unhandled rejection. Fixed
   narrowly: only an object result is acted on, so the `void`/`true`/`false` returns the existing
   customers/messages callers use keep their exact previous behaviour.
