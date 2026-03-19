"use client"
import * as React from 'react'
import Link from 'next/link'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'

type Props = {
  context?: { selectedPaymentId?: string | null }
}

function GatewayTransactionLinkWidget({ context }: Props) {
  const transactionId = context?.selectedPaymentId ?? null
  const [payload, setPayload] = React.useState<{ transaction?: { id: string; linkSlug?: string | null; linkName?: string | null } } | null>(null)

  React.useEffect(() => {
    let active = true
    if (!transactionId) {
      setPayload(null)
      return () => { active = false }
    }
    void readApiResultOrThrow<{ transaction?: { id: string; linkSlug?: string | null; linkName?: string | null } }>(`/api/checkout/transactions/${encodeURIComponent(transactionId)}`)
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
      <CardHeader><CardTitle>Checkout transaction</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>Transaction ID: {payload.transaction.id}</div>
        <div>Link: {payload.transaction.linkName ?? '—'}</div>
        <div className="flex gap-3">
          <Link className="underline" href={`/backend/checkout/transactions/${encodeURIComponent(payload.transaction.id)}`}>Open transaction</Link>
          {payload.transaction.linkSlug ? <Link className="underline" href={`/pay/${encodeURIComponent(payload.transaction.linkSlug)}`}>Open pay page</Link> : null}
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
