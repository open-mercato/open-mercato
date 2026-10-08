import { createHash } from 'node:crypto'
import type { RegisteredProcess } from '../process/registry'
import type { OpenCensus } from './durations'
import type { BuildContext } from './envelope'
import {
  loadCaseEvents,
  loadOpenCensus,
  readComputedThrough,
  readTransactionNow,
  type AnalyticsDb,
  type AnalyticsTrx,
  type QueryScope,
} from './query'
import { effectiveKAnonymity } from './stats'
import { buildCaseTrace, prepareCase, type PreparedCase } from './trace'
import { toWindowView, type ResolvedWindow } from './window'
import {
  XRAY_ANALYTICS_LIMITS,
  XRAY_DEFAULT_DEBOUNCE_SECONDS,
  type AnalyticsFilters,
  type AnalyticsOrgSettings,
  type ScopeSettings,
} from './types'

export type AnalyticsSource = 'live' | 'rollup'

export type LiveComputeInput = {
  scope: QueryScope
  process: RegisteredProcess
  registeredKeys: readonly string[]
  window: ResolvedWindow
  filters: AnalyticsFilters
  settings: ScopeSettings
  nowMs: number
  source: AnalyticsSource
}

export type LiveDataset = {
  prepared: PreparedCase[]
  context: BuildContext
  census: OpenCensus
  transactionNow: string | null
}

function debounceMsOf(settings: AnalyticsOrgSettings | undefined): number {
  const seconds = settings && Number.isFinite(settings.debounceSeconds) ? settings.debounceSeconds : XRAY_DEFAULT_DEBOUNCE_SECONDS
  return Math.max(0, Math.trunc(seconds)) * 1000
}

/**
 * Folds the settings of every organization in scope into the values one call applies: the
 * strictest k (never below the minimum), each organization's own debounce window, and the
 * individuals switch only when every organization enabled it (fail closed). The fingerprint
 * keys caches and rollups, so a settings change never serves results computed under old ones.
 */
export function foldScopeSettings(
  organizationIds: readonly string[],
  settingsByOrganization: ReadonlyMap<string, AnalyticsOrgSettings>,
): ScopeSettings {
  const sorted = Array.from(new Set(organizationIds)).sort((left, right) => left.localeCompare(right))
  const debounceMsByOrganization = new Map<string, number>()
  let kAnonymity = effectiveKAnonymity(undefined)
  const canonical: Array<[string, number, number, boolean]> = []
  sorted.forEach((organizationId, index) => {
    const settings = settingsByOrganization.get(organizationId)
    const k = effectiveKAnonymity(settings?.kAnonymity)
    kAnonymity = index === 0 ? k : Math.max(kAnonymity, k)
    const debounceMs = debounceMsOf(settings)
    debounceMsByOrganization.set(organizationId, debounceMs)
    canonical.push([organizationId, k, debounceMs, settings?.individualsEnabled === true])
  })
  const individualsEnabled = sorted.length > 0 && sorted.every((organizationId) => settingsByOrganization.get(organizationId)?.individualsEnabled === true)
  const fingerprint = createHash('sha256').update(JSON.stringify({ kAnonymity, canonical })).digest('hex')
  return { organizationIds: sorted, kAnonymity, debounceMsByOrganization, individualsEnabled, fingerprint }
}

export function createBuildContext(input: LiveComputeInput, computedThrough: string | null): BuildContext {
  const organizationIds = input.scope.organizationIds === null
    ? null
    : Array.from(new Set(input.scope.organizationIds)).sort((left, right) => left.localeCompare(right))
  return {
    window: input.window,
    k: input.settings.kAnonymity,
    includeSyncRun: input.filters.includeSyncRun === true,
    envelope: {
      processKey: input.process.processKey,
      organizationIds,
      window: toWindowView(input.window),
      computedThrough,
      kAnonymity: input.settings.kAnonymity,
      source: input.source,
    },
  }
}

function censusAsOf(input: LiveComputeInput): string {
  return new Date(Math.min(input.window.toMs, input.nowMs)).toISOString()
}

/** The dataset of a scope that reads nothing (an explicitly empty organization list). */
export function emptyDataset(input: LiveComputeInput): LiveDataset {
  return {
    prepared: [],
    context: createBuildContext(input, null),
    census: { asOf: censusAsOf(input), overall: { n: 0, medianMs: null, p90Ms: null, buckets: {} }, byOrganization: new Map() },
    transactionNow: null,
  }
}

/**
 * Loads one consistent snapshot for the builders: the projection's `computedThrough`, the
 * traces of the cases active in the window (debounce/correction collapse applied per
 * organization's settings, filters applied) and, when asked, the open-case census.
 */
export async function loadLiveDataset(
  trx: AnalyticsDb | AnalyticsTrx,
  input: LiveComputeInput,
  options: { census: boolean; maxEvents?: number },
): Promise<LiveDataset> {
  if (input.scope.organizationIds !== null && input.scope.organizationIds.length === 0) return emptyDataset(input)
  const transactionNow = await readTransactionNow(trx)
  const computedThrough = await readComputedThrough(trx, input.scope)
  const groups = await loadCaseEvents(trx, {
    scope: input.scope,
    processKey: input.process.processKey,
    registeredKeys: input.registeredKeys,
    from: input.window.from,
    to: input.window.to,
    perCaseLimit: XRAY_ANALYTICS_LIMITS.maxEventsPerCase,
    maxEvents: options.maxEvents,
  })
  const prepared = groups.map((group) => {
    const trace = buildCaseTrace({
      organizationId: group.organizationId,
      caseId: group.caseId,
      rows: group.rows,
      caseRow: group.caseRow,
      process: input.process,
      window: input.window,
      perCaseLimit: XRAY_ANALYTICS_LIMITS.maxEventsPerCase,
    })
    const debounceMs = input.settings.debounceMsByOrganization.get(group.organizationId) ?? XRAY_DEFAULT_DEBOUNCE_SECONDS * 1000
    return prepareCase(trace, debounceMs, input.filters)
  })
  const census = options.census
    ? await loadOpenCensus(trx, {
      scope: input.scope,
      processKey: input.process.processKey,
      registeredKeys: input.registeredKeys,
      asOf: censusAsOf(input),
    })
    : emptyDataset(input).census
  return { prepared, context: createBuildContext(input, computedThrough), census, transactionNow }
}
