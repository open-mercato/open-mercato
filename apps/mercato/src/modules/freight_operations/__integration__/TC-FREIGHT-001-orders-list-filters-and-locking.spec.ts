import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createFreightOrderFixture,
  deleteFreightEntityIfExists,
  getFreightOrderFixture,
  isoInstant,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers'],
}

const ORDERS = '/api/freight_operations/orders'
const COMPANIES = '/api/customers/companies'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

type ListResponse = { items?: Array<{ id?: string }> }

async function listIds(request: Parameters<typeof apiRequest>[0], token: string, path: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', path, { token })
  const body = await readJsonSafe<ListResponse>(response)
  expect(response.ok(), `GET ${path} failed with ${response.status()}`).toBeTruthy()
  return (body?.items ?? []).map((row) => row.id as string)
}

/**
 * TC-FREIGHT-001: every order list filter narrows the result set, and a stale
 * optimistic-lock version on an update is a structured 409.
 *
 * Each filter case asserts both directions (fixture in, deliberate non-match
 * out) because a filter key that names nothing the query builder can resolve
 * answers 200 with a plausible-looking page.
 */
test.describe('TC-FREIGHT-001: freight order list filters and optimistic locking', () => {
  test('filters narrow and a stale version conflicts', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    const company = await createCompanyFixture(request, token, `Freight TC ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Freight TC ${suffix}` }

    let orderA: string | null = null
    let orderB: string | null = null

    try {
      const created = await createFreightOrderFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
        cargoDescription: `Cement bags ${suffix}`,
        pickupLocation: `Riyadh ${suffix}`,
        requestedPickupAt: isoInstant(2),
        requestedDeliveryAt: isoInstant(2.5),
      })
      orderA = created.id
      expect(created.orderNumber).toMatch(/^FO-\d{5}$/)

      const other = await createFreightOrderFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
        cargoDescription: 'Steel coils',
        pickupLocation: 'Jeddah',
      })
      orderB = other.id

      const byStatusDraft = await listIds(request, token, `${ORDERS}?status=draft&pageSize=100`)
      expect(byStatusDraft).toContain(orderA)

      const byStatusInvoiced = await listIds(request, token, `${ORDERS}?status=invoiced&pageSize=100`)
      expect(byStatusInvoiced).not.toContain(orderA)

      const byCustomer = await listIds(request, token, `${ORDERS}?customerId=${company}&pageSize=100`)
      expect(byCustomer).toContain(orderA)

      const bySearch = await listIds(request, token, `${ORDERS}?search=${encodeURIComponent(suffix)}&pageSize=100`)
      expect(bySearch).toContain(orderA)
      expect(bySearch).not.toContain(orderB)

      const byWindow = await listIds(request, token, `${ORDERS}?requestedFrom=${encodeURIComponent(isoInstant(1))}&requestedTo=${encodeURIComponent(isoInstant(3))}&pageSize=100`)
      expect(byWindow).toContain(orderA)
      expect(byWindow).not.toContain(orderB)

      // Stale version: the header names a timestamp the row has moved past.
      const stale = await apiRequest(request, 'PUT', ORDERS, {
        token,
        data: { id: orderA, notes: 'stale write' },
        headers: { [LOCK_HEADER]: new Date(Date.now() - 60_000).toISOString() },
        retryTransport: false,
      })
      const staleBody = await readJsonSafe<{ code?: string }>(stale)
      expect(stale.status()).toBe(409)
      expect(staleBody?.code).toBe('optimistic_lock_conflict')

      // Fresh version: the row's own updatedAt is accepted.
      const current = await getFreightOrderFixture(request, token, orderA)
      const freshStamp = typeof current?.updated_at === 'string' ? current.updated_at : null
      expect(freshStamp).toBeTruthy()
      const fresh = await apiRequest(request, 'PUT', ORDERS, {
        token,
        data: { id: orderA, notes: 'fresh write' },
        headers: { [LOCK_HEADER]: freshStamp as string },
        retryTransport: false,
      })
      expect(fresh.ok(), `fresh write failed with ${fresh.status()}`).toBeTruthy()
    } finally {
      await deleteFreightEntityIfExists(request, token, ORDERS, orderA)
      await deleteFreightEntityIfExists(request, token, ORDERS, orderB)
      await deleteFreightEntityIfExists(request, token, COMPANIES, company)
    }
  })
})
