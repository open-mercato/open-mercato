# SPEC — AI Overrides & Module-Level Disable

**Status:** in progress
**Owner:** ai-assistant package
**Date:** 2026-04-30

## Problem

Today the AI agent registry and the AI tool registry are append-only. A downstream module (e.g. an app-level `@app` module, or a third-party package shipped on top of `@open-mercato/core`) cannot:

1. Replace an agent that was contributed by another module — for example, swap `catalog.merchandising_assistant` with a tenant-specific variant that uses a different prompt or whitelists different tools.
2. Replace a tool registered by another module — for example, replace `customers.update_deal_stage` with a wrapper that adds a side-effect.
3. Disable a default agent or tool entirely — for example, hide `catalog.catalog_assistant` for a tenant that wants its operators to use a single, focused merchandising agent.

The runtime even **detects** double registrations and either throws (agents) or warns and overwrites with last-writer-wins (tools). Both behaviours are wrong as a public API surface — neither one gives a downstream module a deterministic, declarative way to express "I want to override this".

## Goals

- **Deterministic override** of any registered AI agent or AI tool by a downstream module.
- **Disable** a registered agent or tool entirely by passing `null`.
- **Module load order** controls precedence — the last module to load an override wins.
- **Programmatic API** for app-level overrides that don't fit a per-module file (e.g. dynamic overrides driven by tenant config).
- **No new generated-file contract**. The existing `ai-agents.generated.ts` and `ai-tools.generated.ts` shapes stay frozen; we add a sibling file `ai-overrides.generated.ts`.
- **Backward compatible** — existing modules without an `ai-overrides.ts` file see no change.

## Non-goals

- Cross-tenant policy overrides — those already exist via `ai_agent_prompt_overrides` and `ai_agent_mutation_policy_overrides` and address a different need (per-tenant prompt + policy without a redeploy).
- Overriding individual tool methods or the runtime itself. The override surface only replaces the final `AiAgentDefinition` / `AiToolDefinition` records.
- Overriding `loadBeforeRecord(s)` or other tool fields piecemeal. An override always replaces the whole definition or removes it.

## API

### Per-module file (`<module>/ai-overrides.ts`)

A new optional file that the generator picks up. Exports a single `aiOverrides` object:

```ts
// src/modules/<module>/ai-overrides.ts
import type { AiAgentOverrides } from '@open-mercato/ai-assistant'

export const aiOverrides: AiAgentOverrides = {
  agents: {
    // Replace the catalog merchandising assistant with a custom version
    'catalog.merchandising_assistant': customMerchandisingAgent,
    // Disable the default catalog explorer entirely
    'catalog.catalog_assistant': null,
  },
  tools: {
    // Wrap a tool with extra side-effects
    'customers.update_deal_stage': customUpdateDealStage,
    // Disable a tool the module no longer exposes
    'inbox_ops_accept_action': null,
  },
}

export default aiOverrides
```

The override file MUST live at the **module root** alongside `ai-agents.ts` and `ai-tools.ts`. Sub-files are not auto-discovered.

### Programmatic API

```ts
import {
  applyAiAgentOverrides,
  applyAiToolOverrides,
  type AiAgentOverrides,
} from '@open-mercato/ai-assistant'

// At bootstrap, after the registries have loaded:
applyAiAgentOverrides({
  'catalog.catalog_assistant': null,
})

applyAiToolOverrides({
  'inbox_ops_accept_action': null,
})
```

Useful for:
- Tenant-aware overrides driven by env vars or runtime config.
- Test scaffolds that need to swap an agent for the duration of a test.
- App-level `bootstrap.ts` hooks that want to disable defaults without authoring a fake module.

## Resolution

1. The generator collects every module's `ai-overrides.ts` into a new sibling file `apps/<app>/.mercato/generated/ai-overrides.generated.ts`. Entries preserve module load order (the order returned by the existing module-discovery pass).
2. At first agent/tool registry access:
   - The base registries load from `ai-agents.generated.ts` / `ai-tools.generated.ts` as today.
   - **Then** the override entries are applied in module load order. Each entry replaces or removes the named id.
3. Programmatic overrides via `applyAiAgentOverrides` / `applyAiToolOverrides` apply on top of the file-based resolution and have **higher precedence**.

This keeps the resolution stable: file overrides describe the static contract, programmatic overrides describe runtime decisions.

## Backward compatibility

- Existing `ai-agents.ts` / `ai-tools.ts` files continue to register the way they always have.
- The duplicate-id check in `agent-registry.ts` stays the same — modules MUST register an agent under a unique id; overrides are the only mechanism to "double-register" intentionally.
- Modules that ship `ai-overrides.ts` MUST keep using the new convention rather than tampering with another module's source.

## File layout (new and unchanged)

```
packages/<pkg>/src/modules/<module>/         (or apps/<app>/src/modules/<module>/)
├── ai-agents.ts                      # unchanged
├── ai-tools.ts                       # unchanged
├── ai-overrides.ts                   # NEW (optional)
└── ...
```

## Implementation surface

| File | Change |
|------|--------|
| `packages/ai-assistant/src/modules/ai_assistant/lib/types.ts` | Add `AiAgentOverrides` and `AiToolOverrides` types |
| `packages/ai-assistant/src/modules/ai_assistant/lib/ai-overrides.ts` | New file — collect / apply override pipelines |
| `packages/ai-assistant/src/modules/ai_assistant/lib/agent-registry.ts` | Apply agent overrides after base load |
| `packages/ai-assistant/src/modules/ai_assistant/lib/tool-loader.ts` | Apply tool overrides after base load |
| `packages/ai-assistant/src/index.ts` | Export `applyAiAgentOverrides`, `applyAiToolOverrides`, the types |
| `packages/cli/src/lib/generators/extensions/ai-overrides.ts` | New CLI extension emitting `ai-overrides.generated.ts` |
| `packages/cli/src/lib/generators/extensions/index.ts` | Register the new extension |
| `apps/docs/docs/framework/ai-assistant/agents.mdx` | "Overrides" section |
| `apps/docs/docs/framework/ai-assistant/developer-guide.mdx` | "Override another module's agent / tool" step |
| `packages/ai-assistant/AGENTS.md` | "How to Override AI Agents and Tools" section |
| `packages/create-app/template/AGENTS.md` | Pointer + standalone-specific notes |
| `.ai/skills/create-ai-agent/SKILL.md` | Step on overriding existing agents |

## Test surface

`packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/ai-overrides.test.ts`:

- Replace an existing agent — registry returns the new definition.
- Disable an agent with `null` — registry no longer lists it.
- Disable a tool with `null` — `toolRegistry.getTool` returns undefined; `agent-tools` skips it.
- Programmatic `applyAiAgentOverrides({})` is idempotent.
- File-then-programmatic — programmatic wins.
- Override an id that does not exist — log a warning, don't throw.
- Override array preserves module load order.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Modules silently override each other and the operator can't tell who won | The runtime logs a structured `[AI Overrides]` line for every applied override. The agent settings UI surfaces "Overridden by `<moduleId>`" in a follow-up doc PR. |
| Infinite recursion if a module overrides its own agent | Reject self-overrides (warn + skip). The override convention is only meaningful for cross-module replacement. |
| Disabled agent/tool referenced in another agent's `allowedTools` | The existing `checkAgentPolicy` already drops missing tools with a console warn — no extra work needed. |
| Standalone apps miss the override file because the package was rebuilt without it | The generator already scans `dist/modules/<module>/` for compiled JS in standalone apps; the new convention reuses the same scanner. |
