---
name: om-create-opencode-agent
description: Scaffold a NEW file-defined OpenCode agent for the Open Mercato Agent Orchestrator (the agent assembled from an agents/<id>/ directory of Markdown files and run on the OpenCode runtime / Playground). Creates AGENT.md + OUTCOME.md (+ optional skills/, sub-agents/, tools/), enforces the propose-only hard gates, runs `yarn generate`, and verifies the agent entered the committed manifest. Run this skill IN CLAUDE (it writes the files); the agent itself runs later in OpenCode. Triggers on "/om-create-opencode-agent", "stwórz agenta opencode", "scaffold opencode agent", "dodaj file-defined agenta", "nowy agent na OpenCode", "create a Playground agent". NOT for the in-process `defineAgent`/`ai-agents.ts` path or `<AiChat>` embedding — use `om-create-ai-agent` for that.
---

# Create an OpenCode file-defined agent

Scaffolds a **propose-only, file-defined agent** for the `agent_orchestrator` (enterprise)
module, runnable on the **OpenCode runtime** and from the backend **Playground**. The agent
is a directory of plain-text files — most of it is human-readable Markdown, not code.

You (Claude) run this skill to **write the files + regenerate the manifest**. The finished
agent **runs later in OpenCode**, never in Claude.

> For the OTHER agent type — the in-process `defineAgent` authored in `ai-agents.ts`
> (object-mode, embeddable via `<AiChat>`) — use **`om-create-ai-agent`** instead. This skill
> is only for the `agents/<id>/` file-defined OpenCode path.

## The mental model (four building blocks)

| Block | File | What it is |
|---|---|---|
| **Instructions** | `AGENT.md` body | Who the agent is + how it behaves (plain prose) |
| **Outcome** | `OUTCOME.md` | The exact REQUIRED shape of the answer (JSON Schema) |
| **Tools** | `tools/*.ts` | Concrete read-only actions (data lookups) |
| **Skills** | `skills/<id>/SKILL.md` | Step-by-step playbooks loaded on demand |
| **Sub-agents** | `sub-agents/<id>/` | Narrow specialists the primary delegates to |

The agent **never writes domain data**: it returns a typed **proposal** + a `confidence`
(0–1). A configurable disposition gate (the workflow's "Invoke Agent" node) either
auto-approves above a confidence threshold or routes to a human in the Caseload. Missing
confidence always routes to a human (fail-closed).

## Hard gates — NEVER violate (the agent is rejected at load if you do)

1. **Propose-only.** A file agent may declare ONLY read-only tools. The loader
   (`lib/sdk/defineAgent.ts` C8 check) **rejects the agent at load** if it lists a tool that is
   `isMutation: true` **or unknown** (fail-closed). Never give it a write/mutation tool.
2. **Tool source.** A `// @ref <defineAiTool id>` tool MUST resolve to a tool built in a
   **package** (`packages/**`, compiled to dist). **Never** reference a `defineAiTool` authored
   in an **app module** (`apps/mercato/src/modules/**`) — the standalone MCP server imports the
   compiled tools via plain Node ESM and one failed app-module import drops **all** tools
   (the orchestrator's own `submit_outcome` included), so no file agent can run. If the agent
   needs app-local logic, use a **local sandboxed tool** (`tools/*.ts` with `run(args)`, run via
   `run_skill_script`) instead.
3. **Sandbox.** Local `tools/*.ts` and `skills/**/scripts/*.ts` run in `isolated-vm`:
   **no `fs`, no net, no `require`, no `process`**, 30s / 32MB cap. They are pure functions of
   `args`. They cannot reach the web, the disk, or Google Drive — do not pretend they can.
4. **OUTCOME schema subset.** The JSON Schema in `OUTCOME.md` must stay in the subset compiled
   by `lib/sdk/outcomeSchema.ts`. **Forbidden keywords:** `oneOf`, `anyOf`, `allOf`, `$ref`,
   `format` (and similar) — they fail generation loudly. Mirror the supported shape used by the
   example (object/array/string/number/boolean, `const`, `enum`, `required`, `properties`,
   `items`, `additionalProperties:false`, `minItems`/`minLength`/`minimum`/`maximum`).
5. **Sub-agent depth = 1.** A sub-agent is informative-only (no actionable OUTCOME) and may not
   declare its own `subAgents`.
6. **Generated files.** Never hand-edit `generated/file-agents.generated.ts` or
   `docker/opencode/{agents,skills}/*` — they are `yarn generate` output.

## Preflight (confirm once with the user)

- Enterprise agents enabled in `apps/mercato/.env`:
  `OM_ENABLE_ENTERPRISE_MODULES=true` and `OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true`.
- The OpenCode container is available (`docker compose up -d opencode`) and an AI provider key
  is set (Anthropic or OpenAI). The skill itself does not need these to WRITE the files, but the
  agent cannot RUN without them.

## Step 1 — Define the agent with the user

Pin three things (one agent = one job):
1. **Decision** it proposes (e.g. "next pipeline stage for a deal").
2. **Inputs/data** it needs and **how it gets them** — inline in the run input, a read-only
   `@ref` package tool, or a local sandboxed tool.
3. **Outcome shape** — `informative` (just reports `data`) or `actionable` (proposes `actions` +
   `confidence` + `rationale`).

Then pick:
- **Where it lives.** `apps/mercato/src/modules/<module>/agents/<id>/` (app module — like the
  shipped `agent_examples`) OR `packages/<pkg>/src/modules/<module>/agents/<id>/` (package).
  Reminder: package location is required if you `@ref` a real read-tool; app-module agents must
  use a local sandboxed tool.
- **Agent id** (dotted, e.g. `deals.health_check_file`) and **folder name** (snake/underscore,
  e.g. `deals_health_check`).
- **Provider/model** (e.g. `anthropic` / `claude-sonnet-4-5`) and `maxSteps`.

## Step 2 — Scaffold `agents/<folder>/AGENT.md`

Frontmatter (only `id` + body are required; the rest are optional):

```markdown
---
id: <module>.<name>
label: <Human label>
description: <one line>
provider: anthropic            # or openai
model: claude-sonnet-4-5       # provider/model the OpenCode runtime uses
skills: [<skill_id>]           # optional
subAgents: [<subagent_id>]     # optional
maxSteps: 12                   # optional
---
<Plain-prose instructions: who the agent is, what ONE decision it makes, how to reason,
and that it must express confidence 0–1 with an honest rationale. Tell it to call the
relevant read tool when given only an id instead of inline data, and that it can NEVER
modify anything — the only way to change state is the proposal it returns.>
```

## Step 3 — Scaffold `agents/<folder>/OUTCOME.md`

Frontmatter carries ONLY `kind`. The result schema is the **FIRST** fenced ` ```json ` block;
trailing prose is guidance for the model. Actionable example (copy this exact shape, adapt the
payload):

```markdown
---
kind: actionable
---
` ` `json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["actions", "confidence", "rationale"],
  "properties": {
    "actions": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["type", "payload"],
        "properties": {
          "type": { "const": "<action_type>" },
          "payload": { "type": "object", "additionalProperties": false,
            "required": ["<field>"],
            "properties": { "<field>": { "type": "string", "minLength": 1 } } }
        }
      }
    },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "rationale": { "type": "string", "minLength": 1 }
  }
}
` ` `

<Guidance prose: the EXACT shape, common mistakes to avoid, and "pass this object as the
`outcome` argument of submit_outcome — an object, not a string.">
```

For an **informative** agent use `kind: informative` and let the schema describe `data` (no
`actions`/`confidence` envelope).

## Step 4 — Optional skills / sub-agents / tools

- **Skill:** `skills/<id>/SKILL.md` (reuse the SKILL.md frontmatter; `id` optional → dir name).
  Optional `TEMPLATE.md`, `examples/*.md`, `scripts/*.ts` (sandboxed `run(args)`).
- **Sub-agent:** `sub-agents/<id>/AGENT.md` + `OUTCOME.md` — informative only, no `subAgents`.
- **Tool:** `tools/<name>.ts` = either `// @ref <package defineAiTool id>` (read-only,
  ACL-gated) OR a sandboxed local tool exporting `run(args)`.

Keep `tsconfig.json` `exclude` covering `agents/**/scripts/**` + `agents/**/tools/**` so `tsc`
does not type-check loose sandbox sources (see `apps/mercato/tsconfig.json`).

## Step 5 — Generate + verify

```bash
yarn generate
```

> If `yarn generate` fails with `Error: CLI not built. Run "yarn build:packages" first.`
> (a fresh checkout / worktree where `packages/cli/dist/bin.js` is absent), run
> `yarn build:packages` once first, then re-run `yarn generate`. An already-set-up dev
> checkout does not need this.

Then verify, do not assume:
- The agent id appears in `packages/enterprise/src/modules/agent_orchestrator/generated/file-agents.generated.ts`.
- Container artifacts emitted under `docker/opencode/{agents,skills}/`.
- It passed the load gate (no `[internal] file agent "<id>" declares mutating/unknown tool …
  skipping registration` warning).
- Restart OpenCode to pick it up: `docker compose up -d opencode` (hot-reload is not guaranteed).

Targeted checks:
```bash
yarn workspace @open-mercato/cli test --testPathPatterns agent-files
yarn typecheck --filter=@open-mercato/core --filter=@open-mercato/cli
mercato ai_assistant mcp:list-tools   # expect the FULL tool set, not just 3 Code Mode tools
```

## Step 6 — Run it + the approval gate (tell the user)

1. Backend → Agent Orchestrator → **Playground**: pick the agent, paste sample input, Run.
2. An `actionable` result becomes an `AgentProposal`. The disposition gate decides:
   - "always ask" / low confidence → it waits in the **Caseload** for approve/edit/reject;
   - confidence ≥ the node's auto-approve threshold → auto-approved + effected, logged to audit.
3. Auto-approve is **off by default** — it is set per "Invoke Agent" workflow node, a deliberate
   decision the operator makes.

## Acceptance — self-test the skill ~2×

Run the full flow twice with two DIFFERENT shapes (e.g. one `actionable` with a sub-agent + a
read tool, one `informative` with no tools):
- files written under `agents/<id>/`,
- `yarn generate` clean, agent in the manifest, no load-gate warning,
- a dry-run in the Playground returns a schema-valid outcome.
If the load gate skips the agent, re-read Hard gates 1–2 (mutation/unknown/app-module tool).

## Reference (authoritative, do not template from memory)

- Convention + gates: `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`.
- Working examples to copy: `apps/mercato/src/modules/agent_examples/agents/deals_health_check/`
  (`AGENT.md`, `OUTCOME.md`, `skills/stage_playbook/`, `sub-agents/activity_scan/`) and
  `agents/support_resolution_advisor/` (local sandboxed `tools/lookup_ticket_history.ts`).
- Parsers/loader/generator: `lib/sdk/{agentMarkdown,outcomeSchema,skillMarkdown,defineFileAgent}.ts`,
  `lib/sdk/defineAgent.ts` (load gate), `packages/cli/src/lib/generators/extensions/agent-files.ts`.
- Business-audience guide (the why, for non-technical stakeholders): the "Agent AI w Open Mercato"
  doc this skill was built from.
