# Run: workflows-agent-contract (spec Phase 5)

- Date: 2026-07-29
- Base: `feat/agent-orchestrator-mvp` @ `9cf3faf13`
- Spec: `.ai/specs/2026-07-26-workflows-ux-redesign.md` §7 + §8 (roadmap "Phase 5 — Agent contract & debugging depth")
- Research: `BRIEFING-phase5.md`
- Fidelity convergence: `.ai/analysis/2026-07-28-canvas-visual-fidelity.md` gap #4 (outcome-row footers) is the *render* of §7.2's named handles — same feature, not a lookalike.

## Maintainer decisions (2026-07-29)

1. **SLA breach escalates, never decides.** On breach: notify / escalate / reassign / mark attention — the proposal stays pending until a human acts. No auto-reject. Keeps "every disposition has a human behind it" true and needs no change to the auto-approve threshold logic. Accepted cost: a breached proposal can sit indefinitely if nobody picks it up.
2. **The Review (Who/When) rewrite is approved.** `dispositionService.ts`'s `createUserTask` honours the workflow author's assignee / role queue / deadline, so disposition tasks are routable instead of landing unassigned. The auto-approve threshold logic itself stays untouched, and the diff is called out precisely in the PR.
3. **A7 is in scope for this phase**, as its own revertible commit: record the task id on the proposal and close it from `commands/dispose.ts` (which runs on every path, including auto-approve). Cleans up after a decision; does not move the boundary.

## PR split (from the briefing, dependency-ordered)

| PR | Contents | Gated? |
|---|---|---|
| **A** | Outcome routes + guardrail route + the agent/user-task node face (fidelity gap #4) + node information density (gap #6) + two live bug fixes | No — merges without waiting on anything |
| **B** | Disposition contract: Review (Who/When), SLAs (escalate-only), proposal draft cards, trace links, threshold slider, **A7** | Decisions 1–3 above cover it |
| **C** | Run views + recovery: execution overlay, Gantt timeline, live SSE, failure-queue bulk replay, run-list filters, rerun-from-step | Only rerun-from-step; mitigation below |
| **D** | Dry-run + isolation flags + step-through + Code view stage 2 | No |

`rerun-from-step` mitigation (avoids the step-state-machine gate): insert a **new `PENDING` `StepInstance`** rather than reviving the terminal one — no illegal transition, and the audit trail keeps both.

## Tasks — PR A

| Step | Title | Status | Commit |
|------|-------|--------|--------|
| A.1 | Fix: `graphToDefinition` drops every transition `kind` except `error` (silently downgrades `slaBreach` on save) | done | `cdf66124c` |
| A.2 | Fix: instance pages guard on `workflows.view_instances`, which does not exist in `acl.ts` | done | `73fb4f9a4` |
| A.3 | Outcome routes — `kind: 'outcome'` + the five §7.2 disposition kinds as named source handles | done | `03d7a003c` |
| A.4 | Guardrail route + the rejection/error split | done | `bf7c5e4d3` |
| A.5 | Node outcome-row footer (agent + user task) — fidelity gap #4 | done | `cf8bbd121` |
| A.6 | Node information density — one-line config summaries replacing truncated prose (gap #6) | done | `d9e4eff01` |
| A.7 | Problems checks + integration coverage for outcome routing | done | `e0c847b2a` |

## Binding constraints

- **Build outcome routes against §7.2's five fixed disposition kinds, NOT the agent's OUTCOME-schema enum.** The enum version would reintroduce the context string-matching §7.2 exists to kill.
- The user-task half of the footer needs **no engine work** — Phase 4a's `taskDecisionSchema` already binds each decision to a durable `transitionId`; only the canvas handle is missing.
- Generalise the transition-`kind` persistence rather than adding a third special case: `error`, `slaBreach`, `outcome`, `guardrail` must all round-trip.
- Additive only; every existing definition unchanged when it declares none of this.
- No `any`, no bare `.sort()`, no `includes()` on feature arrays, i18n ×4, DS tokens only, status never colour-only.
- **Challenge premises.** ~20 real gaps have been found that way across this redesign, including two live bugs this phase's research surfaced.
