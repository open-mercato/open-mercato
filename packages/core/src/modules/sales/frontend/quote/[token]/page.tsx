"use client"

import * as React from 'react'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { SearchX } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type { SalesRecurrenceFrequency } from '../../../lib/recurrence'
import { formatRecurrenceSchedule, formatRecurringTotalLabel } from '../../../lib/recurrenceLabel'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportTelemetryError } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('sales')

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
  recurrence: {
    frequency: SalesRecurrenceFrequency
    startsOn: string
    periodCount: number | null
    endsOn: string | null
  } | null
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
  isRecurrenceStarted?: boolean
}

export default function QuotePublicPage({ params }: { params: { token: string } }) {
  const t = useT()
  const locale = useLocale()
  const token = params?.token
  const [loading, setLoading] = React.useState(true)
  const [accepting, setAccepting] = React.useState(false)
  const [data, setData] = React.useState<PublicQuoteResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [acceptError, setAcceptError] = React.useState<'started' | 'failed' | null>(null)
  const [acceptedOrder, setAcceptedOrder] = React.useState<{ orderId: string; orderNumber: string } | null>(null)

  React.useEffect(() => {
    let mounted = true
    async function run() {
      if (!token) return
      setLoading(true)
      setError(null)
      setAcceptError(null)
      try {
        const call = await apiCallOrThrow<PublicQuoteResponse>(`/api/sales/quotes/public/${token}`, {
          method: 'GET',
        })
        if (!mounted) return
        setData(call.result ?? null)
      } catch (err) {
        logger.error('sales.quotes.public.load', { err })
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
    setAcceptError(null)
    try {
      const call = await apiCallOrThrow<{ orderId: string; orderNumber: string }>(`/api/sales/quotes/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      setAcceptedOrder(call.result ?? null)
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'recurring_quote_started') {
        setAcceptError('started')
      } else {
        logger.error('sales.quotes.accept', { err })
        reportTelemetryError(err, { module: 'sales', code: 'sales.public_quote_accept_failed' })
        setAcceptError('failed')
      }
    } finally {
      setAccepting(false)
    }
  }, [token])

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
        <EmptyState
          variant="subtle"
          size="lg"
          icon={<SearchX className="h-6 w-6" aria-hidden />}
          title={error ?? t('sales.quotes.public.notFound')}
        />
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

  const recurrenceStarted = data.isRecurrenceStarted || acceptError === 'started'

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('sales.quotes.public.pageTitle')} {data.quote.quoteNumber}</h1>
        <p className="text-sm text-muted-foreground">
          {data.quote.validUntil ? t('sales.quotes.public.validUntil', { date: new Date(data.quote.validUntil).toLocaleDateString() }) : t('sales.quotes.public.noValidityDate')}
        </p>
        {data.recurrence ? (
          <p className="text-sm font-medium" data-testid="public-quote-recurrence">
            {formatRecurrenceSchedule(data.recurrence, t, locale)}
          </p>
        ) : null}
      </header>

      {recurrenceStarted || data.isExpired ? (
        <section className="rounded-lg border p-4">
          <p className="font-medium">
            {recurrenceStarted
              ? t('sales.quotes.public.recurrenceStarted', 'The billing start date has passed, so this quote can no longer be accepted.')
              : t('sales.quotes.public.expired')}
          </p>
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
          <span>{formatRecurringTotalLabel(t('sales.quotes.public.total'), data.recurrence?.frequency, t)}</span>
          <span>
            {data.quote.grandTotalGrossAmount} {data.quote.currencyCode}
          </span>
        </div>
      </section>

      {acceptError === 'failed' ? (
        <Alert status="error">
          <AlertDescription>{t('sales.quotes.public.acceptFailed')}</AlertDescription>
        </Alert>
      ) : null}
      {!data.isExpired && !recurrenceStarted ? (
        <div className="space-y-2">
          <Button type="button" onClick={() => void handleAccept()} disabled={accepting}>
            {accepting ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('sales.quotes.public.acceptButton')}
          </Button>
        </div>
      ) : null}
    </main>
  )
}

