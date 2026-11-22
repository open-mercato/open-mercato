import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createTransportVehicleFixture,
  deleteFreightEntityIfExists,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['transport_operations'],
}

const POSITIONS = '/api/transport_operations/tracking/positions'
const TRACKING = '/api/transport_operations/tracking'
const ESTIMATE = '/api/transport_operations/tracking/estimate'
const VEHICLES = '/api/transport_operations/vehicles'

type PositionResponse = { ok: boolean; inserted: number; ids: string[] }
type TrackingResponse = {
  items: Array<{
    vehicleId: string
    plateNumber: string
    position: { latitude: number; longitude: number; speedKph: number | null } | null
  }>
}

/**
 * TC-TRANSPORT-014: a telematics position is stored, the tracking board exposes
 * the latest position for the vehicle, and the routing estimate returns a
 * distance/duration without requiring an external provider.
 */
test.describe('TC-TRANSPORT-014: live tracking positions', () => {
  test('records a position, reads it on the board, and estimates a route', async ({ request }) => {
    const token = await getAuthToken(request)
    let vehicle: string | null = null
    const positionIds: string[] = []

    try {
      vehicle = await createTransportVehicleFixture(request, token)
      const record = await apiRequest(request, 'POST', POSITIONS, {
        token,
        data: {
          vehicleId: vehicle,
          latitude: 24.7136,
          longitude: 46.6753,
          speedKph: 62,
          source: 'qa',
        },
        retryTransport: false,
      })
      const recorded = await readJsonSafe<PositionResponse>(record)
      expect(record.ok(), JSON.stringify(recorded)).toBeTruthy()
      expect(recorded?.inserted).toBe(1)
      expect(recorded?.ids).toHaveLength(1)
      positionIds.push(...(recorded?.ids ?? []))

      const board = await apiRequest(request, 'GET', TRACKING, { token })
      const payload = await readJsonSafe<TrackingResponse>(board)
      expect(board.ok(), JSON.stringify(payload)).toBeTruthy()
      const row = payload?.items.find((item) => item.vehicleId === vehicle)
      expect(row?.position).toMatchObject({ latitude: 24.7136, longitude: 46.6753 })
      expect(row?.position?.speedKph).toBe(62)

      const estimate = await apiRequest(request, 'POST', ESTIMATE, {
        token,
        data: {
          origin: { latitude: 24.7136, longitude: 46.6753 },
          destination: { latitude: 26.4207, longitude: 50.0888 },
        },
        retryTransport: false,
      })
      const estimateBody = await readJsonSafe<{
        distanceKm?: number
        durationMinutes?: number
        provider?: string
      }>(estimate)
      expect(estimate.ok(), JSON.stringify(estimateBody)).toBeTruthy()
      expect(estimateBody?.distanceKm).toBeGreaterThan(300)
      expect(estimateBody?.durationMinutes).toBeGreaterThan(0)
      expect(estimateBody?.provider).toBeTruthy()
    } finally {
      for (const id of positionIds) {
        await apiRequest(request, 'DELETE', `${POSITIONS}?id=${encodeURIComponent(id)}`, {
          token,
          retryTransport: false,
        }).catch(() => undefined)
      }
      await deleteFreightEntityIfExists(request, token, VEHICLES, vehicle)
    }
  })
})
