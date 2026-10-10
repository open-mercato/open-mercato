import type { z } from 'zod'
import type {
  xrayBottlenecksResponseSchema,
  xrayBreakdownResponseSchema,
  xrayCasesResponseSchema,
  xrayConformanceResponseSchema,
  xrayDurationsResponseSchema,
  xrayMapResponseSchema,
  xrayProcessesResponseSchema,
  xrayReworkResponseSchema,
  xraySettingsResponseSchema,
  xraySettingsUpdateSchema,
  xrayStatusResponseSchema,
  xraySuggestionDraftResponseSchema,
  xraySuggestionResponseSchema,
  xraySuggestionSchema,
  xraySuggestionsResponseSchema,
  xrayVariantsResponseSchema,
  xrayWorkflowDraftResponseSchema,
  xrayBackfillResponseSchema,
} from '../../../data/validators'

export type XrayProcessesResponse = z.infer<typeof xrayProcessesResponseSchema>
export type XrayProcessItem = XrayProcessesResponse['items'][number]
export type XrayMapResponse = z.infer<typeof xrayMapResponseSchema>
export type XrayMapNode = XrayMapResponse['nodes'][number]
export type XrayMapEdge = XrayMapResponse['edges'][number]
export type XrayCauseCounts = XrayMapNode['causes']
export type XrayVariantsResponse = z.infer<typeof xrayVariantsResponseSchema>
export type XrayVariantItem = XrayVariantsResponse['items'][number]
export type XrayDurationsResponse = z.infer<typeof xrayDurationsResponseSchema>
export type XrayDurationStats = XrayVariantItem['cycleTime']
export type XrayBottlenecksResponse = z.infer<typeof xrayBottlenecksResponseSchema>
export type XrayBottleneckItem = XrayBottlenecksResponse['items'][number]
export type XrayReworkResponse = z.infer<typeof xrayReworkResponseSchema>
export type XrayReworkStage = XrayReworkResponse['byStage'][number]
export type XrayConformanceResponse = z.infer<typeof xrayConformanceResponseSchema>
export type XrayConformanceOk = Extract<XrayConformanceResponse, { status: 'ok' }>
export type XrayConformanceModel = XrayConformanceOk['models'][number]
export type XrayBreakdownResponse = z.infer<typeof xrayBreakdownResponseSchema>
export type XrayBreakdownItem = XrayBreakdownResponse['items'][number]
export type XrayBreakdownGroup = XrayBreakdownResponse['groupBy']
export type XrayCasesResponse = z.infer<typeof xrayCasesResponseSchema>
export type XrayCaseItem = XrayCasesResponse['items'][number]
export type XraySettingsResponse = z.infer<typeof xraySettingsResponseSchema>
export type XraySettings = XraySettingsResponse['result']
export type XraySettingsUpdate = z.infer<typeof xraySettingsUpdateSchema>
export type XrayStatusResponse = z.infer<typeof xrayStatusResponseSchema>
export type XrayBackfillResponse = z.infer<typeof xrayBackfillResponseSchema>
export type XraySuggestion = z.infer<typeof xraySuggestionSchema>
export type XraySuggestionStatus = XraySuggestion['status']
export type XraySuggestionsResponse = z.infer<typeof xraySuggestionsResponseSchema>
export type XraySuggestionResponse = z.infer<typeof xraySuggestionResponseSchema>
export type XraySuggestionDraftResponse = z.infer<typeof xraySuggestionDraftResponseSchema>
export type XrayWorkflowDraftResponse = z.infer<typeof xrayWorkflowDraftResponseSchema>
export type XrayDraftCommand = NonNullable<XraySuggestionDraftResponse['commands']>[number]

/** The analytics envelope every per-process result carries (`n`, confidence, privacy and freshness markers). */
export type XrayEnvelopeView = Pick<
  XrayMapResponse,
  'n' | 'lowConfidence' | 'computedThrough' | 'incomplete' | 'kAnonymity' | 'suppressed' | 'window' | 'source'
>
