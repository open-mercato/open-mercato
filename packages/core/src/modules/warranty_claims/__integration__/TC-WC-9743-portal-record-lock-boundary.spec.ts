import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page, type Request } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { cancelThenDeleteClaimIfPossible, uniqueLabel } from './helpers'

export const integrationMeta = {
  description: 'Feature-gated injected widgets (enterprise record locks) stay out of the customer portal (#9743)',
  dependsOnModules: ['warranty_claims', 'customer_accounts', 'sales', 'customers', 'record_locks'],
}

/**
 * TC-WC-9743: feature-gated injected widgets are excluded outside backend chrome.
 *
 * The enterprise record-locking widget is registered on shared injection spots and gated by
 * the staff-only `record_locks.view` feature. Before #9743 that gating failed open outside
 * `BackendChromeProvider`, so the portal claim comment mutation ran the widget's
 * `onBeforeSave`, hit the staff-only `/api/record_locks/validate` route with a customer
 * session and aborted the comment before it was sent. This spec drives the real browser flow:
 *
 * - a portal-only buyer posts a claim comment: the event POST succeeds, the comment renders,
 *   and no `/api/record_locks/*` request is ever sent;
 * - control: a staff user granted `record_locks.view` still gets the widget (it acquires a
 *   lock when opening a company);
 * - control: a staff user without `record_locks.view` never triggers the widget.
 *
 * Self-contained: creates its own customer account, order, claim, staff role/user and company;
 * restores record-lock settings and deletes every fixture in `finally`.
 */

type RecordLockSettings = Record<string, unknown>

const RECORD_LOCKS_API_PREFIX = '/api/record_locks/'

async function readRecordLockSettings(request: APIRequestContext, token: string): Promise<RecordLockSettings> {
  const response = await apiRequest(request, 'GET', '/api/record_locks/settings', { token })
  expect(response.ok(), 'GET /api/record_locks/settings should succeed').toBeTruthy()
  const body = await readJsonSafe<{ settings?: RecordLockSettings }>(response)
  return body?.settings ?? {}
}

async function writeRecordLockSettings(request: APIRequestContext, token: string, settings: RecordLockSettings) {
  const response = await apiRequest(request, 'POST', '/api/record_locks/settings', { token, data: settings })
  expect(response.ok(), 'POST /api/record_locks/settings should succeed').toBeTruthy()
}

function trackRecordLockRequests(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (rawRequest: Request) => {
    const pathname = new URL(rawRequest.url()).pathname
    if (pathname.startsWith(RECORD_LOCKS_API_PREFIX)) seen.push(`${rawRequest.method()} ${pathname}`)
  })
  return seen
}

async function openStaffContext(browser: Browser, baseURL: string, token: string): Promise<BrowserContext> {
  const { tenantId, organizationId } = getTokenContext(token)
  const context = await browser.newContext({ baseURL, locale: 'en-US' })
  await context.addCookies([
    { name: 'auth_token', value: token, url: baseURL, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: tenantId, url: baseURL, sameSite: 'Lax' },
    { name: 'om_selected_org', value: organizationId, url: baseURL, sameSite: 'Lax' },
    { name: 'om_demo_notice_ack', value: 'ack', url: baseURL, sameSite: 'Lax' },
    { name: 'locale', value: 'en', url: baseURL, sameSite: 'Lax' },
  ])
  return context
}

async function runCleanup(steps: Array<() => Promise<unknown>>): Promise<void> {
  const errors: unknown[] = []
  for (const step of steps) {
    try {
      await step()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) throw errors[0]
}

test.describe('TC-WC-9743: feature-gated injected widgets are excluded outside backend chrome', () => {
  test.describe.configure({ timeout: 180_000 })

  test('portal-only buyer posts a claim comment without dispatching the staff record-locking widget', async ({ browser, request }, testInfo) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-9743')
    const commentBody = `QA TC-WC-9743 comment ${stamp}`

    let previousSettings: RecordLockSettings | null = null
    let customerRoleId: string | null = null
    let customerCompanyId: string | null = null
    let customerUserId: string | null = null
    let orderId: string | null = null
    let claimId: string | null = null
    let context: BrowserContext | null = null

    try {
      previousSettings = await readRecordLockSettings(request, superadminToken)
      await writeRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['warranty_claims.claim_event', 'warranty_claims.claim'],
      })

      const organization = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?view=manage&ids=${organizationId}&tenantId=${tenantId}`,
        { token: adminToken },
      )
      expect(organization.status()).toBe(200)
      const orgSlug = (await readJsonSafe<{ items?: Array<{ slug?: string }> }>(organization))?.items?.[0]?.slug ?? null
      expect(orgSlug, 'org slug should resolve for portal navigation').toBeTruthy()

      customerRoleId = (await createCustomerRoleFixture(request, adminToken, { features: ['portal.account.manage'] })).id
      customerCompanyId = await createCustomerCompanyFixture(request, adminToken, `QA TC-WC-9743 ${stamp}`)
      const customerUser = await createCustomerUserFixture(request, adminToken, {
        roleIds: [customerRoleId],
        customerEntityId: customerCompanyId,
        displayName: `QA TC-WC-9743 Buyer ${stamp}`,
      })
      customerUserId = customerUser.id
      const session = await portalLogin(request, { email: customerUser.email, password: customerUser.password, tenantId })

      const orderCreate = await apiRequest(request, 'POST', '/api/sales/orders', {
        token: adminToken,
        data: {
          currencyCode: 'USD',
          lines: [{ currencyCode: 'USD', quantity: 1, name: `QA TC-WC-9743 line ${stamp}`, unitPriceNet: 0, unitPriceGross: 0 }],
          customerEntityId: customerCompanyId,
          customerReference: `WC-9743-${stamp}`,
        },
      })
      expect(orderCreate.status(), 'sales order fixture should be created').toBe(201)
      orderId = (await readJsonSafe<{ id?: string }>(orderCreate))?.id ?? null
      expect(orderId).toBeTruthy()

      const createClaim = await request.post('/api/warranty_claims/portal/claims', {
        headers: portalCookieHeaders(session, { 'Content-Type': 'application/json' }),
        data: {
          orderId,
          reasonCode: 'damaged',
          lines: [
            {
              sku: `WC-9743-${stamp}`,
              serialNumber: `SER-${stamp}`,
              faultDescription: 'Portal record-lock boundary regression',
              qtyClaimed: 1,
            },
          ],
        },
      })
      expect(createClaim.status(), 'portal claim intake should return 201').toBe(201)
      claimId = (await readJsonSafe<{ claimId?: string }>(createClaim))?.claimId ?? null
      expect(claimId).toBeTruthy()

      const baseURL = testInfo.project.use.baseURL!
      context = await browser.newContext({ baseURL, locale: 'en-US' })
      await context.addCookies([
        { name: 'customer_auth_token', value: session.authToken, url: baseURL, sameSite: 'Lax' },
        { name: 'customer_session_token', value: session.sessionToken, url: baseURL, sameSite: 'Lax' },
        { name: 'locale', value: 'en', url: baseURL, sameSite: 'Lax' },
      ])
      const page = await context.newPage()
      const recordLockRequests = trackRecordLockRequests(page)

      await page.goto(`/${orgSlug}/portal/claims/${claimId}`, { waitUntil: 'domcontentloaded' })
      const commentBox = page.locator('#warranty-claim-comment-box')
      const textarea = commentBox.getByPlaceholder('Write a message to our support team…')
      await expect(textarea).toBeVisible({ timeout: 30_000 })
      await textarea.fill(commentBody)

      const eventPosted = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/warranty_claims/portal/events'
          && response.request().method() === 'POST',
        { timeout: 20_000 },
      )
      await commentBox.getByRole('button', { name: 'Send' }).click()
      const eventResponse = await eventPosted
      expect(eventResponse.ok(), 'portal comment POST should succeed').toBe(true)

      await expect(page.getByText('Comment posted.')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(commentBody)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Claim update blocked by validation.')).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath('portal-comment-posted.png'), fullPage: true })

      expect(recordLockRequests, 'portal must never call the staff-only record_locks API').toEqual([])

      const events = await request.get(`/api/warranty_claims/portal/events?claimId=${claimId}`, {
        headers: portalCookieHeaders(session),
      })
      expect(events.status()).toBe(200)
      expect(JSON.stringify(await readJsonSafe<unknown>(events))).toContain(commentBody)
    } finally {
      await runCleanup([
        async () => { await context?.close() },
        () => cancelThenDeleteClaimIfPossible(request, adminToken, claimId),
        () => deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId),
        () => deleteCustomerUserFixture(request, adminToken, customerUserId),
        () => deleteCustomerRoleFixture(request, adminToken, customerRoleId),
        () => deleteCustomerCompanyFixture(request, adminToken, customerCompanyId),
        async () => {
          if (previousSettings) await writeRecordLockSettings(request, superadminToken, previousSettings)
        },
      ])
    }
  })

  test('staff controls: record_locks.view still dispatches the widget, a staff user without it does not', async ({ browser, request }, testInfo) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-9743')
    const companyName = `QA TC-WC-9743 Company ${stamp}`
    const restrictedEmail = `qa-wc-9743-${stamp}@example.com`
    const restrictedPassword = `Secret-${stamp}!`
    const baseURL = testInfo.project.use.baseURL!

    let previousSettings: RecordLockSettings | null = null
    let companyId: string | null = null
    let staffRoleId: string | null = null
    let staffUserId: string | null = null
    const contexts: BrowserContext[] = []

    try {
      previousSettings = await readRecordLockSettings(request, superadminToken)
      await writeRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.company'],
      })

      companyId = await createCompanyFixture(request, adminToken, companyName)
      const companyPath = `/backend/customers/companies/${encodeURIComponent(companyId)}`

      staffRoleId = await createRoleFixture(request, adminToken, { name: `QA TC-WC-9743 ${stamp}`, tenantId })
      await setRoleAclFeatures(request, adminToken, { roleId: staffRoleId, features: ['customers.*'], organizations: null })
      staffUserId = await createUserFixture(request, adminToken, {
        email: restrictedEmail,
        password: restrictedPassword,
        organizationId,
        roles: [staffRoleId],
      })
      const restrictedToken = await getAuthToken(request, restrictedEmail, restrictedPassword)

      const permittedContext = await openStaffContext(browser, baseURL, adminToken)
      contexts.push(permittedContext)
      const permittedPage = await permittedContext.newPage()
      const permittedRequests = trackRecordLockRequests(permittedPage)
      const acquired = permittedPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/record_locks/acquire'
          && response.request().method() === 'POST',
        { timeout: 30_000 },
      )
      await permittedPage.goto(companyPath, { waitUntil: 'domcontentloaded' })
      const acquireResponse = await acquired
      expect(acquireResponse.ok(), 'permitted staff should acquire a record lock via the injected widget').toBe(true)
      expect(permittedRequests).toContain('POST /api/record_locks/acquire')
      await expect(permittedPage.getByText(companyName).first()).toBeVisible({ timeout: 30_000 })

      const restrictedContext = await openStaffContext(browser, baseURL, restrictedToken)
      contexts.push(restrictedContext)
      const restrictedPage = await restrictedContext.newPage()
      const restrictedRequests = trackRecordLockRequests(restrictedPage)
      await restrictedPage.goto(companyPath, { waitUntil: 'domcontentloaded' })
      await expect(restrictedPage.getByText(companyName).first()).toBeVisible({ timeout: 30_000 })
      await restrictedPage.waitForTimeout(3_000)
      await restrictedPage.screenshot({ path: testInfo.outputPath('restricted-staff-company.png'), fullPage: true })
      expect(restrictedRequests, 'staff without record_locks.view must not dispatch the record-locking widget').toEqual([])
    } finally {
      await runCleanup([
        async () => { for (const context of contexts) await context.close() },
        () => deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId),
        () => deleteUserIfExists(request, adminToken, staffUserId),
        () => deleteRoleIfExists(request, adminToken, staffRoleId),
        async () => {
          if (previousSettings) await writeRecordLockSettings(request, superadminToken, previousSettings)
        },
      ])
    }
  })
})
