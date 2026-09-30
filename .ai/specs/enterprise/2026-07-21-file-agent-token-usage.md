# File-Agent Token Usage

**Date:** 2026-07-21
**Module:** `agent_orchestrator` (enterprise) + `@open-mercato/shared`, `@open-mercato/cli`
**Status:** Implemented

## Goal

Give operators and authors visibility into the token cost of a file-defined
(OpenCode) agent's construction elements, so they can reason about prompt/context
budget. Count tokens for each element and surface the breakdown both in the
back-office Agent detail page and via a CLI command.

## Elements counted

Per file agent (`agents/<id>/`), counting the RAW bytes of each file:

- `AGENT.md`
- `OUTCOME.md`
- each **skill** (`skills/<sid>/`): `SKILL.md` + `TEMPLATE.md` + `examples/*.md` + `scripts/*` (per-skill subtotal with a subfile breakdown)
- each **tool** (`tools/*.ts` / `*.js`)
- each **sub-agent** (`sub-agents/<sid>/`): recursively (its own total, depth cap 1)

`SAMPLE.json` / `FACTS.json` are deliberately excluded — they are run
input/config, not part of the agent's construction/definition text.

The breakdown shape (`AgentTokenUsage`) exposes `total` (incl. sub-agents),
`self` (excl. sub-agents), `agent`, `outcome`, `skills[]`, `tools[]`,
`subAgents[]`.

## Tokenizer

Token counts are an **estimate**. The primary models are Claude, which has no
accurate offline tokenizer; we use the `o200k_base` BPE encoding (GPT-4o/5
family) via `gpt-tokenizer` as a model-agnostic proxy. The primitive
`countTokens(text)` lives in `@open-mercato/shared/lib/ai/token-count` (pure
infra, no domain knowledge). Every surface labels the number as an estimate.

## Architecture

- **Shared primitive** — `countTokens` + `TOKEN_ENCODING` in
  `@open-mercato/shared/lib/ai/token-count`. New prod dependency `gpt-tokenizer`.
- **Domain walker + types** — `lib/tokens/types.ts` (`AgentTokenUsage`) and
  `lib/tokens/computeAgentTokenUsage.ts` (`computeAgentTokenUsageFromDir(dir)`)
  in the `agent_orchestrator` module.
- **Bake at generate-time** — the CLI generator
  (`packages/cli/.../extensions/agent-files.ts`) mirrors the walker (it cannot
  import `@open-mercato/enterprise`) and bakes `tokenUsage` into each
  `FileAgentDescriptor` in `generated/file-agents.generated.ts`. This is
  production-safe: Docker images ship the manifest, not the agent source tree.
- **Registry + API** — `AgentRegistryEntry.tokenUsage` (mapped in
  `loadFileAgents`); `GET /api/agent_orchestrator/agents/[id]` returns
  `tokenUsage` (null for native agents).
- **UI** — a "Token usage" card on `/backend/agents/[id]`, shown only for
  `runtime === 'opencode'`. i18n keys `agent_orchestrator.agentDetail.tokens.*`
  (en/de/es/pl).
- **CLI** — `yarn mercato agent_orchestrator token-usage --dir <path> [--json]`
  (live from raw files) or `--agent <id>` (baked). `--json` for machine output.

### Generator ↔ runtime parity

The generator mirrors the enterprise walker rather than importing it (matching
how the generator already mirrors the AGENT.md/OUTCOME.md/SKILL.md parsers). A
parity test asserts the baked value equals the live walker for every example
agent, so drift fails CI.

## Integration / test coverage

- **Unit** — `packages/shared/src/lib/ai/__tests__/token-count.test.ts`:
  `countTokens` empties, monotonicity, encoding label.
- **Walker + parity** — `packages/enterprise/.../__tests__/agent-token-usage.test.ts`:
  self-consistency (`self`/`total`/per-skill sums) and baked-manifest ==
  live-walker for all four example agents (`deals.company_researcher`,
  `deals.health_check_file`, `deals.web_researcher`, `support.resolution_advisor`).
- **Generator** — existing `agent-files` / `output-snapshots` generator tests
  continue to pass with the additive `tokenUsage` field.
- **API path** — `GET /api/agent_orchestrator/agents/:id` gains an additive,
  nullable `tokenUsage` field (zod schema extended); existing consumers
  unaffected.
- **UI path** — `/backend/agents/:id` renders the card for file agents only;
  native agents (`tokenUsage: null`) are unchanged.
- **CLI** — smoke-verified `--dir`, `--agent`, `--json`.

## Backward compatibility

Additive only. `FileAgentDescriptor.tokenUsage` and
`AgentRegistryEntry.tokenUsage` are optional; the API field is nullable; native
agents and existing manifests without the field keep working (the UI card simply
does not render). No event ids, DI keys, ACL features, or route contracts
changed.
