import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { deleteUserAclInDb } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createShipment } from './helpers/fixtures'

/**
 * TC-SHIP-009: RBAC enforcement — `shipping_carriers.view` is required to read.
 *
 * The read endpoints (`/tracking`, `/points`) declare
 * `requireFeatures: ['shipping_carriers.view']`. A logged-in user whose
 * effective features do NOT include it must receive 403 Forbidden (not 401, not
 * 502) — the feature gate runs in the catch-all API route before the handler,
 * so no adapter is ever invoked.
 *
 * ENVIRONMENT: mixes API fixtures (hit the app) with a DB-level ACL cleanup
 * (raw `pg` against `DATABASE_URL`). Run under a coherent app+DB stack (the
 * `yarn test:integration` / `yarn test:integration:ephemeral` harness).
 */
test.describe('TC-SHIP-009: RBAC — view feature required for tracking and points', () => {
  test('denies tracking and points for a user without shipping_carriers.view (403)', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Secret123!'
    const userEmail = `tc-ship-009-${stamp}@example.com`

    let adminToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { organizationId, tenantId } = getTokenScope(adminToken)
      expect(organizationId, 'admin token should carry an organization id').toBeTruthy()
      expect(tenantId, 'admin token should carry a tenant id').toBeTruthy()

      roleId = await createRoleFixture(request, adminToken, { name: `TC-SHIP-009 No-View Role ${stamp}` })
      userId = await createUserFixture(request, adminToken, {
        email: userEmail,
        password,
        organizationId,
        roles: [roleId],
      })
      // No shipping features at all; org visibility unrestricted so only the
      // feature gate can deny. Set via the ACL API so the RBAC cache is invalidated.
      await setUserAclVisibility(request, adminToken, {
        userId,
        features: [],
        organizations: null,
      })

      const userToken = await getAuthToken(request, userEmail, password)

      const trackingResponse = await apiRequest(
        request,
        'GET',
        `/api/shipping-carriers/tracking?providerKey=mock_carrier&shipmentId=${crypto.randomUUID()}`,
        { token: userToken },
      )
      expect(trackingResponse.status(), 'tracking must be forbidden without shipping_carriers.view').toBe(403)
      const trackingBody = await readJsonSafe<{ error?: string; requiredFeatures?: string[] }>(trackingResponse)
      expect(
        trackingBody?.requiredFeatures,
        'forbidden response should name the missing feature',
      ).toContain('shipping_carriers.view')

      const pointsResponse = await apiRequest(
        request,
        'GET',
        '/api/shipping-carriers/points?providerKey=mock_carrier&query=locker',
        { token: userToken },
      )
      expect(pointsResponse.status(), 'points must be forbidden without shipping_carriers.view').toBe(403)
    } finally {
      await deleteUserAclInDb(userId ?? '').catch(() => undefined)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('allows tracking and points for a privileged user (positive control, 200)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')

    const shipment = await createShipment(request, adminToken, { providerKey: 'mock_carrier' })

    const trackingResponse = await apiRequest(
      request,
      'GET',
      `/api/shipping-carriers/tracking?providerKey=mock_carrier&shipmentId=${shipment.shipmentId}`,
      { token: adminToken },
    )
    expect(trackingResponse.status(), 'admin (has view) can read tracking').toBe(200)

    const pointsResponse = await apiRequest(
      request,
      'GET',
      '/api/shipping-carriers/points?providerKey=mock_carrier&query=locker&postCode=10001',
      { token: adminToken },
    )
    expect(pointsResponse.status(), 'admin (has view) can search drop-off points').toBe(200)
  })
})
