import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
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

type IncidentRecord = {
  id: string
  severity_id?: string | null
  priority?: string | null
  updated_at?: string | null
}

type SeverityFixture = {
  id: string
  label: string
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  label: string,
  rank: number,
): Promise<SeverityFixture> {
  const response = await apiFetch(request, 'POST', SEVERITIES_API, token, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    key: `tc_inc_019_${randomUUID().slice(0, 8)}`,
    label,
    rank,
    colorToken: 'info',
    isActive: true,
  })
  expect(response.status(), 'POST /api/incidents/severities should create a severity').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return { id: expectId(body?.id, 'created severity should return id'), label }
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
    title: `INC detail tabs inline ${uniqueSuffix()}`,
    description: 'Detail tabs and inline edit integration fixture',
    severityId,
    priority: 'medium',
  })
  expect(response.status(), 'POST /api/incidents should create an incident').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return expectId(body?.id, 'created incident should return id')
}

async function readIncident(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<IncidentRecord> {
  const response = await apiFetch(request, 'GET', `${INCIDENTS_API}?id=${encodeURIComponent(id)}&pageSize=1`, token)
  expect(response.status(), 'GET /api/incidents?id=... should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<IncidentRecord>>(response)
  const item = itemsFrom(body).find((record) => record.id === id)
  expect(item, `incident ${id} should be returned by detail GET`).toBeTruthy()
  return item!
}

async function deleteIncidentIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiFetch(request, 'DELETE', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, token).catch(() => undefined)
}

function detailField(page: Page, label: string) {
  return page
    .locator('[data-component-handle="section:ui.detail.DetailFieldsSection"] div.group', {
      has: page.getByText(new RegExp(`^${escapeRegExp(label)}$`)),
    })
    .first()
}

async function saveInlineSelect(
  page: Page,
  input: {
    fieldLabel: string
    optionLabel: string
    responsePath: string
    method: string
  },
): Promise<void> {
  const field = detailField(page, input.fieldLabel)
  await expect(field, `${input.fieldLabel} inline field should be visible`).toBeVisible()
  await field.click()
  await field.getByRole('combobox').click()
  await page.getByRole('option', { name: input.optionLabel, exact: true }).click()
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes(input.responsePath) &&
      response.request().method() === input.method &&
      response.status() === 200,
    ),
    field.getByRole('button', { name: /^Save/ }).click(),
  ])
}

test.describe('TC-INC-019: Incident detail tabs and inline edits', () => {
  test('switches detail tabs and persists consecutive inline severity and priority edits', async ({ page, request }) => {
    const token = await getAuthToken(request)
    const scope = getTokenContext(token)
    const firstSeverityLabel = `TC-INC-019 Initial ${uniqueSuffix()}`
    const secondSeverityLabel = `TC-INC-019 Changed ${uniqueSuffix()}`
    let firstSeverityId: string | null = null
    let secondSeverityId: string | null = null
    let incidentId: string | null = null

    try {
      const firstSeverity = await createSeverity(request, token, scope, firstSeverityLabel, 910)
      const secondSeverity = await createSeverity(request, token, scope, secondSeverityLabel, 911)
      firstSeverityId = firstSeverity.id
      secondSeverityId = secondSeverity.id
      incidentId = await createIncident(request, token, scope, firstSeverityId)

      await login(page, 'admin')
      await page.goto(`/backend/incidents/${encodeURIComponent(incidentId)}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /INC detail tabs inline/ })).toBeVisible()

      await expect(page.getByRole('tab', { name: /^Timeline$/ })).toBeVisible()
      await expect(page.getByRole('tab', { name: /^Impacts$/ })).toBeVisible()
      await expect(page.getByRole('tab', { name: /^Action items$/ })).toBeVisible()
      await expect(page.getByRole('tab', { name: /^Postmortem$/ })).toBeVisible()

      await page.getByRole('tab', { name: /^Timeline$/ }).click()
      await expect(page.getByText('Description').first()).toBeVisible()
      await expect(page.getByText('Timeline').first()).toBeVisible()

      await page.getByRole('tab', { name: /^Impacts$/ }).click()
      await expect(page.getByText('Customer impact').first()).toBeVisible()

      await page.getByRole('tab', { name: /^Action items$/ }).click()
      await expect(page.getByText('Action items').first()).toBeVisible()

      await page.getByRole('tab', { name: /^Postmortem$/ }).click()
      await expect(page.getByText('Postmortem').first()).toBeVisible()

      await saveInlineSelect(page, {
        fieldLabel: 'Severity',
        optionLabel: secondSeverity.label,
        responsePath: `/api/incidents/${incidentId}/severity`,
        method: 'POST',
      })
      await expect(detailField(page, 'Severity'), 'severity inline field should show the changed label').toContainText(secondSeverity.label)

      await saveInlineSelect(page, {
        fieldLabel: 'Priority',
        optionLabel: 'High',
        responsePath: '/api/incidents',
        method: 'PUT',
      })
      await expect(detailField(page, 'Priority'), 'second consecutive inline edit without a reload should persist (client refreshes updatedAt between saves)').toContainText('High')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(detailField(page, 'Severity'), 'severity edit should persist after reload').toContainText(secondSeverity.label)
      await expect(detailField(page, 'Priority'), 'priority edit should persist after reload').toContainText('High')

      const detail = await readIncident(request, token, incidentId)
      expect(detail.severity_id, 'severity_id should persist after inline edit').toBe(secondSeverity.id)
      expect(detail.priority, 'priority should persist after the second inline edit without a false 409').toBe('high')

      await page.route('**/api/events/stream**', (route) => route.abort())
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(detailField(page, 'Priority'), 'priority field should render before the stale-edit attempt').toBeVisible()
      await apiFetch(request, 'POST', `${INCIDENTS_API}/${incidentId}/severity`, token, { severityId: firstSeverity.id })
      const staleField = detailField(page, 'Priority')
      await staleField.click()
      await staleField.getByRole('combobox').click()
      await page.getByRole('option', { name: 'Medium', exact: true }).click()
      await staleField.getByRole('button', { name: /^Save/ }).click()
      await expect(page.getByTestId('record-conflict-banner'), 'stale updatedAt inline edit should surface the conflict banner').toBeVisible()
    } finally {
      await deleteIncidentIfExists(request, token, incidentId)
      await deleteSeverityIfExists(request, token, secondSeverityId)
      await deleteSeverityIfExists(request, token, firstSeverityId)
    }
  })
})
