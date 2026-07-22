import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>

const ENABLED_AT_SKEW_MS = 10_000

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

async function pickIntegrationId(request: APIRequestContext, token: string): Promise<string | null> {
  const listResponse = await apiRequest(request, 'GET', '/api/integrations', { token })
  if (listResponse.status() !== 200) return null
  const body = await readJson(listResponse)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items.length > 0 ? String(items[0].id) : null
}

async function readState(request: APIRequestContext, token: string, integrationId: string): Promise<JsonRecord> {
  const detail = await readJson(await apiRequest(request, 'GET', `/api/integrations/${integrationId}`, { token }))
  return detail.state && typeof detail.state === 'object' ? (detail.state as JsonRecord) : {}
}

/**
 * TC-INT-005: Integration state mutation validation and enabledAt timestamp [P0]
 *
 * Surface: PUT /api/integrations/:id/state (requires integrations.manage)
 *
 * updateStateSchema requires at least one of isEnabled/reauthRequired. The state
 * service stamps enabledAt only on a false->true transition and leaves it intact
 * when other fields change. enabledAt is not echoed by the PUT response, so it is
 * verified via the detail GET.
 */
test.describe('TC-INT-005: Integration state mutation validation', () => {
  test('rejects empty and mistyped state payloads', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const integrationId = await pickIntegrationId(request, token)
    if (!integrationId) {
      test.skip(true, 'No integration provider modules registered — skipping state validation')
      return
    }
    const path = `/api/integrations/${integrationId}/state`

    // Empty payload — refine fails because no state field was provided => 422.
    const empty = await apiRequest(request, 'PUT', path, { token, data: {} })
    expect(empty.status(), 'empty state payload should be rejected').toBe(422)
    expect(JSON.stringify(await readJson(empty))).toContain('At least one')

    // isEnabled must be a boolean — a string fails type validation => 422.
    const mistyped = await apiRequest(request, 'PUT', path, { token, data: { isEnabled: 'true' } })
    expect(mistyped.status(), 'non-boolean isEnabled should be rejected').toBe(422)
  })

  test('stamps enabledAt on a disabled->enabled transition and preserves it otherwise', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const integrationId = await pickIntegrationId(request, token)
    if (!integrationId) {
      test.skip(true, 'No integration provider modules registered — skipping enabledAt checks')
      return
    }
    const path = `/api/integrations/${integrationId}/state`
    const initialState = await readState(request, token, integrationId)
    const originalIsEnabled = typeof initialState.isEnabled === 'boolean' ? initialState.isEnabled : false
    const originalReauthRequired = typeof initialState.reauthRequired === 'boolean' ? initialState.reauthRequired : false

    try {
      // Establish a disabled baseline so the next enable is a genuine transition.
      const disable = await apiRequest(request, 'PUT', path, { token, data: { isEnabled: false, reauthRequired: false } })
      expect(disable.status()).toBe(200)

      const beforeEnableMs = Date.now()
      const enable = await apiRequest(request, 'PUT', path, { token, data: { isEnabled: true } })
      expect(enable.status()).toBe(200)
      expect((await readJson(enable)).isEnabled).toBe(true)
      const afterEnableMs = Date.now()

      const enabledState = await readState(request, token, integrationId)
      expect(typeof enabledState.enabledAt, 'enabledAt should be set on enable').toBe('string')
      const enabledAtMs = new Date(String(enabledState.enabledAt)).getTime()
      expect(enabledAtMs).toBeGreaterThanOrEqual(beforeEnableMs - ENABLED_AT_SKEW_MS)
      expect(enabledAtMs).toBeLessThanOrEqual(afterEnableMs + ENABLED_AT_SKEW_MS)

      // Changing only reauthRequired must NOT move enabledAt.
      const reauth = await apiRequest(request, 'PUT', path, { token, data: { reauthRequired: true } })
      expect(reauth.status()).toBe(200)
      const reauthState = await readState(request, token, integrationId)
      expect(reauthState.reauthRequired).toBe(true)
      expect(reauthState.enabledAt, 'enabledAt should be unchanged when only reauthRequired changes').toBe(
        enabledState.enabledAt,
      )

      // State persists across both detail and list reads.
      const listBody = await readJson(await apiRequest(request, 'GET', '/api/integrations?pageSize=100', { token }))
      const listItems = Array.isArray(listBody.items) ? (listBody.items as JsonRecord[]) : []
      const listed = listItems.find((item) => String(item.id) === integrationId)
      expect(listed?.isEnabled, 'enabled state should be reflected in the list endpoint').toBe(true)
    } finally {
      await apiRequest(request, 'PUT', path, {
        token,
        data: { isEnabled: originalIsEnabled, reauthRequired: originalReauthRequired },
      }).catch(() => undefined)
    }
  })
})
