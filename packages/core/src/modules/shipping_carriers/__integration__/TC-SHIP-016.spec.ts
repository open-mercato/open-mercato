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
import { createShipment, getTracking } from './helpers/fixtures'
import {
  setCarrierShipmentStatusInDb,
  getCarrierShipmentRowFromDb,
  deleteCarrierShipmentInDb,
} from './helpers/db'

/**
 * TC-SHIP-016: Tracking reads do not mutate; refresh is a guarded write (issue #3295).
 *
 * `GET /api/shipping-carriers/tracking` previously persisted shipment status,
 * tracking events, and `last_polled_at` inside a read request, violating GET
 * semantics and skipping the write-path guard and status events. The fix makes
 * the GET read-only and moves persistence behind `POST /tracking/refresh`
 * (`shipping_carriers.manage`), which validates the transition and emits events.
 *
 * Non-`label_created` states are only reachable via async carrier events, so the
 * fixture sets `carrier_shipments.unified_status` directly to keep the test
 * deterministic.
 *
 * ENVIRONMENT: mixes API fixtures with DB-level fixtures (raw `pg` against
 * `DATABASE_URL`). Run under a coherent app+DB stack (the `yarn test:integration`
 * / `yarn test:integration:ephemeral` harness) where the app server and these
 * fixtures share the same database.
 */
test.describe('TC-SHIP-016: tracking GET is read-only; refresh is a guarded write', () => {
  test('GET tracking does not persist status or polling metadata', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    let shipmentId: string | null = null
    try {
      const shipment = await createShipment(request, token, { providerKey: 'mock_carrier' })
      shipmentId = shipment.shipmentId

      // Simulate a shipment that already advanced to in_transit via async events.
      await setCarrierShipmentStatusInDb(shipmentId, 'in_transit')

      const tracking = await getTracking(request, token, {
        providerKey: 'mock_carrier',
        shipmentId,
      })
      expect(tracking.status, 'GET still returns provider tracking data').toBeTruthy()

      const row = await getCarrierShipmentRowFromDb(shipmentId)
      expect(row?.unifiedStatus, 'GET must not overwrite the persisted status').toBe('in_transit')
      expect(row?.lastPolledAt, 'GET must not stamp last_polled_at').toBeNull()
    } finally {
      await deleteCarrierShipmentInDb(shipmentId).catch(() => undefined)
    }
  })

  test('POST /tracking/refresh persists polling metadata', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    let shipmentId: string | null = null
    try {
      const shipment = await createShipment(request, token, { providerKey: 'mock_carrier' })
      shipmentId = shipment.shipmentId

      const before = await getCarrierShipmentRowFromDb(shipmentId)
      expect(before?.lastPolledAt, 'a freshly created shipment has never been polled').toBeNull()

      const response = await apiRequest(request, 'POST', '/api/shipping-carriers/tracking/refresh', {
        token,
        data: { providerKey: 'mock_carrier', shipmentId },
      })
      expect(response.status(), 'refresh succeeds for a manage user').toBe(200)
      const body = await readJsonSafe<{ status?: string; trackingNumber?: string }>(response)
      expect(body?.status, 'refresh returns provider tracking data').toBeTruthy()

      const after = await getCarrierShipmentRowFromDb(shipmentId)
      expect(after?.lastPolledAt, 'refresh persists last_polled_at').not.toBeNull()
    } finally {
      await deleteCarrierShipmentInDb(shipmentId).catch(() => undefined)
    }
  })

  test('POST /tracking/refresh requires shipping_carriers.manage', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Secret123!'
    const userEmail = `tc-ship-016-${stamp}@example.com`

    let adminToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let shipmentId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const { organizationId, tenantId } = getTokenScope(adminToken)
      expect(organizationId, 'admin token should carry an organization id').toBeTruthy()
      expect(tenantId, 'admin token should carry a tenant id').toBeTruthy()

      const shipment = await createShipment(request, adminToken, { providerKey: 'mock_carrier' })
      shipmentId = shipment.shipmentId

      roleId = await createRoleFixture(request, adminToken, { name: `TC-SHIP-016 View-Only Role ${stamp}` })
      userId = await createUserFixture(request, adminToken, {
        email: userEmail,
        password,
        organizationId,
        roles: [roleId],
      })
      await setUserAclVisibility(request, adminToken, {
        userId,
        features: ['shipping_carriers.view'],
        organizations: null,
      })

      const userToken = await getAuthToken(request, userEmail, password)

      const refreshResponse = await apiRequest(request, 'POST', '/api/shipping-carriers/tracking/refresh', {
        token: userToken,
        data: { providerKey: 'mock_carrier', shipmentId },
      })
      expect(refreshResponse.status(), 'refresh must be forbidden without shipping_carriers.manage').toBe(403)
      const refreshBody = await readJsonSafe<{ requiredFeatures?: string[] }>(refreshResponse)
      expect(
        refreshBody?.requiredFeatures,
        'forbidden response should name the missing feature',
      ).toContain('shipping_carriers.manage')

      // The denial happens at the feature gate, before any persistence.
      const row = await getCarrierShipmentRowFromDb(shipmentId)
      expect(row?.lastPolledAt, 'a forbidden refresh must not persist polling metadata').toBeNull()
    } finally {
      await deleteUserAclInDb(userId ?? '').catch(() => undefined)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteCarrierShipmentInDb(shipmentId).catch(() => undefined)
    }
  })
})
