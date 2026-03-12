"use client"

import * as React from 'react'
import { AddressElement, Elements, LinkAuthenticationElement, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe, type StripeElementLocale } from '@stripe/stripe-js'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { resolveStripePaymentLinkConfig, type StripePaymentLinkConfig } from '../../../lib/payment-link-config'

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

type BillingAddressValue = {
  name?: string | null
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  address?: {
    line1?: string | null
    line2?: string | null
    city?: string | null
    state?: string | null
    postal_code?: string | null
    country?: string | null
  }
}

function readPaymentLinkConfig(data: PaymentLinkData | undefined): StripePaymentLinkConfig {
  const rawConfig =
    data?.transaction?.gatewayMetadata &&
    typeof data.transaction.gatewayMetadata.paymentLinkConfig === 'object' &&
    data.transaction.gatewayMetadata.paymentLinkConfig !== null
      ? data.transaction.gatewayMetadata.paymentLinkConfig as Record<string, unknown>
      : null

  return resolveStripePaymentLinkConfig(rawConfig)
}

function resolveStripeElementsLocale(locale: string): StripeElementLocale {
  if (locale === 'pl' || locale === 'es' || locale === 'de') return locale
  return 'en'
}

function formatAmount(amount: number, currencyCode: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`
  }
}

function buildBillingName(addressValue: BillingAddressValue | null): string | undefined {
  if (!addressValue) return undefined

  const firstName = typeof addressValue.firstName === 'string' ? addressValue.firstName.trim() : ''
  const lastName = typeof addressValue.lastName === 'string' ? addressValue.lastName.trim() : ''
  const fullName = typeof addressValue.name === 'string' ? addressValue.name.trim() : ''
  const splitName = [firstName, lastName].filter(Boolean).join(' ').trim()

  return splitName || fullName || undefined
}

function buildBillingDetails(
  email: string,
  addressValue: BillingAddressValue | null,
): {
  email?: string
  name?: string
  phone?: string
  address?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postal_code?: string
    country?: string
  }
} | undefined {
  const trimmedEmail = email.trim()
  const name = buildBillingName(addressValue)
  const phone = typeof addressValue?.phone === 'string' ? addressValue.phone.trim() : ''
  const address = addressValue?.address
    ? {
        line1: typeof addressValue.address.line1 === 'string' ? addressValue.address.line1.trim() : undefined,
        line2: typeof addressValue.address.line2 === 'string' ? addressValue.address.line2.trim() : undefined,
        city: typeof addressValue.address.city === 'string' ? addressValue.address.city.trim() : undefined,
        state: typeof addressValue.address.state === 'string' ? addressValue.address.state.trim() : undefined,
        postal_code:
          typeof addressValue.address.postal_code === 'string'
            ? addressValue.address.postal_code.trim()
            : undefined,
        country: typeof addressValue.address.country === 'string' ? addressValue.address.country.trim() : undefined,
      }
    : undefined

  const normalizedAddress = address && Object.values(address).some(Boolean) ? address : undefined
  if (!trimmedEmail && !name && !phone && !normalizedAddress) return undefined

  return {
    email: trimmedEmail || undefined,
    name,
    phone: phone || undefined,
    address: normalizedAddress,
  }
}

function CheckoutForm({
  context,
  data,
  config,
}: {
  context: PaymentLinkContext
  data: PaymentLinkData
  config: StripePaymentLinkConfig
}) {
  const t = useT()
  const locale = useLocale()
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [email, setEmail] = React.useState('')
  const [addressComplete, setAddressComplete] = React.useState(false)
  const [addressValue, setAddressValue] = React.useState<BillingAddressValue | null>(null)

  const handleSubmit = React.useCallback(async () => {
    if (!stripe || !elements) return
    if (config.showLinkAuthentication && !email.trim()) {
      setMessage(t('gateway_stripe.paymentLink.emailRequired', 'Enter an email address to continue.'))
      return
    }
    if (config.showBillingAddress && !addressComplete) {
      setMessage(t('gateway_stripe.paymentLink.addressRequired', 'Complete the billing details to continue.'))
      return
    }

    setSubmitting(true)
    setMessage(null)
    const billingDetails = buildBillingDetails(email, addressValue)
    const result = config.allowRedirects === 'always'
      ? await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url: window.location.href,
            payment_method_data: billingDetails
              ? {
                  billing_details: billingDetails,
                }
              : undefined,
          },
          redirect: 'always',
        })
      : await stripe.confirmPayment({
          elements,
          confirmParams: billingDetails
            ? {
                payment_method_data: {
                  billing_details: billingDetails,
                },
              }
            : undefined,
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
  }, [addressComplete, addressValue, config.allowRedirects, config.showBillingAddress, config.showLinkAuthentication, context, elements, email, stripe, t])

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
          {config.paymentMethodMode === 'automatic'
            ? t('gateway_stripe.paymentLink.subtitleAutomatic', 'Choose a Stripe-supported payment method and complete payment securely on this page.')
            : t('gateway_stripe.paymentLink.subtitle', 'Pay securely with Stripe on this page.')}
        </p>
      </div>
      {config.showLinkAuthentication ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="mb-3 text-sm font-medium text-slate-900">
            {t('gateway_stripe.paymentLink.contactTitle', 'Contact')}
          </div>
          <LinkAuthenticationElement
            onChange={(event) => {
              setEmail(event.value.email)
            }}
          />
        </div>
      ) : null}
      {config.showBillingAddress ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="mb-3 text-sm font-medium text-slate-900">
            {t('gateway_stripe.paymentLink.billingTitle', 'Billing details')}
          </div>
          <AddressElement
            options={{
              mode: 'billing',
              display: {
                name: config.billingNameDisplay,
              },
              fields: {
                phone: 'auto',
              },
            }}
            onChange={(event) => {
              setAddressComplete(event.complete)
              setAddressValue(event.value as BillingAddressValue)
            }}
          />
        </div>
      ) : null}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <PaymentElement
          options={{
            layout: config.paymentElementLayout,
            fields:
              config.billingDetailsCollection === 'separate'
                ? {
                    billingDetails: {
                      name: 'never',
                      email: 'never',
                      address: 'never',
                    },
                  }
                : {
                    billingDetails: 'auto',
                  },
            wallets:
              config.paymentMethodMode === 'automatic'
                ? {
                    applePay: 'auto',
                    googlePay: 'auto',
                    link: 'auto',
                  }
                : {
                    applePay: 'auto',
                    googlePay: 'auto',
                    link: config.showLinkAuthentication ? 'auto' : 'never',
                  },
          }}
        />
      </div>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      <Button type="button" className="w-full" onClick={() => void handleSubmit()} disabled={!stripe || !elements || submitting}>
        {submitting ? <Spinner className="mr-2 h-4 w-4" /> : null}
        {t('gateway_stripe.paymentLink.submit', 'Pay {{amount}}', {
          amount: formatAmount(data.link.amount, data.link.currencyCode, locale),
        })}
      </Button>
    </div>
  )
}

export default function StripePaymentLinkWidget({ context, data }: InjectionWidgetComponentProps<PaymentLinkContext, PaymentLinkData>) {
  const locale = useLocale()
  const publishableKey =
    data?.transaction?.gatewayMetadata && typeof data.transaction.gatewayMetadata.publishableKey === 'string'
      ? data.transaction.gatewayMetadata.publishableKey
      : null
  const clientSecret = data?.transaction?.clientSecret ?? null
  const config = React.useMemo(() => readPaymentLinkConfig(data), [data])

  const stripePromise = React.useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  )

  if (!stripePromise || !clientSecret || !data) {
    return null
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, locale: resolveStripeElementsLocale(locale) }}>
      <CheckoutForm context={context ?? {}} data={data} config={config} />
    </Elements>
  )
}
