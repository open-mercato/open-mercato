import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import {
  changeOverrideState,
  createTenantFixture,
  deleteTenantIfExists,
  rawApiRequest,
  tenantScopeCookie,
  uniqueToggleIdentifier,
} from './featureToggleTestHelpers'

test.describe('TC-FT-006: Override API authorization and tenant isolation', () => {
  test('scopes override reads and writes to the selected tenant', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const { tenantId: tenantAId } = getTokenContext(adminToken)
    const stamp = Date.now()
    const identifier = uniqueToggleIdentifier('qa_isolation')
    let tenantBId: string | null = null
    let toggleId: string | null = null

    try {
      tenantBId = await createTenantFixture(request, superadminToken, `QA FT 006 Tenant B ${stamp}`)
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier,
        name: 'QA Isolation Toggle',
        type: 'boolean',
        defaultValue: true,
      })

      const tenantAUpdateResponse = await changeOverrideState(request, adminToken, {
        toggleId,
        isOverride: true,
        overrideValue: false,
      })
      expect(tenantAUpdateResponse.status()).toBe(200)

      const tenantAListResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/overrides?identifier=${encodeURIComponent(identifier)}`,
        { token: adminToken },
      )
      expect(tenantAListResponse.status()).toBe(200)
      const tenantAList = await readJsonSafe<{ items?: Array<{ toggleId?: string; tenantId?: string; isOverride?: boolean }> }>(
        tenantAListResponse,
      )
      expect(tenantAList?.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toggleId, tenantId: tenantAId, isOverride: true }),
        ]),
      )

      const employeeUpdateResponse = await changeOverrideState(request, employeeToken, {
        toggleId,
        isOverride: true,
        overrideValue: true,
      })
      expect(employeeUpdateResponse.status()).toBe(403)

      const missingToggleResponse = await changeOverrideState(request, adminToken, {
        toggleId: '00000000-0000-4000-8000-000000000000',
        isOverride: true,
        overrideValue: true,
      })
      expect(missingToggleResponse.status()).toBe(404)

      const tenantBCookie = tenantScopeCookie(tenantBId)
      const tenantBUpdateResponse = await changeOverrideState(request, superadminToken, {
        toggleId,
        isOverride: true,
        overrideValue: true,
        cookie: tenantBCookie,
      })
      expect(tenantBUpdateResponse.status()).toBe(200)

      const tenantBListResponse = await rawApiRequest(
        request,
        'GET',
        `/api/feature_toggles/overrides?identifier=${encodeURIComponent(identifier)}`,
        { token: superadminToken, cookie: tenantBCookie },
      )
      expect(tenantBListResponse.status()).toBe(200)
      const tenantBList = await readJsonSafe<{ items?: Array<{ toggleId?: string; tenantId?: string; isOverride?: boolean }> }>(
        tenantBListResponse,
      )
      expect(tenantBList?.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toggleId, tenantId: tenantBId, isOverride: true }),
        ]),
      )
      expect(tenantBList?.items?.some((item) => item.tenantId === tenantAId)).toBe(false)

      const tenantADetailResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(toggleId)}/override`,
        { token: adminToken },
      )
      expect(tenantADetailResponse.status()).toBe(200)
      const tenantADetail = await readJsonSafe<{ value?: boolean; tenantId?: string }>(tenantADetailResponse)
      expect(tenantADetail?.tenantId).toBe(tenantAId)
      expect(tenantADetail?.value).toBe(false)

      const tenantBDetailResponse = await rawApiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(toggleId)}/override`,
        { token: superadminToken, cookie: tenantBCookie },
      )
      expect(tenantBDetailResponse.status()).toBe(200)
      const tenantBDetail = await readJsonSafe<{ value?: boolean; tenantId?: string }>(tenantBDetailResponse)
      expect(tenantBDetail?.tenantId).toBe(tenantBId)
      expect(tenantBDetail?.value).toBe(true)

      await changeOverrideState(request, superadminToken, {
        toggleId,
        isOverride: false,
        cookie: tenantBCookie,
      })
      await changeOverrideState(request, adminToken, {
        toggleId,
        isOverride: false,
      })
    } finally {
      await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
      await deleteTenantIfExists(request, superadminToken, tenantBId)
    }
  })
})
