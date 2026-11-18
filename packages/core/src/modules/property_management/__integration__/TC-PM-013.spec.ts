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
  settleLease,
  type LeaseSetup,
} from './leaseFixtures'

/**
 * TC-PM-013: direct lease
 * A direct lease answers 202 pending_order and becomes active once the sales_operation worker has
 * created its recurring order: monthly, starting on the lease start, one period per term month, one
 * line with the unit's product at the monthly rate. Another lease overlapping the term on the same
 * unit is refused (409 lease_overlap); one company may lease two units. Changing the product of the
 * leased unit is refused (409 unit_product_locked, the lease named as the blocker), and so is deleting
 * the building (409 building_used; `GET buildings/{id}/archive` reports `canDelete: false`). Of a direct
 * lease and a proposal created concurrently on the same unit and term exactly one is admitted (202)
 * and the other gets 409 lease_overlap.
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

      const detail = await settleLease(request, token, created.id, isActivated, 'the direct lease activation')
      expect(detail.lease.status).toBe('active')

      const buildingId = setup.buildingId as string
      const usage = await apiRequest(request, 'GET', `/api/property_management/buildings/${buildingId}/archive`, { token })
      const usageBody = await readJsonSafe<{ canDelete?: boolean; everUsed?: boolean }>(usage)
      expect(usage.status(), `GET buildings/{id}/archive → ${JSON.stringify(usageBody)}`).toBe(200)
      expect(usageBody?.canDelete, 'a building that has had a lease cannot be deleted').toBe(false)
      const deleteUsed = await apiRequest(request, 'DELETE', `/api/property_management/buildings?id=${encodeURIComponent(buildingId)}`, { token })
      const deleteUsedBody = await readJsonSafe<{ code?: string }>(deleteUsed)
      expect(deleteUsed.status(), `DELETE a used building → ${JSON.stringify(deleteUsedBody)}`).toBe(409)
      expect(deleteUsedBody?.code).toBe('building_used')
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

      const productChange = await apiRequest(request, 'POST', `/api/property_management/units/${unitA}/product`, {
        token,
        data: { catalogProductId: setup.products.secondProductId },
      })
      const productChangeBody = await readJsonSafe<{ code?: string; blockerCount?: number; blockers?: Array<{ kind: string; id: string }> }>(productChange)
      expect(productChange.status(), `POST units/{id}/product on a leased unit → ${JSON.stringify(productChangeBody)}`).toBe(409)
      expect(productChangeBody?.code).toBe('unit_product_locked')
      expect(productChangeBody?.blockers ?? [], 'the active lease is named as the blocker').toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'lease', id: created.id })]),
      )
      const history = await readJsonSafe<{ periods?: Array<{ catalogProductId: string; validTo: string | null }>; productLocked?: boolean }>(
        await apiRequest(request, 'GET', `/api/property_management/units/${unitA}/product`, { token }),
      )
      expect(history?.productLocked, 'the history reports the product as locked').toBe(true)
      expect(
        (history?.periods ?? []).filter((period) => period.validTo === null).map((period) => period.catalogProductId),
        'the refused change leaves the open product period untouched',
      ).toEqual([setup.products.productId])
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })

  test('admits exactly one of a direct lease and a proposal racing for the same unit and term', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp, { units: 1, companies: 2 })
      const [unitId] = setup.unitIds
      const startsOn = isoDayFromToday(15)
      const responses = await Promise.all(
        setup.companyIds.map((customerCompanyId, index) =>
          postLease(request, token, { unitId, customerCompanyId, startsOn, termMonths: 6, ...(index === 1 ? { asProposal: true, expiresInDays: 7 } : {}) }),
        ),
      )
      const bodies = await Promise.all(responses.map((response) => readJsonSafe<{ id?: string; code?: string; status?: string }>(response)))
      for (const body of bodies) if (typeof body?.id === 'string' && body.id) setup.leaseIds.push(body.id)
      const outcomes = responses.map((response, index) => ({ status: response.status(), code: bodies[index]?.code ?? null }))
      expect(
        outcomes.map((outcome) => outcome.status).sort(),
        `two concurrent creates on one unit and term → ${JSON.stringify(bodies)}`,
      ).toEqual([202, 409])
      expect(outcomes.find((outcome) => outcome.status === 409)?.code).toBe('lease_overlap')
      const list = await readJsonSafe<{ items?: Array<{ id: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/leases?unitId=${unitId}&pageSize=100`, { token }),
      )
      expect((list?.items ?? []).map((item) => item.id), 'only the admitted lease holds the unit').toEqual(setup.leaseIds)
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
