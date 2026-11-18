import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalLogin,
  type PortalSession,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  postClaimEvent,
  readClaim,
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  submitClaim,
  transitionClaim,
  uniqueLabel,
  type WarrantyClaimSettingsResult,
} from './helpers'

test.describe('TC-WC-038: portal claim tracker receives staff updates', () => {
  let staff: APIRequestContext
  let adminToken: string | null = null
  let companyId: string | null = null
  let roleId: string | null = null
  let customerUserId: string | null = null
  let claimId: string | null = null
  let claimNumber: string | null = null
  let orgSlug: string | null = null
  let portalSession: PortalSession | null = null
  let settingsBefore: WarrantyClaimSettingsResult | null = null
  const stamp = uniqueLabel('tc-wc-038')

  test.beforeAll(async ({ playwright }, testInfo) => {
    staff = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL })
    adminToken = await getAuthToken(staff, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    settingsBefore = await readWarrantyClaimSettings(staff, adminToken)
    await saveWarrantyClaimSettings(staff, adminToken, { autoApproveEnabled: false }, settingsBefore.updatedAt)

    const organization = await apiRequest(
      staff,
      'GET',
      `/api/directory/organizations?view=manage&ids=${encodeURIComponent(organizationId)}&tenantId=${encodeURIComponent(tenantId)}`,
      { token: adminToken },
    )
    expect(organization.status()).toBe(200)
    orgSlug = (await readJsonSafe<{ items?: Array<{ slug?: string | null }> }>(organization))?.items?.[0]?.slug ?? null
    expect(orgSlug, 'the scoped organization should have a portal slug').toBeTruthy()

    companyId = await createCustomerCompanyFixture(staff, adminToken, `QA WC Realtime ${stamp}`)
    roleId = (await createCustomerRoleFixture(staff, adminToken, { features: ['portal.account.manage'] })).id
    const customer = await createCustomerUserFixture(staff, adminToken, {
      customerEntityId: companyId,
      roleIds: [roleId],
    })
    customerUserId = customer.id
    let claim = await createClaimFixture(staff, adminToken, {
      claimType: 'warranty',
      customerId: companyId,
      reasonCode: 'defective',
      lines: [{ lineNo: 1, sku: `WC-038-${stamp}`, productName: `QA Realtime Part ${stamp}`, qtyClaimed: 1 }],
    })
    claimId = claim.id
    claimNumber = claim.claimNumber
    expect(claimId).toBeTruthy()
    expect(claimNumber).toBeTruthy()
    const submitted = await submitClaim(staff, adminToken, claimId!, claim.updatedAt)
    expect(submitted.status()).toBe(200)
    claim = await readClaim(staff, adminToken, claimId!)
    const review = await transitionClaim(staff, adminToken, { id: claimId!, toStatus: 'in_review' }, claim.updatedAt)
    expect(review.status()).toBe(200)
    portalSession = await portalLogin(staff, { email: customer.email, password: customer.password, tenantId })
  })

  test.afterAll(async () => {
    if (!staff) return
    try {
      await cancelThenDeleteClaimIfPossible(staff, adminToken, claimId)
      await deleteCustomerUserFixture(staff, adminToken, customerUserId)
      await deleteCustomerRoleFixture(staff, adminToken, roleId)
      await deleteCustomerCompanyFixture(staff, adminToken, companyId)
      await restoreWarrantyClaimSettings(staff, adminToken, settingsBefore)
    } finally {
      await staff.dispose()
    }
  })

  test('refreshes replies and status through the real portal bridge while retaining an editable draft', async ({ browser }, testInfo) => {
    const baseUrl = testInfo.project.use.baseURL
    expect(baseUrl, 'the native integration runner should configure the application URL').toBeTruthy()
    const portal = await browser.newContext({ baseURL: baseUrl, locale: 'en-US' })
    try {
      await portal.addCookies([
        { name: 'customer_auth_token', value: portalSession!.authToken, url: baseUrl!, sameSite: 'Lax' },
        { name: 'customer_session_token', value: portalSession!.sessionToken, url: baseUrl!, sameSite: 'Lax' },
        { name: 'locale', value: 'en', url: baseUrl!, sameSite: 'Lax' },
      ])
      const page = await portal.newPage()
      const streamConnected = page.waitForResponse((response) => (
        response.url().includes('/api/customer_accounts/portal/events/stream') && response.status() === 200
      ))
      await page.goto(`/${orgSlug}/portal/claims/${claimId}`, { waitUntil: 'domcontentloaded' })
      await streamConnected
      await expect(page.getByText(claimNumber!, { exact: true })).toBeVisible()
      const draft = page.getByPlaceholder('Write a message to our support team…')
      const draftText = `I am collecting the requested photos ${stamp}`
      await draft.fill(draftText)
      await draft.focus()
      let navigations = 0
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) navigations += 1
      })

      const internalBody = `Private staff note ${stamp}`
      const internal = await postClaimEvent(staff, adminToken!, { claimId: claimId!, body: internalBody, visibility: 'internal' })
      expect(internal.status()).toBe(200)
      const replyBody = `Please include a photo of the damaged part ${stamp}`
      const reply = await postClaimEvent(staff, adminToken!, { claimId: claimId!, body: replyBody, visibility: 'customer' })
      expect(reply.status()).toBe(200)
      await expect(page.getByText(replyBody, { exact: true })).toBeVisible()
      await expect(draft).toHaveValue(draftText)

      const current = await readClaim(staff, adminToken!, claimId!)
      const changed = await transitionClaim(staff, adminToken!, { id: claimId!, toStatus: 'info_requested' }, current.updatedAt)
      expect(changed.status()).toBe(200)
      await expect(page.getByText('We need more information from you. Please reply in the message box below.', { exact: true })).toBeVisible()
      await expect(page.getByText('Status changed from In review to Info requested.', { exact: true })).toBeVisible()
      await expect(page.getByText(internalBody, { exact: true })).toHaveCount(0)
      await expect(draft).toHaveValue(draftText)
      await expect(draft).toBeFocused()
      await draft.fill(`${draftText}. I will send them shortly.`)
      await expect(draft).toHaveValue(`${draftText}. I will send them shortly.`)
      expect(navigations, 'incoming staff updates should not reload or navigate the tracker').toBe(0)
    } finally {
      await portal.close()
    }
  })
})
