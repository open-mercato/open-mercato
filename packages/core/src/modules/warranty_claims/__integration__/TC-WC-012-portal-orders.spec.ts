import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createOrderLineFixture, deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
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
  listClaimLines,
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  uniqueLabel,
} from './helpers'

type PortalOrdersResponse = {
  ok?: boolean
  items?: Array<{
    id?: string
    orderNumber?: string
    placedAt?: string | null
    currencyCode?: string | null
    grandTotalGrossAmount?: string | number | null
  }>
}

type PortalOrderLinesResponse = {
  ok?: boolean
  order?: { id?: string; placedAt?: string | null }
  items?: Array<{
    orderLineId?: string
    sku?: string | null
    name?: string | null
    quantity?: string | number | null
    estimatedWarrantyStatus?: 'in_warranty' | 'out_of_warranty' | 'unknown'
  }>
}

async function createSalesOrderForCustomer(
  request: APIRequestContext,
  token: string,
  input: { customerId: string; orderNumber: string; lineName: string },
): Promise<{ orderId: string; lineId: string }> {
  const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
    token,
    data: {
      currencyCode: 'USD',
      customerEntityId: input.customerId,
      customerReference: input.orderNumber,
      orderNumber: input.orderNumber,
      placedAt: new Date().toISOString(),
    },
  })
  const orderBody = await readJsonSafe<{ id?: string | null }>(orderResponse)
  expect(orderResponse.status(), `sales order ${input.orderNumber} should be created`).toBe(201)
  expect(orderBody?.id, 'sales order create response should include id').toBeTruthy()
  const orderId = orderBody!.id as string
  const lineId = await createOrderLineFixture(request, token, orderId, {
    kind: 'product',
    name: input.lineName,
    quantity: 2,
    unitPriceNet: 10,
    unitPriceGross: 12,
    currencyCode: 'USD',
  })
  return { orderId, lineId }
}

function expectPortalLine(
  body: PortalOrderLinesResponse | null,
  lineId: string,
): NonNullable<PortalOrderLinesResponse['items']>[number] {
  const line = (body?.items ?? []).find((item) => item.orderLineId === lineId)
  expect(line, `portal order lines should include ${lineId}`).toBeTruthy()
  return line as NonNullable<PortalOrderLinesResponse['items']>[number]
}

test.describe('TC-WC-012: warranty claims portal order picker APIs', () => {
  test('lists customer-owned orders, estimates warranty status, rejects cross-customer lines, and persists picked line snapshots', async ({ request }) => {
    const anonymousOrders = await request.get('/api/warranty_claims/portal/orders', {
      headers: { Cookie: '' },
    })
    expect(anonymousOrders.status(), 'portal orders should require customer auth').toBe(401)

    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-012')
    const settingsBefore = await readWarrantyClaimSettings(request, adminToken)

    let roleId: string | null = null
    let companyAId: string | null = null
    let companyBId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null
    let orderAId: string | null = null
    let orderA2Id: string | null = null
    let orderBId: string | null = null
    let lineAId: string | null = null
    let lineA2Id: string | null = null
    let lineBId: string | null = null
    let claimId: string | null = null

    try {
      roleId = (await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.account.manage'],
      })).id
      companyAId = await createCustomerCompanyFixture(request, adminToken, `QA WC Portal Orders A ${stamp}`)
      companyBId = await createCustomerCompanyFixture(request, adminToken, `QA WC Portal Orders B ${stamp}`)
      const userA = await createCustomerUserFixture(request, adminToken, {
        roleIds: [roleId],
        customerEntityId: companyAId,
        displayName: `QA WC Portal Orders User A ${stamp}`,
      })
      userAId = userA.id
      const userB = await createCustomerUserFixture(request, adminToken, {
        roleIds: [roleId],
        customerEntityId: companyBId,
        displayName: `QA WC Portal Orders User B ${stamp}`,
      })
      userBId = userB.id

      const orderALineName = `QA WC Portal Orders Product A ${stamp}`
      const orderBLineName = `QA WC Portal Orders Product B ${stamp}`
      const orderA = await createSalesOrderForCustomer(request, adminToken, {
        customerId: companyAId,
        orderNumber: `WC-PORTAL-A-${stamp}`,
        lineName: orderALineName,
      })
      orderAId = orderA.orderId
      lineAId = orderA.lineId
      const orderB = await createSalesOrderForCustomer(request, adminToken, {
        customerId: companyBId,
        orderNumber: `WC-PORTAL-B-${stamp}`,
        lineName: orderBLineName,
      })
      orderBId = orderB.orderId
      lineBId = orderB.lineId

      const sessionA = await portalLogin(request, {
        email: userA.email,
        password: userA.password,
        tenantId,
      })

      const ordersA = await request.get('/api/warranty_claims/portal/orders', {
        headers: portalCookieHeaders(sessionA),
      })
      expect(ordersA.status(), 'customer A should list portal orders').toBe(200)
      const ordersABody = await readJsonSafe<PortalOrdersResponse>(ordersA)
      expect((ordersABody?.items ?? []).some((item) => item.id === orderAId)).toBe(true)
      expect((ordersABody?.items ?? []).some((item) => item.id === orderBId)).toBe(false)

      const linesA = await request.get(`/api/warranty_claims/portal/orders/lines?orderId=${encodeURIComponent(orderAId!)}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(linesA.status(), 'customer A should list own order lines').toBe(200)
      const linesABody = await readJsonSafe<PortalOrderLinesResponse>(linesA)
      const lineA = expectPortalLine(linesABody, lineAId!)
      expect(lineA.sku || lineA.name, 'portal line should expose sku or name').toBeTruthy()
      expect(lineA.quantity, 'portal line should expose quantity').not.toBeNull()
      expect(Object.prototype.hasOwnProperty.call(lineA, 'estimatedWarrantyStatus')).toBe(true)

      let settings = await saveWarrantyClaimSettings(request, adminToken, {
        defaultWarrantyMonths: 12,
      }, settingsBefore.updatedAt)
      const linesInWarranty = await request.get(`/api/warranty_claims/portal/orders/lines?orderId=${encodeURIComponent(orderAId!)}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(linesInWarranty.status(), 'customer A should list own order lines with warranty settings').toBe(200)
      const inWarrantyBody = await readJsonSafe<PortalOrderLinesResponse>(linesInWarranty)
      expect(expectPortalLine(inWarrantyBody, lineAId!).estimatedWarrantyStatus).toBe('in_warranty')

      settings = await saveWarrantyClaimSettings(request, adminToken, {
        defaultWarrantyMonths: null,
      }, settings.updatedAt)
      expect(settings.defaultWarrantyMonths).toBeNull()
      const linesUnknown = await request.get(`/api/warranty_claims/portal/orders/lines?orderId=${encodeURIComponent(orderAId!)}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(linesUnknown.status(), 'customer A should list own order lines after clearing warranty settings').toBe(200)
      const unknownBody = await readJsonSafe<PortalOrderLinesResponse>(linesUnknown)
      expect(expectPortalLine(unknownBody, lineAId!).estimatedWarrantyStatus).toBe('unknown')

      const crossCustomerLines = await request.get(`/api/warranty_claims/portal/orders/lines?orderId=${encodeURIComponent(orderBId!)}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(crossCustomerLines.status(), 'customer A should receive 404 for customer B order lines').toBe(404)

      const orderA2 = await createSalesOrderForCustomer(request, adminToken, {
        customerId: companyAId!,
        orderNumber: `WC-PORTAL-A2-${stamp}`,
        lineName: `${orderALineName} second order`,
      })
      orderA2Id = orderA2.orderId
      lineA2Id = orderA2.lineId
      const mismatchedIntake = await request.post('/api/warranty_claims/portal/claims', {
        headers: portalCookieHeaders(sessionA, { 'Content-Type': 'application/json' }),
        data: {
          orderId: orderAId,
          reasonCode: 'damaged',
          lines: [
            {
              orderLineId: lineA2Id,
              faultDescription: 'Line from a different owned order must be rejected',
              qtyClaimed: 1,
            },
          ],
        },
      })
      expect(
        mismatchedIntake.status(),
        'portal intake with an orderLineId from another owned order should return 400',
      ).toBe(400)

      const intake = await request.post('/api/warranty_claims/portal/claims', {
        headers: portalCookieHeaders(sessionA, { 'Content-Type': 'application/json' }),
        data: {
          orderId: orderAId,
          reasonCode: 'damaged',
          lines: [
            {
              orderLineId: lineAId,
              productName: orderALineName,
              sku: `WC-012-SKU-${stamp}`,
              faultDescription: 'Portal order picker selected this line',
              qtyClaimed: 1,
            },
          ],
        },
      })
      expect(intake.status(), 'portal picked-line intake should return 201').toBe(201)
      claimId = (await readJsonSafe<{ claimId?: string | null }>(intake))?.claimId ?? null
      expect(claimId, 'portal intake response should include claimId').toBeTruthy()

      const staffLines = await listClaimLines(request, adminToken, claimId!)
      const pickedLine = staffLines.find((line) => line.orderLineId === lineAId)
      expect(pickedLine, 'staff claim lines should include the picked portal order line').toBeTruthy()
      expect(pickedLine?.orderLineId).toBe(lineAId)
      expect(pickedLine?.productName).toBe(orderALineName)
    } finally {
      await restoreWarrantyClaimSettings(request, adminToken, settingsBefore)
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/order-lines', lineBId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderBId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/order-lines', lineA2Id)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderA2Id)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/order-lines', lineAId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderAId)
      await deleteCustomerUserFixture(request, adminToken, userBId)
      await deleteCustomerUserFixture(request, adminToken, userAId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, companyBId)
      await deleteCustomerCompanyFixture(request, adminToken, companyAId)
    }
  })
})
