# Module Development Quick Reference

> Linked from the root `AGENTS.md` (Task Router → Module Development). All paths use `src/modules/<module>/` as shorthand. See `packages/core/AGENTS.md` for full details.

## Auto-Discovery Paths

- Frontend pages: `frontend/<path>.tsx` → `/<path>`
- Backend pages: `backend/<path>.tsx` → `/backend/<path>` (special: `backend/page.tsx` → `/backend/<module>`)
- API routes: `api/<method>/<path>.ts` → `/api/<path>` (dispatched by method)
- Subscribers: `subscribers/*.ts` — export default handler + `metadata` with `{ event, persistent?, id? }`
- Workers: `workers/*.ts` — export default handler + `metadata` with `{ queue, id?, concurrency? }`

## Optional Module Files

| File | Export | Purpose |
|------|--------|---------|
| `index.ts` | `metadata` | Module metadata |
| `cli.ts` | default | CLI commands |
| `di.ts` | `register(container)` | DI registrar (Awilix) |
| `acl.ts` | `features` | Feature-based permissions |
| `setup.ts` | `setup: ModuleSetupConfig` | Tenant initialization, role features, customer role features |
| `ce.ts` | `entities` | Custom entities / custom field sets |
| `search.ts` | `searchConfig` | Search indexing configuration |
| `events.ts` | `eventsConfig` | Typed event declarations |
| `translations.ts` | `translatableFields` | Translatable field declarations per entity |
| `notifications.ts` | `notificationTypes` | Notification type definitions |
| `notifications.client.ts` | — | Client-side notification renderers |
| `generators.ts` | `generatorPlugins` | Generator plugin declarations for additional aggregated output files |
| `ai-tools.ts` | `aiTools` | MCP AI tool definitions |
| `ai-agents.ts` | `aiAgents` | AI agent definitions (chat/object runtimes, tool allowlists, mutation policy) |
| `api/interceptors.ts` | `interceptors` | API route interception hooks (before/after) |
| `data/entities.ts` | — | MikroORM entities |
| `data/validators.ts` | — | Zod validation schemas |
| `data/extensions.ts` | `extensions` | Entity extensions (module links) |
| `widgets/injection/` | — | Injected UI widgets |
| `widgets/injection-table.ts` | — | Widget-to-slot mappings |
| `widgets/components.ts` | `componentOverrides` | Component replacement/wrapper/props override definitions |
| `data/enrichers.ts` | `enrichers` | Response enrichers for data federation |

## Module Rules

- API routes MUST export `openApi` for documentation generation
- CRUD routes: use `makeCrudRoute` with `indexer: { entityType }` for query index coverage
- Write operations: implement via the Command pattern (see `packages/core/src/modules/customers/commands/*`)
- Feature naming convention: `<module>.<action>` (e.g., `example.view`, `example.create`).
- setup.ts: always declare `defaultRoleFeatures` when adding features to `acl.ts`; grant admin and any appropriate default roles automatically, then run `yarn mercato auth sync-role-acls` so existing tenants receive the new ACLs
- Every module with guarded routes or pages MUST declare features in `acl.ts` — never ship an empty `acl.ts` with `requireRoles` guards
- Custom fields: use `collectCustomFieldValues()` from `@open-mercato/ui/backend/utils/customFieldValues`
- Detail/read-model APIs that expose `customFields` MUST normalize response keys to bare field names via `normalizeCustomFieldResponse()` (for example `{ priority: 3 }`). Reserve `cf_` / `cf:` prefixes for request payloads, query-engine selectors, and form wiring.
- Events: use `createModuleEvents()` with `as const` for typed emit
- Translations: when adding entities with user-facing text fields (title, name, description, label), create `translations.ts` at module root declaring translatable fields. Run `yarn generate` after adding.
- Widget injection: declare in `widgets/injection/`, map via `injection-table.ts`
- Optional peer modules: resolve a non-required dependency inside `try/catch` (a per-module local `tryResolve` helper wrapping `container.resolve()`) and degrade when absent — never a hard `requires` on a module that should be optional. (Cross-module ORM relations and side-effect imports are already banned — see root `AGENTS.md` § Architecture.) Detail: `packages/core/AGENTS.md` → Cross-Module Coupling
- API interception: declare interceptors in `api/interceptors.ts`; keep hooks fail-closed and scoped by route + method
- Interceptors that narrow CRUD list results SHOULD prefer rewriting `query.ids` (comma-separated UUID list) instead of post-filtering response arrays
- Component replacement: use handle-based IDs (`page:*`, `data-table:*`, `crud-form:*`, `section:*`) for deterministic overrides
- Generated files split into two buckets — see [Generated Files: versioned vs ephemeral](#generated-files-versioned-vs-ephemeral):
  - **Ephemeral** (gitignored, regenerated on every `yarn generate`, wiped by `yarn clean-generated`): `apps/mercato/.mercato/generated/`, `packages/*/generated/`, `src/generated/`. Never edit manually and never depend on them being present in a fresh clone before `yarn generate` runs.
  - **Versioned** (committed `*.generated.ts` files living next to source — e.g. `apps/mercato/src/official-modules.generated.ts`, `packages/core/src/generated-shims/entities.ids.generated.ts`, `packages/ui/src/backend/fields/registry.generated.ts`): also never edit by hand, but they MUST stay in git because they encode source-of-truth state (module activation, frozen ID maps, registry shape) that must travel with the repo and survive `yarn clean-generated`.
- New modules start strict on DS lint: the PR that scaffolds a module MUST add a full `error`-severity override block for the `om-ds/*` rules to the escalation section of `eslint.ds.config.mjs` (new code has no baseline debt — see `.ai/specs/2026-07-05-ds-lint-ci-escalation-and-alert-migration.md`, Workstream 2)
- Enable modules in your app’s `src/modules.ts` (e.g. `apps/mercato/src/modules.ts`)
- Run `yarn generate` after adding/modifying module files
- Agents MUST automatically run `yarn mercato configs cache structural --all-tenants` after enabling/disabling modules in `src/modules.ts`, adding/removing backend or frontend pages, or changing sidebar/navigation injection — stale `nav:*` cache and stale Turbopack module-graph fingerprints can both hide structural changes until they are purged. The structural command purges `nav:*` Redis keys and bumps mtimes on `.mercato/generated/*.generated.{ts,checksum}` so Turbopack re-evaluates the import graph without a dev-server restart. If Turbopack still serves a stale compiled chunk after that, run `yarn dev:reset` to clear `.mercato/next/dev` plus legacy `.next` caches and restart `yarn dev`.
- New integration providers MUST own their env-backed preconfiguration inside the provider package: implement preset reading/application in the provider module, apply it from `setup.ts`, expose a rerunnable provider CLI command when practical, and document the env variables. Do not add provider-specific preconfiguration logic to core modules.
- AI agents: put definitions in `<module>/ai-agents.ts` and run `yarn generate`. Every agent declares `moduleId`, `label`, `executionMode`, `requiredFeatures`, `allowedTools`, `mutationPolicy`, and `defaultModel` (optional). See `packages/ai-assistant/AGENTS.md` and `/framework/ai-assistant/agents`.
- AI-driven mutations MUST go through `prepareMutation(...)` + pending-action approval; never write directly inside a mutation tool handler — the runtime fails closed if the approval contract is bypassed.
- AI provider keys: at least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` must be set. Per-module model overrides use `OM_AI_<MODULE>_MODEL` (uppercased module id).

## Generated Files: versioned vs ephemeral

The codebase has two categories of generated files. Both are auto-written by tooling and MUST NOT be hand-edited, but they live in different places for different reasons.

| Category | Where it lives | Tracked in git? | Survives `yarn clean-generated`? | Use it for |
|---|---|---|---|---|
| **Ephemeral** | `apps/mercato/.mercato/generated/`, `packages/*/generated/`, `src/generated/` (all matched by `.gitignore`) | No | No — wiped by `find -name generated -exec rm -rf` in `scripts/clean-generated.sh` | Per-build artifacts that `yarn generate` re-emits deterministically from in-repo source (module registries, indexer barrels, OpenAPI types, etc.). Safe to delete; safe to re-run. |
| **Versioned** | Next to source as `<name>.generated.ts` / `<name>.generated.tsx` / `<name>-generated.d.ts` — e.g. `apps/mercato/src/official-modules.generated.ts`, `packages/core/src/generated-shims/entities.ids.generated.ts`, `packages/ui/src/backend/fields/registry.generated.ts`, `packages/ui/src/backend/icons/lucideRegistry.generated.tsx`, `packages/ai-assistant/src/modules/ai_assistant/lib/ai-{tools,agents}-generated.d.ts` | Yes | Yes — they are NOT inside any `generated/` folder and NOT inside `.mercato`, so the find-and-delete pattern doesn't match them | Source-of-truth state that must travel with the repo: module-activation config (`official-modules.json` → `official-modules.generated.ts`), frozen entity-id maps that protect against typos at type-check time, and registry shapes that other typed code imports. |

**Before moving a versioned generated file into a `generated/` folder:** read `.ai/specs/2026-05-19-official-modules-generated-location-decision.md` — `scripts/clean-generated.sh` wipes every `generated/` folder, so a move requires coordinated changes to `.gitignore` and the clean script. Don't do it piecemeal.
