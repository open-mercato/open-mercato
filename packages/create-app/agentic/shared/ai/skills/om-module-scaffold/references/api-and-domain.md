# API and Domain Writes

Load this reference for CRUD, commands, and action routes.

Before writing a route or command, read `node_modules/@open-mercato/shared/AGENTS.md`. It is
the authority for this layer's import paths and carries MUST rules that are easy to violate
by writing something that merely compiles — in particular: use the `badRequest` / `forbidden`
/ `notFound` / `conflict` / `assertFound` helpers from
`@open-mercato/shared/lib/crud/errors` rather than hand-rolling `new CrudHttpError(404, …)`;
read encrypted columns through `@open-mercato/shared/lib/encryption/find`; and never `$ilike`
a column an encryption map covers — use `@open-mercato/shared/lib/search/tokenLookup`.

There is no `@open-mercato/shared/lib/http/types`. A hand-written route handler takes the
platform `Request` (`export async function GET(request: Request)`) and returns a platform
`Response`; a dynamic segment arrives as a second argument,
`(request: Request, ctx: { params?: { id?: string } })`.

1. Implement create/update/delete as command objects with stable IDs and call `registerCommand` from `@open-mercato/shared/lib/commands` for each object. A route action naming a command ID does not register it. Include audit/undo/event/cache/index side effects.
2. Create `src/modules/<moduleId>/api/<resource>/route.ts`; generated discovery mounts it at `/api/<moduleId>/<resource>`. Import `makeCrudRoute` from `@open-mercato/shared/lib/crud/factory`, then export per-method `metadata`, the selected factory handlers, and matching `openApi`. Smoke-test the generated URL rather than assuming a hyphenated or module-less path.
3. Build current `makeCrudRoute` options: `metadata`, `orm`, `list`, `actions: { create, update, delete }`, and `indexer`. Each command action uses `commandId`, `schema`, optional `mapInput`, `response`, and `status`—never a `command` key. Add `enrichers: { entityId: '<module>:<entity>' }` only when the route intentionally publishes that stable host contract; keep the colon-form ID aligned with the UI/widget host and test injected read/write round trips. Export `openApi` separately—it is not a factory option—and build it with `createCrudOpenApiFactory`/`createPagedListResponseSchema` from `@open-mercato/shared/lib/openapi/crud` or a typed `OpenApiRouteDoc` from `@open-mercato/shared/lib/openapi`.
   - Exact current ORM keys are `entity`, `idField`, `tenantField`, `orgField`, and `softDeleteField` (not `organizationField`).
   - The list query validator key is `schema` (not `querySchema`). Exact current callbacks are `buildFilters(query, ctx)` and `transformItem(item)` (not `findMany`, `filters`, or `transform`); there is no `findAndCount` key. Projections use database field names such as `tenant_id`, `organization_id`, and `updated_at`.
   - The factory applies trusted tenant/organization scope from the ORM keys. Public request schemas never accept `tenantId` or `organizationId`; runtime scope comes only from the trusted request/command context. `buildFilters` adds only validated business filters; do not read nullable `ctx.auth` merely to repeat scope. Commands derive required trusted scope and fail closed.
   - `mapInput` receives `{ parsed, raw, ctx }`; use `({ parsed }) => parsed` when no route adaptation is needed. `response` is a callback receiving `{ result, logEntry, ctx }`, never a response schema.
   - `createCrudOpenApiFactory({ defaultTag: '<Tag>' })` returns a builder. Call that builder with `resourceName`, `querySchema`, `listResponseSchema`, and optional `create`/`update`/`del` objects containing Zod `schema`, optional `responseSchema`, and `description`; the key is not `body`. Do not pass resource options to the factory itself.
   - A manual `OpenApiRouteDoc` nests HTTP method docs under `methods`, for example `const openApi: OpenApiRouteDoc = { methods: { GET: { summary, tags, responses } } }`; `GET` is uppercase but is not a top-level `GET` key.
4. Include `updated_at` in the list/detail projection and serialize `updatedAt`. Keep stable response keys and colon-form entity IDs.
5. Validate all query/body data. Reject malformed ID/filter values and derive tenant/org scope from context.
6. For a non-factory action, run mutation guards and return their rejection response when blocked. Merge any `modifiedPayload` into the validated input, parse the merged value again with the route schema, enforce the aggregate optimistic lock, and dispatch the command with that revised input. A direct `commandBus.execute(commandId, options)` resolves the envelope `{ result, logEntry }`, not the command's own return value: read `.result` before serializing or iterating it, exactly as the factory's `response` callback does. Run returned after-success callbacks and other external side effects only after the mutation commits.
7. Test allowed/denied/wildcard users, two scopes, malformed input, stale version, and action retry/undo.

Command IDs in `actions` are stable strings; a route does not import command implementations merely to declare them. Use exact installed `customers` route/command patterns when a remaining signature is uncertain; do not use the obsolete flat CRUD action options or HTTP-method directory routes.

## Canonical example source

| Capability | Exact file |
|---|---|
| Smallest complete `makeCrudRoute` (per-method ACL, ORM/scope/soft-delete, list schema + sort map, `mapToEntity`/`applyToEntity`) | [`api/customer-priorities/route.ts`](../../../../src/modules/example/api/customer-priorities/route.ts) |
| Query-engine list fields, `cf:*` projection, command-backed `actions`, CSV export | [`api/todos/route.ts`](../../../../src/modules/example/api/todos/route.ts) |
| Module OpenAPI factory | [`api/openapi.ts`](../../../../src/modules/example/api/openapi.ts) |
| Hand-written route with its own request container and cookie auth | [`api/organizations/route.ts`](../../../../src/modules/example/api/organizations/route.ts) |
| `optionsUrl` option-source routes | [`api/tags/route.ts`](../../../../src/modules/example/api/tags/route.ts), [`api/assignees/route.ts`](../../../../src/modules/example/api/assignees/route.ts) |
| Registered command handlers, `ensureScope`, `prepare` snapshots, undo/redo | [`commands/todos.ts`](../../../../src/modules/example/commands/todos.ts) |

Adapt one row at a time and rename every `example` identifier; see [`README.md`](../../../../src/modules/example/README.md).
