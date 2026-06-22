> 🗂️ **Reorg 2026-06-22 · Status: SUPERSEDED (historical).** Decided or replaced by the implementation and the 2026-06-22 OpenCode specs. Kept for provenance only — do not use as a plan. Current: `.ai/specs/agent-orchestrator/00-IMPLEMENTED-BASELINE.md`.

# Agent Orchestrator — Build-Gaps Tracking

> **Status:** Analysis complete (20/20) · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19 · **Updated:** 2026-06-19
> **Purpose:** Track the Build-category gaps found in the spec audit and the per-gap design analysis. Each gap has a dedicated analysis in [`gap-analysis/`](gap-analysis/) weighing approaches against architectural drivers and recommending the best option (or, if inconclusive, the top options + the decision that picks between them).
> **Context:** [`SPEC-00`](SPEC-00-agent-orchestration-program.md) · [`conventions`](2026-06-19-agent-orchestrator-conventions.md) · [`runtime-options`](2026-06-19-agent-runtime-options-opencode-vs-in-process.md). Verified-reality invariants (no `eval-runner`/`telemetry-and-otel`/`health-monitoring`; audit not auto-written; `workflows` has no activity registry; in-process loop on Vercel AI SDK `runAiAgentObject`; standards on seams = A2A+MCP+SKILL.md+OTel) apply to every analysis.

## Outcome at a glance

- **20 analyses complete.** 15 **recommended** (single best option), 5 **inconclusive** (top options + the deciding spike/question).
- **Inconclusive (need a decision/spike):** GAP-08 (injection model — labeled-set spike), GAP-13 (fairness — DPO/legal Art.9 basis), GAP-14 (shadow live-vs-replay — cost/fidelity default), GAP-15 (A2A TS SDK maturity — spike), GAP-20 (workflows throughput — runtime load test).
- **Effort tally:** ~1×S, ~17×M, ~1×L (GAP-12), plus the GAP-20 validation gate.

## P0 — Keystone gaps (block the walking skeleton)

| ID | Gap | Status | Decision | Recommendation | Effort | Key dependency |
|----|-----|--------|----------|----------------|--------|----------------|
| [GAP-01](gap-analysis/gap-01-internal-agent-runtime.md) | Internal-agent runtime | done | ✅ recommended | Thin `InternalAgentRuntimeAdapter` over `runAiAgentObject` **object-mode** — typed Proposal = the agent `output` Zod schema; **propose-only by construction** (object-mode passes no tools today); A2A as the external generalization behind the same `AgentProposal` contract | M | CONTEXT `ContextBundle` (read context pre-fetched); optional read-only tool-loop = additive follow-on |
| [GAP-02](gap-analysis/gap-02-capability-registry.md) | Capability vocabulary + registry | done | ✅ recommended | **Hybrid**: code-first auto-discovered `capabilities.ts` declares the contract (key@v + proposal schema/ACL/context sources/guardrail set/runtimeRef/locked propose-only/skill packs); DB `AgentBinding` keeps deployed/reachable — resolves DISPATCH open-Q #2 | M | dispatch (`AgentBinding`/`TaskRouter` consume registry keys) |
| [GAP-03](gap-analysis/gap-03-invoke-agent-core-change.md) | `INVOKE_AGENT` core-`workflows` change | done | ✅ recommended · **owner-approved 2026-06-20** | **Go straight to (b): first-class additive `INVOKE_AGENT` activity** — the `workflows` owner (Patryk Lewczuk) approved the additive enum + executor case, so the macro fallback (a) is dropped. MVP-core, one editor node + park/resume on `agent_orchestrator.proposal.ready`. Generic registry (c) still deferred. | S | `DispatchService.enqueue` / `agentRuntime.run` (sign-off gate cleared) |

## P1 — Foundations that lost "Adopt" backing

| ID | Gap | Status | Decision | Recommendation | Effort | Key dependency |
|----|-----|--------|----------|----------------|--------|----------------|
| [GAP-04](gap-analysis/gap-04-eval-harness.md) | Eval harness | done | ✅ recommended | **House Jest** thin harness with shared **pure-function scorers** (offline CI gate + online `EvalRuntimeService`), owned versioned eval-case export, `AiModelFactory`-bridged sampled `llm_judge`; avoid a 2nd test runner | M | trace eval-case export + entities |
| [GAP-05](gap-analysis/gap-05-metrics-observability.md) | Metrics / observability substrate | done | ✅ recommended | **Hybrid**: scheduler+queue **rollup tables** for hot KPIs + reuse `dashboards` `WidgetDataService` for ad-hoc/live + **optional default-off OTel GenAI exporter**; reject standalone materialized views | M | trace tables (runs/eval_results/corrections/guardrail_checks) |
| [GAP-06](gap-analysis/gap-06-document-ingest-ocr.md) | Document-ingest / OCR / extraction | done | ✅ recommended (provider INCONCLUSIVE) | **Hybrid**: LLM-vision via `runAiAgentObject` object-mode as default-first engine + swappable OCR provider adapter + provenance/encryption. *Note:* a hardcoded OpenAI vision-OCR path already exists in `attachments` → this is "elevate to governed/typed/provenance", not build-from-zero. IDP-provider choice = cost/residency call (default LLM-vision-first) | M | `AiModelFactory` multimodal object-mode |
| [GAP-07](gap-analysis/gap-07-input-moderation.md) | Input moderation + safety identifiers | done | ✅ recommended | Provider-agnostic `ModerationProvider` adapter defaulting to **free OpenAI moderations** + tenant-salted `endUserIdentifier` HMAC; store verdicts in GUARD's **`AgentGuardrailCheck(kind='moderation')`** (no new table) | M | GUARD `GuardrailService` + `AiModelFactory`/LlmProvider contract |

## P2 — Hard algorithm / build interiors

| ID | Gap | Status | Decision | Recommendation | Effort | Key dependency |
|----|-----|--------|----------|----------------|--------|----------------|
| [GAP-08](gap-analysis/gap-08-guard-prompt-injection.md) | GUARD: prompt-injection / untrusted content | done | ⚠️ inconclusive | **Hybrid**: always-on structural isolation of untrusted spans + deterministic detector + always-on **output tool-scope block** (allowlist backstop); sampled/escalated `AiModelFactory` judge **pending a labeled-injection spike** | M | `AiModelFactory` + `allowedTools`/mutation-policy |
| [GAP-09](gap-analysis/gap-09-guard-grounding.md) | GUARD: grounding / cite-or-abstain | done | ✅ recommended | **Hybrid**: schema-enforced **citations as a deterministic block gate** + sampled LLM **faithfulness** (warn tier); citations resolve into `ContextBundle` provenance for COMPLY | M | CONTEXT `ContextBundle.sources` citable provenance |
| [GAP-10](gap-analysis/gap-10-context-tdcr-and-registry.md) | CONTEXT: TDCR assembly + module registry | done | ✅ recommended | **Hybrid TDCR** (declared mandatory floor + retrieval-ranked optional fill) over a **code-first typed `ContextModule` registry**; reuse `queryEngine`/`searchService`/`TenantDataEncryptionService` | M | GAP-02 capability registry |
| [GAP-11](gap-analysis/gap-11-comply-explanation.md) | COMPLY: plain-language explanation | done | ✅ recommended | **Hybrid template-first** (deterministic NL from `factorsUsed`+lineage) + opt-in grounding-gated, human-reviewed-for-adverse LLM rephrase; reject free LLM as default in this high-risk domain | M | CONTEXT lineage (grounding source) |
| [GAP-12](gap-analysis/gap-12-comply-dsar-erasure.md) | COMPLY: DSAR / audit-preserving erasure | done | ✅ recommended | **subjectId tagging + registry-driven DSAR/erasure service + per-subject crypto-shred** so append-only Art.12 rows survive while GDPR-erased PII becomes irrecoverable | **L** | per-subject DEK extension to `TenantDataEncryptionService`/`KmsService` (only per-tenant key exists today) |
| [GAP-13](gap-analysis/gap-13-comply-fairness.md) | COMPLY: privacy-safe protected attributes | done | ⚠️ inconclusive | **Deciding question:** lawful **Art.9** basis + jurisdiction for special-category processing? Default = aggregate-only + **k-anonymity** + encrypted-at-rest; attrs separately-consented or inferred-for-aggregates only | M | DPO/legal Art.9 sign-off |
| [GAP-14](gap-analysis/gap-14-lifecycle-autonomy-shadow.md) | LIFECYCLE: autonomy controller + shadow | done | ⚠️ inconclusive | **Scheduled-worker autonomy ramp** (hysteresis + min-sample + **human-confirmed** `auto`) + **live propose-only shadow fan-out**, budget-bounded with replay backstop; live-vs-replay default = cost-vs-fidelity. *Correction:* `feature_toggles` has **no native % rollout** — split computed in `ReleaseService`/`TaskRouter` | M | trace override-rate metric (GAP-04) |
| [GAP-15](gap-analysis/gap-15-dispatch-adapters-a2a.md) | DISPATCH: adapter interface + A2A | done | ⚠️ inconclusive | Define our own **`RuntimeAdapter`** contract unconditionally; ship **internal+pull first**. A2A-SDK choice hinges on a **spike** (mature `@a2a-js` server+client+push+types → adopt; else thin hand-rolled client, defer server) | M | GAP-16 agent-principal OAuth CC (api_keys has no OAuth CC today) |
| [GAP-16](gap-analysis/gap-16-identity-oauth-no-bypass.md) | IDENTITY: OAuth CC server + no-bypass | done | ✅ recommended | **A:** OAuth client-credentials `/token` on `api_keys`+`jwt.ts` (`signAudienceJwt`, reuse session-token scoping/revocation precedent); defer node-oidc-provider/auth.md. **B:** three-layer no-bypass — structural propose-only (primary) + fail-closed MikroORM flush-time `EventSubscriber` write-interceptor (defense-in-depth) + release-gate test. (226 raw `.flush()` sites confirm a test alone is insufficient) | M | GAP-01 read-only object-mode + `AgentPrincipal`/`AgentDelegationGrant` |

## P3 — Operational / process gaps

| ID | Gap | Status | Decision | Recommendation | Effort | Key dependency |
|----|-----|--------|----------|----------------|--------|----------------|
| [GAP-17](gap-analysis/gap-17-integration-test-coverage.md) | Integration-test coverage | done | ✅ recommended | Add a standard **`## Integration Coverage`** section + central per-spec test matrix to the 8/9 specs missing it; **cross-tenant denial mandatory**, named domain E2E per spec; tests ship same PR | M | `.ai/qa` Playwright harness + module-local `agentFixtures.ts` (two-org isolation) |
| [GAP-18](gap-analysis/gap-18-seeds-and-setup.md) | Seeds / setup inventory | done | ✅ recommended | **YAML/JSON-in-repo synced to DB** (matches `business_rules` rule-pack + versioned guardrail-set precedents) + `defaultRoleFeatures` in `setup.ts`; full seed inventory enumerated | M | `business_rules` rule-pack seeding (`workflows/lib/seeds.ts`) |
| [GAP-19](gap-analysis/gap-19-retention-archival.md) | Retention / partitioning / ≥6yr archival | done | ✅ recommended | **Native Postgres monthly range partitioning** of spans/tool-calls + scheduler rotation job + queue **archival worker → storage-s3**; tiered-retention policy keeps ≥6yr audit tiers hot+immutable | M | trace+compliance entities (tiers); scheduler/queue/storage-s3 |
| [GAP-20](gap-analysis/gap-20-phase0-derisk.md) | Phase-0 de-risk (validation gate) | done | ⚠️ 1 spike left | **Spike 2 expressiveness PASS** (recursive AND/OR/NOT + numeric ops, depth-cap 10) and **Spike 3 OSS-edition PASS** (all features in `packages/core`, `license:'Proprietary'` is descriptive) — both from code. **Spike 1 throughput INCONCLUSIVE** — runtime load test still required (global `bigint` event seq + no snapshot table → monitor-read path is the risk) | S | load-test harness |

## Cross-cutting findings (require small spec corrections)

The analyses surfaced real-code facts that several specs assume incorrectly — fold these into the affected specs:

1. **`feature_toggles` has no native percentage rollout** (boolean/number/json + per-`(toggle,tenant)` overrides only). DISPATCH/LIFECYCLE "canary % per tenant" must compute the deterministic split in `ReleaseService`/`TaskRouter`. (GAP-14)
2. **`api_keys` has no OAuth client-credentials** (only opaque keys + `sess_*` tokens). IDENTITY's external-agent token endpoint is genuinely net-new (built on the proven `signAudienceJwt` + session-token scoping precedent). (GAP-15, GAP-16)
3. **Audit is opt-in, not automatic** (226 `.flush()` sites outside `audit_logs`). The no-bypass invariant needs a **runtime** control (flush-time `EventSubscriber` interceptor) + structural propose-only, not just a test. Confirms the IDENTITY caveat. (GAP-16)
4. **`attachments` already ships a hardcoded OpenAI vision-OCR path.** CONTEXT doc-ingest is "elevate to governed/typed/provenance", not build-from-zero. (GAP-06)
5. **`runAiAgentObject` object-mode passes NO tools today** (`void tools`). Propose-only is structural for free; a read-only tool-loop is an additive follow-on, not assumed. (GAP-01)
6. **No per-subject encryption key exists** (only per-tenant `tenant_key_<tenantId>`). Crypto-shredding for GDPR erasure needs a per-subject DEK + `deleteDek` extension. (GAP-12)
7. **`workflows` has no snapshot table; event PK is a global `bigint` sequence.** State rebuild is cheap (live `context` jsonb) but the monitor timeline-read path is the throughput risk. (GAP-20)
8. **`business_rules` composite-condition expressiveness is confirmed** (recursive `GroupCondition`/`SimpleCondition`, AND/OR/NOT, numeric `>= < <= >`, depth-cap 10, 50 rules/group) and the **GUARD `pre_transition` gate is real** (`transition-handler.ts` → `allowed = guardRules.every(...)`). The "OM disposes" gate is present — adoption is wiring. (GAP-20)

## Recommended next steps

1. **Resolve the 5 inconclusive items** — GAP-13 (DPO/legal Art.9), GAP-08/GAP-15/GAP-20 (spikes), GAP-14 (shadow default). These gate, respectively, fairness, injection defense, A2A, throughput, and rollout.
2. ✅ **Done — two consolidating build specs authored (2026-06-20):**
   - [`2026-06-20-agent-internal-runtime-and-capability-registry.md`](2026-06-20-agent-internal-runtime-and-capability-registry.md) ← GAP-01 + GAP-02 (+ GAP-03 link, GAP-16 propose-only, GAP-10 ContextModule).
   - [`2026-06-20-agent-eval-harness-and-metrics.md`](2026-06-20-agent-eval-harness-and-metrics.md) ← GAP-04 + GAP-05 (+ GAP-14, GAP-19 links).
3. **Apply the 8 cross-cutting corrections** to the affected nine specs.
4. **Add the `## Integration Coverage` section** (GAP-17) to the 8 specs missing it.
5. **Run Phase-0 Spike 1** (GAP-20 throughput) before committing the engine-adoption decision.

## Changelog

- **2026-06-19:** Created tracking index for 20 Build-category gaps; spawned per-gap design analyses into `gap-analysis/`.
- **2026-06-19:** All 20 analyses complete (15 recommended, 5 inconclusive). Filled recommendations/effort/deps; recorded 8 cross-cutting code-fact corrections; added next-steps.
