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
  const response = await apiRequest(request, 'POST', '/api/payment-gateways/sessions', {
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
): Promise<{ status: string; transactionId: string; amount: string; currencyCode: string }> {
  const response = await apiRequest(request, 'GET', `/api/payment-gateways/status?transactionId=${transactionId}`, {
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
  const response = await apiRequest(request, 'POST', '/api/payment-gateways/capture', {
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
  const response = await apiRequest(request, 'POST', '/api/payment-gateways/refund', {
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
  const response = await apiRequest(request, 'POST', '/api/payment-gateways/cancel', {
    token,
    data: { transactionId, reason },
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Cancel failed: ${response.status()} ${body}`)
  }
  return response.json()
}
