import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, deleteRoleIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

type RoleRecord = { id: string; name: string; updatedAt: string }

async function readRole(request: APIRequestContext, token: string, id: string, name: string): Promise<RoleRecord> {
  const response = await apiRequest(request, 'GET', `/api/auth/roles?id=${id}&search=${encodeURIComponent(name)}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items: RoleRecord[] }>(response)
  const role = body?.items.find((item) => item.id === id)
  expect(role).toBeDefined()
  expect(typeof role?.updatedAt).toBe('string')
  return role!
}

test.describe('TC-AUTH-8707: role rename validation', () => {
  test('rejects a duplicate without persisting it, accepts a corrected retry and preserves stale-write rejection', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = randomUUID()
    const duplicateName = `QA 8707 occupied ${stamp}`
    const originalName = `QA 8707 original ${stamp}`
    const correctedName = `QA 8707 corrected ${stamp}`
    const roleIds: string[] = []

    try {
      roleIds.push(await createRoleFixture(request, token, { name: duplicateName }))
      const targetId = await createRoleFixture(request, token, { name: originalName })
      roleIds.push(targetId)
      const original = await readRole(request, token, targetId, '')
      const headers = { [OPTIMISTIC_LOCK_HEADER_NAME]: original.updatedAt }
      const rejected = await apiRequest(request, 'PUT', '/api/auth/roles', {
        token, headers, data: { id: targetId, name: duplicateName },
      })
      expect(rejected.status()).toBe(400)
      const error = await readJsonSafe<{ fieldErrors: { name: string }; details: unknown[] }>(rejected)
      expect(error?.fieldErrors.name).toBeTruthy()
      expect(error?.details).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['name'], code: 'duplicate', origin: 'validation' }),
      ]))
      expect(await readRole(request, token, targetId, originalName)).toMatchObject(original)

      const retry = await apiRequest(request, 'PUT', '/api/auth/roles', {
        token, headers, data: { id: targetId, name: correctedName },
      })
      expect(retry.status()).toBe(200)
      expect(await readRole(request, token, targetId, correctedName)).toMatchObject({ name: correctedName })

      const stale = await apiRequest(request, 'PUT', '/api/auth/roles', {
        token, headers, data: { id: targetId, name: duplicateName },
      })
      expect(stale.status()).toBe(409)
      expect(await readJsonSafe(stale)).toMatchObject({ code: 'optimistic_lock_conflict' })
      expect(await readRole(request, token, targetId, correctedName)).toMatchObject({ name: correctedName })
    } finally {
      for (const roleId of roleIds.reverse()) await deleteRoleIfExists(request, token, roleId)
    }
  })

  test('allows identical names in separate authorized tenants and hides foreign roles from a tenant admin', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = randomUUID()
    const sharedName = `QA 8707 shared ${stamp}`
    const tenantIds: string[] = []
    const roleIds: string[] = []

    try {
      for (const suffix of ['A', 'B']) {
        const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
          token: superadminToken, data: { name: `QA 8707 ${suffix} ${stamp}` },
        })
        expect(tenantResponse.status()).toBe(201)
        const tenantId = expectId((await readJsonSafe<{ id: string }>(tenantResponse))?.id, 'Tenant id')
        tenantIds.push(tenantId)
        const roleId = await createRoleFixture(request, superadminToken, { name: `QA 8707 ${suffix} ${stamp}`, tenantId })
        roleIds.push(roleId)
        const update = await apiRequest(request, 'PUT', '/api/auth/roles', {
          token: superadminToken, data: { id: roleId, name: sharedName },
        })
        expect(update.status()).toBe(200)
        const read = await apiRequest(request, 'GET', `/api/auth/roles?id=${roleId}&tenantId=${tenantId}`, { token: superadminToken })
        expect(read.status()).toBe(200)
        expect(await readJsonSafe(read)).toMatchObject({ items: [expect.objectContaining({ id: roleId, name: sharedName, tenantId })] })
      }
      const adminToken = await getAuthToken(request, 'admin')
      const foreignWrite = await apiRequest(request, 'PUT', '/api/auth/roles', {
        token: adminToken, data: { id: roleIds[0], name: sharedName },
      })
      expect(foreignWrite.status()).toBe(404)
      const foreignRead = await apiRequest(request, 'GET', `/api/auth/roles?id=${roleIds[0]}`, { token: adminToken })
      expect(foreignRead.status()).toBe(200)
      expect(await readJsonSafe(foreignRead)).toMatchObject({ items: [] })
    } finally {
      for (const roleId of roleIds.reverse()) await deleteRoleIfExists(request, superadminToken, roleId)
      for (const tenantId of tenantIds.reverse()) {
        const deleted = await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${tenantId}`, { token: superadminToken })
        expect(deleted.ok()).toBeTruthy()
      }
    }
  })
})
