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
- USE semantic tokens: `text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`, `text-status-info-icon`
- Status token structure: `{property}-status-{status}-{role}` where status = error|success|warning|info|neutral and role = bg|text|border|icon
- For destructive actions (buttons, not status display): use existing `destructive` token (`text-destructive`, `bg-destructive`)
- All status tokens have dedicated dark mode values — NO `dark:` overrides needed

### Typography
- NEVER use arbitrary text sizes (`text-[11px]`, `text-[13px]`, `text-[15px]`)
- USE Tailwind scale: `text-xs` (12px), `text-sm` (14px), `text-base` (16px), `text-lg` (18px), `text-xl` (20px), `text-2xl` (24px)
- For 11px uppercase labels: use `text-overline` (custom token)
- Exception: `text-[9px]` for notification badge count (single use case)

### Typography Hierarchy
| Role | HTML | Tailwind | When to use |
|------|------|----------|-------------|
| Page title | `<h1>` | `text-2xl font-bold tracking-tight` | Page header (one per page) |
| Section title | `<h2>` | `text-xl font-semibold` | Major sections |
| Subsection | `<h3>` | `text-sm font-semibold` | Detail page sections, card titles |
| Body | `<p>` | `text-sm` | Default body text |
| Body large | `<p>` | `text-base` | Emphasized body |
| Caption | `<span>` | `text-xs text-muted-foreground` | Secondary info, timestamps |
| Label | `<label>` | `text-sm font-medium` | Form labels (via Label component) |
| Overline | `<span>` | `text-overline font-semibold uppercase tracking-wider` | Section labels, category tags |
| Code | `<code>` | `text-sm font-mono` | Code snippets |

### Feedback
- USE `Alert` for inline messages — NOT `Notice` (deprecated)
- USE `flash()` for transient toast messages
- USE `useConfirmDialog()` for destructive action confirmation
- Every list/data page MUST handle empty state via `<EmptyState>` or `emptyState` prop on DataTable
- Every async page MUST show loading state via `<LoadingMessage>`, `<Spinner>`, or `<DataLoader>`
- Alert variants: `default`, `destructive` (error), `success`, `warning`, `info`

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
- USE `lucide-react` for ALL icons — NEVER inline `<svg>` elements
- Icon sizes: `size-3` (12px), `size-4` (16px, default), `size-5` (20px), `size-6` (24px)
- Stroke width: 2 (lucide default) — do NOT override per-instance
- Icon-only buttons MUST have `aria-label`

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
| Wrap a form field with label + error | `<FormField label="..." error={...}>` |
| Build a section header with count + action | `<SectionHeader title="..." count={n} action={...}>` |
| Build a collapsible section | `<CollapsibleSection title="...">content</CollapsibleSection>` |

### Reference Implementation
When building a new module UI, use the **customers module** as reference:
- List page: `packages/core/src/modules/customers/backend/customers/people/page.tsx`
- Detail page: `packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx`
- Create page: `packages/core/src/modules/customers/backend/customers/people/create/page.tsx`
- Status mapping: `packages/core/src/modules/customers/components/formConfig.tsx`

### Boy Scout Rule
When modifying a file that contains hardcoded status colors (`text-red-*`, `bg-green-*`, etc.) or arbitrary text sizes (`text-[11px]`), you MUST migrate at minimum the lines you touched to semantic tokens.

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
