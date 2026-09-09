import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

// TC-DEV-007: response casing. Every other module serializes its API responses in camelCase, and the
// devices routes used to return the raw database column names instead (#5513). These tests pin the
// camelCase contract on both list routes and the admin detail route, and pin the deprecated
// snake_case aliases that stay alongside for one minor version so their removal is a deliberate,
// test-visible change.

type RegisterResult = { id: string; deviceId: string; revived: boolean }
type DeviceItem = Record<string, unknown>
type DeviceListResponse = { items: DeviceItem[]; total?: number }

const SELF_PATH = '/api/devices'
const ADMIN_PATH = '/api/devices/admin/devices'

const CAMEL_LIST_KEYS = [
  'tenantId',
  'userId',
  'deviceId',
  'clientAppVersion',
  'osVersion',
  'pushProvider',
  'pushTokenUpdatedAt',
  'lastSeenAt',
  'createdAt',
  'updatedAt',
] as const

const DEPRECATED_ALIASES: Array<[string, string]> = [
  ['user_id', 'userId'],
  ['device_id', 'deviceId'],
  ['client_app_version', 'clientAppVersion'],
  ['os_version', 'osVersion'],
  ['push_provider', 'pushProvider'],
  ['push_token_updated_at', 'pushTokenUpdatedAt'],
  ['last_seen_at', 'lastSeenAt'],
  ['created_at', 'createdAt'],
  ['updated_at', 'updatedAt'],
]

let deviceCounter = 0
function uniqueDeviceId(prefix: string): string {
  deviceCounter += 1
  return `${prefix}-${Date.now()}-${deviceCounter}`
}

// The list APIs read from the eventually-consistent query index, so poll until the row shows up.
async function waitForItem(
  fetcher: () => Promise<DeviceItem[]>,
  predicate: (items: DeviceItem[]) => boolean,
): Promise<DeviceItem[]> {
  let latest: DeviceItem[] = []
  await expect
    .poll(async () => {
      latest = await fetcher()
      return predicate(latest)
    }, { timeout: 15_000 })
    .toBe(true)
  return latest
}

async function listDevices(request: APIRequestContext, token: string, path: string, query = ''): Promise<DeviceItem[]> {
  const res = await apiRequest(request, 'GET', `${path}${query}`, { token })
  expect(res.status(), `${path} should return 200`).toBe(200)
  return (await readJsonSafe<DeviceListResponse>(res))?.items ?? []
}

test.describe('TC-DEV-007: device responses use the platform camelCase convention', () => {
  test('self list, admin list and admin detail all expose camelCase keys', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { userId } = getTokenScope(adminToken)
    const deviceId = uniqueDeviceId('qa-dev-007-casing')
    let createdId: string | null = null
    try {
      const register = await apiRequest(request, 'POST', SELF_PATH, {
        token: adminToken,
        data: { deviceId, platform: 'ios', clientAppVersion: '4.5.6', osVersion: 'iOS 18.2', pushProvider: 'apns', pushToken: 'tok-dev-007' },
      })
      expect(register.status()).toBe(201)
      createdId = (await readJsonSafe<RegisterResult>(register))?.id ?? null
      expect(createdId).toBeTruthy()

      const selfItems = await waitForItem(
        () => listDevices(request, adminToken, SELF_PATH),
        (items) => items.some((d) => d.id === createdId),
      )
      const selfRow = selfItems.find((d) => d.id === createdId)!
      for (const key of CAMEL_LIST_KEYS) {
        expect(selfRow, `self list item should carry ${key}`).toHaveProperty(key)
      }
      expect(selfRow.deviceId).toBe(deviceId)
      expect(selfRow.userId).toBe(userId)
      expect(selfRow.clientAppVersion).toBe('4.5.6')
      expect(selfRow.osVersion).toBe('iOS 18.2')
      expect(selfRow.pushProvider).toBe('apns')
      // push_token is a secret under either spelling.
      expect(selfRow.pushToken).toBeUndefined()
      expect(selfRow.push_token).toBeUndefined()

      const adminItems = await waitForItem(
        () => listDevices(request, adminToken, ADMIN_PATH, `?userId=${userId}`),
        (items) => items.some((d) => d.id === createdId),
      )
      const adminRow = adminItems.find((d) => d.id === createdId)!
      for (const key of CAMEL_LIST_KEYS) {
        expect(adminRow, `admin list item should carry ${key}`).toHaveProperty(key)
      }
      expect(adminRow.deviceId).toBe(deviceId)

      const detailRes = await apiRequest(request, 'GET', `${ADMIN_PATH}/${createdId}`, { token: adminToken })
      expect(detailRes.status()).toBe(200)
      const detail = (await readJsonSafe<{ item?: DeviceItem }>(detailRes))?.item
      expect(detail).toBeTruthy()
      expect(detail!.deviceId).toBe(deviceId)
      expect(detail!.userId).toBe(userId)
      expect(detail!.clientAppVersion).toBe('4.5.6')
      expect(detail!.osVersion).toBe('iOS 18.2')
      expect(detail!.pushProvider).toBe('apns')
      expect(detail!.updatedAt).toBeTruthy()
      expect(detail!.pushToken).toBeUndefined()
      expect(detail!.push_token).toBeUndefined()
    } finally {
      if (createdId) await apiRequest(request, 'DELETE', `${SELF_PATH}/${createdId}`, { token: adminToken }).catch(() => undefined)
    }
  })

  test('deprecated snake_case aliases still mirror their camelCase source', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { userId } = getTokenScope(adminToken)
    const deviceId = uniqueDeviceId('qa-dev-007-alias')
    let createdId: string | null = null
    try {
      const register = await apiRequest(request, 'POST', SELF_PATH, {
        token: adminToken,
        data: { deviceId, platform: 'android', clientAppVersion: '7.8.9', osVersion: 'Android 15', pushProvider: 'fcm' },
      })
      expect(register.status()).toBe(201)
      createdId = (await readJsonSafe<RegisterResult>(register))?.id ?? null
      expect(createdId).toBeTruthy()

      const items = await waitForItem(
        () => listDevices(request, adminToken, ADMIN_PATH, `?userId=${userId}`),
        (its) => its.some((d) => d.id === createdId),
      )
      const row = items.find((d) => d.id === createdId)!
      for (const [alias, canonical] of DEPRECATED_ALIASES) {
        expect(row[alias], `list alias ${alias} should mirror ${canonical}`).toBe(row[canonical])
      }

      const detailRes = await apiRequest(request, 'GET', `${ADMIN_PATH}/${createdId}`, { token: adminToken })
      expect(detailRes.status()).toBe(200)
      const detail = (await readJsonSafe<{ item?: DeviceItem }>(detailRes))?.item
      expect(detail).toBeTruthy()
      for (const [alias, canonical] of DEPRECATED_ALIASES) {
        expect(detail![alias], `detail alias ${alias} should mirror ${canonical}`).toBe(detail![canonical])
      }
    } finally {
      if (createdId) await apiRequest(request, 'DELETE', `${SELF_PATH}/${createdId}`, { token: adminToken }).catch(() => undefined)
    }
  })
})
