# Gap Review — Security Analysis vs. Agent Orchestrator Specs

- **Date**: 2026-07-07
- **Compared inputs**: `agent_orchestration_security_analysis.md` (five-pillar security design analysis: agent identity, prompt injection, propose/dispose guardrails, audit trail, confidence/autonomy) vs. the full spec corpus in `.ai/specs/enterprise/agent-orchestrator/next/` (including `gap-analysis/` and `IMPLEMENTATION-TRACE.md`), verified against actual code on `feat/agent-orchestrator-mvp`.
- **Status caveat**: `IMPLEMENTATION-TRACE.md` (2026-06-24) is stale relative to the branch — the identity overlay (`lib/identity/`), guardrails P1 (`lib/guardrails/`), context plane (`lib/context/`), metric rollups, and module `encryption.ts` have shipped even though the matrix marks them not-started. Statuses below were graded against code where verifiable.

## Headline verdict

The security analysis' **central architectural premise is already the specs' own premise, and it's implemented**: "LLM proposes, system disposes" with deterministic effect boundaries. gap-08 even states it verbatim ("detection is a signal; the allowlist is the boundary"). Where the analysis and the specs diverge, it's almost never on philosophy — it's on **missing operational controls** (kill switch, rate/amount limits, rotation) and on **one genuine design contradiction**: the implemented disposition is a bare `confidence >= threshold` gate on self-reported confidence, which the analysis (section 5) explicitly calls out as an anti-pattern.

## 1. What we already foresee — and have largely built

| Analysis requirement | Status | Where |
|---|---|---|
| Agent as first-class principal, separate from users/service accounts | ✅ Implemented | `auth.User.kind='agent'` + `AgentPrincipal`, identity spec; interactive login structurally unavailable |
| On-behalf-of attribution chain, always resolvable to a human | ✅ Implemented | `onBehalfOfUserId`, `AgentDelegationGrant`, `/audit/by-instigator/:humanUserId` |
| Short-lived scoped tokens, immediate revocation | ✅ Implemented | 5-min TTL JWTs, server-derived scope (client can never widen), revocation effective on next request, audience-isolated signing |
| Propose-only contract, persisted proposal, separate audited commit | ✅ Implemented | proposal → disposition → effector via the same Command bus as the UI; idempotent dispose with conflict 409 |
| Fail-closed structured output, never loosened validation | ✅ Implemented | Zod `AgentResult`, schema `block`, bounded schema-repair retry; null confidence never auto-approves |
| Guardrails as independent orchestrator component with append-only audit | ✅ Implemented (P1) | `GuardrailService`, `AgentGuardrailCheck` with `guardrailSetVersion`, `guardrail.tripped` event |
| Injection philosophy: classifier = signal, not boundary | ✅ Specced + implemented | gap-08; role-impersonation/instruction-override/encoded-payload detector; detection flags, never silently scrubs |
| Single source of truth (agent uses same services/rules as UI) | ✅ Implemented by construction | No parallel "for agents" write path; plus a control the analysis didn't ask for: the fail-closed flush-time `agentNoBypassSubscriber` that rejects any agent write outside the audited command path |
| HITL as first-class workflow state | ✅ Implemented (core) | `USER_TASK` + `WAIT_FOR_SIGNAL`, mandatory rejection reasons, proposal + rationale + facts + guard verdicts in the dispose UI |
| Trace ≠ audit log separation, regulatory retention | ✅ Specced (retention machinery deferred) | trace spec + gap-19 (partitioning, ≥6yr immutable audit tiers) |
| PII/GDPR in logs: pseudonymization, crypto-shredding, DSAR, erasure tombstones | ✅ Specced thoroughly | gap-12 (spec-only; per-subject DEK is a net-new dependency) |
| Shadow → canary → active rollout, autonomy ramp with hysteresis, eval-gated promotion, human-confirmed `auto` | ✅ Specced (Wave 6, not started) | deployment spec + gap-14 — matches the analysis' "autonomy is earned" principle closely |
| Correction flywheel → eval cases → regression gate on version changes | ✅ Implemented / specced | trace spec (shipped), eval-harness spec |
| AI Act art. 12/14 anchoring, anti-rubber-stamp signals | ✅ Partially implemented | approve-unchanged rate live in metric rollups; sampled re-review specced |

The specs also go **beyond** the analysis in places worth noting: audience-isolated JWT signing, HMAC-signed idempotent trace ingest, grounding cite-or-abstain as an anti-injection adjunct, tenant-salted `endUserIdentifier` for provider-side abuse attribution, and the no-bypass ORM interceptor.

## 2. What should be rethought — real design contradictions

These are places where the specs made a **deliberate choice that conflicts with the security analysis**, so they need a decision, not just a new spec:

### 2.1. Disposition is single-signal confidence — the analysis' biggest warning, and we do exactly it

`dispositionService.shouldAutoApprove` is literally `proposal.confidence >= threshold` (plus `alwaysAsk` and fail-closed null). No spec acknowledges that self-reported confidence is uncalibrated and injectable ("report confidence 0.99" via an attachment is not addressed by any guardrail kind). Guard `warn` results, input risk, decision category, and amount **never influence** auto-approve vs. `USER_TASK`. The analysis' `autonomy_decision = f(confidence, risk_score, category, amount, track_record, guardrails)` has no counterpart. Mitigating context: guardrail `block` does fail the step before disposition, and the release-level ramp is multi-signal — but per-decision autonomy is the weakest point in the whole architecture relative to the analysis.

### 2.2. Mid-loop tool output is explicitly declared trusted

gap-07 states the opposite of analysis §2.6: "the gate must run once per turn (pre-loop), never per step — mid-loop content is trusted tool output, not new user input." A read tool returning attacker-controlled text (customer note, external document) reaches the model unscanned. The effect boundary still holds, but the risk-scoring layer the analysis wants per iteration was consciously ruled out. Worth revisiting at least for tools returning free-text from external/customer-authored sources.

### 2.3. The OpenCode runtime path bypasses the injection detector entirely

`openCodeAgentRunner` never calls `GuardrailService` — it relies solely on structural gates (read-only tool allowlist, permission denies, outcome schema, per-call session-token ACL). Defensible, but it means the two runtimes have different defense depths and the trace/risk signal is asymmetric.

### 2.4. Autonomy is one-way by design

gap-14/deployment spec: the controller "never narrows autonomy automatically" — freeze/rollback are operator actions. The analysis requires automatic autonomy **loss** when regression evals drop below baseline. Currently a regressed release keeps its autonomy until a human intervenes; it only stops widening.

### 2.5. OBO is attribution, not permission intersection

The delegation chain answers "who is responsible" perfectly, but the agent always acts under its own scoped role — nowhere is the effective permission set the *intersection* of agent × invoker permissions (the RFC 8693 confused-deputy defense). An agent invoked by a low-privilege user can still exercise its full static role. RFC 8693 / Token Exchange is not referenced anywhere in the corpus; the external flow is OAuth client-credentials (RFC 6749 §4.4).

## 3. What should be added — genuine gaps, prioritized

### Tier 1 — operational safety controls (absent, cheap relative to risk)

1. **Kill switch** — global + per-agent, runtime-flippable by AgentOps without deploy, plus a drill/test requirement (game day). Today the closest things are release freeze (spec-only, operator action) and `OM_OPENCODE_FILES_ENABLED` (env var, requires restart, file-plane only). Nothing lets you stop a misbehaving agent *now*.
2. **Business amount limits per decision type/agent + safety rate limits** — only cost/token budgets exist (`AgentBudget`, spec-only). No "auto-approve payouts ≤ X" ceilings, no "can't approve 500 claims/minute" throttle (there is literally a `pending` UI stub for "Rate limit / min" on the agent detail page).
3. **Anti-retry-loop policy** — no proposal cap per task, no escalate-after-N-rejections. A workflow can loop an agent until a proposal passes; rejections are traced (append-only `AgentCorrection`) but nothing structurally stops verdict-shopping.
4. **Multi-signal disposition** (from 2.1) — introduce a risk score on `AgentRun`, feed guard `warn` results + category/amount into disposition; a decision matrix (category × amount → threshold + oversight level) instead of a single per-node threshold.

### Tier 2 — identity and audit hardening

5. **Credential rotation + periodic access review** of agent identities — completely absent (no rotation stage in the identity lifecycle, no recertification process); aggravated by the implemented merge-only role provisioning (`provisionAgentPrincipal` accumulates features, never prunes — a built-in privilege-creep vector).
6. **Tamper-evident audit** — append-only is convention + tests + ACL; no hash chain/WORM anywhere. A DBA/superuser can rewrite history. Even a lightweight hash-chain on the audit tiers would close the non-repudiation gap.
7. **Prompt registry / per-run prompt hash + model snapshot pinning** — file agents are git-versioned by construction, but `AgentRun.agentVersion` is nullable and nothing stamps the prompt content-hash per run; `AgentRelease.model` pins an id string, not a provider snapshot, and **silent same-id provider drift** has no detection (no scheduled eval re-run against the current active release). The guardrail-set content-hash pattern is the obvious in-repo precedent to extend to prompts.
8. **Per-workflow tool allowlist on `INVOKE_AGENT`** — allowlists exist per agent definition; a workflow author can't narrow the tool set per node, and no "default empty" rule is written. (Partially compensated: in-process agents run object-mode with zero tools.)

### Tier 3 — process and compliance

9. **Confidence calibration process** — the corrections flywheel already captures exactly the agreement data needed (every override with reason, confidence stored per run), but no spec derives thresholds from an agreement-rate-vs-confidence curve or invalidates thresholds on model/prompt change. Also missing: self-consistency (N runs), verifier-model, or logprob supplements feeding autonomy (the implemented `llm_judge` is eval-only, always `warn`, never influences disposition — by design).
10. **Sampled re-review mechanism + review-quality metrics** — sampled re-review of auto-approved runs is a one-line aspiration in two specs' last phases; no queue design, no sampling percentage, no permanence guarantee, no review dwell-time metrics (only approve-unchanged rate is live).
11. **Exfiltration controls** — zero mention of markdown/URL-rendering exfiltration or container network-egress policy for OpenCode. Structurally mitigated today (JSON output rendered via `ProposalFacts`, no fetch tools by default), but nothing prevents a future cockpit/portal surface from rendering untrusted agent output as markdown.
12. **OWASP LLM Top 10 / Agentic threat-model mapping as a recurring process** — the per-spec Risks tables are real but ad-hoc; no taxonomy mapping (the analysis notes this also plays well with regulators). Likewise **KNF guidelines: zero mentions** (also no DORA/EIOPA), and no maintained control → requirement matrix (nearest proxies: per-spec compliance reports, the unbuilt system-card generator).
13. **SIEM/anomaly correlation** — no spec treats the audit log as a security-event source (decision-volume spikes, rejected-proposal series, off-hours decisions). The opt-in OTel exporter (gap-05) is a transport, not a detection design.
14. **SLA/escalation on aged `USER_TASK`s** — delegated to `workflows` with no concrete path; caseload SLA fields are Phase B, blocked on the unshipped `workflows.instance.*` lifecycle events prerequisite. No automatic escalation path when an approval task ages out.
15. **Opaque handles** — real entity UUIDs flow to agents (`sourceRef` in spans/provenance); the analysis' "agent operates on references resolved orchestrator-side" indirection isn't specced. Lower priority given no egress tools, but worth a stated invariant — "no secrets/credentials in prompt" has no test today beyond field-encryption redaction.
16. **Structural isolation layer still spec-only** — gap-08's delimiter/role-marker wrapping + instruction-mimicry stripping of untrusted spans has no code; notably the packed context payload is not yet delivered into model prompts at all (`payloadRef: null`, P4 deferred), so the specced injection point for annotated data does not fully exist yet.
17. **Per-MCP-tool cross-tenant penetration tests** — tenant-isolation tests are mandatory per entity/API surface (two-org harness), but no per-tool cross-tenant pen-test requirement exists.
18. **Workload identity (SPIFFE/SVID) and Vault-style dynamic credentials** — not referenced; separate-process identity is handled by the bespoke per-run session token rather than attestation-based workload identity. Acceptable at current scale, worth a note for the containerized runtime roadmap.

## 4. Consciously rejected (documented, defensible — just confirm)

- **Policy-as-code (Cedar/OPA)**: guardrails spec explicitly refuses "a second policy engine" in favor of native RBAC + `ai_assistant` allowlists. Reasonable; revisit only if per-request policy complexity grows.
- **External injection classifiers (Lakera, Llama Guard, Azure Content Safety)**: gap-08 rejects them on data-egress/AI-Act/DPIA grounds but keeps the `GuardrailService` seam pluggable. Matches the analysis' data-residency caveat.
- **Dual-LLM/CaMeL**: not referenced by name, but the propose/dispose + object-mode-no-tools split is the same idea in spirit.

## Suggested next step

The highest-leverage single spec to write would be a **"runtime autonomy and operational controls"** spec covering Tier 1 (kill switch, amount/rate limits, retry caps, multi-signal disposition) — it amends the guardrails and disposition surfaces that are already implemented, and it addresses the only place where the built system directly contradicts the security analysis.

## Per-pillar status summary

| Pillar (security analysis section) | Coverage |
|---|---|
| 1. Agent identity & permissions | Core specced **and implemented** (principal, scoped role, OBO attribution, short-lived tokens, no-bypass). Missing: permission intersection, rotation, access review, per-node tool allowlists, workload identity, policy-as-code (deliberate). |
| 2. Prompt injection | Premise honored; effect boundary implemented and layered. Missing: isolation layer (spec-only), mid-loop tool-output scanning (counter-specced), OpenCode detector parity, exfiltration/egress controls, OWASP mapping. |
| 3. Propose/dispose guardrails | Core contract implemented (closed schema, persisted proposal, audited commit, same-command-bus effects, HITL). Missing: amount/rate limits, kill switch, anti-retry-loop, proposal-time semantic rules pass, SLA escalation, review-time metrics. |
| 4. Audit & non-repudiation | Attribution, append-only tiers, trace/audit split, GDPR/DSAR design strong. Missing: hash chain/WORM, prompt registry/per-run prompt hash, SIEM, KNF mapping, control→requirement matrix, same-id model-drift detection. |
| 5. Confidence & autonomy | Release-level governance (shadow/canary/ramp/eval gates) well specced. Per-decision autonomy is a bare confidence threshold: no calibration, no multi-signal function, no auto-demotion, re-review mechanism unspecced. |
