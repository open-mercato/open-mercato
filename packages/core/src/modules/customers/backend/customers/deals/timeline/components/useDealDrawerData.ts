"use client"

import * as React from 'react'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { toUtcDateKey } from '../../../../../lib/dealsTimeline'
import type { DealTimelineAssociation } from '../../../../../lib/dealsTimelineTypes'

export type DealDrawerStage = {
  id: string
  label: string
}

export type DealDrawerPipelineState = {
  openActivitiesCount: number
  daysInCurrentStage: number
  isStuck: boolean
  isOverdue: boolean
}

export type DealDrawerDeal = {
  id: string
  title: string
  status: string | null
  pipelineId: string | null
  pipelineName: string | null
  pipelineStageId: string | null
  pipelineStage: string | null
  stages: DealDrawerStage[]
  valueAmount: number | null
  valueCurrency: string | null
  probability: number | null
  expectedCloseAt: string | null
  ownerUserId: string | null
  ownerName: string | null
  updatedAt: string | null
  primaryCompany: DealTimelineAssociation | null
  primaryPerson: DealTimelineAssociation | null
  pipelineState: DealDrawerPipelineState | null
}

export type DealDrawerLoadState =
  | { status: 'idle'; deal: null }
  | { status: 'loading'; deal: DealDrawerDeal | null }
  | { status: 'ready'; deal: DealDrawerDeal }
  | { status: 'missing'; deal: null }
  | { status: 'error'; deal: DealDrawerDeal | null }

export type DealDrawerPermissions = {
  canOpenDeal: boolean
  canOpenCompany: boolean
  canOpenPerson: boolean
  canScheduleFollowUp: boolean
  isLoading: boolean
}

export const DEAL_DRAWER_FEATURES = [
  'customers.deals.manage',
  'customers.companies.view',
  'customers.people.view',
  'customers.interactions.manage',
] as const

const NO_REDIRECT_HEADERS = { 'x-om-forbidden-redirect': '0' }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readFirstAssociation(value: unknown): DealTimelineAssociation | null {
  if (!Array.isArray(value)) return null
  for (const entry of value) {
    const record = asRecord(entry)
    const id = readString(record?.id)
    if (!id) continue
    return { id, label: readString(record?.label) ?? '' }
  }
  return null
}

function readPipelineState(value: unknown): DealDrawerPipelineState | null {
  const record = asRecord(value)
  if (!record) return null
  return {
    openActivitiesCount: readNumber(record.openActivitiesCount) ?? 0,
    daysInCurrentStage: readNumber(record.daysInCurrentStage) ?? 0,
    isStuck: record.isStuck === true,
    isOverdue: record.isOverdue === true,
  }
}

export function mapDealDrawerPayload(detail: unknown, listItem: unknown): DealDrawerDeal | null {
  const detailRecord = asRecord(detail)
  const deal = asRecord(detailRecord?.deal)
  const id = readString(deal?.id)
  if (!detailRecord || !deal || !id) return null
  const listRecord = asRecord(listItem)
  const stagesRaw = Array.isArray(detailRecord.pipelineStages) ? detailRecord.pipelineStages : []
  const stages: DealDrawerStage[] = []
  for (const entry of stagesRaw) {
    const record = asRecord(entry)
    const stageId = readString(record?.id)
    if (!stageId) continue
    stages.push({ id: stageId, label: readString(record?.label) ?? stageId })
  }
  const owner = asRecord(detailRecord.owner)
  return {
    id,
    title: readString(deal.title) ?? '',
    status: readString(deal.status),
    pipelineId: readString(deal.pipelineId),
    pipelineName: readString(detailRecord.pipelineName),
    pipelineStageId: readString(deal.pipelineStageId),
    pipelineStage: readString(deal.pipelineStage),
    stages,
    valueAmount: readNumber(deal.valueAmount),
    valueCurrency: readString(deal.valueCurrency),
    probability: readNumber(deal.probability),
    expectedCloseAt: toUtcDateKey(readString(deal.expectedCloseAt)),
    ownerUserId: readString(deal.ownerUserId),
    ownerName: readString(owner?.name),
    updatedAt: readString(listRecord?.updated_at) ?? readString(listRecord?.updatedAt) ?? readString(deal.updatedAt),
    primaryCompany: readFirstAssociation(detailRecord.companies),
    primaryPerson: readFirstAssociation(detailRecord.people),
    pipelineState: readPipelineState(listRecord?._pipeline),
  }
}

export async function fetchDealDrawerDeal(dealId: string): Promise<DealDrawerDeal | 'missing'> {
  const encoded = encodeURIComponent(dealId)
  const [detailCall, listCall] = await withScopedApiRequestHeaders(NO_REDIRECT_HEADERS, () =>
    Promise.all([
      apiCall<Record<string, unknown>>(`/api/customers/deals/${encoded}?include=stages&view=lite`),
      apiCall<{ items?: unknown[] }>(`/api/customers/deals?ids=${encoded}&pageSize=1`),
    ]),
  )
  if (detailCall.status === 403 || detailCall.status === 404) return 'missing'
  if (!detailCall.ok) throw new Error(`[internal] deal drawer load failed (${detailCall.status})`)
  const listItems = listCall.ok && Array.isArray(listCall.result?.items) ? listCall.result.items : []
  const listItem = listItems.find((entry) => asRecord(entry)?.id === dealId) ?? null
  if (listCall.ok && !listItem) return 'missing'
  const mapped = mapDealDrawerPayload(detailCall.result, listItem)
  return mapped ?? 'missing'
}

export function useDealDrawerData(dealId: string | null): {
  state: DealDrawerLoadState
  reload: () => Promise<DealDrawerDeal | null>
} {
  const [state, setState] = React.useState<DealDrawerLoadState>({ status: 'idle', deal: null })
  const requestRef = React.useRef(0)

  const load = React.useCallback(async (): Promise<DealDrawerDeal | null> => {
    if (!dealId) {
      setState({ status: 'idle', deal: null })
      return null
    }
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setState((previous) => ({
      status: 'loading',
      deal: previous.deal && previous.deal.id === dealId ? previous.deal : null,
    }))
    try {
      const result = await fetchDealDrawerDeal(dealId)
      if (requestRef.current !== requestId) return null
      if (result === 'missing') {
        setState({ status: 'missing', deal: null })
        return null
      }
      setState({ status: 'ready', deal: result })
      return result
    } catch {
      if (requestRef.current !== requestId) return null
      setState((previous) => ({ status: 'error', deal: previous.deal }))
      return null
    }
  }, [dealId])

  React.useEffect(() => {
    void load()
  }, [load])

  return { state, reload: load }
}

const permissionsPromises = new Map<number, Promise<string[]>>()

export function resetDealDrawerPermissionsCache(): void {
  permissionsPromises.clear()
}

async function loadGrantedFeatures(scopeVersion: number): Promise<string[]> {
  const cached = permissionsPromises.get(scopeVersion)
  if (cached) return cached
  const promise = apiCall<{ granted?: unknown[] }>('/api/auth/feature-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ features: DEAL_DRAWER_FEATURES }),
  })
    .then((call) =>
      call.ok && Array.isArray(call.result?.granted)
        ? call.result.granted.filter((feature): feature is string => typeof feature === 'string')
        : [],
    )
    .catch(() => {
      permissionsPromises.delete(scopeVersion)
      return []
    })
  permissionsPromises.clear()
  permissionsPromises.set(scopeVersion, promise)
  return promise
}

export function resolveDealDrawerPermissions(granted: string[]): Omit<DealDrawerPermissions, 'isLoading'> {
  return {
    canOpenDeal: hasAllFeatures(['customers.deals.manage'], granted),
    canOpenCompany: hasAllFeatures(['customers.companies.view'], granted),
    canOpenPerson: hasAllFeatures(['customers.people.view'], granted),
    canScheduleFollowUp: hasAllFeatures(['customers.interactions.manage'], granted),
  }
}

export function useDealDrawerPermissions(): DealDrawerPermissions {
  const [permissions, setPermissions] = React.useState<DealDrawerPermissions>({
    canOpenDeal: false,
    canOpenCompany: false,
    canOpenPerson: false,
    canScheduleFollowUp: false,
    isLoading: true,
  })
  const scopeVersion = useOrganizationScopeVersion()
  React.useEffect(() => {
    let cancelled = false
    void loadGrantedFeatures(scopeVersion).then((granted) => {
      if (!cancelled) setPermissions({ ...resolveDealDrawerPermissions(granted), isLoading: false })
    })
    return () => {
      cancelled = true
    }
  }, [scopeVersion])
  return permissions
}
