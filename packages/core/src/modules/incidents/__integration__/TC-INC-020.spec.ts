import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const AI_AVAILABILITY_API = '/api/incidents/ai/availability'
const AI_TRIAGE_API = '/api/incidents/ai/triage'

type EphemeralEnv = {
  status?: string
  baseUrl?: string
  base_url?: string
  port?: string | number
}

type AvailabilityResponse = {
  available?: boolean
  reason?: string
}

type TriageResponse = {
  suggestion?: Record<string, unknown> | null
  similar?: unknown[]
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

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function getAuthToken(request: APIRequestContext): Promise<string> {
  const form = new URLSearchParams()
  form.set('email', 'admin@acme.com')
  form.set('password', 'secret')
  const response = await request.post(resolveApiUrl('/api/auth/login'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.status(), 'admin form login should succeed').toBe(200)
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

test.describe('TC-INC-020: Incident create triage assist', () => {
  test('hides Suggest with AI and explains no-provider availability on the create page', async ({ page, request }) => {
    const token = await getAuthToken(request)
    const availabilityResponse = await apiFetch(request, 'GET', AI_AVAILABILITY_API, token)
    expect(availabilityResponse.status(), 'availability check should succeed for admin').toBe(200)
    const availability = await readJsonSafe<AvailabilityResponse>(availabilityResponse)
    test.skip(availability?.available === true, 'AI provider configured — the no-provider notice path does not apply in this env')
    expect(availability, 'no-provider integration env should expose the no_provider reason').toMatchObject({
      available: false,
      reason: 'no_provider',
    })

    await login(page, 'admin')
    await page.goto('/backend/incidents/create', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /^Create incident$/ })).toBeVisible()
    await page.locator('[data-crud-field-id="title"] input').first().fill('Checkout payments failing for all customers')

    await expect(
      page.getByText('AI features are off because no AI provider is configured for this workspace.'),
      'AiUnavailableNotice should explain why triage assist is hidden',
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /^Suggest with AI$/ }), 'Suggest with AI should be hidden without a provider').toHaveCount(0)
  })

  test('runs the live triage suggestion flow only when an AI provider is configured', async ({ page, request }) => {
    const token = await getAuthToken(request)
    const availabilityResponse = await apiFetch(request, 'GET', AI_AVAILABILITY_API, token)
    expect(availabilityResponse.status(), 'availability check should succeed for admin').toBe(200)
    const availability = await readJsonSafe<AvailabilityResponse>(availabilityResponse)
    test.skip(availability?.available !== true, 'AI provider unavailable (no API key configured)')

    await login(page, 'admin')
    await page.goto('/backend/incidents/create', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-crud-field-id="title"] input').first().fill('Checkout payments failing for all customers')
    await page.locator('[data-crud-field-id="description"] textarea, [data-crud-field-id="description"] input').first().fill('Customers report failed card authorizations across every storefront region.')

    const [triageResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes(AI_TRIAGE_API) &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      ),
      page.getByRole('button', { name: /^Suggest with AI$/ }).click(),
    ])
    const triage = await triageResponse.json().catch(() => null) as TriageResponse | null
    expect(triage?.suggestion, 'live provider should return a triage suggestion for an outage-style title').toBeTruthy()

    await expect(page.getByText('AI suggestion'), 'suggestion card should render after a live provider response').toBeVisible()
    await page.getByRole('button', { name: /^Apply$/ }).click()
    await expect(page.getByText('AI suggestion'), 'suggestion remains visible after applying so fields can be reviewed').toBeVisible()
  })
})
