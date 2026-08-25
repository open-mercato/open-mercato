import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-042: the order detail page offers no edit it cannot complete.
 *
 * `sales.orders.manage` gates every order write route, but the detail page used to render its
 * customer card, addresses tab, tag editor and Delete button regardless — so a view-only user
 * could retype an address, press Save, and only then be refused. TC-SALES-035 already pins the
 * API half (403 without the feature); this pins the part the page itself decides.
 *
 * The two roles are the point. A test that only asserts the Delete button is ABSENT passes just
 * as happily when the page failed to render at all, so the manager pass runs first and proves
 * the button is there to be missed.
 */

function readTokenClaims(token: string): { tenantId?: string; orgId?: string | null } {
  const parts = token.split('.')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as {
    tenantId?: string
    orgId?: string | null
  }
}

async function loginWithCredentials(page: Page, email: string, password: string): Promise<void> {
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', password)
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok(), `Failed to log in ${email}: ${response.status()}`).toBeTruthy()
  const payload = await readJsonSafe<{ token?: string }>(response)
  expect(typeof payload?.token === 'string' && payload!.token!.length > 0, 'Login should return a token').toBeTruthy()
  const claims = readTokenClaims(payload!.token!)
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const cookies = [
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_feedback_suppress', value: '1', url: baseUrl, sameSite: 'Lax' as const },
  ]
  if (claims.tenantId) cookies.push({ name: 'om_selected_tenant', value: claims.tenantId, url: baseUrl, sameSite: 'Lax' as const })
  if (claims.orgId) cookies.push({ name: 'om_selected_org', value: claims.orgId, url: baseUrl, sameSite: 'Lax' as const })
  await page.context().addCookies(cookies)
  await page.goto('/backend', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/backend(?:\/.*)?$/)
}

async function openOrder(page: Page, orderId: string): Promise<void> {
  await page.goto(`/backend/sales/orders/${encodeURIComponent(orderId)}`, { waitUntil: 'commit' })
  // The permission answer arrives asynchronously and the page starts locked, so wait for a
  // read-only element that is present either way before asserting on the affordances.
  await expect(page.getByRole('button', { name: 'Addresses' })).toBeVisible({ timeout: 30_000 })
}

test.describe('TC-SALES-042 — order detail hides edits the viewer may not make', () => {
  let request: APIRequestContext
  let token: string
  let organizationId: string
  let orderId: string | null = null
  let managerRoleId: string | null = null
  let viewerRoleId: string | null = null
  let managerUserId: string | null = null
  let viewerUserId: string | null = null

  const stamp = Date.now()
  const managerEmail = `tc-sales-042-manager-${stamp}@example.com`
  const viewerEmail = `tc-sales-042-viewer-${stamp}@example.com`
  const password = 'TcSales042!pass'

  test.beforeAll(async ({ playwright }) => {
    request = await playwright.request.newContext({ baseURL: process.env.BASE_URL || 'http://localhost:3000' })
    token = await getAuthToken(request)
    const claims = readTokenClaims(token)
    organizationId = String(claims.orgId ?? '')
    expect(organizationId, 'admin token should carry an organization').not.toEqual('')

    orderId = await createSalesOrderFixture(request, token)

    managerRoleId = await createRoleFixture(request, token, { name: `tc-sales-042-manager-${stamp}` })
    await setRoleAclFeatures(request, token, {
      roleId: managerRoleId,
      features: ['sales.orders.view', 'sales.orders.manage'],
    })
    viewerRoleId = await createRoleFixture(request, token, { name: `tc-sales-042-viewer-${stamp}` })
    await setRoleAclFeatures(request, token, {
      roleId: viewerRoleId,
      features: ['sales.orders.view'],
    })

    managerUserId = await createUserFixture(request, token, {
      email: managerEmail, password, organizationId, roles: [managerRoleId], name: 'TC-SALES-042 manager',
    })
    viewerUserId = await createUserFixture(request, token, {
      email: viewerEmail, password, organizationId, roles: [viewerRoleId], name: 'TC-SALES-042 viewer',
    })
  })

  test.afterAll(async () => {
    await deleteUserIfExists(request, token, viewerUserId)
    await deleteUserIfExists(request, token, managerUserId)
    await deleteRoleIfExists(request, token, viewerRoleId)
    await deleteRoleIfExists(request, token, managerRoleId)
    await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    await request.dispose()
  })

  test('a user holding sales.orders.manage is offered the edits', async ({ page }) => {
    await loginWithCredentials(page, managerEmail, password)
    await openOrder(page, orderId!)

    // Control for the assertions below: these exist and are reachable when the feature is held.
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible()
    await expect(page.getByText('You do not have permission to edit this document.')).toHaveCount(0)
  })

  test('a user without sales.orders.manage is offered none of them', async ({ page }) => {
    await loginWithCredentials(page, viewerEmail, password)
    await openOrder(page, orderId!)

    // Absent, not disabled: FormHeader renders the button as `{onDelete ? … }`.
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)

    // The lock reports a permission denial rather than the editable-status policy.
    await expect(page.getByText('You do not have permission to edit this document.').first()).toBeVisible()
    await expect(page.getByText('Addresses cannot be changed for the current status.')).toHaveCount(0)
  })
})
