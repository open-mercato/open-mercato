import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

const TYPES_PATH = '/api/notifications/types'
const PREFERENCES_PATH = '/api/notifications/preferences'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

// A built-in type no other integration spec mutates or delivers against.
const TARGET_TYPE = 'business_rules.rule.execution_failed'

type NotificationTypeItem = {
  id: string
  labelKey: string
  nonOptOut: boolean
  channels: string[] | null
  storedChannels: string[] | null
  storedNonOptOut: boolean | null
  updatedAt: string | null
}
type TypesResponse = { items: NotificationTypeItem[] }
type PatchResponse = { ok?: boolean; item?: NotificationTypeItem; error?: string }
type PreferenceItem = { notificationTypeId: string; channel: string; enabled: boolean }
type PreferencesResponse = { items: PreferenceItem[] }

async function getTypeItem(request: APIRequestContext, token: string, typeId: string): Promise<NotificationTypeItem> {
  const res = await apiRequest(request, 'GET', TYPES_PATH, { token })
  expect(res.status()).toBe(200)
  const json = await readJsonSafe<TypesResponse>(res)
  const item = (json?.items ?? []).find((entry) => entry.id === typeId)
  expect(item, `type ${typeId} missing from the catalogue`).toBeTruthy()
  return item!
}

async function patchType(
  request: APIRequestContext,
  token: string,
  data: { id: string; channels?: string[] | null; nonOptOut?: boolean | null },
  headers?: Record<string, string>,
) {
  return apiRequest(request, 'PATCH', TYPES_PATH, { token, data, headers })
}

async function clearOverride(request: APIRequestContext, token: string, typeId: string): Promise<void> {
  const res = await patchType(request, token, { id: typeId, channels: null, nonOptOut: null })
  expect(res.status()).toBe(200)
}

test.describe('TC-NOTIF-015: tenant-scoped notification type overrides (PATCH /api/notifications/types)', () => {
  test('admin overrides a type\'s channels, GET reflects it, clearing restores the code-declared set', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const baseline = await getTypeItem(request, adminToken, TARGET_TYPE)
    expect(baseline.storedChannels).toBeNull()
    // Built-in catalogue ships without push (code-declared eligibility).
    expect(baseline.channels).toEqual(['in_app', 'email'])
    expect(baseline.updatedAt).toBeNull()

    try {
      const patchRes = await patchType(request, adminToken, {
        id: TARGET_TYPE,
        channels: ['in_app', 'email', 'push'],
      })
      expect(patchRes.status()).toBe(200)
      const patched = await readJsonSafe<PatchResponse>(patchRes)
      expect(patched?.ok).toBe(true)
      expect(patched?.item?.channels).toEqual(['in_app', 'email', 'push'])
      expect(patched?.item?.storedChannels).toEqual(['in_app', 'email', 'push'])

      const afterPatch = await getTypeItem(request, adminToken, TARGET_TYPE)
      expect(afterPatch.channels).toEqual(['in_app', 'email', 'push'])
      expect(afterPatch.storedChannels).toEqual(['in_app', 'email', 'push'])
      expect(typeof afterPatch.updatedAt).toBe('string')

      await clearOverride(request, adminToken, TARGET_TYPE)
      const afterClear = await getTypeItem(request, adminToken, TARGET_TYPE)
      expect(afterClear.channels).toEqual(['in_app', 'email'])
      expect(afterClear.storedChannels).toBeNull()
      expect(afterClear.updatedAt).toBeNull()
    } finally {
      await clearOverride(request, adminToken, TARGET_TYPE)
    }
  })

  test('a stale optimistic-lock header 409s instead of clobbering the newer override', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    try {
      const first = await patchType(request, adminToken, { id: TARGET_TYPE, channels: ['in_app'] })
      expect(first.status()).toBe(200)
      const saved = await readJsonSafe<PatchResponse>(first)
      const version = saved?.item?.updatedAt
      expect(typeof version).toBe('string')

      const stale = await patchType(
        request,
        adminToken,
        { id: TARGET_TYPE, channels: ['in_app', 'email'] },
        { [LOCK_HEADER]: '2020-01-01T00:00:00.000Z' },
      )
      expect(stale.status()).toBe(409)

      // The stored override is untouched by the rejected write.
      const current = await getTypeItem(request, adminToken, TARGET_TYPE)
      expect(current.storedChannels).toEqual(['in_app'])

      // The matching version goes through.
      const fresh = await patchType(
        request,
        adminToken,
        { id: TARGET_TYPE, channels: ['in_app', 'email'] },
        { [LOCK_HEADER]: version! },
      )
      expect(fresh.status()).toBe(200)
    } finally {
      await clearOverride(request, adminToken, TARGET_TYPE)
    }
  })

  test('requires notifications.manage (employee is blocked) and 404s an unknown type', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')
    const blocked = await patchType(request, employeeToken, { id: TARGET_TYPE, channels: ['in_app'] })
    expect([401, 403]).toContain(blocked.status())

    const adminToken = await getAuthToken(request, 'admin')
    const missing = await patchType(request, adminToken, { id: 'qa.notif.no-such-type', channels: ['in_app'] })
    expect(missing.status()).toBe(404)

    const invalid = await apiRequest(request, 'PATCH', TYPES_PATH, { token: adminToken, data: { id: TARGET_TYPE } })
    expect(invalid.status()).toBe(400)
  })

  test('preference writes for a channel outside the override are dropped server-side', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    try {
      const res = await patchType(request, adminToken, { id: TARGET_TYPE, channels: ['in_app', 'email'] })
      expect(res.status()).toBe(200)

      // Opting out of an ineligible channel is silently dropped (the cell is locked in the UI).
      const dropWrite = await apiRequest(request, 'PUT', PREFERENCES_PATH, {
        token: employeeToken,
        data: { preferences: [{ notificationTypeId: TARGET_TYPE, channel: 'push', enabled: false }] },
      })
      expect(dropWrite.status()).toBe(200)
      const afterDrop = await apiRequest(request, 'GET', PREFERENCES_PATH, { token: employeeToken })
      const droppedRows = ((await readJsonSafe<PreferencesResponse>(afterDrop))?.items ?? []).filter(
        (row) => row.notificationTypeId === TARGET_TYPE && row.channel === 'push',
      )
      expect(droppedRows).toHaveLength(0)

      // Channels inside the override still persist normally.
      const keptWrite = await apiRequest(request, 'PUT', PREFERENCES_PATH, {
        token: employeeToken,
        data: { preferences: [{ notificationTypeId: TARGET_TYPE, channel: 'email', enabled: false }] },
      })
      expect(keptWrite.status()).toBe(200)
      const afterKeep = await apiRequest(request, 'GET', PREFERENCES_PATH, { token: employeeToken })
      const keptRows = ((await readJsonSafe<PreferencesResponse>(afterKeep))?.items ?? []).filter(
        (row) => row.notificationTypeId === TARGET_TYPE && row.channel === 'email',
      )
      expect(keptRows).toHaveLength(1)
      expect(keptRows[0]?.enabled).toBe(false)
    } finally {
      // Restore: re-enable the email preference and drop the override.
      await apiRequest(request, 'PUT', PREFERENCES_PATH, {
        token: employeeToken,
        data: { preferences: [{ notificationTypeId: TARGET_TYPE, channel: 'email', enabled: true }] },
      })
      await clearOverride(request, adminToken, TARGET_TYPE)
    }
  })
})
