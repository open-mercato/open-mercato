import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-SALES-051: sales lines cannot reference a catalog service from another organization
 *
 * Two sibling organizations are created in the admin tenant, with one service in each. With
 * org A selected, the admin — who may see both organizations — writes org-A documents.
 * Verifies:
 * - a quote line referencing the org-B service is rejected with 400 and is not persisted
 * - an order create whose line references the org-B service is rejected with 400 and creates
 *   no order
 * - an order line referencing the org-B service is rejected with 400 and is not persisted
 * - the org-A service is accepted on all three paths (control)
 * - the org-A service list never contains the org-B service
 *
 * Self-contained: organizations, services, the quote and the orders are created through the API
 * and removed in `finally`.
 */
export const integrationMeta = { dependsOnModules: ['sales', 'catalog'] }

const FOREIGN_SERVICE_ERROR = 'references a service that does not exist in this organization'

type LineRow = { id: string; service_id?: string | null }

async function createServiceInOrg(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  title: string,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/catalog/services', {
    token,
    selectedOrgId: organizationId,
    data: { title, defaultPriceAmount: 40, defaultPriceCurrencyCode: 'USD' },
  })
  expect(response.status(), `service fixture in org ${organizationId} should be 201: ${(await response.text()).slice(0, 300)}`).toBe(201)
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'service fixture should return an id')
}

async function readLineServiceIds(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  path: string,
): Promise<Array<string | null>> {
  const response = await apiRequestWithSelectedOrg(request, 'GET', path, { token, selectedOrgId: organizationId })
  expect(response.status(), `GET ${path} should return 200`).toBe(200)
  const items = (await readJsonSafe<{ items?: LineRow[] }>(response))?.items ?? []
  return items.map((item) => item.service_id ?? null)
}

async function deleteInOrgIfExists(
  request: APIRequestContext,
  token: string,
  organizationId: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!organizationId || !id) return
  await apiRequestWithSelectedOrg(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, {
    token,
    selectedOrgId: organizationId,
  }).catch(() => undefined)
}

function serviceLine(serviceId: string, name: string) {
  return {
    kind: 'service',
    serviceId,
    name,
    quantity: 1,
    unitPriceNet: 40,
    unitPriceGross: 40,
    currencyCode: 'USD',
  }
}

test.describe('TC-SALES-051: service lines are scoped to the document organization', () => {
  test('rejects quote and order lines that reference another organization service', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`

    let orgAId: string | null = null
    let orgBId: string | null = null
    let serviceAId: string | null = null
    let serviceBId: string | null = null
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      orgAId = await createOrganizationFixture(request, superadminToken, { name: `QA SALES 051 Org A ${stamp}`, tenantId })
      orgBId = await createOrganizationFixture(request, superadminToken, { name: `QA SALES 051 Org B ${stamp}`, tenantId })
      serviceAId = await createServiceInOrg(request, adminToken, orgAId, `QA SALES 051 service A ${stamp}`)
      serviceBId = await createServiceInOrg(request, adminToken, orgBId, `QA SALES 051 service B ${stamp}`)

      const orgAList = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/catalog/services?ids=${encodeURIComponent(`${serviceAId},${serviceBId}`)}`,
        { token: adminToken, selectedOrgId: orgAId },
      )
      expect(orgAList.status()).toBe(200)
      const orgAItems = (await readJsonSafe<{ items?: Array<{ id: string }> }>(orgAList))?.items ?? []
      expect(orgAItems.map((item) => item.id), 'the org-A service list never contains the org-B service').toEqual([serviceAId])

      const quoteResponse = await apiRequestWithSelectedOrg(request, 'POST', '/api/sales/quotes', {
        token: adminToken,
        selectedOrgId: orgAId,
        data: { currencyCode: 'USD' },
      })
      expect(quoteResponse.status(), 'org-A quote should be created').toBe(201)
      quoteId = expectId((await readJsonSafe<{ id?: string }>(quoteResponse))?.id, 'quote create should return an id')

      const foreignQuoteLine = await apiRequestWithSelectedOrg(request, 'POST', '/api/sales/quote-lines', {
        token: adminToken,
        selectedOrgId: orgAId,
        data: { quoteId, ...serviceLine(serviceBId, 'QA foreign service quote line') },
      })
      expect(foreignQuoteLine.status(), 'a quote line referencing the org-B service must be 400').toBe(400)
      expect((await readJsonSafe<{ error?: string }>(foreignQuoteLine))?.error).toContain(FOREIGN_SERVICE_ERROR)

      const ownQuoteLine = await apiRequestWithSelectedOrg(request, 'POST', '/api/sales/quote-lines', {
        token: adminToken,
        selectedOrgId: orgAId,
        data: { quoteId, ...serviceLine(serviceAId, 'QA own service quote line') },
      })
      expect(ownQuoteLine.status(), `a quote line referencing the org-A service should be 201: ${(await ownQuoteLine.text()).slice(0, 300)}`).toBe(201)

      expect(
        await readLineServiceIds(request, adminToken, orgAId, `/api/sales/quote-lines?quoteId=${encodeURIComponent(quoteId)}&pageSize=100`),
        'only the org-A service line is persisted on the quote',
      ).toEqual([serviceAId])

      const foreignOrder = await apiRequestWithSelectedOrg(request, 'POST', '/api/sales/orders', {
        token: adminToken,
        selectedOrgId: orgAId,
        data: { currencyCode: 'USD', lines: [serviceLine(serviceBId, 'QA foreign service order line')] },
      })
      expect(foreignOrder.status(), 'an order whose line references the org-B service must be 400').toBe(400)
      const foreignOrderBody = await readJsonSafe<{ error?: string; id?: string }>(foreignOrder)
      expect(foreignOrderBody?.error).toContain(FOREIGN_SERVICE_ERROR)
      expect(foreignOrderBody?.id, 'a rejected order returns no id').toBeUndefined()

      const ownOrder = await apiRequestWithSelectedOrg(request, 'POST', '/api/sales/orders', {
        token: adminToken,
        selectedOrgId: orgAId,
        data: { currencyCode: 'USD', lines: [serviceLine(serviceAId, 'QA own service order line')] },
      })
      expect(ownOrder.status(), `an order referencing the org-A service should be 201: ${(await ownOrder.text()).slice(0, 300)}`).toBe(201)
      orderId = expectId((await readJsonSafe<{ id?: string }>(ownOrder))?.id, 'order create should return an id')

      const foreignOrderLine = await apiRequestWithSelectedOrg(request, 'POST', '/api/sales/order-lines', {
        token: adminToken,
        selectedOrgId: orgAId,
        data: { orderId, ...serviceLine(serviceBId, 'QA foreign service order line 2') },
      })
      expect(foreignOrderLine.status(), 'an order line referencing the org-B service must be 400').toBe(400)
      expect((await readJsonSafe<{ error?: string }>(foreignOrderLine))?.error).toContain(FOREIGN_SERVICE_ERROR)

      expect(
        await readLineServiceIds(request, adminToken, orgAId, `/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}&pageSize=100`),
        'only the org-A service line is persisted on the order',
      ).toEqual([serviceAId])
    } finally {
      await deleteInOrgIfExists(request, adminToken, orgAId, '/api/sales/orders', orderId)
      await deleteInOrgIfExists(request, adminToken, orgAId, '/api/sales/quotes', quoteId)
      if (orgAId && serviceAId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', `/api/catalog/services?id=${encodeURIComponent(serviceAId)}`, {
          token: adminToken,
          selectedOrgId: orgAId,
        }).catch(() => undefined)
      }
      if (orgBId && serviceBId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', `/api/catalog/services?id=${encodeURIComponent(serviceBId)}`, {
          token: adminToken,
          selectedOrgId: orgBId,
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, superadminToken, orgAId)
      await deleteOrganizationIfExists(request, superadminToken, orgBId)
    }
  })
})
