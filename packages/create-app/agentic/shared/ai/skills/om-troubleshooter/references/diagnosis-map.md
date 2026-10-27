# Diagnosis Map

Load the matching row only.

| Failure | First trace |
|---|---|
| Scope/auth/401 loop | Auth-derived tenant/org, all-org mode, wildcard features, alternate route metadata. |
| Lost/partial write | Validator/command, transaction/atomic flush, optimistic lock, post-commit side effects. |
| Field round trip | Form ID/initial value, payload validator, command mapping, entity nullability, response transform. |
| Generated/import failure | Discovery filename/exports, `src/modules.ts`, generation warnings, package exports/installed dist. |
| Browser/CLI/worker mismatch | Each bootstrap's registry/DI init, generated imports, chunk-global identity. |
| Cache/search stale | Command aliases, tags/invalidation, undo/sub-resource path, convergence/reindex. |
| Hydration/navigation UI | Locale/timezone/env first render, page metadata, stable IDs, auth versus visibility. |
| Provider sync | Idempotency, signature, retry class, cursor commit, mapping, webhook/poll race, reconciliation. |

Trace from the public call site to the first broken invariant. Avoid broad refactors until the oracle proves the location.

## Known-good comparison points

When a row's invariant is unclear, diff the broken call site against the one compiling reference the app already ships (source-present, runtime-disabled):

| Row | Compare against |
|---|---|
| Scope/auth/401 loop | [`api/customer-priorities/route.ts`](../../../../src/modules/example/api/customer-priorities/route.ts), [`commands/todos.ts`](../../../../src/modules/example/commands/todos.ts) |
| Lost/partial write, field round trip | [`commands/todos.ts`](../../../../src/modules/example/commands/todos.ts), [`data/validators.ts`](../../../../src/modules/example/data/validators.ts), [`backend/todos/[id]/edit/page.tsx`](../../../../src/modules/example/backend/todos/%5Bid%5D/edit/page.tsx) |
| Generated/import failure | [`index.ts`](../../../../src/modules/example/index.ts), [`src/modules.ts`](../../../../src/modules.ts), [`widgets/injection-table.ts`](../../../../src/modules/example/widgets/injection-table.ts) |
| Hydration/navigation UI, page metadata | [`backend/todos/page.meta.ts`](../../../../src/modules/example/backend/todos/page.meta.ts), [`components/TodosTable.tsx`](../../../../src/modules/example/components/TodosTable.tsx) |

The example's own tests are repository-only and are not emitted into this app; write your regression oracle with `references/regression-oracles.md`. Cache/search stale and provider-sync rows have no example counterpart — resolve those against installed source through `om-framework-context`.
