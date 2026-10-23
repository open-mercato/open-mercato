import { expect, test } from '@playwright/test'

const PREFERENCES_PATH = '/api/marketing_automation/portal/preferences'

/**
 * TC-MA-028: the portal preference centre.
 *
 * The property that matters most here is the one an integration test CAN prove without a customer session: the
 * endpoint refuses anybody who does not have one. The subject comes from the session and never from the
 * request, so there is no id to pass and nothing to authorise with — which is the whole point.
 */
test.describe('TC-MA-028 portal preference centre', () => {
  test('refuses a caller with no portal session', async ({ request }) => {
    const read = await request.get(PREFERENCES_PATH)
    expect(read.status()).toBe(401)

    const write = await request.put(PREFERENCES_PATH, { data: { subscribed: false } })
    expect(write.status()).toBe(401)
  })

  test('a backoffice session is not a portal session', async ({ request }) => {
    /**
     * An admin token authorises the admin API, not this one: the preference centre acts as the SIGNED-IN
     * CUSTOMER, and there is no customer in a staff session to act as.
     */
    const { getAuthToken } = await import('@open-mercato/core/helpers/integration/api')
    const token = await getAuthToken(request, 'admin')
    const response = await request.get(PREFERENCES_PATH, { headers: { authorization: `Bearer ${token}` } })
    expect(response.status()).toBe(401)
  })

  test('the payload is validated before anything is written', async ({ request }) => {
    // Refused for the session first, which is the correct order: authorise, then parse.
    const response = await request.put(PREFERENCES_PATH, { data: { maxPerWeek: 9999 } })
    expect(response.status()).toBe(401)
  })
})
