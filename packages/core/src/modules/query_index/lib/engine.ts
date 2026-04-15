import type { QueryEngine, QueryOptions, QueryResult, FilterOp, Filter, QueryCustomFieldSource, PartialIndexWarning, QueryExtensionsConfig } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine, resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { type Kysely, sql, type RawBuilder } from 'kysely'
import type { EventBus } from '@open-mercato/events'
import { readCoverageSnapshot, refreshCoverageSnapshot } from './coverage'
import { createProfiler, shouldEnableProfiler, type Profiler } from '@open-mercato/shared/lib/profiler'
import type { VectorIndexService } from '@open-mercato/search/vector'
import { decryptIndexDocCustomFields } from '@open-mercato/shared/lib/encryption/indexDoc'
import { parseBooleanToken, parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import {
  applyJoinFilters,
  normalizeFilters,
  partitionFilters,
  resolveJoins,
  type BaseFilter,
  type ResolvedJoin,
} from '@open-mercato/shared/lib/query/join-utils'
import { resolveSearchConfig, type SearchConfig } from '@open-mercato/shared/lib/search/config'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import { runBeforeQueryPipeline, runAfterQueryPipeline, type QueryExtensionContext } from '@open-mercato/shared/lib/query/query-extension-runner'

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

function resolveBooleanEnv(names: readonly string[], defaultValue: boolean): boolean {
  for (const name of names) {
    const raw = process.env[name]
    if (raw !== undefined) return parseBooleanWithDefault(raw, defaultValue)
  }
  return defaultValue
}

function resolveDebugVerbosity(): boolean {
  const queryIndexDebug = process.env.OM_QUERY_INDEX_DEBUG
  if (queryIndexDebug !== undefined) {
    return parseBooleanToken(queryIndexDebug) ?? false
  }
  const level = (process.env.LOG_VERBOSITY ?? process.env.LOG_LEVEL ?? '').toLowerCase()
  if (['debug', 'trace', 'silly'].includes(level)) return true
  return false
}

type AnyDb = Kysely<any>
type AnyBuilder = any
type NormalizedFilter = { field: string; op: FilterOp; value?: unknown }
type IndexDocSource = { alias: string; entityId: EntityId; recordIdColumn: string }
type PreparedCustomFieldSource = {
  alias: string
  indexAlias: string
  entityId: EntityId
  recordIdColumn: string
  organizationField?: string
  tenantField?: string
  table: string
}
type SearchRuntime = {
  enabled: boolean
  config: SearchConfig
  organizationScope?: { ids: string[]; includeNull: boolean } | null
  tenantId?: string | null
  searchSources?: SearchTokenSource[]
}

type EncryptionResolver = () => {
  decryptEntityPayload?: (entityId: EntityId, payload: Record<string, unknown>, tenantId?: string | null, organizationId?: string | null) => Promise<Record<string, unknown>>
  isEnabled?: () => boolean
} | null

type SearchTokenSource = { entity: string; recordIdColumn: string }

function createQueryProfiler(entity: string): Profiler {
  const enabled = shouldEnableProfiler(entity)
  return createProfiler({
    scope: 'query_engine',
    target: entity,
    label: `query_engine:${entity}`,
    loggerLabel: '[qe:profile]',
    enabled,
  })
}

export class HybridQueryEngine implements QueryEngine {
  private coverageStatsTtlMs: number
  private customFieldKeysCache = new Map<string, { expiresAt: number; value: string[] }>()
  private customFieldKeysTtlMs: number
  private columnCache = new Map<string, boolean>()
  private debugVerbosity: boolean | null = null
  private sqlDebugEnabled: boolean | null = null
  private forcePartialIndexEnabled: boolean | null = null
  private autoReindexEnabled: boolean | null = null
  private coverageOptimizationEnabled: boolean | null = null
  private pendingCoverageRefreshKeys = new Set<string>()
  private searchAliasSeq = 0

  constructor(
    private em: EntityManager,
    private fallback: BasicQueryEngine,
    private eventBusResolver?: () => Pick<EventBus, 'emitEvent'> | null | undefined,
    private vectorServiceResolver?: () => VectorIndexService | null | undefined,
    private encryptionResolver?: EncryptionResolver,
  ) {
    const coverageTtl = Number.parseInt(process.env.QUERY_INDEX_COVERAGE_CACHE_MS ?? '', 10)
    this.coverageStatsTtlMs = Number.isFinite(coverageTtl) && coverageTtl >= 0 ? coverageTtl : 5 * 60 * 1000
    const cfTtl = Number.parseInt(process.env.QUERY_INDEX_CF_KEYS_CACHE_MS ?? '', 10)
    this.customFieldKeysTtlMs = Number.isFinite(cfTtl) && cfTtl >= 0 ? cfTtl : 5 * 60 * 1000
  }

  private getEncryptionService() {
    try {
      return this.encryptionResolver?.() ?? null
    } catch {
      return null
    }
  }

  private getDb(): AnyDb {
    const emAny = this.em as any
    if (typeof emAny.getKysely === 'function') return emAny.getKysely() as AnyDb
    throw new Error('HybridQueryEngine requires an EntityManager exposing getKysely() (MikroORM v7)')
  }

  async query<T = unknown>(entity: EntityId, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    const ext: QueryExtensionsConfig | undefined = opts.extensions
    let hybridExtCtx: QueryExtensionContext | null = null
    const noopDi = { resolve: <R = unknown>(_name: string): R => { throw new Error('No DI context') } }

    if (ext) {
      hybridExtCtx = {
        entity: String(entity),
        engine: 'hybrid',
        tenantId: opts.tenantId ?? '',
        organizationId: opts.organizationId,
        userId: ext.userId,
        em: this.em,
        container: ext.container,
        userFeatures: ext.userFeatures,
      }
      const diCtx = ext.resolve ? { resolve: ext.resolve } : noopDi
      const beforeResult = await runBeforeQueryPipeline(opts, hybridExtCtx, diCtx)
      if (beforeResult.blocked) {
        throw new Error(beforeResult.errorMessage ?? 'Query blocked by extension subscriber')
      }
      opts = beforeResult.query
    }
    const { extensions: _stripExt, ...coreOpts } = opts
    opts = coreOpts

    const providedProfiler = opts.profiler
    const profiler = providedProfiler && providedProfiler.enabled
      ? providedProfiler
      : createQueryProfiler(String(entity))
    profiler.mark('query:init')
    let profileClosed = false
    const finishProfile = (meta?: Record<string, unknown>) => {
      if (!profiler.enabled || profileClosed) return
      profileClosed = true
      profiler.end(meta)
    }

    const applyAfterExtensions = async <R>(queryResult: QueryResult<R>): Promise<QueryResult<R>> => {
      if (!ext || !hybridExtCtx) return queryResult
      const diCtx = ext.resolve ? { resolve: ext.resolve } : noopDi
      return await runAfterQueryPipeline(
        queryResult as QueryResult<Record<string, unknown>>,
        opts,
        hybridExtCtx,
        diCtx,
      ) as QueryResult<R>
    }

    try {
      const debugEnabled = this.isDebugVerbosity()
      if (debugEnabled) this.debug('query:start', { entity })
      this.searchAliasSeq = 0

      const isCustom = await this.isCustomEntity(entity)
      if (isCustom) {
        if (debugEnabled) this.debug('query:custom-entity', { entity })
        const section = profiler.section('custom_entity')
        try {
          const result = await this.queryCustomEntity<T>(entity, opts)
          section.end({ mode: 'custom_entity' })
          finishProfile({
            result: 'custom_entity',
            total: Array.isArray(result.items) ? result.items.length : undefined,
          })
          return await applyAfterExtensions(result)
        } catch (err) {
          section.end({ error: err instanceof Error ? err.message : String(err) })
          throw err
        }
      }

      const db = this.getDb()
      profiler.mark('query:db_ready')
      const baseTable = resolveEntityTableName(this.em, entity)
      profiler.mark('query:base_table_resolved')
      const searchConfig = resolveSearchConfig()
      const orgScope = this.resolveOrganizationScope(opts)
      const searchEnabled = searchConfig.enabled && await this.tableExists('search_tokens')

      const baseExists = await profiler.measure('base_table_exists', () => this.tableExists(baseTable))
      if (!baseExists) {
        if (debugEnabled) this.debug('query:fallback:missing-base', { entity, baseTable })
        const fallbackResult = await this.fallback.query(entity, opts)
        finishProfile({ result: 'fallback', reason: 'missing_base' })
        return await applyAfterExtensions(fallbackResult)
      }

      const normalizedFilters = normalizeFilters(opts.filters)
      const cfFilters = normalizedFilters.filter((filter) => filter.field.startsWith('cf:') || filter.field.startsWith('l10n:'))
      const coverageScope = this.resolveCoverageSnapshotScope(opts)
      const wantsCf = (
        (opts.fields || []).some((field) => typeof field === 'string' && (field.startsWith('cf:') || field.startsWith('l10n:'))) ||
        cfFilters.length > 0 ||
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

      let partialIndexWarning: PartialIndexWarning | null = null
      let entityHasActiveCustomFields = true

      if (wantsCf) {
        entityHasActiveCustomFields = await this.entityHasActiveCustomFields(entity, opts.tenantId ?? null)
        const hasIndexRows = await profiler.measure(
          'index_any_rows',
          () => this.indexAnyRows(entity),
          (value) => ({ hasIndexRows: value })
        )
        if (!hasIndexRows) {
          if (debugEnabled) this.debug('query:fallback:no-index', { entity })
          const fallbackResult = await this.fallback.query(entity, opts)
          finishProfile({ result: 'fallback', reason: 'no_index_rows' })
          return await applyAfterExtensions(fallbackResult)
        }
        if (entityHasActiveCustomFields) {
          const gap = await profiler.measure(
            'resolve_coverage_gap',
            () => this.resolveCoverageGap(entity, opts, coverageScope),
            (value) => (value
              ? {
                  scope: value.scope,
                  baseCount: value.stats?.baseCount ?? null,
                  indexedCount: value.stats?.indexedCount ?? null,
                }
              : { scope: null })
          )
          if (gap) {
            if (!opts.skipAutoReindex) {
              this.scheduleAutoReindex(entity, opts, gap.stats, coverageScope?.organizationId ?? null)
            }
            const force = this.isForcePartialIndexEnabled()
            if (!force) {
              if (gap.stats) {
                console.warn('[HybridQueryEngine] Partial index coverage detected; falling back to basic engine:', { entity, baseCount: gap.stats.baseCount, indexedCount: gap.stats.indexedCount, scope: gap.scope })
                if (debugEnabled) this.debug('query:fallback:partial-coverage', { entity, baseCount: gap.stats.baseCount, indexedCount: gap.stats.indexedCount, scope: gap.scope })
              } else {
                console.warn('[HybridQueryEngine] Partial index coverage detected; falling back to basic engine:', { entity })
                if (debugEnabled) this.debug('query:fallback:partial-coverage', { entity })
              }
              const fallbackResult = await this.fallback.query(entity, opts)
              const resultWithWarning: QueryResult<T> = {
                ...fallbackResult,
                meta: {
                  ...(fallbackResult.meta ?? {}),
                  partialIndexWarning: {
                    entity,
                    entityLabel: this.resolveEntityLabel(entity),
                    baseCount: gap.stats?.baseCount ?? null,
                    indexedCount: gap.stats?.indexedCount ?? null,
                    scope: gap.stats ? gap.scope : undefined,
                  },
                },
              }
              finishProfile({
                result: 'fallback',
                reason: 'partial_index',
                scope: gap.scope,
                baseCount: gap.stats?.baseCount ?? null,
                indexedCount: gap.stats?.indexedCount ?? null,
              })
              return await applyAfterExtensions(resultWithWarning)
            }
            if (gap.stats) {
              console.warn('[HybridQueryEngine] Partial index coverage detected; forcing query index usage due to FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES:', { entity, baseCount: gap.stats.baseCount, indexedCount: gap.stats.indexedCount, scope: gap.scope })
              if (debugEnabled) this.debug('query:partial-coverage:forced', { entity, baseCount: gap.stats.baseCount, indexedCount: gap.stats.indexedCount, scope: gap.scope })
            } else {
              console.warn('[HybridQueryEngine] Partial index coverage detected; forcing query index usage due to FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES:', { entity })
              if (debugEnabled) this.debug('query:partial-coverage:forced', { entity })
            }
            partialIndexWarning = {
              entity,
              entityLabel: this.resolveEntityLabel(entity),
              baseCount: gap.stats?.baseCount ?? null,
              indexedCount: gap.stats?.indexedCount ?? null,
              scope: gap.stats ? gap.scope : undefined,
            }
          }
        } else if (debugEnabled) {
          this.debug('query:coverage:skip-no-custom-fields', { entity })
        }
      }

      const qualify = (col: string) => `b.${col}`
      const columns = await this.getBaseColumnsForEntity(entity)
      const hasOrganizationColumn = await this.columnExists(baseTable, 'organization_id')
      const hasTenantColumn = await this.columnExists(baseTable, 'tenant_id')
      const hasDeletedColumn = await this.columnExists(baseTable, 'deleted_at')

      if (!opts.tenantId) throw new Error('QueryEngine: tenantId is required')

      const resolvedJoinsConfig = resolveJoins(
        baseTable,
        [...(opts.joins ?? []), ...buildFilterableCustomFieldJoins(opts.customFieldSources)],
        (entityId) => resolveEntityTableName(this.em, entityId as any),
      )
      const joinMap = new Map<string, ResolvedJoin>()
      const aliasTables = new Map<string, string>()
      aliasTables.set('b', baseTable)
      aliasTables.set('base', baseTable)
      aliasTables.set(baseTable, baseTable)
      for (const join of resolvedJoinsConfig) {
        joinMap.set(join.alias, join)
        aliasTables.set(join.alias, join.table)
      }
      const { baseFilters, joinFilters } = partitionFilters(baseTable, normalizedFilters, joinMap)

      const searchRuntimeBase = {
        enabled: false,
        config: searchConfig,
        organizationScope: orgScope,
        tenantId: opts.tenantId ?? null,
      }

      // Prepare index sources for JSONB custom-field access.
      const indexSources: IndexDocSource[] = [{ alias: 'ei', entityId: entity, recordIdColumn: 'b.id' }]
      let preparedCfSources: PreparedCustomFieldSource[] = []
      const shouldAttachCustomSources = Array.isArray(opts.customFieldSources) && opts.customFieldSources.length > 0 && (wantsCf || searchEnabled)
      if (shouldAttachCustomSources) {
        preparedCfSources = this.prepareCustomFieldSources(opts.customFieldSources ?? [])
        for (const source of preparedCfSources) {
          indexSources.push({ alias: source.indexAlias, entityId: source.entityId, recordIdColumn: `${source.alias}.${source.recordIdColumn}` })
        }
      }

      const searchSources: SearchTokenSource[] = indexSources
        .map((src) => ({ entity: String(src.entityId), recordIdColumn: src.recordIdColumn }))
        .filter((src) => src.recordIdColumn && src.entity)
      const hasSearchTokens = searchEnabled && searchSources.length
        ? await this.searchSourcesHaveTokens(searchSources, opts.tenantId ?? null, orgScope)
        : false
      const searchRuntime: SearchRuntime = { ...searchRuntimeBase, searchSources, enabled: searchEnabled && hasSearchTokens }
      const joinSearchAvailability = new Map<string, boolean>()
      const searchFilters = normalizeFilters(opts.filters).filter((filter) => filter.op === 'like' || filter.op === 'ilike')
      if (searchFilters.length) {
        this.logSearchDebug('search:init', {
          entity,
          baseTable,
          tenantId: opts.tenantId ?? null,
          organizationScope: orgScope,
          fields: searchFilters.map((filter) => String(filter.field)),
          searchEnabled,
          hasSearchTokens,
          searchSources,
          searchConfig: {
            enabled: searchConfig.enabled,
            minTokenLength: searchConfig.minTokenLength,
            enablePartials: searchConfig.enablePartials,
            hashAlgorithm: searchConfig.hashAlgorithm,
            blocklistedFields: searchConfig.blocklistedFields,
          },
        })
        if (!searchEnabled) this.logSearchDebug('search:disabled', { entity, baseTable })
        else if (!hasSearchTokens) this.logSearchDebug('search:no-search-tokens', {
          entity, baseTable,
          tenantId: opts.tenantId ?? null,
          organizationScope: orgScope,
          searchSources,
        })
      }
      const hasNonBaseSearchSource = searchSources.some(
        (src) => src.entity !== String(entity) || src.recordIdColumn !== 'b.id'
      )

      // Additional partial-coverage checks for customFieldSources
      if (!partialIndexWarning && Array.isArray(opts.customFieldSources) && opts.customFieldSources.length > 0 && this.isForcePartialIndexEnabled()) {
        const seen = new Set<string>([entity])
        for (const source of opts.customFieldSources) {
          const targetEntity = source?.entityId ? String(source.entityId) : null
          if (!targetEntity || seen.has(targetEntity)) continue
          seen.add(targetEntity)
          const sourceHasCustomFields = await this.entityHasActiveCustomFields(targetEntity, opts.tenantId ?? null)
          if (!sourceHasCustomFields) {
            if (debugEnabled) this.debug('query:coverage:skip-no-custom-fields', { entity: targetEntity })
            continue
          }
          const sourceTable = source.table ?? resolveEntityTableName(this.em, targetEntity)
          try {
            const gap = await profiler.measure(
              'resolve_coverage_gap',
              () => this.resolveCoverageGap(targetEntity, opts, coverageScope, sourceTable),
              (value) => (value
                ? {
                    entity: targetEntity, scope: value.scope,
                    baseCount: value.stats?.baseCount ?? null,
                    indexedCount: value.stats?.indexedCount ?? null,
                  }
                : { entity: targetEntity, scope: null })
            )
            if (!gap) continue
            if (!opts.skipAutoReindex) {
              this.scheduleAutoReindex(targetEntity, opts, gap.stats, coverageScope?.organizationId ?? null)
            }
            partialIndexWarning = {
              entity: targetEntity,
              entityLabel: this.resolveEntityLabel(targetEntity),
              baseCount: gap.stats?.baseCount ?? null,
              indexedCount: gap.stats?.indexedCount ?? null,
              scope: gap.stats ? gap.scope : undefined,
            }
            if (debugEnabled) {
              if (gap.stats) this.debug('query:partial-coverage:forced', { entity: targetEntity, baseCount: gap.stats.baseCount, indexedCount: gap.stats.indexedCount, scope: gap.scope })
              else this.debug('query:partial-coverage:forced', { entity: targetEntity })
            }
            break
          } catch (err) {
            if (debugEnabled) this.debug('query:partial-coverage:check-failed', { entity: targetEntity, error: err instanceof Error ? err.message : err })
          }
        }
      }

      if (
        !partialIndexWarning &&
        wantsCf &&
        entityHasActiveCustomFields &&
        this.isForcePartialIndexEnabled() &&
        opts.tenantId
      ) {
        try {
          await this.indexCoverageStats(entity, opts, coverageScope)
          const globalStats = await this.indexCoverageStats(entity, opts, coverageScope)
          if (globalStats) {
            const globalBase = globalStats.baseCount
            const globalIndexed = globalStats.indexedCount
            const globalGap = (globalBase > 0 && globalIndexed < globalBase) || globalIndexed > globalBase
            if (globalGap) {
              console.warn('[HybridQueryEngine] Partial index coverage detected at global scope; forcing query index usage due to FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES:', { entity, baseCount: globalBase, indexedCount: globalIndexed, scope: 'global' })
              if (debugEnabled) this.debug('query:partial-coverage:forced', { entity, baseCount: globalBase, indexedCount: globalIndexed, scope: 'global' })
              partialIndexWarning = {
                entity, entityLabel: this.resolveEntityLabel(entity),
                baseCount: globalBase, indexedCount: globalIndexed, scope: 'global',
              }
            }
          }
        } catch (err) {
          if (debugEnabled) this.debug('query:partial-coverage:global-check-failed', { entity, error: err instanceof Error ? err.message : err })
        }
      }

      const resolveBaseColumn = (field: string): string | null => {
        if (columns.has(field)) return field
        if (field === 'organization_id' && columns.has('id')) return 'id'
        return null
      }

      // ────────────────────────────────────────────────────────────────
      // Build a reusable "applyQueryShape" function that applies every
      // WHERE/JOIN/scope to a fresh SelectQueryBuilder. We use this in
      // place of knex's `.clone()` for producing count + data queries.
      // ────────────────────────────────────────────────────────────────

      const applyBaseScope = (q: AnyBuilder): AnyBuilder => {
        let next = q
        if (orgScope && hasOrganizationColumn) {
          next = this.applyOrganizationScope(next, qualify('organization_id'), orgScope)
        }
        if (hasTenantColumn) {
          next = next.where(qualify('tenant_id'), '=', opts.tenantId)
        }
        if (!opts.withDeleted && hasDeletedColumn) {
          next = next.where(qualify('deleted_at'), 'is', null)
        }
        return next
      }

      const applyEntityIndexesJoin = (q: AnyBuilder): AnyBuilder => {
        return q.leftJoin('entity_indexes as ei', (jb: any) => {
          let jc = jb
            .on('ei.entity_type', '=', String(entity))
            .onRef('ei.entity_id', '=', sql<string>`(${sql.ref(qualify('id'))}::text)`)
          if (hasOrganizationColumn) {
            jc = jc
              .onRef('ei.organization_id', '=', qualify('organization_id'))
              .on('ei.organization_id', 'is not', null)
          }
          if (hasTenantColumn) {
            jc = jc
              .onRef('ei.tenant_id', '=', qualify('tenant_id'))
              .on('ei.tenant_id', 'is not', null)
          }
          if (!opts.withDeleted) {
            jc = jc.on('ei.deleted_at', 'is', null)
          }
          return jc
        })
      }

      const applyCustomFieldSourceJoins = (q: AnyBuilder): AnyBuilder => {
        let next = q
        for (const source of preparedCfSources) {
          const join = (opts.customFieldSources ?? []).find((s) => s && (s.alias ?? undefined) === source.alias)?.join
          if (!join) continue
          const joinType = (join.type ?? 'left') === 'inner' ? 'innerJoin' : 'leftJoin'
          next = (next as any)[joinType](`${source.table} as ${source.alias}`, (jb: any) =>
            jb.onRef(`${source.alias}.${join.toField}`, '=', qualify(join.fromField)))
          // Index join for source
          next = next.leftJoin(`entity_indexes as ${source.indexAlias}`, (jb: any) => {
            let jc = jb
              .on(`${source.indexAlias}.entity_type`, '=', String(source.entityId))
              .onRef(`${source.indexAlias}.entity_id`, '=', sql<string>`(${sql.ref(`${source.alias}.${source.recordIdColumn}`)}::text)`)
            const orgRef = source.organizationField
              ? `${source.alias}.${source.organizationField}`
              : (columns.has('organization_id') ? qualify('organization_id') : null)
            if (orgRef) {
              jc = jc
                .onRef(`${source.indexAlias}.organization_id`, '=', orgRef)
                .on(`${source.indexAlias}.organization_id`, 'is not', null)
            }
            const tenantRef = source.tenantField
              ? `${source.alias}.${source.tenantField}`
              : (columns.has('tenant_id') ? qualify('tenant_id') : null)
            if (tenantRef) {
              jc = jc
                .onRef(`${source.indexAlias}.tenant_id`, '=', tenantRef)
                .on(`${source.indexAlias}.tenant_id`, 'is not', null)
            }
            if (!opts.withDeleted) jc = jc.on(`${source.indexAlias}.deleted_at`, 'is', null)
            return jc
          })
        }
        return next
      }

      const applyCfFilters = (q: AnyBuilder): AnyBuilder => {
        let next = q
        for (const filter of cfFilters) {
          next = this.applyCfFilterAcrossSources(
            next, filter.field, filter.op, filter.value, indexSources, searchRuntime,
          )
        }
        return next
      }

      const regularBaseFilters = baseFilters.filter((filter) => !filter.orGroup)
      const orGroupFilters = baseFilters.filter((filter) => filter.orGroup)

      const applyRegularBaseFilters = (q: AnyBuilder): AnyBuilder => {
        let next = q
        for (const filter of regularBaseFilters) {
          const fieldName = String(filter.field)
          const baseField = resolveBaseColumn(fieldName)
          if (!baseField) {
            next = this.applyIndexDocFilterFromAlias(
              next, 'ei', entity, fieldName, filter.op, filter.value, 'b.id', searchRuntime,
            )
            continue
          }
          const column = qualify(baseField)
          next = this.applyColumnFilter(next, column, filter, {
            ...searchRuntime,
            entity, field: fieldName, recordIdColumn: 'b.id',
          })
        }
        return next
      }

      const applyOrGroupedBaseFilters = (q: AnyBuilder): AnyBuilder => {
        if (orGroupFilters.length === 0) return q
        const groups = new Map<string, BaseFilter[]>()
        for (const filter of orGroupFilters) {
          if (!filter.orGroup) continue
          const existing = groups.get(filter.orGroup) ?? []
          existing.push(filter)
          groups.set(filter.orGroup, existing)
        }
        let next = q
        for (const [, groupFilters] of groups) {
          if (!groupFilters.length) continue
          next = next.where((eb: any) => eb.or(
            groupFilters.map((filter) => this.buildBaseFilterExpression(eb, filter, resolveBaseColumn, qualify, entity, searchRuntime))
          ))
        }
        return next
      }

      const applyAliasScopes = async (target: AnyBuilder, aliasName: string): Promise<AnyBuilder> => {
        let next = target
        const tableName = aliasTables.get(aliasName)
        if (!tableName) return next
        if (orgScope && await this.columnExists(tableName, 'organization_id')) {
          next = this.applyOrganizationScope(next, `${aliasName}.organization_id`, orgScope)
        }
        if (opts.tenantId && await this.columnExists(tableName, 'tenant_id')) {
          next = next.where(`${aliasName}.tenant_id`, '=', opts.tenantId)
        }
        if (!opts.withDeleted && await this.columnExists(tableName, 'deleted_at')) {
          next = next.where(`${aliasName}.deleted_at`, 'is', null)
        }
        return next
      }

      const applyJoinFilterOpFn = (target: AnyBuilder, column: string, op: FilterOp, value?: unknown): AnyBuilder => {
        switch (op) {
          case 'eq': return target.where(column, '=', value as any)
          case 'ne': return target.where(column, '!=', value as any)
          case 'gt': return target.where(column, '>', value as any)
          case 'gte': return target.where(column, '>=', value as any)
          case 'lt': return target.where(column, '<', value as any)
          case 'lte': return target.where(column, '<=', value as any)
          case 'in': return target.where(column, 'in', this.toArray(value))
          case 'nin': return target.where(column, 'not in', this.toArray(value))
          case 'like': return target.where(column, 'like', value as any)
          case 'ilike': return target.where(column, 'ilike', value as any)
          case 'exists': return value ? target.where(column, 'is not', null) : target.where(column, 'is', null)
          default: return target
        }
      }

      const applyJoinSearchFilterOp = async (
        target: AnyBuilder,
        filter: { column: string; op: FilterOp; value?: unknown },
        _qualified: string,
        join: ResolvedJoin,
      ): Promise<boolean> => {
        if (!searchEnabled || !join.entityId) return false
        if (!['like', 'ilike'].includes(filter.op)) return false
        if (typeof filter.value !== 'string' || filter.value.trim().length === 0) return false

        let searchAvailable = joinSearchAvailability.get(join.entityId)
        if (searchAvailable === undefined) {
          searchAvailable = await this.hasSearchTokens(String(join.entityId), opts.tenantId ?? null, orgScope)
          joinSearchAvailability.set(join.entityId, searchAvailable)
        }
        if (!searchAvailable) return false

        const tokens = tokenizeText(String(filter.value), searchConfig)
        if (!tokens.hashes.length) return false

        return this.applySearchTokens(target, {
          entity: String(join.entityId),
          field: filter.column,
          hashes: tokens.hashes,
          recordIdColumn: `${join.alias}.id`,
          tenantId: opts.tenantId ?? null,
          organizationScope: orgScope,
        })
      }

      const applyQueryShape = async (q: AnyBuilder): Promise<AnyBuilder> => {
        let next = applyBaseScope(q)
        next = applyEntityIndexesJoin(next)
        next = applyCustomFieldSourceJoins(next)
        next = applyCfFilters(next)
        next = applyRegularBaseFilters(next)
        next = applyOrGroupedBaseFilters(next)
        // applyJoinFilters is the shared helper that handles `joinFilters` (ALIAS:col -> value).
        next = await applyJoinFilters({
          db,
          baseTable,
          builder: next,
          joinMap,
          joinFilters,
          aliasTables,
          qualifyBase: (column) => qualify(column),
          applyAliasScope: async (target: any, alias: string) => applyAliasScopes(target as AnyBuilder, alias),
          applyFilterOp: (target, column, op, value) => applyJoinFilterOpFn(target as AnyBuilder, column, op, value),
          applyJoinFilterOp: async (target, filter, qualified, join) => {
            const applied = await applyJoinSearchFilterOp(target as AnyBuilder, filter, qualified, join)
            return { applied, builder: target }
          },
          columnExists: (tbl, column) => this.columnExists(tbl, column),
        })
        return next
      }

      const hasCustomFieldFilters = cfFilters.length > 0
      const canOptimizeCount = !hasCustomFieldFilters && !hasNonBaseSearchSource

      // Selection (for data query)
      const selectFieldSet = new Set<string>((opts.fields && opts.fields.length) ? opts.fields.map(String) : Array.from(columns.keys()))
      if (opts.includeCustomFields === true) {
        const entityIds = Array.from(new Set(indexSources.map((src) => String(src.entityId))))
        try {
          const resolvedKeys = await this.resolveAvailableCustomFieldKeys(entityIds, opts.tenantId ?? null)
          resolvedKeys.forEach((key) => selectFieldSet.add(`cf:${key}`))
          if (this.isDebugVerbosity()) this.debug('query:cf:resolved-keys', { entity, keys: resolvedKeys })
        } catch (err) {
          console.warn('[HybridQueryEngine] Failed to resolve custom field keys for', entity, err)
        }
      } else if (Array.isArray(opts.includeCustomFields)) {
        opts.includeCustomFields.map((key) => String(key)).forEach((key) => selectFieldSet.add(`cf:${key}`))
      }
      const selectFields = Array.from(selectFieldSet)

      const applySelection = (q: AnyBuilder): AnyBuilder => {
        let next = q
        for (const field of selectFields) {
          const fieldName = String(field)
          if (fieldName.startsWith('cf:')) {
            const alias = this.sanitize(fieldName)
            const jsonExpr = this.buildCfJsonExprSql(fieldName, indexSources)
            const exprRaw = jsonExpr ?? sql`NULL::jsonb`
            next = next.select(exprRaw.as(alias))
          } else if (columns.has(fieldName)) {
            next = next.select(`${qualify(fieldName)} as ${fieldName}`)
          }
        }
        return next
      }

      const applySort = (q: AnyBuilder): AnyBuilder => {
        let next = q
        for (const s of opts.sort || []) {
          const fieldName = String(s.field)
          if (fieldName.startsWith('cf:')) {
            const textExpr = this.buildCfTextExprSql(fieldName, indexSources)
            if (textExpr) {
              const direction = sql.raw(String(s.dir ?? SortDir.Asc))
              next = next.orderBy(sql`${textExpr} ${direction}`)
            }
          } else {
            const baseField = resolveBaseColumn(fieldName)
            if (!baseField) continue
            next = next.orderBy(qualify(baseField), s.dir ?? SortDir.Asc)
          }
        }
        return next
      }

      const page = opts.page?.page ?? 1
      const pageSize = opts.page?.pageSize ?? 20
      const sqlDebugEnabled = this.isSqlDebugEnabled()

      let total: number

      if (canOptimizeCount) {
        // Optimized count: apply only base-scope + regular filters + or-group filters (no index joins).
        const optimizedRoot = db.selectFrom(`${baseTable} as b` as any)
        let countCore = applyBaseScope(optimizedRoot)
        countCore = applyRegularBaseFilters(countCore)
        countCore = applyOrGroupedBaseFilters(countCore)
        // joinFilters still need to be re-applied in the optimized path
        countCore = await applyJoinFilters({
          db,
          baseTable,
          builder: countCore,
          joinMap,
          joinFilters,
          aliasTables,
          qualifyBase: (column) => qualify(column),
          applyAliasScope: async (target: any, alias: string) => applyAliasScopes(target as AnyBuilder, alias),
          applyFilterOp: (target, column, op, value) => applyJoinFilterOpFn(target as AnyBuilder, column, op, value),
          applyJoinFilterOp: async (target, filter, qualified, join) => {
            const applied = await applyJoinSearchFilterOp(target as AnyBuilder, filter, qualified, join)
            return { applied, builder: target }
          },
          columnExists: (tbl, column) => this.columnExists(tbl, column),
        })
        const sub = countCore.select(sql.ref(qualify('id')).as('id')).groupBy(qualify('id')).as('sq')
        const countQuery = db.selectFrom(sub as any).select(sql<string>`count(*)`.as('count'))
        if (debugEnabled && sqlDebugEnabled) {
          const compiled = countQuery.compile()
          this.debug('query:sql:count', { entity, sql: compiled.sql, bindings: compiled.parameters })
        }
        const countRow = await this.captureSqlTiming(
          'query:sql:count', entity,
          () => countQuery.executeTakeFirst(),
          { optimized: true }, profiler,
        )
        total = this.parseCount(countRow)
      } else {
        const countRoot = db.selectFrom(`${baseTable} as b` as any)
        const countBuilder = (await applyQueryShape(countRoot))
          .select(sql<string>`count(distinct ${sql.ref(qualify('id'))})`.as('count'))
        if (debugEnabled && sqlDebugEnabled) {
          const compiled = countBuilder.compile()
          this.debug('query:sql:count', { entity, sql: compiled.sql, bindings: compiled.parameters })
        }
        const countRow = await this.captureSqlTiming(
          'query:sql:count', entity,
          () => countBuilder.executeTakeFirst(),
          { optimized: false }, profiler,
        )
        total = this.parseCount(countRow)
      }

      const dataRoot = db.selectFrom(`${baseTable} as b` as any)
      let dataBuilder = await applyQueryShape(dataRoot)
      dataBuilder = applySelection(dataBuilder)
      dataBuilder = applySort(dataBuilder)
      dataBuilder = dataBuilder.limit(pageSize).offset((page - 1) * pageSize)

      if (debugEnabled && sqlDebugEnabled) {
        const compiled = dataBuilder.compile()
        this.debug('query:sql:data', { entity, sql: compiled.sql, bindings: compiled.parameters, page, pageSize })
      }
      const itemsRaw = await this.captureSqlTiming(
        'query:sql:data', entity,
        () => dataBuilder.execute(),
        { page, pageSize }, profiler,
      )
      if (debugEnabled) this.debug('query:complete', { entity, total, items: Array.isArray(itemsRaw) ? itemsRaw.length : 0 })

      let items = itemsRaw as any[]
      const encSvc = this.getEncryptionService()
      const dekKeyCache = new Map<string | null, string | null>()
      if (encSvc?.decryptEntityPayload) {
        const decrypt = encSvc.decryptEntityPayload.bind(encSvc) as (
          entityId: EntityId, payload: Record<string, unknown>, tenantId: string | null, organizationId: string | null,
        ) => Promise<Record<string, unknown>>
        items = await Promise.all(
          items.map(async (item) => {
            try {
              const decrypted = await decrypt(
                entity, item,
                item?.tenant_id ?? item?.tenantId ?? opts.tenantId ?? null,
                item?.organization_id ?? item?.organizationId ?? null,
              )
              return { ...item, ...decrypted }
            } catch (err) {
              console.error('Error decrypting entity payload', err)
              return item
            }
          })
        )
      }
      if (encSvc) {
        items = await Promise.all(
          items.map(async (item) => {
            try {
              return await decryptIndexDocCustomFields(
                item,
                {
                  tenantId: item?.tenant_id ?? item?.tenantId ?? opts.tenantId ?? null,
                  organizationId: item?.organization_id ?? item?.organizationId ?? null,
                },
                encSvc as any, dekKeyCache,
              )
            } catch { return item }
          }),
        )
      }

      const typedItems = items as unknown as T[]
      let result: QueryResult<T> = { items: typedItems, page, pageSize, total }
      if (partialIndexWarning) result.meta = { partialIndexWarning }

      result = await applyAfterExtensions(result)
      finishProfile({
        result: 'ok', total, page, pageSize,
        itemCount: Array.isArray(items) ? items.length : undefined,
        partialIndexWarning: partialIndexWarning ? true : false,
      })
      return result
    } catch (err) {
      finishProfile({ result: 'error', error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  private prepareCustomFieldSources(
    sources: QueryCustomFieldSource[],
  ): PreparedCustomFieldSource[] {
    const prepared: PreparedCustomFieldSource[] = []
    sources.forEach((source, index) => {
      if (!source) return
      const joinTable = source.table ?? resolveEntityTableName(this.em, source.entityId)
      const alias = source.alias ?? `cfs_${index}`
      if (!source.join) {
        throw new Error(`QueryEngine: customFieldSources entry for ${String(source.entityId)} requires a join configuration`)
      }
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
    return prepared
  }

  private async isCustomEntity(entity: string): Promise<boolean> {
    try {
      const db = this.getDb() as any
      const row = await db
        .selectFrom('custom_entities')
        .select('id')
        .where('entity_id', '=', entity)
        .where('is_active', '=', true)
        .executeTakeFirst()
      return !!row
    } catch {
      return false
    }
  }

  /**
   * Adds a WHERE EXISTS / OR WHERE EXISTS subquery that matches
   * `search_tokens` for the supplied (entity, field) against the
   * provided record id column.
   *
   * Returns true when the sub-query was applied (i.e. tokens were
   * non-empty). Caller is responsible for the calling context
   * (direct where vs. inside `eb.or([...])`).
   */
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
    }
  ): boolean {
    if (!opts.hashes.length) {
      this.logSearchDebug('search:skip-no-hashes', {
        entity: opts.entity, field: opts.field,
        tenantId: opts.tenantId ?? null, organizationScope: opts.organizationScope,
      })
      return false
    }
    const alias = `st_${this.searchAliasSeq++}`
    this.logSearchDebug('search:apply-search-tokens', {
      entity: opts.entity, field: opts.field, alias,
      tokenCount: opts.hashes.length,
      tenantId: opts.tenantId ?? null,
      organizationScope: opts.organizationScope,
      combineWith: opts.combineWith ?? 'and',
    })

    const engine = this
    const buildSub = (eb: any) => {
      let sub = eb
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

    if (opts.combineWith === 'or') {
      // When called inside an .or([...]) array the caller supplied `eb`.
      // `q` is the ExpressionBuilder callable (eb) itself in that case.
      // We return the expression node rather than mutating q.
      ;(q as any).__pendingOrExists = buildSub(q)
      return true
    }

    // Default: append WHERE EXISTS (...) to the outer builder.
    ;(q as any).__applied = true
    const built = buildSub(q)
    // If q is a Kysely builder (has .where), use eb => eb.exists(sub)
    if (typeof q.where === 'function') {
      ;(q as any) = q.where((eb: any) => eb.exists(built))
    }
    return true
  }

  /** SQL fragment for `cf:<key>` (or legacy bare key) as JSON across a single alias. */
  private jsonbSqlAlias(alias: string, key: string): RawBuilder<unknown> {
    if (key.startsWith('cf:')) {
      const bare = key.slice(3)
      return sql`coalesce(${sql.ref(alias + '.doc')} -> ${key}, ${sql.ref(alias + '.doc')} -> ${bare})`
    }
    return sql`${sql.ref(alias + '.doc')} -> ${key}`
  }

  /** SQL fragment for `cf:<key>` (or legacy bare key) as text across a single alias. */
  private cfTextExprAlias(alias: string, key: string): RawBuilder<string | null> {
    if (key.startsWith('cf:')) {
      const bare = key.slice(3)
      return sql<string | null>`coalesce((${sql.ref(alias + '.doc')} ->> ${key}), (${sql.ref(alias + '.doc')} ->> ${bare}))`
    }
    return sql<string | null>`(${sql.ref(alias + '.doc')} ->> ${key})`
  }

  /** Build JSON/text SQL expressions across multiple index alias sources (coalesce over them). */
  private buildCfJsonExprSql(key: string, sources: IndexDocSource[]): RawBuilder<unknown> | null {
    if (!sources.length) return null
    const parts = sources.map((src) => this.jsonbSqlAlias(src.alias, key))
    if (parts.length === 1) return parts[0]
    return sql`coalesce(${sql.join(parts, sql`, `)})`
  }

  private buildCfTextExprSql(key: string, sources: IndexDocSource[]): RawBuilder<string | null> | null {
    if (!sources.length) return null
    const parts = sources.map((src) => this.cfTextExprAlias(src.alias, key))
    if (parts.length === 1) return parts[0]
    return sql<string | null>`coalesce(${sql.join(parts, sql`, `)})`
  }

  private applyCfFilterAcrossSources(
    builder: AnyBuilder,
    key: string,
    op: FilterOp,
    value: unknown,
    sources: IndexDocSource[],
    search?: SearchRuntime
  ): AnyBuilder {
    if (!sources.length) return builder
    if ((op === 'like' || op === 'ilike') && search?.enabled && typeof value === 'string') {
      const tokens = tokenizeText(String(value), search.config)
      const hashes = tokens.hashes
      if (hashes.length) {
        const applied = this.applyMultiSourceSearchExists(builder, sources, key, hashes, search)
        this.logSearchDebug('search:cf-filter-across', {
          entity: sources.map((src) => src.entityId),
          field: key, tokens: tokens.tokens, hashes, applied,
          tenantId: search.tenantId ?? null, organizationScope: search.organizationScope,
        })
        if (applied.builder !== builder) return applied.builder
      } else {
        this.logSearchDebug('search:cf-skip-empty-hashes', {
          entity: sources.map((src) => src.entityId), field: key, value,
        })
      }
      return builder
    }

    const textExpr = this.buildCfTextExprSql(key, sources)
    const jsonExpr = this.buildCfJsonExprSql(key, sources)
    if (!textExpr || !jsonExpr) return builder

    const arrContains = (val: unknown) => sql<boolean>`${jsonExpr} @> ${JSON.stringify([val])}::jsonb`

    switch (op) {
      case 'eq':
        return builder.where((eb: any) => eb.or([
          sql<boolean>`${textExpr} = ${value}`,
          arrContains(value),
        ]))
      case 'ne':
        return builder.where(sql<boolean>`${textExpr} <> ${value}`)
      case 'in': {
        const values = this.toArray(value)
        return builder.where((eb: any) => eb.or(
          values.flatMap((val) => [
            sql<boolean>`${textExpr} = ${val}`,
            arrContains(val),
          ])
        ))
      }
      case 'nin': {
        const values = this.toArray(value)
        return builder.where(sql<boolean>`${textExpr} not in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`)
      }
      case 'like':
        return builder.where(sql<boolean>`${textExpr} like ${value}`)
      case 'ilike':
        return builder.where(sql<boolean>`${textExpr} ilike ${value}`)
      case 'exists':
        return value
          ? builder.where(sql<boolean>`${textExpr} is not null`)
          : builder.where(sql<boolean>`${textExpr} is null`)
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const operator = sql.raw(op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : '<=')
        return builder.where(sql<boolean>`${textExpr} ${operator} ${value}`)
      }
      default:
        return builder
    }
  }

  /** Apply a search-token EXISTS subquery across multiple sources (OR-joined). */
  private applyMultiSourceSearchExists(
    builder: AnyBuilder,
    sources: IndexDocSource[],
    key: string,
    hashes: string[],
    search: SearchRuntime,
  ): { builder: AnyBuilder; applied: boolean } {
    if (!sources.length || !hashes.length) return { builder, applied: false }
    const next = builder.where((eb: any) => eb.or(
      sources.map((source) =>
        eb.exists(this.buildSearchTokensSub(eb, {
          entity: String(source.entityId),
          field: key, hashes,
          recordIdColumn: `${source.alias}.entity_id`,
          tenantId: search.tenantId ?? null,
          organizationScope: search.organizationScope ?? null,
        }))
      )
    ))
    return { builder: next, applied: true }
  }

  /** Construct a search-token EXISTS subquery using the given ExpressionBuilder. */
  private buildSearchTokensSub(
    eb: any,
    opts: {
      entity: string
      field: string
      hashes: string[]
      recordIdColumn: string
      tenantId?: string | null
      organizationScope?: { ids: string[]; includeNull: boolean } | null
    }
  ): any {
    const alias = `st_${this.searchAliasSeq++}`
    let sub = eb
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
      sub = this.applyOrganizationScope(sub, `${alias}.organization_id`, opts.organizationScope)
    }
    return sub
  }

  private applyCfFilterFromAlias(
    q: AnyBuilder,
    alias: string,
    entityType: string,
    key: string,
    op: FilterOp,
    value: unknown,
    search?: SearchRuntime
  ): AnyBuilder {
    const textExpr = this.cfTextExprAlias(alias, key)
    const arrExpr = sql<unknown>`(${sql.ref(alias + '.doc')} -> ${key})`
    const arrContains = (val: unknown) => sql<boolean>`${arrExpr} @> ${JSON.stringify([val])}::jsonb`

    if ((op === 'like' || op === 'ilike') && search?.enabled && typeof value === 'string') {
      const tokens = tokenizeText(String(value), search.config)
      const hashes = tokens.hashes
      if (hashes.length) {
        const applied = q.where((eb: any) => eb.exists(this.buildSearchTokensSub(eb, {
          entity: entityType, field: key, hashes,
          recordIdColumn: `${alias}.entity_id`,
          tenantId: search.tenantId ?? null,
          organizationScope: search.organizationScope ?? null,
        })))
        this.logSearchDebug('search:cf-filter', {
          entity: entityType, field: key, tokens: tokens.tokens, hashes, applied: true,
          tenantId: search.tenantId ?? null, organizationScope: search.organizationScope,
        })
        return applied
      } else {
        this.logSearchDebug('search:cf-skip-empty-hashes', { entity: entityType, field: key, value })
      }
      return q
    }
    switch (op) {
      case 'eq':
        return q.where((eb: any) => eb.or([
          sql<boolean>`${textExpr} = ${value}`,
          arrContains(value),
        ]))
      case 'ne':
        return q.where(sql<boolean>`${textExpr} <> ${value}`)
      case 'in': {
        const vals = this.toArray(value)
        return q.where((eb: any) => eb.or(
          vals.flatMap((val) => [
            sql<boolean>`${textExpr} = ${val}`,
            arrContains(val),
          ])
        ))
      }
      case 'nin': {
        const vals = this.toArray(value)
        return q.where(sql<boolean>`${textExpr} not in (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`)
      }
      case 'like':
        return q.where(sql<boolean>`${textExpr} like ${value}`)
      case 'ilike':
        return q.where(sql<boolean>`${textExpr} ilike ${value}`)
      case 'exists':
        return value
          ? q.where(sql<boolean>`${textExpr} is not null`)
          : q.where(sql<boolean>`${textExpr} is null`)
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const operator = sql.raw(op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : '<=')
        return q.where(sql<boolean>`${textExpr} ${operator} ${value}`)
      }
      default:
        return q
    }
  }

  private applyIndexDocFilterFromAlias(
    q: AnyBuilder,
    alias: string,
    entityType: string,
    key: string,
    op: FilterOp,
    value: unknown,
    recordIdColumn: string,
    search?: SearchRuntime,
  ): AnyBuilder {
    const textExpr = sql<string | null>`(${sql.ref(alias + '.doc')} ->> ${key})`
    if ((op === 'like' || op === 'ilike') && search?.enabled && typeof value === 'string') {
      const tokens = tokenizeText(String(value), search.config)
      const hashes = tokens.hashes
      if (hashes.length) {
        const applied = q.where((eb: any) => eb.exists(this.buildSearchTokensSub(eb, {
          entity: entityType, field: key, hashes, recordIdColumn,
          tenantId: search.tenantId ?? null,
          organizationScope: search.organizationScope ?? null,
        })))
        this.logSearchDebug('search:index-doc-filter', {
          entity: entityType, field: key, tokens: tokens.tokens, hashes, applied: true,
          tenantId: search.tenantId ?? null, organizationScope: search.organizationScope,
        })
        return applied
      } else {
        this.logSearchDebug('search:index-doc-skip-empty-hashes', { entity: entityType, field: key, value })
      }
      return q
    }
    switch (op) {
      case 'eq':
        return q.where(sql<boolean>`${textExpr} = ${value}`)
      case 'ne':
        return q.where(sql<boolean>`${textExpr} <> ${value}`)
      case 'in': {
        const vals = this.toArray(value)
        return q.where(sql<boolean>`${textExpr} in (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`)
      }
      case 'nin': {
        const vals = this.toArray(value)
        return q.where(sql<boolean>`${textExpr} not in (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`)
      }
      case 'like':
        return q.where(sql<boolean>`${textExpr} like ${value}`)
      case 'ilike':
        return q.where(sql<boolean>`${textExpr} ilike ${value}`)
      case 'exists':
        return value
          ? q.where(sql<boolean>`${textExpr} is not null`)
          : q.where(sql<boolean>`${textExpr} is null`)
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const operator = sql.raw(op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : '<=')
        return q.where(sql<boolean>`${textExpr} ${operator} ${value}`)
      }
      default:
        return q
    }
  }

  /**
   * Build a single OR-group base filter expression as a Kysely predicate
   * (no side effects on the outer builder).
   */
  private buildBaseFilterExpression(
    eb: any,
    filter: BaseFilter,
    resolveBaseColumn: (field: string) => string | null,
    qualify: (col: string) => string,
    entity: EntityId,
    searchRuntime: SearchRuntime,
  ): any {
    const fieldName = String(filter.field)
    const baseField = resolveBaseColumn(fieldName)
    if (!baseField) {
      // Doc-based filter via `ei` alias — returned as EXISTS where possible
      return this.buildIndexDocFilterExpression(eb, 'ei', entity, fieldName, filter.op, filter.value, 'b.id', searchRuntime)
    }
    return this.buildColumnFilterExpression(eb, qualify(baseField), filter.op, filter.value)
  }

  private buildColumnFilterExpression(
    eb: any,
    column: string,
    op: FilterOp,
    value: unknown,
  ): any {
    switch (op) {
      case 'eq': return eb(column, '=', value)
      case 'ne': return eb(column, '!=', value)
      case 'gt': return eb(column, '>', value)
      case 'gte': return eb(column, '>=', value)
      case 'lt': return eb(column, '<', value)
      case 'lte': return eb(column, '<=', value)
      case 'in': return eb(column, 'in', this.toArray(value))
      case 'nin': return eb(column, 'not in', this.toArray(value))
      case 'like': return eb(column, 'like', value)
      case 'ilike': return eb(column, 'ilike', value)
      case 'exists': return eb(column, value ? 'is not' : 'is', null)
      default: return sql<boolean>`true`
    }
  }

  private buildIndexDocFilterExpression(
    eb: any,
    alias: string,
    _entity: EntityId,
    key: string,
    op: FilterOp,
    value: unknown,
    _recordIdColumn: string,
    _search?: SearchRuntime,
  ): any {
    const textExpr = sql<string | null>`(${sql.ref(alias + '.doc')} ->> ${key})`
    switch (op) {
      case 'eq': return sql<boolean>`${textExpr} = ${value}`
      case 'ne': return sql<boolean>`${textExpr} <> ${value}`
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const operator = sql.raw(op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : '<=')
        return sql<boolean>`${textExpr} ${operator} ${value}`
      }
      case 'like': return sql<boolean>`${textExpr} like ${value}`
      case 'ilike': return sql<boolean>`${textExpr} ilike ${value}`
      case 'in': {
        const vals = this.toArray(value)
        return sql<boolean>`${textExpr} in (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`
      }
      case 'nin': {
        const vals = this.toArray(value)
        return sql<boolean>`${textExpr} not in (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`
      }
      case 'exists':
        return value ? sql<boolean>`${textExpr} is not null` : sql<boolean>`${textExpr} is null`
      default:
        return sql<boolean>`true`
    }
  }

  private async queryCustomEntity<T = unknown>(entity: string, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    const db = this.getDb() as any
    const alias = 'ce'

    const orgScope = this.resolveOrganizationScope(opts)
    if (!opts.tenantId) throw new Error('QueryEngine: tenantId is required')

    const searchConfig = resolveSearchConfig()
    const searchEnabled = searchConfig.enabled && await this.tableExists('search_tokens')
    const hasSearchTokens = searchEnabled
      ? await this.hasSearchTokens(entity, opts.tenantId ?? null, orgScope)
      : false
    const searchRuntime: SearchRuntime = {
      enabled: searchEnabled && hasSearchTokens,
      config: searchConfig,
      organizationScope: orgScope,
      tenantId: opts.tenantId ?? null,
    }

    const normalizedFilters = normalizeFilters(opts.filters)

    const applyScope = (q: AnyBuilder): AnyBuilder => {
      let next = q
        .where(`${alias}.entity_type`, '=', entity)
        .where(`${alias}.tenant_id`, '=', opts.tenantId)
      if (orgScope) {
        next = this.applyOrganizationScope(next, `${alias}.organization_id`, orgScope)
      }
      if (!opts.withDeleted) next = next.where(`${alias}.deleted_at`, 'is', null)
      for (const filter of normalizedFilters) {
        if (filter.field.startsWith('cf:')) {
          next = this.applyCfFilterFromAlias(next, alias, entity, filter.field, filter.op, filter.value, searchRuntime)
          continue
        }
        const column = this.resolveCustomEntityColumn(alias, String(filter.field))
        if (column) {
          next = this.applyColumnFilter(next, column, filter, {
            ...searchRuntime, entity, field: String(filter.field), recordIdColumn: `${alias}.entity_id`,
          })
          continue
        }
        // Unknown field → filter on doc JSON text
        const docExpr = sql<string | null>`(${sql.ref(alias + '.doc')} ->> ${String(filter.field)})`
        next = this.applyColumnFilter(next, docExpr, filter, {
          ...searchRuntime, entity, field: String(filter.field), recordIdColumn: `${alias}.entity_id`,
        })
      }
      return next
    }

    // Determine CFs and l10n keys to include
    const cfKeys = new Set<string>()
    for (const f of (opts.fields || [])) {
      if (typeof f === 'string' && f.startsWith('cf:')) cfKeys.add(f.slice(3))
      else if (typeof f === 'string' && f.startsWith('l10n:')) cfKeys.add(f)
    }
    for (const filter of normalizedFilters) {
      if (typeof filter.field === 'string' && filter.field.startsWith('cf:')) cfKeys.add(filter.field.slice(3))
      else if (typeof filter.field === 'string' && filter.field.startsWith('l10n:')) cfKeys.add(filter.field)
    }
    if (opts.includeCustomFields === true) {
      try {
        const rows = await db
          .selectFrom('custom_field_defs')
          .select('key')
          .where('entity_id', '=', entity)
          .where('is_active', '=', true)
          .where('tenant_id', '=', opts.tenantId)
          .execute() as Array<{ key: unknown }>
        for (const row of rows) {
          const key = row.key
          if (typeof key === 'string') cfKeys.add(key)
          else if (key != null) cfKeys.add(String(key))
        }
      } catch {
        // ignore
      }
    } else if (Array.isArray(opts.includeCustomFields)) {
      for (const k of opts.includeCustomFields) cfKeys.add(k)
    }

    const applySelection = (q: AnyBuilder): AnyBuilder => {
      let next = q
      const requested = (opts.fields && opts.fields.length) ? opts.fields : ['id']
      for (const field of requested) {
        const f = String(field)
        if (f.startsWith('cf:')) {
          const aliasName = this.sanitize(f)
          next = next.select(this.jsonbSqlAlias(alias, f).as(aliasName))
        } else if (f === 'id') {
          next = next.select(`${alias}.entity_id as id`)
        } else if (f === 'created_at' || f === 'updated_at' || f === 'deleted_at') {
          next = next.select(`${alias}.${f} as ${f}`)
        } else {
          const expr = sql<string | null>`(${sql.ref(alias + '.doc')} ->> ${f})`
          next = next.select(expr.as(f))
        }
      }
      // Ensure CF fields for sort / includeCustomFields are selected
      for (const key of cfKeys) {
        const aliasName = this.sanitize(`cf:${key}`)
        next = next.select(this.jsonbSqlAlias(alias, `cf:${key}`).as(aliasName))
      }
      return next
    }

    const applySort = (q: AnyBuilder): AnyBuilder => {
      let next = q
      for (const s of opts.sort || []) {
        if (s.field.startsWith('cf:')) {
          const key = s.field.slice(3)
          const aliasName = this.sanitize(`cf:${key}`)
          next = next.orderBy(aliasName, s.dir ?? SortDir.Asc)
        } else if (s.field === 'id') {
          next = next.orderBy(`${alias}.entity_id`, s.dir ?? SortDir.Asc)
        } else if (s.field === 'created_at' || s.field === 'updated_at' || s.field === 'deleted_at') {
          next = next.orderBy(`${alias}.${s.field}`, s.dir ?? SortDir.Asc)
        } else {
          const direction = sql.raw(String(s.dir ?? SortDir.Asc))
          next = next.orderBy(sql`(${sql.ref(alias + '.doc')} ->> ${s.field}) ${direction}`)
        }
      }
      return next
    }

    const page = opts.page?.page ?? 1
    const pageSize = opts.page?.pageSize ?? 20

    const root = db.selectFrom(`custom_entities_storage as ${alias}`)
    const countQuery = applyScope(root).select(sql<string>`count(distinct ${sql.ref(`${alias}.entity_id`)})`.as('count'))
    const countRow = await countQuery.executeTakeFirst()
    const total = this.parseCount(countRow)

    let dataQuery = applyScope(db.selectFrom(`custom_entities_storage as ${alias}`))
    dataQuery = applySelection(dataQuery)
    dataQuery = applySort(dataQuery)
    dataQuery = dataQuery.limit(pageSize).offset((page - 1) * pageSize)
    const items = await dataQuery.execute()
    return { items, page, pageSize, total }
  }

  private async tableExists(table: string): Promise<boolean> {
    const db = this.getDb() as any
    const exists = await db
      .selectFrom('information_schema.tables')
      .select(sql<number>`1`.as('one'))
      .where('table_name', '=', table)
      .executeTakeFirst()
    return !!exists
  }

  private async hasSearchTokens(
    entity: string,
    tenantId: string | null,
    orgScope?: { ids: string[]; includeNull: boolean } | null
  ): Promise<boolean> {
    try {
      const db = this.getDb() as any
      let query = db
        .selectFrom('search_tokens')
        .select(sql<number>`1`.as('one'))
        .where('entity_type', '=', entity)
      if (tenantId !== undefined) {
        query = query.where(sql<boolean>`tenant_id is not distinct from ${tenantId}`)
      }
      if (orgScope) {
        query = this.applyOrganizationScope(query, 'search_tokens.organization_id', orgScope)
      }
      const row = await query.limit(1).executeTakeFirst()
      return !!row
    } catch (err) {
      this.logSearchDebug('search:has-tokens-error', {
        entity, tenantId, organizationScope: orgScope,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }

  private async searchSourcesHaveTokens(
    sources: SearchTokenSource[],
    tenantId: string | null,
    orgScope?: { ids: string[]; includeNull: boolean } | null
  ): Promise<boolean> {
    for (const source of sources) {
      const ok = await this.hasSearchTokens(source.entity, tenantId, orgScope)
      this.logSearchDebug('search:source-has-tokens', {
        entity: source.entity, recordIdColumn: source.recordIdColumn,
        tenantId, organizationScope: orgScope, hasTokens: ok,
      })
      if (ok) return true
    }
    return false
  }

  private async resolveAvailableCustomFieldKeys(entityIds: string[], tenantId: string | null): Promise<string[]> {
    if (!entityIds.length) return []
    const cacheKey = this.customFieldKeysCacheKey(entityIds, tenantId)
    const now = Date.now()
    const cached = this.customFieldKeysCache.get(cacheKey)
    if (cached && cached.expiresAt > now) return cached.value.slice()

    const db = this.getDb() as any
    const rows = await db
      .selectFrom('custom_field_defs')
      .select('key')
      .where('entity_id', 'in', entityIds)
      .where('is_active', '=', true)
      .where((eb: any) => eb.or([
        eb('tenant_id', '=', tenantId),
        eb('tenant_id', 'is', null),
      ]))
      .execute() as Array<{ key: unknown }>
    const keys = new Set<string>()
    for (const row of rows) {
      const key = row.key
      if (typeof key === 'string' && key.trim().length) keys.add(key.trim())
      else if (key != null) keys.add(String(key))
    }
    const result = Array.from(keys)
    if (this.customFieldKeysTtlMs > 0) {
      this.customFieldKeysCache.set(cacheKey, { expiresAt: now + this.customFieldKeysTtlMs, value: result })
    }
    return result.slice()
  }

  private async entityHasActiveCustomFields(entityId: string, tenantId: string | null): Promise<boolean> {
    try {
      const keys = await this.resolveAvailableCustomFieldKeys([entityId], tenantId)
      return keys.length > 0
    } catch (err) {
      if (this.isDebugVerbosity()) {
        this.debug('query:cf:check-error', {
          entity: entityId, tenantId: tenantId ?? null,
          error: err instanceof Error ? err.message : err,
        })
      }
      return true
    }
  }

  private customFieldKeysCacheKey(entityIds: string[], tenantId: string | null): string {
    const sorted = entityIds.slice().sort((a, b) => a.localeCompare(b)).join(',')
    return `${tenantId ?? '__none__'}|${sorted}`
  }

  private resolveVectorService(): VectorIndexService | null {
    if (!this.vectorServiceResolver) return null
    try {
      return this.vectorServiceResolver() ?? null
    } catch {
      return null
    }
  }

  private resolveEntityLabel(entity: string): string {
    return entity
  }

  private async indexAnyRows(entity: string): Promise<boolean> {
    const db = this.getDb() as any
    const coverage = await db
      .selectFrom('entity_index_coverage')
      .select(sql<number>`1`.as('one'))
      .where('entity_type', '=', entity)
      .where('indexed_count', '>', 0)
      .executeTakeFirst()
    if (coverage) return true
    const exists = await db
      .selectFrom('entity_indexes')
      .select('entity_id')
      .where('entity_type', '=', entity)
      .executeTakeFirst()
    return !!exists
  }

  private async getStoredCoverageSnapshot(
    entity: string,
    tenantId: string | null,
    organizationId: string | null,
    withDeleted: boolean
  ): Promise<{ baseCount: number; indexedCount: number } | null> {
    try {
      if (!this.isCoverageOptimizationEnabled()) {
        await refreshCoverageSnapshot(this.em, {
          entityType: entity, tenantId, organizationId, withDeleted,
        })
      }
      const db = this.getDb()
      const row = await readCoverageSnapshot(db as any, {
        entityType: entity, tenantId, organizationId, withDeleted,
      })
      if (!row) return null
      return { baseCount: row.baseCount, indexedCount: row.indexedCount }
    } catch (err) {
      if (this.isDebugVerbosity()) {
        this.debug('coverage:snapshot:read-error', {
          entity, tenantId, organizationId, withDeleted,
          error: err instanceof Error ? err.message : err,
        })
      }
      return null
    }
  }

  private scheduleAutoReindex(
    entity: string,
    opts: QueryOptions,
    stats?: { baseCount: number; indexedCount: number },
    organizationIdOverride?: string | null
  ) {
    if (!this.isAutoReindexEnabled()) return
    const bus = this.resolveEventBus()
    if (!bus) return
    const payload = {
      entityType: entity,
      tenantId: opts.tenantId ?? null,
      organizationId: organizationIdOverride ?? opts.organizationId ?? null,
      force: false,
    }
    const context = stats
      ? { entity, tenantId: payload.tenantId, organizationId: payload.organizationId, baseCount: stats.baseCount, indexedCount: stats.indexedCount }
      : { entity, tenantId: payload.tenantId, organizationId: payload.organizationId }

    void Promise.resolve().then(async () => {
      try {
        await bus.emitEvent('query_index.reindex', payload, { persistent: true })
        if (this.isDebugVerbosity()) this.debug('query:auto-reindex:scheduled', context)
      } catch (err) {
        console.warn('[HybridQueryEngine] Failed to schedule auto reindex:', {
          ...context, error: err instanceof Error ? err.message : err,
        })
      }
    })
  }

  private scheduleCoverageRefresh(
    entity: string,
    tenantId: string | null | undefined,
    organizationId: string | null | undefined,
    withDeleted: boolean
  ): void {
    const bus = this.resolveEventBus()
    if (!bus) return
    const key = [entity, tenantId ?? '__tenant__', organizationId ?? '__org__', withDeleted ? '1' : '0'].join('|')
    if (this.pendingCoverageRefreshKeys.has(key)) return
    this.pendingCoverageRefreshKeys.add(key)
    void Promise.resolve()
      .then(async () => {
        try {
          await bus.emitEvent('query_index.coverage.refresh', {
            entityType: entity,
            tenantId: tenantId ?? null, organizationId: organizationId ?? null,
            withDeleted, delayMs: 0,
          })
          if (this.isDebugVerbosity()) {
            this.debug('coverage:refresh:scheduled', {
              entity, tenantId: tenantId ?? null, organizationId: organizationId ?? null, withDeleted,
            })
          }
        } catch (err) {
          if (this.isDebugVerbosity()) {
            this.debug('coverage:refresh:failed', {
              entity, tenantId: tenantId ?? null, organizationId: organizationId ?? null, withDeleted,
              error: err instanceof Error ? err.message : err,
            })
          }
        }
      })
      .finally(() => { this.pendingCoverageRefreshKeys.delete(key) })
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
    const raw = (process.env.SCHEDULE_AUTO_REINDEX ?? process.env.QUERY_INDEX_AUTO_REINDEX ?? '').trim().toLowerCase()
    if (!raw) { this.autoReindexEnabled = true; return true }
    const parsed = parseBooleanToken(raw)
    this.autoReindexEnabled = parsed === null ? true : parsed
    return this.autoReindexEnabled
  }

  private isCoverageOptimizationEnabled(): boolean {
    if (this.coverageOptimizationEnabled != null) return this.coverageOptimizationEnabled
    const raw = (process.env.OPTIMIZE_INDEX_COVERAGE_STATS ?? '').trim().toLowerCase()
    if (!raw) { this.coverageOptimizationEnabled = false; return false }
    this.coverageOptimizationEnabled = parseBooleanToken(raw) === true
    return this.coverageOptimizationEnabled
  }

  private async columnExists(table: string, column: string): Promise<boolean> {
    const key = `${table}.${column}`
    if (this.columnCache.has(key)) {
      const cached = this.columnCache.get(key)
      if (cached === true) return true
      this.columnCache.delete(key)
    }
    const db = this.getDb() as any
    const exists = await db
      .selectFrom('information_schema.columns')
      .select(sql<number>`1`.as('one'))
      .where('table_name', '=', table)
      .where('column_name', '=', column)
      .executeTakeFirst()
    const present = !!exists
    if (present) this.columnCache.set(key, true)
    else this.columnCache.delete(key)
    return present
  }

  private async getBaseColumnsForEntity(entity: string): Promise<Map<string, string>> {
    const db = this.getDb() as any
    const table = resolveEntityTableName(this.em, entity)
    const rows = await db
      .selectFrom('information_schema.columns')
      .select(['column_name', 'data_type'])
      .where('table_name', '=', table)
      .execute() as Array<{ column_name: string; data_type: string }>
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

  private resolveCoverageSnapshotScope(
    opts: QueryOptions
  ): { tenantId: string | null; organizationId: string | null } | null {
    const tenantId = opts.tenantId ?? null
    const orgScope = this.resolveOrganizationScope(opts)
    if (!orgScope) return { tenantId, organizationId: null }
    if (orgScope.includeNull) {
      if (orgScope.ids.length === 0) return { tenantId, organizationId: null }
      return null
    }
    if (orgScope.ids.length === 1) return { tenantId, organizationId: orgScope.ids[0] }
    if (orgScope.ids.length === 0) return { tenantId, organizationId: null }
    return null
  }

  private applyOrganizationScope(
    q: AnyBuilder,
    column: string,
    scope: { ids: string[]; includeNull: boolean }
  ): AnyBuilder {
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

  private normalizeFilters(filters?: QueryOptions['filters']): NormalizedFilter[] {
    if (!filters) return []
    const normalizeField = (k: string) => k.startsWith('cf_') ? `cf:${k.slice(3)}` : k
    if (Array.isArray(filters)) {
      return (filters as Filter[]).map((filter) => ({
        field: normalizeField(String(filter.field)),
        op: filter.op, value: filter.value,
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
    if (Array.isArray(value)) return value
    if (value === undefined) return []
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
      if (typeof value === 'bigint') return Number(value)
    }
    return 0
  }

  private logSearchDebug(event: string, payload: Record<string, unknown>) {
    if (!this.isDebugVerbosity()) return
    try {
      console.info('[query-index:search]', event, JSON.stringify(payload))
    } catch {
      console.info('[query-index:search]', event, payload)
    }
  }

  private applyColumnFilter(
    q: AnyBuilder,
    column: string | RawBuilder<unknown>,
    filter: NormalizedFilter,
    search?: SearchRuntime & { entity: string; field: string; recordIdColumn?: string },
  ): AnyBuilder {
    if (
      (filter.op === 'like' || filter.op === 'ilike') &&
      search?.enabled &&
      typeof filter.value === 'string'
    ) {
      const tokens = tokenizeText(String(filter.value), search.config)
      const hashes = tokens.hashes
      if (hashes.length) {
        const sources: SearchTokenSource[] = (search.searchSources && search.searchSources.length
          ? search.searchSources
          : [{ entity: search.entity, recordIdColumn: search.recordIdColumn ?? '' }]
        ).filter((src) => src.recordIdColumn && src.entity)
        if (sources.length) {
          const engine = this
          q = q.where((eb: any) => eb.or(
            sources.map((src) =>
              eb.exists(engine.buildSearchTokensSub(eb, {
                entity: src.entity, field: search.field, hashes,
                recordIdColumn: src.recordIdColumn,
                tenantId: search.tenantId ?? null,
                organizationScope: search.organizationScope ?? null,
              })))
          ))
          this.logSearchDebug('search:filter', {
            entity: search.entity, field: search.field, tokens: tokens.tokens, hashes,
            applied: true, tenantId: search.tenantId ?? null,
            organizationScope: search.organizationScope,
            sources: sources.map((src) => ({ entity: src.entity, recordIdColumn: src.recordIdColumn })),
          })
          return q
        }
      } else {
        this.logSearchDebug('search:skip-empty-hashes', {
          entity: search.entity, field: search.field, value: filter.value,
        })
      }
      return q
    }
    const col: any = column
    switch (filter.op) {
      case 'eq': return q.where(col, '=', filter.value as any)
      case 'ne': return q.where(col, '!=', filter.value as any)
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const operator = filter.op === 'gt' ? '>' : filter.op === 'gte' ? '>=' : filter.op === 'lt' ? '<' : '<='
        return q.where(col, operator, filter.value as any)
      }
      case 'in':
        return q.where(col, 'in', this.toArray(filter.value))
      case 'nin':
        return q.where(col, 'not in', this.toArray(filter.value))
      case 'like':
        return q.where(col, 'like', filter.value as any)
      case 'ilike':
        return q.where(col, 'ilike', filter.value as any)
      case 'exists':
        return filter.value ? q.where(col, 'is not', null) : q.where(col, 'is', null)
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
    this.debugVerbosity = resolveDebugVerbosity()
    return this.debugVerbosity
  }

  private isSqlDebugEnabled(): boolean {
    if (this.sqlDebugEnabled != null) return this.sqlDebugEnabled
    this.sqlDebugEnabled = resolveBooleanEnv(['QUERY_ENGINE_DEBUG_SQL'], false)
    return this.sqlDebugEnabled
  }

  private isForcePartialIndexEnabled(): boolean {
    if (this.forcePartialIndexEnabled != null) return this.forcePartialIndexEnabled
    this.forcePartialIndexEnabled = resolveBooleanEnv(['FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES'], false)
    return this.forcePartialIndexEnabled
  }

  private async resolveCoverageGap(
    entity: string,
    opts: QueryOptions,
    coverageScope?: { tenantId: string | null; organizationId: string | null } | null,
    _sourceTable?: string
  ): Promise<{ stats?: { baseCount: number; indexedCount: number }; scope: 'scoped' | 'global' } | null> {
    const scope = coverageScope ?? this.resolveCoverageSnapshotScope(opts)
    if (!scope) return null
    const tenantId = scope.tenantId
    const organizationId = scope.organizationId
    const withDeleted = !!opts.withDeleted

    const snapshot = await this.getStoredCoverageSnapshot(entity, tenantId, organizationId, withDeleted)
    if (!snapshot) {
      this.scheduleCoverageRefresh(entity, tenantId, organizationId, withDeleted)
      return { stats: undefined, scope: 'scoped' }
    }

    const baseCount = snapshot.baseCount
    const indexCount = snapshot.indexedCount
    const hasGap = baseCount > 0 && indexCount < baseCount
    if (hasGap || indexCount > baseCount) return { stats: snapshot, scope: 'scoped' }
    return null
  }

  // Backward-compatible hook for tests that mock coverage stats
  private async indexCoverageStats(
    entity: string,
    opts: QueryOptions,
    coverageScope?: { tenantId: string | null; organizationId: string | null } | null,
  ): Promise<{ baseCount: number; indexedCount: number } | null> {
    const gap = await this.resolveCoverageGap(entity, opts, coverageScope)
    return gap?.stats ?? null
  }

  private async captureSqlTiming<TResult>(
    label: string,
    entity: EntityId,
    execute: () => Promise<TResult> | TResult,
    extra?: Record<string, unknown>,
    profiler?: Profiler
  ): Promise<TResult> {
    const shouldDebug = this.isSqlDebugEnabled() && this.isDebugVerbosity()
    const shouldProfile = profiler?.enabled === true
    if (!shouldDebug && !shouldProfile) return Promise.resolve(execute())
    const startedAt = process.hrtime.bigint()
    try {
      return await Promise.resolve(execute())
    } finally {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
      const context: Record<string, unknown> = { entity, durationMs: Math.round(elapsedMs * 1000) / 1000 }
      if (extra) Object.assign(context, extra)
      if (shouldProfile) profiler!.record(label, context.durationMs as number, extra)
      if (shouldDebug) this.debug(`${label}:timing`, context)
    }
  }

  private debug(message: string, context?: Record<string, unknown>): void {
    if (!this.isDebugVerbosity()) return
    if (!this.isSqlDebugEnabled()) return
    if (context) console.debug('[HybridQueryEngine]', message, context)
    else console.debug('[HybridQueryEngine]', message)
  }
}
