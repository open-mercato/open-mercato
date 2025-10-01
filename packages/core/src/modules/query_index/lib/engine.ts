import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'

export class HybridQueryEngine implements QueryEngine {
  constructor(private em: EntityManager, private fallback: BasicQueryEngine) {}

  async query<T = any>(entity: EntityId, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    // Base table first; left-join index for cf:* only
    const knex = (this.em as any).getConnection().getKnex()
    const [, name] = entity.split(':')
    const baseTable = name.endsWith('s') ? name : `${name}s`

    // Fallback when base table is missing
    const baseExists = await this.tableExists(baseTable)
    if (!baseExists) return this.fallback.query(entity, opts)

    // Heuristic: if query needs cf:* but index is not fully populated for this scope, fall back
    const arrayFilters = this.normalizeFilters(opts.filters)
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
        } catch (_) {
          console.warn('[HybridQueryEngine] Partial index coverage detected; falling back to basic engine:', { entity })
        }
        return this.fallback.query(entity, opts)
      }
    }

    const qualify = (col: string) => `b.${col}`
    let q = knex({ b: baseTable })

    // Multi-tenant guard on base
    if (opts.organizationId && (await this.columnExists(baseTable, 'organization_id'))) {
      q = q.where(qualify('organization_id'), opts.organizationId)
    }
    if (opts.tenantId && (await this.columnExists(baseTable, 'tenant_id'))) {
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

    // Base-field filters use real columns; cf:* use JSONB in index
    for (const f of arrayFilters) {
      if (f.field.startsWith('cf:')) {
        const key = f.field
        q = this.applyCfFilter(knex, q, key, f.op, f.value)
      } else {
        const col = qualify(f.field)
        switch (f.op) {
          case 'eq': q = q.where(col, f.value); break
          case 'ne': q = q.whereNot(col, f.value); break
          case 'gt': q = q.where(col, '>', f.value); break
          case 'gte': q = q.where(col, '>=', f.value); break
          case 'lt': q = q.where(col, '<', f.value); break
          case 'lte': q = q.where(col, '<=', f.value); break
          case 'in': q = q.whereIn(col as any, f.value ?? []); break
          case 'nin': q = q.whereNotIn(col as any, f.value ?? []); break
          case 'like': q = q.where(col, 'like', f.value); break
          case 'ilike': q = q.where(col, 'ilike', f.value); break
          case 'exists': f.value ? q = q.whereNotNull(col) : q = q.whereNull(col); break
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
        q = q.orderBy(qualify(String(s.field)), s.dir ?? SortDir.Asc)
      }
    }

    // Count and pagination (count base rows with current filters)
    const page = opts.page?.page ?? 1
    const pageSize = opts.page?.pageSize ?? 20
    const countQ = q.clone().clearSelect().clearOrder().countDistinct<{ count: string }>(qualify('id') + ' as count').first()
    const countRow = await countQ
    const total = Number((countRow as any)?.count ?? 0)
    const items = await q.limit(pageSize).offset((page - 1) * pageSize)
    return { items, page, pageSize, total }
  }

  private async tableExists(table: string): Promise<boolean> {
    const knex = (this.em as any).getConnection().getKnex()
    const exists = await knex('information_schema.tables').where({ table_name: table }).first()
    return !!exists
  }

  private async indexAnyRows(entity: string): Promise<boolean> {
    const knex = (this.em as any).getConnection().getKnex()
    const exists = await knex('entity_indexes').where({ entity_type: entity }).first()
    return !!exists
  }

  private async indexCoverageComplete(entity: string, baseTable: string, opts: QueryOptions): Promise<boolean> {
    const { baseCount, indexedCount } = await this.indexCoverageStats(entity, baseTable, opts)
    if (baseCount === 0) return true
    return indexedCount >= baseCount
  }

  private async indexCoverageStats(entity: string, baseTable: string, opts: QueryOptions): Promise<{ baseCount: number; indexedCount: number }> {
    const knex = (this.em as any).getConnection().getKnex()

    // Base count within scope (org/tenant/soft-delete)
    let bq = knex({ b: baseTable }).clearSelect().clearOrder()
    if (opts.organizationId && (await this.columnExists(baseTable, 'organization_id'))) {
      bq = bq.where('b.organization_id', opts.organizationId)
    }
    if (opts.tenantId && (await this.columnExists(baseTable, 'tenant_id'))) {
      bq = bq.where('b.tenant_id', opts.tenantId)
    }
    if (!opts.withDeleted && (await this.columnExists(baseTable, 'deleted_at'))) {
      bq = bq.whereNull('b.deleted_at')
    }
    const baseRow = await bq.countDistinct<{ count: string }>('b.id as count').first()
    const baseCount = Number((baseRow as any)?.count ?? 0)

    // Index count within same scope
    let iq = knex({ ei: 'entity_indexes' }).clearSelect().clearOrder().where('ei.entity_type', entity)
    if (!opts.withDeleted) iq = iq.whereNull('ei.deleted_at')
    if (opts.organizationId) iq = iq.where('ei.organization_id', opts.organizationId)
    if (opts.tenantId) iq = iq.where('ei.tenant_id', opts.tenantId)
    const idxRow = await iq.countDistinct<{ count: string }>('ei.entity_id as count').first()
    const indexedCount = Number((idxRow as any)?.count ?? 0)

    return { baseCount, indexedCount }
  }

  private async columnExists(table: string, column: string): Promise<boolean> {
    const knex = (this.em as any).getConnection().getKnex()
    const exists = await knex('information_schema.columns')
      .where({ table_name: table, column_name: column })
      .first()
    return !!exists
  }

  private async getBaseColumnsForEntity(entity: string): Promise<Map<string, string>> {
    const knex = (this.em as any).getConnection().getKnex()
    const [, name] = entity.split(':')
    const table = name.endsWith('s') ? name : `${name}s`
    const rows = await knex('information_schema.columns')
      .select('column_name', 'data_type')
      .where({ table_name: table })
    const map = new Map<string, string>()
    for (const r of rows) map.set(r.column_name, r.data_type)
    return map
  }

  private jsonbRaw(knex: any, key: string): string { return knex.raw(`ei.doc -> ?`, [key]).toString() }
  private cfTextExpr(knex: any, key: string): any { return knex.raw(`(ei.doc ->> ?)`, [key]) }

  private jsonbExtractExpr(knex: any, key: string, dataType?: string | null): any {
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

  private normalizeFilters(filters?: QueryOptions['filters']): { field: string; op: any; value?: any }[] {
    if (!filters) return []
    const normalizeField = (k: string) => k.startsWith('cf_') ? `cf:${k.slice(3)}` : k
    if (Array.isArray(filters)) return (filters as any[]).map((f) => ({ ...f, field: normalizeField(String((f as any).field)) }))
    const out: { field: string; op: any; value?: any }[] = []
    const obj = filters as Record<string, any>
    const add = (field: string, op: any, value?: any) => out.push({ field, op, value })
    for (const [rawKey, rawVal] of Object.entries(obj)) {
      const field = normalizeField(rawKey)
      if (rawVal !== null && typeof rawVal === 'object' && !Array.isArray(rawVal)) {
        for (const [opKey, opVal] of Object.entries(rawVal)) {
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

  private applyCfFilter(knex: any, q: any, key: string, op: any, value: any) {
    const text = this.cfTextExpr(knex, key)
    const arrExpr = knex.raw(`(ei.doc -> ?)`, [key])
    const arrContains = (val: any) => knex.raw(`${arrExpr.toString()} @> ?::jsonb`, [JSON.stringify([val])])
    switch (op) {
      case 'eq':
        // Match scalar equality OR array membership
        return q.where((b: any) => b.orWhere(text, '=', value).orWhere(arrContains(value)))
      case 'ne':
        return q.whereNot(text, '=', value)
      case 'in':
        return q.where((b: any) => {
          const vals = Array.isArray(value) ? value : [value]
          for (const v of vals) b.orWhere(text, '=', v).orWhere(arrContains(v))
        })
      case 'nin':
        return q.whereNotIn(text as any, (Array.isArray(value) ? value : [value]))
      case 'like':
        return q.where(text, 'like', value)
      case 'ilike':
        return q.where(text, 'ilike', value)
      case 'exists':
        return value ? q.whereNotNull(text) : q.whereNull(text)
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        // Numeric compares on scalar text cast; arrays are not supported here
        return q.where(text, op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : '<=', value)
      default:
        return q
    }
  }
}
