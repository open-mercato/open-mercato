"use client"

import * as React from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import type { StripePaymentElementOptions } from '@stripe/stripe-js'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  registerEmbeddedPaymentGatewayRenderer,
  type EmbeddedPaymentGatewayRendererProps,
} from '@open-mercato/shared/modules/payment_gateways/client'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { StripePaymentElementSettings } from '../../lib/shared'

type StripeRendererPayload = {
  clientSecret?: string
  publishableKey?: string
  returnUrl?: string
}

function readStripePayload(payload: Record<string, unknown> | undefined): StripeRendererPayload {
  return {
    clientSecret: typeof payload?.clientSecret === 'string' ? payload.clientSecret : undefined,
    publishableKey: typeof payload?.publishableKey === 'string' ? payload.publishableKey : undefined,
    returnUrl: typeof payload?.returnUrl === 'string' ? payload.returnUrl : undefined,
  }
}

function resolveAppearanceVariables(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {
      colorPrimary: '#111827',
      colorText: '#111827',
      colorDanger: '#dc2626',
      colorTextPlaceholder: '#6b7280',
    }
  }
  const styles = window.getComputedStyle(document.documentElement)
  return {
    colorPrimary: `hsl(${styles.getPropertyValue('--foreground').trim() || '222.2 84% 4.9%'})`,
    colorText: `hsl(${styles.getPropertyValue('--foreground').trim() || '222.2 84% 4.9%'})`,
    colorDanger: `hsl(${styles.getPropertyValue('--destructive').trim() || '0 84.2% 60.2%'})`,
    colorTextPlaceholder: `hsl(${styles.getPropertyValue('--muted-foreground').trim() || '215.4 16.3% 46.9%'})`,
  }
}

function readRendererSettings(session: EmbeddedPaymentGatewayRendererProps['session']): StripePaymentElementSettings {
  const settings = session.settings
  const layout = settings?.layout === 'tabs' || settings?.layout === 'accordion'
    ? settings.layout
    : undefined
  const billingDetails = settings?.billingDetails === 'auto'
    || settings?.billingDetails === 'never'
    || settings?.billingDetails === 'if_required'
    ? settings.billingDetails
    : undefined
  const paymentMethodOrder = Array.isArray(settings?.paymentMethodOrder)
    ? settings.paymentMethodOrder.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []

  return {
    ...(layout ? { layout } : {}),
    ...(billingDetails ? { billingDetails } : {}),
    ...(paymentMethodOrder.length > 0 ? { paymentMethodOrder } : {}),
  }
}

function buildPaymentElementOptions(
  rendererSettings: StripePaymentElementSettings,
): StripePaymentElementOptions {
  const options: StripePaymentElementOptions = {}

  if (rendererSettings.layout) {
    options.layout = rendererSettings.layout
  }

  if (rendererSettings.paymentMethodOrder?.length) {
    options.paymentMethodOrder = rendererSettings.paymentMethodOrder
  }

  if (rendererSettings.billingDetails === 'auto' || rendererSettings.billingDetails === 'never') {
    options.fields = {
      billingDetails: {
        name: rendererSettings.billingDetails,
        email: rendererSettings.billingDetails,
        phone: rendererSettings.billingDetails,
        address: rendererSettings.billingDetails,
      },
    }
  } else if (rendererSettings.billingDetails === 'if_required') {
    options.fields = {
      billingDetails: {
        address: 'if_required',
      },
    }
  }

  return options
}

function StripeEmbeddedPaymentForm({
  returnUrl,
  disabled = false,
  onComplete,
  onError,
}: {
  returnUrl?: string
  disabled?: boolean
  onComplete: () => void
  onError: (message: string) => void
}) {
  const t = useT()
  const stripe = useStripe()
  const elements = useElements()
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleSubmit = React.useCallback(async () => {
    if (!stripe || !elements) {
      onError(t('gateway_stripe.payments.notReady', 'The Stripe payment form is still loading.'))
      return
    }
    setIsSubmitting(true)
    onError('')
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: returnUrl ? { return_url: returnUrl } : undefined,
        redirect: 'if_required',
      })
      if (result.error) {
        onError(result.error.message ?? t('gateway_stripe.payments.failed', 'Stripe could not confirm the payment.'))
        return
      }
      onComplete()
    } catch (error) {
      onError(error instanceof Error ? error.message : t('gateway_stripe.payments.failed', 'Stripe could not confirm the payment.'))
    } finally {
      setIsSubmitting(false)
    }
  }, [elements, onComplete, onError, returnUrl, stripe, t])

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">
        {t('gateway_stripe.payments.helper', 'Use Stripe test mode cards or wallets configured for this account.')}
      </p>
      <Button
        type="button"
        disabled={disabled || isSubmitting || !stripe || !elements}
        onClick={() => { void handleSubmit() }}
      >
        {isSubmitting ? <Spinner className="mr-2 size-4" /> : null}
        {isSubmitting
          ? t('gateway_stripe.payments.processing', 'Confirming payment...')
          : t('gateway_stripe.payments.submit', 'Pay securely')}
      </Button>
    </div>
  )
}

function StripeEmbeddedPaymentRenderer(props: EmbeddedPaymentGatewayRendererProps) {
  const t = useT()
  const payload = readStripePayload(props.session.payload)
  const rendererSettings = React.useMemo(() => readRendererSettings(props.session), [props.session])
  const paymentElementOptions = React.useMemo(
    () => buildPaymentElementOptions(rendererSettings),
    [rendererSettings],
  )
  const onError = props.onError
  const stripePromise = React.useMemo(
    () => (payload.publishableKey ? loadStripe(payload.publishableKey) : null),
    [payload.publishableKey],
  )
  const appearance = React.useMemo(
    () => ({
      theme: 'stripe' as const,
      variables: resolveAppearanceVariables(),
      rules: {
        '.Input': {
          borderRadius: '14px',
        },
      },
    }),
    [],
  )

  React.useEffect(() => {
    if (!payload.publishableKey || !payload.clientSecret) {
      onError(t('gateway_stripe.payments.unavailable', 'Stripe is configured for embedded checkout, but the public payment form could not be prepared.'))
    }
  }, [onError, payload.clientSecret, payload.publishableKey, t])

  if (!payload.publishableKey || !payload.clientSecret || !stripePromise) {
    return null
  }

  return (
    <div className="space-y-3 rounded-[24px] border border-border/70 bg-white/80 p-4 shadow-sm backdrop-blur">
      <div className="space-y-1">
        <p className="text-sm font-semibold">{t('gateway_stripe.payments.title', 'Secure Stripe payment')}</p>
        <p className="text-sm text-muted-foreground">
          {t('gateway_stripe.payments.description', 'Complete the payment below without leaving this page.')}
        </p>
      </div>
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: payload.clientSecret,
          appearance,
        }}
      >
        <div className="space-y-4">
          <div className="rounded-2xl border bg-background px-4 py-4 shadow-sm">
            <PaymentElement options={paymentElementOptions} />
          </div>
          <StripeEmbeddedPaymentForm
            returnUrl={payload.returnUrl}
            disabled={props.disabled}
            onComplete={props.onComplete}
            onError={onError}
          />
        </div>
      </Elements>
    </div>
  )
}

registerEmbeddedPaymentGatewayRenderer({
  providerKey: 'stripe',
  rendererKey: 'stripe.payment_element',
  Component: StripeEmbeddedPaymentRenderer,
})

export default null
