"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  customerNameOf,
  formatFreightAmount,
  formatFreightDate,
  useTransportReference,
} from './freightOptions'
import { LIST_HREF } from './orderListMeta'
import { FreightPaymentsPanel } from './FreightPaymentsPanel'
import type { FreightOrderRow, FreightOrderStatus } from './FreightOrdersTable'

const RESOURCE = 'freight_operations/orders'
const ENTITY_ID = 'freight_operations:freight_order'
const DETAIL_MUTATION_CONTEXT_ID = 'freight_operations.orders.detail'

const STATUS_FALLBACKS: Record<FreightOrderStatus, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  assigned: 'Assigned',
  in_transit: 'In transit',
  delivered: 'Delivered',
  completed: 'Completed',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium text-foreground">{value}</span>
    </div>
  )
}

export default function FreightOrderDetail({ id }: { id: string }) {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { vehicleOptions, driverOptions } = useTransportReference()
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: DETAIL_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const [vehicleId, setVehicleId] = React.useState('')
  const [driverId, setDriverId] = React.useState('')
  const [podReference, setPodReference] = React.useState('')

  const query = useQuery({
    queryKey: ['freight-order-detail', id],
    queryFn: () => fetchCrudList<FreightOrderRow>(RESOURCE, { ids: String(id), pageSize: 1 }),
  })
  const order = query.data?.items?.[0]

  const runAction = React.useCallback(async (
    action: string,
    payload: Record<string, unknown>,
    options: { confirmTitle?: string; success: string; error: string },
  ) => {
    if (!order) return
    if (options.confirmTitle) {
      const confirmed = await confirm({ title: options.confirmTitle })
      if (!confirmed) return
    }
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(order.updatedAt ?? order.updated_at ?? null),
          () => apiCallOrThrow(`/api/freight_operations/orders/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: order.id, ...payload }),
          }, { errorMessage: options.error }),
        ),
        mutationPayload: { operation: `orders.${action}`, id: order.id, updatedAt: order.updatedAt ?? null },
        context: { formId: DETAIL_MUTATION_CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: order.id, retryLastMutation },
      })
      flash(options.success, 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : options.error, 'error')
    }
  }, [confirm, order, query, retryLastMutation, runMutation])

  if (query.isLoading) {
    return <Page><PageBody><LoadingMessage label={t('freight_operations.orders.detail.loading', 'Loading order…')} /></PageBody></Page>
  }
  if (query.isError) {
    return <Page><PageBody><ErrorMessage label={t('freight_operations.orders.detail.error', 'Could not load the order.')} /></PageBody></Page>
  }
  if (!order) {
    return (
      <Page><PageBody>
        <RecordNotFoundState
          label={t('freight_operations.orders.form.error.notFound', 'Order not found.')}
          backHref={LIST_HREF}
          backLabel={t('freight_operations.orders.actions.backToList', 'Back to orders')}
        />
      </PageBody></Page>
    )
  }

  const status = order.status
  const statusLabel = t(`freight_operations.orders.status.${status}`, STATUS_FALLBACKS[status] ?? status)
  const vehicleSnapshot = (order as unknown as Record<string, unknown>).vehicle_snapshot as Record<string, unknown> | null | undefined
  const driverSnapshot = (order as unknown as Record<string, unknown>).driver_snapshot as Record<string, unknown> | null | undefined
  const podReferenceStored = (order as unknown as Record<string, unknown>).pod_reference as string | null | undefined
  const salesInvoiceId = (order as unknown as Record<string, unknown>).sales_invoice_id as string | null | undefined

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-foreground">{order.order_number}</h1>
                <Badge variant="secondary">{statusLabel}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{customerNameOf(order.customer_snapshot)}</p>
            </div>
            <div className="flex items-center gap-2">
              {(status === 'draft' || status === 'confirmed') && (
                <Button asChild variant="outline">
                  <Link href={`${LIST_HREF}/${order.id}/edit`}>{t('freight_operations.orders.actions.edit', 'Edit')}</Link>
                </Button>
              )}
              {status === 'draft' && (
                <Button onClick={() => { void runAction('confirm', {}, {
                  success: t('freight_operations.orders.actions.confirm.success', 'Order confirmed.'),
                  error: t('freight_operations.orders.actions.confirm.error', 'Unable to confirm the order.'),
                }) }}>
                  {t('freight_operations.orders.actions.confirm.label', 'Confirm')}
                </Button>
              )}
              {status === 'completed' && (
                <Button onClick={() => { void runAction('invoice', {}, {
                  confirmTitle: t('freight_operations.orders.actions.invoice.confirm', 'Issue a tax invoice for this order? This creates a sales invoice document.'),
                  success: t('freight_operations.orders.actions.invoice.success', 'Invoice issued.'),
                  error: t('freight_operations.orders.actions.invoice.error', 'Unable to invoice the order.'),
                }) }}>
                  {t('freight_operations.orders.actions.invoice.label', 'Issue invoice')}
                </Button>
              )}
              {status !== 'invoiced' && status !== 'cancelled' && (
                <Button variant="outline" onClick={() => { void runAction('cancel', {}, {
                  confirmTitle: t('freight_operations.orders.actions.cancel.confirm', 'Cancel this order?'),
                  success: t('freight_operations.orders.actions.cancel.success', 'Order cancelled.'),
                  error: t('freight_operations.orders.actions.cancel.error', 'Unable to cancel the order.'),
                }) }}>
                  {t('freight_operations.orders.actions.cancel.label', 'Cancel')}
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DetailSection title={t('freight_operations.orders.detail.route', 'Route and cargo')}>
              <FieldRow label={t('freight_operations.orders.columns.lane', 'Lane')} value={`${order.pickup_location} → ${order.dropoff_location}`} />
              <FieldRow label={t('freight_operations.orders.form.fields.cargoDescription', 'Cargo description')} value={order.cargo_description} />
              <FieldRow label={t('freight_operations.orders.form.fields.requestedPickup', 'Requested pickup')} value={formatFreightDate(order.requested_pickup_at)} />
              <FieldRow label={t('freight_operations.orders.form.fields.truckType', 'Truck type')} value={t(`freight_operations.orders.truck_type.${order.truck_type_required}`, order.truck_type_required ?? '—')} />
            </DetailSection>

            <DetailSection title={t('freight_operations.orders.detail.pricing', 'Pricing')}>
              <FieldRow label={t('freight_operations.orders.form.fields.agreedAmount', 'Agreed amount (net, of VAT)')} value={formatFreightAmount(order.agreed_amount_net, order.currency_code)} />
              <FieldRow label={t('freight_operations.orders.form.fields.adjustment', 'Adjustment (signed, net)')} value={formatFreightAmount(order.adjustment_amount_net ?? '0', order.currency_code)} />
              <FieldRow label={t('freight_operations.orders.form.fields.vatRate', 'VAT rate (%)')} value={`${(order as unknown as Record<string, unknown>).vat_rate ?? '15'}%`} />
            </DetailSection>

            <DetailSection title={t('freight_operations.orders.detail.assignment', 'Assignment')}>
              {status === 'draft' ? (
                <p className="text-sm text-muted-foreground">{t('freight_operations.orders.detail.assignmentHint', 'Confirm the order before assigning a vehicle and driver.')}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <FieldRow
                    label={t('freight_operations.orders.form.fields.truckType', 'Truck')}
                    value={vehicleSnapshot
                      ? `${vehicleSnapshot.plateNumber ?? ''} ${vehicleSnapshot.make ?? ''} ${vehicleSnapshot.model ?? ''}`.trim() || '—'
                      : '—'}
                  />
                  <FieldRow
                    label={t('freight_operations.orders.columns.driver', 'Driver')}
                    value={driverSnapshot ? String(driverSnapshot.fullName ?? '—') : '—'}
                  />
                  {(status === 'confirmed' || status === 'assigned') && (
                    <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
                      <Select value={vehicleId} onValueChange={setVehicleId}>
                        <SelectTrigger aria-label={t('freight_operations.orders.detail.vehicleSelect', 'Vehicle')}>
                          <SelectValue placeholder={t('freight_operations.orders.detail.vehicleSelect', 'Vehicle')} />
                        </SelectTrigger>
                        <SelectContent>
                          {vehicleOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={driverId} onValueChange={setDriverId}>
                        <SelectTrigger aria-label={t('freight_operations.orders.detail.driverSelect', 'Driver')}>
                          <SelectValue placeholder={t('freight_operations.orders.detail.driverSelect', 'Driver')} />
                        </SelectTrigger>
                        <SelectContent>
                          {driverOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        disabled={!vehicleId || !driverId}
                        onClick={() => { void runAction('assign', { vehicleId, driverId }, {
                          success: t('freight_operations.orders.actions.assign.success', 'Order assigned.'),
                          error: t('freight_operations.orders.actions.assign.error', 'Unable to assign the order.'),
                        }) }}
                      >
                        {t('freight_operations.orders.actions.assign.label', 'Assign')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </DetailSection>

            <DetailSection title={t('freight_operations.orders.detail.execution', 'Execution')}>
              <div className="flex flex-col gap-3">
                <FieldRow label={t('freight_operations.orders.detail.dispatchedAt', 'Dispatched at')} value={formatFreightDate(((order as unknown as Record<string, unknown>).dispatched_at as string | null) ?? null)} />
                {status === 'assigned' && (
                  <Button size="sm" className="self-start" onClick={() => { void runAction('dispatch', {}, {
                    confirmTitle: t('freight_operations.orders.actions.dispatch.confirm', 'Dispatch this order now?'),
                    success: t('freight_operations.orders.actions.dispatch.success', 'Order dispatched.'),
                    error: t('freight_operations.orders.actions.dispatch.error', 'Unable to dispatch the order.'),
                  }) }}>
                    {t('freight_operations.orders.actions.dispatch.label', 'Dispatch')}
                  </Button>
                )}
                {(status === 'delivered' || status === 'in_transit') && (
                  <FieldRow label={t('freight_operations.orders.detail.pod', 'Proof of delivery')} value={podReferenceStored || t('freight_operations.orders.detail.podMissing', 'Not recorded')} />
                )}
                {status === 'in_transit' && (
                  <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
                    <Input
                      value={podReference}
                      onChange={(event) => setPodReference(event.target.value)}
                      placeholder={t('freight_operations.orders.form.fields.podReference', 'POD reference')}
                      aria-label={t('freight_operations.orders.form.fields.podReference', 'POD reference')}
                    />
                    <Button
                      onClick={() => { void runAction('deliver', { podReference: podReference.trim() || undefined }, {
                        success: t('freight_operations.orders.actions.deliver.success', 'Delivery recorded.'),
                        error: t('freight_operations.orders.actions.deliver.error', 'Unable to record the delivery.'),
                      }) }}
                    >
                      {t('freight_operations.orders.actions.deliver.label', 'Record delivery')}
                    </Button>
                  </div>
                )}
                {status === 'delivered' && (
                  <Button size="sm" className="self-start" onClick={() => { void runAction('complete', {}, {
                    success: t('freight_operations.orders.actions.complete.success', 'Order completed.'),
                    error: t('freight_operations.orders.actions.complete.error', 'Unable to complete the order.'),
                  }) }}>
                    {t('freight_operations.orders.actions.complete.label', 'Complete')}
                  </Button>
                )}
              </div>
            </DetailSection>
          </div>

          <DetailSection title={t('freight_operations.orders.detail.invoice', 'Invoice and payments')}>
            {salesInvoiceId ? (
              <div className="flex flex-col gap-3">
                <FieldRow label={t('freight_operations.orders.detail.invoiceNumber', 'Sales invoice')} value={String((order as unknown as Record<string, unknown>).sales_invoice_id ?? '')} />
                <FreightPaymentsPanel
                  scope={{ orderId: order.id }}
                  currencyCode={order.currency_code}
                  targetUpdatedAt={order.updatedAt ?? order.updated_at ?? null}
                  targetLabel={order.order_number}
                  canRecord
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('freight_operations.orders.detail.noInvoice', 'No invoice issued yet.')}</p>
            )}
          </DetailSection>
        </div>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
