import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { compareCodeUnits, getProcessRegistry, type ProcessRegistrySnapshot, type RegisteredProcess } from '../process/registry'
import { AnalyticsTimeoutError, AnalyticsTooLargeError } from '../analytics/errors'
import { loadCaseEvents, runAnalyticsQuery, type AnalyticsDb } from '../analytics/query'
import { effectiveKAnonymity } from '../analytics/stats'
import { buildCaseTrace, collapseCaseEvents } from '../analytics/trace'
import { XRAY_ANALYTICS_LIMITS, XRAY_ROLLUP_STATEMENT_TIMEOUT_MS } from '../analytics/types'
import { XRAY_WRITE_LOCK_TIMEOUT_MS, XRAY_WRITE_STATEMENT_TIMEOUT_MS, isXrayCursorComplete, lockXrayCursorState, sameContractHashes, setXrayWriteTimeouts } from '../projection/completeness'
import { isLockTimeoutError } from '../projection/errors'
import { isXrayIngestEnabled } from '../projection/killSwitch'
import { assertXrayScope } from '../projection/payloads'
import { createServiceResolver, createXrayDatabase, createXrayStore, type XrayContainer } from '../projection/runtime'
import { loadXraySettings, xrayScopeKey, type XraySettingsSnapshot } from '../projection/settings'
import type { ProjectionStore } from '../projection/store'
import type { ProjectionScope } from '../projection/types'
import { resolveWorkflowDraftService, type XrayWorkflowAutomatedUpdate, type XrayWorkflowDraftService } from '../workflowsBridge'
import { XRAY_SUGGESTION_LOOKBACK_DAYS, XRAY_SUGGESTION_THRESHOLDS } from './constants'
import { createDeclaredEventCatalog, isAlreadyAutomated, type SuggestionEventCatalog } from './draft'
import { neutralSuggestionDraftLabels, prepareSuggestionDraft } from './draftability'
import { mineSuggestions, type MiningCase, type MiningThresholds } from './mine'
import { clearSuggestionRequest, isForcedSuggestionPassAllowed, isSuggestionPassDue, listSuggestionPasses, markSuggestionPass } from './passes'
import { supersedeMissingSuggestions, upsertSuggestions, type SuggestionUpsert } from './store'

const logger = createLogger('insights').child({ component: 'xray-suggestions' })

const DAY_MS = 24 * 60 * 60_000

export type XraySuggestionJobResult =
  | { status: 'disabled' | 'no_processes' | 'not_due' | 'incomplete' }
  | {
    status: 'done'
    processes: number
    skippedProcesses: string[]
    found: number
    alreadyAutomated: number
    written: number
    superseded: number
  }

export type XraySuggestionJobOptions = {
  force?: boolean
  registry?: ProcessRegistrySnapshot
  catalog?: SuggestionEventCatalog
  timeoutMs?: number
  maxEvents?: number
  /** Lock wait of the final write transaction (default `XRAY_WRITE_LOCK_TIMEOUT_MS`). */
  lockTimeoutMs?: number
}

type SuggestionPassContext = {
  container: XrayContainer
  em: EntityManager
  db: AnalyticsDb
  store: ProjectionStore
  scope: ProjectionScope
  startedAt: string
}

/** The thresholds in force for an organization: the platform constants, its support override (never below 5) and its k. */
export function suggestionThresholds(settings: Pick<XraySettingsSnapshot, 'suggestionMinSupport' | 'kAnonymity'>): MiningThresholds {
  const override = settings.suggestionMinSupport
  return {
    minSupport: typeof override === 'number' ? Math.max(override, XRAY_SUGGESTION_THRESHOLDS.minSupportFloor) : XRAY_SUGGESTION_THRESHOLDS.minSupport,
    minConfidenceLowerBound: XRAY_SUGGESTION_THRESHOLDS.minConfidenceLowerBound,
    minLift: XRAY_SUGGESTION_THRESHOLDS.minLift,
    minDistinctActors: XRAY_SUGGESTION_THRESHOLDS.minDistinctActors,
    minCases: effectiveKAnonymity(settings.kAnonymity),
  }
}

async function loadMiningCases(
  db: AnalyticsDb,
  scope: ProjectionScope,
  process: RegisteredProcess,
  registeredKeys: readonly string[],
  window: { fromMs: number; toMs: number },
  debounceMs: number,
  options: { timeoutMs: number; maxEvents: number },
): Promise<MiningCase[]> {
  const groups = await runAnalyticsQuery(db, (trx) => loadCaseEvents(trx, {
    scope: { tenantId: scope.tenantId, organizationIds: [scope.organizationId] },
    processKey: process.processKey,
    registeredKeys,
    from: new Date(window.fromMs).toISOString(),
    to: new Date(window.toMs).toISOString(),
    perCaseLimit: XRAY_ANALYTICS_LIMITS.maxEventsPerCase,
    maxEvents: options.maxEvents,
  }), { timeoutMs: options.timeoutMs })
  return groups.map((group) => {
    const trace = buildCaseTrace({
      organizationId: group.organizationId,
      caseId: group.caseId,
      rows: group.rows,
      caseRow: group.caseRow,
      process,
      window,
      perCaseLimit: XRAY_ANALYTICS_LIMITS.maxEventsPerCase,
    })
    return { organizationId: group.organizationId, caseId: group.caseId, events: collapseCaseEvents(trace.events, debounceMs).kept }
  })
}

async function listAutomated(service: XrayWorkflowDraftService | null, scope: ProjectionScope): Promise<XrayWorkflowAutomatedUpdate[]> {
  if (!service || typeof service.listAutomatedUpdates !== 'function') return []
  return service.listAutomatedUpdates({ tenantId: scope.tenantId, organizationId: scope.organizationId })
}

function reportBudget(error: Error, scope: ProjectionScope, processKey: string): void {
  logger.warn('[internal] Process X-Ray suggestion mining skipped a process: analytics budget exceeded', {
    organizationId: scope.organizationId,
    processKey,
    err: error,
  })
  getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_suggestions_budget_exceeded', attributes: { processKey } })
}

/**
 * Stores a pass in one transaction bounded by the projection write timeouts, after re-reading the
 * cursor `FOR SHARE` (still complete, contracts unchanged): upserts, supersession of open rules no
 * longer found (of evaluated processes only) and the pass marker. `null` when the projection changed
 * meanwhile or a cursor / suggestion row stayed locked past the lock timeout (nothing is stored and
 * no pass is recorded, so the next tick retries); any other failure is rethrown.
 */
async function storeSuggestionPass(
  db: AnalyticsDb,
  scope: ProjectionScope,
  input: { contractHashes: Record<string, string> | null; evaluated: string[]; upserts: SuggestionUpsert[]; lockTimeoutMs: number },
): Promise<{ written: number; superseded: number } | null> {
  try {
    return await db.transaction().execute(async (trx) => {
      await setXrayWriteTimeouts(trx, { lockTimeoutMs: input.lockTimeoutMs, statementTimeoutMs: XRAY_WRITE_STATEMENT_TIMEOUT_MS })
      const current = await lockXrayCursorState(trx, scope)
      if (!current || !isXrayCursorComplete(current) || !sameContractHashes(current.contractHashes, input.contractHashes)) return null
      const written = await upsertSuggestions(trx, scope, input.upserts)
      const superseded = await supersedeMissingSuggestions(trx, scope, input.evaluated, input.upserts.map((upsert) => upsert.signatureHash))
      await markSuggestionPass(trx, scope)
      return { written, superseded }
    })
  } catch (error) {
    if (!isLockTimeoutError(error)) throw error
    logger.debug('X-Ray suggestion mining pass deferred: a cursor or suggestion row stayed locked', { organizationId: scope.organizationId })
    return null
  }
}

/**
 * Clears the on-demand request a forced job served (recorded up to its start). Never fails the
 * job: a failure is logged and reported, and the request expires after `XRAY_SUGGESTION_REQUEST_TTL_MS`.
 */
async function settleSuggestionRequest(db: AnalyticsDb, scope: ProjectionScope, startedAt: string): Promise<void> {
  try {
    await clearSuggestionRequest(db, scope, startedAt)
  } catch (error) {
    logger.warn('[internal] Could not clear the on-demand X-Ray suggestion mining request', { organizationId: scope.organizationId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_suggestion_request_clear_failed' })
  }
}

async function runSuggestionPass(context: SuggestionPassContext, options: XraySuggestionJobOptions): Promise<XraySuggestionJobResult> {
  const { container, em, db, store, scope, startedAt } = context
  const registry = options.registry ?? getProcessRegistry()
  if (!registry.ready || registry.processes.length === 0) return { status: 'no_processes' }
  const settings = await loadXraySettings(em, scope)
  if (!settings.enabled || !(await isXrayIngestEnabled(createServiceResolver(container), scope.tenantId))) return { status: 'disabled' }
  const [passes, cursor] = await Promise.all([listSuggestionPasses(db, [scope]), store.readCursor(scope)])
  const lastPass = passes.get(xrayScopeKey(scope))
  const allowed = options.force === true ? isForcedSuggestionPassAllowed(lastPass, startedAt) : isSuggestionPassDue(lastPass, startedAt)
  if (!allowed) return { status: 'not_due' }
  if (!cursor || !isXrayCursorComplete(cursor)) return { status: 'incomplete' }
  const toMs = Date.parse(startedAt)
  const window = { fromMs: toMs - XRAY_SUGGESTION_LOOKBACK_DAYS * DAY_MS, toMs }
  const thresholds = suggestionThresholds(settings)
  const debounceMs = Math.max(0, Math.trunc(settings.debounceSeconds)) * 1000
  const service = resolveWorkflowDraftService(container)
  const automated = await listAutomated(service, scope)
  const catalog = options.catalog ?? createDeclaredEventCatalog()
  const registeredKeys = registry.processes.map((process) => process.processKey)
  const processes = [...registry.processes].sort((left, right) => compareCodeUnits(left.processKey, right.processKey))
  const evaluated: string[] = []
  const skippedProcesses: string[] = []
  const upserts: SuggestionUpsert[] = []
  let found = 0
  let alreadyAutomated = 0
  for (const process of processes) {
    let cases: MiningCase[]
    try {
      cases = await loadMiningCases(db, scope, process, registeredKeys, window, debounceMs, {
        timeoutMs: options.timeoutMs ?? XRAY_ROLLUP_STATEMENT_TIMEOUT_MS,
        maxEvents: options.maxEvents ?? XRAY_ANALYTICS_LIMITS.maxEvents,
      })
    } catch (error) {
      if (error instanceof AnalyticsTimeoutError || error instanceof AnalyticsTooLargeError) {
        reportBudget(error, scope, process.processKey)
        skippedProcesses.push(process.processKey)
        continue
      }
      throw error
    }
    evaluated.push(process.processKey)
    const mined = mineSuggestions({ process, cases, window, thresholds })
    found += mined.length
    for (const rule of mined) {
      if (isAlreadyAutomated(process, rule, automated)) {
        alreadyAutomated += 1
        continue
      }
      const outcome = await prepareSuggestionDraft({
        process,
        rule,
        catalog,
        service,
        scope,
        labels: neutralSuggestionDraftLabels(rule),
      })
      upserts.push({
        ...rule,
        triggerEventId: outcome.eventId,
        draftable: outcome.draftable,
        notDraftableReason: outcome.draftable ? null : outcome.reason,
        commandId: process.automation?.updateCommandId ?? null,
      })
    }
  }
  const stored = await storeSuggestionPass(db, scope, {
    contractHashes: cursor.contractHashes,
    evaluated,
    upserts,
    lockTimeoutMs: options.lockTimeoutMs ?? XRAY_WRITE_LOCK_TIMEOUT_MS,
  })
  if (!stored) return { status: 'incomplete' }
  return { status: 'done', processes: evaluated.length, skippedProcesses, found, alreadyAutomated, written: stored.written, superseded: stored.superseded }
}

/**
 * One automation suggestion mining pass of an organization (queue `insights-xray-suggestions`).
 * Refuses an organization of another tenant before any write. Skips an organization whose
 * settings or kill switch disable X-Ray (or when no process is declared), whose last pass is less
 * than 24 hours old (15 minutes for `force`, the on-demand request) and whose projection is
 * incomplete (no pass marker, so the next tick retries). Otherwise, per registered process: loads
 * the cases active in the last 30 days (database clock) under the background analytics statement
 * timeout and event budget, applies the organization's debounce / correction collapse, mines the
 * rules (`mineSuggestions`, thresholds with the organization's support override and k), drops rules
 * already automated by an enabled workflow trigger and assesses each rule's draftability. A process
 * over its budget is skipped (its suggestions are left untouched) and reported. The upserts, the
 * supersession of open rules no longer found (of evaluated processes only) and the pass marker are
 * stored in one transaction bounded by the projection write timeouts; a lock timeout stores nothing
 * (`incomplete`). A forced job then clears the on-demand request it served, whatever the outcome
 * (a failure is rethrown with the request kept, so the queue retries it). Idempotent: the same data
 * yields the same rows.
 */
export async function runXraySuggestionJob(
  container: XrayContainer,
  scope: ProjectionScope,
  options: XraySuggestionJobOptions = {},
): Promise<XraySuggestionJobResult> {
  const em = (container.resolve('em') as EntityManager).fork()
  await assertXrayScope(em, scope)
  const db = createXrayDatabase(em)
  const store = createXrayStore(em)
  const startedAt = await store.now()
  const result = await runSuggestionPass({ container, em, db, store, scope, startedAt }, options)
  if (options.force === true) await settleSuggestionRequest(db, scope, startedAt)
  return result
}
