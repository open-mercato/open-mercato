"use client"

import { useState, useEffect } from 'react'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
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
  status: string
  paymentId: string
  clientSecret?: string
  redirectUrl?: string
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

export default function PaymentGatewayDemoPage() {
  const t = useT()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transaction, setTransaction] = useState<TransactionState | null>(null)
  const [actionResult, setActionResult] = useState<string | null>(null)
  const [stripeConfigured, setStripeConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    async function checkStripe() {
      const response = await apiCall<{ hasCredentials: boolean }>(
        '/api/integrations/gateway_stripe',
        undefined,
        { fallback: null },
      )
      setStripeConfigured(response.ok && response.result?.hasCredentials === true)
    }
    void checkStripe()
  }, [])

  async function createSession(providerKey: string) {
    setLoading(true)
    setError(null)
    setActionResult(null)
    try {
      const response = await apiCall('/api/payment-gateways/sessions', {
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
          setError(body?.error ?? `HTTP ${response.status}`)
        }
        return
      }
      const data = response.result as TransactionState | null
      if (!data) {
        setError(t('example.payments.error.invalidResponse', 'Invalid response payload'))
        return
      }
      setTransaction(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
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
      const response = await apiCall(`/api/payment-gateways/${action}`, {
        method: 'POST',
        body: JSON.stringify({ transactionId: transaction.transactionId }),
      })
      const data = response.result as { status?: string; error?: string } | null
      if (!response.ok) {
        setError(data?.error ?? `${action} failed`)
        return
      }
      setActionResult(`${action} successful: status = ${data?.status ?? 'unknown'}`)
      await refreshStatus()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  async function refreshStatus() {
    if (!transaction) return
    try {
      const response = await apiCall(`/api/payment-gateways/status?transactionId=${transaction.transactionId}`)
      if (response.ok) {
        const data = response.result as { status?: string } | null
        setTransaction((prev) => prev ? { ...prev, status: data?.status ?? prev.status } : prev)
      }
    } catch {
      // Ignore refresh errors
    }
  }

  const canCapture = transaction?.status === 'authorized'
  const canRefund = transaction?.status === 'captured' || transaction?.status === 'partially_captured'
  const canCancel = transaction?.status === 'authorized' || transaction?.status === 'pending'

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
                <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1.5 ml-1">
                  <li>{t('example.payments.setup.step1', 'Create a Stripe account at stripe.com and get your API keys from the Stripe Dashboard.')}</li>
                  <li>{t('example.payments.setup.step2', 'Go to Settings > Integrations in the admin panel. Find "Stripe" and enter your Publishable Key, Secret Key, and Webhook Signing Secret.')}</li>
                  <li>{t('example.payments.setup.step3', 'Go to Settings > Sales > Payment Methods. Create a new payment method with Provider Key set to "stripe".')}</li>
                  <li>{t('example.payments.setup.step4', 'For webhooks, configure Stripe to send events to: {YOUR_APP_URL}/api/payment-gateways/webhook/stripe')}</li>
                  <li>{t('example.payments.setup.step5', 'Come back here and click "Pay with Stripe" to test.')}</li>
                </ol>
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
              disabled={loading || stripeConfigured === false}
              className="border-indigo-300 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-600 dark:text-indigo-300 dark:hover:bg-indigo-950"
            >
              {loading ? <Spinner className="mr-2 size-4" /> : <CreditCard className="mr-2 size-4" />}
              {t('example.payments.payStripe', 'Pay with Stripe')}
            </Button>

            {stripeConfigured === false && (
              <span className="text-xs text-muted-foreground">
                {t('example.payments.stripeNotConfigured', 'Stripe not configured — set credentials in Integrations')}
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
                    {transaction.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <span className="font-medium text-muted-foreground">Transaction ID</span>
                  <span className="font-mono text-xs">{transaction.transactionId}</span>
                  <span className="font-medium text-muted-foreground">Session ID</span>
                  <span className="font-mono text-xs">{transaction.sessionId}</span>
                  <span className="font-medium text-muted-foreground">Payment ID</span>
                  <span className="font-mono text-xs">{transaction.paymentId}</span>
                  {transaction.clientSecret && (
                    <>
                      <span className="font-medium text-muted-foreground">Client Secret</span>
                      <span className="font-mono text-xs">{transaction.clientSecret}</span>
                    </>
                  )}
                  {transaction.redirectUrl && (
                    <>
                      <span className="font-medium text-muted-foreground">Redirect URL</span>
                      <a href={transaction.redirectUrl} target="_blank" rel="noreferrer" className="text-primary underline text-xs break-all">
                        {transaction.redirectUrl}
                      </a>
                    </>
                  )}
                </div>

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
