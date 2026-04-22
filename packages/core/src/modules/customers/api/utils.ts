import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
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
  const db = em.getKysely<any>() as any
  let defsQuery = db
    .selectFrom('custom_field_defs')
    .select(['entity_id', 'key', 'kind'])
    .where('entity_id', 'in', entityTypes)
    .where('is_active', '=', true)

  const tenantScope = ctx.auth?.tenantId ?? null
  defsQuery = defsQuery.where((eb: any) => eb.or([
    eb('tenant_id', '=', tenantScope),
    eb('tenant_id', 'is', null),
  ]))

  if (ctx.selectedOrganizationId) {
    defsQuery = defsQuery.where((eb: any) => eb.or([
      eb('organization_id', '=', ctx.selectedOrganizationId),
      eb('organization_id', 'is', null),
    ]))
  } else if (Array.isArray(ctx.organizationIds) && ctx.organizationIds.length > 0) {
    defsQuery = defsQuery.where((eb: any) => eb.or([
      eb('organization_id', 'in', ctx.organizationIds),
      eb('organization_id', 'is', null),
    ]))
  }

  const customFieldKeysByEntity = new Map<string, Set<string>>()
  const rows = await defsQuery.execute()
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
  const db = em.getKysely<any>() as any
  let searchQuery = db
    .selectFrom('search_tokens')
    .select('entity_id')
    .where('entity_type', '=', entityType)
    .where('field', 'in', fields)
    .where('token_hash', 'in', tokens.hashes)
    .groupBy('entity_id')
    .having(sql<boolean>`count(distinct token_hash) >= ${tokens.hashes.length}`)

  if (ctx.auth?.tenantId !== undefined) {
    searchQuery = searchQuery.where(sql<boolean>`tenant_id is not distinct from ${ctx.auth?.tenantId ?? null}`)
  }
  if (ctx.selectedOrganizationId) {
    searchQuery = searchQuery.where('organization_id', '=', ctx.selectedOrganizationId)
  } else if (Array.isArray(ctx.organizationIds) && ctx.organizationIds.length > 0) {
    searchQuery = searchQuery.where('organization_id', 'in', ctx.organizationIds)
  }

  const rows = await searchQuery.execute() as Array<{ entity_id?: unknown }>
  return rows
    .map((row) => (typeof row.entity_id === 'string' ? row.entity_id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
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
  const db = em.getKysely<any>() as any
  const sourceColumn = config.sourceColumn ?? 'id'
  const tenantColumn = config.tenantColumn ?? 'tenant_id'
  const organizationColumn = config.organizationColumn ?? 'organization_id'

  let mapQuery = db
    .selectFrom(config.table)
    .select(config.targetColumn)
    .where(sourceColumn, 'in', ids)

  if (ctx.auth?.tenantId !== undefined) {
    mapQuery = mapQuery.where(sql<boolean>`${sql.ref(tenantColumn)} is not distinct from ${ctx.auth?.tenantId ?? null}`)
  }
  if (ctx.selectedOrganizationId) {
    mapQuery = mapQuery.where(organizationColumn, '=', ctx.selectedOrganizationId)
  } else if (Array.isArray(ctx.organizationIds) && ctx.organizationIds.length > 0) {
    mapQuery = mapQuery.where(organizationColumn, 'in', ctx.organizationIds)
  }

  const rows = await mapQuery.execute() as Array<Record<string, unknown>>
  return rows
    .map((row) => {
      const value = row[config.targetColumn]
      return typeof value === 'string' ? value : null
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
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

export function applyEntityIdExclusion(
  filters: Record<string, unknown>,
  ids: string[],
): void {
  const uniqueIds = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)))
  if (!uniqueIds.length) return

  const currentIdFilter =
    filters.id && typeof filters.id === 'object' && !Array.isArray(filters.id)
      ? (filters.id as { $eq?: unknown; $in?: unknown; $nin?: unknown })
      : null
  const currentEq = typeof currentIdFilter?.$eq === 'string' ? currentIdFilter.$eq : null
  const currentIn = Array.isArray(currentIdFilter?.$in)
    ? currentIdFilter.$in.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : null
  const currentNotIn = Array.isArray(currentIdFilter?.$nin)
    ? currentIdFilter.$nin.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : []

  if (currentEq) {
    filters.id = uniqueIds.includes(currentEq) ? { $eq: NO_MATCH_ID } : { $eq: currentEq }
    return
  }

  if (currentIn) {
    const nextIds = currentIn.filter((id) => !uniqueIds.includes(id))
    filters.id = nextIds.length > 0 ? { $in: nextIds } : { $eq: NO_MATCH_ID }
    return
  }

  filters.id = {
    ...(currentIdFilter ?? {}),
    $nin: Array.from(new Set([...currentNotIn, ...uniqueIds])),
  }
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
