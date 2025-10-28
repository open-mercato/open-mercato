import type { QueryEngine, QueryOptions, QueryResult, FilterOp, Filter, QueryCustomFieldSource } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine, resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import type { Knex } from 'knex'
import type { EventBus } from '@open-mercato/events'

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

export class HybridQueryEngine implements QueryEngine {
  private columnCache = new Map<string, boolean>()
  private debugVerbosity: boolean | null = null
  private sqlDebugEnabled: boolean | null = null
  private autoReindexEnabled: boolean | null = null
  private pendingAutoReindexKeys = new Set<string>()

  constructor(
    private em: EntityManager,
    private fallback: BasicQueryEngine,
    private eventBusResolver?: () => Pick<EventBus, 'emitEvent'> | null | undefined
  ) {}

  async query<T = unknown>(entity: EntityId, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    const debugEnabled = this.isDebugVerbosity()
    if (debugEnabled) this.debug('query:start', { entity })

    if (await this.isCustomEntity(entity)) {
      if (debugEnabled) this.debug('query:custom-entity', { entity })
      return this.queryCustomEntity<T>(entity, opts)
    }

    const knex = this.getKnex()
    const baseTable = resolveEntityTableName(this.em, entity)

    const baseExists = await this.tableExists(baseTable)
    if (!baseExists) {
      if (debugEnabled) this.debug('query:fallback:missing-base', { entity, baseTable })
      return this.fallback.query(entity, opts)
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

    if (wantsCf) {
      const hasIndexRows = await this.indexAnyRows(entity)
      if (!hasIndexRows) {
        if (debugEnabled) this.debug('query:fallback:no-index', { entity })
        return this.fallback.query(entity, opts)
      }
      const coverageOk = await this.indexCoverageComplete(entity, baseTable, opts)
      if (!coverageOk) {
        let stats: { baseCount: number; indexedCount: number } | undefined
        try {
          stats = await this.indexCoverageStats(entity, baseTable, opts)
          console.warn('[HybridQueryEngine] Partial index coverage detected; falling back to basic engine:', { entity, baseCount: stats.baseCount, indexedCount: stats.indexedCount })
          if (debugEnabled) this.debug('query:fallback:partial-coverage', { entity, baseCount: stats.baseCount, indexedCount: stats.indexedCount })
        } catch {
          console.warn('[HybridQueryEngine] Partial index coverage detected; falling back to basic engine:', { entity })
          if (debugEnabled) this.debug('query:fallback:partial-coverage', { entity })
        }
        this.scheduleAutoReindex(entity, opts, stats)
        return this.fallback.query(entity, opts)
      }
    }

    const qualify = (col: string) => `b.${col}`
    let builder: ResultBuilder = knex({ b: baseTable })
    const canOptimizeCount = !normalizedFilters.some((filter) => filter.field.startsWith('cf:')) && (!Array.isArray(opts.customFieldSources) || opts.customFieldSources.length === 0)
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
      const countRow = await this.captureSqlTiming('query:sql:count', entity, () => countQuery.first())
      total = this.parseCount(countRow)
    } else {
      const countBuilder = builder.clone().clearSelect().clearOrder().countDistinct(`${qualify('id')} as count`)
      if (debugEnabled && sqlDebugEnabled) {
        const { sql, bindings } = countBuilder.clone().toSQL()
        this.debug('query:sql:count', { entity, sql, bindings })
      }
      const countRow = await this.captureSqlTiming('query:sql:count', entity, () => countBuilder.first())
      total = this.parseCount(countRow)
    }

    const dataBuilder = builder.clone().limit(pageSize).offset((page - 1) * pageSize)
    if (debugEnabled && sqlDebugEnabled) {
      const { sql, bindings } = dataBuilder.clone().toSQL()
      this.debug('query:sql:data', { entity, sql, bindings, page, pageSize })
    }
    const items = await this.captureSqlTiming('query:sql:data', entity, () => dataBuilder, { page, pageSize })
    if (debugEnabled) this.debug('query:complete', { entity, total, items: Array.isArray(items) ? items.length : 0 })

    return { items, page, pageSize, total }
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
    return Array.from(keys)
  }

  private async indexAnyRows(entity: string): Promise<boolean> {
    const knex = this.getKnex()
    const exists = await knex('entity_indexes').where({ entity_type: entity }).first()
    return !!exists
  }

  private async indexCoverageComplete(entity: string, baseTable: string, opts: QueryOptions): Promise<boolean> {
    const { baseCount, indexedCount } = await this.indexCoverageStats(entity, baseTable, opts)
    if (baseCount === 0) return true
    return indexedCount >= baseCount
  }

  private async indexCoverageStats(entity: string, baseTable: string, opts: QueryOptions): Promise<{ baseCount: number; indexedCount: number }> {
    const knex = this.getKnex()

    // Base count within scope (org/tenant/soft-delete)
    const orgScope = this.resolveOrganizationScope(opts)

    let bq = knex({ b: baseTable }).clearSelect().clearOrder()
    if (orgScope && (await this.columnExists(baseTable, 'organization_id'))) {
      bq = this.applyOrganizationScope(bq, 'b.organization_id', orgScope)
    }
    if (opts.tenantId && (await this.columnExists(baseTable, 'tenant_id'))) {
      bq = bq.where('b.tenant_id', opts.tenantId)
    }
    if (!opts.withDeleted && (await this.columnExists(baseTable, 'deleted_at'))) {
      bq = bq.whereNull('b.deleted_at')
    }
    const baseRow = await bq.countDistinct('b.id as count').first()
    const baseCount = this.parseCount(baseRow)

    // Index count within same scope
    let iq = knex({ ei: 'entity_indexes' }).clearSelect().clearOrder().where('ei.entity_type', entity)
    if (!opts.withDeleted) iq = iq.whereNull('ei.deleted_at')
    if (orgScope) iq = this.applyOrganizationScope(iq, 'ei.organization_id', orgScope)
    if (opts.tenantId) iq = iq.where('ei.tenant_id', opts.tenantId)
    const idxRow = await iq.countDistinct('ei.entity_id as count').first()
    const indexedCount = this.parseCount(idxRow)

    return { baseCount, indexedCount }
  }

  private scheduleAutoReindex(entity: string, opts: QueryOptions, stats?: { baseCount: number; indexedCount: number }) {
    if (!this.isAutoReindexEnabled()) return
    const bus = this.resolveEventBus()
    if (!bus) return
    const tenantKey = opts.tenantId ?? '__global__'
    const cacheKey = `${entity}::${tenantKey}`
    if (this.pendingAutoReindexKeys.has(cacheKey)) return
    this.pendingAutoReindexKeys.add(cacheKey)

    const payload = { entityType: entity, tenantId: opts.tenantId ?? null, force: false }
    const context = stats
      ? { entity, tenantId: payload.tenantId, baseCount: stats.baseCount, indexedCount: stats.indexedCount }
      : { entity, tenantId: payload.tenantId }

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
      .finally(() => {
        this.pendingAutoReindexKeys.delete(cacheKey)
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
    const raw = (process.env.QUERY_INDEX_AUTO_REINDEX ?? '').trim().toLowerCase()
    if (!raw) {
      this.autoReindexEnabled = true
      return true
    }
    this.autoReindexEnabled = !['0', 'false', 'no', 'off'].includes(raw)
    return this.autoReindexEnabled
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
    const level = (process.env.LOG_VERBOSITY ?? process.env.LOG_LEVEL ?? '').toLowerCase()
    const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase()
    this.debugVerbosity = level === 'debug' || level === 'trace' || level === 'silly' || nodeEnv === 'development'
    return this.debugVerbosity
  }

  private isSqlDebugEnabled(): boolean {
    if (this.sqlDebugEnabled != null) return this.sqlDebugEnabled
    const raw = (process.env.QUERY_ENGINE_DEBUG_SQL ?? '').toLowerCase()
    this.sqlDebugEnabled = raw === '1' || raw === 'true' || raw === 'yes'
    return this.sqlDebugEnabled
  }

  private async captureSqlTiming<TResult>(
    label: string,
    entity: EntityId,
    execute: () => Promise<TResult> | TResult,
    extra?: Record<string, unknown>
  ): Promise<TResult> {
    if (!this.isSqlDebugEnabled() || !this.isDebugVerbosity()) {
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
      this.debug(`${label}:timing`, context)
    }
  }

  private debug(message: string, context?: Record<string, unknown>): void {
    if (!this.isDebugVerbosity()) return
    if (!this.isSqlDebugEnabled()) return
    if (context) console.debug('[HybridQueryEngine]', message, context)
    else console.debug('[HybridQueryEngine]', message)
  }
}
