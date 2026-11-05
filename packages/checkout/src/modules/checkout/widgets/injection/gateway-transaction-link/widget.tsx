"use client"
import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'

type Props = {
  context?: { selectedPaymentId?: string | null }
}

type GatewayTransactionLinkPayload = {
  transaction?: { id: string; linkSlug?: string | null; linkName?: string | null } | null
}

function GatewayTransactionLinkWidget({ context }: Props) {
  const t = useT()
  const transactionId = context?.selectedPaymentId ?? null
  const [payload, setPayload] = React.useState<GatewayTransactionLinkPayload | null>(null)

  React.useEffect(() => {
    let active = true
    if (!transactionId) {
      setPayload(null)
      return () => { active = false }
    }
    void readApiResultOrThrow<GatewayTransactionLinkPayload>(
      `/api/checkout/transactions/by-gateway/${encodeURIComponent(transactionId)}`,
    )
      .then((result) => {
        if (active) setPayload(result)
      })
      .catch(() => {
        if (active) setPayload(null)
      })
    return () => { active = false }
  }, [transactionId])

  if (!payload?.transaction) return null

  return (
    <Card>
      <CardHeader><CardTitle>{t('checkout.widgets.gatewayTransactionLink.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>{t('checkout.widgets.gatewayTransactionLink.labels.transactionId')}: {payload.transaction.id}</div>
        <div>{t('checkout.widgets.gatewayTransactionLink.labels.link')}: {payload.transaction.linkName ?? t('checkout.common.emptyValue')}</div>
        <div className="flex gap-3">
          <Link className="underline" href={`/backend/checkout/transactions/${encodeURIComponent(payload.transaction.id)}`}>{t('checkout.widgets.gatewayTransactionLink.actions.openTransaction')}</Link>
          {payload.transaction.linkSlug ? <Link className="underline" href={`/pay/${encodeURIComponent(payload.transaction.linkSlug)}`}>{t('checkout.widgets.gatewayTransactionLink.actions.openPayPage')}</Link> : null}
        </div>
      </CardContent>
    </Card>
  )
}

const widget: InjectionWidgetModule<{ selectedPaymentId?: string | null }> = {
  metadata: {
    id: 'checkout.injection.gateway-transaction-link',
    title: 'Checkout transaction link',
    description: 'Links a gateway transaction back to the originating checkout transaction.',
    features: ['checkout.view'],
  },
  Widget: GatewayTransactionLinkWidget,
}

export default widget
