# `example` — canonical reference module

**This module does not run.** Its source ships in every built-in scaffold (`classic`, `empty`, `crm`) so you can read a real, compiling implementation of every framework extension point, but it is **not** listed in `src/modules.ts`. No route, page, migration, seed, ACL grant, event, widget, worker, or navigation entry is loaded until you explicitly enable it.

To run it locally (for inspection only, never as a starting point for your own feature):

```ts
// src/modules.ts
export default [
  { id: 'example', from: '@app' },
]
```

Then generate the runtime registries and apply this module's committed migrations before starting the app:

```bash
yarn generate
yarn db:migrate
```

`yarn generate` never applies migrations automatically. If the app was initialized before you enabled `example`, skipping `yarn db:migrate` leaves the Todo routes active without their `todos` table.

## Do not copy this tree

`example` is deliberately broad because it also serves as the platform's QA surface. It contains demo pages, probe routes, and mock adapters that must never appear in a product module.

- **Never** copy the whole tree, or copy a file "because it is in `example`".
- Copy **one** capability at a time, from the exact file listed in the surface map.
- Some files are marked `qa-only` and must not be used as a pattern at all — see below.

## Start here: capability lookup

Do not browse this directory. Look your capability up first:

- **[`references/surface-map.md`](references/surface-map.md)** — human navigation view, grouped by capability area, with the exact file(s) for each row.
- **[`references/surface-inventory.json`](references/surface-inventory.json)** — the same rows, machine-readable, with `capabilityId`, `readStatus`, `sourcePaths`, `integrationTestPaths`, `dependencyModules`, and `ruleOwner`.

Read only the files your capability row names. The **rule owner** named on each row (a skill or guide) is authoritative for *what you must do*; `example` only shows *one compiling way to do it*.

## Read status

Every row carries a `readStatus`:

| `readStatus` | Meaning |
|---|---|
| `readable` | The file passed the reference-quality audit. Safe to read and adapt. |
| `qa-only` | The file exists and works, but fails at least one current project rule. Read the row's `qaOnlyReason`, then follow the rule owner instead. Do **not** copy it. |

`qa-only` rows are still listed so the inventory stays honest about what this module contains. They are not a green light.

## Copy / adapt checklist

When you lift a capability out of `example`, rename **all** of the following before the code is yours. Leaving any `example` identifier in place will collide with this module the moment someone enables it.

1. **Module id** — directory name and `metadata.name` in `index.ts`. Use plural `snake_case` (`example` → `invoices`, `service_tickets`). Never reuse `example`.
2. **Entity id** — `example:todo` → `<module>:<entity>`. Update `ce.ts`, `indexer.entityType`, `entityId` props on `DataTable`/`CrudForm`, and every query-engine call.
3. **ORM table names** — `todos`, `example_items`, `example_customer_priorities` → your own tables. Generate a fresh migration with `yarn db:generate`; do not copy `migrations/**`.
4. **Route paths** — `/api/example/*` and `/backend/todos/*` → your module's paths. API route folders are derived from the module directory.
5. **Command ids** — `example.todos.create|update|delete` → `<module>.<entity>.<action>`.
6. **Event ids** — `example.todo.created|updated|deleted` → `<module>.<entity>.<past-tense-action>`.
7. **Widget ids and injection spot ids** — `example.injection.*`, `example.dashboard.*`, and any `example:*` spot key.
8. **ACL feature ids** — `example.backend`, `example.view`, `example.todos.*`, `example.widgets.*` → `<module>.*`. Update `acl.ts`, `setup.ts` role grants, and every `requireFeatures` in `page.meta.ts` and route `metadata`.
9. **i18n keys** — `example.*` in `i18n/*.json` → `<module>.*`. Ship every locale file the project already has.
10. **Notification type ids** — `example.umes.actionable` and its handler id.

Then check the non-negotiables that `example` demonstrates and your copy must keep: tenant/organization scoping on every read and write, Zod validation in `data/validators.ts`, command-mediated mutations, `updated_at` + optimistic locking on user-editable entities, `apiCall`/`CrudForm` helpers instead of raw `fetch`, translated strings, and semantic design tokens instead of raw Tailwind colors.

## Reference-quality gate

A file is marked `readable` only if it passes all five checks:

1. Tenant/organization scoping on every lookup and mutation.
2. No raw `.json().catch(...)` — use `readJsonSafe` / the shared API helpers.
3. No hard-coded Tailwind status colors (`text-red-*`, `bg-green-*`, `text-amber-*`, …).
4. No `any` shortcut where a runtime-narrowed type is possible. This fires on a file-scope `no-explicit-any` disable, `any` in an exported signature, or `as any` used to reach a container/ORM/DB handle. A single localized property probe on a third-party union type that is immediately runtime-checked is recorded as a note instead.
5. No hard-coded user-facing strings — JSX text, user-visible JSX attributes (`label`, `title`, `placeholder`, `aria-label`, …), and `toast.*` calls must route through `t(...)`. Unprefixed internal `throw new Error(...)` assertions are recorded as notes (they should carry the `[internal]` prefix) rather than failing the gate.

The surface map lists the exact defect for every `qa-only` row and the outstanding notes for `readable` rows.

## Scope

`example` owns one minimal, real declaration per mechanism. It is **not** the authority for production provider internals, workflow orchestration, mutation-capable AI, or portal authentication — those rows route to their owning skill and to exact installed sources under `node_modules/@open-mercato/**`.
