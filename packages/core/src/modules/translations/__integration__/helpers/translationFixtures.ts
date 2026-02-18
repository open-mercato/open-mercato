import { type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'

export async function getLocales(
  request: APIRequestContext,
  token: string,
): Promise<string[]> {
  const response = await apiRequest(request, 'GET', '/api/translations/locales', { token })
  if (!response.ok()) return []
  const body = (await response.json()) as { locales?: string[] }
  return body.locales ?? []
}

export async function setLocales(
  request: APIRequestContext,
  token: string,
  locales: string[],
): Promise<void> {
  await apiRequest(request, 'PUT', '/api/translations/locales', { token, data: { locales } })
}

export async function deleteTranslationIfExists(
  request: APIRequestContext,
  token: string | null,
  entityType: string,
  entityId: string | null,
): Promise<void> {
  if (!token || !entityId) return
  try {
    await apiRequest(request, 'DELETE', `/api/translations/${entityType}/${entityId}`, { token })
  } catch {
    return
  }
}
