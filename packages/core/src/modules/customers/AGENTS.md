# Customers Module — Agent Guidelines

**This is the reference CRUD module.** When building new modules, copy patterns from here first.

## MUST Rules

1. **MUST use this module as the template** for new CRUD modules — copy file structure and patterns
2. **MUST include all standard module files** — use the list below as a checklist
3. **MUST use `makeCrudRoute` with `indexer: { entityType }`** for query index coverage
4. **MUST wire custom field helpers** for create/update/response normalization
5. **MUST capture custom field snapshots** in command `before`/`after` payloads for undo support
6. **MUST use `useGuardedMutation` for non-`CrudForm` backend writes** (`POST`/`PUT`/`PATCH`/`DELETE`) and pass `retryLastMutation` in injection context

## Key Reference Files — Copy From Here

| When you need | Copy from |
|---------------|-----------|
| CRUD API route | `api/people/route.ts` |
| Undoable commands | `commands/people.ts` |
| Backend list page | `backend/customers/people/page.tsx` |
| Backend create page | `backend/customers/people/create/page.tsx` |
| Backend detail page | `backend/customers/people/[id]/page.tsx` |
| OpenAPI helper | `api/openapi.ts` |
| Custom field integration | `api/people/route.ts` (create/update flows) |
| Search config | `search.ts` |
| Events declaration | `events.ts` |
| Module setup | `setup.ts` |
| ACL features | `acl.ts` |
| Custom entities | `ce.ts` |
| DI registrar | `di.ts` |

## Data Model Constraints

- **People** — individual customers. MUST have name; email/phone optional but searchable
- **Companies** — business customers. MUST have name; tax ID optional
- **Deals** — sales opportunities. MUST link to a person or company
- **Activities** — logged interactions. MUST reference the parent entity
- **Todos** — action items. MUST have an assigned user
- **Comments** — notes on records. MUST reference the parent entity
- **Addresses** — multi-address support. MUST link to person or company via FK

## New Entity Checklist For Agents

When creating a new entity or CRUD slice, copy the customers module structure first, then align with `packages/core/AGENTS.md` and `packages/cli/AGENTS.md`.

1. Define MikroORM v7 entities in `data/entities.ts` with decorators imported from `@mikro-orm/decorators/legacy`.
2. Use UUID primary keys, snake_case table/column names, `organization_id`, `tenant_id`, and standard timestamp/soft-delete columns.
3. Add validators, commands, CRUD route, backend pages, ACL, setup grants, events, search, and translations as applicable.
4. Generate or author the migration for only this entity change, then update the module's `migrations/.snapshot-open-mercato.json`.
5. Run `yarn db:generate` again as a no-op check; expected output for the touched module is `no changes`.

## CRUD API Pattern

The CRUD factory API route (`api/people/route.ts`) demonstrates:

1. Using `makeCrudRoute` with `indexer: { entityType }` for query index coverage
2. Wiring custom field helpers for create/update/response normalization
3. Query engine integration for filtering, pagination, sorting
4. Scoped payloads with `withScopedPayload`
5. OpenAPI export for API documentation

## Undoable Commands Pattern

Commands (`commands/people.ts`) demonstrate:

1. Create/update/delete with undo support
2. Custom field snapshot capture in `before`/`after` payloads (`snapshot.custom`)
3. Restore via `buildCustomFieldResetMap(before.custom, after.custom)` in undo
4. Side effects with `emitCrudSideEffects` and `emitCrudUndoSideEffects`
5. Include `indexer: { entityType, cacheAliases }` in both directions

## Custom Field Integration

Use `collectCustomFieldValues()` from `@open-mercato/ui/backend/utils/customFieldValues`:
- Pass `{ transform }` to normalize values (e.g., `normalizeCustomFieldSubmitValue`)
- Works for both `cf_` and `cf:` prefixed keys
- Pass `entityIds` to form helpers so correct custom-field sets are loaded
- If the module ships default custom fields, declare them in `ce.ts` via `entities[].fields` so `yarn mercato entities install` can repair existing tenants.

## Search Configuration

`search.ts` demonstrates all three search strategies:
- `fieldPolicy` for fulltext indexing
- `buildSource` for vector embeddings
- `formatResult` for human-friendly search result presentation

## Backend Page Structure

- **List page**: `DataTable` with filters, search, export, row actions
- **Create page**: `CrudForm` with fields, groups, custom fields
- **Detail page**: Tabbed layout with entity data, related entities, activities, timeline

## Module Files Checklist — All MUST Be Present

`acl.ts`, `ce.ts`, `di.ts`, `events.ts`, `index.ts`, `notifications.ts`, `search.ts`, `setup.ts`, `analytics.ts`, `vector.ts`

## AI Agents in This Module

This module is the reference implementation for the AI framework. Copy `ai-agents.ts` + `ai-tools.ts` when adding AI agents to other modules. See `/framework/ai-assistant/agents` for the full guide.

| Agent ID | Mode | Policy | Purpose |
|----------|------|--------|---------|
| `customers.account_assistant` | chat | read-only (mutation-capable via per-tenant override that unlocks `customers.update_deal_stage`; see `packages/core/src/modules/customers/ai-agents.ts` for the whitelist and prompt) | Operator-facing assistant that explores people, companies, deals, activities, tasks, addresses, tags, and settings through the customers tool pack. |
| `customers.update_deal_stage` | tool (mutation) | `destructive-confirm-required` — goes through `prepareMutation` + the approval card | Moves a deal between stages / flips status between open, won, lost. Declared via `defineAiTool` in `ai-tools.ts` and exposed only when the tenant mutation-policy override promotes the agent above read-only. |

`<AiChat agent="customers.account_assistant" />` is injected in two places (both live in `widgets/injection/`):
- People list: `data-table:customers.people.list:header` via the `ai-assistant-trigger` widget.
- Deal detail: `detail:customers.deal:header` via the `ai-deal-detail-trigger` widget.
