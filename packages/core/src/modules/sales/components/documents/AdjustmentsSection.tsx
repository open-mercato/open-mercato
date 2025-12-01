// @ts-nocheck

"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { type DictionaryOption } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import {
  emitSalesDocumentTotalsRefresh,
  subscribeSalesDocumentTotalsRefresh,
} from '@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents'
import type { SectionAction } from '@open-mercato/core/modules/customers/components/detail/types'
import type { SalesAdjustmentKind } from '../../data/entities'
import { PriceWithCurrency } from '../PriceWithCurrency'
import { AdjustmentDialog, type AdjustmentRowData, type AdjustmentSubmitPayload } from './AdjustmentDialog'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@/lib/frontend/useOrganizationScope'

type AdjustmentRow = AdjustmentRowData

type SalesDocumentAdjustmentsSectionProps = {
  documentId: string
  kind: 'order' | 'quote'
  currencyCode: string | null | undefined
  organizationId?: string | null
  tenantId?: string | null
  onActionChange?: (action: SectionAction | null) => void
  onRowsChange?: (rows: AdjustmentRow[]) => void
}

const FALLBACK_ADJUSTMENT_KIND_VALUES: SalesAdjustmentKind[] = [
  'discount',
  'tax',
  'shipping',
  'surcharge',
  'custom',
]

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
  onRowsChange,
}: SalesDocumentAdjustmentsSectionProps) {
  const t = useT()
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const resolvedOrganizationId = orgFromProps ?? organizationId ?? null
  const resolvedTenantId = tenantFromProps ?? tenantId ?? null
  const [rows, setRows] = React.useState<AdjustmentRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [activeAdjustment, setActiveAdjustment] = React.useState<AdjustmentRow | null>(null)
  const [kindOptions, setKindOptions] = React.useState<DictionaryOption[]>([])
  const kindLoadingRef = React.useRef(false)

  const apiResourcePath = React.useMemo(
    () => (kind === 'order' ? '/api/sales/order-adjustments' : '/api/sales/quote-adjustments'),
    [kind]
  )
  const crudResourcePath = React.useMemo(
    () => (kind === 'order' ? 'sales/order-adjustments' : 'sales/quote-adjustments'),
    [kind]
  )
  const documentKey = kind === 'order' ? 'orderId' : 'quoteId'
  const fallbackKindOptions = React.useMemo<DictionaryOption[]>(
    () =>
      FALLBACK_ADJUSTMENT_KIND_VALUES.map((value) => ({
        value,
        label: t(`sales.documents.adjustments.kindLabels.${value}`, value),
        color: null,
        icon: null,
      })),
    [t]
  )
  const kindOptionMap = React.useMemo(
    () =>
      kindOptions.reduce<Record<string, DictionaryOption>>((acc, entry) => {
        acc[entry.value] = entry
        return acc
      }, {}),
    [kindOptions]
  )
  const loadKindOptions = React.useCallback(async (): Promise<DictionaryOption[]> => {
    if (kindOptions.length) return kindOptions
    if (kindLoadingRef.current) return kindOptions.length ? kindOptions : fallbackKindOptions
    kindLoadingRef.current = true
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/adjustment-kinds?${params.toString()}`,
        undefined,
        { fallback: { items: [] } }
      )
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      const parsed = items
        .map((item) => {
          const value = typeof (item as any).value === 'string' ? (item as any).value.trim() : ''
          if (!value) return null
          const label =
            typeof (item as any).label === 'string' && (item as any).label.trim().length
              ? (item as any).label.trim()
              : value
          const color =
            typeof (item as any).color === 'string' && /^#([0-9a-fA-F]{6})$/.test((item as any).color)
              ? `#${(item as any).color.slice(1).toLowerCase()}`
              : null
          const icon =
            typeof (item as any).icon === 'string' && (item as any).icon.trim().length
              ? (item as any).icon.trim()
              : null
          return { value, label, color, icon }
        })
        .filter((entry): entry is DictionaryOption => Boolean(entry))
      const merged = new Map<string, DictionaryOption>()
      fallbackKindOptions.forEach((entry) => merged.set(entry.value, entry))
      parsed.forEach((entry) => merged.set(entry.value, entry))
      const options = Array.from(merged.values()).sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
      )
      setKindOptions(options)
      kindLoadingRef.current = false
      return options
    } catch (err) {
      console.error('sales.adjustment-kinds.fetch', err)
      kindLoadingRef.current = false
      setKindOptions(fallbackKindOptions)
      return fallbackKindOptions
    }
  }, [fallbackKindOptions, kindOptions])

  const extractCustomFields = React.useCallback((item: Record<string, unknown>) => {
    const entries: Record<string, unknown> = {}
    Object.entries(item).forEach(([key, value]) => {
      if (key.startsWith('cf_')) {
        entries[key] = value
      }
      if (key.startsWith('cf:')) {
        const stripped = key.slice(3)
        if (stripped) entries[`cf_${stripped}`] = value
      }
    })
    return entries
  }, [])

  React.useEffect(() => {
    loadKindOptions().catch(() => {})
  }, [loadKindOptions, resolvedOrganizationId, resolvedTenantId])

  const loadAdjustments = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100', [documentKey]: documentId })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `${apiResourcePath}?${params.toString()}`,
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
            typeof item.kind === 'string' && item.kind.trim().length
              ? (item.kind.trim() as SalesAdjustmentKind)
              : 'custom'
          const currency =
            typeof (item as any).currency_code === 'string'
              ? (item as any).currency_code
              : typeof (item as any).currencyCode === 'string'
                ? (item as any).currencyCode
                : currencyCode ?? null
          const customFields = extractCustomFields(item as Record<string, unknown>)
          const customFieldSetId =
            typeof (item as any).custom_field_set_id === 'string'
              ? (item as any).custom_field_set_id
              : typeof (item as any).customFieldSetId === 'string'
                ? (item as any).customFieldSetId
                : null
          const metadata =
            typeof (item as any).metadata === 'object' && (item as any).metadata
              ? ((item as any).metadata as Record<string, unknown>)
              : null
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
            customFields: Object.keys(customFields).length ? customFields : null,
            customFieldSetId,
            metadata,
          }
        })
        .filter((entry): entry is AdjustmentRow => Boolean(entry))
      const ordered = [...mapped].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      setRows(ordered)
      if (onRowsChange) onRowsChange(ordered)
    } catch (err) {
      console.error('sales.document.adjustments.load', err)
      setError(t('sales.documents.adjustments.errorLoad', 'Failed to load adjustments.'))
    } finally {
      setLoading(false)
    }
  }, [apiResourcePath, currencyCode, documentId, documentKey, onRowsChange, t])

  React.useEffect(() => {
    void loadAdjustments()
  }, [loadAdjustments])

  React.useEffect(
    () =>
      subscribeSalesDocumentTotalsRefresh((detail) => {
        if (detail.documentId !== documentId) return
        if (detail.kind && detail.kind !== kind) return
        void loadAdjustments()
      }),
    [documentId, kind, loadAdjustments],
  )

  const resolveKindLabel = React.useCallback(
    (kindValue: SalesAdjustmentKind) => {
      const option = kindOptionMap[kindValue]
      if (option) return option.label
      return t(`sales.documents.adjustments.kindLabels.${kindValue}`, typeof kindValue === 'string' ? kindValue : String(kindValue))
    },
    [kindOptionMap, t]
  )

  const handleOpenCreate = React.useCallback(() => {
    setActiveAdjustment(null)
    setDialogOpen(true)
  }, [])

  const handleEdit = React.useCallback((row: AdjustmentRow) => {
    setActiveAdjustment(row)
    setDialogOpen(true)
  }, [])

  const handleCloseDialog = React.useCallback(() => {
    setDialogOpen(false)
    setActiveAdjustment(null)
  }, [])

  React.useEffect(() => {
    if (!onActionChange) return
    if (!rows.length) {
      onActionChange(null)
      return () => onActionChange(null)
    }
    onActionChange({
      label: t('sales.documents.adjustments.add', 'Add adjustment'),
      onClick: handleOpenCreate,
      disabled: false,
    })
    return () => onActionChange(null)
  }, [handleOpenCreate, onActionChange, rows.length, t])

  const handleFormSubmit = React.useCallback(
    async (values: AdjustmentSubmitPayload) => {
      if (!resolvedOrganizationId || !resolvedTenantId) {
        throw createCrudFormError(
          t('sales.documents.adjustments.errorScope', 'Organization and tenant are required.')
        )
      }
      const payload: Record<string, unknown> = {
        [documentKey]: String(documentId),
        organizationId: String(resolvedOrganizationId),
        tenantId: String(resolvedTenantId),
        scope: 'order',
        kind: values.kind ?? 'custom',
        code: values.code ?? undefined,
        label: values.label ?? undefined,
        calculatorKey: values.calculatorKey ?? undefined,
        rate: Number.isFinite(values.rate) ? values.rate : undefined,
        amountNet: Number.isFinite(values.amountNet) ? values.amountNet : undefined,
        amountGross: Number.isFinite(values.amountGross) ? values.amountGross : undefined,
        currencyCode: (values.currencyCode ?? currencyCode ?? '').toUpperCase(),
        position: Number.isFinite(values.position) ? values.position : undefined,
        customFields: values.customFields ?? undefined,
        metadata: values.metadata ?? undefined,
      }

      const action = values.id ? updateCrud : createCrud
      const result = await action(
        crudResourcePath,
        values.id ? { id: values.id, ...payload } : payload,
        {
          successMessage: values.id
            ? t('sales.documents.adjustments.updated', 'Adjustment updated.')
            : t('sales.documents.adjustments.created', 'Adjustment added.'),
          errorMessage: t('sales.documents.adjustments.errorSave', 'Failed to save adjustment.'),
        }
      )
      if (result.ok) {
        await loadAdjustments()
        emitSalesDocumentTotalsRefresh({ documentId, kind })
        setDialogOpen(false)
        setActiveAdjustment(null)
      }
    },
    [
      currencyCode,
      documentId,
      documentKey,
      kind,
      loadAdjustments,
      crudResourcePath,
      resolvedOrganizationId,
      resolvedTenantId,
      t,
    ]
  )

  const handleDelete = React.useCallback(
    async (row: AdjustmentRow) => {
      try {
        const result = await deleteCrud(crudResourcePath, {
          body: {
            id: row.id,
            [documentKey]: documentId,
            organizationId: resolvedOrganizationId ?? undefined,
            tenantId: resolvedTenantId ?? undefined,
          },
          errorMessage: t('sales.documents.adjustments.errorDelete', 'Failed to delete adjustment.'),
        })
        if (result.ok) {
          await loadAdjustments()
          emitSalesDocumentTotalsRefresh({ documentId, kind })
        }
      } catch (err) {
        console.error('sales.document.adjustments.delete', err)
        flash(t('sales.documents.adjustments.errorDelete', 'Failed to delete adjustment.'), 'error')
      }
    },
    [crudResourcePath, documentId, documentKey, kind, loadAdjustments, resolvedOrganizationId, resolvedTenantId, t]
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
        cell: ({ row }) => <Badge variant="outline">{resolveKindLabel(row.original.kind)}</Badge>,
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
    ],
    [currencyCode, resolveKindLabel, t]
  )

  const showLoadingState = loading && rows.length === 0

  const renderRowActions = React.useCallback(
    (row: AdjustmentRow) => (
      <RowActions
        items={[
          {
            label: t('ui.actions.edit', 'Edit'),
            onSelect: () => handleEdit(row),
          },
          {
            label: t('ui.actions.delete', 'Delete'),
            destructive: true,
            onSelect: () => handleDelete(row),
          },
        ]}
      />
    ),
    [handleDelete, handleEdit, t]
  )

  return (
    <div className="space-y-4">
      {error ? (
        <ErrorMessage title={t('sales.documents.adjustments.errorLoad', 'Failed to load adjustments.')} description={error} onRetry={() => void loadAdjustments()} />
      ) : null}
      {showLoadingState ? (
        <LoadingMessage
          label={t('sales.documents.adjustments.loading', 'Loading adjustments…')}
          className="border-0 bg-transparent p-0 py-8 justify-center"
        />
      ) : (
        <DataTable<AdjustmentRow>
          data={rows}
          columns={columns}
          isLoading={loading && rows.length > 0}
          embedded
          onRowClick={handleEdit}
          rowActions={renderRowActions}
          emptyState={
            <TabEmptyState
              title={t('sales.documents.empty.adjustments.title', 'No adjustments yet.')}
              description={t('sales.documents.empty.adjustments.description', 'Add discounts, fees, or taxes to refine totals.')}
              actionLabel={t('sales.documents.adjustments.add', 'Add adjustment')}
              onAction={handleOpenCreate}
            />
          }
        />
      )}

      <AdjustmentDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleCloseDialog()
          } else {
            setDialogOpen(true)
          }
        }}
        kind={kind}
        currencyCode={currencyCode ?? null}
        kindOptions={kindOptions.length ? kindOptions : fallbackKindOptions}
        loadKindOptions={loadKindOptions}
        labels={{
          addTitle: t('sales.documents.adjustments.addTitle', 'Add adjustment'),
          editTitle: t('sales.documents.adjustments.editTitle', 'Edit adjustment'),
          submitCreate: t('sales.documents.adjustments.submitCreate', 'Add adjustment'),
          submitUpdate: t('sales.documents.adjustments.submitUpdate', 'Save changes'),
        }}
        initialAdjustment={activeAdjustment}
        onSubmit={handleFormSubmit}
      />
    </div>
  )
}
