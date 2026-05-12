# SPEC — AI Overrides & Module-Level Disable

**Status:** in progress
**Owner:** ai-assistant package
**Date:** 2026-04-30
**Last revised:** 2026-05-04

## Problem

Today the AI agent registry and the AI tool registry are append-only. A downstream module (e.g. an app-level `@app` module, or a third-party package shipped on top of `@open-mercato/core`) cannot:

1. Replace an agent that was contributed by another module — for example, swap `catalog.merchandising_assistant` with a tenant-specific variant that uses a different prompt or whitelists different tools.
2. Replace a tool registered by another module — for example, replace `customers.update_deal_stage` with a wrapper that adds a side-effect.
3. Disable a default agent or tool entirely — for example, hide `catalog.catalog_assistant` for a tenant that wants its operators to use a single, focused merchandising agent.

The runtime even **detects** double registrations and either throws (agents) or warns and overwrites with last-writer-wins (tools). Both behaviours are wrong as a public API surface — neither one gives a downstream module a deterministic, declarative way to express "I want to override this".

## Goals

- **Deterministic override** of any registered AI agent or AI tool by a downstream module.
- **Disable** a registered agent or tool entirely by passing `null`.
- **Module load order** controls precedence within the file-based tier — the last module to declare an override wins.
- **`modules.ts` inline** overrides for app-level decisions that don't deserve a dedicated module.
- **Programmatic API** for boot-time overrides driven by env or runtime config (and for test scaffolds).
- **No new generated-file contract**. The existing `ai-agents.generated.ts` / `ai-tools.generated.ts` shapes stay frozen for their base exports; we add sibling exports (`aiAgentOverrideEntries`, `aiToolOverrideEntries`) to those same files.
- **Backward compatible** — existing modules without override exports see no change.

## Non-goals

- Cross-tenant policy overrides — those already exist via `ai_agent_prompt_overrides` and `ai_agent_mutation_policy_overrides` and address a different need (per-tenant prompt + policy without a redeploy).
- Overriding individual tool methods or the runtime itself. The override surface only replaces the final `AiAgentDefinition` / `AiToolDefinition` records.
- Overriding `loadBeforeRecord(s)` or other tool fields piecemeal. An override always replaces the whole definition or removes it.

## API

There are three override surfaces, ordered by precedence (highest first):

### 1. Programmatic API

```ts
import {
  applyAiAgentOverrides,
  applyAiToolOverrides,
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

### 2. `modules.ts` inline

`apps/<app>/src/modules.ts` already lists every enabled module. Each `ModuleEntry` may declare `aiAgentOverrides` / `aiToolOverrides` directly:

```ts
import type {
  AiAgentOverridesMap,
  AiToolOverridesMap,
} from '@open-mercato/ai-assistant'

export type ModuleEntry = {
  id: string
  from?: '@open-mercato/core' | '@app' | string
  aiAgentOverrides?: AiAgentOverridesMap
  aiToolOverrides?: AiToolOverridesMap
}

export const enabledModules: ModuleEntry[] = [
  { id: 'catalog', from: '@open-mercato/core' },
  {
    id: 'example',
    from: '@app',
    aiAgentOverrides: { 'catalog.catalog_assistant': null },
    aiToolOverrides: { 'inbox_ops_accept_action': null },
  },
]
```

The app's `src/bootstrap.ts` calls `applyAiOverridesFromEnabledModules(enabledModules)` once at boot. `apps/mercato/src/bootstrap.ts` and the `create-mercato-app` template ship that wiring out of the box.

### 3. Per-module file (`<module>/ai-agents.ts` / `<module>/ai-tools.ts`)

Modules contribute overrides through additional exports on their existing `ai-agents.ts` / `ai-tools.ts` files. There is **no separate `<module>/ai-overrides.ts` file** — co-locating the override declaration with the same module's base contributions keeps related code together and avoids file proliferation.

```ts
// src/modules/<module>/ai-agents.ts
import type {
  AiAgentDefinition,
  AiAgentOverridesMap,
} from '@open-mercato/ai-assistant'
import customMerchandising from './agents/my-merchandising-agent'

export const aiAgents: AiAgentDefinition[] = [
  // ...your module's own agents
]

export const aiAgentOverrides: AiAgentOverridesMap = {
  'catalog.merchandising_assistant': customMerchandising,
  'catalog.catalog_assistant': null,
}
```

```ts
// src/modules/<module>/ai-tools.ts
import { defineAiTool, type AiToolOverridesMap } from '@open-mercato/ai-assistant'
import wrappedUpdateDealStage from './tools/wrapped-update-deal-stage'

export const aiTools = [
  // ...your module's own tools
]

export const aiToolOverrides: AiToolOverridesMap = {
  'customers.update_deal_stage': wrappedUpdateDealStage,
  'inbox_ops_accept_action': null,
}
```

The override exports MUST live in the module-root `ai-agents.ts` / `ai-tools.ts` files. Sub-files are not auto-discovered.

## Resolution

1. The generator collects every module's `ai-agents.ts` and `ai-tools.ts` files. It emits the base entries (`aiAgentConfigEntries` / `aiToolConfigEntries`) and the override entries (`aiAgentOverrideEntries` / `aiToolOverrideEntries`) into the **same** generated files, preserving module load order.
2. At first agent / tool registry access:
   - The base registries load from `ai-agents.generated.ts` / `ai-tools.generated.ts` as today.
   - **Then** the override entries are applied in module load order, followed by `modules.ts` overrides (registered via `applyAiOverridesFromEnabledModules` at boot), followed by programmatic overrides.
3. `applyAiAgentOverrides` / `applyAiToolOverrides` always wins — last call per id wins inside the programmatic tier.

This keeps the resolution stable: file overrides describe the static contract, `modules.ts` overrides describe per-app static decisions, programmatic overrides describe runtime decisions.

## Backward compatibility

- Existing `ai-agents.ts` / `ai-tools.ts` files continue to register the way they always have.
- The duplicate-id check in `agent-registry.ts` stays the same — modules MUST register an agent under a unique id; overrides are the only mechanism to "double-register" intentionally.
- The base generated exports (`allAiAgents`, `aiAgentConfigEntries`, `aiToolConfigEntries`) keep their FROZEN shape. The new `aiAgentOverrideEntries` / `aiToolOverrideEntries` are additive.
- The `ModuleEntry` shape on `apps/<app>/src/modules.ts` gains optional `aiAgentOverrides` / `aiToolOverrides` fields. Existing modules.ts files without those fields work unchanged.
- Modules that ship overrides MUST do so through the new convention rather than tampering with another module's source.

## File layout (new and unchanged)

```
packages/<pkg>/src/modules/<module>/         (or apps/<app>/src/modules/<module>/)
├── ai-agents.ts                      # exports: aiAgents (+ optional aiAgentOverrides)
├── ai-tools.ts                       # exports: aiTools  (+ optional aiToolOverrides)
└── ...
```

```
apps/<app>/src/
├── modules.ts                        # enabledModules entries may carry aiAgentOverrides / aiToolOverrides
└── bootstrap.ts                      # imports enabledModules and calls applyAiOverridesFromEnabledModules
```

## Implementation surface

| File | Change |
|------|--------|
| `packages/ai-assistant/src/modules/ai_assistant/lib/ai-overrides.ts` | Helper module — three-tier compose pipeline (file → modules.ts → programmatic), `applyAiOverridesFromEnabledModules` |
| `packages/ai-assistant/src/modules/ai_assistant/lib/agent-registry.ts` | Read `aiAgentOverrideEntries` from `ai-agents.generated.ts` and apply after base load |
| `packages/ai-assistant/src/modules/ai_assistant/lib/tool-loader.ts` | Read `aiToolOverrideEntries` from `ai-tools.generated.ts` and apply after base load |
| `packages/ai-assistant/src/index.ts` | Export `applyAiAgentOverrides`, `applyAiToolOverrides`, `applyAiOverridesFromEnabledModules`, the types |
| `packages/cli/src/lib/generators/extensions/ai-agents.ts` | Emit `aiAgentOverrideEntries` from the same `ai-agents.ts` scan |
| `packages/cli/src/lib/generators/extensions/ai-tools.ts` | Emit `aiToolOverrideEntries` from the same `ai-tools.ts` scan |
| `packages/cli/src/lib/generators/extensions/index.ts` | Stop registering the standalone `createAiOverridesExtension` (deleted) |
| `apps/mercato/src/modules.ts` | `ModuleEntry` carries optional `aiAgentOverrides` / `aiToolOverrides` |
| `apps/mercato/src/bootstrap.ts` | Calls `applyAiOverridesFromEnabledModules(enabledModules)` |
| `packages/create-app/template/src/modules.ts` | Same `ModuleEntry` shape |
| `packages/create-app/template/src/bootstrap.ts` | Same boot wiring |
| `apps/docs/docs/framework/ai-assistant/overrides.mdx` | Three-tier docs |
| `packages/ai-assistant/AGENTS.md` | "How to Override Another Module's Agent or Tool" updated |
| `packages/create-app/template/AGENTS.md` | Pointer + standalone-specific notes updated |
| `AGENTS.md` (root) | Task Router row updated |
| `.ai/skills/create-ai-agent/SKILL.md` | Step on overriding existing agents updated |

## Test surface

`packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/ai-overrides.test.ts`:

- Replace an existing agent — registry returns the new definition.
- Disable an agent with `null` — registry no longer lists it.
- Disable a tool with `null` — `toolRegistry.getTool` returns undefined; `agent-tools` skips it.
- Programmatic `applyAiAgentOverrides({})` is idempotent.
- File → modules.ts → programmatic precedence: each tier supersedes the one below it.
- Override an id that does not exist — log a warning, don't throw.
- Override array preserves module load order inside the file tier.
- `applyAiOverridesFromEnabledModules` accumulates across multiple calls (last wins per id).

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Modules silently override each other and the operator can't tell who won | The runtime logs a structured `[AI Overrides]` line for every applied override. The agent settings UI can surface "Overridden by `<moduleId>`" in a follow-up doc PR. |
| Infinite recursion if a module overrides its own agent | The convention is for **cross-module** replacement; the override pipeline simply replaces the entry in place, so a self-override is a no-op idempotent update rather than a recursion hazard. |
| Disabled agent/tool referenced in another agent's `allowedTools` | The existing `checkAgentPolicy` already drops missing tools with a console warn — no extra work needed. |
| Standalone apps miss the override exports because the package was rebuilt without them | The generator already scans `dist/modules/<module>/` for compiled JS in standalone apps; the consolidated exports go through the same scanner. |
| Three tiers feel surprising to readers | The runtime emits the structured `[AI Overrides]` log so an operator can confirm which tier applied. The docs lead with the resolution-order list before each path. |

## Changelog

- **2026-04-30 — initial draft.** Per-module `<module>/ai-overrides.ts` file + programmatic API.
- **2026-05-04 — consolidation + `modules.ts` tier.** Dropped the standalone `<module>/ai-overrides.ts` convention in favour of additional `aiAgentOverrides` / `aiToolOverrides` exports on the existing `ai-agents.ts` / `ai-tools.ts` files. Added the `modules.ts`-inline tier (`aiAgentOverrides` / `aiToolOverrides` fields on `ModuleEntry`) wired through `applyAiOverridesFromEnabledModules` from `bootstrap.ts`. Resolution order is now programmatic → modules.ts → file-based → base. The previous spec text described an unreleased convention; no shipped code carried it, so no migration shim was added.
- **2026-05-04 — folded into the unified `entry.overrides` umbrella.** The `modules.ts`-inline tier moved from top-level `aiAgentOverrides` / `aiToolOverrides` keys to `overrides.ai.agents` / `overrides.ai.tools` per the new umbrella spec [`2026-05-04-modules-ts-unified-overrides.md`](2026-05-04-modules-ts-unified-overrides.md). The AI domain remains the only wired domain in Phase 1; other domains follow per the umbrella tracking issue. The file-based and programmatic tiers are unchanged. Apps now call `applyModuleOverridesFromEnabledModules` from `@open-mercato/shared/modules/overrides` once at boot — that dispatches to the AI applier registered automatically by `@open-mercato/ai-assistant`.
