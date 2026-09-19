import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'

export type JsonMap = Record<string, unknown>

export type TaxProviderSelection = {
  providerKey: string
  providerSettings: JsonMap | null
  shipFromAddress: JsonMap | null
  timeoutMs: number
  providers: Array<JsonMap>
}

export function numeric(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return Number.NaN
}

export async function readJson(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<JsonMap> {
  const response = await apiRequest(request, 'GET', path, { token, retryTransport: false })
  const text = await response.text()
  expect(response.ok(), `GET ${path} failed: ${response.status()} ${text.slice(0, 400)}`).toBeTruthy()
  return JSON.parse(text) as JsonMap
}

export async function readDocument(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string,
): Promise<JsonMap> {
  const body = await readJson(request, token, `${path}?id=${id}`)
  const items = Array.isArray(body.items) ? (body.items as JsonMap[]) : []
  expect(items.length, `${path} did not return ${id}`).toBeGreaterThan(0)
  return items[0]
}

export async function getTaxProviderSelection(
  request: APIRequestContext,
  token: string,
): Promise<TaxProviderSelection> {
  return (await readJson(request, token, '/api/sales/settings/tax-provider')) as unknown as TaxProviderSelection
}

/**
 * Selects a tax provider for the caller's organization. Every spec that changes
 * the selection must restore it in a finally block, because the setting is per
 * organization and would otherwise leak into the next spec.
 */
export async function setTaxProvider(
  request: APIRequestContext,
  token: string,
  body: {
    providerKey: string
    providerSettings?: JsonMap | null
    shipFromAddress?: JsonMap | null
    timeoutMs?: number | null
  },
): Promise<TaxProviderSelection> {
  const response = await apiRequest(request, 'PUT', '/api/sales/settings/tax-provider', {
    token,
    retryTransport: false,
    data: body,
  })
  const text = await response.text()
  expect(
    response.ok(),
    `PUT /api/sales/settings/tax-provider failed: ${response.status()} ${text.slice(0, 400)}`,
  ).toBeTruthy()
  return JSON.parse(text) as TaxProviderSelection
}

export async function putTaxProviderRaw(
  request: APIRequestContext,
  token: string,
  body: JsonMap,
): Promise<{ status: number; text: string }> {
  // `request.fetch` returns the response for any status, so a rejected PUT is
  // read here rather than thrown.
  const response = await apiRequest(request, 'PUT', '/api/sales/settings/tax-provider', {
    token,
    retryTransport: false,
    data: body,
  })
  return { status: response.status(), text: await response.text() }
}

export async function restoreDefaultTaxProvider(
  request: APIRequestContext,
  token: string | null,
): Promise<void> {
  if (!token) return
  try {
    await apiRequest(request, 'PUT', '/api/sales/settings/tax-provider', {
      token,
      retryTransport: false,
      data: { providerKey: 'table-rates', providerSettings: null, shipFromAddress: null, timeoutMs: null },
    })
  } catch {
    return
  }
}
