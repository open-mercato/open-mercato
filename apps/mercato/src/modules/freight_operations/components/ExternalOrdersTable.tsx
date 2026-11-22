"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { customerNameOf, formatFreightDate } from './freightOptions'
import type { FreightOrderRow } from './FreightOrdersTable'

const RESOURCE = 'freight_operations/orders'
const ENTITY_ID = 'freight_operations:freight_order'
const CONTEXT_ID = 'freight_operations.external_orders'
const LABEL_MISSING = '—'

const detailHref = (id: string) => `/backend/freight/orders/${id}`

export default function ExternalOrdersTable() {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const [rejectOrder, setRejectOrder] = React.useState<FreightOrderRow | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const query = useQuery({
    queryKey: ['freight-external-orders', scopeVersion],
    queryFn: () => fetchCrudList<FreightOrderRow>(RESOURCE, {
      source: 'customer_portal',
      status: 'draft',
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'asc',
    }),
  })

  const approve = React.useCallback(async (order: FreightOrderRow) => {
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(order.updatedAt ?? order.updated_at ?? null),
          () => apiCallOrThrow('/api/freight_operations/orders/confirm', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: order.id }),
          }, {
            errorMessage: t('freight_operations.external_orders.error.approve', 'Unable to approve the order.'),
          }),
        ),
        mutationPayload: { operation: 'orders.confirm', id: order.id, updatedAt: order.updatedAt ?? null },
        context: {
          formId: CONTEXT_ID,
          resourceKind: ENTITY_ID,
          resourceId: order.id,
          retryLastMutation,
        },
      })
      flash(t('freight_operations.external_orders.success.approve', 'Order approved.'), 'success')
      await query.refetch()
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('freight_operations.external_orders.error.approve', 'Unable to approve the order.'),
        'error',
      )
    }
  }, [query, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<FreightOrderRow>[]>(() => [
    {
      accessorKey: 'order_number',
      header: t('freight_operations.external_orders.columns.number', 'Order'),
      cell: ({ row }) => (
        <Link
          href={detailHref(row.original.id)}
          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          {row.original.order_number}
        </Link>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'customer',
      header: t('freight_operations.external_orders.columns.customer', 'Customer'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">
          {customerNameOf(row.original.customer_snapshot, LABEL_MISSING)}
        </span>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'lane',
      header: t('freight_operations.external_orders.columns.lane', 'Lane'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm">
            {[row.original.pickup_location, row.original.dropoff_location].filter(Boolean).join(' → ') || LABEL_MISSING}
          </span>
          <span className="truncate text-xs text-muted-foreground">{row.original.cargo_description}</span>
        </span>
      ),
      meta: { priority: 2, truncate: true, maxWidth: '24rem' },
    },
    {
      accessorKey: 'requested_pickup_at',
      header: t('freight_operations.external_orders.columns.requestedPickup', 'Requested pickup'),
      cell: ({ row }) => (
        <span className="text-sm">{formatFreightDate(row.original.requested_pickup_at, locale)}</span>
      ),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'submitted_at',
      header: t('freight_operations.external_orders.columns.submittedAt', 'Submitted'),
      cell: ({ row }) => (
        <span className="text-sm">{formatFreightDate(row.original.submitted_at, locale)}</span>
      ),
      meta: { priority: 2 },
    },
    {
      id: 'status',
      header: t('freight_operations.external_orders.columns.status', 'Status'),
      enableSorting: false,
      cell: () => (
        <Badge variant="secondary">
          {t('freight_operations.external_orders.status.awaiting', 'Awaiting review')}
        </Badge>
      ),
      meta: { priority: 1 },
    },
  ], [locale, t])

  if (query.isError) {
    return (
      <div className="text-sm text-status-error-text">
        {t('freight_operations.external_orders.error.load', 'Unable to load external orders.')}
      </div>
    )
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {t(
          'freight_operations.external_orders.page.description',
          'Orders submitted by customers in the portal. Approve to confirm them, or reject with a reason.',
        )}
      </p>
      <DataTable
        title={t('freight_operations.external_orders.page.title', 'External orders')}
        titleHeadingLevel={1}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'view', label: t('freight_operations.external_orders.actions.view', 'View'), href: detailHref(row.id) },
              {
                id: 'approve',
                label: t('freight_operations.external_orders.actions.approve', 'Approve'),
                onSelect: () => { void approve(row) },
              },
              {
                id: 'reject',
                label: t('freight_operations.external_orders.actions.reject', 'Reject'),
                onSelect: () => setRejectOrder(row),
              },
            ]}
          />
        )}
        columns={columns}
        data={query.data?.items ?? []}
        emptyState={t(
          'freight_operations.external_orders.empty',
          'No customer orders are waiting for review.',
        )}
        isLoading={query.isLoading}
      />
      <RejectExternalOrderDialog
        order={rejectOrder}
        onOpenChange={(open) => { if (!open) setRejectOrder(null) }}
        onRejected={() => {
          setRejectOrder(null)
          void query.refetch()
        }}
      />
    </>
  )
}

function RejectExternalOrderDialog({
  order,
  onOpenChange,
  onRejected,
}: {
  order: FreightOrderRow | null
  onOpenChange: (open: boolean) => void
  onRejected: () => void
}) {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: `${CONTEXT_ID}.reject`,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const open = order !== null

  React.useEffect(() => {
    if (!open) return
    setReason('')
    setError(null)
  }, [open])

  const submit = React.useCallback(async () => {
    if (!order) return
    if (!reason.trim()) {
      setError(t('freight_operations.external_orders.reject.reasonRequired', 'Enter a rejection reason.'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(order.updatedAt ?? order.updated_at ?? null),
          () => apiCallOrThrow('/api/freight_operations/orders/cancel', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: order.id, reason: reason.trim() }),
          }, {
            errorMessage: t('freight_operations.external_orders.error.reject', 'Unable to reject the order.'),
          }),
        ),
        mutationPayload: { operation: 'orders.cancel', id: order.id, updatedAt: order.updatedAt ?? null },
        context: {
          formId: CONTEXT_ID,
          resourceKind: ENTITY_ID,
          resourceId: order.id,
          retryLastMutation,
        },
      })
      flash(t('freight_operations.external_orders.success.reject', 'Order rejected.'), 'success')
      onRejected()
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : t('freight_operations.external_orders.error.reject', 'Unable to reject the order.'),
      )
    } finally {
      setSaving(false)
    }
  }, [onRejected, order, reason, retryLastMutation, runMutation, t])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
    disabled: saving,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {t('freight_operations.external_orders.reject.title', 'Reject the customer order')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'freight_operations.external_orders.reject.description',
              'The customer will see the order as cancelled. Record why it was rejected.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t('freight_operations.external_orders.reject.reason', 'Rejection reason')}
            </span>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          </label>
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }} disabled={saving}>
            {t('freight_operations.external_orders.actions.reject', 'Reject')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
