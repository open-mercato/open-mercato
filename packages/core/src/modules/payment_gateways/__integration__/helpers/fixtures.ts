import { createHmac } from 'node:crypto'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * Dev-only secret that matches `MOCK_GATEWAY_DEV_WEBHOOK_SECRET` exported from the
 * mock gateway adapter. Kept in sync with:
 *   - apps/mercato/src/modules/example/lib/mock-gateway-adapter.ts
 *   - packages/create-app/template/src/modules/example/lib/mock-gateway-adapter.ts
 *
 * The mock adapter falls back to this constant when no per-tenant webhook secret and
 * no `MOCK_GATEWAY_WEBHOOK_SECRET` env var are configured. Tests rely on that fallback
 * so that no credential seeding is required.
 */
const MOCK_GATEWAY_DEV_WEBHOOK_SECRET = 'open-mercato-mock-dev-webhook-secret'
const MOCK_GATEWAY_SIGNATURE_HEADER = 'x-mock-signature'

const BASE_URL = process.env.BASE_URL?.trim() || ''

function computeMockWebhookSignature(rawBody: string, secret = MOCK_GATEWAY_DEV_WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(rawBody, 'utf-8').digest('hex')
}

export type PostMockWebhookOptions = {
  token?: string
  payload: Record<string, unknown>
  secret?: string
  provider?: string
  signature?: string | null
  extraHeaders?: Record<string, string>
}

/**
 * POST a webhook to the mock payment gateway endpoint with a valid HMAC-SHA256 signature.
 * The signature is computed over the exact JSON string that is sent on the wire, so do NOT
 * rely on Playwright's automatic JSON serialization — the raw body is pre-serialized here.
 */
export async function postMockWebhook(
  request: APIRequestContext,
  options: PostMockWebhookOptions,
): Promise<APIResponse> {
  const rawBody = JSON.stringify(options.payload)
  const provider = options.provider ?? 'mock'
  const computedSignature = computeMockWebhookSignature(rawBody, options.secret)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.extraHeaders,
  }
  if (options.signature !== null) {
    headers[MOCK_GATEWAY_SIGNATURE_HEADER] = options.signature ?? computedSignature
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  const url = `${BASE_URL}/api/payment_gateways/webhook/${provider}`
  return request.fetch(url, {
    method: 'POST',
    headers,
    data: rawBody,
  })
}

export async function createPaymentSession(
  request: APIRequestContext,
  token: string,
  overrides?: {
    providerKey?: string
    amount?: number
    currencyCode?: string
    captureMethod?: 'automatic' | 'manual'
  },
): Promise<{
  transactionId: string
  sessionId: string
  status: string
  paymentId: string
  clientSecret?: string
}> {
  const response = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
    token,
    data: {
      providerKey: overrides?.providerKey ?? 'mock',
      amount: overrides?.amount ?? 49.99,
      currencyCode: overrides?.currencyCode ?? 'USD',
      captureMethod: overrides?.captureMethod ?? 'manual',
      description: `QA Test Payment ${Date.now()}`,
    },
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to create payment session: ${response.status()} ${body}`)
  }
  return response.json()
}

export async function getTransactionStatus(
  request: APIRequestContext,
  token: string,
  transactionId: string,
): Promise<{ status: string; transactionId: string; amount: number; currencyCode: string; amountReceived?: number }> {
  const response = await apiRequest(request, 'GET', `/api/payment_gateways/status?transactionId=${transactionId}`, {
    token,
  })
  if (!response.ok()) {
    throw new Error(`Failed to get status: ${response.status()}`)
  }
  return response.json()
}

export async function capturePayment(
  request: APIRequestContext,
  token: string,
  transactionId: string,
  amount?: number,
): Promise<{ status: string; capturedAmount: number }> {
  const response = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
    token,
    data: { transactionId, amount },
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Capture failed: ${response.status()} ${body}`)
  }
  return response.json()
}

export async function refundPayment(
  request: APIRequestContext,
  token: string,
  transactionId: string,
  amount?: number,
  reason?: string,
): Promise<{ status: string; refundedAmount: number; refundId: string }> {
  const response = await apiRequest(request, 'POST', '/api/payment_gateways/refund', {
    token,
    data: { transactionId, amount, reason },
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Refund failed: ${response.status()} ${body}`)
  }
  return response.json()
}

export async function cancelPayment(
  request: APIRequestContext,
  token: string,
  transactionId: string,
  reason?: string,
): Promise<{ status: string }> {
  const response = await apiRequest(request, 'POST', '/api/payment_gateways/cancel', {
    token,
    data: { transactionId, reason },
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Cancel failed: ${response.status()} ${body}`)
  }
  return response.json()
}

export async function listTransactions(
  request: APIRequestContext,
  token: string,
): Promise<{ items: Array<{ id: string; paymentId: string }>; total: number }> {
  const response = await apiRequest(request, 'GET', '/api/payment_gateways/transactions', {
    token,
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to list transactions: ${response.status()} ${body}`)
  }
  return response.json()
}

export async function getTransactionDetails(
  request: APIRequestContext,
  token: string,
  transactionId: string,
): Promise<{
  transaction: { id: string; paymentId: string; unifiedStatus: string; webhookLog?: unknown[] | null }
  logs: Array<{ id: string; message: string }>
}> {
  const response = await apiRequest(request, 'GET', `/api/payment_gateways/transactions/${transactionId}`, {
    token,
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to get transaction details: ${response.status()} ${body}`)
  }
  return response.json()
}
