> 🗂️ **Reorg 2026-06-22 · Status: IMPLEMENTED (as-built design record).** The design here has shipped; it is superseded as a *plan* by the baseline doc and kept for provenance. Authoritative current docs: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` and `packages/enterprise/src/modules/agent_orchestrator/`.

# 03 · Disposition & Proposals

> **Status:** Ready to implement · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-20
> **Module:** `agent_orchestrator` · **Depends:** 01 (entities + `agentRuntime`), 02 (`INVOKE_AGENT` activity + `WAIT_FOR_SIGNAL` resume) · **Area of:** [`mvp/00-overview.md`](00-overview.md)
> **Conforms to** the §Shared Contracts freeze in `00-overview.md`. Where this file disagrees with the index, the index wins.

## TLDR

This area owns the **proposal disposition lifecycle and the gate**. After an `INVOKE_AGENT` step produces an `actionable` `AgentProposal` (entity owned by area 01), the `DispositionService` decides — **auto-approve under a single confidence threshold**, or **raise a `USER_TASK`** and park the workflow. The operator's verdict lands through `POST /api/agent_orchestrator/proposals/:id/dispose`, a non-CRUD **Command** that wires the mutation-guard, enforces **optimistic locking** on `AgentProposal.updated_at`, and surfaces 409s via `surfaceRecordConflict`. Both the auto-approve path and a human `approved`/`edited`/`rejected` verdict end by emitting `agent_orchestrator.proposal.ready { processId, stepId, proposalId }` — the resume signal area 02's `WAIT_FOR_SIGNAL` consumes. `edit`/`reject` require a `reason`, stored as `disposition_reason` (the full `AgentCorrection` overlay is deferred). Plus the proposal reads, events, and ACL.

## Scope

In: the dispose Command + endpoint; `DispositionService` (threshold check → auto-approve or `USER_TASK`); emitting `proposal.disposed` + `proposal.ready`; proposal reads (`GET /proposals`, `GET /proposals/:id`); edit-applies-payload and reject/edit-requires-reason rules; the two ACL features `proposals.view` / `proposals.dispose`; the seam with area 02.

Out (owned elsewhere / deferred): the `AgentProposal`/`AgentRun` entities + `agentRuntime` (area 01); the `INVOKE_AGENT` activity, editor node, and `WAIT_FOR_SIGNAL` park/resume wiring (area 02); the full `AgentCorrection` append-only entity, `business_rules` VALIDATION rule packs, arbitration of competing proposals, guardrails, and the cockpit UI (deferred overlays — see parent-folder specs). MVP stores `disposition_reason` on the proposal in lieu of a Correction row.

## Disposition flow

```
INVOKE_AGENT executor (area 02)
  └─ agentRuntime.run(agentId, input, ctx)            (area 01 → writes AgentRun)
        └─ actionable → AgentProposal persisted        (area 01, disposition='pending')
  └─ dispositionService.dispose(proposal, { autoApproveThreshold | alwaysAsk }, ctx)   ← THIS AREA, called INLINE
        ├─ informative result → no proposal → executor proceeds directly (no gate)
        ├─ confidence >= threshold (and not alwaysAsk)
        │      → disposeProposalCommand(internal 'auto_approved'), dispositionBy = 'rule:threshold'
        │      → emit agent_orchestrator.proposal.disposed
        │      → return { kind:'auto_approved' } → area-02 executor PROCEEDS (no park, NO proposal.ready)
        └─ else (below threshold OR alwaysAsk OR confidence missing)
               → raise workflows USER_TASK (proposal payload surfaced via formSchema), instance PARKS
               → operator calls POST /proposals/:id/dispose { disposition, payload?, reason? }
                    → disposeProposalCommand: approved | edited | rejected
                    → emit proposal.disposed
                    → emit agent_orchestrator.proposal.ready { processId, stepId, proposalId }  ── resume
```

**The seam with area 02 (recommended, frozen here).** The `INVOKE_AGENT` executor calls `agentRuntime.run` then **`dispositionService.dispose(proposal, onResult, ctx)` inline** in the same activity execution. `dispositionService` is a thin DI service — it does **not** subscribe to `proposal.created` (an event-driven seam would add a hop, lose the activity's transaction scope, and make ordering non-deterministic against `WAIT_FOR_SIGNAL`). On auto-approve it disposes (audited Command) and returns `{ kind:'auto_approved' }` — the executor **proceeds without parking** and **no `proposal.ready` is emitted** (this avoids a park-before-signal race: the instance never paused, so there is nothing to signal). On ask-a-human it raises the `USER_TASK` and returns `{ kind:'user_task' }`, leaving the instance parked at `WAIT_FOR_SIGNAL`; the operator's dispose endpoint later emits `proposal.ready` to resume. So `proposal.ready` is the **human-path resume signal only** — area 02 keys its `WAIT_FOR_SIGNAL` on `signalName = 'agent_orchestrator.proposal.ready'` and matches the parked instance by `processId`.

**Resume signal.** `proposal.ready { processId, stepId, proposalId }` is delivered to the workflow engine via `sendSignal(em, container, { instanceId: processId, signalName: 'agent_orchestrator.proposal.ready', payload: { proposalId, stepId, disposition }, tenantId, organizationId })` (see `workflows/lib/signal-handler.ts`). The merged `disposition`/`payload` lands in `WorkflowInstance.context` so the downstream effector step reads the approved (possibly edited) payload. `rejected` resumes too — the workflow definition branches on `context.signal_*_payload.disposition` and does **not** run the effector.

## Files to create/modify (real paths)

```
packages/enterprise/src/modules/agent_orchestrator/
├── commands/
│   └── dispose.ts                  # NEW — disposeProposalCommand (this area)
├── lib/disposition/
│   └── dispositionService.ts       # NEW — threshold check; emits ready or raises USER_TASK
├── api/proposals/
│   ├── route.ts                    # NEW — GET /proposals + GET /proposals/:id via makeCrudRoute (+ openApi)
│   └── [id]/dispose/route.ts       # NEW — POST dispose; mutation-guard + optimistic lock + surfaceRecordConflict server seam
├── data/validators.ts              # MODIFY — add disposeProposalSchema (this area's slice)
├── events.ts                       # MODIFY (area 01 creates) — ensure proposal.disposed + proposal.ready declared
├── acl.ts                          # MODIFY (area 01 creates) — ensure proposals.view + proposals.dispose declared
├── setup.ts                        # MODIFY — mirror the two features into defaultRoleFeatures
├── di.ts                           # MODIFY — register dispositionService
├── index.ts                        # MODIFY — re-export ProposalDisposition + dispose Zod types
└── i18n/en.json                    # MODIFY — dispose / reason / conflict strings
```

`data/entities.ts` (the `AgentProposal` definition) is **owned by area 01** — this area only writes/transitions rows, never redefines the entity.

## The dispose Command + endpoint

`disposeProposalCommand` in `commands/dispose.ts` follows the customers/sales Command pattern (`packages/core/src/modules/customers/commands/deals.ts`, `packages/shared/src/lib/crud/optimistic-lock-command.ts`). Ordered contract:

1. **`validateCrudMutationGuard`** (before) — resource `agent_orchestrator:proposal`, action `update`, feature `agent_orchestrator.proposals.dispose`, scoped `{ tenantId, organizationId }`.
2. **Load** the proposal with `findOneWithDecryption(em, AgentProposal, { id, tenantId, organizationId, deletedAt: null }, …)`. Missing → `enforceRecordGoneIsConflict(...)` (so a stale-modal save surfaces the unified conflict bar) then `CrudHttpError(404)` — **never** leak a cross-tenant row.
3. **Guard already-disposed** — if `disposition !== 'pending'` and the new verdict differs, return the current state (idempotent re-dispose) or `CrudHttpError(409)` for a genuine conflict; the threshold rule and a human can race.
4. **`enforceCommandOptimisticLock`** — `{ resourceKind: 'agent_orchestrator.proposal', resourceId: id, current: proposal.updatedAt, request: ctx.request }`. Reads the `x-om-ext-optimistic-lock-expected-updated-at` header. Mismatch → `CrudHttpError(409, OptimisticLockConflictBody)`.
5. **Validate input** with `disposeProposalSchema` (zod, `data/validators.ts`):
   ```ts
   const disposeProposalSchema = z.object({
     disposition: z.enum(['approved', 'edited', 'rejected']),  // dispose endpoint never sets pending/auto_approved
     payload: z.record(z.unknown()).optional(),                // edited overrides proposal.payload
     reason: z.string().min(1).optional(),
   }).superRefine((v, ctx) => {
     if ((v.disposition === 'edited' || v.disposition === 'rejected') && !v.reason)
       ctx.addIssue({ code: 'custom', path: ['reason'], message: '[internal] reason required for edit/reject' })
     if (v.disposition === 'edited' && !v.payload)
       ctx.addIssue({ code: 'custom', path: ['payload'], message: '[internal] payload required for edit' })
   })
   ```
6. **Transition** (`withAtomicFlush` or `runCrudCommandWrite`, `{ transaction: true }`):
   - `approved` → `disposition = 'approved'`, `dispositionBy = ctx.userId`.
   - `edited` → `disposition = 'edited'`, `payload = input.payload`, `dispositionBy = ctx.userId`, `dispositionReason = input.reason`.
   - `rejected` → `disposition = 'rejected'`, `dispositionBy = ctx.userId`, `dispositionReason = input.reason`.
   - `updatedAt` bumps via the entity's `onUpdate` (next dispose with the old token → 409).
7. **`runCrudMutationGuardAfterSuccess`** (after) — fire audit + index side effects for `agent_orchestrator:proposal`.
8. **Emit** `agent_orchestrator.proposal.disposed { proposalId, disposition, dispositionBy, processId, stepId, tenantId, organizationId }`.
9. **Resume (human path only)** — this endpoint serves the **human verdicts** (`approved`/`edited`/`rejected`) where the instance is **parked**: if the proposal carries `processId` call the resume seam `sendSignal(...)` for `proposal.ready` (the definition branches on disposition; `rejected` resumes but the effector transition condition skips the effector). Ad-hoc proposals (no `processId`) skip resume. The internal **`auto_approved`** path does NOT reach this resume — the area-02 executor proceeded inline without ever parking.

**Endpoint** `api/proposals/[id]/dispose/route.ts` (POST). It is **not** a `CrudForm` submit, so the route resolves `disposeProposalCommand` from the command bus, passes `ctx.request` for the lock header, and on `CrudHttpError(409, …)` returns the structured `OptimisticLockConflictBody` as-is so the client's `surfaceRecordConflict(err, t)` renders the conflict bar. `export const openApi` documents the 200 / 403 / 404 / 409 shapes.

**Client side** (consumed by area 04): non-`CrudForm` dispose buttons MUST wrap the call in `useGuardedMutation(...).runMutation(...)` with `withScopedApiRequestHeaders(buildOptimisticLockHeader(proposal.updatedAt), …)` and route conflicts through `surfaceRecordConflict(err, t)` from `@open-mercato/ui/backend/conflicts`.

## DispositionService

`lib/disposition/dispositionService.ts`, DI key `dispositionService`. Called **inline by the area-02 executor** right after `agentRuntime.run`. Signature:

```ts
type DispositionOutcome =
  | { kind: 'auto_approved'; proposalId: string }
  | { kind: 'user_task'; userTaskId: string; proposalId: string }

interface DispositionService {
  dispose(
    proposal: AgentProposal,
    onResult: { autoApproveThreshold: number } | { alwaysAsk: true },
    ctx: { tenantId: string; organizationId: string; userId?: string; processId: string; stepId: string },
  ): Promise<DispositionOutcome>
}
```

**Threshold rule (MVP — recommended).** A **simple inline check**: `'alwaysAsk' in onResult` → always raise `USER_TASK`; else `typeof proposal.confidence === 'number' && proposal.confidence >= onResult.autoApproveThreshold` → auto-approve; a missing/`null` confidence is treated as **below threshold** (fail-closed → human). No `business_rules` dependency in MVP.

- **Auto-approve:** set `disposition='auto_approved'`, `dispositionBy='rule:threshold'`, emit `proposal.disposed`, and **return `{ kind:'auto_approved' }`** — **do NOT emit `proposal.ready`**; the area-02 executor proceeds to the effector without parking. This write goes through the **Command** (`disposeProposalCommand` with an internal `auto_approved` verdict, or a thin sibling) so audit/events/index fire — the auto path must not be a raw `em.flush`.
- **Ask-a-human:** raise a `workflows` `USER_TASK` (assignee from the step config / role), surfacing the proposal payload via the task `formSchema`; the instance stays parked at `WAIT_FOR_SIGNAL`. Return `{ kind: 'user_task', … }`.

> **Growth path (post-MVP):** replace the inline check with **one `business_rules` VALIDATION rule** (`entityType 'agent_orchestrator:proposal'`, recursive `confidence >= x AND fraud < y AND payout <= z`). The `business_rules` engine is confirmed to evaluate these trees; swapping the check for a rule pack is additive and keeps the same auto-approve / `USER_TASK` branches. Arbitration of competing proposals is a further overlay.

## API Contracts

Base `/api/agent_orchestrator/`.

- **`POST /proposals/:id/dispose`** — body `{ disposition: 'approved'|'edited'|'rejected', payload?, reason? }`. Non-CRUD Command write. Mutation-guard (`agent_orchestrator.proposals.dispose`) + optimistic lock (`updatedAt` via header) + `surfaceRecordConflict` 409. `edited` requires `payload` + `reason`; `rejected` requires `reason`. Returns the updated proposal (incl. `updatedAt`). On `processId`, emits `proposal.ready` to resume.
- **`GET /proposals`** — `makeCrudRoute` + `indexer: { entityType: 'agent_orchestrator:proposal' }` + `export const openApi`. Org-scoped list; returns `updatedAt`; filters by `disposition`, `agentId`, `processId`. Feature `agent_orchestrator.proposals.view`.
- **`GET /proposals/:id`** — single proposal (payload, confidence, disposition, dispositionBy, dispositionReason, processId, stepId, runId, updatedAt). Org-scoped; 404 (never the row) cross-tenant. Feature `agent_orchestrator.proposals.view`.

## Events

Declared in `events.ts` (`createModuleEvents({ moduleId: 'agent_orchestrator', events: [...] as const })`, ids `module.entity.action` past tense). Area 01 creates the file; this area depends on:

| Event id | Emitted by | Payload | Notes |
|----------|-----------|---------|-------|
| `agent_orchestrator.proposal.created` | area 01 (`agentRuntime`) | `{ proposalId, runId, agentId, processId?, stepId?, … }` | Persistent. Consumed for read-model/index; **not** the disposition trigger. |
| `agent_orchestrator.proposal.disposed` | **this area** | `{ proposalId, disposition, dispositionBy, processId?, stepId? }` | Persistent. Audit of every verdict (rule or human). |
| `agent_orchestrator.proposal.ready` | **this area** | `{ processId, stepId, proposalId }` | The **workflow resume signal** (area 02's `WAIT_FOR_SIGNAL`). `clientBroadcast: true` so the cockpit live-updates. |

## ACL

`acl.ts` (area 01 creates) + `setup.ts` `defaultRoleFeatures` + `yarn mercato auth sync-role-acls`:

- `agent_orchestrator.proposals.view` — read proposals (list/detail; cockpit caseload). Grant `admin`, `employee`.
- `agent_orchestrator.proposals.dispose` — approve/edit/reject. Grant `admin` (and any operator role); **not** `employee` by default.

The dispose endpoint gates on `proposals.dispose`; the read endpoints gate on `proposals.view`. Use the shared wildcard-aware matcher (`admin` holds `agent_orchestrator.*`).

## Phases

1. **Reads + entity-write seam.** `GET /proposals` + `/proposals/:id` via `makeCrudRoute` + `openApi`; `disposeProposalSchema` in `validators.ts`; re-exports in `index.ts`. *(P0)*
2. **Dispose Command + endpoint.** `commands/dispose.ts` (mutation-guard → optimistic lock → transition → after-success → emit `proposal.disposed`); `api/proposals/[id]/dispose/route.ts`; 409 surfacing; ACL + setup grants. *(P0)*
3. **DispositionService + resume.** `lib/disposition/dispositionService.ts` (inline threshold → auto-approve disposes and returns `{ kind:'auto_approved' }` **without** `proposal.ready` (executor proceeds inline), else raise `USER_TASK` and return `{ kind:'user_task' }`); wire the resume `sendSignal` **only from the human dispose Command** (the auto path never parks). Integration tests. *(P0 — headline)*

## Acceptance

1. A proposal with `confidence >= threshold` is `auto_approved` (`dispositionBy = 'rule:threshold'`), emits `proposal.disposed` (**not** `proposal.ready`), and the workflow **proceeds inline** (the step never parks) to run its effector.
2. A proposal below threshold (or `alwaysAsk`, or `confidence == null`) raises a `USER_TASK` and parks; `POST /proposals/:id/dispose { approved }` resumes the workflow and the effector runs.
3. `dispose { edited, payload, reason }` writes `disposition='edited'`, applies `payload`, stores `disposition_reason`, and resumes; the effector reads the edited payload from context.
4. `dispose { rejected, reason }` writes `disposition='rejected'` + `disposition_reason`, resumes, and the effector does **not** run.
5. `edit`/`reject` without `reason` → 400; `edit` without `payload` → 400.
6. A second concurrent dispose with a stale `updatedAt` → **409** with the structured conflict body, surfaced via the conflict bar.
7. A token without `agent_orchestrator.proposals.dispose` → 403; org B's token → 404 (never the row) on org A's proposal for dispose, single-read, and list.

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Dispose endpoint bypasses audit/events (raw write) | High | audit/security | Command pattern + mutation-guard mandatory; auto-approve path also routes through the Command | Low |
| Concurrent dispose (rule auto vs human) lost update | Medium | data integrity | `updated_at` + `enforceCommandOptimisticLock`; 409 + `surfaceRecordConflict`; already-disposed guard | Low |
| Lost `proposal.ready` → parked instance never resumes | Medium | reliability | Emit on every terminal verdict incl. `rejected`; resume keyed on `processId`; (deferred) dispatch timeout sweeper | Medium |
| Inline threshold diverges from area 02's `onResult` config | Medium | correctness | Single `DispositionService.dispose(onResult)` signature; executor passes the node's `onResult` verbatim | Low |
| `null` confidence silently auto-approves | High | safety | Fail-closed: missing/`null` confidence treated as below threshold → human | Low |
| Cross-tenant proposal exposure on dispose/read | High | tenancy | Dual `tenant_id`+`organization_id`, org-scoped queries, 404 (never row); tenant-isolation test | Low |
| Edit applies an unvalidated payload to the effector | Medium | correctness | `payload` re-validated against the agent's `result.schema` (area 01 Zod) before transition | Low |

## Integration Coverage

> Playwright, per `.ai/qa/AGENTS.md`; location `packages/enterprise/src/modules/agent_orchestrator/__integration__/TC-AGENT-DISP-<NNN>.spec.ts`. Self-contained: create `AgentRun`/`AgentProposal` + workflow fixtures in setup (prefer API), clean up in `finally`/teardown; no seeded/demo data; deterministic across `retries: 1`.

| API path / UI flow | Method | Must-have tests |
|---|---|---|
| `POST /proposals/:id/dispose` | POST | approve / edit (payload+reason) / reject (reason); reason-required 400 on edit/reject; RBAC 403 without `proposals.dispose`; tenant isolation (org B → 404, never row); optimistic-lock **409** on stale `updatedAt` via `surfaceRecordConflict`; idempotent re-dispose |
| `GET /proposals`, `GET /proposals/:id` | GET | list/detail returns `updatedAt`; org-scoped (org B never sees org A); RBAC read `proposals.view` |

**Headline E2E — `propose → dispose → resume → effector`** (drives an area-02 `INVOKE_AGENT` workflow):
- **Auto-approve branch:** confidence ≥ threshold → `auto_approved` (`dispositionBy='rule:threshold'`), **no `proposal.ready`**, the step does not park → downstream effector executes **inline** (assert its observable side effect).
- **Human branch:** over threshold / `alwaysAsk` → `USER_TASK` raised + parked → `POST .../dispose { approved }` → resumes → effector runs; `{ edited }` → effector reads edited payload; `{ rejected }` → effector does **not** run, `disposition_reason` persisted.

**Optimistic-lock 409:** read a proposal, dispose once (rule or first human), replay a stale `dispose` with the old `updatedAt` → 409 structured body → conflict bar.

**Tenant isolation (Critical):** two orgs via `createUserFixture`; seed proposal in org A; org B token → 404/403 (never the row) on dispose, single-read, and list. Cleanup both in teardown.

**RBAC / feature-gate:** token without `agent_orchestrator.proposals.dispose` → 403; token with it → 200.

## Migration & Backward Compatibility

- **Additive only.** No new tables (the `agent_proposals` table is area 01's); this area adds the dispose Command, `DispositionService`, two read routes, one dispose route, two events (`proposal.disposed`, `proposal.ready`), and two ACL features — all net-new ids.
- `disposition_reason` already exists on `AgentProposal` (area 01) — MVP populates it on edit/reject; the future `AgentCorrection` append-only entity is an additive overlay that does not change the column or this contract.
- The threshold→`business_rules` VALIDATION rule swap (growth path) is additive: same `DispositionService` interface and the same `proposal.ready` resume contract; existing auto-approved/edited/rejected rows and stored runs are unaffected.
- Run `yarn generate && yarn db:generate` (review SQL + snapshot — expect *no* schema change for this area) → `yarn typecheck && yarn lint && yarn test`.

## Final Compliance Report

- [x] Module `packages/enterprise/src/modules/agent_orchestrator/`; disposition under `lib/disposition/`.
- [x] Does **not** redefine `AgentProposal` (area 01 owns it) — only transitions rows; FK ids only (`processId`, `runId`).
- [x] Reads via `makeCrudRoute` + `indexer: { entityType: 'agent_orchestrator:proposal' }` + `export const openApi`.
- [x] Dispose via Command + `validateCrudMutationGuard`/`runCrudMutationGuardAfterSuccess` + `enforceCommandOptimisticLock` + `surfaceRecordConflict`; transitions `pending → auto_approved | approved | edited | rejected`; edit applies payload; edit/reject require reason.
- [x] Auto-approve path routes through the audited Command (no raw `em.flush`); `null` confidence fails closed to human.
- [x] Resume contract is a single `agent_orchestrator.proposal.ready { processId, stepId, proposalId }` consumed by area 02's `WAIT_FOR_SIGNAL`; emitted on every terminal verdict.
- [x] Events in `events.ts` (`as const`, past tense); ACL in `acl.ts` + `setup.ts` (`proposals.view`, `proposals.dispose`); `yarn mercato auth sync-role-acls`.
- [x] UI seam: `apiCall*` + `useGuardedMutation` + `buildOptimisticLockHeader`/`surfaceRecordConflict`; i18n via `i18n/`; DS status tokens.
- [x] Integration coverage: auto-approve resume, human approve/edit/reject, 409 optimistic-lock, RBAC, tenant isolation.
- [x] Heavy overlays (full `AgentCorrection`, `business_rules` rule packs, arbitration, guardrails, cockpit) deferred with pointers.

## Changelog

- **2026-06-20:** Created. The MVP disposition-and-proposals area: `disposeProposalCommand` (mutation-guard → optimistic lock → transition → after-success → emit `proposal.disposed`) + `POST /proposals/:id/dispose` with `surfaceRecordConflict`; `DispositionService` inline single-threshold auto-approve (fail-closed on null confidence) else raise `USER_TASK`, called inline by area 02's `INVOKE_AGENT` executor; the single `agent_orchestrator.proposal.ready` resume signal emitted on every terminal verdict and consumed by area 02's `WAIT_FOR_SIGNAL`; `disposition_reason` on edit/reject (full `AgentCorrection` deferred); proposal reads, events, ACL. Conforms to the `00-overview.md` shared-contract freeze.
</content>
</invoke>
