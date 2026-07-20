import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  apiRequestWithSelectedOrg,
  createRoleFixture,
  createUserFixture,
  setRoleAclFeatures,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
} from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'

// TC-DEV-005: organization-dimension coverage for the devices module — per-org device identity,
// org-narrowed admin listing/reads (unrestricted + restricted admins), and active-org scoping of the
// self routes (option B). Reuses the shared org/user/role fixtures + the om_selected_org cookie helper
// (apiRequestWithSelectedOrg) rather than re-implementing org switching.

type RegisterResult = { id: string; deviceId: string; revived: boolean }
type DeviceListItem = { id: string; user_id: string; device_id: string; organization_id?: string | null }
type DeviceListResponse = { items: DeviceListItem[]; total?: number }

const SELF_PATH = '/api/devices'
const ADMIN_PATH = '/api/devices/admin/devices'

let deviceCounter = 0
function uniqueDeviceId(prefix: string): string {
  deviceCounter += 1
  return `${prefix}-${Date.now()}-${deviceCounter}`
}

async function adminRegisterInOrg(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  userId: string,
  deviceId: string,
): Promise<RegisterResult | null> {
  const res = await apiRequestWithSelectedOrg(request, 'POST', ADMIN_PATH, {
    token: adminToken,
    selectedOrgId: organizationId,
    data: { userId, deviceId, platform: 'ios' },
  })
  expect(res.status(), 'admin register-on-behalf should return 201').toBe(201)
  return readJsonSafe<RegisterResult>(res)
}

async function adminListInOrg(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  query = '',
): Promise<DeviceListItem[]> {
  const res = await apiRequestWithSelectedOrg(request, 'GET', `${ADMIN_PATH}${query}`, {
    token,
    selectedOrgId: organizationId,
  })
  expect(res.status(), 'admin list should return 200').toBe(200)
  return (await readJsonSafe<DeviceListResponse>(res))?.items ?? []
}

// The list APIs read from the eventually-consistent query index, so poll until the expected state.
async function waitForList(
  fetcher: () => Promise<DeviceListItem[]>,
  predicate: (items: DeviceListItem[]) => boolean,
): Promise<DeviceListItem[]> {
  let latest: DeviceListItem[] = []
  await expect
    .poll(async () => {
      latest = await fetcher()
      return predicate(latest)
    }, { timeout: 15_000 })
    .toBe(true)
  return latest
}

test.describe('TC-DEV-005: organization scoping & per-org device identity', () => {
  test('same (user, device) in two orgs yields two distinct org-scoped rows', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, userId: ownerUserId } = getTokenScope(adminToken)
    const deviceId = uniqueDeviceId('qa-dev-005-identity')
    let orgAId: string | null = null
    let orgBId: string | null = null
    let idA: string | null = null
    let idB: string | null = null
    try {
      orgAId = await createOrganizationInDb({ name: `DEV-005 Org A ${stamp}`, tenantId })
      orgBId = await createOrganizationInDb({ name: `DEV-005 Org B ${stamp}`, tenantId })

      const regA = await adminRegisterInOrg(request, adminToken, orgAId, ownerUserId, deviceId)
      const regB = await adminRegisterInOrg(request, adminToken, orgBId, ownerUserId, deviceId)
      idA = regA?.id ?? null
      idB = regB?.id ?? null
      expect(idA).toBeTruthy()
      expect(idB).toBeTruthy()
      // Per-org identity: the org is part of the key, so this is NOT deduped across orgs — two
      // distinct, freshly-created active rows rather than one row moved between organizations.
      expect(idA).not.toBe(idB)
      expect(regA?.revived).toBe(false)
      expect(regB?.revived).toBe(false)

      // Admin list is narrowed to the selected org: each org sees only its own row.
      const inA = await waitForList(
        () => adminListInOrg(request, adminToken, orgAId!, `?userId=${ownerUserId}`),
        (items) => items.some((d) => d.id === idA),
      )
      expect(inA.some((d) => d.id === idA)).toBe(true)
      expect(inA.some((d) => d.id === idB)).toBe(false)

      const inB = await waitForList(
        () => adminListInOrg(request, adminToken, orgBId!, `?userId=${ownerUserId}`),
        (items) => items.some((d) => d.id === idB),
      )
      expect(inB.some((d) => d.id === idB)).toBe(true)
      expect(inB.some((d) => d.id === idA)).toBe(false)
    } finally {
      if (idA) await apiRequest(request, 'DELETE', `${ADMIN_PATH}/${idA}`, { token: adminToken }).catch(() => undefined)
      if (idB) await apiRequest(request, 'DELETE', `${ADMIN_PATH}/${idB}`, { token: adminToken }).catch(() => undefined)
      await deleteOrganizationInDb(orgAId).catch(() => undefined)
      await deleteOrganizationInDb(orgBId).catch(() => undefined)
    }
  })

  test('an org-restricted admin only lists and reads devices in its own organization', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const password = 'Secret123!'
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, userId: ownerUserId } = getTokenScope(adminToken)
    const email = `tc-dev-005-restricted-${stamp}@example.com`
    let orgAId: string | null = null
    let orgBId: string | null = null
    let roleId: string | null = null
    let restrictedUserId: string | null = null
    let idA: string | null = null
    let idB: string | null = null
    try {
      orgAId = await createOrganizationInDb({ name: `DEV-005 Org A ${stamp}`, tenantId })
      orgBId = await createOrganizationInDb({ name: `DEV-005 Org B ${stamp}`, tenantId })

      idA = (await adminRegisterInOrg(request, adminToken, orgAId, ownerUserId, uniqueDeviceId('qa-dev-005a')))?.id ?? null
      idB = (await adminRegisterInOrg(request, adminToken, orgBId, ownerUserId, uniqueDeviceId('qa-dev-005b')))?.id ?? null
      expect(idA).toBeTruthy()
      expect(idB).toBeTruthy()

      // An admin whose visibility is restricted to org B.
      roleId = await createRoleFixture(request, adminToken, { name: `DEV-005 Restricted ${stamp}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['devices.admin'], organizations: [orgBId] })
      restrictedUserId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: orgBId,
        roles: [roleId],
      })
      const restrictedToken = await getAuthToken(request, email, password)

      // List: only the org-B device is visible.
      const seen = await waitForList(
        () => adminListInOrg(request, restrictedToken, orgBId!, `?userId=${ownerUserId}`),
        (items) => items.some((d) => d.id === idB),
      )
      expect(seen.some((d) => d.id === idB)).toBe(true)
      expect(seen.some((d) => d.id === idA)).toBe(false)

      // Detail: 200 for the in-scope org B device, 403 for the out-of-scope org A device.
      const okB = await apiRequest(request, 'GET', `${ADMIN_PATH}/${idB}`, { token: restrictedToken })
      expect(okB.status()).toBe(200)
      const denyA = await apiRequest(request, 'GET', `${ADMIN_PATH}/${idA}`, { token: restrictedToken })
      expect(denyA.status()).toBe(403)
    } finally {
      if (idA) await apiRequest(request, 'DELETE', `${ADMIN_PATH}/${idA}`, { token: adminToken }).catch(() => undefined)
      if (idB) await apiRequest(request, 'DELETE', `${ADMIN_PATH}/${idB}`, { token: adminToken }).catch(() => undefined)
      await deleteUserIfExists(request, adminToken, restrictedUserId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationInDb(orgAId).catch(() => undefined)
      await deleteOrganizationInDb(orgBId).catch(() => undefined)
    }
  })

  test('self routes are scoped to the active org: owner cannot list or mutate their device in another org', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const employeeScope = getTokenScope(employeeToken)
    const { tenantId } = getTokenScope(adminToken)
    let orgBId: string | null = null
    let homeDeviceId: string | null = null
    let otherOrgDeviceId: string | null = null
    try {
      orgBId = await createOrganizationInDb({ name: `DEV-005 Org B ${stamp}`, tenantId })

      // Admin places a device OWNED BY the employee into org B (not the employee's home org).
      otherOrgDeviceId =
        (await adminRegisterInOrg(request, adminToken, orgBId, employeeScope.userId, uniqueDeviceId('qa-dev-005-other')))?.id ?? null
      expect(otherOrgDeviceId).toBeTruthy()

      // Employee self-registers a device in their own (home) org.
      const homeRes = await apiRequest(request, 'POST', SELF_PATH, {
        token: employeeToken,
        data: { deviceId: uniqueDeviceId('qa-dev-005-home'), platform: 'ios' },
      })
      expect(homeRes.status()).toBe(201)
      homeDeviceId = (await readJsonSafe<RegisterResult>(homeRes))?.id ?? null
      expect(homeDeviceId).toBeTruthy()

      // Self list (home-org context) shows the home device but NOT the org-B device, though the
      // employee owns both.
      const selfItems = await waitForList(
        async () => {
          const res = await apiRequest(request, 'GET', SELF_PATH, { token: employeeToken })
          expect(res.status()).toBe(200)
          return (await readJsonSafe<DeviceListResponse>(res))?.items ?? []
        },
        (items) => items.some((d) => d.id === homeDeviceId),
      )
      expect(selfItems.some((d) => d.id === homeDeviceId)).toBe(true)
      expect(selfItems.some((d) => d.id === otherOrgDeviceId)).toBe(false)

      // Self PUT/DELETE on the out-of-org device read as 404 (owner matches, but the active-org filter
      // excludes it).
      const put = await apiRequest(request, 'PUT', `${SELF_PATH}/${otherOrgDeviceId}`, {
        token: employeeToken,
        data: { osVersion: 'x' },
      })
      expect(put.status()).toBe(404)
      const del = await apiRequest(request, 'DELETE', `${SELF_PATH}/${otherOrgDeviceId}`, { token: employeeToken })
      expect(del.status()).toBe(404)

      // Control: the employee CAN mutate their in-org device.
      const okPut = await apiRequest(request, 'PUT', `${SELF_PATH}/${homeDeviceId}`, {
        token: employeeToken,
        data: { osVersion: 'ok' },
      })
      expect(okPut.status()).toBe(200)
    } finally {
      if (homeDeviceId) await apiRequest(request, 'DELETE', `${SELF_PATH}/${homeDeviceId}`, { token: employeeToken }).catch(() => undefined)
      if (otherOrgDeviceId) await apiRequest(request, 'DELETE', `${ADMIN_PATH}/${otherOrgDeviceId}`, { token: adminToken }).catch(() => undefined)
      await deleteOrganizationInDb(orgBId).catch(() => undefined)
    }
  })
})
