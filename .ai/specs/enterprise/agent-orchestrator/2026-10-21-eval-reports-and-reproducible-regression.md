# Eval Reports and Reproducible Regression

> **Status:** Draft · **Created:** 2026-10-21 · **Module:** `agent_orchestrator` (enterprise), with one additive seam in `ai-assistant`
> **Extends (does not replace):** `next/2026-07-19-agent-eval-workbench-and-gate.md` (owns the replay engine, `AgentEvalSuiteRun`, `runEvalGate`, the CLI), `next/2026-06-20-agent-eval-harness-and-metrics.md` (scorers, judge, export envelope), `2026-07-25-continuous-online-eval-and-golden-match.md` (golden input-match), `2026-10-12-process-flow-trace-replay-and-embeddable-decision-card.md` §G (scripted LLM provider)
> **Consumed by:** `next/2026-06-19-agent-deployment-and-regression-gating.md` (`EvalGateRunner` calls `runEvalGate`)
> **Related specs (2026-10-21 set):** [`../../2026-10-21-chat-run-tracing-and-citations.md`](../../2026-10-21-chat-run-tracing-and-citations.md) (OSS; **owns** `AiAgentCallSettings`, call-time `callSettings` and definition `modelSettings`, §6 — this spec consumes them), [`2026-10-21-agent-run-observability-full-fidelity.md`](./2026-10-21-agent-run-observability-full-fidelity.md) (records the settings actually sent; the report reads `honored` from it), [`2026-10-21-output-integrity-guardrails.md`](./2026-10-21-output-integrity-guardrails.md) (adds the `guardrail_check` scorer, which eval sets can assert), [`2026-10-21-agent-invocation-access-and-identity-binding.md`](./2026-10-21-agent-invocation-access-and-identity-binding.md) (eval replay invoker = operator, agent principal via `runAs`). Umbrella: [`../../2026-10-21-agent-platform-capabilities-roadmap.md`](../../2026-10-21-agent-platform-capabilities-roadmap.md).

## TLDR

**Key points**
- The eval plane can already replay approved cases, score them with 22 registry scorers (including `llm_judge`; 23 once the integrity spec's `guardrail_check` ships), compare against a baseline and fail a CI gate. Its results, however, live only in the database: the CLI prints six lines. The dataset is a free-text label, and every replay hits live tools and a live model.
- This spec makes an eval run a **portable, reproducible artifact**. It adds a versioned report file (JSON + Markdown + JUnit), a frozen dataset manifest per run that is addressed by content hash, eval sets as files in git, and tool and model record/replay. It also adds a per-agent judge rubric library and a CI recipe.

**Scope**
- (a) Standalone report: `--report <dir>` / `--format json,md,junit` on the CLI, the same report from `GET /eval-runs/:id/report` and a download action on the eval run page.
- (b) Frozen datasets: each suite run freezes the exact cases and assertions it ran into a content-hashed manifest. `evalSetVersion` can name that hash, and a pinned run replays from the manifest instead of the live, editable rows.
- (c) File-based eval sets: a versioned JSON (optionally YAML) format, CLI `--cases <file>` and import/export API. Cases live in git next to the agent and run in CI without being authored in the UI first.
- (d) Reproducibility: record tool results on a golden run and replay them deterministically. Record a scripted-model fixture at the same time for fully offline replay. Pin temperature/seed where the provider supports it.
- (e) Rubric library: built-in and per-agent named judge rubrics referenced by `rubricRef`.
- (f) A GitHub Actions recipe with documented exit codes.

**Concerns**
- AO migrations are **squash-only**. Recent specs avoided schema changes for this reason (`2026-10-12-…` §C). This spec makes **no schema change**: manifests ride in the existing encrypted `agent_eval_suite_runs.summary` jsonb (see Q1). This is the migration policy shared by all 2026-10-21 AO specs (no AO DDL until the next planned re-squash; run facts in the `run.manifest` span, content in the encrypted artifact offload, the rest in existing jsonb); the consolidated next-re-squash list, including `agent_eval_set_snapshots`, is in the roadmap.
- Recorded fixtures and reports can contain decrypted tenant data. Writing them to disk or git is an explicit, opt-in act. Payloads are excluded by default.

## Open Questions

Each question carries the default this draft assumes, so the spec can be reviewed end to end. Confirm or override before implementation.

- **Q1 — Snapshot storage.** Store the frozen manifest in the existing `summary` jsonb of the first suite run that uses it (zero schema change, assumed), or add a dedicated append-only `agent_eval_set_snapshots` table at the next planned re-squash? *Assumed: run-carried manifest now; the table is listed under Alternatives and can absorb the same JSON later without a format change.*
- **Q2 — YAML.** YAML eval sets need `yaml` as a production dependency of `@open-mercato/enterprise` (today it is only a root devDependency). **Resolved 2026-10-22: approved.** `yaml` becomes a production dependency of `@open-mercato/enterprise`, pinned to the root's version, with `yarn npm audit` run when it is added. JSON and YAML are both accepted from Phase 3; JSON stays the canonical export format.
- **Q3 — Split.** (a)+(b)+(c)+(f) form one capability ("portable regression"). (d) record/replay touches `ai-assistant` and could stand alone, and so could (e) the rubric library. *Assumed: one spec, phased so (d) and (e) can ship as separate PRs. Split (d) into its own spec if the ai-assistant owners prefer.*
- **Q4 — CI tenant scope.** The CLI needs `--tenant`/`--org` UUIDs. A fresh CI database learns them only after `yarn initialize`. *Assumed: the CLI also reads `OM_EVAL_TENANT_ID`/`OM_EVAL_ORG_ID`, and the recipe captures the ids from a SQL lookup step. A first-class `--org-slug` selector is deferred.*
- **Q5 — Payloads in reports.** Should reports include case inputs and agent outputs by default? *Assumed: no. `--include-payloads true` (CLI) or `?includePayloads=true` (API) opts in. Evidence excerpts are always included, truncated.*

## Overview

The Agent Orchestrator's eval plane is the regression oracle behind agent releases. Teams adopting agents in a regulated setting expect four things from that oracle:

1. a standalone report they can read, attach to a ticket or diff in a PR, without database access;
2. proof that run N and run N+1 used the same dataset;
3. a regression suite that lives in git next to the agent, and not only in a tenant database;
4. replays that do not depend on whatever a live tool or model returns that day.

Every agent built on AO has the same needs.

> **Market reference.** *promptfoo*: a test suite is a YAML file in the repo, `promptfoo eval -o results.json|html|junit.xml` writes reports, and the exit code fails CI. We adopt file suites, multi-format output and exit codes; we reject its "the file is the only store" model, because AO cases are also authored from corrections in the UI. *Braintrust/Langfuse*: datasets are versioned and experiments are compared against a baseline. We adopt immutable dataset versions addressed by content hash. *Inspect AI*: logs are self-describing and models can be replayed against recorded outputs. We adopt record/replay. *OpenAI Evals*: registry-style named graders. We adopt named rubrics. We reject vendor-hosted storage and any second test runner: the platform stays Jest/CLI, as decided in the harness spec.

## Problem Statement

Verified against the code on 2026-10-21:

1. **No portable report.** `cli.ts:548` (`evalGate`) prints suite id, agent, case-run count, pass score, baseline and outcome. Per-case results, scorer evidence, judge feedback, cost and latency exist only in `agent_eval_case_runs` / `agent_eval_results`. The UI and `GET /eval-runs/:id` (feature `eval.manage`) can read them, but a CI log cannot.
2. **The dataset pin is a label.** `AgentEvalSuiteRun.evalSetVersion` is `varchar(100)`, free text. `resolveBaselineSuiteRun` matches baselines by string equality. Cases (`AgentEvalCase`, carrying `updated_at`) and assertions (`AgentEvalAssertion`) stay editable, so two runs under the same label can execute different inputs, expectations and scorer configs. `runEvalGate` always loads the agent's **current** approved cases (`evalGate.ts`), and `scoreCaseRun` loads the **current** enabled assertions (`evalReplayService.ts`).
3. **Cases must be authored in the database.** Cases come from corrections or golden runs (`sourceType: 'correction' | 'golden_run'`, `sourceId uuid NOT NULL`). `GET /eval-cases/export` (envelope `version: 1`) exports approved cases, but it carries assertion **references** only, not their definitions, and there is no import. A CI pipeline cannot bring its own regression set.
4. **Replays are not reproducible.** Replay deliberately runs fresh inference (`executeCaseRun` doc comment). Tools execute live against current data. The scripted provider (`ai-assistant/lib/llm-adapters/scripted.ts`, bound by `withScriptedLlmContext` in `nativeAgentRunner.ts`) makes the **model** deterministic, but it scripts tool *calls*, and the real tools still run. Nothing records or replays tool *results*. `defineAgent` has no temperature or seed, and `runAiAgentObject` has no call-settings input. Only the judge rubric pins `temperature`/`seed`.
5. **Judge results are missing from the suite summary.** `runLlmJudgeForRun` (`llmJudge.ts`) persists judge `AgentEvalResult` rows **without `evalCaseRunId`**. `aggregateSuiteRun` selects results by `evalCaseRunId ∈ caseRuns`, so judge buckets never enter the eval-plane summary, and `__judgeDeltas` is always empty for replayed suites. The judge is also called without the case's `expected` value, and it ignores per-case assertion refs.
6. **Rubrics are inline only.** A judge rubric lives in one assertion's `config`. A team cannot share "rationale quality" across agents or version it.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|---|---|
| One report model, three renderers | `buildEvalReport(suiteRunId)` produces a typed JSON document. Markdown and JUnit render from it. The API, CLI and UI share it, so no surface can drift. |
| Report schema versioned `open-mercato.agent-eval-report` v1, additive-only | It becomes a contract that CI tooling parses. |
| A manifest is frozen for **every** suite run, not only pinned ones | The report can always state exactly what ran. A free-text label becomes a lookup over manifests, not the source of truth. |
| Content hash = `sha256:` + `canonicalInputKey(manifest)` | Reuses the existing canonicalizer (`lib/eval/canonicalInputKey.ts`). The result fits `varchar(100)` (71 chars). |
| A pinned replay reads cases, assertions and rubrics **from the manifest** | This is the only way a pin guarantees what it claims. Live rows can change afterwards. |
| File cases need no `AgentEvalCase` rows | Case and assertion ids are deterministic UUIDv5 values derived from `(agentId, key)`. Content comes from the manifest. Import into rows is a separate, explicit action. |
| Tool replay is a seam in `ai-assistant`, mirroring `withScriptedLlmContext` | Tool execution happens in `agent-tools.ts`. An AsyncLocalStorage binding leaves every tool and provider port signature unchanged. |
| The stored outcome stays authoritative; CLI policy may only narrow it | Same rule as `runEvalGate`: `--fail-on-flaky` and `--min-pass-score` can turn a pass into exit 1, never a fail into exit 0. |
| No new ACL features | Reports and set exports reuse `agent_orchestrator.eval.export`, import reuses `eval.manage`, runs reuse `eval.run`. |
| Zero schema change | The squash-only migration convention. Everything new fits existing jsonb columns or files. |

### Alternatives Considered

| Alternative | Why rejected (for now) |
|---|---|
| Dedicated `agent_eval_set_snapshots` table (org, agent, version, label, body, created_at), modeled on `agent_guardrail_sets` | It is the cleaner long-term model. It would need a re-squash, though, and the 2026-10-12 spec documents that a re-squash breaks databases already on the current squash. The manifest JSON is designed so it can move into such a table unchanged (Q1). |
| Freeze cases by copying them into archived `AgentEvalCase` rows | This pollutes the authoring list, and `sourceId`/`status` semantics do not fit. |
| Score stored outputs instead of replaying | This detects no regressions, which is the reason the eval plane replays at all (`executeCaseRun`). |
| Derive tool fixtures only from `agent_tool_calls` | Native trace capture stores `toolCall.result` as `responseSummary`. Ingestion may redact or truncate it, and OpenCode runs offload payloads to artifacts. "Export fixtures from run" stays a best-effort convenience, with a fidelity flag; recording at execution time is the faithful path. |
| A separate eval runner (promptfoo, Vitest) | Rejected in the harness spec: one scorer registry, one runtime, no second runner. |

## User Stories / Use Cases

- **An agent engineer** runs `yarn mercato agent_orchestrator eval --agent X --cases agents/X/evals/regression.json --report out/ --format json,md,junit` locally and in CI, and reads `out/report.md` to see which case regressed and why.
- **A reviewer** downloads the Markdown report of a suite run from the eval run page and attaches it to a release ticket.
- **A release manager** pins a gate to `sha256:…` and is certain that the baseline and the candidate ran byte-identical cases and assertions.
- **A QA engineer** records tool fixtures from a golden run once, commits them, and replays the suite in CI with no live tools and the scripted model, so a deterministic-tier failure is a real code regression.
- **A domain expert** keeps a shared "rationale quality" rubric used by several agents' judge assertions, and a rubric edit shows up as a new dataset version.

## Architecture

```mermaid
flowchart LR
  subgraph Inputs
    DB[(approved AgentEvalCase +<br/>AgentEvalAssertion rows)]
    FILE[eval set file<br/>agents/X/evals/*.json]
    RUB[rubric library<br/>built-in + per-agent]
  end
  DB --> MF[freezeManifest]
  FILE --> MF
  RUB --> MF
  MF -->|sha256 version| SR[(agent_eval_suite_runs.summary.__evalSet)]
  SR --> RP[replaySuiteRun<br/>reads cases/assertions from manifest]
  RP --> RT[agentRuntime.run]
  RT -->|withToolReplayContext| TL[tool wrapper<br/>agent-tools.ts]
  RT -->|withScriptedLlmContext| LLM[model or scripted provider]
  RP --> SC[deterministic scorers + judge<br/>linked to evalCaseRunId]
  SC --> AG[aggregate + compareToBaseline]
  AG --> REP[buildEvalReport]
  REP --> J[report.json] & M[report.md] & X[junit.xml]
  REP --> API[GET /eval-runs/:id/report]
```

### Component changes

| Component | Change |
|---|---|
| `lib/eval/manifest.ts` (new) | `freezeManifest(source)`, `hashManifest`, `resolveManifest(em, scope, agentId, version)`, `deterministicCaseId/AssertionId` (UUIDv5, namespace constant). |
| `lib/eval/evalSetFile.ts` (new) | Zod schema of the file format, parse/serialize, `manifestFromFile`, `fileFromManifest`. |
| `lib/eval/report/` (new) | `buildEvalReport.ts`, `reportSchema.ts` (Zod + exported TS type), `renderMarkdown.ts`, `renderJunit.ts`, `flaky.ts`. |
| `lib/eval/rubrics/` (new) | Built-in rubric registry and `resolveRubricRef(agentId, ref)`. |
| `lib/eval/evalGate.ts` | `EvalGateInput` gains optional `cases?: EvalSetFile`, `snapshot?: string`, `replay?: ReplayOptions`, `callSettings?: AiAgentCallSettings` (the eval-run override). Additive. |
| `commands/evalRuns.ts` | `start` freezes the manifest and writes `summary.__evalSet` (body only on the first carrier of a hash in org+agent, otherwise a pointer). `complete` **merges** into `summary` instead of overwriting it. |
| `lib/eval/evalReplayService.ts` | `runCase`/`scoreCaseRun` resolve case content and the effective assertions from the manifest when the suite carries one. The judge path passes `evalCaseRunId`, the case `expected` and the manifest's judge assertions. `aggregateSuiteRun` detects judges from the manifest. |
| `lib/eval/llmJudge.ts` | `runLlmJudgeForRun` gains an optional `{ evalCaseRunId, expected, assertions }` argument. The existing call shape is unchanged (online plane). |
| `cli.ts` (`evalGate`) | New flags (see API Contracts). Writes reports before setting the exit code, including on failure. |
| `api/eval-runs/[id]/report/route.ts` (new) | Report download. |
| `api/eval-runs/[id]/route.ts` | Strips `summary.__evalSet.body` from the response (pointer only). |
| `api/eval-sets/…` (new) | Export a manifest as a file, import a file into rows. |
| `backend/eval-runs/[id]/page.tsx` | "Download report" action (JSON / Markdown / JUnit). |
| `ai-assistant/lib/llm-adapters/tool-replay-context.ts` (new) | `withToolReplayContext`, `getToolReplayContext`. |
| `ai-assistant/lib/agent-tools.ts` | The `dynamicTool.execute` wrapper consults the replay context: **replay** returns the recorded output and skips the handler, **record** captures `{toolName, args, output, error}` after the handler. |
| `ai-assistant/lib/agent-runtime.ts` | `RunAiAgentObjectInput.callSettings?: AiAgentCallSettings`, forwarded to the AI SDK call — defined by the chat-tracing spec §6 (reuse if landed; this spec only needs `temperature` and `seed` from it). Additive. |
| `lib/sdk/defineAgent.ts` | Optional `modelSettings?: AiAgentCallSettings` (forwarded to `defineAiAgent({ modelSettings })`, chat-tracing spec §6) and `evalRubrics?: Record<string, JudgeRubric>`. Additive. |
| `lib/runtime/nativeAgentRunner.ts` | Forwards `ctx.callSettings` (the eval-run override, carried on `AgentRunCtx.callSettings`, identity spec data model) merged over the agent's `modelSettings` as `callSettings`, and binds `withToolReplayContext` when the run ctx carries replay options. |

### Report model (a)

`buildEvalReport(em, scope, suiteRunId, { includePayloads, evidenceMaxChars = 2000 })` reads the suite run, its case runs, results and AgentRuns through `findWithDecryption`/`findOneWithDecryption`, plus the manifest and the baseline. It computes:

- **Per case × trial:** status, score, latency, cost, tokens, `agentRunId` (trace link `/backend/traces/<id>`), error, and every assertion result with scorer key, type, severity, passed/score, evidence (truncated) and judge feedback (`evidence.feedback`).
- **Flaky detection:** a case is *flaky* when its non-errored trials contain both a pass and a fail. An assertion is *flaky* when its verdict differs across trials of the same case. These are reported only when `repeatCount > 1`.
- **Baseline delta:** per-assertion pass rate, `delta`, `regressed` (deterministic gate drop = the existing `safetyRegressions`) and `judgeDelta`. Per case: `baselineStatus` (matched by case id, which is deterministic for file cases). `sameDataset` is true when the baseline manifest hash equals the current one. A label pin whose hashes differ produces a **dataset-drift warning**.
- **Economics:** total and per-case cost (`costMinor`, currency), latency p50/p95/max, input/output tokens.
- **Environment:** provider and model per run (from `AgentRun`), effective `modelSettings`, `toolMode` (`live | replay | record`), `modelMode` (`live | scripted`), the git SHA from `GITHUB_SHA`/`OM_EVAL_GIT_SHA`, and the CLI version.

### Frozen manifests (b)

```ts
type EvalSetManifest = {
  format: 'open-mercato.agent-eval-set'
  formatVersion: 1
  agentId: string
  label: string | null
  source: 'db' | 'file'
  assertions: Array<{ id: string; key: string; scorerKey: string; type: 'deterministic' | 'llm_judge'
                      severity: 'gate' | 'warn'; title: string; config: Json; rubric?: JudgeRubric }>
  cases: Array<{ id: string; key: string; name: string | null; input: Json; expected: Json | null
                 assertions: EvalCaseAssertionRef[] | null; fixtures?: { tools?: string; model?: string } }>
}
```

- For `source: 'db'`, `freezeManifest` loads the approved cases and every enabled assertion that applies to the agent or `*` (deterministic and judge). Each `rubricRef` is resolved into the frozen `rubric` body, so a rubric edit changes the hash.
- `version = 'sha256:' + canonicalInputKey(manifest)`. Cases are sorted by `key`, assertions by `key`, so authoring order does not change the hash.
- Storage: `summary.__evalSet = { version, label, source, caseCount, assertionCount, carrierSuiteRunId, body? }`. `body` is written only when no completed or running suite run in the same org and agent already carries that version. The summary column is already encrypted (`encryption.ts` → `agent_orchestrator:agent_eval_suite_run`).
- **Pin semantics:**
  - `--snapshot sha256:…` loads the body from its carrier and sets `evalSetVersion` to that hash.
  - `--snapshot latest` freezes the current DB state and pins the resulting hash.
  - `--cases <file>` pins the file's hash.
  - Legacy `--eval-set-version <label>` behaves as before. The column holds the label, the manifest is still frozen and reported, and the report shows `pinKind: 'label'`. `--require-snapshot true` turns a label pin into exit 2.
- **Baselines:** `resolveBaselineSuiteRun` is unchanged (same `evalSetVersion`). A hash pin therefore compares only against runs of the identical dataset.

### File-based eval sets (c)

The file is the `EvalSetManifest` minus generated ids, plus authoring conveniences:

```json
{
  "format": "open-mercato.agent-eval-set",
  "formatVersion": 1,
  "agentId": "content_review.validator",
  "label": "regression-2026-10",
  "assertions": [
    { "key": "schema", "scorerKey": "json_schema", "type": "deterministic", "severity": "gate", "title": "Output matches schema", "config": {} },
    { "key": "rationale", "scorerKey": "llm_judge", "type": "llm_judge", "severity": "warn", "title": "Rationale quality", "config": { "rubricRef": "rationale_quality" } }
  ],
  "cases": [
    { "key": "banned-phrase-01", "name": "Guaranteed returns claim", "input": { "content": "…" },
      "expected": { "overall": "fail" }, "assertions": [{ "key": "schema" }],
      "fixtures": { "tools": "fixtures/banned-phrase-01.tools.json", "model": "fixtures/banned-phrase-01.model.json" } }
  ]
}
```

- Validation: Zod. Every `scorerKey` must exist in the registry and its `config` must pass `parseScorerConfig`, the same write-boundary validation as `POST /eval-assertions`. `gate` severity is refused for `llm_judge` (existing invariant). Keys must be unique.
- Ids: `deterministicCaseId(agentId, key)` and `deterministicAssertionId(agentId, key)`, both UUIDv5. `AgentEvalCaseRun.evalCaseId` and `AgentEvalResult.assertionId` stay non-null and stable across runs, so the baseline can match per case.
- Running a file needs **no** `AgentEvalCase` rows. Replay resolves everything from the manifest. The UI renders a file case run with its manifest name and a "file case" badge, without a link to a case detail page.
- **Import** (`POST /eval-sets/import`, command `agent_orchestrator.evalSets.import`): materializes the file into rows so the cases become editable in the UI. Cases are written with `sourceType: 'file'` (the varchar(20) accepts it, and the TS union widens additively) and `sourceId` = the deterministic id. They are `status: 'draft'` unless `approve: true`, which stamps `approvedByUserId` with the caller. Assertions are upserted by `(org, appliesTo=agentId, key)`. Undo soft-deletes the cases created by the command and restores the assertion configs it overwrote.
- **Export** (`GET /eval-sets/:version/export?agentDefinitionId=`): returns a manifest (or the current DB state when `version=current`) as a file. Round trip: export → `--cases` produces the same hash.
- Location convention, documented and not auto-discovered: `agents/<id>/evals/*.json` for file agents and `<module>/evals/<agentId>/*.json` for code agents. No generator change, so no new auto-discovery contract.

### Reproducibility (d)

**Tool record/replay** (ai-assistant seam):

```ts
export type ToolReplayFixture = { toolName: string; argsKey: string; args: Json; output: Json | null
                                  error?: { message: string } | null; occurrence: number }
export type ToolReplayContext =
  | { mode: 'replay'; fixtures: ToolReplayFixture[]; match: 'strict' | 'ordered'; onMiss: 'error' | 'live' }
  | { mode: 'record'; sink: (fixture: ToolReplayFixture) => void }
export function withToolReplayContext<T>(ctx: ToolReplayContext, fn: () => Promise<T>): Promise<T>
```

- `argsKey = canonicalInputKey(args)`. `strict` matches `(toolName, argsKey, occurrence)`. `ordered` matches the n-th call of `toolName` regardless of args, for inputs that carry generated ids.
- A miss with `onMiss: 'error'` throws `tool_fixture_missing`, which errors the case run (never a silent live call). `onMiss: 'live'` runs the real tool and flags the case `toolMode: 'mixed'` in the report.
- Replay never invokes a handler. This is safe for AO because its agents are read-only, and the wrapper refuses replay for `isMutation` tools as defence in depth.
- **Record:** `eval … --record <dir>` runs live and writes `<dir>/<agentId>/<caseKey>.tools.json`. It also writes a scripted-model fixture `<dir>/<agentId>/<inputKey>.json` built from the native runner's step records: each step's tool calls plus the final object. This is the format `scripted.ts` already reads, so `OM_AI_PROVIDER=scripted OM_AI_SCRIPTED_FIXTURES_DIR=<dir>` replays the model offline.
- **Replay:** `eval … --replay <dir>` (or per-case `fixtures.tools` in the file) binds `withToolReplayContext` around `agentRuntime.run` in `runCase`. The scripted model is opt-in through the existing env vars. The report records the mode.
- **Best-effort export from a stored run:** `--fixtures-from-run <runId>` reads `agent_tool_calls`. It marks a fixture `fidelity: 'summary'` when the stored response is a redacted or truncated summary, and replay of such a fixture produces a report warning.
- **Scope:** native (in-process) runtime only. OpenCode file agents execute tools in `mcp:serve-http`, a different process. They report `toolMode: 'unsupported_runtime'` and run live. Cross-process replay through `AgentRunSession` is out of scope.

**Model settings:** `defineAgent({ modelSettings: { temperature, seed } })` sets agent defaults. `eval --temperature <n> --seed <n>` overrides them for the eval run only. The overrides travel on the run ctx as `AgentRunCtx.callSettings` and reach `runAiAgentObject({ callSettings })`. Providers that ignore `seed` are reported as `seed: { requested: n, honored: 'unknown' }`. Pinning reduces variance but does not guarantee it; `--repeat` plus flaky detection measures the rest. **Coordination (resolved):** one contract, owned by the OSS chat-tracing spec §6 — `modelSettings` on definitions, `callSettings` at call time, both of type `AiAgentCallSettings`; the observer reports what was sent under the same name. The observability spec records it on each LLM span as `gen_ai.request.temperature` / `gen_ai.request.seed`; when those attributes exist, the report reads `honored` from them (`'yes'` when the recorded value equals the request) instead of `unknown`.

### Rubric library (e)

- Built-ins in `lib/eval/rubrics/builtins.ts`, each a `JudgeRubric` (choice scoring, pre-written `evaluationSteps`, `temperature: 0`, `samples: 3`):
  - `rationale_quality`: does the rationale cite the specific input evidence and the rule it applies, without restating the verdict?
  - `groundedness`: is every claim traceable to tool output or input?
  - `appropriate_abstention`: does the agent abstain or flag for review exactly when evidence is insufficient? (Semantic complement to the integrity spec's deterministic `abstain_or_review` rule; assert the deterministic outcome with that spec's `guardrail_check` scorer, `expect: 'outcome:not_applicable'`.)
- Per agent: `defineAgent({ evalRubrics: { key: JudgeRubric } })`, or for file agents `agents/<id>/rubrics/<key>.json`, emitted into the generated manifest by `yarn generate` as an additive optional field on `FileAgentDescriptor` (ask-first item, see Compliance).
- Reference: `llm_judge` assertion config `{ "rubricRef": "rationale_quality" }`. Resolution order: agent rubric, then built-in. An unknown ref is SKIPPED with `evidence.reason: 'unknown_rubric'`, consistent with `invalid_config`. The judge scorer's write schema accepts `rubricRef` as a third union arm.
- `GET /eval-scorers` gains a `rubrics` array (key, title, source) so the assertion form can offer a picker.

### CI recipe (f)

Shipped as `apps/docs/docs/framework/ai-assistant/agent-eval-ci.mdx` (enterprise section), not as a workflow in this repo:

```yaml
name: agent-evals
on: [pull_request]
jobs:
  deterministic:
    runs-on: ubuntu-latest
    services:
      postgres: { image: pgvector/pgvector:pg17, env: { POSTGRES_PASSWORD: postgres }, ports: ['5432:5432'] }
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres
      OM_AI_PROVIDER: scripted
      OM_AI_SCRIPTED_FIXTURES_DIR: agents/content_review.validator/evals/fixtures
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: yarn }
      - run: yarn install --immutable && yarn build:packages && yarn initialize
      - id: scope
        run: echo "tenant=$(psql "$DATABASE_URL" -tAc 'select id from tenants limit 1')" >> "$GITHUB_OUTPUT"   # see Q4
      - run: |
          yarn mercato agent_orchestrator eval --agent content_review.validator \
            --tenant "$OM_EVAL_TENANT_ID" --org "$OM_EVAL_ORG_ID" \
            --cases agents/content_review.validator/evals/regression.json \
            --replay agents/content_review.validator/evals/fixtures \
            --repeat 3 --gate true --fail-on-flaky true \
            --report eval-report --format json,md,junit
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: eval-report, path: eval-report }
      - if: always()
        run: cat eval-report/report.md >> "$GITHUB_STEP_SUMMARY"
```

A second, optional job runs nightly against a live provider: no `OM_AI_PROVIDER=scripted`, no `--replay`, provider keys from repository secrets, `--gate false`. It tracks judge deltas and drift without blocking merges.

**Exit codes** (unchanged meaning, extended triggers):

| Code | Meaning |
|---|---|
| 0 | Gate passed, or report-only run (`--gate` absent) |
| 1 | Gate failed: stored `outcome = failed`, **or** narrowed by `--fail-on-flaky`/`--min-pass-score`, or the gate could not run while `--gate true` |
| 2 | Usage or environment error; advisory run refused under `--gate true`; label pin refused under `--require-snapshot true`; invalid eval set file; report directory not writable |

The report files are written **before** the exit code is set. When the run itself throws, a minimal `report.json` with `status: 'error'` and the message is still written.

## Data Models

**No new tables or columns.** Changes are confined to jsonb shapes and TS unions:

| Location | Change | Compatibility |
|---|---|---|
| `agent_eval_suite_runs.summary` (encrypted jsonb) | New reserved key `__evalSet` (manifest pointer or body); `__judgeDeltas` kept | Additive. `complete` now merges instead of replacing. Aggregation and baseline comparison recompute from result rows and never read `summary`. However, `GET /eval-runs/:id` returns `summary` verbatim, and the page renders it with `JsonDisplay`. That route therefore **strips `__evalSet.body`** and keeps only the pointer fields, so a 5 MiB manifest never reaches the detail payload. A test pins this. |
| `agent_eval_suite_runs.eval_set_version` | May hold `sha256:<64 hex>` | Same column; labels still accepted |
| `AgentEvalCaseSourceType` | `'correction' \| 'golden_run' \| 'file'` | Additive union member; varchar(20) |
| `AgentEvalAssertion.config` (`llm_judge`) | Accepts `{ rubricRef }` | Additive union arm |
| `AgentEvalResult` (judge, eval plane) | `eval_case_run_id` now set for replayed judge results | Column exists; online-plane rows unchanged |

**Size bound:** the canonical manifest JSON is capped by `OM_AGENT_EVAL_SET_MAX_BYTES` (default 5 MiB). Above it, freezing fails with a clear error, and the run does not start silently unpinned.

## API Contracts

All routes are under `/api/agent_orchestrator/`, export `openApi`, use zod-validated query and body, and scope by `tenantId` + `organizationId` from auth.

### `GET /eval-runs/:id/report`
- Feature: `agent_orchestrator.eval.export`.
- Query: `format=json|md|junit` (default `json`), `includePayloads=true|false` (default false), `evidenceMaxChars` (100–20000, default 2000).
- 200: `application/json` (`EvalReport`), `text/markdown; charset=utf-8`, or `application/xml`, with `Content-Disposition: attachment; filename="eval-<suiteRunId>.<ext>"`. 404 when the run is not in scope. 409 `{ error: 'run_not_finished' }` while `queued|running`; `?partial=true` overrides and returns the report with `status: 'running'`.

```ts
type EvalReport = {
  schema: 'open-mercato.agent-eval-report'; schemaVersion: 1
  generatedAt: string; status: 'completed' | 'failed' | 'cancelled' | 'running' | 'error'
  suiteRun: { id: string; agentId: string; trigger: 'manual' | 'ci' | 'scheduled'; outcome: 'passed' | 'failed' | 'advisory' | null
              passScore: number | null; scoreVariance: number | null; repeatCount: number; judgeMayGate: boolean
              startedAt: string | null; finishedAt: string | null; releaseId: string | null }
  evalSet: { version: string | null; pinKind: 'hash' | 'label' | 'none'; manifestHash: string; label: string | null
             source: 'db' | 'file'; caseCount: number; assertionCount: number }
  baseline: { suiteRunId: string | null; manifestHash: string | null; sameDataset: boolean | null; warnings: string[] }
  environment: { models: string[]; modelSettings: { temperature?: number; seed?: { requested: number; honored: 'yes' | 'no' | 'unknown' } }
                 toolMode: 'live' | 'replay' | 'record' | 'mixed' | 'unsupported_runtime'; modelMode: 'live' | 'scripted'
                 gitSha: string | null; cliVersion: string | null }
  totals: { cases: number; trials: number; passed: number; failed: number; errored: number; skipped: number; flakyCases: number
            costMinor: number | null; currency: string | null; latencyMs: { p50: number | null; p95: number | null; max: number | null }
            tokens: { input: number | null; output: number | null } }
  assertions: Array<{ key: string; scorerKey: string; type: string; severity: string; passRate: number | null
                      passed: number; failed: number; skipped: number; baselinePassRate: number | null
                      delta: number | null; regressed: boolean; flaky: boolean }>
  regressions: string[]
  cases: Array<{ id: string; key: string; name: string | null; source: 'db' | 'file'; flaky: boolean
                 baselineStatus: 'passed' | 'failed' | 'error' | 'skipped' | 'absent'
                 input?: Json; expected?: Json | null
                 trials: Array<{ trialIndex: number; caseRunId: string; status: string; score: number | null
                                 latencyMs: number | null; costMinor: number | null; agentRunId: string | null
                                 tracePath: string | null; error: string | null; output?: Json
                                 results: Array<{ assertionKey: string; scorerKey: string; type: string; severity: string
                                                  passed: boolean | null; score: number | null; evidence: Json | null
                                                  judgeFeedback: string | null; skipReason: string | null }> }> }>
}
```

### `GET /eval-sets/:version/export`
- Feature: `eval.export`. Query: `agentDefinitionId` (required), `includeFixtures=false`.
- `:version` = `sha256:…` (resolved from its carrier run) or `current` (frozen on the fly, not persisted).
- 200: the file format (JSON) with `Content-Disposition`. 404 for an unknown version in scope.

### `POST /eval-sets/import`
- Feature: `eval.manage`. Body: `{ file: EvalSetFile, approve?: boolean }` (≤ `OM_AGENT_EVAL_SET_MAX_BYTES`).
- Runs command `agent_orchestrator.evalSets.import` and wires the mutation-guard contract.
- 200: `{ version, created: { cases, assertions }, updated: { cases, assertions } }`. 422 with field-level issues (case key, scorer config).

### `POST /eval-runs` (existing, additive body fields)
- `snapshot?: string` (`sha256:…` | `latest`). When present, `evalCaseIds` becomes optional and the run executes the manifest's cases.

### `GET /eval-scorers` (existing, additive)
- Response gains `rubrics: Array<{ key, title, source: 'builtin' | 'agent' }>` for `?agentDefinitionId=`.

### CLI `mercato agent_orchestrator eval` (existing, additive flags)

| Flag | Meaning |
|---|---|
| `--report <dir>` | Write reports into `<dir>` (created if missing) |
| `--format json,md,junit` | Default `json,md` when `--report` is set |
| `--include-payloads true` | Include case inputs and outputs (decrypted) in reports |
| `--cases <file>` | Run a file eval set (`.json`, `.yaml`, `.yml`) |
| `--snapshot <sha256:…\|latest>` | Pin a frozen manifest |
| `--require-snapshot true` | Refuse label-only pins (exit 2) |
| `--replay <dir>` / `--record <dir>` | Tool (and scripted-model) fixture replay / recording |
| `--on-fixture-miss error\|live` | Default `error` |
| `--fixtures-from-run <runId>` | Best-effort fixture export from a stored run (writes into `--record` dir) |
| `--temperature <n>` / `--seed <n>` | Eval-only model settings |
| `--fail-on-flaky true` | Flaky cases narrow a pass to exit 1 |
| `--min-pass-score <0..1>` | Narrowing threshold (the caller policy that `runEvalGate` deliberately does not own) |
| `--tenant`/`--org` | Unchanged; fall back to `OM_EVAL_TENANT_ID`/`OM_EVAL_ORG_ID` (Q4) |

Also new: `mercato agent_orchestrator eval-set export|validate`. `export --agent --snapshot <v|current> --out <file>` writes a set file. `validate --file <path>` checks the schema and scorer configs offline and exits 0/2.

## Internationalization (i18n)

New keys in `agent_orchestrator/i18n/{en,pl,de,es,ko}.json`:
- `agent_orchestrator.evalRuns.report.download`, `.json`, `.markdown`, `.junit`, `.includePayloads`, `.notFinished`
- `agent_orchestrator.evalRuns.fileCase.badge`, `agent_orchestrator.evalRuns.flaky.badge`, `agent_orchestrator.evalRuns.datasetDrift.warning`
- `agent_orchestrator.evalAssertions.scorer.llm_judge.field.rubricRef`, `agent_orchestrator.evalRubrics.builtin.{rationale_quality,groundedness,appropriate_abstention}.title`

The Markdown and JUnit renderers emit **English** structural labels (a CI artifact, like log output) and are listed in `agent_orchestrator/i18n/.hardcoded-allowlist.json` with that justification.

## UI/UX

Eval run detail (`backend/eval-runs/[id]/page.tsx`):
- A header action menu "Download report" (`DropdownMenu` with JSON, Markdown, JUnit). It downloads through `apiCall` and a Blob, never raw `fetch`. It is visible only with `eval.export`. Shift-click or a checkbox item toggles "Include inputs and outputs".
- `StatusBadge` variants for "Flaky" (`warning`) and "File case" (`neutral`). The "dataset drift" `Alert` (`variant="warning"`) appears when the baseline manifest hash differs under the same label.
- No new page. Start-run dialog: an optional "Snapshot" `Select` (latest / previous hashes from this agent's runs). The dialog keeps its `Cmd/Ctrl+Enter` submit and `Escape` cancel.

### Frontend Architecture Contract (delta only)
- **Server/Client:** the existing client page gains one menu. No new `"use client"` file.
- **Blob guardrail:** the renderers live server-side (API route), so no report code ships to the client.
- **Budget:** route bundle growth ≤ 2 KB gz. Evidence: the bundle report for `/backend/eval-runs/[id]`.
- **Interactivity test:** the menu downloads each format (integration test below).

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `OM_AGENT_EVAL_SET_MAX_BYTES` | `5242880` | Manifest/file size cap |
| `OM_EVAL_TENANT_ID` / `OM_EVAL_ORG_ID` | unset | CLI scope fallback (Q4) |
| `OM_EVAL_GIT_SHA` | unset | Stamped into the report when `GITHUB_SHA` is absent |
| `OM_AI_PROVIDER=scripted`, `OM_AI_SCRIPTED_FIXTURES_DIR`, `OM_AI_SCRIPTED_ALLOW` | existing | Offline model replay |

## Migration & Backward Compatibility

Checked against `BACKWARD_COMPATIBILITY.md`:

| Surface | Category | Change | Verdict |
|---|---|---|---|
| DB schema | 8 ADDITIVE-ONLY | None; jsonb shape additions only | Safe. **No re-squash.** |
| Types (`EvalGateInput`, `RunAiAgentObjectInput` — via the chat-tracing spec §6 —, `DefineAgentInput`, `AgentEvalCaseSourceType`, `FileAgentDescriptor`) | 2 STABLE | Optional fields and union members only | Safe |
| Function signatures (`runEvalGate`, `runLlmJudgeForRun`) | 3 STABLE | Optional trailing parameters / optional input fields | Safe |
| API routes | 7 STABLE | New routes; additive request/response fields on `POST /eval-runs`, `GET /eval-scorers` | Safe |
| `GET /eval-cases/export` envelope | STABLE/ADDITIVE | **Unchanged** (`version: 1`); the new file format is a separate route | Safe |
| CLI `agent_orchestrator eval` | 13 STABLE | New flags; existing flags, defaults and exit codes keep their meaning | Safe |
| ACL features | 10 FROZEN | None added | Safe |
| Events | 5 FROZEN | None added | Safe |
| AI tool ids | 12 FROZEN | None added | Safe |
| Generated manifest (`file-agents.generated.ts`) | 14 STABLE | Optional `evalRubrics` on descriptors | Safe; ask-first per AO AGENTS.md |
| `summary` jsonb readers | Internal + `GET /eval-runs/:id` response | `complete` merges; `__`-prefixed keys reserved; the response gains `__evalSet` (pointer only, body stripped) | Additive response field; covered by unit test |

Existing suite runs have no `__evalSet`. Their reports show `evalSet.manifestHash: null` and `pinKind` derived from the column, and they never fail to render.

## Implementation Plan

### Phase 1: Report (a) and judge linkage fix
1. `lib/eval/report/reportSchema.ts` (Zod + type), `buildEvalReport.ts`, `flaky.ts`. Unit tests over fixture rows.
2. `renderMarkdown.ts`, `renderJunit.ts` (XML-escaped, CDATA for evidence). Golden-file tests.
3. `runLlmJudgeForRun` optional `{ evalCaseRunId, expected, assertions }`. `runCase` passes them. `aggregateSuiteRun` includes judge buckets. Regression test: a replayed suite with one judge assertion has a judge bucket in `summary`.
4. CLI `--report`, `--format`, `--include-payloads`, `--fail-on-flaky`, `--min-pass-score`, env scope fallback. Write before exit; error report on throw.
5. `GET /eval-runs/:id/report` + `openApi`. Download menu on the eval run page + i18n.

### Phase 2: Frozen manifests (b)
1. `lib/eval/manifest.ts` (freeze, hash, resolve carrier, deterministic ids).
2. `evalRuns.start` freezes the manifest. `complete` merges the summary. Unit tests for carrier dedupe and merge.
3. `runCase`/`scoreCaseRun`/judge resolve content and assertions from the manifest when present.
4. CLI `--snapshot`, `--require-snapshot`. `POST /eval-runs` `snapshot`. Report `sameDataset` + drift warning. Snapshot `Select` in the start dialog.

### Phase 3: File-based eval sets (c)
1. `lib/eval/evalSetFile.ts` (schema, parse, `manifestFromFile`, `fileFromManifest`). Validation reuses `parseScorerConfig`.
2. CLI `--cases`, `eval-set export|validate`.
3. `GET /eval-sets/:version/export`, `POST /eval-sets/import` + command `agent_orchestrator.evalSets.import` (undoable). `sourceType: 'file'`. "File case" badge.
4. YAML parse/serialize (`yaml` production dependency, Q2 approved; `yarn npm audit` when adding it). The format is chosen by file extension on CLI input and by `?format=json|yaml` on export.

### Phase 4: Reproducibility (d)
1. `ai-assistant`: `tool-replay-context.ts` + wrapper hook in `agent-tools.ts`. Unit tests in ai-assistant (strict/ordered/miss/mutation refusal).
2. `RunAiAgentObjectInput.callSettings` / `AiAgentDefinition.modelSettings` (chat-tracing spec §6; reuse if landed), `defineAgent.modelSettings` forwarded to `defineAiAgent`, runner forwarding, eval override on `AgentRunCtx.callSettings`.
3. CLI `--record`, `--replay`, `--on-fixture-miss`, `--fixtures-from-run`, `--temperature`, `--seed`. Scripted-model fixture writer from step records. Report environment block.

### Phase 5: Rubric library (e) and CI recipe (f)
1. Built-ins + `resolveRubricRef` + judge write-schema arm + `GET /eval-scorers` `rubrics`.
2. `defineAgent.evalRubrics`. File-agent `rubrics/*.json` → generator → descriptor (ask first).
3. Docs page with the workflow, exit codes and the fixture-handling warning. `yarn template:sync:fix` is not needed (no app files).

### File Manifest

| File | Action |
|---|---|
| `packages/enterprise/src/modules/agent_orchestrator/lib/eval/report/{reportSchema,buildEvalReport,renderMarkdown,renderJunit,flaky}.ts` | Create |
| `…/lib/eval/{manifest,evalSetFile}.ts`, `…/lib/eval/rubrics/{builtins,index}.ts` | Create |
| `…/lib/eval/{evalGate,evalReplayService,llmJudge}.ts`, `…/lib/eval/registry/judge.ts` | Modify |
| `…/commands/evalRuns.ts`, `…/commands/evalSets.ts` | Modify / Create |
| `…/api/eval-runs/[id]/report/route.ts`, `…/api/eval-sets/[version]/export/route.ts`, `…/api/eval-sets/import/route.ts` | Create |
| `…/api/eval-runs/route.ts`, `…/api/eval-scorers/route.ts`, `…/data/validators.ts`, `…/data/entities.ts` (union only) | Modify |
| `…/cli.ts`, `…/backend/eval-runs/[id]/page.tsx`, `…/i18n/*.json` | Modify |
| `…/lib/sdk/defineAgent.ts`, `…/lib/runtime/nativeAgentRunner.ts` | Modify |
| `packages/ai-assistant/src/modules/ai_assistant/lib/llm-adapters/tool-replay-context.ts` | Create |
| `packages/ai-assistant/src/modules/ai_assistant/lib/{agent-tools,agent-runtime}.ts` | Modify |
| `apps/docs/docs/framework/ai-assistant/agent-eval-ci.mdx` | Create |

## Testing Strategy

**Unit (Jest)**
- `eval-report-build.test.ts`: totals, p50/p95, cost null-handling, skipped exclusion, payload exclusion by default, evidence truncation.
- `eval-report-flaky.test.ts`: mixed-trial cases and assertions flagged; errored trials excluded; nothing flagged at `repeatCount = 1`.
- `eval-report-render.test.ts`: Markdown and JUnit golden files; XML escaping of evidence containing `]]>`, `<`, `&`.
- `eval-judge-linkage.test.ts`: replayed judge results carry `evalCaseRunId`, judge buckets appear, `__judgeDeltas` is populated against a baseline, and `expected` reaches the judge.
- `eval-manifest.test.ts`: hash stable across key order and authoring order; a rubric edit changes the hash; carrier dedupe; `complete` merge keeps `__evalSet`; size cap.
- `eval-set-file.test.ts`: schema validation, unknown scorer, judge-gate refusal, duplicate keys, deterministic ids, export→import→hash round trip.
- `eval-pinned-replay.test.ts`: editing a live case after freezing does not change what a hash-pinned run executes.
- `ai-assistant/lib/__tests__/tool-replay-context.test.ts`: strict and ordered matching, `tool_fixture_missing`, `onMiss: live` flags mixed, mutation tool refused, record sink receives full output.
- `cli-eval-exit-codes.test.ts`: 0/1/2 matrix including narrowing flags, the report written before exit, and the error report on throw.

**Integration (Playwright, `__integration__/`, self-contained fixtures via API, cleanup in `finally`)**
- `TC-AGENT-EVAL-REPORT-001`: create cases + assertions via API, `POST /eval-runs` (≤5 case runs, sync), then `GET /eval-runs/:id/report` for json/md/junit. Assert schema, content type, 403 without `eval.export`, 404 for another org's run.
- `TC-AGENT-EVAL-REPORT-002`: eval run page "Download report" menu present with `eval.export`, absent without; JSON download parses.
- `TC-AGENT-EVAL-SET-001`: `POST /eval-sets/import` (draft + approved), then `GET /eval-sets/current/export` round trip; 422 on an invalid scorer config; undo removes the imported cases.
- `TC-AGENT-EVAL-SET-002`: `POST /eval-runs { snapshot: 'latest' }` twice with a case edit in between. The pinned replay of the first hash ignores the edit, and the report shows `sameDataset`.
- `TC-AGENT-EVAL-REPLAY-001`: with `OM_AI_PROVIDER=scripted` and a fixture directory, a CLI run with `--replay` produces identical case verdicts across two runs, and a missing tool fixture errors the case.

All agent runs in tests use the scripted provider. No test relies on seeded demo data.

## Risks & Impact Review

### Data Integrity Failures
- Freezing at `start` happens inside the existing command transaction. If the manifest cannot be frozen (size cap, invalid config), the suite run is not created. Pinned replays read immutable bodies, so concurrent case edits cannot interleave. The carrier lookup races on the first two runs of a new hash; both carry the body, which is harmless duplication.

### Cascading Failures & Side Effects
- The report build is read-only. Record mode runs live tools, which are read-only for AO agents. Replay never runs handlers.

### Tenant & Data Isolation Risks
- Every read goes through `findWithDecryption` with `{ tenantId, organizationId }`. Carrier resolution filters by org + agent, so a hash collision across tenants cannot load another tenant's body. The CLI scope comes from explicit flags or env and never defaults to "first tenant".

### Migration & Deployment Risks
- No migration. Old suite runs render. The `summary` merge change is the only write-path change, and it is covered by tests.

### Operational Risks
- Large manifests are bounded by the cap. Report generation for 500 cases × 5 trials streams per case run (paged reads of 100). The p95 target is under 5 s for 2,500 case runs.

### Risk Register

#### Sensitive data escapes into files and git
- **Scenario:** `--include-payloads`, `--record` or set export writes decrypted tenant inputs, outputs or tool results to disk, and someone commits them.
- **Severity:** High
- **Affected area:** Reports, fixtures, eval set files
- **Mitigation:** Payloads are off by default. Record and export print a warning naming the directory. Fixture writer and report header carry a `containsTenantData: true` marker. The docs prescribe synthetic or public data for git-committed sets. The API requires `eval.export`, the same feature as the existing case export.
- **Residual risk:** An operator can still commit real data. This is accepted as an explicit, warned action, like the existing export.

#### Replay masks a real regression
- **Scenario:** Stale tool fixtures make the agent pass while production tools now return different data.
- **Severity:** Medium
- **Affected area:** CI gate confidence
- **Mitigation:** The report states `toolMode`/`modelMode` prominently. The recipe pairs the replay gate with a nightly live job. `fidelity: 'summary'` fixtures produce warnings.
- **Residual risk:** Replay proves code determinism, not world fidelity. This is documented.

#### Manifest storage outgrows the summary column
- **Scenario:** Many distinct large manifests bloat `agent_eval_suite_runs`.
- **Severity:** Low
- **Affected area:** Storage
- **Mitigation:** Body only on the carrier run, a 5 MiB cap, and the migration path to a dedicated table (Q1).
- **Residual risk:** Each distinct dataset version costs one body. That is acceptable for a ≥6-year legal record.

#### Judge-linkage fix changes reported numbers
- **Scenario:** Suites start showing judge buckets and deltas that were silently missing.
- **Severity:** Low
- **Affected area:** Eval run UI and summary readers
- **Mitigation:** Judges stay `warn` in CI (`judgeMayGate: false`), so gate outcomes cannot change. The release notes mention it.
- **Residual risk:** None material.

## Final Compliance Report — 2026-10-21

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`
- `packages/ai-assistant/AGENTS.md` (tool and provider seams; via the root Task Router)
- `packages/core/AGENTS.md` (API routes, commands, encryption)
- `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md` (download menu, `apiCall`)
- `.ai/qa/AGENTS.md` (integration coverage)
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Filter by organization_id / no cross-tenant data | Compliant | All reads scoped; carrier lookup org-scoped |
| root AGENTS.md | Validate inputs with zod | Compliant | File format, query and body schemas in `data/validators.ts` |
| root AGENTS.md | `findWithDecryption` for encrypted reads | Compliant | Summary, case, result and run reads |
| root AGENTS.md | No hard-coded user-facing strings | Compliant | UI strings in i18n; CI artifact labels allowlisted with justification |
| root AGENTS.md | Ask before production dependencies | Compliant (approved) | `yaml` approved 2026-10-22 (Q2) |
| AO AGENTS.md | Squash-only migrations | Compliant | No schema change |
| AO AGENTS.md | Eval/trace rows append-only | Compliant | New results inserted; suite-run summary written by the existing start/complete commands only |
| AO AGENTS.md | Propose-only; writes via Command path | Compliant | Import is a command; replay never executes handlers |
| AO AGENTS.md | Every route exports `openApi`; custom writes wire the mutation guard | Compliant | Import route wires it |
| AO AGENTS.md | Ask before changing the committed manifest shape (`FileAgentDescriptor`) | Ask first | Optional `evalRubrics`; Phase 5 step 2 gated |
| AO AGENTS.md | `llm_judge` never `gate` | Compliant | File validation refuses it |
| packages/core AGENTS.md | Commands undoable | Compliant | `evalSets.import` undo defined |
| packages/ui AGENTS.md | `apiCall`, DS tokens, `StatusBadge`, dialog shortcuts | Compliant | Download via `apiCall`; badges via `StatusBadge` |
| BACKWARD_COMPATIBILITY.md | Additive-only on contract surfaces | Compliant | See the Migration table |
| `.ai/qa/AGENTS.md` | Integration tests for new API/UI paths, self-contained | Compliant | Five TCs listed |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Report fields derive from existing columns + manifest |
| API contracts match UI/UX section | Pass | Download menu ↔ report route; snapshot select ↔ `POST /eval-runs.snapshot` |
| Risks cover all write operations | Pass | start/complete merge, import, fixture/report files |
| Commands defined for all mutations | Pass | `evalSets.import`; runs use existing commands |
| Cache strategy covers all read APIs | Pass (N/A) | Reports are computed on demand; no cache introduced |

### Non-Compliant Items
None. One ask-first item (generated descriptor field) is open; the YAML dependency (Q2) was approved on 2026-10-22.

### Verdict
**Approved for implementation of Phases 1–4** once Q1–Q5 are confirmed. Phase 5 step 2 waits for the ask-first approval.

## Changelog

### 2026-10-21
- Initial specification. Motivated by content-validation use cases, generalized to all AO agents. Code facts recorded: the CLI prints only a summary; `evalSetVersion` is free text and replays read live, editable rows; replayed judge results lack `evalCaseRunId`, so they never reach the suite summary, and the judge does not receive `expected`; the scripted provider scripts tool calls but tools still execute live; there are no model temperature/seed settings for agents; the registry holds 22 scorer definitions (text 4, structured 4, tools 4, economics 3, agent 6, judge 1), while the workbench spec says 21.
- 2026-10-21 — cross-spec consistency pass: model settings aligned to the single OSS contract in the chat-tracing spec §6 (`modelSettings: AiAgentCallSettings` on definitions, forwarded from AO `defineAgent` to `defineAiAgent`; call-time `callSettings`; the eval override travels as `AgentRunCtx.callSettings` instead of an ad-hoc `evalOverrides`; `EvalGateInput.modelSettings` renamed `callSettings`); `honored` read from the observability spec's `gen_ai.request.*` span attributes; shared AO migration policy stated, `agent_eval_set_snapshots` listed in the roadmap's next-re-squash list; scorer count note (23 with the integrity spec's `guardrail_check`); `appropriate_abstention` rubric positioned against the integrity `abstain_or_review` rule; linked sibling specs and the roadmap.

### 2026-10-22
- Q2 resolved: `yaml` approved as a production dependency of `@open-mercato/enterprise`. YAML eval sets ship in Phase 3 (the former Phase 3b is merged into it).

### 2026-10-26
- Review fix: `escapeMarkdownCell` also escapes `&`, `<` and `>` (in that order, before newlines become `<br>`), so agent output pasted into GitHub job summaries renders as inert text instead of markup.
