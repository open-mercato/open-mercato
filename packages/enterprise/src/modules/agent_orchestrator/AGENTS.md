# Agent Orchestrator — Agent Guidelines

Use this enterprise module to run **propose-only** AI agents: an agent always returns a typed, validated `AgentResult` (`informative | actionable`), persists an `AgentRun` (+ an `AgentProposal` for actionable results), and never writes domain state directly — every write flows through `proposal → disposition → effector (command)`. Two runtimes coexist behind one registry and one `agentRuntime.run()`; trace/eval/guardrail/context/identity overlays wrap every run.

See `.ai/specs/2026-06-22-opencode-file-defined-agents.md` (+ `-phase0-findings.md`) for the file-agent design, and `.ai/specs/enterprise/agent-orchestrator/` for the baseline, identity, trace-eval, guardrails, and context specs.

## Runtime Selection

| Runtime | When to use | Authoring |
|---------|-------------|-----------|
| `in-process` | Simple typed agents authored as code; fastest path; supports `delegate_agent` sub-agents | `defineAgent` in `ai-agents.ts` (Vercel AI SDK object mode) |
| `opencode` | Agents that need skills, sub-agents, or sandboxed scripts authored as files | File-defined `agents/<id>/` on the OpenCode runtime |

## Always

1. **MUST keep every agent propose-only** — an agent returns `{ kind: 'informative', data }` or `{ kind: 'actionable', proposal }`; domain writes happen ONLY through `proposal → disposition → effector`, never inside the agent or a tool.
2. **MUST dispatch through DI, not lib calls** — resolve `agentRuntime`, `dispositionService`, `guardrailService`, etc. via `container.resolve(...)`; `agentRuntime.run()` switches on `entry.runtime`. Never import and call the runners directly.
3. **MUST persist writes through the Command path** — every domain mutation an agent proposes is applied by an effector via the command bus (`executeProposal.ts`), so audit/undo/cache/events/index stay consistent. Agent principals are `kind='agent'` `auth.User`s whose writes are attributed like a human's.
4. **MUST gate disposition inline** — after `agentRuntime.run()`, `DispositionService` decides: `confidence ≥ threshold` → audited `auto_approved`; otherwise raise a `workflows` `USER_TASK`, park at `WAIT_FOR_SIGNAL`, and resume on `agent_orchestrator.proposal.ready`. Fail closed: missing/null confidence is treated as below threshold.
5. **MUST keep the two propose-only gates intact for file agents** — (1) the generated OpenCode agent file's read-only `tools` allowlist + `permission` deny block, and (2) the per-run session-token ACL re-checked on every MCP call. `loadFileAgents` rejects any agent declaring an `isMutation:true` tool. Never weaken either gate.
6. **MUST keep OUTCOME schemas in the supported JSON-Schema subset** — `object`/`array`/`string`/`number`/`integer`/`boolean`/`nullable`/`const` only. Unsupported keywords (`oneOf`/`anyOf`/`$ref`/`format`/…) fail generation loudly (`lib/sdk/outcomeSchema.ts` compiles to Zod).
7. **MUST run `yarn generate` after editing any `agents/<id>/` file** — it re-emits the committed manifest (`generated/file-agents.generated.ts`) and the container artifacts under `docker/opencode/{agents,skills}/`. Then **restart OpenCode** (`docker compose up -d opencode`) — hot-reload is not guaranteed.
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
- Never give a sub-agent an actionable OUTCOME or its own `subAgents` (depth cap = 1); sub-agents run under the caller's own scope, never escalated.
- Never let an agent write outside its own Command — the fail-closed `agentNoBypassSubscriber` rejects any flush-time write not inside the agent's command path.
- Never expose cross-tenant runs, proposals, traces, or principals; never mutate append-only audit rows.

## Web Egress (`web_search` / `web_fetch`)

Read-only web access for agents (spec `.ai/specs/enterprise/2026-07-11-agent-web-search-tool.md`). Two `defineAiTool`s on the existing `open-mercato` MCP server; agents opt in via `tools: [agent_orchestrator.web_search, agent_orchestrator.web_fetch]` in `AGENT.md` (example: `apps/mercato/src/modules/agent_examples/agents/deal_web_researcher/`).

- **Egress runs server-side** in the OM process via the DI-resolved `webSearchProvider` (`lib/webSearch/`) — never the `isolated-vm` sandbox and never OpenCode's native web tools (still disabled in `docker/opencode/opencode.jsonc`). The sandbox no-net rule and the renderer are untouched; the tools are ordinary `open-mercato_agent_orchestrator_*` ids that ride the existing allowlist.
- **Provider = SearXNG by default** (`@open-mercato/search-provider-searxng`, self-hosted, no key). Keyed adapters (Exa/Tavily) can re-register `webSearchProvider`.
- **Gates:** default-off `agent_orchestrator.web_search` ACL feature (re-checked per MCP call via `requiredFeatures`); always-on SSRF at the socket boundary (blocks private/loopback/link-local/metadata + DNS-rebinding); domain allow/deny; per-run + per-tenant rate ceilings via `rateLimiterService`; result/byte caps. Both tools are `isMutation: false`.
- **Ops env:** `OM_AGENT_WEB_SEARCH_BASE_URL` (SearXNG instance with JSON output; unset → tools return `not_configured`), plus optional `OM_AGENT_WEB_SEARCH_{MAX_RESULTS,TIMEOUT_MS,ALLOW_DOMAINS,DENY_DOMAINS,RATE_PER_RUN,RATE_PER_TENANT_PER_MINUTE}` and `OM_AGENT_WEB_FETCH_MAX_BYTES`.

## Validation Commands

```bash
yarn workspace @open-mercato/enterprise test src/modules/agent_orchestrator
yarn workspace @open-mercato/enterprise typecheck
yarn workspace @open-mercato/cli test src/lib/generators/extensions/agent-files
yarn generate   # then, for file agents: docker compose up -d opencode
```

## Data Model Constraints

`data/entities.ts` — all rows scoped by `tenantId` + `organizationId`. Cross-module links are FK ids only (no ORM relations across modules).

- **AgentRun** (`agent_runs`) — immutable audit of one execution (`running → ok|error`). MUST carry `agentId`, `resultKind`; `parentRunId` links nested in-process sub-agents; `proposalId`/`processId`/`stepId` link disposition + workflow.
- **AgentProposal** (`agent_proposals`) — the actionable envelope. MUST track disposition (`pending → auto_approved|approved|edited|rejected`); applied only via effector command.
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

## Lifecycle: run → disposition → effector

1. Caller (playground, `INVOKE_AGENT` workflow step, or trace adapter) invokes `agentRuntime.run()`; `persistence.ts` opens an `AgentRun` and resolves the caller ACL.
2. Runtime executes (in-process object mode or OpenCode); `guardrailService` runs input/output checks; the typed `AgentResult` is validated against the agent's OUTCOME schema.
3. For `actionable`, an `AgentProposal` is persisted; `DispositionService` gates it (auto-approve vs `USER_TASK`).
4. On approval, the effector (`executeProposal.ts`) maps proposed actions → commands and runs them via the command bus; the workflow instance resumes via `proposal.ready`.

## File Agents — the `agents/<id>/` convention

Author file agents under `packages/<pkg>/src/modules/<module>/agents/<agent_id>/` (or an app module). To scaffold end-to-end use the **`om-create-opencode-agent`** skill (`.ai/skills/om-create-opencode-agent/SKILL.md`, symlinked from this module).

```
agents/<agent_id>/
├── AGENT.md            # frontmatter (id,label,description,provider?,model?,tools?,skills?,subAgents?,maxSteps?) + body = instructions
├── OUTCOME.md          # frontmatter `kind: informative|actionable` + FIRST fenced ```json block = JSON-Schema; trailing prose = guidance
├── SAMPLE.json         # optional example input — Playground "Insert sample" button
├── FACTS.json          # optional Caseload fact declarations (see below)
├── skills/<sid>/       # SKILL.md (+ optional TEMPLATE.md, examples/*.md, scripts/*.ts run via run_skill_script)
├── sub-agents/<subid>/ # AGENT.md + OUTCOME.md; informative-only, no further subAgents (depth cap 1)
└── tools/*.ts          # `// @ref <defineAiTool id>` (preferred, ACL-gated) OR a sandboxed `run(args)` local tool
```

- **OUTCOME.md**: frontmatter carries ONLY `kind`; the result JSON-Schema is the FIRST fenced ` ```json ` block. `informative` ⇒ schema describes `data`; `actionable` ⇒ schema describes the `proposal` envelope. Compiles to the same `z.object({ kind, data|proposal })` the in-process path uses.
- **Skills** inject instructions + union read-only tools into the agent's allowlist (deduped); read-only by construction.
- **FACTS.json** (optional): declares the labelled facts the Caseload decision panel shows for this agent's proposals — `{ "facts": [{ "label", "source": "input"|"payload"|"output", "path", "format"?: "text"|"number"|"boolean"|"percent" }] }` where `path` is a dot-path (array indexes allowed) into the run input / proposal payload / run output. Agents without it get a generic derivation (input primitives + summarized upstream findings). In-process agents pass the same shape as `facts` to `defineAgent`. Rendering lives in `components/ProposalFacts.tsx`; resolution helpers in `components/proposalFacts.ts`.

## DI Services

| Token | When to use |
|-------|-------------|
| `agentRuntime` | Run an agent (dispatches in-process vs opencode) |
| `dispositionService` | Gate a proposal (auto-approve vs `user_task`) |
| `guardrailService` | Pre/post-call schema + injection (+ grounding) checks |
| `agentRunSessionStore` | Cross-process run↔session outcome handoff |
| `agentContextResolver` | Assemble per-run TDCR context bundle |
| `agentDocumentIngestService` / `agentDocumentOcrProvider` | Document OCR → field extraction |
| `agentWorkflowBridge` | Bridge the `workflows` `INVOKE_AGENT` activity |
| `agentPrincipalService` / `agentTokenService` / `agentDelegationGrantService` / `agentAuthMdService` | Identity overlay (principals, OAuth tokens, delegation grants, ID-JAG) |

## API Routes (`/api/agent_orchestrator/`)

| Route | Method | Feature | When to use |
|-------|--------|---------|-------------|
| `/agents`, `/agents/:id` | GET | `agents.view` | List registry / agent detail (incl. resolved skills) |
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
| `/identity/well-known`, `/identity/token`, `/identity/agent/auth` | GET/POST | public / no-user-auth | OAuth discovery, client-credentials, ID-JAG |
| `/identity/grants/:id/revoke` | POST | `identity.manage` | Revoke a delegation grant |

Every route file MUST export `openApi`. Custom write routes MUST wire the mutation-guard contract.

## ACL Features (`acl.ts`)

`agents.view`, `agents.run`, `proposals.view`, `proposals.dispose`, `trace.view`, `trace.correct`, `eval.manage`, `eval.export`, `guardrail.read`, `guardrail.manage`, `context.read`, `identity.read`, `identity.manage`, `identity.tokens` (all prefixed `agent_orchestrator.`).

## Events (`events.ts`)

`run.created`, `run.completed`, `run.ingested`, `run.evaluated`, `proposal.created`, `proposal.disposed`, `proposal.ready`, `proposal.corrected`, `eval_case.created`, `eval_case.approved`, `guardrail.tripped`, `delegation_grant.revoked`, `agent_principal.registered` (all prefixed `agent_orchestrator.`). Several set `clientBroadcast: true` for the cockpit. Declare new events here with `as const`.

## Backend Cockpit (`backend/`)

`overview` (KPI tiles + needs-attention queue), `agents` + `agents/:id` (registry with runtime tags), `playground`, `caseload` + `caseload/:proposalId` (operator dispose flow), `traces` + `traces/:id` (span/tool-call tree, nav-hidden), `audit` (nav-hidden). Components: `ProposalCard`, `ProposalFacts` (Caseload facts grid + reasoning, FACTS.json-driven with generic fallback), `SkillDrawer`, `TraceView`.

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
