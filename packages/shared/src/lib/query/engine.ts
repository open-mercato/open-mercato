import type { QueryEngine, QueryOptions, QueryResult, QueryCustomFieldSource, QueryExtensionsConfig } from './types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql, type RawBuilder } from 'kysely'
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
import { runBeforeQueryPipeline, runAfterQueryPipeline, type QueryExtensionContext } from './query-extension-runner'

type AnyDb = Kysely<any>
type AnyBuilder = any

const entityTableCache = new Map<string, string>()

type EncryptionResolver = () => {
  decryptEntityPayload?: (entityId: EntityId, payload: Record<string, unknown>, tenantId?: string | null, organizationId?: string | null) => Promise<Record<string, unknown>>
  isEnabled?: () => boolean
} | null

type ResolvedCustomFieldSource = {
  entityId: EntityId
  alias: string
  table: string
  recordIdExpr: RawBuilder<string>
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
  if (entityTableCache.has(entity)) {
    return entityTableCache.get(entity)!
  }
  const parts = String(entity || '').split(':')
  const rawName = (parts[1] && parts[1].trim().length > 0) ? parts[1] : (parts[0] || '').trim()
  const metadata = (em as any)?.getMetadata?.()

  if (metadata && rawName) {
    const candidates = candidateClassNames(rawName)
    for (const candidate of candidates) {
      try {
        const meta = metadata.find?.(candidate)
        if (meta?.tableName) {
          const tableName = String(meta.tableName)
          entityTableCache.set(entity, tableName)
          return tableName
        }
      } catch {}
    }

    // Secondary lookup: search ORM metadata by candidate table names
    const modulePrefix = parts[0] ?? ''
    const candidateTables = [
      `${modulePrefix}_${rawName}`,
      pluralizeBaseName(rawName),
      `${modulePrefix}_${pluralizeBaseName(rawName)}`,
    ]
    try {
      const allMeta: any[] = metadata.getAll?.() ?? []
      for (const meta of allMeta) {
        if (meta?.tableName && candidateTables.includes(String(meta.tableName))) {
          const tableName = String(meta.tableName)
          entityTableCache.set(entity, tableName)
          return tableName
        }
      }
    } catch {}
  }

  const fallback = pluralizeBaseName(rawName || '')
  console.warn(
    `[QueryEngine] Could not resolve entity "${entity}" via ORM metadata. ` +
    `Falling back to table name "${fallback}". ` +
    `Ensure the entity ID segment matches the class name convention.`
  )
  entityTableCache.set(entity, fallback)
  return fallback
}

function buildFilterableCustomFieldJoins(
  sources: QueryCustomFieldSource[] | undefined,
): Array<{
  alias: string
  table?: string
  entityId: EntityId
  from: { field: string }
  to: { field: string }
  type: 'left' | 'inner'
}> {
  if (!sources || sources.length === 0) return []
  return sources.flatMap((source, index) => {
    if (!source.join) return []
    const alias = typeof source.alias === 'string' && source.alias.trim().length > 0
      ? source.alias.trim()
      : `cfs_${index}`
    return [{
      alias,
      table: source.table,
      entityId: source.entityId,
      from: { field: source.join.fromField },
      to: { field: source.join.toField },
      type: source.join.type === 'inner' ? 'inner' : 'left',
    }]
  })
}

function computeCustomFieldScore(cfg: Record<string, unknown>, kind: string, entityIndex: number) {
  const listVisibleScore = cfg.listVisible === false ? 0 : 1
  const formEditableScore = cfg.formEditable === false ? 0 : 1
  const filterableScore = cfg.filterable ? 1 : 0
  const kindScore = (() => {
    switch (kind) {
      case 'dictionary': return 8
      case 'relation': return 6
      case 'select': return 4
      case 'multiline': return 3
      case 'boolean':
      case 'integer':
      case 'float': return 2
      default: return 1
    }
  })()
  const optionsBonus = Array.isArray(cfg.options) && cfg.options.length ? 2 : 0
  const dictionaryBonus = typeof cfg.dictionaryId === 'string' && (cfg.dictionaryId as string).trim().length ? 5 : 0
  const base = (listVisibleScore * 16) + (formEditableScore * 8) + (filterableScore * 4) + kindScore + optionsBonus + dictionaryBonus
  const penalty = typeof cfg.priority === 'number' ? cfg.priority : 0
  return { base, penalty, entityIndex }
}

/**
 * BasicQueryEngine — Kysely-backed fallback query engine.
 *
 * Resolves base tables via MikroORM metadata, applies tenant/organization/
 * deleted_at scoping, handles custom field (cf:*) selection and filtering,
 * and performs entity-extension joins. Used as the fallback for
 * {@link HybridQueryEngine} when the query index is unavailable or incomplete.
 */
export class BasicQueryEngine implements QueryEngine {
  private columnCache = new Map<string, boolean>()
  private tableCache = new Map<string, boolean>()
  private searchAliasSeq = 0

  constructor(
    private em: EntityManager,
    private getDbFn?: () => AnyDb,
    private resolveEncryptionService?: EncryptionResolver,
  ) {}

  private getEncryptionService() {
    try {
      return this.resolveEncryptionService?.() ?? null
    } catch {
      return null
    }
  }

  private getDb(): AnyDb {
    if (this.getDbFn) return this.getDbFn()
    const emAny = this.em as any
    if (typeof emAny?.getKysely === 'function') return emAny.getKysely() as AnyDb
    throw new Error('BasicQueryEngine requires an EntityManager exposing getKysely() (MikroORM v7)')
  }

  async query<T = any>(entity: EntityId, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    // --- UMES query extension: before-query pipeline ---
    const ext = opts.extensions
    let effectiveOpts = opts
    let extensionCtx: QueryExtensionContext | null = null
    const noop = { resolve: <R = unknown>(_name: string): R => { throw new Error('No DI context') } }

    if (ext) {
      extensionCtx = {
        entity: String(entity),
        engine: 'basic',
        tenantId: opts.tenantId ?? '',
        organizationId: opts.organizationId,
        userId: ext.userId,
        em: this.em,
        container: ext.container,
        userFeatures: ext.userFeatures,
      }
      const diCtx = ext.resolve ? { resolve: ext.resolve } : noop
      const beforeResult = await runBeforeQueryPipeline(opts, extensionCtx, diCtx)
      if (beforeResult.blocked) {
        throw new Error(beforeResult.errorMessage ?? 'Query blocked by extension subscriber')
      }
      effectiveOpts = beforeResult.query
    }
    // Strip extensions from effectiveOpts so they don't propagate to sub-queries
    const { extensions: _ext, ...coreOpts } = effectiveOpts
    opts = coreOpts

    // Heuristic: map '<module>:user' -> table 'users'
    const table = resolveEntityTableName(this.em, entity)
    const db = this.getDb()

    let q: AnyBuilder = db.selectFrom(table as any)
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
    const skipAutoScope = opts.omitAutomaticTenantOrgScope === true
    // Optional organization filter (when present in schema)
    if (!skipAutoScope && orgScope && await this.columnExists(table, 'organization_id')) {
      q = this.applyOrganizationScope(q, qualify('organization_id'), orgScope)
    }
    // Tenant guard (required) when present in schema
    if (!skipAutoScope && await this.columnExists(table, 'tenant_id')) {
      q = q.where(qualify('tenant_id'), '=', opts.tenantId)
    }
    // Default soft-delete guard: exclude rows with deleted_at when column exists
    if (!opts.withDeleted && await this.columnExists(table, 'deleted_at')) {
      q = q.where(qualify('deleted_at'), 'is', null)
    }

    const normalizedFilters = normalizeFilters(opts.filters)
    const resolvedJoins = resolveJoins(
      table,
      [...(opts.joins ?? []), ...buildFilterableCustomFieldJoins(opts.customFieldSources)],
      (entityId) => resolveEntityTableName(this.em, entityId as any),
    )
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
    const joinSearchAvailability = new Map<string, boolean>()
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

    const applyFilterOp = (builder: AnyBuilder, column: string | RawBuilder<unknown>, op: string, value: unknown, fieldName?: string): AnyBuilder => {
      if (
        (op === 'like' || op === 'ilike') &&
        searchActive &&
        typeof value === 'string' &&
        fieldName &&
        typeof column === 'string'
      ) {
        const tokens = tokenizeText(String(value), searchConfig)
        const hashes = tokens.hashes
        if (hashes.length) {
          const result = this.applySearchTokens(builder, {
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
            applied: result.applied,
            tenantId: opts.tenantId ?? null,
            organizationScope: orgScope,
          })
          if (result.applied) return result.builder
        } else {
          this.logSearchDebug('search:skip-empty-hashes', {
            entity: String(entity),
            field: fieldName,
            value,
          })
        }
      }
      return this.applyColumnOp(builder, column, op, value)
    }

    const applyJoinFilterOp = async (
      builder: AnyBuilder,
      filter: { column: string; op: string; value?: unknown },
      _qualified: string,
      join: ResolvedJoin,
    ): Promise<{ applied: boolean; builder: AnyBuilder }> => {
      if (!searchEnabled || !join.entityId) return { applied: false, builder }
      if (!['like', 'ilike'].includes(filter.op)) return { applied: false, builder }
      if (typeof filter.value !== 'string' || filter.value.trim().length === 0) return { applied: false, builder }

      let searchAvailable = joinSearchAvailability.get(join.entityId)
      if (searchAvailable === undefined) {
        searchAvailable = await this.hasSearchTokens(join.entityId, opts.tenantId ?? null, orgScope)
        joinSearchAvailability.set(join.entityId, searchAvailable)
      }
      if (!searchAvailable) return { applied: false, builder }

      const tokens = tokenizeText(String(filter.value), searchConfig)
      if (!tokens.hashes.length) return { applied: false, builder }

      const result = this.applySearchTokens(builder, {
        entity: join.entityId,
        field: filter.column,
        hashes: tokens.hashes,
        recordIdColumn: `${join.alias}.id`,
        tenantId: opts.tenantId ?? null,
        organizationScope: orgScope,
        tokens: tokens.tokens,
      })
      return { applied: result.applied, builder: result.builder }
    }

    const regularBaseFilters = baseFilters.filter((f) => !f.orGroup)
    const orGroupFilters = baseFilters.filter((f) => f.orGroup)

    for (const filter of regularBaseFilters) {
      const fieldName = String(filter.field)
      let qualified = filter.qualified ?? null
      if (!qualified) {
        const column = await this.resolveBaseColumn(table, fieldName)
        if (!column) {
          q = this.applyIndexDocFilter(q, {
            entity: String(entity),
            field: fieldName,
            op: filter.op,
            value: filter.value,
            recordIdColumn,
            tenantId: opts.tenantId ?? null,
            organizationScope: orgScope,
            withDeleted: opts.withDeleted === true,
            searchActive,
            searchConfig,
          })
          continue
        }
        qualified = qualify(column)
      }
      q = applyFilterOp(q, qualified, filter.op, filter.value, fieldName)
    }

    // OR-grouped filters: AND within each group (one $or disjunct), OR between groups.
    if (orGroupFilters.length > 0) {
      const groups = new Map<string, typeof orGroupFilters>()
      for (const f of orGroupFilters) {
        const group = groups.get(f.orGroup!) ?? []
        group.push(f)
        groups.set(f.orGroup!, group)
      }
      const resolvedGroupFilters: Array<Array<{ qualified: string; op: string; value: unknown; fieldName: string }>> = []
      for (const [, groupFilters] of groups) {
        const resolved: Array<{ qualified: string; op: string; value: unknown; fieldName: string }> = []
        for (const filter of groupFilters) {
          const column = await this.resolveBaseColumn(table, String(filter.field))
          if (column) {
            resolved.push({
              qualified: qualify(column),
              op: filter.op,
              value: filter.value,
              fieldName: String(filter.field),
            })
          }
        }
        if (resolved.length > 0) resolvedGroupFilters.push(resolved)
      }
      if (resolvedGroupFilters.length > 0) {
        q = q.where((eb: any) => eb.or(
          resolvedGroupFilters.map((group) => eb.and(
            group.map((rf) => this.buildColumnOpExpression(eb, rf.qualified, rf.op, rf.value))
          ))
        ))
      }
    }

    const applyAliasScopes = async (builder: AnyBuilder, aliasName: string): Promise<AnyBuilder> => {
      const targetTable = aliasTables.get(aliasName)
      if (!targetTable) return builder
      let next = builder
      if (!skipAutoScope && orgScope && await this.columnExists(targetTable, 'organization_id')) {
        next = this.applyOrganizationScope(next, `${aliasName}.organization_id`, orgScope)
      }
      if (!skipAutoScope && opts.tenantId && await this.columnExists(targetTable, 'tenant_id')) {
        next = next.where(`${aliasName}.tenant_id`, '=', opts.tenantId)
      }
      return next
    }
    q = await applyJoinFilters({
      db,
      baseTable: table,
      builder: q,
      joinMap,
      joinFilters,
      aliasTables,
      qualifyBase: (column) => qualify(column),
      applyAliasScope: (builder, alias) => applyAliasScopes(builder, alias),
      applyFilterOp: (builder, column, op, value) => applyFilterOp(builder, column, op, value),
      applyJoinFilterOp,
      columnExists: (tbl, column) => this.columnExists(tbl, column),
    })
    // Selection (base columns only here; cf:* handled later)
    if (opts.fields && opts.fields.length) {
      const cols = opts.fields.filter((f) => !f.startsWith('cf:'))
      for (const c of cols) {
        // Qualify and alias to base names to avoid ambiguity
        q = q.select(sql.ref(qualify(c)).as(c))
      }
    } else {
      // Default to selecting only base table columns to avoid ambiguity when joining
      q = q.select(sql`${sql.ref(table)}.*`.as('__all'))
    }

    // Resolve which custom fields to include
    const tenantId = opts.tenantId
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_')
    const cfSourcesResult = this.configureCustomFieldSources(q, table, entity, db, opts, qualify)
    q = cfSourcesResult.builder
    const cfSources = cfSourcesResult.sources
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
        const rows = await db
          .selectFrom('custom_field_defs' as any)
          .select(['key' as any, 'entity_id' as any, 'config_json' as any, 'kind' as any])
          .where('entity_id' as any, 'in', entityIdList)
          .where('is_active' as any, '=', true)
          .where((eb: any) => eb.or([
            eb('tenant_id' as any, '=', tenantId),
            eb('tenant_id' as any, 'is', null),
          ]))
          .execute() as Array<{ key: string; entity_id: string; config_json: unknown; kind: string }>
        type CustomFieldDefinitionRow = {
          key: string
          entityId: string
          kind: string
          config: Record<string, unknown>
        }
        const sorted: CustomFieldDefinitionRow[] = rows.map((row) => {
          const raw = row.config_json
          let cfg: Record<string, any> = {}
          if (raw && typeof raw === 'string') {
            try { cfg = JSON.parse(raw) } catch { cfg = {} }
          } else if (raw && typeof raw === 'object') {
            cfg = raw as Record<string, any>
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
          const scores = computeCustomFieldScore(cfg, row.kind, entityIndex)
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
      const rows = await db
        .selectFrom('custom_field_defs' as any)
        .select(['key' as any, 'entity_id' as any])
        .where('entity_id' as any, 'in', Array.from(entityIdToSource.keys()))
        .where('key' as any, 'in', unresolvedKeys)
        .where('is_active' as any, '=', true)
        .where((eb: any) => eb.or([
          eb('tenant_id' as any, '=', tenantId),
          eb('tenant_id' as any, 'is', null),
        ]))
        .execute() as Array<{ key: string; entity_id: string }>
      for (const row of rows) {
        const source = entityIdToSource.get(String(row.entity_id))
        if (!source) continue
        if (!keySource.has(row.key)) keySource.set(row.key, source)
      }
    }

    const cfValueExprByKey: Record<string, RawBuilder<string | null>> = {}
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
      q = q.leftJoin(`custom_field_defs as ${defAlias}` as any, (jb: any) =>
        jb.on(`${defAlias}.entity_id`, '=', String(entityIdForKey))
          .on(`${defAlias}.key`, '=', key)
          .on(`${defAlias}.is_active`, '=', true)
          .on((eb: any) => eb.or([
            eb(`${defAlias}.tenant_id`, '=', tenantId),
            eb(`${defAlias}.tenant_id`, 'is', null),
          ]))
      )
      // Join values with record match
      q = q.leftJoin(`custom_field_values as ${valAlias}` as any, (jb: any) =>
        jb.on(`${valAlias}.entity_id`, '=', String(entityIdForKey))
          .on(`${valAlias}.field_key`, '=', key)
          .onRef(`${valAlias}.record_id`, '=', recordIdExpr as any)
          .on((eb: any) => eb.or([
            eb(`${valAlias}.tenant_id`, '=', tenantId),
            eb(`${valAlias}.tenant_id`, 'is', null),
          ]))
      )
      // Force a common SQL type across branches to avoid Postgres CASE type conflicts
      const caseExpr = sql<string | null>`CASE ${sql.ref(`${defAlias}.kind`)}
           WHEN 'integer' THEN (${sql.ref(`${valAlias}.value_int`)})::text
           WHEN 'float' THEN (${sql.ref(`${valAlias}.value_float`)})::text
           WHEN 'boolean' THEN (${sql.ref(`${valAlias}.value_bool`)})::text
           WHEN 'multiline' THEN (${sql.ref(`${valAlias}.value_multiline`)})::text
           ELSE (${sql.ref(`${valAlias}.value_text`)})::text
         END`
      cfValueExprByKey[key] = caseExpr
      const alias = sanitize(`cf:${key}`)
      // Project as aggregated to avoid duplicates when multi values exist
      if ((opts.fields || []).includes(`cf:${key}`) || opts.includeCustomFields === true || (requestedCustomFieldKeys.length > 0 && requestedCustomFieldKeys.includes(key))) {
        const multiAlias = `${alias}__is_multi`
        const isMultiExpr = sql<boolean>`bool_or(coalesce((${sql.ref(`${defAlias}.config_json`)}->>'multi')::boolean, false))`
        const aggregatedArray = sql<unknown>`array_remove(array_agg(DISTINCT ${caseExpr}), NULL)`
        const projExpr = sql<unknown>`CASE WHEN ${isMultiExpr}
                THEN to_jsonb(${aggregatedArray})
                ELSE to_jsonb(max(${caseExpr}))
           END`
        q = q.select(projExpr.as(alias))
        q = q.select(isMultiExpr.as(multiAlias))
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
          const result = this.applySearchTokens(q, {
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
            applied: result.applied,
            tenantId: opts.tenantId ?? null,
            organizationScope: orgScope,
          })
          if (result.applied) {
            q = result.builder
            continue
          }
        } else {
          this.logSearchDebug('search:cf-skip-empty-hashes', {
            entity: String(entity),
            field: f.field,
            value: f.value,
          })
        }
      }
      q = this.applyColumnOp(q, expr, f.op, f.value)
    }

    // Entity extensions joins (no selection yet; enables future filters/projections)
    if (opts.includeExtensions) {
      const { getModules } = await import('@open-mercato/shared/lib/i18n/server')
      const allMods = getModules() as any[]
      const allExts = allMods.flatMap((m) => (m as any).entityExtensions || [])
      const exts = allExts.filter((e: any) => e.base === entity)
      const chosen = Array.isArray(opts.includeExtensions)
        ? exts.filter((e: any) => (opts.includeExtensions as string[]).includes(e.extension))
        : exts
      for (const e of chosen) {
        const [, extName] = (e.extension as string).split(':')
        const extTable = extName.endsWith('s') ? extName : `${extName}s`
        const alias = `ext_${sanitize(extName)}`
        q = q.leftJoin(`${extTable} as ${alias}` as any, (jb: any) =>
          jb.onRef(`${alias}.${e.join.extensionKey}`, '=', `${table}.${e.join.baseKey}`)
        )
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
            q = q.select(sql<string | null>`max(${expr})`.as(alias))
            cfSelectedAliases.push(alias)
          }
        }
        q = q.orderBy(alias, (s.dir ?? 'asc') as any)
      } else {
        const column = await this.resolveBaseColumn(table, s.field)
        if (!column) continue
        q = q.orderBy(qualify(column), (s.dir ?? 'asc') as any)
      }
    }

    // Pagination
    const page = opts.page?.page ?? 1
    const pageSize = opts.page?.pageSize ?? 20
    // Deduplicate if we joined CFs or extensions by grouping on base id
    const hasJoinedAggregates = (opts.includeExtensions && (Array.isArray(opts.includeExtensions) ? (opts.includeExtensions.length > 0) : true)) || Object.keys(cfValueExprByKey).length > 0
    if (hasJoinedAggregates) {
      q = q.groupBy(`${table}.id`)
    }
    const countBuilder = hasJoinedAggregates
      ? q.clearSelect().clearOrderBy().clearGroupBy().select(sql<string>`count(distinct ${sql.ref(`${table}.id`)})`.as('count'))
      : q.clearSelect().clearOrderBy().select(sql<string>`count(distinct ${sql.ref(`${table}.id`)})`.as('count'))
    const countRow = await countBuilder.executeTakeFirst() as { count: unknown } | undefined
    const total = Number((countRow as any)?.count ?? 0)
    const items = await q.limit(pageSize).offset((page - 1) * pageSize).execute() as any[]

    if (cfJsonAliases.size > 0) {
      for (const row of items) {
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
    const decryptPayload =
      svc?.decryptEntityPayload?.bind(svc) as
        | ((
            entityId: EntityId,
            payload: Record<string, unknown>,
            tenantId: string | null,
            organizationId: string | null,
          ) => Promise<Record<string, unknown>>)
        | null
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

    let queryResult: QueryResult<T> = { items: decryptedItems, page, pageSize, total }

    // --- UMES query extension: after-query pipeline ---
    if (ext && extensionCtx) {
      const diCtx = ext.resolve ? { resolve: ext.resolve } : noop
      queryResult = await runAfterQueryPipeline(
        queryResult as QueryResult<Record<string, unknown>>,
        opts,
        extensionCtx,
        diCtx,
      ) as QueryResult<T>
    }

    return queryResult
  }

  private applyColumnOp(builder: AnyBuilder, column: string | RawBuilder<unknown>, op: string, value: unknown): AnyBuilder {
    switch (op) {
      case 'eq':
        return value === null
          ? builder.where(column as any, 'is', null)
          : builder.where(column as any, '=', value as any)
      case 'ne':
        return value === null
          ? builder.where(column as any, 'is not', null)
          : builder.where(column as any, '!=', value as any)
      case 'gt':
        return builder.where(column as any, '>', value as any)
      case 'gte':
        return builder.where(column as any, '>=', value as any)
      case 'lt':
        return builder.where(column as any, '<', value as any)
      case 'lte':
        return builder.where(column as any, '<=', value as any)
      case 'in':
        return builder.where(column as any, 'in', Array.isArray(value) ? value : [value])
      case 'nin':
        return builder.where(column as any, 'not in', Array.isArray(value) ? value : [value])
      case 'like':
        return builder.where(column as any, 'like', value as any)
      case 'ilike':
        return builder.where(column as any, 'ilike', value as any)
      case 'exists':
        return value
          ? builder.where(column as any, 'is not', null)
          : builder.where(column as any, 'is', null)
      default:
        return builder
    }
  }

  private buildColumnOpExpression(eb: any, column: string, op: string, value: unknown): any {
    switch (op) {
      case 'eq': return value === null ? eb(column, 'is', null) : eb(column, '=', value)
      case 'ne': return value === null ? eb(column, 'is not', null) : eb(column, '!=', value)
      case 'gt': return eb(column, '>', value)
      case 'gte': return eb(column, '>=', value)
      case 'lt': return eb(column, '<', value)
      case 'lte': return eb(column, '<=', value)
      case 'in': return eb(column, 'in', Array.isArray(value) ? value : [value])
      case 'nin': return eb(column, 'not in', Array.isArray(value) ? value : [value])
      case 'like': return eb(column, 'like', value)
      case 'ilike': return eb(column, 'ilike', value)
      case 'exists': return value ? eb(column, 'is not', null) : eb(column, 'is', null)
      default: return eb.val(true)
    }
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
    const db = this.getDb()
    const exists = await db
      .selectFrom('information_schema.columns' as any)
      .select(sql<number>`1`.as('one'))
      .where('table_name' as any, '=', table)
      .where('column_name' as any, '=', column)
      .limit(1)
      .executeTakeFirst()
    const present = !!exists
    if (present) this.columnCache.set(key, true)
    else this.columnCache.delete(key)
    return present
  }

  private async tableExists(table: string): Promise<boolean> {
    if (this.tableCache.has(table)) return this.tableCache.get(table) ?? false
    const db = this.getDb()
    const exists = await db
      .selectFrom('information_schema.tables' as any)
      .select(sql<number>`1`.as('one'))
      .where('table_name' as any, '=', table)
      .limit(1)
      .executeTakeFirst()
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
      const db = this.getDb()
      let query: AnyBuilder = db
        .selectFrom('search_tokens' as any)
        .select(sql<number>`1`.as('one'))
        .where('entity_type' as any, '=', entity)
        .limit(1)
      if (tenantId !== undefined) {
        query = query.where(sql<boolean>`tenant_id is not distinct from ${tenantId}`)
      }
      if (orgScope) {
        query = this.applyOrganizationScope(query, 'search_tokens.organization_id', orgScope)
      }
      const row = await query.executeTakeFirst()
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

  private applySearchTokens(
    q: AnyBuilder,
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
  ): { applied: boolean; builder: AnyBuilder } {
    if (!opts.hashes.length) {
      this.logSearchDebug('search:skip-no-hashes', {
        entity: opts.entity,
        field: opts.field,
        tenantId: opts.tenantId ?? null,
        organizationScope: opts.organizationScope,
      })
      return { applied: false, builder: q }
    }
    const alias = `st_${this.searchAliasSeq++}`
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
    const buildSub = (eb: any) => {
      let sub: AnyBuilder = eb
        .selectFrom(`search_tokens as ${alias}`)
        .select(sql<number>`1`.as('one'))
        .where(`${alias}.entity_type`, '=', opts.entity)
        .where(`${alias}.field`, '=', opts.field)
        .where(sql<boolean>`${sql.ref(`${alias}.entity_id`)} = ${sql.ref(opts.recordIdColumn)}::text`)
        .where(`${alias}.token_hash`, 'in', opts.hashes)
        .groupBy([`${alias}.entity_id`, `${alias}.field`])
        .having(sql<boolean>`count(distinct ${sql.ref(`${alias}.token_hash`)}) >= ${opts.hashes.length}`)
      if (opts.tenantId !== undefined) {
        sub = sub.where(sql<boolean>`${sql.ref(`${alias}.tenant_id`)} is not distinct from ${opts.tenantId ?? null}`)
      }
      if (opts.organizationScope) {
        sub = engine.applyOrganizationScope(sub, `${alias}.organization_id`, opts.organizationScope)
      }
      return sub
    }
    const combiner = opts.combineWith === 'or' ? 'or' : 'and'
    if (combiner === 'or') {
      // When OR combining, caller expects a raw predicate to include in eb.or([...]).
      // We keep the same semantics as the previous knex orWhereExists by mutating the outer builder with a WHERE EXISTS.
      // Return the mutated builder; callers that need per-predicate control should build the sub themselves.
      const next = q.where((eb: any) => eb.or([eb.exists(buildSub(eb))]))
      return { applied: true, builder: next }
    }
    const next = q.where((eb: any) => eb.exists(buildSub(eb)))
    return { applied: true, builder: next }
  }

  private applyIndexDocFilter(
    q: AnyBuilder,
    opts: {
      entity: string
      field: string
      op: NormalizedFilter['op']
      value: unknown
      recordIdColumn: string
      tenantId?: string | null
      organizationScope?: { ids: string[]; includeNull: boolean } | null
      withDeleted: boolean
      searchActive: boolean
      searchConfig: ReturnType<typeof resolveSearchConfig>
    }
  ): AnyBuilder {
    if ((opts.op === 'like' || opts.op === 'ilike') && opts.searchActive && typeof opts.value === 'string') {
      const tokens = tokenizeText(String(opts.value), opts.searchConfig)
      const hashes = tokens.hashes
      if (hashes.length) {
        const result = this.applySearchTokens(q, {
          entity: opts.entity,
          field: opts.field,
          hashes,
          recordIdColumn: opts.recordIdColumn,
          tenantId: opts.tenantId ?? null,
          organizationScope: opts.organizationScope,
          tokens: tokens.tokens,
        })
        this.logSearchDebug('search:index-doc-filter', {
          entity: opts.entity,
          field: opts.field,
          tokens: tokens.tokens,
          hashes,
          applied: result.applied,
          tenantId: opts.tenantId ?? null,
          organizationScope: opts.organizationScope,
        })
        if (result.applied) return result.builder
      } else {
        this.logSearchDebug('search:index-doc-skip-empty-hashes', {
          entity: opts.entity,
          field: opts.field,
          value: opts.value,
        })
      }
      return q
    }

    const alias = `ei_${this.searchAliasSeq++}`
    const engine = this
    return q.where((eb: any) => eb.exists((() => {
      let sub: AnyBuilder = eb
        .selectFrom(`entity_indexes as ${alias}`)
        .select(sql<number>`1`.as('one'))
        .where(`${alias}.entity_type`, '=', opts.entity)
        .where(sql<boolean>`${sql.ref(`${alias}.entity_id`)} = ${sql.ref(opts.recordIdColumn)}::text`)
      if (opts.tenantId !== undefined) {
        sub = sub.where(sql<boolean>`${sql.ref(`${alias}.tenant_id`)} is not distinct from ${opts.tenantId ?? null}`)
      }
      if (opts.organizationScope) {
        sub = engine.applyOrganizationScope(sub, `${alias}.organization_id`, opts.organizationScope)
      }
      if (!opts.withDeleted) {
        sub = sub.where(`${alias}.deleted_at`, 'is', null)
      }

      const textExpr = sql<string | null>`(${sql.ref(`${alias}.doc`)} ->> ${opts.field})`
      switch (opts.op) {
        case 'eq':
          sub = sub.where(sql<boolean>`${textExpr} = ${opts.value}`); break
        case 'ne':
          sub = sub.where(sql<boolean>`${textExpr} <> ${opts.value}`); break
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
          const operator = sql.raw(opts.op === 'gt' ? '>' : opts.op === 'gte' ? '>=' : opts.op === 'lt' ? '<' : '<=')
          sub = sub.where(sql<boolean>`${textExpr} ${operator} ${opts.value}`)
          break
        }
        case 'in': {
          const vals = Array.isArray(opts.value) ? opts.value : [opts.value]
          sub = sub.where(sql<boolean>`${textExpr} in (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`)
          break
        }
        case 'nin': {
          const vals = Array.isArray(opts.value) ? opts.value : [opts.value]
          sub = sub.where(sql<boolean>`${textExpr} not in (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`)
          break
        }
        case 'like':
          sub = sub.where(sql<boolean>`${textExpr} like ${opts.value}`); break
        case 'ilike':
          sub = sub.where(sql<boolean>`${textExpr} ilike ${opts.value}`); break
        case 'exists':
          sub = opts.value
            ? sub.where(sql<boolean>`${textExpr} is not null`)
            : sub.where(sql<boolean>`${textExpr} is null`)
          break
        default:
          break
      }
      return sub
    })()))
  }

  private configureCustomFieldSources(
    q: AnyBuilder,
    baseTable: string,
    baseEntity: EntityId,
    db: AnyDb,
    opts: QueryOptions,
    qualify: (column: string) => string,
  ): { builder: AnyBuilder; sources: ResolvedCustomFieldSource[] } {
    const sources: ResolvedCustomFieldSource[] = [
      {
        entityId: baseEntity,
        alias: 'base',
        table: baseTable,
        recordIdExpr: sql<string>`${sql.ref(`${baseTable}.id`)}::text`,
      },
    ]
    const extras: QueryCustomFieldSource[] = opts.customFieldSources ?? []
    let next = q
    extras.forEach((srcOpt, index) => {
      const joinTable = srcOpt.table ?? resolveEntityTableName(this.em, srcOpt.entityId)
      const alias = srcOpt.alias ?? `cfs_${index}`
      const join = srcOpt.join
      if (!join) {
        throw new Error(`QueryEngine: customFieldSources entry for ${String(srcOpt.entityId)} requires a join configuration`)
      }
      const joinFn = (join.type ?? 'left') === 'inner' ? 'innerJoin' : 'leftJoin'
      next = (next as any)[joinFn](`${joinTable} as ${alias}`, (jb: any) =>
        jb.onRef(`${alias}.${join.toField}`, '=', qualify(join.fromField)))
      const recordColumn = srcOpt.recordIdColumn ?? 'id'
      sources.push({
        entityId: srcOpt.entityId,
        alias,
        table: joinTable,
        recordIdExpr: sql<string>`${sql.ref(`${alias}.${recordColumn}`)}::text`,
      })
    })
    return { builder: next, sources }
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

  private applyOrganizationScope(q: AnyBuilder, column: string, scope: { ids: string[]; includeNull: boolean }): AnyBuilder {
    if (!scope) return q
    if (scope.ids.length === 0 && !scope.includeNull) {
      return q.where(sql<boolean>`1 = 0`)
    }
    return q.where((eb: any) => {
      const parts: any[] = []
      if (scope.ids.length > 0) parts.push(eb(column, 'in', scope.ids))
      if (scope.includeNull) parts.push(eb(column, 'is', null))
      if (parts.length === 1) return parts[0]
      return eb.or(parts)
    })
  }
}
