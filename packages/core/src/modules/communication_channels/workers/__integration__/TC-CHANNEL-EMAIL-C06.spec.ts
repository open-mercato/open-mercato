import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-C06 — Push active flips polling cadence to 30 min
 *
 * Spec C § Phase C5 — when `adapter.registerPush(...)` returns
 * `status: 'active'`, `pushRegister` persists
 * `pollIntervalSeconds = recommendedPollIntervalSeconds` (1800 by
 * default for Gmail). The `me/channels` API exposes the
 * resulting `pollIntervalSeconds` so the operator UI can show the
 * polling-vs-push state.
 *
 * This smoke checks the surface: the `me/channels` endpoint exposes
 * `pollIntervalSeconds` + `pushStatus` fields in its serialized shape.
 * End-to-end (connect Gmail → registerPush succeeds → cadence flips →
 * verify next tick respects the new interval) is in the QA scenario
 * markdown `TC-CHANNEL-EMAIL-C06-push-cadence-flip.md`.
 */
test.describe('TC-CHANNEL-EMAIL-C06: Push-active cadence flip', () => {
  test('me/channels serializes pushStatus and pollIntervalSeconds', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/api/communication_channels/me/channels',
      { token },
    )
    expect(response.status()).toBe(200)
    const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
    expect(Array.isArray(body.items)).toBe(true)
    // Schema contract: even an empty list response must come back with
    // the documented shape. When channels exist, each row carries the
    // new fields (null for non-push providers / unregistered channels).
    for (const item of body.items ?? []) {
      expect(item).toHaveProperty('pushStatus')
      expect(item).toHaveProperty('pollIntervalSeconds')
    }
  })
})
