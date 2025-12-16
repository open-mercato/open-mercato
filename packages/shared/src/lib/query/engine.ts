import type { QueryEngine, QueryOptions, QueryResult, QueryCustomFieldSource } from './types'
import type { EntityId } from '@/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import {
  applyJoinFilters,
  normalizeFilters,
  partitionFilters,
  resolveJoins,
  type BaseFilter,
  type NormalizedFilter,
  type ResolvedJoin,
} from './join-utils'
import { resolveSearchConfig } from '../search/config'
import { tokenizeText } from '../search/tokenize'

const entityTableCache = new Map<string, string>()

type EncryptionResolver = () => {
  decryptEntityPayload?: (entityId: EntityId, payload: Record<string, unknown>, tenantId?: string | null, organizationId?: string | null) => Promise<Record<string, unknown>>
  isEnabled?: () => boolean
} | null

type ResolvedCustomFieldSource = {
  entityId: EntityId
  alias: string
  table: string
  recordIdExpr: any
}

type ResultRow = Record<string, unknown>

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
  private tableCache = new Map<string, boolean>()
  private searchAliasSeq = 0

  constructor(
    private em: EntityManager,
    private getKnexFn?: () => any,
    private resolveEncryptionService?: EncryptionResolver,
  ) {}

  private getEncryptionService() {
    try {
      return this.resolveEncryptionService?.() ?? null
    } catch {
      return null
    }
  }

  async query<T = any>(entity: EntityId, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    // Heuristic: map '<module>:user' -> table 'users'
    const table = resolveEntityTableName(this.em, entity)
    const knex = this.getKnexFn ? this.getKnexFn() : (this.em as any).getConnection().getKnex()

    let q = knex(table)
    const qualify = (col: string) => `${table}.${col}`
    const orgScope = this.resolveOrganizationScope(opts)
    this.searchAliasSeq = 0
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

    const normalizedFilters = normalizeFilters(opts.filters)
    const resolvedJoins = resolveJoins(table, opts.joins, (entityId) => resolveEntityTableName(this.em, entityId as any))
    const joinMap = new Map<string, ResolvedJoin>()
    const aliasTables = new Map<string, string>()
    aliasTables.set(table, table)
    aliasTables.set('base', table)
    for (const join of resolvedJoins) {
      joinMap.set(join.alias, join)
      aliasTables.set(join.alias, join.table)
    }
    const { baseFilters, joinFilters } = partitionFilters(table, normalizedFilters, joinMap)
    const cfFilters = normalizedFilters.filter((filter) => String(filter.field).startsWith('cf:'))
    const searchConfig = resolveSearchConfig()
    const searchEnabled = searchConfig.enabled && await this.tableExists('search_tokens')
    const hasSearchTokens = searchEnabled
      ? await this.hasSearchTokens(String(entity), opts.tenantId ?? null, orgScope)
      : false
    const searchActive = searchEnabled && hasSearchTokens
    const searchFilters = [...baseFilters, ...cfFilters].filter((filter) => filter.op === 'like' || filter.op === 'ilike')
    if (searchFilters.length) {
      const fields = searchFilters.map((filter) => String(filter.field))
      this.logSearchDebug('search:init', {
        entity: String(entity),
        table,
        tenantId: opts.tenantId ?? null,
        organizationScope: orgScope,
        fields,
        searchEnabled,
        hasSearchTokens,
        searchActive,
        searchConfig: {
          enabled: searchConfig.enabled,
          minTokenLength: searchConfig.minTokenLength,
          enablePartials: searchConfig.enablePartials,
          hashAlgorithm: searchConfig.hashAlgorithm,
          blocklistedFields: searchConfig.blocklistedFields,
        },
      })
      if (!searchEnabled) {
        this.logSearchDebug('search:disabled', { entity: String(entity), table })
      } else if (!hasSearchTokens) {
        this.logSearchDebug('search:no-search-tokens', {
          entity: String(entity),
          table,
          tenantId: opts.tenantId ?? null,
          organizationScope: orgScope,
        })
      }
    }
    const recordIdColumn = qualify('id')

    const applyFilterOp = (builder: any, column: string, op: any, value: any, fieldName?: string) => {
      if (
        (op === 'like' || op === 'ilike') &&
        searchActive &&
        typeof value === 'string' &&
        fieldName
      ) {
        const tokens = tokenizeText(String(value), searchConfig)
        const hashes = tokens.hashes
        if (hashes.length) {
          const applied = this.applySearchTokens(builder, {
            entity: String(entity),
            field: fieldName,
            hashes,
            recordIdColumn,
            tenantId: opts.tenantId ?? null,
            organizationScope: orgScope,
            tokens: tokens.tokens,
          })
          this.logSearchDebug('search:filter', {
            entity: String(entity),
            field: fieldName,
            tokens: tokens.tokens,
            hashes,
            applied,
            tenantId: opts.tenantId ?? null,
            organizationScope: orgScope,
          })
          if (applied) return builder
        } else {
          this.logSearchDebug('search:skip-empty-hashes', {
            entity: String(entity),
            field: fieldName,
            value,
          })
        }
      }
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
        const column = await this.resolveBaseColumn(table, String(filter.field))
        if (!column) continue
        qualified = qualify(column)
      }
      applyFilterOp(q, qualified, filter.op, filter.value, String(filter.field))
    }

    const applyAliasScopes = async (builder: any, aliasName: string) => {
      const targetTable = aliasTables.get(aliasName)
      if (!targetTable) return
      if (orgScope && await this.columnExists(targetTable, 'organization_id')) {
        this.applyOrganizationScope(builder, `${aliasName}.organization_id`, orgScope)
      }
      if (opts.tenantId && await this.columnExists(targetTable, 'tenant_id')) {
        builder.where(`${aliasName}.tenant_id`, opts.tenantId)
      }
    }
    await applyJoinFilters({
      knex,
      baseTable: table,
      builder: q,
      joinMap,
      joinFilters,
      aliasTables,
      qualifyBase: (column) => qualify(column),
      applyAliasScope: (builder, alias) => applyAliasScopes(builder, alias),
      applyFilterOp,
      columnExists: (tbl, column) => this.columnExists(tbl, column),
    })
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
    for (const f of cfFilters) {
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
        type CustomFieldDefinitionRow = {
          key: string
          entityId: string
          kind: string
          config: Record<string, unknown>
        }
        const sorted: CustomFieldDefinitionRow[] = rows.map((row: any) => {
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
        sorted.sort((a: CustomFieldDefinitionRow, b: CustomFieldDefinitionRow) => {
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
    for (const f of cfFilters) {
      if (!f.field.startsWith('cf:')) continue
      const key = f.field.slice(3)
      const expr = cfValueExprByKey[key]
      if (!expr) continue
      if ((f.op === 'like' || f.op === 'ilike') && searchActive && typeof f.value === 'string') {
        const tokens = tokenizeText(String(f.value), searchConfig)
        const hashes = tokens.hashes
        if (hashes.length) {
          const applied = this.applySearchTokens(q, {
            entity: String(entity),
            field: f.field,
            hashes,
            recordIdColumn,
            tenantId: opts.tenantId ?? null,
            organizationScope: orgScope,
            tokens: tokens.tokens,
          })
          this.logSearchDebug('search:cf-filter', {
            entity: String(entity),
            field: f.field,
            tokens: tokens.tokens,
            hashes,
            applied,
            tenantId: opts.tenantId ?? null,
            organizationScope: orgScope,
          })
          if (applied) continue
        } else {
          this.logSearchDebug('search:cf-skip-empty-hashes', {
            entity: String(entity),
            field: f.field,
            value: f.value,
          })
        }
      }
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

    const svc = this.getEncryptionService()
    const decryptPayload: ((
      entityId: EntityId,
      payload: Record<string, unknown>,
      tenantId: string | null,
      organizationId: string | null,
    ) => Promise<Record<string, unknown>>) | null =
      svc?.decryptEntityPayload
        ? (entityId, payload, tenantId, organizationId) =>
            svc.decryptEntityPayload(entityId, payload, tenantId, organizationId)
        : null
    let decryptedItems = items
    if (decryptPayload) {
      const fallbackOrgId =
        opts.organizationId
        ?? (Array.isArray(opts.organizationIds) && opts.organizationIds.length === 1 ? opts.organizationIds[0] : null)
      decryptedItems = await Promise.all(
        (items as any[]).map(async (item) => {
          try {
            const decrypted = await decryptPayload(
              entity,
              item,
              item?.tenant_id ?? item?.tenantId ?? opts.tenantId ?? null,
              item?.organization_id ?? item?.organizationId ?? fallbackOrgId ?? null,
            )
            return { ...item, ...decrypted }
          } catch (err) {
            console.error('QueryEngine: error decrypting entity payload', err);
            return item
          }
        })
      )
    }

    return { items: decryptedItems, page, pageSize, total }
  }

  private async resolveBaseColumn(table: string, field: string): Promise<string | null> {
    if (await this.columnExists(table, field)) return field
    if (field === 'organization_id' && await this.columnExists(table, 'id')) return 'id'
    return null
  }

  private async columnExists(table: string, column: string): Promise<boolean> {
    const key = `${table}.${column}`
    if (this.columnCache.has(key)) {
      const cached = this.columnCache.get(key)
      if (cached === true) return true
      this.columnCache.delete(key)
    }
    const knex = this.getKnexFn ? this.getKnexFn() : (this.em as any).getConnection().getKnex()
    const exists = await knex('information_schema.columns')
      .where({ table_name: table, column_name: column })
      .first()
    const present = !!exists
    if (present) this.columnCache.set(key, true)
    else this.columnCache.delete(key)
    return present
  }

  private async tableExists(table: string): Promise<boolean> {
    if (this.tableCache.has(table)) return this.tableCache.get(table) ?? false
    const knex = this.getKnexFn ? this.getKnexFn() : (this.em as any).getConnection().getKnex()
    const exists = await knex('information_schema.tables')
      .where({ table_name: table })
      .first()
    const present = !!exists
    this.tableCache.set(table, present)
    return present
  }

  private async hasSearchTokens(
    entity: string,
    tenantId: string | null,
    orgScope?: { ids: string[]; includeNull: boolean } | null
  ): Promise<boolean> {
    try {
      const knex = this.getKnexFn ? this.getKnexFn() : (this.em as any).getConnection().getKnex()
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

  private applySearchTokens<TRecord extends ResultRow, TResult>(
    q: Knex.QueryBuilder<TRecord, TResult>,
    opts: {
      entity: string
      field: string
      hashes: string[]
      recordIdColumn: string
      tenantId?: string | null
      organizationScope?: { ids: string[]; includeNull: boolean } | null
      combineWith?: 'and' | 'or'
      tokens?: string[]
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
      tokens: opts.tokens,
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

  private logSearchDebug(event: string, payload: Record<string, unknown>) {
    try {
      console.info('[query:search]', event, JSON.stringify(payload))
    } catch {
      console.info('[query:search]', event, payload)
    }
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
