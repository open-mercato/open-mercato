# Agent Internal Runtime & Capability Registry

> Status: Draft · Owner: Patryk Lewczuk (Comerito) · Created: 2026-06-20 · Module: agent_orchestrator · subdomains: orchestration + dispatch(internal adapter) · Depends: ai_assistant (runAiAgentObject/AiModelFactory/allowedTools), workflows, business_rules, auth/ACL, query_index, search, the orchestration/dispatch/context/identity/guardrails specs · Consolidates: GAP-01, GAP-02 (+links GAP-03, GAP-16, GAP-10)

## TLDR

Two pillars complete the agent spine. **(1) A code-first Capability Registry** (`capabilities.ts`, auto-discovered like `events.ts`/`acl.ts`) is the single typed vocabulary that binds each `capability` key to its proposal Zod schema, ACL feature, context modules, guardrail set, runtime ref, and a **locked propose-only posture** — resolving DISPATCH open-Q #2 (code declares the *contract*, `AgentBinding` declares *deployment*). **(2) An `InternalAgentRuntimeAdapter`** implements the dispatch `RuntimeAdapter` contract: given an `AgentTask {capability, contextRef}`, it resolves the capability → an object-mode `AiAgentDefinition`, runs `runAiAgentObject` under the agent principal over a pre-fetched `ContextBundle` (no live tools — propose-only is *structural*), validates the output against the capability's `proposalSchema`, persists `AgentRun` + `AgentProposal` via Commands, and signals `agent_orchestrator.proposal.ready`. This is the missing executor for DISPATCH `runtime:'internal'` and the keystone of ORCHESTRATION Phase 1.

## Overview

Every sibling spec stops at the words "agent runs". The orchestration spec wires `workflows` → `DispatchService.enqueue` → `AgentTask` → "agent runs" → `AgentProposal` → resume signal → `business_rules` disposition; the dispatch spec routes/leases/transports the task and defines `runtime:'internal'`; but no spec defines the component that turns a leased internal task into a schema-valid, propose-only `AgentProposal`. Simultaneously, every spec keys off a bare `capability` string with no shared declaration of what a capability *is*, what schema it binds, which ACL/context/guardrail facets gate it, or that its mutation posture is locked.

This spec consolidates GAP-01 (internal-agent runtime) and GAP-02 (capability registry) — they are inseparable: the runtime cannot resolve a capability without the registry, and the registry's `proposalSchema` *is* the runtime's `output.schema`. It links GAP-03 (the `INVOKE_AGENT` workflow seam that enqueues the task) and GAP-16 (the propose-only / no-bypass enforcement the runtime makes structural), and consumes GAP-10's `ContextModule` registry for context assembly. All code lives in the core module `agent_orchestrator` (`packages/core/src/modules/agent_orchestrator/`), under `lib/orchestration/`, per the normative conventions doc.

## Problem Statement

Two holes block the walking skeleton:

1. **No runtime executor.** Nothing, given `AgentTask {capability, contextRef}`, runs an LLM and emits a typed `AgentProposal` row that fires `agent_orchestrator.proposal.ready`. Without it DISPATCH 1→2→**3** (the "original ask", internal end-to-end) cannot complete and ORCHESTRATION Phase 1 acceptance ("runs an internal agent, produces an `AgentProposal`") is unmet — disposition, cockpit, trace, eval, and the entire propose-only claim all hang off this.
2. **No capability vocabulary.** The same `capability` string indexes `AgentProposal.capability`, `AgentTask.requiredCapability`, `AgentContextBundle.capability`, `AgentGuardrailCheck.capability`, the per-capability proposal Zod, the per-capability guardrail set, and routing — but nothing declares it once, types it, versions it, or enforces that a proposal validates against *its* schema. The result is typo-divergent keys, silently-missing guardrail/context sets, no compile-time safety, and no contract-stability story even though capability keys + bound schemas are a STABLE surface under `BACKWARD_COMPATIBILITY.md`.

## Proposed Solution

### Pillar 1 — Capability Registry (the declared contract)

A new auto-discovered module file `capabilities.ts` at the module root, mirroring `events.ts`/`acl.ts`. Each entry binds, in one typed, diffable, frozen place: the namespaced `key`, a `version`, the `proposalSchema` (Zod from `data/validators.ts`), the `aclFeature`, the `contextModules` (GAP-10), the `guardrailSet` (`name@version`), the `runtime` + `runtimeRef`, a `lockedMutationPosture: 'propose_only'` literal no tenant override can widen, and optional `skillPacks` (`SKILL.md`). The generator emits `capabilities.generated.ts` (typed ids + lookup); boot/test gates fail closed on any dangling schema/ACL/guardrail binding or undeclared binding advertisement.

### Pillar 2 — InternalAgentRuntimeAdapter (the executor)

A thin adapter over `ai_assistant`'s `runAiAgentObject` object-mode that implements the dispatch `RuntimeAdapter` contract and registers as `runtime:'internal'`. Given an `AgentTask`, it resolves the capability → an object-mode `AiAgentDefinition`, builds input from the pre-fetched `ContextBundle`, runs the model under the agent principal `authContext`, validates against the capability's `proposalSchema`, GUARD pre/post, persists `AgentRun` + `AgentProposal` via Commands, and emits `agent_orchestrator.proposal.ready {processId, stepId, proposalId}`.

Both pillars deliberately *reuse* OM primitives — `runAiAgentObject` (loop engine + typed output + `AiModelFactory` + tenant overrides + allowlist + loop/budget), `AgentBinding` (deployment), `business_rules` (disposition), `workflows` (control) — and invent nothing new where a primitive exists.

## Architecture

```
capability key (registry)                    AgentTask {capability, contextRef}
        │                                              │  (dispatch: runtime:'internal')
        ▼                                              ▼
 CapabilityDefinition  ──runtimeRef──▶  AiAgentDefinition (executionMode:'object',
   { proposalSchema,                       output.schema = capability.proposalSchema,
     aclFeature, contextModules,           readOnly:true, mutationPolicy:'read-only',
     guardrailSet, runtime,                allowedTools = READ-only )
     lockedMutationPosture:'propose_only' }        │
        │                                          ▼
        │  IDENTITY runAs {actorUserId:agentUserId, onBehalfOfUserId, sourceKey:'agent'}
        │                                          ▼
        └──────────────▶  runAiAgentObject(input = ContextBundle, output.schema)
                                                   │  (NO tools passed → cannot mutate)
                          GUARD pre/post ◀─────────┤
                                                   ▼
                          typed AgentProposal  ── persist via Commands ──▶ AgentRun + AgentProposal
                                                   │
                                                   ▼
                          signal agent_orchestrator.proposal.ready {processId, stepId, proposalId}
                                                   │
                                                   ▼          business_rules disposes (auto-approve | USER_TASK)
```

The adapter **is** the dispatch `internal` transport's runtime. `TaskRouter` resolves an `AgentBinding {transportMode:'internal', runtime:'internal'}` → the internal queue worker calls `InternalAgentRuntimeAdapter.run(task)`. Adding an external runtime later (`a2a`/`provider`) is one more adapter behind the *identical* `AgentTask`→`AgentProposal` contract; nothing in disposition changes. This is the runtime-agnostic seam the runtime-options doc mandates: OM stays the records / disposition / audit plane, and `AgentProposal` (Zod/JSON Schema) is the runtime-agnostic contract.

## Capability Registry

`capabilities.ts` (module root, discovered by `yarn generate`) declares an `as const` array passed to a `createCapabilityRegistry` helper, exactly the `createModuleEvents`/`acl.ts` idiom:

```typescript
export const capabilities = [
  {
    key: 'claims.coverage_check',          // <domain>.<capability>, lower_snake, globally unique
    version: 1,                            // capability@v — published key@v is FROZEN
    proposalSchema: ClaimsCoverageCheckProposalSchema, // Zod in data/validators.ts; IS the agent output.schema
    aclFeature: 'agent_orchestrator.capability.claims_coverage_check', // declared in acl.ts + setup.ts
    contextModules: ['policy_docs', 'claim_record', 'prior_cases'],    // GAP-10 ContextModule keys
    guardrailSet: 'claims.coverage_check@3',                            // GUARD set name@version
    runtime: 'internal',                   // 'internal' | 'a2a' | 'opencode' | provider
    runtimeRef: 'claims.coverage_agent',   // AiAgentDefinition id (internal) | Agent Card | opencode agent
    lockedMutationPosture: 'propose_only', // LOCKED literal — non-tenant-downgradable
    skillPacks: ['claims-coverage.SKILL.md'], // optional, runtime-independent (GAP-runtime-options)
  },
] as const
export const capabilitiesConfig = createCapabilityRegistry({ moduleId: 'agent_orchestrator', capabilities })
export type AgentCapabilityKey = typeof capabilities[number]['key']
```

**Namespacing.** Keys are `<business-domain>.<capability>` (`claims.coverage_check`, `damage.estimate`) — parallel to, but distinct from, event-id `module.entity.action`. Each segment is `lower_snake`, the whole key globally unique and owned by the registry. The `agent_orchestrator.*` capability namespace is reserved for the platform's own internal capabilities.

**Versioning.** `capability@v`. A published `key@v` proposal schema is FROZEN; an incompatible payload change ships as `@v+1`, with `@v` retained for ≥1 minor per the `BACKWARD_COMPATIBILITY.md` deprecation protocol. `AgentProposal` and `AgentTask` persist the resolved `capabilityVersion` alongside the key (additive, nullable→defaulted column on those sibling-owned entities) so a stored proposal always validates against the schema it was produced under, even after `@v+1` ships.

**Contract stability.** `capabilities.ts` *is* the contract surface: typed, reviewable in a PR diff, frozen on publish. The proposal schema lives once in `data/validators.ts` and is re-exported from `index.ts`; a registry assertion guarantees `capability.proposalSchema === agentDefinition.output.schema` (single source — no drift).

**Code-declares-intent vs DB-declares-deployed (resolves DISPATCH open-Q #2).** `capabilities.ts` owns the *declared* contract (stable, global, security-bearing: schema, ACL, posture, version, intended runtimeRef). The dispatch spec's `AgentBinding` (DB row, per-tenant) continues to own *deployed/reachable* facts (which `agentDefinitionId` actually serves it here, transport, health, concurrency, credentials). `TaskRouter` trusts the **registry for *what*** (the vocabulary) and the **binding for *where*** (reachability); a boot check enforces `AgentBinding.capabilities[] ⊆ registry` and `DispatchService.enqueue` rejects an unregistered/unversioned `requiredCapability`. Neither duplicates the other: a binding references a registry key, never re-declares its schema.

## Internal Agent Runtime

`InternalAgentRuntimeService` (DI key, `lib/orchestration/`) implements the dispatch `RuntimeAdapter` contract — `run({ task }): Promise<{ runId, proposalId }>` — for `runtime:'internal'`. Steps, all in OM primitives:

1. **Resolve capability → `AiAgentDefinition`.** Look up `task.requiredCapability` (+ `capabilityVersion`) in the registry → `runtimeRef` → the object-mode `AiAgentDefinition` (`executionMode:'object'`, `output.schema = capability.proposalSchema`, `readOnly:true`, `mutationPolicy:'read-only'`, READ-only `allowedTools`).
2. **Build input from the ContextBundle.** Read the pre-fetched, redacted `AgentContextBundle` at `task.contextRef` (GAP-10 hybrid assembly: mandatory floor + ranked optional fill, org-scoped) and pack it into the agent `input`/`pageContext`. The runtime reasons over **pre-fetched** context, **not live tools** — propose-only is structural (see below). An interactive read-only tool loop is an explicit follow-on, not a skeleton blocker (Phase 4, "a2").
3. **Set the agent principal `authContext`.** IDENTITY `runAs {tenantId, organizationId, actorUserId: agentUserId, onBehalfOfUserId, sourceKey:'agent'}`; all reads stay org-scoped.
4. **GUARD pre.** Input / tool-scope screen (GUARD spec), keyed on `capability.guardrailSet`.
5. **Run.** `runAiAgentObject({ executionMode:'object', output:{ schema } })` — `AiModelFactory` resolves provider/model with tenant precedence; loop/budget/allowlist overrides apply. Today object-mode passes **no tools** to `generateObject`/`streamObject` (verified: `agent-runtime.ts` `void tools`) — a single typed structured-output call.
6. **GUARD post.** Validate output against `proposalSchema` + grounding/guardrail post-check. A stale/invalid output is rejected and recorded as `run.failed`, never a malformed proposal.
7. **Persist via Commands.** Write `AgentRun` (append-only, trace spec) + `AgentProposal` (editable, orchestration spec) through the **Command path** so audit + events + index fire — the agent's only "write" is its own `AgentProposal`, via the audited path.
8. **Signal.** Emit `agent_orchestrator.proposal.ready {processId, stepId, proposalId}` to resume the parked workflow; emit `agent_orchestrator.run.completed`/`.failed`.

**Why `prepareMutation`/`ai_pending_actions` is NOT the disposition path.** `ai_pending_actions` is `ai_assistant`'s *operator-in-the-loop write-approval* primitive: a mutation tool calls `prepareMutation`, a card is shown, a human confirms, and the write executes *inside the chat turn*. Orchestration's disposition is a different governance plane: the agent emits **no write at all** (propose-only), the `AgentProposal` is persisted, and `business_rules` either auto-approves under threshold or raises a `workflows` `USER_TASK`; the *effector* runs later as a standard `workflows` activity under OM authority. Using `ai_pending_actions` would put write tools in the agent's hand (breaks propose-only), bypass `AgentProposal`/`AgentCorrection`/arbitration, and bind disposition to a synchronous chat operator. The two coexist; they are not interchangeable.

## Data Models

Entities owned *here* are intentionally small — most belong to sibling specs and are referenced by FK id only (no cross-module ORM relations).

**Registry types (code, not DB).** `CapabilityDefinition` is a Zod schema + `z.infer` TS interface in `data/validators.ts`, re-exported from `index.ts`:

```typescript
export const CapabilityDefinitionSchema = z.object({
  key: z.string(),                 // <domain>.<capability>
  version: z.number().int().positive(),
  proposalSchema: z.custom<z.ZodTypeAny>(),
  aclFeature: z.string(),
  contextModules: z.array(z.string()),
  guardrailSet: z.string(),        // name@version
  runtime: z.enum(['internal', 'a2a', 'opencode', 'foundry', 'bedrock', 'openai', 'vertex', 'custom']),
  runtimeRef: z.string(),
  lockedMutationPosture: z.literal('propose_only'),
  skillPacks: z.array(z.string()).optional(),
})
export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>
export type AgentRuntimeKind = CapabilityDefinition['runtime']
```

**Optional DB row for versioning/audit** — if a tenant-visible audit of which capability versions are deployed is required, add a `CapabilityVersion` entity (full MikroORM v7, per conventions). The *contract* stays in code; this row only records resolved deployment for audit:

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'agent_capability_versions' })
@Index({ name: 'agent_capability_versions_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_capability_versions_key_idx', properties: ['organizationId', 'capabilityKey', 'version'] })
export class AgentCapabilityVersion {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'capability_key', type: 'varchar', length: 100 })
  capabilityKey!: string // registry key; NOT an ORM relation

  @Property({ name: 'version', type: 'int' })
  version!: number

  @Property({ name: 'runtime', type: 'varchar', length: 20 })
  runtime!: string

  @Property({ name: 'runtime_ref', type: 'varchar', length: 200 })
  runtimeRef!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

**Referenced (owned by sibling specs — do not redefine here):** `AgentProposal`, `AgentRun`, `AgentSpan`, `AgentToolCall`, `AgentCorrection` (orchestration/trace); `AgentTask`, `AgentBinding`, `AgentTaskLease`, `AgentTaskEvent` (dispatch); `AgentContextBundle` (context); `AgentPrincipal`, `AgentDelegationGrant` (identity). GAP-02 only threads an additive `capabilityVersion` column onto `AgentProposal` and `AgentTask`.

## API Contracts

- **Read-only registry introspection** (`makeCrudRoute` + `indexer: { entityType: 'agent_orchestrator:capability' }`, route file `export const openApi`):
  - `GET /api/agent_orchestrator/capabilities` — list declared capabilities (key, version, aclFeature, runtime, guardrailSet, posture).
  - `GET /api/agent_orchestrator/capabilities/:key` — one capability's declared contract.
- **The runtime is internal/in-process, not a public HTTP endpoint.** It is reached through dispatch: the `internal` queue worker calls the DI service `InternalAgentRuntimeService.run(task)`. There is no `POST /run` route — the only ingress is `DispatchService.enqueue` (orchestration) → router → internal adapter.
- **Events** (`events.ts`, `createModuleEvents`, `as const`, `module.entity.action` past tense): `agent_orchestrator.proposal.ready`, `agent_orchestrator.run.completed`, `agent_orchestrator.run.failed`.
- **ACL** (`acl.ts` + `setup.ts` `defaultRoleFeatures`): `agent_orchestrator.invoke`, `agent_orchestrator.capability.view`, plus the per-capability `aclFeature` each registry entry declares.

## Propose-Only & No-Bypass (structural)

Propose-only is **by construction**, not by trust, and it is the consolidation point for GAP-16 Part B:

- **Object-mode = no tools.** `runAiAgentObject` resolves the agent's tools but does not pass them to the model (`agent-runtime.ts`, `void tools`). A model that cannot call any tool cannot mutate. The internal agent additionally runs `readOnly:true` + `mutationPolicy:'read-only'` with a READ-only allowlist.
- **Locked posture.** Every orchestrated capability declares `lockedMutationPosture:'propose_only'` as a code literal; the tenant-override layer (`ai_assistant` mutation-policy, `feature_toggles`) may read but is forbidden to widen it — a release-gate test asserts no override path downgrades it.
- **No-bypass (GAP-16 three layers).** (B-c) *structural* — the above; assert zero `isMutation:true` tools reachable in an object-mode internal agent. (B-b) *runtime* — an `AgentKindNoBypassSubscriber` (global flush-time `EventSubscriber`, mirroring `TenantEncryptionSubscriber`) fails closed on any create/update/delete by a `kind='agent'` actor lacking a command-audited context flag, covering the token-bearing external case across all flush sites. (B-a) *backstop* — the shipped release-gate test asserting no `kind='agent'` write outside the audited Command path. No single layer is trusted alone.
- **Execution stays OM-owned.** The agent's only write is its own `AgentProposal` (audited Command). Approved side effects run *after* the disposition gate as standard `workflows` effector activities under OM authority — never the agent's.

## Phases

1. **Capability registry + generator discovery.** `capabilities.ts` schema + `createCapabilityRegistry` helper (typed `AgentCapabilityKey`, `as const`); generator emitter → `capabilities.generated.ts`; `capabilityVersion` column on `AgentProposal`/`AgentTask` (additive, snapshot updated); boot/test completeness gates (every schema/ACL/guardrail resolves; bindings ⊆ registry; enqueue validates key). Optional `AgentCapabilityVersion` entity.
2. **InternalAgentRuntimeAdapter over object-mode.** Resolve capability → object-mode `AiAgentDefinition`; build input from `ContextBundle`; `runAs` agent principal; `runAiAgentObject` with `output.schema`; persist `AgentRun` + `AgentProposal` via Commands; signal `proposal.ready`; register as dispatch `runtime:'internal'`.
3. **Propose-only lockdown + no-bypass enforcement.** `lockedMutationPosture` enforced (zero `isMutation:true` tools reachable); GAP-16 (B-c)+(B-b)+(B-a) three-layer posture; release-gate tests.
4. **Optional follow-on.** Additive `ai_assistant` read-only tool loop in object-mode (a2: pass `isMutation:false` tools + `prepareStep` filter, end on `generateObject`); `SKILL.md` skill packs consumed by object-mode; A2A runtime generalization (external runtime behind the identical `AgentProposal` contract).

## Acceptance

- A capability declared once in `capabilities.ts` produces a typed key consumed by orchestration, dispatch, context, and guardrails — no second declaration of its key, schema, ACL, or guardrail set anywhere.
- Boot/test fails closed if any capability lacks a proposal schema, ACL feature, or guardrail set, or if a binding advertises an undeclared capability.
- Given an `AgentTask {capability, contextRef}`, `InternalAgentRuntimeService.run` runs an object-mode LLM under the agent principal and persists a **schema-valid** `AgentProposal`, then emits `agent_orchestrator.proposal.ready` — completing DISPATCH Phase 3 and ORCHESTRATION Phase 1.
- The agent holds NO mutating tool; its only write is the `AgentProposal` row via the audited Command path.
- A proposal stored under `claims.coverage_check@1` still validates against the v1 schema after `@2` ships; `@2` is strictly additive.
- No tenant override can change a capability's `propose_only` posture (test-enforced).
- The same `AgentProposal` is producible by a future A2A runtime with no change to disposition.
- A stale/invalid model output is rejected by GUARD post and recorded as `run.failed`, not a malformed proposal.

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Future change passes mutating tools to object-mode, breaking structural propose-only | High | security | `readOnly:true` + `mutationPolicy:'read-only'`; GUARD post; release-gate test asserting zero `isMutation:true` tools reachable | Low |
| Per-capability proposal Zod drifts from `agent.output.schema` | Medium | correctness | Single source in `data/validators.ts`; registry asserts `proposalSchema === output.schema` | Low |
| Capabilities need interactive read-then-read retrieval, under-served by pre-fetch | Medium | answer quality | Ship skeleton with pre-fetched `ContextBundle`; spike one real capability; land additive (a2) read-only tool loop if it materially helps | Medium |
| Capability-key sprawl / inconsistent namespacing | Medium | contract | Namespace governance rule + uniqueness boot check; reserved `agent_orchestrator.*` namespace | Low |
| Tenant attempts mutation-posture downgrade | High | security | Posture is a code literal; override layer reads but cannot widen; no-bypass test gate | Low |
| Registry vs `AgentBinding` drift (binding advertises undeclared capability) | Medium | dispatch | Boot check bindings ⊆ registry; router rejects unregistered/unversioned keys | Low |
| Generator change is a new auto-discovery contract surface | Medium | build | Additive file type following the exact `events.ts` discovery pattern; no existing surface changes | Low |
| Principal/context plumbing depends on IDENTITY/CONTEXT existing | Medium | dependency | Sequence after IDENTITY `runAs` + CONTEXT `ContextBundle`; assemble fails closed on unknown capability | Low |
| Cross-tenant context/run read | High | tenancy | Dual `tenant_id`+`organization_id`, org-scoped reads under the agent principal; cross-tenant denial test | Low |

## Integration Coverage (per GAP-17)

- **API paths:** `GET /api/agent_orchestrator/capabilities` and `/capabilities/:key` (read-only `makeCrudRoute` + `indexer` + `openApi`) — list/detail shape, RBAC gated by `agent_orchestrator.capability.view`, tenant-scoped.
- **E2E — capability resolve → run → typed proposal → signal:** enqueue an `AgentTask {capability, contextRef}` for a registered internal capability; assert the adapter resolves the object-mode `AiAgentDefinition`, runs under the agent principal, persists a schema-valid `AgentProposal` + `AgentRun`, and fires `agent_orchestrator.proposal.ready` resuming the parked workflow.
- **Tenant isolation:** an agent run for tenant A cannot read tenant B's context/records; context reads and `AgentProposal`/`AgentRun` reads are org-scoped (cross-tenant denial test).
- **Propose-only enforced:** assert zero `isMutation:true` tools reachable in an object-mode internal agent; assert a raw write by a `kind='agent'` actor without command-audited context is rejected by the no-bypass subscriber while the agent's own `AgentProposal` Command write passes; assert no override downgrades `propose_only`.
- **RBAC:** `agent_orchestrator.invoke` and per-capability `aclFeature` gate invocation; capability introspection gated by `agent_orchestrator.capability.view`.
- Tests are self-contained: create fixtures (capability registration via test config + API-created task) in setup, clean up created `AgentRun`/`AgentProposal`/`AgentTask` rows in teardown, no reliance on seeded/demo data.

## Migration & Backward Compatibility

- **Capability keys + proposal schemas are a STABLE contract.** A published `key@v` schema is FROZEN; incompatible changes ship as `@v+1` with `@v` retained ≥1 minor (deprecation protocol). `AgentProposal`/`AgentTask` persist `capabilityVersion` so stored proposals validate against the schema they were produced under.
- **The registry is additive.** Adding a capability is a code change to `capabilities.ts` (no migration); `capabilities.generated.ts` is a new auto-discovery surface following the `events.ts` pattern — no existing surface changes.
- **New entities/columns are additive:** the optional `agent_capability_versions` table is net-new; `capabilityVersion` is added nullable→defaulted while the sibling entities are still draft.
- **New events, ACL features, and the read-only `/capabilities` routes are additive** — no existing ids change. The runtime introduces no public write endpoint.
- Run `yarn generate && yarn db:generate` (review SQL + snapshot) before `yarn typecheck && yarn lint && yarn test`.

## Final Compliance Report

- [x] Module at `packages/core/src/modules/agent_orchestrator/`, id `agent_orchestrator`; code under `lib/orchestration/`.
- [x] `capabilities.ts` auto-discovered like `events.ts`/`acl.ts`; typed `AgentCapabilityKey` `as const`; generator emits `capabilities.generated.ts`.
- [x] `CapabilityDefinition` Zod + `z.infer` in `data/validators.ts`, re-exported from `index.ts`; proposal schema is the single source and equals `output.schema`.
- [x] Optional `AgentCapabilityVersion` is MikroORM v7 `/legacy`, explicit `@Property`, dual `tenant_id`+`organization_id`, soft-delete, `updated_at`; FK ids only (no cross-module ORM relations).
- [x] Runtime is in-process (DI `InternalAgentRuntimeService.run`), registered as dispatch `runtime:'internal'`; reuses `runAiAgentObject` object-mode + `AiModelFactory` + allowlist + tenant overrides — no new loop engine.
- [x] Propose-only is structural (object-mode passes no tools); `lockedMutationPosture:'propose_only'` non-downgradable; GAP-16 three-layer no-bypass.
- [x] Persistence via the Command path (audit/events/index); the only agent write is its own `AgentProposal`.
- [x] Read-only `/capabilities` via `makeCrudRoute` + `indexer` + `openApi`; no public runtime endpoint.
- [x] Events in `events.ts` (`as const`, `module.entity.action`); ACL in `acl.ts` + `setup.ts`; strings via `i18n/` if any UI is added.
- [x] DISPATCH open-Q #2 resolved: registry = declared/trusted vocabulary; `AgentBinding` = deployed/reachable; `TaskRouter` trusts each for its half.
- [x] Integration coverage defined: capability introspection API + E2E resolve→run→proposal→signal + tenant isolation + propose-only + RBAC.

## Changelog

- **2026-06-20:** Created. Consolidated GAP-01 (internal-agent runtime) and GAP-02 (capability registry) into one build spec; linked GAP-03 (`INVOKE_AGENT` workflow seam), GAP-16 (propose-only / no-bypass three-layer posture), and GAP-10 (`ContextModule` registry). Specified the code-first auto-discovered `capabilities.ts` registry (key/version/proposalSchema/aclFeature/contextModules/guardrailSet/runtime+runtimeRef/locked propose-only posture/skillPacks) with namespace + versioning + contract-stability governance, resolving DISPATCH open-Q #2 (code declares the contract; `AgentBinding` declares deployment). Specified the `InternalAgentRuntimeAdapter` over `runAiAgentObject` object-mode (pre-fetched ContextBundle, agent-principal `runAs`, GUARD pre/post, Command-path persistence, `proposal.ready` signal) registering as dispatch `runtime:'internal'`, and explained why `prepareMutation`/`ai_pending_actions` is not the disposition path. Made propose-only structural and tied no-bypass to GAP-16's flush-time subscriber + release-gate test.
