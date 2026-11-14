import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture, createRoleFixture, createUserFixture,
  deleteOrganizationIfExists, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation } from '@open-mercato/core/helpers/integration/undoHarness'

test('TC-UNDO-7370: parent-selected own child create supports guarded undo and redo', async ({ request }) => {
  const superadminToken = await getAuthToken(request, 'superadmin')
  const tenantId = expectId(getTokenScope(await getAuthToken(request, 'admin')).tenantId, 'fixture tenant')
  const stamp = randomUUID()
  const password = `Aa1!${randomUUID()}`
  const users: string[] = []
  const organizations: string[] = []
  let roleId: string | null = null
  const features = ['auth.users.create', 'auth.users.delete', 'auth.users.list', 'audit_logs.undo_self', 'audit_logs.redo_self']
  try {
    const parentId = await createOrganizationFixture(request, superadminToken, { name: `Undo parent ${stamp}`, tenantId })
    organizations.push(parentId)
    const childId = await createOrganizationFixture(request, superadminToken, { name: `Undo child ${stamp}`, tenantId, parentId })
    organizations.push(childId)
    const siblingId = await createOrganizationFixture(request, superadminToken, { name: `Undo sibling ${stamp}`, tenantId })
    organizations.push(siblingId)
    roleId = await createRoleFixture(request, superadminToken, { name: `undo-7370-${stamp}`, tenantId })
    await setRoleAclFeatures(request, superadminToken, { roleId, features, organizations: [parentId] })
    const actorEmail = `undo-7370-${stamp}@example.test`
    users.push(await createUserFixture(request, superadminToken, { email: actorEmail, password, organizationId: parentId, roles: [roleId] }))
    const otherEmail = `undo-7370-other-${stamp}@example.test`
    users.push(await createUserFixture(request, superadminToken, { email: otherEmail, password, organizationId: parentId, roles: [roleId] }))
    const actorToken = await getAuthToken(request, actorEmail, password)
    const otherToken = await getAuthToken(request, otherEmail, password)
    const headers = { Cookie: `om_selected_org=${parentId}` }
    const replay = (token: string, action: 'undo' | 'redo', data: Record<string, string>) =>
      apiRequest(request, 'POST', `/api/audit_logs/audit-logs/actions/${action}`, { token, headers, data })
    const targetEmail = `undo-7370-target-${stamp}@example.test`
    const create = await apiRequest(request, 'POST', '/api/auth/users', {
      token: actorToken, headers, data: { email: targetEmail, password, organizationId: childId },
    })
    expect(create.status()).toBe(201)
    const targetId = expectId((await readJsonSafe<{ id?: string }>(create))?.id, 'child user')
    users.push(targetId)
    const operation = expectOperation(create, 'child create with parent selected')
    const targetExists = async () => {
      const response = await apiRequest(request, 'GET', `/api/auth/users?ids=${targetId}&pageSize=100`, {
        token: superadminToken, headers: { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${childId}` },
      })
      expect(response.status()).toBe(200)
      return (await readJsonSafe<{ items?: Array<{ id: string }> }>(response))?.items?.some((item) => item.id === targetId) === true
    }

    expect((await replay(otherToken, 'undo', { undoToken: operation.undoToken })).status()).toBe(400)
    expect(await targetExists()).toBe(true)
    expect((await replay(actorToken, 'undo', { undoToken: operation.undoToken })).status()).toBe(200)
    expect(await targetExists()).toBe(false)
    expect((await replay(actorToken, 'undo', { undoToken: operation.undoToken })).status()).toBe(400)
    expect((await replay(otherToken, 'redo', { logId: operation.logId })).status()).toBe(400)
    const redo = await replay(actorToken, 'redo', { logId: operation.logId })
    expect(redo.status()).toBe(200)
    const redone = expectOperation(redo, 'child redo with parent selected')
    expect(redone.undoToken).not.toBe(operation.undoToken)
    expect(await targetExists()).toBe(true)

    await setRoleAclFeatures(request, superadminToken, { roleId, features, organizations: [siblingId] })
    expect([400, 403]).toContain((await replay(actorToken, 'undo', { undoToken: redone.undoToken })).status())
    expect(await targetExists()).toBe(true)
    await setRoleAclFeatures(request, superadminToken, { roleId, features, organizations: [parentId] })
    expect((await replay(actorToken, 'undo', { undoToken: redone.undoToken })).status()).toBe(200)
    expect(await targetExists()).toBe(false)
  } finally {
    for (const userId of users.reverse()) await deleteUserIfExists(request, superadminToken, userId)
    await deleteRoleIfExists(request, superadminToken, roleId)
    for (const organizationId of organizations.reverse()) await deleteOrganizationIfExists(request, superadminToken, organizationId)
  }
})
