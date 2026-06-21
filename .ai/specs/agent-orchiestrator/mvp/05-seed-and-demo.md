# 05 · Seed & Demo

> **Status:** Ready to implement · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-20
> **Module:** `agent_orchestrator/setup.ts` · **Depends:** 01–04 · **Area of:** [`mvp/00-overview.md`](00-overview.md)

## TLDR

Make the demo run end-to-end on a **fresh tenant**. This area ships the `agent_orchestrator` module's `setup.ts`: `defaultRoleFeatures` mapping every `agent_orchestrator.*` ACL feature to roles (so the superadmin/admin, operator, and engineer/dev personas each see the right surfaces), an idempotent `seedDefaults` that writes the threshold disposition config, and a gated `seedExamples` that lands the demo agent (`deals.health_check`, authored in `ai-agents.ts` per area 01), a demo **workflow definition** containing the `INVOKE_AGENT` step (area 02 activity), and a couple of demo deals. Plus the runbook that matches 00's global acceptance. No SDK or activity is re-defined here — this area only seeds and orchestrates what 01–04 build.

## Scope

**IN:**
1. **`defaultRoleFeatures`** — every `agent_orchestrator.*` feature mapped to roles (superadmin/admin full, operator queue-worker, engineer/dev read+run).
2. **`seedDefaults`** (always runs) — the threshold disposition config (idempotent, tenant-scoped). The auto-approve threshold the `INVOKE_AGENT` gate reads.
3. **`seedExamples`** (gated, demo-only) — the demo workflow definition JSON (with the `INVOKE_AGENT` step) + a couple of demo deals so a run produces a proposal. The demo agent itself is **code-defined** in `ai-agents.ts` (area 01), not seeded.
4. **Demo runbook** — author/seed → playground run → trigger workflow → park → operator approve in caseload → resume → effector; + reset.

**OUT (deferred overlays, per 00 §Out of scope):** guardrail-set YAML sync (`agent_guardrail_sets`), starter capability registry, dispatch/identity/trace config rows, content-hash-versioned defaults. GAP-18's full inventory (guardrail sets, capabilities, dispatch config) belongs to the post-hackathon overlays; the MVP threshold lives in **one** disposition config the gate reads, not a `business_rules` GUARD/VALIDATION pack.

## Files to create / modify (real paths)

| Path | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/agent_orchestrator/setup.ts` | create | `defaultRoleFeatures` + `seedDefaults` + `seedExamples` (this area owns this file) |
| `packages/core/src/modules/agent_orchestrator/lib/seeds.ts` | create | idempotent seed helpers (mirror `workflows/lib/seeds.ts`) |
| `packages/core/src/modules/agent_orchestrator/examples/deals-health-check-workflow.json` | create | demo workflow definition with the `INVOKE_AGENT` step |
| `packages/core/src/modules/agent_orchestrator/ai-agents.ts` | reference (area 01) | demo agent `deals.health_check` is **here**, via `defineAgent`; not seeded |
| `packages/core/src/modules/agent_orchestrator/acl.ts` | reference (areas 01/03/04) | source of the feature list `defaultRoleFeatures` mirrors |
| `packages/core/src/modules/customers/...` | read-only | demo deals are created via `customers` Command/CRUD, never raw ORM into another module |

Seeds reuse the `workflows/lib/seeds.ts` precedent verbatim: read JSON from `examples/`, find-by-stable-id within `(tenantId, organizationId)`, create-if-absent, flush once. `seeds.ts` uses the same `readExampleJson` candidate-path resolver (so it works from build output and from `process.cwd()`).

## defaultRoleFeatures

Mirrors the frozen ACL feature set (00 §ACL features) plus area 03/04 additions. **Every** concrete `agent_orchestrator.*` feature MUST appear under at least one role (a guard test asserts this — see Integration Coverage). Wildcard `agent_orchestrator.*` is the contract per `packages/core/AGENTS.md` § ACL.

| Feature | superadmin | admin | operator | engineer/dev |
|---|:--:|:--:|:--:|:--:|
| `agent_orchestrator.agents.view` | ✓ | ✓ | ✓ | ✓ |
| `agent_orchestrator.agents.run` (playground ad-hoc run) | ✓ | ✓ | – | ✓ |
| `agent_orchestrator.proposals.view` | ✓ | ✓ | ✓ | ✓ |
| `agent_orchestrator.proposals.dispose` (Approve/Edit/Reject) | ✓ | ✓ | ✓ | – |
| `agent_orchestrator.workflows.author` (the Invoke Agent builder node) | ✓ | ✓ | – | ✓ |

```typescript
// setup.ts (excerpt)
defaultRoleFeatures: {
  superadmin: ['agent_orchestrator.*'],
  admin: ['agent_orchestrator.*'],
  operator: [
    'agent_orchestrator.agents.view',
    'agent_orchestrator.proposals.view',
    'agent_orchestrator.proposals.dispose',
  ],
  engineer: [
    'agent_orchestrator.agents.view',
    'agent_orchestrator.agents.run',
    'agent_orchestrator.proposals.view',
    'agent_orchestrator.workflows.author',
  ],
}
```

> **Persona mapping.** `operator` works the **My caseload** queue and disposes proposals but cannot run the playground or author workflows. `engineer` (the dev persona) runs the **Playground**, authors the `INVOKE_AGENT` node, and reads proposals, but does **not** dispose (HITL stays with the operator). superadmin/admin get the full wildcard. If a deployment lacks a literal `operator`/`engineer` role, map these to the nearest existing default role and note it; the demo expects all three persona role names present (created by the demo runbook step 0 if absent).

**ACL sync note:** new tenants get these at setup. Existing tenants only after:
```bash
yarn mercato auth sync-role-acls
```
Run it automatically after adding/changing `acl.ts` features unless asked not to (per `packages/core/AGENTS.md` § ACL Grant Sync).

## seedDefaults (threshold config, idempotent — always runs)

One config row: the auto-approve threshold the `INVOKE_AGENT` gate (area 03) reads when a node uses `onResult: { autoApproveThreshold }` but the workflow author left it unset, and the master enable toggle. Scoped by `tenant_id` **and** `organization_id`, stored via the `configs` module pattern (no global rows). Idempotent: find-by-key in scope, create-if-absent, never overwrite a tenant-customized value.

| Config key | Default | Meaning |
|---|---|---|
| `agent_orchestrator.proposal.auto_approve_enabled` | `true` | master toggle for confidence-threshold auto-approval |
| `agent_orchestrator.proposal.default_auto_approve_threshold` | `0.8` | fallback threshold when a node omits `autoApproveThreshold` |

```typescript
// lib/seeds.ts (sketch — idempotent upsert per key)
const DEFAULT_DISPOSITION_CONFIG = [
  { key: 'agent_orchestrator.proposal.auto_approve_enabled', value: true },
  { key: 'agent_orchestrator.proposal.default_auto_approve_threshold', value: 0.8 },
] as const

export async function seedDispositionDefaults(em, scope /* {tenantId, organizationId} */) {
  for (const { key, value } of DEFAULT_DISPOSITION_CONFIG) {
    const existing = await em.findOne(Config, { key, tenantId: scope.tenantId, organizationId: scope.organizationId })
    if (existing) continue // never clobber tenant overrides
    em.persist(em.create(Config, { key, value, tenantId: scope.tenantId, organizationId: scope.organizationId }))
  }
  await em.flush()
}
```

> The per-node `autoApproveThreshold` in the workflow JSON (`0.8`) is the authoritative gate value for the demo; this config is the tenant-wide fallback + master switch. Keeping the threshold in the node config (not a `business_rules` pack) is the deliberate MVP simplification from the hackathon sketch (§Pillar 2: "a single threshold rule … a plain check").

## seedExamples (demo agent, demo workflow, demo deals — gated, skipped with `--no-examples`)

Three pieces, all idempotent and tenant-scoped:

1. **Demo agent — NOT seeded.** `deals.health_check` is authored in `agent_orchestrator/ai-agents.ts` via `defineAgent` (area 01) and discovered by the existing `ai-agents.ts` generator. Code-defined agents must not be shadowed by DB rows (same lesson as `workflows.ts` code-defined definitions in `workflows/lib/seeds.ts`). `seedExamples` only verifies the agent id resolves and logs a skip if absent.
2. **Demo workflow definition** — `examples/deals-health-check-workflow.json`, seeded with the same `seedWorkflowDefinition` upsert (find by `workflowId` in scope, create-if-absent). Contains the `INVOKE_AGENT` step (area 02 activity).
3. **Demo deals** — create 2 `customers` deals through the **customers Command/CRUD path** (never raw ORM into another module; cross-module writes go through that module's commands per conventions §3.9). One "healthy", one "at-risk" so a run produces a non-trivial proposal. Idempotent by a stable demo title/external-ref; skip if already present.

```typescript
// setup.ts
seedExamples: async (ctx) => {
  const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
  await seedDealsHealthCheckWorkflow(ctx.em, scope)        // examples/deals-health-check-workflow.json
  await seedDemoDeals(ctx.container, scope)                // via customers commands
  // deals.health_check agent is code-defined in ai-agents.ts (area 01) — not seeded
}
```

## The demo workflow definition (sketch)

`examples/deals-health-check-workflow.json` — a minimal definition exercising the headline path. Shape follows `workflows/examples/sales-pipeline-definition.json` (steps + transitions, `WorkflowDefinitionData`). The single new piece is the `INVOKE_AGENT` activity (area 02), whose `config` carries the exact contract from 00 §Workflow activity.

Steps: `start` (START) → `load_deal` (AUTOMATED) → `assess` (AUTOMATED — runs the `INVOKE_AGENT` activity with **inline** disposition: auto-approve ≥0.8 **proceeds without parking**, else raises a `USER_TASK` / My caseload and **parks**) → `apply` (AUTOMATED effector, **guarded** on disposition) → `end` (END). **There is no separate `disposition` step** — disposition is configured on the Invoke Agent node (`onResult`) and runs inline (00 §Disposition seam).

```jsonc
{
  "workflowId": "agent_orchestrator_deals_health_check_v1",
  "workflowName": "Deal Health Check (Agent)",
  "version": 1, "enabled": true,
  "metadata": { "category": "Agents", "tags": ["agent","deals"], "icon": "activity" },
  "definition": {
    "steps": [
      { "stepId": "start", "stepType": "START", "stepName": "Start" },
      { "stepId": "load_deal", "stepType": "AUTOMATED", "stepName": "Load Deal" },
      // assess carries the signal config so it can park on the human path only (area 02 compiles the node)
      { "stepId": "assess", "stepType": "AUTOMATED", "stepName": "Assess Deal Health",
        "signalConfig": { "signalName": "agent_orchestrator.proposal.ready" } },
      { "stepId": "apply", "stepType": "AUTOMATED", "stepName": "Apply Approved Action" },
      { "stepId": "end", "stepType": "END", "stepName": "Done" }
    ],
    // No separate "disposition" step — disposition runs INLINE in the INVOKE_AGENT executor (00 §Disposition seam).
    // The effector transition is GUARDED on disposition; a rejected proposal skips it.
    "transitions": [
      { "transitionId": "t_start", "fromStepId": "start", "toStepId": "load_deal", "trigger": "auto" },
      { "transitionId": "t_load", "fromStepId": "load_deal", "toStepId": "assess", "trigger": "auto",
        "activities": [ { "activityId": "load", "activityType": "EXECUTE_FUNCTION",
          "config": { "function": "loadDeal", "parameters": { "dealId": "{{context.deal.id}}" }, "updateContext": true } } ] },

      // assess runs the agent + inline disposition; auto-approve proceeds, ask-a-human parks on proposal.ready.
      // The engine runs the INVOKE_AGENT activity, then evaluates the guard on the resulting disposition (area 02 compile).
      { "transitionId": "t_assess", "fromStepId": "assess", "toStepId": "apply", "trigger": "auto",
        "condition": { "expr": "context.proposal.disposition in ['auto_approved','approved','edited']" },
        "activities": [ {
          "activityId": "invoke_health_check",
          "activityType": "INVOKE_AGENT",
          "config": {
            "agentId": "deals.health_check",
            "input": { "dealId": "{{deal.id}}" },
            "onResult": { "autoApproveThreshold": 0.8 }
          }
        } ] },
      // rejected → skip the effector, go straight to end
      { "transitionId": "t_assess_reject", "fromStepId": "assess", "toStepId": "end", "trigger": "auto",
        "condition": { "expr": "context.proposal.disposition == 'rejected'" } },

      { "transitionId": "t_apply", "fromStepId": "apply", "toStepId": "end", "trigger": "auto",
        "activities": [ { "activityId": "effector", "activityType": "UPDATE_ENTITY",
          "config": { "entity": "customers.deal", "id": "{{deal.id}}",
            "data": { "stage": "{{proposal.actions.set_stage}}" } } } ] }
    ]
  }
}
```

> The `INVOKE_AGENT` activity runs **inline disposition** (area 03): `confidence ≥ autoApproveThreshold` → **auto-approve and proceed without parking**; otherwise raise a `USER_TASK` (My caseload) and **park** on `agent_orchestrator.proposal.ready` `{ processId, stepId, proposalId }` (00 §Disposition seam / §Events) — the human path resumes via that signal. The effector transition is **guarded** on `disposition`; a `rejected` proposal skips it (`t_assess_reject` → `end`). The `apply` effector mutates the deal via the **customers command path** (audited) — the `UPDATE_ENTITY` config resolves to that command, never a raw write. Field names (`set_stage`, `stage`) must match the agent's `result.schema` (area 01) and the customers deal contract.

## Demo runbook (matches 00's global acceptance)

**Step 0 — fresh tenant.** Initialize a tenant with examples enabled (so `seedExamples` runs):
```bash
yarn initialize                 # full init (or onboarding with examples on)
yarn mercato auth sync-role-acls   # grant agent_orchestrator.* to existing roles if the tenant pre-existed
```
Confirm the three persona roles exist (superadmin/admin, operator, engineer); the runbook creates `operator`/`engineer` test users and assigns roles if absent.

**Step 1 — author / verify (dev wow).** `deals.health_check` is in `ai-agents.ts` (~20 lines). `yarn generate` → it appears in the Agents registry. *(global acceptance #1, authoring half.)*

**Step 2 — Playground run.** As `engineer`: open the Playground (area 04), pick `deals.health_check`, input `{ dealId: <at-risk demo deal id> }`, **Run** → a typed **actionable** result with confidence + tools-used trace. *(global acceptance #1.)*

**Step 3 — trigger the workflow.** Start an instance of `agent_orchestrator_deals_health_check_v1` with context `{ deal: { id: <at-risk demo deal id> } }` (via `workflowExecutor.startWorkflow()` / the workflows UI). The monitor shows `assess` **park** at `INVOKE_AGENT`. *(global acceptance #2, park.)*

**Step 4 — park → operator approve.** The at-risk deal's confidence (<0.8) → no auto-approve → a `USER_TASK` / proposal appears in **My caseload** (area 04). As `operator`: open the proposal card, click **Approve** (or **Edit** payload then Approve, or **Reject** → writes reason). *(global acceptance #3.)*

**Step 5 — resume + effector.** Disposition emits `agent_orchestrator.proposal.ready` → the parked instance **resumes** → `apply` runs the effector (sets the deal stage via the audited customers command) → `end`. The monitor shows ✓ across the timeline. *(global acceptance #2 resume + #3 advance.)*

**Auto-approve variant:** trigger the workflow with the **healthy** demo deal id → confidence ≥0.8 → inline disposition auto-approves (`disposition_by = 'rule:threshold'`), **no park, no human step** — the instance proceeds straight to `apply`.

**Cross-tenant check:** a user in another tenant hitting `/api/agent_orchestrator/proposals/:id` for this proposal is denied (org-scoped reads). *(global acceptance #3, cross-tenant denied.)*

**Reset:** re-run `seedExamples` (idempotent — no duplicates) to restore demo deals/workflow; delete the demo instance + proposals to re-run the flow clean. `seedDefaults` re-run is a no-op. To wipe and rebuild, re-init the tenant.

## Phases

1. **P1 — `setup.ts` + `defaultRoleFeatures`.** Mirror `acl.ts`; add the operator/engineer maps; `yarn mercato auth sync-role-acls`. Ship the guard test (no unmapped feature).
2. **P2 — `seedDefaults` + `lib/seeds.ts`.** Disposition config upsert (idempotent, scoped). Reuse the `workflows/lib/seeds.ts` helpers.
3. **P3 — `seedExamples`.** Demo workflow JSON + `seedWorkflowDefinition` upsert; demo deals via customers commands; agent-id resolution check.
4. **P4 — Runbook + smoke.** Fresh-tenant init-with-examples smoke; persona visibility check; the end-to-end run (Playground + workflow park/resume).

## Acceptance

- A **fresh tenant** initialized with examples seeds the disposition config, the demo workflow, and 2 demo deals; re-running init/`seedDefaults`/`seedExamples` seeds **nothing new** (idempotent) and never clobbers tenant overrides.
- Every `agent_orchestrator.*` feature in `acl.ts` is present in `setup.ts` `defaultRoleFeatures`; `yarn mercato auth sync-role-acls` grants them to existing tenants.
- The full demo runs end-to-end: author/verify → Playground actionable result → trigger workflow → park → operator approves in caseload → resume → effector mutates the deal (audited).
- Personas see the right surfaces: operator sees caseload + dispose, engineer sees Playground + builder, neither sees the other's gated action; cross-tenant proposal access denied.
- All seeded rows carry `tenant_id` + `organization_id`; no global/cross-tenant rows; no raw ORM writes into the `customers` module.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Seed not idempotent → duplicate workflow/deals/config on re-init | Med | tenant init | find-by-stable-id in scope, create-if-absent (proven `workflows/lib/seeds.ts` pattern); guard test re-runs `seedExamples` twice | Low |
| Seeded DB agent row shadows code-defined `deals.health_check` | Med | agent registry merge | Do **not** seed the agent; verify-only (same fix as `workflows.ts` code-defined defs) | Low |
| ACL feature added to `acl.ts` but not `defaultRoleFeatures` → persona sees nothing | High | RBAC | guard test asserts no unmapped feature; mirror `acl.ts` exactly | Low |
| Cross-tenant demo data leak | High | tenancy | both `tenant_id`+`organization_id` on every row; org-scoped reads; cross-tenant check in runbook | Low |
| Demo deals written with raw ORM into customers | Med | module coupling | create via customers Command/CRUD path (conventions §3.9) | Low |
| Operator can run Playground or author workflows (over-grant) | Low | RBAC scope | operator map excludes `agents.run`/`workflows.author` | Low |
| Existing tenant misses grants until sync | Low | rollout | runbook + AGENTS rule to run `sync-role-acls` | Low |

## Integration Coverage

- **Seed idempotency** (`agent_orchestrator/__tests__/setup-seed.test.ts`): run `seedDefaults`+`seedExamples` twice on one scope → second run creates 0 rows, updates 0; tenant override of the threshold survives a re-run.
- **Fresh-tenant smoke** (`.ai/qa`): init a tenant with examples → assert disposition config rows, the `agent_orchestrator_deals_health_check_v1` definition, and 2 demo deals exist, all carrying matching `tenant_id`/`organization_id`.
- **Role visibility**: assert operator can `GET /proposals` + `POST /proposals/:id/dispose` but is 403 on `POST /agents/:id/run`; engineer can run the playground + author but is 403 on dispose; cross-tenant `GET /proposals/:id` is denied.
- **ACL completeness guard** (`agent_orchestrator/__tests__/acl-coverage.test.ts`): every feature in `acl.ts` appears under ≥1 role in `setup.ts` `defaultRoleFeatures` (wildcard-aware).
- **End-to-end** (`.ai/qa`): trigger the workflow on the at-risk deal → park → dispose Approve → resume → deal stage updated; trigger on the healthy deal → auto-approve, no USER_TASK.

## Migration & Backward Compatibility

- **Additive only.** This area adds a new module's `setup.ts`, new ACL grants, new example files, and demo rows — it removes/renames nothing. New `acl.ts` features are additive (per `BACKWARD_COMPATIBILITY.md` ACL = ADDITIVE-ONLY).
- **Existing tenants:** receive the new `agent_orchestrator.*` grants only after `yarn mercato auth sync-role-acls`; `seedDefaults` config rows land on next init/onboarding (or via an upgrade action if back-filling existing tenants is desired — out of MVP scope).
- **No DB schema owned here** beyond what areas 01/03 define; demo data uses existing `customers`/`workflows`/`configs` tables. No snapshot change in this area.

## Final Compliance Report

- Conforms to 00 §Shared Contracts: module id `agent_orchestrator`, feature ids unchanged, event `agent_orchestrator.proposal.ready` as the resume signal, `INVOKE_AGENT` config `{ agentId, input, onResult }` exact.
- Reuses shipped precedents: `workflows/lib/seeds.ts` (idempotent JSON upsert), `workflows/examples/*.json` (definition shape), `customers/setup.ts` (feature-toggle/seed idempotency), `packages/core/AGENTS.md` Module Setup Convention (`defaultRoleFeatures`/`onTenantCreated`/`seedDefaults`/`seedExamples`).
- No raw `fetch`, no cross-module ORM relations, no global rows, no hardcoded user-facing strings introduced by seeds; demo writes go through audited commands. ACL grant sync documented.
- Validation: `yarn generate` · `yarn typecheck` · `yarn lint` · `yarn test` (seed/ACL guard tests) · `.ai/qa` fresh-tenant smoke.

## Changelog

- **2026-06-20:** Created area 05 (Seed & Demo) MVP spec — `defaultRoleFeatures` (superadmin/admin + operator + engineer/dev), idempotent `seedDefaults` threshold disposition config, gated `seedExamples` (code-defined demo agent verify, demo `INVOKE_AGENT` workflow JSON, demo deals via customers commands), and the end-to-end demo runbook matching 00's global acceptance. Deferred GAP-18's guardrail-set/capability/dispatch inventory to overlays.
