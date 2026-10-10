import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { compareCodeUnits, getProcessRegistry, type ProcessRegistrySnapshot, type RegisteredProcess } from '../process/registry'
import { AnalyticsTimeoutError, AnalyticsTooLargeError } from '../analytics/errors'
import { loadCaseEvents, runAnalyticsQuery, type AnalyticsDb } from '../analytics/query'
import { effectiveKAnonymity } from '../analytics/stats'
import { buildCaseTrace, collapseCaseEvents } from '../analytics/trace'
import { XRAY_ANALYTICS_LIMITS, XRAY_ROLLUP_STATEMENT_TIMEOUT_MS } from '../analytics/types'
import { isXrayCursorComplete, lockXrayCursorState, sameContractHashes } from '../projection/completeness'
import { isXrayIngestEnabled } from '../projection/killSwitch'
import { assertXrayScope } from '../projection/payloads'
import { createServiceResolver, createXrayDatabase, createXrayStore, type XrayContainer } from '../projection/runtime'
import { loadXraySettings, xrayScopeKey, type XraySettingsSnapshot } from '../projection/settings'
import type { ProjectionScope } from '../projection/types'
import { resolveWorkflowDraftService, type XrayWorkflowAutomatedUpdate, type XrayWorkflowDraftService } from '../workflowsBridge'
import { XRAY_SUGGESTION_LOOKBACK_DAYS, XRAY_SUGGESTION_THRESHOLDS } from './constants'
import { createDeclaredEventCatalog, isAlreadyAutomated, type SuggestionEventCatalog } from './draft'
import { neutralSuggestionDraftLabels, prepareSuggestionDraft } from './draftability'
import { mineSuggestions, type MiningCase, type MiningThresholds } from './mine'
import { isForcedSuggestionPassAllowed, isSuggestionPassDue, listSuggestionPasses, markSuggestionPass } from './passes'
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
 * One automation suggestion mining pass of an organization (queue `insights-xray-suggestions`).
 * Refuses an organization of another tenant before any write. Skips an organization whose
 * settings or kill switch disable X-Ray (or when no process is declared), whose last pass is less
 * than 24 hours old (unless `force`, the on-demand request) and whose projection is incomplete
 * (no pass marker, so the next tick retries). Otherwise, per registered process: loads the cases
 * active in the last 30 days (database clock) under the background analytics statement timeout
 * and event budget, applies the organization's debounce / correction collapse, mines the rules
 * (`mineSuggestions`, thresholds with the organization's support override and k), drops rules
 * already automated by an enabled workflow trigger and assesses each rule's draftability. A process
 * over its budget is skipped (its suggestions are left untouched) and reported. The upserts and
 * the supersession of open rules no longer found (of evaluated processes only) run in one
 * transaction; then the pass is recorded. Idempotent: the same data yields the same rows.
 */
export async function runXraySuggestionJob(
  container: XrayContainer,
  scope: ProjectionScope,
  options: XraySuggestionJobOptions = {},
): Promise<XraySuggestionJobResult> {
  const registry = options.registry ?? getProcessRegistry()
  const em = (container.resolve('em') as EntityManager).fork()
  await assertXrayScope(em, scope)
  if (!registry.ready || registry.processes.length === 0) return { status: 'no_processes' }
  const settings = await loadXraySettings(em, scope)
  if (!settings.enabled || !(await isXrayIngestEnabled(createServiceResolver(container), scope.tenantId))) return { status: 'disabled' }
  const db = createXrayDatabase(em)
  const store = createXrayStore(em)
  const [passes, dbNow, cursor] = await Promise.all([listSuggestionPasses(db, [scope]), store.now(), store.readCursor(scope)])
  const lastPass = passes.get(xrayScopeKey(scope))
  const allowed = options.force === true ? isForcedSuggestionPassAllowed(lastPass, dbNow) : isSuggestionPassDue(lastPass, dbNow)
  if (!allowed) return { status: 'not_due' }
  if (!cursor || !isXrayCursorComplete(cursor)) return { status: 'incomplete' }
  const toMs = Date.parse(dbNow)
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
  const stored = await db.transaction().execute(async (trx) => {
    const current = await lockXrayCursorState(trx, scope)
    if (!current || !isXrayCursorComplete(current) || !sameContractHashes(current.contractHashes, cursor.contractHashes)) return null
    const writtenRows = await upsertSuggestions(trx, scope, upserts)
    const supersededRows = await supersedeMissingSuggestions(trx, scope, evaluated, upserts.map((upsert) => upsert.signatureHash))
    await markSuggestionPass(trx, scope)
    return { written: writtenRows, superseded: supersededRows }
  })
  if (!stored) return { status: 'incomplete' }
  const { written, superseded } = stored
  return { status: 'done', processes: evaluated.length, skippedProcesses, found, alreadyAutomated, written, superseded }
}
