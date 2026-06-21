# Agent Context & Knowledge Plane

> **Status:** Draft · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19
> **Module:** `@open-mercato/core` → `agent_orchestrator` · **subdomain:** `context`
> **Depends:** `query_index`, `packages/search`, `attachments`, `storage-s3`, `entities`/custom-fields, field-level encryption (`TenantDataEncryptionService`), [`2026-06-19-agent-orchestration-step-and-proposal.md`](./2026-06-19-agent-orchestration-step-and-proposal.md) (orchestration), [`2026-06-19-agent-runtime-guardrails.md`](./2026-06-19-agent-runtime-guardrails.md) (guardrails), [`2026-06-19-agent-decision-transparency-and-ai-act.md`](./2026-06-19-agent-decision-transparency-and-ai-act.md) (compliance)
> **Relates to:** the DRAFT `2026-04-27-ai-agent-attachment-processing-and-context` (this spec *elevates* the existing hardcoded OpenAI vision-OCR document-ingest path that spec only partially sketches into a governed, typed, swappable-provider pipeline — not a build-from-zero).
> **Conventions:** all entity/module/naming rules from [`2026-06-19-agent-orchestrator-conventions.md`](./2026-06-19-agent-orchestrator-conventions.md) are normative and win on conflict.

## TLDR

Decides *what an agent sees*. Implements **Task-Driven Context Routing (TDCR)** as a **hybrid** assembly — a declared mandatory floor (sources a capability MUST always see) plus retrieval-ranked optional fill — over a **code-first typed `ContextModule` registry** (strategies selected by a per-capability allowlist, not a cross-module extension point). It assembles a minimal, relevant, governed context bundle per agent run from OM structured data (`entities`/custom fields, via `queryEngine`/`query_index`), documents (`attachments`), and retrieval (`searchService` in `packages/search`, RRF-fused) — under a token budget, with PII/field-encryption redaction via `findWithDecryption`/`TenantDataEncryptionService` (cross-ref GAP-06, GAP-10), and recording what was **routed vs. pruned** plus full source **provenance** in an append-only `AgentContextBundle`. Agents are only as good as their context; this is the input/quality side. Invoked directly from `agent_orchestrator`'s `INVOKE_AGENT` step code (not a pluggable workflow activity registry — none exists). The document-ingest/OCR path is **elevated, not built from zero**: `attachments` already ships a hardcoded OpenAI vision-OCR (text/vision extraction) path; this spec lifts it into a governed, typed, provenance-carrying, swappable-provider pipeline.

## Overview

The orchestration spec defines `INVOKE_AGENT`, the step that runs an agent capability and produces an `AgentProposal`. Before the agent runs, it needs context. Today OM has the *substrate* (query indexing via `query_index`/`queryEngine`, vector/semantic/fulltext search via `searchService` with RRF fusion, attachment intake **including a hardcoded OpenAI vision-OCR text/vision extraction path**, structured entities with custom fields, field-level encryption via `TenantDataEncryptionService`/`findWithDecryption`) but **no agent-facing assembly + provenance layer** on top of it. This spec adds that layer as the `context` subdomain (`lib/context/`) of the `agent_orchestrator` core module, exposing a `ContextResolver` that `INVOKE_AGENT` calls. TDCR is **hybrid**: a declared mandatory floor per capability is always routed, and retrieval-ranked optional sources fill the remaining budget, all selected over a code-first typed `ContextModule` registry.

The single durable artifact is the `AgentContextBundle` (table `agent_context_bundles`, append-only). It is the evidence record that the trace spec renders in its "context assembled" panel, that the guardrails spec reads to verify grounding (cited snippets), and that the compliance spec uses for lineage and contestability.

## Problem Statement

`INVOKE_AGENT` needs context, but there is no governed assembly layer answering: which structured entities, which documents, which retrieved knowledge, under what token budget, redacted how, and recorded how. Without it:

- Agents either get too little context (poor quality) or too much (cost, prompt-injection surface, leaking least-privilege boundaries).
- There is no record of what the agent *could* see, so a disposition cannot be traced to its evidence (no contestability — blocks the compliance spec).
- Guardrails cannot check grounding because retrieved facts are not citable.
- The existing attachment-processing path (conversation context + upload + a hardcoded OpenAI vision-OCR text/vision extraction) is not governed, typed, provenance-carrying, or provider-swappable, and stops short of classification / field extraction with provenance — so document facts are not yet usable as governed context.

## Proposed Solution

A `ContextResolver` service (registered in `di.ts`, implemented under `lib/context/`) that:

1. **Assembles (TDCR, hybrid):** for a `{ capability, processId, stepId, budget }` request, over a code-first typed `ContextModule` registry, always routes the capability's **declared mandatory floor**, then **retrieval-ranks optional fill** sources (structured records, policy/reference docs, prior cases, retrieved snippets) into the remaining budget, prunes the rest, and packs to the token budget.
2. **Grounds via retrieval:** wraps `queryEngine`/`query_index` + `searchService` (`packages/search`, RRF-fused); every returned snippet is citable (source id + locator + score).
3. **Ingests documents (elevate, not build-from-zero):** *elevates* the existing hardcoded OpenAI vision-OCR path in `attachments` into a governed, typed, provenance-carrying, **swappable-provider** pipeline — OCR/text-vision extraction, classification, field extraction — where each extracted fact carries provenance back to the source document/page/region.
4. **Redacts:** applies `findWithDecryption`/`TenantDataEncryptionService` + PII rules so the agent receives least-privilege context (cross-ref GAP-06, GAP-10).
5. **Records:** writes one append-only `AgentContextBundle` per run capturing routed vs. pruned sources, token budget/usage, and provenance.

## Architecture

```
agent_orchestrator.INVOKE_AGENT (lib/orchestration/)
        │  resolve(em, { tenantId, organizationId, capability, processId, stepId, budget })
        ▼
ContextResolver (lib/context/)  — hybrid TDCR over a code-first typed ContextModule registry
   ├─ ContextModule registry → per-capability allowlist + declared MANDATORY floor (least-privilege)
   ├─ structured source → entities / custom fields via queryEngine/query_index (org-scoped reads)
   ├─ retrieval source  → searchService (packages/search, RRF) → cited snippets (optional fill)
   ├─ document source   → attachments (elevate existing OpenAI vision-OCR) → swappable typed pipeline
   ├─ redactor          → findWithDecryption / TenantDataEncryptionService + PII rules (GAP-06/10)
   └─ packer            → mandatory floor first, retrieval-ranked fill, token budget, routed vs pruned
        │  persists
        ▼
AgentContextBundle (agent_context_bundles, append-only)
        │  read by
        ├─ trace spec      → "context assembled" panel (routed/pruned/tokens/sources)
        ├─ guardrails spec → grounding check over cited snippets
        └─ compliance spec → lineage + contestability (fact → evidence)
```

- The resolver is **called from `agent_orchestrator`'s own `INVOKE_AGENT` step code**. There is no pluggable core-workflows activity hook; the orchestration subdomain owns the call site.
- Sources are internal strategy implementations (typed `ContextModule`s) selected by a per-capability allowlist with a declared mandatory floor; the registry lives in code/seed config (code-first), not as a cross-module extension point. Assembly is hybrid: mandatory floor always routed, retrieval-ranked optional fill packs the remainder.
- No cross-module ORM relations: the bundle references runs/processes/documents/entities by **FK id** only.

## Data Models

`AgentContextBundle` is append-only (no `updated_at` / `deleted_at`) per conventions §3.2. JSON columns are `jsonb`; their shapes are enforced by Zod in `data/validators.ts`.

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

// Validated by ContextBundleSourcesSchema in data/validators.ts:
//   routedSources: { kind: 'entity'|'document'|'retrieval'; ref: string; locator?: string;
//                    tokens: number; score?: number }[]
//   prunedSources: { kind: string; ref: string; reason: string }[]
//   provenance:    { factId: string; sourceKind: string; sourceRef: string; locator?: string }[]

@Entity({ tableName: 'agent_context_bundles' })
@Index({ name: 'agent_context_bundles_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_context_bundles_run_idx', properties: ['agentRunId'] })
export class AgentContextBundle {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'agent_run_id', type: 'uuid' })
  agentRunId!: string // FK id → agent_runs; NOT an ORM relation

  @Property({ name: 'process_id', type: 'uuid' })
  processId!: string // FK id → workflows instance

  @Property({ name: 'step_id', type: 'varchar', length: 100 })
  stepId!: string

  @Property({ name: 'capability', type: 'varchar', length: 100 })
  capability!: string

  @Property({ name: 'routed_sources', type: 'jsonb' })
  routedSources!: any // [{ kind, ref, locator?, tokens, score? }] — selected & packed

  @Property({ name: 'pruned_sources', type: 'jsonb', nullable: true })
  prunedSources?: any | null // [{ kind, ref, reason }] — excluded (over budget / out of scope)

  @Property({ name: 'sources', type: 'jsonb' })
  sources!: any // provenance: entity ids, doc ids+locators, retrieval hits (→ lineage)

  @Property({ name: 'token_budget', type: 'integer' })
  tokenBudget!: number

  @Property({ name: 'tokens_used', type: 'integer' })
  tokensUsed!: number

  @Property({ name: 'redaction_applied', type: 'jsonb', nullable: true })
  redactionApplied?: any | null // [{ field, rule }] redacted before the agent saw it

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
```

## Capabilities

- **TDCR assembly (hybrid, code-first registry):** given a capability + task, over a code-first typed `ContextModule` registry, always route the capability's **declared mandatory floor**, then **retrieval-rank optional fill** sources (structured records, policy docs, prior cases, retrieved snippets) into the remaining token budget; prune the rest; record `routedSources`, `prunedSources`, `tokenBudget`, `tokensUsed`. This powers the trace spec's "context assembled" panel and the override-rate diagnosis (too-little-context → high override).
- **Retrieval / grounding source:** wrap `queryEngine`/`query_index` + `searchService` (`packages/search`, vector/semantic/fulltext fused with RRF); return cited snippets (source id + locator + score) so the guardrails spec can verify grounding and reject ungrounded factual proposals.
- **Document ingest / extraction (elevate, not build-from-zero):** `attachments` already ships a hardcoded OpenAI vision-OCR text/vision extraction path. *Elevate* it (with the `2026-04-27-ai-agent-attachment-processing-and-context` work) into a governed, typed, provenance-carrying, **swappable-provider** pipeline — OCR/text-vision extraction, classification, field extraction — where every extracted fact carries provenance (document id → page/region locator). Conversation context, upload, and the OpenAI vision-OCR extraction already exist; the typed swappable-provider abstraction, per-agent pipeline config, PDF→image fallback, and classification/field-extraction config do **not** and are added here.
- **Lineage:** every fact in a bundle links to its source (entity id / doc id+locator / retrieval hit) via `sources`, so a disposition can be traced to its evidence — required for contestability in the compliance spec.
- **Redaction / least-privilege:** apply `findWithDecryption`/`TenantDataEncryptionService` + PII rules so agents receive least-privilege context (cross-ref GAP-06, GAP-10); record what was redacted in `redactionApplied`. Reads are always `organization_id`-scoped.
- **Token-budget enforcement:** the packer caps total tokens at `tokenBudget`; anything that does not fit is pruned (with a reason), never silently truncated mid-fact.

## API Contracts

`ContextResolver` is a DI-registered service (key `agentContextResolver`), invoked server-side from `INVOKE_AGENT`. Not a public HTTP route; bundles are exposed read-only via the module's `makeCrudRoute` list/detail (`indexer: { entityType: 'agent_orchestrator:context_bundle' }`) for the trace UI.

```typescript
interface AssembleInput {
  tenantId: string
  organizationId: string
  agentRunId: string
  processId: string
  stepId: string
  capability: string
  budget: number            // token budget
}

interface ContextResolver {
  // Full TDCR run: selects sources, redacts, packs to budget, persists an
  // AgentContextBundle, returns the bundle + the packed payload reference.
  assemble(em: EntityManager, input: AssembleInput): Promise<{
    bundle: AgentContextBundle
    payloadRef: string       // storage-s3 ref to the packed context payload
  }>

  // Grounding lookup used standalone (e.g. by guardrails grounding check).
  retrieve(em: EntityManager, query: string, scope: {
    tenantId: string; organizationId: string; capability: string
  }): Promise<Array<{
    sourceKind: 'entity' | 'document' | 'retrieval'
    sourceRef: string
    locator?: string
    snippet: string
    score: number
  }>>
}
```

- All inputs validated with Zod (`data/validators.ts`); types via `z.infer`. No `any` in service signatures (the entity `jsonb` `any` is the documented house pattern, narrowed at the Zod boundary).
- Reads filter by `organizationId`; cross-tenant reads are never possible.

## Phases

1. **`ContextModule` registry + structured TDCR (hybrid).** Code-first typed registry; per-capability allowlist + declared mandatory floor; assemble over `entities`/custom fields via `queryEngine`/`query_index` with provenance; persist `AgentContextBundle`; wire into `INVOKE_AGENT`.
2. **Retrieval source.** Wrap `searchService` (`packages/search`, RRF) + `query_index`; return cited snippets as retrieval-ranked optional fill; expose `retrieve()` for the guardrails grounding check.
3. **Document ingest / extraction (elevate).** Elevate the existing hardcoded OpenAI vision-OCR path in `attachments`/`storage-s3` into a typed, swappable-provider OCR/classification/field-extraction pipeline; extracted facts carry provenance.
4. **Redaction + token budget.** `findWithDecryption`/`TenantDataEncryptionService` + PII redaction (least-privilege, cross-ref GAP-06/10) and budget enforcement (mandatory floor first, then routed vs pruned fill).

## Acceptance

- An `INVOKE_AGENT` run produces exactly one append-only `AgentContextBundle` recording `routedSources`, `prunedSources`, `tokenBudget`, `tokensUsed`, and `sources`; both `tenant_id` and `organization_id` are set; reads are org-scoped.
- The trace spec's "context assembled" panel renders the bundle (routed vs pruned + token usage) from the CRUD read route.
- Every retrieved snippet is citable (source ref + locator + score); the guardrails spec can flag ungrounded factual proposals using `retrieve()`.
- Each extracted document fact links to its source document + locator (lineage), satisfying the compliance spec's contestability requirement.
- Redaction is applied before the agent sees context; `redactionApplied` records what was withheld; no cross-tenant data is ever assembled.
- Token usage never exceeds `tokenBudget`; over-budget sources appear in `prunedSources` with a reason.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|------|----------|---------------|------------|----------|
| Context leaks PII / cross-tenant data to the agent | High | tenancy, encryption | Mandatory `organization_id` scoping + `TenantDataEncryptionService` redaction before packing; record `redactionApplied`; no-cross-tenant test | Low |
| Prompt injection via ingested documents | Medium | document ingest | Treat extracted text as untrusted data, never instructions; guardrails spec validates proposals; provenance lets reviewers trace injected content | Medium |
| Over-budget context silently truncates a fact | Medium | packer | Prune whole sources with a reason, never mid-fact truncate; assert `tokensUsed ≤ tokenBudget` | Low |
| Retrieval returns uncitable snippets → grounding check can't run | Medium | retrieval/guardrails | `retrieve()` contract requires source ref + locator + score on every hit | Low |
| OCR/extraction quality produces wrong facts | Medium | ingest | Confidence on extracted facts; provenance for human review; low-confidence facts excludable from routing | Medium |
| Bundle bloat (append-only, one per run) | Low | storage | Store packed payload in `storage-s3` (payloadRef), keep only metadata + provenance in the row | Low |
| Assumed a pluggable workflow activity registry exists | Low (corrected) | architecture | Resolver is called directly from `INVOKE_AGENT` step code; no registry assumed | None |

## Integration Coverage

> Per repo rule, this feature ships executable Playwright integration tests with the change.
> Location: `packages/core/src/modules/agent_orchestrator/__integration__/TC-AGENT-CTX-<NNN>.spec.ts`
> Helpers: `@open-mercato/core/helpers/integration/{auth,api,authFixtures,generalFixtures}` (+ this module's
> `__integration__/helpers/agentFixtures.ts`). All fixtures created in setup (prefer API), cleaned in `finally`/teardown.
> No seeded/demo data; deterministic across retries; rely on global config (`timeout 10s`, `expect.timeout 10s`, `retries 1`).

| API path / UI flow | Method | Must-have tests |
|--------------------|--------|-----------------|
| `ContextResolver.assemble` via `INVOKE_AGENT` E2E (no public write route) | service | **bundle E2E**: one run → exactly one append-only `AgentContextBundle` recording `routedSources`/`prunedSources`/`tokenBudget`/`tokensUsed`/`sources`; both `tenant_id` + `organization_id` set; **mandatory floor always routed** even under tight budget; retrieval-ranked optional fill packs the remainder. |
| Grounding / citability (`retrieve()` + assembled snippets) | service | every retrieved snippet is citable (`sourceRef` + `locator` + `score`) so the guardrails grounding check can run; assert no snippet lacks a locator/score (feeds GUARD grounding). |
| Claim lineage (extracted document fact → source) | service | each extracted document fact in `sources`/provenance links back to its source document + page/region locator (lineage for COMPLY contestability). |
| Token-budget enforcement | service | `tokensUsed ≤ tokenBudget` always; over-budget sources appear in `prunedSources` with a reason (never silent mid-fact truncation); pruned decision recorded. |
| Redaction / least-privilege | service | field-encrypted/PII fields are redacted **before** the agent sees the packed context (`findWithDecryption`/`TenantDataEncryptionService`); `redactionApplied` records what was withheld; assert encrypted field values never appear in the packed payload. |
| `GET /api/agent_orchestrator/context-bundles`, `GET .../context-bundles/:id` (CRUD, `indexer`) for trace UI | `GET` | happy read; org-scoped; RBAC (`agent_orchestrator.context.read`, 403 without feature). |

**Tenant-isolation harness (mandatory, High):** create two orgs/tenants (`createUserFixture` per org), assemble a bundle in org A, assert org B's token gets 404/403 (never the row) on the context-bundle read/list, **and** that an `INVOKE_AGENT` assembly for org B never contains org A structured records, documents, or retrieval hits — explicit no-cross-tenant-assembly test. Cleanup both in teardown.

## Migration & Backward Compatibility

- **New entity / table only.** `agent_context_bundles` is net-new; no changes to existing tables. Migration + `.snapshot-open-mercato.json` shipped with the module per conventions §3.
- **Document ingest elevates, not replaces.** The OCR/classification/field-extraction pipeline elevates the existing hardcoded OpenAI vision-OCR text/vision extraction path in `attachments` into a governed, typed, swappable-provider pipeline on top of existing `attachments` + `storage-s3` APIs; the existing conversation-context + upload + OpenAI vision-OCR extraction surfaces are preserved (additive — the OpenAI path becomes the default provider behind the swappable abstraction). No contract surface of `attachments`, `query_index`, or `packages/search` is changed — they are consumed, not modified.
- **No public API change.** `ContextResolver` is internal DI; the only HTTP surface is additive read-only CRUD for the trace UI. Per `BACKWARD_COMPATIBILITY.md` this is ADDITIVE-ONLY.
- **Append-only contract.** `AgentContextBundle` omits `updated_at`/`deleted_at` by design; consumers (trace/guardrails/compliance) treat it as immutable evidence.

## Final Compliance Report

- **Tenancy:** both `tenant_id` and `organization_id` on the entity; all reads filter by `organization_id`. ✓
- **MikroORM v7:** `/legacy` decorators, `OptionalProps`, explicit `@Property({ name, type })`, UUID PK `defaultRaw 'gen_random_uuid()'`, append-only (no `updated_at`/`deleted_at`), `jsonb` for JSON, no shorthand. ✓
- **No cross-module ORM relations:** runs/processes/documents/entities referenced by FK id only. ✓
- **Validation:** Zod in `data/validators.ts`; `z.infer` types; no `any` in service signatures. ✓
- **Security:** field-encryption/PII redaction before context reaches the agent; least-privilege source allowlist; extracted document text treated as untrusted. ✓
- **ACL:** `agent_orchestrator.*` features in `acl.ts` + `setup.ts` (`agent_orchestrator.context.read` for the trace read route); synced via `yarn mercato auth sync-role-acls`. ✓
- **i18n:** trace-panel strings via `i18n/<locale>.json` + `useT()`/`resolveTranslations()`. ✓
- **Module placement:** `packages/core/src/modules/agent_orchestrator/lib/context/`; entity in `data/entities.ts`. ✓

## Changelog

- **2026-06-20:** Corrected the document-ingest framing to **elevate, not build-from-zero** — `attachments` already ships a hardcoded OpenAI vision-OCR (text/vision extraction) path, so this spec lifts it into a governed, typed, provenance-carrying, swappable-provider pipeline (TLDR, Overview, Problem Statement, Proposed Solution, Capabilities, Phases, Architecture, header "Relates to", Migration). Made the **hybrid TDCR** explicit: declared mandatory floor + retrieval-ranked optional fill over a code-first typed `ContextModule` registry, reusing `queryEngine`/`query_index` + `searchService` (RRF) and `findWithDecryption`/`TenantDataEncryptionService` for redaction (cross-ref GAP-06, GAP-10). Added the `## Integration Coverage` section per GAP-17 (assemble→bundle E2E with routed-vs-pruned + token budget/usage + provenance, citable-snippet grounding for GUARD, claim→source lineage for COMPLY, token-budget enforcement, redaction/least-privilege, CRUD read RBAC, and the mandatory cross-tenant no-assembly isolation harness).
- **2026-06-19:** Rewrote `SPEC-CONTEXT-01` to OM conventions and the verified 2026-06-19 architecture. Renamed `ContextBundle` → `AgentContextBundle` (table `agent_context_bundles`, append-only) as a full MikroORM v7 entity with dual tenancy. Corrected: resolver is called directly from `INVOKE_AGENT` step code (no pluggable workflow activity registry); document ingest is *built* by extending the partial `2026-04-27` attachment-processing draft (not already provided); retrieval wraps `query_index` + `packages/search` with citable snippets; redaction uses `TenantDataEncryptionService`/PII rules for least-privilege. Linked sibling specs by their real `2026-06-19-*` filenames.
