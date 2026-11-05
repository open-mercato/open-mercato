"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import { AlertTriangle, CalendarClock, Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import { useCurrentOrganization } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { mapDictionaryColorToTone, type FilterOptionTone } from '@open-mercato/shared/lib/query/advanced-filter'
import {
  addBuckets,
  addDays,
  alignToBucketStart,
  bucketIndexFor,
  buildTimelineColumns,
  defaultColumnCount,
  isoWeekNumber,
  shiftCloseDate,
  toUtcDateKey,
  DEAL_TIMELINE_UNASSIGNED_LANE,
  type DealTimelineBucket,
} from '../../../../../lib/dealsTimeline'
import { isOpenDealStatus } from '../../../../../lib/dealStatus'
import { buildDealsListHref } from '../../../../../lib/dealsListHref'
import type {
  DealTimelineColumnResponse,
  DealTimelineFilters,
  DealTimelineItem,
  DealTimelineLane,
  DealTimelineResponse,
} from '../../../../../lib/dealsTimelineTypes'
import type { DealTimelineSavedView } from '../../../../../lib/dealsTimelineSavedView'
import {
  fetchAssignableStaffMembers,
  type AssignableStaffMember,
} from '../../../../../components/detail/assignableStaff'
import { FilterBarRow } from '../../pipeline/components/FilterBarRow'
import { StatusFilterPopover } from '../../pipeline/components/StatusFilterPopover'
import { PipelineFilterPopover } from '../../pipeline/components/PipelineFilterPopover'
import { EntityFilterPopover, type EntityFilterOption } from '../../pipeline/components/EntityFilterPopover'
import { TONE_DOT_CLASS } from '../../pipeline/components/toneClasses'
import { TimelineControls } from './TimelineControls'
import { TimelineLane, formatTimelineCount, type TimelineLaneDisplay } from './TimelineLane'
import { TimelineCellPopover } from './TimelineCellPopover'
import { TimelineSavedViews } from './TimelineSavedViews'
import { TimelineDealCardPreview, formatTimelineDate } from './TimelineDealCard'
import { TimelineDealDrawer } from './TimelineDealDrawer'
import { TIMELINE_QUERY_ROOT, findTimelineDeal, useRescheduleDeal } from './useRescheduleDeal'
import {
  applyClosedToggle,
  applyStatusSelection,
  buildTimelineHref,
  emptyTimelineFilters,
  hasActiveTimelineFilters,
  resolveTimelineFrom,
  type TimelineUrlState,
  type TimelineUrlStatePatch,
} from './useTimelineUrlState'

export const TIMELINE_PER_CELL = 3
export const TIMELINE_COLUMN_CAP = 300
const COLLAPSED_LANES_STORAGE_PREFIX = 'customers.deals.timeline.collapsed'

const TIMELINE_FEATURES = [
  'customers.deals.manage',
  'customers.pipelines.view',
  'customers.companies.view',
  'perspectives.use',
] as const

export type TimelinePermissions = {
  loaded: boolean
  canManage: boolean
  canViewPipelines: boolean
  canUsePerspectives: boolean
}

export function useTimelinePermissions(): TimelinePermissions {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery<string[]>({
    queryKey: ['customers', 'deals', 'timeline-features', `scope:${scopeVersion}`],
    staleTime: 300_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const call = await apiCall<{ granted?: string[] }>('/api/auth/feature-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: TIMELINE_FEATURES }),
      })
      return Array.isArray(call.result?.granted) ? call.result!.granted! : []
    },
  })
  const granted = query.data ?? []
  return {
    loaded: query.isSuccess,
    canManage: hasAllFeatures(['customers.deals.manage'], granted),
    canViewPipelines: hasAllFeatures(['customers.pipelines.view'], granted),
    canUsePerspectives: hasAllFeatures(['perspectives.use'], granted),
  }
}

type PipelineRecord = { id: string; name: string }
type StageRecord = { id: string; label: string; pipelineId: string; order: number; color?: string | null }

const KNOWN_TONES = new Set<string>(Object.keys(TONE_DOT_CLASS))

export function toneAccentClass(tone: string | null | undefined): string {
  if (!tone) return 'bg-border'
  if (KNOWN_TONES.has(tone)) return TONE_DOT_CLASS[tone as FilterOptionTone]
  const mapped = mapDictionaryColorToTone(tone)
  return mapped ? TONE_DOT_CLASS[mapped] : 'bg-border'
}

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
const shortRangeFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

function utcDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`)
}

function readCollapsedLanes(storageKey: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function writeCollapsedLanes(storageKey: string, lanes: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(lanes))
  } catch {
    return
  }
}

export function buildTimelineApiParams(state: TimelineUrlState, today: string): URLSearchParams {
  const params = new URLSearchParams()
  params.set('bucket', state.bucket)
  params.set('groupBy', state.groupBy)
  params.set('from', resolveTimelineFrom(state, today))
  params.set('columns', String(defaultColumnCount(state.bucket)))
  params.set('perCell', String(TIMELINE_PER_CELL))
  const filters = state.filters
  if (filters.search?.trim()) params.set('search', filters.search.trim())
  for (const value of filters.status) params.append('status', value)
  if (filters.pipelineId) params.set('pipelineId', filters.pipelineId)
  for (const value of filters.ownerUserId) params.append('ownerUserId', value)
  for (const value of filters.personId) params.append('personId', value)
  for (const value of filters.companyId) params.append('companyId', value)
  params.set('excludeClosed', filters.excludeClosed ? 'true' : 'false')
  return params
}

export type DealsTimelineBoardProps = {
  state: TimelineUrlState
  update: (patch: TimelineUrlStatePatch, options?: { history?: 'push' | 'replace' }) => void
  permissions: TimelinePermissions
}

type PopoverState = { laneKey: string; column: number; focusDealId: string | null } | null
type MoveNotice = { dealId: string; date: string; laneKey: string | null } | null

type PendingReveal = { dealId: string; date: string; laneKey: string | null; targetFrom: string }

type PendingDrawerFocus = { kind: 'card'; dealId: string } | { kind: 'showDeal' }
type ActiveDrag = { laneKey: string; column: number; item: DealTimelineItem } | null

export function DealsTimelineBoard({ state, update, permissions }: DealsTimelineBoardProps): React.ReactElement {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const activeOrgId = useCurrentOrganization()?.id ?? null
  const currentUserId = useCurrentUserId()
  const todayKey = React.useMemo(() => toUtcDateKey(new Date()) ?? '', [])
  const { bucket, groupBy, filters } = state
  const fromKey = resolveTimelineFrom(state, todayKey)

  const apiParams = React.useMemo(() => buildTimelineApiParams(state, todayKey).toString(), [state, todayKey])
  const queryKey = React.useMemo(() => [...TIMELINE_QUERY_ROOT, `scope:${scopeVersion}`, apiParams], [apiParams, scopeVersion])
  const timelineQuery = useQuery<DealTimelineResponse>({
    queryKey,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      readApiResultOrThrow<DealTimelineResponse>(`/api/customers/deals/timeline?${apiParams}`, undefined, {
        errorMessage: translateWithFallback(t, 'customers.deals.timeline.loadError', 'Failed to load the timeline.'),
      }),
  })
  const data = timelineQuery.data ?? null

  const staffQuery = useQuery<AssignableStaffMember[]>({
    queryKey: ['customers', 'deals', 'timeline', 'staff', `scope:${scopeVersion}`, activeOrgId],
    staleTime: 300_000,
    queryFn: async () => {
      try {
        return await withScopedApiRequestHeaders({ 'x-om-forbidden-redirect': '0' }, () =>
          fetchAssignableStaffMembers('', { pageSize: 100, activeOrgId }),
        )
      } catch {
        return []
      }
    },
  })
  const ownerNames = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const member of staffQuery.data ?? []) {
      if (member.userId && member.displayName) map.set(member.userId, member.displayName)
    }
    return map
  }, [staffQuery.data])

  const pipelinesQuery = useQuery<PipelineRecord[]>({
    queryKey: ['customers', 'pipelines', `scope:${scopeVersion}`, 'timeline'],
    enabled: permissions.canViewPipelines,
    staleTime: 60_000,
    queryFn: async () => {
      const call = await withScopedApiRequestHeaders({ 'x-om-forbidden-redirect': '0' }, () =>
        apiCall<{ items?: PipelineRecord[] }>('/api/customers/pipelines'),
      )
      return call.ok && Array.isArray(call.result?.items) ? call.result!.items! : []
    },
  })
  const stagesQuery = useQuery<StageRecord[]>({
    queryKey: ['customers', 'pipeline-stages', `scope:${scopeVersion}`, 'timeline'],
    enabled: permissions.canViewPipelines,
    staleTime: 60_000,
    queryFn: async () => {
      const call = await withScopedApiRequestHeaders({ 'x-om-forbidden-redirect': '0' }, () =>
        apiCall<{ items?: StageRecord[] }>('/api/customers/pipeline-stages'),
      )
      return call.ok && Array.isArray(call.result?.items) ? call.result!.items! : []
    },
  })
  const stageToneById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const stage of stagesQuery.data ?? []) map.set(stage.id, toneAccentClass(stage.color ?? null))
    return map
  }, [stagesQuery.data])
  const stageLabelById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const stage of stagesQuery.data ?? []) map.set(stage.id, stage.label)
    return map
  }, [stagesQuery.data])

  const setFilters = React.useCallback(
    (next: DealTimelineFilters) => update({ filters: next }),
    [update],
  )

  const [ownerLabels, setOwnerLabels] = React.useState<Record<string, string>>({})
  const [peopleLabels, setPeopleLabels] = React.useState<Record<string, string>>({})
  const [companyLabels, setCompanyLabels] = React.useState<Record<string, string>>({})

  const loadOwnerOptions = React.useCallback(
    async (query: string): Promise<EntityFilterOption[]> => {
      let items: AssignableStaffMember[] = []
      try {
        items = await withScopedApiRequestHeaders({ 'x-om-forbidden-redirect': '0' }, () =>
          fetchAssignableStaffMembers(query ?? '', { pageSize: 100, activeOrgId }),
        )
      } catch {
        items = []
      }
      const options: EntityFilterOption[] = items
        .filter((member) => !!member.userId && !!member.displayName)
        .map((member) => ({ value: member.userId!, label: member.displayName! }))
      setOwnerLabels((prev) => {
        const next = { ...prev }
        for (const option of options) next[option.value] = option.label
        return next
      })
      return options
    },
    [activeOrgId],
  )
  const loadEntityOptions = React.useCallback(
    async (kind: 'people' | 'companies', query: string, signal: AbortSignal): Promise<EntityFilterOption[]> => {
      const params = new URLSearchParams({ page: '1', pageSize: '50' })
      if (query) params.set('search', query)
      params.set('sortField', kind === 'people' ? 'displayName' : 'display_name')
      params.set('sortDir', 'asc')
      const call = await apiCall<{ items?: Array<{ id?: string; display_name?: string }> }>(
        `/api/customers/${kind}?${params.toString()}`,
        { signal },
      )
      if (!call.ok) return []
      const options: EntityFilterOption[] = []
      for (const item of call.result?.items ?? []) {
        if (item.id && item.display_name) options.push({ value: item.id, label: item.display_name })
      }
      const setter = kind === 'people' ? setPeopleLabels : setCompanyLabels
      setter((prev) => {
        const next = { ...prev }
        for (const option of options) next[option.value] = option.label
        return next
      })
      return options
    },
    [],
  )

  const collapsedStorageKey = `${COLLAPSED_LANES_STORAGE_PREFIX}:${currentUserId ?? 'anon'}`
  const [collapsedLanes, setCollapsedLanes] = React.useState<string[]>([])
  React.useEffect(() => {
    setCollapsedLanes(readCollapsedLanes(collapsedStorageKey))
  }, [collapsedStorageKey])
  const toggleCollapsed = React.useCallback(
    (laneKey: string) => {
      setCollapsedLanes((prev) => {
        const next = prev.includes(laneKey) ? prev.filter((key) => key !== laneKey) : [...prev, laneKey]
        writeCollapsedLanes(collapsedStorageKey, next)
        return next
      })
    },
    [collapsedStorageKey],
  )

  const [popover, setPopover] = React.useState<PopoverState>(null)
  const [moveNotice, setMoveNotice] = React.useState<MoveNotice>(null)
  const [pendingReveal, setPendingReveal] = React.useState<PendingReveal | null>(null)
  const pendingDrawerFocusRef = React.useRef<PendingDrawerFocus | null>(null)
  const focusShowDealOnCloseRef = React.useRef(false)
  const [drawerRefreshToken, setDrawerRefreshToken] = React.useState(0)
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const drawerPushedRef = React.useRef(false)
  const showDealRef = React.useRef<HTMLButtonElement | null>(null)

  const focusCard = React.useCallback((dealId: string): boolean => {
    if (typeof document === 'undefined') return false
    const element = document.querySelector<HTMLElement>(`[data-timeline-card][data-deal-id="${CSS.escape(dealId)}"]`)
    if (!element) return false
    element.focus()
    return true
  }, [])

  const drawerOpen = !!state.dealId

  const afterReschedule = React.useCallback(
    (dealId: string, date: string, knownLaneKey: string | null = null) => {
      const current = queryClient.getQueryData<DealTimelineResponse>(queryKey)
      const location = findTimelineDeal(current, dealId)
      const laneKey = location?.laneKey ?? knownLaneKey
      const dateLabel = formatTimelineDate(date) ?? date
      if (location && location.position < TIMELINE_PER_CELL) {
        flash(
          translateWithFallback(t, 'customers.deals.timeline.reschedule.success', 'Close date moved to {date}', { date: dateLabel }),
          'success',
        )
        if (drawerOpen) {
          pendingDrawerFocusRef.current = { kind: 'card', dealId }
          return
        }
        window.requestAnimationFrame(() => focusCard(dealId))
        return
      }
      if (drawerOpen) pendingDrawerFocusRef.current = { kind: 'showDeal' }
      else focusShowDealOnCloseRef.current = true
      setMoveNotice({ dealId, date, laneKey })
    },
    [drawerOpen, focusCard, queryClient, queryKey, t],
  )

  React.useEffect(() => {
    if (!moveNotice || drawerOpen || !focusShowDealOnCloseRef.current) return
    focusShowDealOnCloseRef.current = false
    showDealRef.current?.focus()
  }, [drawerOpen, moveNotice])

  const handleShowDeal = React.useCallback(() => {
    if (!moveNotice) return
    const visibleColumn = data ? bucketIndexFor(moveNotice.date, data.columns) : -1
    const targetFrom = data && visibleColumn >= 0 ? data.from : alignToBucketStart(moveNotice.date, bucket)
    setPendingReveal({ ...moveNotice, targetFrom })
    setMoveNotice(null)
    if (!data || targetFrom !== data.from) update({ from: targetFrom })
  }, [bucket, data, moveNotice, update])

  React.useEffect(() => {
    if (!pendingReveal || !data || timelineQuery.isFetching) return
    if (data.from !== pendingReveal.targetFrom) return
    const location = findTimelineDeal(data, pendingReveal.dealId)
    setPendingReveal(null)
    if (location && location.position < TIMELINE_PER_CELL) {
      window.requestAnimationFrame(() => focusCard(pendingReveal.dealId))
      return
    }
    const column = bucketIndexFor(pendingReveal.date, data.columns)
    if (column < 0) return
    const laneKey = location?.laneKey ?? pendingReveal.laneKey
    const lane = laneKey
      ? data.lanes.find((candidate) => candidate.key === laneKey)
      : data.lanes.find((candidate) =>
          candidate.cells.some((cell) => cell.column === column && cell.total > TIMELINE_PER_CELL),
        )
    if (lane) setPopover({ laneKey: lane.key, column, focusDealId: pendingReveal.dealId })
  }, [data, focusCard, pendingReveal, timelineQuery.isFetching])

  const reschedule = useRescheduleDeal(queryKey)

  const openDeal = React.useCallback(
    (item: DealTimelineItem, element: HTMLElement) => {
      const inPopover = !!element.closest('[data-popover-deal-id]')
      returnFocusRef.current = inPopover && popover
        ? document.querySelector<HTMLElement>(
            `[data-more-trigger="${CSS.escape(`${popover.laneKey}:${popover.column}`)}"]`,
          )
        : element
      setPopover(null)
      drawerPushedRef.current = true
      update({ dealId: item.id }, { history: 'push' })
    },
    [popover, update],
  )

  const closeDrawer = React.useCallback(() => {
    const pendingFocus = pendingDrawerFocusRef.current
    pendingDrawerFocusRef.current = null
    if (pendingFocus?.kind === 'card') {
      returnFocusRef.current =
        document.querySelector<HTMLElement>(`[data-timeline-card][data-deal-id="${CSS.escape(pendingFocus.dealId)}"]`) ??
        returnFocusRef.current
    } else if (pendingFocus?.kind === 'showDeal') {
      returnFocusRef.current = showDealRef.current
    }
    if (drawerPushedRef.current) {
      drawerPushedRef.current = false
      router.back()
      return
    }
    update({ dealId: null })
  }, [router, update])

  const drawerItem = React.useMemo(
    () => (state.dealId ? findTimelineDeal(data, state.dealId)?.item ?? null : null),
    [data, state.dealId],
  )

  const invalidateTimeline = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey: TIMELINE_QUERY_ROOT }),
    [queryClient],
  )

  const handleDrawerChanged = React.useCallback(() => {
    void invalidateTimeline()
  }, [invalidateTimeline])

  const handleDrawerRescheduled = React.useCallback(
    (result: { dealId: string; expectedCloseAt: string }) => {
      const laneKey = findTimelineDeal(queryClient.getQueryData<DealTimelineResponse>(queryKey), result.dealId)?.laneKey ?? null
      void invalidateTimeline().then(() => afterReschedule(result.dealId, result.expectedCloseAt, laneKey))
    },
    [afterReschedule, invalidateTimeline, queryClient, queryKey],
  )

  const [activeDrag, setActiveDrag] = React.useState<ActiveDrag>(null)
  const [overColumn, setOverColumn] = React.useState<number | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
      coordinateGetter: timelineKeyboardCoordinates,
    }),
  )

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const payload = event.active.data.current as { laneKey?: string; column?: number; item?: DealTimelineItem } | undefined
    if (!payload?.item || typeof payload.laneKey !== 'string' || typeof payload.column !== 'number') return
    setActiveDrag({ laneKey: payload.laneKey, column: payload.column, item: payload.item })
    setOverColumn(payload.column)
  }, [])

  const handleDragOver = React.useCallback((event: DragOverEvent) => {
    const over = event.over?.data.current as { column?: number } | undefined
    setOverColumn(typeof over?.column === 'number' ? over.column : null)
  }, [])

  const handleDragCancel = React.useCallback(() => {
    setActiveDrag(null)
    setOverColumn(null)
  }, [])

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const drag = activeDrag
      setActiveDrag(null)
      setOverColumn(null)
      if (!drag || !event.over) return
      const target = event.over.data.current as { laneKey?: string; column?: number } | undefined
      if (!target || target.laneKey !== drag.laneKey || typeof target.column !== 'number') return
      const delta = target.column - drag.column
      if (delta === 0 || !drag.item.expectedCloseAt) return
      const nextDate = shiftCloseDate(drag.item.expectedCloseAt, bucket, delta)
      void reschedule({ item: drag.item, expectedCloseAt: nextDate }).then((outcome) => {
        if (state.dealId === drag.item.id) setDrawerRefreshToken((value) => value + 1)
        if (outcome === 'success') afterReschedule(drag.item.id, nextDate, drag.laneKey)
        else window.requestAnimationFrame(() => focusCard(drag.item.id))
      })
    },
    [activeDrag, afterReschedule, bucket, focusCard, reschedule, state.dealId],
  )

  const collisionDetection = React.useCallback<CollisionDetection>((args) => {
    const pointer = pointerWithin(args)
    return pointer.length ? pointer : rectIntersection(args)
  }, [])

  const dragHint = React.useMemo(() => {
    if (!activeDrag?.item.expectedCloseAt || overColumn === null) return null
    const delta = overColumn - activeDrag.column
    if (delta === 0) return null
    const date = formatTimelineDate(shiftCloseDate(activeDrag.item.expectedCloseAt, bucket, delta))
    const shift = translateWithFallback(t, `customers.deals.timeline.reschedule.shift.${bucket}`, '{delta}', {
      delta: delta > 0 ? `+${delta}` : String(delta),
    })
    return `${date ?? ''} · ${shift}`
  }, [activeDrag, bucket, overColumn, t])

  const canDragItem = React.useCallback(
    (item: DealTimelineItem) =>
      permissions.canManage && !!item.expectedCloseAt && isOpenDealStatus(item.status?.toLowerCase()),
    [permissions.canManage],
  )
  const dragDisabledHint = React.useCallback(
    (item: DealTimelineItem) => {
      if (!permissions.canManage) {
        return translateWithFallback(t, 'customers.deals.timeline.reschedule.readOnlyHint', 'You can view deals but not change their close dates.')
      }
      if (!isOpenDealStatus(item.status?.toLowerCase())) {
        return translateWithFallback(t, 'customers.deals.timeline.reschedule.closedHint', 'Closed deals can’t be rescheduled from the timeline.')
      }
      return null
    },
    [permissions.canManage, t],
  )

  const ownerLabelFor = React.useCallback(
    (ownerId: string | null) => {
      if (!ownerId) return translateWithFallback(t, 'customers.deals.timeline.lane.unassigned', 'Unassigned')
      return ownerNames.get(ownerId) ?? translateWithFallback(t, 'customers.deals.timeline.lane.owner', 'Owner')
    },
    [ownerNames, t],
  )
  const accentClassForItem = React.useCallback(
    (item: DealTimelineItem) => (item.pipelineStageId ? stageToneById.get(item.pipelineStageId) ?? 'bg-border' : 'bg-border'),
    [stageToneById],
  )
  const ownerLabelForItem = React.useCallback(
    (item: DealTimelineItem) => (groupBy === 'stage' && item.ownerUserId ? ownerLabelFor(item.ownerUserId) : null),
    [groupBy, ownerLabelFor],
  )

  const laneDisplay = React.useCallback(
    (lane: DealTimelineLane): TimelineLaneDisplay => {
      if (lane.kind === 'owner') {
        const ownerId = lane.owner?.id ?? null
        const known = ownerId ? ownerNames.get(ownerId) : null
        return {
          kind: 'owner',
          label: ownerLabelFor(lane.key === DEAL_TIMELINE_UNASSIGNED_LANE ? null : ownerId),
          avatarLabel: known ?? (ownerId ? ownerId.slice(0, 2).toUpperCase() : null),
          accentClass: 'bg-border',
        }
      }
      return {
        kind: 'stage',
        label: lane.stage?.label || translateWithFallback(t, 'customers.deals.timeline.lane.noStage', 'No stage'),
        accentClass: toneAccentClass(lane.stage?.tone ?? null),
        pipelineHeading: lane.stage?.pipelineName ?? null,
      }
    },
    [ownerLabelFor, ownerNames, t],
  )

  const sortedLanes = React.useMemo(() => {
    if (!data) return []
    if (data.groupBy !== 'owner') return data.lanes
    const rank = (lane: DealTimelineLane) => {
      if (lane.key === DEAL_TIMELINE_UNASSIGNED_LANE) return 2
      return lane.owner?.id && ownerNames.has(lane.owner.id) ? 0 : 1
    }
    return data.lanes.slice().sort((left, right) => {
      const byRank = rank(left) - rank(right)
      if (byRank !== 0) return byRank
      const leftName = (left.owner?.id && ownerNames.get(left.owner.id)) || left.key
      const rightName = (right.owner?.id && ownerNames.get(right.owner.id)) || right.key
      return leftName.localeCompare(rightName)
    })
  }, [data, ownerNames])

  const columnLabel = React.useCallback(
    (column: Pick<DealTimelineColumnResponse, 'from'>, columnBucket: DealTimelineBucket) => {
      if (columnBucket === 'week') {
        return translateWithFallback(t, 'customers.deals.timeline.column.week', 'Week {number}', {
          number: isoWeekNumber(column.from),
        })
      }
      if (columnBucket === 'month') return monthFormatter.format(utcDate(column.from))
      const start = utcDate(column.from)
      return translateWithFallback(t, 'customers.deals.timeline.column.quarter', 'Q{quarter} {year}', {
        quarter: Math.floor(start.getUTCMonth() / 3) + 1,
        year: start.getUTCFullYear(),
      })
    },
    [t],
  )
  const currentPillLabel = translateWithFallback(
    t,
    bucket === 'week'
      ? 'customers.deals.timeline.column.thisWeek'
      : bucket === 'month'
        ? 'customers.deals.timeline.column.thisMonth'
        : 'customers.deals.timeline.column.thisQuarter',
    bucket === 'week' ? 'This week' : bucket === 'month' ? 'This month' : 'This quarter',
  )

  const placeholderColumns = React.useMemo<DealTimelineColumnResponse[]>(
    () =>
      buildTimelineColumns(bucket, fromKey, defaultColumnCount(bucket), todayKey).map((column) => ({
        ...column,
        total: 0,
        truncated: false,
      })),
    [bucket, fromKey, todayKey],
  )
  const columns = data && data.bucket === bucket ? data.columns : placeholderColumns
  const gridTemplate = `minmax(12rem, 14rem) repeat(${columns.length}, minmax(12rem, 1fr))`
  const gridMinWidth = `${12 + columns.length * 12}rem`
  const rangeLabel = columns.length
    ? `${shortRangeFormatter.format(utcDate(columns[0].from))} – ${shortRangeFormatter.format(
        utcDate(addDays(columns[columns.length - 1].to, -1)),
      )} ${utcDate(addDays(columns[columns.length - 1].to, -1)).getUTCFullYear()}`
    : ''

  const listFilters = React.useMemo(
    () => ({ ...filters, search: filters.search }),
    [filters],
  )
  const undatedHref = buildDealsListHref({ ...listFilters, hasExpectedCloseAt: false })
  const truncatedColumn = data?.columns.find((column) => column.truncated) ?? null

  const handleKeyNavigation = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (activeDrag) return
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
      const target = event.target as HTMLElement
      if (!target.matches('[data-timeline-card]')) return
      const laneKey = target.dataset.laneKey
      const column = Number(target.dataset.column)
      if (!laneKey || Number.isNaN(column)) return
      const container = event.currentTarget
      const cardsIn = (col: number) =>
        Array.from(
          container.querySelectorAll<HTMLElement>(
            `[data-timeline-card][data-lane-key="${CSS.escape(laneKey)}"][data-column="${col}"]`,
          ),
        )
      let next: HTMLElement | undefined
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const cards = cardsIn(column)
        const index = cards.indexOf(target)
        next = cards[index + (event.key === 'ArrowDown' ? 1 : -1)]
      } else {
        const step = event.key === 'ArrowRight' ? 1 : -1
        for (let col = column + step; col >= 0 && col < columns.length; col += step) {
          const cards = cardsIn(col)
          if (cards.length) {
            next = cards[0]
            break
          }
        }
      }
      if (next) {
        event.preventDefault()
        next.focus()
      }
    },
    [activeDrag, columns.length],
  )

  const statusNode = (
    <StatusFilterPopover values={filters.status} onApply={(values) => setFilters(applyStatusSelection(filters, values))} />
  )
  const closedToggle = (
    <SegmentedControl
      size="sm"
      aria-label={translateWithFallback(t, 'customers.deals.timeline.closed.label', 'Closed deals')}
      value={filters.excludeClosed ? 'hide' : 'all'}
      onValueChange={(value) => setFilters(applyClosedToggle(filters, value !== 'all'))}
    >
      <SegmentedControlItem value="hide">
        {translateWithFallback(t, 'customers.deals.timeline.closed.hide', 'Hide closed deals')}
      </SegmentedControlItem>
      <SegmentedControlItem value="all">
        {translateWithFallback(t, 'customers.deals.timeline.closed.all', 'All deals')}
      </SegmentedControlItem>
    </SegmentedControl>
  )
  const leadingChips = (
    <>
      {closedToggle}
      {statusNode}
      {permissions.canViewPipelines ? (
        <PipelineFilterPopover
          pipelines={(pipelinesQuery.data ?? []).map((pipeline) => ({ id: pipeline.id, name: pipeline.name }))}
          selectedPipelineId={filters.pipelineId}
          onApply={(pipelineId) => setFilters({ ...filters, pipelineId })}
        />
      ) : null}
      <EntityFilterPopover
        label={translateWithFallback(t, 'customers.deals.kanban.filter.owner', 'Owner')}
        anyLabel={translateWithFallback(t, 'customers.deals.kanban.filter.all', 'All')}
        values={filters.ownerUserId}
        onApply={(values) => setFilters({ ...filters, ownerUserId: values })}
        loadOptions={loadOwnerOptions}
        labelById={ownerLabels}
      />
      <EntityFilterPopover
        label={translateWithFallback(t, 'customers.deals.kanban.filter.people', 'People')}
        values={filters.personId}
        onApply={(values) => setFilters({ ...filters, personId: values })}
        loadOptions={(query, signal) => loadEntityOptions('people', query, signal)}
        labelById={peopleLabels}
      />
      <EntityFilterPopover
        label={translateWithFallback(t, 'customers.deals.kanban.filter.companies', 'Companies')}
        values={filters.companyId}
        onApply={(values) => setFilters({ ...filters, companyId: values })}
        loadOptions={(query, signal) => loadEntityOptions('companies', query, signal)}
        labelById={companyLabels}
      />
    </>
  )
  const clearFiltersNode = hasActiveTimelineFilters(filters) ? (
    <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(emptyTimelineFilters())}>
      {translateWithFallback(t, 'customers.deals.timeline.clearFilters', 'Clear filters')}
    </Button>
  ) : null

  const currentSavedView = React.useMemo<DealTimelineSavedView>(
    () => ({
      status: filters.status,
      pipelineId: filters.pipelineId,
      ownerUserId: filters.ownerUserId,
      personId: filters.personId,
      companyId: filters.companyId,
      excludeClosed: filters.excludeClosed,
      groupBy,
      bucket,
      ...(filters.search ? { search: filters.search } : {}),
    }),
    [bucket, filters, groupBy],
  )
  const applySavedView = React.useCallback(
    (view: DealTimelineSavedView) => {
      update({
        bucket: view.bucket,
        groupBy: view.groupBy,
        from: null,
        filters: {
          search: view.search,
          status: view.status,
          pipelineId: view.pipelineId,
          ownerUserId: view.ownerUserId,
          personId: view.personId,
          companyId: view.companyId,
          excludeClosed: view.excludeClosed,
        },
      })
    },
    [update],
  )

  const moveWindow = React.useCallback(
    (step: number) => update({ from: addBuckets(fromKey, bucket, step) }),
    [bucket, fromKey, update],
  )

  if (timelineQuery.isError && !data) {
    return (
      <div className="mt-4 flex flex-col items-start gap-2">
        <ErrorMessage
          label={translateWithFallback(t, 'customers.deals.timeline.loadError', 'Failed to load the timeline.')}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void timelineQuery.refetch()}>
              {translateWithFallback(t, 'customers.deals.timeline.retry', 'Retry')}
            </Button>
          }
        />
      </div>
    )
  }

  if (data && !data.scopeHasDeals) {
    return (
      <EmptyState
        className="mt-6"
        icon={<CalendarClock className="size-8" aria-hidden="true" />}
        title={translateWithFallback(t, 'customers.deals.timeline.empty.noDeals.title', 'No deals yet')}
        description={
          permissions.canManage
            ? translateWithFallback(t, 'customers.deals.timeline.empty.noDeals.description', 'Create a deal with an expected close date to see it on the timeline.')
            : translateWithFallback(t, 'customers.deals.timeline.empty.noDeals.askAdmin', 'No deals are visible to you yet. Ask an administrator to create one.')
        }
        actions={
          permissions.canManage ? (
            <Button asChild>
              <Link href={`/backend/customers/deals/create?returnTo=${encodeURIComponent(buildTimelineHref({ ...state, dealId: null }))}`}>
                <Plus className="size-4" aria-hidden="true" />
                {translateWithFallback(t, 'customers.deals.timeline.empty.noDeals.create', 'Create deal')}
              </Link>
            </Button>
          ) : null
        }
      />
    )
  }

  const noResults = !!data && data.lanes.every((lane) => lane.total === 0) && data.columns.every((column) => column.total === 0)
  const isLoadingInitial = !data
  const isRefreshing = !!data && timelineQuery.isFetching && timelineQuery.isPlaceholderData

  return (
    <div className="mt-4 flex flex-col gap-3">
      <FilterBarRow leadingChips={leadingChips} chips={[]} sortNode={clearFiltersNode} onChipClick={() => undefined} />
      {permissions.canUsePerspectives ? <TimelineSavedViews currentView={currentSavedView} onApply={applySavedView} /> : null}
      <TimelineControls
        bucket={bucket}
        groupBy={groupBy}
        rangeLabel={rangeLabel}
        onBucketChange={(next) => update({ bucket: next, from: null })}
        onGroupByChange={(next) => update({ groupBy: next })}
        onPrevious={() => moveWindow(-1)}
        onToday={() => update({ from: null })}
        onNext={() => moveWindow(1)}
      />

      {moveNotice ? (
        <Alert
          status="success"
          size="sm"
          dismissible
          onDismiss={() => setMoveNotice(null)}
          dismissAriaLabel={translateWithFallback(t, 'customers.deals.timeline.reschedule.dismiss', 'Dismiss')}
          action={
            <Button ref={showDealRef} type="button" variant="outline" size="sm" onClick={handleShowDeal}>
              {translateWithFallback(t, 'customers.deals.timeline.reschedule.showDeal', 'Show deal')}
            </Button>
          }
        >
          <AlertDescription>
            {translateWithFallback(t, 'customers.deals.timeline.reschedule.success', 'Close date moved to {date}', {
              date: formatTimelineDate(moveNotice.date) ?? moveNotice.date,
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {truncatedColumn ? (
        <Alert
          status="information"
          size="sm"
          action={
            <Button asChild variant="outline" size="sm">
              <Link
                href={buildDealsListHref({
                  ...listFilters,
                  closeDateRange: { from: truncatedColumn.from, to: truncatedColumn.to },
                })}
              >
                {translateWithFallback(t, 'customers.deals.timeline.truncatedOpenInList', 'Open in List')}
              </Link>
            </Button>
          }
        >
          <AlertDescription>
            {translateWithFallback(
              t,
              'customers.deals.timeline.truncated',
              'Showing the first {count} deals in {column}. Some owners or stages may be missing, and counts there are partial.',
              { count: TIMELINE_COLUMN_CAP, column: columnLabel(truncatedColumn, bucket) },
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {data && data.overdueBefore.count > 0 && data.overdueBefore.latestExpectedCloseAt ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-status-error-border bg-status-error-bg text-status-error-text hover:bg-status-error-bg"
            onClick={() => update({ from: alignToBucketStart(data.overdueBefore.latestExpectedCloseAt!, bucket) })}
          >
            <AlertTriangle className="size-4" aria-hidden="true" />
            {translateWithFallback(t, 'customers.deals.timeline.overdueBefore', '{count} overdue before {date}', {
              count: data.overdueBefore.count,
              date: formatTimelineDate(data.overdueBefore.before) ?? data.overdueBefore.before,
            })}
          </Button>
        </div>
      ) : null}

      {noResults ? (
        <EmptyState
          icon={<CalendarClock className="size-8" aria-hidden="true" />}
          title={translateWithFallback(t, 'customers.deals.timeline.empty.noResults.title', 'No deals close in this period')}
          description={translateWithFallback(
            t,
            'customers.deals.timeline.empty.noResults.description',
            'Change the filters or move the window to find deals.',
          )}
          actions={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {hasActiveTimelineFilters(filters) ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setFilters(emptyTimelineFilters())}>
                  {translateWithFallback(t, 'customers.deals.timeline.clearFilters', 'Clear filters')}
                </Button>
              ) : null}
              {filters.excludeClosed ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setFilters(applyClosedToggle(filters, false))}>
                  {translateWithFallback(t, 'customers.deals.timeline.empty.showClosed', 'Show closed deals')}
                </Button>
              ) : null}
              {data?.adjacent.previous ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => update({ from: alignToBucketStart(data.adjacent.previous!, bucket) })}
                >
                  {translateWithFallback(t, 'customers.deals.timeline.jump.previous', 'Jump to previous deal')}
                </Button>
              ) : null}
              {data?.adjacent.next ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => update({ from: alignToBucketStart(data.adjacent.next!, bucket) })}
                >
                  {translateWithFallback(t, 'customers.deals.timeline.jump.next', 'Jump to next deal')}
                </Button>
              ) : null}
            </div>
          }
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          accessibility={{
            screenReaderInstructions: {
              draggable: translateWithFallback(
                t,
                'customers.deals.timeline.reschedule.dragInstructions',
                'Press Space to pick up the deal, Left or Right to move it between columns, Space to drop or Escape to cancel. Enter opens the deal.',
              ),
            },
          }}
        >
          <div
            role="grid"
            aria-busy={isLoadingInitial || isRefreshing}
            aria-label={translateWithFallback(t, 'customers.nav.deals.timeline', 'Deals Timeline')}
            onKeyDown={handleKeyNavigation}
            className={`overflow-x-auto rounded-lg border border-border transition-opacity ${isRefreshing ? 'opacity-60' : ''}`}
          >
            <div className="w-full" style={{ minWidth: gridMinWidth }}>
              <div role="row" className="grid border-b border-border bg-muted/40" style={{ gridTemplateColumns: gridTemplate }}>
                <div role="columnheader" className="sticky left-0 z-10 border-r border-border bg-muted px-2 py-2 text-xs font-semibold uppercase text-muted-foreground">
                  {groupBy === 'owner'
                    ? translateWithFallback(t, 'customers.deals.timeline.groupBy.owner', 'Owner')
                    : translateWithFallback(t, 'customers.deals.timeline.groupBy.stage', 'Stage')}
                </div>
                {columns.map((column) => (
                  <div
                    key={column.index}
                    role="columnheader"
                    className={`flex flex-col gap-0.5 border-l border-border px-2 py-2 ${column.isCurrent ? 'bg-accent-indigo/10' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{columnLabel(column, bucket)}</span>
                      {data ? (
                        <span className="text-xs text-muted-foreground">{column.total}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {bucket === 'week' ? (
                        <span className="text-xs text-muted-foreground">
                          {shortRangeFormatter.format(utcDate(column.from))} – {shortRangeFormatter.format(utcDate(addDays(column.to, -1)))}
                        </span>
                      ) : null}
                      {column.isCurrent ? (
                        <span className="rounded-full bg-accent-indigo px-1.5 py-px text-xs font-semibold text-accent-indigo-foreground">
                          {currentPillLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              {isLoadingInitial ? (
                [0, 1, 2].map((row) => (
                  <div key={row} className="grid border-b border-border" style={{ gridTemplateColumns: gridTemplate }}>
                    <div className="sticky left-0 border-r border-border bg-background p-2">
                      <Skeleton className="h-8 w-32" />
                    </div>
                    {columns.map((column) => (
                      <div key={column.index} className="flex flex-col gap-1.5 border-l border-border p-1.5">
                        <Skeleton className="h-18 w-full" />
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                sortedLanes.map((lane, index) => {
                  const display = laneDisplay(lane)
                  const previous = index > 0 ? sortedLanes[index - 1] : null
                  const showHeading =
                    lane.kind === 'stage' &&
                    !!display.pipelineHeading &&
                    (!previous || previous.stage?.pipelineId !== lane.stage?.pipelineId)
                  return (
                    <React.Fragment key={lane.key}>
                      {showHeading ? (
                        <div role="row" className="sticky left-0 border-b border-border bg-muted/40 px-3 py-1 text-xs font-semibold uppercase text-muted-foreground">
                          {display.pipelineHeading}
                        </div>
                      ) : null}
                      <TimelineLane
                        lane={lane}
                        display={display}
                        columns={columns}
                        gridTemplate={gridTemplate}
                        perCell={TIMELINE_PER_CELL}
                        todayKey={todayKey}
                        collapsed={collapsedLanes.includes(lane.key)}
                        onToggleCollapsed={toggleCollapsed}
                        activeDrag={activeDrag ? { laneKey: activeDrag.laneKey, column: activeDrag.column } : null}
                        canDragItem={canDragItem}
                        dragDisabledHint={dragDisabledHint}
                        canOpenInNewTab={permissions.canManage}
                        accentClassForItem={accentClassForItem}
                        ownerLabelForItem={ownerLabelForItem}
                        onOpenDeal={openDeal}
                        renderMore={({ lane: moreLane, cell, hiddenCount }) => {
                          const isOpen = popover?.laneKey === moreLane.key && popover.column === cell.column
                          const column = columns.find((candidate) => candidate.index === cell.column)
                          return (
                            <TimelineCellPopover
                              open={isOpen}
                              onOpenChange={(open) =>
                                setPopover(open ? { laneKey: moreLane.key, column: cell.column, focusDealId: null } : null)
                              }
                              laneKey={moreLane.key}
                              laneLabel={laneDisplay(moreLane).label}
                              column={cell.column}
                              columnLabel={column ? columnLabel(column, bucket) : ''}
                              baseParams={apiParams}
                              todayKey={todayKey}
                              focusDealId={isOpen ? popover?.focusDealId ?? null : null}
                              onOpenDeal={openDeal}
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                data-more-trigger={`${moreLane.key}:${cell.column}`}
                                className="justify-start text-muted-foreground"
                              >
                                {translateWithFallback(t, 'customers.deals.timeline.cell.more', '+{count} more', {
                                  count: formatTimelineCount(t, hiddenCount, cell.partial),
                                })}
                              </Button>
                            </TimelineCellPopover>
                          )
                        }}
                      />
                    </React.Fragment>
                  )
                })
              )}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {activeDrag ? (
              <TimelineDealCardPreview
                item={activeDrag.item}
                todayKey={todayKey}
                accentClass={accentClassForItem(activeDrag.item)}
                hint={dragHint}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <StageLegend data={data} stageToneById={stageToneById} stageLabelById={stageLabelById} />
        {data && data.undatedCount > 0 ? (
          <Link href={undatedHref} className="font-medium text-accent-indigo hover:underline">
            {translateWithFallback(t, 'customers.deals.timeline.undated', '{count} deals have no close date', {
              count: data.undatedCount,
            })}
          </Link>
        ) : null}
      </div>

      <TimelineDealDrawer
        dealId={state.dealId}
        onClose={closeDrawer}
        onDealChanged={handleDrawerChanged}
        onRescheduled={handleDrawerRescheduled}
        canManage={permissions.canManage}
        returnFocusRef={returnFocusRef}
        initialItem={drawerItem}
        refreshToken={drawerRefreshToken}
      />
    </div>
  )
}

function StageLegend({
  data,
  stageToneById,
  stageLabelById,
}: {
  data: DealTimelineResponse | null
  stageToneById: Map<string, string>
  stageLabelById: Map<string, string>
}): React.ReactElement | null {
  const t = useT()
  const entries = React.useMemo(() => {
    const seen = new Map<string, { label: string; accent: string }>()
    for (const lane of data?.lanes ?? []) {
      for (const cell of lane.cells) {
        for (const item of cell.items) {
          if (!item.pipelineStageId || seen.has(item.pipelineStageId)) continue
          const accent = stageToneById.get(item.pipelineStageId)
          if (!accent) continue
          seen.set(item.pipelineStageId, { label: stageLabelById.get(item.pipelineStageId) ?? item.pipelineStage ?? '', accent })
        }
      }
    }
    return Array.from(seen.entries()).filter(([, entry]) => entry.label)
  }, [data, stageToneById, stageLabelById])
  if (!entries.length) return <span />
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-label={translateWithFallback(t, 'customers.deals.timeline.legend', 'Stages')}>
      {entries.map(([id, entry]) => (
        <span key={id} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`size-2 rounded-full ${entry.accent}`} />
          {entry.label}
        </span>
      ))}
    </div>
  )
}

export const timelineKeyboardCoordinates: KeyboardCoordinateGetter = (event, { active, context }) => {
  if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') {
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') event.preventDefault()
    return undefined
  }
  event.preventDefault()
  const activeData = context.active?.data.current as { laneKey?: string; column?: number } | undefined
  const overData = context.over?.data.current as { column?: number } | undefined
  if (!activeData?.laneKey) return undefined
  const currentColumn = typeof overData?.column === 'number' ? overData.column : activeData.column ?? 0
  const targetColumn = currentColumn + (event.code === 'ArrowRight' ? 1 : -1)
  let targetRect: { left: number; top: number } | null = null
  for (const container of context.droppableContainers.getEnabled()) {
    const data = container.data.current as { laneKey?: string; column?: number } | undefined
    if (data?.laneKey !== activeData.laneKey || data.column !== targetColumn) continue
    const rect = context.droppableRects.get(container.id)
    if (rect) targetRect = { left: rect.left, top: rect.top }
  }
  if (!targetRect || !active) return undefined
  return { x: targetRect.left + 6, y: targetRect.top + 6 }
}
