> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/core/src/modules/agent_orchestrator/`.

# COMPLY: Privacy-Safe Protected-Attribute Handling for Fairness — Design Analysis

> **Category:** Build · **Gap:** GAP-13 · **Priority:** P2
> **Related:** compliance spec (`2026-06-19-agent-decision-transparency-and-ai-act.md`), conventions (`2026-06-19-agent-orchestrator-conventions.md`)
> **Status:** Draft (legal call pending) · **Created:** 2026-06-19

## 1. Gap Statement

The compliance spec declares `AgentFairnessMetric` (append-only) holding outcome/approval rates *by privacy-safe
cohort*, with a scheduled worker that rolls up per capability per window and `flag`s threshold breaches — and
its risk table lists *"Fairness metrics themselves expose protected attributes"* as High, mitigated only by the
phrase "aggregate, privacy-safe cohorts only; no per-subject attribute storage." **That phrase hides the actual
gap.** To compute a fairness metric *by* protected attribute (race, gender, health, disability, ethnicity, …)
the system must, somewhere, *associate a subject with that attribute* — and those attributes are **GDPR Art. 9
special-category data**, whose processing needs a strong, explicit legal basis and whose mere storage is a
standing liability and re-identification vector.

The AI Act pulls the other way: bias/fairness monitoring is an **obligation** for a high-risk system (claims
adjudication), and the compliance spec rightly treats it as go-live, not retrofit. So GAP-13 is the squeeze: we
**must** monitor disparate impact by protected attribute, yet we **must not** create a special-category data
store nor a per-decision re-identification risk. The gap is the missing data-handling design that lets
`AgentFairnessMetric` store *only* privacy-safe aggregates while never letting raw protected attributes touch
the operational decision path or the metric rows. **This is fundamentally a DPO/legal decision** — the
engineering job is to present lawful options and make the chosen one safe by construction.

## 2. Architectural Drivers

- **GDPR Art. 9 legal basis (the gating question).** Special-category processing is prohibited unless a
  specific exception applies (explicit consent, substantial public interest with a Member-State legal basis,
  etc.). The lawful basis and its **jurisdiction** are not an engineering choice — they decide whether the
  attribute may be *collected and stored at all*, or only *inferred for aggregates*, or neither. Everything
  downstream is contingent on this.
- **Re-identification risk.** Even "aggregate" cohort cells leak: a cohort of one (or a few) plus an outcome
  re-identifies the subject. Small cells in `byCohort` are a disclosure vector even with raw attributes never
  stored. Suppression of small cells is therefore not optional.
- **Statistical validity of cohorts.** Fairness signal needs enough volume per cohort/window for the
  outcome/approval rate to mean anything; tiny cells are both privacy-unsafe *and* statistically noisy. The
  same minimum-cell-size threshold serves both goals — k-anonymity and statistical power coincide.
- **AI Act bias-monitoring obligation.** A high-risk system must actually produce disparate-impact signal and
  act on breaches (`flagged` → `agent_orchestrator.fairness.flagged` → human review). "We store nothing" is not
  a compliant answer; the design must yield *usable* aggregates.
- **Data minimization (Art. 5(1)(c)) & purpose limitation.** Protected attributes, if processed at all, may be
  used **only** for aggregate fairness — never as a per-decision factor (using them in adjudication is both a
  fairness violation and an Art. 9 escalation). This forces a hard **separation of fairness data from
  operational decision data**: `AgentDecisionRecord.factorsUsed` must never contain a protected attribute, and
  the fairness pipeline must read from a *separate, consented* store, not from the decision record.
- **Auditability.** Whatever basis is chosen, the conformity programme must be able to evidence it: which
  attributes, under what basis, with what suppression threshold, retained how long — the AI Act technical
  documentation and post-market monitoring (rendered via the `dashboards` module) depend on it.

## 3. Approaches Considered

### A. Don't store protected attributes — inferred / separately-consented, aggregate-only
Never persist a protected attribute on any operational row. Compute cohorts either (i) from a **separately
collected, separately consented** demographic dataset that lives apart from the decision path, or (ii) by
**proxy inference** (e.g. BISG-style — Bayesian Improved Surname Geocoding — that estimates a *probabilistic*
cohort distribution from name + geography) used **only** to weight aggregate fairness rollups, never attached to
any individual decision. The inferred distribution is consumed transiently by the rollup worker; only the
resulting `byCohort` aggregate lands in `AgentFairnessMetric`. No special-category attribute is ever stored
per-subject; the operational path (`AgentDecisionRecord`) never sees it.

### B. Store encrypted protected attributes, aggregate-only output enforced by k-anonymity
Collect the attribute under an explicit Art. 9 basis (explicit consent or a Member-State substantial-public-
interest law), persist it **field-level encrypted** via `TenantDataEncryptionService` in a **dedicated,
access-restricted store separate from the decision record**, and let *only* the fairness rollup read it (via
`findWithDecryption`) to produce aggregates. Enforce **k-anonymity** in the rollup: suppress (do not emit) any
cohort cell with count `< k` (configurable, e.g. `k = 20`), and suppress complementary cells that would allow
back-computation. `AgentFairnessMetric.byCohort` stores **only** the surviving suppressed-and-rounded
aggregates — never the raw attribute, never a small cell.

### C. Differential-privacy aggregates
As B (or even over A's transient cohorts), but add **calibrated noise** (e.g. Laplace) to each cohort
outcome/approval count before it is written, giving a formal ε-DP guarantee on the published metric. Strongest
mathematical privacy: even an adversary with auxiliary data cannot confidently attribute a row. Cost: noise
degrades signal for small cohorts/windows (precisely where bias is hardest to detect), and a privacy budget (ε)
must be managed across windows/queries to avoid cumulative leakage.

## 4. Trade-off Matrix

| Driver | A. No-store (inferred / sep-consent) | B. Encrypted + k-anonymity | C. Differential privacy |
|---|---|---|---|
| Art. 9 storage liability | **None** (nothing stored) / minimal | Present but encrypted + isolated | Present (as B) |
| Legal basis needed | Lightest (proxy = no Art. 9 storage; sep-consent = consent) | **Explicit Art. 9 basis required** | Same as B |
| Re-identification risk | Low (no per-subject attr) | Low **iff** k-suppression holds | **Lowest** (formal ε guarantee) |
| Statistical validity | Proxy adds estimation error | High (true counts, suppressed) | Noise hurts small cohorts |
| Separation from decision path | Native (never on the row) | Must be enforced (separate store) | Must be enforced (as B) |
| AI Act signal usefulness | Adequate aggregate trend | **Best** (true rates) | Good but noisy at the margins |
| Auditability / explainability | Proxy method needs documenting | Clear (basis + threshold logged) | Clear + ε budget to document |
| Reuse (OM building blocks) | Rollup worker + `dashboards` | + `TenantDataEncryptionService` / `findWithDecryption` | + DP noise lib (new dep) |
| Implementation cost | Low–Med (proxy model = Med) | Medium | **High** (ε budget mgmt) |
| Deciding constraint | What basis exists for collection? | Same | Same + tolerance for noise |

## 5. Recommendation

**This is INCONCLUSIVE by design — the deciding factor is legal, not technical.**

**Deciding question (for the DPO / legal, per tenant + jurisdiction):**
*What is the lawful Art. 9 basis for processing protected attributes for fairness monitoring in this
deployment's jurisdiction — explicit consent, a Member-State substantial-public-interest law, or none — and may
attributes be collected/stored, or only inferred for aggregates?*

The answer routes the build:

- **No lawful basis to store** → **Approach A** (proxy inference or a separately-consented side dataset),
  aggregate-only, k-suppressed. Nothing special-category is ever persisted per subject.
- **Explicit consent or a valid public-interest law** → **Approach B** (encrypted, isolated store, k-anonymity),
  optionally layered with **C** (differential privacy) where re-identification risk or regulator expectation is
  high enough to justify the signal loss.

**Recommended default until legal rules** (safe by construction, defensible either way):
**aggregate-only + k-anonymity suppression + encrypted-at-rest, with protected attributes either collected under
explicit *separate* consent or inferred *only* for aggregates** — i.e. start from A's no-store posture and only
move to B's stored-encrypted posture once a documented Art. 9 basis exists. In **all** branches, three invariants
hold and are enforced by construction:

1. **`AgentFairnessMetric` stores ONLY privacy-safe aggregates** — `byCohort` carries suppressed,
   minimum-cell-size, (optionally DP-noised) rates; **never** a raw protected attribute, never a sub-`k` cell.
2. **Hard separation from the decision path** — protected attributes (or their proxy/consented source) live in a
   dedicated, access-restricted store read **only** by the fairness rollup worker; `AgentDecisionRecord` and
   `factorsUsed` MUST NOT contain a protected attribute (using one in adjudication is itself a violation).
3. **k-anonymity suppression is mandatory and not configurable below the floor** — the rollup drops any cell
   `< k` and any complement that would reconstruct it, regardless of approach.

Reuse the existing OM building blocks (verified in-repo): **`TenantDataEncryptionService`** (DI
`tenantEncryptionService`, `@open-mercato/shared/lib/encryption/tenantDataEncryptionService`) for Approach B —
it is *field-level* (encrypted columns per `entity_id`/`tenant_id`/`organization_id` in `encryption_maps`,
AES-GCM), read back via `findWithDecryption`/`findOneWithDecryption` (`@open-mercato/shared/lib/encryption/find`,
scope-pinnable); the **`dashboards` module** (`packages/core/src/modules/dashboards`) for post-market
monitoring — expose fairness rollups as a `dashboardWidgets` entry and/or an `AnalyticsModuleConfig` so
`WidgetDataService.queryWidgetData` renders the time-series over the **already-de-identified**
`AgentFairnessMetric` rows (it consumes aggregates, never raw attributes); plus the scheduled rollup worker the
compliance spec already specifies. **No `telemetry-and-otel`** — it does not exist.

## 6. Effort, Risks & Dependencies

**Effort: M.** The append-only `AgentFairnessMetric` entity + rollup worker + fairness API + `dashboards`
surfaces are already scoped by the compliance spec; GAP-13's net-new is the **data-handling spine**: a
separate, access-restricted protected-attribute store (or the BISG-style proxy + transient-only handling), the
**k-anonymity suppression module** in the rollup (shared so online and offline agree), and the lawful-basis /
retention metadata the conformity pack must evidence. Approach C (DP) adds noise calibration + ε-budget
management → pushes that branch to L.

**Risks**

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Special-category data stored without a valid Art. 9 basis | Critical | Block storage until DPO sign-off; default to Approach A (no-store) | Low (gated) |
| Small-cell re-identification in `byCohort` | High | Mandatory k-anonymity floor; suppress sub-`k` and complement cells; round counts | Low |
| Protected attribute leaks into the decision path / `factorsUsed` | High | Separate store; guard test asserting no protected attr in `AgentDecisionRecord`/`factorsUsed` | Low |
| Proxy (BISG) inference error / its own bias | Medium | Document method + uncertainty; treat as aggregate trend, never per-decision; never persist per-subject | Medium |
| DP noise hides real disparate impact at small cohorts | Medium | Reserve DP for high-risk jurisdictions; tune ε; keep k-suppression as primary | Medium |
| Consent withdrawal / erasure must propagate to fairness store | High | DSAR/erasure (audit-preserving tombstone) covers the separate store; aggregates already de-identified | Low |
| Cross-tenant leak via shared cohort rollup | Critical | Two-column tenancy; rollup + metric rows filter by `organizationId`; isolation tests | Low |
| Assuming a `telemetry-and-otel` substrate | Medium | Build monitoring on this module's metrics + `dashboards` (per compliance spec) | Low |

**Dependencies:** **DPO/legal sign-off on the Art. 9 lawful basis + jurisdiction (hard, blocking — gates which
approach is even permitted)**; `TenantDataEncryptionService` + `findWithDecryption` (Approach B store);
`dashboards` module (post-market monitoring surfaces); the compliance spec's `AgentFairnessMetric` entity,
rollup worker, fairness API, and `agent_orchestrator.fairness.flagged` event; DSAR/erasure machinery for
withdrawal propagation; a DP noise utility **only** if Approach C is chosen (new dep).

## 7. Deliverables & Acceptance

**Deliverables**

1. **Lawful-basis decision record** — a short DPO/legal determination (per tenant/jurisdiction) selecting
   Approach A, B, or B+C, naming the Art. 9 basis (or its absence), the chosen `k`, retention, and (if C) ε.
   This is a **prerequisite deliverable**, not optional documentation — it gates the rest.
2. **k-anonymity suppression module** — a pure function in `lib/compliance/` applied by the rollup worker:
   drops any cohort cell `< k`, suppresses reconstructable complements, rounds counts; configurable `k` with a
   hard floor. Shared so any online/offline fairness path agrees.
3. **Separated protected-attribute handling** — either (A) a BISG-style proxy/consented side dataset consumed
   **transiently** by the rollup (never persisted per subject), or (B) a dedicated, ACL-restricted, field-level
   encrypted store (`TenantDataEncryptionService`) read **only** by the rollup via `findWithDecryption`. Wired
   to the `agent_orchestrator.compliance.fairness` feature; **not** readable from any decision/portal endpoint.
4. **`AgentFairnessMetric` writer guarantee** — the rollup writes only suppressed, aggregate `byCohort`; an
   assertion/test that no raw protected attribute and no sub-`k` cell can be persisted.
5. **Decision-path separation guard** — a test asserting `AgentDecisionRecord` / `factorsUsed` never contains a
   protected attribute, and that the fairness store is never joined into DSAR decision exports as raw attrs.
6. **Conformity evidence** — fairness method, basis, `k`, retention, and ε surfaced into the technical-
   documentation / system-card pack and post-market monitoring via the `dashboards` module.

**Acceptance**

- A lawful-basis determination exists and selects the approach **before** any protected attribute is collected
  or inferred; with no basis, the system runs Approach A (no per-subject storage).
- `AgentFairnessMetric.byCohort` contains only suppressed, minimum-cell-size aggregates; sub-`k` cells are
  absent; raw protected attributes appear nowhere in the table.
- Protected attributes (or proxy/consented source) are reachable **only** by the fairness rollup, gated by
  `agent_orchestrator.compliance.fairness`; no decision/portal endpoint exposes them; the guard test passes.
- The fairness pipeline produces a usable disparate-impact signal and `flag`s threshold breaches
  (`agent_orchestrator.fairness.flagged` → human review).
- Consent withdrawal / erasure propagates to the separate store; published aggregates remain valid (already
  de-identified).
- Two-column tenancy holds; no rollup or fairness API returns cross-tenant rows.
- Post-market monitoring renders through `dashboards`; no reference to a `telemetry-and-otel` module.

## Changelog

- **2026-06-19:** Initial GAP-13 design analysis. Frames protected-attribute fairness monitoring as the GDPR
  Art. 9 vs. AI Act bias-obligation squeeze. Evaluates (A) no-store inferred/separately-consented aggregates,
  (B) encrypted store + k-anonymity, (C) differential privacy. Marks the decision **inconclusive — a DPO/legal
  call** with the deciding question being the lawful Art. 9 basis + jurisdiction; recommends a safe default
  (aggregate-only + k-anonymity + encrypted-at-rest; attrs separately consented or inferred-for-aggregates
  only), with three by-construction invariants: aggregates-only in `AgentFairnessMetric`, hard separation from
  the decision path, mandatory k-anonymity suppression. Reuses `TenantDataEncryptionService` /
  `findWithDecryption` and the `dashboards` module; explicitly avoids the non-existent `telemetry-and-otel`.
