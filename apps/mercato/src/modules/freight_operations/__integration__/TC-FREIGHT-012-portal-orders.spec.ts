import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
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
import { deleteFreightEntityIfExists, uniqueFreightSuffix } from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers', 'customer_accounts'],
}

const PORTAL_ORDERS = '/api/portal/freight/orders'
const STAFF_ORDERS = '/api/freight_operations/orders'

type PortalOrder = {
  id: string
  orderNumber: string
  status: string
  cargoDescription: string
  pickupLocation: string
  dropoffLocation: string
}

/**
 * TC-FREIGHT-012: a portal customer submits a transport order, staff sees it in
 * the external-order queue, approves or rejects it, and the portal reflects the
 * decision. The order never becomes staff-authored: its source stays
 * `customer_portal` throughout.
 */
test.describe('TC-FREIGHT-012: customer portal order intake', () => {
  test('portal submit → staff approve → portal sees confirmed; a rejected order is cancelled', async ({ request }) => {
    test.setTimeout(60_000)
    const adminToken = await getAuthToken(request)
    const { tenantId } = getTokenContext(adminToken)
    const suffix = uniqueFreightSuffix()
    let roleId: string | null = null
    let userId: string | null = null
    let companyId: string | null = null
    const orderIds: string[] = []

    try {
      const role = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.freight.view', 'portal.freight.orders.create'],
      })
      roleId = role.id
      companyId = await createCustomerCompanyFixture(request, adminToken, `Portal orders TC ${suffix}`)
      const user = await createCustomerUserFixture(request, adminToken, {
        roleIds: [role.id],
        customerEntityId: companyId,
      })
      userId = user.id

      const session = await portalLogin(request, {
        email: user.email,
        password: user.password,
        tenantId,
      })

      const submit = await request.post(PORTAL_ORDERS, {
        headers: portalCookieHeaders(session, { 'Content-Type': 'application/json' }),
        data: {
          cargoDescription: `Portal steel ${suffix}`,
          pickupLocation: 'Riyadh',
          dropoffLocation: 'Dammam',
          requestedPickupAt: '2026-12-05T12:00:00.000Z',
          truckTypeRequired: 'flatbed',
          cargoQuantity: '10',
          cargoUnit: 'ton',
        },
      })
      const submitted = await readJsonSafe<{ orderId?: string; orderNumber?: string }>(submit)
      expect(submit.status(), JSON.stringify(submitted)).toBe(201)
      const firstOrderId = submitted?.orderId
      expect(firstOrderId).toBeTruthy()
      orderIds.push(firstOrderId as string)

      const portalList = await request.get(PORTAL_ORDERS, { headers: portalCookieHeaders(session) })
      const portalBody = await readJsonSafe<{ items?: PortalOrder[] }>(portalList)
      expect(portalList.status(), JSON.stringify(portalBody)).toBe(200)
      const submittedOrder = portalBody?.items?.find((row) => row.id === firstOrderId)
      expect(submittedOrder?.status).toBe('submitted')
      expect(submittedOrder?.cargoDescription).toBe(`Portal steel ${suffix}`)

      const staffQueue = await apiRequest(
        request,
        'GET',
        `${STAFF_ORDERS}?source=customer_portal&status=draft&pageSize=50`,
        { token: adminToken },
      )
      const staffBody = await readJsonSafe<{ items?: Array<{ id: string; source: string }> }>(staffQueue)
      expect(staffQueue.ok()).toBeTruthy()
      const queued = staffBody?.items?.find((row) => row.id === firstOrderId)
      expect(queued?.source).toBe('customer_portal')

      const approve = await apiRequest(request, 'POST', `${STAFF_ORDERS}/confirm`, {
        token: adminToken,
        data: { id: firstOrderId },
        retryTransport: false,
      })
      expect(approve.ok(), `staff confirm failed with ${approve.status()}`).toBeTruthy()

      const afterApproval = await request.get(PORTAL_ORDERS, { headers: portalCookieHeaders(session) })
      const afterApprovalBody = await readJsonSafe<{ items?: PortalOrder[] }>(afterApproval)
      expect(afterApprovalBody?.items?.find((row) => row.id === firstOrderId)?.status).toBe('confirmed')

      const secondSubmit = await request.post(PORTAL_ORDERS, {
        headers: portalCookieHeaders(session, { 'Content-Type': 'application/json' }),
        data: {
          cargoDescription: `Portal reject ${suffix}`,
          pickupLocation: 'Jeddah',
          dropoffLocation: 'Riyadh',
        },
      })
      const secondBody = await readJsonSafe<{ orderId?: string }>(secondSubmit)
      expect(secondSubmit.status()).toBe(201)
      const secondOrderId = secondBody?.orderId
      expect(secondOrderId).toBeTruthy()
      orderIds.push(secondOrderId as string)

      const reject = await apiRequest(request, 'POST', `${STAFF_ORDERS}/cancel`, {
        token: adminToken,
        data: { id: secondOrderId, reason: 'Rate request does not fit the lane' },
        retryTransport: false,
      })
      expect(reject.ok(), `staff cancel failed with ${reject.status()}`).toBeTruthy()

      const afterReject = await request.get(PORTAL_ORDERS, { headers: portalCookieHeaders(session) })
      const afterRejectBody = await readJsonSafe<{ items?: PortalOrder[] }>(afterReject)
      expect(afterRejectBody?.items?.find((row) => row.id === secondOrderId)?.status).toBe('cancelled')
    } finally {
      for (const id of orderIds) {
        await deleteFreightEntityIfExists(request, adminToken, STAFF_ORDERS, id)
      }
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, companyId)
    }
  })
})
