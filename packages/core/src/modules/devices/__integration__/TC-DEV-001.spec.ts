import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

type RegisterResult = { id: string; deviceId: string; revived: boolean }
type DeviceListItem = {
  id: string
  user_id: string
  device_id: string
  platform: string
  client_app_version?: string | null
  push_provider?: string | null
  push_token?: string | null
  push_token_updated_at?: string | null
  last_seen_at?: string | null
}
type DeviceListResponse = { items: DeviceListItem[]; total?: number }

let deviceCounter = 0
function uniqueDeviceId(): string {
  deviceCounter += 1
  return `qa-device-${Date.now()}-${deviceCounter}`
}

async function registerDevice(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: RegisterResult | null }> {
  const res = await apiRequest(request, 'POST', '/api/devices', { token, data: body })
  return { status: res.status(), json: await readJsonSafe<RegisterResult>(res) }
}

const SELF_PATH = '/api/devices'
const ADMIN_PATH = '/api/devices/admin/devices'

async function listDevices(
  request: APIRequestContext,
  token: string,
  query = '',
  basePath = SELF_PATH,
): Promise<DeviceListResponse> {
  const res = await apiRequest(request, 'GET', `${basePath}${query}`, { token })
  expect(res.status()).toBe(200)
  const json = await readJsonSafe<DeviceListResponse>(res)
  return json ?? { items: [] }
}

// The list API reads from the query index, which is eventually consistent: a row written by a
// preceding POST/PUT/DELETE may not be visible on the very next GET. Poll until the list reaches
// the expected state so the suite stays stable under parallel workers.
async function waitForDevices(
  request: APIRequestContext,
  token: string,
  predicate: (items: DeviceListItem[]) => boolean,
  query = '',
  basePath = SELF_PATH,
): Promise<DeviceListItem[]> {
  let latest: DeviceListItem[] = []
  await expect
    .poll(async () => {
      latest = (await listDevices(request, token, query, basePath)).items
      return predicate(latest)
    })
    .toBe(true)
  return latest
}

async function deleteDeviceIfExists(request: APIRequestContext, token: string, id: string | null): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', `/api/devices/${id}`, { token }).catch(() => undefined)
}

test.describe('TC-DEV-001: Devices module registry APIs', () => {
  test('registers, lists, and never exposes push_token', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const scope = getTokenScope(token)
    const deviceId = uniqueDeviceId()
    let createdId: string | null = null
    try {
      const created = await registerDevice(request, token, { deviceId, platform: 'ios' })
      expect(created.status).toBe(201)
      createdId = created.json?.id ?? null
      expect(createdId).toBeTruthy()
      expect(created.json?.revived).toBe(false)

      const items = await waitForDevices(request, token, (its) => its.some((d) => d.id === createdId))
      const found = items.find((d) => d.id === createdId)
      expect(found).toBeTruthy()
      expect(found?.user_id).toBe(scope.userId)
      expect(found?.device_id).toBe(deviceId)
      expect(found?.last_seen_at).toBeTruthy()
      // push_token is a secret and must never be returned by the list API.
      expect(found && 'push_token' in found).toBeFalsy()
    } finally {
      await deleteDeviceIfExists(request, token, createdId)
    }
  })

  test('upsert is idempotent on (user, deviceId)', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const deviceId = uniqueDeviceId()
    let createdId: string | null = null
    try {
      const first = await registerDevice(request, token, { deviceId, platform: 'android' })
      const second = await registerDevice(request, token, { deviceId, platform: 'android', clientAppVersion: '2.0.0' })
      createdId = first.json?.id ?? null
      expect(first.json?.id).toBe(second.json?.id)
      expect(second.json?.revived).toBe(false)

      const matches = await waitForDevices(
        request,
        token,
        (its) => its.filter((d) => d.device_id === deviceId).length === 1,
      )
      expect(matches.filter((d) => d.device_id === deviceId).length).toBe(1)
    } finally {
      await deleteDeviceIfExists(request, token, createdId)
    }
  })

  test('register with push token records push metadata without exposing the token', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const deviceId = uniqueDeviceId()
    let createdId: string | null = null
    try {
      const created = await registerDevice(request, token, {
        deviceId,
        platform: 'ios',
        pushToken: 'qa-secret-token-abcdef',
        pushProvider: 'apns',
      })
      expect(created.status).toBe(201)
      createdId = created.json?.id ?? null

      const items = await waitForDevices(request, token, (its) => its.some((d) => d.id === createdId))
      const found = items.find((d) => d.id === createdId)
      expect(found?.push_provider).toBe('apns')
      expect(found?.push_token_updated_at).toBeTruthy()
      expect(found && 'push_token' in found).toBeFalsy()
    } finally {
      await deleteDeviceIfExists(request, token, createdId)
    }
  })

  test('re-registering a soft-deleted device revives it (single active row)', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const deviceId = uniqueDeviceId()
    let activeId: string | null = null
    try {
      const created = await registerDevice(request, token, { deviceId, platform: 'web' })
      const firstId = created.json?.id ?? null
      expect(firstId).toBeTruthy()

      const del = await apiRequest(request, 'DELETE', `/api/devices/${firstId}`, { token })
      expect(del.status()).toBe(200)

      await waitForDevices(request, token, (its) => !its.some((d) => d.id === firstId))

      const revived = await registerDevice(request, token, { deviceId, platform: 'web' })
      expect(revived.status).toBe(201)
      expect(revived.json?.revived).toBe(true)
      activeId = revived.json?.id ?? null

      const matches = await waitForDevices(
        request,
        token,
        (its) => its.filter((d) => d.device_id === deviceId).length === 1,
      )
      expect(matches.filter((d) => d.device_id === deviceId).length).toBe(1)
    } finally {
      await deleteDeviceIfExists(request, token, activeId)
    }
  })

  test('non-admin list is scoped to the current user', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const adminDeviceId = uniqueDeviceId()
    const employeeDeviceId = uniqueDeviceId()
    let adminDevId: string | null = null
    let employeeDevId: string | null = null
    try {
      adminDevId = (await registerDevice(request, adminToken, { deviceId: adminDeviceId, platform: 'ios' })).json?.id ?? null
      employeeDevId = (await registerDevice(request, employeeToken, { deviceId: employeeDeviceId, platform: 'ios' })).json?.id ?? null

      const employeeList = await waitForDevices(
        request,
        employeeToken,
        (its) => its.some((d) => d.id === employeeDevId),
      )
      expect(employeeList.find((d) => d.id === employeeDevId)).toBeTruthy()
      // The employee must not see the admin's device (server-side user scoping, not index timing).
      expect(employeeList.find((d) => d.id === adminDevId)).toBeFalsy()
    } finally {
      await deleteDeviceIfExists(request, adminToken, adminDevId)
      await deleteDeviceIfExists(request, employeeToken, employeeDevId)
    }
  })

  test('devices.admin can list another user\'s devices via the admin endpoint', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const employeeScope = getTokenScope(employeeToken)
    const employeeDeviceId = uniqueDeviceId()
    let employeeDevId: string | null = null
    try {
      employeeDevId = (await registerDevice(request, employeeToken, { deviceId: employeeDeviceId, platform: 'android' })).json?.id ?? null

      const adminView = await waitForDevices(
        request,
        adminToken,
        (its) => its.some((d) => d.id === employeeDevId),
        `?userId=${employeeScope.userId}`,
        ADMIN_PATH,
      )
      expect(adminView.find((d) => d.id === employeeDevId)).toBeTruthy()
    } finally {
      await deleteDeviceIfExists(request, employeeToken, employeeDevId)
    }
  })

  test('self list does not honor ?userId (cross-user listing is admin-only)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const employeeScope = getTokenScope(employeeToken)
    const adminDeviceId = uniqueDeviceId()
    let adminDevId: string | null = null
    try {
      adminDevId = (await registerDevice(request, adminToken, { deviceId: adminDeviceId, platform: 'ios' })).json?.id ?? null
      // Admin asks the *self* endpoint for the employee's devices — it must ignore ?userId and return
      // only the admin's own devices.
      const selfView = await listDevices(request, adminToken, `?userId=${employeeScope.userId}`)
      expect(selfView.items.every((d) => d.user_id !== employeeScope.userId)).toBe(true)
    } finally {
      await deleteDeviceIfExists(request, adminToken, adminDevId)
    }
  })

  test('self list ignores raw user_id filter passthrough (scope is server-enforced)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const employeeScope = getTokenScope(employeeToken)
    const adminDeviceId = uniqueDeviceId()
    const employeeDeviceId = uniqueDeviceId()
    let adminDevId: string | null = null
    let employeeDevId: string | null = null
    try {
      adminDevId = (await registerDevice(request, adminToken, { deviceId: adminDeviceId, platform: 'ios' })).json?.id ?? null
      employeeDevId = (await registerDevice(request, employeeToken, { deviceId: employeeDeviceId, platform: 'ios' })).json?.id ?? null

      // The self list schema passes unknown query keys through; a raw snake_case `user_id` (the index
      // column name) must NOT override the server-enforced actor scoping and leak another user's row.
      await waitForDevices(request, adminToken, (its) => its.some((d) => d.id === adminDevId))
      const selfView = await listDevices(request, adminToken, `?user_id=${employeeScope.userId}`)
      expect(selfView.items.every((d) => d.user_id !== employeeScope.userId)).toBe(true)
      expect(selfView.items.find((d) => d.id === employeeDevId)).toBeFalsy()
    } finally {
      await deleteDeviceIfExists(request, adminToken, adminDevId)
      await deleteDeviceIfExists(request, employeeToken, employeeDevId)
    }
  })

  test('PUT updates metadata and clears a revoked push token', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const deviceId = uniqueDeviceId()
    let createdId: string | null = null
    try {
      const created = await registerDevice(request, token, {
        deviceId,
        platform: 'ios',
        pushToken: 'qa-token-to-revoke',
        pushProvider: 'apns',
      })
      createdId = created.json?.id ?? null

      const update = await apiRequest(request, 'PUT', `/api/devices/${createdId}`, {
        token,
        data: { clientAppVersion: '3.1.0', pushToken: null },
      })
      expect(update.status()).toBe(200)
      const updateJson = await readJsonSafe<{ ok: boolean; id: string }>(update)
      expect(updateJson?.ok).toBe(true)

      const items = await waitForDevices(request, token, (its) => its.some((d) => d.id === createdId))
      const found = items.find((d) => d.id === createdId)
      expect(found).toBeTruthy()
      // push_token_updated_at is bumped when the token field is touched (including clearing).
      expect(found?.push_token_updated_at).toBeTruthy()
    } finally {
      await deleteDeviceIfExists(request, token, createdId)
    }
  })

  test('PUT on another user\'s device is forbidden', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const adminDeviceId = uniqueDeviceId()
    let adminDevId: string | null = null
    try {
      adminDevId = (await registerDevice(request, adminToken, { deviceId: adminDeviceId, platform: 'ios' })).json?.id ?? null

      const res = await apiRequest(request, 'PUT', `/api/devices/${adminDevId}`, {
        token: employeeToken,
        data: { clientAppVersion: '9.9.9' },
      })
      expect(res.status()).toBe(403)
    } finally {
      await deleteDeviceIfExists(request, adminToken, adminDevId)
    }
  })

  test('DELETE soft-deletes the device for its owner', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const deviceId = uniqueDeviceId()
    let createdId: string | null = null
    try {
      createdId = (await registerDevice(request, token, { deviceId, platform: 'web' })).json?.id ?? null

      const del = await apiRequest(request, 'DELETE', `/api/devices/${createdId}`, { token })
      expect(del.status()).toBe(200)

      await waitForDevices(request, token, (its) => !its.some((d) => d.id === createdId))
      createdId = null
    } finally {
      await deleteDeviceIfExists(request, token, createdId)
    }
  })

  test('DELETE on another user\'s device is forbidden', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const adminDeviceId = uniqueDeviceId()
    let adminDevId: string | null = null
    try {
      adminDevId = (await registerDevice(request, adminToken, { deviceId: adminDeviceId, platform: 'ios' })).json?.id ?? null

      const res = await apiRequest(request, 'DELETE', `/api/devices/${adminDevId}`, { token: employeeToken })
      expect(res.status()).toBe(403)
    } finally {
      await deleteDeviceIfExists(request, adminToken, adminDevId)
    }
  })

  test('unauthenticated requests are rejected', async ({ request }) => {
    const get = await request.fetch('/api/devices', { method: 'GET' })
    expect([401, 403]).toContain(get.status())

    const post = await request.fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { deviceId: uniqueDeviceId(), platform: 'ios' },
    })
    expect([401, 403]).toContain(post.status())
  })
})

test.describe('TC-DEV-002: Devices admin endpoints', () => {
  test('admin registers a device on behalf of another user', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const employeeScope = getTokenScope(employeeToken)
    const deviceId = uniqueDeviceId()
    let createdId: string | null = null
    try {
      const res = await apiRequest(request, 'POST', ADMIN_PATH, {
        token: adminToken,
        data: { userId: employeeScope.userId, deviceId, platform: 'ios', pushToken: 'admin-seeded-token', pushProvider: 'apns' },
      })
      expect(res.status()).toBe(201)
      const json = await readJsonSafe<RegisterResult>(res)
      createdId = json?.id ?? null
      expect(createdId).toBeTruthy()

      // Visible to admin (scoped to the target user) and to the target user's own self list.
      const adminView = await waitForDevices(
        request,
        adminToken,
        (its) => its.some((d) => d.id === createdId && d.user_id === employeeScope.userId),
        `?userId=${employeeScope.userId}`,
        ADMIN_PATH,
      )
      expect(adminView.find((d) => d.id === createdId)).toBeTruthy()

      const selfView = await waitForDevices(request, employeeToken, (its) => its.some((d) => d.id === createdId))
      expect(selfView.find((d) => d.id === createdId)?.push_provider).toBe('apns')
    } finally {
      if (createdId) await apiRequest(request, 'DELETE', `${ADMIN_PATH}/${createdId}`, { token: adminToken }).catch(() => undefined)
    }
  })

  test('admin updates and reads any device (push_token never exposed)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const deviceId = uniqueDeviceId()
    let createdId: string | null = null
    try {
      createdId = (await registerDevice(request, employeeToken, {
        deviceId,
        platform: 'android',
        pushToken: 'employee-token',
        pushProvider: 'fcm',
      })).json?.id ?? null
      expect(createdId).toBeTruthy()

      const put = await apiRequest(request, 'PUT', `${ADMIN_PATH}/${createdId}`, {
        token: adminToken,
        data: { clientAppVersion: '9.9.9' },
      })
      expect(put.status()).toBe(200)

      const get = await apiRequest(request, 'GET', `${ADMIN_PATH}/${createdId}`, { token: adminToken })
      expect(get.status()).toBe(200)
      const detail = await readJsonSafe<{ item?: DeviceListItem }>(get)
      expect(detail?.item?.client_app_version).toBe('9.9.9')
      expect(detail?.item?.push_provider).toBe('fcm')
      expect(detail?.item && 'push_token' in detail.item).toBeFalsy()
    } finally {
      if (createdId) await apiRequest(request, 'DELETE', `${ADMIN_PATH}/${createdId}`, { token: adminToken }).catch(() => undefined)
    }
  })

  test('non-admin cannot access admin endpoints', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')
    const employeeScope = getTokenScope(employeeToken)

    const list = await apiRequest(request, 'GET', ADMIN_PATH, { token: employeeToken })
    expect(list.status()).toBe(403)

    const create = await apiRequest(request, 'POST', ADMIN_PATH, {
      token: employeeToken,
      data: { userId: employeeScope.userId, deviceId: uniqueDeviceId(), platform: 'ios' },
    })
    expect(create.status()).toBe(403)
  })
})
