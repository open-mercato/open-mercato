# OpenAI-Compatible Harness Runner

## Goal

Add a third standalone-harness runner that evaluates any model served by an OpenAI-compatible chat-completions endpoint, so candidate models for local hosting can be measured on the same 192-case catalog as Codex and Claude, and so the winner can later be re-measured on a local llama.cpp/LM Studio server through the same lane.

Source doc: `.ai/specs/2026-07-24-standalone-ai-development-harness.md`
Stacked on: #4529 (`feat/sonnet-harness-eval-optimization`) head `5f18fe0c0`, PR base `develop`.
Runner-addition pattern: #4528 (`feat/kimi-cli-runner-harness-evals`) — shared owners extended additively, never a per-runner fork.

## Why a harness-owned loop instead of a vendor CLI

The Codex and Claude lanes delegate the agent loop to a trusted CLI. Neither can drive the candidate models:

- codex-cli 0.146.0 removed `wire_api = "chat"` and speaks only the Responses API (`POST /v1/responses`, verified against a local probe server). OpenAI-compatible gateways expose chat-completions, so reaching one through Codex would require a Responses-to-chat translator whose defects become measurement noise.
- Kimi CLI injects its own system prompt and model handling, and exposes no per-request gateway-routing or sampling control.

Gateway provider pinning and decoding are the control variables of this comparison, so the lane owns the loop and sends them explicitly. The security boundary is unchanged: the lane spawns the same `env -i` MCP tool server the vendor CLIs receive, so the model's only filesystem capability is the evaluator-owned exact-path file server, inside the same OS sandbox.

## Scope

- Add `oai` additively to `SUPPORTED_RUNNERS`, release-matrix runner blocks, result schemas, help text, operator docs, the governing spec, and tests. No change to Codex or Claude invocation semantics.
- Ship `agent-harness-oai-runner.mjs`: MCP stdio client, tool-calling loop, JSON-schema structured output, line-delimited trace events in the existing contract, and provider-failure classification the evaluator already understands.
- Keep every endpoint, credential, model id, provider pin, and sampling value in `OM_OAI_*` environment variables. Nothing provider-specific is committed.
- Measure the candidate models against the GPT-5.4-mini baseline **inside this lane**, so the comparison varies the model and nothing else.

## Non-goals

- No weakening of any fail-closed gate: trace verification, read allowlists, refused-read bounds, forbidden paths, containment preflight, oracle integrity, review verdict rules, and secret redaction are untouched.
- No change to catalog expectations, context budgets, or routing guidance. If a candidate model fails cases that Codex and Claude pass, that is the measurement, not a defect to tune away in this PR.
- No default sampling or gateway preference invented by the harness: an unset key is omitted from the request.
- No committed credentials, raw transcripts, or local evaluation artifacts.

## Implementation Plan

### Phase 1: Additive runner contract

1. Add the runner script, evaluator wiring, matrix/schema/doc updates, and regression coverage driven by a real local endpoint rather than a flag-echoing fake.
2. Prove the deterministic 192-case gate on a controller emitted from this branch.

### Phase 2: Screening sweep

1. Configure the pinned provider and model-card sampling per candidate; record both in the sweep report.
2. Run the hardest-case screening set for each candidate and for the in-lane GPT-5.4-mini baseline.
3. Classify failures as router ambiguity, wrong answers, output truncation, or adapter defects before promoting any candidate.

### Phase 3: Full matrices

1. Run the complete 192-case matrix for the one or two surviving candidates plus the baseline, exactly one sweep per lane at a time, a fresh results directory per sweep.
2. Report per-model pass rate, failure clusters, serving provider, decoding, cost, and wall-clock.

## Screening set

The 18-case "hardest" set referenced in #4529 lived in an uncommitted session driver, so it is not reproducible here. This run screens on the documented intersection of the immutable pre-expansion Codex and Sonnet failure sets (both runners failed all ten), plus three recent generative cases that exercise the newest guidance:

`OMH-030, OMH-058, OMH-110, OMH-134, OMH-145, OMH-147, OMH-153, OMH-154, OMH-172, OMH-175, OMH-186, OMH-187, OMH-192`

Those baselines predate #4529's remediation, so they measure historically hard routing rather than a current expected-failure list.

## Risks

- A gateway may serve a model from different hosts or quantizations across a sweep, making per-case results incomparable. Mitigation: pin the provider on every request, refuse fallbacks by default, and store the serving provider in each result.
- Provider-side output limits can truncate long agentic loops and look like reasoning failures. Mitigation: a truncated completion fails its case with an explicit `finish_reason=length` error instead of returning a partial answer.
- A harness-owned loop is a different scaffold from the vendor CLIs, so cross-lane numbers are not directly comparable. Mitigation: the decision baseline is measured in this same lane; Codex and Claude numbers stay context, not the comparison.
- An endpoint that cannot enforce a JSON schema would silently weaken structured output. Mitigation: the downgrade is explicit, emitted into the trace, and recorded per run.

## Progress

PR: #4637

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Additive runner contract

- [x] 1.1 Add the OpenAI-compatible runner, evaluator wiring, matrices, schemas, and docs — dda6b8007
- [x] 1.2 Add regression coverage against a real local endpoint — dda6b8007; six new evaluator tests; complete create-app suite 350 pass / 5 platform skips / 0 failures
- [x] 1.3 Prove the deterministic catalog gate on a controller emitted from this branch — 192/192 at dda6b8007

### Phase 2: Screening sweep

- [ ] 2.1 Record the pinned provider and model-card sampling per candidate
- [ ] 2.2 Run the screening set for every candidate and the in-lane baseline
- [ ] 2.3 Classify failures and select the candidates that earn a full matrix

### Phase 3: Full matrices

- [ ] 3.1 Run the complete 192-case matrix for the selected candidates and the baseline
- [ ] 3.2 Publish the per-model comparison report and the local-hosting recommendation
