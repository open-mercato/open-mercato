# Testing and Root-Cause Debugging

Diagnose before editing, fix the smallest knowledge/code owner, and prove the regression through the real runtime path.

## Investigation Order

1. Reproduce with the smallest stable command, request, or UI path and capture expected versus actual behavior.
2. Classify the failing bootstrap: browser/server, API, CLI, worker, queue, generated registry, package artifact, or external provider.
3. Read the routed guide plus generated module facts. Use `om-framework-context` only when exact installed implementation is necessary.
4. Trace from the public call site to the first incorrect invariant. Check scope, auth, validation, state transition, transaction boundary, side effects, and response serialization in that order.
5. Add a regression oracle that fails before the fix. Implement the minimal complete repair and rerun affected plus safety cases.

## Frequent Failure Families

| Symptom | Check first |
|---|---|
| 401 loop/all-organizations failure | Null-scope behavior, session refresh ownership, and fail-closed versus intentionally global paths. |
| Missing/extra tenant data | Every query/write/filter/cache/job payload; scope derived from auth, not body. |
| Field does not save/clear | Validator → command → entity → response transform → form initial value; truthy/default fallbacks. |
| Concurrent update overwrites | `updated_at` projection, client header, aggregate command guard, conflict surface. |
| Partial state after failure | Transaction/`withAtomicFlush`, query between mutation/flush, side effects before commit. |
| Stale list/search | Command side-effect aliases, cache tags/invalidation, query-index convergence/reindex. |
| Works in web but not CLI/worker | Bootstrap/registry initialization, package exports, generated imports, runtime scope. |
| Duplicate registry/provider | Bundler chunk singleton or `instanceof`; use global registry/structural guard. |
| Hydration mismatch | Server/client locale, timezone, randomness, browser-only environment, initial async state. |
| UI access differs from API/PDF/export | Compare every alternate route's metadata/features and wildcard matching. |
| Provider loses/duplicates records | Idempotency key, cursor commit point, webhook/poll race, external mapping and reconciliation. |

## Generated and Package Diagnostics

- Never edit generated output to prove a theory. Inspect the source discovery path, run `yarn generate`, and compare the affected registry entry.
- When an app imports a symbol but workspace tests pass, inspect package exports and packed/installed `dist` plus types.
- Search ignored installed source only through the bounded resolver output. Record resolved package versions and fact stamps.
- If a stale chunk/cache is suspected, prove the source/generator is correct before using the app's documented reset escape hatch.

## Data and Security Regression Oracles

- Create fixtures for two tenants and two organizations; assert allowed, denied, null-scope, and wildcard-feature behavior.
- Inject failure between multi-phase writes; assert no partial rows/state and no premature event/cache/index side effect.
- Exercise update and delete with current, stale, and missing versions.
- Test malformed IDs/filters and ensure invalid input cannot widen a query.
- Test retry, duplicate delivery, cancellation, and worker restart for external/queued operations.
- For provider logs/errors, assert secrets and credentials are absent.

## UI Regression Oracles

- Use API-created fixtures and clean them in `finally`; do not depend on demo data.
- Cover loading, empty, validation, server error, conflict, retry, success, and authorization.
- Save/reload/edit/clear fields and verify API plus rendered values.
- Render under at least two locales/timezones when hydration or formatting is involved.
- Prefer semantic assertions and stable IDs over full DOM/file snapshots.

## Validation Ladder

1. Focused unit/regression test.
2. `yarn generate` when discovery is involved.
3. Focused package/app typecheck or test.
4. `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build` for broad/contract changes.
5. `yarn test:integration:ephemeral` or a filtered integration run for affected API/UI paths.
6. Packed/Verdaccio standalone validation when package exports or compiled discovery are involved.

Do not replace deterministic convergence with sleeps. Do not suppress failing tests, weaken assertions, or call a bug fixed because only one bootstrap path passes.
