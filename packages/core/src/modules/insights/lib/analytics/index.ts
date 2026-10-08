import type { EntityManager } from '@mikro-orm/postgresql'
import { z, type ZodType } from 'zod'
import type { CacheStrategy } from '@open-mercato/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { getProcessRegistry, type ProcessRegistrySnapshot, type RegisteredProcess } from '../process/registry'
import { createServiceResolver, type XrayContainer } from '../projection/runtime'
import type { ProjectionScope, XrayDatabase } from '../projection/types'
import { buildBottlenecks } from './bottlenecks'
import { buildBreakdown } from './breakdown'
import {
  analyticsCacheTags,
  buildAnalyticsCacheKey,
  createAnalyticsCache,
  permissionFingerprint,
  type AnalyticsCacheState,
} from './cache'
import { emptyDataset, foldScopeSettings, loadLiveDataset, type LiveComputeInput, type LiveDataset } from './compute'
import { buildConformance } from './conformance'
import { buildProcessMap } from './dfg'
import { buildDurations } from './durations'
import {
  AnalyticsIndividualsDeniedError,
  AnalyticsInvalidRequestError,
  AnalyticsProcessNotFoundError,
  isXrayAnalyticsError,
} from './errors'
import { assertIndividualsAllowed, isAccessLogWriter, recordIndividualsAccess, type AccessLogWriter } from './privacy'
import {
  listActiveProcessKeys,
  listCaseIds,
  listProjectedOrganizations,
  readComputedThrough,
  runAnalyticsQuery,
  type AnalyticsDb,
  type CaseListCursor,
} from './query'
import { buildRework } from './rework'
import { markRollupsInvalidated, readFreshRollup, upsertRollup } from './rollups'
import { createEntityManagerSettingsLoader, type XraySettingsLoader } from './settings'
import { buildVariants, limitVariants } from './variants'
import { resolveDefaultWindow, resolveWindow, toWindowView, type ResolvedWindow } from './window'
import {
  XRAY_ANALYTICS_LIMITS,
  XRAY_ROLLUP_METRICS_VERSION,
  XRAY_ROLLUP_STATEMENT_TIMEOUT_MS,
  XRAY_STATEMENT_TIMEOUT_MS,
  XRAY_WINDOW_KEYS,
  analyticsRequestSchema,
  bottlenecksResultSchema,
  breakdownRequestSchema,
  breakdownResultSchema,
  conformanceRequestSchema,
  conformanceResultSchema,
  durationsResultSchema,
  listCasesRequestSchema,
  processMapResultSchema,
  reworkResultSchema,
  variantsRequestSchema,
  variantsResultSchema,
  type AnalyticsFilters,
  type AnalyticsRequest,
  type AnalyticsRequestInput,
  type BottlenecksResult,
  type BreakdownRequestInput,
  type BreakdownResult,
  type CaseListResult,
  type ConformanceRequestInput,
  type ConformanceResult,
  type DurationsResult,
  type ListCasesRequestInput,
  type ProcessMapResult,
  type ReworkResult,
  type RollupMetrics,
  type ScopeSettings,
  type VariantsRequestInput,
  type VariantsResult,
} from './types'

export * from './errors'
export * from './types'
export { comparisonWindows, resolveDefaultWindow, resolveWindow, type ResolvedWindow } from './window'
export { sequenceModel, evaluateConformance, type ConformanceTrace } from './conformance'
export { checkIndividualsGate, XRAY_INDIVIDUALS_RESOURCE_KIND, type AccessLogWriter } from './privacy'
export { createEntityManagerSettingsLoader, type XraySettingsLoader } from './settings'
export { createAnalyticsCacheState, type AnalyticsCacheState } from './cache'

export type XrayAnalyticsDeps = {
  db: AnalyticsDb
  loadSettings: XraySettingsLoader
  registry?: () => ProcessRegistrySnapshot
  cache?: CacheStrategy | null
  cacheState?: AnalyticsCacheState
  accessLog?: AccessLogWriter | null
  clock?: () => number
  timeoutMs?: number
  rollupTimeoutMs?: number
  maxEvents?: number
}

export type RollupPassResult = {
  processes: number
  written: number
  skipped: number
}

const logger = createLogger('insights').child({ component: 'xray-analytics' })

export type XrayAnalytics = {
  getProcessMap: (input: AnalyticsRequestInput) => Promise<ProcessMapResult>
  getVariants: (input: VariantsRequestInput) => Promise<VariantsResult>
  getDurations: (input: AnalyticsRequestInput) => Promise<DurationsResult>
  getBottlenecks: (input: AnalyticsRequestInput) => Promise<BottlenecksResult>
  getRework: (input: AnalyticsRequestInput) => Promise<ReworkResult>
  getConformance: (input: ConformanceRequestInput) => Promise<ConformanceResult>
  getBreakdown: (input: BreakdownRequestInput) => Promise<BreakdownResult>
  listCases: (input: ListCasesRequestInput) => Promise<CaseListResult>
  computeRollups: (scope: ProjectionScope, options?: { timeZone?: string }) => Promise<RollupPassResult>
  invalidate: (scope: ProjectionScope) => Promise<void>
}

type PreparedRequest<TRequest extends AnalyticsRequest> = {
  request: TRequest
  registry: ProcessRegistrySnapshot
  process: RegisteredProcess
  registeredKeys: string[]
  window: ResolvedWindow
  nowMs: number
  organizationIds: string[] | null
  settings: ScopeSettings
  empty: boolean
}

const caseCursorSchema = z.object({
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id: z.string().uuid(),
})

export function encodeCaseCursor(cursor: CaseListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeCaseCursor(value: string): CaseListCursor | null {
  try {
    const parsed = caseCursorSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function parseRequest<TSchema extends ZodType>(schema: TSchema, input: unknown): z.infer<TSchema> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new AnalyticsInvalidRequestError(parsed.error.issues.map((issue) => issue.path.join('.') || 'request'))
  return parsed.data
}

function hasDefaultFilters(filters: AnalyticsFilters): boolean {
  return !filters.causeKinds && !filters.actorRoleIds && !filters.actorTeamIds && filters.includeSyncRun !== true
}

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right))
}

/**
 * Process X-Ray analytics over the projection (insights_process_* tables). Every call: input
 * validated with zod; the process must be registered (only registered process keys are read);
 * the organization scope mirrors `resolveOrganizationScopeFilter` (`null` = tenant-wide, `[]` =
 * nothing, a list = `organization_id IN (...)`); the window is ≤ 180 days; reads run in a
 * read-only snapshot under a 5 s statement timeout; results carry `n`, `lowConfidence`,
 * `computedThrough` and suppression markers. Results are cached per tenant, organization
 * filter, permission fingerprint, settings and parameters (single-flight, tag invalidation);
 * default windows of a single organization are served from fresh rollups when available.
 * Per-person breakdowns pass the individuals gate and write an access log row first.
 * Feature checks of the process root (`requiredFeatures`) are the caller's job (RBAC).
 */
export function createXrayAnalytics(deps: XrayAnalyticsDeps): XrayAnalytics {
  const registryOf = deps.registry ?? getProcessRegistry
  const clock = deps.clock ?? Date.now
  const analyticsCache = createAnalyticsCache(deps.cache ?? null, deps.cacheState)
  const timeoutMs = deps.timeoutMs ?? XRAY_STATEMENT_TIMEOUT_MS
  const rollupTimeoutMs = deps.rollupTimeoutMs ?? XRAY_ROLLUP_STATEMENT_TIMEOUT_MS

  async function resolveSettings(tenantId: string, organizationIds: string[] | null): Promise<ScopeSettings> {
    if (organizationIds !== null && organizationIds.length === 0) return foldScopeSettings([], new Map())
    const scopeOrganizations = organizationIds ?? await listProjectedOrganizations(deps.db, tenantId)
    return foldScopeSettings(scopeOrganizations, await deps.loadSettings(tenantId, scopeOrganizations))
  }

  async function prepare<TSchema extends ZodType<AnalyticsRequest>>(
    schema: TSchema,
    input: unknown,
    precheck?: (request: z.infer<TSchema>) => void,
  ): Promise<PreparedRequest<z.infer<TSchema>>> {
    const request = parseRequest(schema, input)
    const registry = registryOf()
    const process = registry.ready ? registry.processes.find((candidate) => candidate.processKey === request.processKey) ?? null : null
    if (!process) throw new AnalyticsProcessNotFoundError()
    precheck?.(request)
    const nowMs = clock()
    const window = resolveWindow(request.window, { nowMs, timeZone: request.timeZone })
    const organizationIds = request.scope.organizationIds === null ? null : sortedUnique(request.scope.organizationIds)
    const settings = await resolveSettings(request.scope.tenantId, organizationIds)
    return {
      request,
      registry,
      process,
      registeredKeys: registry.processes.map((candidate) => candidate.processKey),
      window,
      nowMs,
      organizationIds,
      settings,
      empty: organizationIds !== null && organizationIds.length === 0,
    }
  }

  function liveInput<TRequest extends AnalyticsRequest>(prepared: PreparedRequest<TRequest>): LiveComputeInput {
    return {
      scope: { tenantId: prepared.request.scope.tenantId, organizationIds: prepared.organizationIds },
      process: prepared.process,
      registeredKeys: prepared.registeredKeys,
      window: prepared.window,
      filters: prepared.request.filters,
      settings: prepared.settings,
      nowMs: prepared.nowMs,
      source: 'live',
    }
  }

  async function computeLive<TRequest extends AnalyticsRequest, TResult>(
    prepared: PreparedRequest<TRequest>,
    options: { census: boolean },
    build: (dataset: LiveDataset) => TResult,
  ): Promise<TResult> {
    const input = liveInput(prepared)
    if (prepared.empty) return build(emptyDataset(input))
    return runAnalyticsQuery(
      deps.db,
      async (trx) => build(await loadLiveDataset(trx, input, { census: options.census, maxEvents: deps.maxEvents })),
      { timeoutMs },
    )
  }

  async function readRollup<TRequest extends AnalyticsRequest>(prepared: PreparedRequest<TRequest>): Promise<RollupMetrics | null> {
    const organizationIds = prepared.organizationIds
    if (!prepared.window.windowKey || organizationIds === null || organizationIds.length !== 1) return null
    if (!hasDefaultFilters(prepared.request.filters)) return null
    return runAnalyticsQuery(deps.db, (trx) => readFreshRollup(trx, {
      scope: { tenantId: prepared.request.scope.tenantId, organizationId: organizationIds[0] },
      processKey: prepared.process.processKey,
      window: prepared.window,
      contractHash: prepared.registry.contractHash,
      settingsFingerprint: prepared.settings.fingerprint,
    }), { timeoutMs })
  }

  function cached<TRequest extends AnalyticsRequest, TResult>(
    prepared: PreparedRequest<TRequest>,
    operation: string,
    params: Record<string, unknown>,
    schema: ZodType<TResult>,
    perPerson: boolean,
    compute: () => Promise<TResult>,
  ): Promise<TResult> {
    const request = prepared.request
    const key = buildAnalyticsCacheKey({
      tenantId: request.scope.tenantId,
      organizationIds: prepared.organizationIds,
      permissionFingerprint: permissionFingerprint(request.viewer, { perPerson }),
      settingsFingerprint: prepared.settings.fingerprint,
      operation,
      params: {
        ...params,
        processKey: prepared.process.processKey,
        contractHash: prepared.registry.contractHash,
        window: toWindowView(prepared.window),
        filters: request.filters,
      },
    })
    return analyticsCache.getOrCompute(
      { key, tenantId: request.scope.tenantId, tags: analyticsCacheTags(prepared.organizationIds), schema },
      compute,
    )
  }

  async function rolledUp<TResult>(
    prepared: PreparedRequest<AnalyticsRequest>,
    pick: (metrics: RollupMetrics) => TResult,
    live: () => Promise<TResult>,
  ): Promise<TResult> {
    const metrics = await readRollup(prepared)
    if (metrics) return pick(metrics)
    return live()
  }

  async function getProcessMap(input: AnalyticsRequestInput): Promise<ProcessMapResult> {
    const prepared = await prepare(analyticsRequestSchema, input)
    return cached(prepared, 'map', {}, processMapResultSchema, false, () => rolledUp(
      prepared,
      (metrics) => metrics.results.map,
      () => computeLive(prepared, { census: false }, (dataset) => buildProcessMap(dataset.prepared, dataset.context)),
    ))
  }

  async function getVariants(input: VariantsRequestInput): Promise<VariantsResult> {
    const prepared = await prepare(variantsRequestSchema, input)
    const limit = prepared.request.limit
    return cached(prepared, 'variants', { limit }, variantsResultSchema, false, () => rolledUp(
      prepared,
      (metrics) => limitVariants(metrics.results.variants, limit),
      () => computeLive(prepared, { census: false }, (dataset) => buildVariants(dataset.prepared, dataset.context, limit)),
    ))
  }

  async function getDurations(input: AnalyticsRequestInput): Promise<DurationsResult> {
    const prepared = await prepare(analyticsRequestSchema, input)
    return cached(prepared, 'durations', {}, durationsResultSchema, false, () => rolledUp(
      prepared,
      (metrics) => metrics.results.durations,
      () => computeLive(prepared, { census: true }, (dataset) => buildDurations(dataset.prepared, dataset.context, dataset.census)),
    ))
  }

  async function getBottlenecks(input: AnalyticsRequestInput): Promise<BottlenecksResult> {
    const prepared = await prepare(analyticsRequestSchema, input)
    return cached(prepared, 'bottlenecks', {}, bottlenecksResultSchema, false, () => rolledUp(
      prepared,
      (metrics) => metrics.results.bottlenecks,
      () => computeLive(prepared, { census: false }, (dataset) => buildBottlenecks(dataset.prepared, dataset.context)),
    ))
  }

  async function getRework(input: AnalyticsRequestInput): Promise<ReworkResult> {
    const prepared = await prepare(analyticsRequestSchema, input)
    return cached(prepared, 'rework', {}, reworkResultSchema, false, () => rolledUp(
      prepared,
      (metrics) => metrics.results.rework,
      () => computeLive(prepared, { census: false }, (dataset) => buildRework(dataset.prepared, dataset.context)),
    ))
  }

  async function getConformance(input: ConformanceRequestInput): Promise<ConformanceResult> {
    const prepared = await prepare(conformanceRequestSchema, input)
    const { models, caseModelKeys } = prepared.request
    return cached(prepared, 'conformance', { models, caseModelKeys: caseModelKeys ?? null }, conformanceResultSchema, false, () => computeLive(
      prepared,
      { census: false },
      (dataset) => buildConformance(dataset.prepared, dataset.context, { models, caseModelKeys }),
    ))
  }

  async function getBreakdown(input: BreakdownRequestInput): Promise<BreakdownResult> {
    const prepared = await prepare(breakdownRequestSchema, input, (request) => {
      if (request.groupBy !== 'user') return
      if (!request.viewer.canViewIndividuals) throw new AnalyticsIndividualsDeniedError('feature_missing')
      if (!request.viewer.userId) throw new AnalyticsIndividualsDeniedError('viewer_unknown')
    })
    const groupBy = prepared.request.groupBy
    const perPerson = groupBy === 'user'
    if (perPerson) assertIndividualsAllowed(prepared.request.viewer, prepared.settings)
    const result = await cached(prepared, 'breakdown', { groupBy }, breakdownResultSchema, perPerson, () => computeLive(
      prepared,
      { census: false },
      (dataset) => buildBreakdown(dataset.prepared, dataset.context, groupBy),
    ))
    if (perPerson) {
      await recordIndividualsAccess(deps.accessLog ?? null, {
        tenantId: prepared.request.scope.tenantId,
        organizationIds: prepared.settings.organizationIds,
        viewer: prepared.request.viewer,
        processKey: prepared.process.processKey,
        purpose: 'breakdown:user',
        window: toWindowView(prepared.window),
      })
    }
    return result
  }

  async function listCases(input: ListCasesRequestInput): Promise<CaseListResult> {
    const prepared = await prepare(listCasesRequestSchema, input)
    const request = prepared.request
    const after = request.cursor ? decodeCaseCursor(request.cursor) : null
    if (request.cursor && !after) throw new AnalyticsInvalidRequestError(['cursor'])
    const base = {
      processKey: prepared.process.processKey,
      organizationIds: prepared.organizationIds,
      window: toWindowView(prepared.window),
    }
    if (prepared.empty) return { ...base, n: 0, computedThrough: null, items: [], nextCursor: null }
    const scope = { tenantId: request.scope.tenantId, organizationIds: prepared.organizationIds }
    return runAnalyticsQuery(deps.db, async (trx) => {
      const computedThrough = await readComputedThrough(trx, scope)
      const page = await listCaseIds(trx, {
        scope,
        processKey: prepared.process.processKey,
        registeredKeys: prepared.registeredKeys,
        from: prepared.window.from,
        to: prepared.window.to,
        statuses: request.statuses,
        variantHashes: request.variantHash || request.variantHashes
          ? sortedUnique([...(request.variantHash ? [request.variantHash] : []), ...(request.variantHashes ?? [])])
          : undefined,
        activityKey: request.activityKey,
        eventFilters: {
          causeKinds: request.filters.causeKinds,
          actorRoleIds: request.filters.actorRoleIds,
          actorTeamIds: request.filters.actorTeamIds,
        },
        after,
        pageSize: Math.min(request.pageSize, XRAY_ANALYTICS_LIMITS.maxPageSize),
      })
      const last = page.items[page.items.length - 1]
      return {
        ...base,
        n: page.total,
        computedThrough,
        items: page.items.map((item) => ({ caseId: item.caseId, organizationId: item.organizationId })),
        nextCursor: page.hasMore && last ? encodeCaseCursor({ at: last.lastActivityAt, id: last.caseId }) : null,
      }
    }, { timeoutMs })
  }

  async function computeRollups(scope: ProjectionScope, options: { timeZone?: string } = {}): Promise<RollupPassResult> {
    const registry = registryOf()
    if (!registry.ready || registry.processes.length === 0) return { processes: 0, written: 0, skipped: 0 }
    const nowMs = clock()
    const timeZone = options.timeZone ?? 'UTC'
    const registeredKeys = registry.processes.map((process) => process.processKey)
    const settings = foldScopeSettings([scope.organizationId], await deps.loadSettings(scope.tenantId, [scope.organizationId]))
    const widest = resolveDefaultWindow('90d', nowMs, timeZone)
    const active = await listActiveProcessKeys(deps.db, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      registeredKeys,
      since: widest.from,
    })
    let written = 0
    let skipped = 0
    for (const processKey of active) {
      const process = registry.processes.find((candidate) => candidate.processKey === processKey)
      if (!process) continue
      for (const windowKey of XRAY_WINDOW_KEYS) {
        const window = resolveDefaultWindow(windowKey, nowMs, timeZone)
        const input: LiveComputeInput = {
          scope: { tenantId: scope.tenantId, organizationIds: [scope.organizationId] },
          process,
          registeredKeys,
          window,
          filters: {},
          settings,
          nowMs,
          source: 'rollup',
        }
        let computed: { computedAt: string | null; results: RollupMetrics['results'] }
        try {
          computed = await runAnalyticsQuery(deps.db, async (trx) => {
            const dataset = await loadLiveDataset(trx, input, { census: true, maxEvents: deps.maxEvents })
            return {
              computedAt: dataset.transactionNow,
              results: {
                map: buildProcessMap(dataset.prepared, dataset.context),
                variants: buildVariants(dataset.prepared, dataset.context, XRAY_ANALYTICS_LIMITS.maxVariants),
                durations: buildDurations(dataset.prepared, dataset.context, dataset.census),
                bottlenecks: buildBottlenecks(dataset.prepared, dataset.context),
                rework: buildRework(dataset.prepared, dataset.context),
              },
            }
          }, { timeoutMs: rollupTimeoutMs })
        } catch (error) {
          if (!isXrayAnalyticsError(error)) throw error
          skipped += 1
          logger.warn('[internal] Skipped an X-Ray rollup window', { ...scope, processKey, windowKey, code: error.code })
          getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_rollup_skipped', attributes: { windowKey, reason: error.code } })
          continue
        }
        if (!computed.computedAt) continue
        const stored = await upsertRollup(deps.db, {
          scope,
          processKey,
          window,
          computedAt: computed.computedAt,
          metrics: {
            version: XRAY_ROLLUP_METRICS_VERSION,
            contractHash: registry.contractHash,
            settingsFingerprint: settings.fingerprint,
            timeZone: window.timeZone,
            results: computed.results,
          },
        })
        if (stored) written += 1
      }
    }
    return { processes: active.length, written, skipped }
  }

  async function invalidate(scope: ProjectionScope): Promise<void> {
    await markRollupsInvalidated(deps.db, scope)
    await analyticsCache.invalidate(scope.tenantId, [scope.organizationId])
  }

  return {
    getProcessMap,
    getVariants,
    getDurations,
    getBottlenecks,
    getRework,
    getConformance,
    getBreakdown,
    listCases,
    computeRollups,
    invalidate,
  }
}

function isCacheStrategy(value: unknown): value is CacheStrategy {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Record<keyof CacheStrategy, unknown>>
  return typeof candidate.get === 'function' && typeof candidate.set === 'function' && typeof candidate.deleteByTags === 'function'
}

/**
 * Analytics bound to a request (or worker) container: a forked `em` for Kysely and the
 * settings, the DI `cache` service and the audit module's `accessLogService`, both resolved
 * softly (no cache → no caching; no access log service → per-person reads are denied).
 */
export function createXrayAnalyticsFromContainer(
  container: XrayContainer,
  options: Pick<XrayAnalyticsDeps, 'clock' | 'registry' | 'timeoutMs' | 'rollupTimeoutMs'> = {},
): XrayAnalytics {
  const resolve = createServiceResolver(container)
  const em = (container.resolve('em') as EntityManager).fork()
  const cache = resolve<unknown>('cache')
  const accessLog = resolve<unknown>('accessLogService')
  return createXrayAnalytics({
    db: em.getKysely<XrayDatabase>(),
    loadSettings: createEntityManagerSettingsLoader(em),
    cache: isCacheStrategy(cache) ? cache : null,
    accessLog: isAccessLogWriter(accessLog) ? accessLog : null,
    ...options,
  })
}

/**
 * Invalidates an organization's analytics after its projection changed under existing
 * results: an undo that voided events, a rebuild, a settings change. Marks its rollups stale
 * and drops its cached results (and tenant-wide ones).
 */
export async function invalidateXrayAnalytics(container: XrayContainer, scope: ProjectionScope): Promise<void> {
  await createXrayAnalyticsFromContainer(container).invalidate(scope)
}
