"use client"

import * as React from 'react'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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
    normalizedQuantity: string
    normalizedUnit: string | null
    unitPriceReference?: {
      referenceUnitCode?: string | null
      referenceUnit?: string | null
      grossPerReference?: string | null
      netPerReference?: string | null
    } | null
    currencyCode: string
    totalGrossAmount: string
  }>
  isExpired: boolean
}

export default function QuotePublicPage({ params }: { params: { token: string } }) {
  const t = useT()
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
        setError(t('sales.quotes.public.failed'))
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void run()
    return () => {
      mounted = false
    }
  }, [token, t])

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
      setError(t('sales.quotes.public.acceptFailed'))
    } finally {
      setAccepting(false)
    }
  }, [token, t])

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4 animate-spin" />
          {t('sales.quotes.public.loading')}
        </p>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-2">
        <h1 className="text-2xl font-semibold">{t('sales.quotes.public.pageTitle')}</h1>
        <p className="text-sm text-destructive">{error ?? t('sales.quotes.public.notFound')}</p>
      </main>
    )
  }

  if (acceptedOrder) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-2">
        <h1 className="text-2xl font-semibold">{t('sales.quotes.public.acceptedTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('sales.quotes.public.acceptedMessage', { orderNumber: acceptedOrder.orderNumber })}</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('sales.quotes.public.pageTitle')} {data.quote.quoteNumber}</h1>
        <p className="text-sm text-muted-foreground">
          {data.quote.validUntil ? t('sales.quotes.public.validUntil', { date: new Date(data.quote.validUntil).toLocaleDateString() }) : t('sales.quotes.public.noValidityDate')}
        </p>
      </header>

      {data.isExpired ? (
        <section className="rounded-lg border p-4">
          <p className="font-medium">{t('sales.quotes.public.expired')}</p>
          <p className="text-sm text-muted-foreground">{t('sales.quotes.public.expiredMessage')}</p>
        </section>
      ) : null}

      <section className="rounded-lg border p-4 space-y-3">
        <h2 className="font-medium">{t('sales.quotes.public.items')}</h2>
        <div className="space-y-2">
          {data.lines.map((line) => (
            <div key={`${line.lineNumber ?? 'x'}-${line.name ?? ''}`} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{line.name ?? t('sales.quotes.public.item')}</p>
                {line.description ? <p className="text-sm text-muted-foreground">{line.description}</p> : null}
                <p className="text-sm text-muted-foreground">
                  {t('sales.quotes.public.qty', { quantity: line.quantity })}
                  {line.quantityUnit ? ` ${line.quantityUnit}` : ''}
                </p>
                {line.normalizedUnit && (line.normalizedUnit !== line.quantityUnit || line.normalizedQuantity !== line.quantity) ? (
                  <p className="text-xs text-muted-foreground">
                    {line.normalizedQuantity} {line.normalizedUnit}
                  </p>
                ) : null}
                {(line.unitPriceReference?.grossPerReference || line.unitPriceReference?.netPerReference) ? (
                  <p className="text-xs text-muted-foreground">
                    {(line.unitPriceReference?.grossPerReference ?? line.unitPriceReference?.netPerReference) ?? ''}{' '}
                    {line.currencyCode}{' '}
                    {t('sales.quotes.public.perReferenceUnit', 'per 1 {{unit}}', {
                      unit:
                        line.unitPriceReference?.referenceUnitCode ??
                        line.unitPriceReference?.referenceUnit ??
                        t('sales.quotes.public.defaultUnit', 'unit'),
                    })}
                  </p>
                ) : null}
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
        <h2 className="font-medium">{t('sales.quotes.public.totals')}</h2>
        <div className="flex items-center justify-between text-sm">
          <span>{t('sales.quotes.public.subtotalGross')}</span>
          <span>
            {data.quote.subtotalGrossAmount} {data.quote.currencyCode}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>{t('sales.quotes.public.discount')}</span>
          <span>
            {data.quote.discountTotalAmount} {data.quote.currencyCode}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>{t('sales.quotes.public.tax')}</span>
          <span>
            {data.quote.taxTotalAmount} {data.quote.currencyCode}
          </span>
        </div>
        <div className="flex items-center justify-between font-medium">
          <span>{t('sales.quotes.public.total')}</span>
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
            {t('sales.quotes.public.acceptButton')}
          </Button>
        </div>
      ) : null}
    </main>
  )
}

