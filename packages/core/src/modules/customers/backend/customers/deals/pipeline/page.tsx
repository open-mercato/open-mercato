"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { ChevronLeft, ChevronRight, Layers, Plus, RotateCcw, SlidersHorizontal, Workflow } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import type { RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { FilterOptionTone } from '@open-mercato/shared/lib/query/advanced-filter'
import { ViewTabsRow } from './components/ViewTabsRow'
import { FilterBarRow, type KanbanFilterChip } from './components/FilterBarRow'
import { Lane, type LaneStage } from './components/Lane'
import { LaneCurrencyBreakdown } from './components/LaneCurrencyBreakdown'
import { AddStageLane } from './components/AddStageLane'
import type { DealCardData } from './components/DealCard'
import {
  QuickDealDialog,
  type QuickDealContext,
  type QuickDealCompanyOption,
} from './components/QuickDealDialog'
import { AddStageDialog, type AddStageContext } from './components/AddStageDialog'
import { StatusFilterPopover } from './components/StatusFilterPopover'
import { PipelineFilterPopover } from './components/PipelineFilterPopover'
import { SortByPopover, type SortOption } from './components/SortByPopover'
import { EntityFilterPopover, type EntityFilterOption } from './components/EntityFilterPopover'
import { CloseDateFilterPopover, type CloseDateRange } from './components/CloseDateFilterPopover'
import { CustomizeViewDialog } from './components/CustomizeViewDialog'
import {
  ActivityComposerDialog,
  type ActivityComposerContext,
} from './components/ActivityComposerDialog'
import { BulkActionsBar } from './components/BulkActionsBar'
import { ChangeStageDialog } from './components/ChangeStageDialog'
import { ChangeOwnerDialog } from './components/ChangeOwnerDialog'
import { buildCrudExportUrl, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { runBulkDelete, groupBulkDeleteFailures } from '@open-mercato/ui/backend/utils/bulkDelete'
import {
  fetchAssignableStaffMembers,
  type AssignableStaffMember,
} from '../../../../components/detail/assignableStaff'

type PipelineRecord = { id: string; name: string; isDefault: boolean }

type StageAggregateRow = {
  stageId: string
  count: number
  openCount: number
  totalInBaseCurrency: number
  byCurrency: Array<{ currency: string; total: number; count: number }>
  convertedAll?: boolean
  missingRateCurrencies?: string[]
}

type StageAggregateResponse = {
  baseCurrencyCode: string | null
  perStage: StageAggregateRow[]
}

export type LaneAggregate = {
  count: number
  totalInBaseCurrency: number
  byCurrency: Array<{ currency: string; total: number; count: number }>
  baseCurrencyCode: string | null
  // Both fields default to "best case" so an older aggregate response (without these
  // fields) doesn't trigger spurious "partial conversion" warnings in the UI.
  convertedAll: boolean
  missingRateCurrencies: string[]
}
type PipelineStageRecord = { id: string; label: string; order: number; pipelineId: string }

type DealApiRecord = Record<string, unknown> & {
  id: string
  title?: string | null
  status?: string | null
  pipeline_stage?: string | null
  pipeline_id?: string | null
  pipeline_stage_id?: string | null
  value_amount?: number | string | null
  value_currency?: string | null
  probability?: number | string | null
  expected_close_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  owner_user_id?: string | null
  companies?: Array<{ id?: unknown; label?: unknown } | null> | null
  people?: Array<{ id?: unknown; label?: unknown } | null> | null
  _pipeline?: {
    openActivitiesCount?: number
    daysInCurrentStage?: number
    isStuck?: boolean
    isOverdue?: boolean
  } | null
}

const DEFAULT_SORT: SortOption = 'updated_desc'
const LANE_PAGE_SIZE = 25
const FALLBACK_TONES: FilterOptionTone[] = ['success', 'warning', 'error', 'info', 'neutral', 'brand']
// Module-level singleton so empty lanes get the same array reference every render —
// React.memo's identity check on the `deals` prop holds across renders.
const EMPTY_DEAL_ARRAY: DealCardData[] = []

// Lane width / resize configuration (~20% larger than original Figma spec for readability)
const DEFAULT_LANE_WIDTH = 308
const MIN_LANE_WIDTH = 240
const MAX_LANE_WIDTH = 576
const LANE_GAP = 14
const LANE_WIDTHS_STORAGE_KEY_PREFIX = 'kanban-lane-widths-v2'

function loadLaneWidths(scopeKey: string): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(`${LANE_WIDTHS_STORAGE_KEY_PREFIX}:${scopeKey}`)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= MIN_LANE_WIDTH && v <= MAX_LANE_WIDTH) {
        out[k] = v
      }
    }
    return out
  } catch {
    return {}
  }
}

function saveLaneWidths(scopeKey: string, widths: Record<string, number>) {
  if (typeof window === 'undefined') return
  try {
    if (Object.keys(widths).length === 0) {
      window.localStorage.removeItem(`${LANE_WIDTHS_STORAGE_KEY_PREFIX}:${scopeKey}`)
    } else {
      window.localStorage.setItem(`${LANE_WIDTHS_STORAGE_KEY_PREFIX}:${scopeKey}`, JSON.stringify(widths))
    }
  } catch {}
}

function normalizeAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeProbability(value: unknown): number | null {
  const parsed = normalizeAmount(value)
  if (parsed === null) return null
  return Math.min(Math.max(Math.round(parsed), 0), 100)
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim().length) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeAssociation(entry: unknown): { id: string; label: string } | null {
  if (!entry || typeof entry !== 'object') return null
  const ref = entry as Record<string, unknown>
  const id = typeof ref.id === 'string' ? ref.id : null
  if (!id) return null
  const label =
    typeof ref.label === 'string' && ref.label.trim().length ? ref.label.trim() : id
  return { id, label }
}

function mapDealRecord(item: DealApiRecord, fallbackTitle: string): DealCardData | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const title =
    typeof item.title === 'string' && item.title.trim().length ? item.title.trim() : fallbackTitle
  const status =
    typeof item.status === 'string' && item.status.trim().length ? item.status.trim() : null
  const valueAmount = normalizeAmount(item.value_amount)
  const valueCurrency =
    typeof item.value_currency === 'string' && item.value_currency.trim().length
      ? item.value_currency.trim().toUpperCase()
      : null
  const probability = normalizeProbability(item.probability)
  const expectedCloseAt = normalizeIso(item.expected_close_at)
  const createdAt = normalizeIso(item.created_at)
  const updatedAt = normalizeIso(item.updated_at)
  const ownerUserId =
    typeof item.owner_user_id === 'string' && item.owner_user_id.trim().length
      ? item.owner_user_id
      : null
  const companies = Array.isArray(item.companies)
    ? (item.companies.map(normalizeAssociation).filter(Boolean) as { id: string; label: string }[])
    : []
  const primaryCompany = companies[0] ?? null
  const pipelineState = {
    openActivitiesCount:
      typeof item._pipeline?.openActivitiesCount === 'number' ? item._pipeline.openActivitiesCount : 0,
    daysInCurrentStage:
      typeof item._pipeline?.daysInCurrentStage === 'number' ? item._pipeline.daysInCurrentStage : 0,
    isStuck: !!item._pipeline?.isStuck,
    isOverdue: !!item._pipeline?.isOverdue,
  }
  return {
    id,
    title,
    status,
    valueAmount,
    valueCurrency,
    probability,
    expectedCloseAt,
    createdAt,
    updatedAt,
    owner: ownerUserId ? { userId: ownerUserId, label: '' } : null,
    primaryCompany,
    pipelineState,
  }
}

function buildLaneStages(
  stages: PipelineStageRecord[],
  unassignedLabel: string,
  hasUnassigned: boolean,
): LaneStage[] {
  const sorted = stages.slice().sort((a, b) => a.order - b.order)
  const lanes: LaneStage[] = sorted.map((stage, index) => ({
    id: stage.id,
    label: stage.label,
    tone: FALLBACK_TONES[index % FALLBACK_TONES.length],
  }))
  if (hasUnassigned) {
    lanes.push({ id: '__unassigned', label: unassignedLabel, tone: 'neutral' })
  }
  return lanes
}

function groupDealsByStageId(deals: DealCardData[], stageIdByDealId: Map<string, string>): Map<string, DealCardData[]> {
  const grouped = new Map<string, DealCardData[]>()
  for (const deal of deals) {
    const stageKey = stageIdByDealId.get(deal.id) ?? '__unassigned'
    const bucket = grouped.get(stageKey) ?? []
    bucket.push(deal)
    grouped.set(stageKey, bucket)
  }
  return grouped
}

/**
 * Translate the UI SortOption into the deals CRUD API's `sortField` / `sortDir` query params.
 *
 * Returns `null` for `owner_asc` because the deals table only stores `owner_user_id` (a UUID);
 * the UI displays a resolved owner name, so a UUID-alphabetical server sort would be misleading.
 * For that case the caller falls back to a sensible default sort server-side and re-sorts the
 * page client-side via `sortDeals`. All other options sort server-side over the full result set,
 * so paging (25/lane → Show more) keeps a globally correct order.
 */
function mapSortOptionToApi(option: SortOption): { sortField: string; sortDir: 'asc' | 'desc' } | null {
  switch (option) {
    case 'updated_desc':
      return { sortField: 'updatedAt', sortDir: 'desc' }
    case 'updated_asc':
      return { sortField: 'updatedAt', sortDir: 'asc' }
    case 'created_desc':
      return { sortField: 'createdAt', sortDir: 'desc' }
    case 'value_desc':
      return { sortField: 'value', sortDir: 'desc' }
    case 'value_asc':
      return { sortField: 'value', sortDir: 'asc' }
    case 'probability_desc':
      return { sortField: 'probability', sortDir: 'desc' }
    case 'close_asc':
      return { sortField: 'expectedCloseAt', sortDir: 'asc' }
    case 'owner_asc':
    default:
      return null
  }
}

function sortDeals(deals: DealCardData[], option: SortOption): DealCardData[] {
  const sorted = deals.slice()
  sorted.sort((a, b) => {
    switch (option) {
      case 'value_desc':
      case 'value_asc': {
        const aValue = typeof a.valueAmount === 'number' ? a.valueAmount : Number.NEGATIVE_INFINITY
        const bValue = typeof b.valueAmount === 'number' ? b.valueAmount : Number.NEGATIVE_INFINITY
        return option === 'value_desc' ? bValue - aValue : aValue - bValue
      }
      case 'probability_desc': {
        const aProb = typeof a.probability === 'number' ? a.probability : -1
        const bProb = typeof b.probability === 'number' ? b.probability : -1
        return bProb - aProb
      }
      case 'close_asc': {
        const aTs = a.expectedCloseAt ? new Date(a.expectedCloseAt).getTime() : Number.POSITIVE_INFINITY
        const bTs = b.expectedCloseAt ? new Date(b.expectedCloseAt).getTime() : Number.POSITIVE_INFINITY
        return aTs - bTs
      }
      case 'created_desc': {
        const aTs = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bTs = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return bTs - aTs
      }
      case 'owner_asc': {
        // Owner sort is client-side only: deals carry `owner.userId` (UUID), and the human-readable
        // label is resolved separately via ownerNamesById. Compare on the resolved label that was
        // already merged into deal.owner.label by `dealsByStage`'s ownerNamesById pass.
        const aLabel = a.owner?.label ?? a.owner?.userId ?? ''
        const bLabel = b.owner?.label ?? b.owner?.userId ?? ''
        return aLabel.localeCompare(bLabel)
      }
      case 'updated_asc':
        return (a.updatedAt ?? a.createdAt ?? '').localeCompare(b.updatedAt ?? b.createdAt ?? '')
      case 'updated_desc':
      default:
        return (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '')
    }
  })
  return sorted
}

export default function DealsKanbanPage(): React.ReactElement {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()

  const [selectedPipelineId, setSelectedPipelineId] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [sortBy, setSortBy] = React.useState<SortOption>(DEFAULT_SORT)
  const [statusFilters, setStatusFilters] = React.useState<string[]>([])
  const [ownerFilters, setOwnerFilters] = React.useState<string[]>([])
  const [peopleFilters, setPeopleFilters] = React.useState<string[]>([])
  const [companyFilters, setCompanyFilters] = React.useState<string[]>([])
  const [closeDateFilter, setCloseDateFilter] = React.useState<CloseDateRange>({ from: null, to: null })
  // Cache labels for selected ids so the chip can show readable text without re-fetching
  const [ownerLabels, setOwnerLabels] = React.useState<Record<string, string>>({})
  const [peopleLabels, setPeopleLabels] = React.useState<Record<string, string>>({})
  const [companyLabels, setCompanyLabels] = React.useState<Record<string, string>>({})
  const [selectedDealIds, setSelectedDealIds] = React.useState<Set<string>>(new Set())
  const [pendingDealId, setPendingDealId] = React.useState<string | null>(null)
  const [quickDealContext, setQuickDealContext] = React.useState<QuickDealContext | null>(null)
  const [addStageContext, setAddStageContext] = React.useState<AddStageContext | null>(null)
  const [customizeOpen, setCustomizeOpen] = React.useState(false)
  const [activityContext, setActivityContext] = React.useState<ActivityComposerContext | null>(null)
  const [changeStageOpen, setChangeStageOpen] = React.useState(false)
  const [changeOwnerOpen, setChangeOwnerOpen] = React.useState(false)
  const [isBulkMutating, setIsBulkMutating] = React.useState(false)
  const [singleMoveStageContext, setSingleMoveStageContext] = React.useState<
    { dealId: string; currentStageId: string | null } | null
  >(null)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const fallbackTitle = translateWithFallback(
    t,
    'customers.deals.pipeline.untitled',
    'Untitled deal',
  )
  const unassignedLabel = translateWithFallback(
    t,
    'customers.deals.pipeline.unassigned',
    'No stage',
  )

  const pipelinesQuery = useQuery<PipelineRecord[]>({
    queryKey: ['customers', 'pipelines', `scope:${scopeVersion}`],
    staleTime: 60_000,
    queryFn: async () => {
      const payload = await readApiResultOrThrow<{ items: PipelineRecord[] }>(
        '/api/customers/pipelines',
        undefined,
        {
          errorMessage: translateWithFallback(
            t,
            'customers.deals.pipeline.loadError',
            'Failed to load pipelines.',
          ),
        },
      )
      return payload?.items ?? []
    },
  })

  React.useEffect(() => {
    if (selectedPipelineId) return
    const pipelines = pipelinesQuery.data
    if (!pipelines || !pipelines.length) return
    const defaultPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0]
    if (defaultPipeline) setSelectedPipelineId(defaultPipeline.id)
  }, [pipelinesQuery.data, selectedPipelineId])

  const staffQuery = useQuery<AssignableStaffMember[]>({
    queryKey: ['customers', 'deals', 'kanban', 'staff', `scope:${scopeVersion}`],
    staleTime: 300_000,
    queryFn: async () => fetchAssignableStaffMembers('', { pageSize: 100 }),
  })

  const ownerNamesById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const member of staffQuery.data ?? []) {
      if (member.userId && member.displayName) map.set(member.userId, member.displayName)
    }
    return map
  }, [staffQuery.data])

  const currentUserId = useCurrentUserId()
  const currentUserLabel = React.useMemo(() => {
    if (!currentUserId) return undefined
    return ownerNamesById.get(currentUserId)
  }, [currentUserId, ownerNamesById])

  // Per-user, per-pipeline persisted lane widths. localStorage is per-browser per-user — exactly
  // matches the "remember my preferred column widths" UX from Monday / Asana / ClickUp.
  const laneWidthsScopeKey = React.useMemo(
    () => `${currentUserId ?? 'anon'}:${selectedPipelineId ?? 'none'}`,
    [currentUserId, selectedPipelineId],
  )
  const [laneWidths, setLaneWidths] = React.useState<Record<string, number>>({})
  // Hydrate from localStorage when the scope (user / pipeline) changes
  React.useEffect(() => {
    setLaneWidths(loadLaneWidths(laneWidthsScopeKey))
  }, [laneWidthsScopeKey])
  // Persist on change (debounced via setTimeout to coalesce drag-frame updates)
  React.useEffect(() => {
    const handle = window.setTimeout(() => saveLaneWidths(laneWidthsScopeKey, laneWidths), 250)
    return () => window.clearTimeout(handle)
  }, [laneWidthsScopeKey, laneWidths])

  const handleLaneResize = React.useCallback(
    (stageId: string, deltaPx: number) => {
      setLaneWidths((prev) => {
        const current = prev[stageId] ?? DEFAULT_LANE_WIDTH
        const next = Math.max(MIN_LANE_WIDTH, Math.min(MAX_LANE_WIDTH, current + deltaPx))
        if (next === current) return prev
        return { ...prev, [stageId]: next }
      })
    },
    [],
  )
  const handleResetLaneWidth = React.useCallback((stageId: string) => {
    setLaneWidths((prev) => {
      if (!(stageId in prev)) return prev
      const { [stageId]: _omit, ...rest } = prev
      return rest
    })
  }, [])
  const handleResetAllLaneWidths = React.useCallback(() => {
    setLaneWidths({})
  }, [])

  const companiesQuery = useQuery<QuickDealCompanyOption[]>({
    queryKey: ['customers', 'companies', 'kanban-quick-deal', `scope:${scopeVersion}`],
    staleTime: 300_000,
    queryFn: async () => {
      const call = await apiCall<{ items?: Array<{ id?: unknown; display_name?: unknown }> }>(
        '/api/customers/companies?page=1&pageSize=100&sortField=display_name&sortDir=asc',
      )
      if (!call.ok) return []
      const items = Array.isArray(call.result?.items) ? call.result!.items! : []
      const options: QuickDealCompanyOption[] = []
      for (const item of items) {
        const id = typeof item.id === 'string' ? item.id : null
        const displayName =
          typeof item.display_name === 'string' && item.display_name.trim().length
            ? item.display_name.trim()
            : null
        if (id && displayName) options.push({ id, label: displayName })
      }
      return options
    },
  })

  const stagesQuery = useQuery<PipelineStageRecord[]>({
    queryKey: ['customers', 'pipeline-stages', `scope:${scopeVersion}`, `pipeline:${selectedPipelineId}`],
    enabled: !!selectedPipelineId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!selectedPipelineId) return []
      const payload = await readApiResultOrThrow<{ items: PipelineStageRecord[] }>(
        `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(selectedPipelineId)}`,
        undefined,
        {
          errorMessage: translateWithFallback(
            t,
            'customers.deals.pipeline.loadError',
            'Failed to load stages.',
          ),
        },
      )
      return payload?.items ?? []
    },
  })

  // Per-lane "Show more" state. Each lane's first 25 are loaded via useQueries; subsequent pages are
  // fetched on demand and appended here, so the cached page-1 cards stay in place (no full lane refetch).
  const [extraCardsByStage, setExtraCardsByStage] = React.useState<Record<string, DealApiRecord[]>>({})
  const [loadingMoreByStage, setLoadingMoreByStage] = React.useState<Record<string, boolean>>({})
  // Reset extra-cards + loading state when any filter changes
  React.useEffect(() => {
    setExtraCardsByStage({})
    setLoadingMoreByStage({})
  }, [selectedPipelineId, search, statusFilters, ownerFilters, peopleFilters, companyFilters, closeDateFilter])

  // Filter signature shared by every per-lane query so all lanes invalidate together when filters change
  const filterSignature = React.useMemo(
    () => ({
      pipelineId: selectedPipelineId,
      search: search.trim(),
      status: statusFilters.slice().sort().join(','),
      owners: ownerFilters.slice().sort().join(','),
      people: peopleFilters.slice().sort().join(','),
      companies: companyFilters.slice().sort().join(','),
      closeFrom: closeDateFilter.from ?? '',
      closeTo: closeDateFilter.to ?? '',
    }),
    [selectedPipelineId, search, statusFilters, ownerFilters, peopleFilters, companyFilters, closeDateFilter],
  )

  // Aggregate query — gives accurate per-stage counts + totals (in base currency) across the entire pipeline,
  // not just the loaded slice. Drives both lane headers and pagination decisions.
  const aggregateQuery = useQuery<StageAggregateResponse | null>({
    queryKey: [
      'customers',
      'deals',
      'kanban-aggregate',
      `scope:${scopeVersion}`,
      `pipeline:${selectedPipelineId ?? 'none'}`,
      `status:${filterSignature.status}`,
      `owners:${filterSignature.owners}`,
      `people:${filterSignature.people}`,
      `companies:${filterSignature.companies}`,
      `close:${filterSignature.closeFrom}-${filterSignature.closeTo}`,
    ],
    enabled: !!selectedPipelineId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!selectedPipelineId) return null
      const params = new URLSearchParams()
      params.set('pipelineId', selectedPipelineId)
      for (const status of statusFilters) params.append('status', status)
      for (const ownerId of ownerFilters) params.append('ownerUserId', ownerId)
      for (const personId of peopleFilters) params.append('personId', personId)
      for (const companyId of companyFilters) params.append('companyId', companyId)
      if (closeDateFilter.from) params.set('expectedCloseAtFrom', closeDateFilter.from)
      if (closeDateFilter.to) params.set('expectedCloseAtTo', closeDateFilter.to)
      const call = await apiCall<StageAggregateResponse>(
        `/api/customers/deals/aggregate?${params.toString()}`,
      )
      return call.ok ? call.result ?? null : null
    },
  })

  const aggregateByStage = React.useMemo(() => {
    const map = new Map<string, LaneAggregate>()
    const data = aggregateQuery.data
    if (!data) return map
    for (const row of data.perStage) {
      map.set(row.stageId, {
        count: row.count,
        totalInBaseCurrency: row.totalInBaseCurrency,
        byCurrency: row.byCurrency,
        baseCurrencyCode: data.baseCurrencyCode,
        // Default to "complete conversion" when the field is absent (older response, or no
        // base currency case where the route still returns the field). The aggregate route
        // explicitly sets `convertedAll: false` when at least one currency was excluded.
        convertedAll: row.convertedAll ?? true,
        missingRateCurrencies: row.missingRateCurrencies ?? [],
      })
    }
    return map
  }, [aggregateQuery.data])

  const stagesData = stagesQuery.data ?? []
  const aggregateData = aggregateQuery.data

  // Pre-compute the lane shape from stages + aggregate so unassigned cards still show up if any
  const lanes = React.useMemo<LaneStage[]>(() => {
    const knownStageIds = new Set(stagesData.map((stage) => stage.id))
    const hasUnassigned = (aggregateData?.perStage ?? []).some(
      (row) => row.stageId === '__unassigned' || (!!row.stageId && !knownStageIds.has(row.stageId)),
    )
    return buildLaneStages(stagesData, unassignedLabel, hasUnassigned)
  }, [stagesData, aggregateData, unassignedLabel])

  // Resolve the active SortOption to an API sort once per change. Owner sort has no server
  // representation (only owner_user_id exists in the deals table; the displayed name is resolved
  // client-side), so it falls back to `updatedAt desc` server-side and is re-sorted client-side.
  const apiSort = React.useMemo(() => {
    const mapped = mapSortOptionToApi(sortBy)
    return mapped ?? { sortField: 'updatedAt' as const, sortDir: 'desc' as const }
  }, [sortBy])

  const laneQueries = useQueries({
    queries: lanes.map((stage) => {
      return {
        queryKey: [
          'customers',
          'deals',
          'kanban-lane',
          `scope:${scopeVersion}`,
          `pipeline:${filterSignature.pipelineId ?? 'none'}`,
          `search:${filterSignature.search}`,
          `status:${filterSignature.status}`,
          `owners:${filterSignature.owners}`,
          `people:${filterSignature.people}`,
          `companies:${filterSignature.companies}`,
          `close:${filterSignature.closeFrom}-${filterSignature.closeTo}`,
          // Sort affects which 25 deals come back on page 1, so it MUST be in the key —
          // otherwise switching from "Value (high to low)" to "Close (soonest)" reuses
          // the old (wrong-sort) cache and silently keeps the wrong slice on screen.
          `sort:${apiSort.sortField}:${apiSort.sortDir}`,
          `stage:${stage.id}`,
        ],
        enabled: !!selectedPipelineId,
        staleTime: 30_000,
        queryFn: async () => {
          if (!selectedPipelineId) return { items: [] as DealApiRecord[], total: 0 }
          const params = new URLSearchParams()
          params.set('page', '1')
          params.set('pageSize', String(LANE_PAGE_SIZE))
          params.set('pipelineId', selectedPipelineId)
          if (stage.id !== '__unassigned') params.set('pipelineStageId', stage.id)
          params.set('sortField', apiSort.sortField)
          params.set('sortDir', apiSort.sortDir)
          if (filterSignature.search.length) params.set('search', filterSignature.search)
          for (const status of statusFilters) params.append('status', status)
          for (const ownerId of ownerFilters) params.append('ownerUserId', ownerId)
          for (const personId of peopleFilters) params.append('personId', personId)
          for (const companyId of companyFilters) params.append('companyId', companyId)
          if (closeDateFilter.from) params.set('expectedCloseAtFrom', closeDateFilter.from)
          if (closeDateFilter.to) params.set('expectedCloseAtTo', closeDateFilter.to)
          const payload = await readApiResultOrThrow<{ items?: DealApiRecord[]; total?: number }>(
            `/api/customers/deals?${params.toString()}`,
            undefined,
            {
              errorMessage: translateWithFallback(
                t,
                'customers.deals.pipeline.loadError',
                'Failed to load deals.',
              ),
            },
          )
          const items = Array.isArray(payload?.items) ? (payload!.items as DealApiRecord[]) : []
          if (stage.id === '__unassigned') {
            // The API can't filter by "no stage" yet; do it client-side
            return {
              items: items.filter((it) => !it.pipeline_stage_id || (typeof it.pipeline_stage_id === 'string' && !it.pipeline_stage_id.trim().length)),
              total: typeof payload?.total === 'number' ? payload.total : items.length,
            }
          }
          return { items, total: typeof payload?.total === 'number' ? payload.total : items.length }
        },
      }
    }),
  })

  const laneState = React.useMemo(() => {
    const dealsByStage = new Map<string, DealCardData[]>()
    const stageIdByDealId = new Map<string, string>()
    const allDeals: DealCardData[] = []
    let total = 0
    laneQueries.forEach((query, idx) => {
      const stage = lanes[idx]
      if (!stage) return
      const firstPage = query.data?.items ?? []
      const extra = extraCardsByStage[stage.id] ?? []
      // Merge first page + appended pages, deduping by id (in case of races/optimistic moves)
      const seen = new Set<string>()
      const merged: DealApiRecord[] = []
      for (const item of [...firstPage, ...extra]) {
        if (!item.id || seen.has(item.id)) continue
        seen.add(item.id)
        merged.push(item)
      }
      const list: DealCardData[] = []
      for (const item of merged) {
        const mapped = mapDealRecord(item, fallbackTitle)
        if (!mapped) continue
        list.push(mapped)
        const stageId =
          typeof item.pipeline_stage_id === 'string' && item.pipeline_stage_id.trim().length
            ? item.pipeline_stage_id
            : '__unassigned'
        stageIdByDealId.set(mapped.id, stageId)
        allDeals.push(mapped)
      }
      dealsByStage.set(stage.id, list)
      total += list.length
    })
    return { dealsByStage, stageIdByDealId, allDeals, total }
  }, [laneQueries, lanes, fallbackTitle, extraCardsByStage])

  const rawDeals = laneState.allDeals
  const stageIdByDealId = laneState.stageIdByDealId
  const total = aggregateData?.perStage?.reduce((sum, row) => sum + row.count, 0) ?? laneState.total

  /**
   * Sum of `totalInBaseCurrency` across every visible lane — gives the operator one
   * authoritative "what's this pipeline worth?" number at the top of the kanban. Also
   * aggregates the per-currency breakdown so the same `LaneCurrencyBreakdown` popover
   * can show the board-wide split. We compute `convertedAll` as the AND of every lane's
   * flag: any single missing-rate currency drops the board to "partial" so the operator
   * can't read the headline as authoritative.
   */
  const boardSummary = React.useMemo(() => {
    const perStage = aggregateData?.perStage ?? []
    if (perStage.length === 0) {
      return null
    }
    const totalsByCurrency = new Map<string, { total: number; count: number }>()
    let totalInBaseCurrency = 0
    let convertedAll = true
    const missingRateCurrencies = new Set<string>()
    for (const row of perStage) {
      totalInBaseCurrency += row.totalInBaseCurrency
      if (!(row.convertedAll ?? true)) convertedAll = false
      for (const c of row.missingRateCurrencies ?? []) missingRateCurrencies.add(c)
      for (const cur of row.byCurrency) {
        const entry = totalsByCurrency.get(cur.currency) ?? { total: 0, count: 0 }
        entry.total += cur.total
        entry.count += cur.count
        totalsByCurrency.set(cur.currency, entry)
      }
    }
    const rows = Array.from(totalsByCurrency.entries())
      .map(([currency, value]) => ({ currency, total: value.total, count: value.count }))
      .sort((a, b) => b.total - a.total)
    return {
      baseCurrencyCode: aggregateData?.baseCurrencyCode ?? null,
      totalInBaseCurrency,
      convertedAll,
      missingRateCurrencies: Array.from(missingRateCurrencies),
      rows,
    }
  }, [aggregateData])

  const deals = React.useMemo(() => {
    if (ownerNamesById.size === 0) return rawDeals
    return rawDeals.map((deal) => {
      if (!deal.owner) return deal
      const resolvedLabel = ownerNamesById.get(deal.owner.userId)
      if (!resolvedLabel || resolvedLabel === deal.owner.label) return deal
      return { ...deal, owner: { ...deal.owner, label: resolvedLabel } }
    })
  }, [ownerNamesById, rawDeals])

  const dealsByStage = React.useMemo(() => {
    const map = new Map<string, DealCardData[]>()
    if (ownerNamesById.size === 0) {
      for (const [stageId, list] of laneState.dealsByStage) map.set(stageId, list)
      return map
    }
    for (const [stageId, list] of laneState.dealsByStage) {
      map.set(
        stageId,
        list.map((deal) => {
          if (!deal.owner) return deal
          const resolvedLabel = ownerNamesById.get(deal.owner.userId)
          if (!resolvedLabel || resolvedLabel === deal.owner.label) return deal
          return { ...deal, owner: { ...deal.owner, label: resolvedLabel } }
        }),
      )
    }
    return map
  }, [laneState.dealsByStage, ownerNamesById])

  // Pre-sort each lane's deals once per data/sort change. This keeps the array reference
  // stable across page re-renders (e.g. drag-start, filter changes that don't touch this
  // lane), so Lane.memo's `prev.deals !== next.deals` check stays cheap — without this
  // the inline `sortDeals(...)` in the JSX allocated a new array every render and busted
  // every Lane's memo, cascading reconciliation through every memoized DealCard.
  const sortedDealsByStage = React.useMemo(() => {
    const map = new Map<string, DealCardData[]>()
    for (const [stageId, list] of dealsByStage) {
      map.set(stageId, sortDeals(list, sortBy))
    }
    return map
  }, [dealsByStage, sortBy])

  const handleLoadMoreInLane = React.useCallback(
    async (stageId: string) => {
      if (!selectedPipelineId) return
      if (loadingMoreByStage[stageId]) return
      // Page 1 = first 25 (initial useQueries fetch). Subsequent pages come from extraCardsByStage.
      const already = extraCardsByStage[stageId]?.length ?? 0
      const nextPage = Math.floor((LANE_PAGE_SIZE + already) / LANE_PAGE_SIZE) + 1
      setLoadingMoreByStage((prev) => ({ ...prev, [stageId]: true }))
      try {
        const params = new URLSearchParams()
        params.set('page', String(nextPage))
        params.set('pageSize', String(LANE_PAGE_SIZE))
        params.set('pipelineId', selectedPipelineId)
        if (stageId !== '__unassigned') params.set('pipelineStageId', stageId)
        // Show-more MUST request the same sort as page 1; otherwise the appended cards land
        // in an arbitrary order relative to the cards already on screen.
        params.set('sortField', apiSort.sortField)
        params.set('sortDir', apiSort.sortDir)
        if (filterSignature.search.length) params.set('search', filterSignature.search)
        for (const status of statusFilters) params.append('status', status)
        for (const ownerId of ownerFilters) params.append('ownerUserId', ownerId)
        for (const personId of peopleFilters) params.append('personId', personId)
        for (const companyId of companyFilters) params.append('companyId', companyId)
        if (closeDateFilter.from) params.set('expectedCloseAtFrom', closeDateFilter.from)
        if (closeDateFilter.to) params.set('expectedCloseAtTo', closeDateFilter.to)
        const call = await apiCall<{ items?: DealApiRecord[] }>(
          `/api/customers/deals?${params.toString()}`,
        )
        if (!call.ok) return
        const items = Array.isArray(call.result?.items) ? (call.result!.items as DealApiRecord[]) : []
        const filtered = stageId === '__unassigned'
          ? items.filter((it) => !it.pipeline_stage_id || (typeof it.pipeline_stage_id === 'string' && !it.pipeline_stage_id.trim().length))
          : items
        setExtraCardsByStage((prev) => ({
          ...prev,
          [stageId]: [...(prev[stageId] ?? []), ...filtered],
        }))
      } finally {
        setLoadingMoreByStage((prev) => {
          const next = { ...prev }
          delete next[stageId]
          return next
        })
      }
    },
    [
      selectedPipelineId,
      loadingMoreByStage,
      extraCardsByStage,
      filterSignature.search,
      statusFilters,
      ownerFilters,
      peopleFilters,
      companyFilters,
      closeDateFilter.from,
      closeDateFilter.to,
      apiSort,
    ],
  )

  // Page chrome loading/error indicators derived from per-lane queries
  const isInitialLoading =
    !!selectedPipelineId && lanes.length === 0
      ? stagesQuery.isLoading
      : laneQueries.some((q) => q.isLoading && !q.data)
  const firstError: unknown = laneQueries.find((q) => q.isError)?.error ?? null

  // Centralized invalidation so writes refresh per-lane card queries, the aggregate, and drop stale extras
  const invalidateKanbanData = React.useCallback(() => {
    queryClient
      .invalidateQueries({ queryKey: ['customers', 'deals', 'kanban-lane'] })
      .catch(() => {})
    queryClient
      .invalidateQueries({ queryKey: ['customers', 'deals', 'kanban-aggregate'] })
      .catch(() => {})
    // Clear appended pages — they'll be re-fetched on demand by the user
    setExtraCardsByStage({})
  }, [queryClient])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const [activeDragDealId, setActiveDragDealId] = React.useState<string | null>(null)
  const activeDragDeal = React.useMemo(
    () => (activeDragDealId ? deals.find((d) => d.id === activeDragDealId) ?? null : null),
    [activeDragDealId, deals],
  )

  // Cards are draggable but NOT droppable; only lanes are droppable. That means collision
  // detection iterates only ~7 lane rects per pointer move. `pointerWithin` is the right
  // semantic — return the lane whose rect contains the pointer. We DROPPED the
  // `rectIntersection` fallback because it was running on every move alongside `pointerWithin`
  // (2× the rect math), and the only case it covered (cursor outside every lane rect) is
  // already handled by dnd-kit returning empty collisions → no drop target shown.
  const collisionDetection = React.useCallback<CollisionDetection>((args) => pointerWithin(args), [])

  // Measure droppables once at drag start (not on every pointer move). Kanban lanes don't
  // resize during a drag, so re-measuring on every move is pure overhead — this single line
  // is the biggest single-shot perf win for dnd-kit kanbans.
  // dnd-kit will still automatically re-measure if a layout-affecting change happens (e.g.
  // the scroller scrolls or a new lane appears).
  const measuringConfig = React.useMemo(
    () => ({ droppable: { strategy: MeasuringStrategy.BeforeDragging } }),
    [],
  )

  const moveMutationContextId = 'customers-deals-kanban:stage-move'
  const { runMutation: runMoveMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: moveMutationContextId,
    blockedMessage: translateWithFallback(
      t,
      'ui.forms.flash.saveBlocked',
      'Save blocked by validation',
    ),
  })

  const moveDealToStage = React.useCallback(
    (dealId: string, targetStageId: string) => {
      if (!targetStageId || targetStageId === '__unassigned') return
      const currentStageId = stageIdByDealId.get(dealId)
      if (currentStageId === targetStageId) return

      // Optimistic update: move the card between the per-lane query caches
      const laneCachePredicate = { queryKey: ['customers', 'deals', 'kanban-lane'] as const }
      const snapshot = queryClient.getQueriesData<{ items: DealApiRecord[]; total: number }>(laneCachePredicate)
      const extraSnapshot = extraCardsByStage
      let movingItem: DealApiRecord | null = null
      for (const [key, data] of snapshot) {
        if (!data) continue
        const idx = data.items.findIndex((it) => it.id === dealId)
        if (idx < 0) continue
        const stageKey = (key as readonly unknown[]).find((part) => typeof part === 'string' && (part as string).startsWith('stage:'))
        if (typeof stageKey !== 'string') continue
        const stageId = stageKey.slice('stage:'.length)
        // remove from source lane's page 1 cache
        if (stageId === currentStageId) {
          queryClient.setQueryData(key, {
            ...data,
            items: data.items.filter((it) => it.id !== dealId),
            total: Math.max(0, data.total - 1),
          })
          movingItem = { ...data.items[idx], pipeline_stage_id: targetStageId }
        }
      }
      // Also check extra pages for the card if it wasn't on page 1
      if (!movingItem && currentStageId) {
        const extras = extraCardsByStage[currentStageId] ?? []
        const found = extras.find((it) => it.id === dealId)
        if (found) movingItem = { ...found, pipeline_stage_id: targetStageId }
      }
      // Remove from source lane's extra-pages cache
      if (currentStageId && extraCardsByStage[currentStageId]?.some((it) => it.id === dealId)) {
        setExtraCardsByStage((prev) => {
          const list = prev[currentStageId] ?? []
          return { ...prev, [currentStageId]: list.filter((it) => it.id !== dealId) }
        })
      }
      if (movingItem) {
        // add to target lane caches (if they are loaded)
        for (const [key, data] of snapshot) {
          if (!data) continue
          const stageKey = (key as readonly unknown[]).find((part) => typeof part === 'string' && (part as string).startsWith('stage:'))
          if (typeof stageKey !== 'string') continue
          const stageId = stageKey.slice('stage:'.length)
          if (stageId !== targetStageId) continue
          queryClient.setQueryData(key, {
            ...data,
            items: [movingItem!, ...data.items],
            total: data.total + 1,
          })
        }
      }
      setPendingDealId(dealId)

      runMoveMutation({
        operation: async () => {
          await apiCallOrThrow(
            '/api/customers/deals',
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: dealId, pipelineStageId: targetStageId }),
            },
            {
              errorMessage: translateWithFallback(
                t,
                'customers.deals.pipeline.moveError',
                'Failed to update deal stage.',
              ),
            },
          )
        },
        context: {
          formId: moveMutationContextId,
          resourceKind: 'customers.deal',
          resourceId: dealId,
          retryLastMutation,
        },
      })
        .then(() => {
          flash(
            translateWithFallback(t, 'customers.deals.pipeline.moveSuccess', 'Deal updated.'),
            'success',
          )
        })
        .catch((error: unknown) => {
          // Roll back optimistic update by restoring the prior cache state
          for (const [key, data] of snapshot) {
            queryClient.setQueryData(key, data)
          }
          // Restore extra-pages cache to pre-move snapshot
          setExtraCardsByStage(extraSnapshot)
          const message =
            error instanceof Error && error.message
              ? error.message
              : translateWithFallback(
                  t,
                  'customers.deals.pipeline.moveError',
                  'Failed to update deal stage.',
                )
          flash(message, 'error')
        })
        .finally(() => {
          setPendingDealId(null)
          invalidateKanbanData()
        })
    },
    [invalidateKanbanData, queryClient, retryLastMutation, runMoveMutation, stageIdByDealId, t],
  )

  // Horizontal scroll arrows — let the user step lane-by-lane instead of using only the bottom slider.
  const boardScrollerRef = React.useRef<HTMLDivElement | null>(null)
  const LANE_STEP = 322 // 308px lane width + 14px gap (scaled 1.2x for readability)
  const [scrollEdges, setScrollEdges] = React.useState<{ atStart: boolean; atEnd: boolean }>({
    atStart: true,
    atEnd: false,
  })

  // Edge-detection tolerance in CSS px. Chrome may report fractional scrollLeft / scrollWidth
  // values when the page DPI is non-integer or the layout has sub-pixel sizing; a too-tight
  // threshold here disables the arrow before the user actually reaches the end.
  const EDGE_TOLERANCE = 4

  const updateScrollEdges = React.useCallback(() => {
    const el = boardScrollerRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    const nextAtStart = el.scrollLeft <= EDGE_TOLERANCE
    const nextAtEnd = maxScroll <= EDGE_TOLERANCE || el.scrollLeft >= maxScroll - EDGE_TOLERANCE
    // Functional update with equality check: avoids a full page re-render every frame of the
    // scroll animation when atStart/atEnd haven't actually flipped. Without this, the entire
    // 125+ card tree reconciled on every tick → effective frame rate collapsed.
    setScrollEdges((prev) =>
      prev.atStart === nextAtStart && prev.atEnd === nextAtEnd ? prev : { atStart: nextAtStart, atEnd: nextAtEnd },
    )
  }, [])

  // Combined ref + listener attachment. Using a callback ref guarantees we wire scroll/resize
  // listeners the moment the scroller div mounts (even when it's conditionally rendered behind
  // a loading guard), and cleanly tears them down when it unmounts.
  const cleanupScrollerRef = React.useRef<(() => void) | null>(null)
  const setBoardScroller = React.useCallback(
    (el: HTMLDivElement | null) => {
      cleanupScrollerRef.current?.()
      cleanupScrollerRef.current = null
      boardScrollerRef.current = el
      if (!el) return
      updateScrollEdges()
      el.addEventListener('scroll', updateScrollEdges, { passive: true })
      const ro = new ResizeObserver(updateScrollEdges)
      ro.observe(el)
      cleanupScrollerRef.current = () => {
        el.removeEventListener('scroll', updateScrollEdges)
        ro.disconnect()
      }
    },
    [updateScrollEdges],
  )

  // Also recompute when the lane set changes (cards loaded → scrollWidth grows)
  React.useEffect(() => {
    updateScrollEdges()
  }, [updateScrollEdges, lanes.length])

  // Smooth-scroll helper: animate scrollLeft over ~200ms with cubic easing.
  // Uses requestAnimationFrame so the animation is synced to the display refresh rate
  // (handles 60Hz, 120Hz, 144Hz, ProMotion etc.). performance.now() gives sub-ms timing.
  // We do NOT call updateScrollEdges() inside the step — programmatic scrollLeft writes
  // DO fire a `scroll` event (which the listener we attached in setBoardScroller handles).
  // Skipping the redundant per-frame call avoids cascading the whole page tree to re-render.
  const activeAnimRef = React.useRef<{ cancel: () => void } | null>(null)
  const animateScrollTo = React.useCallback(
    (el: HTMLDivElement, target: number) => {
      activeAnimRef.current?.cancel()
      const startLeft = el.scrollLeft
      const clampedTarget = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, target))
      const distance = clampedTarget - startLeft
      if (Math.abs(distance) < 1) {
        updateScrollEdges()
        return
      }
      const duration = 200
      const hasRaf = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      const now = () =>
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()
      const startTime = now()
      let handle = 0
      let cancelled = false
      const step = () => {
        if (cancelled) return
        const t = Math.min(1, (now() - startTime) / duration)
        const eased = 1 - Math.pow(1 - t, 3)
        el.scrollLeft = startLeft + distance * eased
        if (t < 1) {
          handle = hasRaf
            ? window.requestAnimationFrame(step)
            : (window.setTimeout(step, 16) as unknown as number)
        } else {
          // Final edge-sync once the animation lands — the scroll listener also fires,
          // but on some browsers the last `scroll` event is debounced behind the final write.
          updateScrollEdges()
        }
      }
      handle = hasRaf
        ? window.requestAnimationFrame(step)
        : (window.setTimeout(step, 16) as unknown as number)
      activeAnimRef.current = {
        cancel: () => {
          cancelled = true
          if (hasRaf) window.cancelAnimationFrame(handle)
          else window.clearTimeout(handle)
        },
      }
    },
    [updateScrollEdges],
  )

  // Pre-compute lane left-edge offsets (in scrollLeft coords) so resize-aware "step one lane"
  // works even when lanes have different widths.
  const laneOffsets = React.useMemo(() => {
    const offsets: number[] = []
    let left = 0
    for (const stage of lanes) {
      offsets.push(left)
      const w = laneWidths[stage.id] ?? DEFAULT_LANE_WIDTH
      left += w + LANE_GAP
    }
    return offsets
  }, [lanes, laneWidths])

  // Per-direction step: pick the next lane boundary based on the live scrollLeft.
  // Variable-width-aware: uses laneOffsets instead of a fixed LANE_STEP so resized columns still
  // snap cleanly. Chrome's scrollLeft can be fractional; we add EDGE_TOLERANCE to dodge that.
  const stepScroll = React.useCallback(
    (direction: -1 | 1) => {
      const el = boardScrollerRef.current
      if (!el) return false
      const sl = el.scrollLeft
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
      // Opt-in console diagnostics: enable by running `localStorage.setItem('kanban-debug-scroll', '1')`
      if (typeof window !== 'undefined' && window.localStorage?.getItem('kanban-debug-scroll') === '1') {
        // eslint-disable-next-line no-console
        console.log('[kanban-scroll]', {
          direction,
          scrollLeft: sl,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          maxScroll,
          laneOffsets,
        })
      }
      if (maxScroll <= EDGE_TOLERANCE) return false
      if (direction < 0 && sl <= EDGE_TOLERANCE) return false
      if (direction > 0 && sl >= maxScroll - EDGE_TOLERANCE) return false

      let target: number
      if (direction > 0) {
        // First lane offset that is meaningfully ahead of the current scroll position
        const next = laneOffsets.find((off) => off > sl + EDGE_TOLERANCE)
        target = next ?? maxScroll
      } else {
        // Last lane offset that is meaningfully behind the current scroll position
        let prev = 0
        for (const off of laneOffsets) {
          if (off >= sl - EDGE_TOLERANCE) break
          prev = off
        }
        target = prev
      }
      if (target > maxScroll - EDGE_TOLERANCE) target = maxScroll
      if (target < EDGE_TOLERANCE) target = 0

      // No-op safety: if target is essentially the current position, do nothing
      if (Math.abs(target - sl) < 1) return false

      animateScrollTo(el, target)
      // Belt-and-suspenders: if the animation library couldn't progress in this browser, force
      // the target after the animation duration so we never "stick" mid-scroll.
      window.setTimeout(() => {
        if (!boardScrollerRef.current) return
        const cur = boardScrollerRef.current.scrollLeft
        if (Math.abs(cur - target) > EDGE_TOLERANCE) {
          boardScrollerRef.current.scrollLeft = target
        }
        updateScrollEdges()
      }, 240)
      return true
    },
    [animateScrollTo, updateScrollEdges, laneOffsets],
  )

  // Press-and-hold continuous scroll. First step fires immediately on press; if the user keeps
  // the button held, additional steps fire every ~280ms (matched to animation duration) until they
  // release or the scroller reaches the edge.
  const holdTimerRef = React.useRef<number | null>(null)
  const stopContinuousScroll = React.useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearInterval(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])
  const startContinuousScroll = React.useCallback(
    (direction: -1 | 1) => {
      stopContinuousScroll()
      const moved = stepScroll(direction)
      if (!moved) return
      const HOLD_DELAY = 320
      const REPEAT_INTERVAL = 240
      holdTimerRef.current = window.setTimeout(function repeat() {
        const more = stepScroll(direction)
        if (!more) {
          stopContinuousScroll()
          return
        }
        holdTimerRef.current = window.setTimeout(repeat, REPEAT_INTERVAL) as unknown as number
      }, HOLD_DELAY) as unknown as number
    },
    [stepScroll, stopContinuousScroll],
  )

  React.useEffect(() => {
    // Safety: stop any running hold timer on unmount
    return () => stopContinuousScroll()
  }, [stopContinuousScroll])

  // Dedup pointerdown + click: real browsers fire both when the user clicks a button.
  // We start the hold sequence on pointerdown (so press-and-hold feels immediate). The click
  // event that follows would otherwise scroll an EXTRA lane — we suppress it here.
  // Keyboard activation (Enter/Space) only fires click, no pointerdown, so it still works.
  const lastPointerDownAtRef = React.useRef(0)
  const handleScrollPrev = React.useCallback(() => {
    if (Date.now() - lastPointerDownAtRef.current < 500) return
    stepScroll(-1)
  }, [stepScroll])
  const handleScrollNext = React.useCallback(() => {
    if (Date.now() - lastPointerDownAtRef.current < 500) return
    stepScroll(1)
  }, [stepScroll])
  const handleHoldPrevStart = React.useCallback(() => {
    lastPointerDownAtRef.current = Date.now()
    startContinuousScroll(-1)
  }, [startContinuousScroll])
  const handleHoldNextStart = React.useCallback(() => {
    lastPointerDownAtRef.current = Date.now()
    startContinuousScroll(1)
  }, [startContinuousScroll])

  // Keyboard navigation: ArrowLeft / ArrowRight scroll one lane at a time, mirroring the
  // on-screen arrow buttons. We intentionally:
  //   - skip when the user is typing inside an input / textarea / select / contenteditable
  //   - skip when modifier keys are held (Cmd/Ctrl/Alt/Shift) so we don't fight browser shortcuts
  //   - skip when any dialog or popover (Radix `[role="dialog"]` / `[data-state="open"]` portals)
  //     is open, so popover keyboard nav (Apply, Tab, Escape, etc.) keeps working
  //   - skip when no kanban scroller is mounted yet (initial loading state)
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
      }
      // Don't steal arrow keys while a dialog/popover is open — they own keyboard nav.
      if (typeof document !== 'undefined') {
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
        if (document.querySelector('[data-radix-popper-content-wrapper] [data-state="open"]')) return
      }
      if (!boardScrollerRef.current) return
      event.preventDefault()
      stepScroll(event.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepScroll])

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const id = typeof event.active.id === 'string' ? event.active.id : null
    setActiveDragDealId(id)
  }, [])

  const handleDragCancel = React.useCallback(() => {
    setActiveDragDealId(null)
  }, [])

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setActiveDragDealId(null)
      const dealId = typeof event.active.id === 'string' ? event.active.id : null
      if (!dealId) return
      const overId = event.over?.id
      if (typeof overId !== 'string') return

      let targetStageId: string | null = null
      if (overId.startsWith('lane:')) {
        targetStageId = overId.slice('lane:'.length)
      } else {
        targetStageId = stageIdByDealId.get(overId) ?? null
      }
      if (!targetStageId) return
      moveDealToStage(dealId, targetStageId)
    },
    [moveDealToStage, stageIdByDealId],
  )

  const handleToggleSelect = React.useCallback((dealId: string) => {
    setSelectedDealIds((prev) => {
      const next = new Set(prev)
      if (next.has(dealId)) next.delete(dealId)
      else next.add(dealId)
      return next
    })
  }, [])

  const handleOpenDetail = React.useCallback(
    (dealId: string) => {
      router.push(`/backend/customers/deals/${dealId}`)
    },
    [router],
  )

  const handleComingSoon = React.useCallback(
    (label: string) => {
      flash(
        translateWithFallback(
          t,
          'customers.deals.kanban.comingSoon',
          '{feature} arrives in the next iteration.',
          { feature: label },
        ),
        'info',
      )
    },
    [t],
  )

  const handleChipClick = React.useCallback(
    (chipId: KanbanFilterChip['id']) => {
      handleComingSoon(
        translateWithFallback(
          t,
          'customers.deals.kanban.filter.aria.chip',
          'Filter by {label}',
          { label: chipId },
        ),
      )
    },
    [handleComingSoon, t],
  )

  const handleAddFilter = React.useCallback(() => {
    handleComingSoon(translateWithFallback(t, 'customers.deals.kanban.filter.more', 'More filters'))
  }, [handleComingSoon, t])

  const handleCustomizeView = React.useCallback(() => {
    setCustomizeOpen(true)
  }, [])

  const handleResetView = React.useCallback(() => {
    setStatusFilters([])
    setSortBy(DEFAULT_SORT)
  }, [])

  const handleConfigureCardFields = React.useCallback(() => {
    handleComingSoon(
      translateWithFallback(
        t,
        'customers.deals.kanban.customize.configCols',
        'Configure card fields',
      ),
    )
  }, [handleComingSoon, t])

  const activePipelineName = React.useMemo(() => {
    if (!selectedPipelineId) return ''
    return pipelinesQuery.data?.find((p) => p.id === selectedPipelineId)?.name ?? ''
  }, [pipelinesQuery.data, selectedPipelineId])

  const stageLabelById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const lane of lanes) map.set(lane.id, lane.label)
    return map
  }, [lanes])

  const handleQuickAdd = React.useCallback(
    (stageId: string) => {
      if (!selectedPipelineId) return
      const stageLabel = stageLabelById.get(stageId)
      if (!stageLabel || stageId === '__unassigned') return
      setQuickDealContext({
        pipelineId: selectedPipelineId,
        pipelineName: activePipelineName,
        pipelineStageId: stageId,
        pipelineStageLabel: stageLabel,
      })
    },
    [activePipelineName, selectedPipelineId, stageLabelById],
  )

  const handleAddStage = React.useCallback(() => {
    if (!selectedPipelineId) return
    // Snapshot the current pipeline's stages (sorted by `order`) so the position picker
    // can offer "After {label}" entries. We sort here rather than relying on stagesData's
    // ordering because that array's order is technically determined by the API response —
    // a defensive in-place sort is cheap and survives any future API change.
    const orderedStages = stagesData
      .filter((stage) => stage.pipelineId === selectedPipelineId)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((stage) => ({ id: stage.id, label: stage.label, order: stage.order }))
    setAddStageContext({
      pipelineId: selectedPipelineId,
      pipelineName: activePipelineName,
      existingStages: orderedStages,
    })
  }, [activePipelineName, selectedPipelineId, stagesData])

  const handleDialogCreated = React.useCallback(() => {
    invalidateKanbanData()
    queryClient
      .invalidateQueries({
        queryKey: ['customers', 'pipeline-stages', `scope:${scopeVersion}`, `pipeline:${selectedPipelineId}`],
      })
      .catch(() => {})
  }, [invalidateKanbanData, scopeVersion, selectedPipelineId])

  const dealMutationContextId = 'customers-deals-kanban:deal-mutation'
  const { runMutation: runDealMutation, retryLastMutation: retryDealMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: dealMutationContextId,
    blockedMessage: translateWithFallback(
      t,
      'ui.forms.flash.saveBlocked',
      'Save blocked by validation',
    ),
  })

  const updateDealStatus = React.useCallback(
    async (dealId: string, status: 'win' | 'loose') => {
      setPendingDealId(dealId)
      try {
        await runDealMutation({
          operation: async () => {
            await apiCallOrThrow(
              '/api/customers/deals',
              {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: dealId, status }),
              },
              {
                errorMessage: translateWithFallback(
                  t,
                  'customers.deals.kanban.menu.error.status',
                  'Failed to update deal status.',
                ),
              },
            )
          },
          context: {
            formId: dealMutationContextId,
            resourceKind: 'customers.deal',
            resourceId: dealId,
            retryLastMutation: retryDealMutation,
          },
        })
        flash(
          status === 'win'
            ? translateWithFallback(
                t,
                'customers.deals.kanban.menu.markWon.success',
                'Deal marked as won.',
              )
            : translateWithFallback(
                t,
                'customers.deals.kanban.menu.markLost.success',
                'Deal marked as lost.',
              ),
          'success',
        )
        invalidateKanbanData()
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : translateWithFallback(
                t,
                'customers.deals.kanban.menu.error.status',
                'Failed to update deal status.',
              )
        flash(message, 'error')
      } finally {
        setPendingDealId(null)
      }
    },
    [invalidateKanbanData, retryDealMutation, runDealMutation, t],
  )

  const deleteDeal = React.useCallback(
    async (dealId: string, dealTitle: string) => {
      const confirmed = await confirm({
        title: translateWithFallback(
          t,
          'customers.deals.kanban.menu.delete.confirmTitle',
          'Delete deal “{title}”?',
          { title: dealTitle },
        ),
        text: translateWithFallback(
          t,
          'customers.deals.kanban.menu.delete.confirmText',
          'This action cannot be undone.',
        ),
        variant: 'destructive',
        confirmText: translateWithFallback(t, 'customers.deals.kanban.menu.delete', 'Delete'),
      })
      if (!confirmed) return

      setPendingDealId(dealId)
      try {
        await runDealMutation({
          operation: async () => {
            await deleteCrud('customers/deals', {
              body: { id: dealId },
              errorMessage: translateWithFallback(
                t,
                'customers.deals.kanban.menu.delete.error',
                'Failed to delete deal.',
              ),
            })
          },
          context: {
            formId: dealMutationContextId,
            resourceKind: 'customers.deal',
            resourceId: dealId,
            retryLastMutation: retryDealMutation,
          },
        })
        flash(
          translateWithFallback(t, 'customers.deals.kanban.menu.delete.success', 'Deal deleted.'),
          'success',
        )
        invalidateKanbanData()
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : translateWithFallback(
                t,
                'customers.deals.kanban.menu.delete.error',
                'Failed to delete deal.',
              )
        flash(message, 'error')
      } finally {
        setPendingDealId(null)
      }
    },
    [confirm, invalidateKanbanData, retryDealMutation, runDealMutation, t],
  )

  const bulkSelectionSummary = React.useMemo(() => {
    if (selectedDealIds.size === 0) return { count: 0, totalLabel: null, currency: null as string | null, ids: [] as string[] }
    let total = 0
    let currency: string | null = null
    const ids: string[] = []
    for (const deal of deals) {
      if (!selectedDealIds.has(deal.id)) continue
      ids.push(deal.id)
      if (typeof deal.valueAmount === 'number' && Number.isFinite(deal.valueAmount)) {
        total += deal.valueAmount
        if (!currency && deal.valueCurrency) currency = deal.valueCurrency
      }
    }
    let totalLabel: string | null = null
    if (total > 0) {
      const code = currency && currency.length === 3 ? currency.toUpperCase() : 'USD'
      try {
        totalLabel = new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: code,
          maximumFractionDigits: 0,
        }).format(total)
      } catch {
        totalLabel = `${code} ${Math.round(total)}`
      }
    }
    return { count: ids.length, totalLabel, currency, ids }
  }, [deals, selectedDealIds])

  const handleBulkClear = React.useCallback(() => {
    setSelectedDealIds(new Set())
  }, [])

  const stageOptions = React.useMemo(
    () =>
      (stagesQuery.data ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((stage) => ({ id: stage.id, label: stage.label })),
    [stagesQuery.data],
  )

  const handleBulkChangeStage = React.useCallback(
    async (stageId: string) => {
      if (bulkSelectionSummary.ids.length === 0) return
      setIsBulkMutating(true)
      try {
        // Bulk writes MUST go through useGuardedMutation so injection modules (record-lock
        // conflict handling, retry chains, scoped headers) run the same `onBeforeSave`/
        // `onAfterSave` lifecycle as single-deal writes — see UI AGENTS.md and customers
        // module MUST rules. `runMutation` throws on guard rejection; the catch block below
        // surfaces the error message via flash().
        await runDealMutation({
          operation: async () => {
            await apiCallOrThrow(
              '/api/customers/deals/bulk-update-stage',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  ids: bulkSelectionSummary.ids,
                  pipelineStageId: stageId,
                }),
              },
              {
                errorMessage: translateWithFallback(
                  t,
                  'customers.deals.kanban.bulk.changeStage.error',
                  'Failed to start bulk stage update.',
                ),
              },
            )
          },
          context: {
            formId: dealMutationContextId,
            resourceKind: 'customers.deals.bulk_stage',
            resourceId: bulkSelectionSummary.ids.join(','),
            retryLastMutation: retryDealMutation,
          },
        })
        flash(
          translateWithFallback(
            t,
            'customers.deals.kanban.bulk.changeStage.queued',
            'Bulk stage update started ({count} deals).',
            { count: bulkSelectionSummary.count },
          ),
          'success',
        )
        setChangeStageOpen(false)
        setSelectedDealIds(new Set())
        invalidateKanbanData()
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : translateWithFallback(
                t,
                'customers.deals.kanban.bulk.changeStage.error',
                'Failed to start bulk stage update.',
              )
        flash(message, 'error')
      } finally {
        setIsBulkMutating(false)
      }
    },
    [
      bulkSelectionSummary.count,
      bulkSelectionSummary.ids,
      dealMutationContextId,
      invalidateKanbanData,
      retryDealMutation,
      runDealMutation,
      t,
    ],
  )

  const handleBulkChangeOwner = React.useCallback(
    async (ownerUserId: string | null) => {
      if (bulkSelectionSummary.ids.length === 0) return
      setIsBulkMutating(true)
      try {
        await runDealMutation({
          operation: async () => {
            await apiCallOrThrow(
              '/api/customers/deals/bulk-update-owner',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  ids: bulkSelectionSummary.ids,
                  ownerUserId,
                }),
              },
              {
                errorMessage: translateWithFallback(
                  t,
                  'customers.deals.kanban.bulk.changeOwner.error',
                  'Failed to start bulk owner update.',
                ),
              },
            )
          },
          context: {
            formId: dealMutationContextId,
            resourceKind: 'customers.deals.bulk_owner',
            resourceId: bulkSelectionSummary.ids.join(','),
            retryLastMutation: retryDealMutation,
          },
        })
        flash(
          translateWithFallback(
            t,
            'customers.deals.kanban.bulk.changeOwner.queued',
            'Bulk owner update started ({count} deals).',
            { count: bulkSelectionSummary.count },
          ),
          'success',
        )
        setChangeOwnerOpen(false)
        setSelectedDealIds(new Set())
        invalidateKanbanData()
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : translateWithFallback(
                t,
                'customers.deals.kanban.bulk.changeOwner.error',
                'Failed to start bulk owner update.',
              )
        flash(message, 'error')
      } finally {
        setIsBulkMutating(false)
      }
    },
    [
      bulkSelectionSummary.count,
      bulkSelectionSummary.ids,
      dealMutationContextId,
      invalidateKanbanData,
      retryDealMutation,
      runDealMutation,
      t,
    ],
  )

  const handleBulkExport = React.useCallback(() => {
    if (bulkSelectionSummary.ids.length === 0) return
    const url = buildCrudExportUrl(
      'customers/deals',
      {
        ids: bulkSelectionSummary.ids.join(','),
        exportScope: 'view',
      },
      'csv',
    )
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener')
    }
  }, [bulkSelectionSummary.ids])

  const handleBulkDelete = React.useCallback(async () => {
    if (bulkSelectionSummary.ids.length === 0) return
    const confirmed = await confirm({
      title: translateWithFallback(
        t,
        'customers.deals.kanban.bulk.delete.title',
        'Delete {count} deals?',
        { count: bulkSelectionSummary.count },
      ),
      text: translateWithFallback(
        t,
        'customers.deals.kanban.bulk.delete.text',
        'This action cannot be undone.',
      ),
      variant: 'destructive',
      confirmText: translateWithFallback(t, 'customers.deals.kanban.bulk.delete', 'Delete'),
    })
    if (!confirmed) return

    const rows = deals.filter((deal) => selectedDealIds.has(deal.id)).map((deal) => ({ id: deal.id }))

    setIsBulkMutating(true)
    try {
      const { succeeded, failures } = await runBulkDelete(
        rows,
        async (row) => {
          await deleteCrud('customers/deals', {
            body: { id: row.id },
            errorMessage: translateWithFallback(
              t,
              'customers.deals.kanban.menu.delete.error',
              'Failed to delete deal.',
            ),
          })
        },
        {
          fallbackErrorMessage: translateWithFallback(
            t,
            'customers.deals.kanban.menu.delete.error',
            'Failed to delete deal.',
          ),
          logTag: 'customers.deals.kanban',
          progress: {
            jobType: 'customers.deals.bulk_delete',
            name: translateWithFallback(
              t,
              'customers.deals.kanban.bulk.delete.progress.name',
              'Delete selected deals',
            ),
            description: translateWithFallback(
              t,
              'customers.deals.kanban.bulk.delete.progress.description',
              '{count} deals queued for deletion',
              { count: rows.length },
            ),
            meta: { source: 'customers.deals.kanban' },
          },
        },
      )

      if (succeeded.length > 0) {
        flash(
          translateWithFallback(
            t,
            'customers.deals.kanban.bulk.delete.success',
            '{count} deals deleted.',
            { count: succeeded.length },
          ),
          failures.length === 0 ? 'success' : 'warning',
        )
      }
      for (const group of groupBulkDeleteFailures(failures)) {
        const message =
          group.count === 1
            ? group.sampleMessage
            : translateWithFallback(
                t,
                'customers.deals.kanban.bulk.delete.failedGroup',
                '{count} deals could not be deleted: {message}',
                { count: group.count, message: group.sampleMessage },
              )
        flash(message, 'error')
      }
      setSelectedDealIds(new Set())
      invalidateKanbanData()
    } finally {
      setIsBulkMutating(false)
    }
  }, [
    bulkSelectionSummary.count,
    bulkSelectionSummary.ids,
    confirm,
    deals,
    queryClient,
    selectedDealIds,
    t,
  ])

  const duplicateDeal = React.useCallback(
    async (deal: DealCardData) => {
      setPendingDealId(deal.id)
      try {
        const stageId = stageIdByDealId.get(deal.id) ?? null
        const payload: Record<string, unknown> = {
          title: translateWithFallback(
            t,
            'customers.deals.kanban.menu.duplicate.titleSuffix',
            '{title} (copy)',
            { title: deal.title },
          ),
          status: 'open',
        }
        if (selectedPipelineId) payload.pipelineId = selectedPipelineId
        if (stageId && stageId !== '__unassigned') payload.pipelineStageId = stageId
        if (typeof deal.valueAmount === 'number') payload.valueAmount = deal.valueAmount
        if (deal.valueCurrency) payload.valueCurrency = deal.valueCurrency
        if (typeof deal.probability === 'number') payload.probability = deal.probability
        if (deal.expectedCloseAt) payload.expectedCloseAt = deal.expectedCloseAt
        if (deal.owner?.userId) payload.ownerUserId = deal.owner.userId

        await runDealMutation({
          operation: async () => {
            await apiCallOrThrow(
              '/api/customers/deals',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              },
              {
                errorMessage: translateWithFallback(
                  t,
                  'customers.deals.kanban.menu.duplicate.error',
                  'Failed to duplicate deal.',
                ),
              },
            )
          },
          context: {
            formId: dealMutationContextId,
            resourceKind: 'customers.deal',
            resourceId: deal.id,
            retryLastMutation: retryDealMutation,
          },
        })
        flash(
          translateWithFallback(
            t,
            'customers.deals.kanban.menu.duplicate.success',
            'Deal duplicated.',
          ),
          'success',
        )
        invalidateKanbanData()
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : translateWithFallback(
                t,
                'customers.deals.kanban.menu.duplicate.error',
                'Failed to duplicate deal.',
              )
        flash(message, 'error')
      } finally {
        setPendingDealId(null)
      }
    },
    [
      queryClient,
      retryDealMutation,
      runDealMutation,
      selectedPipelineId,
      stageIdByDealId,
      t,
    ],
  )

  const buildMenuItems = React.useCallback(
    (deal: DealCardData): RowActionItem[] => [
      {
        id: 'open',
        label: translateWithFallback(t, 'customers.deals.kanban.menu.open', 'Open deal'),
        onSelect: () => handleOpenDetail(deal.id),
      },
      {
        id: 'edit',
        label: translateWithFallback(t, 'customers.deals.kanban.menu.edit', 'Edit'),
        onSelect: () => handleOpenDetail(deal.id),
      },
      {
        id: 'duplicate',
        label: translateWithFallback(t, 'customers.deals.kanban.menu.duplicate', 'Duplicate'),
        onSelect: () => void duplicateDeal(deal),
      },
      {
        id: 'move-stage',
        label: translateWithFallback(t, 'customers.deals.kanban.menu.moveStage', 'Move stage…'),
        onSelect: () =>
          setSingleMoveStageContext({
            dealId: deal.id,
            currentStageId: stageIdByDealId.get(deal.id) ?? null,
          }),
      },
      {
        id: 'mark-won',
        label: translateWithFallback(t, 'customers.deals.kanban.menu.markWon', 'Mark as Won'),
        onSelect: () => void updateDealStatus(deal.id, 'win'),
      },
      {
        id: 'mark-lost',
        label: translateWithFallback(t, 'customers.deals.kanban.menu.markLost', 'Mark as Lost'),
        onSelect: () => void updateDealStatus(deal.id, 'loose'),
      },
      {
        id: 'delete',
        label: translateWithFallback(t, 'customers.deals.kanban.menu.delete', 'Delete'),
        destructive: true,
        onSelect: () => void deleteDeal(deal.id, deal.title),
      },
    ],
    [
      deleteDeal,
      duplicateDeal,
      handleOpenDetail,
      stageIdByDealId,
      t,
      updateDealStatus,
    ],
  )

  const handleComposeActivity = React.useCallback(
    (dealId: string, type: 'call' | 'email' | 'note') => {
      const deal = deals.find((entry) => entry.id === dealId)
      if (!deal) return
      const entityId = deal.primaryCompany?.id
      if (!entityId) {
        flash(
          translateWithFallback(
            t,
            'customers.deals.kanban.activityComposer.noEntity',
            'Link a company to this deal before logging activities here.',
          ),
          'info',
        )
        return
      }
      setActivityContext({
        dealId,
        dealTitle: deal.title,
        type,
        entityId,
      })
    },
    [deals, t],
  )

  // The placeholder "stub" chips have been replaced by real popovers; pass an empty list.
  const filterChips = React.useMemo<KanbanFilterChip[]>(() => [], [])

  const pipelineFilterOptions = React.useMemo(
    () =>
      (pipelinesQuery.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
      })),
    [pipelinesQuery.data],
  )

  // Async loaders for entity-filter popovers (Owner / People / Companies)
  const loadOwnerOptions = React.useCallback(
    async (query: string, _signal: AbortSignal): Promise<EntityFilterOption[]> => {
      const items = await fetchAssignableStaffMembers(query ?? '', { pageSize: 100 })
      const opts: EntityFilterOption[] = items
        .filter((u) => !!u.userId && !!u.displayName)
        .map((u) => ({ value: u.userId!, label: u.displayName! }))
      // Cache labels so chip can display readable text for already-selected ids
      setOwnerLabels((prev) => {
        const next: Record<string, string> = { ...prev }
        for (const o of opts) next[o.value] = o.label
        return next
      })
      return opts
    },
    [],
  )
  const loadPeopleOptions = React.useCallback(
    async (query: string, signal: AbortSignal): Promise<EntityFilterOption[]> => {
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('pageSize', '50')
      if (query) params.set('search', query)
      params.set('sortField', 'displayName')
      params.set('sortDir', 'asc')
      // Route the request through `apiCall` so scoped tenant/org headers are attached and the
      // JSON parser uses the shared safe-read helper. AbortSignal is forwarded through init.
      const call = await apiCall<{
        items?: Array<{ id?: string; display_name?: string; first_name?: string; last_name?: string }>
      }>(`/api/customers/people?${params.toString()}`, { signal })
      if (!call.ok) return []
      const items = call.result?.items ?? []
      const opts: EntityFilterOption[] = []
      for (const it of items) {
        if (!it.id) continue
        const label = (it.display_name && it.display_name.trim().length)
          ? it.display_name.trim()
          : [it.first_name, it.last_name].filter(Boolean).join(' ').trim() || it.id.slice(0, 8)
        opts.push({ value: it.id, label })
      }
      setPeopleLabels((prev) => {
        const next: Record<string, string> = { ...prev }
        for (const o of opts) next[o.value] = o.label
        return next
      })
      return opts
    },
    [],
  )
  const loadCompanyOptions = React.useCallback(
    async (query: string, signal: AbortSignal): Promise<EntityFilterOption[]> => {
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('pageSize', '50')
      if (query) params.set('search', query)
      params.set('sortField', 'display_name')
      params.set('sortDir', 'asc')
      const call = await apiCall<{ items?: Array<{ id?: string; display_name?: string }> }>(
        `/api/customers/companies?${params.toString()}`,
        { signal },
      )
      if (!call.ok) return []
      const items = call.result?.items ?? []
      const opts: EntityFilterOption[] = []
      for (const it of items) {
        if (!it.id || !it.display_name) continue
        opts.push({ value: it.id, label: it.display_name })
      }
      setCompanyLabels((prev) => {
        const next: Record<string, string> = { ...prev }
        for (const o of opts) next[o.value] = o.label
        return next
      })
      return opts
    },
    [],
  )

  const leadingChipsNode = (
    <>
      <StatusFilterPopover values={statusFilters} onApply={setStatusFilters} />
      <PipelineFilterPopover
        pipelines={pipelineFilterOptions}
        selectedPipelineId={selectedPipelineId}
        onApply={setSelectedPipelineId}
      />
      <EntityFilterPopover
        label={translateWithFallback(t, 'customers.deals.kanban.filter.owner', 'Owner')}
        anyLabel={translateWithFallback(t, 'customers.deals.kanban.filter.all', 'All')}
        values={ownerFilters}
        onApply={setOwnerFilters}
        loadOptions={loadOwnerOptions}
        labelById={ownerLabels}
      />
      <EntityFilterPopover
        label={translateWithFallback(t, 'customers.deals.kanban.filter.people', 'People')}
        values={peopleFilters}
        onApply={setPeopleFilters}
        loadOptions={loadPeopleOptions}
        labelById={peopleLabels}
      />
      <EntityFilterPopover
        label={translateWithFallback(t, 'customers.deals.kanban.filter.companies', 'Companies')}
        values={companyFilters}
        onApply={setCompanyFilters}
        loadOptions={loadCompanyOptions}
        labelById={companyLabels}
      />
      <CloseDateFilterPopover value={closeDateFilter} onApply={setCloseDateFilter} />
    </>
  )

  const sortNode = <SortByPopover value={sortBy} onApply={setSortBy} />

  const activePipeline = React.useMemo(() => {
    if (!selectedPipelineId) return null
    return pipelinesQuery.data?.find((p) => p.id === selectedPipelineId) ?? null
  }, [pipelinesQuery.data, selectedPipelineId])

  const dragHint = translateWithFallback(
    t,
    'customers.deals.kanban.helper.dragHint',
    'Drag cards between lanes to update stage',
  )
  const footerCount = translateWithFallback(
    t,
    'customers.deals.kanban.footer.count',
    'Showing {visible} of {total} deals in {pipeline} pipeline',
    {
      visible: deals.length,
      total,
      pipeline: activePipeline?.name ?? '—',
    },
  )

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-2">
          <nav className="flex items-center gap-1.5 text-xs leading-normal" aria-label="Breadcrumb">
            <Link href="/backend" className="font-normal text-muted-foreground hover:text-foreground">
              {translateWithFallback(t, 'customers.deals.kanban.breadcrumb.dashboard', 'Dashboard')}
            </Link>
            <span aria-hidden="true" className="font-normal text-muted-foreground">/</span>
            <span className="font-semibold text-foreground">
              {translateWithFallback(t, 'customers.deals.kanban.breadcrumb.deals', 'Deals')}
            </span>
          </nav>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {translateWithFallback(t, 'customers.deals.kanban.pageTitle', 'Deals')}
              </h1>
              {boardSummary && boardSummary.rows.length > 0 ? (
                /*
                 * Pipeline-wide value summary. The headline number is the converted total in
                 * the tenant's base currency, paired with the deal count for context. When at
                 * least one currency lacks an FX rate, we show a `~` prefix and a "partial"
                 * caveat — the `LaneCurrencyBreakdown` popover (anchored on the `+N` chip)
                 * surfaces the full breakdown and missing-rate disclosure. Clicking the
                 * popover trigger here gives the operator the same board-level detail view.
                 */
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    {translateWithFallback(
                      t,
                      'customers.deals.kanban.boardSummary.count',
                      '{count} deals',
                      { count: total },
                    )}
                  </span>
                  {boardSummary.baseCurrencyCode && boardSummary.totalInBaseCurrency > 0 ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="flex items-baseline gap-1 font-semibold text-foreground">
                        {boardSummary.convertedAll ? null : (
                          <span className="text-muted-foreground" aria-hidden="true">
                            ~
                          </span>
                        )}
                        <span>
                          {new Intl.NumberFormat(undefined, {
                            style: 'decimal',
                            maximumFractionDigits: 0,
                          }).format(boardSummary.totalInBaseCurrency)}
                        </span>
                        <span className="text-xs font-medium text-muted-foreground">
                          {boardSummary.baseCurrencyCode}
                        </span>
                      </span>
                      {!boardSummary.convertedAll ? (
                        <span
                          className="text-overline uppercase tracking-wide text-status-warning-text"
                          title={translateWithFallback(
                            t,
                            'customers.deals.kanban.boardSummary.partialHint',
                            'Missing FX rates for {currencies} — excluded from total',
                            { currencies: boardSummary.missingRateCurrencies.join(', ') },
                          )}
                        >
                          {translateWithFallback(
                            t,
                            'customers.deals.kanban.boardSummary.partial',
                            'partial',
                          )}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  {boardSummary.rows.length > 1 ? (
                    <LaneCurrencyBreakdown
                      rows={boardSummary.rows}
                      baseCurrencyCode={boardSummary.baseCurrencyCode}
                      totalInBaseCurrency={boardSummary.totalInBaseCurrency}
                      convertedAll={boardSummary.convertedAll}
                      missingRateCurrencies={boardSummary.missingRateCurrencies}
                      triggerLabel={translateWithFallback(
                        t,
                        'customers.deals.kanban.boardSummary.breakdownTrigger',
                        'Breakdown',
                      )}
                      triggerClassName="inline-flex items-center rounded-md border border-border bg-card px-2 py-0.5 text-overline font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={translateWithFallback(
                  t,
                  'customers.deals.kanban.search.placeholder',
                  'Search deals…',
                )}
                className="w-[260px]"
              />
              {Object.keys(laneWidths).length > 0 ? (
                <Button
                  variant="outline"
                  type="button"
                  onClick={handleResetAllLaneWidths}
                  title={translateWithFallback(
                    t,
                    'customers.deals.kanban.cta.resetWidths.help',
                    'Restore all kanban columns to their default width',
                  )}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  {translateWithFallback(
                    t,
                    'customers.deals.kanban.cta.resetWidths',
                    'Reset column widths',
                  )}
                </Button>
              ) : null}
              <Button variant="outline" type="button" onClick={handleCustomizeView}>
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                {translateWithFallback(t, 'customers.deals.kanban.cta.customize', 'Customize view')}
              </Button>
              <Button asChild>
                <Link href="/backend/customers/deals/create">
                  <Plus className="size-4" aria-hidden="true" />
                  {translateWithFallback(t, 'customers.deals.kanban.cta.newDeal', 'New deal')}
                </Link>
              </Button>
            </div>
          </div>

          {pipelinesQuery.data && pipelinesQuery.data.length > 1 ? (
            <div className="flex items-center gap-2 pb-1 text-sm">
              <span className="text-muted-foreground">
                {translateWithFallback(t, 'customers.deals.pipeline.switch.label', 'Pipeline')}
              </span>
              <Select
                value={selectedPipelineId ?? undefined}
                onValueChange={(value) => setSelectedPipelineId(value || null)}
              >
                <SelectTrigger className="w-auto min-w-[12rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pipelinesQuery.data.map((pipeline) => (
                    <SelectItem key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <ViewTabsRow active="kanban" className="mt-4" />

        <FilterBarRow
          leadingChips={leadingChipsNode}
          chips={filterChips}
          sortNode={sortNode}
          onChipClick={handleChipClick}
          onAddFilterClick={handleAddFilter}
        />

        {!selectedPipelineId ? (
          <EmptyState
            icon={<Workflow className="size-8" aria-hidden="true" />}
            title={translateWithFallback(
              t,
              'customers.deals.pipeline.noPipeline',
              'No pipeline selected. Create a pipeline in settings.',
            )}
            className="h-[50vh] w-full"
          />
        ) : isInitialLoading ? (
          <div className="flex h-[50vh] items-center justify-center">
            <Spinner />
          </div>
        ) : firstError ? (
          <div className="max-w-xl">
            <ErrorNotice
              message={
                firstError instanceof Error
                  ? firstError.message
                  : translateWithFallback(
                      t,
                      'customers.deals.pipeline.loadError',
                      'Failed to load deals.',
                    )
              }
            />
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            measuring={measuringConfig}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
          {/* Three-column flex: [36px gutter] [scroller flex-1] [36px gutter]
              Each gutter sized exactly to the 36px arrow button — no extra padding/gap so the
              scroller keeps as much horizontal room as possible (= more lanes fit). The buttons
              are absolute inside the gutter so they never overlap card content. */}
          <div className="flex items-stretch">
            <div className="relative flex w-9 shrink-0">
              <button
                type="button"
                onClick={handleScrollPrev}
                onPointerDown={handleHoldPrevStart}
                onPointerUp={stopContinuousScroll}
                onPointerLeave={stopContinuousScroll}
                onPointerCancel={stopContinuousScroll}
                aria-label={translateWithFallback(t, 'customers.deals.kanban.board.scrollPrev', 'Scroll to previous stage')}
                aria-disabled={scrollEdges.atStart}
                className={`absolute left-0 top-28 flex size-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-opacity hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  scrollEdges.atStart ? 'opacity-30' : ''
                }`}
              >
                <ChevronLeft className="size-5" aria-hidden="true" />
              </button>
            </div>
            <div
              ref={setBoardScroller}
              data-kanban-scroller
              className={`flex min-w-0 flex-1 gap-3.5 overflow-x-auto pb-6 ${
                activeDragDealId ? 'cursor-grabbing select-none' : ''
              }`}
            >
              {lanes.length === 0 ? (
                <EmptyState
                  icon={<Layers className="size-8" aria-hidden="true" />}
                  title={translateWithFallback(
                    t,
                    'customers.deals.pipeline.noStages',
                    'Define pipeline stages to start tracking deals.',
                  )}
                  className="h-[50vh] w-full"
                />
              ) : (
                <>
                  {lanes.map((stage) => {
                    const laneDeals = sortedDealsByStage.get(stage.id) ?? EMPTY_DEAL_ARRAY
                    return (
                      <Lane
                        key={stage.id}
                        stage={stage}
                        deals={laneDeals}
                        aggregate={aggregateByStage.get(stage.id) ?? null}
                        selectedDealIds={selectedDealIds}
                        buildMenuItems={buildMenuItems}
                        activeDragDealId={activeDragDealId}
                        isLoadingMore={!!loadingMoreByStage[stage.id]}
                        width={laneWidths[stage.id] ?? null}
                        onToggleSelect={handleToggleSelect}
                        onComposeActivity={handleComposeActivity}
                        onOpenDetail={handleOpenDetail}
                        onQuickAddClick={handleQuickAdd}
                        onLoadMore={handleLoadMoreInLane}
                        onResize={handleLaneResize}
                        onResetWidth={handleResetLaneWidth}
                      />
                    )
                  })}
                  <AddStageLane onClick={handleAddStage} />
                </>
              )}
            </div>
            <div className="relative flex w-9 shrink-0">
              <button
                type="button"
                onClick={handleScrollNext}
                onPointerDown={handleHoldNextStart}
                onPointerUp={stopContinuousScroll}
                onPointerLeave={stopContinuousScroll}
                onPointerCancel={stopContinuousScroll}
                aria-label={translateWithFallback(t, 'customers.deals.kanban.board.scrollNext', 'Scroll to next stage')}
                aria-disabled={scrollEdges.atEnd}
                className={`absolute right-0 top-28 flex size-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-opacity hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  scrollEdges.atEnd ? 'opacity-30' : ''
                }`}
              >
                <ChevronRight className="size-5" aria-hidden="true" />
              </button>
            </div>
          </div>
            <DragOverlay dropAnimation={null}>
              {activeDragDeal ? (
                <div className="pointer-events-none w-[308px] rotate-2 cursor-grabbing select-none rounded-lg border border-border bg-card px-4 py-3.5 shadow-xl ring-2 ring-accent-indigo/40">
                  <div className="flex flex-col gap-2">
                    <h3 className="line-clamp-2 text-base font-semibold leading-normal text-foreground">
                      {activeDragDeal.title}
                    </h3>
                    {typeof activeDragDeal.valueAmount === 'number' ? (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-bold leading-normal text-foreground">
                          {new Intl.NumberFormat(undefined, {
                            style: 'decimal',
                            maximumFractionDigits: 0,
                            useGrouping: true,
                          }).format(activeDragDeal.valueAmount)}
                        </span>
                        {activeDragDeal.valueCurrency ? (
                          <span className="text-sm font-semibold leading-normal text-muted-foreground">
                            {activeDragDeal.valueCurrency.toUpperCase()}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {activeDragDeal.primaryCompany ? (
                      <span className="inline-flex w-fit max-w-full items-center gap-1.5 overflow-hidden rounded-md bg-muted px-2.5 py-1 text-sm font-semibold leading-normal text-foreground">
                        <span className="truncate">{activeDragDeal.primaryCompany.label}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {selectedPipelineId && !isInitialLoading ? (
          <div className="flex flex-col gap-1 border-t border-border pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{footerCount}</span>
            <span>{dragHint}</span>
            {pendingDealId ? <Spinner className="size-3" /> : null}
          </div>
        ) : null}
      </PageBody>

      <QuickDealDialog
        open={!!quickDealContext}
        context={quickDealContext}
        onClose={() => setQuickDealContext(null)}
        onCreated={handleDialogCreated}
        currentUserId={currentUserId || undefined}
        currentUserLabel={currentUserLabel}
        companies={companiesQuery.data ?? []}
      />
      <AddStageDialog
        open={!!addStageContext}
        context={addStageContext}
        onClose={() => setAddStageContext(null)}
        onCreated={handleDialogCreated}
      />
      <CustomizeViewDialog
        open={customizeOpen}
        resizedLanesCount={Object.keys(laneWidths).length}
        onClose={() => setCustomizeOpen(false)}
        onResetToDefault={handleResetView}
        onConfigureCardFields={handleConfigureCardFields}
        onResetColumnWidths={handleResetAllLaneWidths}
      />
      <ActivityComposerDialog
        open={!!activityContext}
        context={activityContext}
        onClose={() => setActivityContext(null)}
        onCreated={handleDialogCreated}
      />
      <ChangeStageDialog
        open={changeStageOpen}
        selectedCount={bulkSelectionSummary.count}
        pipelineName={activePipelineName}
        stages={stageOptions}
        isSubmitting={isBulkMutating}
        onClose={() => setChangeStageOpen(false)}
        onConfirm={(stageId) => void handleBulkChangeStage(stageId)}
      />
      <ChangeStageDialog
        open={!!singleMoveStageContext}
        selectedCount={1}
        pipelineName={activePipelineName}
        stages={stageOptions}
        isSubmitting={false}
        onClose={() => setSingleMoveStageContext(null)}
        onConfirm={(stageId) => {
          if (singleMoveStageContext) {
            moveDealToStage(singleMoveStageContext.dealId, stageId)
          }
          setSingleMoveStageContext(null)
        }}
      />
      <ChangeOwnerDialog
        open={changeOwnerOpen}
        selectedCount={bulkSelectionSummary.count}
        isSubmitting={isBulkMutating}
        onClose={() => setChangeOwnerOpen(false)}
        onConfirm={(userId) => void handleBulkChangeOwner(userId)}
      />
      <BulkActionsBar
        count={bulkSelectionSummary.count}
        totalLabel={bulkSelectionSummary.totalLabel}
        onChangeStage={() => setChangeStageOpen(true)}
        onChangeOwner={() => setChangeOwnerOpen(true)}
        onExportCsv={handleBulkExport}
        onDelete={() => void handleBulkDelete()}
        onClear={handleBulkClear}
      />
      {ConfirmDialogElement}
    </Page>
  )
}
