import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test'
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
  createSalesQuoteFixture,
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

async function openDocument(page: Page, path: string): Promise<void> {
  // Every affordance here starts locked and only opens once the feature check answers, so an
  // assertion made before that resolves would pass for any user, including one whose request
  // never completed. Await the response itself rather than a rendered proxy for it.
  const answered = page.waitForResponse(
    (res) => res.url().includes('/api/auth/feature-check'),
    { timeout: 30_000 },
  )
  await page.goto(path, { waitUntil: 'commit' })
  await answered
  // The permission banner lives inside the addresses section, which is only mounted while that
  // tab is active; `items` is the default.
  await page.getByRole('button', { name: 'Addresses' }).click()
  await expect(addressesSectionHeading(page)).toBeVisible({ timeout: 30_000 })
}

// `getByText` matches by substring, so a bare 'Shipping address' also catches the
// "Billing will mirror the shipping address…" caption and trips strict mode.
function addressesSectionHeading(page: Page) {
  return page.getByText('Shipping address', { exact: true })
}

// TagsSection drops `role="button"` from its container when editing is denied, which is the
// thing under test; locating on the role is therefore the assertion, not an implementation detail.
function tagsEditTarget(page: Page) {
  return page.getByText('Tags', { exact: true }).locator('xpath=following::*[@role="button"][1]')
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
  let quoteManagerRoleId: string | null = null
  let quoteManagerUserId: string | null = null
  let quoteId: string | null = null

  const stamp = Date.now()
  const managerEmail = `tc-sales-042-manager-${stamp}@example.com`
  const viewerEmail = `tc-sales-042-viewer-${stamp}@example.com`
  const quoteManagerEmail = `tc-sales-042-quotes-${stamp}@example.com`
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

    quoteId = await createSalesQuoteFixture(request, token)
    quoteManagerRoleId = await createRoleFixture(request, token, { name: `tc-sales-042-quotes-${stamp}` })
    await setRoleAclFeatures(request, token, {
      roleId: quoteManagerRoleId,
      features: ['sales.orders.view', 'sales.quotes.view', 'sales.quotes.manage'],
    })
    quoteManagerUserId = await createUserFixture(request, token, {
      email: quoteManagerEmail, password, organizationId, roles: [quoteManagerRoleId], name: 'TC-SALES-042 quotes manager',
    })
  })

  test.afterAll(async () => {
    await deleteUserIfExists(request, token, quoteManagerUserId)
    await deleteRoleIfExists(request, token, quoteManagerRoleId)
    await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    await deleteUserIfExists(request, token, viewerUserId)
    await deleteUserIfExists(request, token, managerUserId)
    await deleteRoleIfExists(request, token, viewerRoleId)
    await deleteRoleIfExists(request, token, managerRoleId)
    await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    await request.dispose()
  })

  test('a user holding sales.orders.manage is offered the edits', async ({ page }) => {
    await loginWithCredentials(page, managerEmail, password)
    await openDocument(page, `/backend/sales/orders/${encodeURIComponent(orderId!)}`)

    // Control for the assertions below: these exist and are reachable when the feature is held,
    // so their absence in the viewer case is a decision rather than a rendering failure.
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible()
    await expect(page.getByText(/You do not have permission to change/)).toHaveCount(0)
    // Counterparts to the viewer's absences: without these the zeros below prove nothing.
    await expect(page.getByRole('button', { name: /Edit customer snapshot|Select customer/ })).toHaveCount(2)
    await expect(tagsEditTarget(page)).toHaveCount(1)
  })

  test('a user without sales.orders.manage is offered none of them', async ({ page }) => {
    await loginWithCredentials(page, viewerEmail, password)
    await openDocument(page, `/backend/sales/orders/${encodeURIComponent(orderId!)}`)

    // Absent, not disabled: FormHeader renders the button as `{onDelete ? … }`.
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)

    // The denial is worded for what is actually locked, and is not the status policy's message.
    await expect(page.getByText("You do not have permission to change this document's addresses.")).toBeVisible()
    await expect(page.getByText('Addresses cannot be changed for the current status.')).toHaveCount(0)

    // The two affordances that used to render and merely fail on click. Both are asserted as
    // present in the manager test, so a zero here is a decision rather than an empty page.
    await expect(page.getByRole('button', { name: /Edit customer snapshot|Select customer/ })).toHaveCount(0)
    await expect(tagsEditTarget(page)).toHaveCount(0)
  })

  test('a quotes manager is not locked out of a quote by the orders feature', async ({ page }) => {
    // `canManage` branches on the document kind; requesting both features in one call exists
    // precisely so the quote answer is right, and nothing else exercises that branch.
    await loginWithCredentials(page, quoteManagerEmail, password)
    await openDocument(page, `/backend/sales/quotes/${encodeURIComponent(quoteId!)}`)

    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible()
    await expect(page.getByText(/You do not have permission to change/)).toHaveCount(0)
  })

  // Failing closed on the affordances is right; telling a user they lack a permission nobody
  // managed to check is not. The two transports fail differently and only one of them used to
  // reach the unresolved state: `apiCall` rejects on an aborted fetch, but RESOLVES a non-2xx,
  // so an expired session or a 500 arrived on the success path with an empty `granted` list.
  for (const { label, handle } of [
    { label: 'never answers', handle: (route: Route) => route.abort() },
    {
      label: 'answers with an HTTP error',
      handle: (route: Route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    },
  ]) {
    test(`a permission check that ${label} locks the affordances without asserting a reason`, async ({ page }) => {
      await loginWithCredentials(page, managerEmail, password)
      await page.route('**/api/auth/feature-check', handle)
      await page.goto(`/backend/sales/orders/${encodeURIComponent(orderId!)}`, { waitUntil: 'commit' })
      await page.getByRole('button', { name: 'Addresses' }).click()
      // Prove the page rendered before asserting on absences.
      await expect(addressesSectionHeading(page)).toBeVisible({ timeout: 30_000 })

      await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
      await expect(page.getByText(/You do not have permission to change/)).toHaveCount(0)
    })
  }
})
