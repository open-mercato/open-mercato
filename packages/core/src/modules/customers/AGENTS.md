# Customers Module — Agent Guidelines

The customers module is the **reference implementation** for CRUD modules. When building new modules, copy patterns from here.

## Data Model

- **People** — individual customers (name, email, phone, addresses)
- **Companies** — business customers (name, tax ID, addresses)
- **Deals** — sales opportunities linked to people/companies
- **Activities** — logged interactions (calls, emails, meetings)
- **Todos** — action items assigned to users
- **Tags** — categorization labels
- **Comments** — notes on customer records
- **Addresses** — multi-address support per person/company

## Key Reference Files

Copy these patterns when building new modules:

| Pattern | Reference File |
|---------|---------------|
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

Forms use `collectCustomFieldValues()` from `@open-mercato/ui/backend/utils/customFieldValues`:
- Pass `{ transform }` to normalize values (e.g., `normalizeCustomFieldSubmitValue`)
- Works for both `cf_` and `cf:` prefixed keys
- Pass `entityIds` to form helpers so correct custom-field sets are loaded

## Search Configuration

`search.ts` demonstrates all three search strategies:
- `fieldPolicy` for fulltext indexing
- `buildSource` for vector embeddings
- `formatResult` for human-friendly search result presentation

## Backend Page Structure

- **List page**: `DataTable` with filters, search, export, row actions
- **Create page**: `CrudForm` with fields, groups, custom fields
- **Detail page**: Tabbed layout with entity data, related entities, activities, timeline

## Module Files

All standard module files are present — use as reference for the complete set:
`acl.ts`, `ce.ts`, `di.ts`, `events.ts`, `index.ts`, `notifications.ts`, `search.ts`, `setup.ts`, `analytics.ts`, `vector.ts`
