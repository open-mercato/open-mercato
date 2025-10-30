import type { QueryEngine, QueryOptions, QueryResult, FilterOp, Filter, QueryCustomFieldSource, PartialIndexWarning } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine, resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import type { Knex } from 'knex'
import type { EventBus } from '@open-mercato/events'
import { readCoverageSnapshot, refreshCoverageSnapshot } from './coverage'
import { createProfiler, shouldEnableProfiler, type Profiler } from '@open-mercato/shared/lib/profiler'

function parseBooleanToken(value: string | null | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue
  const token = value.trim().toLowerCase()
  if (!token.length) return defaultValue
  if (['1', 'true', 'yes', 'on'].includes(token)) return true
  if (['0', 'false', 'no', 'off'].includes(token)) return false
  return defaultValue
}

function resolveBooleanEnv(names: readonly string[], defaultValue: boolean): boolean {
  for (const name of names) {
    const raw = process.env[name]
    if (raw !== undefined) return parseBooleanToken(raw, defaultValue)
  }
  return defaultValue
}

function resolveDebugVerbosity(): boolean {
  const level = (process.env.LOG_VERBOSITY ?? process.env.LOG_LEVEL ?? '').toLowerCase()
  if (['debug', 'trace', 'silly'].includes(level)) return true
  const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase()
  return nodeEnv === 'development'
}

type ResultRow = Record<string, unknown>
type ResultBuilder<TResult = ResultRow[]> = Knex.QueryBuilder<ResultRow, TResult>
type NormalizedFilter = { field: string; op: FilterOp; value?: unknown }
type IndexDocSource = { alias: string; entityId: EntityId }
type PreparedCustomFieldSource = {
  alias: string
  indexAlias: string
  entityId: EntityId
  recordIdColumn: string
  organizationField?: string
  tenantField?: string
  table: string
}

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

  constructor(
    private em: EntityManager,
    private fallback: BasicQueryEngine,
    private eventBusResolver?: () => Pick<EventBus, 'emitEvent'> | null | undefined
  ) {
    const coverageTtl = Number.parseInt(process.env.QUERY_INDEX_COVERAGE_CACHE_MS ?? '', 10)
    this.coverageStatsTtlMs = Number.isFinite(coverageTtl) && coverageTtl >= 0 ? coverageTtl : 5 * 60 * 1000
    const cfTtl = Number.parseInt(process.env.QUERY_INDEX_CF_KEYS_CACHE_MS ?? '', 10)
    this.customFieldKeysTtlMs = Number.isFinite(cfTtl) && cfTtl >= 0 ? cfTtl : 5 * 60 * 1000
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

      if (await this.isCustomEntity(entity)) {
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

      const baseExists = await profiler.measure('base_table_exists', () => this.tableExists(baseTable))
      if (!baseExists) {
        if (debugEnabled) this.debug('query:fallback:missing-base', { entity, baseTable })
        const fallbackResult = await this.fallback.query(entity, opts)
        finishProfile({ result: 'fallback', reason: 'missing_base' })
        return fallbackResult
      }

      const normalizedFilters = this.normalizeFilters(opts.filters)
      const orgScope = this.resolveOrganizationScope(opts)
      const wantsCf = (
        (opts.fields || []).some((field) => typeof field === 'string' && field.startsWith('cf:')) ||
        normalizedFilters.some((filter) => filter.field.startsWith('cf:')) ||
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

    if (wantsCf) {
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
        const gap = await profiler.measure(
          'resolve_coverage_gap',
          () => this.resolveCoverageGap(entity, opts),
          (value) => (value
            ? {
                scope: value.scope,
                baseCount: value.stats?.baseCount ?? null,
                indexedCount: value.stats?.indexedCount ?? null,
              }
            : { scope: null })
        )
        if (gap) {
          this.scheduleAutoReindex(entity, opts, gap.stats)
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
            baseCount: gap.stats?.baseCount ?? null,
            indexedCount: gap.stats?.indexedCount ?? null,
            scope: gap.stats ? gap.scope : undefined,
          }
        }
      }

      const qualify = (col: string) => `b.${col}`
    let builder: ResultBuilder = knex({ b: baseTable })
    const hasCustomFieldFilters = normalizedFilters.some((filter) => filter.field.startsWith('cf:'))
    const canOptimizeCount = !hasCustomFieldFilters
    let optimizedCountBuilder: ResultBuilder | null = canOptimizeCount ? knex({ b: baseTable }) : null

    if (!opts.tenantId) throw new Error('QueryEngine: tenantId is required')

    const hasOrganizationColumn = await this.columnExists(baseTable, 'organization_id')
    const hasTenantColumn = await this.columnExists(baseTable, 'tenant_id')
    const hasDeletedColumn = await this.columnExists(baseTable, 'deleted_at')

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
    const indexSources: IndexDocSource[] = [{ alias: 'ei', entityId: entity }]

    if (wantsCf && Array.isArray(opts.customFieldSources) && opts.customFieldSources.length > 0) {
      const prepared = this.prepareCustomFieldSources(knex, builder, opts.customFieldSources, qualify)
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
        indexSources.push({ alias: source.indexAlias, entityId: source.entityId })
      }
    }

    if (debugEnabled) {
      this.debug('query:index-sources', {
        entity,
        sources: indexSources.map((src) => ({ alias: src.alias, entity: src.entityId })),
      })
    }

    if (!partialIndexWarning && Array.isArray(opts.customFieldSources) && opts.customFieldSources.length > 0 && this.isForcePartialIndexEnabled()) {
      const seen = new Set<string>([entity])
      for (const source of opts.customFieldSources) {
        const targetEntity = source?.entityId ? String(source.entityId) : null
        if (!targetEntity || seen.has(targetEntity)) continue
        seen.add(targetEntity)
        const sourceTable = source.table ?? resolveEntityTableName(this.em, targetEntity)
        try {
          const gap = await profiler.measure(
            'resolve_coverage_gap',
            () => this.resolveCoverageGap(targetEntity, opts, sourceTable),
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
          this.scheduleAutoReindex(targetEntity, opts, gap.stats)
          partialIndexWarning = {
            entity: targetEntity,
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

    const resolveBaseColumn = (field: string): string | null => {
      if (columns.has(field)) return field
      if (field === 'organization_id' && columns.has('id')) return 'id'
      return null
    }

    for (const filter of normalizedFilters) {
      if (filter.field.startsWith('cf:')) {
        builder = this.applyCfFilterAcrossSources(knex, builder, filter.field, filter.op, filter.value, indexSources)
        continue
      }
      const baseField = resolveBaseColumn(String(filter.field))
      if (!baseField) continue
      const column = qualify(baseField)
      builder = this.applyColumnFilter(builder, column, filter)
      if (optimizedCountBuilder) optimizedCountBuilder = this.applyColumnFilter(optimizedCountBuilder, column, filter)
    }

    const selectFieldSet = new Set<string>((opts.fields && opts.fields.length) ? opts.fields.map(String) : ['id'])
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
          builder = builder.orderBy(knex.raw(textSql), sort.dir ?? SortDir.Asc)
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
    const items = await this.captureSqlTiming(
      'query:sql:data',
      entity,
      () => dataBuilder,
      { page, pageSize },
      profiler
    )
    if (debugEnabled) this.debug('query:complete', { entity, total, items: Array.isArray(items) ? items.length : 0 })

    const result: QueryResult<T> = { items, page, pageSize, total }
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
    sources: IndexDocSource[]
  ): ResultBuilder {
    if (!sources.length) return builder
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
        return builder.whereNotIn(textExpr, values)
      }
      case 'like':
        return builder.where(textExpr, 'like', value as Knex.Value)
      case 'ilike':
        return builder.where(textExpr, 'ilike', value as Knex.Value)
      case 'exists':
        return value ? builder.whereNotNull(textExpr) : builder.whereNull(textExpr)
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
    key: string,
    op: FilterOp,
    value: unknown
  ): ResultBuilder {
    const text = this.cfTextExprAlias(knex, alias, key)
    const arrExpr = knex.raw(`(${alias}.doc -> ?)`, [key])
    const arrContains = (val: unknown) => knex.raw(`${arrExpr.toString()} @> ?::jsonb`, [JSON.stringify([val])])
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
        return q.whereNotIn(text, vals)
      }
      case 'like':
        return q.where(text, 'like', value as Knex.Value)
      case 'ilike':
        return q.where(text, 'ilike', value as Knex.Value)
      case 'exists':
        return value ? q.whereNotNull(text) : q.whereNull(text)
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

    const normalizedFilters = this.normalizeFilters(opts.filters)

    // Apply filters: cf:* via JSONB; other keys: special-case id/created_at/updated_at/deleted_at, otherwise from doc
    for (const filter of normalizedFilters) {
      if (filter.field.startsWith('cf:')) {
        q = this.applyCfFilterFromAlias(knex, q, alias, filter.field, filter.op, filter.value)
        continue
      }
      const column = this.resolveCustomEntityColumn(alias, String(filter.field))
      if (column) {
        q = this.applyColumnFilter(q, column, filter)
        continue
      }
      const docExpr = knex.raw(`(${alias}.doc ->> ?)`, [String(filter.field)])
      q = this.applyColumnFilter(q, docExpr, filter)
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
        const expr = knex.raw(`(${alias}.doc ->> ?)`, [s.field])
        q = q.orderBy(expr, s.dir ?? SortDir.Asc)
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

  private customFieldKeysCacheKey(entityIds: string[], tenantId: string | null): string {
    const sorted = entityIds.slice().sort().join(',')
    return `${tenantId ?? '__none__'}|${sorted}`
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
        await refreshCoverageSnapshot(this.em, {
          entityType: entity,
          tenantId,
          organizationId,
          withDeleted,
        })
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

  private scheduleAutoReindex(entity: string, opts: QueryOptions, stats?: { baseCount: number; indexedCount: number }) {
    if (!this.isAutoReindexEnabled()) return
    const bus = this.resolveEventBus()
    if (!bus) return
    const payload = {
      entityType: entity,
      tenantId: opts.tenantId ?? null,
      organizationId: opts.organizationId ?? null,
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
    this.autoReindexEnabled = !['0', 'false', 'no', 'off'].includes(raw)
    return this.autoReindexEnabled
  }

  private isCoverageOptimizationEnabled(): boolean {
    if (this.coverageOptimizationEnabled != null) return this.coverageOptimizationEnabled
    const raw = (process.env.OPTIMIZE_INDEX_COVERAGE_STATS ?? '').trim().toLowerCase()
    if (!raw) {
      this.coverageOptimizationEnabled = false
      return false
    }
    this.coverageOptimizationEnabled = ['1', 'true', 'yes', 'on'].includes(raw)
    return this.coverageOptimizationEnabled
  }

  private async columnExists(table: string, column: string): Promise<boolean> {
    const key = `${table}.${column}`
    if (this.columnCache.has(key)) return this.columnCache.get(key)!
    const knex = this.getKnex()
    const exists = await knex('information_schema.columns')
      .where({ table_name: table, column_name: column })
      .first()
    const present = !!exists
    this.columnCache.set(key, present)
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

  private applyColumnFilter<TRecord extends ResultRow, TResult>(
    q: Knex.QueryBuilder<TRecord, TResult>,
    column: string | Knex.Raw,
    filter: NormalizedFilter
  ): Knex.QueryBuilder<TRecord, TResult> {
    switch (filter.op) {
      case 'eq':
        return q.where(column, filter.value as Knex.Value)
      case 'ne':
        return q.whereNot(column, filter.value as Knex.Value)
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const operator = filter.op === 'gt' ? '>' : filter.op === 'gte' ? '>=' : filter.op === 'lt' ? '<' : '<='
        return q.where(column, operator, filter.value as Knex.Value)
      }
      case 'in': {
        const values = this.toArray(filter.value) as readonly Knex.Value[]
        return q.whereIn(column, values)
      }
      case 'nin': {
        const values = this.toArray(filter.value) as readonly Knex.Value[]
        return q.whereNotIn(column, values)
      }
      case 'like':
        return q.where(column, 'like', filter.value as Knex.Value)
      case 'ilike':
        return q.where(column, 'ilike', filter.value as Knex.Value)
      case 'exists':
        return filter.value ? q.whereNotNull(column) : q.whereNull(column)
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
    _sourceTable?: string
  ): Promise<{ stats?: { baseCount: number; indexedCount: number }; scope: 'scoped' | 'global' } | null> {
    const tenantId = opts.tenantId ?? null
    const withDeleted = !!opts.withDeleted

    const snapshot = await this.getStoredCoverageSnapshot(entity, tenantId, null, withDeleted)
    if (!snapshot) {
      this.scheduleCoverageRefresh(entity, tenantId, null, withDeleted)
      return { stats: undefined, scope: 'scoped' }
    }

    const hasGap = snapshot.baseCount > 0 && snapshot.indexedCount < snapshot.baseCount
    if (hasGap) {
      return { stats: snapshot, scope: 'scoped' }
    }

    return null
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
