"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PAYMENT_STATUS_FALLBACKS } from '../lib/freightEnums'
import { formatFreightAmount } from './freightOptions'
import { RecordPaymentDialog, type PaymentTargetKind } from './RecordPaymentDialog'
import { VoidPaymentDialog, type VoidablePayment } from './VoidPaymentDialog'

const CONTEXT_ID = 'freight_operations.payments.panel'

export type FreightPaymentRow = VoidablePayment & {
  currency_code: string
  method: string
  received_at: string
  status: string
  invoice_synced_at?: string | null
}

export function useFreightPayments(scope: { orderId?: string; abstractId?: string }, enabled = true) {
  const params = new URLSearchParams()
  if (scope.orderId) params.set('orderId', scope.orderId)
  if (scope.abstractId) params.set('abstractId', scope.abstractId)
  params.set('pageSize', '100')
  return useQuery({
    queryKey: ['freight-payments', scope.orderId ?? '', scope.abstractId ?? ''],
    enabled,
    queryFn: async () => {
      const call = await apiCall<{ items?: FreightPaymentRow[] }>(`/api/freight_operations/payments?${params.toString()}`)
      return call.result?.items ?? []
    },
  })
}

/**
 * One panel renders the payments of a spot order, of an abstract, and — through
 * the table below — the whole ledger: the scope is a prop, the state machine is
 * the module's. Recording is guarded by the *document's* version and voiding by
 * the *payment's*, which is why the two dialogs take different lock sources.
 */
export function FreightPaymentsPanel({
  scope,
  currencyCode,
  targetUpdatedAt,
  targetLabel,
  canRecord,
  onChanged,
}: {
  scope: { orderId?: string; abstractId?: string }
  currencyCode: string
  targetUpdatedAt?: string | null
  targetLabel?: string
  canRecord: boolean
  onChanged?: () => void
}) {
  const t = useT()
  const [recordOpen, setRecordOpen] = React.useState(false)
  const [voidTarget, setVoidTarget] = React.useState<VoidablePayment | null>(null)
  const query = useFreightPayments(scope)
  const rows = query.data ?? []
  const kind: PaymentTargetKind = scope.orderId ? 'order' : 'abstract'

  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const resync = React.useCallback(async () => {
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        // Resync repairs a forced mismatch from the recorded ledger and enforces
        // no record version, so none is sent.
        operation: () => apiCallOrThrow('/api/freight_operations/payments/resync', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(scope.orderId ? { orderId: scope.orderId } : { abstractId: scope.abstractId }),
        }, { errorMessage: t('freight_operations.errors.payment_resync_failed', 'Unable to resync the invoice totals.') }),
        mutationPayload: { operation: 'payments.resync', ...scope },
        context: { formId: CONTEXT_ID, resourceKind: 'freight_operations:freight_payment', resourceId: scope.orderId ?? scope.abstractId, retryLastMutation },
      })
      flash(t('freight_operations.payments.resync.success', 'Invoice totals synced.'), 'success')
      await query.refetch()
      onChanged?.()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : t('freight_operations.errors.payment_resync_failed', 'Unable to resync the invoice totals.'), 'error')
    }
  }, [onChanged, query, retryLastMutation, runMutation, scope, t])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t('freight_operations.payments.panel.count', '{count} payments', { count: rows.length })}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => { void resync() }}>
            {t('freight_operations.payments.resync.action', 'Resync invoice totals')}
          </Button>
          {canRecord ? (
            <Button type="button" size="sm" onClick={() => setRecordOpen(true)}>
              {t('freight_operations.payments.form.record', 'Record payment')}
            </Button>
          ) : null}
        </div>
      </div>

      {query.isLoading ? (
        <LoadingMessage label={t('freight_operations.payments.panel.loading', 'Loading payments…')} />
      ) : query.isError ? (
        <p className="text-sm text-destructive">{t('freight_operations.errors.payments_load_failed', 'Failed to load payments.')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('freight_operations.payments.panel.empty', 'No payments recorded yet.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-start text-muted-foreground">
                <th className="py-2 text-start font-medium">{t('freight_operations.payments.columns.receivedAt', 'Received')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.payments.columns.amount', 'Amount')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.payments.columns.reference', 'Reference')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.payments.columns.synced', 'Invoice synced')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.payments.columns.status', 'Status')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.payments.columns.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((payment) => (
                <tr key={payment.id} className="border-b border-border/60">
                  <td className="py-2">{payment.received_at}</td>
                  <td className="py-2 font-medium">{formatFreightAmount(payment.amount, payment.currency_code ?? currencyCode)}</td>
                  <td className="py-2">{payment.reference ?? '—'}</td>
                  <td className="py-2">{payment.invoice_synced_at ? t('freight_operations.payments.syncedYes', 'Yes') : t('freight_operations.payments.syncedNo', 'Pending')}</td>
                  <td className="py-2">
                    <Badge variant="secondary">
                      {t(`freight_operations.payments.status.${payment.status}`, PAYMENT_STATUS_FALLBACKS[payment.status] ?? payment.status)}
                    </Badge>
                  </td>
                  <td className="py-2">
                    {payment.status === 'recorded' ? (
                      <RowActions
                        items={[
                          {
                            id: 'void',
                            label: t('freight_operations.payments.void.action', 'Void'),
                            destructive: true,
                            onSelect: () => setVoidTarget(payment),
                          },
                        ]}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RecordPaymentDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        pinnedTarget={targetLabel ? { kind, id: scope.orderId ?? scope.abstractId ?? '', updatedAt: targetUpdatedAt ?? null, currencyCode, label: targetLabel } : null}
        onRecorded={() => {
          setRecordOpen(false)
          void query.refetch()
          onChanged?.()
        }}
      />
      <VoidPaymentDialog
        payment={voidTarget}
        onOpenChange={(open) => { if (!open) setVoidTarget(null) }}
        onVoided={() => {
          setVoidTarget(null)
          void query.refetch()
          onChanged?.()
        }}
      />
    </div>
  )
}
