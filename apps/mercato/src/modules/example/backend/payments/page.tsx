"use client"

import * as React from 'react'
import { useState, useEffect } from 'react'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { WebhookSetupGuide } from '@open-mercato/ui/backend/WebhookSetupGuide'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { stripeWebhookSetupGuide } from '@open-mercato/gateway-stripe/modules/gateway_stripe/webhook-guide'
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import {
  CreditCard,
  RefreshCw,
  Ban,
  ArrowDownToLine,
  Undo2,
  CheckCircle2,
  AlertCircle,
  Info,
  Zap,
} from 'lucide-react'

interface TransactionState {
  transactionId: string
  sessionId: string
  providerKey?: string
  status: string
  paymentId: string
  clientSecret?: string
  redirectUrl?: string
  providerData?: {
    publishableKey?: string | null
    paymentIntentId?: string | null
  } | null
}

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  authorized: 'default',
  captured: 'default',
  partially_captured: 'default',
  refunded: 'outline',
  partially_refunded: 'outline',
  cancelled: 'destructive',
  failed: 'destructive',
  expired: 'secondary',
}

function mapStripeIntentStatus(status: string | undefined): string {
  if (!status) return 'pending'
  if (status === 'requires_capture') return 'authorized'
  if (status === 'succeeded') return 'captured'
  if (status === 'canceled') return 'cancelled'
  if (status === 'requires_payment_method' || status === 'requires_action' || status === 'processing') return 'pending'
  return status
}

type StripePaymentPanelProps = {
  clientSecret: string
  publishableKey: string
  disabled?: boolean
  onError: (message: string) => void
  onSuccess: (message: string, nextStatus?: string) => void
}

function StripePaymentPanel({
  clientSecret,
  publishableKey,
  disabled = false,
  onError,
  onSuccess,
}: StripePaymentPanelProps) {
  const stripePromise = React.useMemo(() => loadStripe(publishableKey), [publishableKey])

  return (
    <Elements stripe={stripePromise}>
      <StripePaymentForm
        clientSecret={clientSecret}
        disabled={disabled}
        onError={onError}
        onSuccess={onSuccess}
      />
    </Elements>
  )
}

type StripePaymentFormProps = {
  clientSecret: string
  disabled?: boolean
  onError: (message: string) => void
  onSuccess: (message: string, nextStatus?: string) => void
}

type StripeElementPalette = {
  text: string
  placeholder: string
  danger: string
}

const DEFAULT_STRIPE_ELEMENT_PALETTE: StripeElementPalette = {
  text: '#f5f5f5',
  placeholder: '#a1a1aa',
  danger: '#ef4444',
}

function resolveThemeColor(expression: string, fallback: string): string {
  if (typeof window === 'undefined' || !document.body) return fallback
  const probe = document.createElement('div')
  probe.style.color = expression
  probe.style.position = 'absolute'
  probe.style.pointerEvents = 'none'
  probe.style.opacity = '0'
  document.body.appendChild(probe)
  const resolved = window.getComputedStyle(probe).color
  probe.remove()
  return resolved && resolved !== '' ? resolved : fallback
}

function StripePaymentForm({
  clientSecret,
  disabled = false,
  onError,
  onSuccess,
}: StripePaymentFormProps) {
  const t = useT()
  const stripe = useStripe()
  const elements = useElements()
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [palette, setPalette] = React.useState<StripeElementPalette>(DEFAULT_STRIPE_ELEMENT_PALETTE)

  React.useEffect(() => {
    setPalette({
      text: resolveThemeColor('hsl(var(--foreground))', DEFAULT_STRIPE_ELEMENT_PALETTE.text),
      placeholder: resolveThemeColor('hsl(var(--muted-foreground))', DEFAULT_STRIPE_ELEMENT_PALETTE.placeholder),
      danger: resolveThemeColor('hsl(var(--destructive))', DEFAULT_STRIPE_ELEMENT_PALETTE.danger),
    })
  }, [])

  const handleConfirmPayment = React.useCallback(async () => {
    if (!stripe || !elements) return
    const cardElement = elements.getElement(CardElement)
    if (!cardElement) {
      onError(t('example.payments.stripe.form.notReady', 'Payment form is not ready yet.'))
      return
    }

    setIsSubmitting(true)
    onError('')

    try {
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
        },
      })

      if (result.error) {
        onError(result.error.message ?? t('example.payments.stripe.form.confirmFailed', 'Stripe payment confirmation failed.'))
        return
      }

      const paymentIntentStatus = result.paymentIntent?.status
      const nextStatus = mapStripeIntentStatus(paymentIntentStatus)
      const successMessage = paymentIntentStatus === 'requires_capture'
        ? t('example.payments.stripe.form.authorized', 'Payment authorized successfully. Use Capture to settle the funds.')
        : t('example.payments.stripe.form.confirmed', 'Payment confirmed successfully.')

      onSuccess(successMessage, nextStatus)
    } catch (error) {
      onError(error instanceof Error ? error.message : t('example.payments.stripe.form.confirmFailed', 'Stripe payment confirmation failed.'))
    } finally {
      setIsSubmitting(false)
    }
  }, [clientSecret, elements, onError, onSuccess, stripe, t])

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold">{t('example.payments.stripe.form.title', 'Complete Stripe payment')}</p>
        <p className="text-sm text-muted-foreground">
          {t('example.payments.stripe.form.description', 'Enter a test card, confirm the payment, then use Capture if the payment becomes authorized.')}
        </p>
      </div>

      <div className="rounded-md border bg-background px-3 py-3">
        <CardElement
          options={{
            hidePostalCode: true,
            style: {
              base: {
                color: palette.text,
                fontSize: '16px',
                iconColor: palette.text,
                '::placeholder': {
                  color: palette.placeholder,
                },
              },
              invalid: {
                color: palette.danger,
                iconColor: palette.danger,
              },
            },
          }}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={() => void handleConfirmPayment()}
          disabled={disabled || isSubmitting || !stripe || !elements}
        >
          {isSubmitting ? <Spinner className="mr-2 size-4" /> : <CreditCard className="mr-2 size-4" />}
          {t('example.payments.stripe.form.submit', 'Confirm test payment')}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t('example.payments.stripe.form.testCard', 'Use Stripe test card `4242 4242 4242 4242`, any future date, any CVC.')}
        </p>
      </div>
    </div>
  )
}

export default function PaymentGatewayDemoPage() {
  const t = useT()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transaction, setTransaction] = useState<TransactionState | null>(null)
  const [actionResult, setActionResult] = useState<string | null>(null)
  const [stripeAvailable, setStripeAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    async function checkStripe() {
      const response = await apiCall<{ hasCredentials: boolean; state?: { isEnabled?: boolean | null } | null }>(
        '/api/integrations/gateway_stripe',
        undefined,
        { fallback: null },
      )
      setStripeAvailable(
        response.ok
        && response.result?.hasCredentials === true
        && response.result?.state?.isEnabled === true,
      )
    }
    void checkStripe()
  }, [])

  async function createSession(providerKey: string) {
    setLoading(true)
    setError(null)
    setActionResult(null)
    try {
      const response = await apiCall('/api/payment_gateways/sessions', {
        method: 'POST',
        body: JSON.stringify({
          providerKey,
          amount: 49.99,
          currencyCode: 'USD',
          captureMethod: 'manual',
          description: `Test payment via ${providerKey}`,
        }),
      })
      if (!response.ok) {
        const body = response.result as { error?: string } | null
        if (response.status === 403) {
          setError(t('example.payments.error.forbidden', 'You do not have permission to create payment sessions. Check your role permissions.'))
        } else if (response.status === 422) {
          setError(t('example.payments.error.providerNotFound', 'Payment provider not found. Make sure the gateway adapter is registered.'))
        } else {
          setError(body?.error ?? t('example.payments.error.http', 'HTTP {status}', { status: String(response.status) }))
        }
        return
      }
      const data = response.result as TransactionState | null
      if (!data) {
        setError(t('example.payments.error.invalidResponse', 'Invalid response payload'))
        return
      }
      if (data.redirectUrl) {
        window.open(data.redirectUrl, '_blank', 'noopener,noreferrer')
      }
      setTransaction(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('example.payments.error.unknown', 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  async function performAction(action: 'capture' | 'refund' | 'cancel') {
    if (!transaction) return
    setLoading(true)
    setError(null)
    setActionResult(null)
    try {
      const response = await apiCall(`/api/payment_gateways/${action}`, {
        method: 'POST',
        body: JSON.stringify({ transactionId: transaction.transactionId }),
      })
      const data = response.result as { status?: string; error?: string } | null
      if (!response.ok) {
        setError(data?.error ?? t(`example.payments.error.${action}Failed`, '{action} failed', {
          action: t(`example.payments.action.${action}`, action),
        }))
        return
      }
      setActionResult(t('example.payments.success.action', '{action} successful: status = {status}', {
        action: t(`example.payments.action.${action}`, action),
        status: t(`payment_gateways.status.${data?.status ?? 'unknown'}`, data?.status ?? 'unknown'),
      }))
      await refreshStatus()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('example.payments.error.unknown', 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  async function refreshStatus() {
    if (!transaction) return
    try {
      const response = await apiCall(`/api/payment_gateways/status?transactionId=${transaction.transactionId}`)
      if (response.ok) {
        const data = response.result as { status?: string } | null
        setTransaction((prev) => prev ? { ...prev, status: data?.status ?? prev.status } : prev)
      } else {
        setError(t('example.payments.error.refreshFailed', 'Failed to refresh payment status.'))
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('example.payments.error.refreshFailed', 'Failed to refresh payment status.'))
    }
  }

  const canCapture = transaction?.status === 'authorized'
  const canRefund = transaction?.status === 'captured' || transaction?.status === 'partially_captured'
  const canCancel = transaction?.status === 'authorized' || transaction?.status === 'pending'
  const stripePublishableKey = typeof transaction?.providerData?.publishableKey === 'string'
    ? transaction.providerData.publishableKey
    : undefined
  const showStripePaymentPanel = transaction?.providerKey === 'stripe'
    && typeof transaction.clientSecret === 'string'
    && transaction.clientSecret.length > 0
    && typeof stripePublishableKey === 'string'
    && stripePublishableKey.length > 0
    && !transaction.redirectUrl
    && transaction.status === 'pending'

  return (
    <Page>
      <PageHeader
        title={t('example.payments.title', 'Payment Gateway Demo')}
        description={t('example.payments.description', 'Test payment gateway integrations with mock or real providers')}
      />
      <PageBody>
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Setup Instructions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="size-5 text-muted-foreground" />
                {t('example.payments.setup.title', 'How to Configure Payment Gateways')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-1">
                  <Zap className="size-4 text-emerald-500" />
                  {t('example.payments.setup.mock', 'Mock Gateway (No Configuration Needed)')}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {t('example.payments.setup.mockDesc', 'The mock gateway works out of the box. Click "Pay with Mock Gateway" below to test the full payment lifecycle: create session, capture, refund, and cancel.')}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-1">
                  <CreditCard className="size-4 text-indigo-500" />
                  {t('example.payments.setup.stripe', 'Stripe Gateway')}
                </h4>
                <p className="mb-2 text-sm text-muted-foreground">
                  {t(
                    'example.payments.setup.webhookSummary',
                    'Stripe credentials are configured in Integrations, and a webhook endpoint is recommended so payment lifecycle updates stay synchronized.',
                  )}
                </p>
                <WebhookSetupGuide
                  guide={stripeWebhookSetupGuide}
                  buttonLabel={t('example.payments.setup.showWebhookGuide', 'Show me how to configure webhook')}
                />
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={() => createSession('mock')}
              disabled={loading}
            >
              {loading ? <Spinner className="mr-2 size-4" /> : <Zap className="mr-2 size-4" />}
              {t('example.payments.payMock', 'Pay with Mock Gateway')}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => createSession('stripe')}
              disabled={loading || stripeAvailable === false}
              className="border-indigo-300 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-600 dark:text-indigo-300 dark:hover:bg-indigo-950"
            >
              {loading ? <Spinner className="mr-2 size-4" /> : <CreditCard className="mr-2 size-4" />}
              {t('example.payments.payStripe', 'Pay with Stripe')}
            </Button>

            {stripeAvailable === false && (
              <span className="text-xs text-muted-foreground">
                {t('example.payments.stripeUnavailable', 'Stripe unavailable — enable the integration and save credentials in Integrations')}
              </span>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>{t('example.payments.error.title', 'Error')}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Action Result */}
          {actionResult && (
            <Alert variant="success">
              <CheckCircle2 className="size-4" />
              <AlertTitle>{t('example.payments.success.title', 'Success')}</AlertTitle>
              <AlertDescription>{actionResult}</AlertDescription>
            </Alert>
          )}

          {/* Transaction Details */}
          {transaction && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="size-5" />
                    {t('example.payments.transaction', 'Transaction Details')}
                  </CardTitle>
                  <Badge variant={STATUS_BADGE_VARIANT[transaction.status] ?? 'secondary'}>
                    {t(`payment_gateways.status.${transaction.status}`, transaction.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  {transaction.providerKey && (
                    <>
                      <span className="font-medium text-muted-foreground">{t('example.payments.fields.provider', 'Provider')}</span>
                      <span>{t(`example.payments.provider.${transaction.providerKey}`, transaction.providerKey)}</span>
                    </>
                  )}
                  <span className="font-medium text-muted-foreground">{t('example.payments.fields.transactionId', 'Transaction ID')}</span>
                  <span className="font-mono text-xs">{transaction.transactionId}</span>
                  <span className="font-medium text-muted-foreground">{t('example.payments.fields.sessionId', 'Session ID')}</span>
                  <span className="font-mono text-xs">{transaction.sessionId}</span>
                  <span className="font-medium text-muted-foreground">{t('example.payments.fields.paymentId', 'Payment ID')}</span>
                  <span className="font-mono text-xs">{transaction.paymentId}</span>
                  {transaction.redirectUrl && (
                    <>
                      <span className="font-medium text-muted-foreground">{t('example.payments.fields.paymentPage', 'Payment page')}</span>
                      <a href={transaction.redirectUrl} target="_blank" rel="noreferrer" className="text-primary underline text-xs break-all">
                        {t('example.payments.fields.openPaymentPage', 'Open hosted payment page')}
                      </a>
                    </>
                  )}
                </div>

                {showStripePaymentPanel ? (
                  <StripePaymentPanel
                    clientSecret={transaction.clientSecret!}
                    publishableKey={stripePublishableKey!}
                    disabled={loading}
                    onError={(message) => setError(message || null)}
                    onSuccess={(message, nextStatus) => {
                      setActionResult(message)
                      if (nextStatus) {
                        setTransaction((prev) => prev ? { ...prev, status: nextStatus } : prev)
                      }
                      void refreshStatus()
                    }}
                  />
                ) : null}

                {/* Lifecycle Actions */}
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => performAction('capture')}
                    disabled={loading || !canCapture}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <ArrowDownToLine className="mr-1.5 size-3.5" />
                    {t('example.payments.capture', 'Capture')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => performAction('refund')}
                    disabled={loading || !canRefund}
                    className="border-amber-400 text-amber-700 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-950"
                  >
                    <Undo2 className="mr-1.5 size-3.5" />
                    {t('example.payments.refund', 'Refund')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => performAction('cancel')}
                    disabled={loading || !canCancel}
                  >
                    <Ban className="mr-1.5 size-3.5" />
                    {t('example.payments.cancel', 'Cancel')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={refreshStatus}
                    disabled={loading}
                  >
                    <RefreshCw className="mr-1.5 size-3.5" />
                    {t('example.payments.refresh', 'Refresh Status')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
