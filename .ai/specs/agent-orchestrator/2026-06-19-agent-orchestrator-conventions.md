> 🗂️ **Reorg 2026-06-22 · Status: LIVE REFERENCE.** House-style conventions the implemented `agent_orchestrator` module follows. Still authoritative for module layout/naming/tenancy. See also [`./00-IMPLEMENTED-BASELINE.md`].

# Agent Orchestrator — Implementation Conventions (House-Style Alignment)

> **Status:** Draft · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19
> **Scope:** Supplements `ADR-001`, `SPEC-00`, and the nine sub-specs. This is the section those specs are missing: how the `agent-orchestrator` module must be structured, named, and coded so it matches the real Open Mercato codebase rather than the pseudocode in the specs.
> **Why:** A codebase audit (2026-06-19) found the architecture sound but the entity/module-structure examples diverge from house style (`@Json()`/`@Enum()` shorthand, a `src/<subdomain>/` layout with no precedent, a `contracts/` folder, `organizationId`-only tenancy). Implementers copying the spec examples would produce non-compiling, non-discoverable, or tenant-unsafe code. This document is normative; where it conflicts with an entity sketch in another spec, **this wins**.

---

## 1. Packaging & placement

**Decision: ship as a first-party core module inside `@open-mercato/core`, not a standalone package.**

- Path: `packages/core/src/modules/agent_orchestrator/`.
- Module id: **`agent_orchestrator`** (plural-style snake_case; dashes→underscores). The specs' `@open-mercato/agent-orchestrator` package framing is wrong for a core feature — only external **providers** (`gateway-stripe`, `channel-gmail`) are separate packages. Core business modules live in `packages/core/src/modules/<id>/` and are not their own npm package.
- Rationale: it depends on many other core modules (`workflows`, `business_rules`, `auth`, `audit_logs`, `api_keys`, `attachments`, `query_index`, `feature_toggles`, `notifications`, `portal`) that already live in core; a separate package would create a heavy cross-package dependency web for no isolation benefit. Extract a subdomain to its own package later only if it needs independent reuse (the specs already flag `dispatch`/`trace` as candidates).

If the team instead wants it independently activatable (the official-modules pattern), that is the only reason to make it a package — decide explicitly and record it here; do not leave it ambiguous as the current specs do.

---

## 2. Module file layout

**There is no `src/<subdomain>/` decomposition in Open Mercato.** Every module (`customers`, `sales`, `business_rules`, `workflows`) uses a **flat, auto-discovered** root layout. The generator discovers `api/`, `backend/`, `subscribers/`, `workers/`, `events.ts`, `acl.ts`, `setup.ts`, `di.ts`, `ce.ts`, `notifications.ts`, `search.ts`, `data/entities.ts` **at the module root**. Nesting these under `src/orchestration/…` breaks discovery.

Map the nine "subdomains" onto **`lib/` namespaces and `data/` files**, keeping the discovered surfaces flat:

```
packages/core/src/modules/agent_orchestrator/
├── index.ts                     # ModuleInfo metadata + public re-exports
├── acl.ts                       # all features (agent.invoke, agent_dispatch.*, agent_trace.*, …)
├── di.ts                        # register all services (DispatchService, TraceIngestionService, …)
├── setup.ts                     # defaultRoleFeatures + seedDefaults (guardrail sets, rule packs)
├── events.ts                    # createModuleEvents({ moduleId: 'agent_orchestrator', … })
├── ce.ts                        # custom entities / field declarations if any
├── notifications.ts             # guardrail.tripped, budget-exceeded notification types
├── data/
│   ├── entities.ts              # ALL MikroORM entities (Proposal, AgentTask, AgentRun, …)
│   ├── validators.ts            # ALL Zod schemas (NOT a contracts/ folder)
│   └── extensions.ts            # User.kind, ActionLog.onBehalfOfUserId extensions (see §6)
├── lib/
│   ├── orchestration/           # INVOKE_AGENT activity + disposition (AGENTINT-01)
│   ├── identity/                # principal provisioning, runAs, delegation (IDENTITY-01)
│   ├── dispatch/                # DispatchService, TaskRouter, adapters (DISPATCH-01)
│   ├── trace/                   # TraceIngestionService, EvalCaseExporter (TRACE-01)
│   ├── guardrails/              # GuardrailService (GUARD-01)
│   ├── context/                 # ContextResolver / TDCR (CONTEXT-01)
│   ├── compliance/              # DecisionRecord/contest services (COMPLY-01)
│   └── lifecycle/               # release/budget services (LIFECYCLE-01)
├── api/                         # CRUD + custom routes (see §5); each file exports openApi
├── backend/                     # cockpit pages (COCKPIT-01) — but prefer widget injection (§7)
├── subscribers/                 # event subscribers (one side-effect each)
├── workers/                     # queue workers (dispatch lease sweeper, async eval)
├── migrations/                  # MikroORM migrations + .snapshot-open-mercato.json
└── i18n/                        # <locale>.json — all user-facing strings
```

- **Zod lives in `data/validators.ts`**, not `contracts/`. The cross-spec "freeze the shared contracts" idea from the architecture doc is still good practice — just colocate them in `data/validators.ts` and re-export the shared ones from `index.ts` so other modules import `@open-mercato/core/.../agent_orchestrator` types.
- The per-spec subdomain boundary survives as a `lib/<subdomain>/` folder — clean separation without fighting auto-discovery.

---

## 3. Entity definition standard

The specs' `@Entity() class Proposal { id; organizationId; @Json() payload; @Enum() disposition }` is **pseudocode and will not compile**. Real Open Mercato entities are MikroORM **v7** with `/legacy` decorators and an explicit `@Property` per column.

**Mandatory rules for every new entity:**

1. Imports: `import { OptionalProps } from '@mikro-orm/core'` and decorators from `@mikro-orm/decorators/legacy`.
2. `@Entity({ tableName: '<prefix>_<plural>' })` — table names are **plural snake_case** with a module prefix. Use the **`agent_` prefix** for this module (`agent_proposals`, `agent_tasks`, `agent_runs`, `agent_bindings`, `agent_spans`, …).
3. UUID PK: `@PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })`.
4. Every property is explicit: `@Property({ name: '<snake_case>', type: '<pgtype>', nullable?, default? })`. TS property is **camelCase**; the DB column is **snake_case** via `name`. No bare properties, no `@Json()`, no `@Enum()`.
   - JSON → `type: 'jsonb'` (TS type `any | null` is the existing house pattern; the real shape is enforced by the matching Zod schema in `data/validators.ts`).
   - Enums → `type: 'varchar'` + a TS string-union type (e.g. `export type Disposition = 'pending' | 'auto_approved' | …`). This mirrors `RuleType` in `business_rules/data/entities.ts`.
5. **Tenancy is two columns, always.** Every tenant-scoped row carries **both** `tenant_id` **and** `organization_id` (the spec sketches show only `organizationId` — that is a tenant-isolation bug). Index them: `@Index({ properties: ['tenantId', 'organizationId'] })`. All queries filter by `organizationId`; never expose cross-tenant rows.
6. Audit columns: `created_at` (`onCreate`), `updated_at` (`onUpdate`), `deleted_at` (nullable) for soft delete.
7. **Optimistic locking (default ON):** any user-editable entity (e.g. `Proposal`, `AgentBinding`, `AgentRelease`, `Budget`) MUST expose `updated_at` and return `updatedAt` in its list/detail API. Append-only logs (`AgentSpan`, `AgentToolCall`, `TaskEvent`, `AgentCorrection`, `EvalResult`, `EvalCase`, `GuardrailCheck`, `DecisionRecord`) are exempt — declare them append-only.
8. Declare `[OptionalProps]?` for defaulted columns so create-types are correct.
9. **No cross-module ORM relations.** Reference other modules by FK **id** only (`agentRunId`, `processId`, `proposalId`, `userId`) — never a MikroORM relation to a `workflows`/`auth` entity. (Relations *within* this module are fine.)

### 3.1 Reference rewrite — `Proposal` (from AGENTINT-01)

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type ProposalDisposition =
  | 'pending' | 'auto_approved' | 'approved' | 'edited' | 'rejected'

@Entity({ tableName: 'agent_proposals' })
@Index({ name: 'agent_proposals_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_proposals_process_idx', properties: ['processId', 'stepId'] })
export class AgentProposal {
  [OptionalProps]?: 'disposition' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'process_id', type: 'uuid' })
  processId!: string // FK id → workflows instance; NOT an ORM relation

  @Property({ name: 'step_id', type: 'varchar', length: 100 })
  stepId!: string

  @Property({ name: 'agent_run_id', type: 'uuid' })
  agentRunId!: string // FK id → agent_runs

  @Property({ name: 'capability', type: 'varchar', length: 100 })
  capability!: string

  @Property({ name: 'payload', type: 'jsonb' })
  payload!: any // shape enforced by per-capability Zod in data/validators.ts

  @Property({ name: 'confidence', type: 'float', nullable: true })
  confidence?: number | null

  @Property({ name: 'disposition', type: 'varchar', length: 20, default: 'pending' })
  disposition: ProposalDisposition = 'pending'

  @Property({ name: 'disposition_by', type: 'varchar', length: 100, nullable: true })
  dispositionBy?: string | null // userId | 'rule:<ruleId>' | null

  @Property({ name: 'disposition_reason', type: 'text', nullable: true })
  dispositionReason?: string | null

  @Property({ name: 'guard_results', type: 'jsonb', nullable: true })
  guardResults?: any | null // from GUARD-01

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

### 3.2 Reference rewrite — append-only log (`TaskEvent` from DISPATCH-01)

Append-only logs omit `updated_at`/`deleted_at` and are never edited:

```typescript
export type TaskStatus =
  | 'queued' | 'claimed' | 'running' | 'input_required'
  | 'completed' | 'failed' | 'cancelled' | 'dead_letter'

@Entity({ tableName: 'agent_task_events' })
@Index({ name: 'agent_task_events_task_idx', properties: ['taskId', 'at'] })
export class AgentTaskEvent {
  [OptionalProps]?: 'at'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string

  @Property({ name: 'from_status', type: 'varchar', length: 20, nullable: true })
  fromStatus?: TaskStatus | null

  @Property({ name: 'to_status', type: 'varchar', length: 20 })
  toStatus!: TaskStatus

  @Property({ name: 'actor', type: 'varchar', length: 100 })
  actor!: string

  @Property({ name: 'detail', type: 'jsonb', nullable: true })
  detail?: any | null

  @Property({ name: 'at', type: Date, onCreate: () => new Date() })
  at: Date = new Date()
}
```

Apply the same treatment to all other entity sketches in the specs: `AgentTask`, `AgentBinding`, `TaskLease`, `AgentRun`, `AgentSpan`, `AgentToolCall`, `EvalAssertion`, `EvalResult`, `AgentCorrection`, `EvalCase`, `GuardrailCheck`, `ContextBundle`, `AgentPrincipal`, `DelegationGrant`, `DecisionRecord`, `ContestCase`, `FairnessMetric`, `AgentRelease`, `Budget`.

---

## 4. Extending existing entities (IDENTITY-01)

`User.kind`, `ActionLog.onBehalfOfUserId`, and the `agent` source key are **additive changes to other modules' contracts** — governed by `BACKWARD_COMPATIBILITY.md` (DB schema + types are STABLE/ADDITIVE-ONLY). Rules:

- Add `kind` to `auth` `User` and `onBehalfOfUserId` to `audit_logs` `ActionLog` as **nullable, defaulted** columns (`kind` default `'human'`, `onBehalfOfUserId` default `null`) so existing rows and external readers are unaffected.
- Add `'agent'` to the `ActionLogSourceKey` union in `audit_logs/lib/projections.ts` (currently `['ui', 'api', 'system']`) — additive only.
- These edits land in the **`auth`/`audit_logs` modules**, not in `agent_orchestrator/data/extensions.ts` (entity *extensions* are for new linked entities, not new columns on a core entity). Coordinate with those modules' owners and ship migration + snapshot per module.

---

## 5. API routes

- CRUD reads (`/tasks`, `/bindings`, `/runs`, `/proposals`, `/metrics`) use **`makeCrudRoute`** with `indexer: { entityType: 'agent_orchestrator:<entity>' }`, and each route file MUST `export const openApi` (build it via a module `api/openapi.ts` factory).
- The custom write endpoints the specs define — `POST /proposals/:id/dispose`, the worker `claim/heartbeat/result/input`, A2A inbound, OAuth token, revoke — are **non-CRUD writes**, so they MUST wire the mutation-guard contract: `validateCrudMutationGuard` before, `runCrudMutationGuardAfterSuccess` after, and run domain writes through the **Command pattern** (so audit, events, cache, indexing stay consistent). This is also what makes IDENTITY-01's "every agent write is audited" claim actually true — see §8.
- `dispose` mutates a `Proposal` that carries `updatedAt`, so it MUST enforce optimistic locking at the command layer (`enforceCommandOptimisticLock` / `createCommandOptimisticLockGuardService`) and surface 409s via `surfaceRecordConflict` — it is not a `CrudForm`, so the automatic path does not apply.
- Route URLs follow the module: `/api/agent_orchestrator/...` (underscore module id), not `/api/agent-orchestration/...` as some spec drafts write.

---

## 6. Naming alignment

- **Module id / DI / URLs:** `agent_orchestrator` everywhere (the specs mix `agent-orchestration`, `agent-orchestrator`, `agent-trace`, `agent-identity`). Pick one and use it for the module id, table prefix family, DI service keys, event ids, and API paths.
- **Event ids:** `module.entity.action`, singular entity, past-tense action. Audit the spec event lists against this: `agent_task.created` ✓, `agent_binding.health_changed` ✓, but `agent.proposal.ready` → `agent_orchestrator.proposal.ready` (or `agent_proposal.ready`), `guardrail.tripped` → `agent_orchestrator.guardrail.tripped`. Declare all of them in `events.ts` with `as const`.
- **ACL features:** `<module>.<action>` — i.e. `agent_orchestrator.invoke`, `agent_orchestrator.proposal.dispose`, etc., OR a documented dispatch/trace sub-namespace (`agent_dispatch.*`, `agent_trace.*`) — but then those become the contract and must be stable. Add every feature to `setup.ts` `defaultRoleFeatures` and run `yarn mercato auth sync-role-acls`.
- **`clientBroadcast` / `portalBroadcast`:** the cockpit's live updates and the claimant portal's contest surface should set these flags on the relevant `EventDefinition`s rather than inventing a new SSE channel.

---

## 7. UI (COCKPIT-01)

- Prefer **widget injection** into the existing `workflows` monitor and "My Tasks" over net-new `backend/` pages, exactly as the spec intends. Use the documented spot ids (`data-table:<tableId>:row-actions`, `crud-form:<entityId>:fields`, `admin.page:<path>:after`, etc.) and `perspectives` for the Admin/Operator/Engineer scoping.
- All strings via `i18n/<locale>.json` + `useT()` / `resolveTranslations()`; never hard-code user-facing text. Use DS status tokens (`text-status-*`) for proposal/guardrail states — no `text-red-*`/`text-green-*`.
- Writes from custom UI that don't go through `CrudForm` must use `useGuardedMutation(...).runMutation(...)` and `apiCall*` (never raw `fetch`).

---

## 8. The audit-automation caveat (load-bearing for IDENTITY-01)

The audit found that `ActionLog` writes are **not** universally automatic — modules call `actionLogService.log()` (or write through the Command path) explicitly; there is no blanket "every `em.flush()` is audited" guarantee. IDENTITY-01's "every agent action is audited identically to a human" therefore depends on a real invariant the implementer must enforce, not inherit for free:

- **All** agent mutations route through **Commands/CRUD** (which emit audit + events + index side effects), never raw `EntityManager` writes.
- Enforce via the `ai_assistant` tool allowlist + mutation-policy (no raw-write tools) and GUARD-01 tool-scope checks.
- Ship the **no-bypass test** the spec calls for: assert no `kind='agent'` actor ever appears on a write that did not go through the audited Command path. Treat this test as a release gate, not a nicety.

Document this as an explicit invariant in AGENTINT-01/IDENTITY-01 rather than an assumption.

---

## 9. Quick checklist for implementers

- [ ] Module at `packages/core/src/modules/agent_orchestrator/`, id `agent_orchestrator`.
- [ ] Flat root layout; subdomains live under `lib/<subdomain>/`; Zod in `data/validators.ts`.
- [ ] Every entity: `/legacy` decorators, explicit `@Property`, `tenant_id` **and** `organization_id`, soft-delete, `updated_at` for editable ones.
- [ ] FK ids only across modules — no cross-module ORM relations.
- [ ] `auth.User.kind` / `audit_logs.ActionLog.onBehalfOfUserId` / `agent` source key added as nullable+defaulted, in their home modules, additive.
- [ ] CRUD via `makeCrudRoute` + `indexer` + `openApi`; custom writes via Commands + mutation guard + optimistic lock.
- [ ] Events in `events.ts` (`as const`, `module.entity.action`); ACL in `acl.ts` + `setup.ts`; strings in `i18n/`.
- [ ] No-bypass audit test shipped and gating.
- [ ] `yarn generate && yarn db:generate` (review SQL) → `yarn typecheck && yarn lint && yarn test`.

---

## Changelog

- **2026-06-19:** Initial draft. Created from the spec-vs-codebase audit to supply the entity/module-structure conventions the agent-orchestrator specs omit, and to correct the pseudocode-level divergences (entity shorthand, `src/<subdomain>/` layout, `contracts/` folder, single-column tenancy, package-vs-core ambiguity, naming drift, the audit-automation assumption).
