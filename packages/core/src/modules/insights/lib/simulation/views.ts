import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { SimulationFeatureCheck } from '@open-mercato/shared/modules/insights/simulate'
import type { InsightsSimulationDecision, InsightsSimulationRun, SimulationRunStatus } from '../../data/entities'
import { readSimulationBudgets, sanitizeSimulationSummary, type StoredSimulationResult, type StoredSimulationSummary } from './jobs'
import type { SimulationCellSuppression, SimulationResultGroup } from './privacy'
import type { RegisteredSimulationKind } from './registry'
import { resolveSimulationSamples, toInternalHref, type SimulationSample } from './samples'

const logger = createLogger('insights').child({ component: 'simulation-views' })

export type SimulationRunSummary = {
  id: string
  kind: string
  kindLabelKey: string | null
  status: SimulationRunStatus
  artifactKind: string
  artifactId: string | null
  progressJobId: string | null
  fidelity: string | null
  errorCode: string | null
  windowFrom: string
  windowTo: string
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  expiresAt: string
}

export type SimulationDecisionView = {
  decision: 'applied' | 'discarded'
  verified: boolean | null
  artifactId: string | null
  artifactUpdatedAtAfter: string | null
  createdAt: string
}

export type SimulationResultCellView = {
  key: string
  count: number | null
  suppressed: SimulationCellSuppression | null
  samples: SimulationSample[]
}

export type SimulationResultGroupView = Omit<SimulationResultGroup, 'cells' | 'requiredFeatures'> & { cells: SimulationResultCellView[] }

/** Shown when groups of a source the viewer may no longer read are left out (their coverage is hidden too). */
export const SIMULATION_GROUPS_HIDDEN_CAVEAT = 'insights.simulation.caveats.groupsHidden'

function readGroupFeatures(group: SimulationResultGroup): string[] {
  return Array.isArray(group.requiredFeatures)
    ? group.requiredFeatures.filter((feature): feature is string => typeof feature === 'string' && feature.length > 0)
    : []
}

export type SimulationRunDetail = SimulationRunSummary & {
  execution: 'queued' | 'inline'
  hasLiveRecords: boolean
  cellKeys: string[]
  proposal: unknown
  result: { k: number; truncated: boolean; groups: SimulationResultGroupView[]; summary: StoredSimulationSummary | null } | null
  coverage: Record<string, number> | null
  caveats: string[]
  budgets: { maxRecords: number; maxDurationMs: number; recordsUsed: number | null; elapsedMs: number }
  decisions: SimulationDecisionView[]
  applyHref: string | null
  canDecide: boolean
}

function iso(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null
  return value.toISOString()
}

export function toSimulationRunSummary(run: InsightsSimulationRun, kind: RegisteredSimulationKind | null): SimulationRunSummary {
  return {
    id: run.id,
    kind: run.kind,
    kindLabelKey: kind?.definition.labelKey ?? null,
    status: run.status,
    artifactKind: run.artifactKind,
    artifactId: run.artifactId ?? null,
    progressJobId: run.progressJobId ?? null,
    fidelity: run.status === 'completed' ? run.fidelity ?? null : null,
    errorCode: run.errorCode ?? null,
    windowFrom: iso(run.windowFrom) ?? '',
    windowTo: iso(run.windowTo) ?? '',
    createdAt: iso(run.createdAt) ?? '',
    startedAt: iso(run.startedAt),
    completedAt: iso(run.completedAt),
    expiresAt: iso(run.expiresAt) ?? '',
  }
}

export function toSimulationDecisionView(decision: InsightsSimulationDecision): SimulationDecisionView {
  return {
    decision: decision.decision,
    verified: decision.verified ?? null,
    artifactId: decision.artifactId ?? null,
    artifactUpdatedAtAfter: iso(decision.artifactUpdatedAtAfter),
    createdAt: iso(decision.createdAt) ?? '',
  }
}

function readStoredResult(value: unknown): StoredSimulationResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<StoredSimulationResult>
  if (typeof record.k !== 'number' || !Array.isArray(record.groups)) return null
  const summary = sanitizeSimulationSummary(record.summary)
  return { k: record.k, truncated: record.truncated === true, groups: record.groups, ...(summary ? { summary } : {}) }
}

type Resolver = { resolve: (name: string) => unknown }

/**
 * S14: the number of records a run read can equal the sum of its group totals (e.g. the principals
 * a permission preview evaluated, or the lines a price backtest classified), so it is withheld
 * whenever any group or cell is suppressed, or a group is left out for the viewer — otherwise a
 * hidden count could be derived by subtraction.
 */
function withholdsRecordsUsed(stored: StoredSimulationResult | null, hiddenGroups: number): boolean {
  if (hiddenGroups > 0) return true
  if (!stored) return false
  return stored.groups.some((group) => group.suppressed || (group.cells ?? []).some((cell) => cell.suppressed !== null))
}

/**
 * The detail view of the caller's own run. Only a completed run carries a result (already
 * k-suppressed when stored); its sample ids are re-checked live for the viewer, so a record the
 * viewer can no longer read disappears from the samples, and a group whose source features
 * (`requiredFeatures`) the viewer lacks is left out — with the run's coverage, which may sum it.
 * `recordsUsed` (the records read, which also sums the groups) is withheld whenever a count is hidden.
 */
export async function buildSimulationRunDetail(input: {
  container: Resolver
  em: EntityManager
  run: InsightsSimulationRun
  kind: RegisteredSimulationKind
  viewerUserId: string
  hasFeatures: SimulationFeatureCheck
  decisions: InsightsSimulationDecision[]
}): Promise<SimulationRunDetail> {
  const { run, kind } = input
  const scope = { tenantId: run.tenantId, organizationId: run.organizationId }
  const stored = run.status === 'completed' ? readStoredResult(run.resultJson) : null
  let result: SimulationRunDetail['result'] = null
  let hiddenGroups = 0
  if (stored) {
    const groups: SimulationResultGroupView[] = []
    for (const group of stored.groups) {
      const groupFeatures = readGroupFeatures(group)
      if (groupFeatures.length > 0 && !(await input.hasFeatures(groupFeatures))) {
        hiddenGroups += 1
        continue
      }
      const cells: SimulationResultCellView[] = []
      for (const cell of group.cells ?? []) {
        const samples = cell.suppressed
          ? []
          : await resolveSimulationSamples(input.container, input.em, scope, input.viewerUserId, input.hasFeatures, group.sampleResourceKind, cell.sampleIds ?? [])
        cells.push({ key: cell.key, count: cell.count, suppressed: cell.suppressed, samples })
      }
      groups.push({
        key: group.key,
        labelKey: group.labelKey,
        sampleResourceKind: group.sampleResourceKind,
        total: group.total,
        suppressed: group.suppressed,
        cells,
        warnings: group.warnings,
        flags: group.flags,
        ...(Array.isArray(group.measures) ? { measures: group.measures } : {}),
      })
    }
    result = { k: stored.k, truncated: stored.truncated, groups, summary: stored.summary ?? null }
  }
  const budgets = readSimulationBudgets(run.budgetsJson)
  const storedCaveats = run.status === 'completed' ? [...(run.caveats ?? [])] : []
  let applyHref: string | null = null
  if (run.status === 'completed' && kind.definition.applyHref) {
    try {
      applyHref = toInternalHref(kind.definition.applyHref({ artifactId: run.artifactId ?? null, runId: run.id }))
    } catch (error) {
      logger.warn('[internal] A simulation kind could not build its apply link', { kind: run.kind, err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_apply_href_failed', attributes: { kind: run.kind } })
      applyHref = null
    }
  }
  return {
    ...toSimulationRunSummary(run, kind),
    execution: kind.definition.execution === 'inline' ? 'inline' : 'queued',
    hasLiveRecords: run.status === 'completed' && Boolean(kind.definition.liveRecords),
    cellKeys: [...kind.definition.cellKeys],
    proposal: run.inputJson ?? null,
    result,
    coverage: run.status === 'completed' && hiddenGroups === 0 ? run.coverageJson ?? null : null,
    caveats: run.status === 'completed' ? [...storedCaveats, ...(hiddenGroups > 0 ? [SIMULATION_GROUPS_HIDDEN_CAVEAT] : [])] : [],
    budgets: {
      maxRecords: budgets.maxRecords,
      maxDurationMs: budgets.maxDurationMs,
      recordsUsed: withholdsRecordsUsed(stored, hiddenGroups) ? null : budgets.recordsUsed,
      elapsedMs: budgets.elapsedMs,
    },
    decisions: input.decisions.map(toSimulationDecisionView),
    applyHref,
    canDecide: run.status === 'completed',
  }
}
