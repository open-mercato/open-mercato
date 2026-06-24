> 🗂️ **Reorg 2026-06-22 · Status: IMPLEMENTED (as-built design record).** The design here has shipped; it is superseded as a *plan* by the baseline doc and kept for provenance. Authoritative current docs: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` and `packages/enterprise/src/modules/agent_orchestrator/`.

# Agent MVP — Hackathon Sketch

> **Status:** MVP sketch · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-20 · **Target:** hackathon cut (next week)
> **Builds on:** [`agent-sdk-simplification-audit`](2026-06-20-agent-sdk-simplification-audit.md) (the core primitive) · [`runtime-options`](2026-06-19-agent-runtime-options-opencode-vs-in-process.md). UI target: [`agent-orchestration-architecture.html`](agent-orchestration-architecture.html) (the *Agent Cockpit* + propose→dispose flow).

## The wow (one sentence)

A developer writes ~20 lines to **define an agent** (instructions + tools + skills + typed result), **calls it like a function** and gets back something **actionable or informative** — then drops the *same* agent into a **visual workflow as a step** where it produces a proposal a human approves in a card, and the action executes. Authoring simplicity **and** governed workflow execution, from one definition.

## MVP scope

**IN (build for the cut):**
1. **Agent SDK core** — `defineAgent` / `runAgent` / `AgentResult` (actionable | informative). The callable primitive.
2. **`INVOKE_AGENT` workflow step (the hybrid) — CORE, with the easiest-possible UI.** The same agent, added to a workflow as **one "Invoke Agent" node** (pick agent · map input · auto-approve threshold). This is the headline experience for new users — *not* deferred.
3. **Cockpit UI** — fulfill the HTML's *Agent Cockpit* slice: the **proposal disposition card** (Approve / Edit / Reject) over **My Tasks**, the **workflow monitor** showing the parked `INVOKE_AGENT` step, and a **dev Agent Playground** (run an agent ad-hoc, see result + tools used).

**OUT / deferred (overlays — pointer to existing specs):**
- Eval harness + regression gating, token/cost metrics, dashboards rollups → defer ([eval-harness-and-metrics](2026-06-20-agent-eval-harness-and-metrics.md), [lifecycle](2026-06-19-agent-deployment-and-regression-gating.md)).
- External runtimes / dispatch / A2A / pull workers → defer (internal in-process only) ([dispatch](2026-06-19-agent-dispatch.md)).
- Identity OAuth-CC server → defer (internal agents use caller ctx + agent-principal attribution) ([identity](2026-06-19-agent-identity-and-on-behalf-of.md)).
- Full guardrails (injection/grounding/moderation) → defer; **keep only output-schema validation** (free, it's Zod) ([guardrails](2026-06-19-agent-runtime-guardrails.md)).
- Compliance / AI-Act / DSAR / fairness, claimant portal → defer (domain overlay) ([compliance](2026-06-19-agent-decision-transparency-and-ai-act.md)).
- Governed TDCR context plane, doc-ingest/OCR → defer; **MVP context = caller-supplied or a simple `retrieve` tool** ([context](2026-06-19-agent-context-knowledge-plane.md)).

## Pillar 1 — Agent SDK core

Authoring (auto-discovered `agents.ts`, like `events.ts`), built on `ai_assistant` `runAiAgentObject` object-mode + `defineAiTool` + `SKILL.md` + `AiModelFactory`:

```typescript
export const agents = [
  defineAgent({
    id: 'deals.health_check',                 // module.agent
    instructions: 'Assess a deal’s health and propose a next action.',
    skills: ['sales.deal-playbook'],          // SKILL.md packs (progressive disclosure)
    tools: ['deals.read', 'deals.list_activities'],   // defineAiTool, allowlisted, read-only
    model: { /* AiModelFactory resolution */ },
    loop: { maxSteps: 4 },
    result: { kind: 'actionable', schema: dealNextActionSchema },  // Zod → output.schema
  }),
]
```

Invocation — callable from anywhere:

```typescript
const r = await agentRuntime.run('deals.health_check', { dealId }, ctx)
// r: { kind:'informative', data } | { kind:'actionable', proposal: { actions, confidence, rationale } }
if (r.kind === 'actionable') { /* show in UI, gate, or executeProposal(r.proposal, ctx) */ }
```

MVP runtime responsibilities: resolve agent → load skills → expose allowlisted (read-only) tools → run bounded loop under `AiModelFactory` → validate output vs `result.schema` → write a **thin `AgentRun` row** (id, agentId, input ref, output, status — NO token/eval columns for MVP) → return typed result. Propose-only is structural (object-mode passes no tools that mutate).

## Pillar 2 — `INVOKE_AGENT` workflow step (the hybrid)

The same agent, as a workflow step. **MVP path = zero core-workflows change** (per GAP-03): model the step as an existing `EXECUTE_FUNCTION` activity that calls `agentRuntime.run(...)`, writes the result as a `Proposal`, then a `WAIT_FOR_SIGNAL` parks until disposition; a signal resumes.

```
workflow ──▶ [EXECUTE_FUNCTION: agentRuntime.run(agentId, input)] ──▶ writes Proposal
          ──▶ [disposition] auto-approve (confidence ≥ threshold)  ──▶ resume
                            else raise USER_TASK (My Tasks card)    ──▶ human Approve/Edit/Reject ──▶ resume
          ──▶ [EXECUTE_FUNCTION: effector] executes the approved action (OM Command, audited)
```

MVP disposition is deliberately thin: a **single threshold rule** (`confidence ≥ x → auto-approve`, else human task) — a plain check or one `business_rules` VALIDATION rule. Full rule packs/arbitration are deferred.

> **This step is MVP-CORE, not deferred.** The hackathon audience is new Open Mercato users; "drop an agent into a workflow and watch it run" is the headline experience, so the **`INVOKE_AGENT` step ships in the cut**. What stays flexible is only the *under-the-hood implementation*, never the user-facing single node (see next).

### Invoke Agent step — the easy UI (the crucial bit)

New users must add an agent to a workflow in **one node, three fields** — no two-step plumbing exposed. In the **workflow visual editor** there is a single **"Invoke Agent"** node:

```
┌─ Invoke Agent ───────────────────────────┐
│  Agent      [ deals.health_check     ▼ ]  │  ← dropdown of defineAgent() agents
│  Input      [ { dealId: {{deal.id}} } ]   │  ← map from workflow context
│  On result  ◉ Auto-approve if confidence ≥ [0.8]
│             ○ Always ask a human          │  ← the disposition, in one toggle
└───────────────────────────────────────────┘
   node shows live status: ▶ running · ⏸ waiting for approval · ✓ done
   click → opens the proposal card / I/O drawer
```

That is the entire authoring surface a newcomer touches.

### DECIDED (2026-06-20): first-class `INVOKE_AGENT` activity

The `workflows` module owner (Patryk Lewczuk) **approves adding `INVOKE_AGENT` as a first-class activity** to the core `workflows` module. The editor-macro fallback is **no longer needed** — we ship the clean first-class path. Concrete, additive change to `packages/core/src/modules/workflows/`:

- **Activity type:** add `INVOKE_AGENT` to the activity-type union/enum (`data/types.ts` / `workflows.ts`). **Additive only** — existing definitions stay valid; follows `BACKWARD_COMPATIBILITY.md`.
- **Executor case** (`lib/activity-executor.ts`): on execute, call `agent_orchestrator`'s `DispatchService`/`agentRuntime` to run the agent → return a **parked** status (same mechanism as `WAIT_FOR_SIGNAL`) so the instance waits; **resume on signal `agent_orchestrator.proposal.ready`** `{ processId, stepId, proposalId }` with the proposal in workflow context.
- **Activity config schema:** `{ agentId, input (context expression, e.g. {{deal.id}}), onResult: { autoApproveThreshold? } | { alwaysAsk: true } }` — the three editor fields above.
- **Disposition:** threshold → auto-approve and resume; else raise a `USER_TASK` (My Tasks card) → resume on human dispose. Reuses `business_rules` VALIDATION for the threshold.
- **Visual editor:** an "Invoke Agent" node in the palette + the three-field config panel (the easy UI). The node renders park/running/done status in the monitor.
- **BC + tests:** purely additive (no removal/rename); add executor tests + an additive enum/schema test; update the `workflows` `.snapshot-open-mercato.json` only if a persisted enum/migration is affected.

Because the agent layer never controls flow (it returns a proposal; the workflow + gate dispose), this keeps "LLM proposes, OM disposes" intact — `INVOKE_AGENT` is just a parking activity that yields a proposal.

**Result actionability ladder** (covers "actionable or informative"): informative → workflow just stores `data` and proceeds; actionable → disposition gate → approved action runs via an effector `EXECUTE_FUNCTION`/`CALL_API` under OM's authority.

## Pillar 3 — Cockpit UI (fulfill the mockup)

**Canonical UI = [`om-agent-cockpit-v3.html`](om-agent-cockpit-v3.html)** (the Agent Console mockup, now saved in this folder). It has **9 views across 3 personas**: Admin (Overview · Inbox · Processes · Process detail · Agents · Audit), Operator (My caseload · Open case), Engineer (Traces · Trace inspector · Agents). Signature components: the **process-detail timeline** (agent / system / human lanes), the **proposal disposition card** (verdict · confidence · reasons · gate · Approve/Edit/Reject), and the **Agent I/O drawer** (input · output · tools).

**Don't build all 9 for the cut.** MVP fulfils the spine of the mockup and stubs/deferred the metric- and overlay-heavy views:

| Mockup view (persona) | MVP | Why |
|---|---|---|
| **My caseload + Open case** (Operator) — 4-verb, proposal card | **BUILD** | The core HITL beat; this *is* propose→dispose. |
| **Process detail timeline** (Admin) — agent/system/human lanes | **BUILD** | The signature "wow"; shows `INVOKE_AGENT` parked → proposal → human → resume. Reuses workflow monitor. |
| **Agent I/O drawer** (input/output/tools) | **BUILD** | Cheap, high-wow; the only "trace" surface MVP needs. |
| **Overview** (Admin) — KPI tiles | **PARTIAL** | Show counts we already have (auto-completed %, needs-decision, queue depth). **Defer** cost/token/trust-trend tiles → metrics overlay. |
| **Agents registry** (Admin/Engineer) | **PARTIAL** | List agents from `defineAgent`. **Defer** trust/eval/override-rate columns → eval overlay. |
| **Inbox** (Admin) | **PARTIAL/reuse** | Folds into My caseload for MVP. |
| **Traces list + Trace inspector** (Engineer) — waterfall/context/eval/compare | **DEFER** | Needs trace+eval overlays; the I/O drawer covers the demo. |
| **Audit & compliance** (Admin) | **DEFER** | Compliance overlay. |

> The mockup is a **claims-supervisor ops console**. For the *developer* hackathon audience, MVP also adds one screen the mockup lacks: a **dev Agent Playground** (run a `defineAgent` ad-hoc, see result + tools-used) — the instant-gratification "I wrote 20 lines and it runs" beat. Three MVP screens, drawn from the mockup's components:

```
┌─ A. Agent Playground (dev wow) ─────────────────────────────┐
│  Agent: [deals.health_check ▼]   Input: { dealId: "…" }      │
│  [ Run ]                                                     │
│  ─────────────────────────────────────────────────────────  │
│  Result ● actionable   confidence 0.82                      │
│   Proposal: "Schedule follow-up call; flag at-risk"         │
│   actions: [ create_task, set_stage ]      [Approve][Edit]  │
│   ▸ Run trace: tools used · steps · output (collapsible)    │
└─────────────────────────────────────────────────────────────┘

┌─ B. My Tasks → Proposal disposition card (operator) ────────┐
│  Pending proposals (verb: Decide)                           │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ deals.health_check · Deal #1423   confidence 0.62      │ │
│  │ Proposal: set stage = "At risk", create follow-up      │ │
│  │ input ▸  output ▸  tools ▸                             │ │
│  │ [ Approve ]  [ Edit ]  [ Reject ]                      │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

┌─ C. Workflow monitor (reused) ─────────────────────────────┐
│  Instance #88  ● running                                    │
│   ✓ load deal   ⏸ INVOKE_AGENT (parked: awaiting proposal)  │
│   ○ disposition   ○ effector                                │
│   └▸ opens the proposal card (B)                            │
└─────────────────────────────────────────────────────────────┘
```

UI rules (house): DS status tokens for the actionable/confidence/parked states; `useT()` i18n; `apiCall*`; the Approve/Edit/Reject write goes through `useGuardedMutation` and surfaces optimistic-lock 409s; `Cmd/Ctrl+Enter` submit. Built via **widget injection** into the workflow monitor + My Tasks (spot ids: `data-table:<tasks>:row-actions`, `admin.page:*`), not a new app.

> Deferred from the mockup for MVP: the engineer **Trace inspector** (waterfall/context-routing/eval/compare), **Audit & compliance**, and the cost/token/trust KPI tiles — all sit on the eval/metrics/compliance overlays. The MVP fulfils caseload + process-detail timeline + I/O drawer, which is the full propose→dispose story. (The mockup's persona switcher, rail, and DS tokens are reused as-is.)

## Demo script (the hackathon narrative)

1. **Author** `deals.health_check` in `agents.ts` (~20 lines) — show the code.
2. **Playground:** run it on a deal → live actionable proposal + "tools used" trace. *(instant gratification)*
3. **Same agent, in a workflow:** trigger a workflow whose step is `INVOKE_AGENT deals.health_check` → monitor shows it **park**.
4. **My Tasks:** the proposal card appears → operator clicks **Approve** (or **Edit**) → workflow **resumes** → effector creates the task / sets the stage (audited).
5. Punchline: *"One definition. Callable as a function, governed as a workflow step, with a human in the loop — no eval/dispatch/compliance scaffolding needed to ship."*

## MVP build checklist (~1 week, ordered)

1. **SDK core:** `defineAgent` + `agents.ts` auto-discovery; `agentRuntime.run` over `runAiAgentObject`; `AgentResult` union; thin `AgentRun` row + a `Proposal` row (id, agentId, payload, confidence, disposition). *(P0)*
2. **Playground screen (A):** pick agent + input → run → render result + collapsible trace. *(P0 — the dev wow)*
3. **Workflow "Invoke Agent" step + node:** the single editor node (agent dropdown · input map · auto-approve threshold) → `agentRuntime.run` → write Proposal → park (`WAIT_FOR_SIGNAL`) → resume on `agent.proposal.ready`. First-class activity if owner sign-off lands, else the editor-macro composition — same one-node UX. *(P0 — the headline)*
4. **Disposition:** threshold auto-approve else raise `USER_TASK`; dispose endpoint (Command + optimistic lock) → resume. *(P0)*
5. **Proposal card (B) on My Tasks + step status in monitor (C):** widget injection. *(P1)*
6. **One effector step** (`CALL_API`/Command) executing the approved action, audited. *(P1)*
7. **Seed demo:** one agent, one workflow def, one threshold rule. *(P1)*

Deferred entirely for the cut: eval, token/cost metrics, guardrails beyond schema-validation, dispatch/A2A, identity-OAuth, compliance, TDCR plane, doc-ingest.

## Reuse map (what already exists)

- `runAiAgentObject` object-mode + `AiModelFactory` + `defineAiTool` + `SKILL.md` → Pillar 1 (no new engine).
- `workflows` `EXECUTE_FUNCTION` + `WAIT_FOR_SIGNAL` + monitor + My Tasks + `business_rules` VALIDATION → Pillar 2 + 3 (reuse, no core change).
- The nine `2026-06-19` specs + 2 consolidating specs → the **deferred overlays** to grow into after the hackathon.

## Open questions (small)

- **Demo domain:** `deals.health_check` (sales/CRM) is used here as a generic, data-rich example. Swap to whatever vertical the hackathon judges know best? (Recommend a CRM/sales example — relatable, existing data.)
- **Edit affordance:** for MVP, "Edit" = edit the proposal payload before approve (writes the edited action). Keep, or MVP-cut to Approve/Reject only? (Recommend keep Edit — it's the most impressive HITL beat.)
- **Build the MVP cockpit from the mockup:** `om-agent-cockpit-v3.html` is the canonical UI (now in this folder). Wire its caseload + process-detail timeline + I/O-drawer views to the real `runAgent`/proposal/workflow APIs and stub the deferred views — keep the mockup's exact look (DS tokens, persona switch)? (Recommend yes.) Separately, the **architecture HTML** still shows the old heavy design (9 subdomains + `eval-runner`) and should be refreshed to the simplified MVP for demo day. (I can produce both.)

## Changelog

- **2026-06-20:** MVP/hackathon sketch. Hybrid of the simplified Agent SDK (callable primitive) + an `INVOKE_AGENT` workflow step (zero-core `EXECUTE_FUNCTION`+`WAIT_FOR_SIGNAL` composition) + the cockpit UI slice from the architecture HTML (playground + proposal disposition card + reused workflow monitor/My Tasks). Eval, token-usage/metrics, dispatch/A2A, identity-OAuth, compliance, TDCR explicitly deferred to overlays. Includes demo script + 1-week build checklist.
