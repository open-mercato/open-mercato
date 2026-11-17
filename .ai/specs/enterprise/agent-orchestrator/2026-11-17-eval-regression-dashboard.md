# Eval Regression Dashboard

> **Status:** Implemented (Phase 1) · **Created:** 2026-11-17 · **Module:** `agent_orchestrator` (enterprise)
> **Closes:** roadmap gap **A-5** of the #8251 feature-coverage audit (tracked in open-mercato/open-mercato#9648)
> **Extends:** [`2026-10-21-eval-reports-and-reproducible-regression.md`](./2026-10-21-eval-reports-and-reproducible-regression.md) (report model, frozen manifests, baselines), `next/2026-07-19-agent-eval-workbench-and-gate.md` (suite runs, `compareToBaseline`)

## TLDR

- The eval plane already computes everything a regression view needs: per-suite pass score, per-assertion pass rates against a baseline, per-case baseline status. All of it reaches users only through the downloadable report or one "vs previous run" tile.
- This spec adds a **regression dashboard**: a pass-score trend across suite runs, labelled with the **agent version** each run executed, a per-version summary, and a **side-by-side comparison of any two suite runs** with a per-case diff (regressed / fixed / changed / added / removed) and per-assertion deltas.
- Two read-only endpoints (`GET /eval-runs/trend`, `GET /eval-runs/compare`), one new page (`/backend/eval-runs/compare`), a new "Regressions" section on the agent's Evaluation tab, and a "Compare with baseline" action on the eval run page.
- **No schema change, no new ACL feature.** The agent version is read from the case runs' `agent_runs.agent_version` at query time. Gated by the existing `agent_orchestrator.eval.manage`.

## Overview

Teams change an agent's prompt, tools or model and need to know, from the UI, whether quality went up or down and which cases moved. The eval plane already scores every case of every suite run; what is missing is a view across runs keyed by the agent version.

> **Market reference.** Braintrust and Langfuse show experiments over time and diff two experiments per row (score movement, regressions/improvements). We adopt the per-row diff and the "compare against the previous run on the same dataset" rule; we reject arbitrary multi-run matrices for now (two-run compare covers the release question).

## Problem Statement

Verified on `feat/agent-platform-roadmap-gaps` at `7c14513755`:

1. `AgentEvalSuiteRun` has no agent version. The version (`resolveRunAgentVersion`, short definition hash) is stored only on each `AgentRun` a case run produced (`agent_eval_case_runs.agent_run_id`). No API returns a suite run's version.
2. The only regression signal in the UI is the "vs previous run" tile (`EvaluationTab.tsx`): the latest pass score minus the one before, regardless of dataset or version.
3. Per-assertion baseline pass rate and delta and per-case `baselineStatus` exist only inside the report (`reportSchema.ts`). The eval run page shows judge deltas as raw JSON.
4. Nothing compares two arbitrary suite runs, and nothing lists which cases flipped.

## Proposed Solution

Two read-only aggregations over existing rows (`agent_eval_suite_runs`, `agent_eval_case_runs`, `agent_eval_results`, `agent_runs.agent_version`) and two views that render them.

## Architecture

```
lib/eval/report/suiteAggregation.ts   loadSuite, loadAssertions, summarizeBuckets, caseStatusOf, groupCaseRunsByCase
        ▲                    ▲
buildEvalReport.ts    lib/eval/regression/compareSuiteRuns.ts  (diffSuiteRuns — pure; compareSuiteRuns — scoped loader)
                      lib/eval/regression/buildEvalTrend.ts    (computeEvalTrend — pure; buildEvalTrend — scoped loader)
                      lib/eval/regression/suiteAgentVersions.ts (typed Kysely DISTINCT join case_runs ⋈ agent_runs)
api/eval-runs/trend/route.ts, api/eval-runs/compare/route.ts
backend/agents/[id]/components/EvalRegressionSection.tsx, backend/eval-runs/compare/page.tsx
```

## Data Models

No new entity, column or migration. Read-only use of:
- `agent_eval_suite_runs` (status, pass_score, eval_set_version, summary `__evalSet` pointer, safety_regressions, created_at)
- `agent_eval_case_runs` (suite_run_id, eval_case_id, agent_run_id, trial_index, status, score)
- `agent_eval_results` (eval_case_run_id, assertion_key, assertion_id, passed, severity)
- `agent_runs.agent_version` (joined, scoped)
- `agent_eval_cases.name` and frozen manifest case `key`/`name` for labels

## Design Decisions

| Decision | Rationale |
|---|---|
| Derive a suite run's agent version(s) at read time from `agent_runs` | AO migrations are squash-only (eval reports spec, "Concerns"), so `agent_eval_suite_runs` gets no column. Agent runs are not purged by trace-content retention, so the derivation is stable. One typed Kysely query with `DISTINCT` returns at most suites × versions rows. |
| A suite run reports a **list** of versions | A definition can change while a long suite runs. The UI shows "mixed" instead of hiding it. Runs that predate version stamping show "unknown". |
| Trend counts `completed` suite runs only | Same population `resolveBaselineSuiteRun` compares against. Running, failed and cancelled runs have no meaningful pass score. |
| Trend deltas compare only runs of the **same dataset** | Pass rates over different case sets are not comparable — the same rule the baseline resolver applies to pinned runs. Dataset key = frozen manifest hash, else `evalSetVersion`, else "unpinned". |
| Compare reuses the report's aggregation | `summarizeBuckets`, the per-case status rule and `compareToBaseline` move into `lib/eval/report/suiteAggregation.ts`. The report and the dashboard cannot disagree about a pass rate or a regression. |
| Compare accepts any two finished runs of the **same agent** | Cross-agent comparison has no meaning for a per-case diff (different cases). A dataset mismatch is allowed but flagged (`sameDataset: false`), because comparing a new dataset against the old one is a legitimate question. |
| No evidence, inputs or outputs in compare responses | Assertion verdicts and scores only, so `eval.manage` (the feature that already reads per-case results) is the right gate. Evidence stays behind the existing results route; payloads stay behind `eval.export`. |

### Alternatives Considered

| Alternative | Why rejected |
|---|---|
| `agent_version` column on `agent_eval_suite_runs` | Needs AO DDL before the next re-squash. Listed for the next re-squash; the read-time derivation can be replaced by the column without an API change. |
| Store versions in `summary.__evalRun` at completion | Only new runs would carry it, so a fallback derivation is still needed — two code paths for one fact. |
| Compute the trend client-side from `GET /eval-runs` | Needs the versions anyway (server join) and would re-implement the dataset rule in the browser. |
| Build the diff from two downloaded reports | The report is an export (`eval.export`) with payload opt-ins; the dashboard must work for `eval.manage` holders. |

## API Contracts

Both routes: `requireAuth`, `requireFeatures: ['agent_orchestrator.eval.manage']`, tenant + organization scoped, OpenAPI documented.

### `GET /api/agent_orchestrator/eval-runs/trend`

Query: `agentDefinitionId` (required), `evalSetVersion` (optional, exact pin), `limit` (1–100, default 30).

Response:
```jsonc
{
  "agentDefinitionId": "…",
  "points": [ // oldest → newest, the newest `limit` completed runs
    {
      "suiteRunId": "uuid", "createdAt": "iso", "finishedAt": "iso|null",
      "trigger": "manual|ci|scheduled", "outcome": "passed|failed|advisory|null",
      "passScore": 0.8, "scoreVariance": null, "caseCount": 5, "errorCount": 0,
      "evalSetVersion": "…|null", "manifestHash": "sha256:…|null", "datasetKey": "…|null",
      "agentVersions": ["sha256:abcd…"], "safetyRegressionCount": 0,
      "previousSuiteRunId": "uuid|null", // previous point of the same dataset
      "passScoreDelta": -0.2              // vs that point, null when none
    }
  ],
  "versions": [ // one row per agent version, ordered by first appearance
    {
      "agentVersion": "…|null", "runCount": 2, "firstSeenAt": "iso", "lastSeenAt": "iso",
      "latestSuiteRunId": "uuid", "latestPassScore": 0.8, "meanPassScore": 0.75,
      "previousVersion": "…|null", "passScoreDelta": 0.1, "sameDataset": true
    }
  ]
}
```
A point executed under several versions is attributed to each of them in `versions`. `passScoreDelta` on a version compares its latest run with the latest run of the previous version and is `null` when the two ran different datasets (`sameDataset: false`).

Errors: 400 invalid query, 401, 403.

### `GET /api/agent_orchestrator/eval-runs/compare`

Query: `base`, `head` (suite run uuids, must differ).

Response:
```jsonc
{
  "base": { /* run summary: id, agentDefinitionId, status, outcome, passScore, caseCount, errorCount,
               evalSetVersion, manifestHash, agentVersions, createdAt, finishedAt */ },
  "head": { /* same */ },
  "sameDataset": true,          // null when either run has no manifest
  "passScoreDelta": -0.2,       // head − base, null when either is null
  "totals": { "regressed": 1, "fixed": 0, "changed": 0, "unchanged": 3, "added": 0, "removed": 1 },
  "assertions": [
    { "key": "…", "type": "deterministic|llm_judge|unknown", "severity": "gate|warn", "judge": false,
      "basePassRate": 1, "headPassRate": 0.5, "delta": -0.5, "regressed": true }
  ],
  "cases": [
    { "caseId": "uuid", "key": "…", "name": "…|null", "change": "regressed",
      "baseStatus": "passed", "headStatus": "failed",       // passed|failed|error|skipped|absent
      "baseScore": 1, "headScore": 0, "scoreDelta": -1,
      "baseTrials": 1, "headTrials": 1,
      "baseAgentRunId": "uuid|null", "headAgentRunId": "uuid|null",
      "flippedAssertions": [ { "key": "…", "base": true, "head": false } ] }
  ]
}
```
- Case status per run uses the report's rule (`baselineStatus`): any failed trial → `failed`, else any passed → `passed`, else any error → `error`, else `skipped`; no trial → `absent`.
- `change`: `added` / `removed` when one side is absent; `regressed` when base passed and head failed or errored; `fixed` the other way; `unchanged` when status, mean score and per-assertion verdicts are equal; `changed` otherwise.
- A per-case assertion verdict is `false` when any applied trial failed it, `true` when every applied trial passed, `null` when every trial skipped it.
- `regressed` on an assertion is `compareToBaseline`'s safety regression (deterministic `gate` assertion whose pass rate dropped). Judge movement is reported, never flagged.
- Cases are sorted regressed → fixed → changed → added → removed → unchanged, then by key.

Errors: 400 invalid ids or `base === head`; 404 either run not in scope (cross-tenant ids indistinguishable from missing); 409 `run_not_finished` when either is `queued`/`running`; 422 `agent_mismatch` when the runs belong to different agents; 401, 403.

## UI/UX

- **Agent → Evaluation → Regressions** (new section, `?tab=evaluation&section=regressions`): pass-score line chart over completed runs (`LineChart` from `@open-mercato/ui/backend/charts`), a dataset filter when runs used more than one dataset, a versions table (version, runs, latest pass, delta vs previous version, last seen), a recent-runs table whose row action opens "Compare with previous". Empty state when no run has completed.
- **`/backend/eval-runs/compare?base=…&head=…`**: two run summary cards (version, dataset, pass score, outcome, links to each run), a dataset-drift alert when `sameDataset === false`, KPI strip (pass-score delta, regressed, fixed), assertion delta table, per-case diff table filtered to changed cases by default (segmented control: changed / all), each row linking to both traces.
- **Eval run page**: "Compare with baseline" when the run has `baseline_suite_run_id`.
- Status colors via `StatusBadge` variants; chart series via `chart-*` tokens. All strings in `agent_orchestrator` locales (en, de, es, pl, ko).

## Migration & Backward Compatibility

- Additive only: two new GET routes, one new page, one new section value. No schema change, no event, no ACL feature, no change to existing response shapes.
- `buildEvalReport` keeps its output byte-for-byte; the aggregation helpers it used privately move into a shared module (internal, not exported from the package).
- The eval run page's existing UI is unchanged apart from one added button.

## Implementation Plan

### Phase 1 (this change)
1. Extract `summarizeBuckets` / case-status / suite loading into `lib/eval/report/suiteAggregation.ts`; `buildEvalReport` uses it.
2. `lib/eval/regression/suiteAgentVersions.ts` (typed Kysely, scoped), `buildEvalTrend.ts`, `compareSuiteRuns.ts` (pure diff + loader).
3. Routes `api/eval-runs/trend`, `api/eval-runs/compare`; validators in `data/validators.ts`.
4. UI: `EvalRegressionSection.tsx`, `backend/eval-runs/compare/page.tsx`, button on the eval run page, `regressions` section on the agent page.
5. i18n in 5 locales; unit tests; integration test `TC-AGENT-EVAL-REGRESSION-001`.

### Later (out of scope)
- `agent_version` column on suite runs at the next re-squash (replaces the read-time join).
- Charting cost/latency per version; release-gated comparison (`releaseId`).

## Testing Strategy

- Unit: case diff classification, assertion verdict aggregation, trend dataset-scoped deltas and version grouping (`eval-regression.test.ts`); `buildEvalReport` tests stay green after the extraction.
- Integration `TC-AGENT-EVAL-REGRESSION-001` (no live model): seeds two completed suite runs of one agent with agent runs stamped `v1` / `v2`, case runs and assertion results through `dbFixtures` (the precedent of the eval report specs), then asserts the trend (versions, dataset-scoped delta), the compare diff (one regressed, one fixed, one removed case, a gate regression), the 404 / 409 / 422 / 400 contracts, and that the compare page renders the regressed case. Cleans up every row it created.

## Risks & Impact Review

#### Comparing different datasets reads as a regression
- **Scenario:** A user compares a run on a new eval set with one on the old set and reads the case churn as agent regressions.
- **Severity:** Medium
- **Affected area:** Compare page, version deltas
- **Mitigation:** `sameDataset` is computed from manifest hashes, the page shows a drift alert, version deltas are `null` across datasets, trend deltas only connect same-dataset runs.
- **Residual risk:** Unpinned runs without a manifest (`sameDataset: null`) cannot be checked; shown as "dataset unknown".

#### Large suites make compare slow
- **Scenario:** 500 cases × 5 trials on each side.
- **Severity:** Low
- **Affected area:** `GET /eval-runs/compare`
- **Mitigation:** Same reads as the report endpoint (already sized for 2,500 case runs), no evidence decoding beyond what `findWithDecryption` does, no payloads.
- **Residual risk:** Response carries one row per case (≤ manifest cap); acceptable for a detail view.

#### Tenant isolation
- **Scenario:** A suite run id from another organization is passed to compare.
- **Severity:** High
- **Affected area:** Both routes
- **Mitigation:** Every read is filtered by `{ tenantId, organizationId }`, including both sides of the Kysely join; out-of-scope ids return 404.
- **Residual risk:** None known.

## Final Compliance Report

- Tenant/organization scoping on every read, including both tables of the Kysely join — yes.
- No direct ORM relationship across modules; no new entity — yes.
- Encrypted columns (`summary`, `evidence`, `error_message`) read through `findWithDecryption`; evidence never returned — yes.
- Zod validation for both query strings in `data/validators.ts` — yes.
- No new ACL feature; existing `eval.manage` gate on routes and the new page — yes.
- i18n: all strings in 5 locales; DS tokens only (`StatusBadge` variants, `text-status-*-text`, `chart-*` via `LineChart`) — yes.
- Backward compatibility: additive routes/page/section value; `buildEvalReport` output unchanged (its unit tests unchanged and green) — yes.

## Changelog

### 2026-11-17
- Initial specification and Phase 1 implementation (A-5).
