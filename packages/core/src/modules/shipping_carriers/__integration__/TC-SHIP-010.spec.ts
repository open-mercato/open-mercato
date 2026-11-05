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
import { defaultOrigin, defaultDestination, defaultPackage } from './helpers/fixtures'

/**
 * TC-SHIP-010: RBAC enforcement — `shipping_carriers.manage` is required to mutate.
 *
 * The write endpoints (`/rates`, `/shipments`, `/cancel`) declare
 * `requireFeatures: ['shipping_carriers.manage']`. A user granted only
 * `shipping_carriers.view` must receive 403 Forbidden on all three (no backend
 * mutation occurs — the feature gate runs before the handler), while still being
 * able to reach a `view`-gated endpoint. That positive control isolates the
 * denial to the missing `manage` feature rather than a broken token.
 *
 * ENVIRONMENT: mixes API fixtures with a DB-level ACL cleanup (raw `pg` against
 * `DATABASE_URL`). Run under a coherent app+DB stack (the
 * `yarn test:integration` / `yarn test:integration:ephemeral` harness).
 */
test.describe('TC-SHIP-010: RBAC — manage feature required for rates, shipments, cancel', () => {
  test('denies rates, shipments and cancel for a view-only user; still allows a view endpoint', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Secret123!'
    const userEmail = `tc-ship-010-${stamp}@example.com`

    let adminToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { organizationId, tenantId } = getTokenScope(adminToken)
      expect(organizationId, 'admin token should carry an organization id').toBeTruthy()
      expect(tenantId, 'admin token should carry a tenant id').toBeTruthy()

      roleId = await createRoleFixture(request, adminToken, { name: `TC-SHIP-010 View-Only Role ${stamp}` })
      userId = await createUserFixture(request, adminToken, {
        email: userEmail,
        password,
        organizationId,
        roles: [roleId],
      })
      // View but not manage; org visibility unrestricted so only the manage gate
      // can deny the write endpoints.
      await setUserAclVisibility(request, adminToken, {
        userId,
        features: ['shipping_carriers.view'],
        organizations: null,
      })

      const userToken = await getAuthToken(request, userEmail, password)

      // Positive control: the view feature lets the same user reach a view endpoint.
      const pointsResponse = await apiRequest(
        request,
        'GET',
        '/api/shipping-carriers/points?providerKey=mock_carrier&query=locker',
        { token: userToken },
      )
      expect(pointsResponse.status(), 'view-only user can reach a view-gated endpoint').toBe(200)

      const ratesResponse = await apiRequest(request, 'POST', '/api/shipping-carriers/rates', {
        token: userToken,
        data: {
          providerKey: 'mock_carrier',
          origin: defaultOrigin(),
          destination: defaultDestination(),
          packages: [defaultPackage()],
        },
      })
      expect(ratesResponse.status(), 'rates must be forbidden without shipping_carriers.manage').toBe(403)
      const ratesBody = await readJsonSafe<{ requiredFeatures?: string[] }>(ratesResponse)
      expect(
        ratesBody?.requiredFeatures,
        'forbidden response should name the missing feature',
      ).toContain('shipping_carriers.manage')

      const shipmentsResponse = await apiRequest(request, 'POST', '/api/shipping-carriers/shipments', {
        token: userToken,
        data: {
          providerKey: 'mock_carrier',
          orderId: crypto.randomUUID(),
          origin: defaultOrigin(),
          destination: defaultDestination(),
          packages: [defaultPackage()],
          serviceCode: 'standard',
        },
      })
      expect(shipmentsResponse.status(), 'shipments must be forbidden without shipping_carriers.manage').toBe(403)

      const cancelResponse = await apiRequest(request, 'POST', '/api/shipping-carriers/cancel', {
        token: userToken,
        data: {
          providerKey: 'mock_carrier',
          shipmentId: crypto.randomUUID(),
        },
      })
      expect(cancelResponse.status(), 'cancel must be forbidden without shipping_carriers.manage').toBe(403)
    } finally {
      await deleteUserAclInDb(userId ?? '').catch(() => undefined)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
