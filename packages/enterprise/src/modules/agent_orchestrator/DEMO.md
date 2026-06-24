# Agent Orchestrator — Demo & Test Guide

Hands-on guide to test the MVP on sample data. Two paths: **(A) Playground** — test the agent alone in seconds, no DB; **(B) Workflow** — the full propose → dispose → resume → effector loop.

## 0. Prerequisites

```bash
# 1. An LLM provider key (any one of these)
export ANTHROPIC_API_KEY=sk-ant-...      # or OPENAI_API_KEY=sk-...

# 2. Generate registries + apply the migration
yarn generate
yarn db:migrate                          # creates agent_runs + agent_proposals

# 3. Grant the agent_orchestrator.* features to existing roles
yarn mercato auth sync-role-acls

# 4. (optional) seed the demo agent is code-based (already discovered by step 2's generate);
#    seed the demo workflow definition + demo deals on a fresh/example tenant:
yarn initialize                          # or onboarding with examples enabled
```

Then `yarn dev` and log in as an admin (admins hold `agent_orchestrator.*`).

---

## A. Playground test (no DB, ~10 seconds)

The fastest way to test the agent on sample data. The agent runs in **object-mode with no tools**, so it reasons *only* over the JSON you paste — fully self-contained.

1. Open **Backend → Agent Orchestrator → Playground** (`/backend/agent_orchestrator/playground`).
2. Pick agent **`deals.health_check`**.
3. Paste one of the sample inputs below into the input box and click **Run**.
4. You get a typed **actionable** result: a `set_stage` action + `confidence` + `rationale`, with a tools/steps trace.

### Sample input 1 — healthy deal (expect high confidence, ≥ 0.8 → would auto-approve)
```json
{
  "deal": {
    "id": "demo-healthy-1",
    "name": "Acme renewal",
    "stage": "Proposal",
    "value": 48000,
    "probability": 0.85,
    "daysInStage": 4,
    "recentActivity": "Buyer confirmed budget on a call yesterday; legal reviewing the contract."
  }
}
```
*Expect:* `confidence` ~0.85–0.95, an action like `{ "type": "set_stage", "payload": { "stage": "Negotiation" } }` (or "Closing"/"Contract").

### Sample input 2 — at-risk deal (expect low confidence, < 0.8 → would route to a human)
```json
{
  "deal": {
    "id": "demo-atrisk-1",
    "name": "Globex expansion",
    "stage": "Qualification",
    "value": 120000,
    "probability": 0.2,
    "daysInStage": 63,
    "recentActivity": "No reply to the last 3 emails; champion left the company."
  }
}
```
*Expect:* `confidence` ~0.3–0.6, an action proposing a cautious stage (e.g. back to "Discovery" / "On hold"), `rationale` flagging the stall.

### Sample input 3 — edge / ambiguous
```json
{
  "deal": {
    "id": "demo-edge-1",
    "name": "Initech pilot",
    "stage": "Discovery",
    "value": 9000,
    "probability": 0.5,
    "daysInStage": 21,
    "recentActivity": "Positive demo, but pricing not yet discussed."
  }
}
```

### Sample input 4 — read-only tool loop (fetch the deal by id)

Instead of passing the deal inline, give the agent only a `dealId`. The agent calls the read-only `customers.get_deal` tool to fetch it, then proposes. Use a **real** `customers` deal id from your tenant:

```json
{
  "dealId": "c6a05513-3536-4993-a754-57c28df48d9f"
}
```

*Expect:* a normal `actionable` proposal — but this run exercised the tool loop (`runAiAgentObject({ enableTools })` → `generateText` + `experimental_output`). The agent could **read** the deal but cannot modify it (read-only policy strips every mutation tool). The tool runs under **your** ACL, so you need `customers.deals.view`.

> **What this proves:** authoring (`defineAgent`) + the runtime (`agentRuntime.run` over `runAiAgentObject`) + the typed `AgentResult` (`actionable`) + propose-only. Samples 1–3 use object-mode (no tools); sample 4 uses the read-only tool loop. Each run also writes an `AgentRun` (+ `AgentProposal`) — see **Backend → Agent Orchestrator → Overview / Runs**.

---

## B. Workflow test — full propose → dispose → resume → effector

The demo definition **`agent_orchestrator_deals_health_check_v1`** (`examples/deals-health-check-workflow.json`):

```
start → assess (INVOKE_AGENT deals.health_check, onResult: auto-approve ≥ 0.8)
      → apply (UPDATE_ENTITY customers.deals.update → sets pipelineStage from the approved proposal)
      → end
```
`assess` runs the agent + inline disposition: **confidence ≥ 0.8 → auto-approve and proceed**; **otherwise → park** for an operator. The approved (or operator-edited) stage flows to the effector via `context.proposalPayload`.

### Start an instance
In **Backend → Workflows → Definitions**, open *Deal Health Check (Agent)* and **Start** an instance with this context (or call `workflowExecutor.startWorkflow(...)`). The `deal` object is passed straight into the agent; set `deal.id` to a **real deal id** if you want the `apply` effector to land a DB write (grab one from **Backend → Customers → Deals**, or use a seeded `[Demo]` deal).

**Auto-approve run** (healthy → no human step):
```json
{
  "deal": {
    "id": "c6a05513-3536-4993-a754-57c28df48d9f",
    "name": "Acme renewal",
    "stage": "Proposal",
    "value": 48000,
    "probability": 0.88,
    "daysInStage": 3,
    "recentActivity": "Verbal yes; contract out for signature."
  }
}
```
*Expect:* `assess` auto-approves (`disposition_by = 'rule:threshold'`), no park, `apply` sets the deal's pipeline stage, instance **COMPLETED**.

**Human-review run** (at-risk → parks for an operator):
```json
{
  "deal": {
    "id": "ce0641fa-03f8-44d0-9989-42eedcd4a73a",
    "name": "Globex expansion",
    "stage": "Qualification",
    "value": 120000,
    "probability": 0.2,
    "daysInStage": 63,
    "recentActivity": "Champion left; no reply in 3 weeks."
  }
}
```
*Expect:* `assess` **parks** (instance `PAUSED`, monitor shows ⏸). The proposal appears in **Backend → Agent Orchestrator → Caseload**.

### Dispose as an operator
Open the proposal in the **Caseload**, then:
- **Approve** → workflow resumes, `apply` sets the proposed stage.
- **Edit** → change the stage in the payload (+ reason), then approve → the *edited* stage is applied (proves the payload seam: the effector reads `context.proposalPayload.actions.0.payload.stage`).
- **Reject** (+ reason) → workflow resumes but the guarded `assess → end` transition **skips** the effector; the deal is unchanged.

---

## What to look for

| Surface | Path |
|---|---|
| Runs + results | Backend → Agent Orchestrator → **Overview / Runs** |
| Pending proposals | Backend → Agent Orchestrator → **Caseload** |
| Proposal I/O (input/output/tools) | Caseload → open a proposal → **I/O drawer** |
| Workflow park/resume | Backend → **Workflows → Instances** (the demo instance; `assess` ⏸ → ✓) |
| Add the step to your own flow | Workflows visual editor → drag the **Invoke Agent** node |

## Troubleshooting

- **"no provider configured" / model error** → set a provider key (§0) and restart `yarn dev`.
- **Agent not in the Playground dropdown** → run `yarn generate` (discovers `ai-agents.ts`); confirm you have `agent_orchestrator.agents.view`.
- **Caseload empty after a human-review run** → confirm the instance is `PAUSED` in Workflows → Instances and you have `agent_orchestrator.proposals.view`.
- **`apply` step fails** → `deal.id` must be a real `customers` deal id for the `UPDATE_ENTITY` write; for pure agent testing use the Playground (no DB).
- **Confidence always high/low** → tune `probability` / `daysInStage` / `recentActivity` in the sample, or change the node's `onResult.autoApproveThreshold` in the workflow.
