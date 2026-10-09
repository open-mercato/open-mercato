import type { APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'

export const TPAY_INTEGRATION_ID = 'gateway_tpay'
export const TPAY_DUMMY_CLIENT_ID = 'qa-dummy-client-id'
export const TPAY_DUMMY_CLIENT_SECRET = 'qa-dummy-client-secret-value'

type JsonRecord = Record<string, unknown>

type TpayBaseline = {
  nonSecretCredentials: Record<string, string | number | boolean | null>
  configuredSecretKeys: string[]
  isEnabled: boolean
}

export type TpayCredentialsResponse = {
  credentials: JsonRecord
  secretFieldsConfigured: Record<string, boolean>
}

export type TpaySessionResponse = {
  status: number
  body: JsonRecord
}

async function readBody(response: { json: () => Promise<unknown> }): Promise<JsonRecord> {
  try {
    const parsed = await response.json()
    return parsed && typeof parsed === 'object' ? (parsed as JsonRecord) : {}
  } catch {
    return {}
  }
}

export async function readTpayCredentials(
  request: APIRequestContext,
  token: string,
): Promise<TpayCredentialsResponse> {
  const response = await apiRequest(request, 'GET', `/api/integrations/${TPAY_INTEGRATION_ID}/credentials`, { token })
  if (!response.ok()) {
    throw new Error(`Failed to read Tpay credentials: ${response.status()}`)
  }
  const body = await readBody(response)
  return {
    credentials: (body.credentials as JsonRecord | undefined) ?? {},
    secretFieldsConfigured: (body.secretFieldsConfigured as Record<string, boolean> | undefined) ?? {},
  }
}

export async function readTpayEnabled(request: APIRequestContext, token: string): Promise<boolean> {
  const response = await apiRequest(request, 'GET', `/api/integrations/${TPAY_INTEGRATION_ID}`, { token })
  if (!response.ok()) {
    throw new Error(`Failed to read Tpay integration: ${response.status()}`)
  }
  const body = await readBody(response)
  const state = (body.state as JsonRecord | undefined) ?? {}
  return state.isEnabled === true
}

export async function captureTpayBaseline(request: APIRequestContext, token: string): Promise<TpayBaseline> {
  const { credentials, secretFieldsConfigured } = await readTpayCredentials(request, token)
  const configuredSecretKeys = Object.keys(secretFieldsConfigured).filter((key) => secretFieldsConfigured[key])
  const nonSecretCredentials: TpayBaseline['nonSecretCredentials'] = {}
  for (const [key, value] of Object.entries(credentials)) {
    if (configuredSecretKeys.includes(key)) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      nonSecretCredentials[key] = value
    }
  }
  return { nonSecretCredentials, configuredSecretKeys, isEnabled: await readTpayEnabled(request, token) }
}

export async function saveTpayDummyCredentials(request: APIRequestContext, token: string): Promise<void> {
  const response = await apiRequest(request, 'PUT', `/api/integrations/${TPAY_INTEGRATION_ID}/credentials`, {
    token,
    data: {
      credentials: {
        clientId: TPAY_DUMMY_CLIENT_ID,
        clientSecret: TPAY_DUMMY_CLIENT_SECRET,
        environment: 'sandbox',
      },
    },
  })
  if (!response.ok()) {
    throw new Error(`Failed to save Tpay credentials: ${response.status()} ${await response.text()}`)
  }
}

export async function setTpayEnabled(request: APIRequestContext, token: string, isEnabled: boolean): Promise<void> {
  const response = await apiRequest(request, 'PUT', `/api/integrations/${TPAY_INTEGRATION_ID}/state`, {
    token,
    data: { isEnabled },
  })
  if (!response.ok()) {
    throw new Error(`Failed to set Tpay enabled=${isEnabled}: ${response.status()} ${await response.text()}`)
  }
}

export async function restoreTpayBaseline(
  request: APIRequestContext,
  token: string,
  baseline: TpayBaseline,
): Promise<void> {
  await apiRequest(request, 'PUT', `/api/integrations/${TPAY_INTEGRATION_ID}/credentials`, {
    token,
    data: {
      credentials: baseline.nonSecretCredentials,
      unchangedSecretFields: baseline.configuredSecretKeys,
    },
  })
  await apiRequest(request, 'PUT', `/api/integrations/${TPAY_INTEGRATION_ID}/state`, {
    token,
    data: { isEnabled: baseline.isEnabled },
  })
}

export async function createTpaySession(
  request: APIRequestContext,
  token: string,
  data: { amount: number; currencyCode: string; metadata?: Record<string, unknown> },
): Promise<TpaySessionResponse> {
  const response = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
    token,
    data: { providerKey: 'tpay', description: `QA Tpay ${Date.now()}`, ...data },
  })
  return { status: response.status(), body: await readBody(response) }
}

export async function countGatewayTransactions(request: APIRequestContext, token: string): Promise<number> {
  const response = await apiRequest(request, 'GET', '/api/payment_gateways/transactions', { token })
  if (!response.ok()) {
    throw new Error(`Failed to list transactions: ${response.status()}`)
  }
  const body = await readBody(response)
  return typeof body.total === 'number' ? body.total : 0
}
