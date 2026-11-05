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
import {
  DEAL_TIMELINE_SAVED_VIEW_MAX_SEARCH_LENGTH,
  DEAL_TIMELINE_SAVED_VIEW_MAX_STATUS_LENGTH,
  DEAL_TIMELINE_SAVED_VIEW_MAX_VALUES,
} from '../../../../../data/validators'
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
  return readList(params, key)
    .filter((value) => UUID_PATTERN.test(value))
    .slice(0, DEAL_TIMELINE_SAVED_VIEW_MAX_VALUES)
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
  const search = params.get('search')?.trim().slice(0, DEAL_TIMELINE_SAVED_VIEW_MAX_SEARCH_LENGTH) || undefined
  const pipelineId = readUuid(params.get('pipelineId'))
  const dealId = readUuid(params.get('deal'))
  const filters = normalizeTimelineFilters({
    search,
    status: readList(params, 'status')
      .filter((value) => value.length <= DEAL_TIMELINE_SAVED_VIEW_MAX_STATUS_LENGTH)
      .slice(0, DEAL_TIMELINE_SAVED_VIEW_MAX_VALUES),
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

export type TimelineUrlStateUpdate = TimelineUrlStatePatch | ((current: TimelineUrlState) => TimelineUrlStatePatch)

export const TIMELINE_BACK_NAVIGATION_TIMEOUT_MS = 1_000

type TimelineNavigation = 'push' | 'replace'

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
  const backPendingRef = React.useRef(false)
  const deferredNavigationRef = React.useRef<TimelineNavigation | null>(null)
  const backTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const navigate = React.useCallback(
    (query: string, navigation: TimelineNavigation) => {
      const href = query ? `${pathname}?${query}` : pathname
      if (navigation === 'push') router.push(href, { scroll: false })
      else router.replace(href, { scroll: false })
    },
    [pathname, router],
  )

  const flushDeferredNavigation = React.useCallback(
    (landedQuery: string | null) => {
      backPendingRef.current = false
      if (backTimeoutRef.current) {
        clearTimeout(backTimeoutRef.current)
        backTimeoutRef.current = null
      }
      const deferred = deferredNavigationRef.current
      deferredNavigationRef.current = null
      const pending = pendingStateRef.current
      if (!deferred || !pending) return false
      const query = buildTimelineSearchParams(pending).toString()
      if (query === landedQuery) return false
      inFlightQueriesRef.current = [query]
      navigate(query, deferred)
      return true
    },
    [navigate],
  )

  React.useEffect(() => () => {
    if (backTimeoutRef.current) clearTimeout(backTimeoutRef.current)
  }, [])

  React.useEffect(() => {
    if (backPendingRef.current) {
      if (flushDeferredNavigation(paramsKey)) return
      inFlightQueriesRef.current = []
      pendingStateRef.current = null
      return
    }
    const inFlight = inFlightQueriesRef.current
    const landedIndex = inFlight.indexOf(paramsKey)
    if (landedIndex === -1 || landedIndex === inFlight.length - 1) {
      inFlightQueriesRef.current = []
      pendingStateRef.current = null
      return
    }
    inFlightQueriesRef.current = inFlight.slice(landedIndex + 1)
  }, [flushDeferredNavigation, paramsKey])

  const update = React.useCallback(
    (change: TimelineUrlStateUpdate, options?: { history?: 'push' | 'replace' | 'back' }) => {
      const current = pendingStateRef.current ?? stateRef.current
      const patch = typeof change === 'function' ? change(current) : change
      const next: TimelineUrlState = {
        ...current,
        ...patch,
        filters: patch.filters ? normalizeTimelineFilters(patch.filters) : current.filters,
      }
      pendingStateRef.current = next
      const query = buildTimelineSearchParams(next).toString()
      if (options?.history === 'back') {
        inFlightQueriesRef.current = [...inFlightQueriesRef.current, query]
        backPendingRef.current = true
        if (backTimeoutRef.current) clearTimeout(backTimeoutRef.current)
        backTimeoutRef.current = setTimeout(() => {
          backTimeoutRef.current = null
          if (backPendingRef.current) flushDeferredNavigation(null)
        }, TIMELINE_BACK_NAVIGATION_TIMEOUT_MS)
        router.back()
        return
      }
      const navigation: TimelineNavigation = options?.history === 'push' ? 'push' : 'replace'
      if (backPendingRef.current) {
        deferredNavigationRef.current =
          navigation === 'push' || deferredNavigationRef.current === 'push' ? 'push' : 'replace'
        return
      }
      inFlightQueriesRef.current = [...inFlightQueriesRef.current, query]
      navigate(query, navigation)
    },
    [flushDeferredNavigation, navigate, router],
  )

  return { state, update }
}
