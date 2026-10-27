# Files & Token-calculator tabs for file-defined (opencode) agents

- Status: implemented
- Scope: enterprise `agent_orchestrator`
- Date: 2026-07-26
- Verified live: file-defined agent shows Files + Token calculator (no Configuration); native agent shows Configuration only; files endpoint 404s for native; Token calculator returns real o200k_base counts.

## Problem

For a **file-defined (opencode) agent** the agent's behaviour lives entirely in its
on-disk definition files (`AGENT.md`, `OUTCOME.md`, skills, tools, sub-agents). Today
the Agent detail page shows a derived **Configuration** tab and a read-only per-file
token *breakdown card*, but there is no way to actually **read the files**, and no way
to **estimate token cost** of arbitrary text with the same tokenizer the platform uses.

## Decisions (confirmed with user)

1. For opencode agents, the **Files** tab **replaces** the Configuration tab entirely;
   its "Definition overview" strip carries runtime/model/tools/skills/sub-agents. Native
   agents are unchanged (keep Configuration; no Files/Token tabs).
2. File **content is baked into the generated registry** at `yarn generate` time (the
   same walk that already counts tokens), so the runtime never reads agent dirs from
   disk — mirrors how `tokenUsage` already works and survives `clean-generated`.

## Architecture

**The runtime has no agent-id → on-disk-dir mapping** (deliberate). File content must be
baked. New pieces:

### Backend

- `lib/tokens/types.ts` — new `FileAgentFile = { path, content, tokens, inContext }`.
- Generator `packages/cli/src/lib/generators/extensions/agent-files.ts`:
  - `collectAgentFiles(dir, prefix, depth)` — walks every construction file (AGENT.md,
    OUTCOME.md, SAMPLE.json/FACTS.json, `skills/**`, `tools/**`, recursing
    `sub-agents/<id>/**` with a `sub-agents/<id>/` prefix, depth cap 1) → raw content +
    `o200k_base` token count via shared `countTokens`; `inContext=false` for
    SAMPLE.json/FACTS.json (not part of the prompt), `true` otherwise.
  - Bake `sourceFiles: FileAgentFile[]` onto every `FileAgentDescriptor`.
- `lib/sdk/defineAgent.ts` — carry `sourceFiles` onto `AgentRegistryEntry`
  (name chosen to avoid the pre-existing `files?: FileAgentFilesConfig` field).
- `GET api/agents/[id]/files` — opencode only; returns `{ sourceFiles, tokenUsage }`.
  404 for native agents / agents without baked files. Gate `agent_orchestrator.agents.view`.
- `POST api/tokens/estimate` — `{ text }` → `{ tokens, encoding: 'o200k_base' }` via the
  shared `countTokens`. Gate `agent_orchestrator.agents.view`; text length capped.

### Frontend (`backend/agents/[id]/`)

- `page.tsx` — tab set is runtime-derived: opencode → Overview / Activity / Evaluation /
  **Files** / **Token calculator**; native → Overview / Activity / Evaluation /
  Configuration. `?tab=` validation follows the active set.
- `components/FilesTab.tsx` — Definition overview strip (from the already-fetched
  `AgentDetailView`: runtime/provider/model/maxSteps/resultKind/tools/skills/subAgents +
  `tokenUsage.total`) + a GitHub-style tree/reader over `GET …/files` (per-file token
  count, Markdown Preview/Raw, code with line numbers, read-only). Lazy fetch on open.
- `components/TokenCalculatorTab.tsx` — paste or **Open file…** (FileReader) → debounced
  `POST …/tokens/estimate` → tokens + characters/words/lines/UTF-8 bytes.
- `components/filesTree.ts` — shared tree-building + markdown-lite helpers.

## Integration coverage

- API: `GET /api/agent_orchestrator/agents/[id]/files` (opencode 200 shape; native 404;
  401 unauth). `POST /api/agent_orchestrator/tokens/estimate` (known-text token parity
  with `countTokens`; 401 unauth; oversize 413/400).
- Generator: `collectAgentFiles` on the example `company_researcher` dir returns AGENT.md
  + OUTCOME.md + skill + sub-agent files with content, and the sum of `inContext` tokens
  equals `discoverAgentTokenUsage(dir).total` (consistency with the baked estimate).
- UI: opencode agent shows Files + Token calculator and NOT Configuration; native shows
  Configuration and neither new tab; Files tab lists this agent's files, reads one, and
  the calculator counts pasted text.

## Backward compatibility

- Additive only: `FileAgentFile` type, `sourceFiles` field (optional), two new routes,
  runtime-gated tabs. No contract removed. The generated manifest grows (raw file bytes)
  but stays pure data. `tokenUsage` and the existing detail route are untouched.
