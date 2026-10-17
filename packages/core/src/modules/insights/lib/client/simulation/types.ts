import type { z } from 'zod'
import type {
  SIMULATION_DECISION_VALUES,
  SIMULATION_RUN_STATUS_VALUES,
  simulationCancelResponseSchema,
  simulationCapabilitiesResponseSchema,
  simulationDecisionResponseSchema,
  simulationListResponseSchema,
  simulationRequestResponseSchema,
  simulationRecordsResponseSchema,
  simulationRequestSchema,
  simulationRunDetailSchema,
  simulationRunResponseSchema,
  simulationRunSummarySchema,
} from '../../../data/validators'

export type SimulationRunStatus = (typeof SIMULATION_RUN_STATUS_VALUES)[number]
export type SimulationDecisionValue = (typeof SIMULATION_DECISION_VALUES)[number]

export type SimulationCapabilities = z.infer<typeof simulationCapabilitiesResponseSchema>
export type SimulationKindCapability = SimulationCapabilities['kinds'][number]

export type SimulationRequestBody = z.infer<typeof simulationRequestSchema>
export type SimulationRequestResponse = z.infer<typeof simulationRequestResponseSchema>

export type SimulationRunSummary = z.infer<typeof simulationRunSummarySchema>
export type SimulationListResponse = z.infer<typeof simulationListResponseSchema>

export type SimulationRunDetail = z.infer<typeof simulationRunDetailSchema>
export type SimulationRunResponse = z.infer<typeof simulationRunResponseSchema>
export type SimulationRunResult = NonNullable<SimulationRunDetail['result']>
export type SimulationResultGroup = SimulationRunResult['groups'][number]
export type SimulationResultCell = SimulationResultGroup['cells'][number]
export type SimulationSample = SimulationResultCell['samples'][number]
export type SimulationDecisionView = SimulationRunDetail['decisions'][number]
export type SimulationResultSummary = NonNullable<SimulationRunResult['summary']>
export type SimulationExecution = SimulationRunDetail['execution']

export type SimulationRecordsResponse = z.infer<typeof simulationRecordsResponseSchema>
export type SimulationLiveRecord = SimulationRecordsResponse['items'][number]

export type SimulationDecisionResponse = z.infer<typeof simulationDecisionResponseSchema>
export type SimulationCancelResponse = z.infer<typeof simulationCancelResponseSchema>

export type SimulationIssue = { path: string; message: string }

/** A failed simulation call: HTTP status plus the route's `{ error, code, issues }` body when present. */
export type SimulationRequestError = {
  httpStatus: number | null
  code: string | null
  message: string | null
  issues: SimulationIssue[]
}

export type SimulationRequestResult<TBody> = { ok: true; body: TBody } | { ok: false; error: SimulationRequestError }
