# Agents Guidelines

Leverage the module system and follow strict naming and coding conventions to keep the system consistent and safe to extend.

## Always

- Check the Task Router below before research or coding; a single task may match multiple rows, and all relevant guides apply.
- Check `.ai/specs/` and `.ai/specs/enterprise/` for existing specs before modifying a module.
- Enter plan mode for non-trivial tasks with 3+ steps or architectural decisions.
- Identify the reference module (`customers`) when building CRUD features.
- Preserve behavior unless the user or a spec explicitly asks for a behavior change.
- Keep changes minimal, focused, and integrated through real call sites.
- Use the closest package/module `AGENTS.md` for local architecture, imports, and validation commands.
- Follow `BACKWARD_COMPATIBILITY.md` before touching any contract surface.
- Run `yarn generate` after adding or modifying module files that rely on auto-discovery.

## Ask First

- Ask before reducing scope, changing architecture, changing public contracts, adding production dependencies, or touching multiple modules in a way not covered by an existing spec.
- Ask before changing branch/PR automation, pipeline labels, QA flow, release behavior, or external official-module submodule pointers.
- Ask before applying database migrations locally with `yarn db:migrate`; normal PRs should include migration files and snapshots.
- Ask before introducing provider-specific preconfiguration outside the provider package.

## Never

- Never expose cross-tenant data or skip tenant/organization scoping.
- Never edit generated files by hand.
- Never add code directly under `apps/mercato/src/` except committed, typed `*.generated.ts` registries described below.
- Never create direct ORM relationships between modules.
- Never bypass mutation guards, command side effects, encryption helpers, RBAC wildcard matching, or shared UI data-call helpers.
- Never hard-code user-facing strings or design-system status colors.
- Never commit credentials, raw tokens, private keys, local-only ops files, or fork-only infrastructure notes into upstream-friendly branches.

## Validation Commands

Choose the smallest relevant set for the change:

```bash
yarn generate
yarn build:packages
yarn typecheck
yarn lint
yarn test
yarn build:app
```

## Task Router — Where to Find Detailed Guidance

IMPORTANT: Before any research or coding, match the task to the root `AGENTS.md` Task Router table. A single task often maps to **multiple rows** — for example, "add a new module with search" requires both the Module Development and Search guides. Read **all** matching guides before starting. They contain the imports, patterns, and constraints you need. Only use Explore agents for topics not covered by any existing AGENTS.md.

| Task | Guide |
|------|-------|
| **Module Development** | |
| Creating a new module, scaffolding module files, auto-discovery paths | `packages/core/AGENTS.md` |
| Working on official modules via the `external/official-modules` submodule, activating them (`yarn official-modules`, `official-modules.json`), committing to the submodule's git | this file → `external/official-modules/` (git submodule) |
| Building CRUD API routes, adding OpenAPI specs, using `makeCrudRoute`, query engine integration | `packages/core/AGENTS.md` → API Routes |
| Adding `setup.ts` for tenant init, declaring role features, syncing new ACL grants to roles, seeding defaults/examples | `packages/core/AGENTS.md` → Module Setup |
| Declaring typed events with `createModuleEvents`, emitting CRUD/lifecycle events, adding event subscribers | `packages/core/AGENTS.md` → Events |
| Adding in-app notifications, subscriber-based alerts, writing notification renderers | `packages/core/AGENTS.md` → Notifications |
| Adding reactive notification handlers (`notifications.handlers.ts`), `useNotificationEffect`, auto side-effects on notification arrival | `packages/core/AGENTS.md` → Notifications + `packages/ui/AGENTS.md` |
| Injecting UI widgets into other modules, defining spot IDs, cross-module UI extensions | `packages/core/AGENTS.md` → Widgets |
| Building headless injection widgets (menu items, columns, fields), using `InjectionPosition`, or `useInjectionDataWidgets` | `packages/core/AGENTS.md` → Widget Injection + `packages/ui/AGENTS.md` |
| Injecting menu items into main/settings/profile sidebars or topbar/profile dropdown (`useInjectedMenuItems`, `mergeMenuItems`) | `packages/ui/AGENTS.md` |
| Adding API route interceptors (`api/interceptors.ts`, before/after hooks, body/query rewrite contracts) | `packages/core/AGENTS.md` → API Interceptors |
| Adding DataTable extension widgets (columns/row actions/bulk actions/filters) | `packages/core/AGENTS.md` → Widget Injection + `packages/ui/AGENTS.md` → DataTable Guidelines |
| Adding bulk operations, DataTable bulk actions, selected-row mutations, or future long-running operations with progress | `packages/core/src/modules/progress/AGENTS.md` + `packages/ui/AGENTS.md` → DataTable Guidelines + `packages/queue/AGENTS.md` |
| Adding CrudForm field injection widgets (`crud-form:<entityId>:fields`) | `packages/core/AGENTS.md` → Widget Injection + `packages/ui/AGENTS.md` → CrudForm Guidelines |
| Replacing or wrapping UI components via `widgets/components.ts` (`replace`/`wrapper`/`props`) | `packages/core/AGENTS.md` → Component Replacement + `packages/ui/AGENTS.md` |
| Adding custom fields/entities, using DSL helpers (`defineLink`, `cf.*`), declaring `ce.ts` | `packages/core/AGENTS.md` → Custom Fields |
| Adding entity extensions, cross-module data links, `data/extensions.ts` | `packages/core/AGENTS.md` → Extensions |
| Configuring RBAC features in `acl.ts`, declarative guards, permission checks | `packages/core/AGENTS.md` → Access Control |
| Fixing wildcard ACL handling in feature-gated runtime helpers (menus, notification handlers, mutation guards, command interceptors, AI tools) | `packages/core/AGENTS.md` → Access Control + `packages/shared/AGENTS.md` + `packages/ui/AGENTS.md` + `packages/core/src/modules/auth/AGENTS.md` (portal: `customer_accounts/AGENTS.md`) |
| Using encrypted queries (`findWithDecryption`), encryption defaults, GDPR fields | `packages/core/AGENTS.md` → Encryption |
| Adding response enrichers to enrich other modules' API responses | `packages/core/AGENTS.md` → Response Enrichers |
| Filtering CRUD list APIs by multiple IDs (`?ids=uuid1,uuid2`), including interceptor-driven ID narrowing | `packages/core/AGENTS.md` → API Interceptors + `packages/shared/AGENTS.md` |
| Adding DOM Event Bridge (SSE-based real-time events to browser), `useAppEvent`, `useOperationProgress` | `packages/events/AGENTS.md` → DOM Event Bridge |
| Building customer portal pages, portal auth, portal nav injection, portal event bridge | `packages/ui/AGENTS.md` → Portal Extension |
| Adding new widget event handlers (`onFieldChange`, `onBeforeNavigate`, transformers) | `packages/ui/AGENTS.md` |
| Building AI agents/tools (`ai-agents.ts`, `ai-tools.ts`, tool packs, mutation approval via `prepareMutation`, attachments, provider/model selection) | `.ai/skills/create-ai-agent/SKILL.md` + `packages/ai-assistant/AGENTS.md` + `apps/docs/docs/framework/ai-assistant/*.mdx` |
| AI agent loop controls + overrides (`loop.stopWhen/prepareStep/budget`, per-tenant settings, replacing/disabling agents/tools, module-level `entry.overrides`) | `packages/ai-assistant/AGENTS.md` → Loop controls + How to Override + `.ai/specs/2026-04-28-ai-agents-agentic-loop-controls.md` + `.ai/specs/2026-04-30-ai-overrides-and-module-disable.md` + `.ai/specs/2026-05-04-modules-ts-unified-overrides.md` |
| **Specific Modules** | |
| Module-specific work (customers as reference for new CRUD modules, plus sales, catalog, auth, customer_accounts, currencies, workflows, integrations, data_sync, progress) | `packages/core/src/modules/<module>/AGENTS.md` |
| Webhooks (outbound/inbound, Standard Webhooks signing, delivery queues, admin UI) | `packages/webhooks/AGENTS.md` (cross-refs `queue`, `events`, `integrations`, `ui`) |
| Building a new integration provider (adapter, health check, credentials, bundle wiring) | `.ai/skills/integration-builder/SKILL.md` + `packages/core/src/modules/integrations/AGENTS.md` + `packages/core/src/modules/data_sync/AGENTS.md` |
| **Packages** | |
| Adding reusable utilities, encryption helpers, i18n translations (`useT`/`resolveTranslations`), boolean parsing, data engine types, request scoping | `packages/shared/AGENTS.md` |
| Building forms (`CrudForm`), data tables (`DataTable`), loading/error states, flash messages, `FormHeader`/`FormFooter`, dialog UX (`Cmd+Enter`/`Escape`) | `packages/ui/AGENTS.md` |
| Backend page components, `apiCall` usage, `RowActions` ids, `LoadingMessage`/`ErrorMessage` | `packages/ui/src/backend/AGENTS.md` |
| Configuring fulltext/vector/token search, writing `search.ts`, reindexing entities, debugging search, search CLI commands | `packages/search/AGENTS.md` |
| Adding MCP tools (`registerMcpTool`), modifying OpenCode config, debugging AI chat, session tokens, command palette, two-tier auth | `packages/ai-assistant/AGENTS.md` |
| Running generators (`yarn generate`), creating database migrations (`yarn db:generate`), scaffolding modules, build order | `packages/cli/AGENTS.md` |
| Event bus architecture, ephemeral vs persistent subscriptions, queue integration for events, event workers | `packages/events/AGENTS.md` |
| Adding cache to a module, tag-based invalidation, tenant-scoped caching, choosing strategy (memory/SQLite/Redis) | `packages/cache/AGENTS.md` |
| Adding background workers, configuring concurrency (I/O vs CPU-bound), idempotent job processing, queue strategies | `packages/queue/AGENTS.md` |
| Tracking operation progress in the top bar, creating `ProgressJob`s, or emitting client-local progress events | `packages/core/src/modules/progress/AGENTS.md` + `packages/events/AGENTS.md` → DOM Event Bridge |
| Adding onboarding wizard steps, tenant setup hooks (`onTenantCreated`/`seedDefaults`), welcome/invitation emails | `packages/onboarding/AGENTS.md` |
| Adding static content pages (privacy policies, terms, legal pages) | `packages/content/AGENTS.md` |
| Testing standalone apps with Verdaccio, publishing packages, canary releases, template scaffolding | `packages/create-app/AGENTS.md` |
| **Performance** | |
| Profiling dev-mode memory (`yarn dev:profile`), ranking memory hogs, evaluating watcher / Vite-vs-Turbopack tradeoffs | `.ai/specs/2026-05-27-dev-mode-memory-quick-wins.md` + `scripts/profile-dev-rss.mjs` |
| **Migration** | |
| Migrating custom module code from MikroORM v6 to v7 (decorators, persist/flush, Knex→Kysely, type fixes, ORM config, Jest setup) | `.ai/skills/migrate-mikro-orm/SKILL.md` |
| **Testing** | |
| Integration testing, creating/running Playwright tests, converting markdown test cases to TypeScript, CI test pipeline | `.ai/qa/AGENTS.md` + `.ai/skills/integration-tests/SKILL.md` |
| **Spec & PR Automation** | |
| Spec lifecycle (pre-implement → implement → write/update), code review, DS review | Browse `.ai/skills/{pre-implement-spec,implement-spec,code-review,ds-guardian}/SKILL.md` + `.ai/specs/AGENTS.md` + `.ai/ds-rules.md` |
| PR/issue automation (one-shot auto-PR, resumable loop variants, review/merge-buddy, post-merge sync, changelog). **Default for one-off bug fixes / small features:** `auto-create-pr` | Browse `.ai/skills/{auto-create-pr,auto-continue-pr,auto-create-pr-loop,auto-continue-pr-loop,auto-review-pr,merge-buddy,review-prs,sync-merged-pr-issues,auto-update-changelog}/SKILL.md` |

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Workflow Orchestration

1.  **Spec-first**: Enter plan mode for non-trivial tasks (3+ steps or architectural decisions). Check `.ai/specs/` and `.ai/specs/enterprise/` before coding; create spec files using scope-appropriate naming (`{date}-{title}.md` for OSS and enterprise, with `date` as `YYYY-MM-DD` and `title` as kebab-case). Skip for small fixes.
    -   **Detailed Workflow**: Refer to the **`spec-writing` skill** for research, phasing, and architectural review standards (`.ai/skills/spec-writing/SKILL.md`).
    -   **Pre-implementation analysis**: Before implementing a complex spec, run the **`pre-implement-spec` skill** to audit backward compatibility, identify gaps, and produce a readiness report.
    -   **Implementation**: Use the **`implement-spec` skill** to execute spec phases with coordinated subagents, unit tests, progress tracking, and code-review compliance gates.
2.  **Subagent strategy**: Use subagents liberally to keep main context clean. Offload research and parallel analysis. One task per subagent.
3.  **Self-improvement**: After corrections, update `.ai/lessons.md` or relevant AGENTS.md. Write rules that prevent the same mistake.
4.  **Verification**: Run tests, check build, suggest user verification. Ask: "Would a staff engineer approve this?"
5.  **Elegance**: For non-trivial changes, pause and ask "is there a more elegant way?" Skip for simple fixes.
6.  **Autonomous bug fixing**: When given a bug report, just fix it. Point at logs/errors, then resolve. Zero hand-holding.

## PR Workflow

- Pipeline labels are mutually exclusive: `review`, `changes-requested`, `qa`, `qa-failed`, `merge-queue`, `blocked`, `do-not-merge`.
- Category labels are additive: `bug`, `feature`, `refactor`, `security`, `dependencies`, `enterprise`, `documentation`.
- Meta labels are additive: `needs-qa`, `skip-qa`, `in-progress`.
- Priority labels are mutually exclusive within their group (only one at a time): `priority-low`, `priority-medium`, `priority-high`, `priority-extreme`. They are applied to issues and PRs to communicate urgency, are additive with respect to category and meta labels, and default to **unset** (treated as `priority-medium`) when no priority label is present. Use `priority-extreme` for production outages or security incidents that require immediate action; `priority-high` for release-blocking issues; `priority-low` for cosmetic, opportunistic, or follow-up cleanup work.
- A ready non-draft PR should carry `review` unless it is already in another pipeline state.
- `auto-review-pr` MUST move approved PRs to `qa` when `needs-qa` is present and `skip-qa` is absent; otherwise it MUST move them to `merge-queue`.
- `auto-review-pr` MUST move review failures to `changes-requested`.
- `needs-qa` is for UI changes, new features, sales or order flows, and other customer-facing behavior that needs manual exercise.
- `skip-qa` is for docs-only, dependency-only, CI-only, test-only, typo-only, or similarly low-risk non-customer-facing changes.
- Auto-skills that mutate PRs or issues MUST claim them first with all three signals: assignee, `in-progress` label, and a claim comment. They MUST release the `in-progress` label when finished, even on failure.
- When an auto-skill adds or changes a PR pipeline/meta label, it MUST also leave a short PR comment explaining why that label was applied.
- Use `gh pr edit <number> --remove-label <from> --add-label <to>` for manual QA pipeline transitions (`qa` → `merge-queue` / `qa-failed`; `qa-failed` → `qa`).

### Documentation and Specifications

- OSS specs live in `.ai/specs/`; commercial/enterprise specs live in `.ai/specs/enterprise/` — see `.ai/specs/AGENTS.md` for naming, structure, and changelog conventions.
- Always check for existing specs before modifying a module. Update specs when implementing significant changes.
- For every new feature, the spec MUST list integration coverage for all affected API paths and key UI paths.
- For every new feature, implement the integration tests defined in the spec as part of the same change — see `.ai/qa/AGENTS.md` for the workflow.
- Integration tests MUST be self-contained: create required fixtures in test setup (prefer API fixtures), clean up created records in teardown/finally, and remain stable without relying on seeded/demo data.

## Monorepo Structure

### Apps (`apps/`)

-   **mercato**: Main Next.js app. Put user-created modules in `apps/mercato/src/modules/`.
-   **docs**: Documentation site.

### Packages (`packages/`)

All packages use the `@open-mercato/<package>` naming convention:

| Package | Import | When to use |
|---------|--------|-------------|
| **shared** | `@open-mercato/shared` | When you need cross-cutting utilities, types, DSL helpers, i18n, data engine |
| **ui** | `@open-mercato/ui` | When building UI components, forms, data tables, backend pages |
| **core** | `@open-mercato/core` | When working on core business modules (auth, catalog, customers, sales) |
| **cli** | `@open-mercato/cli` | When adding CLI tooling or generator commands |
| **cache** | `@open-mercato/cache` | When adding caching — resolve via DI, never use raw Redis/SQLite |
| **queue** | `@open-mercato/queue` | When adding background jobs — use worker contract, never custom queues |
| **events** | `@open-mercato/events` | When adding event-driven side effects between modules |
| **search** | `@open-mercato/search` | When configuring search indexing (fulltext, vector, tokens) |
| **ai-assistant** | `@open-mercato/ai-assistant` | When working on AI assistant or MCP server tools |
| **content** | `@open-mercato/content` | When adding static content pages (privacy, terms, legal) |
| **onboarding** | `@open-mercato/onboarding` | When modifying setup wizards or tenant provisioning flows |
| **enterprise** | `@open-mercato/enterprise` | When working on commercial enterprise-only modules and overlays |

### Where to Put Code

- Put core platform features in `packages/<package>/src/modules/<module>/`
- Put every external integration provider in a dedicated npm workspace package under `packages/<provider-package>/` (for example `packages/gateway-stripe`, `packages/carrier-inpost`) — do not add provider modules inside `packages/core/src/modules/`
- Put shared utilities and types in `packages/shared/src/lib/` or `packages/shared/src/modules/`
- Put UI components in `packages/ui/src/`
- Put user/app-specific modules in `apps/mercato/src/modules/<module>/`
- MUST NOT add code directly in `apps/mercato/src/` — it's a boilerplate for user apps. Narrow exception: committed, typed *generated registries* (files matching `*.generated.ts`) consumed by `modules.ts` or other root entry points may live in `apps/mercato/src/` when they must survive `yarn clean-generated` and travel with the repo — see [Generated Files: versioned vs ephemeral](#generated-files-versioned-vs-ephemeral).

### `external/official-modules/` (git submodule)

`external/official-modules/` is a **git submodule** pointing at `open-mercato/official-modules` (a public repo). When present it is real working code — treat it as first-class for search, grep, refactoring, and cross-module reasoning, not as vendored/build output.

- It is **optional and not committed** — `.gitmodules` and the `external/official-modules` checkout are not part of the open-mercato repo. They're created locally by `yarn official-modules add …` (which runs `git submodule add`). A fresh clone has no submodule; `yarn install` and CI are unchanged.
- **Activation is driven by `official-modules.json`** (committed; `activated` is the team default, `available` is auto-filled once the submodule is present) and `official-modules.local.json` (gitignored personal override). Use `yarn official-modules` to inspect/change activation; the `postinstall` worker (`scripts/official-modules-setup.mjs`) — a no-op until the submodule is registered, then it inits/refreshes it — regenerates `apps/mercato/src/official-modules.generated.ts`, which `apps/mercato/src/modules.ts` spreads into `enabledModules`.
- **Module-id convention:** package `@open-mercato/<suffix>` ⇒ module id `<suffix>` with dashes converted to underscores (e.g. `@open-mercato/ai-assistant` ⇒ `ai_assistant`).
- **Edits under `external/official-modules/` commit to the submodule's git, not open-mercato's.** Commit/push from inside `external/official-modules/` on a feature branch; create the changeset there (`yarn changeset`); open the PR against `open-mercato/official-modules`.
- **Never `git add external/official-modules` (pointer bump) unless explicitly asked** — the pointer may lag intentionally. Always check `git diff --staged` before committing in the host repo. The same applies to `apps/mercato/src/official-modules.generated.ts` / `official-modules.json` `available` churn unless you actually intend to change the activation set.
- After activating/deactivating official modules: run `yarn mercato configs cache structural --all-tenants` (and `yarn dev:reset` if Turbopack serves a stale chunk).
- **Cross-cutting changes** (core API + an official module): two coordinated PRs — core in open-mercato first → (prerelease) publish → submodule bumps the peer dep → submodule PR. Explain the merge order to the user. No PR is atomic across the two repos.

### When You Need an Import

Each package's AGENTS.md is the authoritative cheat sheet for its own imports. Look up by topic:

| Topic | Where |
|-------|-------|
| UI primitives, backend utilities (`apiCall`, `CrudForm`), portal hooks | `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md` |
| AI helpers (`defineAiAgent`, `defineAiTool`, `prepareMutation`, model factory, `<AiChat>`) | `packages/ai-assistant/AGENTS.md` |
| Cross-cutting helpers (i18n, commands, encryption, scoped payloads, boolean parsing, data/query engine types, module-level overrides) | `packages/shared/AGENTS.md` |
| Customer/portal auth helpers, custom-field helpers, CRUD/Indexer types | `packages/shared/AGENTS.md` + `packages/core/AGENTS.md` |
| Search, events, queue, cache, webhooks, content, onboarding | matching `packages/<pkg>/AGENTS.md` |

Examples worth memorising (used everywhere): `apiCall` from `@open-mercato/ui/backend/utils/apiCall`, `useT` from `@open-mercato/shared/lib/i18n/context`, `resolveTranslations` from `@open-mercato/shared/lib/i18n/server`, `Spinner` from `@open-mercato/ui/primitives/spinner`.

Import strategy:
- Prefer package-level imports (`@open-mercato/<package>/...`) over deep relative imports (`../../../...`) when crossing module boundaries, referencing shared module internals, or importing from deeply nested files.
- Keep short relative imports for same-folder/local siblings (`./x`, `../x`) where they are clearer than package paths.

## Conventions

- Modules: plural, snake_case (folders and `id`). Special cases: `auth`, `example`.
- **Event IDs**: `module.entity.action` (singular entity, past tense action, e.g., `pos.cart.completed`). use dots as separators.
- `clientBroadcast: true` in EventDefinition bridges events to browser via SSE (DOM Event Bridge)
- `portalBroadcast: true` in EventDefinition bridges events to customer portal via SSE (Portal Event Bridge)
- JS/TS fields and identifiers: camelCase.
- Database tables and columns: snake_case; table names plural.
- Common columns: `id`, `created_at`, `updated_at`, `deleted_at`, `is_active`, `organization_id`, `tenant_id`.
- UUID PKs, explicit FKs, junction tables for many-to-many.
- Keep code minimal and focused; avoid side effects across modules.
- Keep modules self-contained; re-use common utilities via `src/lib/`.

## Module Development Quick Reference

All paths use `src/modules/<module>/` as shorthand. See `packages/core/AGENTS.md` for full details.

### Auto-Discovery Paths

- Frontend pages: `frontend/<path>.tsx` → `/<path>`
- Backend pages: `backend/<path>.tsx` → `/backend/<path>` (special: `backend/page.tsx` → `/backend/<module>`)
- API routes: `api/<method>/<path>.ts` → `/api/<path>` (dispatched by method)
- Subscribers: `subscribers/*.ts` — export default handler + `metadata` with `{ event, persistent?, id? }`
- Workers: `workers/*.ts` — export default handler + `metadata` with `{ queue, id?, concurrency? }`

### Optional Module Files

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

### Module Rules

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
- API interception: declare interceptors in `api/interceptors.ts`; keep hooks fail-closed and scoped by route + method
- Interceptors that narrow CRUD list results SHOULD prefer rewriting `query.ids` (comma-separated UUID list) instead of post-filtering response arrays
- Component replacement: use handle-based IDs (`page:*`, `data-table:*`, `crud-form:*`, `section:*`) for deterministic overrides
- Generated files split into two buckets — see [Generated Files: versioned vs ephemeral](#generated-files-versioned-vs-ephemeral):
  - **Ephemeral** (gitignored, regenerated on every `yarn generate`, wiped by `yarn clean-generated`): `apps/mercato/.mercato/generated/`, `packages/*/generated/`, `src/generated/`. Never edit manually and never depend on them being present in a fresh clone before `yarn generate` runs.
  - **Versioned** (committed `*.generated.ts` files living next to source — e.g. `apps/mercato/src/official-modules.generated.ts`, `packages/core/src/generated-shims/entities.ids.generated.ts`, `packages/ui/src/backend/fields/registry.generated.ts`): also never edit by hand, but they MUST stay in git because they encode source-of-truth state (module activation, frozen ID maps, registry shape) that must travel with the repo and survive `yarn clean-generated`.
- Enable modules in your app’s `src/modules.ts` (e.g. `apps/mercato/src/modules.ts`)
- Run `yarn generate` after adding/modifying module files
- Agents MUST automatically run `yarn mercato configs cache structural --all-tenants` after enabling/disabling modules in `src/modules.ts`, adding/removing backend or frontend pages, or changing sidebar/navigation injection — stale `nav:*` cache and stale Turbopack module-graph fingerprints can both hide structural changes until they are purged. The structural command purges `nav:*` Redis keys and bumps mtimes on `.mercato/generated/*.generated.{ts,checksum}` so Turbopack re-evaluates the import graph without a dev-server restart. If Turbopack still serves a stale compiled chunk after that, run `yarn dev:reset` to clear `.mercato/next/dev` plus legacy `.next` caches and restart `yarn dev`.
- New integration providers MUST own their env-backed preconfiguration inside the provider package: implement preset reading/application in the provider module, apply it from `setup.ts`, expose a rerunnable provider CLI command when practical, and document the env variables. Do not add provider-specific preconfiguration logic to core modules.
- AI agents: put definitions in `<module>/ai-agents.ts` and run `yarn generate`. Every agent declares `moduleId`, `label`, `executionMode`, `requiredFeatures`, `allowedTools`, `mutationPolicy`, and `defaultModel` (optional). See `packages/ai-assistant/AGENTS.md` and `/framework/ai-assistant/agents`.
- AI-driven mutations MUST go through `prepareMutation(...)` + pending-action approval; never write directly inside a mutation tool handler — the runtime fails closed if the approval contract is bypassed.
- AI provider keys: at least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` must be set. Per-module model overrides use `OM_AI_<MODULE>_MODEL` (uppercased module id).

### Generated Files: versioned vs ephemeral

The codebase has two categories of generated files. Both are auto-written by tooling and MUST NOT be hand-edited, but they live in different places for different reasons.

| Category | Where it lives | Tracked in git? | Survives `yarn clean-generated`? | Use it for |
|---|---|---|---|---|
| **Ephemeral** | `apps/mercato/.mercato/generated/`, `packages/*/generated/`, `src/generated/` (all matched by `.gitignore`) | No | No — wiped by `find -name generated -exec rm -rf` in `scripts/clean-generated.sh` | Per-build artifacts that `yarn generate` re-emits deterministically from in-repo source (module registries, indexer barrels, OpenAPI types, etc.). Safe to delete; safe to re-run. |
| **Versioned** | Next to source as `<name>.generated.ts` / `<name>.generated.tsx` / `<name>-generated.d.ts` — e.g. `apps/mercato/src/official-modules.generated.ts`, `packages/core/src/generated-shims/entities.ids.generated.ts`, `packages/ui/src/backend/fields/registry.generated.ts`, `packages/ui/src/backend/icons/lucideRegistry.generated.tsx`, `packages/ai-assistant/src/modules/ai_assistant/lib/ai-{tools,agents}-generated.d.ts` | Yes | Yes — they are NOT inside any `generated/` folder and NOT inside `.mercato`, so the find-and-delete pattern doesn't match them | Source-of-truth state that must travel with the repo: module-activation config (`official-modules.json` → `official-modules.generated.ts`), frozen entity-id maps that protect against typos at type-check time, and registry shapes that other typed code imports. |

**Before moving a versioned generated file into a `generated/` folder:** read `.ai/specs/2026-05-19-official-modules-generated-location-decision.md` — `scripts/clean-generated.sh` wipes every `generated/` folder, so a move requires coordinated changes to `.gitignore` and the clean script. Don't do it piecemeal.

## Backward Compatibility Contract

> **Full specification**: [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md) — MUST be read before modifying any contract surface. It enumerates the 13 contract-surface categories (auto-discovery files, types, signatures, import paths, event IDs, widget spot IDs, API routes, DB schema, DI keys, ACL features, notification IDs, CLI commands, generated files) and their FROZEN / STABLE / ADDITIVE-ONLY classifications.

Third-party module developers depend on stable platform APIs. Any change to a **contract surface** is a breaking change that blocks merge unless the deprecation protocol is followed.

**Deprecation protocol** (summary): (1) never remove in one release, (2) add `@deprecated` JSDoc, (3) provide a bridge (re-export/alias/dual-emit) for ≥1 minor version, (4) document in RELEASE_NOTES.md, (5) reference a spec with "Migration & Backward Compatibility" section.

## Boundary Labels for Agent Rules

Use `Always`, `Ask First`, `Never`, and `Validation Commands` headings when adding or reorganizing agent rules:

- `Always` — required defaults and commands agents should apply without asking.
- `Ask First` — decisions that need maintainer input before changing behavior, scope, dependencies, branch/deploy flow, or contract surfaces.
- `Never` — prohibited actions and unsafe shortcuts.
- `Validation Commands` — short, real commands agents can run to prove the relevant path.

## Architecture, Data, UI, and Code Rules

These are critical project-wide rules. The top-level `Always`, `Ask First`, and `Never` sections summarize their boundaries; this section keeps the detailed requirements.

### Architecture

-   **NO direct ORM relationships between modules** — use foreign key IDs, fetch separately
-   Always filter by `organization_id` for tenant-scoped entities
-   Never expose cross-tenant data from API handlers
-   Use DI (Awilix) to inject services; avoid `new`-ing directly
-   Modules must remain isomorphic and independent
-   When extending another module's data, add a separate extension entity and declare a link in `data/extensions.ts`

### Data & Security

-   Validate all inputs with zod; place validators in `data/validators.ts`
-   Derive TypeScript types from zod via `z.infer<typeof schema>`
-   Use `findWithDecryption`/`findOneWithDecryption` instead of `em.find`/`em.findOne`
-   Default migration workflow: update ORM entities, run `yarn db:generate`, and review the generated SQL plus `migrations/.snapshot-open-mercato.json`
-   Coding-agent exception: if `yarn db:generate` emits unrelated migrations, delete the unrelated output, keep or write only the intended SQL migration for this entity change, and update the affected module's `.snapshot-open-mercato.json`. Never run `yarn db:migrate` just to make the generator quiet.
-   Hash passwords with bcryptjs (cost >=10), never log credentials
-   Return minimal error messages for auth (avoid revealing whether email exists)
-   RBAC: prefer declarative guards (`requireAuth`, `requireFeatures`) in page metadata; avoid `requireRoles` — role names are mutable and can be spoofed; use feature-based guards with immutable IDs from `acl.ts` instead
-   Portal RBAC: use `requireCustomerAuth` and `requireCustomerFeatures` in page metadata for portal pages

### UI & HTTP

-   Use `apiCall`/`apiCallOrThrow`/`readApiResultOrThrow` from `@open-mercato/ui/backend/utils/apiCall` — never use raw `fetch`
-   If a backend page cannot use `CrudForm`, wrap every write (`POST`/`PUT`/`PATCH`/`DELETE`) in `useGuardedMutation(...).runMutation(...)` and include `retryLastMutation` in the injection context
-   For CRUD forms: `createCrud`/`updateCrud`/`deleteCrud` (auto-handle `raiseCrudError`)
-   For local validation errors: throw `createCrudFormError(message, fieldErrors?)` from `@open-mercato/ui/backend/utils/serverErrors`
-   Read JSON defensively: `readJsonSafe(response, fallback)` — never `.json().catch(() => ...)`
-   Use `LoadingMessage`/`ErrorMessage` from `@open-mercato/ui/backend/detail`
-   i18n: `useT()` client-side, `resolveTranslations()` server-side
-   Never hard-code user-facing strings — use locale files
-   Prefix purely internal `throw new Error(...)` / `createCrudFormError(...)` / `toast.*(...)` messages with `[internal]` so the i18n hardcoded-string checker treats them as opted out; user-facing variants MUST route through `t('module.errors.<key>')`. Run `yarn i18n:check-hardcoded` (and `yarn i18n:check-values` for non-English coverage) to inspect the surface — both are advisory in Phase 1 of `.ai/specs/2026-05-26-missing-translations-audit-and-remediation.md`. Use `<module>/i18n/.hardcoded-allowlist.json` for module-scoped exceptions (legal copy, framework chrome).
-   Every dialog: `Cmd/Ctrl+Enter` submit, `Escape` cancel
-   Keep `pageSize` at or below 100

### Code Quality

- No `any` types — use zod schemas with `z.infer`, narrow with runtime checks
- Prefer functional, data-first utilities over classes
- No one-letter variable names, no inline comments (self-documenting code)
- Don't add docstrings/comments/type annotations to code you didn't change
- Boolean parsing: use `parseBooleanToken`/`parseBooleanWithDefault` from `@open-mercato/shared/lib/boolean`
- Confirm project still builds after changes

## Design System Rules

> Foundations (token tables, decision trees, color/spacing/typography rules): `.ai/ds-rules.md`  
> Component reference (variants, sizes, props, examples, MUST rules per primitive): `.ai/ui-components.md`  
> Workflow guidance (CrudForm, DataTable, Loading, Flash, Notifications, Portal): `packages/ui/AGENTS.md`

- NEVER use hardcoded Tailwind status colors (`text-red-*`, `bg-green-*`, `text-amber-*`, etc.) — use `{property}-status-{status}-{role}` tokens
- NEVER use arbitrary values (`text-[13px]`, `p-[13px]`, `rounded-[24px]`, `z-[9999]`) — use DS scale
- NEVER add `dark:` overrides on semantic/status tokens — they already handle dark mode
- NEVER hardcode hex/rgb in `className` — always use CSS token names
- NEVER use hardcoded Tailwind color shades for borders (`border-gray-300`) — use `border-border`, `border-input`

**Boy Scout Rule**: When touching a file that has hardcoded status colors, arbitrary text sizes, or `dark:` overrides on status colors, migrate at minimum the lines you touched to semantic tokens.

## Key Commands

```bash
yarn dev                  # Start compact dev runtime; press `d` to toggle raw logs
yarn dev:verbose          # Start dev runtime with full raw passthrough logs
yarn dev:reset            # Clear .mercato/next/dev plus legacy .next caches when Turbopack serves stale chunks
yarn dev:app              # Start compact app-only runtime
yarn dev:app:verbose      # Start app-only runtime with raw passthrough logs
yarn build                # Build everything
yarn build:packages       # Build packages only
yarn lint                 # Lint all packages
yarn test                 # Run tests
yarn generate             # Run module generators
yarn db:generate          # Generate database migrations
yarn db:migrate           # Apply database migrations
yarn initialize           # Full project initialization
yarn dev:greenfield       # Fresh compact dev boot with build/generate/reinstall stages
yarn dev:greenfield:verbose  # Greenfield boot with full raw passthrough logs
yarn test:integration     # Run integration tests (Playwright, headless)
yarn test:integration:report  # View HTML test report
```
