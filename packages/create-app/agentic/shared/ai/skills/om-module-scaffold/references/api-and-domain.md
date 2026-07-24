# API and Domain Writes

Load this reference for CRUD, commands, and action routes.

1. Implement create/update/delete as commands with audit/undo/event/cache/index side effects.
2. Create `api/<resource>/route.ts`; export per-method `metadata`, the selected factory handlers, and matching `openApi`.
3. Build current `makeCrudRoute` options: `metadata`, `orm`, `list`, `actions: { create, update, delete }`, and `indexer`. Add `enrichers` only for an intentional host.
4. Include `updated_at` in the list/detail projection and serialize `updatedAt`. Keep stable response keys and colon-form entity IDs.
5. Validate all query/body data. Reject malformed ID/filter values and derive tenant/org scope from context.
6. For a non-factory action, run mutation guards, enforce aggregate optimistic lock, dispatch a command, then run callbacks/side effects only after commit.
7. Test allowed/denied/wildcard users, two scopes, malformed input, stale version, and action retry/undo.

Use exact installed `customers` route/command patterns when a signature is uncertain; do not use the obsolete flat CRUD action options or HTTP-method directory routes.
