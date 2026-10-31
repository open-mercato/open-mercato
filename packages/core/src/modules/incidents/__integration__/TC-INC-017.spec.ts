import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['incidents', 'customers'],
}

const INCIDENTS_API = '/api/incidents'
const SEVERITIES_API = '/api/incidents/severities'
const COMPANIES_API = '/api/customers/companies'

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

type ListResponse<T> = {
  items?: T[]
}

type CompanyRecord = {
  id: string
  displayName?: string | null
  display_name?: string | null
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

function itemsFrom<T>(body: ListResponse<T> | null): T[] {
  return Array.isArray(body?.items) ? body.items : []
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

async function createSeverity(
  request: APIRequestContext,
  token: string,
  scope: Scope,
): Promise<string> {
  const response = await apiFetch(request, 'POST', SEVERITIES_API, token, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    key: `tc_inc_017_${randomUUID().slice(0, 8)}`,
    label: `TC-INC-017 Severity ${uniqueSuffix()}`,
    rank: 901,
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
    title: `INC impacts UI ${uniqueSuffix()}`,
    description: 'Impact panel integration fixture',
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

async function createCompany(
  request: APIRequestContext,
  token: string,
  displayName: string,
): Promise<string> {
  const response = await apiFetch(request, 'POST', COMPANIES_API, token, { displayName })
  expect(response.status(), 'POST /api/customers/companies should create a company').toBe(201)
  const body = await readJsonSafe<{ id?: unknown; entityId?: unknown; companyId?: unknown }>(response)
  return expectId(body?.id ?? body?.entityId ?? body?.companyId, 'created company should return id')
}

async function deleteCompanyIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiFetch(request, 'DELETE', `${COMPANIES_API}?id=${encodeURIComponent(id)}`, token).catch(() => undefined)
}

test.describe('TC-INC-017: Incident impacts UI', () => {
  test('adds customer-company and component impacts without exposing customer_account', async ({ page, request }) => {
    const token = await getAuthToken(request)
    const scope = getTokenContext(token)
    const companyName = `TC-INC-017 Company ${uniqueSuffix()}`
    const componentName = `TC-INC-017 Component ${uniqueSuffix()}`
    let severityId: string | null = null
    let incidentId: string | null = null
    let companyId: string | null = null

    try {
      severityId = await createSeverity(request, token, scope)
      companyId = await createCompany(request, token, companyName)
      await expect
        .poll(async () => {
          const response = await apiFetch(
            request,
            'GET',
            `${COMPANIES_API}?search=${encodeURIComponent(companyName)}&pageSize=5`,
            token,
          )
          if (!response.ok()) return false
          const body = await readJsonSafe<ListResponse<CompanyRecord>>(response)
          return itemsFrom(body).some((company) => company.id === companyId)
        }, { message: 'created company should be searchable before the UI flow', timeout: 45_000, intervals: [1_000] })
        .toBe(true)

      incidentId = await createIncident(request, token, scope, severityId)
      await login(page, 'admin')
      await page.goto(`/backend/incidents/${encodeURIComponent(incidentId)}`, { waitUntil: 'domcontentloaded' })

      await page.getByRole('tab', { name: /^Impacts$/ }).click()
      await expect(page.getByText('Customer impact').first(), 'impact panel should render').toBeVisible()

      await page.getByRole('button', { name: /^Add impact$/ }).click()
      let dialog = page.getByRole('dialog', { name: /^Add impact$/ })
      await expect(dialog).toBeVisible()

      await dialog.getByLabel('Target type').click()
      await expect(page.getByRole('option', { name: /^Customer account$/ }), 'customer_account should not be offered in the UI dropdown').toHaveCount(0)
      await page.getByRole('option', { name: /^Customer company$/ }).click()

      const targetInput = dialog.getByLabel('Target ID')
      await targetInput.fill(companyName)
      const companyOption = page.getByRole('option', { name: companyName }).first()
      await expect(companyOption, 'RecordSelect should find the created company by name').toBeVisible()
      await companyOption.click()
      await expect(dialog.getByLabel('Label'), 'picked company label should auto-fill the snapshot label').toHaveValue(companyName)

      await Promise.all([
        page.waitForResponse((response) =>
          response.url().includes(`/api/incidents/${incidentId}/impacts`) &&
          response.request().method() === 'POST' &&
          response.status() === 200,
        ),
        dialog.getByRole('button', { name: /^Add impact$/ }).click(),
      ])

      const companyRow = page.locator('li', { hasText: companyName }).first()
      await expect(companyRow, 'impact row should render the company name, not only the UUID').toBeVisible()
      await expect(companyRow, 'impact row should not expose the raw company UUID as its label').not.toContainText(companyId)

      await page.getByRole('button', { name: /^Add impact$/ }).click()
      dialog = page.getByRole('dialog', { name: /^Add impact$/ })
      await expect(dialog).toBeVisible()
      await dialog.getByLabel('Target type').click()
      await page.getByRole('option', { name: /^Component$/ }).click()
      await dialog.getByLabel('Component name').fill(componentName)

      await Promise.all([
        page.waitForResponse((response) =>
          response.url().includes(`/api/incidents/${incidentId}/impacts`) &&
          response.request().method() === 'POST' &&
          response.status() === 200,
        ),
        dialog.getByRole('button', { name: /^Add impact$/ }).click(),
      ])

      await expect(page.getByText(componentName, { exact: true }), 'component impact should render by component name').toBeVisible()
    } finally {
      await deleteIncidentIfExists(request, token, incidentId)
      await deleteCompanyIfExists(request, token, companyId)
      await deleteSeverityIfExists(request, token, severityId)
    }
  })
})
