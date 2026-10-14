# Continuous Online Eval + Golden Input‑Match

> Enterprise · `agent_orchestrator` · **2026-07-25** · builds on
> [`00-IMPLEMENTED-BASELINE.md`](./00-IMPLEMENTED-BASELINE.md),
> the shipped trace+eval capture, and
> [`2026-07-24-agent-centric-workspace-and-eval-consolidation.md`](./2026-07-24-agent-centric-workspace-and-eval-consolidation.md).
> Delivery: same PR lineage (`feat/agent-orchestrator-mvp`).

## TLDR

Make evaluation **ambient**: every agent run is scored against **all applicable assertions**, and
**when a run's input matches a golden case**, the run is *additionally* compared to that golden's
expected output. Most of the "eval on every run" plumbing already ships (`evaluateRun` at trace
ingest); the genuinely new primitive is an **input‑match key** on golden cases + a lookup in the
ingest path that feeds the matched case's `expected` into the *same* scorer loop. Because Playground,
live process, and workflow runs all flow through that one ingest path, "auto‑eval in Playground" and
"compare a live agent to golden" both fall out for free. The **Playground watch UI** — see every
assertion verdict and, on a golden match, the diff vs expected — is a first‑class deliverable.

## Problem

Two things are conflated today. Users think of evaluation as a **batch run you trigger**, but the
platform already scores **every** run online — that signal is just invisible in the UI. And golden
cases only participate in explicitly‑selected batch runs; a live run (or a Playground run) that
happens to reproduce a golden input is never compared to it. So: the always‑on eval isn't watchable,
and the golden dataset isn't a live oracle.

## What already exists (do not rebuild)

- **Online per‑run eval** — `evaluateRun(em, scope, runId)` (`lib/eval/evalRuntimeService.ts`) runs
  **synchronously at trace ingest** (`commands/trace.ts`) for every run. It scores all `enabled`,
  `deterministic` assertions where `appliesTo ∈ {agentId, '*'}`, writes one `AgentEvalResult` per
  assertion with **`evalCaseRunId = null`** (the online‑plane marker), and stamps `run.evalScore` +
  `run.evalPassed` (gate‑severity AND; `warn` never gates). An async **LLM‑judge** tier is sampled
  into `AGENT_ORCHESTRATOR_LLM_JUDGE_QUEUE` (always `warn` online).
- **Scoring against `expected`** — the scorer registry (`lib/eval/registry`, entry `runScorer(scorerKey,
  run, expected, config)`) already supports `expected`‑based scorers (`source: 'expected'`, e.g.
  `json_match`, text match). The batch replay path (`lib/eval/evalReplayService.ts` `scoreCaseRun`)
  already calls `runScorer(..., evalCase.expected, ...)`. **Online, `expected` is passed as `null`**,
  so `expected`‑based assertions are silently **SKIPPED** on every live run today.
- **Surfacing** — `GET /runs/[id]` returns a run's `evalResults` (online + offline, undifferentiated);
  the trace inspector renders them.

**Gap:** (a) the online eval isn't clearly watchable (Playground shows nothing; trace doesn't mark
online vs golden); (b) there is **no input‑match** — no hash/fingerprint on `AgentEvalCase`, no
matcher — so `expected`‑based checks never fire online.

## Proposed model — two layers

1. **Every run, always:** run all applicable assertions online (exists). Surface the verdicts.
2. **On input match:** look up an approved golden case by `(agentId, inputKey)`; on a hit, run the
   `expected`‑based assertions with that case's `expected`, record golden‑matched verdicts + a
   run‑level golden pass/fail, and surface the diff.

## Architecture

### Match key (start here)
- Add **`input_key varchar(64)`** to `agent_eval_cases` — a deterministic **SHA‑256 of the
  canonicalized *plaintext* input** (stable JSON: sorted keys, normalized numbers/whitespace). Computed
  at case create/update *before* encryption, in a shared `canonicalInputKey(input)` helper. Index
  `(organizationId, agentDefinitionId, input_key)`. Nullable; backfill existing approved cases.
- Encryption note: `input` is encrypted at rest; the key is a hash of the plaintext stored in a
  separate non‑encrypted column. A hash is non‑reversible, but low‑entropy inputs are subject to a
  confirmation check — acceptable for eval fixtures (residual risk, documented).
- **Phase 3 knob (reserved, not built now):** optional `match_fields jsonb` on the case so noisy live
  inputs match on a declared projection instead of the whole input.

### Ingest‑path change (`commands/trace.ts` / `evalRuntimeService.ts`)
After the existing online assertion pass, inside the same EM/transaction:
1. Compute `runKey = canonicalInputKey(decrypted run.input)`.
2. Look up one `approved` `AgentEvalCase` for `(tenant, org, agentId, input_key = runKey)`.
3. On a hit: run the case's effective **`expected`‑based** assertions via `runScorer(..., case.expected,
   ...)` (reusing `scoreCaseRun`'s proven loop), writing `AgentEvalResult` rows tagged with a new
   **`matched_eval_case_id`** FK (still `evalCaseRunId = null` — online plane, now golden‑anchored).
4. Stamp run‑level **`golden_case_id`** + **`golden_passed`** (bool|null) so the UI can show
   "matched golden X → PASS/FAIL" without recomputation.
Kept **synchronous inline** (cheap: one indexed lookup + a few scorers) so Playground gets instant
feedback; the LLM‑judge tier stays async.

### Data model delta (summary)
- `agent_eval_cases`: `+ input_key`, `(+ match_fields, Phase 3)`.
- `agent_eval_results`: `+ matched_eval_case_id` (nullable FK → agent_eval_cases).
- `agent_runs`: `+ golden_case_id` (nullable), `+ golden_passed` (nullable bool).
- One migration + snapshot per the module's conventions.

## Playground watch UI (first‑class)

The Playground already runs an agent and shows output. Add an **Evaluation panel** that renders after
the run ingests:
- **Assertion verdicts** — every applicable assertion with pass / fail / skipped + score (this is the
  "eval on every run" made visible; the whole point the user called crucial).
- **Golden match** — if the input matched a golden case: a prominent banner **"Matched golden case
  {ref} → PASS/FAIL"**, a **diff of actual output vs `expected`**, and the golden's **bound rules**
  (case‑scoped assertions), so "selecting a golden match shows its rules" is answered right here.
- **No match** — a **"Save as golden case"** affordance (captures this input+output as a new draft
  golden, reusing the existing `evalCases.createFromRun` path), closing the author‑from‑playground loop.

## Other surfacing

- **Trace inspector** — distinguish **online** (`evalCaseRunId=null`, no golden) vs **golden‑matched**
  (`matched_eval_case_id` set) vs **batch** verdicts; link the matched golden case.
- **Agent workspace** — Activity rows show a per‑run eval pass/fail badge (fed by `run.evalPassed`);
  Evaluation ▸ Runs keeps batch suite runs; add a golden‑coverage / online golden pass‑rate readout
  (Phase 3).

## Phases

- **Phase 1 — Make the always‑on eval watchable.** No schema change. Playground evaluation panel
  (assertion verdicts) + trace inspector marks online vs batch + Activity eval badge. Immediate value,
  sets up the Playground surface.
- **Phase 2 — Golden input‑match (the match key).** Migration (`input_key`, `matched_eval_case_id`,
  run golden fields) + `canonicalInputKey` helper + ingest‑path lookup + golden `expected` scoring +
  Playground golden‑comparison UI + trace golden linkage. **The core of the ask.**
- **Phase 3 — Live‑traffic projection + coverage.** `match_fields` projection matching, agent‑level
  golden‑coverage / online golden pass‑rate, and regression alerts from live traffic.

## Risks & Impact Review

| Risk | Sev | Area | Mitigation | Residual |
|---|---|---|---|---|
| Inline ingest cost grows | Med | ingest latency | One indexed lookup + a handful of scorers; LLM judge stays async; skip lookup when the agent has zero golden cases | Negligible added ms |
| Hash of low‑entropy plaintext enables confirmation | Low | privacy | Eval fixtures only; documented; Phase 3 projection reduces stored‑input coupling | Confirmation on known inputs |
| Encrypted input at ingest | Med | correctness | Hash over `findWithDecryption` plaintext, canonicalized; never over ciphertext | — |
| DB schema change | Med | migration | Additive nullable columns + backfill; snapshot reviewed; no drops | — |
| Online `expected` assertions previously skipped now fire on match | Low | behavior | Intended; only on matched runs; `warn`‑only unless a gate assertion is bound | — |

## Integration Coverage

| Path | Coverage |
|---|---|
| Ingest → online eval | every run gets online verdicts + `evalScore/evalPassed` (regression‑guard existing) |
| Ingest → golden match | a run whose input canonical‑hashes to an approved golden case gets `expected`‑scored + `golden_case_id/golden_passed` set |
| `canonicalInputKey` | stable across key order / number formatting; different inputs → different keys |
| Playground | evaluation panel renders verdicts; golden match shows diff + rules; no‑match shows "Save as golden" |
| Trace inspector | online vs golden‑matched vs batch distinguished |

## Changelog

- **2026-07-25** — Spec created. Confirmed direction: surface the already‑shipped online per‑run eval,
  add an exact canonical‑hash input‑match key on golden cases, compare matched runs to `expected` in
  the ingest path (reusing the scorer registry), and make the Playground the primary watch surface.
  Phased; same PR lineage. Field‑projection matching deferred to Phase 3.
