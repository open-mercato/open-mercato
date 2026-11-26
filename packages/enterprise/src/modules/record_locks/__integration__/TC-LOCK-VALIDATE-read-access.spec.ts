import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPersonFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { cleanupPerson } from './helpers/recordLocks'

test('record-lock validation requires permission to read the target record', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const { organizationId } = getTokenContext(adminToken)
  const suffix = randomUUID()
  const email = `qa-record-lock-validate-${suffix}@example.test`
  const password = `Lock!9-${suffix}`
  let roleId: string | null = null
  let userId: string | null = null
  let personId: string | null = null

  try {
    roleId = await createRoleFixture(request, adminToken, { name: email })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      organizations: [organizationId],
      features: ['record_locks.view'],
    })
    userId = await createUserFixture(request, adminToken, {
      email, password, organizationId, roles: [roleId],
    })
    const restrictedToken = await getAuthToken(request, email, password)
    personId = await createPersonFixture(request, adminToken, {
      firstName: 'QA',
      lastName: 'Record lock validation',
      displayName: `QA Record lock validation ${suffix}`,
    })
    const resource = { resourceKind: 'customers.person', resourceId: personId }

    const allowed = await apiRequest(request, 'POST', '/api/record_locks/validate', {
      token: adminToken,
      data: resource,
    })
    expect(allowed.status()).toBe(200)
    expect(await allowed.json()).toMatchObject({ ok: true })

    const denied = await apiRequest(request, 'POST', '/api/record_locks/validate', {
      token: restrictedToken,
      data: resource,
    })
    expect(denied.status()).toBe(404)
    expect(await denied.json()).toEqual({
      code: 'record_not_found',
      error: expect.any(String),
    })

    const missing = await apiRequest(request, 'POST', '/api/record_locks/validate', {
      token: restrictedToken,
      data: { ...resource, resourceId: randomUUID() },
    })
    expect(missing.status()).toBe(404)
    expect(await missing.json()).toEqual(await denied.json())
  } finally {
    await cleanupPerson(request, adminToken, personId)
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
})
