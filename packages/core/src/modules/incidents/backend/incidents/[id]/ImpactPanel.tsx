"use client"

import * as React from 'react'
import { Boxes, Building2, Plus, RefreshCw, ShoppingCart, Trash2 } from 'lucide-react'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ImpactTargetType =
  | 'customer_person'
  | 'customer_company'
  | 'customer_account'
  | 'sales_order'
  | 'sales_quote'
  | 'sales_invoice'
  | 'sales_credit_memo'
  | 'component'

type ImpactStatus =
  | 'operational'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'

type ImpactSnapshot = Record<string, unknown>

type RawImpactItem = {
  id?: string
  targetType?: string | null
  target_type?: string | null
  targetId?: string | null
  target_id?: string | null
  componentLabel?: string | null
  component_label?: string | null
  impactStatus?: string | null
  impact_status?: string | null
  snapshot?: ImpactSnapshot | null
  revenueAmountMinor?: string | number | null
  revenue_amount_minor?: string | number | null
  revenueCurrency?: string | null
  revenue_currency?: string | null
  updatedAt?: string | null
  updated_at?: string | null
}

type ImpactItem = {
  id: string
  targetType: string
  targetId: string | null
  componentLabel: string | null
  impactStatus: string
  snapshot: ImpactSnapshot | null
  revenueAmountMinor: string | null
  revenueCurrency: string | null
  updatedAt: string | null
}

type ImpactListResponse = {
  items?: RawImpactItem[]
  error?: string
}

type ImpactMutationResponse = {
  ok?: boolean
  impactId?: string | null
  incidentId?: string | null
  updatedAt?: string | null
  revenueAtRiskMinor?: string | null
  revenueAtRiskCurrency?: string | null
  refreshedAt?: string | null
}

type ImpactMutationContext = Record<string, unknown> & {
  formId: string
  resourceKind: 'incidents.incident'
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type ImpactPanelProps = {
  incidentId: string
  updatedAt?: string | null
  revenueAtRiskMinor?: string | null
  revenueAtRiskCurrency?: string | null
  canManage: boolean
  onChanged: () => void | Promise<void>
}

type AddImpactFormState = {
  targetType: ImpactTargetType
  targetId: string
  label: string
  impactStatus: ImpactStatus
  revenueAmountMinor: string
  revenueCurrency: string
}

const targetTypeOptions: readonly ImpactTargetType[] = [
  'customer_person',
  'customer_company',
  'customer_account',
  'sales_order',
  'sales_quote',
  'sales_invoice',
  'sales_credit_memo',
  'component',
]

const impactStatusOptions: readonly ImpactStatus[] = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
]

const initialAddForm: AddImpactFormState = {
  targetType: 'customer_company',
  targetId: '',
  label: '',
  impactStatus: 'degraded',
  revenueAmountMinor: '',
  revenueCurrency: '',
}

function isImpactTargetType(value: string): value is ImpactTargetType {
  return targetTypeOptions.includes(value as ImpactTargetType)
}

function isImpactStatus(value: string): value is ImpactStatus {
  return impactStatusOptions.includes(value as ImpactStatus)
}

function optionalString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value : null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function normalizeImpactItem(raw: RawImpactItem): ImpactItem | null {
  const id = optionalString(raw.id)
  if (!id) return null
  return {
    id,
    targetType: optionalString(raw.targetType) ?? optionalString(raw.target_type) ?? 'component',
    targetId: optionalString(raw.targetId) ?? optionalString(raw.target_id),
    componentLabel: optionalString(raw.componentLabel) ?? optionalString(raw.component_label),
    impactStatus: optionalString(raw.impactStatus) ?? optionalString(raw.impact_status) ?? 'degraded',
    snapshot: raw.snapshot && typeof raw.snapshot === 'object' && !Array.isArray(raw.snapshot) ? raw.snapshot : null,
    revenueAmountMinor: optionalString(raw.revenueAmountMinor) ?? optionalString(raw.revenue_amount_minor),
    revenueCurrency: optionalString(raw.revenueCurrency) ?? optionalString(raw.revenue_currency),
    updatedAt: optionalString(raw.updatedAt) ?? optionalString(raw.updated_at),
  }
}

function targetTypeLabel(t: ReturnType<typeof useT>, value: string): string {
  if (value === 'customer_person') return t('incidents.incident.detail.impact.targetType.customer_person')
  if (value === 'customer_company') return t('incidents.incident.detail.impact.targetType.customer_company')
  if (value === 'customer_account') return t('incidents.incident.detail.impact.targetType.customer_account')
  if (value === 'sales_order') return t('incidents.incident.detail.impact.targetType.sales_order')
  if (value === 'sales_quote') return t('incidents.incident.detail.impact.targetType.sales_quote')
  if (value === 'sales_invoice') return t('incidents.incident.detail.impact.targetType.sales_invoice')
  if (value === 'sales_credit_memo') return t('incidents.incident.detail.impact.targetType.sales_credit_memo')
  if (value === 'component') return t('incidents.incident.detail.impact.targetType.component')
  return value
}

function impactStatusLabel(t: ReturnType<typeof useT>, value: string): string {
  if (value === 'operational') return t('incidents.incident.detail.impact.status.operational')
  if (value === 'degraded') return t('incidents.incident.detail.impact.status.degraded')
  if (value === 'partial_outage') return t('incidents.incident.detail.impact.status.partial_outage')
  if (value === 'major_outage') return t('incidents.incident.detail.impact.status.major_outage')
  return value
}

function impactStatusVariant(value: string): StatusBadgeVariant {
  if (value === 'operational') return 'success'
  if (value === 'degraded' || value === 'partial_outage') return 'warning'
  if (value === 'major_outage') return 'error'
  return 'neutral'
}

function formatMinorCurrency(value: string | null | undefined, currency: string | null | undefined): string | null {
  if (!value) return null
  const normalizedCurrency = (currency?.trim().toUpperCase() || 'USD').slice(0, 3)
  try {
    const amount = Number(BigInt(value)) / 100
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: normalizedCurrency,
    }).format(amount)
  } catch {
    return null
  }
}

function snapshotLabel(snapshot: ImpactSnapshot | null): string | null {
  const value = snapshot?.label
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function shortenId(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  if (value.length <= 14) return value
  return `${value.slice(0, 8)}...${value.slice(-4)}`
}

function impactDisplayLabel(impact: ImpactItem, t: ReturnType<typeof useT>): string {
  return snapshotLabel(impact.snapshot) ??
    impact.componentLabel ??
    shortenId(impact.targetId, targetTypeLabel(t, impact.targetType))
}

function impactIcon(targetType: string): React.ReactElement {
  if (targetType.startsWith('customer_')) return <Building2 className="size-4" aria-hidden="true" />
  if (targetType.startsWith('sales_')) return <ShoppingCart className="size-4" aria-hidden="true" />
  return <Boxes className="size-4" aria-hidden="true" />
}

function errorMessage(result: ImpactListResponse | null, fallback: string): string {
  return typeof result?.error === 'string' && result.error.trim().length > 0 ? result.error : fallback
}

function isDuplicateImpactError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const status = (err as { status?: unknown }).status
  const raw = [
    (err as { error?: unknown }).error,
    (err as { message?: unknown }).message,
    (err as { raw?: unknown }).raw,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
  return status === 409 && raw.includes('duplicate') && raw.includes('impact')
}

export function ImpactPanel({
  incidentId,
  updatedAt,
  revenueAtRiskMinor,
  revenueAtRiskCurrency,
  canManage,
  onChanged,
}: ImpactPanelProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [items, setItems] = React.useState<ImpactItem[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [currentUpdatedAt, setCurrentUpdatedAt] = React.useState<string | null>(updatedAt ?? null)
  const [pendingAction, setPendingAction] = React.useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = React.useState(false)
  const [addForm, setAddForm] = React.useState<AddImpactFormState>(initialAddForm)
  const parentUpdatedAtRef = React.useRef<string | null>(updatedAt ?? null)
  const contextId = React.useMemo(() => `incident-impacts:${incidentId}`, [incidentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<ImpactMutationContext>({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo<ImpactMutationContext>(() => ({
    formId: contextId,
    resourceKind: 'incidents.incident',
    resourceId: incidentId,
    retryLastMutation,
  }), [contextId, incidentId, retryLastMutation])

  const loadItems = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const result = await apiCall<ImpactListResponse>(
      `/api/incidents/${encodeURIComponent(incidentId)}/impacts`,
    )
    if (!result.ok) {
      throw new Error(errorMessage(result.result, t('incidents.errors.impact_list_failed')))
    }
    const normalized = Array.isArray(result.result?.items)
      ? result.result.items.map(normalizeImpactItem).filter((item): item is ImpactItem => Boolean(item))
      : []
    setItems(normalized)
    setIsLoading(false)
  }, [incidentId, t])

  React.useEffect(() => {
    const nextUpdatedAt = updatedAt ?? null
    setCurrentUpdatedAt(nextUpdatedAt)
    if (parentUpdatedAtRef.current === nextUpdatedAt) return
    parentUpdatedAtRef.current = nextUpdatedAt
    void loadItems()
  }, [loadItems, updatedAt])

  React.useEffect(() => {
    let active = true
    loadItems().catch((err) => {
      if (!active) return
      setError(err instanceof Error ? err.message : t('incidents.errors.impact_list_failed'))
      setIsLoading(false)
    })
    return () => {
      active = false
    }
  }, [loadItems, t])

  const refreshAfterConflict = React.useCallback(() => {
    void loadItems()
    void onChanged()
  }, [loadItems, onChanged])

  const handleMutationSuccess = React.useCallback(async (
    response: ImpactMutationResponse | null | undefined,
  ) => {
    const freshUpdatedAt = response?.updatedAt ?? response?.refreshedAt
    if (typeof freshUpdatedAt === 'string' && freshUpdatedAt.length > 0) {
      setCurrentUpdatedAt(freshUpdatedAt)
      parentUpdatedAtRef.current = freshUpdatedAt
    }
    await loadItems()
    await onChanged()
  }, [loadItems, onChanged])

  const handleMutationError = React.useCallback((err: unknown, fallbackKey: string) => {
    if (isDuplicateImpactError(err)) {
      flash(t('incidents.incident.detail.impact.duplicateToast'), 'error')
      return
    }
    if (!surfaceRecordConflict(err, t, { onRefresh: refreshAfterConflict })) {
      flash(t(fallbackKey), 'error')
    }
  }, [refreshAfterConflict, t])

  const revenueAtRiskLabel = React.useMemo(
    () => formatMinorCurrency(revenueAtRiskMinor ?? null, revenueAtRiskCurrency ?? 'USD'),
    [revenueAtRiskCurrency, revenueAtRiskMinor],
  )

  const isAddFormValid = React.useMemo(() => {
    const hasTarget = addForm.targetType === 'component'
      ? addForm.label.trim().length > 0
      : addForm.targetId.trim().length > 0
    const revenue = addForm.revenueAmountMinor.trim()
    const currency = addForm.revenueCurrency.trim()
    const revenueValid = !revenue || /^\d+$/.test(revenue)
    const currencyValid = !currency || /^[A-Za-z]{3}$/.test(currency)
    return hasTarget && revenueValid && currencyValid
  }, [
    addForm.label,
    addForm.revenueAmountMinor,
    addForm.revenueCurrency,
    addForm.targetId,
    addForm.targetType,
  ])

  const handleRefresh = React.useCallback(async () => {
    if (pendingAction || !canManage) return
    setPendingAction('refresh')
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<ImpactMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/impacts/recompute`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: '{}',
          },
          { errorMessage: t('incidents.errors.impact_recompute_failed') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, action: 'recompute' },
      })
      await handleMutationSuccess(call.result)
    } catch (err) {
      handleMutationError(err, 'incidents.errors.impact_recompute_failed')
    } finally {
      setPendingAction(null)
    }
  }, [
    canManage,
    currentUpdatedAt,
    handleMutationError,
    handleMutationSuccess,
    incidentId,
    mutationContext,
    pendingAction,
    runMutation,
    t,
  ])

  const handleAdd = React.useCallback(async () => {
    if (pendingAction || !canManage || !isAddFormValid) return
    const label = addForm.label.trim()
    const targetId = addForm.targetId.trim()
    const revenueAmountMinor = addForm.revenueAmountMinor.trim()
    const revenueCurrency = addForm.revenueCurrency.trim().toUpperCase()
    const payload: Record<string, unknown> = {
      targetType: addForm.targetType,
      impactStatus: addForm.impactStatus,
    }
    if (addForm.targetType === 'component') {
      payload.componentLabel = label
    } else {
      payload.targetId = targetId
    }
    if (label) payload.snapshot = { label }
    if (revenueAmountMinor) payload.revenueAmountMinor = revenueAmountMinor
    if (revenueCurrency) payload.revenueCurrency = revenueCurrency

    setPendingAction('add')
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<ImpactMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/impacts`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: t('incidents.errors.impact_mutation_failed') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, ...payload },
      })
      setAddForm(initialAddForm)
      setAddDialogOpen(false)
      await handleMutationSuccess(call.result)
    } catch (err) {
      handleMutationError(err, 'incidents.errors.impact_mutation_failed')
    } finally {
      setPendingAction(null)
    }
  }, [
    addForm,
    canManage,
    currentUpdatedAt,
    handleMutationError,
    handleMutationSuccess,
    incidentId,
    isAddFormValid,
    mutationContext,
    pendingAction,
    runMutation,
    t,
  ])

  const handleStatusChange = React.useCallback(async (impact: ImpactItem, status: string) => {
    if (!canManage || pendingAction || !isImpactStatus(status) || status === impact.impactStatus) return
    setPendingAction(`status:${impact.id}`)
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<ImpactMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/impacts/${encodeURIComponent(impact.id)}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: JSON.stringify({ impactStatus: status }),
          },
          { errorMessage: t('incidents.errors.impact_mutation_failed') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, impactId: impact.id, impactStatus: status },
      })
      await handleMutationSuccess(call.result)
    } catch (err) {
      handleMutationError(err, 'incidents.errors.impact_mutation_failed')
    } finally {
      setPendingAction(null)
    }
  }, [
    canManage,
    currentUpdatedAt,
    handleMutationError,
    handleMutationSuccess,
    incidentId,
    mutationContext,
    pendingAction,
    runMutation,
    t,
  ])

  const handleRemove = React.useCallback(async (impact: ImpactItem) => {
    if (!canManage || pendingAction) return
    const approved = await confirm({
      title: t('incidents.incident.detail.impact.remove'),
      description: t('incidents.incident.detail.impact.removeConfirm'),
      confirmText: t('incidents.incident.detail.impact.remove'),
      cancelText: t('incidents.common.cancel'),
      variant: 'destructive',
    })
    if (!approved) return

    setPendingAction(`remove:${impact.id}`)
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<ImpactMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/impacts/${encodeURIComponent(impact.id)}`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: '{}',
          },
          { errorMessage: t('incidents.errors.impact_mutation_failed') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, impactId: impact.id },
      })
      await handleMutationSuccess(call.result)
    } catch (err) {
      handleMutationError(err, 'incidents.errors.impact_mutation_failed')
    } finally {
      setPendingAction(null)
    }
  }, [
    canManage,
    confirm,
    currentUpdatedAt,
    handleMutationError,
    handleMutationSuccess,
    incidentId,
    mutationContext,
    pendingAction,
    runMutation,
    t,
  ])

  const handleAddDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleAdd()
    }
    if (event.key === 'Escape') {
      setAddDialogOpen(false)
    }
  }, [handleAdd])

  const isPending = pendingAction !== null

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeader title={t('incidents.incident.detail.impact.title')} />
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {revenueAtRiskLabel ? (
            <StatusBadge variant="warning" dot>
              {t('incidents.incident.detail.impact.revenueAtRisk')}: {revenueAtRiskLabel}
            </StatusBadge>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t('incidents.incident.detail.impact.noRevenue')}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleRefresh()}
            disabled={!canManage || isPending}
          >
            <RefreshCw className={pendingAction === 'refresh' ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
            {t('incidents.incident.detail.impact.refresh')}
          </Button>
          {canManage ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setAddDialogOpen(true)}
              disabled={isPending}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('incidents.incident.detail.impact.addImpact')}
            </Button>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Spinner size="sm" />
          <span>{t('incidents.incident.detail.impact.loading')}</span>
        </div>
      ) : error ? (
        <ErrorMessage label={error} />
      ) : items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((impact) => {
            const revenueLabel = formatMinorCurrency(
              impact.revenueAmountMinor,
              impact.revenueCurrency ?? revenueAtRiskCurrency ?? 'USD',
            )
            return (
              <li key={impact.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="mt-1 text-muted-foreground">
                      {impactIcon(impact.targetType)}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {impactDisplayLabel(impact, t)}
                        </p>
                        <StatusBadge variant={impactStatusVariant(impact.impactStatus)} dot>
                          {impactStatusLabel(t, impact.impactStatus)}
                        </StatusBadge>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{targetTypeLabel(t, impact.targetType)}</span>
                        {revenueLabel ? <span>{revenueLabel}</span> : null}
                      </div>
                    </div>
                  </div>

                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-2 md:justify-end">
                      <Select
                        value={isImpactStatus(impact.impactStatus) ? impact.impactStatus : undefined}
                        onValueChange={(value) => void handleStatusChange(impact, value)}
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-full sm:w-44" aria-label={t('incidents.incident.detail.impact.status')}>
                          <SelectValue placeholder={t('incidents.incident.detail.impact.status')} />
                        </SelectTrigger>
                        <SelectContent>
                          {impactStatusOptions.map((status) => (
                            <SelectItem key={status} value={status}>
                              {impactStatusLabel(t, status)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRemove(impact)}
                        disabled={isPending}
                        aria-label={t('incidents.incident.detail.impact.removeAriaLabel', { id: impactDisplayLabel(impact, t) })}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        {t('incidents.incident.detail.impact.remove')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState
          variant="subtle"
          title={t('incidents.incident.detail.impact.empty')}
        />
      )}

      <Dialog open={addDialogOpen} onOpenChange={(open) => {
        if (!isPending) setAddDialogOpen(open)
      }}>
        <DialogContent className="sm:max-w-lg" onKeyDown={handleAddDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('incidents.incident.detail.impact.addImpact')}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handleAdd()
            }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="incident-impact-target-type">
                  {t('incidents.incident.detail.impact.targetType')}
                </Label>
                <Select
                  value={addForm.targetType}
                  onValueChange={(value) => {
                    if (isImpactTargetType(value)) {
                      setAddForm((prev) => ({ ...prev, targetType: value, targetId: value === 'component' ? '' : prev.targetId }))
                    }
                  }}
                  disabled={isPending}
                >
                  <SelectTrigger id="incident-impact-target-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {targetTypeOptions.map((targetType) => (
                      <SelectItem key={targetType} value={targetType}>
                        {targetTypeLabel(t, targetType)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="incident-impact-status">
                  {t('incidents.incident.detail.impact.status')}
                </Label>
                <Select
                  value={addForm.impactStatus}
                  onValueChange={(value) => {
                    if (isImpactStatus(value)) setAddForm((prev) => ({ ...prev, impactStatus: value }))
                  }}
                  disabled={isPending}
                >
                  <SelectTrigger id="incident-impact-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {impactStatusOptions.map((status) => (
                      <SelectItem key={status} value={status}>
                        {impactStatusLabel(t, status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="incident-impact-target-id">
                {t('incidents.incident.detail.impact.targetId')}
              </Label>
              <Input
                id="incident-impact-target-id"
                value={addForm.targetId}
                onChange={(event) => setAddForm((prev) => ({ ...prev, targetId: event.currentTarget.value }))}
                placeholder={t('incidents.incident.detail.impact.targetIdPlaceholder')}
                disabled={isPending || addForm.targetType === 'component'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="incident-impact-label">
                {t('incidents.incident.detail.impact.label')}
              </Label>
              <Input
                id="incident-impact-label"
                value={addForm.label}
                onChange={(event) => setAddForm((prev) => ({ ...prev, label: event.currentTarget.value }))}
                placeholder={t('incidents.incident.detail.impact.labelPlaceholder')}
                disabled={isPending}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="incident-impact-revenue">
                  {t('incidents.incident.detail.impact.revenue')}
                </Label>
                <Input
                  id="incident-impact-revenue"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={addForm.revenueAmountMinor}
                  onChange={(event) => setAddForm((prev) => ({ ...prev, revenueAmountMinor: event.currentTarget.value }))}
                  placeholder={t('incidents.incident.detail.impact.revenuePlaceholder')}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="incident-impact-currency">
                  {t('incidents.incident.detail.impact.currency')}
                </Label>
                <Input
                  id="incident-impact-currency"
                  value={addForm.revenueCurrency}
                  onChange={(event) => setAddForm((prev) => ({ ...prev, revenueCurrency: event.currentTarget.value.toUpperCase().slice(0, 3) }))}
                  placeholder={t('incidents.incident.detail.impact.currencyPlaceholder')}
                  maxLength={3}
                  disabled={isPending}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddDialogOpen(false)}
                disabled={isPending}
              >
                {t('incidents.common.cancel')}
              </Button>
              <Button type="submit" disabled={isPending || !isAddFormValid}>
                <Plus className="size-4" aria-hidden="true" />
                {t('incidents.incident.detail.impact.addImpact')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </section>
  )
}
