import type { QueryEngine, QueryOptions, QueryResult, FilterOp, Filter } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine, resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import type { Knex } from 'knex'

type ResultRow = Record<string, unknown>
type ResultBuilder<TResult = ResultRow[]> = Knex.QueryBuilder<ResultRow, TResult>
type NormalizedFilter = { field: string; op: FilterOp; value?: unknown }

export class HybridQueryEngine implements QueryEngine {
  private columnCache = new Map<string, boolean>()

  constructor(private em: EntityManager, private fallback: BasicQueryEngine) {}

  async query<T = unknown>(entity: EntityId, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    // Custom entities: read directly from custom_entities_storage
    if (await this.isCustomEntity(entity)) {
      return this.queryCustomEntity<T>(entity, opts)
    }
    // Base table first; left-join index for cf:* only
    const knex = this.getKnex()
    const baseTable = resolveEntityTableName(this.em, entity)

    // Fallback when base table is missing
    const baseExists = await this.tableExists(baseTable)
    if (!baseExists) return this.fallback.query(entity, opts)

    // Heuristic: if query needs cf:* but index is not fully populated for this scope, fall back
    const arrayFilters = this.normalizeFilters(opts.filters)
    const orgScope = this.resolveOrganizationScope(opts)
    const wantsCf = (
      (opts.fields || []).some((f) => typeof f === 'string' && f.startsWith('cf:')) ||
      arrayFilters.some((f) => f.field.startsWith('cf:')) ||
      opts.includeCustomFields === true ||
      (Array.isArray(opts.includeCustomFields) && opts.includeCustomFields.length > 0)
    )
    if (wantsCf) {
      // If no index rows exist at all OR partial coverage vs base table, fall back
      const hasAny = await this.indexAnyRows(entity)
      if (!hasAny) return this.fallback.query(entity, opts)

      const coverageOk = await this.indexCoverageComplete(entity, baseTable, opts)
      if (!coverageOk) {
        // Warn once per query to surface potential indexing issues
        try {
          const { baseCount, indexedCount } = await this.indexCoverageStats(entity, baseTable, opts)
          console.warn('[HybridQueryEngine] Partial index coverage detected; falling back to basic engine:', { entity, baseCount, indexedCount })
        } catch {
          console.warn('[HybridQueryEngine] Partial index coverage detected; falling back to basic engine:', { entity })
        }
        return this.fallback.query(entity, opts)
      }
    }

    const qualify = (col: string) => `b.${col}`
    let q = knex({ b: baseTable })

    // Require tenant scope for all queries
    if (!opts.tenantId) throw new Error('QueryEngine: tenantId is required')
    // Optional organizationId filter on base when column exists
    if (orgScope && (await this.columnExists(baseTable, 'organization_id'))) {
      q = this.applyOrganizationScope(q, qualify('organization_id'), orgScope)
    }
    if (await this.columnExists(baseTable, 'tenant_id')) {
      q = q.where(qualify('tenant_id'), opts.tenantId)
    }
    if (!opts.withDeleted && (await this.columnExists(baseTable, 'deleted_at'))) {
      q = q.whereNull(qualify('deleted_at'))
    }

    // Left join index for this entity and matching row scope (prefer per-row org/tenant)
    const joinOn: string[] = []
    joinOn.push(`ei.entity_type = ${knex.raw('?', [entity]).toString()}`)
    joinOn.push(`ei.entity_id = (${qualify('id')}::text)`)
    if (await this.columnExists(baseTable, 'organization_id')) joinOn.push(`(ei.organization_id is not distinct from ${qualify('organization_id')})`)
    if (await this.columnExists(baseTable, 'tenant_id')) joinOn.push(`(ei.tenant_id is not distinct from ${qualify('tenant_id')})`)
    if (!opts.withDeleted) joinOn.push(`ei.deleted_at is null`)
    q = q.leftJoin({ ei: 'entity_indexes' }, knex.raw(joinOn.join(' AND ')))

    const columns = await this.getBaseColumnsForEntity(entity)

    const resolveBaseColumn = (field: string): string | null => {
      if (columns.has(field)) return field
      if (field === 'organization_id' && columns.has('id')) return 'id'
      return null
    }

    // Base-field filters use real columns; cf:* use JSONB in index
    for (const f of arrayFilters) {
      if (f.field.startsWith('cf:')) {
        const key = f.field
        q = this.applyCfFilter(knex, q, key, f.op, f.value)
      } else {
        const baseField = resolveBaseColumn(String(f.field))
        if (!baseField) continue
        const col = qualify(baseField)
        switch (f.op) {
          case 'eq': q = q.where(col, f.value); break
          case 'ne': q = q.whereNot(col, f.value); break
          case 'gt': q = q.where(col, '>', f.value); break
          case 'gte': q = q.where(col, '>=', f.value); break
          case 'lt': q = q.where(col, '<', f.value); break
          case 'lte': q = q.where(col, '<=', f.value); break
          case 'in': {
            const values = this.toArray(f.value)
            q = q.whereIn(col, values)
            break
          }
          case 'nin': {
            const values = this.toArray(f.value)
            q = q.whereNotIn(col, values)
            break
          }
          case 'like': q = q.where(col, 'like', f.value); break
          case 'ilike': q = q.where(col, 'ilike', f.value); break
          case 'exists':
            if (f.value) {
              q = q.whereNotNull(col)
            } else {
              q = q.whereNull(col)
            }
            break
        }
      }
    }

    // Selection: base columns from base, cf:* from index JSONB
    const selectFields = (opts.fields && opts.fields.length) ? opts.fields : ['id']
    for (const field of selectFields) {
      if (String(field).startsWith('cf:')) {
        const alias = this.sanitize(String(field))
        const expr = this.jsonbRaw(knex, String(field))
        q = q.select(knex.raw(`${expr} as ??`, [alias]))
      } else {
        if (columns.has(String(field))) q = q.select(knex.raw('?? as ??', [qualify(String(field)), String(field)]))
      }
    }

    // Sorting: base via columns; cf:* via JSONB
    for (const s of (opts.sort || [])) {
      if (String(s.field).startsWith('cf:')) {
        const expr = this.cfTextExpr(knex, String(s.field))
        q = q.orderBy(expr, s.dir ?? SortDir.Asc)
      } else {
        const baseField = resolveBaseColumn(String(s.field))
        if (!baseField) continue
        q = q.orderBy(qualify(baseField), s.dir ?? SortDir.Asc)
      }
    }

    // Count and pagination (count base rows with current filters)
    const page = opts.page?.page ?? 1
    const pageSize = opts.page?.pageSize ?? 20
    const countQ = q.clone().clearSelect().clearOrder().countDistinct(qualify('id') + ' as count').first()
    const countRow = await countQ
    const total = this.parseCount(countRow)
    const items = await q.limit(pageSize).offset((page - 1) * pageSize)
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
  private jsonbExtractExprAlias(knex: Knex, alias: string, key: string, dataType?: string | null): Knex.Raw {
    const textExpr = key.startsWith('cf:')
      ? knex.raw(`coalesce((${alias}.doc ->> ?), (${alias}.doc ->> ?))`, [key, key.slice(3)]).toString()
      : knex.raw(`(${alias}.doc ->> ?)`, [key]).toString()
    switch ((dataType || '').toLowerCase()) {
      case 'uuid': return knex.raw(`${textExpr}::uuid`)
      case 'integer':
      case 'bigint':
      case 'smallint': return knex.raw(`${textExpr}::int`)
      case 'double precision':
      case 'real':
      case 'numeric': return knex.raw(`${textExpr}::double precision`)
      case 'boolean': return knex.raw(`${textExpr}::boolean`)
      case 'timestamp without time zone':
      case 'timestamp with time zone': return knex.raw(`${textExpr}::timestamptz`)
      default: return knex.raw(textExpr)
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

  private jsonbRaw(knex: Knex, key: string): string { return knex.raw(`ei.doc -> ?`, [key]).toString() }
  private cfTextExpr(knex: Knex, key: string): Knex.Raw { return knex.raw(`(ei.doc ->> ?)`, [key]) }

  private jsonbExtractExpr(knex: Knex, key: string, dataType?: string | null): Knex.Raw {
    // Prefer casting text to base type when known for comparators and sorting
    const textExpr = knex.raw(`(ei.doc ->> ?)`, [key]).toString()
    switch ((dataType || '').toLowerCase()) {
      case 'uuid': return knex.raw(`${textExpr}::uuid`)
      case 'integer':
      case 'bigint':
      case 'smallint': return knex.raw(`${textExpr}::int`)
      case 'double precision':
      case 'real':
      case 'numeric': return knex.raw(`${textExpr}::double precision`)
      case 'boolean': return knex.raw(`${textExpr}::boolean`)
      case 'timestamp without time zone':
      case 'timestamp with time zone': return knex.raw(`${textExpr}::timestamptz`)
      default:
        // For custom fields or unknown, use plain text comparison (works for LIKE/ILIKE/eq)
        return knex.raw(textExpr)
    }
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

  private applyCfFilter(
    knex: Knex,
    q: ResultBuilder,
    key: string,
    op: FilterOp,
    value: unknown
  ): ResultBuilder {
    const text = this.cfTextExpr(knex, key)
    const arrExpr = knex.raw(`(ei.doc -> ?)`, [key])
    const arrContains = (val: unknown) => knex.raw(`${arrExpr.toString()} @> ?::jsonb`, [JSON.stringify([val])])
    switch (op) {
      case 'eq':
        // Match scalar equality OR array membership
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
      case 'lte':
        // Numeric compares on scalar text cast; arrays are not supported here
        return q.where(text, op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : '<=', value as Knex.Value)
      default:
        return q
    }
  }
}
