import type { QueryEngine, QueryOptions, QueryResult, FilterOp, Filter, QueryCustomFieldSource, PartialIndexWarning } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine, resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import type { Knex } from 'knex'
import type { EventBus } from '@open-mercato/events'
import { readCoverageSnapshot, refreshCoverageSnapshot } from './coverage'
import { createProfiler, shouldEnableProfiler, type Profiler } from '@open-mercato/shared/lib/profiler'
import type { VectorIndexService } from '@open-mercato/search/vector'
import { decryptIndexDocCustomFields } from '@open-mercato/shared/lib/encryption/indexDoc'
import { parseBooleanToken, parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import {
  applyJoinFilters,
  normalizeFilters,
  partitionFilters,
  resolveJoins,
  type BaseFilter,
  type ResolvedJoin,
} from '@open-mercato/shared/lib/query/join-utils'
import { resolveSearchConfig, type SearchConfig } from '@open-mercato/shared/lib/search/config'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'

function resolveBooleanEnv(names: readonly string[], defaultValue: boolean): boolean {
  for (const name of names) {
    const raw = process.env[name]
    if (raw !== undefined) return parseBooleanWithDefault(raw, defaultValue)
  }
  return defaultValue
}

function resolveDebugVerbosity(): boolean {
  // Check explicit OM_QUERY_INDEX_DEBUG flag first
  const queryIndexDebug = process.env.OM_QUERY_INDEX_DEBUG
  if (queryIndexDebug !== undefined) {
    return parseBooleanToken(queryIndexDebug) ?? false
  }
  // Fall back to log level or NODE_ENV
  const level = (process.env.LOG_VERBOSITY ?? process.env.LOG_LEVEL ?? '').toLowerCase()
  if (['debug', 'trace', 'silly'].includes(level)) return true
  // Default to false (don't spam logs in development)
  return false
}

type ResultRow = Record<string, unknown>
type ResultBuilder<TResult = ResultRow[]> = Knex.QueryBuilder<ResultRow, TResult>
type NormalizedFilter = { field: string; op: FilterOp; value?: unknown }
type IndexDocSource = { alias: string; entityId: EntityId; recordIdColumn: string }
type PreparedCustomFieldSource = {
  alias: string
  indexAlias: string
  entityId: EntityId
  recordIdColumn: string
  organizationField?: string
  tenantField?: string
  table: string
}
type SearchRuntime = {
  enabled: boolean
  config: SearchConfig
  organizationScope?: { ids: string[]; includeNull: boolean } | null
  tenantId?: string | null
  searchSources?: SearchTokenSource[]
}

type EncryptionResolver = () => {
  decryptEntityPayload?: (entityId: EntityId, payload: Record<string, unknown>, tenantId?: string | null, organizationId?: string | null) => Promise<Record<string, unknown>>
  isEnabled?: () => boolean
} | null

type SearchTokenSource = { entity: string; recordIdColumn: string }

function createQueryProfiler(entity: string): Profiler {
  const enabled = shouldEnableProfiler(entity)
  return createProfiler({
    scope: 'query_engine',
    target: entity,
    label: `query_engine:${entity}`,
    loggerLabel: '[qe:profile]',
    enabled,
  })
}

export class HybridQueryEngine implements QueryEngine {
  private coverageStatsTtlMs: number
  private customFieldKeysCache = new Map<string, { expiresAt: number; value: string[] }>()
  private customFieldKeysTtlMs: number
  private columnCache = new Map<string, boolean>()
  private debugVerbosity: boolean | null = null
  private sqlDebugEnabled: boolean | null = null
  private forcePartialIndexEnabled: boolean | null = null
  private autoReindexEnabled: boolean | null = null
  private coverageOptimizationEnabled: boolean | null = null
  private pendingCoverageRefreshKeys = new Set<string>()
  private searchAliasSeq = 0

  constructor(
    private em: EntityManager,
    private fallback: BasicQueryEngine,
    private eventBusResolver?: () => Pick<EventBus, 'emitEvent'> | null | undefined,
    private vectorServiceResolver?: () => VectorIndexService | null | undefined,
    private encryptionResolver?: EncryptionResolver,
  ) {
    const coverageTtl = Number.parseInt(process.env.QUERY_INDEX_COVERAGE_CACHE_MS ?? '', 10)
    this.coverageStatsTtlMs = Number.isFinite(coverageTtl) && coverageTtl >= 0 ? coverageTtl : 5 * 60 * 1000
    const cfTtl = Number.parseInt(process.env.QUERY_INDEX_CF_KEYS_CACHE_MS ?? '', 10)
    this.customFieldKeysTtlMs = Number.isFinite(cfTtl) && cfTtl >= 0 ? cfTtl : 5 * 60 * 1000
  }

  private getEncryptionService() {
    try {
      return this.encryptionResolver?.() ?? null
    } catch {
      return null
    }
  }

  async query<T = unknown>(entity: EntityId, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    const providedProfiler = opts.profiler
    const profiler = providedProfiler && providedProfiler.enabled
      ? providedProfiler
      : createQueryProfiler(String(entity))
    profiler.mark('query:init')
    let profileClosed = false
    const finishProfile = (meta?: Record<string, unknown>) => {
      if (!profiler.enabled || profileClosed) return
      profileClosed = true
      profiler.end(meta)
    }

    try {
      const debugEnabled = this.isDebugVerbosity()
      if (debugEnabled) this.debug('query:start', { entity })
      this.searchAliasSeq = 0

      const isCustom = await this.isCustomEntity(entity)
      if (isCustom) {
        if (debugEnabled) this.debug('query:custom-entity', { entity })
        const section = profiler.section('custom_entity')
        try {
          const result = await this.queryCustomEntity<T>(entity, opts)
          section.end({ mode: 'custom_entity' })
          finishProfile({
            result: 'custom_entity',
            total: Array.isArray(result.items) ? result.items.length : undefined,
          })
          return result
        } catch (err) {
          section.end({ error: err instanceof Error ? err.message : String(err) })
          throw err
        }
      }

      const knex = this.getKnex()
      profiler.mark('query:knex_ready')
      const baseTable = resolveEntityTableName(this.em, entity)
      profiler.mark('query:base_table_resolved')
      const searchConfig = resolveSearchConfig()
      const orgScope = this.resolveOrganizationScope(opts)
      const searchEnabled = searchConfig.enabled && await this.tableExists('search_tokens')

      const baseExists = await profiler.measure('base_table_exists', () => this.tableExists(baseTable))
      if (!baseExists) {
        if (debugEnabled) this.debug('query:fallback:missing-base', { entity, baseTable })
        const fallbackResult = await this.fallback.query(entity, opts)
        finishProfile({ result: 'fallback', reason: 'missing_base' })
        return fallbackResult
      }

      const normalizedFilters = normalizeFilters(opts.filters)
      const cfFilters = normalizedFilters.filter((filter) => filter.field.startsWith('cf:'))
      const coverageScope = this.resolveCoverageSnapshotScope(opts)
      const wantsCf = (
        (opts.fields || []).some((field) => typeof field === 'string' && field.startsWith('cf:')) ||
        cfFilters.length > 0 ||
        opts.includeCustomFields === true ||
        (Array.isArray(opts.includeCustomFields) && opts.includeCustomFields.length > 0)
      )

      if (debugEnabled) {
        this.debug('query:config', {
          entity,
          wantsCustomFields: wantsCf,
          customFieldSources: Array.isArray(opts.customFieldSources) ? opts.customFieldSources.map((src) => src?.entityId) : undefined,
          fields: opts.fields,
        })
      }

      let partialIndexWarning: PartialIndexWarning | null = null
      let entityHasActiveCustomFields = true

      if (wantsCf) {
        entityHasActiveCustomFields = await this.entityHasActiveCustomFields(entity, opts.tenantId ?? null)
        const hasIndexRows = await profiler.measure(
          'index_any_rows',
          () => this.indexAnyRows(entity),
          (value) => ({ hasIndexRows: value })
        )
        if (!hasIndexRows) {
          if (debugEnabled) this.debug('query:fallback:no-index', { entity })
          const fallbackResult = await this.fallback.query(entity, opts)
          finishProfile({ result: 'fallback', reason: 'no_index_rows' })
          return fallbackResult
        }
        if (entityHasActiveCustomFields) {
          const gap = await profiler.measure(
            'resolve_coverage_gap',
            () => this.resolveCoverageGap(entity, opts, coverageScope),
            (value) => (value
              ? {
                  scope: value.scope,
                  baseCount: value.stats?.baseCount ?? null,
                  indexedCount: value.stats?.indexedCount ?? null,
                }
              : { scope: null })
          )
          if (gap) {
            this.scheduleAutoReindex(entity, opts, gap.stats, coverageScope?.organizationId ?? null)
            const force = this.isForcePartialIndexEnabled()
            if (!force) {
              if (gap.stats) {
                console.warn('[HybridQueryEngine] Partial index coverage detected; falling back to basic engine:', { entity, baseCount: gap.stats.baseCount, indexedCount: gap.stats.indexedCount, scope: gap.scope })
                if (debugEnabled) this.debug('query:fallback:partial-coverage', { entity, baseCount: gap.stats.baseCount, indexedCount: gap.stats.indexedCount, scope: gap.scope })
              } else {
                console.warn('[HybridQueryEngine] Partial index coverage detected; falling back to basic engine:', { entity })
                if (debugEnabled) this.debug('query:fallback:partial-coverage', { entity })
              }
              const fallbackResult = await this.fallback.query(entity, opts)
              const resultWithWarning: QueryResult<T> = {
                ...fallbackResult,
                meta: {
                  ...(fallbackResult.meta ?? {}),
                  partialIndexWarning: {
                    entity,
                    entityLabel: this.resolveEntityLabel(entity),
                    baseCount: gap.stats?.baseCount ?? null,
                    indexedCount: gap.stats?.indexedCount ?? null,
                    scope: gap.stats ? gap.scope : undefined,
                  },
                },
              }
              finishProfile({
                result: 'fallback',
                reason: 'partial_index',
                scope: gap.scope,
                baseCount: gap.stats?.baseCount ?? null,
                indexedCount: gap.stats?.indexedCount ?? null,
              })
              return resultWithWarning
            }
            if (gap.stats) {
              console.warn('[HybridQueryEngine] Partial index coverage detected; forcing query index usage due to FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES:', { entity, baseCount: gap.stats.baseCount, indexedCount: gap.stats.indexedCount, scope: gap.scope })
              if (debugEnabled) this.debug('query:partial-coverage:forced', { entity, baseCount: gap.stats.baseCount, indexedCount: gap.stats.indexedCount, scope: gap.scope })
            } else {
              console.warn('[HybridQueryEngine] Partial index coverage detected; forcing query index usage due to FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES:', { entity })
              if (debugEnabled) this.debug('query:partial-coverage:forced', { entity })
            }
            partialIndexWarning = {
              entity,
              entityLabel: this.resolveEntityLabel(entity),
              baseCount: gap.stats?.baseCount ?? null,
              indexedCount: gap.stats?.indexedCount ?? null,
              scope: gap.stats ? gap.scope : undefined,
            }
          }
        } else if (debugEnabled) {
          this.debug('query:coverage:skip-no-custom-fields', { entity })
        }
      }

      const qualify = (col: string) => `b.${col}`
    let builder: ResultBuilder = knex({ b: baseTable })
    const hasCustomFieldFilters = cfFilters.length > 0
    const canOptimizeCount = !hasCustomFieldFilters
    let optimizedCountBuilder: ResultBuilder | null = canOptimizeCount ? knex({ b: baseTable }) : null

    const resolvedJoinsConfig = resolveJoins(baseTable, opts.joins, (entityId) => resolveEntityTableName(this.em, entityId as any))
    const joinMap = new Map<string, ResolvedJoin>()
    const aliasTables = new Map<string, string>()
    aliasTables.set('b', baseTable)
    aliasTables.set('base', baseTable)
    aliasTables.set(baseTable, baseTable)
    for (const join of resolvedJoinsConfig) {
      joinMap.set(join.alias, join)
      aliasTables.set(join.alias, join.table)
    }
    const { baseFilters, joinFilters } = partitionFilters(baseTable, normalizedFilters, joinMap)

    if (!opts.tenantId) throw new Error('QueryEngine: tenantId is required')

    const hasOrganizationColumn = await this.columnExists(baseTable, 'organization_id')
    const hasTenantColumn = await this.columnExists(baseTable, 'tenant_id')
    const hasDeletedColumn = await this.columnExists(baseTable, 'deleted_at')
    const searchRuntimeBase = {
      enabled: false,
      config: searchConfig,
      organizationScope: orgScope,
      tenantId: opts.tenantId ?? null,
    }

    if (orgScope && hasOrganizationColumn) {
      builder = this.applyOrganizationScope(builder, qualify('organization_id'), orgScope)
      if (optimizedCountBuilder) optimizedCountBuilder = this.applyOrganizationScope(optimizedCountBuilder, qualify('organization_id'), orgScope)
    }
    if (hasTenantColumn) {
      builder = builder.where(qualify('tenant_id'), opts.tenantId)
      if (optimizedCountBuilder) optimizedCountBuilder = optimizedCountBuilder.where(qualify('tenant_id'), opts.tenantId)
    }
    if (!opts.withDeleted && hasDeletedColumn) {
      builder = builder.whereNull(qualify('deleted_at'))
      if (optimizedCountBuilder) optimizedCountBuilder = optimizedCountBuilder.whereNull(qualify('deleted_at'))
    }

    const baseJoinParts: string[] = []
    baseJoinParts.push(`ei.entity_type = ${knex.raw('?', [entity]).toString()}`)
    baseJoinParts.push(`ei.entity_id = (${qualify('id')}::text)`)
    if (hasOrganizationColumn) {
      baseJoinParts.push(`ei.organization_id = ${qualify('organization_id')}`)
      baseJoinParts.push('ei.organization_id is not null')
    }
    if (hasTenantColumn) {
      baseJoinParts.push(`ei.tenant_id = ${qualify('tenant_id')}`)
      baseJoinParts.push('ei.tenant_id is not null')
    }
    if (!opts.withDeleted) baseJoinParts.push(`ei.deleted_at is null`)
    builder = builder.leftJoin({ ei: 'entity_indexes' }, knex.raw(baseJoinParts.join(' AND ')))

    const columns = await this.getBaseColumnsForEntity(entity)
    const indexSources: IndexDocSource[] = [{ alias: 'ei', entityId: entity, recordIdColumn: 'b.id' }]

    const shouldAttachCustomSources = Array.isArray(opts.customFieldSources) && opts.customFieldSources.length > 0 && (wantsCf || searchEnabled)
    if (shouldAttachCustomSources) {
      const prepared = this.prepareCustomFieldSources(knex, builder, opts.customFieldSources ?? [], qualify)
      builder = prepared.builder
      for (const source of prepared.sources) {
        const fragments: string[] = []
        fragments.push(`${source.indexAlias}.entity_type = ${knex.raw('?', [source.entityId]).toString()}`)
        fragments.push(`${source.indexAlias}.entity_id = (${knex.raw('??::text', [`${source.alias}.${source.recordIdColumn}`]).toString()})`)
        const orgExpr = source.organizationField
          ? knex.raw('??', [`${source.alias}.${source.organizationField}`]).toString()
          : (columns.has('organization_id') ? qualify('organization_id') : null)
        if (orgExpr) {
          fragments.push(`${source.indexAlias}.organization_id = ${orgExpr}`)
          fragments.push(`${source.indexAlias}.organization_id is not null`)
        }
        const tenantExpr = source.tenantField
          ? knex.raw('??', [`${source.alias}.${source.tenantField}`]).toString()
          : (columns.has('tenant_id') ? qualify('tenant_id') : null)
        if (tenantExpr) {
          fragments.push(`${source.indexAlias}.tenant_id = ${tenantExpr}`)
          fragments.push(`${source.indexAlias}.tenant_id is not null`)
        }
        if (!opts.withDeleted) fragments.push(`${source.indexAlias}.deleted_at is null`)
        builder = builder.leftJoin({ [source.indexAlias]: 'entity_indexes' }, knex.raw(fragments.join(' AND ')))
        indexSources.push({ alias: source.indexAlias, entityId: source.entityId, recordIdColumn: `${source.alias}.${source.recordIdColumn}` })
      }
    }

    if (debugEnabled) {
      this.debug('query:index-sources', {
        entity,
        sources: indexSources.map((src) => ({ alias: src.alias, entity: src.entityId })),
      })
    }

    const searchSources: SearchTokenSource[] = indexSources
      .map((src) => ({
        entity: String(src.entityId),
        recordIdColumn: src.recordIdColumn,
      }))
      .filter((src) => src.recordIdColumn && src.entity)
    const hasSearchTokens = searchEnabled && searchSources.length
      ? await this.searchSourcesHaveTokens(searchSources, opts.tenantId ?? null, orgScope)
      : false
    const searchRuntime: SearchRuntime = { ...searchRuntimeBase, searchSources, enabled: searchEnabled && hasSearchTokens }
    const searchFilters = normalizeFilters(opts.filters).filter((filter) => filter.op === 'like' || filter.op === 'ilike')
    if (searchFilters.length) {
      this.logSearchDebug('search:init', {
        entity,
        baseTable,
        tenantId: opts.tenantId ?? null,
        organizationScope: orgScope,
        fields: searchFilters.map((filter) => String(filter.field)),
        searchEnabled,
        hasSearchTokens,
        searchSources,
        searchConfig: {
          enabled: searchConfig.enabled,
          minTokenLength: searchConfig.minTokenLength,
          enablePartials: searchConfig.enablePartials,
          hashAlgorithm: searchConfig.hashAlgorithm,
          blocklistedFields: searchConfig.blocklistedFields,
        },
      })
      if (!searchEnabled) {
        this.logSearchDebug('search:disabled', { entity, baseTable })
      } else if (!hasSearchTokens) {
        this.logSearchDebug('search:no-search-tokens', {
          entity,
          baseTable,
          tenantId: opts.tenantId ?? null,
          organizationScope: orgScope,
          searchSources,
        })
      }
    }
    const hasNonBaseSearchSource = searchSources.some(
      (src) => src.entity !== String(entity) || src.recordIdColumn !== 'b.id'
    )
    if (hasNonBaseSearchSource) {
      optimizedCountBuilder = null
    }

    if (!partialIndexWarning && Array.isArray(opts.customFieldSources) && opts.customFieldSources.length > 0 && this.isForcePartialIndexEnabled()) {
      const seen = new Set<string>([entity])
      for (const source of opts.customFieldSources) {
        const targetEntity = source?.entityId ? String(source.entityId) : null
        if (!targetEntity || seen.has(targetEntity)) continue
        seen.add(targetEntity)
        const sourceHasCustomFields = await this.entityHasActiveCustomFields(targetEntity, opts.tenantId ?? null)
        if (!sourceHasCustomFields) {
          if (debugEnabled) this.debug('query:coverage:skip-no-custom-fields', { entity: targetEntity })
          continue
        }
        const sourceTable = source.table ?? resolveEntityTableName(this.em, targetEntity)
        try {
          const gap = await profiler.measure(
            'resolve_coverage_gap',
            () => this.resolveCoverageGap(targetEntity, opts, coverageScope, sourceTable),
            (value) => (value
              ? {
                  entity: targetEntity,
                  scope: value.scope,
                  baseCount: value.stats?.baseCount ?? null,
                  indexedCount: value.stats?.indexedCount ?? null,
                }
              : { entity: targetEntity, scope: null })
          )
          if (!gap) continue
          this.scheduleAutoReindex(targetEntity, opts, gap.stats, coverageScope?.organizationId ?? null)
          partialIndexWarning = {
            entity: targetEntity,
            entityLabel: this.resolveEntityLabel(targetEntity),
            baseCount: gap.stats?.baseCount ?? null,
            indexedCount: gap.stats?.indexedCount ?? null,
            scope: gap.stats ? gap.scope : undefined,
          }
          if (debugEnabled) {
            if (gap.stats) this.debug('query:partial-coverage:forced', { entity: targetEntity, baseCount: gap.stats.baseCount, indexedCount: gap.stats.indexedCount, scope: gap.scope })
            else this.debug('query:partial-coverage:forced', { entity: targetEntity })
          }
          break
        } catch (err) {
          if (debugEnabled) this.debug('query:partial-coverage:check-failed', { entity: targetEntity, error: err instanceof Error ? err.message : err })
        }
      }
    }

    if (
      !partialIndexWarning &&
      wantsCf &&
      entityHasActiveCustomFields &&
      this.isForcePartialIndexEnabled() &&
      opts.tenantId
    ) {
      try {
        await this.indexCoverageStats(entity, opts, coverageScope)
        const globalStats = await this.indexCoverageStats(entity, opts, coverageScope)
        if (globalStats) {
          const globalBase = globalStats.baseCount
          const globalIndexed = globalStats.indexedCount
          const globalGap = (globalBase > 0 && globalIndexed < globalBase) || globalIndexed > globalBase
          if (globalGap) {
            console.warn('[HybridQueryEngine] Partial index coverage detected at global scope; forcing query index usage due to FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES:', { entity, baseCount: globalBase, indexedCount: globalIndexed, scope: 'global' })
            if (debugEnabled) {
              this.debug('query:partial-coverage:forced', {
                entity,
                baseCount: globalBase,
                indexedCount: globalIndexed,
                scope: 'global',
              })
            }
            partialIndexWarning = {
              entity,
              entityLabel: this.resolveEntityLabel(entity),
              baseCount: globalBase,
              indexedCount: globalIndexed,
              scope: 'global',
            }
          }
        }
      } catch (err) {
        if (debugEnabled) {
          this.debug('query:partial-coverage:global-check-failed', {
            entity,
            error: err instanceof Error ? err.message : err,
          })
        }
      }
    }

    const resolveBaseColumn = (field: string): string | null => {
      if (columns.has(field)) return field
      if (field === 'organization_id' && columns.has('id')) return 'id'
      return null
    }

    for (const filter of cfFilters) {
      builder = this.applyCfFilterAcrossSources(
        knex,
        builder,
        filter.field,
        filter.op,
        filter.value,
        indexSources,
        searchRuntime
      )
    }

    for (const filter of baseFilters) {
      const baseField = resolveBaseColumn(String(filter.field))
      if (!baseField) continue
      const column = qualify(baseField)
      builder = this.applyColumnFilter(builder, column, filter, {
        ...searchRuntime,
        knex,
        entity,
        field: String(filter.field),
        recordIdColumn: 'b.id',
      })
      if (optimizedCountBuilder) {
        optimizedCountBuilder = this.applyColumnFilter(optimizedCountBuilder, column, filter, {
          ...searchRuntime,
          knex,
          entity,
          field: String(filter.field),
          recordIdColumn: 'b.id',
        })
      }
    }

    const applyAliasScopes = async (target: ResultBuilder, aliasName: string) => {
      const tableName = aliasTables.get(aliasName)
      if (!tableName) return
      if (orgScope && await this.columnExists(tableName, 'organization_id')) {
        this.applyOrganizationScope(target, `${aliasName}.organization_id`, orgScope)
      }
      if (opts.tenantId && await this.columnExists(tableName, 'tenant_id')) {
        target.where(`${aliasName}.tenant_id`, opts.tenantId)
      }
      if (!opts.withDeleted && await this.columnExists(tableName, 'deleted_at')) {
        target.whereNull(`${aliasName}.deleted_at`)
      }
    }

    const applyJoinFilterOp = (target: ResultBuilder, column: string, op: FilterOp, value?: unknown) => {
      switch (op) {
        case 'eq':
          target.where(column, value as Knex.Value)
          break
        case 'ne':
          target.whereNot(column, value as Knex.Value)
          break
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
          const operator = op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : '<='
          target.where(column, operator, value as Knex.Value)
          break
        }
        case 'in':
          target.whereIn(column, this.toArray(value) as readonly Knex.Value[])
          break
        case 'nin':
          target.whereNotIn(column, this.toArray(value) as readonly Knex.Value[])
          break
        case 'like':
          target.where(column, 'like', value as Knex.Value)
          break
        case 'ilike':
          target.where(column, 'ilike', value as Knex.Value)
          break
        case 'exists':
          value ? target.whereNotNull(column) : target.whereNull(column)
          break
      }
    }

    await applyJoinFilters({
      knex,
      baseTable,
      builder,
      joinMap,
      joinFilters,
      aliasTables,
      qualifyBase: (column) => qualify(column),
      applyAliasScope: (target, alias) => applyAliasScopes(target, alias),
      applyFilterOp: (target, column, op, value) => applyJoinFilterOp(target as ResultBuilder, column, op, value),
      columnExists: (tbl, column) => this.columnExists(tbl, column),
    }) as ResultBuilder

    if (optimizedCountBuilder) {
      await applyJoinFilters({
        knex,
        baseTable,
        builder: optimizedCountBuilder,
        joinMap,
        joinFilters,
        aliasTables,
        qualifyBase: (column) => qualify(column),
        applyAliasScope: (target, alias) => applyAliasScopes(target, alias),
        applyFilterOp: (target, column, op, value) => applyJoinFilterOp(target as ResultBuilder, column, op, value),
        columnExists: (tbl, column) => this.columnExists(tbl, column),
      })
    }

    // When no fields specified, select all base table columns (like BasicQueryEngine does)
    const selectFieldSet = new Set<string>((opts.fields && opts.fields.length) ? opts.fields.map(String) : Array.from(columns.keys()))
    if (opts.includeCustomFields === true) {
      const entityIds = Array.from(new Set(indexSources.map((src) => String(src.entityId))))
      try {
        const resolvedKeys = await this.resolveAvailableCustomFieldKeys(entityIds, opts.tenantId ?? null)
        resolvedKeys.forEach((key) => selectFieldSet.add(`cf:${key}`))
        if (this.isDebugVerbosity()) {
          this.debug('query:cf:resolved-keys', { entity, keys: resolvedKeys })
        }
      } catch (err) {
        console.warn('[HybridQueryEngine] Failed to resolve custom field keys for', entity, err)
      }
    } else if (Array.isArray(opts.includeCustomFields)) {
      opts.includeCustomFields
        .map((key) => String(key))
        .forEach((key) => selectFieldSet.add(`cf:${key}`))
    }
    const selectFields = Array.from(selectFieldSet)
    for (const field of selectFields) {
      const fieldName = String(field)
      if (fieldName.startsWith('cf:')) {
        const alias = this.sanitize(fieldName)
        const { jsonSql } = this.buildCfExpressions(knex, fieldName, indexSources)
        const exprSql = jsonSql === 'NULL' ? 'NULL::jsonb' : jsonSql
        builder = builder.select(knex.raw(`${exprSql} as ??`, [alias]))
      } else if (columns.has(fieldName)) {
        builder = builder.select(knex.raw('?? as ??', [qualify(fieldName), fieldName]))
      }
    }

    for (const sort of opts.sort || []) {
      const fieldName = String(sort.field)
      if (fieldName.startsWith('cf:')) {
        const { textSql } = this.buildCfExpressions(knex, fieldName, indexSources)
        if (textSql !== 'NULL') {
          const direction = sort.dir ?? SortDir.Asc
          builder = builder.orderByRaw(`${textSql} ${direction}`)
        }
      } else {
        const baseField = resolveBaseColumn(fieldName)
        if (!baseField) continue
        builder = builder.orderBy(qualify(baseField), sort.dir ?? SortDir.Asc)
      }
    }

    const page = opts.page?.page ?? 1
    const pageSize = opts.page?.pageSize ?? 20

    const sqlDebugEnabled = this.isSqlDebugEnabled()
    let total: number

    if (optimizedCountBuilder) {
      const countSource = optimizedCountBuilder.clone().clearSelect().clearOrder().select(knex.raw(`${qualify('id')} as id`)).groupBy(qualify('id'))
      const countQuery = knex.from(countSource.as('sq')).count({ count: knex.raw('*') })
      if (debugEnabled && sqlDebugEnabled) {
        const { sql, bindings } = countQuery.clone().toSQL()
        this.debug('query:sql:count', { entity, sql, bindings })
      }
      const countRow = await this.captureSqlTiming(
        'query:sql:count',
        entity,
        () => countQuery.first(),
        { optimized: true },
        profiler
      )
      total = this.parseCount(countRow)
    } else {
      const countBuilder = builder.clone().clearSelect().clearOrder().countDistinct(`${qualify('id')} as count`)
      if (debugEnabled && sqlDebugEnabled) {
        const { sql, bindings } = countBuilder.clone().toSQL()
        this.debug('query:sql:count', { entity, sql, bindings })
      }
      const countRow = await this.captureSqlTiming(
        'query:sql:count',
        entity,
        () => countBuilder.first(),
        { optimized: false },
        profiler
      )
      total = this.parseCount(countRow)
    }

    const dataBuilder = builder.clone().limit(pageSize).offset((page - 1) * pageSize)

    if (debugEnabled && sqlDebugEnabled) {
      const { sql, bindings } = dataBuilder.clone().toSQL()
      this.debug('query:sql:data', { entity, sql, bindings, page, pageSize })
    }
    const itemsRaw = await this.captureSqlTiming(
      'query:sql:data',
      entity,
      () => dataBuilder,
      { page, pageSize },
      profiler
    )
    if (debugEnabled) this.debug('query:complete', { entity, total, items: Array.isArray(itemsRaw) ? itemsRaw.length : 0 })

    let items = itemsRaw as any[]
    const encSvc = this.getEncryptionService()
    const dekKeyCache = new Map<string | null, string | null>()
    if (encSvc?.decryptEntityPayload) {
      const decrypt = encSvc.decryptEntityPayload.bind(encSvc) as (
        entityId: EntityId,
        payload: Record<string, unknown>,
        tenantId: string | null,
        organizationId: string | null,
      ) => Promise<Record<string, unknown>>
      items = await Promise.all(
        items.map(async (item) => {
          try {
            const decrypted = await decrypt(
              entity,
              item,
              item?.tenant_id ?? item?.tenantId ?? opts.tenantId ?? null,
              item?.organization_id ?? item?.organizationId ?? null,
            )
            return { ...item, ...decrypted }
          } catch (err) {
            console.error('Error decrypting entity payload', err);
            return item
          }
        })
      )
    }
    if (encSvc) {
      items = await Promise.all(
        items.map(async (item) => {
          try {
            return await decryptIndexDocCustomFields(
              item,
              {
                tenantId: item?.tenant_id ?? item?.tenantId ?? opts.tenantId ?? null,
                organizationId: item?.organization_id ?? item?.organizationId ?? null,
              },
              encSvc as any,
              dekKeyCache,
            )
          } catch {
            return item
          }
        }),
      )
    }

    const typedItems = items as unknown as T[]
    const result: QueryResult<T> = { items: typedItems, page, pageSize, total }
    if (partialIndexWarning) {
      result.meta = { partialIndexWarning }
    }
    finishProfile({
      result: 'ok',
      total,
      page,
      pageSize,
      itemCount: Array.isArray(items) ? items.length : undefined,
      partialIndexWarning: partialIndexWarning ? true : false,
    })
    return result
  } catch (err) {
    finishProfile({ result: 'error', error: err instanceof Error ? err.message : String(err) })
    throw err
  }
  }

  private getKnex(): Knex {
    const connection = this.em.getConnection()
    const withKnex = connection as { getKnex?: () => Knex }
    if (typeof withKnex.getKnex === 'function') {
      return withKnex.getKnex()
    }
    throw new Error('HybridQueryEngine requires a SQL connection that exposes getKnex()')
  }

  private prepareCustomFieldSources(
    knex: Knex,
    builder: ResultBuilder,
    sources: QueryCustomFieldSource[],
    qualify: (column: string) => string
  ): { builder: ResultBuilder; sources: PreparedCustomFieldSource[] } {
    let current = builder
    const prepared: PreparedCustomFieldSource[] = []
    sources.forEach((source, index) => {
      if (!source) return
      const joinTable = source.table ?? resolveEntityTableName(this.em, source.entityId)
      const alias = source.alias ?? `cfs_${index}`
      const join = source.join
      if (!join) {
        throw new Error(`QueryEngine: customFieldSources entry for ${String(source.entityId)} requires a join configuration`)
      }
      const joinArgs = { [alias]: joinTable }
      const joinCallback = function (this: Knex.JoinClause) {
        this.on(`${alias}.${join.toField}`, '=', qualify(join.fromField))
      }
      current = (join.type ?? 'left') === 'inner'
        ? current.join(joinArgs, joinCallback)
        : current.leftJoin(joinArgs, joinCallback)
      prepared.push({
        alias,
        indexAlias: `ei_${alias}`,
        entityId: source.entityId,
        recordIdColumn: source.recordIdColumn ?? 'id',
        organizationField: source.organizationField,
        tenantField: source.tenantField,
        table: joinTable,
      })
    })
    return { builder: current, sources: prepared }
  }

  private async isCustomEntity(entity: string): Promise<boolean> {
    try {
      const knex = this.getKnex()
      const row = await knex('custom_entities').where({ entity_id: entity, is_active: true }).first()
      return !!row
    } catch {
      return false
    }
  }

  private applySearchTokens<TRecord extends ResultRow, TResult>(
    q: Knex.QueryBuilder<TRecord, TResult>,
    opts: {
      knex: Knex
      entity: string
      field: string
      hashes: string[]
      recordIdColumn: string
      tenantId?: string | null
      organizationScope?: { ids: string[]; includeNull: boolean } | null
      combineWith?: 'and' | 'or'
    }
  ): boolean {
    if (!opts.hashes.length) {
      this.logSearchDebug('search:skip-no-hashes', {
        entity: opts.entity,
        field: opts.field,
        tenantId: opts.tenantId ?? null,
        organizationScope: opts.organizationScope,
      })
      return false
    }
    const alias = `st_${this.searchAliasSeq++}`
    const combineWith = opts.combineWith === 'or' ? 'orWhereExists' : 'whereExists'
    const engine = this
    this.logSearchDebug('search:apply-search-tokens', {
      entity: opts.entity,
      field: opts.field,
      alias,
      tokenCount: opts.hashes.length,
      tenantId: opts.tenantId ?? null,
      organizationScope: opts.organizationScope,
      combineWith: opts.combineWith ?? 'and',
    })
    ;(q as any)[combineWith](function (this: Knex.QueryBuilder) {
      this.select(1)
        .from({ [alias]: 'search_tokens' })
        .where(`${alias}.entity_type`, opts.entity)
        .andWhere(`${alias}.field`, opts.field)
        .andWhereRaw('?? = ??::text', [`${alias}.entity_id`, opts.recordIdColumn])
        .whereIn(`${alias}.token_hash`, opts.hashes)
        .groupBy(`${alias}.entity_id`, `${alias}.field`)
        .havingRaw(`count(distinct ${alias}.token_hash) >= ?`, [opts.hashes.length])
      if (opts.tenantId !== undefined) {
        this.andWhereRaw(`${alias}.tenant_id is not distinct from ?`, [opts.tenantId ?? null])
      }
      if (opts.organizationScope) {
        engine.applyOrganizationScope(this as any, `${alias}.organization_id`, opts.organizationScope)
      }
    })
    return true
  }

  private jsonbRawAlias(knex: Knex, alias: string, key: string): Knex.Raw {
    // Prefer cf:<key> but fall back to bare <key> for legacy docs
    if (key.startsWith('cf:')) {
      const bare = key.slice(3)
      return knex.raw(`coalesce(${alias}.doc -> ?, ${alias}.doc -> ?)`, [key, bare])
    }
    return knex.raw(`${alias}.doc -> ?`, [key])
  }
  private cfTextExprAlias(knex: Knex, alias: string, key: string): Knex.Raw {
    if (key.startsWith('cf:')) {
      const bare = key.slice(3)
      return knex.raw(`coalesce((${alias}.doc ->> ?), (${alias}.doc ->> ?))`, [key, bare])
    }
    return knex.raw(`(${alias}.doc ->> ?)`, [key])
  }
  private buildCfExpressions(knex: Knex, key: string, sources: IndexDocSource[]): { jsonSql: string; textSql: string } {
    if (!sources.length) return { jsonSql: 'NULL', textSql: 'NULL' }
    const jsonFragments = sources.map((source) => this.jsonbRawAlias(knex, source.alias, key).toString())
    const textFragments = sources.map((source) => this.cfTextExprAlias(knex, source.alias, key).toString())
    const jsonSql = jsonFragments.length === 1 ? jsonFragments[0] : `coalesce(${jsonFragments.join(', ')})`
    const textSql = textFragments.length === 1 ? textFragments[0] : `coalesce(${textFragments.join(', ')})`
    return { jsonSql, textSql }
  }

  private applyCfFilterAcrossSources(
    knex: Knex,
    builder: ResultBuilder,
    key: string,
    op: FilterOp,
    value: unknown,
    sources: IndexDocSource[],
    search?: SearchRuntime
  ): ResultBuilder {
    if (!sources.length) return builder
    if ((op === 'like' || op === 'ilike') && search?.enabled && typeof value === 'string') {
      const tokens = tokenizeText(String(value), search.config)
      const hashes = tokens.hashes
      if (hashes.length) {
        let applied = false
        if (sources.length) {
          builder = builder.where((qb) => {
            sources.forEach((source, idx) => {
              const ok = this.applySearchTokens(qb as any, {
                knex,
                entity: source.entityId,
                field: key,
                hashes,
                recordIdColumn: `${source.alias}.entity_id`,
                tenantId: search.tenantId ?? null,
                organizationScope: search.organizationScope ?? null,
                combineWith: idx === 0 ? 'and' : 'or',
              })
              if (ok) applied = true
            })
          })
        }
        this.logSearchDebug('search:cf-filter-across', {
          entity: sources.map((src) => src.entityId),
          field: key,
          tokens: tokens.tokens,
          hashes,
          applied,
          tenantId: search.tenantId ?? null,
          organizationScope: search.organizationScope,
        })
        if (applied) return builder
      } else {
        this.logSearchDebug('search:cf-skip-empty-hashes', {
          entity: sources.map((src) => src.entityId),
          field: key,
          value,
        })
      }
      return builder
    }
    const { jsonSql, textSql } = this.buildCfExpressions(knex, key, sources)
    if (jsonSql === 'NULL' || textSql === 'NULL') return builder
    const textExpr = knex.raw(textSql)
    const arrContains = (val: unknown) => knex.raw(`${jsonSql} @> ?::jsonb`, [JSON.stringify([val])])
    switch (op) {
      case 'eq':
        return builder.where((qb) => {
          qb.orWhere(textExpr, '=', value as Knex.Value)
          qb.orWhere(arrContains(value))
        })
      case 'ne':
        return builder.whereNot(textExpr, '=', value as Knex.Value)
      case 'in': {
        const values = this.toArray(value)
        return builder.where((qb) => {
          values.forEach((val) => {
            qb.orWhere(textExpr, '=', val as Knex.Value)
            qb.orWhere(arrContains(val))
          })
        })
      }
      case 'nin': {
        const values = this.toArray(value) as readonly Knex.Value[]
        return builder.whereNotIn(textExpr as any, values as any)
      }
      case 'like':
        return builder.where(textExpr, 'like', value as Knex.Value)
      case 'ilike':
        return builder.where(textExpr, 'ilike', value as Knex.Value)
      case 'exists':
        return value
          ? builder.whereRaw(`${textExpr.toString()} is not null`)
          : builder.whereRaw(`${textExpr.toString()} is null`)
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const operator = op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : '<='
        return builder.where(textExpr, operator, value as Knex.Value)
      }
      default:
        return builder
    }
  }

  private applyCfFilterFromAlias(
    knex: Knex,
    q: ResultBuilder,
    alias: string,
    entityType: string,
    key: string,
    op: FilterOp,
    value: unknown,
    search?: SearchRuntime
  ): ResultBuilder {
    const text = this.cfTextExprAlias(knex, alias, key)
    const arrExpr = knex.raw(`(${alias}.doc -> ?)`, [key])
    const arrContains = (val: unknown) => knex.raw(`${arrExpr.toString()} @> ?::jsonb`, [JSON.stringify([val])])
    if ((op === 'like' || op === 'ilike') && search?.enabled && typeof value === 'string') {
      const tokens = tokenizeText(String(value), search.config)
      const hashes = tokens.hashes
      if (hashes.length) {
        const applied = this.applySearchTokens(q, {
          knex,
          entity: entityType,
          field: key,
          hashes,
          recordIdColumn: `${alias}.entity_id`,
          tenantId: search.tenantId ?? null,
          organizationScope: search.organizationScope ?? null,
        })
        this.logSearchDebug('search:cf-filter', {
          entity: entityType,
          field: key,
          tokens: tokens.tokens,
          hashes,
          applied,
          tenantId: search.tenantId ?? null,
          organizationScope: search.organizationScope,
        })
        if (applied) return q
      } else {
        this.logSearchDebug('search:cf-skip-empty-hashes', {
          entity: entityType,
          field: key,
          value,
        })
      }
      return q
    }
    switch (op) {
      case 'eq':
        return q.where((builder) => {
          builder.orWhere(text, '=', value as Knex.Value)
          builder.orWhere(arrContains(value))
        })
      case 'ne':
        return q.whereNot(text, '=', value as Knex.Value)
      case 'in': {
        const vals = this.toArray(value)
        return q.where((builder) => {
          vals.forEach((val) => {
            builder.orWhere(text, '=', val as Knex.Value)
            builder.orWhere(arrContains(val))
          })
        })
      }
      case 'nin': {
        const vals = this.toArray(value) as readonly Knex.Value[]
        return q.whereNotIn(text as any, vals as any)
      }
      case 'like':
        return q.where(text, 'like', value as Knex.Value)
      case 'ilike':
        return q.where(text, 'ilike', value as Knex.Value)
      case 'exists':
        return value
          ? q.whereRaw(`${text.toString()} is not null`)
          : q.whereRaw(`${text.toString()} is null`)
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const operator = op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : '<='
        return q.where(text, operator, value as Knex.Value)
      }
      default:
        return q
    }
  }

  private async queryCustomEntity<T = unknown>(entity: string, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    const knex = this.getKnex()
    const alias = 'ce'
    let q = knex({ [alias]: 'custom_entities_storage' }).where(`${alias}.entity_type`, entity)

    const orgScope = this.resolveOrganizationScope(opts)

    // Require tenant scope; custom entities are tenant-scoped only
    if (!opts.tenantId) throw new Error('QueryEngine: tenantId is required')
    q = q.andWhere(`${alias}.tenant_id`, opts.tenantId)
    if (orgScope) {
      q = this.applyOrganizationScope(q, `${alias}.organization_id`, orgScope)
    }
    if (!opts.withDeleted) q = q.whereNull(`${alias}.deleted_at`)
    const searchConfig = resolveSearchConfig()
    const searchEnabled = searchConfig.enabled && await this.tableExists('search_tokens')
    const hasSearchTokens = searchEnabled
      ? await this.hasSearchTokens(entity, opts.tenantId ?? null, orgScope)
      : false
    const searchRuntime: SearchRuntime = {
      enabled: searchEnabled && hasSearchTokens,
      config: searchConfig,
      organizationScope: orgScope,
      tenantId: opts.tenantId ?? null,
    }

    const normalizedFilters = normalizeFilters(opts.filters)

    // Apply filters: cf:* via JSONB; other keys: special-case id/created_at/updated_at/deleted_at, otherwise from doc
    for (const filter of normalizedFilters) {
      if (filter.field.startsWith('cf:')) {
        q = this.applyCfFilterFromAlias(knex, q, alias, entity, filter.field, filter.op, filter.value, searchRuntime)
        continue
      }
      const column = this.resolveCustomEntityColumn(alias, String(filter.field))
      if (column) {
        q = this.applyColumnFilter(q, column, filter, {
          ...searchRuntime,
          knex,
          entity,
          field: String(filter.field),
          recordIdColumn: `${alias}.entity_id`,
        })
        continue
      }
      const docExpr = knex.raw(`(${alias}.doc ->> ?)`, [String(filter.field)])
      q = this.applyColumnFilter(q, docExpr, filter, {
        ...searchRuntime,
        knex,
        entity,
        field: String(filter.field),
        recordIdColumn: `${alias}.entity_id`,
      })
    }

    // Determine CFs to include
    const cfKeys = new Set<string>()
    for (const f of (opts.fields || [])) if (typeof f === 'string' && f.startsWith('cf:')) cfKeys.add(f.slice(3))
    for (const filter of normalizedFilters) if (typeof filter.field === 'string' && filter.field.startsWith('cf:')) cfKeys.add(filter.field.slice(3))
    if (opts.includeCustomFields === true) {
      try {
        const rows = await knex('custom_field_defs')
          .select('key')
          .where({ entity_id: entity, is_active: true })
          .modify((qb) => {
            qb.andWhere({ tenant_id: opts.tenantId })
            // NOTE: organization-level scoping intentionally disabled for custom fields
            // if (opts.organizationId != null) qb.andWhere((b: any) => b.where({ organization_id: opts.organizationId }).orWhereNull('organization_id'))
            // else qb.whereNull('organization_id')
          })
        for (const row of rows) {
          const key = (row as Record<string, unknown>).key
          if (typeof key === 'string') {
            cfKeys.add(key)
          } else if (key != null) {
            cfKeys.add(String(key))
          }
        }
      } catch {
        // ignore and fall back to whatever keys we already have
      }
    } else if (Array.isArray(opts.includeCustomFields)) {
      for (const k of opts.includeCustomFields) cfKeys.add(k)
    }

    // Selection
    const requested = (opts.fields && opts.fields.length) ? opts.fields : ['id']
    for (const field of requested) {
      const f = String(field)
      if (f.startsWith('cf:')) {
        const aliasName = this.sanitize(f)
        const expr = this.jsonbRawAlias(knex, alias, f)
        q = q.select({ [aliasName]: expr })
      } else if (f === 'id') {
        q = q.select(knex.raw(`${alias}.entity_id as ??`, ['id']))
      } else if (f === 'created_at' || f === 'updated_at' || f === 'deleted_at') {
        q = q.select(knex.raw(`${alias}.?? as ??`, [f, f]))
      } else {
        // Non-cf from doc
        const expr = knex.raw(`(${alias}.doc ->> ?)`, [f])
        q = q.select({ [f]: expr })
      }
    }
    // Ensure CFs necessary for sort are selected
    const cfSelectedAliases: string[] = []
    for (const key of cfKeys) {
      const aliasName = this.sanitize(`cf:${key}`)
      const expr = this.jsonbRawAlias(knex, alias, `cf:${key}`)
      q = q.select({ [aliasName]: expr })
      cfSelectedAliases.push(aliasName)
    }

    // Sorting
    for (const s of opts.sort || []) {
      if (s.field.startsWith('cf:')) {
        const key = s.field.slice(3)
        const aliasName = this.sanitize(`cf:${key}`)
        if (!cfSelectedAliases.includes(aliasName)) {
          const expr = this.jsonbRawAlias(knex, alias, `cf:${key}`)
          q = q.select({ [aliasName]: expr })
          cfSelectedAliases.push(aliasName)
        }
        q = q.orderBy(aliasName, s.dir ?? SortDir.Asc)
      } else if (s.field === 'id') {
        q = q.orderBy(`${alias}.entity_id`, s.dir ?? SortDir.Asc)
      } else if (s.field === 'created_at' || s.field === 'updated_at' || s.field === 'deleted_at') {
        q = q.orderBy(`${alias}.${s.field}`, s.dir ?? SortDir.Asc)
      } else {
        const direction = s.dir ?? SortDir.Asc
        q = q.orderByRaw(`(${alias}.doc ->> ?) ${direction}`, [s.field])
      }
    }

    // Pagination + totals
    const page = opts.page?.page ?? 1
    const pageSize = opts.page?.pageSize ?? 20
    const countClone = q.clone()
    if (typeof countClone.clearSelect === 'function') countClone.clearSelect()
    if (typeof countClone.clearOrder === 'function') countClone.clearOrder()
    const countRow = await countClone.countDistinct(`${alias}.entity_id as count`).first()
    const total = this.parseCount(countRow)
    const items = await q.limit(pageSize).offset((page - 1) * pageSize)
    return { items, page, pageSize, total }
  }

  private async tableExists(table: string): Promise<boolean> {
    const knex = this.getKnex()
    const exists = await knex('information_schema.tables').where({ table_name: table }).first()
    return !!exists
  }

  private async hasSearchTokens(
    entity: string,
    tenantId: string | null,
    orgScope?: { ids: string[]; includeNull: boolean } | null
  ): Promise<boolean> {
    try {
      const knex = this.getKnex()
      const query = knex('search_tokens').select(1).where('entity_type', entity).limit(1)
      if (tenantId !== undefined) {
        query.andWhereRaw('tenant_id is not distinct from ?', [tenantId])
      }
      if (orgScope) {
        this.applyOrganizationScope(query as any, 'search_tokens.organization_id', orgScope)
      }
      const row = await query.first()
      return !!row
    } catch (err) {
      this.logSearchDebug('search:has-tokens-error', {
        entity,
        tenantId,
        organizationScope: orgScope,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }

  private async searchSourcesHaveTokens(
    sources: SearchTokenSource[],
    tenantId: string | null,
    orgScope?: { ids: string[]; includeNull: boolean } | null
  ): Promise<boolean> {
    for (const source of sources) {
      const ok = await this.hasSearchTokens(source.entity, tenantId, orgScope)
      this.logSearchDebug('search:source-has-tokens', {
        entity: source.entity,
        recordIdColumn: source.recordIdColumn,
        tenantId,
        organizationScope: orgScope,
        hasTokens: ok,
      })
      if (ok) return true
    }
    return false
  }

  private async resolveAvailableCustomFieldKeys(entityIds: string[], tenantId: string | null): Promise<string[]> {
    if (!entityIds.length) return []
    const cacheKey = this.customFieldKeysCacheKey(entityIds, tenantId)
    const now = Date.now()
    const cached = this.customFieldKeysCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return cached.value.slice()
    }

    const knex = this.getKnex()
    const rows = await knex('custom_field_defs')
      .select('key')
      .whereIn('entity_id', entityIds)
      .andWhere('is_active', true)
      .modify((qb: any) => {
        qb.andWhere((inner: any) => {
          inner.where({ tenant_id: tenantId }).orWhereNull('tenant_id')
        })
      })
    const keys = new Set<string>()
    for (const row of rows || []) {
      const key = (row as Record<string, unknown>).key
      if (typeof key === 'string' && key.trim().length) keys.add(key.trim())
      else if (key != null) keys.add(String(key))
    }
    const result = Array.from(keys)
    if (this.customFieldKeysTtlMs > 0) {
      this.customFieldKeysCache.set(cacheKey, { expiresAt: now + this.customFieldKeysTtlMs, value: result })
    }
    return result.slice()
  }

  private async entityHasActiveCustomFields(entityId: string, tenantId: string | null): Promise<boolean> {
    try {
      const keys = await this.resolveAvailableCustomFieldKeys([entityId], tenantId)
      return keys.length > 0
    } catch (err) {
      if (this.isDebugVerbosity()) {
        this.debug('query:cf:check-error', {
          entity: entityId,
          tenantId: tenantId ?? null,
          error: err instanceof Error ? err.message : err,
        })
      }
      return true
    }
  }

  private customFieldKeysCacheKey(entityIds: string[], tenantId: string | null): string {
    const sorted = entityIds.slice().sort().join(',')
    return `${tenantId ?? '__none__'}|${sorted}`
  }

  private resolveVectorService(): VectorIndexService | null {
    if (!this.vectorServiceResolver) return null
    try {
      return this.vectorServiceResolver() ?? null
    } catch {
      return null
    }
  }

  private resolveEntityLabel(entity: string): string {
    return entity
  }

  private async indexAnyRows(entity: string): Promise<boolean> {
    const knex = this.getKnex()
    // Prefer coverage snapshots – cheap and already scoped by maintenance jobs.
    const coverage = await knex('entity_index_coverage')
      .select(1)
      .where('entity_type', entity)
      .where('indexed_count', '>', 0)
      .first()
    if (coverage) return true
    const exists = await knex('entity_indexes').select('entity_id').where({ entity_type: entity }).first()
    return !!exists
  }
  private async getStoredCoverageSnapshot(
    entity: string,
    tenantId: string | null,
    organizationId: string | null,
    withDeleted: boolean
  ): Promise<{ baseCount: number; indexedCount: number } | null> {
    try {
      if (!this.isCoverageOptimizationEnabled()) {
        await refreshCoverageSnapshot(
          this.em,
          {
            entityType: entity,
            tenantId,
            organizationId,
            withDeleted,
          },
        )
      }
      const knex = this.getKnex()
      const row = await readCoverageSnapshot(knex, {
        entityType: entity,
        tenantId,
        organizationId,
        withDeleted,
      })
      if (!row) return null
      return { baseCount: row.baseCount, indexedCount: row.indexedCount }
    } catch (err) {
      if (this.isDebugVerbosity()) {
        this.debug('coverage:snapshot:read-error', {
          entity,
          tenantId,
          organizationId,
          withDeleted,
          error: err instanceof Error ? err.message : err,
        })
      }
      return null
    }
  }

  private scheduleAutoReindex(
    entity: string,
    opts: QueryOptions,
    stats?: { baseCount: number; indexedCount: number },
    organizationIdOverride?: string | null
  ) {
    if (!this.isAutoReindexEnabled()) return
    const bus = this.resolveEventBus()
    if (!bus) return
    const payload = {
      entityType: entity,
      tenantId: opts.tenantId ?? null,
      organizationId: organizationIdOverride ?? opts.organizationId ?? null,
      force: false,
    }
    const context = stats
      ? {
          entity,
          tenantId: payload.tenantId,
          organizationId: payload.organizationId,
          baseCount: stats.baseCount,
          indexedCount: stats.indexedCount,
        }
      : { entity, tenantId: payload.tenantId, organizationId: payload.organizationId }

    void Promise.resolve()
      .then(async () => {
        try {
          await bus.emitEvent('query_index.reindex', payload, { persistent: true })
          if (this.isDebugVerbosity()) this.debug('query:auto-reindex:scheduled', context)
        } catch (err) {
          console.warn('[HybridQueryEngine] Failed to schedule auto reindex:', {
            ...context,
            error: err instanceof Error ? err.message : err,
          })
        }
      })
  }

  private scheduleCoverageRefresh(
    entity: string,
    tenantId: string | null | undefined,
    organizationId: string | null | undefined,
    withDeleted: boolean
  ): void {
    const bus = this.resolveEventBus()
    if (!bus) return
    const key = [
      entity,
      tenantId ?? '__tenant__',
      organizationId ?? '__org__',
      withDeleted ? '1' : '0',
    ].join('|')
    if (this.pendingCoverageRefreshKeys.has(key)) return
    this.pendingCoverageRefreshKeys.add(key)
    void Promise.resolve()
      .then(async () => {
        try {
          await bus.emitEvent('query_index.coverage.refresh', {
            entityType: entity,
            tenantId: tenantId ?? null,
            organizationId: organizationId ?? null,
            withDeleted,
            delayMs: 0,
          })
          if (this.isDebugVerbosity()) {
            this.debug('coverage:refresh:scheduled', {
              entity,
              tenantId: tenantId ?? null,
              organizationId: organizationId ?? null,
              withDeleted,
            })
          }
        } catch (err) {
          if (this.isDebugVerbosity()) {
            this.debug('coverage:refresh:failed', {
              entity,
              tenantId: tenantId ?? null,
              organizationId: organizationId ?? null,
              withDeleted,
              error: err instanceof Error ? err.message : err,
            })
          }
        }
      })
      .finally(() => {
        this.pendingCoverageRefreshKeys.delete(key)
      })
  }

  private resolveEventBus(): Pick<EventBus, 'emitEvent'> | null {
    if (!this.eventBusResolver) return null
    try {
      const bus = this.eventBusResolver()
      return bus ?? null
    } catch {
      return null
    }
  }

  private isAutoReindexEnabled(): boolean {
    if (this.autoReindexEnabled != null) return this.autoReindexEnabled
    const raw = (
      process.env.SCHEDULE_AUTO_REINDEX ??
      process.env.QUERY_INDEX_AUTO_REINDEX ??
      ''
    )
      .trim()
      .toLowerCase()
    if (!raw) {
      this.autoReindexEnabled = true
      return true
    }
    const parsed = parseBooleanToken(raw)
    this.autoReindexEnabled = parsed === null ? true : parsed
    return this.autoReindexEnabled
  }

  private isCoverageOptimizationEnabled(): boolean {
    if (this.coverageOptimizationEnabled != null) return this.coverageOptimizationEnabled
    const raw = (process.env.OPTIMIZE_INDEX_COVERAGE_STATS ?? '').trim().toLowerCase()
    if (!raw) {
      this.coverageOptimizationEnabled = false
      return false
    }
    this.coverageOptimizationEnabled = parseBooleanToken(raw) === true
    return this.coverageOptimizationEnabled
  }

  private async columnExists(table: string, column: string): Promise<boolean> {
    const key = `${table}.${column}`
    if (this.columnCache.has(key)) {
      const cached = this.columnCache.get(key)
      if (cached === true) return true
      this.columnCache.delete(key)
    }
    const knex = this.getKnex()
    const exists = await knex('information_schema.columns')
      .where({ table_name: table, column_name: column })
      .first()
    const present = !!exists
    if (present) this.columnCache.set(key, true)
    else this.columnCache.delete(key)
    return present
  }

  private async getBaseColumnsForEntity(entity: string): Promise<Map<string, string>> {
    const knex = this.getKnex()
    const table = resolveEntityTableName(this.em, entity)
    const rows = await knex('information_schema.columns')
      .select('column_name', 'data_type')
      .where({ table_name: table })
    const map = new Map<string, string>()
    for (const r of rows) map.set(r.column_name, r.data_type)
    return map
  }

  private resolveOrganizationScope(opts: QueryOptions): { ids: string[]; includeNull: boolean } | null {
    if (opts.organizationIds !== undefined) {
      const raw = (opts.organizationIds ?? []).map((id) => (typeof id === 'string' ? id.trim() : id))
      const includeNull = raw.some((id) => id == null || id === '')
      const ids = raw.filter((id): id is string => typeof id === 'string' && id.length > 0)
      const unique = Array.from(new Set(ids))
      return { ids: unique, includeNull }
    }
    if (typeof opts.organizationId === 'string' && opts.organizationId.trim().length > 0) {
      return { ids: [opts.organizationId], includeNull: false }
    }
    return null
  }

  private resolveCoverageSnapshotScope(
    opts: QueryOptions
  ): { tenantId: string | null; organizationId: string | null } | null {
    const tenantId = opts.tenantId ?? null
    const orgScope = this.resolveOrganizationScope(opts)
    if (!orgScope) return { tenantId, organizationId: null }
    if (orgScope.includeNull) {
      if (orgScope.ids.length === 0) return { tenantId, organizationId: null }
      return null
    }
    if (orgScope.ids.length === 1) return { tenantId, organizationId: orgScope.ids[0] }
    if (orgScope.ids.length === 0) return { tenantId, organizationId: null }
    return null
  }

  private applyOrganizationScope<TRecord extends ResultRow, TResult>(
    q: Knex.QueryBuilder<TRecord, TResult>,
    column: string,
    scope: { ids: string[]; includeNull: boolean }
  ): Knex.QueryBuilder<TRecord, TResult> {
    if (scope.ids.length === 0 && !scope.includeNull) {
      return q.whereRaw('1 = 0')
    }
    return q.where((builder) => {
      let applied = false
      if (scope.ids.length > 0) {
        builder.whereIn(column, scope.ids as readonly string[])
        applied = true
      }
      if (scope.includeNull) {
        if (applied) builder.orWhereNull(column)
        else builder.whereNull(column)
      } else if (!applied) {
        builder.whereRaw('1 = 0')
      }
    })
  }

  private normalizeFilters(filters?: QueryOptions['filters']): NormalizedFilter[] {
    if (!filters) return []
    const normalizeField = (k: string) => k.startsWith('cf_') ? `cf:${k.slice(3)}` : k
    if (Array.isArray(filters)) {
      return (filters as Filter[]).map((filter) => ({
        field: normalizeField(String(filter.field)),
        op: filter.op,
        value: filter.value,
      }))
    }
    const out: NormalizedFilter[] = []
    const obj = filters as Record<string, unknown>
    const add = (field: string, op: FilterOp, value?: unknown) => out.push({ field, op, value })
    for (const [rawKey, rawVal] of Object.entries(obj)) {
      const field = normalizeField(rawKey)
      if (rawVal !== null && typeof rawVal === 'object' && !Array.isArray(rawVal)) {
        for (const [opKey, opVal] of Object.entries(rawVal as Record<string, unknown>)) {
          switch (opKey) {
            case '$eq': add(field, 'eq', opVal); break
            case '$ne': add(field, 'ne', opVal); break
            case '$gt': add(field, 'gt', opVal); break
            case '$gte': add(field, 'gte', opVal); break
            case '$lt': add(field, 'lt', opVal); break
            case '$lte': add(field, 'lte', opVal); break
            case '$in': add(field, 'in', opVal); break
            case '$nin': add(field, 'nin', opVal); break
            case '$like': add(field, 'like', opVal); break
            case '$ilike': add(field, 'ilike', opVal); break
            case '$exists': add(field, 'exists', opVal); break
          }
        }
      } else {
        add(field, 'eq', rawVal)
      }
    }
    return out
  }

  private sanitize(s: string): string {
    return s.replace(/[^a-zA-Z0-9_]/g, '_')
  }

  private toArray(value: unknown): readonly unknown[] {
    if (Array.isArray(value)) {
      return value
    }
    if (value === undefined) {
      return []
    }
    return [value]
  }

  private parseCount(row: unknown): number {
    if (row && typeof row === 'object' && 'count' in row) {
      const value = (row as { count: unknown }).count
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const parsed = Number(value)
        return Number.isNaN(parsed) ? 0 : parsed
      }
    }
    return 0
  }

  private logSearchDebug(event: string, payload: Record<string, unknown>) {
    if (!this.isDebugVerbosity()) return
    try {
      console.info('[query-index:search]', event, JSON.stringify(payload))
    } catch {
      console.info('[query-index:search]', event, payload)
    }
  }

  private applyColumnFilter<TRecord extends ResultRow, TResult>(
    q: Knex.QueryBuilder<TRecord, TResult>,
    column: string | Knex.Raw,
    filter: NormalizedFilter,
    search?: SearchRuntime & { knex: Knex; entity: string; field: string; recordIdColumn?: string }
  ): Knex.QueryBuilder<TRecord, TResult> {
    if (
      (filter.op === 'like' || filter.op === 'ilike') &&
      search?.enabled &&
      typeof filter.value === 'string'
    ) {
      const tokens = tokenizeText(String(filter.value), search.config)
      const hashes = tokens.hashes
      if (hashes.length) {
        const sources: SearchTokenSource[] = (search.searchSources && search.searchSources.length
          ? search.searchSources
          : [{ entity: search.entity, recordIdColumn: search.recordIdColumn ?? '' }]
        ).filter((src) => src.recordIdColumn && src.entity)
        let applied = false
        if (sources.length) {
          q = q.where((qb) => {
            sources.forEach((src, idx) => {
              const ok = this.applySearchTokens(qb as any, {
                knex: search.knex,
                entity: src.entity,
                field: search.field,
                hashes,
                recordIdColumn: src.recordIdColumn,
                tenantId: search.tenantId ?? null,
                organizationScope: search.organizationScope ?? null,
                combineWith: idx === 0 ? 'and' : 'or',
              })
              if (ok) applied = true
            })
          })
        }
        this.logSearchDebug('search:filter', {
          entity: search.entity,
          field: search.field,
          tokens: tokens.tokens,
          hashes,
          applied,
          tenantId: search.tenantId ?? null,
          organizationScope: search.organizationScope,
          sources: sources.map((src) => ({ entity: src.entity, recordIdColumn: src.recordIdColumn })),
        })
        if (applied) return q
      } else {
        this.logSearchDebug('search:skip-empty-hashes', {
          entity: search.entity,
          field: search.field,
          value: filter.value,
        })
      }
      return q
    }
    const col = column as any
    switch (filter.op) {
      case 'eq':
        return q.where(col, filter.value as Knex.Value)
      case 'ne':
        return q.whereNot(col, filter.value as Knex.Value)
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const operator = filter.op === 'gt' ? '>' : filter.op === 'gte' ? '>=' : filter.op === 'lt' ? '<' : '<='
        return q.where(col, operator, filter.value as Knex.Value)
      }
      case 'in': {
        const values = this.toArray(filter.value) as readonly Knex.Value[]
        return q.whereIn(col, values)
      }
      case 'nin': {
        const values = this.toArray(filter.value) as readonly Knex.Value[]
        return q.whereNotIn(col, values)
      }
      case 'like':
        return q.where(col, 'like', filter.value as Knex.Value)
      case 'ilike':
        return q.where(col, 'ilike', filter.value as Knex.Value)
      case 'exists':
        return filter.value ? q.whereNotNull(col) : q.whereNull(col)
      default:
        return q
    }
  }

  private resolveCustomEntityColumn(alias: string, field: string): string | null {
    if (field === 'id') return `${alias}.entity_id`
    if (field === 'organization_id' || field === 'organizationId') return `${alias}.organization_id`
    if (field === 'tenant_id' || field === 'tenantId') return `${alias}.tenant_id`
    if (field === 'created_at' || field === 'updated_at' || field === 'deleted_at') return `${alias}.${field}`
    return null
  }

  private isDebugVerbosity(): boolean {
    if (this.debugVerbosity != null) return this.debugVerbosity
    this.debugVerbosity = resolveDebugVerbosity()
    return this.debugVerbosity
  }

  private isSqlDebugEnabled(): boolean {
    if (this.sqlDebugEnabled != null) return this.sqlDebugEnabled
    this.sqlDebugEnabled = resolveBooleanEnv(['QUERY_ENGINE_DEBUG_SQL'], false)
    return this.sqlDebugEnabled
  }

  private isForcePartialIndexEnabled(): boolean {
    if (this.forcePartialIndexEnabled != null) return this.forcePartialIndexEnabled
    this.forcePartialIndexEnabled = resolveBooleanEnv(['FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES'], true)
    return this.forcePartialIndexEnabled
  }

  private async resolveCoverageGap(
    entity: string,
    opts: QueryOptions,
    coverageScope?: { tenantId: string | null; organizationId: string | null } | null,
    _sourceTable?: string
  ): Promise<{ stats?: { baseCount: number; indexedCount: number }; scope: 'scoped' | 'global' } | null> {
    const scope = coverageScope ?? this.resolveCoverageSnapshotScope(opts)
    if (!scope) return null
    const tenantId = scope.tenantId
    const organizationId = scope.organizationId
    const withDeleted = !!opts.withDeleted

    const snapshot = await this.getStoredCoverageSnapshot(entity, tenantId, organizationId, withDeleted)
    if (!snapshot) {
      this.scheduleCoverageRefresh(entity, tenantId, organizationId, withDeleted)
      return { stats: undefined, scope: 'scoped' }
    }

    const baseCount = snapshot.baseCount
    const indexCount = snapshot.indexedCount
    const hasGap = baseCount > 0 && indexCount < baseCount
    if (hasGap || indexCount > baseCount) {
      return { stats: snapshot, scope: 'scoped' }
    }

    return null
  }

  // Backward-compatible hook for tests that mock coverage stats
  private async indexCoverageStats(
    entity: string,
    opts: QueryOptions,
    coverageScope?: { tenantId: string | null; organizationId: string | null } | null,
  ): Promise<{ baseCount: number; indexedCount: number } | null> {
    const gap = await this.resolveCoverageGap(entity, opts, coverageScope)
    return gap?.stats ?? null
  }

  private async captureSqlTiming<TResult>(
    label: string,
    entity: EntityId,
    execute: () => Promise<TResult> | TResult,
    extra?: Record<string, unknown>,
    profiler?: Profiler
  ): Promise<TResult> {
    const shouldDebug = this.isSqlDebugEnabled() && this.isDebugVerbosity()
    const shouldProfile = profiler?.enabled === true
    if (!shouldDebug && !shouldProfile) {
      return Promise.resolve(execute())
    }
    const startedAt = process.hrtime.bigint()
    try {
      return await Promise.resolve(execute())
    } finally {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
      const context: Record<string, unknown> = {
        entity,
        durationMs: Math.round(elapsedMs * 1000) / 1000,
      }
      if (extra) Object.assign(context, extra)
      if (shouldProfile) profiler!.record(label, context.durationMs as number, extra)
      if (shouldDebug) this.debug(`${label}:timing`, context)
    }
  }

  private debug(message: string, context?: Record<string, unknown>): void {
    if (!this.isDebugVerbosity()) return
    if (!this.isSqlDebugEnabled()) return
    if (context) console.debug('[HybridQueryEngine]', message, context)
    else console.debug('[HybridQueryEngine]', message)
  }
}
