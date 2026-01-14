"use client"

import * as React from 'react'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type PublicQuoteResponse = {
  quote: {
    quoteNumber: string
    currencyCode: string
    validFrom: string | null
    validUntil: string | null
    status: string | null
    subtotalNetAmount: string
    subtotalGrossAmount: string
    discountTotalAmount: string
    taxTotalAmount: string
    grandTotalNetAmount: string
    grandTotalGrossAmount: string
  }
  lines: Array<{
    lineNumber: number | null
    kind: string
    name: string | null
    description: string | null
    quantity: string
    quantityUnit: string | null
    currencyCode: string
    totalGrossAmount: string
  }>
  isExpired: boolean
}

export default function QuotePublicPage({ params }: { params: { token: string } }) {
  const token = params?.token
  const [loading, setLoading] = React.useState(true)
  const [accepting, setAccepting] = React.useState(false)
  const [data, setData] = React.useState<PublicQuoteResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [acceptedOrder, setAcceptedOrder] = React.useState<{ orderId: string; orderNumber: string } | null>(null)

  React.useEffect(() => {
    let mounted = true
    async function run() {
      if (!token) return
      setLoading(true)
      setError(null)
      try {
        const call = await apiCallOrThrow<PublicQuoteResponse>(`/api/sales/quotes/public/${token}`, {
          method: 'GET',
        })
        if (!mounted) return
        setData(call.result ?? null)
      } catch (err) {
        console.error('sales.quotes.public.load', err)
        if (!mounted) return
        setError('Failed to load quote.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void run()
    return () => {
      mounted = false
    }
  }, [token])

  const handleAccept = React.useCallback(async () => {
    if (!token) return
    setAccepting(true)
    setError(null)
    try {
      const call = await apiCallOrThrow<{ orderId: string; orderNumber: string }>(`/api/sales/quotes/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      setAcceptedOrder(call.result ?? null)
    } catch (err) {
      console.error('sales.quotes.accept', err)
      setError('Failed to accept quote.')
    } finally {
      setAccepting(false)
    }
  }, [token])

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4 animate-spin" />
          Loading quote…
        </p>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-2">
        <h1 className="text-2xl font-semibold">Quote</h1>
        <p className="text-sm text-destructive">{error ?? 'Quote not found.'}</p>
      </main>
    )
  }

  if (acceptedOrder) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-2">
        <h1 className="text-2xl font-semibold">Quote accepted</h1>
        <p className="text-sm text-muted-foreground">Order created: {acceptedOrder.orderNumber}</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Quote {data.quote.quoteNumber}</h1>
        <p className="text-sm text-muted-foreground">
          {data.quote.validUntil ? `Valid until ${new Date(data.quote.validUntil).toLocaleDateString()}` : 'No validity date'}
        </p>
      </header>

      {data.isExpired ? (
        <section className="rounded-lg border p-4">
          <p className="font-medium">This quote has expired.</p>
          <p className="text-sm text-muted-foreground">Please contact the seller to request an updated quote.</p>
        </section>
      ) : null}

      <section className="rounded-lg border p-4 space-y-3">
        <h2 className="font-medium">Items</h2>
        <div className="space-y-2">
          {data.lines.map((line) => (
            <div key={`${line.lineNumber ?? 'x'}-${line.name ?? ''}`} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{line.name ?? 'Item'}</p>
                {line.description ? <p className="text-sm text-muted-foreground">{line.description}</p> : null}
                <p className="text-sm text-muted-foreground">
                  Qty: {line.quantity}
                  {line.quantityUnit ? ` ${line.quantityUnit}` : ''}
                </p>
              </div>
              <div className="text-right text-sm">
                <p>
                  {line.totalGrossAmount} {line.currencyCode}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border p-4 space-y-2">
        <h2 className="font-medium">Totals</h2>
        <div className="flex items-center justify-between text-sm">
          <span>Subtotal (gross)</span>
          <span>
            {data.quote.subtotalGrossAmount} {data.quote.currencyCode}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>Discount</span>
          <span>
            {data.quote.discountTotalAmount} {data.quote.currencyCode}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>Tax</span>
          <span>
            {data.quote.taxTotalAmount} {data.quote.currencyCode}
          </span>
        </div>
        <div className="flex items-center justify-between font-medium">
          <span>Total</span>
          <span>
            {data.quote.grandTotalGrossAmount} {data.quote.currencyCode}
          </span>
        </div>
      </section>

      {!data.isExpired ? (
        <div className="space-y-2">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button onClick={() => void handleAccept()} disabled={accepting}>
            {accepting ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
            Accept quote
          </Button>
        </div>
      ) : null}
    </main>
  )
}


