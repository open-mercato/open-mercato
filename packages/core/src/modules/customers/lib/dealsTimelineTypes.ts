import type { DealTimelineBucket, DealTimelineGroupBy } from './dealsTimeline'

export type DealTimelineAssociation = {
  id: string
  label: string
}

export type DealTimelineCurrencyTotal = {
  currency: string
  open: number
  weighted: number
  won: number
}

export type DealTimelineItem = {
  id: string
  title: string | null
  status: string | null
  valueAmount: number | null
  valueCurrency: string | null
  probability: number | null
  expectedCloseAt: string | null
  pipelineId: string | null
  pipelineStageId: string | null
  pipelineStage: string | null
  ownerUserId: string | null
  updatedAt: string | null
  primaryCompany: DealTimelineAssociation | null
  primaryPerson: DealTimelineAssociation | null
  openActivityCount: number | null
}

export type DealTimelineCell = {
  column: number
  total: number
  partial: boolean
  items: DealTimelineItem[]
}

export type DealTimelineStageMeta = {
  label: string
  pipelineId: string | null
  order?: number | null
  tone?: string | null
  pipelineName?: string | null
}

export type DealTimelineLane = {
  key: string
  kind: DealTimelineGroupBy
  owner: { id: string } | null
  stage: DealTimelineStageMeta | null
  total: number
  partial: boolean
  amounts: DealTimelineCurrencyTotal[]
  cells: DealTimelineCell[]
}

export type DealTimelineColumnResponse = {
  index: number
  from: string
  to: string
  isCurrent: boolean
  total: number
  truncated: boolean
  countCapped: boolean
  amounts: DealTimelineCurrencyTotal[]
}

export type DealTimelineResponse = {
  bucket: DealTimelineBucket
  groupBy: DealTimelineGroupBy
  weekStartsOn: number
  from: string
  to: string
  columns: DealTimelineColumnResponse[]
  lanes: DealTimelineLane[]
  overdueBefore: { count: number; latestExpectedCloseAt: string | null; before: string; countCapped: boolean }
  undatedCount: number
  undatedCountCapped: boolean
  adjacent: { previous: string | null; next: string | null }
  scopeHasDeals: boolean
  truncated: boolean
  cardsTruncated: boolean
  countsCapped: boolean
  amountsCapped: boolean
}

export type DealTimelineCellResponse = {
  lane: string
  column: number
  items: DealTimelineItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  countsCapped: boolean
}

export type DealTimelineFilters = {
  search?: string
  status: string[]
  pipelineId: string | null
  ownerUserId: string[]
  personId: string[]
  companyId: string[]
  excludeClosed: boolean
}
