import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'

export class HybridQueryEngine implements QueryEngine {
  constructor(private em: EntityManager, private fallback: BasicQueryEngine) {}

  async query<T = any>(entity: EntityId, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    if (!(await this.indexAvailable(entity))) {
      return this.fallback.query(entity, opts)
    }
    const knex = (this.em as any).getConnection().getKnex()
    const table = 'entity_indexes'
    let q = knex({ ei: table }).where('ei.entity_type', entity)

    // Multi-tenant guard
    if (opts.organizationId) q = q.andWhere('ei.organization_id', opts.organizationId)
    if (opts.tenantId) q = q.andWhere('ei.tenant_id', opts.tenantId)
    if (!opts.withDeleted) q = q.whereNull('ei.deleted_at')

    const columns = await this.getBaseColumnsForEntity(entity)
    const arrayFilters = this.normalizeFilters(opts.filters)

    // Where conditions for base and cf paths via JSONB
    for (const f of arrayFilters) {
      const isCf = f.field.startsWith('cf:')
      const key = f.field
      const colType = isCf ? null : columns.get(key)
      const expr = this.jsonbExtractExpr(knex, key, colType)
      switch (f.op) {
        case 'eq': q = q.where(expr, '=', f.value); break
        case 'ne': q = q.where(expr, '!=', f.value); break
        case 'gt': q = q.where(expr, '>', f.value); break
        case 'gte': q = q.where(expr, '>=', f.value); break
        case 'lt': q = q.where(expr, '<', f.value); break
        case 'lte': q = q.where(expr, '<=', f.value); break
        case 'in': q = q.whereIn(expr as any, f.value ?? []); break
        case 'nin': q = q.whereNotIn(expr as any, f.value ?? []); break
        case 'like': q = q.where(expr, 'like', f.value); break
        case 'ilike': q = q.where(expr, 'ilike', f.value); break
        case 'exists': f.value ? q = q.whereNotNull(expr) : q = q.whereNull(expr); break
      }
    }

    // Select projections
    const selectFields = (opts.fields && opts.fields.length) ? opts.fields : ['id']
    for (const field of selectFields) {
      if (String(field).startsWith('cf:')) {
        const alias = this.sanitize(String(field))
        const expr = this.jsonbRaw(knex, String(field))
        q = q.select(knex.raw(`${expr} as ??`, [alias]))
      } else {
        const colType = columns.get(String(field))
        const expr = this.jsonbExtractExpr(knex, String(field), colType)
        q = q.select(knex.raw(`${expr} as ??`, [String(field)]))
      }
    }

    // Sorting
    for (const s of (opts.sort || [])) {
      const colType = columns.get(String(s.field))
      const expr = this.jsonbExtractExpr(knex, String(s.field), colType)
      q = q.orderBy(expr, s.dir ?? SortDir.Asc)
    }

    // Count and pagination
    const page = opts.page?.page ?? 1
    const pageSize = opts.page?.pageSize ?? 20
    const countQ = q.clone().clearSelect().clearOrder().count<{ count: string }>('ei.id as count').first()
    const countRow = await countQ
    const total = Number((countRow as any)?.count ?? 0)
    const items = await q.limit(pageSize).offset((page - 1) * pageSize)
    return { items, page, pageSize, total }
  }

  private async indexAvailable(entity: string): Promise<boolean> {
    const knex = (this.em as any).getConnection().getKnex()
    const exists = await knex('information_schema.tables')
      .where({ table_name: 'entity_indexes' })
      .first()
    if (!exists) return false
    const anyRow = await knex('entity_indexes').where({ entity_type: entity }).first()
    return !!anyRow
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

  private jsonbRaw(knex: any, key: string): string {
    return knex.raw(`ei.doc -> ?`, [key]).toString()
  }

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
}

