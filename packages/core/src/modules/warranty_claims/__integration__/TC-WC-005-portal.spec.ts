import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
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
  cancelThenDeleteClaimIfPossible,
  postClaimEvent,
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

test.describe('TC-WC-005: warranty claims customer portal API', () => {
  test('requires a portal session, scopes claims by customer, validates order ownership, and filters timeline/attachments', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-005')

    let roleId: string | null = null
    let companyAId: string | null = null
    let companyBId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null
    let orderBId: string | null = null
    let claimId: string | null = null
    let attachmentId: string | null = null

    try {
      const anonymousClaims = await request.get('/api/warranty_claims/portal/claims')
      expect(anonymousClaims.status(), 'portal claims list should require customer auth').toBe(401)

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

      const orderBCreate = await apiRequest(request, 'POST', '/api/sales/orders', {
        token: adminToken,
        data: {
          currencyCode: 'USD',
          customerEntityId: companyBId,
          customerReference: `WC-PORTAL-ORDER-B-${stamp}`,
        },
      })
      expect(orderBCreate.status(), 'sales order fixture for customer B should be created').toBe(201)
      orderBId = (await readJsonSafe<{ id?: string }>(orderBCreate))?.id ?? null
      expect(orderBId, 'sales order fixture should return id').toBeTruthy()

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
          reasonCode: 'damaged',
          notes: `Portal intake notes ${stamp}`,
          lines: [
            {
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

      const detailA = await request.get(`/api/warranty_claims/portal/claims/${claimId}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(detailA.status(), 'customer A should read its own portal claim detail').toBe(200)
      const detailBody = await readJsonSafe<PortalClaimDetail>(detailA)
      expect(detailBody?.item?.status).toBe('submitted')
      expect(detailBody?.item?.channel).toBe('portal')
      expect(detailBody?.item?.customerId).toBe(companyAId)

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

      const internalComment = `Internal staff-only comment ${stamp}`
      const staffComment = await postClaimEvent(request, adminToken, {
        claimId: claimId!,
        body: internalComment,
        visibility: 'internal',
      })
      expect(staffComment.status(), 'staff internal comment should return 200').toBe(200)

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
      await deleteAttachmentIfExists(request, adminToken, attachmentId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderBId)
      await deleteCustomerUserFixture(request, adminToken, userBId)
      await deleteCustomerUserFixture(request, adminToken, userAId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, companyBId)
      await deleteCustomerCompanyFixture(request, adminToken, companyAId)
    }
  })
})
