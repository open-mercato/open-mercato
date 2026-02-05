# Agents Guidelines

This repository is designed for extensibility. Agents should leverage the module system and follow strict naming and coding conventions to keep the system consistent and safe to extend.

## Task Router — Where to Find Detailed Guidance

Before starting work, check this table and read the relevant guide.

| Task | Guide |
|------|-------|
| **Module Development** | |
| Creating a new module | `packages/core/AGENTS.md` |
| Building API routes / OpenAPI specs | `packages/core/AGENTS.md` → API Routes |
| Adding module setup.ts / role features | `packages/core/AGENTS.md` → Module Setup |
| Adding events to a module | `packages/core/AGENTS.md` → Events |
| Adding notifications | `packages/core/AGENTS.md` → Notifications |
| Adding widget injection | `packages/core/AGENTS.md` → Widgets |
| Custom fields / custom entities | `packages/core/AGENTS.md` → Custom Fields |
| **Specific Modules** | |
| Customers (people, companies, deals) | `packages/core/src/modules/customers/AGENTS.md` |
| Sales (orders, quotes, pricing) | `packages/core/src/modules/sales/AGENTS.md` |
| Catalog (products, pricing, channels) | `packages/core/src/modules/catalog/AGENTS.md` |
| Auth (users, roles, RBAC) | `packages/core/src/modules/auth/AGENTS.md` |
| **Packages** | |
| Shared utilities, data engine, i18n | `packages/shared/AGENTS.md` |
| UI components, forms, tables | `packages/ui/AGENTS.md` |
| Search configuration & indexing | `packages/search/AGENTS.md` |
| AI assistant, MCP server | `packages/ai-assistant/AGENTS.md` |
| CLI, generators, migrations | `packages/cli/AGENTS.md` |
| Event bus, pub/sub | `packages/events/AGENTS.md` |
| Caching (Redis/SQLite/memory) | `packages/cache/AGENTS.md` |
| Job queues (local/BullMQ) | `packages/queue/AGENTS.md` |
| Onboarding wizards | `packages/onboarding/AGENTS.md` |
| Content management | `packages/content/AGENTS.md` |
| Standalone apps & Verdaccio testing | `packages/create-app/AGENTS.md` |
| **Other** | |
| Writing or updating specs | `.ai/specs/AGENTS.md` |

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Workflow Orchestration

1. **Spec-first**: Enter plan mode for non-trivial tasks (3+ steps or architectural decisions). Check `.ai/specs/` before coding; create SPEC files for new features (`SPEC-{number}-{date}-{title}.md`). Skip for small fixes/improvements.
2. **Subagent strategy**: Use subagents liberally to keep main context clean. Offload research and parallel analysis. One task per subagent.
3. **Self-improvement**: After corrections, update `.ai/lessons.md` or relevant AGENTS.md. Write rules that prevent the same mistake.
4. **Verification**: Run tests, check build, suggest user verification. Ask: "Would a staff engineer approve this?"
5. **Elegance**: For non-trivial changes, pause and ask "is there a more elegant way?" Skip for simple fixes.
6. **Autonomous bug fixing**: When given a bug report, just fix it. Point at logs/errors, then resolve. Zero hand-holding.

### Documentation and Specifications

- Specs live in `.ai/specs/` — see `.ai/specs/AGENTS.md` for naming, structure, and changelog conventions.
- Always check for existing specs before modifying a module. Update specs when implementing significant changes.

## Monorepo Structure

### Apps (`apps/`)

- **mercato**: Main Next.js app. User-created modules go in `apps/mercato/src/modules/`.
- **docs**: Documentation site.

### Packages (`packages/`)

All packages use the `@open-mercato/<package>` naming convention:

| Package | Import | Description |
|---------|--------|-------------|
| **shared** | `@open-mercato/shared` | Core utilities, types, DSL helpers, i18n, testing, commands, data engine |
| **ui** | `@open-mercato/ui` | UI components, primitives, backend components, forms, data tables |
| **core** | `@open-mercato/core` | Core business modules (auth, catalog, customers, sales, etc.) |
| **cli** | `@open-mercato/cli` | CLI tooling and commands |
| **cache** | `@open-mercato/cache` | Multi-strategy cache service with tag-based invalidation |
| **queue** | `@open-mercato/queue` | Multi-strategy job queue (local, BullMQ) |
| **events** | `@open-mercato/events` | Event bus and pub/sub infrastructure |
| **search** | `@open-mercato/search` | Search module (fulltext, vector, tokens strategies) |
| **ai-assistant** | `@open-mercato/ai-assistant` | AI assistant and MCP server |
| **content** | `@open-mercato/content` | Content management module |
| **onboarding** | `@open-mercato/onboarding` | Onboarding flows and wizards |

### Where to Put Code

- Core platform features → `packages/<package>/src/modules/<module>/`
- Shared utilities and types → `packages/shared/src/lib/` or `packages/shared/src/modules/`
- UI components → `packages/ui/src/`
- User/app-specific modules → `apps/mercato/src/modules/<module>/`
- Avoid adding code directly in `apps/mercato/src/` — it's a boilerplate for user apps

### Common Import Patterns

```typescript
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { SearchModuleConfig } from '@open-mercato/shared/modules/search'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { CrudForm } from '@open-mercato/ui/backend/crud'
```

## Conventions

- Modules: plural, snake_case (folders and `id`). Special cases: `auth`, `example`.
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
| `setup.ts` | `setup: ModuleSetupConfig` | Tenant initialization, role features |
| `ce.ts` | `entities` | Custom entities / custom field sets |
| `search.ts` | `searchConfig` | Search indexing configuration |
| `events.ts` | `eventsConfig` | Typed event declarations |
| `notifications.ts` | `notificationTypes` | Notification type definitions |
| `notifications.client.ts` | — | Client-side notification renderers |
| `ai-tools.ts` | `aiTools` | MCP AI tool definitions |
| `data/entities.ts` | — | MikroORM entities |
| `data/validators.ts` | — | Zod validation schemas |
| `data/extensions.ts` | `extensions` | Entity extensions (module links) |
| `widgets/injection/` | — | Injected UI widgets |
| `widgets/injection-table.ts` | — | Widget-to-slot mappings |

### Key Rules

- API routes MUST export `openApi` for documentation generation
- CRUD routes: use `makeCrudRoute` with `indexer: { entityType }` for query index coverage
- setup.ts: always declare `defaultRoleFeatures` when adding features to `acl.ts`
- Custom fields: use `collectCustomFieldValues()` from `@open-mercato/ui/backend/utils/customFieldValues`
- Events: use `createModuleEvents()` with `as const` for typed emit
- Widget injection: declare in `widgets/injection/`, map via `injection-table.ts`
- Generated files: `apps/mercato/.mercato/generated/` — never edit manually
- Run `npm run modules:prepare` after adding/modifying module files

## Critical Rules

### Architecture

- **NO direct ORM relationships between modules** — use foreign key IDs, fetch separately
- Always filter by `organization_id` for tenant-scoped entities
- Never expose cross-tenant data from API handlers
- Use DI (Awilix) to inject services; avoid `new`-ing directly
- Modules must remain isomorphic and independent
- When extending another module's data, add a separate extension entity and declare a link in `data/extensions.ts`

### Data & Security

- Validate all inputs with zod; place validators in `data/validators.ts`
- Derive TypeScript types from zod via `z.infer<typeof schema>`
- Use `findWithDecryption`/`findOneWithDecryption` instead of `em.find`/`em.findOne`
- Never hand-write migrations — update ORM entities, run `yarn db:generate`
- Hash passwords with bcryptjs (cost >=10), never log credentials
- Return minimal error messages for auth (avoid revealing whether email exists)
- RBAC: prefer declarative guards (`requireAuth`, `requireRoles`, `requireFeatures`) in page metadata

### UI & HTTP

- Use `apiCall`/`apiCallOrThrow`/`readApiResultOrThrow` from `@open-mercato/ui/backend/utils/apiCall` — never use raw `fetch`
- For CRUD forms: `createCrud`/`updateCrud`/`deleteCrud` (auto-handle `raiseCrudError`)
- For local validation errors: throw `createCrudFormError(message, fieldErrors?)` from `@open-mercato/ui/backend/utils/serverErrors`
- Read JSON defensively: `readJsonSafe(response, fallback)` — never `.json().catch(() => ...)`
- Use `LoadingMessage`/`ErrorMessage` from `@open-mercato/ui/backend/detail`
- i18n: `useT()` client-side, `resolveTranslations()` server-side
- Never hard-code user-facing strings — use locale files
- Every dialog: `Cmd/Ctrl+Enter` submit, `Escape` cancel
- Keep `pageSize` at or below 100

### Code Quality

- No `any` types — use zod schemas with `z.infer`, narrow with runtime checks
- Prefer functional, data-first utilities over classes
- No one-letter variable names, no inline comments (self-documenting code)
- Don't add docstrings/comments/type annotations to code you didn't change
- Boolean parsing: use `parseBooleanToken`/`parseBooleanWithDefault` from `@open-mercato/shared/lib/boolean`
- Confirm project still builds after changes

## Key Commands

```bash
yarn dev                  # Start development server
yarn build                # Build everything
yarn build:packages       # Build packages only
yarn lint                 # Lint all packages
yarn test                 # Run tests
yarn generate             # Run module generators
yarn db:generate          # Generate database migrations
yarn db:migrate           # Apply database migrations
yarn initialize           # Full project initialization
yarn dev:greenfield       # Fresh dev environment setup
```
