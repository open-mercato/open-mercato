"use client"

import * as React from 'react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDate, statusLabel, type LeaseDetail } from './leaseModel'

export function LeaseBillingAlerts({ detail }: { detail: LeaseDetail }) {
  const t = useT()
  const locale = useLocale()
  const { lease, lastBillingRefusal, operations } = detail
  const pending = Boolean(detail.pendingChange) || lease.status === 'pending_order'
  const refusal = lastBillingRefusal
  return (
    <div className="space-y-3">
      {pending ? (
        <Alert status="information" data-testid="pm-lease-billing-pending">
          <AlertTitle>{t('property_management.leases.billing.pendingTitle', 'Billing update pending')}</AlertTitle>
          <AlertDescription>
            <p>
              {lease.status === 'pending_order'
                ? t('property_management.leases.billing.activating', 'The recurring sales order is being created. The lease turns active once it exists.')
                : t('property_management.leases.billing.pending', 'Sales is applying this change. Other changes to the lease wait until it has settled.')}
            </p>
            {operations.length ? (
              <ul className="mt-2 list-disc pl-4 text-sm">
                {operations.map((operation) => (
                  <li key={operation.id}>
                    {t(`property_management.leases.operation.${operation.kind}`, operation.kind)} · {t(`property_management.leases.operationStatus.${operation.status}`, operation.status)}
                    {operation.lastError?.message || operation.lastError?.code ? ` · ${operation.lastError.message ?? operation.lastError.code}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {refusal ? (
        <Alert status="error" data-testid="pm-lease-billing-refused">
          <AlertTitle>{t('property_management.leases.billing.refusedTitle', 'Sales refused the billing change')}</AlertTitle>
          <AlertDescription>
            <p>{refusal.message ?? refusal.code ?? t('property_management.leases.billing.refusedUnknown', 'No reason was given.')}</p>
            {refusal.restored ? (
              <p className="mt-1 text-sm">
                {t('property_management.leases.billing.restored', 'Restored: {start} — {end}, {status}.', {
                  start: formatDate(refusal.restored.startsOn, locale),
                  end: formatDate(refusal.restored.endsOn, locale),
                  status: statusLabel(t, refusal.restored.status),
                })}
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {lease.billingAttention ? (
        <Alert status="warning" data-testid="pm-lease-billing-attention">
          <AlertTitle>{t('property_management.leases.billing.attention', 'Billing needs attention')}</AlertTitle>
          <AlertDescription>
            {t('property_management.leases.billing.attentionBody', 'A sales document of this lease could not be created or cancelled as planned. Check the sales order and the open billing operations.')}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

export default LeaseBillingAlerts
