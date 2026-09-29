# Agent Orchestrator — Implemented Baseline

## 1. Status & scope

Implemented baseline **as of 2026-06-22** on branch `feat/opencode-file-defined-agents`
(which includes the parent `feat/agent-orchestrator-mvp` commits). This document
records what **EXISTS in the working tree** — every claim is grounded in code with
`path:symbol` citations. It is the authoritative starting point future specs
reference; roadmap / next-to-implement items live in the sibling specs, not here.

Two design specs framed this work and are useful context, but the baseline below
reflects **CODE, not those specs**:

- `.ai/specs/2026-06-22-opencode-file-defined-agents.md` (design)
- `.ai/specs/2026-06-22-opencode-file-defined-agents-phase0-findings.md` (Phase-0 contract)

Module root: `packages/enterprise/src/modules/agent_orchestrator/`. Example agents live in
`apps/mercato/src/modules/agent_examples/`. Container delivery lives in `docker/opencode/`.

Discrepancies between those two specs and the code are listed at the end of the
return message (not in this file).

---

## 2. Architecture overview

The orchestrator runs **propose-only** AI agents. An agent never performs a domain
write; it only ever produces a typed, validated `AgentResult`, and any state change
flows through a separate disposition + effector path.

### The propose-only contract

Every agent returns an `AgentResult` discriminated union
(`data/validators.ts:agentResultSchema`, `AgentResult<T>`):

- `{ kind: 'informative', data }` — the agent only informs; nothing is proposed.
- `{ kind: 'actionable', proposal }` — the agent proposes an action envelope
  (`agentProposalSchema`: `{ actions: ProposedAction[], confidence?, rationale? }`).

The lifecycle (identical for both runtimes, via `lib/runtime/persistence.ts`):

```
agent run → AgentResult (validated vs the agent's result schema)
          → AgentRun persisted (audited command)
          → if actionable: AgentProposal persisted (disposition: 'pending')
          → DispositionService gates it (auto-approve vs human USER_TASK)
          → effector applies the approved payload via an audited domain command
```

No agent ever writes. The agent's only persistence side effect is the
`AgentRun` / `AgentProposal` rows (written through OM Commands); domain writes
happen later through `disposition → effector`. See `lib/runtime/agentRuntime.ts:AgentRuntimeService`
class JSDoc and `lib/runtime/executeProposal.ts:executeProposal`.

### Two coexisting runtimes behind one registry + one `run()`

Both runtimes register into ONE in-memory registry (`lib/sdk/defineAgent.ts`) and
dispatch through ONE entry point, `AgentRuntimeService.run()`
(`lib/runtime/agentRuntime.ts:64`), which switches on `entry.runtime`:

- `'in-process'` — authored with `defineAgent` (`ai-agents.ts`). Executes via the
  Vercel AI SDK object mode (`runAiAgentObject`) in this Node process.
- `'opencode'` — authored as a file convention `agents/<id>/` (AGENT.md +
  OUTCOME.md). Registered by `ensureAgentsLoaded` from a committed manifest and
  run on the OpenCode runtime via `OpenCodeAgentRunner`.

Both paths reuse the SAME persistence tail (`lib/runtime/persistence.ts`), so the
`AgentRun` / `AgentProposal` lifecycle and result shaping are byte-for-byte
identical regardless of runtime.

---

## 3. The agent registry & SDK

### `defineAgent` (`lib/sdk/defineAgent.ts:94`)

Authors an in-process agent. It:

1. Resolves declared `skills` (`getSkillEntry`) — injecting each skill's
   instructions into the system prompt and **unioning the skill's read-only tool
   ids** into the agent's allowlist (`defineAgent.ts:112,117`). Unknown skill ids
   are warned and skipped.
2. If `subAgents` is non-empty, adds `DELEGATE_TOOL_ID`
   (`agent_orchestrator.delegate_agent`) to the allowlist and appends a
   `## Sub-agents` prompt section nudging parallel fan-out (`defineAgent.ts:116,138`).
3. Registers an `AgentRegistryEntry` with `runtime: 'in-process'`
   (`defineAgent.ts:133`) and returns a standard `AiAgentDefinition` with
   `executionMode: 'object'`, `readOnly: true`, `mutationPolicy: 'read-only'`,
   `output: { schema }` (`defineAgent.ts:143`).

Read-only is the structural propose-only guarantee: the AI runtime strips every
`isMutation: true` tool, so even a mis-declared write tool can never fire.

### `AgentRegistryEntry` (`lib/sdk/defineAgent.ts:72`)

The single registry record shape for BOTH runtimes:

```
{ id, moduleId, resultKind, schema (Zod), tools[], skills[], subAgents[],
  label, description, instructions, defaultProvider?, defaultModel?,
  loop?: { maxSteps? }, runtime: 'in-process' | 'opencode' }
```

`runtime` is additive (BC-safe): `defineAgent` always sets `'in-process'`;
file agents set `'opencode'`.

### `registerFileAgent` (`lib/sdk/defineAgent.ts:172`)

Registers a file-defined agent directly into the same registry without going
through `defineAiAgent` (file agents don't run in-process, so they need no
`AiAgentDefinition`). Same dup-id guard as `defineAgent`.

### `ensureAgentsLoaded` (`lib/sdk/defineAgent.ts:334`)

Idempotent loader (skips when the registry is already populated). Loads every
module's `ai-agents.ts` (via ai_assistant's `loadAgentRegistry()`, with a local
fallback import) AND then `loadFileAgents()`. Code paths that don't transitively
import an `ai-agents.ts` (the agents API, the workflow background executor) call
this first. `getAgentEntry` / `listAgentEntries` read the registry.

### Skills (`lib/sdk/defineSkill.ts`)

A skill is a reusable capability pack: `{ id, moduleId, label, description,
instructions, tools[] }` (`defineSkill.ts:25`). `defineSkill` registers it (dup-id
guarded). Skills stay read-only by construction (the host agent is read-only).
`ensureSkillsLoaded` (`defineSkill.ts:69`) imports the module's `ai-skills.ts`.
The core module ships skills as `skills/*.md` files loaded by `ai-skills.ts`
(`ai-skills.ts:25 loadSkillsFromDisk`) — e.g. `skills/deals.stage_playbook.md`.

### Sub-agents (`delegate_agent`)

An in-process agent that declares `subAgents` gains the `delegate_agent` tool
(`ai-tools.ts:40 delegateAgentTool`). The model calls it with `{ agentId, input }`;
multiple calls in one step fan out in parallel. Hard constraints enforced in the
tool handler: the target must be `informative`, must NOT itself declare
`subAgents` (depth cap = 1), runs under the SAME caller scope, and errors are
returned as data (`{ ok: false }`) so one failed sub-task never crashes the parent.

---

## 4. In-process runtime

`AgentRuntimeService.runInProcess` (`lib/runtime/agentRuntime.ts:84`):

1. `createRun` — persists a `running` `AgentRun` via the audited command
   `agent_orchestrator.runs.create` (carrying `parentRunId` when nested).
2. `resolveCallerAcl` (`persistence.ts:46`) loads the caller's effective features
   so the agent's read-only tools pass their feature check **under the caller's
   own scope — never escalated** (fails closed to no features on RBAC error).
3. Runs the agent via `runAiAgentObject({ enableTools: true })` inside
   `withRunContext(runId, …)` (so a nested `delegate_agent` call can stamp the
   parent run id). Object mode resolves the structured `.object`.
4. Validates the raw object against `entry.schema.safeParse` — on failure marks
   the run `error` (`failRun`) and throws `AgentOutputInvalidError`.
5. `shapeResult` re-keys by `resultKind` (`persistence.ts:134`), `completeRun`
   marks the run `ok` with output, and — for `actionable` — `createProposal`
   persists the `AgentProposal` (stamping `processId`/`stepId` when present).

The runtime's only writes are `AgentRun` / `AgentProposal` via Commands. A toolless
agent auto-falls back to a plain structured generate.

---

## 5. File-defined (OpenCode) runtime

### The `agents/<id>/` convention

Authored under any module's `agents/<agent_id>/` tree (`AGENTS.md` §convention).
Required: `AGENT.md` + `OUTCOME.md`. Optional: `skills/<sid>/` (SKILL.md +
TEMPLATE.md + examples/*.md + scripts/*.ts), `sub-agents/<subid>/`, `tools/*.ts`.

- **AGENT.md** — frontmatter (`id`, `label`, `description`, `provider?`,
  `model?`, `tools?`, `skills?`, `subAgents?`, `maxSteps?`) + body = instructions.
  Parsed by `lib/sdk/agentMarkdown.ts:parseAgentMarkdown` (tiny in-repo parser;
  list keys accept inline `[a, b]` or block `- a`). Returns null when id/label/
  description missing.
- **OUTCOME.md** — frontmatter carries ONLY `kind: informative|actionable`; the
  result JSON-Schema is the FIRST fenced ` ```json ` block; trailing prose is
  guidance. Parsed by `lib/sdk/defineFileAgent.ts:parseOutcomeMarkdown`.

### OUTCOME JSON-Schema → Zod

`lib/sdk/outcomeSchema.ts:jsonSchemaToZod` converts a **supported subset** to Zod:
`object` (properties/required/additionalProperties), `array` (items/minItems),
`string` (minLength/enum), `number`/`integer` (minimum/maximum), `boolean`,
`nullable`, `const`, arbitrary nesting. Unsupported keywords
(`oneOf`/`anyOf`/`allOf`/`not`/`$ref`/`format`/`pattern`/`patternProperties`/
`propertyNames`/`if`/`then`/`else`/`additionalItems`) throw
`UnsupportedOutcomeSchemaError` so generation fails loudly (`outcomeSchema.ts:39`).
`compileOutcome` (`outcomeSchema.ts:163`) wraps the inner schema in the SAME
AgentResult envelope the in-process path uses:
`informative ⇒ z.object({ kind: 'informative', data })`,
`actionable ⇒ z.object({ kind: 'actionable', proposal })`.

### Generator + committed manifest + container delivery

`packages/cli/src/lib/generators/extensions/agent-files.ts:createAgentFilesExtension`
scans every enabled module's `agents/` tree (pkg + app roots), validates each dir,
and emits two artifacts as a deterministic fs side effect (both live OUTSIDE the
app `.mercato/generated/` dir, so are written directly):

1. The committed, git-tracked manifest
   `generated/file-agents.generated.ts` (`fileAgentDescriptors: FileAgentDescriptor[]`)
   — raw JSON-Schema (plain data), recompiled to Zod at load. Survives
   `yarn clean-generated`.
2. OpenCode agent `.md` files under `docker/opencode/agents/` (and native skill
   files under `docker/opencode/skills/<name>/SKILL.md`). Idempotent: stale files
   are removed.

Generation **throws** on any malformed AGENT.md/OUTCOME.md/SKILL.md, naming the
dir. The CLI cannot import `@open-mercato/core`, so the parsers are reimplemented
in the generator and MUST stay in sync with `lib/sdk/*`.

`ensureAgentsLoaded → loadFileAgents` (`defineAgent.ts:258`) imports the manifest,
recompiles each descriptor's schema via `compileOutcome`, flattens nested
`subAgentDescriptors` so each sub-agent registers as its own individually-runnable
informative file agent, and registers each with `runtime: 'opencode'`. It also
calls `registerAgentSkills` so `load_skill` / `run_skill_script` can resolve skill
content at runtime without fs access.

**Container delivery** (`docker/opencode/`): the `Dockerfile` (pinned
`OPENCODE_VERSION=1.1.21`) installs OpenCode, runs as non-root `opencode`, and
`COPY`s `agents/` and `skills/` into `/home/opencode/.config/opencode/{agents,skills}/`
(prod model). `entrypoint.sh` generates `opencode.jsonc` dynamically (provider/model
from `OM_AI_*` → `OPENCODE_*` → defaults), wires the remote MCP server
(`OPENCODE_MCP_URL`, `x-api-key`), denies `write`/`bash`/`edit`/`read`/`glob`/`grep`,
and `exec opencode serve`. `docker-compose*.yml` bind-mount the same `agents/`/
`skills/` dirs read-only for dev.

### `OpenCodeAgentRunner` (`lib/runtime/openCodeAgentRunner.ts:83`)

`AgentRuntimeService.run` constructs the runner for `opencode` agents
(`agentRuntime.ts:72`), passing the DI-resolved `openCodeClient`. The flow
(`OpenCodeAgentRunner.run`):

1. `createRun` — persist the `running` AgentRun.
2. Mint a **fresh per-run session token scoped to the caller** (their roles,
   tenant, org — NEVER static/superadmin) via `generateSessionToken` +
   `createSessionApiKey` (TTL 120m, `SESSION_TTL_MINUTES`). User roles resolved by
   `getUserRoleIds` (`openCodeAgentRunner.ts:315`).
3. `openCodeRunRegistry.register(sessionToken, { agentId, resultSchema })` — the
   per-run correlation key IS the session token.
4. `createSession`, then `sendMessage(..., { agent: openCodeAgentName })` with the
   message prefixed by `[Session Authorization: <token>…]` so MCP tool calls
   authenticate (`buildMessage`, `openCodeAgentRunner.ts:193`).
5. `driveSession` (`openCodeAgentRunner.ts:205`): fire-and-forget the send;
   completion is signalled by EITHER the correlation deferred (`submit_outcome`
   captured the outcome) OR `session.status: idle` from the SSE stream — NEVER a
   `Promise.race` against the HTTP send. On idle-without-outcome it waits an
   `IDLE_GRACE_MS` (500ms), then sends ONE corrective nudge and waits again; still
   nothing → `NO_OUTCOME`.
6. `NO_OUTCOME` → `failRun` + throw `OpenCodeRunFailedError`. Otherwise
   re-validate the captured outcome against the schema (defense in depth),
   `shapeResult`, `completeRun`, and create the proposal for actionable.
7. `finally`: `openCodeRunRegistry.dispose` + best-effort
   `deleteSessionApiKey` (revoke the per-run token).

`openCodeRunRegistry` (`lib/runtime/openCodeRunRegistry.ts`) is a module-level Map
(the MCP HTTP server and runner share one Node process) binding each active run's
session token to its agent id + compiled schema and a deferred `outcomePromise`.

### MCP tools (`ai-tools.ts`) — the two-gate propose-only model + sandbox

The module exposes four MCP/AI tools, all `isMutation: false` and gated by
`requiredFeatures: ['agent_orchestrator.agents.run']`:

- `submit_outcome` (`SUBMIT_OUTCOME_TOOL_ID`, `ai-tools.ts:116`) — terminal tool
  the file agent finishes with. Resolves the active agent + schema from the
  per-run correlation store keyed by `ctx.sessionId` (NOT trusted from the model),
  validates the outcome → stores + signals completion on success
  (`{ ok: true }`); on failure returns typed validation errors so the agent can
  retry (NOT thrown); missing/stale correlation → `{ ok: false, code: 'no_active_run' }`.
- `load_skill` (`LOAD_SKILL_TOOL_ID`, `ai-tools.ts:179`) — progressive-disclosure
  fallback returning a skill's `instructions` (+ optional `template` + `examples`),
  scoped to the active agent's allowed skill set; denies skills not allowed.
- `run_skill_script` (`RUN_SKILL_SCRIPT_TOOL_ID`, `ai-tools.ts:239`) — runs an
  agent's sandboxed skill helper (`scripts/<name>.ts`) or a local sandboxed tool
  (under synthetic skill id `__agent_tools__`) via `runSandboxedScript`. Resolves
  the active agent/skill/script server-side; errors returned as data.
- `delegate_agent` — in-process sub-agent fan-out (§3; not used by the OpenCode
  path, which delegates via the native `task` tool).

**Propose-only gate 1 (generation/load):** the generated agent `.md` `tools` block
denies `"*": false` and allows ONLY the agent's declared read-only tool ids +
`submit_outcome` (+ `task` when sub-agents exist); `permission` denies
`write`/`edit`/`bash` (`defineFileAgent.ts:renderOpenCodeAgentFile`). The OpenCode
MCP server does NOT strip mutation tools, so `loadFileAgents` additionally rejects
(skips + warns) any file agent whose tool is registered `isMutation: true`
(`defineAgent.ts:288 loadMutationToolPredicate`).

**Propose-only gate 2 (runtime ACL):** every MCP tool call authenticates with the
per-run session token, whose ACL is the caller's own and re-checked on every call;
a tool the caller lacks features for is unreachable regardless of the prompt.

**Sandbox** (`lib/runtime/sandboxedScript.ts:runSandboxedScript`): reuses the
ai-assistant Code Mode `isolated-vm` sandbox — a fresh V8 isolate, NO Node globals
(`require`/`process`/`fs`/`Buffer`/`fetch` absent), a hard 30s cap
(`SKILL_SCRIPT_TIMEOUT_MS`), 32MB memory cap. A script MUST define `run(args)` and
is a pure function of its args (no fs/net/imports). Errors are returned as data
(`{ ok: false, code }`), never thrown across the boundary.

---

## 6. Skills & sub-agents

- **Native + load_skill.** The generator emits NATIVE OpenCode skill files under
  `docker/opencode/skills/<sanitized-name>/SKILL.md` (the primary delivery; OpenCode
  lists them in its built-in `skill` tool). `load_skill` is the FALLBACK and the
  authoritative carrier for `TEMPLATE.md` / `examples` that native skills may not
  bundle. Runtime content is registered by `registerAgentSkills` into
  `lib/runtime/fileAgentSkills.ts` (keyed by agent id then skill id).
- **Skill → tool union.** Each skill's read-only tools union into the agent's
  effective allowlist (deduped) in BOTH the in-process path (`defineAgent.ts:117`)
  and the file path (`defineFileAgent.ts:517`, generator `agent-files.ts:740`).
- **Local tools/*.ts (Phase 5).** Two forms (`defineFileAgent.ts:loadToolFiles`):
  a `// @ref <defineAiTool id>` reference (preferred — unions the id into the
  allowlist, flows through the central ACL + propose-only gate), OR a local
  sandboxed `run(args)` tool (carried under `__agent_tools__`, run via
  `run_skill_script`). No native unsandboxed `.opencode/tool/` files are generated.
- **Sub-agents, depth cap 1.** A file agent's `sub-agents/<subid>/` dirs are full
  file agents constrained to `kind: informative` and NO further `subAgents`
  (`defineFileAgent.ts:loadSubAgentDir` throws on violation). The primary's
  generated `.md` allows the native `task` tool and whitelists ONLY its sub-agents'
  sanitized names under `permission.task`; sub-agent files render `mode: subagent`
  with `permission.task: deny`. The in-process `delegate_agent` enforces the same
  informative + non-delegating constraints (`ai-tools.ts:60`).
- **parent_run_id trace.** The in-process `delegate_agent` path stamps the parent
  run's id onto the nested `AgentRun` via `runContext` AsyncLocalStorage
  (`lib/runtime/runContext.ts`, `ai-tools.ts:73`). **Documented limitation:**
  OpenCode-native `task` delegation runs sub-agents inside OpenCode (not via our
  runner), so per-sub-agent `AgentRun` rows are NOT recorded for that path today
  (`data/entities.ts:31` JSDoc, `runContext.ts:16`).

---

## 7. Data model

`data/entities.ts`:

- **`AgentRun`** (table `agent_runs`) — `id`, `tenant_id`, `organization_id`,
  `agent_id`, `parent_run_id` (nullable, Phase-4 nested trace), `status`
  (`running|ok|error`), `input` (jsonb), `output` (jsonb), `result_kind`
  (`informative|actionable`), `error_message`, `created_at`, `updated_at`. Indexed
  on `(tenant,org)` and `(org, agent)`.
- **`AgentProposal`** (table `agent_proposals`) — `id`, `tenant_id`,
  `organization_id`, `agent_id`, `run_id`, `process_id`, `step_id`, `payload`
  (jsonb), `confidence` (float), `disposition`
  (`pending|auto_approved|approved|edited|rejected`), `disposition_by`,
  `disposition_reason`, `created_at`, `updated_at`, `deleted_at`. Indexed on
  `(tenant,org)` and `(org, run)`.

Validators (`data/validators.ts`): `proposedActionSchema`, `agentProposalSchema`,
`agentResultSchema`, `runListQuerySchema`, `agentRunRequestSchema`,
`disposeProposalSchema` (superRefine: edit/reject require `reason`, edit requires
`payload`), `proposalListQuerySchema`, and the reference `dealHealthCheckResult`.

**Commands:**
- `agent_orchestrator.runs.create` / `.complete` / `.fail` (`commands/runs.ts`) —
  emit `run.created` / `run.completed`.
- `agent_orchestrator.proposals.create` (`commands/proposals.ts`) — emits
  `proposal.created`.
- `agent_orchestrator.proposals.dispose` (`commands/dispose.ts`) — mutation guard
  (before/after, skipped for the system-actor auto path), org-scoped load via
  `findOneWithDecryption`, already-disposed guard (idempotent same-verdict, 409 on
  conflicting verdict), optimistic lock on `updated_at` (human path only),
  `withAtomicFlush` transition, emits `proposal.disposed`, and (human path) calls
  `resumeWorkflowForProposal`.

**Migrations** (both present):
- `Migration20260620090000_agent_orchestrator.ts` — creates `agent_runs` +
  `agent_proposals` and indexes.
- `Migration20260622090000_agent_orchestrator_parent_run.ts` — adds
  `agent_runs.parent_run_id uuid null`.

`migrations/.snapshot-open-mercato.json` is present and in sync.

---

## 8. Disposition, workflow INVOKE_AGENT, caseload

### DispositionService (`lib/disposition/dispositionService.ts:DispositionServiceImpl`)

A thin DI service called INLINE by the workflows `INVOKE_AGENT` executor right
after `agentRuntime.run` (NOT event-driven — an event seam would lose the
activity's transaction scope and race `WAIT_FOR_SIGNAL`). `onResult` is either
`{ autoApproveThreshold }` or `{ alwaysAsk: true }`.

- **Auto-approve** (`confidence ≥ threshold`, not `alwaysAsk`; fail-closed on
  null/missing confidence): disposes through the audited dispose command with the
  internal `auto_approved` verdict (`dispositionBy: 'rule:threshold'`,
  `skipResume: true`); returns `{ kind: 'auto_approved' }`. No `proposal.ready`
  emitted (avoids a park-before-signal race).
- **Ask-a-human** (below threshold / `alwaysAsk` / null): raises a workflows
  `USER_TASK` surfacing the proposal payload; the instance stays parked at
  `WAIT_FOR_SIGNAL`; returns `{ kind: 'user_task' }`. `workflows` is an optional
  peer — `createUserTask` degrades gracefully (returns a synthetic
  `pending:<id>` id) when the module is absent.

### Workflow bridge (`lib/runtime/invokeAgentForWorkflow.ts:AgentWorkflowBridgeService`)

DI service (`agentWorkflowBridge`) consumed by the workflows `INVOKE_AGENT`
activity executor via `tryResolve` (optional peer). Keeps all `AgentProposal`
access inside this module so workflows never imports its entities. Runs the agent,
returns `{ kind: 'informative', data }` directly for informative; for actionable
it loads the freshly-created pending proposal, disposes it, and returns
`auto_approved { payload }` or `user_task`.

### Resume seam (`lib/disposition/resume.ts:resumeWorkflowForProposal`)

Human verdicts on a workflow-originated proposal emit
`agent_orchestrator.proposal.ready` (audit + `clientBroadcast`) and deliver a
resume signal via the workflows `sendSignal` (best-effort; logs when the peer is
absent). `WAIT_FOR_SIGNAL` keys on `signalName = 'agent_orchestrator.proposal.ready'`,
matching by `processId`; the disposition/payload lands in `WorkflowInstance.context`
for the downstream effector.

### Effector path (`lib/runtime/executeProposal.ts:executeProposal`)

Optional helper that maps each proposed action `type` → an OM command id and runs
it through the audited command bus (unmapped types are `skipped`). Callers (the
workflow effector) call it only AFTER disposition; the playground never
auto-executes. The demo workflow effector applies the approved `set_stage` via the
audited `customers.deals.update` command (verified by `demo-workflow.test.ts`).

The DI wiring for all three services is in `di.ts` (`agentRuntime`,
`dispositionService`, `agentWorkflowBridge`).

---

## 9. APIs & UI

### API routes (all under `/api/agent_orchestrator/`)

- `GET /agents` (`api/agents/route.ts`) — lists the registry (id, resultKind,
  **runtime**, tools, skills, label, description). `agents.view`.
- `GET /agents/[id]` (`api/agents/[id]/route.ts`) — agent detail (incl. resolved
  skill metadata). `agents.view`.
- `POST /agents/[id]/run` (`api/agents/[id]/run/route.ts`) — playground run.
  Mutation-guarded; resolves `agentRuntime` and returns the typed `AgentResult`.
  404 `AgentNotFoundError`, 422 `AgentOutputInvalidError`. `agents.run`.
- `GET /runs` (`api/runs/route.ts`) — `makeCrudRoute` over `AgentRun`
  (`indexer: agent_orchestrator:agent_run`). `agents.view`.
- `GET /proposals` (`api/proposals/route.ts`) — `makeCrudRoute` over
  `AgentProposal` (`indexer: agent_orchestrator:agent_proposal`). `proposals.view`.
- `POST /proposals/[id]/dispose` (`api/proposals/[id]/dispose/route.ts`) — operator
  verdict through the audited dispose command (mutation guard + optimistic lock;
  surfaces 409 conflict body). `proposals.dispose`.

All routes export `openApi`.

### Backend pages (`backend/`)

| Page | Path | Feature | Notes |
|---|---|---|---|
| Overview | `backend/overview` | `proposals.view` | KPI tiles (auto %, needs-decision, queue depth, total runs) + needs-attention queue |
| Agents | `backend/agents` | `agents.view` | registry list |
| Agent detail | `backend/agents/[id]` | `agents.view` | shows label, module, **runtime tag** (`runtime.${runtime}` i18n), provider/model/maxSteps, tools, sub-agents, skills (SkillDrawer), instructions |
| Playground | `backend/playground` | `agents.run` | run any agent against JSON input; renders `ProposalCard` |
| Caseload | `backend/caseload`, `caseload/[proposalId]` | `proposals.view` | operator queue + dispose |
| Traces | `backend/traces` | `agents.view` | nav-hidden |
| Audit | `backend/audit` | `proposals.view` | nav-hidden |

The agents-list and detail surfaces expose the runtime tag (`in-process` vs
`opencode`), making the two-runtime split visible in the UI
(`components/types.ts`, `backend/agents/[id]/page.tsx:126`).

---

## 10. ACL, setup, events

### ACL (`acl.ts`)

Four features, with `dependsOn`:
- `agent_orchestrator.agents.view`
- `agent_orchestrator.agents.run` (→ view)
- `agent_orchestrator.proposals.view`
- `agent_orchestrator.proposals.dispose` (→ proposals.view)

(`workflows.author` is referenced by setup/comments but is declared by the
workflows area, not in this `acl.ts`.) New MCP tools reuse `agents.run` — no new
feature is added for the file-agent path.

### Setup (`setup.ts`)

`defaultRoleFeatures`: `superadmin`/`admin` get the wildcard
`agent_orchestrator.*`; `employee` + `operator` get view + proposals.view +
proposals.dispose; `engineer` gets view + agents.run + proposals.view +
workflows.author. `seedDefaults` is intentionally empty (the auto-approve
threshold lives on the INVOKE_AGENT node config, NOT a tenant config row).
`seedExamples` lands the demo workflow + 2 demo deals via `lib/seeds.ts`
(idempotent, tenant-scoped).

### Events (`events.ts`)

`createModuleEvents({ moduleId: 'agent_orchestrator' })` declaring:
`run.created`, `run.completed`, `proposal.created`, `proposal.disposed`,
`proposal.ready` (`clientBroadcast: true`). All `category: 'lifecycle'`.

---

## 11. Examples

Four example agents ship, demonstrating each authoring path:

**In-process (`apps/mercato/src/modules/agent_examples/ai-agents.ts`):**
- `support.ticket_triage` — minimal **informative**, NO tools; reasons over input
  only. The smallest end-to-end example.
- `support.triage_batch` — **manager** agent demonstrating the sub-agent-as-tool
  pattern: delegates each ticket to `support.ticket_triage` in parallel via the
  auto-added `delegate_agent` tool, then aggregates. Still propose-only.

**File-defined (`apps/mercato/src/modules/agent_examples/agents/`):**
- `deals.health_check` — **actionable** primary; declares a `stage_playbook` skill
  (with a sandboxed `scripts/score.ts` + TEMPLATE + example) and a sub-agent
  `deals.activity_scan` (informative). Demonstrates skills, sandboxed scripts,
  native `task` sub-agent fan-out, and the full propose-only chain
  (`set_stage` → disposition → effector).
- `support.resolution_advisor` — **actionable**; declares a read-only tool
  `agent_examples.lookup_ticket_history` (a self-contained `isMutation: false`
  tool in `agent_examples/ai-tools.ts`) and a `resolution_playbook` skill.
  Demonstrates tool + skill + history-driven proposal.

A core reference in-process agent `deals.health_check` ALSO exists in
`agent_orchestrator/ai-agents.ts` (note: same OM id as the file example — see
discrepancies). The demo workflow definition is
`examples/deals-health-check-workflow.json`.

---

## 12. Tests

Test suites in `packages/enterprise/src/modules/agent_orchestrator/__tests__/` (16
files; the CLI generator is covered separately by `agent-files` tests):

| File | Cases | Asserts |
|---|---|---|
| `acl-coverage` | 4 | every concrete `acl.ts` feature is granted to ≥1 role (wildcard-aware); persona role scoping |
| `agentMarkdown` | 5 | `parseAgentMarkdown` inline/block frontmatter; null on missing id/label/description; bad maxSteps ignored |
| `defineFileAgent` | 6 | `loadFileAgentDir` compiles schemas + envelope; sub-agent constraints; rejects malformed/actionable/nested sub-agents |
| `demo-workflow` | 5 | INVOKE_AGENT activity config, signal parking/resume, transition guards, effector via audited `customers.deals.update` |
| `file-agent-skills` | 5 | skill instructions/template/examples load; skill tools union (deduped); dir-name id fallback; unknown skills skipped |
| `load-skill` | 5 | `load_skill` propose-only metadata; returns allowed skill content; denies disallowed; fails closed on stale/missing session |
| `opencode-runner` | 4 | mints caller-scoped (non-superadmin) token, sanitized `agent` field, persists run+proposal; fails on no-outcome after nudge; runtime dispatch; example declares no mutation tool |
| `outcomeSchema` | 6 | `jsonSchemaToZod` subset conversion + constraints; rejects unsupported keywords; `compileOutcome` envelope |
| `parent-run-trace` | 3 | `parentRunId` persisted via `runs.create`; in-process delegate stamps parent; top-level outside run context |
| `propose-only-gate` | 1 | file agent with `isMutation: true` tool rejected at load; read-only registered; warns |
| `run-skill-script` | 5 | `run_skill_script` propose-only metadata; sandboxed run; fails closed; rejects disallowed skill / unknown script |
| `sandboxed-script` | 8 | real isolate runs pure `run(args)` (fn + arrow); blocks require/process/fetch; errors as data; rejects no-`run` |
| `skillMarkdown` | 5 | `parseSkillMarkdown` block/inline tools; null on missing required fields; tools default `[]` |
| `skills` | 4 | `defineSkill` registers + dedups; injects instructions + unions tools into prompt/allowlist; unknown skipped |
| `subagents` | 2 | `defineAgent` with subAgents adds delegate tool + prompt section; no delegate tool without subAgents |
| `submit-outcome` | 4 | `submit_outcome` accepts valid (stores + completes + resolves runner), rejects invalid as data (retry), fails closed on stale/missing session |

---

## 13. Known limitations / documented follow-ups

Grounded in code comments + `AGENTS.md` §Known follow-ups + the Phase-0 findings:

1. **OpenCode container not exercised end-to-end.** The `OPENCODE_VERSION=1.1.21`
   pin and the installer's `VERSION` env var are an **ASSUMPTION-to-verify**
   against the running image (`docker/opencode/Dockerfile:6`, findings §6); no
   end-to-end smoke test against a live container has been run. `OpenCodeAgentRunner`
   is unit-tested against a fake client, not a real OpenCode server.
2. **OpenCode-native nested-run recording.** `task`-delegated sub-agents run inside
   OpenCode (not via our runner), so per-sub-agent `AgentRun` rows + `parent_run_id`
   are recorded ONLY for the in-process `delegate_agent` path
   (`data/entities.ts:31`, `runContext.ts:16`). Native nested-run recording is a
   follow-up.
3. **Native-skill bundling of TEMPLATE/examples/scripts is unconfirmed.** The
   `load_skill` / `run_skill_script` MCP path is the authoritative carrier
   regardless (`AGENTS.md` §Known follow-ups).
4. **Tenant-authored agents deferred.** v1 ships repo/build-time file agents only;
   per-tenant agents (and the multi-tenant container isolation they'd need) are an
   explicitly deferred choice (findings §14.4).
5. **Auto-approve threshold is per-INVOKE_AGENT-node config**, not a tenant config
   row (a tenant-wide fallback config needs its own tenant-scoped entity —
   `setup.ts:45`).
6. **OpenCode MCP server does not strip mutation tools** — the read-only allowlist
   in the generated agent file + the load-time `loadFileAgents` gate + per-call ACL
   are the propose-only enforcement; neither may be weakened (`AGENTS.md` §Always).
7. **Generator/loader parser duplication.** The CLI cannot import core, so the
   AGENT.md/OUTCOME.md/SKILL.md parsers exist twice and must be kept in sync
   (`agent-files.ts` header).

---

## 14. Glossary / file map

| File | Role |
|---|---|
| `lib/sdk/defineAgent.ts` | registry + `AgentRegistryEntry` (incl. `runtime`), `defineAgent`, `registerFileAgent`, `ensureAgentsLoaded`, `loadFileAgents` + mutation-tool gate |
| `lib/sdk/defineSkill.ts` | skill registry, `defineSkill`, `ensureSkillsLoaded` |
| `lib/sdk/defineFileAgent.ts` | `loadFileAgentDir` — parse CLAUDE/OUTCOME, load skills/sub-agents/tools, render OpenCode agent `.md` |
| `lib/sdk/agentMarkdown.ts` / `skillMarkdown.ts` | tiny in-repo frontmatter parsers |
| `lib/sdk/outcomeSchema.ts` | OUTCOME JSON-Schema → Zod (`jsonSchemaToZod`, `compileOutcome`) |
| `lib/runtime/agentRuntime.ts` | `AgentRuntimeService.run` — dispatch in-process vs opencode |
| `lib/runtime/openCodeAgentRunner.ts` | OpenCode runner (session token, SSE idle, nudge) |
| `lib/runtime/openCodeRunRegistry.ts` | per-run session↔agent/schema correlation store |
| `lib/runtime/persistence.ts` | shared run/proposal lifecycle + caller-scope helpers |
| `lib/runtime/fileAgentSkills.ts` | runtime skill-content registry for `load_skill`/`run_skill_script` |
| `lib/runtime/sandboxedScript.ts` | `isolated-vm` sandbox for skill/local-tool scripts |
| `lib/runtime/runContext.ts` | AsyncLocalStorage parent-run trace (in-process delegate) |
| `lib/runtime/executeProposal.ts` | optional effector helper (action type → command) |
| `lib/runtime/invokeAgentForWorkflow.ts` | `agentWorkflowBridge` for workflows INVOKE_AGENT |
| `lib/disposition/dispositionService.ts` | auto-approve vs USER_TASK gate |
| `lib/disposition/resume.ts` | human-path `proposal.ready` resume signal |
| `ai-tools.ts` | `delegate_agent`, `submit_outcome`, `load_skill`, `run_skill_script` |
| `ai-agents.ts` / `ai-skills.ts` | in-process agent + skill registration (import side effect) |
| `data/entities.ts` / `data/validators.ts` | `AgentRun`/`AgentProposal` + Zod schemas |
| `commands/{runs,proposals,dispose}.ts` | audited writes |
| `generated/file-agents.generated.ts` | committed file-agent manifest (plain data) |
| `api/*` | agents/runs/proposals list/detail, run, dispose routes |
| `backend/*` | overview/agents/playground/caseload/traces/audit pages |
| `acl.ts` / `setup.ts` / `events.ts` / `di.ts` | features, role grants, events, DI wiring |
| `packages/cli/src/lib/generators/extensions/agent-files.ts` | the generator |
| `docker/opencode/` | Dockerfile (pin 1.1.21), entrypoint, generated agents/skills, compose mounts |
| `apps/mercato/src/modules/agent_examples/` | the 4 shipped example agents + `lookup_ticket_history` tool |
