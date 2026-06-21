# LIFECYCLE: Gradual-Autonomy Controller & Shadow-Mode Dispatch — Design Analysis

> **Gap:** GAP-14 · **Priority:** P2 · **Status:** Design analysis (not a spec)
> **Module:** `agent_orchestrator` (core) · **subdomain:** lifecycle (`lib/lifecycle/`)
> **Related:** `2026-06-19-agent-deployment-and-regression-gating.md` (lifecycle), `2026-06-19-agent-dispatch.md` (dispatch), `2026-06-19-agent-trace-eval-capture.md` (trace), `2026-06-19-agent-orchestrator-conventions.md` (normative house style)
> **Reuses:** `feature_toggles`, `packages/scheduler`, `packages/queue`, trace metrics. **Does not exist:** telemetry-and-otel, eval-runner (the gate uses the GAP-04 trace harness). Principle: **"LLM proposes, OM disposes."**

## 1. Gap statement

The lifecycle spec asserts two safety-critical mechanics but leaves the *how* unspecified, and each hides a real design problem:

- **Part A — Autonomy controller.** `AgentRelease.autonomy` (`gated → review → auto`) is supposed to "widen automatically only when the override rate is under threshold for the window, and only one step at a time." Nothing specifies *who computes that*, *how often*, *what statistical bar a widening must clear*, *how oscillation is prevented*, or *whether the final jump to fully-autonomous `auto` can be machine-made at all*. Done naively this is the "ratio mirage": a release widens to `auto` off a handful of low-confidence approvals, then silently degrades.
- **Part B — Shadow-mode dispatch.** The spec says a `stage='shadow'` candidate "runs on identical inputs with no side effects" and is compared via the trace model-comparison view. It does not say *how a shadow run is triggered relative to the prod dispatch*, *how isolation is guaranteed* (no Commands, no effectors, no signal resume), or *how the cost of a second inference per dispatch is bounded*. The danger is a shadow path that accidentally executes a business effect or resumes the parent workflow — a direct violation of "OM disposes."

Both must hold across tenants and must be reversible (a freeze / rollback must always be possible without data loss).

## 2. Architectural drivers

1. **Safety / no premature autonomy widening** — the controller must never out-run the evidence; widening is one-way per-step and human-gated at the riskiest boundary.
2. **Statistical confidence of override-rate** — a rate over 3 samples is noise; widening needs a minimum sample size and a confidence-aware threshold, not a point estimate.
3. **Cost of shadow double-inference** — shadow doubles LLM spend on every shadowed dispatch; it must be sampled and budget-aware (interacts with `AgentBudget`).
4. **Determinism / reproducibility** — both the controller decision and the shadow comparison must be re-derivable from this module's own tables (audit, contestability).
5. **Tenant scoping** — override rate, rollout %, and shadow runs are all per-tenant; a global ramp is a tenant-isolation bug.
6. **Reversibility** — freeze, manual pin, and one-step rollback must be first-class; the ramp must be *suspendable* without losing the release.

## 3. Approaches

### Part A — Autonomy controller

**A1 — Scheduled-worker ramp (recommended).** A `packages/scheduler` DB-managed schedule (`SchedulerService.register({ scheduleType: 'cron', targetType: 'queue', scopeType: 'tenant', … })`) enqueues an `agent_orchestrator` queue worker (mirroring `data_sync/workers/sync-scheduled.ts`: scheduler enqueues with tenant context → worker reads a DB row → acts). The worker iterates active `AgentRelease`s per tenant, reads the trace spec's per-agent override-rate metric over the configured window, and advances `autonomy` one step **iff** all hold: (a) override rate < threshold, (b) sample size ≥ `minSamples`, (c) the eval gate still passes, (d) hysteresis band cleared (must beat threshold by a margin, and have stayed below for *N consecutive* windows). The final step `review → auto` requires **human confirmation** (a record-flagged "eligible for auto" state the cockpit surfaces, promoted by an operator via the `promote` command path), never a machine jump.

**A2 — Event-driven recompute.** Recompute the ramp on each `agent_orchestrator.proposal.corrected` event (a subscriber). Reacts instantly but re-derives a window aggregate on every correction (hot path, N+1 over the window), is harder to make idempotent, and couples ramp logic to correction volume rather than to a stable cadence.

**A3 — Manual-only with surfaced recommendation.** The controller only *computes and surfaces* a recommendation in the cockpit; every widening is an operator click. Safest, zero automation risk, but defeats the spec's "widens automatically" intent and does not scale across many agents/tenants.

### Part B — Shadow dispatch

**B1 — Live fan-out at the INVOKE_AGENT step (recommended for fidelity).** When the dispatch `TaskRouter` resolves the prod binding for a dispatch, it *also* enqueues a second, shadow `AgentTask` against the `stage='shadow'` candidate release on the **same `ContextBundle`/input** (same `contextRef`, cloned payload-by-reference key — read-only). The shadow task is propose-only: mutation-policy forced, no effectors, no signal/`WAIT_FOR_SIGNAL` resume, its proposal discarded after the trace records it. Comparison is the trace model-comparison view. True live shadow; costs a full second inference per shadowed dispatch.

**B2 — Offline replay.** Periodically replay recorded production inputs (`AgentRun` inputs / eval cases from the trace export) against the candidate in a batch worker. No live double-inference, naturally rate-limited, cannot touch the live workflow. But it is *not* true live shadow — it misses live context/timing drift and tests the candidate against yesterday's traffic.

**B3 — Hybrid (sampled live + replay backfill).** Live fan-out on a *sampled* fraction of dispatches (cost-bounded, true-live signal) plus a periodic replay sweep for breadth. Best coverage; most moving parts.

## 4. Trade-off matrix

### Part A

| Approach | Safety | Statistical rigor | Cost / load | Determinism | Reversibility | Fit to spec |
|---|---|---|---|---|---|---|
| **A1 scheduled worker + hysteresis + min-sample + human final** | High (one-way, human-gated `auto`) | High (window + min-sample + hysteresis) | Low (cadence-bounded) | High (re-derivable from tables) | High (freeze/pin per release) | **Strong** |
| A2 event-driven | Medium (reacts to noise) | Medium (recompute churn) | Higher (hot path) | Medium | Medium | Partial |
| A3 manual-only | Highest | Operator-dependent | Lowest | High | Highest | Weak (not "automatic") |

### Part B

| Approach | Fidelity (live signal) | Isolation risk | Cost (double inference) | Comparison surfacing | Complexity |
|---|---|---|---|---|---|
| **B1 live fan-out (propose-only)** | High | Low *if* mutation-policy forced + no resume | High (1 extra inference/dispatch) | Direct (trace view) | Medium |
| B2 offline replay | Low–Medium (stale traffic) | Very low (never live) | Low (batch, no live double) | Direct (trace view) | Low |
| B3 hybrid (sampled live + replay) | High | Low | **Bounded** (sample %) | Direct (trace view) | High |

## 5. Recommendation

**Part A — adopt A1.** A `packages/scheduler` cron → `packages/queue` worker reads the trace override-rate metric per `AgentRelease` per tenant and advances `autonomy` one step per window only when the override rate beats the threshold by a hysteresis margin **and** sample size ≥ `minSamples` **and** the eval gate still passes. The `review → auto` boundary is **human-confirmed**, not machine-made — the worker only marks the release *eligible*, and an operator promotes through the existing audited `promote` command. The controller never narrows autonomy automatically (a freeze/rollback is an explicit operator action). This satisfies every driver: cadence-bounded cost, re-derivable decisions, per-tenant scoping, and a hard safety stop at the autonomy boundary that matters most.

**Part B — adopt B1 as the mechanism, default it to sampled (i.e. converge toward B3) and keep B2 as the breadth backstop. This is the one inconclusive point: live-shadow vs replay.** The deciding factor is **cost vs fidelity**: live fan-out (B1) is the only way to compare the candidate against *real, current* traffic and live context routing, which is the whole point of shadow before a canary; offline replay (B2) is materially cheaper but tests stale traffic. Recommendation: implement B1 with a per-release **shadow sample rate** that defaults low and is bounded by `AgentBudget` (so shadow can never blow the cost cap), and run B2 replay periodically for coverage. If a tenant's budget cannot absorb any live double-inference, fall back to B2-only for that tenant. **Decide the default sample rate at spec time against a real cost ceiling — that single number is what makes this conclusive.**

**Isolation is non-negotiable in both:** the shadow `AgentTask` MUST force the candidate to propose-only (no Commands, no effectors), MUST NOT hold or resume the parent workflow's `WAIT_FOR_SIGNAL`, and MUST discard its proposal after the trace captures it. This is the GAP enforcement of "LLM proposes, OM disposes" and needs an explicit no-side-effect / no-resume test as a release gate.

## 6. Effort, risks, dependencies

**Effort: M.** Part A is a scheduler entry + one idempotent queue worker + a ramp decision function over existing trace metrics + a cockpit "eligible for auto" surface + the human-confirm path on the existing `promote` command. Part B is a fan-out branch in the dispatch `TaskRouter` + a propose-only shadow task variant + the sample-rate/budget guard + reuse of the trace comparison view. No new infra; both ride existing packages.

**Risks.**

| Risk | Severity | Mitigation |
|---|---|---|
| Ratio mirage — ramp widens off noisy/low-sample override rate | High | `minSamples` + hysteresis (consecutive windows, margin) + eval-gate re-check + human-confirmed `auto`; never auto-widen past `review` |
| Shadow leaks a side effect or resumes the workflow | High | Force mutation-policy propose-only on `stage='shadow'`; no effectors; no signal resume; discard proposal; no-side-effect + no-resume release-gate test |
| Shadow double-inference blows cost | Medium | Per-release sample rate bounded by `AgentBudget`; B2-only fallback when budget is tight |
| **`feature_toggles` has no native % rollout** — entity is boolean/string/number/json with only per-`(toggle, tenantId)` overrides; there is no rollout-percentage column or hashing | Medium–High | The **canary % logic lives in `ReleaseService`/`TaskRouter`, not in the toggle**: store the pct as a `number` toggle (or per-tenant in/out as a `boolean` override) and have the consumer do the deterministic bucketing. Do **not** assume the toggle store computes the split — the dispatch spec's "canary % per tenant gating the binding selection" must be implemented in the consumer |
| Ramp/shadow run cross-tenant | High | Worker iterates per tenant; all reads filter `organizationId`; shadow task carries `tenant_id`+`organization_id` |
| Non-deterministic ramp decision | Medium | Decision derived only from this module's tables + the release's stored thresholds; log the inputs on each ramp event for contestability |

**Dependencies (sequence-blocking).**
- **Trace harness + per-agent override-rate metric (GAP-04 / trace spec).** The ramp's only input. The controller is inert until trace metrics exist — Part A sequences strictly behind it.
- **Dispatch `TaskRouter` + `AgentTask` propose-only path + `ContextBundle`/`contextRef` (dispatch spec).** Part B's fan-out attaches here.
- **`AgentBudget` (lifecycle spec).** Bounds shadow sampling cost.
- **`feature_toggles` `FeatureTogglesService`** for canary gating — with the caveat above that the percentage math is the consumer's, not the toggle's.

## 7. Deliverables + Acceptance

**Deliverables.**
- A1 ramp: `packages/scheduler` cron entry + `lib/lifecycle/AutonomyRampService` + a `workers/` queue worker (idempotent, per-tenant) that advances `autonomy` one step under threshold+min-sample+hysteresis; cockpit "eligible for `auto`" surface; human-confirm wired through the existing audited `promote` command.
- B1 shadow: `TaskRouter` fan-out enqueuing a propose-only shadow `AgentTask` on the same `contextRef`; per-release shadow sample rate bounded by `AgentBudget`; B2 replay sweep worker as the breadth backstop; comparison via the trace model-comparison view.
- Thresholds (`overrideRateThreshold`, `minSamples`, `windowsRequired`, `shadowSampleRate`) as validated config (Zod in `data/validators.ts`), defaulted conservatively.

**Acceptance.**
- A release's `autonomy` advances at most one step per evaluation window, only when override rate beats the threshold by the hysteresis margin over `windowsRequired` consecutive windows with sample size ≥ `minSamples`, and only while the eval gate passes; `review → auto` requires a human confirmation and is never machine-made.
- The ramp never auto-narrows; freeze/pin and rollback are operator actions and lose no release state.
- A `stage='shadow'` candidate runs on the **same input/`contextRef`** as production, produces **no Commands, no effectors, and never resumes the parent workflow**, and is comparable via the trace view — enforced by a no-side-effect / no-resume test that gates release.
- Shadow inference cost stays within the applicable `AgentBudget`; when budget cannot absorb live double-inference, the tenant falls back to replay-only.
- All ramp and shadow records carry `tenant_id`+`organization_id`; cross-tenant access is denied (explicit test). The canary split is computed in the consumer over a `feature_toggles` value, not assumed from the toggle store.

## Changelog

- **2026-06-19:** Initial GAP-14 design analysis. Recommended A1 (scheduled-worker autonomy ramp with hysteresis + min-sample + human-confirmed `auto`) and B1-toward-B3 (live propose-only shadow fan-out, sampled and `AgentBudget`-bounded, with B2 replay backstop); flagged live-shadow-vs-replay as the one inconclusive point with cost-vs-fidelity as the deciding factor. Corrected the load-bearing assumption that `feature_toggles` does percentage rollout natively — it stores only per-`(toggle, tenantId)` value overrides (`FeatureTogglesService.getNumberConfig`/`getBoolConfig`), so the canary % must be computed in `ReleaseService`/`TaskRouter`. Grounded the scheduler→queue worker pattern in `SchedulerService.register` (`scheduleType: 'cron'`, `targetType: 'queue'`, `scopeType: 'tenant'`) + `data_sync/workers/sync-scheduled.ts` and the queue worker contract (`metadata { queue, id, concurrency }`).
