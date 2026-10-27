import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { withClient } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import {
  apiRequestWithSelectedOrg,
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import {
  clearUserHomeOrganization,
  createOrganizationInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
} from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

type RegisterResult = { id: string; deviceId: string; revived: boolean }

const SELF_PATH = '/api/devices'
const ADMIN_PATH = '/api/devices/admin/devices'

let deviceCounter = 0
function uniqueDeviceId(): string {
  deviceCounter += 1
  return `qa-dev6-${Date.now()}-${deviceCounter}`
}

async function registerDevice(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: RegisterResult | null }> {
  const res = await apiRequest(request, 'POST', SELF_PATH, { token, data: body })
  return { status: res.status(), json: await readJsonSafe<RegisterResult>(res) }
}

async function deleteDeviceIfExists(
  request: APIRequestContext,
  token: string,
  id: string | null,
  basePath = SELF_PATH,
): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', `${basePath}/${id}`, { token }).catch(() => undefined)
}

async function readDeviceColumn<T = string>(deviceId: string, column: string): Promise<T | null> {
  return withClient(async (client) => {
    const result = await client.query<Record<string, T>>(
      `select ${column} from user_devices where id = $1`,
      [deviceId],
    )
    return result.rows[0]?.[column] ?? null
  })
}

// TC-DEV-006: push_token is a long-lived provider secret. encryption.ts declares it encrypted at rest,
// so the raw column must hold ciphertext (never the plaintext the client sent), while the API keeps
// stripping it from every response.
test.describe('TC-DEV-006: Devices push_token encryption at rest', () => {
  test('stores push_token as ciphertext and never returns it via the API', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const deviceId = uniqueDeviceId()
    const plaintextToken = `qa-plaintext-push-token-${Date.now()}`
    let createdId: string | null = null
    try {
      const created = await registerDevice(request, token, {
        deviceId,
        platform: 'ios',
        pushToken: plaintextToken,
        pushProvider: 'apns',
      })
      expect(created.status).toBe(201)
      createdId = created.json?.id ?? null
      expect(createdId).toBeTruthy()

      // Raw DB read bypasses the decrypting read path: the column must NOT contain the plaintext.
      const rawToken = await readDeviceColumn(createdId as string, 'push_token')
      expect(rawToken).toBeTruthy()
      expect(rawToken).not.toBe(plaintextToken)
      expect(rawToken).not.toContain(plaintextToken)

      // The API never exposes the token, only the last-seen metadata.
      const listRes = await apiRequest(request, 'GET', SELF_PATH, { token })
      expect(listRes.status()).toBe(200)
      const list = await readJsonSafe<{ items: Array<Record<string, unknown>> }>(listRes)
      const found = list?.items.find((item) => item.id === createdId)
      expect(found).toBeTruthy()
      expect(found && 'push_token' in found).toBeFalsy()
    } finally {
      await deleteDeviceIfExists(request, token, createdId)
    }
  })
})

// TC-DEV-007: device metadata edits carry lost-update risk, so the self update route enforces OSS
// optimistic locking when the caller sends the expected-version header. A stale version must 409; the
// matching version must succeed.
test.describe('TC-DEV-007: Devices optimistic-lock conflict on update', () => {
  test('rejects a stale update with 409 and accepts the matching version', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const deviceId = uniqueDeviceId()
    let createdId: string | null = null
    try {
      const created = await registerDevice(request, token, { deviceId, platform: 'android' })
      expect(created.status).toBe(201)
      createdId = created.json?.id ?? null
      expect(createdId).toBeTruthy()

      const currentUpdatedAt = await readDeviceColumn<string | Date>(createdId as string, 'updated_at')
      expect(currentUpdatedAt).toBeTruthy()
      const currentIso = new Date(currentUpdatedAt as string).toISOString()

      // A clearly-stale expected version must conflict.
      const stale = await request.fetch(`${SELF_PATH}/${createdId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: '2000-01-01T00:00:00.000Z',
        },
        data: { clientAppVersion: '4.0.0' },
      })
      expect(stale.status(), 'stale update should 409').toBe(409)
      const conflict = await stale.json()
      expect(conflict.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)

      // The matching version (the un-mutated current updated_at) must succeed.
      const ok = await request.fetch(`${SELF_PATH}/${createdId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: currentIso,
        },
        data: { clientAppVersion: '4.0.0' },
      })
      expect(ok.status(), 'matching version should succeed').toBe(200)
      const okBody = await ok.json()
      expect(okBody.ok).toBe(true)
    } finally {
      await deleteDeviceIfExists(request, token, createdId)
    }
  })
})

// TC-DEV-008: the admin device endpoints gate every record by isOrganizationReadAccessAllowed. A
// restricted admin (visibility scoped to one org) must be denied a device that lives in another org,
// even though devices.admin grants tenant-wide feature access.
test.describe('TC-DEV-008: Admin cross-organization device access denial', () => {
  test('denies a restricted admin a device outside their organization scope', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(adminToken)
    const employeeToken = await getAuthToken(request, 'employee')
    const employeeScope = getTokenScope(employeeToken)

    const stamp = `${Date.now()}-${deviceCounter}`
    const password = 'Restricted1!Admin'
    const restrictedEmail = `tc-dev-008-restricted-${stamp}@acme.com`

    let orgAId: string | null = null
    let orgBId: string | null = null
    let restrictedRoleId: string | null = null
    let restrictedUserId: string | null = null
    let orgADeviceId: string | null = null
    let orgBDeviceId: string | null = null
    try {
      orgAId = await createOrganizationInDb({ name: `TC-DEV-008 Org A ${stamp}`, tenantId })
      orgBId = await createOrganizationInDb({ name: `TC-DEV-008 Org B ${stamp}`, tenantId })

      // The full admin registers a device into each org (organization is taken from the selected org).
      const orgADeviceKey = uniqueDeviceId()
      const orgBDeviceKey = uniqueDeviceId()
      const orgARes = await apiRequestWithSelectedOrg(request, 'POST', ADMIN_PATH, {
        token: adminToken,
        selectedOrgId: orgAId,
        data: { userId: employeeScope.userId, deviceId: orgADeviceKey, platform: 'ios' },
      })
      expect(orgARes.status()).toBe(201)
      orgADeviceId = (await readJsonSafe<RegisterResult>(orgARes))?.id ?? null

      const orgBRes = await apiRequestWithSelectedOrg(request, 'POST', ADMIN_PATH, {
        token: adminToken,
        selectedOrgId: orgBId,
        data: { userId: employeeScope.userId, deviceId: orgBDeviceKey, platform: 'ios' },
      })
      expect(orgBRes.status()).toBe(201)
      orgBDeviceId = (await readJsonSafe<RegisterResult>(orgBRes))?.id ?? null
      expect(orgADeviceId && orgBDeviceId).toBeTruthy()

      // Build a restricted admin: devices.admin feature, visibility narrowed to org A only, and a null
      // home org so the effective scope is exactly the visibility list.
      restrictedRoleId = await createRoleFixture(request, adminToken, { name: `TC-DEV-008 Role ${stamp}` })
      restrictedUserId = await createUserFixture(request, adminToken, {
        email: restrictedEmail,
        password,
        organizationId: orgAId,
        roles: [restrictedRoleId],
      })
      await setUserAclVisibility(request, adminToken, {
        userId: restrictedUserId,
        organizations: [orgAId],
        features: ['devices.admin'],
      })
      await clearUserHomeOrganization(restrictedUserId)

      const restrictedToken = await getAuthToken(request, restrictedEmail, password)

      // In-scope org A device → allowed.
      const allowed = await apiRequest(request, 'GET', `${ADMIN_PATH}/${orgADeviceId}`, { token: restrictedToken })
      expect(allowed.status(), 'in-scope org A device should be visible').toBe(200)

      // Out-of-scope org B device → denied, even though the device exists in the same tenant.
      const denied = await apiRequest(request, 'GET', `${ADMIN_PATH}/${orgBDeviceId}`, { token: restrictedToken })
      expect(denied.status(), 'cross-org device GET must be forbidden').toBe(403)

      // The denial also covers writes through the same gate.
      const deniedWrite = await apiRequest(request, 'PUT', `${ADMIN_PATH}/${orgBDeviceId}`, {
        token: restrictedToken,
        data: { clientAppVersion: '9.9.9' },
      })
      expect(deniedWrite.status(), 'cross-org device PUT must be forbidden').toBe(403)
    } finally {
      await deleteDeviceIfExists(request, adminToken, orgADeviceId, ADMIN_PATH)
      await deleteDeviceIfExists(request, adminToken, orgBDeviceId, ADMIN_PATH)
      if (restrictedUserId) await deleteUserAclInDb(restrictedUserId).catch(() => undefined)
      await deleteUserIfExists(request, adminToken, restrictedUserId)
      await deleteRoleIfExists(request, adminToken, restrictedRoleId)
      await deleteOrganizationInDb(orgAId).catch(() => undefined)
      await deleteOrganizationInDb(orgBId).catch(() => undefined)
    }
  })
})
