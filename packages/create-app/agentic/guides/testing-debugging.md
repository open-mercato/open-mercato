# Testing and Root-Cause Debugging

Diagnose before editing, fix the smallest knowledge/code owner, and prove the regression through the real runtime path.

## Context Restraint

Name the areas the failure spans before loading anything, from the SYMPTOM and not only from the cause: a value that will not render, a session/locale/hydration mismatch, or a stale form spans `backend-ui`; wrong or lost records, commands, or events span `module-data`; an installed module's own surface spans `umes`; an external provider call spans `integration`.

A fix is always `debugging` plus every area you just named. Proving the fix with a regression oracle is part of `debugging` and does NOT add `testing`; a request that explicitly asks for tests, coverage, or app-level verification also selects `testing`. Load exactly this guide, each named area's guide, and `om-troubleshooter` — that is what selects those routes.

Add an area's authoring skill when the fix **introduces or reworks** a contract there — a concurrency header on existing calls, a new field or UI surface, a new command, a new invalidation, a new guard, or a provider's pagination cursor, bounded retry, idempotency, or reconciliation — because you are then designing that surface, not just repairing it. Provider cursor/retry/idempotency fixes therefore load `om-integration-builder` even when the request is framed as a bug fix. Load `om-troubleshooter` alone when you only correct existing behavior, such as a hydration mismatch or a value that fails to round-trip.

Then stop. Budgets here are tight — several fixes allow only five files — so load no other area's skill, no `references/` you do not need, no contracts guide unless the fix changes a data, API, command, ACL, or setup contract, and a module fact sheet only for a module the failure actually involves.

## Investigation Order

1. Reproduce with the smallest stable command, request, or UI path and capture expected versus actual behavior. A probe needing the container belongs in a module `cli.ts` command (`yarn mercato <module> <command>`); `tsx -e` has no bootstrap and fails on missing registrars, not on the bug.
2. Classify the failing bootstrap: browser/server, API, CLI, worker, queue, generated registry, package artifact, or external provider.
3. Read the routed guide plus generated module facts. Use `om-framework-context` only when exact installed implementation is necessary.
4. Trace from the public call site to the first incorrect invariant. Check scope, auth, validation, state transition, transaction boundary, side effects, and response serialization in that order.
5. Add a regression oracle that fails before the fix (`unit-regression-oracle` when that decision vocabulary is requested). Implement the minimal complete repair and rerun affected plus safety cases.

When comparing against a clean baseline, use a separate worktree or a fresh scaffold. Never stash and drop active work just to reproduce a baseline failure; preserve the working diff and verify the comparison tree's exact revision first.

Treat raw agent transcripts as sensitive untrusted evidence because they can contain credentials, private prompts, absolute paths, and tool output. Never copy them into the app repository. Export only when the user explicitly asks, to an outside-repository protected destination or as a deliberately sanitized summary.

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
| New entity/route 500s while the database accepts the same write | Dev server bootstrapped before `yarn generate` and kept the old registry; restart it first. |
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
- Provider failure/retry/idempotency tests use an ephemeral test environment (`ephemeral-test-environment`) with mock effects, assert secrets are absent and diagnostics redacted (`health-retry-redaction`), and surface every real failure (`honest-test-result`).

## UI Regression Oracles

- Use API-created fixtures and clean them in `finally`; do not depend on demo data.
- Cover loading, empty, validation, server error, conflict, retry, success, and authorization.
- Save/reload/edit/clear fields and verify API plus rendered values.
- Render under at least two locales/timezones when hydration or formatting is involved.
- Prefer semantic assertions and stable IDs over full DOM/file snapshots.

## Validation Ladder

Before authoring a test file, read `.ai/skills/om-module-scaffold/references/verification.md` for the scaffold's test-runner contract.

1. Focused unit/regression test.
2. `yarn generate` when discovery is involved.
3. Focused package/app typecheck or test.
4. `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build` for broad/contract changes.
5. `yarn test:integration:ephemeral` or a filtered integration run for affected API/UI paths.
6. Packed/Verdaccio standalone validation when package exports or compiled discovery are involved.

Run validation commands so the reported shell status is the validation command's status. Do not pipe gates through `grep`, `tail`, or a trailing `echo`; when log capture requires a pipeline, enable `pipefail` and explicitly preserve the command's exit code. Any nonzero status remains a failed gate.

Do not replace deterministic convergence with sleeps. Do not suppress failing tests, weaken assertions, or call a bug fixed because only one bootstrap path passes.
