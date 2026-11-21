import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  canManageSalesOrders,
  createOrderLineFixture,
  createSalesOrderFixture,
  createShipmentFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { skipIfUndoTestsDisabled } from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-SALES-055: the order Version History panel refuses to undo a change once another
 * user only reordered the shipment tracking numbers afterwards.
 *
 * The browser counterpart of TC-SALES-050. Actor A, a fresh employee-role user, edits the
 * order comment and later presses "Undo last action" in the Version History panel. A sees
 * only their own history rows, so the button targets A's order update rather than B's
 * later shipment update. In between, actor B (admin) reorders the shipment's tracking
 * numbers through `PUT /api/sales/shipments`. B uses the API because a save from the Edit
 * shipment dialog also recreates the shipment items and, by default, posts an order note,
 * either of which would make the undo stale on its own. The panel must show the
 * stale-order message and keep both edits. When B saves the tracking numbers in the same
 * order, the same undo must succeed and clear the comment.
 */

export const integrationMeta = { dependsOnModules: ['sales', 'audit_logs'] }

type JsonMap = Record<string, unknown>

const STALE_ORDER_MESSAGE = 'This change can no longer be undone because the order was changed afterwards.'
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

type Fixture = { actorId: string | null; orderId: string | null; shipmentId: string | null }

type Actor = { email: string; password: string; token: string }

async function signInBrowser(page: Page, actor: Actor): Promise<void> {
  const form = new URLSearchParams({ email: actor.email, password: actor.password })
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok(), `browser login should succeed, got ${response.status()}`).toBeTruthy()
  const { tenantId, organizationId } = getTokenContext(actor.token)
  await acknowledgeGlobalNotices(page)
  await page.context().addCookies([
    { name: 'om_selected_tenant', value: tenantId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_org', value: organizationId, url: BASE_URL, sameSite: 'Lax' },
  ])
}

async function setTrackingNumbers(
  request: APIRequestContext,
  token: string,
  fixture: Fixture,
  trackingNumbers: string[],
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/sales/shipments', {
    token,
    data: { id: fixture.shipmentId, orderId: fixture.orderId, trackingNumbers },
  })
  expect(response.status(), 'PUT /api/sales/shipments should be 200').toBe(200)
}

async function createFixture(
  request: APIRequestContext,
  adminToken: string,
  fixture: Fixture,
  stamp: number,
  lineName: string,
): Promise<Actor> {
  const { organizationId } = getTokenContext(adminToken)
  const email = `qa-sales-055-${stamp}@acme.com`
  const password = `QaSales1!${stamp}`
  fixture.actorId = await createUserFixture(request, adminToken, {
    email,
    password,
    organizationId,
    roles: ['employee'],
    name: `QA TC-SALES-055 ${stamp}`,
  })
  const token = await getAuthToken(request, email, password)
  test.skip(!(await canManageSalesOrders(request, token)), 'the employee role lacks sales.orders.manage on this tenant')
  fixture.orderId = await createSalesOrderFixture(request, adminToken, 'USD')
  const orderLineId = await createOrderLineFixture(request, adminToken, fixture.orderId, {
    quantity: 2,
    name: lineName,
  })
  fixture.shipmentId = await createShipmentFixture(request, adminToken, fixture.orderId, [
    { orderLineId, quantity: 1 },
  ])
  await setTrackingNumbers(request, adminToken, fixture, ['TRACK-1', 'TRACK-2'])
  return { email, password, token }
}

async function readOrderComment(request: APIRequestContext, token: string, orderId: string): Promise<unknown> {
  const response = await apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(orderId)}`, { token })
  expect(response.status(), 'GET /api/sales/orders should be 200').toBe(200)
  const body = await readJsonSafe<{ items?: JsonMap[] }>(response)
  const order = body?.items?.find((item) => item.id === orderId)
  expect(order, 'the order should be listed').toHaveProperty('comment')
  return order?.comment ?? null
}

async function readTrackingNumbers(request: APIRequestContext, token: string, fixture: Fixture): Promise<unknown> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/sales/shipments?orderId=${encodeURIComponent(fixture.orderId as string)}`,
    { token },
  )
  expect(response.status(), 'GET /api/sales/shipments should be 200').toBe(200)
  const body = await readJsonSafe<{ items?: JsonMap[] }>(response)
  const shipment = body?.items?.find((item) => item.id === fixture.shipmentId)
  return shipment?.trackingNumbers ?? shipment?.tracking_numbers
}

async function cleanupFixture(request: APIRequestContext, token: string, fixture: Fixture): Promise<void> {
  await deleteSalesEntityIfExists(request, token, '/api/sales/orders', fixture.orderId)
  await deleteUserIfExists(request, token, fixture.actorId)
}

async function editOrderComment(page: Page, orderId: string, lineName: string, comment: string): Promise<void> {
  await page.goto(`/backend/sales/orders/${encodeURIComponent(orderId)}`, { waitUntil: 'commit' })
  await expect(page.getByText(lineName, { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Comment Not set', exact: true }).click()
  const editor = page.getByPlaceholder('Add comment', { exact: true })
  await expect(editor).toBeVisible()
  await editor.fill(comment)
  await editor.press('ControlOrMeta+Enter')
  await expect(page.getByText('Document updated.').first()).toBeVisible()
}

async function undoOwnOrderChange(page: Page, expectedStatus: number): Promise<Locator> {
  await page.getByRole('button', { name: 'Version History' }).first().click()
  const panel = page.getByRole('dialog', { name: 'Version History' })
  const undoButton = panel.getByRole('button', { name: 'Undo last action' })
  await expect(undoButton).toHaveCount(1)
  await expect(panel.getByText('Update sales order')).toHaveCount(1)
  const undoResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/audit_logs/audit-logs/actions/undo' &&
      response.request().method() === 'POST',
  )
  await undoButton.click()
  expect((await undoResponse).status(), 'undo response status').toBe(expectedStatus)
  return panel
}

test.describe('TC-SALES-055: Version History undo keeps a later tracking-number reorder', () => {
  test('refuses actor A undo after actor B only reordered the tracking numbers', async ({ page, request }) => {
    skipIfUndoTestsDisabled()
    const adminToken = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, adminToken)), 'sales.orders.manage not granted on this tenant')
    const stamp = Date.now()
    const lineName = `TC-SALES-055 line ${stamp}`
    const comment = `TC-SALES-055 actor A ${stamp}`
    const fixture: Fixture = { actorId: null, orderId: null, shipmentId: null }
    try {
      const actor = await createFixture(request, adminToken, fixture, stamp, lineName)
      await signInBrowser(page, actor)
      await editOrderComment(page, fixture.orderId as string, lineName, comment)

      await setTrackingNumbers(request, adminToken, fixture, ['TRACK-2', 'TRACK-1'])

      const panel = await undoOwnOrderChange(page, 409)
      await expect(panel.getByText(STALE_ORDER_MESSAGE)).toBeVisible()

      expect(await readOrderComment(request, adminToken, fixture.orderId as string)).toBe(comment)
      expect(await readTrackingNumbers(request, adminToken, fixture)).toEqual(['TRACK-2', 'TRACK-1'])
    } finally {
      await cleanupFixture(request, adminToken, fixture)
    }
  })

  test('undoes actor A change when actor B saved the tracking numbers unchanged', async ({ page, request }) => {
    skipIfUndoTestsDisabled()
    const adminToken = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, adminToken)), 'sales.orders.manage not granted on this tenant')
    const stamp = Date.now()
    const lineName = `TC-SALES-055 ok line ${stamp}`
    const fixture: Fixture = { actorId: null, orderId: null, shipmentId: null }
    try {
      const actor = await createFixture(request, adminToken, fixture, stamp, lineName)
      await signInBrowser(page, actor)
      await editOrderComment(page, fixture.orderId as string, lineName, `TC-SALES-055 actor A ${stamp}`)

      await setTrackingNumbers(request, adminToken, fixture, ['TRACK-1', 'TRACK-2'])

      await undoOwnOrderChange(page, 200)
      await expect(page.getByRole('button', { name: 'Comment Not set', exact: true })).toBeVisible()

      expect(await readOrderComment(request, adminToken, fixture.orderId as string)).toBeNull()
      expect(await readTrackingNumbers(request, adminToken, fixture)).toEqual(['TRACK-1', 'TRACK-2'])
    } finally {
      await cleanupFixture(request, adminToken, fixture)
    }
  })
})
