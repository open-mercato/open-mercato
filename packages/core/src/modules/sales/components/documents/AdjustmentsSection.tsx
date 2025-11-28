"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { mapCrudServerErrorToFormErrors } from '@open-mercato/ui/backend/utils/serverErrors'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { SectionAction } from '@open-mercato/core/modules/customers/components/detail/types'
import type { SalesAdjustmentKind } from '../../data/entities'
import { PriceWithCurrency } from '../PriceWithCurrency'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@/lib/frontend/useOrganizationScope'

type AdjustmentRow = {
  id: string
  label: string | null
  code: string | null
  kind: SalesAdjustmentKind
  calculatorKey: string | null
  rate: number | null
  amountNet: number | null
  amountGross: number | null
  currencyCode: string | null
  position: number
}

type AdjustmentFormState = {
  label: string
  code: string
  kind: SalesAdjustmentKind
  calculatorKey: string
  rate: string
  amountNet: string
  amountGross: string
  currencyCode: string | null
  position: string
}

type SalesDocumentAdjustmentsSectionProps = {
  documentId: string
  kind: 'order' | 'quote'
  currencyCode: string | null | undefined
  organizationId?: string | null
  tenantId?: string | null
  onActionChange?: (action: SectionAction | null) => void
}

const ADJUSTMENT_KINDS: SalesAdjustmentKind[] = ['discount', 'tax', 'shipping', 'surcharge', 'custom']

const defaultFormState = (currencyCode?: string | null): AdjustmentFormState => ({
  label: '',
  code: '',
  kind: 'custom',
  calculatorKey: '',
  rate: '',
  amountNet: '',
  amountGross: '',
  currencyCode: currencyCode ?? null,
  position: '',
})

function normalizeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const formatter = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 })
  return formatter.format(value / 100)
}

export function SalesDocumentAdjustmentsSection({
  documentId,
  kind,
  currencyCode,
  organizationId: orgFromProps,
  tenantId: tenantFromProps,
  onActionChange,
}: SalesDocumentAdjustmentsSectionProps) {
  const t = useT()
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const resolvedOrganizationId = orgFromProps ?? organizationId ?? null
  const resolvedTenantId = tenantFromProps ?? tenantId ?? null
  const [rows, setRows] = React.useState<AdjustmentRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<AdjustmentFormState>(() => defaultFormState(currencyCode))
  const [formErrors, setFormErrors] = React.useState<Record<string, string | undefined>>({})
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [search, setSearch] = React.useState('')

  const resourcePath = React.useMemo(
    () => (kind === 'order' ? '/api/sales/order-adjustments' : '/api/sales/quote-adjustments'),
    [kind]
  )
  const documentKey = kind === 'order' ? 'orderId' : 'quoteId'

  const loadAdjustments = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '200', [documentKey]: documentId })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `${resourcePath}?${params.toString()}`,
        undefined,
        { fallback: { items: [] } }
      )
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      const mapped: AdjustmentRow[] = items
        .map((item) => {
          const id = typeof item.id === 'string' ? item.id : null
          if (!id) return null
          const amountNet = normalizeNumber(
            (item as any).amount_net ?? (item as any).amountNet ?? (item as any).amount_net_amount,
            NaN
          )
          const amountGross = normalizeNumber(
            (item as any).amount_gross ?? (item as any).amountGross ?? (item as any).amount_gross_amount,
            NaN
          )
          const rateRaw = normalizeNumber((item as any).rate, NaN)
          const kindValue =
            typeof item.kind === 'string' && ADJUSTMENT_KINDS.includes(item.kind as SalesAdjustmentKind)
              ? (item.kind as SalesAdjustmentKind)
              : 'custom'
          const currency =
            typeof (item as any).currency_code === 'string'
              ? (item as any).currency_code
              : typeof (item as any).currencyCode === 'string'
                ? (item as any).currencyCode
                : currencyCode ?? null
          return {
            id,
            label: typeof item.label === 'string' ? item.label : null,
            code: typeof item.code === 'string' ? item.code : null,
            kind: kindValue,
            calculatorKey:
              typeof (item as any).calculator_key === 'string'
                ? (item as any).calculator_key
                : typeof (item as any).calculatorKey === 'string'
                  ? (item as any).calculatorKey
                  : null,
            rate: Number.isFinite(rateRaw) ? rateRaw : null,
            amountNet: Number.isFinite(amountNet) ? amountNet : null,
            amountGross: Number.isFinite(amountGross) ? amountGross : null,
            currencyCode: currency,
            position:
              typeof item.position === 'number'
                ? item.position
                : typeof (item as any).position === 'string'
                  ? Number((item as any).position)
                  : 0,
          }
        })
        .filter((entry): entry is AdjustmentRow => Boolean(entry))
      setRows(mapped)
    } catch (err) {
      console.error('sales.document.adjustments.load', err)
      setError(t('sales.documents.adjustments.errorLoad', 'Failed to load adjustments.'))
    } finally {
      setLoading(false)
    }
  }, [currencyCode, documentId, documentKey, resourcePath, t])

  React.useEffect(() => {
    void loadAdjustments()
  }, [loadAdjustments])

  const filteredRows = React.useMemo(() => {
    if (!search.trim()) return rows
    const term = search.toLowerCase()
    return rows.filter(
      (row) =>
        (row.label ?? '').toLowerCase().includes(term) ||
        (row.code ?? '').toLowerCase().includes(term) ||
        (row.calculatorKey ?? '').toLowerCase().includes(term) ||
        row.kind.toLowerCase().includes(term)
    )
  }, [rows, search])

  const resetForm = React.useCallback(() => {
    setForm(defaultFormState(currencyCode))
    setFormErrors({})
    setSubmitError(null)
    setEditingId(null)
  }, [currencyCode])

  const handleOpenCreate = React.useCallback(() => {
    resetForm()
    setDialogOpen(true)
  }, [resetForm])

  const handleEdit = React.useCallback(
    (row: AdjustmentRow) => {
      setEditingId(row.id)
      setForm({
        label: row.label ?? '',
        code: row.code ?? '',
        kind: row.kind,
        calculatorKey: row.calculatorKey ?? '',
        rate: row.rate?.toString() ?? '',
        amountNet: row.amountNet?.toString() ?? '',
        amountGross: row.amountGross?.toString() ?? '',
        currencyCode: row.currencyCode ?? currencyCode ?? null,
        position: row.position.toString(),
      })
      setDialogOpen(true)
    },
    [currencyCode]
  )

  const handleCloseDialog = React.useCallback(() => {
    setDialogOpen(false)
    setSubmitError(null)
    setFormErrors({})
  }, [])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: t('sales.documents.adjustments.add', 'Add adjustment'),
      onClick: handleOpenCreate,
      disabled: false,
    })
    return () => onActionChange(null)
  }, [handleOpenCreate, onActionChange, t])

  const validateForm = React.useCallback(() => {
    const nextErrors: Record<string, string> = {}
    const resolvedCurrency = form.currencyCode ?? currencyCode ?? null
    const net = normalizeNumber(form.amountNet, NaN)
    const gross = normalizeNumber(form.amountGross, NaN)
    if (!Number.isFinite(net) && !Number.isFinite(gross)) {
      nextErrors.amountNet = t('sales.documents.adjustments.errorAmount', 'Provide at least one amount.')
    }
    if (!resolvedCurrency) {
      nextErrors.currencyCode = t('sales.documents.adjustments.errorCurrency', 'Currency is required.')
    }
    if (!resolvedOrganizationId || !resolvedTenantId) {
      nextErrors.position = t('sales.documents.adjustments.errorScope', 'Organization and tenant are required.')
    }
    setFormErrors(nextErrors)
    if (nextErrors.amountNet) {
      setSubmitError(nextErrors.amountNet)
    } else if (nextErrors.currencyCode) {
      setSubmitError(nextErrors.currencyCode)
    } else if (nextErrors.position) {
      setSubmitError(nextErrors.position)
    }
    return Object.keys(nextErrors).length === 0
  }, [currencyCode, form.amountGross, form.amountNet, form.currencyCode, resolvedOrganizationId, resolvedTenantId, t])

  const handleSubmit = React.useCallback(async () => {
    if (saving) return
    setSubmitError(null)
    if (!validateForm()) return
    setSaving(true)
    try {
      const resolvedCurrency = form.currencyCode ?? currencyCode ?? null
      const payload: Record<string, unknown> = {
        [documentKey]: documentId,
        organizationId: resolvedOrganizationId ?? undefined,
        tenantId: resolvedTenantId ?? undefined,
        scope: 'order',
        kind: form.kind,
        code: form.code?.trim() || undefined,
        label: form.label?.trim() || undefined,
        calculatorKey: form.calculatorKey?.trim() || undefined,
        rate: form.rate ? normalizeNumber(form.rate, 0) : undefined,
        amountNet: form.amountNet ? normalizeNumber(form.amountNet, 0) : undefined,
        amountGross: form.amountGross ? normalizeNumber(form.amountGross, 0) : undefined,
        currencyCode: resolvedCurrency ?? undefined,
        position: form.position ? normalizeNumber(form.position, 0) : undefined,
      }
      const action = editingId ? updateCrud : createCrud
      const result = await action(
        resourcePath,
        editingId ? { id: editingId, ...payload } : payload,
        {
          successMessage: editingId
            ? t('sales.documents.adjustments.updated', 'Adjustment updated.')
            : t('sales.documents.adjustments.created', 'Adjustment added.'),
          errorMessage: t('sales.documents.adjustments.errorSave', 'Failed to save adjustment.'),
        }
      )
      if (result.ok) {
        await loadAdjustments()
        setDialogOpen(false)
        resetForm()
      }
    } catch (err) {
      console.error('sales.document.adjustments.save', err)
      const mapped = mapCrudServerErrorToFormErrors(err)
      if (mapped.fieldErrors) {
        setFormErrors((prev) => ({ ...prev, ...mapped.fieldErrors }))
      }
      if (mapped.message) {
        setSubmitError(mapped.message)
      }
    } finally {
      setSaving(false)
    }
  }, [
    currencyCode,
    documentId,
    documentKey,
    editingId,
    form.amountGross,
    form.amountNet,
    form.calculatorKey,
    form.code,
    form.currencyCode,
    form.kind,
    form.label,
    form.position,
    form.rate,
    loadAdjustments,
    resourcePath,
    resolvedOrganizationId,
    resolvedTenantId,
    resetForm,
    saving,
    t,
    validateForm,
  ])

  const handleDelete = React.useCallback(
    async (row: AdjustmentRow) => {
      try {
        const result = await deleteCrud(
          resourcePath,
          { id: row.id, [documentKey]: documentId },
          {
            successMessage: t('sales.documents.adjustments.deleted', 'Adjustment removed.'),
            errorMessage: t('sales.documents.adjustments.errorDelete', 'Failed to delete adjustment.'),
          }
        )
        if (result.ok) {
          await loadAdjustments()
        }
      } catch (err) {
        console.error('sales.document.adjustments.delete', err)
        flash(t('sales.documents.adjustments.errorDelete', 'Failed to delete adjustment.'), 'error')
      }
    },
    [documentId, documentKey, loadAdjustments, resourcePath, t]
  )

  const columns = React.useMemo<ColumnDef<AdjustmentRow>[]>(
    () => [
      {
        id: 'label',
        header: t('sales.documents.adjustments.label', 'Label'),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-foreground">{row.original.label ?? t('sales.documents.adjustments.untitled', 'Untitled')}</span>
            {row.original.code ? <span className="text-xs text-muted-foreground">{row.original.code}</span> : null}
          </div>
        ),
      },
      {
        id: 'kind',
        header: t('sales.documents.adjustments.kindLabel', 'Kind'),
        cell: ({ row }) => <Badge variant="outline">{row.original.kind}</Badge>,
      },
      {
        id: 'amountNet',
        header: t('sales.documents.adjustments.amountNet', 'Net amount'),
        cell: ({ row }) => (
          <PriceWithCurrency amount={row.original.amountNet} currency={row.original.currencyCode ?? currencyCode} className="font-mono text-sm" />
        ),
      },
      {
        id: 'amountGross',
        header: t('sales.documents.adjustments.amountGross', 'Gross amount'),
        cell: ({ row }) => (
          <PriceWithCurrency amount={row.original.amountGross} currency={row.original.currencyCode ?? currencyCode} className="font-mono text-sm" />
        ),
      },
      {
        id: 'rate',
        header: t('sales.documents.adjustments.rate', 'Rate'),
        cell: ({ row }) => <span className="font-mono text-sm text-muted-foreground">{formatPercent(row.original.rate)}</span>,
      },
      {
        id: 'position',
        header: t('sales.documents.adjustments.position', 'Position'),
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.position}</span>,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <RowActions
            items={[
              {
                label: t('ui.actions.edit', 'Edit'),
                onSelect: () => handleEdit(row.original),
              },
              {
                label: t('ui.actions.delete', 'Delete'),
                destructive: true,
                onSelect: () => handleDelete(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [currencyCode, handleDelete, handleEdit, t]
  )

  return (
    <div className="space-y-4">
      {error ? (
        <ErrorMessage title={t('sales.documents.adjustments.errorLoad', 'Failed to load adjustments.')} description={error} onRetry={() => void loadAdjustments()} />
      ) : null}
      <DataTable<AdjustmentRow>
        data={filteredRows}
        columns={columns}
        isLoading={loading}
        embedded
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('sales.documents.adjustments.search', 'Search adjustments')}
        emptyState={
          <TabEmptyState
            title={t('sales.documents.empty.adjustments.title', 'No adjustments yet.')}
            description={t('sales.documents.empty.adjustments.description', 'Add discounts, fees, or taxes to refine totals.')}
            actionLabel={t('sales.documents.adjustments.add', 'Add adjustment')}
            onAction={handleOpenCreate}
          />
        }
        actions={
          <Button onClick={handleOpenCreate} size="sm">
            {t('sales.documents.adjustments.add', 'Add adjustment')}
          </Button>
        }
        refreshButton={{
          label: t('sales.documents.adjustments.refresh', 'Refresh'),
          onRefresh: () => {
            void loadAdjustments()
          },
          isRefreshing: loading,
        }}
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleCloseDialog(); }}>
        <DialogContent
          className="w-[calc(100%-1.5rem)] max-h-[90vh] overflow-y-auto sm:max-w-lg"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              handleCloseDialog()
              return
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void handleSubmit()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? t('sales.documents.adjustments.editTitle', 'Edit adjustment')
                : t('sales.documents.adjustments.addTitle', 'Add adjustment')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="adjustment-label">{t('sales.documents.adjustments.label', 'Label')}</Label>
              <Input
                id="adjustment-label"
                value={form.label}
                onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
                placeholder={t('sales.documents.adjustments.labelPlaceholder', 'e.g. Shipping fee')}
              />
              {formErrors.label ? <p className="text-xs text-destructive">{formErrors.label}</p> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="adjustment-code">{t('sales.documents.adjustments.code', 'Code')}</Label>
                <Input
                  id="adjustment-code"
                  value={form.code}
                  onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                  placeholder={t('sales.documents.adjustments.codePlaceholder', 'PROMO10')}
                />
                {formErrors.code ? <p className="text-xs text-destructive">{formErrors.code}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="adjustment-kind">{t('sales.documents.adjustments.kindLabel', 'Kind')}</Label>
                <select
                  id="adjustment-kind"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.kind}
                  onChange={(event) => setForm((prev) => ({ ...prev, kind: event.target.value as SalesAdjustmentKind }))}
                >
                  {ADJUSTMENT_KINDS.map((kindValue) => (
                    <option key={kindValue} value={kindValue}>
                      {t(`sales.documents.adjustments.kindLabels.${kindValue}`, kindValue)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-calculator-key">{t('sales.documents.adjustments.calculatorKey', 'Calculator key')}</Label>
              <Input
                id="adjustment-calculator-key"
                value={form.calculatorKey}
                onChange={(event) => setForm((prev) => ({ ...prev, calculatorKey: event.target.value }))}
                placeholder="optional"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="adjustment-rate">{t('sales.documents.adjustments.rate', 'Rate')}</Label>
                <Input
                  id="adjustment-rate"
                  type="number"
                  inputMode="decimal"
                  value={form.rate}
                  onChange={(event) => setForm((prev) => ({ ...prev, rate: event.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adjustment-position">{t('sales.documents.adjustments.position', 'Position')}</Label>
                <Input
                  id="adjustment-position"
                  type="number"
                  inputMode="numeric"
                  value={form.position}
                  onChange={(event) => setForm((prev) => ({ ...prev, position: event.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="adjustment-amount-net">{t('sales.documents.adjustments.amountNet', 'Net amount')}</Label>
                <Input
                  id="adjustment-amount-net"
                  type="number"
                  inputMode="decimal"
                  value={form.amountNet}
                  onChange={(event) => setForm((prev) => ({ ...prev, amountNet: event.target.value }))}
                  placeholder="0.00"
                />
                {formErrors.amountNet ? <p className="text-xs text-destructive">{formErrors.amountNet}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="adjustment-amount-gross">{t('sales.documents.adjustments.amountGross', 'Gross amount')}</Label>
                <Input
                  id="adjustment-amount-gross"
                  type="number"
                  inputMode="decimal"
                  value={form.amountGross}
                  onChange={(event) => setForm((prev) => ({ ...prev, amountGross: event.target.value }))}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-currency">{t('sales.documents.adjustments.currency', 'Currency')}</Label>
              <Input
                id="adjustment-currency"
                value={form.currencyCode ?? ''}
                onChange={(event) => setForm((prev) => ({ ...prev, currencyCode: event.target.value.toUpperCase() }))}
                placeholder={t('sales.documents.adjustments.currencyPlaceholder', 'e.g. USD')}
              />
              {formErrors.currencyCode ? <p className="text-xs text-destructive">{formErrors.currencyCode}</p> : null}
            </div>
            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
          </div>
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCloseDialog}
              className="w-full sm:w-auto"
              disabled={saving}
            >
              {t('ui.actions.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} className="w-full sm:w-auto" disabled={saving}>
              {saving ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('ui.actions.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
