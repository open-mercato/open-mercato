import type { APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

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
