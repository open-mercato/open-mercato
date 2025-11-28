"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import {
  DictionaryEntrySelect,
  type DictionaryOption,
} from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
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

const FALLBACK_ADJUSTMENT_KIND_VALUES: SalesAdjustmentKind[] = [
  'discount',
  'tax',
  'shipping',
  'surcharge',
  'custom',
]

const defaultFormState = (currencyCode?: string | null, kindValue: SalesAdjustmentKind = 'custom'): AdjustmentFormState => ({
  label: '',
  code: '',
  kind: kindValue,
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
  const [formResetKey, setFormResetKey] = React.useState(0)
  const [initialValues, setInitialValues] = React.useState<AdjustmentFormState>(() => defaultFormState(currencyCode))
  const [kindOptions, setKindOptions] = React.useState<DictionaryOption[]>([])
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)

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
  const kindSelectLabels = React.useMemo(
    () => ({
      placeholder: t('sales.documents.adjustments.kindSelect.placeholder', 'Select adjustment kind…'),
      addLabel: t('sales.config.adjustmentKinds.actions.add', 'Add adjustment kind'),
      addPrompt: t('sales.config.adjustmentKinds.dialog.createDescription', 'Define a reusable adjustment kind shown in document adjustment dialogs.'),
      dialogTitle: t('sales.config.adjustmentKinds.dialog.createTitle', 'Create adjustment kind'),
      valueLabel: t('sales.config.adjustmentKinds.form.codeLabel', 'Code'),
      valuePlaceholder: t('sales.config.adjustmentKinds.form.codePlaceholder', 'e.g. discount'),
      labelLabel: t('sales.config.adjustmentKinds.form.labelLabel', 'Label'),
      labelPlaceholder: t('sales.config.adjustmentKinds.form.labelPlaceholder', 'e.g. Discount'),
      emptyError: t('sales.config.adjustmentKinds.errors.required', 'Code is required.'),
      cancelLabel: t('ui.actions.cancel', 'Cancel'),
      saveLabel: t('ui.actions.save', 'Save'),
      saveShortcutHint: t('ui.actions.saveShortcut', 'Cmd/Ctrl + Enter'),
      successCreateLabel: t('sales.config.adjustmentKinds.messages.created', 'Adjustment kind created.'),
      errorLoad: t('sales.config.adjustmentKinds.errors.load', 'Failed to load adjustment kinds.'),
      errorSave: t('sales.config.adjustmentKinds.errors.save', 'Failed to save adjustment kind.'),
      loadingLabel: t('sales.config.adjustmentKinds.loading', 'Loading adjustment kinds…'),
      manageTitle: t('sales.config.adjustmentKinds.title', 'Adjustment kinds'),
    }),
    [t]
  )

  const loadKindOptions = React.useCallback(async (): Promise<DictionaryOption[]> => {
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
      return options
    } catch (err) {
      console.error('sales.adjustment-kinds.fetch', err)
      setKindOptions(fallbackKindOptions)
      return fallbackKindOptions
    }
  }, [fallbackKindOptions])

  React.useEffect(() => {
    loadKindOptions().catch(() => {})
  }, [loadKindOptions, resolvedOrganizationId, resolvedTenantId])

  const loadAdjustments = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '200', [documentKey]: documentId })
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
  }, [apiResourcePath, currencyCode, documentId, documentKey, t])

  React.useEffect(() => {
    void loadAdjustments()
  }, [loadAdjustments])

  const resolveKindLabel = React.useCallback(
    (kindValue: SalesAdjustmentKind) => {
      const option = kindOptionMap[kindValue]
      if (option) return option.label
      return t(`sales.documents.adjustments.kindLabels.${kindValue}`, typeof kindValue === 'string' ? kindValue : String(kindValue))
    },
    [kindOptionMap, t]
  )

  const resolveDefaultKind = React.useCallback((): SalesAdjustmentKind => {
    if (kindOptions.length) return kindOptions[0]?.value as SalesAdjustmentKind
    if (fallbackKindOptions.length) return fallbackKindOptions[0]?.value as SalesAdjustmentKind
    return 'custom'
  }, [fallbackKindOptions, kindOptions])

  const resetForm = React.useCallback(() => {
    setInitialValues(defaultFormState(currencyCode, resolveDefaultKind()))
    setFormResetKey((prev) => prev + 1)
    setEditingId(null)
  }, [currencyCode, resolveDefaultKind])

  const handleOpenCreate = React.useCallback(() => {
    resetForm()
    setDialogOpen(true)
  }, [resetForm])

  const handleEdit = React.useCallback(
    (row: AdjustmentRow) => {
      setEditingId(row.id)
      setFormResetKey((prev) => prev + 1)
      setInitialValues({
        label: row.label ?? '',
        code: row.code ?? '',
        kind: row.kind,
        calculatorKey: row.calculatorKey ?? '',
        rate: row.rate ?? '',
        amountNet: row.amountNet ?? '',
        amountGross: row.amountGross ?? '',
        currencyCode: row.currencyCode ?? currencyCode ?? null,
        position: row.position ?? '',
      })
      setDialogOpen(true)
    },
    [currencyCode]
  )

  const handleCloseDialog = React.useCallback(() => {
    setDialogOpen(false)
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

  const handleFormSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      const resolvedCurrency = (values.currencyCode as string | null | undefined) ?? currencyCode ?? null
      const amountNet = normalizeNumber(values.amountNet, NaN)
      const amountGross = normalizeNumber(values.amountGross, NaN)
      if (!resolvedCurrency || resolvedCurrency.trim().length !== 3) {
        throw createCrudFormError(
          t('sales.documents.adjustments.errorCurrency', 'Currency is required.'),
          { currencyCode: t('sales.documents.adjustments.errorCurrency', 'Currency is required.') }
        )
      }
      if (!Number.isFinite(amountNet) && !Number.isFinite(amountGross)) {
        throw createCrudFormError(
          t('sales.documents.adjustments.errorAmount', 'Provide at least one amount.'),
          { amountNet: t('sales.documents.adjustments.errorAmount', 'Provide at least one amount.') }
        )
      }
      if (!resolvedOrganizationId || !resolvedTenantId) {
        throw createCrudFormError(
          t('sales.documents.adjustments.errorScope', 'Organization and tenant are required.')
        )
      }
      const payload: Record<string, unknown> = {
        [documentKey]: documentId,
        organizationId: resolvedOrganizationId,
        tenantId: resolvedTenantId,
        scope: 'order',
        kind:
          typeof values.kind === 'string' && values.kind.trim().length
            ? (values.kind as SalesAdjustmentKind)
            : 'custom',
        code:
          typeof values.code === 'string' && values.code.trim().length ? values.code.trim() : undefined,
        label:
          typeof values.label === 'string' && values.label.trim().length ? values.label.trim() : undefined,
        calculatorKey:
          typeof values.calculatorKey === 'string' && values.calculatorKey.trim().length
            ? values.calculatorKey.trim()
            : undefined,
        rate: Number.isFinite(normalizeNumber(values.rate, NaN)) ? normalizeNumber(values.rate, NaN) : undefined,
        amountNet: Number.isFinite(amountNet) ? amountNet : undefined,
        amountGross: Number.isFinite(amountGross) ? amountGross : undefined,
        currencyCode: resolvedCurrency.toUpperCase(),
        position: Number.isFinite(normalizeNumber(values.position, NaN))
          ? normalizeNumber(values.position, NaN)
          : undefined,
      }

      const action = editingId ? updateCrud : createCrud
      const result = await action(
        crudResourcePath,
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
      }
    },
    [
      currencyCode,
      documentId,
      documentKey,
      editingId,
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
        const result = await deleteCrud(
          crudResourcePath,
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
    [crudResourcePath, documentId, documentKey, loadAdjustments, t]
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
    [currencyCode, handleDelete, handleEdit, resolveKindLabel, t]
  )

  const showLoadingState = loading && rows.length === 0

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

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleCloseDialog(); }}>
        <DialogContent
          className="w-[calc(100%-1.5rem)] max-h-[90vh] overflow-y-auto sm:max-w-lg"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              handleCloseDialog()
              return
            }
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              const form = dialogContentRef.current?.querySelector('form')
              form?.requestSubmit()
            }
          }}
          ref={dialogContentRef}
        >
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? t('sales.documents.adjustments.editTitle', 'Edit adjustment')
                : t('sales.documents.adjustments.addTitle', 'Add adjustment')}
            </DialogTitle>
          </DialogHeader>
          <CrudForm
            key={formResetKey}
            embedded
            fields={[
              {
                id: 'label',
                label: t('sales.documents.adjustments.label', 'Label'),
                type: 'text',
                placeholder: t('sales.documents.adjustments.labelPlaceholder', 'e.g. Shipping fee'),
              },
              {
                id: 'code',
                label: t('sales.documents.adjustments.code', 'Code'),
                type: 'text',
                placeholder: t('sales.documents.adjustments.codePlaceholder', 'PROMO10'),
              },
              {
                id: 'kind',
                label: t('sales.documents.adjustments.kindLabel', 'Kind'),
                type: 'custom',
                component: ({ value, setValue }) => (
                  <DictionaryEntrySelect
                    value={typeof value === 'string' ? value : undefined}
                    onChange={(next) => setValue(next ?? 'custom')}
                    fetchOptions={loadKindOptions}
                    labels={kindSelectLabels}
                    allowInlineCreate={false}
                    manageHref="/backend/config/sales#adjustment-kinds"
                    selectClassName="w-full"
                    showLabelInput={false}
                  />
                ),
              },
              {
                id: 'calculatorKey',
                label: t('sales.documents.adjustments.calculatorKey', 'Calculator key'),
                type: 'text',
                placeholder: 'optional',
              },
              {
                id: 'rate',
                label: t('sales.documents.adjustments.rate', 'Rate'),
                type: 'number',
                placeholder: '0.00',
              },
              {
                id: 'position',
                label: t('sales.documents.adjustments.position', 'Position'),
                type: 'number',
                placeholder: '0',
              },
              {
                id: 'amountNet',
                label: t('sales.documents.adjustments.amountNet', 'Net amount'),
                type: 'number',
                placeholder: '0.00',
              },
              {
                id: 'amountGross',
                label: t('sales.documents.adjustments.amountGross', 'Gross amount'),
                type: 'number',
                placeholder: '0.00',
              },
              {
                id: 'currencyCode',
                label: t('sales.documents.adjustments.currency', 'Currency'),
                type: 'text',
                placeholder: t('sales.documents.adjustments.currencyPlaceholder', 'e.g. USD'),
                transform: (val) => (typeof val === 'string' ? val.toUpperCase() : val),
              },
            ]}
            initialValues={initialValues}
            submitLabel={
              editingId
                ? t('sales.documents.adjustments.updated', 'Adjustment updated.')
                : t('sales.documents.adjustments.created', 'Adjustment added.')
            }
            onSubmit={handleFormSubmit}
            loadingMessage={t('sales.documents.adjustments.loading', 'Loading adjustments…')}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
