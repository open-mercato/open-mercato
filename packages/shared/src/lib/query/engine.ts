import type { QueryEngine, QueryOptions, QueryResult } from './types'
import type { EntityId } from '@/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'


// Minimal default implementation placeholder.
// For now, only supports basic base-entity querying by table name inferred from EntityId ('<module>:<entity>' -> '<entities>') via convention.
// Extensions and custom fields will be added iteratively.

export class BasicQueryEngine implements QueryEngine {
  private columnCache = new Map<string, boolean>()

  constructor(private em: EntityManager, private getKnexFn?: () => any) {}

  async query<T = any>(entity: EntityId, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    // Heuristic: map '<module>:user' -> table 'users'
    const [, name] = entity.split(':')
    const table = name.endsWith('s') ? name : `${name}s`
    const knex = this.getKnexFn ? this.getKnexFn() : (this.em as any).getConnection().getKnex()

    let q = knex(table)
    const qualify = (col: string) => `${table}.${col}`
    const orgScope = this.resolveOrganizationScope(opts)
    // Require tenant scope for all queries
    if (!opts.tenantId) {
      throw new Error(
        'QueryEngine: tenantId is now required for all queries (breaking change). ' +
        'Please provide a tenantId in QueryOptions, e.g., query(entity, { tenantId: ... }). ' +
        'See migration guide or documentation for details.'
      )
    }
    // Optional organization filter (when present in schema)
    if (orgScope && await this.columnExists(table, 'organization_id')) {
      q = this.applyOrganizationScope(q, qualify('organization_id'), orgScope)
    }
    // Tenant guard (required) when present in schema
    if (await this.columnExists(table, 'tenant_id')) {
      q = q.where(qualify('tenant_id'), opts.tenantId)
    }
    // Default soft-delete guard: exclude rows with deleted_at when column exists
    if (!opts.withDeleted && await this.columnExists(table, 'deleted_at')) {
      q = q.whereNull(qualify('deleted_at'))
    }

    // Normalize filters: accept array or Mongo-style object
    const arrayFilters = this.normalizeFilters(opts.filters)

    // Filters (base fields handled here; cf:* handled later)
    for (const f of arrayFilters) {
      if (f.field.startsWith('cf:')) continue
      const column = await this.resolveBaseColumn(table, f.field)
      if (!column) continue
      const qualified = qualify(column)
      switch (f.op) {
        case 'eq': q = q.where(qualified, f.value); break
        case 'ne': q = q.whereNot(qualified, f.value); break
        case 'gt': q = q.where(qualified, '>', f.value); break
        case 'gte': q = q.where(qualified, '>=', f.value); break
        case 'lt': q = q.where(qualified, '<', f.value); break
        case 'lte': q = q.where(qualified, '<=', f.value); break
        case 'in': q = q.whereIn(qualified, f.value ?? []); break
        case 'nin': q = q.whereNotIn(qualified, f.value ?? []); break
        case 'like': q = q.where(qualified, 'like', f.value); break
        case 'ilike': q = q.where(qualified, 'ilike', f.value); break
        case 'exists': f.value ? q = q.whereNotNull(qualified) : q = q.whereNull(qualified); break
      }
    }
    // Selection (base columns only here; cf:* handled later)
    if (opts.fields && opts.fields.length) {
      const cols = opts.fields.filter((f) => !f.startsWith('cf:'))
      if (cols.length) {
        // Qualify and alias to base names to avoid ambiguity
        const baseSelects = cols.map((c) => knex.raw('?? as ??', [qualify(c), c]))
        q = q.select(baseSelects)
      }
    } else {
      // Default to selecting only base table columns to avoid ambiguity when joining
      q = q.select(knex.raw('??.*', [table]))
    }

    // Resolve which custom fields to include
    const entityId = entity
    const tenantId = opts.tenantId
    // const orgId = opts.organizationId // reserved for future organization-level scoping
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_')
    const baseIdExpr = knex.raw('??::text', [`${table}.id`])
    const cfKeys = new Set<string>()
    // Explicit in fields/filters
    for (const f of (opts.fields || [])) if (typeof f === 'string' && f.startsWith('cf:')) cfKeys.add(f.slice(3))
    for (const f of arrayFilters) if (typeof f.field === 'string' && f.field.startsWith('cf:')) cfKeys.add(f.field.slice(3))
    // includeCustomFields: boolean | string[]
    if (opts.includeCustomFields === true) {
      // Read all defs for this entity tenant (tenant-scoped only)
      const rows = await knex('custom_field_defs')
        .select('key')
        .where({ entity_id: entityId, is_active: true })
        .modify((qb: any) => {
          qb.andWhere((inner: any) => {
            inner.where({ tenant_id: tenantId }).orWhereNull('tenant_id')
          })
          // NOTE: organization-level scoping intentionally disabled for custom fields
          // if (orgId != null) inner.andWhere((b: any) => b.where({ organization_id: orgId }).orWhereNull('organization_id'))
        })
      for (const r of rows) cfKeys.add(r.key)
    } else if (Array.isArray(opts.includeCustomFields)) {
      for (const k of opts.includeCustomFields) cfKeys.add(k)
    }

    // Custom fields: project requested cf:* keys and apply cf filters
    const cfValueExprByKey: Record<string, any> = {}
    const cfSelectedAliases: string[] = []
    for (const key of cfKeys) {
      const defAlias = `cfd_${sanitize(key)}`
      const valAlias = `cfv_${sanitize(key)}`
      // Join definitions for kind resolution
      q = q.leftJoin({ [defAlias]: 'custom_field_defs' }, function (this: any) {
        this.on(`${defAlias}.entity_id`, '=', knex.raw('?', [entityId]))
          .andOn(`${defAlias}.key`, '=', knex.raw('?', [key]))
          .andOn(`${defAlias}.is_active`, '=', knex.raw('true'))
          .andOn(knex.raw(`(${defAlias}.tenant_id = ? OR ${defAlias}.tenant_id IS NULL)`, [tenantId]))
        // NOTE: organization-level scoping intentionally disabled for custom fields
        // this.andOn(function (this: any) {
        //   this.on(`${defAlias}.organization_id`, '=', knex.raw('?', [orgId]))
        //       .orOn(knex.raw('?? is null', [`${defAlias}.organization_id`]))
        // })
      })
      // Join values with record match
      q = q.leftJoin({ [valAlias]: 'custom_field_values' }, function (this: any) {
        this.on(`${valAlias}.entity_id`, '=', knex.raw('?', [entityId]))
          .andOn(`${valAlias}.field_key`, '=', knex.raw('?', [key]))
          .andOn(`${valAlias}.record_id`, '=', baseIdExpr)
          .andOn(knex.raw(`(${valAlias}.tenant_id = ? OR ${valAlias}.tenant_id IS NULL)`, [tenantId]))
        // NOTE: organization-level scoping intentionally disabled for custom fields
        // if (orgId != null) this.andOn(`${valAlias}.organization_id`, '=', knex.raw('?', [orgId]))
      })
      // Force a common SQL type across branches to avoid Postgres CASE type conflicts
      const caseExpr = knex.raw(
        `CASE ${defAlias}.kind
           WHEN 'integer' THEN (${valAlias}.value_int)::text
           WHEN 'float' THEN (${valAlias}.value_float)::text
           WHEN 'boolean' THEN (${valAlias}.value_bool)::text
           WHEN 'multiline' THEN (${valAlias}.value_multiline)::text
           ELSE (${valAlias}.value_text)::text
         END`
      )
      cfValueExprByKey[key] = caseExpr
      const alias = sanitize(`cf:${key}`)
      // Project as aggregated to avoid duplicates when multi values exist
      if ((opts.fields || []).includes(`cf:${key}`) || opts.includeCustomFields === true || (Array.isArray(opts.includeCustomFields) && opts.includeCustomFields.includes(key))) {
        // Use bool_or over config_json->>multi so it's valid under GROUP BY
        const isMulti = knex.raw(`bool_or(coalesce((${defAlias}.config_json->>'multi')::boolean, false))`)
        const expr = `CASE WHEN ${isMulti.toString()}
                THEN array_remove(array_agg(DISTINCT ${caseExpr.toString()}), NULL)
                ELSE max(${caseExpr.toString()})
           END`
        // Multi-value fields stay as arrays; single-value fields collapse to their scalar
        q = q.select(knex.raw(`${expr} as ??`, [alias]))
        cfSelectedAliases.push(alias)
      }
    }

    // Apply cf:* filters (on raw expressions)
    for (const f of arrayFilters) {
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

    // Entity extensions joins (no selection yet; enables future filters/projections)
    if (opts.includeExtensions) {
      const allMods = (await import('@/generated/modules.generated')).modules as any[]
      const allExts = allMods.flatMap((m) => (m as any).entityExtensions || [])
      const exts = allExts.filter((e: any) => e.base === entity)
      const chosen = Array.isArray(opts.includeExtensions)
        ? exts.filter((e: any) => (opts.includeExtensions as string[]).includes(e.extension))
        : exts
      for (const e of chosen) {
        const [, extName] = (e.extension as string).split(':')
        const extTable = extName.endsWith('s') ? extName : `${extName}s`
        const alias = `ext_${sanitize(extName)}`
        q = q.leftJoin({ [alias]: extTable }, function (this: any) {
          this.on(`${alias}.${e.join.extensionKey}`, '=', knex.raw('??', [`${table}.${e.join.baseKey}`]))
        })
      }
    }

    // Sorting: base fields and cf:* (use aggregated alias for cf)
    for (const s of opts.sort || []) {
      if (s.field.startsWith('cf:')) {
        const key = s.field.slice(3)
        const alias = sanitize(`cf:${key}`)
        // Ensure included in projection to sort by
        if (!cfSelectedAliases.includes(alias)) {
          const expr = cfValueExprByKey[key]
          if (expr) {
            q = q.select(knex.raw(`max(${expr.toString()}) as ??`, [alias]))
            cfSelectedAliases.push(alias)
          }
        }
        q = q.orderBy(alias, s.dir ?? 'asc')
      } else {
        const column = await this.resolveBaseColumn(table, s.field)
        if (!column) continue
        q = q.orderBy(qualify(column), s.dir ?? 'asc')
      }
    }

    // Pagination
    const page = opts.page?.page ?? 1
    const pageSize = opts.page?.pageSize ?? 20
    // Deduplicate if we joined CFs or extensions by grouping on base id
    if ((opts.includeExtensions && (Array.isArray(opts.includeExtensions) ? (opts.includeExtensions.length > 0) : true)) || Object.keys(cfValueExprByKey).length > 0) {
      q = q.groupBy(`${table}.id`)
    }
    const countClone: any = q.clone()
    if (typeof countClone.clearSelect === 'function') countClone.clearSelect()
    if (typeof countClone.clearOrder === 'function') countClone.clearOrder()
    if (typeof countClone.clearGroup === 'function') countClone.clearGroup()
    const countRow = await countClone
      .countDistinct(`${table}.id as count`)
      .first()
    const total = Number((countRow as any)?.count ?? 0)
    const items = await q.limit(pageSize).offset((page - 1) * pageSize)
    return { items, page, pageSize, total }
  }

  private async resolveBaseColumn(table: string, field: string): Promise<string | null> {
    if (await this.columnExists(table, field)) return field
    if (field === 'organization_id' && await this.columnExists(table, 'id')) return 'id'
    return null
  }

  private async columnExists(table: string, column: string): Promise<boolean> {
    const key = `${table}.${column}`
    if (this.columnCache.has(key)) return this.columnCache.get(key)!
    const knex = this.getKnexFn ? this.getKnexFn() : (this.em as any).getConnection().getKnex()
    const exists = await knex('information_schema.columns')
      .where({ table_name: table, column_name: column })
      .first()
    const present = !!exists
    this.columnCache.set(key, present)
    return present
  }

  private resolveOrganizationScope(opts: QueryOptions): { ids: string[]; includeNull: boolean } | null {
    if (opts.organizationIds !== undefined) {
      const raw = (opts.organizationIds ?? []).map((id) => (typeof id === 'string' ? id.trim() : id))
      const includeNull = raw.some((id) => id == null || id === '')
      const ids = raw.filter((id): id is string => typeof id === 'string' && id.length > 0)
      return { ids: Array.from(new Set(ids)), includeNull }
    }
    if (typeof opts.organizationId === 'string' && opts.organizationId.trim().length > 0) {
      return { ids: [opts.organizationId], includeNull: false }
    }
    return null
  }

  private applyOrganizationScope(q: any, column: string, scope: { ids: string[]; includeNull: boolean }): any {
    if (!scope) return q
    if (scope.ids.length === 0 && !scope.includeNull) {
      return q.whereRaw('1 = 0')
    }
    return q.where((builder: any) => {
      let applied = false
      if (scope.ids.length > 0) {
        builder.whereIn(column as any, scope.ids)
        applied = true
      }
      if (scope.includeNull) {
        if (applied) builder.orWhereNull(column)
        else builder.whereNull(column)
        applied = true
      }
      if (!applied) builder.whereRaw('1 = 0')
    })
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
}
