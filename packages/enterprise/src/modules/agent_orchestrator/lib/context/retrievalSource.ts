import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { ContextSourceDecl, ContextSourceHit } from './registry'

/**
 * Retrieval source (context overlay, Phase 2).
 *
 * Wraps the platform `searchService` (`packages/search`, RRF-fused vector /
 * fulltext / token strategies) as a retrieval-ranked OPTIONAL fill for the TDCR
 * resolver, and powers the standalone `retrieve()` grounding contract that the
 * Wave 3 guardrails cite-or-abstain check consumes.
 *
 * Hard contract (the grounding check depends on it): EVERY hit this source emits
 * is citable — it carries `sourceRef` + `locator` + `score`. No hit may lack a
 * locator or score; a malformed `searchService` row is dropped rather than
 * emitted uncited.
 *
 * Tenancy: reads are ALWAYS org+tenant scoped via `SearchOptions` — cross-tenant
 * retrieval is structurally impossible (the org filter is passed on every call
 * and never taken from anywhere but the run scope).
 *
 * Decoupling: `@open-mercato/search` is not a direct dependency of
 * `@open-mercato/enterprise`. We consume the service structurally through the DI
 * container (the same pattern the resolver uses for `queryEngine`) so the search
 * package's contract surface is consumed, never imported/modified, and retrieval
 * degrades to an empty fill when search is not registered.
 */

/** The minimal structural shape of a `searchService.search` hit we consume. */
const searchHitSchema = z
  .object({
    entityId: z.string().min(1),
    recordId: z.string().min(1),
    score: z.number(),
    source: z.string().optional(),
    presenter: z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
      })
      .passthrough()
      .optional(),
    url: z.string().optional(),
  })
  .passthrough()
export type SearchHit = z.infer<typeof searchHitSchema>

/** The structural `searchService` contract we depend on (consumed via DI, never imported). */
export type SearchServiceLike = {
  search(
    query: string,
    options: {
      tenantId: string
      organizationId?: string | null
      entityTypes?: string[]
      limit?: number
    },
  ): Promise<unknown[]>
}

export type RetrievalScope = {
  tenantId: string
  organizationId: string
}

/** A conservative default cap on hits pulled before the packer trims to budget. */
const DEFAULT_RETRIEVAL_LIMIT = 20

/**
 * Read a `retrieval` source via `searchService` (RRF), org+tenant scoped, and
 * map each row to a citable `ContextSourceHit` (`ref` + `locator` + `score`).
 *
 * Returns `[]` (never throws) when `searchService` is unregistered or the query
 * is empty — retrieval is optional fill, so its absence must not break assembly.
 */
export async function readRetrievalSource(
  container: AwilixContainer,
  source: ContextSourceDecl,
  query: string,
  scope: RetrievalScope,
): Promise<ContextSourceHit[]> {
  if (source.kind !== 'retrieval') return []
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []

  const searchService = resolveSearchService(container)
  if (!searchService) return []

  const entityTypes = (source.entityTypes ?? []).filter((value) => value.length > 0)
  const rawHits = await searchService.search(trimmedQuery, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ...(entityTypes.length ? { entityTypes } : {}),
    limit: source.limit ?? DEFAULT_RETRIEVAL_LIMIT,
  })

  if (!Array.isArray(rawHits)) return []

  const hits: ContextSourceHit[] = []
  for (const raw of rawHits) {
    const parsed = searchHitSchema.safeParse(raw)
    // Drop malformed rows: an uncitable hit (no entity/record/score) MUST NOT be
    // emitted — the grounding check requires every hit to carry locator + score.
    if (!parsed.success) continue
    const hit = parsed.data
    const locator = `${hit.entityId}:${hit.recordId}`
    const snippet = buildSnippet(hit)
    hits.push({
      ref: locator,
      locator,
      score: hit.score,
      record: {
        entityType: hit.entityId,
        recordId: hit.recordId,
        snippet,
        ...(hit.url ? { url: hit.url } : {}),
      },
    })
  }
  return hits
}

/**
 * Resolve `searchService` from the container, returning null when it is not
 * registered (search module disabled / standalone app without search).
 */
function resolveSearchService(container: AwilixContainer): SearchServiceLike | null {
  const hasRegistration =
    typeof container.hasRegistration === 'function' ? container.hasRegistration.bind(container) : null
  if (hasRegistration && !hasRegistration('searchService')) return null
  try {
    const resolved = container.resolve('searchService') as SearchServiceLike
    return typeof resolved?.search === 'function' ? resolved : null
  } catch {
    return null
  }
}

/** Build the agent-visible snippet text from a hit's presenter (no raw record bodies). */
function buildSnippet(hit: SearchHit): string {
  const title = hit.presenter?.title?.trim()
  const subtitle = hit.presenter?.subtitle?.trim()
  const parts = [title, subtitle].filter((value): value is string => !!value && value.length > 0)
  if (parts.length) return parts.join(' — ')
  return `${hit.entityId}:${hit.recordId}`
}
