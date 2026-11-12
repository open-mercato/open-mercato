import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
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
import { uniqueLabel } from './helpers'

const ORDER_COUNT = 90
const BATCH_SIZE = 5

type PortalOrdersPage = {
  items?: Array<{ id?: string }>
  total?: number
  pageSize?: number
}

async function createOrder(
  request: APIRequestContext,
  token: string,
  input: { customerId: string; orderNumber: string; placedAt: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/orders', {
    token,
    data: {
      currencyCode: 'USD',
      lines: [{ currencyCode: 'USD', quantity: 1, name: `QA seed line ${input.orderNumber}`, unitPriceNet: 0, unitPriceGross: 0 }],
      customerEntityId: input.customerId,
      orderNumber: input.orderNumber,
      placedAt: input.placedAt,
    },
  })
  const body = await readJsonSafe<{ id?: string | null }>(response)
  expect(response.status(), `sales order ${input.orderNumber} should be created`).toBe(201)
  expect(body?.id, 'sales order create response should include id').toBeTruthy()
  return body!.id as string
}

test.describe('TC-WC-041: portal order picker pages orders sharing a placed_at exactly once', () => {
  test.setTimeout(300_000)

  test('every order of a bulk-imported batch appears on exactly one page', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-041')
    const placedAt = new Date(Date.UTC(2026, 0, 15, 9, 30, 0)).toISOString()

    let roleId: string | null = null
    let companyId: string | null = null
    let userId: string | null = null
    const orderIds: string[] = []

    try {
      roleId = (await createCustomerRoleFixture(request, adminToken, { features: ['portal.account.manage'] })).id
      companyId = await createCustomerCompanyFixture(request, adminToken, `QA WC Same Timestamp ${stamp}`)
      const user = await createCustomerUserFixture(request, adminToken, {
        roleIds: [roleId],
        customerEntityId: companyId,
        displayName: `QA WC Same Timestamp User ${stamp}`,
      })
      userId = user.id

      for (let start = 0; start < ORDER_COUNT; start += BATCH_SIZE) {
        const batch = Array.from({ length: Math.min(BATCH_SIZE, ORDER_COUNT - start) }, (_, offset) => start + offset)
        const settled = await Promise.allSettled(batch.map((index) => createOrder(request, adminToken, {
          customerId: companyId as string,
          orderNumber: `WC-TIE-${stamp}-${String(index).padStart(3, '0')}`,
          placedAt,
        })))
        for (const result of settled) {
          if (result.status === 'fulfilled') orderIds.push(result.value)
        }
        const failure = settled.find((result) => result.status === 'rejected')
        if (failure && failure.status === 'rejected') throw failure.reason
      }

      const session = await portalLogin(request, { email: user.email, password: user.password, tenantId })
      const seen: string[] = []
      let total = 0
      let pageSize = 0
      for (let page = 1; page === 1 || (page - 1) * pageSize < total; page += 1) {
        const response = await request.get(`/api/warranty_claims/portal/orders?page=${page}`, {
          headers: portalCookieHeaders(session),
        })
        expect(response.status(), `portal orders page ${page} should load`).toBe(200)
        const body = await readJsonSafe<PortalOrdersPage>(response)
        total = body?.total ?? 0
        pageSize = body?.pageSize ?? 0
        expect(pageSize, 'portal orders should report a page size').toBeGreaterThan(0)
        for (const item of body?.items ?? []) {
          if (item.id) seen.push(item.id)
        }
      }

      expect(total).toBe(ORDER_COUNT)
      expect(seen).toHaveLength(ORDER_COUNT)
      expect(new Set(seen).size, 'no order may appear on two pages').toBe(ORDER_COUNT)
      expect(seen, 'tied orders should be listed by id descending').toEqual(
        [...orderIds].sort((left, right) => (left < right ? 1 : left > right ? -1 : 0)),
      )
    } finally {
      for (const orderId of orderIds) {
        await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      }
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerCompanyFixture(request, adminToken, companyId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  })
})
