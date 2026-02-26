"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

type SortOption = 'probability' | 'createdAt' | 'expectedCloseAt'

type PipelineRecord = { id: string; name: string; isDefault: boolean }
type PipelineStageRecord = { id: string; label: string; order: number; pipelineId: string }

const DEALS_QUERY_LIMIT = 100

const dealsQueryKey = (scopeVersion: number, pipelineId: string | null) =>
  ['customers', 'deals', 'pipeline', `scope:${scopeVersion}`, `pipeline:${pipelineId ?? 'none'}`] as const

const sortOptions: SortOption[] = ['probability', 'createdAt', 'expectedCloseAt']

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
    const at = typeof a.createdAtTs === 'number' ? a.createdAtTs : Number.NEGATIVE_INFINITY
    const bt = typeof b.createdAtTs === 'number' ? b.createdAtTs : Number.NEGATIVE_INFINITY
    if (option === 'createdAt') {
      if (at !== bt) return bt - at
    } else if (option === 'expectedCloseAt' || option === 'probability') {
      if (at !== bt) return bt - at
    }
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  })
  return sorted
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
          people,
          companies,
        })
      })

      const total = typeof payload?.total === 'number' ? payload.total : deals.length
      return { deals, total }
    },
  })

  const deals = dealsQuery.data?.deals ?? []
  const total = dealsQuery.data?.total ?? deals.length
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

  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [activeLane, setActiveLane] = React.useState<string | null>(null)
  const handleActionClick = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
  }, [])

  const handleSortChange = React.useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value as SortOption
    if (sortOptions.includes(value)) setSortBy(value)
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

  const renderLaneHeader = (stage: StageDefinition, count: number) => {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{stage.label}</span>
            <span className="text-xs text-muted-foreground">
              {translate('customers.deals.pipeline.countLabel', 'Deals: {count}', { count })}
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
                </select>
              </label>
            </div>
          </div>

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
              {total > deals.length ? (
                <div className="rounded-md border border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
                  {translate(
                    'customers.deals.pipeline.limitNotice',
                    'Showing the first {count} deals. Refine your filters to see more.',
                    { count: deals.length },
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
                    return (
                      <div
                        key={stage.id}
                        className={`flex min-h-[60vh] w-full flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all md:w-72 md:flex-none ${
                          isActive ? 'ring-2 ring-ring/40' : ''
                        }`}
                        onDragOver={handleDragOver(stage.id)}
                        onDrop={handleDrop(stage)}
                      >
                        {renderLaneHeader(stage, laneDeals.length)}
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
                                    {pendingDealId === deal.id && updateStageMutation.isPending ? (
                                      <Spinner className="size-4" />
                                    ) : null}
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
                        </div>
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
