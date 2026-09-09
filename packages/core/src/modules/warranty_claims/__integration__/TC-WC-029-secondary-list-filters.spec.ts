import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createWarrantyRegistrationFixture,
  createWarrantyVendorPolicyFixture,
  deleteWarrantyRegistrationIfExists,
  deleteWarrantyVendorPolicyIfExists,
  listWarrantyRegistrations,
  listWarrantyVendorPolicies,
  uniqueLabel,
  type WarrantyClaimRegistrationItem,
  type WarrantyVendorPolicyItem,
} from './helpers'

const DAY_MS = 24 * 60 * 60 * 1000

type TroubleshootingGuideItem = {
  id: string | null
  title: string | null
  claimType: string | null
  isActive: boolean
}

type GuideListResponse = {
  items?: TroubleshootingGuideItem[]
}

function registrationIds(items: WarrantyClaimRegistrationItem[]): Array<string | null> {
  return items.map((item) => item.id)
}

function policyIds(items: WarrantyVendorPolicyItem[]): Array<string | null> {
  return items.map((item) => item.id)
}

async function createGuide(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/warranty_claims/troubleshooting-guides', { token, data })
  const body = await readJsonSafe<{ id?: string | null }>(response)
  expect(response.status(), `POST troubleshooting guide should return 201: ${JSON.stringify(body)}`).toBe(201)
  expect(body?.id, 'guide create response should include id').toBeTruthy()
  return body!.id as string
}

async function listGuides(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<TroubleshootingGuideItem[]> {
  const response = await apiRequest(request, 'GET', `/api/warranty_claims/troubleshooting-guides?${query}`, { token })
  expect(response.status(), `GET /api/warranty_claims/troubleshooting-guides?${query} should return 200`).toBe(200)
  const body = await readJsonSafe<GuideListResponse>(response)
  return Array.isArray(body?.items) ? body!.items! : []
}

async function deleteGuideIfExists(
  request: APIRequestContext,
  token: string | null,
  guideId: string | null,
): Promise<void> {
  if (!token || !guideId) return
  await apiRequest(
    request,
    'DELETE',
    `/api/warranty_claims/troubleshooting-guides?id=${encodeURIComponent(guideId)}`,
    { token },
  ).catch(() => undefined)
}

test.describe('TC-WC-029: warranty claims secondary list filters', () => {
  test('filters registrations by coverageType, source, and expiry windows, excluding null-expiry rows', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-029-reg')
    const now = Date.now()

    let expiredId: string | null = null
    let inside30Id: string | null = null
    let outside30Id: string | null = null
    let nullExpiryId: string | null = null

    try {
      const expired = await createWarrantyRegistrationFixture(request, adminToken, {
        serialNumber: `SER-029-EXPIRED-${stamp}`,
        sku: `WC-029-SKU-${stamp}`,
        productName: 'QA expiry filter expired',
        coverageType: 'standard',
        source: 'manual',
        warrantyExpiresAt: new Date(now - 2 * DAY_MS).toISOString(),
      })
      expiredId = expired.id
      expect(expired.warrantyExpiresAt, 'expired fixture should persist warrantyExpiresAt').toBeTruthy()

      const inside30 = await createWarrantyRegistrationFixture(request, adminToken, {
        serialNumber: `SER-029-INSIDE-${stamp}`,
        sku: `WC-029-SKU-${stamp}`,
        productName: 'QA expiry filter inside 30d',
        coverageType: 'extended',
        source: 'order',
        warrantyExpiresAt: new Date(now + 29 * DAY_MS).toISOString(),
      })
      inside30Id = inside30.id

      const outside30 = await createWarrantyRegistrationFixture(request, adminToken, {
        serialNumber: `SER-029-OUTSIDE-${stamp}`,
        sku: `WC-029-SKU-${stamp}`,
        productName: 'QA expiry filter outside 30d',
        coverageType: 'standard',
        source: 'third_party',
        warrantyExpiresAt: new Date(now + 31 * DAY_MS).toISOString(),
      })
      outside30Id = outside30.id

      const nullExpiry = await createWarrantyRegistrationFixture(request, adminToken, {
        serialNumber: `SER-029-NULL-${stamp}`,
        sku: `WC-029-SKU-${stamp}`,
        productName: 'QA expiry filter null expiry',
        coverageType: 'extended',
        source: 'manual',
      })
      nullExpiryId = nullExpiry.id
      expect(nullExpiry.warrantyExpiresAt, 'fixture without dates should keep a null expiry').toBeNull()

      const search = `search=${encodeURIComponent(stamp)}&pageSize=100`

      const extendedRows = registrationIds(
        await listWarrantyRegistrations(request, adminToken, `coverageType=extended&${search}`),
      )
      expect(extendedRows, 'coverageType=extended should include the extended fixtures').toEqual(
        expect.arrayContaining([inside30Id, nullExpiryId]),
      )
      expect(extendedRows, 'coverageType=extended should exclude standard fixtures').not.toContain(expiredId)
      expect(extendedRows).not.toContain(outside30Id)

      const manualRows = registrationIds(
        await listWarrantyRegistrations(request, adminToken, `source=manual&${search}`),
      )
      expect(manualRows, 'source=manual should include the manual fixtures').toEqual(
        expect.arrayContaining([expiredId, nullExpiryId]),
      )
      expect(manualRows, 'source=manual should exclude order-sourced fixtures').not.toContain(inside30Id)
      expect(manualRows, 'source=manual should exclude third_party fixtures').not.toContain(outside30Id)

      const expiredRows = registrationIds(
        await listWarrantyRegistrations(request, adminToken, `expiry=expired&${search}`),
      )
      expect(expiredRows, 'expiry=expired should include the past-expiry fixture').toContain(expiredId)
      expect(expiredRows, 'expiry=expired should exclude future expiries').not.toContain(inside30Id)
      expect(expiredRows).not.toContain(outside30Id)
      expect(expiredRows, 'expiry=expired should exclude null-expiry rows').not.toContain(nullExpiryId)

      const expiringRows = registrationIds(
        await listWarrantyRegistrations(request, adminToken, `expiry=expiring_30d&${search}`),
      )
      expect(expiringRows, 'expiry=expiring_30d should include the just-inside-30d fixture').toContain(inside30Id)
      expect(expiringRows, 'expiry=expiring_30d should exclude the just-outside-30d fixture').not.toContain(outside30Id)
      expect(expiringRows, 'expiry=expiring_30d should exclude expired fixtures').not.toContain(expiredId)
      expect(expiringRows, 'expiry=expiring_30d should exclude null-expiry rows').not.toContain(nullExpiryId)

      const activeRows = registrationIds(
        await listWarrantyRegistrations(request, adminToken, `expiry=active&${search}`),
      )
      expect(activeRows, 'expiry=active should include future expiries').toEqual(
        expect.arrayContaining([inside30Id, outside30Id]),
      )
      expect(activeRows, 'expiry=active should exclude expired fixtures').not.toContain(expiredId)
      expect(activeRows, 'expiry=active should exclude null-expiry rows').not.toContain(nullExpiryId)
    } finally {
      await deleteWarrantyRegistrationIfExists(request, adminToken, expiredId)
      await deleteWarrantyRegistrationIfExists(request, adminToken, inside30Id)
      await deleteWarrantyRegistrationIfExists(request, adminToken, outside30Id)
      await deleteWarrantyRegistrationIfExists(request, adminToken, nullExpiryId)
    }
  })

  test('filters vendor policies by isActive', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-029-vp')

    let activePolicyId: string | null = null
    let inactivePolicyId: string | null = null

    try {
      const activePolicy = await createWarrantyVendorPolicyFixture(request, adminToken, {
        vendorName: `QA WC Filters Active Vendor ${stamp}`,
        coverageMonths: 12,
        isActive: true,
      })
      activePolicyId = activePolicy.id
      expect(activePolicy.isActive, 'active fixture should persist isActive=true').toBe(true)

      const inactivePolicy = await createWarrantyVendorPolicyFixture(request, adminToken, {
        vendorName: `QA WC Filters Inactive Vendor ${stamp}`,
        coverageMonths: 6,
        isActive: false,
      })
      inactivePolicyId = inactivePolicy.id
      expect(inactivePolicy.isActive, 'inactive fixture should persist isActive=false').toBe(false)

      const search = `search=${encodeURIComponent(stamp)}&pageSize=100`

      const inactiveRows = policyIds(
        await listWarrantyVendorPolicies(request, adminToken, `isActive=false&${search}`),
      )
      expect(inactiveRows, 'isActive=false should include the inactive policy').toContain(inactivePolicyId)
      expect(inactiveRows, 'isActive=false should exclude the active policy').not.toContain(activePolicyId)

      const activeRows = policyIds(
        await listWarrantyVendorPolicies(request, adminToken, `isActive=true&${search}`),
      )
      expect(activeRows, 'isActive=true should include the active policy').toContain(activePolicyId)
      expect(activeRows, 'isActive=true should exclude the inactive policy').not.toContain(inactivePolicyId)

      const allRows = policyIds(await listWarrantyVendorPolicies(request, adminToken, search))
      expect(allRows, 'the unfiltered list should include both fixtures').toEqual(
        expect.arrayContaining([activePolicyId, inactivePolicyId]),
      )
    } finally {
      await deleteWarrantyVendorPolicyIfExists(request, adminToken, activePolicyId)
      await deleteWarrantyVendorPolicyIfExists(request, adminToken, inactivePolicyId)
    }
  })

  test('filters troubleshooting guides by claimType and isActive', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-029-tg')

    let warrantyActiveId: string | null = null
    let warrantyInactiveId: string | null = null
    let returnActiveId: string | null = null

    try {
      warrantyActiveId = await createGuide(request, adminToken, {
        claimType: 'warranty',
        title: `QA WC Filters Guide Warranty Active ${stamp}`,
        isActive: true,
      })
      warrantyInactiveId = await createGuide(request, adminToken, {
        claimType: 'warranty',
        title: `QA WC Filters Guide Warranty Inactive ${stamp}`,
        isActive: false,
      })
      returnActiveId = await createGuide(request, adminToken, {
        claimType: 'return',
        title: `QA WC Filters Guide Return Active ${stamp}`,
        isActive: true,
      })

      const search = `search=${encodeURIComponent(stamp)}&pageSize=100`

      const warrantyRows = (await listGuides(request, adminToken, `claimType=warranty&${search}`)).map((item) => item.id)
      expect(warrantyRows, 'claimType=warranty should include both warranty guides').toEqual(
        expect.arrayContaining([warrantyActiveId, warrantyInactiveId]),
      )
      expect(warrantyRows, 'claimType=warranty should exclude the return guide').not.toContain(returnActiveId)

      const inactiveRows = (await listGuides(request, adminToken, `isActive=false&${search}`)).map((item) => item.id)
      expect(inactiveRows, 'isActive=false should include the inactive guide').toContain(warrantyInactiveId)
      expect(inactiveRows, 'isActive=false should exclude active guides').not.toContain(warrantyActiveId)
      expect(inactiveRows).not.toContain(returnActiveId)

      const combinedRows = (
        await listGuides(request, adminToken, `claimType=warranty&isActive=true&${search}`)
      ).map((item) => item.id)
      expect(combinedRows, 'combined filters should include the active warranty guide').toContain(warrantyActiveId)
      expect(combinedRows, 'combined filters should exclude the inactive warranty guide').not.toContain(warrantyInactiveId)
      expect(combinedRows, 'combined filters should exclude the return guide').not.toContain(returnActiveId)
    } finally {
      await deleteGuideIfExists(request, adminToken, warrantyActiveId)
      await deleteGuideIfExists(request, adminToken, warrantyInactiveId)
      await deleteGuideIfExists(request, adminToken, returnActiveId)
    }
  })
})
