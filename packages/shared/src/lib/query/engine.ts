import type { QueryEngine, QueryOptions, QueryResult, QueryCustomFieldSource, QueryJoinEdge } from './types'
import type { EntityId } from '@/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'

const entityTableCache = new Map<string, string>()

type ResolvedCustomFieldSource = {
  entityId: EntityId
  alias: string
  table: string
  recordIdExpr: any
}

type ResolvedJoin = {
  alias: string
  table: string
  fromAlias: string
  fromField: string
  toField: string
  type: 'left' | 'inner'
}

const pluralizeBaseName = (name: string): string => {
  if (!name) return name
  if (name.endsWith('s')) return name
  if (name.endsWith('y')) return `${name.slice(0, -1)}ies`
  return `${name}s`
}

const toPascalCase = (value: string): string => {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('')
}

const candidateClassNames = (rawName: string): string[] => {
  const base = toPascalCase(rawName)
  const candidates = new Set<string>()
  if (base) candidates.add(base)
  if (base && !base.endsWith('Entity')) candidates.add(`${base}Entity`)
  return Array.from(candidates)
}

export function resolveEntityTableName(em: EntityManager | undefined, entity: EntityId): string {
  if (entityTableCache.has(entity)) return entityTableCache.get(entity)!
  const parts = String(entity || '').split(':')
  const rawName = (parts[1] && parts[1].trim().length > 0) ? parts[1] : (parts[0] || '').trim()
  const metadata = (em as any)?.getMetadata?.()

  if (metadata && rawName) {
    for (const candidate of candidateClassNames(rawName)) {
      try {
        const meta = metadata.find?.(candidate)
        if (meta?.tableName) {
          const tableName = String(meta.tableName)
          entityTableCache.set(entity, tableName)
          return tableName
        }
      } catch {}
    }
  }

  const fallback = pluralizeBaseName(rawName || '')
  entityTableCache.set(entity, fallback)
  return fallback
}


// Minimal default implementation placeholder.
// For now, only supports basic base-entity querying by table name inferred from EntityId ('<module>:<entity>' -> '<entities>') via convention.
// Extensions and custom fields will be added iteratively.

export class BasicQueryEngine implements QueryEngine {
  private columnCache = new Map<string, boolean>()

  constructor(private em: EntityManager, private getKnexFn?: () => any) {}

  async query<T = any>(entity: EntityId, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    // Heuristic: map '<module>:user' -> table 'users'
    const table = resolveEntityTableName(this.em, entity)
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

    const resolvedJoins = this.resolveJoins(table, opts.joins)
    const joinMap = new Map<string, ResolvedJoin>()
    const aliasTables = new Map<string, string>()
    aliasTables.set(table, table)
    aliasTables.set('base', table)
    for (const join of resolvedJoins) {
      joinMap.set(join.alias, join)
      aliasTables.set(join.alias, join.table)
    }

    // Normalize filters: accept array or Mongo-style object
    const arrayFilters = this.normalizeFilters(opts.filters)

    type BaseFilter = { field: string; op: any; value?: any; qualified?: string }
    type AliasFilter = { alias: string; column: string; op: any; value?: any }
    const baseFilters: BaseFilter[] = []
    const joinFilters = new Map<string, AliasFilter[]>()

    for (const f of arrayFilters) {
      if (f.field.startsWith('cf:')) continue
      const parts = f.field.split('.')
      if (parts.length === 2) {
        const [aliasNameRaw, column] = parts
        const aliasName = aliasNameRaw || ''
        if (joinMap.has(aliasName)) {
          const list = joinFilters.get(aliasName) ?? []
          list.push({ alias: aliasName, column, op: f.op, value: f.value })
          joinFilters.set(aliasName, list)
          continue
        }
        if (aliasName === table || aliasName === 'base') {
          baseFilters.push({ field: column, op: f.op, value: f.value, qualified: `${table}.${column}` })
          continue
        }
      }
      baseFilters.push({ field: f.field, op: f.op, value: f.value })
    }

    const applyFilterOp = (builder: any, column: string, op: any, value: any) => {
      switch (op) {
        case 'eq': builder.where(column, value); break
        case 'ne': builder.whereNot(column, value); break
        case 'gt': builder.where(column, '>', value); break
        case 'gte': builder.where(column, '>=', value); break
        case 'lt': builder.where(column, '<', value); break
        case 'lte': builder.where(column, '<=', value); break
        case 'in': builder.whereIn(column, Array.isArray(value) ? value : [value]); break
        case 'nin': builder.whereNotIn(column, Array.isArray(value) ? value : [value]); break
        case 'like': builder.where(column, 'like', value); break
        case 'ilike': builder.where(column, 'ilike', value); break
        case 'exists': value ? builder.whereNotNull(column) : builder.whereNull(column); break
        default: break
      }
      return builder
    }

    for (const filter of baseFilters) {
      let qualified = filter.qualified ?? null
      if (!qualified) {
        const column = await this.resolveBaseColumn(table, filter.field)
        if (!column) continue
        qualified = qualify(column)
      }
      applyFilterOp(q, qualified, filter.op, filter.value)
    }

    const resolveAliasName = (aliasName?: string | null) => {
      if (!aliasName || aliasName === 'base') return table
      return aliasName
    }

    const applyAliasScopes = async (builder: any, aliasName: string) => {
      const tableName = aliasTables.get(aliasName)
      if (!tableName) return
      if (orgScope && await this.columnExists(tableName, 'organization_id')) {
        this.applyOrganizationScope(builder, `${aliasName}.organization_id`, orgScope)
      }
      if (opts.tenantId && await this.columnExists(tableName, 'tenant_id')) {
        builder.where(`${aliasName}.tenant_id`, opts.tenantId)
      }
    }

    for (const [alias, filtersForAlias] of joinFilters.entries()) {
      const chain = this.buildJoinChain(alias, joinMap, table)
      if (!chain.length) continue
      const first = chain[0]
      const sub = knex({ [first.alias]: first.table }).select(1)
      await applyAliasScopes(sub, first.alias)
      const parentAlias = resolveAliasName(first.fromAlias)
      if (parentAlias === table) {
        sub.whereRaw('?? = ??', [`${first.alias}.${first.toField}`, qualify(first.fromField)])
      } else {
        sub.whereRaw('?? = ??', [`${first.alias}.${first.toField}`, `${parentAlias}.${first.fromField}`])
      }
      for (const cfg of chain.slice(1)) {
        const joinArgs = { [cfg.alias]: cfg.table }
        const parent = resolveAliasName(cfg.fromAlias)
        const joinFn = function (this: any) {
          if (parent === table) {
            this.on(`${cfg.alias}.${cfg.toField}`, '=', knex.raw('??', [qualify(cfg.fromField)]))
          } else {
            this.on(`${cfg.alias}.${cfg.toField}`, '=', knex.raw('??', [`${parent}.${cfg.fromField}`]))
          }
        }
        if (cfg.type === 'inner') sub.join(joinArgs, joinFn)
        else sub.leftJoin(joinArgs, joinFn)
        await applyAliasScopes(sub, cfg.alias)
      }
      let existsDirective: boolean | null = null
      for (const filter of filtersForAlias) {
        if (filter.op === 'exists') {
          if (filter.value === false) existsDirective = false
          else if (existsDirective === null) existsDirective = true
          continue
        }
        const targetTable = aliasTables.get(filter.alias)
        if (!targetTable) continue
        if (!await this.columnExists(targetTable, filter.column)) continue
        const qualified = `${filter.alias}.${filter.column}`
        applyFilterOp(sub, qualified, filter.op, filter.value)
      }
      if (existsDirective === false) q = q.whereNotExists(sub)
      else q = q.whereExists(sub)
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
    const tenantId = opts.tenantId
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_')
    const cfSources = this.configureCustomFieldSources(q, table, entity, knex, opts, qualify)
    const entityIdToSource = new Map<string, ResolvedCustomFieldSource>()
    for (const source of cfSources) {
      entityIdToSource.set(String(source.entityId), source)
    }
    const requestedCustomFieldKeys = Array.isArray(opts.includeCustomFields)
      ? opts.includeCustomFields.map((key) => String(key))
      : []
    const cfKeys = new Set<string>()
    const keySource = new Map<string, ResolvedCustomFieldSource>()
    // Explicit in fields/filters
    for (const f of (opts.fields || [])) {
      if (typeof f === 'string' && f.startsWith('cf:')) cfKeys.add(f.slice(3))
    }
    for (const f of arrayFilters) {
      if (typeof f.field === 'string' && f.field.startsWith('cf:')) cfKeys.add(f.field.slice(3))
    }
    if (opts.includeCustomFields === true) {
      if (entityIdToSource.size > 0) {
        const entityIdList = Array.from(entityIdToSource.keys())
        const entityOrder = new Map<string, number>()
        entityIdList.forEach((id, idx) => entityOrder.set(id, idx))
        const rows = await knex('custom_field_defs')
          .select('key', 'entity_id', 'config_json', 'kind')
          .whereIn('entity_id', entityIdList)
          .andWhere('is_active', true)
          .modify((qb: any) => {
            qb.andWhere((inner: any) => {
              inner.where({ tenant_id: tenantId }).orWhereNull('tenant_id')
            })
          })
        const sorted = rows.map((row: any) => {
          const raw = row.config_json
          let cfg: Record<string, any> = {}
          if (raw && typeof raw === 'string') {
            try { cfg = JSON.parse(raw) } catch { cfg = {} }
          } else if (raw && typeof raw === 'object') {
            cfg = raw
          }
          return {
            key: String(row.key),
            entityId: String(row.entity_id),
            kind: String(row.kind || ''),
            config: cfg,
          }
        })
        sorted.sort((a, b) => {
          const ai = entityOrder.get(a.entityId) ?? Number.MAX_SAFE_INTEGER
          const bi = entityOrder.get(b.entityId) ?? Number.MAX_SAFE_INTEGER
          if (ai !== bi) return ai - bi
          return a.key.localeCompare(b.key)
        })
        const selectedSources = new Map<string, { source: ResolvedCustomFieldSource; score: number; penalty: number; entityIndex: number }>()
        for (const row of sorted) {
          const source = entityIdToSource.get(row.entityId)
          if (!source) continue
          const cfg = row.config || {}
          const entityIndex = entityOrder.get(row.entityId) ?? Number.MAX_SAFE_INTEGER
          const scores = computeScore(cfg, row.kind, entityIndex)
          const existing = selectedSources.get(row.key)
          if (!existing || scores.base > existing.score || (scores.base === existing.score && (scores.penalty < existing.penalty || (scores.penalty === existing.penalty && scores.entityIndex < existing.entityIndex)))) {
            selectedSources.set(row.key, { source, score: scores.base, penalty: scores.penalty, entityIndex: scores.entityIndex })
          }
          cfKeys.add(row.key)
        }
        for (const [key, entry] of selectedSources.entries()) {
          keySource.set(key, entry.source)
        }
      }
    } else if (requestedCustomFieldKeys.length > 0) {
      for (const key of requestedCustomFieldKeys) cfKeys.add(key)
    }
    const unresolvedKeys = Array.from(cfKeys).filter((key) => !keySource.has(key))
    if (unresolvedKeys.length > 0 && entityIdToSource.size > 0) {
      const rows = await knex('custom_field_defs')
        .select('key', 'entity_id')
        .whereIn('entity_id', Array.from(entityIdToSource.keys()))
        .whereIn('key', unresolvedKeys)
        .andWhere('is_active', true)
        .modify((qb: any) => {
          qb.andWhere((inner: any) => {
            inner.where({ tenant_id: tenantId }).orWhereNull('tenant_id')
          })
        })
      for (const row of rows) {
        const source = entityIdToSource.get(String(row.entity_id))
        if (!source) continue
        if (!keySource.has(row.key)) keySource.set(row.key, source)
      }
    }

    const cfValueExprByKey: Record<string, any> = {}
    const cfSelectedAliases: string[] = []
    const cfJsonAliases = new Set<string>()
    const cfMultiAliasByAlias = new Map<string, string>()
    for (const key of cfKeys) {
      const source = keySource.get(key)
      if (!source) continue
      const entityIdForKey = source.entityId
      const recordIdExpr = source.recordIdExpr
      const sourceAliasSafe = sanitize(source.alias || 'src')
      const keyAliasSafe = sanitize(key)
      const defAlias = `cfd_${sourceAliasSafe}_${keyAliasSafe}`
      const valAlias = `cfv_${sourceAliasSafe}_${keyAliasSafe}`
      // Join definitions for kind resolution
      q = q.leftJoin({ [defAlias]: 'custom_field_defs' }, function (this: any) {
        this.on(`${defAlias}.entity_id`, '=', knex.raw('?', [entityIdForKey]))
          .andOn(`${defAlias}.key`, '=', knex.raw('?', [key]))
          .andOn(`${defAlias}.is_active`, '=', knex.raw('true'))
          .andOn(knex.raw(`(${defAlias}.tenant_id = ? OR ${defAlias}.tenant_id IS NULL)`, [tenantId]))
      })
      // Join values with record match
      q = q.leftJoin({ [valAlias]: 'custom_field_values' }, function (this: any) {
        this.on(`${valAlias}.entity_id`, '=', knex.raw('?', [entityIdForKey]))
          .andOn(`${valAlias}.field_key`, '=', knex.raw('?', [key]))
          .andOn(`${valAlias}.record_id`, '=', recordIdExpr)
          .andOn(knex.raw(`(${valAlias}.tenant_id = ? OR ${valAlias}.tenant_id IS NULL)`, [tenantId]))
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
      if ((opts.fields || []).includes(`cf:${key}`) || opts.includeCustomFields === true || (requestedCustomFieldKeys.length > 0 && requestedCustomFieldKeys.includes(key))) {
        // Use bool_or over config_json->>multi so it's valid under GROUP BY
        const isMulti = knex.raw(`bool_or(coalesce((${defAlias}.config_json->>'multi')::boolean, false))`)
        const aggregatedArray = `array_remove(array_agg(DISTINCT ${caseExpr.toString()}), NULL)`
        const expr = `CASE WHEN ${isMulti.toString()}
                THEN to_jsonb(${aggregatedArray})
                ELSE to_jsonb(max(${caseExpr.toString()}))
           END`
        const multiAlias = `${alias}__is_multi`
        q = q.select(knex.raw(`${expr} as ??`, [alias]))
        q = q.select(knex.raw(`${isMulti.toString()} as ??`, [multiAlias]))
        cfSelectedAliases.push(alias)
        cfJsonAliases.add(alias)
        cfMultiAliasByAlias.set(alias, multiAlias)
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

    if (cfJsonAliases.size > 0) {
      for (const row of items as any[]) {
        for (const alias of cfJsonAliases) {
          const multiAlias = cfMultiAliasByAlias.get(alias)
          const isMulti = multiAlias ? Boolean(row[multiAlias]) : false
          let raw = row[alias]
          if (typeof raw === 'string') {
            try { raw = JSON.parse(raw) } catch { /* ignore malformed json */ }
          }
          if (isMulti) {
            if (raw == null) row[alias] = []
            else if (Array.isArray(raw)) row[alias] = raw
            else row[alias] = [raw]
          } else {
            if (Array.isArray(raw)) row[alias] = raw.length > 0 ? raw[0] : null
            else row[alias] = raw
          }
          if (multiAlias) delete row[multiAlias]
        }
      }
    }

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

  private configureCustomFieldSources(
    q: any,
    baseTable: string,
    baseEntity: EntityId,
    knex: any,
    opts: QueryOptions,
    qualify: (column: string) => string
  ): ResolvedCustomFieldSource[] {
    const sources: ResolvedCustomFieldSource[] = [
      {
        entityId: baseEntity,
        alias: 'base',
        table: baseTable,
        recordIdExpr: knex.raw('??::text', [`${baseTable}.id`]),
      },
    ]
    const extras: QueryCustomFieldSource[] = opts.customFieldSources ?? []
    extras.forEach((srcOpt, index) => {
      const joinTable = srcOpt.table ?? resolveEntityTableName(this.em, srcOpt.entityId)
      const alias = srcOpt.alias ?? `cfs_${index}`
      const join = srcOpt.join
      if (!join) {
        throw new Error(`QueryEngine: customFieldSources entry for ${String(srcOpt.entityId)} requires a join configuration`)
      }
      const joinArgs = { [alias]: joinTable }
      const joinCallback = function (this: any) {
        this.on(`${alias}.${join.toField}`, '=', qualify(join.fromField))
      }
      const joinType = join.type ?? 'left'
      if (joinType === 'inner') q.join(joinArgs, joinCallback)
      else q.leftJoin(joinArgs, joinCallback)
      const recordColumn = srcOpt.recordIdColumn ?? 'id'
      sources.push({
        entityId: srcOpt.entityId,
        alias,
        table: joinTable,
        recordIdExpr: knex.raw('??::text', [`${alias}.${recordColumn}`]),
      })
    })
    return sources
  }

  private resolveJoins(baseTable: string, joins?: QueryJoinEdge[] | null): ResolvedJoin[] {
    if (!joins || joins.length === 0) return []
    const resolved: ResolvedJoin[] = []
    const seen = new Set<string>()
    for (const entry of joins) {
      if (!entry || typeof entry !== 'object') continue
      const alias = typeof entry.alias === 'string' ? entry.alias.trim() : ''
      if (!alias) continue
      if (seen.has(alias)) continue
      const table = entry.table ?? (entry.entityId ? resolveEntityTableName(this.em, entry.entityId) : null)
      if (!table) continue
      const fromField = entry.from?.field?.trim()
      const toField = entry.to?.field?.trim()
      if (!fromField || !toField) continue
      const fromAliasRaw = entry.from?.alias?.trim()
      const fromAlias = fromAliasRaw && fromAliasRaw.length > 0 ? fromAliasRaw : 'base'
      const type: 'left' | 'inner' = entry.type === 'left' ? 'left' : 'inner'
      resolved.push({ alias, table, fromAlias, fromField, toField, type })
      seen.add(alias)
    }
    return resolved
  }

  private buildJoinChain(alias: string, joinMap: Map<string, ResolvedJoin>, baseTable: string, visited: Set<string> = new Set()): ResolvedJoin[] {
    if (visited.has(alias)) {
      throw new Error(`QueryEngine: circular join reference detected for alias ${alias}`)
    }
    const cfg = joinMap.get(alias)
    if (!cfg) return []
    visited.add(alias)
    if (!cfg.fromAlias || cfg.fromAlias === 'base' || cfg.fromAlias === baseTable) {
      return [cfg]
    }
    const parentChain = this.buildJoinChain(cfg.fromAlias, joinMap, baseTable, visited)
    if (parentChain.length === 0) return []
    return [...parentChain, cfg]
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
    const computeScore = (cfg: Record<string, unknown>, kind: string, entityIndex: number) => {
      const listVisibleScore = cfg.listVisible === false ? 0 : 1
      const formEditableScore = cfg.formEditable === false ? 0 : 1
      const filterableScore = cfg.filterable ? 1 : 0
      const kindScore = (() => {
        switch (kind) {
          case 'dictionary':
            return 8
          case 'relation':
            return 6
          case 'select':
            return 4
          case 'multiline':
            return 3
          case 'boolean':
          case 'integer':
          case 'float':
            return 2
          default:
            return 1
        }
      })()
      const optionsBonus = Array.isArray(cfg.options) && cfg.options.length ? 2 : 0
      const dictionaryBonus = typeof cfg.dictionaryId === 'string' && cfg.dictionaryId.trim().length ? 5 : 0
      const base = (listVisibleScore * 16) + (formEditableScore * 8) + (filterableScore * 4) + kindScore + optionsBonus + dictionaryBonus
      const penalty = typeof cfg.priority === 'number' ? cfg.priority : 0
      return { base, penalty, entityIndex }
    }
