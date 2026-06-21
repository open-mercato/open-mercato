# Agent MVP — Implementation Specs (Index & Shared Contracts)

> **Status:** Ready to implement · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-20
> **Module:** `agent_orchestrator` (new core module, `packages/core/src/modules/agent_orchestrator/`)
> **How to use:** each area below is a self-contained, implementation-ready spec. Point at one and say *"let's implement this"*. This index is the **shared contract freeze** — every area spec conforms to the §Shared Contracts here; if an area spec disagrees with this file, this file wins.

## Why this set exists

Distilled from the simplification audit + hackathon sketch (callable Agent SDK + first-class `INVOKE_AGENT` workflow step + OM-DS cockpit). Heavy concerns (dispatch/A2A, identity-OAuth, eval/metrics, lifecycle, compliance, governed context plane, deep trace inspector) are **deferred overlays** — see the parent folder's `2026-06-*` specs. This `mvp/` folder is only what ships for the hackathon cut.

## Implementation areas

| # | Area | File | Lives in | Depends on |
|---|------|------|----------|-----------|
| 01 | **Agent SDK core** — `defineAgent` · `agentRuntime.run` · `AgentResult` · entities | [`01-agent-sdk-core.md`](01-agent-sdk-core.md) | `agent_orchestrator` (+ `ai_assistant`) | ai_assistant |
| 02 | **Workflows `INVOKE_AGENT` activity** — the core `workflows` change + editor node | [`02-workflows-invoke-agent-activity.md`](02-workflows-invoke-agent-activity.md) | `workflows` (core change) | 01 |
| 03 | **Disposition & proposals** — dispose Command/API · threshold · USER_TASK · resume | [`03-disposition-and-proposals.md`](03-disposition-and-proposals.md) | `agent_orchestrator` | 01, 02 |
| 04 | **Cockpit UI** — caseload · proposal card · timeline · I/O drawer · playground · builder node UI | [`04-cockpit-ui.md`](04-cockpit-ui.md) | `agent_orchestrator/backend` (+ `ui`) | 01, 02, 03 |
| 05 | **Seed & demo** — ACL grants · demo agent · demo workflow · demo data | [`05-seed-and-demo.md`](05-seed-and-demo.md) | `agent_orchestrator/setup.ts` | 01–04 |

**Build order:** 01 → (02 ∥ 03) → 04 → 05. 01 unblocks everything; 02 and 03 can proceed in parallel once 01's contracts exist; 04 needs the read/dispose APIs; 05 ties it together for the demo.

## Shared Contracts (FROZEN — every area conforms)

### Module & conventions
- Core module **`agent_orchestrator`** at `packages/core/src/modules/agent_orchestrator/` (NOT a separate package). Module id `agent_orchestrator`.
- MikroORM **v7**: decorators from `@mikro-orm/decorators/legacy`, `OptionalProps` from `@mikro-orm/core`; explicit `@Property({ name:'snake_case', type })`; camelCase TS props; UUID PK `@PrimaryKey({ type:'uuid', defaultRaw:'gen_random_uuid()' })`.
- **Every row carries BOTH `tenant_id` AND `organization_id`**; all queries filter by `organizationId`. No cross-module ORM relations — **FK ids only**.
- Zod schemas in `data/validators.ts` (NOT a `contracts/` folder); shared types re-exported from `index.ts`.
- Reads via `makeCrudRoute` + `indexer:{ entityType:'agent_orchestrator:<entity>' }` + `export const openApi`. Custom writes via the **Command pattern** + mutation-guard (`validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess`) + optimistic lock (`enforceCommandOptimisticLock` + `surfaceRecordConflict`).
- ACL features in `acl.ts` mirrored into `setup.ts` `defaultRoleFeatures` (+ `yarn mercato auth sync-role-acls`).
- Events via `createModuleEvents({ moduleId:'agent_orchestrator', events:[...] as const })`, ids `module.entity.action` (singular, past tense).
- UI: `apiCall*` (never raw `fetch`), `useGuardedMutation` for non-`CrudForm` writes, `useT()`/`resolveTranslations()` i18n, DS status tokens (no hardcoded colors), `Cmd/Ctrl+Enter` submit.

### `AgentResult` (the return contract — area 01 owns the Zod)
```typescript
type AgentResult<T = unknown> =
  | { kind: 'informative'; data: T }
  | { kind: 'actionable'; proposal: { actions: ProposedAction[]; confidence?: number; rationale?: string } }
// ProposedAction = { type: string; payload: Record<string, unknown> }  // typed per agent via the result schema
```

### `defineAgent` (authoring — area 01)
```typescript
defineAgent({
  id,                 // 'module.agent' — stable contract id
  instructions,       // system prompt
  skills?,            // SKILL.md pack ids (MVP: instructions-append; full progressive disclosure deferred)
  tools?,             // defineAiTool names, READ-ONLY (propose-only is structural)
  model?,             // AiModelFactory resolution
  loop?,              // ai_assistant loop controls (maxSteps/stopWhen/budget)
  result: { kind: 'actionable' | 'informative'; schema },  // Zod → AiAgentDefinition.output.schema
})
```
Emits an `ai_assistant` `AiAgentDefinition` with `executionMode:'object'`, discovered via the existing `ai-agents.ts` generator. A small registry captures `{ id, resultKind, schema }`.

### `agentRuntime` (runtime — area 01; DI key `agentRuntime`)
`agentRuntime.run(agentId, input, ctx) => Promise<AgentResult>` — wraps `runAiAgentObject` object-mode under `AiModelFactory`; `ctx = { tenantId, organizationId, userId, processId?, stepId? }` — the optional `processId`/`stepId` are set for **workflow-originated** runs so the persisted `AgentProposal` is stamped with them (null for playground runs); agent-principal attribution is an overlay, not MVP. Persists an `AgentRun` (and, for `actionable`, an `AgentProposal`) via Commands. Propose-only: object-mode passes no tools to the model.

### Entities (area 01 owns; 03 reads/writes proposals)
- **`AgentRun`** → table `agent_runs`: `id`, `tenant_id`, `organization_id`, `agent_id`, `status` (`'running'|'ok'|'error'`), `input` (jsonb), `output` (jsonb, nullable), `result_kind` (`'informative'|'actionable'`, nullable), `error_message` (text, nullable), `created_at`, `updated_at`. **No token/cost/eval/span columns in MVP.**
- **`AgentProposal`** → table `agent_proposals`: `id`, `tenant_id`, `organization_id`, `agent_id`, `run_id` (FK id → agent_runs), `process_id` (FK id → workflow instance, nullable), `step_id` (varchar, nullable), `payload` (jsonb), `confidence` (float, nullable), `disposition` (`'pending'|'auto_approved'|'approved'|'edited'|'rejected'`, default `'pending'`), `disposition_by` (varchar, nullable — userId | `rule:<id>`), `disposition_reason` (text, nullable), `created_at`, `updated_at` (**optimistic lock**).

### API surface (base `/api/agent_orchestrator/`)
- `GET /agents`, `GET /agents/:id` — registry reads (`makeCrudRoute`/custom + `openApi`).
- `GET /runs`, `GET /runs/:id` — run + result reads.
- `GET /proposals`, `GET /proposals/:id` — proposal reads.
- `POST /agents/:id/run` `{ input }` → `AgentResult` — ad-hoc run (playground); custom route + mutation-guard. (Area 01.)
- `POST /proposals/:id/dispose` `{ disposition, payload?, reason? }` — Command + mutation-guard + optimistic lock. (Area 03.)

### Events (`events.ts`)
`agent_orchestrator.run.created` · `agent_orchestrator.run.completed` · `agent_orchestrator.proposal.created` · `agent_orchestrator.proposal.ready` (the **workflow resume signal**, payload `{ processId, stepId, proposalId }`) · `agent_orchestrator.proposal.disposed`.

### ACL features (`acl.ts` + `setup.ts`)
`agent_orchestrator.agents.view` · `agent_orchestrator.agents.run` · `agent_orchestrator.proposals.view` · `agent_orchestrator.proposals.dispose` · `agent_orchestrator.workflows.author`.

### Workflow activity (area 02)
New core `workflows` activity **`INVOKE_AGENT`**, config `{ agentId, input (context expression, e.g. {{deal.id}}), onResult: { autoApproveThreshold: number } | { alwaysAsk: true } }`. Parks the instance (like `WAIT_FOR_SIGNAL`) **only on the human path**; resumes on `agent_orchestrator.proposal.ready`.

### Disposition seam & park model (RESOLVED — canonical; areas 02/03/05 conform)
The `INVOKE_AGENT` executor (area 02) calls `agentRuntime.run`, then **calls `dispositionService.dispose(proposal, onResult, ctx)` INLINE** (area 03) — both resolved via optional-peer `tryResolve`. There is **no** event-subscriber seam (it would lose the activity's transaction scope and race `WAIT_FOR_SIGNAL`). Disposition is configured **on the Invoke Agent node** (`onResult`) — never a separate node the author must add. Outcomes:
- **informative** → no proposal; the step proceeds.
- **actionable + auto-approved** (confidence ≥ threshold) → `dispositionService` disposes via the audited dispose Command and returns `auto_approved`; the step **does NOT park** — it proceeds to the next step. **No `proposal.ready` is emitted on this path** (this is what avoids the park-before-signal race).
- **actionable + ask-a-human** (below threshold / `alwaysAsk` / `null` confidence → fail-closed) → raise a `USER_TASK`; the step **parks** on `agent_orchestrator.proposal.ready`. The operator's dispose endpoint emits `proposal.ready` → `sendSignal` → resume.

`agent_orchestrator.proposal.ready` is the **human-path resume signal only**. The downstream **effector step is guarded by a transition condition** on `disposition ∈ {auto_approved, approved, edited}` — a `rejected` proposal resumes (or proceeds) but skips the effector. **There is no separate "disposition" workflow step.**

## Global acceptance (the demo must pass)
1. A developer authors `deals.health_check` via `defineAgent`, runs it in the **Playground**, and gets a typed **actionable** result with a tools-used trace.
2. A workflow with an **`INVOKE_AGENT`** step (added via the one-node builder UI) runs the agent, **parks**, and on disposition **resumes** and runs an effector — all tenant-scoped and audited.
3. An operator sees the proposal in **My caseload**, clicks **Approve** (or Edit/Reject → writes reason), and the workflow advances; cross-tenant access is denied.

## Validation (run the smallest relevant set per area)
`yarn generate` · `yarn db:generate` (review SQL + snapshot) · `yarn typecheck` · `yarn lint` · `yarn test` · area integration tests (`.ai/qa`).

## Out of scope for the MVP (deferred overlays → parent folder)
dispatch/A2A & external runtimes · identity OAuth-CC server (+ agent-principal attribution) · guardrails beyond output-schema validation · eval harness + metrics + cost/token · lifecycle (shadow/canary/autonomy) · compliance/AI-Act/DSAR/fairness · governed TDCR context plane + doc-ingest · deep trace inspector + audit views. Each has a spec in `../` to grow into.

## Changelog
- **2026-06-20:** Created the MVP implementation-spec set (index + shared-contract freeze). Area specs 01–05 authored alongside.
