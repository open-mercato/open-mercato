# Deal Briefing Call — Implementation Tracker

**Branch:** `analysis/external-invoke-agent` · **Worktree:** `.claude/worktrees/external-agent-analysis`
**Builds on:** [`.ai/runs/2026-08-12-external-agents/PLAN.md`](../2026-08-12-external-agents/PLAN.md) (the external-agent seam, 24 tasks, DONE)
**Docs:** `apps/docs/docs/framework/ai-assistant/external-agents.mdx`, `.../elevenlabs-voice.mdx`

## The feature

A button on the **company detail page** starts a workflow that briefs the chief of sales by phone and
turns their reply into CRM tasks.

```
[Company page]  "Brief chief of sales" button   detail:customers.company:header
       │  POST /api/workflows/instances { workflowId, initialContext: { companyId, … } }
       ▼
1. sales_call_planner.deal_brief          native · researcher
   reads this company's deals + activities → key facts, risks, what would move each deal forward
       │  outputMapping { brief: "data" }
       ▼
2. sales_call_planner.sales_chief_call    EXTERNAL (ElevenLabs connector) · researcher
   phones the chief of sales, reads the brief, collects what they want done
       │  ← post-call webhook resumes         outputMapping { call: "data" }
       ▼
3. sales_call_planner.task_extractor      native · researcher
   turns the conversation into concrete task actions
       │  outputMapping { plan: "data" }
       ▼
   transition activities:  UPDATE_ENTITY × ensure_task   +   EMIT_EVENT → notification subscriber
       ▼
      END
```

## Decisions taken before any code

- **Task creation: an IDEMPOTENT command in this module** (user decision, 2026-08-13).
  `customers.interactions.create` is NOT on the `UPDATE_ENTITY` allowlist and
  `packages/core/src/modules/customers/workflows.ts:10-28` is a written policy against ever adding a CREATE
  command there — *"CREATE does not converge: a retry after a partial failure, or a trigger storm, turns one
  business event into N records that nobody asked for."* `UPDATE_ENTITY` has no idempotency key and retries
  3× by default, so the policy is correct.
  This module therefore registers its OWN workflow-safe command whose id is DETERMINISTIC —
  `uuidv5(`${instanceId}:${stepId}:${index}`)` — and which calls `customers.interactions.create` with that
  id. A retry rewrites the same row instead of minting a second task, which answers the policy's objection
  rather than overriding it. No change to the customers module, no maintainer sign-off needed.
- **A "task" is a `CustomerInteraction` with `interactionType: 'task'`** (`customers/data/entities.ts:568`),
  not the workflows module's `UserTask`. `UserTask` is a workflow-control construct that BLOCKS the run;
  these are fire-and-forget outputs a salesperson acts on later, in the CRM where they work.
- **Notifications: `EMIT_EVENT` + a subscriber in this module** calling `notificationService.create`.
  No activity type creates an in-app notification today and `notificationService` is a DI call, so this is
  the additive route that needs no core change.
- **Agent 3 is a RESEARCHER, not a proposal agent**, because the user asked for the actions to land in
  context and be executed by transition activities. (A proposal agent would route them through
  disposition → effector instead, gaining a review gate; noted as an alternative, not built.)
- **The definition ships as JSON seeded by `setup.ts`**, not `defineWorkflow`:
  `packages/shared/src/modules/workflows/types.ts:26-32` has no `INVOKE_AGENT` in its `ActivityType` union
  and `CodeWorkflowDefinitionData` has no `contextSchema`. JSON is the only route that expresses this.
- **Module location: `apps/mercato/src/modules/sales_call_planner/`** — a composed vertical feature, not a
  platform capability, so not `packages/core`; and not a provider package, because the ElevenLabs connector
  already occupies that slot and is REUSED rather than duplicated. `agent_examples` is the precedent.
- **Agent 1 scopes deals via `customers.get_company { includeRelated: true }`** (pulls deals, activities,
  tasks) — `customers.analyze_deals` has NO `companyId` filter (`deal-analyzer-pack.ts:58-81`), so no core
  tool change is needed.

## Status legend

`TODO` · `WIP` · `DONE` · `BLOCKED`

## Progress

| # | Task | Status | Commit |
|---|---|---|---|
| B1 | Module scaffold: `index.ts`, `acl.ts`, `setup.ts`, validators, i18n (5 locales), registration | DONE | `4ab48d6ab` |
| B2 | The three agents: two native researchers + one external voice agent on the ElevenLabs connector | TODO | |
| B3 | Idempotent `ensure_task` command + `registerWorkflowSafeCommands` + tests | TODO | |
| B4 | Notification subscriber: `EMIT_EVENT` → `notificationService.create` | TODO | |
| B5 | The workflow JSON definition + idempotent seeding from `setup.ts` | TODO | |
| B6 | Company-page widget: the button, its ACL gate, and run status | TODO | |
| B7 | End-to-end verification + integration coverage | TODO | |

---

## Task detail

### B1 — module scaffold

`apps/mercato/src/modules/sales_call_planner/` modelled on `apps/mercato/src/modules/agent_examples/`.

- `index.ts` — `ModuleInfo`.
- `acl.ts` — one feature, `sales_call_planner.brief.run`, gating the button. Add to `setup.ts`
  `defaultRoleFeatures` for admin + the sales personas; note existing tenants need
  `yarn mercato auth sync-role-acls`.
- `data/validators.ts` — the zod OUTCOME schemas for agents 1 and 3, and the ensure-task command input.
  Agent OUTCOME schemas MUST be the ENVELOPE (`z.object({ kind: literal('researcher'), data: … })`) or the
  agent silently vanishes from the workflows context ledger.
- `i18n/{en,de,es,pl,ko}.json` — **five** locales; `ko.json` holds English placeholders elsewhere in the
  repo, so an English string is the correct fill. Sort-order sensitive.
- Register in `apps/mercato/src/modules.ts` inside the existing
  `enterpriseModulesEnabled && enterpriseAgentsEnabled` block (it depends on `agent_orchestrator` and
  `agent_elevenlabs`).

### B2 — the three agents

- `sales_call_planner.deal_brief` — `defineAgent`, researcher, tools
  `customers.get_company` (+ `customers.list_deals`, `customers.list_activities`,
  `customers.list_pipeline_stages` as needed — all read-only, all `isMutation: false`). Output: per-deal
  facts, risk, and a recommended next move, plus a short spoken-form summary the voice agent can read.
- `sales_call_planner.sales_chief_call` — `defineExternalAgent`, `connectorId` = the ElevenLabs voice
  connector, `agentType: 'researcher'`, mandatory `timeout`, and a **named `profile`** so the ElevenLabs
  agent id / phone number are per-tenant config rather than baked into the definition. OUTCOME must match
  what the connector's `normalize()` produces (`collected`, `reached`, `summary`, `transcript`, …).
- `sales_call_planner.task_extractor` — `defineAgent`, researcher. Input: the brief + the call outcome.
  Output: an array of task actions (`title`, `body`, `dueAt`, `ownerHint`, `dealId?`, `priority?`) plus a
  short rationale. Bounded array length — an unbounded list becomes an unbounded number of CRM rows.

### B3 — the idempotent ensure-task command

- `commands/ensureTask.ts`, registered on the command bus, and declared workflow-safe in a module-root
  `workflows.ts` via `registerWorkflowSafeCommands` with `requiredFeatures: ['customers.interactions.manage']`.
  **MUST NOT set `defaultEnabled`** — that flag is reserved for pre-existing commands, so this ships OFF and
  an admin enables it per tenant in Workflow settings.
- Deterministic id: `uuidv5` over `${workflowInstanceId}:${stepId}:${index}` with a fixed namespace. Same
  inputs ⇒ same id ⇒ a retry rewrites one row.
- Internally calls `customers.interactions.create` through the command bus (audit, undo, index side effects
  all preserved) with `interactionType: 'task'`, `entityId` = the company's `CustomerEntity` id,
  `ownerUserId`, `scheduledAt`, `dealId?`.
- Tests: same inputs twice ⇒ one row; different index ⇒ two rows; a missing company ⇒ a clear failure.

### B4 — notification subscriber

- The workflow's transition emits a module-owned event (declared in `events.ts` with `as const`).
- A subscriber resolves `notificationService` and calls `create` / `createForRole`
  (`packages/core/src/modules/notifications/lib/notificationService.ts:254`), with `linkHref` back to the
  company page and `sourceEntityType`/`sourceEntityId` set.
- Payload discipline: ids and counts, never the transcript or the phone number.

### B5 — the workflow definition

`examples/deal-briefing-workflow.json`, seeded idempotently from `setup.ts` `seedDefaults` — copy the
mechanism from `packages/enterprise/src/modules/agent_orchestrator/lib/seeds.ts:106-120` + its `setup.ts`.

- `contextSchema.input.fields`: `companyId` (text, required), `companyName` (text),
  `chiefOfSalesPhone` (text) — there is no `uuid` field type.
- Three `AUTOMATED` steps carrying the `INVOKE_AGENT` activities, each with
  `signalConfig.signalName: 'agent_orchestrator.proposal.ready'`.
- Outcome routes off each agent step: `researcher` → next, `error` / `guardrailBlocked` → a visible
  failure path. The five handles are fixed.
- **The voice step MUST NOT sit inside a `PARALLEL_FORK` branch** — the engine throws
  `AgentSuspensionUnsupportedError` and the Studio warns. Keep it on the linear path.
- Transition activities after step 3: `UPDATE_ENTITY` × ensure_task, then `EMIT_EVENT`.
  Transition-activity outputs DO persist into `instance.context` (namespaced), unlike AUTOMATED-step
  activity outputs.
- Skeleton to copy: `packages/enterprise/src/modules/agent_orchestrator/examples/refund-triage-workflow.json`.

### B6 — the company-page widget

- Spot `detail:customers.company:header`; copy the shape of
  `apps/mercato/src/modules/agent_examples/widgets/injection/company-research-trigger/widget.client.tsx`
  (button + `useGuardedMutation` + `apiCall` + `useAppEvent` progress), swapping the agent-run POST for
  `POST /api/workflows/instances`.
- Widget metadata: `features: ['sales_call_planner.brief.run']`,
  `requiredModules: ['agent_orchestrator', 'agent_elevenlabs']`.
- Body: `{ workflowId, initialContext: { companyId, companyName, … }, metadata: { entityType:
  'customers.company', entityId: companyId } }`. `metadata.initiatedBy` is overwritten server-side from the
  session — which is what makes the run traceable and what the external-agent ACL check reads.
- Surface the started instance (link to the run) and any immediate failure. `workflows.injection.pending-work`
  is already mounted on this page's footer, so resulting tasks appear without extra work.
- No raw `fetch`; every string via i18n; DS tokens only.

### B7 — end-to-end verification

- The whole chain with a stubbed connector: button → instance → agent 1 → suspend → signed callback →
  agent 3 → tasks created → notification emitted.
- Idempotency: replaying the callback creates no second task.
- The ACL gate: without `sales_call_planner.brief.run` the button is absent; without
  `agent_orchestrator.external_agents.invoke` the voice step fails down `error` rather than dialling.
- Run the full gate: both package test suites, typechecks, eslint, i18n checks.

---

## Notes / decisions log

Append one entry per task as it lands.

- 2026-08-13 — Ground-truth research done before planning; every file path, spot id, route, schema and
  command id in this plan carries file:line evidence in the research report.
- 2026-08-13 — **User decision: the idempotent-command route for task creation** (see Decisions above).
- 2026-08-13 — **B1 done.** ACL feature `sales_call_planner.brief.run`, `dependsOn:
  ['workflows.instances.create']` (the button's only action is that route, so without it the button can only
  403). It deliberately does NOT depend on `agent_orchestrator.external_agents.invoke`: that grant is
  default-off BY DESIGN, and listing it as a dependency would advertise it in the role editor as a
  prerequisite an admin should grant — the opposite of default-off. `employee` (the sales-facing persona)
  gets `brief.run`, so a salesperson can START a briefing while placing the call stays behind the separate
  grant, failing closed on an un-opted-in tenant.
- 2026-08-13 — **B3 CORRECTION to this plan's id formula.** `${instanceId}:${stepId}:${index}` implied one
  invocation per task, but `executeUpdateEntity` runs a transition activity ONCE and the task count is data
  the author cannot know when writing the JSON. So `ensureTaskInputSchema` takes the whole bounded `tasks`
  ARRAY and `index` is the element's position. Consequence: the array is ORDER-SENSITIVE across retries
  (stable in practice — it comes verbatim from a settled agent run in the instance context).
- 2026-08-13 — **B3 security note: `ensureTaskInputSchema` deliberately carries NO `tenantId`/
  `organizationId`.** `executeUpdateEntity` passes the definition's `input` through verbatim and supplies
  scope separately from the instance via `ctx.auth`. Accepting scope in the input would let an authored —
  and AI-draftable — definition name another tenant's ids. B3 MUST read scope from `ctx.auth`. This
  deliberately differs from `customers.deals.update`, whose schema extends `scopedSchema`.
- 2026-08-13 — **B3 owns a mapping the plan did not mention:** `CustomerInteraction.priority` is
  `z.number().int().min(0).max(100)`, NOT an enum. The agent contract uses `low|medium|high|urgent` because
  that is what a model answers reliably and what gets spoken aloud, so B3 converts.
- 2026-08-13 — **B5 correction: `entityId` for a task is `customer_entities.id`, NOT
  `customer_companies.id`** — that is the timeline parent `requireTimelineParentEntity` resolves. The
  workflow context must carry the right one; this plan's `contextSchema` only named `companyId`.
- 2026-08-13 — B5 interpolation roots available: `{{workflow.instanceId}}`, `{{workflow.currentStepId}}`,
  `{{workflow.tenantId}}`, `{{workflow.organizationId}}`, `{{workflow.workflowId}}`, `{{workflow.version}}`,
  plus `{{context.*}}`, `{{env.*}}`, `{{now}}`. The first two are exactly the idempotency-key halves.
- 2026-08-13 — B1: 25 i18n keys seeded across all five locales up front, so B2–B6 need not each touch five
  files. `sales_call_planner.workflows.commands.ensureTask` is the `labelKey` B3 passes to
  `registerWorkflowSafeCommands`.
- 2026-08-13 — B1 added `requires: ['agent_orchestrator','agent_elevenlabs','customers','workflows']` (which
  `agent_examples` omits). Consequence: disabling `customers` or `workflows` now fails `yarn generate` for
  this module with an actionable message rather than a module-not-found at import time.
- 2026-08-13 — **`yarn mercato auth sync-role-acls` has NOT been run.** Existing tenants do not hold
  `sales_call_planner.brief.run`, so the button is invisible on this dev tenant until it is — matters for
  B6/B7.
- 2026-08-13 — Hazards inherited from the external-agent work, all recorded in the sibling tracker:
  `yarn build:packages` is required before a new route is served (the dev server resolves
  `@open-mercato/enterprise` from `dist`); `yarn generate` has been observed deleting committed
  `docker/opencode/**` files in this worktree — check `git status` after every run; a connector edit needs a
  server restart, not HMR; and `apps/mercato/src/modules.ts` is in template-sync's `SYNC_ROOT_FILES`.
