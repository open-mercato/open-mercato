# Phase 0 findings — OpenCode file-defined agents (spike)

- **Date**: 2026-06-22
- **Status**: Phase 0 complete — go/no-go confirmed, implementation contract locked
- **Parent spec**: `.ai/specs/2026-06-22-opencode-file-defined-agents.md`
- **Branch**: `feat/opencode-file-defined-agents`

This note documents (1) OpenCode's actual contracts as grounded in the in-repo
integration + the public OpenCode docs, and (2) the finalized implementation
contract that Phases 1-5 implement verbatim. Anything not provable from the repo
is marked **ASSUMPTION (verify against pinned image)**.

Sources for OpenCode-side claims: `opencode.ai/docs/agents`, `/docs/server`,
`/docs/skills`, `/docs/custom-tools`, plus the in-repo files cited inline.

---

## OpenCode contract findings

### 1. Agent-file frontmatter schema + agent dir + hot-reload

**Frontmatter schema** (markdown file, YAML frontmatter, body = system prompt).
Confirmed keys from `opencode.ai/docs/agents`:

| Key | Meaning |
|---|---|
| `mode` | `primary` \| `subagent` \| `all` (default `all`). Primary = directly selectable; subagent = only reachable via the `task` tool. |
| `description` | required; brief purpose (also shown to a primary agent in the `task` tool listing). |
| `model` | `provider/model-id` override. Falls back to global `opencode.jsonc` `model`. |
| `temperature`, `top_p` | sampling. |
| `prompt` | optional system-prompt override; otherwise the markdown **body** is the prompt. |
| `tools` | per-tool allow/deny map (e.g. `{ "write": false }`) — same shape as the global `tools` block in `opencode.jsonc`. |
| `permission` | fine-grained map; keys `read,edit,glob,grep,list,bash,task,external_directory,…`; each value is a shorthand `allow|ask|deny` OR a `{ glob → action }` object. |
| `disable` | boolean. |
| `color` | UI only. |

The **filename is the agent id** (`review.md` → agent `review`). Our agent ids
contain dots (`deals.health_check`); OpenCode agent ids are filename-derived, so
the generator MUST emit a filesystem-safe filename and let the runner pass the
matching id in the `agent` field. **DECISION**: emit `<sanitized-id>.md` where
`sanitized = id.replace(/[^a-z0-9_-]/gi, '_')` (e.g. `deals_health_check.md` →
agent `deals_health_check`); the registry stores BOTH the OM id (`deals.health_check`)
and the `openCodeAgentName` (`deals_health_check`) so the runner sends the latter.

**Agent dir.** `~/.config/opencode/agents/` (global) or `.opencode/agents/`
(project). Per docs, the `.opencode` / `~/.config/opencode` trees use **plural**
subdir names (`agents/`, `skills/`, `tools/`, `commands/`, `plugins/`); singular
(`agent/`) is accepted only as a back-compat alias and the `opencode agent create`
CLI has a known bug writing the singular form that the loader ignores
(sst/opencode#14410). **DECISION**: always emit to the **plural** `agents/`,
`skills/`, `tools/` dirs.

In our container the OpenCode home is `/home/opencode` and config dir is
`/home/opencode/.config/opencode` (see `docker/opencode/Dockerfile` +
`entrypoint.sh`). So the prod/dev target dir is
`/home/opencode/.config/opencode/agents/` (NOT `/root/...` — the AGENTS.md Docker
snippet showing `/root/.opencode/...` is stale; the real image runs as the
non-root `opencode` user). Skills → `…/.config/opencode/skills/`, tools →
`…/.config/opencode/tools/`.

**Hot-reload**: **ASSUMPTION (verify against pinned image)** — the docs only say
agents are picked up on startup / new sessions. Treat agent/skill/tool files as
**load-on-new-session**, NOT live hot-reload. Practical consequence for §14.3-A
(dev bind-mount): after regenerating, a `docker compose restart opencode` (or at
least a fresh session) is required to guarantee pickup. Phase 1 docs MUST state
"regenerate → restart opencode" rather than promising instant reload.

### 2. Per-message `agent` selection

**Confirmed.** `POST /session/:id/message` accepts an optional `agent?` field
(alongside `model?`, `system?`, `tools?`, `messageID?`, `noReply?`, and required
`parts`). The runner depends on this and it exists. The in-repo
`OpenCodeClient.sendMessage(sessionId, message, { model? })`
(`opencode-client.ts:301`) builds `body = { parts: [{type:'text',text}] }` and
optionally `body.model = { providerID, modelID }`. **Phase 2 extends it
additively** to `sendMessage(sessionId, message, { model?, agent? })`, setting
`body.agent = options.agent` when present (BC-safe per spec §12 / §17.1).

### 3. Native skills mechanism

**Confirmed native.** OpenCode has a first-class skills feature
(`opencode.ai/docs/skills`):
- Skill files: `.opencode/skills/<name>/SKILL.md` (and `~/.config/opencode/skills/…`).
  It ALSO reads Claude-compatible `.claude/skills/<name>/SKILL.md` and
  `.agents/skills/<name>/SKILL.md`.
- `SKILL.md` frontmatter: `name` (required, `^[a-z0-9]+(-[a-z0-9]+)*$`, 1-64),
  `description` (required, 1-1024), optional `license`, `compatibility`,
  `metadata` (string→string map). **Note**: this differs from our existing
  `skillMarkdown.ts` schema (`id`/`moduleId`/`label`/`description`/`tools`). The
  generator MUST translate our skill into OpenCode's `name`+`description`+body
  shape.
- Progressive disclosure: OpenCode lists each skill's `name`+`description` in the
  built-in `skill` tool's description; the model calls `skill({ name })` to pull
  the full `SKILL.md` body on demand. This is exactly the spec §7.5 "native
  preferred" path.

**DECISION**: Phase 3 generates native `SKILL.md` files into
`…/.config/opencode/skills/<sanitized-skill-id>/SKILL.md`. The
`agent_orchestrator.load_skill` MCP tool is the **fallback only** (kept for
parity + for any skill content OpenCode native skills can't carry, e.g. bundled
TEMPLATE.md/examples — native skill bundling of scripts/templates is
**ASSUMPTION (verify against pinned image)**, the docs don't confirm it). Either
way, skill-contributed read-only tools are unioned into the agent's `tools`
allowlist at generate time.

### 4. Subagent / task delegation + parallelism + read-only constraint

- A subagent is an agent file with `mode: subagent`. A primary agent delegates by
  calling the built-in **`task`** tool; `permission.task` on the primary controls
  which subagents are reachable (`{"*":"deny"}` then whitelist).
- **Parallelism**: "agent decides" — when the model emits multiple independent
  `task` calls they run concurrently (matches spec §7.6 and the in-process
  `delegate_agent` fan-out model). Exact concurrency caps are
  **ASSUMPTION (verify against pinned image)**.
- **Read-only constraint** on a subagent: set frontmatter
  `permission: { edit: deny, bash: deny, write: deny }` plus a `tools` deny block,
  and (critically) restrict the MCP tool allowlist to read-only tools. **DECISION**
  (Phase 4): generated subagents are `mode: subagent`, get the read-only
  permission block, and are wired to `submit_outcome` only as *informative*; they
  may NOT delegate further (no `task` allowance) → depth cap = 1, matching the
  in-process rule in `ai-tools.ts` (`entry.subAgents.length > 0 → reject`).

### 5. Reliable termination by calling `submit_outcome` (not prose)

**Finding: there is no hard "force a terminal tool call" switch we can rely on.**
OpenCode runs the standard AI-SDK "LLM-in-a-loop" with `stopWhen`; several open
issues show provider-dependent `finish_reason` handling and loops that
stop-after-tool or hang (sst/opencode #14972, #20719, #17516, #26220). There is
no documented per-message `tool_choice: required` we can set to force
`submit_outcome`.

**DECISION** — terminate via convention + server-side gate + nudge (matches spec
§7.3 / §13 / §17.4-1):
1. The generated agent prompt ends with a strong instruction: "Finish by calling
   `agent_orchestrator.submit_outcome` with a value matching the outcome
   contract. Do not answer in prose." (mirrors the in-process finalize step).
2. The **runner is the source of truth**: it consumes the SSE stream
   (`subscribeToEvents` / the `handleOpenCodeMessageStreaming` idle-detection
   plumbing in `opencode-handlers.ts` — completion is signaled by
   `session.status: idle`, NOT HTTP completion; do NOT `Promise.race`) and
   captures the `submit_outcome` payload from the MCP-tool call.
3. If the session goes idle **without** a captured outcome, the runner sends ONE
   corrective follow-up message (same session) and waits again; still nothing →
   the run FAILS (no silent partial result). Validation is server-side in
   `submit_outcome` AND re-validated by the runner (defense in depth).

The `submit_outcome` tool returns the validated outcome to the runner via the run
session record (the runner reads it back), so "the agent called the tool" is the
real terminal signal, independent of `finish_reason` quirks.

### 6. Pinned OpenCode image version

**Not pinned today.** `docker/opencode/Dockerfile:8` runs
`curl -fsSL https://opencode.ai/install | bash` with **no version**, so every
image build floats to latest. The only version evidence in-repo is the
AGENTS.md sample health output `"version":"1.1.21"` (illustrative, not a pin).

**DECISION (Phase 0 deliverable, do in Phase 1)**: pin the installer, e.g.
`OPENCODE_VERSION=<x.y.z>` ARG → `curl … | VERSION=$OPENCODE_VERSION bash` (exact
installer env var is **ASSUMPTION (verify against pinned image)** — confirm the
installer's version pin flag against the chosen release), and record the pinned
version here + in `packages/ai-assistant/AGENTS.md`. The agent-file / message
`agent` / skills / task contracts above are validated against THAT pin. **Phase 1
MUST NOT start the run bridge until a concrete version is pinned.**

### Go/no-go verdict

All six items are confirmed or have a concrete decision. The only items relying
on the pinned image (hot-reload semantics, native-skill bundling, task
concurrency caps, installer pin flag) are flagged ASSUMPTION and are validated as
the FIRST task of Phase 1 against the pinned tag. **GO.**

### Key gap vs. spec to flag (propose-only)

Spec §7.4/§7.8 assume the MCP server "strips `isMutation: true` tools for
read-only agents." **That stripping does NOT happen on the OpenCode MCP path.**
- The in-process agent-runtime strips mutation tools for `readOnly` agents
  (`agent-runtime.ts:835`), but
- the MCP **HTTP server registers ALL tools** and only enforces per-call ACL via
  the session token (`http-server.ts:150-260`); it never filters by `isMutation`.

Therefore, for OpenCode file-agents, propose-only must be enforced by **two
concrete gates** (documented in the contract below, §"Propose-only"):
(a) the generated OpenCode agent `tools` allowlist lists ONLY the agent's
declared read-only MCP tool ids (deny-by-default), and (b) the per-run session
token's ACL does not grant features for any mutation tool. The integration test
asserts no `isMutation:true` tool is reachable. This is an adjustment to the
spec's wording, not its intent.

---

## Implementation contract (Phases 1-5)

All paths absolute-from-repo-root. Function names and signatures are normative —
implement exactly. "BC-safe" = additive per `BACKWARD_COMPATIBILITY.md` + spec §12/§17.1.

### C0. Convention directory

```
packages/<pkg>/src/modules/<module>/agents/<agent_id>/
├── CLAUDE.md                     # frontmatter (metadata) + body (instructions)
├── OUTCOME.md                    # frontmatter (kind + JSON-Schema) + body (prose guidance)
├── skills/<skill_id>/SKILL.md    # + optional TEMPLATE.md, examples/*.md, scripts/*.ts
├── sub-agents/                   # files OR references to other agent ids   (Phase 4)
└── tools/                        # *.ts handlers OR refs to defineAiTool ids (Phase 5)
```

`<agent_id>` is the dir name; the CLAUDE.md `id` frontmatter is authoritative and
MUST match. Generation FAILS (hard error) if CLAUDE.md or OUTCOME.md is missing or
malformed in any discovered `agents/<id>/` dir (spec §9).

### C1. OUTCOME schema → Zod (`outcomeSchema.ts`)

New module: `packages/core/src/modules/agent_orchestrator/lib/sdk/outcomeSchema.ts`.
**No new ajv / json-schema validator production dependency** — convert the
OUTCOME.md JSON Schema subset directly to Zod (the codebase already standardizes
on Zod end-to-end; the in-process path feeds Zod to `runAiAgentObject`).

```ts
import { z, type ZodTypeAny } from 'zod'

export type JsonSchemaNode = { /* narrow runtime type, no `any` */ }

/** Convert a supported JSON-Schema subset to a Zod schema. Throws on unsupported nodes. */
export function jsonSchemaToZod(schema: JsonSchemaNode): ZodTypeAny

export type OutcomeKind = 'informative' | 'actionable'

/**
 * Compile an OUTCOME.md descriptor into the SAME AgentResult shape `defineAgent`
 * feeds AgentRuntimeService + AI object-mode output, so all downstream
 * validation/persistence works unchanged.
 *   informative ⇒ z.object({ kind: z.literal('informative'), data: <schema> })
 *   actionable  ⇒ z.object({ kind: z.literal('actionable'),  proposal: <schema> })
 */
export function compileOutcome(input: { kind: OutcomeKind; schema: JsonSchemaNode }):
  { kind: OutcomeKind; resultSchema: ZodTypeAny }
```

**Supported JSON-Schema subset** (exact): `object` (`properties`, `required`,
`additionalProperties`), `array` (`items`, `minItems`), `string` (`minLength`,
`enum`), `number`/`integer` (`minimum`, `maximum`), `boolean`, `nullable`,
`const`, and arbitrary nesting/combinations of the above. Unsupported keywords
(`oneOf`, `anyOf`, `patternProperties`, `$ref`, `format`, …) → throw a typed
error so generation fails loudly. Mapping notes: `additionalProperties:false` →
`.strict()`; missing-from-`required` props → `.optional()`; `nullable:true` →
`.nullable()`; `enum` on string → `z.enum([...])`; `const` → `z.literal(...)`.

The compiled `resultSchema` is what becomes the registry entry's `schema` and the
`output.schema` fed to `runAiAgentObject`, AND the input schema of `submit_outcome`.

**Deferred (NOT in v1)**: the optional `schemaRef` (Zod export) escape hatch from
OUTCOME.md frontmatter. v1 supports JSON-Schema-in-frontmatter only.

### C2. CLAUDE.md parser (`agentMarkdown.ts`)

New module: `packages/core/src/modules/agent_orchestrator/lib/sdk/agentMarkdown.ts`,
mirroring `skillMarkdown.ts` (tiny hand-rolled frontmatter parser, **no new YAML
dep**, same `FRONTMATTER_RE` + inline-`[a,b]` + block-`- a` list handling).

```ts
export type AgentMarkdown = {
  id: string
  label: string
  description: string
  provider?: string
  model?: string
  tools: string[]
  skills: string[]
  subAgents: string[]
  maxSteps?: number
  instructions: string   // body, trimmed
}

/** Returns null if any required key (id, label, description) is missing. */
export function parseAgentMarkdown(raw: string): AgentMarkdown | null
```

Frontmatter keys: `id`, `label`, `description`, `provider`, `model`, `tools[]`,
`skills[]`, `subAgents[]`, `maxSteps`. List keys accept BOTH `tools: [a, b]` and a
block list. Body (everything after closing `---`) → `instructions`. `maxSteps`
parsed via `Number.parseInt`; ignore when NaN.

### C3. Registry additions (`defineAgent.ts`)

Additive (BC-safe). Add `runtime` to both `DefineAgentInput` and
`AgentRegistryEntry`, default `'in-process'`:

```ts
export type AgentRuntime = 'in-process' | 'opencode'

// DefineAgentInput: runtime?: AgentRuntime          // default 'in-process'
// AgentRegistryEntry: runtime: AgentRuntime         // always set
```

- `defineAgent(...)` sets `runtime: 'in-process'` on the entry it registers
  (existing behavior unchanged for all current agents).
- A new `registerFileAgent(entry: AgentRegistryEntry)` registers a file agent with
  `runtime: 'opencode'` into the **same** in-memory `registry` map (same dup-id
  guard). It is discoverable via the existing `getAgentEntry` / `listAgentEntries`
  / `ensureAgentsLoaded`. File agents need NO `AiAgentDefinition` (they don't run
  in-process), so `registerFileAgent` writes the entry directly rather than going
  through `defineAiAgent`.
- `ensureAgentsLoaded()` is extended to ALSO load file-agent entries from the
  committed manifest (see C5) so file agents appear in the Agents list/detail
  without the in-process agents framework.

### C4. File-agent loader (`defineFileAgent.ts`)

New module: `packages/core/src/modules/agent_orchestrator/lib/sdk/defineFileAgent.ts`.
Pure, fs-based, unit-testable against fixtures.

```ts
export type LoadedFileAgent = {
  entry: AgentRegistryEntry          // runtime: 'opencode', schema = compiled OUTCOME resultSchema
  openCodeAgentFile: string          // rendered OpenCode agent .md (frontmatter + body)
  openCodeAgentName: string          // sanitized filename-id passed in the message `agent` field
  subAgents: LoadedFileAgent[]       // Phase 4; [] in Phase 1-3
}

/**
 * Read agents/<id>/{CLAUDE.md,OUTCOME.md}(+skills/sub-agents), validate, compile.
 * Returns null when the dir is not a valid agent (missing/malformed files →
 * the generator turns a null into a hard generation error; see C5).
 */
export function loadFileAgentDir(dir: string): LoadedFileAgent | null

/** Re-export from defineAgent for callers that register a loaded entry. */
export { registerFileAgent } from './defineAgent'
```

`entry.schema = compileOutcome(...).resultSchema`; `entry.resultKind =
OUTCOME.kind`; `entry.tools = CLAUDE.tools ∪ skill-contributed read-only tools`;
`entry.subAgents = CLAUDE.subAgents`. `openCodeAgentName =
entry.id.replace(/[^a-z0-9_-]/gi, '_')`.

### C5. Generator + container delivery + manifest (the wiring decision)

New generator extension:
`packages/cli/src/lib/generators/extensions/agent-files.ts`, registered in
`packages/cli/src/lib/generators/extensions/index.ts` (reuse `scanner.ts`). It:

1. Scans every module for `agents/<id>/` dirs (across packages + app + active
   official-modules), runs `loadFileAgentDir` on each.
2. **Fails generation** (non-zero) on any malformed CLAUDE.md/OUTCOME.md
   (spec §9). Reports the offending dir.
3. Emits OpenCode agent `.md` files (+ subagent files in Phase 4, native SKILL.md
   in Phase 3) to **`docker/opencode/agents/`** (and `…/skills/`, `…/tools/`),
   **git-tracked**, per spec §14.3: dev bind-mounts them (model A), CI bakes them
   into the image via Dockerfile `COPY` (model B). The compose mount + Dockerfile
   `COPY` land in Phase 1 targeting `/home/opencode/.config/opencode/agents/`.
4. Emits a generated registry.

**The packages-can't-import-app-generated constraint, resolved precisely.**
Packages MUST NOT import `apps/mercato/.mercato/generated/*` (root `AGENTS.md`,
`packages/core/AGENTS.md`). So the file-agent registry CANNOT live only in
`.mercato/generated/`. **DECISION — committed embedded manifest read by the
module:**

- The generator writes a **committed, git-tracked** manifest module at
  `packages/core/src/modules/agent_orchestrator/generated/file-agents.generated.ts`
  (a `*.generated.ts` file that lives inside the module, the narrow exception
  allowed for versioned generated registries that must travel with the repo and
  survive `yarn clean-generated`). It exports a serializable array of file-agent
  descriptors: `{ id, moduleId, label, description, instructions, resultKind,
  outcomeSchema /* the raw JSON-Schema subset */, tools, skills, subAgents,
  openCodeAgentName, maxSteps?, provider?, model? }`. JSON-Schema (not a Zod
  instance) is stored so the file is plain data; `ensureAgentsLoaded()` calls
  `compileOutcome` at load time to rebuild the Zod `resultSchema`.
- `ensureAgentsLoaded()` (C3) imports this committed manifest with a static
  relative import (`../../generated/file-agents.generated`), and for each
  descriptor calls `registerFileAgent(...)` after recompiling the schema. No
  app-generated file is imported by any package. The app simply re-exports /
  bundles this module as today.
- Rationale for one approach: this keeps the file inside the module that owns it
  (so `agent_orchestrator` reads its own embedded definitions), satisfies the
  no-app-generated-import rule, survives `yarn clean-generated`, and is reviewable
  in PRs alongside the `docker/opencode/agents/` output. (The OpenCode agent `.md`
  files in `docker/opencode/agents/` are the runtime-delivery artifact; this
  manifest is the OM-registry artifact — both are emitted by the same generator
  pass, kept in sync.)

`yarn generate` runs this extension; `predev`/`prebuild` already invoke it.
Container refresh: regenerate → `docker compose up -d opencode` (restart, since
hot-reload is not guaranteed — see finding §1). Document in
`packages/ai-assistant/AGENTS.md`.

### C6. `submit_outcome` + `load_skill` MCP tools (`ai-tools.ts`)

Add to `packages/core/src/modules/agent_orchestrator/ai-tools.ts` via
`defineAiTool` — the SAME path the existing `delegate_agent` tool already uses
(auto-discovered by the ai-tools generator + `tool-loader.ts`). Both:
`isMutation: false`, `requiredFeatures: ['agent_orchestrator.agents.run']`.

```ts
// agent_orchestrator.submit_outcome
inputSchema: z.object({
  // the active agent id is resolved from the run session context the runner
  // created — NOT trusted from the model. `outcome` is validated against that
  // agent's compiled OUTCOME resultSchema (fail → typed error so OpenCode retries).
  outcome: z.unknown(),
})
// handler: resolve active agentId from session ctx → entry.schema.safeParse(outcome)
//          → on success, store validated outcome on the run session record + signal
//            completion (runner reads it back as AgentResult); on failure, return
//            { ok:false, code:'outcome_invalid', errors } so the agent corrects.

// agent_orchestrator.load_skill (Phase 3 fallback; native skills preferred)
inputSchema: z.object({ skillId: z.string().min(1) })
// handler: return { instructions, template?, examples? } for an allowed skill id
//          (allowed set is the active agent's skills, resolved from session ctx).
```

`requiredFeatures: ['agent_orchestrator.agents.run']` reuses an existing ACL
feature (spec §17.1 — no new ACL feature). Add no new feature.

### C7. Runner + dispatch (`openCodeAgentRunner.ts`, `agentRuntime.ts`)

`AgentRuntimeService.run()` (`lib/runtime/agentRuntime.ts`) dispatches on
`entry.runtime`:
- `'in-process'` → existing object-mode path (unchanged).
- `'opencode'` → new `OpenCodeAgentRunner` in
  `packages/core/src/modules/agent_orchestrator/lib/runtime/openCodeAgentRunner.ts`.

Runner flow (spec §7.7):
1. Create the `AgentRun` via the existing `agent_orchestrator.runs.create` command
   (same as in-process).
2. Resolve caller ACL (reuse `resolveCallerAcl`), then mint a **per-run session
   token** via the audited flow: `generateSessionToken()` +
   `createSessionApiKey(em, { sessionToken, userId, userRoles, tenantId,
   organizationId, ttlMinutes: 120 })` from
   `packages/core/src/modules/api_keys/services/apiKeyService.ts`. Fresh token per
   run, scoped to `ctx.tenantId/organizationId/userId` with the caller's roles —
   never static, never superadmin (spec §7.8/§13).
3. `client.createSession()`, then
   `client.sendMessage(session.id, JSON.stringify(input), { agent: openCodeAgentName })`,
   prepending the session-token instruction (same `[Session Authorization: …
   include "_sessionToken" in EVERY tool call]` convention as
   `chat/route.ts:330`).
4. Consume the SSE stream (idle-detection plumbing from
   `opencode-handlers.ts`; complete on `session.status: idle`, never
   `Promise.race`). Capture the `submit_outcome` payload.
5. No outcome on idle → ONE corrective follow-up, wait again; still none → fail
   the run (`agent_orchestrator.runs.fail`).
6. Re-validate the captured outcome against `entry.schema` (defense in depth) →
   shape `AgentResult` → `runs.complete` (+ `proposals.create` for actionable),
   identical to the in-process tail. Returns the same `AgentResult` union.

**Test seam (required)**: `OpenCodeAgentRunner` MUST receive its `OpenCodeClient`
via DI/constructor injection (e.g. resolve `openCodeClient` from the container, or
accept it as a constructor dep) so tests pass a **fake client** that scripts the
SSE/`submit_outcome` exchange without a real OpenCode container. Default
production wiring uses `createOpenCodeClient()`. Do NOT `new OpenCodeClient` inline
in `run()`.

### C8. Propose-only (the hard gate)

Because the MCP HTTP server does NOT strip `isMutation` (finding gap above),
propose-only for OpenCode file-agents rests on TWO gates, both MUST be implemented:

1. **Read-only MCP allowlist at the OpenCode agent file**: the generated agent
   `.md` `tools` block denies everything by default and allows ONLY the agent's
   declared read-only MCP tool ids (the `mcp` tool names for `entry.tools` +
   `submit_outcome` + `load_skill`), plus `permission: { write:deny, edit:deny,
   bash:deny }`. The generator MUST refuse (fail generation) if `entry.tools`
   references a tool registered with `isMutation: true`.
2. **Session-token ACL**: the per-run token carries only the caller's features;
   every MCP tool call re-checks `requiredFeatures` server-side
   (`http-server.ts`). A mutation tool the caller lacks features for is
   unreachable regardless of the prompt.

**Integration test (spec §11/§17.4-3)**: assert that for a file agent, NO
`isMutation: true` tool is present in the agent's effective allowlist AND that a
direct MCP call to a write tool under the run's session token is rejected
(`UNAUTHORIZED`) — i.e. no write tool is reachable. This test is the
propose-only contract and gates Phase 2.

### File-path summary (new files)

| File | Phase | Purpose |
|---|---|---|
| `packages/core/src/modules/agent_orchestrator/lib/sdk/outcomeSchema.ts` | 1 | `jsonSchemaToZod`, `compileOutcome` |
| `packages/core/src/modules/agent_orchestrator/lib/sdk/agentMarkdown.ts` | 1 | `parseAgentMarkdown` |
| `packages/core/src/modules/agent_orchestrator/lib/sdk/defineFileAgent.ts` | 1 | `loadFileAgentDir`, re-export `registerFileAgent` |
| `packages/core/src/modules/agent_orchestrator/lib/sdk/defineAgent.ts` (edit) | 1 | add `runtime`, `registerFileAgent`, extend `ensureAgentsLoaded` |
| `packages/core/src/modules/agent_orchestrator/generated/file-agents.generated.ts` | 1 | committed embedded manifest (generated) |
| `packages/cli/src/lib/generators/extensions/agent-files.ts` (+ index reg) | 1 | scan + validate + emit OpenCode files + manifest |
| `docker/opencode/agents/*.md` (+ compose mount, Dockerfile COPY, version pin) | 1 | container delivery (A dev / B prod) |
| `packages/core/src/modules/agent_orchestrator/ai-tools.ts` (edit) | 2/3 | add `submit_outcome` (2), `load_skill` (3) |
| `packages/core/src/modules/agent_orchestrator/lib/runtime/openCodeAgentRunner.ts` | 2 | the runner (DI-injected client) |
| `packages/core/src/modules/agent_orchestrator/lib/runtime/agentRuntime.ts` (edit) | 2 | dispatch on `entry.runtime` |
| `packages/ai-assistant/src/modules/ai_assistant/lib/opencode-client.ts` (edit) | 2 | `sendMessage` gains optional `agent` |
| `docker/opencode/skills/**`, agent-file `tools` allowlist gen | 3 | native skills |
| `docker/opencode/agents/*` subagent files + depth cap | 4 | sub-agents |
| `docker/opencode/tools/**`, skill scripts sandbox | 5 | tool files + scripts |

### Deviations from spec (explicit)

1. **MCP mutation-stripping**: spec §7.4/§7.8 say the MCP server strips
   `isMutation:true` for read-only agents. It does NOT (that is in-process only).
   Propose-only is instead enforced by the agent-file read-only `tools` allowlist
   + session-token ACL (C8). Intent preserved; mechanism corrected.
2. **OUTCOME schema language**: spec §14.1 says "JSON Schema compiled to a
   validator." We compile to **Zod** (no ajv/json-schema-validator prod dep) so
   the result schema is byte-identical to what `defineAgent` already feeds the
   runtime. `schemaRef` (Zod export) escape hatch is **deferred** (not v1).
3. **Container config path**: AGENTS.md Docker docs show `/root/.opencode/...`;
   the real image runs as user `opencode` with config at
   `/home/opencode/.config/opencode/` — target the latter. Use **plural**
   `agents/`/`skills/`/`tools/` dirs.
4. **Hot-reload**: spec §14.3-A implies "instant updates on regenerate." OpenCode
   does not guarantee hot-reload; treat as restart-required.
5. **Image version**: currently floating; MUST be pinned before the Phase-2 run
   bridge (finding §6).
6. **Registry wiring**: the spec mentions an
   `agent-orchestrator-files.generated.ts` the module loads "mirrors
   ai-agents.generated.ts." Concretized to a committed in-module
   `generated/file-agents.generated.ts` storing plain JSON-Schema (recompiled to
   Zod at load) so no package imports an app-generated file.

## Changelog
- 2026-06-22 — Phase 0 findings + locked implementation contract.
