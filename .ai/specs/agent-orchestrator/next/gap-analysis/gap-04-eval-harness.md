> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/core/src/modules/agent_orchestrator/`.

# Eval Harness & Scoring — Design Analysis

> **Category:** Build · **Gap:** GAP-04 · **Priority:** P1
> **Related:** trace spec (`2026-06-19-agent-trace-eval-capture.md`), lifecycle spec (`2026-06-19-agent-deployment-and-regression-gating.md`), conventions (`2026-06-19-agent-orchestrator-conventions.md`)
> **Status:** Draft · **Created:** 2026-06-19

## 1. Gap Statement

The trace and lifecycle specs both assert an eval harness exists, but it does **not**. The trace spec owns
`AgentEvalAssertion` / `AgentEvalResult` / `AgentEvalCase` entities and the *agent_orchestrator eval-case
export*; the lifecycle spec's regression gate consumes that export to block promotion of a new
`AgentRelease`. No runnable harness wires these together. There is no `eval-runner`, no Inspect AI, no `x_om`
task format, and no `telemetry-and-otel` module in the codebase — all four are absent and MUST NOT be cited as
reuse. The repo test runner is **Jest 30** (verified in root `package.json`; no Vitest anywhere in the
workspaces).

GAP-04 designs the missing piece: a scoring/regression harness that (a) runs **offline** as a CI regression
gate over the eval-case export, (b) runs the *same scorer logic* **online** inside `EvalRuntimeService` at
ingest time, (c) bridges an optional `llm_judge` tier through `ai_assistant`'s `AiModelFactory`, and (d) owns
the dataset/export format and gate/pass semantics for LIFECYCLE promotion. The central design discipline is the
**shared-scorer pattern**: assertion logic authored once as plain functions, consumed by both planes — a single
source of truth so an online warn and an offline gate can never disagree.

## 2. Architectural Drivers

- **Offline/online reuse (single source of truth).** A scorer must produce identical verdicts whether invoked
  inline at ingest (online, `EvalRuntimeService`) or in CI over the export (offline gate). If the two planes
  drift, the gate stops predicting production behavior. Scorers therefore must be **pure functions** with no
  runtime-only dependencies (no `EntityManager`, no request scope) — inputs in, verdict out.
- **Determinism.** Deterministic scorers (schema validation, numeric thresholds, PII detection) are the gate
  tier: same input → same `passed`/`score`, every run, in CI and at ingest. Only these may carry
  `severity: 'gate'`. Non-determinism in the gate path would make CI flaky and promotion non-reproducible.
- **$/token cost of `llm_judge`.** A judge call is a paid LLM round-trip. Running it on every run, or on the
  full export in CI, is cost-prohibitive and slow. The judge is therefore **sampled, async, warn-only,
  never on the critical path** — online via a `packages/queue` worker on a sampled subset, offline via a
  capped sample of the export. It informs trends; it never blocks.
- **CI integration with Jest.** A regression gate in this monorepo should be a normal CI job. Introducing a
  second test runner (Vitest) imposes config, CI-matrix, and contributor cognitive cost on a Jest-only repo.
  The deciding question for GAP-04's runner choice is whether eval ergonomics justify that second-runner tax.
- **Dataset & versioning.** The eval-case export is a **new contract surface** owned by this module
  (`BACKWARD_COMPATIBILITY.md`: STABLE / ADDITIVE-ONLY). It needs a versioned envelope from day one so the
  gate can pin `evalSetVersion` (the `AgentRelease.evalGate.evalSetVersion` already references this) and so a
  promotion is reproducible against a known dataset snapshot.
- **Regulatory ≥6yr eval records.** `AgentEvalResult` / `AgentCorrection` / `AgentEvalCase` are append-only and
  retained ≥6 years (EU AI Act Art. 12). The harness's *outputs* are legal records; gate-run summaries
  (`AgentRelease.evalResult`) and per-result rows must persist, not live only in CI logs.
- **OM-fit.** Entities, Commands, DI, queue, storage-s3, and i18n already exist. The harness should reuse them
  and the existing `AgentEvalCase` storage rather than introduce a parallel dataset store or a vendor SaaS.

## 3. Approaches Considered

### A. House Jest-based thin harness over the eval-case export (shared scorers)
A small library: a scorer registry of pure functions (one per assertion `key`), an offline runner that loads
the *agent_orchestrator eval-case export*, replays each case against a candidate `AgentRelease`, applies the
matching scorers, and produces a gate summary. CI invokes it as an ordinary Jest job (or a thin CLI,
`yarn mercato agent-orchestrator eval --release <id> --gate`, that calls the same library and exits non-zero on
gate failure). `EvalRuntimeService` imports the **same** scorer registry for inline online scoring. `llm_judge`
scorers are functions that call `createModelFactory(container).resolveModel(...)` + the Vercel AI SDK
(`generateObject` for a structured rubric verdict), gated behind sampling. No new runner, no new dataset store.

### B. Adopt `vitest-evals`
`vitest-evals` gives `describeEval` ergonomics and pairs with `autoevals` scorers. It is a genuinely nice eval
DX. But it is built on **Vitest**, which would become a *second* test runner in a Jest-only monorepo: a
separate config, a separate CI lane, two mental models for contributors, and a divergence risk in shared
tsconfig/transform setup. It could be isolated in a dedicated `eval` workspace to contain the blast radius, but
that workspace still needs the shared scorer functions and the export reader, so the bulk of Approach A's work
is still required — Vitest only replaces the *runner shell*, not the scorers or the dataset format. `autoevals`
overlaps with the `llm_judge` tier but is an extra dependency with its own provider assumptions that do not
route through `AiModelFactory` (our tenant-scoped model resolution + budget hooks).

### C. External eval platform (Braintrust / LangSmith)
Hosted dataset + scoring + dashboards. Strong DX and trend tooling. But it is a vendor dependency with **data
egress** of prompts/outputs/corrections — exactly the PII-sensitive, ≥6yr-retained, tenant-scoped records this
module is obligated to keep encrypted in-house (storage-s3 + `TenantDataEncryptionService`). It is not
OSS-aligned, fragments the source of truth (dataset lives off-platform, away from `AgentEvalCase`), and makes
the CI gate depend on a third-party uptime/API. Disqualified on data-governance and OSS-fit grounds for the
core module; could be an optional enterprise *exporter* later, never the primary store.

## 4. Trade-off Matrix

| Driver | A. House Jest harness | B. `vitest-evals` | C. External platform |
|---|---|---|---|
| Offline/online scorer reuse | Native — one registry both planes | Possible but runner-split invites drift | Online plane still bespoke; weak reuse |
| Determinism control | Full (own pure fns) | Full | Opaque/hosted scorers |
| `llm_judge` via `AiModelFactory` | Direct, tenant-scoped, budget-aware | Via `autoevals`, bypasses factory | Vendor models, bypasses factory |
| CI fit (Jest-only repo) | Native Jest job / CLI | **Second runner tax** | External call in CI |
| Dataset ownership/versioning | Own envelope, in `AgentEvalCase` | Own envelope (same work) | Off-platform, fragmented |
| ≥6yr retention / PII / encryption | In-house, compliant | In-house, compliant | **Egress + governance risk** |
| OM-fit / deps added | Highest, ~zero new deps | Vitest + autoevals | Vendor SDK + account |
| Eval DX ergonomics | Adequate (plain fns + CLI) | **Best** | Best dashboards |
| New-runner / vendor cost | None | Config + CI + contributor | Vendor lock + cost |

## 5. Recommendation

**Adopt Approach A — the house Jest-based thin harness with shared pure-function scorers — for the core
module.** It is the only option that makes offline and online a single source of truth without a second runner
or data egress, routes `llm_judge` through `AiModelFactory`, and keeps the ≥6yr eval records in-house and
encrypted. The eval-case dataset format is **owned here** (versioned envelope), not borrowed from any absent
`x_om`/Inspect format.

The CI-runner sub-choice (Jest job vs. a thin CLI wrapper) is **inconclusive on ergonomics alone** — both call
the same library. **Deciding factor: avoid a second test runner.** Stay on Jest/CLI; only revisit
`vitest-evals` (Approach B), isolated in a dedicated eval workspace, if contributor demand for `describeEval`
DX is later shown to outweigh the second-runner tax — and even then the shared scorers and export reader built
here are reused unchanged. Approach C is reserved as an optional enterprise *exporter*, never the system of
record.

Shared-scorer contract (the load-bearing seam):

```
scorer(input, expected, actual, config) -> { passed: boolean; score?: number; evidence?: Json }
```

- **Online:** `EvalRuntimeService` runs the deterministic `gate`-severity scorers inline at ingest, writes
  `AgentEvalResult`, and sets `AgentRun.evalPassed`.
- **Offline:** the CI runner replays each approved `AgentEvalCase` from the export against the candidate
  release, applies the same scorers, and computes the gate summary against `evalGate.requiredPassScore` +
  the baseline.
- **`llm_judge`:** a scorer variant that resolves a model via `createModelFactory(container).resolveModel(...)`
  and `generateObject` for a structured verdict — sampled, async, `severity: 'warn'`, both planes.

## 6. Effort, Risks & Dependencies

**Effort: M.** Scorer registry + deterministic scorers (schema/threshold/PII) + offline runner/CLI + gate
summary + `EvalRuntimeService` wiring + `llm_judge` bridge with sampling. Entities and storage already exist
(trace spec). The CLI surface and the export-envelope versioning are the main net-new build.

**Risks**

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Online/offline scorer drift defeats the shared-scorer premise | High | One registry, pure fns, no runtime deps; a test asserting parity on a fixed fixture set | Low |
| Non-determinism leaks into the gate tier | High | Only deterministic scorers may carry `severity:'gate'`; `llm_judge` is always `warn` | Low |
| `llm_judge` cost/latency in CI or online | Medium | Sampled, async, warn-only, capped sample in CI; never on critical path | Sampling can miss issues; tunable |
| Export format churns as a contract surface | Medium | Versioned envelope from day one; ADDITIVE-ONLY per `BACKWARD_COMPATIBILITY.md` | Low |
| Gate inert until trace spec's entities/export ship | Medium | Sequence behind trace spec; degrade CI gate to advisory until export lands | Gate advisory pre-trace |
| Second-runner creep if Vitest is added later | Low | Decision recorded: stay Jest/CLI; revisit only with evidence | Low |
| PII in eval cases/results | High | storage-s3 by key + `TenantDataEncryptionService`; redact row summaries; tombstone erasure | Residual pre-redaction window |

**Dependencies:** trace spec entities + eval-case export (hard, blocking); `ai_assistant` `AiModelFactory`
(`createModelFactory().resolveModel`) for `llm_judge`; `packages/queue` for async online judging; `storage-s3`
+ `TenantDataEncryptionService` for artifacts; Jest 30 + CI for the offline gate; lifecycle spec
`EvalGateRunner` / `promote` as the gate consumer.

## 7. Deliverables & Acceptance

**Deliverables**

1. **Scorer framework** — `lib/trace/eval/scorers/` (or `lib/lifecycle/eval/`): a registry of pure
   `scorer(input, expected, actual, config)` functions keyed by assertion `key`; deterministic built-ins
   (schema, threshold, PII). Imported by **both** planes.
2. **Dataset / export format** — the versioned *agent_orchestrator eval-case export* envelope
   (`{ version, evalSetVersion, generatedAt, cases[] }`), emitted by `EvalCaseExporter` from approved
   `AgentEvalCase` rows; owned here, not derived from any external task format.
3. **CI runner** — a thin offline runner/CLI (`yarn mercato agent-orchestrator eval --release <id> --gate`)
   that loads the export, replays cases against a candidate release, applies shared scorers, prints a summary,
   and exits non-zero on gate failure. Wired as a normal Jest/CI job — **no second test runner**.
4. **`EvalRuntimeService`** — online: runs deterministic `gate` scorers inline at ingest, writes
   `AgentEvalResult`, sets `AgentRun.evalPassed`; enqueues sampled `llm_judge` jobs.
5. **`llm_judge` bridge** — scorer variant using `createModelFactory(container).resolveModel(...)` +
   `generateObject` for a structured rubric verdict; sampled, async (`packages/queue`), always `warn`.
6. **Gate semantics** — `EvalGateRunner` compares candidate summary to `evalGate.requiredPassScore` +
   `evalSetVersion` and the production baseline; **any deterministic safety-assertion regression blocks
   promotion to `active`**; `llm_judge` results never block. The promote endpoint returns 409/422 on failure.

**Acceptance**

- A scorer produces identical verdicts online (ingest) and offline (CI) for the same fixture — parity test
  passes.
- The CI gate blocks promotion of a candidate `AgentRelease` that fails `evalGate` or regresses a safety
  assertion; passes otherwise; runs as a Jest/CI job with no Vitest dependency.
- The eval-case export carries a version + `evalSetVersion`; the gate pins and reports the dataset version.
- `llm_judge` runs only on a sampled subset, async, warn-only, and never changes a gate outcome.
- `AgentEvalResult` / `AgentEvalCase` and gate-run summaries persist append-only, retained ≥6 years, with
  PII artifacts encrypted in storage-s3.
- No reference to `eval-runner` / Inspect AI / `x_om` / `telemetry-and-otel` in the harness.

## Changelog

- **2026-06-19:** Initial GAP-04 design analysis. Recommends a house Jest-based thin harness with shared
  pure-function scorers (offline CI gate + online `EvalRuntimeService`), an owned versioned eval-case export
  envelope, and an `AiModelFactory`-bridged sampled `llm_judge` tier. Rejects `vitest-evals` (second-runner
  tax in a Jest-only repo) and external platforms (data egress / OSS-fit / ≥6yr in-house retention).
  CI-runner sub-choice ruled inconclusive on ergonomics; deciding factor = avoid a second test runner.
