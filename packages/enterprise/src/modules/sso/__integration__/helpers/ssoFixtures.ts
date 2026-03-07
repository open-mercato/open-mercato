import { type APIRequestContext, expect } from '@playwright/test'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

const DEFAULT_CREDENTIALS: Record<string, { email: string; password: string }> = {
  superadmin: {
    email: process.env.OM_INIT_SUPERADMIN_EMAIL || 'superadmin@acme.com',
    password: process.env.OM_INIT_SUPERADMIN_PASSWORD || 'secret',
  },
  admin: { email: 'admin@acme.com', password: 'secret' },
  employee: { email: 'employee@acme.com', password: 'secret' },
}

export async function getAuthToken(
  request: APIRequestContext,
  roleOrEmail: string = 'admin',
  password?: string,
): Promise<string> {
  let email: string
  let pass: string
  if (roleOrEmail in DEFAULT_CREDENTIALS) {
    const creds = DEFAULT_CREDENTIALS[roleOrEmail]!
    email = creds.email
    pass = password ?? creds.password
  } else {
    email = roleOrEmail
    pass = password ?? 'secret'
  }
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', pass)

  const response = await request.post(`${BASE_URL}/api/auth/login`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })

  const raw = await response.text()
  let body: Record<string, unknown> | null = null
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
  } catch {
    body = null
  }

  if (!response.ok() || !body || typeof body.token !== 'string' || !body.token) {
    throw new Error(`Failed to obtain auth token (status ${response.status()})`)
  }

  return body.token
}

export async function apiRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; data?: unknown },
) {
  const url = `${BASE_URL}${path}`
  const headers = {
    Authorization: `Bearer ${options.token}`,
    'Content-Type': 'application/json',
  }
  return request.fetch(url, { method, headers, data: options.data })
}

export async function createSsoConfigFixture(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const stamp = Date.now()
  const data = {
    name: `QA SSO Config ${stamp}`,
    protocol: 'oidc',
    issuer: `https://test-idp-${stamp}.example.com`,
    clientId: `client-${stamp}`,
    clientSecret: `secret-${stamp}`,
    jitEnabled: true,
    autoLinkByEmail: true,
    ...overrides,
  }

  const response = await apiRequest(request, 'POST', '/api/sso/config', { token, data })
  expect(response.ok(), `SSO config fixture should be created (status ${response.status()})`).toBeTruthy()
  const body = (await response.json()) as { id: string }
  expect(body.id, 'SSO config id should be returned').toBeTruthy()

  return {
    config: body,
    configId: body.id,
    cleanup: async () => {
      await apiRequest(request, 'POST', `/api/sso/config/${body.id}/activate`, {
        token,
        data: { active: false },
      }).catch(() => {})
      await apiRequest(request, 'DELETE', `/api/sso/config/${body.id}`, { token }).catch(() => {})
    },
  }
}

export async function addDomainFixture(
  request: APIRequestContext,
  token: string,
  configId: string,
  domain: string,
) {
  const response = await apiRequest(request, 'POST', `/api/sso/config/${configId}/domains`, {
    token,
    data: { domain },
  })
  expect(response.ok(), `Domain ${domain} should be added`).toBeTruthy()
}

export async function activateConfigFixture(
  request: APIRequestContext,
  token: string,
  configId: string,
) {
  const response = await apiRequest(request, 'POST', `/api/sso/config/${configId}/activate`, {
    token,
    data: { active: true },
  })
  expect(response.ok(), 'Config should be activated').toBeTruthy()
}

export async function createScimTokenFixture(
  request: APIRequestContext,
  token: string,
  configId: string,
  name?: string,
) {
  const stamp = Date.now()
  const response = await apiRequest(request, 'POST', '/api/sso/scim/tokens', {
    token,
    data: { ssoConfigId: configId, name: name ?? `QA Token ${stamp}` },
  })
  expect(response.ok(), `SCIM token should be created (status ${response.status()})`).toBeTruthy()
  const body = (await response.json()) as { id: string; token: string; prefix: string }
  expect(body.token, 'Raw SCIM token should be returned').toBeTruthy()

  return {
    tokenId: body.id,
    rawToken: body.token,
    prefix: body.prefix,
    cleanup: async () => {
      await apiRequest(request, 'DELETE', `/api/sso/scim/tokens/${body.id}`, { token }).catch(() => {})
    },
  }
}

export async function scimRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  scimToken: string,
  data?: unknown,
) {
  return request.fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${scimToken}`,
      'Content-Type': 'application/scim+json',
    },
    data,
  })
}
