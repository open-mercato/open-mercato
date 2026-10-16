import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
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
  const deadline = Date.now() + 180_000
  let lastRunBody: JsonRecord = {}
  while (Date.now() < deadline) {
    const runResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${encodeURIComponent(runId)}`, { token })
    expect(runResponse.status()).toBe(200)
    lastRunBody = await readJson(runResponse)
    const status = String(lastRunBody.status ?? '')
    if (status === 'completed') {
      await drainIntegrationQueue(EVENTS_QUEUE, { appRoot: APP_ROOT }).catch(() => 0)
      return lastRunBody
    }
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`Sync run ${runId} finished with ${status}: ${JSON.stringify(lastRunBody)}`)
    }
    // Let the app's armed background workers process data-sync-import jobs.
    // Draining that queue from the Playwright process can resolve encrypted
    // credentials without shopDomain and fail the run.
    await new Promise((resolve) => setTimeout(resolve, 750))
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
  const body = await readJson(response)
  expect(response.status(), JSON.stringify(body)).toBe(201)
  const runId = String(body.id ?? body.runId ?? '')
  expect(runId).toMatch(/^[0-9a-f-]{36}$/i)
  return runId
}

let sharedDbClient: Client | null = null

async function getDbClient(): Promise<Client> {
  if (sharedDbClient) return sharedDbClient
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for TC-SS-001 mapping lookups')
  const client = new Client({ connectionString })
  await client.connect()
  sharedDbClient = client
  return client
}

async function closeDbClient(): Promise<void> {
  const client = sharedDbClient
  sharedDbClient = null
  if (client) await client.end()
}

async function findMappedLocalId(
  entityType: string,
  externalId: string,
  scope: { tenantId: string; orgId: string },
): Promise<string | null> {
  const client = await getDbClient()
  const result = await client.query<{ internal_entity_id: string }>(
    `
      select internal_entity_id
      from sync_external_id_mappings
      where integration_id = $1
        and internal_entity_type = $2
        and external_id = $3
        and organization_id = $4
        and tenant_id = $5
        and deleted_at is null
      order by updated_at desc
      limit 1
    `,
    [INTEGRATION_ID, entityType, externalId, scope.orgId, scope.tenantId],
  )
  return result.rows[0]?.internal_entity_id ?? null
}

async function softDeleteScopedMappings(scope: { tenantId: string; orgId: string }): Promise<void> {
  const client = await getDbClient()
  await client.query(
    `
      update sync_external_id_mappings
      set deleted_at = now(), updated_at = now()
      where integration_id = $1
        and organization_id = $2
        and tenant_id = $3
        and deleted_at is null
    `,
    [INTEGRATION_ID, scope.orgId, scope.tenantId],
  )
}

async function fetchListItem(
  request: APIRequestContext,
  token: string,
  collectionPath: string,
  id: string,
): Promise<JsonRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${collectionPath}?id=${encodeURIComponent(id)}&pageSize=1`,
    { token },
  )
  expect(response.status(), `GET ${collectionPath}?id= should be 200`).toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? body.items as JsonRecord[] : []
  return items[0] ?? null
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

    const scope = decodeTokenScope(token)
    const createdProductIds: string[] = []
    const createdPersonIds: string[] = []
    const createdOrderIds: string[] = []
    const runIds: string[] = []

    try {
      // Prior runs may leave mappings that point at soft-deleted rows; clear them
      // so this import creates fresh entities instead of updating ghosts.
      const staleProductId = await findMappedLocalId('catalog_product', 'gid://shopify/Product/9001', scope)
      const stalePersonId = await findMappedLocalId('customer_person', 'gid://shopify/Customer/9001', scope)
      const staleOrderIds = [
        await findMappedLocalId('sales_order', 'gid://shopify/Order/9001', scope),
        await findMappedLocalId('sales_order', 'gid://shopify/Order/9002', scope),
      ]
      for (const orderId of staleOrderIds) {
        if (orderId) await deleteEntityIfExists(request, token, '/api/sales/orders', orderId)
      }
      if (stalePersonId) await deleteEntityIfExists(request, token, '/api/customers/people', stalePersonId)
      if (staleProductId) await deleteEntityIfExists(request, token, '/api/catalog/products', staleProductId)
      await softDeleteScopedMappings(scope)

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

      const productId = await findMappedLocalId('catalog_product', 'gid://shopify/Product/9001', scope)
      expect(productId).toMatch(/^[0-9a-f-]{36}$/i)
      createdProductIds.push(productId!)

      const productDetailBody = await fetchListItem(request, token, '/api/catalog/products', productId!)
      expect(productDetailBody).not.toBeNull()
      expect(String(productDetailBody?.title ?? '')).toContain('QA Shopify Import Product')

      const variantListResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/variants?productId=${encodeURIComponent(productId!)}&pageSize=100`,
        { token },
      )
      expect(variantListResponse.status()).toBe(200)
      const variantListBody = await readJson(variantListResponse)
      const variantItems = Array.isArray(variantListBody.items) ? variantListBody.items as JsonRecord[] : []
      expect(variantItems.length).toBeGreaterThanOrEqual(100)

      const personId = await findMappedLocalId('customer_person', 'gid://shopify/Customer/9001', scope)
      expect(personId).toMatch(/^[0-9a-f-]{36}$/i)
      createdPersonIds.push(personId!)
      const personDetail = await apiRequest(
        request,
        'GET',
        `/api/customers/people/${encodeURIComponent(personId!)}`,
        { token },
      )
      expect(personDetail.status()).toBe(200)
      const personBody = await readJson(personDetail)
      const personEmail = String(
        personBody.primaryEmail
          ?? (personBody.person as JsonRecord | undefined)?.primaryEmail
          ?? '',
      )
      expect(personEmail).toBe('ada.qa.sync-shopify@example.com')

      const orderId = await findMappedLocalId('sales_order', 'gid://shopify/Order/9001', scope)
      expect(orderId).toMatch(/^[0-9a-f-]{36}$/i)
      createdOrderIds.push(orderId!)

      const order = await fetchListItem(request, token, '/api/sales/orders', orderId!)
      expect(order).not.toBeNull()
      const lineCount = Number(
        order?.lineItemCount
          ?? (Array.isArray(order?.lines) ? (order.lines as unknown[]).length : 0),
      )
      expect(lineCount).toBeGreaterThanOrEqual(50)
      expect(Number(order?.grandTotalGrossAmount ?? 0)).toBeGreaterThan(0)

      const discountedOrderId = await findMappedLocalId('sales_order', 'gid://shopify/Order/9002', scope)
      expect(discountedOrderId).toMatch(/^[0-9a-f-]{36}$/i)
      createdOrderIds.push(discountedOrderId!)
      const discountedOrder = await fetchListItem(request, token, '/api/sales/orders', discountedOrderId!)
      expect(discountedOrder).not.toBeNull()
      expect(Number(discountedOrder?.grandTotalGrossAmount ?? 0)).toBeCloseTo(88, 1)
      expect(Number(discountedOrder?.discountTotalAmount ?? 0)).toBeGreaterThan(0)
      expect(Number(discountedOrder?.shippingGrossAmount ?? discountedOrder?.shippingNetAmount ?? 0)).toBeCloseTo(8, 1)

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
        `/api/catalog/products?id=${encodeURIComponent(productId!)}&pageSize=1`,
        { token: employeeToken },
      )
      expect([200, 403, 404]).toContain(employeeProducts.status())
      if (employeeProducts.status() === 200) {
        const employeeBody = await readJson(employeeProducts)
        const employeeItems = Array.isArray(employeeBody.items) ? employeeBody.items as JsonRecord[] : []
        const employeeItem = employeeItems[0] ?? {}
        const employeeOrg = String(employeeItem.organizationId ?? '')
        expect(employeeOrg === '' || employeeOrg === scope.orgId).toBe(true)
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
      await softDeleteScopedMappings(scope).catch(() => undefined)
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
      await closeDbClient()
    }
  })
})
