"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type DealAssociation = { id: string; label: string }

type DealRecord = {
  id: string
  title: string
  status: string | null
  pipelineStage: string | null
  pipelineId: string | null
  pipelineStageId: string | null
  valueAmount: number | null
  valueCurrency: string | null
  probability: number | null
  expectedCloseAt: string | null
  expectedCloseAtTs: number | null
  createdAt: string | null
  createdAtTs: number | null
  updatedAt: string | null
  stageEnteredAt: string | null
  people: DealAssociation[]
  companies: DealAssociation[]
}

type DealsQueryData = {
  deals: DealRecord[]
  total: number
}

type StageDefinition = {
  id: string
  value: string | null
  label: string
  color: string | null
  icon: string | null
}

type SortOption = 'probability' | 'createdAt' | 'expectedCloseAt' | 'value' | 'age'

type PipelineRecord = { id: string; name: string; isDefault: boolean }
type PipelineStageRecord = { id: string; label: string; order: number; pipelineId: string }

type FilterState = {
  ownerSearch: string
  valueMin: string
  valueMax: string
  closeDateFrom: string
  closeDateTo: string
}

const EMPTY_FILTERS: FilterState = {
  ownerSearch: '',
  valueMin: '',
  valueMax: '',
  closeDateFrom: '',
  closeDateTo: '',
}

const DEALS_QUERY_LIMIT = 100

const dealsQueryKey = (scopeVersion: number, pipelineId: string | null) =>
  ['customers', 'deals', 'pipeline', `scope:${scopeVersion}`, `pipeline:${pipelineId ?? 'none'}`] as const

const sortOptions: SortOption[] = ['probability', 'createdAt', 'expectedCloseAt', 'value', 'age']

function normalizeAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeProbability(value: unknown): number | null {
  const parsed = normalizeAmount(value)
  if (parsed === null) return null
  if (parsed < 0) return 0
  if (parsed > 100) return 100
  return Math.round(parsed)
}

function normalizeTimestamp(value: unknown): { iso: string | null; ts: number | null } {
  if (typeof value !== 'string' || !value.trim().length) return { iso: null, ts: null }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { iso: null, ts: null }
  return { iso: date.toISOString(), ts: date.getTime() }
}

function buildStageDefinitionsFromPipelineStages(
  pipelineStages: PipelineStageRecord[],
  deals: DealRecord[],
  t: ReturnType<typeof useT>,
): StageDefinition[] {
  const result: StageDefinition[] = pipelineStages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((stage) => ({
      id: stage.id,
      value: stage.id,
      label: stage.label,
      color: null,
      icon: null,
    }))

  const knownIds = new Set(pipelineStages.map((s) => s.id))
  const hasUnassigned = deals.some((deal) => !deal.pipelineStageId || !knownIds.has(deal.pipelineStageId))
  if (hasUnassigned) {
    result.push({
      id: 'stage:__unassigned',
      value: null,
      label: translateWithFallback(t, 'customers.deals.pipeline.unassigned', 'No stage'),
      color: null,
      icon: null,
    })
  }

  return result
}

function createDealMap(deals: DealRecord[]): Map<string, DealRecord> {
  return deals.reduce<Map<string, DealRecord>>((acc, deal) => acc.set(deal.id, deal), new Map())
}

function groupDealsByStageId(deals: DealRecord[]): Map<string | null, DealRecord[]> {
  const byStage = new Map<string | null, DealRecord[]>()
  deals.forEach((deal) => {
    const stageKey = deal.pipelineStageId ?? null
    const bucket = byStage.get(stageKey) ?? []
    bucket.push(deal)
    byStage.set(stageKey, bucket)
  })
  return byStage
}

function sortDeals(deals: DealRecord[], option: SortOption): DealRecord[] {
  const sorted = [...deals]
  sorted.sort((a, b) => {
    if (option === 'probability') {
      const ap = typeof a.probability === 'number' ? a.probability : -1
      const bp = typeof b.probability === 'number' ? b.probability : -1
      if (ap !== bp) return bp - ap
    }
    if (option === 'expectedCloseAt') {
      const at = typeof a.expectedCloseAtTs === 'number' ? a.expectedCloseAtTs : Number.POSITIVE_INFINITY
      const bt = typeof b.expectedCloseAtTs === 'number' ? b.expectedCloseAtTs : Number.POSITIVE_INFINITY
      if (at !== bt) return at - bt
    }
    if (option === 'value') {
      const av = typeof a.valueAmount === 'number' ? a.valueAmount : -1
      const bv = typeof b.valueAmount === 'number' ? b.valueAmount : -1
      if (av !== bv) return bv - av
    }
    if (option === 'age') {
      const ageA = computeDealAgeDays(a)
      const ageB = computeDealAgeDays(b)
      if (ageA !== ageB) return ageB - ageA
    }
    const at = typeof a.createdAtTs === 'number' ? a.createdAtTs : Number.NEGATIVE_INFINITY
    const bt = typeof b.createdAtTs === 'number' ? b.createdAtTs : Number.NEGATIVE_INFINITY
    if (option === 'createdAt') {
      if (at !== bt) return bt - at
    } else if (option === 'expectedCloseAt' || option === 'probability' || option === 'value' || option === 'age') {
      if (at !== bt) return bt - at
    }
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  })
  return sorted
}

function applyClientFilters(deals: DealRecord[], filters: FilterState): DealRecord[] {
  return deals.filter((deal) => {
    if (filters.ownerSearch.trim().length > 0) {
      const search = filters.ownerSearch.trim().toLowerCase()
      const titleMatch = deal.title.toLowerCase().includes(search)
      const peopleMatch = deal.people.some((p) => p.label.toLowerCase().includes(search))
      const companiesMatch = deal.companies.some((c) => c.label.toLowerCase().includes(search))
      if (!titleMatch && !peopleMatch && !companiesMatch) return false
    }
    if (filters.valueMin.trim().length > 0) {
      const min = Number(filters.valueMin.trim())
      if (Number.isFinite(min) && (deal.valueAmount === null || deal.valueAmount < min)) return false
    }
    if (filters.valueMax.trim().length > 0) {
      const max = Number(filters.valueMax.trim())
      if (Number.isFinite(max) && (deal.valueAmount === null || deal.valueAmount > max)) return false
    }
    if (filters.closeDateFrom.trim().length > 0) {
      const from = new Date(filters.closeDateFrom.trim())
      if (!Number.isNaN(from.getTime())) {
        if (!deal.expectedCloseAtTs || deal.expectedCloseAtTs < from.getTime()) return false
      }
    }
    if (filters.closeDateTo.trim().length > 0) {
      const to = new Date(filters.closeDateTo.trim())
      if (!Number.isNaN(to.getTime())) {
        const endOfDay = new Date(to)
        endOfDay.setHours(23, 59, 59, 999)
        if (!deal.expectedCloseAtTs || deal.expectedCloseAtTs > endOfDay.getTime()) return false
      }
    }
    return true
  })
}

function formatCurrency(amount: number | null, currency: string | null, fallback: string): string {
  if (amount === null || Number.isNaN(amount)) return fallback
  const code = currency && currency.length === 3 ? currency.toUpperCase() : 'USD'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${code} ${amount.toFixed(2)}`
  }
}

function formatProbability(probability: number | null, fallback: string): string {
  if (typeof probability !== 'number' || Number.isNaN(probability)) return fallback
  return `${probability}%`
}

function computeDealAgeDays(deal: DealRecord): number {
  const referenceDate = deal.stageEnteredAt ?? deal.createdAt
  if (!referenceDate) return 0
  const ms = Date.now() - new Date(referenceDate).getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

function getDealAgeBadge(days: number): { label: string; className: string } | null {
  if (days >= 30) return { label: `${days}d`, className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
  if (days >= 14) return { label: `${days}d`, className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
  if (days >= 7) return { label: `${days}d`, className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' }
  return null
}

function computeLaneTotalValue(deals: DealRecord[]): number {
  return deals.reduce((sum, deal) => sum + (deal.valueAmount ?? 0), 0)
}

export default function SalesPipelinePage(): React.ReactElement {
  const t = useT()
  const translate = React.useCallback(
    (key: string, fallback: string, params?: Record<string, string | number>) => {
      const value = translateWithFallback(t, key, fallback, params)
      if (value === fallback && params) {
        return fallback.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (match, doubleToken, singleToken) => {
          const token = (doubleToken ?? singleToken) as string | undefined
          if (!token) return match
          const replacement = params[token]
          if (replacement === undefined) {
            return doubleToken ? `{{${token}}}` : `{${token}}`
          }
          return String(replacement)
        })
      }
      return value
    },
    [t],
  )
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()
  const [sortBy, setSortBy] = React.useState<SortOption>('probability')
  const [pendingDealId, setPendingDealId] = React.useState<string | null>(null)
  const [selectedPipelineId, setSelectedPipelineId] = React.useState<string | null>(null)
  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS)
  const [collapsedStages, setCollapsedStages] = React.useState<Set<string>>(new Set())
  const [inlineFormStageId, setInlineFormStageId] = React.useState<string | null>(null)
  const [inlineTitle, setInlineTitle] = React.useState('')
  const [inlineValue, setInlineValue] = React.useState('')

  const pipelinesQuery = useQuery<PipelineRecord[]>({
    queryKey: ['customers', 'pipelines', `scope:${scopeVersion}`],
    staleTime: 60_000,
    queryFn: async () => {
      const payload = await readApiResultOrThrow<{ items: PipelineRecord[] }>(
        '/api/customers/pipelines',
        undefined,
        { errorMessage: translate('customers.deals.pipeline.loadError', 'Failed to load pipelines.') },
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

  const stagesQuery = useQuery<PipelineStageRecord[]>({
    queryKey: ['customers', 'pipeline-stages', `scope:${scopeVersion}`, `pipeline:${selectedPipelineId}`],
    enabled: !!selectedPipelineId,
    staleTime: 30_000,
    queryFn: async () => {
      const payload = await readApiResultOrThrow<{ items: PipelineStageRecord[] }>(
        `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(selectedPipelineId!)}`,
        undefined,
        { errorMessage: translate('customers.deals.pipeline.loadError', 'Failed to load stages.') },
      )
      return payload?.items ?? []
    },
  })

  const dealsKey = React.useMemo(() => dealsQueryKey(scopeVersion, selectedPipelineId), [scopeVersion, selectedPipelineId])

  const dealsQuery = useQuery<DealsQueryData>({
    queryKey: dealsKey,
    enabled: !!selectedPipelineId,
    staleTime: 30_000,
    queryFn: async () => {
      const search = new URLSearchParams()
      search.set('page', '1')
      search.set('pageSize', String(DEALS_QUERY_LIMIT))
      search.set('sortField', 'createdAt')
      search.set('sortDir', 'desc')
      if (selectedPipelineId) search.set('pipelineId', selectedPipelineId)
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/customers/deals?${search.toString()}`,
        undefined,
        { errorMessage: translate('customers.deals.pipeline.loadError', 'Failed to load deals.') },
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      const deals: DealRecord[] = []
      items.forEach((item) => {
        if (!item || typeof item !== 'object') return
        const data = item as Record<string, unknown>
        const id = typeof data.id === 'string' ? data.id : null
        if (!id) return
        const title =
          typeof data.title === 'string' && data.title.trim().length
            ? data.title.trim()
            : translate('customers.deals.pipeline.untitled', 'Untitled deal')
        const status =
          typeof data.status === 'string' && data.status.trim().length ? data.status.trim() : null
        const stage =
          typeof data.pipeline_stage === 'string' && data.pipeline_stage.trim().length
            ? data.pipeline_stage.trim()
            : null
        const amount = normalizeAmount(data.value_amount)
        const currency =
          typeof data.value_currency === 'string' && data.value_currency.trim().length
            ? data.value_currency.trim().toUpperCase()
            : null
        const probability = normalizeProbability(data.probability)
        const expected = normalizeTimestamp(data.expected_close_at)
        const created = normalizeTimestamp(data.created_at)
        const updated = normalizeTimestamp(data.updated_at)
        const stageEntered = normalizeTimestamp(data.stage_entered_at)
        const rawPeople = Array.isArray(data.people) ? data.people : []
        const people: DealAssociation[] = rawPeople
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const ref = entry as Record<string, unknown>
            const personId = typeof ref.id === 'string' ? ref.id : null
            if (!personId) return null
            const label =
              typeof ref.label === 'string' && ref.label.trim().length
                ? ref.label.trim()
                : personId
            return { id: personId, label }
          })
          .filter((entry): entry is DealAssociation => !!entry)
        const rawCompanies = Array.isArray(data.companies) ? data.companies : []
        const companies: DealAssociation[] = rawCompanies
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const ref = entry as Record<string, unknown>
            const companyId = typeof ref.id === 'string' ? ref.id : null
            if (!companyId) return null
            const label =
              typeof ref.label === 'string' && ref.label.trim().length
                ? ref.label.trim()
                : companyId
            return { id: companyId, label }
          })
          .filter((entry): entry is DealAssociation => !!entry)
        deals.push({
          id,
          title,
          status,
          pipelineStage: stage,
          pipelineId: typeof data.pipeline_id === 'string' ? data.pipeline_id : null,
          pipelineStageId: typeof data.pipeline_stage_id === 'string' ? data.pipeline_stage_id : null,
          valueAmount: amount,
          valueCurrency: currency,
          probability,
          expectedCloseAt: expected.iso,
          expectedCloseAtTs: expected.ts,
          createdAt: created.iso,
          createdAtTs: created.ts,
          updatedAt: updated.iso,
          stageEnteredAt: stageEntered.iso,
          people,
          companies,
        })
      })

      const total = typeof payload?.total === 'number' ? payload.total : deals.length
      return { deals, total }
    },
  })

  const allDeals = dealsQuery.data?.deals ?? []
  const total = dealsQuery.data?.total ?? allDeals.length
  const deals = React.useMemo(() => applyClientFilters(allDeals, filters), [allDeals, filters])
  const dealMap = React.useMemo(() => createDealMap(deals), [deals])
  const groupedDeals = React.useMemo(() => groupDealsByStageId(deals), [deals])
  const stages = React.useMemo(
    () => buildStageDefinitionsFromPipelineStages(stagesQuery.data ?? [], deals, t),
    [stagesQuery.data, deals, t],
  )

  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
      }),
    [],
  )

  const updateStageMutation = useMutation({
    mutationFn: async ({ id, pipelineStageId }: { id: string; pipelineStageId: string }) => {
      await apiCallOrThrow(
        '/api/customers/deals',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, pipelineStageId }),
        },
        { errorMessage: translate('customers.deals.pipeline.moveError', 'Failed to update deal stage.') },
      )
      return { id, pipelineStageId }
    },
    onMutate: async ({ id, pipelineStageId }) => {
      setPendingDealId(id)
      await queryClient.cancelQueries({ queryKey: dealsKey })
      const previous = queryClient.getQueryData<DealsQueryData>(dealsKey)
      if (previous) {
        const nextDeals = previous.deals.map((deal) =>
          deal.id === id ? { ...deal, pipelineStageId } : deal,
        )
        queryClient.setQueryData<DealsQueryData>(dealsKey, { ...previous, deals: nextDeals })
      }
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData<DealsQueryData>(dealsKey, context.previous)
      }
      const message =
        error instanceof Error && error.message
          ? error.message
          : translate('customers.deals.pipeline.moveError', 'Failed to update deal stage.')
      flash(message, 'error')
    },
    onSuccess: () => {
      flash(translate('customers.deals.pipeline.moveSuccess', 'Deal updated.'), 'success')
    },
    onSettled: () => {
      setPendingDealId(null)
      queryClient.invalidateQueries({ queryKey: dealsKey }).catch(() => {})
    },
  })

  const createDealMutation = useMutation({
    mutationFn: async (payload: { title: string; valueAmount?: number; pipelineId: string; pipelineStageId: string }) => {
      await apiCallOrThrow(
        '/api/customers/deals',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
        { errorMessage: translate('customers.deals.pipeline.createError', 'Failed to create deal.') },
      )
    },
    onSuccess: () => {
      flash(translate('customers.deals.pipeline.createSuccess', 'Deal created.'), 'success')
      setInlineFormStageId(null)
      setInlineTitle('')
      setInlineValue('')
      queryClient.invalidateQueries({ queryKey: dealsKey }).catch(() => {})
    },
    onError: (error) => {
      const message =
        error instanceof Error && error.message
          ? error.message
          : translate('customers.deals.pipeline.createError', 'Failed to create deal.')
      flash(message, 'error')
    },
  })

  const toggleStageCollapse = React.useCallback((stageId: string) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev)
      if (next.has(stageId)) {
        next.delete(stageId)
      } else {
        next.add(stageId)
      }
      return next
    })
  }, [])

  const openInlineForm = React.useCallback((stageId: string) => {
    setInlineFormStageId(stageId)
    setInlineTitle('')
    setInlineValue('')
  }, [])

  const cancelInlineForm = React.useCallback(() => {
    setInlineFormStageId(null)
    setInlineTitle('')
    setInlineValue('')
  }, [])

  const submitInlineForm = React.useCallback(() => {
    const trimmedTitle = inlineTitle.trim()
    if (!trimmedTitle || !selectedPipelineId || !inlineFormStageId) return
    const payload: { title: string; valueAmount?: number; pipelineId: string; pipelineStageId: string } = {
      title: trimmedTitle,
      pipelineId: selectedPipelineId,
      pipelineStageId: inlineFormStageId,
    }
    const parsedValue = normalizeAmount(inlineValue)
    if (parsedValue !== null && parsedValue >= 0) {
      payload.valueAmount = parsedValue
    }
    createDealMutation.mutate(payload)
  }, [inlineTitle, inlineValue, selectedPipelineId, inlineFormStageId, createDealMutation])

  const handleFilterChange = React.useCallback((field: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }))
  }, [])

  const clearFilters = React.useCallback(() => {
    setFilters(EMPTY_FILTERS)
  }, [])

  const hasActiveFilters = React.useMemo(() => {
    return Object.values(filters).some((value) => value.trim().length > 0)
  }, [filters])

  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [activeLane, setActiveLane] = React.useState<string | null>(null)
  const handleActionClick = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
  }, [])

  const handleSortChange = React.useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value
    if (sortOptions.includes(value as SortOption)) setSortBy(value as SortOption)
  }, [])

  const handleDragStart = React.useCallback((dealId: string) => {
    setDraggingId(dealId)
  }, [])

  const handleDragEnd = React.useCallback(() => {
    setDraggingId(null)
    setActiveLane(null)
  }, [])

  const handleDrop = React.useCallback(
    (stage: StageDefinition) => async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setActiveLane(null)
      const dealId = event.dataTransfer.getData('text/plain') || draggingId
      if (!dealId) return
      const deal = dealMap.get(dealId)
      if (!deal) return
      if (stage.value === null) {
        flash(
          translate('customers.deals.pipeline.unassignedDisabled', 'Moving to "No stage" is not supported.'),
          'info',
        )
        return
      }
      if (deal.pipelineStageId === stage.value) return
      updateStageMutation.mutate({ id: dealId, pipelineStageId: stage.value })
    },
    [dealMap, draggingId, translate, updateStageMutation],
  )

  const handleDragOver = React.useCallback(
    (stageId: string) => (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (activeLane !== stageId) setActiveLane(stageId)
    },
    [activeLane],
  )

  const renderLaneHeader = (stage: StageDefinition, laneDeals: DealRecord[], isCollapsed: boolean) => {
    const count = laneDeals.length
    const laneTotal = computeLaneTotalValue(laneDeals)
    const defaultCurrency = laneDeals.find((d) => d.valueCurrency)?.valueCurrency ?? null
    const totalLabel = laneTotal > 0
      ? formatCurrency(laneTotal, defaultCurrency, '')
      : null
    return (
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => toggleStageCollapse(stage.id)}
            title={isCollapsed
              ? translate('customers.deals.pipeline.expand', 'Expand')
              : translate('customers.deals.pipeline.collapse', 'Collapse')
            }
          >
            {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{stage.label}</span>
            <span className="text-xs text-muted-foreground">
              {translate('customers.deals.pipeline.countLabel', 'Deals: {count}', { count })}
              {totalLabel ? ` \u00B7 ${totalLabel}` : ''}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col">
              <h1 className="text-xl font-semibold text-foreground">
                {translate('customers.deals.pipeline.title', 'Sales Pipeline')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {translate(
                  'customers.deals.pipeline.subtitle',
                  'Track deals by pipeline stage and drag them between lanes to update progress.',
                )}
              </p>
            </div>
            <div className="flex items-center gap-4">
              {pipelinesQuery.data && pipelinesQuery.data.length > 0 ? (
                <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <span>{translate('customers.deals.pipeline.switch.label', 'Pipeline')}</span>
                  <select
                    className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    value={selectedPipelineId ?? ''}
                    onChange={(e) => setSelectedPipelineId(e.target.value || null)}
                  >
                    {pipelinesQuery.data.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <Link
                href="/backend/config/customers/pipeline-stages"
                className="text-sm font-medium text-primary hover:underline"
              >
                {translate('customers.deals.pipeline.manageStages', 'Manage stages')}
              </Link>
              <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span>{translate('customers.deals.pipeline.sort.label', 'Sort by')}</span>
                <select
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  value={sortBy}
                  onChange={handleSortChange}
                >
                  <option value="probability">
                    {translate('customers.deals.pipeline.sort.probability', 'Probability (high to low)')}
                  </option>
                  <option value="createdAt">
                    {translate('customers.deals.pipeline.sort.createdAt', 'Created (newest first)')}
                  </option>
                  <option value="expectedCloseAt">
                    {translate('customers.deals.pipeline.sort.expectedCloseAt', 'Expected close (soonest first)')}
                  </option>
                  <option value="value">
                    {translate('customers.deals.pipeline.sort.value', 'Value (high to low)')}
                  </option>
                  <option value="age">
                    {translate('customers.deals.pipeline.sort.age', 'Age (oldest first)')}
                  </option>
                </select>
              </label>
            </div>
          </div>

          {selectedPipelineId && !dealsQuery.isLoading ? (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {translate('customers.deals.pipeline.filter.ownerSearch', 'Search')}
                </label>
                <input
                  type="text"
                  className="h-8 w-40 rounded-md border border-border bg-background px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  placeholder={translate('customers.deals.pipeline.filter.ownerSearchPlaceholder', 'Title, person, company...')}
                  value={filters.ownerSearch}
                  onChange={(event) => handleFilterChange('ownerSearch', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {translate('customers.deals.pipeline.filter.valueMin', 'Value min')}
                </label>
                <input
                  type="number"
                  min={0}
                  className="h-8 w-28 rounded-md border border-border bg-background px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  placeholder="0"
                  value={filters.valueMin}
                  onChange={(event) => handleFilterChange('valueMin', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {translate('customers.deals.pipeline.filter.valueMax', 'Value max')}
                </label>
                <input
                  type="number"
                  min={0}
                  className="h-8 w-28 rounded-md border border-border bg-background px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  placeholder="--"
                  value={filters.valueMax}
                  onChange={(event) => handleFilterChange('valueMax', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {translate('customers.deals.pipeline.filter.closeDateFrom', 'Close from')}
                </label>
                <input
                  type="date"
                  className="h-8 w-36 rounded-md border border-border bg-background px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  value={filters.closeDateFrom}
                  onChange={(event) => handleFilterChange('closeDateFrom', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {translate('customers.deals.pipeline.filter.closeDateTo', 'Close to')}
                </label>
                <input
                  type="date"
                  className="h-8 w-36 rounded-md border border-border bg-background px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  value={filters.closeDateTo}
                  onChange={(event) => handleFilterChange('closeDateTo', event.target.value)}
                />
              </div>
              {hasActiveFilters ? (
                <button
                  type="button"
                  className="flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                  onClick={clearFilters}
                >
                  <X className="size-3" />
                  {translate('customers.deals.pipeline.filter.clear', 'Clear')}
                </button>
              ) : null}
            </div>
          ) : null}

          {!selectedPipelineId ? (
            <div className="flex h-[50vh] items-center justify-center">
              <span className="text-sm text-muted-foreground">
                {translate('customers.deals.pipeline.noPipeline', 'No pipeline selected. Create a pipeline in settings.')}
              </span>
            </div>
          ) : dealsQuery.isLoading ? (
            <div className="flex h-[50vh] items-center justify-center">
              <Spinner />
            </div>
          ) : dealsQuery.isError ? (
            <div className="max-w-xl">
              <ErrorNotice
                message={
                  dealsQuery.error instanceof Error
                    ? dealsQuery.error.message
                    : translate('customers.deals.pipeline.loadError', 'Failed to load deals.')
                }
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {(() => {
                const totalValue = deals.reduce((sum, d) => sum + (d.valueAmount ?? 0), 0)
                const weightedValue = deals.reduce((sum, d) => sum + (d.valueAmount ?? 0) * ((d.probability ?? 0) / 100), 0)
                const wonDeals = deals.filter((d) => d.status === 'win' || d.status === 'won')
                const lostDeals = deals.filter((d) => d.status === 'loose' || d.status === 'lost')
                const defaultCurrency = deals.find((d) => d.valueCurrency)?.valueCurrency ?? null
                const closedCount = wonDeals.length + lostDeals.length
                const convRate = closedCount > 0 ? Math.round((wonDeals.length / closedCount) * 100) : 0
                return (
                  <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">{translate('customers.deals.pipeline.metrics.totalDeals', 'Total deals')}</span>
                      <span className="font-semibold text-foreground">{deals.length}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">{translate('customers.deals.pipeline.metrics.totalValue', 'Total value')}</span>
                      <span className="font-semibold text-foreground">{formatCurrency(totalValue, defaultCurrency, '-')}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">{translate('customers.deals.pipeline.metrics.weightedValue', 'Weighted value')}</span>
                      <span className="font-semibold text-foreground">{formatCurrency(weightedValue, defaultCurrency, '-')}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">{translate('customers.deals.pipeline.metrics.wonLost', 'Won / Lost')}</span>
                      <span className="font-semibold text-foreground">{wonDeals.length} / {lostDeals.length}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">{translate('customers.deals.pipeline.metrics.conversionRate', 'Conversion rate')}</span>
                      <span className="font-semibold text-foreground">{convRate}%</span>
                    </div>
                  </div>
                )
              })()}

              {total > allDeals.length ? (
                <div className="rounded-md border border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
                  {translate(
                    'customers.deals.pipeline.limitNotice',
                    'Showing the first {count} deals. Refine your filters to see more.',
                    { count: allDeals.length },
                  )}
                </div>
              ) : null}

              {hasActiveFilters && deals.length !== allDeals.length ? (
                <div className="rounded-md border border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
                  {translate(
                    'customers.deals.pipeline.filterNotice',
                    'Showing {filtered} of {total} deals matching your filters.',
                    { filtered: deals.length, total: allDeals.length },
                  )}
                </div>
              ) : null}

              <div className="flex flex-col gap-4 pb-6 md:flex-row md:overflow-x-auto">
                {stages.length === 0 ? (
                  <div className="flex h-[50vh] w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/20">
                    <span className="text-sm text-muted-foreground">
                      {translate('customers.deals.pipeline.noStages', 'Define pipeline stages to start tracking deals.')}
                    </span>
                  </div>
                ) : (
                  stages.map((stage) => {
                    const stageKey = stage.value ?? null
                    const laneDeals = groupedDeals.get(stageKey) ?? []
                    const sortedLaneDeals = sortDeals(laneDeals, sortBy)
                    const isActive = activeLane === stage.id
                    const isCollapsed = collapsedStages.has(stage.id)
                    const isUnassigned = stage.value === null
                    const showInlineForm = inlineFormStageId === stage.value && !isUnassigned
                    return (
                      <div
                        key={stage.id}
                        className={`flex w-full flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all md:w-72 md:flex-none ${
                          isCollapsed ? '' : 'min-h-[60vh]'
                        } ${isActive ? 'ring-2 ring-ring/40' : ''}`}
                        onDragOver={handleDragOver(stage.id)}
                        onDrop={handleDrop(stage)}
                      >
                        {renderLaneHeader(stage, laneDeals, isCollapsed)}
                        {!isCollapsed ? (
                          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
                            {sortedLaneDeals.length === 0 ? (
                              <div className="rounded-md border border-dashed border-border bg-muted/10 p-4 text-center text-xs text-muted-foreground">
                                {translate('customers.deals.pipeline.emptyLane', 'No deals in this stage yet.')}
                              </div>
                            ) : (
                              sortedLaneDeals.map((deal) => {
                                const isDragging = draggingId === deal.id
                                  || (pendingDealId === deal.id && updateStageMutation.isPending)
                                const valueLabel = formatCurrency(
                                  deal.valueAmount,
                                  deal.valueCurrency,
                                  translate('customers.deals.list.noValue', 'No value assigned'),
                                )
                                const probabilityLabel = formatProbability(
                                  deal.probability,
                                  translate('customers.deals.pipeline.noProbability', 'N/A'),
                                )
                                const expectedLabel = deal.expectedCloseAt
                                  ? dateFormatter.format(new Date(deal.expectedCloseAt))
                                  : translate('customers.deals.pipeline.noExpectedClose', 'No date')
                                return (
                                  <div
                                    key={deal.id}
                                    className={`group flex cursor-grab flex-col gap-2 rounded-md border border-border bg-background p-4 shadow-xs transition ${
                                      isDragging ? 'opacity-50' : 'hover:shadow-sm'
                                    }`}
                                    draggable
                                    onDragStart={(event) => {
                                      event.dataTransfer.effectAllowed = 'move'
                                      event.dataTransfer.setData('text/plain', deal.id)
                                      handleDragStart(deal.id)
                                    }}
                                    onDragEnd={handleDragEnd}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex flex-col">
                                        <span className="line-clamp-2 text-sm font-medium text-foreground">
                                          {deal.title}
                                        </span>
                                        {deal.status ? (
                                          <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                            {deal.status}
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="flex items-center gap-1">
                                        {(() => {
                                          const ageDays = computeDealAgeDays(deal)
                                          const badge = getDealAgeBadge(ageDays)
                                          if (!badge) return null
                                          return (
                                            <span
                                              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                                              title={translate('customers.deals.pipeline.card.ageTooltip', '{days} days in current stage', { days: ageDays })}
                                            >
                                              {badge.label}
                                            </span>
                                          )
                                        })()}
                                        {pendingDealId === deal.id && updateStageMutation.isPending ? (
                                          <Spinner className="size-4" />
                                        ) : null}
                                      </div>
                                    </div>
                                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                                      <div className="flex items-center justify-between gap-2">
                                        <span>{translate('customers.deals.pipeline.card.value', 'Value')}</span>
                                        <span className="font-medium text-foreground">{valueLabel}</span>
                                      </div>
                                      <div className="flex items-center justify-between gap-2">
                                        <span>{translate('customers.deals.pipeline.card.probability', 'Probability')}</span>
                                        <span className="font-medium text-foreground">{probabilityLabel}</span>
                                      </div>
                                      <div className="flex items-center justify-between gap-2">
                                        <span>{translate('customers.deals.pipeline.card.expectedClose', 'Expected close')}</span>
                                        <span className="font-medium text-foreground">{expectedLabel}</span>
                                      </div>
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                                      <Link
                                        href={`/backend/customers/deals/${deal.id}`}
                                        className="font-medium text-primary hover:underline"
                                        draggable={false}
                                        onClick={handleActionClick}
                                      >
                                        {translate('customers.deals.pipeline.actions.openDeal', 'Open deal')}
                                      </Link>
                                    </div>
                                    {deal.people.length ? (
                                      <div className="flex flex-wrap gap-2">
                                        {deal.people.map((person) => (
                                          <Link
                                            key={person.id}
                                            className="rounded-full bg-primary/5 px-3 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
                                            href={`/backend/customers/people/${person.id}`}
                                            draggable={false}
                                            onClick={handleActionClick}
                                          >
                                            {person.label}
                                          </Link>
                                        ))}
                                      </div>
                                    ) : null}
                                    {deal.companies.length ? (
                                      <div className="flex flex-wrap gap-2">
                                        {deal.companies.map((company) => (
                                          <Link
                                            key={company.id}
                                            className="rounded-full bg-secondary/10 px-3 py-1 text-xs text-secondary-foreground transition-colors hover:bg-secondary/20"
                                            href={`/backend/customers/companies/${company.id}`}
                                            draggable={false}
                                            onClick={handleActionClick}
                                          >
                                            {company.label}
                                          </Link>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                )
                              })
                            )}
                            {showInlineForm ? (
                              <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/10 p-3">
                                <input
                                  type="text"
                                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                  placeholder={translate('customers.deals.pipeline.inlineForm.titlePlaceholder', 'Deal title')}
                                  value={inlineTitle}
                                  onChange={(event) => setInlineTitle(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                      submitInlineForm()
                                    }
                                    if (event.key === 'Escape') {
                                      cancelInlineForm()
                                    }
                                  }}
                                  autoFocus
                                />
                                <input
                                  type="number"
                                  min={0}
                                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                  placeholder={translate('customers.deals.pipeline.inlineForm.valuePlaceholder', 'Value (optional)')}
                                  value={inlineValue}
                                  onChange={(event) => setInlineValue(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                      submitInlineForm()
                                    }
                                    if (event.key === 'Escape') {
                                      cancelInlineForm()
                                    }
                                  }}
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className="h-7 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
                                    disabled={!inlineTitle.trim() || createDealMutation.isPending}
                                    onClick={submitInlineForm}
                                  >
                                    {createDealMutation.isPending
                                      ? translate('customers.deals.pipeline.inlineForm.creating', 'Creating...')
                                      : translate('customers.deals.pipeline.inlineForm.submit', 'Create')}
                                  </button>
                                  <button
                                    type="button"
                                    className="h-7 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                                    onClick={cancelInlineForm}
                                    disabled={createDealMutation.isPending}
                                  >
                                    {translate('customers.deals.pipeline.inlineForm.cancel', 'Cancel')}
                                  </button>
                                </div>
                              </div>
                            ) : null}
                            {!isUnassigned && !showInlineForm ? (
                              <button
                                type="button"
                                className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/30 hover:text-foreground"
                                onClick={() => openInlineForm(stage.value!)}
                              >
                                <Plus className="size-3.5" />
                                {translate('customers.deals.pipeline.addDeal', 'Add deal')}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
