import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { z } from 'zod'
import { AgentContextBundle } from '../../data/entities'
import {
  contextBundleRoutedSourcesSchema,
  contextBundlePrunedSourcesSchema,
  contextBundleSourcesSchema,
  type ContextProvenance,
} from '../../data/validators'
import {
  resolveContextModule,
  type ContextModule,
  type ContextSourceDecl,
  type ContextSourceHit,
} from './registry'
import { estimateTokens, packCandidates, type PackCandidate } from './packer'
import { readRetrievalSource } from './retrievalSource'
import type { DocumentExtraction } from '../../data/validators'
import {
  documentExtractionToCandidates,
  documentProvenance,
  DEFAULT_DOCUMENT_MIN_CONFIDENCE,
} from './documentSource'
import type { DocumentIngestInput, DocumentIngestService } from './documentIngest'

/**
 * Input to a TDCR assembly. Validated by `assembleInputSchema`; tenant/org are
 * NEVER taken from anywhere but the caller scope so a run can't assemble
 * cross-tenant context.
 */
export const assembleInputSchema = z.object({
  // tenant/org/run ids are server-derived (never user input), so we validate them
  // as non-empty rather than strict RFC-UUID — the caller scope is the authority.
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  agentRunId: z.string().min(1),
  processId: z.string().nullable().optional(),
  stepId: z.string().nullable().optional(),
  capability: z.string().min(1),
  budget: z.number().int().positive(),
})

/**
 * Assemble input. The serializable fields are validated by `assembleInputSchema`;
 * `documentInputs` (raw bytes the resolver ingests via the document pipeline) and
 * `documentExtractions` (already-ingested facts) are typed outside the strict
 * Zod parse — the `Buffer` payload is not a JSON value. Both feed `document`
 * candidates into the bundle with provenance + confidence (Phase 3).
 */
export type AssembleInput = z.infer<typeof assembleInputSchema> & {
  /** Raw documents the resolver ingests (OCR → classify → extract) at assembly time. */
  documentInputs?: Array<Omit<DocumentIngestInput, 'scope'>>
  /** Pre-ingested document extractions to fold in (e.g. from an async ingest worker). */
  documentExtractions?: DocumentExtraction[]
  /** Facts below this confidence are excluded from routing (default 0.5). */
  documentMinConfidence?: number
}

export type AssembleResult = {
  bundle: AgentContextBundle
  payloadRef: string | null
}

export type RetrieveScope = {
  tenantId: string
  organizationId: string
  capability: string
}

/**
 * A citable grounding snippet returned by `retrieve()`. The grounding contract
 * GUARANTEES `sourceRef` + `locator` + `score` on every snippet — `locator` is
 * required (not optional) so the Wave 3 cite-or-abstain check can always resolve
 * a cite back to its source.
 */
export type RetrievedSnippet = {
  sourceKind: 'entity' | 'document' | 'retrieval'
  sourceRef: string
  locator: string
  snippet: string
  score: number
}

/**
 * A capability has no declared `ContextModule` — the assembler fails closed
 * rather than assembling an ungoverned (and so unbounded least-privilege) context.
 */
export class ContextModuleNotFoundError extends Error {
  readonly code = 'context_module_not_found'
  constructor(capability: string) {
    super(`[internal] no ContextModule declared for capability "${capability}"`)
    this.name = 'ContextModuleNotFoundError'
  }
}

export interface ContextResolver {
  assemble(em: EntityManager, input: AssembleInput): Promise<AssembleResult>
  retrieve(em: EntityManager, query: string, scope: RetrieveScope): Promise<RetrievedSnippet[]>
}

/**
 * Hybrid Task-Driven Context Routing (TDCR) resolver (context overlay, Phase 1).
 *
 * Resolves the per-capability `ContextModule` (code-first registry, fails closed),
 * reads the declared MANDATORY floor over `entities`/custom fields via the
 * `queryEngine` (`query_index`, org-scoped) with provenance stamped at assembly
 * time, packs mandatory-first under the token budget, and persists exactly ONE
 * append-only `AgentContextBundle` per run.
 *
 * Clean seams for later phases:
 *   - `retrieve()` is the standalone grounding hook — Phase 2 wires `searchService`
 *     RRF fill behind it; it returns citable snippets (sourceRef + locator + score)
 *     and is the contract the Wave 3 grounding (cite-or-abstain) check consumes.
 *   - the packer's token estimator + redaction stage are where P4 plugs the
 *     model-appropriate tokenizer and PII/field-encryption redaction.
 *   - the `document` source kind is declared by the registry and assembled by P3.
 */
export class ContextResolverImpl implements ContextResolver {
  constructor(private readonly container: AwilixContainer) {}

  private get queryEngine(): QueryEngine {
    return this.container.resolve('queryEngine') as QueryEngine
  }

  private get documentIngestService(): DocumentIngestService | null {
    const hasRegistration =
      typeof this.container.hasRegistration === 'function'
        ? this.container.hasRegistration.bind(this.container)
        : null
    if (hasRegistration && !hasRegistration('agentDocumentIngestService')) return null
    try {
      return this.container.resolve('agentDocumentIngestService') as DocumentIngestService
    } catch {
      return null
    }
  }

  async assemble(em: EntityManager, input: AssembleInput): Promise<AssembleResult> {
    // Validate the serializable scope/budget fields; the Buffer-bearing document
    // inputs ride alongside as a typed param (not a JSON value).
    const parsedScope = assembleInputSchema.parse(input)
    const parsed: AssembleInput = {
      ...parsedScope,
      documentInputs: input.documentInputs,
      documentExtractions: input.documentExtractions,
      documentMinConfidence: input.documentMinConfidence,
    }
    const module = resolveContextModule(parsed.capability)
    if (!module) throw new ContextModuleNotFoundError(parsed.capability)

    const candidates = await this.collectCandidates(module, parsed)
    const packed = packCandidates(candidates, parsed.budget)

    // Validate the jsonb shapes at the Zod boundary before persisting.
    const routedSources = contextBundleRoutedSourcesSchema.parse(packed.routedSources)
    const prunedSources = contextBundlePrunedSourcesSchema.parse(packed.prunedSources)
    const sources = contextBundleSourcesSchema.parse(packed.sources)

    const bundle = em.create(AgentContextBundle, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      agentRunId: parsed.agentRunId,
      processId: parsed.processId ?? null,
      stepId: parsed.stepId ?? null,
      capability: parsed.capability,
      routedSources,
      prunedSources: prunedSources.length ? prunedSources : null,
      sources,
      tokenBudget: parsed.budget,
      tokensUsed: packed.tokensUsed,
      // P4 records field-encryption/PII redaction here (least-privilege seam).
      redactionApplied: null,
      // P4 offloads the packed payload to storage-s3 and stores the ref here.
      payloadRef: null,
    })
    em.persist(bundle)
    await em.flush()

    return { bundle, payloadRef: bundle.payloadRef ?? null }
  }

  /**
   * Standalone grounding lookup — the contract the Wave 3 guardrails grounding
   * (cite-or-abstain) check consumes. Wraps `searchService` (RRF, `packages/search`)
   * over the capability's declared `retrieval` sources plus its structured
   * `entity` sources, ALWAYS org+tenant scoped (cross-tenant retrieval is
   * structurally impossible — the scope is the authority, never user input).
   *
   * GROUNDING CONTRACT: every returned snippet is CITABLE — it carries
   * `sourceRef` + `locator` + `score`. No snippet is ever emitted without a
   * locator or score (a malformed search row is dropped, not returned uncited),
   * so the grounding check can verify a proposal's cites or force an abstain.
   *
   * Signature:
   *   retrieve(em, query, { tenantId, organizationId, capability })
   *     => Promise<RetrievedSnippet[]>
   *   RetrievedSnippet = { sourceKind, sourceRef, locator, snippet, score }
   */
  async retrieve(
    _em: EntityManager,
    query: string,
    scope: RetrieveScope,
  ): Promise<RetrievedSnippet[]> {
    const module = resolveContextModule(scope.capability)
    if (!module) throw new ContextModuleNotFoundError(scope.capability)

    const readScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
    const snippets: RetrievedSnippet[] = []

    // Retrieval sources: RRF-ranked `searchService` hits (the primary grounding
    // surface). Every hit is citable by construction (locator + score).
    for (const source of module.sources) {
      if (source.kind !== 'retrieval') continue
      const hits = await readRetrievalSource(this.container, source, query, readScope)
      for (const hit of hits) {
        if (!hit.locator || typeof hit.score !== 'number') continue
        snippets.push({
          sourceKind: 'retrieval',
          sourceRef: hit.ref,
          locator: hit.locator,
          snippet: typeof hit.record.snippet === 'string' ? hit.record.snippet : JSON.stringify(hit.record),
          score: hit.score,
        })
      }
    }

    // Structured `entity` sources also ground a proposal — emit them as citable
    // snippets (the record id is the locator, score defaults to a certain 1).
    for (const source of module.sources) {
      if (source.kind !== 'entity') continue
      const hits = await this.readEntitySource(source, readScope)
      for (const hit of hits) {
        const locator = hit.locator ?? `${source.entityType}:${hit.ref}`
        snippets.push({
          sourceKind: 'entity',
          sourceRef: hit.ref,
          locator,
          snippet: JSON.stringify(hit.record),
          score: hit.score ?? 1,
        })
      }
    }

    return snippets
  }

  private async collectCandidates(
    module: ContextModule,
    input: AssembleInput,
  ): Promise<PackCandidate[]> {
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const candidates: PackCandidate[] = []
    const ordered = [...module.sources].sort((left, right) => left.priority - right.priority)

    // First pass: read structured `entity` sources. The mandatory floor comes
    // exclusively from these (retrieval is always optional fill), so we read it
    // before deriving the retrieval query from the assembled mandatory facts.
    for (const source of ordered) {
      if (source.kind !== 'entity') continue
      const hits = await this.readEntitySource(source, scope)
      for (const hit of hits) {
        const provenance: ContextProvenance = source.provenance(hit)
        candidates.push({
          kind: source.kind,
          tier: source.tier,
          hit,
          tokens: estimateTokens(hit.record),
          provenance,
        })
      }
    }

    // Second pass: retrieval-ranked OPTIONAL fill (Phase 2). The query is derived
    // from the mandatory floor so retrieval is grounded in the subject the
    // capability MUST see; results pack into the budget remaining after the floor
    // and flow through the same routed/pruned recording as every other candidate.
    const retrievalQuery = buildRetrievalQuery(candidates, input.capability)
    for (const source of ordered) {
      if (source.kind !== 'retrieval') continue
      const hits = await readRetrievalSource(this.container, source, retrievalQuery, scope)
      for (const hit of hits) {
        const provenance: ContextProvenance = source.provenance(hit)
        candidates.push({
          kind: source.kind,
          tier: source.tier,
          hit,
          tokens: estimateTokens(hit.record),
          provenance,
        })
      }
    }

    // Third pass: document facts (Phase 3). Ingest any raw documents via the
    // swappable OCR/extraction pipeline, fold in any pre-ingested extractions,
    // then pack each fact as an OPTIONAL `document` candidate. Low-confidence
    // facts are excluded before they enter the pool (excludable-from-routing);
    // extracted text is UNTRUSTED data, never an instruction.
    const extractions = await this.collectDocumentExtractions(input, scope)
    const minConfidence = input.documentMinConfidence ?? DEFAULT_DOCUMENT_MIN_CONFIDENCE
    for (const extraction of extractions) {
      for (const { fact, hit } of documentExtractionToCandidates(extraction, { minConfidence })) {
        candidates.push({
          kind: 'document',
          tier: 'optional',
          hit,
          tokens: estimateTokens(hit.record),
          provenance: documentProvenance(fact),
        })
      }
    }

    return candidates
  }

  /**
   * Ingest raw `documentInputs` through the swappable pipeline (org+tenant scoped)
   * and merge with any pre-supplied `documentExtractions`. Returns `[]` when no
   * documents are supplied or the ingest service is unregistered — document facts
   * are optional fill, so their absence never breaks assembly.
   */
  private async collectDocumentExtractions(
    input: AssembleInput,
    scope: { tenantId: string; organizationId: string },
  ): Promise<DocumentExtraction[]> {
    const extractions: DocumentExtraction[] = [...(input.documentExtractions ?? [])]
    const documentInputs = input.documentInputs ?? []
    if (documentInputs.length) {
      const service = this.documentIngestService
      if (service) {
        for (const document of documentInputs) {
          const extraction = await service.ingest({ ...document, scope })
          // The ingest pipeline binds every fact to this document's sourceRef; the
          // scope is the authority, so a cross-tenant document can never be folded in.
          extractions.push(extraction)
        }
      }
    }
    return extractions
  }

  /**
   * Read a structured `entity` source via the `queryEngine` (`query_index`),
   * ALWAYS org+tenant scoped — cross-tenant reads are structurally impossible.
   */
  private async readEntitySource(
    source: ContextSourceDecl,
    scope: { tenantId: string; organizationId: string },
  ): Promise<ContextSourceHit[]> {
    const result = await this.queryEngine.query<Record<string, unknown>>(source.entityType, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      fields: source.fields,
      page: { page: 1, pageSize: 100 },
    })
    return result.items.map((record) => ({
      ref: String((record as { id?: unknown }).id ?? ''),
      record,
    }))
  }
}

/** Field names whose value is a human-meaningful term to seed retrieval. */
const RETRIEVAL_QUERY_FIELDS = ['title', 'name', 'subject', 'label', 'summary', 'description']

/**
 * Derive the retrieval query for the optional fill from the assembled mandatory
 * floor: the capability id plus short, human-meaningful values from the
 * mandatory facts. Deterministic and bounded so retrieval is grounded in what
 * the capability MUST see (not free-form user input).
 */
function buildRetrievalQuery(candidates: PackCandidate[], capability: string): string {
  const terms: string[] = [capability]
  for (const candidate of candidates) {
    if (candidate.tier !== 'mandatory') continue
    for (const field of RETRIEVAL_QUERY_FIELDS) {
      const value = candidate.hit.record[field]
      if (typeof value === 'string' && value.trim()) terms.push(value.trim())
    }
  }
  return [...new Set(terms)].join(' ').slice(0, 512).trim()
}
