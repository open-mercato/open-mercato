"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LineItemDialog } from './LineItemDialog'
import type { SalesLineRecord } from './lineItemTypes'
import { formatMoney, normalizeNumber } from './lineItemUtils'

export type SalesOrderLineDraft = {
  id: string
  payload: Record<string, unknown>
  record: SalesLineRecord
}

type SalesOrderDraftLinesProps = {
  currencyCode: string | null | undefined
  organizationId: string | null
  tenantId: string | null
  lines: SalesOrderLineDraft[]
  error?: string | null
  onChange: (lines: SalesOrderLineDraft[]) => void
}

function draftId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.round(performance.now())}`
}

export function createSalesOrderLineDraft(
  payload: Record<string, unknown>,
  id = draftId(),
): SalesOrderLineDraft {
  const quantity = normalizeNumber(payload.quantity, 0)
  const unitPriceNet = normalizeNumber(payload.unitPriceNet, 0)
  const unitPriceGross = normalizeNumber(payload.unitPriceGross, unitPriceNet)
  const taxRate = normalizeNumber(payload.taxRate, 0)
  const totalNet = normalizeNumber(payload.totalNetAmount, unitPriceNet * quantity)
  const totalGross = normalizeNumber(payload.totalGrossAmount, unitPriceGross * quantity)
  const metadata = payload.metadata && typeof payload.metadata === 'object'
    ? payload.metadata as Record<string, unknown>
    : null
  const catalogSnapshot = payload.catalogSnapshot && typeof payload.catalogSnapshot === 'object'
    ? payload.catalogSnapshot as Record<string, unknown>
    : null

  return {
    id,
    payload: { ...payload },
    record: {
      id,
      name: typeof payload.name === 'string' ? payload.name : null,
      productId: typeof payload.productId === 'string' ? payload.productId : null,
      productVariantId: typeof payload.productVariantId === 'string' ? payload.productVariantId : null,
      quantity,
      quantityUnit: typeof payload.quantityUnit === 'string' ? payload.quantityUnit : null,
      normalizedQuantity: normalizeNumber(payload.normalizedQuantity, quantity),
      normalizedUnit: typeof payload.normalizedUnit === 'string' ? payload.normalizedUnit : null,
      currencyCode: typeof payload.currencyCode === 'string' ? payload.currencyCode : null,
      unitPriceNet,
      unitPriceGross,
      taxRate,
      totalNet,
      totalGross,
      priceMode: payload.priceMode === 'net' ? 'net' : 'gross',
      uomSnapshot: null,
      metadata,
      catalogSnapshot,
      customFieldSetId: typeof payload.customFieldSetId === 'string' ? payload.customFieldSetId : null,
      customFields: payload.customFields && typeof payload.customFields === 'object'
        ? payload.customFields as Record<string, unknown>
        : null,
      status: null,
      statusEntryId: typeof payload.statusEntryId === 'string' ? payload.statusEntryId : null,
    },
  }
}

export function SalesOrderDraftLines({
  currencyCode,
  organizationId,
  tenantId,
  lines,
  error,
  onChange,
}: SalesOrderDraftLinesProps) {
  const t = useT()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<SalesOrderLineDraft | null>(null)

  const columns = React.useMemo<ColumnDef<SalesOrderLineDraft>[]>(() => [
    {
      id: 'name',
      header: t('sales.documents.items.table.product', 'Product'),
      cell: ({ row }) => row.original.record.name ?? t('sales.documents.items.untitled', 'Untitled'),
    },
    {
      id: 'quantity',
      header: t('sales.documents.items.table.quantity', 'Qty'),
      cell: ({ row }) => row.original.record.quantityUnit
        ? `${row.original.record.quantity} ${row.original.record.quantityUnit}`
        : row.original.record.quantity,
    },
    {
      id: 'unitPrice',
      header: t('sales.documents.items.table.unit', 'Unit price'),
      cell: ({ row }) => formatMoney(row.original.record.unitPriceGross, row.original.record.currencyCode ?? currencyCode ?? undefined),
    },
    {
      id: 'total',
      header: t('sales.documents.items.table.total', 'Total'),
      cell: ({ row }) => formatMoney(row.original.record.totalGross, row.original.record.currencyCode ?? currencyCode ?? undefined),
    },
  ], [currencyCode, t])

  const openCreate = React.useCallback(() => {
    setEditing(null)
    setDialogOpen(true)
  }, [])

  const rowActions = React.useCallback((line: SalesOrderLineDraft) => (
    <RowActions
      items={[
        {
          id: 'edit',
          label: t('ui.actions.edit', 'Edit'),
          onSelect: () => {
            setEditing(line)
            setDialogOpen(true)
          },
        },
        {
          id: 'delete',
          label: t('ui.actions.delete', 'Delete'),
          destructive: true,
          onSelect: () => onChange(lines.filter((candidate) => candidate.id !== line.id)),
        },
      ]}
    />
  ), [lines, onChange, t])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">{t('sales.orders.form.lines', 'Line Items')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('sales.orders.linesRequired', 'Add at least one line item before creating the order.')}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('sales.documents.items.add', 'Add item')}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <DataTable
        columns={columns}
        data={lines}
        embedded
        disableRowClick
        rowActions={rowActions}
        emptyState={(
          <EmptyState
            size="sm"
            title={t('sales.documents.items.empty', 'No items yet.')}
            description={t('sales.orders.linesRequired', 'Add at least one line item before creating the order.')}
            actions={<Button type="button" variant="outline" size="sm" onClick={openCreate}>{t('sales.documents.items.add', 'Add item')}</Button>}
          />
        )}
      />
      <LineItemDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditing(null)
        }}
        kind="order"
        currencyCode={currencyCode}
        organizationId={organizationId}
        tenantId={tenantId}
        initialLine={editing?.record ?? null}
        onDraftSaved={(payload, lineId) => {
          const draft = createSalesOrderLineDraft(payload, lineId ?? undefined)
          onChange(lineId
            ? lines.map((line) => line.id === lineId ? draft : line)
            : [...lines, draft])
        }}
      />
    </div>
  )
}
