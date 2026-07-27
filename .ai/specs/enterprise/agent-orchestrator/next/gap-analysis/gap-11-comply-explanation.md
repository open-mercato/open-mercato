> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/enterprise/src/modules/agent_orchestrator/`.

# COMPLY: Plain-Language Explanation Generation — Design Analysis

> **Gap:** GAP-11 · **Priority:** P2 · **Domain:** high-risk (insurance claims adjudication)
> **Related specs:** `2026-06-19-agent-decision-transparency-and-ai-act.md` (compliance), `2026-06-19-agent-trace-eval-capture.md` (trace), `2026-06-19-agent-context-knowledge-plane.md` (context), `2026-06-19-agent-orchestrator-conventions.md` (normative)
> **Scope:** how `AgentDecisionRecord.plainExplanation` is *generated* — the one thing the compliance spec asserts ("a `DecisionExplanationService` composes `plainExplanation` from disposition + `factorsUsed` + lineage") but never designs.

## 1. Gap statement

The compliance spec persists a claimant-facing `plainExplanation` on every `AgentDecisionRecord` (append-only, immutable) and promises a `DecisionExplanationService` in `lib/compliance/` that "composes `plainExplanation` from the disposition + `factorsUsed` + the context spec's lineage, never leaking the raw engineer trace." It defines the **storage contract** and the **inputs**, but not the **generation strategy**. In a high-risk regulated domain this is the load-bearing decision: the rendered string is the legal artifact disclosed to a claimant under GDPR Art. 22 and AI Act Art. 86 ("meaningful information about the logic"), and is the text a regulator or court reads. A **hallucinated, unfaithful, or non-localizable** explanation is not a UX defect — it is direct legal liability and a misrepresentation of an adverse insurance decision. GAP-11 designs the generation path: faithful, grounded, auditable, localized, and immutably stored.

This is explicitly **distinct** from the engineer trace (`AgentSpan`/`AgentToolCall`): the trace is forensic and internal; the explanation is plain-language and external. The generator must read only the disposition + `factorsUsed` + lineage refs, never serialize spans.

## 2. Architectural drivers

| Driver | Why it dominates here |
|--------|------------------------|
| **Faithfulness / no-hallucination (PARAMOUNT)** | Every claim in the explanation MUST map to a real entry in `factorsUsed` + context-spec lineage. A reason the model invented (a factor that did not influence the disposition) is a fabricated legal justification for an adverse decision. In this domain, faithfulness outranks fluency, flexibility, and cost combined. |
| **Legal defensibility / auditability** | The exact rendered string is stored immutably in an append-only record retained ≥6 yrs (AI Act Art. 12). It must be reproducible from inputs and defensible: "this sentence came from factor X with lineage ref Y." Free-form generation that cannot be traced back to a factor is indefensible. |
| **i18n / localization** | OM mandates no hard-coded user-facing strings; the portal serves the claimant's locale via `useT`/`resolveTranslations`. Explanations MUST render in the claimant's language with equal faithfulness — a per-locale concern that templates handle natively and free LLM output handles poorly (consistency drift across languages). |
| **Readability** | The audience is a layperson contesting an insurance outcome, not an engineer. Output must be comprehensible without jargon — the one driver that *favours* an LLM and is the reason a pure template can feel robotic. |
| **Cost / latency** | Generated once per disposition on `agent_orchestrator.decision.recorded`, not per request (immutably stored, re-read cheaply). Volume is moderate and the path is async, so per-decision LLM cost is tolerable if it buys readability — cost is a low-weight driver. |
| **OM-fit** | Must live in `lib/compliance/`, reuse `ai_assistant` `AiModelFactory` (the only sanctioned LLM seam, already used by the trace spec's `llm_judge`), `i18n/` for localized templates, the context spec's lineage for grounding, and store output via the existing append-only Command path. No new infra. |

## 3. Approaches

**(a) Template / rules — deterministic NL templates filled from `factorsUsed` + lineage.**
A per-outcome, per-capability template catalogue lives in `i18n/<locale>.json` (e.g. `agent_orchestrator.explanation.rejected.body`). The service selects a template by `(outcome, capability)`, sorts `factorsUsed` by contribution, and interpolates the top factors + lineage-derived values. Output is a deterministic function of the inputs. Zero hallucination by construction; fully localizable (templates are translation keys); fully auditable (every clause is a known key bound to a known factor). Cost ≈ 0. Weakness: rigid phrasing, combinatorial template maintenance as factor types grow, can read robotically.

**(b) LLM-generated — object-mode generation from disposition + lineage, guardrailed.**
`AiModelFactory` produces the explanation via `generateObject` (structured output, not free text), prompted with the disposition + `factorsUsed` + lineage and instructed to use only those factors. Fluent, adapts to any factor combination, naturally readable, localizes by prompt. Weakness — and it is disqualifying as a *default* in this domain: the model can introduce a factor that wasn't used, soften/misstate an adverse reason, or drift in tone/coverage across runs and locales. Without a hard grounding gate it is a hallucinated-legal-justification generator. Even with grounding it adds cost, latency, non-determinism (same inputs → different strings, complicating audit reproducibility), and a model/provider dependency on the legal-critical path.

**(c) Hybrid — LLM drafts *within* a constrained template + GUARD grounding check + human review for high-stakes.**
A deterministic template (a) produces the **canonical, always-stored** explanation. Optionally, an LLM (b) drafts a more readable *rephrasing* constrained to the template's asserted facts, which then passes a **grounding verifier**: every factor/value the draft mentions must appear in `factorsUsed` + lineage; any unsupported claim → reject the draft and fall back to the template. For **adverse decisions** (`rejected` / `partially_approved`), the LLM rephrase additionally requires **human review** before it can replace the template text — wiring naturally into the spec's mandatory-human contest/review path. The template is the floor (never worse than fully-grounded); the LLM is an opt-in readability lift that can only ever *narrow* to grounded facts, never invent.

## 4. Trade-off matrix

| Criterion (weight) | (a) Template | (b) LLM free | (c) Hybrid (template-first) |
|---|---|---|---|
| Faithfulness / no-hallucination ★★★★★ | Perfect (by construction) | Risky even guardrailed | Perfect floor; LLM lift gated by grounding verifier |
| Legal defensibility / auditability ★★★★★ | Excellent (clause↔factor) | Poor (non-reproducible, opaque) | Excellent (template canonical; lift logged + human-reviewed for adverse) |
| i18n / localization ★★★★ | Native (translation keys) | Weak (cross-locale drift) | Native floor; lift per-locale optional |
| Readability ★★★ | Adequate, can feel robotic | Best | Best when lift passes; adequate on fallback |
| Cost / latency ★★ | ~Zero | Highest, on critical path | Low (template default; LLM only when enabled) |
| OM-fit ★★★ | High (`i18n` only) | Medium (`AiModelFactory` + guard) | High (reuses both seams + review path) |
| Maintenance | Template catalogue grows | Prompt + eval upkeep | Both, but LLM optional/deferrable |

## 5. Recommendation — **Hybrid (c), template-first default; LLM lift opt-in and gated.**

Ship **template generation as the mandatory, always-on canonical path** (Phase 1 of the compliance spec). The explanation stored in `AgentDecisionRecord.plainExplanation` is, by default, the deterministic template render — guaranteeing zero hallucination, full localization, and clause-to-factor auditability for go-live in a high-risk domain. This directly satisfies the paramount faithfulness driver and the defensibility driver without betting the legal artifact on a probabilistic model.

Layer the LLM rephrase as a **later, per-tenant opt-in** that can *only narrow to grounded facts*: it drafts within the template's asserted facts, every draft passes a **grounding verifier** (each mentioned factor/value must resolve to `factorsUsed` + lineage, else discard and keep the template), and for **adverse outcomes the rephrase requires human sign-off** through the spec's existing mandatory-reviewer machinery before it may replace the template text. This is justified against the legal-risk driver precisely because the LLM is never the floor and never unsupervised on an adverse decision: the worst case degrades to the fully-grounded template, and the regulator-facing artifact is never a free LLM output.

**Explicitly NOT recommended:** approach (b) as a default. Free or lightly-guardrailed LLM generation of the disclosed legal explanation in a high-risk insurance domain is a hallucination/liability risk that no amount of prompt instruction fully removes; it is admissible only as the gated lift inside (c).

**Grounding + immutability invariants (both approaches):**
- The generator reads ONLY `outcome` + `factorsUsed` + context-spec lineage refs. It MUST NOT receive or serialize `AgentSpan`/`AgentToolCall` (no engineer-trace leakage — spec risk row).
- Every asserted factor must resolve to a lineage entry (`{ factId, sourceKind, sourceRef, locator? }`); unresolved factor → generation fails closed (no record without a faithful explanation).
- The **exact rendered string** + the `(templateKey, locale, generatorMode: 'template' | 'llm_reviewed', modelId?, factorsUsed snapshot)` provenance is written immutably to the append-only `AgentDecisionRecord` via the Command path. Re-rendering for a new locale produces a NEW record/field, never mutates the stored one.
- No PII beyond what the claimant is entitled to see; subject PII pulled via `findWithDecryption`, redaction rules from the context spec respected.

## 6. Effort, risks, dependencies

**Effort: M.** Phase-1 template engine + i18n catalogue + grounding-resolver + Command-path persistence is **S–M**. The LLM lift (object-mode `AiModelFactory` call + grounding verifier + adverse-decision human-review wiring + eval coverage) adds **M** and is deferrable — total **M**, front-loadable as S.

**Risks:**
- *Template combinatorial blow-up* (outcome × capability × factor-type × locale) — Med. Mitigate with composable clause fragments (per-factor partial keys) rather than monolithic templates.
- *Grounding verifier false-negatives discard good drafts* — Low (acceptable: silent fallback to template, never an unfaithful output).
- *LLM lift drifts tone on adverse decisions* — High if ungated; reduced to Low by mandatory human review + grounding gate on adverse outcomes.
- *Cross-locale faithfulness divergence in LLM lift* — Med; mitigate by per-locale grounding eval before enabling the lift for that locale.
- *Immutability violation* (re-render mutating the stored string) — High legal; mitigate by append-only entity (no `updated_at`) + Command-path-only writes.

**Dependencies:**
- **context spec** — lineage (`AgentContextBundle.sources` / `factorsUsed` provenance) is the grounding source; the template/verifier cannot run faithfully without it. **Hard dep.**
- **`ai_assistant` `AiModelFactory`** — only for the optional LLM lift (same seam as the trace spec's `llm_judge`). Not required for the recommended Phase-1 default.
- **`i18n/`** — localized template/clause catalogue.
- **trace spec** — `AgentCorrection` overturns feed the eval harness that should also score explanation faithfulness over time.
- **portal** — surfaces the stored string; no generation logic in the UI.

## 7. Deliverables + Acceptance

**Deliverables**
1. `DecisionExplanationService` in `lib/compliance/` with a deterministic `renderTemplate(outcome, capability, factorsUsed, lineage, locale)` path (Phase 1) and a gated `draftWithLlm(...)` lift (later phase).
2. Localized clause/template catalogue in `i18n/<locale>.json` under `agent_orchestrator.explanation.*`.
3. A **grounding resolver/verifier** asserting every asserted factor maps to a lineage ref; fail-closed on unresolved factors; reject ungrounded LLM drafts.
4. Command-path persistence writing the exact string + provenance (`templateKey`, `locale`, `generatorMode`, `modelId?`) immutably onto `AgentDecisionRecord` on `agent_orchestrator.decision.recorded`.
5. Adverse-outcome human-review wiring for the LLM lift, reusing the spec's mandatory-reviewer path.
6. Integration tests (per spec mandate).

**Acceptance**
- Every `AgentDecisionRecord` gets a `plainExplanation` whose every asserted factor resolves to a `factorsUsed` + lineage entry; an unresolved factor blocks record creation (fail-closed).
- The explanation contains **no** engineer-trace internals and **no** other subject's data.
- The explanation renders faithfully in each supported claimant locale via `i18n`; the same inputs in the template path produce the same string (reproducible/auditable).
- The stored string is immutable (append-only); re-localization creates a new artifact, never mutates the original.
- The LLM lift (when enabled) never emits a factor absent from `factorsUsed`; ungrounded drafts fall back to the template; adverse-outcome rephrases are not stored without human sign-off.
- Default Phase-1 path uses **no LLM** — go-live faithfulness does not depend on a model provider.

## Changelog

- **2026-06-19:** Initial GAP-11 design analysis. Recommended hybrid, template-first default with an opt-in, grounding-gated, human-reviewed (for adverse outcomes) LLM rephrase; rejected free LLM generation as a default for the disclosed legal explanation in this high-risk insurance domain. Anchored to the compliance spec's `DecisionExplanationService`/`AgentDecisionRecord` contract, the context spec's lineage as the grounding source, `ai_assistant` `AiModelFactory` (lift only), `i18n` localization, and immutable append-only storage of the exact rendered string.
