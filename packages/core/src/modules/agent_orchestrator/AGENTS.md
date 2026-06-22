# Agent Orchestrator — Agent Guidelines

The orchestrator runs propose-only AI agents that always return a typed, validated
`AgentResult` (`informative | actionable`), persist an `AgentRun` (+ `AgentProposal`
for actionable), and never perform domain writes directly — writes only ever happen
via proposal → disposition → effector. Two runtimes coexist behind one registry and
one `agentRuntime.run()`:

- **in-process** (`defineAgent`, `ai-agents.ts`): Vercel AI SDK object mode. Best for
  simple typed agents authored as code.
- **opencode** (file-defined `agents/<id>/`): runs on the OpenCode runtime. Best for
  agents that need skills, sub-agents, or sandboxed scripts authored as files.

See `.ai/specs/2026-06-22-opencode-file-defined-agents.md` (+ the `-phase0-findings.md`
implementation contract) for the full design.

## Always

- Keep every agent **propose-only**. A file agent's two hard gates are (1) the
  generated OpenCode agent-file read-only `tools` allowlist + `permission` deny block,
  and (2) the per-run session-token ACL re-checked on every MCP call. The OpenCode MCP
  server does NOT strip `isMutation` tools — so a file agent that declares an
  `isMutation:true` tool is rejected at load (`loadFileAgents` gate). Never weaken either gate.
- Author file agents under `packages/<pkg>/src/modules/<module>/agents/<agent_id>/` (or an
  app module). Required: `AGENT.md` + `OUTCOME.md`. Optional: `skills/<sid>/SKILL.md`
  (+ `TEMPLATE.md`, `examples/*.md`, `scripts/*.ts`), `sub-agents/<subid>/`, `tools/*.ts`.
- Keep the OUTCOME schema in the supported JSON-Schema subset (compiled to Zod by
  `lib/sdk/outcomeSchema.ts`). Unsupported keywords (`oneOf`/`anyOf`/`$ref`/`format`/…)
  fail generation loudly.
- Run `yarn generate` after adding/editing any `agents/<id>/` file. It re-emits the
  committed manifest (`generated/file-agents.generated.ts`) and the container artifacts
  under `docker/opencode/{agents,skills}/`, then **restart OpenCode** to pick them up
  (`docker compose up -d opencode` — hot-reload is not guaranteed).
- Reuse `agent_orchestrator.agents.run` for new MCP tools' `requiredFeatures` — do not
  add new ACL features for the file-agent path.

## Ask First

- Ask before changing the OUTCOME → Zod compiler's supported subset, the committed
  manifest shape (`FileAgentDescriptor`), or the MCP tool ids (`submit_outcome`,
  `load_skill`, `run_skill_script`, `delegate_agent`) — these are contract surfaces.
- Ask before generating native `.opencode/tool/*` custom tools that run OUTSIDE the
  MCP/sandbox path (they would bypass the ACL gate and break propose-only).
- Ask before raising the sandbox 30s timeout or widening the sandbox's injected globals.

## Never

- Never let a file-agent script or local tool touch fs/net, mutate domain state, or
  escape the `isolated-vm` sandbox. Local `tools/*.ts` are either `// @ref <defineAiTool id>`
  references (centrally ACL-gated) or sandboxed pure functions run via `run_skill_script`.
- Never reference a `defineAiTool` id authored in an **app module** (`apps/mercato/src/modules/**`)
  from a file-defined agent's `tools:`. The standalone MCP server (`mercato ai_assistant
  mcp:serve-http`) loads the compiled `ai-tools.generated.mjs` via plain Node ESM, which cannot
  import app-module TS source — and one failed import drops **all** module tools (the orchestrator
  MCP tools included), so no file agent can call `submit_outcome`. Reference tools from **packages**
  (built to dist) only, or use a **local sandboxed tool file** (`agents/<id>/tools/*.ts` run via
  `run_skill_script`) — the example agent uses the latter. Verify with `mercato ai_assistant
  mcp:list-tools` (expect the full set, not just 3 Code Mode tools).
- Never let `agents/**/scripts/**` or `agents/**/tools/**` into a package/app's typed build.
  They are raw sandbox sources (read by the generator via `fs`, never imported/bundled), so
  the consuming `tsconfig.json` MUST `exclude` those globs (see `apps/mercato/tsconfig.json`)
  — otherwise `tsc` type-checks loose script JS and fails.
- Never hand-edit `generated/file-agents.generated.ts` or `docker/opencode/agents|skills/*`
  — they are generator output (committed so they travel with the repo).
- Never trust the active agent / skill / outcome from the model. MCP tools resolve the
  active agent from the per-run correlation store keyed by the session token (`ctx.sessionId`).
- Never give a sub-agent an actionable OUTCOME or its own `subAgents` (depth cap = 1).

## Validation Commands

```bash
yarn workspace @open-mercato/core test --testPathPatterns agent_orchestrator
yarn workspace @open-mercato/cli test --testPathPatterns agent-files
yarn typecheck --filter=@open-mercato/core --filter=@open-mercato/cli
yarn generate   # then: docker compose up -d opencode
```

## The `agents/<id>/` convention

```
agents/<agent_id>/
├── AGENT.md          # frontmatter (id,label,description,provider?,model?,tools?,skills?,subAgents?,maxSteps?) + body = instructions
├── OUTCOME.md         # frontmatter `kind: informative|actionable` + FIRST fenced ```json block = JSON-Schema; trailing prose = guidance
├── skills/<sid>/
│   ├── SKILL.md       # reuse the in-repo SKILL.md frontmatter (id optional → dir name; tools optional)
│   ├── TEMPLATE.md    # optional output template (returned by load_skill)
│   ├── examples/*.md  # optional few-shot (returned by load_skill)
│   └── scripts/*.ts   # optional sandboxed helper; MUST define `run(args)`; run via run_skill_script
├── sub-agents/<subid>/  # AGENT.md + OUTCOME.md; informative-only, no further subAgents (depth cap 1)
└── tools/*.ts           # `// @ref <defineAiTool id>` (preferred, ACL-gated) OR a sandboxed `run(args)` local tool
```

- **OUTCOME.md authoring**: frontmatter carries ONLY `kind`; the result JSON-Schema is the
  FIRST fenced ` ```json ` block in the body. `informative` ⇒ schema describes `data`;
  `actionable` ⇒ schema describes the `proposal` envelope. Compiled to the same
  `z.object({ kind, data|proposal })` shape the in-process path uses, so validation +
  persistence + the `submit_outcome` input schema are all the same.

## Runtime split + key files

- Registry + `runtime` field: `lib/sdk/defineAgent.ts` (`registerFileAgent`, `ensureAgentsLoaded`
  loads the committed manifest + the load-time propose-only mutation gate).
- Parsers + loader: `lib/sdk/agentMarkdown.ts`, `lib/sdk/outcomeSchema.ts`, `lib/sdk/skillMarkdown.ts`,
  `lib/sdk/defineFileAgent.ts` (`loadFileAgentDir`).
- Generator: `packages/cli/src/lib/generators/extensions/agent-files.ts` (scans `agents/<id>/`,
  fails on malformed dirs, emits the manifest + `docker/opencode/{agents,skills}/`). The CLI
  cannot import `@open-mercato/core`, so it reimplements the tiny parsers — keep them in sync.
- Runner + dispatch: `lib/runtime/agentRuntime.ts` (dispatch on `entry.runtime`),
  `lib/runtime/openCodeAgentRunner.ts` (per-run session token, send with `agent: <name>` +
  long timeout, poll the shared store for the outcome OR SSE idle, one corrective nudge then
  fail-closed), `lib/runtime/agentRunSessionStore.ts` (DB-backed `agent_run_sessions`
  cross-process correlation — the runner and the separate `mcp:serve-http` process share it;
  an in-process Map does NOT work across processes), `lib/runtime/persistence.ts` (shared
  run/proposal lifecycle), `lib/runtime/runContext.ts` (AsyncLocalStorage parent-run trace for
  the in-process delegate path).
- MCP tools (`ai-tools.ts`): `submit_outcome` (terminal outcome), `load_skill` (progressive
  disclosure fallback), `run_skill_script` (sandboxed scripts + local tools), `delegate_agent`
  (in-process sub-agent fan-out). All `isMutation:false`, gated by `agent_orchestrator.agents.run`.
- Sandbox: `lib/runtime/sandboxedScript.ts` reuses the ai-assistant `isolated-vm` sandbox
  (no fs/net/require/process, 30s cap). Scripts are pure functions of `args`.

## Known follow-ups

- OpenCode-native `task` sub-agent delegation runs sub-agents inside OpenCode (not via our
  runner), so per-sub-agent `AgentRun` rows are recorded only for the in-process `delegate_agent`
  path today; `agent_runs.parent_run_id` is wired for that path. Native nested-run recording is a follow-up.
- The pinned `OPENCODE_VERSION` and the installer's version-pin env var are ASSUMPTION-to-verify
  against the running image (phase-0 findings §6); confirm in an end-to-end smoke test.
- Native-skill bundling of `TEMPLATE.md`/`examples`/`scripts` is unconfirmed; the `load_skill`
  / `run_skill_script` MCP path is the authoritative carrier regardless.
```
