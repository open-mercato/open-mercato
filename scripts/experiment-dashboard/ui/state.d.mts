import type { Experiment, ExperimentCase, Metrics } from './types'
export function experimentTotals(experiment: Pick<Experiment, 'lanes'>): {
  total: number
  completed: number
  passed: number
  failed: number
  blocked: number
  skipped: number
  observed: boolean
}
export function filterCases(
  cases: ExperimentCase[],
  filters: {
    query?: string
    laneId?: string | null
    status?: string | null
    group?: string | null
  },
): ExperimentCase[]
export function metricPresentation(
  metrics?: Metrics,
  now?: number,
): { kind: string; rate: number | null; stale: boolean }
export function selectMetrics(experiment: Experiment): {
  metrics: Metrics
  caseId: string | null
}
