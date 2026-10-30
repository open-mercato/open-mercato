# Reusable local experiment dashboard

## TLDR
Provide `yarn experiments:dashboard --experiment <run-directory>` as a reusable React observer for local experiments. Multiple registered runs, models, arbitrary case/lane IDs and optional response/code artifacts share one dashboard. Existing graders and certification remain authoritative.

## Overview and problem
The current local report is a one-off implementation tied to one model, fixed case counts and local runtime paths. Operators need to inspect long-running experiments without rebuilding reporting UI, losing generated files, or mistaking missing output for a passing result.

## Proposed solution and resolved assumptions
- Repository-owned tool under `scripts/experiment-dashboard/`, using existing React/React DOM/esbuild dependencies. No standalone-scaffold emission or new production dependency.
- Explicit repeatable `--experiment <directory>` registrations. A versioned producer snapshot is the portable integration contract; read-only adapters accept the existing summary shape and official harness result directories.
- Bind only loopback. Dashboard APIs observe registered files and never start/stop runs, execute artifacts, enumerate arbitrary directories or change grader outcomes.
- Generic producers declare run identity, metadata, arbitrary lanes/cases, statuses, activity and optional artifact references. Legacy adapters derive their vocabulary and totals from data. A result-only directory cannot establish live process state.
- Missing prose/source is explicitly unavailable. Optional supplemental artifacts hold visible responses, generated text files and tool metadata. No hidden reasoning, credentials, raw environment or arbitrary writable-target discovery.
- Existing local experiments can be registered without restarting them. Local results and machine configuration stay ignored and out of the PR.

## Architecture
A Node HTTP server validates and normalizes registered run snapshots. React polls read-only JSON APIs and preserves selected experiment, search, filters, active detail tab and selected file during updates. The CLI bundles client assets with the existing esbuild installation into an ignored cache directory before serving; generated bundles are never hand-edited or committed. UI uses semantic foundation tokens, existing compatible primitives, and Open Mercato branding with the same logo as the application shell.

## Data models
A generic `experiment.json` declares `schemaVersion: 1`, `id`, `name`, `status`, optional timestamps and `metadata` (model/runner/provider/tags), `lanes: [{id,label,total?}]`, and `cases: [{id,title,group?,lanes: {<lane-id>: outcome}}]`. Optional `active` records identify case/lane/phase/activity. Outcomes retain distinct pending/running/pass/fail/blocked/error/skipped/not-applicable states, attempts, duration, diagnostics and optional artifact references. Totals are derived from declared case/lane data, with incomplete totals labelled explicitly.

Artifact JSON is explicitly referenced inside the registered root and may provide visible response text, bounded generated text-file contents and tool metadata. IDs are data, never filesystem paths. Legacy `summary.json` plus existing local `agent-output/`, `generated-files/` and `evidence/` artifacts are read without resolving evaluator `changedPaths` against external targets.

Optional producer metrics include actual input/output/total token counters, output tokens per second, sample timestamp and measurement window. The UI updates throughput with live snapshots, labels unavailable or stale measurements explicitly, and never estimates tokens from character/chunk counts. Numeric metrics must be finite and non-negative.

## API contracts
- `GET /api/experiments`: experiment summaries, metadata, lane counts and active state.
- `GET /api/experiments/:id`: normalized cases and outcomes for one registered run.
- `GET /api/experiments/:id/cases/:caseId?lane=<id>`: request, retained response, generated files, tool activity and evaluator evidence when available.
- Static assets are an explicit allowlist. All other routes/methods fail closed. No write API, remote proxy, shell or inference transport.

The implementation may refine field names before the first release; its README, types and tests must agree. Existing evaluator, oracle and release result schemas do not change.

## Workflows and acceptance
1. Register two unrelated experiments and switch between them; labels, totals and cases follow the selected run without hardcoded model/catalog assumptions.
2. A producer atomically updates its snapshot. Within the refresh interval the UI updates progress and activity while retaining filters and selected artifacts.
3. Open a case, inspect exact retained visible response and generated source, download a text file and inspect evaluation diagnostics. Unavailable historical prose is labelled honestly.
4. A missing, partial, malformed or stale snapshot shows an explicit empty/error/stale state while other experiments remain usable.

## Integration coverage
API tests cover registration, generic/legacy/official adapters, arbitrary identifiers and lanes, counts/statuses, update visibility, malformed files, missing artifacts, bounded reads, traversal/symlink/credential denial, Host/Origin checks, unsupported methods and static allowlists. Browser checks cover multiple-run switching, filters, a real producer update, response/code tabs, file selection/download and inert hostile text. Focused semantic tests ship with the implementation; fixtures are synthetic and self-contained.

## Risks and impact review
| Failure | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Output executes script or exposes local files | High | Inert React text rendering, explicit registration, bounded artifact references, no symlink/traversal/credential reads, loopback and origin guards | Users control the registered run data |
| Incomplete results look successful | High | Distinct statuses, explicit missing data and unknown totals, no inferred liveness | Producers must publish truthful state |
| UI refresh loses inspection context | Medium | Stable selection/filter/file state and browser regression evidence | An artifact may change while a producer writes it |
| New monitoring changes benchmark behavior | Medium | Read-only observer and unchanged graders/contracts | Optional producer artifacts add normal local I/O |

## Migration and backward compatibility
This is an additive repository CLI and JSON API. No database, module, event, ACL or published grading contract changes. Existing canonical results remain valid and independently authoritative. Removing the tool stops observation only; experiment processes and saved artifacts remain intact.

## Phases
Follow `.ai/runs/2026-10-30-experiment-dashboard.md`: failure-first contracts; server/adapters; React UI and browser checks; skills/docs; validation and review.

## Final compliance report
Implemented in `scripts/experiment-dashboard/` with Open Mercato branding, explicit experiment registration, read-only adapters, retained artifacts and measured throughput. Local verification passes 23 focused tests, strict tooling typechecking, two real-Chrome integrations, and the knowledge-change controller with base-plus-test failure/head success. The authoritative review fixed arbitrary-lane ownership, partial-target notices and live-metric expiry during network outages; independent review and manual QA remain required.

The ordered local repository gate passes package builds, generation, translation checks, repository typechecking and the production app build. Its first test run hit one unchanged CrudForm timing assertion; the isolated test and all 302 UI suites pass on retry. The full retry fails 13 create-app harness tests because the macOS/Node 26 sandbox denies a parent package-config read before the fake runner executes. A representative test reproduces the same failure at the pinned base. The draft PR remains in progress until the full gate passes in a compatible environment.

A separate current-scaffold deterministic check passes 236/240 with four unchanged context-budget failures (OMH-008/082/153/155). No evaluator, budget or emitted harness source was changed. Full release certification is not implied by dashboard test results.

## Changelog
- 2026-10-30: Initial implementation specification and autonomous scope decisions.
- 2026-10-30: Implemented the dashboard and workflow skills; recorded browser, knowledge-controller and repository-gate evidence with baseline/environment limits.
