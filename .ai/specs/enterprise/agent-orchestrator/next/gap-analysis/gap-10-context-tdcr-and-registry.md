> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/enterprise/src/modules/agent_orchestrator/`.

# CONTEXT: TDCR Assembly & Context-Module Registry — Design Analysis

> **Gap:** GAP-10 · **Priority:** P2 · **Status:** Design analysis (investigation only)
> **Related specs:** `2026-06-19-agent-context-knowledge-plane.md` (context), `2026-06-19-agent-orchestration-step-and-proposal.md` (orchestration), `2026-06-19-agent-runtime-guardrails.md` (guardrails), `2026-06-19-agent-decision-transparency-and-ai-act.md` (compliance), `2026-06-19-agent-orchestrator-conventions.md` (normative conventions)
> **Module:** `@open-mercato/core` → `agent_orchestrator` · **subdomain:** `context` (`lib/context/`)

## 1. Gap statement

The context spec names a `ContextResolver.assemble()` that performs "Task-Driven Context Routing" (TDCR), records routed-vs-pruned sources, packs to a token budget, redacts, and persists an `AgentContextBundle`. But it stops at the *what* — the entity, the DI contract, the acceptance criteria. Two load-bearing mechanisms are left unspecified:

1. **No governed assembly algorithm.** "Selects the minimal set of context sources … prunes the rest … packs to a token budget" is asserted, not defined. There is no stated selection order, no determinism guarantee, no rule for *which* candidates are mandatory vs. optional, no tie-break, and no specification of how retrieval ranking interacts with the budget. Two implementers would produce two different bundles for the same input — defeating the bundle's purpose as reproducible evidence.
2. **No context-module registry interface.** The spec says "sources are internal strategy implementations selected by a per-capability allowlist (the registry lives in code/seed config)" but never defines that interface: what a per-domain context module declares, how it advertises what a capability *may* retrieve, how it carries redaction rules, and how it plugs into the assembler. Without a typed registry, the "least-privilege source allowlist" and the provenance contract have no enforcement surface — they become convention, not code.

This gap sits upstream of three siblings: the **trace** inspector renders `routedSources`/`prunedSources`; **guardrails** grounding reads cited snippets from `retrieve()`; **compliance** lineage walks `sources` (fact → evidence). All three are only as trustworthy as the assembly algorithm and the registry that governs it.

## 2. Architectural drivers

| Driver | Why it matters here |
|--------|---------------------|
| **Relevance / answer quality** | Too little context → high human-override rate (the trace spec's headline metric); too much → cost, prompt-injection surface, blurred least-privilege. The assembler is the quality lever. |
| **Token-budget adherence** | `tokensUsed ≤ tokenBudget` is an acceptance hard rule; over-budget must surface as `prunedSources` with a reason, never mid-fact truncation. |
| **Latency** | `assemble()` is on the synchronous `INVOKE_AGENT` path before the model call. Vector embedding + multi-strategy search add real latency; the algorithm must bound retrieval fan-out. |
| **Cost** | Embedding calls and over-large prompts are the dominant per-run cost. Mandatory-only floors + ranked fill caps both. |
| **Provenance fidelity** | Every routed fact must carry `{ kind, ref, locator, score }` back to its source so compliance can prove lineage and guardrails can verify grounding. The registry is where provenance shape is enforced. |
| **Least-privilege / redaction** | A capability may read only its allowlisted sources; field-encryption/PII redaction runs *before* packing. The registry must declare both the read allowlist and the redaction rules per source. |
| **Determinism / auditability** | The bundle is immutable evidence. Same input → same routed/pruned decision (or a recorded, explainable source of variance). Pure-retrieval ranking is inherently non-deterministic; this is the central tension. |
| **OM-fit** | Must reuse `queryEngine` (`query<T>(entity, opts)`), `searchService` (RRF over fulltext/vector/tokens), `findWithDecryption` + `TenantDataEncryptionService`, and the flat `lib/<subdomain>/` + `data/validators.ts` conventions — not invent parallel infrastructure. |

## 3. Approaches

Two orthogonal decisions: the **assembly algorithm** (a/b/c) and the **registry shape**.

### Assembly

**(a) Static declared modules + deterministic budget packing.** Each capability declares a fixed, priority-ordered list of mandatory context modules. The assembler reads each in priority order, computes token cost, includes until the budget is hit, prunes the remainder with `reason: 'over_budget'`. Retrieval, if used at all, is a declared module with a fixed top-K. Fully reproducible: same records + same budget → identical bundle.

- *Pros:* maximal determinism/auditability; trivial to reason about; lowest latency variance; no ranking surprises.
- *Cons:* poor recall when the relevant evidence isn't in a statically-named source; brittle as domains evolve; ignores task-specific relevance signal entirely (it is barely "task-driven").

**(b) Retrieval-ranked dynamic selection.** The task/query drives `searchService.search()` (RRF over fulltext + vector + tokens) to rank *all* allowlisted candidates by relevance score; the assembler fills the budget greedily by descending score. Structured records become retrieval candidates too (via `query_index`).

- *Pros:* best recall/relevance; genuinely task-driven; adapts as data changes with no config churn.
- *Cons:* non-deterministic (embedding/model drift, score ties, index-coverage fallbacks all change ranking → different bundles for the "same" input); weakest auditability; latency dominated by embedding + multi-strategy fan-out; a low-relevance-but-mandatory policy doc can be ranked out and silently omitted — unacceptable for a regulated domain.

**(c) Hybrid — declared mandatory floor + ranked optional fill.** Each capability's context module declares (i) a **mandatory** set always included in priority order (policy/reference docs, the subject record), and (ii) an **optional** candidate space filled by retrieval ranking under the *remaining* budget after the mandatory floor is packed. Determinism is partitioned: the mandatory portion is fully reproducible; the optional portion's variance is *bounded and recorded* (the ranked candidates, their scores, and the budget cutoff all land in `routedSources`/`prunedSources`).

- *Pros:* guarantees critical evidence (mandatory floor) while keeping recall (ranked fill); auditable because the variance is explicit and scored; least-privilege enforced by the same per-source allowlist for both tiers; maps cleanly onto OM substrate (mandatory = `queryEngine` reads, fill = `searchService`).
- *Cons:* more moving parts than (a); the mandatory/optional split is a design judgment per capability; optional tier still carries retrieval non-determinism (mitigated, not eliminated).

### Registry

**Code-first declared `ContextModule` interface (recommended).** A pluggable per-domain interface, registered per capability, that declares: the source kinds it exposes, the read allowlist (which `entityType`s / document classes / retrieval scopes the capability MAY touch), the mandatory-vs-optional tier of each source, the redaction rules per field, and a `provenance` mapper from raw hit → `{ factId, sourceKind, sourceRef, locator }`. Lives in code + seed config, ties to the **GAP-02 capability registry** (each capability points at its context module). This is *not* a cross-module extension point (no third-party plugin surface, consistent with "the registry lives in code/seed config, not as a cross-module extension point"); it is an internal strategy interface selected by capability.

The alternative — a pure data/seed-config registry (rows in a table, no typed interface) — was considered and rejected: it cannot carry the redaction-mapper or provenance-mapper logic, so least-privilege and lineage would degrade to convention.

## 4. Trade-off matrix

| Criterion | (a) Static + pack | (b) Retrieval-ranked | (c) Hybrid floor+fill |
|---|---|---|---|
| Relevance / recall | Low | High | High |
| Token-budget adherence | High | High | High |
| Latency | Best | Worst | Medium |
| Cost | Low | High | Medium |
| Provenance fidelity | High | Medium | High |
| Least-privilege / redaction | High (static allowlist) | Medium (allowlist still applies, but fill is opaque) | High |
| Determinism / auditability | High | Low | **Medium-High (partitioned + recorded)** |
| OM-fit (queryEngine/search reuse) | Partial (under-uses search) | Good | **Best (uses both as intended)** |
| Regulated-domain safety (mandatory evidence guaranteed) | Yes | **No** | Yes |

## 5. Recommendation

**Adopt (c) hybrid assembly + the code-first declared `ContextModule` registry.**

Rationale: the context spec's own framing — "minimal, relevant, governed" — is exactly the hybrid contract. (a) gives "governed" but sacrifices "relevant"; (b) gives "relevant" but sacrifices "governed" and the determinism the bundle-as-evidence model and the compliance spec require. (c) is the only option that satisfies all three because it *partitions* the determinism problem: the mandatory floor is the governed, reproducible spine (policy docs, the subject record — always present, always citable), and the optional ranked fill supplies recall while recording its own variance (candidate set + scores + cutoff) so the non-determinism is **auditable rather than hidden**. For a regulated, document-ingesting domain (insurance), "the relevant policy clause was ranked out by an embedding-model update" is an unacceptable failure mode that (b) permits and (c) structurally prevents.

The registry must be a **typed interface, not data-only**, because least-privilege (read allowlist), redaction (field rules), and lineage (provenance mapper) are *behaviour*, not just declarations — they belong in code keyed by capability, tied to GAP-02. This keeps the "context module registry lives in code/seed config" promise while giving the assembler, guardrails grounding, and compliance lineage a single enforcement surface.

Two emphases the implementation MUST preserve:
- **Routed/pruned recording is first-class, not a log line.** Every pack decision (included with tokens/score, or pruned with a reason) is written to the bundle so the trace inspector can render *why* the agent saw what it saw — this is the override-rate diagnosis tool.
- **Provenance is captured at retrieval time, not reconstructed.** The `ContextModule` provenance mapper stamps `{ factId, sourceRef, locator }` on each fact as it enters the candidate pool, so compliance lineage and guardrails grounding read the same record.

## 6. Effort, risks, dependencies

**Effort: M.** The substrate exists and is reusable (`queryEngine`, `searchService`, `findWithDecryption`/`TenantDataEncryptionService`). Net-new work: the `ContextModule` interface + per-capability registry, the TDCR assembler orchestrating mandatory-then-fill, the budget packer with a token estimator, the provenance model, and the `AgentContextBundle` persistence wiring already sketched in the context spec. Document-ingest (OCR/extraction, Phase 3) is its own larger effort and is **out of scope for this gap** — GAP-10 covers assembly + registry over structured + retrieval sources; ingest can plug in later as another source kind.

**Risks:**
- *Token estimation drift* — packer must use a model-appropriate tokenizer, not a char-count heuristic, or `tokensUsed ≤ tokenBudget` can be violated. Mitigate: estimate conservatively, prune whole sources, never mid-fact truncate.
- *Optional-fill non-determinism leaking into "evidence"* — mitigate by recording the full ranked candidate set + scores + cutoff in `prunedSources`, so the variance is reproducible-on-paper.
- *Registry/capability skew* — a capability with no declared context module, or an allowlist that drifts from GAP-02. Mitigate: assembler fails closed (empty allowlist → empty optional tier, mandatory floor required) + a guard test that every capability resolves a context module.
- *Redaction-before-packing ordering bug* — redaction MUST run before token counting and persistence, or PII can enter the bundle/prompt. Mitigate: redactor is a mandatory stage in the pipeline, asserted by a no-PII test.
- *Latency on the synchronous path* — bound retrieval fan-out (cap candidate K, cap strategies per capability), allow the optional tier to be skipped under a tight budget.

**Dependencies:** GAP-02 capability registry (each capability → its `ContextModule`); the context spec's `AgentContextBundle` entity + `ContextResolver` DI key; `queryEngine` (`query_index`), `searchService` (`packages/search`), `TenantDataEncryptionService` (`tenantEncryptionService` DI). Consumed by guardrails (`retrieve()` grounding), trace (routed/pruned panel), compliance (lineage).

## 7. Deliverables + Acceptance

**Deliverables (design-level — to be specified into the context spec, not built here):**

1. **`ContextModule` registry interface** (`lib/context/registry.ts`). Per-capability, code-first. Each module declares: `sources: ContextSourceDecl[]` where each decl carries `{ kind: 'entity'|'document'|'retrieval'; tier: 'mandatory'|'optional'; allowlist (entityType / doc class / retrieval scope); priority; redaction: FieldRedactionRule[]; provenance: (hit) => { factId, sourceRef, locator } }`. Resolved by capability via the GAP-02 registry; fails closed on an unknown capability.
2. **TDCR assembler** (`lib/context/assembler.ts`). Orchestrates: resolve `ContextModule` for `{ capability }` → read mandatory sources via `queryEngine`/`findWithDecryption` (org-scoped) → rank optional candidates via `searchService.search({ tenantId, organizationId, entityTypes, strategies })` → redact → pack → persist `AgentContextBundle` → return `{ bundle, payloadRef }`. Implements `retrieve()` for standalone grounding use by guardrails.
3. **Budget packer** (`lib/context/packer.ts`). Mandatory-first, priority-ordered, then descending-score optional fill; model-appropriate token estimator; whole-source prune with reason; emits `routedSources` (`{ kind, ref, locator?, tokens, score? }`) and `prunedSources` (`{ kind, ref, reason }`).
4. **Provenance model** (Zod in `data/validators.ts`). `routedSources` / `prunedSources` / `sources` (provenance: `{ factId, sourceKind, sourceRef, locator? }`) / `redactionApplied` schemas; `z.infer` types re-exported from `index.ts` for trace/guardrails/compliance consumers.

**Acceptance:**
- Every capability resolves exactly one `ContextModule`; a capability with none fails closed (guard test).
- `assemble()` produces one append-only `AgentContextBundle` with the mandatory floor always present in `routedSources`; over-budget candidates appear in `prunedSources` with a reason; `tokensUsed ≤ tokenBudget` (never mid-fact truncated).
- Given identical inputs (records + budget + index state), the **mandatory** portion of the bundle is byte-stable; the **optional** portion's full ranked candidate set + scores + cutoff are recorded, making its selection reproducible-on-paper.
- Every routed retrieval fact is citable (`sourceRef` + `locator` + `score`); guardrails `retrieve()` returns the same citable shape.
- Redaction runs before packing/persistence; `redactionApplied` records withheld fields; a no-PII / no-cross-tenant assembly test passes; all reads are `organization_id`-scoped.
- The trace inspector renders routed vs. pruned + token usage directly from the bundle's CRUD read route; compliance can walk `sources` from a disposition back to each evidence fact.

## Changelog

- **2026-06-19:** Initial GAP-10 design analysis. Recommended hybrid (declared mandatory floor + retrieval-ranked optional fill) assembly over static-only and retrieval-only, and a code-first typed `ContextModule` registry over a data-only one, justified by the bundle's role as reproducible evidence and the regulated-domain requirement that mandatory evidence can never be ranked out. Grounded deliverables in the verified OM substrate (`queryEngine` from `query_index`, `searchService` RRF over fulltext/vector/tokens from `packages/search`, `findWithDecryption` + `TenantDataEncryptionService`). Scoped document-ingest (OCR/extraction) out of this gap. Effort M.
