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
    // Filters (base fields handled here; cf:* handled later)
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
    // Custom fields: project requested cf:* keys and apply cf filters
    const cfKeys = new Set<string>()
    for (const f of opts.fields || []) if (typeof f === 'string' && f.startsWith('cf:')) cfKeys.add(f.slice(3))
    for (const f of opts.filters || []) if (typeof f.field === 'string' && f.field.startsWith('cf:')) cfKeys.add(f.field.slice(3))
    const entityId = entity
    const orgId = opts.organizationId
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_')
    const knex = (this.em as any).getConnection().getKnex()
    const baseIdExpr = knex.raw('??::text', [`${table}.id`])
    const cfValueExprByKey: Record<string, any> = {}
    for (const key of cfKeys) {
      const defAlias = `cfd_${sanitize(key)}`
      const valAlias = `cfv_${sanitize(key)}`
      // Join definitions for kind resolution
      q = q.leftJoin({ [defAlias]: 'custom_field_defs' }, function () {
        this.on(`${defAlias}.entity_id`, '=', knex.raw('?', [entityId]))
          .andOn(`${defAlias}.key`, '=', knex.raw('?', [key]))
          .andOn(`${defAlias}.is_active`, '=', knex.raw('true'))
        if (orgId != null) this.andOn(`${defAlias}.organization_id`, '=', knex.raw('?', [orgId]))
      })
      // Join values with record match
      q = q.leftJoin({ [valAlias]: 'custom_field_values' }, function () {
        this.on(`${valAlias}.entity_id`, '=', knex.raw('?', [entityId]))
          .andOn(`${valAlias}.field_key`, '=', knex.raw('?', [key]))
          .andOn(`${valAlias}.record_id`, '=', baseIdExpr)
        if (orgId != null) this.andOn(`${valAlias}.organization_id`, '=', knex.raw('?', [orgId]))
      })
      // CASE expression to surface typed value as a single column
      const valueExpr = knex.raw(
        `CASE ${defAlias}.kind
           WHEN 'integer' THEN ${valAlias}.value_int
           WHEN 'float' THEN ${valAlias}.value_float
           WHEN 'boolean' THEN ${valAlias}.value_bool
           WHEN 'multiline' THEN ${valAlias}.value_multiline
           ELSE ${valAlias}.value_text
         END`
      )
      cfValueExprByKey[key] = valueExpr
      // Select if requested in fields
      if ((opts.fields || []).some((f) => f === `cf:${key}`)) {
        q = q.select({ [sanitize(`cf:${key}`)]: valueExpr })
      }
    }
    // Apply cf:* filters
    for (const f of opts.filters || []) {
      if (!f.field.startsWith('cf:')) continue
      const key = f.field.slice(3)
      const expr = cfValueExprByKey[key]
      if (!expr) continue
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
