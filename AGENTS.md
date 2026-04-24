# Agents Guidelines

Leverage the module system and follow strict naming and coding conventions to keep the system consistent and safe to extend.

## Before Writing Code

1. Check the Task Router below — a single task may match multiple rows; read **all** relevant guides.
2. Check `.ai/specs/` and `.ai/specs/enterprise/` for existing specs on the module you're modifying
3. Enter plan mode for non-trivial tasks (3+ steps or architectural decisions)
4. Identify the reference module (customers) if building CRUD features

## Task Router — Where to Find Detailed Guidance

IMPORTANT: Before any research or coding, match the task to the root `AGENTS.md` Task Router table. A single task often maps to **multiple rows** — for example, "add a new module with search" requires both the Module Development and Search guides. Read **all** matching guides before starting. They contain the imports, patterns, and constraints you need. Only use Explore agents for topics not covered by any existing AGENTS.md.

| Task | Guide |
|------|-------|
| **Module Development** | |
| Creating a new module, scaffolding module files, auto-discovery paths | `packages/core/AGENTS.md` |
| Building CRUD API routes, adding OpenAPI specs, using `makeCrudRoute`, query engine integration | `packages/core/AGENTS.md` → API Routes |
| Adding `setup.ts` for tenant init, declaring role features, seeding defaults/examples | `packages/core/AGENTS.md` → Module Setup |
| Declaring typed events with `createModuleEvents`, emitting CRUD/lifecycle events, adding event subscribers | `packages/core/AGENTS.md` → Events |
| Adding in-app notifications, subscriber-based alerts, writing notification renderers | `packages/core/AGENTS.md` → Notifications |
| Adding reactive notification handlers (`notifications.handlers.ts`), `useNotificationEffect`, auto side-effects on notification arrival | `packages/core/AGENTS.md` → Notifications + `packages/ui/AGENTS.md` |
| Injecting UI widgets into other modules, defining spot IDs, cross-module UI extensions | `packages/core/AGENTS.md` → Widgets |
| Building headless injection widgets (menu items, columns, fields), using `InjectionPosition`, or `useInjectionDataWidgets` | `packages/core/AGENTS.md` → Widget Injection + `packages/ui/AGENTS.md` |
| Injecting menu items into main/settings/profile sidebars or topbar/profile dropdown (`useInjectedMenuItems`, `mergeMenuItems`) | `packages/ui/AGENTS.md` |
| Adding API route interceptors (`api/interceptors.ts`, before/after hooks, body/query rewrite contracts) | `packages/core/AGENTS.md` → API Interceptors |
| Adding DataTable extension widgets (columns/row actions/bulk actions/filters) | `packages/core/AGENTS.md` → Widget Injection + `packages/ui/AGENTS.md` → DataTable Guidelines |
| Adding CrudForm field injection widgets (`crud-form:<entityId>:fields`) | `packages/core/AGENTS.md` → Widget Injection + `packages/ui/AGENTS.md` → CrudForm Guidelines |
| Replacing or wrapping UI components via `widgets/components.ts` (`replace`/`wrapper`/`props`) | `packages/core/AGENTS.md` → Component Replacement + `packages/ui/AGENTS.md` |
| Adding custom fields/entities, using DSL helpers (`defineLink`, `cf.*`), declaring `ce.ts` | `packages/core/AGENTS.md` → Custom Fields |
| Adding entity extensions, cross-module data links, `data/extensions.ts` | `packages/core/AGENTS.md` → Extensions |
| Configuring RBAC features in `acl.ts`, declarative guards, permission checks | `packages/core/AGENTS.md` → Access Control |
| Fixing wildcard ACL handling in feature-gated runtime helpers (menu items, nav sections, notification handlers, mutation guards, command interceptors, AI tools) | `packages/core/AGENTS.md` → Access Control + `packages/shared/AGENTS.md` + `packages/ui/AGENTS.md` + `packages/core/src/modules/auth/AGENTS.md` (+ `packages/core/src/modules/customer_accounts/AGENTS.md` for portal/customer RBAC) |
| Using encrypted queries (`findWithDecryption`), encryption defaults, GDPR fields | `packages/core/AGENTS.md` → Encryption |
| Adding response enrichers to enrich other modules' API responses | `packages/core/AGENTS.md` → Response Enrichers |
| Filtering CRUD list APIs by multiple IDs (`?ids=uuid1,uuid2`), including interceptor-driven ID narrowing | `packages/core/AGENTS.md` → API Interceptors + `packages/shared/AGENTS.md` |
| Adding DOM Event Bridge (SSE-based real-time events to browser), `useAppEvent`, `useOperationProgress` | `packages/events/AGENTS.md` → DOM Event Bridge |
| Building customer portal pages, portal auth, portal nav injection, portal event bridge | `packages/ui/AGENTS.md` → Portal Extension |
| Adding new widget event handlers (`onFieldChange`, `onBeforeNavigate`, transformers) | `packages/ui/AGENTS.md` |
| **Specific Modules** | |
| Managing people/companies/deals/activities, **copying CRUD patterns for new modules** | `packages/core/src/modules/customers/AGENTS.md` |
| Building orders/quotes/invoices, pricing calculations, document flow (Quote→Order→Invoice), shipments/payments, channel scoping | `packages/core/src/modules/sales/AGENTS.md` |
| Managing products/categories/variants, pricing resolvers (`selectBestPrice`), offers, channel-scoped pricing, option schemas | `packages/core/src/modules/catalog/AGENTS.md` |
| Users/roles/RBAC implementation, authentication flow, session management, feature-based access control | `packages/core/src/modules/auth/AGENTS.md` |
| Customer identity, customer portal auth (login/signup/magic links), customer RBAC, sessions, CRM auto-linking, admin user management | `packages/core/src/modules/customer_accounts/AGENTS.md` |
| Multi-currency support, exchange rates, dual currency recording, realized gains/losses | `packages/core/src/modules/currencies/AGENTS.md` |
| Workflow automation, defining step-based workflows, executing instances, user tasks, async activities, event triggers, signals, compensation (saga pattern), visual editor | `packages/core/src/modules/workflows/AGENTS.md` |
| Integration Marketplace foundation (registry/bundles, credentials, state, health checks, logs, admin UI, integration manifests) | `packages/core/src/modules/integrations/AGENTS.md` |
| Data Sync hub (adapters, run lifecycle, workers, mapping APIs, scheduled sync, progress linkage, admin UI) | `packages/core/src/modules/data_sync/AGENTS.md` |
| Building outbound/inbound webhooks, Standard Webhooks signing, delivery queues, webhook admin UI, marketplace webhook settings | `packages/webhooks/AGENTS.md` + `packages/queue/AGENTS.md` + `packages/events/AGENTS.md` + `packages/core/src/modules/integrations/AGENTS.md` + `packages/ui/AGENTS.md` |
| Building a new integration provider module (adapter, health check, credentials, bundle wiring) | `packages/core/src/modules/integrations/AGENTS.md` + `packages/core/src/modules/data_sync/AGENTS.md` + `.ai/skills/integration-builder/SKILL.md` + `.ai/specs/implemented/SPEC-041-2026-02-24-universal-module-extension-system.md` + `.ai/specs/implemented/SPEC-045-2026-02-24-integration-marketplace.md` + `.ai/specs/implemented/SPEC-045c-payment-shipping-hubs.md` (+ `.ai/specs/implemented/SPEC-044-2026-02-24-payment-gateway-integrations.md` for payment providers) |
| Wiring progress UX for long-running sync operations (top bar polling, job lifecycle, future SSE bridge) | `packages/core/src/modules/data_sync/AGENTS.md` + `packages/events/AGENTS.md` |
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
| Adding onboarding wizard steps, tenant setup hooks (`onTenantCreated`/`seedDefaults`), welcome/invitation emails | `packages/onboarding/AGENTS.md` |
| Adding static content pages (privacy policies, terms, legal pages) | `packages/content/AGENTS.md` |
| Testing standalone apps with Verdaccio, publishing packages, canary releases, template scaffolding | `packages/create-app/AGENTS.md` |
| **Migration** | |
| Migrating custom module code from MikroORM v6 to v7 (decorators, persist/flush, Knex→Kysely, type fixes, ORM config, Jest setup) | `.ai/skills/migrate-mikro-orm/SKILL.md` |
| **Testing** | |
| Integration testing, creating/running Playwright tests, converting markdown test cases to TypeScript, CI test pipeline | `.ai/qa/AGENTS.md` + `.ai/skills/integration-tests/SKILL.md` |
| **Spec Lifecycle** | |
| Analyzing a spec before implementation: BC impact, risk assessment, gap analysis, readiness report | `.ai/skills/pre-implement-spec/SKILL.md` |
| Implementing a spec (or specific phases) with coordinated agents, unit tests, docs, progress tracking | `.ai/skills/implement-spec/SKILL.md` |
| Writing new specs, updating existing specs after implementation, documenting architectural decisions, maintaining changelogs | `.ai/specs/AGENTS.md` |
| Reviewing code changes for architecture, security, conventions, and quality compliance | `.ai/skills/code-review/SKILL.md` |
| Migrating hardcoded colors/typography to semantic tokens, analyzing DS violations, scaffolding DS-compliant pages, reviewing DS compliance | `.ai/skills/ds-guardian/SKILL.md` |
| Reviewing a GitHub PR by number (checkout, code-review, submit review, apply label) | `.ai/skills/auto-review-pr/SKILL.md` |
| Scanning open PRs for merge readiness, listing what can be merged now, triaging blockers | `.ai/skills/merge-buddy/SKILL.md` |
| Day-start review triage: reviewing all unreviewed PRs (newest first) in one session | `.ai/skills/review-prs/SKILL.md` |
| Running an arbitrary autonomous task end-to-end and delivering it as a PR against `develop` (drafts a dated spec with a Progress checklist, commits it first, implements phase-by-phase with incremental commits, optionally honors external reference skills via `--skill-url`, runs the full validation gate, opens a PR with normalized pipeline labels) | `.ai/skills/auto-create-pr/SKILL.md` |
| Resuming an in-progress PR created by `auto-create-pr`: claims the PR, re-enters an isolated worktree, reads the linked spec's Progress checklist, and continues from the first unchecked step | `.ai/skills/auto-continue-pr/SKILL.md` |
| Post-merge housekeeping: syncing recently merged (and recently closed-unmerged) pull requests to the GitHub issue tracker — auto-closing issues they authoritatively fix via `fixes`/`closes`/`resolves` close-keywords or `closingIssuesReferences`, and leaving informational comments on issues whose PRs were closed without merging (with supersede detection) | `.ai/skills/sync-merged-pr-issues/SKILL.md` |
| Drafting a CHANGELOG.md release entry in the house emoji-driven format (✨ Features / 🔒 Security / 🐛 Fixes / 🛠️ Improvements / 🧪 Testing / 📝 Specs & Documentation / 🚀 CI/CD) for every PR merged since the last release and delegating the edit to `auto-create-pr` so it lands as a docs PR against `develop`; honors the Supersede Credit Rule so when `auto-review-pr` has carried a fork PR forward, the original contributor is credited instead of the reviewer | `.ai/skills/auto-update-changelog/SKILL.md` |

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
- A ready non-draft PR should carry `review` unless it is already in another pipeline state.
- `auto-review-pr` MUST move approved PRs to `qa` when `needs-qa` is present and `skip-qa` is absent; otherwise it MUST move them to `merge-queue`.
- `auto-review-pr` MUST move review failures to `changes-requested`.
- `needs-qa` is for UI changes, new features, sales or order flows, and other customer-facing behavior that needs manual exercise.
- `skip-qa` is for docs-only, dependency-only, CI-only, test-only, typo-only, or similarly low-risk non-customer-facing changes.
- Auto-skills that mutate PRs or issues MUST claim them first with all three signals: assignee, `in-progress` label, and a claim comment. They MUST release the `in-progress` label when finished, even on failure.
- When an auto-skill adds or changes a PR pipeline/meta label, it MUST also leave a short PR comment explaining why that label was applied.
- Use `gh` for manual QA transitions:

```bash
# QA pass
gh pr edit <number> --remove-label "qa" --add-label "merge-queue"

# QA fail
gh pr edit <number> --remove-label "qa" --add-label "qa-failed"

# Re-request QA after a fix
gh pr edit <number> --remove-label "qa-failed" --add-label "qa"
```

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
- MUST NOT add code directly in `apps/mercato/src/` — it's a boilerplate for user apps

### When You Need an Import

| Need | Import |
|------|--------|
| Command pattern (undo/redo) | `import { registerCommand } from '@open-mercato/shared/lib/commands'` |
| Server-side translations | `import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'` |
| Client-side translations | `import { useT } from '@open-mercato/shared/lib/i18n/context'` |
| Data engine types | `import type { DataEngine } from '@open-mercato/shared/lib/data/engine'` |
| Search config types | `import type { SearchModuleConfig } from '@open-mercato/shared/modules/search'` |
| Injection positioning | `import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'` |
| Headless injection widgets hook | `import { useInjectionDataWidgets } from '@open-mercato/ui/backend/injection/useInjectionDataWidgets'` |
| Menu injection hook | `import { useInjectedMenuItems } from '@open-mercato/ui/backend/injection/useInjectedMenuItems'` |
| Component replacement hook | `import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'` |
| UI primitives | `import { Spinner } from '@open-mercato/ui/primitives/spinner'` |
| Entity tag pill | `import { Tag } from '@open-mercato/ui/primitives/tag'` |
| Entity tag variant map | `import type { TagMap } from '@open-mercato/ui/primitives/tag'` |
| User / entity avatar | `import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'` |
| Keyboard shortcut key | `import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'` |
| API calls (backend pages) | `import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'` |
| CRUD forms | `import { CrudForm } from '@open-mercato/ui/backend/crud'` |
| API interceptor types | `import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'` |
| Response enricher types | `import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'` |
| App event hook | `import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'` |
| Event bridge hook | `import { useEventBridge } from '@open-mercato/ui/backend/injection/eventBridge'` |
| Operation progress hook | `import { useOperationProgress } from '@open-mercato/ui/backend/injection/useOperationProgress'` |
| Broadcast event check | `import { isBroadcastEvent } from '@open-mercato/shared/modules/events'` |
| Portal broadcast event check | `import { isPortalBroadcastEvent } from '@open-mercato/shared/modules/events'` |
| Portal customer auth hook | `import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'` |
| Portal tenant context hook | `import { useTenantContext } from '@open-mercato/ui/portal/hooks/useTenantContext'` |
| Portal shell (layout) | `import { PortalShell } from '@open-mercato/ui/portal/PortalShell'` |
| Portal menu injection hook | `import { usePortalInjectedMenuItems } from '@open-mercato/ui/portal/hooks/usePortalInjectedMenuItems'` |
| Portal event bridge hook | `import { usePortalEventBridge } from '@open-mercato/ui/portal/hooks/usePortalEventBridge'` |
| Portal app event hook | `import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'` |
| Customer auth types | `import type { CustomerAuthContext } from '@open-mercato/shared/modules/customer-auth'` |
| Customer auth server (cookies) | `import { getCustomerAuthFromCookies } from '@open-mercato/core/modules/customer_accounts/lib/customerAuthServer'` |

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
| `api/interceptors.ts` | `interceptors` | API route interception hooks (before/after) |
| `data/entities.ts` | — | MikroORM entities |
| `data/validators.ts` | — | Zod validation schemas |
| `data/extensions.ts` | `extensions` | Entity extensions (module links) |
| `widgets/injection/` | — | Injected UI widgets |
| `widgets/injection-table.ts` | — | Widget-to-slot mappings |
| `widgets/components.ts` | `componentOverrides` | Component replacement/wrapper/props override definitions |
| `data/enrichers.ts` | `enrichers` | Response enrichers for data federation |

### Key Rules

- API routes MUST export `openApi` for documentation generation
- CRUD routes: use `makeCrudRoute` with `indexer: { entityType }` for query index coverage
- Write operations: implement via the Command pattern (see `packages/core/src/modules/customers/commands/*`)
- Feature naming convention: `<module>.<action>` (e.g., `example.view`, `example.create`).
- setup.ts: always declare `defaultRoleFeatures` when adding features to `acl.ts`
- Every module with guarded routes or pages MUST declare features in `acl.ts` — never ship an empty `acl.ts` with `requireRoles` guards
- Custom fields: use `collectCustomFieldValues()` from `@open-mercato/ui/backend/utils/customFieldValues`
- Events: use `createModuleEvents()` with `as const` for typed emit
- Translations: when adding entities with user-facing text fields (title, name, description, label), create `translations.ts` at module root declaring translatable fields. Run `yarn generate` after adding.
- Widget injection: declare in `widgets/injection/`, map via `injection-table.ts`
- API interception: declare interceptors in `api/interceptors.ts`; keep hooks fail-closed and scoped by route + method
- Interceptors that narrow CRUD list results SHOULD prefer rewriting `query.ids` (comma-separated UUID list) instead of post-filtering response arrays
- Component replacement: use handle-based IDs (`page:*`, `data-table:*`, `crud-form:*`, `section:*`) for deterministic overrides
- Generated files: `apps/mercato/.mercato/generated/` — never edit manually
- Enable modules in your app’s `src/modules.ts` (e.g. `apps/mercato/src/modules.ts`)
- Run `yarn generate` after adding/modifying module files
- Agents MUST automatically run `yarn mercato configs cache structural --all-tenants` after enabling/disabling modules in `src/modules.ts`, adding/removing backend or frontend pages, or changing sidebar/navigation injection — stale `nav:*` cache can hide structural changes until it is purged
- New integration providers MUST own their env-backed preconfiguration inside the provider package: implement preset reading/application in the provider module, apply it from `setup.ts`, expose a rerunnable provider CLI command when practical, and document the env variables. Do not add provider-specific preconfiguration logic to core modules.

## Backward Compatibility Contract

> **Full specification**: [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md) — MUST be read before modifying any contract surface.

Third-party module developers depend on stable platform APIs. Any change to a **contract surface** is a breaking change that blocks merge unless the deprecation protocol is followed.

**Deprecation protocol** (summary): (1) never remove in one release, (2) add `@deprecated` JSDoc, (3) provide a bridge (re-export/alias/dual-emit) for ≥1 minor version, (4) document in RELEASE_NOTES.md, (5) reference a spec with "Migration & Backward Compatibility" section.

**13 contract surface categories** (details in `BACKWARD_COMPATIBILITY.md`):

| # | Surface | Classification | Key Rule |
|---|---------|---------------|----------|
| 1 | Auto-discovery file conventions | FROZEN | File names, export names, routing algorithms immutable |
| 2 | Type definitions & interfaces | STABLE | Required fields cannot be removed/narrowed; optional additive-only |
| 3 | Function signatures | STABLE | Cannot remove/reorder params; new optional params OK |
| 4 | Import paths | STABLE | Moved modules must re-export from old path |
| 5 | Event IDs | FROZEN | Cannot rename/remove; payload fields additive-only |
| 6 | Widget injection spot IDs | FROZEN | Cannot rename/remove; context fields additive-only |
| 7 | API route URLs | STABLE | Cannot rename/remove; response fields additive-only |
| 8 | Database schema | ADDITIVE-ONLY | No column/table rename/remove; new columns with defaults OK |
| 9 | DI service names | STABLE | Cannot rename registration keys |
| 10 | ACL feature IDs | FROZEN | Stored in DB; rename requires data migration |
| 11 | Notification type IDs | FROZEN | Referenced by subscribers and stored in DB |
| 12 | CLI commands | STABLE | Cannot rename/remove commands or required flags |
| 13 | Generated file contracts | STABLE | Export names and `BootstrapData` shape immutable |

## Critical Rules

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
-   Never hand-write migrations — update ORM entities, run `yarn db:generate`
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

### Colors
- NEVER use hardcoded Tailwind colors for status semantics (`text-red-*`, `bg-green-*`, `text-emerald-*`, `bg-blue-*`, `text-amber-*`, etc.)
- NEVER use hardcoded hex/rgb values in className — always use semantic tokens
- All semantic tokens have dedicated dark mode values — NO `dark:` overrides needed

Decision tree — ask "what color do I need?":

| Question | Answer | Token |
|----------|--------|-------|
| Is it a status indicator (error/success/warning/info/neutral)? | Yes → | `{property}-status-{status}-{role}` (e.g. `text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`) |
| Is it a destructive action button? | Yes → | `text-destructive`, `bg-destructive` |
| Is it primary text? | Yes → | `text-foreground` |
| Is it secondary/placeholder text? | Yes → | `text-muted-foreground` |
| Is it a primary action (button, link)? | Yes → | `bg-primary`, `text-primary-foreground` |
| Is it a subtle background (hover, accent)? | Yes → | `bg-secondary`, `bg-accent`, `bg-muted` |
| Is it a border? | Yes → | `border-border`, `border-input` |
| Is it a focus ring? | Yes → | `ring-ring` |
| Is it a card/popover surface? | Yes → | `bg-card`, `bg-popover` |
| Is it a chart/data visualization? | Yes → | `chart-blue`, `chart-emerald`, `chart-amber`, etc. |
| Is it brand accent? | Yes → | `brand-violet` |

Status token structure: `{property}-status-{status}-{role}` where status = `error`|`success`|`warning`|`info`|`neutral` and role = `bg`|`text`|`border`|`icon`.

### Brand Colors

Open Mercato has a distinct brand palette that is **separate from semantic tokens**. Brand colors express identity and must stay visible/consistent in specific contexts. Semantic tokens (`--foreground`, `--primary`, `--muted`, etc.) drive 99% of the UI — brand colors are reserved for brand moments.

#### The brand palette

| Token | Hex | Character |
|-------|-----|-----------|
| Brand Lime | `#D4F372` | Energetic, fresh — gradient start |
| Brand Yellow | `#EEFB63` | Optimistic, bright — gradient middle |
| Brand Violet | `#BC9AFF` | Innovative, AI, premium — gradient end |
| Brand Black | `#0C0C0C` | Hero moments, marketing typography |
| Brand Gray 700 | `#434343` | Secondary on brand light surfaces |
| Brand Gray 500 | `#B6B6B6` | Brand dividers |
| Brand Gray 100 | `#E7E7E7` | Subtle brand backgrounds |
| Brand White | `#FFFFFF` | Hero backgrounds |

Brand colors **do NOT flip in dark mode** — brand identity must stay recognizable across themes.

#### When to use brand colors (prescriptive)

| Use case | Token | Example |
|----------|-------|---------|
| **AI / intelligence touchpoints** (buttons, dots, chips marking AI features) | Brand Violet (`brand-violet` CSS token or `#BC9AFF`) | AiDot, "Ask AI" buttons, AI-generated content markers |
| **Custom views / perspectives pills** (user-created views saved by user) | `brand-violet` | `ViewChip`, `NewViewForm` checkmarks |
| **Floating feedback / onboarding widgets** | Full 3-stop gradient (`#D4F372 → #EEFB63 → #BC9AFF`) | `DemoFeedbackWidget`, welcome splash screens |
| **Hero sections on marketing / landing pages** | Full gradient OR Brand Lime as standalone hero bg | Landing page heroes, product announcement banners |
| **Loading / progress for AI operations** (not regular progress bars) | `brand-violet` or gradient stroke | AI task progress, generative content loading |
| **Splash / onboarding / success celebration moments** | Full gradient | First-time user experience, "You did it!" confetti |

#### When NOT to use brand colors (anti-patterns)

| DON'T | Use instead |
|-------|-------------|
| Status messages (error, success, warning, info) | Semantic status tokens (`bg-status-*`) |
| Regular CTA buttons (Save, Submit, Create) | `bg-primary` |
| Form inputs, checkboxes, toggles | Semantic tokens (`border-input`, `bg-primary` for checked) |
| Data tables, list rows, dividers | `bg-muted`, `border-border` |
| Sidebar navigation active state (non-AI) | `bg-accent`, `text-foreground` |
| Text body or headings (unless on a brand surface) | `text-foreground`, `text-muted-foreground` |
| Destructive actions / delete buttons | `bg-destructive` |
| Charts and data visualization | `chart-*` tokens |

Decision tree — ask "is this a brand moment?":

| Question | Answer | Token |
|----------|--------|-------|
| Is it flagging AI functionality or AI-generated content? | Yes → | `brand-violet` |
| Is it a user-saved view / perspective / custom entity pill? | Yes → | `brand-violet` (10% bg, 30% border, 100% text) |
| Is it a landing page hero, marketing banner, or splash screen? | Yes → | Full gradient `from-[#D4F372] via-[#EEFB63] to-[#BC9AFF]` |
| Is it a floating CTA widget (feedback, onboarding invite, celebration)? | Yes → | Full gradient |
| Is it a standard UI element in the backend admin (button, input, card, table)? | **No brand** → | Use semantic tokens (`primary`, `muted`, `border`, etc.) |
| Is it a status indicator (error/success/warning/info)? | **No brand** → | Use status tokens |

Rule of thumb: **If you're asking "should I use a brand color here?", the answer is almost always no**. Brand colors are reserved for specific identity moments — maybe 10-15 places in the entire app. If in doubt, use `primary` or `muted`.

#### Code imports & usage patterns

```tsx
// Brand violet — semantic CSS token (already defined in globals.css)
<div className="text-brand-violet" />
<div className="bg-brand-violet/10 border-brand-violet/30 text-brand-violet" />

// Brand gradient — inline style (only for floating widgets and hero sections)
<div style={{
  background: 'linear-gradient(135deg, #D4F372 0%, #EEFB63 50%, #BC9AFF 100%)',
}} />

// Brand neutrals — only on marketing / landing pages
// (no Tailwind utility — use inline style or add to a marketing-specific CSS module)
```

**MUST NOT**:
- Introduce a new `bg-lime-500` or `bg-[#D4F372]` utility for regular UI — the gradient is the brand, individual stops are not meant for solo use outside designated contexts
- Replace semantic tokens with brand colors to "make it look more branded"
- Apply brand colors to accessibility-critical elements (focus rings, error states) — they have their own tokens

### Corner Radius
- NEVER use arbitrary radius values (`rounded-[24px]`, `rounded-[32px]`, etc.)
- NEVER use `rounded-2xl` or `rounded-3xl` — use `rounded-xl` (16px) for large radius

Decision tree — ask "what am I rounding?":

| Question | Answer | Token |
|----------|--------|-------|
| Is it a pill / badge / avatar / toggle? | Yes → | `rounded-full` (999px) |
| Is it a large standalone card, hero section, or full-page panel (checkout, onboarding, landing)? | Yes → | `rounded-xl` (16px) |
| Is it a container that holds other elements (card, dialog, alert, section, tabs wrapper)? | Yes → | `rounded-lg` (10px) |
| Is it an interactive element the user clicks/types into (button, input, select, textarea, popover, dropdown, tooltip)? | Yes → | `rounded-md` (8px) |
| Is it a tiny inline element inside another component (checkbox, color dot, small chip)? | Yes → | `rounded-sm` (6px) |
| Do I need to remove radius entirely (table cells, flush edges)? | Yes → | `rounded-none` (0px) |

Rule of thumb: **the bigger the element, the bigger the radius**. Interactive controls = `md`, their containers = `lg`, standalone panels = `xl`.

### Typography
- NEVER use arbitrary text sizes (`text-[10px]`, `text-[11px]`, `text-[13px]`, `text-[15px]`)
- NEVER use arbitrary tracking (`tracking-[0.12em]`, `tracking-[0.24em]`) — use `tracking-widest` (0.1em) for uppercase labels
- USE Tailwind scale: `text-xs` (12px), `text-sm` (14px), `text-base` (16px), `text-lg` (18px), `text-xl` (20px), `text-2xl` (24px)
- For 11px uppercase labels: use `text-overline` (custom token)
- Exception: `text-[9px]` for notification badge count (single use case, documented)

Decision tree — ask "what text am I styling?":

| Question | Answer | Classes |
|----------|--------|---------|
| Is it the main page title (one per page)? | Yes → | `text-2xl font-bold tracking-tight` |
| Is it a major section heading? | Yes → | `text-xl font-semibold` |
| Is it a subsection / card title? | Yes → | `text-sm font-semibold` |
| Is it a form label? | Yes → | `text-sm font-medium` (use `Label` component) |
| Is it default body text? | Yes → | `text-sm` |
| Is it emphasized body text? | Yes → | `text-base` |
| Is it secondary info, timestamps, hints? | Yes → | `text-xs text-muted-foreground` |
| Is it a section label / category tag (uppercase)? | Yes → | `text-overline font-semibold uppercase tracking-widest` |
| Is it code / technical content? | Yes → | `text-sm font-mono` |

Rule of thumb: **`text-sm` (14px) is the default**. Go up for headings, down for captions. Never invent sizes in between.

### Feedback
- USE `Alert` for inline messages — NOT `Notice` (deprecated)
- USE `flash()` for transient toast messages
- USE `useConfirmDialog()` for destructive action confirmation
- Every list/data page MUST handle empty state via `<EmptyState>` or `emptyState` prop on DataTable
- Every async page MUST show loading state via `<LoadingMessage>`, `<Spinner>`, or `<DataLoader>`
- Alert variants: `default`, `destructive` (error), `success`, `warning`, `info`

### Spacing
- NEVER use arbitrary spacing values (`p-[13px]`, `gap-[10px]`, `mt-[7px]`, etc.)
- USE Tailwind 4px grid scale: `1` (4px), `2` (8px), `3` (12px), `4` (16px), `6` (24px), `8` (32px), `12` (48px)
- AVOID half-steps (`0.5`, `1.5`, `2.5`) unless matching a specific visual rhythm — they break the 4px grid

Decision tree — ask "what am I spacing?":

| Question | Answer | Classes |
|----------|--------|---------|
| Icon-to-text gap, chip internals, tight inline flex? | Yes → | `gap-1` (4px) or `gap-2` (8px) |
| Standard gap between inline/flex items (buttons in a row, form fields)? | Yes → | `gap-2` (8px) — **default** |
| Gap between distinct items in a list (cards, sections)? | Yes → | `gap-3` (12px) or `gap-4` (16px) |
| Padding inside an interactive control (button, input, select)? | Yes → | `px-3 py-2` (12px / 8px) |
| Padding inside a compact container (tag, inline panel, row)? | Yes → | `p-3` (12px) |
| Padding inside a card, section, or alert? | Yes → | `p-4` (16px) — **default for containers** |
| Padding inside a dialog, large card, or feature panel? | Yes → | `p-6` (24px) |
| Vertical stack of related items (form fields, list rows)? | Yes → | `space-y-2` (8px) |
| Vertical stack of distinct sections on a page? | Yes → | `space-y-4` (16px) or `space-y-6` (24px) |
| Page-level section separation (between page regions)? | Yes → | `space-y-8` (32px) or `py-8` |
| Margin below a heading / above its content? | Yes → | `mb-2` (8px) for inline, `mb-4` (16px) for sections |

Rule of thumb: **`gap-2` is the default for flex/grid, `p-4` is the default for containers, `space-y-2` for stacks**. Scale up (3 → 4 → 6 → 8) as the element grows in importance or visual weight.

The 4-step ladder — memorize this:

| Step | Value | What it separates |
|------|-------|-------------------|
| **Inline** | 8px (`2`) | Items inside a single control (icon+label, button contents) |
| **Compact** | 16px (`4`) | Items inside a container (form fields in a card, rows in a list) |
| **Section** | 24px (`6`) | Sections on a page (form sections, card groups) |
| **Region** | 32px (`8`) | Major page regions (header vs content, sidebar vs main) |

### Opacity & Transparency
- NEVER invent new opacity values ad hoc — stick to the DS scale
- NEVER use arbitrary opacity (`opacity-[0.33]`, `bg-black/[0.22]`)
- USE the standard values: `5`, `10`, `20`, `30`, `50`, `70`, `80`, `90`, `95`, `100`

Decision tree — ask "what am I making transparent and why?":

| Question | Answer | Value |
|----------|--------|-------|
| **Disabled state** on any control (button, input, link)? | Yes → | `disabled:opacity-50` |
| **Hover dim effect** (logo, icon, link going slightly translucent on hover)? | Yes → | `hover:opacity-80` |
| **Restore full opacity** (end state of a fade-in)? | Yes → | `opacity-100` |
| **Hidden but layout-preserving** (fade-in starting state)? | Yes → | `opacity-0` |
| **Modal / centered dialog backdrop**? | Yes → | `bg-black/50` |
| **Drawer / side panel backdrop** (lighter — content behind still readable)? | Yes → | `bg-black/20` |
| **Frosted surface** (sticky header, floating card over content)? | Yes → | `bg-background/80` |
| **Nearly-opaque surface** (card that must still blur the content behind)? | Yes → | `bg-background/95` |
| **Subtle tint** on a surface (muted background, zebra row)? | Yes → | `bg-muted/30` |
| **Medium tint** (hover/selected state on a list row)? | Yes → | `bg-muted/50` |
| **Very subtle highlight** (selected primary/destructive state)? | Yes → | `bg-primary/5` or `bg-destructive/5` |
| **Soft highlight** (active primary/destructive state)? | Yes → | `bg-primary/10` or `bg-destructive/10` |
| **Hover on primary/destructive button**? | Yes → | `bg-primary/90` or `bg-destructive/90` |
| **Softened border** (less contrast than default)? | Yes → | `border-border/70` |

Rule of thumb: **there is one right value per use case**. If you find yourself picking between `40`, `50`, and `60` for the "same kind of element," pick the one in the table — consistency beats micro-precision.

Standardized values per context:

| Context | Value | Why just one? |
|---------|-------|---------------|
| Disabled | `opacity-50` | Universal web convention |
| Hover dim | `opacity-80` | Noticeable but not jarring |
| Modal backdrop | `bg-black/50` | Focus attention, block content |
| Drawer backdrop | `bg-black/20` | Content still readable |
| Frosted surface | `bg-background/80` | Sufficient translucency |
| Subtle tint | `bg-muted/30` | Barely visible, not distracting |
| Medium tint | `bg-muted/50` | Clear but not overpowering |
| Softened border | `border-border/70` | Default when border needs to recede |

### Z-Index (Layering)
- NEVER use arbitrary z-index values (`z-[1000]`, `z-[9999]`, `z-[60]`, etc.)
- NEVER use numeric `z-10`/`z-20`/`z-40`/`z-50` for elements that overlap **other components** — use semantic tokens
- Numeric `z-*` is OK **only** for local stacking inside a single component (e.g. sticky footer inside a card, calendar focus, timeline marker)

Decision tree — ask "what is this element and what must it sit above?":

| Question | Answer | Token | Value |
|----------|--------|-------|-------|
| Is it normal page content (text, cards, tables)? | Yes → | no class / `z-base` | 0 |
| Is it a sticky header/footer that follows scroll? | Yes → | `z-sticky` | 10 |
| Is it a dropdown, popover, combobox suggestion list, or select menu? | Yes → | `z-dropdown` | 20 |
| Is it a semi-transparent backdrop sitting behind a modal/drawer? | Yes → | `z-overlay` | 30 |
| Is it a modal, dialog, drawer, or side panel? | Yes → | `z-modal` | 40 |
| Is it a toast / flash message? | Yes → | `z-toast` | 50 |
| Is it a tooltip (must stay above modals when hovering buttons inside them)? | Yes → | `z-tooltip` | 60 |
| Is it a global notice bar (cookie banner, system-wide announcement)? | Yes → | `z-banner` | 70 |
| Is it always-on-top UI (dev tools panel, AI chat debug, command palette)? | Yes → | `z-top` | 100 |

Rule of thumb: **ask what the element must visually sit above**, not how important it feels. Tooltip sits above everything (even modals) because you might hover a button *inside* a modal.

Tokens defined in `globals.css` as `--z-index-*` (Tailwind v4 convention). DO NOT add new numeric values — if you need a new layer, add a token to the scale.

### Shadows
- NEVER use arbitrary shadow values (`shadow-[...]`)
- NEVER use colored shadows (e.g. `shadow-violet-500/25`) except for brand-specific decorative elements (AI dot)

Decision tree — ask "what elevation does this element need?":

| Question | Answer | Token |
|----------|--------|-------|
| Is it a flat element with subtle depth (input, checkbox, button)? | Yes → | `shadow-xs` |
| Is it a card, panel, or section on a page? | Yes → | `shadow-sm` |
| Is it a hover state or slightly elevated card? | Yes → | `shadow-md` |
| Is it a dialog, overlay, or popover? | Yes → | `shadow-lg` |
| Is it a floating panel (dockable chat, side drawer)? | Yes → | `shadow-xl` |
| Is it the top-level modal or command palette? | Yes → | `shadow-2xl` |
| Do I need to remove a shadow (reset, flat style)? | Yes → | `shadow-none` |

Rule of thumb: **`shadow-sm` is the default for surfaces**. Each step up = more elevation/importance. Most elements need `shadow-xs` or `shadow-sm`.

### Motion & Transitions
- NEVER use arbitrary duration values (`duration-[250ms]`, etc.)
- NEVER use `transition` without specifying which property to transition — prefer `transition-colors`, `transition-opacity`, `transition-transform` over `transition-all`
- USE `transition-all` only when multiple unrelated properties change simultaneously

Decision tree — ask "what is animating?":

| Question | Answer | Classes |
|----------|--------|---------|
| Is it a hover color/background change? | Yes → | `transition-colors duration-150` |
| Is it a fade in/out? | Yes → | `transition-opacity duration-150` |
| Is it a rotation or scale change (chevron, icon)? | Yes → | `transition-transform duration-150` |
| Is it a dropdown/popover opening? | Yes → | `duration-200 ease-out` |
| Is it a dialog/modal opening? | Yes → | `duration-300 ease-out` |
| Is it a dialog/modal closing? | Yes → | `duration-200 ease-in` |
| Is it a loading spinner? | Yes → | `animate-spin` |
| Is it a loading placeholder? | Yes → | `animate-pulse` |
| Is it a panel sliding in? | Yes → | `animate-slide-in` (0.3s ease-out) |
| Is it an accordion/collapsible? | Yes → | `animate-accordion-down` / `animate-accordion-up` |

Duration rule: **150ms** for micro-interactions (hover, focus), **200ms** for standard transitions (dropdown, accordion), **300ms** for large layout changes (dialog, slide-in).

### Status Display
- USE `StatusBadge` for entity status display — NEVER hardcode colors on Badge
- Define a `StatusMap` per entity type in your module:
```typescript
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'

const dealStatusMap: StatusMap<'open' | 'won' | 'lost'> = {
  open: 'info',
  won: 'success',
  lost: 'error',
}
```

### Forms
- USE `FormField` wrapper for standalone forms (portal, auth, custom pages)
- CrudForm handles field layout internally — do NOT wrap CrudForm fields in FormField
- Every input MUST have a visible label (never placeholder-only)
- Error messages use `text-status-error-text` (FormField handles this automatically)

### Icons
- USE `lucide-react` for ALL UI icons — NEVER inline `<svg>` elements
- Icon sizes: `size-3` (12px), `size-4` (16px, default), `size-5` (20px), `size-6` (24px)
- Stroke width: 2 (lucide default) — do NOT override per-instance
- Icon-only buttons MUST have `aria-label`

Decision tree — ask "what icon do I need?":

| Question | Answer | Source |
|----------|--------|--------|
| Is it a UI icon (action, navigation, status, form element)? | Yes → | `lucide-react` |
| Is it a brand/logo (Stripe, Google, Apple, payment provider, social media)? | Yes → | SVG file in `public/brands/` or integration-provided asset |

- `lucide-react` = sole library for UI icons
- Brand/logo icons = standalone SVG files (not from an icon library) — each brand provides its own logo
- Figma DS has a Brand Icons reference page for designer use; in code, brand SVGs live in `public/brands/` or are provided by integration packages

### Sections
- USE `SectionHeader` for detail page section headers (title + count + action)
- USE `CollapsibleSection` when section content should be collapsible

### Components — quick reference
| I need to... | Use this |
|---|---|
| Show an error/success/warning message inline | `<Alert variant="destructive\|success\|warning\|info">` |
| Show a toast notification | `flash('message', 'success\|error\|warning\|info')` |
| Confirm a destructive action | `useConfirmDialog()` |
| Display entity status (active, draft, etc.) | `<StatusBadge variant={statusMap[status]} dot>` |
| Display a user-applied entity tag (Customer, Hot, Renewal) | `<Tag variant={tagMap[tag.type]} dot>` |
| Display a user / entity avatar with initials | `<Avatar name="Jan Kowalski" size="default">` |
| Display multiple avatars overlapping | `<AvatarStack max={4}><Avatar .../></AvatarStack>` |
| Show a keyboard shortcut hint | `<KbdShortcut keys={['⌘', 'Enter']}>` |
| Wrap a form field with label + error | `<FormField label="..." error={...}>` |
| Build a section header with count + action | `<SectionHeader title="..." count={n} action={...}>` |
| Build a collapsible section | `<CollapsibleSection title="...">content</CollapsibleSection>` |

### Reference Implementation
When building a new module UI, use the **customers module** as reference:
- List page: `packages/core/src/modules/customers/backend/customers/people/page.tsx`
- Detail page: `packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx`
- Create page: `packages/core/src/modules/customers/backend/customers/people/create/page.tsx`
- Status mapping: `packages/core/src/modules/customers/components/formConfig.tsx`

### Breakpoints (Responsive Design)
- NEVER use arbitrary media queries (`[min-width:850px]:...`) — stick to the Tailwind scale
- NEVER use `max-*` (desktop-first) — our approach is **mobile-first**, add larger breakpoints with `sm:` / `md:` / `lg:` / `xl:`
- USE the Tailwind scale: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px), `2xl` (1536px)

Breakpoint meaning in Open Mercato:

| Breakpoint | Px | What device / context |
|------------|-----|----------------------|
| (default) | <640 | Phone portrait — single column, stacked |
| `sm:` | 640+ | Phone landscape / small tablet — inline layouts OK |
| `md:` | 768+ | Tablet portrait / small laptop — **first 2-col layouts** |
| `lg:` | 1024+ | Desktop / tablet landscape — sidebar layouts, 3-col grids |
| `xl:` | 1280+ | Large desktop — 4-col grids, wider cards |
| `2xl:` | 1536+ | Ultra-wide — max content width cap (`max-w-screen-2xl`) |

Decision tree — ask "at what screen size should this layout change?":

| Question | Answer | Breakpoint |
|----------|--------|------------|
| Stacked buttons/labels → inline row (e.g. form actions)? | Yes → | `sm:flex-row sm:items-center` |
| Form field full-width → half-width side-by-side? | Yes → | `md:grid-cols-2` or `md:col-span-1` |
| Dashboard 1-col cards → 2-col layout? | Yes → | `md:grid-cols-2` — **not sm** (cards need room to breathe) |
| 2-col → 3-col dashboard layout? | Yes → | `lg:grid-cols-3` |
| Sidebar collapse / mobile drawer → always-visible sidebar? | Yes → | `lg:grid-cols-[240px_1fr]` (or `lg:hidden` on mobile trigger) |
| Need a 4th column for dense dashboards? | Yes → | `xl:grid-cols-4` |
| Constrain max content width to prevent ultra-wide stretching? | Yes → | `max-w-screen-2xl mx-auto` |
| Show/hide elements based on device? | Yes → | `hidden lg:block` (desktop only) or `lg:hidden` (mobile only) |

Rule of thumb: **`md:` is the first breakpoint for layout changes** (not `sm:`). `sm:` is for small inline tweaks (flex direction, button width, padding). `lg:` is where sidebar-heavy desktop layouts kick in.

Shell convention: **backend sidebar collapses at `lg:`** (1024px). Below that, a mobile drawer is shown. Portal follows the same pattern.

### Borders (Widths & Styles)
- NEVER use arbitrary border widths (`border-[3px]`, `border-[1.5px]`)
- USE the Tailwind scale: `border` (1px), `border-2` (2px), `border-4` (4px), `border-0` (reset)
- Always pair border width with a semantic color token (`border-border`, `border-input`, `border-status-*-border`, `border-destructive`)

Decision tree — ask "what is this border for?":

| Question | Answer | Classes |
|----------|--------|---------|
| Standard container edge (card, input, dialog, section divider)? | Yes → | `border border-border` (1px) — **default** |
| Input/form control edge? | Yes → | `border border-input` (1px, slightly more prominent than `border-border`) |
| Active tab indicator (bottom underline)? | Yes → | `border-b-2 border-primary` or `border-b-2 border-foreground` |
| Selected / active state emphasis (full boundary)? | Yes → | `border-2 border-primary` or `border-2 border-ring` |
| Left-accent indicator (notices, quoted sections, status highlights)? | Yes → | `border-l-4 border-status-{status}-border` |
| Empty state / placeholder / drop zone? | Yes → | `border border-dashed border-border` |
| Horizontal divider between sections? | Yes → | `border-t border-border` (use `<Separator>` component when possible) |
| Error state on input? | Yes → | `aria-invalid:border-destructive` (don't toggle manually) |
| Remove default border? | Yes → | `border-0` or `border-none` |

Rule of thumb: **`border` (1px) is the answer 99% of the time**. Only go thicker for deliberate emphasis — active states (2px), left-accent indicators (4px).

Never use hardcoded Tailwind color shades for borders (`border-gray-300`, `border-slate-200`, `border-blue-500`) — use semantic tokens instead.

### Focus States (Accessibility)
- NEVER use `focus:` for rings/outline — use `focus-visible:` so rings only appear during keyboard navigation (not mouse clicks)
- NEVER use hardcoded focus colors (`focus-visible:ring-blue-500`, `focus-visible:border-blue-500`, `focus-visible:ring-red-500`)
- USE the `--ring` token via `focus-visible:ring-ring` — it has dedicated dark mode values
- USE `aria-invalid:` for error state rings (not `focus-visible:ring-red-*`)

Standard focus recipe (copy-paste for custom focusable elements):

```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
```

Decision tree — ask "what focus treatment does this element need?":

| Question | Answer | Classes |
|----------|--------|---------|
| Is it a Button / Input / Select / standard form control? | Yes → | Already handled by the primitive — don't reinvent |
| Is it a custom focusable element (div with tabIndex, link, interactive row)? | Yes → | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| Is it inside a tight layout where offset-2 overflows (tag chips, compact toolbars)? | Yes → | Use `focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0` |
| Is it a field in error state needing a red focus ring? | Yes → | Combine with `aria-invalid:ring-destructive aria-invalid:ring-2` |
| Is it a menu item / dropdown item (should highlight on mouse too)? | Yes → | `focus:bg-accent focus:text-accent-foreground` (without `-visible`) |
| Do I need to completely disable focus ring? | Yes → | `focus-visible:ring-0` (rare — accessibility concern) |

Rule of thumb: **ring on `focus-visible:` for accessibility, bg/text on `focus:` for visual affordance**. Keyboard users get the ring; mouse users don't need it.

Ring size: `ring-2` for most elements, `ring-1` for compact/inline, `ring-[3px]` never (not in DS scale).

### Dark Mode
- NEVER add `dark:` overrides on semantic tokens (`text-foreground`, `bg-muted`, `bg-card`, `border-border`, etc.) — they already flip in dark mode
- NEVER add `dark:` overrides on status tokens (`bg-status-*`, `text-status-*`, `border-status-*`) — they have dedicated dark mode values
- NEVER pair hardcoded Tailwind status colors with `dark:` fallbacks (e.g. `bg-amber-50 dark:bg-amber-950/40`) — migrate to status tokens instead

Legitimate `dark:` use cases (the only allowed ones):
- `dark:prose-invert` — Tailwind Typography plugin (content module)
- shadcn primitives that touch `--input` directly (`dark:bg-input/30`, `dark:border-input`) — part of component internals
- Brand/decorative colors that genuinely need different dark values (violet AI dot, rare cases)

If you find yourself writing `dark:{something}`, first check whether a semantic token already handles that context. 99% of the time, the answer is yes.

### Boy Scout Rule
When modifying a file that contains hardcoded status colors (`text-red-*`, `bg-green-*`, etc.), arbitrary text sizes (`text-[11px]`), or `dark:` overrides on status colors, you MUST migrate at minimum the lines you touched to semantic tokens.

## Key Commands

```bash
yarn dev                  # Start compact dev runtime; press `d` to toggle raw logs
yarn dev:verbose          # Start dev runtime with full raw passthrough logs
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
