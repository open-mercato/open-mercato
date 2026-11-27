import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectOperation, redoByLogId, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'

test.describe('TC-DIR-022: Organization mutation actor scope (#8677)', () => {
  test('uses the role grant in every organization view and in the settings list', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = randomUUID().slice(0, 8)
    const parentName = `QA parent ${stamp}`
    const childName = `QA organization ${stamp}`
    const email = `qa-directory-${stamp}@example.test`
    const password = `Qa1!${randomUUID()}`
    const cleanups: Array<() => Promise<unknown>> = []
    type OrganizationItem = { id: string; parentId: string | null; treePath: string }
    try {
      const parentId = await createOrganizationFixture(request, adminToken, { tenantId, name: parentName })
      cleanups.push(() => deleteOrganizationIfExists(request, adminToken, parentId))
      const childId = await createOrganizationFixture(request, adminToken, { tenantId, name: childName, parentId })
      cleanups.push(() => deleteOrganizationIfExists(request, adminToken, childId))
      const roleId = await createRoleFixture(request, adminToken, { tenantId, name: `QA directory ${stamp}` })
      cleanups.push(() => deleteRoleIfExists(request, adminToken, roleId))
      await setRoleAclFeatures(request, adminToken, {
        roleId, features: ['directory.organizations.view'], organizations: [childId],
      })
      const userId = await createUserFixture(request, adminToken, { email, password, organizationId: childId, roles: [roleId] })
      cleanups.push(() => deleteUserIfExists(request, adminToken, userId))
      const token = await getAuthToken(request, email, password)

      for (const view of ['options', 'manage', 'tree']) {
        const response = await apiRequest(request, 'GET', `/api/directory/organizations?view=${view}`, { token })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ items: OrganizationItem[] }>(response)
        expect(body?.items).toMatchObject([{ id: childId, parentId: null, treePath: childId }])
      }
      const filtered = await apiRequest(request, 'GET', `/api/directory/organizations?view=options&ids=${parentId}`, { token })
      expect(await readJsonSafe(filtered)).toEqual({ items: [] })
      const switcher = await apiRequest(request, 'GET', '/api/directory/organization-switcher', { token })
      expect(switcher.status()).toBe(200)
      expect(await readJsonSafe(switcher)).toMatchObject({
        items: [{ id: parentId, selectable: false, children: [{ id: childId, selectable: true }] }],
        canViewAllOrganizations: false,
      })

      expect((await postForm(page.request, '/api/auth/login', { email, password })).status()).toBe(200)
      await page.goto('/backend/directory/organizations')
      await expect(page.getByRole('row', { name: new RegExp(childName) })).toBeVisible()
      await expect(page.getByRole('row', { name: new RegExp(parentName) })).toHaveCount(0)
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup()
    }
  })

  test('enforces expanded actor scope for targets, hierarchy destinations and replay without side effects', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(adminToken)
    expect(tenantId).toBeTruthy()
    const stamp = randomUUID()
    const organizationIds: string[] = []
    let roleId: string | null = null
    let userId: string | null = null
    const features = ['directory.organizations.view', 'directory.organizations.manage', 'audit_logs.view_self', 'audit_logs.undo_self', 'audit_logs.redo_self']
    const createOrg = async (label: string, parentId?: string) => {
      const id = await createOrganizationFixture(request, adminToken, {
        name: `QA #8677 ${label} ${stamp}`, tenantId: tenantId as string, parentId,
      })
      organizationIds.push(id)
      return id
    }
    const loadOrg = async (id: string) => {
      const response = await apiRequest(request, 'GET', `/api/directory/organizations?view=manage&ids=${id}`, { token: adminToken })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ items?: Array<{ id: string; name: string; parentId: string | null; childIds: string[] }> }>(response)
      return body?.items?.find((item) => item.id === id) ?? null
    }
    const update = (token: string, id: string, data: Record<string, unknown>) => apiRequest(request, 'PUT', '/api/directory/organizations', {
      token, data: { id, ...data },
    })
    const create = (token: string, data: Record<string, unknown>) => apiRequest(request, 'POST', '/api/directory/organizations', {
      token, data: { tenantId, ...data },
    })
    const remove = (token: string, id: string) => apiRequest(request, 'DELETE', `/api/directory/organizations?id=${id}`, { token })
    const expectDenied = (status: number) => expect([403, 404]).toContain(status)

    try {
      const allowedId = await createOrg('A')
      const childId = await createOrg('A child', allowedId)
      const siblingId = await createOrg('B')
      const siblingChildId = await createOrg('B child', siblingId)
      const email = `qa-8677-${stamp}@example.com`
      const password = `Scope-${randomUUID()}-A1!`
      roleId = await createRoleFixture(request, adminToken, { name: `qa-8677-${stamp}`, tenantId: tenantId as string })
      const setScope = (organizations: string[] | null) => setRoleAclFeatures(request, adminToken, {
        roleId: roleId as string, features, organizations,
      })
      await setScope([allowedId])
      userId = await createUserFixture(request, adminToken, {
        email, password, organizationId: allowedId, roles: [roleId], name: 'Scoped directory manager',
      })
      const actorToken = await getAuthToken(request, email, password)

      const deniedRootCreate = await create(actorToken, { name: `QA #8677 denied root ${stamp}` })
      expectDenied(deniedRootCreate.status())
      const allowedChildCreate = await create(actorToken, {
        name: `QA #8677 allowed child ${stamp}`,
        parentId: allowedId,
      })
      expect(allowedChildCreate.status()).toBe(201)
      const allowedChildBody = await readJsonSafe<{ id?: string }>(allowedChildCreate)
      if (!allowedChildBody?.id) throw new Error('[internal] Scoped child creation did not return an id')
      organizationIds.push(allowedChildBody.id)

      const createOperation = expectOperation(allowedChildCreate, 'scoped child create')
      expect((await undoByToken(request, actorToken, createOperation.undoToken)).status()).toBe(200)
      expect(await loadOrg(allowedChildBody.id)).toBeNull()
      expect((await redoByLogId(request, actorToken, createOperation.logId)).status()).toBe(200)
      expect((await loadOrg(allowedChildBody.id))?.parentId).toBe(allowedId)

      expect((await update(actorToken, allowedId, { name: `QA #8677 allowed ${stamp}` })).status()).toBe(200)
      expect((await update(actorToken, childId, { name: `QA #8677 expanded descendant ${stamp}` })).status()).toBe(200)

      const siblingBefore = await loadOrg(siblingId)
      const allowedBefore = await loadOrg(allowedId)
      expectDenied((await update(actorToken, siblingId, { name: 'Unauthorized rename' })).status())
      expectDenied((await remove(actorToken, siblingId)).status())
      expectDenied((await update(actorToken, allowedId, { parentId: siblingId })).status())
      expectDenied((await update(actorToken, allowedId, { childIds: [childId, siblingChildId] })).status())
      expect(await loadOrg(siblingId)).toEqual(siblingBefore)
      expect(await loadOrg(allowedId)).toEqual(allowedBefore)
      expect((await loadOrg(siblingChildId))?.parentId).toBe(siblingId)

      expect((await update(actorToken, childId, { parentId: null })).status()).toBe(200)
      expect((await update(adminToken, childId, { parentId: allowedId })).status()).toBe(200)
      const deleteChildResponse = await remove(actorToken, childId)
      expect(deleteChildResponse.status()).toBe(200)
      expect(await loadOrg(childId)).toBeNull()
      const deleteOperation = expectOperation(deleteChildResponse, 'scoped child delete')
      await setScope([siblingId])
      expect([400, 403, 404]).toContain((await undoByToken(request, actorToken, deleteOperation.undoToken)).status())
      expect(await loadOrg(childId)).toBeNull()
      expect((await loadOrg(allowedId))?.childIds ?? []).not.toContain(childId)
      await setScope([allowedId])
      expect((await undoByToken(request, actorToken, deleteOperation.undoToken)).status()).toBe(200)
      expect((await loadOrg(childId))?.parentId).toBe(allowedId)
      await setScope([siblingId])
      expect((await redoByLogId(request, actorToken, deleteOperation.logId)).status()).toBe(400)
      expect((await loadOrg(childId))?.parentId).toBe(allowedId)
      await setScope([allowedId])
      expect((await redoByLogId(request, actorToken, deleteOperation.logId)).status()).toBe(200)
      expect(await loadOrg(childId)).toBeNull()

      expect((await update(adminToken, allowedId, { parentId: siblingId })).status()).toBe(200)
      const nestedBefore = await loadOrg(allowedId)
      expectDenied((await remove(actorToken, allowedId)).status())
      expectDenied((await update(actorToken, allowedId, { parentId: null })).status())
      expect(await loadOrg(allowedId)).toEqual(nestedBefore)
      expect((await update(adminToken, allowedId, { parentId: null })).status()).toBe(200)

      await setScope([allowedId, siblingId])
      const replayBefore = await loadOrg(siblingId)
      const rename = await update(actorToken, siblingId, { name: `QA #8677 replay ${stamp}` })
      expect(rename.status()).toBe(200)
      const operation = expectOperation(rename, 'scoped sibling rename')
      await setScope([allowedId])
      expectDenied((await undoByToken(request, actorToken, operation.undoToken)).status())
      expect((await loadOrg(siblingId))?.name).toBe(`QA #8677 replay ${stamp}`)
      await setScope([allowedId, siblingId])
      expect((await undoByToken(request, actorToken, operation.undoToken)).status()).toBe(200)
      expect((await loadOrg(siblingId))?.name).toBe(replayBefore?.name)
      await setScope([allowedId])
      expectDenied((await redoByLogId(request, actorToken, operation.logId)).status())
      expect((await loadOrg(siblingId))?.name).toBe(replayBefore?.name)
      await setScope([allowedId, siblingId])
      expect((await redoByLogId(request, actorToken, operation.logId)).status()).toBe(200)

      await setScope([])
      const denyAllBefore = await loadOrg(allowedId)
      expectDenied((await create(actorToken, { name: `QA #8677 deny-all root ${stamp}` })).status())
      expectDenied((await update(actorToken, allowedId, { name: 'Deny-all bypass' })).status())
      expectDenied((await remove(actorToken, allowedId)).status())
      expect(await loadOrg(allowedId)).toEqual(denyAllBefore)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
      for (const id of organizationIds.reverse()) await deleteOrganizationIfExists(request, adminToken, id)
    }
  })
})
