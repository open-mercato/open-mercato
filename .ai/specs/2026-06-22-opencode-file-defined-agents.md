# File-defined agents on OpenCode (CLAUDE.md / OUTCOME.md / skills / sub-agents / tools)

- **Date**: 2026-06-22
- **Status**: Approved — decisions resolved; Phase 0 spike next (see §17 readiness)
- **Scope**: OSS
- **Owners**: Agent Orchestrator
- **Related**:
  - `.ai/specs/agent-orchiestrator/` (original orchestrator specs)
  - `.ai/specs/2026-06-19-agent-runtime-options-opencode-vs-in-process.md` (runtime trade-off analysis)
  - `packages/ai-assistant/AGENTS.md` (OpenCode + MCP integration)
  - `packages/core/src/modules/agent_orchestrator/AGENTS.md` (in-process SDK)

## 1. Summary

Deliver the file-based agent authoring convention

```
agent/
├── CLAUDE.md         # agent metadata (frontmatter) + system prompt (body)
├── OUTCOME.md        # the result contract (what the agent must return)
├── skills/<skill>/   # SKILL.md, TEMPLATE.md, examples/, scripts/
├── sub-agents/       # delegated agents (run in parallel when beneficial)
└── tools/            # tool definitions the agent may call
```

on top of the **OpenCode** runtime already integrated in Open Mercato, while
preserving the orchestrator's contract: every run still produces a typed,
validated `AgentResult` (informative | actionable), stays **propose-only**
(no direct writes), and remains invokable from the Playground, the workflow
`INVOKE_AGENT` step, and the disposition/caseload loop.

The non-negotiable requirement: **instructions, skills, sub-agents, and tools
must all work.** OpenCode is a natural fit — it is built around markdown agent
definitions, sub-agent delegation, custom tools, and MCP — so the work is mostly
(a) a generator from our `agent/` convention to OpenCode's agent files, (b) an
**OUTCOME bridge** that turns OpenCode's free-form output back into our typed
result, and (c) wiring OpenCode as a selectable backend behind the existing
`agentRuntime` interface.

## 2. Motivation

- The in-process runtime (`defineAgent` + Vercel AI SDK object mode) is great for
  typed propose-only agents but authoring is code, and **sub-agents** and **skill
  scripts** are non-trivial to build there.
- OpenCode already ships in OM (Docker `:4096`, MCP server `:3001`, two-tier auth)
  and natively provides markdown agents, sub-agent delegation, tool allowlists,
  and MCP tools — exactly the primitives in the diagram.
- A filesystem convention lets non-engineers author/version agents as files
  (CLAUDE.md/SKILL.md), which is the stated goal for the agent-creation area.

## 3. Goals / Non-goals

### Goals
- An `agent/<id>/` directory is a complete agent: instructions, outcome contract,
  skills, sub-agents, tools — discovered and runnable.
- The four capabilities work on OpenCode: **instructions**, **skills**,
  **sub-agents**, **tools**.
- A run still returns a **validated `AgentResult`** and is persisted as an
  `AgentRun` (+ `AgentProposal` for actionable) through the existing command path.
- Propose-only is preserved: file-defined agents cannot perform domain writes;
  writes only ever happen via proposal → disposition → effector.
- File-defined agents are invokable everywhere in-process agents are today:
  Playground, `/api/agent_orchestrator/agents/:id/run`, workflow `INVOKE_AGENT`,
  caseload disposition.
- In-process and OpenCode agents **coexist** behind one registry + one
  `agentRuntime` interface.

### Non-goals
- Replacing the in-process runtime. `defineAgent` agents keep working unchanged.
- Replacing OpenCode Code Mode chat (`/api/chat`). This spec adds a *programmatic*
  agent-execution path, not a new chat UI.
- Arbitrary user-uploaded agent dirs at runtime (agents are repo/module assets,
  discovered at build/generate time — see §9). Tenant-uploaded agents are a
  follow-up.
- Multi-level sub-agent trees beyond the depth cap set in §7.6 (Phase 4+).

## 4. Background — current state

- **In-process orchestrator** (`packages/core/src/modules/agent_orchestrator/`):
  `defineAgent()` registers `{ id, resultKind, schema (Zod), instructions, tools,
  skills, subAgents }` in a module-level registry; `AgentRuntimeService.run()`
  runs object mode (or a read-only tool loop), validates output, persists
  `AgentRun`/`AgentProposal` via commands, returns `AgentResult`. Disposition
  (`dispositionService`) auto-approves or parks; the workflow `INVOKE_AGENT`
  activity calls it through `agentWorkflowBridge`. Skills load from
  `skills/*.md` (`defineSkill` + `ai-skills.ts`); sub-agents work via the
  read-only `agent_orchestrator.delegate_agent` tool.
- **OpenCode** (`packages/ai-assistant`): Go agent in Docker (`OPENCODE_URL`,
  default `:4096`). `OpenCodeClient` (`opencode-client.ts`) exposes
  `createSession`, `sendMessage(sessionId, text, { model })`, SSE `/event`
  stream, `/question` reply, `/config`. `handleOpenCodeMessage*`
  (`opencode-handlers.ts`) drive chat. Tools reach OpenCode via the **MCP HTTP
  server** (`http-server.ts`, `:3001`) with **two-tier auth** (server API key +
  per-user `sess_…` session tokens) and **per-tool ACL** enforced on every call.
  Code Mode exposes `search` + `execute` (sandboxed `node:vm`).

The gap: OpenCode runs **free-form text agents**; the orchestrator needs **typed,
validated, propose-only** results. The OUTCOME bridge (§7.3) closes it.

## 5. The agent definition convention

```
packages/<pkg>/src/modules/<module>/agents/<agent_id>/
├── CLAUDE.md
├── OUTCOME.md
├── skills/
│   └── <skill_id>/
│       ├── SKILL.md
│       ├── TEMPLATE.md        # optional output template
│       ├── examples/*.md      # optional few-shot examples
│       └── scripts/*.ts       # optional sandboxed helper scripts
├── sub-agents/                # files OR references to other agent ids
└── tools/                     # *.ts tool handlers OR references to defineAiTool ids
```

### CLAUDE.md
YAML frontmatter + markdown body:

```md
---
id: deals.health_check
label: Deal health check
description: Assess a deal and propose the next stage.
provider: anthropic            # optional; else OM model factory resolution
model: claude-sonnet-4-6       # optional
tools: [customers.get_deal]    # read-only tool ids (defineAiTool / MCP)
skills: [deals.stage_playbook] # skill ids resolved from skills/
subAgents: [deals.activity_scan]
maxSteps: 12
---
You assess the health of a sales deal …  (system prompt / instructions)
```

### OUTCOME.md — the result contract (the crux)
Frontmatter declares the result **kind** and a machine-readable schema; the body
is human guidance injected into the prompt. **Schema language: JSON Schema**
(decision §14.1) — portable, no code, compiled to a runtime validator at generate
time. An optional `schemaRef` (a Zod export) is allowed for advanced cases but is
not required.

```md
---
kind: actionable            # informative | actionable
schema:                     # JSON Schema (converted to a validator at generate time)
  type: object
  required: [actions, confidence, rationale]
  properties:
    actions: { type: array, items: { … } }
    confidence: { type: number, minimum: 0, maximum: 1 }
    rationale: { type: string, minLength: 1 }
---
Return exactly one `set_stage` action … (prose guidance)
```

`kind: informative` ⇒ the schema describes `data`. `kind: actionable` ⇒ the
schema describes the `proposal` envelope. This is the single source for both the
validator and the `submit_outcome` tool's input schema (§7.3).

## 6. Architecture overview

```
agent/<id>/ (files)
   │  generate (Phase 1)
   ▼
OpenCode agent file (.opencode/agent/<id>.md)        ← instructions + tools + subagents
   +  OUTCOME schema → validator + submit_outcome tool schema (registry)
   +  skills registered (progressive disclosure)      (Phase 3)
   +  sub-agent files                                  (Phase 4)

agentRuntime.run(id, input, ctx)
   │  registry.runtime === 'opencode'
   ▼
OpenCodeAgentRunner (Phase 2)
   1. create AgentRun (command)
   2. open OpenCode session, send {input} with agent=<id>  (+ session token)
   3. OpenCode loops: reads via MCP read tools / Code Mode, loads skills,
      delegates to sub-agents (task tool) — in parallel when independent
   4. OpenCode finishes by calling MCP `submit_outcome` with the structured result
   5. MCP validates against the agent's OUTCOME schema → returns to runner
   6. runner completes AgentRun; for actionable, creates AgentProposal (command)
   ▼
AgentResult  →  disposition / caseload / workflow INVOKE_AGENT  (unchanged)
```

### 7.1 Generation: `agent/` → OpenCode agent files
A new generator (`packages/cli`) scans every module's `agents/<id>/` dir,
validates CLAUDE.md + OUTCOME.md, and:
- emits an OpenCode agent file per agent (instructions body, frontmatter:
  model/provider, `tools` allowlist mapped to MCP tool names, `mode: primary`,
  `permission`/`tools` deny defaults = read-only);
- emits OpenCode subagent files for each `sub-agents/` entry (`mode: subagent`);
- registers the agent in the orchestrator registry with
  `{ id, runtime: 'opencode', resultKind, schema, label, description, tools,
  skills, subAgents }` (schema compiled from OUTCOME.md).

The OpenCode agent files live under a generated, container-mounted dir (e.g.
`docker/opencode/agents/` mounted into `~/.config/opencode/agent/`). Mirrors how
`opencode.json` is mounted today (`packages/ai-assistant/AGENTS.md` → Docker).

### 7.2 Instructions — CLAUDE.md
Body → OpenCode agent system prompt. Frontmatter `model`/`provider` → OpenCode
agent model (falling back to OM's `OM_AI_*` resolution when omitted). No bridge
needed beyond generation.

### 7.3 OUTCOME.md — structured result bridge (`submit_outcome`)
A new MCP tool registered by `agent_orchestrator`:

- `agent_orchestrator.submit_outcome({ outcome })` — `isMutation: false`,
  `requiredFeatures: ['agent_orchestrator.agents.run']`.
- The MCP server resolves the **active agent id** for the session (carried in the
  session context the runner created) and validates `outcome` against that
  agent's compiled OUTCOME schema (fail → typed error returned to OpenCode so it
  retries).
- On success it stores the validated outcome in the run's session record and
  signals completion; the runner reads it back as the `AgentResult`.
- The generated OpenCode prompt instructs the agent: "finish by calling
  `submit_outcome` with a value matching the outcome contract; do not answer in
  prose." (Mirrors the in-process `experimental_output` finalize step.)

This keeps validation + propose-only + persistence on the OM side, not inside
OpenCode.

### 7.4 Tools
Three layers, all already available via MCP (`:3001`):
- **Declared OM tools** — `tools:` ids in CLAUDE.md map to `defineAiTool`/MCP
  tools. The MCP server already enforces `requiredFeatures` per call under the
  caller's session-token ACL and **strips `isMutation: true` tools for
  read-only agents** — so propose-only holds.
- **Code Mode** (`search` + `execute`) — gives read access to any OM API the
  caller is permitted to call (RBAC enforced in `api.request`). Opt-in per agent.
- **Local tool files** (`tools/*.ts`) — Phase 5; registered as OpenCode custom
  tools (`.opencode/tool/`). For v1 prefer referencing `defineAiTool` ids so ACL
  + mutation policy are enforced centrally.

### 7.5 Skills
- `skills/<id>/SKILL.md` is parsed (reuse the existing frontmatter parser
  `lib/sdk/skillMarkdown.ts`) into `{ instructions, tools }`.
- **Native OpenCode skills preferred** (decision §14.2): when OpenCode exposes a
  native skill mechanism (confirmed in Phase 0), generate skills into it so
  progressive disclosure is OpenCode-managed. **Fallback** when native support is
  absent: a `agent_orchestrator.load_skill({ skillId })` MCP tool returns a
  skill's SKILL.md body (+ TEMPLATE.md/examples) on demand, with the agent's
  allowed skill ids listed in the prompt ("uses skills by default"). Either way,
  skill-contributed read-only tools are added to the agent's MCP allowlist at
  generate time.
- `examples/` → few-shot blocks returned by `load_skill`. `TEMPLATE.md` → output
  template returned alongside.
- `scripts/` → executed through the existing Code Mode `node:vm` sandbox (or a
  dedicated `run_skill_script` tool); **no fs/net**, 30s cap, per-call ACL. Phase 5.

### 7.6 Sub-agents
- Each `sub-agents/` entry is generated as an OpenCode **subagent** file.
- The primary agent delegates via OpenCode's task/subagent mechanism; OpenCode
  manages parallel execution when the agent issues independent delegations
  ("agent decides", per the diagram).
- **Propose-only across the tree**: sub-agents are generated read-only and
  **informative**; they inform the parent and may not delegate further (depth cap
  = 1 in v1, matching the in-process `delegate_agent` rule). Each sub-agent run is
  optionally recorded as a nested `AgentRun` for traceability.
- Reuses the conceptual contract proven by the in-process
  `agent_orchestrator.delegate_agent` tool (`ai-tools.ts`).

### 7.7 Invocation bridge — `OpenCodeAgentRunner`
`AgentRuntimeService.run()` dispatches on `registry.get(id).runtime`:
- `'in-process'` → today's path (object mode / read-only tool loop).
- `'opencode'` → `OpenCodeAgentRunner`:
  1. mint a per-run **session token** (`sess_…`, 2-tier auth) scoped to
     `ctx.tenantId/organizationId/userId` with the caller's ACL;
  2. `createSession()`, then `sendMessage(session, JSON.stringify(input), { agent: id })`
     (extend `OpenCodeClient.sendMessage` + `OpenCodeMessage` body with an `agent`
     field — OpenCode selects the persona);
  3. consume the SSE stream until idle; capture the `submit_outcome` result;
  4. validate (defense in depth) and return `AgentResult`.
The runner reuses `handleOpenCodeMessageStreaming` plumbing; the existing
playground/run route/workflow bridge call `agentRuntime.run` unchanged.

### 7.8 Propose-only & security
- **No direct writes**: read-only MCP allowlist + mutation-tool stripping; the
  only state an agent produces is `AgentRun`/`AgentProposal` via `submit_outcome`.
  Domain writes happen later via disposition → effector.
- **Tenant isolation**: per-run session token carries tenant/org/user + ACL;
  every MCP tool call re-checks features (existing two-tier flow). The runner MUST
  use a fresh token per run and never a static/superadmin one.
- **Sandbox**: skill scripts and Code Mode `execute` run in the existing
  `node:vm` sandbox (no fs/net, timeouts, call caps).
- **Outcome validation**: `submit_outcome` validates server-side; the runner
  re-validates; a non-conforming or absent outcome fails the run (no silent
  partial results).
- **Prompt-injection posture**: tool ACL is the security boundary, not the prompt
  — a hijacked agent still cannot call a tool the caller lacks features for, nor
  write (no mutation tools, no domain effect until human/threshold disposition).

### 7.9 Coexistence
- One registry; entries gain `runtime: 'in-process' | 'opencode'` (default
  `'in-process'`; **additive**, BC-safe).
- One `agentRuntime` interface, one `AgentResult`, one set of `AgentRun`/
  `AgentProposal` tables, one disposition + workflow integration. The Agents
  list/detail/playground/caseload UIs are runtime-agnostic.

## 8. Data model
- **Additive** registry field `runtime` (no DB column — registry is in-memory).
- **No new tables** for v1: reuse `agent_runs` / `agent_proposals`. Add nullable
  columns only if needed for trace linkage (`agent_runs.parent_run_id uuid null`
  for sub-agent nesting — additive, optional, Phase 4).
- OpenCode agent files are generated assets (git-tracked under
  `docker/opencode/agents/`), not DB rows.

## 9. Discovery / generator
- New `yarn generate` step: scan `**/agents/<id>/`, validate CLAUDE.md +
  OUTCOME.md (fail the build on a malformed agent), compile OUTCOME schema, emit
  OpenCode agent/subagent files + an `agent-orchestrator-files.generated.ts`
  registry the module loads (mirrors `ai-agents.generated.ts`).
- `ensureAgentsLoaded()` already aggregates cross-module agents; extend it to also
  load file-defined registry entries.
- Container refresh: regenerate + `docker compose up -d opencode` (or hot-mount).
  Document in `packages/ai-assistant/AGENTS.md`.

## 10. Phased delivery

| Phase | Deliverable | Effort |
|------|-------------|--------|
| **0 — Spike** | Confirm exact OpenCode contracts: agent-file frontmatter schema, per-message `agent` selection, subagent/task delegation + parallelism, custom-tool registration, version pinning. Produce a findings note; adjust this spec. | S (~2–3d) |
| **1 — Authoring + generation** | `agent/` convention parser (CLAUDE.md/OUTCOME.md), OUTCOME→validator, generator emitting OpenCode agent files + registry entries (`runtime:'opencode'`). Agent appears in **Agents** list/detail. NOT yet runnable. | M (~3–5d) |
| **2 — Run bridge + OUTCOME** | `submit_outcome` MCP tool; `OpenCodeAgentRunner`; `agentRuntime` dispatch on `runtime`; per-run session token; Playground + `/run` route + workflow `INVOKE_AGENT` work end-to-end for an **instructions-only** file agent. | M–L (~1–2wk) |
| **3 — Skills** | `load_skill` MCP tool (progressive disclosure), examples/TEMPLATE, skill→tool allowlist union. | M (~3–5d) |
| **4 — Sub-agents** | Subagent generation, parallel delegation, depth cap, nested `AgentRun` trace (`parent_run_id`). | L (~1–2wk) |
| **5 — Tool files + scripts** | `tools/*.ts` custom tools; `skills/*/scripts/` sandboxed execution. | L (~1–2wk) |

Phases 1–2 deliver the headline ("file-defined agent runs on OpenCode with a typed
result"); 3–4 satisfy the "skills + sub-agents must work" requirement; 5 completes
the convention.

## 11. Integration coverage (required)

**API paths**
- `GET /api/agent_orchestrator/agents` — lists file-defined agents (runtime tag).
- `GET /api/agent_orchestrator/agents/:id` — detail incl. skills/sub-agents from files.
- `POST /api/agent_orchestrator/agents/:id/run` — runs an OpenCode-backed agent;
  asserts a validated `AgentResult` + persisted `AgentRun` (+ `AgentProposal`).
- `POST /api/agent_orchestrator/proposals/:id/dispose` — disposition works for
  proposals produced by an OpenCode agent.
- MCP: `submit_outcome`, `load_skill` — schema validation, ACL, fail-closed paths.
- Workflow `INVOKE_AGENT` — a workflow step invoking an OpenCode agent parks/
  resumes and the effector applies the approved payload.

**UI paths**
- Agents list / detail (skills drawer, sub-agents section) for a file-defined agent.
- Playground run of an OpenCode agent (informative + actionable).
- Caseload disposition of an OpenCode-produced proposal.

**Tests** (per `.ai/qa/AGENTS.md`)
- Unit: OUTCOME→validator, CLAUDE.md parse, generator output, `submit_outcome`
  validation (accept/reject), runtime dispatch.
- Integration: end-to-end run via the runner with a stubbed OpenCode endpoint
  (assert session token scope, agent selection, outcome capture, AgentRun rows);
  sub-agent fan-out; skill load; propose-only (no mutation tool reachable).

## 12. Backward compatibility
- `runtime` registry field is **additive**, default `'in-process'`; all existing
  `defineAgent` agents are unchanged.
- New MCP tools (`submit_outcome`, `load_skill`) are additive; existing Code Mode
  tools untouched.
- New CLI generator step is additive; no existing generated contract changes.
- `OpenCodeClient.sendMessage` gains an optional `agent` field (additive).
- Optional `agent_runs.parent_run_id` is nullable/additive (Phase 4).
- Follows `BACKWARD_COMPATIBILITY.md` (types/MCP tools/CLI/DB all additive).

## 13. Risks & mitigations
- **OpenCode API drift** (agent file format, message `agent` field, subagent
  semantics) → Phase 0 spike + pin the OpenCode image version; treat the
  contract as an integration surface with its own tests.
- **OUTCOME adherence** (model answers in prose instead of calling
  `submit_outcome`) → strong prompt instruction + a stop/nudge: if the session
  goes idle without an outcome, the runner sends one corrective follow-up, then
  fails the run. Validation is server-side regardless.
- **Latency / cost** (Docker round-trips, multi-agent) → keep in-process runtime
  the default for simple typed agents; reserve OpenCode for agents that need
  skills/sub-agents/scripts. Document the trade-off.
- **Propose-only leak via a mis-declared tool** → MCP read-only stripping is the
  hard gate (not the prompt); covered by an integration test that asserts a write
  tool is never reachable for a file agent.
- **Headless/cron** (interactively-authenticated MCP servers may be absent) → the
  runner uses the server-API-key + minted session token path, not interactive
  auth; assert in tests.
- **Tenant token leakage** → fresh per-run token, 2-hour TTL, never superadmin;
  reuse the audited `apiKeyService.generateSessionToken` flow.

## 14. Decisions & open questions

### Resolved
1. **OUTCOME schema language → JSON Schema** in OUTCOME.md (compiled to a
   validator at generate time; optional `schemaRef` Zod escape hatch). §7.3.
2. **Skills → prefer native OpenCode skills** when available (confirmed in
   Phase 0); `load_skill` MCP tool is the fallback. §7.5.

### 14.3 — Agent-file delivery to the container (pending choice)
Because we chose native (file-based) skills + sub-agents, agent definitions must
exist as files on disk in the OpenCode container. Three delivery models:

- **A. Bind-mount a git-tracked generated dir** (`docker/opencode/agents/` →
  container agent dir, like `opencode.json` today). *Pros*: instant updates on
  regenerate, reviewable in PRs, simplest for local dev + self-hosted compose.
  *Cons*: needs a host path to mount (not available in some orchestrators without
  a ConfigMap/volume); requires OpenCode hot-reload or a container restart.
- **B. Bake into the OpenCode image** (Dockerfile `COPY` of the generated dir,
  built in CI). *Pros*: immutable, reproducible artifact; works in any
  orchestrator (K8s/ECS) with no host mount; image tag = agent set. *Cons*:
  agent changes need an image rebuild + redeploy (slow iteration).
- **C. Push agent config to OpenCode at runtime** (inline per-session persona via
  OpenCode's config/API). *Pros*: no mount/rebuild; agents live only in OM.
  *Cons*: depends on OpenCode supporting inline personas (P0 unknown) and
  **forfeits native file-based skills/sub-agents** — so it conflicts with
  decision §14.2 for build-time agents (it is, however, the natural enabler for
  tenant agents — see §14.4).

**Decision: A (dev) + B (prod)** — the standard Docker split: bind-mount the
git-tracked generated dir for fast local iteration; bake into the OpenCode image
in CI for an immutable, orchestrator-friendly production artifact. C stays on the
roadmap only for the tenant-agent path.

### 14.4 — Tenant-authored agents (pending choice / can stay deferred)
Whether tenants (operators of an OM instance) can author their own agents at
runtime vs. agents being developer/repo assets:

- **A. Repo/build-time only — no tenant agents (v1 default).** Agents are file
  assets reviewed in PRs and discovered at generate time. *Pros*: simplest,
  safest, zero untrusted input, matches how OM modules work. *Cons*: every new
  agent needs a deploy; no self-serve.
- **B. Tenant agents as data + curated catalog.** Tenants author CLAUDE.md/
  OUTCOME.md via UI, picking tools/skills from a **curated read-only catalog**
  (no raw scripts); stored tenant-scoped in DB; materialized per run via runtime
  push (§14.3-C) or a per-tenant ephemeral dir. *Pros*: self-serve, no redeploy.
  *Cons*: real attack surface — must hard-constrain tools to a vetted read-only
  set, validate OUTCOME, scope tenant tokens strictly, and treat tool-ACL as the
  security boundary (prompt-injection-aware). Native file-based skills/sub-agents
  don't isolate per-tenant in a shared container, so tenant agents would use the
  MCP-tool fallback path.
- **C. Tenant agents with per-tenant isolation** (dedicated OpenCode
  workspace/container per tenant). *Pros*: full native-feature parity + strong
  isolation. *Cons*: highest cost/complexity (per-tenant containers or careful
  per-tenant dir mounting); only worth it if tenant agents are a core product.

**Decision: A for v1** (matches the §3 non-goal). Move to **B with a curated
catalog** when tenant self-serve becomes a requirement; reserve C for when
isolation/feature-parity demands it. Note the tension: B/C lean on the
runtime-push path (§14.3-C), which trades away native file features — so the
build-time vs tenant-agent paths may use different delivery models.

### Still open for Phase 0
- Exact OpenCode agent-file frontmatter schema, per-message `agent` selection,
  subagent/task delegation + parallelism semantics, native skills support, and
  inline-persona capability — all confirmed in the Phase 0 spike.

## 15. Definition of done
- A module ships `agents/<id>/` with CLAUDE.md + OUTCOME.md (+ optional skills/
  sub-agents/tools); `yarn generate` discovers it.
- The agent appears in **Agents**, runs from the **Playground** and
  `/agents/:id/run`, returns a **validated** `AgentResult`, persists an
  `AgentRun` (+ `AgentProposal`), and is dispositionable + workflow-invokable.
- Skills load (progressive disclosure) and sub-agents fan out in parallel, all
  read-only / propose-only.
- Integration coverage in §11 implemented and green.

## 16. Changelog
- 2026-06-22 — Initial draft.
- 2026-06-22 — Decisions: OUTCOME uses JSON Schema (§14.1); native OpenCode skills
  preferred with `load_skill` fallback (§14.2). Expanded agent-file delivery
  (§14.3) and tenant-agent (§14.4) options pending choice.
- 2026-06-22 — Resolved §14.3 (A dev + B prod) and §14.4 (A for v1). Added §17
  pre-implementation readiness.
- 2026-06-22 — Phases 0-5 implemented on branch `feat/opencode-file-defined-agents`
  (companion findings + locked contract: `…-phase0-findings.md`). Phase 1 authoring
  + generation (`outcomeSchema`/`agentMarkdown`/`defineFileAgent`, `runtime` registry
  field, committed manifest, generator + `docker/opencode/agents/`); Phase 2 run bridge
  (`submit_outcome` MCP tool, `OpenCodeAgentRunner`, dispatch, per-run session token);
  Phase 3 skills (native SKILL.md + `load_skill` fallback, skill→tool union); Phase 4
  sub-agents (`mode: subagent`, depth cap 1, additive `agent_runs.parent_run_id`);
  Phase 5 sandboxed scripts + local tool files (`run_skill_script` via the isolated-vm
  sandbox) + docs (`agent_orchestrator/AGENTS.md`). Adjustments vs. spec recorded in the
  findings note: propose-only is enforced by the read-only allowlist + session-token ACL
  (the MCP server does NOT strip mutation tools); OUTCOME compiles to Zod (no ajv);
  container path is `/home/opencode/.config/opencode/`; OpenCode image version must be
  pinned + verified. Not yet moved to `implemented/` (pending deployment evidence).

## 17. Pre-implementation readiness

### 17.1 Backward-compatibility audit (vs. `BACKWARD_COMPATIBILITY.md` surfaces)
All changes are **additive** — no FROZEN/STABLE surface is renamed or removed:

| Contract surface | Change | Verdict |
|---|---|---|
| Auto-discovery files | New `agents/<id>/` convention + a new generator step + `agent-orchestrator-files.generated.ts` | Additive |
| Types | `AgentRegistryEntry.runtime?: 'in-process' \| 'opencode'` (default in-process) | Additive |
| Signatures | `OpenCodeClient.sendMessage` gains optional `agent`; `AgentRunCtx` unchanged | Additive |
| API routes | No new routes; existing `/agents`, `/agents/:id`, `/agents/:id/run`, `/proposals/:id/dispose` behave the same | Unchanged |
| MCP tools | New `agent_orchestrator.submit_outcome`, `agent_orchestrator.load_skill` (read-only) | Additive |
| DB schema | None for v1; optional nullable `agent_runs.parent_run_id` in Phase 4 | Additive |
| Event IDs / widget spots / DI keys / ACL features / notifications / CLI | None new except an additive generate step; reuse `agent_orchestrator.agents.view/run` | Unchanged |
| Generated files | New generated registry file; existing ones untouched | Additive |

→ **No deprecation protocol required.** `OM_OPENCODE_*` / feature-flag gating keeps the path dormant until enabled.

### 17.2 File-level touch points (grounded)
- **Generator**: `packages/cli/src/lib/generators/extensions/` (new `agent-files.ts`), registered in `generators/index.ts`; reuse `scanner.ts`. Emits OpenCode agent files + the registry.
- **Container delivery**: `docker/opencode/` (Dockerfile `COPY` for prod-B; `docker-compose*.yml` volume for dev-A — mirrors the existing `opencode.jsonc` mount). Image `opencode-mvp`.
- **MCP tools**: add `submit_outcome` + `load_skill` to `packages/core/src/modules/agent_orchestrator/ai-tools.ts` (same `defineAiTool` path already proven by `delegate_agent`; discovered by `tool-loader.ts`).
- **Runner + dispatch**: `agent_orchestrator/lib/runtime/agentRuntime.ts` (dispatch on `runtime`) + new `lib/runtime/openCodeAgentRunner.ts`; reuse `OpenCodeClient` (`opencode-client.ts`) + session-token minting (`apiKeyService.generateSessionToken`).
- **Registry/loader**: `lib/sdk/defineAgent.ts` (add `runtime` to entry) + `ensureAgentsLoaded()` (load file registry); OUTCOME→validator compiler in `lib/sdk/outcomeSchema.ts` (new).
- **Skills reuse**: `lib/sdk/skillMarkdown.ts` (already parses SKILL.md frontmatter).

### 17.3 Phase-0 go/no-go gate (blocking unknowns)
The spike MUST confirm (else re-scope before Phase 1):
1. OpenCode agent-file frontmatter schema + global vs project agent dir + **hot-reload** behavior (drives §14.3-A restart semantics).
2. Per-message **`agent` selection** on `/session/:id/message` (the runner depends on it).
3. **Native skills** mechanism (decision §14.2 native-first vs `load_skill` fallback).
4. **Subagent/task** delegation + parallelism semantics + how to constrain a subagent to read-only/informative.
5. How an OpenCode agent reliably **terminates by calling a tool** (`submit_outcome`) rather than answering in prose (stop conditions / tool-choice).
6. Pinned OpenCode image version for the contract.

### 17.4 Risk hotspots (ranked)
1. **OUTCOME adherence** (model skips `submit_outcome`) — server-side validation + one corrective nudge + fail-closed; covered by tests.
2. **OpenCode contract drift** — pin image; isolate behind `openCodeAgentRunner` + integration tests with a stubbed endpoint.
3. **Propose-only leak** — MCP read-only stripping is the hard gate; integration test asserts no write tool is reachable for a file agent.
4. **Latency/cost** — in-process stays default; OpenCode reserved for skills/sub-agents/scripts agents.

### 17.5 Verdict
**Ready to start Phase 0.** Phases 1–2 are unblocked once the six Phase-0 items
are confirmed; Phases 3–5 depend on the native-skills and subagent findings.
No backward-compatibility blockers. No new production dependency required (OpenCode
and the MCP path already ship in OM).
