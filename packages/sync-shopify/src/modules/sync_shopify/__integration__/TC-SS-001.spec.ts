import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  FAKE_SHOPIFY_CLIENT_ID,
  FAKE_SHOPIFY_CLIENT_SECRET,
  FAKE_SHOPIFY_SHOP_DOMAIN,
} from '../lib/fake-api'

type JsonRecord = Record<string, unknown>

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const TEST_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
const APP_ROOT = TEST_APP_ROOT
  ? path.resolve(TEST_APP_ROOT)
  : path.resolve(process.cwd(), 'apps/mercato')
const APP_QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
const INTEGRATION_ID = 'sync_shopify'
const DATA_SYNC_IMPORT_QUEUE = 'data-sync-import'
const EVENTS_QUEUE = 'events'

if (!TEST_APP_ROOT) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = APP_QUEUE_BASE_DIR
}

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

function decodeTokenScope(token: string): { tenantId: string; orgId: string } {
  const [, payload] = token.split('.')
  if (!payload) throw new Error('Auth token is missing a JWT payload')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JsonRecord
  const tenantId = typeof claims.tenantId === 'string' ? claims.tenantId : ''
  const orgId = typeof claims.orgId === 'string' ? claims.orgId : ''
  if (!tenantId || !orgId) throw new Error('Auth token is missing tenantId/orgId claims')
  return { tenantId, orgId }
}

function scopedHeaders(token: string): Record<string, string> {
  const scope = decodeTokenScope(token)
  return {
    Authorization: `Bearer ${token}`,
    Cookie: `om_selected_tenant=${scope.tenantId}; om_selected_org=${scope.orgId}`,
  }
}

async function waitForCompletedRun(
  request: APIRequestContext,
  token: string,
  runId: string,
): Promise<JsonRecord> {
  const deadline = Date.now() + 120_000
  let lastRunBody: JsonRecord = {}
  while (Date.now() < deadline) {
    const runResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${encodeURIComponent(runId)}`, { token })
    expect(runResponse.status()).toBe(200)
    lastRunBody = await readJson(runResponse)
    const status = String(lastRunBody.status ?? '')
    if (status === 'completed') {
      await drainIntegrationQueue(EVENTS_QUEUE, { appRoot: APP_ROOT })
      return lastRunBody
    }
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`Sync run ${runId} finished with ${status}: ${JSON.stringify(lastRunBody)}`)
    }
    await drainIntegrationQueue(DATA_SYNC_IMPORT_QUEUE, { appRoot: APP_ROOT })
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for sync run ${runId}. Last response: ${JSON.stringify(lastRunBody)}`)
}

async function startImport(
  request: APIRequestContext,
  token: string,
  entityType: string,
): Promise<string> {
  const response = await request.fetch(`${BASE_URL}/api/data_sync/run`, {
    method: 'POST',
    headers: {
      ...scopedHeaders(token),
      'Content-Type': 'application/json',
    },
    data: {
      integrationId: INTEGRATION_ID,
      entityType,
      direction: 'import',
      fullSync: true,
      batchSize: 25,
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  const body = await readJson(response)
  const runId = String(body.runId ?? '')
  expect(runId).toMatch(/^[0-9a-f-]{36}$/i)
  return runId
}

async function listProductsByTitle(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<JsonRecord[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/catalog/products?search=${encodeURIComponent(title)}&pageSize=20`,
    { token },
  )
  expect(response.status()).toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? body.items as JsonRecord[] : []
  return items.filter((item) => String(item.title ?? '') === title)
}

async function listPeopleByEmail(
  request: APIRequestContext,
  token: string,
  email: string,
): Promise<JsonRecord[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/customers/people?search=${encodeURIComponent(email)}&pageSize=20`,
    { token },
  )
  expect(response.status()).toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? body.items as JsonRecord[] : []
  return items.filter((item) => String(item.primaryEmail ?? '') === email)
}

async function listOrdersByExternalReference(
  request: APIRequestContext,
  token: string,
  externalReference: string,
): Promise<JsonRecord[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/sales/orders?search=${encodeURIComponent(externalReference)}&pageSize=20`,
    { token },
  )
  expect(response.status()).toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? body.items as JsonRecord[] : []
  return items.filter((item) => String(item.externalReference ?? '') === externalReference)
}

test.describe('TC-SS-001: Shopify import via fake Admin API', () => {
  test('credentials, health, import, idempotency, and tenant scoping', async ({ request }) => {
    test.setTimeout(300_000)
    const token = await getAuthToken(request, 'admin')
    const previousCredentialsResponse = await apiRequest(
      request,
      'GET',
      `/api/integrations/${INTEGRATION_ID}/credentials`,
      { token },
    )
    expect(previousCredentialsResponse.status()).toBe(200)
    const previousCredentialsBody = await readJson(previousCredentialsResponse)
    const previousCredentials =
      previousCredentialsBody.credentials && typeof previousCredentialsBody.credentials === 'object'
        ? previousCredentialsBody.credentials as JsonRecord
        : {}

    const detailBefore = await apiRequest(request, 'GET', `/api/integrations/${INTEGRATION_ID}`, { token })
    expect(detailBefore.status()).toBe(200)
    const detailBeforeBody = await readJson(detailBefore)
    const baselineState = detailBeforeBody.state && typeof detailBeforeBody.state === 'object'
      ? detailBeforeBody.state as JsonRecord
      : {}

    const productTitle = 'QA Shopify Import Product'
    const customerEmail = 'ada.qa.sync-shopify@example.com'
    const createdProductIds: string[] = []
    const createdPersonIds: string[] = []
    const createdOrderIds: string[] = []
    const runIds: string[] = []

    try {
      const saveCredentials = await apiRequest(request, 'PUT', `/api/integrations/${INTEGRATION_ID}/credentials`, {
        token,
        data: {
          credentials: {
            shopDomain: FAKE_SHOPIFY_SHOP_DOMAIN,
            clientId: FAKE_SHOPIFY_CLIENT_ID,
            clientSecret: FAKE_SHOPIFY_CLIENT_SECRET,
            apiVersion: '2026-07',
          },
        },
      })
      expect(saveCredentials.status()).toBe(200)

      const enable = await apiRequest(request, 'PUT', `/api/integrations/${INTEGRATION_ID}/state`, {
        token,
        data: { isEnabled: true, reauthRequired: false },
      })
      expect(enable.status()).toBe(200)

      const health = await apiRequest(request, 'POST', `/api/integrations/${INTEGRATION_ID}/health`, { token })
      expect(health.status()).toBe(200)
      const healthBody = await readJson(health)
      expect(healthBody.status === 'healthy' || healthBody.lastHealthStatus === 'healthy' || String(healthBody.message ?? '').includes('QA Shopify')).toBe(true)

      const uiPage = await request.get(`${BASE_URL}/backend/integrations/${INTEGRATION_ID}`, {
        headers: scopedHeaders(token),
      })
      expect(uiPage.status()).toBeLessThan(500)

      for (const entityType of ['products', 'customers', 'orders'] as const) {
        const runId = await startImport(request, token, entityType)
        runIds.push(runId)
        const summary = await waitForCompletedRun(request, token, runId)
        expect(Number(summary.failedCount ?? 0)).toBe(0)
        expect(Number(summary.createdCount ?? 0) + Number(summary.updatedCount ?? 0) + Number(summary.skippedCount ?? 0)).toBeGreaterThan(0)
      }

      const products = await listProductsByTitle(request, token, productTitle)
      expect(products.length).toBeGreaterThanOrEqual(1)
      const productId = String(products[0]?.id ?? '')
      expect(productId).toMatch(/^[0-9a-f-]{36}$/i)
      createdProductIds.push(productId)

      const variantListResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/variants?productId=${encodeURIComponent(productId)}&pageSize=100`,
        { token },
      )
      expect(variantListResponse.status()).toBe(200)
      const variantListBody = await readJson(variantListResponse)
      const variantItems = Array.isArray(variantListBody.items) ? variantListBody.items as JsonRecord[] : []
      expect(variantItems.length).toBeGreaterThanOrEqual(100)

      const people = await listPeopleByEmail(request, token, customerEmail)
      expect(people.length).toBeGreaterThanOrEqual(1)
      const personId = String(people[0]?.id ?? people[0]?.entityId ?? '')
      expect(personId).toMatch(/^[0-9a-f-]{36}$/i)
      createdPersonIds.push(personId)

      const orders = await listOrdersByExternalReference(request, token, '#QA9001')
      expect(orders.length).toBe(1)
      const orderId = String(orders[0]?.id ?? '')
      expect(orderId).toMatch(/^[0-9a-f-]{36}$/i)
      createdOrderIds.push(orderId)

      const orderDetail = await apiRequest(request, 'GET', `/api/sales/orders/${encodeURIComponent(orderId)}`, { token })
      expect(orderDetail.status()).toBe(200)
      const orderDetailBody = await readJson(orderDetail)
      const order = (orderDetailBody.order && typeof orderDetailBody.order === 'object'
        ? orderDetailBody.order
        : orderDetailBody) as JsonRecord
      const lineCount = Number(order.lineItemCount ?? (Array.isArray(orderDetailBody.lines) ? orderDetailBody.lines.length : 0))
      expect(lineCount).toBeGreaterThanOrEqual(50)
      expect(Number(order.grandTotalGrossAmount ?? 0)).toBeGreaterThan(0)

      const discountedOrders = await listOrdersByExternalReference(request, token, '#QA9002')
      expect(discountedOrders.length).toBe(1)
      const discountedOrderId = String(discountedOrders[0]?.id ?? '')
      createdOrderIds.push(discountedOrderId)
      const discountedDetail = await apiRequest(
        request,
        'GET',
        `/api/sales/orders/${encodeURIComponent(discountedOrderId)}`,
        { token },
      )
      expect(discountedDetail.status()).toBe(200)
      const discountedBody = await readJson(discountedDetail)
      const discountedOrder = (discountedBody.order && typeof discountedBody.order === 'object'
        ? discountedBody.order
        : discountedBody) as JsonRecord
      expect(Number(discountedOrder.grandTotalGrossAmount ?? 0)).toBeCloseTo(88, 1)
      expect(Number(discountedOrder.discountTotalAmount ?? 0)).toBeGreaterThan(0)
      expect(Number(discountedOrder.shippingGrossAmount ?? discountedOrder.shippingNetAmount ?? 0)).toBeCloseTo(8, 1)

      const secondOrdersRunId = await startImport(request, token, 'orders')
      runIds.push(secondOrdersRunId)
      const secondSummary = await waitForCompletedRun(request, token, secondOrdersRunId)
      expect(Number(secondSummary.createdCount ?? 0)).toBe(0)
      expect(Number(secondSummary.skippedCount ?? 0)).toBeGreaterThanOrEqual(2)
      expect(Number(secondSummary.failedCount ?? 0)).toBe(0)

      const employeeToken = await getAuthToken(request, 'employee')
      const employeeProducts = await apiRequest(
        request,
        'GET',
        `/api/catalog/products/${encodeURIComponent(productId)}`,
        { token: employeeToken },
      )
      expect([200, 403, 404]).toContain(employeeProducts.status())
      if (employeeProducts.status() === 200) {
        const employeeBody = await readJson(employeeProducts)
        const employeeOrg = String(
          (employeeBody.organizationId as string | undefined)
            ?? ((employeeBody.product as JsonRecord | undefined)?.organizationId as string | undefined)
            ?? '',
        )
        expect(employeeOrg === '' || employeeOrg === decodeTokenScope(token).orgId).toBe(true)
      }
    } finally {
      for (const runId of runIds) {
        await apiRequest(request, 'POST', `/api/data_sync/runs/${encodeURIComponent(runId)}/cancel`, { token }).catch(() => undefined)
      }
      for (const orderId of createdOrderIds) {
        await deleteEntityIfExists(request, token, '/api/sales/orders', orderId)
      }
      for (const personId of createdPersonIds) {
        await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      }
      for (const productId of createdProductIds) {
        await deleteEntityIfExists(request, token, '/api/catalog/products', productId)
      }
      await apiRequest(request, 'PUT', `/api/integrations/${INTEGRATION_ID}/credentials`, {
        token,
        data: { credentials: previousCredentials },
      }).catch(() => undefined)
      await apiRequest(request, 'PUT', `/api/integrations/${INTEGRATION_ID}/state`, {
        token,
        data: {
          isEnabled: typeof baselineState.isEnabled === 'boolean' ? baselineState.isEnabled : true,
          reauthRequired: typeof baselineState.reauthRequired === 'boolean' ? baselineState.reauthRequired : false,
        },
      }).catch(() => undefined)
    }
  })
})
