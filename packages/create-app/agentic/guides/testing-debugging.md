# Testing and Root-Cause Debugging

Diagnose before editing; fix smallest knowledge/code owner; prove real-runtime regression.

## Context Restraint

Before context, name all SYMPTOM areas, not just cause: non-rendering values/session-locale-hydration mismatch/stale form → `backend-ui`; wrong/lost records, commands, events → `module-data`; installed-owned surface → `umes`; external provider call → `integration`.

Fix: `debugging` + all named areas; regression oracles alone do NOT add `testing`. A request that explicitly asks for tests, coverage, or app-level verification also selects `testing`. Load exactly this guide, named area guides, and `om-troubleshooter` for routing.

Add authoring skills only for **introduced/reworked** contracts: concurrency headers on existing calls; new fields/UI/commands/invalidation/guards; provider pagination cursors/bounded retries/idempotency/reconciliation. Provider cursor/retry/idempotency fixes therefore load `om-integration-builder`, even as bug fixes. Existing behavior corrections (hydration/value round-trip): `om-troubleshooter` alone.

Stop: some fixes allow only five files. No unrelated skills/unneeded `references/`; contracts guide only for changed data/API/command/ACL/setup contracts; facts only for involved modules.

## Investigation Order

1. Reproduce the smallest stable command/request/UI path; capture expected/actual. Container probes: module `cli.ts` commands (`yarn mercato <module> <command>`); `tsx -e` lacks bootstrap: missing registrars are not the bug.
2. Bootstrap: browser/server, API, CLI, worker, queue, generated registry, package artifact, external provider.
3. Read routed guides/module facts; `om-framework-context` only if exact installed implementation is needed.
4. Trace public call to first wrong invariant: scope → auth → validation → state transition → transaction boundary → side effects → response serialization, in order.
5. Add a failing-before-fix oracle (`unit-regression-oracle` when that decision vocabulary is requested); make the minimal complete repair; rerun affected and safety cases.

For baselines, use a separate worktree or a fresh scaffold. Never stash and drop active work; preserve its diff and verify the comparison tree's exact revision first.

Raw agent transcripts: sensitive/untrusted (credentials/private prompts/absolute paths/tool output). Never copy them into the app repository. Export only when the user explicitly asks, to a protected outside-repository destination or as a deliberately sanitized summary.

## Frequent Failure Families

| Symptom | Check first |
|---|---|
| 401 loop/all-organizations failure | Null scope, session refresh ownership, fail-closed vs intentionally global paths. |
| Missing/extra tenant data | Every query/write/filter/cache/job payload; auth-derived scope, never body. |
| Field does not save/clear | Validator → command → entity → response transform → form initial value; truthy/default fallbacks. |
| Concurrent update overwrites | `updated_at` projection, client header, aggregate command guard, conflict surface. |
| Partial state after failure | Transaction/`withAtomicFlush`, query between mutation/flush, side effects before commit. |
| Stale list/search | Command side-effect aliases, cache tags/invalidation, query-index convergence/reindex. |
| Works in web but not CLI/worker | Bootstrap/registry initialization, package exports, generated imports, runtime scope. |
| New entity/route 500s but same database write succeeds | Dev boot before `yarn generate` retained old registry; restart first. |
| Duplicate registry/provider | Bundler chunk singleton or `instanceof`; global registry/structural guard. |
| Hydration mismatch | Server/client locale, timezone, randomness, browser-only environment, initial async state. |
| UI access differs from API/PDF/export | Every alternate route's metadata/features and wildcard matching. |
| Provider loses/duplicates records | Idempotency key, cursor commit, webhook/poll race, external mapping, reconciliation. |

## Generated and Package Diagnostics

- Never edit generated output to prove a theory. Inspect source discovery, run `yarn generate`, compare the affected registry entry.
- App-only import failure: inspect exports, packed/installed `dist`, types.
- Ignored installed source: bounded resolver output only; record resolved versions/fact stamps.
- Prove source/generator correct before documented chunk/cache reset.

## Data and Security Regression Oracles

- Fixture two tenants/two organizations; assert allowed/denied/null-scope/wildcard-feature behavior.
- Inject failure between multi-phase writes: no partial rows/state or premature event/cache/index effects.
- Update/delete with current/stale/missing versions.
- Malformed IDs/filters must not widen queries.
- External/queued operations: retry, duplicate delivery, cancellation, worker restart.
- Provider failure/retry/idempotency: ephemeral test environment (`ephemeral-test-environment`), mock effects, no secrets/redacted diagnostics (`health-retry-redaction`), surface every real failure (`honest-test-result`).

## UI Regression Oracles

- API-created fixtures, cleanup in `finally`; no demo-data dependency.
- Cover loading/empty/validation/server-error/conflict/retry/success/authorization.
- Save/reload/edit/clear; verify API and rendered values.
- Hydration/formatting: render at least two locales/timezones.
- Prefer semantic assertions/stable IDs to full DOM/file snapshots.

## Validation Ladder

Before tests, read `.ai/skills/om-module-scaffold/references/verification.md` for the scaffold test-runner contract.

1. Focused unit/regression test.
2. `yarn generate` when discovery is involved.
3. Focused package/app typecheck or test.
4. `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build` for broad/contract changes.
5. `yarn test:integration:ephemeral` or filtered affected API/UI integration run.
6. Packed/Verdaccio standalone validation for package exports/compiled discovery.

Report the validation command's shell status. Do not pipe gates through `grep`, `tail`, or a trailing `echo`; for log pipelines, enable `pipefail` and preserve the command's exit code explicitly. Any nonzero status remains a failed gate.

No sleeps replacing deterministic convergence, failure suppression, weaker assertions, or fixed claim from only one passing bootstrap path.
