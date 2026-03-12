/**
 * Generic timeline handler factory.
 * Creates a reusable handler function that orchestrates timeline data fetching,
 * user resolution, normalization, and aggregation.
 *
 * Usage:
 *   const handler = createTimelineHandler({ allKinds, sources, userResolver })
 *   // In your API route, after auth + entity loading:
 *   const result = await handler(ctx, { limit: 30, before, types })
 */
import type { TimelineEntry, AggregateOptions } from './types'
import { aggregateTimeline } from './aggregator'

const FETCH_MULTIPLIER = 3

export type TimelineSourceContext = {
  entityId: string
  entity: unknown
  em: unknown
  scope: { tenantId: string | null; organizationId: string | null }
  container: unknown
}

export type TimelineSourceDef<K extends string = string> = {
  fetch: (ctx: TimelineSourceContext & { fetchLimit: number; beforeFilter: Record<string, unknown> }) => Promise<unknown[]>
  normalize: (records: unknown[], displayUsers: Record<string, string>) => TimelineEntry<K>[]
  collectUserIds?: (records: unknown[]) => string[]
}

export type TimelineHandlerConfig<K extends string = string> = {
  allKinds: readonly K[]
  sources: TimelineSourceDef<K>[]
  userResolver: (userIds: string[], ctx: TimelineSourceContext) => Promise<Record<string, string>>
}

export type TimelineQuery = {
  limit: number
  before?: string
  types?: string
}

function parseTypesFilter<K extends string>(
  typesParam: string | undefined,
  allKinds: readonly K[],
): Set<K> | null {
  if (!typesParam) return null
  const requested = typesParam.split(',').map((s) => s.trim()).filter(Boolean)
  const valid = requested.filter((t): t is K =>
    (allKinds as readonly string[]).includes(t),
  )
  return valid.length > 0 ? new Set(valid) : null
}

function buildBeforeFilter(before: string | undefined): Record<string, unknown> {
  if (!before) return {}
  const date = new Date(before)
  if (!Number.isFinite(date.getTime())) return {}
  return { $lt: date }
}

export function createTimelineHandler<K extends string>(config: TimelineHandlerConfig<K>) {
  return async function handleTimeline(
    ctx: TimelineSourceContext,
    query: TimelineQuery,
  ): Promise<{ items: TimelineEntry<K>[]; nextCursor: string | null }> {
    const typesFilter = parseTypesFilter(query.types, config.allKinds)
    const fetchLimit = query.limit * FETCH_MULTIPLIER
    const beforeFilter = buildBeforeFilter(query.before)

    const sourceCtx = { ...ctx, fetchLimit, beforeFilter }

    const rawResults = await Promise.all(
      config.sources.map((source) => source.fetch(sourceCtx).catch(() => [])),
    )

    const userIds = new Set<string>()
    for (let i = 0; i < config.sources.length; i++) {
      const source = config.sources[i]
      if (source.collectUserIds) {
        for (const id of source.collectUserIds(rawResults[i])) {
          if (id) userIds.add(id)
        }
      }
    }

    const displayUsers = userIds.size > 0
      ? await config.userResolver([...userIds], ctx)
      : {}

    const normalizedSources = config.sources.map((source, i) =>
      source.normalize(rawResults[i], displayUsers),
    )

    const aggregateOptions: AggregateOptions<K> = {
      limit: query.limit,
      before: query.before ?? null,
      types: typesFilter,
    }

    return aggregateTimeline(normalizedSources, aggregateOptions)
  }
}
