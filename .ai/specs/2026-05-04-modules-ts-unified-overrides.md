# SPEC — Unified `modules.ts` Overrides

**Status:** in progress (Phase 1 wired, Phases 2–18 stubbed)
**Owner:** core / shared / ai-assistant
**Date:** 2026-05-04
**Tracking issue:** [open-mercato/open-mercato#1787](https://github.com/open-mercato/open-mercato/issues/1787)

## Problem

Open Mercato modules contribute many independent kinds of artifacts: API routes, backend pages, event subscribers, workers, widget injections, notification types, interceptors, enrichers, command interceptors, page guards, CLI commands, setup hooks, ACL features, DI bindings, encryption maps, AI agents, AI tools.

Most of these registries are append-only by design. When a downstream app (one that consumes `@open-mercato/core` and friends from npm) wants to **disable** or **replace** something a module registered, today it has to either:

1. Maintain a fork of the upstream module's source — fragile and survives reinstall.
2. Author a fake `@app` module just to ship a single override file (e.g. AI overrides).
3. Reach into private runtime state at boot.

The AI subsystem already has a per-app override path (`entry.aiAgentOverrides` / `entry.aiToolOverrides` on a `ModuleEntry` in `apps/<app>/src/modules.ts`, see spec [`2026-04-30-ai-overrides-and-module-disable.md`](2026-04-30-ai-overrides-and-module-disable.md)). This spec generalises that idea so **every contract a module presents** can be overridden through a single, consistent `entry.overrides` key.

## Goals

- **One canonical override surface per app** — `entry.overrides` on `ModuleEntry` in `apps/<app>/src/modules.ts`.
- **Domain-namespaced** — `overrides.ai`, `overrides.routes`, `overrides.events`, etc. — each domain owns its sub-shape; the umbrella schema is the union of those.
- **Same disable/replace semantics across domains** — `null` disables, a definition replaces, by stable id.
- **Single boot-time call** — `applyModuleOverridesFromEnabledModules(enabledModules)` walks the array once and dispatches to per-domain runtime hooks.
- **Phased rollout** — define the contract for every domain in this spec, but only wire the domains where there is real demand. Stubs throw a clear "not yet wired" error if used so an early adopter notices instead of silently no-opping.
- **Backward compatible** — no existing module behaviour changes when no override is declared.

## Non-goals

- Replacing **per-tenant** runtime overrides (those live in DB-backed tables — `ai_agent_prompt_overrides`, `ai_agent_mutation_policy_overrides`, etc.).
- A graphical UI for editing overrides — `modules.ts` is a code surface.
- Cross-module data migrations triggered by an override (e.g. removing an ACL feature does NOT auto-revoke it from existing role grants — that is a separate operator workflow).
- Override surfaces for app-private modules under `@app` — those modules can edit themselves directly.

## API

### Umbrella shape

```ts
// packages/shared/src/modules/overrides.ts
import type {
  AiAgentOverridesMap,
  AiToolOverridesMap,
} from '@open-mercato/ai-assistant'

export interface ModuleOverrides {
  ai?: {
    agents?: AiAgentOverridesMap
    tools?: AiToolOverridesMap
  }
  routes?: {
    api?: Record<string, ApiRouteOverride>     // key: 'METHOD /api/path'
    pages?: Record<string, PageRouteOverride>  // key: '/backend/path' or '/frontend/path'
  }
  events?: {
    subscribers?: Record<string, SubscriberOverride>  // key: subscriber id
  }
  workers?: Record<string, WorkerOverride>            // key: worker id
  widgets?: {
    injection?: Record<string, InjectionWidgetOverride>   // key: widget id
    components?: Record<string, ComponentOverrideOverride> // key: component handle
    dashboard?: Record<string, DashboardWidgetOverride>    // key: widget id
  }
  notifications?: {
    types?: Record<string, NotificationTypeOverride>     // key: type id
    handlers?: Record<string, NotificationHandlerOverride> // key: handler id
  }
  interceptors?: Record<string, InterceptorOverride>          // key: interceptor id
  commandInterceptors?: Record<string, CommandInterceptorOverride>
  enrichers?: Record<string, EnricherOverride>
  guards?: Record<string, GuardOverride>                       // key: page handle
  cli?: Record<string, CliCommandOverride>                     // key: 'module command'
  setup?: {
    defaultRoleFeatures?: Record<string, readonly string[]>    // role -> feature list (replaces)
    seedDefaults?: false                                        // skip the hook
    seedExamples?: false                                        // skip the hook
    onTenantCreated?: false                                     // skip the hook
  }
  acl?: {
    features?: Record<string, AclFeatureOverride>              // key: feature id
  }
  di?: Record<string, DiBindingOverride>                       // key: container key
  encryption?: {
    maps?: Record<string, EncryptionMapOverride>               // key: entity id
  }
}

// Each {Domain}Override is `<DomainDefinition> | null` (null = disable, def = replace).
```

### Module entry

```ts
// apps/<app>/src/modules.ts
import type { ModuleOverrides } from '@open-mercato/shared/modules/overrides'

export type ModuleEntry = {
  id: string
  from?: '@open-mercato/core' | '@app' | string
  overrides?: ModuleOverrides
}
```

### Boot-time dispatcher

```ts
// apps/<app>/src/bootstrap.ts
import { enabledModules } from '@/modules'
import { applyModuleOverridesFromEnabledModules } from '@open-mercato/shared/modules/overrides'

applyModuleOverridesFromEnabledModules(enabledModules)
```

The dispatcher composes the per-domain override maps in module-load order, then forwards each domain's resolved map to the domain-specific runtime hook.

### Resolution order

For every domain, the resolution order is identical to the AI domain (highest precedence first):

1. **Programmatic** — direct calls into the per-domain `apply*Overrides()` API (last call per id wins).
2. **`modules.ts` inline** — `entry.overrides.<domain>` on a `ModuleEntry` (last entry per id wins).
3. **File-based** — overrides exported from a contributing module's own files (where supported).
4. **Base** — the module's own registrations.

`null` cascades through every tier — a higher tier can resurrect by mapping back to a definition.

## Phased rollout

Each phase is a focused PR that:
1. Defines the per-domain runtime override hook.
2. Implements the domain's resolution composer.
3. Adds tests covering disable + replace + precedence.
4. Updates the corresponding module-domain AGENTS.md (e.g. `packages/events/AGENTS.md`).
5. Marks the domain "wired" in this spec's status table.

| # | Phase | Domain | Stable ids | Wired? |
|---|-------|--------|------------|--------|
| 1 | AI overrides | `ai.agents`, `ai.tools` | agent id / tool name | **YES (this branch)** |
| 2 | Routes — API | `routes.api` | `'METHOD /api/path'` | NO |
| 3 | Routes — Pages | `routes.pages` | `'/backend/...'` / `'/frontend/...'` | NO |
| 4 | Events — Subscribers | `events.subscribers` | subscriber id | NO |
| 5 | Workers | `workers` | worker id (`<module>:<id>`) | NO |
| 6 | Widget injection | `widgets.injection` | injection widget id | NO |
| 7 | Component overrides | `widgets.components` | component handle | NO |
| 8 | Dashboard widgets | `widgets.dashboard` | widget id | NO |
| 9 | Notifications — Types & Handlers | `notifications.*` | type id / handler id | NO |
| 10 | Interceptors (CRUD + custom) | `interceptors` | interceptor id | NO |
| 11 | Command interceptors | `commandInterceptors` | interceptor id | NO |
| 12 | Response enrichers | `enrichers` | enricher id | NO |
| 13 | Page guards | `guards` | page handle | NO |
| 14 | CLI commands | `cli` | `'<module> <command>'` | NO |
| 15 | Setup hooks | `setup` | `defaultRoleFeatures` / `seedDefaults` / `seedExamples` / `onTenantCreated` | NO |
| 16 | ACL features | `acl.features` | feature id | NO |
| 17 | DI bindings | `di` | container key | NO |
| 18 | Encryption maps | `encryption.maps` | entity id | NO |

Phase 1 is the AI domain (already shipped via spec [`2026-04-30-ai-overrides-and-module-disable.md`](2026-04-30-ai-overrides-and-module-disable.md), now folded under the unified umbrella through one rename — see "Migration & BC" below).

Phases 2–18 ship as separate PRs against the GitHub tracking issue. Until a phase ships, the dispatcher emits a single structured warning the first time it sees a `modules.ts` override targeting that domain:

```
[Module Overrides] Domain "<domain>" not yet wired — entry.overrides.<domain> for module "<id>" was ignored. Track at <issue-url>.
```

The runtime never throws on unwired domains — that would block app boot during the rollout window. After Phase N ships, the warning for that domain is removed in the same PR that adds the wiring.

## Migration & backward compatibility

### From the AI-only shape (PR #1593, this branch)

The earlier shape:

```ts
{ id: 'example', from: '@app',
  aiAgentOverrides: {...},
  aiToolOverrides:  {...} }
```

becomes:

```ts
{ id: 'example', from: '@app',
  overrides: {
    ai: { agents: {...}, tools: {...} }
  }
}
```

Because the AI override surface only landed on this branch (`feat/ai-framework-unification`) and has not yet shipped on `develop`, we **do not** keep the legacy `aiAgentOverrides` / `aiToolOverrides` keys as a deprecated alias. The migration is a single, mechanical key rename inside the same branch.

`applyAiOverridesFromEnabledModules` keeps its public signature (it still walks `enabledModules` and applies AI overrides to the AI-tier registry) but internally it now reads `entry.overrides?.ai` instead of `entry.aiAgentOverrides` / `entry.aiToolOverrides`. The shared dispatcher delegates to it.

### For Phases 2–18

Every phase is purely additive. Modules without `entry.overrides` are unaffected. Existing programmatic and file-based override paths (where they exist today, e.g. `applyAiAgentOverrides`) keep working untouched.

## Implementation surface (Phase 1 of this spec)

| File | Change |
|------|--------|
| `packages/shared/src/modules/overrides.ts` | NEW — umbrella `ModuleOverrides` type, `applyModuleOverridesFromEnabledModules` dispatcher, per-domain stubs |
| `packages/shared/src/modules/index.ts` | Re-export `ModuleOverrides`, `applyModuleOverridesFromEnabledModules` |
| `packages/ai-assistant/src/modules/ai_assistant/lib/ai-overrides.ts` | `applyAiOverridesFromEnabledModules` reads `entry.overrides?.ai` |
| `packages/ai-assistant/src/index.ts` | Export the helper unchanged (signature stable) |
| `apps/mercato/src/modules.ts` | `ModuleEntry` carries `overrides?: ModuleOverrides` (drop `aiAgentOverrides` / `aiToolOverrides`) |
| `apps/mercato/src/bootstrap.ts` | Switch from `applyAiOverridesFromEnabledModules` to `applyModuleOverridesFromEnabledModules` |
| `packages/create-app/template/src/modules.ts` | Same shape rename |
| `packages/create-app/template/src/bootstrap.ts` | Same dispatcher rename |
| `apps/docs/docs/framework/ai-assistant/overrides.mdx` | Update Path B to use `overrides.ai.agents` / `overrides.ai.tools` |
| `apps/docs/docs/framework/modules/overrides.mdx` | NEW — umbrella docs page; lists every domain with current wiring status |
| `packages/ai-assistant/AGENTS.md` | Update Path B example |
| `packages/create-app/template/AGENTS.md` | Update Path B example |
| `AGENTS.md` (root) | Update Task Router row + add umbrella row |
| `.ai/skills/create-ai-agent/SKILL.md` | Update Path B example |
| `.ai/specs/2026-04-30-ai-overrides-and-module-disable.md` | Add migration changelog entry pointing here |

## Test surface (Phase 1)

`packages/shared/src/modules/__tests__/overrides.test.ts`:

- Dispatcher walks `enabledModules` and calls into the AI tier with the resolved map.
- An entry without `overrides` is a no-op.
- An entry with `overrides.routes` (an unwired domain) emits the structured warning exactly once per domain per process.
- Multiple entries with the same domain accumulate (last entry per id wins).
- The legacy `aiAgentOverrides` / `aiToolOverrides` keys are NOT consumed (the rename is hard).

`packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/ai-overrides.test.ts`:

- Existing tests adapted to use `entry.overrides.ai.agents` / `entry.overrides.ai.tools`.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Unwired domain silently does nothing | Dispatcher emits a one-shot structured warning per domain, linking to the tracking issue. Tests assert the warning. |
| App boot order matters (overrides must apply before the registry first load) | The dispatcher is called from `bootstrap.ts` BEFORE any registry loads. Tests cover the ordering. |
| Different domains have different "id" semantics (route key vs subscriber id vs DI key) | The umbrella type names each sub-shape clearly; per-domain spec phases lock the id syntax. |
| Removing an ACL feature via override doesn't migrate existing role grants | Documented in Phase 16 — `acl.features` override hides the feature from the ACL registry; operators run `yarn mercato auth sync-role-acls --all-tenants` to drop the orphan grants. |
| Disabling a route via override leaves stale links elsewhere | Each route override emits a structured warning if the disabled route is referenced by an ACL, page, or widget. Phase 2/3 detail. |
| DI override pulls the rug from a dependent service | DI override is gated behind a `phase: 'pre-registrar'` flag — the dispatcher applies before module DI registrars run. Phase 17 detail. |

## Changelog

- **2026-05-04 — initial draft.** Phased umbrella spec. Phase 1 (AI) wired in this branch; Phases 2–18 stubbed and tracked on the GitHub issue (link in the issue body).
