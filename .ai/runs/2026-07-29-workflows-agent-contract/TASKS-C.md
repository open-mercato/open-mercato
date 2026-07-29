# PR C — Run views & recovery (spec §8.3, §8.4)

Branch: `feat/workflows-run-debugging`, stacked on `feat/workflows-agent-contract` (PR A @ `a7ba95c0d`).
Brief: `BRIEFING-phase5.md` §8.3 / §8.4. Owned by this executor only — `PLAN.md` belongs to PR A, `TASKS.md` to PR B.

## Rerun-from-step mitigation (the one Ask-First item)

`workflows/AGENTS.md` Ask-First: *"Ask before changing workflow, step, or activity state machines."*
Rerun inserts a **new `PENDING` `StepInstance`** and leaves the terminal row untouched, so no status
is ever set out of order and both attempts stay in the audit trail. If that mitigation ever fails to
hold, STOP and escalate rather than widening the state machine.

## Tasks

| Step | Title | Status | Commit |
|------|-------|--------|--------|
| C.1 | `GET /api/workflows/instances/[id]/steps` — the `StepInstance` read surface §8.3 needs | done | `6c8bafe6c` |
| C.2 | Run detail restructured into Flow / Timeline / Context / Raw tabs + per-step I/O inspector | done | `ee5f9f648` |
| C.3 | Gantt run timeline with collapsed waits | done | PENDING_SHA |
| C.4 | Live SSE — `clientBroadcast` on `workflows.instance.*` + run views subscribe | pending | — |
| C.5 | Run-list filters — date range + failure-queue attention | pending | — |
| C.6 | Failure-queue triage + error grouping + bulk replay through the progress module | pending | — |
| C.7 | Rerun-from-step — new ACL feature, `STEP_RERUN` event, new `PENDING` step instance | pending | — |
| C.8 | Studio canvas "Show last run" execution overlay | pending | — |

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
