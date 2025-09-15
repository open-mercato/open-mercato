import type { QueryEngine, QueryOptions, QueryResult } from './types'
import type { EntityId } from '@/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'

// Minimal default implementation placeholder.
// For now, only supports basic base-entity querying by table name inferred from EntityId ('<module>:<entity>' -> '<entities>') via convention.
// Extensions and custom fields will be added iteratively.

export class BasicQueryEngine implements QueryEngine {
  constructor(private em: EntityManager) {}

  async query<T = any>(entity: EntityId, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    // Heuristic: map '<module>:user' -> table 'users'
    const [, name] = entity.split(':')
    const table = name.endsWith('s') ? name : `${name}s`
    const knex = (this.em as any).getConnection().getKnex()

    let q = knex(table)
    // Multi-tenant guard when present in schema
    if (opts.organizationId) {
      if (await this.columnExists(table, 'organization_id')) {
        q = q.where('organization_id', opts.organizationId)
      }
    }
    // Filters (base fields only for now; custom fields and extensions handled later)
    for (const f of opts.filters || []) {
      const col = f.field.startsWith('cf:') ? null : f.field
      if (!col) continue
      switch (f.op) {
        case 'eq': q = q.where(col, f.value); break
        case 'ne': q = q.whereNot(col, f.value); break
        case 'gt': q = q.where(col, '>', f.value); break
        case 'gte': q = q.where(col, '>=', f.value); break
        case 'lt': q = q.where(col, '<', f.value); break
        case 'lte': q = q.where(col, '<=', f.value); break
        case 'in': q = q.whereIn(col, f.value ?? []); break
        case 'nin': q = q.whereNotIn(col, f.value ?? []); break
        case 'like': q = q.where(col, 'like', f.value); break
        case 'ilike': q = q.where(col, 'ilike', f.value); break
        case 'exists': f.value ? q = q.whereNotNull(col) : q = q.whereNull(col); break
      }
    }
    // Sorting
    for (const s of opts.sort || []) {
      const col = s.field.startsWith('cf:') ? null : s.field
      if (!col) continue
      q = q.orderBy(col, s.dir ?? 'asc')
    }
    // Selection
    if (opts.fields && opts.fields.length) {
      const cols = opts.fields.filter((f) => !f.startsWith('cf:'))
      if (cols.length) q = q.select(cols as any)
    }
    // Pagination
    const page = opts.page?.page ?? 1
    const pageSize = opts.page?.pageSize ?? 20
    const [{ count }] = await q.clone().count<{ count: string }[]>({ c: '*' })
    const items = await q.limit(pageSize).offset((page - 1) * pageSize)
    return { items, page, pageSize, total: Number(count) }
  }

  private async columnExists(table: string, column: string): Promise<boolean> {
    const knex = (this.em as any).getConnection().getKnex()
    const exists = await knex('information_schema.columns')
      .where({ table_name: table, column_name: column })
      .first()
    return !!exists
  }
}

