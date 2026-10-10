import { createHash } from 'node:crypto'
import type { RegisteredProcess } from '../process/registry'
import type { OpenCensus } from './durations'
import type { BuildContext } from './envelope'
import { AnalyticsFilterTooNarrowError } from './errors'
import {
  loadActorFilterCensus,
  loadCaseEvents,
  loadOpenCensus,
  readProjectionState,
  readTransactionNow,
  type ActorFilterFacts,
  type AnalyticsDb,
  type AnalyticsTrx,
  type ProjectionState,
  type QueryScope,
} from './query'
import { effectiveKAnonymity } from './stats'
import { buildCaseTrace, prepareCase, type PreparedCase } from './trace'
import { toWindowView, type ResolvedWindow } from './window'
import {
  XRAY_ANALYTICS_LIMITS,
  XRAY_DEFAULT_DEBOUNCE_SECONDS,
  XRAY_DEFAULT_TIME_ZONE,
  XRAY_STATS_GUARDS,
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
 * strictest k (never below the minimum), each organization's own debounce window, the
 * individuals switch only when every organization enabled it (fail closed) and the time zone
 * the organizations share (UTC when they differ). Organization ids are compared lower-case.
 * The fingerprint keys caches and rollups, so a settings change never serves results computed
 * under old ones.
 */
export function foldScopeSettings(
  organizationIds: readonly string[],
  loadedSettings: ReadonlyMap<string, AnalyticsOrgSettings>,
): ScopeSettings {
  const settingsByOrganization = new Map<string, AnalyticsOrgSettings>()
  for (const [organizationId, settings] of loadedSettings) settingsByOrganization.set(organizationId.toLowerCase(), settings)
  const sorted = Array.from(new Set(organizationIds.map((organizationId) => organizationId.toLowerCase())))
    .sort((left, right) => left.localeCompare(right))
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
  const zones = new Set(sorted.map((organizationId) => settingsByOrganization.get(organizationId)?.timeZone ?? XRAY_DEFAULT_TIME_ZONE))
  const timeZone = zones.size === 1 ? Array.from(zones)[0] : XRAY_DEFAULT_TIME_ZONE
  const fingerprint = createHash('sha256').update(JSON.stringify({ kAnonymity, canonical })).digest('hex')
  return { organizationIds: sorted, kAnonymity, debounceMsByOrganization, individualsEnabled, timeZone, fingerprint }
}

export function createBuildContext(input: LiveComputeInput, state: ProjectionState): BuildContext {
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
      computedThrough: state.computedThrough,
      incomplete: state.incomplete,
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
    context: createBuildContext(input, { computedThrough: null, incomplete: false }),
    census: { asOf: censusAsOf(input), overall: { n: 0, medianMs: null, p90Ms: null, buckets: {} }, byOrganization: new Map() },
    transactionNow: null,
  }
}

function passesActorRule(facts: ActorFilterFacts | undefined, k: number): boolean {
  return facts !== undefined && facts.cases >= k && facts.actors >= XRAY_STATS_GUARDS.minDistinctActors
}

/**
 * Refuses actor role / team filters that would single out a small group (the k-anonymity and
 * three-actor rules applied to the filter itself): every requested value on its own (with the
 * other filters kept), and the filtered population as a whole, must cover at least k cases and
 * three distinct actors in the scope and window. Checking each value defeats the "tracker"
 * difference `[R1, R2]` minus `[R2]`. Throws `AnalyticsFilterTooNarrowError` (no counts).
 */
export async function assertActorFiltersAllowed(
  trx: AnalyticsDb | AnalyticsTrx,
  input: { scope: QueryScope; processKey: string; registeredKeys: readonly string[]; window: ResolvedWindow; filters: AnalyticsFilters; k: number },
): Promise<void> {
  const roleIds = input.filters.actorRoleIds ?? []
  const teamIds = input.filters.actorTeamIds ?? []
  if (roleIds.length === 0 && teamIds.length === 0) return
  const census = await loadActorFilterCensus(trx, {
    scope: input.scope,
    processKey: input.processKey,
    registeredKeys: input.registeredKeys,
    from: input.window.from,
    to: input.window.to,
    filters: input.filters,
  })
  const narrow = roleIds.some((roleId) => !passesActorRule(census.roles.get(roleId.toLowerCase()), input.k))
    || teamIds.some((teamId) => !passesActorRule(census.teams.get(teamId.toLowerCase()), input.k))
    || !passesActorRule(census.population, input.k)
  if (narrow) throw new AnalyticsFilterTooNarrowError()
}

/**
 * Loads one consistent snapshot for the builders: the projection state (`computedThrough`,
 * `incomplete`), the traces of the cases active in the window (debounce/correction collapse
 * applied per organization's settings, filters applied) and, when asked, the open-case census.
 * Actor role / team filters must pass `assertActorFiltersAllowed` first, except on the explicit
 * per-person path (`perPerson`, which has passed the individuals gate).
 */
export async function loadLiveDataset(
  trx: AnalyticsDb | AnalyticsTrx,
  input: LiveComputeInput,
  options: { census: boolean; maxEvents?: number; perPerson?: boolean },
): Promise<LiveDataset> {
  if (input.scope.organizationIds !== null && input.scope.organizationIds.length === 0) return emptyDataset(input)
  if (options.perPerson !== true) {
    await assertActorFiltersAllowed(trx, {
      scope: input.scope,
      processKey: input.process.processKey,
      registeredKeys: input.registeredKeys,
      window: input.window,
      filters: input.filters,
      k: input.settings.kAnonymity,
    })
  }
  const transactionNow = await readTransactionNow(trx)
  const state = await readProjectionState(trx, input.scope)
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
    const debounceMs = input.settings.debounceMsByOrganization.get(group.organizationId.toLowerCase()) ?? XRAY_DEFAULT_DEBOUNCE_SECONDS * 1000
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
  return { prepared, context: createBuildContext(input, state), census, transactionNow }
}
