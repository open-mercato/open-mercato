> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/enterprise/src/modules/agent_orchestrator/`.

# Document Ingest / OCR / Extraction — Design Analysis

> **Gap:** GAP-06 · **Priority:** P1 · **Status:** Recommended (provider choice INCONCLUSIVE — see §5)
> **Related:** [`2026-06-19-agent-context-knowledge-plane.md`](../2026-06-19-agent-context-knowledge-plane.md) (CONTEXT spec — owns ingest, Phase 3), [`2026-06-19-agent-runtime-guardrails.md`](../2026-06-19-agent-runtime-guardrails.md) (GUARD — untrusted-doc handling), `attachments` module (`packages/core/src/modules/attachments`), DRAFT [`2026-04-27-ai-agent-attachment-processing-and-context.md`](../../2026-04-27-ai-agent-attachment-processing-and-context.md)
> **Owner-area:** `agent_orchestrator` core module, `context` subdomain (`lib/context/`). Conventions in [`2026-06-19-agent-orchestrator-conventions.md`](../2026-06-19-agent-orchestrator-conventions.md) are normative.

## 1. Gap statement

The CONTEXT spec (Phase 3) requires that documents feed an agent's `AgentContextBundle` as **facts with provenance** — each extracted value linked back to its source document + page/region — so a disposition can be traced to its evidence (AI Act contestability) and GUARD can treat document-derived text as untrusted. What exists today stops well short of that:

- `attachments` extracts **unstructured text only** into a single plaintext `attachments.content` column (`text`, nullable; added 2026-02). There is **no typed/structured extraction, no classification, no per-field locator (page/bbox), no confidence, and no encryption** of extracted content (`packages/core/src/modules/attachments/data/entities.ts`).
- An LLM-vision OCR path *does* exist (`lib/ocrService.ts`, 256 lines) but is **hardcoded to OpenAI `gpt-4o`** via `@ai-sdk/openai` + `generateText` — it bypasses `ai_assistant`'s `AiModelFactory`, has no provider abstraction, no tenancy passed to the model call (partition-level model config only), and produces a markdown blob, not a schema.
- The "queue" is **fire-and-forget `setImmediate`** (`lib/ocrQueue.ts`) — not a `packages/queue` worker; no retry, no persistence, no status, work lost on crash.

The 2026-04-27 draft is genuinely PARTIAL: it adds per-agent *chat-prep* conversion strategies (page-images, resize, inline), not a governed **extraction-to-typed-facts-with-provenance** pipeline. GAP-06 is to build that pipeline as CONTEXT Phase 3's document source.

## 2. Architectural drivers

| Driver | What it demands here |
|---|---|
| **Extraction accuracy** | Typed field extraction from heterogeneous claim docs (invoices, forms, IDs, scanned PDFs). Native PDFs vary; scans/photos need real OCR. |
| **Build-vs-buy** | LLM-vision is largely *assembly* of existing OM primitives; dedicated IDP (Textract/Azure DI/DocAI) is a new provider package + cost/vendor/residency commitment. |
| **$/page cost** | LLM-vision per-page token cost scales with page-image fidelity; IDP is per-page API priced. High-volume structured forms favor IDP; long-tail / low-volume favors LLM-vision. |
| **Latency / async** | Multi-page OCR + extraction is seconds-to-minutes — MUST be a real async `packages/queue` worker with retry/idempotency, not in the request path or `setImmediate`. |
| **Provenance / lineage fidelity** | Each extracted fact MUST carry `documentId → page/region → field`. This is the hard requirement that the current blob-text path cannot satisfy and that drives the data model. |
| **PII / data-residency** | Claim docs are PII. Extracted facts MUST be encryptable (`TenantDataEncryptionService`); residency constrains *which* provider may see raw bytes (esp. external IDP). |
| **Untrusted-input safety (GUARD)** | Extracted text is attacker-controllable. Extraction output must be tagged untrusted-data; provenance lets reviewers trace injected spans. |
| **OM-fit** | Reuse `attachments` (intake), `storage-s3` (artifacts), `packages/queue` (worker), `AiModelFactory` (LLM-vision), `integrations` (provider adapter), field-encryption (PII). Append-only evidence per conventions §3.2. |

## 3. Approaches considered

**(a) LLM-vision extraction via `AiModelFactory` (object-mode + per-doc-type Zod).**
Reuse the already-built `runAiAgentObject` path (`packages/ai-assistant/.../lib/agent-runtime.ts`): it resolves PDF/image attachments to multimodal `FileUIPart`s and calls `generateObject(model, messages, schema)`, returning a fully-typed, parsed object. Define one Zod schema per doc-type (discriminated union for classify-then-extract). **Strong OM-fit and typed output**; accuracy/cost vary by model and doc quality; provenance must be elicited as schema fields (the model emits a `page`/`region` per fact) rather than guaranteed by the engine.

**(b) Dedicated OCR/IDP provider via an `integrations` adapter.**
AWS Textract / Azure Document Intelligence / Google DocAI / Tesseract behind an `IntegrationDefinition` (`id`, `credentials` schema, `healthCheck` DI service) — the exact pattern `storage-s3` and `gateway-stripe` use. IDP engines return **layout + per-field bounding boxes natively** (true provenance, higher accuracy on dense forms/tables). Cost is per-page API; vendor lock-in and **data-residency** are first-order concerns (raw PII leaves the tenant boundary to a third party). Tesseract is self-hosted (residency-safe) but weaker, OCR-only (no field extraction).

**(c) Hybrid: OCR/layout layer → LLM extraction into typed schema with provenance.**
OCR/IDP (or a built-in rasterizer + Tesseract, or the IDP's text+geometry) produces a **text + layout/bbox layer**; the LLM-vision/text step (via `AiModelFactory`, object-mode) maps that into the typed per-doc-type schema and binds each fact to a `page`/`bbox` from the layout layer. Best provenance fidelity (geometry from OCR, semantics from LLM); two stages = more moving parts and combined cost. The **OCR engine is swappable** behind the same provider-adapter contract, so this subsumes (a) (engine = "none/LLM-only") and (b) (engine = IDP).

All three share: a `packages/queue` worker, `storage-s3` artifact persistence, append-only extraction records with provenance, field-encryption for PII, and GUARD untrusted-tagging.

## 4. Trade-off matrix

| Criterion | (a) LLM-vision | (b) Dedicated IDP | (c) Hybrid |
|---|---|---|---|
| Extraction accuracy (dense forms/tables) | Medium–High | **High** | **High** |
| Provenance fidelity (page/bbox) | Medium (model-asserted) | **High** (native bbox) | **High** (geometry + binding) |
| Typed/structured output | **High** (Zod object-mode) | Medium (needs mapping) | **High** |
| Build cost / OM-fit | **Low** (reuse `runAiAgentObject`) | Medium (new provider pkg) | Medium–High |
| $/page at volume | Medium (token-scaled) | **Low–Medium** (per-page) | Medium–High (both) |
| Latency | Medium | Medium | Higher (2 stages) |
| Data residency control | **Good** (provider via factory, can be self-host) | Risk (raw PII → vendor) | Configurable per engine |
| Untrusted-input handling | Same (output tagged) | Same | Same |
| Swappability | n/a (LLM only) | n/a (IDP only) | **High** (engine pluggable) |

## 5. Recommendation — **Hybrid architecture, LLM-vision default; provider choice INCONCLUSIVE**

Build approach **(c)**: a pluggable two-stage pipeline whose **OCR/layout engine is swappable behind a provider-adapter contract**, with the extraction stage standardized on `AiModelFactory` object-mode + per-doc-type Zod schemas. Ship the **LLM-vision-only path first** (engine = `llm`, reusing `runAiAgentObject`'s already-built multimodal+object-mode plumbing — the lowest-build, highest-OM-fit option), then add an IDP engine as a drop-in `integrations` provider for high-volume structured forms.

**Why hybrid-as-frame even when LLM-vision ships first:** the provenance and swappability requirements are cheap to honor up front (a `DocumentExtraction` record with a `provenance` jsonb and an `engine` discriminator) and expensive to retrofit. Standardizing extraction on object-mode Zod means the IDP engine, when added, maps into the *same* typed shape.

**INCONCLUSIVE — the deciding question is a business/cost/residency call, not a technical one:**

> *Will high-volume structured-form throughput (and the accuracy IDP buys on dense tables) justify (a) the per-page IDP cost and (b) sending raw claim-document PII to an external vendor under the tenant's data-residency obligations?*

- If **no / unknown / low volume** → default **LLM-vision only** (`AiModelFactory`, object-mode). Residency follows whatever model provider the tenant already trusts; zero new vendor.
- If **yes (high-volume structured forms, residency permits)** → add an **Azure Document Intelligence or AWS Textract** provider via the adapter contract below. (Tesseract is the residency-safe self-hosted fallback when no PII may leave infra but accuracy is secondary.)

Sensible default to record: **LLM-vision first; add an IDP provider only when a concrete high-volume structured-form workload with a cleared residency story appears.**

## 6. Effort, risks, dependencies

**Effort: M** (LLM-vision-first path); **L** if the IDP engine + adapter is in initial scope.
The LLM-vision stage is mostly assembly — `runAiAgentObject`, `storage-s3`, `packages/queue`, and the encryption service already exist and are production-tested. The net-new work is the extraction data model (with provenance), the queue worker, the provider-adapter seam, and GUARD tagging.

**Risks**
- *Wrong facts from OCR/extraction* (Medium) → store per-fact `confidence`; low-confidence facts excludable from routing (CONTEXT packer); provenance enables human review. (Mirrors CONTEXT risk table.)
- *Prompt injection via extracted text* (Medium) → tag all extracted facts `untrusted-data`; GUARD `prompt_injection`/`tool_scope` checks are the backstop; provenance traces injected spans.
- *PII leak* (High) → encrypt extracted facts with `TenantDataEncryptionService` before persist; store raw page artifacts in `storage-s3` (tenant-scoped key), not in the row; never log extracted content.
- *Residency breach via external IDP* (High, only if engine=IDP) → adapter must gate on a per-tenant residency flag; LLM-vision/Tesseract are the in-region fallbacks.
- *`setImmediate` → real queue migration* (Low) → the existing fire-and-forget OCR is replaced, not extended; additive new worker.
- *Provenance fidelity on LLM-only engine* (Medium) → model-asserted page/region is weaker than IDP bbox; acceptable for v1, hardened by adding an OCR-geometry engine later.

**Dependencies**
`attachments` (intake, storage drivers), `storage-s3` (`storageService` DI, namespaced artifacts), `packages/queue` (worker contract, idempotent retry), `ai_assistant` `AiModelFactory` + `runAiAgentObject` (LLM-vision object-mode), `integrations` (`IntegrationDefinition` + `integrationCredentialsService` for IDP engines), `TenantDataEncryptionService` (PII), GUARD spec (untrusted tagging), CONTEXT spec (consumes facts → `AgentContextBundle.sources` provenance). **No** `telemetry-and-otel` (does not exist — do not claim).

## 7. Deliverables + acceptance

**Pipeline stages** (all org+tenant scoped):
1. **Intake** — reuse `attachments` upload + storage driver; classify doc-type (LLM object-mode or IDP).
2. **Engine (swappable)** — `llm` (default; `AiModelFactory` multimodal) | `idp` (Textract/Azure DI via adapter) | `tesseract` (self-hosted). Produces text + optional layout/geometry.
3. **Extraction** — `AiModelFactory` object-mode with a **per-doc-type Zod schema** (discriminated union); each field bound to `{page, bbox?}` from the layout layer.
4. **Persist** — extracted facts (encrypted) + provenance; raw page artifacts → `storage-s3`.
5. **Emit** — `agent_orchestrator.document.extracted` event (`module.entity.action`, past tense) for CONTEXT/GUARD.

**Worker** — `packages/queue` worker (`workers/document-extract.ts`, queue `document-ingest`, I/O-bound `concurrency` 3–5 within DB budget). Idempotent (skip if a non-deleted extraction exists for the doc). Replaces `ocrQueue.ts` `setImmediate`.

**Extraction schema (data model)** — new append-only-ish record (conventions §3: `/legacy` decorators, dual `tenant_id`+`organization_id`, UUID PK, `jsonb` for JSON with Zod in `data/validators.ts`, `agent_` prefix family). Sketch:
`agent_document_extractions(id, tenant_id, organization_id, attachment_id /*FK id*/, doc_type, engine, status, schema_name, fields jsonb /*encrypted PII*/, provenance jsonb, confidence float, artifact_ref /*storage-s3*/, created_at, updated_at)`. `provenance: [{ factId, sourceRef: attachmentId, locator: "page:N#bbox" }]` — the shape CONTEXT's `AgentContextBundle.sources` consumes.

**Provenance model** — every extracted fact ⇒ `{ factId, sourceKind:'document', sourceRef: attachmentId, locator: page/region, confidence }`, matching CONTEXT's `retrieve()`/`sources` contract so lineage flows fact → evidence for AI-Act contestability.

**Provider adapter contract** (swappable OCR engine, mirrors `integrations`):
```typescript
interface DocumentOcrProvider {
  id: string                       // 'ocr_azure_di' | 'ocr_aws_textract' | 'ocr_tesseract'
  extract(input: {
    buffer: Buffer; mimeType: string
    scope: { tenantId: string; organizationId: string }
  }): Promise<{
    text: string
    pages: Array<{ page: number; blocks: Array<{ text: string; bbox: [number,number,number,number] }> }>
    confidence?: number
  }>
}
```
Registered as an `IntegrationDefinition` (`credentials` schema + `healthCheck` DI service); credentials via `integrationCredentialsService` (encrypted at rest). The `llm` engine satisfies the same interface with model-asserted geometry; `tesseract` is the self-hosted/residency-safe impl.

**Acceptance**
- A claim PDF/image produces one extraction record with typed `fields` (validated against its per-doc-type Zod schema), both `tenant_id` and `organization_id` set, reads org-scoped.
- **Every** extracted fact links to `attachmentId` + page/region locator (lineage) — satisfies CONTEXT contestability.
- Extraction runs as a `packages/queue` worker; re-running the same doc is a no-op (idempotent); no `setImmediate`.
- PII fields are encrypted at rest (`TenantDataEncryptionService`); raw bytes live only in `storage-s3` (tenant-scoped key); extracted content is never logged.
- Extracted text/facts are tagged untrusted; GUARD can flag injected instructions; a poisoned doc cannot drive an unauthorized action.
- Swapping the OCR engine (`llm` ↔ `idp` ↔ `tesseract`) requires no change to the extraction-schema or CONTEXT consumer — only the registered provider differs.
- `agent_orchestrator.document.extracted` fires with `{ attachmentId, docType, engine, confidence }`.

## Changelog

- **2026-06-19:** Initial design analysis. Corrected the brief's premise after codebase audit: a naive LLM-vision OCR path **already exists** (`attachments/lib/ocrService.ts`, OpenAI `gpt-4o`, hardcoded, `setImmediate` queue, plaintext blob output) — GAP-06 is to *elevate* it into a governed, typed, provenance-carrying, swappable pipeline, not build from zero. Recommended **hybrid** with **LLM-vision (via existing `runAiAgentObject` object-mode) as the default first ship**; marked the **IDP-provider choice INCONCLUSIVE** (business/cost/residency decision) with a default of LLM-vision-first. Verified reuse seams: `AiModelFactory`/`runAiAgentObject` (multimodal object-mode with per-doc-type Zod, production-ready), `storage-s3` `storageService`, `packages/queue` worker contract, `integrations` `IntegrationDefinition`+`integrationCredentialsService`, `TenantDataEncryptionService`. Confirmed `telemetry-and-otel` does not exist and is not referenced.
