"use client"

import * as React from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type PaymentLinkContext = {
  refreshLink?: () => Promise<void>
}

type PaymentLinkData = {
  link: {
    status: string
    amount: number
    currencyCode: string
  }
  transaction: {
    clientSecret?: string | null
    gatewayMetadata?: Record<string, unknown> | null
    unifiedStatus: string
  }
}

function formatAmount(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`
  }
}

function CheckoutForm({ context, data }: { context: PaymentLinkContext; data: PaymentLinkData }) {
  const t = useT()
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)

  const handleSubmit = React.useCallback(async () => {
    if (!stripe || !elements) return
    setSubmitting(true)
    setMessage(null)
    const result = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    })
    if (result.error) {
      setMessage(result.error.message ?? t('gateway_stripe.paymentLink.error', 'Unable to complete the payment.'))
      setSubmitting(false)
      return
    }
    await context.refreshLink?.()
    setMessage(t('gateway_stripe.paymentLink.success', 'Payment submitted successfully.'))
    setSubmitting(false)
  }, [context, elements, stripe, t])

  if (data.link.status === 'completed' || ['authorized', 'captured', 'partially_captured'].includes(data.transaction.unifiedStatus)) {
    return (
      <div className="rounded-3xl border border-emerald-300/70 bg-emerald-50 px-6 py-5 text-sm text-emerald-900">
        {t('gateway_stripe.paymentLink.alreadyPaid', 'This payment has already been completed.')}
      </div>
    )
  }

  return (
    <div className="space-y-5 rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_20px_70px_-30px_rgba(15,23,42,0.35)]">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-950">
          {t('gateway_stripe.paymentLink.title', 'Secure card payment')}
        </h2>
        <p className="text-sm text-slate-600">
          {t('gateway_stripe.paymentLink.subtitle', 'Pay securely with Stripe on this page.')}
        </p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      <Button type="button" className="w-full" onClick={() => void handleSubmit()} disabled={!stripe || !elements || submitting}>
        {submitting ? <Spinner className="mr-2 h-4 w-4" /> : null}
        {t('gateway_stripe.paymentLink.submit', 'Pay {{amount}}', {
          amount: formatAmount(data.link.amount, data.link.currencyCode),
        })}
      </Button>
    </div>
  )
}

export default function StripePaymentLinkWidget({ context, data }: InjectionWidgetComponentProps<PaymentLinkContext, PaymentLinkData>) {
  const publishableKey =
    data?.transaction?.gatewayMetadata && typeof data.transaction.gatewayMetadata.publishableKey === 'string'
      ? data.transaction.gatewayMetadata.publishableKey
      : null
  const clientSecret = data?.transaction?.clientSecret ?? null

  const stripePromise = React.useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  )

  if (!stripePromise || !clientSecret || !data) {
    return null
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CheckoutForm context={context ?? {}} data={data} />
    </Elements>
  )
}
