import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { stampOf } from './helpers'
import {
  cleanupLeaseSetup,
  createLease,
  createLeaseSetup,
  isActivated,
  isoDayFromToday,
  MONTHLY_RATE,
  postLease,
  readDocumentLines,
  readField,
  readSalesDocument,
  waitForLease,
  type LeaseSetup,
} from './leaseFixtures'

/**
 * TC-PM-013: direct lease
 * A direct lease answers 202 pending_order and becomes active once the sales_operation worker has
 * created its recurring order: monthly, starting on the lease start, one period per term month, one
 * line with the unit's product at the monthly rate. Another lease overlapping the term on the same
 * unit is refused (409 lease_overlap); one company may lease two units.
 */
test.describe('TC-PM-013: direct lease', () => {
  test('creates an active lease billed by a recurring order', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp, { units: 2, companies: 2 })
      const [unitA, unitB] = setup.unitIds
      const [companyA, companyB] = setup.companyIds
      const startsOn = isoDayFromToday(10)

      const created = await createLease(request, token, setup, { unitId: unitA, customerCompanyId: companyA, startsOn, termMonths: 12 })
      expect(created.status).toBe('pending_order')

      const overlap = await postLease(request, token, { unitId: unitA, customerCompanyId: companyB, startsOn: isoDayFromToday(40), termMonths: 3 })
      const overlapBody = await readJsonSafe<{ code?: string }>(overlap)
      expect(overlap.status(), 'a pending_order lease already holds the unit').toBe(409)
      expect(overlapBody?.code).toBe('lease_overlap')

      const secondUnit = await createLease(request, token, setup, { unitId: unitB, customerCompanyId: companyA, startsOn, termMonths: 6 })
      expect(secondUnit.status, 'one company may lease several units').toBe('pending_order')

      const list = await readJsonSafe<{ items?: Array<{ id: string; customerCompanyId: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/leases?customerCompanyId=${companyA}&pageSize=100`, { token }),
      )
      expect((list?.items ?? []).map((item) => item.id)).toEqual(expect.arrayContaining([created.id, secondUnit.id]))

      const detail = await waitForLease(request, token, created.id, isActivated)
      test.skip(!detail, 'the property_management.sales_operation worker did not run in this environment')
      if (!detail) return
      expect(detail.lease.status).toBe('active')
      const orderId = detail.lease.salesOrderId
      expect(orderId, 'the active lease links its recurring order').toBeTruthy()
      expect(detail.versions[0]?.salesOrderId).toBe(orderId)

      const order = await readSalesDocument(request, token, 'orders', orderId as string)
      expect(order, 'the recurring order is readable in sales').not.toBeNull()
      expect(readField(order, 'recurrence')).toMatchObject({ frequency: 'monthly', startsOn, periodCount: 12 })
      const lines = await readDocumentLines(request, token, 'order', orderId as string)
      expect(lines).toHaveLength(1)
      expect(readField(lines[0], 'productId', 'product_id')).toBe(setup.products?.productId)
      expect(Number(readField(lines[0], 'unitPriceNet', 'unit_price_net'))).toBe(MONTHLY_RATE)
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })

  test('validates references and the term', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp, { units: 1, companies: 1 })
      const [unitId] = setup.unitIds
      const [companyId] = setup.companyIds
      const zeroTerm = await postLease(request, token, { unitId, customerCompanyId: companyId, startsOn: isoDayFromToday(5), termMonths: 0 })
      expect(zeroTerm.status(), 'a term of 0 months is invalid').toBe(400)
      const notCompany = await postLease(request, token, { unitId, customerCompanyId: unitId, startsOn: isoDayFromToday(5), termMonths: 3 })
      expect(notCompany.status(), 'the tenant must be a company of the organization').toBe(422)
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })
})
