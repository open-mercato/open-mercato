# SPEC — Unified `modules.ts` Overrides

**Status:** implemented in PR #1960 (Phases 1-18 wired)
**Owner:** core / shared / ai-assistant
**Date:** 2026-05-04
**Last revised:** 2026-05-18
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
- **Phased rollout completed** — every domain in the umbrella has a runtime composer, registry hook, and test coverage. Future domains must still register a dispatcher applier before they are documented as available.
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
    defaultCustomerRoleFeatures?: Record<string, readonly string[]> // customer role -> feature list (replaces)
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
| 1 | AI overrides | `ai.agents`, `ai.tools` | agent id / tool name | **YES** |
| 2 | Routes — API | `routes.api` | `'METHOD /api/path'` | **YES** |
| 3 | Routes — Pages | `routes.pages` | `'/backend/...'` / `'/frontend/...'` | **YES** |
| 4 | Events — Subscribers | `events.subscribers` | subscriber id | **YES** |
| 5 | Workers | `workers` | worker id (`<module>:<id>`) | **YES** |
| 6 | Widget injection | `widgets.injection` | injection widget id | **YES** |
| 7 | Component overrides | `widgets.components` | component handle | **YES** |
| 8 | Dashboard widgets | `widgets.dashboard` | widget id | **YES** |
| 9 | Notifications — Types & Handlers | `notifications.*` | type id / handler id | **YES** |
| 10 | Interceptors (CRUD + custom) | `interceptors` | interceptor id | **YES** |
| 11 | Command interceptors | `commandInterceptors` | interceptor id | **YES** |
| 12 | Response enrichers | `enrichers` | enricher id | **YES** |
| 13 | Page guards | `guards` | middleware id | **YES** |
| 14 | CLI commands | `cli` | command string | **YES** |
| 15 | Setup hooks | `setup` | module id | **YES** |
| 16 | ACL features | `acl.features` | feature id | **YES** |
| 17 | DI bindings | `di` | container key | **YES** |
| 18 | Encryption maps | `encryption.maps` | entity id | **YES** |

Phase 1 is the AI domain (already shipped via spec [`2026-04-30-ai-overrides-and-module-disable.md`](2026-04-30-ai-overrides-and-module-disable.md), now folded under the unified umbrella through one rename — see "Migration & BC" below).

Phases 2-18 now ship through PR #1960. The dispatcher still supports the "not yet wired" warning for future/custom domains that are added to the umbrella without a registered applier, but every domain listed above has a built-in applier.

## Progress

- [x] Phase 1 — AI overrides.
- [x] Phase 2 — API route overrides.
- [x] Phase 3 — backend/frontend page route overrides.
- [x] Phase 4 — event subscriber overrides.
- [x] Phase 5 — worker overrides.
- [x] Phase 6 — injection widget overrides.
- [x] Phase 7 — component override overrides.
- [x] Phase 8 — dashboard widget overrides.
- [x] Phase 9 — notification type and handler overrides.
- [x] Phase 10 — API interceptor overrides.
- [x] Phase 11 — command interceptor overrides.
- [x] Phase 12 — response enricher overrides.
- [x] Phase 13 — page guard overrides.
- [x] Phase 14 — CLI command overrides.
- [x] Phase 15 — setup hook overrides.
- [x] Phase 16 — ACL feature overrides.
- [x] Phase 17 — DI binding overrides.
- [x] Phase 18 — encryption map overrides.
- [x] Documentation follow-up — bb2030e1b.

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

## Implementation surface

| File | Change |
|------|--------|
| `packages/shared/src/modules/overrides.ts` | Umbrella `ModuleOverrides` type, dispatcher, per-domain stores/composers, programmatic helpers, and apply helpers for phases 2-18 |
| `packages/shared/src/modules/index.ts` | Re-export `ModuleOverrides`, `applyModuleOverridesFromEnabledModules` |
| `packages/ai-assistant/src/modules/ai_assistant/lib/ai-overrides.ts` | `applyAiOverridesFromEnabledModules` reads `entry.overrides?.ai` |
| `packages/ai-assistant/src/index.ts` | Export the helper unchanged (signature stable) |
| `packages/shared/src/modules/registry.ts` | API and page manifest registries apply route overrides; CLI module registry applies module-list overrides |
| `packages/shared/src/lib/modules/registry.ts` | Runtime module registry applies subscribers, workers, CLI, setup, ACL, and encryption overrides |
| `packages/shared/src/lib/crud/interceptor-registry.ts` / `enricher-registry.ts` | CRUD interceptors and response enrichers apply overrides before flattening |
| `packages/shared/src/lib/commands/command-interceptor-store.ts` | Command interceptors apply overrides before flattening |
| `packages/shared/src/lib/middleware/page-executor.ts` | Page guard middleware applies overrides before sorting/execution |
| `packages/shared/src/lib/notifications/handler-registry.ts` | Notification handlers apply overrides before flattening |
| `packages/shared/src/lib/bootstrap/factory.ts` | Component override entries apply `widgets.components` overrides before registration |
| `packages/shared/src/lib/di/container.ts` | Request container applies `di` overrides as the final app-level container mutation |
| `packages/shared/src/modules/widgets/injection-loader.ts` | Core injection widgets and injection tables apply widget overrides |
| `packages/ui/src/backend/injection/widgetRegistry.ts` / `dashboard/widgetRegistry.ts` | UI widget registries apply injection/dashboard overrides before storing entries |
| `packages/queue/src/worker/registry.ts` | Worker registry applies worker overrides before registration |
| `packages/cli/src/lib/generators/extensions/notifications.ts` | Generated notification type outputs apply notification type overrides |
| `apps/mercato/src/modules/example/api/override-probe/route.ts` | New example API route used by integration coverage for `routes.api` replacement |
| `apps/mercato/src/modules.ts` | `ModuleEntry` carries `overrides?: ModuleOverrides`; example module overrides the probe API route |
| `apps/mercato/src/bootstrap.ts` | Switch from `applyAiOverridesFromEnabledModules` to `applyModuleOverridesFromEnabledModules` |
| `apps/mercato/src/app/api/[...slug]/route.ts` and page catch-alls | Match against registered route manifests so route/page overrides are used at runtime |
| `packages/create-app/template/src/modules.ts` | Same override example and type shape |
| `packages/create-app/template/src/bootstrap.ts` | Same dispatcher rename |
| `packages/create-app/template/src/app/api/[...slug]/route.ts` and page catch-alls | Same registered-manifest runtime behavior |
| `apps/docs/docs/framework/ai-assistant/overrides.mdx` | Update Path B to use `overrides.ai.agents` / `overrides.ai.tools` |
| `apps/docs/docs/framework/modules/overrides.mdx` | New umbrella docs page with examples for all wired phases |
| `apps/docs/docs/framework/modules/routes-and-pages.mdx` | Route override docs cover API and page routes |
| `packages/ai-assistant/AGENTS.md` | Update Path B example |
| `packages/create-app/template/AGENTS.md` | Add `modules.ts` examples for all wired domains |
| `AGENTS.md` (root) | Update Task Router row + add umbrella row |
| `.ai/skills/om-create-ai-agent/SKILL.md` | Update Path B example |
| `.ai/specs/implemented/2026-04-30-ai-overrides-and-module-disable.md` | Add migration changelog entry pointing here |

## Test surface

`packages/shared/src/modules/__tests__/overrides.test.ts`:

- Dispatcher walks `enabledModules` and calls into the AI tier with the resolved map.
- An entry without `overrides` is a no-op.
- Built-in shared domains route to default appliers without "not yet wired" warnings.
- Multiple entries with the same domain accumulate (last entry per id wins).
- The legacy `aiAgentOverrides` / `aiToolOverrides` keys are NOT consumed (the rename is hard).

`packages/shared/src/modules/__tests__/route-overrides.test.ts`:

- API route disable/replace behavior, method dropping, stale-key warnings, and programmatic precedence.
- Page route disable/replace behavior for backend/frontend manifests.
- Backend/frontend route manifest registries apply page overrides at registration time.

`packages/shared/src/modules/__tests__/contract-overrides.test.ts`:

- Module-list domains: subscribers, workers, CLI, setup, ACL, and encryption maps.
- Registry-entry domains: injection/dashboard/component widgets, notification types/handlers, API interceptors, command interceptors, enrichers, and page guards.
- Injection table cleanup for disabled injection widgets.
- DI binding disable/replace behavior.

`packages/queue/src/worker/__tests__/registry.test.ts`:

- Queue worker registry applies unified worker overrides before storing descriptors.

`apps/mercato/src/modules/example/__integration__/TC-UMES-022-overrides.spec.ts` and template mirror:

- Calls `GET /api/example/override-probe` and asserts the `modules.ts` API route override replaced the base handler.

`packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/ai-overrides.test.ts`:

- Existing tests adapted to use `entry.overrides.ai.agents` / `entry.overrides.ai.tools`.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Future/custom override domain silently does nothing | Dispatcher still emits a one-shot structured warning when a domain has no registered applier. Built-in phases 1-18 all register appliers. |
| App boot order matters (overrides must apply before the registry first load) | The dispatcher is called from `bootstrap.ts` BEFORE any registry loads. Tests cover the ordering. |
| Different domains have different "id" semantics (route key vs subscriber id vs DI key) | The umbrella type names each sub-shape clearly; per-domain spec phases lock the id syntax. |
| Removing an ACL feature via override doesn't migrate existing role grants | Documented in Phase 16 — `acl.features` override hides the feature from the ACL registry; operators run `yarn mercato auth sync-role-acls --all-tenants` to drop the orphan grants. |
| Disabling a route or widget leaves stale references elsewhere | Stale override keys log a warning. Operators must remove links, grants, or injection-table references that intentionally target disabled contracts. |
| DI override pulls the rug from a dependent service | `di` overrides are intentionally last-chance container mutations. Use them for app policy only, and keep dependent service overrides in the same `modules.ts` entry or app-level DI file. |

## Changelog

- **2026-05-04 — initial draft.** Phased umbrella spec. Phase 1 (AI) wired in this branch; Phases 2–18 stubbed and tracked on the GitHub issue (link in the issue body).
- **2026-05-18 — Phase 2 wired (`overrides.routes.api`).** The shared package's umbrella dispatcher now routes `entry.overrides.routes.api` to a per-domain applier that composes a `'METHOD /api/path'` → override map. `registerApiRouteManifests` consults the composed map at registration time and rewrites the stored manifest: a `null` override drops the matching method (or the whole entry when every method is disabled), and a `{ handler, metadata? }` override wraps the manifest's `load()` so the override handler ships at `module[METHOD]` and override metadata replaces the matching per-method metadata. Resolution order today is **programmatic (`applyApiRouteOverrides`) → `modules.ts` inline → base**. The file-based tier is intentionally out of scope for Phase 2 — modules that want to override another module's API route do so through `modules.ts` or programmatically. Tests live at `packages/shared/src/modules/__tests__/route-overrides.test.ts`.
- **2026-05-18 — Phases 3-18 wired.** Page routes, subscribers, workers, widgets, notifications, API interceptors, command interceptors, response enrichers, page guards, CLI commands, setup hooks, ACL features, DI bindings, and encryption maps now have typed override maps, programmatic helpers, dispatcher appliers, registry hooks, and unit coverage. The example app and create-app template include `GET /api/example/override-probe`, override it through `modules.ts`, and add Playwright integration coverage (`TC-UMES-022`) proving the downstream API route override wins. Docs now include `framework/modules/overrides` with examples for every phase.
- **2026-05-18 — Documentation/examples follow-up.** The example app and create-app template now export a non-applied `moduleOverrideExamples` catalog for every wired domain, the standalone template AGENTS guidance points developers at it, and the AI override docs no longer describe the non-AI domains as pending.
