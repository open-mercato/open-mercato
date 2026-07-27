> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/enterprise/src/modules/agent_orchestrator/`.

# GUARD: Grounding / Cite-or-Abstain — Design Analysis

> **Type:** Design Analysis (focused investigation, not a spec) · **Gap:** GAP-09 · **Priority:** P2
> **Related:** `2026-06-19-agent-runtime-guardrails.md` (GUARD; the `grounding` check + `AgentGuardrailCheck`), `2026-06-19-agent-context-knowledge-plane.md` (CONTEXT/TDCR; citable snippets + `AgentContextBundle` provenance), `2026-06-19-agent-trace-eval-capture.md` (warn-tier eval signals, `llm_judge`), `2026-06-19-agent-orchestrator-conventions.md` (normative house style)
> **Core invariants:** `agent_orchestrator` core module; "LLM proposes, OM disposes"; GUARD runs inside the `INVOKE_AGENT` impl; `AgentGuardrailCheck` stores results; CONTEXT returns CITABLE snippets with provenance; the Proposal payload is a per-capability Zod schema. Reuse `ai_assistant` `AiModelFactory` for any LLM-judge. DOES NOT EXIST: `telemetry-and-otel`, `eval-runner`. Regulatory anchor: EU AI Act Art. 13 (transparency) + accuracy obligations.

## 1. Gap statement

The guardrails spec names a `grounding` check ("for factual proposals, verify claims trace to provided context — cite-or-abstain; low grounding → `warn` or `block`") and Phase 4 schedules it, but **no mechanism is specified**. There is no definition of *how* a claim is bound to context, *what* is verified, *where* the citation lives in the proposal payload, or *how* the verdict is computed. The gap: a factual proposal must trace each material claim back to a snippet in the run's `AgentContextBundle`; an ungrounded (uncited or unsupported) claim must drive a `warn` or `block` verdict per the capability's guardrail set. Without this, an agent in a document-ingesting, regulated domain (insurance) can assert facts that are not in the evidence it was given — a hallucination that survives disposition, defeats CONTEXT's contestability promise, and breaches the AI Act accuracy/transparency duty. The hard part is doing it cheaply and auditably without a false-`block` rate that stalls legitimate runs.

## 2. Architectural drivers

- **Faithfulness / accuracy (primary).** A proposal's factual claims must be entailed by the provided context, not invented. This is the AI Act Art. 13 transparency + accuracy anchor and the core of "LLM proposes, OM disposes" — disposition is only safe if the proposal is grounded in citable evidence.
- **False-block cost.** A grounding check is a probabilistic judgement; over-blocking stalls runs and floods `USER_TASK`/operator load (the spec's own "false-positive block" Medium risk). The design must default to `warn` for soft judgements and reserve `block` for deterministic, defensible failures.
- **$/check + latency.** GUARD runs on the model path inside `INVOKE_AGENT`. A per-claim LLM-judge (NLI/entailment) call is real cost and latency on every run; a deterministic check is ~free. Cost/latency tolerance differs sharply per tier.
- **Regulatory evidence.** Every verdict must produce an `AgentGuardrailCheck` row with redacted `evidence` (pointers/offsets into the encrypted artifact store, never raw spans) and a `guardrailSetVersion`. The citation graph (claim → snippet → source) is the contestability artifact COMPLY renders.
- **OM-fit.** Must reuse what exists: CONTEXT's `retrieve()` / `AgentContextBundle.sources` provenance (citable snippets with source ref + locator + score), the per-capability **Zod proposal contract** in `data/validators.ts`, `ai_assistant` `AiModelFactory` for any LLM tier, and the warn→eval feedback loop into the trace spec. No new policy engine, no `eval-runner` (absent), no OTel dependency.

## 3. Approaches

**(a) Schema-enforced citations (deterministic).** Extend the per-capability proposal Zod schema so each factual claim is a structured object carrying a `citations: CitationId[]` that points into the run's `ContextBundle` sources. GUARD's `checkOutput` deterministically verifies, for every claim flagged factual: (1) at least one citation is present (cite-or-abstain — empty ⇒ the model must have abstained or the claim is dropped), and (2) each cited id resolves to a real `routedSources`/`sources` entry with a valid locator. Cheap, fully auditable, no model call. It proves *a citation exists and is well-formed* — **not** that the cited span actually supports the claim.

**(b) LLM-judge faithfulness / NLI (probabilistic).** For each claim, call a model via `AiModelFactory` to score entailment: does the cited (or retrieved) context *support* the claim? Catches the semantic failure (a) misses — a real-but-irrelevant citation, or a claim that distorts what the source says. Cost + latency per claim; non-deterministic, so unsuitable as a hard gate; ideal as a `warn`-tier signal feeding trace evals (mirrors the trace spec's sampled `llm_judge` warn tier exactly).

**(c) Hybrid.** Schema-required citations as a **hard, deterministic `block` gate** (a) + **sampled LLM faithfulness as a `warn` tier** (b). The deterministic gate guarantees every factual claim is cited and resolvable (cite-or-abstain enforced structurally); the sampled judge catches semantic drift on a tunable fraction, emitting `warn` verdicts that flag the proposal, surface in the cockpit, and feed the correction flywheel — never blocking production. Per-capability guardrail sets choose the mix (block-threshold, warn-sample-rate).

**Cite-or-abstain behaviour (all approaches).** The proposal schema makes citations *required on factual claims*; the model's only compliant ways to produce an uncited factual claim are to (i) abstain (omit the claim / lower confidence) or (ii) request more context. GUARD treats a factual claim with zero resolvable citations as a `block` under (a)/(c). This converts "abstain" from a model nicety into a contract obligation.

**Interaction with CONTEXT lineage (COMPLY contestability).** Citations are *ids into `AgentContextBundle.sources`*, which already carry `{ sourceKind, sourceRef, locator, score }`. The grounding check therefore reuses CONTEXT provenance verbatim — a citation is valid iff it resolves against the same bundle the agent was given. This closes the loop the CONTEXT spec opens ("guardrails verify grounding over cited snippets") and yields the fact→evidence chain COMPLY needs for contestability with zero new lineage plumbing.

**Warn-vs-block per guardrail set.** Severity is **versioned config**, not hardcoded: each capability's guardrail set declares the grounding policy (e.g. `missing_citation: block`, `unresolvable_citation: block`, `low_faithfulness_score: warn`, `faithfulness_sample_rate: 0.1`). High-stakes capabilities (payout approval) can promote the faithfulness warn to a block once the judge's precision is trusted; low-stakes summarisation can warn-only. `AgentGuardrailCheck.guardrailSetVersion` records which policy produced each verdict.

## 4. Trade-off matrix

| Dimension | (a) Schema citations | (b) LLM-judge faithfulness | (c) Hybrid |
|---|---|---|---|
| Faithfulness coverage | Structural only (citation exists/resolves) | Semantic (entailment) | Structural gate + sampled semantic |
| Determinism / auditability | Full — replayable, defensible `block` | None — non-deterministic | Gate deterministic; warn advisory |
| $/check + latency | ~Zero (no model call) | High (per-claim model call) | Low gate inline; bounded sampled judge |
| False-block risk | Very low (only on missing/bad citation) | High if used as gate | Low — judge is warn-only |
| Catches irrelevant/distorted citation | No | Yes | Yes (sampled) |
| Regulatory evidence (Art. 13) | Strong (deterministic record) | Weak alone | Strongest (record + entailment trend) |
| OM-fit / reuse | Reuses Zod contract + bundle provenance | Reuses `AiModelFactory` (warn tier mirrors trace) | Both; feeds trace evals |
| Cite-or-abstain enforcement | Yes (hard) | No (advisory) | Yes (hard) |
| Build effort | S | M | M |

## 5. Recommendation — **(c) Hybrid** (citations = hard deterministic gate; sampled LLM faithfulness = warn)

Adopt the hybrid. **Make citations a structural part of the per-capability proposal Zod contract** so cite-or-abstain is enforced by the same deterministic schema/output check that already runs in `checkOutput` — a factual claim with no resolvable citation into the run's `AgentContextBundle` is a `block` with a fully replayable, auditable evidence record (no model call, near-zero latency, near-zero false-block rate, defensible under AI Act Art. 13). **Layer a sampled LLM faithfulness/NLI judge as a `warn`-only tier**, via `ai_assistant` `AiModelFactory`, scoring whether cited context actually entails each claim; warn verdicts flag the proposal, surface in the cockpit, and feed the trace spec's correction flywheel without ever blocking production. This is the only option that simultaneously gives a defensible hard gate, catches semantic drift, controls cost/latency, and stays inside existing OM seams.

Why not (a) alone: it certifies that a citation *exists*, not that it *supports* the claim — a confidently-cited distortion passes, which is exactly the dangerous failure in a payout domain. Why not (b) alone: a non-deterministic judge as a hard gate is both legally indefensible (unreplayable `block`) and a false-block generator; it belongs in the warn tier. The hybrid's division of labour — deterministic gate for structure, probabilistic warn for semantics — mirrors the trace spec's own deterministic-gate / sampled-`llm_judge`-warn split, so the two planes share one mental model and the faithfulness warns become trace eval signals for free.

**Provider choice for the warn-tier judge is INCONCLUSIVE** and intentionally deferred: resolve it through `AiModelFactory` (per-tenant model/provider selection already lives there), do not hardcode a model in GUARD. Whether a small fast entailment-tuned model suffices versus the tenant's default chat model is an empirical tuning question for implementation; the design only requires that the judge run through the factory and be sampled + warn-only.

## 6. Effort, risks, dependencies

**Effort: M.** Gate tier is S (extend per-capability Zod proposal schemas with a `citations` shape; add deterministic citation-resolution logic in `checkOutput` against `AgentContextBundle.sources`; emit `kind:'grounding'` `AgentGuardrailCheck` rows). Warn tier adds the judge worker (sampled, async-capable, `AiModelFactory`) + per-capability grounding policy in the versioned guardrail set + cockpit/eval wiring — pushing the total to M.

**Risks:**
- *Citation gaming* — model emits a syntactically valid but irrelevant citation to pass the gate. Mitigation: the sampled faithfulness warn is exactly the detector; promote to block per-set once precision is trusted. Residual: Medium (sampling can miss).
- *False-block from over-strict "factual" classification* — mislabelling a non-factual field as requiring citation stalls runs. Mitigation: factual-claim marking is part of the per-capability schema (authored, reviewable), not a heuristic; severity defaults to `warn` where ambiguous. Residual: Low.
- *Judge cost/latency creep* — Mitigation: warn-only, sampled, off the block path, async-capable. Residual: Low.
- *Evidence leaks raw spans* — `evidence` must stay pointers/offsets into the encrypted artifact store, never plaintext (PII guard overlaps). Residual: Low.

**Dependencies:** CONTEXT `retrieve()` + `AgentContextBundle.sources` provenance (the citation target — **key dependency**); per-capability Zod proposal contract in `data/validators.ts` (citation shape); `AgentGuardrailCheck` + versioned guardrail sets (verdict + policy); `ai_assistant` `AiModelFactory` (warn-tier judge); trace spec warn→eval channel. No dependency on the absent `eval-runner` / `telemetry-and-otel`.

## 7. Deliverables + Acceptance

**Deliverables:**
- Citation shape added to the per-capability proposal Zod schemas (`data/validators.ts`): factual claims carry resolvable `citations` into the run's `ContextBundle` sources.
- Deterministic grounding gate in GUARD `checkOutput` (`kind:'grounding'`): missing/unresolvable citation on a factual claim ⇒ `block` with redacted evidence (pointers only).
- Sampled faithfulness warn tier via `AiModelFactory` (provider via factory, not hardcoded), emitting `warn` `AgentGuardrailCheck` rows + trace eval signals.
- Per-capability grounding policy in the versioned guardrail set (block thresholds, warn sample rate); recorded via `guardrailSetVersion`.

**Acceptance:**
- A factual proposal claim with no resolvable citation into its `AgentContextBundle` is `block`ed before disposition; the step fails with a typed reason and one `result='block'` grounding `AgentGuardrailCheck` is written.
- A claim whose citation resolves but is not entailed by the cited context is caught by the sampled faithfulness judge, produces a `warn` (not block), flags the `AgentProposal`, and surfaces as a trace eval signal.
- Every grounding verdict records `guardrailSetVersion` and redacted pointer-only `evidence`; raw spans never appear in the row.
- The citation graph (claim → snippet → source) is reconstructable from `AgentGuardrailCheck` + `AgentContextBundle` for COMPLY contestability.
- Warn-vs-block severity is driven by the capability's versioned guardrail set; changing it produces a new version reflected on subsequent checks.
- Grounding gate runs with no model call (deterministic); the faithfulness judge runs only on the configured sample and never blocks production.

## Changelog

- **2026-06-19:** Initial design analysis for GAP-09 (GUARD grounding / cite-or-abstain). Recommended hybrid: schema-enforced citations as a deterministic hard `block` gate + sampled LLM faithfulness as a `warn` tier via `ai_assistant` `AiModelFactory`. Grounded citation target in CONTEXT `AgentContextBundle.sources` provenance; warn tier feeds trace evals + COMPLY contestability. Provider for the warn-tier judge left inconclusive (resolve via `AiModelFactory`, sampled + warn-only).
