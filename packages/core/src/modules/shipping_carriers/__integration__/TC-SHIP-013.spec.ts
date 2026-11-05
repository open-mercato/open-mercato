import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-SHIP-013: Drop-off points search (happy path).
 *
 * GET /api/shipping-carriers/points returns `{ points: DropOffPoint[] }` for a
 * provider whose adapter implements `searchDropOffPoints`. The mock_carrier
 * adapter implements it, so the endpoint returns 200 with an array of points,
 * each carrying a stable identifier and location fields.
 */
type DropOffPoint = {
  id?: string
  name?: string
  type?: string
  city?: string
  postalCode?: string
  street?: string
}

test.describe('TC-SHIP-013: Drop-off points search returns 200 with a points array', () => {
  test('should return a points array for the mock_carrier provider', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(
      request,
      'GET',
      '/api/shipping-carriers/points?providerKey=mock_carrier&query=locker&postCode=10001',
      { token },
    )
    expect(response.status(), 'points search should return 200').toBe(200)

    const body = await readJsonSafe<{ points?: DropOffPoint[]; error?: string }>(response)
    expect(body?.error, 'happy-path points search should not carry an error').toBeFalsy()
    expect(Array.isArray(body?.points), 'response.points should be an array').toBe(true)
    expect((body?.points ?? []).length, 'mock_carrier should return at least one point').toBeGreaterThan(0)

    const firstPoint = (body?.points ?? [])[0]
    expect(firstPoint?.id, 'each point should carry an identifier').toBeTruthy()
    expect(firstPoint?.name, 'each point should carry a name').toBeTruthy()
    expect(firstPoint?.city, 'each point should carry a city').toBeTruthy()
    expect(firstPoint?.postalCode, 'each point should carry a postal code').toBeTruthy()
  })
})
