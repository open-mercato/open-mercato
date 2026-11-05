# Agent Eval Workbench & Regression Gate

> **Status:** Draft (revised after two architectural review rounds) · **Created:** 2026-07-19
> **Module:** `agent_orchestrator` (enterprise) · **Subdomain:** eval
> **Supersedes:** `gap-analysis/gap-04-eval-harness.md`; and the `AgentEvalSuiteRun` sketch in
> `2026-06-20-agent-eval-harness-and-metrics.md:206-235` (see §4.1 delta table), together with that spec's
> `/eval-suite-runs` route, its `eval --release` CLI signature, and its migration ownership of
> `agent_eval_suite_runs`.
> **Extends:** `2026-06-20-agent-eval-harness-and-metrics.md` (implemented, PR #3532) — scorer/judge model.
> **Consumed by:** `2026-06-19-agent-deployment-and-regression-gating.md`. That spec **owns** `AgentRelease`,
> `/lifecycle/releases`, `release.*` ACLs, `promote`, shadow/canary, the autonomy ramp and `AgentBudget`.
> This spec exports `runEvalGate()` for its `EvalGateRunner`. **Call-graph dependency: lifecycle → eval, one-way.**
> **Normative:** `2026-06-19-agent-orchestrator-conventions.md` — where it conflicts with an entity sketch here, it wins.
> **Depends:** `ai_assistant` (`AiModelFactory`, optional), `storage-s3` (optional), `packages/queue`, `packages/events`

## TLDR

The eval subsystem ships an *online observability* plane: deterministic scorers run inline at trace ingest
and stamp `AgentRun.evalScore`/`evalPassed`. It does not ship an *evaluation* plane. Nothing replays an
`AgentEvalCase`, no entity records a suite run in code, and the UI cannot author an assertion's config,
view a case, or trigger anything.

This spec adds that plane: a **typed scorer registry** whose config is generated into a clickable form, a
**replay engine** executing cases through the real `agentRuntime.run`, **suite-run persistence** with live
progress, a **backoffice workbench**, and a **CLI gate** exporting `runEvalGate()` for the lifecycle spec
to consume.

## 1. Problem Statement

Three failures, each traceable to shipped code.

**1.1 — Assertion config is unauthorable.** `evalAssertionCreateSchema` types `config` as
`z.unknown().optional()` (`data/validators.ts:360`); the column is free-form `jsonb`. Scorers read
`config.requiredKeys` / `config.threshold` positionally with inline `typeof` checks
(`lib/eval/scorers.ts:56,71`) and silently fall back on malformed values. The form therefore renders nothing
beyond a key dropdown — the "New evaluation assertion" screen cannot set a threshold, so `min_confidence` is
unconfigurable through the UI that exists to configure it. An unknown scorer key is silently skipped
(`lib/eval/evalRuntimeService.ts:54`): no result, no error.

**1.2 — Cases are inert, and the scorer signature is why.** The implemented harness spec mandates:

```ts
type Scorer = (run: ScorerRunView, expected?: Json, config?: Json) => ScorerVerdict
```

Shipped code is `ScorerInput = { output, run, config }` with `Scorer = (input: ScorerInput) => ScorerVerdict`
(`lib/eval/scorers.ts:14-18,26`) — **`expected` is absent, and `ScorerRunFacts` carries only `confidence`
and `status`, so there is no path to reach it.** This is an implementation deviation from an accepted spec
and the root cause of the dead flywheel: `AgentEvalCase.expected` exists, is encrypted, is populated by
every correction — and no scorer can read it. Consequently `AgentEvalCase.assertions`
(`data/entities.ts:423`) is never written; it is read once, in the export, where it always serializes
`null`. `AgentEvalAssertion.version` is frozen at 1, so `evalSetVersion` has nothing to pin.

**1.3 — Evaluation only happens as a side effect of production traffic.** `evaluateRun` is invoked solely
from `commands/trace.ts:38`. A run producing no tool calls and no latency returns early
(`lib/runtime/openCodeAgentRunner.ts:343`) and is **never evaluated at all**. There is no on-demand path.

**1.4 — One assertion per key per agent.** `@Unique({ name: 'agent_eval_assertions_key_uq', properties: ['organizationId', 'appliesTo', 'key'] })`
(`data/entities.ts:454`) permits exactly one row per `(org, appliesTo, key)`, because `key` currently serves
two roles at once: *which scorer runs* and *which assertion this is*. Two `contains` assertions checking
different strings are unrepresentable. Shipped code already works around this with an undocumented
`config.scorer` indirection (`lib/eval/evalRuntimeService.ts:53`, commented at `scorers.ts:87`).

Downstream: no case detail view, no approve action (`api/eval-cases/[id]/approve/route.ts` exists; no
caller anywhere in `backend/`), no case authoring, and suite-level results have nowhere to live in code.

## 2. Prior Art Review

Surveyed promptfoo, Inspect AI, DeepEval, Ragas, OpenAI Evals, Langfuse, Braintrust `autoevals`. Findings
that changed this design:

- **A judge must not emit a number.** Braintrust's `choice_scores` has the model pick a *letter* from
  concretely-described mutually-exclusive cases; the platform owns the float. DeepEval's 0–10 integer needs
  a `top_logprobs` probability-weighting hack to be usable, and its own FAQ routes flaky-score complaints
  to `DAGMetric` — a deterministic decision graph — as the remedy. Choice-based scoring is our default.
- **Reasoning must precede the verdict structurally.** OpenAI Evals' `cot_classify` reverses line order to
  parse bottom-up; Inspect binds the **last** `GRADE:` match. We order `reasoning` before `choice` in the
  judge's structured output schema, so ordering is enforced by schema rather than prompt wording.
- **The judge prompt is an injection surface.** Inspect rewrites `[BEGIN DATA]`/`[END DATA]` markers
  *inside model-controlled text*. Agent output is untrusted input to the judge.
- **Braintrust separates `name` from `slug`.** An instance identifier distinct from the scorer identity —
  the shape §3.1 adopts to resolve 1.4.
- **Per-case assertion overrides must be designed in from day one.** Ragas needed a parallel class
  (`InstanceRubrics` vs `RubricsScore`) to retrofit them; DeepEval and Braintrust still have none.
- **Normalize every score to 0–1, `null` = skipped, skipped excluded from aggregates.** Braintrust's
  invariant; what makes heterogeneous scorers averageable and diffable.
- **Threshold direction must be explicit.** DeepEval's `BiasMetric` threshold is a maximum while every
  other metric's is a minimum — folklore encoded per-type.
- **Judges gate on regression-vs-baseline, not an absolute number.**
- **`seed` does not buy reproducibility.** Inspect: temperature 0 **and** seed **and** run multiple epochs
  to *measure* variance.

Rejected, consistent with gap-04: a second test runner (`vitest-evals`) and any external platform
(Braintrust/LangSmith) — data egress of PII-bearing, ≥6yr-retained, tenant-scoped records.

## 3. Proposed Solution

Four layers, plus a gate runner exported to the lifecycle spec.

### 3.1 Typed scorer registry (fixes 1.1, 1.2 and 1.4)

**Splitting `key` (resolves 1.4).** `AgentEvalAssertion` gains `scorer_key` varchar(100) NOT NULL — *which
scorer runs*. `key` keeps its column, its length and **its unique index unchanged**, and is redefined as the
*instance slug*. This is not a new concept: it formalizes the shipped `config.scorer` indirection rather
than removing it.

```sql
ALTER TABLE agent_eval_assertions ADD COLUMN scorer_key varchar(100);
UPDATE agent_eval_assertions SET scorer_key = COALESCE(config->>'scorer', key);
ALTER TABLE agent_eval_assertions ALTER COLUMN scorer_key SET NOT NULL;
```

The backfill is exactly today's resolution rule, so every existing row keeps its current behavior. `config`
retains `scorer` as a `@deprecated` read-fallback for ≥1 minor; the per-scorer `configSchema` strips it
rather than rejecting it.

```ts
/** lib/eval/types.ts */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export type ScorerRunView = {
  input: Json | null
  output: Json | null
  resultKind: 'informative' | 'actionable' | null
  confidence: number | null
  status: string
  latencyMs: number | null
  costMinor: number | null
  inputTokens: number | null
  outputTokens: number | null
  toolCalls: ReadonlyArray<{ toolName: string; args: Json | null; status: string; sequence: number }>
  stepCount: number
  disposition: string | null
}

/**
 * SKIPPED is represented by `passed: null` ALONE. `score: null` accompanies it, but `passed` is the
 * single source of truth — there is no separate boolean flag. Invariant: score === null ⟺ passed === null.
 * Skipped results are excluded from score AND pass aggregation alike: never 0, never failing.
 */
export type ScorerVerdict = { passed: boolean | null; score: number | null; evidence?: Json }

export type ScorerField =
  | { name: string; kind: 'number'; labelKey: string; hintKey?: string; min?: number; max?: number; step?: number; required?: boolean; default?: number }
  | { name: string; kind: 'text' | 'textarea' | 'json'; labelKey: string; hintKey?: string; required?: boolean }
  | { name: string; kind: 'string-list'; labelKey: string; hintKey?: string; required?: boolean }
  | { name: string; kind: 'boolean'; labelKey: string; hintKey?: string; default?: boolean }
  | { name: string; kind: 'select'; labelKey: string; hintKey?: string; options: ReadonlyArray<{ value: string; labelKey: string }>; required?: boolean; default?: string }

export type ScorerDefinition<TConfig = unknown> = {
  scorerKey: string
  labelKey: string
  group: 'text' | 'structured' | 'tools' | 'economics' | 'agent' | 'judge'
  /** Maps to the shipped `AgentEvalAssertion.type` column. Only 'deterministic' may carry severity 'gate'. */
  kind: 'deterministic' | 'llm_judge'
  configSchema: z.ZodType<TConfig>
  fields: ReadonlyArray<ScorerField>
  /**
   * Derived from config, not static: a comparison scorer with `source: 'config'` needs no `expected`.
   * Drives a UI hint and the runtime skip. Returns false for scorers that never read `expected`.
   */
  needsExpected: (config: TConfig) => boolean
  score: (run: ScorerRunView, expected: Json | null, config: TConfig) => ScorerVerdict
}
```

`score` stays a **pure function** — no `EntityManager`, no request scope — preserving gap-04's shared-scorer
premise.

**Catalog — 21 definitions: 20 deterministic + 1 judge.** With the deprecated `min_confidence` alias, 22
keys resolve. (promptfoo ships ~40 type *names*; these fold into params because `key` is now an instance
slug and a scorer may be instantiated many times per agent.)

| Group | `scorerKey` (count) | Config |
|---|---|---|
| text (4) | `equals`, `contains`, `regex`, `starts_with` | `value`, `caseInsensitive`, `match: any\|all`, `path?`, `source` |
| structured (4) | `json_valid`, `json_schema`, `json_match`, `json_path_compare` | `schema`, `path`, `mode: exact\|subset`, `ignore[]`, `operator: eq\|ne\|gt\|gte\|lt\|lte\|in\|contains`, `value`, `source` |
| tools (4) | `tool_used`, `tool_args_match`, `tool_sequence`, `tool_count` | `name\|pattern`, `min`, `max`, `args`, `mode: partial\|exact`, `steps[]`, `order: in_order\|exact` |
| economics (3) | `latency`, `cost`, `step_count` | `threshold`, `direction` |
| agent (5) | `confidence_threshold`, `disposition_equals`, `output_present`, `required_keys`, `no_pii` | `threshold`, `direction`, `expected: auto_approved\|user_task`, `requiredKeys[]`, `patterns[]` |
| judge (1) | `llm_judge` | `JudgeRubric` (§3.2) |

`llm_judge` is a **first-class registry member** with `kind: 'llm_judge'`, so `GET /eval-scorers` projects
it like any other and the assertion form can render it. Its `fields[]` describe the rubric's scalar
controls; §3.5's bespoke builder is a richer *alternative* editor for the same config, not a separate path.

Two catalog-wide rules from the prior-art review:
- **`negate: boolean`** is a field on every assertion, not a `not_`-prefixed scorer.
- **`direction: 'gte' | 'lte'`** is explicit on every threshold-bearing scorer. `latency`/`cost` are `lte`;
  `confidence_threshold` is `gte`.

**The `source` discriminator keeps the online plane working.** Comparison scorers take
`source: 'expected' | 'config'` (default `'expected'`). With `source: 'config'` the comparison target comes
from the assertion's own config — the only mode available online, where there is no case and therefore no
`expected`. `needsExpected(config)` returns `config.source === 'expected'` for these scorers.

`json_match` defaults to `mode: 'subset'` — an `expected` payload rarely enumerates every field.

`confidence_threshold` and `disposition_equals` are the differentiator: no surveyed project models
disposition, and "did this correctly escalate to a human instead of auto-approving" is precisely the
assertion an orchestration platform needs and promptfoo cannot express.

**Deprecations.** Only `min_confidence` is deprecated, as an alias of `confidence_threshold`. `required_keys`
is **carried into the registry unchanged as its own scorer** — not folded into `json_match`. The reason is
narrow and is about migration safety, not expressiveness: `json_match` with `source: 'config'` could express
it, but rewriting existing rows risks a verdict change on the online plane for zero user benefit.
Precisely: `required_keys` is **not seeded at all** by `lib/eval/defaultAssertions.ts:21-64` (it needs a
`requiredKeys` config, so an unconfigured seed would be a no-op), and the only seeded `gate` assertion is
`output_present`. The rows at risk are therefore **user-authored** `required_keys` assertions, which may
carry `gate` severity and whose config we must not rewrite blind. New assertions should prefer `json_match`;
the old scorer stays.

**Validation replaces silent fallback.** `config` is parsed with the resolved scorer's `configSchema` at the
API boundary; an unknown `scorer_key` or malformed config is a **422 on write**. At *evaluation* time a
config that fails to parse, or a `scorer_key` absent from the registry, writes a **SKIPPED result with
evidence** (`{ reason: 'unknown_scorer' | 'invalid_config' }`) — visible in the trace UI, but it does **not**
flip `evalPassed`. Writing a *failed* result there would turn a config typo into a production gate failure.

### 3.2 Judge upgrade (answers Q4)

`JudgeRubric` is the `llm_judge` scorer's config, validated by a discriminated-union schema:

```ts
type JudgeRubric = {
  promptTemplate: string                    // {{input}} {{output}} {{expected}}
  inputs?: Record<string, string>           // template var -> JSONPath into the run/case
  scoring:
    | { kind: 'choice'; choices: Array<{ key: string; description: string; score: number }>; allowSkip?: boolean }
    | { kind: 'scale'; min: number; max: number; anchors?: Record<number, string> }
    | { kind: 'binary'; passDescription: string; failDescription: string }
  evaluationSteps?: string[]                // pre-written; NEVER auto-generated at runtime
  fewShot?: Array<{ inputs: Record<string, string>; choice: string; reasoning?: string }>
  requireReasoning: boolean                 // default true
  model?: string
  temperature: number                       // default 0
  seed?: number
  samples: number                           // default 1; must be odd when aggregation = 'majority'
  aggregation: 'majority' | 'mean' | 'min'
  threshold: number                          // on the normalized 0..1 score
  direction: 'gte' | 'lte'
}
```

- `kind: 'choice'` is the default and what the form offers first.
- `requireReasoning: true` puts `reasoning` **before** `choice` in the `generateObject` schema.
- `evaluationSteps` are authored, not generated. A "suggest steps" affordance may write into the field at
  authoring time; there is no runtime generation call (DeepEval's documented variance source).
- Every judge input string passes through `neutralizeJudgeDelimiters()` before templating.

**Gate policy (Q4).** Severity coercion is removed from the route (`api/eval-assertions/route.ts:37-38`).
Gating is decided by the *plane*:

```ts
type GatePolicy = { judgeMayGate: boolean }
```

- **Manual workbench run** → `{ judgeMayGate: true }`. A human reads the result; rubrics decide pass/fail.
- **CI gate and online ingest** → `{ judgeMayGate: false }`. Judge results are recorded and reported but
  never change the outcome, preserving determinism and reproducible promotion.

`AgentEvalResult` records the judge verdict identically in both planes; only aggregation differs.

**CI judge reporting is regression-relative.** Absolute judge thresholds are not used in CI; the suite
summary reports judge-score delta against the baseline suite run. Baseline resolution ships in Phase 3
alongside this behavior.

### 3.3 Replay engine

A case run performs **fresh inference** — scoring stored outputs cannot detect regressions, which is the
entire purpose. Settled here; both prior specs left it unstated.

```
resolveAgent   ensureAgentsLoaded() + getAgentEntry(agentDefinitionId)
loadCase       findOneWithDecryption(AgentEvalCase)      // input + expected are ENCRYPTED
execute        agentRuntime.run(agentId, case.input, ctx)
               ctx.onRunPersisted -> capture FIRST runId only (nested runs also fire it)
project        AgentRun + AgentSpan + AgentToolCall -> ScorerRunView
resolve        assertions = suite defaults ∪ case.assertions overrides
score          each assertion -> AgentEvalResult (eval_case_run_id set)
aggregate      AgentEvalCaseRun -> AgentEvalSuiteRun
```

**Assertion resolution.** `AgentEvalCase.assertions` becomes typed:

```ts
type EvalCaseAssertionRef = {
  assertionId: string        // uuid — the unambiguous reference
  configOverride?: Json      // shallow-merged, then RE-VALIDATED against the scorer's configSchema
  disabled?: boolean
}
```

References are by `assertionId`, not by key: the unique index is per `(org, appliesTo, key)`, so a `'*'` row
and an agent-specific row routinely share a slug and a key-based reference would be ambiguous.

**Precedence.** The effective set is enabled assertions matching `appliesTo ∈ {agentId, '*'}`, where an
agent-specific row **shadows** a `'*'` row sharing the same `key` slug. Case-level refs then apply:
`disabled` removes, `configOverride` merges.

**Overrides are re-validated.** The merged config is parsed against the scorer's `configSchema` before use.
An override that fails validation yields a SKIPPED result with `{ reason: 'invalid_config' }`. Without this,
a case-level override would reintroduce the exact malformed-config-silently-tolerated failure that §1.1
exists to eliminate.

**Replay is propose-only.** `dispositionService.dispose` is **never** invoked by the eval plane. Proposals
created during a replay are stamped `source: 'eval'` and excluded from the caseload queue. Without this, a
replayed `actionable` agent could clear an auto-approve threshold and mutate production data.

**Failure isolation.** A case that throws records `status: 'error'` on its `AgentEvalCaseRun` and does not
abort the suite. Errored cases are excluded from `pass_score` and counted in `error_count`.

**Repeat count.** `repeatCount` (default 1) executes each case N times; the case run stores per-trial scores
and the suite reports **score variance**.

**Optional-peer degradation.** Both cross-module dependencies are soft-optional, resolved via `tryResolve`
in `try/catch`; this module owns the glue and neither is a hard `requires`:

| Peer | Absent behavior |
|---|---|
| `ai_assistant` (`AiModelFactory`) | `llm_judge` assertions return SKIPPED with `{ reason: 'no_model_factory' }`. Deterministic assertions and the suite outcome are unaffected. |
| `storage-s3` | Evidence truncates to the bounded inline excerpt; no artifact key written. The case run does not error. |

### 3.4 Suite runs, queue, live progress

Queue `agent-orchestrator-eval-suite`, payload `{ suiteRunId }` **only** — the worker re-resolves
tenant/org from the row, matching the stated `AgentTaskRunJobPayload` rationale (`lib/queue.ts:20-23`) that
a forged payload must not cross tenants.

Progress reuses the SSE path shipped in `3dc74dcd5`: `/api/events/stream` → `useAppEvent`. No new transport.

**Cross-process delivery and the payload cap.** Unlike the OpenCode runner — which emits from the web
request process because its run is synchronous — the eval worker runs in a **separate process**. Broadcast
events do cross process boundaries (`packages/events/src/bus.ts:314-320` → `packages/events/src/bridge.ts`,
PostgreSQL `LISTEN/NOTIFY` on `om_event_bridge`), so SSE is sufficient and **no polling loop may be added**
(`.ai/lessons.md:565`). Two conditions are load-bearing:

- The payload MUST carry `tenantId`/`organizationId` — `bus.ts:314` publishes cross-process only when
  `isBroadcastEvent(event) && hasTenantScope(payload)`.
- The serialized envelope MUST stay **under 4 KB**, against the bridge's `MAX_MESSAGE_BYTES = 7_000`
  (`bridge.ts:8`). Above the limit the event is **dropped with only a `logger.warn`** (`bridge.ts:167-170`) —
  the UI would appear frozen with no error anywhere. The `eval_case_run.*` payload is therefore ids,
  counters, status, and a label truncated to 120 characters; never an error body, tool args, or case input.
  A unit test asserts the serialized size.

`.ai/lessons.md:455` and `:575` state that worker-emitted events never reach the browser. That predates the
cross-process bridge and is **no longer accurate**; both should be amended after Phase 3 proves this path.

**Concurrency.** Eval case runs are admitted through a dedicated org-scoped concurrency lane, separate from
the production dispatch lane, so a large suite cannot starve live agent traffic.

### 3.5 Workbench UI

- **Eval cases**: detail page (decrypted `input`/`expected` behind `eval.manage`), create/edit/duplicate,
  approve + archive row actions, per-case assertion overrides, "Run this case".
- **Eval assertions**: form fields generated from `ScorerDefinition.fields`; for `llm_judge`, a richer
  builder with a choice→score mapping table, reasoning toggle, threshold slider, and a **live preview
  against a real historical run** before saving (Langfuse's pattern).
- **Evaluations**: trigger (agent → case selection → assertion selection → repeat count, with estimated cost
  before confirm), history list, and a result view with per-case pass/fail, expected-vs-actual diff, judge
  reasoning, score variance, and a link to the underlying trace.

### 3.6 Gate runner exported to the lifecycle spec

`AgentRelease`, the `/lifecycle/releases` routes, `release.*` ACLs and `promote` **stay in
`2026-06-19-agent-deployment-and-regression-gating.md`**. That spec already had the correct one-way
dependency (*"degrade the CI gate to advisory until the harness lands"*); this spec preserves it.

```ts
export function runEvalGate(input: {
  agentDefinitionId: string
  releaseId?: string               // stamped onto the suite run; the caller owns release identity
  evalSetVersion?: string          // omitted ⇒ ad-hoc run, no dataset pin
  baselineSuiteRunId?: string
  repeatCount?: number
  scope: { tenantId: string; organizationId: string }
}): Promise<{
  suiteRunId: string
  passScore: number | null
  safetyRegressions: string[]
  outcome: 'passed' | 'failed' | 'advisory'
}>
```

**`outcome` is computed here and is authoritative.** The rule:

| Condition | `outcome` |
|---|---|
| `evalSetVersion` omitted, or the eval plane ran advisory-only | `advisory` |
| non-empty `safetyRegressions` | `failed` |
| `passScore === null` (every case errored) | `failed` — **an unmeasurable gate is a failed gate**, never a pass |
| otherwise | `passed` |

`EvalGateRunner` (lifecycle spec) **MUST NOT** promote on `outcome: 'failed'`. Its own
`passScore >= evalGate.requiredPassScore` check is an *additional, narrower* block layered on top — it may
reject what this function passed, never admit what it failed. Safety-regression blocking is **unconditional**;
an earlier draft proposed a `blockOnSafetyRegression` toggle on `eval_gate` and it is withdrawn, because
converting that invariant into a configurable flag is a material change to the platform's safety posture.

**Reproducibility pushed upstream (Q2).** As specified today, `AgentRelease` pins `agent_definition_id` + a
free-form `version` varchar + a `model` id string — no prompt snapshot, no hash, no git sha — so two gate
runs of the same release id can execute different prompts (`gap-analysis/2026-07-07-security-analysis-gap-review.md`).
The fix belongs on that entity, not a copy of it, and is filed as an upstream change to the lifecycle spec:
`prompt_hash` varchar(64), `definition_snapshot` jsonb, and a `promote` 409 on hash mismatch — additional to
its existing next-stage semantics, with its stage union, `'shadow'` default, `rollout_pct` and `autonomy`
untouched. **Those spec edits ship with this document; the corresponding code is the lifecycle spec's
Phase 4.** Phase 5 here therefore delivers `runEvalGate()` unconditionally, and the *reproducible-subject*
guarantee is contingent on that sibling phase — stated in §7 and tracked in §8.

When `2026-07-07-lightweight-agent-runtime.md` lands `AgentDefinitionVersion`, `version` repoints at it and
the snapshot becomes a cache; ownership of staleness transfers there.

## 4. Data Models

MikroORM v7 legacy decorators, matching `data/entities.ts` house style.

### 4.1 `AgentEvalSuiteRun` (`agent_eval_suite_runs`) — supersedes the harness-spec sketch

Append-only (no `updatedAt`/`deletedAt`), ≥6yr retention. Sketched at
`2026-06-20-agent-eval-harness-and-metrics.md:206-235`, never implemented. Per **Q3**, one entity serves
both planes, which requires relaxing its nullability.

| Column | Harness spec | Here | Rationale |
|---|---|---|---|
| `release_id` | uuid NOT NULL | uuid **nullable** | ad-hoc workbench runs have no release; set from `runEvalGate`'s `releaseId` |
| `eval_set_version` | varchar NOT NULL | **nullable** | ad-hoc runs pin no dataset snapshot |
| `pass_score` | float NOT NULL | **nullable** | a suite where every case errors has no meaningful score |
| `agent_definition_id` | — | **added**, NOT NULL | the subject; the only field both planes always have |
| `trigger`, `status`, `judge_may_gate`, `repeat_count`, `error_count`, `score_variance`, `baseline_suite_run_id` | — | **added** | see below |

`trigger` = `manual | ci | scheduled`. `status` = `queued | running | completed | failed | cancelled`.
`judge_may_gate` records the policy in force, so a stored result is self-describing.
Retained unchanged: `outcome` (`passed | failed | advisory`), `case_count`, `safety_regressions`, `summary`,
`triggered_by`, and both indexes, plus `_agent_idx (organization_id, agent_definition_id, created_at)`.

### 4.2 New — `AgentEvalCaseRun` (`agent_eval_case_runs`)

Append-only. `suite_run_id`, `eval_case_id`, `agent_run_id` (nullable — null when the run never started),
`trial_index` int default 0, `status` (`pending|running|passed|failed|error|skipped`), `score` float
nullable, `passed` boolean **nullable** (null = skipped), `latency_ms`, `cost_minor`, `error_message` text
nullable, `created_at`. Indexes: tenant/org, `_suite_idx (suite_run_id, created_at)`,
`_case_idx (eval_case_id, created_at)`.

`agent_run_id` is the load-bearing link: every case run points at a **real** `AgentRun` with real spans,
tool calls, tokens and cost — so the trace inspector works on eval runs with no new UI. A case run with
`status: 'error'` and null `agent_run_id` produces **no** `AgentEvalResult` rows, which is why
`AgentEvalResult.agent_run_id` can remain NOT NULL (`data/entities.ts:528`).

### 4.3 Modified

| Entity | Change | Rationale |
|---|---|---|
| `AgentEvalAssertion` | add `scorer_key` varchar(100) NOT NULL, backfilled `COALESCE(config->>'scorer', key)` | Resolves 1.4; `key` becomes the instance slug, unique index unchanged |
| `AgentEvalAssertion` | `config` validated per scorer; `version` incremented on config change | `evalSetVersion` finally has something to pin |
| `AgentEvalResult` | add `eval_case_run_id` uuid **nullable** | null ⇒ online ingest result; set ⇒ eval-plane result |
| `AgentEvalResult` | `passed` boolean → **nullable** | `passed: null` is the sole skipped marker; **no `skipped` column** — one source of truth |
| `AgentEvalCase` | `assertions` typed as `EvalCaseAssertionRef[]`; merged config re-validated | Gives the dead column meaning (§3.3) |
| `AgentRun` | none | `evalScore`/`evalPassed` keep online semantics |

**Aggregation rule.** A skipped result — `passed: null`, `score: null` — is excluded from the score mean
**and** from the pass computation. A case whose every assertion skipped is `status: 'skipped'`, not
`'passed'`. Invariant, asserted in unit tests: `score === null ⟺ passed === null`.

> **Three existing sites treat null as `false` and MUST change in the same phase that introduces
> nullability (Phase 1), or the invariant above is silently inverted:**
>
> | Site | Today | Required |
> |---|---|---|
> | `components/types.ts:424` | `passed: asBoolean(item.passed) ?? false` — coerces skipped → **failed** | preserve `null`; widen `EvalResultView.passed` (`:135`) to `boolean \| null` |
> | `backend/traces/[id]/page.tsx:1015` | binary ternary, no null branch → skipped renders a **fail badge**; pass counter at `:723` under-reports against a denominator that includes skipped | third `StatusBadge` state; exclude skipped from both numerator and denominator |
> | `lib/eval/evalRuntimeService.ts:76` | `gate.every((v) => v.passed)` — a null verdict makes `evalPassed` **false** | filter `passed === null` before `every` |

**Encryption.** `agent_eval_case.input`/`expected` are already mapped (`encryption.ts:22-30`). New sensitive
columns — `AgentEvalCaseRun.error_message` and `AgentEvalSuiteRun.summary` — are added to
`defaultEncryptionMaps`; raw reads use `findWithDecryption`/`findOneWithDecryption`. Judge feedback in
`AgentEvalResult.evidence` is redacted to a bounded excerpt with full bodies offloaded to `storage-s3` by
key, matching `AgentToolCall`'s pattern. Model-controlled text rendered in the result view (judge reasoning,
JSON diff) is escaped as text, never HTML.

## 5. API Contracts

Every CRUD route uses `makeCrudRoute` with `indexer: { entityType: 'agent_orchestrator:<entity>' }` and
**MUST `export const openApi`** via `createAgentOrchestratorCrudOpenApi` — per the normative conventions doc
`:206` and the precedent at `api/eval-assertions/route.ts:166`.

| Route | Method | Feature | Notes |
|---|---|---|---|
| `/eval-scorers` | GET | `eval.manage` | registry projection: `scorerKey`, `group`, `kind`, `labelKey`, `fields[]`. **Drives the generated form.** |
| `/eval-cases` | GET, POST, PUT | `eval.manage` | **no DELETE** — ≥6yr legal record; use archive |
| `/eval-cases/[id]` | GET | `eval.manage` | decrypted `input`/`expected` |
| `/eval-cases/[id]/archive` | POST | `eval.manage` | approve endpoint already exists |
| `/eval-runs` | GET, POST | `eval.run` | POST enqueues; returns `{ suiteRunId }` |
| `/eval-runs/[id]` | GET | `eval.manage` | suite run + **paginated** case runs |
| `/eval-runs/[id]/case-runs/[caseRunId]/results` | GET | `eval.manage` | assertion results for one expanded case run |
| `/eval-runs/[id]/cancel` | POST | `eval.run` | |
| `/eval-assertions/preview` | POST | `eval.manage` | dry-run against an existing `AgentRun` (Phase 3) |

All paths prefixed `/api/agent_orchestrator`. **This supersedes the harness spec's
`GET /eval-suite-runs[?releaseId=]`** — one resource, one path.

**Pagination and query cost.** `GET /eval-runs/[id]` pages case runs by keyset on
`(suite_run_id, created_at)` — served by `_suite_idx` — `pageSize` default 50, hard cap 100. Assertion
results are **not** inlined; they load per expanded case run. Expected query count: 2 for the suite detail
read, 1 per expansion. Without the split, a 500-case suite at `repeatCount` 3 would inline ~1,500 case runs
into a response the live-progress UI re-fetches during the very run producing it.

**Caching.** `GET /eval-scorers` is a projection of code, not data: in-memory for the process lifetime, no
tenant scoping (no tenant data), no invalidation (a deploy replaces the process). Everything else uncached —
suite and case runs are live during a run. Cache miss rebuilds synchronously from the registry.

**ACL additions** (`acl.ts`): `agent_orchestrator.eval.run` (dependsOn `eval.manage`). **No `release.*`
features here** — they remain with the lifecycle spec.

**Commands**: `agent_orchestrator.evalRuns.start` / `.complete` / `.cancel`,
`agent_orchestrator.evalCases.create` / `.update` / `.archive` — following the `evalCases.approve` pattern
(`commands/corrections.ts:186-264`): zod parse → `enforceRecordGoneIsConflict` → idempotency check →
`enforceCommandOptimisticLock` → `withAtomicFlush` → `emitAgentOrchestratorEvent(..., { persistent: true })`.
There is no delete command because there is no delete route.

**Reversibility.** `evalCases.archive` is reversible via the existing `approve`; create/update are undone by
their inverse. `evalRuns.*` are append-only — a suite run is an immutable ≥6yr record, so the inverse of
`start` is `cancel` (a terminal transition), never a delete. Promotion rollback stays with the lifecycle spec.

**Events** (`events.ts`, singular entity, past-tense action):

| Event | Emitter | Flags |
|---|---|---|
| `eval_suite_run.started` | `evalRuns.start` command, `{ persistent: true }` | |
| `eval_case_run.started` / `.completed` | eval-suite worker, per case transition | `clientBroadcast`, `excludeFromTriggers` |
| `eval_suite_run.completed` | `evalRuns.complete` command, `{ persistent: true }` | `clientBroadcast` |

Per-case progress is carried by the `eval_case_run.*` pair emitted directly by the worker — there is no
`eval_suite_run.progressed`, since a transient per-case echo has no command to own it.

**CLI**: `yarn mercato agent-orchestrator eval --agent <id> [--release <id>] [--eval-set-version <v>] [--baseline <suiteRunId>] [--repeat N] [--gate]`
— a thin wrapper over `runEvalGate()`, writing an `AgentEvalSuiteRun` with `trigger: 'ci'`,
`judgeMayGate: false`, exiting non-zero on `outcome: 'failed'`. Every flag is optional exactly as the
function's input is. **This supersedes the harness spec's `eval --release <id> --gate` signature.**

## 6. Frontend Architecture Contract

- **Server/Client boundary.** `page.tsx` + `page.meta.ts` stay server components handling auth, feature
  guards, `resolveTranslations()`. Client leaves: generated assertion form, judge builder, run trigger
  dialog, live-progress strip.
- **`"use client"` ledger.** `AssertionConfigFields` (Phase 1), `JudgeRubricBuilder` (Phase 3),
  `EvalRunTriggerDialog` (Phase 4), `EvalRunProgress` (Phase 3). The result view is server-rendered with the
  progress strip as a client island — a completed run must render without JS.
- **Blob guardrail.** JSON diff rendering dynamically imported, loaded only on case-run expansion; must not
  enter the shared backend chunk.
- **DS compliance.** `StatusBadge` for status (never raw `text-green-*`/`text-red-*`),
  `FormField`/`SectionHeader`/`CollapsibleSection`, `LoadingMessage`/`Spinner`, `EmptyState`, lucide-react
  icons (no inline `<svg>`), `Cmd/Ctrl+Enter` submit and `Escape` cancel on dialogs, `aria-label` on every
  icon-only button. Boy Scout: touched lines in `backend/eval-assertions/page.tsx` and
  `backend/eval-cases/page.tsx` migrate to semantic tokens.
- **HTTP.** `apiCall` only. `CrudForm` for case + assertion authoring (optimistic locking auto-derived from
  `initialValues.updatedAt`); the trigger dialog is not a `CrudForm`, so it wraps its POST in
  `useGuardedMutation(...).runMutation(...)` and passes `retryLastMutation` into the injection context.
- **i18n.** `agent_orchestrator.evalRuns.*`, `.evalCases.*`, `.evalAssertions.*` in `i18n/{en,de,es,pl}.json`,
  extending the flat alphabetized convention. Scorer labels extend `evalAssertions.scorer.<scorerKey>`.
- **Budgets.** No shared-chunk growth beyond 15 KB gzipped; diff viewer excluded by dynamic import.
  Evidence before merge: route bundle report for the three new pages.

## 7. Phasing

**Phase 1 — Scorer registry and authorable assertions.** `scorer_key` column + backfill migration;
`ScorerDefinition` with `configSchema` + `fields` + `needsExpected`; `ScorerRunView` gains `input`, `expected`
becomes a second parameter; 21-definition catalog with the `source` discriminator; `min_confidence`
deprecated-aliased; config validated at the API boundary; `GET /eval-scorers`; generated form.

*Online-plane behavior changes — three, deliberate and enumerated* (this phase is **not** behavior-neutral,
and an earlier draft wrongly claimed it was):

| Change | Before | After | Guard |
|---|---|---|---|
| Unknown/invalid scorer config | silent `continue`, no row (`evalRuntimeService.ts:54`) | SKIPPED result with evidence | `passed: null` excluded from aggregation ⇒ `evalPassed` unchanged |
| `confidence_threshold` on a run with null confidence | `{ passed: false, score: 0 }` (`scorers.ts:73-75`) | **unchanged — preserved verbatim** as a documented exception to the skip doctrine | registry regression test |
| `config.scorer` indirection | undocumented runtime override | promoted to the `scorer_key` column; `config.scorer` kept as a `@deprecated` read-fallback ≥1 minor | backfill uses the identical rule |

Gated by a **registry regression test**: old scorers vs new registry over the *online* path, fixtures MUST
include (a) `required_keys` with no `expected`, (b) a run with null `confidence`, (c) a row using
`config.scorer`.

**Phase 1 also carries these, none of which are optional** (from the pre-implementation analysis,
`.ai/specs/analysis/ANALYSIS-2026-07-19-agent-eval-workbench-and-gate.md`):

| Step | Why |
|---|---|
| Migration: `scorer_key` three-step add, **plus** `ALTER TABLE agent_eval_results ALTER COLUMN passed DROP NOT NULL` (`Migration20260623155649:11` created it NOT NULL). Post-condition `count(*) WHERE scorer_key IS NULL = 0` before `SET NOT NULL` | nullability is introduced here, so its consumers change here |
| Fix the three null-as-false sites listed in §4.3 | otherwise the skipped invariant is inverted on merge |
| Remove `import { scorers }` from `backend/eval-assertions/page.tsx:24`; source keys from `GET /eval-scorers` | the registry now carries zod schemas, `score` bodies and PII regexes — shipping it to the browser blows §6's 15 KB budget |
| `yarn generate` + add `scorer_key` to `api/eval-assertions/route.ts` `fields` and `sortFieldMap` | otherwise the column is invisible to the query engine (`entity-fields-registry.ts:55-71`) |
| Migrate `__tests__/eval-scorers.test.ts` and `eval-runtime.test.ts` to the new signature | they call `scorers.output_present({ output, run, config })` directly and are the regression test's baseline |
| `@deprecated` `ScorerInput` alias + `getScorer` wrapper | `lib/eval/*` is publicly reachable via wildcard exports — see §8 |

*Ships: assertions become clickable, and multiple instances per scorer become possible.*

**Phase 2 — Replay engine and suite runs.** `AgentEvalSuiteRun` + `AgentEvalCaseRun` + migrations;
`EvalReplayService` with propose-only enforcement; assertion resolution with `assertionId` refs, precedence
and override re-validation; typed `AgentEvalCase.assertions`; commands; `POST /eval-runs` **synchronous only
when `caseCount × repeatCount ≤ 5`**, 422 above that until Phase 3. Online/offline scorer parity test.
*Ships: an evaluation can be run via API.*

**Phase 3 — Queue, progress, judge, baselines.** Worker + `eval_case_run.*` broadcast + dedicated
concurrency lane; `JudgeRubric` with choice scoring, reasoning-first output, delimiter neutralization,
samples/aggregation; `GatePolicy`; severity coercion removed; `/eval-assertions/preview`; **baseline
resolution and regression-relative judge reporting**. *Ships: async runs with live progress; rubrics gate
manual runs.*

**Phase 4 — Workbench UI.** Case CRUD + detail + approve/archive; judge builder with live preview; trigger
dialog with cost estimate; result view with diff and variance. *Ships: usable without touching an API.*

**Phase 5 — Gate runner and CLI.** `safety_regressions` computation; exported `runEvalGate()` with the
`outcome` rule; the CLI. *Ships: `EvalGateRunner` has something to call. The reproducible-subject guarantee
additionally requires the lifecycle spec's Phase 4 (`prompt_hash` + promote 409); until then the gate is
honest but its subject is unpinned.*

## 8. Risks & Impact Review

| Risk | Severity | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|
| Phase 1 changes online verdicts | **High** | Registry refactor alters a `gate` verdict; production runs fail `evalPassed` with no agent change | Three changes enumerated in §7 rather than denied; unknown-config yields SKIPPED (excluded from aggregation), not failed; null-confidence behavior preserved verbatim; registry regression test with three mandated fixtures | Low |
| `scorer_key` backfill collides with the unique index | Medium | An org holds both `min_confidence` and `confidence_threshold` for the same `appliesTo`; an in-place key rename violates `agent_eval_assertions_key_uq` | `key` is **not** renamed — only `scorer_key` is added. `min_confidence` rows keep slug `min_confidence` and get `scorer_key = 'confidence_threshold'`. No collision is possible | Low |
| Replay executes real mutations | **High** | A replayed `actionable` agent clears an auto-approve threshold and mutates production data | `dispositionService.dispose` never invoked; eval proposals stamped `source: 'eval'` and excluded from caseload; asserted by TC-AGENT-EVAL-004 | Low |
| Case-level override bypasses validation | Medium | `configOverride` reintroduces malformed config, the failure §1.1 exists to kill | Merged config re-validated against `configSchema`; failure yields SKIPPED with evidence | Low |
| Prompt injection into the judge | **High** | Agent output contains rubric-shaped text and coerces a passing verdict | `neutralizeJudgeDelimiters()` on every model-controlled input; reasoning before choice in the schema; the model emits a letter, not a score | Low |
| PII leak through the workbench | **High** | Case detail decrypts `input`/`expected`; judge evidence quotes raw output | Detail route behind `eval.manage`, org-scoped 404; bounded excerpts with bodies in `storage-s3`; `error_message`/`summary` encrypted; model text escaped | Low |
| Unmeasurable gate silently passes | **High** | Every case errors, `pass_score` is null, and a null-vs-threshold comparison admits the release | `outcome` computed in `runEvalGate` with `passScore === null ⇒ 'failed'`; `EvalGateRunner` may only narrow, never widen | Low |
| Suite-detail response collapses the UI | Medium | 500-case suite × repeat 3 inlines ~1,500 case runs the progress UI re-fetches | Keyset pagination (cap 100); results per expanded case run only | Low |
| Eval suite starves production traffic | Medium | A large suite saturates the shared admission lane | Dedicated org-scoped eval concurrency lane | Low |
| Replay cost blowout | Medium | 500 cases × repeat 3 against an expensive model burns budget silently | `caseCount × repeatCount` cap, estimated cost before confirm, `cost_minor` aggregated | Medium — needs a real budget once `AgentBudget` lands |
| Judge gating in manual runs is non-reproducible | Medium | Two manual runs disagree; a human reads it as a regression | temp 0 + seed + odd-sample majority; variance surfaced; judge results visually separated; CI unaffected | Medium — inherent to judges |
| Phase 5 ships before its subject is pinned | Medium | The gate runs against a live prompt file that can change between measurement and promotion | §7 states the contingency explicitly; the lifecycle spec's Phase 4 carries `prompt_hash` + the 409; gate is honest-but-unpinned until then | Medium — cross-spec sequencing |
| `definition_snapshot` goes stale | Medium | Once `AgentDefinitionVersion` lands, the snapshot becomes a cache with no named invalidator | Ownership transfers to `2026-07-07-lightweight-agent-runtime.md` in the same change | Medium |
| Suite run partially completes | Medium | Worker dies mid-suite; the run sits in `running` and the UI spins | Terminal transition on worker failure; stale-run reaper; cancel endpoint | Low |

**Backward compatibility.** Contract surfaces touched:

| Surface | Change | Protocol |
|---|---|---|
| `lib/eval/scorers.ts` exported types — `Scorer`, `ScorerInput`, `ScorerRunFacts`, `ScorerVerdict`, `getScorer()` | `ScorerInput` removed; `Scorer` gains params; `ScorerVerdict.passed` widens to `boolean \| null`, `score` becomes required `number \| null`; `getScorer` keyed by `scorerKey` | **These ARE a contract surface.** `packages/enterprise/package.json:58-59` exports `"./*/*/*/*/*"` → `./src/*/*/*/*/*.ts`, and `modules/agent_orchestrator/lib/eval/scorers` is exactly five segments, so `@open-mercato/enterprise/modules/agent_orchestrator/lib/eval/scorers` resolves for any third party — there is no barrel, but the deep path is public. The deprecation protocol applies unconditionally: retain `ScorerInput` as a `@deprecated` type alias and `getScorer(key)` as a `@deprecated` wrapper delegating to the `scorerKey` lookup, both ≥1 minor, with an UPGRADE_NOTES entry. Cheap to honour — no internal consumer imports these types. |
| Scorer key `min_confidence` | deprecated alias of `confidence_threshold` | `@deprecated`, ≥1 minor, UPGRADE_NOTES |
| `config.scorer` | promoted to `scorer_key` column | read-fallback retained ≥1 minor |
| `AgentEvalAssertion` | `scorer_key` added NOT NULL with backfill | additive; unique index untouched |
| `AgentEvalResult` | `eval_case_run_id` added; `passed` widened to nullable | additive + widening, safe for readers |
| `AgentEvalCase.assertions` | previously always `null`, now populated | additive for readers |
| `eval-assertions` route | `config` validated (malformed → 422); `llm_judge` severity coercion removed, so a judge assertion may carry `gate`, honored only when `judgeMayGate` | called out in UPGRADE_NOTES |
| eval-case export envelope | gains `evalSetVersion` | additive; `version` stays `1` |

No entity removed, no event id changed, no route deleted. `DELETE /eval-cases` is **not** introduced.

## 9. Integration Coverage

Playwright, `__integration__/TC-AGENT-EVAL-<NNN>.spec.ts`, following the existing convention. The eval-run
result view holds an open SSE connection, so per `.ai/lessons.md:301` these tests MUST use
`waitForLoadState('domcontentloaded')` plus an explicit readiness assertion — never `networkidle`, which
never settles on an SSE page and produces deterministic false failures.

| TC | Path | Asserts |
|---|---|---|
| EVAL-001 | `GET /eval-scorers` | 21 definitions projected incl. `llm_judge`; every one exposes `fields[]`; `openApi` served |
| EVAL-002 | `POST /eval-assertions` | malformed config → 422; unknown `scorer_key` → 422; **two `contains` assertions with different slugs coexist for one agent** |
| EVAL-003 | `POST /eval-cases` + `GET /eval-cases/:id` | authoring; detail decrypts; list still omits `input`/`expected`; **DELETE not routed** |
| EVAL-004 | `POST /eval-runs` | suite completes; case runs link a real `agentRunId`; **no proposal from an eval run reaches the caseload queue** |
| EVAL-005 | case-level overrides | `assertionId` ref resolves unambiguously when `'*'` and agent-specific share a slug; agent-specific shadows `'*'`; invalid override → SKIPPED |
| EVAL-006 | judge gating | same suite: `judgeMayGate: true` fails, `false` passes |
| EVAL-007 | error isolation | one erroring case does not abort the suite; excluded from `pass_score`; counted in `error_count`; produces no `AgentEvalResult` rows |
| EVAL-008 | skipped semantics | `needsExpected` scorer on a case with `expected: null` → `passed: null`, excluded from both aggregates; all-skipped case is `skipped`, not `passed` |
| EVAL-009 | unmeasurable gate | a suite where every case errors returns `outcome: 'failed'`, never `passed` |
| EVAL-010 | pagination | `GET /eval-runs/:id` caps at 100 case runs, pages by keyset, does not inline results |
| EVAL-011 | ACL | `eval.run` required for POST; org-scoped 404 across tenants |

Unit: scorer catalog table-driven per definition; **registry regression** old-vs-new over the online path
with the three mandated fixtures (gates Phase 1); online/offline parity (Phase 2); judge parsing incl.
injected delimiters and stray choice letters in reasoning; assertion resolution precedence + merge;
aggregation with skipped/errored exclusion and the `score === null ⟺ passed === null` invariant;
`scorer_key` backfill equivalence; optional-peer absence.

## 10. Final Compliance Report

| Rule | Status |
|---|---|
| Plural snake_case tables, singular past-tense events | ✅ |
| No cross-module ORM relationships | ✅ FK ids only |
| Tenant/org scoping on every query | ✅ worker re-resolves scope from the row |
| Cross-module touchpoints: mechanism, owner, absent behavior | ✅ §3.3 |
| Zod validation everywhere, incl. merged case overrides | ✅ §3.3 |
| Encryption maps for sensitive columns | ✅ |
| Optimistic locking on editable entities | ✅ |
| Append-only eval records, ≥6yr; no destructive route | ✅ no `DELETE /eval-cases` |
| All mutations are commands | ✅ |
| Undo/rollback documented | ✅ §5 |
| Pagination ≤ 100, keyset, query count stated | ✅ |
| Cache strategy, invalidation, miss behavior | ✅ |
| `openApi` + `entityType` on every CRUD route | ✅ |
| Canonical primitives | ✅ |
| DS tokens, no arbitrary values | ✅ §6 |
| i18n, no hardcoded strings | ✅ |
| Deprecation protocol for renamed keys and exported types | ✅ §8 table |
| One independently deployable capability | ✅ `AgentRelease` owned by the lifecycle spec |
| Single owner per resource across specs | ✅ entity, route, CLI and migration all superseded explicitly |
| No second test runner, vendor platform, or data egress | ✅ |

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Scorer registry and authorable assertions | Done | 2026-07-19 | 21 definitions, `scorer_key` split, generated form, skipped verdicts. Code review found 2 High + 3 Medium, all fixed (see below). 108 suites / 789 tests pass; `build:packages` green. |
| Phase 2 — Replay engine and suite runs | Done | 2026-07-19 | `AgentEvalSuiteRun` + `AgentEvalCaseRun`, replay through the real runtime, per-case assertion overrides, `POST /eval-runs` (sync, ≤5 case runs). Code review found 1 Critical + 4 High, all fixed (below). 111 suites / 814 tests pass; `build:packages` green. |
| Phase 3 — Queue, progress, judge, baselines | Done | 2026-07-19 | Queue + worker + live progress + judge upgrade + gate policy + baseline comparison + assertion preview. 112 suites / 841 tests pass; `build:packages` green. |
| Phase 4 — Workbench UI | Done | 2026-07-19 | Case CRUD + detail + approve/archive, eval-run history + result view with live progress and three-state verdicts. 112 suites / 841 tests pass; `build:packages` green. |
| Phase 5 — Gate runner and CLI | Done | 2026-07-19 | Exported `runEvalGate()` + `mercato agent_orchestrator eval` CLI. 112 suites / 850 tests pass; `build:packages` green. |

### Phase 1 — Detailed Progress

- [x] `lib/eval/types.ts` — `Json`, `ScorerRunView`, `ScorerVerdict` (nullable `passed`), `ScorerField`, `ScorerDefinition`
- [x] `lib/eval/registry/` — 21 definitions across 6 groups + central `negate`, config validation, key resolution
- [x] `lib/eval/projectRunView.ts` — pure ORM-row → `ScorerRunView` projection
- [x] `scorer_key` column + three-step backfill migration (`Migration20260719120000`), `passed` DROP NOT NULL, snapshot updated
- [x] `lib/eval/scorers.ts` retained as a `@deprecated` shim preserving the original call shape and types
- [x] `evalRuntimeService` on the registry; skipped verdicts excluded from both aggregations
- [x] `GET /eval-scorers` + `openApi`; `scorer_key` in `fields` / `sortFieldMap` / filters; 422 on invalid config; `version` now increments
- [x] Assertion form generated from descriptors; direct registry import removed from the client bundle
- [x] Null-as-false fixes: `components/types.ts`, `backend/traces/[id]/page.tsx` (third skipped state, corrected ratio)
- [x] `__tests__/eval-registry.test.ts` — catalog, key resolution, skip semantics, and the three mandated regression fixtures
- [x] i18n `en` + `pl`
- [x] UPGRADE_NOTES entries for both deprecations and the nullability widening
- [ ] i18n `de` + `es` — keys fall back to the scorer key until translated

**Phase 1 code review — findings fixed**

- **High: the gate could fail open.** The new zod schemas were STRICTER than the code they replaced, so a
  stored config that used to produce a real verdict now failed validation and skipped — and a skip is
  excluded from aggregation. A `threshold: 85` (percent-vs-fraction) gate assertion that previously failed
  every run would have started passing. Fixed by splitting `configSchema` (evaluation, deliberately as
  lenient as the old code via `.catch()`) from the new optional `writeConfigSchema` (422 at the API
  boundary, where rejection cannot move a stored verdict). This was a **fourth** online behaviour change on
  top of the three the phase declared; §7's table now reflects the real set.
- **High: the seeded judge assertion would 422 on its enable toggle.** `llm_judge_helpfulness` is a slug
  that was never a scorer name — judge rows dispatched off the `type` column, not by key. The backfill now
  maps `type = 'llm_judge'` to the `llm_judge` scorer, and the update route re-validates only when the
  scorer or config actually *changes* (comparing against stored values, not merely checking presence), so a
  round-trip of an untouched legacy row cannot start failing.
- **Medium**: `negate` and any unrendered config key were dropped on UI edit (config is now seeded from the
  stored row and overlaid); deprecated scorer options are kept in the select so an existing row can render
  its own value; `EvaluateRunResult.evaluated` keeps its original meaning with `scored` added additively.
- **Low**: skipped-reason code for not-applicable runs, subtree scoring in `jsonSubsetMatch` (a diverging
  subtree now costs all its leaves rather than one mismatch), `__proto__`/`constructor` guard in
  `resolvePath`, blank tool-sequence step no longer matches every tool, dead `type` select removed.

### Phase 2 — Detailed Progress

- [x] `AgentEvalSuiteRun` + `AgentEvalCaseRun` entities, migration, encryption maps, indexes
- [x] `EvalReplayService` — fresh inference via `agentRuntime.run`, per-case failure isolation, aggregation
- [x] Assertion resolution: `assertionId` refs, agent-specific shadows `'*'`, override re-validation
- [x] Commands `evalRuns.start` / `.complete` / `.cancel`; events; ACL `eval.run`; `defaultRoleFeatures`
- [x] `POST /eval-runs` (sync ≤5 case runs, 422 above), `GET /eval-runs`, `GET /eval-runs/:id` (keyset-paged), per-case-run results route, cancel route
- [x] Online/offline scorer parity test with whole-catalog fixture coverage
- [ ] Integration specs EVAL-004/007/009 — deferred with the rest of §9 to Phase 4, when the UI paths they drive exist

**Phase 2 code review — findings fixed**

- **Critical: `POST /eval-runs` could never have worked.** `AgentEvalSuiteRun.id` is
  `defaultRaw: gen_random_uuid()`, so Postgres assigns it at INSERT — but `withAtomicFlush` defers the flush
  to the end of its callback, so `suiteRun.id` was `undefined` when the child case runs read it, violating
  `suite_run_id NOT NULL`. TypeScript could not catch it (`id!: string` is a definite-assignment assertion),
  and neither could the tests, whose fake EM invented ids on flush. Fixed by pre-generating the uuid, the
  same pattern `commands/runs.ts` already uses. The new `eval-runs-commands.test.ts` uses a fake EM that
  deliberately does **not** assign ids, so this class of bug fails the suite.
- **High: the propose-only guarantee had four holes.** Stamping `source: 'eval'` *after* the run meant
  (a) nested sub-agent proposals were never stamped, (b) three of five terminal paths skipped stamping
  entirely, (c) `proposal.created` — a `clientBroadcast` event — fired before the stamp, so the caseload
  refetched and rendered a replay proposal as live operator work, and (d) a list filter is not enforcement:
  `POST /proposals/:id/dispose` had no `source` guard and the id is reachable from the trace inspector.
  Fixed by threading `source` through `AgentRunCtx` into both `createRun` and `createProposal`, so records
  are **born tagged** and nested delegations inherit the tag; plus a hard 422 in the dispose command.
- **Medium**: the `outcome` rule hardcoded `passScore >= 1`, which made `requiredPassScore` dead
  configuration and failed a 99%-passing suite — now matches §3.6 with no absolute threshold; the suite now
  transitions to `running` and stamps `started_at`; cancelling terminates the remaining `pending` case runs
  instead of orphaning them; eval replays are excluded from `metricRollupService` (via a new `AgentRun.source`)
  so a 500-case suite cannot skew the dashboards used to judge the agent.
- **Low**: `parseCaseAssertionRefs` now parses through the same zod schema the write path uses instead of a
  second hand-rolled parser; the deterministic-only assertion filter is documented.

**Deferred, recorded as a follow-up:** a replay runs under the *operator's* identity (no `runAs` principal),
so the gate measures the agent with a different tool surface and write guard than production. Resolving it
needs principal resolution; tracked for Phase 3 alongside the worker.

### Phase 3 — Detailed Progress

- [x] Dedicated `agent-orchestrator-eval-suite` queue + `eval-suite-runner` worker (concurrency 1, own lane so a suite cannot starve production dispatch); `{ suiteRunId }`-only payload with scope re-resolved from the row
- [x] `POST /eval-runs` returns **202 + queued** above 5 case runs instead of refusing; ≤5 still runs inline
- [x] Live progress: `eval_case_run.started/.completed` emitted on every terminal path, payload bounded well under the bridge's 7 KB `pg_notify` drop threshold
- [x] `runAs` resolved — replays now execute under the **agent's own principal**, closing the Phase 2 follow-up: measuring under the operator's identity gave the agent a different tool surface and write guard than production
- [x] `JudgeRubric`: choice/scale/binary scoring, reasoning-before-verdict enforced by the output schema, delimiter neutralization, pre-written evaluation steps, odd-sample majority vote, explicit threshold direction; legacy `{ rubric: string }` lifted into a binary rubric rather than rejected
- [x] `GatePolicy` — severity coercion removed from the route; a judge assertion may now be declared `gate`, honoured only on the manual plane
- [x] Judge wired into the replay, invoked per case with the suite's stored policy
- [x] **Baseline resolution + regression-relative reporting** — `resolveBaselineSuiteRun` picks the previous completed run for the same agent (same `evalSetVersion` when pinned, so a dataset change is never reported as an agent regression); `compareToBaseline` turns a drop in a deterministic `gate` assertion into a `safetyRegression` that fails the outcome, while a judge drop is only ever a reported delta
- [x] **`POST /eval-assertions/preview`** — dry-runs a scorer or rubric against a real historical run, persisting nothing; validates with the WRITE schema so a preview cannot green-light a config the form would then reject
- [ ] i18n `de` + `es`

### Phase 4 — Detailed Progress

- [x] `POST`/`PUT /eval-cases` (hand-authored cases enter as `draft` — an authored case still needs review before it can gate anything); `GET /eval-cases/:id` as the ONLY payload-exposing route, decrypting one record at a time behind `eval.manage`; `POST /eval-cases/:id/archive` + command (retire, never delete — the case is a ≥6yr record and a suite run that used it must stay interpretable)
- [x] Eval-cases list: approve / archive / open row actions, "New case" authoring form with JSON validation surfaced as field errors, optimistic-lock headers on every mutation
- [x] Eval-case detail: decrypted `input`/`expected`, per-case assertion overrides, "Run this case"
- [x] Eval-runs list + detail with keyset-paged case runs, lazy per-case assertion results, cancel, live progress via the `eval_case_run.*` SSE pair
- [x] **Three-state verdict rendering** centralized in one helper: `null` = skipped, visually distinct and never the failure branch. `status: 'error'` maps to warning, not error — an errored case produced no verdict and is excluded from `pass_score`
- [x] `baseline_suite_run_id` added to the detail response — without it the UI could show THAT a regression happened but not what it regressed from
- [x] "Run this case" gated on `agent_orchestrator.eval.run` via `/api/auth/feature-check`: the page needs only `eval.manage`, so an ungated button would 403 for every user holding view-but-not-run
- [ ] i18n `de` + `es`

**Known, pre-existing:** the eval-cases status tabs use a raw `<button>`, mirroring the traces page. It
predates this phase and is untouched by it; fixing it properly means replacing the shared facet-tab pattern.

### Phase 5 — Detailed Progress

- [x] `lib/eval/evalGate.ts` — `runEvalGate(container, input)` returning `{ suiteRunId, passScore, safetyRegressions, outcome, caseRunCount, errorCount, baselineSuiteRunId }`. Runs `trigger: 'ci'`, `judgeMayGate: false`, over the agent's APPROVED cases only.
- [x] Explicit `baselineSuiteRunId` overrides automatic selection — a gate needs to compare against the currently ACTIVE release, not merely whatever ran last. `evalRuns.complete` honours a pinned baseline over `resolveBaselineSuiteRun`.
- [x] `outcome` is authoritative and applies NO absolute threshold: `requiredPassScore` is the caller's additional, narrower block. A caller may narrow the verdict, never widen it.
- [x] CLI `mercato agent_orchestrator eval --agent <id> --tenant <id> --org <id> [--release] [--eval-set-version] [--baseline] [--repeat] [--gate true]`. Exit 1 on a failed gate, exit 2 on a usage/environment error — **a gate that could not run is not a pass**. `--gate true` on an advisory run (no `--eval-set-version`) is refused rather than silently passing, because an unpinned dataset makes the verdict irreproducible.
- [x] Regression tests for the baseline branch: a gate assertion that regressed fails the outcome even when a score exists; the idempotent completion path returns the gate-relevant fields.
- [ ] i18n `de` + `es` (module-wide, carried from Phases 1–4)

**Not in this spec, by design:** `AgentRelease`, the `/lifecycle/releases` routes and the promote endpoint's
hash-mismatch 409 belong to `2026-06-19-agent-deployment-and-regression-gating.md`, whose `EvalGateRunner`
calls `runEvalGate()`. The upstream spec edits (`prompt_hash`, `definition_snapshot`) shipped with this
document; their CODE is that spec's Phase 4.

## Changelog

- **2026-07-19:** Initial spec. Supersedes gap-04; prior-art review of promptfoo, Inspect AI, DeepEval,
  Ragas, OpenAI Evals, Langfuse and Braintrust drives choice-based judge scoring, reasoning-before-verdict,
  delimiter neutralization, 0–1 normalization with skipped excluded from aggregates, explicit threshold
  direction, and case-level assertion overrides. Records and fixes the shipped-code deviation from the
  implemented harness spec's scorer signature (missing `expected`).

### Review round 1 — 2026-07-19
- **C1** `AgentEvalSuiteRun` presented as new though sketched in the harness spec → supersede line + delta table.
- **C2** `required_keys` → `json_match` aliasing was not behavior-preserving (online plane has no `expected`) → kept as its own scorer; `source` discriminator added.
- **C3** The `AgentRelease` absorption inverted the lifecycle spec's dependency arrow into a cycle, and the `stage`-union mitigation was vacuous (`varchar(20)` accepts any string; no migration was ever at stake) → `AgentRelease`, release routes and `release.*` ACLs returned to the lifecycle spec; `prompt_hash`/`definition_snapshot`/409 filed there upstream; Phase 5 reduced to `runEvalGate()` + CLI.
- **C4** `eval_gate.blockOnSafetyRegression` withdrawn; safety-regression blocking stays unconditional.
- **H1–H6** pagination + query counts; skipped-result pass semantics; optional-peer degradation; `openApi` + `entityType`; baseline moved Phase 5 → 3; sibling specs edited in the same change.

### Review round 2 — 2026-07-19
- **C1 (blocking)** The parameterized catalog was **unimplementable**: `agent_eval_assertions_key_uq` on `(organizationId, appliesTo, key)` (`data/entities.ts:454`) allows one row per key, while the design requires many `contains`/`tool_used` instances per agent. Resolved by splitting the overloaded `key` into `scorer_key` (which scorer) + `key` (instance slug); the unique index is untouched and the backfill `COALESCE(config->>'scorer', key)` reproduces today's resolution exactly — formalizing the shipped `config.scorer` indirection instead of silently dropping it. New §1.4.
- **C2** Catalog said "18" while listing 20, and `llm_judge` had no `group` and no registry row despite `GET /eval-scorers` being described as the form's data source. Now 21 definitions (20 deterministic + 1 judge, 22 keys with the alias), `group` gains `'judge'`, and `kind` maps to the shipped `type` column.
- **C3** "Zero behavior change" in Phase 1 was false and self-contradicted three times. Retracted and replaced with an explicit three-row change table: unknown config now yields SKIPPED (not a failed result, which would have flipped `evalPassed` on a config typo); `confidence_threshold` preserves `min_confidence`'s fail-on-null verbatim; `config.scorer` is preserved as a column rather than removed.
- **H1** `configOverride` bypassed the validation that is §1.1's whole fix → merged config re-validated.
- **H2** `EvalCaseAssertionRef.key` was ambiguous when `'*'` and agent-specific rows share a slug → refs are now `assertionId`, with an explicit shadowing precedence rule.
- **H3** `release_id` and `_release_idx` were unreachable — no caller could set them → `releaseId?` added to `runEvalGate`.
- **H4** `outcome` ownership was split with no precedence, and `passScore: null` was undefined → `outcome` computed authoritatively here with `null ⇒ failed`; `EvalGateRunner` may only narrow.
- **H5/H6** Cross-spec cleanup had covered the entity sketch only → the harness spec's `/eval-suite-runs` route, `eval --release` CLI signature and migration ownership are now explicitly superseded, and the lifecycle spec's `lib/lifecycle/EvalHarness` placement and Phase-4 wording corrected.
- **H7** Phase 5's "reproducible subject" needed a sibling spec's phase → stated as an explicit contingency in §3.6, §7 and §8 rather than an implied guarantee.
- **H8** Exported scorer types were missing from the BC section → added, with an internal-surface declaration and a fallback protocol.
- **M/L** `skipped` column dropped (`passed: null` is the sole marker, with a stated invariant); `DELETE /eval-cases` removed as incompatible with ≥6yr retention; `needsExpected` made a function of config; `eval_suite_run.progressed` replaced by worker-emitted `eval_case_run.started/.completed`; CLI flags aligned with `runEvalGate`'s optionality; `required_keys` rationale corrected to migration-safety; `preview` route assigned to Phase 3; gap-04 label reconciled to Supersedes; `z.unknown().optional()` citation corrected.
