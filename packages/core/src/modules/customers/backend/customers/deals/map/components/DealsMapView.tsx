"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import {
  apiCall,
  readApiResultOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { FilterOptionTone } from '@open-mercato/shared/lib/query/advanced-filter'
import { FilterBarRow, type KanbanFilterChip } from '../../pipeline/components/FilterBarRow'
import { StatusFilterPopover } from '../../pipeline/components/StatusFilterPopover'
import {
  PipelineFilterPopover,
  type PipelineFilterOption,
} from '../../pipeline/components/PipelineFilterPopover'
import {
  EntityFilterPopover,
  type EntityFilterOption,
} from '../../pipeline/components/EntityFilterPopover'
import {
  CloseDateFilterPopover,
  type CloseDateRange,
} from '../../pipeline/components/CloseDateFilterPopover'
import { SortByPopover, type SortOption } from '../../pipeline/components/SortByPopover'
import { fetchAssignableStaffMembers } from '../../../../../components/detail/assignableStaff'
import { DealsLocationPanel } from './DealsLocationPanel'
import {
  DealsMapCanvas,
  type DealsMapCanvasDeal,
  type DealsMapLegendStage,
  type DealsMapPreview,
  type MapCenter,
} from './DealsMapCanvas'

const DEFAULT_SORT: SortOption = 'updated_desc'
const PAGE_SIZE = 100
const MAX_DEALS = 500
const FALLBACK_TONES: FilterOptionTone[] = ['success', 'warning', 'error', 'info', 'neutral', 'brand']
const KNOWN_STAGE_TONES: ReadonlySet<string> = new Set([
  'success',
  'warning',
  'info',
  'error',
  'neutral',
  'brand',
  'pink',
])
const SUPPRESS_AUTH_REDIRECT_HEADERS = {
  'x-om-forbidden-redirect': '0',
  'x-om-unauthorized-redirect': '0',
} as const
// The map has no quick-filter chips (filters live in the leading popovers), but FilterBarRow
// requires the props — keep stable module-level references instead of per-render allocations.
const NO_FILTER_CHIPS: KanbanFilterChip[] = []
const noopChipClick = (_chipId: KanbanFilterChip['id']) => {}

type PipelineRecord = { id: string; name: string; isDefault: boolean }

type PipelineStageRecord = {
  id: string
  pipelineId: string
  label: string
  order: number
  color?: string | null
}

export type StageMeta = { label: string; tone: FilterOptionTone }

type DealMapApiLocation = {
  latitude?: number | string | null
  longitude?: number | string | null
  city?: string | null
  region?: string | null
  country?: string | null
  source?: string | null
}

type DealMapApiItem = {
  id?: string
  title?: string | null
  status?: string | null
  pipelineId?: string | null
  pipelineStageId?: string | null
  pipelineStage?: string | null
  valueAmount?: number | string | null
  valueCurrency?: string | null
  probability?: number | string | null
  expectedCloseAt?: string | null
  ownerUserId?: string | null
  updatedAt?: string | null
  companies?: Array<{ id?: string; label?: string } | null> | null
  people?: Array<{ id?: string; label?: string } | null> | null
  location?: DealMapApiLocation | null
}

type DealsMapApiResponse = {
  items?: DealMapApiItem[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

export type MapDealLocation = {
  latitude: number
  longitude: number
  city: string | null
  region: string | null
  country: string | null
}

export type MapDeal = {
  id: string
  title: string
  status: string | null
  pipelineId: string | null
  pipelineStageId: string | null
  valueAmount: number | null
  valueCurrency: string | null
  probability: number | null
  expectedCloseAt: string | null
  ownerUserId: string | null
  companyLabel: string | null
  location: MapDealLocation | null
}

type DealsMapQueryResult = {
  deals: MapDeal[]
  total: number
  truncated: boolean
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function normalizeLocation(location: DealMapApiLocation | null | undefined): MapDealLocation | null {
  if (!location) return null
  const latitude = normalizeNumber(location.latitude)
  const longitude = normalizeNumber(location.longitude)
  if (latitude === null || longitude === null) return null
  return {
    latitude,
    longitude,
    city: normalizeText(location.city),
    region: normalizeText(location.region),
    country: normalizeText(location.country),
  }
}

function mapApiItem(item: DealMapApiItem, fallbackTitle: string): MapDeal | null {
  const id = normalizeText(item.id)
  if (!id) return null
  const firstCompany = Array.isArray(item.companies)
    ? item.companies.find((entry) => entry && normalizeText(entry.label))
    : null
  return {
    id,
    title: normalizeText(item.title) ?? fallbackTitle,
    status: normalizeText(item.status),
    pipelineId: normalizeText(item.pipelineId),
    pipelineStageId: normalizeText(item.pipelineStageId),
    valueAmount: normalizeNumber(item.valueAmount),
    valueCurrency: normalizeText(item.valueCurrency)?.toUpperCase() ?? null,
    probability: normalizeNumber(item.probability),
    expectedCloseAt: normalizeText(item.expectedCloseAt),
    ownerUserId: normalizeText(item.ownerUserId),
    companyLabel: firstCompany ? normalizeText(firstCompany.label) : null,
    location: normalizeLocation(item.location),
  }
}

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

function buildStageMetaById(stages: PipelineStageRecord[]): Map<string, StageMeta> {
  const byPipeline = new Map<string, PipelineStageRecord[]>()
  for (const stage of stages) {
    const key = stage.pipelineId ?? ''
    const bucket = byPipeline.get(key) ?? []
    bucket.push(stage)
    byPipeline.set(key, bucket)
  }
  const meta = new Map<string, StageMeta>()
  for (const bucket of byPipeline.values()) {
    const sorted = bucket.slice().sort((a, b) => a.order - b.order)
    sorted.forEach((stage, index) => {
      const tone =
        stage.color && KNOWN_STAGE_TONES.has(stage.color)
          ? (stage.color as FilterOptionTone)
          : FALLBACK_TONES[index % FALLBACK_TONES.length]
      meta.set(stage.id, { label: stage.label, tone })
    })
  }
  return meta
}

type DealsMapViewProps = {
  search: string
}

export function DealsMapView({ search }: DealsMapViewProps): React.ReactElement {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [statusFilters, setStatusFilters] = React.useState<string[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = React.useState<string | null>(null)
  const [ownerFilters, setOwnerFilters] = React.useState<string[]>([])
  const [peopleFilters, setPeopleFilters] = React.useState<string[]>([])
  const [companyFilters, setCompanyFilters] = React.useState<string[]>([])
  const [closeDateFilter, setCloseDateFilter] = React.useState<CloseDateRange>({ from: null, to: null })
  const [sortBy, setSortBy] = React.useState<SortOption>(DEFAULT_SORT)
  const [ownerLabels, setOwnerLabels] = React.useState<Record<string, string>>({})
  const [peopleLabels, setPeopleLabels] = React.useState<Record<string, string>>({})
  const [companyLabels, setCompanyLabels] = React.useState<Record<string, string>>({})
  const [selectedDealId, setSelectedDealId] = React.useState<string | null>(null)
  const [mapCenter, setMapCenter] = React.useState<MapCenter | null>(null)

  const [debouncedSearch, setDebouncedSearch] = React.useState(search)
  React.useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(handle)
  }, [search])

  const fallbackTitle = translateWithFallback(t, 'customers.deals.pipeline.untitled', 'Untitled deal')
  const loadErrorLabel = translateWithFallback(
    t,
    'customers.deals.map.loadError',
    'Failed to load deals for the map.',
  )

  const apiSort = React.useMemo(() => {
    const mapped = mapSortOptionToApi(sortBy)
    return mapped ?? { sortField: 'updatedAt' as const, sortDir: 'desc' as const }
  }, [sortBy])

  const pipelinesQuery = useQuery<PipelineRecord[]>({
    queryKey: ['customers', 'deals', 'map', 'pipelines', `scope:${scopeVersion}`],
    staleTime: 60_000,
    queryFn: async () => {
      const call = await apiCall<{ items?: PipelineRecord[] }>('/api/customers/pipelines', {
        headers: SUPPRESS_AUTH_REDIRECT_HEADERS,
      })
      if (!call.ok) return []
      return Array.isArray(call.result?.items) ? call.result.items : []
    },
  })

  const stagesQuery = useQuery<PipelineStageRecord[]>({
    queryKey: ['customers', 'deals', 'map', 'stages', `scope:${scopeVersion}`],
    staleTime: 60_000,
    queryFn: async () => {
      const call = await apiCall<{ items?: PipelineStageRecord[] }>('/api/customers/pipeline-stages', {
        headers: SUPPRESS_AUTH_REDIRECT_HEADERS,
      })
      if (!call.ok) return []
      return Array.isArray(call.result?.items) ? call.result.items : []
    },
  })

  const staffQuery = useQuery<Map<string, string>>({
    queryKey: ['customers', 'deals', 'map', 'staff', `scope:${scopeVersion}`],
    staleTime: 300_000,
    queryFn: async () => {
      try {
        const members = await withScopedApiRequestHeaders(
          { ...SUPPRESS_AUTH_REDIRECT_HEADERS },
          () => fetchAssignableStaffMembers('', { pageSize: 100 }),
        )
        const names = new Map<string, string>()
        for (const member of members) {
          if (member.userId && member.displayName) names.set(member.userId, member.displayName)
        }
        return names
      } catch {
        return new Map<string, string>()
      }
    },
  })

  const ownerNamesById = staffQuery.data ?? null

  const dealsQuery = useQuery<DealsMapQueryResult>({
    queryKey: [
      'customers',
      'deals',
      'map',
      'deals',
      `scope:${scopeVersion}`,
      `search:${debouncedSearch}`,
      `status:${statusFilters.slice().sort((a, b) => a.localeCompare(b)).join(',')}`,
      `pipeline:${selectedPipelineId ?? ''}`,
      `owners:${ownerFilters.slice().sort((a, b) => a.localeCompare(b)).join(',')}`,
      `people:${peopleFilters.slice().sort((a, b) => a.localeCompare(b)).join(',')}`,
      `companies:${companyFilters.slice().sort((a, b) => a.localeCompare(b)).join(',')}`,
      `close:${closeDateFilter.from ?? ''}-${closeDateFilter.to ?? ''}`,
      `sort:${apiSort.sortField}:${apiSort.sortDir}`,
    ],
    staleTime: 30_000,
    queryFn: async () => {
      const buildParams = (page: number) => {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', String(PAGE_SIZE))
        params.set('sortField', apiSort.sortField)
        params.set('sortDir', apiSort.sortDir)
        if (debouncedSearch.length) params.set('search', debouncedSearch)
        for (const status of statusFilters) params.append('status', status)
        if (selectedPipelineId) params.set('pipelineId', selectedPipelineId)
        for (const ownerId of ownerFilters) params.append('ownerUserId', ownerId)
        for (const personId of peopleFilters) params.append('personId', personId)
        for (const companyId of companyFilters) params.append('companyId', companyId)
        if (closeDateFilter.from) params.set('expectedCloseAtFrom', closeDateFilter.from)
        if (closeDateFilter.to) params.set('expectedCloseAtTo', closeDateFilter.to)
        return params
      }
      const fetchPage = (page: number) =>
        readApiResultOrThrow<DealsMapApiResponse>(
          `/api/customers/deals/map?${buildParams(page).toString()}`,
          undefined,
          { errorMessage: loadErrorLabel },
        )

      const collected: MapDeal[] = []
      const collectFrom = (payload: DealsMapApiResponse | null | undefined) => {
        const items = Array.isArray(payload?.items) ? payload.items : []
        for (const item of items) {
          const mapped = mapApiItem(item, fallbackTitle)
          if (mapped) collected.push(mapped)
        }
      }

      // Fetch the first page to learn totalPages, then pull the remaining pages concurrently —
      // the pages are independent, so awaiting them sequentially only stacked round-trip latency.
      const firstPage = await fetchPage(1)
      collectFrom(firstPage)
      const total = typeof firstPage?.total === 'number' ? firstPage.total : collected.length
      const reportedTotalPages = typeof firstPage?.totalPages === 'number' ? firstPage.totalPages : 1
      // Bound the fan-out: the client renders at most MAX_DEALS pins regardless of the located total.
      const maxPages = Math.max(1, Math.ceil(MAX_DEALS / PAGE_SIZE))
      const lastPage = Math.min(reportedTotalPages, maxPages)
      if (lastPage > 1) {
        const rest = await Promise.all(
          Array.from({ length: lastPage - 1 }, (_unused, index) => fetchPage(index + 2)),
        )
        for (const payload of rest) collectFrom(payload)
      }

      const deals = collected.slice(0, MAX_DEALS)
      return { deals, total, truncated: total > deals.length }
    },
  })

  const stageMetaById = React.useMemo(
    () => buildStageMetaById(stagesQuery.data ?? []),
    [stagesQuery.data],
  )

  const deals = React.useMemo(() => {
    const fetched = dealsQuery.data?.deals ?? []
    if (sortBy !== 'owner_asc' || !ownerNamesById) return fetched
    return fetched.slice().sort((a, b) => {
      const aLabel = (a.ownerUserId ? ownerNamesById.get(a.ownerUserId) : null) ?? a.ownerUserId ?? ''
      const bLabel = (b.ownerUserId ? ownerNamesById.get(b.ownerUserId) : null) ?? b.ownerUserId ?? ''
      return aLabel.localeCompare(bLabel)
    })
  }, [dealsQuery.data, sortBy, ownerNamesById])

  const locatedDeals = React.useMemo(
    () => deals.filter((deal): deal is MapDeal & { location: MapDealLocation } => deal.location !== null),
    [deals],
  )

  const canvasDeals = React.useMemo<DealsMapCanvasDeal[]>(
    () =>
      locatedDeals.map((deal) => ({
        id: deal.id,
        latitude: deal.location.latitude,
        longitude: deal.location.longitude,
        tone: deal.pipelineStageId ? stageMetaById.get(deal.pipelineStageId)?.tone ?? null : null,
      })),
    [locatedDeals, stageMetaById],
  )

  const legendStages = React.useMemo<DealsMapLegendStage[]>(() => {
    if (stageMetaById.size === 0) return []
    const presentStageIds = new Set<string>()
    for (const deal of locatedDeals) {
      if (deal.pipelineStageId) presentStageIds.add(deal.pipelineStageId)
    }
    const stages: DealsMapLegendStage[] = []
    for (const stage of stagesQuery.data ?? []) {
      if (!presentStageIds.has(stage.id)) continue
      const meta = stageMetaById.get(stage.id)
      if (!meta) continue
      stages.push({ id: stage.id, label: meta.label, tone: meta.tone })
    }
    return stages
  }, [locatedDeals, stageMetaById, stagesQuery.data])

  const selectedDeal = React.useMemo(
    () => (selectedDealId ? deals.find((deal) => deal.id === selectedDealId) ?? null : null),
    [deals, selectedDealId],
  )

  const preview = React.useMemo<DealsMapPreview | null>(() => {
    if (!selectedDeal) return null
    const stageMeta = selectedDeal.pipelineStageId
      ? stageMetaById.get(selectedDeal.pipelineStageId) ?? null
      : null
    const locationLine = selectedDeal.location
      ? [selectedDeal.location.city, selectedDeal.location.region].filter(Boolean).join(', ') ||
        selectedDeal.location.country
      : null
    return {
      id: selectedDeal.id,
      title: selectedDeal.title,
      companyLabel: selectedDeal.companyLabel,
      locationLine: locationLine || null,
      valueAmount: selectedDeal.valueAmount,
      valueCurrency: selectedDeal.valueCurrency,
      probability: selectedDeal.probability,
      expectedCloseAt: selectedDeal.expectedCloseAt,
      stageLabel: stageMeta?.label ?? null,
      stageTone: stageMeta?.tone ?? null,
      ownerName:
        selectedDeal.ownerUserId && ownerNamesById
          ? ownerNamesById.get(selectedDeal.ownerUserId) ?? null
          : null,
    }
  }, [selectedDeal, stageMetaById, ownerNamesById])

  const handleSelect = React.useCallback((dealId: string | null) => {
    setSelectedDealId(dealId)
  }, [])

  const handleCenterChange = React.useCallback((center: MapCenter) => {
    setMapCenter(center)
  }, [])

  const pipelineFilterOptions = React.useMemo<PipelineFilterOption[]>(
    () => (pipelinesQuery.data ?? []).map((pipeline) => ({ id: pipeline.id, name: pipeline.name })),
    [pipelinesQuery.data],
  )

  const loadOwnerOptions = React.useCallback(
    async (query: string, _signal: AbortSignal): Promise<EntityFilterOption[]> => {
      try {
        const members = await withScopedApiRequestHeaders(
          { ...SUPPRESS_AUTH_REDIRECT_HEADERS },
          () => fetchAssignableStaffMembers(query ?? '', { pageSize: 100 }),
        )
        const options: EntityFilterOption[] = members
          .filter((member) => !!member.userId && !!member.displayName)
          .map((member) => ({ value: member.userId, label: member.displayName }))
        setOwnerLabels((prev) => {
          const next: Record<string, string> = { ...prev }
          for (const option of options) next[option.value] = option.label
          return next
        })
        return options
      } catch {
        return []
      }
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
      const call = await apiCall<{
        items?: Array<{ id?: string; display_name?: string; first_name?: string; last_name?: string }>
      }>(`/api/customers/people?${params.toString()}`, {
        signal,
        headers: SUPPRESS_AUTH_REDIRECT_HEADERS,
      })
      if (!call.ok) return []
      const items = call.result?.items ?? []
      const options: EntityFilterOption[] = []
      for (const item of items) {
        if (!item.id) continue
        const label =
          item.display_name && item.display_name.trim().length
            ? item.display_name.trim()
            : [item.first_name, item.last_name].filter(Boolean).join(' ').trim() || item.id.slice(0, 8)
        options.push({ value: item.id, label })
      }
      setPeopleLabels((prev) => {
        const next: Record<string, string> = { ...prev }
        for (const option of options) next[option.value] = option.label
        return next
      })
      return options
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
        { signal, headers: SUPPRESS_AUTH_REDIRECT_HEADERS },
      )
      if (!call.ok) return []
      const items = call.result?.items ?? []
      const options: EntityFilterOption[] = []
      for (const item of items) {
        if (!item.id || !item.display_name) continue
        options.push({ value: item.id, label: item.display_name })
      }
      setCompanyLabels((prev) => {
        const next: Record<string, string> = { ...prev }
        for (const option of options) next[option.value] = option.label
        return next
      })
      return options
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

  return (
    <div className="flex flex-col gap-4">
      <FilterBarRow
        leadingChips={leadingChipsNode}
        chips={NO_FILTER_CHIPS}
        sortNode={sortNode}
        onChipClick={noopChipClick}
      />

      {dealsQuery.isLoading ? (
        <LoadingMessage
          label={translateWithFallback(t, 'customers.deals.map.canvas.loading', 'Loading map…')}
        />
      ) : dealsQuery.isError ? (
        <ErrorMessage
          label={dealsQuery.error instanceof Error ? dealsQuery.error.message : loadErrorLabel}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void dealsQuery.refetch()}
            >
              {translateWithFallback(t, 'customers.deals.map.retry', 'Retry')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {dealsQuery.data?.truncated ? (
            <p className="text-sm text-muted-foreground">
              {translateWithFallback(
                t,
                'customers.deals.map.truncated',
                'Showing first {count} of {total} located deals — refine filters to narrow the map.',
                { count: deals.length, total: dealsQuery.data?.total ?? deals.length },
              )}
            </p>
          ) : null}
          <div className="flex min-h-[480px] flex-col gap-4 lg:h-[calc(100vh-360px)] lg:flex-row">
            <DealsLocationPanel
              deals={deals}
              locatedCount={dealsQuery.data?.total ?? deals.length}
              stageMetaById={stageMetaById}
              mapCenter={mapCenter}
              selectedDealId={selectedDealId}
              onSelect={handleSelect}
            />
            <DealsMapCanvas
              className="min-h-[480px] flex-1 overflow-hidden rounded-xl border border-border lg:min-h-0"
              deals={canvasDeals}
              legendStages={legendStages}
              preview={preview}
              selectedDealId={selectedDealId}
              onSelect={handleSelect}
              onCenterChange={handleCenterChange}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default DealsMapView
