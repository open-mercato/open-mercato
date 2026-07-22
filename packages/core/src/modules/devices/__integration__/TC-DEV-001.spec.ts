import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

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

  test('self list ignores advanced-filter user_id passthrough (scope is override-proof)', async ({ request }) => {
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

      // The self list schema is `.passthrough()`, so advanced-filter params (`filter[...]`) survive zod
      // and the CRUD factory merges them OVER buildFilters via object spread. A crafted single-condition
      // filter on `user_id` must NOT override the server-enforced actor scope and leak another user's
      // devices — the scope is emitted as an un-clobberable `$and` branch, so this fails closed.
      await waitForDevices(request, adminToken, (its) => its.some((d) => d.id === adminDevId))
      const filterQuery =
        '?filter[conditions][0][field]=user_id' +
        '&filter[conditions][0][op]=is' +
        `&filter[conditions][0][value]=${encodeURIComponent(employeeScope.userId)}`
      const selfView = await listDevices(request, adminToken, filterQuery)
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

// Admin detail GET reads straight from the DB (strongly consistent, unlike the query-index list), so
// it is the deterministic way to assert exact timestamps / per-field state for a single device.
type DeviceDetail = DeviceListItem & { os_version?: string | null; updated_at?: string | null }

async function adminGetDevice(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<DeviceDetail> {
  const res = await apiRequest(request, 'GET', `${ADMIN_PATH}/${id}`, { token })
  expect(res.status(), 'admin device detail GET should return 200').toBe(200)
  const body = await readJsonSafe<{ item?: DeviceDetail }>(res)
  expect(body?.item, 'admin device detail should include item').toBeTruthy()
  return body!.item!
}

const LOCK_BASE_URL = process.env.BASE_URL?.trim() || ''
function resolveLockUrl(path: string): string {
  return LOCK_BASE_URL ? `${LOCK_BASE_URL}${path}` : path
}

async function putWithLockHeader(
  request: APIRequestContext,
  token: string,
  path: string,
  expectedUpdatedAt: string,
  data: Record<string, unknown>,
) {
  return request.fetch(resolveLockUrl(path), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: expectedUpdatedAt,
    },
    data,
  })
}

test.describe('TC-DEV-003: last_seen_at presence semantics', () => {
  test('metadata-only edit keeps last_seen_at; explicit lastSeenAt advances it', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')
    const adminToken = await getAuthToken(request, 'admin')
    const deviceId = uniqueDeviceId()
    let createdId: string | null = null
    try {
      createdId = (await registerDevice(request, employeeToken, { deviceId, platform: 'ios', osVersion: 'iOS 18.0' })).json?.id ?? null
      expect(createdId).toBeTruthy()

      const before = await adminGetDevice(request, adminToken, createdId!)
      const lastSeenT0 = before.last_seen_at
      expect(lastSeenT0).toBeTruthy()

      // Metadata-only PUT (no lastSeenAt) must NOT bump presence — only the row's updated_at moves.
      const put1 = await apiRequest(request, 'PUT', `${SELF_PATH}/${createdId}`, { token: employeeToken, data: { osVersion: 'iOS 18.1' } })
      expect(put1.status()).toBe(200)
      const after1 = await adminGetDevice(request, adminToken, createdId!)
      expect(after1.os_version, 'metadata edit should apply').toBe('iOS 18.1')
      expect(after1.last_seen_at, 'last_seen_at must NOT change on a metadata-only edit').toBe(lastSeenT0)
      expect(after1.updated_at, 'updated_at should advance (row was written)').not.toBe(before.updated_at)

      // An explicit client-supplied lastSeenAt DOES advance presence.
      const explicit = '2031-01-02T03:04:05.000Z'
      const put2 = await apiRequest(request, 'PUT', `${SELF_PATH}/${createdId}`, { token: employeeToken, data: { lastSeenAt: explicit } })
      expect(put2.status()).toBe(200)
      const after2 = await adminGetDevice(request, adminToken, createdId!)
      expect(new Date(after2.last_seen_at as string).toISOString()).toBe(explicit)
    } finally {
      await deleteDeviceIfExists(request, employeeToken, createdId)
    }
  })
})

test.describe('TC-DEV-004: optimistic locking on device update', () => {
  test('a stale expected-updated-at is refused with a structured 409', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeScope = getTokenScope(await getAuthToken(request, 'employee'))
    const deviceId = uniqueDeviceId()
    let createdId: string | null = null
    try {
      const reg = await apiRequest(request, 'POST', ADMIN_PATH, {
        token: adminToken,
        data: { userId: employeeScope.userId, deviceId, platform: 'android' },
      })
      expect(reg.status()).toBe(201)
      createdId = (await readJsonSafe<RegisterResult>(reg))?.id ?? null
      expect(createdId).toBeTruthy()

      const t0 = (await adminGetDevice(request, adminToken, createdId!)).updated_at as string
      expect(t0).toBeTruthy()

      // Session A holds the fresh version → wins.
      const sessionA = await putWithLockHeader(request, adminToken, `${ADMIN_PATH}/${createdId}`, t0, { osVersion: 'locked-A' })
      expect(sessionA.status(), 'session A (fresh version) should win').toBeLessThan(300)

      const t1 = (await adminGetDevice(request, adminToken, createdId!)).updated_at as string
      expect(t1, 'updated_at should advance after session A').not.toBe(t0)

      // Session B replays the now-stale version → refused with 409.
      const sessionB = await putWithLockHeader(request, adminToken, `${ADMIN_PATH}/${createdId}`, t0, { osVersion: 'stale-B' })
      expect(sessionB.status(), 'stale session B should be refused with 409').toBe(409)
      const body = await readJsonSafe<Record<string, unknown>>(sessionB)
      expect(body).toMatchObject({ error: OPTIMISTIC_LOCK_CONFLICT_ERROR, code: OPTIMISTIC_LOCK_CONFLICT_CODE })
    } finally {
      if (createdId) await apiRequest(request, 'DELETE', `${ADMIN_PATH}/${createdId}`, { token: adminToken }).catch(() => undefined)
    }
  })
})
