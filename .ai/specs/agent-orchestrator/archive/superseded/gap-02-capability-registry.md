> 🗂️ **Reorg 2026-06-22 · Status: SUPERSEDED (historical).** Decided or replaced by the implementation and the 2026-06-22 OpenCode specs. Kept for provenance only — do not use as a plan. Current: `.ai/specs/agent-orchestrator/00-IMPLEMENTED-BASELINE.md`.

# Capability Vocabulary & Registry — Design Analysis

> **Gap:** GAP-02 · **Priority:** P0 · **Category:** Build
> **Related:** orchestration (`2026-06-19-agent-orchestration-step-and-proposal.md`), dispatch (`2026-06-19-agent-dispatch.md`), context (`2026-06-19-agent-context-knowledge-plane.md`), guardrails (`2026-06-19-agent-runtime-guardrails.md`), identity (`2026-06-19-agent-identity-and-on-behalf-of.md`)
> **Conventions:** `2026-06-19-agent-orchestrator-conventions.md` is normative.

## 1. Gap Statement

Every sibling spec keys off a bare `capability` string (`AgentProposal.capability`, `AgentTask.requiredCapability`, `AgentContextBundle.capability`, `AgentGuardrailCheck.capability`, the per-capability proposal Zod contract, the per-capability guardrail set) — but **nothing declares what a capability *is***. There is no single place that says `claims.coverage_check` exists, what proposal payload schema it binds, which ACL feature gates it, which CONTEXT/TDCR sources it may read, which GUARD set screens it, which runtime/runtimeRef serves it, and that its mutation posture is propose-only. Today each spec re-states `capability!: string` with no shared vocabulary, no namespace rule, no version, and no enforced binding. The result: typo-divergent keys across tables, a guardrail/context set silently missing for a capability, no compile-time guarantee that a proposal validates against *its* schema, and no contract-stability story even though capability keys + bound schemas are a STABLE surface under `BACKWARD_COMPATIBILITY.md`.

DISPATCH open question #2 names the seam precisely: *"`AgentDefinition` declares intended capabilities; `AgentBinding` declares deployed/reachable ones — confirm the boundary and which one `TaskRouter` trusts."* GAP-02 must resolve that: a registry of **declared** capabilities (the contract) is what is missing; `AgentBinding` already covers **deployed** capabilities (runtime/transport reachability).

## 2. Architectural Drivers

- **One source of truth for the capability key.** The same string indexes proposals, tasks, bundles, guardrail checks, and routing. It must be a typed, generated constant, not a free string copied per call site.
- **Contract stability + versioning.** Capability key + bound proposal schema are a STABLE/ADDITIVE-ONLY contract. External A2A partners and BYO workers bind to it. Breaking the payload shape = breaking the wire. Needs `capability@vN`.
- **Completeness enforcement at boot.** If `claims.coverage_check` has no proposal schema, no ACL feature, or no guardrail set, the platform must fail closed (generator/test gate), not discover it at runtime against a poisoned attachment.
- **Reuse, not reinvention.** Bindings live in `business_rules`-style sync, ACL in `acl.ts`, schemas in `data/validators.ts`, runtime refs in `ai_assistant` `AiAgentDefinition` / A2A Agent Cards. The registry must *reference* these, never duplicate them.
- **Locked mutation posture.** Propose-only is a security invariant (orchestration §"Effectors stay OM-owned", identity no-bypass). A tenant must not be able to downgrade a capability to direct-execute. This must be code-declared and non-tenant-overridable.
- **Auto-discovery parity.** OM modules declare contract surfaces in code files the generator discovers (`events.ts`, `acl.ts`). A capability vocabulary should follow the same idiom for discoverability and review.

## 3. Approaches Considered

### Approach A — Code-first declarative registry (`capabilities.ts`)
A new auto-discovered module file at the `agent_orchestrator` root, mirroring `events.ts`/`acl.ts`:

```typescript
export const capabilities = [
  {
    key: 'claims.coverage_check', version: 1,
    proposalSchema: ClaimsCoverageCheckProposalSchema, // from data/validators.ts
    aclFeature: 'agent_orchestrator.capability.claims_coverage_check',
    contextSources: ['policy_docs', 'claim_record', 'prior_cases'],
    guardrailSet: 'claims.coverage_check@3',
    runtime: 'internal',
    runtimeRef: 'claims.coverage_agent',           // AiAgentDefinition id
    mutationPosture: 'propose_only',               // LOCKED — non-overridable
    skillPacks: ['claims-coverage.SKILL.md'],      // optional
  },
] as const
export const capabilitiesConfig = createCapabilityRegistry({ moduleId: 'agent_orchestrator', capabilities })
export type AgentCapabilityKey = typeof capabilities[number]['key']
```

The generator emits typed ids (`capabilities.generated.ts`) and a runtime lookup. `AgentProposal.capability` etc. stay `varchar` in the DB but are typed `AgentCapabilityKey` in code; a boot/test gate asserts every referenced schema/ACL/guardrail-set exists. Versioning is `key` + `version`; a published `key@v` is frozen (additive new version only).

- **+** Exactly the OM idiom (`createModuleEvents`/`acl.ts`); reviewable in a PR diff; compile-time key safety; one place binds all six facets; trivially contract-governed (the file *is* the contract surface).
- **+** No new DB table for the *contract*; no migration churn to add a capability; works offline / in tests.
- **−** Adding/changing a capability requires a code deploy (acceptable — it *is* a contract change). No per-tenant capability authoring.

### Approach B — DB-backed registry (extend `AgentBinding`)
Push declared capabilities onto rows — either fold the contract into `AgentBinding` or add an `agent_capabilities` table seeded at setup.

- **+** Per-tenant authoring; runtime mutability without deploy.
- **−** Conflates *declared contract* (stable, global) with *deployed reachability* (per-tenant, mutable) — the exact boundary DISPATCH #2 says to separate. A Zod schema and a locked propose-only posture are code artifacts; storing a schema reference in a row gives no compile-time safety and invites tenant downgrade of mutation posture (violates driver "locked posture"). Contract versioning becomes row-state, not a reviewable diff. Heavier (migration to add a capability), and the schema/ACL/guardrail bindings still live in code, so the row only re-points to them — redundant.

### Approach C — Hybrid (code declares the contract; `AgentBinding` declares deployment)
`capabilities.ts` (Approach A) owns the **declared contract**: key, version, proposal schema, ACL feature, context sources, guardrail set, locked mutation posture, optional skill packs, and the *intended* runtime/runtimeRef. `AgentBinding` (DB, dispatch spec) continues to own **deployed/reachable** facts: which `agentDefinitionId` actually serves the capability in this tenant, transport, health, concurrency, credentials. `TaskRouter` matches `AgentTask.requiredCapability` (a registry key, validated against the registry) to enabled `AgentBinding`s whose advertised `capabilities[]` are a subset of the declared registry — a binding may only advertise capabilities the code-registry has declared (boot check). This is the literal answer to DISPATCH #2: **the registry is the trusted vocabulary; `AgentBinding` is the trusted reachability; `TaskRouter` trusts the binding for *where*, the registry for *what*.**

- **+** Cleanest separation; keeps every stable/security-bearing facet in code (schema, ACL, posture, version) while preserving per-tenant deployment flexibility already specced in dispatch. No duplication: binding *references* a registry key, never re-declares its schema.
- **+** Enforceable invariant: "no binding advertises an undeclared capability"; "no task enqueues an unregistered capability" — both fail closed at the dispatch boundary.
- **−** Two artifacts to reason about (mitigated: they have non-overlapping responsibilities and one validates the other).

## 4. Trade-off Matrix

| Criterion | A — code `capabilities.ts` | B — DB / extend `AgentBinding` | C — Hybrid |
|---|---|---|---|
| OM idiom (events.ts/acl.ts parity) | High | Low | High |
| Compile-time key + schema safety | High | None | High |
| Contract versioning as reviewable diff | High | Low (row-state) | High |
| Locked, non-overridable mutation posture | High | Weak (tenant-mutable) | High |
| Boot-time completeness gate | High | Partial | High |
| Per-tenant deployment flexibility | None | High | High (via `AgentBinding`) |
| Declared-vs-deployed separation (DISPATCH #2) | Partial (no deployment view) | Conflated | **Clean** |
| Migration cost to add a capability | None | High | None (binding row only) |
| No duplication of schema/ACL/guardrail | High | Low (re-points) | High |

## 5. Recommendation

**Adopt Approach C (Hybrid).** Ship `capabilities.ts` as an auto-discovered, code-first declarative registry that owns the *declared capability contract*, and keep `AgentBinding` as the *deployed/reachable* registry from the dispatch spec — with the registry validating the binding.

Concretely:

1. **`capabilities.ts`** at module root, discovered by `yarn generate` like `events.ts`. Each entry binds: `key` (namespaced `module.capability`), `version`, **(a)** `proposalSchema` (a Zod schema in `data/validators.ts`, re-exported from `index.ts`), **(b)** `aclFeature` (declared in `acl.ts` + `setup.ts`), **(c)** `contextSources[]` (the CONTEXT/TDCR per-capability allowlist), **(d)** `guardrailSet` (`name@version`, GUARD spec), **(e)** `runtime` + `runtimeRef` (the `AiAgentDefinition` id for `internal`, or A2A Agent Card / opencode agent for external), **(f)** `mutationPosture: 'propose_only'` as a **locked literal** the tenant-override layer (`ai_assistant` mutation-policy, `feature_toggles`) is forbidden to widen, **(g)** optional `skillPacks` (SKILL.md references).
2. **Namespace governance.** Capability keys are `<domain>.<capability>` (`claims.coverage_check`, `damage.estimate`) — *business domain* dotted with action, distinct from but parallel to event-id `module.entity.action`. Keys are lower_snake within each segment, globally unique, owned by the registry. Reserve the `agent_orchestrator.*` namespace for the platform's own internal capabilities.
3. **Versioning.** `capability@v` (`claims.coverage_check@2`). A published `key@v` proposal schema is FROZEN; any incompatible payload change ships as `@v+1` with the old version retained for ≥1 minor (BACKWARD_COMPATIBILITY deprecation protocol). `AgentProposal`/`AgentTask` persist the resolved `capabilityVersion` alongside the key so a stored proposal always validates against the schema it was produced under. `AgentBinding.capabilities[]` advertise versioned keys; `TaskRouter` honors the version.
4. **Enforcement gates (release-blocking tests, the OM idiom):**
   - every registry entry's `proposalSchema`, `aclFeature`, and `guardrailSet` resolve (no dangling binding);
   - no `AgentBinding` advertises a capability absent from the registry;
   - no `DispatchService.enqueue` accepts an unregistered/unversioned `requiredCapability`;
   - `mutationPosture` is `propose_only` for every entry and no override path can widen it (mirrors the identity no-bypass test).

This keeps every security- and contract-bearing facet in code (where it is typed, diffable, and frozen), reuses `AgentBinding` verbatim for the runtime/transport view it already owns, and gives `TaskRouter` an unambiguous trust model.

## 6. Effort, Risks, Dependencies

**Effort: M.** New `capabilities.ts` + `createCapabilityRegistry` helper + generator emitter (`capabilities.generated.ts`) + boot/test gates. The bindings themselves (schemas, ACL, guardrail sets, runtime refs) are authored by the sibling specs; GAP-02 only adds the *binding layer + governance + version field* and threads `capabilityVersion` onto `AgentProposal`/`AgentTask`.

| Risk | Severity | Mitigation |
|---|---|---|
| Generator change is a new auto-discovery contract surface | Medium | Additive file type; follows the exact `events.ts` discovery pattern; no existing surface changes |
| `capabilityVersion` added to existing entity sketches late | Low | Add the column now (additive, nullable→defaulted) while entities are still draft |
| Capability-key sprawl / inconsistent namespacing | Medium | Governance rule + uniqueness boot check; reserved `agent_orchestrator.*` namespace |
| Tenant attempts mutation-posture downgrade | High→Low | Posture is a code literal; override layer reads but cannot widen; no-bypass test gate |
| Registry vs `AgentBinding` drift | Medium | Boot check: bindings ⊆ registry; router rejects unregistered keys |

**Dependencies:** DISPATCH (`AgentBinding`, `TaskRouter` — must consume registry keys and resolve open question #2), ORCHESTRATION (`AgentProposal` proposal-schema binding, `capabilityVersion` column), CONTEXT (per-capability source allowlist), GUARD (versioned guardrail sets), IDENTITY (ACL feature + propose-only invariant), `ai_assistant` (`AiAgentDefinition` runtimeRef + mutation-policy), `cli` generator.

## 7. Deliverables & Acceptance

**Deliverables**
- `capabilities.ts` schema + `createCapabilityRegistry` helper (typed `AgentCapabilityKey`, `as const`).
- Generator emitter producing `capabilities.generated.ts` (typed ids + runtime lookup).
- `capabilityVersion` column on `AgentProposal` and `AgentTask` (additive, snapshot updated).
- Namespacing + versioning governance section folded into the conventions doc.
- Release-gate tests (completeness, bindings ⊆ registry, enqueue-validates-key, locked posture).
- DISPATCH #2 resolved in the dispatch spec (registry = declared/trusted vocabulary; `AgentBinding` = deployed/reachable).

**Acceptance**
- A capability declared once in `capabilities.ts` produces a typed key consumed by orchestration, dispatch, context, and guardrails — no second declaration of its key, schema, ACL, or guardrail set anywhere.
- Boot/test fails closed if any capability lacks a proposal schema, ACL feature, or guardrail set, or if a binding advertises an undeclared capability.
- A proposal stored under `claims.coverage_check@1` validates against the v1 schema even after `@2` ships; `@2` is strictly additive per BACKWARD_COMPATIBILITY.
- No tenant override can change a capability's `propose_only` posture (test-enforced).
- `TaskRouter` routes only registry-declared, versioned capabilities to enabled `AgentBinding`s.

## Changelog

- **2026-06-19:** Initial GAP-02 design analysis. Recommended a hybrid: code-first auto-discovered `capabilities.ts` declarative registry (declared contract — key/version/proposal-schema/ACL/context-sources/guardrail-set/runtimeRef/locked propose-only posture/skill packs) layered over the dispatch spec's DB `AgentBinding` (deployed/reachable), resolving DISPATCH open question #2. Defined namespace governance (`domain.capability`), `capability@v` versioning with frozen published schemas, and release-gate completeness/posture tests.
