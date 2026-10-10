import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { SimulationFeatureCheck } from '@open-mercato/shared/modules/insights/simulate'
import type { InsightsSimulationDecision, InsightsSimulationRun, SimulationRunStatus } from '../../data/entities'
import { readSimulationBudgets, type StoredSimulationResult } from './jobs'
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

export type SimulationResultGroupView = Omit<SimulationResultGroup, 'cells'> & { cells: SimulationResultCellView[] }

export type SimulationRunDetail = SimulationRunSummary & {
  cellKeys: string[]
  proposal: unknown
  result: { k: number; truncated: boolean; groups: SimulationResultGroupView[] } | null
  coverage: Record<string, number> | null
  caveats: string[]
  budgets: { maxRecords: number; maxDurationMs: number; recordsUsed: number; elapsedMs: number }
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
  return { k: record.k, truncated: record.truncated === true, groups: record.groups }
}

type Resolver = { resolve: (name: string) => unknown }

/**
 * The detail view of the caller's own run. Only a completed run carries a result (already
 * k-suppressed when stored); its sample ids are re-checked live for the viewer, so a record the
 * viewer can no longer read disappears from the samples.
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
  if (stored) {
    const groups: SimulationResultGroupView[] = []
    for (const group of stored.groups) {
      const cells: SimulationResultCellView[] = []
      for (const cell of group.cells ?? []) {
        const samples = cell.suppressed
          ? []
          : await resolveSimulationSamples(input.container, input.em, scope, input.viewerUserId, input.hasFeatures, group.sampleResourceKind, cell.sampleIds ?? [])
        cells.push({ key: cell.key, count: cell.count, suppressed: cell.suppressed, samples })
      }
      groups.push({ ...group, cells })
    }
    result = { k: stored.k, truncated: stored.truncated, groups }
  }
  const budgets = readSimulationBudgets(run.budgetsJson)
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
    cellKeys: [...kind.definition.cellKeys],
    proposal: run.inputJson ?? null,
    result,
    coverage: run.status === 'completed' ? run.coverageJson ?? null : null,
    caveats: run.status === 'completed' ? [...(run.caveats ?? [])] : [],
    budgets: { maxRecords: budgets.maxRecords, maxDurationMs: budgets.maxDurationMs, recordsUsed: budgets.recordsUsed, elapsedMs: budgets.elapsedMs },
    decisions: input.decisions.map(toSimulationDecisionView),
    applyHref,
    canDecide: run.status === 'completed',
  }
}
