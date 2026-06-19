"use client"

import * as React from 'react'
import { Undo2, Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  emitSalesDocumentTotalsRefresh,
  subscribeSalesDocumentTotalsRefresh,
} from '@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents'
import { formatMoney, normalizeNumber } from './lineItemUtils'
import { ReturnDialog, type ReturnOrderLine } from './ReturnDialog'
import { ReturnEditDialog, type ReturnEditRecord } from './ReturnEditDialog'
import { handleSectionMutationError, readRowUpdatedAt, rowOptimisticVersion } from './optimisticLock'

type ReturnRow = {
  id: string
  returnNumber: string
  status: string | null
  reason: string | null
  notes: string | null
  returnedAt: string | null
  updatedAt: string | null
  totalNetAmount: number | null
  totalGrossAmount: number | null
}

type SalesReturnsSectionProps = {
  orderId: string
  currencyCode?: string | null
  documentUpdatedAt?: string | null
}

function formatDisplayDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export function SalesReturnsSection({ orderId, currencyCode, documentUpdatedAt }: SalesReturnsSectionProps) {
  const t = useT()
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [returns, setReturns] = React.useState<ReturnRow[]>([])
  const [lines, setLines] = React.useState<ReturnOrderLine[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editRecord, setEditRecord] = React.useState<ReturnEditRecord | null>(null)

  const loadLines = React.useCallback(async () => {
    const params = new URLSearchParams({ page: '1', pageSize: '100', orderId })
    const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      `/api/sales/order-lines?${params.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    const items = Array.isArray(response.result?.items) ? response.result?.items ?? [] : []
    const mapped: ReturnOrderLine[] = items
      .map((item) => {
        const map = item as Record<string, unknown>
        const id = typeof map.id === 'string' ? map.id : null
        if (!id) return null
        const snapshot = map['catalog_snapshot']
        const snapshotName =
          snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
            ? (snapshot as Record<string, unknown>)['name']
            : null
        const name =
          typeof map.name === 'string'
            ? map.name
            : typeof snapshotName === 'string'
              ? snapshotName
              : null
        const lineNumber =
          typeof map['line_number'] === 'number'
            ? (map['line_number'] as number)
            : typeof map.lineNumber === 'number'
              ? (map.lineNumber as number)
              : null
        const quantity =
          typeof map.quantity === 'number'
            ? (map.quantity as number)
            : typeof map.quantity === 'string'
              ? Number(map.quantity)
              : 0
        const returnedQuantity =
          typeof map['returned_quantity'] === 'number'
            ? (map['returned_quantity'] as number)
            : typeof map.returnedQuantity === 'number'
              ? (map.returnedQuantity as number)
              : typeof map['returned_quantity'] === 'string'
                ? Number(map['returned_quantity'])
                : typeof map.returnedQuantity === 'string'
                  ? Number(map.returnedQuantity)
                  : 0
        return {
          id,
          title: name ?? id,
          lineNumber,
          quantity: Number.isFinite(quantity) ? quantity : 0,
          returnedQuantity: Number.isFinite(returnedQuantity) ? returnedQuantity : 0,
        }
      })
      .filter((entry): entry is ReturnOrderLine => Boolean(entry?.id))
    setLines(mapped)
  }, [orderId])

  const loadReturns = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100', orderId })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/returns?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      const items = Array.isArray(response.result?.items) ? response.result?.items ?? [] : []
      const mapped: ReturnRow[] = items
        .map((item) => {
          const map = item as Record<string, unknown>
          const id = typeof map.id === 'string' ? map.id : null
          if (!id) return null
          const returnNumber =
            typeof map['return_number'] === 'string'
              ? (map['return_number'] as string)
              : typeof map.returnNumber === 'string'
                ? (map.returnNumber as string)
                : id
          const returnedAt =
            typeof map['returned_at'] === 'string'
              ? (map['returned_at'] as string)
              : typeof map.returnedAt === 'string'
                ? (map.returnedAt as string)
                : null
          const totalNetAmount =
            typeof map['total_net_amount'] === 'number'
              ? (map['total_net_amount'] as number)
              : typeof map.totalNetAmount === 'number'
                ? (map.totalNetAmount as number)
                : null
          const totalGrossAmount =
            typeof map['total_gross_amount'] === 'number'
              ? (map['total_gross_amount'] as number)
              : typeof map.totalGrossAmount === 'number'
                ? (map.totalGrossAmount as number)
                : null
          const reason =
            typeof map.reason === 'string' ? (map.reason as string) : null
          const notes =
            typeof map.notes === 'string' ? (map.notes as string) : null
          return {
            id,
            returnNumber,
            status: typeof map.status === 'string' ? (map.status as string) : null,
            reason,
            notes,
            returnedAt,
            updatedAt: readRowUpdatedAt(map),
            totalNetAmount,
            totalGrossAmount,
          }
        })
        .filter((entry): entry is ReturnRow => Boolean(entry?.id))
      setReturns(mapped)
      await loadLines()
    } catch {
      setError(t('sales.returns.errors.load', 'Failed to load returns.'))
    } finally {
      setLoading(false)
    }
  }, [loadLines, orderId, t])

  React.useEffect(() => {
    loadReturns()
  }, [loadReturns])

  React.useEffect(() => {
    return subscribeSalesDocumentTotalsRefresh((detail) => {
      if (detail.documentId !== orderId) return
      loadReturns()
    })
  }, [loadReturns, orderId])

  const emptyState = React.useMemo(
    () => ({
      title: t('sales.returns.empty.title', 'No returns yet.'),
      description: t('sales.returns.empty.description', 'Create a return to generate credit adjustments for returned items.'),
    }),
    [t],
  )

  const rows = React.useMemo(() => {
    return returns.map((ret) => {
      const total = normalizeNumber(ret.totalGrossAmount ?? ret.totalNetAmount ?? 0, 0)
      return {
        ...ret,
        total,
      }
    })
  }, [returns])

  const handleEdit = React.useCallback((row: ReturnRow) => {
    setEditRecord({
      id: row.id,
      reason: row.reason,
      notes: row.notes,
      returnedAt: row.returnedAt,
      updatedAt: row.updatedAt,
    })
  }, [])

  const handleDelete = React.useCallback(
    async (row: ReturnRow) => {
      const confirmed = await confirm({
        title: t('sales.returns.confirmDelete', 'Delete this return?'),
        description: t(
          'sales.returns.confirmDelete.description',
          'This reverses the returned quantities and the related credit adjustments.',
        ),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        const result = await withScopedApiRequestHeaders(
          buildOptimisticLockHeader(rowOptimisticVersion(row)),
          () =>
            deleteCrud('sales/returns', {
              body: {
                id: row.id,
                orderId,
                ...(organizationId ? { organizationId } : {}),
                ...(tenantId ? { tenantId } : {}),
              },
              errorMessage: t('sales.returns.errors.delete', 'Failed to delete return.'),
            }),
        )
        if (result.ok) {
          emitSalesDocumentTotalsRefresh({ documentId: orderId, kind: 'order' })
          await loadReturns()
        }
      } catch (err) {
        if (handleSectionMutationError(err, t, () => void loadReturns())) return
        flash(t('sales.returns.errors.delete', 'Failed to delete return.'), 'error')
      }
    },
    [confirm, loadReturns, orderId, organizationId, tenantId, t],
  )

  if (loading) return <LoadingMessage label={t('sales.returns.loading', 'Loading returns…')} />
  if (error) return <ErrorMessage label={error} />

  if (!rows.length) {
    return (
      <div className="space-y-4">
        <TabEmptyState
          title={emptyState.title}
          description={emptyState.description}
          action={{
            label: t('sales.returns.create', 'Create return'),
            icon: <Plus className="mr-2 h-4 w-4" aria-hidden />,
            onClick: () => setDialogOpen(true),
          }}
        />
        <ReturnDialog
          open={dialogOpen}
          orderId={orderId}
          lines={lines}
          documentUpdatedAt={documentUpdatedAt}
          onClose={() => setDialogOpen(false)}
          onSaved={async () => {
            emitSalesDocumentTotalsRefresh({ documentId: orderId, kind: 'order' })
            await loadReturns()
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button type="button" onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          {t('sales.returns.create', 'Create return')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
          <div>{t('sales.returns.returnNumber', 'Return')}</div>
          <div className="text-right">{t('sales.returns.returnedAt', 'Returned at')}</div>
          <div className="text-right">{t('sales.returns.total', 'Total')}</div>
          <div className="sr-only">{t('sales.returns.actions', 'Actions')}</div>
        </div>
        <div className="divide-y">
          {rows.map((ret) => (
            <div key={ret.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Undo2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <div className="truncate text-sm font-medium">{ret.returnNumber}</div>
                  {ret.status ? <Badge variant="secondary">{ret.status}</Badge> : null}
                </div>
              </div>
              <div className="whitespace-nowrap text-right text-sm text-muted-foreground">
                {formatDisplayDate(ret.returnedAt) ?? t('sales.returns.notSet', 'Not set')}
              </div>
              <div className="whitespace-nowrap text-right text-sm font-medium">
                {formatMoney(ret.total, currencyCode ?? null)}
              </div>
              <div className="flex justify-end">
                <RowActions
                  items={[
                    {
                      id: 'edit',
                      label: t('ui.actions.edit', 'Edit'),
                      onSelect: () => handleEdit(ret),
                    },
                    {
                      id: 'delete',
                      label: t('ui.actions.delete', 'Delete'),
                      destructive: true,
                      onSelect: () => void handleDelete(ret),
                    },
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <ReturnDialog
        open={dialogOpen}
        orderId={orderId}
        lines={lines}
        documentUpdatedAt={documentUpdatedAt}
        onClose={() => setDialogOpen(false)}
        onSaved={async () => {
          emitSalesDocumentTotalsRefresh({ documentId: orderId, kind: 'order' })
          await loadReturns()
        }}
      />

      <ReturnEditDialog
        open={editRecord !== null}
        returnRecord={editRecord}
        orderId={orderId}
        organizationId={organizationId ?? null}
        tenantId={tenantId ?? null}
        onClose={() => setEditRecord(null)}
        onSaved={async () => {
          setEditRecord(null)
          emitSalesDocumentTotalsRefresh({ documentId: orderId, kind: 'order' })
          await loadReturns()
        }}
      />

      {ConfirmDialogElement}
    </div>
  )
}

