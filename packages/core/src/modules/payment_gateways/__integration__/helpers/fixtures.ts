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
    assignments?: Array<{ entityType: string; entityId: string }>
    documentType?: string
    documentId?: string
    paymentLink?: {
      enabled: boolean
      title?: string
      description?: string
      password?: string
      metadata?: Record<string, unknown>
      customFieldsetCode?: string
      customFields?: Record<string, unknown>
    }
  },
): Promise<{
  transactionId: string
  sessionId: string
  status: string
  paymentId: string
  clientSecret?: string
  paymentLinkId?: string | null
  paymentLinkUrl?: string | null
}> {
  const response = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
    token,
    data: {
      providerKey: overrides?.providerKey ?? 'mock',
      amount: overrides?.amount ?? 49.99,
      currencyCode: overrides?.currencyCode ?? 'USD',
      captureMethod: overrides?.captureMethod ?? 'manual',
      description: `QA Test Payment ${Date.now()}`,
      assignments: overrides?.assignments,
      documentType: overrides?.documentType,
      documentId: overrides?.documentId,
      paymentLink: overrides?.paymentLink,
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
  query?: {
    search?: string
    providerKey?: string
    status?: string
    entityType?: string
    entityId?: string
  },
): Promise<{ items: Array<{ id: string; paymentId: string }>; total: number }> {
  const params = new URLSearchParams()
  if (query?.search) params.set('search', query.search)
  if (query?.providerKey) params.set('providerKey', query.providerKey)
  if (query?.status) params.set('status', query.status)
  if (query?.entityType) params.set('entityType', query.entityType)
  if (query?.entityId) params.set('entityId', query.entityId)
  const search = params.toString()
  const response = await apiRequest(request, 'GET', `/api/payment_gateways/transactions${search ? `?${search}` : ''}`, {
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
  transaction: {
    id: string
    paymentId: string
    unifiedStatus: string
    webhookLog?: unknown[] | null
    assignments?: Array<{ entityType: string; entityId: string }>
  }
  paymentLink?: { id: string; url: string; passwordProtected: boolean } | null
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

export async function assignTransaction(
  request: APIRequestContext,
  token: string,
  transactionId: string,
  assignment: { entityType: string; entityId: string },
): Promise<{ items: Array<{ entityType: string; entityId: string }> }> {
  const response = await apiRequest(request, 'POST', `/api/payment_gateways/transactions/${transactionId}/assignments`, {
    token,
    data: assignment,
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to assign transaction: ${response.status()} ${body}`)
  }
  return response.json()
}

export async function deassignTransaction(
  request: APIRequestContext,
  token: string,
  transactionId: string,
  assignment: { entityType: string; entityId: string },
): Promise<{ items: Array<{ entityType: string; entityId: string }> }> {
  const response = await apiRequest(request, 'DELETE', `/api/payment_gateways/transactions/${transactionId}/assignments`, {
    token,
    data: assignment,
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to deassign transaction: ${response.status()} ${body}`)
  }
  return response.json()
}
