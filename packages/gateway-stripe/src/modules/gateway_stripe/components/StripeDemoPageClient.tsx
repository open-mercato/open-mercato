"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type CheckoutResponse = {
  sessionId: string
  redirectUrl: string
}

export default function StripeDemoPageClient() {
  const [amount, setAmount] = React.useState('49.99')
  const [currencyCode, setCurrencyCode] = React.useState('USD')
  const [email, setEmail] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const runCheckout = React.useCallback(async () => {
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
            customerEmail: email || undefined,
            orderNumber: `DEMO-${Date.now()}`,
            lineItems: [{ name: 'Stripe demo payment', quantity: 1, amount: Number(amount) }],
          }),
        },
      )

      if (!payload?.redirectUrl) {
        throw new Error('Stripe did not return a redirect URL')
      }

      window.location.assign(payload.redirectUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize Stripe checkout')
    } finally {
      setLoading(false)
    }
  }, [amount, currencyCode, email])

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Stripe Checkout Demo</h1>
      <p className="text-sm text-muted-foreground">
        This page uses the new `gateway_stripe` integration package and calls the payment gateway hub endpoint.
      </p>

      <Alert>
        <AlertTitle>Configuration hint</AlertTitle>
        <AlertDescription>
          Set `STRIPE_SECRET_KEY` (required) and optionally `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
          `STRIPE_WEBHOOK_SECRET`, `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL`.
          You can also provide keys in Sales payment method provider settings for provider `stripe`.
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 rounded-lg border p-4">
        <label className="grid gap-1 text-sm">
          Amount
          <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
        </label>

        <label className="grid gap-1 text-sm">
          Currency (ISO)
          <Input value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} maxLength={3} />
        </label>

        <label className="grid gap-1 text-sm">
          Customer email (optional)
          <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@example.com" />
        </label>

        <Button onClick={runCheckout} disabled={loading}>
          {loading ? 'Creating Stripe checkout…' : 'Pay with Stripe'}
        </Button>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  )
}
