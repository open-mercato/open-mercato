# Experiment dashboard

Run a local React dashboard over explicitly registered experiment directories. It refreshes snapshots, compares lanes, filters cases, and shows retained agent responses, generated files, tool activity, and evaluator evidence. It observes producer output; it does not launch, restart, grade, or certify experiments.

From an installed repository checkout:

```bash
yarn experiments:dashboard --experiment .ai/reports/my-experiment
yarn experiments:dashboard --experiment .ai/reports/run-a --experiment .ai/reports/run-b --port 8769
```

Open the printed URL. The default port is `8768`; `--port 0` selects a free port. Register one to 32 directories. Stop the observer with Ctrl+C; experiment processes continue independently. Assets are built with the repository's existing React, ReactDOM, and esbuild dependencies into ignored `.ai/reports/` storage and removed on a normal shutdown. No app, database, or scaffold setup is needed.

## Producer contract

Write `experiment.json` in a registered directory. Replace snapshots atomically so readers do not see partial JSON. This minimal example declares the intended lane total, including cases not yet reported:

```json
{
  "schemaVersion": 1,
  "id": "example-run",
  "name": "Local coding evaluation",
  "status": "running",
  "startedAt": "2026-10-30T10:00:00Z",
  "updatedAt": "2026-10-30T10:01:00Z",
  "metadata": { "model": "local-model", "runner": "producer-name", "provider": "local", "tags": ["coding"] },
  "lanes": [{ "id": "coding", "label": "Coding", "total": 2 }],
  "cases": [{
    "id": "case-1",
    "title": "Implement the requested behavior",
    "group": "example",
    "prompt": "The retained user task",
    "lanes": { "coding": { "status": "pass", "durationMs": 1200, "attempts": 1, "diagnostics": [], "artifactIds": ["case-1-coding"] } }
  }]
}
```

Case and lane IDs are arbitrary nonempty strings, unique within their scope, up to 200 characters without control characters. Each outcome references a declared lane. Outcome statuses are `pending`, `running`, `pass`, `fail`, `blocked`, `error`, `skipped`, and `not-applicable`. Run status also accepts `completed`, `stopped`, and `unknown`. Unreported run status becomes `unknown`. Optional `finishedAt` records completion.

The dashboard counts reported outcomes without turning missing cases into passes or failures. `pass`, `fail`, `blocked`, `error`, and `skipped` count as completed. `not-applicable` is excluded from a lane's observed total. A lane's displayed total is at least its observed outcome count; without `total`, it is labeled observed. Snapshot age is shown as stale after five minutes and does not prove process liveness.

Outcomes may include nonnegative integer `attempts`, `corrections`, and `durationMs`, and a `diagnostics` string array. Optional `active` records identify current activity using `caseId`, `laneId`, `phase`, `startedAt`, `lastActivityAt`, and `toolCalls`. Producers own the truth of those fields.

Optional `metrics` may appear on the experiment, outcome, or active record. Supported nonnegative numeric fields are `inputTokens`, `outputTokens`, `totalTokens`, `tokensPerSecond`, `outputTokensPerSecond`, `windowSeconds`, and `generationSeconds`; add `sampledAt`, `measurementKind` (`live`, `completed-response`, or `experiment`), and optional `rateSource`. Output tokens divided by positive generation time can supply the output rate. Live rates are hidden when their sample is older than 30 seconds; completed-response metrics remain labeled Last response with their sample time. Missing metrics remain unavailable; the observer never estimates tokens from text or elapsed wall time.

## Retained artifacts

For an outcome's `artifactIds`, write `artifacts/<artifactId>.json`. IDs use letters, digits, `_`, or `-`, start with a letter or digit, and have at most 128 characters. For example:

```json
{
  "schemaVersion": 1,
  "responses": [{ "text": "The visible agent response", "attemptId": "attempt-1" }],
  "files": [{ "path": "src/example.ts", "content": "export const example = true\n", "sha256": "optional-content-hash" }],
  "tools": [{ "id": "tool-1", "name": "write", "path": "src/example.ts", "isError": false, "content": "Optional retained tool result" }]
}
```

The same arrays may be inline on an outcome; optional inline `evidence` holds structured evaluator data. Files are retained content, never instructions to read arbitrary workspace paths. Missing original responses are labeled unavailable; structured evaluator decisions remain separately identified. Internal reasoning is not a supported artifact.

Readers accept bounded regular JSON files only, reject symlinks, hard links, traversal, and sensitive file names, and constrain artifacts to registered roots. Snapshot/artifact JSON is limited to 4 MiB, generated file content to 512 KiB, and snapshots to 10,000 cases and 64 lanes. Displayed prose and larger collections are bounded. Responses and generated code render as text. Pattern-based redaction is a precaution, not a publication review: keep credentials and private material out of producer artifacts and inspect evidence before sharing it.

## Existing harness output

Adapters are chosen in this order:

1. `experiment.json` uses the producer contract above.
2. Legacy `summary.json` uses its case/lane map. Optional `metrics.json` supplies a `metrics` object; `agent-output/*.json`, `generated-files/*.json`, and referenced `evidence/*.json` expose retained captures.
3. A directory of official schema-version-1 harness result JSON files supplies recorded `pass`, `fail`, or `error` outcomes. Writable results map to `coding`, verdict-bearing results to `review`, and other results to `routing`. Run status is `unknown`: result files do not attest that a process is alive or that the full catalog ran.

These adapters do not rewrite source files or change harness result schemas. Use the canonical harness runner and its release reports for certification. A custom local-model run remains identified by its actual runner and model.

## Read-only API and development

The server binds to `127.0.0.1`, accepts only local same-origin GET requests, and exposes no process or filesystem mutation endpoint:

| Endpoint | Response |
|---|---|
| `/api/experiments` | Registered run summaries and observation timestamp |
| `/api/experiments/:id` | Normalized snapshot, cases, and lane counts |
| `/api/experiments/:id/cases/:caseId?lane=:laneId` | One outcome and its available retained artifacts |

Use IDs returned by the API and URL-encode path/query values. Registration IDs derive from directory locations and differ from producer IDs. A bad or temporarily incomplete experiment is shown as unavailable without hiding other registered runs.

```bash
node --test scripts/experiment-dashboard/__tests__/*.test.mjs
yarn test:experiments-dashboard:typecheck
yarn test:experiments-dashboard:browser
yarn experiments:dashboard --help
```

The browser check requires Playwright Chromium to be installed (`yarn playwright install chromium`). To use an installed Chrome instead, run `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome yarn test:experiments-dashboard:browser`.

Keep adapters and normalization in `adapters.mjs` and `model.mjs`, HTTP boundaries in `server.mjs`, and React presentation in `ui/`. Preserve read-only behavior, distinct outcome statuses, honest metric availability, and artifact confinement when extending the tool.
