# Agent Orchestrator — Agent Guidelines

Use this enterprise module to run **propose-only** AI agents: an agent always returns a typed, validated `AgentResult` (`researcher | proposal`), persists an `AgentRun` (+ an `AgentProposal` for proposal results), and never writes domain state directly — every write flows through `proposal → disposition → effector (command)`. Two runtimes coexist behind one registry and one `agentRuntime.run()`; trace/eval/guardrail/context/identity overlays wrap every run.

See `.ai/specs/2026-06-22-opencode-file-defined-agents.md` (+ `-phase0-findings.md`) for the file-agent design, and `.ai/specs/enterprise/agent-orchestrator/` for the baseline, identity, trace-eval, guardrails, and context specs.

## Agent Taxonomy (spec `2026-08-11-agent-taxonomy.md`)

Two vocabularies, deliberately separate — conflating them is what this spec set out to fix.

| Vocabulary | Where it lives | Values |
|---|---|---|
| **`agentType`** — an AUTHORING declaration: what the agent is FOR | `defineAgent({ agentType })` → `AgentRegistryEntry.agentType` → `agent_runs.agent_type` (nullable) | `researcher` · `decision_maker` · `action` |
| **`resultKind`** — the RUNTIME fact: what came back | `defineAgent({ result: { kind } })`, OUTCOME.md frontmatter, `agent_runs.result_kind` | `researcher` (`{ kind, data }`) · `proposal` (`{ kind, proposal }`) |

- The two MAY disagree — a `decision_maker` that found nothing returns a researcher-shaped result. That is a finding, not a crash; never assert equality between them.
- `agentType` is NOT structural: `decision_maker` and `action` return the SAME `{ options[], rationale? }` envelope. What the type buys is a property an agent has BEFORE it runs — listable, filterable, and assertable in an eval.
- **`researcher`/`proposal` replaced `informative`/`actionable` everywhere, wire values included** — the workflow outcome handle (`outcome:researcher`), the disposition envelope kind, `agent_runs.result_kind`, and OUTCOME.md `kind:`. `actionable` did NOT split into the two proposing types: a runtime result kind cannot know an authoring fact, so ONE kind means "a proposal came back". `__tests__/agent-taxonomy-rename.test.ts` fails if either retired word reappears as a wire value.

### Action vocabulary

```
effective = (listWorkflowSafeCommands() ∪ workflowActivityTypes()) ∩ agent.allowedActions
```

- The union is the OUTER limit — effects the platform already runs under its own per-tenant, feature-checked gates. An action agent introduces **no new effect surface**.
- `allowedActions` on the agent definition **narrows only, never widens**. An entry naming something outside the catalogue is DROPPED with a `logger.warn` at registration (`narrowAllowedActions` in `lib/runtime/actionVocabulary.ts`), because a silently-dropped permission reads as a granted one. Omitting it means "the catalogue"; an EMPTY list after narrowing means "nothing".
- Narrowing runs at the END of the registry load (`ensureAgentsLoaded`), not inside the synchronous `defineAgent`: the catalogue lives in core `workflows`, an OPTIONAL peer reachable only through a dynamic import. An UNAVAILABLE catalogue leaves the declaration untouched rather than emptying it — the disposition-time check already fails closed.
- **Checked AGAIN before the effect** (`executeProposal` → `isEffectWithinVocabulary`), never only at registration: an agent registered before a tenant revoked a safe command must not have a stale proposal execute.
- The `action_vocabulary` eval scorer makes the same violation VISIBLE — a blocked effect leaves nothing an operator would look at, and an agent that keeps proposing what it may not run is a prompt defect.
- On the wire (`GET /agents`, `GET /agents/:id`) `allowedActions: null` means NO narrowing was declared (the whole catalogue); an EMPTY array means nothing survived the intersection. Render them differently — collapsing the two shows a fail-closed agent as permissive. Same rule for `agentType: null` = undeclared, never `researcher`.

### Disposing an option set (Caseload surfaces)

- **NEVER derive the option a verdict runs.** `selectedOptionId` is what the human picked. A **disposed** proposal replays its own `selected_option_id`; a **single-option** proposal preselects it (no choice exists); a **multi-option** proposal preselects NOTHING and Approve/Edit stay disabled. `leadProposalOption` is for ranking and display only — it MUST NOT reach a dispose body (`__tests__/caseload-option-set.test.tsx` fails if it reappears in either caseload page).
- The ranked set renders through the `ProposalOptionList` client island (a `radiogroup` with arrow/Home/End roving selection) — in the queue's decision pane and inside `ProposalCard`. `DataTable` stays the queue LIST; the option set is not a table. Reason dialogs go through the `DisposeDialog` island (Cmd/Ctrl+Enter submits, Escape cancels) so the queue and the detail page cannot drift.
- **One disposition→status mapping**: `components/proposalCaseStatus.ts`. It is EXHAUSTIVE and its default arm is `unknown`, never `approved` — `none_proposed` is the agent's own terminus (neutral badge + an EmptyState saying so), not a verdict anyone gave. It appears in the caseload `all` segment; do not hide it again.
- `auto_disposition_block: 'near_tie'` MUST be EXPLAINED wherever the proposal renders (queue pane, proposal card, trace) — silence reads as "the threshold simply was not met". `disposition_by` is `rule:threshold` for an auto-approval, so render that as a rule, not as a user id.
- An operator EDIT applies to the SELECTED option only (`deriveActionEdits(payload, selectedOptionId)` → `replaceOptionActions`); every other option, both rationales and the confidences survive verbatim, because an override is a training signal only while the rest of the agent's testimony does.

## The Process Model (spec `2026-09-06-business-process-workflow-unification.md`)

**One durable execution, one lifecycle owner: `WorkflowInstance`.** The module used to
ship two execution engines — an `AgentProcessRun` lifecycle beside the workflow
instance's, and a `target_type = 'agent'` path that skipped the engine entirely — and
every awkward thing in it followed from that split. Do not reintroduce either.

| Record | Table | What it is |
|---|---|---|
| `ProcessDefinition` | `process_definitions` | **Authored**: what CAN happen. Points at a `WorkflowDefinition`; never restates its execution semantics |
| `WorkflowInstance` | core `workflows` | **THE execution.** The only lifecycle owner: status, retry, waiting, cancellation, context |
| `ProcessInstance` | `process_instances` | **Projection**: the business-facing read model of one instance. Decides nothing |

- **Every process points at a workflow.** There is no agent target. Choosing **Single
  agent** in the form MATERIALIZES a real `START → INVOKE_AGENT → END`
  `WorkflowDefinition` (`lib/processes/materializeAgentWorkflow.ts`) through core's
  `workflowDefinitionAuthoring` DI service — a normal row, visible and editable in the
  Studio, stamped `metadata.generatedBy`. The simple UX survives; the second engine does
  not. The generated workflow is the SINGLE source of truth for its own agent config and
  grant: the definition stores no copy, and the form reads both back from it.
- **Execution identity belongs to the WORKFLOW.** Core provisions the least-privilege
  principal from `WorkflowDefinition.grantedFeatures`; this module provisions none of its
  own (`lib/tasks/executionPrincipal.ts` and the `task:<id>` principals are gone).
  `ProcessInstance.triggeredBy` records the INVOKER — provenance, never an ACL identity.
  *Permission to start a process ≠ the permission set the process runs with.*
- **`ProcessInstance.status` is DERIVED** (`lib/processes/processProjection.ts`) and is
  never independently transitioned. The only status this worker may write is a terminal
  failure BEFORE any instance exists. There is exactly one authoritative status in the
  system and it lives on `workflow_instances`.
- **Two routes, not one tabbed page.** `/backend/processes` lists running executions;
  `/backend/processes/definitions` authors definitions. They answer "what is happening
  now" versus "what can happen".
- **Idempotency is claimed BEFORE the workflow exists.** `processes.startExecution`
  inserts the `ProcessInstance` row (with `workflow_instance_id` still null) and the
  partial-unique `process_instances_idempotency_uq` rejects the loser — so one
  `(definition, key)` can never produce two `WorkflowInstance`s, however many callers
  race. The worker then starts the one durable execution.
- **`encryption.ts` keys `defaultEncryptionMaps` by a PLAIN STRING `entityId` that nothing
  type-checks.** Rename an entity or a column without moving its map entry and `input`,
  `input_defaults`, `failure_reason` and `subject_title` silently persist in PLAINTEXT
  while existing rows become undecryptable, in green CI.
  `__tests__/encryption-map-entity-ids.test.ts` resolves every entry against the ORM
  metadata; keep it passing rather than deleting the failing row.
- **Migrations are SQUASHED, not stacked**: one current-state create-schema file
  regenerated from `data/entities.ts`. Regenerate the file AND
  `.snapshot-open-mercato.json` together; never run `db:migrate` to quiet the generator.
  Data rewrites that touch CORE `workflows` tables cannot be absorbed by a create-table
  and are carried over verbatim, `to_regclass`-guarded. Tests resolve the squash by shape
  (`__tests__/helpers/squashMigration.ts`), never by filename.
- **Triggers are ONE declared list** (`process_definitions.triggers` jsonb,
  `processTriggerSchema`, `.max(20)`): `schedule` | `event` | `manual`. Every kind
  converges on `agent_orchestrator.processes.startExecution`, which ends in
  `workflowExecutor.startWorkflow`. **Triggers start PROCESSES, never agents.** The event
  arm's `config` persists ARRAYS of typed objects (`filterConditions: [{field,operator,value?}]`,
  `contextMapping: [{targetKey,sourceExpression,defaultValue?}]`) — NOT maps; modelling
  them as `z.record` drops every stored config. Read the column through
  `lib/tasks/triggers.ts`, never `JSON.parse` by hand.
- **A definition with no `manual` trigger CANNOT be started by hand** —
  `POST /processes/:id/executions` 403s, and the trigger's own `requireFeatures` is
  checked on top of `processes.run`.
- **The event dispatcher probes the GIN index, it does not scan.**
  `candidateEventPatterns(eventName)` enumerates the exact id plus every trailing-wildcard
  prefix that could match, and each is one `triggers @> '[{"kind":"event","eventPattern":…}]'`
  containment probe against `process_definitions_triggers_gin` (`jsonb_path_ops`).
  `matchesEventPattern` is re-applied in memory as the correctness backstop.
- **Milestones are BUSINESS EVENTS, never step aliases.** The definition declares a
  VOCABULARY (`process_definitions.milestones` jsonb — `{ key, label, order }`), a
  workflow step declares `milestone: '<key>'` in its config, the engine emits
  `workflows.instance.milestone_reached` when that step completes, and
  `process_instances.milestones_reached` records what was announced (idempotent per key).
  That indirection is the point: a stage can be reached after a `PARALLEL_JOIN`, after a
  retry, or after ten steps, and renaming a step cannot change what a business reader
  sees. `collectMilestoneIssues` reports a declared key no step emits as a **warning** in
  the `WorkflowValidationIssue` shape core already emits — never an error, because a
  definition mid-edit must stay saveable — and reports NOTHING when the workflow cannot be
  resolved, because "unknown" is not "missing". Read through `lib/tasks/milestones.ts`,
  never `JSON.parse` by hand.
- **The outcome is OPTIONAL BY DECISION** — `process_instances.outcome_type`/`outcome_id`/
  `outcome_label`, all nullable, stamped ONCE on the terminal transition and read through
  `lib/tasks/outcome.ts`. A research or monitoring process produces nothing and is a
  perfectly valid completion, so an absent outcome is NEVER a missing write. It belongs to
  the BUSINESS EXECUTION's completion, never to a single agent run: when an agent finishes,
  a proposal's record does not exist yet. FK-id + snapshot: no FK, no ORM relation, and the
  `label` is a SNAPSHOT so the reference stays readable when the owning module is gone.
  Plaintext like `subject_label`, not encrypted like the free-text `subject_title`.
  Deliberately **NOT independently undoable** — do not invent an undo for it.
- **Nothing derives an outcome; the terminating source DECLARES one** under an `outcome`
  key in the finished workflow instance's final context.
- **The outcome LINK is resolved server-side and soft-optionally.**
  `lib/tasks/outcomeLink.ts` reads the `<module>:<entity>` prefix and matches the owning
  module's OWN declared `/backend/**/[id]` route through a local `tryResolve` over
  `tryGetModules()`, in try/catch. Absent module, unbootstrapped registry or no matching
  route ⇒ `null` href ⇒ the label snapshot renders as plain text. Never guess a URL.

## Runtime Selection

| Runtime | When to use | Authoring |
|---------|-------------|-----------|
| `in-process` | Simple typed agents authored as code; fastest path; supports `delegate_agent` sub-agents | `defineAgent` in `ai-agents.ts` (Vercel AI SDK object mode) |
| `opencode` | Agents that need skills, sub-agents, or sandboxed scripts authored as files | File-defined `agents/<id>/` on the OpenCode runtime |

## Always

1. **MUST keep every agent propose-only** — an agent returns `{ kind: 'researcher', data }` or `{ kind: 'proposal', proposal }`; domain writes happen ONLY through `proposal → disposition → effector`, never inside the agent or a tool.
2. **MUST dispatch through DI, not lib calls** — resolve `agentRuntime`, `dispositionService`, `guardrailService`, etc. via `container.resolve(...)`; `agentRuntime.run()` switches on `entry.runtime`. Never import and call the runners directly.
3. **MUST persist writes through the Command path** — every domain mutation an agent proposes is applied by an effector via the command bus (`executeProposal.ts`), so audit/undo/cache/events/index stay consistent. Agent principals are `kind='agent'` `auth.User`s whose writes are attributed like a human's.
4. **MUST gate disposition inline** — after `agentRuntime.run()`, `DispositionService` decides: `confidence ≥ threshold` → audited `auto_approved`; otherwise raise a `workflows` `USER_TASK`, park at `WAIT_FOR_SIGNAL`, and resume on `agent_orchestrator.proposal.ready`. Fail closed: missing/null confidence is treated as below threshold.
5. **MUST keep the two propose-only gates intact for file agents** — (1) the generated OpenCode agent file's read-only `tools` allowlist + `permission` deny block, and (2) the per-run session-token ACL re-checked on every MCP call. `loadFileAgents` rejects any agent declaring an `isMutation:true` tool. Never weaken either gate.
6. **MUST keep OUTCOME schemas in the supported JSON-Schema subset** — `object`/`array`/`string`/`number`/`integer`/`boolean`/`nullable`/`const` only. Unsupported keywords (`oneOf`/`anyOf`/`$ref`/`format`/…) fail generation loudly (`lib/sdk/outcomeSchema.ts` compiles to Zod).
7. **MUST run `yarn generate` after editing any `agents/<id>/` file** — it re-emits the committed manifest (`generated/file-agents.generated.ts`) and the container artifacts under `docker/opencode/{agents,skills}/`. Then **restart OpenCode** (`docker compose --project-directory . -f starters/docker/compose.infra.yml up -d opencode`) — hot-reload is not guaranteed.
8. **MUST scope every query by `tenantId` + `organizationId`** — runs, proposals, traces, evals, guardrail checks, context bundles, and principals are all tenant-scoped; never expose cross-tenant rows.
9. **MUST treat trace/eval/guardrail/context rows as append-only** — `AgentSpan`, `AgentToolCall`, `AgentEvalResult`, `AgentGuardrailCheck`, `AgentContextBundle` (and `AgentRun` once terminal) are immutable audit records; they omit `updated_at`/`deleted_at`. Insert new rows, never mutate.
10. **MUST reuse `agent_orchestrator.agents.run`** for new file-agent MCP tools' `requiredFeatures` — do not add new ACL features for the file-agent path. **Exception — network egress:** the `web_search`/`web_fetch` tools gate on a dedicated default-off `agent_orchestrator.web_search` feature (spec 2026-07-11-agent-web-search-tool) so web access is an explicit, separately-grantable capability. Any *new* egress/side-effecting tool should follow that precedent (dedicated default-off feature), not reuse `agents.run`.
11. **MUST add new `acl.ts` features to `setup.ts` `defaultRoleFeatures`** and run `yarn mercato auth sync-role-acls` so existing tenants receive the grant.

## Ask First

- Ask before changing the OUTCOME → Zod compiler's supported subset, the committed manifest shape (`FileAgentDescriptor`), or the MCP tool ids (`submit_outcome`, `load_skill`, `run_skill_script`, `delegate_agent`) — these are contract surfaces.
- Ask before generating native `.opencode/tool/*` custom tools that run OUTSIDE the MCP/sandbox path — they bypass the per-call ACL gate and break propose-only.
- Ask before changing disposition threshold semantics, the auto-approve vs `user_task` boundary, or the no-bypass flush-time enforcer (`agentNoBypassSubscriber`).
- Ask before changing the identity credential modes (`internal`/`oauth_client`/`authmd`), the `/identity/*` OAuth/ID-JAG contract, delegation-grant revocation semantics, or the trace-ingest HMAC contract.
- Ask before raising the sandbox 30s timeout or widening the sandbox's injected globals.
- Ask before applying migrations with `yarn db:migrate`; PRs ship the migration + snapshot, not local DB state.

## Never

- Never let a file-agent script or local tool touch fs/net, mutate domain state, or escape the `isolated-vm` sandbox. Local `tools/*.ts` are either `// @ref <defineAiTool id>` references (centrally ACL-gated) or sandboxed pure functions run via `run_skill_script`.
- Never reference a `defineAiTool` id authored in an **app module** (`apps/mercato/src/modules/**`) from a file-defined agent's `tools:`. The standalone MCP server loads the compiled `ai-tools.generated.mjs` via plain Node ESM and cannot import app-module TS — one failed import drops **all** module tools (including `submit_outcome`). Reference tools from **packages** (built to dist) only, or use a **local sandboxed tool file**. Verify with `mercato ai_assistant mcp:list-tools` (expect the full set, not just 3 Code Mode tools).
- Never let `agents/**/scripts/**` or `agents/**/tools/**` into a package/app's typed build — they are raw sandbox sources read by the generator via `fs`, never imported. The consuming `tsconfig.json` MUST `exclude` those globs (see `apps/mercato/tsconfig.json`).
- Never hand-edit `generated/file-agents.generated.ts` or `docker/opencode/agents|skills/*` — they are generator output (committed so they travel with the repo).
- Never trust the active agent / skill / outcome reported by the model — MCP tools resolve the active agent from the per-run correlation store keyed by the session token (`ctx.sessionId`).
- Never give a sub-agent a proposal OUTCOME or its own `subAgents` (depth cap = 1); sub-agents run under the caller's own scope, never escalated.
- Never let an agent write outside its own Command — the fail-closed `agentNoBypassSubscriber` rejects any flush-time write not inside the agent's command path.
- Never expose cross-tenant runs, proposals, traces, or principals; never mutate append-only audit rows.

## Web Egress (`web_search` / `web_fetch`)

Read-only web access for agents (spec `.ai/specs/enterprise/2026-07-11-agent-web-search-tool.md`). Two `defineAiTool`s on the existing `open-mercato` MCP server; agents opt in via `tools: [agent_orchestrator.web_search, agent_orchestrator.web_fetch]` in `AGENT.md` (example: `apps/mercato/src/modules/agent_examples/agents/deal_web_researcher/`).

- **Egress runs server-side** in the OM process through the `@open-mercato/web-research` engine (`lib/webSearch/`) — never the `isolated-vm` sandbox and never OpenCode's native web tools (still disabled in `docker/opencode/opencode.jsonc`). The sandbox no-net rule and the renderer are untouched; the tools are ordinary `open-mercato_agent_orchestrator_*` ids that ride the existing allowlist.
- **Sources are adapter packages**, discovered from `openMercato.webResearchAdapter` in each package's `package.json` and emitted as a static registry by `yarn generate`. Shipped: `-serp` (our crawler, no deps), `-model` (LLM-native, reuses the existing LLM key), `-firecrawl`, `-tavily`, `-searxng` (client only — SearXNG is AGPL, we never bundle the server). Adding one: `.ai/skills/om-create-web-research-adapter/SKILL.md`.
- **Several adapters race under one deadline.** `settleMode` is `race` / `quorum` (default) / `exhaustive`; results are deduped and fused by reciprocal rank. `policy.lastResort` (default `model-native`) runs when everything else came up short, *even if disabled* — that is what makes "always returns something" true. A confidence threshold never empties the set; it relaxes and flags `degraded`.
- **Only `model-native` is enabled by default.** SERP scraping is opt-in per deployment (`OM_WEB_SEARCH_ADAPTERS`) or per tenant.
- **`web_fetch` is adapter-independent** — it uses the engine's hardened HTTP client directly, so it works with no search adapter configured. `render: 'auto'` escalates to a browser adapter when the plain read classifies as a JavaScript shell.
- **Gates:** default-off `agent_orchestrator.web_search` (search) and `agent_orchestrator.web_fetch` (arbitrary URL retrieval, requires both) ACL features, re-checked per MCP call; always-on SSRF at the socket boundary with DNS pinning per redirect hop; domain allow/deny; separate per-run search and fetch budgets plus a per-tenant window. Both tools are `isMutation: false`.
- **Run correlation:** the per-run budget resolves its run id from `agentRunSessionStore`, NOT `getCurrentRunId()` — the ALS context is empty in the `mcp:serve-http` process, which is the primary file-agent path.
- **Live status:** every adapter transition emits `agent_orchestrator.web_search.progress` (clientBroadcast, summary-only — the SSE frame cap is 4KB). Rendered by `components/WebSearchActivity.tsx`.
- **Ops env:** `OM_WEB_SEARCH_ADAPTERS` (ordered, comma-separated; default `model-native`), plus optional `OM_WEB_SEARCH_{SETTLE_MODE,CONCURRENCY,MIN_RESULTS,SOFT_DEADLINE_MS,HARD_DEADLINE_MS,CACHE_TTL_MS,LAST_RESORT,ALLOW_DOMAINS,DENY_DOMAINS,RATE_PER_RUN,RATE_PER_TENANT_PER_MINUTE}` and `OM_WEB_FETCH_{RATE_PER_RUN,MAX_BYTES}`. Per-tenant overrides live in `ModuleConfigService` under `agent_orchestrator` / `web_search`, edited at **Agents → Web search**.

## Validation Commands

```bash
yarn workspace @open-mercato/enterprise test src/modules/agent_orchestrator
yarn workspace @open-mercato/enterprise typecheck
yarn workspace @open-mercato/cli test src/lib/generators/extensions/agent-files
yarn generate   # then, for file agents: docker compose --project-directory . -f starters/docker/compose.infra.yml up -d opencode
```

## Data Model Constraints

`data/entities.ts` — all rows scoped by `tenantId` + `organizationId`. Cross-module links are FK ids only (no ORM relations across modules).

- **AgentRun** (`agent_runs`) — immutable audit of ONE AGENT EXECUTION (`running → ok|error`). It answers "what did the agent do", never "what stage is the business process at". MUST carry `agentId`, `resultKind`; `agent_type` records the DECLARED type and is NULLABLE (runs predating the declaration, and agents that make none, have none); `parentRunId` links nested in-process sub-agents; `proposalId` links the disposition. **`(workflowInstanceId, stepId, invocationId)` IS the invocation's identity** and a partial-unique index enforces it — a caller finds the run it caused by naming it, never by asking for the newest run since a timestamp, which cannot tell two concurrent runs of the same agent apart. All three are null together for a Playground or eval run.
- **AgentProposal** (`agent_proposals`) — the proposal envelope: `payload` is `{ options[], rationale? }`, N ranked alternatives of which a disposition selects AT MOST one (`selected_option_id`). MUST track disposition (`pending → auto_approved|approved|edited|rejected`); an EMPTY option set is stamped `none_proposed` at creation and is never operator-settable. `auto_disposition_block` (`near_tie` | `risk` | `guardrail` | `trace_incomplete` | `policy`) records WHICH POLICY GATE held a threshold-clearing auto-approval for a human — never `disposition_reason`, which is the operator's. Applied only via effector command.
- **AgentSpan** (`agent_spans`) / **AgentToolCall** (`agent_tool_calls`) — append-only OTel-GenAI trace tree. Full payloads offload to S3; rows keep redacted summaries.
- **AgentCorrection** (`agent_corrections`) — append-only flywheel entry. MUST record `action` (`edit|reject|override|answer`) + mandatory `reason`.
- **AgentEvalCase** (`agent_eval_cases`) — regression case (`draft → approved → archived`), sourced from a correction or golden run. Editable.
- **AgentEvalAssertion** (`agent_eval_assertions`) — applied per-agent or `*`. `gate` MUST be `deterministic`; `llm_judge` is always `warn`. Unique on (org, appliesTo, key).
- **AgentEvalResult** (`agent_eval_results`) — append-only verdict of one assertion on one run.
- **AgentMetricRollup** (`agent_metric_rollups`) — precomputed KPI snapshot; idempotent per (org, agent, windowStart).
- **AgentGuardrailCheck** (`agent_guardrail_checks`) — append-only audit of every runtime check; evidence MUST be redacted (never raw PII).
- **AgentGuardrailSet** (`agent_guardrail_sets`) — versioned policy (content-hash version); append-only by version.
- **AgentContextBundle** (`agent_context_bundles`) — immutable per-run TDCR evidence (routed/pruned sources, tokens, redaction).
- **AgentPrincipal** (`agent_principals`) — links an agent to a non-interactive `auth.User` (`kind='agent'`) + scoped `auth.Role`. `credentialMode` ∈ `internal|oauth_client|authmd`; live partial-unique on (org, agent).
- **AgentDelegationGrant** (`agent_delegation_grants`) — external agent's revocable OAuth/ID-JAG grant. Revocation denies every minted token on its NEXT request, not at expiry.
- **AgentRunSession** (`agent_run_sessions`) — DB-backed cross-process correlation (runner ↔ `mcp:serve-http`). An in-process Map does NOT work across processes.
- **ProcessDefinition** (`process_definitions`) — the AUTHORED business definition: name, `workflow_id` (REQUIRED — a process with no workflow has no engine), `input_schema`/`input_defaults`, `outcome_schema`, `triggers` (jsonb, GIN-indexed), `milestones` (the declared VOCABULARY), `ui_metadata`, `enabled`. User-editable → `updated_at` optimistic locking. It carries NO execution identity: the bound workflow owns `grantedFeatures` and the principal core provisions from it.
- **ProcessInstance** (`process_instances`) — the business-facing READ MODEL of one `WorkflowInstance`, and nothing more. Live partial-unique on `(tenant, org, workflow_instance_id)` — the 1:1 that makes it a projection rather than a second execution record — plus partial-unique on `(org, process_definition_id, idempotency_key)`, the business-execution lock. `process_definition_id` is NULLABLE: an instance started from the Studio still projects, it simply has no business definition above it. `status` is DERIVED and never independently transitioned. `triggered_by` jsonb `{ kind, ref? }` is the INVOKER, never an ACL identity. `milestones_reached` is the one field accumulated rather than recomputed, because a milestone is an event that HAPPENED.

## Lifecycle: run → disposition → effector

1. Caller (playground, `INVOKE_AGENT` workflow step, or trace adapter) invokes `agentRuntime.run()`; `persistence.ts` opens an `AgentRun` and resolves the caller ACL.
2. Runtime executes (in-process object mode or OpenCode); `guardrailService` runs input/output checks; the typed `AgentResult` is validated against the agent's OUTCOME schema.
3. For `proposal`, an `AgentProposal` is persisted; `DispositionService` gates it through the auto-approval POLICY (`lib/disposition/autoApprovalPolicy.ts`). **Confidence is evidence, not authorization** — the policy answers the tenant switch, the guardrail verdict, trace completeness and the leading option's action risk BEFORE it looks at the model's own opinion, and the `auto_disposition_block` column records which gate held a threshold-clearing proposal.
4. On approval, the effector (`executeProposal.ts`) maps proposed actions → commands and runs them via the command bus; the workflow instance resumes via `proposal.ready`.

## File Agents — the `agents/<id>/` convention

Author file agents under `packages/<pkg>/src/modules/<module>/agents/<agent_id>/` (or an app module). To scaffold end-to-end use the **`om-create-opencode-agent`** skill (`.ai/skills/om-create-opencode-agent/SKILL.md`, symlinked from this module).

```
agents/<agent_id>/
├── AGENT.md            # frontmatter (id,label,description,provider?,model?,tools?,skills?,subAgents?,maxSteps?) + body = instructions
├── OUTCOME.md          # frontmatter `kind: researcher|proposal` + FIRST fenced ```json block = JSON-Schema; trailing prose = guidance
├── SAMPLE.json         # optional example input — Playground "Insert sample" button
├── FACTS.json          # optional Caseload fact declarations (see below)
├── skills/<sid>/       # SKILL.md (+ optional TEMPLATE.md, examples/*.md, scripts/*.ts run via run_skill_script)
├── sub-agents/<subid>/ # AGENT.md + OUTCOME.md; researcher-only, no further subAgents (depth cap 1)
└── tools/*.ts          # `// @ref <defineAiTool id>` (preferred, ACL-gated) OR a sandboxed `run(args)` local tool
```

- **OUTCOME.md**: frontmatter carries ONLY `kind`; the result JSON-Schema is the FIRST fenced ` ```json ` block. `researcher` ⇒ schema describes `data`; `proposal` ⇒ schema describes the `proposal` envelope. Compiles to the same `z.object({ kind, data|proposal })` the in-process path uses.
- **Skills** inject instructions + union read-only tools into the agent's allowlist (deduped); read-only by construction.
- **FACTS.json** (optional): declares the labelled facts the Caseload decision panel shows for this agent's proposals — `{ "facts": [{ "label", "source": "input"|"payload"|"output", "path", "format"?: "text"|"number"|"boolean"|"percent" }] }` where `path` is a dot-path (array indexes allowed) into the run input / proposal payload / run output. Agents without it get a generic derivation (input primitives + summarized upstream findings). In-process agents pass the same shape as `facts` to `defineAgent`. Rendering lives in `components/ProposalFacts.tsx`; resolution helpers in `components/proposalFacts.ts`.
- **Token usage** (file agents only): `yarn generate` bakes a per-element token estimate (AGENT.md, OUTCOME.md, each skill + its subfiles, each tool, each sub-agent) into `generated/file-agents.generated.ts` (`FileAgentDescriptor.tokenUsage`), counted with the shared `o200k_base` tokenizer (`@open-mercato/shared/lib/ai/token-count` — an estimate, not an exact model count). It surfaces on the Agent detail page ("Token usage" card, `runtime: 'opencode'` only) and via the CLI: `yarn mercato agent_orchestrator token-usage --dir <agents/<id>> [--json]` (live from raw files) or `--agent <id>` (baked). The raw-file walker `lib/tokens/computeAgentTokenUsageFromDir` is MIRRORED by the generator (`packages/cli/.../extensions/agent-files.ts`); a parity test (`__tests__/agent-token-usage.test.ts`) guards the two against drift.

## DI Services

| Token | When to use |
|-------|-------------|
| `agentRuntime` | Run an agent (dispatches in-process vs opencode) |
| `dispositionService` | Gate a proposal (auto-approve vs `user_task`) |
| `guardrailService` | Pre/post-call schema + injection (+ grounding) checks |
| `agentRunSessionStore` | Cross-process run↔session outcome handoff |
| `agentContextResolver` | Assemble per-run TDCR context bundle |
| `agentDocumentIngestService` / `agentDocumentOcrProvider` | Document OCR → field extraction |
| `agentWorkflowBridge` | Bridge the `workflows` `INVOKE_AGENT` activity (runs + dispositions proposals; `listAgentOutcomeContracts()` also projects every agent's OUTCOME schema so the workflows context ledger can type `outputMapping` targets — core reads it duck-typed, never imported) |
| `agentPrincipalService` / `agentTokenService` / `agentDelegationGrantService` / `agentAuthMdService` | Identity overlay (principals, OAuth tokens, delegation grants, ID-JAG) |

## API Routes (`/api/agent_orchestrator/`)

| Route | Method | Feature | When to use |
|-------|--------|---------|-------------|
| `/agents`, `/agents/:id` | GET | `agents.view` | List registry / agent detail (incl. resolved skills; `tokenUsage` for file agents) |
| `/agents/:id/run` | POST | `agents.run` | **Playground / evals / diagnostics ONLY.** An engineering primitive: one agent, synchronously, with no retry, waits, signals, cancellation or durable lifecycle. Never a business-execution API — a caller coupled to an agent id cannot be refactored around |
| `/agents/:id/metrics` | GET | `trace.view` | KPI tiles |
| `/runs`, `/runs/:id` | GET | `trace.view` | Run list/detail (filters: agent, status, eval-fail, low-confidence) |
| `/proposals` | GET | `proposals.view` | Caseload list |
| `/proposals/:id/dispose` | POST | `proposals.dispose` | Human verdict (approve/edit/reject + reason); optimistic-locked on `updated_at` |
| `/trace/ingest` | POST | HMAC (no user auth) | Runtime-adapter trace webhook; idempotent on (runtime, externalRunId) |
| `/corrections` | GET/POST | `trace.correct` | Record human correction (flywheel) |
| `/eval-cases[/:id/approve][/export]`, `/eval-assertions` | CRUD | `eval.manage` / `eval.export` | Manage + export eval cases/assertions |
| `/context-bundles` | GET | `context.read` | Inspect TDCR bundles |
| `/guardrail-checks` | GET | `guardrail.read` | Inspect guardrail audit |
| `/processes`, `/processes/:id` | CRUD | `processes.view` / `processes.manage` | Author process definitions; optimistic-locked on `updated_at` |
| `/processes/:id/executions` | POST | `processes.run` | **The external contract.** Start one business execution — 403 without a declared `manual` trigger; always async, `202 { executionId }` |
| `/executions`, `/executions/:id` | GET | `processes.view` | The ONE business-execution surface: derived status, milestones reached, proposals, outcome |
| `/identity/well-known`, `/identity/token`, `/identity/agent/auth` | GET/POST | public / no-user-auth | OAuth discovery, client-credentials, ID-JAG |
| `/identity/grants/:id/revoke` | POST | `identity.manage` | Revoke a delegation grant |

Every route file MUST export `openApi`. Custom write routes MUST wire the mutation-guard contract.

### Public-endpoint rate limits

The three `/identity/*` routes and `/trace/ingest` take no staff session, and three of them spend real CPU per request (bcrypt per candidate client secret, ID-JAG signature verification, trace HMAC + a write). Each therefore enforces a per-client-IP ceiling through `enforcePublicEndpointRateLimit` (`lib/guardrails/publicEndpointRateLimit.ts`), called **before** any credential verification — checking it afterwards leaves the CPU-amplification vector open. An unregistered `rateLimiterService` fails **open** (deployments without a limiter keep working); a registered-but-unusable one fails **closed** with 503, as does a limiter that cannot produce a real decision.

| Route | env prefix | points | duration | blockDuration |
|---|---|---|---|---|
| `/identity/token` | `AGENT_ORCH_IDENTITY_TOKEN` | 10 | 60 | 300 |
| `/identity/agent/auth` | `AGENT_ORCH_IDENTITY_AGENT_AUTH` | 10 | 60 | 300 |
| `/identity/well-known` | `AGENT_ORCH_IDENTITY_WELL_KNOWN` | 60 | 60 | — |
| `/trace/ingest` | `AGENT_ORCH_TRACE_INGEST` | 120 | 60 | — |

Override per deployment with `RATE_LIMIT_{PREFIX}_{POINTS,DURATION,BLOCK_DURATION}`.

## ACL Features (`acl.ts`)

`agents.view`, `agents.run`, `agents.manage`, `proposals.view`, `proposals.dispose`, `trace.view`, `trace.correct`, `eval.manage`, `eval.run`, `eval.export`, `guardrail.read`, `guardrail.manage`, `context.read`, `identity.read`, `identity.manage`, `identity.tokens`, `processes.view`, `processes.manage`, `processes.run`, `web_search`, `web_fetch` (all prefixed `agent_orchestrator.`).

`processes.view` is ONE feature covering both the projection list and the definitions list — the retired `tasks.view` merged into it rather than adding a fourth id, so definition authors now transitively inherit its `dependsOn: proposals.view`. That privilege change is deliberate and recorded in the spec.

## Events (`events.ts`)

`run.created`, `run.completed`, `run.ingested`, `run.evaluated`, `proposal.created`, `proposal.disposed`, `proposal.ready`, `proposal.corrected`, `eval_case.created`, `eval_case.approved`, `guardrail.tripped`, `delegation_grant.revoked`, `agent_principal.registered`, `process_definition.{created,updated,deleted}`, `process_run.{started,completed,failed}` (clientBroadcast) (all prefixed `agent_orchestrator.`). There are deliberately no `task_event_trigger.*` events: a trigger edit IS a definition update. Several set `clientBroadcast: true` for the cockpit. Declare new events here with `as const`.

## Backend Cockpit (`backend/`)

`overview` (KPI tiles + needs-attention queue), `agents` + `agents/:id` (registry with runtime tags), `playground`, `caseload` + `caseload/:proposalId` (operator dispose flow), `processes` + `processes/:id` (running executions — the read model), `processes/definitions` + `processes/definitions/:id` (definition authoring), `traces` + `traces/:id` (span/tool-call tree, nav-hidden), `audit` (nav-hidden). Components: `ProposalCard`, `ProposalFacts` (Caseload facts grid + reasoning, FACTS.json-driven with generic fallback), `SkillDrawer`, `TraceView`.

### Operator tags + registry filters

Agents are code/file-defined and global, so a tenant's own taxonomy lives in `agent_settings.tags` (jsonb, alongside the `icon` override), keyed by agent id and NOT an FK, so tags outlive an agent missing from the live registry. Normalize on BOTH sides with `normalizeAgentTags` (`data/agentTags.ts`, server-safe like `agentIcons.ts`) or a differently-cased tag silently fails to match. Read via `getAgentPresentationMaps` (one query for icons + tags), written through the existing `PUT /agents/:id/settings`: `icon` and `tags` are both optional there and an omitted field is left unchanged, so the tag editor and the icon picker share one optimistic-locked row. Registry filtering is in-memory in `backend/agents/agentListFilters.ts` (the list endpoint returns the whole registry, unpaged); values OR inside a facet, facets AND together, tags included in free-text search.

### Preview UI flag

`isAgentPreviewUiEnabled()` (`lib/featureFlags.ts`, `NEXT_PUBLIC_OM_AGENT_ORCHESTRATOR_PREVIEW_UI`, **default off**) hides the cockpit surfaces built ahead of their backend: New agent / Export / Duplicate / Disable, agent Pause + the Configure drawer, process Pause / Reassign / Take over, the overview interventions card and its two `Needs backend` tiles, the caseload `Closed today` tile, and the trace model comparison. Anything that renders illustrative figures or is toast-only belongs behind it, never on the default path; `__tests__/preview-ui-flag.test.ts` asserts each gated file still reads the flag.

## Runtime Split — Key Files

- Registry + `runtime` field: `lib/sdk/defineAgent.ts` (`registerFileAgent`, `ensureAgentsLoaded`, load-time propose-only mutation gate).
- Parsers + loader: `lib/sdk/agentMarkdown.ts`, `lib/sdk/outcomeSchema.ts`, `lib/sdk/skillMarkdown.ts`, `lib/sdk/defineFileAgent.ts` (`loadFileAgentDir`).
- Generator: `packages/cli/src/lib/generators/extensions/agent-files.ts` (scans `agents/<id>/`, fails on malformed dirs, emits the manifest + `docker/opencode/{agents,skills}/`). The CLI cannot import `@open-mercato/core`, so it reimplements the tiny parsers — keep them in sync.
- Runner + dispatch: `lib/runtime/agentRuntime.ts`, `lib/runtime/openCodeAgentRunner.ts` (per-run session token, `agent: <name>`, poll/SSE-idle, one corrective nudge then fail-closed), `lib/runtime/agentRunSessionStore.ts`, `lib/runtime/persistence.ts`, `lib/runtime/executeProposal.ts` (effector), `lib/runtime/invokeAgentForWorkflow.ts` (workflow bridge), `lib/runtime/runContext.ts` (AsyncLocalStorage parent-run trace).
- Sandbox: `lib/runtime/sandboxedScript.ts` reuses the ai-assistant `isolated-vm` sandbox (no fs/net/require/process, 30s cap).
- Overlays: `lib/disposition/` (incl. the auto-approval POLICY), `lib/identity/`, `lib/guardrails/`, `lib/context/`, `lib/trace/`, `lib/eval/`, `lib/metrics/`.
- Business process: `lib/processes/materializeAgentWorkflow.ts` (the generated single-agent workflow), `lib/processes/processProjection.ts` (the execution read model), `lib/tasks/{triggers,milestones,outcome,outcomeLink,schedule}.ts` (client-safe readers), `commands/processes.ts` (the one start command), `workers/process-execution-starter.ts` (starts the one durable execution).

## Structure

```
agent_orchestrator/
├── ai-agents.ts ai-tools.ts ai-skills.ts   # in-process agents + MCP tools + skill registry
├── di.ts acl.ts events.ts setup.ts encryption.ts index.ts
├── data/{entities.ts,validators.ts}
├── lib/{sdk,runtime,disposition,processes,tasks,identity,guardrails,context,trace,eval,metrics}/
├── api/{agents,runs,proposals,processes,executions,trace,corrections,eval-cases,eval-assertions,context-bundles,guardrail-checks,identity}/
├── backend/{overview,agents,playground,caseload,processes,traces,audit}/
├── components/  commands/  workers/  migrations/  i18n/
├── agents/<id>/  skills/  examples/  generated/file-agents.generated.ts
└── __tests__/  __integration__/
```

## Cross-References

- **Building/overriding AI agents + tools (`defineAiTool`, `runAiAgentObject`, sandbox)**: `packages/ai-assistant/AGENTS.md`
- **`INVOKE_AGENT` activity, `WAIT_FOR_SIGNAL`, step/instance lifecycle**: `packages/core/src/modules/workflows/AGENTS.md`
- **Enterprise package scope + licensing**: `packages/enterprise/AGENTS.md`
- **Module conventions (commands, events, ACL sync, encryption, migrations)**: `packages/core/AGENTS.md`
- **CLI generators (`yarn generate`)**: `packages/cli/AGENTS.md`
- **Scaling/worker-fleet sizing (queue strategy, concurrency, DB budget, runtime protection)**: `apps/docs/docs/deployment/agent-orchestration-scaling.mdx`
- **Full design**: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` + `.ai/specs/enterprise/agent-orchestrator/`

## Known Follow-Ups

- OpenCode-native `task` sub-agent delegation runs sub-agents inside OpenCode (not our runner), so per-sub-agent `AgentRun` rows exist only for the in-process `delegate_agent` path today (`agent_runs.parent_run_id` is wired for that path). Native nested-run recording is a follow-up.
- The pinned `OPENCODE_VERSION` and installer version-pin env var are ASSUMPTION-to-verify against the running image (phase-0 findings §6); confirm in an end-to-end smoke test.
- Native-skill bundling of `TEMPLATE.md`/`examples`/`scripts` is unconfirmed; the `load_skill` / `run_skill_script` MCP path is the authoritative carrier regardless.
