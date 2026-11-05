"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  alignToBucketStart,
  defaultTimelineFrom,
  isDealTimelineBucket,
  isDealTimelineGroupBy,
  isValidDateKey,
  type DealTimelineBucket,
  type DealTimelineGroupBy,
} from '../../../../../lib/dealsTimeline'
import { isClosedDealStatus } from '../../../../../lib/dealStatus'
import type { DealTimelineFilters } from '../../../../../lib/dealsTimelineTypes'

export const TIMELINE_PATH = '/backend/customers/deals/timeline'

export type TimelineUrlState = {
  bucket: DealTimelineBucket
  groupBy: DealTimelineGroupBy
  from: string | null
  filters: DealTimelineFilters
  dealId: string | null
}

const LIST_PARAMS = ['status', 'ownerUserId', 'personId', 'companyId'] as const

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readUuid(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && UUID_PATTERN.test(trimmed) ? trimmed : null
}

function readUuidList(params: URLSearchParams, key: string): string[] {
  return readList(params, key).filter((value) => UUID_PATTERN.test(value))
}

function readList(params: URLSearchParams, key: string): string[] {
  const out = new Set<string>()
  for (const raw of params.getAll(key)) {
    for (const part of raw.split(',')) {
      const trimmed = part.trim()
      if (trimmed) out.add(trimmed)
    }
  }
  return Array.from(out)
}

function isClosedStatusValue(value: string): boolean {
  return isClosedDealStatus(value.trim().toLowerCase())
}

export function hasClosedStatus(status: string[]): boolean {
  return status.some(isClosedStatusValue)
}

export function pruneClosedStatuses(status: string[]): string[] {
  return status.filter((value) => !isClosedStatusValue(value))
}

export function emptyTimelineFilters(): DealTimelineFilters {
  return {
    search: undefined,
    status: [],
    pipelineId: null,
    ownerUserId: [],
    personId: [],
    companyId: [],
    excludeClosed: true,
  }
}

export function normalizeTimelineFilters(filters: DealTimelineFilters): DealTimelineFilters {
  if (!filters.excludeClosed || !hasClosedStatus(filters.status)) return filters
  return { ...filters, status: pruneClosedStatuses(filters.status) }
}

export function applyStatusSelection(filters: DealTimelineFilters, status: string[]): DealTimelineFilters {
  return {
    ...filters,
    status,
    excludeClosed: hasClosedStatus(status) ? false : filters.excludeClosed,
  }
}

export function applyClosedToggle(filters: DealTimelineFilters, excludeClosed: boolean): DealTimelineFilters {
  if (!excludeClosed) return { ...filters, excludeClosed: false }
  return { ...filters, excludeClosed: true, status: pruneClosedStatuses(filters.status) }
}

export function hasActiveTimelineFilters(filters: DealTimelineFilters): boolean {
  return (
    !!filters.search?.trim() ||
    filters.status.length > 0 ||
    !!filters.pipelineId ||
    filters.ownerUserId.length > 0 ||
    filters.personId.length > 0 ||
    filters.companyId.length > 0 ||
    !filters.excludeClosed
  )
}

export function parseTimelineUrlState(params: URLSearchParams): TimelineUrlState {
  const bucketRaw = params.get('bucket')
  const bucket: DealTimelineBucket = isDealTimelineBucket(bucketRaw) ? bucketRaw : 'week'
  const groupByRaw = params.get('groupBy')
  const groupBy: DealTimelineGroupBy = isDealTimelineGroupBy(groupByRaw) ? groupByRaw : 'owner'
  const fromRaw = params.get('from')?.trim() ?? ''
  const from = fromRaw && isValidDateKey(fromRaw) ? alignToBucketStart(fromRaw, bucket) : null
  const search = params.get('search')?.trim() || undefined
  const pipelineId = readUuid(params.get('pipelineId'))
  const dealId = readUuid(params.get('deal'))
  const filters = normalizeTimelineFilters({
    search,
    status: readList(params, 'status'),
    pipelineId,
    ownerUserId: readUuidList(params, 'ownerUserId'),
    personId: readUuidList(params, 'personId'),
    companyId: readUuidList(params, 'companyId'),
    excludeClosed: params.get('closed') !== 'all',
  })
  return { bucket, groupBy, from, filters, dealId }
}

export function buildTimelineSearchParams(state: TimelineUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.bucket !== 'week') params.set('bucket', state.bucket)
  if (state.groupBy !== 'owner') params.set('groupBy', state.groupBy)
  if (state.from) params.set('from', state.from)
  const filters = state.filters
  if (filters.search?.trim()) params.set('search', filters.search.trim())
  if (filters.pipelineId) params.set('pipelineId', filters.pipelineId)
  for (const key of LIST_PARAMS) {
    const values = filters[key]
    if (values.length) params.set(key, values.join(','))
  }
  if (!filters.excludeClosed) params.set('closed', 'all')
  if (state.dealId) params.set('deal', state.dealId)
  return params
}

export function buildTimelineHref(state: TimelineUrlState): string {
  const query = buildTimelineSearchParams(state).toString()
  return query ? `${TIMELINE_PATH}?${query}` : TIMELINE_PATH
}

export function resolveTimelineFrom(state: Pick<TimelineUrlState, 'bucket' | 'from'>, today: Date | string = new Date()): string {
  return state.from ?? defaultTimelineFrom(state.bucket, today)
}

export type TimelineUrlStatePatch = Partial<Omit<TimelineUrlState, 'filters'>> & {
  filters?: DealTimelineFilters
}

export function useTimelineUrlState() {
  const router = useRouter()
  const pathname = usePathname() ?? TIMELINE_PATH
  const searchParams = useSearchParams()
  const paramsKey = searchParams?.toString() ?? ''
  const state = React.useMemo(() => parseTimelineUrlState(new URLSearchParams(paramsKey)), [paramsKey])
  const stateRef = React.useRef(state)
  stateRef.current = state
  const pendingStateRef = React.useRef<TimelineUrlState | null>(null)
  const inFlightQueriesRef = React.useRef<string[]>([])

  React.useEffect(() => {
    const inFlight = inFlightQueriesRef.current
    const landedIndex = inFlight.indexOf(paramsKey)
    if (landedIndex === -1 || landedIndex === inFlight.length - 1) {
      inFlightQueriesRef.current = []
      pendingStateRef.current = null
      return
    }
    inFlightQueriesRef.current = inFlight.slice(landedIndex + 1)
  }, [paramsKey])

  const update = React.useCallback(
    (patch: TimelineUrlStatePatch, options?: { history?: 'push' | 'replace' }) => {
      const current = pendingStateRef.current ?? stateRef.current
      const next: TimelineUrlState = {
        ...current,
        ...patch,
        filters: patch.filters ? normalizeTimelineFilters(patch.filters) : current.filters,
      }
      pendingStateRef.current = next
      const query = buildTimelineSearchParams(next).toString()
      inFlightQueriesRef.current = [...inFlightQueriesRef.current, query]
      const href = query ? `${pathname}?${query}` : pathname
      if (options?.history === 'push') router.push(href, { scroll: false })
      else router.replace(href, { scroll: false })
    },
    [pathname, router],
  )

  return { state, update }
}
