> 🗂️ **Reorg 2026-06-22 · Status: IMPLEMENTED (as-built design record).** The design here has shipped; it is superseded as a *plan* by the baseline doc and kept for provenance. Authoritative current docs: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` and `packages/enterprise/src/modules/agent_orchestrator/`.

# 01 · Agent SDK Core

> **Status:** Ready to implement · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-20
> **Module:** `agent_orchestrator` (new core module) · **Depends:** `ai_assistant`
> **Area of:** [`mvp/00-overview.md`](00-overview.md) — the shared-contract freeze. Where this file disagrees with the freeze, the freeze wins; where it conflicts with the [conventions doc](../2026-06-19-agent-orchestrator-conventions.md), conventions win.

## TLDR

Area 01 is the callable primitive every other area builds on. A developer authors an agent in `ai-agents.ts` via `defineAgent` (instructions + read-only tools + a typed `result` schema); the generator already discovers `ai-agents.ts`, and a tiny in-module registry captures `{ id, resultKind, schema }`. The `agentRuntime` DI service runs it with `runAiAgentObject` object-mode (structurally propose-only — object mode passes **no tools** to the model), validates the model output against the `result.schema`, persists a thin `AgentRun` (and, for `actionable` results, an `AgentProposal`) through the Command path, and returns a typed `AgentResult` union (`informative{data}` | `actionable{proposal}`). HTTP surfaces are read-only (`GET /agents`, `/runs`, `/runs/:id`) plus one custom write — `POST /agents/:id/run` — the playground entry point, mutation-guarded. An optional `executeProposal` helper runs a proposal's actions through OM Commands, audited.

## Scope

**In scope (area 01):**
- The `agent_orchestrator` module skeleton (`index.ts`, `acl.ts`, `di.ts`, `events.ts`).
- `defineAgent` authoring helper + the typed in-module agent registry (`{ id, resultKind, schema }`).
- The `agentRuntime` service (DI key `agentRuntime`) over `runAiAgentObject`.
- The `AgentResult` union + its Zod in `data/validators.ts`.
- `AgentRun` + `AgentProposal` entities, migration, and snapshot.
- Commands that persist runs/proposals (so audit/events/index fire).
- The optional `executeProposal(proposal, ctx)` helper.
- Read APIs (`/agents`, `/runs`, `/runs/:id`) + the playground run API (`POST /agents/:id/run`).
- ACL features `agent_orchestrator.agents.view` / `.agents.run`, seeded in `setup.ts`.

**Out of scope (other areas / deferred):**
- `INVOKE_AGENT` workflow activity + builder node → **area 02**.
- Proposal disposition (`/proposals/:id/dispose`, thresholds, `USER_TASK`, resume) → **area 03**. Area 01 ships the `AgentProposal` table and its read routes; 03 owns the dispose write and the `proposals.view`/`proposals.dispose` ACL.
- Cockpit UI → **area 04**. Seed/demo agent → **area 05**.
- Capability registry (`capabilities.ts`), dispatch/A2A, identity-OAuth, guardrails beyond schema validation, eval/metrics, token/cost columns → deferred overlays (parent-folder specs).

## Files to create / modify

```
packages/enterprise/src/modules/agent_orchestrator/
├── index.ts                         # NEW  ModuleInfo metadata + public re-exports (AgentResult types, defineAgent, registry)
├── acl.ts                           # NEW  features: agent_orchestrator.agents.view / .agents.run
├── di.ts                            # NEW  register AgentRuntimeService as `agentRuntime` + entity asValue bindings
├── events.ts                        # NEW  createModuleEvents — run.created/.completed, proposal.created
├── setup.ts                         # NEW  defaultRoleFeatures for the two ACL features
├── data/
│   ├── entities.ts                  # NEW  AgentRun + AgentProposal (MikroORM v7 /legacy)
│   └── validators.ts                # NEW  Zod: AgentResult union, ProposedAction, run/agent query schemas, per-agent result schemas
├── lib/
│   ├── sdk/
│   │   └── defineAgent.ts           # NEW  defineAgent() + AgentDefinition type + registry (registerAgent/getAgent/listAgents)
│   └── runtime/
│       ├── agentRuntime.ts          # NEW  AgentRuntimeService.run(agentId, input, ctx) over runAiAgentObject
│       └── executeProposal.ts       # NEW  optional helper: run proposal.actions through OM Commands (audited)
├── commands/
│   ├── index.ts                     # NEW  import side-effect registering the commands
│   ├── runs.ts                      # NEW  createAgentRun / completeAgentRun / failAgentRun commands
│   └── proposals.ts                 # NEW  createAgentProposal command (dispose lives in area 03)
├── api/
│   ├── openapi.ts                   # NEW  createAgentOrchestratorCrudOpenApi factory (mirrors customers/api/openapi.ts)
│   ├── agents/route.ts              # NEW  GET /api/agent_orchestrator/agents (registry list, custom + openApi)
│   ├── agents/[id]/run/route.ts     # NEW  POST /api/agent_orchestrator/agents/:id/run → AgentResult (playground)
│   └── runs/route.ts                # NEW  GET /api/agent_orchestrator/runs (+ ?id= detail) via makeCrudRoute
└── migrations/
    ├── Migration20260620090000_agent_orchestrator.ts   # NEW  create agent_runs + agent_proposals
    └── .snapshot-open-mercato.json                       # NEW  post-change snapshot

packages/enterprise/src/modules/agent_orchestrator/ai-agents.ts   # NEW (authoring surface)
    # where module authors call defineAgent(...) — see "The SDK". The ai_assistant generator
    # already discovers ai-agents.ts; defineAgent emits a standard AiAgentDefinition (object mode)
    # AND registers {id,resultKind,schema} in the area-01 registry.
```

**ai_assistant touchpoints:** none required. Area 01 consumes the existing public API (`runAiAgentObject`, `defineAiAgent`, `AiAgentDefinition`, `AiChatRequestContext`, `createModelFactory`) and the existing `ai-agents.ts` auto-discovery. No edit to `packages/ai-assistant/` is needed.

## Data Models

Both entities are MikroORM **v7** with `/legacy` decorators, explicit `@Property`, dual `tenant_id` + `organization_id`, FK ids only (no cross-module ORM relations), `agent_` table prefix. `AgentRun` is append-mostly (status transitions only). `AgentProposal` is user-editable (disposed in area 03) so it carries `updated_at` for optimistic locking + `deleted_at` for soft delete. **NO token/cost/eval/span columns in MVP.** Exact shapes per the freeze §Entities.

```typescript
// data/entities.ts
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type AgentRunStatus = 'running' | 'ok' | 'error'

@Entity({ tableName: 'agent_runs' })
@Index({ name: 'agent_runs_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_runs_agent_idx', properties: ['organizationId', 'agentId'] })
export class AgentRun {
  [OptionalProps]?: 'status' | 'output' | 'resultKind' | 'errorMessage' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'agent_id', type: 'varchar', length: 100 })
  agentId!: string // defineAgent id; NOT an ORM relation

  @Property({ name: 'status', type: 'varchar', length: 20, default: 'running' })
  status: AgentRunStatus = 'running'

  @Property({ name: 'input', type: 'jsonb' })
  input!: any // run input payload; shape is agent-specific

  @Property({ name: 'output', type: 'jsonb', nullable: true })
  output?: any | null // validated AgentResult; shape enforced by result.schema Zod

  @Property({ name: 'result_kind', type: 'varchar', length: 20, nullable: true })
  resultKind?: 'informative' | 'actionable' | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

export type AgentProposalDisposition =
  | 'pending' | 'auto_approved' | 'approved' | 'edited' | 'rejected'

@Entity({ tableName: 'agent_proposals' })
@Index({ name: 'agent_proposals_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_proposals_run_idx', properties: ['organizationId', 'runId'] })
export class AgentProposal {
  [OptionalProps]?: 'disposition' | 'dispositionBy' | 'dispositionReason'
    | 'processId' | 'stepId' | 'confidence' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'agent_id', type: 'varchar', length: 100 })
  agentId!: string

  @Property({ name: 'run_id', type: 'uuid' })
  runId!: string // FK id → agent_runs

  @Property({ name: 'process_id', type: 'uuid', nullable: true })
  processId?: string | null // FK id → workflows instance (area 02); null for playground runs

  @Property({ name: 'step_id', type: 'varchar', length: 100, nullable: true })
  stepId?: string | null

  @Property({ name: 'payload', type: 'jsonb' })
  payload!: any // { actions, confidence?, rationale? }; shape enforced by result.schema Zod

  @Property({ name: 'confidence', type: 'float', nullable: true })
  confidence?: number | null

  @Property({ name: 'disposition', type: 'varchar', length: 20, default: 'pending' })
  disposition: AgentProposalDisposition = 'pending'

  @Property({ name: 'disposition_by', type: 'varchar', length: 100, nullable: true })
  dispositionBy?: string | null // userId | 'rule:<id>'

  @Property({ name: 'disposition_reason', type: 'text', nullable: true })
  dispositionReason?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date() // optimistic-lock source for dispose (area 03)

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

## The SDK — `defineAgent`

`defineAgent` (in `lib/sdk/defineAgent.ts`) is a thin wrapper that (a) emits a standard `ai_assistant` `AiAgentDefinition` in object mode and (b) registers the result contract in an in-module registry. Authoring happens in the module's root `ai-agents.ts` — the file the `ai_assistant` generator already discovers — so no new auto-discovery surface is introduced.

```typescript
// lib/sdk/defineAgent.ts
import { defineAiAgent } from '@open-mercato/ai-assistant'
import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import type { ZodTypeAny } from 'zod'

export type AgentResultKind = 'actionable' | 'informative'

export interface DefineAgentInput {
  id: string                    // 'module.agent' — STABLE contract id (BACKWARD_COMPATIBILITY.md)
  moduleId: string
  label: string
  description: string
  instructions: string          // → AiAgentDefinition.systemPrompt
  tools?: string[]              // defineAiTool ids, READ-ONLY (propose-only is structural; see Runtime)
  skills?: string[]             // SKILL.md pack ids — MVP appends to instructions; progressive disclosure deferred
  defaultProvider?: string
  defaultModel?: string
  loop?: { maxSteps?: number }  // object-safe subset only
  result: { kind: AgentResultKind; schema: ZodTypeAny } // Zod from data/validators.ts; IS output.schema
}

export interface AgentRegistryEntry {
  id: string
  resultKind: AgentResultKind
  schema: ZodTypeAny
}

const registry = new Map<string, AgentRegistryEntry>()

export function defineAgent(input: DefineAgentInput): AiAgentDefinition {
  if (registry.has(input.id)) {
    throw new Error(`[internal] duplicate agent id "${input.id}"`)
  }
  registry.set(input.id, { id: input.id, resultKind: input.result.kind, schema: input.result.schema })
  const systemPrompt = input.skills?.length
    ? `${input.instructions}\n\n${input.skills.map((s) => `[skill:${s}]`).join('\n')}`
    : input.instructions
  return defineAiAgent({
    id: input.id,
    moduleId: input.moduleId,
    label: input.label,
    description: input.description,
    systemPrompt,
    allowedTools: input.tools ?? [],     // READ-only; object mode never passes them to the model
    executionMode: 'object',
    readOnly: true,
    mutationPolicy: 'read-only',
    defaultProvider: input.defaultProvider,
    defaultModel: input.defaultModel,
    loop: input.loop,
    output: { schemaName: input.id.replace(/\W+/g, '_'), schema: input.result.schema },
  })
}

export function getAgentEntry(id: string): AgentRegistryEntry | undefined { return registry.get(id) }
export function listAgentEntries(): AgentRegistryEntry[] { return [...registry.values()] }
```

```typescript
// ai-agents.ts (authoring; example skeleton — real demo agent ships in area 05)
import { defineAgent } from './lib/sdk/defineAgent'
import { dealHealthCheckResult } from './data/validators'

export const aiAgents = [
  defineAgent({
    id: 'deals.health_check',
    moduleId: 'agent_orchestrator',
    label: 'Deal health check',
    description: 'Assess a deal’s health and propose a next action.',
    instructions: 'Assess the deal’s health and propose the single best next action.',
    tools: [],                                   // READ-only allowlist when populated
    result: { kind: 'actionable', schema: dealHealthCheckResult },
  }),
]
export default aiAgents
```

- `result.schema` lives once in `data/validators.ts`, is re-exported from `index.ts`, and **is** the `AiAgentDefinition.output.schema` — single source, no drift (a runtime assertion in the registry compares them by identity).
- Agent ids are STABLE contracts: a published id is frozen; an incompatible result-schema change ships under a new id (`BACKWARD_COMPATIBILITY.md`).

## The Runtime — `agentRuntime`

`AgentRuntimeService` (DI key `agentRuntime`, in `lib/runtime/agentRuntime.ts`) exposes `run(agentId, input, ctx) => Promise<AgentResult>`.

```typescript
type AgentRunCtx = {
  tenantId: string; organizationId: string; userId: string
  processId?: string; stepId?: string   // set for workflow-originated runs (area 02) → stamped onto the AgentProposal; null for the playground
}
```

Steps:
1. **Resolve.** `getAgentEntry(agentId)` → `{ resultKind, schema }`. Throw a typed not-found error (surfaced as 404) when missing.
2. **Create the run.** Persist an `AgentRun { status:'running', input }` via `createAgentRunCommand` (Command path → audit/events/index). Capture `runId`.
3. **Build the `AiChatRequestContext`.** `{ tenantId: ctx.tenantId, organizationId: ctx.organizationId, userId: ctx.userId, features: [], isSuperAdmin: false }` — the runtime runs scoped to the caller. (Agent-principal attribution is a deferred overlay; the run row records the caller `userId` via the command actor.)
4. **Run.** `runAiAgentObject({ agentId, input: <prompt string|UIMessage[]>, authContext, container, output: { schemaName, schema }, loop })`. Object mode passes **no tools** to `generateObject` (verified: `agent-runtime.ts` does `void tools`) — a single typed structured-output call; the model cannot mutate. Model resolution is the existing `createModelFactory` chain (provider/model/tenant precedence) — no new model logic.
5. **Validate.** Re-validate `result.object` against `schema` with `safeParse`. On failure: `failAgentRunCommand(runId, errorMessage)` (status `error`), emit `run.completed` with the error, and throw a typed error → never return a malformed result.
6. **Shape the `AgentResult`.** For `informative`: `{ kind:'informative', data }`. For `actionable`: `{ kind:'actionable', proposal: { actions, confidence?, rationale? } }`.
7. **Complete + persist proposal.** `completeAgentRunCommand(runId, { status:'ok', output: result, resultKind })`. If `actionable`, `createAgentProposalCommand({ runId, agentId, payload: result.proposal, confidence, processId: ctx.processId ?? null, stepId: ctx.stepId ?? null })` (so the proposal exists for area 03 to dispose, **stamped with `process_id`/`step_id` for workflow-originated runs** — null for the playground), emitting `proposal.created`.
8. **Return** the typed `AgentResult`.

The runtime is **in-process** — the only network ingress is the playground route (below), which calls this service. Propose-only is structural: the agent holds no mutating tool, and its only writes are `AgentRun`/`AgentProposal` through the audited Command path.

### `executeProposal` helper (optional, `lib/runtime/executeProposal.ts`)

`executeProposal(proposal, ctx)` iterates `proposal.actions` (`{ type, payload }`) and dispatches each through an OM Command resolved by a small `type → commandId` map the caller supplies (or a default registry). It runs each action via the standard command runner so audit/events/index fire, and returns a per-action result list. Callers that gate proposals (area 03) call this only *after* disposition; the playground does not auto-execute. This helper is optional in the MVP — disposition (area 03) may instead run effectors as workflow activities.

## API Contracts (base `/api/agent_orchestrator/`)

- **`GET /agents`** — `api/agents/route.ts`, a custom handler (registry is in-memory, not an entity) returning `listAgentEntries()` mapped to `{ id, resultKind, tools, skills, label, description }`. `metadata.GET = { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.view'] }`. `export const openApi` describes the list shape.
- **`GET /runs`** (+ `?id=<uuid>` for detail) — `api/runs/route.ts` via `makeCrudRoute` over `AgentRun`, `indexer: { entityType: 'agent_orchestrator:agent_run' }`, org/tenant-scoped, returns `updatedAt`. `requireFeatures: ['agent_orchestrator.agents.view']`. `export const openApi` via the module openapi factory. (Detail is served by the same route with the `id` query filter — the freeze's `GET /runs/:id` is satisfied by `?id=` per the customers reference; add a `runs/[id]/route.ts` shim only if a path-style URL is required.)
- **`POST /agents/:id/run`** — `api/agents/[id]/run/route.ts`, custom write (the playground entry). Body `{ input: unknown }`. Flow:
  - `metadata.POST = { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.run'] }`.
  - `validateCrudMutationGuard(...)` before; resolve `ctx` (tenant/org/user) from the authenticated request.
  - call `container.resolve('agentRuntime').run(id, body.input, ctx)`.
  - `runCrudMutationGuardAfterSuccess(...)` after success; return the `AgentResult` JSON (200). 404 when the agent id is unknown; 422 when the model output fails schema validation.
  - `export const openApi` documenting the body + `AgentResult` response.

No public endpoint for the runtime itself beyond this route. `GET /proposals` and `POST /proposals/:id/dispose` are **area 03**.

## DI & registration

- `di.ts` registers `agentRuntime` (the `AgentRuntimeService`, resolving `em`, `commandBus`/command runner, and container for `runAiAgentObject`) via `asClass`/`asFunction`, plus `asValue` bindings for `AgentRun` / `AgentProposal` entity classes.
- `commands/index.ts` is imported for side-effects from `index.ts` so the run/proposal commands register at module load (mirrors `customers/index.ts` `import './commands'`).
- The agent registry self-populates when `ai-agents.ts` is evaluated by the generator-aggregated registry; `agentRuntime` reads it via `getAgentEntry`.

## ACL & setup defaults

```typescript
// acl.ts
export const features = [
  { id: 'agent_orchestrator.agents.view', title: 'View agents and runs', module: 'agent_orchestrator' },
  { id: 'agent_orchestrator.agents.run',  title: 'Run agents (playground)', module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.agents.view'] },
]
```

```typescript
// setup.ts
export const setup = {
  defaultRoleFeatures: {
    admin: ['agent_orchestrator.*'],
    employee: ['agent_orchestrator.agents.view', 'agent_orchestrator.agents.run'],
  },
}
export default setup
```

Run `yarn mercato auth sync-role-acls` after adding the features so existing tenants receive grants. (`proposals.view` / `proposals.dispose` / `workflows.author` are declared by areas 03/02.)

## Events (`events.ts`)

`createModuleEvents({ moduleId: 'agent_orchestrator', events: [...] as const })`, ids `module.entity.action` (singular, past tense):
- `agent_orchestrator.run.created` — emitted when a run starts.
- `agent_orchestrator.run.completed` — emitted on `ok` or `error` (payload carries `status`).
- `agent_orchestrator.proposal.created` — emitted when an actionable run persists a proposal.

(`proposal.ready` and `proposal.disposed` are declared in areas 02/03 — area 01 declares only the three above to avoid double-declaring across area files; the freeze lists the full set.)

## Phases

1. **Module skeleton + entities + migration.** `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `di.ts`; `data/entities.ts` (both entities); `data/validators.ts` (AgentResult/ProposedAction Zod + sample result schema); migration + snapshot. `yarn generate && yarn db:generate` (review SQL + snapshot).
2. **SDK + runtime.** `lib/sdk/defineAgent.ts` + registry; `lib/runtime/agentRuntime.ts` over `runAiAgentObject`; `commands/runs.ts` + `commands/proposals.ts`; wire `agentRuntime` into `di.ts`. A throwaway `ai-agents.ts` agent to smoke-test.
3. **APIs + executeProposal.** `api/openapi.ts`; `api/agents/route.ts`; `api/runs/route.ts`; `api/agents/[id]/run/route.ts` (mutation-guarded); optional `lib/runtime/executeProposal.ts`. Integration tests.

## Acceptance

- An agent declared once via `defineAgent` in `ai-agents.ts` is invocable through `agentRuntime.run` with no second declaration of its id or result schema.
- `agentRuntime.run('deals.health_check', input, ctx)` runs an object-mode LLM under the caller ctx, validates output against `result.schema`, persists a thin `AgentRun`, and returns the typed `AgentResult` union.
- An `actionable` result persists an `AgentProposal`; the agent holds NO mutating tool — its only writes are `AgentRun`/`AgentProposal` via the audited Command path.
- An invalid model output is recorded as a `status:'error'` run and surfaced as a 422; never a malformed result.
- `GET /agents` and `GET /runs` enforce `agent_orchestrator.agents.view` and are tenant-scoped.
- `POST /agents/:id/run` enforces `agent_orchestrator.agents.run`, is mutation-guarded, and returns an `AgentResult`; cross-tenant run reads are denied.

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Future change passes mutating tools to object-mode, breaking structural propose-only | High | security | `executionMode:'object'` + `readOnly:true` + `mutationPolicy:'read-only'`; object mode `void tools`; release-gate test asserts no `isMutation:true` tool reachable | Low |
| `result.schema` drifts from `output.schema` | Medium | correctness | Single Zod source in `data/validators.ts`; registry asserts `entry.schema === agent.output.schema` by identity | Low |
| Cross-tenant run/proposal read | High | tenancy | Dual `tenant_id`+`organization_id`; org-scoped `makeCrudRoute` + custom handler scoping; cross-tenant denial test | Low |
| Playground run abused to spend tokens | Medium | cost/abuse | Gated by `agent_orchestrator.agents.run`; per-call `loop.maxSteps`; mutation guard; (rate-limit deferred) | Medium |
| Agent id / result schema treated as ad-hoc, breaking callers | Medium | contract | Ids + result schemas are STABLE; additive evolution only; duplicate-id guard in registry | Low |
| Invalid/empty model output | Medium | correctness | `safeParse` against schema; failure → `error` run + 422, never a malformed `AgentResult` | Low |
| New tables / events / ACL are new contract surfaces | Low | build/contract | All additive — net-new tables, additive events/ACL, additive `ai-agents.ts` registry entries | Low |

## Integration Coverage

Per `.ai/qa/AGENTS.md`; tests self-contained (register a test agent via test config; create fixtures in setup; clean up created `AgentRun`/`AgentProposal` rows in teardown/finally; no reliance on seeded/demo data):

- **Define → run → typed result (E2E):** register a test agent, call `agentRuntime.run` (or `POST /agents/:id/run`) with input, assert a schema-valid `AgentResult` and a persisted `AgentRun`; for an actionable agent, assert a persisted `AgentProposal`.
- **Informative vs actionable:** one informative agent returns `{ kind:'informative', data }` with no proposal row; one actionable agent returns `{ kind:'actionable', proposal }` with a matching `agent_proposals` row.
- **Playground RBAC + tenant isolation (Playwright):** `POST /agents/:id/run` denied without `agent_orchestrator.agents.run`; `GET /runs` denied without `agent_orchestrator.agents.view`; a tenant-A run is invisible to tenant B.
- **Propose-only:** assert the object-mode agent reaches zero `isMutation:true` tools; assert the agent's only writes go through the audited Command path.
- **Invalid output:** stub a schema-violating model output and assert a `status:'error'` run + 422, no `AgentResult` returned.

## Migration & Backward Compatibility

- **Agent ids and result schemas are STABLE contracts** (`BACKWARD_COMPATIBILITY.md`): a published id is frozen; an incompatible result-schema change ships under a new agent id (old retained ≥1 minor per the deprecation protocol).
- **Everything here is additive:** `agent_runs` / `agent_proposals` are net-new tables; the three events, two ACL features, and read/run routes introduce no existing-id changes; `defineAgent` reuses the existing `ai-agents.ts` auto-discovery surface (no new generator contract).
- The `agent_id` column maps forward to a future capability `key@v` (deferred overlay) without breaking stored runs.
- Workflow: update `data/entities.ts` → `yarn generate` → `yarn db:generate` (review SQL + `migrations/.snapshot-open-mercato.json`) → `yarn typecheck && yarn lint && yarn test`. Do not run `yarn db:migrate` to silence the generator.

## Final Compliance Report

- [x] Module at `packages/enterprise/src/modules/agent_orchestrator/`, id `agent_orchestrator`; SDK in `lib/sdk/`, runtime in `lib/runtime/`.
- [x] `defineAgent` authored in `ai-agents.ts` (existing auto-discovery); typed in-module registry captures `{ id, resultKind, schema }`.
- [x] `result.schema` is Zod in `data/validators.ts`, re-exported from `index.ts`, single source equal to `output.schema`.
- [x] Entities are MikroORM v7 `/legacy`, explicit `@Property`, dual `tenant_id`+`organization_id`, soft-delete + `updated_at` on the editable `AgentProposal`; FK ids only; NO token/cost/eval/span columns.
- [x] Runtime is in-process (DI `agentRuntime.run`); reuses `runAiAgentObject` object-mode + `createModelFactory` — no new loop/model engine.
- [x] Propose-only is structural (object mode passes no tools); READ-only allowlist; agent writes go through the audited Command path only.
- [x] Reads via `makeCrudRoute`/custom + `indexer` + `openApi`; the one write (`/agents/:id/run`) wires `validateCrudMutationGuard`/`runCrudMutationGuardAfterSuccess`; no public runtime endpoint.
- [x] Events in `events.ts` (`as const`, `module.entity.action`); ACL in `acl.ts` + `setup.ts` (`agents.view`, `agents.run`) with `sync-role-acls`.
- [x] Integration coverage defined: define→run→typed result, informative vs actionable, playground RBAC + tenant isolation, propose-only, invalid-output 422.
- [x] Heavy overlays (capability registry, dispatch/A2A, identity-OAuth, guardrails beyond schema validation, eval/metrics, cockpit) explicitly deferred; disposition + workflow activity belong to areas 02/03.

## Changelog

- **2026-06-20:** Created. Area-01 build spec: the callable Agent SDK core for `agent_orchestrator` — `defineAgent` (object-mode `AiAgentDefinition` + `{id,resultKind,schema}` registry), the `agentRuntime` service over `runAiAgentObject` (structural propose-only, schema-validated `AgentResult`), `AgentRun` + `AgentProposal` entities/migration, run/proposal Commands, the optional `executeProposal` helper, read APIs (`/agents`, `/runs`) + the mutation-guarded playground run API (`POST /agents/:id/run`), and `agents.view`/`agents.run` ACL. Conforms to the `mvp/00-overview.md` shared-contract freeze.
