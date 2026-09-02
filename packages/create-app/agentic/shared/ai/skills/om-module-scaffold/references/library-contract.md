# Complete Library Contract

Load this reference only when the selected blueprint row is the complete library app, or when a case declares it directly. It is a bounded worked contract for that single domain.

When the selected row is the complete library app, do a final source-level check against this bounded contract before generation; do not generalize these library IDs into other domains:

The required procedures plus this bounded contract resolve the library slice's framework choices. Do not route `framework-context` or load its resolver for this slice; spend that context on the three mandatory complete-module references instead.

- Export and default-export `features` with exact IDs `library.books.view` and `library.books.manage`. Export `setup: ModuleSetupConfig = { defaultRoleFeatures }`; a detached `defaultRoleFeatures` export is not discovered setup.
- Use entity ID `library:book`. The `makeCrudRoute` ORM keys are `tenantField` and `orgField`; its list keys are `schema`, `buildFilters`, and `transformItem`. Keep response transforms in supported `response` callbacks, register `library.books.create`, `library.books.update`, and `library.books.delete` with concrete `registerCommand(...)` calls, and use the installed `createCrudOpenApiFactory` signature exactly.
- Keep custom fields in the framework data engine rather than an entity JSON column. Submission calls `collectCustomFieldValues`; snapshots call `loadCustomFieldSnapshot`; update and delete undo each call `buildCustomFieldResetMap` and restore through `setCustomFields` in the same `withAtomicFlush` boundary.
- Each command object owns its calls: create/update/delete undo call `extractUndoPayload` from `@open-mercato/shared/lib/commands/undo` and `emitCrudUndoSideEffects`; update/delete execute call the object-form `enforceCommandOptimisticLock`. Direct book reads call a scoped helper from `@open-mercato/shared/lib/encryption/find`.
- Export `searchConfig` using `fieldPolicy`, `buildSource` with `checksumSource`, `formatResult`, and `resolveUrl`. The list UI connects `searchValue`/`onSearchChange` to the API `search` filter and exposes add, linked edit, and guarded delete actions.
- Put Jest command/undo proof in `commands/__tests__/` with imports from `@jest/globals`, and put every visible `library.*` key in `i18n/en.json`. Run generation, the focused test, and typecheck; fix every diagnostic instead of leaving a plausible sketch.
- Keep the first implementation bounded to the required Books vertical slice. Use one `commands/books.ts` with typed `CommandHandler<Input, Result>` objects and keep every transaction, lock, undo, reset-map, and side-effect call inside its owning exported command object—do not hide oracle-significant behavior in shared helpers. Avoid optional locales, standalone widget/event/enricher files, or extra entities until the required slice generates, tests, and typechecks.
- Do not guess imports or add unsupported convenience options. In particular, `features` needs no invented ACL type, a CRUD list has no `find`, `response` is a callback rather than a schema, `useConfirmDialog` comes from `@open-mercato/ui/backend/confirm-dialog`, and search checksum data is the inline `checksumSource` object rather than a helper import. Re-open the exact reference for any remaining signature before writing it.
- A current `CommandHandler<Input, Result>` implements `execute(input, ctx)` and returns `Result` directly. It captures undo state with `prepare(input, ctx)`, `captureAfter(input, result, ctx)`, and `buildLog({ result, snapshots })`; never destructure `{ input, ctx }` in `execute` or return `{ result, undo }`. Lock with `enforceCommandOptimisticLock({ resourceKind, resourceId, current, expected, request: ctx.request })`.
- Treat every lifecycle signature as a compile-time contract, not pseudocode. Use method syntax exactly as shown below: `async prepare(input, ctx)`, `async execute(input, ctx)`, and `async captureAfter(input, result, ctx)`. The only lifecycle callback that receives an object containing `input` is `buildLog({ input, result, ctx, snapshots })`; `undo` receives `{ input, ctx, logEntry }`. Never write `execute: async ({ input, ctx })`, `prepare: async ({ input, ctx })`, or `captureAfter: async ({ result })`.
- Import only `loadCustomFieldSnapshot` and `buildCustomFieldResetMap` from `@open-mercato/shared/lib/commands/customFieldSnapshots`; call the former with `(em, { entityId, recordId, tenantId, organizationId })`. Persist through `dataEngine.setCustomFields({ entityId, recordId, tenantId, organizationId, values, notify: false })`; there is no shared `lib/data/custom-fields` helper and UI-only `collectCustomFieldValues` never belongs in a command.
- Normalize command-side `Record<string, unknown>` custom-field payloads with `normalizeCustomFieldValues` from `@open-mercato/shared/lib/commands/helpers` before passing them to `dataEngine.setCustomFields`; do not cast an unknown-valued record to satisfy its primitive-value contract.
- The concrete direct-book finder calls `findOneWithDecryption(em, Book, { id, tenant_id, organization_id }, undefined, { tenantId, organizationId })` and rejects null. Do not attach a decryption finder to `makeCrudRoute`; its QueryEngine already decrypts the list.
- Import `Input` from `@open-mercato/ui/primitives/input` and use shared `Input`, `Button`, and `Alert` primitives for any filter/retry controls—never raw `<input>` or `<button>`. Do not create any test outside `commands/__tests__/` until typecheck is green; avoid speculative API tests, and express database uniqueness in the reviewed migration rather than an unsupported `unique` option on `@Index`.

Use this shape literally for the command lifecycle and direct read, filling in the mutations and snapshots without changing the signatures:

```ts
const findBook = async (em: EntityManager, id: string, scope: Scope) => {
  const book = await findOneWithDecryption(
    em,
    Book,
    { id, tenant_id: scope.tenantId, organization_id: scope.organizationId },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!book) throw new Error('library.book_not_found')
  return book
}

export const updateBook: CommandHandler<UpdateInput, Result> = {
  id: 'library.books.update',
  async prepare(input, ctx) { /* return { before } */ },
  async execute(input, ctx) { /* mutate atomically; return { id, updatedAt } */ },
  async captureAfter(input, result, ctx) { /* return after snapshot */ },
  buildLog({ input, result, ctx, snapshots }) { /* store snapshots in payload.undo */ },
  async undo({ input, ctx, logEntry }) { /* extract payload, call buildCustomFieldResetMap, restore, emit undo effects */ },
}
```

Create and delete use these exact same lifecycle signatures; do not convert any of them to single-argument arrow callbacks. Delete undo must call `buildCustomFieldResetMap` inside the delete command before restoring custom fields; create/update/delete undo each call `extractUndoPayload` and `emitCrudUndoSideEffects` inside their own object.

Before stopping, run `yarn generate` and then `yarn typecheck`. Any diagnostic mentioning a lifecycle property on the input type (for example, “Property 'input' does not exist on type …”) proves a callback was incorrectly destructured: repair all create/update/delete callbacks to the method signatures above and rerun until the typecheck is silent. Then run the command test; a written-but-unchecked module is not complete.
