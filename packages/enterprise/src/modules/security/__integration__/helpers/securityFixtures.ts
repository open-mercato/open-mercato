import { createHmac } from 'node:crypto'
import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const AUTH_COOKIE_NAME = 'auth_token'
const BUILT_IN_PROVIDER_TYPES = ['totp', 'passkey', 'otp_email'] as const

type JwtPayload = {
  sub?: string
  orgId?: string
  tenantId?: string
  email?: string
}

type LoginSuccessResponse = {
  ok: true
  token: string
  mfa_required?: boolean
  challenge_id?: string
  available_methods?: Array<{ type: string; label: string; icon: string }>
}

type CreateUserFixtureInput = {
  email?: string
  password?: string
  roles?: string[]
}

type UserFixture = {
  id: string
  email: string
  password: string
}

type TotpEnrollmentResult = {
  setupId: string
  secret: string
}

type OtpEmailEnrollmentResult = {
  setupId: string
}

type PasskeyEnrollmentResult = {
  setupId: string
  credentialId: string
  challenge: string
}

export function decodeJwtPayload(token: string): JwtPayload {
  const [, payload] = token.split('.')
  if (!payload) {
    throw new Error('JWT payload segment is missing')
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JwtPayload
}

export async function createAdminApiToken(request: APIRequestContext): Promise<string> {
  return getAuthToken(request, 'admin')
}

export async function createSuperadminApiToken(request: APIRequestContext): Promise<string> {
  return getAuthToken(request, 'superadmin')
}

export async function createUserFixture(
  request: APIRequestContext,
  adminToken: string,
  input: CreateUserFixtureInput = {},
): Promise<UserFixture> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = input.email ?? `qa-sec-${stamp}@acme.com`
  const password = input.password ?? 'Valid1!Pass'
  const { organizationId } = getTokenContext(adminToken)
  const response = await apiRequest(request, 'POST', '/api/auth/users', {
    token: adminToken,
    data: {
      email,
      password,
      organizationId,
      roles: input.roles ?? ['employee'],
    },
  })
  expect(response.status(), `failed to create user fixture for ${email}`).toBe(201)
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id).toBe('string')
  return {
    id: body.id as string,
    email,
    password,
  }
}

export async function deleteUserFixture(
  request: APIRequestContext,
  adminToken: string | null,
  userId: string | null,
): Promise<void> {
  if (!adminToken || !userId) return
  await apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(userId)}`, {
    token: adminToken,
  }).catch(() => undefined)
}

export async function loginViaApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<LoginSuccessResponse> {
  const response = await postForm(request, '/api/auth/login', { email, password })
  expect(response.status(), `login failed for ${email}`).toBe(200)
  return await response.json() as LoginSuccessResponse
}

export async function setAuthCookie(target: BrowserContext | Page, token: string): Promise<void> {
  const context = 'context' in target ? target.context() : target
  await context.addCookies([{
    name: AUTH_COOKIE_NAME,
    value: token,
    url: BASE_URL,
    sameSite: 'Lax',
    httpOnly: true,
  }])
}

export async function clearAuthCookie(target: BrowserContext | Page): Promise<void> {
  const context = 'context' in target ? target.context() : target
  await context.addCookies([{
    name: AUTH_COOKIE_NAME,
    value: '',
    url: BASE_URL,
    sameSite: 'Lax',
    httpOnly: true,
    expires: 0,
  }])
}

export async function fetchJson<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: { token: string; data?: unknown; headers?: Record<string, string> },
): Promise<{ status: number; body: T }> {
  const response = await request.fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${options.token}`,
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      ...(options.headers ?? {}),
    },
    ...(options.data === undefined ? {} : { data: options.data }),
  })
  const body = await response.json() as T
  return {
    status: response.status(),
    body,
  }
}

export async function enrollTotp(
  request: APIRequestContext,
  token: string,
): Promise<TotpEnrollmentResult> {
  const setup = await fetchJson<{
    setupId: string
    clientData?: { secret?: string }
  }>(request, 'POST', '/api/security/mfa/provider/totp', { token, data: {} })
  expect(setup.status).toBe(200)
  const secret = setup.body.clientData?.secret
  expect(typeof secret).toBe('string')
  const confirm = await fetchJson<{ ok: true }>(
    request,
    'PUT',
    '/api/security/mfa/provider/totp',
    {
      token,
      data: {
        setupId: setup.body.setupId,
        payload: {
          code: generateTotpCode(secret as string),
        },
      },
    },
  )
  expect(confirm.status).toBe(200)
  return {
    setupId: setup.body.setupId,
    secret: secret as string,
  }
}

export async function enrollOtpEmail(
  request: APIRequestContext,
  token: string,
): Promise<OtpEmailEnrollmentResult> {
  const setup = await fetchJson<{ setupId: string }>(
    request,
    'POST',
    '/api/security/mfa/provider/otp_email',
    { token, data: {} },
  )
  expect(setup.status).toBe(200)
  const confirm = await fetchJson<{ ok: true }>(
    request,
    'PUT',
    '/api/security/mfa/provider/otp_email',
    {
      token,
      data: {
        setupId: setup.body.setupId,
        payload: {},
      },
    },
  )
  expect(confirm.status).toBe(200)
  return {
    setupId: setup.body.setupId,
  }
}

export async function enrollPasskey(
  request: APIRequestContext,
  token: string,
): Promise<PasskeyEnrollmentResult> {
  const setup = await fetchJson<{
    setupId: string
    clientData?: { challenge?: string }
  }>(request, 'POST', '/api/security/mfa/provider/passkey', {
    token,
    data: { label: 'QA Passkey' },
  })
  expect(setup.status).toBe(200)
  const challenge = setup.body.clientData?.challenge
  expect(typeof challenge).toBe('string')
  const credentialId = `qa-passkey-${Date.now()}`
  const confirm = await fetchJson<{ ok: true }>(
    request,
    'PUT',
    '/api/security/mfa/provider/passkey',
    {
      token,
      data: {
        setupId: setup.body.setupId,
        payload: {
          credentialId,
          publicKey: Buffer.from(`public-key:${credentialId}`).toString('base64url'),
          challenge,
          transports: ['internal'],
          label: 'QA Passkey',
        },
      },
    },
  )
  expect(confirm.status).toBe(200)
  return {
    setupId: setup.body.setupId,
    credentialId,
    challenge: challenge as string,
  }
}

export async function prepareOtpEmailChallenge(
  request: APIRequestContext,
  pendingToken: string,
  challengeId: string,
): Promise<{ status: number; code: string | null; emailHint: string | null; error: string | null }> {
  const prepared = await fetchJson<{
    ok: true
    clientData?: { code?: string; emailHint?: string }
    error?: string
  }>(request, 'POST', '/api/security/mfa/prepare', {
    token: pendingToken,
    data: {
      challengeId,
      methodType: 'otp_email',
    },
  })
  return {
    status: prepared.status,
    code: typeof prepared.body.clientData?.code === 'string' ? prepared.body.clientData.code : null,
    emailHint: typeof prepared.body.clientData?.emailHint === 'string' ? prepared.body.clientData.emailHint : null,
    error: typeof prepared.body.error === 'string' ? prepared.body.error : null,
  }
}

export async function verifyTotpChallenge(
  request: APIRequestContext,
  pendingToken: string,
  challengeId: string,
  secret: string,
): Promise<{ status: number; body: { ok?: boolean; redirect?: string; token?: string; error?: string } }> {
  return fetchJson(request, 'POST', '/api/security/mfa/verify', {
    token: pendingToken,
    data: {
      challengeId,
      methodType: 'totp',
      payload: {
        code: generateTotpCode(secret),
      },
    },
  })
}

export async function verifyPasskeyChallenge(
  request: APIRequestContext,
  pendingToken: string,
  challengeId: string,
  credentialId: string,
): Promise<{ status: number; body: { ok?: boolean; redirect?: string; token?: string; error?: string } }> {
  const prepared = await fetchJson<{ ok: true; clientData?: { challenge?: string } }>(
    request,
    'POST',
    '/api/security/mfa/prepare',
    {
      token: pendingToken,
      data: {
        challengeId,
        methodType: 'passkey',
      },
    },
  )
  expect(prepared.status).toBe(200)
  const challenge = prepared.body.clientData?.challenge
  expect(typeof challenge).toBe('string')
  return fetchJson(request, 'POST', '/api/security/mfa/verify', {
    token: pendingToken,
    data: {
      challengeId,
      methodType: 'passkey',
      payload: {
        credentialId,
        challenge,
      },
    },
  })
}

export async function getBuiltInProviders(
  request: APIRequestContext,
  token: string,
): Promise<string[]> {
  const response = await fetchJson<{ providers: Array<{ type: string }> }>(
    request,
    'GET',
    '/api/security/mfa/providers',
    { token },
  )
  expect(response.status).toBe(200)
  return response.body.providers.map((provider) => provider.type)
}

export function getCustomProviderTypes(providerTypes: string[]): string[] {
  return providerTypes.filter((providerType) => !BUILT_IN_PROVIDER_TYPES.includes(providerType as (typeof BUILT_IN_PROVIDER_TYPES)[number]))
}

export function generateTotpCode(secret: string, timestamp = Date.now()): string {
  const normalized = secret.trim().replaceAll(' ', '').replaceAll('-', '').toUpperCase()
  const key = decodeBase32(normalized)
  const counter = Math.floor(timestamp / 1000 / 30)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(counterBuffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

function decodeBase32(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const bytes: number[] = []

  for (const char of input) {
    const index = alphabet.indexOf(char)
    if (index === -1) {
      throw new Error(`invalid base32 character: ${char}`)
    }
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}
