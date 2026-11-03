import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  canManageSalesOrders,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'sales'],
}

const STATEMENTS_PATH = '/api/eudr/statements'
const SALES_ORDERS_PATH = '/api/sales/orders'

type StatementListItem = {
  id?: string
  title?: string | null
  orderId?: string | null
  referenceNumber?: string | null
}

async function expectNoErrorState(page: Page, loadError?: string): Promise<void> {
  await expect(
    page.getByRole('heading', {
      name: /Application error: a client-side exception has occurred|Something went wrong/i,
    }).first(),
  ).not.toBeVisible()
  if (loadError) {
    await expect(page.getByText(loadError, { exact: true })).not.toBeVisible()
  }
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

/**
 * TC-EUDR-012: Order compliance panel.
 *
 * Creates a sales order plus a due diligence statement linked to it via
 * `orderId`, asserts `GET /api/eudr/statements?orderId=` returns exactly the
 * linked statement and `?search=<referenceNumber>` finds it, then opens the
 * sales order detail page and verifies the
 * injected "EUDR compliance" panel lists the statement with its reference
 * number and that the statement title link navigates to the statement detail.
 *
 * Runs as `admin`; on dev databases whose role ACLs were never synced the
 * spec self-skips via `canManageSalesOrders`.
 */
test.describe('TC-EUDR-012: Order compliance panel', () => {
  test('lists linked statements on the sales order detail page and navigates to the statement', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(
      !(await canManageSalesOrders(request, token)),
      'admin role lacks sales.orders.manage on this database (run yarn mercato auth sync-role-acls)',
    )

    const stamp = `${Date.now()}-${randomUUID()}`
    const title = `TC-EUDR-012 Statement ${stamp}`
    const unlinkedTitle = `TC-EUDR-012 Unlinked ${stamp}`
    const referenceNumber = `TC-EUDR-012-REF-${stamp}`
    let orderId: string | null = null
    let statementId: string | null = null
    let unlinkedStatementId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token)
      statementId = await createStatement(request, token, {
        title,
        commodity: 'cocoa',
        orderId,
        referenceNumber,
      })
      unlinkedStatementId = await createStatement(request, token, {
        title: unlinkedTitle,
        commodity: 'cocoa',
      })

      const filteredResponse = await apiRequest(
        request,
        'GET',
        `${STATEMENTS_PATH}?orderId=${encodeURIComponent(orderId)}`,
        { token },
      )
      expect(filteredResponse.status(), `statements orderId filter failed: ${filteredResponse.status()}`).toBe(200)
      const filteredBody = await readJsonSafe<{ items?: StatementListItem[] }>(filteredResponse)
      const filteredItems = filteredBody?.items ?? []
      expect(filteredItems, 'orderId filter should return exactly the linked statement').toHaveLength(1)
      expect(filteredItems[0]?.id).toBe(statementId)
      expect(filteredItems[0]?.title).toBe(title)
      expect(filteredItems[0]?.orderId).toBe(orderId)
      expect(filteredItems[0]?.referenceNumber).toBe(referenceNumber)

      const searchResponse = await apiRequest(
        request,
        'GET',
        `${STATEMENTS_PATH}?search=${encodeURIComponent(referenceNumber)}`,
        { token },
      )
      expect(searchResponse.status(), `statements search failed: ${searchResponse.status()}`).toBe(200)
      const searchBody = await readJsonSafe<{ items?: StatementListItem[] }>(searchResponse)
      const searchMatch = (searchBody?.items ?? []).find((item) => item.id === statementId)
      expect(searchMatch, 'search by reference number should return the created statement').toBeTruthy()
      expect(searchMatch?.referenceNumber).toBe(referenceNumber)

      await login(page, 'admin')
      await page.goto(`/backend/sales/documents/${encodeURIComponent(orderId)}?kind=order`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.getByText('EUDR compliance').first()).toBeVisible({ timeout: 20_000 })

      const statementLink = page.getByRole('link', { name: title })
      await expect(statementLink).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(referenceNumber).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Copy reference number' }).first()).toBeVisible()
      await expect(page.getByRole('link', { name: unlinkedTitle })).toHaveCount(0)
      await expectNoErrorState(page, 'Failed to load due diligence statements.')

      await statementLink.click()
      await page.waitForURL(`**/backend/eudr/statements/${statementId}`, { timeout: 15_000 })
      await expect(page.getByRole('button', { name: /submit/i }).first()).toBeVisible({ timeout: 15_000 })
      await expectNoErrorState(page, 'Could not load statement.')
    } finally {
      await deleteStatementIfExists(request, token, unlinkedStatementId)
      await deleteStatementIfExists(request, token, statementId)
      await deleteSalesEntityIfExists(request, token, SALES_ORDERS_PATH, orderId)
    }
  })
})
