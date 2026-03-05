"use client"

import { useState } from 'react'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

interface TransactionState {
  transactionId: string
  sessionId: string
  status: string
  paymentId: string
  clientSecret?: string
  redirectUrl?: string
}

export default function PaymentGatewayDemoPage() {
  const t = useT()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transaction, setTransaction] = useState<TransactionState | null>(null)
  const [actionResult, setActionResult] = useState<string | null>(null)

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
        const body = await response.json().catch(() => ({ error: 'Request failed' }))
        setError(body.error ?? `HTTP ${response.status}`)
        return
      }
      const data = await response.json()
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
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? `${action} failed`)
        return
      }
      setActionResult(`${action} successful: status = ${data.status}`)
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
        const data = await response.json()
        setTransaction((prev) => prev ? { ...prev, status: data.status } : prev)
      }
    } catch {
      // Ignore refresh errors
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('example.payments.title', 'Payment Gateway Demo')}
        description={t('example.payments.description', 'Test payment gateway integrations with mock or real providers')}
      />
      <PageBody>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          {/* Setup Instructions */}
          <section style={{ marginBottom: 32, padding: 20, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
            <h3 style={{ marginTop: 0 }}>{t('example.payments.setup.title', 'How to Configure Payment Gateways')}</h3>

            <h4>{t('example.payments.setup.mock', 'Mock Gateway (No Configuration Needed)')}</h4>
            <p>{t('example.payments.setup.mockDesc', 'The mock gateway works out of the box. Click "Pay with Mock Gateway" below to test the full payment lifecycle: create session, capture, refund, and cancel.')}</p>

            <h4>{t('example.payments.setup.stripe', 'Stripe Gateway')}</h4>
            <ol>
              <li>{t('example.payments.setup.step1', 'Create a Stripe account at stripe.com and get your API keys from the Stripe Dashboard.')}</li>
              <li>{t('example.payments.setup.step2', 'Go to Settings > Integrations in the admin panel. Find "Stripe" and enter your Publishable Key, Secret Key, and Webhook Signing Secret.')}</li>
              <li>{t('example.payments.setup.step3', 'Go to Settings > Sales > Payment Methods. Create a new payment method with Provider Key set to "stripe".')}</li>
              <li>{t('example.payments.setup.step4', 'For webhooks, configure Stripe to send events to: {YOUR_APP_URL}/api/payment-gateways/webhook/stripe')}</li>
              <li>{t('example.payments.setup.step5', 'Come back here and click "Pay with Stripe" to test.')}</li>
            </ol>
          </section>

          {/* Action Buttons */}
          <section style={{ marginBottom: 24, display: 'flex', gap: 12 }}>
            <button
              onClick={() => createSession('mock')}
              disabled={loading}
              style={{ padding: '10px 20px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--primary)', color: 'white', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}
            >
              {loading ? t('example.payments.creating', 'Creating...') : t('example.payments.payMock', 'Pay with Mock Gateway')}
            </button>

            <button
              onClick={() => createSession('stripe')}
              disabled={loading}
              style={{ padding: '10px 20px', borderRadius: 6, border: '1px solid #635bff', background: '#635bff', color: 'white', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}
            >
              {loading ? t('example.payments.creating', 'Creating...') : t('example.payments.payStripe', 'Pay with Stripe')}
            </button>
          </section>

          {/* Error Display */}
          {error && (
            <div style={{ padding: 12, marginBottom: 16, border: '1px solid #ef4444', borderRadius: 6, background: '#fef2f2', color: '#b91c1c' }}>
              {error}
            </div>
          )}

          {/* Action Result */}
          {actionResult && (
            <div style={{ padding: 12, marginBottom: 16, border: '1px solid #22c55e', borderRadius: 6, background: '#f0fdf4', color: '#166534' }}>
              {actionResult}
            </div>
          )}

          {/* Transaction Details */}
          {transaction && (
            <section style={{ padding: 20, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
              <h3 style={{ marginTop: 0 }}>{t('example.payments.transaction', 'Transaction Details')}</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr><td style={{ padding: '6px 12px', fontWeight: 600 }}>Transaction ID</td><td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 13 }}>{transaction.transactionId}</td></tr>
                  <tr><td style={{ padding: '6px 12px', fontWeight: 600 }}>Session ID</td><td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 13 }}>{transaction.sessionId}</td></tr>
                  <tr><td style={{ padding: '6px 12px', fontWeight: 600 }}>Payment ID</td><td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 13 }}>{transaction.paymentId}</td></tr>
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 600 }}>Status</td>
                    <td style={{ padding: '6px 12px' }}>
                      <span style={{ padding: '2px 10px', borderRadius: 12, background: statusColor(transaction.status), color: 'white', fontWeight: 600, fontSize: 13 }}>
                        {transaction.status}
                      </span>
                    </td>
                  </tr>
                  {transaction.clientSecret && (
                    <tr><td style={{ padding: '6px 12px', fontWeight: 600 }}>Client Secret</td><td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 13 }}>{transaction.clientSecret}</td></tr>
                  )}
                  {transaction.redirectUrl && (
                    <tr><td style={{ padding: '6px 12px', fontWeight: 600 }}>Redirect URL</td><td style={{ padding: '6px 12px' }}><a href={transaction.redirectUrl} target="_blank" rel="noreferrer">{transaction.redirectUrl}</a></td></tr>
                  )}
                </tbody>
              </table>

              {/* Lifecycle Actions */}
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <button
                  onClick={() => performAction('capture')}
                  disabled={loading || transaction.status !== 'authorized'}
                  style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #22c55e', background: transaction.status === 'authorized' ? '#22c55e' : '#e5e7eb', color: transaction.status === 'authorized' ? 'white' : '#9ca3af', cursor: transaction.status === 'authorized' ? 'pointer' : 'not-allowed' }}
                >
                  {t('example.payments.capture', 'Capture')}
                </button>
                <button
                  onClick={() => performAction('refund')}
                  disabled={loading || (transaction.status !== 'captured' && transaction.status !== 'partially_captured')}
                  style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #f59e0b', background: (transaction.status === 'captured' || transaction.status === 'partially_captured') ? '#f59e0b' : '#e5e7eb', color: (transaction.status === 'captured' || transaction.status === 'partially_captured') ? 'white' : '#9ca3af', cursor: (transaction.status === 'captured' || transaction.status === 'partially_captured') ? 'pointer' : 'not-allowed' }}
                >
                  {t('example.payments.refund', 'Refund')}
                </button>
                <button
                  onClick={() => performAction('cancel')}
                  disabled={loading || (transaction.status !== 'authorized' && transaction.status !== 'pending')}
                  style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #ef4444', background: (transaction.status === 'authorized' || transaction.status === 'pending') ? '#ef4444' : '#e5e7eb', color: (transaction.status === 'authorized' || transaction.status === 'pending') ? 'white' : '#9ca3af', cursor: (transaction.status === 'authorized' || transaction.status === 'pending') ? 'pointer' : 'not-allowed' }}
                >
                  {t('example.payments.cancel', 'Cancel')}
                </button>
                <button
                  onClick={refreshStatus}
                  disabled={loading}
                  style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}
                >
                  {t('example.payments.refresh', 'Refresh Status')}
                </button>
              </div>
            </section>
          )}
        </div>
      </PageBody>
    </Page>
  )
}

function statusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: '#6b7280',
    authorized: '#3b82f6',
    captured: '#22c55e',
    partially_captured: '#84cc16',
    refunded: '#f59e0b',
    partially_refunded: '#f97316',
    cancelled: '#ef4444',
    failed: '#dc2626',
    expired: '#9ca3af',
    unknown: '#6b7280',
  }
  return colors[status] ?? '#6b7280'
}
