import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createDictionaryFixture } from '@open-mercato/core/helpers/integration/dictionariesFixtures'
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
  OPTIMISTIC_LOCK_HEADER,
  readClaim,
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  submitClaim,
  transitionClaim,
  uniqueLabel,
  type WarrantyClaimSettingsResult,
} from './helpers'

type PortalDetail = {
  item: {
    claimNumber: string
    rejectionReasonCode: string
    rejectionReasonLabel: string | null
    resolutionSummary: string | null
  }
}

test.describe('TC-WC-8502: portal rejection reason dictionary labels', () => {
  let staff: APIRequestContext
  let adminToken: string | null = null
  let settingsBefore: WarrantyClaimSettingsResult | null = null
  let roleId: string | null = null
  const companyIds: string[] = []
  const userIds: string[] = []
  const sessions: PortalSession[] = []
  let claimId: string | null = null
  let claimNumber: string | null = null
  let orgSlug: string | null = null
  let dictionaryId: string | null = null
  let ownsDictionary = false
  let entryId: string | null = null
  let entryUpdatedAt: string | null = null
  const stamp = uniqueLabel('wc-8502')
  const code = `policy-${stamp}`
  const label = `Tenant service policy exclusion ${stamp}`
  const summary = 'Contact support to appeal.'
  const rejectedMessage = 'This claim was rejected. Customer-visible updates remain available in the timeline.'

  async function deleteEntry() {
    if (!entryId || !adminToken) return
    const response = await apiRequest(staff, 'DELETE', `/api/dictionaries/${dictionaryId}/entries/${entryId}`, {
      token: adminToken,
      headers: { [OPTIMISTIC_LOCK_HEADER]: entryUpdatedAt! },
    })
    expect(response.status(), 'the owned rejection entry should be deleted').toBe(200)
    entryId = null
  }

  test.beforeAll(async ({ playwright }, testInfo) => {
    staff = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL })
    adminToken = await getAuthToken(staff, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    settingsBefore = await readWarrantyClaimSettings(staff, adminToken)
    await saveWarrantyClaimSettings(staff, adminToken, { autoApproveEnabled: false }, settingsBefore.updatedAt)
    const organization = await apiRequest(staff, 'GET', `/api/directory/organizations?view=manage&ids=${organizationId}&tenantId=${tenantId}`, { token: adminToken })
    expect(organization.status()).toBe(200)
    orgSlug = (await readJsonSafe<{ items: Array<{ slug: string }> }>(organization))?.items[0]?.slug ?? null
    expect(orgSlug).toBeTruthy()

    const dictionaries = await apiRequest(staff, 'GET', '/api/dictionaries', { token: adminToken })
    expect(dictionaries.status()).toBe(200)
    const dictionaryKey = 'warranty_claims.warranty_claim_rejection_reason'
    dictionaryId = (await readJsonSafe<{ items: Array<{ id: string; key: string; organizationId: string }> }>(dictionaries))?.items.find(
      (item) => item.key === dictionaryKey && item.organizationId === organizationId,
    )?.id ?? null
    if (!dictionaryId) {
      dictionaryId = await createDictionaryFixture(staff, adminToken, { key: dictionaryKey, name: `QA rejection reasons ${stamp}` })
      ownsDictionary = true
    }
    const createdEntry = await apiRequest(staff, 'POST', `/api/dictionaries/${dictionaryId}/entries`, { token: adminToken, data: { value: code, label } })
    expect(createdEntry.status()).toBe(201)
    const entry = await readJsonSafe<{ id: string; updatedAt: string }>(createdEntry)
    entryId = entry?.id ?? null
    entryUpdatedAt = entry?.updatedAt ?? null
    expect(entryId).toBeTruthy()
    expect(entryUpdatedAt).toBeTruthy()

    roleId = (await createCustomerRoleFixture(staff, adminToken, { features: ['portal.account.manage'] })).id
    for (const owner of ['A', 'B']) {
      const companyId = await createCustomerCompanyFixture(staff, adminToken, `QA Rejection ${owner} ${stamp}`)
      companyIds.push(companyId)
      const user = await createCustomerUserFixture(staff, adminToken, { customerEntityId: companyId, roleIds: [roleId] })
      userIds.push(user.id)
      sessions.push(await portalLogin(staff, { email: user.email, password: user.password, tenantId }))
    }
    let claim = await createClaimFixture(staff, adminToken, {
      claimType: 'warranty', customerId: companyIds[0], reasonCode: `intake-${stamp}`, resolutionSummary: summary,
      lines: [{ lineNo: 1, sku: stamp, productName: `Owned rejection test part ${stamp}`, qtyClaimed: 1 }],
    })
    claimId = claim.id
    claimNumber = claim.claimNumber
    expect(claimId).toBeTruthy()
    expect(claimNumber).toBeTruthy()
    expect((await submitClaim(staff, adminToken, claimId!, claim.updatedAt)).status()).toBe(200)
    claim = await readClaim(staff, adminToken, claimId!)
    expect((await transitionClaim(staff, adminToken, { id: claimId!, toStatus: 'in_review' }, claim.updatedAt)).status()).toBe(200)
    claim = await readClaim(staff, adminToken, claimId!)
    expect((await transitionClaim(staff, adminToken, { id: claimId!, toStatus: 'rejected', rejectionReasonCode: code }, claim.updatedAt)).status()).toBe(200)
  })

  test.afterAll(async () => {
    if (!staff) return
    try {
      if (claimId && adminToken) {
        const claim = await readClaim(staff, adminToken, claimId)
        if (claim.status === 'rejected') expect((await transitionClaim(staff, adminToken, { id: claimId, toStatus: 'in_review' }, claim.updatedAt)).status()).toBe(200)
      }
      await cancelThenDeleteClaimIfPossible(staff, adminToken, claimId)
    } finally {
      try {
        for (const userId of userIds) await deleteCustomerUserFixture(staff, adminToken, userId)
        await deleteCustomerRoleFixture(staff, adminToken, roleId)
        for (const companyId of companyIds) await deleteCustomerCompanyFixture(staff, adminToken, companyId)
        await deleteEntry()
        if (ownsDictionary && adminToken) {
          const dictionary = await apiRequest(staff, 'GET', `/api/dictionaries/${dictionaryId}`, { token: adminToken })
          const record = await readJsonSafe<{ updatedAt: string }>(dictionary)
          expect((await apiRequest(staff, 'DELETE', `/api/dictionaries/${dictionaryId}`, {
            token: adminToken, headers: { [OPTIMISTIC_LOCK_HEADER]: record!.updatedAt },
          })).status()).toBe(200)
        }
        await restoreWarrantyClaimSettings(staff, adminToken, settingsBefore)
      } finally {
        await staff.dispose()
      }
    }
  })

  test('shows scoped tenant labels, preserves fallbacks, and denies a different customer', async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!
    const owner = await browser.newContext({ baseURL, locale: 'en-US' })
    const otherCustomer = await browser.newContext({ baseURL, locale: 'en-US' })
    const detailPath = `/api/warranty_claims/portal/claims/${claimId}`
    const trackerPath = `/${orgSlug}/portal/claims/${claimId}`
    try {
      for (const [context, session] of [[owner, sessions[0]], [otherCustomer, sessions[1]]] as const) {
        await context.addCookies([
          { name: 'customer_auth_token', value: session.authToken, url: baseURL, sameSite: 'Lax' },
          { name: 'customer_session_token', value: session.sessionToken, url: baseURL, sameSite: 'Lax' },
          { name: 'locale', value: 'en', url: baseURL, sameSite: 'Lax' },
        ])
      }
      const detail = await owner.request.get(detailPath)
      expect(detail.status()).toBe(200)
      expect((await readJsonSafe<PortalDetail>(detail))?.item).toMatchObject({ rejectionReasonCode: code, rejectionReasonLabel: label, resolutionSummary: summary })
      const page = await owner.newPage()
      const requests: string[] = []
      page.on('request', (request) => requests.push(new URL(request.url()).pathname))
      await page.goto(trackerPath, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(`${rejectedMessage} ${label} ${summary}`, { exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('tenant-label-desktop.png'), fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(page.getByText(`${rejectedMessage} ${label} ${summary}`, { exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('tenant-label-mobile.png'), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(requests.some((path) => path.startsWith('/api/dictionaries'))).toBe(false)

      const denied = await otherCustomer.request.get(`${detailPath}?customerId=${companyIds[0]}`)
      expect(denied.status()).toBe(404)
      const deniedBody = await denied.text()
      expect(deniedBody).not.toContain(code)
      expect(deniedBody).not.toContain(label)
      expect(deniedBody).not.toContain(claimNumber)
      const deniedPage = await otherCustomer.newPage()
      await deniedPage.goto(trackerPath, { waitUntil: 'domcontentloaded' })
      await expect(deniedPage.getByText('Claim not found', { exact: true })).toBeVisible()
      await expect(deniedPage.getByText(claimNumber!, { exact: true })).toHaveCount(0)
      await deniedPage.screenshot({ path: testInfo.outputPath('different-customer-denied.png'), fullPage: true })

      await page.route(`**${detailPath}`, async (route) => {
        const response = await route.fetch()
        const body = await response.json() as PortalDetail
        await route.fulfill({ response, json: { ...body, item: { ...body.item, rejectionReasonCode: 'out-of-warranty', rejectionReasonLabel: label } } })
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByText(`${rejectedMessage} Out of warranty ${summary}`, { exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('seeded-i18n-precedence.png'), fullPage: true })
      await page.unroute(`**${detailPath}`)

      await page.route(`**${detailPath}`, async (route) => {
        const response = await route.fetch()
        const body = await response.json() as PortalDetail
        await route.fulfill({ response, json: { ...body, item: { ...body.item, rejectionReasonLabel: null } } })
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByText(`${rejectedMessage} ${code} ${summary}`, { exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('lookup-unavailable-fallback.png'), fullPage: true })
      await page.unroute(`**${detailPath}`)

      await deleteEntry()
      const unknown = await owner.request.get(detailPath)
      expect(unknown.status()).toBe(200)
      expect((await readJsonSafe<PortalDetail>(unknown))?.item).toMatchObject({ rejectionReasonCode: code, rejectionReasonLabel: null })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByText(`${rejectedMessage} ${code} ${summary}`, { exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('unknown-code-fallback.png'), fullPage: true })
    } finally {
      await owner.close()
      await otherCustomer.close()
    }
  })
})
