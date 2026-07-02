import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  canManageSalesOrders,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const INCIDENTS_API = '/api/incidents'
const SEVERITIES_API = '/api/incidents/severities'
const SALES_ORDERS_API = '/api/sales/orders'

type Scope = {
  organizationId: string
  tenantId: string
}

type ListResponse<T> = {
  items?: T[]
}

type SeverityRecord = {
  id: string
}

type SalesOrderRecord = {
  id: string
  orderNumber?: string | null
  order_number?: string | null
}

let token = ''
let scope: Scope
const createdIncidentIds = new Set<string>()

function uniqueSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`
}

function itemsFrom<T>(body: ListResponse<T> | null): T[] {
  return Array.isArray(body?.items) ? body.items : []
}

async function fetchSeverityId(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'GET', `${SEVERITIES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'GET /api/incidents/severities should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<SeverityRecord>>(response)
  const severity = itemsFrom(body).find((item) => typeof item.id === 'string' && item.id.length > 0)
  expect(severity, 'at least one active severity should exist').toBeTruthy()
  return severity!.id
}

async function createIncident(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'POST', INCIDENTS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: `INC impact RecordSelect ${uniqueSuffix()}`,
      description: 'Playwright impact RecordSelect fixture',
      severityId: await fetchSeverityId(request),
    },
  })
  expect(response.status(), 'POST /api/incidents should create an incident').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'created incident should return id')
  createdIncidentIds.add(id)
  return id
}

async function deleteIncidentIfExists(request: APIRequestContext, id: string | null): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // Cleanup must not mask the assertion that already failed.
  } finally {
    createdIncidentIds.delete(id)
  }
}

async function readSalesOrder(request: APIRequestContext, id: string): Promise<SalesOrderRecord | null> {
  const response = await apiRequest(request, 'GET', `${SALES_ORDERS_API}?id=${encodeURIComponent(id)}`, { token })
  if (!response.ok()) return null
  const body = await readJsonSafe<ListResponse<SalesOrderRecord>>(response)
  return itemsFrom(body).find((item) => item.id === id) ?? null
}

test.describe('TC-INC-015: Incident impact RecordSelect', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    scope = getTokenContext(token)
  })

  test.afterAll(async ({ request }) => {
    for (const id of Array.from(createdIncidentIds)) {
      await deleteIncidentIfExists(request, id)
    }
  })

  test('adds a sales order impact through RecordSelect search', async ({ page, request }) => {
    test.setTimeout(90_000)
    const salesAvailable = await canManageSalesOrders(request, token)
    test.skip(!salesAvailable, 'Sales module/API is not present or the admin role cannot create sales orders in this environment.')

    let orderId: string | null = null
    let incidentId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const order = await readSalesOrder(request, orderId)
      const orderNumber = order?.orderNumber ?? order?.order_number ?? null
      test.skip(!orderNumber, 'Sales order fixture did not expose an order number to search by.')

      await expect
        .poll(async () => {
          const response = await apiRequest(request, 'GET', `${SALES_ORDERS_API}?search=${encodeURIComponent(orderNumber as string)}&pageSize=5`, { token })
          if (!response.ok()) return false
          const body = await readJsonSafe<ListResponse<SalesOrderRecord>>(response)
          return itemsFrom(body).some((item) => item.id === orderId)
        }, { message: 'fixture order should become searchable before the UI flow', timeout: 45_000, intervals: [1_000] })
        .toBe(true)

      incidentId = await createIncident(request)
      await login(page, 'admin')
      await page.goto(`/backend/incidents/${encodeURIComponent(incidentId)}`, { waitUntil: 'domcontentloaded' })

      await page.getByRole('tab', { name: /^Impacts$/ }).click()
      await expect(page.getByText('Customer impact').first(), 'war room impact panel should render').toBeVisible()
      await page.getByRole('button', { name: /^Add impact$/ }).click()
      const dialog = page.getByRole('dialog', { name: /^Add impact$/ })
      await expect(dialog).toBeVisible()

      await dialog.getByLabel('Target type').click()
      await page.getByRole('option', { name: /^Order$/ }).click()

      const targetInput = dialog.getByLabel('Target ID')
      await targetInput.fill(orderNumber as string)
      const orderOption = page.getByRole('option', { name: orderNumber as string }).first()
      await expect(orderOption, 'RecordSelect should find the fixture order by order number').toBeVisible()
      await orderOption.click()

      await Promise.all([
        page.waitForResponse((response) =>
          response.url().includes(`/api/incidents/${incidentId}/impacts`) &&
          response.request().method() === 'POST' &&
          response.status() === 200,
        ),
        dialog.getByRole('button', { name: /^Add impact$/ }).click(),
      ])

      await expect(page.getByText(orderNumber as string, { exact: true }), 'impact row should render the order label').toBeVisible()
    } finally {
      await deleteIncidentIfExists(request, incidentId)
      await deleteSalesEntityIfExists(request, token, SALES_ORDERS_API, orderId)
    }
  })
})
