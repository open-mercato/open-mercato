import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || null

export function resolveApiUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

export async function rawApiRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token?: string | null; data?: unknown; headers?: Record<string, string> } = {},
): Promise<APIResponse> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.data !== undefined) headers['Content-Type'] = 'application/json'
  return request.fetch(resolveApiUrl(path), { method, headers, data: options.data })
}

export async function expectJsonError(
  response: APIResponse,
  status: number,
  label: string,
): Promise<Record<string, unknown>> {
  expect(response.status(), label).toBe(status)
  const body = await readJsonSafe<Record<string, unknown>>(response)
  const message = body?.error ?? body?.message
  expect(
    typeof message === 'string' && message.length > 0,
    `${label} should include an error or message`,
  ).toBe(true)
  return body ?? {}
}

export function expectRequiredFeature(body: Record<string, unknown>, feature: string): void {
  const requiredFeatures = body.requiredFeatures
  expect(Array.isArray(requiredFeatures), `response should list missing feature ${feature}`).toBe(true)
  expect(requiredFeatures).toContain(feature)
}
