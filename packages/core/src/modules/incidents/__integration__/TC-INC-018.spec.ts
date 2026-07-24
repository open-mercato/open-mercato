import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const INCIDENTS_API = '/api/incidents'
const SEVERITIES_API = '/api/incidents/severities'
const AI_AVAILABILITY_API = '/api/incidents/ai/availability'
const TEST_PASSWORD = 'Incident-Ai-018!'

type Scope = {
  organizationId: string
  tenantId: string
}

type EphemeralEnv = {
  status?: string
  baseUrl?: string
  base_url?: string
  port?: string | number
}

type AvailabilityResponse = {
  available?: boolean
  reason?: string
  code?: string
}

const RESOLVED_BASE_URL = resolveIntegrationBaseUrl()
if (RESOLVED_BASE_URL) {
  process.env.BASE_URL = RESOLVED_BASE_URL
  test.use({ baseURL: RESOLVED_BASE_URL })
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : undefined
}

function resolveIntegrationBaseUrl(): string | undefined {
  const candidates = [
    resolve(process.cwd(), '.ai/qa/ephemeral-env.json'),
    resolve(process.cwd(), '../..', '.ai/qa/ephemeral-env.json'),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as EphemeralEnv
      if (parsed.status && parsed.status !== 'running') continue
      const fromBase = normalizeBaseUrl(parsed.baseUrl ?? parsed.base_url)
      if (fromBase) return fromBase
      const port = typeof parsed.port === 'number' ? parsed.port : Number(parsed.port)
      if (Number.isInteger(port) && port > 0) return `http://127.0.0.1:${port}`
    } catch {
      continue
    }
  }
  return normalizeBaseUrl(process.env.BASE_URL)
}

function resolveApiUrl(path: string): string {
  if (!RESOLVED_BASE_URL) return path
  return `${RESOLVED_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

function uniqueSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function getAuthToken(
  request: APIRequestContext,
  roleOrEmail: 'admin' | string = 'admin',
  password?: string,
): Promise<string> {
  const form = new URLSearchParams()
  form.set('email', roleOrEmail === 'admin' ? 'admin@acme.com' : roleOrEmail)
  form.set('password', roleOrEmail === 'admin' ? 'secret' : password ?? TEST_PASSWORD)
  const response = await request.post(resolveApiUrl('/api/auth/login'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.status(), `${roleOrEmail} form login should succeed`).toBe(200)
  const body = await readJsonSafe<{ token?: unknown }>(response)
  expect(typeof body?.token, 'login response should include a bearer token').toBe('string')
  return body!.token as string
}

async function apiFetch(
  request: APIRequestContext,
  method: string,
  path: string,
  token: string,
  data?: unknown,
) {
  return request.fetch(resolveApiUrl(path), {
    method,
    headers: authHeaders(token),
    ...(data === undefined ? {} : { data }),
  })
}

async function createRole(request: APIRequestContext, token: string, scope: Scope, name: string): Promise<string> {
  const response = await apiFetch(request, 'POST', '/api/auth/roles', token, {
    name,
    tenantId: scope.tenantId,
  })
  expect(response.status(), 'POST /api/auth/roles should create a role').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return expectId(body?.id, 'created role should return id')
}

async function setRoleAclFeatures(
  request: APIRequestContext,
  token: string,
  roleId: string,
  features: string[],
): Promise<void> {
  const response = await apiFetch(request, 'PUT', '/api/auth/roles/acl', token, {
    roleId,
    features,
  })
  expect(response.status(), 'PUT /api/auth/roles/acl should succeed').toBe(200)
  const body = await readJsonSafe<{ ok?: boolean }>(response)
  expect(body?.ok, 'role ACL update should report ok=true').toBe(true)
}

async function createUser(
  request: APIRequestContext,
  token: string,
  input: { email: string; roleId: string; organizationId: string },
): Promise<string> {
  const response = await apiFetch(request, 'POST', '/api/auth/users', token, {
    email: input.email,
    password: TEST_PASSWORD,
    organizationId: input.organizationId,
    roles: [input.roleId],
    name: 'QA Incidents AI No Use User',
    isConfirmed: true,
  })
  expect(response.status(), 'POST /api/auth/users should create a confirmed test user').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return expectId(body?.id, 'created user should return id')
}

async function deleteUserIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiFetch(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(id)}`, token).catch(() => undefined)
}

async function deleteRoleIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiFetch(request, 'DELETE', `/api/auth/roles?id=${encodeURIComponent(id)}`, token).catch(() => undefined)
}

async function createSeverity(
  request: APIRequestContext,
  token: string,
  scope: Scope,
): Promise<string> {
  const response = await apiFetch(request, 'POST', SEVERITIES_API, token, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    key: `tc_inc_018_${randomUUID().slice(0, 8)}`,
    label: `TC-INC-018 Severity ${uniqueSuffix()}`,
    rank: 902,
    colorToken: 'info',
    isActive: true,
  })
  expect(response.status(), 'POST /api/incidents/severities should create a severity').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return expectId(body?.id, 'created severity should return id')
}

async function deleteSeverityIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiFetch(request, 'DELETE', `${SEVERITIES_API}?id=${encodeURIComponent(id)}`, token).catch(() => undefined)
}

async function createIncident(
  request: APIRequestContext,
  token: string,
  scope: Scope,
  severityId: string,
): Promise<string> {
  const response = await apiFetch(request, 'POST', INCIDENTS_API, token, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    title: `INC AI contract ${uniqueSuffix()}`,
    description: 'AI availability contract integration fixture',
    severityId,
  })
  expect(response.status(), 'POST /api/incidents should create an incident').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return expectId(body?.id, 'created incident should return id')
}

async function deleteIncidentIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiFetch(request, 'DELETE', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, token).catch(() => undefined)
}

test.describe('TC-INC-018: Incident AI availability contract', () => {
  test('reports no-provider availability, denies callers without incidents.ai.use, and returns typed draft errors', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenContext(token)
    let roleId: string | null = null
    let userId: string | null = null
    let severityId: string | null = null
    let incidentId: string | null = null

    try {
      const availabilityResponse = await apiFetch(request, 'GET', AI_AVAILABILITY_API, token)
      expect(availabilityResponse.status(), 'GET /api/incidents/ai/availability should succeed for an authorized user').toBe(200)
      const availability = await readJsonSafe<AvailabilityResponse>(availabilityResponse)
      const providerConfigured = availability?.available === true
      if (providerConfigured) {
        expect(availability, 'provider-configured env must not carry an unavailable reason').toMatchObject({ available: true })
        expect(availability?.reason, 'available responses must omit the reason field').toBeUndefined()
      } else {
        expect(availability, 'no-provider env should return the explicit unavailable contract').toMatchObject({
          available: false,
          reason: 'no_provider',
        })
      }

      const stamp = uniqueSuffix()
      const email = `qa-inc-ai-contract-${stamp}@acme.com`
      roleId = await createRole(request, token, scope, `qa_inc_ai_contract_${stamp}`)
      await setRoleAclFeatures(request, token, roleId, ['incidents.incident.view'])
      userId = await createUser(request, token, {
        email,
        roleId,
        organizationId: scope.organizationId,
      })
      const limitedToken = await getAuthToken(request, email, TEST_PASSWORD)

      const deniedAvailability = await apiFetch(request, 'GET', AI_AVAILABILITY_API, limitedToken)
      expect(deniedAvailability.status(), 'user without incidents.ai.use should receive 403 before route body').toBe(403)

      const deniedDraft = await apiFetch(
        request,
        'POST',
        `${INCIDENTS_API}/00000000-0000-4000-8000-000000000000/ai/postmortem-draft`,
        limitedToken,
        { unexpected: true },
      )
      expect(deniedDraft.status(), 'feature gate should return 403 before not-found or validation errors').toBe(403)

      if (!providerConfigured) {
        severityId = await createSeverity(request, token, scope)
        incidentId = await createIncident(request, token, scope, severityId)

        const draftResponse = await apiFetch(request, 'POST', `${INCIDENTS_API}/${incidentId}/ai/postmortem-draft`, token, {})
        expect(draftResponse.status(), 'postmortem draft should report service unavailable in no-provider env').toBe(503)
        const draftBody = await readJsonSafe<{ code?: string }>(draftResponse)
        expect(draftBody?.code, 'no-provider postmortem draft should return a typed code').toBe('no_provider_configured')
      }
    } finally {
      await deleteIncidentIfExists(request, token, incidentId)
      await deleteSeverityIfExists(request, token, severityId)
      await deleteUserIfExists(request, token, userId)
      await deleteRoleIfExists(request, token, roleId)
    }
  })
})
