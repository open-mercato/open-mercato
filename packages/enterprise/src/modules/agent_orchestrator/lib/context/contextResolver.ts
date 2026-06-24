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
export type AssembleInput = z.infer<typeof assembleInputSchema>

export type AssembleResult = {
  bundle: AgentContextBundle
  payloadRef: string | null
}

export type RetrieveScope = {
  tenantId: string
  organizationId: string
  capability: string
}

export type RetrievedSnippet = {
  sourceKind: 'entity' | 'document' | 'retrieval'
  sourceRef: string
  locator?: string
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
 *   - `retrieve()` is the standalone grounding hook (P2 wires `searchService` RRF
 *     fill behind it; Phase 1 returns the mandatory entity hits as citable snippets).
 *   - the packer's token estimator + redaction stage are where P4 plugs the
 *     model-appropriate tokenizer and PII/field-encryption redaction.
 *   - the `document` source kind is declared by the registry and assembled by P3.
 */
export class ContextResolverImpl implements ContextResolver {
  constructor(private readonly container: AwilixContainer) {}

  private get queryEngine(): QueryEngine {
    return this.container.resolve('queryEngine') as QueryEngine
  }

  async assemble(em: EntityManager, input: AssembleInput): Promise<AssembleResult> {
    const parsed = assembleInputSchema.parse(input)
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
   * Standalone grounding lookup (the guardrails grounding-check seam). Phase 1
   * returns the capability's mandatory entity hits as citable snippets (ref +
   * locator + score). P2 fills it with `searchService` RRF-ranked retrieval.
   */
  async retrieve(
    em: EntityManager,
    _query: string,
    scope: RetrieveScope,
  ): Promise<RetrievedSnippet[]> {
    const module = resolveContextModule(scope.capability)
    if (!module) throw new ContextModuleNotFoundError(scope.capability)

    const snippets: RetrievedSnippet[] = []
    for (const source of module.sources) {
      if (source.kind !== 'entity') continue
      const hits = await this.readEntitySource(source, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      for (const hit of hits) {
        snippets.push({
          sourceKind: 'entity',
          sourceRef: hit.ref,
          ...(hit.locator ? { locator: hit.locator } : {}),
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
    const candidates: PackCandidate[] = []
    const ordered = [...module.sources].sort((left, right) => left.priority - right.priority)
    for (const source of ordered) {
      // Phase 1 assembles `entity` sources. `retrieval` (P2) and `document` (P3)
      // are declared by the registry and packed by later phases — skip cleanly.
      if (source.kind !== 'entity') continue
      const hits = await this.readEntitySource(source, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
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
    return candidates
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
