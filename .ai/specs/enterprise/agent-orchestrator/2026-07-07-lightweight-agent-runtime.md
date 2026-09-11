# Lightweight Scalable Agent Runtime (`native`) + UI-Authored Agents

## TLDR

**Key Points:**
- Adds a **`native` agent runtime** to `agent_orchestrator`: a thin, horizontally scalable execution layer over the already-shipped in-process engine (`runAiAgentObject` tool loop, skills, `delegate_agent` sub-agents, `isolated-vm` sandboxed scripts, admission gate, identity/`runAs`, disposition). Marginal cost per concurrent run: one pending LLM promise plus a bounded number of DB writes — no container, no per-run SSE stream, no session api-key mint/bcrypt, no 750 ms outcome polling.
- **Replaces OpenCode as the execution path for all agents** (maintainer decision at the Open Questions gate): `defineAgent` agents and file-defined `agents/<id>/` agents both compile to `native`; the OpenCode runner, container, per-run session machinery, and `submit_outcome` are decommissioned per the `BACKWARD_COMPATIBILITY.md` deprecation protocol (one-minor-version bridge). The authoring conventions (`AGENT.md`/`OUTCOME.md`/skills/sub-agents/`tools/*.ts`) are **unchanged** — only the executor changes.
- **Always-on full trace**: every native run writes per-step/per-tool-call `AgentSpan`/`AgentToolCall` rows through the existing, directly-callable `ingestTrace` service — asynchronously, after the run, so the hot path pays nothing. Requires one additive `ai-assistant` change: the object-mode `enableTools` branch of `runAiAgentObject` currently drops the AI SDK's per-step data (`agent-runtime.ts:1991-2014` — no `onStepFinish` forwarding, `.steps` discarded).
- **Per-provider LLM budgets in v1**: a process-local per-provider concurrency gate + retry-on-429/overloaded with exponential backoff, because at the target scale (dozens–hundreds of parallel runs) the provider RPM/TPM ceiling — not CPU — is the real limit, and today no retry/backoff exists anywhere in the stack.
- **UI-authored agents (bundled scope, per gate)**: `AgentDefinition` + immutable `AgentDefinitionVersion` entities (draft → published → archived, adapting the shipped `workflow_definitions` versioning semantics), a tenant-scoped registry resolver layered over the global code/file registry, an auto-provisioned execution principal per definition (reusing `provisionAgentPrincipal`), and a backend builder UI with least-privilege tool/skill pickers. Custom agents run on `native` like every other agent.

**Scope:**
- Enterprise `agent_orchestrator`: `NativeAgentRunner`, span writer, provider budgets, scoped registry resolver, definition entities + CRUD + publish flow, builder UI, OpenCode decommission.
- `packages/ai-assistant` (**Ask First**, additive): forward `loop.onStepFinish` and return per-step records from the object-mode `enableTools` branch.
- `packages/cli` generator: file agents compile to `native`; stop emitting `docker/opencode/` artifacts (bridge window first).
- Repo/ops: compose services, `docker/opencode/`, env vars — removed at decommission.

**Concerns (if any):**
- The global agent registry is a module-level `Map` with **no tenant scoping** (`defineAgent.ts:119`) — DB-defined agents MUST NOT enter it; they resolve through a separate org-scoped, cache-backed resolver, with cross-tenant denial tests. Registry cache invalidation across web/worker processes is the sneakiest failure mode (stale published version running in a worker).
- UI-authored prompts widen the prompt-injection surface while the runtime-guardrails overlay (#5) is unbuilt. Mitigation posture: custom agents get a dedicated least-privilege execution principal, only registered read-only tools, and their proposals default to human review (`alwaysAsk`); the guardrails overlay is a strongly recommended fast-follow, not a hard gate.
- Full replacement removes the container escape hatch. Audit result: generated OpenCode agents already denied `write`/`bash`/`edit`/`read`/`glob`/`grep` and were confined to MCP tools + `task` + skills — every one of those capabilities has a native equivalent (registered tools, `delegate_agent`, in-process skills + `isolated-vm` scripts), so no shipped agent capability is lost.

## Overview

The orchestrator today runs agents on two runtimes behind one registry and one `agentRuntime.run()` (`00-IMPLEMENTED-BASELINE.md`). The in-process path is already a lightweight runtime — `runInProcess` (`lib/runtime/agentRuntime.ts:175`) drives the Vercel AI SDK object-mode tool loop with guardrail hooks, context assembly, a wall-clock deadline, admission control, and the audited persistence tail. The OpenCode path exists to execute file-authored agents, and it is the scale problem:

| Per concurrent OpenCode run | Per concurrent native run |
|---|---|
| 1 OpenCode session on a **single container** (no pooling; `docker-compose.yml`) | 1 pending LLM promise in a queue worker |
| 1 dedicated SSE connection to the global `/event` firehose — O(N²) event decode across N runs (`openCodeAgentRunner.ts:405-437`) | — |
| 1 session api-key insert (**bcrypt**) + revoke (`openCodeAgentRunner.ts:158-181`) | — |
| 750 ms DB outcome polling for the whole run (`openCodeAgentRunner.ts:79,354-358`) | — |
| Synchronous `POST /session/:id/message` held open for minutes | — |
| Container restart after `yarn generate`; pinned `OPENCODE_VERSION` | — |

(Evidence: `.ai/analysis/2026-07-06-agent-orchestration-performance-analysis.md` §B2/§B6 and `REAL-CONTAINER-FINDINGS.md`.)

At the reference load (1,000 cases × ~12 agents/day ⇒ ~20 concurrent runs steady, 50–100 peak) the OpenCode path is the first thing that falls over; at "hundreds in parallel" it is disqualifying. Agent runs are **LLM-latency-bound I/O waits** — a Node worker at concurrency K holds K pending promises at negligible cost, so hundreds of parallel native runs is a worker-fleet configuration (F processes × K concurrency, within the DB connection budget), not an engine problem. What is genuinely missing for that fleet to be opened safely: per-provider throttles (no 429 retry/backoff exists anywhere today) and per-step trace capture (in-process runs write **zero spans** today — only the OpenCode adapter ingests traces).

Everything else this spec touches is reuse: the registry dispatch already switches on `entry.runtime` (`agentRuntime.ts:130`) with an `'external'` value reserved and unused; `ingestTrace` is a pure, directly-callable function (`traceIngestionService.ts:54`) with idempotent `(runtime, externalRunId)` upsert semantics; `provisionAgentPrincipal` is idempotent per `(organizationId, agentDefinitionId)` (`agentPrincipalService.ts:68`); the versioning pattern this spec copies shipped in `workflow_definitions` (`(workflowId, version, tenantId)` unique + `lifecycle` + latest-published resolution, `find-definition.ts:41`).

> **Market Reference**: the **OpenAI Agents SDK** and **LangGraph** validate the "thin loop over the model-provider SDK + persistence/trace as first-class" shape this spec keeps — neither ships a container-per-agent execution model for tool-calling agents. **Dify** validates the bundled second half: UI-authored agents as versioned, publishable app definitions executing on one shared runtime, with the definition (prompt, tools, model) as data rather than code. This spec deliberately rejects the LangGraph-style user-visible graph DSL — Open Mercato already has a workflow engine for multi-step orchestration (`INVOKE_AGENT` chains); an agent definition here stays a flat declaration (prompt, tools, skills, sub-agents, outcome schema), never a second graph language.

## Problem Statement

1. **The general-purpose execution path does not scale.** File-defined agents — the primary authoring model — execute on a single OpenCode container with per-run SSE, polling, and session-token overhead; dozens of concurrent runs saturate it and hundreds are impossible (analysis §B2). OpenCode is a coding-agent product bent into a role it was not designed for.
2. **No full trace for in-process runs.** `runInProcess` writes only the `AgentRun` envelope; per-step LLM calls and tool invocations are invisible in the trace inspector because object mode discards the AI SDK's step records (`agent-runtime.ts:1991-2014`). Operators debugging a misbehaving agent see input and output, nothing between.
3. **No provider throttling.** Opening worker concurrency to reach the target parallelism converts capacity into unmanaged 429s: no retry, no backoff, no per-provider budget exists in `packages/ai-assistant` or the orchestrator.
4. **Agents can only be authored by developers.** Both runtimes load from build-time artifacts (code `ai-agents.ts`, committed file-agent manifest). A business admin cannot create, version, or iterate an agent without a deploy; the Phase-0 findings deferred tenant-authored agents solely because of OpenCode's multi-tenant container-isolation problem (§14.4) — a problem the native runtime does not have.
5. **Two runtimes cost double.** Every overlay (trace, identity, guardrails-to-come, attachments-to-come) must be built and tested twice; the OpenCode half carries its own entity (`AgentRunSession`), migrations, MCP outcome tools, generator emission, container delivery, and ops runbook.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| `native` = the existing in-process engine, extracted into `NativeAgentRunner` and made the dispatch target for `'native'` **and** `'in-process'` (accepted alias) | `runInProcess` already does guardrails, context, deadline, admission, persistence. Extraction + a runtime value is the whole "new runtime"; `'in-process'` remains accepted so the `AgentRegistryEntry.runtime` union stays ADDITIVE-ONLY per `BACKWARD_COMPATIBILITY.md`. |
| Span capture via one **additive** `ai-assistant` change: the object-mode `enableTools` branch forwards `loop.onStepFinish` and returns the AI SDK `steps` on the result | The chat path already has the full `LoopStepRecord`/`buildLoopTraceCollector` machinery (`agent-runtime.ts:609`); object mode just never wired it. Additive optional fields — existing callers byte-for-byte unchanged. |
| Spans written **post-run, best-effort, via `ingestTrace(em, scope, { runtime: 'native', externalRunId: runId, … })`** | `ingestTrace` is directly callable, idempotent on `(runtime, externalRunId)`, caps jsonb at 4000 chars, and is exactly how the OpenCode runner already persists its trace (`openCodeAgentRunner.ts:272-299`). Async post-run write keeps the hot path free (analysis §B6: write fragmentation is the existing per-run cost center). Always-on per the gate; failure to write spans never fails the run. |
| **Per-provider budget**: process-local semaphore per provider id + retry-on-429/overloaded (exponential backoff + jitter), wrapped around the model call inside the runner; budget exhaustion beyond the run deadline surfaces as the existing retryable-capacity contract | Mirrors the admission gate's proven process-local design (`lib/runtime/admission.ts`). Provider identity comes from the model factory's resolution (`resolveModel`), so the budget keys match reality. Retries consume the run's own `OM_AGENT_RUN_TIMEOUT_MS` deadline — no unbounded retry tail. The structural `retryable: true` marker reuses the queue-retry seam shipped in the performance-hardening PR. |
| File agents compile to `runtime: 'native'`; the generator stops emitting `docker/opencode/{agents,skills}` after the bridge window; `AGENT.md`/`OUTCOME.md`/skills/sub-agents/`tools/*.ts` conventions unchanged | The manifest → `compileOutcome` → `registerFileAgent` pipeline is runtime-agnostic today (`defineAgent.ts:300-369`); only the registered `runtime` value and the docker emission change. Authors notice nothing. |
| `load_skill` / `run_skill_script` become **runtime-agnostic tools**: active-agent resolution falls back from the MCP session store to the in-process `runContext` (`getCurrentRunId()` → run → agent) | The underlying functions (`getAgentSkill`, `runSandboxedScript`) have no MCP dependency; only the session-token correlation wiring is OpenCode-specific. Progressive skill disclosure and sandboxed scripts then work identically on native. `submit_outcome` is not ported — native returns structured output directly against the compiled schema, which is strictly stronger. |
| Sub-agents on native = the existing `delegate_agent` (depth cap 1, informative-only, `parent_run_id` stamped) | Already enforced in-process (`ai-tools.ts`), and native sub-agent runs get per-run `AgentRun` rows — closing the documented OpenCode gap where `task`-delegated sub-agents were never recorded. |
| **OpenCode decommission follows the full deprecation protocol**: one minor version where `runtime: 'opencode'` still dispatches (with a loud deprecation warning), then removal of the runner, client, session store, MCP outcome tool, container delivery, and compose services; the `agent_run_sessions` table is retired by migration after the bridge | Maintainer decision at the gate. The bridge window keeps mid-deploy runs and any out-of-tree `runtime: 'opencode'` registrations working; RELEASE_NOTES documents the timeline. The ai-assistant MCP/Code-Mode stack **stays** (it serves MCP clients generally); only `opencode-client.ts`/`opencode-handlers.ts` and the `openCodeClient` DI registration go. |
| **`AgentDefinition` + `AgentDefinitionVersion`** entities, adapting `workflow_definitions`' versioning semantics (lifecycle + latest-published resolution; structurally a parent + immutable-child pair rather than workflows' single-table shape): unique `(organization_id, slug)` on the parent, immutable version rows unique on `(agent_definition_id, version)`, `lifecycle: draft → published → archived`, unpinned resolution = latest published | The pattern just shipped and survived review in workflows (`entities.ts:156-199`, `find-definition.ts:41-72`). Runs stamp the resolved version into the existing `agent_runs.agent_version` column (already present, unused). |
| Custom agents are namespaced **`custom.<slug>`** and resolve through a **separate org-scoped resolver**, never the global registry `Map` | The global registry is process-wide and tenant-blind (`defineAgent.ts:119`); inserting tenant rows would leak definitions across tenants and collide with code agents. Resolution order in `agentRuntime.run`: global registry first (code/file), then the scoped resolver for `custom.*` ids — cached per org (see cache decision below) with tag invalidation on **every** definition write path — publish, update, delete, and enable/disable — plus a 60 s TTL as the cross-process fallback (publish-to-effect latency is therefore ≤ 60 s worst case). |
| The compiled-entry cache is a **per-process in-memory LRU** (event-invalidated + 60 s TTL), never the shared Redis-backed DI cache | Compiled entries contain the *decrypted* document (instructions, examples, script sources) — placing that plaintext in a shared Redis would partially defeat the at-rest encryption declaration. A per-process map bounded by org count is tiny, and the invalidation events are `clientBroadcast`-grade platform events every process observes. |
| Every `AgentDefinition` gets an auto-provisioned **execution principal at creation** (`provisionAgentPrincipal` keyed by the agent id `custom.<slug>`, idempotent), starting with an empty-feature role and re-scoped at every publish (and publish-undo) from the version's least-privilege `grantedFeatures`; workflow-invoked runs bind `runAs` through the existing bridge resolution untouched — **and draft playground test runs bind the same principal**, so no tenant-authored prompt ever executes without the agent-actor no-bypass enforcement | Identical to the Agentic Tasks decision and zero new identity code: the bridge already resolves principals by agent id (`invokeAgentForWorkflow.ts:119`). Provisioning at creation (not first publish) closes the gap where a pinned-draft test run would otherwise execute with no `runAs` (fail-open in `resolveRunAs`) and caller-attributed writes. A creator cannot grant features they do not hold (server-side check against the caller's ACL). |
| Custom-agent tool selection is restricted to **registered, `isMutation: false`** tool ids, re-validated at publish AND at run resolution with the same fail-closed predicate file agents use (`loadMutationToolPredicate`) | Propose-only stays structural for UI agents: even a maliciously edited definition row cannot reach a mutation tool. UI-authored *custom code* is allowed only as sandboxed skill scripts (pure `run(args)`, `isolated-vm`, 30 s/32 MB) — never native tool files. |
| Custom-agent skills are **embedded in the version document** (instructions/template/examples/scripts as jsonb) and carried **inside the compiled, org-scoped cached entry** — the `load_skill`/`run_skill_script` runContext fallback resolves skill content from the active run's compiled entry, NEVER from the global `registerAgentSkills` map (which remains file/code-agent-only: build-time, tenant-invariant content) | Avoids a second skill entity + sync problem in v1; the version row is the atomic, immutable unit of what the agent knows. Critically, it keeps tenant data out of the module-level skill `Map` (`fileAgentSkills.ts:36`), which is keyed by agent id alone — org A and org B can both own `custom.lead-scorer`, so routing custom skills through it would serve one org's instructions/scripts to the other (and a mid-run publish would tear a running agent's skill set). Shared/reusable skill libraries are an explicit non-goal for v1. |
| Actionable custom agents default to human review: the builder cannot set an auto-approve threshold until the tenant admin explicitly enables it for that definition | Guardrails overlay (#5) is unbuilt; `alwaysAsk` is the fail-closed disposition posture for prompts authored outside code review. Informative agents are unrestricted. |
| No new execution engine, no graph DSL, no per-agent processes | The loop is the AI SDK loop with the shipped loop-controls layer; multi-agent orchestration remains the workflow engine's job (`INVOKE_AGENT`). |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Scale OpenCode instead (container pool, shared SSE, NOTIFY outcomes — analysis Phase-2 items) | Pays ongoing container-fleet ops + upstream version coupling to keep a coding-agent product in a general-purpose role; per-run cost floor (session, token, SSE) remains far above a pending promise. Pooling was the fallback plan only while no native runtime existed. |
| Keep OpenCode as opt-in runtime alongside native | Rejected at the gate (full replacement). Would keep every overlay dual-runtime forever and keep the container in the ops surface for a capability audit shows nothing shipped actually uses. |
| A bespoke agent loop (own tool-calling protocol) | The AI SDK loop + loop-controls is battle-tested and already carries budget/step controls; a bespoke loop re-derives provider quirks for zero differentiator. The value is the layer above (definitions, versioning, trace, budgets). |
| Distributed (Redis) provider budget | A process-local budget × fleet size bounds the aggregate well enough at this scale (same argument as the admission gate); a Redis token bucket is a follow-up if observed 429 rates demand exact global limits. |
| Separate spec for UI-authored agents | Rejected at the gate (bundled). Phasing below preserves independent shippability: Phases 1–3 (runtime + migration) ship with zero dependency on Phases 4–5 (custom agents + UI). |
| Storing custom agents in the global registry with tenant-prefixed ids | Tenant data in a process-global, request-scope-blind structure is a cross-tenant exposure class waiting to happen; a scoped resolver keeps tenancy enforcement in one queryable place. |

## Architecture

```
callers (playground / INVOKE_AGENT worker / agentic tasks / scripts)
        │  agentRuntime.run(agentId, input, ctx)          [unchanged call surface]
        ▼
  resolveAgentEntry(agentId, scope)
        ├─ global registry (code defineAgent + file manifest)      [existing Map]
        └─ custom.* → scoped resolver → AgentDefinitionVersion      [NEW]
              (org-scoped query, latest published or pinned version,
               DI-cache per org + tag invalidation on publish, TTL fallback,
               compileOutcome(schema); skill content embedded in the
               compiled entry — never the global skill Map)
        ▼
  admission gate (existing: global + per-tenant, nested bypass)
        ▼
  ┌──────────────────────── NativeAgentRunner ────────────────────────┐
  │ createRun (runtime:'native', externalRunId := runId,              │
  │            agentVersion stamped)                                  │
  │ context assembly · input guardrail hook · resolveCallerAcl       │
  │ deadline race (OM_AGENT_RUN_TIMEOUT_MS)                           │
  │   └─ provider budget acquire ──► runAiAgentObject                 │
  │        (per-provider semaphore,     enableTools, loop.onStepFinish│
  │         429 retry + backoff)        → step records collected)     │
  │ output guardrail hook · schema.safeParse · shapeResult            │
  │ completeRun (+ createProposal → disposition, unchanged)           │
  │ post-run, best-effort: ingestTrace({runtime:'native',             │
  │   externalRunId: runId, spans: steps→spans, toolCalls})           │
  └───────────────────────────────────────────────────────────────────┘

  'opencode' dispatch → deprecation bridge (1 minor version) → removed
```

**Scale model.** Runs execute wherever `agentRuntime.run` is awaited — primarily the `workflow-invoke-agent` queue workers (shipped) and the future agentic-tasks worker. Concurrency = worker replicas × per-worker concurrency, bounded by (in order): queue concurrency → admission gate (global/tenant) → provider budgets → run deadline. The scaling runbook (`apps/docs/docs/deployment/agent-orchestration-scaling.mdx`) gains a "hundreds in parallel" section: e.g. 5 worker replicas × concurrency 20 = 100 concurrent runs ≈ 100 pending LLM promises and ~100 pooled DB connections *worst case* — which is why the runbook pairs the example with `OM_WORKERS_DB_CONNECTION_BUDGET`/pgbouncer guidance.

**Trace mapping.** `createRun` stamps `externalRunId = runId` (the field already exists on the create command, `commands/runs.ts:23`) so the post-run `ingestTrace` call **upserts onto the same `AgentRun` row** via the `(runtime, externalRunId)` unique — without this, ingest would create a second, forever-`running` shadow run carrying all the spans. The ingest payload carries spans only (no run-level `status`/`output` fields), so the found-run update path can never regress the completed run's state. Each AI SDK step → one `llm` span (sequence, timings, token usage in `attributes`); each tool call within a step → one `tool` span child + one `AgentToolCall` row (name, capped request/response summaries, latency, status); guardrail/context phases → `system` spans. `externalSpanId` derives deterministically from `runId:seq[:tool-idx]` so re-ingest attempts stay idempotent.

### Commands & Events

- **Commands** (all audited, undoable unless noted): `agent_orchestrator.agent_definition.create` / `.update` / `.delete` (soft), `.publish` (creates the immutable version row + re-scopes the execution principal's role from the version's `grantedFeatures`; undo reverts the published pointer to the prior version **and re-scopes the principal's role back to that version's `grantedFeatures`** — restoring the pointer without the grants would leave an over-privileged principal serving the older version; the version row itself is never deleted), `.archive_version`.
- **Events** (`events.ts`, `as const`): `agent_definition.created` / `.updated` / `.deleted` / `.published` (`clientBroadcast: true`); **all four** of `.created`/`.updated`/`.deleted`/`.published` (update covers enable/disable) invalidate the scoped resolver's cache tag, `agent_definition_version.archived`. Run-lifecycle events are unchanged (`run.created`/`run.completed`/`run.ingested` fire exactly as today).

## Data Models

### `AgentDefinition` (`agent_definitions`) — editable, optimistic-locked
- `id` uuid PK; `tenant_id`, `organization_id` uuid
- `slug` varchar(100) — agent id is `custom.<slug>`; unique `(organization_id, slug)`
- `label` varchar(200), `description` text
- `published_version` int nullable — unpinned resolution target; null = never published
- `execution_principal_id` uuid — set at creation via `provisionAgentPrincipal` (empty-feature role until first publish)
- `allow_auto_approve` boolean default false — admin opt-in gate for threshold disposition
- `enabled` boolean default true; `created_by` uuid; `created_at`, `updated_at`, `deleted_at`
- Indexes: `(tenant_id, organization_id)`, unique `(organization_id, slug)`

### `AgentDefinitionVersion` (`agent_definition_versions`) — immutable after publish
- `id` uuid PK; `tenant_id`, `organization_id` uuid; `agent_definition_id` uuid (FK id)
- `version` int; unique `(agent_definition_id, version)`
- `lifecycle` varchar(20) — `'draft' | 'published' | 'archived'` (one draft at a time per definition, enforced by a partial unique index `(agent_definition_id) WHERE lifecycle = 'draft'`; publishing freezes it)
- `document` jsonb — **encrypted** — the full definition: `{ instructions, resultKind, outcomeSchema (JSON-Schema subset), tools: string[], skills: [{ id, label, instructions, template?, examples?, scripts?: [{name, source}] , tools?: string[] }], subAgents: string[], provider?, model?, maxSteps?, facts?, sampleInput?, grantedFeatures: string[] }`
- `published_at` timestamptz nullable, `published_by` uuid nullable; `created_at`, `updated_at`
- Indexes: `(tenant_id, organization_id)`, `(agent_definition_id, lifecycle)`

**Validation at save/publish** (zod, `data/validators.ts`): `outcomeSchema` restricted to the OUTCOME subset (`compileOutcome` must succeed); every tool id registered and `isMutation: false` (fail closed on unknown); `subAgents` resolve to informative agents with no own sub-agents (depth cap 1); skill scripts parse as a `run(args)` sandbox source; `grantedFeatures ⊆` the publishing caller's own effective features.

**Encryption** (`encryption.ts` additions): `agent_orchestrator:agent_definition_version.document` (instructions and examples routinely embed business/PII text). Reads via `findOneWithDecryption`; the resolver caches the *compiled* entry, not raw rows.

No changes to `agent_runs` / `agent_spans` / `agent_tool_calls` — `agent_runs.agent_version` (present; today written only by the trace-ingest path when a payload supplies it — `traceIngestionService.ts:151`) and the `(runtime, external_run_id)` unique already exist. `agent_run_sessions` is dropped by migration in the decommission phase (after the bridge window; table verified empty first).

## API Contracts

All under `/api/agent_orchestrator/`, all exporting `openApi`; new ACL features `agent_orchestrator.definitions.view` / `.manage` / `.publish` (+ `setup.ts` `defaultRoleFeatures`, then `yarn mercato auth sync-role-acls`).

- `GET/POST /definitions`, `GET/PUT/DELETE /definitions/:id` — `makeCrudRoute` CRUD over `AgentDefinition` (+ current draft document), `defaultSort: created_at DESC`, `pageSize ≤ 100`. Optimistic locking keys on the **parent** `AgentDefinition.updatedAt`, and every draft-document write touches the parent's `updated_at` in the same transaction — so two concurrent draft edits cannot both pass a stale-header check even though the edited content lives in the child version row.
- `POST /definitions/:id/publish` — custom write (mutation-guard contract): validates the draft, freezes it as the next `version`, updates `published_version`, provisions/re-scopes the execution principal from `grantedFeatures`, emits `.published`. Requires `.publish`.
- `GET /definitions/:id/versions` — read-only version history.
- `GET /agents` (existing) — gains `source: 'code' | 'file' | 'custom'` and includes the caller's org's published custom agents; `GET /agents/:id` and `POST /agents/:id/run` accept `custom.*` ids transparently (dispatch is encapsulated in `agentRuntime.run`). The run route also accepts optional `version` (pinned playground testing of drafts requires `.manage`).
- Existing `/runs`, `/runs/:id`, trace inspector: unchanged — native runs appear with `runtime: 'native'` and full span trees.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `OM_AGENT_PROVIDER_MAX_CONCURRENT` | `10` | Per-provider process-local concurrent LLM-call cap (all providers). |
| `OM_AGENT_PROVIDER_MAX_CONCURRENT_<PROVIDER>` | — | Per-provider override (e.g. `_ANTHROPIC`). |
| `OM_AGENT_PROVIDER_RETRY_MAX` | `4` | Max retries on 429/overloaded before surfacing as retryable failure. |
| `OM_AGENT_PROVIDER_RETRY_BASE_MS` | `1000` | Backoff base (exponential + full jitter), always bounded by the run deadline. |
| `OM_AGENT_TRACE_CAPTURE` | `on` | Escape hatch (`off`) for span capture; always-on is the contract default. |

Existing knobs unchanged and now the primary fleet levers: `WORKERS_WORKFLOW_INVOKE_AGENT_CONCURRENCY`, `OM_AGENT_MAX_CONCURRENT_RUNS[_PER_TENANT]`, `OM_AGENT_RUN_TIMEOUT_MS`, `OM_WORKERS_DB_CONNECTION_BUDGET`. Removed at decommission: `OPENCODE_URL`, `OPENCODE_PROVIDER/MODEL/MCP_URL/PORT`, `OM_OPENCODE_RUN_TIMEOUT_MS` (RELEASE_NOTES documents each). Runbook updated with the hundreds-parallel sizing worked example.

## Internationalization (i18n)

New keys under `agent_orchestrator.definitions.*` in `i18n/{en,es,de,pl}.json`: builder page copy, version/lifecycle labels, publish dialog, validation errors (unknown tool, mutation tool rejected, schema subset violation, sub-agent depth, feature-escalation), provider-budget error (`errors.provider_capacity`). `[internal]` prefix for internal-only throws.

## UI/UX

- **`backend/definitions`** (list): `DataTable` over `/definitions` — slug, label, published version, lifecycle badge (`StatusBadge`, DS status tokens), enabled, last-run status. Row actions: Edit draft, Publish, Test in playground, Delete.
- **Builder** (`backend/definitions/[id]`): sectioned form (`CrudForm` where it fits; custom sections via `useGuardedMutation`) — instructions editor; result kind + OUTCOME schema editor (validated live against the subset compiler); **tools picker** (registered read-only tools only, ACL-filtered to what the caller may grant); skills editor (instructions/template/examples/sandboxed scripts); sub-agents picker (informative agents across sources); model/provider selects; facts editor (`FACTS.json` shape); **permissions section** = the `grantedFeatures` least-privilege picker feeding the execution principal; disposition section showing the `alwaysAsk` default with the admin-gated auto-approve opt-in. `Cmd/Ctrl+Enter` submit, `Escape` cancel on dialogs.
- **Version timeline**: read-only list with publish metadata; "restore as draft" copies an old version's document into the draft.
- **Playground**: custom agents appear with a `source` tag; draft testing pins `version`. Trace inspector works unchanged.
- User-authored content (instructions, examples, templates) renders as **plain text** everywhere (builder, version timeline, trace inspector) — never as HTML/markdown-to-HTML without sanitization.
- All status coloring via DS tokens; lucide-react icons; `LoadingMessage`/`ErrorMessage`/`EmptyState` boundaries. (Backend-shell pages under the module's existing `backend/` convention — client pages match the module's current architecture; no new app-router surface.)

## Dependencies & Prerequisites

- **`ai-assistant` object-mode step exposure** — the one cross-package prerequisite (Ask First): forward `loop.onStepFinish` and return `steps` in the `enableTools` branch (`agent-runtime.ts:1991-2014`). Additive optional fields; the chat path's `LoopStepRecord` shape is reused for the payload.
- Identity overlay, admission gate, dedicated invoke-agent queue, trace/eval tables, metric rollups — all shipped on this branch and consumed as-is.
- Guardrails overlay (#5) — **not** a hard prerequisite (fail-closed `alwaysAsk` posture instead), but the recommended fast-follow before broad tenant rollout of actionable custom agents.
- Retention/partitioning (F3/gap-19) — always-on spans at target scale ≈ 50–90M rows/yr; F3 moves from "do last" to "schedule alongside Phase 2 rollout".

## Migration & Backward Compatibility

- **`AgentRegistryEntry.runtime`** union gains `'native'` (additive); `'in-process'` remains accepted and dispatches identically (documented alias); `'opencode'` enters the deprecation protocol: bridge minor version (dispatches to the still-present runner + logs a deprecation warning once per process), `@deprecated` JSDoc, RELEASE_NOTES entry with the removal version, then removal.
- **File agents**: manifest regeneration flips descriptors to `native`; a manifest generated before the flip still loads (loader maps `opencode` → bridge). `docker/opencode/` emission stops in the same release the bridge starts; the committed `docker/opencode/agents|skills` artifacts and compose services are deleted at decommission.
- **MCP tools**: `submit_outcome` deprecated with the bridge (no native caller); `load_skill`/`run_skill_script` gain the runContext fallback and *remain* (they still serve MCP clients); `delegate_agent` unchanged.
- **DB**: additive migrations for the two new tables; `agent_run_sessions` dropped only in the decommission migration after verifying zero rows in the bridge window.
- **Stored `agent_runs.runtime` values**: new in-process runs persist `'native'` going forward; historical rows keep `'in-process'`. Runs-list filters, rollups, and dashboards MUST treat the two labels as one cohort (a shared `NATIVE_RUNTIME_VALUES` constant used by the runs route filter + metric rollup service); RELEASE_NOTES documents the label change.
- **No API removals**; `/agents` response gains fields additively. Playground/bridge callers are runtime-agnostic already (verified: dispatch fully encapsulated).

## Implementation Plan

### Phase 1 — `NativeAgentRunner` + full trace *(independently shippable)*
1. `ai-assistant`: additive `onStepFinish` forwarding + `steps` on the object-mode `enableTools` result (+ unit tests; existing-caller regression test proving unchanged behavior without the options).
2. Extract `runInProcess` into `lib/runtime/nativeAgentRunner.ts`; register `'native'` in the runtime union + dispatch; `defineAgent` emits `runtime: 'native'`; `'in-process'` aliases.
3. Step-record → span mapping + post-run best-effort `ingestTrace` (`runtime: 'native'`, deterministic span ids); `OM_AGENT_TRACE_CAPTURE` escape hatch.
4. Tests: span rows for a multi-step tool run (counts, sequence, token attrs, idempotent re-ingest); trace failure never fails the run; existing agent_orchestrator suite green.

### Phase 2 — Provider budgets + fleet enablement
1. `lib/runtime/providerBudget.ts` (semaphore per resolved provider id, retry-on-429/overloaded with jittered backoff bounded by the run deadline; exhaustion → structural `retryable: true` error, mapped like `AgentCapacityError` at the playground route and queue).
2. Wire into `NativeAgentRunner` around the model call; provider id from the model-factory resolution.
3. Runbook: "hundreds in parallel" sizing section; monitoring additions (429 retry rate, budget wait time, span-ingest lag).
4. Tests: budget caps concurrent calls per provider while other providers proceed; retry/backoff timing (fake timers); deadline bound; retryable surfacing.

### Phase 3 — File agents on native + OpenCode deprecation bridge *(cli + enterprise; Ask First for generator output changes)*
1. Generator: descriptors emit `runtime: 'native'`; stop writing `docker/opencode/{agents,skills}`; keep parsers/validation identical.
2. `loadFileAgents`: register native; map legacy `opencode` descriptors through the bridge with a deprecation warning.
3. `load_skill`/`run_skill_script`: runContext fallback for active-agent resolution (in-process path); tests for both resolution modes; `submit_outcome` marked `@deprecated`.
4. E2E: the shipped example file agents (`deals.health_check`, `support.resolution_advisor`) run natively with skills, sandboxed scripts, and sub-agent fan-out; full span trees visible.
5. RELEASE_NOTES: bridge + removal timeline.

### Phase 4 — Custom agent definitions (entities → resolver → principal)
1. Entities + migrations + snapshot; `encryption.ts`; validators (subset compiler, tool gate, depth cap, feature-subset check).
2. Commands (CRUD + publish with undo semantics above); events; ACL features + setup grants.
3. Scoped resolver (`lib/registry/customAgentResolver.ts`): org-scoped latest-published/pinned lookup → compiled `AgentRegistryEntry` (+ `registerAgentSkills`), DI-cache with publish-event tag invalidation + TTL fallback; `resolveAgentEntry` seam in `agentRuntime.run` for `custom.*` ids.
4. Execution principal at publish (`provisionAgentPrincipal` keyed `custom.<slug>`); bridge `runAs` resolution works unchanged.
5. API routes (CRUD, publish, versions; `/agents` merge with `source`).
6. Tests: cross-tenant denial on every surface; stale-cache invalidation on publish; mutation-tool rejection; feature-escalation rejection; version pinning; `agent_runs.agent_version` stamping.

### Phase 5 — Builder UI + publish flow
1. `backend/definitions` list + builder + version timeline + publish dialog (per UI/UX section); playground `source`/draft-pin integration.
2. i18n (en/es/de/pl); `yarn i18n:check-sync`.
3. Integration tests per the coverage table.

### Phase 6 — OpenCode decommission *(the minor version after Phase 3 ships; Phases 4–5 may ship during the bridge window — they have no dependency on the removal)*
Remove: `openCodeAgentRunner.ts`, `agentRunSessionStore.ts` + `AgentRunSession` entity (+ drop migration after zero-row check), `submit_outcome`, `opencode-client.ts`/`opencode-handlers.ts` + `openCodeClient` DI registration, `docker/opencode/`, compose services, env vars, `om-create-opencode-agent` skill (replaced by an `om-create-native-agent` update), AGENTS.md/docs sections. Final compliance sweep on `BACKWARD_COMPATIBILITY.md`.

## Integration Coverage

> `packages/enterprise/src/modules/agent_orchestrator/__integration__/TC-AGENT-NATIVE-<NNN>.spec.ts`; fixtures via API where possible, direct-DB via the established `agentPerfFixtures` pattern otherwise; all self-contained with teardown; `OM_ENABLE_ENTERPRISE_MODULES=1`.

| Path / flow | Must-have tests |
|---|---|
| Native run end-to-end | Playground run of a code agent on `native` → `AgentRun(runtime='native')` + span tree (llm/tool spans, sequences, token attrs) + proposal/disposition identical to before |
| File agent on native | Example file agent with skill + sandboxed script + sub-agent completes; sub-agent gets its own `AgentRun` with `parent_run_id`; `load_skill`/`run_skill_script` resolve via runContext |
| Provider budget | Forced-low budget: N+1th concurrent call queues; 429-simulating stub retries with backoff then surfaces retryable; other-provider runs unaffected *(env-gated where the shared env can't restart — documented in the ENV-README pattern)* |
| Definitions CRUD + publish | Draft → publish creates immutable version, bumps pointer, provisions principal scoped to `grantedFeatures`; publish with a mutation tool / unknown tool / over-granted features → 400; optimistic-lock 409 |
| Custom agent run | Published `custom.<slug>` runs via playground and via `INVOKE_AGENT` (runAs = its principal); run stamps `agent_version`; re-publish + cache invalidation → next run uses the new version |
| Disposition posture | Actionable custom agent without admin opt-in always raises `USER_TASK` regardless of confidence |
| Deprecation bridge | A `runtime:'opencode'` registry entry still dispatches during the bridge and logs the deprecation warning |
| Publish-undo principal scoping | Publish v2 with broader `grantedFeatures`, undo → principal's role re-scoped to v1's grants (asserted via RoleAcl), pointer back at v1 |
| **Tenant isolation (mandatory)** | Org B: 404/403 on org A's definitions/versions/publish; `custom.<slug>` of org A not resolvable, not listed, not runnable from org B; **same-slug-two-orgs skill isolation**: both orgs publish `custom.lead-scorer` with different skills — each org's runs resolve only their own skill content (and a concurrent publish never tears a running agent's skills); two-org harness with positive control |

## Risks & Impact Review

#### Stale published version served by a worker (cache invalidation miss)
- **Scenario**: publish lands; a worker process misses the invalidation event and runs the old version.
- **Severity**: Medium. **Mitigation**: event-driven tag invalidation + short TTL fallback + `agent_version` stamped on every run (drift is visible, not silent); publish-to-effect latency documented as ≤ TTL. **Residual**: Low.

#### Cross-tenant definition leak via the resolution seam
- **Scenario**: a bug lets `custom.*` resolution skip org scoping or a compiled entry land in the global Map.
- **Severity**: Critical. **Mitigation**: custom entries never enter the global agent registry OR the global skill `Map` by construction — both the compiled entry and its skill content live only in the org-scoped resolver cache, and the skill-tool runContext fallback reads from the active run's compiled entry; org filter in the single resolver query; mandatory two-org denial tests on list/get/run/publish **plus the same-slug-two-orgs skill-isolation case**. **Residual**: Low.

#### Over-privileged or injected custom agent
- **Scenario**: a crafted prompt or over-granted principal lets a custom agent propose harmful actions that get rubber-stamped.
- **Severity**: High. **Mitigation**: read-only-tools-only (fail-closed gate at publish + resolve), least-privilege principal ⊆ creator's features, `alwaysAsk` default with admin-gated auto-approve, audited disposition trail; guardrails overlay as fast-follow. **Residual**: Medium — human-review dependence until guardrails land; accepted at the gate.

#### Provider-budget starvation or retry storms
- **Scenario**: one tenant's burst exhausts a provider budget; retries synchronize and hammer the provider.
- **Severity**: Medium. **Mitigation**: per-tenant admission cap runs *before* the provider gate; full-jitter backoff; retries bounded by the run deadline; budget wait time in monitoring. **Residual**: Low-Medium (process-local budgets multiply by fleet size — documented, Redis token bucket as follow-up if needed).

#### Span volume outpaces retention
- **Scenario**: always-on tracing at hundreds of parallel runs grows `agent_spans`/`agent_tool_calls` beyond comfortable un-partitioned size within months.
- **Severity**: Medium. **Mitigation**: 4000-char caps + async batched writes already bound row size/hot-path cost; F3 partitioning/retention explicitly re-prioritized alongside Phase 2; `OM_AGENT_TRACE_CAPTURE=off` escape hatch. **Residual**: Low with F3 scheduled.

#### Decommission breaks an unshipped OpenCode dependency
- **Scenario**: an out-of-tree module registered `runtime:'opencode'` agents and breaks at removal.
- **Severity**: Low. **Mitigation**: one-minor bridge with loud warnings; RELEASE_NOTES timeline; the loader maps legacy descriptors through the bridge rather than failing. **Residual**: Low.

### Blast radius
Phases 1–2 touch only the dispatch interior of `agentRuntime` (+ one additive ai-assistant option); callers are verified runtime-agnostic. Phase 3 changes generator output and the registered runtime of file agents but no authoring surface. Phases 4–5 are additive entities/APIs/UI. Phase 6 removes only inventory verified OpenCode-exclusive (the MCP/Code-Mode stack stays). The propose-only contract, disposition, resume seam, and persistence tail are untouched throughout.

## Final Compliance Report — 2026-07-07

### AGENTS.md Files Reviewed
Root; `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`; `packages/ai-assistant/AGENTS.md`; `packages/core/AGENTS.md` (commands/encryption/setup); `packages/queue/AGENTS.md`; `packages/shared/AGENTS.md`; `packages/ui/AGENTS.md`; `packages/cli/AGENTS.md`; `BACKWARD_COMPATIBILITY.md`; `2026-06-19-agent-orchestrator-conventions.md`; `.ai/specs/AGENTS.md`.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| module AGENTS.md | Propose-only; writes only via proposal→disposition→effector | Compliant | Native inherits read-only tool stripping structurally; custom agents add a second fail-closed mutation-tool gate |
| module AGENTS.md | Dispatch through DI (`agentRuntime`), never lib calls | Compliant | Call surface unchanged; resolver lives behind `agentRuntime.run` |
| module AGENTS.md | Trace rows append-only; OUTCOME schema subset only | Compliant | `ingestTrace` reuse; custom outcome schemas validated by the same compiler |
| module AGENTS.md | New MCP-tool features reuse `agents.run`; new acl features into setup | Compliant | No new MCP tools; `definitions.*` features + setup grants + sync command |
| BACKWARD_COMPATIBILITY.md | Deprecation protocol on contract surfaces | Compliant | Runtime union additive; `'opencode'`, `submit_outcome`, env vars, container delivery all bridged one minor version with RELEASE_NOTES |
| root AGENTS.md | Tenant scoping everywhere; no cross-tenant exposure | Compliant | Scoped resolver + mandatory two-org tests; custom entries never in the global Map |
| root AGENTS.md | Optimistic locking on new editable entities | Compliant | `AgentDefinition` (and draft versions) carry `updated_at`; published versions immutable |
| core AGENTS.md → Encryption | PII columns declared + decrypted reads | Compliant | `agent_definition_version.document` encrypted |
| core AGENTS.md → Commands | Audited commands, undo default | Compliant | CRUD + publish commands; publish-undo reverts the pointer, never deletes versions |
| shared/queue AGENTS.md | Queue/worker + connection-budget discipline | Compliant | No new queues; fleet sizing via existing invoke-agent queue + runbook |
| ui AGENTS.md / DS rules | Canonical primitives, DS tokens, dialog keys | Compliant | Specified throughout UI/UX |
| ai-assistant AGENTS.md | Loop controls precedence; no `Promise.race` on sends | Compliant | Object-mode change is additive option forwarding; deadline race pattern reuses the shipped runner hygiene |

### Internal Consistency Check

| Check | Status |
|---|---|
| Data models ↔ API contracts | Pass |
| API contracts ↔ UI/UX | Pass |
| Risks cover every new write/resolution path | Pass |
| Commands defined for all mutations | Pass |
| Phasing preserves independent shippability of runtime vs custom agents | Pass (P1–3 vs P4–5; P6 gated on P3+1 minor) |

### Verdict
**Compliant after independent review** — a fresh-context adversarial review (2026-07-07) verified 14/14 spot-checked code claims and surfaced 1 Critical + 2 High + 4 Medium findings, all resolved by revision in this document (see Changelog). Ready for `om-pre-implement-spec`, pending the two Ask First sign-offs flagged inline (ai-assistant object-mode change; generator output change).

## Changelog

### 2026-07-12 — Phases 1–2 implemented

**Phase 1 (`NativeAgentRunner` + full trace) and Phase 2 (provider budgets) are code-complete** on `feat/agent-orchestrator-mvp`; Phases 3–6 (file agents on native, custom definitions, builder UI, OpenCode decommission) remain open.

- **ai-assistant (additive, Ask First approved in-session)**: the object-mode `enableTools` branch of `runAiAgentObject` now wires `buildLoopTraceCollector` — forwarding the caller's `loop.onStepFinish` (previously dropped) and returning the collected `LoopStepRecord[]` as an optional `steps` field on the generate result. Existing callers byte-for-byte unaffected; 5 new unit tests incl. no-loop and toolless-path regressions.
- **Extraction + dispatch**: `runInProcess` extracted to `lib/runtime/nativeAgentRunner.ts`; error classes moved to `lib/runtime/errors.ts` (re-exported from `agentRuntime.ts` for BC); `AgentRuntime` union gains `'native'` (additive; `'in-process'` dispatches identically as the documented alias); `defineAgent` registers `runtime: 'native'`; `NATIVE_RUNTIME_VALUES` cohort constant exported; `/agents` route enums updated additively.
- **Run stamping (H2)**: `agent_orchestrator.runs.create` gained additive `stampExternalRunIdFromId` — pre-generates the run uuid and stamps `externalRunId = id` in one insert; the native runner sets it plus `runtime: 'native'`, so post-run ingest upserts onto the real row. Subsumes F8 for native runs.
- **Always-on span capture**: `lib/runtime/nativeTraceCapture.ts` — per-step records collected via the forwarded `onStepFinish` hook (so partial traces survive failed runs), mapped to deterministic `<runId>:<seq>[:<toolIdx>]` span ids (llm span per step with token/finish-reason attributes; child tool span + `AgentToolCall` row per tool call; one synthetic llm span for toolless runs), written post-run fire-and-forget through `ingestTrace` with the F1 artifact offloader. Spans-only envelope (no run-level status/output). `OM_AGENT_TRACE_CAPTURE=off` escape hatch. Capture failure never fails a run (double-guarded).
- **Provider budgets**: `lib/runtime/providerBudget.ts` — per-provider semaphore (`OM_AGENT_PROVIDER_MAX_CONCURRENT[_<PROVIDER>]`, default 10), retry on 429/529/503/overloaded with full-jitter exponential backoff (`OM_AGENT_PROVIDER_RETRY_MAX`=4, `OM_AGENT_PROVIDER_RETRY_BASE_MS`=1000), all waits bounded by the run deadline; slot held across retries to prevent synchronized retry storms. Exhaustion throws `AgentProviderCapacityError extends AgentCapacityError` — the structural `retryable: true` queue seam and the playground 429 mapping apply with zero route changes. Budget key resolved via `createModelFactory(...).resolveModel(...)` (fail-open to a shared `'unknown'` bucket).
- **Runbook**: scaling runbook gained "Provider LLM budgets" + "Sizing for hundreds of parallel runs" sections and monitoring additions (429 retry rate, budget wait, span-ingest lag).
- **Validation**: enterprise module 66 suites / 360 tests green (3 new suites: provider-budget, native-trace-capture incl. idempotent re-ingest, native-runner wiring incl. failure-path capture and legacy-alias dispatch); ai-assistant 98 suites / 1338 tests green + package build clean; `tsc --noEmit` clean.
- **Deviations**: (1) `onStepStart` is not forwarded on the tool-loop branch — the AI SDK `generateText` exposes no such hook; `prepareStep` remains the pre-step seam. (2) The cockpit Agents page maps `'native'` to the existing "In Process" label for now — its label map lives in `components/types.ts`, frozen during a parallel work stream; follow-up: add a `'native'` entry there. (3) The runs-list route performs no runtime-cohort filtering today (no `runtime` query filter exists), so `NATIVE_RUNTIME_VALUES` currently documents the contract for future filters/rollups rather than rewiring an existing one.

### 2026-07-07 (revision after fresh-context review)
- **C1 (Critical)**: custom-agent skill content no longer routes through the global `registerAgentSkills` map (tenant-blind, agent-id-keyed — cross-org collision on same slug); it is carried inside the org-scoped compiled entry and resolved from the active run's entry. Tenant-isolation coverage gained the same-slug-two-orgs skill case.
- **H1**: publish-undo now re-scopes the execution principal's role to the restored version's `grantedFeatures` (was: pointer-only revert leaving broader grants live).
- **H2**: `createRun` stamps `externalRunId = runId` so post-run `ingestTrace` upserts onto the real run instead of creating a shadow duplicate; ingest payload constrained to spans-only.
- **M1–M4**: cache invalidation enumerated for all four write paths + 60 s TTL declared; compiled-entry cache restricted to per-process memory (decrypted content never in shared Redis); optimistic locking pinned to the parent `updatedAt` touched transactionally on draft writes; execution principal provisioned at creation so draft test runs always bind `runAs`.
- **L1–L4**: `agent_version` wording corrected (written by trace ingest); "mirroring" → "adapting" for the versioning precedent; stored `runtime` label change (`in-process`→`native`) added to Migration & BC with a shared cohort constant; `pageSize ≤ 100`, plain-text rendering of user-authored content, and the one-draft partial unique index specified.

### 2026-07-07
- Initial specification. Open Questions resolved with the maintainer: **full OpenCode replacement** (bridge + decommission per BC protocol), **bundled scope** (runtime + UI-authored agents/versioning in one spec, phased for independent shippability), **provider budgets in v1**, **always-on async span capture**. Grounded in a code-seam audit (object-mode step-data gap at `ai-assistant/lib/agent-runtime.ts:1991-2014`; directly-callable `ingestTrace`; tenant-blind global registry; `workflow_definitions` versioning precedent; OpenCode-exclusive file inventory) and the 2026-07-06 performance analysis.
