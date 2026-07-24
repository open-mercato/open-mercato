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
