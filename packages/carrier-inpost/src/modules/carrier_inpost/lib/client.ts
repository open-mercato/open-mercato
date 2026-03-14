import { inpostErrors } from './errors'

// InPost ShipX API documentation:
// https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/18153476/API+ShipX+ENG+Documentation

const INPOST_DEFAULT_BASE_URL = 'https://api-shipx-pl.easypack24.net'

export function resolveBaseUrl(credentials: Record<string, unknown>): string {
  const override = credentials.apiBaseUrl
  if (typeof override === 'string' && override.trim().length > 0) {
    return override.trim().replace(/\/$/, '')
  }
  return INPOST_DEFAULT_BASE_URL
}

export function resolveApiToken(credentials: Record<string, unknown>): string {
  const token = credentials.apiToken
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw inpostErrors.missingApiToken()
  }
  return token.trim()
}

export function resolveOrganizationId(credentials: Record<string, unknown>): string {
  const orgId = credentials.organizationId
  if (typeof orgId !== 'string' || orgId.trim().length === 0) {
    throw inpostErrors.missingOrganizationId()
  }
  return orgId.trim()
}

export type InpostRequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH'
  body?: unknown
  query?: Record<string, string>
}

export async function inpostRequest<T>(
  credentials: Record<string, unknown>,
  path: string,
  options: InpostRequestOptions = {},
): Promise<T> {
  const baseUrl = resolveBaseUrl(credentials)
  const token = resolveApiToken(credentials)

  const url = new URL(`${baseUrl}${path}`)
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw inpostErrors.apiError(response.status, text)
  }

  if (response.status === 204) {
    return undefined as unknown as T
  }

  return response.json() as Promise<T>
}
