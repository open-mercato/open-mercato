"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type CheckoutResponse = {
  sessionId: string
  redirectUrl: string
}

type SalesOrderContext = {
  kind?: 'order' | 'quote'
  record?: Record<string, unknown>
}

function numberFromRecord(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export default function StripeOrderCheckoutWidget({ context }: InjectionWidgetComponentProps<SalesOrderContext>) {
  const record = context?.record ?? {}
  const defaultAmount =
    numberFromRecord(record.totalGrossAmount) ??
    numberFromRecord(record.grandTotalGrossAmount) ??
    numberFromRecord(record.total_gross_amount) ??
    numberFromRecord(record.grand_total_gross_amount) ??
    0

  const defaultCurrency =
    (typeof record.currencyCode === 'string' ? record.currencyCode : null) ??
    (typeof record.currency_code === 'string' ? record.currency_code : null) ??
    'USD'

  const orderId =
    (typeof record.id === 'string' ? record.id : null) ??
    (typeof record.orderId === 'string' ? record.orderId : null) ??
    undefined

  const orderNumber =
    (typeof record.number === 'string' ? record.number : null) ??
    (typeof record.orderNumber === 'string' ? record.orderNumber : null) ??
    undefined

  const [amount, setAmount] = React.useState(defaultAmount > 0 ? String(defaultAmount) : '')
  const [currencyCode, setCurrencyCode] = React.useState(defaultCurrency)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const createCheckout = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await readApiResultOrThrow<CheckoutResponse>(
        '/api/payment-gateways/stripe/checkout',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            amount: Number(amount),
            currencyCode,
            orderId,
            orderNumber,
            lineItems: [{ name: orderNumber ? `Order ${orderNumber}` : 'Order payment', quantity: 1, amount: Number(amount) }],
          }),
        },
      )
      if (!payload?.redirectUrl) throw new Error('Stripe did not return redirect URL')
      window.location.assign(payload.redirectUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Stripe checkout session')
    } finally {
      setLoading(false)
    }
  }, [amount, currencyCode, orderId, orderNumber])

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <p className="text-sm text-muted-foreground">Open hosted Stripe Checkout for this order.</p>
      <div className="grid gap-2 md:grid-cols-2">
        <Input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          placeholder="Amount"
        />
        <Input
          value={currencyCode}
          onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
          maxLength={3}
          placeholder="Currency"
        />
      </div>
      <Button onClick={createCheckout} disabled={loading || !amount}>
        {loading ? 'Creating checkout…' : 'Pay with Stripe'}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
