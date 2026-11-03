export type SearchStepPhase = 'plan' | 'adapter' | 'fetch' | 'fusion' | 'done'

export type SearchStepEvent =
  | 'queued'
  | 'started'
  | 'ok'
  | 'empty'
  | 'blocked'
  | 'timeout'
  | 'unavailable'
  | 'error'
  | 'cancelled'
  | 'escalated'
  | 'cached'
  | 'fused'
  | 'completed'

export type SearchStepMetrics = {
  readonly latencyMs?: number
  readonly resultCount?: number
  readonly bytes?: number
  readonly httpStatus?: number
}

/**
 * One narratable unit of engine work. Emitted live and persisted, so `detail`
 * must be human-readable and free of secrets — it reaches an operator's screen.
 */
export type SearchStep = {
  readonly seq: number
  readonly at: string
  readonly phase: SearchStepPhase
  readonly event: SearchStepEvent
  readonly adapterId?: string
  readonly detail?: string
  readonly metrics?: SearchStepMetrics
}

export type StepReporter = (
  event: SearchStepEvent,
  detail?: string,
  metrics?: SearchStepMetrics,
) => void

export type StepSink = (step: SearchStep) => void
