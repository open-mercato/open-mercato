import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentEvalSuiteRun } from '../../../data/entities'
import type { EvalScope } from '../evalReplayService'
import { readEvalSetPointer } from '../manifest'
import { loadSuiteAgentVersions } from './suiteAgentVersions'

export const EVAL_TREND_LIMIT_DEFAULT = 30
export const EVAL_TREND_LIMIT_MAX = 100

export type EvalTrendRunInput = {
  suiteRunId: string
  createdAt: Date
  finishedAt: Date | null
  trigger: AgentEvalSuiteRun['trigger']
  outcome: AgentEvalSuiteRun['outcome'] | null
  passScore: number | null
  scoreVariance: number | null
  caseCount: number
  errorCount: number
  evalSetVersion: string | null
  manifestHash: string | null
  agentVersions: Array<string | null>
  safetyRegressionCount: number
}

export type EvalTrendPoint = Omit<EvalTrendRunInput, 'createdAt' | 'finishedAt'> & {
  createdAt: string
  finishedAt: string | null
  datasetKey: string | null
  previousSuiteRunId: string | null
  passScoreDelta: number | null
}

export type EvalTrendVersion = {
  agentVersion: string | null
  runCount: number
  firstSeenAt: string
  lastSeenAt: string
  latestSuiteRunId: string
  latestPassScore: number | null
  meanPassScore: number | null
  previousVersion: string | null
  passScoreDelta: number | null
  sameDataset: boolean | null
}

export type EvalTrend = {
  agentDefinitionId: string
  points: EvalTrendPoint[]
  versions: EvalTrendVersion[]
}

function roundDelta(value: number): number {
  return Number(value.toFixed(4))
}

/** Runs are comparable only over the same dataset: the frozen manifest hash, else the pin label. */
export function datasetKeyOf(run: Pick<EvalTrendRunInput, 'manifestHash' | 'evalSetVersion'>): string | null {
  return run.manifestHash ?? run.evalSetVersion ?? null
}

/**
 * Turns completed suite runs into trend points (oldest first) and a per-version
 * summary. A point's delta connects it to the previous point of the SAME
 * dataset only. Version rows are ordered by their latest run; a version's delta
 * compares its latest run with the newest strictly older run of another
 * version (the version it replaced) and is null across datasets.
 */
export function computeEvalTrend(agentDefinitionId: string, runs: ReadonlyArray<EvalTrendRunInput>): EvalTrend {
  const ordered = [...runs].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
  const lastByDataset = new Map<string, EvalTrendRunInput>()
  const points: EvalTrendPoint[] = ordered.map((run) => {
    const datasetKey = datasetKeyOf(run)
    const bucketKey = datasetKey ?? ''
    const previous = lastByDataset.get(bucketKey) ?? null
    lastByDataset.set(bucketKey, run)
    const passScoreDelta =
      previous && previous.passScore !== null && run.passScore !== null
        ? roundDelta(run.passScore - previous.passScore)
        : null
    return {
      ...run,
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      datasetKey,
      previousSuiteRunId: previous?.suiteRunId ?? null,
      passScoreDelta,
    }
  })

  const pointVersions = (point: EvalTrendPoint): Array<string | null> =>
    point.agentVersions.length ? point.agentVersions : [null]

  type VersionAccumulator = { agentVersion: string | null; runs: EvalTrendPoint[]; latestIndex: number }
  const byVersion = new Map<string, VersionAccumulator>()
  points.forEach((point, index) => {
    for (const agentVersion of pointVersions(point)) {
      const key = agentVersion ?? ''
      const accumulator = byVersion.get(key) ?? { agentVersion, runs: [], latestIndex: index }
      accumulator.runs.push(point)
      accumulator.latestIndex = index
      byVersion.set(key, accumulator)
    }
  })

  const findPreviousRun = (accumulator: VersionAccumulator): EvalTrendPoint | null => {
    const latestTime = Date.parse(points[accumulator.latestIndex].createdAt)
    for (let index = accumulator.latestIndex - 1; index >= 0; index -= 1) {
      const candidate = points[index]
      if (Date.parse(candidate.createdAt) >= latestTime) continue
      if (!pointVersions(candidate).includes(accumulator.agentVersion)) return candidate
    }
    return null
  }

  const versions: EvalTrendVersion[] = [...byVersion.values()]
    .sort((left, right) => left.latestIndex - right.latestIndex)
    .map((accumulator) => {
      const first = accumulator.runs[0]
      const latest = accumulator.runs[accumulator.runs.length - 1]
      const scores = accumulator.runs.map((run) => run.passScore).filter((score): score is number => score !== null)
      const previous = findPreviousRun(accumulator)
      const sameDataset = previous
        ? previous.datasetKey !== null && latest.datasetKey !== null
          ? previous.datasetKey === latest.datasetKey
          : null
        : null
      const passScoreDelta =
        previous && sameDataset === true && latest.passScore !== null && previous.passScore !== null
          ? roundDelta(latest.passScore - previous.passScore)
          : null
      return {
        agentVersion: accumulator.agentVersion,
        runCount: accumulator.runs.length,
        firstSeenAt: first.createdAt,
        lastSeenAt: latest.createdAt,
        latestSuiteRunId: latest.suiteRunId,
        latestPassScore: latest.passScore,
        meanPassScore: scores.length ? roundDelta(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
        previousVersion: previous ? pointVersions(previous)[0] : null,
        passScoreDelta,
        sameDataset,
      }
    })

  return { agentDefinitionId, points, versions }
}

export type BuildEvalTrendOptions = {
  evalSetVersion?: string | null
  limit?: number
}

/** Loads the newest `limit` completed suite runs of one agent and builds their trend. */
export async function buildEvalTrend(
  em: EntityManager,
  scope: EvalScope,
  agentDefinitionId: string,
  options: BuildEvalTrendOptions = {},
): Promise<EvalTrend> {
  const limit = Math.min(Math.max(options.limit ?? EVAL_TREND_LIMIT_DEFAULT, 1), EVAL_TREND_LIMIT_MAX)
  const where: Record<string, unknown> = { ...scope, agentDefinitionId, status: 'completed' }
  if (options.evalSetVersion) where.evalSetVersion = options.evalSetVersion
  const suiteRuns = await findWithDecryption(
    em,
    AgentEvalSuiteRun,
    where,
    { orderBy: { createdAt: 'DESC' }, limit },
    scope,
  )
  const versions = await loadSuiteAgentVersions(em, scope, suiteRuns.map((run) => run.id))
  return computeEvalTrend(
    agentDefinitionId,
    suiteRuns.map((run) => ({
      suiteRunId: run.id,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt ?? null,
      trigger: run.trigger,
      outcome: run.outcome ?? null,
      passScore: run.passScore ?? null,
      scoreVariance: run.scoreVariance ?? null,
      caseCount: run.caseCount,
      errorCount: run.errorCount,
      evalSetVersion: run.evalSetVersion ?? null,
      manifestHash: readEvalSetPointer(run.summary)?.version ?? null,
      agentVersions: versions.get(run.id) ?? [],
      safetyRegressionCount: Array.isArray(run.safetyRegressions) ? run.safetyRegressions.length : 0,
    })),
  )
}
