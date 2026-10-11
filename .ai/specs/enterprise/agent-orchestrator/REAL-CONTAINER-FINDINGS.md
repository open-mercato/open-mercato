# Real-container validation findings (2026-06-22)

First end-to-end run of a file-defined agent against a **live OpenCode container +
standalone MCP server** (not the unit-test fake). Branch `feat/opencode-file-defined-agents`.
The fake-client tests passed but masked process-topology and OpenCode-contract issues.
Run path: a script called `agentRuntime.run('deals.health_check_file', …)`; OpenCode
loaded the agent + sub-agent + skills and executed; results below.

## Issues found (in discovery order)

### 1. ✅ FIXED-LOCALLY (needs to land in generator) — OpenCode MCP tool-id format
The generated agent-file `tools:` allowlist used the OM tool id `agent_orchestrator.submit_outcome`.
OpenCode names MCP tools **`<mcpServerKey>_<toolName with dots→underscores>`**, i.e.
`open-mercato_agent_orchestrator_submit_outcome`. Because the dotted key never matched, the
deny-by-default (`"*": false`) filtered the tool out → the agent's only tool was `task`
(`"Model tried to call unavailable tool 'invalid'. Available tools: task."`). After switching
the allowlist key + prompt to `open-mercato_agent_orchestrator_submit_outcome`, the agent
called it successfully. **Generator fix required**: map every declared OM tool id (and
submit_outcome / load_skill / run_skill_script) to `open-mercato_<id with dots→underscores>`
in both the `tools` allowlist and the prompt. Also add `run_skill_script`/`load_skill` to the
allowlist when the agent has local tools / skills (the example couldn't call its local tool either).

### 2. ✅ FIXED-LOCALLY (needs to land in runner) — send timeout cancels the run
`OpenCodeClient.sendMessage` uses `OPENCODE_SEND_MESSAGE_TIMEOUT_MS` (default **30s**).
`/session/:id/message` is synchronous (holds until the agent loop finishes); a multi-step run
(sub-agent + tools) exceeds 30s, the client aborts, and OpenCode **cancels** the prompt. The
runner relies on SSE for completion, so its send must use a long timeout. **Fix required**:
give the runner a long per-call send timeout (≈ the run deadline) — add a `timeoutMs` option to
`sendMessage` and have `OpenCodeAgentRunner` pass it (env `OPENCODE_SEND_MESSAGE_TIMEOUT_MS=240000`
worked as a stopgap).

### 3. ❌ BLOCKER (architectural) — run-correlation registry is in-process, but the runner and the MCP server are different processes
With the correct tool id AND the correct `_sessionToken`, `submit_outcome` still returned
`{ ok:false, code:'no_active_run' }`. Root cause: `lib/runtime/openCodeRunRegistry.ts` is an
**in-memory `Map`**. The runner registers the correlation in the process that runs
`agentRuntime.run` (the Next app / a workflow worker / a script); `submit_outcome` executes in
the **separate `mcp:serve-http` process** and looks up *its own* empty Map → never finds the run.
The fake-client tests passed only because both ran in one process.
**This makes the OpenCode path non-functional in any real deployment** (the MCP server is always
a separate service). `fileAgentSkills.ts` (skill/script content for `load_skill`/`run_skill_script`)
has the same cross-process problem.
**Fix required (design choice):** make the correlation + captured outcome a **shared store** both
processes reach — e.g. a small DB table keyed by the per-run session token
(`{ session_token, agent_id, outcome jsonb null, status }`), or stash it on the existing
`api_keys` session record. `submit_outcome` resolves the active agent + writes the validated
outcome there; the runner polls/reads it (instead of awaiting an in-memory deferred). This is the
"store the validated outcome in the run's session record" the Phase-0 contract envisioned — the
implementation used an in-memory Map instead. The phase-0 contract should be amended and the
runner/registry/tool reworked to the shared store.

### 4. ⚠️ OUTCOME shape/encoding adherence (would fail validation even after #3)
The model passed `outcome` as a **JSON string** (`"{ ... }"`), and shaped it as
`{ action: { type:'set_stage', stage }, confidence, rationale }` — but the OUTCOME schema expects
`{ actions: [{ type:'set_stage', payload:{ stage } }], confidence, rationale }` (array, payload-nested).
**Mitigations:** have `submit_outcome` accept a JSON-string `outcome` (parse before validating);
strengthen the prompt with the exact shape / a one-shot example; consider passing the JSON-Schema
to the agent. Validation staying strict is correct; the input handling + guidance should be friendlier.

## Net status
The pipeline is proven to the last inch: OpenCode loads the agent/sub-agent/skills, the agent
delegates to the sub-agent and calls `submit_outcome` with the right tool id + session token.

**Resolution (2026-06-22):**
- **#1 (tool-id) ✅** generated allowlist + prompt use `open-mercato_<id>`.
- **#2 (send timeout) ✅** `OpenCodeClient.sendMessage` gained `timeoutMs`; the runner passes its
  long run deadline so multi-step runs aren't cancelled at 30s.
- **#3 (cross-process correlation) ✅** replaced the in-memory `openCodeRunRegistry` with a
  DB-backed `agent_run_sessions` store (`lib/runtime/agentRunSessionStore.ts`, entity + migration).
  The runner `open`s a row and POLLS `readOutcome`; the MCP tools (in the separate `mcp:serve-http`
  process) resolve the active agent from the SAME store and `submit_outcome` writes the validated
  outcome there. Both processes build the store from their own container, same DB.
- **#4 (outcome shape) ✅** `submit_outcome` parses a JSON-string `outcome` before validating; the
  generator now INJECTS the OUTCOME JSON-Schema + prose into the agent prompt ("## Outcome
  contract"), so the agent sees the exact shape instead of guessing.

**Live re-verification still needed** (the unit tests use the in-memory store + a fake client):
run against the container after `yarn build:packages` (the standalone MCP server + the runner use
`dist`, NOT source — a stale `dist` was why a regenerate initially missed the prompt changes), then
`yarn db:migrate` (adds `agent_run_sessions`), restart `mcp:serve` + the opencode container, and
re-run an agent end-to-end to confirm the cross-process outcome handoff and proposal persistence.

## Local environment notes (for re-testing)
- MCP server key (`open-mercato`) defines the MCP tool prefix.
- `mcp:serve` validates `x-api-key` against the `api_keys` DB table (provision via
  `mercato api_keys add --name … --tenantId …`); it is NOT an env-only key. Put the provisioned
  secret in `apps/mercato/.env` (server) and the env Compose reads (container header).
- OpenCode's anthropic registry has `claude-sonnet-4-5`, not `claude-sonnet-4-6` / `claude-opus-4-8`
  — file-agent `model:` must be an id OpenCode's provider knows.
- After `yarn generate`, restart OpenCode (`docker compose up -d --force-recreate opencode`).
