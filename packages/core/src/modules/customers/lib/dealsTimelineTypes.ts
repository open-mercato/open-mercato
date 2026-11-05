import type { DealTimelineBucket, DealTimelineGroupBy } from './dealsTimeline'

export type DealTimelineAssociation = {
  id: string
  label: string
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
  cells: DealTimelineCell[]
}

export type DealTimelineColumnResponse = {
  index: number
  from: string
  to: string
  isCurrent: boolean
  total: number
  truncated: boolean
}

export type DealTimelineResponse = {
  bucket: DealTimelineBucket
  groupBy: DealTimelineGroupBy
  weekStartsOn: number
  from: string
  to: string
  columns: DealTimelineColumnResponse[]
  lanes: DealTimelineLane[]
  overdueBefore: { count: number; latestExpectedCloseAt: string | null; before: string }
  undatedCount: number
  adjacent: { previous: string | null; next: string | null }
  scopeHasDeals: boolean
  truncated: boolean
  cardsTruncated: boolean
}

export type DealTimelineCellResponse = {
  lane: string
  column: number
  items: DealTimelineItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
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
