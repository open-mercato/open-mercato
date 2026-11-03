import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  canManageSalesOrders,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { createProductFixture } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'sales', 'catalog'],
}

const STATEMENTS_PATH = '/api/eudr/statements'
const MAPPINGS_PATH = '/api/eudr/product-mappings'
const ORDER_LINES_PATH = '/api/sales/order-lines'
const SALES_ORDERS_PATH = '/api/sales/orders'
const PRODUCTS_PATH = '/api/catalog/products'

type StatementListItem = {
  id?: string
  title?: string | null
  commodity?: string | null
  orderId?: string | null
  quantityKg?: string | number | null
  referenceNumber?: string | null
  verificationNumber?: string | null
  status?: string | null
}

async function expectNoErrorState(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', {
      name: /Application error: a client-side exception has occurred|Something went wrong/i,
    }).first(),
  ).not.toBeVisible()
}

async function createStatement(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', STATEMENTS_PATH, { token, data })
  expect(response.status(), `create statement failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Statement create response should include id')
}

async function deleteStatementIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', `${STATEMENTS_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

async function findStatementByTitle(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<StatementListItem | null> {
  // The list search rides the async query index, which can lag behind the
  // write under suite load — resolve the id straight from Postgres, then
  // read the item back through the API detail path (DB-backed).
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const id = await withClient(async (client) => {
      const result = await client.query<{ id: string }>(
        'select id from eudr_due_diligence_statements where title = $1 and deleted_at is null order by created_at desc limit 1',
        [title],
      )
      return result.rows[0]?.id ?? null
    })
    if (id) {
      const response = await apiRequest(request, 'GET', `${STATEMENTS_PATH}?id=${encodeURIComponent(id)}`, { token })
      if (response.status() === 200) {
        const body = await readJsonSafe<{ items?: StatementListItem[] }>(response)
        const match = (body?.items ?? []).find((item) => item.title === title)
        if (match) return match
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return null
}

/**
 * TC-EUDR-013: ERP-native statement flows.
 *
 * 1. Order prefill: a sales order with one line whose product carries an
 *    in-scope wood mapping seeds the statement create page opened with
 *    `?orderId=` — order picker resolved to the order number, title template
 *    applied, commodity preselected from the mapped line; saving persists the
 *    orderId link.
 * 2. Duplication: `?duplicateFrom=` copies only the structural field list
 *    (status forced draft, reference numbers never copied) and the list page
 *    exposes a Duplicate row action.
 * 3. Degradation: an unreadable duplicate source renders the empty form with
 *    the prefill-unavailable flash; a non-uuid orderId renders the plain form.
 */
test.describe('TC-EUDR-013: order prefill and statement duplication', () => {
  test('seeds from ?orderId=, duplicates via ?duplicateFrom=, degrades on bad params', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(
      !(await canManageSalesOrders(request, token)),
      'admin role lacks sales.orders.manage on this database (run yarn mercato auth sync-role-acls)',
    )

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const seededTitle = `TC-EUDR-013 Source ${stamp}`
    let productId: string | null = null
    let mappingId: string | null = null
    let orderId: string | null = null
    let orderLineId: string | null = null
    let sourceStatementId: string | null = null
    let orderSeededStatementId: string | null = null
    let duplicatedStatementId: string | null = null

    try {
      productId = await createProductFixture(request, token, {
        title: `TC-EUDR-013 Timber ${stamp}`,
        sku: `TC-EUDR-013-${stamp}`,
      })
      const mappingResponse = await apiRequest(request, 'POST', MAPPINGS_PATH, {
        token,
        data: { productId, commodity: 'wood', isInScope: true },
      })
      expect(mappingResponse.status(), 'mapping create should succeed').toBe(201)
      mappingId = expectId((await readJsonSafe<{ id?: string }>(mappingResponse))?.id, 'mapping id')

      orderId = await createSalesOrderFixture(request, token)
      const lineResponse = await apiRequest(request, 'POST', ORDER_LINES_PATH, {
        token,
        data: {
          orderId,
          productId,
          name: `TC-EUDR-013 Line ${stamp}`,
          quantity: 2,
          currencyCode: 'EUR',
        },
      })
      expect([200, 201], `order line create failed: ${lineResponse.status()}`).toContain(lineResponse.status())
      orderLineId = (await readJsonSafe<{ id?: string }>(lineResponse))?.id ?? null

      const orderRead = await apiRequest(request, 'GET', `${SALES_ORDERS_PATH}?id=${encodeURIComponent(orderId)}`, { token })
      const orderBody = await readJsonSafe<{ items?: Array<{ orderNumber?: string | null }> }>(orderRead)
      const orderNumber = orderBody?.items?.[0]?.orderNumber ?? ''
      expect(orderNumber, 'order fixture should expose an order number').toBeTruthy()

      await login(page, 'admin')

      await page.goto(`/backend/eudr/statements/create?orderId=${encodeURIComponent(orderId)}`, {
        waitUntil: 'domcontentloaded',
      })
      const titleInput = page.locator('[data-crud-field-id="title"] input').first()
      await expect(titleInput).toHaveValue(`DDS — ${orderNumber}`, { timeout: 20_000 })
      await expect(page.getByText(orderNumber).first()).toBeVisible()
      await expect(page.locator('body')).not.toContainText(orderId)
      await expect(
        page.locator('[data-crud-field-id="commodity"]'),
        'commodity preselect should settle before submitting',
      ).toContainText(/wood/i, { timeout: 20_000 })
      await expectNoErrorState(page)

      await page.getByRole('button', { name: /create statement/i }).first().click()
      const seeded = await findStatementByTitle(request, token, `DDS — ${orderNumber}`)
      expect(seeded, 'order-seeded statement should be persisted').toBeTruthy()
      orderSeededStatementId = seeded?.id ?? null
      expect(seeded?.orderId, 'saved statement should keep the order link').toBe(orderId)
      expect(seeded?.commodity, 'commodity should be preselected from the mapped order line').toBe('wood')

      sourceStatementId = await createStatement(request, token, {
        title: seededTitle,
        commodity: 'coffee',
        actorRole: 'operator',
        activityType: 'import',
        quantityKg: 125.5,
        notes: 'duplicate-me',
        referenceNumber: `TCREF${stamp.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}`,
      })

      await page.goto(`/backend/eudr/statements/create?duplicateFrom=${encodeURIComponent(sourceStatementId)}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(titleInput).toHaveValue(`${seededTitle} (copy)`, { timeout: 20_000 })
      await expectNoErrorState(page)
      await page.getByRole('button', { name: /create statement/i }).first().click()
      const duplicated = await findStatementByTitle(request, token, `${seededTitle} (copy)`)
      expect(duplicated, 'duplicated statement should be persisted').toBeTruthy()
      duplicatedStatementId = duplicated?.id ?? null
      expect(duplicated?.commodity).toBe('coffee')
      expect(duplicated?.status).toBe('draft')
      expect(duplicated?.referenceNumber ?? null, 'reference number must never be copied').toBeNull()
      expect(duplicated?.verificationNumber ?? null).toBeNull()

      await page.goto('/backend/eudr/statements', { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(seededTitle, { exact: true }).first()).toBeVisible({ timeout: 20_000 })
      const rowActionTrigger = page.getByRole('row', { name: new RegExp(seededTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).getByRole('button').last()
      await rowActionTrigger.click()
      await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible({ timeout: 10_000 })
      await page.keyboard.press('Escape')

      await page.goto(`/backend/eudr/statements/create?duplicateFrom=${encodeURIComponent(randomUUID())}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(titleInput).toHaveValue('', { timeout: 20_000 })
      await expect(
        page.getByText('The source record could not be loaded. Start with an empty statement instead.').first(),
      ).toBeVisible({ timeout: 15_000 })
      await expectNoErrorState(page)

      await page.goto('/backend/eudr/statements/create?orderId=not-a-uuid', { waitUntil: 'domcontentloaded' })
      await expect(titleInput).toHaveValue('', { timeout: 20_000 })
      await expectNoErrorState(page)
    } finally {
      await deleteStatementIfExists(request, token, duplicatedStatementId)
      await deleteStatementIfExists(request, token, sourceStatementId)
      await deleteStatementIfExists(request, token, orderSeededStatementId)
      if (orderLineId) {
        await apiRequest(request, 'DELETE', `${ORDER_LINES_PATH}?id=${encodeURIComponent(orderLineId)}`, { token }).catch(() => undefined)
      }
      await deleteSalesEntityIfExists(request, token, SALES_ORDERS_PATH, orderId)
      await deleteEntityIfExists(request, token, MAPPINGS_PATH, mappingId)
      await deleteEntityIfExists(request, token, PRODUCTS_PATH, productId)
    }
  })
})
