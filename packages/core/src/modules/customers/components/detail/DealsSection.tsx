"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRightSquare, Loader2, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import type { DealSummary, SectionAction, TabEmptyState, Translator } from './types'
import { formatDate } from './utils'
import { DealDialog } from './DealDialog'
import type { DealFormBaseValues, DealFormSubmitPayload } from './DealForm'
import { generateTempId } from '@open-mercato/core/modules/customers/lib/detailHelpers'

const DEALS_PAGE_SIZE = 10

type DealsScope =
  | { kind: 'person'; entityId: string }
  | { kind: 'company'; entityId: string }

type PendingAction =
  | { kind: 'create' }
  | { kind: 'update'; id: string }
  | { kind: 'delete'; id: string }

type NormalizedDeal = DealSummary & {
  customValues: Record<string, unknown> | null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) return null
    const parsed = Number(trimmed)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function toIso(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) return null
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  return null
}

function mergeIds(...sources: Array<unknown>): string[] {
  const set = new Set<string>()
  sources.forEach((source) => {
    if (Array.isArray(source)) {
      source.forEach((value) => {
        if (typeof value !== 'string') return
        const trimmed = value.trim()
        if (!trimmed.length) return
        set.add(trimmed)
      })
    }
  })
  return Array.from(set)
}

function normalizeDeal(deal: Partial<DealSummary> & { id: string; title?: string }): NormalizedDeal {
  const title = typeof deal.title === 'string' && deal.title.trim().length ? deal.title.trim() : ''
  const normalizeIdList = (list: unknown): string[] => {
    if (!Array.isArray(list)) return []
    const seen = new Set<string>()
    const result: string[] = []
    list.forEach((candidate) => {
      if (typeof candidate !== 'string') return
      const trimmed = candidate.trim()
      if (!trimmed.length || seen.has(trimmed)) return
      seen.add(trimmed)
      result.push(trimmed)
    })
    return result
  }

  const normalizeAssignees = (entries: unknown, fallbackIds: string[]): { id: string; label: string }[] => {
    if (!Array.isArray(entries)) {
      return fallbackIds.map((id) => ({ id, label: '' }))
    }
    const seen = new Set<string>()
    const resolved: { id: string; label: string }[] = []
    entries.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const data = entry as Record<string, unknown>
      const id = typeof data.id === 'string' ? data.id.trim() : ''
      if (!id || seen.has(id)) return
      const label = typeof data.label === 'string' ? data.label : ''
      seen.add(id)
      resolved.push({ id, label })
    })
    if (!resolved.length && fallbackIds.length) {
      return fallbackIds.map((id) => ({ id, label: '' }))
    }
    return resolved
  }

  const personIds = normalizeIdList(deal.personIds ?? null)
  const companyIds = normalizeIdList(deal.companyIds ?? null)
  const people = normalizeAssignees(deal.people ?? null, personIds)
  const companies = normalizeAssignees(deal.companies ?? null, companyIds)

  return {
    id: deal.id,
    title,
    status: typeof deal.status === 'string' ? deal.status : deal.status ?? null,
    pipelineStage:
      typeof deal.pipelineStage === 'string' ? deal.pipelineStage : deal.pipelineStage ?? null,
    valueAmount: toNumber(deal.valueAmount ?? null),
    valueCurrency:
      typeof deal.valueCurrency === 'string' && deal.valueCurrency.trim().length
        ? deal.valueCurrency.trim().toUpperCase()
        : null,
    probability: toNumber(deal.probability ?? null),
    expectedCloseAt: toIso(deal.expectedCloseAt ?? null),
    description:
      typeof deal.description === 'string' && deal.description.trim().length
        ? deal.description
        : deal.description ?? null,
    ownerUserId:
      typeof deal.ownerUserId === 'string' && deal.ownerUserId.trim().length
        ? deal.ownerUserId
        : deal.ownerUserId ?? null,
    source:
      typeof deal.source === 'string' && deal.source.trim().length ? deal.source : deal.source ?? null,
    createdAt: toIso(deal.createdAt ?? null),
    updatedAt: toIso(deal.updatedAt ?? null),
    personIds,
    companyIds,
    people,
    companies,
    customValues: (deal.customValues as Record<string, unknown> | null | undefined) ?? null,
  }
}

function buildInitialValues(deal: NormalizedDeal): Partial<DealFormBaseValues & Record<string, unknown>> {
  const base: Partial<DealFormBaseValues & Record<string, unknown>> = {
    title: deal.title,
    status: deal.status ?? '',
    pipelineStage: deal.pipelineStage ?? '',
    valueAmount: deal.valueAmount ?? null,
    valueCurrency: deal.valueCurrency ?? '',
    probability: deal.probability ?? null,
    expectedCloseAt: deal.expectedCloseAt ?? null,
    description: deal.description ?? '',
    personIds: Array.isArray(deal.personIds) ? deal.personIds : [],
    companyIds: Array.isArray(deal.companyIds) ? deal.companyIds : [],
  }
  if (deal.customValues) {
    for (const [key, value] of Object.entries(deal.customValues)) {
      base[`cf_${key}`] = value
    }
  }
  return base
}

function formatValueLabel(amount: number | null, currency: string | null, emptyLabel: string): string {
  if (typeof amount === 'number') {
    const formatter = new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency ?? undefined,
      maximumFractionDigits: 2,
    })
    try {
      return formatter.format(amount)
    } catch {
      return currency ? `${amount} ${currency}` : `${amount}`
    }
  }
  return emptyLabel
}

export type DealsSectionProps = {
  scope: DealsScope | null
  addActionLabel: string
  emptyLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  onLoadingChange?: (isLoading: boolean) => void
  translator?: Translator
}

export function DealsSection({
  scope,
  addActionLabel,
  emptyLabel,
  emptyState,
  onActionChange,
  onLoadingChange,
  translator,
}: DealsSectionProps) {
  const tHook = useT()
  const t: Translator = React.useMemo(
    () =>
      translator ??
      ((key, fallback) => {
        const value = tHook(key)
        return value === key && fallback ? fallback : value
      }),
    [translator, tHook],
  )

  const [deals, setDeals] = React.useState<NormalizedDeal[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [pendingAction, setPendingAction] = React.useState<PendingAction | null>(null)
  const [hasMore, setHasMore] = React.useState(false)
  const pageRef = React.useRef(0)
  const hasMoreRef = React.useRef(true)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogMode, setDialogMode] = React.useState<'create' | 'edit'>('create')
  const [editingDealId, setEditingDealId] = React.useState<string | null>(null)
  const [initialValues, setInitialValues] = React.useState<
    Partial<DealFormBaseValues & Record<string, unknown>> | undefined
  >(undefined)
  const pendingCounterRef = React.useRef(0)

  const pushLoading = React.useCallback(() => {
    pendingCounterRef.current += 1
    if (pendingCounterRef.current === 1) onLoadingChange?.(true)
  }, [onLoadingChange])

  const popLoading = React.useCallback(() => {
    pendingCounterRef.current = Math.max(0, pendingCounterRef.current - 1)
    if (pendingCounterRef.current === 0) onLoadingChange?.(false)
  }, [onLoadingChange])

  const translate = React.useCallback(
    (key: string, fallback: string) => {
      const value = t(key)
      return value === key ? fallback : value
    },
    [t],
  )

  const loadDeals = React.useCallback(async ({ append }: { append: boolean }) => {
    if (!scope) {
      setDeals([])
      setLoadError(null)
      setHasMore(false)
      pageRef.current = 0
      hasMoreRef.current = false
      return
    }
    if (append && !hasMoreRef.current) return
    const nextPage = append ? pageRef.current + 1 : 1
    if (!append) {
      pageRef.current = 0
      hasMoreRef.current = true
      setHasMore(true)
      setDeals([])
    }
    pushLoading()
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(DEALS_PAGE_SIZE),
        sortField: 'updatedAt',
        sortDir: 'desc',
      })
      if (scope.kind === 'person') params.set('personEntityId', scope.entityId)
      if (scope.kind === 'company') params.set('companyEntityId', scope.entityId)
      const res = await apiFetch(`/api/customers/deals?${params.toString()}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : translate('customers.people.detail.deals.loadError', 'Failed to load deals.')
        throw new Error(message)
      }
      const rawItems = Array.isArray(payload?.items) ? payload.items : []
      const mapped = rawItems.map((item) => {
        const record = (item && typeof item === 'object') ? (item as Record<string, unknown>) : {}
        const id =
          typeof record.id === 'string' && record.id.trim().length ? record.id : generateTempId()
        const title =
          typeof record.title === 'string' && record.title.trim().length ? record.title.trim() : ''
        const status =
          typeof record.status === 'string' && record.status.trim().length
            ? record.status.trim()
            : null
        const pipelineStage =
          typeof record.pipelineStage === 'string' && record.pipelineStage.trim().length
            ? record.pipelineStage.trim()
            : typeof record.pipeline_stage === 'string' && record.pipeline_stage.trim().length
              ? record.pipeline_stage.trim()
              : null
        const valueAmount = record.valueAmount ?? record.value_amount ?? null
        const valueCurrencyRaw = record.valueCurrency ?? record.value_currency ?? null
        const valueCurrency =
          typeof valueCurrencyRaw === 'string' && valueCurrencyRaw.trim().length
            ? valueCurrencyRaw.trim().toUpperCase()
            : null
        const probability = record.probability ?? null
        const expectedCloseAt =
          typeof record.expectedCloseAt === 'string' && record.expectedCloseAt.trim().length
            ? record.expectedCloseAt
            : typeof record.expected_close_at === 'string' && record.expected_close_at.trim().length
              ? record.expected_close_at
              : null
        const description =
          typeof record.description === 'string' && record.description.trim().length
            ? record.description
            : null
        const ownerUserId =
          typeof record.ownerUserId === 'string' && record.ownerUserId.trim().length
            ? record.ownerUserId
            : typeof record.owner_user_id === 'string' && record.owner_user_id.trim().length
              ? record.owner_user_id
              : null
        const source =
          typeof record.source === 'string' && record.source.trim().length
            ? record.source
            : null
        const createdAt =
          typeof record.createdAt === 'string' && record.createdAt.trim().length
            ? record.createdAt
            : typeof record.created_at === 'string' && record.created_at.trim().length
              ? record.created_at
              : null
        const updatedAt =
          typeof record.updatedAt === 'string' && record.updatedAt.trim().length
            ? record.updatedAt
            : typeof record.updated_at === 'string' && record.updated_at.trim().length
              ? record.updated_at
              : null
        const personIds = Array.isArray(record.personIds)
          ? record.personIds
          : Array.isArray(record.person_ids)
            ? record.person_ids
            : []
        const people = Array.isArray(record.people) ? record.people : []
        const companyIds = Array.isArray(record.companyIds)
          ? record.companyIds
          : Array.isArray(record.company_ids)
            ? record.company_ids
            : []
        const companies = Array.isArray(record.companies) ? record.companies : []
        return normalizeDeal({
          id,
          title,
          status,
          pipelineStage,
          valueAmount: valueAmount as number | string | null,
          valueCurrency,
          probability: probability as number | string | null,
          expectedCloseAt,
          description,
          ownerUserId,
          source,
          createdAt,
          updatedAt,
          personIds: personIds as string[] | undefined,
          people: people as { id: string; label: string }[] | undefined,
          companyIds: companyIds as string[] | undefined,
          companies: companies as { id: string; label: string }[] | undefined,
        })
      })
      setDeals((prev) => {
        if (!append) return mapped
        const mappedById = new Map(mapped.map((deal) => [deal.id, deal]))
        const prevIds = new Set(prev.map((deal) => deal.id))
        const updatedPrev = prev.map((deal) => mappedById.get(deal.id) ?? deal)
        const appended = mapped.filter((deal) => !prevIds.has(deal.id))
        return [...updatedPrev, ...appended]
      })
      pageRef.current = nextPage
      const totalPagesRaw = payload?.totalPages
      const totalPages =
        typeof totalPagesRaw === 'number'
          ? totalPagesRaw
          : typeof totalPagesRaw === 'string' && totalPagesRaw.trim().length
            ? Number(totalPagesRaw)
            : null
      const nextHasMore =
        totalPages && Number.isFinite(totalPages)
          ? nextPage < totalPages
          : mapped.length === DEALS_PAGE_SIZE
      hasMoreRef.current = nextHasMore
      setHasMore(nextHasMore)
      setLoadError(null)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : translate('customers.people.detail.deals.loadError', 'Failed to load deals.')
      setLoadError(message)
      if (!append) {
        setHasMore(false)
        hasMoreRef.current = false
      }
    } finally {
      setIsLoading(false)
      popLoading()
    }
  }, [popLoading, pushLoading, scope, translate])

  React.useEffect(() => {
    loadDeals({ append: false }).catch(() => {})
  }, [loadDeals, scope])

  const openCreateDialog = React.useCallback(() => {
    if (!scope) return
    setDialogMode('create')
    setEditingDealId(null)
    setInitialValues(undefined)
    setDialogOpen(true)
  }, [scope])

  const openEditDialog = React.useCallback(
    (deal: NormalizedDeal) => {
      setDialogMode('edit')
      setEditingDealId(deal.id)
      setInitialValues(buildInitialValues(deal))
      setDialogOpen(true)
    },
    [],
  )

  const closeDialog = React.useCallback(() => {
    setDialogOpen(false)
    setDialogMode('create')
    setEditingDealId(null)
    setInitialValues(undefined)
  }, [])

  const handleDialogOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) closeDialog()
      else setDialogOpen(true)
    },
    [closeDialog],
  )

  const handleCreate = React.useCallback(
    async ({ base, custom }: DealFormSubmitPayload) => {
      if (!scope) {
        throw new Error(translate('customers.people.detail.deals.error', 'Failed to save deal.'))
      }
      setPendingAction({ kind: 'create' })
      pushLoading()
      try {
        const personIds = mergeIds(base.personIds, scope.kind === 'person' ? [scope.entityId] : [])
        const companyIds = mergeIds(base.companyIds, scope.kind === 'company' ? [scope.entityId] : [])

        const payload: Record<string, unknown> = {
          title: base.title,
          status: base.status ?? undefined,
          pipelineStage: base.pipelineStage ?? undefined,
          valueAmount: typeof base.valueAmount === 'number' ? base.valueAmount : undefined,
          valueCurrency: base.valueCurrency ?? undefined,
          probability: typeof base.probability === 'number' ? base.probability : undefined,
          expectedCloseAt: base.expectedCloseAt ?? undefined,
          description: base.description ?? undefined,
          personIds,
          companyIds,
        }
        if (Object.keys(custom).length) payload.customFields = custom
        const res = await apiFetch('/api/customers/deals', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const responseBody = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof responseBody?.error === 'string'
              ? responseBody.error
              : translate('customers.people.detail.deals.error', 'Failed to save deal.')
          throw new Error(message)
        }
        const dealId =
          typeof responseBody?.id === 'string' && responseBody.id.trim().length
            ? responseBody.id
            : generateTempId()
        const normalized = normalizeDeal({
          id: dealId,
          title: base.title,
          status: base.status ?? null,
          pipelineStage: base.pipelineStage ?? null,
          valueAmount: base.valueAmount ?? null,
          valueCurrency: base.valueCurrency ?? null,
          probability: base.probability ?? null,
          expectedCloseAt: base.expectedCloseAt ?? null,
          description: base.description ?? null,
          personIds,
          companyIds,
          customValues: Object.keys(custom).length ? custom : null,
        })
        setDeals((prev) => [normalized, ...prev])
        flash(translate('customers.people.detail.deals.success', 'Deal created.'), 'success')
      } finally {
        setPendingAction(null)
        popLoading()
      }
    },
    [popLoading, pushLoading, scope, translate],
  )

  const handleUpdate = React.useCallback(
    async (dealId: string, { base, custom }: DealFormSubmitPayload) => {
      if (!scope) {
        throw new Error(translate('customers.people.detail.deals.error', 'Failed to save deal.'))
      }
      setPendingAction({ kind: 'update', id: dealId })
      pushLoading()
      try {
        const personIds = mergeIds(base.personIds, scope.kind === 'person' ? [scope.entityId] : [])
        const companyIds = mergeIds(base.companyIds, scope.kind === 'company' ? [scope.entityId] : [])

        const payload: Record<string, unknown> = {
          id: dealId,
          title: base.title,
          status: base.status ?? undefined,
          pipelineStage: base.pipelineStage ?? undefined,
          valueAmount: typeof base.valueAmount === 'number' ? base.valueAmount : undefined,
          valueCurrency: base.valueCurrency ?? undefined,
          probability: typeof base.probability === 'number' ? base.probability : undefined,
          expectedCloseAt: base.expectedCloseAt ?? undefined,
          description: base.description ?? undefined,
          personIds,
          companyIds,
        }
        if (Object.keys(custom).length) payload.customFields = custom
        const res = await apiFetch('/api/customers/deals', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const responseBody = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof responseBody?.error === 'string'
              ? responseBody.error
              : translate('customers.people.detail.deals.error', 'Failed to save deal.')
          throw new Error(message)
        }
        setDeals((prev) =>
          prev.map((deal) =>
            deal.id === dealId
              ? normalizeDeal({
                  ...deal,
                  title: base.title,
                  status: base.status ?? null,
                  pipelineStage: base.pipelineStage ?? null,
                  valueAmount: base.valueAmount ?? null,
                  valueCurrency: base.valueCurrency ?? null,
                  probability: base.probability ?? null,
                  expectedCloseAt: base.expectedCloseAt ?? null,
                  description: base.description ?? null,
                  personIds,
                  people: personIds.map((id) => deal.people?.find((entry) => entry.id === id) ?? { id, label: '' }),
                  companyIds,
                  companies: companyIds.map((id) => deal.companies?.find((entry) => entry.id === id) ?? { id, label: '' }),
                  customValues: Object.keys(custom).length ? custom : null,
                  updatedAt: new Date().toISOString(),
                })
              : deal,
          ),
        )
        flash(translate('customers.people.detail.deals.updateSuccess', 'Deal updated.'), 'success')
      } finally {
        setPendingAction(null)
        popLoading()
      }
    },
    [popLoading, pushLoading, scope, translate],
  )

  const handleDelete = React.useCallback(
    async (deal: NormalizedDeal) => {
      const confirmed =
        typeof window === 'undefined'
          ? true
          : window.confirm(
              translate(
                'customers.people.detail.deals.deleteConfirm',
                'Delete this deal? This action cannot be undone.',
              ),
            )
      if (!confirmed) return
      setPendingAction({ kind: 'delete', id: deal.id })
      try {
        const res = await apiFetch('/api/customers/deals', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: deal.id }),
        })
        const responseBody = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof responseBody?.error === 'string'
              ? responseBody.error
              : translate('customers.people.detail.deals.deleteError', 'Failed to delete deal.')
          throw new Error(message)
        }
        setDeals((prev) => prev.filter((item) => item.id !== deal.id))
        flash(translate('customers.people.detail.deals.deleteSuccess', 'Deal deleted.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : translate('customers.people.detail.deals.deleteError', 'Failed to delete deal.')
        flash(message, 'error')
      } finally {
        setPendingAction(null)
      }
    },
    [translate],
  )

  const handleDialogSubmit = React.useCallback(
    async (payload: DealFormSubmitPayload) => {
      if (dialogMode === 'edit' && editingDealId) {
        await handleUpdate(editingDealId, payload)
      } else {
        await handleCreate(payload)
      }
      closeDialog()
    },
    [closeDialog, dialogMode, editingDealId, handleCreate, handleUpdate],
  )

  React.useEffect(() => {
    if (!onActionChange) return
    const disabled = !scope || isLoading || pendingAction !== null
    const action: SectionAction = {
      label: addActionLabel,
      onClick: () => {
        if (!disabled) openCreateDialog()
      },
      disabled,
    }
    onActionChange(action)
    return () => {
      onActionChange(null)
    }
  }, [addActionLabel, isLoading, onActionChange, openCreateDialog, pendingAction, scope])

  const isFormPending =
    pendingAction?.kind === 'create' ||
    (pendingAction?.kind === 'update' && pendingAction.id === editingDealId)

  const sortedDeals = React.useMemo(() => {
    return [...deals].sort((a, b) => {
      const timeA = a.updatedAt ?? a.createdAt ?? ''
      const timeB = b.updatedAt ?? b.createdAt ?? ''
      return timeB.localeCompare(timeA)
    })
  }, [deals])

  return (
    <div className="mt-4 space-y-4">
      {loadError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {loadError}
        </div>
      ) : null}
      {!isLoading && sortedDeals.length === 0 ? (
        <EmptyState
          title={emptyState.title}
          action={{
            label: emptyState.actionLabel,
            onClick: openCreateDialog,
            disabled: !scope || pendingAction !== null,
          }}
        />
      ) : null}
      <div className="space-y-4">
        {sortedDeals.map((deal) => {
          const valueLabel = formatValueLabel(deal.valueAmount ?? null, deal.valueCurrency ?? null, emptyLabel)
          const expectedLabel = deal.expectedCloseAt ? formatDate(deal.expectedCloseAt) ?? emptyLabel : emptyLabel
          const probabilityLabel =
            typeof deal.probability === 'number' ? `${deal.probability}%` : emptyLabel
          const isUpdatePending = pendingAction?.kind === 'update' && pendingAction.id === deal.id
          const isDeletePending = pendingAction?.kind === 'delete' && pendingAction.id === deal.id
          return (
            <article key={deal.id} className="group rounded-lg border bg-card p-4 shadow-xs transition hover:border-border/80">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold">{deal.title || emptyLabel}</h3>
                  {deal.description ? (
                    <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{deal.description}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    {deal.status ?? emptyLabel}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={(event) => {
                        event.preventDefault()
                        openEditDialog(deal)
                      }}
                      disabled={pendingAction !== null}
                    >
                      {isUpdatePending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Pencil className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={(event) => {
                        event.preventDefault()
                        handleDelete(deal)
                      }}
                      disabled={pendingAction !== null}
                    >
                      {isDeletePending ? (
                        <span className="relative flex h-4 w-4 items-center justify-center text-destructive">
                          <span className="absolute h-4 w-4 animate-spin rounded-full border border-destructive border-t-transparent" />
                        </span>
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </header>
              <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div className="flex flex-col gap-0.5">
                  <dt className="font-medium">
                    {t('customers.people.detail.deals.fields.pipelineStage', 'Pipeline stage')}
                  </dt>
                  <dd>{deal.pipelineStage ?? emptyLabel}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-medium">
                    {t('customers.people.detail.deals.fields.probability', 'Probability')}
                  </dt>
                  <dd>{probabilityLabel}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-medium">
                    {t('customers.people.detail.deals.fields.valueAmount', 'Value')}
                  </dt>
                  <dd>{valueLabel}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-medium">
                    {t('customers.people.detail.deals.fields.expectedCloseAt', 'Expected close')}
                  </dt>
                  <dd>{expectedLabel}</dd>
                </div>
              </dl>
              <div className="mt-3 text-xs">
                <Link
                  href={`/backend/customers/deals/${encodeURIComponent(deal.id)}`}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <ArrowUpRightSquare className="h-3.5 w-3.5" aria-hidden />
                  {t('customers.people.detail.deals.openDeal', 'Open deal')}
                </Link>
              </div>
            </article>
          )
        })}
        {isLoading && deals.length > 0 ? (
          <div className="flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {!isLoading && hasMore ? (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                loadDeals({ append: true }).catch(() => {})
              }}
              disabled={pendingAction !== null || isLoading}
            >
              {t('customers.people.detail.deals.loadMore', 'Load more deals')}
            </Button>
          </div>
        ) : null}
      </div>

      <DealDialog
        open={dialogOpen}
        mode={dialogMode}
        onOpenChange={handleDialogOpenChange}
        initialValues={initialValues}
        onSubmit={async (payload) => {
          await handleDialogSubmit(payload)
        }}
        isSubmitting={Boolean(isFormPending)}
      />
    </div>
  )
}

export default DealsSection
