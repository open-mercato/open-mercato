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

## The Process Model (spec `2026-08-11-triggered-process-model.md`)

One domain concept, three records — do not reintroduce the "task vs process" split this spec removed.

| Record | Table | What it is |
|---|---|---|
| `AgentProcessDefinition` | `agent_process_definitions` | **Authored**: what CAN happen |
| `AgentProcessRun` | `agent_process_runs` | **Instance**: one entry into it |
| `AgentProcess` | `agent_processes` | **Projection**: rebuilt from events, NOT renamed, still the read model |

- **Two routes, not one tabbed page.** `/backend/processes` lists running processes (the projection); `/backend/processes/definitions` authors definitions. They answer "what is happening now" versus "what can happen". `/backend/agentic-tasks` is a nav-hidden, still-RBAC-guarded bridge redirect for one release.
- **`encryption.ts` keys `defaultEncryptionMaps` by a PLAIN STRING `entityId` that nothing type-checks.** Rename an entity or a column without moving its map entry and `input`, `input_defaults` and `failure_reason` silently persist in PLAINTEXT while existing rows become undecryptable — in green CI. `__tests__/encryption-map-entity-ids.test.ts` resolves every entry against the ORM metadata; keep it passing rather than deleting the failing row.
- **Migrations are SQUASHED, not stacked** (`Migration20260811150000`): one current-state create-schema file regenerated from `data/entities.ts`. Regenerate the file AND `.snapshot-open-mercato.json` together; never run `db:migrate` to quiet the generator. Data rewrites that touch CORE `workflows` tables cannot be absorbed by a create-table and are carried over verbatim, `to_regclass`-guarded.
- **Triggers are ONE declared list** (`agent_process_definitions.triggers` jsonb, `processTriggerSchema`, `.max(20)`): `schedule` | `event` | `manual`. The event arm's `config` persists ARRAYS of typed objects (`filterConditions: [{field,operator,value?}]`, `contextMapping: [{targetKey,sourceExpression,defaultValue?}]`) — NOT maps; modelling them as `z.record` drops every stored config. Read the column through `lib/tasks/triggers.ts`, never `JSON.parse` by hand.
- **A definition with no `manual` trigger CANNOT be started by hand** — `POST /process-definitions/:id/run` 403s, and the trigger's own `requireFeatures` is checked on top of `processes.run`. `AgentProcessRun.triggered_by` is jsonb `{ kind, ref? }` recording WHICH trigger fired.
- **The event dispatcher probes the GIN index, it does not scan.** `candidateEventPatterns(eventName)` enumerates the exact id plus every trailing-wildcard prefix that could match, and each is one `triggers @> '[{"kind":"event","eventPattern":…}]'` containment probe against `agent_process_definitions_triggers_gin` (`jsonb_path_ops`). `matchesEventPattern` is re-applied in memory as the correctness backstop.
- **Milestones are AUTHORED business stages**, `agent_process_definitions.milestones` jsonb (`processMilestoneSchema`, `.max(50)`, `{ id, label, stepId, order }`), read through `lib/tasks/milestones.ts` and never `JSON.parse`d by hand. The `label` lives on the DEFINITION, not on the step, so renaming a step does not change what a business reader sees — and the `stepId` mapping can DRIFT. `collectMilestoneIssues` reports a milestone naming a step the workflow no longer declares as a **warning** in the `WorkflowValidationIssue` shape core `workflows` already emits (`lib/collect-validation-issues.ts`), never an error: a definition mid-edit must stay saveable. An unresolvable step list (peer absent, no permission) reports NOTHING — "unknown" is not "missing".
- **Milestones are WORKFLOW-target only.** Declaring them on an agent-targeted definition is a validation error (`agentProcessDefinition{Create,Update}Schema`), not a silent no-op; switching a stored definition to an agent target clears the list. `/backend/processes/:id` renders the authored labels in authored order and falls back to the raw observed step ids only when none are declared.
- **The outcome is OPTIONAL BY DECISION** — `agent_process_runs.outcome_type`/`outcome_id`/`outcome_label`, all nullable, written on completion and read through `lib/tasks/outcome.ts`. A research or monitoring process produces nothing and is a perfectly valid completed run, so an absent outcome is NEVER a missing write. It is FK-id + snapshot: no FK, no ORM relation, and the `label` is a SNAPSHOT so the reference stays readable when the owning module is gone. Plaintext like `agent_processes.subject_label` (a reference), not encrypted like `subject_title` (free text). It is part of run completion and is deliberately **NOT independently undoable** — do not invent an undo for it.
- **Nothing derives an outcome; the terminating source DECLARES one** under an `outcome` key — the finished workflow instance's final context, or a researcher agent result's `data`. A `proposal` result declares none: at run completion nothing exists yet, because the effector creates the record after disposition.
- **The outcome LINK is resolved server-side and soft-optionally.** `lib/tasks/outcomeLink.ts` reads the `<module>:<entity>` prefix and matches the owning module's OWN declared `/backend/**/[id]` route through a local `tryResolve` over `tryGetModules()`, in try/catch. Absent module, unbootstrapped registry or no matching route ⇒ `null` href ⇒ the label snapshot renders as plain text. Never guess a URL. The API returns the columns plus `outcome_href`; the client never resolves it (the module registry is server-only). The WRITE path's peer lookup is the DI form: `resolve('workflowExecutor')` in try/catch.

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

- **AgentRun** (`agent_runs`) — immutable audit of one execution (`running → ok|error`). MUST carry `agentId`, `resultKind`; `agent_type` records the DECLARED type and is NULLABLE (runs predating the declaration, and agents that make none, have none); `parentRunId` links nested in-process sub-agents; `proposalId`/`processId`/`stepId` link disposition + workflow.
- **AgentProposal** (`agent_proposals`) — the proposal envelope: `payload` is `{ options[], rationale? }`, N ranked alternatives of which a disposition selects AT MOST one (`selected_option_id`). MUST track disposition (`pending → auto_approved|approved|edited|rejected`); an EMPTY option set is stamped `none_proposed` at creation and is never operator-settable. `auto_disposition_block` (`near_tie`) records why a threshold-clearing auto-approval was held for a human — never `disposition_reason`, which is the operator's. Applied only via effector command.
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
- **AgentProcessDefinition** (`agent_process_definitions`) — the AUTHORED half of a process: name, `target_type` (`agent|workflow`), `input_schema`/`input_defaults`, `granted_features`, `triggers` (jsonb, GIN-indexed), `milestones` (jsonb, workflow targets only), `enabled`. User-editable → `updated_at` optimistic locking. Runs under its OWN auto-provisioned `AgentPrincipal` (`execution_principal_id`, synthetic agent id `task:<id>` — a persisted key deliberately NOT renamed), never the triggering user.
- **AgentProcessRun** (`agent_process_runs`) — one execution of a definition (`running → completed|failed`), system-transitioned, unified across both target types. FK `process_definition_id`; `triggered_by` jsonb `{ kind, ref? }`; nullable `outcome_type`/`outcome_id`/`outcome_label` (FK-id + snapshot, never a relation); partial-unique on (org, definition, idempotency_key).

## Lifecycle: run → disposition → effector

1. Caller (playground, `INVOKE_AGENT` workflow step, or trace adapter) invokes `agentRuntime.run()`; `persistence.ts` opens an `AgentRun` and resolves the caller ACL.
2. Runtime executes (in-process object mode or OpenCode); `guardrailService` runs input/output checks; the typed `AgentResult` is validated against the agent's OUTCOME schema.
3. For `proposal`, an `AgentProposal` is persisted; `DispositionService` gates it (auto-approve vs `USER_TASK`).
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
| `/agents/:id/run` | POST | `agents.run` | Playground run → typed `AgentResult` |
| `/agents/:id/metrics` | GET | `trace.view` | KPI tiles |
| `/runs`, `/runs/:id` | GET | `trace.view` | Run list/detail (filters: agent, status, eval-fail, low-confidence) |
| `/proposals` | GET | `proposals.view` | Caseload list |
| `/proposals/:id/dispose` | POST | `proposals.dispose` | Human verdict (approve/edit/reject + reason); optimistic-locked on `updated_at` |
| `/trace/ingest` | POST | HMAC (no user auth) | Runtime-adapter trace webhook; idempotent on (runtime, externalRunId) |
| `/corrections` | GET/POST | `trace.correct` | Record human correction (flywheel) |
| `/eval-cases[/:id/approve][/export]`, `/eval-assertions` | CRUD | `eval.manage` / `eval.export` | Manage + export eval cases/assertions |
| `/context-bundles` | GET | `context.read` | Inspect TDCR bundles |
| `/guardrail-checks` | GET | `guardrail.read` | Inspect guardrail audit |
| `/process-definitions`, `/process-definitions/:id` | CRUD | `processes.view` / `processes.manage` | Author process definitions; optimistic-locked on `updated_at` |
| `/process-definitions/:id/run` | POST | `processes.run` | Start a run BY HAND — 403 without a declared `manual` trigger; always async, `202 { processRunId }` |
| `/process-runs`, `/process-runs/:id` | GET | `processes.view` | Unified run ledger across agent and workflow targets |
| `/identity/well-known`, `/identity/token`, `/identity/agent/auth` | GET/POST | public / no-user-auth | OAuth discovery, client-credentials, ID-JAG |
| `/identity/grants/:id/revoke` | POST | `identity.manage` | Revoke a delegation grant |

Every route file MUST export `openApi`. Custom write routes MUST wire the mutation-guard contract.

## ACL Features (`acl.ts`)

`agents.view`, `agents.run`, `agents.manage`, `proposals.view`, `proposals.dispose`, `trace.view`, `trace.correct`, `eval.manage`, `eval.run`, `eval.export`, `guardrail.read`, `guardrail.manage`, `context.read`, `identity.read`, `identity.manage`, `identity.tokens`, `processes.view`, `processes.manage`, `processes.run`, `web_search`, `web_fetch` (all prefixed `agent_orchestrator.`).

`processes.view` is ONE feature covering both the projection list and the definitions list — the retired `tasks.view` merged into it rather than adding a fourth id, so definition authors now transitively inherit its `dependsOn: proposals.view`. That privilege change is deliberate and recorded in the spec.

## Events (`events.ts`)

`run.created`, `run.completed`, `run.ingested`, `run.evaluated`, `proposal.created`, `proposal.disposed`, `proposal.ready`, `proposal.corrected`, `eval_case.created`, `eval_case.approved`, `guardrail.tripped`, `delegation_grant.revoked`, `agent_principal.registered`, `process_definition.{created,updated,deleted}`, `process_run.{started,completed,failed}` (clientBroadcast) (all prefixed `agent_orchestrator.`). There are deliberately no `task_event_trigger.*` events: a trigger edit IS a definition update. Several set `clientBroadcast: true` for the cockpit. Declare new events here with `as const`.

## Backend Cockpit (`backend/`)

`overview` (KPI tiles + needs-attention queue), `agents` + `agents/:id` (registry with runtime tags), `playground`, `caseload` + `caseload/:proposalId` (operator dispose flow), `processes` + `processes/:id` (running-process projection), `processes/definitions` + `processes/definitions/:id` (definition authoring), `traces` + `traces/:id` (span/tool-call tree, nav-hidden), `audit` (nav-hidden), `agentic-tasks` (nav-hidden bridge redirect). Components: `ProposalCard`, `ProposalFacts` (Caseload facts grid + reasoning, FACTS.json-driven with generic fallback), `SkillDrawer`, `TraceView`.

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
- Overlays: `lib/disposition/`, `lib/identity/`, `lib/guardrails/`, `lib/context/`, `lib/trace/`, `lib/eval/`, `lib/metrics/`.

## Structure

```
agent_orchestrator/
├── ai-agents.ts ai-tools.ts ai-skills.ts   # in-process agents + MCP tools + skill registry
├── di.ts acl.ts events.ts setup.ts encryption.ts index.ts
├── data/{entities.ts,validators.ts}
├── lib/{sdk,runtime,disposition,identity,guardrails,context,trace,eval,metrics}/
├── api/{agents,runs,proposals,trace,corrections,eval-cases,eval-assertions,context-bundles,guardrail-checks,identity}/
├── backend/{overview,agents,playground,caseload,traces,audit}/
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
