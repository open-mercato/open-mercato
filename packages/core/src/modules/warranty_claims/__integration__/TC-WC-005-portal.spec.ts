import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import { getTokenContext, getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createOrderLineFixture, deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { createDictionaryFixture } from '@open-mercato/core/modules/core/__integration__/helpers/dictionariesFixtures'
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
import {
  assignClaim,
  cancelThenDeleteClaimIfPossible,
  listClaimLines,
  OPTIMISTIC_LOCK_HEADER,
  postClaimEvent,
  readClaim,
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  transitionClaim,
  uniqueLabel,
} from './helpers'

type PortalClaim = {
  id: string
  status: string
  claimType: string
  orderId: string | null
  lines?: unknown
}

type PortalClaimDetail = {
  item?: PortalClaim & {
    channel?: string
    customerId?: string | null
  }
}

type PortalList = {
  items?: PortalClaim[]
}

type PortalEvents = {
  items?: Array<{ body?: string | null; visibility?: string }>
}

type PortalOptions = {
  ok?: boolean
  result?: {
    reasons?: Array<{ value?: string; label?: string }>
    faultCodes?: Array<{ value?: string; label?: string }>
  }
}

test.describe('TC-WC-005: warranty claims customer portal API', () => {
  test('requires a portal session, scopes claims by customer, validates order ownership, and filters timeline/attachments', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-005')
    const settingsBefore = await readWarrantyClaimSettings(request, adminToken)

    let roleId: string | null = null
    let companyAId: string | null = null
    let companyBId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null
    let orderAId: string | null = null
    let orderALineId: string | null = null
    let orderBId: string | null = null
    let claimId: string | null = null
    let attachmentId: string | null = null

    try {
      await saveWarrantyClaimSettings(request, adminToken, {
        slaPauseOnInfoRequested: true,
        autoApproveEnabled: false,
        autoApproveMaxAmount: null,
        autoApproveCurrencyCode: null,
        autoApproveRequireInWarranty: true,
      }, settingsBefore.updatedAt)

      const anonymousClaims = await request.get('/api/warranty_claims/portal/claims', { headers: { Cookie: '' } })
      expect(anonymousClaims.status(), 'portal claims list should require customer auth').toBe(401)

      const anonymousOptions = await request.get('/api/warranty_claims/portal/options', { headers: { Cookie: '' } })
      expect(anonymousOptions.status(), 'portal options should require customer auth').toBe(401)

      roleId = (await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.account.manage'],
      })).id
      companyAId = await createCustomerCompanyFixture(request, adminToken, `QA WC Portal A ${stamp}`)
      companyBId = await createCustomerCompanyFixture(request, adminToken, `QA WC Portal B ${stamp}`)
      const userA = await createCustomerUserFixture(request, adminToken, {
        roleIds: [roleId],
        customerEntityId: companyAId,
        displayName: `QA WC Portal User A ${stamp}`,
      })
      userAId = userA.id
      const userB = await createCustomerUserFixture(request, adminToken, {
        roleIds: [roleId],
        customerEntityId: companyBId,
        displayName: `QA WC Portal User B ${stamp}`,
      })
      userBId = userB.id

      const sessionA = await portalLogin(request, {
        email: userA.email,
        password: userA.password,
        tenantId,
      })
      const sessionB = await portalLogin(request, {
        email: userB.email,
        password: userB.password,
        tenantId,
      })

      const optionsA = await request.get('/api/warranty_claims/portal/options', {
        headers: portalCookieHeaders(sessionA),
      })
      expect(optionsA.status(), 'customer A should read portal warranty options').toBe(200)
      const optionsBody = await readJsonSafe<PortalOptions>(optionsA)
      const reasons = optionsBody?.result?.reasons ?? []
      const faultCodes = optionsBody?.result?.faultCodes ?? []
      expect(reasons.length, 'portal reasons should include seeded dictionary entries').toBeGreaterThan(0)
      expect(faultCodes.length, 'portal fault codes should include seeded dictionary entries').toBeGreaterThan(0)
      for (const option of [...reasons, ...faultCodes]) {
        expect(typeof option.value, 'portal option value should be a string').toBe('string')
        expect(typeof option.label, 'portal option label should be a string').toBe('string')
      }

      const orderBCreate = await apiRequest(request, 'POST', '/api/sales/orders', {
        token: adminToken,
        data: {
          currencyCode: 'USD',
          // A sales order must contain at least one line (#4021); this zero-priced
          // placeholder keeps the fixture valid without moving any total.
          lines: [{ currencyCode: 'USD', quantity: 1, name: `QA seed line ${Date.now()}`, unitPriceNet: 0, unitPriceGross: 0 }],
          customerEntityId: companyBId,
          customerReference: `WC-PORTAL-ORDER-B-${stamp}`,
        },
      })
      expect(orderBCreate.status(), 'sales order fixture for customer B should be created').toBe(201)
      orderBId = (await readJsonSafe<{ id?: string }>(orderBCreate))?.id ?? null
      expect(orderBId, 'sales order fixture should return id').toBeTruthy()

      const orderANumber = `WC-PORTAL-ORDER-A-${stamp}`
      const lineProductName = `QA WC Portal Product ${stamp}`
      const orderACreate = await apiRequest(request, 'POST', '/api/sales/orders', {
        token: adminToken,
        data: {
          currencyCode: 'USD',
          // A sales order must contain at least one line (#4021); this zero-priced
          // placeholder keeps the fixture valid without moving any total.
          lines: [{ currencyCode: 'USD', quantity: 1, name: `QA seed line ${Date.now()}`, unitPriceNet: 0, unitPriceGross: 0 }],
          customerEntityId: companyAId,
          customerReference: orderANumber,
          orderNumber: orderANumber,
          placedAt: new Date().toISOString(),
        },
      })
      expect(orderACreate.status(), 'sales order fixture for customer A should be created').toBe(201)
      orderAId = (await readJsonSafe<{ id?: string }>(orderACreate))?.id ?? null
      expect(orderAId, 'sales order fixture should return id').toBeTruthy()
      orderALineId = await createOrderLineFixture(request, adminToken, orderAId!, {
        kind: 'product',
        name: lineProductName,
        quantity: 2,
        unitPriceNet: 10,
        unitPriceGross: 12,
        currencyCode: 'USD',
      })

      const crossCustomerOrder = await request.post('/api/warranty_claims/portal/claims', {
        headers: portalCookieHeaders(sessionA, { 'Content-Type': 'application/json' }),
        data: {
          orderId: orderBId,
          reasonCode: 'damaged',
          lines: [
            {
              sku: `WC-005-X-${stamp}`,
              serialNumber: `SER-X-${stamp}`,
              faultDescription: 'Cross-customer order should not be visible',
              qtyClaimed: 1,
            },
          ],
        },
      })
      expect(crossCustomerOrder.status(), 'portal intake with another customer orderId should return 404').toBe(404)

      const createClaim = await request.post('/api/warranty_claims/portal/claims', {
        headers: portalCookieHeaders(sessionA, { 'Content-Type': 'application/json' }),
        data: {
          orderId: orderAId,
          reasonCode: 'damaged',
          notes: `Portal intake notes ${stamp}`,
          lines: [
            {
              orderLineId: orderALineId,
              productName: lineProductName,
              sku: `WC-005-A-${stamp}`,
              serialNumber: `SER-A-${stamp}`,
              faultDescription: 'Portal customer reported failure',
              qtyClaimed: 1,
            },
          ],
        },
      })
      expect(createClaim.status(), 'portal claim intake should return 201').toBe(201)
      claimId = (await readJsonSafe<{ claimId?: string }>(createClaim))?.claimId ?? null
      expect(claimId, 'portal create response should include claimId').toBeTruthy()

      const staffLines = await listClaimLines(request, adminToken, claimId!)
      const pickedLine = staffLines.find((line) => line.orderLineId === orderALineId)
      expect(pickedLine, 'portal picked sales order line should be persisted on a claim line').toBeTruthy()
      expect(pickedLine?.productName, 'portal-supplied productName should persist on the claim line').toBe(lineProductName)

      const detailA = await request.get(`/api/warranty_claims/portal/claims/${claimId}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(detailA.status(), 'customer A should read its own portal claim detail').toBe(200)
      const detailBody = await readJsonSafe<PortalClaimDetail>(detailA)
      expect(detailBody?.item?.status).toBe('submitted')
      expect(detailBody?.item?.channel).toBe('portal')
      expect(detailBody?.item?.customerId).toBe(companyAId)

      let staffClaim = await readClaim(request, adminToken, claimId!)
      let staffTransition = await transitionClaim(
        request,
        adminToken,
        { id: claimId!, toStatus: 'in_review' },
        staffClaim.updatedAt,
      )
      expect(staffTransition.status(), 'staff should move the portal claim to in_review').toBe(200)
      staffClaim = await readClaim(request, adminToken, claimId!)
      const { userId: adminUserId } = getTokenScope(adminToken)
      expect(adminUserId, 'admin token should include a user id').toBeTruthy()
      const assignResponse = await assignClaim(
        request,
        adminToken,
        { id: claimId!, assigneeUserId: adminUserId! },
        staffClaim.updatedAt,
      )
      expect(assignResponse.status(), 'assigning the portal claim to the admin should return 200').toBe(200)
      staffClaim = await readClaim(request, adminToken, claimId!)
      staffTransition = await transitionClaim(
        request,
        adminToken,
        { id: claimId!, toStatus: 'info_requested' },
        staffClaim.updatedAt,
      )
      expect(staffTransition.status(), 'staff should request info on the portal claim').toBe(200)
      staffClaim = await readClaim(request, adminToken, claimId!)
      expect(staffClaim.status).toBe('info_requested')
      expect(staffClaim.slaPausedAt, 'info_requested should pause the SLA when configured').toBeTruthy()

      const listA = await request.get('/api/warranty_claims/portal/claims?pageSize=100', {
        headers: portalCookieHeaders(sessionA),
      })
      expect(listA.status(), 'customer A portal list should return 200').toBe(200)
      const listABody = await readJsonSafe<PortalList>(listA)
      expect(listABody?.items?.some((item) => item.id === claimId)).toBe(true)

      const listB = await request.get('/api/warranty_claims/portal/claims?pageSize=100', {
        headers: portalCookieHeaders(sessionB),
      })
      expect(listB.status(), 'customer B portal list should return 200').toBe(200)
      const listBBody = await readJsonSafe<PortalList>(listB)
      expect(listBBody?.items?.some((item) => item.id === claimId)).toBe(false)

      const detailB = await request.get(`/api/warranty_claims/portal/claims/${claimId}`, {
        headers: portalCookieHeaders(sessionB),
      })
      expect(detailB.status(), 'customer B should receive 404 for customer A claim detail').toBe(404)

      const customerComment = `Customer visible comment ${stamp}`
      const portalComment = await request.post('/api/warranty_claims/portal/events', {
        headers: portalCookieHeaders(sessionA, { 'Content-Type': 'application/json' }),
        data: { claimId: claimId!, body: customerComment },
      })
      expect(portalComment.status(), 'portal customer comment should return 200').toBe(200)
      const resumedClaim = await readClaim(request, adminToken, claimId!)
      expect(resumedClaim.status, 'customer reply should move info_requested claim back to in_review').toBe('in_review')
      expect(resumedClaim.slaPausedAt, 'customer reply should clear the SLA pause').toBeNull()
      expect(
        (resumedClaim as { awaitingStaffReply?: boolean }).awaitingStaffReply,
        'customer reply should raise the awaiting-staff-reply flag',
      ).toBe(true)
      const needsAttentionList = await apiRequest(
        request,
        'GET',
        '/api/warranty_claims?needsAttention=true&pageSize=100',
        { token: adminToken },
      )
      const needsAttentionBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(needsAttentionList)
      expect(
        needsAttentionBody?.items?.some((item) => item.id === claimId),
        'needsAttention filter should surface the customer-replied claim',
      ).toBe(true)

      let customerReplyNotified = false
      for (let attempt = 0; attempt < 20 && !customerReplyNotified; attempt += 1) {
        const notifications = await apiRequest(
          request,
          'GET',
          '/api/notifications?type=warranty_claims.claim.customer_replied&pageSize=50',
          { token: adminToken },
        )
        const notificationsBody = await readJsonSafe<{ items?: Array<{ type?: string }> }>(notifications)
        customerReplyNotified = Boolean(notificationsBody?.items?.length)
        if (!customerReplyNotified) await new Promise((resolve) => setTimeout(resolve, 500))
      }
      expect(customerReplyNotified, 'assignee should receive a customer-replied notification').toBe(true)

      const internalComment = `Internal staff-only comment ${stamp}`
      const staffComment = await postClaimEvent(request, adminToken, {
        claimId: claimId!,
        body: internalComment,
        visibility: 'internal',
      })
      expect(staffComment.status(), 'staff internal comment should return 200').toBe(200)
      const answeredClaim = await readClaim(request, adminToken, claimId!)
      expect(
        (answeredClaim as { awaitingStaffReply?: boolean }).awaitingStaffReply,
        'staff comment should clear the awaiting-staff-reply flag',
      ).toBe(false)

      const eventsA = await request.get(`/api/warranty_claims/portal/events?claimId=${encodeURIComponent(claimId!)}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(eventsA.status(), 'customer A should read own portal events').toBe(200)
      const eventsABody = await readJsonSafe<PortalEvents>(eventsA)
      const eventBodies = (eventsABody?.items ?? []).map((item) => item.body)
      expect(eventBodies).toContain(customerComment)
      expect(eventBodies).not.toContain(internalComment)
      expect((eventsABody?.items ?? []).every((item) => item.visibility === 'customer')).toBe(true)

      const eventsB = await request.get(`/api/warranty_claims/portal/events?claimId=${encodeURIComponent(claimId!)}`, {
        headers: portalCookieHeaders(sessionB),
      })
      expect(eventsB.status(), 'customer B should receive 404 for customer A claim events').toBe(404)

      const attachmentName = `wc-005-${stamp}.txt`
      const upload = await request.fetch('/api/warranty_claims/portal/attachments', {
        method: 'POST',
        headers: portalCookieHeaders(sessionA),
        multipart: {
          claimId: claimId!,
          file: {
            name: attachmentName,
            mimeType: 'text/plain',
            buffer: Buffer.from(`portal attachment ${stamp}`, 'utf8'),
          },
        },
      })
      expect(upload.status(), 'customer A should upload an attachment to own claim').toBe(200)
      attachmentId = (await readJsonSafe<{ item?: { id?: string } }>(upload))?.item?.id ?? null
      expect(attachmentId, 'attachment upload should return item.id').toBeTruthy()

      const attachmentsA = await request.get(`/api/warranty_claims/portal/attachments?claimId=${encodeURIComponent(claimId!)}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(attachmentsA.status(), 'customer A should list own claim attachments').toBe(200)
      const attachmentsABody = await readJsonSafe<{ items?: Array<{ id?: string; fileName?: string }> }>(attachmentsA)
      expect(attachmentsABody?.items?.some((item) => item.id === attachmentId && item.fileName === attachmentName)).toBe(true)

      const attachmentsB = await request.get(`/api/warranty_claims/portal/attachments?claimId=${encodeURIComponent(claimId!)}`, {
        headers: portalCookieHeaders(sessionB),
      })
      expect(attachmentsB.status(), 'customer B should receive 404 for customer A claim attachments').toBe(404)

      const downloadA = await request.get(`/api/warranty_claims/portal/attachments?attachmentId=${encodeURIComponent(attachmentId!)}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(downloadA.status(), 'customer A should download own claim attachment').toBe(200)
      expect(await downloadA.text(), 'downloaded content should match the uploaded bytes').toContain(`portal attachment ${stamp}`)

      const downloadB = await request.get(`/api/warranty_claims/portal/attachments?attachmentId=${encodeURIComponent(attachmentId!)}`, {
        headers: portalCookieHeaders(sessionB),
      })
      expect(downloadB.status(), 'customer B must not download customer A attachment').toBe(404)
    } finally {
      await restoreWarrantyClaimSettings(request, adminToken, settingsBefore)
      await deleteAttachmentIfExists(request, adminToken, attachmentId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/order-lines', orderALineId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderAId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderBId)
      await deleteCustomerUserFixture(request, adminToken, userBId)
      await deleteCustomerUserFixture(request, adminToken, userAId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, companyBId)
      await deleteCustomerCompanyFixture(request, adminToken, companyAId)
    }
  })

  test('titles the portal claim detail header with the dictionary label, prefers a seeded translation over an injected label, falls back on an unknown code or unavailable options, recovers, and wraps at 390px', async ({ browser, request }, testInfo) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-005-reason-header')
    const code = `custom-reason-${stamp}`
    const label = `Tenant custom reason ${stamp}`

    let roleId: string | null = null
    let companyId: string | null = null
    let userId: string | null = null
    let orderId: string | null = null
    let claimId: string | null = null
    let dictionaryId: string | null = null
    let ownsDictionary = false
    let entryId: string | null = null
    let entryUpdatedAt: string | null = null

    try {
      const organization = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?view=manage&ids=${organizationId}&tenantId=${tenantId}`,
        { token: adminToken },
      )
      expect(organization.status()).toBe(200)
      const orgSlug = (await readJsonSafe<{ items?: Array<{ slug?: string }> }>(organization))?.items?.[0]?.slug ?? null
      expect(orgSlug, 'org slug should resolve for portal navigation').toBeTruthy()

      const dictionaryKey = 'warranty_claims.warranty_claim_reason'
      const dictionaries = await apiRequest(request, 'GET', '/api/dictionaries', { token: adminToken })
      expect(dictionaries.status()).toBe(200)
      dictionaryId = (await readJsonSafe<{ items: Array<{ id: string; key: string; organizationId: string }> }>(dictionaries))?.items.find(
        (item) => item.key === dictionaryKey && item.organizationId === organizationId,
      )?.id ?? null
      if (!dictionaryId) {
        dictionaryId = await createDictionaryFixture(request, adminToken, { key: dictionaryKey, name: `QA claim reasons ${stamp}` })
        ownsDictionary = true
      }
      const createdEntry = await apiRequest(request, 'POST', `/api/dictionaries/${dictionaryId}/entries`, {
        token: adminToken,
        data: { value: code, label },
      })
      expect(createdEntry.status(), 'owned reason dictionary entry should be created').toBe(201)
      const entry = await readJsonSafe<{ id: string; updatedAt: string }>(createdEntry)
      entryId = entry?.id ?? null
      entryUpdatedAt = entry?.updatedAt ?? null
      expect(entryId).toBeTruthy()
      expect(entryUpdatedAt).toBeTruthy()

      roleId = (await createCustomerRoleFixture(request, adminToken, { features: ['portal.account.manage'] })).id
      companyId = await createCustomerCompanyFixture(request, adminToken, `QA WC Reason Header ${stamp}`)
      const user = await createCustomerUserFixture(request, adminToken, {
        roleIds: [roleId],
        customerEntityId: companyId,
        displayName: `QA WC Reason Header User ${stamp}`,
      })
      userId = user.id
      const session = await portalLogin(request, { email: user.email, password: user.password, tenantId })

      const orderCreate = await apiRequest(request, 'POST', '/api/sales/orders', {
        token: adminToken,
        data: {
          currencyCode: 'USD',
          lines: [{ currencyCode: 'USD', quantity: 1, name: `QA seed line ${Date.now()}`, unitPriceNet: 0, unitPriceGross: 0 }],
          customerEntityId: companyId,
          customerReference: `WC-REASON-HEADER-${stamp}`,
        },
      })
      expect(orderCreate.status(), 'sales order fixture should be created').toBe(201)
      orderId = (await readJsonSafe<{ id?: string }>(orderCreate))?.id ?? null
      expect(orderId).toBeTruthy()

      const createClaim = await request.post('/api/warranty_claims/portal/claims', {
        headers: portalCookieHeaders(session, { 'Content-Type': 'application/json' }),
        data: {
          orderId,
          reasonCode: code,
          lines: [
            {
              sku: `WC-REASON-${stamp}`,
              serialNumber: `SER-${stamp}`,
              faultDescription: 'Portal reason header regression',
              qtyClaimed: 1,
            },
          ],
        },
      })
      expect(createClaim.status(), 'portal claim intake should return 201').toBe(201)
      claimId = (await readJsonSafe<{ claimId?: string }>(createClaim))?.claimId ?? null
      expect(claimId).toBeTruthy()

      const baseURL = testInfo.project.use.baseURL!
      const detailPath = `/api/warranty_claims/portal/claims/${claimId}`
      const optionsPath = '/api/warranty_claims/portal/options'
      const trackerPath = `/${orgSlug}/portal/claims/${claimId}`
      const context = await browser.newContext({ baseURL, locale: 'en-US' })
      try {
        await context.addCookies([
          { name: 'customer_auth_token', value: session.authToken, url: baseURL, sameSite: 'Lax' },
          { name: 'customer_session_token', value: session.sessionToken, url: baseURL, sameSite: 'Lax' },
          { name: 'locale', value: 'en', url: baseURL, sameSite: 'Lax' },
        ])
        const page = await context.newPage()
        const heading = page.getByRole('heading', { level: 1 })

        await page.goto(trackerPath, { waitUntil: 'domcontentloaded' })
        await expect(heading).toHaveText(`${label}, Warranty claim`)
        await page.screenshot({ path: testInfo.outputPath('custom-label-desktop.png'), fullPage: true })

        await page.setViewportSize({ width: 390, height: 844 })
        await expect(heading).toHaveText(`${label}, Warranty claim`)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath('custom-label-mobile.png'), fullPage: true })
        await page.setViewportSize({ width: 1280, height: 800 })

        await page.route(`**${optionsPath}`, async (route) => {
          const response = await route.fetch()
          const body = (await response.json()) as { result?: { reasons?: Array<{ value: string; label: string }>; faultCodes?: unknown } }
          const reasons = [...(body.result?.reasons ?? []), { value: 'warranty-defect', label: 'Injected override label' }]
          await route.fulfill({ response, json: { ...body, result: { ...body.result, reasons } } })
        })
        await page.route(`**${detailPath}`, async (route) => {
          const response = await route.fetch()
          const body = (await response.json()) as { item: Record<string, unknown> }
          await route.fulfill({ response, json: { item: { ...body.item, reasonCode: 'warranty-defect' } } })
        })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(heading).toHaveText('Warranty defect, Warranty claim')
        await page.screenshot({ path: testInfo.outputPath('seeded-translation-precedence.png'), fullPage: true })
        await page.unroute(`**${optionsPath}`)
        await page.unroute(`**${detailPath}`)

        const unknownCode = `unmapped-${stamp}`
        await page.route(`**${detailPath}`, async (route) => {
          const response = await route.fetch()
          const body = (await response.json()) as { item: Record<string, unknown> }
          await route.fulfill({ response, json: { item: { ...body.item, reasonCode: unknownCode } } })
        })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(heading).toHaveText(`${unknownCode}, Warranty claim`)
        await page.screenshot({ path: testInfo.outputPath('unknown-code-fallback.png'), fullPage: true })
        await page.unroute(`**${detailPath}`)

        await page.route(`**${optionsPath}`, async (route) => {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'options unavailable' }) })
        })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(heading).toHaveText(`${code}, Warranty claim`)
        await page.screenshot({ path: testInfo.outputPath('options-unavailable-fallback.png'), fullPage: true })
        await page.unroute(`**${optionsPath}`)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(heading).toHaveText(`${label}, Warranty claim`)
        await page.screenshot({ path: testInfo.outputPath('options-recovered.png'), fullPage: true })
      } finally {
        await context.close()
      }
    } finally {
      if (entryId && dictionaryId) {
        const deleteEntry = await apiRequest(request, 'DELETE', `/api/dictionaries/${dictionaryId}/entries/${entryId}`, {
          token: adminToken,
          headers: { [OPTIMISTIC_LOCK_HEADER]: entryUpdatedAt! },
        })
        expect(deleteEntry.status(), 'owned reason dictionary entry should be deleted').toBe(200)
      }
      if (ownsDictionary && dictionaryId) {
        const dictionary = await apiRequest(request, 'GET', `/api/dictionaries/${dictionaryId}`, { token: adminToken })
        const record = await readJsonSafe<{ updatedAt: string }>(dictionary)
        await apiRequest(request, 'DELETE', `/api/dictionaries/${dictionaryId}`, {
          token: adminToken,
          headers: { [OPTIMISTIC_LOCK_HEADER]: record!.updatedAt },
        })
      }
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, companyId)
    }
  })
})
