export type Translate = (key: string, fallback: string, params?: Record<string, string | number>) => string

export type BaseValues = {
  title: string
  status: string
  pipelineId: string
  pipelineStageId: string
  valueAmount: string
  valueCurrency: string
  probability: string
  expectedCloseAt: string
  /** Optional so out-of-tree code constructing a BaseValues literal keeps compiling. */
  ownerUserId?: string
  description: string
  personIds: string[]
  companyIds: string[]
}

export const EMPTY_VALUES: BaseValues = {
  title: '',
  status: '',
  pipelineId: '',
  pipelineStageId: '',
  valueAmount: '',
  valueCurrency: '',
  probability: '',
  expectedCloseAt: '',
  ownerUserId: '',
  description: '',
  personIds: [],
  companyIds: [],
}
