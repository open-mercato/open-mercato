> 🗂️ **Reorg 2026-06-22 · Status: SUPERSEDED (historical).** Decided or replaced by the implementation and the 2026-06-22 OpenCode specs. Kept for provenance only — do not use as a plan. Current: `.ai/specs/agent-orchestrator/00-IMPLEMENTED-BASELINE.md`.

# Integration-Test Coverage — Design Analysis & Template

> **Gap:** GAP-17 · **Priority:** P3 · **Domain:** process/governance (all nine agent-orchestrator specs)
> **Related specs:** all nine `2026-06-19-agent-*.md` sub-specs, `2026-06-19-agent-orchestrator-conventions.md` (normative), `.ai/qa/AGENTS.md`, `.ai/skills/om-integration-tests/SKILL.md`
> **Scope:** the cross-cutting process gap that 8 of 9 specs omit — the repo-mandated **Integration Coverage** section ("every new feature MUST list integration coverage for all affected API paths and key UI paths"; tests ship with the change). This gap defines the standard section template + a central coverage matrix so each spec becomes mergeable under the house rule, without rewriting the specs themselves.

## 1. Gap statement

Repo rule (root `AGENTS.md`, `.ai/specs/AGENTS.md`): *"For every new feature, the spec MUST list integration coverage for all affected API paths and key UI paths"* and *"implement the integration tests defined in the spec as part of the same change."* Only **compliance** (`agent-decision-transparency-and-ai-act.md`) currently carries an explicit "Integration coverage required for…" line (its Final Compliance Report). The other eight specs assert tenancy/RBAC/optimistic-lock invariants and acceptance criteria but never enumerate the **executable integration tests** that prove them, nor where those `.spec.ts` files live. That is a merge-blocking process gap under the house rule: each spec ships entities, custom Command writes, portal/cockpit surfaces, and cross-tenant claims that are untested-on-paper. GAP-17 closes the gap by (a) defining one reusable `## Integration Coverage` section template, and (b) supplying a per-spec coverage list + central matrix the implementers paste in and execute. It is a coverage/process design, not an algorithm.

## 2. Architectural drivers

| Driver | Why it dominates |
|--------|------------------|
| **Repo QA-rule compliance** | The "list coverage + ship tests" rule is normative and gates merge. 8/9 specs violate it today. The section template is the cheapest path to compliance across all of them. |
| **Multi-tenant isolation proof (PARAMOUNT)** | Every spec carries a Critical/High cross-tenant risk row (worker reads another tenant's task, portal returns another subject's decision, context leaks cross-tenant data). These are asserted but unproven. A **cross-tenant denial test per entity surface** is the load-bearing must-have — invariants this severe cannot be self-asserted. |
| **Self-contained fixtures / CI stability** | `.ai/qa` mandates: tests independent, data-independent, deterministic across retries; fixtures created in setup (prefer API), cleaned in `finally`/teardown; no reliance on seeded/demo data. The template must force this so the suite stays green in CI (`yarn test:integration`, Playwright, `timeout 10s`, `retries 1`). |
| **Coverage completeness** | Each spec's custom Command writes (`dispose`, `claim/heartbeat/result/input`, `promote`, `revoke`, contest) bypass the automatic CRUD guard/lock path — exactly the writes most likely to regress and least covered by generic CRUD sweeps. They need bespoke happy-path + conflict + RBAC tests named explicitly. |
| **Conflict / optimistic-lock verification** | Optimistic locking is default-ON and command-enforced on every editable entity; specs promise 409 + `surfaceRecordConflict`. A stale-write→409 test is required wherever an editable entity has a custom write. |

## 3. Approach — one section template + one central matrix

**(a) Standard `## Integration Coverage` section** appended to each of the eight missing specs (and tightened on compliance). Copy-paste template:

```markdown
## Integration Coverage

> Per repo rule, this feature ships executable Playwright integration tests with the change.
> Location: `packages/core/src/modules/agent_orchestrator/__integration__/TC-AGENT-<AREA>-<NNN>.spec.ts`
> Helpers: `@open-mercato/core/helpers/integration/{auth,api,authFixtures,generalFixtures}` (+ this module's
> `__integration__/helpers/agentFixtures.ts`). All fixtures created in setup (prefer API), cleaned in `finally`/teardown.
> No seeded/demo data; deterministic across retries; rely on global config (`timeout 10s`, `expect.timeout 10s`, `retries 1`).

| API path / UI flow | Method | Must-have tests |
|--------------------|--------|-----------------|
| `<endpoint or page>` | `<verb>` | happy path; RBAC/feature-gate (403 without `<feature>`); tenant-isolation (org B cannot read/act on org A); conflict/optimistic-lock 409 (editable only); <domain E2E> |

**Tenant-isolation harness (mandatory for every entity surface):** create two orgs/tenants
(`createUserFixture` per org), seed a record in org A, assert org B's token gets 404/403 (never the row)
on read, custom write, and CRUD list. Cleanup both in teardown.
```

**(b) Central coverage matrix** (§4) maps every API path + key UI flow across the nine specs to its must-have tests, so reviewers can verify "all affected paths" at a glance and implementers know the full surface. Test files live module-local under `agent_orchestrator/__integration__/` (cockpit UI flows test against the injected `workflows`/My-Tasks surfaces; portal flows under the portal route). Category code: `AGENT` (sub-areas: `ORCH`, `IDN`, `DISP`, `TRACE`, `GUARD`, `CTX`, `COMPLY`, `LIFE`, `COCKPIT`).

## 4. Per-spec coverage list (the matrix)

**Orchestration** (`agent-orchestration-step-and-proposal.md`) — entity `AgentProposal` (editable):
- `POST /api/agent_orchestrator/proposals/:id/dispose` — happy (approve/edit/reject); RBAC (`agent_orchestrator.proposal.dispose`); **tenant-isolation** (org B 404 on org A proposal); **optimistic-lock 409** on stale `updatedAt` via `surfaceRecordConflict`; edit/reject persists an `AgentCorrection`.
- `GET /api/agent_orchestrator/proposals` (CRUD) — list returns `updatedAt`; org-scoped; RBAC read.
- **E2E `propose→dispose→effector`**: seed an `INVOKE_AGENT`/`EXECUTE_FUNCTION` proposal → human disposes via API → assert downstream effector activity ran (and `AgentCorrection` written on edit/reject). The headline E2E.

**Identity** (`agent-identity-and-on-behalf-of.md`) — `AgentPrincipal`, `AgentDelegationGrant` (editable):
- `POST /api/agent_orchestrator/identity/token` — client-credentials → scoped JWT bound to principal; happy + invalid-credential rejection.
- `POST /api/agent_orchestrator/identity/grants/:id/revoke` — happy (sets `revokedAt`); **optimistic-lock 409**; revoked token denied on next write; **tenant-isolation**.
- `GET /api/agent_orchestrator/audit/by-instigator/:humanUserId` — returns actions caused directly + via agents (`ActionLog.onBehalfOfUserId`); org-scoped.
- **No-bypass invariant test** (release gate): assert no `kind='agent'` actor appears on a write that did not route through the audited Command path.

**Dispatch** (`agent-dispatch.md`) — `AgentTask` (editable), `AgentBinding`, `AgentTaskLease`, `AgentTaskEvent`:
- **Worker E2E `claim→heartbeat→result`**: `POST .../dispatch/claim` (long-poll, issues lease) → `POST .../tasks/:id/heartbeat` (extends lease) → `POST .../tasks/:id/result` (accepted only with active lease; **optimistic-lock 409** on stale; expired-lease result rejected).
- `POST .../tasks/:id/input` — answers an `input_required` task (HITL/`USER_TASK` bridge).
- `POST .../a2a/tasks`, `POST .../a2a/callbacks/:id`, `GET /.well-known/agent-card.json` — inbound A2A → `AgentTask(origin='inbound_a2a')`; HMAC/scheme auth.
- `GET .../tasks`, `GET .../bindings`, `GET .../metrics` (CRUD) — org-scoped; RBAC.
- **Tenant-isolation (Critical):** a worker authenticated for org B can **never** claim/read org A's task or payload — explicit cross-tenant denial test.

**Trace** (`agent-trace-eval-capture.md`) — `AgentRun` (editable), append-only `AgentSpan`/`AgentToolCall`/`AgentEvalResult`, `AgentEvalCase`/`AgentEvalAssertion` (editable):
- `POST /api/agent_orchestrator/trace/ingest` — **ingest idempotency**: same `(runtime, externalRunId)` POSTed twice upserts one `AgentRun`, appends spans once; HMAC-verified (bad signature → 401).
- `POST .../corrections` — writes `AgentCorrection`, auto-drafts an `AgentEvalCase`.
- `POST .../eval-cases/:id/approve` — engineer approval; **optimistic-lock 409**; RBAC.
- `GET .../runs`, `GET .../runs/:id`, `GET .../agents/:id/metrics`, `GET .../eval-cases/export` — org-scoped; export feeds the lifecycle gate.
- **Tenant-isolation** on every read.

**Guardrails** (`agent-runtime-guardrails.md`) — `AgentGuardrailCheck` (append-only), `AgentGuardrailSet`:
- Service-level (`guardrailService.checkInput/checkOutput`) via a thin harness route or `INVOKE_AGENT` E2E: **block** path (output-schema/tool-scope violation → `result='block'`, run halted, no effector); **warn** path (`result='warn'`, proceeds, recorded). Assert `agent_orchestrator.guardrail.tripped` emitted with `guardrailSetVersion`.
- `GET` guardrail checks (CRUD, `indexer`) — org-scoped; RBAC (`agent_orchestrator.guardrail.read`).
- **Tenant-isolation** on check reads.

**Context** (`agent-context-knowledge-plane.md`) — `AgentContextBundle` (append-only):
- `ContextResolver.assemble` via `INVOKE_AGENT` E2E (no public write route): one run → exactly one bundle recording `routedSources/prunedSources/tokenBudget/tokensUsed/sources`; **redaction** applied before pack, `redactionApplied` recorded.
- `GET` context bundles (CRUD, `indexer`) for the trace UI — org-scoped.
- **Tenant-isolation (High):** assembled context never contains cross-tenant data — no-cross-tenant assembly test.

**Compliance** (`agent-decision-transparency-and-ai-act.md`) — `AgentDecisionRecord` (append-only), `AgentContestCase` (editable), `AgentFairnessMetric`:
- **Portal `explanation+contest` E2E**: `GET /[orgSlug]/portal/decisions/:id` (`requireCustomerAuth`/`requireCustomerFeatures`) returns the subject's own plain explanation only → `POST /[orgSlug]/portal/decisions/:id/contest` opens an `AgentContestCase` (Command + guard) → triggers review workflow with **mandatory human** resolution; overturn writes `AgentCorrection`; resolve enforces **optimistic-lock 409**.
- `GET .../compliance/dsar/:subjectId`, `POST .../compliance/erasure/:subjectId` (audit-preserving tombstone), `GET .../compliance/fairness` — feature-gated; org + subject scoped.
- **Tenant-isolation (Critical):** no portal/DSAR/erasure/fairness endpoint returns cross-tenant rows; a claimant cannot read another subject's decision.

**Lifecycle** (`agent-deployment-and-regression-gating.md`) — `AgentRelease`, `AgentBudget` (editable):
- **Promote-gate E2E**: `POST .../lifecycle/releases/:id/promote` — promotion to `active` runs the eval harness (`EvalGateRunner`) over the trace export; **blocks (409/422) on gate failure / safety-assertion regression**; happy promote on pass; **optimistic-lock 409** on stale; RBAC; Command-path audited.
- `GET .../lifecycle/releases`, `.../releases/:id`, `.../budgets?scope=` (CRUD) — return `updatedAt`; org-scoped.
- Budget breach E2E: `onExceed='block'` refuses dispatch and emits `agent_orchestrator.budget.exceeded`.
- **Tenant-isolation** on releases/budgets.

**Cockpit** (`agent-operations-ui.md`) — UI-only, no new entities, writes through sibling APIs:
- **Operator disposition card UI**: open a `USER_TASK` proposal in the four-verb caseload → Approve/Edit/Reject routes to `dispose` via `useGuardedMutation`; 409 surfaces via the conflict bar; states render with DS status tokens.
- **Engineer trace inspector UI**: open a run → spans/tool-calls/output/eval panel render from `runs/:id`.
- **Admin fleet KPIs UI**: KPI tiles render from `/agents/:id/metrics`.
- **RBAC/perspective scoping**: feature-gated Admin/Operator/Engineer perspectives never leak cross-operator/cross-tenant tasks (perspective + upstream `organization_id` scoping). Loading/error boundaries covered.

## 5. Recommendation — add the section to each spec; ship the reusable template

Append the **§3(a) `## Integration Coverage` section** to all eight specs lacking it and tighten compliance's existing line into the same table form, then drop the **§4 matrix rows** into each spec's section. Make the **tenant-isolation denial test mandatory for every entity surface** (the paramount driver) and require the named **domain E2E per spec** (propose→dispose→effector; claim→heartbeat→result; ingest-idempotency; block/warn; promote-gate; portal explanation+contest). Enforce self-contained fixtures + teardown via the template's preamble so the suite is CI-stable under the standard Playwright config. Tests land module-local under `packages/core/src/modules/agent_orchestrator/__integration__/` with the `TC-AGENT-<AREA>-<NNN>` naming, and ship **in the same PR** as each spec's implementation per the house rule — not as a follow-up.

**Explicitly NOT recommended:** deferring tests to a later "QA pass," relying on the generic CRUD sweep for the custom Command writes, or self-asserting tenant isolation without an executable denial test — all violate the repo rule or leave the load-bearing invariant unproven.

## 6. Effort, dependencies

**Effort: M.** The template + matrix is **S** (this document). Authoring the ~30–40 `.spec.ts` files across nine specs is **M**, but distributed: each spec owner ships its slice with its implementation, reusing the shared helpers + a small module-local `agentFixtures.ts` (principal/grant/proposal/task/release fixtures). No new infra.

**Dependencies:**
- **`.ai/qa` harness + `@open-mercato/core/helpers/integration/*`** — the fixture/auth/API helpers and Playwright config. **Hard dep.**
- **A module-local fixture helper** (`agentFixtures.ts`) — net-new, small; the only new code this gap requires before tests can be written.
- **Two-org/two-tenant setup** via `createUserFixture` per org — the basis of every isolation test.
- **Each sibling spec's implementation** — tests are written against real routes/entities, so they land with (not before) each feature.

## 7. Deliverables + Acceptance

**Deliverables**
1. The reusable `## Integration Coverage` section template (§3a) — copy-paste into each spec.
2. The central coverage matrix (§4) — per-spec API paths + UI flows + must-have tests.
3. A module-local `__integration__/helpers/agentFixtures.ts` (principal/grant/proposal/task/release/decision fixtures + two-org isolation helper) re-exporting central helpers.
4. The `TC-AGENT-<AREA>-<NNN>` naming + module-local `__integration__` placement convention.

**Acceptance**
- All nine specs carry a populated `## Integration Coverage` section listing every affected API path and key UI flow.
- Every entity surface has an executable **cross-tenant denial test**; org B can never read/act on org A's rows.
- Every custom Command write has happy-path + RBAC/feature-gate + (editable → optimistic-lock 409) tests; the named domain E2E exists per spec (propose→dispose→effector, claim→heartbeat→result, ingest-idempotency, block/warn, promote-gate, portal explanation+contest).
- Tests are self-contained (fixtures in setup, cleanup in teardown), data-independent, and green under `yarn test:integration` with the default Playwright config (no per-test timeout/retry overrides).
- Tests ship in the same PR as each spec's implementation; no `.spec.ts` files placed under `.ai/qa/tests`.

## Changelog

- **2026-06-19:** Initial GAP-17 design analysis. Defined the reusable `## Integration Coverage` section template and a central per-spec coverage matrix (orchestration, identity, dispatch, trace, guardrails, context, compliance, lifecycle, cockpit) to close the repo-mandated integration-coverage gap that 8 of 9 specs omit. Made cross-tenant denial tests mandatory per entity surface and required a named domain E2E per spec; anchored fixtures/cleanup/placement to `.ai/qa/AGENTS.md` + `om-integration-tests`, with tests shipping in the same PR as each feature.
