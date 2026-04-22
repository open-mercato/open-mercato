import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { QueryCustomFieldSource, QueryJoinEdge, QueryEngine } from '@open-mercato/shared/lib/query/types'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import { deserializeAdvancedFilter } from '@open-mercato/shared/lib/query/advanced-filter'
import { SortDir } from '@open-mercato/shared/lib/query/types'

const { withScopedPayload, parseScopedCommandInput } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'customers.errors.tenant_required', fallback: 'Tenant context is required' },
    organizationRequired: { key: 'customers.errors.organization_required', fallback: 'Organization context is required' },
  },
})

const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

type SearchTokenMatchInput = {
  ctx: CrudCtx
  entityType: string
  fields: string[]
  query: string
}

type SearchTokenSource = {
  entityType: string
  fields: string[]
  mapToEntityIds?: {
    table: string
    sourceColumn?: string
    targetColumn: string
    tenantColumn?: string
    organizationColumn?: string
  }
}

async function enrichSearchSourcesWithCustomFieldTokens(
  ctx: CrudCtx,
  sources: SearchTokenSource[],
): Promise<SearchTokenSource[]> {
  const entityTypes = Array.from(
    new Set(
      sources
        .map((source) => source.entityType)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  )
  if (!entityTypes.length) return sources

  const em = ctx.container.resolve('em') as EntityManager
  const knex = (em as any).getConnection().getKnex()
  let defsQuery = knex('custom_field_defs')
    .select('entity_id', 'key', 'kind')
    .whereIn('entity_id', entityTypes)
    .andWhere('is_active', true)

  defsQuery = defsQuery.andWhere((builder: any) => {
    builder.where({ tenant_id: ctx.auth?.tenantId ?? null }).orWhereNull('tenant_id')
  })

  if (ctx.selectedOrganizationId) {
    defsQuery = defsQuery.andWhere((builder: any) => {
      builder.where({ organization_id: ctx.selectedOrganizationId }).orWhereNull('organization_id')
    })
  } else if (Array.isArray(ctx.organizationIds) && ctx.organizationIds.length > 0) {
    defsQuery = defsQuery.andWhere((builder: any) => {
      builder.whereIn('organization_id', ctx.organizationIds).orWhereNull('organization_id')
    })
  }

  const customFieldKeysByEntity = new Map<string, Set<string>>()
  const rows = await defsQuery
  for (const row of rows as Array<{ entity_id?: unknown; key?: unknown; kind?: unknown }>) {
    if (row.kind === 'attachment') continue
    const entityType = typeof row.entity_id === 'string' ? row.entity_id : null
    const key = typeof row.key === 'string' ? row.key.trim() : ''
    if (!entityType || !key) continue
    const bucket = customFieldKeysByEntity.get(entityType) ?? new Set<string>()
    bucket.add(`cf:${key}`)
    customFieldKeysByEntity.set(entityType, bucket)
  }

  return sources.map((source) => {
    const customFieldKeys = customFieldKeysByEntity.get(source.entityType)
    return {
      ...source,
      fields: Array.from(new Set([
        'search_text',
        ...source.fields,
        ...(customFieldKeys ? Array.from(customFieldKeys) : []),
      ])),
    }
  })
}

async function findSearchTokenEntityIds({
  ctx,
  entityType,
  fields,
  query,
}: SearchTokenMatchInput): Promise<string[] | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  const tokens = tokenizeText(trimmed, resolveSearchConfig())
  if (!tokens.hashes.length) return []

  const em = ctx.container.resolve('em') as EntityManager
  const knex = (em as any).getConnection().getKnex()
  let searchQuery = knex('search_tokens')
    .select('entity_id')
    .where('entity_type', entityType)
    .whereIn('field', fields)
    .whereIn('token_hash', tokens.hashes)
    .groupBy('entity_id')
    .havingRaw('count(distinct token_hash) >= ?', [tokens.hashes.length])

  if (ctx.auth?.tenantId !== undefined) {
    searchQuery = searchQuery.whereRaw('tenant_id is not distinct from ?', [ctx.auth?.tenantId ?? null])
  }
  if (ctx.selectedOrganizationId) {
    searchQuery = searchQuery.where('organization_id', ctx.selectedOrganizationId)
  } else if (Array.isArray(ctx.organizationIds) && ctx.organizationIds.length > 0) {
    searchQuery = searchQuery.whereIn('organization_id', ctx.organizationIds)
  }

  const rows = await searchQuery
  return rows
    .map((row: { entity_id?: unknown }) => (typeof row.entity_id === 'string' ? row.entity_id : null))
    .filter((id: string | null): id is string => typeof id === 'string' && id.length > 0)
}

async function mapScopedEntityIds({
  ctx,
  ids,
  config,
}: {
  ctx: CrudCtx
  ids: string[]
  config: NonNullable<SearchTokenSource['mapToEntityIds']>
}): Promise<string[]> {
  if (!ids.length) return []

  const em = ctx.container.resolve('em') as EntityManager
  const knex = (em as any).getConnection().getKnex()
  const sourceColumn = config.sourceColumn ?? 'id'
  const tenantColumn = config.tenantColumn ?? 'tenant_id'
  const organizationColumn = config.organizationColumn ?? 'organization_id'

  let mapQuery = knex(config.table)
    .select(config.targetColumn)
    .whereIn(sourceColumn, ids)

  if (ctx.auth?.tenantId !== undefined) {
    mapQuery = mapQuery.whereRaw('?? is not distinct from ?', [tenantColumn, ctx.auth?.tenantId ?? null])
  }
  if (ctx.selectedOrganizationId) {
    mapQuery = mapQuery.where(organizationColumn, ctx.selectedOrganizationId)
  } else if (Array.isArray(ctx.organizationIds) && ctx.organizationIds.length > 0) {
    mapQuery = mapQuery.whereIn(organizationColumn, ctx.organizationIds)
  }

  const rows = await mapQuery
  return rows
    .map((row: Record<string, unknown>) => {
      const value = row[config.targetColumn]
      return typeof value === 'string' ? value : null
    })
    .filter((id: string | null): id is string => typeof id === 'string' && id.length > 0)
}

export async function findMatchingEntityIdsBySearchTokensAcrossSources({
  ctx,
  sources,
  query,
}: {
  ctx: CrudCtx
  sources: SearchTokenSource[]
  query: string
}): Promise<string[] | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  const enrichedSources = await enrichSearchSourcesWithCustomFieldTokens(ctx, sources)
  const matchedIds = new Set<string>()
  for (const source of enrichedSources) {
    const rawIds = await findSearchTokenEntityIds({
      ctx,
      entityType: source.entityType,
      fields: source.fields,
      query: trimmed,
    })
    if (rawIds === null) return null
    const entityIds = source.mapToEntityIds
      ? await mapScopedEntityIds({ ctx, ids: rawIds, config: source.mapToEntityIds })
      : rawIds
    entityIds.forEach((id) => matchedIds.add(id))
  }

  return Array.from(matchedIds)
}

export async function findMatchingEntityIdsBySearchTokens({
  ctx,
  entityType,
  fields,
  query,
}: SearchTokenMatchInput): Promise<string[] | null> {
  return findMatchingEntityIdsBySearchTokensAcrossSources({
    ctx,
    query,
    sources: [{ entityType, fields }],
  })
}

export function applyEntityIdRestriction(
  filters: Record<string, unknown>,
  ids: string[] | null,
): void {
  if (ids === null) return
  const currentIdFilter =
    filters.id && typeof filters.id === 'object' && !Array.isArray(filters.id)
      ? (filters.id as { $eq?: unknown; $in?: unknown })
      : null
  const currentEq = typeof currentIdFilter?.$eq === 'string' ? currentIdFilter.$eq : null

  if (currentEq) {
    filters.id = ids.includes(currentEq) ? { $eq: currentEq } : { $eq: NO_MATCH_ID }
    return
  }

  filters.id = ids.length > 0 ? { $in: ids } : { $eq: NO_MATCH_ID }
}

export function consumeAdvancedFilterState(query: Record<string, unknown>) {
  const state = deserializeAdvancedFilter(query)
  if (!state) return null

  for (const key of Object.keys(query)) {
    if (key.startsWith('filter[')) {
      delete query[key]
    }
  }

  return state
}

export async function findMatchingEntityIdsWithQueryEngine({
  ctx,
  entityId,
  filters,
  customFieldSources,
  joins,
}: {
  ctx: CrudCtx
  entityId: EntityId
  filters: Record<string, unknown>
  customFieldSources?: QueryCustomFieldSource[]
  joins?: QueryJoinEdge[]
}): Promise<string[]> {
  const qe = ctx.container.resolve('queryEngine') as QueryEngine
  const ids = new Set<string>()
  const pageSize = 100
  let page = 1
  let total = 0

  do {
    const result = await qe.query(entityId, {
      fields: ['id'],
      filters,
      page: { page, pageSize },
      sort: [{ field: 'id', dir: SortDir.Asc }],
      tenantId: ctx.auth?.tenantId ?? undefined,
      organizationId: ctx.selectedOrganizationId ?? undefined,
      organizationIds: ctx.organizationIds ?? undefined,
      customFieldSources,
      joins,
    })

    total = result.total ?? 0
    for (const item of result.items ?? []) {
      const id = item && typeof item === 'object' ? (item as Record<string, unknown>).id : null
      if (typeof id === 'string' && id.length > 0) {
        ids.add(id)
      }
    }
    if (!result.items?.length) break
    page += 1
  } while (ids.size < total)

  return Array.from(ids)
}

export { withScopedPayload, parseScopedCommandInput }
